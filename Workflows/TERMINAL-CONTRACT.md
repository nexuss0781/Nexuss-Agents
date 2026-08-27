# Nexuss Terminal Contract

**Contract version:** `1.0.0`

Nexuss Terminal is one extension with two execution lanes. The `local` lane serves fast workspace commands and interactive engineering work. The `github_actions` lane represents a durable external workflow run for multi-job, platform-specific, or long-running computation.

## Contract layers

| Layer | Contract | Purpose |
|---|---|---|
| Request | `TerminalRequest` | Describes a local command or external workflow dispatch. |
| Lifecycle | `TerminalState` | Gives both lanes a common run state vocabulary. |
| Event | `TerminalEvent` | Preserves ordered stdout, stderr, input, status, heartbeat, metric, log, and artifact observations. |
| Monitoring | `TerminalMonitoringRule` | Describes heartbeat, metric, error-pattern, job-failure, and custom-status reactions. |
| Result | `TerminalResult` | Captures the durable final record, identity, events, artifacts, timeout, and triggered rules. |

## Local lane

A local request identifies an optional Nexuss project, a working directory, a command, a shell, interactivity, a timeout, and a human-readable label. The future local adapter must return a `LocalTerminalIdentity` with a durable session ID and must preserve ordered output and input events.

Local work is intended for cloning, scaffolding, dependency installation, file inspection, tests, builds, formatting, and interactive diagnosis.

## GitHub Actions lane

An external request identifies the repository owner, repository, workflow file or numeric workflow ID, Git ref, dispatch inputs, optional matrix strategy, timeout, monitoring rules, and a label. Dispatch inputs are string-valued and are capped at 25 properties to match GitHub’s documented workflow-dispatch API. [1]

The future external adapter must persist the returned workflow run ID and URLs, then add job IDs, status events, logs, and artifacts as they become available. GitHub exposes workflow-run operations for viewing, cancellation, reruns, and logs. [2]

## Multi-job and monitoring behavior

The `WorkflowStrategy` contract supports matrix dimensions, include/exclude entries, maximum parallel jobs, and fail-fast behavior. The request does not attempt to invent a job graph from arbitrary text; a future adapter or workflow template must translate these fields into a repository-owned workflow configuration.

Monitoring rules are declarative. A workflow that wants training divergence or health-based stopping must emit metric, heartbeat, or custom-status events. Nexuss evaluates those observations against the declared rules and records any triggered rule in the final result.

## Evidence requirements

Every execution must preserve the request ID, exact command or workflow identity, repository/ref when applicable, timeout, ordered events, final state, exit code when available, completion time, artifact references, and a concise summary. Raw output can be large; the durable result should retain bounded summaries and references while the extension can stream the live view.

## Sources

[1]: https://docs.github.com/en/rest/actions/workflows
[2]: https://docs.github.com/en/rest/actions/workflow-runs
