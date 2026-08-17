// Design philosophy: Obsidian Console — Swiss precision, monochrome hierarchy, quiet depth.
// Design philosophy: Obsidian Console — offset technical workbench, AXOLOTL glyph geometry, and compact systems metadata.
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import "katex/dist/katex.min.css";
import {
  Archive,
  ArrowUp,
  Check,
  ChevronDown,
  CirclePlus,
  Command,
  Copy,
  Folder,
  FolderPlus,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

const AXOLOTL_ICON = "/manus-storage/nexuss-agent-axolotl-geometric-mark_f64d61a2.png";

type Project = { id: string; name: string; description: string; tone: string };
type Message = { id: string; role: "user" | "assistant"; content: string; createdAt: string };
type Thread = { id: string; title: string; projectId?: string; updatedAt: string; messages: Message[] };

type Workspace = { projects: Project[]; threads: Thread[]; activeThreadId: string };

const now = new Date().toISOString();
const seed: Workspace = {
  projects: [],
  activeThreadId: '',
  threads: [],
};

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
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

export default function Home() {
  const [workspace, setWorkspace] = useState<Workspace>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("nexuss-agent-workspace-v2") || "null") as Workspace | null;
      if (!stored) return seed;
      return stored;
    } catch { return seed; }
  });
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectEditor, setProjectEditor] = useState<{ mode: "create" | "edit"; project?: Project } | null>(null);
  const [threadEditor, setThreadEditor] = useState<string | null>(null);
  const [threadName, setThreadName] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { localStorage.setItem("nexuss-agent-workspace-v2", JSON.stringify(workspace)); }, [workspace]);

  const activeThread = workspace.threads.find((thread) => thread.id === workspace.activeThreadId) || workspace.threads[0];
  const activeProject = workspace.projects.find((project) => project.id === activeThread?.projectId);
  const filteredThreads = useMemo(() => workspace.threads.filter((thread) => thread.title.toLowerCase().includes(query.toLowerCase())), [workspace.threads, query]);

  function patchThread(id: string, patch: Partial<Thread>) {
    setWorkspace((current) => ({ ...current, threads: current.threads.map((thread) => thread.id === id ? { ...thread, ...patch, updatedAt: new Date().toISOString() } : thread) }));
  }

  function createThread() {
    const thread: Thread = { id: uid("thread"), title: "Untitled exploration", updatedAt: new Date().toISOString(), messages: [] };
    setWorkspace((current) => ({ ...current, threads: [thread, ...current.threads], activeThreadId: thread.id }));
    setMobileNav(false);
    toast.success("New thread created");
  }

  function deleteThread(id: string) {
    if (workspace.threads.length === 1) return toast.error("Keep at least one thread in the workspace");
    const remaining = workspace.threads.filter((thread) => thread.id !== id);
    setWorkspace((current) => ({ ...current, threads: remaining, activeThreadId: current.activeThreadId === id ? remaining[0].id : current.activeThreadId }));
    toast.success("Thread deleted");
  }

  function submitThreadName() {
    if (!threadEditor || !threadName.trim()) return setThreadEditor(null);
    patchThread(threadEditor, { title: threadName.trim() });
    setThreadEditor(null);
  }

  function saveProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const description = String(form.get("description") || "").trim();
    if (!name) return;
    if (projectEditor?.mode === "edit" && projectEditor.project) {
      setWorkspace((current) => ({ ...current, projects: current.projects.map((project) => project.id === projectEditor.project?.id ? { ...project, name, description } : project) }));
      toast.success("Project updated");
    } else {
      const project = { id: uid("project"), name, description, tone: "#f4f4f0" };
      setWorkspace((current) => ({ ...current, projects: [...current.projects, project] }));
      toast.success("Project created");
    }
    setProjectEditor(null);
  }

  function deleteProject(id: string) {
    setWorkspace((current) => ({ ...current, projects: current.projects.filter((project) => project.id !== id), threads: current.threads.map((thread) => thread.projectId === id ? { ...thread, projectId: undefined } : thread) }));
    toast.success("Project removed; threads are still safe");
  }

  function sendMessage() {
    const content = draft.trim();
    if (!content || !activeThread) return;
    const userMessage: Message = { id: uid("message"), role: "user", content, createdAt: new Date().toISOString() };
    const assistantMessage: Message = { id: uid("message"), role: "assistant", content: "I’m ready for the next layer of thinking. Tools are intentionally offline in this build, but your thread and project context are persisted locally.", createdAt: new Date().toISOString() };
    patchThread(activeThread.id, { messages: [...activeThread.messages, userMessage, assistantMessage], title: activeThread.messages.length === 0 ? content.slice(0, 42) : activeThread.title });
    setDraft("");
  }

  function handleComposerKey(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); }
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark"><img src={AXOLOTL_ICON} alt="AXOLOTL" /></div>
          <div><div className="brand-name">NEXUSS-AGENT</div><div className="brand-meta">AGENT RUNTIME <span>LOCAL</span></div></div>
          <button className="icon-button mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={17} /></button>
        </div>
        <div className="mobile-brand-lockup"><div className="mobile-brand-art"><img src={AXOLOTL_ICON} alt="" /></div><div className="mobile-brand-copy"><strong>NEXUSS-AGENT</strong><span>AXOLOTL / WORKSPACE</span></div></div>
        <button className="new-thread-button" onClick={createThread}><CirclePlus size={17} /><span>New thread</span><kbd>⌘ K</kbd></button>
        <div className="sidebar-section thread-section">
          <div className="section-label"><span>Conversations</span><span className="count">{workspace.threads.length.toString().padStart(2, "0")}</span></div>
          <div className="search-field"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter threads" /></div>
          <div className="thread-list">
            {filteredThreads.map((thread) => (
              <div key={thread.id} className={`thread-item ${thread.id === activeThread?.id ? "active" : ""}`} onClick={() => { setWorkspace((current) => ({ ...current, activeThreadId: thread.id })); setMobileNav(false); }}>
                <div className="thread-item-main"><span className="thread-dot" /> <span className="thread-title">{thread.title}</span></div>
                <div className="thread-item-sub"><span>{formatDate(thread.updatedAt)}</span><button className="item-more" onClick={(event) => { event.stopPropagation(); setThreadEditor(thread.id); setThreadName(thread.title); }} aria-label="Thread actions"><MoreHorizontal size={15} /></button></div>
              </div>
            ))}
          </div>
        </div>
        <div className="sidebar-section project-section">
          <div className="section-label"><span>Projects</span><button className="section-action" onClick={() => setProjectEditor({ mode: "create" })}><Plus size={14} /></button></div>
          <div className="project-list">
            {workspace.projects.map((project) => (
              <div className="project-row" key={project.id}>
                <Folder size={15} /><div className="project-row-copy"><span>{project.name}</span><small>{project.description}</small></div><button className="item-more" onClick={() => setProjectEditor({ mode: "edit", project })} aria-label={`Edit ${project.name}`}><MoreHorizontal size={15} /></button>
              </div>
            ))}
            <button className="add-project" onClick={() => setProjectEditor({ mode: "create" })}><FolderPlus size={15} /> Add project</button>
          </div>
        </div>
        <div className="sidebar-footer"><button className="footer-action" onClick={() => toast("Preferences are available in the next workspace release") }><Settings2 size={15} /> Preferences <span>⌘ ,</span></button><div className="profile-row"><div className="profile-avatar">NA</div><div className="profile-copy"><strong>Nexuss Operator</strong><span>Local workspace</span></div><MoreHorizontal size={15} /></div></div>
      </aside>

      <main className="main-stage">
        <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={19} /></button><div className="breadcrumb"><span>Workspace</span><ChevronDown size={14} /><span className="breadcrumb-muted">{activeProject?.name || "Project / None"}</span></div><div className="topbar-thread-title">{activeThread?.title || "New thread"}</div></div><div className="topbar-right"><span className="mode-label">STEALTH MODE</span><span className="topbar-rule" /><button className="icon-button" onClick={() => toast("Command palette coming soon")} aria-label="Command palette"><Command size={17} /></button><div className="avatar">NA</div></div></header>
        <div className="mobile-context-strip"><button className="mobile-context-button" onClick={() => setMobileNav(true)}><Menu size={15} /><span>Conversations</span><b>{workspace.threads.length.toString().padStart(2, "0")}</b></button><div className="mobile-context-title"><span>CURRENT THREAD</span><strong>{activeThread?.title || "Ready for input"}</strong></div><button className="mobile-context-button" onClick={createThread}><Plus size={15} /><span>New</span></button></div><section className="conversation-area">
          <div className="conversation-heading">{activeThread && <div className="heading-actions"><button className="icon-button" onClick={() => { setThreadEditor(activeThread.id); setThreadName(activeThread.title); }} aria-label="Rename thread"><Pencil size={16} /></button><button className="icon-button danger-hover" onClick={() => deleteThread(activeThread.id)} aria-label="Delete thread"><Trash2 size={16} /></button></div>}</div>
          {activeThread?.messages.length ? <div className="message-stack">{activeThread.messages.map((message, index) => <article className={`message ${message.role}`} key={message.id}><div className="message-meta"><span className={`role-mark ${message.role}`}>{message.role === "assistant" ? <img src={AXOLOTL_ICON} alt="" /> : "YOU"}</span><span>{message.role === "assistant" ? "NEXUSS-AGENT" : "YOU"}</span><span className="message-time">{formatDate(message.createdAt)}</span>{message.role === "assistant" && <button className="copy-button" onClick={() => { navigator.clipboard?.writeText(message.content); toast.success("Copied to clipboard"); }}><Copy size={13} /> Copy</button>}</div><div className="message-content"><MarkdownMessage content={message.content} /></div>{index < activeThread.messages.length - 1 && <div className="message-divider" />}</article>)}</div> : <div className="empty-thread"><div className="orbit-art axolotl-schematic" aria-hidden="true"><span className="axolotl-loop" /><span className="axolotl-eye axolotl-eye-one" /><span className="axolotl-eye axolotl-eye-two" /><span className="axolotl-gill axolotl-gill-one" /><span className="axolotl-gill axolotl-gill-two" /></div><div className="empty-thread-topline"><div className="empty-index">SYSTEM / STANDBY</div><div className="empty-thread-readout"><span>THREAD INDEX</span><strong>00 / OPEN</strong></div></div><div className="empty-brand-mark"><img src={AXOLOTL_ICON} alt="" /></div><h2>Open a working thread.</h2><p>A blank workbench for structured thinking. Create a thread to begin shaping the system.</p><button className="empty-create-button" onClick={createThread}><Plus size={14} /> Create your first thread <ArrowUp size={13} /></button><div className="empty-thread-bottomline"><span>AXOLOTL / RUNTIME</span><span>LOCAL PERSISTENCE / ACTIVE</span></div></div>}
        </section>
        <div className="composer-wrap"><div className="composer" onClick={() => composerRef.current?.focus()}><div className="composer-top"><button className="composer-plus" onClick={(event) => { event.stopPropagation(); toast("Attachments are coming soon"); }} aria-label="Add context"><Plus size={16} /></button><span className="composer-label">PROMPT / {activeProject?.name || "NO PROJECT"}</span><div className="composer-actions"><button className="project-picker" onClick={(event) => { event.stopPropagation(); setProjectMenuOpen(!projectMenuOpen); }}><Folder size={14} /> {activeProject?.name || "Assign project"}<ChevronDown size={13} /></button>{projectMenuOpen && <div className="project-menu"><button onClick={() => { if (activeThread) patchThread(activeThread.id, { projectId: undefined }); setProjectMenuOpen(false); }}>No project</button>{workspace.projects.map((project) => <button key={project.id} onClick={() => { if (activeThread) patchThread(activeThread.id, { projectId: project.id }); setProjectMenuOpen(false); }}><Folder size={14} />{project.name}{project.id === activeThread?.projectId && <Check size={13} />}</button>)}</div>}</div></div><textarea ref={composerRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleComposerKey} placeholder="Write a prompt. Shift + Enter for a new line." rows={2} /><div className="composer-bottom"><span className="composer-hint"><kbd>↵</kbd> send <kbd>⇧ ↵</kbd> new line</span><button className="send-button" onClick={sendMessage} disabled={!draft.trim()} aria-label="Send message"><ArrowUp size={17} /></button></div></div></div><div className="mobile-bottom-bar"><button onClick={() => setMobileNav(true)}><Menu size={16} /><span>Console</span></button><button onClick={() => setProjectMenuOpen(!projectMenuOpen)}><Folder size={16} /><span>{activeProject?.name || "Project"}</span></button><button onClick={() => composerRef.current?.focus()}><ArrowUp size={16} /><span>Compose</span></button></div>
      </main>

      {threadEditor && <div className="modal-backdrop" onMouseDown={() => setThreadEditor(null)}><div className="small-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-eyebrow">THREAD SETTINGS</div><h3>Rename thread</h3><input autoFocus value={threadName} onChange={(event) => setThreadName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submitThreadName()} /><div className="modal-actions"><button className="text-button" onClick={() => setThreadEditor(null)}>Cancel</button><button className="primary-button" onClick={submitThreadName}>Save name</button></div></div></div>}
      {projectEditor && <div className="modal-backdrop" onMouseDown={() => setProjectEditor(null)}><form className="small-modal" onSubmit={saveProject} onMouseDown={(event) => event.stopPropagation()}><div className="modal-eyebrow">PROJECT REGISTRY</div><h3>{projectEditor.mode === "edit" ? "Edit project" : "New project"}</h3><label>Name<input name="name" defaultValue={projectEditor.project?.name || ""} autoFocus placeholder="e.g. Product systems" /></label><label>Description<input name="description" defaultValue={projectEditor.project?.description || ""} placeholder="What belongs here?" /></label><div className="modal-actions">{projectEditor.mode === "edit" && projectEditor.project && <button type="button" className="delete-project" onClick={() => { deleteProject(projectEditor.project!.id); setProjectEditor(null); }}><Trash2 size={14} /> Delete</button>}<span className="modal-spacer" /><button type="button" className="text-button" onClick={() => setProjectEditor(null)}>Cancel</button><button className="primary-button" type="submit">{projectEditor.mode === "edit" ? "Save changes" : "Create project"}</button></div></form></div>}
    </div>
  );
}
