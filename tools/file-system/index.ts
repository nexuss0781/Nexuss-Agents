import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile as writeFileFs } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { extname, join, relative, resolve, sep } from "node:path";
import type {
  BinaryMetadata,
  CodeNavigationData,
  CodeSymbol,
  FileEntry,
  FileSystemRequest,
  FileSystemResult,
  RecentChange,
  SearchData,
  TextFileData,
  TextMatch,
  TreeEntry,
} from "./types.js";
import { mutateFileSystem } from "./mutations.js";
import { manageFileSystem } from "./management.js";
import { navigateFileSystem } from "./navigation.js";
import { diffFileSystem } from "./diff.js";
import { snapshotFileSystem } from "./snapshots.js";

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_BYTES = 512_000;
const DEFAULT_MAX_MATCHES = 200;
const DEFAULT_CONTEXT_LINES = 0;
const MAX_ENTRIES = 5_000;
const MAX_DEPTH = 12;
const MAX_READ_BYTES = 5_000_000;
const MAX_BATCH_FILES = 50;
const MAX_MATCHES = 5_000;
const MAX_CONTEXT_LINES = 10;
const MAX_EDIT_OPERATIONS = 100;
const execFile = promisify(execFileCallback);

function operationId() {
  return randomUUID();
}

type ErrorCode =
  | "PATH_INVALID"
  | "PATH_OUTSIDE_PROJECT"
  | "PATH_NOT_FOUND"
  | "LIMIT_INVALID"
  | "FILE_NOT_FOUND"
  | "NOT_A_FILE"
  | "NOT_A_DIRECTORY"
  | "BINARY_FILE"
  | "INVALID_ENCODING"
  | "PATTERN_INVALID"
  | "QUERY_INVALID"
  | "FILE_TOO_LARGE"
  | "OPERATION_FAILED";

function fail<T>(id: string, code: ErrorCode, message: string, retryable = false): FileSystemResult<T> {
  return { ok: false, operationId: id, code, message, retryable };
}

function bounded(value: number | undefined, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) return undefined;
  return value;
}

function safeRelativePath(projectRoot: string, requestedPath = ".") {
  if (!requestedPath.trim() || requestedPath.includes("\0")) throw new Error("invalid");
  if (requestedPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(requestedPath)) throw new Error("outside");
  const root = resolve(projectRoot);
  const candidate = resolve(root, requestedPath);
  const relativePath = relative(root, candidate);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) throw new Error("outside");
  return { absolute: candidate, relative: relativePath || "." };
}

async function entry(absolutePath: string, relativePath: string): Promise<FileEntry> {
  const info = await lstat(absolutePath);
  const type = info.isFile() ? "file" : info.isDirectory() ? "directory" : info.isSymbolicLink() ? "symlink" : "other";
  return {
    name: relativePath === "." ? "." : relativePath.split(/[\\/]/).at(-1) || relativePath,
    path: relativePath,
    type,
    size: info.isFile() ? info.size : undefined,
    modifiedAt: info.mtime.toISOString(),
  };
}

async function list(absolutePath: string, relativePath: string, maxEntries: number) {
  const items = await readdir(absolutePath, { withFileTypes: true });
  const entries: FileEntry[] = [];
  for (const item of items.slice(0, maxEntries)) {
    const childRelative = relativePath === "." ? item.name : `${relativePath}/${item.name}`;
    entries.push(await entry(join(absolutePath, item.name), childRelative));
  }
  return { entries, truncated: items.length > maxEntries };
}

async function tree(absolutePath: string, relativePath: string, maxEntries: number, maxDepth: number, depth: number): Promise<TreeEntry[]> {
  if (depth > maxDepth) return [];
  const items = await readdir(absolutePath, { withFileTypes: true });
  const output: TreeEntry[] = [];
  for (const item of items.slice(0, maxEntries)) {
    const childRelative = relativePath === "." ? item.name : `${relativePath}/${item.name}`;
    const childAbsolute = join(absolutePath, item.name);
    const child = await entry(childAbsolute, childRelative) as TreeEntry;
    if (child.type === "directory") child.children = await tree(childAbsolute, childRelative, maxEntries, maxDepth, depth + 1);
    output.push(child);
  }
  return output;
}

