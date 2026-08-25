import { execFile as callbackExecFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { downloadAndVerifyPackage, removePackageStaging } from "./downloader";
import type { PackageManifest } from "./manifest";

const execFile = promisify(callbackExecFile);

const validManifest: PackageManifest = {
  schemaVersion: 1,
  manifestVersion: "1.0.0",
  kind: "nexuss.application",
  id: "nexuss.git",
  name: "Nexuss-Git",
  shortName: "GitHub",
  app: {
    version: "0.1.0",
    icon: { kind: "asset", value: "assets/icon.svg", alt: "Nexuss-Git" },
    publisher: { id: "nexuss0781", name: "Nexuss" },
    classification: "first_party",
  },
  source: { type: "github", repository: "https://github.com/nexuss0781/Nexuss-Git", ref: "v0.1.0" },
  launch: { surface: "right-window", entrypoint: "nexuss-git", defaultWidth: 520, minWidth: 360 },
  permissions: ["repository.read"],
  capabilities: ["repository.workspace"],
};

async function makeArchive(contents: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nexuss-package-fixture-"));
  const source = path.join(root, "repo");
  const archive = path.join(root, "source.tar.gz");
  await fs.mkdir(path.join(source, "assets"), { recursive: true });
  for (const [file, content] of Object.entries(contents)) {
    const target = path.join(source, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  await execFile("tar", ["--create", "--gzip", "--file", archive, "--directory", source, "."]);
  return { root, archive };
}

function fakeFetch(archive: string, headers: Record<string, string> = {}) {
  return async () => new Response(await fs.readFile(archive), { status: 200, headers });
}

describe("Axolotl Store secure package downloader", () => {
  it("downloads, extracts, bounds, and returns a verified staging transaction", async () => {
    const fixture = await makeArchive({ "nexuss-git": "entrypoint", "assets/icon.svg": "<svg />" });
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), "nexuss-stage-"));
    const result = await downloadAndVerifyPackage(validManifest, { stagingDirectory: staging, fetchImpl: fakeFetch(fixture.archive) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packageRoot).toContain(`${path.sep}source`);
    expect(result.archiveDigest).toMatch(/^sha256-/);
    expect(result.manifestDigest).toMatch(/^sha256-/);
    expect(await fs.readFile(path.join(result.packageRoot, "nexuss-git"), "utf8")).toBe("entrypoint");
    await removePackageStaging(staging, result.stagingDirectory);
    await fs.rm(fixture.root, { recursive: true, force: true });
    await fs.rm(staging, { recursive: true, force: true });
  });

  it("requires a reproducible source ref by default", async () => {
    const result = await downloadAndVerifyPackage({ ...validManifest, source: { ...validManifest.source, ref: "main" } }, {
      stagingDirectory: await fs.mkdtemp(path.join(os.tmpdir(), "nexuss-stage-")),
      fetchImpl: async () => { throw new Error("network should not be called"); },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "SOURCE_REF_NOT_REPRODUCIBLE" }));
  });

  it("rejects a declared source commit when it cannot be resolved", async () => {
    const result = await downloadAndVerifyPackage({ ...validManifest, integrity: { sourceCommit: "0123456789abcdef0123456789abcdef01234567" } }, {
      stagingDirectory: await fs.mkdtemp(path.join(os.tmpdir(), "nexuss-stage-")),
      fetchImpl: async () => { throw new Error("network should not be called"); },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "SOURCE_COMMIT_UNVERIFIED" }));
  });

  it("rejects downloads over the configured byte limit before extraction", async () => {
    const fixture = await makeArchive({ "nexuss-git": "entrypoint", "assets/icon.svg": "<svg />" });
    const result = await downloadAndVerifyPackage(validManifest, {
      stagingDirectory: await fs.mkdtemp(path.join(os.tmpdir(), "nexuss-stage-")),
      maxDownloadBytes: 4,
      fetchImpl: fakeFetch(fixture.archive),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "DOWNLOAD_SIZE_LIMIT_EXCEEDED" }));
    await fs.rm(fixture.root, { recursive: true, force: true });
  });

  it("rejects a manifest digest mismatch before downloading", async () => {
    const result = await downloadAndVerifyPackage({ ...validManifest, integrity: { manifestDigest: "sha256-not-the-real-digest" } }, {
      stagingDirectory: await fs.mkdtemp(path.join(os.tmpdir(), "nexuss-stage-")),
      fetchImpl: async () => { throw new Error("network should not be called"); },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "MANIFEST_DIGEST_MISMATCH" }));
  });

  it("rejects unsafe archive paths and cleans the failed transaction", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nexuss-malicious-fixture-"));
    const source = path.join(root, "repo");
    const archive = path.join(root, "source.tar.gz");
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, "safe.txt"), "safe");
    await execFile("tar", ["--create", "--gzip", "--file", archive, "--directory", source, "--transform", "s/safe.txt/..\\/escape.txt/", "safe.txt"]);
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), "nexuss-stage-"));
    const result = await downloadAndVerifyPackage(validManifest, { stagingDirectory: staging, fetchImpl: fakeFetch(archive) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "ARCHIVE_PATH_TRAVERSAL" }));
    expect((await fs.readdir(staging)).filter((entry) => entry.startsWith(".incoming-")).length).toBe(0);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(staging, { recursive: true, force: true });
  });
});
