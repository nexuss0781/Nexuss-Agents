import type { WorkflowAction } from "./authorityPolicy";
import type { AuthorityClass, MissionBudget, SideEffectClass, WorkflowStage } from "./workflowTypes";

export const SKILL_CONTRACT_VERSION = "1.0.0" as const;
export const SKILL_DOMAINS = ["research", "software_engineering", "mathematics", "mixed_mission"] as const;
export type SkillDomain = (typeof SKILL_DOMAINS)[number];
export type SkillMaturity = "experimental" | "validated" | "stable";

export type SkillInput = {
  id: string;
  description: string;
  required: boolean;
  acceptedKinds: string[];
  sourceRequirements: string[];
};

export type SkillOutput = {
  id: string;
  description: string;
  required: boolean;
  artifactKinds: string[];
  evidenceKinds: string[];
};

export type SkillProcedureStep = {
  id: string;
  stage: WorkflowStage;
  instruction: string;
  required: boolean;
};

export type SkillEvidencePlan = {
  requiredKinds: string[];
  minimumStrength: "weak" | "moderate" | "strong" | "conclusive";
  provenanceRequirements: string[];
  claimTraceability: boolean;
};

export type SkillVerificationPlan = {
  methods: string[];
  minimumIndependence: "self_check" | "fresh_context" | "blind_review" | "separate_agent" | "separate_model" | "runtime_reproduction";
  acceptanceChecks: string[];
  producerMayVerify: boolean;
};

export type SkillFailurePlan = {
  failureClasses: string[];
  retryable: string[];
  repairable: string[];
  replanRequired: string[];
  escalationConditions: string[];
  changedStrategyRequired: boolean;
};

export type SkillCompositionPlan = {
  consumes: string[];
  produces: string[];
  compatibleDomains: SkillDomain[];
  handoffRequirements: string[];
};

export type DomainSkillContract = {
  id: string;
  version: string;
  title: string;
  domain: SkillDomain;
  maturity: SkillMaturity;
  description: string;
  missionSignals: string[];
  supportedStages: WorkflowStage[];
  inputs: SkillInput[];
  procedure: SkillProcedureStep[];
  actions: WorkflowAction[];
  authority: AuthorityClass;
  sideEffects: SideEffectClass[];
  allowedRoles: string[];
  allowedHarnesses: string[];
  outputs: SkillOutput[];
  evidence: SkillEvidencePlan;
  verification: SkillVerificationPlan;
  failure: SkillFailurePlan;
  composition: SkillCompositionPlan;
  defaultBudget?: Partial<MissionBudget>;
  markdown: string;
  sourceFile: string;
  sourceHash: string;
};

export type SkillBinding = {
  skillId: string;
  version: string;
  domain: SkillDomain;
  sourceFile: string;
  selectionReason: string;
};

export type SkillSelectionRequest = {
  objective: string;
  domains?: readonly string[];
  requiredSkills?: readonly string[];
  stage?: WorkflowStage;
  role?: string;
  actions?: readonly WorkflowAction[];
  harnesses?: readonly string[];
};

export type SkillRegistryDiagnostic = {
  sourceFile: string;
  skillId?: string;
  message: string;
};

export type SkillRegistrySnapshot = {
  skills: DomainSkillContract[];
  diagnostics: SkillRegistryDiagnostic[];
};
