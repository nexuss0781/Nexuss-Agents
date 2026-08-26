import type { MissionWorkItem } from "./store";
import { classifyRunnerFailure } from "./runnerPolicy";
import { strategyFingerprint } from "./concurrencyPolicy";

export type RepairDisposition = "retry" | "repair" | "replan" | "delegate_review" | "blocked" | "escalate";

export type FailureDiagnosis = {
  classification: ReturnType<typeof classifyRunnerFailure>;
  failureClass: string;
  summary: string;
  evidenceRefs: string[];
  newInformation: string[];
  rootCause?: string;
  changedCondition: string;
  recommendedDisposition: RepairDisposition;
  confidence: "low" | "medium" | "high";
};

export type RepairPlan = {
  disposition: RepairDisposition;
  strategyFingerprint: string;
  changedCondition: string;
  nextAction: string;
  preserveWorkItem: boolean;
  replanRequired: boolean;
  diagnosis: FailureDiagnosis;
};

export type ReplanRequest = {
  missionId: string;
  failedWorkItemId?: string;
  failureClass: string;
  objective: string;
  changedCondition: string;
  evidenceRefs: string[];
  preserveCompletedWork: boolean;
  excludeWorkItemIds: string[];
};

export function diagnoseFailure(input: { failureClass?: string; summary: string; nextAction?: string; evidenceRefs?: string[]; changedCondition?: string; newInformation?: string[] }): FailureDiagnosis {
  const failureClass = input.failureClass || "UNKNOWN";
  const classification = classifyRunnerFailure(failureClass);
  const changedCondition = input.changedCondition?.trim() || `Observed ${failureClass}; the failed result is now available for diagnosis.`;
  const recommendedDisposition: RepairDisposition = classification === "replan_required" ? "replan" : classification === "blocked" ? "blocked" : classification === "cancelled" ? "escalate" : classification === "retryable" ? "retry" : "repair";
  return { classification, failureClass, summary: input.summary.slice(0, 2_000), evidenceRefs: [...(input.evidenceRefs || [])], newInformation: [...(input.newInformation || []), input.nextAction ? `Executor requested: ${input.nextAction}` : ""].filter(Boolean).slice(0, 50), changedCondition, recommendedDisposition, confidence: input.evidenceRefs?.length ? "high" : input.summary.trim() ? "medium" : "low" };
}

export function planRepair(input: { item: MissionWorkItem; diagnosis: FailureDiagnosis; strategyFingerprint?: string; nextAction?: string }) : RepairPlan {
  const nextAction = input.nextAction?.trim() || (input.diagnosis.recommendedDisposition === "replan" ? "re-plan the affected dependency branch" : input.diagnosis.recommendedDisposition === "delegate_review" ? "delegate a focused review" : "execute a changed repair strategy");
  const fingerprint = input.strategyFingerprint || strategyFingerprint({ stage: "repair", objective: input.item.description, action: nextAction, parameters: { failureClass: input.diagnosis.failureClass, changedCondition: input.diagnosis.changedCondition } });
  return { disposition: input.diagnosis.recommendedDisposition, strategyFingerprint: fingerprint, changedCondition: input.diagnosis.changedCondition, nextAction, preserveWorkItem: input.diagnosis.recommendedDisposition !== "replan", replanRequired: input.diagnosis.recommendedDisposition === "replan", diagnosis: input.diagnosis };
}

export function buildReplanRequest(input: { missionId: string; item?: MissionWorkItem; diagnosis: FailureDiagnosis; completedWorkItemIds: readonly string[] }): ReplanRequest {
  return { missionId: input.missionId, ...(input.item ? { failedWorkItemId: input.item.id, objective: input.item.description } : { objective: "Re-plan the remaining mission" }), failureClass: input.diagnosis.failureClass, changedCondition: input.diagnosis.changedCondition, evidenceRefs: input.diagnosis.evidenceRefs, preserveCompletedWork: true, excludeWorkItemIds: [...input.completedWorkItemIds] };
}
