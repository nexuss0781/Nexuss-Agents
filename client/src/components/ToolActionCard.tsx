import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Code2,
  FileCode2,
  Files,
  ListChecks,
  LoaderCircle,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";

export type ToolActionEvent = {
  id: string;
  type: string;
  actor: string;
  workItemId?: string;
  sequence?: number;
  createdAt: string;
  payload?: Record<string, unknown>;
};

type ActionMeta = {
  label: string;
  detail: string;
  Icon: LucideIcon;
  state: "active" | "complete" | "attention";
};

const ACTION_META: Record<string, Omit<ActionMeta, "state">> = {
  "orchestration.plan_created": { label: "Plan prepared", detail: "The work has been organized into a clear execution path.", Icon: ListChecks },
  "orchestration.plan_rejected": { label: "Plan adjusted", detail: "The agent selected another workable path and continued.", Icon: RotateCcw },
  "specialist.spawned": { label: "Specialist started", detail: "A focused specialist is working on this part of the task.", Icon: Sparkles },
  "specialist.completed": { label: "Specialist finished", detail: "The specialist returned its findings to the main work.", Icon: CheckCircle2 },
  "specialist.failed": { label: "Specialist adjusted", detail: "The agent handled a specialist issue and kept the work moving.", Icon: RotateCcw },
  "executor.started": { label: "Working in the project", detail: "The agent is applying the current work item to the project.", Icon: FileCode2 },
  "executor.completed": { label: "Project work complete", detail: "The work item produced a result for verification.", Icon: CheckCircle2 },
  "executor.failed": { label: "Work being refined", detail: "The agent found an issue and is refining the result.", Icon: RotateCcw },
  "quality_gate.started": { label: "Checking the result", detail: "Independent checks are running against the project.", Icon: ShieldCheck },
  "quality_gate.completed": { label: "Result checked", detail: "The verification step has returned its result.", Icon: ClipboardCheck },
  "evidence.recorded": { label: "Evidence captured", detail: "The latest result has been added to the mission record.", Icon: Files },
  "knowledge.candidate_created": { label: "Learning captured", detail: "A reusable insight was recorded for future work.", Icon: Code2 },
  "knowledge.replay_completed": { label: "Prior knowledge reviewed", detail: "Relevant previous evidence has been replayed.", Icon: Search },
  "work_item.blocked": { label: "Work needs a new path", detail: "The agent is handling a dependency before continuing.", Icon: AlertCircle },
  "runner.error": { label: "Agent is recovering", detail: "The runtime is handling an execution issue.", Icon: RotateCcw },
  "runner.recovery_started": { label: "Work resumed", detail: "The runtime is restoring the mission and continuing.", Icon: RotateCcw },
};

const TERMINAL_META: Record<string, Omit<ActionMeta, "state">> = {
  terminal: { label: "Running project command", detail: "Working…", Icon: Terminal },
};

const FILESYSTEM_META: Record<string, Omit<ActionMeta, "state">> = {
  read: { label: "Reading file", detail: "Reading…", Icon: FileCode2 },
  read_many: { label: "Reading files", detail: "Reading…", Icon: Files },
  write: { label: "Writing file", detail: "Writing…", Icon: FileCode2 },
  create: { label: "Creating file", detail: "Creating…", Icon: FileCode2 },
  append: { label: "Appending file", detail: "Appending…", Icon: FileCode2 },
  patch: { label: "Patching file", detail: "Applying patch…", Icon: FileCode2 },
  replace: { label: "Replacing file content", detail: "Replacing…", Icon: FileCode2 },
  format: { label: "Formatting file", detail: "Formatting…", Icon: Code2 },
  copy: { label: "Copying files", detail: "Copying…", Icon: Files },
  move: { label: "Moving files", detail: "Moving…", Icon: Files },
  rename: { label: "Renaming file", detail: "Renaming…", Icon: FileCode2 },
  delete: { label: "Deleting file", detail: "Deleting…", Icon: RotateCcw },
  clean_generated: { label: "Cleaning generated files", detail: "Cleaning…", Icon: RotateCcw },
  grep: { label: "Searching files", detail: "Searching…", Icon: Search },
  grep_batch: { label: "Searching files", detail: "Searching…", Icon: Search },
  glob: { label: "Finding files", detail: "Finding…", Icon: Search },
  symbols: { label: "Reading code structure", detail: "Inspecting symbols…", Icon: Code2 },
  references: { label: "Finding references", detail: "Searching code…", Icon: Search },
  diff_file: { label: "Reviewing file changes", detail: "Reading diff…", Icon: ClipboardCheck },
  diff_workspace: { label: "Reviewing project changes", detail: "Reading diff…", Icon: ClipboardCheck },
  apply_patch: { label: "Applying patch", detail: "Applying…", Icon: FileCode2 },
  snapshot: { label: "Saving workspace point", detail: "Saving…", Icon: RotateCcw },
  verify_workspace: { label: "Verifying workspace", detail: "Comparing files…", Icon: ShieldCheck },
};

