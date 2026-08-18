import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { clearNexussSession, getNexussSession } from "./nexussAuth";
import {
  appendThreadMessages,
  assignThreadProject,
  createProject,
  createThread,
  deleteProject,
  deleteThread,
  loadWorkspace,
  migrateWorkspace,
  renameThread,
  updateProject,
  WorkspaceAccessError,
} from "./paradoxWorkspace";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const projectInput = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(500), tone: z.string().max(32).default("#f4f4f0") });
const messageInput = z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(100_000) });
const legacyWorkspaceInput = z.object({
  projects: z.array(z.object({ id: z.string().min(1).max(128), name: z.string().min(1).max(120), description: z.string().max(500), tone: z.string().max(32) })).max(500),
  threads: z.array(z.object({ id: z.string().min(1).max(128), title: z.string().min(1).max(240), projectId: z.string().min(1).max(128).optional(), updatedAt: z.string(), messages: z.array(z.object({ id: z.string().min(1).max(128), role: z.enum(["user", "assistant"]), content: z.string().max(100_000), createdAt: z.string() })).max(10_000) })).max(2_000),
});

async function workspaceOwner(ctx: { req: Parameters<typeof getNexussSession>[0] }) {
  const user = await getNexussSession(ctx.req);
  if (!user?.id) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to access your workspace." });
  return user.id;
}

function workspaceFailure(error: unknown): never {
  if (error instanceof WorkspaceAccessError) throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  throw error;
}

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  nexuss: router({
    me: publicProcedure.query(({ ctx }) => getNexussSession(ctx.req)),
    logout: publicProcedure.mutation(({ ctx }) => {
      clearNexussSession(ctx.res);
      return { success: true } as const;
    }),
  }),
  workspace: router({
    load: publicProcedure.input(z.object({ chatSlug: z.string().regex(/^chat-[a-z0-9]{32}$/).max(40) }).optional()).query(async ({ ctx, input }) => loadWorkspace(await workspaceOwner(ctx), input?.chatSlug)),
    createProject: publicProcedure.input(projectInput).mutation(async ({ ctx, input }) => createProject(await workspaceOwner(ctx), input)),
    updateProject: publicProcedure.input(z.object({ id: z.string().min(1).max(128), project: projectInput.pick({ name: true, description: true }) })).mutation(async ({ ctx, input }) => {
      try { return await updateProject(await workspaceOwner(ctx), input.id, input.project); } catch (error) { return workspaceFailure(error); }
    }),
    deleteProject: publicProcedure.input(z.object({ id: z.string().min(1).max(128) })).mutation(async ({ ctx, input }) => {
      try { return await deleteProject(await workspaceOwner(ctx), input.id); } catch (error) { return workspaceFailure(error); }
    }),
    createThread: publicProcedure.input(z.object({ projectId: z.string().min(1).max(128).nullable().optional() }).optional()).mutation(async ({ ctx, input }) => {
      try { return await createThread(await workspaceOwner(ctx), input?.projectId); } catch (error) { return workspaceFailure(error); }
    }),
    renameThread: publicProcedure.input(z.object({ id: z.string().min(1).max(128), title: z.string().trim().min(1).max(240) })).mutation(async ({ ctx, input }) => {
      try { return await renameThread(await workspaceOwner(ctx), input.id, input.title); } catch (error) { return workspaceFailure(error); }
    }),
    assignThreadProject: publicProcedure.input(z.object({ id: z.string().min(1).max(128), projectId: z.string().min(1).max(128).nullable() })).mutation(async ({ ctx, input }) => {
      try { return await assignThreadProject(await workspaceOwner(ctx), input.id, input.projectId); } catch (error) { return workspaceFailure(error); }
    }),
    deleteThread: publicProcedure.input(z.object({ id: z.string().min(1).max(128) })).mutation(async ({ ctx, input }) => {
      try { return await deleteThread(await workspaceOwner(ctx), input.id); } catch (error) { return workspaceFailure(error); }
    }),
    appendMessages: publicProcedure.input(z.object({ threadId: z.string().min(1).max(128), messages: z.array(messageInput).min(1).max(20), title: z.string().trim().min(1).max(240).optional() })).mutation(async ({ ctx, input }) => {
      try { return await appendThreadMessages(await workspaceOwner(ctx), input.threadId, input.messages, input.title); } catch (error) { return workspaceFailure(error); }
    }),
    migrate: publicProcedure.input(legacyWorkspaceInput).mutation(async ({ ctx, input }) => migrateWorkspace(await workspaceOwner(ctx), input)),
  }),

  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

export type AppRouter = typeof appRouter;
