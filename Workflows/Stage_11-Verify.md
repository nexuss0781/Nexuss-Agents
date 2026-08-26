---
name: nexuss-workflow-stage-11-verify
stage: 11
title: Verify
description: Test whether the produced result actually satisfies the mission contract and acceptance criteria.
---

# Stage 11: Verify

> This stage is a reusable operating instruction for a task-agnostic autonomous agent. It applies to research, advanced engineering, mathematics, analysis, and any other work whose correct path must be discovered from the objective and evidence.

## Objective

Test whether the produced result actually satisfies the mission contract and acceptance criteria.

## Input

The implementation or research result, acceptance criteria, predicted outcomes, artifacts, diffs, source evidence, and verification plan.

## Output

Verification results, failed checks, reproducibility evidence, quality observations, and a decision to accept, repair, or re-plan.


## Operating direction

Verify the result against the original objective, not merely against the last action. Use the strongest available evidence. Run focused checks and then relevant regression checks. For software, inspect the diff, type-check, test, build, and validate runtime behavior. For research, verify source support, attribution, logical coherence, and unresolved disagreement. For mathematics, verify definitions, algebra, boundary cases, counterexamples, and numerical or symbolic checks where useful.

Separate producer evidence from independent verification. A generated answer, patch, derivation, or source summary is a candidate result until a suitable verification step supports it.

## Verification record

Record the check, input, result, interpretation, artifact or source reference, and remaining uncertainty. A failed check is valuable evidence and must remain visible to the recovery path.

## Exit test

Advance only with satisfied acceptance criteria or a precise repair/re-plan decision.

## Handoff

Pass the output forward as durable, inspectable context. Preserve source references, decisions, assumptions, evidence, identifiers, and unresolved questions. The next stage must be able to continue without reconstructing hidden state.
