import React from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Cpu,
  DollarSign,
  History,
  Layers,
  RefreshCw,
  Search,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { FinalAnswerRenderer } from "./FinalAnswerRenderer";
import { auditStepFailed } from "../utils/runOutcomes";

type OutcomeKind =
  | "completed"
  | "checkpoint_turn_limit"
  | "checkpoint_rate_limit"
  | "cancelled"
  | "fatal_error"
  | "unknown";

type ThreadStatus = "completed" | "paused" | "waiting_cooldown" | "cancelled" | "failed";

interface RunAuditStep {
  step?: number | string;
  id?: number | string;
  thought?: string;
  action?: string;
  actionInput?: unknown;
  action_input?: unknown;
  observation?: string;
}

interface PerformanceTraceSpan {
  name: string;
  durationMs: number;
}

interface PerformanceTraceSummary {
  name: string;
  durationMs: number;
  firstEventLatencyMs?: number;
  counters?: Record<string, number>;
  spans?: PerformanceTraceSpan[];
}

interface AuditPage {
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  nextOffset: number;
}

interface RunAudit {
  id: string;
  threadId?: string;
  runId?: string;
  parentRunId?: string;
  attemptIndex?: number;
  outcomeKind?: OutcomeKind;
  threadTitle?: string;
  cumulativeCost?: number;
  cumulativeSteps?: number;
  success?: boolean;
  timestamp?: string;
  task?: string;
  budget?: number;
  stepCount?: number;
  steps?: RunAuditStep[];
  model?: string;
  totalPollenCost?: number;
  pollenCost?: number;
  error?: string;
  finalAnswer?: string;
  filesChanged?: string[];
  successfulMutations?: number;
  failedMutations?: number;
  completionConfidence?: "confirmed" | "unsupported" | "partial" | "unknown";
  performanceTrace?: PerformanceTraceSummary;
  verificationResult?: {
    passed?: boolean;
    signals?: Array<{ name: string; passed: boolean }>;
  };
  stepsPagination?: AuditPage;
}

interface ThreadAudit {
  threadId: string;
  threadTitle?: string;
  status: ThreadStatus;
  latestOutcomeKind?: OutcomeKind;
  totalAttempts: number;
  totalSteps: number;
  totalPollenCost: number;
  filesChanged: string[];
  lastModel: string;
  lastTimestamp: string;
  runs: RunAudit[];
  performanceSummary?: { durationMs: number; tokens: number };
  detailLoaded?: boolean;
  pagination?: AuditPage;
}

interface RunAuditsPanelProps {
  workspace?: string;
  refreshToken?: number;
  selectedRunId?: string | null;
  onOpenThread?: (threadId: string, runId?: string) => void;
}

const formatTimestamp = (value?: string) => {
  if (!value) return "Unknown time";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const normalizeStepInput = (step: RunAuditStep) => step.actionInput ?? step.action_input ?? {};
const getPerformanceTrace = (run: RunAudit) => run.performanceTrace;
const getRunDuration = (run: RunAudit): number => getPerformanceTrace(run)?.durationMs || 0;

export const getRunTokenUsage = (run: RunAudit): number => {
  const counters = getPerformanceTrace(run)?.counters || {};
  const inputTokens = counters.llm_input_tokens || 0;
  const outputTokens = counters.llm_output_tokens || 0;
  return counters.llm_total_tokens || inputTokens + outputTokens;
};

const getThreadDuration = (thread: ThreadAudit) => thread.performanceSummary?.durationMs ?? thread.runs.reduce((sum, run) => sum + getRunDuration(run), 0);
const getThreadTokens = (thread: ThreadAudit) => thread.performanceSummary?.tokens ?? thread.runs.reduce((sum, run) => sum + getRunTokenUsage(run), 0);

export const getRunTokensPerSecond = (run: RunAudit): number | undefined => {
  const durationMs = getRunDuration(run);
  const totalTokens = getRunTokenUsage(run);
  if (durationMs <= 0 || totalTokens <= 0) return undefined;
  return totalTokens / (durationMs / 1000);
};

const getThreadTokensPerSecond = (thread: ThreadAudit): number | undefined => {
  const durationMs = getThreadDuration(thread);
  const totalTokens = getThreadTokens(thread);
  if (durationMs <= 0 || totalTokens <= 0) return undefined;
  return totalTokens / (durationMs / 1000);
};

const formatTokenCount = (value: number) => value > 0 ? value.toLocaleString() : "Unknown";
const formatTokensPerSecond = (value?: number) => value && Number.isFinite(value) && value > 0 ? `${Math.round(value).toLocaleString()} tok/s` : "Unknown";

const needsCompletionWarning = (run: RunAudit) =>
  run.completionConfidence === "unsupported" ||
  ((run.success || run.outcomeKind === "completed") && (run.failedMutations || 0) > 0) ||
  ((run.success || run.outcomeKind === "completed") && Boolean(run.finalAnswer) && (run.successfulMutations || 0) === 0 && /\b(updated|changed|modified|edited|wrote|created|added|removed|deleted|implemented|fixed|marked)\b/i.test(run.finalAnswer || ""));

const repeatedInspectionWarning = (run: RunAudit) => (getPerformanceTrace(run)?.counters?.repeated_reads || 0) > 0;
const threadNeedsReview = (thread: ThreadAudit) => thread.runs.some((run) => needsCompletionWarning(run) || repeatedInspectionWarning(run));

const statusLabel = (status: ThreadStatus) => {
  switch (status) {
    case "completed": return "Completed";
    case "paused": return "Paused at checkpoint";
    case "waiting_cooldown": return "Waiting cooldown";
    case "cancelled": return "Cancelled";
    default: return "Failed";
  }
};

const statusClasses = (status: ThreadStatus) => {
  switch (status) {
    case "completed": return "border-emerald-500/30 bg-emerald-950/30 text-emerald-300";
    case "paused": return "border-amber-500/30 bg-amber-950/30 text-amber-300";
    case "waiting_cooldown": return "border-orange-500/30 bg-orange-950/30 text-orange-300";
    case "cancelled": return "border-slate-500/30 bg-slate-950/30 text-slate-300";
    default: return "border-rose-500/30 bg-rose-950/30 text-rose-300";
  }
};

const outcomeLabel = (outcome?: OutcomeKind, success?: boolean) => {
  switch (outcome) {
    case "completed": return "Completed";
    case "checkpoint_turn_limit": return "Checkpoint · turn limit";
    case "checkpoint_rate_limit": return "Checkpoint · rate limit";
    case "cancelled": return "Cancelled";
    case "fatal_error": return "Fatal error";
    default: return success ? "Completed" : "Failed";
  }
};

const formatDuration = (value?: number) => {
  if (!Number.isFinite(value || 0)) return "0ms";
  const duration = Math.max(0, value || 0);
  if (duration >= 1000) return `${(duration / 1000).toFixed(1)}s`;
  return `${Math.round(duration)}ms`;
};

const formatPercent = (value?: number) => Number.isFinite(value || 0) ? `${Math.max(0, value || 0).toFixed(1)}%` : "0.0%";

const getSlowestSpans = (trace?: PerformanceTraceSummary) =>
  [...(trace?.spans || [])].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5);

