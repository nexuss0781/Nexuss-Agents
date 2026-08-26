---
name: nexuss-workflow-status-vocabulary
version: 1.0.0
description: Canonical statuses, decisions, failures, authority classes, side effects, lifecycle events, and live labels for Nexuss-Agent workflow execution.
---

# Nexuss-Agent Status Vocabulary

## Purpose

This document defines the words used by prompts, runtime records, events, schedulers, harnesses, quality gates, and the user interface. A status describes the current condition of an object. An event records something that happened. A decision records what should happen next.

These terms are canonical for contract version `1.0.0`. Runtime code should use the identifiers exactly as written.

## Vocabulary rules

```text
status = current condition
state transition = validated movement between conditions
event = immutable fact about activity
decision = selected next path supported by evidence
failure = preserved unsuccessful outcome
artifact = produced or referenced object
evidence = support for a claim, decision, or transition
```

Do not use display text as a persisted status. The runtime stores the identifier and the UI translates it into concise language.

## Mission statuses

| Status | Meaning | Can continue? |
|---|---|---:|
| `created` | Mission identity and contract have been persisted. | Yes |
| `queued` | Mission is ready for the runner to begin. | Yes |
| `planning` | The principal orchestrator is forming or loading the work graph. | Yes |
| `planned` | A valid executable work graph exists. | Yes |
| `executing` | One or more work items are actively progressing. | Yes |
| `verifying` | The mission is evaluating its result or work graph. | Yes |
| `repairing` | The mission is executing a repair or recovery path. | Yes |
| `awaiting_user` | A material user decision or missing user input is required. | On input |
| `blocked` | A required capability, permission, dependency, or condition prevents progress. | On resolution |
| `completed` | The completion contract has been satisfied and persisted. | Follow-up only |
| `failed` | The mission cannot continue under its current contract or bounded policy. | Only through explicit continuation |
| `cancelled` | The mission was intentionally stopped. | Only through explicit continuation |
| `stopped` | Execution was stopped and the mission state records the stop. | Through continuation |

Terminal statuses for the current mission instance are:

```text
completed
failed
cancelled
stopped
```

A terminal mission is never silently resumed. A new continuation or new mission relationship is created.

## Stage-run statuses

| Status | Meaning |
|---|---|
| `pending` | Stage run exists but has not begun. |
| `active` | The stage is being executed. |
| `paused` | Work is intentionally paused with a checkpoint. |
| `awaiting_input` | Stage requires a material user or external decision. |
| `succeeded` | Stage output and completion predicate passed. |
| `repair_required` | Stage output exists but does not satisfy its predicate. |
| `failed` | Stage execution could not produce a usable result. |
| `cancelled` | Stage was stopped by cancellation. |
| `expired` | Stage exceeded its permitted execution window. |

A new attempt creates a new stage run or child run linked to the previous one. Existing runs remain available for evidence and replay.

## Work-item statuses

| Status | Meaning |
|---|---|
| `pending` | Created but dependencies or scheduling have not made it ready. |
| `ready` | Dependencies are satisfied and it may be claimed. |
| `claimed` | An agent has claimed the work item. |
| `running` | Work is actively executing. |
| `waiting` | Work is waiting for a dependency, child result, or external condition. |
| `repairing` | A repair attempt is active. |
| `completed` | Required output and work-item verification passed. |
| `failed` | The attempt failed and the work item needs repair, re-plan, or terminal handling. |
| `blocked` | The work item cannot proceed under current conditions. |
| `cancelled` | The work item was cancelled. |
| `expired` | Its lease or execution window expired. |

Only `pending`, `ready`, and `repairing` work items may normally be claimed. A work item is not complete merely because an agent returned a response.

## Intake decisions

| Decision | Meaning |
|---|---|
| `ready_for_planning` | The principal orchestrator can begin from the available brief. |
| `ready_with_assumptions` | Planning can begin with visible, bounded, verifiable assumptions. |
| `needs_clarification` | A material ambiguity would change outcome, scope, deliverables, or side effects. |
| `blocked` | Permission, unsupported input, missing capability, or a hard condition prevents progress. |

`needs_clarification` is an intake decision, not a mission completion state.

## Execution results

| Result | Meaning |
|---|---|
| `started` | The runtime accepted and began the operation. |
| `ongoing` | The operation is still progressing or streaming. |
| `completed` | The operation returned the expected successful result. |
| `failed` | The operation returned an unsuccessful result. |
| `cancelled` | The operation stopped because cancellation was requested. |
| `timed_out` | The operation exceeded its permitted duration. |
| `rejected` | The runtime did not start the operation because its contract, authority, input, or transition was invalid. |
| `unavailable` | The requested capability or external dependency is not currently available. |

The UI may use shorter display labels such as `Writing…`, `File written`, or `Write failed`, but the runtime preserves the exact result identifier.

## Failure classifications

