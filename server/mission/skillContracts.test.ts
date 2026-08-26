import { describe, expect, it } from "vitest";
import { loadDomainSkillSnapshot } from "./skillLoader";
import { DomainSkillRegistry } from "./skillRegistry";
import { domainSkillContractSchema, validateDomainSkillContract } from "./skillSchemas";

const validMetadata = {
  id: "domain.test",
  version: "1.0.0",
  title: "Test Skill",
  domain: "research" as const,
  maturity: "validated" as const,
  description: "A valid test skill.",
  missionSignals: ["test"],
  supportedStages: ["research_inspect" as const],
  inputs: [{ id: "question", description: "Question", required: true, acceptedKinds: ["text"], sourceRequirements: ["user_input"] }],
  procedure: [{ id: "inspect", stage: "research_inspect" as const, instruction: "Inspect evidence.", required: true }],
  actions: ["inspect" as const],
  authority: "execution_only" as const,
  sideEffects: ["read_only" as const],
  allowedRoles: ["researcher"],
  allowedHarnesses: ["research"],
  outputs: [{ id: "finding", description: "Finding", required: true, artifactKinds: ["finding"], evidenceKinds: ["claim"] }],
  evidence: { requiredKinds: ["claim"], minimumStrength: "strong" as const, provenanceRequirements: ["source"], claimTraceability: true },
  verification: { methods: ["review"], minimumIndependence: "separate_agent" as const, acceptanceChecks: ["claim traced"], producerMayVerify: false },
  failure: { failureClasses: ["source_failure"], retryable: ["source_failure"], repairable: [], replanRequired: [], escalationConditions: [], changedStrategyRequired: true },
  composition: { consumes: ["question"], produces: ["finding"], compatibleDomains: ["research" as const], handoffRequirements: ["source"] },
};

describe("Phase 7 domain skill contracts", () => {
  it("loads all four Markdown domain skills with source provenance", async () => {
    const snapshot = await loadDomainSkillSnapshot();
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.skills.map((skill) => skill.id)).toEqual([
      "domain.mathematics",
      "domain.mixed_mission",
      "domain.research",
      "domain.software_engineering",
    ]);
    expect(snapshot.skills.every((skill) => skill.sourceHash.length === 64 && skill.markdown.includes("Runtime Contract Metadata"))).toBe(true);
  });

  it("rejects a mutation action from verification-only authority", () => {
    expect(() => validateDomainSkillContract({ ...validMetadata, authority: "verification_only", actions: ["write"], sideEffects: ["workspace_mutation"] })).toThrow(/cannot assign mutation/);
  });

  it("requires evidence traceability and changed retry strategy", () => {
    expect(() => validateDomainSkillContract({ ...validMetadata, evidence: { ...validMetadata.evidence, claimTraceability: false } })).toThrow(/claim traceability/);
    expect(() => validateDomainSkillContract({ ...validMetadata, failure: { ...validMetadata.failure, changedStrategyRequired: false } })).toThrow(/changed strategy/);
  });

  it("selects canonical skills from legacy domain aliases and objective signals", async () => {
    const registry = new DomainSkillRegistry(await loadDomainSkillSnapshot());
    expect(registry.select({ objective: "Implement a TypeScript repository change", domains: ["software_delivery"] })[0]).toMatchObject({ skillId: "domain.software_engineering", domain: "software_engineering" });
    expect(registry.select({ objective: "Prove the theorem", requiredSkills: ["mathematics"] })[0]?.skillId).toBe("domain.mathematics");
  });

  it("rejects malformed schema input before cross-field validation", () => {
    expect(() => domainSkillContractSchema.parse({})).toThrow();
  });
});
