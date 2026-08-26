import { describe, expect, it } from "vitest";
import { completionEvidenceDecision, evaluateAcceptance, evaluateEvidenceRequirements, evaluateVerificationReadiness } from "./evidenceRuntime";
import type { MissionEvidence, MissionVerification } from "./store";

const evidence = (kind: string, strength: MissionEvidence["strength"] = "strong"): MissionEvidence => ({ id: `evidence-${kind}`, missionId: "mission-1", ownerId: "owner-1", kind, summary: `${kind} evidence`, strength, provenance: [{ kind: "test", ref: kind }], data: {}, producedBy: "agent-1", observedAt: "2026-08-27T00:00:00.000Z", createdAt: "2026-08-27T00:00:00.000Z" });
const verification = (status: MissionVerification["status"] = "passed"): MissionVerification => ({ id: "verification-1", missionId: "mission-1", ownerId: "owner-1", subjectRefs: ["artifact-1"], method: "independent test", independenceMode: "separate_agent", status, observations: ["check passed"], failedChecks: [], evidenceRefs: ["evidence-quality"], performedBy: "quality-gate", startedAt: "2026-08-27T00:00:00.000Z", completedAt: "2026-08-27T00:01:00.000Z" });

describe("Phase 9 evidence and verification runtime", () => {
  it("requires evidence kinds and minimum strength", () => {
    expect(evaluateEvidenceRequirements({ requiredEvidenceKinds: ["diff", "test"], evidence: [evidence("diff"), evidence("test", "moderate")], requiredMinimumStrength: "strong" })).toMatchObject({ satisfied: false, missingEvidenceKinds: [] });
    expect(evaluateEvidenceRequirements({ requiredEvidenceKinds: ["diff"], evidence: [evidence("diff")], requiredMinimumStrength: "strong" }).satisfied).toBe(true);
  });

  it("requires independent passing verification at the configured threshold", () => {
    expect(evaluateVerificationReadiness({ requiredMinimumIndependence: "separate_agent", verifications: [verification("passed")], requiredCount: 1 })).toMatchObject({ ready: true, passingVerifications: ["verification-1"] });
    expect(evaluateVerificationReadiness({ requiredMinimumIndependence: "separate_agent", verifications: [verification("failed")], requiredCount: 1 }).ready).toBe(false);
  });

  it("evaluates acceptance through evidence or verification", () => {
    expect(evaluateAcceptance({ criteria: [{ id: "criterion-1", description: "The result is checked", verification: "automated", required: true }], evidence: [evidence("criterion-1")], verifications: [] }).satisfied).toBe(true);
    expect(evaluateAcceptance({ criteria: [{ id: "criterion-1", description: "The result is checked", verification: "automated", required: true }], evidence: [], verifications: [verification()] }).satisfied).toBe(true);
  });

  it("requires quality completion to carry independent evidence-backed verification", () => {
    expect(completionEvidenceDecision({ role: "quality", verified: true, evidenceIds: [], verificationIds: [], verifications: [] })).toMatchObject({ allowed: false });
    expect(completionEvidenceDecision({ role: "quality", verified: true, evidenceIds: ["evidence-1"], verificationIds: ["verification-1"], verifications: [{ status: "passed", independenceMode: "runtime_reproduction", evidenceRefs: [] }] })).toMatchObject({ allowed: true });
    expect(completionEvidenceDecision({ role: "builder", verified: true, evidenceIds: [], verificationIds: [], verifications: [] })).toMatchObject({ allowed: true });
  });
});
