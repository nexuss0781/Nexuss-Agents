import { z } from "zod";

export const TERMINAL_CONTRACT_VERSION = "1.0.0" as const;

export const terminalLaneSchema = z.enum(["local", "github_actions"]);
export type TerminalLane = z.infer<typeof terminalLaneSchema>;

export const terminalStateSchema = z.enum([
  "queued",
  "starting",
  "running",
  "awaiting_input",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "interrupted",
]);
export type TerminalState = z.infer<typeof terminalStateSchema>;

export const terminalEventKindSchema = z.enum([
  "stdout",
  "stderr",
  "stdin",
  "status",
  "metric",
  "heartbeat",
  "artifact",
  "log",
]);
export type TerminalEventKind = z.infer<typeof terminalEventKindSchema>;

export const terminalEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
  kind: terminalEventKindSchema,
  state: terminalStateSchema.optional(),
  text: z.string().max(100_000).optional(),
  input: z.string().max(20_000).optional(),
  metric: z.object({
    name: z.string().min(1).max(120),
    value: z.number().finite(),
    unit: z.string().max(40).optional(),
  }).optional(),
  artifactId: z.string().min(1).max(256).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
}).superRefine((event, context) => {
  const hasPayload = event.text !== undefined || event.input !== undefined || event.metric !== undefined || event.artifactId !== undefined || event.state !== undefined;
  if (!hasPayload) context.addIssue({ code: "custom", message: "Terminal events must carry a state or event payload." });
  if (event.kind === "stdout" && event.text === undefined) context.addIssue({ code: "custom", message: "stdout events require text." });
  if (event.kind === "stderr" && event.text === undefined) context.addIssue({ code: "custom", message: "stderr events require text." });
  if (event.kind === "stdin" && event.input === undefined) context.addIssue({ code: "custom", message: "stdin events require input." });
  if (event.kind === "metric" && event.metric === undefined) context.addIssue({ code: "custom", message: "metric events require a metric payload." });
  if (event.kind === "artifact" && event.artifactId === undefined) context.addIssue({ code: "custom", message: "artifact events require an artifact ID." });
});
export type TerminalEvent = z.infer<typeof terminalEventSchema>;

export const terminalTimeoutSchema = z.object({
  timeoutMs: z.number().int().positive().max(7 * 24 * 60 * 60 * 1000),
  idleTimeoutMs: z.number().int().positive().max(24 * 60 * 60 * 1000).optional(),
});
export type TerminalTimeout = z.infer<typeof terminalTimeoutSchema>;

export const terminalMonitoringRuleSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.enum(["heartbeat_missing", "metric_threshold", "error_pattern", "job_failure", "custom_status"]),
  description: z.string().min(1).max(500),
  metricName: z.string().min(1).max(120).optional(),
  operator: z.enum(["lt", "lte", "eq", "gte", "gt"]).optional(),
  threshold: z.number().finite().optional(),
  windowMs: z.number().int().positive().max(24 * 60 * 60 * 1000).optional(),
  action: z.enum(["notify", "cancel", "mark_attention", "fail"]),
}).superRefine((rule, context) => {
  if (rule.kind === "metric_threshold" && (!rule.metricName || !rule.operator || rule.threshold === undefined)) {
    context.addIssue({ code: "custom", message: "Metric threshold rules require metricName, operator, and threshold." });
  }
  if (rule.kind === "heartbeat_missing" && rule.windowMs === undefined) {
    context.addIssue({ code: "custom", message: "Heartbeat rules require windowMs." });
  }
});
export type TerminalMonitoringRule = z.infer<typeof terminalMonitoringRuleSchema>;

export const terminalArtifactSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  kind: z.enum(["log", "report", "dataset", "model", "binary", "archive", "other"]),
  url: z.string().url().optional(),
  contentType: z.string().max(160).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  producedAt: z.string().datetime(),
});
export type TerminalArtifact = z.infer<typeof terminalArtifactSchema>;

