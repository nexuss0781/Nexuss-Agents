import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { withWorkspaceDb, WorkspaceAccessError } from "../paradoxWorkspace";
import { projectWorkspacePath } from "../projectWorkspace";
import {
  TERMINAL_CONTRACT_VERSION,
  localTerminalRequestSchema,
  terminalEventSchema,
  terminalResultSchema,
  type LocalTerminalRequest,
  type TerminalEvent,
  type TerminalResult,
  type TerminalState,
} from "./contracts";

const MAX_HISTORY_EVENTS = 20_000;
const MAX_EVENT_TEXT = 100_000;
const MAX_SUMMARY_TEXT = 4_000;
const ALLOWED_SHELLS = new Set(["bash", "sh", "/bin/bash", "/bin/sh"]);

type Db = Parameters<Parameters<typeof withWorkspaceDb>[1]>[0];
type TerminalListener = (event: TerminalEvent) => void;

type RunningSession = {
  ownerId: string;
  projectId: string;
  requestId: string;
  request: LocalTerminalRequest;
  child: ChildProcessWithoutNullStreams;
  listeners: Set<TerminalListener>;
  sequence: number;
  events: TerminalEvent[];
  startedAt: string;
  requestedState?: "cancelled" | "timed_out" | "interrupted";
  finalized: boolean;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  idleTimer?: ReturnType<typeof setTimeout>;
};

export type LocalTerminalSessionSummary = {
  sessionId: string;
  requestId: string;
  projectId: string;
  state: TerminalState;
  command: string;
  workingDirectory: string;
  label?: string;
  interactive: boolean;
  processId?: number;
  exitCode?: number;
  startedAt: string;
  completedAt?: string;
  updatedAt: string;
  summary: string;
};

export type LocalTerminalSession = LocalTerminalSessionSummary & {
  events: TerminalEvent[];
  result?: TerminalResult;
};

const runningSessions = new Map<string, RunningSession>();

function terminalNow() {
  return new Date().toISOString();
}

function boundedText(value: string, max: number) {
  return value.length <= max ? value : value.slice(-max);
}

function isTerminalState(state: TerminalState) {
  return state === "completed" || state === "failed" || state === "cancelled" || state === "timed_out" || state === "interrupted";
}

function assertContained(root: string, candidate: string) {
  const rootResolved = resolve(root);
  const candidateResolved = resolve(candidate);
  const relativePath = relative(rootResolved, candidateResolved);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new WorkspaceAccessError("The terminal working directory must stay inside the selected project workspace.");
  }
  return candidateResolved;
}

async function resolveWorkingDirectory(ownerId: string, request: LocalTerminalRequest) {
  if (!request.projectId) throw new WorkspaceAccessError("Select a project before opening a local terminal.");
  const project = await withWorkspaceDb(false, (db) => {
    const row = db.execute("SELECT id, workspace_status FROM workspace_projects WHERE id = ? AND owner_id = ? LIMIT 1", [request.projectId, ownerId]).rows[0] as { id: string; workspace_status: string } | undefined;
    if (!row) throw new WorkspaceAccessError("Project not found.");
    if (row.workspace_status !== "ready") throw new WorkspaceAccessError("The selected project workspace is not ready.");
    return row;
  });
  const root = projectWorkspacePath(ownerId, project.id);
  const requested = isAbsolute(request.workingDirectory) ? request.workingDirectory : resolve(root, request.workingDirectory);
  return { projectId: project.id, root, workingDirectory: assertContained(root, requested) };
}

function shellFor(request: LocalTerminalRequest) {
  if (!ALLOWED_SHELLS.has(request.shell)) throw new WorkspaceAccessError("Only the supported workspace shells can be used by the local terminal.");
  return request.shell;
}

function killProcess(child: ChildProcessWithoutNullStreams) {
  if (!child.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch { /* The process may have already exited. */ }
  }
  setTimeout(() => {
    try {
      if (process.platform !== "win32") process.kill(-child.pid!, "SIGKILL");
      else child.kill("SIGKILL");
    } catch { /* The process may have already exited. */ }
  }, 1_000).unref();
}

function insertSession(db: Db, input: { sessionId: string; requestId: string; ownerId: string; projectId: string; request: LocalTerminalRequest; workingDirectory: string; startedAt: string }) {
  db.execute(
    "INSERT INTO workspace_terminal_sessions (id, request_id, owner_id, project_id, lane, state, command, shell, working_directory, label, interactive, timeout_ms, idle_timeout_ms, process_id, exit_code, summary, result_json, started_at, completed_at, updated_at) VALUES (?, ?, ?, ?, 'local', 'starting', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, NULL, ?)",
    [input.sessionId, input.requestId, input.ownerId, input.projectId, input.request.command, input.request.shell, input.workingDirectory, input.request.label || null, input.request.interactive ? 1 : 0, input.request.timeout.timeoutMs, input.request.timeout.idleTimeoutMs || null, "Starting local terminal session.", input.startedAt, input.startedAt],
  );
}

