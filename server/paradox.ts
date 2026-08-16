import { connect, type ParadConnection } from "parad";
import { ENV } from "./_core/env";

let connectionPromise: Promise<ParadConnection> | null = null;
let schemaPromise: Promise<void> | null = null;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    openId TEXT NOT NULL UNIQUE,
    name TEXT,
    email TEXT,
    loginMethod TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    lastSignedIn INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    userId INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT NOT NULL DEFAULT '#00FF88',
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS projects_user_updated_idx ON projects(userId, updatedAt)`,
  `CREATE TABLE IF NOT EXISTS threads (
    id INTEGER PRIMARY KEY,
    userId INTEGER NOT NULL,
    projectId INTEGER,
    title TEXT NOT NULL DEFAULT 'New conversation',
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS threads_user_updated_idx ON threads(userId, updatedAt)`,
  `CREATE INDEX IF NOT EXISTS threads_project_idx ON threads(projectId)`,
  `CREATE TABLE IF NOT EXISTS threadMessages (
    id INTEGER PRIMARY KEY,
    threadId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS messages_thread_created_idx ON threadMessages(threadId, createdAt)`,
  `CREATE INDEX IF NOT EXISTS messages_user_thread_idx ON threadMessages(userId, threadId)`,
  `CREATE TABLE IF NOT EXISTS localAccounts (
    id INTEGER PRIMARY KEY,
    userId INTEGER NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  )`,
];

async function ensureSchema(db: ParadConnection) {
  for (const statement of schemaStatements) db.execute(statement);
  await db.push();
}

export async function getParadoxDb(): Promise<ParadConnection> {
  if (!connectionPromise) {
    if (!ENV.paradoxApiKey || !ENV.paradoxPassphrase) {
      throw new Error("Paradox-DB credentials are not configured");
    }

    connectionPromise = connect({
      name: ENV.paradoxDatabaseName,
      project: ENV.paradoxProjectName,
      passphrase: ENV.paradoxPassphrase,
      gatewayUrl: ENV.paradoxGatewayUrl,
      apiKey: ENV.paradoxApiKey,
      dbPath: process.env.PARADOX_DB_PATH ?? "/tmp/nexuss-agent.paradox.db",
      autoSync: true,
      pullOnStartup: true,
    });
  }

  const db = await connectionPromise;
  if (!schemaPromise) schemaPromise = ensureSchema(db);
  await schemaPromise;
  return db;
}

export async function closeParadoxDb() {
  if (!connectionPromise) return;
  const db = await connectionPromise;
  db.close();
  connectionPromise = null;
  schemaPromise = null;
}
