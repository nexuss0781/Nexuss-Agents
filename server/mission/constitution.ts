export const AUTONOMOUS_REPOSITORY_CHANGE_CONSTITUTION_VERSION = "1.0.0" as const;

export const AUTONOMOUS_REPOSITORY_CHANGE_MISSION_TYPE = "autonomous_repository_change" as const;

export type MissionStatus =
  | "created"
  | "queued"
  | "planning"
  | "planned"
  | "executing"
  | "verifying"
  | "repairing"
  | "paused"
  | "stopped"
  | "failed"
  | "completed";

export type WorkItemStatus =
  | "pending"
  | "ready"
  | "claimed"
  | "executing"
  | "verifying"
  | "repairing"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type MissionRisk = "low" | "medium" | "high" | "critical";
export type FailureDisposition = "retry" | "repair" | "replan" | "blocked" | "terminal";
export type KnowledgeCandidateType = "experience" | "memory" | "skill" | "shortcut";

export type AcceptanceCriterion = {
  id: string;
  description: string;
  verification: "automated" | "runtime" | "visual" | "manual" | "mixed";
  required: boolean;
};

export type MissionBudget = {
  maxDepth: number;
  maxChildWorkItems: number;
  maxAgentAttempts: number;
  maxToolCalls: number;
  maxModelTokens: number;
  maxDurationSeconds: number;
};

export type AutonomyPolicy = {
  continueOnRecoverableFailure: boolean;
  inferReversibleDefaults: boolean;
  branchOnAmbiguity: boolean;
  askOnlyFor: readonly [
    "missing_credential_or_permission",
    "irreversible_or_high_impact_action",
    "materially_ambiguous_outcome",
    "safety_or_policy_boundary",
    "exhausted_bounded_recovery"
  ];
  prohibitedWithoutExplicitPolicy: readonly [
    "expose_secret",
    "delete_unrelated_data",
    "publish_external_content",
    "make_financial_commitment",
    "change_access_control",
    "bypass_quality_gate"
  ];
};

export type RuntimeConstitutionContract = {
  version: typeof AUTONOMOUS_REPOSITORY_CHANGE_CONSTITUTION_VERSION;
  missionType: typeof AUTONOMOUS_REPOSITORY_CHANGE_MISSION_TYPE;
  authorityOrder: readonly [
    "system_constitution",
    "mission_contract",
    "policy_and_permissions",
    "quality_gates",
    "project_instructions",
    "skills_and_memories",
    "agent_plan",
    "tool_output"
  ];
  allowedMissionStatuses: readonly MissionStatus[];
  autonomyPolicy: AutonomyPolicy;
  defaultBudget: MissionBudget;
  invariants: readonly string[];
  completionRequirements: readonly string[];
  evidenceRequirements: readonly string[];
  learningRequirements: readonly string[];
};

