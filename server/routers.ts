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
  discoverModelProviderModels,
  loadModelProviderSettings,
  loadWorkspaceChat,
  loadWorkspaceNavigation,
  loadWorkspace,
  migrateWorkspace,
  renameThread,
  saveModelProviderSettings,
  updateProject,
  DuplicateProjectNameError,
  ModelProviderError,
  WorkspaceAccessError,
} from "./paradoxWorkspace";
import { createMission, getMission, listMissions, listMissionArtifacts, listLearningCandidates } from "./mission/store";
import { recordLearningReplay } from "./mission/learning";
import { createMissionFromIntake, getStoredMissionIntake, runMissionIntake } from "./mission/intake";
import { pauseMission, queueMission, recoverMissions, resumeMission, retryMission, stopMission } from "./mission/commands";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { clonePublicGithubProject, markProjectImportFailed, ProjectWorkspaceError } from "./projectWorkspace";
import { cloneAuthorizedGithubProject, getGithubFile, getGithubPullFiles, getGithubTree, getGithubWorkflowLogs, getGithubAnalytics, githubConnectionStatus as githubStatus, GithubOAuthError, listGithubBranches, listGithubPulls, listGithubRepositories, listGithubWorkflowJobs, listGithubWorkflowRuns, postGithubPullComment, searchGithubCode } from "./githubAuth";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { storeAction, storeInstall, storeSnapshot } from "./packageManager/store";

const projectInput = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(500), tone: z.string().max(32).default("#f4f4f0"), sourceType: z.enum(["none", "upload", "github"]).default("none") });
const messageInput = z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(100_000) });
const intakeSourceInput = z.object({ kind: z.enum(["raw_prompt", "plan_text", "specification"]), text: z.string().trim().min(1).max(120_000).optional(), attachmentId: z.string().trim().min(1).max(128).optional(), name: z.string().trim().max(240).optional(), mimeType: z.string().trim().max(120).optional() }).refine((source) => Boolean(source.text || source.attachmentId), { message: "An intake source needs text or an attachment reference." });
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
  if (error instanceof DuplicateProjectNameError) throw new TRPCError({ code: "CONFLICT", message: error.message });
  if (error instanceof GithubOAuthError || error instanceof ModelProviderError || error instanceof ProjectWorkspaceError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  throw error;
}

function missionFailure(error: unknown): never {
  if (error instanceof WorkspaceAccessError) throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  if (error instanceof Error && /conflict|cannot be|not configured|not claimable|leased by|lease is/i.test(error.message)) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  throw error;
}

