import type { AgentRoleContract } from "./agentContracts";
import { assertHarnessRequest, type HarnessId, type HarnessRequest } from "./harnessRegistry";
import { getSkill, type SkillId } from "./skills";

export function assertSkillAllowed(contract: AgentRoleContract, skill: SkillId) {
  if (!contract.allowedSkills.includes(skill)) throw new Error(`Skill is not allowed for ${contract.kind}: ${skill}`);
  return getSkill(skill);
}

export function assertHarnessAllowed(contract: AgentRoleContract, request: HarnessRequest) {
  if (!contract.allowedHarnesses.includes(request.harness)) throw new Error(`Harness is not allowed for ${contract.kind}: ${request.harness}`);
  return assertHarnessRequest(request);
}

export function assertDelegationAllowed(contract: AgentRoleContract, childCount: number) {
  if (!contract.canDelegate) throw new Error(`Agent cannot delegate: ${contract.kind}`);
  if (childCount > contract.budget.maxChildren) throw new Error(`Agent child budget exceeded: ${contract.kind}`);
}

export function assertRepositoryWriteAllowed(contract: AgentRoleContract) {
  if (!contract.canWriteRepository) throw new Error(`Agent cannot write the repository: ${contract.kind}`);
}

export function assertIndependentVerificationAllowed(contract: AgentRoleContract) {
  if (!contract.canVerifyProducerOutput) throw new Error(`Agent cannot act as an independent verifier: ${contract.kind}`);
}

export function isHarnessId(value: string): value is HarnessId { return ["mission_runtime", "repository_inspection", "repository_change", "repository_verification", "specialist_spawn", "research", "browser", "webdev", "terminal"].includes(value); }
