import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import type { Express, Request, Response } from "express";
import Busboy from "busboy";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { WorkspaceAccessError, withWorkspaceDb } from "./paradoxWorkspace";
import { getNexussSession } from "./nexussAuth";

export const MAX_PROJECT_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PROJECT_TOTAL_BYTES = 500 * 1024 * 1024;
export const MAX_PROJECT_FILES = 20_000;
export const MAX_GITHUB_CLONE_OUTPUT = 128 * 1024;
export const MAX_GITHUB_CLONE_SECONDS = 120;

export type ProjectImportResult = {
  projectId: string;
  fileCount: number;
  totalBytes: number;
  sourceCommit?: string;
};

export class ProjectWorkspaceError extends Error {
  readonly code: "INVALID_PATH" | "TOO_LARGE" | "INVALID_GITHUB_URL" | "CLONE_FAILED" | "STORAGE_NOT_CONFIGURED";
  constructor(message: string, code: ProjectWorkspaceError["code"] = "STORAGE_NOT_CONFIGURED") {
    super(message);
    this.name = "ProjectWorkspaceError";
    this.code = code;
  }
}

function projectRoot() {
  const configured = process.env.NEXUSS_PROJECTS_ROOT?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") throw new ProjectWorkspaceError("Project storage is not configured on this server.", "STORAGE_NOT_CONFIGURED");
    return resolve(join(process.cwd(), "Projects"));
  }
  return resolve(configured);
}

function safeSegment(value: string) {
  if (!value.trim()) throw new ProjectWorkspaceError("The project storage identity is invalid.", "INVALID_PATH");
  return createHash("sha256").update(value).digest("hex").slice(0, 48);
}

function assertContained(root: string, candidate: string) {
  const relativePath = relative(root, candidate);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || relativePath.includes(`..${sep}`) || resolve(candidate) !== candidate) {
    throw new ProjectWorkspaceError("The project path is invalid.", "INVALID_PATH");
  }
}

export function projectWorkspacePath(ownerId: string, projectId: string) {
  const root = projectRoot();
  const ownerRoot = resolve(root, safeSegment(ownerId));
  const workspace = resolve(ownerRoot, safeSegment(projectId));
  assertContained(root, workspace);
  return workspace;
}

function normalizedRelativePath(input: string) {
  const value = input.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!value || value.includes("\0")) throw new ProjectWorkspaceError("A project file has an invalid path.", "INVALID_PATH");
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\0"))) throw new ProjectWorkspaceError("A project file has an invalid path.", "INVALID_PATH");
  if (parts.some((part) => part === ".git" || part === ".gitignore" && parts.length === 1)) throw new ProjectWorkspaceError("Git metadata is not accepted during import.", "INVALID_PATH");
  return parts.join("/");
}

async function assertNoSymlinkEscape(root: string, candidate: string) {
  let current = candidate;
  while (current !== root && current.startsWith(`${root}${sep}`)) {
    const stat = await fs.lstat(current).catch(() => undefined);
    if (stat?.isSymbolicLink()) throw new ProjectWorkspaceError("Symbolic links are not accepted in an imported codebase.", "INVALID_PATH");
    current = dirname(current);
  }
}

async function ensureProjectOwner(ownerId: string, projectId: string) {
  await withWorkspaceDb(false, (db) => {
    const result = db.execute("SELECT id FROM workspace_projects WHERE id = ? AND owner_id = ? LIMIT 1", [projectId, ownerId]);
    if (!result.rows.length) throw new WorkspaceAccessError("Project not found");
  });
}

async function ensureWorkspaceReady(root: string) {
  await fs.mkdir(root, { recursive: true, mode: 0o750 });
  await assertNoSymlinkEscape(resolve(root), resolve(root));
}

async function writeSafely(root: string, relativePath: string, data: Buffer) {
  const safePath = normalizedRelativePath(relativePath);
  const target = resolve(root, safePath);
  assertContained(root, target);
  await assertNoSymlinkEscape(root, target);
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o750 });
  await assertNoSymlinkEscape(root, dirname(target));
  await fs.writeFile(target, data, { flag: "w", mode: 0o640 });
  return safePath;
}

async function summarizeWorkspace(root: string) {
  let fileCount = 0;
  let totalBytes = 0;
  async function visit(directory: string) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new ProjectWorkspaceError("Symbolic links are not accepted in an imported codebase.", "INVALID_PATH");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const size = (await fs.stat(path)).size;
        fileCount += 1;
        totalBytes += size;
        if (fileCount > MAX_PROJECT_FILES || totalBytes > MAX_PROJECT_TOTAL_BYTES) throw new ProjectWorkspaceError("The codebase exceeds the import limits.", "TOO_LARGE");
      }
    }
  }
  await visit(root);
  return { fileCount, totalBytes };
}

