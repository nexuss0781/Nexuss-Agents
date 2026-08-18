import type { Express, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildNexussSignInUrl, clearNexussSession, getNexussSession, registerNexussAuthRoutes, SESSION_COOKIE } from "./nexussAuth";

const originalEnv = {
  authUrl: process.env.NEXUSS_AUTH_URL,
  projectId: process.env.NEXUSS_AUTH_PROJECT_ID,
  redirectUri: process.env.NEXUSS_AUTH_REDIRECT_URI,
  jwtSecret: process.env.JWT_SECRET,
};

afterEach(() => {
  process.env.NEXUSS_AUTH_URL = originalEnv.authUrl;
  process.env.NEXUSS_AUTH_PROJECT_ID = originalEnv.projectId;
  process.env.NEXUSS_AUTH_REDIRECT_URI = originalEnv.redirectUri;
  process.env.JWT_SECRET = originalEnv.jwtSecret;
  vi.unstubAllGlobals();
});

function configureAuthEnv() {
  process.env.NEXUSS_AUTH_URL = "https://nexuss-auth.vercel.app";
  process.env.NEXUSS_AUTH_PROJECT_ID = "nexuss-agent-v2";
  process.env.NEXUSS_AUTH_REDIRECT_URI = "https://nexuss-agent.onrender.com/auth/callback";
  process.env.JWT_SECRET = "test-session-secret";
}

function callbackHandler() {
  const routes = new Map<string, (req: Request, res: Response) => unknown>();
  const app = { get: (path: string, handler: (req: Request, res: Response) => unknown) => routes.set(path, handler) } as unknown as Express;
  registerNexussAuthRoutes(app);
  return routes.get("/auth/callback")!;
}

describe("Nexuss Auth OAuth start", () => {
  it("builds a Google browser-navigation URL with the configured project, callback, and handoff", () => {
    configureAuthEnv();

    const url = new URL(buildNexussSignInUrl("google"));

    expect(url.pathname).toBe("/oauth/start/google");
    expect(url.searchParams.get("project_id")).toBe("nexuss-agent-v2");
    expect(url.searchParams.get("redirect_uri")).toBe("https://nexuss-agent.onrender.com/auth/callback");
    expect(url.searchParams.get("handoff")).toBe("1");
  });

  it("exchanges a handoff once, creates an HTTP-only app session, and redirects to the workspace", async () => {
    configureAuthEnv();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ user: { id: "user-1", email: "person@example.com", name: "Person", avatarUrl: null } }), { status: 200 })));
    const cookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
    const redirects: string[] = [];
    const res = { cookie: (name: string, value: string, options: Record<string, unknown>) => cookies.push({ name, value, options }), redirect: (value: string) => redirects.push(value) } as unknown as Response;

    await callbackHandler()({ query: { handoff_token: "one-time-token" } } as Request, res);

    expect(redirects).toEqual(["/app"]);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]?.name).toBe(SESSION_COOKIE);
    expect(cookies[0]?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    const user = await getNexussSession({ headers: { cookie: `${SESSION_COOKIE}=${cookies[0]?.value}` } } as Request);
    expect(user).toMatchObject({ id: "user-1", email: "person@example.com" });
  });

  it("rejects an invalid handoff without creating an application session", async () => {
    configureAuthEnv();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    const cookies: unknown[] = [];
    const redirects: string[] = [];
    const res = { cookie: (value: unknown) => cookies.push(value), redirect: (value: string) => redirects.push(value) } as unknown as Response;

    await callbackHandler()({ query: { handoff_token: "invalid-or-replayed" } } as Request, res);

    expect(cookies).toHaveLength(0);
    expect(redirects).toEqual(["/login?error=sign-in"]);
  });

  it("does not establish a second session when a handoff token is replayed", async () => {
    configureAuthEnv();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: "user-2", email: "person@example.com", name: "Person", avatarUrl: null } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 })));
    const firstCookies: unknown[] = [];
    const secondCookies: unknown[] = [];
    const firstRedirects: string[] = [];
    const secondRedirects: string[] = [];
    const handler = callbackHandler();

    await handler({ query: { handoff_token: "single-use-token" } } as Request, { cookie: (value: unknown) => firstCookies.push(value), redirect: (value: string) => firstRedirects.push(value) } as unknown as Response);
    await handler({ query: { handoff_token: "single-use-token" } } as Request, { cookie: (value: unknown) => secondCookies.push(value), redirect: (value: string) => secondRedirects.push(value) } as unknown as Response);

    expect(firstCookies).toHaveLength(1);
    expect(firstRedirects).toEqual(["/app"]);
    expect(secondCookies).toHaveLength(0);
    expect(secondRedirects).toEqual(["/login?error=sign-in"]);
  });

  it("clears the Nexuss-Agent session cookie on logout", () => {
    const cleared: Array<{ name: string; options: Record<string, unknown> }> = [];
    clearNexussSession({ clearCookie: (name: string, options: Record<string, unknown>) => cleared.push({ name, options }) } as unknown as Response);
    expect(cleared).toEqual([{ name: SESSION_COOKIE, options: expect.objectContaining({ maxAge: -1, httpOnly: true, path: "/" }) }]);
  });
});
