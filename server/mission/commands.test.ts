import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  getMission: vi.fn(),
  listMissions: vi.fn(),
  transitionMission: vi.fn(),
  listResumableMissionOwners: vi.fn(),
  reconcileMissionRuntime: vi.fn(),
}));
const runner = vi.hoisted(() => ({ isRunning: vi.fn(), start: vi.fn() }));
const events = vi.hoisted(() => ({ recordMissionEvent: vi.fn() }));
const learning = vi.hoisted(() => ({ extractMissionLearningCandidates: vi.fn() }));

vi.mock("./store", () => store);
vi.mock("./runner", () => ({ missionRunner: runner }));
vi.mock("./events", () => events);
vi.mock("./learning", () => learning);

import { recoverMissions } from "./commands";

const mission = (status: "executing" | "verifying" | "repairing" = "executing") => ({ id: "mission-1", ownerId: "owner-1", missionType: "autonomous_repository_change", goal: "Recover mission", contract: { acceptanceCriteria: [] }, status, budget: { maxDepth: 3, maxChildWorkItems: 32, maxAgentAttempts: 3, maxToolCalls: 120, maxModelTokens: 120_000, maxDurationSeconds: 1_800 }, version: 4, createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z" });

describe("Phase 10 startup recovery commands", () => {
  beforeEach(() => {
    store.getMission.mockReset();
    store.listMissions.mockReset();
    store.transitionMission.mockReset();
    store.listResumableMissionOwners.mockReset();
    store.reconcileMissionRuntime.mockReset();
    runner.isRunning.mockReset();
    runner.start.mockReset();
    events.recordMissionEvent.mockReset();
    runner.isRunning.mockReturnValue(false);
    runner.start.mockResolvedValue(undefined);
    events.recordMissionEvent.mockResolvedValue(undefined);
    store.reconcileMissionRuntime.mockResolvedValue({ recoveryId: "recovery-1", reclaimedLeaseCount: 1, reconciledWorkItemIds: ["work-1"] });
  });

  it("reconciles stale leases before resuming an executing mission", async () => {
    store.listMissions.mockResolvedValue([mission("executing")]);
    store.getMission.mockResolvedValue({ mission: mission("executing"), workItems: [], events: [] });
    await expect(recoverMissions("owner-1")).resolves.toHaveLength(1);
    expect(store.reconcileMissionRuntime).toHaveBeenCalledWith("owner-1", "mission-1", { forceReclaim: true });
    expect(runner.start).toHaveBeenCalledWith("owner-1", "mission-1");
  });

  it("moves interrupted verification back through repair before resuming", async () => {
    store.listMissions.mockResolvedValue([mission("verifying")]);
    store.getMission.mockResolvedValue({ mission: mission("verifying"), workItems: [], events: [] });
    store.transitionMission.mockResolvedValue({ ...mission("repairing"), status: "repairing", version: 5 });
    await recoverMissions("owner-1");
    expect(store.transitionMission).toHaveBeenCalledWith("owner-1", "mission-1", "verifying", "repairing", 4, "mission_runner", expect.objectContaining({ recoveryId: "recovery-1" }));
    expect(runner.start).toHaveBeenCalledWith("owner-1", "mission-1");
  });

  it("does not interfere with a mission already running in this process", async () => {
    store.listMissions.mockResolvedValue([mission("executing")]);
    runner.isRunning.mockReturnValue(true);
    await recoverMissions("owner-1");
    expect(store.reconcileMissionRuntime).not.toHaveBeenCalled();
    expect(runner.start).not.toHaveBeenCalled();
  });
});
