import { Activity, ArrowUpRight, GitCommitHorizontal, GitFork, GitPullRequest, Github, Languages, RefreshCw, Star, Users, Workflow, X } from "lucide-react";
import { trpc } from "@/lib/trpc";

type Repo = { fullName: string; defaultBranch: string };
type Analytics = { repository: { stars: number; forks: number; openIssues: number; language: string | null; pushedAt: string | null }; commits: Array<{ sha: string | null; message: string; author: string; date: string | null }>; pulls: Array<{ number: number; state: string; merged: boolean; draft: boolean }>; contributors: Array<{ login: string; contributions: number }>; workflow: { total: number; successful: number; completed: number; successRate: number | null } };

function formatDate(value: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function Metric({ icon, label, value, detail, tone = "neutral" }: { icon: React.ReactNode; label: string; value: string; detail: string; tone?: "neutral" | "copper" | "green" }) {
  return <div className={`nexuss-git-analytics-metric is-${tone}`}><span className="nexuss-git-analytics-metric-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong><em>{detail}</em></div></div>;
}

export default function NexussGitAnalyticsPanel({ repository }: { repository: Repo | null }) {
  const query = trpc.workspace.github.analytics.useQuery({ fullName: repository?.fullName || "placeholder/repository" }, { enabled: Boolean(repository), retry: false, staleTime: 60_000 });
  if (!repository) return <div className="nexuss-git-analytics-empty"><div><Activity size={18} /></div><span className="nexuss-git-eyebrow">Repository intelligence</span><strong>Choose a repository</strong><p>Commit activity, workflow health, and contributor signals will appear here.</p></div>;
  if (query.isLoading) return <div className="nexuss-git-analytics-placeholder"><RefreshCw size={17} className="nexuss-git-analytics-spin" /><span>Aggregating repository signals…</span></div>;
  if (query.isError) return <div className="nexuss-git-analytics-placeholder is-error"><X size={17} /><span>Analytics could not be loaded.</span><button type="button" onClick={() => void query.refetch()}>Retry</button></div>;
  const data = query.data as Analytics | undefined;
  if (!data) return null;
  const merged = data.pulls.filter((pull) => pull.merged).length;
  const open = data.pulls.filter((pull) => pull.state === "open").length;
  const health = data.workflow.successRate === null ? 0 : Math.max(0, Math.min(100, data.workflow.successRate));
  const healthLabel = data.workflow.successRate === null ? "No signal" : health >= 90 ? "Excellent" : health >= 70 ? "Steady" : "Needs attention";
  const lastPush = data.repository.pushedAt ? formatDate(data.repository.pushedAt) : "Not available";
  return <div className="nexuss-git-analytics-workspace">
    <header className="nexuss-git-analytics-heading"><div><span className="nexuss-git-eyebrow">{data.repository.language || "Repository"} · {repository.fullName}</span><h2>Repository pulse</h2><p>A concise read on delivery health, participation, and recent movement.</p></div><button type="button" className="nexuss-git-icon-button" onClick={() => void query.refetch()} aria-label="Refresh analytics" title="Refresh analytics"><RefreshCw size={13} /></button></header>
    <section className="nexuss-git-analytics-hero">
      <div className="nexuss-git-analytics-health"><div className="nexuss-git-analytics-health-copy"><span className="nexuss-git-eyebrow">Delivery health</span><h3>{healthLabel}</h3><p>{data.workflow.completed ? `${data.workflow.successful} of ${data.workflow.completed} completed workflows passed.` : "Workflow history will appear after the first completed run."}</p><div className="nexuss-git-analytics-health-meta"><span><Workflow size={12} /> {data.workflow.total} total runs</span><span><Activity size={12} /> {repository.defaultBranch}</span></div></div><div className="nexuss-git-analytics-ring" style={{ background: `conic-gradient(#d7b291 ${health}%, rgba(217,229,226,.08) ${health}% 100%)` }}><div><strong>{data.workflow.successRate === null ? "—" : `${data.workflow.successRate}%`}</strong><small>success</small></div></div></div>
      <div className="nexuss-git-analytics-pulse"><span className="nexuss-git-eyebrow">Repository pulse</span><div className="nexuss-git-analytics-pulse-row"><span>Last pushed</span><strong>{lastPush}</strong></div><div className="nexuss-git-analytics-pulse-row"><span>Open issues</span><strong>{data.repository.openIssues}</strong></div><div className="nexuss-git-analytics-pulse-row"><span>Primary language</span><strong>{data.repository.language || "—"}</strong></div></div>
    </section>
    <section className="nexuss-git-analytics-metrics" aria-label="Repository metrics"><Metric icon={<GitCommitHorizontal size={14} />} label="Recent commits" value={String(data.commits.length)} detail="latest sample" tone="copper" /><Metric icon={<GitPullRequest size={14} />} label="Pull requests" value={String(data.pulls.length)} detail={`${open} open · ${merged} merged`} /><Metric icon={<Users size={14} />} label="Contributors" value={String(data.contributors.length)} detail="recent contributors" /><Metric icon={<Star size={14} />} label="Stars" value={String(data.repository.stars)} detail={`${data.repository.forks} forks`} tone="copper" /></section>
    <div className="nexuss-git-analytics-columns">
      <section className="nexuss-git-analytics-section"><div className="nexuss-git-analytics-section-heading"><div><span className="nexuss-git-eyebrow">Delivery history</span><h3>Recent commits</h3></div><span>{data.commits.length} shown</span></div>{data.commits.length ? <div className="nexuss-git-analytics-commit-list">{data.commits.slice(0, 8).map((commit, index) => <div className="nexuss-git-analytics-commit" key={commit.sha || `${commit.author}-${commit.date}-${index}`}><span className="nexuss-git-analytics-commit-mark"><GitCommitHorizontal size={13} /></span><div><strong>{commit.message || "Untitled commit"}</strong><small>{commit.author} <i>·</i> {formatDate(commit.date)}</small></div></div>)}</div> : <p className="nexuss-git-analytics-muted">No recent commits were returned.</p>}</section>
      <section className="nexuss-git-analytics-section"><div className="nexuss-git-analytics-section-heading"><div><span className="nexuss-git-eyebrow">Participation</span><h3>Top contributors</h3></div><span>{data.contributors.length} active</span></div>{data.contributors.length ? <div className="nexuss-git-analytics-contributor-list">{data.contributors.slice(0, 8).map((contributor, index) => <div className="nexuss-git-analytics-contributor" key={contributor.login}><span className="nexuss-git-analytics-rank">{String(index + 1).padStart(2, "0")}</span><span className="nexuss-git-analytics-avatar">{contributor.login.slice(0, 1).toUpperCase()}</span><div><strong>{contributor.login}</strong><small>{contributor.contributions} contributions</small></div><em>{contributor.contributions}</em></div>)}</div> : <p className="nexuss-git-analytics-muted">Contributor data is unavailable.</p>}</section>
    </div>
    <footer className="nexuss-git-analytics-footer"><span><Github size={12} /> Bounded GitHub sample</span><span><Languages size={12} /> {data.repository.language || "Language unavailable"}</span><span><GitFork size={12} /> {data.repository.forks} forks</span><a href={`https://github.com/${repository.fullName}`} target="_blank" rel="noreferrer noopener">Open repository <ArrowUpRight size={12} /></a></footer>
  </div>;
}
