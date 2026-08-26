import { readFile } from "node:fs/promises";
import path from "node:path";
import { WORKFLOW_STAGES, type WorkflowStage } from "./workflowTypes";

export type WorkflowSource = {
  id: string;
  fileName: string;
  path: string;
  content: string;
  contractVersion: string;
};

const STAGE_FILES: Readonly<Record<WorkflowStage, string>> = {
  receive: "Stage_01-Receive.md",
  understand: "Stage_02-Understand.md",
  intake: "Stage_03-Intake.md",
  form_mission: "Stage_04-Form-Mission.md",
  plan: "Stage_05-Plan.md",
  decompose_delegate: "Stage_06-Decompose-and-Delegate.md",
  research_inspect: "Stage_07-Research-and-Inspect.md",
  design_reason: "Stage_08-Design-and-Reason.md",
  execute: "Stage_09-Execute.md",
  observe_adapt: "Stage_10-Observe-and-Adapt.md",
  verify: "Stage_11-Verify.md",
  repair_recover: "Stage_12-Repair-and-Recover.md",
  integrate: "Stage_13-Integrate.md",
  quality_gate: "Stage_14-Quality-Gate.md",
  complete: "Stage_15-Complete.md",
  report_continue: "Stage_16-Report-and-Continue.md",
};

const ROOT_FILE = "ORCHESTRATOR.md";
const CONTRACT_FILE = "CONTRACT.md";
const STAGES_FILE = "STAGES.md";
const STATUS_FILE = "STATUS-VOCABULARY.md";
const FRONTMATTER_VERSION = /^version:\s*([^\n\r]+)/m;
const sourceCache = new Map<string, WorkflowSource>();

function workflowRoot() {
  return path.resolve(process.env.NEXUSS_WORKFLOWS_ROOT || path.join(process.cwd(), "Workflows"));
}

function parseVersion(content: string) {
  return content.match(FRONTMATTER_VERSION)?.[1]?.trim() || "unknown";
}

async function loadFile(id: string, fileName: string): Promise<WorkflowSource> {
  const cached = sourceCache.get(id);
  if (cached) return cached;
  const root = workflowRoot();
  const filePath = path.resolve(root, fileName);
  if (path.dirname(filePath) !== root) throw new Error(`Workflow source escaped the workflow root: ${fileName}`);
  const content = await readFile(filePath, "utf8");
  if (!content.trim()) throw new Error(`Workflow source is empty: ${fileName}`);
  const source = { id, fileName, path: filePath, content, contractVersion: parseVersion(content) };
  sourceCache.set(id, source);
  return source;
}

export function workflowSourceFile(stage: WorkflowStage) {
  return STAGE_FILES[stage];
}

export async function loadWorkflowRoot() {
  return loadFile("orchestrator", ROOT_FILE);
}

export async function loadWorkflowContract() {
  return loadFile("contract", CONTRACT_FILE);
}

export async function loadWorkflowStages() {
  return loadFile("stages", STAGES_FILE);
}

export async function loadWorkflowStatusVocabulary() {
  return loadFile("status_vocabulary", STATUS_FILE);
}

export async function loadWorkflowStage(stage: WorkflowStage) {
  if (!WORKFLOW_STAGES.includes(stage)) throw new Error(`Unknown workflow stage: ${stage}`);
  return loadFile(`stage:${stage}`, STAGE_FILES[stage]);
}

export async function loadWorkflowSources(input: { stage?: WorkflowStage; includeRoot?: boolean; includeContract?: boolean; includeRegistry?: boolean; includeStatusVocabulary?: boolean } = {}) {
  const sources: WorkflowSource[] = [];
  if (input.includeRoot !== false) sources.push(await loadWorkflowRoot());
  if (input.includeContract) sources.push(await loadWorkflowContract());
  if (input.includeRegistry) sources.push(await loadWorkflowStages());
  if (input.includeStatusVocabulary) sources.push(await loadWorkflowStatusVocabulary());
  if (input.stage) sources.push(await loadWorkflowStage(input.stage));
  return sources;
}

export function clearWorkflowSourceCache() {
  sourceCache.clear();
}
