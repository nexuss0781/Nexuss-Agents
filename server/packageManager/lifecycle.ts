import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { NormalizedPackageManifest } from "./manifest";
import type { PackageDownloadResult } from "./downloader";

export type AppLifecycleState = "installed" | "disabled" | "updating" | "uninstalled" | "failed";
export type LifecycleAction = "install" | "uninstall" | "enable" | "disable" | "update" | "rollback";
export type InstalledAppRecord = {
  appId: string;
  name: string;
  shortName: string;
  version: string;
  state: AppLifecycleState;
  packageClass: NormalizedPackageManifest["app"]["classification"];
  packageRoot?: string;
  dataRoot: string;
  sourceRepository: string;
  sourceRef?: string;
  sourceCommit?: string;
  archiveDigest: string;
  manifestDigest: string;
  installedAt?: string;
  updatedAt: string;
  disabledAt?: string;
  uninstalledAt?: string;
  failure?: { code: string; message: string };
};
export type LifecycleAuditEvent = {
  id: string;
  appId: string;
  action: LifecycleAction;
  outcome: "started" | "completed" | "failed";
  fromState?: AppLifecycleState;
  toState?: AppLifecycleState;
  version?: string;
  detail?: string;
  createdAt: string;
};
export type LifecycleStore = {
  schemaVersion: 1;
  apps: Record<string, InstalledAppRecord>;
  audit: LifecycleAuditEvent[];
};
export type LifecycleManagerOptions = {
  rootDirectory: string;
  registryFile?: string;
  auditLimit?: number;
};
export type InstallOptions = { enableOnInstall?: boolean; retainData?: boolean };
export type UninstallOptions = { removeData?: boolean };
export type LifecycleResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };
export type VerifiedPackage = Extract<PackageDownloadResult, { ok: true }>;

function now() { return new Date().toISOString(); }
function appKey(appId: string) { return `${appId.replace(/[^A-Za-z0-9._-]/g, "_")}-${createHash("sha256").update(appId).digest("hex").slice(0, 12)}`; }
function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function semverParts(version: string) { return version.replace(/^v/, "").split(".").map((part) => Number.parseInt(part.split("-")[0] || "0", 10)); }
function compareVersion(left: string, right: string) {
  const a = semverParts(left); const b = semverParts(right);
  for (let index = 0; index < 3; index += 1) { if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0); }
  return 0;
}
async function exists(directory: string) { return Boolean(await fs.stat(directory).catch(() => undefined)); }

export class AppLifecycleManager {
  private readonly rootDirectory: string;
  private readonly appsDirectory: string;
  private readonly dataDirectory: string;
  private readonly registryFile: string;
  private readonly auditLimit: number;
  private mutation: Promise<unknown> = Promise.resolve();

  constructor(options: LifecycleManagerOptions) {
    this.rootDirectory = path.resolve(options.rootDirectory);
    this.appsDirectory = path.join(this.rootDirectory, "apps");
    this.dataDirectory = path.join(this.rootDirectory, "data");
    this.registryFile = path.resolve(options.registryFile ?? path.join(this.rootDirectory, "registry.json"));
    this.auditLimit = options.auditLimit ?? 1_000;
    if (this.auditLimit < 10 || this.auditLimit > 100_000) throw new Error("auditLimit must be between 10 and 100000.");
    if (!isWithin(this.rootDirectory, this.registryFile)) throw new Error("Registry file must remain inside the lifecycle root.");
  }

  private async readStore(): Promise<LifecycleStore> {
    const raw = await fs.readFile(this.registryFile, "utf8").catch(() => undefined);
    if (!raw) return { schemaVersion: 1, apps: {}, audit: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<LifecycleStore>;
      if (parsed.schemaVersion !== 1 || typeof parsed.apps !== "object" || !parsed.apps || !Array.isArray(parsed.audit)) throw new Error("Invalid lifecycle registry.");
      return { schemaVersion: 1, apps: parsed.apps as Record<string, InstalledAppRecord>, audit: parsed.audit as LifecycleAuditEvent[] };
    } catch {
      throw new Error("Lifecycle registry is corrupt or has an unsupported schema version.");
    }
  }