function runFromLegacyRecord(run: RunAudit): ThreadAudit {
  return {
    threadId: run.threadId || `legacy:${run.id}`,
    threadTitle: run.threadTitle || run.task || "Legacy run",
    status: run.outcomeKind === "completed" || run.success ? "completed" : run.outcomeKind === "checkpoint_turn_limit" ? "paused" : run.outcomeKind === "checkpoint_rate_limit" ? "waiting_cooldown" : run.outcomeKind === "cancelled" ? "cancelled" : "failed",
    latestOutcomeKind: run.outcomeKind,
    totalAttempts: 1,
    totalSteps: run.stepCount || run.steps?.length || 0,
    totalPollenCost: run.totalPollenCost || run.pollenCost || 0,
    filesChanged: run.filesChanged || [],
    lastModel: run.model || "unknown",
    lastTimestamp: run.timestamp || "",
    runs: [run],
  };
}

export function RunAuditsPanel({ workspace = "", refreshToken = 0, selectedRunId = null, onOpenThread }: RunAuditsPanelProps) {
  const [threads, setThreads] = React.useState<ThreadAudit[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingThreadDetails, setLoadingThreadDetails] = React.useState<string | null>(null);
  const [loadingOlderSteps, setLoadingOlderSteps] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedThreadId, setExpandedThreadId] = React.useState<string | null>(null);
  const [expandedAttemptId, setExpandedAttemptId] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<"all" | "success" | "failed" | "review">("all");
  const [durationFilter, setDurationFilter] = React.useState<"all" | "fast" | "medium" | "slow" | "very_slow">("all");
  const [tokenFilter, setTokenFilter] = React.useState<"all" | "low" | "medium" | "high" | "very_high">("all");
  const [sortBy, setSortBy] = React.useState<"timestamp" | "status" | "duration" | "tokens" | "cost" | "steps">("timestamp");
  const [sortOrder, setSortOrder] = React.useState<"desc" | "asc">("desc");
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [showRawLog, setShowRawLog] = React.useState(false);
  const [rawLog, setRawLog] = React.useState("");

  const resetFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setDurationFilter("all");
    setTokenFilter("all");
    setSortBy("timestamp");
    setSortOrder("desc");
  };

  const hasActiveFilters = searchQuery.trim() !== "" || statusFilter !== "all" || durationFilter !== "all" || tokenFilter !== "all" || sortBy !== "timestamp" || sortOrder !== "desc";

  const fetchThreads = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/run-audits?limit=100");
      if (!response.ok) throw new Error(`Failed to load audit threads (${response.status})`);
      const data = await response.json();
      if (Array.isArray(data.threads)) {
        setThreads(data.threads);
      } else {
        const legacyResponse = await fetch("/api/react/logs");
        const legacyData = await legacyResponse.json();
        setThreads(Array.isArray(legacyData.runs) ? legacyData.runs.map(runFromLegacyRecord) : []);
      }
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load audit threads");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchThreads();
  }, [fetchThreads, refreshToken]);

  React.useEffect(() => {
    setSearchQuery(selectedRunId || "");
  }, [selectedRunId]);

  const toggleThread = async (thread: ThreadAudit) => {
    const nextExpanded = expandedThreadId === thread.threadId ? null : thread.threadId;
    setExpandedThreadId(nextExpanded);
    setExpandedAttemptId(null);
    if (!nextExpanded || thread.detailLoaded) return;
    setLoadingThreadDetails(thread.threadId);
    try {
      const response = await fetch(`/api/react/threads/${encodeURIComponent(thread.threadId)}?limit=20`);
      if (!response.ok) throw new Error(`Failed to load thread details (${response.status})`);
      const data = await response.json();
      if (data.thread) setThreads((current) => current.map((candidate) => candidate.threadId === thread.threadId
        ? { ...data.thread, detailLoaded: true, pagination: data.pagination }
        : candidate));
    } catch (err: any) {
      setError(err.message || "Failed to load thread details");
    } finally {
      setLoadingThreadDetails((current) => current === thread.threadId ? null : current);
    }
  };

  const loadOlderAttempts = async (thread: ThreadAudit) => {
    const pagination = thread.pagination;
    if (!pagination?.hasMore) return;
    setLoadingThreadDetails(thread.threadId);
    try {
      const response = await fetch(`/api/react/threads/${encodeURIComponent(thread.threadId)}?limit=${pagination.limit}&offset=${pagination.nextOffset}`);
      if (!response.ok) throw new Error(`Failed to load older attempts (${response.status})`);
      const data = await response.json();
      if (!data.thread) return;
      setThreads((current) => current.map((candidate) => {
        if (candidate.threadId !== thread.threadId) return candidate;
        const byId = new Map<string, RunAudit>();
        for (const run of [...(data.thread.runs || []), ...candidate.runs]) byId.set(run.id, run);
        const runs = [...byId.values()].sort((left, right) => (left.attemptIndex || 0) - (right.attemptIndex || 0)
          || String(left.timestamp || '').localeCompare(String(right.timestamp || '')));
        return { ...candidate, runs, pagination: data.pagination };
      }));
    } catch (err: any) {
      setError(err.message || "Failed to load older attempts");
    } finally {
      setLoadingThreadDetails((current) => current === thread.threadId ? null : current);
    }
  };

  const loadOlderSteps = async (threadId: string, run: RunAudit) => {
    const pagination = run.stepsPagination;
    if (!pagination?.hasMore) return;
    const runId = run.runId || run.id;
    setLoadingOlderSteps(run.id);
    try {
      const response = await fetch(`/api/react/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/steps?limit=${pagination.limit}&offset=${pagination.nextOffset}`);
      if (!response.ok) throw new Error(`Failed to load older audit steps (${response.status})`);
      const data = await response.json();
      setThreads((current) => current.map((thread) => thread.threadId !== threadId ? thread : {
        ...thread,
        runs: thread.runs.map((candidate) => candidate.id !== run.id ? candidate : {
          ...candidate,
          steps: [...(data.steps || []), ...(candidate.steps || [])],
          stepsPagination: data.pagination,
        }),
      }));
    } catch (err: any) {
      setError(err.message || "Failed to load older audit steps");
    } finally {
      setLoadingOlderSteps((current) => current === run.id ? null : current);
    }
  };

  const clearRuns = async () => {
    if (!window.confirm("Are you sure you want to clear all ReAct audit logs?")) return;
    try {
      const response = await fetch("/api/react/logs/clear", { method: "POST" });
      if (!response.ok) throw new Error(`Failed to clear logs (${response.status})`);
      setThreads([]);
      setExpandedThreadId(null);
    } catch (err: any) {
      setError(err.message || "Failed to clear logs");
    }
  };

  const fetchRawLog = async () => {
    try {
      const response = await fetch("/api/react/logs/raw");
      if (!response.ok) throw new Error(`Failed to load raw log (${response.status})`);
      setRawLog(await response.text());
      setShowRawLog(true);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load raw log");
    }
  };

  const copyText = (value: string, id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1600);
  };

  const filteredAndSortedThreads = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = threads.filter((thread) => {
      const searchable = [thread.threadId, thread.threadTitle, thread.lastModel, ...thread.runs.flatMap((run) => [run.id, run.runId, run.task, run.model])].filter(Boolean).join(" ").toLowerCase();
      const matchesSearch = !query || searchable.includes(query);
      const matchesStatus = statusFilter === "all" || (statusFilter === "success" && thread.status === "completed") || (statusFilter === "failed" && thread.status === "failed") || (statusFilter === "review" && threadNeedsReview(thread));
      const duration = getThreadDuration(thread);
      const matchesDuration = durationFilter === "all" || (durationFilter === "fast" && duration < 1000) || (durationFilter === "medium" && duration >= 1000 && duration < 10000) || (durationFilter === "slow" && duration >= 10000) || (durationFilter === "very_slow" && duration >= 30000);
      const tokens = getThreadTokens(thread);
      const matchesTokens = tokenFilter === "all" || (tokenFilter === "low" && tokens > 0 && tokens < 1000) || (tokenFilter === "medium" && tokens >= 1000 && tokens < 10000) || (tokenFilter === "high" && tokens >= 10000) || (tokenFilter === "very_high" && tokens >= 50000);
      return matchesSearch && matchesStatus && matchesDuration && matchesTokens;
    });
    return [...filtered].sort((a, b) => {
      let comparison = 0;
      if (sortBy === "timestamp") comparison = new Date(a.lastTimestamp).getTime() - new Date(b.lastTimestamp).getTime();
      else if (sortBy === "status") comparison = statusLabel(a.status).localeCompare(statusLabel(b.status));
      else if (sortBy === "duration") comparison = getThreadDuration(a) - getThreadDuration(b);
      else if (sortBy === "tokens") comparison = getThreadTokens(a) - getThreadTokens(b);
      else if (sortBy === "cost") comparison = a.totalPollenCost - b.totalPollenCost;
      else if (sortBy === "steps") comparison = a.totalSteps - b.totalSteps;
      return sortOrder === "desc" ? -comparison : comparison;
    });
  }, [threads, searchQuery, statusFilter, durationFilter, tokenFilter, sortBy, sortOrder]);

  const successfulThreads = threads.filter((thread) => thread.status === "completed").length;
  const successRate = threads.length ? ((successfulThreads / threads.length) * 100).toFixed(1) : "0.0";
  const totalCost = threads.reduce((sum, thread) => sum + thread.totalPollenCost, 0);
  const totalSteps = threads.reduce((sum, thread) => sum + thread.totalSteps, 0);
  const totalAttempts = threads.reduce((sum, thread) => sum + thread.totalAttempts, 0);
  const averageDuration = totalAttempts ? threads.reduce((sum, thread) => sum + getThreadDuration(thread), 0) / totalAttempts : 0;
  const averageContextTokens = totalAttempts ? threads.reduce((sum, thread) => sum + thread.runs.reduce((inner, run) => inner + (getPerformanceTrace(run)?.counters?.estimated_context_tokens || 0), 0), 0) / totalAttempts : 0;
  const totalTokens = threads.reduce((sum, thread) => sum + getThreadTokens(thread), 0);
  const totalTraceDuration = threads.reduce((sum, thread) => sum + getThreadDuration(thread), 0);
  const averageTokensPerSecond = totalTraceDuration > 0 && totalTokens > 0 ? totalTokens / (totalTraceDuration / 1000) : undefined;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-8">
        <MetricCard icon={<ShieldCheck className="h-5 w-5" />} label="Pass rate" value={`${successRate}%`} detail="tasks" />
        <MetricCard icon={<DollarSign className="h-5 w-5" />} label="Pollen expenditure" value={totalCost.toFixed(4)} detail="pollen" />
        <MetricCard icon={<History className="h-5 w-5" />} label="Total tasks" value={String(threads.length)} detail={`${totalAttempts} attempts`} />
        <MetricCard icon={<Layers className="h-5 w-5" />} label="Total steps" value={String(totalSteps)} detail="across tasks" />
        <MetricCard icon={<Activity className="h-5 w-5" />} label="Avg attempt runtime" value={formatDuration(averageDuration)} detail="traced" />
        <MetricCard icon={<Cpu className="h-5 w-5" />} label="Avg context" value={Math.round(averageContextTokens).toLocaleString()} detail="tokens" />
        <MetricCard icon={<Cpu className="h-5 w-5" />} label="Total token usage" value={formatTokenCount(totalTokens)} detail="tokens" />
        <MetricCard icon={<Activity className="h-5 w-5" />} label="Avg throughput" value={formatTokensPerSecond(averageTokensPerSecond)} detail="" />
      </div>

      <section className="rounded-xl border border-border-main bg-bg-panel p-6">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white"><History className="h-4 w-4 text-cyan-400" /><span className="text-text-dim">ReAct Execution:</span>Thread Audits</h2>
            <p className="mt-1 text-xs text-text-dim">One lifecycle row per task, with checkpoint and continuation attempts nested underneath.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={fetchRawLog} className="flex items-center gap-1.5 rounded border border-border-main bg-bg-main px-3 py-2 text-xs font-bold uppercase tracking-wider text-text-dim transition hover:text-white"><TerminalSquare className="h-3.5 w-3.5" /> Raw Log</button><button type="button" onClick={fetchThreads} disabled={loading} className="flex items-center gap-1.5 rounded border border-border-main bg-bg-main px-3 py-2 text-xs font-bold uppercase tracking-wider text-cyan-400 transition hover:bg-cyan-950/20 disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh</button><button type="button" onClick={clearRuns} disabled={threads.length === 0} className="flex items-center gap-1.5 rounded border border-red-900/30 bg-red-950/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-red-400 transition hover:bg-red-950/30 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Clear History</button></div>
        </div>

        {error && <div className="mb-4 rounded border border-red-900/40 bg-red-950/20 p-3 text-sm text-red-300">{error}</div>}
        {showRawLog && <div className="mb-6 rounded-xl border border-border-main bg-bg-main p-4 font-mono text-xs"><div className="mb-3 flex items-center justify-between border-b border-border-main pb-2"><span className="font-semibold uppercase tracking-wider text-text-dim">logs/react_runs.log</span><button type="button" onClick={() => setShowRawLog(false)} className="rounded bg-bg-active px-2 py-1 text-[10px] text-text-dim transition hover:text-white">Close</button></div><pre className="custom-scrollbar max-h-72 overflow-auto whitespace-pre rounded border border-border-main bg-black/30 p-3 text-zinc-300">{rawLog}</pre></div>}

        <div className="mb-6 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center"><label className="flex min-h-[42px] flex-1 items-center gap-3 rounded-xl border border-border-main bg-bg-main px-4 transition focus-within:border-cyan-400"><Search className="h-4 w-4 shrink-0 text-text-dark" /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search by thread, task, attempt ID, or model..." className="w-full bg-transparent text-sm text-white outline-none placeholder:text-text-dark" />{searchQuery && <button type="button" onClick={() => setSearchQuery("")} className="p-1 text-text-dark hover:text-white" title="Clear search"><X className="h-3.5 w-3.5" /></button>}</label>{hasActiveFilters && <button type="button" onClick={resetFilters} className="flex items-center justify-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-950/20 px-3 py-2.5 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-900/30"><X className="h-3.5 w-3.5" /> Reset Filters</button>}</div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5"><FilterSelect label="Status" icon={<ShieldCheck className="h-3.5 w-3.5 shrink-0 text-cyan-400" />} value={statusFilter} onChange={(value) => setStatusFilter(value as typeof statusFilter)} options={[["all", "All statuses"], ["success", "Completed threads"], ["failed", "Failed threads"], ["review", "Needs review"]]} /><FilterSelect label="Duration" icon={<Clock className="h-3.5 w-3.5 shrink-0 text-amber-400" />} value={durationFilter} onChange={(value) => setDurationFilter(value as typeof durationFilter)} options={[["all", "Any duration"], ["fast", "Fast (< 1s)"], ["medium", "Medium (1s - 10s)"], ["slow", "Slow (> 10s)"], ["very_slow", "Very slow (> 30s)"]]} /><FilterSelect label="Tokens" icon={<Cpu className="h-3.5 w-3.5 shrink-0 text-emerald-400" />} value={tokenFilter} onChange={(value) => setTokenFilter(value as typeof tokenFilter)} options={[["all", "Any tokens"], ["low", "Low (< 1k)"], ["medium", "Medium (1k - 10k)"], ["high", "High (> 10k)"], ["very_high", "Very high (> 50k)"]]} /><FilterSelect label="Sort" icon={<ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-cyan-400" />} value={sortBy} onChange={(value) => setSortBy(value as typeof sortBy)} options={[["timestamp", "Last activity"], ["status", "Status"], ["duration", "Runtime"], ["tokens", "Token usage"], ["cost", "Pollen cost"], ["steps", "Action count"]]} /><button type="button" onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")} className="flex items-center justify-between gap-2 rounded-lg border border-border-main bg-bg-main px-3 py-2 text-xs text-white transition hover:bg-bg-active"><span className="font-medium text-text-dim">Order:</span><span className="flex items-center gap-1 font-mono font-semibold text-cyan-300">{sortOrder === "desc" ? <>Desc <ArrowDown className="h-3.5 w-3.5" /></> : <>Asc <ArrowUp className="h-3.5 w-3.5" /></>}</span></button></div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-main/50 pt-3 text-xs text-text-dim"><span className="font-mono text-[11px] font-semibold text-white">Showing {filteredAndSortedThreads.length} of {threads.length} threads</span>{hasActiveFilters && <span className="font-mono text-[11px] text-text-dark">Filters or sorting active</span>}</div>
        </div>

        {loading ? <div className="flex flex-col items-center justify-center gap-3 py-16 font-mono text-[10px] uppercase tracking-wider text-text-dim"><RefreshCw className="h-6 w-6 animate-spin text-cyan-400" /> Fetching thread audit history</div> : filteredAndSortedThreads.length === 0 ? <div className="rounded-xl border border-dashed border-border-main py-16 text-center font-mono text-[10px] uppercase tracking-wider text-text-dark">No matching thread audits located</div> : <div className="custom-scrollbar max-h-[760px] space-y-3 overflow-y-auto pr-1">{filteredAndSortedThreads.map((thread) => <ThreadRow key={thread.threadId} thread={thread} isExpanded={expandedThreadId === thread.threadId} expandedAttemptId={expandedAttemptId} onToggle={() => void toggleThread(thread)} onToggleAttempt={(attemptId) => setExpandedAttemptId(expandedAttemptId === attemptId ? null : attemptId)} onCopy={copyText} copiedId={copiedId} onOpenThread={onOpenThread} onLoadOlderAttempts={() => void loadOlderAttempts(thread)} loadingDetails={loadingThreadDetails === thread.threadId} onLoadOlderSteps={(run) => void loadOlderSteps(thread.threadId, run)} loadingOlderSteps={loadingOlderSteps} />)}</div>}
      </section>
    </div>
  );
}

