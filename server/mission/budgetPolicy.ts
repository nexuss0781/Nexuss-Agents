import type { MissionBudget } from "./workflowTypes";

export type BudgetUsage = {
  durationSeconds: number;
  modelTokens: number;
  toolCalls: number;
  agentAttempts: number;
  childWorkItems: number;
  depth: number;
  parallelWorkItems: number;
};

export type BudgetResource = keyof BudgetUsage;

export const BUDGET_LIMITS: Readonly<Record<BudgetResource, keyof MissionBudget>> = {
  durationSeconds: "maxDurationSeconds",
  modelTokens: "maxModelTokens",
  toolCalls: "maxToolCalls",
  agentAttempts: "maxAgentAttempts",
  childWorkItems: "maxChildWorkItems",
  depth: "maxDepth",
  parallelWorkItems: "maxParallelWorkItems",
};

export type BudgetDecision = {
  allowed: boolean;
  resource: BudgetResource;
  current: number;
  requested: number;
  limit: number;
  remaining: number;
  reason: string;
};

export function decideBudget(input: {
  budget: MissionBudget;
  usage: BudgetUsage;
  resource: BudgetResource;
  amount?: number;
}): BudgetDecision {
  const requested = input.amount ?? 1;
  const current = input.usage[input.resource];
  const limit = input.budget[BUDGET_LIMITS[input.resource]];
  const remaining = Math.max(0, limit - current);
  const allowed = requested >= 0 && current + requested <= limit;
  return {
    allowed,
    resource: input.resource,
    current,
    requested,
    limit,
    remaining,
    reason: allowed ? `${input.resource} budget available` : `${input.resource} budget exceeded: ${current + requested} > ${limit}`,
  };
}

export function assertBudget(input: Parameters<typeof decideBudget>[0]) {
  const decision = decideBudget(input);
  if (!decision.allowed) throw new Error(`Workflow budget denied: ${decision.reason}`);
  return decision;
}

export function consumeBudget(usage: BudgetUsage, resource: BudgetResource, amount = 1): BudgetUsage {
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`Invalid budget amount for ${resource}`);
  return { ...usage, [resource]: usage[resource] + amount };
}

export function emptyBudgetUsage(): BudgetUsage {
  return { durationSeconds: 0, modelTokens: 0, toolCalls: 0, agentAttempts: 0, childWorkItems: 0, depth: 0, parallelWorkItems: 0 };
}

export function budgetUsageFromRecord(record: Partial<BudgetUsage>): BudgetUsage {
  const empty = emptyBudgetUsage();
  return Object.fromEntries(Object.keys(empty).map((key) => [key, Math.max(0, Number(record[key as BudgetResource] || 0))])) as unknown as BudgetUsage;
}

export type RetryAttempt = {
  attempt: number;
  parentAttempt?: number;
  strategyFingerprint: string;
  failureId?: string;
  changedCondition: string;
  newInformation: string[];
  verificationMethod: string;
  createdAt: string;
};

export type RetryDecision = {
  allowed: boolean;
  nextAttempt: number;
  reason: string;
};

export function decideRetry(input: {
  budget: MissionBudget;
  currentAttempt: number;
  failureClassification: "retryable" | "repairable" | "replan_required" | "blocked" | "cancelled" | "terminal";
  previousStrategyFingerprint?: string;
  nextStrategyFingerprint: string;
  changedCondition: string;
}): RetryDecision {
  if (input.failureClassification === "blocked" || input.failureClassification === "cancelled" || input.failureClassification === "terminal") return { allowed: false, nextAttempt: input.currentAttempt, reason: `Failure classification ${input.failureClassification} does not permit automatic retry` };
  if (!input.changedCondition.trim()) return { allowed: false, nextAttempt: input.currentAttempt, reason: "A retry must identify a changed condition" };
  if (input.previousStrategyFingerprint && input.previousStrategyFingerprint === input.nextStrategyFingerprint) return { allowed: false, nextAttempt: input.currentAttempt, reason: "Retry strategy is unchanged; re-plan or escalate instead" };
  const nextAttempt = input.currentAttempt + 1;
  const allowed = nextAttempt <= input.budget.maxAgentAttempts;
  return { allowed, nextAttempt, reason: allowed ? "Retry has a changed strategy within budget" : `Agent attempt budget exceeded: ${nextAttempt} > ${input.budget.maxAgentAttempts}` };
}
