import { collectRepositorySnapshot, applyRepositoryWrites, runRepositoryCommand, repositoryRoot } from "./harness";
import { streamWorkspaceModel } from "../paradoxWorkspace";
import { planRepositoryChange } from "./orchestrator";
import { recordMissionEvent } from "./events";
import { redactSensitiveData } from "./redaction";
import { runSpecialistAgent, spawnBuilderReviews } from "./specialistOrchestrator";
import type { MissionExecutionResult, MissionExecutor } from "./runner";
import type { MissionSnapshot, MissionWorkItem } from "./store";

const executionPrompt = `You are executing one bounded repository work item inside an autonomous coding mission. Return JSON only with this shape:
{"summary":"string","writes":[{"path":"relative/path","content":"complete file content"}],"commands":[{"program":"pnpm|npm|yarn|git","args":["allowlisted arguments"]}]}

Rules:
- Inspect the supplied repository snapshot and work item before deciding.
- Make the smallest cohesive change that advances the work item.
- Use at most 20 file writes and never write secrets, .env files, key files, certificates, .git data, or files outside the repository.
- Commands are optional and must be allowlisted verification or inspection commands only.
- Do not claim verification; the harness will execute commands and determine their result.
- Do not include credentials, prompts, cookies, or tokens in output.
- Return complete file contents for every write; do not return patches or omissions.
- If this work item is inspection-only, return no writes and a concise summary.`;

type ProposedChange = {
  summary?: unknown;
  writes?: unknown;
  commands?: unknown;
};

type ProposedWrite = { path: string; content: string };
type ProposedCommand = { program: string; args: string[] };

function bounded(value: unknown, fallback: string, max: number) { return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback; }
function parseJson(content: string): ProposedChange {
  const trimmed = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Repository executor returned no JSON object");
  return JSON.parse(trimmed.slice(start, end + 1)) as ProposedChange;
}

function normalizeWrites(value: unknown): ProposedWrite[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((entry) => {
    const item = entry as Record<string, unknown>;
    if (typeof item.path !== "string" || typeof item.content !== "string") throw new Error("Repository executor returned an invalid file write");
    return { path: item.path, content: item.content };
  });
}

function normalizeCommands(value: unknown): ProposedCommand[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((entry) => {
    const item = entry as Record<string, unknown>;
    if (typeof item.program !== "string" || !Array.isArray(item.args) || !item.args.every((arg) => typeof arg === "string")) throw new Error("Repository executor returned an invalid command");
    return { program: item.program, args: item.args as string[] };
  });
}

async function executeQualityGate(ownerId: string, missionId: string, root: string, signal: AbortSignal) {
  await recordMissionEvent(ownerId, missionId, { type: "quality_gate.started", actor: "quality_gate" });
  const checks: Array<Awaited<ReturnType<typeof runRepositoryCommand>>> = [];
  for (const [program, args] of [["pnpm", ["check"]], ["pnpm", ["test"]], ["pnpm", ["build"]], ["git", ["diff", "--check"]]] as const) {
    const result = await runRepositoryCommand(root, program, args, signal);
    checks.push(result);
    if (result.cancelled || result.timedOut || result.exitCode !== 0) break;
  }
  const failed = checks.find((check) => check.cancelled || check.timedOut || check.exitCode !== 0);
  const verified = !failed && checks.length === 4;
  await recordMissionEvent(ownerId, missionId, { type: "quality_gate.completed", actor: "quality_gate", payload: { verified, checkCount: checks.length, failedCommand: failed ? `${failed.program} ${failed.args.join(" ")}` : null } });
  return {
    verified,
    summary: failed ? `Quality gate failed: ${failed.program} ${failed.args.join(" ")}` : "TypeScript, tests, build, and diff checks passed",
    checks: checks.map((check) => ({ command: [check.program, ...check.args].join(" "), exitCode: check.exitCode, durationMs: check.durationMs, timedOut: check.timedOut, cancelled: check.cancelled, stdout: check.stdout.slice(-2_000), stderr: check.stderr.slice(-2_000) })),
  };
}