function LegacyThreadRow(props: ThreadRowProps) {
  const { thread, isExpanded, expandedAttemptId, onToggle, onToggleAttempt, onCopy, copiedId, onOpenThread } = props;
  const review = threadNeedsReview(thread);
  return <article className={`overflow-hidden rounded-xl border transition ${thread.status === "completed" ? "border-emerald-500/20 bg-emerald-950/5 hover:border-emerald-500/40" : thread.status === "failed" ? "border-rose-500/20 bg-rose-950/5 hover:border-rose-500/40" : "border-amber-500/20 bg-amber-950/5 hover:border-amber-500/40"}`}>
    <button type="button" onClick={onToggle} className="flex w-full flex-col gap-3 p-4 text-left md:flex-row md:items-center md:justify-between"><div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-bold text-slate-200">{thread.threadTitle || thread.threadId}</span><span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${statusClasses(thread.status)}`}>{statusLabel(thread.status)}{thread.totalAttempts > 1 ? ` · ${thread.totalAttempts} attempts` : ""}</span>{review && <span className="rounded border border-amber-500/30 bg-amber-950/30 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">Review</span>}<span className="font-mono text-[10px] text-text-dark">{formatTimestamp(thread.lastTimestamp)}</span></div><div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-dim"><span className="font-mono text-[10px] text-cyan-300">Thread {thread.threadId}</span><span>{thread.totalSteps} steps</span><span>{thread.totalPollenCost.toFixed(5)} pollen</span><span>{thread.lastModel || "unknown model"}</span></div></div><div className="flex shrink-0 items-center gap-2 text-text-dim">{thread.filesChanged.length > 0 && <span className="hidden rounded border border-cyan-500/20 bg-cyan-950/20 px-2 py-1 font-mono text-[10px] text-cyan-300 sm:inline">{thread.filesChanged.length} file{thread.filesChanged.length === 1 ? "" : "s"} touched</span>}{isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</div></button>
    {isExpanded && <div className="border-t border-border-main/70 bg-bg-main/20 p-3 sm:p-4">{onOpenThread && <div className="mb-4 flex justify-end"><button type="button" onClick={() => onOpenThread(thread.threadId, thread.runs[thread.runs.length - 1]?.runId || thread.runs[thread.runs.length - 1]?.id)} className="rounded border border-cyan-500/30 bg-cyan-950/20 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300 transition hover:bg-cyan-900/30">Open in Chat</button></div>}<div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><TraceMetric label="Cumulative cost" value={`${thread.totalPollenCost.toFixed(5)} pollen`} /><TraceMetric label="Cumulative steps" value={thread.totalSteps.toLocaleString()} /><TraceMetric label="Latest outcome" value={outcomeLabel(thread.latestOutcomeKind)} /><TraceMetric label="Files changed" value={thread.filesChanged.length ? thread.filesChanged.join(", ") : "none recorded"} /></div>{thread.filesChanged.length > 0 && <div className="mb-4 flex flex-wrap gap-1.5">{thread.filesChanged.map((file) => <code key={file} className="rounded bg-bg-main px-2 py-1 font-mono text-[10px] text-cyan-300">{file}</code>)}</div>}<div className="space-y-2">{thread.runs.map((run, index) => { const attemptId = `${thread.threadId}:${run.id}`; return <AttemptRow key={attemptId} run={run} index={index} expanded={expandedAttemptId === attemptId} onToggle={() => onToggleAttempt(attemptId)} onCopy={onCopy} copiedId={copiedId} />; })}</div></div>}
  </article>;
}

function LegacyAttemptRow({ run, index, expanded, onToggle, onCopy, copiedId }: { run: RunAudit; index: number; expanded: boolean; onToggle: () => void; onCopy: (value: string, id: string, event: React.MouseEvent) => void; copiedId: string | null }) {
  const steps = run.steps || [];
  const failedSteps = steps.filter((step) => auditStepFailed(step.observation)).length;
  const duration = getRunDuration(run);
  const trace = getPerformanceTrace(run);
  const counters = trace?.counters || {};
  const totalTokens = getRunTokenUsage(run);
  const attemptLabel = run.attemptIndex || index + 1;
  const runId = run.runId || run.id;
  return <div className="overflow-hidden rounded-lg border border-border-main bg-bg-panel/60"><button type="button" onClick={onToggle} className="flex w-full flex-col gap-2 p-3 text-left transition hover:bg-bg-card/60 md:flex-row md:items-center md:justify-between"><div className="flex min-w-0 flex-wrap items-center gap-2"><span className="rounded border border-cyan-500/20 bg-cyan-950/30 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300">Attempt {attemptLabel}</span><span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${run.outcomeKind === "completed" || run.success ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300" : run.outcomeKind?.startsWith("checkpoint") ? "border-amber-500/30 bg-amber-950/20 text-amber-300" : "border-rose-500/30 bg-rose-950/20 text-rose-300"}`}>{outcomeLabel(run.outcomeKind, run.success)}</span><span className="min-w-0 truncate font-mono text-[10px] text-text-dim">#{runId}</span>{run.parentRunId && <span className="font-mono text-[10px] text-text-dark">from #{run.parentRunId}</span>}</div><div className="flex shrink-0 flex-wrap items-center gap-3 font-mono text-[10px] text-text-dim"><span>{run.stepCount || steps.length} steps</span><span>{(run.totalPollenCost || run.pollenCost || 0).toFixed(5)} pollen</span><span>{formatTimestamp(run.timestamp)}</span>{expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</div></button>
    {expanded && <div className="space-y-3 border-t border-border-main/70 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap gap-2 text-[10px] text-text-dim"><span>Model: <strong className="text-slate-200">{run.model || "unknown"}</strong></span><span>Runtime: <strong className="text-slate-200">{formatDuration(duration)}</strong></span><span>Tokens: <strong className="text-slate-200">{totalTokens.toLocaleString()}</strong></span></div><button type="button" onClick={(event) => onCopy(JSON.stringify(run, null, 2), run.id, event)} className="inline-flex items-center gap-1 rounded border border-border-main bg-bg-main px-2 py-1 font-mono text-[10px] text-text-dim hover:text-white">{copiedId === run.id ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />} Copy attempt</button></div>{run.error && <div className="rounded border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-200"><strong className="mr-2 uppercase tracking-wider">Outcome detail</strong>{run.error}</div>}{run.finalAnswer && <div className="rounded border border-blue-900/50 bg-blue-950/20 p-3 text-sm text-slate-200"><h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-blue-300">Final answer</h3><FinalAnswerRenderer content={run.finalAnswer} compact /></div>}{run.filesChanged?.length ? <div className="rounded border border-border-main bg-bg-main/40 p-3 text-xs text-text-dim"><strong className="uppercase tracking-wider text-slate-300">Attempt files</strong><div className="mt-2 flex flex-wrap gap-1.5">{run.filesChanged.map((file) => <code key={file} className="rounded bg-bg-main px-2 py-1 font-mono text-[10px] text-cyan-300">{file}</code>)}</div></div> : null}{run.verificationResult && <div className={`rounded border p-3 text-xs ${run.verificationResult.passed ? "border-emerald-700/30 bg-emerald-900/10" : "border-amber-700/30 bg-amber-900/10"}`}><h3 className={run.verificationResult.passed ? "text-emerald-400" : "text-amber-400"}>Verification {run.verificationResult.passed ? "passed" : "needs review"}</h3>{run.verificationResult.signals?.map((signal) => <div key={signal.name} className={signal.passed ? "text-emerald-400" : "text-rose-400"}>{signal.passed ? "OK" : "FAIL"} {signal.name}</div>)}</div>}{trace && <div className="rounded border border-cyan-500/20 bg-cyan-950/10 p-3 text-xs text-slate-300"><div className="mb-2 flex items-center gap-2 font-bold uppercase tracking-wider text-cyan-300"><Activity className="h-3.5 w-3.5" /> Performance trace</div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><TraceMetric label="Runtime" value={formatDuration(trace.durationMs)} /><TraceMetric label="First event" value={formatDuration(trace.firstEventLatencyMs)} /><TraceMetric label="Input / output" value={`${(counters.llm_input_tokens || 0).toLocaleString()} / ${(counters.llm_output_tokens || 0).toLocaleString()}`} /><TraceMetric label="Context" value={`${(counters.estimated_context_tokens || 0).toLocaleString()}${counters.model_context_window_tokens ? ` / ${counters.model_context_window_tokens.toLocaleString()}` : " tokens"}`} /><TraceMetric label="Context used" value={formatPercent(counters.context_window_used_percent)} />{counters.prompt_prefill_duration_ms !== undefined && counters.prompt_prefill_duration_ms > 0 && <TraceMetric label="Prefill time" value={formatDuration(counters.prompt_prefill_duration_ms)} />}<TraceMetric label="Tool time" value={formatDuration(counters.successful_tool_ms)} /><TraceMetric label="Cache hits" value={`${(counters.cache_hits || 0).toLocaleString()} / ${(counters.cache_misses || 0).toLocaleString()}`} /><TraceMetric label="Slow operations" value={String(counters.slow_operations || 0)} /></div>{getSlowestSpans(trace).length > 0 && <div className="mt-3 space-y-1">{getSlowestSpans(trace).map((span, spanIndex) => <div key={`${span.name}-${spanIndex}`} className="flex items-center justify-between gap-3 rounded bg-bg-main/60 px-2 py-1.5"><span className="truncate font-mono text-[10px] text-slate-300">{span.name}</span><span className="font-mono text-[10px] text-cyan-300">{formatDuration(span.durationMs)}</span></div>)}</div>}</div>}
      <div className="overflow-hidden rounded border border-border-main bg-bg-main/40"><div className="flex items-center justify-between border-b border-border-main bg-bg-card/50 px-3 py-2"><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-text-dim"><Layers className="h-3 w-3 text-cyan-400" /> Combined execution trace</div><span className="font-mono text-[10px] text-text-dark">{steps.length - failedSteps} completed · {failedSteps} failed</span></div>{steps.length ? <div className="space-y-1 p-2">{steps.map((step, stepIndex) => { const failed = auditStepFailed(step.observation); const input = normalizeStepInput(step); const stepId = step.step || step.id || stepIndex + 1; return <div key={`${run.id}-${stepId}-${stepIndex}`} className={`rounded border px-2 py-2 text-xs ${failed ? "border-rose-500/30 bg-rose-950/10" : "border-emerald-500/10"}`}><div className="flex items-start gap-2.5">{failed ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" /> : <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />}<div className="min-w-0 flex-1">{step.thought && <p className="mb-1.5 text-slate-300">{step.thought}</p>}{step.action && <div className="mb-1.5 flex flex-wrap items-center gap-2"><span className="rounded border border-cyan-500/20 bg-cyan-950/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-cyan-400">{step.action}</span><span className={`font-mono text-[9px] font-bold uppercase tracking-wider ${failed ? "text-rose-300" : "text-emerald-400"}`}>{failed ? "failed" : "completed"}</span>{typeof input === "object" && input !== null && Object.keys(input as Record<string, unknown>).length > 0 && <code className="max-w-full overflow-auto rounded bg-bg-main px-1.5 py-0.5 font-mono text-[10px] text-text-dim">{JSON.stringify(input)}</code>}</div>}{step.observation && <pre className={`mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded border p-2 font-mono text-[10px] ${failed ? "border-rose-900/30 bg-rose-950/10 text-rose-300" : "border-border-main bg-bg-main text-slate-400"}`}>{step.observation}</pre>}</div></div></div>; })}</div> : <div className="p-4 text-xs text-text-dark">No detailed execution actions recorded.</div>}</div>
    </div>}
  </div>;
}

