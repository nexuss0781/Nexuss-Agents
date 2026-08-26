import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { invokeLLM } from "./_core/llm";
import { getGithubCloneToken } from "./githubAuth";
import { findGithubWorkspaceProjectId } from "./paradoxWorkspace";
import { parseGithubBranch, projectWorkspacePath } from "./projectWorkspace";

const MAX_OUTPUT = 220_000;
const MAX_DIFF_PER_FILE = 120_000;
const MAX_DIFF_TOTAL = 1_500_000;
const GIT_TIMEOUT = 45_000;

export type LocalChangeStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";
export type LocalChangedFile = { path: string; status: LocalChangeStatus; additions: number; deletions: number; diff: string; binary?: boolean };
export type LocalChangesSnapshot = {
  projectId: string;
  fullName: string;
  branch: string;
  currentBranch: string;
  branchReady: boolean;
  files: LocalChangedFile[];
  additions: number;
  deletions: number;
  clean: boolean;
};

export class LocalChangesError extends Error {
  readonly code: "WORKSPACE_NOT_FOUND" | "INVALID_REPOSITORY" | "INVALID_BRANCH" | "GIT_FAILED" | "CONFIRMATION_REQUIRED" | "NO_CHANGES" | "AI_FAILED";
  constructor(message: string, code: LocalChangesError["code"] = "GIT_FAILED") { super(message); this.name = "LocalChangesError"; this.code = code; }
}

function repositoryParts(fullName: string) {
  const parts = fullName.trim().split("/");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part))) throw new LocalChangesError("Choose a valid GitHub repository.", "INVALID_REPOSITORY");
  return parts as [string, string];
}
function safeBranch(value?: string) {
  try { return parseGithubBranch(value); } catch { throw new LocalChangesError("Choose a valid branch.", "INVALID_BRANCH"); }
}
function runGit(args: string[], cwd: string, accessToken?: string, timeoutMs = GIT_TIMEOUT) {
  return new Promise<{ code: number; output: string }>((resolve, reject) => {
    const environment = accessToken ? { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${accessToken}`, "utf8").toString("base64")}` } : { ...process.env, GIT_TERMINAL_PROMPT: "0" };
    const child = spawn(process.env.NEXUSS_GIT_BINARY || "git", args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"], env: environment });
    let output = "";
    const collect = (chunk: Buffer) => { output = `${output}${chunk.toString("utf8")}`.slice(-MAX_OUTPUT); };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new LocalChangesError("The local Git operation timed out.")); }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(new LocalChangesError(error instanceof Error ? error.message.slice(0, 220) : "Git could not start.")); });
    child.once("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, output }); });
  });
}
function projectAuditPath(ownerId: string, projectId: string) { const safeId = createHash("sha256").update(projectId).digest("hex").slice(0, 48); return join(dirname(projectWorkspacePath(ownerId, projectId)), `${safeId}.audit.ndjson`); }
async function audit(ownerId: string, projectId: string, action: string, details: Record<string, unknown>) {
  const record = { id: randomUUID(), timestamp: new Date().toISOString(), ownerId, projectId, action, details };
  const path = projectAuditPath(ownerId, projectId);
  await mkdir(dirname(path), { recursive: true, mode: 0o750 });
  await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o640 });
}
async function resolveWorkspace(ownerId: string, fullName: string) {
  const [owner, repo] = repositoryParts(fullName);
  const projectId = await findGithubWorkspaceProjectId(ownerId, `${owner}/${repo}`);
  if (!projectId) throw new LocalChangesError("Import this GitHub repository into a project before managing local changes.", "WORKSPACE_NOT_FOUND");
  const root = projectWorkspacePath(ownerId, projectId);
  const workspaceStat = await stat(root).catch(() => undefined);
  if (!workspaceStat?.isDirectory()) throw new LocalChangesError("The local project workspace is not available yet.", "WORKSPACE_NOT_FOUND");
  return { projectId, root, owner, repo };
}
async function branchNames(root: string) {
  const result = await runGit(["for-each-ref", "--format=%(refname:short)", "refs/heads"], root);
  return result.code === 0 ? result.output.split(/\r?\n/).map((name) => name.trim()).filter(Boolean).slice(0, 200) : [];
}
async function currentBranch(root: string) {
  const result = await runGit(["branch", "--show-current"], root);
  if (result.code !== 0) throw new LocalChangesError("The local workspace is not on a Git branch.");
  return result.output.trim() || "HEAD";
}
export function parseLocalStatus(output: string): Array<{ path: string; status: LocalChangeStatus }> {
  return output.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean).map((line) => {
    const code = line.slice(0, 2); const rawPath = line.slice(3).trim();
    const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) || rawPath : rawPath;
    const status: LocalChangeStatus = code.includes("?") ? "untracked" : code.includes("R") ? "renamed" : code.includes("A") ? "added" : code.includes("D") ? "deleted" : "modified";
    return { path, status };
  }).filter((entry) => entry.path && !entry.path.includes("\0"));
}
async function lineCount(root: string, path: string) {
  const data = await readFile(join(root, path)).catch(() => Buffer.alloc(0));
  return data.length ? data.toString("utf8").split(/\r?\n/).length - (data.toString("utf8").endsWith("\n") ? 1 : 0) : 0;
}
async function fileDiff(root: string, entry: { path: string; status: LocalChangeStatus }) {
  const args = entry.status === "untracked" ? ["diff", "--no-index", "--no-ext-diff", "--unified=80", "--", "/dev/null", entry.path] : ["diff", "HEAD", "--no-ext-diff", "--unified=80", "--", entry.path];
  const result = await runGit(args, root);
  const diff = result.output.slice(-MAX_DIFF_PER_FILE);
  const binary = /Binary files .* differ/i.test(diff);
  if (entry.status === "untracked") return { diff, additions: await lineCount(root, entry.path), deletions: 0, binary };
  const numstat = await runGit(["diff", "HEAD", "--numstat", "--", entry.path], root);
  const [additionsRaw, deletionsRaw] = (numstat.output.trim().split(/\s+/).slice(0, 2));
  return { diff, additions: Number.isFinite(Number(additionsRaw)) ? Number(additionsRaw) : 0, deletions: Number.isFinite(Number(deletionsRaw)) ? Number(deletionsRaw) : 0, binary };
}