| Classification | Meaning | Typical next path |
|---|---|---|
| `retryable` | The same objective may succeed after a transient condition changes. | Retry with recorded attempt. |
| `repairable` | The result or implementation can be corrected without changing the mission objective. | Repair and verify. |
| `replan_required` | The current strategy is not competent for the observed state. | Return to plan or design. |
| `blocked` | Progress requires a missing capability, permission, dependency, or decision. | Await resolution. |
| `cancelled` | Work stopped by an explicit cancellation. | Preserve state; continue only by new instruction. |
| `terminal` | The mission cannot continue under its current contract. | Complete failure record or new mission. |

Every failure record includes the attempt, strategy, evidence, changed condition, retryability, and recommended next transition.

## Verification statuses

| Status | Meaning |
|---|---|
| `not_started` | No verification has been performed. |
| `running` | Verification is currently executing. |
| `passed` | The check supports the evaluated requirement or artifact. |
| `failed` | The check found a mismatch or unsuccessful result. |
| `inconclusive` | Evidence is insufficient to decide. |
| `not_applicable` | The check does not apply and the reason is recorded. |
| `cancelled` | Verification was stopped before a decision. |

A `passed` check proves only the subject and method recorded in that verification. It does not automatically prove the entire mission.

## Quality decisions

| Decision | Meaning |
|---|---|
| `accepted` | Required criteria and evidence support completion. |
| `repair_required` | The result is close enough to repair under the current objective. |
| `replan_required` | The strategy or work graph must change. |
| `blocked` | A required condition prevents a quality decision. |
| `rejected` | The candidate does not satisfy the contract. |
| `cancelled` | Quality review was stopped by cancellation. |

Each quality decision records reviewer identity, independence mode, reviewed subjects, checks, evidence, and next transition.

## Authority classes

| Class | Meaning |
|---|---|
| `intake_only` | Understand and normalize input; no implementation or delegation. |
| `mission_owner` | Own mission planning, delegation, coordination, and acceptance recommendation. |
| `delegation_only` | Decompose bounded work and coordinate registered specialists. |
| `execution_only` | Perform the assigned work within the supplied scope. |
| `verification_only` | Inspect and evaluate without producing the implementation under review. |

Authority is inherited through explicit assignment and validated by the runtime. A role’s prompt describes its authority; the harness enforces it.

## Side-effect classes

| Class | Meaning |
|---|---|
| `read_only` | Observes state without changing it. |
| `local_reversible_write` | Changes a local artifact with a known recovery path. |
| `workspace_mutation` | Changes the active project workspace. |
| `repository_mutation` | Changes Git history, branches, staging, commits, or remote state. |
| `network_read` | Reads external information or service state. |
| `network_publication` | Publishes data or code to an external service. |
| `credential_use` | Uses an authenticated secret or grant through a server-owned integration. |
| `third_party_communication` | Sends a message, comment, review, or other external communication. |
| `delete_or_irreversible` | Removes or changes state without a complete normal rollback path. |
| `deployment_or_release` | Changes a deployed or distributed product state. |

## Event naming

Events use a stable domain and action:

```text
<domain>.<action>
```

Core events include:

```text
mission.created
mission.queued
mission.started
mission.paused
mission.awaiting_user
mission.blocked
mission.completed
mission.failed
mission.cancelled

stage.started
stage.paused
stage.succeeded
stage.repair_required
stage.failed
stage.cancelled

work_item.created
work_item.ready
work_item.claimed
work_item.started
work_item.waiting
work_item.completed
work_item.failed
work_item.cancelled

orchestration.plan_created
orchestration.plan_revised
specialist.spawned
specialist.started
specialist.completed
specialist.failed

research.started
research.completed
calculation.started
calculation.completed
executor.started
executor.completed
executor.failed

filesystem.started
filesystem.completed
filesystem.failed
filesystem.cancelled
tool.started
tool.completed
tool.failed

verification.started
verification.passed
verification.failed
quality_gate.started
quality_gate.completed
repair.started
repair.completed
checkpoint.created
evidence.recorded
artifact.created
continuation.created
```

Events are immutable. A correction is represented by a new event linked to the earlier event.

## Live display labels

The user interface translates runtime events into concise human-readable labels.

| Runtime state | Example display |
|---|---|
| `started` | `Reading file` |
| `ongoing` | `Reading…` |
| `completed` | `File read` |
| `failed` | `Read failed` |
| `cancelled` | `Reading stopped` |
| `timed_out` | `Reading took longer than expected` |
| `repair_required` | `Work being refined` |
| `verification.running` | `Checking result` |
| `verification.passed` | `Result checked` |
| `awaiting_user` | `Your input is needed` |
| `blocked` | `Work paused` |

The label should identify the useful work, not expose internal implementation names. Details remain expandable through the action card or workbench.

## Transition terminology

Use these terms consistently:

```text
advance      move to the next legal stage
re-enter     create a new run of an earlier stage
continue     resume an unfinished mission or work item
retry        repeat after a transient condition with lineage
repair       correct a result while preserving the objective
re-plan      replace the strategy or dependency graph
recover      restore or rebuild from known evidence
escalate     request an external decision or capability
complete     satisfy the completion contract
```

## Contract change rule

Any new status, event, failure class, authority class, side-effect class, or quality decision requires a contract version update and a migration note. Display labels may evolve without changing persisted identifiers, provided their meaning remains clear.