function actionState(type: string, payload: Record<string, unknown>): ActionMeta["state"] {
  if (type.endsWith(".failed") || type === "runner.error" || type === "work_item.blocked") return "attention";
  if (type.endsWith(".completed") || type.endsWith(".recorded") || type === "orchestration.plan_created" || type === "runner.recovery_started") return "complete";
  if (payload.verified === true) return "complete";
  return "active";
}

function lifecycleMeta(type: string, payload: Record<string, unknown>) {
  const action = typeof payload.action === "string" ? payload.action : "";
  const base = type.startsWith("filesystem.") && FILESYSTEM_META[action] ? FILESYSTEM_META[action] : type.startsWith("terminal.") && TERMINAL_META[action] ? TERMINAL_META[action] : ACTION_META[type] || { label: "Agent action", detail: "The agent is progressing through the task.", Icon: Terminal };
  if (type === "filesystem.completed") return { ...base, label: action === "write" ? "File written" : action === "create" ? "File created" : action === "read" ? "File read" : action === "append" ? "File updated" : `${base.label.replace(/…$/, "")} complete`, detail: "Completed" };
  if (type === "filesystem.failed") return { ...base, label: action === "write" ? "Write failed" : action === "read" ? "Read failed" : `${base.label.replace(/…$/, "")} paused`, detail: "The agent is handling it and continuing." };
  if (type === "terminal.completed") return { ...base, label: "Command complete", detail: "Completed" };
  if (type === "terminal.failed") return { ...base, label: "Command failed", detail: "The agent is handling it and continuing." };
  return base;
}

function readableActor(actor: string) {
  return actor.replaceAll("_", " ");
}

function readableKey(key: string) {
  return key.replaceAll(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
}

function readableValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => readableValue(item)).join(", ");
  return JSON.stringify(value);
}

const DETAIL_KEYS = new Set([
  "role",
  "kind",
  "attempt",
  "workItemCount",
  "assumptionCount",
  "verified",
  "checkCount",
  "changedFileCount",
  "commandCount",
  "failedCommand",
  "failureClass",
  "classification",
  "fallback",
  "previousStatus",
  "specialistKind",
  "outputLength",
]);

export function ToolActionCard({ event }: { event: ToolActionEvent }) {
  const [expanded, setExpanded] = useState(false);
  const payload = event.payload || {};
  const base = lifecycleMeta(event.type, payload);
  const state = actionState(event.type, payload);
  const Icon = state === "active" ? LoaderCircle : state === "attention" ? AlertCircle : CheckCircle2;
  const details = useMemo(() => Object.entries(payload).filter(([key, value]) => DETAIL_KEYS.has(key) && value !== null && value !== undefined && value !== ""), [payload]);
  const time = new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <article className={`tool-action-card is-${state} ${expanded ? "is-expanded" : ""}`}>
      <button className="tool-action-trigger" type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <span className="tool-action-icon" aria-hidden="true"><Icon size={15} className={state === "active" ? "tool-action-spin" : ""} /></span>
        <span className="tool-action-copy"><strong>{base.label}</strong><small>{base.detail}</small></span>
        <span className="tool-action-meta"><span>{time}</span><ChevronDown size={14} className="tool-action-chevron" /></span>
      </button>
      {expanded && <div className="tool-action-details">
        <div className="tool-action-detail-row"><span>Agent</span><strong>{readableActor(event.actor)}</strong></div>
        {event.workItemId && <div className="tool-action-detail-row"><span>Work item</span><strong>{event.workItemId}</strong></div>}
        {details.map(([key, value]) => <div className="tool-action-detail-row" key={key}><span>{readableKey(key)}</span><strong>{readableValue(value)}</strong></div>)}
      </div>}
    </article>
  );
}

export function ToolActionStack({ events }: { events: ToolActionEvent[] }) {
  if (!events.length) return null;
  return <section className="tool-action-stack" aria-label="Agent activity">{events.map((event) => <ToolActionCard key={event.id} event={event} />)}</section>;
}
