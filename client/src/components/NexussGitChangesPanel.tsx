import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, Bot, Check, ChevronDown, ChevronRight, FileCode2, GitBranch, GitCommitHorizontal, GitPullRequest, Github, LoaderCircle, LockKeyhole, RefreshCw, Search, ShieldCheck, Sparkles, UploadCloud, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { RightWindowWorkspaceProject } from "@/lib/rightWindowExtensions";

type GithubRepository = { id: number; name: string; fullName: string; description: string | null; private: boolean; htmlUrl: string; defaultBranch: string };
type GithubBranch = { name: string; protected: boolean };
type ChangedFile = { path: string; status: "added" | "modified" | "deleted" | "renamed" | "untracked"; additions: number; deletions: number; diff: string; binary?: boolean };
type ChangesSnapshot = { projectId: string; fullName: string; branch: string; currentBranch: string; branchReady: boolean; files: ChangedFile[]; additions: number; deletions: number; clean: boolean };

type Props = { repositories: GithubRepository[]; selectedRepository?: GithubRepository | null; currentProject?: RightWindowWorkspaceProject | null; onSelect?: (repository: GithubRepository) => void };

function statusLabel(status: ChangedFile["status"]) { return status === "untracked" ? "Untracked" : status[0].toUpperCase() + status.slice(1); }
function diffClass(line: string) { return line.startsWith("+") && !line.startsWith("+++") ? "is-addition" : line.startsWith("-") && !line.startsWith("---") ? "is-deletion" : line.startsWith("@@") ? "is-hunk" : ""; }

function githubFullNameFromSourceUrl(sourceUrl?: string) {
  if (!sourceUrl) return "";
  try {
    const url = new URL(sourceUrl);
    if (url.hostname.toLowerCase() !== "github.com") return "";
    const parts = url.pathname.split("/").filter(Boolean).map((part) => part.replace(/\.git$/i, ""));
    return parts.length === 2 ? `${parts[0]}/${parts[1]}` : "";
  } catch {
    return "";
  }
}

