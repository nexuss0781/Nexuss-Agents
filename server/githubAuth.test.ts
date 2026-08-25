import { describe, expect, it } from "vitest";
import { githubOAuthConfig, githubRequiredScope } from "./githubAuth";

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

  it("uses the repository scope required by the OAuth app flow", () => {
    expect(githubRequiredScope()).toBe("repo");
  });
});
