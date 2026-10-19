import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Terminal as TerminalIcon,
  Copy,
  Check,
  Trash2,
  ArrowDown,
  Pause,
  Play,
  AlertTriangle,
  AlertCircle,
  Clock,
  Cpu,
  Settings,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import type { AgentStreamEvent, AgentRunStatus, ReActResult } from './CoderChatPanel';
import { AgentGuidanceCard, type AgentGuidanceSnapshot } from './AgentGuidanceCard';
import type { ChatViewDensity } from '../utils/interfaceDisplayPreferences';
import {
  eventBody,
  eventFailed,
  eventTitle,
  formatAgentRequestRoute,
  formatTerminalResultError,
  isCheckpointResult,
} from '../utils/agentEventMessages';

export type LogLevel = 'all' | 'tools' | 'warn' | 'error';

export interface ConsoleLogEntry {
  id: string;
  eventIndex?: number;
  timestamp: number;
  level: 'info' | 'tool' | 'cmd' | 'warn' | 'error' | 'success';
  tag: string;
  message: string;
  details?: unknown;
}

const isRateLimitCheckpoint = (result?: ReActResult | null) =>
  /rate limit|cooldown|temporarily unavailable|provider.*unavailable/i.test(result?.error || '');

interface ConsoleRunPanelProps {
  runId?: string;
  agentEvents?: AgentStreamEvent[];
  highlightedEventId?: string | null;
  onSelectEvent?: (eventIndex: number, event: AgentStreamEvent) => void;
  loading?: boolean;
  task?: string;
  model?: string;
  agentStatus?: AgentRunStatus;
  liveProgress?: string;
  liveState?: any;
  result?: ReActResult | null;
  onStopTask?: () => void;
  onFixSettings?: () => void;
  density?: ChatViewDensity;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toTimeString().split(' ')[0] + '.' + String(date.getMilliseconds()).padStart(3, '0');
}

