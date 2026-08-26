import { z } from "zod";
import { AUTHORITY_CLASSES, SIDE_EFFECT_CLASSES, WORKFLOW_STAGES } from "./workflowTypes";
import { sideEffectForAction, type WorkflowAction } from "./authorityPolicy";
import { SKILL_DOMAINS, type DomainSkillContract } from "./skillTypes";

const id = z.string().trim().min(1).max(256);
const text = z.string().trim().min(1).max(4_000);
const list = z.array(text).max(100);
const actionValues: WorkflowAction[] = ["inspect", "read", "search", "calculate", "design", "create", "write", "append", "patch", "replace", "format", "copy", "move", "rename", "delete", "clean_generated", "diff", "apply_patch", "rollback", "snapshot", "restore_snapshot", "branch", "stage", "commit", "push", "research", "publish", "communicate", "deploy"];

export const skillInputSchema = z.object({
  id,
  description: text,
  required: z.boolean(),
  acceptedKinds: list,
  sourceRequirements: list,
}).strict();

export const skillOutputSchema = z.object({
  id,
  description: text,
  required: z.boolean(),
  artifactKinds: list,
  evidenceKinds: list,
}).strict();

export const skillProcedureStepSchema = z.object({
  id,
  stage: z.enum(WORKFLOW_STAGES),
  instruction: text,
  required: z.boolean(),
}).strict();

export const skillEvidencePlanSchema = z.object({
  requiredKinds: list,
  minimumStrength: z.enum(["weak", "moderate", "strong", "conclusive"]),
  provenanceRequirements: list,
  claimTraceability: z.boolean(),
}).strict();

export const skillVerificationPlanSchema = z.object({
  methods: list,
  minimumIndependence: z.enum(["self_check", "fresh_context", "blind_review", "separate_agent", "separate_model", "runtime_reproduction"]),
  acceptanceChecks: list,
  producerMayVerify: z.boolean(),
}).strict();

export const skillFailurePlanSchema = z.object({
  failureClasses: list,
  retryable: list,
  repairable: list,
  replanRequired: list,
  escalationConditions: list,
  changedStrategyRequired: z.boolean(),
}).strict();

export const skillCompositionPlanSchema = z.object({
  consumes: list,
  produces: list,
  compatibleDomains: z.array(z.enum(SKILL_DOMAINS)).max(20),
  handoffRequirements: list,
}).strict();

export const domainSkillContractSchema = z.object({
  id,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  title: text,
  domain: z.enum(SKILL_DOMAINS),
  maturity: z.enum(["experimental", "validated", "stable"]),
  description: text,
  missionSignals: list,
  supportedStages: z.array(z.enum(WORKFLOW_STAGES)).min(1).max(WORKFLOW_STAGES.length),
  inputs: z.array(skillInputSchema).min(1).max(100),
  procedure: z.array(skillProcedureStepSchema).min(1).max(100),
  actions: z.array(z.enum(actionValues as [WorkflowAction, ...WorkflowAction[]])).min(1).max(actionValues.length),
  authority: z.enum(AUTHORITY_CLASSES),
  sideEffects: z.array(z.enum(SIDE_EFFECT_CLASSES)).min(1).max(SIDE_EFFECT_CLASSES.length),
  allowedRoles: list,
  allowedHarnesses: list,
  outputs: z.array(skillOutputSchema).min(1).max(100),
  evidence: skillEvidencePlanSchema,
  verification: skillVerificationPlanSchema,
  failure: skillFailurePlanSchema,
  composition: skillCompositionPlanSchema,
  defaultBudget: z.object({
    maxDurationSeconds: z.number().int().positive().optional(),
    maxModelTokens: z.number().int().positive().optional(),
    maxToolCalls: z.number().int().positive().optional(),
    maxAgentAttempts: z.number().int().positive().optional(),
    maxChildWorkItems: z.number().int().positive().optional(),
    maxDepth: z.number().int().positive().optional(),
    maxParallelWorkItems: z.number().int().positive().optional(),
  }).strict().optional(),
}).strict();

export type DomainSkillContractInput = z.infer<typeof domainSkillContractSchema>;

export function validateDomainSkillContract(input: DomainSkillContractInput): DomainSkillContractInput {
  const parsed = domainSkillContractSchema.parse(input);
  const declaredEffects = new Set(parsed.sideEffects);
  for (const action of parsed.actions) {
    if (!declaredEffects.has(sideEffectForAction(action))) throw new Error(`Skill ${parsed.id} action ${action} is missing its declared side effect`);
  }
  if (!parsed.evidence.claimTraceability) throw new Error(`Skill ${parsed.id} must enable claim traceability`);
  if (!parsed.evidence.requiredKinds.length) throw new Error(`Skill ${parsed.id} must require at least one evidence kind`);
  if (!parsed.outputs.some((output) => output.evidenceKinds.length > 0)) throw new Error(`Skill ${parsed.id} must define an output linked to evidence`);
  if (!parsed.verification.methods.length || !parsed.verification.acceptanceChecks.length) throw new Error(`Skill ${parsed.id} must define verification methods and acceptance checks`);
  if (!parsed.failure.changedStrategyRequired) throw new Error(`Skill ${parsed.id} must require a changed strategy for retries`);
  if (parsed.authority === "verification_only" && parsed.actions.some((action) => ["write", "append", "patch", "replace", "delete", "commit", "push"].includes(action))) throw new Error(`Skill ${parsed.id} cannot assign mutation actions to verification_only authority`);
  return parsed;
}
