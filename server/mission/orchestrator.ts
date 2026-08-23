import { randomUUID } from "node:crypto";
import { streamWorkspaceModel, type WorkspaceModelMessage } from "../paradoxWorkspace";
import { createWorkItem, getMission, type MissionSnapshot } from "./store";
import { recordMissionEvent } from "./events";
import { AUTONOMOUS_REPOSITORY_CHANGE_SYSTEM_PROMPT } from "./autonomousRepositoryChangePrompt";
import type { AcceptanceCriterion } from "./constitution";
import { redactSensitiveData } from "./redaction";

export type PlannedWorkItem = {
  title: string;
  description: string;
  role: string;
  dependencies: number[];
  acceptanceCriteria: AcceptanceCriterion[];
  input?: Record<string, unknown>;
};

export type RepositoryChangePlan = {
  summary: string;
  assumptions: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  workItems: PlannedWorkItem[];
};

const planPrompt = `Create an executable repository-change plan for the mission below. Return JSON only with this exact shape:
{"summary":"string","assumptions":["string"],"acceptanceCriteria":[{"id":"string","description":"string","verification":"automated|runtime|visual|manual|mixed","required":true}],"workItems":[{"title":"string","description":"string","role":"architect|builder|environment_operator|quality|integrator","dependencies":[0],"acceptanceCriteria":[{"id":"string","description":"string","verification":"automated|runtime|visual|manual|mixed","required":true}],"input":{}}]}

Rules: create 1 to 12 bounded work items; dependency indexes are zero-based; do not include secrets; do not request unrestricted tools; include an independent quality work item; make the first item repository inspection when the repository state is unknown; and ensure the final item integrates or reports the verified result.`;

function boundedText(value: unknown, fallback: string, max: number) { return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback; }
function safeCriteria(value: unknown, fallback: AcceptanceCriterion[] = []): AcceptanceCriterion[] {
  if (!Array.isArray(value)) return fallback;
  return value.map((criterion, index) => {
    const item = criterion as Record<string, unknown>;
    return {
      id: boundedText(item.id, `criterion-${index + 1}`, 128),
      description: boundedText(item.description, "Verify the work item output", 2_000),
      verification: ["automated", "runtime", "visual", "manual", "mixed"].includes(String(item.verification)) ? item.verification as AcceptanceCriterion["verification"] : "automated",
      required: item.required !== false,
    };
  }).slice(0, 20);
}

function deterministicPlan(mission: MissionSnapshot): RepositoryChangePlan {
  const acceptanceCriteria = mission.mission.contract.acceptanceCriteria;
  return {
    summary: "Use the bounded repository workflow: inspect, implement, verify, and integrate.",
    assumptions: ["The server process is operating on the configured repository root.", "Only allowlisted verification commands and relative repository writes are permitted."],
    acceptanceCriteria,
    workItems: [
      { title: "Inspect the repository and establish a baseline", description: "Inspect the repository status, tracked files, package scripts, and relevant implementation surface before changing files.", role: "architect", dependencies: [], acceptanceCriteria, input: { operation: "inspect" } },
      { title: "Implement the requested repository change", description: mission.mission.goal, role: "builder", dependencies: [0], acceptanceCriteria, input: { operation: "implement" } },
      { title: "Independently verify the repository change", description: "Run the bounded type, test, build, and diff checks and preserve the results.", role: "quality", dependencies: [0, 1], acceptanceCriteria, input: { operation: "verify" } },
      { title: "Integrate and report the verified result", description: "Confirm the verified work graph and report changed files and quality evidence without pushing or performing irreversible operations.", role: "integrator", dependencies: [2], acceptanceCriteria, input: { operation: "integrate" } },
    ],
  };
}