function globToRegExp(pattern: string) {
  const trimmed = pattern.trim();
  if (!trimmed || trimmed.includes("\0")) throw new Error("pattern");
  const escaped = trimmed.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesPattern(value: string, pattern: string) {
  return globToRegExp(pattern).test(value);
}

function matchesAny(value: string, patterns: string[] | undefined) {
  return !patterns?.length || patterns.some((pattern) => matchesPattern(value, pattern));
}

async function find(absolutePath: string, relativePath: string, pattern: string, maxEntries: number) {
  const matcher = globToRegExp(pattern);
  const results: FileEntry[] = [];
  async function visit(currentAbsolute: string, currentRelative: string) {
    if (results.length >= maxEntries) return;
    const items = await readdir(currentAbsolute, { withFileTypes: true });
    for (const item of items) {
      if (results.length >= maxEntries) return;
      const childRelative = currentRelative === "." ? item.name : `${currentRelative}/${item.name}`;
      const childAbsolute = join(currentAbsolute, item.name);
      if (matcher.test(item.name) || matcher.test(childRelative)) results.push(await entry(childAbsolute, childRelative));
      if (item.isDirectory()) await visit(childAbsolute, childRelative);
    }
  }
  await visit(absolutePath, relativePath);
  return { entries: results, truncated: results.length >= maxEntries };
}

async function sizeOf(absolutePath: string, maxEntries: number) {
  let bytes = 0;
  let files = 0;
  let directories = 0;
  let truncated = false;
  async function visit(current: string) {
    if (files + directories >= maxEntries) { truncated = true; return; }
    const info = await lstat(current);
    if (info.isFile()) { files += 1; bytes += info.size; return; }
    if (!info.isDirectory()) return;
    directories += 1;
    for (const item of await readdir(current, { withFileTypes: true })) {
      if (files + directories >= maxEntries) { truncated = true; return; }
      if (item.isSymbolicLink()) continue;
      await visit(join(current, item.name));
    }
  }
  await visit(absolutePath);
  return { bytes, files, directories, truncated };
}

function isBinaryBuffer(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_192));
  if (sample.includes(0)) return true;
  let controls = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 14 && byte < 32)) controls += 1;
  }
  return sample.length > 0 && controls / sample.length > 0.1;
}

function decodeText(buffer: Buffer) {
  const text = buffer.toString("utf8");
  if (text.includes("\uFFFD")) throw new Error("encoding");
  return text;
}

function lineData(text: string, startLine: number, endLine: number, maxBytes: number): TextFileData {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const start = Math.min(Math.max(1, startLine), Math.max(1, lines.length));
  const end = Math.min(Math.max(start, endLine), lines.length);
  const content = lines.slice(start - 1, end).join("\n");
  const truncated = Buffer.byteLength(content, "utf8") > maxBytes;
  return { content: truncated ? content.slice(0, maxBytes) : content, startLine: start, endLine: end, totalLines: lines.length, truncated };
}

async function readTextData(absolutePath: string, startLine: number, endLine: number, maxBytes: number): Promise<TextFileData> {
  const info = await lstat(absolutePath);
  if (!info.isFile()) throw new Error("not-file");
  if (info.size > MAX_READ_BYTES) throw new Error("large");
  const buffer = await readFile(absolutePath);
  if (isBinaryBuffer(buffer)) throw new Error("binary");
  return lineData(decodeText(buffer), startLine, endLine, maxBytes);
}

async function binaryMetadata(absolutePath: string, relativePath: string, maxBytes: number): Promise<BinaryMetadata> {
  const info = await lstat(absolutePath);
  if (!info.isFile()) throw new Error("not-file");
  if (info.size > maxBytes) throw new Error("large");
  const buffer = await readFile(absolutePath);
  const hash = createHash("sha256").update(buffer).digest("hex");
  return { path: relativePath, size: info.size, extension: extname(relativePath), isBinary: isBinaryBuffer(buffer), sha256: hash, sampleBytes: Math.min(buffer.length, 8_192) };
}

function compileQuery(query: string, regex: boolean, caseSensitive: boolean) {
  if (!query.trim() || query.includes("\0")) throw new Error("query");
  try {
    return regex ? new RegExp(query, caseSensitive ? "g" : "gi") : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
  } catch { throw new Error("query"); }
}

function searchText(path: string, text: string, query: string, regex: boolean, caseSensitive: boolean, contextLines: number, maxMatches: number): TextMatch[] {
  const matcher = compileQuery(query, regex, caseSensitive);
  const lines = text.split(/\r?\n/);
  const matches: TextMatch[] = [];
  for (let index = 0; index < lines.length && matches.length < maxMatches; index += 1) {
    matcher.lastIndex = 0;
    const result = matcher.exec(lines[index]);
    if (!result) continue;
    matches.push({
      path,
      line: index + 1,
      column: result.index + 1,
      text: lines[index],
      query,
      contextBefore: contextLines ? lines.slice(Math.max(0, index - contextLines), index) : undefined,
      contextAfter: contextLines ? lines.slice(index + 1, index + 1 + contextLines) : undefined,
    });
  }
  return matches;
}

