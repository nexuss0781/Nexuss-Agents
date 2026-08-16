import { describe, expect, it } from "vitest";

async function resolveGateway(): Promise<string> {
  const response = await fetch("https://paradox-domain.onrender.com/active-domain.json");
  if (!response.ok) throw new Error(`Gateway resolver returned ${response.status}`);
  const payload = (await response.json()) as { gatewayUrl?: string };
  const gateway = payload.gatewayUrl;
  if (!gateway) throw new Error("Gateway resolver did not return gatewayUrl");
  return gateway.endsWith("/v1") ? gateway : `${gateway.replace(/\/$/, "")}/v1`;
}

describe("Paradox-DB connection", () => {
  it("accepts the configured API key for the authenticated health endpoint", async () => {
    const apiKey = process.env.PARADOX_API_KEY;
    expect(apiKey, "PARADOX_API_KEY must be configured").toBeTruthy();

    const gateway = await resolveGateway();
    const response = await fetch(`${gateway}/auth/me`, {
      headers: { "X-API-Key": apiKey! },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { email?: string };
    expect(body.email).toBeTruthy();
  }, 30_000);
});
