import type { MissionRisk } from "./constitution";
import type { QualityDecision, Verification } from "./workflowTypes";

export type IndependenceMode = Verification["independenceMode"];

const INDEPENDENCE_RANK: Readonly<Record<IndependenceMode, number>> = {
  self_check: 1,
  fresh_context: 2,
  blind_review: 3,
  separate_agent: 4,
  separate_model: 5,
  runtime_reproduction: 6,
};

export const MINIMUM_INDEPENDENCE_BY_RISK: Readonly<Record<MissionRisk, IndependenceMode>> = {
  low: "fresh_context",
  medium: "blind_review",
  high: "separate_agent",
  critical: "separate_model",
};

export type RiskQualityProfile = {
  minimumIndependence: IndependenceMode;
  requiredVerificationCount: number;
  requiredEvidenceKinds: readonly string[];
  requireSecurityReview: boolean;
};

export const RISK_QUALITY_PROFILES: Readonly<Record<MissionRisk, RiskQualityProfile>> = {
  low: { minimumIndependence: "fresh_context", requiredVerificationCount: 0, requiredEvidenceKinds: [], requireSecurityReview: false },
  medium: { minimumIndependence: "blind_review", requiredVerificationCount: 1, requiredEvidenceKinds: ["quality_check"], requireSecurityReview: false },
  high: { minimumIndependence: "separate_agent", requiredVerificationCount: 2, requiredEvidenceKinds: ["quality_check", "security_review"], requireSecurityReview: true },
  critical: { minimumIndependence: "separate_model", requiredVerificationCount: 3, requiredEvidenceKinds: ["quality_check", "security_review"], requireSecurityReview: true },
};

export type MissionQualityInput = {
  riskLevel: MissionRisk;
  evidence: readonly { kind: string; strength?: string }[];
  verifications: readonly { status: string; independenceMode: IndependenceMode; evidenceRefs: readonly string[] }[];
  completedWorkItemRoles?: readonly string[];
};

export type MissionQualityDecision = {
  allowed: boolean;
  profile: RiskQualityProfile;
  passingVerificationCount: number;
  missingEvidenceKinds: string[];
  reason: string;
};

export function decideMissionQuality(input: MissionQualityInput): MissionQualityDecision {
  const profile = RISK_QUALITY_PROFILES[input.riskLevel];
  const availableKinds = new Set(input.evidence.map((item) => item.kind));
  const missingEvidenceKinds = profile.requiredEvidenceKinds.filter((kind) => !availableKinds.has(kind));
  const securityReviewPresent = availableKinds.has("security_review") || (input.completedWorkItemRoles || []).includes("security_auditor");
  if (profile.requireSecurityReview && !securityReviewPresent && !missingEvidenceKinds.includes("security_review")) missingEvidenceKinds.push("security_review");
  const passingVerificationCount = input.verifications.filter((verification) => verification.status === "passed" && verification.evidenceRefs.length > 0 && INDEPENDENCE_RANK[verification.independenceMode] >= INDEPENDENCE_RANK[profile.minimumIndependence]).length;
  const allowed = passingVerificationCount >= profile.requiredVerificationCount && missingEvidenceKinds.length === 0;
  const reason = allowed ? `Risk-based quality requirements satisfied for ${input.riskLevel} risk` : missingEvidenceKinds.length ? `Missing risk-based evidence: ${missingEvidenceKinds.join(", ")}` : `Requires ${profile.requiredVerificationCount} passing independent verification record(s) at ${profile.minimumIndependence}; found ${passingVerificationCount}`;
  return { allowed, profile, passingVerificationCount, missingEvidenceKinds, reason };
}

export type QualityGateInput = {
  riskLevel: MissionRisk;
  decision: QualityDecision;
  independenceMode: IndependenceMode;
  requiredVerificationCount: number;
  passingVerificationCount: number;
  unresolvedFindings?: readonly string[];
};

export type QualityGateDecision = {
  allowed: boolean;
  minimumIndependence: IndependenceMode;
  reason: string;
};

export function decideQualityGate(input: QualityGateInput): QualityGateDecision {
  const minimumIndependence = MINIMUM_INDEPENDENCE_BY_RISK[input.riskLevel];
  const independentEnough = INDEPENDENCE_RANK[input.independenceMode] >= INDEPENDENCE_RANK[minimumIndependence];
  const enoughVerification = input.passingVerificationCount >= input.requiredVerificationCount;
  const hasUnresolvedFindings = (input.unresolvedFindings || []).length > 0;
  const accepted = input.decision === "accepted";
  const allowed = independentEnough && (!accepted || (enoughVerification && !hasUnresolvedFindings));
  const reason = !independentEnough
    ? `Quality review requires at least ${minimumIndependence} for ${input.riskLevel} risk`
    : accepted && !enoughVerification
      ? `Quality review requires ${input.requiredVerificationCount} passing verification records`
      : accepted && hasUnresolvedFindings
        ? "Quality review cannot accept unresolved findings"
        : "Quality decision satisfies the independence and evidence policy";
  return { allowed, minimumIndependence, reason };
}

export function assertQualityGate(input: QualityGateInput) {
  const decision = decideQualityGate(input);
  if (!decision.allowed) throw new Error(`Workflow quality gate denied: ${decision.reason}`);
  return decision;
}
