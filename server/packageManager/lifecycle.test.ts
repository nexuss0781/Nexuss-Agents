import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppLifecycleManager, type VerifiedPackage } from "./lifecycle";
import { validatePackageManifest } from "./manifest";

async function makeVerifiedPackage(root: string, version: string, id = "external.example"): Promise<VerifiedPackage> {
  const transaction = await fs.mkdtemp(path.join(root, `.incoming-${version.replace(/[^0-9]/g, "")}-`));
  const packageRoot = path.join(transaction, "source");
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.writeFile(path.join(packageRoot, "entrypoint.js"), `export const version = ${JSON.stringify(version)};`);
  const result = validatePackageManifest({
    schemaVersion: 1,
    manifestVersion: "1.0.0",
    kind: "nexuss.application",
    id,
    name: "External Example",
    shortName: "Example",
    app: {
      version,
      icon: { kind: "asset", value: "assets/icon.svg", alt: "Example" },
      publisher: { id: "example", name: "Example Publisher" },
      classification: "external",
    },
    source: { type: "github", repository: "https://github.com/example/example", ref: `v${version}` },
    launch: { surface: "right-window", entrypoint: "entrypoint", defaultWidth: 420, minWidth: 320 },
    permissions: ["repository.read"],
    capabilities: ["repository.workspace"],
  });
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join("; "));
  return { ok: true, manifest: result.manifest, packageRoot, stagingDirectory: transaction, archiveDigest: `sha256-archive-${version}`, manifestDigest: `sha256-manifest-${version}` };
}

describe("Axolotl Store app lifecycle manager", () => {
  it("installs a verified package atomically and prevents duplicate installation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nexuss-lifecycle-"));
    const manager = new AppLifecycleManager({ rootDirectory: root });
    const packageResult = await makeVerifiedPackage(root, "1.0.0");
    const installed = await manager.install(packageResult);
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;
    expect(installed.value.state).toBe("installed");
    expect(await fs.readFile(path.join(installed.value.packageRoot!, "entrypoint.js"), "utf8")).toContain("1.0.0");
    const duplicate = await manager.install(await makeVerifiedPackage(root, "1.0.0"));
    expect(duplicate).toMatchObject({ ok: false, code: "APP_ALREADY_INSTALLED" });
    await fs.rm(root, { recursive: true, force: true });
  });

  it("enables and disables without deleting the installed package or data", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nexuss-lifecycle-"));
    const manager = new AppLifecycleManager({ rootDirectory: root });
    const installed = await manager.install(await makeVerifiedPackage(root, "1.0.0"));
    if (!installed.ok) throw new Error("install failed");
    await fs.writeFile(path.join(installed.value.dataRoot, "preferences.json"), "{}", { mode: 0o600 });
    const disabled = await manager.setEnabled(installed.value.appId, false);
    expect(disabled).toMatchObject({ ok: true, value: { state: "disabled" } });
    expect(await fs.stat(installed.value.packageRoot!)).toBeTruthy();
    expect(await fs.readFile(path.join(installed.value.dataRoot, "preferences.json"), "utf8")).toBe("{}");
    const enabled = await manager.setEnabled(installed.value.appId, true);
    expect(enabled).toMatchObject({ ok: true, value: { state: "installed" } });
    await fs.rm(root, { recursive: true, force: true });
  });

  it("retains data by default and removes it only when explicitly requested", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nexuss-lifecycle-"));
    const manager = new AppLifecycleManager({ rootDirectory: root });
    const installed = await manager.install(await makeVerifiedPackage(root, "1.0.0"));
    if (!installed.ok) throw new Error("install failed");
    await fs.writeFile(path.join(installed.value.dataRoot, "keep.txt"), "keep");
    const removed = await manager.uninstall(installed.value.appId);
    expect(removed).toMatchObject({ ok: true, value: { state: "uninstalled" } });
    expect(await fs.readFile(path.join(installed.value.dataRoot, "keep.txt"), "utf8")).toBe("keep");
    const reinstalled = await manager.install(await makeVerifiedPackage(root, "1.0.0"));
    expect(reinstalled).toMatchObject({ ok: true, value: { state: "installed" } });
    const removedData = await manager.uninstall(installed.value.appId, { removeData: true });
    expect(removedData).toMatchObject({ ok: true, value: { state: "uninstalled" } });
    expect(await fs.stat(installed.value.dataRoot).catch(() => undefined)).toBeUndefined();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("updates to a newer version and preserves disabled state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nexuss-lifecycle-"));
    const manager = new AppLifecycleManager({ rootDirectory: root });
    const first = await manager.install(await makeVerifiedPackage(root, "1.0.0"));
    if (!first.ok) throw new Error("install failed");
    await manager.setEnabled(first.value.appId, false);
    const update = await manager.update(await makeVerifiedPackage(root, "1.1.0"));
    expect(update).toMatchObject({ ok: true, value: { version: "1.1.0", state: "disabled" } });
    if (update.ok) expect(await fs.readFile(path.join(update.value.packageRoot!, "entrypoint.js"), "utf8")).toContain("1.1.0");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("rejects a non-newer update without changing the installed record", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nexuss-lifecycle-"));
    const manager = new AppLifecycleManager({ rootDirectory: root });
    const first = await manager.install(await makeVerifiedPackage(root, "1.0.0"));
    if (!first.ok) throw new Error("install failed");
    const update = await manager.update(await makeVerifiedPackage(root, "1.0.0"));
    expect(update).toMatchObject({ ok: false, code: "APP_VERSION_NOT_NEWER" });
    expect((await manager.get(first.value.appId))?.version).toBe("1.0.0");
    await fs.rm(root, { recursive: true, force: true });
  });
});
