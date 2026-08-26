import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { diffFileSystem } from "./diff.js";
import type { FileSystemRequest, FileSystemResult, PatchExportData, SnapshotData, WorkspaceManifest, WorkspaceManifestEntry, WorkspaceVerificationData } from "./types.js";

const execFile = promisify(execFileCallback);
const SNAPSHOT_ROOT = join(resolve("/tmp"), "nexuss-file-system-snapshots");
const DEFAULT_MAX_FILES = 5_000;
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 50_000;
const MAX_BYTES = 1_000 * 1024 * 1024;
const MAX_PATCH_BYTES = 10 * 1024 * 1024;
const snapshots = new Map<string, { projectRoot: string; archivePath: string; manifest: WorkspaceManifest }>();
const manifests = new Map<string, { projectRoot: string; manifest: WorkspaceManifest }>();

type SnapshotErrorCode =
  | "PATH_INVALID"
  | "PATH_OUTSIDE_PROJECT"
  | "PATH_NOT_FOUND"
  | "LIMIT_INVALID"
  | "FILE_TOO_LARGE"
  | "CONFIRMATION_REQUIRED"
  | "SNAPSHOT_REQUIRED"
  | "SNAPSHOT_NOT_FOUND"
  | "MANIFEST_REQUIRED"
  | "MANIFEST_NOT_FOUND"
  | "WORKSPACE_MISMATCH"
  | "GIT_UNAVAILABLE"
  | "ARCHIVE_FAILED"
  | "PATCH_REQUIRED"
  | "PATCH_INVALID"
  | "PATCH_CONFLICT"
  | "OPERATION_FAILED";

function fail<T>(operationId: string, code: SnapshotErrorCode, message: string, retryable = false): FileSystemResult<T> {
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

function bounded(value: number | undefined, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) return undefined;
  return value;
}

function hash(buffer: Buffer) { return createHash("sha256").update(buffer).digest("hex"); }

function isExcludedDirectory(name: string) {
  return name === ".git" || name === "node_modules" || name === "dist" || name === "build" || name === "coverage";
}

async function collectFiles(projectRoot: string, request: FileSystemRequest) {
  const maxFiles = bounded(request.maxEntries, DEFAULT_MAX_FILES, MAX_FILES);
  const maxBytes = bounded(request.maxBytes, DEFAULT_MAX_BYTES, MAX_BYTES);
  if (!maxFiles || !maxBytes) throw new Error("limit");
  const fileLimit = maxFiles;
  const byteLimit = maxBytes;
  const root = resolve(projectRoot);
  const entries: WorkspaceManifestEntry[] = [];
  let totalBytes = 0;
  let truncated = false;
  async function visit(directory: string, relativeDirectory: string, depth: number) {
    if (entries.length >= fileLimit || totalBytes >= byteLimit) { truncated = true; return; }
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      if (entries.length >= fileLimit || totalBytes >= byteLimit) { truncated = true; return; }
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory() && isExcludedDirectory(child.name)) continue;
      const path = relativeDirectory === "." ? child.name : `${relativeDirectory}/${child.name}`;
      const absolute = join(directory, child.name);
      if (child.isDirectory()) {
        if (depth < (request.maxDepth ?? 20)) await visit(absolute, path, depth + 1);
        continue;
      }
      if (!child.isFile()) continue;
      const info = await lstat(absolute);
      if (info.size > byteLimit - totalBytes) { truncated = true; return; }
      const content = await readFile(absolute);
      totalBytes += content.byteLength;
      entries.push({ path, size: info.size, sha256: hash(content), modifiedAt: info.mtime.toISOString() });
    }
  }
  await visit(root, ".", 0);
  return { entries, totalBytes, truncated, maxFiles, maxBytes };
}

function manifestData(manifestId: string, files: WorkspaceManifestEntry[], totalBytes: number, truncated: boolean): WorkspaceManifest {
  return { manifestId, files, fileCount: files.length, totalBytes, truncated };
}

