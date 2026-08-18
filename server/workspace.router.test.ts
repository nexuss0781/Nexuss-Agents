import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "./nexussAuth";
import { appRouter } from "./routers";

async function authenticatedCaller(userId: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET must be configured for authenticated workspace tests");
  const token = await new SignJWT({ user: { id: userId, email: "persistence@example.com", name: "Persistence Test", avatarUrl: null } })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(secret));

  return appRouter.createCaller({
    req: { headers: { cookie: `${SESSION_COOKIE}=${token}` } },
    res: {},
    user: null,
  } as never);
}

describe("authenticated workspace router", () => {
  it("persists projects, full histories, and projectless threads for the signed-in user", async () => {
    const caller = await authenticatedCaller(`router-owner-${randomUUID()}`);
    const project = await caller.workspace.createProject({ name: "Router project", description: "Authenticated persistence", tone: "#f4f4f0" });
    const linkedThread = await caller.workspace.createThread({ projectId: project.id });
    let projectlessThread: Awaited<ReturnType<typeof caller.workspace.createThread>> | null = null;

    try {
      await caller.workspace.appendMessages({
        threadId: linkedThread.id,
        title: "Saved through the router",
        messages: [
          { role: "user", content: "Keep my whole history." },
          { role: "assistant", content: "Every message is retained." },
        ],
      });
      projectlessThread = await caller.workspace.createThread({});
      const workspace = await caller.workspace.load({ chatSlug: linkedThread.chatSlug });
      const loadedThread = workspace.threads.find((thread) => thread.id === linkedThread.id);

      expect(loadedThread).toMatchObject({ projectId: project.id, title: "Saved through the router" });
      expect(loadedThread?.messages.map((message) => message.content)).toEqual([
        "Keep my whole history.",
        "Every message is retained.",
      ]);
      expect(projectlessThread).not.toBeNull();
      expect(workspace.threads.find((thread) => thread.id === projectlessThread!.id)?.projectId).toBeUndefined();

      await caller.workspace.deleteProject({ id: project.id });
      const unassigned = await caller.workspace.load({ chatSlug: projectlessThread!.chatSlug });
      expect(unassigned.threads.find((thread) => thread.id === linkedThread.id)?.projectId).toBeUndefined();
    } finally {
      await caller.workspace.deleteThread({ id: linkedThread.id });
      if (projectlessThread) await caller.workspace.deleteThread({ id: projectlessThread.id });
    }
  }, 90_000);
});
