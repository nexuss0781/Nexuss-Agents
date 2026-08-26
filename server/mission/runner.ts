import { randomUUID } from "node:crypto";
import {
  claimWorkItem,
  getMission,
  releaseWorkItemLease,
  transitionMission,
  updateWorkItem,
  heartbeatWorkItemLease,
  saveMissionCheckpoint,
  type MissionSnapshot,
  type MissionWorkItem,
} from "./store";
import type { MissionStatus } from "./constitution";
import { extractMissionLearningCandidates } from "./learning";
import { dispatchFilesystemHarness } from "./filesystemHarness";
import type { HarnessRequest, HarnessResult } from "./harnessRegistry";
import { assertBudget, consumeBudget, type BudgetUsage } from "./budgetPolicy";
import { assertConcurrency } from "./concurrencyPolicy";
import { actionForWorkItem, assertWorkItemAuthority, authorityForRole, retryForResult, runnerBudget, runnerUsage } from "./runnerPolicy";
import { assertSkillBindings, readSkillBindings } from "./skillRuntime";
import { createWorkItem, listMissionEvidence, listMissionVerifications, recordMissionEvidence, recordMissionVerification } from "./store";
import { completionEvidenceDecision, evaluateAcceptance } from "./evidenceRuntime";
import { decideMissionQuality } from "./qualityPolicy";
import { buildReplanRequest, diagnoseFailure, planRepair, type FailureDiagnosis, type ReplanRequest } from "./repairRuntime";

export type MissionExecutionContext = {
  ownerId: string;
  workerId: string;
  mission: MissionSnapshot;
  signal: AbortSignal;
  activeWorkItem?: MissionWorkItem;
  authority?: import("./agentContracts").AgentAuthority;
  action?: import("./authorityPolicy").WorkflowAction;
  domainSkillBindings?: import("./skillTypes").SkillBinding[];
  filesystem: (request: HarnessRequest, contract: import("./agentContracts").AgentRoleContract, agentId?: string) => Promise<HarnessResult>;
};

export type MissionExecutionEvidence = {
  kind: string;
  summary: string;
  strength: "weak" | "moderate" | "strong" | "conclusive";
  provenance: Array<{ kind: string; ref: string; label?: string }>;
  data?: Record<string, unknown>;
  artifactId?: string;
};

export type MissionExecutionVerification = {
  subjectRefs: string[];
  method: string;
  independenceMode: "self_check" | "fresh_context" | "blind_review" | "separate_agent" | "separate_model" | "runtime_reproduction";
  status: import("./workflowTypes").VerificationStatus;
  observations?: string[];
  failedChecks?: string[];
  evidenceRefs?: string[];
  performedBy: string;
};

export type MissionExecutionResult = {
  verified: boolean;
  continueMission?: boolean;
  summary: string;
  failureClass?: string;
  nextAction?: string;
  artifactIds?: string[];
  strategyFingerprint?: string;
  changedCondition?: string;
  budgetUsage?: Partial<BudgetUsage>;
  evidence?: MissionExecutionEvidence[];
  verifications?: MissionExecutionVerification[];
  diagnosis?: FailureDiagnosis;
  replanRequest?: ReplanRequest;
  newInformation?: string[];
};

export type MissionExecutor = (context: MissionExecutionContext) => Promise<MissionExecutionResult>;
export type MissionOrchestrator = (ownerId: string, missionId: string, signal: AbortSignal) => Promise<{ workItems: unknown[]; summary: string }>;

export class MissionRunnerError extends Error {
  readonly code: string;

  constructor(message: string, code = "MISSION_RUNNER_ERROR") {
    super(message);
    this.name = "MissionRunnerError";
    this.code = code;
  }
}

function assertRunnerBudget(input: Parameters<typeof assertBudget>[0]) {
  try {
    return assertBudget(input);
  } catch (error) {
    throw new MissionRunnerError(error instanceof Error ? error.message : String(error), "MISSION_BUDGET_DENIED");
  }
}

