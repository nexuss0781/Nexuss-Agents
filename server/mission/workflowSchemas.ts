import { z } from "zod";
import {
  AUTHORITY_CLASSES,
  EVIDENCE_STRENGTHS,
  EXECUTION_RESULTS,
  FAILURE_CLASSIFICATIONS,
  INTAKE_DECISIONS,
  MISSION_STATUSES,
  PROVENANCE_KINDS,
  QUALITY_DECISIONS,
  SIDE_EFFECT_CLASSES,
  STAGE_RUN_STATUSES,
  VERIFICATION_STATUSES,
  WORKFLOW_STAGES,
  WORK_ITEM_STATUSES,
} from "./workflowTypes";

const id = z.string().trim().min(1).max(256);
const shortText = z.string().trim().min(1).max(2_000);
const longText = z.string().trim().min(1).max(100_000);
const timestamp = z.string().datetime({ offset: true });
const jsonObject = z.record(z.string().max(256), z.unknown());
const confidence = z.number().min(0).max(1);
const nonEmptyIds = z.array(id).max(500);

export const workflowStageSchema = z.enum(WORKFLOW_STAGES);
export const missionStatusSchema = z.enum(MISSION_STATUSES);
export const stageRunStatusSchema = z.enum(STAGE_RUN_STATUSES);
export const workItemStatusSchema = z.enum(WORK_ITEM_STATUSES);
export const intakeDecisionSchema = z.enum(INTAKE_DECISIONS);
export const executionResultSchema = z.enum(EXECUTION_RESULTS);
export const failureClassificationSchema = z.enum(FAILURE_CLASSIFICATIONS);
export const verificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export const qualityDecisionSchema = z.enum(QUALITY_DECISIONS);
export const authorityClassSchema = z.enum(AUTHORITY_CLASSES);
export const sideEffectClassSchema = z.enum(SIDE_EFFECT_CLASSES);
export const provenanceKindSchema = z.enum(PROVENANCE_KINDS);
export const evidenceStrengthSchema = z.enum(EVIDENCE_STRENGTHS);

export const provenanceRefSchema = z.object({
  kind: provenanceKindSchema,
  ref: id,
  label: z.string().trim().max(500).optional(),
}).strict();

export const acceptanceCriterionSchema = z.object({
  id,
  description: shortText,
  verification: z.enum(["automated", "runtime", "visual", "manual", "mixed"]),
  required: z.boolean(),
}).strict();

export const requirementSchema = z.object({
  id,
  missionId: id,
  statement: longText,
  kind: z.enum(["objective", "deliverable", "constraint", "acceptance", "permission"]),
  required: z.boolean(),
  sourceRefs: z.array(provenanceRefSchema).max(100),
  status: z.enum(["open", "satisfied", "unsatisfied", "waived"]),
}).strict();

export const assumptionSchema = z.object({
  id,
  missionId: id,
  statement: shortText,
  basisRefs: z.array(provenanceRefSchema).max(100),
  confidence,
  reversible: z.boolean(),
  verified: z.boolean(),
  invalidationConditions: z.array(shortText).max(100),
}).strict();

export const missionBudgetSchema = z.object({
  maxDurationSeconds: z.number().int().min(1).max(86_400),
  maxModelTokens: z.number().int().min(1_000).max(10_000_000),
  maxToolCalls: z.number().int().min(1).max(100_000),
  maxAgentAttempts: z.number().int().min(1).max(100),
  maxChildWorkItems: z.number().int().min(1).max(10_000),
  maxDepth: z.number().int().min(1).max(20),
  maxParallelWorkItems: z.number().int().min(1).max(1_000),
}).strict();

export const missionContractSchema = z.object({
  version: id,
  objective: longText,
  deliverables: z.array(shortText).max(100),
  requirements: z.array(requirementSchema).max(500),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).max(500),
  constraints: z.array(shortText).max(200),
  assumptions: z.array(assumptionSchema).max(200),
  requiredSkills: z.array(id).max(100),
  domains: z.array(id).max(50),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  completionPolicy: z.array(shortText).max(100),
  sourceRefs: z.array(provenanceRefSchema).max(500),
}).strict();

