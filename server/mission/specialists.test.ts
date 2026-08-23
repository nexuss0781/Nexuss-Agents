import { describe, expect, it } from "vitest";
import { getSpecialist, specialistForRole } from "./specialists";

describe("specialist registry", () => {
  it("keeps builders writable while architecture and quality agents remain read-only", () => {
    expect(getSpecialist("repository_builder")).toMatchObject({ canWriteRepository: true, canSpawnSpecialists: false });
    expect(getSpecialist("repository_architect")).toMatchObject({ canWriteRepository: false, canRunVerification: true });
    expect(getSpecialist("quality_gate")).toMatchObject({ canWriteRepository: false, canRunVerification: true });
  });

  it("maps work-item roles to explicit specialist kinds", () => {
    expect(specialistForRole("architect").kind).toBe("repository_architect");
    expect(specialistForRole("builder").kind).toBe("repository_builder");
    expect(specialistForRole("quality").kind).toBe("quality_gate");
    expect(specialistForRole("security_auditor").kind).toBe("security_auditor");
  });
});