type ThreadRowProps = {
  thread: ThreadAudit;
  isExpanded: boolean;
  expandedAttemptId: string | null;
  onToggle: () => void;
  onToggleAttempt: (attemptId: string) => void;
  onCopy: (value: string, id: string, event: React.MouseEvent) => void;
  copiedId: string | null;
  onOpenThread?: (threadId: string, runId?: string) => void;
  onLoadOlderAttempts: () => void;
  loadingDetails: boolean;
  onLoadOlderSteps: (run: RunAudit) => void;
  loadingOlderSteps: string | null;
};

function ThreadRow(props: ThreadRowProps) {
  const threadTokens = getThreadTokens(props.thread);
  const threadThroughput = getThreadTokensPerSecond(props.thread);
  const runsWithOlderSteps = props.thread.runs.filter((run) => run.stepsPagination?.hasMore);
  return <div data-testid="run-audit-thread-row">
    <LegacyThreadRow {...props} />
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-x border-b border-border-main bg-bg-main/40 px-4 py-2 font-mono text-[10px] text-text-dim">
      <span>Tokens: <strong className="text-slate-200">{formatTokenCount(threadTokens)}</strong></span>
      <span>Throughput: <strong className="text-cyan-300">{formatTokensPerSecond(threadThroughput)}</strong></span>
    </div>
    {props.isExpanded && props.loadingDetails && !props.thread.detailLoaded && (
      <div className="flex items-center justify-center gap-2 border-x border-b border-border-main bg-bg-main/40 px-3 py-3 font-mono text-[10px] text-cyan-300">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading attempt details
      </div>
    )}
    {props.isExpanded && props.thread.pagination?.hasMore && (
      <div className="flex justify-center border-x border-b border-border-main bg-bg-main/40 px-3 py-2">
        <button type="button" onClick={props.onLoadOlderAttempts} disabled={props.loadingDetails} className="rounded border border-cyan-500/30 bg-cyan-950/20 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300 hover:bg-cyan-900/30 disabled:opacity-50">
          {props.loadingDetails ? 'Loading...' : 'Load older attempts'}
        </button>
      </div>
    )}
    {props.isExpanded && runsWithOlderSteps.length > 0 && (
      <div className="flex flex-wrap justify-center gap-2 border-x border-b border-border-main bg-bg-main/40 px-3 py-2">
        {runsWithOlderSteps.map((run) => (
          <button key={run.id} type="button" onClick={() => props.onLoadOlderSteps(run)} disabled={props.loadingOlderSteps === run.id} className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-wider text-neutral-300 hover:border-cyan-500/40 hover:text-cyan-200 disabled:opacity-50">
            {props.loadingOlderSteps === run.id ? 'Loading steps...' : `Load older steps · attempt ${run.attemptIndex || run.id}`}
          </button>
        ))}
      </div>
    )}
  </div>;
}

