# Nexuss Terminal External GitHub Actions Contract

## Purpose

The External lane dispatches an existing repository workflow to GitHub Actions when work needs hosted runners, multiple jobs, a matrix, Windows or macOS, long execution, or monitoring that should continue after the Nexuss workspace is closed. The Local lane remains the fast path for repository inspection, editing, cloning, and daily commands.

## Request

An external request contains the GitHub owner, repository, workflow ID or YAML filename, branch or tag reference, up to 25 string inputs, an optional matrix strategy, timeout and idle-timeout policy, monitoring rules, and a user-facing label. The request is authenticated through the connected GitHub grant already stored by Nexuss Auth.

## Lifecycle

| Stage | Terminal state | Stored evidence |
|---|---|---|
| Request accepted | `queued` | Request, owner, repository, workflow, ref, inputs |
| GitHub dispatch acknowledged | `starting` | Workflow run ID and URLs |
| Run exists but is not finished | `running` | Status snapshots, job summaries, metrics |
| GitHub reports success | `completed` | Conclusion, jobs, artifacts, timestamps |
| GitHub reports failure or cancellation | `failed` / `cancelled` | Conclusion, failed jobs, logs URL |
| Nexuss timeout or rule trigger | `timed_out` / `interrupted` | Triggered rule and cancellation result |

GitHub’s dispatch endpoint returns the workflow run identity. The service then polls the run, jobs, and artifacts endpoints at a bounded interval. Polling is scoped to an active session and stops at a terminal state, timeout, cancellation, or request shutdown. The durable record allows the UI to reopen history and refresh a completed run later.

## Monitoring rules

The first implementation supports the existing typed rule vocabulary: missing heartbeat, metric threshold, error pattern, job failure, and custom status. Job failure and timeout are evaluated directly from GitHub status. Rules that need workflow-emitted metrics or custom status are recorded for the next workflow adapter iteration and do not silently invent data.

## Cancellation

A user can cancel a queued or running run. The service calls GitHub’s cancel-run endpoint, records the request immediately, continues polling until GitHub confirms the terminal conclusion, and never deletes the run or its artifacts as part of cancellation.

## Artifacts and logs

Completed runs expose GitHub artifact metadata and stable GitHub URLs. Logs remain on GitHub and are loaded on demand; the Nexuss record stores bounded summaries and links rather than copying unbounded logs into the encrypted workspace.

## Authentication boundary

Nexuss-Agent uses the existing central Nexuss Auth GitHub grant. The current central proxy already supports repository, workflow-run, job, and job-log reads, but it does not yet expose workflow listing, dispatch, cancellation, or artifact routes. The External lane therefore adds these narrowly scoped proxy operations to Nexuss Auth before enabling real dispatch; no GitHub personal token is placed in Nexuss-Agent or the browser.

## Acceptance criteria

The lane is complete when a connected user can select a repository and workflow, submit a ref and inputs, see a durable run record, watch status and job updates, cancel an active run, inspect artifacts, reopen history, and receive a clear configuration or permission error when the central GitHub authorization is missing or insufficient. Local Terminal behavior must remain unchanged.
