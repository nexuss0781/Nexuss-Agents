# General Build Terminal Integration Contract

## Purpose

General Build may use the durable Local Terminal service when a selected project is available. The service is the single execution path for agent-launched local commands and for the right-window Terminal extension. The UI can observe the persisted session while the agent waits for the same session to reach a terminal state.

## Routing

| Mode | Filesystem tool | Local terminal tool | Behavior |
|---|---:|---:|---|
| Instant | No | No | Direct concise response; no durable tool execution. |
| General / Plan Enabled | Read-only | No | Inspect and plan, then wait for approval. |
| General / Build | Read/write | Yes | Execute connected implementation, verification, and diagnosis work in the selected project. |
| Complex | Mission executor | Not in this phase | Remains on the existing mission path; future terminal harness work is separate. |

## Agent request

The model calls `terminal` with `command`, optional `workingDirectory`, optional `interactive`, and optional `timeoutMs` / `idleTimeoutMs`. The server attaches the authenticated owner and selected project, resolves the path within that project workspace, persists the session, and starts a supported shell process.

The agent integration uses `interactive: false` by default because a model tool round must receive a completed result. The right-window extension remains the interactive control surface for commands that need stdin.

## Completion contract

The server waits for the started session to reach `completed`, `failed`, `cancelled`, `timed_out`, or `interrupted`. It returns the durable session ID, state, exit code, summary, bounded ordered event list, and working-directory identity to the model as the tool result. If the model request is aborted, the active local session is cancelled and the tool returns a stopped result.

## User-visible events

Every agent terminal call emits `terminal.started`, followed by either `terminal.completed` or `terminal.failed`. The event carries the terminal session ID as `operationId`, and the existing ToolAction surface can show the action while it is running and after it settles. The right-window extension can open the same session from history and stream its output independently.

## Boundary

This phase does not add GitHub Actions dispatch, mission-runner terminal access, background notification policy, or external execution. Those remain future work on the second execution lane.
