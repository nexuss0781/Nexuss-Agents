import { nanoid } from "nanoid";
import type { InsertUser, LocalAccount, Project, Thread, ThreadMessage, User } from "../drizzle/schema";
import { getParadoxDb } from "./paradox";
import { ENV } from "./_core/env";

type Row = Record<string, unknown>;

const asDate = (value: unknown) => new Date(Number(value));
const now = () => Date.now();

function mapUser(row: Row): User {
  return {
    id: Number(row.id),
    openId: String(row.openId),
    name: row.name == null ? null : String(row.name),
    email: row.email == null ? null : String(row.email),
    loginMethod: row.loginMethod == null ? null : String(row.loginMethod),
    role: (row.role === "admin" ? "admin" : "user") as User["role"],
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
    lastSignedIn: asDate(row.lastSignedIn),
  };
}

function mapProject(row: Row): Project {
  return {
    id: Number(row.id),
    userId: Number(row.userId),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    color: String(row.color),
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
  };
}

function mapThread(row: Row): Thread {
  return {
    id: Number(row.id),
    userId: Number(row.userId),
    projectId: row.projectId == null ? null : Number(row.projectId),
    title: String(row.title),
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
  };
}

function mapMessage(row: Row): ThreadMessage {
  return {
    id: Number(row.id),
    threadId: Number(row.threadId),
    userId: Number(row.userId),
    role: (row.role === "assistant" ? "assistant" : "user") as ThreadMessage["role"],
    content: String(row.content),
    createdAt: asDate(row.createdAt),
  };
}

export async function getDb() {
  return getParadoxDb();
}

async function db() {
  return getParadoxDb();
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const connection = await db();
  const timestamp = (user.lastSignedIn ?? new Date()).getTime();
  const existing = connection.execute("SELECT id FROM users WHERE openId = ? LIMIT 1", [user.openId]).rows[0] as Row | undefined;
  if (existing) {
    connection.execute(
      "UPDATE users SET name = ?, email = ?, loginMethod = ?, role = ?, updatedAt = ?, lastSignedIn = ? WHERE openId = ?",
      [user.name ?? null, user.email ?? null, user.loginMethod ?? null, user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user"), timestamp, timestamp, user.openId],
    );
    await connection.push();
    return;
  }
  connection.execute(
    "INSERT INTO users (openId, name, email, loginMethod, role, createdAt, updatedAt, lastSignedIn) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [user.openId, user.name ?? null, user.email ?? null, user.loginMethod ?? null, user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user"), timestamp, timestamp, timestamp],
  );
  await connection.push();
}

export async function getUserByOpenId(openId: string) {
  const connection = await db();
  const row = connection.execute("SELECT * FROM users WHERE openId = ? LIMIT 1", [openId]).rows[0] as Row | undefined;
  return row ? mapUser(row) : undefined;
}

export async function getUserById(id: number) {
  const connection = await db();
  const row = connection.execute("SELECT * FROM users WHERE id = ? LIMIT 1", [id]).rows[0] as Row | undefined;
  return row ? mapUser(row) : undefined;
}

export async function getLocalAccountByEmail(email: string): Promise<{ account: LocalAccount; user: User } | undefined> {
  const connection = await db();
  const row = connection.execute(
    "SELECT a.*, u.openId, u.name, u.email AS userEmail, u.loginMethod, u.role, u.createdAt AS userCreatedAt, u.updatedAt AS userUpdatedAt, u.lastSignedIn FROM localAccounts a JOIN users u ON u.id = a.userId WHERE a.email = ? LIMIT 1",
    [email.trim().toLowerCase()],
  ).rows[0] as Row | undefined;
  if (!row) return undefined;
  const account: LocalAccount = {
    id: Number(row.id), userId: Number(row.userId), email: String(row.email), passwordHash: String(row.passwordHash),
    createdAt: asDate(row.createdAt), updatedAt: asDate(row.updatedAt),
  };
  const user: User = {
    id: Number(row.userId), openId: String(row.openId), name: row.name == null ? null : String(row.name),
    email: row.userEmail == null ? null : String(row.userEmail), loginMethod: row.loginMethod == null ? null : String(row.loginMethod),
    role: (row.role === "admin" ? "admin" : "user") as User["role"], createdAt: asDate(row.userCreatedAt), updatedAt: asDate(row.userUpdatedAt), lastSignedIn: asDate(row.lastSignedIn),
  };
  return { account, user };
}

