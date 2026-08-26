import type { MissionArtifact, MissionEvidence, MissionEvent, MissionSnapshot, MissionVerification } from "./store";

const MAX_TEXT = 320;
const MAX_ITEMS = 12;

function boundedText(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

function payloadText(event: MissionEvent, key: string, fallback: string) {
  return boundedText(event.payload[key], fallback);
}

function eventCount(events: readonly MissionEvent[], names: readonly string[]) {
  const wanted = new Set(names);
  return events.filter((event) => wanted.has(event.type)).length;
}

function latestPayload(events: readonly MissionEvent[], names: readonly string[]) {
  const wanted = new Set(names);
  return [...events].reverse().find((event) => wanted.has(event.type))?.payload || {};
}

export type MissionReport = {
  mission: {
    id: string;
    goal: string;
    status: MissionSnapshot["mission"]["status"];
    riskLevel: string;
    createdAt: string;
    updatedAt: string;
    finishedAt?: string;
  };
  outcome: {
    headline: string;
    summary: string;
    completedWorkItems: number;
    totalWorkItems: number;
    failedWorkItems: number;
  };
  acceptance: {
    requiredCriteria: number;
    criteriaWithEvidence: number;
    missingEvidenceKinds: string[];
    unsatisfiedCriteria: string[];
  };
  evidence: Array<{ id: string; kind: string; strength: MissionEvidence["strength"]; summary: string; artifactId?: string }>;
  verifications: Array<{ id: string; status: MissionVerification["status"]; method: string; independenceMode: MissionVerification["independenceMode"]; observations: string[] }>;
  quality: {
    status: "passed" | "incomplete" | "not_run";
    reason: string;
    passingVerificationCount: number;
    requiredVerificationCount?: number;
  };
  recovery: { recoveryCount: number; recoveredWorkItemCount: number };
  repair: { repairCount: number; replanCount: number; latestAction?: string };
  artifacts: Array<{ id: string; kind: string; locator: string; summary: string }>;
  nextAction: string;
};

export function buildMissionReport(input: {
  snapshot: MissionSnapshot;
  artifacts: readonly MissionArtifact[];
  evidence: readonly MissionEvidence[];
  verifications: readonly MissionVerification[];
}): MissionReport {
  const { snapshot, artifacts, evidence, verifications } = input;
  const mission = snapshot.mission;
  const completedWorkItems = snapshot.workItems.filter((item) => item.status === "completed").length;
  const failedWorkItems = snapshot.workItems.filter((item) => ["failed", "blocked", "cancelled"].includes(item.status)).length;
  const acceptancePayload = latestPayload(snapshot.events, ["quality_gate.completed", "executor.completed", "runner.error"]);
  const qualityPayload = (acceptancePayload.quality && typeof acceptancePayload.quality === "object" ? acceptancePayload.quality : {}) as Record<string, unknown>;
  const acceptance = (acceptancePayload.acceptance && typeof acceptancePayload.acceptance === "object" ? acceptancePayload.acceptance : {}) as Record<string, unknown>;
  const passingVerificationCount = verifications.filter((item) => item.status === "passed").length;
  const qualityStatus = mission.status === "completed" && passingVerificationCount > 0 ? "passed" : snapshot.events.some((event) => event.type === "quality_gate.completed" || event.type === "executor.completed") ? "incomplete" : "not_run";
  const repairEvents = snapshot.events.filter((event) => event.type === "runner.error" || event.type === "executor.failed" || event.type === "quality_gate.completed").filter((event) => event.payload.repairPlan || event.payload.retryClassification || event.payload.failureClass || event.payload.replanRequest || event.payload.replannedWorkItemId);
  const replanCount = snapshot.events.filter((event) => Boolean(event.payload.replanRequest || event.payload.replannedWorkItemId)).length;
  const latestFailure = [...snapshot.events].reverse().find((event) => event.type === "runner.error" || event.type === "executor.failed" || event.type === "work_item.blocked");
  const nextAction = mission.status === "completed" ? "Review the verified artifacts and continue from the delivered result." : mission.status === "repairing" ? boundedText(latestFailure?.payload.nextAction, "Continue with the changed repair strategy.") : mission.status === "failed" ? "Review the recorded failure evidence and choose the next repair or operator action." : "The mission is still in progress; continue monitoring its verified work items.";

  return {
    mission: { id: mission.id, goal: boundedText(mission.goal, "Mission"), status: mission.status, riskLevel: mission.contract.riskLevel || "low", createdAt: mission.createdAt, updatedAt: mission.updatedAt, ...(mission.finishedAt ? { finishedAt: mission.finishedAt } : {}) },
    outcome: {
      headline: mission.status === "completed" ? "Mission completed" : mission.status === "failed" ? "Mission needs attention" : "Mission in progress",
      summary: mission.status === "completed" ? "The mission reached its completion state with recorded verification." : failedWorkItems > 0 ? "The mission has recorded incomplete or failed work and preserved the evidence for repair." : "The mission has not reached its terminal state yet.",
      completedWorkItems,
      totalWorkItems: snapshot.workItems.length,
      failedWorkItems,
    },
    acceptance: {
      requiredCriteria: mission.contract.acceptanceCriteria?.filter((criterion) => criterion.required).length || 0,
      criteriaWithEvidence: Array.isArray(acceptance.unsatisfiedCriteria) ? Math.max(0, (mission.contract.acceptanceCriteria?.filter((criterion) => criterion.required).length || 0) - acceptance.unsatisfiedCriteria.length) : 0,
      missingEvidenceKinds: Array.isArray(acceptance.missingEvidenceKinds) ? acceptance.missingEvidenceKinds.filter((item): item is string => typeof item === "string").slice(0, MAX_ITEMS) : [],
      unsatisfiedCriteria: Array.isArray(acceptance.unsatisfiedCriteria) ? acceptance.unsatisfiedCriteria.filter((item): item is string => typeof item === "string").map((item) => boundedText(item, "Unmet criterion")).slice(0, MAX_ITEMS) : [],
    },
    evidence: evidence.slice(-MAX_ITEMS).map((item) => ({ id: item.id, kind: boundedText(item.kind, "evidence"), strength: item.strength, summary: boundedText(item.summary, "Recorded evidence"), ...(item.artifactId ? { artifactId: item.artifactId } : {}) })),
    verifications: verifications.slice(-MAX_ITEMS).map((item) => ({ id: item.id, status: item.status, method: boundedText(item.method, "Independent check"), independenceMode: item.independenceMode, observations: item.observations.slice(0, 4).map((observation) => boundedText(observation, "Observation")) })),
    quality: { status: qualityStatus, reason: boundedText(qualityPayload.reason, qualityStatus === "passed" ? "Required quality checks passed." : qualityStatus === "incomplete" ? "Quality activity is recorded but the final gate is not complete." : "No final quality gate has been recorded."), passingVerificationCount, ...(typeof qualityPayload.requiredVerificationCount === "number" ? { requiredVerificationCount: qualityPayload.requiredVerificationCount } : {}) },
    recovery: { recoveryCount: Math.max(eventCount(snapshot.events, ["runner.recovery_started"]), eventCount(snapshot.events, ["runner.recovery_reconciled"])), recoveredWorkItemCount: eventCount(snapshot.events, ["work_item.recovered"]) },
    repair: { repairCount: repairEvents.length, replanCount, ...(latestFailure?.payload.nextAction ? { latestAction: boundedText(latestFailure.payload.nextAction, "Continue repair") } : {}) },
    artifacts: artifacts.slice(-MAX_ITEMS).map((item) => ({ id: item.id, kind: boundedText(item.kind, "artifact"), locator: boundedText(item.locator, "stored artifact"), summary: boundedText(item.summary, "Recorded artifact") })),
    nextAction,
  };
}
