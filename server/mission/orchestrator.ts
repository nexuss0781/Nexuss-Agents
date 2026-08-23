import { randomUUID } from "node:crypto";
import { streamWorkspaceModel, type WorkspaceModelMessage } from "../paradoxWorkspace";
import { createWorkItem, getMission, type MissionSnapshot } from "./store";
import { recordMissionEvent } from "./events";
import { AUTONOMOUS_REPOSITORY_CHANGE_SYSTEM_PROMPT } from "./autonomousRepositoryChangePrompt";
import type { AcceptanceCriterion } from "./constitution";
import { redactSensitiveData } from "./redaction";
import { specialistForRole, type SpecialistKind } from "./specialists";
import { buildAgentSystemPrompt, getAgentContract } from "./agentContracts";

export type PlannedWorkItem = {
  title: string;
  description: string;
  role: string;
  specialistKind?: SpecialistKind;
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
{"summary":"string","assumptions":["string"],"acceptanceCriteria":[{"id":"string","description":"string","verification":"automated|runtime|visual|manual|mixed","required":true}],"workItems":[{"title":"string","description":"string","role":"sub_orchestrator|architect|builder|environment_operator|quality|security_auditor|integrator","specialistKind":"repository_architect|repository_builder|quality_gate|security_auditor|integrator|sub_orchestrator","dependencies":[0],"acceptanceCriteria":[{"id":"string","description":"string","verification":"automated|runtime|visual|manual|mixed","required":true}],"input":{}}]}

Rules: create at most 8 base work items; dependency indexes are zero-based; do not include secrets; do not request unrestricted tools; include a specialist sub-orchestrator, an independent security review, an independent quality work item, and a final integrator; make the first item coordinate bounded specialist reviews; and ensure every work item has explicit scope and verification criteria.`;

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

function assumptions(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 1_000)).slice(0, 20) : []; }
function specialistKindForRole(role: string): SpecialistKind { return specialistForRole(role).kind; }

function insertWithDependencyShift(items: PlannedWorkItem[], index: number, item: PlannedWorkItem) {
  for (const existing of items) existing.dependencies = existing.dependencies.map((dependency) => dependency >= index ? dependency + 1 : dependency).filter((dependency) => dependency >= 0);
  items.splice(index, 0, item);
}

function deterministicPlan(mission: MissionSnapshot): RepositoryChangePlan {
  const acceptanceCriteria = mission.mission.contract.acceptanceCriteria;
  return {
    summary: "Use the bounded specialist workflow: coordinate reviews, inspect, implement, audit, verify, and integrate.",
    assumptions: ["The server process is operating on the configured repository root.", "Only allowlisted verification commands and relative repository writes are permitted."],
    acceptanceCriteria,
    workItems: [
      { title: "Coordinate specialist reviews", description: "Spawn independent architecture and security specialists before implementation.", role: "sub_orchestrator", specialistKind: "sub_orchestrator", dependencies: [], acceptanceCriteria, input: { operation: "spawn_reviews" } },
      { title: "Inspect the repository and establish a baseline", description: "Inspect the repository status, tracked files, package scripts, and relevant implementation surface before changing files.", role: "architect", specialistKind: "repository_architect", dependencies: [0], acceptanceCriteria, input: { operation: "inspect" } },
      { title: "Implement the requested repository change", description: mission.mission.goal, role: "builder", specialistKind: "repository_builder", dependencies: [1], acceptanceCriteria, input: { operation: "implement" } },
      { title: "Run independent security review", description: "Review the proposed repository change for secret exposure, path escapes, unsafe commands, and authorization regressions.", role: "security_auditor", specialistKind: "security_auditor", dependencies: [2], acceptanceCriteria, input: { operation: "security_review" } },
      { title: "Independently verify the repository change", description: "Run the bounded type, test, build, and diff checks and preserve the results.", role: "quality", specialistKind: "quality_gate", dependencies: [2, 3], acceptanceCriteria, input: { operation: "verify" } },
      { title: "Integrate and report the verified result", description: "Confirm the verified work graph and report changed files and quality evidence without pushing or performing irreversible operations.", role: "integrator", specialistKind: "integrator", dependencies: [4], acceptanceCriteria, input: { operation: "integrate" } },
    ],
  };
}

function normalizePlan(value: unknown, mission: MissionSnapshot): RepositoryChangePlan {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const criteria = safeCriteria(raw.acceptanceCriteria, mission.mission.contract.acceptanceCriteria);
  const rawItems = Array.isArray(raw.workItems) ? raw.workItems : [];
  const items = rawItems.slice(0, 8).map((itemValue, index) => {
    const item = itemValue as Record<string, unknown>;
    const role = ["sub_orchestrator", "architect", "builder", "environment_operator", "quality", "security_auditor", "integrator"].includes(String(item.role)) ? String(item.role) : index === rawItems.length - 1 ? "integrator" : "builder";
    const dependencies = Array.isArray(item.dependencies) ? item.dependencies.filter((dependency): dependency is number => Number.isInteger(dependency) && dependency >= 0 && dependency < index) : [];
    const requestedKind = String(item.specialistKind);
    const validKinds = ["repository_architect", "repository_builder", "quality_gate", "security_auditor", "integrator", "sub_orchestrator"];
    const specialistKind = validKinds.includes(requestedKind) ? requestedKind as SpecialistKind : specialistKindForRole(role);
    return {
      title: boundedText(item.title, `Repository change step ${index + 1}`, 200),
      description: boundedText(item.description, "Complete the next bounded repository task and record evidence.", 4_000),
      role,
      specialistKind,
      dependencies,
      acceptanceCriteria: safeCriteria(item.acceptanceCriteria, criteria),
      ...(item.input && typeof item.input === "object" && !Array.isArray(item.input) ? { input: item.input as Record<string, unknown> } : {}),
    } satisfies PlannedWorkItem;
  });
  if (!items.length) return deterministicPlan(mission);
  if (!items.some((item) => item.role === "sub_orchestrator")) {
    insertWithDependencyShift(items, 0, { title: "Coordinate specialist reviews", description: "Spawn independent architecture and security specialists before implementation.", role: "sub_orchestrator", specialistKind: "sub_orchestrator", dependencies: [], acceptanceCriteria: criteria, input: { operation: "spawn_reviews" } });
    for (const item of items.slice(1)) item.dependencies = Array.from(new Set([0, ...item.dependencies]));
  }
  if (!items.some((item) => item.role === "security_auditor")) {
    const qualityIndex = items.findIndex((item) => item.role === "quality");
    const insertAt = qualityIndex < 0 ? items.length : qualityIndex;
    insertWithDependencyShift(items, insertAt, { title: "Run independent security review", description: "Review the repository change for secret exposure, unsafe commands, path escapes, and policy violations.", role: "security_auditor", specialistKind: "security_auditor", dependencies: Array.from({ length: insertAt }, (_unused, index) => index), acceptanceCriteria: criteria });
  }
  if (!items.some((item) => item.role === "quality")) items.push({ title: "Independently verify the repository change", description: "Run the applicable type, test, build, runtime, and diff checks and preserve the results.", role: "quality", specialistKind: "quality_gate", dependencies: items.map((_item, index) => index), acceptanceCriteria: criteria });
  const securityIndex = items.findIndex((item) => item.role === "security_auditor");
  const qualityIndex = items.findIndex((item) => item.role === "quality");
  if (securityIndex >= 0 && qualityIndex >= 0 && securityIndex < qualityIndex) items[qualityIndex].dependencies = Array.from(new Set([...items[qualityIndex].dependencies, securityIndex]));
  if (!items.some((item) => item.role === "integrator")) items.push({ title: "Integrate and report the verified result", description: "Confirm the verified work graph and report changed files and quality evidence.", role: "integrator", specialistKind: "integrator", dependencies: items.map((_item, index) => index), acceptanceCriteria: criteria });
  return { summary: boundedText(raw.summary, "Execute and verify the repository change.", 2_000), assumptions: assumptions(raw.assumptions), acceptanceCriteria: criteria, workItems: items.slice(0, 12) };
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
      { role: "system", content: `${AUTONOMOUS_REPOSITORY_CHANGE_SYSTEM_PROMPT}\n\n${buildAgentSystemPrompt(getAgentContract("principal"), { missionGoal: snapshot.mission.goal, acceptanceCriteria: snapshot.mission.contract.acceptanceCriteria, allowedSkills: ["mission_planning", "repository_inspection", "skill_selection"], allowedHarnesses: ["mission_runtime", "repository_inspection"] })}` },
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
    const created = await createWorkItem(ownerId, missionId, { title: item.title, description: item.description, role: item.role, dependencies: item.dependencies.map((dependency: number) => persistedIds[dependency]).filter((id: string | undefined): id is string => Boolean(id)), acceptanceCriteria: item.acceptanceCriteria, input: { ...(item.input || {}), planIndex: index, specialistKind: item.specialistKind || specialistKindForRole(item.role) } });
    persistedIds.push(created.id);
  }
  return plan;
}
