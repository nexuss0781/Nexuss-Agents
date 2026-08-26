import { loadDomainSkillSnapshot } from "./skillLoader";
import type { DomainSkillContract, SkillBinding, SkillSelectionRequest } from "./skillTypes";

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, " ");
}

function domainAlias(value: string) {
  const normalized = normalize(value).replace(/ /g, "_");
  return ({ software_delivery: "software_engineering", software: "software_engineering", math: "mathematics", mixed: "mixed_mission" } as Record<string, string>)[normalized] || normalized;
}

function latestById(skills: readonly DomainSkillContract[]) {
  const selected = new Map<string, DomainSkillContract>();
  for (const skill of skills) {
    const previous = selected.get(skill.id);
    if (!previous || skill.version.localeCompare(previous.version, undefined, { numeric: true }) > 0) selected.set(skill.id, skill);
  }
  return selected;
}

export class DomainSkillRegistry {
  private readonly skills: Map<string, DomainSkillContract>;
  readonly diagnostics: readonly { sourceFile: string; skillId?: string; message: string }[];

  constructor(snapshot: Awaited<ReturnType<typeof loadDomainSkillSnapshot>>) {
    this.skills = latestById(snapshot.skills);
    this.diagnostics = snapshot.diagnostics;
  }

  list() {
    return Array.from(this.skills.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string) {
    return this.skills.get(id);
  }

  select(request: SkillSelectionRequest): SkillBinding[] {
    const requestedIds = new Set((request.requiredSkills || []).map((value) => value.trim()).filter(Boolean));
    const requestedDomainIds = new Set(Array.from(requestedIds).filter((id) => id.startsWith("domain.") || ["research", "software_engineering", "software_delivery", "software", "mathematics", "math", "mixed_mission", "mixed"].includes(domainAlias(id))));
    const requestedDomains = new Set((request.domains || []).map(domainAlias).filter(Boolean));
    const objective = normalize(request.objective);
    const candidates = this.list().filter((skill) => {
      if (request.stage && !skill.supportedStages.includes(request.stage)) return false;
      if (request.role && skill.allowedRoles.length && !skill.allowedRoles.includes(request.role)) return false;
      if (request.actions?.length && !request.actions.every((action) => skill.actions.includes(action))) return false;
      if (request.harnesses?.length && !request.harnesses.every((harness) => skill.allowedHarnesses.includes(harness))) return false;
      const explicitMatch = requestedDomainIds.has(skill.id) || requestedDomainIds.has(skill.domain) || requestedDomainIds.has(`domain.${skill.domain}`);
      const domainMatch = requestedDomains.has(skill.domain) || requestedDomains.has(skill.id.replace("domain.", ""));
      const signalMatch = skill.missionSignals.some((signal) => objective.includes(normalize(signal)));
      return explicitMatch || domainMatch || signalMatch;
    });
    for (const id of requestedDomainIds) if (!this.skills.has(id) && !this.skills.has(`domain.${domainAlias(id)}`) && !Array.from(this.skills.values()).some((skill) => skill.domain === domainAlias(id))) throw new Error(`Requested domain skill is unavailable: ${id}`);
    if (!candidates.length && this.skills.has("domain.mixed_mission")) candidates.push(this.skills.get("domain.mixed_mission")!);
    if (!candidates.length) throw new Error("No compatible domain skill was found for the mission");
    const unique = Array.from(new Map(candidates.map((skill) => [skill.id, skill])).values());
    return unique.map((skill) => ({ skillId: skill.id, version: skill.version, domain: skill.domain, sourceFile: skill.sourceFile, selectionReason: requestedDomainIds.has(skill.id) || requestedDomainIds.has(skill.domain) || requestedDomainIds.has(`domain.${skill.domain}`) ? "explicit mission skill" : requestedDomains.has(skill.domain) ? "mission domain match" : "objective signal match" }));
  }
}

let registryPromise: Promise<DomainSkillRegistry> | undefined;

export async function loadDomainSkillRegistry(options: { reload?: boolean } = {}) {
  if (!registryPromise || options.reload) registryPromise = loadDomainSkillSnapshot().then((snapshot) => new DomainSkillRegistry(snapshot));
  return registryPromise;
}

export function clearDomainSkillRegistryCache() {
  registryPromise = undefined;
}