async function missionCall<T>(action: () => Promise<T>) {
  try { return await action(); } catch (error) { return missionFailure(error); }
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
    navigation: publicProcedure.query(async ({ ctx }) => loadWorkspaceNavigation(await workspaceOwner(ctx))),
    store: router({
      catalog: publicProcedure.query(async ({ ctx }) => { await workspaceOwner(ctx); return storeSnapshot(); }),
      install: publicProcedure.input(z.object({ appId: z.string().min(1).max(128) })).mutation(async ({ ctx, input }) => { await workspaceOwner(ctx); return storeInstall(input.appId); }),
      action: publicProcedure.input(z.object({ appId: z.string().min(1).max(128), action: z.enum(["enable", "disable", "update", "uninstall"]) })).mutation(async ({ ctx, input }) => { await workspaceOwner(ctx); return storeAction(input.appId, input.action); }),
    }),
    github: router({
      status: publicProcedure.query(async ({ ctx }) => githubStatus(await workspaceOwner(ctx))),
      repositories: publicProcedure.query(async ({ ctx }) => { try { return await listGithubRepositories(await workspaceOwner(ctx)); } catch (error) { return workspaceFailure(error); } }),
      branches: publicProcedure.input(z.object({ fullName: z.string().trim().min(3).max(240) })).query(async ({ ctx, input }) => { try { return await listGithubBranches(await workspaceOwner(ctx), input.fullName); } catch (error) { return workspaceFailure(error); } }),
      tree: publicProcedure.input(z.object({ fullName: z.string().trim().min(3).max(240), ref: z.string().trim().max(200).optional() })).query(async ({ ctx, input }) => { try { return await getGithubTree(await workspaceOwner(ctx), input.fullName, input.ref); } catch (error) { return workspaceFailure(error); } }),
      search: publicProcedure.input(z.object({ fullName: z.string().trim().min(3).max(240), query: z.string().trim().min(1).max(200) })).query(async ({ ctx, input }) => { try { return await searchGithubCode(await workspaceOwner(ctx), input.fullName, input.query); } catch (error) { return workspaceFailure(error); } }),
      pulls: publicProcedure.input(z.object({ fullName: z.string().trim().min(3).max(240), state: z.enum(["open", "closed"]).default("open") })).query(async ({ ctx, input }) => { try { return await listGithubPulls(await workspaceOwner(ctx), input.fullName, input.state); } catch (error) { return workspaceFailure(error); } }),
      pullFiles: publicProcedure.input(z.object({ fullName: z.string().trim().min(3).max(240), number: z.number().int().min(1).max(1_000_000) })).query(async ({ ctx, input }) => { try { return await getGithubPullFiles(await workspaceOwner(ctx), input.fullName, input.number); } catch (error) { return workspaceFailure(error); } }),
      comment: publicProcedure.input(z.object({ fullName: z.string().trim().min(3).max(240), number: z.number().int().min(1).max(1_000_000), body: z.string().trim().min(1).max(10_000), confirmed: z.literal(true) })).mutation(async ({ ctx, input }) => { try { return await postGithubPullComment(await workspaceOwner(ctx), input.fullName, input.number, input.body); } catch (error) { return workspaceFailure(error); } }),
      analytics: publicProcedure.input(z.object({ fullName: z.string().trim().min(3).max(240) })).query(async ({ ctx, input }) => { try { return await getGithubAnalytics(await workspaceOwner(ctx), input.fullName); } catch (error) { return workspaceFailure(error); } }),
      workflowRuns: publicProcedure.input(z.object({ fullName: z.string().trim().min(3).max(240) })).query(async ({ ctx, input }) => { try { return await listGithubWorkflowRuns(await workspaceOwner(ctx), input.fullName); } catch (error) { return workspaceFailure(error); } }),
      workflowJobs: publicProcedure.input(z.object({ fullName: z.string().trim().min(3).max(240), runId: z.number().int().min(1) })).query(async ({ ctx, input }) => { try { return await listGithubWorkflowJobs(await workspaceOwner(ctx), input.fullName, input.runId); } catch (error) { return workspaceFailure(error); } }),
      workflowLogs: publicProcedure.input(z.object({ fullName: z.string().trim().min(3).max(240), jobId: z.number().int().min(1) })).query(async ({ ctx, input }) => { try { return await getGithubWorkflowLogs(await workspaceOwner(ctx), input.fullName, input.jobId); } catch (error) { return workspaceFailure(error); } }),
      file: publicProcedure.input(z.object({ fullName: z.string().trim().min(3).max(240), path: z.string().trim().min(1).max(500), ref: z.string().trim().max(200).optional() })).query(async ({ ctx, input }) => { try { return await getGithubFile(await workspaceOwner(ctx), input.fullName, input.path, input.ref); } catch (error) { return workspaceFailure(error); } }),
      clone: publicProcedure.input(z.object({ projectId: z.string().min(1).max(128), fullName: z.string().trim().min(3).max(240), branch: z.string().trim().max(200).optional() })).mutation(async ({ ctx, input }) => {
        try { return await cloneAuthorizedGithubProject(await workspaceOwner(ctx), input.projectId, input.fullName, input.branch, (ownerId, projectId, url, token, branch) => clonePublicGithubProject(ownerId, projectId, url, token, branch)); } catch (error) { return workspaceFailure(error); }
      }),
    }),
    chat: publicProcedure.input(z.object({ chatSlug: z.string().regex(/^chat-[a-z0-9]{32}$/).max(40) })).query(async ({ ctx, input }) => loadWorkspaceChat(await workspaceOwner(ctx), input.chatSlug)),
    load: publicProcedure.input(z.object({ chatSlug: z.string().regex(/^chat-[a-z0-9]{32}$/).max(40) }).optional()).query(async ({ ctx, input }) => loadWorkspace(await workspaceOwner(ctx), input?.chatSlug)),
    createProject: publicProcedure.input(projectInput).mutation(async ({ ctx, input }) => createProject(await workspaceOwner(ctx), input)),
    cloneGithubProject: publicProcedure.input(z.object({ projectId: z.string().min(1).max(128), url: z.string().trim().min(1).max(500), branch: z.string().trim().max(200).optional() })).mutation(async ({ ctx, input }) => {
      try { return await clonePublicGithubProject(await workspaceOwner(ctx), input.projectId, input.url, undefined, input.branch); } catch (error) { return workspaceFailure(error); }
    }),
    markProjectImportFailed: publicProcedure.input(z.object({ projectId: z.string().min(1).max(128), error: z.string().trim().max(320).optional() })).mutation(async ({ ctx, input }) => {
      try { await markProjectImportFailed(await workspaceOwner(ctx), input.projectId, input.error || "Project import failed."); return { projectId: input.projectId, status: "failed" as const }; } catch (error) { return workspaceFailure(error); }
    }),
    updateProject: publicProcedure.input(z.object({ id: z.string().min(1).max(128), project: projectInput.pick({ name: true, description: true }) })).mutation(async ({ ctx, input }) => {
      try { return await updateProject(await workspaceOwner(ctx), input.id, input.project); } catch (error) { return workspaceFailure(error); }
    }),
    deleteProject: publicProcedure.input(z.object({ id: z.string().min(1).max(128) })).mutation(async ({ ctx, input }) => {
      try { return await deleteProject(await workspaceOwner(ctx), input.id); } catch (error) { return workspaceFailure(error); }
    }),
    createThread: publicProcedure.input(z.object({ projectId: z.string().min(1).max(128).nullable().optional(), forceNew: z.boolean().optional() }).optional()).mutation(async ({ ctx, input }) => {
      try { return await createThread(await workspaceOwner(ctx), input?.projectId, input?.forceNew === true); } catch (error) { return workspaceFailure(error); }
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
    modelSettings: publicProcedure.query(async ({ ctx }) => loadModelProviderSettings(await workspaceOwner(ctx))),
    saveModelSettings: publicProcedure.input(z.object({ baseUrl: z.string().trim().min(8).max(500), apiKey: z.string().trim().min(1).max(1_024).optional(), selectedModels: z.array(z.string().trim().min(1).max(256)).max(32) })).mutation(async ({ ctx, input }) => {
      try { return await saveModelProviderSettings(await workspaceOwner(ctx), input); } catch (error) { return workspaceFailure(error); }
    }),
    discoverModels: publicProcedure.mutation(async ({ ctx }) => {
      try { return await discoverModelProviderModels(await workspaceOwner(ctx)); } catch (error) { return workspaceFailure(error); }
    }),
    migrate: publicProcedure.input(legacyWorkspaceInput).mutation(async ({ ctx, input }) => migrateWorkspace(await workspaceOwner(ctx), input)),
    mission: router({
      intakePreview: publicProcedure.input(z.object({ projectId: z.string().min(1).max(128).nullable().optional(), model: z.string().trim().min(1).max(256).optional(), sources: z.array(intakeSourceInput).min(1).max(20) })).mutation(async ({ ctx, input }) => missionCall(async () => runMissionIntake(await workspaceOwner(ctx), input))),
      createFromIntake: publicProcedure.input(z.object({ projectId: z.string().min(1).max(128).nullable().optional(), model: z.string().trim().min(1).max(256).optional(), sources: z.array(intakeSourceInput).min(1).max(20), budget: z.object({ maxDepth: z.number().int().min(1).max(10), maxChildWorkItems: z.number().int().min(1).max(1_000), maxAgentAttempts: z.number().int().min(1).max(20), maxToolCalls: z.number().int().min(1).max(10_000), maxModelTokens: z.number().int().min(1_000).max(10_000_000), maxDurationSeconds: z.number().int().min(1).max(86_400) }).optional() })).mutation(async ({ ctx, input }) => missionCall(async () => createMissionFromIntake(await workspaceOwner(ctx), input))),
      intake: publicProcedure.input(z.object({ intakeId: z.string().min(1).max(128) })).query(async ({ ctx, input }) => missionCall(async () => getStoredMissionIntake(await workspaceOwner(ctx), input.intakeId))),
      create: publicProcedure.input(z.object({ projectId: z.string().min(1).max(128).nullable().optional(), parentMissionId: z.string().min(1).max(128).nullable().optional(), goal: z.string().trim().min(1).max(100_000), contract: z.object({ model: z.string().trim().min(1).max(256).optional(), deliverables: z.array(z.string().trim().min(1).max(500)).max(100).optional(), acceptanceCriteria: z.array(z.object({ id: z.string().trim().min(1).max(128), description: z.string().trim().min(1).max(2_000), verification: z.enum(["automated", "runtime", "visual", "manual", "mixed"]), required: z.boolean() })).max(100), constraints: z.array(z.string().trim().min(1).max(2_000)).max(100).optional(), assumptions: z.array(z.string().trim().min(1).max(2_000)).max(100).optional(), projectScope: z.record(z.string(), z.unknown()).optional(), riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(), autonomyPolicy: z.record(z.string(), z.unknown()).optional(), executionBudget: z.record(z.string(), z.unknown()).optional(), completionPolicy: z.array(z.string().trim().min(1).max(2_000)).max(100).optional() }), budget: z.object({ maxDepth: z.number().int().min(1).max(10), maxChildWorkItems: z.number().int().min(1).max(1_000), maxAgentAttempts: z.number().int().min(1).max(20), maxToolCalls: z.number().int().min(1).max(10_000), maxModelTokens: z.number().int().min(1_000).max(10_000_000), maxDurationSeconds: z.number().int().min(1).max(86_400) }).optional() })).mutation(async ({ ctx, input }) => missionCall(async () => createMission(await workspaceOwner(ctx), input))),
      get: publicProcedure.input(z.object({ missionId: z.string().min(1).max(128) })).query(async ({ ctx, input }) => missionCall(async () => getMission(await workspaceOwner(ctx), input.missionId))),
      artifacts: publicProcedure.input(z.object({ missionId: z.string().min(1).max(128) })).query(async ({ ctx, input }) => missionCall(async () => listMissionArtifacts(await workspaceOwner(ctx), input.missionId))),
      learningCandidates: publicProcedure.input(z.object({ missionId: z.string().min(1).max(128) })).query(async ({ ctx, input }) => missionCall(async () => listLearningCandidates(await workspaceOwner(ctx), input.missionId))),
      replayCandidate: publicProcedure.input(z.object({ missionId: z.string().min(1).max(128), candidateId: z.string().min(1).max(128), passed: z.boolean(), evidence: z.record(z.string(), z.unknown()) })).mutation(async ({ ctx, input }) => missionCall(async () => recordLearningReplay(await workspaceOwner(ctx), input.missionId, input))),
      list: publicProcedure.input(z.object({ projectId: z.string().min(1).max(128).optional() }).optional()).query(async ({ ctx, input }) => missionCall(async () => listMissions(await workspaceOwner(ctx), input?.projectId))),
      start: publicProcedure.input(z.object({ missionId: z.string().min(1).max(128) })).mutation(async ({ ctx, input }) => missionCall(async () => queueMission(await workspaceOwner(ctx), input.missionId))),
      pause: publicProcedure.input(z.object({ missionId: z.string().min(1).max(128) })).mutation(async ({ ctx, input }) => missionCall(async () => pauseMission(await workspaceOwner(ctx), input.missionId))),
      resume: publicProcedure.input(z.object({ missionId: z.string().min(1).max(128) })).mutation(async ({ ctx, input }) => missionCall(async () => resumeMission(await workspaceOwner(ctx), input.missionId))),
      stop: publicProcedure.input(z.object({ missionId: z.string().min(1).max(128) })).mutation(async ({ ctx, input }) => missionCall(async () => stopMission(await workspaceOwner(ctx), input.missionId))),
      retry: publicProcedure.input(z.object({ missionId: z.string().min(1).max(128) })).mutation(async ({ ctx, input }) => missionCall(async () => retryMission(await workspaceOwner(ctx), input.missionId))),
      recover: publicProcedure.mutation(async ({ ctx }) => missionCall(async () => recoverMissions(await workspaceOwner(ctx)))),
    }),
  }),

  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

export type AppRouter = typeof appRouter;
