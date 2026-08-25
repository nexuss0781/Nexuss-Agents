import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Capability, NormalizedPackageManifest, Permission } from "./manifest";

const DEFAULT_MAX_OPERATION_MS = 10_000;
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_DIRECTORY_ENTRIES = 2_000;

export type SandboxLimits = {
  maxOperationMs?: number;
  maxFileBytes?: number;
  maxDirectoryEntries?: number;
};
export type SandboxAuditEvent = {
  id: string;
  appId: string;
  operation: string;
  outcome: "started" | "completed" | "denied" | "failed" | "cancelled";
  permission?: Permission;
  capability?: Capability;
  path?: string;
  detail?: string;
  createdAt: string;
};
export type SandboxAuditSink = (event: SandboxAuditEvent) => void | Promise<void>;
export type ExternalAppGrant = {
  appId: string;
  packageRoot: string;
  workspaceRoot?: string;
  permissions: ReadonlySet<Permission>;
  capabilities: ReadonlySet<Capability>;
};
export type ExternalAppSandboxOptions = {
  manifest: NormalizedPackageManifest;
  packageRoot: string;
  workspaceRoot?: string;
  grantedPermissions?: Iterable<Permission>;
  grantedCapabilities?: Iterable<Capability>;
  limits?: SandboxLimits;
  audit?: SandboxAuditSink;
  projectContext?: () => unknown | Promise<unknown>;
};
export type SandboxFileEntry = { name: string; kind: "file" | "directory"; size?: number };
export type ExternalAppSandbox = {
  grant: ExternalAppGrant;
  hasPermission(permission: Permission): boolean;
  hasCapability(capability: Capability): boolean;
  readPackageFile(filePath: string): Promise<Buffer>;
  listPackageDirectory(directoryPath?: string): Promise<SandboxFileEntry[]>;
  readWorkspaceFile(filePath: string): Promise<Buffer>;
  writeWorkspaceFile(filePath: string, content: Uint8Array | string): Promise<void>;
  listWorkspaceDirectory(directoryPath?: string): Promise<SandboxFileEntry[]>;
  getProjectContext(): Promise<unknown>;
  reportActivity(detail: string): Promise<void>;
  runTask<T>(operation: string, task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T>;
};

export class SandboxViolationError extends Error {
  readonly code: string;
  readonly permission?: Permission;
  readonly capability?: Capability;
  constructor(code: string, message: string, permission?: Permission, capability?: Capability) {
    super(message);
    this.name = "SandboxViolationError";
    this.code = code;
    this.permission = permission;
    this.capability = capability;
  }
}

function setOf<T extends string>(values: Iterable<T> | undefined) { return new Set(values ?? []); }
function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function normalizeRequestedPath(requested: string) {
  if (typeof requested !== "string" || requested.length === 0 || requested.includes("\0") || path.isAbsolute(requested)) throw new SandboxViolationError("PATH_INVALID", "Sandbox paths must be relative and non-empty.");
  const normalized = path.normalize(requested);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) throw new SandboxViolationError("PATH_ESCAPE", "Sandbox path escapes its permitted root.");
  return normalized;
}
async function resolveConfined(root: string, requested: string, allowMissing: boolean) {
  const normalized = normalizeRequestedPath(requested || ".");
  const candidate = path.resolve(root, normalized);
  if (!isWithin(root, candidate)) throw new SandboxViolationError("PATH_ESCAPE", "Sandbox path escapes its permitted root.");
  const rootReal = await fs.realpath(root).catch(() => root);
  const existing = await fs.realpath(candidate).catch(() => undefined);
  if (existing && !isWithin(rootReal, existing)) throw new SandboxViolationError("SYMLINK_ESCAPE", "Sandbox path resolves outside its permitted root.");
  if (!existing && !allowMissing) throw new SandboxViolationError("PATH_NOT_FOUND", "Sandbox path does not exist.");
  if (!existing && allowMissing) {
    let parent = path.dirname(candidate);
    while (!isWithin(root, parent)) throw new SandboxViolationError("PATH_ESCAPE", "Sandbox path escapes its permitted root.");
    let parentReal = await fs.realpath(parent).catch(() => undefined);
    while (!parentReal && parent !== root) {
      parent = path.dirname(parent);
      parentReal = await fs.realpath(parent).catch(() => undefined);
    }
    if (parentReal && !isWithin(rootReal, parentReal)) throw new SandboxViolationError("SYMLINK_ESCAPE", "Sandbox parent resolves outside its permitted root.");
  }
  return candidate;
}
function requirePermission(grant: ExternalAppGrant, permission: Permission, operation: string, audit: SandboxAuditSink) {
  if (!grant.permissions.has(permission)) {
    void audit({ id: randomUUID(), appId: grant.appId, operation, outcome: "denied", permission, path: undefined, detail: "Permission was not granted.", createdAt: new Date().toISOString() });
    throw new SandboxViolationError("PERMISSION_DENIED", `${operation} requires ${permission}.`, permission);
  }
}
function requireCapability(grant: ExternalAppGrant, capability: Capability, operation: string, audit: SandboxAuditSink) {
  if (!grant.capabilities.has(capability)) {
    void audit({ id: randomUUID(), appId: grant.appId, operation, outcome: "denied", capability, detail: "Capability was not granted.", createdAt: new Date().toISOString() });
    throw new SandboxViolationError("CAPABILITY_DENIED", `${operation} requires ${capability}.`, undefined, capability);
  }
}
function effectivePermissions(manifest: NormalizedPackageManifest, requested: Iterable<Permission> | undefined) {
  const declared = new Set(manifest.permissions ?? []);
  const granted = setOf(requested);
  return new Set(Array.from(granted).filter((permission) => declared.has(permission)));
}
function effectiveCapabilities(manifest: NormalizedPackageManifest, requested: Iterable<Capability> | undefined) {
  const declared = new Set(manifest.capabilities ?? []);
  const granted = setOf(requested);
  return new Set(Array.from(granted).filter((capability) => declared.has(capability)));
}