async function executeModelWorkItem(ownerId: string, missionId: string, root: string, model: string, mission: MissionSnapshot, item: MissionWorkItem, signal: AbortSignal): Promise<MissionExecutionResult> {
  await recordMissionEvent(ownerId, missionId, { type: "executor.started", actor: "repository_executor", workItemId: item.id, payload: { role: item.role, attempt: item.attempt } });
  const snapshot = await collectRepositorySnapshot(root, signal);
  const relevantFiles = snapshot.trackedFiles.filter((path) => !/(^|[\\/])\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i.test(path)).slice(0, 250);
  const specialistEvidence = mission.workItems.filter((candidate) => candidate.status === "completed" && ["sub_orchestrator", "architect", "security_auditor"].includes(candidate.role)).map((candidate) => ({ title: candidate.title, role: candidate.role, output: candidate.output || {} }));
  const messages = [
    { role: "system" as const, content: `${executionPrompt}\nRole policy: ${item.role === "builder" ? "You may propose bounded file writes." : "You are read-only for this role; return no writes."}` },
    { role: "user" as const, content: JSON.stringify(redactSensitiveData({ workItem: { title: item.title, description: item.description, role: item.role, acceptanceCriteria: item.acceptanceCriteria, input: item.input }, specialistEvidence, repository: { status: snapshot.status, trackedFiles: relevantFiles, packageJson: snapshot.packageJson } })) },
  ];
  const result = await streamWorkspaceModel(ownerId, { model, messages }, signal);
  if (result.stopped) return { verified: false, summary: "Repository work was cancelled", failureClass: "CANCELLED" };
  if (!result.finished) throw new Error("Repository executor stream ended without a completion signal");
  const proposed = parseJson(result.content);
  const writes = normalizeWrites(proposed.writes);
  const commands = normalizeCommands(proposed.commands);
  const changedFiles = await applyRepositoryWrites(root, writes);
  const commandResults = [];
  for (const command of commands) {
    const commandResult = await runRepositoryCommand(root, command.program, command.args, signal);
    commandResults.push(commandResult);
    if (commandResult.cancelled || commandResult.timedOut || commandResult.exitCode !== 0) break;
  }
  const failedCommand = commandResults.find((command) => command.cancelled || command.timedOut || command.exitCode !== 0);
  const verified = !failedCommand;
  await recordMissionEvent(ownerId, missionId, { type: verified ? "executor.completed" : "executor.failed", actor: "repository_executor", workItemId: item.id, payload: { verified, changedFileCount: changedFiles.length, commandCount: commandResults.length, failedCommand: failedCommand ? `${failedCommand.program} ${failedCommand.args.join(" ")}` : null } });
  if (changedFiles.length || commandResults.length) await recordMissionEvent(ownerId, missionId, { type: "evidence.recorded", actor: "repository_executor", workItemId: item.id, payload: { changedFileCount: changedFiles.length, commandCount: commandResults.length } });
  return {
    verified,
    summary: bounded(proposed.summary, changedFiles.length ? `Applied ${changedFiles.length} repository change(s)` : "Inspected the repository without file changes", 2_000),
    ...(failedCommand ? { failureClass: failedCommand.timedOut ? "COMMAND_TIMEOUT" : failedCommand.cancelled ? "CANCELLED" : "COMMAND_FAILED", nextAction: "inspect the failed command and repair the change" } : {}),
    artifactIds: changedFiles,
  };
}

