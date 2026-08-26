import { execFile as execFileCallback } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { CodeNavigationData, CodeSymbol, FileSystemRequest, FileSystemResult, RecentChange, TextMatch } from "./types.js";

const execFile = promisify(execFileCallback);
const MAX_FILE_BYTES = 5_000_000;
const MAX_FILES = 5_000;
const MAX_MATCHES = 5_000;
const MAX_CONTEXT = 10;

function fail<T>(operationId: string, code: "PATH_INVALID" | "PATH_OUTSIDE_PROJECT" | "PATH_NOT_FOUND" | "QUERY_INVALID" | "PATTERN_INVALID" | "LIMIT_INVALID" | "OPERATION_FAILED", message: string, retryable = false): FileSystemResult<T> {
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

function limit(value: number | undefined, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) return undefined;
  return value;
}

function globToRegExp(pattern: string) {
  if (!pattern.trim() || pattern.includes("\0")) throw new Error("pattern");
  const escaped = pattern.trim().replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesAny(value: string, patterns: string[] | undefined) {
  if (!patterns?.length) return true;
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

function excluded(value: string, patterns: string[] | undefined) {
  return patterns?.some((pattern) => globToRegExp(pattern).test(value)) ?? false;
}

function isBinary(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_192));
  if (sample.includes(0)) return true;
  let controls = 0;
  for (const byte of sample) if (byte < 7 || (byte > 14 && byte < 32)) controls += 1;
  return sample.length > 0 && controls / sample.length > 0.1;
}

function textOf(buffer: Buffer) {
  if (isBinary(buffer)) return undefined;
  const text = buffer.toString("utf8");
  if (text.includes("\uFFFD")) return undefined;
  return text;
}

async function textFiles(rootAbsolute: string, rootRelative: string, request: FileSystemRequest, maxFiles: number) {
  const files: Array<{ path: string; text: string }> = [];
  async function visit(currentAbsolute: string, currentRelative: string) {
    if (files.length >= maxFiles) return;
    const info = await lstat(currentAbsolute);
    if (info.isSymbolicLink()) return;
    if (info.isFile()) {
      if (info.size > MAX_FILE_BYTES || !matchesAny(currentRelative, request.include) || excluded(currentRelative, request.exclude)) return;
      const text = textOf(await readFile(currentAbsolute));
      if (text !== undefined) files.push({ path: currentRelative, text });
      return;
    }
    if (!info.isDirectory() || excluded(currentRelative, request.exclude)) return;
    for (const item of await readdir(currentAbsolute, { withFileTypes: true })) {
      if (files.length >= maxFiles || item.isSymbolicLink()) return;
      const childRelative = currentRelative === "." ? item.name : `${currentRelative}/${item.name}`;
      await visit(join(currentAbsolute, item.name), childRelative);
    }
  }
  await visit(rootAbsolute, rootRelative);
  return files;
}

function languageFor(path: string, requested: FileSystemRequest["language"]) {
  if (requested && requested !== "generic") return requested;
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (extension === "ts" || extension === "tsx") return "typescript";
  if (extension === "js" || extension === "jsx" || extension === "mjs" || extension === "cjs") return "javascript";
  if (extension === "py") return "python";
  if (extension === "go") return "go";
  if (extension === "rs") return "rust";
  if (extension === "java") return "java";
  return "generic";
}

