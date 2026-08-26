import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { DiffData, FileSystemRequest, FileSystemResult, PatchData, RollbackData } from "./types.js";

const execFile = promisify(execFileCallback);
const MAX_PATCH_BYTES = 5_000_000;
const MAX_PATCH_FILES = 100;
const MAX_OUTPUT_BYTES = 5_000_000;
const rollbackRecords = new Map<string, { projectRoot: string; files: Map<string, Buffer | undefined> }>();

type DiffErrorCode =
  | "PATH_INVALID"
  | "PATH_OUTSIDE_PROJECT"
  | "PATH_NOT_FOUND"
  | "GIT_UNAVAILABLE"
  | "PATCH_REQUIRED"
  | "PATCH_INVALID"
  | "PATCH_CONFLICT"
  | "ROLLBACK_NOT_FOUND"
  | "FILE_TOO_LARGE"
  | "OPERATION_FAILED";

function fail<T>(operationId: string, code: DiffErrorCode, message: string, retryable = false): FileSystemResult<T> {
  return { ok: false, operationId, code, message, retryable };
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

function gitArgs(request: FileSystemRequest) {
  if (request.action === "diff_file") return ["diff", "--no-ext-diff", "--", request.path ?? "."];
  if (request.action === "diff_paths") return ["diff", "--no-ext-diff", "--", ...(request.paths ?? [])];
  return ["diff", "--no-ext-diff"];
}

function countPatch(patch: string) {
  patch = patch.replace(/\u001b\[[0-9;]*m/g, "");
  const files = new Set<string>();
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      const candidate = line.slice(4).replace(/^(?:a|b)\//, "");
      if (candidate !== "/dev/null") files.add(candidate);
    } else if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { files: [...files].filter((path) => !path.includes("\0")), additions, deletions };
}

function patchFiles(patch: string) {
  const files = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    if (!line.startsWith("+++ ") && !line.startsWith("--- ")) continue;
    const candidate = line.slice(4).split("\t")[0]?.replace(/^(?:a|b)\//, "");
    if (!candidate || candidate === "/dev/null") continue;
    if (candidate.startsWith("/") || candidate === "." || candidate === ".." || candidate.startsWith(`..${sep}`) || candidate.startsWith(".git/") || candidate === ".git") throw new Error("patch-invalid");
    files.add(candidate);
  }
  if (!files.size || files.size > MAX_PATCH_FILES) throw new Error("patch-invalid");
  return [...files];
}

async function tempPatch(patch: string) {
  const path = join(resolve("/tmp"), `nexuss-file-system-${randomUUID()}.patch`);
  await writeFile(path, patch, { encoding: "utf8", mode: 0o600 });
  return path;
}

async function runGit(projectRoot: string, args: string[]) {
  try {
    const result = await execFile("git", ["-c", "color.ui=false", ...args], { cwd: resolve(projectRoot), maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true });
    return result.stdout;
  } catch (error) {
    const systemCode = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
    if (systemCode === "ENOENT") throw new Error("git-unavailable");
    throw new Error("git-failed");
  }
}

async function snapshotPatchFiles(projectRoot: string, files: string[]) {
  const snapshot = new Map<string, Buffer | undefined>();
  for (const path of files) {
    const safe = safePath(projectRoot, path);
    try {
      const info = await lstat(safe.absolute);
      if (!info.isFile()) throw new Error("patch-invalid");
      snapshot.set(safe.relative, await readFile(safe.absolute));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") snapshot.set(safe.relative, undefined);
      else throw error;
    }
  }
  return snapshot;
}

async function restoreSnapshot(projectRoot: string, files: Map<string, Buffer | undefined>) {
  const restored: string[] = [];
  for (const [path, content] of files) {
    const safe = safePath(projectRoot, path);
    if (content === undefined) await unlink(safe.absolute).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    else {
      const temporary = `${safe.absolute}.${randomUUID()}.rollback`;
      await writeFile(temporary, content, { mode: 0o600 });
      await rename(temporary, safe.absolute).catch(async (error) => { await unlink(temporary).catch(() => undefined); throw error; });
    }
    restored.push(path);
  }
  return restored;
}

export async function diffFileSystem(projectRoot: string, request: FileSystemRequest, operationId: string): Promise<FileSystemResult> {
  const started = performance.now();
  try {
    if (request.action === "preview_patch" || request.action === "apply_patch") {
      if (!request.patchText?.trim()) return fail(operationId, "PATCH_REQUIRED", "patchText is required.");
      if (Buffer.byteLength(request.patchText, "utf8") > MAX_PATCH_BYTES) return fail(operationId, "FILE_TOO_LARGE", "The patch exceeds the supported size limit.");
      const files = patchFiles(request.patchText);
      const counts = countPatch(request.patchText);
      const temporary = await tempPatch(request.patchText);
      try {
        await runGit(projectRoot, ["apply", "--check", "--whitespace=nowarn", temporary]);
        if (request.action === "preview_patch") return { ok: true, operationId, action: request.action, path: ".", data: { valid: true, patch: request.patchText, ...counts }, durationMs: performance.now() - started } satisfies FileSystemResult<PatchData>;
        const snapshot = await snapshotPatchFiles(projectRoot, files);
        await runGit(projectRoot, ["apply", "--whitespace=nowarn", temporary]);
        rollbackRecords.set(operationId, { projectRoot: resolve(projectRoot), files: snapshot });
        return { ok: true, operationId, action: request.action, path: ".", data: { valid: true, applied: true, rollbackOperationId: operationId, patch: request.patchText, ...counts }, durationMs: performance.now() - started } satisfies FileSystemResult<PatchData>;
      } finally { await unlink(temporary).catch(() => undefined); }
    }

    if (request.action === "rollback") {
      if (!request.rollbackOperationId) return fail(operationId, "ROLLBACK_NOT_FOUND", "rollbackOperationId is required.");
      const record = rollbackRecords.get(request.rollbackOperationId);
      if (!record || record.projectRoot !== resolve(projectRoot)) return fail(operationId, "ROLLBACK_NOT_FOUND", "The rollback record was not found for this project.");
      const restoredPaths = await restoreSnapshot(projectRoot, record.files);
      rollbackRecords.delete(request.rollbackOperationId);
      return { ok: true, operationId, action: request.action, path: ".", data: { rolledBack: true, restoredPaths, operationId: request.rollbackOperationId } satisfies RollbackData, durationMs: performance.now() - started };
    }

    if (request.action === "diff_file" || request.action === "diff_workspace" || request.action === "diff_paths") {
      if (request.action === "diff_file" && !request.path) return fail(operationId, "PATH_INVALID", "diff_file requires a path.");
      if (request.action === "diff_paths" && !request.paths?.length) return fail(operationId, "PATH_INVALID", "diff_paths requires paths.");
      const patch = await runGit(projectRoot, gitArgs(request));
      const counts = countPatch(patch);
      return { ok: true, operationId, action: request.action, path: request.path ?? ".", data: { patch, ...counts, truncated: Buffer.byteLength(patch, "utf8") >= MAX_OUTPUT_BYTES } satisfies DiffData, durationMs: performance.now() - started };
    }
    return fail(operationId, "OPERATION_FAILED", "Unsupported diff operation.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Diff operation failed.";
    const code: DiffErrorCode = message === "invalid" ? "PATH_INVALID" : message === "outside" ? "PATH_OUTSIDE_PROJECT" : message === "git-unavailable" ? "GIT_UNAVAILABLE" : message === "git-failed" ? "PATCH_CONFLICT" : message === "patch-invalid" ? "PATCH_INVALID" : message === "ENOENT" ? "PATH_NOT_FOUND" : "OPERATION_FAILED";
    return fail(operationId, code, code === "PATCH_CONFLICT" ? "The patch could not be applied cleanly to the current workspace." : code === "PATCH_INVALID" ? "The patch contains invalid or protected paths." : message, code === "PATCH_CONFLICT" || code === "OPERATION_FAILED");
  }
}
