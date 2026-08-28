# Nexuss Terminal: Remaining Phases and Next-Agent Handoff

## Purpose

This document is the continuation plan for completing Nexuss Terminal from the current shipped state. The next agent should read this document before changing Terminal, follow the phases in order, validate every phase, commit each coherent milestone, and push to the correct remote branch.

The objective is to finish a real workstation capability with one right-window Terminal extension and two execution lanes:

- **Local lane:** agent-owned shell execution inside the active Nexuss project workspace.
- **External lane:** GitHub Actions execution for long-running, multi-job, platform-specific, hosted, and artifact-producing work.

The user’s intended architecture is explicit:

> The agent executes. The Terminal extension monitors.

The workbench is not a second command console for agent-owned sessions. A Terminal action card in the conversation opens the exact related session or workflow in the right-window extension for read-only observation.

---

## Current state at handoff

The following work is already implemented and pushed in `nexuss0781/Nexuss-Agents`:

| Capability | Current state | Main implementation |
|---|---|---|
| Versioned Terminal contracts | Shipped | `server/terminal/contracts.ts` |
| Local durable process sessions | Shipped | `server/terminal/localSessionManager.ts` |
| Local persistence | Shipped | `workspace_terminal_sessions`, `workspace_terminal_events` in `server/paradoxWorkspace.ts` |
| Local tRPC API | Shipped | `workspace.terminal.local.start/list/get/input/cancel` |
| Local live stream | Shipped | `GET /api/terminal/local/:sessionId/events` |
| Local Terminal extension | Shipped | `client/src/components/TerminalApp.tsx` |
| General Build Local Terminal tool | Shipped | `server/paradoxWorkspace.ts` and agent runtime integration |
| Agent action session identity | Shipped | Terminal `operationId` is emitted as soon as the session starts |
| Action-card navigation | Shipped | `client/src/components/ToolActionCard.tsx`, `Home.tsx` |
| Read-only agent monitoring | Shipped | Terminal extension defaults to read-only agent monitoring |
| External GitHub Actions service | Shipped | `server/terminal/externalActions.ts` |
| External persistence | Shipped | External session/run table in `server/paradoxWorkspace.ts` |
| External tRPC API | Shipped | workflow discovery, dispatch, get, refresh, cancel |
| Nexuss Auth Actions proxy | Shipped in source | Central Auth repository; deployment still needs verification |
| External lane UI | Shipped | External workflow selection, dispatch, status, cancellation, artifacts |
| Terminal skill | Shipped | `Skills/Tools/Terminal.md` |
| Terminal contract documentation | Shipped | `Workflows/TERMINAL-CONTRACT.md` |
| External contract documentation | Shipped | `Workflows/TERMINAL-EXTERNAL-CONTRACT.md` |

The latest Nexuss-Agent Terminal skill rewrite is commit `fb717bf` on `master`. The preceding Terminal monitoring integration is commit `afc7c1f`. The External lane source was pushed in commit `99dfe3a`. The central Nexuss Auth Actions proxy was pushed separately to its `main` branch in commit `bb10194`.

The source is not the same as production verification. A real connected production session and a real GitHub Actions dispatch have not yet been completed. That is the first remaining phase.

---

## Repositories and boundaries

Work in the correct repository for the correct concern:

| Repository | Use | Branch |
|---|---|---|
| `/home/ubuntu/Nexuss-Agents` | Nexuss workspace, Terminal extension, agent runtime, persistence, tRPC, tests, skill documentation | `master` |
| `/home/ubuntu/nexuss-auth-inspect` | Read-only/working copy of central Nexuss Auth when Auth proxy changes are necessary | `main` |
| `/home/ubuntu/nexuss-git` | Separate Nexuss-Git product repository | Do not modify for Terminal work |

Do not place Terminal implementation in Nexuss-Git. Do not commit changes from `/home/ubuntu/nexuss-git` while working on this roadmap.

Use the required Git identity for Nexuss-Agent commits:

```bash
git -c user.name='tadiyos' -c user.email='tadiy0781@gmail.com' commit -m 'meaningful message'
```

Push Nexuss-Agent with:

```bash
git push origin master
```

If the central Auth proxy must change, review and test that repository separately, commit it with the same identity, and push `origin main` from the Auth repository.

---

# Phase 6 — Production deployment verification

## Objective

Verify that the source already pushed to Nexuss-Agent and Nexuss Auth is actually deployed and that a real connected user can discover and dispatch a safe GitHub Actions workflow from the External lane.

This phase is incomplete until one controlled `workflow_dispatch` run has been observed from the production Nexuss-Agent UI.

## Preconditions

Confirm all of the following before dispatching:

