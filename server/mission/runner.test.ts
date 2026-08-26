import { describe, expect, it, vi, beforeEach } from "vitest";
import { missionRunner } from "./runner";
import type { MissionSnapshot, MissionWorkItem } from "./store";

const store = vi.hoisted(() => ({
  getMission: vi.fn(),
  transitionMission: vi.fn(),
  claimWorkItem: vi.fn(),
  updateWorkItem: vi.fn(),
  releaseWorkItemLease: vi.fn(),
  heartbeatWorkItemLease: vi.fn(),
  saveMissionCheckpoint: vi.fn(),
  listLearningCandidates: vi.fn(),
  listMissionArtifacts: vi.fn(),
  listMissionEvidence: vi.fn(),
  listMissionVerifications: vi.fn(),
  recordMissionEvidence: vi.fn(),
  recordMissionVerification: vi.fn(),
  createWorkItem: vi.fn(),
  createLearningCandidate: vi.fn(),
}));

vi.mock("./store", () => store);

function snapshot(status: MissionSnapshot["mission"]["status"] = "queued"): MissionSnapshot {
  return {
    mission: {
      id: "mission-1",
      ownerId: "owner-1",
      missionType: "autonomous_repository_change",
      goal: "Run a repository change",
      contract: { acceptanceCriteria: [] },
      status,
      budget: { maxDepth: 3, maxChildWorkItems: 32, maxAgentAttempts: 3, maxToolCalls: 120, maxModelTokens: 120_000, maxDurationSeconds: 1_800 },
      version: 1,
      createdAt: "2026-08-23T00:00:00.000Z",
      updatedAt: "2026-08-23T00:00:00.000Z",
    },
    workItems: [],
    events: [],
  };
}

