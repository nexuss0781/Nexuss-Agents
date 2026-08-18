import type { Express, Request, Response } from "express";
import { parse as parseCookie } from "cookie";
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "nexuss_agent_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

type Provider = "google" | "github";

export type NexussAuthUser = {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
};

function config() {
  const authUrl = process.env.NEXUSS_AUTH_URL;
  const projectId = process.env.NEXUSS_AUTH_PROJECT_ID;
  const redirectUri = process.env.NEXUSS_AUTH_REDIRECT_URI;

  if (!authUrl || !projectId || !redirectUri) {
    throw new Error("Nexuss Auth is not configured");
  }

  return { authUrl: authUrl.replace(/\/+$/, ""), projectId, redirectUri };
}

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("Application session signing is not configured");
  return new TextEncoder().encode(value);
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
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, handoffToken }),
  });

  if (!response.ok) throw new Error(`Nexuss Auth handoff exchange failed: ${response.status}`);
  const body = await response.json() as { user?: NexussAuthUser };
  if (!body.user?.id) throw new Error("Nexuss Auth handoff returned no user");
  return body.user;
}

export function registerNexussAuthRoutes(app: Express) {
  app.get("/auth/callback", async (req, res) => {
    const handoffToken = typeof req.query.handoff_token === "string" ? req.query.handoff_token : null;
    if (!handoffToken) {
      res.redirect("/login?error=sign-in");
      return;
    }

    try {
      const user = await exchangeHandoff(handoffToken);
      const session = await createSession(user);
      res.cookie(SESSION_COOKIE, session, cookieOptions());
      res.redirect("/app");
    } catch {
      console.error("Nexuss Auth handoff exchange failed");
      res.redirect("/login?error=sign-in");
    }
  });

  app.get("/auth/:provider", (req, res) => {
    if (!supportedProvider(req.params.provider)) {
      res.status(404).end();
      return;
    }

    res.redirect(buildNexussSignInUrl(req.params.provider));
  });
}
