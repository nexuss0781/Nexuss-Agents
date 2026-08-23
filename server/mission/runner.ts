import { randomUUID } from "node:crypto";
import {
  claimWorkItem,
  getMission,
  releaseWorkItemLease,
  transitionMission,
  updateWorkItem,
  heartbeatWorkItemLease,
  type MissionSnapshot,
  type MissionWorkItem,
} from "./store";
import type { MissionStatus } from "./constitution";
import { extractMissionLearningCandidates } from "./learning";

export type MissionExecutionContext = {
  ownerId: string;
  workerId: string;
  mission: MissionSnapshot;
  signal: AbortSignal;
  activeWorkItem?: MissionWorkItem;
};

export type MissionExecutionResult = {
  verified: boolean;
  continueMission?: boolean;
  summary: string;
  failureClass?: string;
  nextAction?: string;
  artifactIds?: string[];
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
        if (needsPlan && this.orchestrator) await this.orchestrator(ownerId, missionId, controller.signal);
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
        const nextWorkItem = executionSnapshot.workItems.find((item) => claimable(item, executionSnapshot.workItems));
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

          const result = await this.executor({ ownerId, workerId, mission: executionSnapshot, signal: controller.signal, activeWorkItem: claimedWorkItem?.workItem });
          if (controller.signal.aborted) return;
          if (claimedWorkItem) {
            claimedWorkItem.workItem = await updateWorkItem(ownerId, claimedWorkItem.workItem.id, {
              status: result.verified ? "completed" : "failed",
              output: { summary: result.summary, artifactIds: result.artifactIds || [], ...(result.failureClass ? { failureClass: result.failureClass } : {}) },
              expectedVersion: claimedWorkItem.workItem.version,
            });
          }

          const latest = await getMission(ownerId, missionId);
          const unresolved = latest.workItems.filter((item) => !["completed", "cancelled"].includes(item.status));
          if (result.continueMission) {
            if (latest.workItems.length <= executionSnapshot.workItems.length) throw new MissionRunnerError("Executor reported progress without creating new work", "MISSION_EXECUTOR_NO_PROGRESS");
            continue;
          }
          if (!result.verified) {
            const verifying = await transitionMission(ownerId, missionId, "executing", "verifying", latest.mission.version, workerId, { summary: result.summary, artifactIds: result.artifactIds || [] });
            await transitionMission(ownerId, missionId, "verifying", "repairing", verifying.version, workerId, { failureClass: result.failureClass || "QUALITY_GATE_FAILED", summary: result.summary, nextAction: result.nextAction || "repair failed work" });
            return;
          }
          if (unresolved.length === 0) {
            const verifying = await transitionMission(ownerId, missionId, "executing", "verifying", latest.mission.version, workerId, { summary: result.summary, artifactIds: result.artifactIds || [] });
            await transitionMission(ownerId, missionId, "verifying", "completed", verifying.version, workerId, { summary: result.summary, artifactIds: result.artifactIds || [] });
            await extractMissionLearningCandidates(ownerId, missionId).catch((error) => console.error("[MissionRunner] learning candidate extraction failed", { missionId, error: error instanceof Error ? error.message : String(error) }));
            return;
          }
          if (unresolved.some((item) => item.status === "failed")) {
            const verifying = await transitionMission(ownerId, missionId, "executing", "verifying", latest.mission.version, workerId, { summary: result.summary, artifactIds: result.artifactIds || [] });
            await transitionMission(ownerId, missionId, "verifying", "repairing", verifying.version, workerId, { failureClass: "WORK_GRAPH_HAS_FAILED_ITEMS", summary: "A required work item failed", nextAction: "repair failed work item" });
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
          await transitionMission(ownerId, missionId, current.mission.status, "failed", current.mission.version, workerId, { code: error instanceof MissionRunnerError ? error.code : "MISSION_EXECUTION_FAILED" });
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
