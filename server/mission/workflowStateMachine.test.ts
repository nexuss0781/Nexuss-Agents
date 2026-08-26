import { describe, expect, it } from "vitest";
import { createWorkflowState, WorkflowStateMachine } from "./workflowStateMachine";
import type { WorkflowMission, WorkItem } from "./workflowTypes";

const timestamp = "2026-08-27T00:00:00.000Z";
const budget = {
  maxDurationSeconds: 1_800,
  maxModelTokens: 120_000,
  maxToolCalls: 120,
  maxAgentAttempts: 3,
  maxChildWorkItems: 32,
  maxDepth: 3,
  maxParallelWorkItems: 4,
};
const criterion = { id: "criterion-1", description: "The result is verified", verification: "automated" as const, required: true };

function mission(): WorkflowMission {
  return {
    id: "mission-1",
    ownerId: "owner-1",
    projectId: "project-1",
    contractVersion: "1.0.0",
    objective: "Complete a bounded workflow state-machine test",
    contract: {
      version: "1.0.0",
      objective: "Complete a bounded workflow state-machine test",
      deliverables: ["Verified result"],
      requirements: [],
      acceptanceCriteria: [criterion],
      constraints: [],
      assumptions: [],
      requiredSkills: [],
      domains: ["software_engineering"],
      riskLevel: "low",
      completionPolicy: ["Pass verification"],
      sourceRefs: [{ kind: "user_input", ref: "source-1" }],
    },
    status: "created",
    budget,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function workItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "work-1",
    missionId: "mission-1",
    stage: "execute",
    objective: "Produce the result",
    description: "Produce the result for verification",
    role: "repository_builder",
    status: "pending",
    inputRefs: ["input-1"],
    acceptanceCriteria: [criterion],
    dependencies: [],
    allowedSkills: ["bounded_execution"],
    allowedHarnesses: ["filesystem"],
    budget,
    attempt: 0,
    outputRefs: [],
    failureRefs: [],
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe("workflow state machine", () => {
  it("permits the canonical mission and stage progression", () => {
    const machine = new WorkflowStateMachine(createWorkflowState({ mission: mission(), workItems: [workItem()] }));
    machine.transitionMission("queued", { actor: "system" });
    machine.transitionMission("planning", { actor: "runner" });
    machine.transitionMission("planned", { actor: "orchestrator" });
    machine.transitionMission("executing", { actor: "runner" });
    const started = machine.startStage("receive", { actor: "runner" });
    expect(started.transition.from).toBe("none");
    expect(started.transition.to).toBe("receive");
    machine.transitionStageRun("active", { actor: "runner" });
    const result = machine.snapshot();
    expect(result.activeStage?.status).toBe("active");
  });

  it("rejects an invalid stage jump and a transition from a terminal mission", () => {
    const machine = new WorkflowStateMachine(createWorkflowState({ mission: mission() }));
    expect(() => machine.startStage("verify", { actor: "runner" })).not.toThrow();
    expect(() => machine.startStage("complete", { actor: "runner" })).toThrow(/still pending|Invalid workflow stage advance/);
    machine.transitionMission("queued", { actor: "system" });
    machine.transitionMission("planning", { actor: "runner" });
    machine.transitionMission("planned", { actor: "orchestrator" });
    machine.transitionMission("executing", { actor: "runner" });
    machine.transitionMission("failed", { actor: "runner" });
    machine.transitionMission("cancelled", { actor: "operator" });
    expect(() => machine.transitionMission("queued", { actor: "runner" })).toThrow(/Invalid workflow mission transition/);
  });

  it("requires completed dependencies before a work item can advance", () => {
    const machine = new WorkflowStateMachine(createWorkflowState({ mission: mission(), workItems: [workItem({ id: "dependency", status: "running" }), workItem({ id: "work-2", dependencies: ["dependency"] })] }));
    expect(() => machine.assertDependenciesReady("work-2")).toThrow(/dependencies are incomplete/);
    machine.transitionWorkItem("dependency", "completed", { actor: "builder" });
    expect(machine.assertDependenciesReady("work-2")).toBe(true);
  });

  it("rejects a mismatched or incomplete stage result", () => {
    const machine = new WorkflowStateMachine(createWorkflowState({ mission: mission() }));
    machine.startStage("receive", { actor: "runner" });
    machine.transitionStageRun("active", { actor: "runner" });
    expect(() => machine.transitionStageRun("succeeded", { actor: "runner" }, {
      missionId: "mission-1",
      stageRunId: "wrong-stage-run",
      stage: "receive",
      status: "succeeded",
      objective: "Receive input",
      inputRefs: ["input-1"],
      evidenceRefs: [],
      artifactRefs: [],
      failedChecks: [],
      uncertainty: [],
      requiresUserInput: false,
    })).toThrow(/does not match/);
  });

  it("requires a passing verification before completing a mission", () => {
    const verification = {
      id: "verification-1",
      missionId: "mission-1",
      subjectRefs: ["criterion-1"],
      method: "Run the automated check",
      independenceMode: "runtime_reproduction" as const,
      status: "passed" as const,
      observations: ["The check passed"],
      failedChecks: [],
      evidenceRefs: [],
      performedBy: "quality-gate",
      startedAt: timestamp,
      completedAt: timestamp,
    };
    const machine = new WorkflowStateMachine(createWorkflowState({ mission: mission(), workItems: [workItem({ status: "completed" })], verifications: [verification] }));
    expect(() => machine.assertCanCompleteMission()).not.toThrow();
  });
});