function legacyEventToLogs(event: AgentStreamEvent, index: number, now: number): ConsoleLogEntry[] {
  const baseTime = now;
  const id = `evt-${index}-${event.type}`;

  switch (event.type) {
    case 'run_started':
      return [{
        id,
        timestamp: baseTime,
        level: 'info',
        tag: 'RUN',
        message: `Task initiated: "${event.task}"`,
      }];
    case 'agent_guidance_snapshot':
      return [{
        id,
        timestamp: baseTime,
        level: 'info',
        tag: 'GUIDE',
        message: `Agent context · ${event.codingState} · ~${event.contextBudgetUsed.toLocaleString()} tokens`,
      }];
    case 'console_output':
      return [{
        id,
        timestamp: baseTime,
        level: 'info',
        tag: 'STDOUT',
        message: event.message,
      }];
    case 'command_started':
      return [{
        id,
        timestamp: baseTime,
        level: 'cmd',
        tag: 'EXEC',
        message: `$ ${event.command}`,
      }];
    case 'command_output':
      return [{
        id,
        timestamp: baseTime,
        level: 'cmd',
        tag: 'CMD_OUT',
        message: event.output,
      }];
    case 'tool_started':
      return [{
        id,
        timestamp: baseTime,
        level: 'tool',
        tag: 'TOOL',
        message: `Calling tool: ${event.tool}`,
        details: event.input,
      }];
    case 'tool_result':
      return [{
        id,
        timestamp: baseTime,
        level: 'tool',
        tag: 'TOOL_RES',
        message: `Tool ${event.tool} returned result`,
        details: event.result,
      }];
    case 'file_read':
      return [{
        id,
        timestamp: baseTime,
        level: 'tool',
        tag: 'READ',
        message: `Read file: ${event.path}`,
      }];
    case 'file_changed':
      return [{
        id,
        timestamp: baseTime,
        level: 'tool',
        tag: 'MUTATE',
        message: `Modified file: ${event.path}${event.summary ? ` (${event.summary})` : ''}`,
      }];
    case 'verification_started':
      return [{
        id,
        timestamp: baseTime,
        level: 'tool',
        tag: 'VERIFY',
        message: `Verification started${event.command ? `: ${event.command}` : ''}`,
      }];
    case 'verification_result':
      return [{
        id,
        timestamp: baseTime,
        level: event.success ? 'success' : 'warn',
        tag: 'VERIFY',
        message: event.success ? 'Verification checks passed' : 'Verification checks failed',
        details: event.output,
      }];
    case 'model_target_resolved':
      return [{
        id,
        timestamp: baseTime,
        level: 'info',
        tag: 'ROUTE',
        message: `Model route resolved -> ${event.provider}:${event.resolvedModel} (${event.route})`,
      }];
    case 'llm_request_started': {
      const routeLabel = formatAgentRequestRoute(event.request);
      return [{
        id,
        timestamp: baseTime,
        level: 'info',
        tag: 'LLM',
        message: `Waiting for model response: ${routeLabel}${event.request.requestKind ? ` (${event.request.requestKind})` : ''}`,
      }];
    }
    case 'llm_request_finished': {
      const routeLabel = formatAgentRequestRoute(event.request);
      const level = event.request.status === 'failed' || event.request.status === 'timed_out' ? 'warn' : 'success';
      return [{
        id,
        timestamp: baseTime,
        level,
        tag: 'LLM',
        message: `Model request ${event.request.status || 'completed'}: ${routeLabel}${event.request.error ? ` — ${event.request.error}` : ''}`,
      }];
    }
    case 'state_transition':
      return [{
        id,
        timestamp: baseTime,
        level: 'info',
        tag: 'STATE',
        message: `State transition: ${event.transition.from} -> ${event.transition.to} (${event.transition.reason})`,
      }];
    case 'recovery_transition':
      return [{
        id,
        timestamp: baseTime,
        level: 'warn',
        tag: 'RECOVERY',
        message: `Recovery #${event.attempt} [${event.reason}]: ${event.message}`,
      }];
    case 'provider_attempt_failed':
      return [{
        id,
        timestamp: baseTime,
        level: 'warn',
        tag: 'PROVIDER',
        message: `Provider attempt warning: ${event.message}${event.errorCode ? ` [${event.errorCode}]` : ''}`,
      }];
    case 'cooldown_waiting':
      return [{
        id,
        timestamp: baseTime,
        level: 'warn',
        tag: 'COOLDOWN',
        message: `Rate limit / cooldown: waiting ${Math.round(event.delayMs / 1000)}s (attempt ${event.attempt})`,
      }];
    case 'nvidia_cooldown_retry':
      return [{
        id,
        timestamp: baseTime,
        level: 'warn',
        tag: 'COOLDOWN',
        message: `All NVIDIA keys throttled: waiting ${Math.round(event.pauseMs / 1000)}s before retry #${event.attempt}`,
      }];
    case 'execution_failed':
      return [{
        id,
        timestamp: baseTime,
        level: 'error',
        tag: 'ERROR',
        message: `Execution failed: ${event.message}${event.errorCode ? ` [${event.errorCode}]` : ''}`,
      }];
    default:
      return [];
  }
}

