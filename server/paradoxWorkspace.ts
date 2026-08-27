import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "parad";
import { composeGeneralSystemPrompt, type GeneralMode } from "./mission/generalAgentPrompt";
import type { AuditSink, FileSystemAuditEvent } from "../tools/file-system/audit";
import type { FileSystemRequest } from "../tools/file-system/types";

const execFileAsync = promisify(execFile);

export type ProjectSourceType = "none" | "upload" | "github";
export type ProjectWorkspaceStatus = "empty" | "importing" | "ready" | "failed";
export type WorkspaceProject = {
  id: string;
  name: string;
  description: string;
  tone: string;
  sourceType: ProjectSourceType;
  sourceUrl?: string;
  sourceCommit?: string;
  workspaceStatus: ProjectWorkspaceStatus;
  workspaceFileCount: number;
  workspaceBytes: number;
  workspaceUpdatedAt?: string;
  workspaceError?: string;
};
export type WorkspaceMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string };
export type WorkspaceThread = { id: string; chatSlug: string; title: string; projectId?: string; updatedAt: string; messages: WorkspaceMessage[] };
export type DurableWorkspace = { projects: WorkspaceProject[]; threads: WorkspaceThread[] };
export type WorkspaceNavigation = DurableWorkspace;
export type ModelProviderSettings = { baseUrl: string; selectedModels: string[]; availableModels: string[]; apiKeyConfigured: boolean };

export class WorkspaceAccessError extends Error {}
export class DuplicateProjectNameError extends Error {}
export class ModelProviderError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, options: { code?: string; status?: number } = {}) {
    super(message);
    this.name = "ModelProviderError";
    this.code = options.code || "MODEL_PROVIDER_ERROR";
    this.status = options.status;
  }
}

type Db = Awaited<ReturnType<typeof connect>>;
type LegacyWorkspace = { projects: Array<Pick<WorkspaceProject, "id" | "name" | "description" | "tone"> & Partial<Omit<WorkspaceProject, "id" | "name" | "description" | "tone">>>; threads: Array<Omit<WorkspaceThread, "chatSlug"> & { chatSlug?: string }> };
let workspaceOperationTail: Promise<void> = Promise.resolve();
let activeGateway: { url: string; expiresAt: number } | null = null;
let workspaceDb: Db | undefined;
let workspaceDbOpening: Promise<Db> | undefined;
let workspaceDbCloseTimer: ReturnType<typeof setTimeout> | undefined;

function persistenceConfig() {
  const apiKey = process.env.PARADOX_API_KEY;
  const passphrase = process.env.PARADOX_PASSPHRASE;
  if (!apiKey || !passphrase) throw new Error("Paradox-DB persistence is not configured");
  return { apiKey, passphrase };
}

async function resolveGatewayUrl() {
  if (activeGateway && activeGateway.expiresAt > Date.now()) return activeGateway.url;
  const configuredGateway = process.env.PARADOX_GATEWAY_URL;
  try {
    const response = await fetch("https://paradox-domain.onrender.com/active-domain.json", { signal: AbortSignal.timeout(5_000) });
    const discovery = await response.json() as { gatewayUrl?: string; ttlSeconds?: number };
    if (!response.ok || !discovery.gatewayUrl?.startsWith("https://")) throw new Error("Invalid Paradox-DB gateway discovery response");
    const url = discovery.gatewayUrl.replace(/\/+$/, "").endsWith("/v1") ? discovery.gatewayUrl.replace(/\/+$/, "") : `${discovery.gatewayUrl.replace(/\/+$/, "")}/v1`;
    activeGateway = { url, expiresAt: Date.now() + Math.max(30, discovery.ttlSeconds || 60) * 1_000 };
    return url;
  } catch {
    if (configuredGateway?.startsWith("https://")) return configuredGateway.replace(/\/+$/, "");
    throw new Error("Paradox-DB gateway discovery is unavailable");
  }
}

function now() { return new Date().toISOString(); }
function rows<T>(result: { rows: unknown[] }) { return result.rows as T[]; }
function chatSlugFor(id: string) { return `chat-${id.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`; }

function parseModelList(value: string | null | undefined, sort = false) {
  try {
    const decoded = JSON.parse(value || "[]");
    const models = Array.from(new Set(Array.isArray(decoded) ? decoded.filter((model): model is string => typeof model === "string").map((model) => model.trim()).filter(Boolean) : [])).slice(0, 500);
    return sort ? models.sort((a, b) => a.localeCompare(b)) : models;
  } catch {
    return [];
  }
}

function redactProviderDetail(value: string) {
  return value.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]").replace(/(api[_-]?key|token|secret)[=:"\s]+[A-Za-z0-9._~-]+/gi, "$1=[redacted]").slice(0, 320);
}

function providerErrorDetail(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "The provider returned no error detail.";
  try {
    const payload = JSON.parse(trimmed) as { error?: { message?: unknown; type?: unknown; code?: unknown } | string; message?: unknown; detail?: unknown };
    const error = payload.error;
    const message = typeof error === "string" ? error : error && typeof error === "object" ? error.message : payload.message ?? payload.detail;
    if (typeof message === "string" && message.trim()) return redactProviderDetail(message.trim());
  } catch {
    // Fall back to a bounded text excerpt below.
  }
  return redactProviderDetail(trimmed);
}

