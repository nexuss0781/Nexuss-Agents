import { appendMissionEvent, type MissionEvent } from "./store";

export const MISSION_EVENT_TYPES = [
  "orchestration.plan_created",
  "orchestration.plan_rejected",
  "executor.started",
  "executor.completed",
  "executor.failed",
  "quality_gate.started",
  "quality_gate.completed",
  "evidence.recorded",
  "work_item.blocked",
  "runner.error",
] as const;

export type MissionEventType = typeof MISSION_EVENT_TYPES[number];
export type MissionEventActor = "principal_orchestrator" | "repository_executor" | "quality_gate" | "mission_runner" | "system";

export async function recordMissionEvent(ownerId: string, missionId: string, input: { type: MissionEventType; actor: MissionEventActor; workItemId?: string; payload?: Record<string, unknown> }): Promise<MissionEvent> {
  return appendMissionEvent(ownerId, missionId, input);
}
