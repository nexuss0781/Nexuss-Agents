import { createLearningCandidate, listMissionArtifacts, listLearningCandidates, recordMissionReplay, getMission, type MissionLearningCandidate, type MissionReplay } from "./store";

export async function extractMissionLearningCandidates(ownerId: string, missionId: string): Promise<MissionLearningCandidate[]> {
  const snapshot = await getMission(ownerId, missionId);
  if (!["completed", "failed", "stopped"].includes(snapshot.mission.status)) throw new Error("Learning extraction requires a terminal mission");
  const existing = await listLearningCandidates(ownerId, missionId);
  if (existing.length) return existing;
  const artifacts = await listMissionArtifacts(ownerId, missionId);
  const successful = snapshot.mission.status === "completed";
  const scope = snapshot.mission.contract.projectScope || { missionType: snapshot.mission.missionType };
  const candidates: Array<Parameters<typeof createLearningCandidate>[2]> = [
    { candidateType: "experience", domain: "software_delivery", title: successful ? "Verified repository mission experience" : "Repository mission failure experience", content: { goal: snapshot.mission.goal.slice(0, 2_000), outcome: snapshot.mission.status, artifactCount: artifacts.length, scope, validation: "Use as a candidate only; compare against future mission evidence." }, confidence: successful ? 0.7 : 0.45 },
  ];
  if (successful) {
    candidates.push({ candidateType: "skill", domain: "software_delivery", title: "Bounded repository change procedure candidate", content: { procedure: "inspect → coordinate specialists → implement → security review → quality gate → integrate", evidenceArtifactCount: artifacts.length, dependencies: ["repository_inspection", "repository_change", "repository_verification"], validation: "Replay against an equivalent bounded repository mission before promotion." }, confidence: 0.65 });
    candidates.push({ candidateType: "shortcut", domain: "software_delivery", title: "Repository verification shortcut candidate", content: { workflow: ["pnpm check", "pnpm test", "pnpm build", "git diff --check"], precondition: "repository change is complete", validation: "Replay all checks and require independent evidence." }, confidence: 0.6 });
  }
  const created: MissionLearningCandidate[] = [];
  for (const candidate of candidates) created.push(await createLearningCandidate(ownerId, missionId, candidate));
  return created;
}

export async function recordLearningReplay(ownerId: string, missionId: string, input: { candidateId: string; passed: boolean; evidence: Record<string, unknown> }): Promise<MissionReplay> {
  const candidates = await listLearningCandidates(ownerId, missionId);
  const candidate = candidates.find((item) => item.id === input.candidateId);
  if (!candidate) throw new Error("Learning candidate not found");
  if (candidate.status === "validated" || candidate.status === "rejected") throw new Error("Learning candidate already has a terminal replay outcome");
  return recordMissionReplay(ownerId, missionId, { candidateId: input.candidateId, status: input.passed ? "passed" : "failed", evidence: { ...input.evidence, replayedCandidateType: candidate.candidateType, replayBoundary: "Candidate remains scoped to its source mission until separately promoted." } });
}
