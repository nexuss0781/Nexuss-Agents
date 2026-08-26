# Durable Recovery and Restart Resumption Contract

## Purpose

A mission may outlive the process that was executing it. Recovery reconstructs the next safe action from durable mission state rather than trusting browser state, in-memory runner state, or a stale worker claim.

## Recovery sequence

```text
startup recovery scan
  → select resumable missions
  → skip missions already running in this process
  → record recovery start
  → reclaim leases from the previous runtime generation
  → reconcile claimed/executing work without a live lease
  → preserve previous output, evidence, budget, and retry lineage
  → save a recovery checkpoint
  → move interrupted verification through repair
  → resume the mission runner
```

## Lease rule

A lease is valid only while it is live and owned by the active worker. An expired lease may be reclaimed. During startup recovery, leases belonging to the previous process generation are reclaimed after the current process confirms the mission is not already running locally.

A recovered `claimed` or `executing` work item is moved to `repairing`, not silently returned to `pending`. This preserves the fact that execution may have produced a partial side effect. The repair path must inspect the workspace and existing artifacts before repeating any mutation.

## Checkpoint rule

Every recovery writes a checkpoint containing a recovery ID, previous mission status, reclaimed lease count, reconciled work-item IDs, resumable work-item IDs, timestamp, and next action. Repeating recovery after the same state has already been reconciled returns the existing recovery checkpoint instead of writing an unbounded duplicate recovery record.

## Verification interruption

A mission found in `verifying` after a process restart is moved to `repairing` before resumption. Completion must be re-established from durable evidence and verification records; a stale pre-restart claim is never treated as a passing quality result.

## Idempotency and side effects

Recovery does not delete prior artifacts, evidence, output, failure records, or budget usage. It does not assume that an interrupted command had no effect. It records the prior worker and status where available, then requires the next repair strategy to reconcile the real workspace before repeating the operation.

A live in-process mission is not interrupted by a recovery scan. The process-local runner registry is checked before durable reconciliation, and the scan skips a mission already owned by an active runner.

## Recovery event vocabulary

| Event | Meaning |
|---|---|
| `runner.recovery_started` | A resumable mission was selected for recovery. |
| `runner.recovery_reconciled` | Durable leases and interrupted work were reconciled and a checkpoint was written. |
| `work_item.recovered` | A claimed or executing work item without a live lease was moved to repair. |
| `checkpoint.saved` | The durable state required for resumption was recorded. |

## Completion condition

Recovery is complete when the mission has a valid durable checkpoint, no previous-generation lease remains for the recovered mission, every interrupted work item is either in repair or explicitly resumable, and the mission runner has been started from the reconciled state.
