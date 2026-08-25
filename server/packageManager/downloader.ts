import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  validatePackageManifest,
  type ManifestValidationOptions,
  type NormalizedPackageManifest,
  type PackageManifest,
  type PackageValidationError,
} from "./manifest";

const execFileAsync = promisify(execFile);
const SHA256_PREFIX = "sha256-";
const DEFAULT_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_EXTRACTED_BYTES = 250 * 1024 * 1024;
const DEFAULT_MAX_FILES = 20_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ARCHIVE_ENTRIES = 30_000;

export type PackageDownloadOptions = ManifestValidationOptions & {
  stagingDirectory: string;
  maxDownloadBytes?: number;
  maxExtractedBytes?: number;
  maxFiles?: number;
  maxArchiveEntries?: number;
  timeoutMs?: number;
  allowMovingRef?: boolean;
  resolvedSourceCommit?: string;
  fetchImpl?: typeof fetch;
};

export type PackageDownloadFailure = {
  code: string;
  path: string;
  message: string;
  retryable: boolean;
};

export type PackageDownloadResult =
  | {
      ok: true;
      manifest: NormalizedPackageManifest;
      packageRoot: string;
      stagingDirectory: string;
      archiveDigest: string;
      manifestDigest: string;
      sourceCommit?: string;
    }
  | { ok: false; errors: PackageDownloadFailure[] };

function failure(code: string, pathName: string, message: string, retryable = false): PackageDownloadFailure {
  return { code, path: pathName, message, retryable };
}

function isWithin(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

function canonicalManifest(manifest: NormalizedPackageManifest) {
  const { integrity: _integrity, normalized: _normalized, ...withoutDerivedFields } = manifest;
  return JSON.stringify(stableValue(withoutDerivedFields));
}

function digestForText(value: string) {
  return createHash("sha256").update(value, "utf8").digest("base64");
}

function digestForBytes(value: Buffer) {
  return createHash("sha256").update(value).digest("base64");
}

function matchesDigest(declared: string | undefined, actualBase64: string) {
  if (!declared) return true;
  if (!declared.toLowerCase().startsWith(SHA256_PREFIX)) return false;
  const value = declared.slice(SHA256_PREFIX.length);
  return value === actualBase64 || value.toLowerCase() === Buffer.from(actualBase64, "base64").toString("hex");
}

function githubArchiveUrl(repository: string, ref: string) {
  const parsed = new URL(repository);
  const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
  return `https://codeload.${parsed.hostname}/${owner}/${repo}/tar.gz/${encodeURIComponent(ref)}`;
}

function validateArchiveEntry(entry: string) {
  const raw = entry.trim();
  if (raw === "." || raw === "./") return true;
  const trimmed = raw.replace(/^\.\//, "");
  if (!trimmed || trimmed.includes("\0") || path.posix.isAbsolute(trimmed)) return false;
  const normalized = path.posix.normalize(trimmed);
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) return false;
  return true;
}

async function validateArchive(archivePath: string, extractionPath: string, maxEntries: number, maxFiles: number, maxExtractedBytes: number): Promise<PackageDownloadFailure | undefined> {
  let listing: string;
  let details: string;
  try {
    ({ stdout: listing } = await execFileAsync("tar", ["--list", "--gzip", "--file", archivePath], { maxBuffer: 16 * 1024 * 1024 }));
    ({ stdout: details } = await execFileAsync("tar", ["--list", "--verbose", "--gzip", "--file", archivePath], { maxBuffer: 32 * 1024 * 1024 }));
  } catch {
    return failure("ARCHIVE_INVALID", "source", "Downloaded source is not a readable gzip tar archive.");
  }
  const entries = listing.split("\n").map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) return failure("ARCHIVE_EMPTY", "source", "Downloaded package archive is empty.");
  if (entries.length > maxEntries) return failure("ARCHIVE_ENTRY_LIMIT_EXCEEDED", "source", `Archive contains more than ${maxEntries} entries.`);
  if (entries.some((entry) => !validateArchiveEntry(entry))) return failure("ARCHIVE_PATH_TRAVERSAL", "source", "Archive contains an unsafe path.");
  const detailLines = details.split("\n").filter(Boolean);
  if (detailLines.some((line) => ["l", "h", "b", "c", "p", "s"].includes(line[0] || ""))) return failure("ARCHIVE_LINK_OR_SPECIAL_FILE", "source", "Archive contains a link or special file, which is not allowed.");
  try {
    await fs.mkdir(extractionPath, { recursive: true });
    await execFileAsync("tar", ["--extract", "--gzip", "--file", archivePath, "--directory", extractionPath, "--strip-components=1", "--no-same-owner", "--no-same-permissions"], { maxBuffer: 4 * 1024 * 1024 });
  } catch {
    return failure("ARCHIVE_EXTRACTION_FAILED", "source", "Package archive could not be extracted safely.");
  }
  let fileCount = 0;
  let totalBytes = 0;
  async function inspect(current: string): Promise<PackageDownloadFailure | undefined> {
    const children = await fs.readdir(current, { withFileTypes: true });
    for (const child of children) {
      const childPath = path.resolve(current, child.name);
      if (!isWithin(extractionPath, childPath)) return failure("EXTRACTION_PATH_ESCAPE", "source", "Extracted package escaped its staging directory.");
      const stat = await fs.lstat(childPath);
      if (stat.isSymbolicLink() || stat.isBlockDevice() || stat.isCharacterDevice() || stat.isSocket() || stat.isFIFO()) return failure("EXTRACTED_SPECIAL_FILE", childPath, "Extracted package contains an unsafe file type.");
      if (stat.isDirectory()) {
        const nestedFailure = await inspect(childPath);
        if (nestedFailure) return nestedFailure;
      } else if (stat.isFile()) {
        fileCount += 1;
        totalBytes += stat.size;
        if (fileCount > maxFiles) return failure("EXTRACTED_FILE_LIMIT_EXCEEDED", "source", `Package contains more than ${maxFiles} files.`);
        if (totalBytes > maxExtractedBytes) return failure("EXTRACTED_SIZE_LIMIT_EXCEEDED", "source", `Extracted package exceeds the ${maxExtractedBytes}-byte limit.`);
      }
    }
    return undefined;
  }
  return inspect(extractionPath);
}

