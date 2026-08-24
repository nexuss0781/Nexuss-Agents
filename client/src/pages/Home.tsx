// Design philosophy: Obsidian Console — Swiss precision, monochrome hierarchy, quiet depth.
// Design philosophy: Obsidian Console — quiet workbench, original AXOLOTL brand, and only the labels needed to work.
import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import "katex/dist/katex.min.css";
import {
  ArrowUp,
  Bot,
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
  Square,
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
type StreamingTurn = { threadId: string; prompt: string; content: string; startedAt: string };
type QueuedPrompt = { id: string; content: string; mode: "next" | "later" };
type ExecutionMode = "complex" | "general" | "instant";
type AttachmentStatus = "uploading" | "processing" | "ready" | "failed" | "cancelled";
type UploadedAttachment = { id: string; name: string; mimeType: string; size: number; contentHash: string; storageUrl: string; status: AttachmentStatus; progress: number; error?: string };
type MissionStatus = "created" | "queued" | "planning" | "planned" | "executing" | "verifying" | "repairing" | "paused" | "stopped" | "failed" | "completed";

function missionStatusLabel(status: MissionStatus) {
  if (status === "created") return "Ready to start";
  if (status === "queued") return "Getting ready";
  if (status === "planning" || status === "planned") return "Preparing";
  if (status === "executing") return "Working";
  if (status === "verifying") return "Checking the result";
  if (status === "repairing") return "Improving the result";
  if (status === "paused") return "Paused";
  if (status === "completed") return "Completed";
  if (status === "stopped") return "Stopped";
  return "Needs attention";
}

function missionIsActive(status: MissionStatus) {
  return status === "created" || status === "queued" || status === "planning" || status === "planned" || status === "executing" || status === "verifying" || status === "repairing" || status === "paused";
}
function isAutonomousWorkRequest(value: string) {
  const text = value.trim();
  if (!text) return false;
  return /\b(?:build|create|implement|add|remove|delete|fix|debug|refactor|modify|change|update|write|design|develop|develop|deploy|publish|research|investigate|analyze|compare|plan|automate|set up|setup|migrate|test|run|ship)\b/i.test(text)
    || /\b(?:i need you to|please make|please do|can you build|can you create|can you fix|help me build|help me create|help me fix)\b/i.test(text);
}

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

function CodeBlock({ language, content }: { language: string; content: string }) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    try {
      await navigator.clipboard?.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_400);
    } catch {
      toast.error("Code could not be copied");
    }
  }

  return <div className="research-code-block"><div className="research-code-header"><span>{language}</span><button onClick={() => void copyCode()} aria-label={`Copy ${language} code`}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied" : "Copy"}</button></div><SyntaxHighlighter style={vscDarkPlus as any} language={language === "text" ? undefined : language} PreTag="div" className="code-block">{content}</SyntaxHighlighter></div>;
}

