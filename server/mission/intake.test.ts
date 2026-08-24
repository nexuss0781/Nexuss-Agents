import { beforeEach, describe, expect, it, vi } from "vitest";

const streamWorkspaceModel = vi.hoisted(() => vi.fn());
const getAttachment = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({ createMissionIntake: vi.fn(), getMissionIntake: vi.fn(), createMission: vi.fn() }));

vi.mock("../paradoxWorkspace", () => ({ streamWorkspaceModel }));
vi.mock("../attachments", () => ({ getAttachment }));
vi.mock("./store", () => store);

import { createMissionFromIntake, runMissionIntake } from "./intake";

beforeEach(() => {
  streamWorkspaceModel.mockReset();
  getAttachment.mockReset();
  store.createMissionIntake.mockReset();
  store.getMissionIntake.mockReset();
  store.createMission.mockReset();
  store.createMissionIntake.mockImplementation(async (ownerId: string, input: Record<string, unknown>) => ({ id: "intake-1", ownerId, ...input, createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z" }));
  store.createMission.mockResolvedValue({ mission: { id: "mission-1", goal: "Implement recovery" }, workItems: [], events: [] });
  getAttachment.mockResolvedValue({ id: "attachment-1", ownerId: "owner-1", name: "requirements.weird", mimeType: "application/x-custom", size: 42, contentHash: "a".repeat(64), storageKey: "nexuss/owner-1/attachments/attachment-1", storageUrl: "/manus-storage/nexuss/owner-1/attachments/attachment-1", sourceKind: "specification", createdAt: "2026-08-24T00:00:00.000Z" });
});

describe("Mission Intake Engine", () => {
  it("normalizes raw prompt and plan text deterministically with source traceability", async () => {
    const result = await runMissionIntake("owner-1", { sources: [
      { kind: "raw_prompt", text: "Add durable mission recovery to the server runtime.\n\nThe server must resume eligible missions after restart." },
      { kind: "plan_text", name: "recovery-plan.md", text: "Deliverables:\n- Startup recovery scan\n- Lease cleanup\n\nDo not build the frontend yet." },
    ] });

    expect(result.decision).toBe("ready_with_assumptions");
    expect(result.brief.objective).toContain("Add durable mission recovery");
    expect(result.brief.deliverables.length).toBeGreaterThan(0);
    expect(result.brief.requiredSkills).toContain("repository_inspection");
    expect(result.brief.sourceReferences[0]).toMatch(/^source-1-raw_prompt:[a-f0-9]{64}$/);
    expect(result.intake.status).toBe("ready_with_assumptions");
    expect(store.createMissionIntake).toHaveBeenCalledWith("owner-1", expect.objectContaining({ sources: expect.arrayContaining([expect.objectContaining({ name: "recovery-plan.md", contentHash: expect.any(String) })]) }));
  });

  it("marks a materially vague prompt as needing clarification", async () => {
    const result = await runMissionIntake("owner-1", { sources: [{ kind: "raw_prompt", text: "Fix it" }] });
    expect(result.decision).toBe("needs_clarification");
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MATERIAL_AMBIGUITY", severity: "blocking" })]));
  });

  it("resolves uploaded attachment references into traceable intake sources", async () => {
    const result = await runMissionIntake("owner-1", { sources: [{ kind: "raw_prompt", text: "Use the attached requirements to implement the requested change." }, { kind: "specification", attachmentId: "attachment-1", name: "requirements.weird", mimeType: "application/x-custom" }] });
    expect(getAttachment).toHaveBeenCalledWith("owner-1", "attachment-1");
    expect(result.intake.sources[1]).toMatchObject({ attachmentId: "attachment-1", name: "requirements.weird", mimeType: "application/x-custom", contentHash: "a".repeat(64), storageKey: expect.stringContaining("attachments") });
    expect(result.sourceReferences[1]).toBe(`source-2-specification:${"a".repeat(64)}`);
  });

  it("uses a validated structured model brief when available", async () => {
    streamWorkspaceModel.mockResolvedValue({ finished: true, stopped: false, content: JSON.stringify({ objective: "Implement the recovery worker", deliverables: ["Recovery worker"], acceptanceCriteria: [{ id: "tests", description: "Recovery tests pass", verification: "automated", required: true, sourceId: "source-1-raw_prompt" }], constraints: ["Keep the UI unchanged"], requiredSkills: ["repository_inspection"], domains: ["software_delivery"] }) });
    const result = await runMissionIntake("owner-1", { model: "model-1", sources: [{ kind: "raw_prompt", text: "Implement the recovery worker and keep the UI unchanged." }] });
    expect(result.brief.objective).toBe("Implement the recovery worker");
    expect(result.intake.brief).toMatchObject({ normalizationSource: "model" });
    expect(streamWorkspaceModel).toHaveBeenCalledWith("owner-1", expect.objectContaining({ model: "model-1", messages: expect.arrayContaining([expect.objectContaining({ role: "system" })]) }), expect.any(AbortSignal));
  });

  it("falls back safely when model normalization fails and creates a mission only for a ready decision", async () => {
    streamWorkspaceModel.mockRejectedValue(new Error("provider unavailable"));
    const result = await createMissionFromIntake("owner-1", { model: "model-1", sources: [{ kind: "raw_prompt", text: "Implement a bounded repository change and run tests." }] });
    expect(result.intake.status).toMatch(/ready/);
    expect(store.createMission).toHaveBeenCalledWith("owner-1", expect.objectContaining({ goal: expect.stringContaining("Implement a bounded repository change"), contract: expect.objectContaining({ intakeId: "intake-1", model: "model-1", sourceReferences: expect.any(Array) }) }));
  });
});
