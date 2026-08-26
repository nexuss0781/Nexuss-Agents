import { describe, expect, it } from "vitest";
import { assertCapabilityInvocation, getCapabilityContract, listCapabilityContracts } from "./capabilityRegistry";

describe("Phase 8 tool and harness capability contracts", () => {
  it("registers the real harnesses and the complete filesystem action surface", () => {
    const contracts = listCapabilityContracts();
    expect(contracts.some((contract) => contract.id === "repository_inspection")).toBe(true);
    const filesystem = getCapabilityContract("filesystem.operations");
    expect(filesystem?.operations).toHaveLength(39);
    expect(filesystem?.operations.map((operation) => operation.id)).toContain("grep_batch");
    expect(filesystem?.operations.map((operation) => operation.id)).toContain("restore_snapshot");
  });

  it("allows implemented read and bounded write operations through compatible authority", () => {
    expect(assertCapabilityInvocation({ capabilityId: "repository_inspection", operation: "snapshot", actorRole: "repository_architect", authority: "verification_only" })).toMatchObject({ allowed: true, action: "inspect", sideEffect: "read_only" });
    expect(assertCapabilityInvocation({ capabilityId: "repository_change", operation: "write_files", actorRole: "repository_builder", authority: "execution_only" })).toMatchObject({ allowed: true, action: "write", requiresVerification: true });
  });

  it("rejects unavailable contract-only harnesses and unauthorized destructive operations", () => {
    expect(() => assertCapabilityInvocation({ capabilityId: "research", operation: "search", actorRole: "researcher", authority: "execution_only" })).toThrow(/not implemented/);
    expect(() => assertCapabilityInvocation({ capabilityId: "filesystem.operations", operation: "delete", actorRole: "quality_gate", authority: "verification_only" })).toThrow(/authority denied/);
  });

  it("requires confirmation for high-impact capability operations", () => {
    expect(() => assertCapabilityInvocation({ capabilityId: "filesystem.operations", operation: "delete", actorRole: "principal", authority: "mission_owner" })).toThrow(/confirmation/);
    expect(assertCapabilityInvocation({ capabilityId: "filesystem.operations", operation: "delete", actorRole: "principal", authority: "mission_owner", confirmed: true })).toMatchObject({ allowed: true, requiresConfirmation: true });
  });
});
