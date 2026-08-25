import { useState, type ReactNode, type FormEvent } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  GitBranch,
  Github,
  History,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  FolderTree,
  GitPullRequest,
  Files,
  Command,
  ChevronDown,
} from "lucide-react";
import type { RightWindowApi } from "@/lib/rightWindowExtensions";

type GitTab = "overview" | "files" | "changes" | "branches" | "activity";
type EmptyActionProps = { icon: ReactNode; title: string; detail: string; action?: string };

const tabs: Array<{ id: GitTab; label: string; icon: typeof Activity; count?: number }> = [
  { id: "overview", label: "Overview", icon: Github },
  { id: "files", label: "Files", icon: FolderTree },
  { id: "changes", label: "Changes", icon: Files, count: 0 },
  { id: "branches", label: "Branches", icon: GitBranch },
  { id: "activity", label: "Activity", icon: Activity },
];

function EmptyAction({ icon, title, detail, action }: EmptyActionProps) {
  return (
    <div className="nexuss-git-empty">
      <span className="nexuss-git-empty-icon">{icon}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action ? <button type="button" className="nexuss-git-quiet-button">{action}</button> : null}
    </div>
  );
}

function StatCard({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "copper" | "green" }) {
  return <div className={`nexuss-git-stat nexuss-git-stat-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

export default function NexussGitApp({ api }: { api: RightWindowApi }) {
  const [activeTab, setActiveTab] = useState<GitTab>("overview");
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [commandNotice, setCommandNotice] = useState("");

  function submitCommand(event: FormEvent) {
    event.preventDefault();
    if (!command.trim()) return;
    setCommandNotice("Connect a repository to run this action.");
  }

  return (
    <section className="nexuss-git-app" aria-label="Nexuss-Git workspace">
      <div className="nexuss-git-toolbar">
        <div className="nexuss-git-identity">
          <span className="nexuss-git-app-mark"><Github size={16} strokeWidth={1.8} /></span>
          <div><strong>Nexuss-Git</strong><small>Repository workspace</small></div>
        </div>
        <div className="nexuss-git-toolbar-actions">
          <button type="button" className="nexuss-git-icon-button" title="Refresh repository" aria-label="Refresh repository"><RefreshCw size={14} /></button>
          <button type="button" className="nexuss-git-icon-button" title="GitHub settings" aria-label="GitHub settings"><Settings2 size={14} /></button>
        </div>
      </div>

      <div className="nexuss-git-repository-picker">
        <button type="button" className="nexuss-git-repository-button" onClick={() => setRepositoryOpen((open) => !open)} aria-expanded={repositoryOpen}>
          <span className="nexuss-git-repo-avatar"><Github size={15} /></span>
          <span className="nexuss-git-repo-copy"><small>Repository</small><strong>Select a repository</strong></span>
          <ChevronDown size={14} className={repositoryOpen ? "nexuss-git-chevron-open" : ""} />
        </button>
        <span className="nexuss-git-connection-status"><span /> Not connected</span>
        {repositoryOpen ? <div className="nexuss-git-repository-menu"><button type="button" onClick={() => setRepositoryOpen(false)}><Search size={14} /> Search repositories</button><button type="button" onClick={() => setRepositoryOpen(false)}><Plus size={14} /> Connect GitHub account</button></div> : null}
      </div>

      <nav className="nexuss-git-tabs" aria-label="GitHub sections">
        {tabs.map((tab) => { const Icon = tab.icon; return <button key={tab.id} type="button" className={activeTab === tab.id ? "is-active" : ""} onClick={() => setActiveTab(tab.id)}><Icon size={14} /><span>{tab.label}</span>{tab.count !== undefined ? <em>{tab.count}</em> : null}</button>; })}
      </nav>

      <div className="nexuss-git-content">
        {activeTab === "overview" ? <>
          <div className="nexuss-git-hero"><div><span className="nexuss-git-eyebrow"><Sparkles size={12} /> Workspace overview</span><h2>Bring your repository into focus.</h2><p>Connect GitHub to browse code, manage branches, review changes, and ship work without command-line overhead.</p></div><button type="button" className="nexuss-git-connect-button"><Github size={15} /> Connect GitHub</button></div>
          <div className="nexuss-git-stat-grid"><StatCard label="Branch" value="—" detail="No repository selected" tone="copper" /><StatCard label="Sync" value="—" detail="Waiting for connection" /><StatCard label="Changes" value="0" detail="Workspace is clear" tone="green" /></div>
          <div className="nexuss-git-section-heading"><div><span className="nexuss-git-eyebrow">Quick actions</span><h3>Repository workflow</h3></div><button type="button" className="nexuss-git-text-button" onClick={() => api.setWidth(Math.min(560, window.innerWidth - 280))}>Widen workspace <ArrowUpFromLine size={13} /></button></div>
          <div className="nexuss-git-action-grid"><button type="button"><FolderTree size={16} /><span>Browse files</span><small>Inspect the repository tree</small></button><button type="button"><GitBranch size={16} /><span>Create branch</span><small>Start isolated work</small></button><button type="button"><GitPullRequest size={16} /><span>Open pull request</span><small>Review changes before merge</small></button><button type="button"><History size={16} /><span>View activity</span><small>Follow repository events</small></button></div>
          <div className="nexuss-git-trust-note"><ShieldCheck size={15} /><span>Actions stay reviewable. Publishing changes will always require an explicit confirmation.</span></div>
        </> : null}
        {activeTab === "files" ? <EmptyAction icon={<FolderTree size={20} />} title="No repository selected" detail="Choose a GitHub repository to browse its files and search its code." action="Choose repository" /> : null}
        {activeTab === "changes" ? <EmptyAction icon={<Files size={20} />} title="No changes to review" detail="Connect a repository and the working tree diff will appear here." action="Refresh workspace" /> : null}
        {activeTab === "branches" ? <EmptyAction icon={<GitBranch size={20} />} title="Branches appear here" detail="Select a repository to inspect, compare, and create branches." action="Choose repository" /> : null}
        {activeTab === "activity" ? <EmptyAction icon={<Activity size={20} />} title="Activity is quiet" detail="Repository commits, pull requests, issues, and workflow events will appear here." /> : null}
      </div>

      <form className="nexuss-git-command-bar" onSubmit={submitCommand}><Command size={15} /><input value={command} onChange={(event) => { setCommand(event.target.value); setCommandNotice(""); }} placeholder="Ask GitHub to inspect this repository…" aria-label="Ask GitHub" /><button type="submit" aria-label="Run GitHub request" title="Run request"><ArrowDownToLine size={15} /></button>{commandNotice ? <small>{commandNotice}</small> : null}</form>
      <div className="nexuss-git-footer"><span><Bell size={12} /> Ready when you are</span><span><UploadCloud size={12} /> Changes stay local until you publish</span></div>
    </section>
  );
}