export async function createLocalUser(input: { name: string; email: string; passwordHash: string }): Promise<User> {
  const connection = await db();
  const email = input.email.trim().toLowerCase();
  const existing = await getLocalAccountByEmail(email);
  if (existing) throw new Error("An account already exists for this email address");
  const timestamp = now();
  connection.execute("BEGIN");
  try {
    const result = connection.execute(
      "INSERT INTO users (openId, name, email, loginMethod, role, createdAt, updatedAt, lastSignedIn) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [`local_${nanoid(21)}`, input.name.trim(), email, "password", "user", timestamp, timestamp, timestamp],
    );
    const userId = Number(result.lastInsertRowid);
    connection.execute("INSERT INTO localAccounts (userId, email, passwordHash, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)", [userId, email, input.passwordHash, timestamp, timestamp]);
    connection.execute("COMMIT");
    const user = await getUserById(userId);
    if (!user) throw new Error("Created user could not be reloaded");
    return user;
  } catch (error) {
    connection.execute("ROLLBACK");
    throw error;
  }
}

export async function touchLastSignedIn(userId: number) {
  const connection = await db();
  const timestamp = now();
  connection.execute("UPDATE users SET lastSignedIn = ?, updatedAt = ? WHERE id = ?", [timestamp, timestamp, userId]);
}

export async function listProjects(userId: number): Promise<Project[]> {
  const connection = await db();
  return connection.execute("SELECT * FROM projects WHERE userId = ? ORDER BY updatedAt DESC", [userId]).rows.map(row => mapProject(row as Row));
}

export async function getProjectForUser(projectId: number, userId: number) {
  const connection = await db();
  const row = connection.execute("SELECT * FROM projects WHERE id = ? AND userId = ? LIMIT 1", [projectId, userId]).rows[0] as Row | undefined;
  return row ? mapProject(row) : undefined;
}

export async function createProject(input: { userId: number; name: string; description?: string | null; color: string }) {
  const connection = await db();
  const timestamp = now();
  const result = connection.execute("INSERT INTO projects (userId, name, description, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)", [input.userId, input.name, input.description ?? null, input.color, timestamp, timestamp]);
  const row = connection.execute("SELECT * FROM projects WHERE id = ? LIMIT 1", [Number(result.lastInsertRowid)]).rows[0] as Row;
  return mapProject(row);
}

export async function updateProject(input: { id: number; userId: number; name?: string; description?: string | null; color?: string }) {
  const connection = await db();
  const fields: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) { fields.push("name = ?"); params.push(input.name); }
  if (input.description !== undefined) { fields.push("description = ?"); params.push(input.description); }
  if (input.color !== undefined) { fields.push("color = ?"); params.push(input.color); }
  if (fields.length) {
    fields.push("updatedAt = ?"); params.push(now(), input.id, input.userId);
    connection.execute(`UPDATE projects SET ${fields.join(", ")} WHERE id = ? AND userId = ?`, params);
  }
  return getProjectForUser(input.id, input.userId);
}

export async function deleteProject(id: number, userId: number) {
  const connection = await db();
  const timestamp = now();
  connection.execute("UPDATE threads SET projectId = NULL, updatedAt = ? WHERE projectId = ? AND userId = ?", [timestamp, id, userId]);
  connection.execute("DELETE FROM projects WHERE id = ? AND userId = ?", [id, userId]);
}

