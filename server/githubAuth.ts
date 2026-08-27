import { loadGithubGrant } from "./paradoxWorkspace";

type CentralAuthConfig = { authUrl: string; projectId: string; redirectUri: string };
export type GithubRepository = { id: number; name: string; fullName: string; description: string | null; private: boolean; htmlUrl: string; defaultBranch: string };
export type GithubBranch = { name: string; protected: boolean };
type RawGithubRepository = Record<string, unknown>;

function normalizeGithubRepository(value: unknown, index: number): GithubRepository | null {
  if (!value || typeof value !== "object") return null;
  const repository = value as RawGithubRepository;
  const owner = repository.owner && typeof repository.owner === "object" ? (repository.owner as RawGithubRepository) : undefined;
  const rawFullName = typeof repository.fullName === "string" ? repository.fullName : typeof repository.full_name === "string" ? repository.full_name : "";
  const rawName = typeof repository.name === "string" ? repository.name : "";
  const ownerLogin = owner && typeof owner.login === "string" ? owner.login : "";
  const fullName = (rawFullName || (ownerLogin && rawName ? `${ownerLogin}/${rawName}` : "")).trim().replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) return null;
  const name = rawName.trim() || fullName.split("/")[1] || fullName;
  const rawId = typeof repository.id === "number" ? repository.id : Number(repository.id);
  const htmlUrl = typeof repository.htmlUrl === "string" ? repository.htmlUrl : typeof repository.html_url === "string" ? repository.html_url : `https://github.com/${fullName}`;
  const defaultBranch = typeof repository.defaultBranch === "string" ? repository.defaultBranch : typeof repository.default_branch === "string" ? repository.default_branch : "main";
  return { id: Number.isFinite(rawId) ? rawId : index + 1, name, fullName, description: typeof repository.description === "string" ? repository.description : null, private: repository.private === true, htmlUrl, defaultBranch: defaultBranch || "main" };
}

export function normalizeGithubRepositories(value: unknown): GithubRepository[] {
  if (!Array.isArray(value)) return [];
  return value.map((repository, index) => normalizeGithubRepository(repository, index)).filter((repository): repository is GithubRepository => Boolean(repository)).slice(0, 100);
}
export type GithubTreeEntry = { path: string; type: "blob" | "tree"; sha: string; size: number | null };
export type GithubTree = { owner: string; repo: string; ref: string; sha: string | null; truncated: boolean; tree: GithubTreeEntry[] };
export type GithubFile = { owner: string; repo: string; ref: string; path: string; name: string; sha: string | null; size: number; content: string; htmlUrl: string | null };
export type GithubSearchResult = { path: string; name: string; sha: string; htmlUrl: string | null; score: number | null };
export type GithubSearchResponse = { owner: string; repo: string; query: string; totalCount: number; incompleteResults: boolean; results: GithubSearchResult[] };
export type GithubPull = { number: number; title: string; state: "open" | "closed"; draft: boolean; author: string; htmlUrl: string | null; createdAt: string | null; updatedAt: string | null; headRef: string | null; headSha: string | null; baseRef: string | null };
export type GithubPullFile = { filename: string; status: string; additions: number; deletions: number; changes: number; patch: string | null; sha: string | null; blobUrl: string | null; rawUrl: string | null };
export type GithubPullsResponse = { owner: string; repo: string; state: "open" | "closed"; pulls: GithubPull[] };
export type GithubPullFilesResponse = { owner: string; repo: string; number: number; files: GithubPullFile[] };
export type GithubCommentResponse = { owner: string; repo: string; number: number; id: number | null; htmlUrl: string | null; body: string; createdAt: string | null };
export type GithubWorkflowRun = { id: number; name: string; title: string; status: string; conclusion: string | null; event: string; htmlUrl: string | null; createdAt: string | null; updatedAt: string | null; startedAt: string | null; branch: string | null; sha: string | null; runNumber: number | null; workflowId: number | null };
export type GithubWorkflowJob = { id: number; name: string; status: string; conclusion: string | null; startedAt: string | null; completedAt: string | null; htmlUrl: string | null; steps: Array<{ name: string; status: string; conclusion: string | null; number: number | null }> };
export type GithubWorkflowRunsResponse = { owner: string; repo: string; runs: GithubWorkflowRun[] };
export type GithubWorkflowJobsResponse = { owner: string; repo: string; runId: number; jobs: GithubWorkflowJob[] };
export type GithubWorkflowLogsResponse = { owner: string; repo: string; jobId: number; logs: string; truncated: boolean };
export type GithubAnalyticsResponse = { owner: string; repo: string; repository: { stars: number; forks: number; openIssues: number; language: string | null; pushedAt: string | null }; commits: Array<{ sha: string | null; message: string; author: string; avatarUrl: string | null; date: string | null }>; pulls: Array<{ number: number; state: string; merged: boolean; draft: boolean }>; contributors: Array<{ login: string; contributions: number; avatarUrl: string | null }>; workflow: { total: number; successful: number; completed: number; successRate: number | null } };

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

