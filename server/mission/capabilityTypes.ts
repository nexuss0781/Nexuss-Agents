import type { AuthorityClass, SideEffectClass } from "./workflowTypes";
import type { HarnessId, HarnessStatus } from "./harnessRegistry";

export const CAPABILITY_CONTRACT_VERSION = "1.0.0" as const;
export type CapabilityKind = "tool" | "harness";
export type CapabilityStatus = "implemented" | "contract_only";

export type CapabilityOperation = {
  id: string;
  description: string;
  action: string;
  sideEffect: SideEffectClass;
  requiresConfirmation: boolean;
  requiresVerification: boolean;
  evidence: string[];
};

export type ToolCapabilityContract = {
  kind: "tool";
  id: string;
  version: string;
  title: string;
  status: CapabilityStatus;
  operations: CapabilityOperation[];
  authority: AuthorityClass;
  allowedHarnesses: HarnessId[];
  maxBatchSize?: number;
};

export type HarnessCapabilityContract = {
  kind: "harness";
  id: HarnessId;
  version: string;
  title: string;
  status: HarnessStatus;
  operations: CapabilityOperation[];
  maxTimeoutMs: number;
  secretBoundary: string;
};

export type CapabilityContract = ToolCapabilityContract | HarnessCapabilityContract;

export type CapabilityInvocation = {
  capabilityId: string;
  operation: string;
  actorRole: string;
  authority: AuthorityClass;
  confirmed?: boolean;
  timeoutMs?: number;
};

export type CapabilityDecision = {
  allowed: boolean;
  capabilityId: string;
  operation: string;
  action: string;
  sideEffect: SideEffectClass;
  requiresConfirmation: boolean;
  requiresVerification: boolean;
  evidence: string[];
  reason: string;
};
