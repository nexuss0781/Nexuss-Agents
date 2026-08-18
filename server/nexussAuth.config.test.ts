import { describe, expect, it } from "vitest";

describe("Nexuss Auth configuration", () => {
  it("reaches the configured authentication service health endpoint", async () => {
    const authUrl = process.env.NEXUSS_AUTH_URL;

    expect(authUrl).toBeTruthy();
    expect(process.env.NEXUSS_AUTH_PROJECT_ID).toBe("nexuss-agent-v2");
    expect(process.env.NEXUSS_AUTH_REDIRECT_URI).toBe("https://nexuss-agent.onrender.com/auth/callback");

    const response = await fetch(`${authUrl}/health`);
    expect(response.ok).toBe(true);
  }, 15_000);
});