export type ThreadSummary = Thread & {
  project: Pick<Project, "id" | "name" | "color"> | null;
  latestMessage: { content: string; role: "user" | "assistant"; createdAt: Date } | null;
};

export async function listThreads(userId: number): Promise<ThreadSummary[]> {
  const connection = await db();
  const rows = connection.execute("SELECT * FROM threads WHERE userId = ? ORDER BY updatedAt DESC", [userId]).rows;
  return rows.map(row => {
    const thread = mapThread(row as Row);
    const projectRow = thread.projectId == null ? undefined : connection.execute("SELECT * FROM projects WHERE id = ? AND userId = ? LIMIT 1", [thread.projectId, userId]).rows[0] as Row | undefined;
    const latest = connection.execute("SELECT * FROM threadMessages WHERE threadId = ? AND userId = ? ORDER BY createdAt DESC, id DESC LIMIT 1", [thread.id, userId]).rows[0] as Row | undefined;
    return {
      ...thread,
      project: projectRow ? { id: Number(projectRow.id), name: String(projectRow.name), color: String(projectRow.color) } : null,
      latestMessage: latest ? { content: String(latest.content), role: (latest.role === "assistant" ? "assistant" : "user"), createdAt: asDate(latest.createdAt) } : null,
    };
  });
}

export async function getThreadForUser(id: number, userId: number) {
  const connection = await db();
  const row = connection.execute("SELECT * FROM threads WHERE id = ? AND userId = ? LIMIT 1", [id, userId]).rows[0] as Row | undefined;
  return row ? mapThread(row) : undefined;
}

export async function createThread(userId: number, title = "New conversation") {
  const connection = await db();
  const timestamp = now();
  const result = connection.execute("INSERT INTO threads (userId, title, createdAt, updatedAt) VALUES (?, ?, ?, ?)", [userId, title, timestamp, timestamp]);
  return getThreadForUser(Number(result.lastInsertRowid), userId);
}

export async function updateThread(input: { id: number; userId: number; title?: string; projectId?: number | null }) {
  const connection = await db();
  const fields: string[] = [];
  const params: unknown[] = [];
  if (input.title !== undefined) { fields.push("title = ?"); params.push(input.title); }
  if (input.projectId !== undefined) { fields.push("projectId = ?"); params.push(input.projectId); }
  if (fields.length) {
    fields.push("updatedAt = ?"); params.push(now(), input.id, input.userId);
    connection.execute(`UPDATE threads SET ${fields.join(", ")} WHERE id = ? AND userId = ?`, params);
  }
  return getThreadForUser(input.id, input.userId);
}

export async function deleteThread(id: number, userId: number) {
  const connection = await db();
  connection.execute("DELETE FROM threadMessages WHERE threadId = ? AND userId = ?", [id, userId]);
  connection.execute("DELETE FROM threads WHERE id = ? AND userId = ?", [id, userId]);
}

export async function listThreadMessages(threadId: number, userId: number) {
  const connection = await db();
  return connection.execute("SELECT * FROM threadMessages WHERE threadId = ? AND userId = ? ORDER BY createdAt ASC, id ASC", [threadId, userId]).rows.map(row => mapMessage(row as Row));
}

export async function createThreadMessage(input: { threadId: number; userId: number; role: "user" | "assistant"; content: string }) {
  const connection = await db();
  const timestamp = now();
  const result = connection.execute("INSERT INTO threadMessages (threadId, userId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)", [input.threadId, input.userId, input.role, input.content, timestamp]);
  connection.execute("UPDATE threads SET updatedAt = ? WHERE id = ? AND userId = ?", [timestamp, input.threadId, input.userId]);
  const row = connection.execute("SELECT * FROM threadMessages WHERE id = ? LIMIT 1", [Number(result.lastInsertRowid)]).rows[0] as Row;
  return mapMessage(row);
}
