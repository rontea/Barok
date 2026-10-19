import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Clock3, Play, RotateCcw, Square, TerminalSquare, XCircle } from 'lucide-react';
import type { AgentStreamEvent } from './CoderChatPanel';
import { ConsoleRunPanel } from './ConsoleRunPanel';
import { getAgentEventMessage } from '../utils/agentEventMessages';

export type TestSuiteStatus = 'not_run' | 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'timed_out' | 'blocked' | 'unavailable';

export interface TestSuiteCase {
  id: string;
  category: string;
  title: string;
  tag: string;
  prompt: string;
  modelName?: string;
}

export interface TestSuiteRunRecord {
  status: TestSuiteStatus;
  runId?: string;
  modelName?: string;
  stdout?: string;
  stderr?: string;
  verificationStatus?: string;
  stepCount?: number;
  pollenCost?: number;
  events?: AgentStreamEvent[];
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  summary?: string;
  error?: string;
  filesChanged?: string[];
}

interface TestSuitePanelProps {
  cases: TestSuiteCase[];
  runs: Record<string, TestSuiteRunRecord | undefined>;
  activeCaseId?: string | null;
  activeEvents?: AgentStreamEvent[];
  onRunCase: (testCase: TestSuiteCase) => void;
  onRunAll: () => void;
  onRetryFailed: () => void;
  onStop: () => void;
  onOpenChat: (testCase: TestSuiteCase) => void;
  onOpenAudit: (runId?: string) => void;
}

const statusLabel: Record<TestSuiteStatus, string> = {
  not_run: 'Not run',
  queued: 'Queued',
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  timed_out: 'Timed out',
  blocked: 'Blocked',
  unavailable: 'Unavailable',
};

const statusClass: Record<TestSuiteStatus, string> = {
  not_run: 'border-neutral-800 bg-neutral-950/40 text-neutral-500',
  queued: 'border-sky-500/30 bg-sky-950/20 text-sky-300',
  running: 'border-cyan-500/40 bg-cyan-950/25 text-cyan-300',
  passed: 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300',
  failed: 'border-rose-500/35 bg-rose-950/20 text-rose-300',
  cancelled: 'border-amber-500/35 bg-amber-950/20 text-amber-300',
  timed_out: 'border-amber-500/35 bg-amber-950/20 text-amber-300',
  blocked: 'border-violet-500/35 bg-violet-950/20 text-violet-300',
  unavailable: 'border-neutral-700 bg-neutral-900 text-neutral-400',
};

const StatusIcon = ({ status }: { status: TestSuiteStatus }) => {
  if (status === 'passed') return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (status === 'failed' || status === 'timed_out') return <XCircle className="h-4 w-4 text-rose-400" />;
  if (status === 'running') return <Clock3 className="h-4 w-4 animate-pulse text-cyan-300" />;
  if (status === 'queued') return <Clock3 className="h-4 w-4 text-sky-300" />;
  return <Circle className="h-4 w-4 text-neutral-600" />;
};

const formatDuration = (durationMs?: number) => {
  if (!Number.isFinite(durationMs) || !durationMs || durationMs < 1_000) return durationMs ? `${Math.round(durationMs)}ms` : '—';
  return `${(durationMs / 1_000).toFixed(1)}s`;
};

