import { createHash } from "node:crypto";
import { streamWorkspaceModel } from "../paradoxWorkspace";
import { redactSensitiveData } from "./redaction";
import { MISSION_INTAKE_SYSTEM_PROMPT } from "./intakePrompt";
import { getAgentContract } from "./agentContracts";
import { assertHarnessAllowed, assertSkillAllowed } from "./capabilityGuard";
import {
  createMission,
  createMissionIntake,
  getMissionIntake,
  type CreateMissionInput,
  type MissionIntakeRecord,
  type MissionIntakeSource,
  type MissionIntakeStatus,
} from "./store";
import type { AcceptanceCriterion, MissionBudget } from "./constitution";

export type IntakeSourceInput = {
  kind: MissionIntakeSource["kind"];
  text: string;
  name?: string;
  mimeType?: string;
};

export type MissionBrief = {
  objective: string;
  deliverables: string[];
  acceptanceCriteria: Array<AcceptanceCriterion & { sourceId: string }>;
  constraints: string[];
  assumptions: Array<{ text: string; sourceId: string }>;
  projectScope: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high" | "critical";
  requiredSkills: string[];
  domains: string[];
  verificationExpectations: string[];
  escalationConditions: string[];
  sourceReferences: string[];
};

export type IntakeIssue = {
  code: "MATERIAL_AMBIGUITY" | "CONTRADICTION" | "MISSING_PERMISSION" | "UNSUPPORTED_INPUT" | "UNSAFE_REQUEST";
  summary: string;
  sourceIds: string[];
  severity: "warning" | "blocking";
};

export type IntakeDecision = MissionIntakeStatus;

export type MissionIntakeResult = {
  intake: MissionIntakeRecord;
  brief: MissionBrief;
  decision: IntakeDecision;
  issues: IntakeIssue[];
  sourceReferences: string[];
};

const MAX_SOURCE_LENGTH = 120_000;
const MAX_COMBINED_LENGTH = 300_000;

function bounded(value: string, max: number) {
  return value.trim().slice(0, max);
}

function hashText(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function sourceId(index: number, source: IntakeSourceInput) {
  return `source-${index + 1}-${source.kind}`;
}

function normalizeSources(sources: IntakeSourceInput[]) {
  if (!sources.length) throw new Error("Mission intake requires at least one prompt or specification source");
  if (sources.length > 20) throw new Error("Mission intake supports at most 20 sources");
  return sources.map((source, index) => {
    const text = bounded(source.text, MAX_SOURCE_LENGTH);
    if (!text) throw new Error(`Mission intake source ${index + 1} is empty`);
    return { id: sourceId(index, source), kind: source.kind, ...(source.name ? { name: bounded(source.name, 240) } : {}), ...(source.mimeType ? { mimeType: bounded(source.mimeType, 120) } : {}), text, contentHash: hashText(text) } satisfies MissionIntakeSource;
  });
}

function linesFor(sources: MissionIntakeSource[]) {
  return sources.flatMap((source) => source.text.split(/\r?\n/).map((text, index) => ({ text: text.trim(), sourceId: source.id, line: index + 1 }))).filter((line) => line.text);
}

function cleanLine(value: string) {
  return value.replace(/^[-*+\d.)\s]+/, "").replace(/^#+\s*/, "").trim();
}

function firstObjective(sources: MissionIntakeSource[]) {
  const raw = sources.find((source) => source.kind === "raw_prompt")?.text || sources[0]?.text || "";
  const paragraph = raw.split(/\n\s*\n/).map((part) => cleanLine(part)).find(Boolean) || raw;
  return bounded(paragraph, 2_000);
}

function extractDeliverables(lines: ReturnType<typeof linesFor>, objective: string) {
  const matches = lines.filter(({ text }) => /^(?:[-*+]|\d+[.)])?\s*(?:deliverables?|outputs?|build|implement|create|add|support|provide|ship|produce)\b/i.test(text) || /\b(?:deliverables?|outputs?)\s*:/i.test(text)).map(({ text }) => cleanLine(text));
  const unique = Array.from(new Set(matches.filter((item) => item.length > 8))).slice(0, 20);
  return unique.length ? unique : [bounded(objective, 500)];
}

