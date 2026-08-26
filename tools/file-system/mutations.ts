import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { lstat, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { FileSystemRequest, FileSystemResult } from "./types.js";

const execFile = promisify(execFileCallback);
const MAX_CONTENT_BYTES = 5_000_000;
const MAX_EDIT_OPERATIONS = 100;
const FORMATTER_TIMEOUT_MS = 30_000;

type MutationErrorCode =
  | "PATH_INVALID"
  | "PATH_OUTSIDE_PROJECT"
  | "PATH_NOT_FOUND"
  | "TARGET_EXISTS"
  | "CHECKSUM_REQUIRED"
  | "CHECKSUM_MISMATCH"
  | "CONTENT_REQUIRED"
  | "EDIT_CONFLICT"
  | "FILE_TOO_LARGE"
  | "NOT_A_FILE"
  | "INVALID_ENCODING"
  | "FORMATTER_INVALID"
  | "FORMATTER_FAILED"
  | "OPERATION_FAILED";

function fail<T>(id: string, code: MutationErrorCode, message: string, retryable = false): FileSystemResult<T> {
  return { ok: false, operationId: id, code, message, retryable };
}

function hash(content: Buffer | string) {
  return createHash("sha256").update(content).digest("hex");
}

function safePath(projectRoot: string, requestedPath = ".") {
  if (!requestedPath.trim() || requestedPath.includes("\0")) throw new Error("invalid");
  if (requestedPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(requestedPath)) throw new Error("outside");
  const root = resolve(projectRoot);
  const absolute = resolve(root, requestedPath);
  const relativePath = relative(root, absolute);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) throw new Error("outside");
  return { absolute, relative: relativePath || "." };
}

async function assertSafeParent(projectRoot: string, absolutePath: string) {
  const root = await realpath(resolve(projectRoot));
  const parent = await realpath(dirname(absolutePath));
  const parentRelative = relative(root, parent);
  if (parentRelative === ".." || parentRelative.startsWith(`..${sep}`)) throw new Error("symlink");
}

async function existingFile(absolutePath: string) {
  const info = await lstat(absolutePath);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("not-file");
  return info;
}

async function atomicWrite(absolutePath: string, content: string) {
  const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, absolutePath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function validateContent(content: string | undefined) {
  if (content === undefined) throw new Error("content");
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) throw new Error("large");
}

async function verifyExpectedSha(absolutePath: string, expectedSha256: string | undefined, required = true) {
  const content = await readFile(absolutePath);
  const actual = hash(content);
  if (required && !expectedSha256) throw new Error("checksum-required");
  if (expectedSha256 && expectedSha256.replace(/^sha256:/, "").toLowerCase() !== actual) throw new Error("checksum-mismatch");
  return { content, actual };
}

function applyEdits(content: string, edits: Array<{ find: string; replace: string }>) {
  if (!edits.length || edits.length > MAX_EDIT_OPERATIONS) throw new Error("edit-conflict");
  let output = content;
  for (const edit of edits) {
    if (!edit.find) throw new Error("edit-conflict");
    const first = output.indexOf(edit.find);
    if (first < 0 || output.indexOf(edit.find, first + edit.find.length) >= 0) throw new Error("edit-conflict");
    output = `${output.slice(0, first)}${edit.replace}${output.slice(first + edit.find.length)}`;
  }
  return output;
}

async function runFormatter(formatter: FileSystemRequest["formatter"], absolutePath: string) {
  if (!formatter) throw new Error("formatter");
  const commands: Record<NonNullable<FileSystemRequest["formatter"]>, { command: string; args: string[] }> = {
    prettier: { command: "prettier", args: ["--write", absolutePath] },
    biome: { command: "biome", args: ["format", "--write", absolutePath] },
    gofmt: { command: "gofmt", args: ["-w", absolutePath] },
    rustfmt: { command: "rustfmt", args: [absolutePath] },
  };
  const selected = commands[formatter];
  if (!selected) throw new Error("formatter");
  try {
    await execFile(selected.command, selected.args, { timeout: FORMATTER_TIMEOUT_MS, windowsHide: true });
  } catch {
    throw new Error("formatter-failed");
  }
}