async function updateProjectImport(ownerId: string, projectId: string, status: "ready" | "failed", result?: { sourceUrl?: string; sourceCommit?: string; fileCount?: number; totalBytes?: number; error?: string }) {
  await withWorkspaceDb(true, (db) => {
    const timestamp = new Date().toISOString();
    const changes = db.execute("UPDATE workspace_projects SET source_url = COALESCE(?, source_url), source_commit = COALESCE(?, source_commit), workspace_status = ?, workspace_file_count = COALESCE(?, workspace_file_count), workspace_bytes = COALESCE(?, workspace_bytes), workspace_updated_at = ?, workspace_error = ?, updated_at = ? WHERE id = ? AND owner_id = ?", [result?.sourceUrl || null, result?.sourceCommit || null, status, result?.fileCount ?? null, result?.totalBytes ?? null, timestamp, result?.error?.slice(0, 320) || null, timestamp, projectId, ownerId]);
    if (!changes.changes) throw new WorkspaceAccessError("Project not found");
  });
}

export async function importProjectFile(ownerId: string, projectId: string, input: { relativePath: string; data: Buffer }) {
  await ensureProjectOwner(ownerId, projectId);
  if (input.data.length === 0) throw new ProjectWorkspaceError("Empty project files are not accepted.", "TOO_LARGE");
  if (input.data.length > MAX_PROJECT_FILE_BYTES) throw new ProjectWorkspaceError("A project file exceeds the 25 MB limit.", "TOO_LARGE");
  const root = projectWorkspacePath(ownerId, projectId);
  await ensureWorkspaceReady(root);
  const storedPath = await writeSafely(root, input.relativePath, input.data);
  const summary = await summarizeWorkspace(root);
  if (summary.totalBytes > MAX_PROJECT_TOTAL_BYTES || summary.fileCount > MAX_PROJECT_FILES) {
    await fs.rm(resolve(root, storedPath), { force: true });
    throw new ProjectWorkspaceError("The codebase exceeds the import limits.", "TOO_LARGE");
  }
  await updateProjectImport(ownerId, projectId, "ready", summary);
  return { projectId, relativePath: storedPath, ...summary };
}

export function parsePublicGithubUrl(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new ProjectWorkspaceError("Paste a valid public GitHub repository URL.", "INVALID_GITHUB_URL"); }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.username || url.password || url.search || url.hash) throw new ProjectWorkspaceError("Use a public https://github.com/owner/repository URL.", "INVALID_GITHUB_URL");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || !/^[A-Za-z0-9_.-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+(?:\.git)?$/.test(parts[1])) throw new ProjectWorkspaceError("Use a public https://github.com/owner/repository URL.", "INVALID_GITHUB_URL");
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!owner || !repo || repo === "." || repo === "..") throw new ProjectWorkspaceError("Use a public https://github.com/owner/repository URL.", "INVALID_GITHUB_URL");
  return { normalizedUrl: `https://github.com/${owner}/${repo}.git`, owner, repo };
}

function runGit(args: string[], cwd: string, timeoutMs: number, accessToken?: string) {
  return new Promise<{ code: number; output: string }>((resolvePromise, reject) => {
    const environment = accessToken ? {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `Authorization: bearer ${accessToken}`,
    } : process.env;
    const child = spawn("git", args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"], env: environment });
    let output = "";
    const append = (chunk: Buffer) => { output = `${output}${chunk.toString("utf8")}`.slice(-MAX_GITHUB_CLONE_OUTPUT); };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new ProjectWorkspaceError("GitHub clone timed out.", "CLONE_FAILED")); }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(new ProjectWorkspaceError(`GitHub clone could not start: ${error.message.slice(0, 160)}`, "CLONE_FAILED")); });
    child.once("close", (code) => { clearTimeout(timer); resolvePromise({ code: code ?? 1, output }); });
  });
}