export async function getLocalChanges(ownerId: string, fullName: string, requestedBranch?: string): Promise<LocalChangesSnapshot> {
  const workspace = await resolveWorkspace(ownerId, fullName);
  const branch = safeBranch(requestedBranch);
  const current = await currentBranch(workspace.root);
  const statuses = parseLocalStatus((await runGit(["status", "--porcelain=v1", "-uall"], workspace.root)).output);
  let remaining = MAX_DIFF_TOTAL;
  const files: LocalChangedFile[] = [];
  for (const entry of statuses.slice(0, 500)) {
    if (remaining <= 0) break;
    const detail = await fileDiff(workspace.root, entry);
    const diff = detail.diff.slice(0, remaining); remaining -= diff.length;
    files.push({ ...entry, ...detail, diff });
  }
  return { projectId: workspace.projectId, fullName, branch: branch || current, currentBranch: current, branchReady: !branch || branch === current || (await branchNames(workspace.root)).includes(branch), files, additions: files.reduce((total, file) => total + file.additions, 0), deletions: files.reduce((total, file) => total + file.deletions, 0), clean: files.length === 0 };
}

async function switchToBranch(root: string, branch: string, accessToken: string) {
  const current = await currentBranch(root);
  if (current === branch) return;
  const local = await branchNames(root);
  if (local.includes(branch)) {
    const switched = await runGit(["switch", branch], root);
    if (switched.code !== 0) throw new LocalChangesError(`Could not switch to branch "${branch}". Commit or stash local changes first.`);
    return;
  }
  const fetched = await runGit(["fetch", "--depth=1", "origin", branch], root, accessToken);
  if (fetched.code !== 0) throw new LocalChangesError(`The branch "${branch}" could not be fetched from GitHub.`);
  const switched = await runGit(["switch", "--track", "-c", branch, `origin/${branch}`], root);
  if (switched.code !== 0) throw new LocalChangesError(`Could not create the local branch "${branch}".`);
}