function extractAcceptance(lines: ReturnType<typeof linesFor>, objective: string): MissionBrief["acceptanceCriteria"] {
  const matches = lines.filter(({ text }) => /\b(?:acceptance|success criteria|done when|must|shall|should|requirement)\b/i.test(text) || /^\[[ xX]\]/.test(text)).slice(0, 30);
  const source = matches[0]?.sourceId || "source-1-raw_prompt";
  const values = matches.length ? matches : [{ text: `The requested objective is completed and independently verified: ${bounded(objective, 400)}`, sourceId: source, line: 1 }];
  return values.map((item, index): AcceptanceCriterion & { sourceId: string } => ({ id: `criterion-${index + 1}`, description: bounded(cleanLine(item.text), 2_000), verification: /visual|ui|design/i.test(item.text) ? "visual" : /manual|approval/i.test(item.text) ? "manual" : "automated", required: true, sourceId: item.sourceId }));
}

function extractConstraints(lines: ReturnType<typeof linesFor>): string[] {
  return Array.from(new Set(lines.filter(({ text }) => /\b(?:constraint|do not|must not|avoid|only|without|never|preserve|keep)\b/i.test(text)).map(({ text }) => bounded(cleanLine(text), 2_000)).filter((text) => text.length > 8))).slice(0, 30);
}

function inferSkills(text: string) {
  const skills = new Set<string>(["mission_planning", "mission_decomposition", "quality_verification"]);
  if (/repo|repository|code|coding|implement|bug|typescript|javascript|backend|frontend/i.test(text)) skills.add("repository_inspection");
  if (/research|source|citation|literature|investigate/i.test(text)) skills.add("research");
  if (/browser|website|web page|navigate/i.test(text)) skills.add("browser");
  if (/webdev|deploy|application|frontend|website/i.test(text)) skills.add("webdev");
  if (/terminal|shell|command|script|cli/i.test(text)) skills.add("terminal");
  if (/write|change|implement|create|modify|build/i.test(text)) skills.add("bounded_execution");
  return Array.from(skills).slice(0, 20);
}

function inferDomains(text: string) {
  const domains = new Set<string>();
  if (/repo|repository|code|coding|typescript|javascript|backend|frontend|software/i.test(text)) domains.add("software_delivery");
  if (/research|source|citation|literature|investigate/i.test(text)) domains.add("research");
  if (/security|credential|permission|auth|secret/i.test(text)) domains.add("security");
  if (/deploy|production|infrastructure|render|release/i.test(text)) domains.add("deployment");
  if (!domains.size) domains.add("general_problem_solving");
  return Array.from(domains);
}

function inferRisk(text: string): MissionBrief["riskLevel"] {
  if (/delete|destroy|payment|financial|production|deploy|publish|irreversible|external system|customer data/i.test(text)) return "high";
  if (/auth|security|credential|secret|personal data|database|migration/i.test(text)) return "medium";
  return "low";
}

function detectIssues(sources: MissionIntakeSource[], objective: string, constraints: string[]): IntakeIssue[] {
  const issues: IntakeIssue[] = [];
  const allText = sources.map((source) => source.text).join("\n");
  if (objective.length < 12) issues.push({ code: "MATERIAL_AMBIGUITY", summary: "The desired outcome is too brief to plan reliably.", sourceIds: sources.map((source) => source.id), severity: "blocking" });
  if (/\b(?:ignore|override|disable)\b.*\b(?:security|policy|approval|permission)\b/i.test(allText)) issues.push({ code: "UNSAFE_REQUEST", summary: "The source contains an instruction that appears to bypass a safety or authority boundary.", sourceIds: sources.map((source) => source.id), severity: "blocking" });
  if (constraints.some((constraint) => /do not/i.test(constraint)) && /\bmust\b/i.test(allText) && /\b(?:do not|must not)\b/i.test(allText)) issues.push({ code: "CONTRADICTION", summary: "The submission contains potentially conflicting requirements that need principal review.", sourceIds: sources.map((source) => source.id), severity: "warning" });
  if (/\b(?:production|deploy|publish|delete|payment)\b/i.test(allText) && !/\b(?:permission|approval|authorize|authorized)\b/i.test(allText)) issues.push({ code: "MISSING_PERMISSION", summary: "The request may require an explicit permission boundary before a high-impact action.", sourceIds: sources.map((source) => source.id), severity: "warning" });
  return issues;
}