function assertRunnerConcurrency(input: Parameters<typeof assertConcurrency>[0]) {
  try {
    return assertConcurrency(input);
  } catch (error) {
    throw new MissionRunnerError(error instanceof Error ? error.message : String(error), "MISSION_CONCURRENCY_DENIED");
  }
}

function runnable(status: MissionStatus) {
  return status === "queued" || status === "planning" || status === "planned" || status === "executing" || status === "repairing";
}

function claimable(item: MissionWorkItem, workItems: MissionWorkItem[]) {
  if (!["pending", "ready", "repairing"].includes(item.status)) return false;
  return item.dependencies.every((dependencyId) => workItems.some((dependency) => dependency.id === dependencyId && dependency.status === "completed"));
}

class ServerMissionRunner {
  private executor: MissionExecutor | undefined;
  private orchestrator: MissionOrchestrator | undefined;
  private readonly active = new Map<string, { ownerId: string; controller: AbortController; promise: Promise<void> }>();

  configureExecutor(executor: MissionExecutor | undefined) {
    this.executor = executor;
  }

  configureOrchestrator(orchestrator: MissionOrchestrator | undefined) {
    this.orchestrator = orchestrator;
  }

  isRunning(missionId: string) {
    return this.active.has(missionId);
  }

  start(ownerId: string, missionId: string): Promise<void> {
    const existing = this.active.get(missionId);
    if (existing) {
      if (existing.ownerId !== ownerId) return Promise.reject(new MissionRunnerError("Mission runner ownership conflict", "MISSION_RUNNER_OWNERSHIP_CONFLICT"));
      return existing.promise;
    }
    const controller = new AbortController();
    const promise = this.run(ownerId, missionId, controller).finally(() => {
      const current = this.active.get(missionId);
      if (current?.controller === controller) this.active.delete(missionId);
    });
    this.active.set(missionId, { ownerId, controller, promise });
    return promise;
  }

  cancel(ownerId: string, missionId: string) {
    const active = this.active.get(missionId);
    if (!active) return false;
    if (active.ownerId !== ownerId) throw new MissionRunnerError("Mission runner ownership conflict", "MISSION_RUNNER_OWNERSHIP_CONFLICT");
    active.controller.abort();
    return true;
  }