async function centralGithubRequest<T>(ownerId: string, path: string, init: RequestInit = {}, requester: typeof fetch = fetch): Promise<T> {
  const settings = centralConfig();
  if (!settings) throw new GithubOAuthError("Connect Nexuss Auth before authorizing GitHub.", "NOT_CONFIGURED");
  const grant = await loadGithubGrant(ownerId);
  if (!grant?.grantToken) throw new GithubOAuthError("Connect GitHub before choosing a repository.", "NOT_CONNECTED");
  const url = new URL(path, settings.authUrl);
  url.searchParams.set("project_id", settings.projectId);
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${grant.grantToken}`);
  const response = await requester(url, { ...init, headers });
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
  const result = await centralGithubRequest<{ login: string; repositories: unknown }>(ownerId, "/v1/github/repositories");
  return { connected: true, login: result.login, repositories: normalizeGithubRepositories(result.repositories) };
}

export async function listGithubBranches(ownerId: string, fullName: string): Promise<{ owner: string; repo: string; branches: GithubBranch[] }> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) throw new GithubOAuthError("Choose a valid GitHub repository.");
  const [owner, repo] = fullName.split("/");
  const result = await centralGithubRequest<{ owner: string; repo: string; branches: GithubBranch[] }>(ownerId, `/v1/github/branches?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`);
  return { ...result, branches: Array.isArray(result.branches) ? result.branches.filter((branch) => typeof branch?.name === "string").slice(0, 100) : [] };
}

export async function getGithubAnalytics(ownerId: string, fullName: string): Promise<GithubAnalyticsResponse> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) throw new GithubOAuthError("Choose a valid GitHub repository.");
  const [owner, repo] = fullName.split("/"); return centralGithubRequest<GithubAnalyticsResponse>(ownerId, `/v1/github/analytics?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`);
}

export async function listGithubWorkflowRuns(ownerId: string, fullName: string): Promise<GithubWorkflowRunsResponse> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) throw new GithubOAuthError("Choose a valid GitHub repository.");
  const [owner, repo] = fullName.split("/"); const result = await centralGithubRequest<GithubWorkflowRunsResponse>(ownerId, `/v1/github/runs?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`); return { ...result, runs: Array.isArray(result.runs) ? result.runs.slice(0, 30) : [] };
}

export type GithubWorkflow = { id: number; name: string; path: string; state: string; htmlUrl: string | null; updatedAt: string | null };
export type GithubWorkflowDispatch = { owner: string; repo: string; workflowId: string; ref: string; workflowRunId?: number; runUrl?: string; htmlUrl?: string };
export type GithubWorkflowArtifact = { id: number; name: string; sizeBytes: number; archiveDownloadUrl: string | null; expired: boolean; createdAt: string | null; expiresAt: string | null; digest: string | null };

function githubRepositoryReference(fullName: string) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) throw new GithubOAuthError("Choose a valid GitHub repository.");
  return fullName.split("/");
}

export async function listGithubWorkflows(ownerId: string, fullName: string): Promise<{ owner: string; repo: string; workflows: GithubWorkflow[] }> {
  const [owner, repo] = githubRepositoryReference(fullName);
  const result = await centralGithubRequest<{ owner: string; repo: string; workflows: GithubWorkflow[] }>(ownerId, `/v1/github/workflows?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`);
  return { ...result, workflows: Array.isArray(result.workflows) ? result.workflows.slice(0, 100) : [] };
}

export async function dispatchGithubWorkflow(ownerId: string, input: { fullName: string; workflowId: string; ref: string; inputs: Record<string, string> }): Promise<GithubWorkflowDispatch> {
  const [owner, repo] = githubRepositoryReference(input.fullName);
  if (!/^(\d+|[A-Za-z0-9._\/-]+\.ya?ml)$/.test(input.workflowId) || !/^[^\u0000-\u001f]{1,256}$/.test(input.ref) || Object.keys(input.inputs).length > 25) throw new GithubOAuthError("Choose a valid workflow, ref, and inputs.");
  return centralGithubRequest<GithubWorkflowDispatch>(ownerId, "/v1/github/dispatch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, repo, workflowId: input.workflowId, ref: input.ref, inputs: input.inputs }) });
}

export async function getGithubWorkflowRun(ownerId: string, fullName: string, runId: number) {
  const [owner, repo] = githubRepositoryReference(fullName);
  if (!Number.isInteger(runId) || runId < 1) throw new GithubOAuthError("Choose a valid workflow run.");
  const result = await centralGithubRequest<{ owner: string; repo: string; run: Record<string, unknown> }>(ownerId, `/v1/github/run?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&run_id=${runId}`);
  return result.run;
}

export async function cancelGithubWorkflowRun(ownerId: string, fullName: string, runId: number) {
  const [owner, repo] = githubRepositoryReference(fullName);
  if (!Number.isInteger(runId) || runId < 1) throw new GithubOAuthError("Choose a valid workflow run.");
  return centralGithubRequest<{ cancelled: true; owner: string; repo: string; runId: number }>(ownerId, "/v1/github/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, repo, runId }) });
}

export async function listGithubWorkflowArtifacts(ownerId: string, fullName: string, runId: number): Promise<{ owner: string; repo: string; runId: number; artifacts: GithubWorkflowArtifact[] }> {
  const [owner, repo] = githubRepositoryReference(fullName);
  if (!Number.isInteger(runId) || runId < 1) throw new GithubOAuthError("Choose a valid workflow run.");
  const result = await centralGithubRequest<{ owner: string; repo: string; runId: number; artifacts: GithubWorkflowArtifact[] }>(ownerId, `/v1/github/artifacts?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&run_id=${runId}`);
  return { ...result, artifacts: Array.isArray(result.artifacts) ? result.artifacts.slice(0, 100) : [] };
}

export async function listGithubWorkflowJobs(ownerId: string, fullName: string, runId: number): Promise<GithubWorkflowJobsResponse> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName) || !Number.isInteger(runId) || runId < 1) throw new GithubOAuthError("Choose a valid workflow run.");
  const [owner, repo] = fullName.split("/"); const result = await centralGithubRequest<GithubWorkflowJobsResponse>(ownerId, `/v1/github/jobs?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&run_id=${runId}`); return { ...result, jobs: Array.isArray(result.jobs) ? result.jobs.slice(0, 100) : [] };
}

export async function getGithubWorkflowLogs(ownerId: string, fullName: string, jobId: number): Promise<GithubWorkflowLogsResponse> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName) || !Number.isInteger(jobId) || jobId < 1) throw new GithubOAuthError("Choose a valid workflow job.");
  const [owner, repo] = fullName.split("/"); return centralGithubRequest<GithubWorkflowLogsResponse>(ownerId, `/v1/github/job-logs?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&job_id=${jobId}`);
}

export async function listGithubPulls(ownerId: string, fullName: string, state: "open" | "closed" = "open"): Promise<GithubPullsResponse> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) throw new GithubOAuthError("Choose a valid GitHub repository.");
  const [owner, repo] = fullName.split("/"); const params = new URLSearchParams({ owner, repo, state });
  const result = await centralGithubRequest<GithubPullsResponse>(ownerId, `/v1/github/pulls?${params.toString()}`);
  return { ...result, pulls: Array.isArray(result.pulls) ? result.pulls.slice(0, 50) : [] };
}

export async function getGithubPullFiles(ownerId: string, fullName: string, number: number): Promise<GithubPullFilesResponse> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName) || !Number.isInteger(number) || number < 1) throw new GithubOAuthError("Choose a valid pull request.");
  const [owner, repo] = fullName.split("/"); const params = new URLSearchParams({ owner, repo, number: String(number) });
  const result = await centralGithubRequest<GithubPullFilesResponse>(ownerId, `/v1/github/pull-files?${params.toString()}`);
  return { ...result, files: Array.isArray(result.files) ? result.files.slice(0, 100) : [] };
}

export async function postGithubPullComment(ownerId: string, fullName: string, number: number, body: string): Promise<GithubCommentResponse> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName) || !Number.isInteger(number) || number < 1 || !body.trim() || body.length > 10_000) throw new GithubOAuthError("Enter a valid review comment.");
  const [owner, repo] = fullName.split("/"); const params = new URLSearchParams({ owner, repo, number: String(number) });
  return centralGithubRequest<GithubCommentResponse>(ownerId, `/v1/github/comment?${params.toString()}`, { method: "POST", body: JSON.stringify({ body: body.trim() }), headers: { "content-type": "application/json" } });
}

export async function searchGithubCode(ownerId: string, fullName: string, query: string): Promise<GithubSearchResponse> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) throw new GithubOAuthError("Choose a valid GitHub repository.");
  if (!query.trim() || query.length > 200) throw new GithubOAuthError("Enter a shorter code search.");
  const [owner, repo] = fullName.split("/");
  const params = new URLSearchParams({ owner, repo, q: query.trim().slice(0, 200) });
  const result = await centralGithubRequest<GithubSearchResponse>(ownerId, `/v1/github/search?${params.toString()}`);
  return { ...result, results: Array.isArray(result.results) ? result.results.slice(0, 50) : [] };
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

export async function getGithubCloneToken(ownerId: string): Promise<string> {
  const result = await centralGithubRequest<{ accessToken: string }>(ownerId, "/v1/github/clone-token");
  if (!result.accessToken) throw new GithubOAuthError("Central Nexuss Auth did not return a GitHub clone authorization.", "GITHUB_API_FAILED");
  return result.accessToken;
}

export async function cloneAuthorizedGithubProject(ownerId: string, projectId: string, fullName: string, branch: string | undefined, clone: (ownerId: string, projectId: string, url: string, token: string, branch?: string) => Promise<unknown>) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) throw new GithubOAuthError("Choose a valid GitHub repository.");
  if (branch && (branch.length > 200 || !/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith("/") || branch.endsWith("/") || branch.includes("..") || branch.includes("@{"))) throw new GithubOAuthError("Choose a valid GitHub branch.");
  const token = await getGithubCloneToken(ownerId);
  return clone(ownerId, projectId, `https://github.com/${fullName}.git`, token, branch);
}

