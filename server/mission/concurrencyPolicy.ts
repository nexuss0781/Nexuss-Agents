import { createHash } from "node:crypto";
import type { BudgetUsage, RetryAttempt } from "./budgetPolicy";

type ConcurrencyWorkItem = { id: string; missionId: string; status: string };
type DependencyWorkItem = { id: string; dependencies: readonly string[]; status: string };

export type ConcurrencyDecision = {
  allowed: boolean;
  reason: string;
  conflictingWorkItemIds: string[];
};

export function decideConcurrency(input: {
  candidate: ConcurrencyWorkItem;
  active: readonly ConcurrencyWorkItem[];
  maxParallelWorkItems: number;
  exclusiveWorkspace: boolean;
}): ConcurrencyDecision {
  const activeItems = input.active.filter((item) => ["claimed", "running", "repairing"].includes(item.status));
  if (activeItems.length >= input.maxParallelWorkItems) return { allowed: false, reason: "Parallel work-item budget is full", conflictingWorkItemIds: activeItems.map((item) => item.id) };
  const conflicts = input.exclusiveWorkspace
    ? activeItems.filter((item) => item.missionId === input.candidate.missionId).map((item) => item.id)
    : [];
  if (conflicts.length) return { allowed: false, reason: "The candidate requires exclusive workspace access", conflictingWorkItemIds: conflicts };
  return { allowed: true, reason: "Concurrency policy allows the work item", conflictingWorkItemIds: [] };
}

export function assertConcurrency(input: Parameters<typeof decideConcurrency>[0]) {
  const decision = decideConcurrency(input);
  if (!decision.allowed) throw new Error(`Workflow concurrency denied: ${decision.reason}`);
  return decision;
}

export function dependenciesReady(candidate: DependencyWorkItem, allItems: readonly DependencyWorkItem[]) {
  const incomplete = candidate.dependencies.filter((dependencyId) => allItems.find((item) => item.id === dependencyId)?.status !== "completed");
  return { ready: incomplete.length === 0, incompleteDependencyIds: incomplete };
}

export function strategyFingerprint(input: { stage: string; objective: string; action: string; parameters?: Record<string, unknown> }) {
  const canonical = JSON.stringify({ stage: input.stage, objective: input.objective.trim(), action: input.action, parameters: input.parameters || {} }, Object.keys(input.parameters || {}).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

export type LoopDecision = {
  allowed: boolean;
  repeated: number;
  reason: string;
};

export function detectStrategyLoop(input: {
  attempts: readonly RetryAttempt[];
  nextStrategyFingerprint: string;
  maxRepeatedStrategy?: number;
}): LoopDecision {
  const maxRepeated = input.maxRepeatedStrategy ?? 1;
  const repeated = input.attempts.filter((attempt) => attempt.strategyFingerprint === input.nextStrategyFingerprint).length;
  const allowed = repeated < maxRepeated;
  return { allowed, repeated, reason: allowed ? "Strategy has not exceeded the repetition threshold" : "Strategy repetition threshold exceeded; choose a materially different path" };
}

export function canStartParallelWork(usage: BudgetUsage, maxParallelWorkItems: number) {
  return usage.parallelWorkItems < maxParallelWorkItems;
}
