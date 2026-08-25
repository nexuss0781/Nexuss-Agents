import { createHash, randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import { parse as parseCookie } from "cookie";
import { getNexussSession } from "./nexussAuth";
import { withWorkspaceDb } from "./paradoxWorkspace";

const STATE_COOKIE = "nexuss_github_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1_000;
const GITHUB_API_VERSION = "2026-03-10";
const REQUIRED_SCOPE = "repo";

type GithubOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };
export type GithubRepository = { id: number; name: string; fullName: string; description: string | null; private: boolean; htmlUrl: string; defaultBranch: string };

export class GithubOAuthError extends Error {
  readonly code: "NOT_CONFIGURED" | "INVALID_CALLBACK" | "OAUTH_FAILED" | "NOT_CONNECTED" | "GITHUB_API_FAILED";
  constructor(message: string, code: GithubOAuthError["code"] = "OAUTH_FAILED") {
    super(message);
    this.name = "GithubOAuthError";
    this.code = code;
  }
}

function config(environment: NodeJS.ProcessEnv = process.env, redirectOverride?: string): GithubOAuthConfig {
  const clientId = environment.GITHUB_CLIENT_ID?.trim();
  const clientSecret = environment.GITHUB_SECRET?.trim();
  const redirectUri = redirectOverride || environment.GITHUB_OAUTH_REDIRECT_URI?.trim() || `${environment.APP_ORIGIN?.trim() || ""}/auth/github/callback`;
  if (!clientId || !clientSecret || !redirectUri.startsWith("https://")) throw new GithubOAuthError("GitHub authorization is not configured on the server.", "NOT_CONFIGURED");
  return { clientId, clientSecret, redirectUri };
}

function cookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: STATE_TTL_MS };
}

function base64Url(value: Buffer) { return value.toString("base64url"); }
function createVerifier() { return base64Url(randomBytes(32)); }
function createChallenge(verifier: string) { return base64Url(createHash("sha256").update(verifier).digest()); }

export function githubOAuthConfig(environment: NodeJS.ProcessEnv = process.env) {
  const clientId = environment.GITHUB_CLIENT_ID?.trim() || null;
  const clientSecretConfigured = Boolean(environment.GITHUB_SECRET?.trim());
  const redirectUri = environment.GITHUB_OAUTH_REDIRECT_URI?.trim() || (environment.APP_ORIGIN?.trim() ? `${environment.APP_ORIGIN.trim()}/auth/github/callback` : null);
  return { configured: Boolean(clientId && clientSecretConfigured), redirectUri };
}

function requestRedirectUri(req: Request) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0]?.trim();
  const protocol = forwardedProto === "https" || req.protocol === "https" ? "https" : "http";
  const host = req.get("host")?.trim();
  if (!host || protocol !== "https") throw new GithubOAuthError("GitHub authorization requires the HTTPS Render URL.", "NOT_CONFIGURED");
  return `${protocol}://${host}/auth/github/callback`;
}

function readState(req: Request) {
  const value = parseCookie(req.headers.cookie || "")[STATE_COOKIE];
  if (!value) throw new GithubOAuthError("GitHub authorization expired. Start again.", "INVALID_CALLBACK");
  const [state, verifier, ownerId, issuedAt] = value.split(".");
  if (!state || !verifier || !ownerId || !issuedAt || !Number.isFinite(Number(issuedAt)) || Date.now() - Number(issuedAt) > STATE_TTL_MS) throw new GithubOAuthError("GitHub authorization expired. Start again.", "INVALID_CALLBACK");
  return { state, verifier, ownerId };
}

