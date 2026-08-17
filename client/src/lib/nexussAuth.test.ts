import { describe, expect, it } from "vitest";
import { getGoogleSignInUrl, NEXUSS_AUTH_PUBLIC_CONFIG } from "./nexussAuth";

describe("Nexuss Auth Google entry", () => {
  it("builds a Google OAuth URL for the exact registered Nexuss-Agent callback", () => {
    const url = new URL(getGoogleSignInUrl());

    expect(url.origin).toBe(NEXUSS_AUTH_PUBLIC_CONFIG.authUrl);
    expect(url.pathname).toBe("/oauth/start/google");
    expect(url.searchParams.get("project_id")).toBe("nexuss-agent");
    expect(url.searchParams.get("redirect_uri")).toBe("https://nexuss-agents.onrender.com/auth/callback");
  });
});
