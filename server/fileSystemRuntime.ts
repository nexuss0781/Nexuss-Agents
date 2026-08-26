import { stat } from "node:fs/promises";
import { projectWorkspacePath } from "./projectWorkspace";
import { WorkspaceAccessError, withWorkspaceDb, createFilesystemAuditSink } from "./paradoxWorkspace";
import { runFileSystem } from "../tools/file-system/runtime";
import type { FileSystemRequest, FileSystemResult } from "../tools/file-system/types";

export type OwnedProjectWorkspace = {
  projectId: string;
  root: string;
  sourceType: string;
  status: string;
};

export type FileSystemRuntimeIdentity = {
  missionId?: string;
  agentId?: string;
  canMutate?: boolean;
  canDestructivelyMutate?: boolean;
};

async function resolveOwnedProjectWorkspace(ownerId: string, projectId: string): Promise<OwnedProjectWorkspace> {
  if (!ownerId || !projectId) throw new WorkspaceAccessError("A project workspace is required");
  const project = await withWorkspaceDb(false, (db) => {
    const result = db.execute("SELECT id, source_type, workspace_status FROM workspace_projects WHERE id = ? AND owner_id = ? LIMIT 1", [projectId, ownerId]);
    return result.rows[0] as { id: string; source_type: string; workspace_status: string } | undefined;
  });
  if (!project) throw new WorkspaceAccessError("Project not found");
  const root = projectWorkspacePath(ownerId, projectId);
  const workspaceStat = await stat(root).catch(() => undefined);
  if (!workspaceStat?.isDirectory()) throw new WorkspaceAccessError("The local project workspace is unavailable");
  return { projectId: project.id, root, sourceType: project.source_type, status: project.workspace_status };
}

export async function runProjectFileSystem(ownerId: string, projectId: string, request: FileSystemRequest, identity: FileSystemRuntimeIdentity = {}): Promise<FileSystemResult> {
  const workspace = await resolveOwnedProjectWorkspace(ownerId, projectId);
  return runFileSystem({
    projectId: workspace.projectId,
    workspaceRoot: workspace.root,
    missionId: identity.missionId,
    agentId: identity.agentId,
    allowMutations: identity.canMutate === true,
    allowDestructive: identity.canDestructivelyMutate === true,
    audit: createFilesystemAuditSink(ownerId),
  }, request);
}

export { resolveOwnedProjectWorkspace };
