import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { validateDomainSkillContract, type DomainSkillContractInput } from "./skillSchemas";
import type { DomainSkillContract, SkillRegistryDiagnostic, SkillRegistrySnapshot } from "./skillTypes";

const cache = new Map<string, DomainSkillContract>();
const METADATA_BLOCK = /```json\s*([\s\S]*?)```/i;

function skillsRoot() {
  return path.resolve(process.env.NEXUSS_DOMAIN_SKILLS_ROOT || path.join(process.cwd(), "Skills", "Domains"));
}

function hash(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function metadataFromMarkdown(content: string, sourceFile: string) {
  const block = content.match(METADATA_BLOCK)?.[1];
  if (!block) throw new Error(`Skill metadata JSON block is missing: ${sourceFile}`);
  try {
    return JSON.parse(block) as DomainSkillContractInput;
  } catch (error) {
    throw new Error(`Skill metadata JSON is invalid in ${sourceFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function skillFiles() {
  const root = skillsRoot();
  const directories = await readdir(root, { withFileTypes: true });
  return directories
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.resolve(root, entry.name, "SKILL.md"))
    .sort();
}

export async function loadDomainSkillFile(sourceFile: string): Promise<DomainSkillContract> {
  const absoluteFile = path.resolve(sourceFile);
  const cached = cache.get(absoluteFile);
  if (cached) return cached;
  const content = await readFile(absoluteFile, "utf8");
  if (!content.trim()) throw new Error(`Domain skill source is empty: ${absoluteFile}`);
  const parsed = validateDomainSkillContract(metadataFromMarkdown(content, absoluteFile));
  const skill: DomainSkillContract = { ...parsed, markdown: content, sourceFile: path.relative(process.cwd(), absoluteFile) || absoluteFile, sourceHash: hash(content) };
  cache.set(absoluteFile, skill);
  return skill;
}

export async function loadDomainSkillSnapshot(): Promise<SkillRegistrySnapshot> {
  const skills: DomainSkillContract[] = [];
  const diagnostics: SkillRegistryDiagnostic[] = [];
  let files: string[];
  try {
    files = await skillFiles();
  } catch (error) {
    return { skills: [], diagnostics: [{ sourceFile: skillsRoot(), message: error instanceof Error ? error.message : String(error) }] };
  }
  const seen = new Set<string>();
  for (const file of files) {
    try {
      const skill = await loadDomainSkillFile(file);
      const key = `${skill.id}@${skill.version}`;
      if (seen.has(key)) throw new Error(`Duplicate domain skill contract: ${key}`);
      seen.add(key);
      skills.push(skill);
    } catch (error) {
      diagnostics.push({ sourceFile: path.relative(process.cwd(), file) || file, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { skills: skills.sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version)), diagnostics };
}

export function clearDomainSkillCache() {
  cache.clear();
}

export function domainSkillsRoot() {
  return skillsRoot();
}
