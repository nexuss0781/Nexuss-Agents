import { useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  Check,
  ChevronDown,
  Files,
  FolderTree,
  GitBranch,
  GitPullRequest,
  Github,
  History,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
  Command,
} from "lucide-react";
import type { RightWindowApi } from "@/lib/rightWindowExtensions";
import { trpc } from "@/lib/trpc";

type GitTab = "overview" | "files" | "changes" | "branches" | "activity";
type GithubRepository = { id: number; name: string; fullName: string; description: string | null; private: boolean; htmlUrl: string; defaultBranch: string };
type EmptyActionProps = { icon: ReactNode; title: string; detail: string; action?: string; onAction?: () => void };

const tabs: Array<{ id: GitTab; label: string; icon: typeof Activity; count?: number }> = [
  { id: "overview", label: "Overview", icon: Github },
  { id: "files", label: "Files", icon: FolderTree },
  { id: "changes", label: "Changes", icon: Files, count: 0 },
  { id: "branches", label: "Branches", icon: GitBranch },
  { id: "activity", label: "Activity", icon: Activity },
];

function EmptyAction({ icon, title, detail, action, onAction }: EmptyActionProps) {
  return <div className="nexuss-git-empty"><span className="nexuss-git-empty-icon">{icon}</span><strong>{title}</strong><p>{detail}</p>{action ? <button type="button" className="nexuss-git-quiet-button" onClick={onAction}>{action}</button> : null}</div>;
}

