import { describe, expect, it } from "vitest";
import { loadWorkspace } from "./paradoxWorkspace";

describe("Paradox-DB credentials", () => {
  it("authenticates the protected server API key against the configured gateway", async () => {
    const gatewayUrl = process.env.PARADOX_GATEWAY_URL;
    const apiKey = process.env.PARADOX_API_KEY;

    expect(gatewayUrl).toMatch(/^https:\/\/.+\/v1$/);
    expect(apiKey).toMatch(/^pk_/);

    const response = await fetch(`${gatewayUrl}/auth/me`, {
      headers: { "X-API-Key": apiKey! },
      signal: AbortSignal.timeout(25_000),
    });

    expect(response.ok).toBe(true);
    const user = await response.json() as { email?: string };
    expect(user.email).toBe("nexussagent@gmail.com");

    await expect(loadWorkspace(`credential-check-${Date.now()}`)).resolves.toEqual({ projects: [], threads: [] });
  }, 30_000);
});