function eventToLogs(event: AgentStreamEvent, index: number, now: number): ConsoleLogEntry[] {
  const isFailure = eventFailed(event) || event.type === 'execution_failed';
  const isSuccess = event.type === 'verification_result' && event.success;
  const isWarning = event.type === 'run_terminal_advice' || event.type === 'provider_attempt_failed' || event.type === 'cooldown_waiting' || event.type === 'nvidia_cooldown_retry' || event.type === 'retrying' || event.type === 'recovery_transition' || event.type === 'pacing_wait' || (event.type === 'verification_result' && !event.success);
  const isCommand = event.type === 'command_started' || event.type === 'command_output' || event.type === 'package_install_started' || event.type === 'package_install_result';
  const isTool = event.type === 'tool_started' || event.type === 'tool_result' || event.type === 'file_read' || event.type === 'file_changed' || event.type === 'verification_started' || event.type === 'verification_result';
  const level: ConsoleLogEntry['level'] = isFailure
    ? 'error'
    : isSuccess
      ? 'success'
      : isWarning
        ? 'warn'
        : isCommand
          ? 'cmd'
          : isTool
            ? 'tool'
            : 'info';
  const tag = event.type === 'console_output'
    ? 'STDOUT'
    : event.type === 'model_target_resolved'
      ? 'ROUTE'
      : event.type === 'llm_request_started' || event.type === 'llm_request_finished'
        ? 'LLM'
        : event.type === 'state_transition'
          ? 'STATE'
          : event.type === 'recovery_transition'
            ? 'RECOVERY'
            : event.type === 'provider_attempt_failed' || event.type === 'cooldown_waiting' || event.type === 'nvidia_cooldown_retry' || event.type === 'retrying' || event.type === 'pacing_wait'
              ? 'PROVIDER'
              : event.type === 'run_terminal_advice'
                ? 'NEXT'
              : event.type === 'execution_failed' || event.type === 'error'
                ? 'ERROR'
                : event.type === 'tool_started' || event.type === 'tool_result' || event.type === 'tool_evidence'
                  ? 'TOOL'
                  : event.type === 'file_read'
                    ? 'READ'
                    : event.type === 'file_changed'
                      ? 'MUTATE'
                      : event.type === 'verification_started' || event.type === 'verification_result'
                        ? 'VERIFY'
                        : isCommand
                          ? 'EXEC'
                          : 'RUN';
  const detail = eventBody(event);
  return [{
    id: `evt-${index}-${event.type}`,
    eventIndex: index,
    timestamp: now,
    level,
    tag,
    message: eventTitle(event),
    ...(detail ? { details: detail } : {}),
  }];
}

const eventTimestamp = (event: AgentStreamEvent, fallback: number): number => {
  const candidate = event.type === 'state_transition'
    ? event.transition.timestamp
    : (event as any).timestamp ?? (event as any).createdAt ?? (event as any).processedAt ?? (event as any).queuedAt;
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0 ? candidate : fallback;
};

