import { describe, expect, it } from "vitest";
import { clearWorkflowSourceCache, loadWorkflowSources } from "./workflowLoader";
import { composeWorkflowMessages, composeWorkflowSystemPrompt } from "./promptComposer";
import { loadDomainSkillRegistry } from "./skillRegistry";

describe("Markdown workflow prompt composer", () => {
  it("loads the root, contract, registry, vocabulary, and active stage sources", async () => {
    clearWorkflowSourceCache();
    const sources = await loadWorkflowSources({ stage: "execute", includeContract: true, includeRegistry: true, includeStatusVocabulary: true });
    expect(sources.map((source) => source.id)).toEqual(["orchestrator", "contract", "stages", "status_vocabulary", "stage:execute"]);
    expect(sources.every((source) => source.content.trim().length > 0)).toBe(true);
  });

  it("composes a traceable stage prompt with role, context, and output contract", async () => {
    const prompt = await composeWorkflowSystemPrompt({
      role: "repository_builder",
      authority: "execution_only",
      stage: "execute",
      mission: { missionId: "mission-1", objective: "Implement the requested change", token: "should-redact" },
      workItem: { title: "Update the service", acceptanceCriteria: ["tests pass"] },
      domains: ["software_delivery"],
      skills: ["repository_inspection", "bounded_execution"],
      harnesses: ["filesystem", "repository_verification"],
      outputContract: "Return structured execution evidence",
    });
    expect(prompt.content).toContain("activeStage");
    expect(prompt.content).toContain("repository_builder");
    expect(prompt.content).toContain("Stage_09-Execute.md");
    expect(prompt.content).toContain("Return structured execution evidence");
    expect(prompt.content).not.toContain("should-redact");
    expect(prompt.sourceIds).toContain("stage:execute");
    expect(prompt.sourceFiles).toContain("CONTRACT.md");
  });

  it("injects a selected domain skill with version and provenance metadata", async () => {
    const registry = await loadDomainSkillRegistry({ reload: true });
    const skill = registry.get("domain.software_engineering");
    expect(skill).toBeDefined();
    const prompt = await composeWorkflowSystemPrompt({ role: "repository_builder", authority: "execution_only", stage: "execute", domainSkillBindings: [{ skillId: skill!.id, version: skill!.version, domain: skill!.domain, sourceFile: skill!.sourceFile, selectionReason: "test" }] });
    expect(prompt.content).toContain("Selected Domain Skill Contracts");
    expect(prompt.content).toContain("domain.software_engineering");
    expect(prompt.content).toContain(skill!.sourceHash);
    expect(prompt.content).toContain("# Software Engineering Skill");
  });

  it("returns a model-ready system and user message pair", async () => {
    const result = await composeWorkflowMessages({ role: "mission_intake", stage: "intake" }, "{\"sources\":[]}");
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[1]).toEqual({ role: "user", content: "{\"sources\":[]}" });
  });
});