function updateSession(db: Db, sessionId: string, ownerId: string, patch: { state?: TerminalState; processId?: number | null; exitCode?: number | null; summary?: string; resultJson?: string; completedAt?: string | null; updatedAt?: string }) {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.state !== undefined) { fields.push("state = ?"); values.push(patch.state); }
  if (patch.processId !== undefined) { fields.push("process_id = ?"); values.push(patch.processId); }
  if (patch.exitCode !== undefined) { fields.push("exit_code = ?"); values.push(patch.exitCode); }
  if (patch.summary !== undefined) { fields.push("summary = ?"); values.push(boundedText(patch.summary, MAX_SUMMARY_TEXT)); }
  if (patch.resultJson !== undefined) { fields.push("result_json = ?"); values.push(patch.resultJson); }
  if (patch.completedAt !== undefined) { fields.push("completed_at = ?"); values.push(patch.completedAt); }
  fields.push("updated_at = ?"); values.push(patch.updatedAt || terminalNow());
  values.push(sessionId, ownerId);
  db.execute(`UPDATE workspace_terminal_sessions SET ${fields.join(", ")} WHERE id = ? AND owner_id = ?`, values);
}

function insertEvent(db: Db, ownerId: string, sessionId: string, event: TerminalEvent) {
  db.execute(
    "INSERT INTO workspace_terminal_events (id, session_id, owner_id, sequence, kind, state, text, input, metric_json, artifact_id, metadata_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [randomUUID(), sessionId, ownerId, event.sequence, event.kind, event.state || null, event.text || null, event.input || null, event.metric ? JSON.stringify(event.metric) : null, event.artifactId || null, event.metadata ? JSON.stringify(event.metadata) : null, event.occurredAt],
  );
}

async function persistEvent(ownerId: string, sessionId: string, event: TerminalEvent) {
  await withWorkspaceDb(true, (db) => insertEvent(db, ownerId, sessionId, event));
}

function createEvent(session: RunningSession, input: Omit<TerminalEvent, "sequence" | "occurredAt">): TerminalEvent {
  const event = terminalEventSchema.parse({ ...input, sequence: session.sequence++, occurredAt: terminalNow() });
  if (session.events.length >= MAX_HISTORY_EVENTS) session.events.shift();
  session.events.push(event);
  for (const listener of session.listeners) listener(event);
  void persistEvent(session.ownerId, session.requestId, event).catch(() => undefined);
  return event;
}

function resetIdleTimer(session: RunningSession) {
  if (!session.request.timeout.idleTimeoutMs) return;
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    if (!session.finalized) {
      session.requestedState = "timed_out";
      createEvent(session, { kind: "status", state: "timed_out", text: "Local terminal idle timeout reached." });
      killProcess(session.child);
    }
  }, session.request.timeout.idleTimeoutMs);
  session.idleTimer.unref?.();
}

async function finalizeSession(session: RunningSession, code: number | null, signal: NodeJS.Signals | null) {
  if (session.finalized) return;
  session.finalized = true;
  if (session.timeoutTimer) clearTimeout(session.timeoutTimer);
  if (session.idleTimer) clearTimeout(session.idleTimer);
  const state: TerminalState = session.requestedState || (code === 0 ? "completed" : "failed");
  const completedAt = terminalNow();
  const summary = state === "completed" ? "Local terminal command completed." : state === "cancelled" ? "Local terminal command was cancelled." : state === "timed_out" ? "Local terminal command timed out." : `Local terminal command failed${signal ? ` with signal ${signal}` : code !== null ? ` with exit code ${code}` : "."}`;
  createEvent(session, { kind: "status", state, text: summary });
  const result = terminalResultSchema.parse({
    contractVersion: TERMINAL_CONTRACT_VERSION,
    requestId: session.requestId,
    lane: "local",
    state,
    ...(code === null ? {} : { exitCode: code }),
    summary,
    events: session.events.slice(-MAX_HISTORY_EVENTS),
    artifacts: [],
    identity: { sessionId: session.requestId, ...(session.child.pid ? { processId: session.child.pid } : {}), workingDirectory: session.request.workingDirectory },
    startedAt: session.startedAt,
    completedAt,
    timeout: session.request.timeout,
    triggeredRules: [],
  });
  await withWorkspaceDb(true, (db) => updateSession(db, session.requestId, session.ownerId, {
    state,
    processId: session.child.pid || null,
    exitCode: code,
    summary,
    resultJson: JSON.stringify(result),
    completedAt,
  }));
  runningSessions.delete(session.requestId);
}

