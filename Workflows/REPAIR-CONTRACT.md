# Adaptive Repair and Re-planning Contract

## Purpose

A failed result is information. The runtime classifies the failure, preserves the evidence, identifies what changed, and selects a bounded next move. It never repeats an unsuccessful strategy unchanged.

## Repair sequence

```text
failed executor result
  → preserve result, evidence, and artifacts
  → diagnose failure class and new information
  → identify changed condition
  → choose retry, repair, re-plan, delegated review, blocked, or escalation
  → fingerprint the next strategy
  → validate budget and retry lineage
  → create a replacement work item when re-planning is required
  → resume from the repaired dependency graph
```

## Dispositions

| Disposition | Runtime behavior |
|---|---|
| `retry` | Retry the same bounded work scope with a changed strategy and within the attempt budget. |
| `repair` | Keep the work item in repair and execute a changed repair strategy. |
| `replan` | Preserve the failed work item as historical lineage, cancel its active execution path, and create a replacement work item with the diagnosis and evidence references. |
| `delegate_review` | Route the uncertainty to an appropriate specialist or verifier. |
| `blocked` | Preserve the failure and wait for a missing capability, permission, or required input. |
| `escalate` | Stop automatic continuation when the failure is cancelled, terminal, or beyond the declared recovery policy. |

## Diagnosis requirements

Every automatic repair records the failure class, bounded summary, evidence references, new information, changed condition, recommended disposition, and confidence. The diagnosis is stored in the work-item output and mission transition payload.

## Retry lineage

A retry is allowed only when it has a changed condition, a different strategy fingerprint, and remaining attempt budget. An unchanged strategy is escalated rather than looped. A re-plan creates a new work-item lineage while retaining the original failed work item and its evidence.

## Re-planning rule

Re-planning preserves all completed work. The replacement work item includes the failed work-item ID, failure class, changed condition, next strategy fingerprint, evidence references, and completed-work exclusions. It inherits only dependencies that are already complete and must pass the same authority, capability, budget, evidence, and quality policies as any other work item.

## Continuation rule

An executor may request continuation only when it has created new bounded work. The runner rejects a continuation claim that creates no new work item, preventing an adaptive loop that reports progress without changing the graph.

## Completion rule

A repaired or re-planned mission still needs the evidence and independent verification required by its mission risk. Repair changes the path to completion; it does not weaken completion quality.
