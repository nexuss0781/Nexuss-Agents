import { afterEach, describe, expect, it } from "vitest";
import { parsePublicGithubUrl, projectWorkspaceConfig, projectWorkspacePath, ProjectWorkspaceError } from "./projectWorkspace";

describe("project workspace boundaries", () => {
  const previousRoot = process.env.NEXUSS_PROJECTS_ROOT;
  afterEach(() => {
    if (previousRoot === undefined) delete process.env.NEXUSS_PROJECTS_ROOT;
    else process.env.NEXUSS_PROJECTS_ROOT = previousRoot;
  });

  it("normalizes only public HTTPS GitHub repository URLs", () => {
    expect(parsePublicGithubUrl("https://github.com/acme/example")).toMatchObject({
      normalizedUrl: "https://github.com/acme/example.git",
      owner: "acme",
      repo: "example",
    });
    expect(parsePublicGithubUrl("https://github.com/acme/example.git").normalizedUrl).toBe("https://github.com/acme/example.git");
  });

  it.each([
    "git@github.com:acme/example.git",
    "https://gitlab.com/acme/example",
    "http://github.com/acme/example",
    "https://github.com/acme/example?token=secret",
    "https://github.com/acme/example/issues",
    "https://github.com/acme/example/../../escape",
  ])("rejects unsafe GitHub URL %s", (value) => {
    expect(() => parsePublicGithubUrl(value)).toThrow(ProjectWorkspaceError);
  });

  it("assigns different owner/project roots under the configured storage root", () => {
    process.env.NEXUSS_PROJECTS_ROOT = "/var/lib/nexuss-projects";
    const first = projectWorkspacePath("owner-a", "project-a");
    const second = projectWorkspacePath("owner-b", "project-a");
    expect(first).toMatch(/^\/var\/lib\/nexuss-projects\/[a-f0-9]{48}\/[a-f0-9]{48}$/);
    expect(second).toMatch(/^\/var\/lib\/nexuss-projects\/[a-f0-9]{48}\/[a-f0-9]{48}$/);
    expect(first).not.toBe(second);
  });

  it("reports the local fallback only outside production", () => {
    expect(projectWorkspaceConfig({ NODE_ENV: "test" }).configured).toBe(false);
    expect(projectWorkspaceConfig({ NODE_ENV: "test" }).root).toContain("Projects");
    expect(projectWorkspaceConfig({ NODE_ENV: "production" }).configured).toBe(false);
  });
});
