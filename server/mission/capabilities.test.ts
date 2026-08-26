import { describe, expect, it } from "vitest";
import { assertHarnessRequest, getHarness } from "./harnessRegistry";
import { getSkill, isSkillImplemented } from "./skills";

describe("skills and harness registries", () => {
  it("treats capabilities as reusable skills rather than architecture modes", () => {
    expect(getSkill("research")).toMatchObject({ status: "contract_only", requiredHarnesses: ["research"] });
    expect(getSkill("browser")).toMatchObject({ status: "contract_only", requiredHarnesses: ["browser"] });
    expect(getSkill("repository_inspection")).toMatchObject({ status: "implemented" });
    expect(isSkillImplemented("webdev")).toBe(false);
  });

  it("enforces harness operation and timeout contracts", () => {
    expect(assertHarnessRequest({ harness: "repository_inspection", operation: "snapshot", input: {}, timeoutMs: 1_000 }).id).toBe("repository_inspection");
    expect(() => assertHarnessRequest({ harness: "repository_inspection", operation: "publish", input: {} })).toThrow(/not allowlisted/);
    expect(() => assertHarnessRequest({ harness: "repository_change", operation: "write_files", input: {}, timeoutMs: 120_001 })).toThrow(/timeout/);
    expect(getHarness("filesystem")).toMatchObject({ status: "implemented", sideEffect: "bounded_repository_write" });
    expect(() => assertHarnessRequest({ harness: "filesystem", operation: "shell", input: {} })).toThrow(/not allowlisted/);
  });
});
