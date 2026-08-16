import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const db = vi.hoisted(() => ({
  createProject: vi.fn(),
  createThread: vi.fn(),
  deleteProject: vi.fn(),
  deleteThread: vi.fn(),
  getProjectForUser: vi.fn(),
  getThreadForUser: vi.fn(),
  listProjects: vi.fn(),
  listThreadMessages: vi.fn(),
  listThreads: vi.fn(),
  updateProject: vi.fn(),
  updateThread: vi.fn(),
}));

vi.mock("../db", () => db);

import { playgroundRouter } from "./playground";

function createContext(): TrpcContext {
  return {
    user: {
      id: 7,
      openId: "nexuss-test-user",
      name: "Nexuss Tester",
      email: "tester@example.com",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("playground router", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a thread for the authenticated user", async () => {
    const thread = { id: 31, userId: 7, projectId: null, title: "Research notes", createdAt: new Date(), updatedAt: new Date() };
    db.createThread.mockResolvedValue(thread);
    const caller = playgroundRouter.createCaller(createContext());

    await expect(caller.threads.create({ title: "Research notes" })).resolves.toEqual(thread);
    expect(db.createThread).toHaveBeenCalledWith(7, "Research notes");
  });

  it("only attaches a project when it belongs to the authenticated user", async () => {
    const thread = { id: 31, userId: 7, projectId: 14, title: "Thread", createdAt: new Date(), updatedAt: new Date() };
    db.getProjectForUser.mockResolvedValue({ id: 14, userId: 7, name: "Launch", description: null, color: "#00FF88" });
    db.updateThread.mockResolvedValue(thread);
    const caller = playgroundRouter.createCaller(createContext());

    await expect(caller.threads.setProject({ id: 31, projectId: 14 })).resolves.toEqual(thread);
    expect(db.getProjectForUser).toHaveBeenCalledWith(14, 7);
    expect(db.updateThread).toHaveBeenCalledWith({ id: 31, projectId: 14, userId: 7 });
  });

  it("rejects a thread-project association when the project is not owned by the user", async () => {
    db.getProjectForUser.mockResolvedValue(undefined);
    const caller = playgroundRouter.createCaller(createContext());

    await expect(caller.threads.setProject({ id: 31, projectId: 91 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.updateThread).not.toHaveBeenCalled();
  });

  it("returns the compact workspace payload needed by the dashboard", async () => {
    const projects = [{ id: 14, userId: 7, name: "Launch", description: "Product rollout", color: "#00FF88" }];
    const threads = [{ id: 31, userId: 7, projectId: 14, title: "Thread", project: { id: 14, name: "Launch", color: "#00FF88" }, latestMessage: null }];
    db.listProjects.mockResolvedValue(projects);
    db.listThreads.mockResolvedValue(threads);
    const caller = playgroundRouter.createCaller(createContext());

    await expect(caller.bootstrap()).resolves.toEqual({ projects, threads });
    expect(db.listProjects).toHaveBeenCalledWith(7);
    expect(db.listThreads).toHaveBeenCalledWith(7);
  });
});
