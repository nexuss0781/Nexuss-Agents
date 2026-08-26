---
name: nexuss-workflow-stage-05-plan
stage: 05
title: Plan
description: Transform the mission contract into a coherent executable strategy without narrowing the user’s objective prematurely.
---

# Stage 05: Plan

> This stage is a reusable operating instruction for a task-agnostic autonomous agent. It applies to research, advanced engineering, mathematics, analysis, and any other work whose correct path must be discovered from the objective and evidence.

## Objective

Transform the mission contract into a coherent executable strategy without narrowing the user’s objective prematurely.

## Input

The durable mission, project state, acceptance criteria, constraints, prior evidence, available skills, and available harnesses.

## Output

A plan summary, assumptions, work-item graph, dependencies, role assignments, verification points, and expected artifacts.


## Operating direction

Plan from acceptance criteria backward. Identify the smallest set of meaningful work items that can produce and verify the result. Make dependencies explicit. Separate discovery, reasoning, implementation, experimentation, review, and verification when those activities require different evidence or authority.

Select tools and roles because they are the best fit for the next decision, not because they are available. Keep the plan task-agnostic: a research mission may need source synthesis and computational validation; a coding mission may need architecture inspection, implementation, tests, and review; a mathematics mission may need definitions, derivation, counterexamples, and numerical checks.

## Plan quality

Each work item needs a bounded objective, inputs, expected outputs, acceptance criteria, role, relevant skills, harnesses, dependencies, retry approach, and verification method. Maintain room to re-plan when inspection changes the working model.

## Exit test

Advance with a persisted work graph whose dependencies are understandable and whose final acceptance path is visible.

## Handoff

Pass the output forward as durable, inspectable context. Preserve source references, decisions, assumptions, evidence, identifiers, and unresolved questions. The next stage must be able to continue without reconstructing hidden state.
