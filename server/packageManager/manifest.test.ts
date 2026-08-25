import { describe, expect, it } from "vitest";
import { validatePackageManifest, type PackageManifest } from "./manifest";

const validManifest: PackageManifest = {
  schemaVersion: 1,
  manifestVersion: "1.0.0",
  kind: "nexuss.application",
  id: "nexuss.git",
  name: "Nexuss-Git",
  shortName: "GitHub",
  description: "A guided Git and GitHub workspace.",
  app: {
    version: "0.1.0",
    icon: { kind: "asset", value: "assets/icon.svg", alt: "Nexuss-Git" },
    publisher: { id: "nexuss0781", name: "Nexuss" },
    classification: "first_party",
  },
  source: { type: "github", repository: "https://github.com/nexuss0781/Nexuss-Git", ref: "v0.1.0" },
  launch: { surface: "right-window", entrypoint: "nexuss-git", defaultWidth: 520, minWidth: 360, resizable: true, supportsExpanded: true },
  permissions: ["repository.read", "repository.write", "window.control"],
  capabilities: ["window.resize", "repository.workspace"],
  compatibility: { api: { minVersion: 1, maxVersion: 1 } },
};

function cloneManifest(overrides: Record<string, unknown> = {}) {
  return { ...structuredClone(validManifest), ...overrides } as Record<string, unknown>;
}

describe("Axolotl Store package manifest validator", () => {
  it("normalizes a valid GitHub package manifest", () => {
    const result = validatePackageManifest(validManifest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe("nexuss.git");
    expect(result.manifest.source.repository).toBe("https://github.com/nexuss0781/Nexuss-Git");
    expect(result.manifest.launch.defaultWidth).toBe(520);
    expect(result.manifest.normalized.permissions).toContain("repository.read");
  });

  it("rejects unsupported schema versions and unknown top-level fields", () => {
    const result = validatePackageManifest({ ...cloneManifest({ schemaVersion: 2 }), unexpected: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining(["MANIFEST_SCHEMA_UNSUPPORTED", "MANIFEST_UNKNOWN_FIELD"]));
  });

  it("rejects duplicate app IDs before installation", () => {
    const result = validatePackageManifest(validManifest, { existingAppIds: ["nexuss.git"] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "APP_ID_ALREADY_REGISTERED", path: "id" }));
  });

  it("rejects invalid GitHub sources and unsafe entrypoints", () => {
    const result = validatePackageManifest(cloneManifest({
      source: { type: "github", repository: "http://github.com/nexuss0781/Nexuss-Git?token=bad" },
      launch: { surface: "right-window", entrypoint: "../escape", defaultWidth: 520, minWidth: 360 },
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining(["SOURCE_REPOSITORY_INVALID", "LAUNCH_ENTRYPOINT_INVALID"]));
  });

  it("rejects invalid icon, width, and duplicate permission declarations", () => {
    const result = validatePackageManifest(cloneManifest({
      app: { ...validManifest.app, icon: { kind: "asset", value: "../icon.svg", alt: "" } },
      launch: { ...validManifest.launch, defaultWidth: 300, minWidth: 600 },
      permissions: ["repository.read", "repository.read"],
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining(["ICON_REFERENCE_INVALID", "LAUNCH_DEFAULT_WIDTH_INVALID", "LAUNCH_MIN_WIDTH_INVALID", "MANIFEST_DUPLICATE_VALUE"]));
  });

  it("enforces capability and permission relationships", () => {
    const result = validatePackageManifest(cloneManifest({ permissions: [], capabilities: ["window.resize", "repository.workspace"] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "CAPABILITY_PERMISSION_CONFLICT", path: "capabilities" }),
      expect.objectContaining({ code: "CAPABILITY_PERMISSION_CONFLICT", path: "capabilities" }),
    ]));
  });

  it("rejects unauthorized system packages and unsupported API requirements", () => {
    const result = validatePackageManifest(cloneManifest({
      app: { ...validManifest.app, classification: "system" },
      compatibility: { api: { minVersion: 2 } },
    }), { trustedSystemPublishers: ["other-publisher"] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining(["SYSTEM_PUBLISHER_UNTRUSTED", "API_VERSION_UNSUPPORTED"]));
  });

  it("returns a warning for a moving branch source ref", () => {
    const result = validatePackageManifest(cloneManifest({ source: { ...validManifest.source, ref: "main" } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "SOURCE_REF_NOT_REPRODUCIBLE", path: "source.ref" }));
  });
});
