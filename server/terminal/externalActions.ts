import { randomUUID } from "node:crypto";
import { withWorkspaceDb, WorkspaceAccessError } from "../paradoxWorkspace";
import { cancelGithubWorkflowRun, dispatchGithubWorkflow, getGithubWorkflowRun, listGithubWorkflowArtifacts, listGithubWorkflowJobs, listGithubWorkflowRuns } from "../githubAuth";
import { externalWorkflowRequestSchema, terminalEventSchema, terminalResultSchema, type ExternalWorkflowRequest, type TerminalEvent, type TerminalResult, type TerminalState } from "./contracts";

const POLL_MS = 5_000;
const activePolls = new Map<string, ReturnType<typeof setTimeout>>();

type ExternalWorkflowSummary = { sessionId: string; requestId: string; projectId: string; repository: string; workflowId: string; ref: string; workflowRunId?: number; runUrl?: string; htmlUrl?: string; state: TerminalState; status: string; conclusion?: string | null; startedAt: string; completedAt?: string; updatedAt: string; summary: string; artifacts: Array<Record<string, unknown>> };
export type ExternalWorkflowSession = ExternalWorkflowSummary & { events: TerminalEvent[]; result?: TerminalResult };

function now() { return new Date().toISOString(); }
function terminalState(status: string, conclusion?: string | null): TerminalState {
  if (status === "queued" || status === "requested" || status === "waiting" || status === "pending") return "queued";
  if (status !== "completed") return "running";
  if (conclusion === "success") return "completed";
  if (conclusion === "cancelled" || conclusion === "canceled") return "cancelled";
  if (conclusion === "timed_out") return "timed_out";
  return "failed";
}
function isTerminal(state: TerminalState) { return ["completed", "failed", "cancelled", "timed_out", "interrupted"].includes(state); }
function mapRow(row: Record<string, unknown>): ExternalWorkflowSummary {
  return { sessionId: String(row.id), requestId: String(row.request_id), projectId: String(row.project_id), repository: String(row.repository), workflowId: String(row.workflow_id), ref: String(row.ref), ...(row.workflow_run_id ? { workflowRunId: Number(row.workflow_run_id) } : {}), ...(row.run_url ? { runUrl: String(row.run_url) } : {}), ...(row.html_url ? { htmlUrl: String(row.html_url) } : {}), state: row.state as TerminalState, status: String(row.github_status || "queued"), conclusion: row.conclusion === null ? null : row.conclusion ? String(row.conclusion) : null, startedAt: String(row.started_at), ...(row.completed_at ? { completedAt: String(row.completed_at) } : {}), updatedAt: String(row.updated_at), summary: String(row.summary), artifacts: row.artifacts_json ? JSON.parse(String(row.artifacts_json)) as Array<Record<string, unknown>> : [] };
}
async function rowFor(ownerId: string, sessionId: string) { return withWorkspaceDb(false, (db) => db.execute("SELECT id, request_id, project_id, repository, workflow_id, ref, workflow_run_id, run_url, html_url, state, github_status, conclusion, started_at, completed_at, updated_at, summary, artifacts_json FROM workspace_terminal_external_runs WHERE id = ? AND owner_id = ? LIMIT 1", [sessionId, ownerId]).rows[0] as Record<string, unknown> | undefined); }
async function eventsFor(ownerId: string, sessionId: string) {
  const rows = await withWorkspaceDb(false, (db) => db.execute("SELECT sequence, kind, state, text, input, metric_json, artifact_id, metadata_json, occurred_at FROM workspace_terminal_events WHERE session_id = ? AND owner_id = ? ORDER BY sequence ASC", [sessionId, ownerId]).rows as Array<Record<string, unknown>>);
  return rows.map((row) => terminalEventSchema.parse({ sequence: Number(row.sequence), kind: row.kind, state: row.state || undefined, text: row.text || undefined, input: row.input || undefined, metric: row.metric_json ? JSON.parse(String(row.metric_json)) : undefined, artifactId: row.artifact_id || undefined, metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : undefined, occurredAt: row.occurred_at }));
}
async function sessionFor(ownerId: string, sessionId: string): Promise<ExternalWorkflowSession> { const row = await rowFor(ownerId, sessionId); if (!row) throw new WorkspaceAccessError("External terminal session not found."); const summary = mapRow(row); const events = await eventsFor(ownerId, sessionId); return { ...summary, events, ...(row.result_json ? { result: JSON.parse(String(row.result_json)) as TerminalResult } : {}) }; }
async function event(ownerId: string, sessionId: string, next: { kind: "status" | "log" | "artifact"; state?: TerminalState; text?: string; artifactId?: string; metadata?: Record<string, string> }) { await withWorkspaceDb(true, (db) => { const latest = db.execute("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM workspace_terminal_events WHERE session_id = ? AND owner_id = ?", [sessionId, ownerId]).rows[0] as { sequence?: number }; const sequence = Number(latest?.sequence || 0) + 1; db.execute("INSERT INTO workspace_terminal_events (id, session_id, owner_id, sequence, kind, state, text, input, metric_json, artifact_id, metadata_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)", [randomUUID(), sessionId, ownerId, sequence, next.kind, next.state || null, next.text || null, next.artifactId || null, next.metadata ? JSON.stringify(next.metadata) : null, now()]); }); }
async function updateRun(ownerId: string, sessionId: string) {
  const current = await rowFor(ownerId, sessionId); if (!current || !current.workflow_run_id) return sessionFor(ownerId, sessionId);
  const run = await getGithubWorkflowRun(ownerId, String(current.repository), Number(current.workflow_run_id));
  const status = typeof run.status === "string" ? run.status : "unknown"; const conclusion = typeof run.conclusion === "string" ? run.conclusion : null; const state = terminalState(status, conclusion); const updatedAt = now();
  await withWorkspaceDb(true, (db) => db.execute("UPDATE workspace_terminal_external_runs SET state = ?, github_status = ?, conclusion = ?, completed_at = ?, updated_at = ?, summary = ? WHERE id = ? AND owner_id = ?", [state, status, conclusion, isTerminal(state) ? updatedAt : null, updatedAt, isTerminal(state) ? `GitHub Actions ${conclusion || status}.` : `GitHub Actions run is ${status}.`, sessionId, ownerId]));
  await event(ownerId, sessionId, { kind: "status", state, text: `GitHub Actions: ${status}${conclusion ? ` (${conclusion})` : ""}.`, metadata: { status, ...(conclusion ? { conclusion } : {}) } });
  if (isTerminal(state)) {
    const artifacts = await listGithubWorkflowArtifacts(ownerId, String(current.repository), Number(current.workflow_run_id)).catch(() => ({ artifacts: [] })).then((result) => result.artifacts);
    await withWorkspaceDb(true, (db) => db.execute("UPDATE workspace_terminal_external_runs SET artifacts_json = ?, updated_at = ? WHERE id = ? AND owner_id = ?", [JSON.stringify(artifacts), now(), sessionId, ownerId]));
    for (const artifact of artifacts) await event(ownerId, sessionId, { kind: "artifact", state, text: `Artifact: ${artifact.name}`, artifactId: String(artifact.id), metadata: { name: String(artifact.name), ...(artifact.archiveDownloadUrl ? { url: String(artifact.archiveDownloadUrl) } : {}) } });
    activePolls.delete(sessionId);
  } else {
    activePolls.set(sessionId, setTimeout(() => { void updateRun(ownerId, sessionId).catch(() => undefined); }, POLL_MS));
  }
  return sessionFor(ownerId, sessionId);
}

