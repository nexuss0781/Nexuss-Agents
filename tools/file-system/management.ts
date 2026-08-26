import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, realpath, rename as renamePath, unlink, rmdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { FileSystemRequest, FileSystemResult } from "./types.js";

const MAX_DELETE_ENTRIES = 5_000;

type ManagementErrorCode =
  | "PATH_INVALID"
  | "PATH_OUTSIDE_PROJECT"
  | "PATH_NOT_FOUND"
  | "SOURCE_NOT_FOUND"
  | "TARGET_EXISTS"
  | "DESTINATION_INVALID"
  | "NOT_A_FILE"
  | "CONFIRMATION_REQUIRED"
  | "DIRECTORY_NOT_EMPTY"
  | "RECURSIVE_REQUIRED"
  | "DELETE_LIMIT_REQUIRED"
  | "SYMLINK_BLOCKED"
  | "PATTERN_REQUIRED"
  | "CHECKSUM_REQUIRED"
  | "CHECKSUM_MISMATCH"
  | "OPERATION_FAILED";

function fail<T>(id: string, code: ManagementErrorCode, message: string, retryable = false): FileSystemResult<T> {
  return { ok: false, operationId: id, code, message, retryable };
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

async function assertNoSymlinkChain(projectRoot: string, targetPath: string, includeFinal: boolean) {
  const root = await realpath(resolve(projectRoot));
  const relativeTarget = relative(root, targetPath);
  const parts = relativeTarget ? relativeTarget.split(sep) : [];
  let current = root;
  const count = includeFinal ? parts.length : Math.max(0, parts.length - 1);
  for (let index = 0; index < count; index += 1) {
    current = join(current, parts[index]!);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error("symlink");
  }
}

async function existingPath(absolutePath: string) {
  try { return await lstat(absolutePath); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

async function assertSource(projectRoot: string, requestedPath: string) {
  const source = safePath(projectRoot, requestedPath);
  await assertNoSymlinkChain(projectRoot, source.absolute, true);
  const info = await existingPath(source.absolute);
  if (!info) throw new Error("source-not-found");
  if (info.isSymbolicLink()) throw new Error("symlink");
  return { ...source, info };
}

async function assertDestination(projectRoot: string, requestedPath: string) {
  const destination = safePath(projectRoot, requestedPath);
  await assertNoSymlinkChain(projectRoot, destination.absolute, false);
  const parent = await existingPath(resolve(destination.absolute, ".."));
  if (!parent?.isDirectory()) throw new Error("destination");
  const existing = await existingPath(destination.absolute);
  if (existing) throw new Error("target-exists");
  return destination;
}

async function collectPaths(absolutePath: string, relativePath: string, maxEntries: number) {
  const paths: string[] = [];
  async function visit(currentAbsolute: string, currentRelative: string) {
    if (paths.length >= maxEntries) throw new Error("delete-limit");
    const info = await lstat(currentAbsolute);
    if (info.isSymbolicLink()) throw new Error("symlink");
    paths.push(currentRelative);
    if (!info.isDirectory()) return;
    for (const item of await import("node:fs/promises").then(({ readdir }) => readdir(currentAbsolute, { withFileTypes: true }))) {
      const childRelative = currentRelative === "." ? item.name : `${currentRelative}/${item.name}`;
      await visit(join(currentAbsolute, item.name), childRelative);
    }
  }
  await visit(absolutePath, relativePath);
  return paths;
}

function globToRegExp(pattern: string) {
  const trimmed = pattern.trim();
  if (!trimmed || trimmed.includes("\0")) throw new Error("pattern");
  const escaped = trimmed.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
  return new RegExp(`^${escaped}$`, "i");
}

function pathMatches(path: string, pattern: string) {
  return globToRegExp(pattern).test(path);
}

async function generatedFiles(rootAbsolute: string, rootRelative: string, patterns: string[], maxEntries: number) {
  const results: string[] = [];
  async function visit(currentAbsolute: string, currentRelative: string) {
    if (results.length >= maxEntries) throw new Error("delete-limit");
    const items = await import("node:fs/promises").then(({ readdir }) => readdir(currentAbsolute, { withFileTypes: true }));
    for (const item of items) {
      const childRelative = currentRelative === "." ? item.name : `${currentRelative}/${item.name}`;
      const childAbsolute = join(currentAbsolute, item.name);
      if (item.isSymbolicLink()) throw new Error("symlink");
      if (item.isDirectory()) await visit(childAbsolute, childRelative);
      else if (patterns.some((pattern) => pathMatches(childRelative, pattern))) {
        results.push(childRelative);
        if (results.length >= maxEntries) throw new Error("delete-limit");
      }
    }
  }
  await visit(rootAbsolute, rootRelative);
  return results;
}

async function removePaths(projectRoot: string, relativePaths: string[]) {
  const absolutePaths = relativePaths.map((path) => resolve(projectRoot, path));
  for (const path of [...absolutePaths].reverse()) {
    const info = await lstat(path);
    if (info.isDirectory()) await rmdir(path);
    else await unlink(path);
  }
}

async function checksum(absolutePath: string) {
  const content = await import("node:fs/promises").then(({ readFile }) => readFile(absolutePath));
  return createHash("sha256").update(content).digest("hex");
}

export async function manageFileSystem(projectRoot: string, request: FileSystemRequest, operationId: string): Promise<FileSystemResult> {
  const started = performance.now();
  try {
    if (["copy", "move", "rename"].includes(request.action)) {
      if (!request.path || !request.destinationPath) return fail(operationId, "DESTINATION_INVALID", "A source path and destinationPath are required.");
      const source = await assertSource(projectRoot, request.path);
      if (source.info.isDirectory()) await collectPaths(source.absolute, source.relative, MAX_DELETE_ENTRIES);
      const destination = await assertDestination(projectRoot, request.destinationPath);
      if (request.action === "copy") await cp(source.absolute, destination.absolute, { recursive: source.info.isDirectory(), errorOnExist: true });
      else await renamePath(source.absolute, destination.absolute);
      return { ok: true, operationId, action: request.action, path: source.relative, data: { sourcePath: source.relative, destinationPath: destination.relative, type: source.info.isDirectory() ? "directory" : "file" }, durationMs: performance.now() - started };
    }

    if (request.action === "delete") {
      if (!request.path) return fail(operationId, "PATH_INVALID", "delete requires a path.");
      if (request.confirmed !== true) return fail(operationId, "CONFIRMATION_REQUIRED", "delete requires confirmed: true.");
      const target = await assertSource(projectRoot, request.path);
      if (target.info.isFile()) {
        if (!request.expectedSha256) return fail(operationId, "CHECKSUM_REQUIRED", "File deletion requires expectedSha256.");
        const actual = await checksum(target.absolute);
        if (request.expectedSha256.replace(/^sha256:/, "").toLowerCase() !== actual) return fail(operationId, "CHECKSUM_MISMATCH", "The file changed since it was inspected; refresh it before deleting.");
        await unlink(target.absolute);
        return { ok: true, operationId, action: request.action, path: target.relative, data: { deleted: true, entries: 1, sha256: actual }, durationMs: performance.now() - started };
      }
      if (!target.info.isDirectory()) return fail(operationId, "NOT_A_FILE", "delete supports regular files and directories.");
      if (request.recursive !== true) return fail(operationId, "RECURSIVE_REQUIRED", "Directory deletion requires recursive: true.");
      if (!Number.isInteger(request.maxEntries) || request.maxEntries! < 1 || request.maxEntries! > MAX_DELETE_ENTRIES) return fail(operationId, "DELETE_LIMIT_REQUIRED", `Recursive deletion requires maxEntries between 1 and ${MAX_DELETE_ENTRIES}.`);
      const paths = await collectPaths(target.absolute, target.relative, request.maxEntries!);
      await removePaths(projectRoot, paths);
      return { ok: true, operationId, action: request.action, path: target.relative, data: { deleted: true, entries: paths.length }, durationMs: performance.now() - started };
    }

    if (request.action === "clean_generated") {
      if (!request.path) return fail(operationId, "PATH_INVALID", "clean_generated requires a root path.");
      if (request.confirmed !== true) return fail(operationId, "CONFIRMATION_REQUIRED", "clean_generated requires confirmed: true.");
      if (!request.patterns?.length) return fail(operationId, "PATTERN_REQUIRED", "clean_generated requires one or more patterns.");
      if (!Number.isInteger(request.maxEntries) || request.maxEntries! < 1 || request.maxEntries! > MAX_DELETE_ENTRIES) return fail(operationId, "DELETE_LIMIT_REQUIRED", `Generated-file cleanup requires maxEntries between 1 and ${MAX_DELETE_ENTRIES}.`);
      const root = safePath(projectRoot, request.path);
      await assertNoSymlinkChain(projectRoot, root.absolute, true);
      const info = await lstat(root.absolute);
      if (!info.isDirectory()) return fail(operationId, "DESTINATION_INVALID", "clean_generated requires a directory root.");
      const paths = await generatedFiles(root.absolute, root.relative, request.patterns, request.maxEntries!);
      await removePaths(projectRoot, paths);
      return { ok: true, operationId, action: request.action, path: root.relative, data: { deleted: true, entries: paths.length, paths }, durationMs: performance.now() - started };
    }

    return fail(operationId, "OPERATION_FAILED", "Unsupported management operation.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Filesystem management failed.";
    const code: ManagementErrorCode = message === "invalid" ? "PATH_INVALID" : message === "outside" ? "PATH_OUTSIDE_PROJECT" : message === "symlink" ? "SYMLINK_BLOCKED" : message === "source-not-found" ? "SOURCE_NOT_FOUND" : message === "target-exists" ? "TARGET_EXISTS" : message === "destination" ? "DESTINATION_INVALID" : message === "delete-limit" ? "DELETE_LIMIT_REQUIRED" : message === "pattern" ? "PATTERN_REQUIRED" : "OPERATION_FAILED";
    return fail(operationId, code, message === "symlink" ? "Symlink paths are blocked for management operations." : message, code === "OPERATION_FAILED");
  }
}
