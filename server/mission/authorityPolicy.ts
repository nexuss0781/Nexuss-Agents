import {
  AUTHORITY_CLASSES,
  SIDE_EFFECT_CLASSES,
  type AuthorityClass,
  type SideEffectClass,
} from "./workflowTypes";

export type WorkflowAction =
  | "inspect"
  | "read"
  | "search"
  | "calculate"
  | "design"
  | "create"
  | "write"
  | "append"
  | "patch"
  | "replace"
  | "format"
  | "copy"
  | "move"
  | "rename"
  | "delete"
  | "clean_generated"
  | "diff"
  | "apply_patch"
  | "rollback"
  | "snapshot"
  | "restore_snapshot"
  | "branch"
  | "stage"
  | "commit"
  | "push"
  | "research"
  | "publish"
  | "communicate"
  | "deploy";

export type AuthorityDecision = {
  action: WorkflowAction;
  authority: AuthorityClass;
  sideEffect: SideEffectClass;
  allowed: boolean;
  requiresConfirmation: boolean;
  requiresVerification: boolean;
  requiresAudit: boolean;
  reason: string;
};

const ACTION_SIDE_EFFECT: Readonly<Record<WorkflowAction, SideEffectClass>> = {
  inspect: "read_only",
  read: "read_only",
  search: "read_only",
  calculate: "read_only",
  design: "read_only",
  diff: "read_only",
  research: "network_read",
  create: "local_reversible_write",
  write: "workspace_mutation",
  append: "workspace_mutation",
  patch: "workspace_mutation",
  replace: "workspace_mutation",
  format: "workspace_mutation",
  copy: "workspace_mutation",
  move: "workspace_mutation",
  rename: "workspace_mutation",
  apply_patch: "workspace_mutation",
  rollback: "local_reversible_write",
  snapshot: "local_reversible_write",
  restore_snapshot: "workspace_mutation",
  branch: "repository_mutation",
  stage: "repository_mutation",
  commit: "repository_mutation",
  push: "network_publication",
  publish: "network_publication",
  communicate: "third_party_communication",
  delete: "delete_or_irreversible",
  clean_generated: "delete_or_irreversible",
  deploy: "deployment_or_release",
};

const DEFAULT_ALLOWED_SIDE_EFFECTS: Readonly<Record<AuthorityClass, readonly SideEffectClass[]>> = {
  intake_only: ["read_only", "network_read"],
  mission_owner: ["read_only", "network_read", "local_reversible_write", "workspace_mutation", "repository_mutation", "network_publication", "third_party_communication", "delete_or_irreversible", "deployment_or_release"],
  delegation_only: ["read_only", "network_read"],
  execution_only: ["read_only", "network_read", "local_reversible_write", "workspace_mutation", "repository_mutation"],
  verification_only: ["read_only", "network_read"],
};

const CONFIRMATION_ACTIONS: ReadonlySet<WorkflowAction> = new Set<WorkflowAction>(["delete", "clean_generated", "restore_snapshot", "push", "publish", "communicate", "deploy"]);
const VERIFICATION_ACTIONS: ReadonlySet<WorkflowAction> = new Set<WorkflowAction>(["write", "append", "patch", "replace", "format", "copy", "move", "rename", "delete", "clean_generated", "apply_patch", "restore_snapshot", "branch", "stage", "commit", "push", "publish", "deploy"]);

export function sideEffectForAction(action: WorkflowAction) {
  return ACTION_SIDE_EFFECT[action];
}

export function isAuthorityClass(value: string): value is AuthorityClass {
  return (AUTHORITY_CLASSES as readonly string[]).includes(value);
}

export function isSideEffectClass(value: string): value is SideEffectClass {
  return (SIDE_EFFECT_CLASSES as readonly string[]).includes(value);
}

export function decideAuthority(input: {
  authority: AuthorityClass;
  action: WorkflowAction;
  allowedSideEffects?: readonly SideEffectClass[];
  confirmed?: boolean;
}): AuthorityDecision {
  const sideEffect = sideEffectForAction(input.action);
  const allowedEffects = input.allowedSideEffects || DEFAULT_ALLOWED_SIDE_EFFECTS[input.authority];
  const authorityAllows = allowedEffects.includes(sideEffect);
  const requiresConfirmation = CONFIRMATION_ACTIONS.has(input.action);
  const confirmed = !requiresConfirmation || input.confirmed === true;
  const allowed = authorityAllows && confirmed;
  const reason = !authorityAllows
    ? `${input.authority} cannot perform ${sideEffect}`
    : !confirmed
      ? `${input.action} requires explicit confirmation`
      : "authority and side-effect policy allow the action";
  return {
    action: input.action,
    authority: input.authority,
    sideEffect,
    allowed,
    requiresConfirmation,
    requiresVerification: VERIFICATION_ACTIONS.has(input.action),
    requiresAudit: sideEffect !== "read_only",
    reason,
  };
}

export function assertAuthority(input: Parameters<typeof decideAuthority>[0]) {
  const decision = decideAuthority(input);
  if (!decision.allowed) throw new Error(`Workflow authority denied: ${decision.reason}`);
  return decision;
}

export function permittedActions(authority: AuthorityClass, allowedSideEffects?: readonly SideEffectClass[]) {
  const effects = allowedSideEffects || DEFAULT_ALLOWED_SIDE_EFFECTS[authority];
  return (Object.keys(ACTION_SIDE_EFFECT) as WorkflowAction[]).filter((action) => effects.includes(ACTION_SIDE_EFFECT[action]));
}
