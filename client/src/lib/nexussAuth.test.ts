import { describe, expect, it } from "vitest";
import {
  getGitHubSignInUrl,
  getGoogleSignInUrl,
  NEXUSS_AUTH_PUBLIC_CONFIG,
} from "./nexussAuth";

describe("Nexuss Auth provider entry points", () => {
  it.each([
    ["google", getGoogleSignInUrl],
    ["github", getGitHubSignInUrl],
  ])("builds a %s OAuth URL for the exact registered callback", (provider, getUrl) => {
    const url = new URL(getUrl());

    expect(url.origin).toBe(NEXUSS_AUTH_PUBLIC_CONFIG.authUrl);
    expect(url.pathname).toBe(`/oauth/start/${provider}`);
    expect(url.searchParams.get("project_id")).toBe(NEXUSS_AUTH_PUBLIC_CONFIG.projectId);
    expect(url.searchParams.get("redirect_uri")).toBe(NEXUSS_AUTH_PUBLIC_CONFIG.redirectUri);
  });
});