function deterministicBrief(sources: MissionIntakeSource[]): { brief: MissionBrief; issues: IntakeIssue[] } {
  const lines = linesFor(sources);
  const objective = firstObjective(sources);
  const constraints = extractConstraints(lines);
  const text = sources.map((source) => source.text).join("\n");
  const acceptanceCriteria = extractAcceptance(lines, objective);
  const issues = detectIssues(sources, objective, constraints);
  const brief: MissionBrief = {
    objective,
    deliverables: extractDeliverables(lines, objective),
    acceptanceCriteria,
    constraints,
    assumptions: [{ text: "The principal orchestrator will select the smallest safe execution path consistent with the normalized brief.", sourceId: sources[0].id }],
    projectScope: {},
    riskLevel: inferRisk(text),
    requiredSkills: inferSkills(text),
    domains: inferDomains(text),
    verificationExpectations: ["Verify required acceptance criteria with independent evidence.", "Preserve bounded artifacts and failure classifications."],
    escalationConditions: ["Missing permission or credential", "Material ambiguity", "Irreversible or high-impact action", "Safety boundary", "Exhausted bounded recovery"],
    sourceReferences: sources.map((source) => `${source.id}:${source.contentHash}`),
  };
  return { brief, issues };
}

function extractJson(value: string): unknown {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || value;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Intake model returned no JSON object");
  return JSON.parse(fenced.slice(start, end + 1));
}

function validateModelBrief(value: unknown, fallback: MissionBrief, sources: MissionIntakeSource[]): MissionBrief {
  if (!value || typeof value !== "object") throw new Error("Intake model returned an invalid brief");
  const candidate = value as Partial<MissionBrief>;
  const objective = typeof candidate.objective === "string" ? bounded(candidate.objective, 2_000) : fallback.objective;
  if (objective.length < 12) throw new Error("Intake model returned an unusable objective");
  const sourceIds = new Set(sources.map((source) => source.id));
  const criteria = Array.isArray(candidate.acceptanceCriteria) ? candidate.acceptanceCriteria.filter((item): item is AcceptanceCriterion & { sourceId: string } => Boolean(item && typeof item === "object" && typeof (item as { description?: unknown }).description === "string")).slice(0, 30).map((item, index): AcceptanceCriterion & { sourceId: string } => {
    const verification: AcceptanceCriterion["verification"] = item.verification === "visual" || item.verification === "runtime" || item.verification === "manual" || item.verification === "mixed" ? item.verification : "automated";
    return { id: bounded(String(item.id || `criterion-${index + 1}`), 128), description: bounded(item.description, 2_000), verification, required: item.required !== false, sourceId: sourceIds.has(item.sourceId) ? item.sourceId : sources[0].id };
  }) : fallback.acceptanceCriteria;
  return {
    ...fallback,
    ...candidate,
    objective,
    deliverables: Array.isArray(candidate.deliverables) ? candidate.deliverables.filter((item): item is string => typeof item === "string").map((item) => bounded(item, 500)).slice(0, 20) : fallback.deliverables,
    acceptanceCriteria: criteria.length ? criteria : fallback.acceptanceCriteria,
    constraints: Array.isArray(candidate.constraints) ? candidate.constraints.filter((item): item is string => typeof item === "string").map((item) => bounded(item, 2_000)).slice(0, 30) : fallback.constraints,
    requiredSkills: Array.isArray(candidate.requiredSkills) ? candidate.requiredSkills.filter((item): item is string => typeof item === "string").map((item) => bounded(item, 100)).slice(0, 20) : fallback.requiredSkills,
    domains: Array.isArray(candidate.domains) ? candidate.domains.filter((item): item is string => typeof item === "string").map((item) => bounded(item, 100)).slice(0, 12) : fallback.domains,
    sourceReferences: sources.map((source) => `${source.id}:${source.contentHash}`),
  };
}

function decisionFor(brief: MissionBrief, issues: IntakeIssue[]): IntakeDecision {
  if (issues.some((issue) => issue.severity === "blocking")) return issues.some((issue) => issue.code === "MATERIAL_AMBIGUITY" || issue.code === "CONTRADICTION") ? "needs_clarification" : "blocked";
  return issues.length ? "ready_with_assumptions" : "ready_for_planning";
}

