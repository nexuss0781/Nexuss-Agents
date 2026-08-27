---
name: nexuss-terminal
description: Agent-owned terminal execution and monitored workflow operations for Nexuss-Agent. Use when a task requires real shell processes, repository commands, scaffolding, tests, builds, diagnosis, long-running jobs, hosted runners, or workflow artifacts.
---

# Nexuss Terminal

## Core role

Treat Terminal as the agent’s execution capability. The agent chooses the command or workflow, starts it, observes its result, interprets the evidence, and decides the next action. The right-window Terminal extension is the workbench monitor: it shows what the agent is doing without becoming a second command console.

Keep every operation attached to the active Nexuss project. Establish the project and working directory before execution, then preserve the returned session or run identifier so the operation can be reopened from the workbench.

Use the following work cycle:

```text
understand → choose lane → select project context → execute → observe → interpret → verify → continue or report
```

## Select the lane

Choose **Local** for immediate work in the active project workspace. Choose **External** for work that benefits from GitHub Actions as an independent, reproducible, parallel, platform-aware, long-running workflow.

| Choose Local when | Choose External when |
|---|---|
| The agent needs output immediately for the next reasoning step. | The process may outlive the current request or Nexuss session. |
| The command inspects or changes the active project. | The work needs multiple jobs, dependencies, or a matrix. |
| The task is a focused search, test, check, formatter, build, or diagnosis. | The work needs Linux, Windows, or macOS runners. |
| The agent is iterating rapidly on implementation. | The job needs a clean reproducible CI environment. |
| The command is short or its duration is known and manageable. | The work produces release, build, report, model, or package artifacts. |
| The result determines the next local edit or verification. | The workflow needs GitHub Actions secrets, run history, or hosted permissions. |

Use a hybrid sequence when appropriate: explore and smoke-test locally, dispatch the expensive or broad validation externally, inspect the result, then return locally for repair.

Do not send every small command to GitHub Actions. Do not use Local for a multi-job, cross-platform, artifact-producing, or long-lived operation when a hosted workflow is the more truthful execution environment.

## Local lane: agent execution

Use Local for repository operations such as:

```bash
rg -n "selectedModel|activeModel" client server
npm run check
npx vitest run server/terminal/localSessionManager.test.ts
git diff --check
npm run build
```

General **Build** mode calls the Local Terminal capability with a project-scoped request. The request uses this shape:

```json
{
  "contractVersion": "1.0.0",
  "lane": "local",
  "projectId": "active-project-id",
  "workingDirectory": ".",
  "command": "npm run check",
  "shell": "bash",
  "interactive": false,
  "timeout": { "timeoutMs": 180000 },
  "label": "Check the project"
}
```

Provide a useful `workingDirectory`; use `.` for the project root. Set `timeoutMs` to the expected upper bound. Add `idleTimeoutMs` when a silent process should be treated as stalled. Add a concise `label` when the command needs a readable workbench title.

Use the Local lane in this order:

1. Identify the active project and confirm that its workspace is ready.
2. Inspect scripts, files, and the current state before choosing a broad command.
3. Run the smallest command that answers the current question.
4. Read stdout and stderr as separate evidence.
5. Repair or continue based on the actual result.
6. Run a focused verification, followed by a broader check when the change warrants it.

Use the filesystem capability for precise file reads and edits. Use Local Terminal when a real shell, package manager, compiler, test runner, process, or repository command must execute.

## External lane: hosted workflows

Use External when the operation should be a GitHub Actions run rather than a direct shell process. Select a repository, workflow with `workflow_dispatch`, ref, and structured inputs. Prefer a small verification workflow before dispatching a full build, training, release, or deployment workflow.

A valid External request conceptually contains:

```text
repository → workflow → ref → inputs → timeout/monitoring rules
```

Examples include:

- A production build that installs dependencies, compiles the application, and uploads `dist/`.
- A test matrix across Ubuntu, Windows, and macOS.
- Parallel backend, frontend, integration, and end-to-end jobs.
- A training workflow that saves checkpoints and metrics.
- A release workflow that packages and uploads signed artifacts.