export async function startExternalWorkflow(ownerId: string, projectId: string, rawRequest: unknown): Promise<ExternalWorkflowSession> {
  const request = externalWorkflowRequestSchema.parse(rawRequest);
  if (!projectId.trim()) throw new WorkspaceAccessError("Select a project before starting an external workflow.");
  const sessionId = randomUUID(); const requestId = randomUUID(); const startedAt = now(); const repository = `${request.owner}/${request.repository}`;
  const dispatch = await dispatchGithubWorkflow(ownerId, { fullName: repository, workflowId: request.workflowId, ref: request.ref, inputs: request.inputs });
  let workflowRunId = dispatch.workflowRunId;
  if (!workflowRunId) {
    const recent = await listGithubWorkflowRuns(ownerId, repository);
    const match = recent.runs.find((run) => run.workflowId === Number(request.workflowId) && run.branch === request.ref);
    workflowRunId = match?.id;
  }
  await withWorkspaceDb(true, (db) => {
    db.execute("INSERT INTO workspace_terminal_external_runs (id, request_id, owner_id, project_id, repository, workflow_id, ref, workflow_run_id, run_url, html_url, state, github_status, conclusion, inputs_json, strategy_json, started_at, completed_at, updated_at, summary, artifacts_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, 'GitHub Actions workflow dispatched.', '[]')", [sessionId, requestId, ownerId, projectId, repository, request.workflowId, request.ref, workflowRunId || null, dispatch.runUrl || null, dispatch.htmlUrl || null, workflowRunId ? "queued" : "starting", workflowRunId ? "queued" : "dispatch_accepted", JSON.stringify(request.inputs), JSON.stringify(request.strategy || null), startedAt, startedAt]);
  });
  await event(ownerId, sessionId, { kind: "status", state: workflowRunId ? "queued" : "starting", text: workflowRunId ? `Dispatched ${request.workflowId} on ${request.ref}.` : "Dispatch accepted; waiting for GitHub to publish the run.", metadata: { repository, workflowId: request.workflowId, ref: request.ref } });
  if (workflowRunId) void updateRun(ownerId, sessionId).catch(() => undefined);
  return sessionFor(ownerId, sessionId);
}
export async function getExternalWorkflow(ownerId: string, sessionId: string) { return sessionFor(ownerId, sessionId); }
export async function listExternalWorkflows(ownerId: string, projectId?: string, limit = 50): Promise<ExternalWorkflowSummary[]> { const bounded = Math.max(1, Math.min(200, Math.floor(limit))); return withWorkspaceDb(false, (db) => db.execute(`SELECT id, request_id, project_id, repository, workflow_id, ref, workflow_run_id, run_url, html_url, state, github_status, conclusion, started_at, completed_at, updated_at, summary, artifacts_json FROM workspace_terminal_external_runs WHERE owner_id = ? ${projectId ? "AND project_id = ?" : ""} ORDER BY updated_at DESC LIMIT ?`, projectId ? [ownerId, projectId, bounded] : [ownerId, bounded]).rows as Array<Record<string, unknown>>).then((rows) => rows.map(mapRow)); }
export async function cancelExternalWorkflow(ownerId: string, sessionId: string) { const current = await sessionFor(ownerId, sessionId); if (!current.workflowRunId || isTerminal(current.state)) return current; await cancelGithubWorkflowRun(ownerId, current.repository, current.workflowRunId); await withWorkspaceDb(true, (db) => db.execute("UPDATE workspace_terminal_external_runs SET state = 'running', github_status = 'cancellation_requested', updated_at = ?, summary = ? WHERE id = ? AND owner_id = ?", [now(), "Cancellation requested from Nexuss Terminal.", sessionId, ownerId])); await event(ownerId, sessionId, { kind: "status", state: "running", text: "Cancellation requested from GitHub Actions." }); return sessionFor(ownerId, sessionId); }
export async function refreshExternalWorkflow(ownerId: string, sessionId: string) { return updateRun(ownerId, sessionId); }
