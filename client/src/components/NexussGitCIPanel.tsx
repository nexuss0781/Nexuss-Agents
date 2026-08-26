import { useMemo, useState } from "react";
import { Activity, ArrowUpFromLine, CheckCircle2, ChevronDown, ChevronLeft, CircleAlert, Clock3, ExternalLink, GitBranch, GitCommitHorizontal, RefreshCw, X } from "lucide-react";
import { trpc } from "@/lib/trpc";

type Repository = { fullName: string; defaultBranch: string };
type Run = { id: number; name: string; title: string; status: string; conclusion: string | null; event: string; htmlUrl: string | null; branch: string | null; runNumber: number | null };
type Job = { id: number; name: string; status: string; conclusion: string | null; steps: Array<{ name: string; status: string; conclusion: string | null; number: number | null }> };

function normalizedStatus(value: string | null | undefined) {
  return (value || "queued").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function statusLabel(value: string | null | undefined) {
  const status = (value || "queued").replace(/_/g, " ");
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusTone(value: string | null | undefined) {
  const status = normalizedStatus(value);
  if (status === "success" || status === "completed-success") return "success";
  if (status === "failure" || status === "cancelled" || status === "timed-out") return "failure";
  if (status === "in-progress" || status === "queued" || status === "requested") return "active";
  return "neutral";
}

function StatusMark({ value, size = 15 }: { value: string | null | undefined; size?: number }) {
  const tone = statusTone(value);
  if (tone === "success") return <CheckCircle2 size={size} />;
  if (tone === "failure") return <CircleAlert size={size} />;
  if (tone === "active") return <RefreshCw size={size} className="nexuss-git-activity-spin" />;
  return <Clock3 size={size} />;
}

export default function NexussGitCIPanel({ repository }: { repository: Repository | null }) {
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [selectedJob, setSelectedJob] = useState<number | null>(null);
  const runs = trpc.workspace.github.workflowRuns.useQuery({ fullName: repository?.fullName || "placeholder/repository" }, { enabled: Boolean(repository), retry: false, staleTime: 20_000 });
  const jobs = trpc.workspace.github.workflowJobs.useQuery({ fullName: repository?.fullName || "placeholder/repository", runId: selectedRun?.id || 1 }, { enabled: Boolean(repository && selectedRun), retry: false, staleTime: 20_000 });
  const logs = trpc.workspace.github.workflowLogs.useQuery({ fullName: repository?.fullName || "placeholder/repository", jobId: selectedJob || 1 }, { enabled: Boolean(repository && selectedJob), retry: false, staleTime: 20_000 });
  const runList = (runs.data?.runs || []) as Run[];
  const successfulRuns = useMemo(() => runList.filter((run) => statusTone(run.conclusion || run.status) === "success").length, [runList]);
  const latestStatus = runList[0]?.conclusion || runList[0]?.status || "waiting";

  if (!repository) {
    return <div className="nexuss-git-activity-empty"><div className="nexuss-git-activity-empty-mark"><Activity size={18} /></div><span className="nexuss-git-eyebrow">Developer activity</span><strong>Choose a repository</strong><p>Workflow runs, job health, and logs will appear here once a repository is selected.</p></div>;
  }

  if (selectedRun) {
    return <div className="nexuss-git-activity-workspace">
      <div className="nexuss-git-activity-detail-topline"><button type="button" className="nexuss-git-back-link" onClick={() => { setSelectedRun(null); setSelectedJob(null); }}><ChevronLeft size={13} /> Activity</button>{selectedRun.htmlUrl ? <a href={selectedRun.htmlUrl} target="_blank" rel="noreferrer noopener" className="nexuss-git-activity-external">Open run <ExternalLink size={12} /></a> : null}</div>
      <div className="nexuss-git-activity-detail-hero"><div className={`nexuss-git-activity-status-mark is-${statusTone(selectedRun.conclusion || selectedRun.status)}`}><StatusMark value={selectedRun.conclusion || selectedRun.status} size={20} /></div><div className="nexuss-git-activity-detail-copy"><span className="nexuss-git-eyebrow">Workflow run {selectedRun.runNumber ? `#${selectedRun.runNumber}` : ""}</span><h2>{selectedRun.title}</h2><p>{selectedRun.name}</p></div><span className={`nexuss-git-activity-state is-${statusTone(selectedRun.conclusion || selectedRun.status)}`}>{statusLabel(selectedRun.conclusion || selectedRun.status)}</span></div>
      <div className="nexuss-git-activity-detail-meta"><span><GitBranch size={13} />{selectedRun.branch || repository.defaultBranch}</span><span><GitCommitHorizontal size={13} />{selectedRun.event || "workflow"}</span><span><Clock3 size={13} />{repository.fullName}</span></div>
      <section className="nexuss-git-activity-section"><div className="nexuss-git-activity-section-heading"><div><span className="nexuss-git-eyebrow">Execution map</span><h3>Jobs in this run</h3></div><span className="nexuss-git-activity-section-count">{jobs.data?.jobs?.length || 0} jobs</span></div>{jobs.isLoading ? <div className="nexuss-git-activity-placeholder"><RefreshCw size={16} className="nexuss-git-activity-spin" /> Loading job activity…</div> : jobs.isError ? <div className="nexuss-git-activity-placeholder is-error"><X size={16} /> Jobs could not be loaded.<button type="button" onClick={() => void jobs.refetch()}>Retry</button></div> : <div className="nexuss-git-activity-jobs">{(jobs.data?.jobs as Job[] || []).map((job) => { const jobStatus = job.conclusion || job.status; const isSelected = selectedJob === job.id; return <article className={`nexuss-git-activity-job ${isSelected ? "is-open" : ""}`} key={job.id}><button type="button" className="nexuss-git-activity-job-head" onClick={() => setSelectedJob(isSelected ? null : job.id)}><span className={`nexuss-git-activity-job-mark is-${statusTone(jobStatus)}`}><StatusMark value={jobStatus} size={14} /></span><span className="nexuss-git-activity-job-name"><strong>{job.name}</strong><small>{job.steps.length} {job.steps.length === 1 ? "step" : "steps"}</small></span><span className={`nexuss-git-activity-state is-${statusTone(jobStatus)}`}>{statusLabel(jobStatus)}</span><ChevronDown size={14} className={isSelected ? "is-open" : ""} /></button>{isSelected ? <div className="nexuss-git-activity-job-body"><div className="nexuss-git-activity-steps">{job.steps.map((step) => <div className="nexuss-git-activity-step" key={`${job.id}-${step.number}-${step.name}`}><span className={`nexuss-git-activity-step-mark is-${statusTone(step.conclusion || step.status)}`}><StatusMark value={step.conclusion || step.status} size={11} /></span><span>{step.name}</span><em>{statusLabel(step.conclusion || step.status)}</em></div>)}</div><div className="nexuss-git-activity-log-heading"><span>Job output</span>{logs.isLoading ? <small>Loading…</small> : logs.isError ? <small className="is-error">Unavailable</small> : <small>Read-only log</small>}</div>{logs.isLoading ? <div className="nexuss-git-activity-log-placeholder"><RefreshCw size={14} className="nexuss-git-activity-spin" /> Loading logs…</div> : logs.isError ? <div className="nexuss-git-activity-log-placeholder is-error"><X size={14} /> Logs unavailable.</div> : <pre className="nexuss-git-activity-log">{logs.data?.logs || "No log output was returned."}</pre>}</div> : null}</article>; })}</div>}</section>
    </div>;
  }

  return <div className="nexuss-git-activity-workspace">
    <div className="nexuss-git-activity-heading"><div><span className="nexuss-git-eyebrow">{repository.fullName}</span><h2>Developer activity</h2><p>Workflow health, deployment runs, and execution logs in one place.</p></div><button type="button" className="nexuss-git-icon-button" onClick={() => void runs.refetch()} aria-label="Refresh workflow runs" title="Refresh workflow runs"><RefreshCw size={13} /></button></div>
    <div className="nexuss-git-activity-summary"><div><span>Latest run</span><strong className={`is-${statusTone(latestStatus)}`}>{statusLabel(latestStatus)}</strong><small>{runList[0]?.name || "No run selected"}</small></div><div><span>Successful</span><strong>{successfulRuns}<small> / {runList.length || 0}</small></strong><small>completed runs</small></div><div><span>Branch</span><strong>{repository.defaultBranch}</strong><small>tracked by default</small></div></div>
    <section className="nexuss-git-activity-section"><div className="nexuss-git-activity-section-heading"><div><span className="nexuss-git-eyebrow">Run history</span><h3>Recent workflow runs</h3></div><span className="nexuss-git-activity-section-count">{runList.length} total</span></div>{runs.isLoading ? <div className="nexuss-git-activity-placeholder"><RefreshCw size={16} className="nexuss-git-activity-spin" /> Loading workflow activity…</div> : runs.isError ? <div className="nexuss-git-activity-placeholder is-error"><X size={16} /> Workflow runs could not be loaded.<button type="button" onClick={() => void runs.refetch()}>Retry</button></div> : !runList.length ? <div className="nexuss-git-activity-placeholder"><Activity size={17} /> No workflow runs found for this repository.</div> : <div className="nexuss-git-activity-timeline">{runList.map((run) => { const runStatus = run.conclusion || run.status; return <button type="button" key={run.id} className="nexuss-git-activity-run" onClick={() => { setSelectedRun(run); setSelectedJob(null); }}><span className={`nexuss-git-activity-run-line is-${statusTone(runStatus)}`}><span className="nexuss-git-activity-run-dot"><StatusMark value={runStatus} size={12} /></span></span><span className="nexuss-git-activity-run-copy"><strong>{run.title}</strong><small>{run.name} <i>·</i> {run.branch || repository.defaultBranch} <i>·</i> {run.event || "workflow"}</small></span><span className={`nexuss-git-activity-state is-${statusTone(runStatus)}`}>{statusLabel(runStatus)}</span><ChevronDown size={14} className="nexuss-git-activity-open" /></button>; })}</div>}</section>
  </div>;
}
