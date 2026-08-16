import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({
  execute: vi.fn((sql?: string) => ({
    rows: String(sql ?? "").startsWith("SELECT * FROM threadMessages WHERE id")
      ? [{ id: 9, threadId: 8, userId: 42, role: "user", content: "scoped", createdAt: Date.now() }]
      : [],
    lastInsertRowid: 1,
    sql,
  })),
}));

vi.mock("./paradox", () => ({
  getParadoxDb: vi.fn(async () => ({ execute })),
}));

import {
  createThreadMessage,
  deleteProject,
  deleteThread,
  getProjectForUser,
  getThreadForUser,
  listProjects,
  listThreadMessages,
  listThreads,
  updateProject,
  updateThread,
} from "./db";

describe("Paradox ownership boundaries", () => {
  beforeEach(() => execute.mockClear());

  it("binds the caller user id to project and thread reads and lists", async () => {
    await listProjects(42);
    await getProjectForUser(7, 42);
    await listThreads(42);
    await getThreadForUser(8, 42);
    await listThreadMessages(8, 42);

    for (const call of execute.mock.calls) {
      const [sql, params] = call as [string, unknown[] | undefined];
      if (sql.includes("FROM projects") || sql.includes("FROM threads") || sql.includes("FROM threadMessages")) {
        expect(sql).toContain("userId = ?");
        expect(params).toContain(42);
      }
    }
  });

  it("binds the caller user id to project, thread, and message mutations", async () => {
    await updateProject({ id: 7, userId: 42, name: "Scoped project" });
    await deleteProject(7, 42);
    await updateThread({ id: 8, userId: 42, title: "Scoped thread" });
    await deleteThread(8, 42);
    await createThreadMessage({ threadId: 8, userId: 42, role: "user", content: "scoped" });

    const mutationCalls = execute.mock.calls.filter(([sql]) => /^(UPDATE|DELETE|INSERT)/.test(sql));
    expect(mutationCalls.length).toBeGreaterThanOrEqual(7);
    for (const [sql, params] of mutationCalls as [string, unknown[]][]) {
      if (sql.includes("projects") || sql.includes("threads") || sql.includes("threadMessages")) {
        expect(params).toContain(42);
        if (sql.includes("UPDATE projects") || sql.includes("DELETE FROM projects") || sql.includes("UPDATE threads") || sql.includes("DELETE FROM threads") || sql.includes("UPDATE threadMessages")) {
          expect(sql).toContain("userId = ?");
        }
      }
    }
  });
});

