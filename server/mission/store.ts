import { randomUUID } from "node:crypto";
import {
  assertMissionTransition,
  AUTONOMOUS_REPOSITORY_CHANGE_MISSION_TYPE,
  type AcceptanceCriterion,
  type MissionBudget,
  type MissionRisk,
  type MissionStatus,
  type WorkItemStatus,
} from "./constitution";
import { WorkspaceAccessError, withWorkspaceDb } from "../paradoxWorkspace";

type Db = Parameters<Parameters<typeof withWorkspaceDb>[1]>[0];

type MissionContractInput = {
  deliverables?: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  constraints?: string[];
  assumptions?: string[];
  projectScope?: Record<string, unknown>;
  riskLevel?: MissionRisk;
  autonomyPolicy?: Record<string, unknown>;
  executionBudget?: MissionBudget;
  completionPolicy?: string[];
};

export type CreateMissionInput = {
  projectId?: string | null;
  parentMissionId?: string | null;
  goal: string;
  contract: MissionContractInput;
  budget?: MissionBudget;
};

export type MissionRecord = {
  id: string;
  ownerId: string;
  projectId?: string;
  parentMissionId?: string;
  missionType: typeof AUTONOMOUS_REPOSITORY_CHANGE_MISSION_TYPE;
  goal: string;
  contract: MissionContractInput;
  status: MissionStatus;
  budget: MissionBudget;
  version: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type MissionWorkItem = {
  id: string;
  missionId: string;
  ownerId: string;
  parentWorkItemId?: string;
  title: string;
  description: string;
  role: string;
  status: WorkItemStatus;
  dependencies: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  attempt: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type MissionCheckpoint = {
  id: string;
  missionId: string;
  ownerId: string;
  version: number;
  status: MissionStatus;
  state: Record<string, unknown>;
  nextAction?: string;
  createdAt: string;
};

export type MissionEvent = {
  id: string;
  missionId: string;
  ownerId: string;
  workItemId?: string;
  sequence: number;
  type: string;
  actor: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type MissionSnapshot = {
  mission: MissionRecord;
  workItems: MissionWorkItem[];
  latestCheckpoint?: MissionCheckpoint;
  events: MissionEvent[];
};

const DEFAULT_BUDGET: MissionBudget = {
  maxDepth: 3,
  maxChildWorkItems: 32,
  maxAgentAttempts: 3,
  maxToolCalls: 120,
  maxModelTokens: 120_000,
  maxDurationSeconds: 1_800,
};

function rows<T>(result: { rows: unknown[] }) { return result.rows as T[]; }
function timestamp() { return new Date().toISOString(); }
function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try { return JSON.parse(value || "") as T; } catch { return fallback; }
}
function json(value: unknown) { return JSON.stringify(value); }

function assertSafeEventPayload(payload: Record<string, unknown>) {
  const serialized = JSON.stringify(payload);
  if (serialized.length > 32_000) throw new Error("Mission event payload exceeds the 32KB safety limit");
  if (/(api[_-]?key|authorization|cookie|passphrase|password|secret|token)/i.test(serialized)) throw new Error("Mission event payload contains a prohibited secret field");
}

function nextEventSequence(db: Db, missionId: string, ownerId: string) {
  return rows<{ sequence: number }>(db.execute("SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM workspace_mission_events WHERE mission_id = ? AND owner_id = ?", [missionId, ownerId]))[0]?.sequence || 1;
}

function insertMissionEvent(db: Db, ownerId: string, missionId: string, input: { type: string; actor: string; workItemId?: string; payload?: Record<string, unknown> }, createdAt = timestamp()) {
  const payload = input.payload || {};
  assertSafeEventPayload(payload);
  const id = randomUUID();
  const sequence = nextEventSequence(db, missionId, ownerId);
  db.execute("INSERT INTO workspace_mission_events (id, mission_id, owner_id, work_item_id, sequence, type, actor, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, missionId, ownerId, input.workItemId || null, sequence, input.type, input.actor, json(payload), createdAt]);
  return readEvent(rows<Parameters<typeof readEvent>[0]>(db.execute("SELECT id, mission_id, owner_id, work_item_id, sequence, type, actor, payload_json, created_at FROM workspace_mission_events WHERE id = ? AND owner_id = ?", [id, ownerId]))[0]);
}

function insertCheckpoint(db: Db, ownerId: string, missionId: string, input: { version: number; status: MissionStatus; state: Record<string, unknown>; nextAction?: string }, createdAt = timestamp()) {
  const id = randomUUID();
  db.execute("INSERT INTO workspace_mission_checkpoints (id, mission_id, owner_id, version, status, state_json, next_action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, missionId, ownerId, input.version, input.status, json(input.state), input.nextAction || null, createdAt]);
  return readCheckpoint(rows<Parameters<typeof readCheckpoint>[0]>(db.execute("SELECT id, mission_id, owner_id, version, status, state_json, next_action, created_at FROM workspace_mission_checkpoints WHERE id = ? AND owner_id = ?", [id, ownerId]))[0]);
}

function assertOwner(db: Db, ownerId: string, missionId: string) {
  const row = rows<{ id: string }>(db.execute("SELECT id FROM workspace_missions WHERE id = ? AND owner_id = ? LIMIT 1", [missionId, ownerId]))[0];
  if (!row) throw new WorkspaceAccessError("Mission not found");
}

function assertProject(db: Db, ownerId: string, projectId: string) {
  const row = rows<{ id: string }>(db.execute("SELECT id FROM workspace_projects WHERE id = ? AND owner_id = ? LIMIT 1", [projectId, ownerId]))[0];
  if (!row) throw new WorkspaceAccessError("Project not found");
}

function readMission(row: {
  id: string;
  owner_id: string;
  project_id: string | null;
  parent_mission_id: string | null;
  mission_type: typeof AUTONOMOUS_REPOSITORY_CHANGE_MISSION_TYPE;
  goal: string;
  contract_json: string;
  status: MissionStatus;
  budget_json: string;
  version: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}): MissionRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.parent_mission_id ? { parentMissionId: row.parent_mission_id } : {}),
    missionType: row.mission_type,
    goal: row.goal,
    contract: parseJson<MissionContractInput>(row.contract_json, { acceptanceCriteria: [] }),
    status: row.status,
    budget: parseJson<MissionBudget>(row.budget_json, DEFAULT_BUDGET),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
  };
}

function readWorkItem(row: {
  id: string;
  mission_id: string;
  owner_id: string;
  parent_work_item_id: string | null;
  title: string;
  description: string;
  role: string;
  status: WorkItemStatus;
  dependencies_json: string;
  acceptance_criteria_json: string;
  input_json: string;
  output_json: string | null;
  attempt: number;
  version: number;
  created_at: string;
  updated_at: string;
}): MissionWorkItem {
  return {
    id: row.id,
    missionId: row.mission_id,
    ownerId: row.owner_id,
    ...(row.parent_work_item_id ? { parentWorkItemId: row.parent_work_item_id } : {}),
    title: row.title,
    description: row.description,
    role: row.role,
    status: row.status,
    dependencies: parseJson<string[]>(row.dependencies_json, []),
    acceptanceCriteria: parseJson<AcceptanceCriterion[]>(row.acceptance_criteria_json, []),
    input: parseJson<Record<string, unknown>>(row.input_json, {}),
    ...(row.output_json ? { output: parseJson<Record<string, unknown>>(row.output_json, {}) } : {}),
    attempt: row.attempt,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readCheckpoint(row: {
  id: string;
  mission_id: string;
  owner_id: string;
  version: number;
  status: MissionStatus;
  state_json: string;
  next_action: string | null;
  created_at: string;
}): MissionCheckpoint {
  return {
    id: row.id,
    missionId: row.mission_id,
    ownerId: row.owner_id,
    version: row.version,
    status: row.status,
    state: parseJson<Record<string, unknown>>(row.state_json, {}),
    ...(row.next_action ? { nextAction: row.next_action } : {}),
    createdAt: row.created_at,
  };
}

function readEvent(row: {
  id: string;
  mission_id: string;
  owner_id: string;
  work_item_id: string | null;
  sequence: number;
  type: string;
  actor: string;
  payload_json: string;
  created_at: string;
}): MissionEvent {
  return {
    id: row.id,
    missionId: row.mission_id,
    ownerId: row.owner_id,
    ...(row.work_item_id ? { workItemId: row.work_item_id } : {}),
    sequence: row.sequence,
    type: row.type,
    actor: row.actor,
    payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    createdAt: row.created_at,
  };
}

function readMissionRow(db: Db, ownerId: string, missionId: string) {
  const row = rows<Parameters<typeof readMission>[0]>(db.execute("SELECT id, owner_id, project_id, parent_mission_id, mission_type, goal, contract_json, status, budget_json, version, created_at, updated_at, started_at, finished_at FROM workspace_missions WHERE id = ? AND owner_id = ? LIMIT 1", [missionId, ownerId]))[0];
  if (!row) throw new WorkspaceAccessError("Mission not found");
  return row;
}

export async function createMission(ownerId: string, input: CreateMissionInput): Promise<MissionSnapshot> {
  return withWorkspaceDb(true, (db) => {
    if (input.projectId) assertProject(db, ownerId, input.projectId);
    if (input.parentMissionId) assertOwner(db, ownerId, input.parentMissionId);
    const id = randomUUID();
    const createdAt = timestamp();
    const budget = input.budget || DEFAULT_BUDGET;
    db.execute("INSERT INTO workspace_missions (id, owner_id, project_id, parent_mission_id, mission_type, goal, contract_json, status, budget_json, version, created_at, updated_at, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, ownerId, input.projectId || null, input.parentMissionId || null, AUTONOMOUS_REPOSITORY_CHANGE_MISSION_TYPE, input.goal, json(input.contract), "created", json(budget), 1, createdAt, createdAt, null, null]);
    const checkpoint = insertCheckpoint(db, ownerId, id, { version: 1, status: "created", state: {}, nextAction: "queue mission" }, createdAt);
    const event = insertMissionEvent(db, ownerId, id, { type: "mission.created", actor: "system", payload: { missionType: AUTONOMOUS_REPOSITORY_CHANGE_MISSION_TYPE } }, createdAt);
    return { mission: readMission(readMissionRow(db, ownerId, id)), workItems: [], events: [event], latestCheckpoint: checkpoint };
  });
}

export async function getMission(ownerId: string, missionId: string): Promise<MissionSnapshot> {
  return withWorkspaceDb(false, (db) => {
    const mission = readMission(readMissionRow(db, ownerId, missionId));
    const workItems = rows<Parameters<typeof readWorkItem>[0]>(db.execute("SELECT id, mission_id, owner_id, parent_work_item_id, title, description, role, status, dependencies_json, acceptance_criteria_json, input_json, output_json, attempt, version, created_at, updated_at FROM workspace_mission_work_items WHERE mission_id = ? AND owner_id = ? ORDER BY created_at ASC", [missionId, ownerId])).map(readWorkItem);
    const checkpoints = rows<Parameters<typeof readCheckpoint>[0]>(db.execute("SELECT id, mission_id, owner_id, version, status, state_json, next_action, created_at FROM workspace_mission_checkpoints WHERE mission_id = ? AND owner_id = ? ORDER BY version DESC LIMIT 1", [missionId, ownerId]));
    const events = rows<Parameters<typeof readEvent>[0]>(db.execute("SELECT id, mission_id, owner_id, work_item_id, sequence, type, actor, payload_json, created_at FROM workspace_mission_events WHERE mission_id = ? AND owner_id = ? ORDER BY sequence ASC", [missionId, ownerId])).map(readEvent);
    return { mission, workItems, events, ...(checkpoints[0] ? { latestCheckpoint: readCheckpoint(checkpoints[0]) } : {}) };
  });
}

export async function listMissions(ownerId: string, projectId?: string): Promise<MissionRecord[]> {
  return withWorkspaceDb(false, (db) => rows<Parameters<typeof readMission>[0]>(db.execute(`SELECT id, owner_id, project_id, parent_mission_id, mission_type, goal, contract_json, status, budget_json, version, created_at, updated_at, started_at, finished_at FROM workspace_missions WHERE owner_id = ?${projectId ? " AND project_id = ?" : ""} ORDER BY updated_at DESC`, projectId ? [ownerId, projectId] : [ownerId])).map(readMission));
}

export async function transitionMission(ownerId: string, missionId: string, from: MissionStatus, to: MissionStatus, expectedVersion: number, actor: string, payload: Record<string, unknown> = {}): Promise<MissionRecord> {
  assertMissionTransition(from, to);
  assertSafeEventPayload(payload);
  return withWorkspaceDb(true, (db) => {
    const current = readMission(readMissionRow(db, ownerId, missionId));
    if (current.status !== from) throw new Error(`Mission status conflict: expected ${from}, found ${current.status}`);
    if (current.version !== expectedVersion) throw new Error(`Mission version conflict: expected ${expectedVersion}, found ${current.version}`);
    const nextVersion = current.version + 1;
    const changedAt = timestamp();
    const startedAt = current.startedAt || (to === "executing" || to === "planning" ? changedAt : undefined);
    const finishedAt = to === "completed" || to === "stopped" || to === "failed" ? changedAt : current.finishedAt;
    const result = db.execute("UPDATE workspace_missions SET status = ?, version = ?, updated_at = ?, started_at = ?, finished_at = ? WHERE id = ? AND owner_id = ? AND status = ? AND version = ?", [to, nextVersion, changedAt, startedAt || null, finishedAt || null, missionId, ownerId, from, expectedVersion]);
    if (!result.changes) throw new Error("Mission transition was lost to a concurrent update");
    insertMissionEvent(db, ownerId, missionId, { type: `mission.${to}`, actor, payload }, changedAt);
    insertCheckpoint(db, ownerId, missionId, { version: nextVersion, status: to, state: { previousStatus: from, transitionPayload: payload }, nextAction: `continue ${to}` }, changedAt);
    return readMission(readMissionRow(db, ownerId, missionId));
  });
}

export async function createWorkItem(ownerId: string, missionId: string, input: { parentWorkItemId?: string | null; title: string; description: string; role: string; dependencies?: string[]; acceptanceCriteria?: AcceptanceCriterion[]; input?: Record<string, unknown> }): Promise<MissionWorkItem> {
  return withWorkspaceDb(true, (db) => {
    assertOwner(db, ownerId, missionId);
    if (input.parentWorkItemId) {
      const parent = rows<{ id: string }>(db.execute("SELECT id FROM workspace_mission_work_items WHERE id = ? AND mission_id = ? AND owner_id = ? LIMIT 1", [input.parentWorkItemId, missionId, ownerId]))[0];
      if (!parent) throw new WorkspaceAccessError("Parent work item not found");
    }
    assertSafeEventPayload(input.input || {});
    const id = randomUUID();
    const createdAt = timestamp();
    db.execute("INSERT INTO workspace_mission_work_items (id, mission_id, owner_id, parent_work_item_id, title, description, role, status, dependencies_json, acceptance_criteria_json, input_json, output_json, attempt, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, missionId, ownerId, input.parentWorkItemId || null, input.title, input.description, input.role, "pending", json(input.dependencies || []), json(input.acceptanceCriteria || []), json(input.input || {}), null, 0, 1, createdAt, createdAt]);
    insertMissionEvent(db, ownerId, missionId, { type: "work_item.created", actor: "system", workItemId: id, payload: { title: input.title, role: input.role } }, createdAt);
    return readWorkItem(rows<Parameters<typeof readWorkItem>[0]>(db.execute("SELECT id, mission_id, owner_id, parent_work_item_id, title, description, role, status, dependencies_json, acceptance_criteria_json, input_json, output_json, attempt, version, created_at, updated_at FROM workspace_mission_work_items WHERE id = ? AND owner_id = ?", [id, ownerId]))[0]);
  });
}

export async function updateWorkItem(ownerId: string, workItemId: string, patch: { status?: WorkItemStatus; output?: Record<string, unknown>; expectedVersion: number; attempt?: number }): Promise<MissionWorkItem> {
  return withWorkspaceDb(true, (db) => {
    const current = rows<Parameters<typeof readWorkItem>[0]>(db.execute("SELECT id, mission_id, owner_id, parent_work_item_id, title, description, role, status, dependencies_json, acceptance_criteria_json, input_json, output_json, attempt, version, created_at, updated_at FROM workspace_mission_work_items WHERE id = ? AND owner_id = ? LIMIT 1", [workItemId, ownerId]))[0];
    if (!current) throw new WorkspaceAccessError("Work item not found");
    if (current.version !== patch.expectedVersion) throw new Error(`Work-item version conflict: expected ${patch.expectedVersion}, found ${current.version}`);
    assertSafeEventPayload(patch.output || {});
    const updatedAt = timestamp();
    const nextVersion = current.version + 1;
    const nextStatus = patch.status || current.status;
    const nextAttempt = patch.attempt ?? current.attempt;
    const result = db.execute("UPDATE workspace_mission_work_items SET status = ?, output_json = ?, attempt = ?, version = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ?", [nextStatus, patch.output === undefined ? current.output_json : json(patch.output), nextAttempt, nextVersion, updatedAt, workItemId, ownerId, patch.expectedVersion]);
    if (!result.changes) throw new Error("Work-item update was lost to a concurrent update");
    insertMissionEvent(db, ownerId, current.mission_id, { type: "work_item.updated", actor: "system", workItemId: workItemId, payload: { status: nextStatus, version: nextVersion, attempt: nextAttempt } }, updatedAt);
    return readWorkItem(rows<Parameters<typeof readWorkItem>[0]>(db.execute("SELECT id, mission_id, owner_id, parent_work_item_id, title, description, role, status, dependencies_json, acceptance_criteria_json, input_json, output_json, attempt, version, created_at, updated_at FROM workspace_mission_work_items WHERE id = ? AND owner_id = ?", [workItemId, ownerId]))[0]);
  });
}

export async function saveMissionCheckpoint(ownerId: string, missionId: string, input: { version: number; status: MissionStatus; state: Record<string, unknown>; nextAction?: string }): Promise<MissionCheckpoint> {
  return withWorkspaceDb(true, (db) => {
    const mission = readMission(readMissionRow(db, ownerId, missionId));
    if (input.version < mission.version) throw new Error(`Checkpoint version conflict: expected at least ${mission.version}, found ${input.version}`);
    const createdAt = timestamp();
    const checkpoint = insertCheckpoint(db, ownerId, missionId, input, createdAt);
    insertMissionEvent(db, ownerId, missionId, { type: "checkpoint.saved", actor: "system", payload: { version: input.version, status: input.status, nextAction: input.nextAction || null } }, createdAt);
    return checkpoint;
  });
}

export async function appendMissionEvent(ownerId: string, missionId: string, input: { type: string; actor: string; workItemId?: string; payload?: Record<string, unknown> }): Promise<MissionEvent> {
  return withWorkspaceDb(true, (db) => {
    assertOwner(db, ownerId, missionId);
    const payload = input.payload || {};
    assertSafeEventPayload(payload);
    if (input.workItemId) {
      const item = rows<{ id: string }>(db.execute("SELECT id FROM workspace_mission_work_items WHERE id = ? AND mission_id = ? AND owner_id = ? LIMIT 1", [input.workItemId, missionId, ownerId]))[0];
      if (!item) throw new WorkspaceAccessError("Work item not found");
    }
    return insertMissionEvent(db, ownerId, missionId, input);
  });
}