async function exchangeCode(code: string, verifier: string, oauth: GithubOAuthConfig, requester: typeof fetch = fetch) {
  const response = await requester("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: oauth.clientId, client_secret: oauth.clientSecret, code, redirect_uri: oauth.redirectUri, code_verifier: verifier }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; scope?: string; error?: string };
  if (!response.ok || !body.access_token) throw new GithubOAuthError("GitHub authorization could not be completed.", "OAUTH_FAILED");
  return body;
}

async function githubRequest<T>(token: string, path: string, requester: typeof fetch = fetch): Promise<T> {
  const response = await requester(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": GITHUB_API_VERSION, "User-Agent": "Nexuss-Agent" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new GithubOAuthError("GitHub could not confirm that authorization.", "GITHUB_API_FAILED");
  return await response.json() as T;
}

async function saveConnection(ownerId: string, token: { access_token: string; refresh_token?: string; expires_in?: number; scope?: string }, user: { id: number; login: string }) {
  const now = new Date();
  const expiresAt = token.expires_in ? new Date(now.getTime() + token.expires_in * 1_000).toISOString() : null;
  await withWorkspaceDb(true, (db) => {
    db.execute("INSERT INTO workspace_github_connections (owner_id, github_user_id, github_login, access_token, refresh_token, expires_at, scopes_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET github_user_id = excluded.github_user_id, github_login = excluded.github_login, access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, scopes_json = excluded.scopes_json, updated_at = excluded.updated_at", [ownerId, String(user.id), user.login, token.access_token, token.refresh_token || null, expiresAt, JSON.stringify((token.scope || "").split(/[,\s]+/).filter(Boolean)), now.toISOString()]);
  });
}

async function connection(ownerId: string) {
  return withWorkspaceDb(false, (db) => {
    const result = db.execute("SELECT github_login, access_token, expires_at, scopes_json FROM workspace_github_connections WHERE owner_id = ? LIMIT 1", [ownerId]);
    const row = result.rows[0] as { github_login: string; access_token: string; expires_at: string | null; scopes_json: string } | undefined;
    if (!row) throw new GithubOAuthError("Connect GitHub before choosing a repository.", "NOT_CONNECTED");
    return row;
  });
}

export async function githubConnectionStatus(ownerId: string): Promise<{ configured: boolean; connected: boolean; login?: string }> {
  const settings = githubOAuthConfig();
  if (!settings.configured) return { configured: false, connected: false };
  return withWorkspaceDb(false, (db) => {
    const result = db.execute("SELECT github_login, expires_at FROM workspace_github_connections WHERE owner_id = ? LIMIT 1", [ownerId]);
    const row = result.rows[0] as { github_login: string; expires_at: string | null } | undefined;
    if (!row || (row.expires_at && new Date(row.expires_at).getTime() <= Date.now())) return { configured: true, connected: false };
    return { configured: true, connected: true, login: row.github_login };
  });
}

export async function listGithubRepositories(ownerId: string, requester: typeof fetch = fetch): Promise<{ connected: true; login: string; repositories: GithubRepository[] }> {
  const stored = await connection(ownerId);
  if (stored.expires_at && new Date(stored.expires_at).getTime() <= Date.now()) throw new GithubOAuthError("Your GitHub authorization expired. Connect GitHub again.", "NOT_CONNECTED");
  const repositories = await githubRequest<Array<{ id: number; name: string; full_name: string; description: string | null; private: boolean; html_url: string; default_branch: string }>>(stored.access_token, "/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&sort=updated&direction=desc&per_page=100", requester);
  return { connected: true, login: stored.github_login, repositories: repositories.map((repo) => ({ id: repo.id, name: repo.name, fullName: repo.full_name, description: repo.description, private: repo.private, htmlUrl: repo.html_url, defaultBranch: repo.default_branch })) };
}

export async function cloneAuthorizedGithubProject(ownerId: string, projectId: string, fullName: string, clone: (ownerId: string, projectId: string, url: string, token: string) => Promise<unknown>) {
  const stored = await connection(ownerId);
  if (stored.expires_at && new Date(stored.expires_at).getTime() <= Date.now()) throw new GithubOAuthError("Your GitHub authorization expired. Connect GitHub again.", "NOT_CONNECTED");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) throw new GithubOAuthError("Choose a valid GitHub repository.", "OAUTH_FAILED");
  return clone(ownerId, projectId, `https://github.com/${fullName}.git`, stored.access_token);
}

export function registerGithubAuthRoutes(app: Express) {
  app.get("/auth/github/connect", async (req: Request, res: Response) => {
    const user = await getNexussSession(req);
    if (!user?.id) { res.redirect("/login?error=github_sign_in_required"); return; }
    try {
      const oauth = config(process.env, requestRedirectUri(req));
      const state = base64Url(randomBytes(24));
      const verifier = createVerifier();
      const payload = `${state}.${verifier}.${base64Url(Buffer.from(user.id))}.${Date.now()}`;
      res.cookie(STATE_COOKIE, payload, cookieOptions());
      const url = new URL("https://github.com/login/oauth/authorize");
      url.searchParams.set("client_id", oauth.clientId);
      url.searchParams.set("redirect_uri", oauth.redirectUri);
      url.searchParams.set("scope", REQUIRED_SCOPE);
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", createChallenge(verifier));
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("prompt", "select_account");
      res.redirect(url.toString());
    } catch (error) {
      console.error("[GitHub OAuth] start failed", { error: error instanceof Error ? error.message : String(error) });
      res.redirect("/app?github_error=not_configured");
    }
  });

  app.get("/auth/github/callback", async (req: Request, res: Response) => {
    try {
      const oauth = config(process.env, requestRedirectUri(req));
      const pending = readState(req);
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const code = typeof req.query.code === "string" ? req.query.code : "";
      if (!state || state !== pending.state || !code) throw new GithubOAuthError("GitHub authorization was not verified. Start again.", "INVALID_CALLBACK");
      const currentUser = await getNexussSession(req);
      if (!currentUser?.id || currentUser.id !== Buffer.from(pending.ownerId, "base64url").toString("utf8")) throw new GithubOAuthError("Your sign-in session changed. Start again.", "INVALID_CALLBACK");
      const token = await exchangeCode(code, pending.verifier, oauth);
      const githubUser = await githubRequest<{ id: number; login: string }>(token.access_token!, "/user");
      await saveConnection(currentUser.id, token as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string }, githubUser);
      res.clearCookie(STATE_COOKIE, { ...cookieOptions(), maxAge: -1 });
      res.redirect("/app?github_connected=1");
    } catch (error) {
      const code = error instanceof GithubOAuthError ? error.code.toLowerCase() : "oauth_failed";
      console.error("[GitHub OAuth] callback failed", { code });
      res.redirect(`/app?github_error=${encodeURIComponent(code)}`);
    }
  });
}

export function githubRequiredScope() { return REQUIRED_SCOPE; }