export default function NexussGitChangesPanel({ repositories, currentProject }: Props) {
  const linkedFullName = githubFullNameFromSourceUrl(currentProject?.sourceUrl);
  const isGitProject = currentProject?.sourceType === "github" || Boolean(linkedFullName);
  const selectedRepository = isGitProject && linkedFullName ? repositories.find((repository) => repository.fullName.toLowerCase() === linkedFullName.toLowerCase()) || null : null;
  const [branch, setBranch] = useState(selectedRepository?.defaultBranch || "main");
  const [message, setMessage] = useState("");
  const [model, setModel] = useState("");
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const utils = trpc.useUtils();
  const settingsQuery = trpc.workspace.modelSettings.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const branchQuery = trpc.workspace.github.branches.useQuery({ fullName: selectedRepository?.fullName || "placeholder/repository" }, { enabled: Boolean(selectedRepository), retry: false, staleTime: 30_000 });
  const changesQuery = trpc.workspace.github.localChanges.useQuery({ fullName: selectedRepository?.fullName || "placeholder/repository", branch: branch || undefined }, { enabled: Boolean(selectedRepository), retry: false, staleTime: 3_000, refetchOnWindowFocus: false });
  const generateMutation = trpc.workspace.github.generateCommitMessage.useMutation({ onSuccess: (result) => { setMessage(result.message); setConfirmOpen(false); setNotice("Ardi drafted a commit message from the complete local diff."); }, onError: (error) => setNotice(error.message || "Ardi could not generate a commit message.") });
  const commitMutation = trpc.workspace.github.commitAndPush.useMutation({ onSuccess: (result) => { setConfirmOpen(false); setNotice(`Committed ${result.commit.slice(0, 8)} and pushed to ${result.branch}.`); setMessage(""); void changesQuery.refetch(); }, onError: (error) => { setConfirmOpen(false); setNotice(error.message || "Commit and push could not be completed."); void changesQuery.refetch(); } });
  const models = useMemo(() => Array.from(new Set([...(settingsQuery.data?.selectedModels || []), ...(settingsQuery.data?.availableModels || [])])), [settingsQuery.data]);
  const branches = ((branchQuery.data?.branches || []) as GithubBranch[]);
  const snapshot = changesQuery.data as ChangesSnapshot | undefined;
  const files = snapshot?.files || [];

  useEffect(() => { setBranch(selectedRepository?.defaultBranch || "main"); setMessage(""); setExpandedPath(null); setConfirmOpen(false); setNotice(""); }, [selectedRepository?.id, selectedRepository?.defaultBranch]);
  useEffect(() => { if (!model && models[0]) setModel(models[0]); }, [model, models]);
  useEffect(() => { if (branches.length && !branches.some((item) => item.name === branch)) setBranch(selectedRepository?.defaultBranch || branches[0].name); }, [branch, branches, selectedRepository?.defaultBranch]);

  function generateMessage() { if (!selectedRepository || !snapshot || snapshot.clean) { setNotice("There are no local changes to summarize."); return; } generateMutation.mutate({ fullName: selectedRepository.fullName, branch: branch || undefined, model: model || undefined }); }
  function submit(event: FormEvent) { event.preventDefault(); if (!message.trim()) { generateMessage(); return; } if (!snapshot || snapshot.clean) { setNotice("There are no local changes to commit."); return; } setConfirmOpen(true); }
  function confirmCommit() { if (!selectedRepository || !message.trim()) return; commitMutation.mutate({ fullName: selectedRepository.fullName, branch: branch || undefined, message: message.trim(), confirmed: true }); }

  if (!currentProject) return <div className="nexuss-git-changes-empty"><span><GitCommitHorizontal size={22} /></span><h2>Select a Git project</h2><p>Changes follows the project you are currently viewing. Open a project with a connected GitHub repository to review local work.</p></div>;
  if (!isGitProject || !linkedFullName) return <div className="nexuss-git-changes-empty"><span><Github size={22} /></span><h2>This is not a Git project</h2><p>Select or open a project that was imported from GitHub before reviewing local changes.</p></div>;
  if (!selectedRepository) return <div className="nexuss-git-changes-empty"><span><RefreshCw size={22} /></span><h2>Loading project repository</h2><p>The linked repository <strong>{linkedFullName}</strong> is not available in the current GitHub connection. Refresh or reconnect GitHub, then retry.</p></div>;

  return <div className="nexuss-git-changes-workspace">
    <header className="nexuss-git-changes-header"><div><span className="nexuss-git-eyebrow"><GitCommitHorizontal size={12} /> Local workspace</span><h2>Changes</h2><p>Review the working tree before it becomes history.</p></div><div className="nexuss-git-changes-header-actions"><button type="button" className="nexuss-git-icon-button" title="Refresh changes" aria-label="Refresh changes" onClick={() => void changesQuery.refetch()}><RefreshCw size={14} /></button><span className="nexuss-git-local-badge"><span /> Local only</span></div></header>
    <section className="nexuss-git-change-target"><label><span>Project repository</span><div className="nexuss-git-change-project"><Github size={14} /><strong>{selectedRepository.fullName}</strong><small>{currentProject?.name || "Current project"}</small></div></label><label><span>Branch</span><div className="nexuss-git-change-select"><GitBranch size={14} /><select value={branch} onChange={(event) => { setBranch(event.target.value); setConfirmOpen(false); }}>{branches.length ? branches.map((item) => <option key={item.name} value={item.name}>{item.name}{item.protected ? " · protected" : ""}</option>) : <option value={branch}>{branch}</option>}</select><ChevronDown size={13} /></div></label><div className="nexuss-git-target-meta"><span className={snapshot?.branchReady === false ? "is-warning" : ""}><span /> {snapshot?.branchReady === false ? "Branch will be fetched" : `Workspace ${snapshot?.currentBranch || branch}`}</span><small>{snapshot?.projectId ? "Persisted project workspace" : "Checking local workspace"}</small></div></section>
    <form className="nexuss-git-commit-composer" onSubmit={submit}><div className="nexuss-git-commit-input"><span className="nexuss-git-eyebrow">Commit message</span><textarea value={message} onChange={(event) => { setMessage(event.target.value); setConfirmOpen(false); setNotice(""); }} placeholder="Describe what changed…" maxLength={240} aria-label="Commit message" /><div className="nexuss-git-commit-input-footer"><span>{message.length}/240</span><span>{message.trim() ? "Ready to commit" : "Leave blank for Ardi"}</span></div></div><div className="nexuss-git-commit-controls"><label><span><Bot size={13} /> Ardi Agent</span><div className="nexuss-git-model-select"><select value={model} onChange={(event) => setModel(event.target.value)} aria-label="Choose commit message model"><option value="">Default working model</option>{models.map((item) => <option key={item} value={item}>{item}</option>)}</select><ChevronDown size={12} /></div></label><button type="submit" className={message.trim() ? "nexuss-git-commit-button is-commit" : "nexuss-git-commit-button"} disabled={generateMutation.isPending || commitMutation.isPending || changesQuery.isLoading}>{generateMutation.isPending ? <><LoaderCircle size={14} className="nexuss-git-spin" /> Reading diff…</> : message.trim() ? <><GitCommitHorizontal size={14} /> Commit</> : <><Sparkles size={14} /> Generate</>}</button><small><ShieldCheck size={11} /> The full diff is processed server-side.</small></div></form>
    {notice ? <div className="nexuss-git-changes-notice" role="status"><Check size={14} /> {notice}</div> : null}
    {confirmOpen ? <section className="nexuss-git-commit-confirm"><div><AlertTriangle size={16} /><div><strong>Confirm commit and push</strong><p>This will stage all local changes, create the commit, and push <code>{branch}</code> to GitHub.</p></div></div><code className="nexuss-git-command-preview">git add --all && git commit -m &quot;{message.trim()}&quot; && git push origin {branch}</code><div className="nexuss-git-form-actions"><button type="button" className="nexuss-git-text-button" onClick={() => setConfirmOpen(false)}>Cancel</button><button type="button" className="nexuss-git-danger-button" disabled={commitMutation.isPending} onClick={confirmCommit}>{commitMutation.isPending ? "Publishing…" : "Confirm commit & push"}</button></div></section> : null}
    <section className="nexuss-git-changes-summary"><div><span>Working tree</span><strong>{changesQuery.isLoading ? "—" : snapshot?.clean ? "Clean" : `${files.length} files`}</strong><small>{snapshot?.clean ? "Nothing waiting" : "Awaiting review"}</small></div><div className="is-additions"><span>Insertions</span><strong>+{snapshot?.additions || 0}</strong><small>Lines added</small></div><div className="is-deletions"><span>Deletions</span><strong>-{snapshot?.deletions || 0}</strong><small>Lines removed</small></div><div><span>Branch</span><strong>{branch}</strong><small>{snapshot?.currentBranch === branch ? "Currently checked out" : "Selected target"}</small></div></section>
    <section className="nexuss-git-changes-list"><div className="nexuss-git-changes-list-heading"><div><span className="nexuss-git-eyebrow">Files in this change</span><strong>{files.length ? "Review every local modification" : "No local modifications"}</strong></div><span>{snapshot?.clean ? <><Check size={12} /> Clean</> : `${files.length} changed`}</span></div>{changesQuery.isLoading ? <div className="nexuss-git-changes-state"><LoaderCircle size={17} className="nexuss-git-spin" /> Reading local workspace…</div> : changesQuery.isError ? <div className="nexuss-git-changes-state is-error"><X size={17} /><span>Local changes are unavailable. Import this repository into a project first.</span><button type="button" onClick={() => void changesQuery.refetch()}>Retry</button></div> : snapshot?.clean ? <div className="nexuss-git-changes-state"><Check size={20} /><span>Working tree is clean.<small>Make a local edit in the project workspace and refresh to review it here.</small></span></div> : files.map((file) => <article key={file.path} className={`nexuss-git-change-file ${expandedPath === file.path ? "is-expanded" : ""}`}><button type="button" className="nexuss-git-change-file-heading" onClick={() => setExpandedPath((path) => path === file.path ? null : file.path)}><span className="nexuss-git-change-file-icon"><FileCode2 size={15} /></span><span className="nexuss-git-change-file-copy"><strong>{file.path}</strong><small>{statusLabel(file.status)}{file.binary ? " · Binary" : ""}</small></span><span className="nexuss-git-change-counts"><em className="is-addition">+{file.additions}</em><em className="is-deletion">-{file.deletions}</em></span>{expandedPath === file.path ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>{expandedPath === file.path ? <div className="nexuss-git-change-diff">{file.binary ? <div className="nexuss-git-binary-diff"><LockKeyhole size={14} /> Binary file cannot be rendered as text.</div> : <pre>{file.diff.split(/\r?\n/).map((line, index) => <span key={`${file.path}-${index}`} className={diffClass(line)}>{line || " "}{"\n"}</span>)}</pre>}</div> : null}</article>)}</section>
    <footer className="nexuss-git-changes-footer"><span><UploadCloud size={12} /> Changes stay local until you publish.</span><span><ShieldCheck size={12} /> Commit and push is audited.</span></footer>
  </div>;
}