function StatCard({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "copper" | "green" }) {
  return <div className={`nexuss-git-stat nexuss-git-stat-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function formatRepositoryCount(value: number) {
  return `${value} ${value === 1 ? "repository" : "repositories"}`;
}

export default function NexussGitApp({ api }: { api: RightWindowApi }) {
  const [activeTab, setActiveTab] = useState<GitTab>("overview");
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const [repositorySearch, setRepositorySearch] = useState("");
  const [selectedRepository, setSelectedRepository] = useState<GithubRepository | null>(null);
  const [command, setCommand] = useState("");
  const [commandNotice, setCommandNotice] = useState("");

  const githubStatusQuery = trpc.workspace.github.status.useQuery(undefined, { retry: false, staleTime: 30_000 });
  const githubRepositoriesQuery = trpc.workspace.github.repositories.useQuery(undefined, { enabled: githubStatusQuery.data?.connected === true, retry: false, staleTime: 30_000 });
  const repositories = (githubRepositoriesQuery.data?.repositories || []) as GithubRepository[];
  const filteredRepositories = repositories.filter((repository) => `${repository.fullName} ${repository.description || ""}`.toLowerCase().includes(repositorySearch.trim().toLowerCase()));

  function connectGithub() {
    window.location.assign("/auth/github/connect");
  }

  function chooseRepository(repository: GithubRepository) {
    setSelectedRepository(repository);
    setRepositoryOpen(false);
    setRepositorySearch("");
  }

  function submitCommand(event: FormEvent) {
    event.preventDefault();
    if (!command.trim()) return;
    setCommandNotice(selectedRepository ? "Git actions will be available in the next workspace layer." : "Choose a repository before running this action.");
  }

  const connectionLabel = githubStatusQuery.isLoading ? "Checking connection…" : githubStatusQuery.data?.connected ? `Connected as ${githubStatusQuery.data.login || "GitHub user"}` : "Not connected";
  const repositoryDetail = selectedRepository ? `${selectedRepository.private ? "Private" : "Public"} · ${selectedRepository.defaultBranch}` : githubStatusQuery.data?.connected ? `${formatRepositoryCount(repositories.length)} available` : "Connect GitHub to begin";

  return <section className="nexuss-git-app" aria-label="Nexuss-Git workspace">
    <div className="nexuss-git-toolbar"><div className="nexuss-git-identity"><span className="nexuss-git-app-mark"><Github size={16} strokeWidth={1.8} /></span><div><strong>Nexuss-Git</strong><small>Repository workspace</small></div></div><div className="nexuss-git-toolbar-actions"><button type="button" className="nexuss-git-icon-button" title="Refresh repository" aria-label="Refresh repository" onClick={() => { void githubStatusQuery.refetch(); void githubRepositoriesQuery.refetch(); }}><RefreshCw size={14} /></button><button type="button" className="nexuss-git-icon-button" title="GitHub settings" aria-label="GitHub settings" onClick={connectGithub}><Settings2 size={14} /></button></div></div>

    <div className="nexuss-git-repository-picker"><button type="button" className="nexuss-git-repository-button" onClick={() => setRepositoryOpen((open) => !open)} aria-expanded={repositoryOpen}><span className="nexuss-git-repo-avatar"><Github size={15} /></span><span className="nexuss-git-repo-copy"><small>Repository</small><strong>{selectedRepository?.fullName || "Select a repository"}</strong></span><ChevronDown size={14} className={repositoryOpen ? "nexuss-git-chevron-open" : ""} /></button><span className={`nexuss-git-connection-status ${githubStatusQuery.data?.connected ? "is-connected" : ""}`}><span /> {selectedRepository ? repositoryDetail : connectionLabel}</span>{repositoryOpen ? <div className="nexuss-git-repository-menu"><div className="nexuss-git-repository-search"><Search size={13} /><input value={repositorySearch} onChange={(event) => setRepositorySearch(event.target.value)} placeholder="Filter repositories" aria-label="Filter repositories" autoFocus /></div>{!githubStatusQuery.data?.connected ? <button type="button" onClick={connectGithub}><Github size={14} /> Connect GitHub account</button> : githubRepositoriesQuery.isLoading ? <div className="nexuss-git-menu-status"><RefreshCw size={13} className="nexuss-git-spin" /> Loading repositories…</div> : githubRepositoriesQuery.isError ? <div className="nexuss-git-menu-status nexuss-git-menu-error"><X size={13} /> Repositories could not be loaded.<button type="button" onClick={() => void githubRepositoriesQuery.refetch()}>Retry</button></div> : filteredRepositories.length ? filteredRepositories.map((repository) => <button type="button" key={repository.id} className="nexuss-git-repository-option" onClick={() => chooseRepository(repository)}><span className="nexuss-git-repository-option-mark"><Github size={13} /></span><span><strong>{repository.fullName}</strong><small>{repository.private ? "Private" : "Public"} · {repository.defaultBranch}</small></span>{selectedRepository?.id === repository.id ? <Check size={14} /> : null}</button>) : <div className="nexuss-git-menu-status">No repositories match this search.</div>}</div> : null}</div>

    <nav className="nexuss-git-tabs" aria-label="GitHub sections">{tabs.map((tab) => { const Icon = tab.icon; return <button key={tab.id} type="button" className={activeTab === tab.id ? "is-active" : ""} onClick={() => setActiveTab(tab.id)}><Icon size={14} /><span>{tab.label}</span>{tab.count !== undefined ? <em>{selectedRepository ? 0 : tab.count}</em> : null}</button>; })}</nav>

    <div className="nexuss-git-content">
      {activeTab === "overview" ? <>{selectedRepository ? <div className="nexuss-git-selected-repository"><div className="nexuss-git-selected-repo-heading"><span className="nexuss-git-repo-avatar"><Github size={17} /></span><div><span className="nexuss-git-eyebrow">Selected repository</span><h2>{selectedRepository.fullName}</h2><p>{selectedRepository.description || "No repository description provided."}</p></div></div><a href={selectedRepository.htmlUrl} target="_blank" rel="noreferrer noopener" className="nexuss-git-external-link">Open on GitHub <ArrowUpFromLine size={13} /></a></div> : <div className="nexuss-git-hero"><div><span className="nexuss-git-eyebrow"><Sparkles size={12} /> Workspace overview</span><h2>{githubStatusQuery.data?.connected ? "Choose a repository to begin." : "Bring your repository into focus."}</h2><p>{githubStatusQuery.data?.connected ? "Your GitHub repositories are ready. Select one above to open its workspace." : "Connect GitHub to browse code, manage branches, review changes, and ship work without command-line overhead."}</p></div><button type="button" className="nexuss-git-connect-button" onClick={githubStatusQuery.data?.connected ? () => setRepositoryOpen(true) : connectGithub}>{githubStatusQuery.data?.connected ? <Search size={15} /> : <Github size={15} />} {githubStatusQuery.data?.connected ? "Choose repository" : "Connect GitHub"}</button></div>}
        <div className="nexuss-git-stat-grid"><StatCard label="Branch" value={selectedRepository?.defaultBranch || "—"} detail={selectedRepository ? "Default branch" : "No repository selected"} tone="copper" /><StatCard label="Sync" value={selectedRepository ? "Ready" : "—"} detail={selectedRepository ? "Repository data loaded" : "Waiting for connection"} /><StatCard label="Changes" value="0" detail={selectedRepository ? "No local changes yet" : "Workspace is clear"} tone="green" /></div>
        <div className="nexuss-git-section-heading"><div><span className="nexuss-git-eyebrow">Quick actions</span><h3>Repository workflow</h3></div><button type="button" className="nexuss-git-text-button" onClick={() => api.setWidth(Math.min(560, window.innerWidth - 280))}>Widen workspace <ArrowUpFromLine size={13} /></button></div>
        <div className="nexuss-git-action-grid"><button type="button" onClick={() => setActiveTab("files")}><FolderTree size={16} /><span>Browse files</span><small>Inspect the repository tree</small></button><button type="button" onClick={() => setActiveTab("branches")}><GitBranch size={16} /><span>Create branch</span><small>Start isolated work</small></button><button type="button" onClick={() => setActiveTab("changes")}><GitPullRequest size={16} /><span>Open pull request</span><small>Review changes before merge</small></button><button type="button" onClick={() => setActiveTab("activity")}><History size={16} /><span>View activity</span><small>Follow repository events</small></button></div>
        <div className="nexuss-git-trust-note"><ShieldCheck size={15} /><span>Actions stay reviewable. Publishing changes will always require an explicit confirmation.</span></div>
      </> : null}
      {activeTab === "files" ? <EmptyAction icon={<FolderTree size={20} />} title={selectedRepository ? "File browser is ready" : "No repository selected"} detail={selectedRepository ? `The ${selectedRepository.name} file tree will load in the next workspace layer.` : "Choose a GitHub repository to browse its files and search its code."} action={selectedRepository ? undefined : "Choose repository"} onAction={() => setRepositoryOpen(true)} /> : null}
      {activeTab === "changes" ? <EmptyAction icon={<Files size={20} />} title={selectedRepository ? "No changes to review" : "No repository selected"} detail={selectedRepository ? "Connect the repository workspace to inspect its working tree diff." : "Connect a repository and the working tree diff will appear here."} action={selectedRepository ? undefined : "Choose repository"} onAction={() => setRepositoryOpen(true)} /> : null}
      {activeTab === "branches" ? <EmptyAction icon={<GitBranch size={20} />} title={selectedRepository ? "Branches are ready to load" : "Branches appear here"} detail={selectedRepository ? `Inspect and compare branches for ${selectedRepository.name}.` : "Select a repository to inspect, compare, and create branches."} action={selectedRepository ? undefined : "Choose repository"} onAction={() => setRepositoryOpen(true)} /> : null}
      {activeTab === "activity" ? <EmptyAction icon={<Activity size={20} />} title={selectedRepository ? "Activity is quiet" : "Activity is quiet"} detail={selectedRepository ? "Repository commits, pull requests, issues, and workflow events will appear here." : "Select a repository to view its commits, pull requests, issues, and workflow events."} action={selectedRepository ? undefined : "Choose repository"} onAction={() => setRepositoryOpen(true)} /> : null}
    </div>

    <form className="nexuss-git-command-bar" onSubmit={submitCommand}><Command size={15} /><input value={command} onChange={(event) => { setCommand(event.target.value); setCommandNotice(""); }} placeholder="Ask GitHub to inspect this repository…" aria-label="Ask GitHub" /><button type="submit" aria-label="Run GitHub request" title="Run request"><ArrowDownToLine size={15} /></button>{commandNotice ? <small>{commandNotice}</small> : null}</form>
    <div className="nexuss-git-footer"><span><Bell size={12} /> {selectedRepository ? `Connected · ${selectedRepository.private ? "Private" : "Public"}` : connectionLabel}</span><span><UploadCloud size={12} /> Changes stay local until you publish</span></div>
  </section>;
}
