import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createProject,
  createThread,
  deleteProject,
  deleteThread,
  getProjectForUser,
  getThreadForUser,
  listProjects,
  listThreadMessages,
  listThreads,
  updateProject,
  updateThread,
} from "../db";
import { protectedProcedure, router } from "../_core/trpc";

const projectInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#00FF88"),
});

const threadId = z.object({ id: z.number().int().positive() });

export const playgroundRouter = router({
  bootstrap: protectedProcedure.query(async ({ ctx }) => {
    const [projects, threads] = await Promise.all([listProjects(ctx.user.id), listThreads(ctx.user.id)]);
    return { projects, threads };
  }),
  projects: router({
    create: protectedProcedure.input(projectInput).mutation(({ ctx, input }) => createProject({ ...input, userId: ctx.user.id })),
    update: protectedProcedure.input(projectInput.partial().extend({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const project = await updateProject({ ...input, userId: ctx.user.id });
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      return project;
    }),
    delete: protectedProcedure.input(threadId).mutation(async ({ ctx, input }) => {
      const project = await getProjectForUser(input.id, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      await deleteProject(input.id, ctx.user.id);
      return { success: true };
    }),
  }),
  threads: router({
    create: protectedProcedure.input(z.object({ title: z.string().trim().min(1).max(160).optional() })).mutation(async ({ ctx, input }) => {
      const thread = await createThread(ctx.user.id, input.title || "New conversation");
      if (!thread) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unable to create thread" });
      return thread;
    }),
    rename: protectedProcedure.input(z.object({ id: z.number().int().positive(), title: z.string().trim().min(1).max(160) })).mutation(async ({ ctx, input }) => {
      const thread = await updateThread({ ...input, userId: ctx.user.id });
      if (!thread) throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
      return thread;
    }),
    setProject: protectedProcedure.input(z.object({ id: z.number().int().positive(), projectId: z.number().int().positive().nullable() })).mutation(async ({ ctx, input }) => {
      if (input.projectId && !(await getProjectForUser(input.projectId, ctx.user.id))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      const thread = await updateThread({ ...input, userId: ctx.user.id });
      if (!thread) throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
      return thread;
    }),
    delete: protectedProcedure.input(threadId).mutation(async ({ ctx, input }) => {
      const thread = await getThreadForUser(input.id, ctx.user.id);
      if (!thread) throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
      await deleteThread(input.id, ctx.user.id);
      return { success: true };
    }),
    messages: protectedProcedure.input(threadId).query(async ({ ctx, input }) => {
      if (!(await getThreadForUser(input.id, ctx.user.id))) throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
      return listThreadMessages(input.id, ctx.user.id);
    }),
  }),
});