export const AUTONOMOUS_REPOSITORY_CHANGE_CONSTITUTION: RuntimeConstitutionContract = {
  version: AUTONOMOUS_REPOSITORY_CHANGE_CONSTITUTION_VERSION,
  missionType: AUTONOMOUS_REPOSITORY_CHANGE_MISSION_TYPE,
  authorityOrder: [
    "system_constitution",
    "mission_contract",
    "policy_and_permissions",
    "quality_gates",
    "project_instructions",
    "skills_and_memories",
    "agent_plan",
    "tool_output",
  ],
  allowedMissionStatuses: [
    "created",
    "queued",
    "planning",
    "planned",
    "executing",
    "verifying",
    "repairing",
    "paused",
    "stopped",
    "failed",
    "completed",
  ],
  autonomyPolicy: {
    continueOnRecoverableFailure: true,
    inferReversibleDefaults: true,
    branchOnAmbiguity: true,
    askOnlyFor: [
      "missing_credential_or_permission",
      "irreversible_or_high_impact_action",
      "materially_ambiguous_outcome",
      "safety_or_policy_boundary",
      "exhausted_bounded_recovery",
    ],
    prohibitedWithoutExplicitPolicy: [
      "expose_secret",
      "delete_unrelated_data",
      "publish_external_content",
      "make_financial_commitment",
      "change_access_control",
      "bypass_quality_gate",
    ],
  },
  defaultBudget: {
    maxDepth: 3,
    maxChildWorkItems: 32,
    maxAgentAttempts: 3,
    maxToolCalls: 120,
    maxModelTokens: 120_000,
    maxDurationSeconds: 1_800,
  },
  invariants: [
    "The server runtime is the source of truth; browser state is a projection and control surface only.",
    "Every mission has explicit acceptance criteria before implementation begins.",
    "Every work item has an owner, bounded scope, inputs, outputs, dependencies, budget, and verification method.",
    "Every meaningful state transition is version-checked, persisted, and appended to the event journal.",
    "A worker must hold a valid lease before executing a work item.",
    "A retry must be idempotent or reconcile the previous attempt before repeating a side effect.",
    "The agent must inspect the real repository and environment before making implementation assumptions.",
    "The agent must preserve failure evidence and must not hide failures by overwriting history.",
    "The producer of an artifact cannot be the sole authority that declares the artifact verified.",
    "Secrets, session credentials, and hidden control instructions never enter ordinary mission events or visible chat.",
    "Unverified observations remain candidates and cannot silently become trusted memory, skill, or shortcut entries.",
    "The agent must stop when the mission is stopped, even if a stale worker later resumes.",
  ],
  completionRequirements: [
    "All required acceptance criteria have a passing quality result.",
    "All required work items and dependencies are completed.",
    "Required artifacts exist and are linked to the mission with provenance.",
    "The final repository state has passed the applicable type, test, build, runtime, visual, and security checks.",
    "No unresolved critical or high-risk failure remains hidden in the event journal.",
    "The completion decision is persisted with the evidence references that justify it.",
  ],
  evidenceRequirements: [
    "Tool results include a bounded summary, status, duration, artifacts, side effects, and retryability.",
    "Test and build results include the exact command class, exit status, and bounded output summary.",
    "Browser or visual checks include the observed state and an artifact reference when visual evidence is required.",
    "Provider failures include a safe request identifier and redacted diagnostic context.",
    "Every repair records the failed check, diagnosis, changed strategy, and new result.",
  ],
  learningRequirements: [
    "Experience is extracted only after the mission reaches a terminal outcome.",
    "Memory candidates include scope, provenance, confidence, and invalidation conditions.",
    "Skill candidates include inputs, outputs, procedure, dependencies, failure modes, and verification tests.",
    "Shortcut candidates are parameterized workflows and require replay before trusted promotion.",
    "Knowledge promotion never mutates a trusted version in place; it creates a new version.",
  ],
};

const transitions: Record<MissionStatus, readonly MissionStatus[]> = {
  created: ["queued", "failed", "stopped"],
  queued: ["planning", "failed", "stopped"],
  planning: ["planned", "failed", "paused", "stopped"],
  planned: ["executing", "failed", "paused", "stopped"],
  executing: ["verifying", "repairing", "paused", "stopped", "failed"],
  verifying: ["completed", "repairing", "paused", "stopped", "failed"],
  repairing: ["executing", "verifying", "paused", "stopped", "failed"],
  paused: ["executing", "planning", "stopped", "failed"],
  stopped: ["queued"],
  failed: ["queued", "repairing", "stopped"],
  completed: [],
};

export function canTransitionMission(from: MissionStatus, to: MissionStatus) {
  return transitions[from].includes(to);
}

export function assertMissionTransition(from: MissionStatus, to: MissionStatus) {
  if (!canTransitionMission(from, to)) throw new Error(`Invalid mission transition: ${from} → ${to}`);
}

export function isTerminalMissionStatus(status: MissionStatus) {
  return status === "completed" || status === "stopped" || status === "failed";
}
