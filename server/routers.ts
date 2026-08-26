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
  withWorkspaceDb,
} from "./paradoxWorkspace";
import { createMission, getMission, listMissions, listMissionArtifacts, listMissionEvidence, listMissionVerifications, listLearningCandidates } from "./mission/store";
import { recordLearningReplay } from "./mission/learning";
import { createMissionFromIntake, getStoredMissionIntake, runMissionIntake } from "./mission/intake";
import { launchMissionFromConversation } from "./mission/integration";
import { buildMissionReport } from "./mission/reporting";
import { pauseMission, queueMission, recoverMissions, resumeMission, retryMission, stopMission } from "./mission/commands";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { clonePublicGithubProject, markProjectImportFailed, ProjectWorkspaceError } from "./projectWorkspace";
import { cloneAuthorizedGithubProject, createGithubRepository, deleteGithubRepository, getGithubFile, getGithubPullFiles, getGithubTree, getGithubWorkflowLogs, getGithubAnalytics, githubConnectionStatus as githubStatus, GithubOAuthError, listGithubBranches, listGithubPulls, listGithubRepositories, listGithubWorkflowJobs, listGithubWorkflowRuns, postGithubPullComment, renameGithubRepository, searchGithubCode } from "./githubAuth";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { storeAction, storeInstall, storeSnapshot } from "./packageManager/store";
import { commitAndPushLocalChanges, generateLocalCommitMessage, getLocalChanges } from "./localChanges";
import { runProjectFileSystem } from "./fileSystemRuntime";
import type { FileSystemAction } from "../tools/file-system/types";
import { classifyConversationHandoff } from "./mission/conversationHandoff";

