import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "parad";

export type WorkspaceProject = { id: string; name: string; description: string; tone: string };
export type WorkspaceMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string };
export type WorkspaceThread = { id: string; chatSlug: string; title: string; projectId?: string; updatedAt: string; messages: WorkspaceMessage[] };
export type DurableWorkspace = { projects: WorkspaceProject[]; threads: WorkspaceThread[] };

export class WorkspaceAccessError extends Error {}

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
  const db = await connect({
    name: "nexuss-agent-workspace",
    project: "nexuss-agent",
    dbPath: process.env.PARADOX_DB_PATH || join(tmpdir(), "nexuss-agent-workspace.db"),
    gatewayUrl,
    apiKey: config.apiKey,
    passphrase: config.passphrase,
    autoSync: false,
    pullOnStartup: true,
  });

  db.execute("CREATE TABLE IF NOT EXISTS workspace_projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, tone TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_threads (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, chat_slug TEXT, title TEXT NOT NULL, project_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, owner_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)");
  db.execute("CREATE TABLE IF NOT EXISTS workspace_imports (owner_id TEXT PRIMARY KEY, imported_at TEXT NOT NULL)");
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
  }, 60_000);
  workspaceDbCloseTimer.unref?.();
}

async function withWorkspaceDb<T>(write: boolean, action: (db: Db) => Promise<T> | T) {
  let release: (() => void) | undefined;
  const previous = workspaceOperationTail;
  workspaceOperationTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  let db: Db | undefined;
  try {
    db = await openWorkspaceDb();
    const result = await action(db);
    if (write && process.env.PARADOX_TEST_SKIP_PUSH !== "1") await db.push();
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

export async function loadWorkspace(ownerId: string): Promise<DurableWorkspace> {
  return withWorkspaceDb(false, (db) => {
    const projects = rows<{ id: string; name: string; description: string; tone: string }>(db.execute(
      "SELECT id, name, description, tone FROM workspace_projects WHERE owner_id = ? ORDER BY updated_at DESC", [ownerId],
    ));
    const threadRows = rows<{ id: string; chat_slug: string | null; title: string; project_id: string | null; updated_at: string }>(db.execute(
      "SELECT id, chat_slug, title, project_id, updated_at FROM workspace_threads WHERE owner_id = ? ORDER BY updated_at DESC", [ownerId],
    ));
    const messageRows = rows<{ id: string; thread_id: string; role: "user" | "assistant"; content: string; created_at: string }>(db.execute(
      "SELECT id, thread_id, role, content, created_at FROM workspace_messages WHERE owner_id = ? ORDER BY created_at ASC", [ownerId],
    ));
    const messagesByThread = new Map<string, WorkspaceMessage[]>();
    for (const message of messageRows) {
      const messages = messagesByThread.get(message.thread_id) || [];
      messages.push({ id: message.id, role: message.role, content: message.content, createdAt: message.created_at });
      messagesByThread.set(message.thread_id, messages);
    }
    return {
      projects: projects.map((project) => ({ ...project })),
      threads: threadRows.map((thread) => ({
        id: thread.id,
        chatSlug: thread.chat_slug || chatSlugFor(thread.id),
        title: thread.title,
        ...(thread.project_id ? { projectId: thread.project_id } : {}),
        updatedAt: thread.updated_at,
        messages: messagesByThread.get(thread.id) || [],
      })),
    };
  });
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