function symbolsInFile(path: string, text: string, language: FileSystemRequest["language"]): CodeSymbol[] {
  const lines = text.split(/\r?\n/);
  const selected = languageFor(path, language);
  const patterns: Array<{ kind: CodeSymbol["kind"]; expression: RegExp }> = selected === "python"
    ? [
        { kind: "function", expression: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/ },
        { kind: "class", expression: /^\s*class\s+([A-Za-z_]\w*)/ },
      ]
    : selected === "go"
      ? [
          { kind: "function", expression: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/ },
          { kind: "struct", expression: /^\s*type\s+([A-Za-z_]\w*)\s+struct\b/ },
          { kind: "interface", expression: /^\s*type\s+([A-Za-z_]\w*)\s+interface\b/ },
        ]
      : selected === "rust"
        ? [
            { kind: "function", expression: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/ },
            { kind: "struct", expression: /^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)/ },
            { kind: "enum", expression: /^\s*(?:pub\s+)?enum\s+([A-Za-z_]\w*)/ },
            { kind: "trait", expression: /^\s*(?:pub\s+)?trait\s+([A-Za-z_]\w*)/ },
          ]
        : [
            { kind: "function", expression: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
            { kind: "class", expression: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/ },
            { kind: "interface", expression: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
            { kind: "type", expression: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/ },
            { kind: "variable", expression: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/ },
            { kind: "method", expression: /^\s*(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::[^=]+)?\s*\{/ },
          ];
  const output: CodeSymbol[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    for (const pattern of patterns) {
      const match = pattern.expression.exec(lines[index]);
      if (match?.[1]) {
        output.push({ name: match[1], kind: pattern.kind, path, line: index + 1, text: lines[index] });
        break;
      }
    }
  }
  return output;
}

function compileQuery(query: string, regex: boolean, caseSensitive: boolean) {
  if (!query.trim() || query.includes("\0")) throw new Error("query");
  try { return new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi"); } catch { throw new Error("query"); }
}

function referencesInFile(path: string, text: string, query: string, request: FileSystemRequest, maxMatches: number): TextMatch[] {
  const matcher = compileQuery(query, request.regex ?? false, request.caseSensitive ?? false);
  const lines = text.split(/\r?\n/);
  const context = Math.min(request.contextLines ?? 0, MAX_CONTEXT);
  const matches: TextMatch[] = [];
  for (let index = 0; index < lines.length && matches.length < maxMatches; index += 1) {
    matcher.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(lines[index])) && matches.length < maxMatches) {
      matches.push({ path, line: index + 1, column: match.index + 1, text: lines[index], query, contextBefore: context ? lines.slice(Math.max(0, index - context), index) : undefined, contextAfter: context ? lines.slice(index + 1, index + 1 + context) : undefined });
      if (match[0] === "") matcher.lastIndex += 1;
    }
  }
  return matches;
}

function parseGitStatus(output: string): RecentChange[] {
  return output.split(/\r?\n/).filter(Boolean).map((rawLine) => {
    const line = rawLine.replace(/\u001b\[[0-9;]*m/g, "");
    const status = line.slice(0, 2);
    const path = line.slice(3).replace(/^"|"$/g, "");
    const kind: RecentChange["status"] = status.includes("??") || status.includes("A") ? "added" : status.includes("D") ? "deleted" : status.includes("R") ? "renamed" : "modified";
    return { path, status: kind, source: "working-tree" };
  });
}

export async function navigateFileSystem(projectRoot: string, request: FileSystemRequest, operationId: string): Promise<FileSystemResult> {
  const started = performance.now();
  const maxFiles = limit(request.maxEntries, 500, MAX_FILES);
  const maxMatches = limit(request.maxMatches, 200, MAX_MATCHES);
  if (!maxFiles || !maxMatches) return fail(operationId, "LIMIT_INVALID", "Limits must be integers within the supported range.");
  let target: { absolute: string; relative: string };
  try { target = safePath(projectRoot, request.path); } catch (error) { return fail(operationId, error instanceof Error && error.message === "outside" ? "PATH_OUTSIDE_PROJECT" : "PATH_INVALID", "The path must remain inside the project workspace."); }
  try {
    if (request.action === "symbols") {
      const files = await textFiles(target.absolute, target.relative, request, maxFiles);
      const symbols = files.flatMap((file) => symbolsInFile(file.path, file.text, request.language)).slice(0, maxMatches);
      return { ok: true, operationId, action: request.action, path: target.relative, data: { symbols, filesScanned: files.length, truncated: symbols.length >= maxMatches || files.length >= maxFiles } satisfies CodeNavigationData, durationMs: performance.now() - started };
    }
    if (request.action === "references") {
      if (!request.query?.trim()) return fail(operationId, "QUERY_INVALID", "references requires a query.");
      const files = await textFiles(target.absolute, target.relative, request, maxFiles);
      const matches = files.flatMap((file) => referencesInFile(file.path, file.text, request.query!, request, maxMatches)).slice(0, maxMatches);
      return { ok: true, operationId, action: request.action, path: target.relative, data: { matches, filesScanned: files.length, truncated: matches.length >= maxMatches || files.length >= maxFiles } satisfies CodeNavigationData, durationMs: performance.now() - started };
    }
    if (request.action === "recent_changes") {
      const { stdout } = await execFile("git", ["-c", "color.status=false", "status", "--short", "--untracked-files=all"], { cwd: resolve(projectRoot), maxBuffer: 2_000_000 });
      const changes = parseGitStatus(stdout).slice(0, maxFiles);
      return { ok: true, operationId, action: request.action, path: target.relative, data: { changes, truncated: changes.length >= maxFiles } satisfies { changes: RecentChange[]; truncated: boolean }, durationMs: performance.now() - started };
    }
    return fail(operationId, "OPERATION_FAILED", "Unsupported code-navigation operation.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Code navigation failed.";
    const systemCode = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
    const code = message === "query" ? "QUERY_INVALID" : message === "pattern" ? "PATTERN_INVALID" : systemCode === "ENOENT" ? "PATH_NOT_FOUND" : "OPERATION_FAILED";
    return fail(operationId, code, message === "query" ? "The query is empty or not a valid regular expression." : message, code === "OPERATION_FAILED");
  }
}
