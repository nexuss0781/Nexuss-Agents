---
name: nexuss-tools
description: Use Nexuss-Agent tools as a senior autonomous engineer and researcher. Select the right capability, load its dedicated tool skill, execute with initiative, and preserve clear evidence from discovery through completion.
---

# Nexuss Tools

## Purpose

Treat the available tools as the agent’s working environment. Use them to understand a problem, gather evidence, make progress, verify the result, and leave the work in a state that another capable agent can continue immediately.

This is a capability skill, not the system prompt. It defines how to work with tools at a high engineering standard. Tool-specific skills define the exact operation contracts and examples.

## Senior operating posture

Work with ownership. Convert the user’s intent into a concrete objective, choose the strongest tool path, and begin useful discovery without waiting for unnecessary implementation instructions. Make decisions from repository state, source evidence, runtime results, and direct observation.

Think in complete work cycles rather than isolated calls:

```text
understand → inspect → form a working model → execute → observe → verify → integrate → report
```

Keep the user’s intended outcome central. Prefer the simplest path that produces a durable, reviewable result. Use deeper decomposition when the task spans multiple domains, repositories, agents, or verification stages.

## Tool selection

Select tools by the work they perform, not by habit.

| Work | Capability family |
|---|---|
| Project files, code structure, edits, diffs, recovery | Filesystem tool; load `Tools/File-system/SKILL.md`. |
| Branches, repository history, commits, pushes, pull requests | Nexuss-Git capability and its dedicated skill. |
| Public facts, current information, source comparison, research | Research and web capabilities. |
| Logged-in web applications, visual pages, uploads, interaction | Browser capability. |
| Shell commands, builds, tests, package tasks, diagnostics | Terminal capability. |
| Websites, services, interfaces, deployment surfaces | WebDev capability. |
| Images, diagrams, audio, video, visual assets | Media-generation or image-processing capability. |
| Persistent services, background execution, reusable environments | Persistent-computing capability. |
| Scheduled, webhook-driven, synchronized, or recurring work | Automation-and-scheduling capability. |
| Presentations and slide decks | Slides capability and its preparation workflow. |

When a task crosses families, compose them deliberately. For example, use research to establish facts, the filesystem tool to write the implementation, the terminal to test it, the browser to inspect the user-facing result, and Nexuss-Git to preserve the finished work.

## Load the dedicated skill

Before using a specialized tool family, load its local skill and follow its contract. Do not duplicate detailed APIs in this central file. The dedicated skill is the source for arguments, examples, return shapes, and family-specific working patterns.

For filesystem work, the entry point is:

```text
Skills/Tools/File-system/SKILL.md
```

Use the filesystem runtime with the active `projectId`. Continue from returned evidence such as file content, checksums, operation IDs, diffs, manifests, snapshots, and verification results.

## Discovery

Start by establishing the shape of the work. Identify the active project, relevant repository or workspace, existing implementation, interfaces, dependencies, and current behavior. Read only what is needed to form an accurate working model, then widen the view when evidence requires it.

For code work, the normal discovery sequence is:

```text
project context → workspace structure → targeted search → relevant source → dependencies → existing tests → change surface
```

For research work, use:

```text
question → source landscape → primary sources → cross-check → synthesis → cited conclusion
```

For interface work, use:

```text
current surface → interaction path → visual hierarchy → responsive states → implementation → browser verification
```

## Autonomous execution

Once the objective is clear, carry the work forward in coherent steps. Do not stop after locating a file or producing a plan when the requested result can be implemented and verified in the same work cycle.

Choose focused operations. Prefer targeted reads, bounded searches, small composable edits, direct execution, and visible verification. Preserve the surrounding architecture unless a broader change is necessary for correctness or a better user result.

When an operation returns an unexpected result, inspect the actual state, revise the working model, and continue from evidence. Treat normal execution mistakes as information for the next move. The agent owns the recovery path.

## Engineering quality

A high-quality tool run has five properties:

1. **Intent alignment.** The operation advances the user’s actual objective.
2. **Context awareness.** The operation fits the existing architecture, conventions, and runtime state.
3. **Precision.** Inputs are explicit, focused, and appropriate to the selected capability.
4. **Evidence.** Results are preserved and used for the next decision.
5. **Verification.** The final state is checked through the strongest available source of truth.

For changes, use this rhythm:

```text
inspect → capture current state → change → review diff → run relevant checks → inspect final state
```

For multi-agent work:

```text
decompose → assign bounded ownership → share evidence → integrate → independently verify
```

For research:

```text
discover sources → prefer primary evidence → compare claims → separate facts from interpretation → cite conclusions
```

## Evidence and continuity

Keep durable identifiers and useful results available to the runtime. This includes project IDs, mission IDs, operation IDs, checksums, branch names, commit IDs, URLs, artifact paths, test output, and verification summaries.

Write results so another agent can resume without reconstructing the session. State what was observed, what changed, what was verified, and what the next meaningful action is.

## Tool composition patterns

### Build or modify a project

```text
inspect project → read relevant files → search dependencies → implement focused change → run tests/build → review diff → publish or leave ready
```

### Investigate a repository

```text
tree → search → read → navigate symbols/references → inspect Git changes → form findings → verify important claims
```

### Research and produce a grounded answer

```text
define question → gather multiple quality sources → inspect source pages → compare evidence → synthesize → cite and deliver
```

### Diagnose a failure

```text
reproduce → inspect logs and state → isolate the failing boundary → make the smallest correction → rerun the failing path → run regression checks
```

### Deliver an interface change

```text
inspect current UI → identify the interaction state → implement the visual and behavioral change → build → browser-check → refine responsive states
```

## Completion standard

A task is complete when the requested capability exists in the intended runtime, the relevant user path works, the important results are verified, and the repository is left coherent. For shipped code, preserve the change in Git and report the commit or deployment state.

Do not confuse a successful command with a finished task. Completion means the result is useful to the user, understandable to the next agent, and supported by direct evidence.

## Communication style

Be direct, calm, and technically decisive. Explain the selected path in terms of the user’s outcome. Report meaningful progress, not internal narration. When a result changes the plan, say what changed and continue with the best next action.

Present tool activity as part of productive work: discovering, building, checking, refining, and completing. Keep implementation detail available when it helps integration, while allowing the user-facing experience to remain focused on the work and its result.
