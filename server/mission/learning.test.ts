import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ getMission: vi.fn(), listMissionArtifacts: vi.fn(), listLearningCandidates: vi.fn(), createLearningCandidate: vi.fn(), recordMissionReplay: vi.fn() }));
vi.mock("./store", () => store);

import { extractMissionLearningCandidates, recordLearningReplay } from "./learning";

beforeEach(() => {
  store.getMission.mockReset();
  store.listMissionArtifacts.mockReset();
  store.listLearningCandidates.mockReset();
  store.createLearningCandidate.mockReset();
  store.recordMissionReplay.mockReset();
  store.listMissionArtifacts.mockResolvedValue([{ id: "artifact-1" }]);
  store.listLearningCandidates.mockResolvedValue([]);
  store.createLearningCandidate.mockImplementation(async (_owner: string, _mission: string, input: Record<string, unknown>) => ({ id: `candidate-${String(input.candidateType)}`, ...input }));
  store.recordMissionReplay.mockResolvedValue({ id: "replay-1", status: "passed" });
});

describe("mission learning boundary", () => {
  it("extracts scoped candidates only after a successful terminal mission", async () => {
    store.getMission.mockResolvedValue({ mission: { status: "completed", goal: "Implement change", missionType: "autonomous_repository_change", contract: { acceptanceCriteria: [], projectScope: { repository: "workspace" } } } });

    const candidates = await extractMissionLearningCandidates("owner-1", "mission-1");

    expect(candidates).toHaveLength(3);
    expect(store.createLearningCandidate).toHaveBeenCalledTimes(3);
    expect(store.createLearningCandidate.mock.calls.map((call) => call[2].candidateType)).toEqual(["experience", "skill", "shortcut"]);
  });

  it("does not extract twice and requires a candidate replay to remain scoped", async () => {
    store.getMission.mockResolvedValue({ mission: { status: "completed", goal: "Implement change", missionType: "autonomous_repository_change", contract: { acceptanceCriteria: [] } } });
    store.listLearningCandidates.mockResolvedValue([{ id: "candidate-1", status: "candidate", candidateType: "experience" }]);
    expect(await extractMissionLearningCandidates("owner-1", "mission-1")).toEqual([{ id: "candidate-1", status: "candidate", candidateType: "experience" }]);
    expect(store.createLearningCandidate).not.toHaveBeenCalled();

    await expect(recordLearningReplay("owner-1", "mission-1", { candidateId: "candidate-1", passed: true, evidence: { replay: "bounded" } })).resolves.toMatchObject({ id: "replay-1", status: "passed" });
    expect(store.recordMissionReplay).toHaveBeenCalledWith("owner-1", "mission-1", expect.objectContaining({ candidateId: "candidate-1", status: "passed", evidence: expect.objectContaining({ replayBoundary: expect.stringContaining("scoped") }) }));

    store.listLearningCandidates.mockResolvedValue([{ id: "candidate-1", status: "validated", candidateType: "experience" }]);
    await expect(recordLearningReplay("owner-1", "mission-1", { candidateId: "candidate-1", passed: true, evidence: {} })).rejects.toThrow(/terminal replay/);
  });

  it("rejects extraction for non-terminal missions", async () => {
    store.getMission.mockResolvedValue({ mission: { status: "executing", goal: "Still working", missionType: "autonomous_repository_change", contract: { acceptanceCriteria: [] } } });
    await expect(extractMissionLearningCandidates("owner-1", "mission-1")).rejects.toThrow(/terminal mission/);
  });
});
