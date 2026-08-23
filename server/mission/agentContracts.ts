import { getSpecialist, type SpecialistKind } from "./specialists";
import { redactSensitiveData } from "./redaction";

export const AGENT_CONTRACT_VERSION = "1.0.0" as const;

export type AgentLayer = "principal_orchestrator" | "sub_orchestrator" | "specialist" | "quality_gate";
export type AgentLoopStage = "intake" | "inspect" | "plan" | "delegate" | "execute" | "verify" | "recover" | "checkpoint" | "report";
export type AgentFailureClass = "retryable" | "repairable" | "replan_required" | "blocked" | "cancelled" | "terminal";
export type AgentAuthority = "mission_owner" | "delegation_only" | "execution_only" | "verification_only";

export type AgentBudget = {
  maxDepth: number;
  maxChildren: number;
  maxAttempts: number;
  maxToolCalls: number;
  maxModelTokens: number;
  maxDurationSeconds: number;
};

export type AgentRoleContract = {
  version: typeof AGENT_CONTRACT_VERSION;
  layer: AgentLayer;
  kind: SpecialistKind | "principal";
  title: string;
  authority: AgentAuthority;
  objective: string;
  loop: readonly AgentLoopStage[];
  allowedSkills: readonly string[];
  allowedHarnesses: readonly string[];
  canDelegate: boolean;
  canWriteRepository: boolean;
  canVerifyProducerOutput: boolean;
  budget: AgentBudget;
  failurePolicy: readonly AgentFailureClass[];
  escalationConditions: readonly string[];
  evidenceRequirements: readonly string[];
  systemPrompt: string;
};

export type AgentPromptContext = {
  missionGoal: string;
  workItemTitle?: string;
  workItemDescription?: string;
  acceptanceCriteria: unknown;
  allowedSkills: readonly string[];
  allowedHarnesses: readonly string[];
  priorEvidence?: unknown;
};

export const DEFAULT_AGENT_BUDGET: AgentBudget = {
  maxDepth: 3,
  maxChildren: 8,
  maxAttempts: 3,
  maxToolCalls: 40,
  maxModelTokens: 30_000,
  maxDurationSeconds: 600,
};

const commonEscalations = ["missing credential or permission", "irreversible or high-impact action", "materially ambiguous outcome", "safety or policy boundary", "exhausted bounded recovery"] as const;
const commonEvidence = ["bounded summary", "status and duration", "artifact or evidence references", "failure classification and retryability"] as const;

export const AGENT_LOOP: readonly AgentLoopStage[] = ["intake", "inspect", "plan", "delegate", "execute", "verify", "recover", "checkpoint", "report"];

export function getAgentContract(kind: SpecialistKind | "principal"): AgentRoleContract {
  if (kind === "principal") return {
    version: AGENT_CONTRACT_VERSION, layer: "principal_orchestrator", kind, title: "Principal Orchestrator", authority: "mission_owner", objective: "Own the mission objective, decompose it into bounded work, delegate to registered agents, and make the final coordination decision.", loop: ["intake", "inspect", "plan", "delegate", "verify", "checkpoint", "report"], allowedSkills: ["mission_planning", "repository_inspection", "skill_selection"], allowedHarnesses: ["mission_runtime", "repository_inspection"], canDelegate: true, canWriteRepository: false, canVerifyProducerOutput: true, budget: { ...DEFAULT_AGENT_BUDGET, maxChildren: 12 }, failurePolicy: ["retryable", "repairable", "replan_required", "blocked", "cancelled", "terminal"], escalationConditions: commonEscalations, evidenceRequirements: commonEvidence, systemPrompt: "You are the principal orchestrator. Own coordination rather than implementation. Decompose the mission, select registered specialists, preserve authority boundaries, and accept completion only from independent evidence." };
  const descriptor = getSpecialist(kind);
  const isSub = kind === "sub_orchestrator";
  const isQuality = kind === "quality_gate";
  return {
    version: AGENT_CONTRACT_VERSION,
    layer: isSub ? "sub_orchestrator" : isQuality ? "quality_gate" : "specialist",
    kind,
    title: descriptor.title,
    authority: isSub ? "delegation_only" : isQuality ? "verification_only" : "execution_only",
    objective: descriptor.systemInstruction,
    loop: isSub ? ["intake", "inspect", "plan", "delegate", "checkpoint", "report"] : isQuality ? ["intake", "inspect", "execute", "verify", "checkpoint", "report"] : ["intake", "inspect", "execute", "verify", "recover", "checkpoint", "report"],
    allowedSkills: isQuality ? ["quality_verification", "failure_classification"] : isSub ? ["mission_decomposition", "specialist_selection"] : ["repository_inspection", "bounded_execution", "failure_classification"],
    allowedHarnesses: isQuality ? ["repository_verification"] : isSub ? ["mission_runtime", "specialist_spawn"] : ["repository_inspection", "repository_change", "repository_verification"],
    canDelegate: descriptor.canSpawnSpecialists,
    canWriteRepository: descriptor.canWriteRepository,
    canVerifyProducerOutput: isQuality || kind === "security_auditor" || kind === "integrator",
    budget: { ...DEFAULT_AGENT_BUDGET, maxChildren: descriptor.canSpawnSpecialists ? 2 : 0, maxDurationSeconds: descriptor.maxConcurrent > 1 ? 300 : 600 },
    failurePolicy: ["retryable", "repairable", "blocked", "cancelled", "terminal"],
    escalationConditions: commonEscalations,
    evidenceRequirements: commonEvidence,
    systemPrompt: `${descriptor.systemInstruction} You must follow the declared loop and remain within the registered capability boundaries.`,
  };
}

export function buildAgentSystemPrompt(contract: AgentRoleContract, context: AgentPromptContext) {
  return `${contract.systemPrompt}\n\nCONTRACT VERSION\n${contract.version}\n\nROLE\n${contract.title} (${contract.layer})\n\nAUTHORITY\n${contract.authority}\n\nLOOP\n${contract.loop.join(" → ")}\n\nALLOWED SKILLS\n${context.allowedSkills.join(", ") || "none"}\n\nALLOWED HARNESSES\n${context.allowedHarnesses.join(", ") || "none"}\n\nMISSION CONTEXT\n${JSON.stringify(redactSensitiveData({ missionGoal: context.missionGoal, workItemTitle: context.workItemTitle, workItemDescription: context.workItemDescription, acceptanceCriteria: context.acceptanceCriteria, priorEvidence: context.priorEvidence || null }))}\n\nFAILURE POLICY\n${contract.failurePolicy.join(", ")}\n\nEVIDENCE\n${contract.evidenceRequirements.join(", ")}\n\nRULES\nUse only the allowed skills and harnesses. Preserve bounded evidence. Never expose secrets. Never claim completion without independent verification. Escalate only when a declared escalation condition is reached.`;
}
