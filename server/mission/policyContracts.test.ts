import { describe, expect, it } from "vitest";
import { assertAuthority, decideAuthority } from "./authorityPolicy";
import { assertBudget, consumeBudget, emptyBudgetUsage, decideRetry } from "./budgetPolicy";
import { decideConcurrency, dependenciesReady, detectStrategyLoop, strategyFingerprint } from "./concurrencyPolicy";
import { decideQualityGate } from "./qualityPolicy";
import type { MissionBudget, WorkItem } from "./workflowTypes";

const budget: MissionBudget = {
  maxDurationSeconds: 1_800,
  maxModelTokens: 120_000,
  maxToolCalls: 120,
  maxAgentAttempts: 3,
  maxChildWorkItems: 32,
  maxDepth: 3,
  maxParallelWorkItems: 2,
};

function workItem(id: string, status: WorkItem["status"] = "ready"): WorkItem {
  return {
    id,
    missionId: "mission-1",
    stage: "execute",
    objective: "Complete bounded work",
    description: "Complete bounded work",
    role: "repository_builder",
    status,
    inputRefs: ["input-1"],
    acceptanceCriteria: [],
    dependencies: [],
    allowedSkills: [],
    allowedHarnesses: ["filesystem"],
    budget,
    attempt: 0,
    outputRefs: [],
    failureRefs: [],
    version: 1,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
}

describe("Phase 4 workflow policies", () => {
  it("allows execution writes and requires confirmation for destructive actions", () => {
    expect(decideAuthority({ authority: "execution_only", action: "write" }).allowed).toBe(true);
    expect(decideAuthority({ authority: "execution_only", action: "delete" }).allowed).toBe(false);
    expect(assertAuthority({ authority: "mission_owner", action: "delete", confirmed: true }).requiresAudit).toBe(true);
  });

  it("enforces budget limits and returns updated usage", () => {
    const usage = consumeBudget(emptyBudgetUsage(), "toolCalls", 2);
    expect(assertBudget({ budget, usage, resource: "toolCalls", amount: 1 }).remaining).toBe(118);
    expect(() => assertBudget({ budget, usage: { ...usage, toolCalls: 120 }, resource: "toolCalls" })).toThrow(/budget denied/);
  });

  it("requires a changed strategy and keeps retries within the attempt budget", () => {
    expect(decideRetry({ budget, currentAttempt: 1, failureClassification: "repairable", previousStrategyFingerprint: "same", nextStrategyFingerprint: "same", changedCondition: "" }).allowed).toBe(false);
    expect(decideRetry({ budget, currentAttempt: 1, failureClassification: "repairable", previousStrategyFingerprint: "old", nextStrategyFingerprint: "new", changedCondition: "A dependency was corrected" }).allowed).toBe(true);
    expect(decideRetry({ budget, currentAttempt: 3, failureClassification: "retryable", nextStrategyFingerprint: "new", changedCondition: "Transient provider recovered" }).allowed).toBe(false);
  });

  it("checks dependency and parallel-work readiness", () => {
    const dependency = workItem("dependency", "running");
    const candidate = { ...workItem("candidate"), dependencies: ["dependency"] };
    expect(dependenciesReady(candidate, [dependency, candidate]).ready).toBe(false);
    expect(dependenciesReady(candidate, [{ ...dependency, status: "completed" }, candidate]).ready).toBe(true);
    expect(decideConcurrency({ candidate, active: [workItem("active-1", "running"), workItem("active-2", "running")], maxParallelWorkItems: 2, exclusiveWorkspace: false }).allowed).toBe(false);
  });

  it("detects repeated strategies and maps risk to reviewer independence", () => {
    const fingerprint = strategyFingerprint({ stage: "execute", objective: "Write the file", action: "write", parameters: { path: "src/a.ts" } });
    expect(detectStrategyLoop({ attempts: [{ attempt: 1, strategyFingerprint: fingerprint, changedCondition: "first", newInformation: [], verificationMethod: "diff", createdAt: "2026-08-27T00:00:00.000Z" }], nextStrategyFingerprint: fingerprint }).allowed).toBe(false);
    expect(decideQualityGate({ riskLevel: "high", decision: "accepted", independenceMode: "fresh_context", requiredVerificationCount: 1, passingVerificationCount: 1 }).allowed).toBe(false);
    expect(decideQualityGate({ riskLevel: "high", decision: "accepted", independenceMode: "separate_agent", requiredVerificationCount: 1, passingVerificationCount: 1 }).allowed).toBe(true);
  });
});
