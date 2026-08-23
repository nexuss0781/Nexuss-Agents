import { getMission, listMissions, transitionMission, type MissionSnapshot } from "./store";
import type { MissionStatus } from "./../mission/constitution";
import { missionRunner } from "./runner";

const pausableStatuses: readonly MissionStatus[] = ["planning", "planned", "executing", "verifying", "repairing"];
const stoppableStatuses: readonly MissionStatus[] = ["created", "queued", "planning", "planned", "executing", "verifying", "repairing", "paused", "failed"];

export async function queueMission(ownerId: string, missionId: string, actor = "user"): Promise<MissionSnapshot> {
  const snapshot = await getMission(ownerId, missionId);
  if (snapshot.mission.status === "created") await transitionMission(ownerId, missionId, "created", "queued", snapshot.mission.version, actor, { command: "queue" });
  else if (snapshot.mission.status !== "queued" && snapshot.mission.status !== "planning" && snapshot.mission.status !== "planned" && snapshot.mission.status !== "executing" && snapshot.mission.status !== "verifying" && snapshot.mission.status !== "repairing") throw new Error(`Mission cannot be queued from status ${snapshot.mission.status}`);
  void missionRunner.start(ownerId, missionId).catch((error) => console.error("[MissionRunner] asynchronous start failed", { missionId, error: error instanceof Error ? error.message : String(error) }));
  return getMission(ownerId, missionId);
}

export async function pauseMission(ownerId: string, missionId: string, actor = "user"): Promise<MissionSnapshot> {
  const snapshot = await getMission(ownerId, missionId);
  if (snapshot.mission.status === "paused") return snapshot;
  if (!pausableStatuses.includes(snapshot.mission.status)) throw new Error(`Mission cannot be paused from status ${snapshot.mission.status}`);
  await transitionMission(ownerId, missionId, snapshot.mission.status, "paused", snapshot.mission.version, actor, { command: "pause" });
  missionRunner.cancel(ownerId, missionId);
  return getMission(ownerId, missionId);
}

export async function resumeMission(ownerId: string, missionId: string, actor = "user"): Promise<MissionSnapshot> {
  const snapshot = await getMission(ownerId, missionId);
  if (snapshot.mission.status !== "paused") {
    if (["executing", "verifying", "repairing", "planning", "planned"].includes(snapshot.mission.status)) {
      void missionRunner.start(ownerId, missionId).catch((error) => console.error("[MissionRunner] asynchronous resume failed", { missionId, error: error instanceof Error ? error.message : String(error) }));
      return getMission(ownerId, missionId);
    }
    throw new Error(`Mission cannot be resumed from status ${snapshot.mission.status}`);
  }
  await transitionMission(ownerId, missionId, "paused", "executing", snapshot.mission.version, actor, { command: "resume" });
  void missionRunner.start(ownerId, missionId).catch((error) => console.error("[MissionRunner] asynchronous start failed", { missionId, error: error instanceof Error ? error.message : String(error) }));
  return getMission(ownerId, missionId);
}

export async function stopMission(ownerId: string, missionId: string, actor = "user"): Promise<MissionSnapshot> {
  const snapshot = await getMission(ownerId, missionId);
  if (!stoppableStatuses.includes(snapshot.mission.status)) return snapshot;
  await transitionMission(ownerId, missionId, snapshot.mission.status, "stopped", snapshot.mission.version, actor, { command: "stop" });
  missionRunner.cancel(ownerId, missionId);
  return getMission(ownerId, missionId);
}

export async function retryMission(ownerId: string, missionId: string, actor = "user"): Promise<MissionSnapshot> {
  const snapshot = await getMission(ownerId, missionId);
  if (snapshot.mission.status !== "failed" && snapshot.mission.status !== "stopped") throw new Error(`Mission cannot be retried from status ${snapshot.mission.status}`);
  await transitionMission(ownerId, missionId, snapshot.mission.status, "queued", snapshot.mission.version, actor, { command: "retry" });
  void missionRunner.start(ownerId, missionId).catch((error) => console.error("[MissionRunner] asynchronous start failed", { missionId, error: error instanceof Error ? error.message : String(error) }));
  return getMission(ownerId, missionId);
}

export async function recoverMissions(ownerId: string) {
  const missions = await listMissions(ownerId);
  const resumable = missions.filter((mission) => ["queued", "planning", "planned", "executing", "verifying", "repairing"].includes(mission.status));
  for (const mission of resumable) void missionRunner.start(ownerId, mission.id).catch((error) => console.error("[MissionRunner] recovery start failed", { missionId: mission.id, error: error instanceof Error ? error.message : String(error) }));
  return resumable;
}