export function createExternalAppGrant(options: Pick<ExternalAppSandboxOptions, "manifest" | "packageRoot" | "workspaceRoot" | "grantedPermissions" | "grantedCapabilities">): ExternalAppGrant {
  if (options.manifest.app.classification !== "external") throw new SandboxViolationError("CLASSIFICATION_NOT_EXTERNAL", "This sandbox is only for external applications.");
  const packageRoot = path.resolve(options.packageRoot);
  const workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : undefined;
  if (workspaceRoot && !isWithin(path.dirname(workspaceRoot), workspaceRoot)) throw new SandboxViolationError("WORKSPACE_ROOT_INVALID", "Workspace root is invalid.");
  return { appId: options.manifest.id, packageRoot, ...(workspaceRoot ? { workspaceRoot } : {}), permissions: effectivePermissions(options.manifest, options.grantedPermissions), capabilities: effectiveCapabilities(options.manifest, options.grantedCapabilities) };
}

export function createExternalAppSandbox(options: ExternalAppSandboxOptions): ExternalAppSandbox {
  const limits = { maxOperationMs: options.limits?.maxOperationMs ?? DEFAULT_MAX_OPERATION_MS, maxFileBytes: options.limits?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES, maxDirectoryEntries: options.limits?.maxDirectoryEntries ?? DEFAULT_MAX_DIRECTORY_ENTRIES };
  if (!Number.isInteger(limits.maxOperationMs) || limits.maxOperationMs < 1 || limits.maxOperationMs > 120_000) throw new SandboxViolationError("LIMIT_INVALID", "maxOperationMs must be between 1 and 120000.");
  if (!Number.isInteger(limits.maxFileBytes) || limits.maxFileBytes < 1 || limits.maxFileBytes > 50 * 1024 * 1024) throw new SandboxViolationError("LIMIT_INVALID", "maxFileBytes is outside the allowed range.");
  if (!Number.isInteger(limits.maxDirectoryEntries) || limits.maxDirectoryEntries < 1 || limits.maxDirectoryEntries > 20_000) throw new SandboxViolationError("LIMIT_INVALID", "maxDirectoryEntries is outside the allowed range.");
  const audit: SandboxAuditSink = options.audit ?? (() => undefined);
  const grant = createExternalAppGrant(options);
  if (grant.permissions.has("repository.write") && !grant.permissions.has("repository.read")) throw new SandboxViolationError("GRANT_INVALID", "repository.write requires repository.read.");
  if (grant.capabilities.has("repository.workspace") && !grant.permissions.has("repository.read")) throw new SandboxViolationError("GRANT_INVALID", "repository.workspace requires repository.read.");
  const requireWorkspaceRoot = (operation: string) => {
    if (!grant.workspaceRoot) throw new SandboxViolationError("WORKSPACE_UNAVAILABLE", `${operation} requires a workspace root.`);
    return grant.workspaceRoot;
  };
  const runTask = async <T>(operation: string, task: (signal: AbortSignal) => Promise<T>, parentSignal?: AbortSignal): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new SandboxViolationError("OPERATION_TIMEOUT", `${operation} exceeded the operation time limit.`)), limits.maxOperationMs);
    const abortParent = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) controller.abort(parentSignal.reason);
    else parentSignal?.addEventListener("abort", abortParent, { once: true });
    await audit({ id: randomUUID(), appId: grant.appId, operation, outcome: "started", createdAt: new Date().toISOString() });
    let abortHandler: (() => void) | undefined;
    const cancellation = new Promise<never>((_, reject) => {
      abortHandler = () => reject(controller.signal.reason ?? new SandboxViolationError("OPERATION_CANCELLED", `${operation} was cancelled.`));
      if (controller.signal.aborted) abortHandler();
      else controller.signal.addEventListener("abort", abortHandler, { once: true });
    });
    try {
      const result = await Promise.race([task(controller.signal), cancellation]);
      await audit({ id: randomUUID(), appId: grant.appId, operation, outcome: "completed", createdAt: new Date().toISOString() });
      return result;
    } catch (error) {
      const cancelled = controller.signal.aborted;
      await audit({ id: randomUUID(), appId: grant.appId, operation, outcome: cancelled ? "cancelled" : "failed", detail: error instanceof Error ? error.message : "Sandbox operation failed.", createdAt: new Date().toISOString() });
      throw error;
    } finally {
      clearTimeout(timer);
      if (abortHandler) controller.signal.removeEventListener("abort", abortHandler);
      parentSignal?.removeEventListener("abort", abortParent);
    }
  };
  const readFile = (root: string, filePath: string, operation: string, permission: Permission) => {
    requirePermission(grant, permission, operation, audit);
    requireCapability(grant, "repository.workspace", operation, audit);
    return runTask(operation, async () => {
      const resolved = await resolveConfined(root, filePath, false);
      const stat = await fs.stat(resolved);
      if (!stat.isFile()) throw new SandboxViolationError("NOT_A_FILE", "Requested path is not a regular file.");
      if (stat.size > limits.maxFileBytes) throw new SandboxViolationError("FILE_SIZE_LIMIT_EXCEEDED", `File exceeds the ${limits.maxFileBytes}-byte limit.`);
      return fs.readFile(resolved);
    });
  };
  const listDirectory = (root: string, directoryPath: string | undefined, operation: string, permission: Permission) => {
    requirePermission(grant, permission, operation, audit);
    requireCapability(grant, "repository.workspace", operation, audit);
    return runTask(operation, async () => {
      const resolved = await resolveConfined(root, directoryPath || ".", false);
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      if (entries.length > limits.maxDirectoryEntries) throw new SandboxViolationError("DIRECTORY_ENTRY_LIMIT_EXCEEDED", `Directory exceeds the ${limits.maxDirectoryEntries}-entry limit.`);
      return Promise.all(entries.map(async (entry) => {
        if (entry.isDirectory()) return { name: entry.name, kind: "directory" as const };
        const stat = await fs.lstat(path.join(resolved, entry.name));
        if (!entry.isFile()) throw new SandboxViolationError("UNSAFE_FILE_TYPE", "Directory contains a non-regular file.");
        return { name: entry.name, kind: "file" as const, size: stat.size };
      }));
    });
  };
  return {
    grant,
    hasPermission: (permission) => grant.permissions.has(permission),
    hasCapability: (capability) => grant.capabilities.has(capability),
    readPackageFile: (filePath) => {
      requireCapability(grant, "extension.storage", "readPackageFile", audit);
      return runTask("readPackageFile", async () => {
        const resolved = await resolveConfined(grant.packageRoot, filePath, false);
        const stat = await fs.stat(resolved);
        if (!stat.isFile() || stat.size > limits.maxFileBytes) throw new SandboxViolationError("FILE_SIZE_LIMIT_EXCEEDED", "Package file is invalid or exceeds the file limit.");
        return fs.readFile(resolved);
      });
    },
    listPackageDirectory: (directoryPath = ".") => {
      requireCapability(grant, "extension.storage", "listPackageDirectory", audit);
      return runTask("listPackageDirectory", async () => {
        const resolved = await resolveConfined(grant.packageRoot, directoryPath, false);
        const entries = await fs.readdir(resolved, { withFileTypes: true });
        if (entries.length > limits.maxDirectoryEntries) throw new SandboxViolationError("DIRECTORY_ENTRY_LIMIT_EXCEEDED", "Package directory exceeds the entry limit.");
        return entries.map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? "directory" as const : "file" as const }));
      });
    },
    readWorkspaceFile: (filePath) => readFile(requireWorkspaceRoot("readWorkspaceFile"), filePath, "readWorkspaceFile", "repository.read"),
    writeWorkspaceFile: (filePath, content) => {
      requirePermission(grant, "repository.write", "writeWorkspaceFile", audit);
      requireCapability(grant, "repository.workspace", "writeWorkspaceFile", audit);
      return runTask("writeWorkspaceFile", async () => {
        const root = requireWorkspaceRoot("writeWorkspaceFile");
        const resolved = await resolveConfined(root, filePath, true);
        const bytes = typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.byteLength;
        if (bytes > limits.maxFileBytes) throw new SandboxViolationError("FILE_SIZE_LIMIT_EXCEEDED", `File exceeds the ${limits.maxFileBytes}-byte limit.`);
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, content, { mode: 0o600 });
      });
    },
    listWorkspaceDirectory: (directoryPath = ".") => listDirectory(requireWorkspaceRoot("listWorkspaceDirectory"), directoryPath, "listWorkspaceDirectory", "repository.read"),
    getProjectContext: async () => {
      requirePermission(grant, "project.context.read", "getProjectContext", audit);
      if (!options.projectContext) throw new SandboxViolationError("PROJECT_CONTEXT_UNAVAILABLE", "Project context is not available to this sandbox.");
      return runTask("getProjectContext", async () => options.projectContext!());
    },
    reportActivity: async (detail) => {
      requireCapability(grant, "activity.report", "reportActivity", audit);
      if (typeof detail !== "string" || detail.trim().length === 0 || detail.length > 2_000) throw new SandboxViolationError("ACTIVITY_INVALID", "Activity detail must be a non-empty string under 2000 characters.");
      await audit({ id: randomUUID(), appId: grant.appId, operation: "reportActivity", outcome: "completed", detail: detail.trim(), createdAt: new Date().toISOString() });
    },
    runTask,
  };
}