export const ConsoleRunPanel: React.FC<ConsoleRunPanelProps> = ({
  runId,
  agentEvents = [],
  highlightedEventId = null,
  onSelectEvent,
  loading = false,
  task = '',
  model = '',
  agentStatus,
  liveProgress = '',
  liveState,
  result,
  onStopTask,
  onFixSettings,
  density = 'compact',
}) => {
  const [filterLevel, setFilterLevel] = useState<LogLevel>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [promptCopyStatus, setPromptCopyStatus] = useState<'idle' | 'copied' | 'unavailable'>('idle');
  const [clearedBeforeIndex, setClearedBeforeIndex] = useState<number>(0);
  const consoleBottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const highlightedLogRef = useRef<HTMLDivElement>(null);

  const startTimeRef = useRef<number>(Date.now());
  const guidanceSnapshots = agentEvents.filter((event): event is Extract<AgentStreamEvent, { type: 'agent_guidance_snapshot' }> => event.type === 'agent_guidance_snapshot');
  const latestGuidance = guidanceSnapshots[guidanceSnapshots.length - 1] as AgentGuidanceSnapshot | undefined;
  const previousGuidance = guidanceSnapshots.length > 1 ? guidanceSnapshots[guidanceSnapshots.length - 2] as AgentGuidanceSnapshot : undefined;

  // Flatten events into structured console log entries
  const logs: ConsoleLogEntry[] = useMemo(() => {
    const entries: ConsoleLogEntry[] = [];
    agentEvents.forEach((evt, idx) => {
      if (idx < clearedBeforeIndex) return;
      const derived = eventToLogs(evt, idx, eventTimestamp(evt, startTimeRef.current + idx * 100));
      entries.push(...derived);
    });

    // If result finished with error or success, append terminal outcome
    if (result && !loading) {
      if (result.success) {
        entries.push({
          id: 'res-success',
          timestamp: Date.now(),
          level: 'success',
          tag: 'FINAL',
          message: 'Task completed successfully with verified evidence.',
        });
      } else if (result.error) {
        const checkpoint = isCheckpointResult(result) || isRateLimitCheckpoint(result);
        const isAuthOr401 = /401|unauthorized|api key|authentication required/i.test(result.error);
        entries.push({
          id: 'res-error',
          timestamp: Date.now(),
          level: checkpoint ? 'warn' : 'error',
          tag: isAuthOr401 ? 'AUTH_401' : checkpoint ? 'CHECKPOINT' : 'ERROR',
          message: isAuthOr401
            ? formatTerminalResultError(result)
            : checkpoint ? `Checkpoint saved: ${formatTerminalResultError(result)}` : formatTerminalResultError(result),
        });
      }
    }

    return entries;
  }, [agentEvents, clearedBeforeIndex, result, loading]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (filterLevel === 'tools' && log.level !== 'tool' && log.level !== 'cmd') return false;
      if (filterLevel === 'warn' && log.level !== 'warn' && log.level !== 'error') return false;
      if (filterLevel === 'error' && log.level !== 'error') return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          log.tag.toLowerCase().includes(q) ||
          log.message.toLowerCase().includes(q) ||
          (log.details && JSON.stringify(log.details).toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [logs, filterLevel, searchQuery]);

  // Handle auto-scrolling
  useEffect(() => {
    if (autoScroll && consoleBottomRef.current) {
      consoleBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredLogs, autoScroll]);

  useEffect(() => {
    if (highlightedEventId && highlightedLogRef.current) {
      highlightedLogRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightedEventId]);

  const handleCopyLogs = async () => {
    try {
      const text = filteredLogs
        .map((l) => `[${formatTime(l.timestamp)}] [${l.tag}] ${l.message}${l.details ? `\n${JSON.stringify(l.details, null, 2)}` : ''}`)
        .join('\n');
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleCopyPrompt = async () => {
    const currentStep = [...guidanceSnapshots].reverse()[0]?.step || Number(liveState?.current_step) || 0;
    if (!runId || currentStep < 1) {
      setPromptCopyStatus('unavailable');
      return;
    }
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/context-snapshot?seq=${currentStep}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('No development snapshot is available for this step.');
      const data = await response.json() as { promptText?: unknown };
      if (typeof data.promptText !== 'string' || !data.promptText) throw new Error('The snapshot did not contain prompt text.');
      await navigator.clipboard.writeText(data.promptText);
      setPromptCopyStatus('copied');
      setTimeout(() => setPromptCopyStatus('idle'), 2_000);
    } catch {
      setPromptCopyStatus('unavailable');
      setTimeout(() => setPromptCopyStatus('idle'), 3_000);
    }
  };

  const handleClear = () => {
    setClearedBeforeIndex(agentEvents.length);
  };

  // Detect critical auth/network errors in result or events
  const detectedAuthOrNetworkError = useMemo(() => {
    const errorText = `${result?.error || ''} ${result?.errorCode || ''} ${agentEvents.map((e) => (e.type === 'execution_failed' || e.type === 'provider_attempt_failed' ? e.message : '')).join(' ')}`;
    if (/401|unauthorized|authentication required|pollen api error 401|invalid api key/i.test(errorText)) {
      return {
        type: 'auth_401' as const,
        title: 'Authentication / API Key Error (401 Unauthorized)',
        message: 'The model provider rejected the request due to missing or invalid authentication credentials. Please update your API key in Settings.',
      };
    }
    if (/network error|failed to fetch|econnrefused|socket hang up/i.test(errorText)) {
      return {
        type: 'network' as const,
        title: 'Network / Provider Connection Error',
        message: 'Unable to reach the provider endpoint. Verify your internet connection or try switching to a resilient model target.',
      };
    }
    return null;
  }, [result, agentEvents]);

  const latestCategoryTokens = [...agentEvents].reverse().find((event) =>
    event.type === 'llm_request_started' && event.request.categoryTokens
  );
  const categoryTokenData = latestCategoryTokens?.type === 'llm_request_started'
    ? latestCategoryTokens.request.categoryTokens
    : undefined;
  const categoryTokenSegments = categoryTokenData ? [
    { label: 'Task', value: categoryTokenData.task || 0, color: 'bg-cyan-400' },
    { label: 'Plan', value: categoryTokenData.plan || 0, color: 'bg-violet-400' },
    {
      label: 'Memory',
      value: (categoryTokenData.memory || 0) + (categoryTokenData.evidence || 0) + (categoryTokenData.activeErrors || 0),
      color: 'bg-amber-400',
      detail: `memory ${categoryTokenData.memory || 0}, evidence ${categoryTokenData.evidence || 0}, active errors ${categoryTokenData.activeErrors || 0}`,
    },
    { label: 'History', value: categoryTokenData.history || 0, color: 'bg-emerald-400' },
    { label: 'System', value: categoryTokenData.system || 0, color: 'bg-rose-400' },
  ] : [];
  const categoryTokenTotal = categoryTokenSegments.reduce((total, segment) => total + segment.value, 0);

  return (
    <div data-testid="console-run-stream" className="flex h-full flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-[#0c0d12] shadow-2xl font-mono text-xs text-neutral-300">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800/80 bg-[#12141c] px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 font-bold text-neutral-100">
            <TerminalIcon className="h-4 w-4 text-cyan-400" />
            <span className="text-sm tracking-wide">Console Run Stream</span>
          </div>

          {model && (
            <span className="rounded-md border border-neutral-700/60 bg-neutral-900/80 px-2 py-0.5 text-[10px] text-cyan-300">
              {model}
            </span>
          )}

          {loading ? (
            <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-950/30 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-emerald-400" />
              {agentStatus ? agentStatus.toUpperCase() : 'RUNNING'}
            </span>
          ) : result?.success ? (
            <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-950/30 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              FINISHED
            </span>
          ) : result?.error && (isCheckpointResult(result) || isRateLimitCheckpoint(result)) ? (
            <span className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-950/30 px-2.5 py-0.5 text-[10px] font-bold text-amber-300">
              <Clock className="h-3 w-3" />
              {isRateLimitCheckpoint(result) ? 'WAITING COOLDOWN' : 'PAUSED'}
            </span>
          ) : result?.error ? (
            <span className="flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-950/30 px-2.5 py-0.5 text-[10px] font-bold text-rose-400">
              <XCircle className="h-3 w-3" />
              FAILED
            </span>
          ) : null}
        </div>

        {/* Console Controls */}
        <div className="flex items-center gap-2">
          {/* Filter Pills */}
          <div className="flex items-center rounded-lg border border-neutral-800 bg-[#090a0f] p-0.5 text-[10px]">
            {(['all', 'tools', 'warn', 'error'] as LogLevel[]).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setFilterLevel(level)}
                className={`rounded px-2 py-0.5 font-bold uppercase transition ${
                  filterLevel === level
                    ? 'bg-cyan-500/20 text-cyan-300 shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {level}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div className="relative flex items-center">
            <Search className="absolute left-2 h-3 w-3 text-neutral-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search logs..."
              className="h-6 w-28 rounded-md border border-neutral-800 bg-[#090a0f] pl-6 pr-2 text-[10px] text-neutral-200 placeholder-neutral-500 focus:border-cyan-500/60 focus:outline-none focus:w-40 transition-all"
            />
          </div>

          {/* Auto scroll toggle */}
          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold transition ${
              autoScroll
                ? 'border-cyan-500/40 bg-cyan-950/30 text-cyan-300'
                : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-neutral-200'
            }`}
            title={autoScroll ? 'Auto-scroll enabled (click to pause)' : 'Auto-scroll paused (click to follow)'}
          >
            {autoScroll ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            <span>Follow</span>
          </button>

          {/* Clear Button */}
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-[10px] text-neutral-400 hover:border-neutral-700 hover:text-neutral-200 transition"
            title="Clear console output"
          >
            <Trash2 className="h-3 w-3" />
          </button>

          {/* Copy Button */}
          {process.env.NODE_ENV !== 'production' && density === 'detailed' && runId && (
            <button
              type="button"
              onClick={handleCopyPrompt}
              className="flex items-center gap-1 rounded-md border border-violet-800/70 bg-violet-950/40 px-2 py-1 text-[10px] text-violet-200 hover:border-violet-600 transition"
              title="Copy the redacted prompt reconstruction for this step (development only)"
            >
              {promptCopyStatus === 'copied' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              <span>{promptCopyStatus === 'copied' ? 'Prompt copied' : promptCopyStatus === 'unavailable' ? 'Snapshot unavailable' : 'Copy prompt'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCopyLogs}
            className="flex items-center gap-1 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-[10px] text-neutral-400 hover:border-neutral-700 hover:text-neutral-200 transition"
            title="Copy logs to clipboard"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {categoryTokenTotal > 0 && (
        <div className="border-b border-neutral-800/80 bg-[#0d0e12] px-4 py-2" data-testid="context-category-meter">
          <div className="mb-1 flex items-center justify-between gap-2 text-[9px]">
            <span className="font-bold uppercase tracking-wider text-neutral-400">Latest prompt categories</span>
            <span className="text-neutral-500">~{categoryTokenTotal.toLocaleString()} tokens estimated</span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-neutral-800" aria-label={`Prompt category token estimate: ${categoryTokenTotal.toLocaleString()} tokens`}>
            {categoryTokenSegments.filter((segment) => segment.value > 0).map((segment) => (
              <div
                key={segment.label}
                className={`${segment.color} h-full`}
                style={{ width: `${(segment.value / categoryTokenTotal) * 100}%` }}
                title={`${segment.label}: ${segment.value.toLocaleString()}${segment.detail ? ` (${segment.detail})` : ''} tokens`}
              />
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[8px] text-neutral-500">
            {categoryTokenSegments.map((segment) => (
              <span key={segment.label} title={segment.detail} className="inline-flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${segment.color}`} />
                {segment.label} {segment.value.toLocaleString()}
              </span>
            ))}
          </div>
        </div>
      )}

      {density === 'detailed' && latestGuidance && (
        <div className="border-b border-neutral-800/80">
          <AgentGuidanceCard snapshot={latestGuidance} previous={previousGuidance} />
        </div>
      )}

      {/* Actionable Error Card if 401 or network failure */}
      {detectedAuthOrNetworkError && (
        <div className="border-b border-rose-500/30 bg-rose-950/30 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
              <div>
                <div className="font-bold text-rose-200 text-[11px]">{detectedAuthOrNetworkError.title}</div>
                <div className="text-[10px] text-rose-300/90 leading-relaxed mt-0.5">
                  {detectedAuthOrNetworkError.message}
                </div>
              </div>
            </div>
            {onFixSettings && (
              <button
                type="button"
                onClick={onFixSettings}
                className="flex items-center gap-1.5 shrink-0 rounded-lg border border-rose-400/40 bg-rose-500/20 px-2.5 py-1.5 font-bold text-rose-200 hover:bg-rose-500/30 hover:border-rose-400 transition text-[10px]"
              >
                <Settings className="h-3 w-3" />
                <span>Fix in Settings</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Console Log Stream */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-4 space-y-1.5 selection:bg-cyan-500/30 selection:text-cyan-100"
      >
        {filteredLogs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-neutral-500 py-12">
            <TerminalIcon className="h-8 w-8 mb-2 stroke-[1.5] text-neutral-600" />
            <p className="font-medium text-xs">No console logs available</p>
            <p className="text-[10px] text-neutral-600 mt-1">Logs and tool dispatches will appear here in real time.</p>
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isErr = log.level === 'error';
            const isWarn = log.level === 'warn';
            const isTool = log.level === 'tool' || log.level === 'cmd';
            const isSuccess = log.level === 'success';
            const isHighlighted = highlightedEventId === log.id;
            const linkedEvent = log.eventIndex === undefined ? undefined : agentEvents[log.eventIndex];
            const selectLinkedEvent = () => {
              if (linkedEvent && log.eventIndex !== undefined) onSelectEvent?.(log.eventIndex, linkedEvent);
            };

            return (
              <div
                key={log.id}
                id={log.id}
                data-event-id={log.id.startsWith('evt-') ? log.id : undefined}
                ref={isHighlighted ? highlightedLogRef : undefined}
                aria-current={isHighlighted ? 'true' : undefined}
                role={linkedEvent ? 'button' : undefined}
                tabIndex={linkedEvent ? 0 : undefined}
                onClick={linkedEvent ? selectLinkedEvent : undefined}
                onKeyDown={linkedEvent ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectLinkedEvent();
                  }
                } : undefined}
                className={`group flex items-start gap-2.5 rounded px-2 py-1 transition ${
                  isHighlighted
                    ? 'bg-cyan-500/20 text-cyan-100 ring-2 ring-cyan-300/80 shadow-[0_0_14px_rgba(34,211,238,0.25)]'
                    : isErr
                      ? 'bg-rose-950/20 text-rose-200 border-l-2 border-rose-500'
                      : isWarn
                        ? 'bg-amber-950/15 text-amber-200 border-l-2 border-amber-500'
                        : isTool
                          ? 'text-cyan-200 hover:bg-neutral-900/60'
                          : isSuccess
                            ? 'bg-emerald-950/20 text-emerald-200 border-l-2 border-emerald-500'
                            : 'text-neutral-300 hover:bg-neutral-900/40'
                }`}
              >
                <span className="shrink-0 text-[10px] text-neutral-500 select-none">
                  {formatTime(log.timestamp)}
                </span>

                <span
                  className={`shrink-0 rounded px-1.5 py-0.2 text-[9px] font-bold uppercase select-none ${
                    isErr
                      ? 'bg-rose-500/20 text-rose-300'
                      : isWarn
                        ? 'bg-amber-500/20 text-amber-300'
                        : isTool
                          ? 'bg-cyan-500/20 text-cyan-300'
                          : isSuccess
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-neutral-800 text-neutral-400'
                  }`}
                >
                  {log.tag}
                </span>

                <div className="flex-1 break-words leading-relaxed">
                  <span>{log.message}</span>
                  {log.details && (
                    <pre className="mt-1 max-h-36 overflow-auto rounded bg-[#07080b] p-2 text-[10px] text-neutral-400 border border-neutral-800/80">
                      {typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={consoleBottomRef} />
      </div>

      {/* Footer / Status ticker */}
      {loading && (
        <div className="flex items-center justify-between border-t border-neutral-800/80 bg-[#0f1118] px-4 py-2 text-[10px]">
          <div className="flex items-center gap-2 text-cyan-300">
            <RefreshCw className="h-3 w-3 animate-spin text-cyan-400" />
            <span className="font-semibold">{liveProgress || 'Executing step...'}</span>
          </div>

          {onStopTask && (
            <button
              type="button"
              onClick={onStopTask}
              className="rounded border border-rose-500/40 bg-rose-950/30 px-2 py-0.5 font-bold uppercase text-rose-300 hover:bg-rose-900/50 transition"
            >
              Stop Run
            </button>
          )}
        </div>
      )}
    </div>
  );
};