export const workflowMissionSchema = z.object({
  id,
  ownerId: id,
  projectId: id.optional(),
  parentMissionId: id.optional(),
  contractVersion: z.literal("1.0.0"),
  objective: longText,
  contract: missionContractSchema,
  status: missionStatusSchema,
  budget: missionBudgetSchema,
  version: z.number().int().min(1),
  createdAt: timestamp,
  updatedAt: timestamp,
  startedAt: timestamp.optional(),
  completedAt: timestamp.optional(),
}).strict();

export const stageRunSchema = z.object({
  id,
  missionId: id,
  stage: workflowStageSchema,
  status: stageRunStatusSchema,
  attempt: z.number().int().min(0).max(100),
  parentStageRunId: id.optional(),
  inputRefs: nonEmptyIds,
  outputRefs: z.array(id).max(500),
  activeAssignmentId: id.optional(),
  checkpointId: id.optional(),
  startedAt: timestamp.optional(),
  completedAt: timestamp.optional(),
  createdAt: timestamp,
}).strict();

export const workItemSchema = z.object({
  id,
  missionId: id,
  parentWorkItemId: id.optional(),
  stage: workflowStageSchema,
  objective: longText,
  description: longText,
  role: id,
  status: workItemStatusSchema,
  inputRefs: nonEmptyIds,
  acceptanceCriteria: z.array(acceptanceCriterionSchema).max(200),
  dependencies: z.array(id).max(500),
  allowedSkills: z.array(id).max(100),
  allowedHarnesses: z.array(id).max(100),
  budget: missionBudgetSchema,
  attempt: z.number().int().min(0).max(100),
  outputRefs: z.array(id).max(500),
  failureRefs: z.array(id).max(500),
  version: z.number().int().min(1),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export const agentAssignmentSchema = z.object({
  id,
  missionId: id,
  workItemId: id,
  parentAssignmentId: id.optional(),
  agentId: id,
  role: id,
  authority: authorityClassSchema,
  allowedSkills: z.array(id).max(100),
  allowedHarnesses: z.array(id).max(100),
  sideEffects: z.array(sideEffectClassSchema).max(20),
  budget: missionBudgetSchema,
  stopConditions: z.array(shortText).max(100),
  verificationMethod: shortText,
  status: z.enum(["assigned", "active", "completed", "failed", "cancelled"]),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export const decisionSchema = z.object({
  id,
  missionId: id,
  stageRunId: id.optional(),
  workItemId: id.optional(),
  objective: longText,
  currentState: longText,
  evidenceRefs: z.array(id).max(500),
  options: z.array(shortText).max(100),
  selection: longText,
  prediction: longText.optional(),
  verificationMethod: shortText.optional(),
  nextAction: shortText,
  uncertainty: z.array(shortText).max(100),
  createdAt: timestamp,
}).strict();

export const evidenceSchema = z.object({
  id,
  missionId: id,
  stageRunId: id.optional(),
  workItemId: id.optional(),
  artifactId: id.optional(),
  kind: id,
  summary: shortText,
  strength: evidenceStrengthSchema,
  provenance: z.array(provenanceRefSchema).min(1).max(100),
  data: jsonObject,
  producedBy: id,
  observedAt: timestamp,
  createdAt: timestamp,
}).strict();

export const artifactSchema = z.object({
  id,
  missionId: id,
  workItemId: id.optional(),
  kind: id,
  locator: z.string().trim().min(1).max(4_000),
  contentHash: z.string().trim().max(256).optional(),
  mediaType: z.string().trim().max(256).optional(),
  summary: shortText,
  metadata: jsonObject,
  provenance: z.array(provenanceRefSchema).max(100),
  createdAt: timestamp,
}).strict();

export const verificationSchema = z.object({
  id,
  missionId: id,
  stageRunId: id.optional(),
  workItemId: id.optional(),
  subjectRefs: z.array(id).min(1).max(500),
  method: shortText,
  independenceMode: z.enum(["self_check", "fresh_context", "blind_review", "separate_agent", "separate_model", "runtime_reproduction"]),
  status: verificationStatusSchema,
  observations: z.array(shortText).max(200),
  failedChecks: z.array(shortText).max(200),
  evidenceRefs: z.array(id).max(500),
  performedBy: id,
  startedAt: timestamp,
  completedAt: timestamp.optional(),
}).strict();

export const failureSchema = z.object({
  id,
  missionId: id,
  stageRunId: id.optional(),
  workItemId: id.optional(),
  classification: failureClassificationSchema,
  message: shortText,
  strategyFingerprint: z.string().trim().max(256).optional(),
  attempt: z.number().int().min(1).max(100),
  retryable: z.boolean(),
  newInformation: z.array(shortText).max(100),
  nextAction: shortText,
  evidenceRefs: z.array(id).max(500),
  createdAt: timestamp,
}).strict();

export const checkpointSchema = z.object({
  id,
  missionId: id,
  stageRunId: id.optional(),
  version: z.number().int().min(1),
  stage: workflowStageSchema,
  missionStatus: missionStatusSchema,
  state: jsonObject,
  nextAction: shortText,
  resumable: z.boolean(),
  createdAt: timestamp,
}).strict();

export const qualityDecisionRecordSchema = z.object({
  id,
  missionId: id,
  stageRunId: id.optional(),
  decision: qualityDecisionSchema,
  reviewerId: id,
  independenceMode: verificationSchema.shape.independenceMode,
  subjectRefs: z.array(id).min(1).max(500),
  verificationRefs: z.array(id).max(500),
  evidenceRefs: z.array(id).max(500),
  unresolvedFindings: z.array(shortText).max(200),
  nextTransition: workflowStageSchema.optional(),
  createdAt: timestamp,
}).strict();

export const continuationSchema = z.object({
  id,
  missionId: id,
  sourceMissionId: id.optional(),
  kind: z.enum(["clarification", "correction", "new_acceptance", "related_mission", "independent_mission", "replay"]),
  instruction: longText,
  affectedRefs: z.array(id).max(500),
  status: z.enum(["received", "classified", "attached", "new_mission", "completed"]),
  createdAt: timestamp,
}).strict();

export const stageResultSchema = z.object({
  missionId: id,
  stageRunId: id,
  stage: workflowStageSchema,
  status: stageRunStatusSchema,
  objective: longText,
  inputRefs: nonEmptyIds,
  decision: longText.optional(),
  evidenceRefs: z.array(id).max(500),
  artifactRefs: z.array(id).max(500),
  failedChecks: z.array(shortText).max(200),
  nextTransition: workflowStageSchema.optional(),
  uncertainty: z.array(shortText).max(100),
  requiresUserInput: z.boolean(),
}).strict();

export const workflowEventSchema = z.object({
  id,
  missionId: id,
  stageRunId: id.optional(),
  workItemId: id.optional(),
  type: z.string().trim().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/).max(160),
  actor: id,
  payload: jsonObject,
  occurredAt: timestamp,
}).strict();

export type WorkflowMissionInput = z.infer<typeof workflowMissionSchema>;
export type StageRunInput = z.infer<typeof stageRunSchema>;
export type WorkItemInput = z.infer<typeof workItemSchema>;
export type EvidenceInput = z.infer<typeof evidenceSchema>;
export type ArtifactInput = z.infer<typeof artifactSchema>;
export type VerificationInput = z.infer<typeof verificationSchema>;
export type FailureInput = z.infer<typeof failureSchema>;
export type CheckpointInput = z.infer<typeof checkpointSchema>;
export type QualityDecisionInput = z.infer<typeof qualityDecisionRecordSchema>;
export type ContinuationInput = z.infer<typeof continuationSchema>;
export type StageResultInput = z.infer<typeof stageResultSchema>;
export type WorkflowEventInput = z.infer<typeof workflowEventSchema>;
