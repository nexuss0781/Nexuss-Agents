import { useMemo, useState, type FormEvent } from "react";
import { Archive, Check, ChevronRight, ExternalLink, Globe2, Github, Lock, MoreHorizontal, Pencil, Plus, RefreshCw, Search, ShieldAlert, Trash2, X } from "lucide-react";
import { trpc } from "@/lib/trpc";

type GithubRepository = { id: number; name: string; fullName: string; description: string | null; private: boolean; htmlUrl: string; defaultBranch: string };

type Props = {
  repositories: GithubRepository[];
  login?: string;
  selectedRepository: GithubRepository | null;
  onSelect: (repository: GithubRepository | null) => void;
};

function formatRepositoryDate(value: string | null | undefined) {
  if (!value) return "No recent push";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No recent push";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function repositoryActivity(repository: GithubRepository) {
  return repository.private ? "Private workspace" : "Public workspace";
}

export default function NexussGitRepoPanel({ repositories, login, selectedRepository, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [inspected, setInspected] = useState<GithubRepository | null>(selectedRepository);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [rename, setRename] = useState("");
  const [notice, setNotice] = useState("");
  const utils = trpc.useUtils();
  const repositoriesQuery = trpc.workspace.github.repositories.useQuery(undefined, { enabled: false });
  const createMutation = trpc.workspace.github.createRepository.useMutation({
    onSuccess: (repository) => {
      setCreateOpen(false); setName(""); setDescription(""); setNotice("Repository created."); setInspected(repository); onSelect(repository); void utils.workspace.github.repositories.invalidate();
    },
    onError: (error) => setNotice(error.message || "Repository could not be created."),
  });
  const renameMutation = trpc.workspace.github.renameRepository.useMutation({
    onSuccess: (repository) => {
      setRenameOpen(false); setRename(""); setNotice("Repository renamed."); setInspected(repository); onSelect(repository); void utils.workspace.github.repositories.invalidate();
    },
    onError: (error) => setNotice(error.message || "Repository could not be renamed."),
  });
  const deleteMutation = trpc.workspace.github.deleteRepository.useMutation({
    onSuccess: () => {
      setDeleteOpen(false); setNotice("Repository deleted."); setInspected(null); onSelect(null); void utils.workspace.github.repositories.invalidate();
    },
    onError: (error) => setNotice(error.message || "Repository could not be deleted."),
  });
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return repositories;
    return repositories.filter((repository) => `${repository.fullName} ${repository.description || ""}`.toLowerCase().includes(needle));
  }, [repositories, query]);
  const active = inspected || selectedRepository;
  const owned = Boolean(active && login && active.fullName.split("/")[0].toLowerCase() === login.toLowerCase());

  function openRepository(repository: GithubRepository) {
    setInspected(repository); onSelect(repository); setNotice("");
  }
  function openDetails(repository: GithubRepository) {
    setInspected(repository); setNotice("");
  }
  function submitCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setNotice("Enter a repository name."); return; }
    createMutation.mutate({ name: trimmed, description: description.trim() || undefined, private: isPrivate });
  }
  function submitRename(event: FormEvent) {
    event.preventDefault();
    if (!active || !rename.trim()) return;
    renameMutation.mutate({ fullName: active.fullName, name: rename.trim() });
  }
  function submitDelete() {
    if (!active) return;
    deleteMutation.mutate({ fullName: active.fullName, confirmed: true });
  }

  return <div className="nexuss-git-repo-workspace">
    <div className="nexuss-git-repo-main">
      <div className="nexuss-git-repo-heading">
        <div><span className="nexuss-git-eyebrow"><Archive size={12} /> GitHub collection</span><h2>Repositories</h2><p>Browse every repository available to your connected account.</p></div>
        <div className="nexuss-git-repo-heading-actions"><span className="nexuss-git-repo-account"><Github size={13} /> {login || "Connected account"}</span><button type="button" className="nexuss-git-icon-button" title="Refresh repositories" aria-label="Refresh repositories" onClick={() => { void repositoriesQuery.refetch(); void utils.workspace.github.repositories.invalidate(); }}><RefreshCw size={14} /></button><button type="button" className="nexuss-git-create-repo-button" onClick={() => { setCreateOpen((open) => !open); setNotice(""); }}><Plus size={14} /> New repository</button></div>
      </div>
      <div className="nexuss-git-repo-toolbar"><div className="nexuss-git-repo-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search repositories" aria-label="Search repositories" /></div><span>{filtered.length} of {repositories.length} repositories</span></div>
      {notice ? <div className="nexuss-git-repo-notice" role="status"><Check size={14} /> {notice}</div> : null}
      {createOpen ? <form className="nexuss-git-create-repo-panel" onSubmit={submitCreate}><div className="nexuss-git-form-heading"><div><span className="nexuss-git-eyebrow">New repository</span><strong>Create a home for the next piece of work.</strong></div><button type="button" className="nexuss-git-icon-button" aria-label="Close create repository form" onClick={() => setCreateOpen(false)}><X size={14} /></button></div><label>Repository name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="product-lab" maxLength={100} autoFocus /></label><label>Description <span>optional</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="A short description" maxLength={500} /></label><label className="nexuss-git-visibility-toggle"><input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} /><span>{isPrivate ? <Lock size={14} /> : <Globe2 size={14} />} {isPrivate ? "Private repository" : "Public repository"}</span></label><div className="nexuss-git-form-actions"><button type="button" className="nexuss-git-text-button" onClick={() => setCreateOpen(false)}>Cancel</button><button type="submit" className="nexuss-git-primary-button" disabled={createMutation.isPending}>{createMutation.isPending ? "Creating…" : "Create repository"}</button></div></form> : null}
      <div className="nexuss-git-repo-list" role="list" aria-label="Repositories">
        {filtered.length ? filtered.map((repository) => <div key={repository.id} role="listitem" className={`nexuss-git-repo-row ${active?.id === repository.id ? "is-active" : ""}`} onContextMenu={(event) => { event.preventDefault(); openDetails(repository); }} onDoubleClick={() => openDetails(repository)}><button type="button" className="nexuss-git-repo-row-main" onClick={() => openRepository(repository)}><span className="nexuss-git-repo-row-icon">{repository.private ? <Lock size={15} /> : <Github size={15} />}</span><span className="nexuss-git-repo-row-copy"><strong>{repository.name}</strong><small>{repository.fullName} · {repository.private ? "Private" : "Public"}</small></span></button><span className="nexuss-git-repo-row-meta"><span className="nexuss-git-repo-branch"><span>branch</span>{repository.defaultBranch}</span><button type="button" className="nexuss-git-repo-more" aria-label={`Open details for ${repository.fullName}`} title="Open repository details" onClick={() => openDetails(repository)}><MoreHorizontal size={16} /></button><ChevronRight size={14} className="nexuss-git-repo-row-chevron" /></span></div>) : <div className="nexuss-git-repo-empty"><Archive size={20} /><strong>{repositories.length ? "No repositories match" : "No repositories found"}</strong><p>{repositories.length ? "Try a different name or owner." : "Create your first repository to get started."}</p></div>}
      </div>
    </div>
    {active ? <aside className="nexuss-git-repo-inspector"><div className="nexuss-git-inspector-header"><div><span className="nexuss-git-eyebrow">Repository details</span><h3>{active.name}</h3></div><button type="button" className="nexuss-git-icon-button" aria-label="Close repository details" onClick={() => setInspected(null)}><X size={14} /></button></div><div className="nexuss-git-inspector-identity"><span className="nexuss-git-inspector-mark">{active.private ? <Lock size={18} /> : <Github size={18} />}</span><div><strong>{active.fullName}</strong><span>{repositoryActivity(active)}</span></div></div><p className="nexuss-git-inspector-description">{active.description || "No description has been added for this repository."}</p><dl className="nexuss-git-repo-facts"><div><dt>Default branch</dt><dd>{active.defaultBranch || "main"}</dd></div><div><dt>Visibility</dt><dd>{active.private ? "Private" : "Public"}</dd></div><div><dt>Repository ID</dt><dd>#{active.id}</dd></div></dl><a className="nexuss-git-inspector-link" href={active.htmlUrl} target="_blank" rel="noreferrer noopener">Open on GitHub <ExternalLink size={13} /></a>{owned ? <div className="nexuss-git-inspector-actions"><button type="button" className="nexuss-git-secondary-button" onClick={() => { setRename(active.name); setRenameOpen(true); setDeleteOpen(false); }}><Pencil size={13} /> Rename</button><button type="button" className="nexuss-git-danger-button" onClick={() => { setDeleteOpen(true); setRenameOpen(false); }}><Trash2 size={13} /> Delete</button></div> : <p className="nexuss-git-inspector-note"><ShieldAlert size={14} /> Rename and delete are available only for repositories owned by {login || "your account"}.</p>}{renameOpen ? <form className="nexuss-git-inspector-form" onSubmit={submitRename}><label>New repository name<input value={rename} onChange={(event) => setRename(event.target.value)} maxLength={100} autoFocus /></label><div className="nexuss-git-form-actions"><button type="button" className="nexuss-git-text-button" onClick={() => setRenameOpen(false)}>Cancel</button><button type="submit" className="nexuss-git-primary-button" disabled={renameMutation.isPending}>{renameMutation.isPending ? "Renaming…" : "Save name"}</button></div></form> : null}{deleteOpen ? <div className="nexuss-git-delete-panel"><div className="nexuss-git-delete-warning"><ShieldAlert size={15} /><div><strong>Delete this repository?</strong><p>This permanently removes the GitHub repository and its remote history.</p></div></div><span className="nexuss-git-eyebrow">Command preview</span><code>sudo delete repo {active.name}</code><p className="nexuss-git-delete-confirmation">The command is a review label only; deletion occurs through the protected GitHub API after confirmation.</p><div className="nexuss-git-form-actions"><button type="button" className="nexuss-git-text-button" onClick={() => setDeleteOpen(false)}>Cancel</button><button type="button" className="nexuss-git-danger-button" disabled={deleteMutation.isPending} onClick={submitDelete}>{deleteMutation.isPending ? "Deleting…" : "Confirm delete"}</button></div></div> : null}</aside> : <aside className="nexuss-git-repo-inspector is-empty"><Archive size={22} /><strong>Select a repository</strong><p>Single-click to select. Double-click or right-click to open details.</p></aside>}
  </div>;
}
