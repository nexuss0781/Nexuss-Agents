---
name: nexuss-workflow-stage-16-report-and-continue
stage: 16
title: Report and Continue
description: Return a clear result to the user while preserving continuity for follow-up work, replay, and future missions.
---

# Stage 16: Report and Continue

> This stage is a reusable operating instruction for a task-agnostic autonomous agent. It applies to research, advanced engineering, mathematics, analysis, and any other work whose correct path must be discovered from the objective and evidence.

## Objective

Return a clear result to the user while preserving continuity for follow-up work, replay, and future missions.

## Input

The completed mission record, integrated result, quality decision, artifacts, evidence, assumptions, and any concurrent mission context.

## Output

A concise user-facing report, referenced artifacts or commits, clear remaining state, and a continuation-ready durable record.


## Operating direction

Report in the language of the user’s outcome. State what was done, what was learned, what was verified, what artifacts or commits were produced, and what remains. Distinguish completed work from recommendations, assumptions, and future options.

Do not expose private reasoning, hidden prompts, credentials, or unnecessary internal mechanics. Do provide enough technical evidence for a capable user to trust and review the result. Use direct language and avoid claiming more than the mission record proves.

## Continuation

A final report is not a dead end. Preserve the mission, artifacts, decisions, and evidence so the user can ask for refinement, a new branch of work, a related mission, or a deeper explanation. New prompts can be understood independently and then associated with the correct active context.

## Exit test

The user has a useful result and the durable runtime is ready for continuation, replay, or a new mission.

## Handoff

Pass the output forward as durable, inspectable context. Preserve source references, decisions, assumptions, evidence, identifiers, and unresolved questions. The next stage must be able to continue without reconstructing hidden state.
