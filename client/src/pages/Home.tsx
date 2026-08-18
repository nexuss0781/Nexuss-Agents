// Design philosophy: Obsidian Console — Swiss precision, monochrome hierarchy, quiet depth.
// Design philosophy: Obsidian Console — quiet workbench, original AXOLOTL brand, and only the labels needed to work.
import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import "katex/dist/katex.min.css";
import {
  ArrowUp,
  Check,
  ChevronDown,
  CirclePlus,
  Copy,
  Folder,
  FolderPlus,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "../lib/trpc";
import { useLocation } from "wouter";

const AXOLOTL_ICON = "/axolotl-only.png";

type Project = { id: string; name: string; description: string; tone: string };
type Message = { id: string; role: "user" | "assistant"; content: string; createdAt: string };
type Thread = { id: string; chatSlug?: string; title: string; projectId?: string; updatedAt: string; messages: Message[] };

type Workspace = { projects: Project[]; threads: Thread[] };

const seed: Workspace = {
  projects: [],
  threads: [],
};

export function shouldMigrateLegacyWorkspace(remote: Workspace, legacy: Workspace) {
  const hasRemoteData = remote.projects.length > 0 || remote.threads.length > 0;
  const hasLegacyData = legacy.projects.length > 0 || legacy.threads.length > 0;
  return hasLegacyData && !hasRemoteData;
}

function formatDate(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            return match ? (
              <SyntaxHighlighter style={vscDarkPlus as any} language={match[1]} PreTag="div" className="code-block">
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            ) : (
              <code className="inline-code">{children}</code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function AxolotlLoader({ label = "NEXUSS-AGENT IS THINKING" }: { label?: string }) {
  return <div className="axolotl-loader" role="status" aria-live="polite"><div className="loader-mark"><img src={AXOLOTL_ICON} alt="" /></div><span>{label}</span><i /><i /><i /></div>;
}

function ResponseSkeleton() {
  return <article className="response-skeleton" role="status" aria-live="polite"><div className="response-skeleton-meta"><span className="role-mark assistant"><img src={AXOLOTL_ICON} alt="" /></span><span>Nexuss-Agent</span><span>Preparing an extended response</span></div><div className="response-skeleton-lines" aria-hidden="true"><i /><i /><i /></div></article>;
}

type HomeProps = {
  profileName?: string;
  profileEmail?: string;
  profileAvatarUrl?: string;
  onSignOut?: () => void;
  signOutPending?: boolean;
};

export default function Home({ profileName = "Nexuss Operator", profileEmail, profileAvatarUrl, onSignOut, signOutPending = false }: HomeProps) {
  const [location, setLocation] = useLocation();
  const routeChatSlug = /^\/app\/chat\/(chat-[a-z0-9]{32})$/.exec(location)?.[1];
  const workspaceInput = useMemo(() => routeChatSlug ? { chatSlug: routeChatSlug } : undefined, [routeChatSlug]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const legacyWorkspace = useRef<Workspace | null>(null);
  if (legacyWorkspace.current === null && typeof window !== "undefined") {
    try {
      const stored = JSON.parse(localStorage.getItem("nexuss-agent-workspace-v2") || "null") as Workspace | null;
      legacyWorkspace.current = stored && Array.isArray(stored.projects) && Array.isArray(stored.threads) ? { projects: stored.projects, threads: stored.threads } : seed;
    } catch { legacyWorkspace.current = seed; }
  }
  const navigationQuery = trpc.workspace.navigation.useQuery(undefined, { retry: false, staleTime: 15_000 });
  const activeChatQuery = trpc.workspace.chat.useQuery({ chatSlug: routeChatSlug || "chat-00000000000000000000000000000000" }, { enabled: Boolean(routeChatSlug), retry: false, staleTime: 15_000 });
  const modelSettingsQuery = trpc.workspace.modelSettings.useQuery(undefined, { enabled: settingsOpen, retry: false, staleTime: 0 });
  const utils = trpc.useUtils();
  const [activeThreadId, setActiveThreadId] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const [projectEditor, setProjectEditor] = useState<{ mode: "create" | "edit"; project?: Project } | null>(null);
  const [threadEditor, setThreadEditor] = useState<string | null>(null);
  const [threadName, setThreadName] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [modelApiKey, setModelApiKey] = useState("");
  const [modelBaseUrl, setModelBaseUrl] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [migrationSettled, setMigrationSettled] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const migrationStarted = useRef(false);
  const workspace = navigationQuery.data || seed;
  const migration = trpc.workspace.migrate.useMutation({
    onSuccess: () => {
      localStorage.removeItem("nexuss-agent-workspace-v2");
      setMigrationSettled(true);
      void utils.workspace.navigation.invalidate();
    },
    onError: () => { setMigrationSettled(true); toast.error("Your existing browser history could not be imported. It remains stored locally until the next attempt."); },
  });
  const refreshWorkspace = () => { void utils.workspace.navigation.invalidate(); void utils.workspace.chat.invalidate(); };
  const createProjectMutation = trpc.workspace.createProject.useMutation({ onSuccess: refreshWorkspace, onError: () => toast.error("Project could not be saved") });
  const updateProjectMutation = trpc.workspace.updateProject.useMutation({ onSuccess: refreshWorkspace, onError: () => toast.error("Project could not be updated") });
  const deleteProjectMutation = trpc.workspace.deleteProject.useMutation({ onSuccess: refreshWorkspace, onError: () => toast.error("Project could not be removed") });
  const createThreadMutation = trpc.workspace.createThread.useMutation({ onSuccess: (thread) => { setActiveThreadId(thread.id); setPendingProjectId(null); setLocation(`/app/chat/${thread.chatSlug}`); refreshWorkspace(); toast.success(thread.created === false ? "Existing empty thread selected" : "New thread created"); }, onError: () => toast.error("Thread could not be created") });
  const renameThreadMutation = trpc.workspace.renameThread.useMutation({ onSuccess: refreshWorkspace, onError: () => toast.error("Thread could not be renamed") });
  const deleteThreadMutation = trpc.workspace.deleteThread.useMutation({ onSuccess: refreshWorkspace, onError: () => toast.error("Thread could not be deleted") });
  const assignThreadProjectMutation = trpc.workspace.assignThreadProject.useMutation({ onSuccess: refreshWorkspace, onError: () => toast.error("Project assignment could not be saved") });
  const appendMessagesMutation = trpc.workspace.appendMessages.useMutation({ onSuccess: refreshWorkspace, onError: () => toast.error("Message could not be saved") });
  const saveModelSettingsMutation = trpc.workspace.saveModelSettings.useMutation({ onError: (error) => toast.error(error.message || "Provider settings could not be saved") });
  const discoverModelsMutation = trpc.workspace.discoverModels.useMutation({ onError: (error) => toast.error(error.message || "Models could not be refreshed") });

  useEffect(() => {
    if (!navigationQuery.isSuccess || migrationStarted.current) return;
    migrationStarted.current = true;
    const legacy = legacyWorkspace.current || seed;
    if (shouldMigrateLegacyWorkspace(navigationQuery.data || seed, legacy)) migration.mutate(legacy);
    else setMigrationSettled(true);
  }, [navigationQuery.isSuccess, navigationQuery.data]);

  useEffect(() => {
    if (!workspace.threads.length) { setActiveThreadId(""); return; }
    const selected = workspace.threads.find((thread) => thread.chatSlug === routeChatSlug) || workspace.threads.find((thread) => thread.id === activeThreadId) || workspace.threads[0];
    if (selected.id !== activeThreadId) setActiveThreadId(selected.id);
    if (selected.chatSlug && selected.chatSlug !== routeChatSlug) setLocation(`/app/chat/${selected.chatSlug}`, { replace: true });
  }, [workspace.threads, activeThreadId, routeChatSlug, setLocation]);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSettingsOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  useEffect(() => {
    const savedProvider = modelSettingsQuery.data;
    if (!settingsOpen || !modelSettingsQuery.isSuccess || !savedProvider) return;
    setModelBaseUrl(savedProvider.baseUrl);
    setSelectedModels(savedProvider.selectedModels);
    setAvailableModels((current) => Array.from(new Set([...current, ...savedProvider.selectedModels])).sort((a, b) => a.localeCompare(b)));
  }, [settingsOpen, modelSettingsQuery.isSuccess, modelSettingsQuery.data]);

  const activeThreadSummary = workspace.threads.find((thread) => thread.chatSlug === routeChatSlug) || workspace.threads.find((thread) => thread.id === activeThreadId) || workspace.threads[0];
  const activeThread = activeThreadSummary ? { ...activeThreadSummary, messages: activeChatQuery.data?.messages || activeThreadSummary.messages } : undefined;
  const workspaceReady = navigationQuery.isSuccess && migrationSettled;
  const activeProject = workspace.projects.find((project) => project.id === activeThread?.projectId);
  const activeThreadSlug = activeThread?.chatSlug || (activeThread ? `chat-${activeThread.id.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}` : undefined);
  const responsePending = createThreadMutation.isPending || appendMessagesMutation.isPending;
  const filteredThreads = useMemo(() => workspace.threads.filter((thread) => thread.title.toLowerCase().includes(query.toLowerCase())), [workspace.threads, query]);
  const profileInitials = profileName.slice(0, 2).toUpperCase();
  const profileAvatar = profileAvatarUrl?.startsWith("https://") && !avatarFailed ? profileAvatarUrl : undefined;

  function createThread() {
    if (!workspaceReady) return;
    createThreadMutation.mutate({ projectId: pendingProjectId });
    setMobileNav(false);
  }

  function openThread(thread: Thread) {
    setActiveThreadId(thread.id);
    setMobileNav(false);
    if (thread.chatSlug) setLocation(`/app/chat/${thread.chatSlug}`);
  }

  function deleteThread(id: string) {
    if (!workspaceReady) return;
    if (workspace.threads.length === 1) return toast.error("Keep at least one thread in the workspace");
    deleteThreadMutation.mutate({ id }, { onSuccess: () => { if (activeThreadId === id) setActiveThreadId(""); toast.success("Thread deleted"); } });
  }

  function submitThreadName() {
    if (!workspaceReady) return;
    if (!threadEditor || !threadName.trim()) return setThreadEditor(null);
    renameThreadMutation.mutate({ id: threadEditor, title: threadName.trim() });
    setThreadEditor(null);
  }

  function saveProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceReady) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const description = String(form.get("description") || "").trim();
    if (!name) return;
    if (projectEditor?.mode === "edit" && projectEditor.project) {
      updateProjectMutation.mutate({ id: projectEditor.project.id, project: { name, description } });
      toast.success("Project updated");
    } else {
      createProjectMutation.mutate({ name, description, tone: "#f4f4f0" });
      toast.success("Project created");
    }
    setProjectEditor(null);
  }

  function deleteProject(id: string) {
    if (!workspaceReady) return;
    deleteProjectMutation.mutate({ id });
    toast.success("Project removed; threads are still safe");
  }

  async function sendMessage() {
    const content = draft.trim();
    if (!workspaceReady || !content || createThreadMutation.isPending || appendMessagesMutation.isPending) return;
    try {
      const targetThread = activeThread || await createThreadMutation.mutateAsync({ projectId: pendingProjectId });
      await appendMessagesMutation.mutateAsync({
        threadId: targetThread.id,
        messages: [
          { role: "user", content },
          { role: "assistant", content: "Your message is saved here. Start another thought whenever you’re ready." },
        ],
        ...(targetThread.messages.length === 0 ? { title: content.slice(0, 42) } : {}),
      });
      setActiveThreadId(targetThread.id);
      setLocation(`/app/chat/${targetThread.chatSlug}`);
      setPendingProjectId(null);
      setDraft("");
    } catch {
      // Individual mutation error handlers provide the operator-facing feedback.
    }
  }

  function handleComposerKey(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); }
  }

  function saveProviderSettings(afterSave?: () => void) {
    const apiKey = modelApiKey.trim();
    if (!modelBaseUrl.trim()) return toast.error("Enter a model API base URL.");
    if (!apiKey && !modelSettingsQuery.data?.apiKeyConfigured) return toast.error("Enter an API key before saving your first provider.");
    saveModelSettingsMutation.mutate({ baseUrl: modelBaseUrl, ...(apiKey ? { apiKey } : {}), selectedModels }, {
      onSuccess: (settings) => {
        setModelBaseUrl(settings.baseUrl);
        setModelApiKey("");
        void utils.workspace.modelSettings.invalidate();
        toast.success("Provider settings saved");
        afterSave?.();
      },
    });
  }

  function refreshModels() {
    saveProviderSettings(() => discoverModelsMutation.mutate(undefined, {
      onSuccess: ({ models }) => {
        setAvailableModels((current) => Array.from(new Set([...current, ...models])).sort((a, b) => a.localeCompare(b)));
        toast.success(`${models.length} models available`);
      },
    }));
  }

  function toggleModel(model: string) {
    setSelectedModels((current) => current.includes(model) ? current.filter((item) => item !== model) : [...current, model]);
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark"><img src={AXOLOTL_ICON} alt="AXOLOTL" /></div>
          <div><div className="brand-name">NEXUSS-AGENT</div></div>
          <button className="icon-button mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={17} /></button>
        </div>
        <div className="mobile-brand-lockup"><div className="mobile-brand-art"><img src={AXOLOTL_ICON} alt="" /></div><div className="mobile-brand-copy"><strong>NEXUSS-AGENT</strong></div></div>
        <button className="new-thread-button" onClick={createThread} disabled={!workspaceReady || createThreadMutation.isPending}><CirclePlus size={17} /><span>New thread</span></button>
        <div className="sidebar-section thread-section">
          <div className="search-field"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter threads" /></div>
          <div className="thread-list">
            {filteredThreads.map((thread) => (
              <div key={thread.id} className={`thread-item ${thread.id === activeThread?.id ? "active" : ""}`} onClick={() => openThread(thread)}>
                <div className="thread-item-main"><span className="thread-dot" /> <span className="thread-title">{thread.title}</span></div>
                <div className="thread-item-sub"><span className="thread-slug">{thread.chatSlug || `chat-${thread.id.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`}</span><span>{formatDate(thread.updatedAt)}</span><button className="item-more" onClick={(event) => { event.stopPropagation(); setThreadEditor(thread.id); setThreadName(thread.title); }} aria-label="Thread actions"><MoreHorizontal size={15} /></button></div>
              </div>
            ))}
          </div>
        </div>
        <div className="sidebar-section project-section">
          <div className="project-list">
            <div className="sidebar-list-label">Projects</div>
            {navigationQuery.isLoading ? <div className="project-list-skeleton" aria-label="Loading saved projects"><i /><i /><i /></div> : workspace.projects.map((project) => (
              <div className="project-row" key={project.id}>
                <Folder size={15} /><div className="project-row-copy"><span>{project.name}</span><small>{project.description}</small></div><button className="item-more" onClick={() => setProjectEditor({ mode: "edit", project })} aria-label={`Edit ${project.name}`}><MoreHorizontal size={15} /></button>
              </div>
            ))}
            <button className="add-project" onClick={() => setProjectEditor({ mode: "create" })} disabled={!workspaceReady}><FolderPlus size={15} /> Add project</button>
          </div>
        </div>
        <div className="sidebar-footer"><div className="profile-row"><div className="profile-avatar">{profileAvatar ? <img src={profileAvatar} alt="" referrerPolicy="no-referrer" onError={() => setAvatarFailed(true)} /> : profileInitials}</div><div className="profile-copy"><strong>{profileName}</strong>{profileEmail && <span>{profileEmail}</span>}</div>{onSignOut && <button className="profile-signout" onClick={onSignOut} disabled={signOutPending} aria-label="Sign out"><LogOut size={16} /></button>}</div></div>
      </aside>

      <main className="main-stage">
        <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={19} /></button><div className="topbar-thread-copy"><div className="topbar-thread-title">{activeThread?.title || "New thread"}</div>{activeThreadSlug && <span className="topbar-thread-slug">{activeThreadSlug}</span>}</div></div><div className="topbar-right"><button className="icon-button settings-trigger" onClick={() => setSettingsOpen(true)} aria-label="Open settings" aria-haspopup="dialog" aria-expanded={settingsOpen}><Settings size={16} /></button></div></header>
        <div className="mobile-context-strip"><button className="mobile-context-button" onClick={() => setMobileNav(true)}><Menu size={15} /><span>Threads</span></button><div className="mobile-context-title"><strong>{activeThread?.title || "New thread"}</strong></div><button className="mobile-context-button" onClick={createThread} disabled={!workspaceReady || createThreadMutation.isPending}><Plus size={15} /><span>New</span></button></div><section className="conversation-area">
          <div className="conversation-heading">{activeThread && <div className="heading-actions"><button className="icon-button" onClick={() => { setThreadEditor(activeThread.id); setThreadName(activeThread.title); }} aria-label="Rename thread"><Pencil size={16} /></button><button className="icon-button danger-hover" onClick={() => deleteThread(activeThread.id)} aria-label="Delete thread"><Trash2 size={16} /></button></div>}</div>
          {navigationQuery.isError || activeChatQuery.isError ? <div className="empty-thread"><div className="empty-brand-mark"><img src={AXOLOTL_ICON} alt="" /></div><h2>Workspace unavailable.</h2><p>Your saved data is unchanged. Check your connection and try again.</p><button className="empty-create-button" onClick={() => { void navigationQuery.refetch(); if (routeChatSlug) void activeChatQuery.refetch(); }}><ArrowUp size={14} /> Retry loading</button></div> : !workspaceReady || migration.isPending ? <AxolotlLoader label="LOADING YOUR WORKSPACE" /> : activeThread?.messages.length || responsePending ? <div className="message-stack">{activeThread?.messages.map((message, index) => <article className={`message ${message.role}`} key={message.id}><div className="message-meta"><span className={`role-mark ${message.role}`}>{message.role === "assistant" ? <img src={AXOLOTL_ICON} alt="" /> : "You"}</span><span>{message.role === "assistant" ? "Nexuss-Agent" : "You"}</span><span className="message-time">{formatDate(message.createdAt)}</span>{message.role === "assistant" && <button className="copy-button" onClick={() => { navigator.clipboard?.writeText(message.content); toast.success("Copied to clipboard"); }}><Copy size={13} /> Copy</button>}</div><div className="message-content"><MarkdownMessage content={message.content} /></div>{index < (activeThread?.messages.length || 0) - 1 && <div className="message-divider" />}</article>)}{responsePending && <ResponseSkeleton />}</div> : <div className="empty-thread"><div className="orbit-art axolotl-schematic" aria-hidden="true"><span className="axolotl-loop" /><span className="axolotl-eye axolotl-eye-one" /><span className="axolotl-eye axolotl-eye-two" /><span className="axolotl-gill axolotl-gill-one" /><span className="axolotl-gill axolotl-gill-two" /></div><div className="empty-brand-mark"><img src={AXOLOTL_ICON} alt="" /></div><h2>Start a thread.</h2><p>Give your work a place to begin.</p><button className="empty-create-button" onClick={createThread} disabled={createThreadMutation.isPending}><Plus size={14} /> New thread <ArrowUp size={13} /></button></div>}
        </section>
        <div className="composer-wrap"><div className="composer" onClick={() => composerRef.current?.focus()}><div className="composer-top"><button className="composer-plus" onClick={(event) => { event.stopPropagation(); toast("Attachments are coming soon"); }} aria-label="Add context"><Plus size={16} /></button><div className="composer-actions"><button className="project-picker" onClick={(event) => { event.stopPropagation(); setProjectMenuOpen(!projectMenuOpen); }} disabled={!workspaceReady || workspace.projects.length === 0}><Folder size={14} /> {activeProject?.name || workspace.projects.find((project) => project.id === pendingProjectId)?.name || "Assign project"}<ChevronDown size={13} /></button>{projectMenuOpen && <div className="project-menu"><button onClick={() => { if (activeThread) assignThreadProjectMutation.mutate({ id: activeThread.id, projectId: null }); else setPendingProjectId(null); setProjectMenuOpen(false); }}>No project</button>{workspace.projects.map((project) => <button key={project.id} onClick={() => { if (activeThread) assignThreadProjectMutation.mutate({ id: activeThread.id, projectId: project.id }); else setPendingProjectId(project.id); setProjectMenuOpen(false); }}><Folder size={14} />{project.name}{project.id === (activeThread?.projectId || pendingProjectId) && <Check size={13} />}</button>)}</div>}</div></div><textarea ref={composerRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleComposerKey} placeholder="Write your message…" rows={2} disabled={!workspaceReady || appendMessagesMutation.isPending || createThreadMutation.isPending} /><div className="composer-bottom"><button className="send-button" onClick={() => void sendMessage()} disabled={!workspaceReady || !draft.trim() || appendMessagesMutation.isPending || createThreadMutation.isPending} aria-label="Send message"><ArrowUp size={17} /></button></div></div></div><div className="mobile-bottom-bar"><button onClick={() => setMobileNav(true)}><Menu size={16} /><span>Threads</span></button><button onClick={() => setProjectMenuOpen(!projectMenuOpen)} disabled={!workspaceReady || workspace.projects.length === 0}><Folder size={16} /><span>{activeProject?.name || workspace.projects.find((project) => project.id === pendingProjectId)?.name || "Project"}</span></button><button onClick={() => composerRef.current?.focus()} disabled={!workspaceReady}><ArrowUp size={16} /><span>Write</span></button></div>
      </main>

      {threadEditor && <div className="modal-backdrop" onMouseDown={() => setThreadEditor(null)}><div className="small-modal" onMouseDown={(event) => event.stopPropagation()}><h3>Rename thread</h3><input autoFocus value={threadName} onChange={(event) => setThreadName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submitThreadName()} /><div className="modal-actions"><button className="text-button" onClick={() => setThreadEditor(null)}>Cancel</button><button className="primary-button" onClick={submitThreadName}>Save name</button></div></div></div>}
      {projectEditor && <div className="modal-backdrop" onMouseDown={() => setProjectEditor(null)}><form className="small-modal" onSubmit={saveProject} onMouseDown={(event) => event.stopPropagation()}><h3>{projectEditor.mode === "edit" ? "Edit project" : "New project"}</h3><label>Name<input name="name" defaultValue={projectEditor.project?.name || ""} autoFocus placeholder="e.g. Product systems" /></label><label>Description<input name="description" defaultValue={projectEditor.project?.description || ""} placeholder="What belongs here?" /></label><div className="modal-actions">{projectEditor.mode === "edit" && projectEditor.project && <button type="button" className="delete-project" onClick={() => { deleteProject(projectEditor.project!.id); setProjectEditor(null); }}><Trash2 size={14} /> Delete</button>}<span className="modal-spacer" /><button type="button" className="text-button" onClick={() => setProjectEditor(null)}>Cancel</button><button className="primary-button" type="submit">{projectEditor.mode === "edit" ? "Save changes" : "Create project"}</button></div></form></div>}
      {settingsOpen && <div className="modal-backdrop settings-backdrop" onMouseDown={() => setSettingsOpen(false)}>
        <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-settings-title" onMouseDown={(event) => event.stopPropagation()}>
          <header className="settings-modal-header"><div><span className="modal-eyebrow">Account & models</span><h2 id="workspace-settings-title">Settings</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close settings" autoFocus><X size={17} /></button></header>
          <div className="settings-scroll-body">
            <div className="settings-account"><div className="settings-profile-avatar">{profileAvatar ? <img src={profileAvatar} alt="" referrerPolicy="no-referrer" onError={() => setAvatarFailed(true)} /> : profileInitials}</div><div><strong>{profileName}</strong>{profileEmail && <span>{profileEmail}</span>}<small>Model preferences stay with this account</small></div></div>
            <div className="settings-section model-provider-section">
              <div className="settings-section-label">Model provider</div>
              <label className="settings-field">Base model API<input value={modelBaseUrl} onChange={(event) => setModelBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" autoComplete="url" aria-label="Base model API" /></label>
              <label className="settings-field">API key<input type="password" value={modelApiKey} onChange={(event) => setModelApiKey(event.target.value)} placeholder={modelSettingsQuery.data?.apiKeyConfigured ? "Saved securely — enter a new key to replace it" : "Paste provider API key"} autoComplete="off" aria-label="Model provider API key" /></label>
              <p className="settings-field-hint">Use an OpenAI-compatible public HTTPS endpoint. Your key is saved encrypted and never shown again.</p>
              <div className="model-provider-actions"><button className="primary-button" onClick={() => saveProviderSettings()} disabled={saveModelSettingsMutation.isPending}>{saveModelSettingsMutation.isPending ? "Saving…" : "Save provider"}</button><button className="model-refresh-button" onClick={refreshModels} disabled={saveModelSettingsMutation.isPending || discoverModelsMutation.isPending}>{discoverModelsMutation.isPending ? "Refreshing…" : "Refresh models"}</button></div>
            </div>
            <div className="settings-section model-selection-section">
              <div className="model-selection-heading"><div><div className="settings-section-label">Available models</div><span>Select every model you want ready in this workspace.</span></div><b>{selectedModels.length} selected</b></div>
              <div className="model-selection-toolbar"><button className="text-button" onClick={() => setSelectedModels(availableModels)} disabled={!availableModels.length}>Select all</button><button className="text-button" onClick={() => setSelectedModels([])} disabled={!selectedModels.length}>Clear selection</button></div>
              {modelSettingsQuery.isLoading ? <div className="model-list-loading" role="status">Loading saved model preferences…</div> : availableModels.length ? <div className="model-list" role="listbox" aria-label="Available models" aria-multiselectable="true">{availableModels.map((model) => <button key={model} className={`model-choice ${selectedModels.includes(model) ? "selected" : ""}`} onClick={() => toggleModel(model)} aria-pressed={selectedModels.includes(model)}><span>{model}</span>{selectedModels.includes(model) && <Check size={14} />}</button>)}</div> : <div className="model-list-empty">Save your provider, then refresh to load the models it makes available.</div>}
            </div>
          </div>
          <footer className="settings-footer"><button className="text-button" onClick={() => setSettingsOpen(false)}>Done</button>{onSignOut && <button className="settings-signout" onClick={onSignOut} disabled={signOutPending}><LogOut size={15} /> {signOutPending ? "Signing out…" : "Sign out"}</button>}</footer>
        </section>
      </div>}
    </div>
  );
}
