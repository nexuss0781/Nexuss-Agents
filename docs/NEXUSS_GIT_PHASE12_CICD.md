# Nexuss-Git Phase 12: CI/CD Status and Workflow Logs

## Delivered behavior

Nexuss-Git now has a CI/CD data layer for the selected repository. It reads recent GitHub Actions workflow runs, exposes normalized job and step status, and retrieves bounded text logs for an individual job. The Activity surface is isolated in `NexussGitCIPanel` so workflow queries do not complicate the main repository workspace.

The current panel provides safe repository and loading states and keeps the read-only boundary clear. It does not rerun, cancel, approve, or dispatch workflows. Those are write operations and require a later explicit safety design.

## Server contract

The central Nexuss Auth service provides the following project-scoped routes:

| Route | Purpose | Bound |
|---|---|---|
| `GET /v1/github/runs` | Read recent Actions workflow runs | 30 runs |
| `GET /v1/github/jobs` | Read jobs and steps for a run | 100 jobs and 100 steps per job |
| `GET /v1/github/job-logs` | Read a job’s compressed logs | 500 KB of decoded text |

Nexuss-Agent exposes these routes through `workspace.github.workflowRuns`, `workspace.github.workflowJobs`, and `workspace.github.workflowLogs`.

## Safety behavior

The server validates repository owner and name, workflow run IDs, and job IDs. GitHub authorization remains in the central server grant and is never returned to the browser. Workflow log archives are decoded server-side and returned as text only. Repository code and workflow output are rendered as text and are never executed.

Log retrieval is bounded to prevent an unusually large workflow archive from consuming the extension surface. The response includes a truncation flag when the decoded output reaches the limit.

## UI behavior

The Activity tab loads runs only when a repository is selected. A user can select a run to inspect its jobs, expand a job to inspect its steps, and load its logs. Refresh and retry controls are available for recoverable request failures. Empty repositories and repositories without Actions activity receive explicit empty states.

## Deployment dependency

The central-auth changes must be deployed before production Nexuss-Git instances can read Actions data. The endpoint implementation uses Node’s `zlib` runtime to decode GitHub’s job-log ZIP archive and therefore must remain deployed on a Node-compatible runtime.

## Verification

Nexuss-Agent TypeScript validation passed, the focused GitHub test suite passed with four tests, and the production build passed. Nexuss Auth typecheck passed and its full server suite passed with thirteen tests.
