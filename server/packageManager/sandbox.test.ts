import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createExternalAppSandbox, SandboxViolationError } from "./sandbox";
import { validatePackageManifest } from "./manifest";

function makeManifest() {
  const result = validatePackageManifest({
    schemaVersion: 1,
    manifestVersion: "1.0.0",
    kind: "nexuss.application",
    id: "external.example",
    name: "External Example",
    shortName: "Example",
    app: {
      version: "1.0.0",
      icon: { kind: "asset", value: "assets/icon.svg", alt: "Example" },
      publisher: { id: "example", name: "Example Publisher" },
      classification: "external",
    },
    source: { type: "github", repository: "https://github.com/example/example", ref: "v1.0.0" },
    launch: { surface: "right-window", entrypoint: "app", defaultWidth: 420, minWidth: 320 },
    permissions: ["repository.read", "repository.write", "project.context.read"],
    capabilities: ["repository.workspace", "extension.storage", "activity.report"],
  });
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join("; "));
  return result.manifest;
}

async function makeRoots() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nexuss-sandbox-"));
  const packageRoot = path.join(root, "package");
  const workspaceRoot = path.join(root, "workspace");
  await fs.mkdir(path.join(packageRoot, "assets"), { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(path.join(packageRoot, "settings.json"), "{}", { mode: 0o600 });
  await fs.writeFile(path.join(workspaceRoot, "README.md"), "hello", { mode: 0o600 });
  return { root, packageRoot, workspaceRoot };
}

describe("external app sandbox", () => {
  it("narrows effective grants to declared permissions and capabilities", async () => {
    const roots = await makeRoots();
    const sandbox = createExternalAppSandbox({ manifest: makeManifest(), packageRoot: roots.packageRoot, workspaceRoot: roots.workspaceRoot, grantedPermissions: ["repository.read", "repository.write"], grantedCapabilities: ["repository.workspace"] });
    expect(sandbox.hasPermission("repository.read")).toBe(true);
    expect(sandbox.hasPermission("project.context.read")).toBe(false);
    expect(sandbox.hasCapability("repository.workspace")).toBe(true);
    expect(sandbox.hasCapability("extension.storage")).toBe(false);
    await fs.rm(roots.root, { recursive: true, force: true });
  });

  it("allows scoped workspace reads and writes but blocks package-root escapes", async () => {
    const roots = await makeRoots();
    const sandbox = createExternalAppSandbox({ manifest: makeManifest(), packageRoot: roots.packageRoot, workspaceRoot: roots.workspaceRoot, grantedPermissions: ["repository.read", "repository.write"], grantedCapabilities: ["repository.workspace"] });
    expect((await sandbox.readWorkspaceFile("README.md")).toString()).toBe("hello");
    await sandbox.writeWorkspaceFile("src/generated.txt", "generated");
    expect(await fs.readFile(path.join(roots.workspaceRoot, "src/generated.txt"), "utf8")).toBe("generated");
    await expect(sandbox.readWorkspaceFile("../package/settings.json")).rejects.toMatchObject({ code: "PATH_ESCAPE" });
    await expect(sandbox.writeWorkspaceFile("../../outside.txt", "blocked")).rejects.toMatchObject({ code: "PATH_ESCAPE" });
    await fs.rm(roots.root, { recursive: true, force: true });
  });

  it("denies writes when the host grant does not include repository.write", async () => {
    const roots = await makeRoots();
    const audit: Array<{ outcome: string; operation: string; permission?: string }> = [];
    const sandbox = createExternalAppSandbox({ manifest: makeManifest(), packageRoot: roots.packageRoot, workspaceRoot: roots.workspaceRoot, grantedPermissions: ["repository.read"], grantedCapabilities: ["repository.workspace"], audit: (event) => { audit.push(event); } });
    await expect(Promise.resolve().then(() => sandbox.writeWorkspaceFile("blocked.txt", "blocked"))).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(audit).toEqual(expect.arrayContaining([expect.objectContaining({ outcome: "denied", operation: "writeWorkspaceFile", permission: "repository.write" })]));
    await fs.rm(roots.root, { recursive: true, force: true });
  });

  it("keeps package storage separate from workspace access", async () => {
    const roots = await makeRoots();
    const sandbox = createExternalAppSandbox({ manifest: makeManifest(), packageRoot: roots.packageRoot, workspaceRoot: roots.workspaceRoot, grantedCapabilities: ["extension.storage"] });
    expect((await sandbox.readPackageFile("settings.json")).toString()).toBe("{}");
    await expect(sandbox.readPackageFile("../workspace/README.md")).rejects.toMatchObject({ code: "PATH_ESCAPE" });
    await fs.rm(roots.root, { recursive: true, force: true });
  });

  it("records cancellation and enforces operation timeouts", async () => {
    const roots = await makeRoots();
    const audit: string[] = [];
    const sandbox = createExternalAppSandbox({ manifest: makeManifest(), packageRoot: roots.packageRoot, workspaceRoot: roots.workspaceRoot, limits: { maxOperationMs: 5 }, audit: (event) => { audit.push(event.outcome); } });
    await expect(sandbox.runTask("slow-operation", async () => new Promise((resolve) => setTimeout(resolve, 30)))).rejects.toBeInstanceOf(SandboxViolationError);
    expect(audit).toEqual(["started", "cancelled"]);
    await fs.rm(roots.root, { recursive: true, force: true });
  });

  it("rejects invalid limits and non-external classifications", async () => {
    const roots = await makeRoots();
    expect(() => createExternalAppSandbox({ manifest: makeManifest(), packageRoot: roots.packageRoot, limits: { maxFileBytes: 0 } })).toThrowError(/maxFileBytes/);
    const systemManifest = { ...makeManifest(), app: { ...makeManifest().app, classification: "system" as const } };
    expect(() => createExternalAppSandbox({ manifest: systemManifest, packageRoot: roots.packageRoot })).toThrowError(/external applications/);
    await fs.rm(roots.root, { recursive: true, force: true });
  });
});
