import { loadGithubGrant } from "./paradoxWorkspace";

type CentralAuthConfig = { authUrl: string; projectId: string; redirectUri: string };
export type GithubRepository = { id: number; name: string; fullName: string; description: string | null; private: boolean; htmlUrl: string; defaultBranch: string };
export type GithubTreeEntry = { path: string; type: "blob" | "tree"; sha: string; size: number | null };
export type GithubTree = { owner: string; repo: string; ref: string; sha: string | null; truncated: boolean; tree: GithubTreeEntry[] };
export type GithubFile = { owner: string; repo: string; ref: string; path: string; name: string; sha: string | null; size: number; content: string; htmlUrl: string | null };

export class GithubOAuthError extends Error {
  readonly code: "NOT_CONFIGURED" | "NOT_CONNECTED" | "OAUTH_FAILED" | "GITHUB_API_FAILED";
  constructor(message: string, code: GithubOAuthError["code"] = "OAUTH_FAILED") { super(message); this.name = "GithubOAuthError"; this.code = code; }
}

function centralConfig(environment: NodeJS.ProcessEnv = process.env): CentralAuthConfig | null {
  const authUrl = environment.NEXUSS_AUTH_URL?.trim();
  const projectId = environment.NEXUSS_AUTH_PROJECT_ID?.trim();
  const redirectUri = environment.NEXUSS_AUTH_REDIRECT_URI?.trim();
  if (!authUrl || !projectId || !redirectUri) return null;
  try {
    if (new URL(authUrl).protocol !== "https:" || new URL(redirectUri).protocol !== "https:") return null;
  } catch { return null; }
  return { authUrl: authUrl.replace(/\/+$/, ""), projectId, redirectUri };
}

export function githubOAuthConfig(environment: NodeJS.ProcessEnv = process.env) {
  const settings = centralConfig(environment);
  return { configured: Boolean(settings), redirectUri: settings?.redirectUri };
}

export function buildCentralGithubAuthorizationUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const settings = centralConfig(environment);
  if (!settings) throw new GithubOAuthError("Central Nexuss Auth is not configured.", "NOT_CONFIGURED");
  const url = new URL("/oauth/start/github", settings.authUrl);
  url.searchParams.set("project_id", settings.projectId);
  url.searchParams.set("redirect_uri", settings.redirectUri);
  url.searchParams.set("handoff", "1");
  url.searchParams.set("purpose", "github_authorization");
  return url.toString();
}

async function centralGithubRequest<T>(ownerId: string, path: string, requester: typeof fetch = fetch): Promise<T> {
  const settings = centralConfig();
  if (!settings) throw new GithubOAuthError("Connect Nexuss Auth before authorizing GitHub.", "NOT_CONFIGURED");
  const grant = await loadGithubGrant(ownerId);
  if (!grant?.grantToken) throw new GithubOAuthError("Connect GitHub before choosing a repository.", "NOT_CONNECTED");
  const url = new URL(path, settings.authUrl);
  url.searchParams.set("project_id", settings.projectId);
  const response = await requester(url, { headers: { accept: "application/json", authorization: `Bearer ${grant.grantToken}` } });
  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) {
    if (response.status === 401) throw new GithubOAuthError("Your GitHub authorization expired. Connect GitHub again.", "NOT_CONNECTED");
    throw new GithubOAuthError(body.error || "Central Nexuss Auth could not access GitHub.", "GITHUB_API_FAILED");
  }
  return body;
}

export async function githubConnectionStatus(ownerId: string): Promise<{ configured: boolean; connected: boolean; login?: string }> {
  if (!centralConfig()) return { configured: false, connected: false };
  const grant = await loadGithubGrant(ownerId);
  if (!grant) return { configured: true, connected: false };
  try {
    const result = await centralGithubRequest<{ login: string; repositories: GithubRepository[] }>(ownerId, "/v1/github/repositories");
    return { configured: true, connected: true, login: result.login || grant.login || undefined };
  } catch { return { configured: true, connected: false }; }
}

export async function listGithubRepositories(ownerId: string): Promise<{ connected: true; login: string; repositories: GithubRepository[] }> {
  const result = await centralGithubRequest<{ login: string; repositories: GithubRepository[] }>(ownerId, "/v1/github/repositories");
  return { connected: true, login: result.login, repositories: Array.isArray(result.repositories) ? result.repositories.slice(0, 100) : [] };
}

export async function getGithubTree(ownerId: string, fullName: string, ref?: string): Promise<GithubTree> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) throw new GithubOAuthError("Choose a valid GitHub repository.");
  const [owner, repo] = fullName.split("/");
  const params = new URLSearchParams({ owner, repo });
  if (ref?.trim()) params.set("ref", ref.trim().slice(0, 200));
  const result = await centralGithubRequest<GithubTree>(ownerId, `/v1/github/tree?${params.toString()}`);
  return { ...result, tree: Array.isArray(result.tree) ? result.tree.slice(0, 5_000) : [] };
}

export async function getGithubFile(ownerId: string, fullName: string, path: string, ref?: string): Promise<GithubFile> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) throw new GithubOAuthError("Choose a valid GitHub repository.");
  if (!path.trim() || path.length > 500 || path.startsWith("/") || path.split("/").some((segment) => !segment || segment === "." || segment === "..")) throw new GithubOAuthError("Choose a valid repository file.");
  const [owner, repo] = fullName.split("/");
  const params = new URLSearchParams({ owner, repo, path });
  if (ref?.trim()) params.set("ref", ref.trim().slice(0, 200));
  return centralGithubRequest<GithubFile>(ownerId, `/v1/github/file?${params.toString()}`);
}

export async function cloneAuthorizedGithubProject(ownerId: string, projectId: string, fullName: string, clone: (ownerId: string, projectId: string, url: string, token: string) => Promise<unknown>) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) throw new GithubOAuthError("Choose a valid GitHub repository.");
  const result = await centralGithubRequest<{ accessToken: string }>(ownerId, "/v1/github/clone-token");
  if (!result.accessToken) throw new GithubOAuthError("Central Nexuss Auth did not return a GitHub clone authorization.", "GITHUB_API_FAILED");
  return clone(ownerId, projectId, `https://github.com/${fullName}.git`, result.accessToken);
}

export function githubRequiredScope() { return "repo"; }
