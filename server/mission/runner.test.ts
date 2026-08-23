import { describe, expect, it, vi, beforeEach } from "vitest";
import { missionRunner } from "./runner";
import type { MissionSnapshot } from "./store";

const store = vi.hoisted(() => ({
  getMission: vi.fn(),
  transitionMission: vi.fn(),
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
    missionRunner.configureExecutor(undefined);
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
