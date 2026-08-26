import path from "node:path";
import { downloadAndVerifyPackage } from "./downloader";
import { AppLifecycleManager, type LifecycleAction } from "./lifecycle";

export const AXOLOTL_CATALOG = [
  {
    id: "nexuss-git",
    name: "Nexuss-Git",
    shortName: "Git",
    version: "0.2.0",
    description:
      "A safe repository workspace for GitHub and local Git operations.",
    icon: "https://raw.githubusercontent.com/nexuss0781/Nexuss-Git/main/public/icon.svg",
    sourceRepository: "https://github.com/nexuss0781/Nexuss-Git",
    manifestUrl:
      "https://raw.githubusercontent.com/nexuss0781/Nexuss-Git/v0.2.0/axolotl.manifest.json",
    sourceRef: "v0.2.0",
  },
];

const lifecycle = new AppLifecycleManager({
  rootDirectory: path.resolve(
    process.env.AXOLOTL_STORE_ROOT ?? path.join(process.cwd(), ".axolotl-store")
  ),
});
const catalog = new Map(AXOLOTL_CATALOG.map(app => [app.id, app]));

function versionParts(version: string) {
  return version.replace(/^v/, "").split(".").map(part => Number.parseInt(part.split("-")[0] || "0", 10) || 0);
}

function isNewerVersion(candidate: string, current: string) {
  const next = versionParts(candidate);
  const previous = versionParts(current);
  for (let index = 0; index < 3; index += 1) {
    if ((next[index] || 0) !== (previous[index] || 0)) return (next[index] || 0) > (previous[index] || 0);
  }
  return false;
}

export async function storeSnapshot() {
  const installed = await lifecycle.list();
  return AXOLOTL_CATALOG.map(app => {
    const record = installed.find(record => record.appId === app.id) ?? null;
    return {
      ...app,
      installed: record,
      availableVersion: app.version,
      updateAvailable: Boolean(record && record.state !== "uninstalled" && isNewerVersion(app.version, record.version)),
    };
  });
}

async function fetchVerifiedPackage(appId: string) {
  const app = catalog.get(appId);
  if (!app)
    return {
      ok: false as const,
      code: "APP_NOT_IN_CATALOG",
      message: "App is not in the Axolotl Store catalog.",
    };
  const response = await fetch(app.manifestUrl, {
    headers: { accept: "application/json" },
  });
  if (!response.ok)
    return {
      ok: false as const,
      code: "MANIFEST_FETCH_FAILED",
      message: `Manifest fetch returned HTTP ${response.status}.`,
    };
  const manifest = await response.json();
  const result = await downloadAndVerifyPackage(manifest, {
    stagingDirectory: path.resolve(
      process.env.AXOLOTL_STORE_STAGING ??
        path.join(process.cwd(), ".axolotl-staging")
    ),
    resolvedSourceCommit: undefined,
  });
  if (!result.ok)
    return {
      ok: false as const,
      code: result.errors[0]?.code ?? "PACKAGE_DOWNLOAD_FAILED",
      message: result.errors[0]?.message ?? "Package download failed.",
    };
  return result;
}

export async function storeInstall(appId: string) {
  const result = await fetchVerifiedPackage(appId);
  if (!result.ok) return result;
  return lifecycle.install(result);
}

export async function storeUpdate(appId: string) {
  const result = await fetchVerifiedPackage(appId);
  if (!result.ok) return result;
  return lifecycle.update(result);
}

export async function storeAction(appId: string, action: LifecycleAction) {
  if (action === "install") return storeInstall(appId);
  if (action === "update") return storeUpdate(appId);
  if (action === "enable") return lifecycle.setEnabled(appId, true);
  if (action === "disable") return lifecycle.setEnabled(appId, false);
  if (action === "uninstall") return lifecycle.uninstall(appId);
  return {
    ok: false as const,
    code: "STORE_ACTION_UNSUPPORTED",
    message: `${action} is not available from the Store.`,
  };
}
