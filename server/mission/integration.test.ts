import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMissionFromIntake, queueMission } = vi.hoisted(() => ({ createMissionFromIntake: vi.fn(), queueMission: vi.fn() }));

vi.mock("./intake", () => ({ createMissionFromIntake }));
vi.mock("./commands", () => ({ queueMission }));

import { launchMissionFromConversation } from "./integration";

describe("Phase 14 unified mission lifecycle", () => {
  beforeEach(() => {
    createMissionFromIntake.mockReset();
    queueMission.mockReset();
  });

  it("returns natural clarification without queueing a mission", async () => {
    createMissionFromIntake.mockResolvedValue({
      intake: { id: "intake-1" },
      mission: null,
      decision: "needs_clarification",
      issues: [{ code: "MATERIAL_AMBIGUITY", summary: "Define the desired outcome", sourceIds: [], severity: "blocking" }],
    });

    const result = await launchMissionFromConversation("owner-1", { sources: [{ kind: "raw_prompt", text: "Fix it" }] });

    expect(result).toMatchObject({ status: "needs_clarification", decision: "needs_clarification", mission: null, assistantMessage: "I need a little more detail before I start. Define the desired outcome" });
    expect(queueMission).not.toHaveBeenCalled();
  });

  it("creates and queues a ready mission as one lifecycle handoff", async () => {
    createMissionFromIntake.mockResolvedValue({ intake: { id: "intake-2" }, mission: { mission: { id: "mission-2" } }, decision: "ready_for_planning", issues: [] });
    queueMission.mockResolvedValue({ mission: { id: "mission-2", status: "queued" }, workItems: [] });

    const result = await launchMissionFromConversation("owner-1", { projectId: "project-1", model: "model-1", sources: [{ kind: "raw_prompt", text: "Implement the release workflow" }] });

    expect(createMissionFromIntake).toHaveBeenCalledWith("owner-1", expect.objectContaining({ projectId: "project-1", model: "model-1" }));
    expect(queueMission).toHaveBeenCalledWith("owner-1", "mission-2");
    expect(result).toMatchObject({ status: "started", decision: "ready_for_planning", mission: { mission: { id: "mission-2", status: "queued" } } });
  });

  it.each([
    ["research", "Research the primary sources and compare the competing approaches."],
    ["engineering", "Implement the repository change and run the verification suite."],
    ["mathematics", "Prove the convergence claim under the stated assumptions."],
    ["mixed", "Research the design, implement the prototype, and verify the mathematical invariant."],
  ])("forwards the %s representative flow through the same launch boundary", async (_domain, prompt) => {
    createMissionFromIntake.mockResolvedValue({ intake: { id: `intake-${_domain}` }, mission: { mission: { id: `mission-${_domain}` } }, decision: "ready_with_assumptions", issues: [] });
    queueMission.mockResolvedValue({ mission: { id: `mission-${_domain}`, status: "queued" }, workItems: [] });

    const result = await launchMissionFromConversation("owner-1", { sources: [{ kind: "raw_prompt", text: prompt }] });

    expect(createMissionFromIntake).toHaveBeenCalledWith("owner-1", expect.objectContaining({ sources: [{ kind: "raw_prompt", text: prompt }] }));
    expect(queueMission).toHaveBeenCalledWith("owner-1", `mission-${_domain}`);
    expect(result.status).toBe("started");
  });
});