  private async writeStore(store: LifecycleStore) {
    await fs.mkdir(path.dirname(this.registryFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.registryFile}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fs.rename(temporary, this.registryFile);
  }

  private async audit(store: LifecycleStore, event: Omit<LifecycleAuditEvent, "id" | "createdAt">) {
    store.audit.push({ ...event, id: randomUUID(), createdAt: now() });
    if (store.audit.length > this.auditLimit) store.audit = store.audit.slice(-this.auditLimit);
  }

  private queue<T>(operation: () => Promise<T>) {
    const next = this.mutation.then(operation, operation);
    this.mutation = next.then(() => undefined, () => undefined);
    return next;
  }

  private async promotePackage(download: VerifiedPackage, appId: string, version: string) {
    const incomingRoot = path.resolve(download.packageRoot);
    const incomingTransaction = path.resolve(download.stagingDirectory);
    if (!isWithin(incomingTransaction, incomingRoot) || incomingRoot === incomingTransaction) throw new Error("Verified package root is outside its staging transaction.");
    const destinationParent = path.join(this.appsDirectory, appKey(appId));
    const destination = path.join(destinationParent, `${version}-${randomUUID()}`);
    if (!isWithin(this.appsDirectory, destination)) throw new Error("Package destination escapes the app store root.");
    await fs.mkdir(destinationParent, { recursive: true, mode: 0o700 });
    await fs.rename(incomingRoot, destination);
    await fs.rm(incomingTransaction, { recursive: true, force: true });
    return destination;
  }

  async list(): Promise<InstalledAppRecord[]> {
    const store = await this.readStore();
    return Object.values(store.apps).sort((left, right) => left.name.localeCompare(right.name));
  }

  async get(appId: string) {
    const store = await this.readStore();
    return store.apps[appId];
  }

  async install(download: VerifiedPackage, options: InstallOptions = {}): Promise<LifecycleResult<InstalledAppRecord>> {
    return this.queue(async () => {
      const existing = await this.get(download.manifest.id);
      if (existing && existing.state !== "uninstalled") return { ok: false, code: "APP_ALREADY_INSTALLED", message: `${download.manifest.id} is already installed.` };
      const store = await this.readStore();
      const startedAt = now();
      await this.audit(store, { appId: download.manifest.id, action: "install", outcome: "started", version: download.manifest.app.version });
      try {
        const packageRoot = await this.promotePackage(download, download.manifest.id, download.manifest.app.version);
        const dataRoot = existing?.dataRoot ?? path.join(this.dataDirectory, appKey(download.manifest.id));
        await fs.mkdir(dataRoot, { recursive: true, mode: 0o700 });
        const record: InstalledAppRecord = {
          appId: download.manifest.id,
          name: download.manifest.name,
          shortName: download.manifest.shortName,
          version: download.manifest.app.version,
          state: options.enableOnInstall === false ? "disabled" : "installed",
          packageClass: download.manifest.app.classification,
          packageRoot,
          dataRoot,
          sourceRepository: download.manifest.source.repository,
          ...(download.manifest.source.ref ? { sourceRef: download.manifest.source.ref } : {}),
          ...(download.sourceCommit ? { sourceCommit: download.sourceCommit } : {}),
          archiveDigest: download.archiveDigest,
          manifestDigest: download.manifestDigest,
          installedAt: startedAt,
          updatedAt: now(),
          ...(options.enableOnInstall === false ? { disabledAt: now() } : {}),
        };
        store.apps[record.appId] = record;
        await this.audit(store, { appId: record.appId, action: "install", outcome: "completed", toState: record.state, version: record.version });
        await this.writeStore(store);
        return { ok: true, value: record };
      } catch (error) {
        await this.audit(store, { appId: download.manifest.id, action: "install", outcome: "failed", toState: "failed", version: download.manifest.app.version, detail: error instanceof Error ? error.message : "Installation failed." });
        await this.writeStore(store).catch(() => undefined);
        return { ok: false, code: "APP_INSTALL_FAILED", message: error instanceof Error ? error.message : "Installation failed." };
      }
    });
  }

  async uninstall(appId: string, options: UninstallOptions = {}): Promise<LifecycleResult<InstalledAppRecord>> {
    return this.queue(async () => {
      const store = await this.readStore();
      const record = store.apps[appId];
      if (!record || record.state === "uninstalled") return { ok: false, code: "APP_NOT_INSTALLED", message: `${appId} is not installed.` };
      await this.audit(store, { appId, action: "uninstall", outcome: "started", fromState: record.state, version: record.version });
      try {
        if (record.packageRoot && isWithin(this.appsDirectory, path.resolve(record.packageRoot))) await fs.rm(record.packageRoot, { recursive: true, force: true });
        if (options.removeData) {
          if (!isWithin(this.dataDirectory, path.resolve(record.dataRoot))) throw new Error("App data path escapes the lifecycle data root.");
          await fs.rm(record.dataRoot, { recursive: true, force: true });
        }
        const updated: InstalledAppRecord = { ...record, state: "uninstalled", packageRoot: undefined, updatedAt: now(), uninstalledAt: now() };
        store.apps[appId] = updated;
        await this.audit(store, { appId, action: "uninstall", outcome: "completed", fromState: record.state, toState: "uninstalled", version: record.version });
        await this.writeStore(store);
        return { ok: true, value: updated };
      } catch (error) {
        await this.audit(store, { appId, action: "uninstall", outcome: "failed", fromState: record.state, version: record.version, detail: error instanceof Error ? error.message : "Uninstall failed." });
        await this.writeStore(store).catch(() => undefined);
        return { ok: false, code: "APP_UNINSTALL_FAILED", message: error instanceof Error ? error.message : "Uninstall failed." };
      }
    });
  }

  async setEnabled(appId: string, enabled: boolean): Promise<LifecycleResult<InstalledAppRecord>> {
    return this.queue(async () => {
      const store = await this.readStore();
      const record = store.apps[appId];
      if (!record || record.state === "uninstalled") return { ok: false, code: "APP_NOT_INSTALLED", message: `${appId} is not installed.` };
      if (record.state === "failed" || record.state === "updating") return { ok: false, code: "APP_STATE_INVALID", message: `${appId} cannot be enabled or disabled from state ${record.state}.` };
      const nextState: AppLifecycleState = enabled ? "installed" : "disabled";
      if (record.state === nextState) return { ok: true, value: record };
      const updated = { ...record, state: nextState, updatedAt: now(), ...(enabled ? { disabledAt: undefined } : { disabledAt: now() }) };
      store.apps[appId] = updated;
      await this.audit(store, { appId, action: enabled ? "enable" : "disable", outcome: "completed", fromState: record.state, toState: nextState, version: record.version });
      await this.writeStore(store);
      return { ok: true, value: updated };
    });
  }

  async update(download: VerifiedPackage): Promise<LifecycleResult<InstalledAppRecord>> {
    return this.queue(async () => {
      const store = await this.readStore();
      const current = store.apps[download.manifest.id];
      if (!current || current.state === "uninstalled") return { ok: false, code: "APP_NOT_INSTALLED", message: `${download.manifest.id} is not installed.` };
      if (compareVersion(download.manifest.app.version, current.version) <= 0) return { ok: false, code: "APP_VERSION_NOT_NEWER", message: `Version ${download.manifest.app.version} is not newer than ${current.version}.` };
      const previousState = current.state;
      const updating = { ...current, state: "updating" as const, updatedAt: now() };
      store.apps[current.appId] = updating;
      await this.audit(store, { appId: current.appId, action: "update", outcome: "started", fromState: current.state, toState: "updating", version: download.manifest.app.version });
      await this.writeStore(store);
      let packageRoot: string | undefined;
      let backupRoot: string | undefined;
      const previousPackageRoot = current.packageRoot && isWithin(this.appsDirectory, path.resolve(current.packageRoot)) ? path.resolve(current.packageRoot) : undefined;
      try {
        if (previousPackageRoot && await exists(previousPackageRoot)) {
          backupRoot = `${previousPackageRoot}.backup-${randomUUID()}`;
          await fs.rename(previousPackageRoot, backupRoot);
        }
        packageRoot = await this.promotePackage(download, download.manifest.id, download.manifest.app.version);
        const updated: InstalledAppRecord = { ...current, name: download.manifest.name, shortName: download.manifest.shortName, version: download.manifest.app.version, state: previousState === "disabled" ? "disabled" : "installed", packageRoot, sourceRepository: download.manifest.source.repository, ...(download.manifest.source.ref ? { sourceRef: download.manifest.source.ref } : {}), ...(download.sourceCommit ? { sourceCommit: download.sourceCommit } : {}), archiveDigest: download.archiveDigest, manifestDigest: download.manifestDigest, updatedAt: now(), failure: undefined };
        store.apps[current.appId] = updated;
        await this.audit(store, { appId: current.appId, action: "update", outcome: "completed", fromState: "updating", toState: updated.state, version: updated.version });
        await this.writeStore(store);
        if (backupRoot) await fs.rm(backupRoot, { recursive: true, force: true });
        return { ok: true, value: updated };
      } catch (error) {
        if (packageRoot && isWithin(this.appsDirectory, packageRoot)) await fs.rm(packageRoot, { recursive: true, force: true }).catch(() => undefined);
        if (backupRoot && previousPackageRoot && await exists(backupRoot)) {
          await fs.rename(backupRoot, previousPackageRoot).catch(() => undefined);
        }
        store.apps[current.appId] = current;
        const detail = error instanceof Error ? error.message : "Update failed.";
        await this.audit(store, { appId: current.appId, action: "update", outcome: "failed", fromState: "updating", toState: current.state, version: download.manifest.app.version, detail });
        await this.writeStore(store).catch(() => undefined);
        return { ok: false, code: "APP_UPDATE_FAILED", message: detail };
      }
    });
  }
}
