import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  localAccounts,
  projects,
  Project,
  threadMessages,
  threads,
  Thread,
  User,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { nanoid } from "nanoid";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId, lastSignedIn: user.lastSignedIn ?? new Date() };
  const updateSet: Record<string, unknown> = { lastSignedIn: values.lastSignedIn };
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  values.role = user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user");
  updateSet.role = values.role;
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function getLocalAccountByEmail(email: string) {
  const db = await requireDb();
  const result = await db
    .select({ account: localAccounts, user: users })
    .from(localAccounts)
    .innerJoin(users, eq(localAccounts.userId, users.id))
    .where(eq(localAccounts.email, email.trim().toLowerCase()))
    .limit(1);
  return result[0];
}

export async function createLocalUser(input: { name: string; email: string; passwordHash: string }): Promise<User> {
  const db = await requireDb();
  const email = input.email.trim().toLowerCase();
  const existing = await getLocalAccountByEmail(email);
  if (existing) throw new Error("An account already exists for this email address");

  return db.transaction(async tx => {
    const now = new Date();
    const inserted = await tx.insert(users).values({
      openId: `local_${nanoid(21)}`,
      name: input.name.trim(),
      email,
      loginMethod: "password",
      role: "user",
      lastSignedIn: now,
    });
    const userId = Number(inserted[0].insertId);
    await tx.insert(localAccounts).values({ userId, email, passwordHash: input.passwordHash });
    const user = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    return user[0]!;
  });
}

export async function touchLastSignedIn(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, userId));
}

export async function listProjects(userId: number): Promise<Project[]> {
  const db = await requireDb();
  return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.updatedAt));
}

export async function getProjectForUser(projectId: number, userId: number) {
  const db = await requireDb();
  const result = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId))).limit(1);
  return result[0];
}

export async function createProject(input: { userId: number; name: string; description?: string | null; color: string }) {
  const db = await requireDb();
  const result = await db.insert(projects).values(input);
  const inserted = await db.select().from(projects).where(eq(projects.id, Number(result[0].insertId))).limit(1);
  return inserted[0]!;
}

export async function updateProject(input: { id: number; userId: number; name?: string; description?: string | null; color?: string }) {
  const db = await requireDb();
  const updates = { ...input, updatedAt: new Date() };
  delete (updates as Partial<typeof input>).id;
  delete (updates as Partial<typeof input>).userId;
  await db.update(projects).set(updates).where(and(eq(projects.id, input.id), eq(projects.userId, input.userId)));
  return getProjectForUser(input.id, input.userId);
}

export async function deleteProject(id: number, userId: number) {
  const db = await requireDb();
  await db.update(threads).set({ projectId: null, updatedAt: new Date() }).where(and(eq(threads.projectId, id), eq(threads.userId, userId)));
  await db.delete(projects).where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

export type ThreadSummary = Thread & {
  project: Pick<Project, "id" | "name" | "color"> | null;
  latestMessage: { content: string; role: "user" | "assistant"; createdAt: Date } | null;
};

export async function listThreads(userId: number): Promise<ThreadSummary[]> {
  const db = await requireDb();
  const userThreads = await db.select().from(threads).where(eq(threads.userId, userId)).orderBy(desc(threads.updatedAt));
  return Promise.all(userThreads.map(async thread => {
    const [project, latest] = await Promise.all([
      thread.projectId ? getProjectForUser(thread.projectId, userId) : Promise.resolve(undefined),
      db.select().from(threadMessages).where(and(eq(threadMessages.threadId, thread.id), eq(threadMessages.userId, userId))).orderBy(desc(threadMessages.createdAt)).limit(1),
    ]);
    return {
      ...thread,
      project: project ? { id: project.id, name: project.name, color: project.color } : null,
      latestMessage: latest[0] ? { content: latest[0].content, role: latest[0].role, createdAt: latest[0].createdAt } : null,
    };
  }));
}

export async function getThreadForUser(id: number, userId: number) {
  const db = await requireDb();
  const result = await db.select().from(threads).where(and(eq(threads.id, id), eq(threads.userId, userId))).limit(1);
  return result[0];
}

export async function createThread(userId: number, title = "New conversation") {
  const db = await requireDb();
  const result = await db.insert(threads).values({ userId, title });
  return getThreadForUser(Number(result[0].insertId), userId);
}

export async function updateThread(input: { id: number; userId: number; title?: string; projectId?: number | null }) {
  const db = await requireDb();
  const updates = { ...input, updatedAt: new Date() };
  delete (updates as Partial<typeof input>).id;
  delete (updates as Partial<typeof input>).userId;
  await db.update(threads).set(updates).where(and(eq(threads.id, input.id), eq(threads.userId, input.userId)));
  return getThreadForUser(input.id, input.userId);
}

export async function deleteThread(id: number, userId: number) {
  const db = await requireDb();
  await db.delete(threadMessages).where(and(eq(threadMessages.threadId, id), eq(threadMessages.userId, userId)));
  await db.delete(threads).where(and(eq(threads.id, id), eq(threads.userId, userId)));
}

export async function listThreadMessages(threadId: number, userId: number) {
  const db = await requireDb();
  return db.select().from(threadMessages).where(and(eq(threadMessages.threadId, threadId), eq(threadMessages.userId, userId))).orderBy(threadMessages.createdAt);
}

export async function createThreadMessage(input: { threadId: number; userId: number; role: "user" | "assistant"; content: string }) {
  const db = await requireDb();
  const result = await db.insert(threadMessages).values(input);
  await db.update(threads).set({ updatedAt: new Date() }).where(and(eq(threads.id, input.threadId), eq(threads.userId, input.userId)));
  const inserted = await db.select().from(threadMessages).where(eq(threadMessages.id, Number(result[0].insertId))).limit(1);
  return inserted[0]!;
}
