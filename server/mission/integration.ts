import { createMissionFromIntake, type IntakeSourceInput } from "./intake";
import { queueMission } from "./commands";
import type { MissionBudget } from "./constitution";

export type MissionLaunchResult = {
  status: "needs_clarification" | "started";
  decision: Awaited<ReturnType<typeof createMissionFromIntake>>["decision"];
  intake: Awaited<ReturnType<typeof createMissionFromIntake>>["intake"];
  issues: Awaited<ReturnType<typeof createMissionFromIntake>>["issues"];
  mission: Awaited<ReturnType<typeof queueMission>> | null;
  assistantMessage: string;
};

export async function launchMissionFromConversation(ownerId: string, input: { projectId?: string | null; model?: string; sources: IntakeSourceInput[]; budget?: MissionBudget; signal?: AbortSignal }): Promise<MissionLaunchResult> {
  const created = await createMissionFromIntake(ownerId, input);
  if (!created.mission) {
    const detail = created.issues.find((issue) => issue.code === "MATERIAL_AMBIGUITY")?.summary;
    return { status: "needs_clarification", decision: "needs_clarification", intake: created.intake, issues: created.issues, mission: null, assistantMessage: detail ? `I need a little more detail before I start. ${detail}` : "I need a little more detail before I start this work." };
  }
  const mission = await queueMission(ownerId, created.mission.mission.id);
  return { status: "started", decision: created.decision, intake: created.intake, issues: created.issues, mission, assistantMessage: "I’m taking this on now. I’ll work through the request, check the result, and bring the finished work back here." };
}