async function searchFiles(rootAbsolute: string, rootRelative: string, request: FileSystemRequest, queries: string[], maxEntries: number, maxBytes: number, maxMatches: number, contextLines: number): Promise<SearchData> {
  const matches: TextMatch[] = [];
  const skippedFiles: string[] = [];
  let filesScanned = 0;
  let truncated = false;
  const compiled = queries.map((query) => compileQuery(query, request.regex ?? false, request.caseSensitive ?? false));
  void compiled;

  async function visit(currentAbsolute: string, currentRelative: string) {
    if (filesScanned >= maxEntries || matches.length >= maxMatches) { truncated = true; return; }
    const info = await lstat(currentAbsolute);
    if (info.isFile()) {
      if (!matchesAny(currentRelative, request.include) || (request.exclude?.some((pattern) => matchesPattern(currentRelative, pattern)) ?? false)) return;
      filesScanned += 1;
      if (info.size > maxBytes) { skippedFiles.push(currentRelative); return; }
      const buffer = await readFile(currentAbsolute);
      if (isBinaryBuffer(buffer)) return;
      const text = decodeText(buffer);
      for (const query of queries) {
        if (matches.length >= maxMatches) { truncated = true; break; }
        matches.push(...searchText(currentRelative, text, query, request.regex ?? false, request.caseSensitive ?? false, contextLines, maxMatches - matches.length));
      }
      return;
    }
    if (!info.isDirectory()) return;
    const items = await readdir(currentAbsolute, { withFileTypes: true });
    for (const item of items) {
      if (filesScanned >= maxEntries || matches.length >= maxMatches) { truncated = true; return; }
      if (item.isSymbolicLink()) continue;
      const childRelative = currentRelative === "." ? item.name : `${currentRelative}/${item.name}`;
      if (request.exclude?.some((pattern) => matchesPattern(childRelative, pattern))) continue;
      await visit(join(currentAbsolute, item.name), childRelative);
    }
  }

  await visit(rootAbsolute, rootRelative);
  return { matches: matches.slice(0, maxMatches), filesScanned, skippedFiles, truncated };
}

function operationLimits(request: FileSystemRequest, id: string):
  | { error: FileSystemResult }
  | { maxEntries: number; maxDepth: number; maxBytes: number; maxMatches: number; contextLines: number } {
  const maxEntries = bounded(request.maxEntries, DEFAULT_MAX_ENTRIES, MAX_ENTRIES);
  const maxDepth = bounded(request.maxDepth, DEFAULT_MAX_DEPTH, MAX_DEPTH);
  const maxBytes = bounded(request.maxBytes, DEFAULT_MAX_BYTES, MAX_READ_BYTES);
  const maxMatches = bounded(request.maxMatches, DEFAULT_MAX_MATCHES, MAX_MATCHES);
  const contextLines = request.contextLines === undefined ? DEFAULT_CONTEXT_LINES : bounded(request.contextLines, DEFAULT_CONTEXT_LINES, MAX_CONTEXT_LINES);
  if (!maxEntries || !maxDepth || !maxBytes || !maxMatches || contextLines === undefined) return { error: fail(id, "LIMIT_INVALID", "Limits must be integers within the supported range.") };
  return { maxEntries, maxDepth, maxBytes, maxMatches, contextLines };
}