export function TestSuitePanel({ cases, runs, activeCaseId, activeEvents = [], onRunCase, onRunAll, onRetryFailed, onStop, onOpenChat, onOpenAudit }: TestSuitePanelProps) {
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);
  const groupedCases = useMemo(() => {
    const groups = new Map<string, TestSuiteCase[]>();
    for (const testCase of cases) {
      const group = groups.get(testCase.category) || [];
      group.push(testCase);
      groups.set(testCase.category, group);
    }
    return Array.from(groups.entries());
  }, [cases]);
  const counts = cases.reduce<Record<TestSuiteStatus, number>>((acc, testCase) => {
    const status = runs[testCase.id]?.status || 'not_run';
    acc[status] += 1;
    return acc;
  }, { not_run: 0, queued: 0, running: 0, passed: 0, failed: 0, cancelled: 0, timed_out: 0, blocked: 0, unavailable: 0 });
  const isBusy = Boolean(activeCaseId);
  const retryableCount = counts.failed + counts.timed_out + counts.blocked;
  const latestActiveEvent = activeEvents[activeEvents.length - 1];
  const activeEventMessage = latestActiveEvent ? getAgentEventMessage(latestActiveEvent) : null;

  return (
    <section data-testid="test-suite-workspace" className="w-full space-y-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-xl sm:p-7">
      <header className="flex flex-col gap-4 border-b border-zinc-800 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-cyan-300">
            <TerminalSquare className="h-5 w-5" />
            <h2 className="text-xl font-bold text-white">Test Suite</h2>
            <span className="rounded border border-cyan-500/30 bg-cyan-950/30 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-cyan-300">
              Suggested Test Cases
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
            Browse the reference workflow samples, then run them through the active run manager. Each result keeps its run ID, outcome, duration, changed files, and audit link; no simulated pass/fail or random timing is used.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" data-testid="test-suite-run-all" onClick={onRunAll} disabled={isBusy || cases.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-xs font-bold uppercase tracking-wider text-cyan-200 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50">
            <Play className="h-3.5 w-3.5" /> Run all
          </button>
          <button type="button" data-testid="test-suite-retry-failed" onClick={onRetryFailed} disabled={isBusy || retryableCount === 0} className="inline-flex items-center gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-amber-200 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50">
            <RotateCcw className="h-3.5 w-3.5" /> Retry failed{retryableCount > 0 ? ` (${retryableCount})` : ''}
          </button>
          {isBusy && (
            <button type="button" data-testid="test-suite-stop" onClick={onStop} className="inline-flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs font-bold uppercase tracking-wider text-rose-200 transition hover:bg-rose-500/25">
              <Square className="h-3.5 w-3.5 fill-current" /> Stop
            </button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="test-suite-summary">
        {([['total', cases.length, 'Total'], ['running', counts.running + counts.queued, 'Active'], ['passed', counts.passed, 'Passed'], ['failed', counts.failed + counts.timed_out, 'Needs attention']] as const).map(([key, value, label]) => (
          <div key={key} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <span className="block font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-500">{label}</span>
            <span className="mt-1 block text-lg font-bold text-white">{value}</span>
          </div>
        ))}
      </div>

      {activeCaseId && activeEventMessage && (
        <div data-testid="test-suite-active-step" className="flex items-start gap-2 rounded-lg border border-cyan-500/25 bg-cyan-950/15 px-3 py-2 font-mono text-[10px] text-cyan-100">
          <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-pulse text-cyan-300" />
          <div className="min-w-0"><span className="font-bold uppercase tracking-wider text-cyan-300">Active step</span><div className="mt-0.5 truncate text-cyan-100">{activeEventMessage.title}{activeEventMessage.detail ? `: ${activeEventMessage.detail}` : ''}</div></div>
        </div>
      )}
      {activeCaseId && activeEvents.length > 0 && (
        <div data-testid="test-suite-live-console" className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/70">
          <ConsoleRunPanel agentEvents={activeEvents} loading task="Test Suite active case" />
        </div>
      )}

      <div className="space-y-6">
        {groupedCases.map(([category, categoryCases]) => (
          <div key={category} className="space-y-3">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">{category}</h3>
              <span className="font-mono text-[10px] text-zinc-600">{categoryCases.length} case{categoryCases.length === 1 ? '' : 's'}</span>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {categoryCases.map((testCase) => {
                const run = runs[testCase.id];
                const status = run?.status || 'not_run';
                const expanded = expandedCaseId === testCase.id;
                const isActive = activeCaseId === testCase.id;
                return (
                  <article key={testCase.id} data-testid={`test-suite-case-${testCase.id}`} className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/35 transition hover:border-zinc-700">
                    <div className="flex items-start gap-3 p-4">
                      <StatusIcon status={status} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-semibold text-zinc-100">{testCase.title}</h4>
                          <span className="rounded border border-zinc-700/60 bg-zinc-950 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-500">{testCase.tag}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className={`rounded border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${statusClass[status]}`}>{statusLabel[status]}</span>
                          {run?.durationMs && <span className="font-mono text-[10px] text-zinc-600">{formatDuration(run.durationMs)}</span>}
                          {run?.runId && <span className="font-mono text-[10px] text-cyan-400/70">#{run.runId}</span>}
                          {run?.modelName && <span className="font-mono text-[10px] text-zinc-600">{run.modelName}</span>}
                          {run?.verificationStatus && <span className="font-mono text-[10px] text-zinc-600">verify:{run.verificationStatus}</span>}
                        </div>
                      </div>
                      <button type="button" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${testCase.title}`} onClick={() => setExpandedCaseId(expanded ? null : testCase.id)} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-white">
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2 border-t border-zinc-800/80 px-4 py-3">
                      <button type="button" data-testid={`test-suite-run-${testCase.id}`} onClick={() => onRunCase(testCase)} disabled={isBusy} className="inline-flex items-center gap-1.5 rounded border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50">
                        {isActive ? <RotateCcw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} {isActive ? 'Running' : 'Run case'}
                      </button>
                      <button type="button" onClick={() => onOpenChat(testCase)} className="rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 transition hover:text-white">Open in Chat</button>
                      {run?.runId && <button type="button" onClick={() => onOpenAudit(run.runId)} className="rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 transition hover:text-cyan-300">Open audit</button>}
                    </div>
                    {expanded && (
                      <div data-testid={`test-suite-evidence-${testCase.id}`} className="space-y-3 border-t border-zinc-800/80 bg-zinc-950/40 p-4 text-xs text-zinc-400">
                        <div><span className="font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-600">Command / workflow</span><p className="mt-1 whitespace-pre-wrap leading-relaxed text-zinc-300">{testCase.prompt}</p></div>
                        {run?.summary && <div><span className="font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-600">Result</span><p className="mt-1 whitespace-pre-wrap leading-relaxed text-zinc-300">{run.summary}</p></div>}
                        {run?.error && <div className="rounded border border-rose-500/20 bg-rose-950/15 p-2 text-rose-200">{run.error}</div>}
                        {run?.stdout && <div><span className="font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-600">Stdout / console</span><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-900/70 p-2 font-mono text-[10px] leading-relaxed text-emerald-300">{run.stdout}</pre></div>}
                        {run?.stderr && <div><span className="font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-600">Stderr / diagnostics</span><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-rose-500/20 bg-rose-950/10 p-2 font-mono text-[10px] leading-relaxed text-rose-200">{run.stderr}</pre></div>}
                        {run?.stepCount !== undefined && <div className="font-mono text-[10px] text-zinc-500">{run.stepCount} engine step{run.stepCount === 1 ? '' : 's'}{run.pollenCost !== undefined ? ` · ${run.pollenCost.toFixed(4)} pollen` : ''}</div>}
                        {run?.events?.length ? <div><span className="font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-600">Event console</span><div className="mt-1 overflow-hidden rounded-lg border border-zinc-800"><ConsoleRunPanel agentEvents={run.events} task={testCase.prompt} model={run.modelName} /></div></div> : null}
                        {run?.filesChanged?.length ? <div><span className="font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-600">Changed files</span><div className="mt-1 flex flex-wrap gap-1.5">{run.filesChanged.map((file) => <code key={file} className="rounded bg-zinc-900 px-1.5 py-1 font-mono text-[10px] text-cyan-300">{file}</code>)}</div></div> : null}
                        {!run && <p className="font-mono text-[10px] text-zinc-600">No run evidence yet. Run this case to populate the durable result.</p>}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
