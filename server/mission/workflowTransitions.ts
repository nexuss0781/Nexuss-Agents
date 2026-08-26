import {
  MISSION_STATUSES,
  STAGE_RUN_STATUSES,
  WORKFLOW_STAGES,
  WORK_ITEM_STATUSES,
  type StageRunStatus,
  type WorkflowMissionStatus,
  type WorkflowStage,
  type WorkflowWorkItemStatus,
} from "./workflowTypes";
import { stageResultSchema } from "./workflowSchemas";
import type { StageResult } from "./workflowTypes";

export const MISSION_TRANSITIONS: Readonly<Record<WorkflowMissionStatus, readonly WorkflowMissionStatus[]>> = {
  created: ["queued", "awaiting_user", "blocked", "cancelled"],
  queued: ["planning", "awaiting_user", "blocked", "cancelled"],
  planning: ["planned", "awaiting_user", "blocked", "failed", "cancelled"],
  planned: ["executing", "awaiting_user", "blocked", "failed", "cancelled"],
  executing: ["verifying", "repairing", "awaiting_user", "blocked", "failed", "cancelled"],
  verifying: ["completed", "repairing", "awaiting_user", "blocked", "failed", "cancelled"],
  repairing: ["planning", "executing", "verifying", "awaiting_user", "blocked", "failed", "cancelled"],
  awaiting_user: ["queued", "planning", "executing", "repairing", "blocked", "cancelled"],
  blocked: ["queued", "planning", "cancelled"],
  failed: ["queued", "repairing", "cancelled"],
  stopped: ["queued"],
  completed: [],
  cancelled: [],
};

export const STAGE_RUN_TRANSITIONS: Readonly<Record<StageRunStatus, readonly StageRunStatus[]>> = {
  pending: ["active", "cancelled", "expired"],
  active: ["paused", "awaiting_input", "succeeded", "repair_required", "failed", "cancelled", "expired"],
  paused: ["active", "cancelled", "expired"],
  awaiting_input: ["active", "cancelled", "expired"],
  succeeded: [],
  repair_required: [],
  failed: [],
  cancelled: [],
  expired: [],
};

export const WORK_ITEM_TRANSITIONS: Readonly<Record<WorkflowWorkItemStatus, readonly WorkflowWorkItemStatus[]>> = {
  pending: ["ready", "blocked", "cancelled", "expired"],
  ready: ["claimed", "blocked", "cancelled", "expired"],
  claimed: ["running", "waiting", "failed", "cancelled", "expired"],
  running: ["waiting", "repairing", "completed", "failed", "blocked", "cancelled", "expired"],
  waiting: ["ready", "running", "blocked", "cancelled", "expired"],
  repairing: ["ready", "running", "completed", "failed", "blocked", "cancelled", "expired"],
  completed: [],
  failed: ["repairing", "ready", "cancelled"],
  blocked: ["ready", "cancelled"],
  cancelled: [],
  expired: ["ready", "cancelled"],
};

const STAGE_FORWARD_TRANSITIONS: Readonly<Record<WorkflowStage, readonly WorkflowStage[]>> = {
  receive: ["understand"],
  understand: ["intake"],
  intake: ["form_mission"],
  form_mission: ["plan"],
  plan: ["decompose_delegate"],
  decompose_delegate: ["research_inspect"],
  research_inspect: ["design_reason"],
  design_reason: ["execute"],
  execute: ["observe_adapt", "verify", "repair_recover"],
  observe_adapt: ["research_inspect", "design_reason", "execute", "verify", "repair_recover", "plan"],
  verify: ["integrate", "repair_recover", "quality_gate"],
  repair_recover: ["research_inspect", "design_reason", "execute", "verify", "plan"],
  integrate: ["quality_gate"],
  quality_gate: ["complete", "repair_recover", "plan"],
  complete: ["report_continue"],
  report_continue: ["receive"],
};

export function isWorkflowStage(value: string): value is WorkflowStage {
  return (WORKFLOW_STAGES as readonly string[]).includes(value);
}

export function isMissionStatus(value: string): value is WorkflowMissionStatus {
  return (MISSION_STATUSES as readonly string[]).includes(value);
}

export function isStageRunStatus(value: string): value is StageRunStatus {
  return (STAGE_RUN_STATUSES as readonly string[]).includes(value);
}

export function isWorkItemStatus(value: string): value is WorkflowWorkItemStatus {
  return (WORK_ITEM_STATUSES as readonly string[]).includes(value);
}

export function canTransitionMission(from: WorkflowMissionStatus, to: WorkflowMissionStatus) {
  return MISSION_TRANSITIONS[from].includes(to);
}

export function canTransitionStageRun(from: StageRunStatus, to: StageRunStatus) {
  return STAGE_RUN_TRANSITIONS[from].includes(to);
}

export function canTransitionWorkItem(from: WorkflowWorkItemStatus, to: WorkflowWorkItemStatus) {
  return WORK_ITEM_TRANSITIONS[from].includes(to);
}

export function canAdvanceStage(from: WorkflowStage, to: WorkflowStage) {
  return STAGE_FORWARD_TRANSITIONS[from].includes(to);
}

export function assertMissionTransition(from: WorkflowMissionStatus, to: WorkflowMissionStatus) {
  if (!canTransitionMission(from, to)) throw new Error(`Invalid workflow mission transition: ${from} → ${to}`);
}

export function assertStageRunTransition(from: StageRunStatus, to: StageRunStatus) {
  if (!canTransitionStageRun(from, to)) throw new Error(`Invalid workflow stage-run transition: ${from} → ${to}`);
}

export function assertWorkItemTransition(from: WorkflowWorkItemStatus, to: WorkflowWorkItemStatus) {
  if (!canTransitionWorkItem(from, to)) throw new Error(`Invalid workflow work-item transition: ${from} → ${to}`);
}

export function assertStageAdvance(from: WorkflowStage, to: WorkflowStage) {
  if (!canAdvanceStage(from, to)) throw new Error(`Invalid workflow stage advance: ${from} → ${to}`);
}

export function isTerminalMissionStatus(status: WorkflowMissionStatus) {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "stopped";
}

export function isTerminalStageRunStatus(status: StageRunStatus) {
  return ["succeeded", "repair_required", "failed", "cancelled", "expired"].includes(status);
}

export function isTerminalWorkItemStatus(status: WorkflowWorkItemStatus) {
  return ["completed", "failed", "blocked", "cancelled", "expired"].includes(status);
}

export function validateStageResult(result: StageResult) {
  const parsed = stageResultSchema.parse(result);
  if (parsed.status === "succeeded" && parsed.nextTransition) assertStageAdvance(parsed.stage, parsed.nextTransition);
  if (parsed.status === "repair_required" && parsed.nextTransition && parsed.nextTransition !== "repair_recover") {
    throw new Error("A repair-required stage result must transition to repair_recover");
  }
  if (parsed.status === "awaiting_input" && !parsed.requiresUserInput) {
    throw new Error("An awaiting-input stage result must require user input");
  }
  if (parsed.status !== "awaiting_input" && parsed.requiresUserInput) {
    throw new Error("Only an awaiting-input stage result may require user input");
  }
  if (parsed.status === "failed" && parsed.failedChecks.length === 0 && parsed.uncertainty.length === 0) {
    throw new Error("A failed stage result must preserve a failed check or uncertainty");
  }
  return parsed;
}
