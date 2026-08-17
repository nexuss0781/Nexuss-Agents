import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const hasProjectToken = Boolean(process.env.NEXUSS_AUTH_TOKEN);

describe.runIf(hasProjectToken)("Nexuss Auth project token", () => {
  it("authenticates to the official project CLI without exposing its value", async () => {
    const token = process.env.NEXUSS_AUTH_TOKEN;
    expect(token).toMatch(/^nxa_/);

    const configDir = await mkdtemp(join(tmpdir(), "nexuss-auth-token-test-"));
    const env = { ...process.env, NEXUSS_AUTH_CONFIG_DIR: configDir };

    try {
      await execFileAsync("nexuss", ["token", "use", "--value", token!], { env });
      const { stdout } = await execFileAsync("nexuss", ["--json", "project", "list"], { env });
      expect(JSON.parse(stdout)).toBeDefined();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  }, 30_000);
});
