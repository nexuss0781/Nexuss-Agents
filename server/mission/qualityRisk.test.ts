import { describe, expect, it } from "vitest";
import { decideMissionQuality, RISK_QUALITY_PROFILES } from "./qualityPolicy";

describe("Phase 11 risk-based quality gates", () => {
  it("defines progressively stronger quality profiles", () => {
    expect(RISK_QUALITY_PROFILES.low.requiredVerificationCount).toBe(0);
    expect(RISK_QUALITY_PROFILES.medium.minimumIndependence).toBe("blind_review");
    expect(RISK_QUALITY_PROFILES.high.requiredVerificationCount).toBe(2);
    expect(RISK_QUALITY_PROFILES.critical.minimumIndependence).toBe("separate_model");
  });

  it("requires quality evidence and independent verification for medium risk", () => {
    expect(decideMissionQuality({ riskLevel: "medium", evidence: [], verifications: [] })).toMatchObject({ allowed: false, missingEvidenceKinds: ["quality_check"], passingVerificationCount: 0 });
    expect(decideMissionQuality({ riskLevel: "medium", evidence: [{ kind: "quality_check" }], verifications: [{ status: "passed", independenceMode: "blind_review", evidenceRefs: ["evidence-1"] }] }).allowed).toBe(true);
  });

  it("requires security evidence and two separate-agent verifications for high risk", () => {
    const input = { riskLevel: "high" as const, evidence: [{ kind: "quality_check" }], verifications: [{ status: "passed", independenceMode: "separate_agent" as const, evidenceRefs: ["quality-1"] }, { status: "passed", independenceMode: "separate_agent" as const, evidenceRefs: ["quality-2"] }] };
    expect(decideMissionQuality(input)).toMatchObject({ allowed: false, missingEvidenceKinds: ["security_review"] });
    expect(decideMissionQuality({ ...input, evidence: [{ kind: "quality_check" }, { kind: "security_review" }] }).allowed).toBe(true);
  });

  it("requires a separate model for critical risk", () => {
    expect(decideMissionQuality({ riskLevel: "critical", evidence: [{ kind: "quality_check" }, { kind: "security_review" }], verifications: [{ status: "passed", independenceMode: "separate_agent", evidenceRefs: ["a"] }, { status: "passed", independenceMode: "separate_agent", evidenceRefs: ["b"] }, { status: "passed", independenceMode: "separate_agent", evidenceRefs: ["c"] }] })).toMatchObject({ allowed: false, passingVerificationCount: 0 });
    expect(decideMissionQuality({ riskLevel: "critical", evidence: [{ kind: "quality_check" }, { kind: "security_review" }], verifications: [{ status: "passed", independenceMode: "separate_model", evidenceRefs: ["a"] }, { status: "passed", independenceMode: "separate_model", evidenceRefs: ["b"] }, { status: "passed", independenceMode: "separate_model", evidenceRefs: ["c"] }] }).allowed).toBe(true);
  });
});