export const localTerminalRequestSchema = z.object({
  contractVersion: z.literal(TERMINAL_CONTRACT_VERSION),
  lane: z.literal("local"),
  projectId: z.string().min(1).max(128).optional(),
  workingDirectory: z.string().min(1).max(4_096),
  command: z.string().min(1).max(100_000),
  shell: z.string().min(1).max(120).default("bash"),
  interactive: z.boolean().default(false),
  timeout: terminalTimeoutSchema,
  label: z.string().max(240).optional(),
});
export type LocalTerminalRequest = z.infer<typeof localTerminalRequestSchema>;

export const workflowStrategySchema = z.object({
  matrix: z.record(z.string(), z.array(z.string().min(1).max(256))).optional(),
  include: z.array(z.record(z.string(), z.string().max(1_000))).max(100).optional(),
  exclude: z.array(z.record(z.string(), z.string().max(1_000))).max(100).optional(),
  maxParallel: z.number().int().positive().max(100).optional(),
  failFast: z.boolean().optional(),
});
export type WorkflowStrategy = z.infer<typeof workflowStrategySchema>;

export const externalWorkflowRequestSchema = z.object({
  contractVersion: z.literal(TERMINAL_CONTRACT_VERSION),
  lane: z.literal("github_actions"),
  owner: z.string().min(1).max(100),
  repository: z.string().min(1).max(100),
  workflowId: z.union([z.string().regex(/^\d+$/), z.string().regex(/^[A-Za-z0-9._/-]+\.ya?ml$/)]),
  ref: z.string().min(1).max(256),
  inputs: z.record(z.string(), z.string().max(20_000)).refine((inputs) => Object.keys(inputs).length <= 25, "GitHub Actions dispatch inputs cannot exceed 25 properties."),
  strategy: workflowStrategySchema.optional(),
  timeout: terminalTimeoutSchema,
  monitoringRules: z.array(terminalMonitoringRuleSchema).max(50).default([]),
  label: z.string().max(240).optional(),
});
export type ExternalWorkflowRequest = z.infer<typeof externalWorkflowRequestSchema>;

export const terminalRequestSchema = z.discriminatedUnion("lane", [localTerminalRequestSchema, externalWorkflowRequestSchema]);
export type TerminalRequest = z.infer<typeof terminalRequestSchema>;

export const localTerminalIdentitySchema = z.object({
  sessionId: z.string().min(1).max(256),
  processId: z.number().int().positive().optional(),
  workingDirectory: z.string().min(1).max(4_096),
});
export type LocalTerminalIdentity = z.infer<typeof localTerminalIdentitySchema>;

export const githubActionsIdentitySchema = z.object({
  workflowRunId: z.number().int().positive(),
  runUrl: z.string().url(),
  htmlUrl: z.string().url(),
  jobIds: z.array(z.number().int().positive()).default([]),
});
export type GithubActionsIdentity = z.infer<typeof githubActionsIdentitySchema>;

export const terminalResultSchema = z.object({
  contractVersion: z.literal(TERMINAL_CONTRACT_VERSION),
  requestId: z.string().min(1).max(256),
  lane: terminalLaneSchema,
  state: terminalStateSchema,
  exitCode: z.number().int().optional(),
  summary: z.string().max(4_000),
  events: z.array(terminalEventSchema).max(20_000),
  artifacts: z.array(terminalArtifactSchema).max(500),
  identity: z.union([localTerminalIdentitySchema, githubActionsIdentitySchema]).optional(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  timeout: terminalTimeoutSchema,
  triggeredRules: z.array(z.string().max(120)).max(50).default([]),
});
export type TerminalResult = z.infer<typeof terminalResultSchema>;

export function validateTerminalRequest(input: unknown): TerminalRequest {
  return terminalRequestSchema.parse(input);
}

export function validateTerminalResult(input: unknown): TerminalResult {
  return terminalResultSchema.parse(input);
}
