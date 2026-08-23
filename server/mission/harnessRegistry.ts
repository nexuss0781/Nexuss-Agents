export type HarnessId = "mission_runtime" | "repository_inspection" | "repository_change" | "repository_verification" | "specialist_spawn" | "research" | "browser" | "webdev" | "terminal";
export type HarnessStatus = "implemented" | "contract_only";
export type HarnessRequest = { harness: HarnessId; operation: string; input: Record<string, unknown>; timeoutMs?: number; signal?: AbortSignal };
export type HarnessResult = { ok: boolean; status: "completed" | "failed" | "cancelled" | "timed_out"; summary: string; artifacts: string[]; evidence: Record<string, unknown>; sideEffects: string[]; retryable: boolean };
export type HarnessDescriptor = { id: HarnessId; version: string; title: string; status: HarnessStatus; operations: readonly string[]; maxTimeoutMs: number; sideEffect: "none" | "bounded_repository_write" | "external_read" | "external_write"; secretBoundary: string; };

const harnesses: Record<HarnessId, HarnessDescriptor> = {
  mission_runtime: { id: "mission_runtime", version: "1.0.0", title: "Mission Runtime", status: "implemented", operations: ["create", "transition", "checkpoint", "event", "lease"], maxTimeoutMs: 30_000, sideEffect: "none", secretBoundary: "Never return credentials or private session material." },
  repository_inspection: { id: "repository_inspection", version: "1.0.0", title: "Repository Inspection Harness", status: "implemented", operations: ["snapshot", "read_file", "git_status", "git_diff", "git_ls_files"], maxTimeoutMs: 120_000, sideEffect: "none", secretBoundary: "Never read restricted secret files." },
  repository_change: { id: "repository_change", version: "1.0.0", title: "Repository Change Harness", status: "implemented", operations: ["write_files"], maxTimeoutMs: 120_000, sideEffect: "bounded_repository_write", secretBoundary: "Never write credentials, hidden control messages, or restricted paths." },
  repository_verification: { id: "repository_verification", version: "1.0.0", title: "Repository Verification Harness", status: "implemented", operations: ["run_check", "run_test", "run_build", "git_diff_check"], maxTimeoutMs: 120_000, sideEffect: "none", secretBoundary: "Bound output and do not echo credentials." },
  specialist_spawn: { id: "specialist_spawn", version: "1.0.0", title: "Specialist Spawn Harness", status: "implemented", operations: ["spawn_registered_specialist"], maxTimeoutMs: 600_000, sideEffect: "none", secretBoundary: "Child prompts and events must be redacted and owner-scoped." },
  research: { id: "research", version: "1.0.0", title: "Research Harness", status: "contract_only", operations: ["search", "extract", "cite"], maxTimeoutMs: 120_000, sideEffect: "external_read", secretBoundary: "Do not disclose private credentials to sources." },
  browser: { id: "browser", version: "1.0.0", title: "Browser Harness", status: "contract_only", operations: ["navigate", "observe", "interact", "capture"], maxTimeoutMs: 120_000, sideEffect: "external_read", secretBoundary: "Require explicit authorization for sensitive interactions." },
  webdev: { id: "webdev", version: "1.0.0", title: "WebDev Harness", status: "contract_only", operations: ["build", "preview", "publish"], maxTimeoutMs: 900_000, sideEffect: "external_write", secretBoundary: "Never expose deployment credentials or publish without mission policy." },
  terminal: { id: "terminal", version: "1.0.0", title: "Terminal Harness", status: "contract_only", operations: ["bounded_command"], maxTimeoutMs: 120_000, sideEffect: "bounded_repository_write", secretBoundary: "No unrestricted shell, credential access, or destructive commands." },
};

export function getHarness(id: HarnessId) { return harnesses[id]; }
export function listHarnesses() { return Object.values(harnesses); }
export function isHarnessImplemented(id: HarnessId) { return harnesses[id].status === "implemented"; }

export function assertHarnessRequest(request: HarnessRequest) {
  const descriptor = harnesses[request.harness];
  if (!descriptor.operations.includes(request.operation)) throw new Error(`Harness operation is not allowlisted: ${request.harness}/${request.operation}`);
  if (request.timeoutMs !== undefined && (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > descriptor.maxTimeoutMs)) throw new Error(`Harness timeout exceeds policy: ${request.harness}`);
  return descriptor;
}
