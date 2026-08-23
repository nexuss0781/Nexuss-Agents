export type SpecialistKind = "repository_architect" | "repository_builder" | "quality_gate" | "security_auditor" | "integrator" | "sub_orchestrator";

export type SpecialistDescriptor = {
  kind: SpecialistKind;
  title: string;
  canWriteRepository: boolean;
  canRunVerification: boolean;
  canSpawnSpecialists: boolean;
  maxConcurrent: number;
  systemInstruction: string;
};

const registry: Record<SpecialistKind, SpecialistDescriptor> = {
  repository_architect: { kind: "repository_architect", title: "Repository Architect", canWriteRepository: false, canRunVerification: true, canSpawnSpecialists: false, maxConcurrent: 4, systemInstruction: "Inspect the repository and reason about structure, dependencies, risks, and implementation seams. Do not edit files." },
  repository_builder: { kind: "repository_builder", title: "Repository Builder", canWriteRepository: true, canRunVerification: true, canSpawnSpecialists: false, maxConcurrent: 1, systemInstruction: "Implement the smallest cohesive repository change within the supplied scope. Preserve existing behavior and use only the bounded harness." },
  quality_gate: { kind: "quality_gate", title: "Independent Quality Agent", canWriteRepository: false, canRunVerification: true, canSpawnSpecialists: false, maxConcurrent: 1, systemInstruction: "Independently verify the result. Never modify the repository and never waive a required quality gate." },
  security_auditor: { kind: "security_auditor", title: "Security Auditor", canWriteRepository: false, canRunVerification: true, canSpawnSpecialists: false, maxConcurrent: 2, systemInstruction: "Inspect for secret exposure, unsafe paths, command injection, authorization gaps, and policy violations. Do not edit files." },
  integrator: { kind: "integrator", title: "Integrator", canWriteRepository: false, canRunVerification: true, canSpawnSpecialists: false, maxConcurrent: 1, systemInstruction: "Reconcile completed specialist outputs and report the final repository state. Do not modify files or bypass quality evidence." },
  sub_orchestrator: { kind: "sub_orchestrator", title: "Specialist Sub-Orchestrator", canWriteRepository: false, canRunVerification: false, canSpawnSpecialists: true, maxConcurrent: 1, systemInstruction: "Decompose bounded work into specialist work items with explicit scopes, dependencies, and verification responsibilities." },
};

export function getSpecialist(kind: SpecialistKind): SpecialistDescriptor { return registry[kind]; }

export function specialistForRole(role: string): SpecialistDescriptor {
  if (role === "architect") return registry.repository_architect;
  if (role === "builder" || role === "environment_operator") return registry.repository_builder;
  if (role === "quality") return registry.quality_gate;
  if (role === "integrator") return registry.integrator;
  if (role === "security_auditor") return registry.security_auditor;
  if (role === "sub_orchestrator") return registry.sub_orchestrator;
  return registry.repository_builder;
}
