import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronRight, Command, History, Loader2, Play, RotateCcw, Terminal as TerminalIcon, X, Square } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { RightWindowApi, RightWindowRenderContext } from "@/lib/rightWindowExtensions";
import type { TerminalEvent } from "../../../server/terminal/contracts";
import type { LocalTerminalSession, LocalTerminalSessionSummary } from "../../../server/terminal/localSessionManager";

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled", "timed_out", "interrupted"]);

type TerminalAppProps = {
  api: RightWindowApi;
  context?: RightWindowRenderContext;
};

export function mergeEvents(current: TerminalEvent[], incoming: TerminalEvent[]) {
  const bySequence = new Map(current.map((event) => [event.sequence, event]));
  incoming.forEach((event) => bySequence.set(event.sequence, event));
  return Array.from(bySequence.values()).sort((a, b) => a.sequence - b.sequence);
}

function stateLabel(state?: string) {
  if (!state) return "Ready";
  if (state === "timed_out") return "Timed out";
  if (state === "cancelled") return "Cancelled";
  if (state === "completed") return "Completed";
  if (state === "failed") return "Failed";
  if (state === "interrupted") return "Interrupted";
  if (state === "awaiting_input") return "Waiting for input";
  return state[0].toUpperCase() + state.slice(1);
}

function stateIsRunning(state?: string) {
  return Boolean(state && !TERMINAL_STATES.has(state));
}

