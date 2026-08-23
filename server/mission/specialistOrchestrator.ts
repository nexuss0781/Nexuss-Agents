import { streamWorkspaceModel } from "../paradoxWorkspace";
import { recordMissionEvent } from "./events";
import { redactSensitiveData } from "./redaction";
import { getSpecialist, type SpecialistKind } from "./specialists";
import { claimWorkItem, createMission, createWorkItem, releaseWorkItemLease, transitionMission, updateWorkItem, type MissionWorkItem } from "./store";

export type SpecialistFinding = { kind: SpecialistKind; summary: string; content: string; completed: boolean; childMissionId?: string };

function bounded(value: string, max: number) { return value.length > max ? `${value.slice(0, max)}\n[truncated]` : value; }

async function createChildMission(input: { ownerId: string; missionId: string; model: string; kind: SpecialistKind; workItem: MissionWorkItem; }): Promise<{ childMissionId: string; childWorkItem: MissionWorkItem; workerId: string; executingVersion: number }> {
  const descriptor = getSpecialist(input.kind);
  const child = await createMission(input.ownerId, { parentMissionId: input.missionId, goal: `${descriptor.title}: ${input.workItem.title}`, contract: { model: input.model, acceptanceCriteria: input.workItem.acceptanceCriteria, constraints: ["Operate only as a bounded read-only specialist; do not modify the repository."] } });
  const queued = await transitionMission(input.ownerId, child.mission.id, "created", "queued", child.mission.version, "principal_orchestrator", { parentMissionId: input.missionId, specialistKind: input.kind });
  const planning = await transitionMission(input.ownerId, child.mission.id, "queued", "planning", queued.version, "principal_orchestrator", { specialistKind: input.kind });
  const childWorkItem = await createWorkItem(input.ownerId, child.mission.id, { title: input.workItem.title, description: input.workItem.description, role: input.kind, dependencies: [], acceptanceCriteria: input.workItem.acceptanceCriteria, input: { parentWorkItemId: input.workItem.id, specialistKind: input.kind } });
  await transitionMission(input.ownerId, child.mission.id, "planning", "planned", planning.version, "principal_orchestrator", { specialistKind: input.kind });
  const executing = await transitionMission(input.ownerId, child.mission.id, "planned", "executing", planning.version + 1, "principal_orchestrator", { specialistKind: input.kind });
  return { childMissionId: child.mission.id, childWorkItem, workerId: `specialist-${input.kind}-${child.mission.id.slice(0, 8)}`, executingVersion: executing.version };
}

export async function runSpecialistAgent(input: { ownerId: string; missionId: string; model: string; kind: SpecialistKind; workItem: MissionWorkItem; repositoryContext: Record<string, unknown>; signal: AbortSignal; }): Promise<SpecialistFinding> {
  const descriptor = getSpecialist(input.kind);
  let child: { childMissionId: string; childWorkItem: MissionWorkItem; workerId: string; executingVersion: number } | undefined;
  try {
    child = await createChildMission(input);
    const claimed = await claimWorkItem(input.ownerId, child.childWorkItem.id, child.workerId, child.childWorkItem.version);
    const result = await streamWorkspaceModel(input.ownerId, {
      model: input.model,
      messages: [
        { role: "system", content: `${descriptor.systemInstruction}\nReturn a concise JSON object: {"summary":"string","risks":["string"],"recommendations":["string"]}. Do not include secrets or complete file contents.` },
        { role: "user", content: JSON.stringify(redactSensitiveData({ workItem: { title: input.workItem.title, description: input.workItem.description, acceptanceCriteria: input.workItem.acceptanceCriteria }, repository: input.repositoryContext })) },
      ],
    }, input.signal);
    if (result.stopped) throw new Error("specialist cancelled");
    const content = bounded(result.content, 6_000);
    const completed = result.finished && Boolean(content.trim());
    await updateWorkItem(input.ownerId, child.childWorkItem.id, { status: completed ? "completed" : "failed", output: { summary: completed ? "Specialist review completed" : "Specialist review ended without completion", outputLength: content.length }, expectedVersion: claimed.workItem.version });
    await releaseWorkItemLease(input.ownerId, child.childWorkItem.id, child.workerId);
    const current = completed ? await transitionMission(input.ownerId, child.childMissionId, "executing", "verifying", child.executingVersion, "specialist_agent", { specialistKind: input.kind }) : await transitionMission(input.ownerId, child.childMissionId, "executing", "failed", child.executingVersion, "specialist_agent", { specialistKind: input.kind, failureClass: "SPECIALIST_REVIEW_FAILED" });
    if (completed) await transitionMission(input.ownerId, child.childMissionId, "verifying", "completed", current.version, "specialist_agent", { specialistKind: input.kind, outputLength: content.length });
    await recordMissionEvent(input.ownerId, input.missionId, { type: completed ? "specialist.completed" : "specialist.failed", actor: "principal_orchestrator", workItemId: input.workItem.id, payload: { kind: input.kind, childMissionId: child.childMissionId, completed, outputLength: content.length } });
    return { kind: input.kind, summary: completed ? "Specialist review completed" : "Specialist review ended without completion", content: completed ? content : "No specialist finding available.", completed, childMissionId: child.childMissionId };
  } catch (error) {
    if (child) {
      await releaseWorkItemLease(input.ownerId, child.childWorkItem.id, child.workerId).catch(() => undefined);
      await transitionMission(input.ownerId, child.childMissionId, "executing", input.signal.aborted ? "stopped" : "failed", child.executingVersion, "specialist_agent", { specialistKind: input.kind, failureClass: input.signal.aborted ? "CANCELLED" : "SPECIALIST_REVIEW_FAILED" }).catch(() => undefined);
    }
    await recordMissionEvent(input.ownerId, input.missionId, { type: "specialist.failed", actor: "principal_orchestrator", workItemId: input.workItem.id, payload: { kind: input.kind, ...(child ? { childMissionId: child.childMissionId } : {}), failureClass: input.signal.aborted ? "CANCELLED" : "SPECIALIST_REVIEW_FAILED" } });
    console.warn("[SpecialistAgent] bounded review failed", { missionId: input.missionId, kind: input.kind, error: error instanceof Error ? error.message : String(error) });
    return { kind: input.kind, summary: "Specialist review unavailable; bounded execution remains in force", content: "No specialist finding available.", completed: false, ...(child ? { childMissionId: child.childMissionId } : {}) };
  }
}

export async function spawnBuilderReviews(input: { ownerId: string; missionId: string; model: string; workItem: MissionWorkItem; repositoryContext: Record<string, unknown>; signal: AbortSignal }): Promise<SpecialistFinding[]> {
  const kinds: SpecialistKind[] = ["repository_architect", "security_auditor"];
  await Promise.all(kinds.map((kind) => recordMissionEvent(input.ownerId, input.missionId, { type: "specialist.spawned", actor: "principal_orchestrator", workItemId: input.workItem.id, payload: { kind, parentRole: input.workItem.role, attempt: input.workItem.attempt } })));
  return Promise.all(kinds.map((kind) => runSpecialistAgent({ ...input, kind })));
}
