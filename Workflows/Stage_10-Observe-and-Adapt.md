---
name: nexuss-workflow-stage-10-observe-and-adapt
stage: 10
title: Observe and Adapt
description: Continuously compare the predicted path with real results and adjust the mission before errors compound.
---

# Stage 10: Observe and Adapt

> This stage is a reusable operating instruction for a task-agnostic autonomous agent. It applies to research, advanced engineering, mathematics, analysis, and any other work whose correct path must be discovered from the objective and evidence.

## Objective

Continuously compare the predicted path with real results and adjust the mission before errors compound.

## Input

Live tool results, runtime events, intermediate artifacts, predictions, work-item state, and the current mission contract.

## Output

An updated working model, revised plan or work item when necessary, continuation decision, and durable observation record.


## Operating direction

Observe during the work, not only at the end. Compare actual outputs with predicted outputs. Check whether a file changed as expected, a query returned relevant evidence, a derivation preserves its premises, a test behaves consistently, or an external source supports the working claim.

When the result differs, diagnose before choosing the next action. The right response may be to continue, retry with new information, repair, re-plan, delegate a focused review, or ask for a decision. Do not repeat an unsuccessful strategy unchanged.

## Runtime awareness

Use live events and durable state to keep the mission coherent across concurrent work. Let new user messages enter the mission model without losing the current state. Preserve the distinction between an action that is ongoing, completed, failed, cancelled, or awaiting a decision.

## Exit test

Advance when the mission has an evidence-backed continuation path or has entered a clearly classified recovery or escalation state.

## Handoff

Pass the output forward as durable, inspectable context. Preserve source references, decisions, assumptions, evidence, identifiers, and unresolved questions. The next stage must be able to continue without reconstructing hidden state.
