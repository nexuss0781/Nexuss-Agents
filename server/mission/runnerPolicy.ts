import { decideAuthority, type WorkflowAction } from "./authorityPolicy";
import { budgetUsageFromRecord, decideBudget, decideRetry, type BudgetUsage } from "./budgetPolicy";
import { strategyFingerprint } from "./concurrencyPolicy";
import type { MissionWorkItem } from "./store";
import type { MissionBudget } from "./constitution";

export type RunnerBudget = MissionBudget & { maxParallelWorkItems: number };

export function runnerBudget(budget: MissionBudget): RunnerBudget {
  return { ...budget, maxParallelWorkItems: 1 };
}

export function runnerUsage(value: unknown): BudgetUsage {
  if (!value || typeof value !== "object") return budgetUsageFromRecord({});
  return budgetUsageFromRecord(value as Partial<BudgetUsage>);
}

const VERIFICATION_ROLES = ["architect", "repository_architect", "security_auditor", "quality", "quality_gate", "integrator"];

export function authorityForRole(role: string) {
  if (role === "sub_orchestrator") return "delegation_only" as const;
  if (VERIFICATION_ROLES.includes(role)) return "verification_only" as const;
  if (["principal", "principal_orchestrator"].includes(role)) return "mission_owner" as const;
  return "execution_only" as const;
}

const EXPLICIT_ACTIONS: readonly WorkflowAction[] = ["inspect", "read", "search", "calculate", "design", "create", "write", "append", "patch", "replace", "format", "copy", "move", "rename", "delete", "clean_generated", "diff", "apply_patch", "rollback", "snapshot", "restore_snapshot", "branch", "stage", "commit", "push", "research", "publish", "communicate", "deploy"];

export function actionForWorkItem(item: MissionWorkItem): WorkflowAction {
  const requestedAction = item.input?.action;
  if (typeof requestedAction === "string" && EXPLICIT_ACTIONS.includes(requestedAction as WorkflowAction)) return requestedAction as WorkflowAction;
  if (VERIFICATION_ROLES.includes(item.role)) return "inspect";
  if (item.role === "sub_orchestrator") return "design";
  return "write";
}

export function assertWorkItemAuthority(item: MissionWorkItem) {
  const authority = authorityForRole(item.role);
  return decideAuthority({ authority, action: actionForWorkItem(item) });
}

export function classifyRunnerFailure(failureClass?: string) {
  const value = (failureClass || "UNKNOWN").toUpperCase();
  if (value.includes("CANCEL")) return "cancelled" as const;
  if (value.includes("MODEL_NOT_CONFIGURED") || value.includes("PERMISSION") || value.includes("BLOCK")) return "blocked" as const;
  if (value.includes("REPLAN") || value.includes("ARCHITECTURE")) return "replan_required" as const;
  if (value.includes("TIMEOUT") || value.includes("UNAVAILABLE") || value.includes("PROVIDER")) return "retryable" as const;
  return "repairable" as const;
}

export function retryForResult(input: {
  budget: RunnerBudget;
  item: MissionWorkItem;
  failureClass?: string;
  nextAction?: string;
  changedCondition?: string;
  strategyFingerprint?: string;
  previousStrategyFingerprint?: string;
}) {
  const classification = classifyRunnerFailure(input.failureClass);
  const nextStrategyFingerprint = input.strategyFingerprint || strategyFingerprint({
    stage: "execute",
    objective: input.item.description,
    action: input.nextAction || "repair",
    parameters: { failureClass: input.failureClass || "UNKNOWN" },
  });
  const changedCondition = input.changedCondition?.trim() || input.nextAction?.trim() || `Observed ${input.failureClass || "an execution failure"}; inspect the recorded failure before retrying.`;
  const decision = decideRetry({
    budget: input.budget,
    currentAttempt: input.item.attempt,
    failureClassification: classification,
    previousStrategyFingerprint: input.previousStrategyFingerprint,
    nextStrategyFingerprint,
    changedCondition,
  });
  return { ...decision, classification, nextStrategyFingerprint, changedCondition };
}

export function reserveRunnerBudget(input: {
  budget: RunnerBudget;
  usage: BudgetUsage;
  resource: "durationSeconds" | "toolCalls" | "agentAttempts" | "childWorkItems" | "parallelWorkItems";
  amount?: number;
}) {
  return decideBudget(input);
}
