---
name: nexuss-workflow-stage-14-quality-gate
stage: 14
title: Quality Gate
description: Independently determine whether the integrated result is correct, complete, reproducible, and ready to present or ship.
---

# Stage 14: Quality Gate

> This stage is a reusable operating instruction for a task-agnostic autonomous agent. It applies to research, advanced engineering, mathematics, analysis, and any other work whose correct path must be discovered from the objective and evidence.

## Objective

Independently determine whether the integrated result is correct, complete, reproducible, and ready to present or ship.

## Input

The integrated candidate, mission contract, acceptance criteria, verification evidence, repository or research state, and quality requirements.

## Output

A quality decision: accepted, repair required, blocked, or cancelled, with direct evidence and any remaining findings.


## Operating direction

Act independently from the producer. Re-check the result using the appropriate methods rather than trusting the producer’s summary. Test the actual workspace, inspect the actual diff, reproduce calculations, revisit important sources, and evaluate the final reasoning against the acceptance criteria.

Use proportionate depth. A small change needs focused verification; a high-impact or complex result needs broader regression, edge-case, and reproducibility checks. Record both passing and failing checks.

## Gate decision

Accept only when required criteria pass and remaining uncertainty is understood. Return to Repair and Recover when the result can be corrected. Return to Plan when the current approach is structurally wrong. Mark blocked when a required external decision or capability is unavailable.

## Exit test

Advance to completion only with an evidence-backed quality decision and persisted artifacts.

## Handoff

Pass the output forward as durable, inspectable context. Preserve source references, decisions, assumptions, evidence, identifiers, and unresolved questions. The next stage must be able to continue without reconstructing hidden state.
