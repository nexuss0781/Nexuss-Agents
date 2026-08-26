import type { AcceptanceCriterion } from "./constitution";
import type { MissionEvidence, MissionVerification } from "./store";

const independenceRank: Record<MissionVerification["independenceMode"], number> = { self_check: 0, fresh_context: 1, blind_review: 2, separate_agent: 3, separate_model: 4, runtime_reproduction: 5 };

export type EvidenceEvaluation = {
  satisfied: boolean;
  missingEvidenceKinds: string[];
  unsatisfiedCriteria: string[];
  passingVerifications: string[];
  reason: string;
};

export function evaluateEvidenceRequirements(input: { requiredEvidenceKinds: readonly string[]; evidence: readonly MissionEvidence[]; requiredMinimumStrength?: MissionEvidence["strength"] }): EvidenceEvaluation {
  const available = new Set(input.evidence.map((item) => item.kind));
  const missingEvidenceKinds = input.requiredEvidenceKinds.filter((kind) => !available.has(kind));
  const strengthRank: Record<MissionEvidence["strength"], number> = { weak: 0, moderate: 1, strong: 2, conclusive: 3 };
  const minimum = input.requiredMinimumStrength ? strengthRank[input.requiredMinimumStrength] : 0;
  const hasWeakEvidence = input.evidence.some((item) => strengthRank[item.strength] < minimum);
  const satisfied = missingEvidenceKinds.length === 0 && !hasWeakEvidence;
  return { satisfied, missingEvidenceKinds, unsatisfiedCriteria: [], passingVerifications: [], reason: satisfied ? "Required evidence is present at the required strength" : hasWeakEvidence ? "Evidence strength is below the required threshold" : `Missing evidence kinds: ${missingEvidenceKinds.join(", ")}` };
}

export function evaluateVerificationReadiness(input: { requiredMinimumIndependence: MissionVerification["independenceMode"]; verifications: readonly MissionVerification[]; requiredCount?: number }) {
  const required = independenceRank[input.requiredMinimumIndependence];
  const passing = input.verifications.filter((verification) => verification.status === "passed" && independenceRank[verification.independenceMode] >= required && verification.evidenceRefs.length > 0);
  const requiredCount = input.requiredCount || 1;
  return { ready: passing.length >= requiredCount, passingVerifications: passing.map((verification) => verification.id), reason: passing.length >= requiredCount ? "Required independent verification is present" : `Requires ${requiredCount} passing verification record(s) at independence ${input.requiredMinimumIndependence}` };
}

export function evaluateAcceptance(input: { criteria: readonly AcceptanceCriterion[]; evidence: readonly MissionEvidence[]; verifications: readonly MissionVerification[] }): EvidenceEvaluation {
  const verification = evaluateVerificationReadiness({ requiredMinimumIndependence: "separate_agent", verifications: input.verifications });
  const evidence = evaluateEvidenceRequirements({ requiredEvidenceKinds: input.criteria.filter((criterion) => criterion.required).map((criterion) => criterion.id), evidence: input.evidence });
  const availableKinds = new Set(input.evidence.map((item) => item.kind));
  const unsatisfiedCriteria = input.criteria.filter((criterion) => criterion.required && !availableKinds.has(criterion.id) && !verification.ready).map((criterion) => criterion.id);
  const satisfied = unsatisfiedCriteria.length === 0 && (input.criteria.length === 0 || evidence.satisfied || verification.ready);
  return { satisfied, missingEvidenceKinds: evidence.missingEvidenceKinds, unsatisfiedCriteria, passingVerifications: verification.passingVerifications, reason: satisfied ? "Required acceptance criteria have evidence or independent verification" : `Unsatisfied acceptance criteria: ${unsatisfiedCriteria.join(", ") || evidence.reason}` };
}

export function completionEvidenceDecision(input: { role: string; verified: boolean; evidenceIds: readonly string[]; verificationIds: readonly string[]; verifications: readonly { status: string; evidenceRefs?: readonly string[]; independenceMode: string }[] }) {
  if (!input.verified) return { allowed: true, reason: "Work item is not claiming completion" };
  if (input.role !== "quality") return { allowed: true, reason: "Role-specific independent verification is evaluated by the quality gate" };
  const passed = input.verifications.some((verification) => verification.status === "passed" && verification.independenceMode !== "self_check" && ((verification.evidenceRefs?.length || 0) > 0 || input.evidenceIds.length > 0) && input.verificationIds.length > 0);
  return passed ? { allowed: true, reason: "Quality completion has independent evidence-backed verification" } : { allowed: false, reason: "Quality completion requires a passed independent verification with evidence" };
}

export function provenanceForArtifact(input: { source: string; contentHash?: string; skillId?: string; skillVersion?: string }) {
  return { source: input.source, ...(input.contentHash ? { contentHash: input.contentHash } : {}), ...(input.skillId ? { skillId: input.skillId } : {}), ...(input.skillVersion ? { skillVersion: input.skillVersion } : {}) };
}