function MermaidDiagram({ definition }: { definition: string }) {
  const target = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    setFailed(false);
    const renderDiagram = async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "dark", themeVariables: { background: "#111113", primaryColor: "#1c1c1f", primaryTextColor: "#e7e7e1", lineColor: "#8a8a84", tertiaryColor: "#151516", fontFamily: "IBM Plex Mono, monospace" } });
        const id = `nexuss-mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, definition);
        if (!disposed && target.current) target.current.innerHTML = svg;
      } catch {
        if (!disposed) setFailed(true);
      }
    };
    void renderDiagram();
    return () => { disposed = true; };
  }, [definition]);

  if (failed) return <div className="research-diagram-fallback" role="note">This Mermaid diagram could not be rendered. Check its syntax and try again.</div>;
  return <figure className="research-diagram"><figcaption>Diagram</figcaption><div ref={target} className="research-diagram-canvas" role="img" aria-label="Mermaid diagram" /></figure>;
}

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-([a-z0-9_+-]+)/i.exec(className || "");
            const raw = String(children).replace(/\n$/, "");
            const isBlock = Boolean(match) || String(children).includes("\n");
            if (match?.[1] === "mermaid") return <MermaidDiagram definition={raw} />;
            if (isBlock) return <CodeBlock language={match?.[1] || "text"} content={raw} />;
            return <code className="inline-code" {...props}>{children}</code>;
          },
          a({ href, children }) {
            const isSafe = Boolean(href && (/^(https?:|mailto:)/i.test(href) || href.startsWith("/") || href.startsWith("#")));
            if (!isSafe) return <span>{children}</span>;
            const external = /^https?:/i.test(href || "");
            return <a href={href} {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}>{children}</a>;
          },
          table({ children }) { return <div className="markdown-table-scroll"><table>{children}</table></div>; },
          input({ checked, ...props }) { return <input {...props} type="checkbox" checked={checked} disabled aria-label={checked ? "Complete" : "Incomplete"} />; },
          img({ src, alt }) { return <img className="research-image" src={src} alt={alt || ""} loading="lazy" />; },
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

type PlaygroundStreamEvent = { type: "start" | "token" | "done" | "error"; text?: string; content?: string; stopped?: boolean; finished?: boolean; message?: string; requestId?: string; code?: string; status?: number; diagnostic?: string };

class PlaygroundRequestError extends Error {
  readonly requestId?: string;
  readonly code?: string;
  readonly status?: number;
  readonly diagnostic?: string;

  constructor(event: PlaygroundStreamEvent) {
    super(event.message || "The model request failed.");
    this.name = "PlaygroundRequestError";
    this.requestId = event.requestId;
    this.code = event.code;
    this.status = event.status;
    this.diagnostic = event.diagnostic;
  }
}

export async function consumePlaygroundStream(response: Response, signal: AbortSignal, onEvent: (event: PlaygroundStreamEvent) => void) {
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let detail = "";
    try { detail = String((JSON.parse(raw) as { error?: unknown }).error || ""); } catch { detail = raw.slice(0, 240); }
    console.error("[Playground] stream request rejected", { status: response.status, statusText: response.statusText, detail });
    throw new Error("The model request could not be completed.");
  }
  if (!response.body) {
    console.error("[Playground] provider returned an empty response body");
    throw new Error("The model request returned no stream.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const cancelReader = () => { void reader.cancel(); };
  signal.addEventListener("abort", cancelReader, { once: true });
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        let event: PlaygroundStreamEvent;
        try { event = JSON.parse(data) as PlaygroundStreamEvent; } catch (error) { console.warn("[Playground] ignored malformed SSE frame", { detail: data.slice(0, 240), error }); continue; }
        onEvent(event);
      }
    }
    if (buffer.trim() && !signal.aborted && buffer.startsWith("data:")) {
      const data = buffer.slice(5).trim();
      let event: PlaygroundStreamEvent | undefined;
      try { event = JSON.parse(data) as PlaygroundStreamEvent; } catch (error) { console.warn("[Playground] ignored malformed final SSE frame", { detail: data.slice(0, 240), error }); }
      if (event) onEvent(event);
    }
  } finally {
    signal.removeEventListener("abort", cancelReader);
    await reader.cancel().catch(() => undefined);
  }
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
  const modelSettingsQuery = trpc.workspace.modelSettings.useQuery(undefined, { retry: false, staleTime: 30_000 });
  const utils = trpc.useUtils();
  const [activeThreadId, setActiveThreadId] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [executionMenuOpen, setExecutionMenuOpen] = useState(false);
  const [executionMode] = useState<ExecutionMode>("complex");
  const [activeModel, setActiveModel] = useState<string | null>(null);
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
  const [streamingTurn, setStreamingTurn] = useState<StreamingTurn | null>(null);
  const [promptQueue, setPromptQueue] = useState<QueuedPrompt[]>([]);
  const [queueMenuOpen, setQueueMenuOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [activeWorkOpen, setActiveWorkOpen] = useState(false);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [migrationSettled, setMigrationSettled] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const attachmentRequestsRef = useRef<Map<string, XMLHttpRequest>>(new Map());
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamThreadRef = useRef<string | null>(null);
  const promptQueueRef = useRef<QueuedPrompt[]>([]);
  const stopNoticeRef = useRef(false);
  const migrationStarted = useRef(false);
  const conversationRef = useRef<HTMLElement>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const livePromptRef = useRef<HTMLElement>(null);
  const latestUserMessageRef = useRef<HTMLElement>(null);
  const focusNewPromptThreadRef = useRef<string | null>(null);
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
  const createThreadMutation = trpc.workspace.createThread.useMutation({ onSuccess: (thread) => { setActiveThreadId(thread.id); setPendingProjectId(null); setLocation(`/app/chat/${thread.chatSlug}`); refreshWorkspace(); }, onError: () => toast.error("Thread could not be created") });
  const appendMessagesMutation = trpc.workspace.appendMessages.useMutation({ onSuccess: refreshWorkspace, onError: () => toast.error("Your conversation could not be updated") });
  const renameThreadMutation = trpc.workspace.renameThread.useMutation({ onSuccess: refreshWorkspace, onError: () => toast.error("Thread could not be renamed") });
  const deleteThreadMutation = trpc.workspace.deleteThread.useMutation({ onSuccess: refreshWorkspace, onError: () => toast.error("Thread could not be deleted") });
  const assignThreadProjectMutation = trpc.workspace.assignThreadProject.useMutation({ onSuccess: refreshWorkspace, onError: () => toast.error("Project assignment could not be saved") });
  const saveModelSettingsMutation = trpc.workspace.saveModelSettings.useMutation({ onError: (error) => toast.error(error.message || "Provider settings could not be saved") });
  const discoverModelsMutation = trpc.workspace.discoverModels.useMutation({ onError: (error) => toast.error(error.message || "Models could not be refreshed") });
  const createMissionFromIntakeMutation = trpc.workspace.mission.createFromIntake.useMutation();
  const missionRefresh = () => { void utils.workspace.mission.list.invalidate(); if (selectedMissionId) void utils.workspace.mission.get.invalidate({ missionId: selectedMissionId }); };
  const startMissionMutation = trpc.workspace.mission.start.useMutation({ onSuccess: missionRefresh });
  const pauseMissionMutation = trpc.workspace.mission.pause.useMutation({ onSuccess: missionRefresh, onError: (error) => toast.error(error.message || "Work could not be paused") });
  const resumeMissionMutation = trpc.workspace.mission.resume.useMutation({ onSuccess: missionRefresh, onError: (error) => toast.error(error.message || "Work could not be resumed") });
  const stopMissionMutation = trpc.workspace.mission.stop.useMutation({ onSuccess: missionRefresh, onError: (error) => toast.error(error.message || "Work could not be stopped") });
  const retryMissionMutation = trpc.workspace.mission.retry.useMutation({ onSuccess: missionRefresh, onError: (error) => toast.error(error.message || "Work could not be restarted") });

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
    if (!modelSettingsQuery.isSuccess || !savedProvider) return;
    setModelBaseUrl(savedProvider.baseUrl);
    setSelectedModels(savedProvider.selectedModels);
    const persistedModels = savedProvider.availableModels || [];
    setAvailableModels(persistedModels.length ? persistedModels : savedProvider.selectedModels);
  }, [modelSettingsQuery.isSuccess, modelSettingsQuery.data]);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
      attachmentRequestsRef.current.forEach((request) => request.abort());
      attachmentRequestsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    setActiveModel((current) => current && selectedModels.includes(current) ? current : selectedModels[0] || null);
  }, [selectedModels]);
  const activeThreadSummary = workspace.threads.find((thread) => thread.chatSlug === routeChatSlug) || workspace.threads.find((thread) => thread.id === activeThreadId) || workspace.threads[0];
  const activeThread = activeThreadSummary ? { ...activeThreadSummary, messages: activeChatQuery.data?.messages || activeThreadSummary.messages } : undefined;
  const latestUserMessageId = activeThread?.messages.filter((message) => message.role === "user").at(-1)?.id;
  const workspaceReady = navigationQuery.isSuccess && migrationSettled;
  const activeProject = workspace.projects.find((project) => project.id === activeThread?.projectId);
  const missionListQuery = trpc.workspace.mission.list.useQuery(undefined, { enabled: workspaceReady, retry: false, staleTime: 1_000, refetchInterval: workspaceReady ? 2_500 : false, refetchIntervalInBackground: true });
  const missionRecords = Array.isArray(missionListQuery.data) ? missionListQuery.data : [];
  const activeMissions = missionRecords.filter((mission) => missionIsActive(mission.status as MissionStatus)).slice(0, 12);
  const recentMissions = missionRecords.slice(0, 12);
  const selectedMission = selectedMissionId ? recentMissions.find((mission) => mission.id === selectedMissionId) : undefined;
  const missionDetailQuery = trpc.workspace.mission.get.useQuery({ missionId: selectedMissionId || "none" }, { enabled: Boolean(selectedMissionId && activeWorkOpen && workspaceReady), retry: false, staleTime: 500, refetchInterval: selectedMissionId && activeWorkOpen ? 2_500 : false, refetchIntervalInBackground: true });
  const selectedMissionSnapshot = missionDetailQuery.data;
  const selectedWorkItems = selectedMissionSnapshot?.workItems || [];
  const selectedCompletedItems = selectedWorkItems.filter((item) => item.status === "completed").length;
  useEffect(() => {
    if (!selectedMissionId && activeMissions[0]) setSelectedMissionId(activeMissions[0].id);
    if (selectedMissionId && !recentMissions.some((mission) => mission.id === selectedMissionId)) setSelectedMissionId(activeMissions[0]?.id || null);
  }, [activeMissions, recentMissions, selectedMissionId]);
  const activeThreadSlug = activeThread?.chatSlug || (activeThread ? `chat-${activeThread.id.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}` : undefined);
  const liveStreaming = streamingTurn?.threadId === activeThread?.id ? streamingTurn : null;
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const container = conversationRef.current;
      if (focusNewPromptThreadRef.current === activeThread?.id) {
        const target = livePromptRef.current || latestUserMessageRef.current;
        if (target) {
          target.scrollIntoView?.({ behavior: "smooth", block: "start" });
          focusNewPromptThreadRef.current = null;
          return;
        }
        if (container?.scrollTo) {
          container.scrollTo({ top: 0, behavior: "smooth" });
          focusNewPromptThreadRef.current = null;
          return;
        }
      } else if (focusNewPromptThreadRef.current) {
        focusNewPromptThreadRef.current = null;
      }
      if (container?.scrollTo) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      else conversationEndRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeThread?.id, activeThread?.messages.length, streamingTurn?.threadId]);
  const livePromptVisible = Boolean(liveStreaming && !activeThread?.messages.some((message) => message.role === "user" && message.content === liveStreaming.prompt && message.createdAt >= liveStreaming.startedAt));
  const liveAssistantVisible = Boolean(liveStreaming && !activeThread?.messages.some((message) => message.role === "assistant" && message.content === liveStreaming.content && message.content.length > 0 && message.createdAt >= liveStreaming.startedAt));
  const responsePending = createThreadMutation.isPending;
  const filteredThreads = useMemo(() => workspace.threads.filter((thread) => thread.title.toLowerCase().includes(query.toLowerCase())), [workspace.threads, query]);
  const profileInitials = profileName.slice(0, 2).toUpperCase();
  const composerStartsMission = executionMode === "complex" && (attachments.length > 0 || isAutonomousWorkRequest(draft));
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
    deleteThreadMutation.mutate({ id }, { onSuccess: () => { if (activeThreadId === id) setActiveThreadId(""); } });
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
    } else {
      createProjectMutation.mutate({ name, description, tone: "#f4f4f0" });
    }
    setProjectEditor(null);
  }

  function deleteProject(id: string) {
    if (!workspaceReady) return;
    deleteProjectMutation.mutate({ id });
  }

  function updatePromptQueue(next: QueuedPrompt[]) {
    promptQueueRef.current = next;
    setPromptQueue(next);
  }

  function updateAttachment(id: string, patch: Partial<UploadedAttachment>) {
    setAttachments((current) => current.map((attachment) => attachment.id === id ? { ...attachment, ...patch } : attachment));
  }

  function uploadAttachment(file: File) {
    const id = crypto.randomUUID();
    setAttachments((current) => [...current, { id, name: file.name || "attachment", mimeType: file.type || "application/octet-stream", size: file.size, contentHash: "", storageUrl: "", status: "uploading", progress: 0 }]);
    const request = new XMLHttpRequest();
    attachmentRequestsRef.current.set(id, request);
    request.open("POST", "/api/workspace/attachments/upload");
    request.withCredentials = true;
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const progress = Math.min(99, Math.round((event.loaded / event.total) * 100));
      updateAttachment(id, { progress, status: progress >= 99 ? "processing" : "uploading" });
    };
    request.onload = () => {
      attachmentRequestsRef.current.delete(id);
      let payload: { attachment?: { id: string; name: string; mimeType: string; size: number; contentHash: string; storageUrl: string }; error?: string } = {};
      try { payload = JSON.parse(request.responseText || "{}"); } catch { /* handled by the generic upload error below */ }
      if (request.status >= 200 && request.status < 300 && payload.attachment) {
        updateAttachment(id, { ...payload.attachment, status: "ready", progress: 100 });
      } else {
        updateAttachment(id, { status: "failed", progress: 0, error: payload.error || "Upload could not be completed." });
      }
    };
    request.onerror = () => { attachmentRequestsRef.current.delete(id); updateAttachment(id, { status: "failed", progress: 0, error: "Upload could not be completed." }); };
    request.onabort = () => { attachmentRequestsRef.current.delete(id); updateAttachment(id, { status: "cancelled", error: "Upload cancelled." }); };
    const form = new FormData();
    form.append("file", file, file.name);
    const projectId = activeProject?.id || pendingProjectId;
    if (projectId) form.append("projectId", projectId);
    form.append("sourceKind", "specification");
    request.send(form);
  }

  function chooseAttachments(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach(uploadAttachment);
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  }

  function cancelAttachment(id: string) {
    const request = attachmentRequestsRef.current.get(id);
    if (request) request.abort();
    else updateAttachment(id, { status: "cancelled", error: "Upload cancelled." });
  }

  function removeAttachment(id: string) {
    attachmentRequestsRef.current.get(id)?.abort();
    attachmentRequestsRef.current.delete(id);
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  function queuePrompt(mode: "next" | "later") {
    const content = draft.trim();
    if (!content || !streamingTurn) return;
    const item = { id: crypto.randomUUID(), content, mode } satisfies QueuedPrompt;
    updatePromptQueue(mode === "next" ? [item, ...promptQueueRef.current] : [...promptQueueRef.current, item]);
    setDraft("");
    setQueueMenuOpen(false);
  }

  function stopStreaming() {
    if (!streamAbortRef.current) return;
    if (!draft.trim()) {
      stopNoticeRef.current = true;
      updatePromptQueue([]);
    }
    streamAbortRef.current.abort();
  }

  async function runPrompt(content: string, targetThread: Thread) {
    if (!activeModel) {
      toast.error("Select a model in Settings before sending a prompt.");
      return;
    }
    const controller = new AbortController();
    const stopNotice = stopNoticeRef.current;
    stopNoticeRef.current = false;
    streamAbortRef.current = controller;
    streamThreadRef.current = targetThread.id;
    focusNewPromptThreadRef.current = targetThread.id;
    setStreamingTurn({ threadId: targetThread.id, prompt: content, content: "", startedAt: new Date().toISOString() });
    let streamedContent = "";
    let finished = false;
    try {
      const response = await fetch("/api/playground/stream", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ threadId: targetThread.id, model: activeModel, prompt: content, ...(targetThread.messages.length === 0 ? { title: content.slice(0, 42) } : {}), ...(stopNotice ? { stopNotice: true } : {}) }),
        signal: controller.signal,
      });
      await consumePlaygroundStream(response, controller.signal, (event) => {
        if (event.type === "token") {
          streamedContent += event.text || "";
          setStreamingTurn((current) => current ? { ...current, content: streamedContent } : current);
        }
        if (event.type === "done") {
          finished = event.finished !== false;
          if (typeof event.content !== "string") return;
          streamedContent = event.content;
          setStreamingTurn((current) => current ? { ...current, content: streamedContent } : current);
        }
        if (event.type === "error") throw new PlaygroundRequestError(event);
      });
      if (!controller.signal.aborted && !streamedContent) console.warn("[Playground] provider completed without text", { model: activeModel, threadId: targetThread.id, finished });
    } catch (error) {
      if (!controller.signal.aborted) {
        const diagnostic = error instanceof PlaygroundRequestError ? { name: error.name, requestId: error.requestId, code: error.code, status: error.status, detail: error.diagnostic } : error;
        console.error("[Playground] prompt stream failed", { model: activeModel, threadId: targetThread.id, error: diagnostic });
        setDraft((current) => current.trim() ? current : content);
        toast.error(error instanceof PlaygroundRequestError ? "The model request failed. Check the console for details." : error instanceof Error ? error.message : "The model request failed.");
      }
    } finally {
      if (streamAbortRef.current === controller) streamAbortRef.current = null;
      if (streamThreadRef.current === targetThread.id) streamThreadRef.current = null;
      setStreamingTurn(null);
      void utils.workspace.navigation.invalidate();
      void utils.workspace.chat.invalidate();
      const next = finished ? promptQueueRef.current.shift() : undefined;
      setPromptQueue([...promptQueueRef.current]);
      if (next) {
        window.setTimeout(() => void runPrompt(next.content, targetThread), 0);
      } else if (finished && streamedContent) {
      }
    }
  }

  async function sendMission() {
    const content = draft.trim();
    if (!workspaceReady || (!content && attachments.length === 0) || createMissionFromIntakeMutation.isPending || startMissionMutation.isPending) return;
    const pendingAttachments = attachments.filter((attachment) => attachment.status === "uploading" || attachment.status === "processing");
    if (pendingAttachments.length) return toast.error("Finish attaching your files first.");
    const failedAttachments = attachments.filter((attachment) => attachment.status !== "ready");
    if (failedAttachments.length) return toast.error("Remove failed attachments or choose them again.");
    try {
      const projectId = activeProject?.id || pendingProjectId || null;
      const sources = [...(content ? [{ kind: "raw_prompt" as const, text: content }] : []), ...attachments.map((attachment) => ({ kind: "specification" as const, attachmentId: attachment.id, name: attachment.name, mimeType: attachment.mimeType }))];
      const result = await createMissionFromIntakeMutation.mutateAsync({ projectId, model: activeModel || undefined, sources });
      const targetThread = activeThread || await createThreadMutation.mutateAsync({ projectId: pendingProjectId });
      const userMessages = content ? [{ role: "user" as const, content }] : [];
      if (!result.mission) {
        const detail = result.issues.find((issue) => issue.code === "MATERIAL_AMBIGUITY")?.summary;
        await appendMessagesMutation.mutateAsync({ threadId: targetThread.id, messages: [...userMessages, { role: "assistant", content: detail ? `I need a little more detail before I start. ${detail}` : "I need a little more detail before I start this work." }], ...(targetThread.messages.length === 0 && content ? { title: content.slice(0, 42) } : {}) });
        setDraft("");
        setAttachments([]);
        return;
      }
      await startMissionMutation.mutateAsync({ missionId: result.mission.mission.id });
      const acknowledgment = "I’m taking this on now. I’ll work through the request, check the result, and bring the finished work back here.";
      focusNewPromptThreadRef.current = targetThread.id;
      await appendMessagesMutation.mutateAsync({ threadId: targetThread.id, messages: [...userMessages, { role: "assistant", content: acknowledgment }], ...(targetThread.messages.length === 0 && content ? { title: content.slice(0, 42) } : {}) });
      void utils.workspace.mission.list.invalidate();
      setSelectedMissionId(result.mission.mission.id);
      setActiveWorkOpen(true);
      setDraft("");
      setAttachments([]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      setDraft((current) => current.trim() ? current : content);
      if (detail.includes("blocked")) toast.error("I cannot start this work safely yet. Please revise the request.");
      else toast.error(detail || "This work could not be started.");
    }
  }

  function handleMissionAction(action: "pause" | "resume" | "stop" | "retry", missionId: string) {
    if (action === "pause") pauseMissionMutation.mutate({ missionId });
    if (action === "resume") resumeMissionMutation.mutate({ missionId });
    if (action === "stop") stopMissionMutation.mutate({ missionId });
    if (action === "retry") retryMissionMutation.mutate({ missionId });
  }

  async function sendMessage() {
    const content = draft.trim();
    if (!workspaceReady || (!content && attachments.length === 0) || createThreadMutation.isPending) return;
    if (executionMode === "complex" && (attachments.length > 0 || isAutonomousWorkRequest(content))) {
      await sendMission();
      return;
    }
    if (streamingTurn) {
      queuePrompt("next");
      return;
    }
    if (!activeModel) return toast.error("Select a model in Settings before sending a prompt.");
    try {
      const targetThread = activeThread || await createThreadMutation.mutateAsync({ projectId: pendingProjectId });
      setActiveThreadId(targetThread.id);
      setLocation(`/app/chat/${targetThread.chatSlug}`);
      setPendingProjectId(null);
      setDraft("");
      await runPrompt(content, targetThread);
    } catch {
      // The mutation's error handler provides operator-facing feedback.
    }
  }

  function handleComposerKey(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  function saveProviderSettings(afterSave?: () => void) {
    const apiKey = modelApiKey.trim();
    if (!modelBaseUrl.trim()) return toast.error("Enter a model API base URL.");
    if (!apiKey && !modelSettingsQuery.data?.apiKeyConfigured) return toast.error("Enter an API key before saving your first provider.");
    saveModelSettingsMutation.mutate({ baseUrl: modelBaseUrl, ...(apiKey ? { apiKey } : {}), selectedModels }, {
      onSuccess: (settings) => {
        setModelBaseUrl(settings.baseUrl);
        setAvailableModels(settings.availableModels || []);
        setModelApiKey("");
        void utils.workspace.modelSettings.invalidate();
          afterSave?.();
      },
    });
  }

  function refreshModels() {
    saveProviderSettings(() => discoverModelsMutation.mutate(undefined, {
      onSuccess: ({ models }) => {
        setAvailableModels((current) => Array.from(new Set([...current, ...models])).sort((a, b) => a.localeCompare(b)));
      },
    }));
  }

  function toggleModel(model: string) {
    setSelectedModels((current) => current.includes(model) ? current.filter((item) => item !== model) : [...current, model]);
  }

  function chooseProject(projectId: string | null) {
    if (activeThread) assignThreadProjectMutation.mutate({ id: activeThread.id, projectId });
    else setPendingProjectId(projectId);
    setProjectMenuOpen(false);
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
        <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={19} /></button><div className="topbar-thread-copy"><div className="topbar-thread-title">{activeThread?.title || "New thread"}</div>{activeThreadSlug && <span className="topbar-thread-slug">{activeThreadSlug}</span>}</div></div><div className="topbar-right">{recentMissions.length > 0 && <button className={`mission-activity-button ${activeMissions.length > 0 ? "active" : ""}`} onClick={() => setActiveWorkOpen(true)} aria-label="Open your work" aria-expanded={activeWorkOpen}><span className="mission-activity-dot" aria-hidden="true" />{activeMissions.length > 0 ? `${activeMissions.length} working` : "Your work"}</button>}<button className="icon-button settings-trigger" onClick={() => setSettingsOpen(true)} aria-label="Open settings" aria-haspopup="dialog" aria-expanded={settingsOpen}><Settings size={16} /></button></div></header>
        <div className="mobile-context-strip"><button className="mobile-context-button" onClick={() => setMobileNav(true)}><Menu size={15} /><span>Threads</span></button><div className="mobile-context-title"><strong>{activeThread?.title || "New thread"}</strong></div><button className="mobile-context-button" onClick={createThread} disabled={!workspaceReady || createThreadMutation.isPending}><Plus size={15} /><span>New</span></button></div><section ref={conversationRef} className="conversation-area">
          <div className="conversation-heading">{activeThread && <div className="heading-actions"><button className="icon-button" onClick={() => { setThreadEditor(activeThread.id); setThreadName(activeThread.title); }} aria-label="Rename thread"><Pencil size={16} /></button><button className="icon-button danger-hover" onClick={() => deleteThread(activeThread.id)} aria-label="Delete thread"><Trash2 size={16} /></button></div>}</div>
          {navigationQuery.isError || activeChatQuery.isError ? <div className="empty-thread"><div className="empty-brand-mark"><img src={AXOLOTL_ICON} alt="" /></div><h2>Workspace unavailable.</h2><p>Your saved data is unchanged. Check your connection and try again.</p><button className="empty-create-button" onClick={() => { void navigationQuery.refetch(); if (routeChatSlug) void activeChatQuery.refetch(); }}><ArrowUp size={14} /> Retry loading</button></div> : !workspaceReady || migration.isPending ? <AxolotlLoader label="LOADING YOUR WORKSPACE" /> : activeThread?.messages.length || responsePending || liveStreaming ? <div className="message-stack">{livePromptVisible && <article ref={livePromptRef} className="message user live-prompt"><div className="message-meta"><span className="role-mark user">You</span><span>You</span><span className="message-time">{formatDate(liveStreaming!.startedAt)}</span></div><div className="message-content"><MarkdownMessage content={liveStreaming!.prompt} /></div><div className="message-divider" /></article>}{activeThread?.messages.map((message, index) => <article ref={message.role === "user" && message.id === latestUserMessageId ? latestUserMessageRef : undefined} className={`message ${message.role}`} key={message.id}><div className="message-meta"><span className={`role-mark ${message.role}`}>{message.role === "assistant" ? <img src={AXOLOTL_ICON} alt="" /> : "You"}</span><span>{message.role === "assistant" ? "Nexuss-Agent" : "You"}</span><span className="message-time">{formatDate(message.createdAt)}</span>{message.role === "assistant" && <button className="copy-button" onClick={() => { void navigator.clipboard?.writeText(message.content); }}><Copy size={13} /> Copy</button>}</div><div className="message-content"><MarkdownMessage content={message.content} /></div>{index < (activeThread?.messages.length || 0) - 1 && <div className="message-divider" />}</article>)}{liveAssistantVisible && <article className="message assistant live-response"><div className="message-meta"><span className="role-mark assistant"><img src={AXOLOTL_ICON} alt="" /></span><span>Nexuss-Agent</span><span className="message-time">LIVE</span></div><div className="message-content"><MarkdownMessage content={liveStreaming!.content || "▍"} /></div></article>}{responsePending && <ResponseSkeleton />}<div ref={conversationEndRef} className="conversation-end" aria-hidden="true" /></div> : <div className="empty-thread"><div className="orbit-art axolotl-schematic" aria-hidden="true"><span className="axolotl-loop" /><span className="axolotl-eye axolotl-eye-one" /><span className="axolotl-eye axolotl-eye-two" /><span className="axolotl-gill axolotl-gill-one" /><span className="axolotl-gill axolotl-gill-two" /></div><div className="empty-brand-mark"><img src={AXOLOTL_ICON} alt="" /></div><h2>Start a thread.</h2><p>Give your work a place to begin.</p><button className="empty-create-button" onClick={createThread} disabled={createThreadMutation.isPending}><Plus size={14} /> New thread <ArrowUp size={13} /></button></div>}
        </section>
        <div className="composer-wrap"><div className="composer" onClick={() => composerRef.current?.focus()}>
          <div className="composer-top">
            <button className="composer-plus" onClick={(event) => { event.stopPropagation(); attachmentInputRef.current?.click(); }} aria-label="Add attachments" title="Add attachments"><Plus size={16} /></button>
            <input ref={attachmentInputRef} className="attachment-input" type="file" multiple onChange={(event) => chooseAttachments(event.target.files)} aria-label="Choose attachments" />
            <div className="composer-controls-center">
              <div className="composer-menu-anchor composer-model-anchor">
                <button className="composer-picker model-picker" onClick={(event) => { event.stopPropagation(); setProjectMenuOpen(false); setModelMenuOpen(!modelMenuOpen); }} disabled={!selectedModels.length} aria-label="Select model" aria-expanded={modelMenuOpen}><Bot size={14} /><span>{activeModel || "Select model"}</span><ChevronDown size={13} /></button>
                {modelMenuOpen && <div className="composer-menu model-menu" role="menu"><div className="model-menu-header"><span>Saved models</span><b>{selectedModels.length}</b></div>{selectedModels.map((model) => <button key={model} className="model-option" onClick={(event) => { event.stopPropagation(); setActiveModel(model); setModelMenuOpen(false); }}><Bot size={14} /><span className="model-option-name">{model}</span>{activeModel === model && <Check size={13} />}</button>)}</div>}
              </div>
              <span className="composer-top-divider" />
              <div className="composer-menu-anchor composer-execution-anchor">
                <button className="composer-picker execution-picker" onClick={(event) => { event.stopPropagation(); setModelMenuOpen(false); setProjectMenuOpen(false); setExecutionMenuOpen(!executionMenuOpen); }} aria-label="Choose execution style" aria-expanded={executionMenuOpen}><span className="execution-picker-dot" aria-hidden="true" /><span>{executionMode === "complex" ? "Complex" : executionMode}</span><ChevronDown size={13} /></button>
                {executionMenuOpen && <div className="composer-menu execution-menu" role="menu" aria-label="Execution styles">
                  <button className="execution-option selected" role="menuitem" onClick={(event) => { event.stopPropagation(); setExecutionMenuOpen(false); }}><span><span className="execution-option-dot" aria-hidden="true" />Complex</span><Check size={13} /></button>
                  <button className="execution-option upcoming" role="menuitem" disabled><span><span className="execution-option-dot" aria-hidden="true" />General</span><small>Coming soon</small></button>
                  <button className="execution-option upcoming" role="menuitem" disabled><span><span className="execution-option-dot" aria-hidden="true" />Instant</span><small>Coming soon</small></button>
                </div>}
              </div>
            </div>
            <div className="composer-menu-anchor composer-project-anchor">
              <button className="composer-picker project-picker" onClick={(event) => { event.stopPropagation(); setModelMenuOpen(false); setProjectMenuOpen(!projectMenuOpen); }} disabled={!workspaceReady || workspace.projects.length === 0} aria-label="Assign project" aria-expanded={projectMenuOpen}><Folder size={14} /><span>{activeProject?.name || workspace.projects.find((project) => project.id === pendingProjectId)?.name || "Assign project"}</span><ChevronDown size={13} /></button>
              {projectMenuOpen && <div className="composer-menu project-menu" role="menu"><button onClick={(event) => { event.stopPropagation(); chooseProject(null); }}>No project</button>{workspace.projects.map((project) => <button key={project.id} onClick={(event) => { event.stopPropagation(); chooseProject(project.id); }}><Folder size={14} />{project.name}{project.id === (activeThread?.projectId || pendingProjectId) && <Check size={13} />}</button>)}</div>}
            </div>
          </div>
          {attachments.length > 0 && <div className="attachment-tray" aria-live="polite">{attachments.map((attachment) => <div className={`attachment-chip ${attachment.status}`} key={attachment.id}><div className="attachment-chip-main"><span className="attachment-chip-mark" aria-hidden="true" /><span className="attachment-chip-copy"><strong title={attachment.name}>{attachment.name}</strong><small>{attachment.status === "uploading" ? `Uploading ${attachment.progress}%` : attachment.status === "processing" ? "Preparing" : attachment.status === "ready" ? "Ready" : attachment.error || attachment.status}</small></span></div>{(attachment.status === "uploading" || attachment.status === "processing") ? <button className="attachment-action" onClick={(event) => { event.stopPropagation(); cancelAttachment(attachment.id); }} aria-label={`Cancel ${attachment.name}`}><X size={12} /></button> : <button className="attachment-action" onClick={(event) => { event.stopPropagation(); removeAttachment(attachment.id); }} aria-label={`Remove ${attachment.name}`}><X size={12} /></button>}{(attachment.status === "uploading" || attachment.status === "processing") && <span className="attachment-progress" style={{ width: `${attachment.progress}%` }} />}</div>)}</div>}
          <textarea ref={composerRef} value={draft} onChange={(event) => { setDraft(event.target.value); if (!event.target.value.trim()) setQueueMenuOpen(false); }} onKeyDown={handleComposerKey} placeholder={streamingTurn ? "Write a follow-up — it will wait for the current response" : "Write your message…"} rows={2} disabled={!workspaceReady || createThreadMutation.isPending} />
          <div className="composer-bottom">
            <span className="composer-runtime-status">{composerStartsMission ? (activeMissions.length > 0 ? "Work in progress" : "Ready to start") : streamingTurn ? (promptQueue.length ? `${promptQueue.length} queued` : "Talking with you") : "Ready to send"}</span>
            <div className="composer-send-cluster">
              {promptQueue.length > 0 && <button className="queue-count" onClick={(event) => { event.stopPropagation(); setQueueMenuOpen(!queueMenuOpen); }} aria-label={`${promptQueue.length} prompts queued`}><span>{promptQueue.length}</span> queued</button>}
              {createMissionFromIntakeMutation.isPending || startMissionMutation.isPending ? <button className="send-button" disabled aria-label="Starting work"><span className="send-spinner" /> </button> : streamingTurn && !draft.trim() ? <button className="send-button stop-button" onClick={(event) => { event.stopPropagation(); stopStreaming(); }} aria-label="Stop response" title="Stop current task"><Square size={13} fill="currentColor" /></button> : <div className="composer-menu-anchor send-menu-anchor"><button className="send-button" onClick={(event) => { event.stopPropagation(); void sendMessage(); }} disabled={!workspaceReady || (!draft.trim() && attachments.length === 0) || createThreadMutation.isPending || attachments.some((attachment) => attachment.status === "failed" || attachment.status === "cancelled")} aria-label={composerStartsMission ? "Start work" : streamingTurn ? "Send follow-up" : "Send message"}><ArrowUp size={17} /></button>{streamingTurn && draft.trim() && !composerStartsMission && <><button className="send-queue-toggle" onClick={(event) => { event.stopPropagation(); setQueueMenuOpen(!queueMenuOpen); }} aria-label="Add prompt to queue" aria-expanded={queueMenuOpen}><ChevronDown size={11} /></button>{queueMenuOpen && <div className="composer-menu queue-menu" role="menu"><button onClick={(event) => { event.stopPropagation(); queuePrompt("later"); }}>Add to queue</button><div className="queue-menu-summary">Wait for the current task to finish</div></div>}</>}</div>}
            </div>
          </div>
        </div></div><div className="mobile-bottom-bar"><button onClick={() => setMobileNav(true)}><Menu size={16} /><span>Threads</span></button><button onClick={() => { composerRef.current?.focus(); setProjectMenuOpen(true); }} disabled={!workspaceReady || workspace.projects.length === 0}><Folder size={16} /><span>{activeProject?.name || workspace.projects.find((project) => project.id === pendingProjectId)?.name || "Project"}</span></button><button onClick={() => composerRef.current?.focus()} disabled={!workspaceReady}><ArrowUp size={16} /><span>Write</span></button></div>
      </main>

      {activeWorkOpen && <div className="active-work-backdrop" onMouseDown={() => setActiveWorkOpen(false)}><aside className="active-work-drawer" role="dialog" aria-modal="true" aria-labelledby="active-work-title" onMouseDown={(event) => event.stopPropagation()}><header className="active-work-header"><div><span className="modal-eyebrow">Work in progress</span><h2 id="active-work-title">Your work</h2></div><button className="icon-button" onClick={() => setActiveWorkOpen(false)} aria-label="Close your work"><X size={17} /></button></header><div className="active-work-body">{recentMissions.length === 0 ? <div className="active-work-empty"><span className="active-work-empty-mark" aria-hidden="true" /><p>No work yet.</p><small>When you give the agent a job, it will appear here.</small></div> : <><div className="mission-list" aria-label="Your work">{recentMissions.map((mission) => { const status = mission.status as MissionStatus; const isSelected = selectedMissionId === mission.id; return <button className={`mission-list-item ${isSelected ? "selected" : ""}`} key={mission.id} onClick={() => { setSelectedMissionId(mission.id); setActiveWorkOpen(true); }}><span className={`mission-list-status ${missionIsActive(status) ? "working" : status}`} aria-hidden="true" /><span className="mission-list-copy"><strong>{mission.goal}</strong><small>{missionStatusLabel(status)}</small></span><span className="mission-list-arrow" aria-hidden="true">›</span></button>; })}</div>{selectedMission && <section className="mission-detail"><div className="mission-detail-heading"><div><span className="modal-eyebrow">Selected work</span><h3>{selectedMission.goal}</h3></div><span className={`mission-status-pill ${missionIsActive(selectedMission.status as MissionStatus) ? "working" : selectedMission.status}`}>{missionStatusLabel(selectedMission.status as MissionStatus)}</span></div>{selectedMissionSnapshot ? <><div className="mission-progress-copy"><span>{selectedCompletedItems} of {selectedWorkItems.length || "—"} steps complete</span><span>{selectedMissionSnapshot.events.length} updates</span></div><div className="mission-progress-track"><span style={{ width: `${selectedWorkItems.length ? Math.round((selectedCompletedItems / selectedWorkItems.length) * 100) : selectedMission.status === "completed" ? 100 : 12}%` }} /></div></> : <div className="mission-detail-loading">Loading the latest result…</div>}<div className="mission-actions">{selectedMission.status === "paused" ? <button className="primary-button" onClick={() => handleMissionAction("resume", selectedMission.id)} aria-label="Continue work">Continue</button> : missionIsActive(selectedMission.status as MissionStatus) && <button className="text-button" onClick={() => handleMissionAction("pause", selectedMission.id)} aria-label="Pause work">Pause</button>}{missionIsActive(selectedMission.status as MissionStatus) && <button className="stop-work-button" onClick={() => handleMissionAction("stop", selectedMission.id)} aria-label="Stop work">Stop</button>}{selectedMission.status === "failed" || selectedMission.status === "stopped" ? <button className="primary-button" onClick={() => handleMissionAction("retry", selectedMission.id)} aria-label="Try work again">Try again</button> : null}</div></section>}</>}</div></aside></div>}

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
              <div className={`provider-secret-status ${modelSettingsQuery.data?.apiKeyConfigured ? "configured" : "not-configured"}`} role="status"><span className="provider-secret-status-dot" aria-hidden="true" />{modelSettingsQuery.data?.apiKeyConfigured ? "API secret stored securely in your encrypted workspace" : "No API secret saved yet"}</div>
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
