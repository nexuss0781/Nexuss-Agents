import {
  assertMissionTransition,
  assertStageAdvance,
  assertStageRunTransition,
  assertWorkItemTransition,
  isTerminalMissionStatus,
  isTerminalStageRunStatus,
  isTerminalWorkItemStatus,
  validateStageResult,
} from "./workflowTransitions";
import type {
  Decision,
  Failure,
  StageResult,
  StageRun,
  StageRunStatus,
  Verification,
  WorkflowEvent,
  WorkflowMission,
  WorkflowMissionStatus,
  WorkflowStage,
  WorkflowWorkItemStatus,
  WorkItem,
} from "./workflowTypes";

export type WorkflowState = {
  mission: WorkflowMission;
  activeStage?: StageRun;
  workItems: WorkItem[];
  decisions: Decision[];
  failures: Failure[];
  verifications: Verification[];
  events: WorkflowEvent[];
};

export type WorkflowTransition = {
  kind: "mission" | "stage_run" | "work_item" | "stage";
  from: string;
  to: string;
  missionId: string;
  stageRunId?: string;
  workItemId?: string;
  actor: string;
  reason?: string;
  occurredAt: string;
};

export type TransitionOptions = {
  actor: string;
  reason?: string;
  occurredAt?: string;
};

function now() {
  return new Date().toISOString();
}

function cloneState(state: WorkflowState): WorkflowState {
  return {
    mission: { ...state.mission, contract: { ...state.mission.contract, requirements: [...state.mission.contract.requirements], acceptanceCriteria: [...state.mission.contract.acceptanceCriteria], deliverables: [...state.mission.contract.deliverables], constraints: [...state.mission.contract.constraints], assumptions: [...state.mission.contract.assumptions], requiredSkills: [...state.mission.contract.requiredSkills], domains: [...state.mission.contract.domains], completionPolicy: [...state.mission.contract.completionPolicy], sourceRefs: [...state.mission.contract.sourceRefs] }, budget: { ...state.mission.budget } },
    ...(state.activeStage ? { activeStage: { ...state.activeStage, inputRefs: [...state.activeStage.inputRefs], outputRefs: [...state.activeStage.outputRefs] } } : {}),
    workItems: state.workItems.map((item) => ({ ...item, inputRefs: [...item.inputRefs], acceptanceCriteria: [...item.acceptanceCriteria], dependencies: [...item.dependencies], allowedSkills: [...item.allowedSkills], allowedHarnesses: [...item.allowedHarnesses], budget: { ...item.budget }, outputRefs: [...item.outputRefs], failureRefs: [...item.failureRefs] })),
    decisions: [...state.decisions],
    failures: [...state.failures],
    verifications: [...state.verifications],
    events: [...state.events],
  };
}

function transition(kind: WorkflowTransition["kind"], state: WorkflowState, from: string, to: string, options: TransitionOptions, refs: Pick<WorkflowTransition, "stageRunId" | "workItemId"> = {}): WorkflowTransition {
  return { kind, from, to, missionId: state.mission.id, ...refs, actor: options.actor, ...(options.reason ? { reason: options.reason } : {}), occurredAt: options.occurredAt || now() };
}

export class WorkflowStateMachine {
  private state: WorkflowState;

  constructor(initial: WorkflowState) {
    this.state = cloneState(initial);
  }

  snapshot(): WorkflowState {
    return cloneState(this.state);
  }

  transitionMission(to: WorkflowMissionStatus, options: TransitionOptions): WorkflowTransition {
    const from = this.state.mission.status;
    assertMissionTransition(from, to);
    const record = transition("mission", this.state, from, to, options);
    this.state.mission = {
      ...this.state.mission,
      status: to,
      version: this.state.mission.version + 1,
      updatedAt: record.occurredAt,
      ...(to === "executing" && !this.state.mission.startedAt ? { startedAt: record.occurredAt } : {}),
      ...(isTerminalMissionStatus(to) ? { completedAt: record.occurredAt } : {}),
    };
    return record;
  }