export async function commitAndPushLocalChanges(ownerId: string, fullName: string, branch: string | undefined, message: string, confirmed: boolean) {
  if (!confirmed) throw new LocalChangesError("Confirm the commit and push before continuing.", "CONFIRMATION_REQUIRED");
  const cleanMessage = message.trim().replace(/\s+/g, " ").slice(0, 240);
  if (!cleanMessage) throw new LocalChangesError("Write a commit message before committing.");
  const workspace = await resolveWorkspace(ownerId, fullName);
  const targetBranch = safeBranch(branch) || await currentBranch(workspace.root);
  const accessToken = await getGithubCloneToken(ownerId);
  await switchToBranch(workspace.root, targetBranch, accessToken);
  const before = await getLocalChanges(ownerId, fullName, targetBranch);
  if (before.clean) throw new LocalChangesError("There are no local changes to commit.", "NO_CHANGES");
  await audit(ownerId, workspace.projectId, "commit_push_requested", { fullName, branch: targetBranch, message: cleanMessage, files: before.files.map((file) => file.path) });
  const staged = await runGit(["add", "--all"], workspace.root);
  if (staged.code !== 0) throw new LocalChangesError(`Git could not stage the local changes: ${staged.output.slice(-240)}`);
  const committed = await runGit(["commit", "-m", cleanMessage], workspace.root);
  if (committed.code !== 0) throw new LocalChangesError(`Git could not create the commit: ${committed.output.slice(-320)}`);
  const hashResult = await runGit(["rev-parse", "HEAD"], workspace.root);
  const commit = hashResult.output.trim().split(/\s+/)[0] || "unknown";
  const pushed = await runGit(["push", "origin", `HEAD:${targetBranch}`], workspace.root, accessToken);
  if (pushed.code !== 0) {
    await audit(ownerId, workspace.projectId, "commit_push_failed", { fullName, branch: targetBranch, commit, error: pushed.output.replaceAll(accessToken, "[redacted]").slice(-320) });
    throw new LocalChangesError(`Commit ${commit.slice(0, 8)} was created locally, but GitHub rejected the push. Review the local branch before retrying.`);
  }
  await audit(ownerId, workspace.projectId, "commit_push_completed", { fullName, branch: targetBranch, commit, files: before.files.map((file) => file.path) });
  return { fullName, branch: targetBranch, commit, files: before.files.map((file) => file.path), message: cleanMessage };
}

export async function generateLocalCommitMessage(ownerId: string, fullName: string, branch: string | undefined, model?: string) {
  const snapshot = await getLocalChanges(ownerId, fullName, branch);
  if (snapshot.clean) throw new LocalChangesError("There are no local changes to summarize.", "NO_CHANGES");
  const diff = snapshot.files.map((file) => `FILE: ${file.path}\nSTATUS: ${file.status}\nDIFF:\n${file.diff}`).join("\n\n").slice(0, MAX_DIFF_TOTAL);
  try {
    const result = await invokeLLM({ model: model?.trim() || undefined, maxTokens: 120, messages: [
      { role: "system", content: "You are Ardi, the commit-message specialist inside Nexuss-Agent. Read the supplied repository diff and produce exactly one concise imperative Git commit subject line. Use conventional commits when appropriate. Do not include quotes, markdown, a period, explanations, or more than 120 characters." },
      { role: "user", content: `Repository: ${fullName}\nBranch: ${snapshot.branch}\nChanged files: ${snapshot.files.length}\nInsertions: ${snapshot.additions}\nDeletions: ${snapshot.deletions}\n\n${diff}` },
    ] });
    const content = typeof result.choices?.[0]?.message?.content === "string" ? result.choices[0].message.content : "";
    const message = content.replace(/^```[a-z]*\s*/i, "").replace(/```$/g, "").split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.replace(/^['\"]|['\"]$/g, "").slice(0, 240);
    if (!message) throw new Error("The selected model returned no commit message.");
    await audit(ownerId, snapshot.projectId, "commit_message_generated", { fullName, branch: snapshot.branch, model: model || "default", files: snapshot.files.map((file) => file.path) });
    return { message };
  } catch (error) {
    if (error instanceof LocalChangesError) throw error;
    throw new LocalChangesError(error instanceof Error ? error.message.slice(0, 320) : "The selected model could not generate a commit message.", "AI_FAILED");
  }
}
