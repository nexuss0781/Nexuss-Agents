import { loadDomainSkillRegistry } from "./skillRegistry";
import { decideAuthority, type WorkflowAction } from "./authorityPolicy";
import type { SkillBinding, SkillSelectionRequest } from "./skillTypes";
import { authorityForRole } from "./runnerPolicy";

export async function selectMissionSkills(request: SkillSelectionRequest) {
  const registry = await loadDomainSkillRegistry();
  return registry.select(request);
}

export async function assertSkillBindings(input: {
  bindings: readonly SkillBinding[];
  role: string;
  stage: "research_inspect" | "design_reason" | "execute" | "verify" | "repair_recover" | "integrate";
  action?: WorkflowAction;
  harnesses?: readonly string[];
}) {
  const registry = await loadDomainSkillRegistry();
  for (const binding of input.bindings) {
    const skill = registry.get(binding.skillId);
    if (!skill) throw new Error(`Bound domain skill is unavailable: ${binding.skillId}`);
    if (skill.version !== binding.version) throw new Error(`Bound domain skill version mismatch: ${binding.skillId}@${binding.version}`);
    if (!skill.supportedStages.includes(input.stage)) throw new Error(`Domain skill ${binding.skillId} does not support stage ${input.stage}`);
    if (skill.allowedRoles.length && !skill.allowedRoles.includes(input.role)) throw new Error(`Domain skill ${binding.skillId} does not support role ${input.role}`);
    if (input.action && !skill.actions.includes(input.action)) throw new Error(`Domain skill ${binding.skillId} does not support action ${input.action}`);
    if (input.action) {
      const authorityDecision = decideAuthority({ authority: authorityForRole(input.role), action: input.action, confirmed: true });
      if (!authorityDecision.allowed) throw new Error(`Domain skill ${binding.skillId} action ${input.action} exceeds role authority: ${authorityDecision.reason}`);
    }
    if (input.harnesses?.length && !input.harnesses.every((harness) => skill.allowedHarnesses.includes(harness))) throw new Error(`Domain skill ${binding.skillId} does not support the requested harness set`);
  }
  return true;
}

export function skillEvidenceMetadata(bindings: readonly SkillBinding[]) {
  return bindings.map((binding) => ({ skillId: binding.skillId, skillVersion: binding.version, skillDomain: binding.domain, skillSource: binding.sourceFile }));
}

export function readSkillBindings(value: unknown): SkillBinding[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SkillBinding => Boolean(item && typeof item === "object" && typeof (item as SkillBinding).skillId === "string" && typeof (item as SkillBinding).version === "string" && typeof (item as SkillBinding).domain === "string" && typeof (item as SkillBinding).sourceFile === "string" && typeof (item as SkillBinding).selectionReason === "string"));
}