  startStage(stage: WorkflowStage, options: TransitionOptions): { stageRun: StageRun; transition: WorkflowTransition } {
    if (this.state.activeStage && !isTerminalStageRunStatus(this.state.activeStage.status)) {
      throw new Error(`Cannot start ${stage}; stage ${this.state.activeStage.stage} is still ${this.state.activeStage.status}`);
    }
    const previousStage = this.state.activeStage?.stage;
    if (previousStage) assertStageAdvance(previousStage, stage);
    const stageRun: StageRun = {
      id: `stage-run-${this.state.mission.id}-${stage}-${this.state.mission.version + 1}`,
      missionId: this.state.mission.id,
      stage,
      status: "pending",
      attempt: 0,
      inputRefs: [],
      outputRefs: [],
      createdAt: options.occurredAt || now(),
    };
    this.state.activeStage = stageRun;
    const record = transition("stage", this.state, previousStage || "none", stage, options, { stageRunId: stageRun.id });
    return { stageRun: { ...stageRun }, transition: record };
  }

  transitionStageRun(to: StageRunStatus, options: TransitionOptions, result?: StageResult): WorkflowTransition {
    const active = this.state.activeStage;
    if (!active) throw new Error("No active workflow stage run");
    assertStageRunTransition(active.status, to);
    if (result) {
      const parsed = validateStageResult(result);
      if (parsed.missionId !== this.state.mission.id || parsed.stageRunId !== active.id || parsed.stage !== active.stage || parsed.status !== to) {
        throw new Error("Stage result does not match the active stage run");
      }
      active.inputRefs = [...parsed.inputRefs];
      active.outputRefs = [...parsed.artifactRefs, ...parsed.evidenceRefs];
      if (parsed.status === "succeeded" && !parsed.nextTransition && active.stage !== "report_continue") {
        throw new Error("A succeeded stage result must declare its next transition");
      }
    }
    const record = transition("stage_run", this.state, active.status, to, options, { stageRunId: active.id });
    this.state.activeStage = {
      ...active,
      status: to,
      attempt: active.attempt + (active.status === "pending" ? 1 : 0),
      ...(to === "active" && !active.startedAt ? { startedAt: record.occurredAt } : {}),
      ...(isTerminalStageRunStatus(to) ? { completedAt: record.occurredAt } : {}),
    };
    return record;
  }

  transitionWorkItem(workItemId: string, to: WorkflowWorkItemStatus, options: TransitionOptions): WorkflowTransition {
    const item = this.state.workItems.find((candidate) => candidate.id === workItemId);
    if (!item) throw new Error(`Workflow work item not found: ${workItemId}`);
    assertWorkItemTransition(item.status, to);
    const record = transition("work_item", this.state, item.status, to, options, { workItemId });
    item.status = to;
    item.version += 1;
    item.updatedAt = record.occurredAt;
    return record;
  }

  assertDependenciesReady(workItemId: string) {
    const item = this.state.workItems.find((candidate) => candidate.id === workItemId);
    if (!item) throw new Error(`Workflow work item not found: ${workItemId}`);
    const incomplete = item.dependencies.filter((dependencyId) => {
      const dependency = this.state.workItems.find((candidate) => candidate.id === dependencyId);
      return !dependency || dependency.status !== "completed";
    });
    if (incomplete.length) throw new Error(`Workflow work item dependencies are incomplete: ${incomplete.join(", ")}`);
    return true;
  }

  assertCanCompleteMission() {
    if (this.state.workItems.some((item) => !["completed", "cancelled"].includes(item.status))) throw new Error("Workflow mission has unresolved work items");
    if (this.state.mission.contract.acceptanceCriteria.some((criterion) => criterion.required && !this.state.verifications.some((verification) => verification.subjectRefs.includes(criterion.id) && verification.status === "passed"))) {
      throw new Error("Workflow mission has acceptance criteria without passing verification");
    }
    if (!this.state.verifications.some((verification) => verification.status === "passed")) throw new Error("Workflow mission has no passing verification");
    return true;
  }
}

export function createWorkflowState(input: { mission: WorkflowMission; workItems?: WorkItem[]; activeStage?: StageRun; decisions?: Decision[]; failures?: Failure[]; verifications?: Verification[]; events?: WorkflowEvent[] }): WorkflowState {
  return {
    mission: input.mission,
    workItems: input.workItems || [],
    ...(input.activeStage ? { activeStage: input.activeStage } : {}),
    decisions: input.decisions || [],
    failures: input.failures || [],
    verifications: input.verifications || [],
    events: input.events || [],
  };
}