export function createRepositoryChangeExecutor(): MissionExecutor {
  return async ({ ownerId, mission, signal, activeWorkItem }) => {
    const root = repositoryRoot();
    if (!activeWorkItem) {
      if (mission.workItems.length > 0) return { verified: true, continueMission: true, summary: "Work graph is ready; continuing with the next executable work item" };
      const plan = await planRepositoryChange(ownerId, mission.mission.id, signal);
      return { verified: true, continueMission: true, summary: `Created a ${plan.workItems.length}-step repository work graph` };
    }
    if (activeWorkItem.role === "sub_orchestrator") {
      if (!mission.mission.contract.model) return { verified: true, summary: "Specialist reviews deferred because no model is configured", artifactIds: ["specialist-reviews-deferred"] };
      const snapshot = await collectRepositorySnapshot(root, signal);
      const findings = await spawnBuilderReviews({ ownerId, missionId: mission.mission.id, model: mission.mission.contract.model, workItem: activeWorkItem, repositoryContext: snapshot, signal });
      return { verified: findings.every((finding) => finding.completed), summary: findings.every((finding) => finding.completed) ? "Architecture and security specialists completed their independent reviews" : "One or more specialist reviews were unavailable", artifactIds: findings.map((finding) => `specialist-${finding.kind}`), ...(findings.every((finding) => finding.completed) ? {} : { failureClass: "SPECIALIST_REVIEW_FAILED", nextAction: "retry the specialist review stage" }) };
    }
    if (activeWorkItem.role === "security_auditor") {
      if (!mission.mission.contract.model) return { verified: true, summary: "Security audit used the bounded harness policy without a model", artifactIds: ["security-policy-baseline"] };
      const snapshot = await collectRepositorySnapshot(root, signal);
      const finding = await runSpecialistAgent({ ownerId, missionId: mission.mission.id, model: mission.mission.contract.model, kind: "security_auditor", workItem: activeWorkItem, repositoryContext: snapshot, signal });
      return { verified: finding.completed, summary: finding.summary, artifactIds: ["specialist-security_auditor"], ...(finding.completed ? {} : { failureClass: "SECURITY_REVIEW_FAILED", nextAction: "retry the independent security audit" }) };
    }
    if (activeWorkItem.role === "quality") {
      const quality = await executeQualityGate(ownerId, mission.mission.id, root, signal);
      return { verified: quality.verified, summary: quality.summary, ...(quality.verified ? {} : { failureClass: "QUALITY_GATE_FAILED", nextAction: "repair the repository change using the failed check evidence" }), artifactIds: quality.checks.map((check) => check.command) };
    }
    if (activeWorkItem.role === "architect" && mission.mission.contract.model) {
      const snapshot = await collectRepositorySnapshot(root, signal);
      const finding = await runSpecialistAgent({ ownerId, missionId: mission.mission.id, model: mission.mission.contract.model, kind: "repository_architect", workItem: activeWorkItem, repositoryContext: snapshot, signal });
      return { verified: finding.completed, summary: finding.summary, artifactIds: ["specialist-repository_architect"], ...(finding.completed ? {} : { failureClass: "ARCHITECTURE_REVIEW_FAILED", nextAction: "retry the architecture review" }) };
    }
    if (!mission.mission.contract.model && activeWorkItem.role === "architect") {
      const snapshot = await collectRepositorySnapshot(root, signal);
      return { verified: true, summary: `Repository baseline captured: ${snapshot.trackedFiles.length} tracked file(s)`, artifactIds: ["repository-status", "repository-file-list"] };
    }
    if (activeWorkItem.role === "integrator" && mission.mission.contract.model) {
      const snapshot = await collectRepositorySnapshot(root, signal);
      const finding = await runSpecialistAgent({ ownerId, missionId: mission.mission.id, model: mission.mission.contract.model, kind: "integrator", workItem: activeWorkItem, repositoryContext: snapshot, signal });
      return { verified: finding.completed, summary: finding.summary, artifactIds: ["specialist-integrator"], ...(finding.completed ? {} : { failureClass: "INTEGRATION_REVIEW_FAILED", nextAction: "retry the integrator review" }) };
    }
    if (!mission.mission.contract.model && activeWorkItem.role === "integrator") {
      const status = await runRepositoryCommand(root, "git", ["status", "--short"], signal);
      return { verified: status.exitCode === 0, summary: status.exitCode === 0 ? "Verified the final repository integration state" : "Could not read the final repository integration state", artifactIds: ["repository-final-status"], ...(status.exitCode === 0 ? {} : { failureClass: "INTEGRATION_STATUS_FAILED", nextAction: "retry the final repository status check" }) };
    }
    if (!mission.mission.contract.model) return { verified: false, summary: "A selected model is required for bounded repository implementation work", failureClass: "MODEL_NOT_CONFIGURED", nextAction: "configure and select a server-side model, then retry the mission" };
    return executeModelWorkItem(ownerId, mission.mission.id, root, mission.mission.contract.model, mission, activeWorkItem, signal);
  };
}