1. Nexuss-Agent production is serving the latest Terminal UI and backend.
2. Nexuss Auth production is serving the Actions proxy routes.
3. The user is authenticated in the production browser session.
4. GitHub is connected for that user.
5. The target repository contains a safe workflow with `workflow_dispatch`.
6. The test workflow is inexpensive and does not deploy, delete, publish, or modify production resources.

Production URLs:

```text
Nexuss-Agent: https://nexuss-agent.onrender.com
Nexuss Auth:   https://nexuss-auth.vercel.app
```

## Verification sequence

Open the production login route:

```text
https://nexuss-agent.onrender.com/login
```

Sign in with the account that owns or can access the test repository. Confirm that successful authentication redirects to `/app`.

Open the right-window drawer, choose **Terminal**, then open the **External** lane. Select a repository and confirm that the workflow dropdown loads workflow files. Select a branch or ref and verify that dispatch becomes available.

Use a small workflow similar to this for the controlled test:

```yaml
name: Nexuss external verification

on:
  workflow_dispatch:
    inputs:
      message:
        description: Verification message
        required: true
        default: Nexuss external lane verified

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - name: Print verification message
        run: echo "${{ inputs.message }}"
```

Dispatch it and observe the complete lifecycle:

```text
queued → in_progress → completed/success
```

Verify that the UI shows the run in history after reopening the extension. Record the repository, workflow, ref, run ID, final status, workflow URL, and any artifact metadata.

## Failure interpretation

| Observation | Likely boundary |
|---|---|
| Login returns to `/login` | Nexuss-Agent auth handoff or deployment configuration |
| GitHub connection is missing | User grant or central Auth configuration |
| Repository list is empty | GitHub grant token or Auth repository proxy |
| Workflow list is empty | Repository has no discoverable workflow or Actions proxy is not deployed |
| `401` or `403` from Actions calls | Auth grant scope, proxy authorization, or production environment configuration |
| Dispatch succeeds but no run is visible | GitHub publication delay or run lookup logic |
| External tab is missing | Nexuss-Agent deployment is older than the External lane commit |
| Run appears but never refreshes | polling, server lifecycle, or persistence issue |

Do not claim this phase is complete based only on a successful local build. It requires direct production UI evidence.

## Completion evidence

Save a short verification note in `Workflows/` containing:

- deployment commit identifiers;
- date and time of the test;
- repository and workflow used;
- run ID and URL;
- observed status transitions;
- final conclusion;
- any missing configuration.

Do not store access tokens in the verification note.

---

# Phase 7 — External run reliability hardening

## Objective

Make External runs reliable across delayed GitHub responses, Nexuss server restarts, duplicate requests, browser closure, and delayed run-ID publication.

## Deliverables

Implement the following behavior:

1. **Delayed run discovery.** After workflow dispatch returns, poll for the newly created run using repository, workflow, ref, and a dispatch-time boundary. Do not assume that a run ID is immediately available.
2. **Restart-safe monitoring.** A server restart must not lose the durable External session. A subsequent `get` or `refresh` should reconstruct the current GitHub state.
3. **Polling ownership.** Ensure polling is bounded and does not create uncontrolled duplicate timers when the same session is opened in multiple UI components.
4. **Idempotent refresh.** Repeated refresh requests must update the same session and must not duplicate events.
5. **Terminal state handling.** Treat `queued`, `in_progress`, `completed`, `success`, `failure`, `cancelled`, `timed_out`, and `interrupted` distinctly according to the contracts.
6. **Timeout handling.** When a custom monitoring timeout expires, persist a timeout result and stop polling without falsely claiming GitHub completed.
7. **Cancellation convergence.** Record the cancellation request, then continue checking until GitHub confirms the final cancelled state or a clear failure is returned.
8. **Duplicate dispatch protection.** Give the user and agent enough identity to distinguish a new run from an older run for the same workflow and ref.
9. **Error retention.** Persist the last provider error and the most recent successful snapshot so the monitor remains useful after a transient error.

## Tests

Add focused tests for:

- dispatch with delayed run publication;
- refresh after a simulated server restart;
- duplicate event sequence handling;
- polling timer cleanup;
- cancellation confirmation;
- timeout result persistence;
- provider error followed by successful refresh;
- two refreshes producing one durable session history.

Run at minimum:

```bash
npx vitest run server/terminal/contracts.test.ts server/terminal/localSessionManager.test.ts server/terminal/externalActions.test.ts
npm run check
git diff --check
npm run build
```

## Exit criteria

Phase 7 is complete when a delayed or interrupted External monitoring session can be reopened and reaches the correct final state without duplicate events or false success.

---

# Phase 8 — Full workflow and job visibility

## Objective

Expose enough detail for the agent and user to understand not only whether a workflow completed, but which jobs and steps produced that result.

## Deliverables

Extend the External lane to show:

