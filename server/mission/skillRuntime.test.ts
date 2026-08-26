import { describe, expect, it } from "vitest";
import { loadDomainSkillRegistry } from "./skillRegistry";
import { assertSkillBindings, readSkillBindings, selectMissionSkills, skillEvidenceMetadata } from "./skillRuntime";

describe("Phase 7 skill runtime binding", () => {
  it("selects and validates a software engineering builder binding", async () => {
    const bindings = await selectMissionSkills({ objective: "Implement a repository change", domains: ["software_delivery"], role: "builder", stage: "execute", actions: ["write"] });
    expect(bindings[0]?.skillId).toBe("domain.software_engineering");
    await expect(assertSkillBindings({ bindings, role: "builder", stage: "execute", action: "write" })).resolves.toBe(true);
  });

  it("rejects a reviewer binding when the work item requests mutation", async () => {
    const registry = await loadDomainSkillRegistry();
    const skill = registry.get("domain.software_engineering")!;
    const binding = [{ skillId: skill.id, version: skill.version, domain: skill.domain, sourceFile: skill.sourceFile, selectionReason: "test" }];
    await expect(assertSkillBindings({ bindings: binding, role: "quality_gate", stage: "execute", action: "write" })).rejects.toThrow(/exceeds role authority/);
  });

  it("normalizes untrusted binding input and emits evidence provenance metadata", async () => {
    const registry = await loadDomainSkillRegistry();
    const skill = registry.get("domain.research")!;
    const binding = { skillId: skill.id, version: skill.version, domain: skill.domain, sourceFile: skill.sourceFile, selectionReason: "test" };
    expect(readSkillBindings([binding, { invalid: true }])).toEqual([binding]);
    expect(skillEvidenceMetadata([binding])).toEqual([expect.objectContaining({ skillId: skill.id, skillVersion: skill.version, skillDomain: "research" })]);
  });
});