export function githubRequiredScope() { return "repo"; }

export type GithubRepositoryMutation = { id: number; name: string; fullName: string; description: string | null; private: boolean; htmlUrl: string; defaultBranch: string };

function repositoryName(value: string): boolean { return /^[A-Za-z0-9_.-]{1,100}$/.test(value); }
function repositoryReference(value: string): { owner: string; repo: string } {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) throw new GithubOAuthError("Choose a valid GitHub repository.");
  const [owner, repo] = value.split("/"); return { owner, repo };
}
function normalizeRepositoryMutation(value: unknown): GithubRepositoryMutation {
  const normalized = normalizeGithubRepository(value, 0);
  if (!normalized) throw new GithubOAuthError("GitHub returned an invalid repository.", "GITHUB_API_FAILED");
  return normalized;
}

export async function createGithubRepository(ownerId: string, input: { name: string; description?: string; private?: boolean }): Promise<GithubRepositoryMutation> {
  const name = input.name.trim();
  if (!repositoryName(name)) throw new GithubOAuthError("Use a repository name with letters, numbers, dots, dashes, or underscores.");
  const description = (input.description || "").trim().slice(0, 500);
  const result = await centralGithubRequest<unknown>(ownerId, "/v1/github/repositories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description, private: input.private !== false }) });
  return normalizeRepositoryMutation(result);
}

export async function renameGithubRepository(ownerId: string, fullName: string, name: string): Promise<GithubRepositoryMutation> {
  const { owner, repo } = repositoryReference(fullName);
  const nextName = name.trim();
  if (!repositoryName(nextName)) throw new GithubOAuthError("Use a repository name with letters, numbers, dots, dashes, or underscores.");
  const result = await centralGithubRequest<unknown>(ownerId, `/v1/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: nextName }) });
  return normalizeRepositoryMutation(result);
}

export async function deleteGithubRepository(ownerId: string, fullName: string, confirmation: string): Promise<{ deleted: true; fullName: string }> {
  const { owner, repo } = repositoryReference(fullName);
  const expectedCommand = `sudo delete repo ${repo}`;
  if (confirmation.trim() !== expectedCommand) throw new GithubOAuthError(`Type exactly: ${expectedCommand}`);
  return centralGithubRequest<{ deleted: true; fullName: string }>(ownerId, `/v1/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmed: true }) });
}