- workflow name and path;
- run ID, ref, actor, created time, started time, updated time, and completion time;
- overall status and conclusion;
- expandable jobs list;
- each job’s runner name and operating system;
- job status and conclusion;
- failed job and step emphasis;
- workflow URL;
- bounded log excerpts or links where the GitHub grant permits them;
- cancellation and timeout state;
- artifact list with name, size when available, expiration when available, and download URL.

Keep the interface compact. The right-window extension is a monitor, not a complete GitHub clone. Show the most important failure evidence first and allow the user to expand details when needed.

## Backend work

Add typed job and step snapshots to the External contract. Add proxy operations in Nexuss Auth only where the current proxy cannot retrieve the required data. Keep GitHub credentials inside Nexuss Auth.

Persist the last known job snapshot with the External session so the monitor remains useful after the run has completed.

## Tests

Add tests for:

- multiple jobs with mixed results;
- a failed step in an otherwise completed workflow;
- empty job lists while a run is queued;
- artifact metadata and absent artifacts;
- long log truncation;
- responsive rendering of a run with many jobs.

## Exit criteria

Phase 8 is complete when a failed External workflow can be diagnosed from the Terminal extension without opening GitHub, while large logs and job collections remain readable.

---

# Phase 9 — Direct agent integration for Local versus External execution

## Objective

Allow the agent runtime to choose the execution lane deliberately instead of exposing External only as a manually operated extension capability.

This is the most important remaining agentic phase.

## Required behavior

The agent should choose Local or External from the task’s operational requirements, not from arbitrary preference.

Use Local when:

- the agent is iterating on the active workspace;
- output is needed immediately;
- the command is a focused search, test, check, diagnosis, or small build;
- the next step depends on the result;
- the work is a direct project operation.

Use External when:

- the process is long-running;
- the work contains multiple jobs;
- a matrix is required;
- Windows or macOS is required;
- a clean CI environment matters;
- GitHub secrets or hosted permissions are required;
- the result produces durable artifacts;
- the run should continue beyond the current Nexuss request.

## Deliverables

1. Add an agent-facing External request schema based on the existing versioned contract.
2. Add an explicit execution-lane decision to the General Build runtime.
3. Keep Local as the default for ordinary coding assistance.
4. Require explicit repository, workflow, ref, and inputs for External execution.
5. Return a durable External session identity and emit a workbench action event immediately.
6. Allow the agent to monitor the External run and receive structured completion evidence.
7. Feed the final External result back into the agent’s continuation loop.
8. Keep the Terminal extension read-only for agent-owned runs.
9. Preserve the existing Local behavior and do not route every command through Actions.

## Agent decision record

When the agent chooses External, record a concise reason such as:

```text
External selected because the requested workflow requires a hosted multi-job matrix and produces durable artifacts.
```

When the agent chooses Local, record a concise reason such as:

```text
Local selected because the command is a focused project check whose output is needed immediately for the next edit.
```

## Tool behavior

The agent must not invent a workflow path. It should discover available workflows, verify that the selected workflow supports dispatch, and submit only the inputs the workflow accepts.

The agent must not report External success until the final GitHub conclusion is known. A dispatch acknowledgment is not a completed run.

## Tests

Add General Build tests for:

- Local selection for a focused command;
- External selection for a multi-job workflow;
- explicit lane selection when the user requests it;
- unavailable workflow handling;
- invalid input handling;
- External result continuation;
- action-card operation identity;
- read-only monitor opening for both lanes.

## Exit criteria

Phase 9 is complete when General Build can intentionally submit either a Local terminal operation or an External workflow, monitor the chosen operation, and continue from its structured result without manual intervention.

---

# Phase 10 — Notifications and artifact handling

## Objective

Make long-running External operations useful when the user is not watching the Terminal extension continuously.

## Deliverables

Add:

- completion notification state;
- failure notification state;
- cancellation notification state;
- timeout notification state;
- artifact availability notification state;
- durable artifact metadata;
- artifact links in session history;
- optional download or open actions where the connected session permits them;
- a concise completion summary suitable for the conversation;
- suppression of duplicate notifications after refresh or browser reopen.

The notification system should identify the project, repository, workflow, ref, final state, and important artifact names without dumping an entire log into the conversation.

## Artifact rules

Preserve artifact name and provider URL. Record expiration when supplied by GitHub. Do not copy large artifacts through Nexuss unless an explicit artifact-transfer feature is implemented and justified. Prefer links to the provider’s artifact download surface.

## Tests

Test:

- success with artifacts;
- success without artifacts;
- failed run with logs but no artifacts;
- cancelled run;
- repeated refresh after notification;
- browser reopen after completion;
- expired artifact metadata.

## Exit criteria

Phase 10 is complete when a user can leave a long-running run, return later, and see one clear completion result with durable artifact links.

---

# Phase 11 — Final release hardening and closure

## Objective

