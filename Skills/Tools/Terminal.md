---
name: nexuss-terminal
description: Agent-owned terminal execution inside the active Nexuss project workspace. Use for repository commands, scaffolding, tests, builds, diagnosis, and other work that requires a real process with observable output.
---

# Nexuss Terminal

## Operating role

Use Terminal as the agent’s process execution capability. The agent starts and controls the process; the Terminal right-window extension is the monitoring surface. Do not treat the extension as a second command console.

Use the selected project as the execution boundary. A project must exist and its workspace must be ready before starting a command. Keep the working directory relative to that project unless the runtime explicitly resolves an approved absolute path inside the same workspace.

## Local lane

Use the Local lane for fast repository work: inspect the environment, clone or scaffold code, install dependencies, run tests, build applications, diagnose failures, and verify changes. General **Build** mode can call the Local Terminal tool. Plan Enabled may plan and inspect without mutating; Instant remains concise; Complex follows its own mission mode.

The agent-facing request has this shape:

```json
{
  "contractVersion": "1.0.0",
  "lane": "local",
  "projectId": "project-id",
  "workingDirectory": ".",
  "command": "npm test",
  "shell": "bash",
  "interactive": false,
  "timeout": { "timeoutMs": 120000 },
  "label": "Run project tests"
}
```

`command` is required. Prefer a project-relative `workingDirectory`; use `.` when the repository root is correct. Set `timeout.timeoutMs` to the expected maximum and add `idleTimeoutMs` when a silent process should be considered stalled. Use a concise `label` when the command needs a human-readable activity name.

## Execution cycle

Follow this cycle:

```text
identify project → choose directory → select smallest useful command → execute → observe events → interpret result → verify or repair → report evidence
```

Before a broad command, inspect the project and existing scripts. Run focused checks first, then the project build or full validation when the change surface requires it. Preserve stdout and stderr separately in the reasoning. A non-zero exit code is evidence to diagnose, not a reason to hide the command or invent success.

Prefer one coherent command when the operations are tightly coupled, but keep commands readable and bounded. Use the filesystem capability for precise file reads and edits; use Terminal when an actual process, package manager, compiler, test runner, shell pipeline, or repository command must run.

## Session evidence

Every Local execution creates a durable session. Retain and use:

| Evidence | Meaning |
|---|---|
| `sessionId` / `operationId` | Identifier for the live monitor and persisted session. |
| Ordered events | Status, stdout, stderr, stdin, metric, and completion evidence in sequence. |
| `state` | Running, awaiting input, completed, failed, cancelled, timed out, or interrupted. |
| `exitCode` | Process result when the operating system provides one. |
| `summary` | Human-readable completion or failure description. |
| Working directory | Exact project location used by the process. |

When a command fails, report the command, directory, state, exit code, relevant stderr, and the next repair action. When it succeeds, report the command and the verification result it produced.

## Workbench monitoring

When the runtime emits a Terminal action event, preserve its `operationId`. The action workbench card is clickable and opens the Terminal extension directly on that session. The extension hydrates the durable snapshot, subscribes to live events, merges events by sequence, and follows the session through completion.

The monitor is read-only for agent-owned sessions. It displays the project, command, state, timestamps, stdout, stderr, status messages, exit result, and session history. Do not ask the user to retype a command in the monitor. If another command is needed, the agent starts a new Terminal operation.

## Cancellation and interruption

If the user stops the active request or the runtime aborts the agent turn, allow the Local session cancellation path to run. Treat cancellation, timeout, and interruption as distinct terminal results. Do not report a cancelled command as completed. After cancellation, inspect the persisted result before deciding whether a safe retry is appropriate.

## External lane

Use the External GitHub Actions lane when work needs hosted runners, multiple jobs, long execution, platform-specific runners, or workflow-level monitoring. The External lane records repository, workflow, ref, inputs, run status, cancellation state, job events, and artifact metadata. The current right-window surface can dispatch and monitor these runs; direct agent selection of Local versus External remains a later runtime integration and must not be implied when only the Local tool is available.

## Completion standard

A Terminal operation is complete only when the process result is known and the result is useful to the current task. Connect the result to the next action: continue implementation, repair the failure, run another verification, or present the finished evidence. Keep operation identifiers, important output, and final state available for the conversation and the next agent step.