function attachProcess(session: RunningSession) {
  const child = session.child;
  child.stdout.on("data", (chunk: Buffer) => {
    resetIdleTimer(session);
    createEvent(session, { kind: "stdout", state: "running", text: boundedText(chunk.toString("utf8"), MAX_EVENT_TEXT) });
  });
  child.stderr.on("data", (chunk: Buffer) => {
    resetIdleTimer(session);
    createEvent(session, { kind: "stderr", state: "running", text: boundedText(chunk.toString("utf8"), MAX_EVENT_TEXT) });
  });
  child.once("error", (error) => {
    if (!session.finalized) createEvent(session, { kind: "stderr", state: "failed", text: boundedText(error.message, MAX_EVENT_TEXT) });
  });
  child.once("close", (code, signal) => { void finalizeSession(session, code, signal); });
}

export async function startLocalTerminal(ownerId: string, rawRequest: unknown): Promise<LocalTerminalSessionSummary> {
  const request = localTerminalRequestSchema.parse(rawRequest);
  const workspace = await resolveWorkingDirectory(ownerId, request);
  const shell = shellFor(request);
  const requestId = randomUUID();
  const sessionId = requestId;
  const startedAt = terminalNow();
  const resolvedRequest = { ...request, shell, workingDirectory: workspace.workingDirectory };
  await withWorkspaceDb(true, (db) => insertSession(db, { sessionId, requestId, ownerId, projectId: workspace.projectId, request: resolvedRequest, workingDirectory: workspace.workingDirectory, startedAt }));
  const child = spawn(shell, ["-lc", request.command], {
    cwd: workspace.workingDirectory,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const session: RunningSession = { ownerId, projectId: workspace.projectId, requestId, request: resolvedRequest, child, listeners: new Set(), sequence: 0, events: [], startedAt, finalized: false };
  runningSessions.set(sessionId, session);
  await withWorkspaceDb(true, (db) => updateSession(db, sessionId, ownerId, { state: "running", processId: child.pid || null, summary: "Local terminal command is running." }));
  createEvent(session, { kind: "status", state: "running", text: "Local terminal command is running." });
  attachProcess(session);
  session.timeoutTimer = setTimeout(() => {
    if (!session.finalized) {
      session.requestedState = "timed_out";
      createEvent(session, { kind: "status", state: "timed_out", text: "Local terminal timeout reached." });
      killProcess(session.child);
    }
  }, request.timeout.timeoutMs);
  session.timeoutTimer.unref?.();
  resetIdleTimer(session);
  return {
    sessionId,
    requestId,
    projectId: workspace.projectId,
    state: "running",
    command: request.command,
    workingDirectory: workspace.workingDirectory,
    ...(request.label ? { label: request.label } : {}),
    interactive: request.interactive,
    ...(child.pid ? { processId: child.pid } : {}),
    startedAt,
    updatedAt: startedAt,
    summary: "Local terminal command is running.",
  };
}

export async function sendLocalTerminalInput(ownerId: string, sessionId: string, input: string) {
  if (!input || input.length > 20_000) throw new WorkspaceAccessError("Terminal input is empty or too large.");
  const session = runningSessions.get(sessionId);
  if (!session || session.ownerId !== ownerId || session.finalized) throw new WorkspaceAccessError("The terminal session is no longer running.");
  if (!session.request.interactive) throw new WorkspaceAccessError("This terminal session was not opened for interactive input.");
  session.child.stdin.write(input);
  createEvent(session, { kind: "stdin", state: "awaiting_input", input });
  resetIdleTimer(session);
  return getLocalTerminalSession(ownerId, sessionId);
}

export async function cancelLocalTerminal(ownerId: string, sessionId: string) {
  const session = runningSessions.get(sessionId);
  if (!session || session.ownerId !== ownerId || session.finalized) throw new WorkspaceAccessError("The terminal session is no longer running.");
  session.requestedState = "cancelled";
  createEvent(session, { kind: "status", state: "cancelled", text: "Cancellation requested." });
  killProcess(session.child);
  return getLocalTerminalSession(ownerId, sessionId);
}

export function subscribeLocalTerminalSession(ownerId: string, sessionId: string, listener: TerminalListener) {
  const session = runningSessions.get(sessionId);
  if (!session || session.ownerId !== ownerId) return () => undefined;
  session.listeners.add(listener);
  return () => session.listeners.delete(listener);
}

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value || "")) as T; } catch { return fallback; }
}

