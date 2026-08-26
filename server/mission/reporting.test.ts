import { describe, expect, it } from "vitest";
import type { MissionArtifact, MissionEvidence, MissionEvent, MissionSnapshot, MissionVerification } from "./store";
import { buildMissionReport } from "./reporting";

const now = "2026-08-27T00:00:00.000Z";

function fixture(goal: string): { snapshot: MissionSnapshot; artifacts: MissionArtifact[]; evidence: MissionEvidence[]; verifications: MissionVerification[] } {
  const mission = {
    id: "mission-report",
    ownerId: "owner-1",
    missionType: "autonomous_repository_change" as const,
    goal,
    contract: { riskLevel: "high" as const, acceptanceCriteria: [{ id: "result", description: "Produce the requested result", verification: "mixed" as const, required: true }], executionBudget: {} },
    status: "completed" as const,
    budget: { maxDepth: 3, maxChildWorkItems: 8, maxAgentAttempts: 3, maxToolCalls: 30, maxModelTokens: 20_000, maxDurationSeconds: 600 },
    version: 4,
    createdAt: now,
    updatedAt: now,
    finishedAt: now,
  };
  const event = (type: string, payload: Record<string, unknown> = {}): MissionEvent => ({ id: `${type}-1`, missionId: mission.id, ownerId: mission.ownerId, sequence: 1, type, actor: "mission_runner", payload, createdAt: now });
  const artifact: MissionArtifact = { id: "artifact-1", missionId: mission.id, ownerId: mission.ownerId, kind: "deliverable", locator: "workspace/result", summary: "Primary result", metadata: {}, createdAt: now };
  const evidence: MissionEvidence = { id: "evidence-1", missionId: mission.id, ownerId: mission.ownerId, artifactId: artifact.id, kind: "quality_check", summary: "Independent quality check passed", strength: "conclusive", provenance: [{ kind: "test", ref: "quality-suite" }], data: {}, producedBy: "quality-gate", observedAt: now, createdAt: now };
  const verification: MissionVerification = { id: "verification-1", missionId: mission.id, ownerId: mission.ownerId, subjectRefs: [artifact.id], method: "independent quality suite", independenceMode: "separate_agent", status: "passed", observations: ["All required checks passed"], failedChecks: [], evidenceRefs: [evidence.id], performedBy: "quality-gate", startedAt: now, completedAt: now };
  return {
    snapshot: { mission, workItems: [{ id: "work-1", missionId: mission.id, ownerId: mission.ownerId, title: "Complete work", description: "Complete the representative mission", role: "repository_builder", status: "completed", dependencies: [], acceptanceCriteria: mission.contract.acceptanceCriteria, input: {}, attempt: 1, version: 1, createdAt: now, updatedAt: now }], events: [event("runner.recovery_started"), event("runner.recovery_reconciled"), event("work_item.recovered"), event("quality_gate.completed", { acceptance: { unsatisfiedCriteria: [], missingEvidenceKinds: [] }, quality: { reason: "High-risk quality gate passed", requiredVerificationCount: 1 }, replanRequest: { failedWorkItemId: "old-work" } })] },
    artifacts: [artifact], evidence: [evidence], verifications: [verification],
  };
}

describe("mission report projection", () => {
  it.each([
    ["research", "Research and synthesize the primary sources"],
    ["engineering", "Implement and verify the repository change"],
    ["mathematics", "Prove the stated convergence result"],
    ["mixed", "Research, implement, and mathematically verify the design"],
  ])("reports a verified %s mission without exposing internal payloads", (_domain, goal) => {
    const report = buildMissionReport(fixture(goal));

    expect(report.mission).toMatchObject({ id: "mission-report", goal, status: "completed", riskLevel: "high" });
    expect(report.outcome).toMatchObject({ headline: "Mission completed", completedWorkItems: 1, totalWorkItems: 1, failedWorkItems: 0 });
    expect(report.acceptance).toMatchObject({ requiredCriteria: 1, criteriaWithEvidence: 1, missingEvidenceKinds: [], unsatisfiedCriteria: [] });
    expect(report.evidence[0]).toMatchObject({ id: "evidence-1", kind: "quality_check", strength: "conclusive" });
    expect(report.verifications[0]).toMatchObject({ status: "passed", independenceMode: "separate_agent" });
    expect(report.quality).toMatchObject({ status: "passed", passingVerificationCount: 1, requiredVerificationCount: 1 });
    expect(report.recovery).toMatchObject({ recoveryCount: 1, recoveredWorkItemCount: 1 });
    expect(report.repair).toMatchObject({ repairCount: 1, replanCount: 1 });
    expect(report.nextAction).toContain("verified artifacts");
    expect(JSON.stringify(report)).not.toContain("replanRequest");
  });
});