function normalizePlan(value: unknown, mission: MissionSnapshot): RepositoryChangePlan {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const criteria = safeCriteria(raw.acceptanceCriteria, mission.mission.contract.acceptanceCriteria);
  const rawItems = Array.isArray(raw.workItems) ? raw.workItems : [];
  const workItems = rawItems.slice(0, 12).map((itemValue, index) => {
    const item = itemValue as Record<string, unknown>;
    const dependencies = Array.isArray(item.dependencies) ? item.dependencies.filter((dependency): dependency is number => Number.isInteger(dependency) && dependency >= 0 && dependency < index) : [];
    return {
      title: boundedText(item.title, `Repository change step ${index + 1}`, 200),
      description: boundedText(item.description, "Complete the next bounded repository task and record evidence.", 4_000),
      role: ["architect", "builder", "environment_operator", "quality", "integrator"].includes(String(item.role)) ? String(item.role) : index === rawItems.length - 1 ? "integrator" : "builder",
      dependencies,
      acceptanceCriteria: safeCriteria(item.acceptanceCriteria, criteria),
      ...(item.input && typeof item.input === "object" && !Array.isArray(item.input) ? { input: item.input as Record<string, unknown> } : {}),
    } satisfies PlannedWorkItem;
  });
  if (!workItems.length) return deterministicPlan(mission);
  if (!workItems.some((item) => item.role === "quality")) {
    const boundedItems = workItems.slice(0, 11);
    boundedItems.push({ title: "Independently verify the repository change", description: "Run the applicable type, test, build, runtime, and diff checks and preserve the results.", role: "quality", dependencies: boundedItems.map((_item, index) => index), acceptanceCriteria: criteria });
    return { summary: boundedText(raw.summary, "Execute and verify the repository change.", 2_000), assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 1_000)).slice(0, 20) : [], acceptanceCriteria: criteria, workItems: boundedItems };
  }
  return { summary: boundedText(raw.summary, "Execute and verify the repository change.", 2_000), assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 1_000)).slice(0, 20) : [], acceptanceCriteria: criteria, workItems: workItems.slice(0, 12) };
}

function extractJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Planner returned no JSON object");
  return JSON.parse(trimmed.slice(start, end + 1));
}

export async function planRepositoryChange(ownerId: string, missionId: string, signal: AbortSignal): Promise<RepositoryChangePlan> {
  const snapshot = await getMission(ownerId, missionId);
  const model = snapshot.mission.contract.model;
  let plan: RepositoryChangePlan;
  if (!model) {
    plan = deterministicPlan(snapshot);
    await recordMissionEvent(ownerId, missionId, { type: "orchestration.plan_created", actor: "principal_orchestrator", payload: { planId: randomUUID(), source: "deterministic_fallback", workItemCount: plan.workItems.length, assumptionCount: plan.assumptions.length } });
  } else {
    const messages: WorkspaceModelMessage[] = [
    { role: "system", content: AUTONOMOUS_REPOSITORY_CHANGE_SYSTEM_PROMPT },
      { role: "user", content: `${planPrompt}\n\nMission:\n${JSON.stringify(redactSensitiveData({ goal: snapshot.mission.goal, contract: snapshot.mission.contract, existingWorkItems: snapshot.workItems.map((item) => ({ title: item.title, status: item.status })) }))}` },
    ];
    try {
      const result = await streamWorkspaceModel(ownerId, { model, messages }, signal);
      if (result.stopped) throw new Error("Planning was cancelled");
      if (!result.finished) throw new Error("Planner stream ended without an explicit completion signal");
      plan = normalizePlan(extractJson(result.content), snapshot);
      await recordMissionEvent(ownerId, missionId, { type: "orchestration.plan_created", actor: "principal_orchestrator", payload: { planId: randomUUID(), source: "model", workItemCount: plan.workItems.length, assumptionCount: plan.assumptions.length } });
    } catch (error) {
      if (signal.aborted) throw error;
      plan = deterministicPlan(snapshot);
      await recordMissionEvent(ownerId, missionId, { type: "orchestration.plan_rejected", actor: "principal_orchestrator", payload: { classification: "MODEL_PLAN_UNAVAILABLE", fallback: "deterministic", workItemCount: plan.workItems.length } });
      console.warn("[MissionOrchestrator] model plan rejected; using deterministic fallback", { missionId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const persistedIds: string[] = [];
  for (const [index, item] of Array.from(plan.workItems.entries())) {
    const created = await createWorkItem(ownerId, missionId, { title: item.title, description: item.description, role: item.role, dependencies: item.dependencies.map((dependency: number) => persistedIds[dependency]).filter((id: string | undefined): id is string => Boolean(id)), acceptanceCriteria: item.acceptanceCriteria, input: { ...(item.input || {}), planIndex: index } });
    persistedIds.push(created.id);
  }
  return plan;
}