type AttemptRowProps = {
  run: RunAudit;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onCopy: (value: string, id: string, event: React.MouseEvent) => void;
  copiedId: string | null;
};

function AttemptRow(props: AttemptRowProps) {
  const tokens = getRunTokenUsage(props.run);
  const throughput = getRunTokensPerSecond(props.run);
  return <div data-testid="run-audit-attempt-row">
    <LegacyAttemptRow {...props} />
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-b-lg border-x border-b border-border-main bg-bg-main/40 px-3 py-1.5 font-mono text-[10px] text-text-dim">
      <span>Tokens: <strong className="text-slate-200">{formatTokenCount(tokens)}</strong></span>
      <span>Throughput: <strong className="text-cyan-300">{formatTokensPerSecond(throughput)}</strong></span>
    </div>
  </div>;
}

function FilterSelect({ label, icon, value, onChange, options }: { label: string; icon: React.ReactNode; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <label className="flex items-center gap-2 rounded-lg border border-border-main bg-bg-main px-3 py-2 text-xs">{icon}<span className="shrink-0 font-medium text-text-dim">{label}:</span><select value={value} onChange={(event) => onChange(event.target.value)} className="w-full cursor-pointer bg-transparent text-white outline-none">{options.map(([optionValue, optionLabel]) => <option className="bg-bg-main" value={optionValue} key={optionValue}>{optionLabel}</option>)}</select></label>;
}

function MetricCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <div className="flex items-center gap-4 rounded-xl border border-border-main bg-bg-panel p-4"><div className="rounded-lg bg-cyan-500/10 p-3 text-cyan-400">{icon}</div><div className="min-w-0"><span className="block font-mono text-[9px] font-bold uppercase tracking-wider text-text-dim">{label}</span><p className="mt-0.5 truncate text-base font-bold tracking-wide text-white">{value} <span className="font-sans text-[10px] font-normal text-text-dim">{detail}</span></p></div></div>;
}

function TraceMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded border border-border-main bg-bg-main px-3 py-2"><span className="block font-mono text-[9px] font-bold uppercase tracking-wider text-text-dark">{label}</span><span className="mt-1 block truncate font-mono text-xs text-white">{value}</span></div>;
}