Close the Terminal roadmap with production-grade regression coverage, deployment documentation, and a final end-to-end verification.

## Required checks

Run the focused Terminal suite:

```bash
npx vitest run \
  server/terminal/contracts.test.ts \
  server/terminal/localSessionManager.test.ts \
  server/terminal/externalActions.test.ts \
  client/src/components/TerminalApp.test.tsx \
  client/src/components/ToolActionCard.test.tsx
```

Run project checks:

```bash
rm -f node_modules/typescript/tsbuildinfo
npm run check
git diff --check
npm run build
```

Run the relevant General and mode-routing tests. Keep the repository’s historical unrelated fixture failures separate from Terminal failures; do not hide them or attribute them to Terminal without evidence.

## Migration and persistence review

Verify that:

- existing Paradox workspaces initialize the Terminal tables correctly;
- terminal history is owner-scoped;
- project-scoped listing does not leak sessions across projects;
- Local and External records use the versioned contracts;
- old records with missing optional fields remain readable;
- server restart preserves completed session history;
- browser reopen preserves monitor state through `get` and SSE or refresh;
- no generated `dist/` output is staged.

## Security and configuration review

Confirm that:

- GitHub grant tokens remain server-side in Nexuss Auth;
- browser responses do not contain raw GitHub access tokens;
- commands remain attached to the selected project workspace;
- External inputs are passed only to the selected workflow;
- production configuration names are documented without storing secrets;
- logs do not print API keys, OAuth tokens, or authorization headers.

## Final browser verification

Complete all of these from production:

1. Sign in.
2. Open Terminal from the right-window drawer.
3. Confirm Local monitoring.
4. Trigger a General Build Local Terminal action.
5. Click its action workbench card.
6. Confirm the exact running session opens.
7. Confirm live output and final result.
8. Open External.
9. Select a repository and dispatch the controlled workflow.
10. Observe the External lifecycle.
11. Reopen the run from history.
12. Confirm jobs, final status, and artifacts.

## Final documentation

Update or add:

- production deployment notes;
- required Nexuss Auth configuration;
- GitHub workflow requirements;
- troubleshooting table;
- final Terminal architecture summary;
- current API and contract version;
- known limitations and future improvements.

Do not call the product complete until the production browser verification is recorded.

---

# Per-phase commit and push protocol

After finishing each phase:

1. Review `git status --short`.
2. Review the exact diff.
3. Exclude generated output and unrelated repositories.
4. Run the phase’s focused tests.
5. Run `npm run check` and `git diff --check`.
6. Run `npm run build` when code or production assets changed.
7. Stage only intentional files.
8. Inspect `git diff --cached --name-only`.
9. Commit with the required identity.
10. Push `origin master` for Nexuss-Agent.
11. Fetch the remote branch and verify `HEAD == origin/master`.
12. Confirm a clean working tree.
13. Record the commit hash and validation result in the phase report.

Use a meaningful commit message that names the phase or capability. Examples:

```text
Harden external terminal run monitoring
Add workflow job visibility to terminal
Connect General Build to external execution
Add terminal completion notifications
Close terminal release verification
```

If a phase requires Nexuss Auth changes, keep that commit and push separate from Nexuss-Agent. Report both commit hashes and the deployment dependency.

---

# Next agent’s first action

Start with **Phase 6 — Production deployment verification**. Do not begin Phase 7 or Phase 9 by assumption. First determine whether the latest Nexuss-Agent and Nexuss Auth commits are deployed, authenticate in production, and run one safe `workflow_dispatch` test.

If production verification is blocked by login, missing deployment, missing GitHub grant, or missing workflow, record the exact blocker and repair that boundary before adding more source code.

Once Phase 6 is directly verified, continue sequentially through Phases 7–11. Keep the Local lane stable while hardening External behavior. The final target is not merely a visible Terminal extension; it is an agent-controlled, evidence-producing execution system with a reliable read-only workbench monitor.

---

## Related repository documents

- [`Skills/Tools/Terminal.md`](../Skills/Tools/Terminal.md) — agent-facing Terminal operating skill.
- [`Skills/Tools/SKILL.md`](../Skills/Tools/SKILL.md) — central tools capability guidance.
- [`Workflows/TERMINAL-CONTRACT.md`](./TERMINAL-CONTRACT.md) — two-lane Terminal contract.
- [`Workflows/TERMINAL-EXTERNAL-CONTRACT.md`](./TERMINAL-EXTERNAL-CONTRACT.md) — External lane lifecycle.
- [`Workflows/TERMINAL-AGENT-INTEGRATION.md`](./TERMINAL-AGENT-INTEGRATION.md) — Local agent integration contract.
- [`Workflows/GITHUB-ACTIONS-API-NOTES.md`](./GITHUB-ACTIONS-API-NOTES.md) — verified Actions API implementation notes.