  private async run(ownerId: string, missionId: string, controller: AbortController) {
    const workerId = `runner-${randomUUID()}`;
    let snapshot = await getMission(ownerId, missionId);
    if (!runnable(snapshot.mission.status)) return;
    try {
      if (snapshot.mission.status === "queued") {
        snapshot = { ...snapshot, mission: await transitionMission(ownerId, missionId, "queued", "planning", snapshot.mission.version, workerId, { workerId }) };
      }
      if (controller.signal.aborted) return;
      if (snapshot.mission.status === "planning") {
        const needsPlan = snapshot.workItems.length === 0;
        const budget = runnerBudget(snapshot.mission.budget);
        const usage = runnerUsage(snapshot.latestCheckpoint?.state?.budgetUsage);
        if (needsPlan && this.orchestrator) {
          assertRunnerBudget({ budget, usage, resource: "childWorkItems", amount: 1 });
          const planResult = await this.orchestrator(ownerId, missionId, controller.signal);
          const plannedCount = Array.isArray(planResult.workItems) ? planResult.workItems.length : 0;
          if (plannedCount > budget.maxChildWorkItems) throw new MissionRunnerError("Planned work exceeds the mission child-work-item budget", "MISSION_CHILD_WORK_BUDGET_EXCEEDED");
        }
        snapshot = { ...snapshot, mission: await transitionMission(ownerId, missionId, "planning", "planned", snapshot.mission.version, workerId, { workerId, orchestrated: Boolean(needsPlan && this.orchestrator), reusedWorkGraph: !needsPlan }) };
      }
      if (controller.signal.aborted) return;
      if (snapshot.mission.status === "planned" || snapshot.mission.status === "repairing") {
        const from = snapshot.mission.status;
        snapshot = { ...snapshot, mission: await transitionMission(ownerId, missionId, from, "executing", snapshot.mission.version, workerId, { workerId }) };
      }
      if (controller.signal.aborted || snapshot.mission.status === "verifying") return;
      if (!this.executor) throw new MissionRunnerError("No mission executor has been configured", "MISSION_EXECUTOR_NOT_CONFIGURED");

      while (!controller.signal.aborted) {
        const executionSnapshot = await getMission(ownerId, missionId);
        const budget = runnerBudget(executionSnapshot.mission.budget);
        const usage = runnerUsage(executionSnapshot.latestCheckpoint?.state?.budgetUsage);
        const startedAt = executionSnapshot.mission.startedAt ? Date.parse(executionSnapshot.mission.startedAt) : Number.NaN;
        const elapsedSeconds = Number.isFinite(startedAt) ? Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)) : 0;
        if (elapsedSeconds > budget.maxDurationSeconds) throw new MissionRunnerError(`Mission duration budget exceeded: ${elapsedSeconds} > ${budget.maxDurationSeconds} seconds`, "MISSION_DURATION_BUDGET_EXCEEDED");
        const nextWorkItem = executionSnapshot.workItems.find((item) => claimable(item, executionSnapshot.workItems));
        if (nextWorkItem) {
          const authorityDecision = assertWorkItemAuthority(nextWorkItem);
          if (!authorityDecision.allowed) throw new MissionRunnerError(`Work-item authority denied: ${authorityDecision.reason}`, "MISSION_AUTHORITY_DENIED");
          const skillBindings = readSkillBindings(nextWorkItem.input.skillBindings);
          if (skillBindings.length) {
            try {
              await assertSkillBindings({ bindings: skillBindings, role: nextWorkItem.role, stage: "execute", action: actionForWorkItem(nextWorkItem) });
            } catch (error) {
              throw new MissionRunnerError(error instanceof Error ? error.message : String(error), "MISSION_SKILL_BINDING_DENIED");
            }
          }
          assertRunnerConcurrency({ candidate: nextWorkItem, active: executionSnapshot.workItems.filter((item) => item.id !== nextWorkItem.id), maxParallelWorkItems: budget.maxParallelWorkItems, exclusiveWorkspace: true });
        }
        assertRunnerBudget({ budget, usage, resource: "agentAttempts" });
        assertRunnerBudget({ budget, usage, resource: "toolCalls" });
        let claimedWorkItem: { workItem: MissionWorkItem; lease: { workItemId: string; workerId: string } } | undefined;
        let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
        try {
          if (nextWorkItem) {
            const claimed = await claimWorkItem(ownerId, nextWorkItem.id, workerId, nextWorkItem.version);
            claimedWorkItem = { workItem: claimed.workItem, lease: { workItemId: claimed.lease.workItemId, workerId: claimed.lease.workerId } };
            heartbeatTimer = setInterval(() => {
              void heartbeatWorkItemLease(ownerId, claimed.lease.workItemId, workerId).catch((error) => {
                console.error("[MissionRunner] work-item lease heartbeat failed", { missionId, workItemId: claimed.lease.workItemId, error: error instanceof Error ? error.message : String(error) });
                controller.abort();
              });
            }, 10_000);
            heartbeatTimer.unref?.();
          }

          const reservedUsage = consumeBudget(consumeBudget(usage, "agentAttempts"), "toolCalls");
          await saveMissionCheckpoint(ownerId, missionId, {
            version: executionSnapshot.mission.version,
            status: executionSnapshot.mission.status,
            state: {
              ...(executionSnapshot.latestCheckpoint?.state || {}),
              budgetUsage: reservedUsage,
              lastExecution: { workerId, ...(claimedWorkItem ? { workItemId: claimedWorkItem.workItem.id, attempt: claimedWorkItem.workItem.attempt } : {}), status: "reserved" },
            },
            nextAction: "execute reserved work item",
          });

          const result = await this.executor({ ownerId, workerId, mission: executionSnapshot, signal: controller.signal, activeWorkItem: claimedWorkItem?.workItem, ...(claimedWorkItem ? { authority: authorityForRole(claimedWorkItem.workItem.role), action: actionForWorkItem(claimedWorkItem.workItem), domainSkillBindings: readSkillBindings(claimedWorkItem.workItem.input.skillBindings) } : {}), filesystem: (request, contract, agentId = workerId) => {
            const projectId = executionSnapshot.mission.projectId;
            if (!projectId) return Promise.reject(new MissionRunnerError("Filesystem operations require a project-bound mission", "MISSION_PROJECT_REQUIRED"));
            return dispatchFilesystemHarness({ ownerId, projectId, contract, request, missionId, agentId });
          } });
          if (controller.signal.aborted) return;
          const evidenceIds: string[] = [];
          if (claimedWorkItem && result.evidence?.length) {
            for (const evidence of result.evidence) {
              const persisted = await recordMissionEvidence(ownerId, missionId, { workItemId: claimedWorkItem.workItem.id, artifactId: evidence.artifactId, kind: evidence.kind, summary: evidence.summary, strength: evidence.strength, provenance: evidence.provenance, data: evidence.data, producedBy: workerId });
              evidenceIds.push(persisted.id);
            }
          }
          const verificationIds: string[] = [];
          if (claimedWorkItem && result.verifications?.length) {
            for (const verification of result.verifications) {
              const persisted = await recordMissionVerification(ownerId, missionId, { workItemId: claimedWorkItem.workItem.id, subjectRefs: verification.subjectRefs, method: verification.method, independenceMode: verification.independenceMode, status: verification.status, observations: verification.observations, failedChecks: verification.failedChecks, evidenceRefs: Array.from(new Set([...(verification.evidenceRefs || []), ...evidenceIds])), performedBy: verification.performedBy });
              verificationIds.push(persisted.id);
            }
          }
          const diagnosis = claimedWorkItem && !result.verified ? result.diagnosis || diagnoseFailure({ failureClass: result.failureClass, summary: result.summary, nextAction: result.nextAction, evidenceRefs: evidenceIds, changedCondition: result.changedCondition, newInformation: result.newInformation }) : undefined;
          const repairPlan = claimedWorkItem && diagnosis ? planRepair({ item: claimedWorkItem.workItem, diagnosis, strategyFingerprint: result.strategyFingerprint, nextAction: result.nextAction }) : undefined;
          let replannedWorkItemId: string | undefined;
          const replanRequest = claimedWorkItem && repairPlan?.replanRequired ? buildReplanRequest({ missionId, item: claimedWorkItem.workItem, diagnosis: repairPlan.diagnosis, completedWorkItemIds: executionSnapshot.workItems.filter((item) => item.status === "completed").map((item) => item.id) }) : undefined;
          if (claimedWorkItem && repairPlan?.replanRequired && replanRequest) {
            const replacement = await createWorkItem(ownerId, missionId, { parentWorkItemId: claimedWorkItem.workItem.id, title: `Repair: ${claimedWorkItem.workItem.title}`, description: repairPlan.nextAction, role: claimedWorkItem.workItem.role, dependencies: claimedWorkItem.workItem.dependencies.filter((dependencyId) => executionSnapshot.workItems.some((item) => item.id === dependencyId && item.status === "completed")), acceptanceCriteria: claimedWorkItem.workItem.acceptanceCriteria, input: { ...claimedWorkItem.workItem.input, repairOf: claimedWorkItem.workItem.id, replanRequest, repair: { failureClass: repairPlan.diagnosis.failureClass, changedCondition: repairPlan.changedCondition, strategyFingerprint: repairPlan.strategyFingerprint, evidenceRefs: evidenceIds } } });
            replannedWorkItemId = replacement.id;
          }
          const completionDecision = claimedWorkItem ? completionEvidenceDecision({ role: claimedWorkItem.workItem.role, verified: result.verified, evidenceIds, verificationIds, verifications: result.verifications || [] }) : { allowed: true, reason: "No work item completion claim" };
          if (!completionDecision.allowed) throw new MissionRunnerError(`Mission evidence denied: ${completionDecision.reason}`, "MISSION_EVIDENCE_INCOMPLETE");
          const reportedModelTokens = Math.max(0, Number(result.budgetUsage?.modelTokens || 0));
          const reportedToolCalls = Math.max(0, Number(result.budgetUsage?.toolCalls || 0));
          assertRunnerBudget({ budget, usage: reservedUsage, resource: "modelTokens", amount: reportedModelTokens });
          assertRunnerBudget({ budget, usage: reservedUsage, resource: "toolCalls", amount: reportedToolCalls });
          const withReportedModelTokens = consumeBudget(reservedUsage, "modelTokens", reportedModelTokens);
          const nextUsage = {
            ...consumeBudget(withReportedModelTokens, "toolCalls", reportedToolCalls),
            durationSeconds: elapsedSeconds,
          };
          const retryDecision = claimedWorkItem && !result.verified ? retryForResult({
            budget,
            item: claimedWorkItem.workItem,
            failureClass: result.failureClass,
            nextAction: result.nextAction,
            changedCondition: result.changedCondition,
            strategyFingerprint: result.strategyFingerprint,
            previousStrategyFingerprint: typeof claimedWorkItem.workItem.output?.strategyFingerprint === "string" ? claimedWorkItem.workItem.output.strategyFingerprint : undefined,
          }) : undefined;
          if (claimedWorkItem) {
            const effectiveRetryAllowed = Boolean(retryDecision?.allowed && !repairPlan?.replanRequired);
            const workItemOutput = {
              summary: result.summary,
              artifactIds: result.artifactIds || [],
              ...(evidenceIds.length ? { evidenceIds } : {}),
              ...(verificationIds.length ? { verificationIds } : {}),
              ...(result.failureClass ? { failureClass: result.failureClass } : {}),
              ...(result.strategyFingerprint || retryDecision ? { strategyFingerprint: result.strategyFingerprint || retryDecision?.nextStrategyFingerprint } : {}),
              ...(result.changedCondition || retryDecision ? { changedCondition: result.changedCondition || retryDecision?.changedCondition } : {}),
              ...(retryDecision ? { retryClassification: retryDecision.classification, retryAllowed: effectiveRetryAllowed, retryReason: repairPlan?.replanRequired ? "Re-plan required; replacement work item created" : retryDecision.reason } : {}),
              ...(diagnosis ? { diagnosis } : {}),
              ...(repairPlan ? { repairPlan: { disposition: repairPlan.disposition, nextAction: repairPlan.nextAction, replanRequired: repairPlan.replanRequired } } : {}),
              ...(replannedWorkItemId ? { replannedWorkItemId } : {}),
              ...(replanRequest ? { replanRequest } : {}),
            };
            claimedWorkItem.workItem = await updateWorkItem(ownerId, claimedWorkItem.workItem.id, {
              status: result.verified ? "completed" : repairPlan?.replanRequired ? "cancelled" : retryDecision?.allowed ? "repairing" : "failed",
              output: workItemOutput,
              expectedVersion: claimedWorkItem.workItem.version,
            });
          }

          const latest = await getMission(ownerId, missionId);
          await saveMissionCheckpoint(ownerId, missionId, {
            version: latest.mission.version,
            status: latest.mission.status,
            state: {
              ...(latest.latestCheckpoint?.state || {}),
              budgetUsage: nextUsage,
              lastExecution: {
                workerId,
                ...(claimedWorkItem ? { workItemId: claimedWorkItem.workItem.id, attempt: claimedWorkItem.workItem.attempt } : {}),
                verified: result.verified,
                ...(retryDecision ? { retryAllowed: retryDecision.allowed, retryReason: retryDecision.reason, strategyFingerprint: retryDecision.nextStrategyFingerprint } : {}),
                evidenceDecision: completionDecision,
              },
            },
            nextAction: result.verified ? "continue execution" : retryDecision?.allowed ? "execute changed repair strategy" : "escalate failed work item",
          });
          const unresolved = latest.workItems.filter((item) => !["completed", "cancelled"].includes(item.status));
          if (result.continueMission) {
            if (latest.workItems.length <= executionSnapshot.workItems.length) throw new MissionRunnerError("Executor reported progress without creating new work", "MISSION_EXECUTOR_NO_PROGRESS");
            continue;
          }
          if (!result.verified) {
            const verifying = await transitionMission(ownerId, missionId, "executing", "verifying", latest.mission.version, workerId, { summary: result.summary, artifactIds: result.artifactIds || [], ...(retryDecision ? { retryAllowed: retryDecision.allowed, retryReason: retryDecision.reason, strategyFingerprint: retryDecision.nextStrategyFingerprint } : {}) });
            if (repairPlan?.replanRequired && replannedWorkItemId) {
              await transitionMission(ownerId, missionId, "verifying", "repairing", verifying.version, workerId, { failureClass: result.failureClass || "REPLAN_REQUIRED", summary: result.summary, nextAction: repairPlan.nextAction, strategyFingerprint: repairPlan.strategyFingerprint, changedCondition: repairPlan.changedCondition, replannedWorkItemId, diagnosis, replanRequest });
            } else if (retryDecision?.allowed) {
              await transitionMission(ownerId, missionId, "verifying", "repairing", verifying.version, workerId, { failureClass: result.failureClass || "QUALITY_GATE_FAILED", summary: result.summary, nextAction: result.nextAction || "execute changed repair strategy", strategyFingerprint: retryDecision.nextStrategyFingerprint, changedCondition: retryDecision.changedCondition, ...(diagnosis ? { diagnosis } : {}) });
            } else {
              await transitionMission(ownerId, missionId, "verifying", "failed", verifying.version, workerId, { code: "RETRY_POLICY_DENIED", failureClass: result.failureClass || "QUALITY_GATE_FAILED", summary: result.summary, reason: retryDecision?.reason || "No retry decision was available" });
            }
            return;
          }
          if (unresolved.length === 0) {
            const [missionEvidence, missionVerifications] = await Promise.all([listMissionEvidence(ownerId, missionId), listMissionVerifications(ownerId, missionId)]);
            const acceptance = evaluateAcceptance({ criteria: executionSnapshot.mission.contract.acceptanceCriteria || [], evidence: missionEvidence, verifications: missionVerifications });
            const quality = decideMissionQuality({ riskLevel: executionSnapshot.mission.contract.riskLevel || "low", evidence: missionEvidence, verifications: missionVerifications, completedWorkItemRoles: latest.workItems.filter((item) => item.status === "completed").map((item) => item.role) });
            const verifying = await transitionMission(ownerId, missionId, "executing", "verifying", latest.mission.version, workerId, { summary: result.summary, artifactIds: result.artifactIds || [], acceptance, quality });
            if (!acceptance.satisfied) {
              await transitionMission(ownerId, missionId, "verifying", "failed", verifying.version, workerId, { code: "MISSION_ACCEPTANCE_INCOMPLETE", summary: acceptance.reason, missingEvidenceKinds: acceptance.missingEvidenceKinds, unsatisfiedCriteria: acceptance.unsatisfiedCriteria, quality });
              return;
            }
            if (!quality.allowed) {
              await transitionMission(ownerId, missionId, "verifying", "failed", verifying.version, workerId, { code: "MISSION_QUALITY_GATE_INCOMPLETE", summary: quality.reason, missingEvidenceKinds: quality.missingEvidenceKinds, passingVerificationCount: quality.passingVerificationCount, quality });
              return;
            }
            await transitionMission(ownerId, missionId, "verifying", "completed", verifying.version, workerId, { summary: result.summary, artifactIds: result.artifactIds || [], acceptance, quality });
            await extractMissionLearningCandidates(ownerId, missionId).catch((error) => console.error("[MissionRunner] learning candidate extraction failed", { missionId, error: error instanceof Error ? error.message : String(error) }));
            return;
          }
          if (unresolved.some((item) => item.status === "failed")) {
            const verifying = await transitionMission(ownerId, missionId, "executing", "verifying", latest.mission.version, workerId, { summary: result.summary, artifactIds: result.artifactIds || [] });
            await transitionMission(ownerId, missionId, "verifying", "repairing", verifying.version, workerId, { failureClass: "WORK_GRAPH_HAS_FAILED_ITEMS", summary: "A required work item failed", nextAction: "repair failed work item", changedCondition: "The work graph contains a failed item" });
            return;
          }
          if (!unresolved.some((item) => claimable(item, latest.workItems))) {
            const verifying = await transitionMission(ownerId, missionId, "executing", "verifying", latest.mission.version, workerId, { summary: result.summary, artifactIds: result.artifactIds || [] });
            await transitionMission(ownerId, missionId, "verifying", "failed", verifying.version, workerId, { code: "WORK_GRAPH_BLOCKED", summary: "No remaining work item is executable" });
            return;
          }
        } catch (error) {
          if (controller.signal.aborted) {
            if (claimedWorkItem && !["completed", "failed", "cancelled"].includes(claimedWorkItem.workItem.status)) await updateWorkItem(ownerId, claimedWorkItem.workItem.id, { status: "cancelled", output: { summary: "Execution cancelled" }, expectedVersion: claimedWorkItem.workItem.version }).catch((cleanupError) => console.error("[MissionRunner] failed to mark cancelled work item", { missionId, error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) }));
            return;
          }
          if (claimedWorkItem && !["completed", "failed", "cancelled"].includes(claimedWorkItem.workItem.status)) await updateWorkItem(ownerId, claimedWorkItem.workItem.id, { status: "failed", output: { summary: "Execution failed" }, expectedVersion: claimedWorkItem.workItem.version }).catch((cleanupError) => console.error("[MissionRunner] failed to mark failed work item", { missionId, error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) }));
          throw error;
        } finally {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          if (claimedWorkItem) await releaseWorkItemLease(ownerId, claimedWorkItem.lease.workItemId, workerId).catch((error) => console.error("[MissionRunner] failed to release work-item lease", { missionId, workItemId: claimedWorkItem?.lease.workItemId, error: error instanceof Error ? error.message : String(error) }));
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      try {
        const current = await getMission(ownerId, missionId);
        if (["executing", "planning", "planned", "repairing"].includes(current.mission.status)) {
          await transitionMission(ownerId, missionId, current.mission.status, "failed", current.mission.version, workerId, { code: error instanceof MissionRunnerError ? error.code : "MISSION_EXECUTION_FAILED", ...(error instanceof Error ? { message: error.message } : {}) });
          await extractMissionLearningCandidates(ownerId, missionId).catch((learningError) => console.error("[MissionRunner] failed-mission learning extraction failed", { missionId, error: learningError instanceof Error ? learningError.message : String(learningError) }));
        }
      } catch (transitionError) {
        console.error("[MissionRunner] failed to persist terminal error", { missionId, error: transitionError instanceof Error ? transitionError.message : String(transitionError) });
      }
      console.error("[MissionRunner] mission execution failed", { missionId, workerId, error: error instanceof Error ? { name: error.name, message: error.message } : String(error) });
    }
  }
}

export const missionRunner = new ServerMissionRunner();
