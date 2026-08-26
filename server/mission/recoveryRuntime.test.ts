import { describe, expect, it } from "vitest";
import { decideMissionRecovery, decideWorkItemRecovery, recoveryCheckpointState } from "./recoveryRuntime";

describe("Phase 10 recovery runtime", () => {
  it("preserves work owned by a live lease", () => {
    expect(decideWorkItemRecovery({ id: "work-1", status: "executing", hasLiveLease: true, attempt: 1 })).toMatchObject({ disposition: "noop", nextStatus: "executing" });
    expect(decideMissionRecovery({ status: "executing", hasLiveLease: true, workItems: [{ id: "work-1", status: "executing", hasLiveLease: true, attempt: 1 }] })).toMatchObject({ disposition: "noop", nextMissionStatus: "executing" });
  });

  it("moves lease-less interrupted work to repair before repeating side effects", () => {
    expect(decideWorkItemRecovery({ id: "work-1", status: "claimed", hasLiveLease: false, attempt: 2 })).toMatchObject({ disposition: "reconcile", nextStatus: "repairing" });
    expect(decideMissionRecovery({ status: "executing", hasLiveLease: false, workItems: [{ id: "work-1", status: "claimed", hasLiveLease: false, attempt: 2 }] })).toMatchObject({ disposition: "reconcile", nextMissionStatus: "executing", workItems: [expect.objectContaining({ nextStatus: "repairing" })] });
  });

  it("re-enters repair when verification was interrupted", () => {
    expect(decideMissionRecovery({ status: "verifying", hasLiveLease: false, workItems: [] })).toMatchObject({ disposition: "repair", nextMissionStatus: "repairing" });
  });

  it("produces a replayable recovery checkpoint state", () => {
    expect(recoveryCheckpointState({ recoveryId: "recovery-1", disposition: "reconcile", previousStatus: "executing", recoveredWorkItemIds: ["work-1"], staleLeaseCount: 1 })).toMatchObject({ recovery: { recoveryId: "recovery-1", recoveredWorkItemIds: ["work-1"], staleLeaseCount: 1 } });
  });
});
