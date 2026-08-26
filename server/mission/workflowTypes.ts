export const WORKFLOW_CONTRACT_VERSION = "1.0.0" as const;

export const WORKFLOW_STAGES = [
  "receive",
  "understand",
  "intake",
  "form_mission",
  "plan",
  "decompose_delegate",
  "research_inspect",
  "design_reason",
  "execute",
  "observe_adapt",
  "verify",
  "repair_recover",
  "integrate",
  "quality_gate",
  "complete",
  "report_continue",
] as const;
export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];

export const MISSION_STATUSES = [
  "created",
  "queued",
  "planning",
  "planned",
  "executing",
  "verifying",
  "repairing",
  "awaiting_user",
  "blocked",
  "completed",
  "failed",
  "cancelled",
  "stopped",
] as const;
export type WorkflowMissionStatus = (typeof MISSION_STATUSES)[number];

export const STAGE_RUN_STATUSES = [
  "pending",
  "active",
  "paused",
  "awaiting_input",
  "succeeded",
  "repair_required",
  "failed",
  "cancelled",
  "expired",
] as const;
export type StageRunStatus = (typeof STAGE_RUN_STATUSES)[number];

export const WORK_ITEM_STATUSES = [
  "pending",
  "ready",
  "claimed",
  "running",
  "waiting",
  "repairing",
  "completed",
  "failed",
  "blocked",
  "cancelled",
  "expired",
] as const;
export type WorkflowWorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const INTAKE_DECISIONS = [
  "ready_for_planning",
  "ready_with_assumptions",
  "needs_clarification",
  "blocked",
] as const;
export type IntakeDecision = (typeof INTAKE_DECISIONS)[number];

export const EXECUTION_RESULTS = [
  "started",
  "ongoing",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "rejected",
  "unavailable",
] as const;
export type ExecutionResult = (typeof EXECUTION_RESULTS)[number];

export const FAILURE_CLASSIFICATIONS = [
  "retryable",
  "repairable",
  "replan_required",
  "blocked",
  "cancelled",
  "terminal",
] as const;
export type FailureClassification = (typeof FAILURE_CLASSIFICATIONS)[number];

export const VERIFICATION_STATUSES = [
  "not_started",
  "running",
  "passed",
  "failed",
  "inconclusive",
  "not_applicable",
  "cancelled",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const QUALITY_DECISIONS = [
  "accepted",
  "repair_required",
  "replan_required",
  "blocked",
  "rejected",
  "cancelled",
] as const;
export type QualityDecision = (typeof QUALITY_DECISIONS)[number];

export const AUTHORITY_CLASSES = [
  "intake_only",
  "mission_owner",
  "delegation_only",
  "execution_only",
  "verification_only",
] as const;
export type AuthorityClass = (typeof AUTHORITY_CLASSES)[number];

export const SIDE_EFFECT_CLASSES = [
  "read_only",
  "local_reversible_write",
  "workspace_mutation",
  "repository_mutation",
  "network_read",
  "network_publication",
  "credential_use",
  "third_party_communication",
  "delete_or_irreversible",
  "deployment_or_release",
] as const;
export type SideEffectClass = (typeof SIDE_EFFECT_CLASSES)[number];

export const PROVENANCE_KINDS = [
  "user_input",
  "attachment",
  "project_state",
  "repository_file",
  "tool_operation",
  "external_source",
  "calculation",
  "agent_observation",
  "quality_check",
  "mission_record",
] as const;
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];

export const EVIDENCE_STRENGTHS = ["weak", "moderate", "strong", "conclusive"] as const;
export type EvidenceStrength = (typeof EVIDENCE_STRENGTHS)[number];

export type JsonObject = Record<string, unknown>;

export type ProvenanceRef = {
  kind: ProvenanceKind;
  ref: string;
  label?: string;
};

export type Requirement = {
  id: string;
  missionId: string;
  statement: string;
  kind: "objective" | "deliverable" | "constraint" | "acceptance" | "permission";
  required: boolean;
  sourceRefs: ProvenanceRef[];
  status: "open" | "satisfied" | "unsatisfied" | "waived";
};

export type Assumption = {
  id: string;
  missionId: string;
  statement: string;
  basisRefs: ProvenanceRef[];
  confidence: number;
  reversible: boolean;
  verified: boolean;
  invalidationConditions: string[];
};

export type AcceptanceCriterion = {
  id: string;
  description: string;
  verification: "automated" | "runtime" | "visual" | "manual" | "mixed";
  required: boolean;
};

export type MissionBudget = {
  maxDurationSeconds: number;
  maxModelTokens: number;
  maxToolCalls: number;
  maxAgentAttempts: number;
  maxChildWorkItems: number;
  maxDepth: number;
  maxParallelWorkItems: number;
};

export type MissionContract = {
  version: string;
  objective: string;
  deliverables: string[];
  requirements: Requirement[];
  acceptanceCriteria: AcceptanceCriterion[];
  constraints: string[];
  assumptions: Assumption[];
  requiredSkills: string[];
  domains: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  completionPolicy: string[];
  sourceRefs: ProvenanceRef[];
};