Use Local for a smoke test before External:

```bash
python -m training.smoke_test --steps 20
```

Use External for the full operation when it is long-running or resource-intensive:

```text
workflow: train-model.yml
ref: experiment/large-run
inputs:
  dataset: verified-dataset
  epochs: 100
  checkpoint_interval: 10
```

Treat the External result as a workflow result, not as ordinary terminal output. Preserve the repository, ref, workflow identity, run ID, job results, conclusion, workflow URL, cancellation state, and artifact metadata.

The current Nexuss implementation exposes External dispatch and monitoring through the Terminal extension. Direct model-driven Local-versus-External selection is a separate runtime capability and must only be used when the active agent runtime exposes it explicitly.

## Session and event evidence

A Local operation creates a durable session. Preserve these fields:

| Field | Use |
|---|---|
| `sessionId` / `operationId` | Reopen the exact session in the Terminal workbench. |
| `projectId` | Connect the operation to the correct project. |
| `workingDirectory` | Explain where the process ran. |
| Ordered events | Reconstruct status, stdout, stderr, input, and completion in order. |
| `state` | Distinguish running, waiting, completed, failed, cancelled, timed out, and interrupted. |
| `exitCode` | Establish the operating-system process result. |
| `summary` | Communicate the final outcome clearly. |

The agent action event must carry the Terminal `operationId` as soon as the session starts. The workbench uses it to open the correct session while the process is still running. The monitor hydrates persisted history, subscribes to live events, merges events by sequence, and follows the session to its final state.

Interpret event kinds deliberately:

- Treat `stdout` as normal process output.
- Treat `stderr` as diagnostic or error output, while checking the final state before declaring failure.
- Treat `status` as lifecycle evidence.
- Treat `stdin` as input sent to an interactive process.
- Treat `metric` and `artifact` as supporting execution evidence.

## Workbench behavior

Present Terminal activity as a distinct action workbench card in the conversation. Make the card openable when it has an `operationId`. When selected, open the Terminal right-window extension on that exact Local session or External run.

Keep agent-owned monitoring read-only. Show the project, command or workflow, ref, current state, live output, timestamps, final result, run history, and artifacts. Start another operation through the agent runtime instead of asking the user to retype a command into the monitor.

The extension should remain useful after the agent action has completed. Allow the user to inspect history and reopen the persisted session or run without changing the recorded evidence.

## Failure handling

When Local fails, preserve the command, project, directory, state, exit code, relevant stderr, summary, and operation ID. Diagnose the result before retrying. Fix code or configuration locally when the failure is local and actionable.

When External fails, preserve the repository, workflow, ref, run ID, failed job or step, conclusion, URL, and artifacts. Classify the failure before retrying:

| Failure | Next reasoning step |
|---|---|
| Assertion or compilation failure | Inspect the failure and repair the implementation. |
| Dependency or transient network failure | Confirm the environment, then retry deliberately. |
| Missing secret or permission | Correct the workflow or connected GitHub configuration. |
| Cancellation | Record it as cancelled; do not report it as a failed build. |
| Timeout or divergence | Inspect logs, metrics, and checkpoints before deciding whether to rerun. |

Never convert a non-zero exit code, cancelled run, timeout, or missing result into a success statement.

## Cancellation and continuation

When the user stops an active agent request, allow the linked Local session cancellation path to complete and read its persisted result. Distinguish `cancelled`, `timed_out`, and `interrupted` from `failed` and `completed`.

After a terminal result, choose one concrete continuation:

```text
continue implementation
→ repair the reported failure
→ run a focused verification
→ dispatch the next workflow
→ present the completed evidence
```

## Completion standard

Consider a Terminal operation complete only when its final state is known, its evidence is connected to the task, and the next action is clear. Report the command or workflow, project or repository context, state, exit or conclusion result, relevant output, and verification performed. Keep the operation identifier available so the user and the next agent can reopen the workbench view.
