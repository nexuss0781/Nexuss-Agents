import { describe, expect, it } from "vitest";
import { buildReplanRequest, diagnoseFailure, planRepair } from "./repairRuntime";
import type { MissionWorkItem } from "./store";

const item: MissionWorkItem = { id: "work-1", missionId: "mission-1", ownerId: "owner-1", title: "Implement change", description: "Implement the repository change", role: "builder", status: "repairing", dependencies: ["work-0"], acceptanceCriteria: [], input: {}, attempt: 1, version: 3, createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z" };

describe("Phase 12 adaptive repair runtime", () => {
  it("diagnoses retryable, repairable, re-plan, and blocked failures", () => {
    expect(diagnoseFailure({ failureClass: "PROVIDER_TIMEOUT", summary: "Provider timed out" })).toMatchObject({ classification: "retryable", recommendedDisposition: "retry" });
    expect(diagnoseFailure({ failureClass: "ARCHITECTURE_INVALID", summary: "Plan conflicts with repository" })).toMatchObject({ classification: "replan_required", recommendedDisposition: "replan" });
    expect(diagnoseFailure({ failureClass: "MODEL_NOT_CONFIGURED", summary: "No model" })).toMatchObject({ classification: "blocked", recommendedDisposition: "blocked" });
  });

  it("requires changed conditions and creates stable changed repair plans", () => {
    const diagnosis = diagnoseFailure({ failureClass: "COMMAND_FAILED", summary: "Test failed", changedCondition: "The failing dependency was corrected", evidenceRefs: ["evidence-1"] });
    const plan = planRepair({ item, diagnosis, strategyFingerprint: "strategy-new" });
    expect(plan).toMatchObject({ disposition: "repair", strategyFingerprint: "strategy-new", changedCondition: "The failing dependency was corrected", replanRequired: false });
  });

  it("builds a re-plan request that preserves completed work and failure evidence", () => {
    const diagnosis = diagnoseFailure({ failureClass: "REPLAN_REQUIRED", summary: "Graph invalid", changedCondition: "The dependency boundary changed", evidenceRefs: ["evidence-1"] });
    const request = buildReplanRequest({ missionId: "mission-1", item, diagnosis, completedWorkItemIds: ["work-0"] });
    expect(request).toMatchObject({ missionId: "mission-1", failedWorkItemId: "work-1", preserveCompletedWork: true, excludeWorkItemIds: ["work-0"], evidenceRefs: ["evidence-1"] });
  });
});
