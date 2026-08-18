import { describe, expect, it } from "vitest";
import { shouldMigrateLegacyWorkspace } from "./Home";

describe("workspace legacy migration gate", () => {
  it("imports local histories only when the signed-in user has no durable remote workspace data", () => {
    const legacy = { projects: [{ id: "local-project", name: "Local", description: "", tone: "#fff" }], threads: [] };
    expect(shouldMigrateLegacyWorkspace({ projects: [], threads: [] }, legacy)).toBe(true);
    expect(shouldMigrateLegacyWorkspace({ projects: [{ id: "remote-project", name: "Remote", description: "", tone: "#fff" }], threads: [] }, legacy)).toBe(false);
    expect(shouldMigrateLegacyWorkspace({ projects: [], threads: [{ id: "remote-thread", title: "Remote", updatedAt: "2026-01-01T00:00:00.000Z", messages: [] }] }, legacy)).toBe(false);
  });
});
