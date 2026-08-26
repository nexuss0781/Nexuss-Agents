import { describe, expect, it } from "vitest";
import {
  artifactSchema,
  evidenceSchema,
  stageResultSchema,
  verificationSchema,
  workflowEventSchema,
  workflowMissionSchema,
} from "./workflowSchemas";

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

const criterion = {
  id: "tests",
  description: "The relevant checks pass",
  verification: "automated" as const,
  required: true,
};

const mission = {
  id: "mission-1",
  ownerId: "owner-1",
  projectId: "project-1",
  contractVersion: "1.0.0" as const,
  objective: "Complete the requested repository investigation",
  contract: {
    version: "1.0.0",
    objective: "Complete the requested repository investigation",
    deliverables: ["Investigation result"],
    requirements: [],
    acceptanceCriteria: [criterion],
    constraints: [],
    assumptions: [],
    requiredSkills: ["repository_inspection"],
    domains: ["software_engineering"],
    riskLevel: "low" as const,
    completionPolicy: ["Pass the quality gate"],
    sourceRefs: [{ kind: "user_input" as const, ref: "source-1" }],
  },
  status: "created" as const,
  budget,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe("workflow schemas", () => {
  it("accepts a complete mission record", () => {
    expect(workflowMissionSchema.parse(mission)).toEqual(mission);
  });

  it("accepts a stage result with a legal stage and references", () => {
    const result = stageResultSchema.parse({
      missionId: "mission-1",
      stageRunId: "stage-run-1",
      stage: "verify",
      status: "succeeded",
      objective: "Verify the requested repository behavior",
      inputRefs: ["artifact-1"],
      decision: "The required checks passed",
      evidenceRefs: ["evidence-1"],
      artifactRefs: ["artifact-1"],
      failedChecks: [],
      nextTransition: "integrate",
      uncertainty: [],
      requiresUserInput: false,
    });
    expect(result.nextTransition).toBe("integrate");
  });

  it("requires provenance for evidence", () => {
    const result = evidenceSchema.safeParse({
      id: "evidence-1",
      missionId: "mission-1",
      kind: "test_result",
      summary: "The focused test passed",
      strength: "strong",
      provenance: [],
      data: {},
      producedBy: "quality-gate",
      observedAt: timestamp,
      createdAt: timestamp,
    });
    expect(result.success).toBe(false);
  });

  it("accepts artifact provenance and a verification record", () => {
    expect(artifactSchema.parse({
      id: "artifact-1",
      missionId: "mission-1",
      kind: "test_result",
      locator: "pnpm test",
      summary: "Focused tests passed",
      metadata: { exitCode: 0 },
      provenance: [{ kind: "tool_operation", ref: "operation-1" }],
      createdAt: timestamp,
    }).id).toBe("artifact-1");

    expect(verificationSchema.parse({
      id: "verification-1",
      missionId: "mission-1",
      subjectRefs: ["artifact-1"],
      method: "Run the focused test suite",
      independenceMode: "runtime_reproduction",
      status: "passed",
      observations: ["All tests passed"],
      failedChecks: [],
      evidenceRefs: ["evidence-1"],
      performedBy: "quality-gate",
      startedAt: timestamp,
      completedAt: timestamp,
    }).status).toBe("passed");
  });

  it("accepts canonical event names and rejects arbitrary event text", () => {
    expect(workflowEventSchema.safeParse({
      id: "event-1",
      missionId: "mission-1",
      type: "filesystem.completed",
      actor: "builder",
      payload: { operation: "write" },
      occurredAt: timestamp,
    }).success).toBe(true);
    expect(workflowEventSchema.safeParse({
      id: "event-2",
      missionId: "mission-1",
      type: "Filesystem Completed",
      actor: "builder",
      payload: {},
      occurredAt: timestamp,
    }).success).toBe(false);
  });
});
