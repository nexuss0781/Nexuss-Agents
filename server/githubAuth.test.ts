import { describe, expect, it } from "vitest";
import { githubOAuthConfig, githubRequiredScope } from "./githubAuth";

describe("GitHub OAuth configuration", () => {
  it("recognizes the Render GitHub variables without exposing their values", () => {
    expect(githubOAuthConfig({ GITHUB_CLIENT_ID: "client-id", GITHUB_SECRET: "client-secret", APP_ORIGIN: "https://nexuss-agent.onrender.com" })).toEqual({
      configured: true,
      redirectUri: "https://nexuss-agent.onrender.com/auth/github/callback",
    });
  });

  it("allows an explicit HTTPS callback override", () => {
    expect(githubOAuthConfig({ GITHUB_CLIENT_ID: "client-id", GITHUB_SECRET: "client-secret", GITHUB_OAUTH_REDIRECT_URI: "https://example.com/auth/github/callback" })).toEqual({
      configured: true,
      redirectUri: "https://example.com/auth/github/callback",
    });
  });

  it("does not report OAuth as configured when a credential is missing", () => {
    expect(githubOAuthConfig({ GITHUB_CLIENT_ID: "client-id" }).configured).toBe(false);
    expect(githubOAuthConfig({ GITHUB_SECRET: "client-secret" }).configured).toBe(false);
  });

  it("uses the repository scope required by the OAuth app flow", () => {
    expect(githubRequiredScope()).toBe("repo");
  });
});