function mapSummary(row: Record<string, unknown>): LocalTerminalSessionSummary {
  return {
    sessionId: String(row.id),
    requestId: String(row.request_id),
    projectId: String(row.project_id),
    state: String(row.state) as TerminalState,
    command: String(row.command),
    workingDirectory: String(row.working_directory),
    ...(row.label ? { label: String(row.label) } : {}),
    interactive: Number(row.interactive) === 1,
    ...(row.process_id ? { processId: Number(row.process_id) } : {}),
    ...(row.exit_code === null || row.exit_code === undefined ? {} : { exitCode: Number(row.exit_code) }),
    startedAt: String(row.started_at),
    ...(row.completed_at ? { completedAt: String(row.completed_at) } : {}),
    updatedAt: String(row.updated_at),
    summary: String(row.summary || ""),
  };
}

export async function getLocalTerminalSession(ownerId: string, sessionId: string): Promise<LocalTerminalSession> {
  return withWorkspaceDb(false, (db) => {
    const row = db.execute("SELECT id, request_id, project_id, state, command, working_directory, label, interactive, process_id, exit_code, started_at, completed_at, updated_at, summary, result_json FROM workspace_terminal_sessions WHERE id = ? AND owner_id = ? LIMIT 1", [sessionId, ownerId]).rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new WorkspaceAccessError("Terminal session not found.");
    const events = db.execute("SELECT sequence, kind, state, text, input, metric_json, artifact_id, metadata_json, occurred_at FROM workspace_terminal_events WHERE session_id = ? AND owner_id = ? ORDER BY sequence ASC LIMIT ?", [sessionId, ownerId, MAX_HISTORY_EVENTS]).rows.map((value) => {
      const event = value as Record<string, unknown>;
      return terminalEventSchema.parse({ sequence: Number(event.sequence), kind: String(event.kind), ...(event.state ? { state: String(event.state) } : {}), ...(event.text ? { text: String(event.text) } : {}), ...(event.input ? { input: String(event.input) } : {}), ...(event.metric_json ? { metric: parseJson(event.metric_json, undefined) } : {}), ...(event.artifact_id ? { artifactId: String(event.artifact_id) } : {}), ...(event.metadata_json ? { metadata: parseJson(event.metadata_json, undefined) } : {}), occurredAt: String(event.occurred_at) });
    });
    return { ...mapSummary(row), events, ...(row.result_json ? { result: parseJson<TerminalResult | undefined>(row.result_json, undefined) } : {}) };
  });
}

export async function runLocalTerminalForAgent(ownerId: string, rawRequest: unknown, signal: AbortSignal, onStarted?: (session: Pick<LocalTerminalSessionSummary, "sessionId">) => void): Promise<LocalTerminalSession> {
  const started = await startLocalTerminal(ownerId, rawRequest);
  const sessionId = started.sessionId;
  onStarted?.(started);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const terminal = (state: TerminalState) => state === "completed" || state === "failed" || state === "cancelled" || state === "timed_out" || state === "interrupted";
  const cancelOnAbort = () => { void cancelLocalTerminal(ownerId, sessionId).catch(() => undefined); };
  if (signal.aborted) cancelOnAbort();
  signal.addEventListener("abort", cancelOnAbort, { once: true });
  try {
    return await new Promise<LocalTerminalSession>((resolvePromise, rejectPromise) => {
      const finish = (value: LocalTerminalSession) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolvePromise(value);
      };
      const poll = async () => {
        try {
          const current = await getLocalTerminalSession(ownerId, sessionId);
          if (terminal(current.state) || signal.aborted) {
            if (signal.aborted && !terminal(current.state)) { cancelOnAbort(); timer = setTimeout(poll, 75); return; }
            finish(current);
            return;
          }
          timer = setTimeout(poll, 100);
        } catch (error) {
          if (!settled) { settled = true; rejectPromise(error); }
        }
      };
      void poll();
    });
  } finally {
    signal.removeEventListener("abort", cancelOnAbort);
    if (timer) clearTimeout(timer);
  }
}

export async function listLocalTerminalSessions(ownerId: string, projectId?: string, limit = 50): Promise<LocalTerminalSessionSummary[]> {
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  return withWorkspaceDb(false, (db) => db.execute(
    `SELECT id, request_id, project_id, state, command, working_directory, label, interactive, process_id, exit_code, started_at, completed_at, updated_at, summary FROM workspace_terminal_sessions WHERE owner_id = ? ${projectId ? "AND project_id = ?" : ""} ORDER BY updated_at DESC LIMIT ?`,
    projectId ? [ownerId, projectId, boundedLimit] : [ownerId, boundedLimit],
  ).rows.map((value) => mapSummary(value as Record<string, unknown>)));
}

export function activeLocalTerminalSessionIds(ownerId: string) {
  return Array.from(runningSessions.entries()).filter(([, session]) => session.ownerId === ownerId && !session.finalized).map(([sessionId]) => sessionId);
}
