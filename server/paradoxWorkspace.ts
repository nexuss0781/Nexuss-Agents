import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "parad";

export type WorkspaceProject = { id: string; name: string; description: string; tone: string };
export type WorkspaceMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string };
export type WorkspaceThread = { id: string; chatSlug: string; title: string; projectId?: string; updatedAt: string; messages: WorkspaceMessage[] };
export type DurableWorkspace = { projects: WorkspaceProject[]; threads: WorkspaceThread[] };
export type WorkspaceNavigation = DurableWorkspace;
export type ModelProviderSettings = { baseUrl: string; selectedModels: string[]; availableModels: string[]; apiKeyConfigured: boolean };

export class WorkspaceAccessError extends Error {}
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
type LegacyWorkspace = { projects: WorkspaceProject[]; threads: Array<Omit<WorkspaceThread, "chatSlug"> & { chatSlug?: string }> };
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

  db.execute("CREATE TABLE IF NOT EXISTS workspace_projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, tone TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_threads (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, chat_slug TEXT, title TEXT NOT NULL, project_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, owner_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_imports (owner_id TEXT PRIMARY KEY, imported_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_model_providers (owner_id TEXT PRIMARY KEY, base_url TEXT NOT NULL, api_key TEXT NOT NULL, selected_models_json TEXT NOT NULL, available_models_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL)");
  try { db.execute("ALTER TABLE workspace_model_providers ADD COLUMN available_models_json TEXT NOT NULL DEFAULT '[]'"); } catch { /* Existing encrypted workspaces already have the catalog column. */ }
  db.execute("CREATE TABLE IF NOT EXISTS workspace_mission_intakes (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT, model TEXT, status TEXT NOT NULL, sources_json TEXT NOT NULL, brief_json TEXT NOT NULL, issues_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_missions (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT, parent_mission_id TEXT, mission_type TEXT NOT NULL, goal TEXT NOT NULL, contract_json TEXT NOT NULL, status TEXT NOT NULL, budget_json TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_mission_work_items (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, owner_id TEXT NOT NULL, parent_work_item_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, dependencies_json TEXT NOT NULL, acceptance_criteria_json TEXT NOT NULL, input_json TEXT NOT NULL, output_json TEXT, attempt INTEGER NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_mission_checkpoints (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, owner_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL, state_json TEXT NOT NULL, next_action TEXT, created_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_mission_events (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, owner_id TEXT NOT NULL, work_item_id TEXT, sequence INTEGER NOT NULL, type TEXT NOT NULL, actor TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(mission_id, sequence))");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_mission_leases (work_item_id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, owner_id TEXT NOT NULL, worker_id TEXT NOT NULL, attempt INTEGER NOT NULL, expires_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL, created_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_mission_artifacts (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, owner_id TEXT NOT NULL, work_item_id TEXT, kind TEXT NOT NULL, locator TEXT NOT NULL, summary TEXT NOT NULL, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_mission_learning_candidates (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, owner_id TEXT NOT NULL, candidate_type TEXT NOT NULL, domain TEXT NOT NULL, title TEXT NOT NULL, content_json TEXT NOT NULL, confidence REAL NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_mission_replays (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, owner_id TEXT NOT NULL, candidate_id TEXT, status TEXT NOT NULL, evidence_json TEXT NOT NULL, created_at TEXT NOT NULL)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_mission_leases_mission ON workspace_mission_leases(mission_id, expires_at ASC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_mission_leases_owner ON workspace_mission_leases(owner_id, expires_at ASC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_mission_artifacts_mission_created ON workspace_mission_artifacts(mission_id, created_at ASC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_mission_learning_mission_status ON workspace_mission_learning_candidates(mission_id, status, created_at ASC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_mission_replays_mission_created ON workspace_mission_replays(mission_id, created_at ASC)");
  db.execute("CREATE INDEX IF NOT EXISTS workspace_mission_intakes_owner_updated ON workspace_mission_intakes(owner_id, updated_at DESC)");
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
  const projects = rows<{ id: string; name: string; description: string; tone: string }>(db.execute(
    "SELECT id, name, description, tone FROM workspace_projects WHERE owner_id = ? ORDER BY updated_at DESC", [ownerId],
  ));
  const threadRows = rows<{ id: string; chat_slug: string | null; title: string; project_id: string | null; updated_at: string }>(db.execute(
    "SELECT id, chat_slug, title, project_id, updated_at FROM workspace_threads WHERE owner_id = ? ORDER BY updated_at DESC", [ownerId],
  ));
  return {
    projects: projects.map((project) => ({ ...project })),
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
    "SELECT id, role, content, created_at FROM workspace_messages WHERE owner_id = ? AND thread_id = ? ORDER BY created_at ASC", [ownerId, thread.id],
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

export type PlaygroundPrompt = { threadId: string; model: string; prompt: string; title?: string; stopNotice?: boolean };
export type PlaygroundStreamResult = { content: string; stopped: boolean; finished: boolean };

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
    const messages = rows<{ role: "user" | "assistant"; content: string }>(db.execute("SELECT role, content FROM workspace_messages WHERE owner_id = ? AND thread_id = ? ORDER BY created_at ASC", [ownerId, threadId]));
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
  const consume = (line: string) => {
    const data = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!data) return;
    if (data === "[DONE]") { finished = true; return; }
    try {
      const payload = JSON.parse(data) as { error?: { message?: unknown }; text?: unknown; choices?: Array<{ text?: unknown; delta?: { content?: unknown; reasoning_content?: unknown; thinking?: unknown }; message?: { content?: unknown }; finish_reason?: unknown }> };
      if (payload.error?.message) throw new ModelProviderError(String(payload.error.message));
      if (payload.choices?.[0]?.finish_reason) finished = true;
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
  return { content, stopped, finished };
}

export async function streamWorkspacePrompt(ownerId: string, input: PlaygroundPrompt, signal: AbortSignal, onToken: (token: string) => void): Promise<PlaygroundStreamResult> {
  const provider = await loadProviderForPlayground(ownerId, input.model);
  const history = await loadThreadMessagesForPlayground(ownerId, input.threadId);
  const title = history.length === 0 ? (input.title || input.prompt.slice(0, 42)) : undefined;
  await appendThreadMessages(ownerId, input.threadId, [{ role: "user", content: input.prompt }], title);
  const messages = [
    ...(input.stopNotice ? [{ role: "system" as const, content: "The user stopped the previous task. Stop immediately, wait, and do not continue that task until the user provides a new request." }] : []),
    ...history,
    { role: "user" as const, content: input.prompt },
  ];
  let response: Response;
  try {
    response = await fetch(`${normalizeProviderBaseUrl(provider.base_url)}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.api_key}`, Accept: "text/event-stream", "Content-Type": "application/json" },
      body: JSON.stringify({ model: input.model, messages, stream: true }),
      signal,
    });
  } catch (error) {
    if (signal.aborted)     return { content: "", stopped: true, finished: false };
    throw error;
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ModelProviderError(`The model API rejected the request: ${response.status} — ${providerErrorDetail(detail)}`, { code: "PROVIDER_HTTP_ERROR", status: response.status });
  }
  const result = await readOpenAICompatibleStream(response, signal, onToken);
  if (result.content) await appendThreadMessages(ownerId, input.threadId, [{ role: "assistant", content: result.content }]);
  return result;
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

export async function createProject(ownerId: string, input: Omit<WorkspaceProject, "id">) {
  return withWorkspaceDb(true, (db) => {
    const id = randomUUID(); const timestamp = now();
    db.execute("INSERT INTO workspace_projects (id, owner_id, name, description, tone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [id, ownerId, input.name, input.description, input.tone, timestamp, timestamp]);
    return { id, ...input };
  });
}

export async function updateProject(ownerId: string, id: string, input: Pick<WorkspaceProject, "name" | "description">) {
  return withWorkspaceDb(true, (db) => {
    const result = db.execute("UPDATE workspace_projects SET name = ?, description = ?, updated_at = ? WHERE id = ? AND owner_id = ?", [input.name, input.description, now(), id, ownerId]);
    if (!result.changes) throw new WorkspaceAccessError("Project not found");
    const project = rows<{ id: string; name: string; description: string; tone: string }>(db.execute("SELECT id, name, description, tone FROM workspace_projects WHERE id = ? AND owner_id = ?", [id, ownerId]))[0];
    return project!;
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

export async function createThread(ownerId: string, projectId?: string | null) {
  return withWorkspaceDb(true, (db) => {
    if (projectId) assertProjectOwner(db, ownerId, projectId);
    const existing = rows<{ id: string; chat_slug: string | null; title: string; project_id: string | null; updated_at: string }>(db.execute(
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
    const inserted: WorkspaceMessage[] = messages.map((message, index) => ({ id: randomUUID(), role: message.role, content: message.content, createdAt: new Date(Date.now() + index).toISOString() }));
    for (const message of inserted) db.execute("INSERT INTO workspace_messages (id, thread_id, owner_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)", [message.id, threadId, ownerId, message.role, message.content, message.createdAt]);
    if (title) db.execute("UPDATE workspace_threads SET title = ?, updated_at = ? WHERE id = ? AND owner_id = ?", [title, timestamp, threadId, ownerId]);
    else db.execute("UPDATE workspace_threads SET updated_at = ? WHERE id = ? AND owner_id = ?", [timestamp, threadId, ownerId]);
    return { threadId, title, updatedAt: timestamp, messages: inserted };
  });
}

export async function migrateWorkspace(ownerId: string, workspace: LegacyWorkspace) {
  return withWorkspaceDb(true, (db) => {
    const imported = rows<{ owner_id: string }>(db.execute("SELECT owner_id FROM workspace_imports WHERE owner_id = ? LIMIT 1", [ownerId]))[0];
    if (imported) return { imported: false };
    for (const project of workspace.projects) {
      const timestamp = now();
      db.execute("INSERT OR IGNORE INTO workspace_projects (id, owner_id, name, description, tone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [project.id, ownerId, project.name, project.description, project.tone, timestamp, timestamp]);
    }
    for (const thread of workspace.threads) {
      const timestamp = thread.updatedAt || now();
      db.execute("INSERT OR IGNORE INTO workspace_threads (id, owner_id, chat_slug, title, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [thread.id, ownerId, chatSlugFor(thread.id), thread.title, thread.projectId || null, timestamp, timestamp]);
      for (const message of thread.messages) db.execute("INSERT OR IGNORE INTO workspace_messages (id, thread_id, owner_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)", [message.id, thread.id, ownerId, message.role, message.content, message.createdAt || timestamp]);
    }
    db.execute("INSERT INTO workspace_imports (owner_id, imported_at) VALUES (?, ?)", [ownerId, now()]);
    return { imported: true };
  });
}

export type WorkspaceModelMessage = { role: "system" | "user" | "assistant" | "tool"; content: string };
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
