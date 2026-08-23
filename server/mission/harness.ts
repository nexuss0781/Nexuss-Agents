import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";

export type RepositoryCommandResult = {
  program: string;
  args: string[];
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
};

export type FileWriteOperation = { path: string; content: string };

const MAX_OUTPUT = 24_000;
const MAX_FILE_BYTES = 512_000;
const COMMAND_TIMEOUT_MS = 120_000;
const allowedScripts = new Set(["check", "test", "build"]);
const allowedGitCommands = new Set(["status", "diff", "ls-files", "branch"]);

function bounded(value: string) { return value.length > MAX_OUTPUT ? `${value.slice(0, MAX_OUTPUT)}\n[output truncated]` : value; }

export function repositoryRoot() {
  return resolve(process.env.NEXUSS_REPOSITORY_ROOT || process.cwd());
}

export function safeRepositoryPath(root: string, input: string) {
  if (!input || input.includes("\0") || input.startsWith("/") || input.startsWith("\\")) throw new Error("Repository path must be relative");
  const normalized = resolve(root, input);
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`;
  if (normalized !== root && !normalized.startsWith(rootWithSeparator)) throw new Error("Repository path escapes the mission workspace");
  const lower = normalized.toLowerCase();
  if (lower.includes(`${sep}.git${sep}`) || lower.endsWith(`${sep}.git`) || /(^|[\\/])\.env(?:\.|$)/i.test(input) || /\.(?:pem|key|p12|pfx)$/i.test(input)) throw new Error("Repository path is restricted");
  return normalized;
}

function assertAllowedCommand(program: string, args: readonly string[]) {
  const base = program.split(/[\\/]/).pop() || program;
  if (!["pnpm", "npm", "yarn", "git"].includes(base)) throw new Error(`Command is not allowlisted: ${base}`);
  if (base === "git" && !allowedGitCommands.has(args[0] || "")) throw new Error(`Git command is not allowlisted: ${args[0] || ""}`);
  if (["pnpm", "npm", "yarn"].includes(base) && !allowedScripts.has(args[0] || "")) throw new Error(`Package script is not allowlisted: ${args[0] || ""}`);
  if (args.some((arg) => arg.length > 512 || /(?:^|\s)(?:--config|--prefix|--global|install|add|remove|publish|deploy|exec)(?:\s|$)/i.test(arg))) throw new Error("Command argument is restricted");
}

export async function runRepositoryCommand(root: string, program: string, args: readonly string[], signal: AbortSignal, timeoutMs = COMMAND_TIMEOUT_MS): Promise<RepositoryCommandResult> {
  assertAllowedCommand(program, args);
  const startedAt = Date.now();
  return new Promise((resolveResult, reject) => {
    const child = spawn(program, [...args], { cwd: root, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = signal.aborted;
    let settled = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMs);
    const cancel = () => { cancelled = true; child.kill("SIGTERM"); };
    signal.addEventListener("abort", cancel, { once: true });
    child.stdout.on("data", (chunk: Buffer | string) => { stdout = bounded(`${stdout}${chunk.toString()}`); });
    child.stderr.on("data", (chunk: Buffer | string) => { stderr = bounded(`${stderr}${chunk.toString()}`); });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      reject(error);
    });
    child.once("close", (exitCode, closeSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      resolveResult({ program, args: [...args], exitCode, signal: closeSignal, stdout, stderr, durationMs: Date.now() - startedAt, timedOut, cancelled });
    });
  });
}

export async function readRepositoryFile(root: string, input: string) {
  const path = safeRepositoryPath(root, input);
  const content = await readFile(path, "utf8");
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw new Error("Repository file exceeds the 512KB inspection limit");
  return { path: input, content };
}

export async function applyRepositoryWrites(root: string, operations: FileWriteOperation[]) {
  if (operations.length > 20) throw new Error("Repository change exceeds the 20-file write limit");
  const applied: string[] = [];
  for (const operation of operations) {
    if (typeof operation.path !== "string" || typeof operation.content !== "string") throw new Error("Invalid repository write operation");
    const path = safeRepositoryPath(root, operation.path);
    if (Buffer.byteLength(operation.content, "utf8") > MAX_FILE_BYTES) throw new Error("Repository file write exceeds the 512KB limit");
    await writeFile(path, operation.content, "utf8");
    applied.push(relative(root, path));
  }
  return applied;
}

export async function collectRepositorySnapshot(root: string, signal: AbortSignal) {
  const [status, files] = await Promise.all([
    runRepositoryCommand(root, "git", ["status", "--short", "--branch"], signal),
    runRepositoryCommand(root, "git", ["ls-files"], signal),
  ]);
  let packageJson = "";
  try { packageJson = (await readRepositoryFile(root, "package.json")).content; } catch { packageJson = "package.json unavailable"; }
  return { status: status.stdout, trackedFiles: files.stdout.split(/\r?\n/).filter(Boolean).slice(0, 500), packageJson: bounded(packageJson) };
}
