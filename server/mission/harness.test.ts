import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRepositoryWrites, runRepositoryCommand, safeRepositoryPath } from "./harness";
import { redactSensitiveData } from "./redaction";

describe("bounded repository harness", () => {
  it("confines paths and rejects credential-bearing files", () => {
    const root = "/tmp/nexuss-repository";
    expect(safeRepositoryPath(root, "server/index.ts")).toBe(join(root, "server/index.ts"));
    expect(() => safeRepositoryPath(root, "../outside.ts")).toThrow("escapes");
    expect(() => safeRepositoryPath(root, ".env")).toThrow("restricted");
    expect(() => safeRepositoryPath(root, "cert.pem")).toThrow("restricted");
  });

  it("writes bounded files only inside the repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "nexuss-harness-"));
    try {
      expect(await applyRepositoryWrites(root, [{ path: "result.txt", content: "verified" }])).toEqual(["result.txt"]);
      await expect(readFile(join(root, "result.txt"), "utf8")).resolves.toBe("verified");
      await expect(applyRepositoryWrites(root, [{ path: "../escape.txt", content: "no" }])).rejects.toThrow("escapes");
      await expect(applyRepositoryWrites(root, [{ path: ".env", content: "no" }])).rejects.toThrow("restricted");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("redacts sensitive nested fields without removing mission context", () => {
    expect(redactSensitiveData({ goal: "implement feature", contract: { apiKey: "hidden", constraints: ["keep scope bounded"] } })).toEqual({ goal: "implement feature", contract: { apiKey: "[redacted]", constraints: ["keep scope bounded"] } });
  });

  it("allows only inspection and verification commands", async () => {
    await expect(runRepositoryCommand(process.cwd(), "sh", ["-c", "echo unsafe"], new AbortController().signal)).rejects.toThrow("not allowlisted");
    await expect(runRepositoryCommand(process.cwd(), "pnpm", ["install"], new AbortController().signal)).rejects.toThrow("not allowlisted");
    const result = await runRepositoryCommand(process.cwd(), "git", ["status", "--short"], new AbortController().signal, 5_000);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });
});
