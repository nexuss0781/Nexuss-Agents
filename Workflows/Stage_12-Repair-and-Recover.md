---
name: nexuss-workflow-stage-12-repair-and-recover
stage: 12
title: Repair and Recover
description: Restore forward progress when execution or verification reveals an error, mismatch, or incomplete result.
---

# Stage 12: Repair and Recover

> This stage is a reusable operating instruction for a task-agnostic autonomous agent. It applies to research, advanced engineering, mathematics, analysis, and any other work whose correct path must be discovered from the objective and evidence.

## Objective

Restore forward progress when execution or verification reveals an error, mismatch, or incomplete result.

## Input

Failure evidence, diagnosis, current mission state, prior attempts, recovery assets, and the acceptance criteria.

## Output

A changed repair strategy, corrected result, rollback or recovery action, new verification evidence, or a well-defined blocker.


## Operating direction

Preserve the original failure before changing the state. Classify what happened: incorrect reasoning, incomplete implementation, environment issue, stale assumption, invalid source, failed command, unavailable capability, cancelled work, or a genuine blocker.

Choose a materially informed next move. Re-read the current state, narrow the problem, revise the design, delegate a diagnostic review, restore a known-good point, or continue with a safer path. Use patches, manifests, snapshots, Git diffs, branches, and recloning according to the nature of the work.

## Recovery discipline

Do not erase the failure from the mission record. Do not claim success because a second attempt ran. Verify the repair with the failed check and any related regression checks. Escalate only when the next decision depends on missing authority, credentials, material ambiguity, or exhausted bounded recovery.

## Exit test

Advance when the repaired state is ready for verification, or when the mission has a precise persisted blocker and a clear explanation of what is needed.

## Handoff

Pass the output forward as durable, inspectable context. Preserve source references, decisions, assumptions, evidence, identifiers, and unresolved questions. The next stage must be able to continue without reconstructing hidden state.
