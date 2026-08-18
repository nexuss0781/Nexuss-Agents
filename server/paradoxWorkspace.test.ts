import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  appendThreadMessages,
  assignThreadProject,
  createProject,
  createThread,
  deleteProject,
  deleteThread,
  loadWorkspace,
  migrateWorkspace,
} from "./paradoxWorkspace";

describe("Paradox workspace persistence", () => {
  it("keeps projects, complete thread histories, and projectless threads scoped to their authenticated owner", async () => {
    const ownerA = `test-owner-${randomUUID()}`;
    const ownerB = `test-owner-${randomUUID()}`;
    const project = await createProject(ownerA, { name: "Durable context", description: "Persistence test", tone: "#f4f4f0" });
    const linkedThread = await createThread(ownerA, project.id);
    const projectlessThread = await createThread(ownerA);

    try {
      await appendThreadMessages(ownerA, linkedThread.id, [
        { role: "user", content: "Preserve the first history entry." },
        { role: "assistant", content: "The full history is durable." },
      ], "Durable history");
      await appendThreadMessages(ownerA, projectlessThread.id, [
        { role: "user", content: "This thread has no project." },
      ]);

      const ownerAWorkspace = await loadWorkspace(ownerA);
      const ownerBWorkspace = await loadWorkspace(ownerB);
      const loadedLinked = ownerAWorkspace.threads.find((thread) => thread.id === linkedThread.id);
      const loadedProjectless = ownerAWorkspace.threads.find((thread) => thread.id === projectlessThread.id);

      expect(ownerAWorkspace.projects).toContainEqual(expect.objectContaining({ id: project.id, name: "Durable context" }));
      expect(loadedLinked).toMatchObject({ projectId: project.id, title: "Durable history" });
      expect(loadedLinked?.messages.map((message) => message.content)).toEqual([
        "Preserve the first history entry.",
        "The full history is durable.",
      ]);
      expect(loadedProjectless).toMatchObject({ id: projectlessThread.id });
      expect(loadedProjectless?.projectId).toBeUndefined();
      expect(ownerBWorkspace).toEqual({ projects: [], threads: [] });

      await assignThreadProject(ownerA, projectlessThread.id, project.id);
      await deleteProject(ownerA, project.id);
      const afterProjectDeletion = await loadWorkspace(ownerA);
      expect(afterProjectDeletion.threads.find((thread) => thread.id === projectlessThread.id)?.projectId).toBeUndefined();
    } finally {
      await deleteThread(ownerA, linkedThread.id);
      await deleteThread(ownerA, projectlessThread.id);
    }
  }, 90_000);

  it("imports a legacy browser workspace exactly once with its complete message history", async () => {
    const owner = `legacy-owner-${randomUUID()}`;
    const projectId = `legacy-project-${randomUUID()}`;
    const threadId = `legacy-thread-${randomUUID()}`;
    const messageId = `legacy-message-${randomUUID()}`;

    try {
      const firstImport = await migrateWorkspace(owner, {
        projects: [{ id: projectId, name: "Imported project", description: "Legacy browser data", tone: "#f4f4f0" }],
        threads: [{
          id: threadId,
          title: "Imported thread",
          projectId,
          updatedAt: "2026-08-18T00:00:00.000Z",
          messages: [{ id: messageId, role: "user", content: "Preserve every existing message.", createdAt: "2026-08-18T00:00:00.000Z" }],
        }],
      });
      const secondImport = await migrateWorkspace(owner, { projects: [], threads: [] });
      const loaded = await loadWorkspace(owner);

      expect(firstImport).toEqual({ imported: true });
      expect(secondImport).toEqual({ imported: false });
      expect(loaded.projects).toContainEqual(expect.objectContaining({ id: projectId, name: "Imported project" }));
      expect(loaded.threads).toContainEqual(expect.objectContaining({
        id: threadId,
        projectId,
        messages: [expect.objectContaining({ id: messageId, content: "Preserve every existing message." })],
      }));
    } finally {
      await deleteThread(owner, threadId);
      await deleteProject(owner, projectId);
    }
  }, 90_000);
});