export async function runMissionIntake(ownerId: string, input: { projectId?: string | null; model?: string; sources: IntakeSourceInput[]; signal?: AbortSignal }): Promise<MissionIntakeResult> {
  const intakeContract = getAgentContract("intake");
  assertSkillAllowed(intakeContract, "requirement_extraction");
  assertSkillAllowed(intakeContract, "source_traceability");
  assertSkillAllowed(intakeContract, "risk_classification");
  assertHarnessAllowed(intakeContract, { harness: "mission_intake", operation: "ingest_text", input: { sourceCount: input.sources.length } });
  const sources = normalizeSources(input.sources);
  if (JSON.stringify(sources).length > MAX_COMBINED_LENGTH) throw new Error("Mission intake sources exceed the combined safety limit");
  const deterministic = deterministicBrief(sources);
  let brief = deterministic.brief;
  let issues = deterministic.issues;
  let normalizationSource: "deterministic" | "model" = "deterministic";
  if (input.model) {
    const signal = input.signal || new AbortController().signal;
    const modelInput = redactSensitiveData({ sources: sources.map((source) => ({ id: source.id, kind: source.kind, name: source.name, mimeType: source.mimeType, text: source.text })) });
    try {
      const result = await streamWorkspaceModel(ownerId, { model: input.model, messages: [{ role: "system", content: MISSION_INTAKE_SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(modelInput) }] }, signal);
      if (result.stopped || !result.finished) throw new Error("Intake normalization was not completed");
      brief = validateModelBrief(extractJson(result.content), deterministic.brief, sources);
      issues = detectIssues(sources, brief.objective, brief.constraints);
      normalizationSource = "model";
    } catch (error) {
      if (signal.aborted) throw error;
      console.warn("[MissionIntake] model normalization rejected; using deterministic extraction", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  const decision = decisionFor(brief, issues);
  assertHarnessAllowed(intakeContract, { harness: "mission_intake", operation: "classify_risk", input: { issueCount: issues.length, riskLevel: brief.riskLevel } });
  assertHarnessAllowed(intakeContract, { harness: "mission_intake", operation: "normalize_brief", input: { objectiveLength: brief.objective.length } });
  const record = await createMissionIntake(ownerId, { projectId: input.projectId, model: input.model, status: decision, sources, brief: { ...brief, normalizationSource }, issues });
  assertHarnessAllowed(intakeContract, { harness: "mission_intake", operation: "persist_intake", input: { intakeId: record.id } });
  return { intake: record, brief, decision, issues, sourceReferences: brief.sourceReferences };
}

export async function getStoredMissionIntake(ownerId: string, intakeId: string) {
  return getMissionIntake(ownerId, intakeId);
}

export async function createMissionFromIntake(ownerId: string, input: { projectId?: string | null; model?: string; sources: IntakeSourceInput[]; budget?: MissionBudget; signal?: AbortSignal }): Promise<{ intake: MissionIntakeRecord; mission: Awaited<ReturnType<typeof createMission>> }> {
  const result = await runMissionIntake(ownerId, input);
  if (result.decision !== "ready_for_planning" && result.decision !== "ready_with_assumptions") throw new Error(`Mission intake cannot create a mission from decision ${result.decision}`);
  const contract: CreateMissionInput["contract"] = {
    intakeId: result.intake.id,
    model: input.model,
    sourceReferences: result.sourceReferences,
    requiredSkills: result.brief.requiredSkills,
    domains: result.brief.domains,
    intakeDecision: result.decision,
    deliverables: result.brief.deliverables,
    acceptanceCriteria: result.brief.acceptanceCriteria.map(({ sourceId: _sourceId, ...criterion }) => criterion),
    constraints: result.brief.constraints,
    assumptions: result.brief.assumptions.map((assumption) => assumption.text),
    projectScope: result.brief.projectScope,
    riskLevel: result.brief.riskLevel,
    completionPolicy: result.brief.verificationExpectations,
  };
  const mission = await createMission(ownerId, { projectId: input.projectId, goal: result.brief.objective, contract, budget: input.budget });
  return { intake: result.intake, mission };
}
