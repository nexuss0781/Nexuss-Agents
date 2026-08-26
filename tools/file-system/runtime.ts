import { randomUUID } from "node:crypto";
import type { FileSystemRequest, FileSystemResult } from "./types.js";
import { inspectFileSystem } from "./index.js";
import { createJsonlAuditSink, type AuditSink, type FileSystemAuditEvent } from "./audit.js";
import { authorizeFileSystem, type FileSystemPolicyContext, type PolicyDecision } from "./policy.js";

export type FileSystemRuntimeContext = FileSystemPolicyContext & {
  missionId?: string;
  agentId?: string;
  audit?: AuditSink;
};

function pathsOf(request: FileSystemRequest) {
  return [request.path, ...(request.paths ?? []), request.destinationPath].filter((path): path is string => Boolean(path));
}

type RejectedPolicyDecision = Extract<PolicyDecision, { allowed: false }>;

function rejectedResult(operationId: string, decision: RejectedPolicyDecision): FileSystemResult {
  return { ok: false, operationId, code: decision.code, message: decision.message, retryable: false };
}

export async function runFileSystem(context: FileSystemRuntimeContext, request: FileSystemRequest): Promise<FileSystemResult> {
  const operationId = randomUUID();
  const started = performance.now();
  const decision = authorizeFileSystem(context, request);
  let result: FileSystemResult;
  if (decision.allowed) {
    result = await inspectFileSystem(context.workspaceRoot, request);
  } else {
    result = rejectedResult(operationId, decision as RejectedPolicyDecision);
  }
  const auditErrorCode = "code" in result ? result.code : undefined;
  const auditEvent: FileSystemAuditEvent = {
    operationId: result.operationId,
    projectId: context.projectId,
    missionId: context.missionId,
    agentId: context.agentId,
    action: request.action,
    paths: decision.allowed ? decision.paths : pathsOf(request),
    result: result.ok ? "completed" : decision.allowed ? "failed" : "rejected",
    errorCode: auditErrorCode,
    durationMs: performance.now() - started,
    timestamp: new Date().toISOString(),
  };
  const audit = context.audit ?? createJsonlAuditSink("/tmp/nexuss-file-system-audit.jsonl");
  await audit(auditEvent);
  return result;
}

export { authorizeFileSystem } from "./policy.js";
export { createJsonlAuditSink } from "./audit.js";
export type { AuditSink, FileSystemAuditEvent } from "./audit.js";
export type { FileSystemPolicyContext, PolicyDecision } from "./policy.js";
