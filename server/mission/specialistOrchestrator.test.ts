import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionWorkItem } from "./store";

const streamWorkspaceModel = vi.hoisted(() => vi.fn());
const events = vi.hoisted(() => ({ recordMissionEvent: vi.fn() }));
const store = vi.hoisted(() => ({ createMission: vi.fn(), transitionMission: vi.fn(), createWorkItem: vi.fn(), claimWorkItem: vi.fn(), updateWorkItem: vi.fn(), releaseWorkItemLease: vi.fn() }));

vi.mock("../paradoxWorkspace", () => ({ streamWorkspaceModel }));
vi.mock("./events", () => events);
vi.mock("./store", () => store);

import { runSpecialistAgent, spawnBuilderReviews } from "./specialistOrchestrator";

const parentWorkItem: MissionWorkItem = { id: "parent-work", missionId: "mission-1", ownerId: "owner-1", title: "Prepare repository change", description: "Review and implement", role: "sub_orchestrator", status: "claimed", dependencies: [], acceptanceCriteria: [], input: {}, attempt: 1, version: 2, createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" };

beforeEach(() => {
  streamWorkspaceModel.mockReset();
  events.recordMissionEvent.mockReset();
  store.createMission.mockReset();
  store.transitionMission.mockReset();
  store.createWorkItem.mockReset();
  store.claimWorkItem.mockReset();
  store.updateWorkItem.mockReset();
  store.releaseWorkItemLease.mockReset();
  let childCount = 0;
  streamWorkspaceModel.mockResolvedValue({ content: JSON.stringify({ summary: "review complete", risks: [], recommendations: [] }), stopped: false, finished: true });
  store.createMission.mockImplementation(async () => ({ mission: { id: `child-${++childCount}`, version: 1 } }));
  store.transitionMission.mockImplementation(async (_owner: string, missionId: string, _from: string, to: string, version: number) => ({ id: missionId, status: to, version: version + 1 }));
  store.createWorkItem.mockImplementation(async (_owner: string, missionId: string, input: { title: string; description: string; role: string; acceptanceCriteria: [] }) => ({ id: `${missionId}-work`, missionId, ownerId: "owner-1", title: input.title, description: input.description, role: input.role, status: "pending", dependencies: [], acceptanceCriteria: input.acceptanceCriteria, input: {}, attempt: 0, version: 1, createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" }));
  store.claimWorkItem.mockImplementation(async (_owner: string, workItemId: string) => ({ workItem: { ...parentWorkItem, id: workItemId, missionId: workItemId.split("-").slice(0, 2).join("-"), status: "claimed", version: 2 }, lease: { workItemId, workerId: "specialist-worker" } }));
  store.updateWorkItem.mockResolvedValue({});
  store.releaseWorkItemLease.mockResolvedValue({ released: true });
  events.recordMissionEvent.mockResolvedValue({ id: "event-1" });
});

describe("specialist sub-orchestrator", () => {
  it("spawns parallel architecture and security agents with durable child missions", async () => {
    const findings = await spawnBuilderReviews({ ownerId: "owner-1", missionId: "mission-1", model: "model-1", workItem: parentWorkItem, repositoryContext: { status: "clean", trackedFiles: ["package.json"] }, signal: new AbortController().signal });

    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.completed)).toBe(true);
    expect(store.createMission).toHaveBeenCalledTimes(2);
    expect(store.claimWorkItem).toHaveBeenCalledTimes(2);
    expect(store.updateWorkItem).toHaveBeenCalledTimes(2);
    expect(events.recordMissionEvent.mock.calls.some((call) => call[2].type === "specialist.spawned")).toBe(true);
    expect(events.recordMissionEvent.mock.calls.some((call) => call[2].type === "specialist.completed")).toBe(true);
  });

  it("records a failed child specialist without exposing the model failure text", async () => {
    streamWorkspaceModel.mockRejectedValue(new Error("provider credential detail must not persist"));

    const finding = await runSpecialistAgent({ ownerId: "owner-1", missionId: "mission-1", model: "model-1", kind: "security_auditor", workItem: parentWorkItem, repositoryContext: {}, signal: new AbortController().signal });

    expect(finding.completed).toBe(false);
    expect(finding.content).toContain("No specialist finding");
    expect(events.recordMissionEvent).toHaveBeenCalledWith("owner-1", "mission-1", expect.objectContaining({ type: "specialist.failed", payload: expect.not.objectContaining({ error: expect.anything() }) }));
  });
});
