import { useAuth } from "@/_core/hooks/useAuth";
import { MarkdownMessage } from "@/components/MarkdownMessage";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { getGoogleSignInUrl } from "@/lib/nexussAuth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Clock3,
  Command,
  Folder,
  FolderPlus,
  Loader2,
  LogOut,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  PanelRight,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

type Project = { id: number; name: string; description: string | null; color: string; createdAt: Date; updatedAt: Date; userId: number };
type ThreadSummary = {
  id: number; userId: number; projectId: number | null; title: string; createdAt: Date; updatedAt: Date;
  project: Pick<Project, "id" | "name" | "color"> | null;
  latestMessage: { content: string; role: "user" | "assistant"; createdAt: Date } | null;
};
type ChatMessage = { id: number | string; role: "user" | "assistant"; content: string; createdAt: Date };
type ProjectDialogState = { open: boolean; project?: Project };
type ThreadDialogState = { open: boolean; thread?: ThreadSummary };
type DeleteTarget = { type: "thread" | "project"; id: number; name: string };

const PROJECT_COLORS = ["#00FF88", "#3B82F6", "#A78BFA", "#F59E0B", "#F472B6"];
const SUGGESTIONS = ["Frame a product strategy", "Explain a technical concept", "Draft a crisp project brief"];