describe("server mission runner", () => {
  beforeEach(() => {
    store.getMission.mockReset();
    store.transitionMission.mockReset();
    store.claimWorkItem.mockReset();
    store.updateWorkItem.mockReset();
    store.releaseWorkItemLease.mockReset();
    store.heartbeatWorkItemLease.mockReset();
    store.saveMissionCheckpoint.mockReset();
    store.saveMissionCheckpoint.mockResolvedValue(undefined);
    store.listLearningCandidates.mockReset();
    store.listMissionArtifacts.mockReset();
    store.listMissionEvidence.mockReset();
    store.listMissionVerifications.mockReset();
    store.recordMissionEvidence.mockReset();
    store.recordMissionVerification.mockReset();
    store.createWorkItem.mockReset();
    store.recordMissionEvidence.mockImplementation(async (_owner: string, _mission: string, input: Record<string, unknown>) => ({ id: `evidence-${String(input.kind)}`, ...input }));
    store.recordMissionVerification.mockImplementation(async (_owner: string, _mission: string, input: Record<string, unknown>) => ({ id: "verification-1", ...input }));
    store.createWorkItem.mockImplementation(async (_owner: string, _mission: string, input: Record<string, unknown>) => ({ id: "work-replan", missionId: "mission-1", ownerId: "owner-1", title: input.title, description: input.description, role: input.role, status: "pending", dependencies: input.dependencies || [], acceptanceCriteria: input.acceptanceCriteria || [], input: input.input || {}, attempt: 0, version: 1, createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z" }));
    store.createLearningCandidate.mockReset();
    store.listLearningCandidates.mockResolvedValue([]);
    store.listMissionArtifacts.mockResolvedValue([]);
    store.listMissionEvidence.mockResolvedValue([]);
    store.listMissionVerifications.mockResolvedValue([]);
    store.createLearningCandidate.mockImplementation(async (_owner: string, _mission: string, input: Record<string, unknown>) => ({ id: `candidate-${String(input.candidateType)}`, ...input }));
    missionRunner.configureExecutor(undefined);
    missionRunner.configureOrchestrator(undefined);
  });

  it("progresses a queued mission through execution, verification, and completion", async () => {
    let current = snapshot("queued");
    store.getMission.mockImplementation(async () => current);
    store.transitionMission.mockImplementation(async (_owner: string, _id: string, from: string, to: string, version: number) => {
      expect(current.mission.status).toBe(from);
      current = { ...current, mission: { ...current.mission, status: to as typeof current.mission.status, version: version + 1 } };
      return current.mission;
    });
    missionRunner.configureExecutor(async () => ({ verified: true, summary: "Repository checks passed" }));

    await missionRunner.start("owner-1", "mission-1");

    expect(current.mission.status).toBe("completed");
    expect(store.transitionMission.mock.calls.map((call) => [call[2], call[3]])).toEqual([
      ["queued", "planning"],
      ["planning", "planned"],
      ["planned", "executing"],
      ["executing", "verifying"],
      ["verifying", "completed"],
    ]);
  });

  it("plans a dependency-ready work graph before executing its first item", async () => {
    let current = snapshot("queued");
    const item: MissionWorkItem = { id: "work-1", missionId: "mission-1", ownerId: "owner-1", title: "Inspect repository", description: "Inspect", role: "architect", status: "pending", dependencies: [], acceptanceCriteria: [], input: {}, attempt: 0, version: 1, createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" };
    store.getMission.mockImplementation(async () => current);
    store.transitionMission.mockImplementation(async (_owner: string, _id: string, from: string, to: string, version: number) => {
      current = { ...current, mission: { ...current.mission, status: to as typeof current.mission.status, version: version + 1 } };
      return current.mission;
    });
    store.claimWorkItem.mockImplementation(async () => ({ workItem: { ...item, status: "claimed", attempt: 1, version: 2 }, lease: { workItemId: item.id, workerId: "runner-test" } }));
    store.updateWorkItem.mockImplementation(async (_owner: string, _id: string, patch: { status?: string; expectedVersion: number }) => {
      current = { ...current, workItems: [{ ...item, status: patch.status as MissionWorkItem["status"], attempt: 1, version: patch.expectedVersion + 1 }] };
      return current.workItems[0];
    });
    store.releaseWorkItemLease.mockResolvedValue({ workItemId: item.id, released: true });
    const orchestrator = vi.fn(async () => { current = { ...current, workItems: [item] }; return { workItems: [item], summary: "planned" }; });
    const executor = vi.fn(async ({ activeWorkItem }: { activeWorkItem?: MissionWorkItem }) => ({ verified: true, summary: activeWorkItem?.title || "none" }));
    missionRunner.configureOrchestrator(orchestrator);
    missionRunner.configureExecutor(executor);

    await missionRunner.start("owner-1", "mission-1");

    expect(orchestrator).toHaveBeenCalledWith("owner-1", "mission-1", expect.any(AbortSignal));
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({ activeWorkItem: expect.objectContaining({ id: "work-1", status: "claimed" }) }));
    expect(current.mission.status).toBe("completed");
  });

  it("deduplicates concurrent starts for the same mission", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let current = snapshot("queued");
    store.getMission.mockImplementation(async () => current);
    store.transitionMission.mockImplementation(async (_owner: string, _id: string, _from: string, to: string, version: number) => {
      current = { ...current, mission: { ...current.mission, status: to as typeof current.mission.status, version: version + 1 } };
      return current.mission;
    });
    missionRunner.configureExecutor(async () => { await gate; return { verified: true, summary: "Completed" }; });

    const first = missionRunner.start("owner-1", "mission-1");
    const second = missionRunner.start("owner-1", "mission-1");
    expect(first).toBe(second);
    release();
    await first;
  });

  it("denies a reviewer work item that explicitly requests a write before claiming it", async () => {
    let current = snapshot("planned");
    const item: MissionWorkItem = { id: "work-review", missionId: "mission-1", ownerId: "owner-1", title: "Review", description: "Review the repository", role: "quality_gate", status: "pending", dependencies: [], acceptanceCriteria: [], input: { action: "write" }, attempt: 0, version: 1, createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" };
    current = { ...current, workItems: [item] };
    store.getMission.mockImplementation(async () => current);
    store.transitionMission.mockImplementation(async (_owner: string, _id: string, from: string, to: string, version: number) => {
      expect(current.mission.status).toBe(from);
      current = { ...current, mission: { ...current.mission, status: to as typeof current.mission.status, version: version + 1 } };
      return current.mission;
    });
    const executor = vi.fn(async () => ({ verified: true, summary: "should not run" }));
    missionRunner.configureExecutor(executor);

    await missionRunner.start("owner-1", "mission-1");

    expect(executor).not.toHaveBeenCalled();
    expect(store.claimWorkItem).not.toHaveBeenCalled();
    expect(current.mission.status).toBe("failed");
    expect(store.transitionMission).toHaveBeenLastCalledWith("owner-1", "mission-1", "executing", "failed", expect.any(Number), expect.any(String), expect.objectContaining({ code: "MISSION_AUTHORITY_DENIED" }));
  });

  it("denies an execution attempt when the agent-attempt budget is already exhausted", async () => {
    let current = snapshot("planned");
    current = { ...current, mission: { ...current.mission, budget: { ...current.mission.budget, maxAgentAttempts: 0 } } };
    store.getMission.mockImplementation(async () => current);
    store.transitionMission.mockImplementation(async (_owner: string, _id: string, from: string, to: string, version: number) => {
      current = { ...current, mission: { ...current.mission, status: to as typeof current.mission.status, version: version + 1 } };
      return current.mission;
    });
    const executor = vi.fn(async () => ({ verified: true, summary: "should not run" }));
    missionRunner.configureExecutor(executor);

    await missionRunner.start("owner-1", "mission-1");

    expect(executor).not.toHaveBeenCalled();
    expect(store.claimWorkItem).not.toHaveBeenCalled();
    expect(current.mission.status).toBe("failed");
    expect(store.transitionMission).toHaveBeenLastCalledWith("owner-1", "mission-1", "executing", "failed", expect.any(Number), expect.any(String), expect.objectContaining({ code: "MISSION_BUDGET_DENIED" }));
  });

  it("denies quality completion without durable evidence-backed verification", async () => {
    let current = snapshot("planned");
    const item: MissionWorkItem = { id: "work-quality", missionId: "mission-1", ownerId: "owner-1", title: "Verify", description: "Verify the change", role: "quality", status: "pending", dependencies: [], acceptanceCriteria: [], input: {}, attempt: 0, version: 1, createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" };
    current = { ...current, workItems: [item] };
    store.getMission.mockImplementation(async () => current);
    store.transitionMission.mockImplementation(async (_owner: string, _id: string, from: string, to: string, version: number) => { current = { ...current, mission: { ...current.mission, status: to as typeof current.mission.status, version: version + 1 } }; return current.mission; });
    store.claimWorkItem.mockImplementation(async () => ({ workItem: { ...item, status: "claimed" as const, attempt: 1, version: 2 }, lease: { workItemId: item.id, workerId: "runner-test" } }));
    store.updateWorkItem.mockResolvedValue({ ...item, status: "failed", version: 3 });
    store.releaseWorkItemLease.mockResolvedValue({ workItemId: item.id, released: true });
    missionRunner.configureExecutor(async () => ({ verified: true, summary: "Quality claimed completion without evidence" }));
    await missionRunner.start("owner-1", "mission-1");
    expect(current.mission.status).toBe("failed");
    expect(store.recordMissionEvidence).not.toHaveBeenCalled();
    expect(store.transitionMission).toHaveBeenLastCalledWith("owner-1", "mission-1", "executing", "failed", expect.any(Number), expect.any(String), expect.objectContaining({ code: "MISSION_EVIDENCE_INCOMPLETE" }));
  });

  it("accepts quality completion with durable evidence and independent verification", async () => {
    let current = snapshot("planned");
    const item: MissionWorkItem = { id: "work-quality-pass", missionId: "mission-1", ownerId: "owner-1", title: "Verify", description: "Verify the change", role: "quality", status: "pending", dependencies: [], acceptanceCriteria: [], input: {}, attempt: 0, version: 1, createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" };
    current = { ...current, workItems: [item] };
    store.getMission.mockImplementation(async () => current);
    store.transitionMission.mockImplementation(async (_owner: string, _id: string, _from: string, to: string, version: number) => { current = { ...current, mission: { ...current.mission, status: to as typeof current.mission.status, version: version + 1 } }; return current.mission; });
    store.claimWorkItem.mockImplementation(async () => ({ workItem: { ...item, status: "claimed" as const, attempt: 1, version: 2 }, lease: { workItemId: item.id, workerId: "runner-test" } }));
    store.updateWorkItem.mockImplementation(async (_owner: string, _id: string, patch: { status?: MissionWorkItem["status"]; output?: Record<string, unknown>; expectedVersion: number }) => { const updated = { ...item, status: patch.status || item.status, output: patch.output, attempt: 1, version: patch.expectedVersion + 1 }; current = { ...current, workItems: [updated] }; return updated; });
    store.releaseWorkItemLease.mockResolvedValue({ workItemId: item.id, released: true });
    missionRunner.configureExecutor(async () => ({ verified: true, summary: "Quality verified", evidence: [{ kind: "test_result", summary: "Tests passed", strength: "strong", provenance: [{ kind: "command", ref: "pnpm test" }] }], verifications: [{ subjectRefs: ["work-quality-pass"], method: "independent test", independenceMode: "separate_agent", status: "passed", performedBy: "quality-gate" }] }));
    await missionRunner.start("owner-1", "mission-1");
    expect(current.mission.status).toBe("completed");
    expect(store.recordMissionEvidence).toHaveBeenCalledTimes(1);
    expect(store.recordMissionVerification).toHaveBeenCalledTimes(1);
  });

  it("fails mission completion when required acceptance evidence is absent", async () => {
    let current = snapshot("queued");
    current = { ...current, mission: { ...current.mission, contract: { acceptanceCriteria: [{ id: "criterion-1", description: "A required check", verification: "automated", required: true }] } } };
    store.getMission.mockImplementation(async () => current);
    store.transitionMission.mockImplementation(async (_owner: string, _id: string, _from: string, to: string, version: number) => { current = { ...current, mission: { ...current.mission, status: to as typeof current.mission.status, version: version + 1 } }; return current.mission; });
    missionRunner.configureExecutor(async () => ({ verified: true, summary: "Execution finished without acceptance evidence" }));
    await missionRunner.start("owner-1", "mission-1");
    expect(current.mission.status).toBe("failed");
    expect(store.transitionMission).toHaveBeenLastCalledWith("owner-1", "mission-1", "verifying", "failed", expect.any(Number), expect.any(String), expect.objectContaining({ code: "MISSION_ACCEPTANCE_INCOMPLETE", unsatisfiedCriteria: ["criterion-1"] }));
  });

  it("blocks high-risk completion without risk-required quality evidence", async () => {
    let current = snapshot("queued");
    current = { ...current, mission: { ...current.mission, contract: { acceptanceCriteria: [], riskLevel: "high" } } };
    store.getMission.mockImplementation(async () => current);
    store.transitionMission.mockImplementation(async (_owner: string, _id: string, _from: string, to: string, version: number) => { current = { ...current, mission: { ...current.mission, status: to as typeof current.mission.status, version: version + 1 } }; return current.mission; });
    missionRunner.configureExecutor(async () => ({ verified: true, summary: "High-risk execution finished without quality evidence" }));
    await missionRunner.start("owner-1", "mission-1");
    expect(current.mission.status).toBe("failed");
    expect(store.transitionMission).toHaveBeenLastCalledWith("owner-1", "mission-1", "verifying", "failed", expect.any(Number), expect.any(String), expect.objectContaining({ code: "MISSION_QUALITY_GATE_INCOMPLETE", missingEvidenceKinds: ["quality_check", "security_review"] }));
  });

  it("creates a replacement work item when diagnosis requires re-planning", async () => {
    let current = snapshot("planned");
    const item: MissionWorkItem = { id: "work-replan-source", missionId: "mission-1", ownerId: "owner-1", title: "Architecture", description: "Implement the architecture", role: "repository_builder", status: "pending", dependencies: [], acceptanceCriteria: [], input: {}, attempt: 0, version: 1, createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" };
    current = { ...current, workItems: [item] };
    store.getMission.mockImplementation(async () => current);
    store.transitionMission.mockImplementation(async (_owner: string, _id: string, _from: string, to: string, version: number) => { current = { ...current, mission: { ...current.mission, status: to as typeof current.mission.status, version: version + 1 } }; return current.mission; });
    store.claimWorkItem.mockImplementation(async () => ({ workItem: { ...item, status: "claimed" as const, attempt: 1, version: 2 }, lease: { workItemId: item.id, workerId: "runner-test" } }));
    store.updateWorkItem.mockImplementation(async (_owner: string, _id: string, patch: { status?: MissionWorkItem["status"]; output?: Record<string, unknown>; expectedVersion: number }) => { const updated = { ...item, status: patch.status || item.status, output: patch.output, attempt: 1, version: patch.expectedVersion + 1 }; current = { ...current, workItems: [updated, { id: "work-replan", missionId: "mission-1", ownerId: "owner-1", title: "Repair", description: "Re-plan", role: "repository_builder", status: "pending", dependencies: [], acceptanceCriteria: [], input: {}, attempt: 0, version: 1, createdAt: item.createdAt, updatedAt: item.updatedAt }] }; return updated; });
    store.releaseWorkItemLease.mockResolvedValue({ workItemId: item.id, released: true });
    missionRunner.configureExecutor(async () => ({ verified: false, summary: "Architecture is incompatible", failureClass: "ARCHITECTURE_INVALID", changedCondition: "The dependency graph contradicts the repository structure", nextAction: "re-plan the affected branch" }));
    await missionRunner.start("owner-1", "mission-1");
    expect(store.createWorkItem).toHaveBeenCalledWith("owner-1", "mission-1", expect.objectContaining({ parentWorkItemId: item.id, input: expect.objectContaining({ repairOf: item.id }) }));
    expect(current.mission.status).toBe("repairing");
    expect(current.workItems[0]?.status).toBe("cancelled");
  });

  it("escalates a repeated repair strategy instead of looping", async () => {
    let current = snapshot("planned");
    const item: MissionWorkItem = { id: "work-repair", missionId: "mission-1", ownerId: "owner-1", title: "Build", description: "Build the change", role: "repository_builder", status: "pending", dependencies: [], acceptanceCriteria: [], input: {}, attempt: 0, version: 1, createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" };
    current = { ...current, workItems: [item] };
    store.getMission.mockImplementation(async () => current);
    store.transitionMission.mockImplementation(async (_owner: string, _id: string, from: string, to: string, version: number) => {
      expect(current.mission.status).toBe(from);
      current = { ...current, mission: { ...current.mission, status: to as typeof current.mission.status, version: version + 1 } };
      return current.mission;
    });
    store.claimWorkItem.mockImplementation(async () => {
      const source = current.workItems[0];
      const claimed = { ...source, status: "claimed" as const, attempt: source.attempt + 1, version: source.version + 1 };
      return { workItem: claimed, lease: { workItemId: source.id, workerId: "runner-test" } };
    });
    store.updateWorkItem.mockImplementation(async (_owner: string, _id: string, patch: { status?: MissionWorkItem["status"]; output?: Record<string, unknown>; expectedVersion: number }) => {
      const source = current.workItems[0];
      const updated = { ...source, status: patch.status || source.status, output: patch.output, version: patch.expectedVersion + 1 };
      current = { ...current, workItems: [updated] };
      return updated;
    });
    store.releaseWorkItemLease.mockResolvedValue({ workItemId: item.id, released: true });
    missionRunner.configureExecutor(async () => ({ verified: false, summary: "Build failed", failureClass: "COMMAND_FAILED", nextAction: "repair the build" }));

    await missionRunner.start("owner-1", "mission-1");
    expect(current.mission.status).toBe("repairing");
    expect(current.workItems[0]?.status).toBe("repairing");

    await missionRunner.start("owner-1", "mission-1");

    expect(current.mission.status).toBe("failed");
    expect(current.workItems[0]?.status).toBe("failed");
    expect(current.workItems[0]?.output).toEqual(expect.objectContaining({ retryAllowed: false, retryReason: expect.stringContaining("unchanged") }));
  });

  it("accepts a repair when the executor supplies a changed strategy fingerprint", async () => {
    let current = snapshot("planned");
    const item: MissionWorkItem = { id: "work-strategy", missionId: "mission-1", ownerId: "owner-1", title: "Build", description: "Build the change", role: "repository_builder", status: "pending", dependencies: [], acceptanceCriteria: [], input: {}, attempt: 0, version: 1, createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" };
    current = { ...current, workItems: [item] };
    store.getMission.mockImplementation(async () => current);
    store.transitionMission.mockImplementation(async (_owner: string, _id: string, from: string, to: string, version: number) => {
      expect(current.mission.status).toBe(from);
      current = { ...current, mission: { ...current.mission, status: to as typeof current.mission.status, version: version + 1 } };
      return current.mission;
    });
    store.claimWorkItem.mockImplementation(async () => {
      const source = current.workItems[0];
      return { workItem: { ...source, status: "claimed" as const, attempt: source.attempt + 1, version: source.version + 1 }, lease: { workItemId: source.id, workerId: "runner-test" } };
    });
    store.updateWorkItem.mockImplementation(async (_owner: string, _id: string, patch: { status?: MissionWorkItem["status"]; output?: Record<string, unknown>; expectedVersion: number }) => {
      const source = current.workItems[0];
      const updated = { ...source, status: patch.status || source.status, output: patch.output, version: patch.expectedVersion + 1 };
      current = { ...current, workItems: [updated] };
      return updated;
    });
    store.releaseWorkItemLease.mockResolvedValue({ workItemId: item.id, released: true });
    let strategy = "strategy-a";
    missionRunner.configureExecutor(async () => ({ verified: false, summary: "Build failed", failureClass: "COMMAND_FAILED", nextAction: "repair the build", changedCondition: "The repair path changed", strategyFingerprint: strategy }));

    await missionRunner.start("owner-1", "mission-1");
    strategy = "strategy-b";
    await missionRunner.start("owner-1", "mission-1");

    expect(current.mission.status).toBe("repairing");
    expect(current.workItems[0]?.status).toBe("repairing");
    expect(current.workItems[0]?.output).toEqual(expect.objectContaining({ retryAllowed: true, strategyFingerprint: "strategy-b" }));
  });

  it("cancels an active run without converting cancellation into a failure", async () => {
    let current = snapshot("queued");
    let executorStarted!: () => void;
    const executorReady = new Promise<void>((resolve) => { executorStarted = resolve; });
    store.getMission.mockImplementation(async () => current);
    store.transitionMission.mockImplementation(async (_owner: string, _id: string, _from: string, to: string, version: number) => {
      current = { ...current, mission: { ...current.mission, status: to as typeof current.mission.status, version: version + 1 } };
      return current.mission;
    });
    missionRunner.configureExecutor(async ({ signal }) => {
      executorStarted();
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      return { verified: false, summary: "Cancelled" };
    });

    const run = missionRunner.start("owner-1", "mission-1");
    await executorReady;
    expect(missionRunner.cancel("owner-1", "mission-1")).toBe(true);
    await run;
    expect(current.mission.status).toBe("executing");
  });
});
