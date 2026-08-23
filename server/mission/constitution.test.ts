import { describe, expect, it } from "vitest";
import {
  assertMissionTransition,
  AUTONOMOUS_REPOSITORY_CHANGE_CONSTITUTION,
  AUTONOMOUS_REPOSITORY_CHANGE_CONSTITUTION_VERSION,
  AUTONOMOUS_REPOSITORY_CHANGE_MISSION_TYPE,
  canTransitionMission,
  isTerminalMissionStatus,
} from "./constitution";
import { AUTONOMOUS_REPOSITORY_CHANGE_SYSTEM_PROMPT } from "./autonomousRepositoryChangePrompt";

describe("Autonomous Repository Change constitution", () => {
  it("exposes a versioned mission contract with explicit authority order", () => {
    expect(AUTONOMOUS_REPOSITORY_CHANGE_CONSTITUTION.version).toBe(AUTONOMOUS_REPOSITORY_CHANGE_CONSTITUTION_VERSION);
    expect(AUTONOMOUS_REPOSITORY_CHANGE_CONSTITUTION.missionType).toBe(AUTONOMOUS_REPOSITORY_CHANGE_MISSION_TYPE);
    expect(AUTONOMOUS_REPOSITORY_CHANGE_CONSTITUTION.authorityOrder).toEqual([
      "system_constitution",
      "mission_contract",
      "policy_and_permissions",
      "quality_gates",
      "project_instructions",
      "skills_and_memories",
      "agent_plan",
      "tool_output",
    ]);
  });

  it("allows the normal execution path and rejects completion bypasses", () => {
    expect(canTransitionMission("created", "queued")).toBe(true);
    expect(canTransitionMission("queued", "planning")).toBe(true);
    expect(canTransitionMission("planning", "planned")).toBe(true);
    expect(canTransitionMission("planned", "executing")).toBe(true);
    expect(canTransitionMission("executing", "verifying")).toBe(true);
    expect(canTransitionMission("verifying", "completed")).toBe(true);
    expect(canTransitionMission("executing", "completed")).toBe(false);
    expect(() => assertMissionTransition("executing", "completed")).toThrow("Invalid mission transition");
  });

  it("identifies terminal outcomes", () => {
    expect(isTerminalMissionStatus("completed")).toBe(true);
    expect(isTerminalMissionStatus("stopped")).toBe(true);
    expect(isTerminalMissionStatus("failed")).toBe(true);
    expect(isTerminalMissionStatus("executing")).toBe(false);
  });

  it("keeps autonomy, completion, evidence, security, and learning requirements explicit", () => {
    const constitution = AUTONOMOUS_REPOSITORY_CHANGE_CONSTITUTION;
    expect(constitution.autonomyPolicy.continueOnRecoverableFailure).toBe(true);
    expect(constitution.autonomyPolicy.askOnlyFor).toContain("missing_credential_or_permission");
    expect(constitution.autonomyPolicy.prohibitedWithoutExplicitPolicy).toContain("bypass_quality_gate");
    expect(constitution.completionRequirements).toContain("All required acceptance criteria have a passing quality result.");
    expect(constitution.evidenceRequirements).toContain("Every repair records the failed check, diagnosis, changed strategy, and new result.");
    expect(constitution.learningRequirements).toContain("Knowledge promotion never mutates a trusted version in place; it creates a new version.");
  });

  it("contains the required dynamic context slots in the canonical system prompt", () => {
    for (const section of [
      "<mission_contract>",
      "<project_context>",
      "<available_skills>",
      "<relevant_memory>",
      "<trusted_shortcuts>",
      "<available_harnesses>",
      "<latest_checkpoint>",
      "<previous_events_and_evidence>",
    ]) {
      expect(AUTONOMOUS_REPOSITORY_CHANGE_SYSTEM_PROMPT).toContain(section);
    }
    expect(AUTONOMOUS_REPOSITORY_CHANGE_SYSTEM_PROMPT).toContain("The producer of an artifact is not the sole authority that verifies it.");
    expect(AUTONOMOUS_REPOSITORY_CHANGE_SYSTEM_PROMPT).toContain("Never say “done”");
  });
});