function compactDate(value?: Date) {
  if (!value) return "Just now";
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function initials(name?: string | null) {
  return name?.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase() || "NX";
}

function messageSnippet(message: ThreadSummary["latestMessage"]) {
  if (!message) return "No messages yet";
  return message.content.replace(/\s+/g, " ").slice(0, 54) || "No messages yet";
}

function streamEventBuffer(buffer: string, onEvent: (event: string, data: Record<string, unknown>) => void) {
  const chunks = buffer.split(/\r?\n\r?\n/);
  const rest = chunks.pop() ?? "";
  chunks.forEach(chunk => {
    const event = chunk.match(/^event:\s*(.+)$/m)?.[1] || "message";
    const dataLine = chunk.split(/\r?\n/).find(line => line.startsWith("data:"));
    if (!dataLine) return;
    try { onEvent(event, JSON.parse(dataLine.replace(/^data:\s?/, ""))); } catch { /* ignore malformed provider frame */ }
  });
  return rest;
}

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const utils = trpc.useUtils();
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [composer, setComposer] = useState("");
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [projectDialog, setProjectDialog] = useState<ProjectDialogState>({ open: false });
  const [threadDialog, setThreadDialog] = useState<ThreadDialogState>({ open: false });
  const [threadTitle, setThreadTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectColor, setProjectColor] = useState(PROJECT_COLORS[0]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const bootstrapQuery = trpc.playground.bootstrap.useQuery(undefined, { enabled: Boolean(isAuthenticated) });
  const bootstrap = bootstrapQuery.data as { projects: Project[]; threads: ThreadSummary[] } | undefined;
  const projects = bootstrap?.projects ?? [];
  const threads = bootstrap?.threads ?? [];
  const activeThread = threads.find(thread => thread.id === activeThreadId) ?? null;
  const messagesQuery = trpc.playground.threads.messages.useQuery({ id: activeThreadId ?? -1 }, { enabled: Boolean(activeThread && isAuthenticated) });
  const persistedMessages = (messagesQuery.data as ChatMessage[] | undefined) ?? [];
  const displayMessages = useMemo(() => [...persistedMessages, ...optimisticMessages], [persistedMessages, optimisticMessages]);
  const activeProject = activeThread?.project ?? null;
  const tokenEstimate = Math.ceil(composer.trim().length / 4);
  useEffect(() => {
    if (!activeThreadId && threads.length) setActiveThreadId(threads[0].id);
  }, [activeThreadId, threads]);

  useEffect(() => {
    setOptimisticMessages([]);
  }, [activeThreadId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nexussAuthResult = params.get("nex_auth");
    if (!nexussAuthResult) return;
    setAuthNotice(
      nexussAuthResult === "success"
        ? "Google sign-in completed. Workspace access will activate after the same-site auth domain is configured."
        : "Google sign-in was cancelled. You can try again whenever you are ready.",
    );
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const refresh = async () => {
    await utils.playground.bootstrap.invalidate();
  };

  const createThread = trpc.playground.threads.create.useMutation({
    onSuccess: async thread => { await refresh(); setActiveThreadId(thread.id); },
    onError: () => toast.error("Unable to create a new thread."),
  });
  const renameThread = trpc.playground.threads.rename.useMutation({ onSuccess: async () => { setThreadDialog({ open: false }); await refresh(); }, onError: () => toast.error("Unable to rename that thread.") });
  const deleteThread = trpc.playground.threads.delete.useMutation({
    onSuccess: async () => { await refresh(); setActiveThreadId(null); },
    onError: () => toast.error("Unable to delete that thread."),
  });
  const setThreadProject = trpc.playground.threads.setProject.useMutation({ onSuccess: refresh, onError: () => toast.error("Unable to update the project.") });
  const createProject = trpc.playground.projects.create.useMutation({ onSuccess: async () => { setProjectDialog({ open: false }); await refresh(); }, onError: () => toast.error("Unable to create the project.") });
  const updateProject = trpc.playground.projects.update.useMutation({ onSuccess: async () => { setProjectDialog({ open: false }); await refresh(); }, onError: () => toast.error("Unable to update the project.") });
  const deleteProject = trpc.playground.projects.delete.useMutation({ onSuccess: refresh, onError: () => toast.error("Unable to delete the project.") });

  const resizeComposer = () => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  };

  const openProjectDialog = (project?: Project) => {
    setProjectDialog({ open: true, project });
    setProjectName(project?.name ?? "");
    setProjectDescription(project?.description ?? "");
    setProjectColor(project?.color ?? PROJECT_COLORS[0]);
  };

  const openThreadRenameDialog = (thread: ThreadSummary) => {
    setThreadDialog({ open: true, thread });
    setThreadTitle(thread.title);
  };

  const saveProject = (event: FormEvent) => {
    event.preventDefault();
    const name = projectName.trim();
    if (!name) return toast.error("Give the project a name first.");
    const payload = { name, description: projectDescription.trim() || null, color: projectColor };
    if (projectDialog.project) updateProject.mutate({ id: projectDialog.project.id, ...payload });
    else createProject.mutate(payload);
  };

  const saveThreadRename = (event: FormEvent) => {
    event.preventDefault();
    const title = threadTitle.trim();
    const thread = threadDialog.thread;
    if (!thread || !title) return toast.error("Give the thread a title first.");
    if (title === thread.title) return setThreadDialog({ open: false });
    renameThread.mutate({ id: thread.id, title });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    if (target.type === "thread") deleteThread.mutate({ id: target.id });
    else deleteProject.mutate({ id: target.id });
  };

  const sendMessage = async () => {
    const content = composer.trim();
    if (!content || !activeThreadId || isStreaming) return;
    const threadId = activeThreadId;
    const userTempId = `local-user-${Date.now()}`;
    const assistantTempId = `local-assistant-${Date.now()}`;
    setComposer("");
    requestAnimationFrame(resizeComposer);
    setOptimisticMessages([
      { id: userTempId, role: "user", content, createdAt: new Date() },
      { id: assistantTempId, role: "assistant", content: "", createdAt: new Date() },
    ]);
    setIsStreaming(true);

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ threadId, content }),
      });
      if (!response.ok || !response.body) throw new Error("Chat request failed");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = streamEventBuffer(buffer, (event, data) => {
          if (event === "delta" && typeof data.text === "string") {
            setOptimisticMessages(current => current.map(message => message.id === assistantTempId ? { ...message, content: message.content + data.text } : message));
          }
          if (event === "error") toast.error(typeof data.message === "string" ? data.message : "The response could not be completed.");
        });
      }
      await Promise.all([utils.playground.threads.messages.invalidate({ id: threadId }), refresh()]);
      setOptimisticMessages([]);
    } catch {
      setOptimisticMessages(current => current.map(message => message.id === assistantTempId ? { ...message, content: "I couldn’t complete that response. Please try again." } : message));
      toast.error("The connection was interrupted.");
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const continueWithGoogle = () => {
    setAuthError(null);
    try {
      window.location.assign(getGoogleSignInUrl());
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "We couldn’t start Google sign-in. Please try again.");
    }
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-[#0A0E1A]"><Loader2 className="size-5 animate-spin text-[#00FF88]" /></div>;

  if (!isAuthenticated || !user) {
    return (
      <main className="landing-shell">
        <div className="landing-grid" />
        <section className="landing-card">
          <div className="brand-mark"><Sparkles className="size-5" /></div>
          <p className="eyebrow">NEXUSS-AGENT</p>
          <h1>Continue your work.</h1>
          <p className="landing-copy">Sign in with Google to continue your conversations, projects, and focused AI work.</p>
          <div className="auth-form">
            {authNotice && <p className="login-note">{authNotice}</p>}
            {authError && <p className="auth-error">{authError}</p>}
            <Button type="button" onClick={continueWithGoogle} className="login-button"><span className="font-bold">G</span>Continue with Google<ArrowUp className="size-4" /></Button>
          </div>
          <p className="login-note">Google sign-in is provided by Nexuss Auth.</p>
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0E1A] text-[#F7FAFC]">
      <div className="app-shell">
        <aside className="left-panel">
          <div className="brand-row">
            <div className="brand-mark"><Sparkles className="size-4" /></div>
            <span className="brand-name">nexuss<span>.</span></span>
            <span className="beta-chip">AGENT</span>
          </div>
          <Button onClick={() => createThread.mutate({})} disabled={createThread.isPending} className="new-thread-button">
            {createThread.isPending ? <Loader2 className="size-4 animate-spin" /> : <MessageSquarePlus className="size-4" />} New thread
          </Button>
          <div className="sidebar-section-label"><span>Threads</span><span>{threads.length}</span></div>
          <ScrollArea className="thread-scroll">
            <div className="space-y-1 pr-2">
              {bootstrapQuery.isLoading && <div className="sidebar-loading">Loading workspace…</div>}
              {threads.map(thread => (
                <div key={thread.id} role="button" tabIndex={0} onClick={() => setActiveThreadId(thread.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActiveThreadId(thread.id); } }} className={cn("thread-item", activeThreadId === thread.id && "thread-item-active")}>
                  <div className="thread-item-top"><span className="thread-title">{thread.title}</span><span className="thread-time">{compactDate(thread.latestMessage?.createdAt ?? thread.updatedAt)}</span></div>
                  <div className="thread-preview">{messageSnippet(thread.latestMessage)}</div>
                  <span className="thread-action" onClick={event => event.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><button aria-label={`Thread options for ${thread.title}`} className="icon-trigger"><MoreHorizontal className="size-3.5" /></button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="dropdown-dark w-36">
                        <DropdownMenuItem onClick={() => openThreadRenameDialog(thread)}><Pencil className="size-3.5" />Rename</DropdownMenuItem>
                        <DropdownMenuItem className="danger-item" onClick={() => setDeleteTarget({ type: "thread", id: thread.id, name: thread.title })}><Trash2 className="size-3.5" />Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </div>
              ))}
              {!bootstrapQuery.isLoading && threads.length === 0 && <div className="sidebar-empty">Start a fresh thread to begin.</div>}
            </div>
          </ScrollArea>
          <div className="projects-heading"><div className="sidebar-section-label"><span>Projects</span><span>{projects.length}</span></div><button onClick={() => openProjectDialog()} className="plus-control" aria-label="Create project"><Plus className="size-4" /></button></div>
          <ScrollArea className="projects-scroll">
            <div className="space-y-0.5 pr-2">
              {projects.map(project => (
                <div key={project.id} className="project-row">
                  <span className="project-dot" style={{ backgroundColor: project.color }} /><span className="project-name">{project.name}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><button className="project-menu" aria-label={`Project options for ${project.name}`}><MoreHorizontal className="size-3.5" /></button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="dropdown-dark w-36">
                      <DropdownMenuItem onClick={() => openProjectDialog(project)}><Pencil className="size-3.5" />Edit</DropdownMenuItem>
                      <DropdownMenuItem className="danger-item" onClick={() => setDeleteTarget({ type: "project", id: project.id, name: project.name })}><Trash2 className="size-3.5" />Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
              {projects.length === 0 && <button onClick={() => openProjectDialog()} className="create-project-empty"><FolderPlus className="size-3.5" />Create your first project</button>}
            </div>
          </ScrollArea>
          <div className="sidebar-account">
            <Avatar className="account-avatar"><AvatarFallback>{initials(user.name)}</AvatarFallback></Avatar>
            <div className="min-w-0 flex-1"><div className="account-name">{user.name || "Nexuss user"}</div><div className="account-subtitle">Workspace account</div></div>
            <button onClick={logout} className="account-logout" title="Sign out"><X className="size-3.5" /></button>
          </div>
        </aside>

        <main className="chat-panel">
          <header className="chat-header">
            <div className="min-w-0"><div className="chat-kicker">AI WORKSPACE</div><h2>{activeThread?.title ?? "Untitled workspace"}</h2></div>
            <div className="header-actions">
              {activeProject ? <span className="active-project-badge"><span style={{ background: activeProject.color }} />{activeProject.name}</span> : <span className="status-badge">No project</span>}
              <span className="model-badge"><span />Nexuss core</span>
            </div>
          </header>
          <section className="chat-body">
            {!activeThread ? (
              <div className="welcome-state">
                <div className="welcome-orb"><Sparkles className="size-7" /></div>
                <p className="eyebrow">NEXUSS-AGENT</p>
                <h1>A quieter place to reason.</h1>
                <p>Create a thread, attach a project when context matters, then let the work unfold.</p>
                <Button onClick={() => createThread.mutate({})} className="new-thread-button"><MessageSquarePlus className="size-4" />Create a thread</Button>
              </div>
            ) : (
              <ScrollArea className="message-scroll">
                <div className="messages-wrap">
                  {displayMessages.length === 0 ? (
                    <div className="conversation-empty">
                      <div className="assistant-avatar"><Bot className="size-4" /></div>
                      <div><h3>Ready when you are.</h3><p>Nexuss has no connected tools yet. Use this space to think, draft, explore, and refine.</p></div>
                      <div className="suggestion-grid">{SUGGESTIONS.map(prompt => <button key={prompt} onClick={() => setComposer(prompt)}>{prompt}<ArrowUp className="size-3.5" /></button>)}</div>
                    </div>
                  ) : displayMessages.map((message, index) => (
                    <article key={message.id} className={cn("message-row", message.role === "user" ? "message-user" : "message-assistant")}>
                      {message.role === "assistant" && <div className="assistant-avatar"><Bot className="size-4" /></div>}
                      <div className={cn("message-content", message.role === "user" ? "user-message-content" : "assistant-message-content")}>
                        <div className="message-meta">{message.role === "user" ? "You" : "Nexuss"}<span>•</span>{compactDate(message.createdAt)}</div>
                        {message.role === "assistant" ? message.content ? <MarkdownMessage content={message.content} /> : (isStreaming && index === displayMessages.length - 1 ? <div className="typing-indicator"><i /><i /><i /></div> : null) : <p>{message.content}</p>}
                      </div>
                      {message.role === "user" && <div className="user-avatar"><UserRound className="size-3.5" /></div>}
                    </article>
                  ))}
                </div>
              </ScrollArea>
            )}
          </section>
          <footer className="composer-zone">
            <div className="composer-shell">
              <div className="composer-topline">
                <Popover>
                  <PopoverTrigger asChild><button disabled={!activeThread || setThreadProject.isPending} className="composer-project-control"><Folder className="size-3.5" />{activeProject?.name ?? "Attach project"}<ChevronDown className="size-3" /></button></PopoverTrigger>
                  <PopoverContent align="start" side="top" className="project-popover">
                    <p>Thread project</p>
                    <button className={cn("project-select-option", !activeProject && "project-select-active")} onClick={() => activeThread && setThreadProject.mutate({ id: activeThread.id, projectId: null })}><span className="project-dot muted-dot" />No project{!activeProject && <Check className="size-3.5" />}</button>
                    {projects.map(project => <button key={project.id} className={cn("project-select-option", activeProject?.id === project.id && "project-select-active")} onClick={() => activeThread && setThreadProject.mutate({ id: activeThread.id, projectId: project.id })}><span className="project-dot" style={{ background: project.color }} />{project.name}{activeProject?.id === project.id && <Check className="size-3.5" />}</button>)}
                    <button className="new-project-option" onClick={() => openProjectDialog()}><Plus className="size-3.5" />New project</button>
                  </PopoverContent>
                </Popover>
                <span>{composer.length.toLocaleString()} chars <span className="token-separator">·</span> ~{tokenEstimate.toLocaleString()} tokens</span>
              </div>
              <Textarea ref={textareaRef} disabled={!activeThread || isStreaming} value={composer} onChange={event => { setComposer(event.target.value); requestAnimationFrame(resizeComposer); }} onKeyDown={handleKeyDown} placeholder={activeThread ? "Ask Nexuss anything…" : "Create a thread to begin"} rows={1} className="composer-input" />
              <div className="composer-footer"><span><Command className="size-3" /> Enter to send</span><button onClick={() => void sendMessage()} disabled={!composer.trim() || !activeThread || isStreaming} className="send-button" aria-label="Send message">{isStreaming ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}</button></div>
            </div>
          </footer>
        </main>

        <aside className="right-panel">
          <div className="context-header"><div><p>CONTEXT</p><h2>Thread briefing</h2></div><div className="context-header-actions"><PanelRight className="size-4 text-[#78849B]" /><button onClick={logout} className="context-logout" title="Sign out"><LogOut className="size-3.5" /><span>Sign out</span></button></div></div>
          <div className="context-card project-context-card">
            <div className="context-icon" style={{ background: `${activeProject?.color ?? "#1E40AF"}22`, color: activeProject?.color ?? "#6EA8FE" }}><Folder className="size-4" /></div>
            <div className="context-card-main"><p>PROJECT</p><h3>{activeProject?.name ?? "No project attached"}</h3><span>{activeProject ? "Workspace context is active" : "Attach one from the composer"}</span></div>
          </div>
          {activeProject?.id && <button onClick={() => { const project = projects.find(item => item.id === activeProject.id); if (project) openProjectDialog(project); }} className="edit-project-link"><Pencil className="size-3.5" />Edit project context</button>}
          <div className="context-divider" />
          <div className="context-section"><p className="context-label">THREAD DETAILS</p><div className="detail-row"><Clock3 className="size-3.5" /><span>Updated</span><b>{compactDate(activeThread?.updatedAt)}</b></div><div className="detail-row"><MessageSquare className="size-3.5" /><span>Messages</span><b>{displayMessages.length}</b></div></div>
          <div className="context-divider" />
          <div className="context-section agent-note"><p className="context-label">AGENT MODE</p><div><Sparkles className="size-4" /><span>Tools are disabled</span></div><p>Nexuss is in focused chat mode. Projects are included as lightweight conversation context.</p></div>
        </aside>
      </div>

      <Dialog open={projectDialog.open} onOpenChange={open => setProjectDialog(current => ({ ...current, open }))}>
        <DialogContent className="project-dialog">
          <DialogHeader><DialogTitle>{projectDialog.project ? "Edit project" : "Create a project"}</DialogTitle><DialogDescription>Give the workspace a purpose and a signal colour.</DialogDescription></DialogHeader>
          <form onSubmit={saveProject} className="space-y-4"><div className="form-field"><label htmlFor="project-name">Name</label><Input id="project-name" value={projectName} onChange={event => setProjectName(event.target.value)} placeholder="e.g. Horizon redesign" autoFocus /></div><div className="form-field"><label htmlFor="project-description">Description <span>Optional</span></label><Textarea id="project-description" value={projectDescription} onChange={event => setProjectDescription(event.target.value)} placeholder="What should this project help you achieve?" /></div><div className="form-field"><label>Colour tag</label><div className="colour-picker">{PROJECT_COLORS.map(color => <button key={color} type="button" onClick={() => setProjectColor(color)} className={cn("colour-swatch", projectColor === color && "colour-swatch-active")} style={{ background: color }} aria-label={`Use ${color}`}><Check className="size-3" /></button>)}</div></div><DialogFooter><Button type="button" variant="ghost" onClick={() => setProjectDialog({ open: false })}>Cancel</Button><Button type="submit" className="dialog-save" disabled={createProject.isPending || updateProject.isPending}>{createProject.isPending || updateProject.isPending ? <Loader2 className="size-4 animate-spin" /> : null}{projectDialog.project ? "Save changes" : "Create project"}</Button></DialogFooter></form>
        </DialogContent>
      </Dialog>
      <Dialog open={threadDialog.open} onOpenChange={open => setThreadDialog(current => ({ ...current, open }))}>
        <DialogContent className="project-dialog">
          <DialogHeader><DialogTitle>Rename thread</DialogTitle><DialogDescription>Choose a concise name that makes the conversation easy to find.</DialogDescription></DialogHeader>
          <form onSubmit={saveThreadRename} className="space-y-4"><div className="form-field"><label htmlFor="thread-title">Thread title</label><Input id="thread-title" value={threadTitle} onChange={event => setThreadTitle(event.target.value)} placeholder="Thread title" autoFocus maxLength={160} /></div><DialogFooter><Button type="button" variant="ghost" onClick={() => setThreadDialog({ open: false })}>Cancel</Button><Button type="submit" className="dialog-save" disabled={renameThread.isPending}>{renameThread.isPending ? <Loader2 className="size-4 animate-spin" /> : null}Save title</Button></DialogFooter></form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="project-dialog">
          <AlertDialogHeader><AlertDialogTitle>Delete {deleteTarget?.type === "project" ? "project" : "thread"}?</AlertDialogTitle><AlertDialogDescription>{deleteTarget?.type === "project" ? `“${deleteTarget.name}” will be removed. Its threads will stay in your workspace without a project attachment.` : `“${deleteTarget?.name}” and all of its messages will be permanently removed.`}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={confirmDelete} className="delete-confirm">Delete {deleteTarget?.type === "project" ? "project" : "thread"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