async function downloadArchive(url: string, destination: string, maxBytes: number, timeoutMs: number, fetchImpl: typeof fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { redirect: "error", signal: controller.signal, headers: { accept: "application/vnd.github+json" } });
    if (!response.ok || !response.body) return { error: failure("DOWNLOAD_FAILED", "source", `GitHub source download returned HTTP ${response.status}.`, response.status >= 500) };
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > maxBytes) return { error: failure("DOWNLOAD_SIZE_LIMIT_EXCEEDED", "source", `Package download exceeds the ${maxBytes}-byte limit.`) };
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const buffer = Buffer.from(value);
        total += buffer.length;
        if (total > maxBytes) return { error: failure("DOWNLOAD_SIZE_LIMIT_EXCEEDED", "source", `Package download exceeds the ${maxBytes}-byte limit.`) };
        chunks.push(buffer);
      }
    } finally {
      reader.releaseLock();
    }
    const archive = Buffer.concat(chunks);
    await fs.writeFile(destination, archive, { flag: "wx", mode: 0o600 });
    return { archiveDigest: digestForBytes(archive) };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { error: failure(aborted ? "DOWNLOAD_TIMEOUT" : "DOWNLOAD_FAILED", "source", aborted ? "Package download timed out." : "Package download failed.", true) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function downloadAndVerifyPackage(manifestInput: unknown, options: PackageDownloadOptions): Promise<PackageDownloadResult> {
  const validation = validatePackageManifest(manifestInput, options);
  if (!validation.ok) return { ok: false, errors: validation.errors.map((error: PackageValidationError) => ({ code: error.code, path: error.path, message: error.message, retryable: error.retryable })) };
  const manifest = validation.manifest;
  const failures: PackageDownloadFailure[] = [];
  const ref = manifest.source.ref;
  const reproducibleRef = Boolean(ref && (/^[0-9a-f]{40}$/i.test(ref) || /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(ref)));
  if (!ref && !options.allowMovingRef) failures.push(failure("SOURCE_REF_REQUIRED", "source.ref", "A reproducible source tag or commit is required for secure installation."));
  if (ref && !reproducibleRef && !options.allowMovingRef) failures.push(failure("SOURCE_REF_NOT_REPRODUCIBLE", "source.ref", "Secure installation requires a release tag or full commit identifier."));
  const resolvedSourceCommit = options.resolvedSourceCommit || (ref && /^[0-9a-f]{40}$/i.test(ref) ? ref : undefined);
  if (manifest.integrity?.sourceCommit && resolvedSourceCommit && manifest.integrity.sourceCommit.toLowerCase() !== resolvedSourceCommit.toLowerCase()) failures.push(failure("SOURCE_COMMIT_MISMATCH", "integrity.sourceCommit", "Resolved source commit does not match the declared source commit."));
  if (manifest.integrity?.sourceCommit && !resolvedSourceCommit) failures.push(failure("SOURCE_COMMIT_UNVERIFIED", "integrity.sourceCommit", "Declared source commit could not be verified without a resolved commit."));
  const manifestDigest = digestForText(canonicalManifest(manifest));
  if (!matchesDigest(manifest.integrity?.manifestDigest, manifestDigest)) failures.push(failure("MANIFEST_DIGEST_MISMATCH", "integrity.manifestDigest", "Manifest digest does not match the normalized manifest."));
  if (failures.length) return { ok: false, errors: failures };

  const maxDownloadBytes = options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
  const maxExtractedBytes = options.maxExtractedBytes ?? DEFAULT_MAX_EXTRACTED_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxArchiveEntries = options.maxArchiveEntries ?? DEFAULT_MAX_ARCHIVE_ENTRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const stagingRoot = path.resolve(options.stagingDirectory);
  const transactionDirectory = path.resolve(stagingRoot, `.incoming-${randomUUID()}`);
  const archivePath = path.resolve(transactionDirectory, "source.tar.gz");
  const extractionPath = path.resolve(transactionDirectory, "source");
  if (!isWithin(stagingRoot, transactionDirectory) || !isWithin(stagingRoot, archivePath) || !isWithin(stagingRoot, extractionPath)) return { ok: false, errors: [failure("STAGING_PATH_INVALID", "stagingDirectory", "Staging paths must remain inside the configured staging directory.")] };
  let committed = false;
  try {
    await fs.mkdir(transactionDirectory, { recursive: true, mode: 0o700 });
    const archive = await downloadArchive(githubArchiveUrl(manifest.source.repository, ref || "HEAD"), archivePath, maxDownloadBytes, timeoutMs, fetchImpl);
    if (archive.error) return { ok: false, errors: [archive.error] };
    const archiveFailure = await validateArchive(archivePath, extractionPath, maxArchiveEntries, maxFiles, maxExtractedBytes);
    if (archiveFailure) return { ok: false, errors: [archiveFailure] };
    const packageRoot = manifest.source.subdirectory ? path.resolve(extractionPath, manifest.source.subdirectory) : extractionPath;
    if (!isWithin(extractionPath, packageRoot)) return { ok: false, errors: [failure("SOURCE_SUBDIRECTORY_INVALID", "source.subdirectory", "Package subdirectory escapes the extracted source.")] };
    const packageStat = await fs.stat(packageRoot).catch(() => undefined);
    if (!packageStat?.isDirectory()) return { ok: false, errors: [failure("SOURCE_SUBDIRECTORY_NOT_FOUND", "source.subdirectory", "Declared package subdirectory was not found in the source archive.")] };
    await fs.rm(archivePath, { force: true });
    committed = true;
    return { ok: true, manifest, packageRoot, stagingDirectory: transactionDirectory, archiveDigest: `${SHA256_PREFIX}${archive.archiveDigest}`, manifestDigest: `${SHA256_PREFIX}${manifestDigest}`, ...(resolvedSourceCommit ? { sourceCommit: resolvedSourceCommit } : {}) };
  } catch {
    return { ok: false, errors: [failure("PACKAGE_DOWNLOAD_FAILED", "source", "Package download transaction failed.", true)] };
  } finally {
    if (!committed) await fs.rm(transactionDirectory, { recursive: true, force: true });
  }
}

export async function removePackageStaging(stagingDirectory: string, packageStagingPath: string) {
  const root = path.resolve(stagingDirectory);
  const target = path.resolve(packageStagingPath);
  if (!isWithin(root, target) || target === root) throw new Error("Refusing to remove a path outside the package staging root.");
  await fs.rm(target, { recursive: true, force: true });
}
