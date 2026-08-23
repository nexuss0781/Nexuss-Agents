import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  appendMissionEvent,
  createMission,
  createWorkItem,
  getMission,
  listMissions,
  saveMissionCheckpoint,
  transitionMission,
  updateWorkItem,
} from "./store";
import { withWorkspaceDb } from "../paradoxWorkspace";

async function cleanupMission(ownerId: string, missionId: string) {
  await withWorkspaceDb(true, (db) => {
    db.execute("DELETE FROM workspace_mission_events WHERE mission_id = ? AND owner_id = ?", [missionId, ownerId]);
    db.execute("DELETE FROM workspace_mission_checkpoints WHERE mission_id = ? AND owner_id = ?", [missionId, ownerId]);
    db.execute("DELETE FROM workspace_mission_work_items WHERE mission_id = ? AND owner_id = ?", [missionId, ownerId]);
    db.execute("DELETE FROM workspace_missions WHERE id = ? AND owner_id = ?", [missionId, ownerId]);
  });
}

describe("durable Autonomous Repository Change mission store", () => {
  it("persists a mission, work graph, checkpoint, and ordered event journal", async () => {
    const ownerId = `mission-store-owner-${randomUUID()}`;
    const created = await createMission(ownerId, {
      goal: "Repair the repository stream parser and ship the fix",
      contract: {
        acceptanceCriteria: [{ id: "tests", description: "Focused regression tests pass", verification: "automated", required: true }],
        constraints: ["Do not expose credentials"],
      },
    });

    try {
      expect(created.mission).toMatchObject({ ownerId, goal: "Repair the repository stream parser and ship the fix", status: "created", version: 1 });
      expect(created.events).toHaveLength(1);
      expect(created.events[0]).toMatchObject({ sequence: 1, type: "mission.created", actor: "system" });
      expect(created.latestCheckpoint).toMatchObject({ version: 1, status: "created", nextAction: "queue mission" });

      const workItem = await createWorkItem(ownerId, created.mission.id, {
        title: "Inspect parser",
        description: "Identify why final provider frames are lost.",
        role: "architect",
        acceptanceCriteria: created.mission.contract.acceptanceCriteria,
        input: { repository: "current" },
      });
      expect(workItem).toMatchObject({ missionId: created.mission.id, status: "pending", version: 1, attempt: 0 });

      const updatedWorkItem = await updateWorkItem(ownerId, workItem.id, { status: "completed", output: { finding: "Flush the final buffer" }, expectedVersion: 1 });
      expect(updatedWorkItem).toMatchObject({ status: "completed", version: 2, attempt: 0, output: { finding: "Flush the final buffer" } });

      const queued = await transitionMission(ownerId, created.mission.id, "created", "queued", 1, "orchestrator", { reason: "mission accepted" });
      expect(queued).toMatchObject({ status: "queued", version: 2 });

      const checkpoint = await saveMissionCheckpoint(ownerId, created.mission.id, { version: 2, status: "queued", state: { completedWorkItems: [workItem.id] }, nextAction: "begin planning" });
      expect(checkpoint).toMatchObject({ version: 2, status: "queued", state: { completedWorkItems: [workItem.id] } });

      const event = await appendMissionEvent(ownerId, created.mission.id, { type: "work_item.completed", actor: "quality", workItemId: workItem.id, payload: { result: "verified" } });
      expect(event).toMatchObject({ sequence: 7, type: "work_item.completed", workItemId: workItem.id, payload: { result: "verified" } });

      const loaded = await getMission(ownerId, created.mission.id);
      expect(loaded.mission).toMatchObject({ status: "queued", version: 2 });
      expect(loaded.workItems).toHaveLength(1);
      expect(loaded.events.map((item) => item.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(loaded.latestCheckpoint).toMatchObject({ version: 2, nextAction: "begin planning" });
      expect(await listMissions(ownerId)).toEqual([expect.objectContaining({ id: created.mission.id, status: "queued" })]);
    } finally {
      await cleanupMission(ownerId, created.mission.id);
    }
  }, 90_000);

  it("enforces ownership, optimistic versions, and secret-safe event payloads", async () => {
    const ownerId = `mission-owner-${randomUUID()}`;
    const otherOwnerId = `mission-other-owner-${randomUUID()}`;
    const created = await createMission(ownerId, { goal: "Test ownership boundaries", contract: { acceptanceCriteria: [] } });
    try {
      await expect(getMission(otherOwnerId, created.mission.id)).rejects.toThrow("Mission not found");
      await expect(transitionMission(ownerId, created.mission.id, "created", "queued", 99, "test")).rejects.toThrow("Mission version conflict");
      await expect(appendMissionEvent(ownerId, created.mission.id, { type: "unsafe", actor: "test", payload: { apiKey: "never-store" } })).rejects.toThrow("prohibited secret field");
      await expect(transitionMission(ownerId, created.mission.id, "created", "completed", 1, "test")).rejects.toThrow("Invalid mission transition");
    } finally {
      await cleanupMission(ownerId, created.mission.id);
    }
  }, 90_000);
});