async function archiveWorkspace(projectRoot: string, manifest: WorkspaceManifest, snapshotId: string) {
  const staging = join(SNAPSHOT_ROOT, `${snapshotId}.staging`);
  const archivePath = join(SNAPSHOT_ROOT, `${snapshotId}.tar.gz`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    for (const entry of manifest.files) {
      const source = safePath(projectRoot, entry.path).absolute;
      const target = join(staging, entry.path);
      await mkdir(join(target, ".."), { recursive: true, mode: 0o700 });
      const content = await readFile(source);
      if (hash(content) !== entry.sha256) throw new Error("workspace-changed");
      await writeFile(target, content, { mode: 0o600 });
    }
    await execFile("tar", ["-czf", archivePath, "-C", staging, "."], { maxBuffer: 2_000_000 });
    const info = await stat(archivePath);
    return { archivePath, archiveBytes: info.size };
  } catch (error) {
    await rm(archivePath, { force: true }).catch(() => undefined);
    if (error instanceof Error && error.message === "workspace-changed") throw error;
    throw new Error("archive");
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function createManifest(projectRoot: string, request: FileSystemRequest) {
  const collected = await collectFiles(projectRoot, request);
  const manifestId = `manifest-${randomUUID()}`;
  const manifest = manifestData(manifestId, collected.entries, collected.totalBytes, collected.truncated);
  manifests.set(manifestId, { projectRoot: resolve(projectRoot), manifest });
  return manifest;
}

async function atomicWrite(path: string, content: Buffer) {
  const temporary = `${path}.${randomUUID()}.restore`;
  await writeFile(temporary, content, { mode: 0o600 });
  try { await rename(temporary, path); } catch (error) { await rm(temporary, { force: true }).catch(() => undefined); throw error; }
}

async function restoreSnapshot(projectRoot: string, record: { archivePath: string; manifest: WorkspaceManifest }) {
  const staging = join(SNAPSHOT_ROOT, `restore-${randomUUID()}`);
  await mkdir(staging, { recursive: true, mode: 0o700 });
  const restored: string[] = [];
  try {
    await execFile("tar", ["-xzf", record.archivePath, "-C", staging, "--no-same-owner"], { maxBuffer: 2_000_000 });
    for (const entry of record.manifest.files) {
      const source = safePath(staging, entry.path).absolute;
      const destination = safePath(projectRoot, entry.path).absolute;
      const content = await readFile(source);
      if (hash(content) !== entry.sha256) throw new Error("archive");
      await mkdir(join(destination, ".."), { recursive: true, mode: 0o700 });
      await atomicWrite(destination, content);
      restored.push(entry.path);
    }
    return restored;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function verifyWorkspace(projectRoot: string, manifest: WorkspaceManifest, request: FileSystemRequest) {
  const current = await collectFiles(projectRoot, { ...request, maxEntries: Math.max(request.maxEntries ?? 0, manifest.files.length + 1) });
  const expected = new Map(manifest.files.map((entry) => [entry.path, entry]));
  const actual = new Map(current.entries.map((entry) => [entry.path, entry]));
  const missing: string[] = [];
  const changed: string[] = [];
  const added: string[] = [];
  for (const entry of manifest.files) {
    const actualEntry = actual.get(entry.path);
    if (!actualEntry) missing.push(entry.path);
    else if (actualEntry.sha256 !== entry.sha256 || actualEntry.size !== entry.size) changed.push(entry.path);
  }
  for (const entry of current.entries) if (!expected.has(entry.path)) added.push(entry.path);
  return { missing, changed, added, fileCount: current.entries.length, verified: missing.length === 0 && changed.length === 0 && added.length === 0 && !current.truncated };
}

async function exportPatch(projectRoot: string, request: FileSystemRequest) {
  try {
    const { stdout } = await execFile("git", ["-c", "color.ui=false", "diff", "--binary", "--no-ext-diff", "--", ...(request.paths ?? [])], { cwd: resolve(projectRoot), maxBuffer: MAX_PATCH_BYTES });
    const patch = stdout;
    const files = new Set<string>();
    let additions = 0;
    let deletions = 0;
    for (const line of patch.split(/\r?\n/)) {
      if (line.startsWith("+++ ") || line.startsWith("--- ")) {
        const candidate = line.slice(4).split("\t")[0].replace(/^(?:a|b)\//, "");
        if (candidate !== "/dev/null") files.add(candidate);
      } else if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
    }
    return { patch, files: [...files], additions, deletions };
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("git-unavailable");
    throw new Error("git-failed");
  }
}

export async function snapshotFileSystem(projectRoot: string, request: FileSystemRequest, operationId: string): Promise<FileSystemResult> {
  const started = performance.now();
  try {
    const rootInfo = await lstat(resolve(projectRoot));
    if (!rootInfo.isDirectory()) return fail(operationId, "PATH_NOT_FOUND", "The workspace directory was not found.");
    if (request.action === "manifest") {
      const manifest = await createManifest(projectRoot, request);
      return { ok: true, operationId, action: request.action, path: ".", data: manifest, durationMs: performance.now() - started };
    }
    if (request.action === "snapshot") {
      const manifest = await createManifest(projectRoot, request);
      const snapshotId = `snapshot-${randomUUID()}`;
      const archive = await archiveWorkspace(projectRoot, manifest, snapshotId);
      snapshots.set(snapshotId, { projectRoot: resolve(projectRoot), archivePath: archive.archivePath, manifest });
      return { ok: true, operationId, action: request.action, path: ".", data: { snapshotId, manifestId: manifest.manifestId, archiveBytes: archive.archiveBytes, fileCount: manifest.fileCount, totalBytes: manifest.totalBytes } satisfies SnapshotData, durationMs: performance.now() - started };
    }
    if (request.action === "restore_snapshot") {
      if (!request.confirmed) return fail(operationId, "CONFIRMATION_REQUIRED", "Restoring a snapshot can overwrite files; confirmed: true is required.");
      if (!request.snapshotId) return fail(operationId, "SNAPSHOT_REQUIRED", "snapshotId is required.");
      const record = snapshots.get(request.snapshotId);
      if (!record || record.projectRoot !== resolve(projectRoot)) return fail(operationId, "SNAPSHOT_NOT_FOUND", "The snapshot was not found for this project.");
      const restoredPaths = await restoreSnapshot(projectRoot, record);
      return { ok: true, operationId, action: request.action, path: ".", data: { restored: true, snapshotId: request.snapshotId, restoredPaths, fileCount: restoredPaths.length }, durationMs: performance.now() - started };
    }
    if (request.action === "export_patch") {
      const exported = await exportPatch(projectRoot, request);
      return { ok: true, operationId, action: request.action, path: request.path ?? ".", data: { exported: true, valid: true, ...exported }, durationMs: performance.now() - started } satisfies FileSystemResult<PatchExportData>;
    }
    if (request.action === "import_patch") {
      if (!request.patchText?.trim()) return fail(operationId, "PATCH_REQUIRED", "patchText is required.");
      const result = await diffFileSystem(projectRoot, { ...request, action: "apply_patch" }, operationId);
      return result.ok ? { ...result, action: request.action } : result;
    }
    if (request.action === "verify_workspace") {
      if (!request.manifestId) return fail(operationId, "MANIFEST_REQUIRED", "manifestId is required.");
      const record = manifests.get(request.manifestId);
      if (!record || record.projectRoot !== resolve(projectRoot)) return fail(operationId, "MANIFEST_NOT_FOUND", "The manifest was not found for this project.");
      const verification = await verifyWorkspace(projectRoot, record.manifest, request);
      return { ok: true, operationId, action: request.action, path: ".", data: { manifestId: request.manifestId, ...verification } satisfies WorkspaceVerificationData, durationMs: performance.now() - started };
    }
    return fail(operationId, "OPERATION_FAILED", "Unsupported workspace snapshot operation.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workspace operation failed.";
    const code: SnapshotErrorCode = message === "invalid" ? "PATH_INVALID" : message === "outside" ? "PATH_OUTSIDE_PROJECT" : message === "limit" ? "LIMIT_INVALID" : message === "archive" ? "ARCHIVE_FAILED" : message === "workspace-changed" ? "WORKSPACE_MISMATCH" : message === "git-unavailable" ? "GIT_UNAVAILABLE" : message === "git-failed" ? "PATCH_CONFLICT" : message === "ENOENT" ? "PATH_NOT_FOUND" : "OPERATION_FAILED";
    return fail(operationId, code, code === "ARCHIVE_FAILED" ? "The workspace snapshot could not be archived." : code === "WORKSPACE_MISMATCH" ? "The workspace changed while the snapshot was being created." : code === "PATCH_CONFLICT" ? "The patch could not be exported from the current Git workspace." : message, code === "ARCHIVE_FAILED" || code === "WORKSPACE_MISMATCH" || code === "PATCH_CONFLICT");
  }
}
