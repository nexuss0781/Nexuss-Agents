import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAgentContract } from "./agentContracts";
import { dispatchFilesystemHarness } from "./filesystemHarness";

const runtime = vi.hoisted(() => ({
  run: vi.fn(),
  event: vi.fn(),
}));

vi.mock("../fileSystemRuntime", () => ({ runProjectFileSystem: runtime.run }));
vi.mock("./events", () => ({ recordMissionEvent: runtime.event }));

describe("Phase 8 filesystem capability dispatch", () => {
  beforeEach(() => {
    runtime.run.mockReset();
    runtime.event.mockReset();
  });

  it("allows an execution-role write through the registered filesystem operation", async () => {
    runtime.run.mockResolvedValue({ ok: true, action: "write", operationId: "operation-1", path: "src/app.ts", durationMs: 2, data: {} });
    runtime.event.mockResolvedValue(undefined);
    const result = await dispatchFilesystemHarness({ ownerId: "owner-1", projectId: "project-1", contract: getAgentContract("repository_builder"), request: { harness: "filesystem", operation: "write", input: { path: "src/app.ts", content: "export {};" } } });
    expect(result.ok).toBe(true);
    expect(runtime.run).toHaveBeenCalledWith("owner-1", "project-1", expect.objectContaining({ action: "write" }), expect.objectContaining({ canMutate: true }));
  });

  it("rejects a verification-only write before filesystem execution", async () => {
    await expect(dispatchFilesystemHarness({ ownerId: "owner-1", projectId: "project-1", contract: getAgentContract("quality_gate"), request: { harness: "filesystem", operation: "write", input: { path: "src/app.ts", content: "export {};" } } })).rejects.toThrow(/authority denied/);
    expect(runtime.run).not.toHaveBeenCalled();
  });
});
