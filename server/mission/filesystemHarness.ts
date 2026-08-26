import type { AgentRoleContract } from "./agentContracts";
import { assertHarnessAllowed } from "./capabilityGuard";
import { runProjectFileSystem } from "../fileSystemRuntime";
import type { FileSystemAction, FileSystemRequest, FileSystemResult } from "../../tools/file-system/types";
import type { HarnessRequest, HarnessResult } from "./harnessRegistry";

const FILESYSTEM_ACTIONS = new Set<FileSystemAction>([
  "list", "tree", "stat", "exists", "find", "du", "read", "read_many", "tail", "binary_metadata", "grep", "grep_batch", "glob",
  "create", "write", "append", "patch", "replace", "format", "copy", "move", "rename", "delete", "clean_generated", "symbols", "references", "recent_changes",
  "diff_file", "diff_workspace", "diff_paths", "preview_patch", "apply_patch", "rollback", "snapshot", "restore_snapshot", "manifest", "export_patch", "import_patch", "verify_workspace",
]);

const REQUEST_KEYS = new Set<keyof FileSystemRequest>([
  "path", "paths", "pattern", "query", "queries", "regex", "caseSensitive", "include", "exclude", "maxEntries", "maxDepth", "maxBytes", "maxMatches", "contextLines", "startLine", "endLine", "lineCount", "content", "expectedSha256", "edits", "formatter", "sourcePath", "destinationPath", "confirmed", "recursive", "patterns", "language", "since", "until", "patchText", "rollbackOperationId", "unified", "snapshotId", "manifestId", "expectedCommit",
]);

const MUTATING_ACTIONS = new Set<FileSystemAction>(["create", "write", "append", "patch", "replace", "format", "copy", "move", "rename", "delete", "clean_generated", "apply_patch", "rollback", "restore_snapshot", "import_patch"]);

function requestFromHarness(request: HarnessRequest): FileSystemRequest {
  if (!FILESYSTEM_ACTIONS.has(request.operation as FileSystemAction)) throw new Error(`Filesystem operation is not allowlisted: ${request.operation}`);
  const input = request.input || {};
  const selected = Object.fromEntries(Object.entries(input).filter(([key]) => REQUEST_KEYS.has(key as keyof FileSystemRequest)));
  return { ...selected, action: request.operation as FileSystemAction } as FileSystemRequest;
}

function summarize(result: FileSystemResult) {
  if (!result.ok) return result.message.slice(0, 320);
  return `${result.action} completed in ${Math.round(result.durationMs)}ms`;
}

export async function dispatchFilesystemHarness(input: {
  ownerId: string;
  projectId: string;
  contract: AgentRoleContract;
  request: HarnessRequest;
  missionId?: string;
  agentId?: string;
}): Promise<HarnessResult> {
  const descriptor = assertHarnessAllowed(input.contract, input.request);
  const request = requestFromHarness(input.request);
  const result = await runProjectFileSystem(input.ownerId, input.projectId, request, {
    missionId: input.missionId,
    agentId: input.agentId,
    canMutate: input.contract.canWriteRepository,
    canDestructivelyMutate: false,
  });
  const sideEffects = MUTATING_ACTIONS.has(request.action) ? ["project workspace may have changed"] : [];
  return {
    ok: result.ok,
    status: result.ok ? "completed" : result.code === "CONFIRMATION_REQUIRED" ? "failed" : "failed",
    summary: summarize(result),
    artifacts: [],
    evidence: result.ok ? { operationId: result.operationId, action: result.action, path: result.path, data: result.data } : { operationId: result.operationId, code: result.code },
    sideEffects,
    retryable: !result.ok && result.retryable,
  };
}

