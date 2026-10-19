import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileCode,
  FileText,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  Pause,
  Play,
  RotateCw,
  Sparkles,
  Terminal,
  TerminalSquare,
  User,
  Wrench,
} from 'lucide-react';
import type { AgentStreamEvent, CoderThreadMessage } from './CoderChatPanel';
import {
  eventBody,
  eventFailed,
  eventTimedOut,
  eventTitle,
  getAgentEventOutcome,
} from '../utils/agentEventMessages';
import type { ChatViewDensity } from '../utils/interfaceDisplayPreferences';

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface RotatingChatItem {
  id: string;
  source: 'event' | 'message';
  category: 'tool' | 'planning' | 'verification' | 'file' | 'command' | 'model' | 'user' | 'system' | 'response';
  categoryLabel: string;
  title: string;
  summary: string;
  detail?: string;
  inputPayload?: string;
  outputPayload?: string;
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'info';
  timestamp?: number;
  rawEvent?: AgentStreamEvent;
  rawMessage?: CoderThreadMessage;
  index: number;
}

export interface RotatingChatSectionProps {
  /** Trace events from an active or finished agent run */
  events?: AgentStreamEvent[];
  /** Optional thread messages if used for thread-level rotation */
  messages?: CoderThreadMessage[];
  /** Whether the agent is currently streaming/running */
  loading?: boolean;
  /** Section title override */
  title?: string;
  /** Auto-rotation delay in milliseconds (default: 3500ms) */
  autoRotateInterval?: number;
  /** Controlled expansion state */
  isExpanded?: boolean;
  /** Callback when expansion state changes */
  onExpandedChange?: (expanded: boolean) => void;
  /** Optional callback when an event is clicked */
  onSelectEvent?: (index: number, event: AgentStreamEvent) => void;
  /** Extra container styling */
  className?: string;
  /** Element ID */
  id?: string;
  /** Test ID */
  testId?: string;
  // ── Preserved from 077 ────────────────────────────────────────────────────
  /** Highlighted event id for focused-event indicator */
  highlightedEventId?: string | null;
  /** Layout density: 'compact' reduces padding */
  density?: ChatViewDensity;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const formatCompactSummary = (value: string | undefined, maxChars = 180): string => {
  if (!value) return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars - 3)}...` : normalized;
};

const stringifyPayload = (payload: unknown): string => {
  if (payload === undefined || payload === null) return '';
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
};

// ─── Public derivation functions (required by test suite) ─────────────────────

export const deriveRotatingItemsFromEvents = (events: AgentStreamEvent[] = []): RotatingChatItem[] => {
  const items: RotatingChatItem[] = [];

  events.forEach((event, idx) => {
    // Filter out internal non-visual reasoning token deltas
    if (event.type === 'reasoning_delta') return;
    if (event.type === 'pacing_wait' && event.scope === 'presentation') return;

    const outcome = getAgentEventOutcome(event);
    const failed = eventFailed(event);
    const timedOut = eventTimedOut(event);
    const status: RotatingChatItem['status'] = failed || timedOut
      ? 'failed'
      : outcome === 'started'
        ? 'running'
        : outcome === 'stopped'
          ? 'stopped'
          : outcome === 'info'
            ? 'info'
            : 'completed';

    const t = eventTitle(event);
    const body = eventBody(event);
    const summary = formatCompactSummary(body) || t;

    let category: RotatingChatItem['category'] = 'system';
    let categoryLabel = 'System';
    let inputPayload: string | undefined;
    let outputPayload: string | undefined;

    if (event.type === 'tool_started') {
      category = 'tool';
      categoryLabel = `Tool: ${event.tool}`;
      inputPayload = stringifyPayload(event.input);
    } else if (event.type === 'tool_result') {
      category = 'tool';
      categoryLabel = `Result: ${event.tool}`;
      outputPayload = stringifyPayload(event.result);
    } else if (event.type === 'file_read' || event.type === 'file_changed') {
      category = 'file';
      categoryLabel = event.type === 'file_read' ? 'File Read' : 'File Modified';
      if (event.type === 'file_changed' && event.diff) {
        outputPayload = event.diff;
      }
    } else if (event.type === 'command_started' || event.type === 'command_output') {
      category = 'command';
      categoryLabel = 'Terminal Command';
      if (event.type === 'command_output') {
        outputPayload = event.output;
      } else {
        inputPayload = event.command;
      }
    } else if (event.type === 'package_install_started' || event.type === 'package_install_result') {
      category = 'tool';
      categoryLabel = 'Dependency Manager';
      if (event.type === 'package_install_result' && event.output) {
        outputPayload = event.output;
      }
    } else if (event.type === 'verification_started' || event.type === 'verification_result') {
      category = 'verification';
      categoryLabel = 'Verification';
      if (event.type === 'verification_result' && event.output) {
        outputPayload = event.output;
      }
    } else if (
      event.type === 'reasoning_start' ||
      event.type === 'reasoning_end' ||
      event.type === 'plan_updated' ||
      event.type === 'todo_snapshot' ||
      event.type === 'decision_record' ||
      event.type === 'workplan_updated'
    ) {
      category = 'planning';
      categoryLabel = 'Planning & Reasoning';
      if (event.type === 'reasoning_end' && event.summary) {
        outputPayload = event.summary;
      }
    } else if (event.type === 'model_response' || event.type === 'final') {
      category = 'response';
      categoryLabel = 'Model Response';
      outputPayload = event.message;
    } else if (event.type === 'user_input_required' || event.type === 'user_input_resolved') {
      category = 'user';
      categoryLabel = 'User Interaction';
    } else if (event.type === 'llm_request_started' || event.type === 'llm_request_finished' || event.type === 'model_target_resolved') {
      category = 'model';
      categoryLabel = 'Model Engine';
    }

    items.push({
      id: `evt-${idx}-${event.type}`,
      source: 'event',
      category,
      categoryLabel,
      title: t,
      summary,
      detail: body,
      inputPayload,
      outputPayload,
      status,
      rawEvent: event,
      index: idx,
    });
  });

  return items;
};

export const deriveRotatingItemsFromMessages = (messages: CoderThreadMessage[] = []): RotatingChatItem[] => {
  return messages.map((msg, idx) => {
    const isUser = msg.role === 'user';
    const isError = msg.status === 'error' || msg.status === 'timed_out';
    const category: RotatingChatItem['category'] = isUser ? 'user' : isError ? 'system' : 'response';
    const categoryLabel = isUser ? 'You' : isError ? 'Error' : 'ReAct Coder';
    const title = isUser
      ? 'Task Prompt'
      : msg.status === 'timed_out'
        ? 'Run Timed Out'
        : isError
          ? 'System Alert'
          : 'Agent Response';
    const summary = formatCompactSummary(msg.content, 180) || '(No text content)';
    const status: RotatingChatItem['status'] = isError
      ? 'failed'
      : msg.status === 'running'
        ? 'running'
        : 'completed';

    return {
      id: msg.id || `msg-${idx}`,
      source: 'message',
      category,
      categoryLabel,
      title,
      summary,
      detail: msg.content,
      outputPayload: msg.reasoningSummary ? `Reasoning Summary:\n${msg.reasoningSummary}` : undefined,
      status,
      timestamp: msg.createdAt,
      rawMessage: msg,
      index: idx,
    };
  });
};

// ─── Private rendering helpers ────────────────────────────────────────────────

const renderCategoryIcon = (category: RotatingChatItem['category'], size = 'h-3.5 w-3.5') => {
  switch (category) {
    case 'tool':
      return <Wrench className={`${size} text-cyan-400`} />;
    case 'planning':
      return <Sparkles className={`${size} text-purple-400`} />;
    case 'verification':
      return <CheckCircle2 className={`${size} text-emerald-400`} />;
    case 'file':
      return <FileCode className={`${size} text-blue-400`} />;
    case 'command':
      return <TerminalSquare className={`${size} text-amber-400`} />;
    case 'model':
      return <Bot className={`${size} text-cyan-300`} />;
    case 'user':
      return <User className={`${size} text-sky-400`} />;
    case 'response':
      return <MessageSquare className={`${size} text-teal-300`} />;
    default:
      return <Activity className={`${size} text-neutral-400`} />;
  }
};

const statusBadgeClasses = (status: RotatingChatItem['status']): string => {
  switch (status) {
    case 'running':
      return 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300';
    case 'completed':
      return 'border-emerald-500/30 bg-emerald-950/30 text-emerald-300';
    case 'failed':
      return 'border-rose-500/40 bg-rose-950/40 text-rose-300';
    case 'stopped':
      return 'border-amber-500/30 bg-amber-950/30 text-amber-300';
    default:
      return 'border-neutral-800 bg-neutral-900 text-neutral-400';
  }
};

// ─── Component ────────────────────────────────────────────────────────────────

export const RotatingChatSection: React.FC<RotatingChatSectionProps> = ({
  events = [],
  messages,
  loading = false,
  title,
  autoRotateInterval = 3500,
  isExpanded: controlledExpanded,
  onExpandedChange,
  onSelectEvent,
  className = '',
  id = 'rotating-chat-section',
  testId = 'rotating-chat-section',
  // ── Preserved from 077 ──────────────────────────────────────────────────
  highlightedEventId = null,
  density = 'detailed',
}) => {
  // ── Controlled / uncontrolled expansion ───────────────────────────────────
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(false);
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : uncontrolledExpanded;

  const setExpanded = useCallback(
    (val: boolean) => {
      if (controlledExpanded === undefined) {
        setUncontrolledExpanded(val);
      }
      onExpandedChange?.(val);
    },
    [controlledExpanded, onExpandedChange]
  );

  // ── Rotation state ────────────────────────────────────────────────────────
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAutoRotating, setIsAutoRotating] = useState(true);
  const [isPausedByHover, setIsPausedByHover] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'tool' | 'planning' | 'other'>('all');
  const [expandedPayloadIds, setExpandedPayloadIds] = useState<Set<string>>(new Set());

  // ── Reduced-motion accessibility (preserved from 077) ─────────────────────
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mediaQuery.matches);
    update();
    mediaQuery.addEventListener?.('change', update);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mediaQuery as any).addListener?.(update);
    return () => {
      mediaQuery.removeEventListener?.('change', update);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mediaQuery as any).removeListener?.(update);
    };
  }, []);

  // ── Derive rotating items based on events or messages ─────────────────────
  const items = useMemo(() => {
    if (messages && messages.length > 0) {
      return deriveRotatingItemsFromMessages(messages);
    }
    return deriveRotatingItemsFromEvents(events);
  }, [events, messages]);

  const totalCount = items.length;

  // Keep index within bounds if total count changes
  useEffect(() => {
    if (currentIndex >= totalCount && totalCount > 0) {
      setCurrentIndex(totalCount - 1);
    }
  }, [totalCount, currentIndex]);

  // When live events arrive and user is viewing the latest, auto-advance to latest
  const prevCountRef = useRef(totalCount);
  useEffect(() => {
    if (loading && totalCount > prevCountRef.current) {
      if (isAutoRotating && !isPausedByHover && !isExpanded && !reducedMotion) {
        setCurrentIndex(totalCount - 1);
      }
    }
    prevCountRef.current = totalCount;
  }, [totalCount, loading, isAutoRotating, isPausedByHover, isExpanded, reducedMotion]);

  // Auto-rotation timer
  useEffect(() => {
    if (!isAutoRotating || isPausedByHover || isExpanded || totalCount <= 1 || reducedMotion) {
      return;
    }

    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % totalCount);
    }, autoRotateInterval);

    return () => clearInterval(timer);
  }, [isAutoRotating, isPausedByHover, isExpanded, totalCount, autoRotateInterval, reducedMotion]);

  const handlePrev = useCallback(() => {
    if (totalCount === 0) return;
    setCurrentIndex((prev) => (prev - 1 + totalCount) % totalCount);
  }, [totalCount]);

  const handleNext = useCallback(() => {
    if (totalCount === 0) return;
    setCurrentIndex((prev) => (prev + 1) % totalCount);
  }, [totalCount]);

  const togglePayload = useCallback((itemId: string) => {
    setExpandedPayloadIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const currentItem = items[currentIndex];

  // Derive the event id string for the current item (used for highlightedEventId)
  const currentItemEventId = currentItem?.rawEvent
    ? `evt-${currentItem.index}-${currentItem.rawEvent.type}`
    : null;

  // Filtered items for expanded chat text list
  const filteredItems = useMemo(() => {
    if (activeFilter === 'all') return items;
    if (activeFilter === 'tool') {
      return items.filter((item) => item.category === 'tool' || item.category === 'file' || item.category === 'command');
    }
    if (activeFilter === 'planning') {
      return items.filter((item) => item.category === 'planning');
    }
    return items.filter((item) => item.category !== 'tool' && item.category !== 'file' && item.category !== 'command' && item.category !== 'planning');
  }, [items, activeFilter]);

  if (totalCount === 0 && !loading) {
    return null;
  }

  const paddingClass = density === 'compact' ? 'p-3 sm:p-4' : 'p-4 sm:p-5';

  return (
    <section
      id={id}
      data-testid={testId}
      aria-label="Rotating Chat Section"
      className={`relative w-full rounded-2xl border border-neutral-800/90 bg-[#0c1017] transition-all duration-300 shadow-xl ${className}`}
      onMouseEnter={() => setIsPausedByHover(true)}
      onMouseLeave={() => setIsPausedByHover(false)}
    >
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-neutral-800/80 bg-[#0f141d]/80 px-4 py-2.5 backdrop-blur-sm rounded-t-2xl">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-[11px] font-bold uppercase tracking-wider text-slate-200">
                {title || (loading ? 'Active Agent Stream' : 'Activity & Progress')}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider ${loading ? 'border-cyan-500/50 bg-cyan-950/40 text-cyan-300' : 'border-neutral-800 bg-neutral-900 text-neutral-400'}`}>
                {loading ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    Live
                  </>
                ) : (
                  <span>{totalCount} item{totalCount === 1 ? '' : 's'}</span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Carousel controls & Expand/Collapse Toggle */}
        <div className="flex items-center gap-2">
          {!isExpanded && totalCount > 1 && (
            <div className="flex items-center gap-1 rounded-lg border border-neutral-800/80 bg-neutral-900/90 px-1 py-0.5" role="group" aria-label="Rotation navigation">
              <button
                id="btn-rotating-prev"
                type="button"
                onClick={handlePrev}
                className="rounded p-1 text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
                title="Previous message"
                aria-label="Previous message"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>

              <button
                id="btn-rotating-pause"
                type="button"
                onClick={() => setIsAutoRotating((prev) => !prev)}
                className={`rounded p-1 transition ${isAutoRotating ? 'text-cyan-400 hover:bg-cyan-500/20' : 'text-amber-400 hover:bg-amber-500/20'}`}
                title={isAutoRotating ? 'Pause auto-rotation' : 'Resume auto-rotation'}
                aria-label={isAutoRotating ? 'Pause auto-rotation' : 'Resume auto-rotation'}
              >
                {isAutoRotating ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 fill-current" />}
              </button>

              <span className="px-1.5 font-mono text-[10px] font-bold text-neutral-300 select-none">
                {currentIndex + 1} / {totalCount}
              </span>

              <button
                id="btn-rotating-next"
                type="button"
                onClick={handleNext}
                className="rounded p-1 text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
                title="Next message"
                aria-label="Next message"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Expand into Chat Text Format button */}
          <button
            id="btn-rotating-toggle-expand"
            type="button"
            onClick={() => setExpanded(!isExpanded)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] font-semibold transition ${
              isExpanded
                ? 'border-cyan-500/50 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/50'
                : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200 hover:border-cyan-400 hover:bg-cyan-500/20 hover:text-white shadow-sm'
            }`}
            title={isExpanded ? 'Collapse back to rotating message view' : 'Expand into full chat text format'}
          >
            {isExpanded ? (
              <>
                <Minimize2 className="h-3.5 w-3.5" />
                <span>Collapse to Rotating</span>
                <span className="sr-only">Hide history</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5" />
                <span>Expand to Chat Format</span>
                <span className="sr-only">View history</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Mode A: Rotating Message Card (Compact Carousel Mode) */}
      {!isExpanded && currentItem && (
        <div className={paddingClass} data-testid="rotating-compact-card">
          <div
            className={`group cursor-pointer rounded-xl border bg-[#090d14] p-4 transition-all hover:border-cyan-500/40 hover:bg-[#0c121c] ${
              highlightedEventId && currentItemEventId === highlightedEventId
                ? 'border-cyan-300 ring-2 ring-cyan-300/70'
                : 'border-neutral-800/80'
            }`}
            onClick={() => {
              if (currentItem.rawEvent && onSelectEvent) {
                onSelectEvent(currentItem.index, currentItem.rawEvent);
              } else {
                setExpanded(true);
              }
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setExpanded(true);
              }
            }}
          >
            {/* Top metadata row */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800/60 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded-md border border-neutral-800 bg-neutral-900">
                  {renderCategoryIcon(currentItem.category)}
                </div>
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-300">
                  {currentItem.categoryLabel}
                </span>
                <span className="text-neutral-700">·</span>
                <span className="font-mono text-[10px] text-neutral-500">
                  Step {currentIndex + 1} of {totalCount}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${statusBadgeClasses(currentItem.status)}`}>
                  {currentItem.status}
                </span>
                <span className="font-mono text-[10px] text-cyan-400/80 underline-offset-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  Click to expand
                </span>
              </div>
            </div>

            {/* Title & Body */}
            <div className="pt-3">
              <h4 className="font-mono text-sm font-bold text-white transition group-hover:text-cyan-200">
                {currentItem.title}
              </h4>
              <div className="mt-1.5 text-xs leading-relaxed text-neutral-300 whitespace-pre-wrap font-sans max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                {currentItem.detail || currentItem.summary}
              </div>
            </div>

            {/* If payload exists */}
            {(currentItem.inputPayload || currentItem.outputPayload) && (
              <div className="mt-3 flex items-center gap-2 font-mono text-[10px] text-neutral-500">
                <FileText className="h-3 w-3 text-cyan-400" />
                <span>Code & details available in expanded chat text view</span>
              </div>
            )}
          </div>

          {/* Timeline dots for jumping */}
          {totalCount > 1 && (
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 px-1">
              <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Step selector">
                {items.slice(0, 24).map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={idx === currentIndex}
                    onClick={() => setCurrentIndex(idx)}
                    className={`h-2 rounded-full transition-all duration-200 ${
                      idx === currentIndex
                        ? 'w-6 bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.7)]'
                        : 'w-2 bg-neutral-700 hover:bg-neutral-500'
                    }`}
                    title={`Jump to step ${idx + 1}: ${item.title}`}
                    aria-label={`Jump to step ${idx + 1}: ${item.title}`}
                  />
                ))}
                {totalCount > 24 && (
                  <span className="font-mono text-[9px] text-neutral-500">+{totalCount - 24} more</span>
                )}
              </div>

              {/* Autoplay status hint */}
              <div className="font-mono text-[9px] text-neutral-500">
                {reducedMotion ? (
                  <span>Motion reduced</span>
                ) : isPausedByHover ? (
                  <span className="text-amber-300/80">Paused on hover</span>
                ) : isAutoRotating ? (
                  <span>Auto-rotating every {Math.round(autoRotateInterval / 1000)}s</span>
                ) : (
                  <span>Auto-rotate paused</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading placeholder when no items yet */}
      {!isExpanded && !currentItem && loading && (
        <div className={`${paddingClass} text-center font-mono text-xs text-neutral-500`}>
          Waiting for the first action...
        </div>
      )}

      {/* Mode B: Expanded Chat Text Format (Full Conversational List) */}
      {isExpanded && (
        <div className={paddingClass} data-testid="rotating-expanded-chat-list">
          {/* Expanded Toolbar with Category Filter */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5 border-b border-neutral-800/80 pb-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-500 mr-1">Filter:</span>
              <button
                type="button"
                onClick={() => setActiveFilter('all')}
                className={`rounded-md px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition ${
                  activeFilter === 'all'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 border border-neutral-800'
                }`}
              >
                All ({items.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('tool')}
                className={`rounded-md px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition ${
                  activeFilter === 'tool'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 border border-neutral-800'
                }`}
              >
                Tools & Files ({items.filter((i) => i.category === 'tool' || i.category === 'file' || i.category === 'command').length})
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('planning')}
                className={`rounded-md px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition ${
                  activeFilter === 'planning'
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                    : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 border border-neutral-800'
                }`}
              >
                Planning ({items.filter((i) => i.category === 'planning').length})
              </button>
            </div>

            <div className="font-mono text-[10px] text-neutral-400">
              Showing {filteredItems.length} of {items.length} steps in chat text format
            </div>
          </div>

          {/* Sequential Chat Text Format Messages */}
          <div className="space-y-3.5 max-h-[560px] overflow-y-auto custom-scrollbar pr-1">
            {filteredItems.map((item) => {
              const isItemPayloadOpen = expandedPayloadIds.has(item.id);
              const hasPayload = Boolean(item.inputPayload || item.outputPayload);
              const itemEventId = item.rawEvent
                ? `evt-${item.index}-${item.rawEvent.type}`
                : null;

              return (
                <article
                  key={item.id}
                  id={`chat-item-${item.id}`}
                  data-testid="chat-text-row"
                  data-item-index={item.index}
                  className={`flex items-start gap-3 rounded-xl border bg-[#090d14] p-3.5 transition hover:border-neutral-700/80 ${
                    highlightedEventId && itemEventId === highlightedEventId
                      ? 'border-cyan-300 ring-2 ring-cyan-300/70'
                      : 'border-neutral-800/70'
                  }`}
                >
                  {/* Left Avatar Icon */}
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-[#121620] shadow-sm">
                    {renderCategoryIcon(item.category, 'h-4 w-4')}
                  </div>

                  {/* Main Chat Bubble Content */}
                  <div className="min-w-0 flex-1">
                    {/* Header line */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-white">
                          {item.title}
                        </span>
                        <span className="rounded bg-neutral-900 border border-neutral-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-neutral-400">
                          {item.categoryLabel}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${statusBadgeClasses(item.status)}`}>
                          {item.status}
                        </span>
                        <span className="font-mono text-[10px] text-neutral-500">
                          #{item.index + 1}
                        </span>
                      </div>
                    </div>

                    {/* Chat Text Body */}
                    <div className="mt-2 text-xs leading-relaxed text-slate-200 whitespace-pre-wrap max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                      {item.detail || item.summary}
                    </div>

                    {/* Expandable Code / Output Payload */}
                    {hasPayload && (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => togglePayload(item.id)}
                          className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-400 transition hover:text-cyan-300"
                        >
                          {isItemPayloadOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          <span>{isItemPayloadOpen ? 'Hide Payload / Output' : 'View Payload / Code Output'}</span>
                        </button>

                        {isItemPayloadOpen && (
                          <div className="mt-2 space-y-2 rounded-lg border border-neutral-800/80 bg-[#05070a] p-3 font-mono text-[10px]">
                            {item.inputPayload && (
                              <div>
                                <div className="mb-1 font-bold uppercase tracking-wider text-cyan-300">Input Payload</div>
                                <pre className="max-h-48 overflow-auto rounded border border-neutral-900 bg-neutral-950 p-2 text-cyan-200 leading-relaxed whitespace-pre-wrap break-words">
                                  {item.inputPayload}
                                </pre>
                              </div>
                            )}
                            {item.outputPayload && (
                              <div>
                                <div className="mb-1 font-bold uppercase tracking-wider text-emerald-300">Output Result</div>
                                <pre className="max-h-60 overflow-auto rounded border border-neutral-900 bg-neutral-950 p-2 text-slate-200 leading-relaxed whitespace-pre-wrap break-words">
                                  {item.outputPayload}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}

            {filteredItems.length === 0 && (
              <div className="p-6 text-center font-mono text-xs text-neutral-500">
                No items match the selected filter.
              </div>
            )}
          </div>

          {/* Footer Collapse Action */}
          <div className="mt-4 flex items-center justify-between border-t border-neutral-800/80 pt-3">
            <span className="font-mono text-[10px] text-neutral-500">
              End of list · {filteredItems.length} messages
            </span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/80 px-3 py-1.5 font-mono text-[11px] font-semibold text-neutral-300 hover:border-cyan-500/40 hover:text-white transition"
            >
              <Minimize2 className="h-3.5 w-3.5" />
              <span>Collapse to Rotating View</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
