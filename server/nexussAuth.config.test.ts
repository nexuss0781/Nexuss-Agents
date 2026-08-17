import { describe, expect, it } from "vitest";

const hasNexussAuthConfiguration = Boolean(
  process.env.NEXUSS_AUTH_URL && process.env.NEXUSS_AUTH_PROJECT_ID && process.env.NEXUSS_AUTH_REDIRECT_URI,
);

describe.runIf(hasNexussAuthConfiguration)("Nexuss Auth configuration", () => {
  it("uses the registered Nexuss-Agent project and reachable auth service", async () => {
    const authUrl = process.env.NEXUSS_AUTH_URL;
    const projectId = process.env.NEXUSS_AUTH_PROJECT_ID;
    const redirectUri = process.env.NEXUSS_AUTH_REDIRECT_URI;

    expect(authUrl).toBe("https://nexuss-auth.vercel.app");
    expect(projectId).toBe("nexuss-agent");
    expect(redirectUri).toBe("https://nexuss-agents.onrender.com/auth/callback");

    const response = await fetch(`${authUrl}/health`);
    expect(response.ok).toBe(true);
  }, 30_000);
});