function sessionDate(value: string) {
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function TerminalApp({ api: _api, context }: TerminalAppProps) {
  const currentProject = context?.currentProject;
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [commandDraft, setCommandDraft] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState(".");
  const [interactive, setInteractive] = useState(true);
  const [timeoutMinutes, setTimeoutMinutes] = useState(10);
  const [inputDraft, setInputDraft] = useState("");
  const [session, setSession] = useState<LocalTerminalSession | LocalTerminalSessionSummary | null>(null);
  const [events, setEvents] = useState<TerminalEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);
  const utils = trpc.useUtils();

  const sessionsQuery = trpc.workspace.terminal.local.list.useQuery(
    { projectId: currentProject?.id, limit: 50 },
    { enabled: Boolean(currentProject?.id), staleTime: 5_000 },
  );
  const selectedSessionQuery = trpc.workspace.terminal.local.get.useQuery(
    { sessionId: activeSessionId || "pending" },
    { enabled: Boolean(activeSessionId), retry: false, staleTime: 0 },
  );

  const startMutation = trpc.workspace.terminal.local.start.useMutation({
    onSuccess: (started) => {
      setActiveSessionId(started.sessionId);
      setSession(started);
      setEvents([]);
      setCommandDraft("");
      setError(null);
      void utils.workspace.terminal.local.list.invalidate();
    },
    onError: (cause) => setError(cause.message),
  });
  const inputMutation = trpc.workspace.terminal.local.input.useMutation({
    onSuccess: () => setInputDraft(""),
    onError: (cause) => setError(cause.message),
  });
  const cancelMutation = trpc.workspace.terminal.local.cancel.useMutation({
    onSuccess: (updated) => setSession(updated),
    onError: (cause) => setError(cause.message),
  });

  useEffect(() => {
    if (!selectedSessionQuery.data || !activeSessionId) return;
    setSession(selectedSessionQuery.data);
    setEvents((current) => mergeEvents(current, selectedSessionQuery.data.events));
  }, [activeSessionId, selectedSessionQuery.data]);

  useEffect(() => {
    if (!activeSessionId) {
      sseRef.current?.close();
      sseRef.current = null;
      return;
    }
    const stream = new EventSource(`/api/terminal/local/${activeSessionId}/events`);
    sseRef.current = stream;
    stream.onmessage = (message) => {
      try {
        const envelope = JSON.parse(message.data) as { type: string; session?: LocalTerminalSession; event?: TerminalEvent };
        if (envelope.type === "snapshot" && envelope.session) {
          setSession(envelope.session);
          setEvents((current) => mergeEvents(current, envelope.session?.events || []));
        }
        if (envelope.type === "event" && envelope.event) {
          setEvents((current) => mergeEvents(current, [envelope.event!]));
          if (envelope.event.state && TERMINAL_STATES.has(envelope.event.state)) {
            setSession((current) => current ? { ...current, state: envelope.event!.state! } : current);
            void utils.workspace.terminal.local.list.invalidate();
          }
        }
      } catch {
        setError("The terminal sent an unreadable update.");
      }
    };
    stream.onerror = () => {
      setError("Reconnecting to terminal session…");
      void utils.workspace.terminal.local.get.invalidate({ sessionId: activeSessionId });
    };
    return () => {
      stream.close();
      if (sseRef.current === stream) sseRef.current = null;
    };
  }, [activeSessionId, utils]);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [events]);

  if (!currentProject) {
    return <div className="terminal-empty"><TerminalIcon size={34} strokeWidth={1.5} /><strong>Select a project</strong><p>Open a project to use the local terminal.</p></div>;
  }
  if (currentProject.workspaceStatus && currentProject.workspaceStatus !== "ready") {
    return <div className="terminal-empty"><AlertCircle size={34} strokeWidth={1.5} /><strong>Project workspace is not ready</strong><p>{currentProject.workspaceError || `Workspace status: ${currentProject.workspaceStatus}`}</p></div>;
  }

  const active = stateIsRunning(session?.state);
  const clearSession = () => { setActiveSessionId(null); setSession(null); setEvents([]); setError(null); };
  const selectSession = (item: LocalTerminalSessionSummary) => { setActiveSessionId(item.sessionId); setShowHistory(false); setError(null); };
  const runCommand = (event: React.FormEvent) => {
    event.preventDefault();
    if (!commandDraft.trim() || startMutation.isPending) return;
    startMutation.mutate({
      contractVersion: "1.0.0",
      lane: "local",
      projectId: currentProject.id,
      workingDirectory: workingDirectory.trim() || ".",
      command: commandDraft.trim(),
      shell: "bash",
      interactive,
      timeout: { timeoutMs: Math.max(1, timeoutMinutes) * 60_000, idleTimeoutMs: Math.max(1, timeoutMinutes) * 60_000 },
    });
  };
  const sendInput = (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeSessionId || !inputDraft || inputMutation.isPending) return;
    inputMutation.mutate({ sessionId: activeSessionId, input: `${inputDraft}\n` });
  };

  if (showHistory) {
    return <div className="terminal-history"><header className="terminal-history-header"><div><span className="terminal-eyebrow">LOCAL LANE</span><strong>Session history</strong></div><button className="icon-button" onClick={() => setShowHistory(false)} aria-label="Close session history"><X size={16} /></button></header><div className="terminal-history-list">{sessionsQuery.isLoading ? <div className="terminal-history-empty">Loading sessions…</div> : sessionsQuery.data?.map((item) => <button key={item.sessionId} className={`terminal-history-item ${activeSessionId === item.sessionId ? "active" : ""}`} onClick={() => selectSession(item)}><div className="terminal-history-item-main"><Command size={14} /><span><strong title={item.label || item.command}>{item.label || item.command}</strong><small>{item.workingDirectory}</small></span></div><div className="terminal-history-item-meta"><span className={`terminal-status-dot ${item.state}`} /><small>{stateLabel(item.state)}</small><time>{sessionDate(item.updatedAt)}</time></div></button>)}{!sessionsQuery.isLoading && !sessionsQuery.data?.length && <div className="terminal-history-empty">No recent sessions for this project.</div>}</div></div>;
  }

  return <div className="terminal-container"><header className="terminal-header"><div className="terminal-header-main"><TerminalIcon size={16} /><div><span className="terminal-eyebrow">LOCAL LANE</span><strong>Terminal</strong></div>{session && <span className={`terminal-state-pill ${session.state}`}>{stateLabel(session.state)}</span>}</div><div className="terminal-header-actions"><button className="icon-button" onClick={() => setShowHistory(true)} title="Session history" aria-label="Session history"><History size={16} /></button>{active && <button className="icon-button terminal-stop" onClick={() => activeSessionId && cancelMutation.mutate({ sessionId: activeSessionId })} disabled={cancelMutation.isPending} title="Cancel session" aria-label="Cancel session"><Square size={14} fill="currentColor" /></button>}{session && !active && <button className="icon-button" onClick={clearSession} title="New session" aria-label="New session"><RotateCcw size={15} /></button>}</div></header><div className="terminal-project-bar"><span>PROJECT</span><strong title={currentProject.name}>{currentProject.name}</strong><small title={currentProject.id}>{currentProject.workspaceFileCount ? `${currentProject.workspaceFileCount} files` : "Local workspace"}</small></div><div className="terminal-output" ref={outputRef} role="log" aria-live="polite">{!events.length && <div className="terminal-output-empty"><TerminalIcon size={22} /><span>Run a command in the selected project.</span></div>}{events.map((event) => <div key={event.sequence} className={`terminal-line ${event.kind}`}><span className="terminal-line-sequence">{String(event.sequence).padStart(2, "0")}</span><span className="terminal-line-body">{event.kind === "status" ? <span className="terminal-status-label">{stateLabel(event.state)}</span> : event.kind === "stdin" ? <ChevronRight size={12} className="terminal-prompt-icon" /> : null}<span>{event.text || event.input || ""}</span></span></div>)}{active && <span className="terminal-cursor" />}{error && <div className="terminal-error"><AlertCircle size={14} /><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss terminal error"><X size={12} /></button></div>}</div><footer className="terminal-footer">{active && session?.interactive ? <form className="terminal-input-form" onSubmit={sendInput}><ChevronRight size={14} /><input value={inputDraft} onChange={(event) => setInputDraft(event.target.value)} placeholder="Send input to the running process…" aria-label="Terminal input" autoFocus />{inputMutation.isPending && <Loader2 size={14} className="terminal-spin" />}<button type="submit" disabled={!inputDraft || inputMutation.isPending}>Send</button></form> : <form className="terminal-command-form" onSubmit={runCommand}><div className="terminal-command-row"><Play size={14} className="terminal-run-icon" /><input value={commandDraft} onChange={(event) => setCommandDraft(event.target.value)} placeholder="Enter command to run…" disabled={startMutation.isPending} aria-label="Terminal command" />{startMutation.isPending && <Loader2 size={14} className="terminal-spin" />}<button className="terminal-run-button" type="submit" disabled={!commandDraft.trim() || startMutation.isPending} aria-label="Run command"><Play size={13} fill="currentColor" /></button></div><div className="terminal-command-options"><label><span>DIR</span><input value={workingDirectory} onChange={(event) => setWorkingDirectory(event.target.value)} placeholder="." aria-label="Working directory" /></label><label className="terminal-checkbox"><input type="checkbox" checked={interactive} onChange={(event) => setInteractive(event.target.checked)} /><span>Interactive</span></label><label><span>TIMEOUT</span><input type="number" min="1" max="10080" value={timeoutMinutes} onChange={(event) => setTimeoutMinutes(Math.max(1, Number(event.target.value) || 1))} aria-label="Timeout in minutes" /><em>min</em></label></div></form>}</footer></div>;
}

export default TerminalApp;