export type WorkflowMission = {
  id: string;
  ownerId: string;
  projectId?: string;
  parentMissionId?: string;
  contractVersion: typeof WORKFLOW_CONTRACT_VERSION;
  objective: string;
  contract: MissionContract;
  status: WorkflowMissionStatus;
  budget: MissionBudget;
  version: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type StageRun = {
  id: string;
  missionId: string;
  stage: WorkflowStage;
  status: StageRunStatus;
  attempt: number;
  parentStageRunId?: string;
  inputRefs: string[];
  outputRefs: string[];
  activeAssignmentId?: string;
  checkpointId?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
};

export type WorkItem = {
  id: string;
  missionId: string;
  parentWorkItemId?: string;
  stage: WorkflowStage;
  objective: string;
  description: string;
  role: string;
  status: WorkflowWorkItemStatus;
  inputRefs: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  dependencies: string[];
  allowedSkills: string[];
  allowedHarnesses: string[];
  budget: MissionBudget;
  attempt: number;
  outputRefs: string[];
  failureRefs: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type AgentAssignment = {
  id: string;
  missionId: string;
  workItemId: string;
  parentAssignmentId?: string;
  agentId: string;
  role: string;
  authority: AuthorityClass;
  allowedSkills: string[];
  allowedHarnesses: string[];
  sideEffects: SideEffectClass[];
  budget: MissionBudget;
  stopConditions: string[];
  verificationMethod: string;
  status: "assigned" | "active" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
};

export type Decision = {
  id: string;
  missionId: string;
  stageRunId?: string;
  workItemId?: string;
  objective: string;
  currentState: string;
  evidenceRefs: string[];
  options: string[];
  selection: string;
  prediction?: string;
  verificationMethod?: string;
  nextAction: string;
  uncertainty: string[];
  createdAt: string;
};

export type Evidence = {
  id: string;
  missionId: string;
  stageRunId?: string;
  workItemId?: string;
  artifactId?: string;
  kind: string;
  summary: string;
  strength: EvidenceStrength;
  provenance: ProvenanceRef[];
  data: JsonObject;
  producedBy: string;
  observedAt: string;
  createdAt: string;
};

export type Artifact = {
  id: string;
  missionId: string;
  workItemId?: string;
  kind: string;
  locator: string;
  contentHash?: string;
  mediaType?: string;
  summary: string;
  metadata: JsonObject;
  provenance: ProvenanceRef[];
  createdAt: string;
};

export type Verification = {
  id: string;
  missionId: string;
  stageRunId?: string;
  workItemId?: string;
  subjectRefs: string[];
  method: string;
  independenceMode: "self_check" | "fresh_context" | "blind_review" | "separate_agent" | "separate_model" | "runtime_reproduction";
  status: VerificationStatus;
  observations: string[];
  failedChecks: string[];
  evidenceRefs: string[];
  performedBy: string;
  startedAt: string;
  completedAt?: string;
};

export type Failure = {
  id: string;
  missionId: string;
  stageRunId?: string;
  workItemId?: string;
  classification: FailureClassification;
  message: string;
  strategyFingerprint?: string;
  attempt: number;
  retryable: boolean;
  newInformation: string[];
  nextAction: string;
  evidenceRefs: string[];
  createdAt: string;
};

export type Checkpoint = {
  id: string;
  missionId: string;
  stageRunId?: string;
  version: number;
  stage: WorkflowStage;
  missionStatus: WorkflowMissionStatus;
  state: JsonObject;
  nextAction: string;
  resumable: boolean;
  createdAt: string;
};

export type QualityDecisionRecord = {
  id: string;
  missionId: string;
  stageRunId?: string;
  decision: QualityDecision;
  reviewerId: string;
  independenceMode: Verification["independenceMode"];
  subjectRefs: string[];
  verificationRefs: string[];
  evidenceRefs: string[];
  unresolvedFindings: string[];
  nextTransition?: WorkflowStage;
  createdAt: string;
};

export type Continuation = {
  id: string;
  missionId: string;
  sourceMissionId?: string;
  kind: "clarification" | "correction" | "new_acceptance" | "related_mission" | "independent_mission" | "replay";
  instruction: string;
  affectedRefs: string[];
  status: "received" | "classified" | "attached" | "new_mission" | "completed";
  createdAt: string;
};

export type StageResult = {
  missionId: string;
  stageRunId: string;
  stage: WorkflowStage;
  status: StageRunStatus;
  objective: string;
  inputRefs: string[];
  decision?: string;
  evidenceRefs: string[];
  artifactRefs: string[];
  failedChecks: string[];
  nextTransition?: WorkflowStage;
  uncertainty: string[];
  requiresUserInput: boolean;
};

export type WorkflowEvent = {
  id: string;
  missionId: string;
  stageRunId?: string;
  workItemId?: string;
  type: string;
  actor: string;
  payload: JsonObject;
  occurredAt: string;
};
