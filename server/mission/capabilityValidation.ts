import { AUTHORITY_CLASSES, SIDE_EFFECT_CLASSES } from "./workflowTypes";
import type { CapabilityContract } from "./capabilityTypes";

export function validateCapabilityContract(contract: CapabilityContract) {
  if (!contract.id.trim() || !/^\d+\.\d+\.\d+$/.test(contract.version)) throw new Error(`Invalid capability identity: ${contract.id}`);
  if (!contract.operations.length) throw new Error(`Capability has no operations: ${contract.id}`);
  const operationIds = new Set<string>();
  for (const operation of contract.operations) {
    if (operationIds.has(operation.id)) throw new Error(`Duplicate capability operation: ${contract.id}/${operation.id}`);
    operationIds.add(operation.id);
    if (!operation.description.trim() || !operation.action.trim()) throw new Error(`Capability operation is incomplete: ${contract.id}/${operation.id}`);
    if (!SIDE_EFFECT_CLASSES.includes(operation.sideEffect)) throw new Error(`Capability operation has an invalid side effect: ${contract.id}/${operation.id}`);
    if (!operation.evidence.length) throw new Error(`Capability operation has no evidence contract: ${contract.id}/${operation.id}`);
  }
  if (contract.kind === "harness" && (!Number.isInteger(contract.maxTimeoutMs) || contract.maxTimeoutMs < 1)) throw new Error(`Capability harness has an invalid timeout: ${contract.id}`);
  if (contract.kind === "tool" && !AUTHORITY_CLASSES.includes(contract.authority)) throw new Error(`Capability tool has an invalid authority: ${contract.id}`);
  return contract;
}

export function validateCapabilityRegistry(contracts: readonly CapabilityContract[]): CapabilityContract[] {
  const seen = new Set<string>();
  for (const contract of contracts) {
    validateCapabilityContract(contract);
    const key = `${contract.kind}:${contract.id}@${contract.version}`;
    if (seen.has(key)) throw new Error(`Duplicate capability contract: ${key}`);
    seen.add(key);
  }
  return [...contracts];
}
