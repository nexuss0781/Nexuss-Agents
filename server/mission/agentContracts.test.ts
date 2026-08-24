import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt, getAgentContract } from "./agentContracts";
import { assertHarnessAllowed, assertRepositoryWriteAllowed, assertSkillAllowed } from "./capabilityGuard";

describe("unified agent contracts", () => {
  it("defines distinct authority and loops for intake, principal, sub-orchestrator, builder, and quality", () => {
    expect(getAgentContract("intake")).toMatchObject({ layer: "intake", authority: "intake_only", canDelegate: false, canWriteRepository: false, allowedSkills: ["requirement_extraction", "source_traceability", "risk_classification"], allowedHarnesses: ["mission_intake"] });
    expect(getAgentContract("intake").systemPrompt).toContain("Mission Intake Engine");
    expect(getAgentContract("principal")).toMatchObject({ layer: "principal_orchestrator", authority: "mission_owner", canDelegate: true, canWriteRepository: false });
    expect(getAgentContract("sub_orchestrator")).toMatchObject({ layer: "sub_orchestrator", authority: "delegation_only", canDelegate: true, canWriteRepository: false });
    expect(getAgentContract("repository_builder")).toMatchObject({ layer: "specialist", authority: "execution_only", canWriteRepository: true });
    expect(getAgentContract("quality_gate")).toMatchObject({ layer: "quality_gate", authority: "verification_only", canVerifyProducerOutput: true });
    expect(getAgentContract("principal").loop).toContain("delegate");
    expect(getAgentContract("quality_gate").loop).toContain("verify");
  });

  it("assembles a versioned prompt without leaking prohibited context fields", () => {
    const prompt = buildAgentSystemPrompt(getAgentContract("principal"), { missionGoal: "Inspect repository", acceptanceCriteria: [{ id: "a" }], allowedSkills: ["mission_planning"], allowedHarnesses: ["mission_runtime"], priorEvidence: { apiKey: "do-not-forward", summary: "safe" } });
    expect(prompt).toContain("CONTRACT VERSION");
    expect(prompt).toContain("mission_planning");
    expect(prompt).not.toContain("do-not-forward");
    expect(prompt).toContain("safe");
  });
});

describe("capability guards", () => {
  it("rejects disallowed skill, harness, and repository-write operations", () => {
    const quality = getAgentContract("quality_gate");
    expect(() => assertSkillAllowed(quality, "bounded_execution")).toThrow(/not allowed/);
    expect(() => assertHarnessAllowed(quality, { harness: "repository_change", operation: "write_files", input: {} })).toThrow(/not allowed/);
    expect(() => assertRepositoryWriteAllowed(quality)).toThrow(/cannot write/);
  });
});
