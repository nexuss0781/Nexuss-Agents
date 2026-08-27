import { mkdir, rm } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const sessions = new Map<string, Record<string, unknown>>();
  const events = new Map<string, Record<string, unknown>[]>();
  const projects = new Set(["project-1"]);
  const db = {
    execute(sql: string, params: unknown[] = []) {
      if (sql.includes("SELECT id, workspace_status FROM workspace_projects")) {
        return { rows: projects.has(String(params[0])) ? [{ id: String(params[0]), workspace_status: "ready" }] : [] };
      }
      if (sql.includes("INSERT INTO workspace_terminal_sessions")) {
        sessions.set(String(params[0]), {
          id: params[0], request_id: params[1], owner_id: params[2], project_id: params[3], state: params[4] || "starting", command: params[5], shell: params[6], working_directory: params[7], label: params[8], interactive: params[9], timeout_ms: params[10], idle_timeout_ms: params[11], process_id: params[12], exit_code: params[13], summary: params[14], result_json: params[15], started_at: params[16], completed_at: params[17], updated_at: params[18],
        });
        events.set(String(params[0]), []);
        return { rows: [], changes: 1 };
      }
      if (sql.includes("UPDATE workspace_terminal_sessions SET")) {
        const id = String(params.at(-2));
        const ownerId = String(params.at(-1));
        const session = sessions.get(id);
        if (!session || session.owner_id !== ownerId) return { rows: [], changes: 0 };
        const assignments = sql.slice(sql.indexOf("SET") + 3, sql.indexOf(" WHERE")).split(",").map((item) => item.trim().split(" = ")[0]);
        assignments.forEach((field, index) => { session[field] = params[index]; });
        return { rows: [], changes: 1 };
      }
      if (sql.includes("INSERT INTO workspace_terminal_events")) {
        const sessionId = String(params[1]);
        events.get(sessionId)?.push({ sequence: params[3], kind: params[4], state: params[5], text: params[6], input: params[7], metric_json: params[8], artifact_id: params[9], metadata_json: params[10], occurred_at: params[11] });
        return { rows: [], changes: 1 };
      }
      if (sql.includes("FROM workspace_terminal_sessions WHERE owner_id")) {
        return { rows: Array.from(sessions.values()).filter((session) => session.owner_id === params[0]) };
      }
      if (sql.includes("SELECT id, request_id, project_id, state")) {
        const session = sessions.get(String(params[0]));
        return { rows: session && session.owner_id === params[1] ? [session] : [] };
      }
      if (sql.includes("SELECT sequence, kind, state, text, input")) {
        return { rows: (events.get(String(params[0])) || []).filter(() => true) };
      }
      return { rows: [], changes: 0 };
    },
  };
  return { db, sessions, events };
});

vi.mock("../paradoxWorkspace", () => ({
  WorkspaceAccessError: class WorkspaceAccessError extends Error {},
  withWorkspaceDb: vi.fn(async (_write: boolean, action: (db: typeof state.db) => unknown) => action(state.db)),
}));
vi.mock("../projectWorkspace", () => ({ projectWorkspacePath: vi.fn(() => "/tmp/nexuss-terminal-project") }));

import { getLocalTerminalSession, listLocalTerminalSessions, sendLocalTerminalInput, startLocalTerminal, subscribeLocalTerminalSession, cancelLocalTerminal } from "./localSessionManager";

const request = (command: string, overrides: Record<string, unknown> = {}) => ({
  contractVersion: "1.0.0",
  lane: "local",
  projectId: "project-1",
  workingDirectory: ".",
  command,
  shell: "bash",
  interactive: false,
  timeout: { timeoutMs: 5_000 },
  ...overrides,
});

async function waitForTerminal(sessionId: string, stateName: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const session = await getLocalTerminalSession("owner-1", sessionId);
    if (session.state === stateName) return session;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error(`Timed out waiting for ${stateName}`);
}

describe("local terminal session manager", () => {
  it("streams stdout and persists completed session history", async () => {
    await mkdir("/tmp/nexuss-terminal-project", { recursive: true });
    try {
      const started = await startLocalTerminal("owner-1", request("printf 'hello\\n'"));
      const received: string[] = [];
      const unsubscribe = subscribeLocalTerminalSession("owner-1", started.sessionId, (event) => { if (event.text) received.push(event.text); });
      const completed = await waitForTerminal(started.sessionId, "completed");
      unsubscribe();
      expect(received.join("" )).toContain("hello");
      expect(completed.events.some((event) => event.kind === "stdout" && event.text?.includes("hello"))).toBe(true);
      expect(completed.result?.state).toBe("completed");
      expect((await listLocalTerminalSessions("owner-1"))[0]).toMatchObject({ sessionId: started.sessionId, state: "completed" });
    } finally {
      await rm("/tmp/nexuss-terminal-project", { recursive: true, force: true });
    }
  });

  it("accepts interactive input and records it in ordered events", async () => {
    await mkdir("/tmp/nexuss-terminal-project", { recursive: true });
    try {
      const started = await startLocalTerminal("owner-1", request("read line; printf 'received:%s\\n' \"$line\"", { interactive: true }));
      await sendLocalTerminalInput("owner-1", started.sessionId, "alpha\n");
      const completed = await waitForTerminal(started.sessionId, "completed");
      expect(completed.events.some((event) => event.kind === "stdin" && event.input === "alpha\n")).toBe(true);
      expect(completed.events.some((event) => event.kind === "stdout" && event.text?.includes("received:alpha"))).toBe(true);
    } finally {
      await rm("/tmp/nexuss-terminal-project", { recursive: true, force: true });
    }
  });

  it("cancels a running process and records the cancelled terminal state", async () => {
    await mkdir("/tmp/nexuss-terminal-project", { recursive: true });
    try {
      const started = await startLocalTerminal("owner-1", request("sleep 5"));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 40));
      await cancelLocalTerminal("owner-1", started.sessionId);
      const cancelled = await waitForTerminal(started.sessionId, "cancelled");
      expect(cancelled.summary).toContain("cancelled");
      expect(cancelled.result?.state).toBe("cancelled");
    } finally {
      await rm("/tmp/nexuss-terminal-project", { recursive: true, force: true });
    }
  });
});
