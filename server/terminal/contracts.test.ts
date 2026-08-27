import { describe, expect, it } from "vitest";
import {
  TERMINAL_CONTRACT_VERSION,
  terminalEventSchema,
  terminalRequestSchema,
  terminalResultSchema,
  validateTerminalRequest,
} from "./contracts";

describe("Nexuss Terminal contracts", () => {
  it("validates a local interactive terminal request", () => {
    const request = validateTerminalRequest({
      contractVersion: TERMINAL_CONTRACT_VERSION,
      lane: "local",
      projectId: "project-1",
      workingDirectory: "/workspace/project",
      command: "npm test",
      interactive: true,
      timeout: { timeoutMs: 300_000, idleTimeoutMs: 60_000 },
      label: "Run tests",
    });

    expect(request).toMatchObject({ lane: "local", command: "npm test", interactive: true });
  });

  it("validates a GitHub Actions workflow request with strategy and monitoring rules", () => {
    const request = terminalRequestSchema.parse({
      contractVersion: TERMINAL_CONTRACT_VERSION,
      lane: "github_actions",
      owner: "nexuss0781",
      repository: "Nexuss-Agents",
      workflowId: "train.yml",
      ref: "master",
      inputs: { objective: "Run training", dataset: "sample-v1" },
      strategy: { matrix: { python: ["3.11", "3.12"] }, maxParallel: 2, failFast: true },
      timeout: { timeoutMs: 86_400_000 },
      monitoringRules: [{ id: "heartbeat", kind: "heartbeat_missing", description: "Stop when no heartbeat arrives", windowMs: 600_000, action: "mark_attention" }],
    });

    expect(request).toMatchObject({ lane: "github_actions", workflowId: "train.yml", strategy: { maxParallel: 2 } });
  });

  it("rejects malformed metric and heartbeat rules", () => {
    expect(() => terminalRequestSchema.parse({
      contractVersion: TERMINAL_CONTRACT_VERSION,
      lane: "github_actions",
      owner: "owner",
      repository: "repo",
      workflowId: "build.yml",
      ref: "main",
      inputs: {},
      timeout: { timeoutMs: 30_000 },
      monitoringRules: [{ id: "bad", kind: "metric_threshold", description: "Missing threshold", action: "fail" }],
    })).toThrow();
  });

  it("enforces GitHub dispatch input and matrix limits", () => {
    const inputs = Object.fromEntries(Array.from({ length: 26 }, (_, index) => [`input_${index}`, "value"]));
    expect(() => terminalRequestSchema.parse({
      contractVersion: TERMINAL_CONTRACT_VERSION,
      lane: "github_actions",
      owner: "owner",
      repository: "repo",
      workflowId: "build.yml",
      ref: "main",
      inputs,
      timeout: { timeoutMs: 30_000 },
    })).toThrow();
  });

  it("requires payloads appropriate to ordered terminal events", () => {
    expect(() => terminalEventSchema.parse({ sequence: 0, occurredAt: new Date().toISOString(), kind: "stdout" })).toThrow();
    expect(terminalEventSchema.parse({ sequence: 0, occurredAt: new Date().toISOString(), kind: "stdout", text: "ok" })).toMatchObject({ kind: "stdout", text: "ok" });
    expect(terminalEventSchema.parse({ sequence: 1, occurredAt: new Date().toISOString(), kind: "metric", metric: { name: "loss", value: 0.42 } })).toMatchObject({ kind: "metric" });
  });

  it("validates a durable terminal result with identity, events, and artifacts", () => {
    const now = new Date().toISOString();
    const result = terminalResultSchema.parse({
      contractVersion: TERMINAL_CONTRACT_VERSION,
      requestId: "request-1",
      lane: "github_actions",
      state: "completed",
      exitCode: 0,
      summary: "All workflow jobs completed.",
      events: [{ sequence: 0, occurredAt: now, kind: "status", state: "completed" }],
      artifacts: [{ id: "artifact-1", name: "report.json", kind: "report", producedAt: now }],
      identity: { workflowRunId: 123, runUrl: "https://api.github.com/repos/o/r/actions/runs/123", htmlUrl: "https://github.com/o/r/actions/runs/123", jobIds: [456] },
      startedAt: now,
      completedAt: now,
      timeout: { timeoutMs: 300_000 },
      triggeredRules: [],
    });

    expect(result.identity).toMatchObject({ workflowRunId: 123, jobIds: [456] });
    expect(result.artifacts[0]).toMatchObject({ name: "report.json", kind: "report" });
  });
});