function normalizeProviderBaseUrl(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new ModelProviderError("Enter a valid HTTPS model API URL."); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || hostname === "localhost" || hostname.endsWith(".localhost") || /^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) || hostname === "::1") {
    throw new ModelProviderError("Use a public HTTPS model API URL.");
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

export function workspaceSyncOptions(environment: NodeJS.ProcessEnv = process.env) {
  return {
    autoSync: environment.NODE_ENV !== "test" && environment.PARADOX_TEST_DISABLE_AUTOSYNC !== "1",
    pushIntervalMs: 2_500,
    pullIntervalMs: 30_000,
  };
}

async function openWorkspaceDb() {
  if (workspaceDb) return workspaceDb;
  if (workspaceDbOpening) return workspaceDbOpening;
  workspaceDbOpening = openFreshWorkspaceDb();
  try {
    workspaceDb = await workspaceDbOpening;
    return workspaceDb;
  } finally {
    workspaceDbOpening = undefined;
  }
}

async function openFreshWorkspaceDb() {
  const config = persistenceConfig();
  const gatewayUrl = await resolveGatewayUrl();
  const syncOptions = workspaceSyncOptions();
  const db = await connect({
    name: "nexuss-agent-workspace",
    project: "nexuss-agent",
    dbPath: process.env.PARADOX_DB_PATH || join(tmpdir(), "nexuss-agent-workspace.dotdat"),
    gatewayUrl,
    apiKey: config.apiKey,
    passphrase: config.passphrase,
    autoSync: syncOptions.autoSync,
    pullOnStartup: true,
    pushIntervalMs: syncOptions.pushIntervalMs,
    pullIntervalMs: syncOptions.pullIntervalMs,
  });

  db.execute("CREATE TABLE IF NOT EXISTS workspace_projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, tone TEXT NOT NULL, source_type TEXT NOT NULL DEFAULT 'none', source_url TEXT, source_commit TEXT, workspace_status TEXT NOT NULL DEFAULT 'empty', workspace_file_count INTEGER NOT NULL DEFAULT 0, workspace_bytes INTEGER NOT NULL DEFAULT 0, workspace_updated_at TEXT, workspace_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  for (const statement of [
    "ALTER TABLE workspace_projects ADD COLUMN source_type TEXT NOT NULL DEFAULT 'none'",
    "ALTER TABLE workspace_projects ADD COLUMN source_url TEXT",
    "ALTER TABLE workspace_projects ADD COLUMN source_commit TEXT",
    "ALTER TABLE workspace_projects ADD COLUMN workspace_status TEXT NOT NULL DEFAULT 'empty'",
    "ALTER TABLE workspace_projects ADD COLUMN workspace_file_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE workspace_projects ADD COLUMN workspace_bytes INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE workspace_projects ADD COLUMN workspace_updated_at TEXT",
    "ALTER TABLE workspace_projects ADD COLUMN workspace_error TEXT",
  ]) { try { db.execute(statement); } catch { /* Existing encrypted workspaces already have this project metadata. */ } }
  db.execute("CREATE TABLE IF NOT EXISTS workspace_threads (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, chat_slug TEXT, title TEXT NOT NULL, project_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, owner_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, sequence INTEGER)");
  try { db.execute("ALTER TABLE workspace_messages ADD COLUMN sequence INTEGER"); } catch { /* Existing encrypted workspaces already have the sequence column. */ }
  const sequenceRows = rows<{ id: string; thread_id: string; sequence: number | null }>(db.execute("SELECT id, thread_id, sequence FROM workspace_messages ORDER BY thread_id ASC, created_at ASC, rowid ASC"));
  let sequenceThread = "";
  let sequenceValue = 0;
  for (const message of sequenceRows) {
    if (message.thread_id !== sequenceThread) { sequenceThread = message.thread_id; sequenceValue = 0; }
    sequenceValue += 1;
    if (message.sequence !== sequenceValue) db.execute("UPDATE workspace_messages SET sequence = ? WHERE id = ?", [sequenceValue, message.id]);
  }
  db.execute("CREATE INDEX IF NOT EXISTS workspace_messages_thread_sequence ON workspace_messages(thread_id, sequence ASC)");
  db.execute("CREATE TABLE IF NOT EXISTS filesystem_audit_events (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT NOT NULL, mission_id TEXT, agent_id TEXT, action TEXT NOT NULL, paths_json TEXT NOT NULL, result TEXT NOT NULL, error_code TEXT, duration_ms INTEGER NOT NULL, created_at TEXT NOT NULL)");
  db.execute("CREATE INDEX IF NOT EXISTS filesystem_audit_project_created ON filesystem_audit_events(project_id, created_at DESC)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_imports (owner_id TEXT PRIMARY KEY, imported_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_model_providers (owner_id TEXT PRIMARY KEY, base_url TEXT NOT NULL, api_key TEXT NOT NULL, selected_models_json TEXT NOT NULL, available_models_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_github_connections (owner_id TEXT PRIMARY KEY, github_user_id TEXT NOT NULL, github_login TEXT NOT NULL, access_token TEXT NOT NULL, refresh_token TEXT, expires_at TEXT, scopes_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_github_grants (owner_id TEXT PRIMARY KEY, grant_token TEXT NOT NULL, github_login TEXT, updated_at TEXT NOT NULL)");
  try { db.execute("ALTER TABLE workspace_model_providers ADD COLUMN available_models_json TEXT NOT NULL DEFAULT '[]'"); } catch { /* Existing encrypted workspaces already have the catalog column. */ }
  db.execute("CREATE TABLE IF NOT EXISTS workspace_mission_intakes (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT, model TEXT, status TEXT NOT NULL, sources_json TEXT NOT NULL, brief_json TEXT NOT NULL, issues_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_attachments (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT, name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, content_hash TEXT NOT NULL, storage_key TEXT NOT NULL, storage_url TEXT NOT NULL, source_kind TEXT NOT NULL, created_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_missions (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT, parent_mission_id TEXT, mission_type TEXT NOT NULL, goal TEXT NOT NULL, contract_json TEXT NOT NULL, status TEXT NOT NULL, budget_json TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_mission_work_items (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, owner_id TEXT NOT NULL, parent_work_item_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, dependencies_json TEXT NOT NULL, acceptance_criteria_json TEXT NOT NULL, input_json TEXT NOT NULL, output_json TEXT, attempt INTEGER NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_mission_checkpoints (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, owner_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL, state_json TEXT NOT NULL, next_action TEXT, created_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_mission_events (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, owner_id TEXT NOT NULL, work_item_id TEXT, sequence INTEGER NOT NULL, type TEXT NOT NULL, actor TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(mission_id, sequence))");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_mission_leases (work_item_id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, owner_id TEXT NOT NULL, worker_id TEXT NOT NULL, attempt INTEGER NOT NULL, expires_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL, created_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_mission_artifacts (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, owner_id TEXT NOT NULL, work_item_id TEXT, kind TEXT NOT NULL, locator TEXT NOT NULL, summary TEXT NOT NULL, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_mission_evidence (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, owner_id TEXT NOT NULL, stage_run_id TEXT, work_item_id TEXT, artifact_id TEXT, kind TEXT NOT NULL, summary TEXT NOT NULL, strength TEXT NOT NULL, provenance_json TEXT NOT NULL, data_json TEXT NOT NULL, produced_by TEXT NOT NULL, observed_at TEXT NOT NULL, created_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_mission_verifications (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, owner_id TEXT NOT NULL, stage_run_id TEXT, work_item_id TEXT, subject_refs_json TEXT NOT NULL, method TEXT NOT NULL, independence_mode TEXT NOT NULL, status TEXT NOT NULL, observations_json TEXT NOT NULL, failed_checks_json TEXT NOT NULL, evidence_refs_json TEXT NOT NULL, performed_by TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_mission_learning_candidates (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, owner_id TEXT NOT NULL, candidate_type TEXT NOT NULL, domain TEXT NOT NULL, title TEXT NOT NULL, content_json TEXT NOT NULL, confidence REAL NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_mission_replays (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, owner_id TEXT NOT NULL, candidate_id TEXT, status TEXT NOT NULL, evidence_json TEXT NOT NULL, created_at TEXT NOT NULL)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_mission_leases_mission ON workspace_mission_leases(mission_id, expires_at ASC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_mission_leases_owner ON workspace_mission_leases(owner_id, expires_at ASC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_mission_artifacts_mission_created ON workspace_mission_artifacts(mission_id, created_at ASC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_mission_evidence_mission_created ON workspace_mission_evidence(mission_id, created_at ASC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_mission_verifications_mission_created ON workspace_mission_verifications(mission_id, started_at ASC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_mission_learning_mission_status ON workspace_mission_learning_candidates(mission_id, status, created_at ASC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_mission_replays_mission_created ON workspace_mission_replays(mission_id, created_at ASC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_mission_intakes_owner_updated ON workspace_mission_intakes(owner_id, updated_at DESC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_attachments_owner_created ON workspace_attachments(owner_id, created_at DESC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_attachments_project_created ON workspace_attachments(project_id, created_at DESC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_github_connections_login ON workspace_github_connections(github_login)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_github_grants_updated ON workspace_github_grants(updated_at DESC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_missions_owner_updated ON workspace_missions(owner_id, updated_at DESC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_mission_work_items_mission_status ON workspace_mission_work_items(mission_id, status, updated_at ASC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_mission_checkpoints_mission_version ON workspace_mission_checkpoints(mission_id, version DESC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_mission_events_mission_sequence ON workspace_mission_events(mission_id, sequence ASC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_mission_events_owner_created ON workspace_mission_events(owner_id, created_at DESC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_threads_owner_updated ON workspace_threads(owner_id, updated_at DESC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_messages_thread_created ON workspace_messages(thread_id, created_at ASC)");
  try { db.execute("ALTER TABLE workspace_threads ADD COLUMN chat_slug TEXT"); } catch { /* Existing encrypted workspaces already have the column. */ }
  db.execute("UPDATE workspace_threads SET chat_slug = 'chat-' || lower(replace(id, '-', '')) WHERE chat_slug IS NULL OR chat_slug = '' OR length(chat_slug) < 37");
  db.execute("CREATE UNIQUE INDEX IF NOT EXISTS workspace_threads_chat_slug_unique ON workspace_threads(chat_slug)");
  return db;
}

function scheduleWorkspaceDbClose() {
  if (workspaceDbCloseTimer) clearTimeout(workspaceDbCloseTimer);
  workspaceDbCloseTimer = setTimeout(() => {
    workspaceDb?.close();
    workspaceDb = undefined;
    workspaceDbCloseTimer = undefined;
  }, 90_000);
  workspaceDbCloseTimer.unref?.();
}

function checkpointLocalSnapshot(db: Db) {
  // Paradox fsyncs an encrypted journal per statement. Folding that journal into
  // the encrypted dotdat snapshot here gives mutation callers a durable local
  // acknowledgement without waiting for the independently scheduled cloud push.
  const engine = (db as unknown as { engine: { checkpoint?: () => void } }).engine;
  if (typeof engine.checkpoint !== "function") throw new Error("Paradox-DB local checkpoint is unavailable");
  engine.checkpoint();
}

export function createFilesystemAuditSink(ownerId: string): AuditSink {
  return async (event: FileSystemAuditEvent) => withWorkspaceDb(true, (db) => {
    assertProjectOwner(db, ownerId, event.projectId);
    db.execute("INSERT INTO filesystem_audit_events (id, owner_id, project_id, mission_id, agent_id, action, paths_json, result, error_code, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [event.operationId, ownerId, event.projectId, event.missionId || null, event.agentId || null, event.action, JSON.stringify(event.paths.slice(0, 100)), event.result, event.errorCode || null, Math.max(0, Math.round(event.durationMs)), event.timestamp]);
  });
}

export async function withWorkspaceDb<T>(write: boolean, action: (db: Db) => Promise<T> | T) {
  let release: (() => void) | undefined;
  const previous = workspaceOperationTail;
  workspaceOperationTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  let db: Db | undefined;
  try {
    db = await openWorkspaceDb();
    const result = await action(db);
    if (write) checkpointLocalSnapshot(db);
    return result;
  } finally {
    scheduleWorkspaceDbClose();
    release?.();
  }
}

function assertProjectOwner(db: Db, ownerId: string, projectId: string) {
  const project = rows<{ id: string }>(db.execute("SELECT id FROM workspace_projects WHERE id = ? AND owner_id = ? LIMIT 1", [projectId, ownerId]))[0];
  if (!project) throw new WorkspaceAccessError("Project not found");
}

function assertThreadOwner(db: Db, ownerId: string, threadId: string) {
  const thread = rows<{ id: string }>(db.execute("SELECT id FROM workspace_threads WHERE id = ? AND owner_id = ? LIMIT 1", [threadId, ownerId]))[0];
  if (!thread) throw new WorkspaceAccessError("Thread not found");
}

function readWorkspaceNavigation(db: Db, ownerId: string): WorkspaceNavigation {
  const projects = rows<{ id: string; name: string; description: string; tone: string; source_type: ProjectSourceType; source_url: string | null; source_commit: string | null; workspace_status: ProjectWorkspaceStatus; workspace_file_count: number; workspace_bytes: number; workspace_updated_at: string | null; workspace_error: string | null }>(db.execute(
    "SELECT id, name, description, tone, source_type, source_url, source_commit, workspace_status, workspace_file_count, workspace_bytes, workspace_updated_at, workspace_error FROM workspace_projects WHERE owner_id = ? ORDER BY updated_at DESC", [ownerId],
  ));
  const threadRows = rows<{ id: string; chat_slug: string | null; title: string; project_id: string | null; updated_at: string }>(db.execute(
    "SELECT id, chat_slug, title, project_id, updated_at FROM workspace_threads WHERE owner_id = ? ORDER BY updated_at DESC", [ownerId],
  ));
  return {
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      tone: project.tone,
      sourceType: project.source_type || "none",
      ...(project.source_url ? { sourceUrl: project.source_url } : {}),
      ...(project.source_commit ? { sourceCommit: project.source_commit } : {}),
      workspaceStatus: project.workspace_status || "empty",
      workspaceFileCount: Number(project.workspace_file_count || 0),
      workspaceBytes: Number(project.workspace_bytes || 0),
      ...(project.workspace_updated_at ? { workspaceUpdatedAt: project.workspace_updated_at } : {}),
      ...(project.workspace_error ? { workspaceError: project.workspace_error } : {}),
    })),
    threads: threadRows.map((thread) => ({
      id: thread.id,
      chatSlug: thread.chat_slug || chatSlugFor(thread.id),
      title: thread.title,
      ...(thread.project_id ? { projectId: thread.project_id } : {}),
      updatedAt: thread.updated_at,
      messages: [],
    })),
  };
}

function readWorkspaceChat(db: Db, ownerId: string, chatSlug: string): WorkspaceThread | null {
  const thread = rows<{ id: string; chat_slug: string | null; title: string; project_id: string | null; updated_at: string }>(db.execute(
    "SELECT id, chat_slug, title, project_id, updated_at FROM workspace_threads WHERE owner_id = ? AND chat_slug = ? LIMIT 1", [ownerId, chatSlug],
  ))[0];
  if (!thread) return null;
  const messageRows = rows<{ id: string; role: "user" | "assistant"; content: string; created_at: string }>(db.execute(
    "SELECT id, role, content, created_at FROM workspace_messages WHERE owner_id = ? AND thread_id = ? ORDER BY sequence ASC, created_at ASC, rowid ASC", [ownerId, thread.id],
  ));
  return {
    id: thread.id,
    chatSlug: thread.chat_slug || chatSlugFor(thread.id),
    title: thread.title,
    ...(thread.project_id ? { projectId: thread.project_id } : {}),
    updatedAt: thread.updated_at,
    messages: messageRows.map((message) => ({ id: message.id, role: message.role, content: message.content, createdAt: message.created_at })),
  };
}

export async function loadWorkspaceNavigation(ownerId: string): Promise<WorkspaceNavigation> {
  return withWorkspaceDb(false, (db) => {
    return readWorkspaceNavigation(db, ownerId);
  });
}

export async function loadWorkspaceChat(ownerId: string, chatSlug: string): Promise<WorkspaceThread | null> {
  return withWorkspaceDb(false, (db) => readWorkspaceChat(db, ownerId, chatSlug));
}

export async function loadWorkspace(ownerId: string, activeChatSlug?: string): Promise<DurableWorkspace> {
  return withWorkspaceDb(false, (db) => {
    const navigation = readWorkspaceNavigation(db, ownerId);
    const selected = activeChatSlug || navigation.threads[0]?.chatSlug;
    const activeChat = selected ? readWorkspaceChat(db, ownerId, selected) : null;
    return { ...navigation, threads: navigation.threads.map((thread) => activeChat?.id === thread.id ? activeChat : thread) };
  });
}

export async function saveGithubGrant(ownerId: string, grantToken: string, login?: string): Promise<void> {
  if (!grantToken.trim()) throw new WorkspaceAccessError("GitHub authorization grant is empty");
  await withWorkspaceDb(true, (db) => {
    db.execute("INSERT INTO workspace_github_grants (owner_id, grant_token, github_login, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET grant_token = excluded.grant_token, github_login = excluded.github_login, updated_at = excluded.updated_at", [ownerId, grantToken.trim(), login?.trim() || null, now()]);
    db.execute("DELETE FROM workspace_github_connections WHERE owner_id = ?", [ownerId]);
  });
}

export async function loadGithubGrant(ownerId: string): Promise<{ grantToken: string; login: string | null } | null> {
  return withWorkspaceDb(false, (db) => {
    const row = rows<{ grant_token: string; github_login: string | null }>(db.execute("SELECT grant_token, github_login FROM workspace_github_grants WHERE owner_id = ? LIMIT 1", [ownerId]))[0];
    return row ? { grantToken: row.grant_token, login: row.github_login } : null;
  });
}

export async function loadModelProviderSettings(ownerId: string): Promise<ModelProviderSettings | null> {
  return withWorkspaceDb(false, (db) => {
    const provider = rows<{ base_url: string; selected_models_json: string; available_models_json: string; api_key: string }>(db.execute("SELECT base_url, selected_models_json, available_models_json, api_key FROM workspace_model_providers WHERE owner_id = ? LIMIT 1", [ownerId]))[0];
    if (!provider) return null;
    return { baseUrl: provider.base_url, selectedModels: parseModelList(provider.selected_models_json).slice(0, 32), availableModels: parseModelList(provider.available_models_json, true), apiKeyConfigured: provider.api_key.length > 0 };
  });
}

export async function saveModelProviderSettings(ownerId: string, input: { baseUrl: string; apiKey?: string; selectedModels: string[] }): Promise<ModelProviderSettings> {
  return withWorkspaceDb(true, (db) => {
    const baseUrl = normalizeProviderBaseUrl(input.baseUrl);
    const selectedModels = Array.from(new Set(input.selectedModels.map((model) => model.trim()).filter(Boolean))).slice(0, 32);
    const existing = rows<{ api_key: string; available_models_json: string }>(db.execute("SELECT api_key, available_models_json FROM workspace_model_providers WHERE owner_id = ? LIMIT 1", [ownerId]))[0];
    const apiKey = input.apiKey?.trim() || existing?.api_key;
    if (!apiKey) throw new ModelProviderError("Enter an API key before saving your first model provider.");
    const availableModels = parseModelList(existing?.available_models_json, true);
    db.execute("INSERT INTO workspace_model_providers (owner_id, base_url, api_key, selected_models_json, available_models_json, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET base_url = excluded.base_url, api_key = excluded.api_key, selected_models_json = excluded.selected_models_json, available_models_json = excluded.available_models_json, updated_at = excluded.updated_at", [ownerId, baseUrl, apiKey, JSON.stringify(selectedModels), JSON.stringify(availableModels), now()]);
    return { baseUrl, selectedModels, availableModels, apiKeyConfigured: true };
  });
}

export type PlaygroundPrompt = { threadId: string; model: string; prompt: string; title?: string; stopNotice?: boolean; generalMode?: GeneralMode; projectId?: string };
export type PlaygroundToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type PlaygroundToolEvent = { type: "filesystem.started" | "filesystem.completed" | "filesystem.failed" | "terminal.started" | "terminal.completed" | "terminal.failed"; id: string; action: string; status: "running" | "completed" | "failed"; operationId?: string; code?: string; message?: string };
export type PlaygroundStreamResult = { content: string; stopped: boolean; finished: boolean; toolCalls?: PlaygroundToolCall[] };
const APPROVAL_PROMPT = /^(?:approved?|approve|yes|yes,?\s*(?:go ahead|do it|proceed|implement|build)|go ahead|proceed|implement it|start building|start implementation|continue with the plan)[.!\s]*$/i;
const PLAN_SIGNAL = /\b(?:plan|implementation|files?|steps?|verification|change surface|affected areas)\b/i;

export function resolveGeneralMode(input: { requestedMode: GeneralMode; prompt: string; history: Array<Pick<WorkspaceMessage, "role" | "content">> }): GeneralMode {
  const previous = input.history.at(-1);
  const approved = input.requestedMode === "plan" && APPROVAL_PROMPT.test(input.prompt.trim()) && previous?.role === "assistant" && PLAN_SIGNAL.test(previous.content || "");
  return approved ? "build" : input.requestedMode;
}

export function buildPlaygroundMessages(history: Array<Pick<WorkspaceMessage, "role" | "content">>, input: Pick<PlaygroundPrompt, "prompt" | "stopNotice" | "generalMode">): WorkspaceModelMessage[] {
  return [
    { role: "system", content: composeGeneralSystemPrompt(input.generalMode || "plan") },
    ...(input.stopNotice ? [{ role: "system" as const, content: "The user stopped the previous task. Stop immediately, wait, and do not continue that task until the user provides a new request." }] : []),
    ...history,
    { role: "user", content: input.prompt },
  ];
}

async function loadProviderForPlayground(ownerId: string, model: string) {
  return withWorkspaceDb(false, (db) => {
    const provider = rows<{ base_url: string; api_key: string; selected_models_json: string; available_models_json: string }>(db.execute("SELECT base_url, api_key, selected_models_json, available_models_json FROM workspace_model_providers WHERE owner_id = ? LIMIT 1", [ownerId]))[0];
    if (!provider?.api_key) throw new ModelProviderError("Save a model API key before using the playground.", { code: "PROVIDER_KEY_MISSING" });
    const allowedModels = new Set(parseModelList(provider.selected_models_json));
    if (!allowedModels.has(model)) throw new ModelProviderError(`Model '${model}' is not selected in Settings.`, { code: "MODEL_NOT_SELECTED" });
    return provider;
  });
}

async function loadThreadMessagesForPlayground(ownerId: string, threadId: string) {
  return withWorkspaceDb(false, (db) => {
    assertThreadOwner(db, ownerId, threadId);
    const messages = rows<{ role: "user" | "assistant"; content: string }>(db.execute("SELECT role, content FROM workspace_messages WHERE owner_id = ? AND thread_id = ? ORDER BY sequence ASC, created_at ASC, rowid ASC", [ownerId, threadId]));
    return messages;
  });
}

function extractStreamText(payload: { text?: unknown; choices?: Array<{ text?: unknown; delta?: { content?: unknown; reasoning_content?: unknown; thinking?: unknown }; message?: { content?: unknown } ; finish_reason?: unknown }> }) {
  const choice = payload.choices?.[0];
  const content = choice?.delta?.content ?? choice?.message?.content ?? choice?.delta?.reasoning_content ?? choice?.delta?.thinking ?? choice?.text ?? payload.text;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => typeof part === "string" ? part : (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : "")).join("");
  return "";
}

export async function readOpenAICompatibleStream(response: Response, signal: AbortSignal, onToken: (token: string) => void) {
  if (!response.body) throw new ModelProviderError("The model API returned an empty stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let stopped = false;
  let finished = false;
  const toolCalls = new Map<number, PlaygroundToolCall>();
  const consume = (line: string) => {
    const data = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!data) return;
    if (data === "[DONE]") { finished = true; return; }
    try {
      const payload = JSON.parse(data) as { error?: { message?: unknown }; text?: unknown; choices?: Array<{ text?: unknown; delta?: { content?: unknown; reasoning_content?: unknown; thinking?: unknown; tool_calls?: Array<{ index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }> }; message?: { content?: unknown }; finish_reason?: unknown }> };
      if (payload.error?.message) throw new ModelProviderError(String(payload.error.message));
      const choice = payload.choices?.[0];
      if (choice?.finish_reason) finished = true;
      for (const delta of choice?.delta?.tool_calls || []) {
        const index = Number.isInteger(delta.index) ? Number(delta.index) : toolCalls.size;
        const existing = toolCalls.get(index);
        toolCalls.set(index, {
          id: delta.id || existing?.id || `call_${index}`,
          type: "function",
          function: {
            name: delta.function?.name || existing?.function.name || "",
            arguments: `${existing?.function.arguments || ""}${delta.function?.arguments || ""}`,
          },
        });
      }
      const token = extractStreamText(payload);
      if (token) { content += token; onToken(token); }
    } catch (error) {
      if (error instanceof ModelProviderError) throw error;
      console.warn("[Playground] ignored malformed provider SSE frame", { detail: data.slice(0, 240), error: error instanceof Error ? { name: error.name, message: error.message } : String(error) });
    }
  };

  const cancelReader = () => { void reader.cancel(); };
  signal.addEventListener("abort", cancelReader, { once: true });
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) consume(line);
    }
    if (buffer.trim() && !signal.aborted) consume(buffer);
    if (signal.aborted) stopped = true;
  } finally {
    signal.removeEventListener("abort", cancelReader);
    await reader.cancel().catch(() => undefined);
  }
  const completedToolCalls = [...toolCalls.values()].filter((call) => call.function.name && call.function.arguments);
  return completedToolCalls.length ? { content, stopped, finished, toolCalls: completedToolCalls } : { content, stopped, finished };
}

const GENERAL_TERMINAL_TOOL = {
  type: "function",
  function: {
    name: "terminal",
    description: "Run a project command for inspection, testing, building, formatting, or verification in the active workspace.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeoutMs: { type: "integer", minimum: 1, maximum: 120000 },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
} as const;

const GENERAL_FILESYSTEM_TOOL = {
  type: "function",
  function: {
    name: "filesystem",
    description: "Inspect, search, review, create, edit, organize, snapshot, and verify files in the active project workspace.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "tree", "stat", "exists", "find", "du", "read", "read_many", "tail", "binary_metadata", "grep", "grep_batch", "glob", "create", "write", "append", "patch", "replace", "format", "copy", "move", "rename", "delete", "clean_generated", "symbols", "references", "recent_changes", "diff_file", "diff_workspace", "diff_paths", "preview_patch", "apply_patch", "rollback", "snapshot", "restore_snapshot", "manifest", "export_patch", "import_patch", "verify_workspace"] },
        path: { type: "string" },
        paths: { type: "array", items: { type: "string" } },
        pattern: { type: "string" },
        query: { type: "string" },
        queries: { type: "array", items: { type: "string" } },
        content: { type: "string" },
        expectedSha256: { type: "string" },
        edits: { type: "array", items: { type: "object", properties: { find: { type: "string" }, replace: { type: "string" } }, required: ["find", "replace"], additionalProperties: false } },
        destinationPath: { type: "string" },
        sourcePath: { type: "string" },
        confirmed: { type: "boolean" },
        recursive: { type: "boolean" },
        patterns: { type: "array", items: { type: "string" } },
        language: { type: "string", enum: ["typescript", "javascript", "python", "go", "rust", "java", "generic"] },
        patchText: { type: "string" },
        rollbackOperationId: { type: "string" },
        snapshotId: { type: "string" },
        manifestId: { type: "string" },
        unified: { type: "boolean" },
        maxEntries: { type: "integer" },
        maxDepth: { type: "integer" },
        maxBytes: { type: "integer" },
        maxMatches: { type: "integer" },
        contextLines: { type: "integer" },
        startLine: { type: "integer" },
        endLine: { type: "integer" },
        lineCount: { type: "integer" },
        regex: { type: "boolean" },
        caseSensitive: { type: "boolean" },
        include: { type: "array", items: { type: "string" } },
        exclude: { type: "array", items: { type: "string" } },
        formatter: { type: "string", enum: ["prettier", "biome", "gofmt", "rustfmt"] },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
} as const;

function boundedToolContent(value: unknown) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return (serialized || "").slice(0, 32_000);
}

async function executeGeneralTerminalTool(ownerId: string, projectId: string, call: PlaygroundToolCall) {
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(call.function.arguments) as Record<string, unknown>; } catch { return { ok: false, code: "INVALID_TOOL_ARGUMENTS", message: "The terminal tool arguments were not valid JSON." }; }
  const command = typeof parsed.command === "string" ? parsed.command.trim() : "";
  if (!command) return { ok: false, code: "INVALID_TOOL_ARGUMENTS", message: "The terminal command is required." };
  const timeoutMs = typeof parsed.timeoutMs === "number" && Number.isFinite(parsed.timeoutMs) ? Math.max(1_000, Math.min(120_000, Math.floor(parsed.timeoutMs))) : 120_000;
  const { resolveOwnedProjectWorkspace } = await import("./fileSystemRuntime");
  const workspace = await resolveOwnedProjectWorkspace(ownerId, projectId);
  try {
    const result = await execFileAsync("sh", ["-lc", command], { cwd: workspace.root, timeout: timeoutMs, maxBuffer: 400_000 });
    return { ok: true, stdout: result.stdout.slice(0, 120_000), stderr: result.stderr.slice(0, 40_000), exitCode: 0 };
  } catch (error) {
    const failure = error as { message?: string; stdout?: string; stderr?: string; code?: string | number; killed?: boolean };
    return { ok: false, code: "COMMAND_FAILED", message: (failure.message || "The terminal command failed.").slice(0, 2_000), stdout: (failure.stdout || "").slice(0, 120_000), stderr: (failure.stderr || "").slice(0, 40_000), exitCode: typeof failure.code === "number" ? failure.code : undefined, killed: failure.killed === true };
  }
}

async function executeGeneralFilesystemTool(ownerId: string, projectId: string, call: PlaygroundToolCall, mode: GeneralMode) {
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(call.function.arguments) as Record<string, unknown>; } catch { return { ok: false, code: "INVALID_TOOL_ARGUMENTS", message: "The filesystem tool arguments were not valid JSON." }; }
  const action = typeof parsed.action === "string" ? parsed.action : "";
  if (!action) return { ok: false, code: "INVALID_TOOL_ARGUMENTS", message: "The filesystem tool action is required." };
  const { runProjectFileSystem } = await import("./fileSystemRuntime");
  return runProjectFileSystem(ownerId, projectId, { ...parsed, action } as FileSystemRequest, {
    agentId: `general:${call.id}`,
    canMutate: mode === "build",
    canDestructivelyMutate: mode === "build" && parsed.confirmed === true,
  });
}

export async function streamWorkspacePrompt(ownerId: string, input: PlaygroundPrompt, signal: AbortSignal, onToken: (token: string) => void, onToolEvent: (event: PlaygroundToolEvent) => void = () => {}): Promise<PlaygroundStreamResult> {
  const provider = await loadProviderForPlayground(ownerId, input.model);
  const history = await loadThreadMessagesForPlayground(ownerId, input.threadId);
  const title = history.length === 0 ? (input.title || input.prompt.slice(0, 42)) : undefined;
  await appendThreadMessages(ownerId, input.threadId, [{ role: "user", content: input.prompt }], title);
  const requestedGeneralMode = input.generalMode || "plan";
  const activeGeneralMode = resolveGeneralMode({ requestedMode: requestedGeneralMode, prompt: input.prompt, history });
  const messages = buildPlaygroundMessages(history, { ...input, generalMode: activeGeneralMode });
  const rollbackPrompt = () => removeLatestThreadMessage(ownerId, input.threadId, { role: "user", content: input.prompt });
  const canUseGeneralTools = Boolean(input.projectId && input.generalMode);
  const availableGeneralTools = activeGeneralMode === "build" ? [GENERAL_FILESYSTEM_TOOL, GENERAL_TERMINAL_TOOL] : [GENERAL_FILESYSTEM_TOOL];
  let finalResult: PlaygroundStreamResult = { content: "", stopped: false, finished: false };
  try {
    for (let round = 0; round <= 8; round += 1) {
      let response: Response;
      try {
        response = await fetch(`${normalizeProviderBaseUrl(provider.base_url)}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${provider.api_key}`, Accept: "text/event-stream", "Content-Type": "application/json" },
          body: JSON.stringify({ model: input.model, messages, stream: true, ...(canUseGeneralTools && round < 8 ? { tools: availableGeneralTools, tool_choice: "auto" } : {}) }),
          signal,
        });
      } catch (error) {
        if (signal.aborted) return { content: "", stopped: true, finished: false };
        throw error;
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new ModelProviderError(`The model API rejected the request: ${response.status} — ${providerErrorDetail(detail)}`, { code: "PROVIDER_HTTP_ERROR", status: response.status });
      }
      const result = await readOpenAICompatibleStream(response, signal, onToken);
      finalResult = result;
      if (!result.toolCalls?.length || !canUseGeneralTools) break;
      if (!input.projectId) break;
      messages.push({ role: "assistant", content: result.content || "", tool_calls: result.toolCalls });
      for (const call of result.toolCalls) {
        const action = (() => { try { return String((JSON.parse(call.function.arguments) as Record<string, unknown>).action || "filesystem"); } catch { return "filesystem"; } })();
        const toolType = call.function.name === "terminal" ? "terminal" : "filesystem";
        onToolEvent({ type: `${toolType}.started` as PlaygroundToolEvent["type"], id: call.id, action: toolType === "terminal" ? "terminal" : action, status: "running" });
        let toolResult: unknown;
        try {
          toolResult = call.function.name === "terminal"
            ? activeGeneralMode === "build" ? await executeGeneralTerminalTool(ownerId, input.projectId, call) : { ok: false, code: "MODE_REJECTED", message: "Terminal execution is available only in Build mode." }
            : await executeGeneralFilesystemTool(ownerId, input.projectId, call, activeGeneralMode);
        } catch (error) { toolResult = { ok: false, code: "TOOL_EXECUTION_FAILED", message: error instanceof Error ? error.message : "The requested tool failed." }; }
        const failed = Boolean(toolResult && typeof toolResult === "object" && "ok" in toolResult && (toolResult as { ok?: unknown }).ok === false);
        const operationId = toolResult && typeof toolResult === "object" && "operationId" in toolResult ? String((toolResult as { operationId?: unknown }).operationId || "") : undefined;
        const code = toolResult && typeof toolResult === "object" && "code" in toolResult ? String((toolResult as { code?: unknown }).code || "") : undefined;
        const message = toolResult && typeof toolResult === "object" && "message" in toolResult ? String((toolResult as { message?: unknown }).message || "") : undefined;
        onToolEvent({ type: `${toolType}.${failed ? "failed" : "completed"}` as PlaygroundToolEvent["type"], id: call.id, action: toolType === "terminal" ? "terminal" : action, status: failed ? "failed" : "completed", ...(operationId ? { operationId } : {}), ...(code ? { code } : {}), ...(message ? { message } : {}) });
        messages.push({ role: "tool", tool_call_id: call.id, content: boundedToolContent(toolResult) });
      }
    }
  } catch (error) {
    if (!signal.aborted) await rollbackPrompt().catch(() => undefined);
    throw error;
  }
  if (finalResult.content) await appendThreadMessages(ownerId, input.threadId, [{ role: "assistant", content: finalResult.content }]);
  return finalResult;
}

export async function discoverModelProviderModels(ownerId: string, requester: typeof fetch = fetch): Promise<{ models: string[] }> {
  const provider = await withWorkspaceDb(false, (db) => rows<{ base_url: string; api_key: string }>(db.execute("SELECT base_url, api_key FROM workspace_model_providers WHERE owner_id = ? LIMIT 1", [ownerId]))[0]);
  if (!provider) throw new ModelProviderError("Save a model API key and base URL before refreshing models.");
  let response: Response;
  try {
    response = await requester(`${normalizeProviderBaseUrl(provider.base_url)}/models`, { headers: { Authorization: `Bearer ${provider.api_key}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  } catch { throw new ModelProviderError("The model API could not be reached. Check the base URL and try again."); }
  if (!response.ok) throw new ModelProviderError("The model API rejected the request. Check the API key and base URL.");
  let payload: { data?: Array<{ id?: unknown }> };
  try { payload = await response.json() as { data?: Array<{ id?: unknown }> }; } catch { throw new ModelProviderError("The model API returned an invalid model list."); }
  const models = Array.from(new Set((payload.data || []).map((model) => typeof model.id === "string" ? model.id.trim() : "").filter(Boolean))).slice(0, 500).sort((a, b) => a.localeCompare(b));
  await withWorkspaceDb(true, (db) => {
    db.execute("UPDATE workspace_model_providers SET available_models_json = ?, updated_at = ? WHERE owner_id = ?", [JSON.stringify(models), now(), ownerId]);
  });
  return { models };
}

export async function createProject(ownerId: string, input: { name: string; description: string; tone: string; sourceType?: ProjectSourceType }) {
  return withWorkspaceDb(true, (db) => {
    const duplicate = rows<{ id: string }>(db.execute("SELECT id FROM workspace_projects WHERE owner_id = ? AND lower(trim(name)) = lower(trim(?)) LIMIT 1", [ownerId, input.name]))[0];
    if (duplicate) throw new DuplicateProjectNameError("A project with this name already exists.");
    const id = randomUUID(); const timestamp = now();
    const sourceType = input.sourceType || "none";
    const workspaceStatus: ProjectWorkspaceStatus = sourceType === "none" ? "empty" : "importing";
    db.execute("INSERT INTO workspace_projects (id, owner_id, name, description, tone, source_type, workspace_status, workspace_file_count, workspace_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, ownerId, input.name, input.description, input.tone, sourceType, workspaceStatus, 0, 0, timestamp, timestamp]);
    return { id, name: input.name, description: input.description, tone: input.tone, sourceType, workspaceStatus, workspaceFileCount: 0, workspaceBytes: 0 } satisfies WorkspaceProject;
  });
}

export async function updateProject(ownerId: string, id: string, input: Pick<WorkspaceProject, "name" | "description">) {
  return withWorkspaceDb(true, (db) => {
    const duplicate = rows<{ id: string }>(db.execute("SELECT id FROM workspace_projects WHERE owner_id = ? AND lower(trim(name)) = lower(trim(?)) AND id <> ? LIMIT 1", [ownerId, input.name, id]))[0];
    if (duplicate) throw new DuplicateProjectNameError("A project with this name already exists.");
    const result = db.execute("UPDATE workspace_projects SET name = ?, description = ?, updated_at = ? WHERE id = ? AND owner_id = ?", [input.name, input.description, now(), id, ownerId]);
    if (!result.changes) throw new WorkspaceAccessError("Project not found");
    const project = rows<{ id: string; name: string; description: string; tone: string; source_type: ProjectSourceType; source_url: string | null; source_commit: string | null; workspace_status: ProjectWorkspaceStatus; workspace_file_count: number; workspace_bytes: number; workspace_updated_at: string | null; workspace_error: string | null }>(db.execute("SELECT id, name, description, tone, source_type, source_url, source_commit, workspace_status, workspace_file_count, workspace_bytes, workspace_updated_at, workspace_error FROM workspace_projects WHERE id = ? AND owner_id = ?", [id, ownerId]))[0];
    if (!project) throw new WorkspaceAccessError("Project not found");
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      tone: project.tone,
      sourceType: project.source_type || "none",
      ...(project.source_url ? { sourceUrl: project.source_url } : {}),
      ...(project.source_commit ? { sourceCommit: project.source_commit } : {}),
      workspaceStatus: project.workspace_status || "empty",
      workspaceFileCount: Number(project.workspace_file_count || 0),
      workspaceBytes: Number(project.workspace_bytes || 0),
      ...(project.workspace_updated_at ? { workspaceUpdatedAt: project.workspace_updated_at } : {}),
      ...(project.workspace_error ? { workspaceError: project.workspace_error } : {}),
    } satisfies WorkspaceProject;
  });
}

export async function deleteProject(ownerId: string, id: string) {
  return withWorkspaceDb(true, (db) => {
    assertProjectOwner(db, ownerId, id);
    db.execute("UPDATE workspace_threads SET project_id = NULL, updated_at = ? WHERE owner_id = ? AND project_id = ?", [now(), ownerId, id]);
    db.execute("DELETE FROM workspace_projects WHERE id = ? AND owner_id = ?", [id, ownerId]);
    return { id };
  });
}

export async function createThread(ownerId: string, projectId?: string | null, forceNew = false) {
  return withWorkspaceDb(true, (db) => {
    if (projectId) assertProjectOwner(db, ownerId, projectId);
    const existing = forceNew ? undefined : rows<{ id: string; chat_slug: string | null; title: string; project_id: string | null; updated_at: string }>(db.execute(
      "SELECT t.id, t.chat_slug, t.title, t.project_id, t.updated_at FROM workspace_threads t WHERE t.owner_id = ? AND NOT EXISTS (SELECT 1 FROM workspace_messages m WHERE m.thread_id = t.id AND m.owner_id = t.owner_id) ORDER BY t.updated_at DESC LIMIT 1",
      [ownerId],
    ))[0];
    if (existing) {
      let resolvedProjectId = existing.project_id;
      if (projectId && projectId !== existing.project_id) {
        db.execute("UPDATE workspace_threads SET project_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?", [projectId, now(), existing.id, ownerId]);
        resolvedProjectId = projectId;
      }
      return { id: existing.id, chatSlug: existing.chat_slug || chatSlugFor(existing.id), title: existing.title, ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}), updatedAt: existing.updated_at, messages: [], created: false };
    }
    const id = randomUUID(); const timestamp = now();
    const chatSlug = chatSlugFor(id);
    db.execute("INSERT INTO workspace_threads (id, owner_id, chat_slug, title, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [id, ownerId, chatSlug, "Untitled exploration", projectId || null, timestamp, timestamp]);
    return { id, chatSlug, title: "Untitled exploration", ...(projectId ? { projectId } : {}), updatedAt: timestamp, messages: [], created: true } satisfies WorkspaceThread & { created: boolean };
  });
}

export async function renameThread(ownerId: string, id: string, title: string) {
  return withWorkspaceDb(true, (db) => {
    const timestamp = now();
    const result = db.execute("UPDATE workspace_threads SET title = ?, updated_at = ? WHERE id = ? AND owner_id = ?", [title, timestamp, id, ownerId]);
    if (!result.changes) throw new WorkspaceAccessError("Thread not found");
    return { id, title, updatedAt: timestamp };
  });
}

export async function assignThreadProject(ownerId: string, id: string, projectId: string | null) {
  return withWorkspaceDb(true, (db) => {
    assertThreadOwner(db, ownerId, id);
    if (projectId) assertProjectOwner(db, ownerId, projectId);
    const timestamp = now();
    db.execute("UPDATE workspace_threads SET project_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?", [projectId, timestamp, id, ownerId]);
    return { id, projectId, updatedAt: timestamp };
  });
}

export async function deleteThread(ownerId: string, id: string) {
  return withWorkspaceDb(true, (db) => {
    assertThreadOwner(db, ownerId, id);
    db.execute("DELETE FROM workspace_messages WHERE thread_id = ? AND owner_id = ?", [id, ownerId]);
    db.execute("DELETE FROM workspace_threads WHERE id = ? AND owner_id = ?", [id, ownerId]);
    return { id };
  });
}

export async function appendThreadMessages(ownerId: string, threadId: string, messages: Array<Pick<WorkspaceMessage, "role" | "content">>, title?: string) {
  return withWorkspaceDb(true, (db) => {
    assertThreadOwner(db, ownerId, threadId);
    const timestamp = now();
    const currentSequence = rows<{ max_sequence: number | null }>(db.execute("SELECT MAX(sequence) AS max_sequence FROM workspace_messages WHERE owner_id = ? AND thread_id = ?", [ownerId, threadId]))[0]?.max_sequence || 0;
    const inserted: WorkspaceMessage[] = messages.map((message, index) => ({ id: randomUUID(), role: message.role, content: message.content, createdAt: new Date(Date.now() + index).toISOString() }));
    inserted.forEach((message, index) => db.execute("INSERT INTO workspace_messages (id, thread_id, owner_id, role, content, created_at, sequence) VALUES (?, ?, ?, ?, ?, ?, ?)", [message.id, threadId, ownerId, message.role, message.content, message.createdAt, currentSequence + index + 1]));
    if (title) db.execute("UPDATE workspace_threads SET title = ?, updated_at = ? WHERE id = ? AND owner_id = ?", [title, timestamp, threadId, ownerId]);
    else db.execute("UPDATE workspace_threads SET updated_at = ? WHERE id = ? AND owner_id = ?", [timestamp, threadId, ownerId]);
    return { threadId, title, updatedAt: timestamp, messages: inserted };
  });
}

export async function removeLatestThreadMessage(ownerId: string, threadId: string, message: Pick<WorkspaceMessage, "role" | "content">) {
  return withWorkspaceDb(true, (db) => {
    assertThreadOwner(db, ownerId, threadId);
    db.execute("DELETE FROM workspace_messages WHERE id = (SELECT id FROM workspace_messages WHERE thread_id = ? AND owner_id = ? AND role = ? AND content = ? ORDER BY sequence DESC, created_at DESC, rowid DESC LIMIT 1) AND owner_id = ?", [threadId, ownerId, message.role, message.content, ownerId]);
    db.execute("UPDATE workspace_threads SET updated_at = ? WHERE id = ? AND owner_id = ?", [now(), threadId, ownerId]);
    return { threadId, removed: true };
  });
}

export async function migrateWorkspace(ownerId: string, workspace: LegacyWorkspace) {
  return withWorkspaceDb(true, (db) => {
    const imported = rows<{ owner_id: string }>(db.execute("SELECT owner_id FROM workspace_imports WHERE owner_id = ? LIMIT 1", [ownerId]))[0];
    if (imported) return { imported: false };
    for (const project of workspace.projects) {
      const timestamp = now();
      db.execute("INSERT OR IGNORE INTO workspace_projects (id, owner_id, name, description, tone, source_type, workspace_status, workspace_file_count, workspace_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [project.id, ownerId, project.name, project.description, project.tone, project.sourceType || "none", project.workspaceStatus || "empty", project.workspaceFileCount || 0, project.workspaceBytes || 0, timestamp, timestamp]);
    }
    for (const thread of workspace.threads) {
      const timestamp = thread.updatedAt || now();
      db.execute("INSERT OR IGNORE INTO workspace_threads (id, owner_id, chat_slug, title, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [thread.id, ownerId, chatSlugFor(thread.id), thread.title, thread.projectId || null, timestamp, timestamp]);
      thread.messages.forEach((message, index) => db.execute("INSERT OR IGNORE INTO workspace_messages (id, thread_id, owner_id, role, content, created_at, sequence) VALUES (?, ?, ?, ?, ?, ?, ?)", [message.id, thread.id, ownerId, message.role, message.content, message.createdAt || timestamp, index + 1]));
    }
    db.execute("INSERT INTO workspace_imports (owner_id, imported_at) VALUES (?, ?)", [ownerId, now()]);
    return { imported: true };
  });
}

export type WorkspaceModelMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: PlaygroundToolCall[]; tool_call_id?: string };
export type WorkspaceModelPrompt = { model: string; messages: WorkspaceModelMessage[] };

export async function streamWorkspaceModel(ownerId: string, input: WorkspaceModelPrompt, signal: AbortSignal, onToken: (token: string) => void = () => {}): Promise<PlaygroundStreamResult> {
  const provider = await loadProviderForPlayground(ownerId, input.model);
  let response: Response;
  try {
    response = await fetch(`${normalizeProviderBaseUrl(provider.base_url)}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.api_key}`, Accept: "text/event-stream", "Content-Type": "application/json" },
      body: JSON.stringify({ model: input.model, messages: input.messages, stream: true }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) return { content: "", stopped: true, finished: false };
    throw error;
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ModelProviderError(`The model API rejected the request: ${response.status} — ${providerErrorDetail(detail)}`, { code: "PROVIDER_HTTP_ERROR", status: response.status });
  }
  return readOpenAICompatibleStream(response, signal, onToken);
}

export async function findGithubWorkspaceProjectId(ownerId: string, fullName: string): Promise<string | null> {
  const parts = fullName.trim().split("/");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part))) return null;
  const sourceUrl = `https://github.com/${parts[0]}/${parts[1]}`;
  const repoName = parts[1];
  return withWorkspaceDb(false, (db) => rows<{ id: string }>(db.execute("SELECT id FROM workspace_projects WHERE owner_id = ? AND source_type = 'github' AND (lower(rtrim(source_url, '/')) = lower(?) OR lower(trim(name)) = lower(?)) ORDER BY CASE WHEN lower(rtrim(source_url, '/')) = lower(?) THEN 0 ELSE 1 END, updated_at DESC LIMIT 1", [ownerId, sourceUrl, repoName, sourceUrl]))[0]?.id || null);
}
