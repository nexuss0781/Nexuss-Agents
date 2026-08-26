import { describe, expect, it } from "vitest";
import { githubOAuthConfig, githubRequiredScope, normalizeGithubRepositories } from "./githubAuth";

describe("GitHub OAuth configuration", () => {
  it("recognizes the central Nexuss Auth variables without requiring GitHub secrets in the app", () => {
    expect(githubOAuthConfig({ NEXUSS_AUTH_URL: "https://nexuss-auth.vercel.app", NEXUSS_AUTH_PROJECT_ID: "nexuss-agents", NEXUSS_AUTH_REDIRECT_URI: "https://nexuss-agent.onrender.com/auth/callback" })).toEqual({
      configured: true,
      redirectUri: "https://nexuss-agent.onrender.com/auth/callback",
    });
  });

  it("rejects non-HTTPS central auth configuration", () => {
    expect(githubOAuthConfig({ NEXUSS_AUTH_URL: "http://auth.example.com", NEXUSS_AUTH_PROJECT_ID: "nexuss-agents", NEXUSS_AUTH_REDIRECT_URI: "https://example.com/auth/callback" }).configured).toBe(false);
  });

  it("does not report central auth as configured when a public setting is missing", () => {
    expect(githubOAuthConfig({ NEXUSS_AUTH_PROJECT_ID: "nexuss-agents", NEXUSS_AUTH_REDIRECT_URI: "https://example.com/auth/callback" }).configured).toBe(false);
    expect(githubOAuthConfig({ NEXUSS_AUTH_URL: "https://nexuss-auth.vercel.app", NEXUSS_AUTH_REDIRECT_URI: "https://example.com/auth/callback" }).configured).toBe(false);
  });

  it("normalizes GitHub snake_case repository payloads for the frontend and clone flow", () => {
    expect(normalizeGithubRepositories([{ id: 42, name: "Nexuss-Git", full_name: "nexuss0781/Nexuss-Git", private: false, html_url: "https://github.com/nexuss0781/Nexuss-Git", default_branch: "main", description: "Repository workspace" }])).toEqual([{ id: 42, name: "Nexuss-Git", fullName: "nexuss0781/Nexuss-Git", description: "Repository workspace", private: false, htmlUrl: "https://github.com/nexuss0781/Nexuss-Git", defaultBranch: "main" }]);
  });

  it("drops repository payloads that cannot produce a safe owner/name identifier", () => {
    expect(normalizeGithubRepositories([{ id: 1, name: "missing-owner" }, { id: 2, full_name: "owner/valid-repository", private: true }])).toEqual([{ id: 2, name: "valid-repository", fullName: "owner/valid-repository", description: null, private: true, htmlUrl: "https://github.com/owner/valid-repository", defaultBranch: "main" }]);
  });

  it("uses the repository scope required by the OAuth app flow", () => {
    expect(githubRequiredScope()).toBe("repo");
  });
});