export async function clonePublicGithubProject(ownerId: string, projectId: string, inputUrl: string, accessToken?: string): Promise<ProjectImportResult> {
  await ensureProjectOwner(ownerId, projectId);
  const github = parsePublicGithubUrl(inputUrl);
  const finalRoot = projectWorkspacePath(ownerId, projectId);
  const parent = dirname(finalRoot);
  await ensureWorkspaceReady(parent);
  const staging = join(parent, `.import-${projectId}-${randomUUID()}`);
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true, mode: 0o750 });
  try {
    const result = await runGit(["clone", "--depth=1", "--no-tags", "--single-branch", github.normalizedUrl, staging], parent, MAX_GITHUB_CLONE_SECONDS * 1_000, accessToken);
    if (result.code !== 0) throw new ProjectWorkspaceError("GitHub could not be cloned. Check that the repository is public and the URL is correct.", "CLONE_FAILED");
    const summary = await summarizeWorkspace(staging);
    const commit = await runGit(["rev-parse", "HEAD"], staging, 10_000);
    const sourceCommit = commit.code === 0 ? commit.output.trim().split(/\s+/)[0]?.slice(0, 64) : undefined;
    await fs.rm(finalRoot, { recursive: true, force: true });
    await fs.rename(staging, finalRoot);
    await updateProjectImport(ownerId, projectId, "ready", { sourceUrl: `https://github.com/${github.owner}/${github.repo}`, sourceCommit, ...summary });
    return { projectId, sourceCommit, ...summary };
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    const safeMessage = error instanceof ProjectWorkspaceError ? error.message : "GitHub clone failed.";
    await updateProjectImport(ownerId, projectId, "failed", { sourceUrl: `https://github.com/${github.owner}/${github.repo}`, error: safeMessage }).catch(() => undefined);
    throw error instanceof ProjectWorkspaceError ? error : new ProjectWorkspaceError(safeMessage, "CLONE_FAILED");
  }
}

export async function markProjectImportFailed(ownerId: string, projectId: string, error: unknown) {
  const message = error instanceof ProjectWorkspaceError ? error.message : "Project import failed.";
  await updateProjectImport(ownerId, projectId, "failed", { error: message });
}

export function projectWorkspaceConfig(environment: NodeJS.ProcessEnv = process.env) {
  const configuredRoot = environment.NEXUSS_PROJECTS_ROOT?.trim();
  return { configured: Boolean(configuredRoot), root: configuredRoot || join(process.cwd(), "Projects") };
}

export function registerProjectWorkspaceUploadRoute(app: Express) {
  app.post("/api/workspace/projects/upload", async (req: Request, res: Response) => {
    const user = await getNexussSession(req);
    if (!user?.id) { res.status(401).json({ error: "Sign in to import a project." }); return; }
    const contentType = req.headers["content-type"];
    if (typeof contentType !== "string" || !/^multipart\/form-data\s*;/i.test(contentType)) { res.status(415).json({ error: "Use multipart form data for project files." }); return; }
    const fields: Record<string, string> = {};
    let fileName = "project-file";
    let fileBytes = 0;
    let fileSeen = false;
    let tooLarge = false;
    let parseError: Error | undefined;
    const chunks: Buffer[] = [];
    await new Promise<void>((resolvePromise) => {
      const parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_PROJECT_FILE_BYTES, fields: 3, parts: 4 } });
      parser.on("field", (name, value) => { fields[name] = value.slice(0, 1_000); });
      parser.on("file", (_name, file, info) => {
        fileSeen = true;
        fileName = info.filename || fileName;
        file.on("data", (chunk: Buffer) => { fileBytes += chunk.length; chunks.push(chunk); });
        file.on("limit", () => { tooLarge = true; });
        file.on("error", (error) => { parseError = error; });
      });
      parser.on("filesLimit", () => { parseError = new Error("Only one project file can be uploaded per request"); });
      parser.on("partsLimit", () => { parseError = new Error("Project upload contains too many parts"); });
      parser.on("error", (error) => { parseError = error instanceof Error ? error : new Error("Project upload could not be read"); resolvePromise(); });
      parser.on("finish", () => resolvePromise());
      req.pipe(parser);
    });
    if (parseError) { res.status(400).json({ error: "Project file could not be read." }); return; }
    if (tooLarge || fileBytes > MAX_PROJECT_FILE_BYTES) { res.status(413).json({ error: "A project file exceeds the 25 MB limit." }); return; }
    if (!fileSeen || fileBytes === 0) { res.status(400).json({ error: "Choose a non-empty project file." }); return; }
    const projectId = fields.projectId?.trim();
    if (!projectId) { res.status(400).json({ error: "A project is required for this upload." }); return; }
    try {
      const result = await importProjectFile(user.id, projectId, { relativePath: fields.relativePath?.trim() || fileName, data: Buffer.concat(chunks) });
      res.status(201).json({ result });
    } catch (error) {
      if (error instanceof WorkspaceAccessError) { res.status(404).json({ error: error.message }); return; }
      if (error instanceof ProjectWorkspaceError) { res.status(error.code === "TOO_LARGE" ? 413 : 400).json({ error: error.message }); return; }
      console.error("[ProjectWorkspaceUpload] upload failed", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Project file could not be stored." });
    }
  });
}
