import { decideAuthority, type WorkflowAction } from "./authorityPolicy";
import { getHarness, listHarnesses, type HarnessId } from "./harnessRegistry";
import { listSkills } from "./skills";
import type { CapabilityContract, CapabilityDecision, CapabilityInvocation, CapabilityOperation, HarnessCapabilityContract, ToolCapabilityContract } from "./capabilityTypes";
import type { SideEffectClass } from "./workflowTypes";
import { validateCapabilityRegistry } from "./capabilityValidation";

const FILESYSTEM_ACTIONS = ["list", "tree", "stat", "exists", "find", "du", "read", "read_many", "tail", "binary_metadata", "grep", "grep_batch", "glob", "create", "write", "append", "patch", "replace", "format", "copy", "move", "rename", "delete", "clean_generated", "symbols", "references", "recent_changes", "diff_file", "diff_workspace", "diff_paths", "preview_patch", "apply_patch", "rollback", "snapshot", "restore_snapshot", "manifest", "export_patch", "import_patch", "verify_workspace"] as const;
const READ_ACTIONS = new Set(["list", "tree", "stat", "exists", "find", "du", "read", "read_many", "tail", "binary_metadata", "grep", "grep_batch", "glob", "symbols", "references", "recent_changes", "diff_file", "diff_workspace", "diff_paths", "preview_patch", "verify_workspace", "snapshot", "manifest", "export_patch"]);
const DESTRUCTIVE_ACTIONS = new Set(["delete", "clean_generated", "restore_snapshot", "import_patch", "rollback"]);

function sideEffectForHarness(value: string): SideEffectClass {
  if (value === "external_read") return "network_read";
  if (value === "external_write") return "network_publication";
  if (value === "bounded_repository_write") return "workspace_mutation";
  return "read_only";
}

function actionForFilesystem(value: string): WorkflowAction {
  if (READ_ACTIONS.has(value)) return value === "preview_patch" ? "diff" : "inspect";
  if (value === "create") return "create";
  if (value === "write") return "write";
  if (value === "append") return "append";
  if (value === "patch" || value === "apply_patch") return value === "patch" ? "patch" : "apply_patch";
  if (value === "replace") return "replace";
  if (value === "format") return "format";
  if (value === "copy") return "copy";
  if (value === "move") return "move";
  if (value === "rename") return "rename";
  if (value === "delete" || value === "clean_generated") return value as WorkflowAction;
  if (value === "rollback") return "rollback";
  if (value === "restore_snapshot") return "restore_snapshot";
  if (value === "import_patch") return "apply_patch";
  return "read";
}

function harnessOperation(harnessId: HarnessId, operation: string, effect: SideEffectClass): CapabilityOperation {
  const action: WorkflowAction = harnessId === "filesystem" ? actionForFilesystem(operation) : harnessId === "repository_change" ? "write" : harnessId === "research" ? "research" : harnessId === "browser" ? "read" : harnessId === "webdev" ? "deploy" : operation.includes("create") || operation.includes("persist") ? "create" : "inspect";
  return { id: operation, description: `${operation} through the ${harnessId} harness`, action, sideEffect: effect, requiresConfirmation: DESTRUCTIVE_ACTIONS.has(operation) || action === "deploy" || action === "push", requiresVerification: effect !== "read_only", evidence: ["bounded summary", "operation status", "artifact or observation reference"] };
}

function toHarnessContract(harness: ReturnType<typeof getHarness>): HarnessCapabilityContract {
  if (!harness) throw new Error("Harness descriptor is missing");
  const effect = sideEffectForHarness(harness.sideEffect);
  return { kind: "harness", id: harness.id, version: harness.version, title: harness.title, status: harness.status, operations: harness.operations.map((operation) => harnessOperation(harness.id, operation, effect)), maxTimeoutMs: harness.maxTimeoutMs, secretBoundary: harness.secretBoundary };
}

function toToolContract(skill: ReturnType<typeof listSkills>[number]): ToolCapabilityContract {
  const effect: SideEffectClass = skill.sideEffect === "external_read" ? "network_read" : skill.sideEffect === "external_write" ? "network_publication" : skill.sideEffect === "bounded_repository_write" ? "workspace_mutation" : "read_only";
  return { kind: "tool", id: skill.id, version: skill.version, title: skill.title, status: skill.status, authority: effect === "read_only" ? "verification_only" : "execution_only", operations: [{ id: "invoke", description: skill.purpose, action: effect === "read_only" ? "inspect" : "write", sideEffect: effect, requiresConfirmation: effect === "network_publication", requiresVerification: effect !== "read_only", evidence: [...skill.verification] }], allowedHarnesses: skill.requiredHarnesses as HarnessId[] };
}

export function listCapabilityContracts(): CapabilityContract[] {
  const harnessContracts = listHarnesses().map(toHarnessContract);
  const toolContracts = listSkills().map(toToolContract);
  const filesystem = { kind: "tool" as const, id: "filesystem.operations", version: "1.0.0", title: "Project Filesystem Operations", status: "implemented" as const, authority: "execution_only" as const, allowedHarnesses: ["filesystem" as const], operations: FILESYSTEM_ACTIONS.map((action) => harnessOperation("filesystem", action, READ_ACTIONS.has(action) ? "read_only" : "workspace_mutation")) } satisfies ToolCapabilityContract;
  return validateCapabilityRegistry([...harnessContracts, ...toolContracts, filesystem]);
}

export function getCapabilityContract(id: string) {
  return listCapabilityContracts().find((capability) => capability.id === id);
}

export function assertCapabilityInvocation(input: CapabilityInvocation): CapabilityDecision {
  const capability = getCapabilityContract(input.capabilityId);
  if (!capability) throw new Error(`Capability is not registered: ${input.capabilityId}`);
  if (capability.status !== "implemented") throw new Error(`Capability is not implemented: ${input.capabilityId}`);
  const operation = capability.operations.find((candidate) => candidate.id === input.operation);
  if (!operation) throw new Error(`Capability operation is not allowlisted: ${input.capabilityId}/${input.operation}`);
  if (input.timeoutMs !== undefined && capability.kind === "harness" && input.timeoutMs > capability.maxTimeoutMs) throw new Error(`Capability timeout exceeds policy: ${input.capabilityId}`);
  const authority = decideAuthority({ authority: input.authority, action: operation.action as WorkflowAction, confirmed: input.confirmed });
  if (!authority.allowed) throw new Error(`Capability authority denied: ${authority.reason}`);
  return { allowed: true, capabilityId: input.capabilityId, operation: operation.id, action: operation.action, sideEffect: operation.sideEffect, requiresConfirmation: operation.requiresConfirmation, requiresVerification: operation.requiresVerification, evidence: operation.evidence, reason: "Capability operation is registered and authority-compatible" };
}
