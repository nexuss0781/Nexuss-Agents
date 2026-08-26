import type { MissionStatus, WorkItemStatus } from "./constitution";

export type RecoveryDisposition = "resume" | "reconcile" | "repair" | "blocked" | "noop";

export type RecoveryWorkItemInput = {
  id: string;
  status: WorkItemStatus;
  hasLiveLease: boolean;
  attempt: number;
  output?: Record<string, unknown>;
};

export type RecoveryWorkItemDecision = {
  workItemId: string;
  disposition: RecoveryDisposition;
  nextStatus: WorkItemStatus;
  reason: string;
};

export type RecoveryMissionInput = {
  status: MissionStatus;
  hasLiveLease: boolean;
  workItems: readonly RecoveryWorkItemInput[];
};

export type RecoveryMissionDecision = {
  disposition: RecoveryDisposition;
  nextMissionStatus: MissionStatus;
  workItems: RecoveryWorkItemDecision[];
  reason: string;
};

export function decideWorkItemRecovery(input: RecoveryWorkItemInput): RecoveryWorkItemDecision {
  if (input.hasLiveLease) return { workItemId: input.id, disposition: "noop", nextStatus: input.status, reason: "A live lease still owns the work item" };
  if (input.status === "claimed" || input.status === "executing") return { workItemId: input.id, disposition: "reconcile", nextStatus: "repairing", reason: "Execution was interrupted without a live lease; reconcile before repeating side effects" };
  if (input.status === "repairing" || input.status === "pending" || input.status === "ready") return { workItemId: input.id, disposition: "resume", nextStatus: input.status, reason: "Work item is already resumable and has no live lease" };
  return { workItemId: input.id, disposition: "noop", nextStatus: input.status, reason: `Work item status ${input.status} does not require restart reconciliation` };
}

export function decideMissionRecovery(input: RecoveryMissionInput): RecoveryMissionDecision {
  const workItems = input.workItems.map(decideWorkItemRecovery);
  const reconciled = workItems.filter((item) => item.disposition === "reconcile");
  if (input.hasLiveLease) return { disposition: "noop", nextMissionStatus: input.status, workItems, reason: "A live lease remains; recovery must not interrupt active execution" };
  if (input.status === "verifying") return { disposition: "repair", nextMissionStatus: "repairing", workItems, reason: "Verification was interrupted; re-enter bounded repair so completion is re-established from durable evidence" };
  if (reconciled.length) return { disposition: "reconcile", nextMissionStatus: input.status, workItems, reason: `${reconciled.length} interrupted work item(s) require reconciliation before resume` };
  if (["queued", "planning", "planned", "executing", "repairing"].includes(input.status)) return { disposition: "resume", nextMissionStatus: input.status, workItems, reason: "Mission is resumable from its durable state" };
  return { disposition: "noop", nextMissionStatus: input.status, workItems, reason: `Mission status ${input.status} is not resumable` };
}

export function recoveryCheckpointState(input: { recoveryId: string; disposition: RecoveryDisposition; previousStatus: MissionStatus; recoveredWorkItemIds: readonly string[]; staleLeaseCount: number }) {
  return { recovery: { recoveryId: input.recoveryId, disposition: input.disposition, previousStatus: input.previousStatus, recoveredWorkItemIds: [...input.recoveredWorkItemIds], staleLeaseCount: input.staleLeaseCount, recordedAt: new Date().toISOString() } };
}
