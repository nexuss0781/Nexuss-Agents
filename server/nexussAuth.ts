import type { Express, Request, Response } from "express";
import { parse as parseCookie } from "cookie";
import { SignJWT, jwtVerify } from "jose";
import { buildCentralGithubAuthorizationUrl } from "./githubAuth";
import { saveGithubGrant } from "./paradoxWorkspace";

export const SESSION_COOKIE = "nexuss_agent_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

type Provider = "google" | "github";

export type NexussAuthUser = {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
};

type AuthFailureCode = "configuration" | "handoff_required" | "invalid_handoff" | "user_not_found" | "handoff_failed";

class NexussAuthFailure extends Error {
  constructor(public readonly code: AuthFailureCode, public readonly status?: number, public readonly missing: string[] = []) {
    super(code);
  }
}

function config() {
  const authUrl = process.env.NEXUSS_AUTH_URL;
  const projectId = process.env.NEXUSS_AUTH_PROJECT_ID;
  const redirectUri = process.env.NEXUSS_AUTH_REDIRECT_URI;

  const missing = [
    !authUrl && "NEXUSS_AUTH_URL",
    !projectId && "NEXUSS_AUTH_PROJECT_ID",
    !redirectUri && "NEXUSS_AUTH_REDIRECT_URI",
  ].filter((name): name is string => Boolean(name));
  if (missing.length > 0) {
    throw new NexussAuthFailure("configuration", undefined, missing);
  }

  return { authUrl: authUrl!.replace(/\/+$/, ""), projectId: projectId!, redirectUri: redirectUri! };
}

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value) throw new NexussAuthFailure("configuration", undefined, ["JWT_SECRET"]);
  return new TextEncoder().encode(value);
}

function assertSignInReady() {
  config();
  secret();
}

function cookieOptions() {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}

function supportedProvider(value: unknown): value is Provider {
  return value === "google" || value === "github";
}

export function buildNexussSignInUrl(provider: Provider) {
  const { authUrl, projectId, redirectUri } = config();
  const url = new URL(`/oauth/start/${provider}`, authUrl);
  url.searchParams.set("project_id", projectId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("handoff", "1");
  return url.toString();
}

async function createSession(user: NexussAuthUser) {
  return new SignJWT({ user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

export async function getNexussSession(req: Request): Promise<NexussAuthUser | null> {
  const token = parseCookie(req.headers.cookie || "")[SESSION_COOKIE];
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret());
    const user = payload.user as NexussAuthUser | undefined;
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

export function clearNexussSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: -1 });
}

async function exchangeHandoff(handoffToken: string) {
  const { authUrl, projectId } = config();
  const response = await fetch(`${authUrl}/v1/handoff/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ projectId, handoffToken }),
  });

  const body = await response.json().catch(() => ({})) as { error?: string; user?: NexussAuthUser; githubGrantToken?: string };
  if (!response.ok) {
    const code: AuthFailureCode = body.error === "handoff_required" || body.error === "invalid_handoff" || body.error === "user_not_found"
      ? body.error
      : "handoff_failed";
    throw new NexussAuthFailure(code, response.status);
  }
  if (!body.user?.id) throw new NexussAuthFailure("handoff_failed", response.status);
  return { user: body.user, githubGrantToken: body.githubGrantToken };
}

export function registerNexussAuthRoutes(app: Express) {
  app.get("/auth/callback", async (req, res) => {
    const handoffToken = typeof req.query.handoff_token === "string" ? req.query.handoff_token : null;
    if (!handoffToken) {
      res.redirect("/login?error=handoff_required");
      return;
    }

    try {
      const handoff = await exchangeHandoff(handoffToken);
      const user = handoff.user;
      if (handoff.githubGrantToken) await saveGithubGrant(user.id, handoff.githubGrantToken, user.name || undefined);
      const session = await createSession(user);
      res.cookie(SESSION_COOKIE, session, cookieOptions());
      res.redirect("/app");
    } catch (error) {
      const failure = error instanceof NexussAuthFailure ? error : new NexussAuthFailure("configuration");
      const missing = failure.missing.join(",");
      console.error(`[Nexuss Auth] Handoff failed: ${failure.code}${failure.status ? ` (${failure.status})` : ""}${missing ? ` [${missing}]` : ""}`);
      const query = new URLSearchParams({ error: failure.code });
      if (missing) query.set("missing", missing);
      res.redirect(`/login?${query.toString()}`);
    }
  });

  app.get("/auth/github/connect", (_req, res) => {
    try {
      res.redirect(buildCentralGithubAuthorizationUrl());
    } catch (error) {
      console.error(`[Nexuss Auth] GitHub authorization is not configured${error instanceof Error ? `: ${error.message}` : ""}`);
      res.redirect("/app?github_error=not_configured");
    }
  });

  app.get("/auth/:provider", (req, res) => {
    if (!supportedProvider(req.params.provider)) {
      res.status(404).end();
      return;
    }

    try {
      assertSignInReady();
      res.redirect(buildNexussSignInUrl(req.params.provider));
    } catch {
      const missing = ["NEXUSS_AUTH_URL", "NEXUSS_AUTH_PROJECT_ID", "NEXUSS_AUTH_REDIRECT_URI", "JWT_SECRET"].filter((name) => !process.env[name]);
      console.error(`[Nexuss Auth] Sign-in is not configured${missing.length ? ` [${missing.join(",")}]` : ""}`);
      const query = new URLSearchParams({ error: "configuration" });
      if (missing.length) query.set("missing", missing.join(","));
      res.redirect(`/login?${query.toString()}`);
    }
  });
}
