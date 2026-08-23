import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionSnapshot } from "./store";

const streamWorkspaceModel = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({ getMission: vi.fn(), createWorkItem: vi.fn(), appendMissionEvent: vi.fn() }));

vi.mock("../paradoxWorkspace", () => ({ streamWorkspaceModel }));
vi.mock("./store", () => store);

import { planRepositoryChange } from "./orchestrator";

function snapshot(model?: string): MissionSnapshot {
  return {
    mission: { id: "mission-1", ownerId: "owner-1", missionType: "autonomous_repository_change", goal: "Add a bounded change", contract: { ...(model ? { model } : {}), acceptanceCriteria: [{ id: "build", description: "Build passes", verification: "automated", required: true }] }, status: "planning", budget: { maxDepth: 3, maxChildWorkItems: 32, maxAgentAttempts: 3, maxToolCalls: 120, maxModelTokens: 120_000, maxDurationSeconds: 1_800 }, version: 2, createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" }, workItems: [], events: [],
  };
}

describe("principal repository orchestrator", () => {
  beforeEach(() => {
    streamWorkspaceModel.mockReset();
    store.getMission.mockReset();
    store.createWorkItem.mockReset();
    store.appendMissionEvent.mockReset();
    store.appendMissionEvent.mockResolvedValue({ id: "event-1" });
    let count = 0;
    store.createWorkItem.mockImplementation(async (_owner: string, _mission: string, input: { dependencies?: string[] }) => ({ id: `work-${++count}`, dependencies: input.dependencies || [] }));
  });

  it("normalizes a model plan, inserts quality, and persists real dependencies", async () => {
    store.getMission.mockResolvedValue(snapshot("model-1"));
    streamWorkspaceModel.mockResolvedValue({ content: JSON.stringify({ summary: "Implement change", assumptions: [], acceptanceCriteria: [], workItems: [{ title: "Implement", description: "Implement it", role: "builder", dependencies: [], acceptanceCriteria: [] }] }), stopped: false, finished: true });

    const plan = await planRepositoryChange("owner-1", "mission-1", new AbortController().signal);

    expect(plan.workItems.map((item) => item.role)).toEqual(["builder", "quality"]);
    expect(store.createWorkItem).toHaveBeenCalledTimes(2);
    expect(store.createWorkItem.mock.calls[1]?.[2].dependencies).toEqual(["work-1"]);
    expect(store.appendMissionEvent).toHaveBeenCalledWith("owner-1", "mission-1", expect.objectContaining({ type: "orchestration.plan_created" }));
  });

  it("uses a deterministic bounded plan when no model is selected", async () => {
    store.getMission.mockResolvedValue(snapshot());

    const plan = await planRepositoryChange("owner-1", "mission-1", new AbortController().signal);

    expect(streamWorkspaceModel).not.toHaveBeenCalled();
    expect(plan.workItems.map((item) => item.role)).toEqual(["architect", "builder", "quality", "integrator"]);
    expect(store.createWorkItem).toHaveBeenCalledTimes(4);
    expect(store.appendMissionEvent).toHaveBeenCalledWith("owner-1", "mission-1", expect.objectContaining({ type: "orchestration.plan_created", actor: "principal_orchestrator", payload: expect.objectContaining({ source: "deterministic_fallback" }) }));
  });
});