export async function inspectFileSystem(projectRoot: string, request: FileSystemRequest): Promise<FileSystemResult> {
  const id = operationId();
  const started = performance.now();
  const limits = operationLimits(request, id);
  if ("error" in limits) return limits.error;
  if (["create", "write", "append", "patch", "replace", "format"].includes(request.action)) {
    return mutateFileSystem(projectRoot, request, id);
  }
  if (["copy", "move", "rename", "delete", "clean_generated"].includes(request.action)) {
    return manageFileSystem(projectRoot, request, id);
  }
  if (["symbols", "references", "recent_changes"].includes(request.action)) {
    return navigateFileSystem(projectRoot, request, id);
  }
  if (["diff_file", "diff_workspace", "diff_paths", "preview_patch", "apply_patch", "rollback"].includes(request.action)) {
    return diffFileSystem(projectRoot, request, id);
  }
  if (["snapshot", "restore_snapshot", "manifest", "export_patch", "import_patch", "verify_workspace"].includes(request.action)) {
    return snapshotFileSystem(projectRoot, request, id);
  }
  let target: { absolute: string; relative: string };
  try { target = safeRelativePath(projectRoot, request.path); } catch (error) { return fail(id, error instanceof Error && error.message === "outside" ? "PATH_OUTSIDE_PROJECT" : "PATH_INVALID", "The path must remain inside the project workspace."); }

  try {
    const info = await lstat(target.absolute);
    if (request.action === "exists") return { ok: true, operationId: id, action: request.action, path: target.relative, data: { exists: true, type: info.isFile() ? "file" : info.isDirectory() ? "directory" : "other" }, durationMs: performance.now() - started };
    if (request.action === "stat") return { ok: true, operationId: id, action: request.action, path: target.relative, data: await entry(target.absolute, target.relative), durationMs: performance.now() - started };
    if (request.action === "list") {
      if (!info.isDirectory()) return fail(id, "NOT_A_DIRECTORY", "list requires a directory.");
      return { ok: true, operationId: id, action: request.action, path: target.relative, data: await list(target.absolute, target.relative, limits.maxEntries), durationMs: performance.now() - started };
    }
    if (request.action === "tree") {
      if (!info.isDirectory()) return fail(id, "NOT_A_DIRECTORY", "tree requires a directory.");
      return { ok: true, operationId: id, action: request.action, path: target.relative, data: { entries: await tree(target.absolute, target.relative, limits.maxEntries, limits.maxDepth, 0), maxDepth: limits.maxDepth }, durationMs: performance.now() - started };
    }
    if (request.action === "find" || request.action === "glob") {
      if (!info.isDirectory()) return fail(id, "NOT_A_DIRECTORY", `${request.action} requires a directory.`);
      if (!request.pattern?.trim()) return fail(id, "PATTERN_INVALID", `${request.action} requires a pattern.`);
      return { ok: true, operationId: id, action: request.action, path: target.relative, data: await find(target.absolute, target.relative, request.pattern, limits.maxEntries), durationMs: performance.now() - started };
    }
    if (request.action === "du") return { ok: true, operationId: id, action: request.action, path: target.relative, data: await sizeOf(target.absolute, limits.maxEntries), durationMs: performance.now() - started };
    if (request.action === "read" || request.action === "tail") {
      const endLine = request.action === "tail" ? Number.MAX_SAFE_INTEGER : request.endLine ?? Number.MAX_SAFE_INTEGER;
      const startLine = request.action === "tail" ? Math.max(1, (await readTextData(target.absolute, 1, Number.MAX_SAFE_INTEGER, limits.maxBytes)).totalLines - (request.lineCount ?? 40) + 1) : request.startLine ?? 1;
      const data = await readTextData(target.absolute, startLine, endLine, limits.maxBytes);
      return { ok: true, operationId: id, action: request.action, path: target.relative, data, durationMs: performance.now() - started };
    }
    if (request.action === "read_many") {
      if (!request.paths?.length || request.paths.length > MAX_BATCH_FILES) return fail(id, "LIMIT_INVALID", `read_many supports 1-${MAX_BATCH_FILES} paths.`);
      const files: Array<{ path: string; data?: TextFileData; error?: string }> = [];
      for (const requestedPath of request.paths) {
        try {
          const child = safeRelativePath(projectRoot, requestedPath);
          files.push({ path: child.relative, data: await readTextData(child.absolute, request.startLine ?? 1, request.endLine ?? Number.MAX_SAFE_INTEGER, limits.maxBytes) });
        } catch (error) { files.push({ path: requestedPath, error: error instanceof Error ? error.message : "read failed" }); }
      }
      return { ok: true, operationId: id, action: request.action, path: target.relative, data: { files }, durationMs: performance.now() - started };
    }
    if (request.action === "binary_metadata") {
      return { ok: true, operationId: id, action: request.action, path: target.relative, data: await binaryMetadata(target.absolute, target.relative, limits.maxBytes), durationMs: performance.now() - started };
    }
    if (request.action === "grep" || request.action === "grep_batch") {
      const queries = request.action === "grep_batch" ? request.queries ?? [] : request.query ? [request.query] : [];
      if (!queries.length || queries.length > MAX_BATCH_FILES) return fail(id, "QUERY_INVALID", `grep requires 1-${MAX_BATCH_FILES} queries.`);
      const data = info.isDirectory() ? await searchFiles(target.absolute, target.relative, request, queries, limits.maxEntries, limits.maxBytes, limits.maxMatches, limits.contextLines) : await searchFiles(resolve(target.absolute, ".."), target.relative, request, queries, limits.maxEntries, limits.maxBytes, limits.maxMatches, limits.contextLines);
      return { ok: true, operationId: id, action: request.action, path: target.relative, data, durationMs: performance.now() - started };
    }
    return fail(id, "OPERATION_FAILED", "Unsupported filesystem operation.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Filesystem operation failed.";
    const systemCode = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
    const code: ErrorCode = systemCode === "ENOENT" ? "PATH_NOT_FOUND" : message === "not-file" ? "NOT_A_FILE" : message === "binary" ? "BINARY_FILE" : message === "encoding" ? "INVALID_ENCODING" : message === "large" ? "FILE_TOO_LARGE" : message === "pattern" ? "PATTERN_INVALID" : message === "query" ? "QUERY_INVALID" : "OPERATION_FAILED";
    return fail(id, code, message === "not-file" ? "The path must point to a regular file." : message === "binary" ? "The file contains binary content; use binary_metadata instead." : message === "large" ? "The file exceeds the supported read limit." : message, code === "OPERATION_FAILED");
  }
}

export * from "./types.js";
