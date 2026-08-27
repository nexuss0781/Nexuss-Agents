import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronRight, Command, ExternalLink, History, Loader2, Play, RefreshCw, RotateCcw, Terminal as TerminalIcon, X, Square, Cloud } from "lucide-react";
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
  const readOnly = context?.readOnly ?? true;
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
  const [lane, setLane] = useState<"local" | "external">("local");
  const [externalSessionId, setExternalSessionId] = useState<string | null>(null);
  const [externalRepository, setExternalRepository] = useState("");
  const [externalWorkflowId, setExternalWorkflowId] = useState("");
  const [externalRef, setExternalRef] = useState("main");
  const [externalInputs, setExternalInputs] = useState("");
  const [showExternalHistory, setShowExternalHistory] = useState(false);
  const [externalError, setExternalError] = useState<string | null>(null);
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
  const externalSessionsQuery = trpc.workspace.terminal.external.list.useQuery(
    { projectId: currentProject?.id, limit: 50 },
    { enabled: Boolean(currentProject?.id && lane === "external"), staleTime: 5_000 },
  );
  const externalSessionQuery = trpc.workspace.terminal.external.get.useQuery(
    { sessionId: externalSessionId || "pending" },
    { enabled: Boolean(externalSessionId && lane === "external"), retry: false, refetchInterval: externalSessionId && lane === "external" ? 5_000 : false },
  );
  const githubRepositoriesQuery = trpc.workspace.github.repositories.useQuery(undefined, { enabled: lane === "external", staleTime: 30_000 });
  const workflowQuery = trpc.workspace.github.workflows.useQuery({ fullName: externalRepository }, { enabled: lane === "external" && Boolean(externalRepository), staleTime: 30_000 });

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
  const externalStartMutation = trpc.workspace.terminal.external.start.useMutation({
    onSuccess: (started) => { setExternalSessionId(started.sessionId); setExternalError(null); setShowExternalHistory(false); void utils.workspace.terminal.external.list.invalidate(); },
    onError: (cause) => setExternalError(cause.message),
  });
  const externalCancelMutation = trpc.workspace.terminal.external.cancel.useMutation({
    onSuccess: () => { setExternalError(null); void utils.workspace.terminal.external.get.invalidate({ sessionId: externalSessionId || "" }); },
    onError: (cause) => setExternalError(cause.message),
  });
  const externalRefreshMutation = trpc.workspace.terminal.external.refresh.useMutation({
    onSuccess: () => { setExternalError(null); void utils.workspace.terminal.external.get.invalidate({ sessionId: externalSessionId || "" }); },
    onError: (cause) => setExternalError(cause.message),
  });

  useEffect(() => {
    if (context?.requestedSessionId) {
      if (context.requestedLane === "external") {
        setLane("external");
        setExternalSessionId(context.requestedSessionId);
        setShowExternalHistory(false);
      } else {
        setLane("local");
        setActiveSessionId(context.requestedSessionId);
        setShowHistory(false);
        setError(null);
      }
    }
  }, [context?.requestedLane, context?.requestedSessionId]);

  useEffect(() => {
    if (!externalRepository && githubRepositoriesQuery.data?.repositories?.[0]) setExternalRepository(githubRepositoriesQuery.data.repositories[0].fullName);
  }, [externalRepository, githubRepositoriesQuery.data]);
  useEffect(() => {
    if (!externalWorkflowId && workflowQuery.data?.workflows?.[0]) setExternalWorkflowId(String(workflowQuery.data.workflows[0].id));
  }, [externalWorkflowId, workflowQuery.data]);
  useEffect(() => {
    if (externalSessionQuery.data) setExternalError(null);
  }, [externalSessionQuery.data]);

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
  const externalSession = externalSessionQuery.data;
  const externalActive = Boolean(externalSession && !TERMINAL_STATES.has(externalSession.state));
  const runExternalWorkflow = (event: React.FormEvent) => {
    event.preventDefault();
    const [owner, repository] = externalRepository.split("/");
    if (!currentProject || !owner || !repository || !externalWorkflowId || !externalRef.trim() || externalStartMutation.isPending) return;
    const inputs = Object.fromEntries(externalInputs.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean).map((line) => { const separator = line.indexOf("="); return separator > 0 ? [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] : [line.trim(), "true"]; }));
    externalStartMutation.mutate({ projectId: currentProject.id, request: { contractVersion: "1.0.0", lane: "github_actions", owner, repository, workflowId: externalWorkflowId, ref: externalRef.trim(), inputs, timeout: { timeoutMs: 24 * 60 * 60 * 1000 }, monitoringRules: [] } });
  };

  if (showHistory) {
    return <div className="terminal-history"><header className="terminal-history-header"><div><span className="terminal-eyebrow">LOCAL LANE</span><strong>Session history</strong></div><button className="icon-button" onClick={() => setShowHistory(false)} aria-label="Close session history"><X size={16} /></button></header><div className="terminal-history-list">{sessionsQuery.isLoading ? <div className="terminal-history-empty">Loading sessions…</div> : sessionsQuery.data?.map((item) => <button key={item.sessionId} className={`terminal-history-item ${activeSessionId === item.sessionId ? "active" : ""}`} onClick={() => selectSession(item)}><div className="terminal-history-item-main"><Command size={14} /><span><strong title={item.label || item.command}>{item.label || item.command}</strong><small>{item.workingDirectory}</small></span></div><div className="terminal-history-item-meta"><span className={`terminal-status-dot ${item.state}`} /><small>{stateLabel(item.state)}</small><time>{sessionDate(item.updatedAt)}</time></div></button>)}{!sessionsQuery.isLoading && !sessionsQuery.data?.length && <div className="terminal-history-empty">No recent sessions for this project.</div>}</div></div>;
  }

  if (lane === "external") {
    return <div className="terminal-container terminal-external-container"><header className="terminal-header"><div className="terminal-header-main"><Cloud size={16} /><div><span className="terminal-eyebrow">EXTERNAL LANE</span><strong>GitHub Actions</strong></div>{externalSession && <span className={`terminal-state-pill ${externalSession.state}`}>{stateLabel(externalSession.state)}</span>}</div><div className="terminal-header-actions"><button className="icon-button" onClick={() => setLane("local")} title="Local terminal" aria-label="Local terminal"><TerminalIcon size={14} /></button>{!readOnly && externalSession && externalActive && <button className="icon-button terminal-stop" onClick={() => externalCancelMutation.mutate({ sessionId: externalSession.sessionId })} disabled={externalCancelMutation.isPending} aria-label="Cancel external run" title="Cancel run"><Square size={14} fill="currentColor" /></button>}{externalSession && <button className="icon-button" onClick={() => externalRefreshMutation.mutate({ sessionId: externalSession.sessionId })} disabled={externalRefreshMutation.isPending} aria-label="Refresh external run" title="Refresh"><RefreshCw size={14} /></button>}</div></header><div className="terminal-lane-tabs"><button className="terminal-lane-tab" onClick={() => setLane("local")}><TerminalIcon size={13} /> Local</button><button className="terminal-lane-tab active"><Cloud size={13} /> External</button><button className="terminal-lane-history" onClick={() => setShowExternalHistory((value) => !value)}><History size={13} /> {showExternalHistory ? "Close runs" : "Run history"}</button></div>{showExternalHistory ? <div className="terminal-history-list terminal-external-history-list">{externalSessionsQuery.isLoading ? <div className="terminal-history-empty">Loading runs…</div> : externalSessionsQuery.data?.map((item) => <button key={item.sessionId} className={`terminal-history-item ${externalSessionId === item.sessionId ? "active" : ""}`} onClick={() => { setExternalSessionId(item.sessionId); setShowExternalHistory(false); }}><div className="terminal-history-item-main"><Cloud size={14} /><span><strong title={`${item.repository} · ${item.workflowId}`}>{item.repository}</strong><small>{item.workflowId} · {item.ref}</small></span></div><div className="terminal-history-item-meta"><span className={`terminal-status-dot ${item.state}`} /><small>{stateLabel(item.state)}</small><time>{sessionDate(item.updatedAt)}</time></div></button>) || <div className="terminal-history-empty">No external runs for this project.</div>}</div> : <><div className="terminal-project-bar"><span>REPOSITORY</span><strong title={externalRepository || "Choose a repository"}>{externalRepository || "Choose a repository"}</strong><small>{githubRepositoriesQuery.isLoading ? "Loading…" : `${githubRepositoriesQuery.data?.repositories?.length || 0} available`}</small></div>{!readOnly && <form className="terminal-external-form" onSubmit={runExternalWorkflow}><label><span>REPOSITORY</span><select value={externalRepository} onChange={(event) => { setExternalRepository(event.target.value); setExternalWorkflowId(""); }} aria-label="GitHub repository"><option value="">Choose repository</option>{githubRepositoriesQuery.data?.repositories?.map((repo) => <option key={repo.fullName} value={repo.fullName}>{repo.fullName}</option>)}</select></label><label><span>WORKFLOW</span><select value={externalWorkflowId} onChange={(event) => setExternalWorkflowId(event.target.value)} disabled={!externalRepository} aria-label="GitHub workflow"><option value="">Choose workflow</option>{workflowQuery.data?.workflows?.map((workflow) => <option key={workflow.id} value={String(workflow.id)}>{workflow.name} · {workflow.path}</option>)}</select></label><label><span>REF</span><input value={externalRef} onChange={(event) => setExternalRef(event.target.value)} placeholder="main" aria-label="GitHub ref" /></label><label><span>INPUTS</span><textarea value={externalInputs} onChange={(event) => setExternalInputs(event.target.value)} placeholder="key=value (one per line)" aria-label="Workflow inputs" rows={3} /></label><button className="terminal-run-button terminal-external-run-button" type="submit" disabled={!externalRepository || !externalWorkflowId || !externalRef.trim() || externalStartMutation.isPending}>{externalStartMutation.isPending ? <Loader2 size={14} className="terminal-spin" /> : <Play size={14} fill="currentColor" />} Dispatch workflow</button></form>}{externalError && <div className="terminal-error"><AlertCircle size={14} /><span>{externalError}</span><button onClick={() => setExternalError(null)} aria-label="Dismiss external error"><X size={12} /></button></div>}{readOnly && !externalSession && <div className="terminal-readonly-hint"><Cloud size={14} /><span>Agent-created External runs will appear here when the agent submits one.</span></div>}{externalSession && <div className="terminal-external-status"><div><span className="terminal-eyebrow">RUN STATUS</span><strong>{externalSession.summary}</strong><small>{externalSession.repository} · {externalSession.ref} · {externalSession.workflowId}</small></div><div className="terminal-external-events">{externalSession.events?.map((item) => <div key={item.sequence} className={`terminal-line ${item.kind}`}><span className="terminal-line-sequence">{String(item.sequence).padStart(2, "0")}</span><span className="terminal-line-body">{item.text || ""}</span></div>)}</div>{externalSession.artifacts?.length > 0 && <div className="terminal-artifacts"><span className="terminal-eyebrow">ARTIFACTS</span>{externalSession.artifacts.map((artifact) => <a key={String(artifact.id)} href={String(artifact.archiveDownloadUrl || "#")} target="_blank" rel="noreferrer noopener"><ExternalLink size={12} /> {String(artifact.name)}</a>)}</div>}</div>}</>}</div>;
  }

  return <div className="terminal-container"><header className="terminal-header"><div className="terminal-header-main"><TerminalIcon size={16} /><div><span className="terminal-eyebrow">LOCAL LANE</span><strong>Terminal</strong></div>{session && <span className={`terminal-state-pill ${session.state}`}>{stateLabel(session.state)}</span>}</div><div className="terminal-header-actions"><button className="icon-button" onClick={() => setLane("external")} title="GitHub Actions lane" aria-label="GitHub Actions lane"><Cloud size={15} /></button><button className="icon-button" onClick={() => setShowHistory(true)} title="Session history" aria-label="Session history"><History size={16} /></button>{!readOnly && active && <button className="icon-button terminal-stop" onClick={() => activeSessionId && cancelMutation.mutate({ sessionId: activeSessionId })} disabled={cancelMutation.isPending} title="Cancel session" aria-label="Cancel session"><Square size={14} fill="currentColor" /></button>}{!readOnly && session && !active && <button className="icon-button" onClick={clearSession} title="New session" aria-label="New session"><RotateCcw size={15} /></button>}</div></header><div className="terminal-project-bar"><span>PROJECT</span><strong title={currentProject.name}>{currentProject.name}</strong><small title={currentProject.id}>{currentProject.workspaceFileCount ? `${currentProject.workspaceFileCount} files` : "Local workspace"}</small></div><div className="terminal-output" ref={outputRef} role="log" aria-live="polite">{!events.length && <div className="terminal-output-empty"><TerminalIcon size={22} /><span>{readOnly ? "Select an agent action to monitor its session." : "Run a command in the selected project."}</span></div>}{events.map((event) => <div key={event.sequence} className={`terminal-line ${event.kind}`}><span className="terminal-line-sequence">{String(event.sequence).padStart(2, "0")}</span><span className="terminal-line-body">{event.kind === "status" ? <span className="terminal-status-label">{stateLabel(event.state)}</span> : event.kind === "stdin" ? <ChevronRight size={12} className="terminal-prompt-icon" /> : null}<span>{event.text || event.input || ""}</span></span></div>)}{active && <span className="terminal-cursor" />}{error && <div className="terminal-error"><AlertCircle size={14} /><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss terminal error"><X size={12} /></button></div>}</div><footer className="terminal-footer">{readOnly ? <div className="terminal-readonly-hint"><TerminalIcon size={14} /><span>Agent controls execution. Select an action card to monitor its session here.</span></div> : active && session?.interactive ? <form className="terminal-input-form" onSubmit={sendInput}><ChevronRight size={14} /><input value={inputDraft} onChange={(event) => setInputDraft(event.target.value)} placeholder="Send input to the running process…" aria-label="Terminal input" autoFocus />{inputMutation.isPending && <Loader2 size={14} className="terminal-spin" />}<button type="submit" disabled={!inputDraft || inputMutation.isPending}>Send</button></form> : <form className="terminal-command-form" onSubmit={runCommand}><div className="terminal-command-row"><Play size={14} className="terminal-run-icon" /><input value={commandDraft} onChange={(event) => setCommandDraft(event.target.value)} placeholder="Enter command to run…" disabled={startMutation.isPending} aria-label="Terminal command" />{startMutation.isPending && <Loader2 size={14} className="terminal-spin" />}<button className="terminal-run-button" type="submit" disabled={!commandDraft.trim() || startMutation.isPending} aria-label="Run command"><Play size={13} fill="currentColor" /></button></div><div className="terminal-command-options"><label><span>DIR</span><input value={workingDirectory} onChange={(event) => setWorkingDirectory(event.target.value)} placeholder="." aria-label="Working directory" /></label><label className="terminal-checkbox"><input type="checkbox" checked={interactive} onChange={(event) => setInteractive(event.target.checked)} /><span>Interactive</span></label><label><span>TIMEOUT</span><input type="number" min="1" max="10080" value={timeoutMinutes} onChange={(event) => setTimeoutMinutes(Math.max(1, Number(event.target.value) || 1))} aria-label="Timeout in minutes" /><em>min</em></label></div></form>}</footer></div>;
}

export default TerminalApp;