export async function mutateFileSystem(projectRoot: string, request: FileSystemRequest, operationId: string): Promise<FileSystemResult> {
  const started = performance.now();
  let target: { absolute: string; relative: string };
  try { target = safePath(projectRoot, request.path); } catch (error) { return fail(operationId, error instanceof Error && error.message === "outside" ? "PATH_OUTSIDE_PROJECT" : "PATH_INVALID", "The path must remain inside the project workspace."); }
  try {
    await assertSafeParent(projectRoot, target.absolute);
    const exists = await lstat(target.absolute).then(() => true).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; });
    if (request.action === "create") {
      if (exists) return fail(operationId, "TARGET_EXISTS", "create requires a new path.");
      validateContent(request.content);
      await atomicWrite(target.absolute, request.content!);
      return { ok: true, operationId, action: request.action, path: target.relative, data: { created: true, bytes: Buffer.byteLength(request.content!, "utf8"), sha256: hash(request.content!) }, durationMs: performance.now() - started };
    }
    if (!exists) return fail(operationId, "PATH_NOT_FOUND", "The target file does not exist.");
    await existingFile(target.absolute);
    const before = await verifyExpectedSha(target.absolute, request.expectedSha256, request.action !== "format" || true);
    let content: string;
    try { content = before.content.toString("utf8"); if (content.includes("\uFFFD")) throw new Error("encoding"); } catch (error) { if (error instanceof Error && error.message === "encoding") throw error; throw new Error("encoding"); }
    if (request.action === "write") {
      validateContent(request.content);
      content = request.content!;
    } else if (request.action === "append") {
      validateContent(request.content);
      content += request.content!;
    } else if (request.action === "patch") {
      content = applyEdits(content, request.edits ?? []);
      validateContent(content);
    } else if (request.action === "replace") {
      validateContent(request.content);
      const lines = content.split(/\r?\n/);
      if (!Number.isInteger(request.startLine) || !Number.isInteger(request.endLine) || request.startLine! < 1 || request.endLine! < request.startLine! || request.endLine! > lines.length) throw new Error("edit-conflict");
      lines.splice(request.startLine! - 1, request.endLine! - request.startLine! + 1, request.content!);
      content = lines.join("\n");
    } else if (request.action === "format") {
      await runFormatter(request.formatter, target.absolute);
      const after = await readFile(target.absolute);
      return { ok: true, operationId, action: request.action, path: target.relative, data: { changed: hash(after) !== before.actual, bytes: after.length, sha256: hash(after), formatter: request.formatter }, durationMs: performance.now() - started };
    } else {
      return fail(operationId, "OPERATION_FAILED", "Unsupported mutation operation.");
    }
    await atomicWrite(target.absolute, content);
    const after = Buffer.from(content, "utf8");
    return { ok: true, operationId, action: request.action, path: target.relative, data: { changed: hash(after) !== before.actual, bytes: after.length, sha256: hash(after), previousSha256: before.actual }, durationMs: performance.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Filesystem mutation failed.";
    const systemCode = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
    const code: MutationErrorCode = systemCode === "ENOENT" ? "PATH_NOT_FOUND" : message === "symlink" ? "PATH_OUTSIDE_PROJECT" : message === "not-file" ? "NOT_A_FILE" : message === "checksum-required" ? "CHECKSUM_REQUIRED" : message === "checksum-mismatch" ? "CHECKSUM_MISMATCH" : message === "content" ? "CONTENT_REQUIRED" : message === "large" ? "FILE_TOO_LARGE" : message === "encoding" ? "INVALID_ENCODING" : message === "edit-conflict" ? "EDIT_CONFLICT" : message === "formatter" ? "FORMATTER_INVALID" : message === "formatter-failed" ? "FORMATTER_FAILED" : "OPERATION_FAILED";
    return fail(operationId, code, code === "CHECKSUM_MISMATCH" ? "The file changed since it was inspected; refresh it before modifying." : message, code === "FORMATTER_FAILED" || code === "OPERATION_FAILED");
  }
}