const projectInput = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(500), tone: z.string().max(32).default("#f4f4f0"), sourceType: z.enum(["none", "upload", "github"]).default("none") });
const messageInput = z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(100_000) });
const intakeSourceInput = z.object({ kind: z.enum(["raw_prompt", "plan_text", "specification"]), text: z.string().trim().min(1).max(120_000).optional(), attachmentId: z.string().trim().min(1).max(128).optional(), name: z.string().trim().max(240).optional(), mimeType: z.string().trim().max(120).optional() }).refine((source) => Boolean(source.text || source.attachmentId), { message: "An intake source needs text or an attachment reference." });
const filesystemActionInput = z.enum(["list", "tree", "stat", "exists", "find", "du", "read", "read_many", "tail", "binary_metadata", "grep", "grep_batch", "glob", "create", "write", "append", "patch", "replace", "format", "copy", "move", "rename", "delete", "clean_generated", "symbols", "references", "recent_changes", "diff_file", "diff_workspace", "diff_paths", "preview_patch", "apply_patch", "rollback", "snapshot", "restore_snapshot", "manifest", "export_patch", "import_patch", "verify_workspace"] as [FileSystemAction, ...FileSystemAction[]]);
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
    filesystem: router({
      execute: publicProcedure.input(z.object({ projectId: z.string().min(1).max(128), action: filesystemActionInput, request: z.record(z.string(), z.unknown()).optional(), confirmed: z.boolean().optional() })).mutation(async ({ ctx, input }) => {
        const ownerId = await workspaceOwner(ctx);
        const request = { ...(input.request || {}), action: input.action, confirmed: input.confirmed === true } as never;
        return runProjectFileSystem(ownerId, input.projectId, request, { canMutate: true, canDestructivelyMutate: input.confirmed === true });
      }),
      audit: publicProcedure.input(z.object({ projectId: z.string().min(1).max(128), limit: z.number().int().min(1).max(200).default(50) })).query(async ({ ctx, input }) => {
        const ownerId = await workspaceOwner(ctx);
        return withWorkspaceDb(false, (db) => db.execute("SELECT id, project_id, mission_id, agent_id, action, paths_json, result, error_code, duration_ms, created_at FROM filesystem_audit_events WHERE owner_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT ?", [ownerId, input.projectId, input.limit]).rows.map((row) => {
          const value = row as Record<string, unknown>;
          let paths: string[] = [];
          try { paths = JSON.parse(String(value.paths_json || "[]")); } catch { paths = []; }
          return { id: String(value.id), projectId: String(value.project_id), missionId: value.mission_id ? String(value.mission_id) : undefined, agentId: value.agent_id ? String(value.agent_id) : undefined, action: String(value.action), paths, result: String(value.result), errorCode: value.error_code ? String(value.error_code) : undefined, durationMs: Number(value.duration_ms), createdAt: String(value.created_at) };
        }));
      }),
    }),
    store: router({
      catalog: publicProcedure.query(async ({ ctx }) => { await workspaceOwner(ctx); return storeSnapshot(); }),
      install: publicProcedure.input(z.object({ appId: z.string().min(1).max(128) })).mutation(async ({ ctx, input }) => { await workspaceOwner(ctx); return storeInstall(input.appId); }),
      action: publicProcedure.input(z.object({ appId: z.string().min(1).max(128), action: z.enum(["enable", "disable", "update", "uninstall"]) })).mutation(async ({ ctx, input }) => { await workspaceOwner(ctx); return storeAction(input.appId, input.action); }),
    }),
    github: router({
      status: publicProcedure.query(async ({ ctx }) => githubStatus(await workspaceOwner(ctx))),
      repositories: publicProcedure.query(async ({ ctx }) => { try { return await listGithubRepositories(await workspaceOwner(ctx)); } catch (error) { return workspaceFailure(error); } }),
      createRepository: publicProcedure.input(z.object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(500).optional(), private: z.boolean().default(true) })).mutation(async ({ ctx, input }) => { try { return await createGithubRepository(await workspaceOwner(ctx), input); } catch (error) { return workspaceFailure(error); } }),
      renameRepository: publicProcedure.input(z.object({ fullName: z.string().trim().min(3).max(240), name: z.string().trim().min(1).max(100) })).mutation(async ({ ctx, input }) => { try { return await renameGithubRepository(await workspaceOwner(ctx), input.fullName, input.name); } catch (error) { return workspaceFailure(error); } }),
      deleteRepository: publicProcedure.input(z.object({ fullName: z.string().trim().min(3).max(240), confirmation: z.string().trim().min(1).max(240) })).mutation(async ({ ctx, input }) => { try { return await deleteGithubRepository(await workspaceOwner(ctx), input.fullName, input.confirmation); } catch (error) { return workspaceFailure(error); } }),
      localChanges: publicProcedure.input(z.object({ fullName: z.string().trim().min(3).max(240), branch: z.string().trim().max(200).optional() })).query(async ({ ctx, input }) => { try { return await getLocalChanges(await workspaceOwner(ctx), input.fullName, input.branch); } catch (error) { return workspaceFailure(error); } }),
      generateCommitMessage: publicProcedure.input(z.object({ fullName: z.string().trim().min(3).max(240), branch: z.string().trim().max(200).optional(), model: z.string().trim().max(160).optional() })).mutation(async ({ ctx, input }) => { try { return await generateLocalCommitMessage(await workspaceOwner(ctx), input.fullName, input.branch, input.model); } catch (error) { return workspaceFailure(error); } }),
      commitAndPush: publicProcedure.input(z.object({ fullName: z.string().trim().min(3).max(240), branch: z.string().trim().max(200).optional(), message: z.string().trim().min(1).max(240), confirmed: z.literal(true) })).mutation(async ({ ctx, input }) => { try { return await commitAndPushLocalChanges(await workspaceOwner(ctx), input.fullName, input.branch, input.message, input.confirmed); } catch (error) { return workspaceFailure(error); } }),
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
    handoff: publicProcedure.input(z.object({ prompt: z.string().trim().max(100_000), mode: z.enum(["complex", "general", "instant"]), hasAttachments: z.boolean().optional() })).mutation(async ({ ctx, input }) => { await workspaceOwner(ctx); return classifyConversationHandoff(input); }),
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
      launchFromConversation: publicProcedure.input(z.object({ projectId: z.string().min(1).max(128).nullable().optional(), model: z.string().trim().min(1).max(256).optional(), sources: z.array(intakeSourceInput).min(1).max(20), budget: z.object({ maxDepth: z.number().int().min(1).max(10), maxChildWorkItems: z.number().int().min(1).max(1_000), maxAgentAttempts: z.number().int().min(1).max(20), maxToolCalls: z.number().int().min(1).max(10_000), maxModelTokens: z.number().int().min(1_000).max(10_000_000), maxDurationSeconds: z.number().int().min(1).max(86_400) }).optional() })).mutation(async ({ ctx, input }) => missionCall(async () => launchMissionFromConversation(await workspaceOwner(ctx), input))),
      intake: publicProcedure.input(z.object({ intakeId: z.string().min(1).max(128) })).query(async ({ ctx, input }) => missionCall(async () => getStoredMissionIntake(await workspaceOwner(ctx), input.intakeId))),
      create: publicProcedure.input(z.object({ projectId: z.string().min(1).max(128).nullable().optional(), parentMissionId: z.string().min(1).max(128).nullable().optional(), goal: z.string().trim().min(1).max(100_000), contract: z.object({ model: z.string().trim().min(1).max(256).optional(), deliverables: z.array(z.string().trim().min(1).max(500)).max(100).optional(), acceptanceCriteria: z.array(z.object({ id: z.string().trim().min(1).max(128), description: z.string().trim().min(1).max(2_000), verification: z.enum(["automated", "runtime", "visual", "manual", "mixed"]), required: z.boolean() })).max(100), constraints: z.array(z.string().trim().min(1).max(2_000)).max(100).optional(), assumptions: z.array(z.string().trim().min(1).max(2_000)).max(100).optional(), projectScope: z.record(z.string(), z.unknown()).optional(), riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(), autonomyPolicy: z.record(z.string(), z.unknown()).optional(), executionBudget: z.record(z.string(), z.unknown()).optional(), completionPolicy: z.array(z.string().trim().min(1).max(2_000)).max(100).optional() }), budget: z.object({ maxDepth: z.number().int().min(1).max(10), maxChildWorkItems: z.number().int().min(1).max(1_000), maxAgentAttempts: z.number().int().min(1).max(20), maxToolCalls: z.number().int().min(1).max(10_000), maxModelTokens: z.number().int().min(1_000).max(10_000_000), maxDurationSeconds: z.number().int().min(1).max(86_400) }).optional() })).mutation(async ({ ctx, input }) => missionCall(async () => createMission(await workspaceOwner(ctx), input))),
      get: publicProcedure.input(z.object({ missionId: z.string().min(1).max(128) })).query(async ({ ctx, input }) => missionCall(async () => getMission(await workspaceOwner(ctx), input.missionId))),
      artifacts: publicProcedure.input(z.object({ missionId: z.string().min(1).max(128) })).query(async ({ ctx, input }) => missionCall(async () => listMissionArtifacts(await workspaceOwner(ctx), input.missionId))),
      report: publicProcedure.input(z.object({ missionId: z.string().min(1).max(128) })).query(async ({ ctx, input }) => missionCall(async () => {
        const ownerId = await workspaceOwner(ctx);
        const [snapshot, artifacts, evidence, verifications] = await Promise.all([
          getMission(ownerId, input.missionId),
          listMissionArtifacts(ownerId, input.missionId),
          listMissionEvidence(ownerId, input.missionId),
          listMissionVerifications(ownerId, input.missionId),
        ]);
        return buildMissionReport({ snapshot, artifacts, evidence, verifications });
      })),
      evidence: publicProcedure.input(z.object({ missionId: z.string().min(1).max(128) })).query(async ({ ctx, input }) => missionCall(async () => listMissionEvidence(await workspaceOwner(ctx), input.missionId))),
      verifications: publicProcedure.input(z.object({ missionId: z.string().min(1).max(128) })).query(async ({ ctx, input }) => missionCall(async () => listMissionVerifications(await workspaceOwner(ctx), input.missionId))),
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
