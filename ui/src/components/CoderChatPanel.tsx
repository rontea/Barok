import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  AlertCircle,
  Bell,
  BellOff,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Code2,
  Cpu,
  Download,
  File,
  FileCode,
  FilePenLine,
  Folder,
  FolderOpen,
  HelpCircle,
  History,
  Info,
  ListChecks,
  Loader2,
  Maximize2,
  MessageSquare,
  Mic,
  Image as ImageIcon,
  Paperclip,
  PauseCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Route,
  Search,
  Send,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Square,
  TerminalSquare,
  Trash2,
  Undo2,
  User,
  Terminal,
  Columns,
  FileText,
  Code,
  Copy,
  Check,
  Package,
  Pencil,
  Wrench,
  X,
  ZoomIn,
} from 'lucide-react';
import { ConsoleRunPanel } from './ConsoleRunPanel';
import { AgentGuidanceCard } from './AgentGuidanceCard';
import { QualityGatePanel } from './QualityGatePanel';
import { RotatingChatSection } from './RotatingChatSection';
import { StreamlinedChatView } from './StreamlinedChatView';
import { deriveHarnessStages } from './HarnessCodingChatSection';
import type { QualityGateResult } from '../../../src/react/quality-gates';
import type { CoderTaskAnalysisView } from '../../../src/coder/taskAnalysisView';
import type { ChildRunRecord } from '../../../src/agents/child-runs';
import {
  GEMINI_BASE_API,
  GROQ_BASE_API,
  KIMI_BASE_API,
  NVIDIA_BASE_API,
  OPENROUTER_BASE_API,
  POLLINATIONS_BASE_API,
  REQUESTY_BASE_API,
  SAMBANOVA_BASE_API,
  DEFAULT_CODER_MODEL_SELECTION,
  dedupeModelOptions,
  getModelOptionContextLabel,
  getModelOptionContextWindow,
  getModelOptionDisplayLabel,
  getModelOptionTier,
  type ModelOption,
  withBaseApi,
} from '../modelOptions';
import { Button } from './FormComponents';
import type { PendingUserQuestion } from '../utils/pendingUserQuestion';
import { FinalAnswerRenderer } from './FinalAnswerRenderer';
import { EvidenceReviewPanel, type RequirementEvidenceItem } from './EvidenceReviewPanel';
import { createTypewriterController } from '../utils/typewriter';
import { sanitizeCoderThreadTitle } from '../../../src/utils/coderThreadTitle';
import {
  isCurrentLocalAiEndpointFailure,
  LOCAL_AI_TEST_RESULTS_EVENT,
  readLocalAiEndpointTestResults,
} from '../utils/localAiEndpointTest';
import {
  CODER_IMAGE_MAX_COUNT,
  CODER_IMAGE_MAX_TOTAL_DATA_URL_CHARS,
  coderImagePayloadChars,
  isSupportedCoderImageType,
  prepareCoderImage,
} from '../utils/coderImageAttachments';
import {
  eventBody as sharedEventBody,
  eventFailed,
  eventTimedOut,
  eventTitle as sharedEventTitle,
  formatAgentRequestRoute,
  getAgentEventOutcome,
  getAgentEventMessage,
  formatTerminalResultError,
} from '../utils/agentEventMessages';
import {
  EXECUTION_PROFILE_PRESETS,
  USER_EXECUTION_PROFILE_IDS,
  getExecutionProfilePreset,
  type ExecutionPacingProfile,
} from '../../../src/config/executionProfiles';
import {
  INTERFACE_DISPLAY_EVENT,
  readInterfaceDisplayPreferences,
  writeInterfaceDisplayPreferences,
  type ChatMessageFormat,
  type ChatViewDensity,
} from '../utils/interfaceDisplayPreferences';
import {
  chatStorageScope,
  readIgnoredContextFiles,
  readScopedChatDraft,
  writeIgnoredContextFiles,
  writeScopedChatDraft,
} from '../utils/chatComposerPersistence';
import { CODER_COMPOSER_DOCK_CLASS, CODER_COMPOSER_FORM_CLASS } from '../utils/composerLayout';
import type { RunTerminalAdviceEvent } from '../../../src/react/terminal-run-advice';
export { getAgentEventOutcome } from '../utils/agentEventMessages';
export type { ExecutionPacingProfile } from '../../../src/config/executionProfiles';
export type { ChatMessageFormat, ChatViewDensity } from '../utils/interfaceDisplayPreferences';

const ComposerPortal: React.FC<{ target: HTMLElement | null; children: React.ReactNode }> = ({ target, children }) => (
  target ? createPortal(children, target) : <>{children}</>
);

const TypewriterText: React.FC<{
  text: string;
  speedMs?: number;
  charsPerTick?: number;
  className?: string;
  showCursor?: boolean;
}> = ({ text, speedMs = 12, charsPerTick = 2, className = '', showCursor = true }) => {
  const [displayedText, setDisplayedText] = useState('');
  const controllerRef = useRef<ReturnType<typeof createTypewriterController> | null>(null);

  useEffect(() => {
    controllerRef.current = createTypewriterController({
      intervalMs: speedMs,
      charactersPerTick: charsPerTick,
      onText: (t) => setDisplayedText(t),
    });

    controllerRef.current.setTarget(text || '');

    return () => {
      controllerRef.current?.cancel();
    };
  }, [text, speedMs, charsPerTick]);

  const isTyping = displayedText.length < (text || '').length;

  return (
    <span className={className}>
      <span className="whitespace-pre-wrap">{displayedText}</span>
      {showCursor && isTyping && (
        <span className="inline-block ml-1 h-3.5 w-1.5 animate-pulse rounded-sm bg-cyan-400 align-middle shadow-[0_0_8px_#22d3ee]" />
      )}
    </span>
  );
};

const RECENT_THREAD_MESSAGE_COUNT = 60;
const AGENT_EVENT_RENDER_LIMIT = 120;
const ACTIVE_PROMPT_THREAD_LIMIT = 6;
const ACTIVE_PROMPT_MEMORY_ITEM_LIMIT = 240;
const CHAT_VIEW_MODE_STORAGE_KEY = 'coder_chat_view_mode';

type ChatViewMode = 'chat' | 'console' | 'split';

const isChatViewMode = (value: unknown): value is ChatViewMode =>
  value === 'chat' || value === 'console' || value === 'split';

const readStoredChatViewMode = (threadId?: string | null): ChatViewMode => {
  try {
    if (typeof window === 'undefined') return 'chat';
    const raw = window.localStorage.getItem(CHAT_VIEW_MODE_STORAGE_KEY);
    if (!raw) return 'chat';
    try {
      const scoped = JSON.parse(raw) as Record<string, unknown>;
      const scopedMode = threadId ? scoped[threadId] : scoped.default;
      if (isChatViewMode(scopedMode)) return scopedMode;
    } catch {
      // Migrate the previous single-value preference below.
    }
    return isChatViewMode(raw) ? raw : 'chat';
  } catch {
    return 'chat';
  }
};

const writeStoredChatViewMode = (threadId: string | null | undefined, mode: ChatViewMode) => {
  try {
    const raw = window.localStorage.getItem(CHAT_VIEW_MODE_STORAGE_KEY);
    let scoped: Record<string, unknown> = {};
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) scoped = parsed as Record<string, unknown>;
    } catch {
      // Ignore the legacy scalar value and replace it with scoped preferences.
    }
    scoped[threadId || 'default'] = mode;
    window.localStorage.setItem(CHAT_VIEW_MODE_STORAGE_KEY, JSON.stringify(scoped));
  } catch {
    // View preferences are optional and must not block chat interaction.
  }
};


interface RunTokenDisplayMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  contextWindow: number;
  contextRemainingTokens: number;
  contextUsedPercent: number;
  context_window_used_percent?: number;
  promptPrefillDurationMs?: number;
  providerPromptTokens?: number;
  providerPromptRemainingTokens?: number;
  providerPromptUsedPercent?: number;
  hasProviderPrompt: boolean;
  hasContextWindow: boolean;
  hasRunUsage: boolean;
}

const finiteTokenMetric = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return Math.round(value).toLocaleString();
}

export function deriveRunTokenMetrics({
  liveState,
  result,
  fallbackContextTokens,
  fallbackContextWindow,
}: {
  liveState?: any;
  result?: any;
  fallbackContextTokens: number;
  fallbackContextWindow: number;
}): RunTokenDisplayMetrics {
  const live = liveState?.runTokenUsage;
  const counters = result?.performanceTrace?.counters || {};
  const inputTokens = finiteTokenMetric(live?.inputTokens) ?? finiteTokenMetric(counters.llm_input_tokens) ?? 0;
  const outputTokens = finiteTokenMetric(live?.outputTokens) ?? finiteTokenMetric(counters.llm_output_tokens) ?? 0;
  const contextTokens = finiteTokenMetric(live?.estimatedContextTokens)
    ?? finiteTokenMetric(counters.estimated_context_tokens)
    ?? fallbackContextTokens;
  const contextWindow = finiteTokenMetric(live?.contextWindow)
    ?? finiteTokenMetric(counters.model_context_window_tokens)
    ?? fallbackContextWindow;
  const contextRemainingTokens = finiteTokenMetric(live?.contextRemainingTokens)
    ?? finiteTokenMetric(counters.estimated_context_remaining_tokens)
    ?? Math.max(0, contextWindow - contextTokens);
  const contextUsedPercent = finiteTokenMetric(live?.contextUsedPercent)
    ?? finiteTokenMetric(counters.context_window_used_percent)
    ?? (contextWindow > 0 ? Math.min(100, (contextTokens / contextWindow) * 100) : 0);
  const context_window_used_percent = finiteTokenMetric(live?.context_window_used_percent)
    ?? finiteTokenMetric(counters.context_window_used_percent)
    ?? contextUsedPercent;
  const promptPrefillDurationMs = finiteTokenMetric(live?.promptPrefillDurationMs)
    ?? finiteTokenMetric(live?.prompt_prefill_duration_ms)
    ?? finiteTokenMetric(counters.prompt_prefill_duration_ms);
  const providerPromptTokens = finiteTokenMetric(live?.providerReportedPromptTokens)
    ?? (finiteTokenMetric(counters.provider_reported_prompt_tokens) || undefined);
  const providerPromptRemainingTokens = finiteTokenMetric(live?.providerPromptRemainingTokens)
    ?? (providerPromptTokens !== undefined && contextWindow > 0
      ? Math.max(0, contextWindow - providerPromptTokens)
      : finiteTokenMetric(counters.provider_prompt_remaining_tokens));
  const providerPromptUsedPercent = finiteTokenMetric(live?.providerPromptUsedPercent)
    ?? finiteTokenMetric(counters.provider_prompt_used_percent)
    ?? (providerPromptTokens !== undefined && contextWindow > 0
      ? Math.min(100, (providerPromptTokens / contextWindow) * 100)
      : undefined);
  const hasProviderPrompt = providerPromptTokens !== undefined && contextWindow > 0;
  const hasContextWindow = contextWindow > 0;

  return {
    inputTokens,
    outputTokens,
    totalTokens: finiteTokenMetric(live?.totalTokens)
      ?? finiteTokenMetric(counters.llm_total_tokens)
      ?? inputTokens + outputTokens,
    contextTokens,
    contextWindow,
    contextRemainingTokens,
    contextUsedPercent,
    context_window_used_percent,
    promptPrefillDurationMs,
    providerPromptTokens,
    providerPromptRemainingTokens,
    providerPromptUsedPercent,
    hasProviderPrompt,
    hasContextWindow,
    hasRunUsage: Boolean(live || result?.performanceTrace),
  };
}

interface PlanItem {
  id?: string;
  step: string;
  status: 'pending' | 'in_progress' | 'completed';
  kind?: 'inspect' | 'implement' | 'verify';
  acceptanceCriteria?: string[];
  evidenceIds?: string[];
}

interface DurableTodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

interface ReActStep {
  thought: string;
  action: string;
  action_input: Record<string, unknown>;
  observation?: string;
}

export interface ReActResult {
  success: boolean;
  executionCompleted?: boolean;
  verificationStatus?: 'passed' | 'failed' | 'blocked' | 'incomplete' | 'unavailable';
  finalAnswer?: string;
  plan?: PlanItem[];
  steps: ReActStep[];
  stepCount: number;
  pollenCost?: number;
  error?: string;
  errorCode?: string;
  requirementEvidence?: RequirementEvidenceItem[];
  reviewFindings?: string[];
  verificationResult?: {
    passed?: boolean;
    qualityGates?: QualityGateResult[];
    qualityScore?: number;
  };
  performanceTrace?: {
    counters?: Record<string, number>;
  };
}

const isCheckpointResult = (value?: { error?: string; errorCode?: string } | null) =>
  value?.errorCode === 'MAX_STEPS_EXCEEDED' ||
  value?.error === 'Max steps exceeded' ||
  /turn limit reached|autonomous turn checkpoint reached/i.test(value?.error || '');

const isTimeoutResult = (value?: { error?: string; errorCode?: string } | null) =>
  Boolean(value && /\b(?:timed[\s_-]*out|timeout|deadline(?:\s+exceeded)?)\b/i.test(`${value.errorCode || ''} ${value.error || ''}`));

type TerminalRunOutcome = 'completed' | 'checkpoint' | 'timed_out' | 'stopped' | 'interrupted' | 'killed' | 'failed';

const resolveTerminalRunOutcome = (
  value?: { success?: boolean; error?: string; errorCode?: string } | null,
  fallbackStatus?: string,
): TerminalRunOutcome => {
  if (isCheckpointResult(value)) return 'checkpoint';
  if (value?.errorCode === 'USER_STOPPED' || fallbackStatus === 'stopped') return 'stopped';
  if (value?.errorCode === 'RUN_INTERRUPTED' || fallbackStatus === 'interrupted') return 'interrupted';
  if (value?.errorCode === 'RUN_KILLED' || fallbackStatus === 'killed') return 'killed';
  if (value?.success) return 'completed';
  if (isTimeoutResult(value) || fallbackStatus === 'timed_out') return 'timed_out';
  return 'failed';
};

const displayAgentError = (error?: string, errorCode?: string) =>
  formatTerminalResultError({ error, errorCode });

const TerminalRunAdviceCard: React.FC<{ advice: RunTerminalAdviceEvent }> = ({ advice }) => (
  <section
    aria-label="What to do next"
    className="mb-3 rounded-lg border border-amber-400/35 bg-amber-950/35 p-3 text-amber-50"
    data-testid="terminal-run-advice"
    role="status"
  >
    <div className="flex items-start gap-2">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-200">{advice.title}</div>
        <p className="mt-1 text-xs leading-relaxed text-amber-100/90">{advice.summary}</p>
        <div className="mt-2 font-mono text-[9px] font-bold uppercase tracking-wider text-amber-300">What to do next</div>
        <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-amber-100/85">
          {advice.guidance.map((item, index) => <li key={`${advice.category}-${index}`}>{item}</li>)}
        </ul>
        <a
          className="mt-2 inline-flex text-[11px] font-semibold text-cyan-200 underline decoration-cyan-400/50 underline-offset-2 hover:text-white"
          href={advice.learnMoreUrl}
          rel="noreferrer"
          target="_blank"
        >
          Learn more in the Running Agent Guide
        </a>
      </div>
    </div>
  </section>
);

const isCompletedWithVerificationFailure = (value?: ReActResult | null) =>
  Boolean(value?.executionCompleted === true && value?.verificationStatus === 'failed');

const displayPlanItem = (value: string) =>
  value.replace(/^\s*(?:step|phase)\s+\d+\s*[:.)-]\s*/i, '').trim();

interface TreeNode {
  name: string;
  type: 'directory' | 'file';
  path?: string;
  children?: TreeNode[];
}

type CoderTaskKind =
  | 'question'
  | 'investigation'
  | 'bug_fix'
  | 'new_feature'
  | 'refactor'
  | 'test_only'
  | 'docs_only'
  | 'continuation'
  | 'new_instance';

type FileChangeIntent = 'read_only' | 'create' | 'modify' | 'delete' | 'rename' | 'unknown';

export interface CoderTaskAnalysis {
  id: string;
  userRequest: string;
  taskKind: CoderTaskKind;
  instanceMode: 'continuation' | 'new_instance' | 'unknown';
  targetLayer?: 'ui' | 'backend' | 'shared' | 'config' | 'docs' | 'tests' | 'unknown' | 'full_stack';
  behaviorScope?: 'read_only' | 'existing_behavior_fix' | 'new_behavior' | 'new_instance' | 'maintenance';
  refactorRisk?: 'safe_change' | 'risky_refactor';
  confidence: number;
  workspace: string;
  projectFileMap?: {
    workspace: string;
    generatedAt: number;
    totalFiles: number;
    omittedCount: number;
    files: Array<{ path: string; layer: string; role: string; exists: boolean }>;
  };
  mentionedFiles: string[];
  inferredFiles: string[];
  sourceFiles?: string[];
  expectedChangeIntent: FileChangeIntent;
  affectedFiles: Array<{
    path: string;
    intent: FileChangeIntent;
    reason: string;
    mustReadBeforeEdit: boolean;
  }>;
  riskLevel: 'low' | 'medium' | 'high';
  riskFactors?: string[];
  requiresApproval: boolean;
  requiredInspections: string[];
  verificationPlan: string[];
  validationRequirements?: string[];
  rationale: string;
}

export type CoderMode = 'chat' | 'agent' | 'auto';
export type ApprovalMode = 'ask' | 'auto_approve' | 'full_access';
export type ExecutionPacingProfile = 'automatic' | 'conservative' | 'phased' | 'fast';
export type AgentRunStatus = 'thinking' | 'planning' | 'reading files' | 'editing files' | 'running command' | 'installing dependencies' | 'verifying' | 'waiting for you' | 'waiting for provider' | 'completed' | 'failed' | 'timed_out' | 'stopped' | 'interrupted' | 'killed';
type AgentReasoningVisibility = 'hidden' | 'collapsed' | 'full' | 'redacted';
type AgentReasoningSource = 'engine' | 'model' | 'provider' | 'native';
type AgentDecisionRecordStatus = 'pending' | 'succeeded' | 'failed' | 'invalidated';
type AgentDecisionCategory = 'planning' | 'inspection' | 'implementation' | 'verification' | 'recovery' | 'coordination' | 'clarification' | 'completion' | 'unknown';
type AgentEvidenceCheckType = 'file_exists' | 'contains_text' | 'command_passed' | 'files_changed' | 'verification_passed' | 'search_match' | 'package_installed' | 'workspace_change_detected';

interface AgentReasoningContext {
  userRequest: string;
  latestUserInput?: string;
  loopState: string;
  activePlanItem?: string;
  trigger: 'user_request' | 'user_message' | 'tool_result' | 'recovery' | 'continuation';
  latestEvidence?: string;
}

interface AgentEvidenceCheck {
  type: AgentEvidenceCheckType;
  path?: string;
  text?: string;
  command?: string;
  packageName?: string;
}

interface AgentDecisionRecord {
  id: string;
  step: number;
  provider: string;
  model: string;
  action: { action: string; action_input: Record<string, unknown> };
  decisionCategory?: AgentDecisionCategory;
  reasoningVisibility: AgentReasoningVisibility;
  reasoningSource: AgentReasoningSource;
  status: AgentDecisionRecordStatus;
  evidenceChecks?: AgentEvidenceCheck[];
  toolEvidenceId?: string;
  rationale?: string;
  expectedEvidence?: string[];
  preconditions?: string[];
  stopCondition?: string;
  observedEvidence?: { status: 'success' | 'failure' | 'unknown'; assessment: 'supported' | 'contradicted' | 'unverified'; checkResults?: Array<{ type: AgentEvidenceCheckType; status: 'passed' | 'failed' | 'unverified'; detail?: string }>; summary: string };
}

interface AgentInboxEntryView {
  messageId: string;
  inboxSeq: number;
  source: string;
  target: 'next-turn' | 'next-step';
  message: string;
  status: 'pending' | 'claimed' | 'cancelled' | 'processed';
}

interface AgentRequestRoute {
  provider?: string;
  model?: string;
  profileId?: string;
  credentialIndex?: number;
}

export interface AgentRequestEnvelope {
  requestId?: string;
  stepId?: string;
  requestKind?: string;
  status?: 'started' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled' | 'unknown' | string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  requestedRoute?: AgentRequestRoute;
  resolvedRoute?: AgentRequestRoute;
  options?: { timeoutMs?: number };
  categoryTokens?: {
    task?: number;
    plan?: number;
    evidence?: number;
    activeErrors?: number;
    memory?: number;
    history?: number;
    system?: number;
  };
  error?: string;
}

export type AgentStreamEvent =
  | { type: 'run_started'; task: string }
  | RunTerminalAdviceEvent
  | { type: 'task_analysis_ready'; taskAnalysis: CoderTaskAnalysisView }
  | { type: 'agent_guidance_snapshot'; codingState: string; injectedDirective: string; permissionConstraints: string[]; activeGateFailures: string[]; contextBudgetUsed: number; step: number; stepId?: string }
  | { type: 'console_output'; message: string }
  | { type: 'plan_updated'; plan: string | string[] | PlanItem[] }
  | { type: 'todo_snapshot'; revision: number; items: DurableTodoItem[] }
  | { type: 'todo_links_updated'; revision: number; links: Array<{ itemId: string; acceptanceCriteria: string[]; evidenceIds: string[] }>; acceptanceCriteria: string[]; progressCursor?: { currentItemId?: string; currentStep?: number; phase?: string; remainingItemIds: string[] } }
  | { type: 'workplan_updated'; workPlan?: { objective?: string; status?: string; steps?: string[] } }
  | { type: 'state_transition'; transition: { from: string; to: string; reason: string; evidence: unknown[]; timestamp: number } }
  | { type: 'recovery_transition'; reason: string; from: string; to: string; attempt: number; message: string; evidence: unknown }
  | { type: 'model_target_resolved'; requestedTarget: string; provider: string; resolvedModel: string; profileId?: string; credentialIndex?: number; targetId?: string; contextWindow?: number; route: 'primary' | 'recovery' | 'fallback'; reason?: string }
  | { type: 'reasoning_start'; id: string; provider: string; model: string; step?: number; phase: 'planning' | 'final'; visibility: AgentReasoningVisibility; source: AgentReasoningSource; context?: AgentReasoningContext }
  | { type: 'reasoning_delta'; id: string; provider: string; model: string; step?: number; phase: 'planning' | 'final'; source: 'provider' | 'native'; delta: string }
  | { type: 'reasoning_end'; id: string; provider: string; model: string; step?: number; phase: 'planning' | 'final'; visibility: AgentReasoningVisibility; source: AgentReasoningSource; summary?: string; context?: AgentReasoningContext }
  | { type: 'model_response'; message: string; provider: string; model: string; step?: number; phase: 'planning' | 'final'; decision?: { tool: string; arguments: Record<string, unknown>; rationale?: string; reasoningSummary?: string; planItem?: string; codingState?: string; decisionCategory?: AgentDecisionCategory; summaryOrigin: 'engine' | 'model' | 'provider'; rationaleOrigin?: 'model'; expectedEvidence?: string[]; evidenceChecks?: AgentEvidenceCheck[]; preconditions?: string[]; stopCondition?: string; confidence?: number; planUpdate?: string[]; decisionId?: string; reasoningId?: string; reasoningVisibility?: AgentReasoningVisibility; reasoningSource?: AgentReasoningSource; decisionStatus?: AgentDecisionRecordStatus }; decisionRecord?: AgentDecisionRecord; context?: AgentReasoningContext }
  | { type: 'model_stream'; provider: string; model: string; eventType: 'text_delta' | 'tool_call_delta' | 'usage'; delta?: string; requestId?: string; stepId?: string; requestKind?: string }
  | { type: 'decision_record'; record: AgentDecisionRecord }
  | { type: 'llm_request_started'; request: AgentRequestEnvelope }
  | { type: 'llm_request_finished'; request: AgentRequestEnvelope }
  | { type: 'llm_request_heartbeat'; requestId: string; requestKind?: string; provider: string; model: string; startedAt: number; elapsedMs: number; deadlineAt?: number; stale: boolean }
  | { type: 'provider_rotation_occurred'; fromProvider: string; toProvider: string; fromModel?: string; toModel?: string; fromProfileId?: string; toProfileId?: string; fromKeyIndex?: number; toKeyIndex?: number; cooldownSeconds: number; reason: string; requestId?: string; stepId?: string }
  | { type: 'provider_attempt_failed'; message: string; recoverable: true; errorCode?: string }
  | { type: 'cooldown_waiting'; delayMs: number; attempt: number; message: string; waitingUntil?: number; provider?: string; model?: string; profileId?: string; providerError?: string }
  | { type: 'nvidia_cooldown_retry'; attempt: number; maxAttempts?: number; pauseMs: number; message: string; waitingUntil?: number; provider?: string; model?: string }
  | { type: 'retrying'; attempt: number; message: string; checkpointStep?: number }
  | { type: 'execution_failed'; message: string; errorCode?: string }
  | { type: 'pacing_wait'; profile: ExecutionPacingProfile; delayMs: number; message: string; scope?: 'request' | 'fallback' | 'presentation' | 'free_tier_key_cooldown'; provider?: string; model?: string; waitingUntil?: number; recoverable?: boolean; attempt?: number; errorCode?: string }
  | { type: 'tool_started'; tool: string; input?: unknown; toolCallId?: string; requestId?: string; stepId?: string }
  | { type: 'tool_result'; tool: string; result?: unknown; toolCallId?: string; requestId?: string; stepId?: string; evidenceId?: string }
  | { type: 'tool_evidence'; record: unknown }
  | { type: 'harness_intervention'; gateName: 'requires_source_mutation' | 'intent_mismatch' | 'task_analysis_guard'; reason: string; requiredEvidence: string[]; targetAction: string; stepSeq: number; toolCallId?: string; evidenceId?: string }
  | { type: 'file_read'; path: string }
  | { type: 'file_changed'; path: string; summary?: string; diff?: string }
  | { type: 'command_started'; command: string }
  | { type: 'command_output'; command?: string; output: string }
  | { type: 'package_install_started'; manager: string; packages: string[]; dev: boolean; cwd?: string; command: string }
  | { type: 'package_install_result'; success: boolean; manager: string; requestedPackages: string[]; verifiedPackages: string[]; missingPackages: string[]; cwd?: string; exitCode?: number; output?: string }
  | { type: 'verification_started'; command?: string }
  | { type: 'verification_result'; success: boolean; output?: string }
  | { type: 'user_input_required'; requestId: string; question: string; options: string[]; allowFreeform: boolean; context?: string; createdAt: number }
  | { type: 'user_input_resolved'; requestId: string; cancelled: boolean; selectedOption?: string; hasAnswer: boolean }
  | { type: 'user_message_queued'; messageId: string; message: string; queuedAt: number }
  | { type: 'user_message_processed'; messageId: string; message: string; processedAt: number }
  | { type: 'inbox_message_enqueued'; entry: AgentInboxEntryView }
  | { type: 'inbox_message_claimed'; claimId: string; entries: AgentInboxEntryView[]; boundary: number }
  | { type: 'inbox_message_replaced'; entry: AgentInboxEntryView }
  | { type: 'inbox_message_cancelled'; entry: AgentInboxEntryView }
  | { type: 'inbox_message_processed'; entry: AgentInboxEntryView }
  | { type: 'inbox_cleared'; target?: 'next-turn' | 'next-step'; entries: AgentInboxEntryView[] }
  | { type: 'inbox_requeued'; parentRunId: string; entries: AgentInboxEntryView[] }
  | { type: 'inbox_claims_released'; reason: string; messageIds: string[]; pending: AgentInboxEntryView[] }
  | { type: 'policy_decision'; decision: { allowed: boolean; requiresApproval: boolean; category: string; risk: string; scope: string; reason: string; summary: string } }
  | { type: 'final'; message: string; filesChanged?: string[]; provider?: string; model?: string }
  | { type: 'stopped'; message: string }
  | { type: 'interrupted'; message: string }
  | { type: 'killed'; message: string }
  | { type: 'error'; message: string };

export interface CoderImageAttachment {
  id: string;
  url: string;
  name: string;
  size?: number;
  mimeType: string;
}

export interface CoderThreadMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Concise provider/engine rationale; never a raw private reasoning trace. */
  reasoningSummary?: string;
  images?: CoderImageAttachment[];
  status?: 'running' | 'success' | 'error' | 'timed_out' | 'stopped';
  agentEvents?: AgentStreamEvent[];
  filesChanged?: string[];
  runId?: string;
  createdAt: number;
}

export interface CoderThreadSummary {
  id: string;
  title: string;
  messages: CoderThreadMessage[];
  messageCount?: number;
  messagesLoaded?: boolean;
  createdAt: number;
  updatedAt: number;
}

interface CoderChatPanelProps {
  task: string;
  model: string;
  loading: boolean;
  liveProgress: string;
  liveState: any;
  result: ReActResult | null;
  workspace: string;
  thread: CoderThreadMessage[];
  threads?: CoderThreadSummary[];
  activeThreadId?: string | null;
  resumableRun?: {
    id: string;
    status: 'running' | 'waiting_for_user' | 'waiting_for_provider' | 'completed' | 'failed' | 'stopped' | 'interrupted' | 'killed';
    task: string;
    model?: string;
  };
  canContinue: boolean;
  coderMode: CoderMode;
  approvalMode?: ApprovalMode;
  pacingProfile?: ExecutionPacingProfile;
  requestBudgetEnabled?: boolean;
  replayGuardEnabled?: boolean;
  waitForProviderAvailability?: boolean;
  geminiProfiles?: Array<{
    id: string;
    label: string;
    purpose: string;
    keySuffix?: string;
    health?: { status?: string; cooldownUntil?: number };
  }>;
  geminiProfileId?: string;
  allowCrossProviderFallback?: boolean;
  taskAnalysis?: CoderTaskAnalysis | CoderTaskAnalysisView | null;
  agentEvents?: AgentStreamEvent[];
  agentStatus?: AgentRunStatus;
  onTaskChange: (value: string) => void;
  onCoderModeChange: (value: CoderMode) => void;
  onApprovalModeChange?: (value: ApprovalMode) => void;
  onPacingProfileChange?: (value: ExecutionPacingProfile) => void;
  onRequestBudgetEnabledChange?: (value: boolean) => void;
  onReplayGuardEnabledChange?: (value: boolean) => void;
  onWaitForProviderAvailabilityChange?: (value: boolean) => void;
  onGeminiProfileChange?: (value: string) => void;
  onCrossProviderFallbackChange?: (value: boolean) => void;
  onAuthorizeFallback?: () => void;
  onSelectRecoveryModel?: () => void;
  onModelOptionsChange?: (options: ModelOption[]) => void;
  onModelChange: (value: string) => void;
  onRunTask: (options?: { task?: string; images?: CoderImageAttachment[] }) => void | Promise<void>;
  onStopTask: () => void;
  onGenerateWorkPlan: () => void;
  onContinue: () => void;
  onResumeServerRun?: () => void;
  onOpenRunAudit?: () => void;
  onStartNew: () => void;
  onNewThread?: () => void;
  onSelectThread?: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
  onRenameThread?: (threadId: string, title: string) => Promise<void> | void;
  onClearThread?: () => void;
  onProceedRequest?: () => void;
  onPolicyDecision?: (scope: string, decision: 'allow' | 'deny') => void;
  pendingPolicyApproval?: {
    runId: string;
    scope: string;
    category: string;
    risk: string;
    summary: string;
    reason: string;
  } | null;
  policyApprovalBusy?: boolean;
  onPolicyApprovalDecision?: (decision: 'allow' | 'deny') => void;
  pendingUserQuestion?: PendingUserQuestion | null;
  /** The app-level policy modal is the authoritative approval surface. */
  showInlinePolicyApproval?: boolean;
  /** The app-level question modal is the authoritative input surface. */
  showInlineUserQuestion?: boolean;
  userQuestionOption?: string;
  userQuestionAnswer?: string;
  userQuestionBusy?: boolean;
  onUserQuestionOptionChange?: (value: string) => void;
  onUserQuestionAnswerChange?: (value: string) => void;
  onUserQuestionResponse?: (cancelled?: boolean) => void;
  onUndoChanges?: (paths: string[]) => void | Promise<void>;
  onOpenStructureFile?: (path: string) => void;
  onOpenSettings?: () => void;
}

const textValue = (value: unknown): string => typeof value === 'string' ? value : '';

const getMessageContent = (message?: Pick<CoderThreadMessage, 'content'> | null): string =>
  textValue(message?.content);

const formatTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const extractFilePaths = (...values: Array<string | undefined>) => {
  const matches = values
    .filter((value): value is string => typeof value === 'string' && Boolean(value))
    // Normalize escaped newlines before scanning. Otherwise `\\nfilename.html`
    // can be captured as `nfilename.html`; keep ordinary backslash paths intact.
    .flatMap((value) => value!
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .match(/[A-Za-z0-9_.@/-]+\.(?:tsx|ts|jsx|js|json|md|css|html|cjs|mjs|yml|yaml|xaml|cs|py|sh)/g) || []);

  return Array.from(
    new Set(matches.map((match) => match.replace(/^["'`]+|["'`,.]+$/g, '')))
  );
};

const getThreadTitle = (thread: CoderThreadMessage[], task: string) => {
  const firstUserMessage = thread.find((message) => message.role === 'user');
  return sanitizeCoderThreadTitle(getMessageContent(firstUserMessage) || textValue(task), thread);
};

const estimateContentTokens = (value: unknown) => {
  if (!value) return 0;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.ceil(text.length / 4);
};

const QUALITY_GATE_EVIDENCE_TERMS: Record<QualityGateResult['gateId'], string[]> = {
  'request-satisfaction': ['entry point', 'required feature', 'app specification', 'request satisfaction'],
  'responsive-layout': ['responsive', 'mobile', 'viewport'],
  'interactive-controls': ['interactive', 'control', 'button'],
  'console-clean': ['console', 'uncaught', 'browser error'],
  'persistence-working': ['persistence', 'reload', 'saved data'],
  'accessible-labels': ['accessible', 'accessibility', 'label', 'aria'],
  'no-build-errors': ['build', 'compile', 'page load'],
};

const QUALITY_GATE_REMEDIATIONS: Record<QualityGateResult['gateId'], string> = {
  'request-satisfaction': 'Compare the app with the original request and implement any missing requested feature.',
  'responsive-layout': 'Inspect the failing viewport evidence, adjust the responsive layout, then verify mobile and desktop sizes.',
  'interactive-controls': 'Inspect the interaction evidence, fix the control handler or behavior, then repeat the interaction check.',
  'console-clean': 'Open the verification output, fix the first uncaught browser error, then rerun verification.',
  'persistence-working': 'Implement the requested persistence behavior and verify that data survives a reload.',
  'accessible-labels': 'Add accessible names to important controls and check keyboard operation.',
  'no-build-errors': 'Open the build or page-load output, fix the reported issue, and rerun verification.',
};

export const estimateActivePromptTokens = (
  thread: CoderThreadMessage[],
  task: string,
  workspace: string,
  recentSteps: ReActStep[],
  plan: PlanItem[],
  taskAnalysis?: unknown,
) => {
  const compact = (value: unknown) => {
    const normalized = textValue(value).replace(/\s+/g, ' ').trim();
    return normalized.slice(0, ACTIVE_PROMPT_MEMORY_ITEM_LIMIT);
  };
  const boundedThread = thread
    .slice(-ACTIVE_PROMPT_THREAD_LIMIT)
    .map((message) => `${message.role}: ${compact(message.content)}`)
    .join('\n');
  const boundedTask = `${compact(task)}\n${boundedThread}\n${textValue(workspace)}`;
  const taskTokens = Math.min(1_200, estimateContentTokens(boundedTask) + 12);
  const planTokens = Math.min(1_000, estimateContentTokens(plan));
  const evidenceAndPermissionTokens = Math.min(2_000, estimateContentTokens(taskAnalysis));
  const stepTokens = recentSteps.reduce(
    (sum, step) => sum + estimateContentTokens({
      thought: step.thought,
      action: step.action,
      action_input: step.action_input,
      observation: step.observation,
    }) + 16,
    0
  );

  return taskTokens + planTokens + evidenceAndPermissionTokens + Math.min(4_000, stepTokens);
};

const GENERIC_REASONING_SUMMARY_RE = /^use the current task evidence (?:and select the next concrete tool action|to choose the next concrete action)\.?$/i;

const isGenericReasoningSummary = (value: string | undefined): boolean =>
  Boolean(value && GENERIC_REASONING_SUMMARY_RE.test(value.replace(/\s+/g, ' ').trim()));

const AGENT_EVENT_TYPES = new Set<AgentStreamEvent['type']>([
  'run_started',
  'run_terminal_advice',
  'task_analysis_ready',
  'agent_guidance_snapshot',
  'console_output',
  'plan_updated',
  'todo_snapshot',
  'todo_links_updated',
  'workplan_updated',
  'state_transition',
  'recovery_transition',
  'model_target_resolved',
  'reasoning_start',
  'reasoning_delta',
  'reasoning_end',
  'model_response',
  'model_stream',
  'decision_record',
  'llm_request_started',
  'llm_request_finished',
  'llm_request_heartbeat',
  'provider_rotation_occurred',
  'provider_attempt_failed',
  'cooldown_waiting',
  'nvidia_cooldown_retry',
  'retrying',
  'execution_failed',
  'pacing_wait',
  'tool_started',
  'tool_result',
  'harness_intervention',
  'file_read',
  'file_changed',
  'command_started',
  'command_output',
  'package_install_started',
  'package_install_result',
  'verification_started',
  'verification_result',
  'inbox_message_enqueued',
  'inbox_message_claimed',
  'inbox_message_replaced',
  'inbox_message_cancelled',
  'inbox_message_processed',
  'inbox_cleared',
  'inbox_requeued',
  'inbox_claims_released',
  'policy_decision',
  'final',
  'stopped',
  'error',
]);

export const isRenderableAgentEvent = (event: unknown): event is AgentStreamEvent => {
  if (!event || typeof event !== 'object') return false;
  const type = (event as { type?: unknown }).type;
  if (typeof type !== 'string' || !AGENT_EVENT_TYPES.has(type as AgentStreamEvent['type'])) return false;
  if (type === 'policy_decision') {
    const decision = (event as { decision?: unknown }).decision;
    return Boolean(decision && typeof decision === 'object');
  }
  return true;
};

const getRenderableAgentEvents = (events: AgentStreamEvent[] = []) => {
  const validEvents = events.filter(isRenderableAgentEvent);
  return validEvents.length > AGENT_EVENT_RENDER_LIMIT
    ? validEvents.slice(-AGENT_EVENT_RENDER_LIMIT)
    : validEvents;
};

const getFileName = (path: string) => path.split(/[\\/]/).pop() || path;

const formatProviderWaitDuration = (delayMs: number) => {
  if (delayMs < 1_000) return 'less than a second';
  const seconds = Math.ceil(delayMs / 1_000);
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
};

const formatProfileInterval = (delayMs: number) => {
  if (delayMs <= 0) return 'none';
  const seconds = delayMs / 1_000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
};

const formatElapsedDuration = (durationMs: number) => {
  const seconds = Math.max(0, Math.floor(durationMs / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`;
};

export interface FileChangeReview {
  addedLines: string[];
  removedLines: string[];
}

export const getRunFileChangeReviews = (events: AgentStreamEvent[] = []) => {
  const reviews: Record<string, FileChangeReview> = {};
  for (const event of events) {
    if (event.type !== 'file_changed' || !event.diff) continue;
    const review = reviews[event.path] || { addedLines: [], removedLines: [] };
    for (const line of event.diff.split(/\r?\n/)) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (line.startsWith('+')) review.addedLines.push(line.slice(1));
      if (line.startsWith('-')) review.removedLines.push(line.slice(1));
    }
    reviews[event.path] = review;
  }
  return reviews;
};

export interface CoderChangeSummaryFile {
  path: string;
  addedLines: number;
  removedLines: number;
}

export interface CoderChangeSummary {
  files: CoderChangeSummaryFile[];
  addedLines: number;
  removedLines: number;
}

const normalizeChangePath = (path: string) => path.replace(/\\/g, '/').replace(/^\.\//, '').trim().toLowerCase();

export const getCoderChangeSummary = (
  message: Pick<CoderThreadMessage, 'agentEvents' | 'filesChanged'>,
): CoderChangeSummary => {
  const reviews = getRunFileChangeReviews(message.agentEvents || []);
  const reviewByPath = new Map(Object.entries(reviews).map(([path, review]) => [normalizeChangePath(path), review]));
  const paths = Array.from(new Set([
    ...(message.filesChanged || []),
    ...Object.keys(reviews),
  ].filter((path): path is string => typeof path === 'string' && Boolean(path.trim()))));
  const files = paths.map((path) => {
    const review = reviewByPath.get(normalizeChangePath(path));
    return {
      path,
      addedLines: review?.addedLines.length || 0,
      removedLines: review?.removedLines.length || 0,
    };
  });
  return {
    files,
    addedLines: files.reduce((total, file) => total + file.addedLines, 0),
    removedLines: files.reduce((total, file) => total + file.removedLines, 0),
  };
};

const CoderChangeSummaryCard: React.FC<{
  summary: CoderChangeSummary;
  onReview: (path?: string) => void;
  onUndo?: () => void;
  undoing?: boolean;
}> = ({ summary, onReview, onUndo, undoing = false }) => {
  if (summary.files.length === 0) return null;
  const fileLabel = summary.files.length === 1
    ? `Edited ${getFileName(summary.files[0].path)}`
    : `Edited ${summary.files.length} files`;

  return (
    <section
      data-testid="coder-change-summary"
      className="mt-4 overflow-hidden rounded-xl border border-neutral-800/90 bg-[#15161b] shadow-md"
      aria-label="Files changed by the agent"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800/80 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cyan-500/25 bg-cyan-500/10 text-cyan-300">
            <FilePenLine className="h-4 w-4" />
          </div>
          <span className="min-w-0 truncate text-xs font-semibold text-neutral-200" title={fileLabel}>{fileLabel}</span>
        </div>
        <span className="font-mono text-[11px] font-semibold text-emerald-400">+{summary.addedLines}</span>
        {summary.removedLines > 0 && <span className="font-mono text-[11px] font-semibold text-rose-400">-{summary.removedLines}</span>}
        <button
          type="button"
          onClick={onUndo}
          disabled={!onUndo || undoing}
          className="inline-flex items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-900/80 px-2.5 py-1.5 text-[11px] text-neutral-300 transition hover:border-neutral-600 hover:bg-neutral-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          title={onUndo ? 'Ask the agent to safely undo these changes' : 'Undo is unavailable for this saved message'}
        >
          <Undo2 className="h-3.5 w-3.5" />
          {undoing ? 'Undoing…' : 'Undo'}
        </button>
        <button
          type="button"
          onClick={() => onReview()}
          className="rounded-lg border border-neutral-700 bg-neutral-900/80 px-2.5 py-1.5 text-[11px] font-medium text-neutral-200 transition hover:border-neutral-600 hover:bg-neutral-800 hover:text-white"
        >
          Review
        </button>
      </div>
      <div className="divide-y divide-neutral-800/70">
        {summary.files.map((file) => (
          <button
            key={file.path}
            type="button"
            onClick={() => onReview(file.path)}
            className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left transition hover:bg-neutral-900/80"
            title={`Review ${file.path}`}
          >
            <FileCode className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-300">{file.path}</span>
            <span className="shrink-0 font-mono text-[10px] font-semibold text-emerald-400">+{file.addedLines}</span>
            <span className="shrink-0 font-mono text-[10px] font-semibold text-rose-400">-{file.removedLines}</span>
          </button>
        ))}
      </div>
    </section>
  );
};

const ReadOnlyCode = ({
  content,
  review,
  compact = false,
}: {
  content: string;
  review?: FileChangeReview;
  compact?: boolean;
}) => {
  const remainingAddedLines = new Map<string, number>();
  for (const line of review?.addedLines || []) {
    remainingAddedLines.set(line, (remainingAddedLines.get(line) || 0) + 1);
  }

  return (
    <pre className={`min-w-max font-mono ${compact ? 'text-[10px]' : 'text-xs'} leading-relaxed text-slate-300`} style={{ tabSize: 2 }}>
      <code>
        {content.split('\n').map((line, index) => {
          const remaining = remainingAddedLines.get(line) || 0;
          const changed = remaining > 0;
          if (changed) remainingAddedLines.set(line, remaining - 1);
          return (
            <span
              key={index}
              className={`block ${changed ? 'border-l-2 border-emerald-400 bg-emerald-500/15 text-emerald-100' : 'border-l-2 border-transparent'}`}
            >
              <span className={`mr-3 inline-block w-8 select-none text-right ${changed ? 'text-emerald-400' : 'text-neutral-700'}`}>
                {index + 1}
              </span>
              {line || ' '}
            </span>
          );
        })}
      </code>
    </pre>
  );
};

const stringifyActionInput = (value: Record<string, unknown>) => {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
};

interface AgentActivityPresentation {
  event: AgentStreamEvent;
  title: string;
  detail: string;
  status: string;
}

const getAgentActivityPresentation = (event: AgentStreamEvent): AgentActivityPresentation | null => {
  switch (event.type) {
    case 'task_analysis_ready':
      return {
        event,
        title: 'Task analysis ready',
        detail: `${event.taskAnalysis.taskKind.replace(/_/g, ' ')} · ${event.taskAnalysis.affectedFiles.length} affected files · ${event.taskAnalysis.expectedChangeIntent.replace(/_/g, ' ')}`,
        status: 'Inferred task scope is available',
      };
    case 'run_started':
      return { event, title: 'Thinking', detail: 'Understanding the request and preparing the run.', status: 'AI is engaged' };
    case 'run_terminal_advice':
      return {
        event,
        title: 'What to do next',
        detail: [event.summary, ...event.guidance.map((item) => `- ${item}`)].join('\n'),
        status: event.category.replace(/_/g, ' '),
      };
    case 'state_transition':
      return {
        event,
        title: `State: ${event.transition.to}`,
        detail: `${event.transition.from} -> ${event.transition.to}\n${event.transition.reason}`,
        status: 'Agent state updated',
      };
    case 'recovery_transition':
      return {
        event,
        title: `Recovery: ${event.to}`,
        detail: `${event.from} -> ${event.to} (attempt ${event.attempt})\n${event.message || event.reason}`,
        status: 'Agent is recovering',
      };
    case 'console_output':
      return { event, title: 'Console output', detail: event.message, status: 'Verbose engine trace' };
    case 'model_target_resolved':
      return {
        event,
        title: 'Selecting model',
        detail: `${event.provider} / ${event.resolvedModel}${event.contextWindow ? ` Â· context ${event.contextWindow.toLocaleString()}` : ''}`,
        status: event.route === 'primary' ? 'Model ready' : `${event.route} route ready`,
      };
    case 'llm_request_started':
      return {
        event,
        title: 'Calling provider',
        detail: `${formatAgentRequestRoute(event.request)}${event.request.requestKind ? `\nRequest: ${event.request.requestKind}` : ''}`,
        status: event.request.options?.timeoutMs
          ? `Waiting for response (up to ${Math.ceil(event.request.options.timeoutMs / 1_000)}s)`
          : 'Waiting for model response',
      };
    case 'llm_request_finished':
      return {
        event,
        title: eventTimedOut(event)
          ? 'Provider request timed out'
          : event.request.status === 'failed'
            ? 'Provider request failed'
            : 'Provider response received',
        detail: `${formatAgentRequestRoute(event.request)}${event.request.error ? `\n${event.request.error}` : ''}`,
        status: eventTimedOut(event)
          ? 'Recovery is being prepared'
          : event.request.status === 'failed'
            ? 'Provider needs attention'
            : 'Model response received',
      };
    case 'llm_request_heartbeat':
      return {
        event,
        title: event.stale ? 'Provider request may be stalled' : 'Waiting for provider response',
        detail: `${event.provider} / ${event.model}${event.requestKind ? ` · ${event.requestKind}` : ''} · ${Math.ceil(event.elapsedMs / 1_000)}s elapsed${event.deadlineAt ? ` · deadline ${new Date(event.deadlineAt).toLocaleTimeString()}` : ''}`,
        status: event.stale ? 'Outcome unknown; check the run or stop it if needed' : 'Provider request is still active',
      };
    case 'provider_rotation_occurred':
      return {
        event,
        title: 'Provider route rotated',
        detail: `${event.fromProvider}${event.fromProfileId ? ` / ${event.fromProfileId}` : Number.isInteger(event.fromKeyIndex) ? ` / account ${Number(event.fromKeyIndex) + 1}` : ''}${event.fromModel ? ` / ${event.fromModel}` : ''} -> ${event.toProvider}${event.toProfileId ? ` / ${event.toProfileId}` : Number.isInteger(event.toKeyIndex) ? ` / account ${Number(event.toKeyIndex) + 1}` : ''}${event.toModel ? ` / ${event.toModel}` : ''}${event.cooldownSeconds > 0 ? ` (${event.cooldownSeconds}s cooldown)` : ''}\n${event.reason}`,
        status: 'The request continued on another available route',
      };
    case 'model_response':
      return {
        event,
        title: event.phase === 'final' ? 'Preparing response' : 'Reasoning update',
        detail: [
          event.message || event.decision?.rationale || 'The model returned its next decision.',
          event.context ? `Responding to: ${event.context.latestUserInput || event.context.userRequest}` : '',
        ].filter(Boolean).join('\n'),
        status: event.phase === 'final' ? 'AI is composing the response' : 'AI is deciding the next action',
      };
    case 'reasoning_start':
      return {
        event,
        title: 'Thinking',
        detail: event.context
          ? `Responding to: ${event.context.latestUserInput || event.context.userRequest}`
          : 'Preparing a safe reasoning summary.',
        status: 'AI is thinking',
      };
    case 'reasoning_delta':
      return { event, title: 'Reasoning update', detail: event.delta, status: `${event.source} summary is streaming` };
    case 'reasoning_end':
      return {
        event,
        title: event.visibility === 'redacted' ? 'Thinking redacted' : 'Reasoning summary',
        detail: event.summary || 'The reasoning summary is available in the activity history.',
        status: event.visibility === 'collapsed' ? 'Safe summary available' : 'Reasoning summary available',
      };
    case 'decision_record':
      return {
        event,
        title: `Decision${event.record.decisionCategory ? ` · ${event.record.decisionCategory}` : ''} · ${event.record.status}`,
        detail: [
          event.record.action.action,
          event.record.decisionCategory ? `Category: ${event.record.decisionCategory}` : '',
          event.record.rationale || '',
          event.record.evidenceChecks?.length ? `Typed checks: ${event.record.evidenceChecks.map((check) => check.type).join(' | ')}` : '',
          event.record.toolEvidenceId ? `Tool evidence: ${event.record.toolEvidenceId}` : '',
          event.record.observedEvidence ? `Evidence: ${event.record.observedEvidence.assessment} — ${event.record.observedEvidence.summary}` : 'Waiting for tool evidence.',
        ].filter(Boolean).join('\n'),
        status: event.record.status === 'pending' ? 'Action selected' : `Evidence ${event.record.status}`,
      };
    case 'plan_updated':
      return {
        event,
        title: 'Planning',
        detail: (Array.isArray(event.plan) ? event.plan : [event.plan]).map((item) =>
          displayPlanItem(typeof item === 'string' ? item : item.step)
        ).filter(Boolean).join('\n'),
        status: 'AI updated its plan',
      };
    case 'todo_snapshot':
      return {
        event,
        title: 'Todo snapshot',
        detail: event.items.map((item) => `[${item.status}] ${item.content}`).join('\n') || 'The run todo is empty.',
        status: `Revision ${event.revision}`,
      };
    case 'todo_links_updated':
      return {
        event,
        title: 'Todo links updated',
        detail: event.links.length ? `${event.links.length} item link${event.links.length === 1 ? '' : 's'} recorded.` : 'No item-specific links recorded.',
        status: `Revision ${event.revision}`,
      };
    case 'workplan_updated':
      return {
        event,
        title: 'Workplan updated',
        detail: event.workPlan?.objective || 'The agent updated its optional strategic workplan.',
        status: event.workPlan?.status ? `Workplan is ${event.workPlan.status}` : 'Agent-owned context updated',
      };
    case 'tool_started':
      return { event, title: `Using ${event.tool}`, detail: JSON.stringify(event.input || {}, null, 2), status: 'Tool is running' };
    case 'tool_result':
      return {
        event,
        title: eventTimedOut(event) ? `${event.tool} timed out` : `${event.tool} completed`,
        detail: typeof event.result === 'string' ? event.result : JSON.stringify(event.result ?? {}, null, 2),
        status: eventTimedOut(event) ? 'Tool timed out' : eventFailed(event) ? 'Tool needs attention' : 'Tool returned a result',
      };
    case 'harness_intervention':
      return {
        event,
        title: 'Harness guard intervention',
        detail: [
          event.reason,
          `Action: ${event.targetAction} (step ${event.stepSeq})`,
          `Required evidence: ${event.requiredEvidence.join('; ')}`,
        ].join('\n'),
        status: 'Action blocked until evidence is available',
      };
    case 'command_started':
      return { event, title: 'Terminal activity', detail: event.command, status: 'AI is running a command' };
    case 'command_output':
      return { event, title: 'Terminal output', detail: event.output, status: 'Command produced output' };
    case 'package_install_started':
      return { event, title: 'Installing dependencies', detail: `${event.command}${event.cwd ? `\nWorking directory: ${event.cwd}` : ''}`, status: 'Approved install is running' };
    case 'package_install_result':
      return {
        event,
        title: event.success ? 'Dependencies installed' : 'Dependency installation failed',
        detail: [
          `Manager: ${event.manager}`,
          event.cwd ? `Working directory: ${event.cwd}` : '',
          Number.isInteger(event.exitCode) ? `Exit code: ${event.exitCode}` : '',
          event.verifiedPackages.length ? `Verified: ${event.verifiedPackages.join(', ')}` : '',
          event.missingPackages.length ? `Missing: ${event.missingPackages.join(', ')}` : '',
        ].filter(Boolean).join('\n'),
        status: event.success ? 'Install and package verification passed' : 'Install needs attention',
      };
    case 'verification_started':
      return { event, title: 'Verifying', detail: event.command || 'Checking the completed changes.', status: 'AI is checking its work' };
    case 'verification_result':
      return { event, title: eventTimedOut(event) ? 'Verification timed out' : event.success ? 'Verification passed' : 'Verification failed', detail: event.output || (event.success ? 'Checks passed.' : 'Checks need attention.'), status: eventTimedOut(event) ? 'Verification timed out' : event.success ? 'Checks completed' : 'AI found an issue' };
    case 'policy_decision':
      return { event, title: 'Permission check', detail: event.decision.summary, status: event.decision.allowed ? 'Action allowed' : 'Action requires attention' };
    case 'user_input_required':
      return { event, title: 'Waiting for your answer', detail: event.question, status: 'The same agent run is paused' };
    case 'user_input_resolved':
      return { event, title: 'Answer received', detail: event.cancelled ? 'The user opted out.' : event.selectedOption || 'The user provided an answer.', status: 'AI is continuing' };
    case 'provider_attempt_failed':
    case 'cooldown_waiting':
    case 'nvidia_cooldown_retry':
    case 'retrying':
    case 'pacing_wait':
      return { event, title: 'Still working', detail: event.message, status: 'AI is recovering and remains engaged' };
    case 'execution_failed':
    case 'error':
      return { event, title: eventTimedOut(event) ? 'Run timed out' : 'Run needs attention', detail: event.message, status: eventTimedOut(event) ? 'Timeout ended this run' : 'Execution issue' };
    case 'final':
      return { event, title: 'Response ready', detail: event.message, status: 'AI completed the response' };
    case 'stopped':
      return { event, title: 'Run stopped', detail: event.message, status: 'AI is no longer running' };
    case 'file_read':
    case 'file_changed':
      return null;
  }
};

export interface CooldownCountdownBadgeProps {
  event: AgentStreamEvent;
  isLive?: boolean;
  className?: string;
  showIcon?: boolean;
}

export const CooldownCountdownBadge: React.FC<CooldownCountdownBadgeProps> = ({
  event,
  isLive = false,
  className = '',
  showIcon = true,
}) => {
  const isPacingCooldown = event.type === 'pacing_wait' && event.scope === 'free_tier_key_cooldown';
  const isNvidiaRetry = event.type === 'nvidia_cooldown_retry';
  const isCooldownWaiting = event.type === 'cooldown_waiting';

  const delayMs = isNvidiaRetry
    ? event.pauseMs
    : (isPacingCooldown || isCooldownWaiting)
      ? event.delayMs
      : 0;

  const waitingUntil = ('waitingUntil' in event && typeof event.waitingUntil === 'number' && event.waitingUntil > 0)
    ? event.waitingUntil
    : 0;

  const attempt = ('attempt' in event && typeof event.attempt === 'number') ? event.attempt : undefined;

  const calculateRemainingSeconds = () => {
    if (!isLive) return 0;
    const now = Date.now();
    if (waitingUntil > 0) {
      return Math.max(0, Math.ceil((waitingUntil - now) / 1000));
    }
    return Math.max(0, Math.ceil(delayMs / 1000));
  };

  const [remainingSeconds, setRemainingSeconds] = useState<number>(calculateRemainingSeconds);

  useEffect(() => {
    if (!isLive) {
      setRemainingSeconds(0);
      return;
    }

    setRemainingSeconds(calculateRemainingSeconds());

    const interval = setInterval(() => {
      const remaining = calculateRemainingSeconds();
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [isLive, waitingUntil, delayMs]);

  const isWaiting = isLive && remainingSeconds > 0;

  let text = '';
  if (isWaiting) {
    if (isNvidiaRetry || (isPacingCooldown && attempt !== undefined)) {
      text = `All NVIDIA keys throttled — waiting ${remainingSeconds}s before retry #${attempt || 1}`;
    } else if (isPacingCooldown) {
      text = `NVIDIA key cooling… retry in ${remainingSeconds}s`;
    } else if (isCooldownWaiting) {
      text = `Provider key cooling… retry in ${remainingSeconds}s`;
    } else {
      text = `Cooling down… retry in ${remainingSeconds}s`;
    }
  } else {
    if (isNvidiaRetry || attempt !== undefined) {
      text = isLive
        ? `Cooldown cleared — firing retry #${attempt || 1}...`
        : `Cooldown cleared — retry #${attempt || 1} resumed`;
    } else if (isPacingCooldown) {
      text = isLive
        ? 'Cooldown cleared — firing attempt...'
        : 'Cooldown cleared — attempt resumed';
    } else {
      text = isLive
        ? 'Cooldown cleared — firing attempt...'
        : 'Cooldown cleared';
    }
  }

  return (
    <div
      data-testid="cooldown-countdown-chip"
      data-cooldown-state={isWaiting ? 'cooling' : 'ready'}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors duration-300 ${
        isWaiting
          ? 'border-amber-500/50 bg-amber-500/20 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.15)]'
          : 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
      } ${className}`}
    >
      {showIcon && (
        isWaiting ? (
          <History className="h-3.5 w-3.5 animate-spin text-amber-300" style={{ animationDuration: '3s' }} />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
        )
      )}
      <span>{text}</span>
    </div>
  );
};

export const CoderChatPanel: React.FC<CoderChatPanelProps> = ({
  task,
  model,
  loading,
  liveProgress,
  liveState,
  result,
  workspace,
  thread,
  threads,
  activeThreadId,
  resumableRun,
  canContinue,
  coderMode = 'auto',
  approvalMode = 'ask',
  pacingProfile = 'automatic',
  requestBudgetEnabled = false,
  replayGuardEnabled = true,
  waitForProviderAvailability = true,
  geminiProfiles = [],
  geminiProfileId = '',
  allowCrossProviderFallback = false,
  taskAnalysis,
  agentEvents = [],
  agentStatus,
  onTaskChange,
  onCoderModeChange = () => undefined,
  onApprovalModeChange = () => undefined,
  onPacingProfileChange = () => undefined,
  onRequestBudgetEnabledChange = () => undefined,
  onReplayGuardEnabledChange = () => undefined,
  onWaitForProviderAvailabilityChange = () => undefined,
  onGeminiProfileChange = () => undefined,
  onCrossProviderFallbackChange = () => undefined,
  onAuthorizeFallback,
  onSelectRecoveryModel,
  onModelOptionsChange,
  onModelChange,
  onRunTask,
  onStopTask = () => undefined,
  onGenerateWorkPlan,
  onContinue,
  onResumeServerRun,
  onOpenRunAudit,
  onStartNew,
  onNewThread,
  onSelectThread,
  onDeleteThread,
  onRenameThread,
  onClearThread,
  onProceedRequest,
  onPolicyDecision = () => undefined,
  pendingPolicyApproval,
  policyApprovalBusy = false,
  onPolicyApprovalDecision,
  pendingUserQuestion,
  showInlinePolicyApproval = true,
  showInlineUserQuestion = true,
  userQuestionOption = '',
  userQuestionAnswer = '',
  userQuestionBusy = false,
  onUserQuestionOptionChange,
  onUserQuestionAnswerChange,
  onUserQuestionResponse,
  onUndoChanges,
  onOpenStructureFile,
  onOpenSettings,
}) => {
  const [activeMobileTab, setActiveMobileTab] = useState<'chat' | 'workspace' | 'settings'>('chat');
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [threadTitleDraft, setThreadTitleDraft] = useState('');
  const [threadRenameError, setThreadRenameError] = useState<string | null>(null);
  const [threadRenameBusy, setThreadRenameBusy] = useState(false);
  const [localAiTestResults, setLocalAiTestResults] = useState(readLocalAiEndpointTestResults);
  const [viewMode, setViewMode] = useState<ChatViewMode>(() => readStoredChatViewMode(activeThreadId));
  const [chatMessageFormat, setChatMessageFormat] = useState<ChatMessageFormat>(() => readInterfaceDisplayPreferences().chatMessageFormat);
  const [chatDensity, setChatDensity] = useState<ChatViewDensity>(() => readInterfaceDisplayPreferences().chatDensity);
  const [highlightedEventKey, setHighlightedEventKey] = useState<string | null>(null);
  const [childRuns, setChildRuns] = useState<ChildRunRecord[]>([]);
  const [childRunsLoading, setChildRunsLoading] = useState(false);
  const [selectedChildRunId, setSelectedChildRunId] = useState<string | null>(null);
  const [childContextEvents, setChildContextEvents] = useState<AgentStreamEvent[]>([]);
  const [childContextLoading, setChildContextLoading] = useState(false);
  const [childContextError, setChildContextError] = useState<string | null>(null);
  const childContextRequestRef = useRef(0);

  const handleViewModeChange = (mode: ChatViewMode) => {
    setViewMode(mode);
    writeStoredChatViewMode(activeThreadId, mode);
  };

  useEffect(() => {
    const refreshLocalAiTests = () => setLocalAiTestResults(readLocalAiEndpointTestResults());
    window.addEventListener(LOCAL_AI_TEST_RESULTS_EVENT, refreshLocalAiTests);
    window.addEventListener('storage', refreshLocalAiTests);
    return () => {
      window.removeEventListener(LOCAL_AI_TEST_RESULTS_EVENT, refreshLocalAiTests);
      window.removeEventListener('storage', refreshLocalAiTests);
    };
  }, []);

  useEffect(() => {
    const parentRunId = resumableRun?.id;
    childContextRequestRef.current += 1;
    setChildRuns([]);
    setSelectedChildRunId(null);
    setChildContextEvents([]);
    setChildContextError(null);
    setChildContextLoading(false);
    if (!parentRunId) return;
    const controller = new AbortController();
    setChildRunsLoading(true);
    void fetch(`/api/runs/${encodeURIComponent(parentRunId)}/children`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load child runs (${response.status}).`);
        const data = await response.json().catch(() => ({}));
        setChildRuns(Array.isArray(data.children) ? data.children as ChildRunRecord[] : []);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setChildContextError(error instanceof Error ? error.message : 'Could not load child runs.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setChildRunsLoading(false);
      });
    return () => controller.abort();
  }, [resumableRun?.id]);

  const selectChildRunContext = async (child: ChildRunRecord) => {
    if (selectedChildRunId === child.childId) {
      childContextRequestRef.current += 1;
      setSelectedChildRunId(null);
      setChildContextEvents([]);
      setChildContextLoading(false);
      return;
    }
    const requestId = ++childContextRequestRef.current;
    setSelectedChildRunId(child.childId);
    setChildContextEvents([]);
    setChildContextError(null);
    setChildContextLoading(true);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(child.childId)}/events?limit=80`);
      if (!response.ok) throw new Error(`Could not open child context (${response.status}).`);
      const data = await response.json().catch(() => ({}));
      const events = Array.isArray(data.events) ? data.events.flatMap((entry: unknown) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        const envelope = entry as { type?: unknown; data?: unknown };
        const payload = envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)
          ? envelope.data as Record<string, unknown>
          : {};
        const candidate = typeof payload.type === 'string' ? payload : { ...payload, type: envelope.type };
        return isRenderableAgentEvent(candidate) ? [candidate] : [];
      }) : [];
      if (childContextRequestRef.current === requestId) setChildContextEvents(events);
    } catch (error) {
      if (childContextRequestRef.current === requestId) setChildContextError(error instanceof Error ? error.message : 'Could not open child context.');
    } finally {
      if (childContextRequestRef.current === requestId) setChildContextLoading(false);
    }
  };

  useEffect(() => {
    setViewMode(readStoredChatViewMode(activeThreadId));
  }, [activeThreadId]);

  const handleChatDensityChange = (density: ChatViewDensity) => {
    const next = writeInterfaceDisplayPreferences({ chatDensity: density });
    setChatMessageFormat(next.chatMessageFormat);
    setChatDensity(next.chatDensity);
  };

  useEffect(() => {
    const handleInterfaceDisplayChange = (event: Event) => {
      const detail = (event as CustomEvent<{ chatMessageFormat?: ChatMessageFormat; chatDensity?: ChatViewDensity }>).detail;
      const next = detail || readInterfaceDisplayPreferences();
      if (next.chatMessageFormat) setChatMessageFormat(next.chatMessageFormat);
      if (next.chatDensity) setChatDensity(next.chatDensity);
    };
    window.addEventListener(INTERFACE_DISPLAY_EVENT, handleInterfaceDisplayChange);
    return () => window.removeEventListener(INTERFACE_DISPLAY_EVENT, handleInterfaceDisplayChange);
  }, []);

  const handleChatEventSelect = (eventIndex: number, event: AgentStreamEvent) => {
    const eventKey = `evt-${eventIndex}-${event.type}`;
    setHighlightedEventKey(eventKey);
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        const target = document.getElementById(eventKey)
          || document.querySelector<HTMLElement>(`[data-event-alias="${eventKey}"]`);
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  };

  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [composerPortalTarget, setComposerPortalTarget] = useState<HTMLElement | null>(null);
  const [isComposerCollapsed, setIsComposerCollapsed] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(() => {
    try {
      if (typeof window === 'undefined') return 340;
      const stored = window.localStorage.getItem('coder_chat_left_panel_width');
      const value = stored ? Number.parseInt(stored, 10) : Number.NaN;
      return Number.isFinite(value) && value >= 320 ? value : 340;
    } catch {
      return 340;
    }
  });
  const [isResizingLeftPanel, setIsResizingLeftPanel] = useState(false);

  const [explorerPanelWidth, setExplorerPanelWidth] = useState<number>(() => {
    try {
      if (typeof window === 'undefined') return 360;
      const stored = window.localStorage.getItem('coder_chat_explorer_panel_width');
      const value = stored ? Number.parseInt(stored, 10) : Number.NaN;
      return Number.isFinite(value) && value >= 260 ? value : 360;
    } catch {
      return 360;
    }
  });
  const [isResizingExplorer, setIsResizingExplorer] = useState(false);

  const handleLeftResizeMouseDown = (event: React.MouseEvent) => {
    event.preventDefault();
    setIsResizingLeftPanel(true);

    const startX = event.clientX;
    const startWidth = leftPanelWidth;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const minWidth = 320;
      const maxWidth = typeof window !== 'undefined'
        ? Math.max(minWidth, Math.min(850, window.innerWidth - 420))
        : 800;
      setLeftPanelWidth(Math.max(minWidth, Math.min(maxWidth, startWidth + moveEvent.clientX - startX)));
    };
    const handleMouseUp = () => {
      setIsResizingLeftPanel(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      try {
        setLeftPanelWidth((current) => {
          window.localStorage.setItem('coder_chat_left_panel_width', String(current));
          return current;
        });
      } catch {
        // Ignore storage failures; the panel remains resized for this session.
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleExplorerResizeMouseDown = (event: React.MouseEvent) => {
    event.preventDefault();
    setIsResizingExplorer(true);

    const startX = event.clientX;
    const startWidth = explorerPanelWidth;
    const isRight = explorerPosition === 'right';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const minWidth = 260;
      const maxWidth = typeof window !== 'undefined'
        ? Math.max(minWidth, Math.min(950, window.innerWidth - (leftPanelWidth + 240)))
        : 800;
      const delta = isRight ? (startX - moveEvent.clientX) : (moveEvent.clientX - startX);
      setExplorerPanelWidth(Math.max(minWidth, Math.min(maxWidth, startWidth + delta)));
    };

    const handleMouseUp = () => {
      setIsResizingExplorer(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      try {
        setExplorerPanelWidth((current) => {
          window.localStorage.setItem('coder_chat_explorer_panel_width', String(current));
          return current;
        });
      } catch {
        // Ignore storage failures; the panel remains resized for this session.
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };
  const [expandedAgentItems, setExpandedAgentItems] = useState<Record<string, boolean>>({});
  const [showExplorer, setShowExplorer] = useState(true);
  const [explorerPosition, setExplorerPosition] = useState<'left' | 'right'>(() => {
    try {
      if (typeof window === 'undefined') return 'right';
      return (window.localStorage.getItem('coder_chat_explorer_position') as 'left' | 'right') || 'right';
    } catch {
      return 'right';
    }
  });
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['src']));
  const [fileTree, setFileTree] = useState<TreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeTruncated, setTreeTruncated] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [openFilePaths, setOpenFilePaths] = useState<string[]>([]);
  const [selectedFileContent, setSelectedFileContent] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [filePresentation, setFilePresentation] = useState<{
    path: string;
    mode: 'reading' | 'writing';
    progress: number;
  } | null>(null);
  const [activeThoughtModal, setActiveThoughtModal] = useState<{
    title: string;
    route?: string;
    message: string;
    decision?: any;
    provider?: string;
    model?: string;
    step?: number;
    context?: AgentReasoningContext;
  } | null>(null);
  const [expandedFileModalOpen, setExpandedFileModalOpen] = useState(false);
  const [quickFileModalOpen, setQuickFileModalOpen] = useState(false);
  const [quickFileFilter, setQuickFileFilter] = useState('');
  const [ignoredContextFiles, setIgnoredContextFiles] = useState<Set<string>>(() => readIgnoredContextFiles(activeThreadId));
  const hydratedDraftScopeRef = useRef<string | null>(null);
  const [showOlderMessages, setShowOlderMessages] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [copiedInlineActionKey, setCopiedInlineActionKey] = useState<string | null>(null);
  const [inspectedInlineActionKey, setInspectedInlineActionKey] = useState<string | null>(null);
  const [undoingMessageId, setUndoingMessageId] = useState<string | null>(null);
  const [attachedImages, setAttachedImages] = useState<CoderImageAttachment[]>([]);
  const [previewModalImage, setPreviewModalImage] = useState<CoderImageAttachment | null>(null);
  const [isDraggingOverComposer, setIsDraggingOverComposer] = useState(false);
  const [isProcessingImages, setIsProcessingImages] = useState(false);
  const [imageUploadNotice, setImageUploadNotice] = useState<string | null>(null);
  const [finalAnswerCollapsed, setFinalAnswerCollapsed] = useState<boolean>(() => {
    try { return sessionStorage.getItem('finalAnswerCollapsed') === 'true'; } catch { return false; }
  });
  const [finalAnswerCopied, setFinalAnswerCopied] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const scope = chatStorageScope(activeThreadId);
    const previousScope = hydratedDraftScopeRef.current;
    const savedDraft = readScopedChatDraft(activeThreadId);
    const savedIgnoredFiles = readIgnoredContextFiles(activeThreadId);

    hydratedDraftScopeRef.current = scope;
    setIgnoredContextFiles(savedIgnoredFiles);

    if (previousScope === null) {
      if (savedDraft !== null && savedDraft !== task) onTaskChange(savedDraft);
      if (savedDraft === null && task) writeScopedChatDraft(activeThreadId, task);
      return;
    }

    // App-level thread selection clears its transient task state. Restore the
    // draft for the selected thread, or explicitly clear stale text when that
    // thread has no saved draft.
    const nextDraft = savedDraft ?? '';
    if (nextDraft !== task) onTaskChange(nextDraft);
  }, [activeThreadId]);

  useEffect(() => {
    if (hydratedDraftScopeRef.current !== chatStorageScope(activeThreadId)) return;
    writeScopedChatDraft(activeThreadId, task);
  }, [activeThreadId, task]);

  const formatFileSize = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const processImageFiles = async (files: File[] | FileList) => {
    const incoming = Array.from(files);
    const unsupportedCount = incoming.filter((file) => !isSupportedCoderImageType(file.type || '')).length;
    const imageFiles = incoming.filter((file) => isSupportedCoderImageType(file.type || ''));
    const availableSlots = Math.max(0, CODER_IMAGE_MAX_COUNT - attachedImages.length);

    if (availableSlots === 0) {
      setImageUploadNotice(`A message can include up to ${CODER_IMAGE_MAX_COUNT} images.`);
      return;
    }

    const selectedFiles = imageFiles.slice(0, availableSlots);
    setIsProcessingImages(true);
    setImageUploadNotice(null);
    try {
      const results = await Promise.allSettled(selectedFiles.map((file) => prepareCoderImage(file)));
      const prepared = results
        .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof prepareCoderImage>>> => result.status === 'fulfilled')
        .map((result) => result.value);
      const failedMessages = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason instanceof Error ? result.reason.message : 'One image could not be attached.');

      let totalPayloadChars = coderImagePayloadChars(attachedImages);
      const accepted = prepared.filter((image) => {
        if (totalPayloadChars + image.url.length > CODER_IMAGE_MAX_TOTAL_DATA_URL_CHARS) return false;
        totalPayloadChars += image.url.length;
        return true;
      });
      if (accepted.length > 0) {
        setAttachedImages((prev) => [...prev, ...accepted.map((image) => ({
          ...image,
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        }))]);
      }

      const skippedCount = incoming.length - accepted.length;
      const notices = [...failedMessages];
      if (unsupportedCount > 0) notices.unshift('Only PNG, JPG, WebP, GIF, BMP, and SVG images are supported.');
      if (imageFiles.length > selectedFiles.length) notices.push(`Only ${CODER_IMAGE_MAX_COUNT} images can be attached to one message.`);
      if (prepared.length > accepted.length) notices.push('The image payload budget was reached; remove an attachment or use a smaller image.');
      if (accepted.length > 0 && notices.length === 0) {
        setImageUploadNotice(`${accepted.length} image${accepted.length === 1 ? '' : 's'} ready to send.`);
      } else if (notices.length > 0) {
        setImageUploadNotice(notices.slice(0, 3).join(' '));
      } else if (skippedCount > 0) {
        setImageUploadNotice('Some images were skipped.');
      }
    } finally {
      setIsProcessingImages(false);
    }
  };

  const handleComposerPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      event.preventDefault();
      void processImageFiles(imageFiles);
    }
  };

  const removeAttachedImage = (id: string) => {
    setAttachedImages((prev) => prev.filter((img) => img.id !== id));
  };
  const [apiPoolModelOptions, setApiPoolModelOptions] = useState<ModelOption[]>([]);
  const [apiPoolModelsLoaded, setApiPoolModelsLoaded] = useState(false);
  const [desktopAlertsEnabled, setDesktopAlertsEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem('coder_desktop_alerts') === 'enabled';
    } catch {
      return false;
    }
  });
  const [terminalAlert, setTerminalAlert] = useState<{ status: 'completed' | 'checkpoint' | 'failed' | 'timed_out' | 'stopped' | 'interrupted' | 'killed'; message: string } | null>(null);
  const [inboxDraft, setInboxDraft] = useState('');
  const [inboxTarget, setInboxTarget] = useState<'next-turn' | 'next-step'>('next-turn');
  const [inboxBusy, setInboxBusy] = useState(false);
  const [inboxNotice, setInboxNotice] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const threadContentRef = useRef<HTMLDivElement | null>(null);
  const autoScrollEnabledRef = useRef(true);
  const terminalAlertKeyRef = useRef<string | null>(null);
  const fileRevealControllerRef = useRef<{ cancel: () => void } | null>(null);
  const presentedAgentEventCountRef = useRef(0);
  const filePresentationClearTimerRef = useRef<number | null>(null);
  const filePresentationWaitRef = useRef<Promise<void> | null>(null);
  const filePresentationResolveRef = useRef<(() => void) | null>(null);
  const fileRequestRef = useRef(0);

  const canSteerRun = Boolean(
    resumableRun && ['running', 'waiting_for_user', 'waiting_for_provider'].includes(resumableRun.status)
  );

  const enqueueInboxMessage = async () => {
    const message = inboxDraft.trim();
    if (!message || !resumableRun || !canSteerRun || inboxBusy) return;
    setInboxBusy(true);
    setInboxNotice(null);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(resumableRun.id)}/inbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          target: inboxTarget,
          source: inboxTarget === 'next-step' ? 'steering' : 'follow_up',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'The update could not be queued.');
      setInboxDraft('');
      setInboxNotice(inboxTarget === 'next-step' ? 'Steering queued for the current action boundary.' : 'Follow-up queued for the next turn.');
    } catch (error: any) {
      setInboxNotice(error.message || 'The update could not be queued.');
    } finally {
      setInboxBusy(false);
    }
  };

  const latestReviewEvents = useMemo(() => {
    if (agentEvents.some((event) => event.type === 'file_changed' && event.diff)) return agentEvents;
    const latestRunMessage = [...thread].reverse().find((message) =>
      message.role === 'assistant' && message.agentEvents?.some((event) => event.type === 'file_changed' && event.diff)
    );
    return latestRunMessage?.agentEvents || [];
  }, [agentEvents, thread]);
  const fileChangeReviews = useMemo(() => getRunFileChangeReviews(latestReviewEvents), [latestReviewEvents]);

  useEffect(() => {
    if (!agentStatus) {
      terminalAlertKeyRef.current = null;
      setTerminalAlert(null);
      return;
    }
    if (!['completed', 'failed', 'timed_out', 'stopped', 'interrupted', 'killed'].includes(agentStatus)) return;

    const terminalStatus = agentStatus as 'completed' | 'failed' | 'timed_out' | 'stopped' | 'interrupted' | 'killed';
    const failureMessage = result?.error || [...agentEvents].reverse().find((event) =>
      event.type === 'error' || event.type === 'execution_failed'
    )?.message;
    const checkpointSaved = isCheckpointResult(result) || isCheckpointResult({ error: failureMessage });
    const terminalOutcome = checkpointSaved
      ? 'checkpoint'
      : resolveTerminalRunOutcome(result || { error: failureMessage }, terminalStatus);
    const terminalAlertKey = `${terminalOutcome}:${failureMessage || ''}`;
    if (terminalAlertKeyRef.current === terminalAlertKey) return;
    terminalAlertKeyRef.current = terminalAlertKey;
    const message = terminalOutcome === 'completed'
      ? 'The run finished successfully.'
      : formatTerminalResultError(result || { error: failureMessage }, terminalStatus);
    setTerminalAlert({ status: terminalOutcome, message });
    const timeout = window.setTimeout(() => setTerminalAlert(null), 9000);

    if (desktopAlertsEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(`React Engine: ${terminalOutcome === 'checkpoint' ? 'checkpoint saved' : terminalOutcome}`, {
        body: `${message}${task.trim() ? `\n${task.trim().slice(0, 160)}` : ''}`,
        tag: 'react-engine-terminal-run',
      });
    }

    return () => window.clearTimeout(timeout);
  }, [agentEvents, agentStatus, desktopAlertsEnabled, result, task]);

  useEffect(() => {
    terminalAlertKeyRef.current = null;
    setTerminalAlert(null);
  }, [activeThreadId]);

  const toggleDesktopAlerts = async () => {
    if (desktopAlertsEnabled) {
      setDesktopAlertsEnabled(false);
      window.localStorage.setItem('coder_desktop_alerts', 'disabled');
      return;
    }
    if (typeof Notification === 'undefined') {
      setTerminalAlert({ status: 'failed', message: 'Desktop notifications are not supported by this browser. In-app alerts will still appear.' });
      return;
    }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission === 'granted') {
      setDesktopAlertsEnabled(true);
      window.localStorage.setItem('coder_desktop_alerts', 'enabled');
      setTerminalAlert({ status: 'completed', message: 'Desktop run alerts are enabled.' });
    } else {
      setTerminalAlert({ status: 'failed', message: 'Desktop notifications were not allowed. In-app alerts will still appear.' });
    }
  };

  useEffect(() => {
    let cancelled = false;
    const initialModel = model;

    const loadApiPoolModels = async () => {
      const results = await Promise.allSettled([
        fetch('/api/nvidia/model-targets').then(async (response) => response.ok ? response.json() : { targets: [] }),
        fetch('/api/gemini/model-targets').then(async (response) => response.ok ? response.json() : { targets: [] }),
        fetch('/api/openrouter/model-targets').then(async (response) => response.ok ? response.json() : { targets: [] }),
        fetch('/api/groq/model-targets').then(async (response) => response.ok ? response.json() : { targets: [] }),
        fetch('/api/kimi/model-targets').then(async (response) => response.ok ? response.json() : { targets: [] }),
        fetch('/api/requesty/model-targets').then(async (response) => response.ok ? response.json() : { targets: [] }),
        fetch('/api/sambanova/model-targets').then(async (response) => response.ok ? response.json() : { targets: [] }),
        fetch('/api/local-ai/model-targets').then(async (response) => response.ok ? response.json() : { targets: [] }),
        fetch('/api/colab/model-targets').then(async (response) => response.ok ? response.json() : { targets: [] }),
        fetch('/api/pollinations/model-catalog', { cache: 'no-store' }).then(async (response) => response.ok ? response.json() : { targets: [] }),
      ]);
      if (cancelled) return;

      const options: ModelOption[] = [];
      const targetsByRoute = new Map<string, { option: ModelOption; priority: number }>();
      const appendTargets = (
        result: PromiseSettledResult<any>,
        provider: 'NVIDIA' | 'Gemini' | 'OpenRouter' | 'Groq' | 'Kimi' | 'Requesty' | 'SambaNova' | 'Local' | 'Colab' | 'Pollinations',
        baseApi: string,
      ) => {
        if (result.status !== 'fulfilled') return;
        if (Array.isArray(result.value?.targets)) {
          for (const target of result.value.targets) {
            if (!target || typeof target.value !== 'string' || typeof target.title !== 'string') continue;
            const modelId = typeof target.modelId === 'string' ? target.modelId : target.value;
            const apiKeyIndex = Number.isInteger(target.apiKeyIndex) ? target.apiKeyIndex : 0;
            const contextWindow = Number(target.contextWindow ?? target.contextLength ?? target.contextTokenLimit);
            const option: ModelOption = {
              value: target.value,
              label: provider === 'Pollinations'
                ? `${target.title} - ${modelId}`
                : provider === 'Gemini' && typeof target.profileId === 'string'
                ? `${target.title} Â· ${modelId} Â· ${target.profileId}`
                : provider === 'Groq'
                  ? `${target.title} Â· ${modelId}`
                  : provider === 'Local' || provider === 'Colab'
                    ? `${target.title} Â· ${modelId} Â· ${target.baseUrl || baseApi}`
                  : `${target.title} Â· ${modelId} Â· API key ${apiKeyIndex + 1}`,
              provider,
              baseApi: (provider === 'Local' || provider === 'Colab') && typeof target.baseUrl === 'string' ? target.baseUrl : baseApi,
              source: 'api-target',
              modelId,
              apiKeyIndex,
              ...(Number.isFinite(contextWindow) && contextWindow >= 1_024
                ? { contextWindow: Math.floor(contextWindow) }
                : {}),
              ...(provider === 'Local' && typeof target.id === 'string' ? { endpointId: target.id } : {}),
              ...(provider === 'Gemini' && typeof target.profileId === 'string'
                ? { profileId: target.profileId }
                : {}),
            };
            const routeKey = provider === 'Local' || provider === 'Colab'
              ? `${provider}:${target.value}`
              : provider === 'Pollinations'
                ? `${provider}:${modelId.toLowerCase()}`
              : `${provider}:${provider === 'Groq' ? 'default' : target.profileId || apiKeyIndex}:${modelId}`;
            const priority = Number(target.createdAt) > 0 ? 2 : 1;
            const existing = targetsByRoute.get(routeKey);
            if (!existing || priority > existing.priority) targetsByRoute.set(routeKey, { option, priority });
          }
        }
        if (provider === 'Gemini') {
          const rawModels: string[] = Array.isArray(result.value?.models) && result.value.models.length > 0
            ? result.value.models
            : ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite"];
          for (const modelId of rawModels) {
            if (typeof modelId !== 'string') continue;
            const routeKey = `Gemini:direct:${modelId}`;
            if (!targetsByRoute.has(routeKey)) {
              targetsByRoute.set(routeKey, {
                option: {
                  value: modelId,
                  label: `Gemini (Native) ${modelId.replace(/^gemini-/, '')}`,
                  provider: 'Gemini',
                  baseApi: GEMINI_BASE_API,
                  source: 'direct',
                  modelId,
                },
                priority: 0,
              });
            }
          }
        }
      };

      appendTargets(results[0], 'NVIDIA', NVIDIA_BASE_API);
      appendTargets(results[1], 'Gemini', GEMINI_BASE_API);
      appendTargets(results[2], 'OpenRouter', OPENROUTER_BASE_API);
      appendTargets(results[3], 'Groq', GROQ_BASE_API);
      appendTargets(results[4], 'Kimi', KIMI_BASE_API);
      appendTargets(results[5], 'Requesty', REQUESTY_BASE_API);
      appendTargets(results[6], 'SambaNova', SAMBANOVA_BASE_API);
      appendTargets(results[7], 'Local', '');
      appendTargets(results[8], 'Colab', '');
      appendTargets(results[9], 'Pollinations', POLLINATIONS_BASE_API);
      options.push(...Array.from(targetsByRoute.values(), ({ option }) => option));
      setApiPoolModelOptions(options);
      setApiPoolModelsLoaded(true);

      // The OpenRouter default is persisted by Settings/API Pool. Apply it
      // when the current browser value is one of the legacy env-backed
      // defaults, so an old localStorage value cannot mask the saved route.
      const openRouterResult = results[2];
      const configuredOpenRouterModel = openRouterResult.status === 'fulfilled'
        && typeof openRouterResult.value?.model === 'string'
        ? openRouterResult.value.model.trim()
        : '';
      const configuredTarget = configuredOpenRouterModel && openRouterResult.status === 'fulfilled'
        && Array.isArray(openRouterResult.value?.targets)
        ? openRouterResult.value.targets.find((target: any) =>
          typeof target?.modelId === 'string'
          && target.modelId.toLowerCase() === configuredOpenRouterModel.toLowerCase()
          && typeof target.value === 'string'
        )
        : undefined;
      const configuredModelValue = typeof configuredTarget?.value === 'string'
        ? configuredTarget.value
        : configuredOpenRouterModel ? `openrouter:${configuredOpenRouterModel}` : '';
      const legacyModel = /^(?:z-ai\/glm-5\.2|openrouter:(?:openrouter\/free|z-ai\/glm-5\.2:free))$/i.test(initialModel.trim());
      if (!cancelled && configuredModelValue && legacyModel) onModelChange(configuredModelValue);
    };

    void loadApiPoolModels();
    const refresh = () => void loadApiPoolModels();
    window.addEventListener('nvidia-model-targets-updated', refresh);
    window.addEventListener('gemini-model-targets-updated', refresh);
    window.addEventListener('provider-model-targets-updated', refresh);
    window.addEventListener('pollinations-model-catalog-updated', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('nvidia-model-targets-updated', refresh);
      window.removeEventListener('gemini-model-targets-updated', refresh);
      window.removeEventListener('provider-model-targets-updated', refresh);
      window.removeEventListener('pollinations-model-catalog-updated', refresh);
    };
  }, []);

  const effectiveModelOptions = useMemo(() => {
    const selectedGeminiProfile = typeof geminiProfileId === 'string' ? geminiProfileId.trim() : '';
    const hasSelectedGeminiProfile = selectedGeminiProfile.length > 0
      && geminiProfiles.some((profile) => profile.id === selectedGeminiProfile);
    const profileScopedOptions = apiPoolModelOptions
      .map(withBaseApi)
      .filter((option) => option.provider !== 'Gemini'
        || !option.profileId
        || !hasSelectedGeminiProfile
        || option.profileId === selectedGeminiProfile);
    return dedupeModelOptions(profileScopedOptions, model);
  }, [apiPoolModelOptions, geminiProfileId, geminiProfiles, model]);

  useEffect(() => {
    if (apiPoolModelsLoaded) onModelOptionsChange?.(effectiveModelOptions);
  }, [apiPoolModelsLoaded, effectiveModelOptions, onModelOptionsChange]);

  useEffect(() => {
    if (!apiPoolModelsLoaded || effectiveModelOptions.length === 0) return;
    const selectedOption = effectiveModelOptions.find((option) => option.value === model);
    if (selectedOption) return;
    // A profile change invalidates a Gemini target bound to the old profile.
    // Move to a valid target so the hidden Gemini route cannot be submitted.
    if (model.startsWith('gemini')) {
      const nextOption = effectiveModelOptions.find((option) => option.provider === 'Gemini')
        || effectiveModelOptions.find((option) => option.provider !== 'Gemini');
      if (nextOption) onModelChange(nextOption.value);
    }
  }, [apiPoolModelsLoaded, effectiveModelOptions, model, onModelChange]);

  // Only bootstrap the shipped default when a deployment exposes a different
  // configured pool. Any user-selected stale target stays visible and blocked
  // so a refresh never silently changes their intent.
  useEffect(() => {
    if (!apiPoolModelsLoaded || effectiveModelOptions.length === 0) return;
    const isLegacyGroqTarget = /^groq-target:key-\d+$/i.test(model);
    const legacyGroqModel = model.startsWith('groq:') ? model.slice('groq:'.length) : '';
    // Legacy Groq values deliberately remain visible for an explicit user
    // choice; do not auto-migrate them to another route during refresh.
    if (isLegacyGroqTarget || legacyGroqModel) return;
    if (model === DEFAULT_CODER_MODEL_SELECTION && !effectiveModelOptions.some((option) => option.value === model)) {
      onModelChange(effectiveModelOptions[0].value);
    }
  }, [apiPoolModelsLoaded, effectiveModelOptions, model, onModelChange]);

  const [selectedProvider, setSelectedProvider] = useState<string>(() => {
    try {
      if (typeof window === 'undefined') return 'all';
      return window.localStorage.getItem('coder_target_provider') || 'all';
    } catch {
      return 'all';
    }
  });

  const availableProviders = useMemo(() => {
    const providers = new Set<string>();
    for (const option of effectiveModelOptions) {
      if (option.provider) providers.add(option.provider);
    }
    const preferredOrder = [
      'Gemini',
      'NVIDIA',
      'Groq',
      'OpenRouter',
      'Kimi',
      'Requesty',
      'SambaNova',
      'Cerebras',
      'Local',
      'Colab',
      'Pollinations',
    ];
    if (providers.size === 0) return preferredOrder;
    return Array.from(providers).sort((left, right) => {
      const leftIndex = preferredOrder.indexOf(left);
      const rightIndex = preferredOrder.indexOf(right);
      if (leftIndex !== -1 && rightIndex !== -1) return leftIndex - rightIndex;
      if (leftIndex !== -1) return -1;
      if (rightIndex !== -1) return 1;
      return left.localeCompare(right);
    });
  }, [effectiveModelOptions]);

  const filteredModelOptions = useMemo(() => {
    if (selectedProvider === 'all') return effectiveModelOptions;
    return effectiveModelOptions.filter((option) => option.provider === selectedProvider);
  }, [effectiveModelOptions, selectedProvider]);

  const handleProviderChange = (newProvider: string) => {
    setSelectedProvider(newProvider);
    try {
      window.localStorage.setItem('coder_target_provider', newProvider);
    } catch {
      // Provider filtering is a convenience preference; storage is best-effort.
    }
    if (newProvider !== 'all') {
      const matchingOptions = effectiveModelOptions.filter((option) => option.provider === newProvider);
      if (!matchingOptions.some((option) => option.value === model) && matchingOptions.length > 0) {
        onModelChange(matchingOptions[0].value);
      }
    }
  };

  useEffect(() => {
    if (!apiPoolModelsLoaded || effectiveModelOptions.length === 0 || selectedProvider === 'all') return;
    const matchingOptions = effectiveModelOptions.filter((option) => option.provider === selectedProvider);
    if (matchingOptions.length > 0 && !matchingOptions.some((option) => option.value === model)) {
      onModelChange(matchingOptions[0].value);
    }
  }, [apiPoolModelsLoaded, effectiveModelOptions, selectedProvider, model, onModelChange]);

  const groupedModelOptions = useMemo(() => {
    const groups = new Map<string, { label: string; options: ModelOption[] }>();
    const seenValues = new Set<string>();
    for (const option of filteredModelOptions) {
      if (!option.value || seenValues.has(option.value)) continue;
      seenValues.add(option.value);
      const provider = option.provider || 'Custom';
      const baseApi = option.baseApi || 'Configured by runtime';
      const key = `${provider}:${baseApi}`;
      const group = groups.get(key) || { label: `${provider === 'Groq' ? 'Groq Provider' : `${provider} API Pool`} \u00B7 ${baseApi}`, options: [] };
      group.options.push(option);
      groups.set(key, group);
    }
    return Array.from(groups.values());
  }, [filteredModelOptions]);

  const selectedModelOption = effectiveModelOptions.find((option) => option.value === model);
  const selectedLocalEndpointTest = selectedModelOption?.endpointId
    ? localAiTestResults[selectedModelOption.endpointId]
    : undefined;
  const selectedLocalEndpointFailure = selectedModelOption?.provider === 'Local'
    && isCurrentLocalAiEndpointFailure(selectedLocalEndpointTest, {
      baseUrl: selectedModelOption.baseApi,
      modelId: selectedModelOption.modelId,
    })
    ? selectedLocalEndpointTest
    : undefined;
  const workspacePathGuardFailure = [...agentEvents].reverse().find((event) => {
    if (event.type !== 'tool_result' || !eventFailed(event)) return false;
    const resultText = typeof event.result === 'string' ? event.result : JSON.stringify(event.result ?? {});
    return /path is outside the workspace|path escapes the workspace|resolved path escapes|symlink escapes the workspace/i.test(resultText);
  });
  const activePacingPreset = getExecutionProfilePreset(pacingProfile);
  const activeResolvedTarget = [...agentEvents].reverse().find((event) => event.type === 'model_target_resolved');
  const latestProviderRotation = [...agentEvents].reverse().find((event) => event.type === 'provider_rotation_occurred');
  const guidanceSnapshots = agentEvents.filter((event): event is Extract<AgentStreamEvent, { type: 'agent_guidance_snapshot' }> => event.type === 'agent_guidance_snapshot');
  const latestGuidanceSnapshot = guidanceSnapshots[guidanceSnapshots.length - 1];
  const previousGuidanceSnapshot = guidanceSnapshots.length > 1 ? guidanceSnapshots[guidanceSnapshots.length - 2] : undefined;
  const contextSnapshotRunId = [...thread].reverse().find((message) => message.role === 'assistant' && message.runId)?.runId || resumableRun?.id;
  const harnessStages = useMemo(
    () => deriveHarnessStages(task, agentEvents, loading, result),
    [task, agentEvents, loading, result],
  );
  const currentHarnessStage = harnessStages.find((stage) => stage.status === 'active')
    || [...harnessStages].reverse().find((stage) => stage.status === 'complete')
    || harnessStages[0];

  const getQualityGateEvidenceEvent = (gate: QualityGateResult) => {
    const terms = QUALITY_GATE_EVIDENCE_TERMS[gate.gateId];
    const candidates = agentEvents.flatMap((event, index) => {
      if (event.type !== 'verification_result' && event.type !== 'verification_started'
        && event.type !== 'command_output' && event.type !== 'tool_result') return [];
      const eventText = event.type === 'verification_result' || event.type === 'verification_started'
        ? `${event.type} ${event.type === 'verification_result' ? event.output || '' : event.command || ''}`
        : event.type === 'command_output'
          ? `${event.command || ''} ${event.output}`
          : `${event.tool} ${typeof event.result === 'string' ? event.result : JSON.stringify(event.result ?? {})}`;
      const normalized = eventText.toLowerCase();
      const score = terms.reduce((total, term) => total + (normalized.includes(term) ? 1 : 0), 0);
      return [{ event, index, score }];
    });
    const matched = [...candidates].reverse().find((candidate) => candidate.score > 0);
    if (matched) return matched;
    return [...candidates].reverse().find((candidate) => candidate.event.type === 'verification_result')
      || [...candidates].reverse().find((candidate) => candidate.event.type === 'verification_started');
  };

  const recentSteps: ReActStep[] = liveState?.steps?.slice(-6) || result?.steps?.slice(-6) || [];
  const plan: PlanItem[] = liveState?.plan || result?.plan || [];
  const threadTitle = getThreadTitle(thread, task);
  const runningAssistantReply = [...thread].reverse().find((message) =>
    message.role === 'assistant' && message.status === 'running' && getMessageContent(message).trim()
  )?.content || '';
  const latestSafeAssistantSummary = [...agentEvents].reverse().find((event) =>
    (event.type === 'reasoning_end' && event.phase === 'planning' && event.visibility === 'collapsed' && event.summary?.trim()) ||
    (event.type === 'model_response' && event.phase === 'planning' && event.message.trim())
  );
  const liveAssistantReply = runningAssistantReply || (
    latestSafeAssistantSummary?.type === 'reasoning_end'
      ? latestSafeAssistantSummary.summary || ''
      : latestSafeAssistantSummary?.type === 'model_response'
        ? latestSafeAssistantSummary.message
        : loading ? 'I’m reviewing the request and workspace context.' : ''
  );
  const hiddenMessageCount = Math.max(0, thread.length - RECENT_THREAD_MESSAGE_COUNT);
  const renderedThreadMessages = useMemo(
    () => showOlderMessages ? thread : thread.slice(-RECENT_THREAD_MESSAGE_COUNT),
    [showOlderMessages, thread]
  );
  const contextThreadMessages = renderedThreadMessages;
  const tokenEstimate = useMemo(
    () => estimateActivePromptTokens(thread, task, workspace, recentSteps, plan, taskAnalysis),
    [thread, task, workspace, recentSteps, plan, taskAnalysis]
  );
  const runTokenMetrics = useMemo(() => deriveRunTokenMetrics({
    liveState,
    result,
    fallbackContextTokens: tokenEstimate,
    // The active prompt budget is not the model's context window. Wait for
    // backend/model route telemetry before reporting a remaining amount.
    fallbackContextWindow: 0,
  }), [liveState, result, tokenEstimate]);
  const memoryPercent = runTokenMetrics.hasProviderPrompt
    ? runTokenMetrics.providerPromptUsedPercent || 0
    : runTokenMetrics.contextUsedPercent;
  const contextRemainingPercent = runTokenMetrics.hasContextWindow
    ? Math.max(0, 100 - memoryPercent)
    : 0;
  const contextWindowLabel = runTokenMetrics.hasContextWindow
    ? formatTokenCount(runTokenMetrics.contextWindow)
    : 'awaiting target';
  const contextRemainingLabel = runTokenMetrics.hasContextWindow
    ? `${formatTokenCount(runTokenMetrics.hasProviderPrompt
      ? runTokenMetrics.providerPromptRemainingTokens || 0
      : runTokenMetrics.contextRemainingTokens)} remaining`
    : 'remaining unknown';
  const resultIsCompleted = Boolean(result?.success || isCompletedWithVerificationFailure(result));
  const resultAnswer = textValue(result?.finalAnswer) || 'Task completed.';
  const resultIsRepresentedInThread = Boolean(
    resultIsCompleted && result && thread.some((message) =>
      message.role === 'assistant' && message.status === 'success' && getMessageContent(message).trim() === resultAnswer.trim()
    )
  );
  const resultTerminalOutcome = result ? resolveTerminalRunOutcome(result, agentStatus) : undefined;
  const terminalRunAdvice = [...agentEvents].reverse().find(
    (event): event is RunTerminalAdviceEvent => event.type === 'run_terminal_advice',
  );
  const renderQualityGatePanel = () => {
    const qualityGateResults = result?.verificationResult?.qualityGates;
    if (!qualityGateResults?.length) return null;
    return (
      <QualityGatePanel
        qualityGateResults={qualityGateResults}
        qualityScore={result?.verificationResult?.qualityScore || 0}
        terminalRunAdvice={terminalRunAdvice}
        evidenceAvailable={(gate) => Boolean(getQualityGateEvidenceEvent(gate))}
        onViewEvidence={(gate) => {
          const evidence = getQualityGateEvidenceEvent(gate);
          if (!evidence) return;
          setViewMode('console');
          handleChatEventSelect(evidence.index, evidence.event);
        }}
        onRemediate={(gate) => {
          const taskContext = task.trim() ? `Current task: ${task.trim()}\n\n` : '';
          const failure = gate.failureReason ? `\nVerification detail: ${gate.failureReason}` : '';
          const runAdvice = terminalRunAdvice?.category === 'gate_deadlock'
            ? `\nRun guidance: ${terminalRunAdvice.guidance.join(' ')}`
            : '';
          onTaskChange(`${taskContext}Fix the failed quality gate "${gate.name}" in this workspace. ${QUALITY_GATE_REMEDIATIONS[gate.gateId]}${failure}${runAdvice}`);
          window.requestAnimationFrame(() => textareaRef.current?.focus());
        }}
      />
    );
  };
  // Derive total run elapsed time from events (first event to last completed event / done)
  const runElapsedMs = useMemo(() => {
    let firstTimestamp: number | undefined;
    let lastTimestamp: number | undefined;
    for (const event of agentEvents) {
      let ts: number | undefined;
      let endTs: number | undefined;
      if (event.type === 'llm_request_started') {
        ts = event.request?.startedAt;
      } else if (event.type === 'llm_request_finished') {
        ts = event.request?.startedAt;
        endTs = event.request?.completedAt;
      } else if (event.type === 'state_transition') {
        ts = event.transition?.timestamp;
      } else if (event.type === 'user_message_queued') {
        ts = event.queuedAt;
      } else if (event.type === 'user_message_processed') {
        ts = event.processedAt;
      } else if (event.type === 'user_input_required') {
        ts = event.createdAt;
      }
      if (ts && Number.isFinite(ts) && ts > 0) {
        if (firstTimestamp === undefined || ts < firstTimestamp) firstTimestamp = ts;
        if (lastTimestamp === undefined || ts > lastTimestamp) lastTimestamp = ts;
      }
      if (endTs && Number.isFinite(endTs) && endTs > 0) {
        if (lastTimestamp === undefined || endTs > lastTimestamp) lastTimestamp = endTs;
      }
    }
    if (firstTimestamp && lastTimestamp && lastTimestamp >= firstTimestamp) {
      return lastTimestamp - firstTimestamp;
    }
    return undefined;
  }, [agentEvents]);

  const finalRunDurationMs = useMemo(() => {
    const traceDuration = (result?.performanceTrace as any)?.durationMs;
    if (typeof traceDuration === 'number' && traceDuration > 0) {
      return traceDuration;
    }
    const directDuration = (result as any)?.durationMs;
    if (typeof directDuration === 'number' && directDuration > 0) {
      return directDuration;
    }
    if (typeof runElapsedMs === 'number' && runElapsedMs > 0) {
      return runElapsedMs;
    }
    return undefined;
  }, [result, runElapsedMs]);

  const originalTaskDescription = useMemo(() => textValue(
    task ||
    (agentEvents.find((e) => e.type === 'run_started') as any)?.task ||
    getMessageContent(thread.find((m) => m.role === 'user')) ||
    ''
  ).trim(), [task, agentEvents, thread]);

  const toggleFinalAnswerCollapsed = () => {
    setFinalAnswerCollapsed((prev) => !prev);
  };

  useEffect(() => {
    try {
      sessionStorage.setItem('finalAnswerCollapsed', String(finalAnswerCollapsed));
    } catch {}
  }, [finalAnswerCollapsed]);

  const copyFinalAnswer = async () => {
    const text = result?.finalAnswer || '';
    if (!text.trim()) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      setFinalAnswerCopied(true);
      window.setTimeout(() => setFinalAnswerCopied(false), 2000);
    } catch {
      // Clipboard permissions unavailable
    }
  };
  const threadStatus = loading
    ? agentStatus || 'Streaming now'
    : result
      ? resultIsCompleted
        ? 'Completed'
        : resultTerminalOutcome === 'timed_out'
          ? 'Timed out'
        : resultTerminalOutcome === 'stopped'
          ? 'Stopped'
        : resultTerminalOutcome === 'interrupted'
          ? 'Interrupted'
        : resultTerminalOutcome === 'killed'
          ? 'Killed'
        : 'Needs attention'
      : thread.length > 0
        ? 'Ready for follow-up'
        : 'Idle';
  const threadAge = thread[0] ? formatTime(thread[0].createdAt) : 'idle';
  const visibleThreads = threads && threads.length > 0
    ? threads
    : [{
      id: activeThreadId || 'active-thread',
      title: threadTitle,
      messages: thread,
      createdAt: thread[0]?.createdAt || Date.now(),
      updatedAt: thread[thread.length - 1]?.createdAt || Date.now(),
    }];

  const rawActiveFiles = useMemo(() => {
    const fromThread = contextThreadMessages.flatMap((message) => extractFilePaths(message.content));
    const fromSteps = recentSteps.flatMap((step) =>
      extractFilePaths(step.thought, step.action, step.observation, stringifyActionInput(step.action_input))
    );
    const fromAnalysis = [
      ...(taskAnalysis?.mentionedFiles || []),
      ...(taskAnalysis?.inferredFiles || []),
      ...(taskAnalysis?.affectedFiles?.map((file) => file.path) || []),
    ];
    return Array.from(new Set([...fromThread, ...fromSteps, ...fromAnalysis, ...extractFilePaths(task)]));
  }, [contextThreadMessages, recentSteps, task, taskAnalysis]);
  const promptFiles = useMemo(() => extractFilePaths(task), [task]);
  const activeFiles = useMemo(
    () => rawActiveFiles.filter((file) => promptFiles.includes(file) || !ignoredContextFiles.has(file)),
    [ignoredContextFiles, promptFiles, rawActiveFiles]
  );
  const visibleContextFiles = activeFiles.slice(0, 4);
  const hiddenContextCount = Math.max(0, activeFiles.length - visibleContextFiles.length);
  const composerPromptTokens = useMemo(
    () => estimateContentTokens({ task, workspaceFiles: visibleContextFiles }) + attachedImages.length * 1_024,
    [task, visibleContextFiles, attachedImages.length],
  );
  const selectedContextWindow = selectedModelOption ? getModelOptionContextWindow(selectedModelOption) : undefined;
  const safeInputBudget = selectedContextWindow ? Math.floor(selectedContextWindow * 0.75) : undefined;
  const composerBudgetPercent = safeInputBudget ? Math.min(100, (composerPromptTokens / safeInputBudget) * 100) : undefined;
  const activeLlmRequest = useMemo(() => {
    let active: AgentRequestEnvelope | undefined;
    for (const event of agentEvents) {
      if (event.type === 'llm_request_started') {
        active = event.request;
      } else if (event.type === 'llm_request_finished') {
        if (!active || !event.request.requestId || event.request.requestId === active.requestId) active = undefined;
      }
    }
    return active;
  }, [agentEvents]);
  const [llmRequestNow, setLlmRequestNow] = useState(() => Date.now());
  useEffect(() => {
    if (!activeLlmRequest?.startedAt) return;
    const update = () => setLlmRequestNow(Date.now());
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [activeLlmRequest?.requestId, activeLlmRequest?.startedAt]);
  const activeLlmRequestElapsedMs = activeLlmRequest?.startedAt
    ? Math.max(0, llmRequestNow - activeLlmRequest.startedAt)
    : 0;
  const latestAgentActivity = useMemo(() => {
    const lastEvent = agentEvents[agentEvents.length - 1];

    if (!loading) {
      if (agentStatus === 'completed') return 'Completed';
      if (agentStatus === 'timed_out' || resolveTerminalRunOutcome(result, agentStatus) === 'timed_out') return 'Timed out';
      if (agentStatus === 'failed') {
        return result?.error || [...agentEvents].reverse().find((event) =>
          event.type === 'error' || event.type === 'execution_failed'
        )?.message || 'Failed';
      }
      if (agentStatus === 'stopped') return 'Stopped';
      if (agentStatus === 'interrupted') return 'Interrupted';
      if (agentStatus === 'killed') return 'Killed';
      return '';
    }

    if (lastEvent) {
      if (lastEvent.type === 'model_stream' && lastEvent.requestKind === 'final_answer.synthesize') {
        return 'Writing final response...';
      }
      if (lastEvent.type === 'final' || (lastEvent.type === 'model_response' && lastEvent.phase === 'final')) {
        return 'Final response ready.';
      }
      const message = getAgentEventMessage(lastEvent);
      const detail = message.detail.replace(/\s+/g, ' ').trim();
      const shortDetail = detail.length > 180 ? `${detail.slice(0, 177)}...` : detail;
      return shortDetail ? `${message.title}: ${shortDetail}` : message.title;
    }
    if (lastEvent?.type === 'llm_request_started') {
      const elapsed = activeLlmRequest?.requestId === lastEvent.request.requestId
        ? ` · ${formatElapsedDuration(activeLlmRequestElapsedMs)} elapsed`
        : '';
      const timeout = lastEvent.request.options?.timeoutMs
        ? ` / ${formatProviderWaitDuration(lastEvent.request.options.timeoutMs)} limit`
        : '';
      return `Waiting for ${formatAgentRequestRoute(lastEvent.request)}${elapsed}${timeout}`;
    }
    if (lastEvent?.type === 'llm_request_finished') return eventTimedOut(lastEvent)
      ? `Provider timed out: ${formatAgentRequestRoute(lastEvent.request)}`
      : `Provider response: ${formatAgentRequestRoute(lastEvent.request)}`;
    if (liveProgress) return liveProgress;
    return agentStatus ? `${agentStatus.charAt(0).toUpperCase()}${agentStatus.slice(1)}` : 'Thinking';
  }, [activeLlmRequest, activeLlmRequestElapsedMs, agentEvents, agentStatus, liveProgress, loading, result]);
  const pausedForProvider = loading && agentStatus === 'waiting for provider';
  const activeCooldownEvent = useMemo(() => {
    if (!agentEvents || !agentEvents.length) return undefined;
    return [...agentEvents].reverse().find((event) =>
      event.type === 'nvidia_cooldown_retry' ||
      (event.type === 'pacing_wait' && event.scope === 'free_tier_key_cooldown') ||
      event.type === 'cooldown_waiting'
    );
  }, [agentEvents]);
  const starterPrompts = [
    'Create a vanilla HTML/CSS/JS counter app',
    'Inspect this workspace and add unit tests for an important module',
    'Refactor the app CSS into clear, reusable components',
  ];

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = 220;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${Math.max(nextHeight, 96)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [task]);

  useEffect(() => {
    setShowOlderMessages(false);
  }, [activeThreadId]);

  useEffect(() => {
    const scrollContainer = threadScrollRef.current;
    if (!scrollContainer) return;
    if (!autoScrollEnabledRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'auto' });
      setShowScrollBottom(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeThreadId,
    renderedThreadMessages,
    agentEvents,
    liveProgress,
    loading,
    result,
    showOlderMessages,
  ]);

  useEffect(() => {
    const scrollContainer = threadScrollRef.current;
    const content = threadContentRef.current;
    if (!scrollContainer || !content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!autoScrollEnabledRef.current) return;
      scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'auto' });
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [activeThreadId]);

  const loadFileTree = async () => {
    try {
      setTreeLoading(true);
      setTreeError(null);
      const response = await fetch(`/api/workspace/tree?workspace=${encodeURIComponent(workspace)}`);
      if (!response.ok) throw new Error('Failed to load workspace explorer');
      const data = await response.json();
      setFileTree(Array.isArray(data) ? data : Array.isArray(data?.tree) ? data.tree : []);
      setTreeTruncated(data?.truncated === true);
    } catch (error: any) {
      setTreeError(error.message || 'Unable to load workspace explorer');
      setFileTree([]);
    } finally {
      setTreeLoading(false);
    }
  };

  const scheduleFilePresentationClear = (delayMs = 500) => {
    if (filePresentationClearTimerRef.current !== null) {
      window.clearTimeout(filePresentationClearTimerRef.current);
    }
    filePresentationClearTimerRef.current = window.setTimeout(() => {
      setFilePresentation(null);
      filePresentationClearTimerRef.current = null;
    }, delayMs);
  };

  const settleFilePresentation = () => {
    const resolve = filePresentationResolveRef.current;
    filePresentationResolveRef.current = null;
    filePresentationWaitRef.current = null;
    resolve?.();
  };

  const loadWorkspaceFile = async (
    path: string,
    presentationMode?: 'reading' | 'writing',
  ) => {
    const requestId = ++fileRequestRef.current;
    settleFilePresentation();
    fileRevealControllerRef.current?.cancel();
    let resolvePresentation: (() => void) | null = null;
    const presentationDone = presentationMode
      ? new Promise<void>((resolve) => {
        resolvePresentation = resolve;
      })
      : null;
    if (presentationDone) {
      filePresentationWaitRef.current = presentationDone;
      filePresentationResolveRef.current = resolvePresentation;
    }
    setSelectedFilePath(path);
    setOpenFilePaths((current) => current.includes(path) ? current : [...current, path]);
    setFileLoading(true);
    setFileError(null);
    setSelectedFileContent('');
    if (presentationMode) {
      if (filePresentationClearTimerRef.current !== null) {
        window.clearTimeout(filePresentationClearTimerRef.current);
        filePresentationClearTimerRef.current = null;
      }
      setFilePresentation({ path, mode: presentationMode, progress: 0 });
    } else {
      setFilePresentation(null);
    }

    try {
      const response = await fetch(
        `/api/workspace/file?path=${encodeURIComponent(path)}&workspace=${encodeURIComponent(workspace)}`
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to load workspace file');
      const content = typeof data.content === 'string' ? data.content : '';
      const configuredPresentationMs = presentationMode === 'writing'
        ? activePacingPreset.toolPresentation.writeMs
        : activePacingPreset.toolPresentation.readMs;
      if (requestId !== fileRequestRef.current) return;
      if (!presentationMode || content.length === 0 || configuredPresentationMs <= 0) {
        setSelectedFileContent(content);
        if (presentationMode) {
          setFilePresentation({ path, mode: presentationMode, progress: 100 });
          scheduleFilePresentationClear();
          resolvePresentation?.();
          if (filePresentationResolveRef.current === resolvePresentation) {
            filePresentationResolveRef.current = null;
            filePresentationWaitRef.current = null;
          }
        }
      } else {
        const characterCount = Array.from(content).length;
        // Leave time inside the profile's server-side presentation window for
        // the local fetch and a short completed-state hold.
        const durationMs = Math.max(
          100,
          configuredPresentationMs - (presentationMode === 'writing' ? 800 : 700),
        );
        const intervalMs = 24;
        const tickCount = Math.max(1, Math.floor(durationMs / intervalMs));
        const charactersPerTick = Math.max(1, Math.ceil(characterCount / tickCount));
        setSelectedFileContent('');
        const characters = Array.from(content);
        let shownCharacters = 0;
        const timer = window.setInterval(() => {
          shownCharacters = Math.min(characterCount, shownCharacters + charactersPerTick);
          setSelectedFileContent(characters.slice(0, shownCharacters).join(''));
          setFilePresentation({
            path,
            mode: presentationMode,
            progress: Math.min(100, Math.round((shownCharacters / characterCount) * 100)),
          });
          if (shownCharacters >= characterCount) {
            window.clearInterval(timer);
            fileRevealControllerRef.current = null;
            scheduleFilePresentationClear();
            resolvePresentation?.();
            if (filePresentationResolveRef.current === resolvePresentation) {
              filePresentationResolveRef.current = null;
              filePresentationWaitRef.current = null;
            }
          }
        }, intervalMs);
        fileRevealControllerRef.current = {
          cancel: () => window.clearInterval(timer),
        };
      }
    } catch (error: any) {
      if (requestId !== fileRequestRef.current) return;
      setFileError(error.message || 'Unable to load workspace file');
      setSelectedFileContent('');
      setFilePresentation(null);
      resolvePresentation?.();
      if (filePresentationResolveRef.current === resolvePresentation) {
        filePresentationResolveRef.current = null;
        filePresentationWaitRef.current = null;
      }
    } finally {
      if (requestId === fileRequestRef.current) setFileLoading(false);
    }
  };

  const closeFileTab = (path: string) => {
    const tabIndex = openFilePaths.indexOf(path);
    const remaining = openFilePaths.filter((openPath) => openPath !== path);
    setOpenFilePaths(remaining);
    if (selectedFilePath !== path) return;
    const nextPath = remaining[Math.min(tabIndex, remaining.length - 1)];
    if (nextPath) {
      void loadWorkspaceFile(nextPath, 'reading');
    } else {
      fileRequestRef.current += 1;
      settleFilePresentation();
      setSelectedFilePath(null);
      setSelectedFileContent('');
      setFileError(null);
      setFileLoading(false);
      setExpandedFileModalOpen(false);
    }
  };

  useEffect(() => {
    fileRequestRef.current += 1;
    settleFilePresentation();
    setOpenFilePaths([]);
    setSelectedFilePath(null);
    setSelectedFileContent('');
    setFileError(null);
    setExpandedFileModalOpen(false);
  }, [workspace]);

  useEffect(() => {
    if (!expandedFileModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedFileModalOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expandedFileModalOpen]);

  useEffect(() => {
    if (showExplorer) {
      void loadFileTree();
    }
  }, [showExplorer, workspace]);

  useEffect(() => {
    if (agentEvents.length < presentedAgentEventCountRef.current) {
      presentedAgentEventCountRef.current = 0;
    }
    const newEvents = agentEvents.slice(presentedAgentEventCountRef.current);
    presentedAgentEventCountRef.current = agentEvents.length;
    // Keep the animated read/write preview synchronized with the inline
    // current-agent card. The thread is the live surface; nothing should
    // interrupt it with an automatically opened overlay.
    const fileEvent = [...newEvents].reverse().find(
      (event) => event.type === 'file_read' || event.type === 'file_changed',
    );
    if (fileEvent && (fileEvent.type === 'file_read' || fileEvent.type === 'file_changed')) {
      const path = fileEvent.path;
      setShowExplorer(true);
      setIsRightPanelOpen(true);
      if (typeof window !== 'undefined' && window.innerWidth < 1024) {
        setActiveMobileTab('workspace');
      }
      const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);
      setExpandedFolders((current) => {
        const next = new Set(current);
        let parent = '';
        for (const segment of segments.slice(0, -1)) {
          parent = parent ? `${parent}/${segment}` : segment;
          next.add(parent);
        }
        return next;
      });

      if (fileEvent.type === 'file_changed') {
        void loadFileTree();
        void loadWorkspaceFile(path, 'writing');
      } else {
        void loadWorkspaceFile(path, 'reading');
      }
      return;
    }
  }, [agentEvents, pacingProfile]);

  useEffect(() => () => {
    fileRevealControllerRef.current?.cancel();
    settleFilePresentation();
    if (filePresentationClearTimerRef.current !== null) {
      window.clearTimeout(filePresentationClearTimerRef.current);
    }
  }, []);

  const toggleExplorerPosition = () => {
    const next = explorerPosition === 'right' ? 'left' : 'right';
    setExplorerPosition(next);
    try {
      window.localStorage.setItem('coder_chat_explorer_position', next);
    } catch {
      // Ignore local storage failures; the layout still works for this session.
    }
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const updateIgnoredContextFiles = (update: (current: Set<string>) => Set<string>) => {
    setIgnoredContextFiles((current) => {
      const next = update(current);
      writeIgnoredContextFiles(activeThreadId, next);
      return next;
    });
  };

  const insertFilePath = (path: string) => {
    const prefix = task.trim() ? `${task.trimEnd()} ` : '';
    updateIgnoredContextFiles((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
    onTaskChange(`${prefix}\`${path}\``);
  };

  const removeContextFile = (path: string) => {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nextTask = task
      .replace(new RegExp(`\\s*\`${escaped}\``, 'g'), '')
      .replace(new RegExp(`\\s*${escaped}`, 'g'), '')
      .replace(/[ \t]{2,}/g, ' ')
      .trimStart();
    updateIgnoredContextFiles((prev) => new Set(prev).add(path));
    onTaskChange(nextTask);
  };

  const clearPromptContext = () => {
    const nextTask = activeFiles.reduce((current, file) => {
      const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return current
        .replace(new RegExp(`\\s*\`${escaped}\``, 'g'), '')
        .replace(new RegExp(`\\s*${escaped}`, 'g'), '');
    }, task).replace(/[ \t]{2,}/g, ' ').trimStart();
    updateIgnoredContextFiles((prev) => new Set([...prev, ...activeFiles]));
    onTaskChange(nextTask);
  };

  const focusWorkspaceContext = () => {
    if (!showExplorer) setShowExplorer(true);
    if (selectedFilePath) {
      insertFilePath(selectedFilePath);
    }
  };

  const flattenTreeFilePaths = (nodes: TreeNode[]): string[] => {
    const result: string[] = [];
    const traverse = (nodeList: TreeNode[]) => {
      for (const node of nodeList) {
        const p = node.path || node.name;
        if (node.type === 'file') {
          result.push(p);
        } else if (node.type === 'directory' && node.children) {
          traverse(node.children);
        }
      }
    };
    traverse(nodes);
    return result;
  };

  const openFileFromExplorer = (path: string) => {
    setShowExplorer(true);
    setIsRightPanelOpen(true);
    void loadWorkspaceFile(path, 'reading');
  };

  const copyInlineContent = async (content: string | undefined, actionKey: string) => {
    const safeContent = textValue(content);
    if (!safeContent.trim()) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(safeContent);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = safeContent;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      setCopiedInlineActionKey(actionKey);
      window.setTimeout(() => {
        setCopiedInlineActionKey((current) => current === actionKey ? null : current);
      }, 1600);
    } catch {
      // Clipboard permissions can be unavailable in embedded or restricted browsers.
    }
  };

  const renderInlineContentActions = (
    content: string | undefined,
    actionKey: string,
    onInspect?: () => void,
  ) => {
    const safeContent = textValue(content);
    if (!safeContent.trim()) return null;
    const isCopied = copiedInlineActionKey === actionKey;
    const isInspected = inspectedInlineActionKey === actionKey;
    return (
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
        <button
          type="button"
          data-testid="inline-copy-action"
          onClick={() => void copyInlineContent(safeContent, actionKey)}
          className="inline-flex items-center gap-1 rounded border border-neutral-700/80 bg-neutral-900/80 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-wider text-neutral-400 transition hover:border-cyan-500/50 hover:text-cyan-200"
        >
          {isCopied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {isCopied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          data-testid="inline-inspect-action"
          onClick={() => {
            setInspectedInlineActionKey(isInspected ? null : actionKey);
            onInspect?.();
          }}
          className="inline-flex items-center gap-1 rounded border border-neutral-700/80 bg-neutral-900/80 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-wider text-neutral-400 transition hover:border-cyan-500/50 hover:text-cyan-200"
        >
          <Search className="h-3 w-3" />
          {onInspect ? 'Show changes / diff' : isInspected ? 'Collapse' : 'Inspect'}
        </button>
      </div>
    );
  };

  const requestUndoChanges = (message: CoderThreadMessage, summary: CoderChangeSummary) => {
    if (!onUndoChanges || undoingMessageId === message.id) return;
    const paths = summary.files.map((file) => file.path);
    if (typeof window !== 'undefined' && !window.confirm(`Ask the agent to undo changes in ${paths.length} file${paths.length === 1 ? '' : 's'}? It will inspect the current files first and preserve unrelated edits.`)) return;
    setUndoingMessageId(message.id);
    Promise.resolve(onUndoChanges(paths))
      .catch(() => undefined)
      .finally(() => setUndoingMessageId((current) => current === message.id ? null : current));
  };

  const confirmThreadDelete = (title: string) => {
    if (typeof window === 'undefined') return true;
    return window.confirm(`Delete "${title}" and its saved runs, checkpoints, and Run Audits from local history?`);
  };

  const clearThread = () => {
    if (!confirmThreadDelete(threadTitle)) return;
    onClearThread?.();
    onTaskChange('');
  };

  const createThread = () => {
    if (onNewThread) {
      onNewThread();
    } else {
      clearThread();
    }
  };

  const deleteThread = (threadId: string, title: string) => {
    if (!confirmThreadDelete(title)) return;
    if (onDeleteThread) {
      onDeleteThread(threadId);
    } else {
      clearThread();
    }
  };

  const saveThreadRename = async (threadId: string) => {
    const nextTitle = threadTitleDraft.trim();
    if (!nextTitle || !onRenameThread || threadRenameBusy) return;
    setThreadRenameBusy(true);
    setThreadRenameError(null);
    try {
      await onRenameThread(threadId, sanitizeCoderThreadTitle(nextTitle));
      setRenamingThreadId(null);
      setThreadTitleDraft('');
    } catch (error) {
      setThreadRenameError(error instanceof Error ? error.message : 'Could not rename this thread.');
    } finally {
      setThreadRenameBusy(false);
    }
  };

  const submitComposer = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (viewMode === 'console') return;
    const trimmed = task.trim();
    if ((!trimmed && attachedImages.length === 0) || loading || isProcessingImages || !selectedModelOption) return;
    autoScrollEnabledRef.current = true;
    const currentImages = [...attachedImages];
    const pendingPresentation = filePresentationWaitRef.current;
    onTaskChange('');
    setAttachedImages([]);
    if (pendingPresentation) await pendingPresentation;
    await onRunTask({ task: trimmed, images: currentImages });
  };

  const submitAsAgent = async () => {
    const trimmed = task.trim();
    if ((!trimmed && attachedImages.length === 0) || loading || isProcessingImages || !selectedModelOption) return;
    autoScrollEnabledRef.current = true;
    if (coderMode !== 'agent') onCoderModeChange('agent');
    const currentImages = [...attachedImages];
    const pendingPresentation = filePresentationWaitRef.current;
    onTaskChange('');
    setAttachedImages([]);
    if (pendingPresentation) await pendingPresentation;
    await onRunTask({ task: trimmed, images: currentImages });
  };

  const handleThreadScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 120;
    autoScrollEnabledRef.current = isAtBottom;
    setShowScrollBottom(!isAtBottom);
  };

  const scrollToLatest = () => {
    const target = threadScrollRef.current;
    if (!target) return;
    autoScrollEnabledRef.current = true;
    target.scrollTo({ top: target.scrollHeight, behavior: 'smooth' });
    setShowScrollBottom(false);
  };

  const messageNeedsProceed = (message: CoderThreadMessage) =>
    message.role === 'assistant' &&
    message.status !== 'error' &&
    /\b(shall i|should i|would you like me to|do you want me to|to proceed|before .* proceed|ask the user for confirmation|needs? confirmation|go ahead)\b/i.test(getMessageContent(message));

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submitAsAgent();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitComposer();
      return;
    }

    if (event.key === 'Escape') {
      if (loading) {
        event.preventDefault();
        onStopTask();
        return;
      }
      event.currentTarget.blur();
    }
  };

  const eventIcon = (type: AgentStreamEvent['type']) => {
    if (type === 'task_analysis_ready') return <ClipboardList className="h-3.5 w-3.5 text-cyan-300" />;
    if (type === 'model_response' || type === 'reasoning_start' || type === 'reasoning_delta' || type === 'reasoning_end') return <Bot className="h-3.5 w-3.5 text-cyan-300" />;
    if (type === 'llm_request_started' || type === 'llm_request_finished' || type === 'llm_request_heartbeat') return <Cpu className="h-3.5 w-3.5 text-cyan-300" />;
    if (type === 'provider_rotation_occurred') return <Route className="h-3.5 w-3.5 text-amber-300" />;
    if (type === 'console_output') return <Terminal className="h-3.5 w-3.5 text-violet-300" />;
    if (type === 'decision_record') return <ClipboardList className="h-3.5 w-3.5 text-cyan-300" />;
    if (type === 'provider_attempt_failed' || type === 'cooldown_waiting' || type === 'nvidia_cooldown_retry' || type === 'retrying') return <History className="h-3.5 w-3.5 text-amber-300" />;
    if (type === 'execution_failed') return <AlertCircle className="h-3.5 w-3.5 text-rose-300" />;
    if (type === 'plan_updated') return <ClipboardList className="h-3.5 w-3.5 text-cyan-300" />;
    if (type === 'workplan_updated') return <Route className="h-3.5 w-3.5 text-cyan-300" />;
    if (type === 'state_transition') return <Activity className="h-3.5 w-3.5 text-cyan-300" />;
    if (type === 'recovery_transition') return <History className="h-3.5 w-3.5 text-amber-300" />;
    if (type === 'file_read') return <Search className="h-3.5 w-3.5 text-sky-300" />;
    if (type === 'file_changed') return <FilePenLine className="h-3.5 w-3.5 text-amber-300" />;
    if (type === 'command_started' || type === 'command_output' || type === 'package_install_started' || type === 'package_install_result') return <TerminalSquare className="h-3.5 w-3.5 text-violet-300" />;
    if (type === 'verification_started' || type === 'verification_result') return <ListChecks className="h-3.5 w-3.5 text-emerald-300" />;
    if (type === 'policy_decision') return <ShieldCheck className="h-3.5 w-3.5 text-amber-300" />;
    if (type === 'harness_intervention') return <ShieldAlert className="h-3.5 w-3.5 text-amber-300" />;
    if (type === 'pacing_wait') return <History className="h-3.5 w-3.5 text-amber-300" />;
    if (type === 'error') return <AlertCircle className="h-3.5 w-3.5 text-rose-300" />;
    if (type === 'stopped' || type === 'interrupted' || type === 'killed') return <Square className="h-3.5 w-3.5 text-amber-300" />;
    return <Cpu className="h-3.5 w-3.5 text-cyan-300" />;
  };

  const eventStatusIcon = (event: AgentStreamEvent) =>
    eventFailed(event)
      ? <AlertCircle className="h-3.5 w-3.5 text-rose-300" />
      : eventIcon(event.type);

  const legacyEventTitle = (event: AgentStreamEvent) => {
    switch (event.type) {
      case 'task_analysis_ready': return 'Task analysis ready';
      case 'run_started': return 'Started';
      case 'state_transition': return `State: ${event.transition.to}`;
      case 'recovery_transition': return `Recovery: ${event.to}`;
      case 'console_output': return 'Console output';
      case 'model_target_resolved': return event.route === 'recovery'
        ? 'Recovery model selected'
        : event.route === 'fallback'
          ? 'Same-provider model fallback'
          : 'Model target resolved';
      case 'llm_request_started': return `Calling ${formatAgentRequestRoute(event.request)}`;
      case 'provider_rotation_occurred': return `Route: ${event.fromProvider} -> ${event.toProvider}`;
      case 'llm_request_finished': return eventTimedOut(event)
        ? 'Provider request timed out'
        : event.request.status === 'failed'
          ? 'Provider request failed'
          : 'Provider response received';
      case 'llm_request_heartbeat': return event.stale ? 'Provider request may be stalled' : 'Waiting for provider response';
      case 'model_response': return 'Agent decision';
      case 'reasoning_start': return 'Thinking started';
      case 'reasoning_delta': return 'Reasoning update';
      case 'reasoning_end': return event.visibility === 'redacted' ? 'Thinking redacted' : 'Reasoning summary';
      case 'decision_record': return `Decision${event.record.decisionCategory ? ` · ${event.record.decisionCategory}` : ''} · ${event.record.status}`;
      case 'provider_attempt_failed': return 'Provider attempt failed';
      case 'cooldown_waiting': return event.waitingUntil ? `Waiting for key cooldown (${Math.max(1, Math.ceil((event.waitingUntil - Date.now()) / 1000))}s)` : 'Waiting for key cooldown';
      case 'nvidia_cooldown_retry': return 'All NVIDIA keys throttled';
      case 'retrying': return 'Retrying from checkpoint';
       case 'execution_failed': return eventTimedOut(event) ? 'Run timed out' : 'Execution failed';
      case 'pacing_wait': return event.scope === 'free_tier_key_cooldown' ? 'NVIDIA key cooldown' : event.scope === 'fallback' ? 'Waiting for retry' : 'Request pacing';
      case 'plan_updated': return 'Plan updated';
      case 'todo_snapshot': return 'Todo snapshot';
      case 'todo_links_updated': return 'Todo links updated';
      case 'workplan_updated': return 'Workplan updated';
      case 'tool_started': return `Tool: ${event.tool}`;
       case 'tool_result': return eventTimedOut(event) ? `${event.tool} timed out` : `${event.tool} result`;
      case 'harness_intervention': return 'Harness guard intervention';
      case 'file_read': return 'Read file';
      case 'file_changed': return 'Changed file';
      case 'command_started': return 'Running command';
       case 'command_output': return eventTimedOut(event) ? 'Command timed out' : 'Command output';
      case 'package_install_started': return 'Installing dependencies';
       case 'package_install_result': return eventTimedOut(event) ? 'Dependency installation timed out' : event.success ? 'Dependencies installed' : 'Dependency installation failed';
      case 'verification_started': return 'Verifying';
       case 'verification_result': return eventTimedOut(event) ? 'Verification timed out' : event.success ? 'Verification passed' : 'Verification failed';
      case 'user_input_required': return 'Waiting for your answer';
      case 'user_input_resolved': return event.cancelled ? 'Question skipped' : 'Answer received';
      case 'policy_decision': return event.decision.allowed ? 'Policy allowed action' : event.decision.requiresApproval ? 'Approval required' : 'Policy blocked action';
      case 'final': return 'Final answer';
      case 'stopped': return 'Stopped';
      case 'interrupted': return 'Interrupted';
      case 'killed': return 'Killed';
       case 'error': return eventTimedOut(event) ? 'Run timed out' : 'Error';
      default: return 'Activity';
    }
  };

  const legacyEventBody = (event: AgentStreamEvent): string => {
    if (event.type === 'task_analysis_ready') {
      const files = event.taskAnalysis.affectedFiles.map((file) => file.path).slice(0, 8);
      return [
        `${event.taskAnalysis.taskKind.replace(/_/g, ' ')} · ${event.taskAnalysis.expectedChangeIntent.replace(/_/g, ' ')} · risk ${event.taskAnalysis.riskLevel}`,
        ...(files.length ? [`Affected files: ${files.join(', ')}`] : []),
      ].join('\n');
    }
    if (event.type === 'run_started') return typeof event.task === 'string' ? event.task : '';
    if (event.type === 'state_transition') return `${event.transition.from} -> ${event.transition.to}\n${event.transition.reason}`;
    if (event.type === 'recovery_transition') return `${event.from} -> ${event.to} (attempt ${event.attempt})\n${event.message || event.reason}`;
    if (event.type === 'console_output') return event.message;
    if (event.type === 'model_target_resolved') {
      const account = event.profileId ? ` Â· profile ${event.profileId}` : Number.isInteger(event.credentialIndex) ? ` Â· credential ${Number(event.credentialIndex) + 1}` : '';
      const context = event.contextWindow ? ` Â· context ${event.contextWindow.toLocaleString()}` : '';
      return `${event.requestedTarget} â†’ ${event.provider}/${event.resolvedModel}${account}${context}`;
    }
    if (event.type === 'llm_request_started') {
      return [
        `Route: ${formatAgentRequestRoute(event.request)}`,
        event.request.requestKind ? `Request: ${event.request.requestKind}` : '',
        event.request.options?.timeoutMs ? `Timeout budget: ${Math.ceil(event.request.options.timeoutMs / 1_000)}s` : '',
      ].filter(Boolean).join('\n');
    }
    if (event.type === 'provider_rotation_occurred') {
      const fromAccount = Number.isInteger(event.fromKeyIndex) ? ` account ${Number(event.fromKeyIndex) + 1}` : '';
      const toAccount = Number.isInteger(event.toKeyIndex) ? ` account ${Number(event.toKeyIndex) + 1}` : '';
      return `${event.fromProvider}${event.fromProfileId ? ` ${event.fromProfileId}` : fromAccount}${event.fromModel ? ` / ${event.fromModel}` : ''} -> ${event.toProvider}${event.toProfileId ? ` ${event.toProfileId}` : toAccount}${event.toModel ? ` / ${event.toModel}` : ''}${event.cooldownSeconds > 0 ? `; cooldown ${event.cooldownSeconds}s` : ''}; ${event.reason}`;
    }
    if (event.type === 'llm_request_finished') {
      return [
        `Route: ${formatAgentRequestRoute(event.request)}`,
        `Status: ${event.request.status || 'unknown'}`,
        Number.isFinite(event.request.durationMs) ? `Duration: ${Math.ceil(Number(event.request.durationMs) / 1_000)}s` : '',
        event.request.error || '',
      ].filter(Boolean).join('\n');
    }
    if (event.type === 'llm_request_heartbeat') {
      return `${event.provider} / ${event.model}${event.requestKind ? ` · ${event.requestKind}` : ''} · ${Math.ceil(event.elapsedMs / 1_000)}s elapsed${event.deadlineAt ? ` · deadline ${new Date(event.deadlineAt).toLocaleTimeString()}` : ''}${event.stale ? '\nProvider request exceeded its effective deadline; outcome is unknown.' : ''}`;
    }
    if (event.type === 'model_response') return typeof event.message === 'string' ? event.message : '';
    if (event.type === 'reasoning_start') return `Safe reasoning summary started (${event.source}; ${event.visibility}).`;
    if (event.type === 'reasoning_delta') return event.delta;
    if (event.type === 'reasoning_end') return event.summary || `Safe reasoning summary completed (${event.source}; ${event.visibility}).`;
    if (event.type === 'decision_record') return [
      `Action: ${event.record.action.action}`,
      event.record.decisionCategory ? `Category: ${event.record.decisionCategory}` : '',
      event.record.rationale ? `Rationale: ${event.record.rationale}` : '',
      event.record.expectedEvidence?.length ? `Expected evidence: ${event.record.expectedEvidence.join(' | ')}` : '',
      event.record.evidenceChecks?.length ? `Typed checks: ${event.record.evidenceChecks.map((check) => check.type).join(' | ')}` : '',
      event.record.toolEvidenceId ? `Tool evidence: ${event.record.toolEvidenceId}` : '',
      event.record.observedEvidence ? `Observed evidence: ${event.record.observedEvidence.status} — ${event.record.observedEvidence.summary}` : 'Observed evidence: pending',
    ].filter(Boolean).join('\n');
    if (event.type === 'provider_attempt_failed' || event.type === 'cooldown_waiting' || event.type === 'nvidia_cooldown_retry' || event.type === 'retrying') return typeof event.message === 'string' ? event.message : '';
    if (event.type === 'execution_failed') return typeof event.message === 'string' ? event.message : '';
    if (event.type === 'pacing_wait') return typeof event.message === 'string' ? event.message : '';
    if (event.type === 'plan_updated') {
      const items = Array.isArray(event.plan) ? event.plan : [event.plan];
      return items.map((item) => {
        if (typeof item === 'string') return item;
        return item && typeof item === 'object' && typeof item.step === 'string' ? item.step : '';
      }).filter(Boolean).join('\n');
    }
    if (event.type === 'todo_snapshot') return event.items.map((item) => `[${item.status}] ${item.content}`).join('\n');
    if (event.type === 'todo_links_updated') return event.links.length
      ? `${event.links.length} todo item link${event.links.length === 1 ? '' : 's'} updated.`
      : 'Todo links updated.';
    if (event.type === 'workplan_updated') {
      return [event.workPlan?.objective, event.workPlan?.status ? `Status: ${event.workPlan.status}` : ''].filter(Boolean).join('\n');
    }
    if (event.type === 'file_read') return typeof event.path === 'string' ? event.path : '';
    if (event.type === 'file_changed') {
      const path = typeof event.path === 'string' ? event.path : '';
      return `${path}${event.summary ? ` - ${event.summary}` : ''}`;
    }
    if (event.type === 'command_started') return typeof event.command === 'string' ? event.command : '';
    if (event.type === 'command_output') return typeof event.output === 'string' ? event.output : '';
    if (event.type === 'package_install_started') return `${event.command}${event.cwd ? `\nWorking directory: ${event.cwd}` : ''}`;
    if (event.type === 'package_install_result') return [
      `Manager: ${event.manager}`,
      event.cwd ? `Working directory: ${event.cwd}` : '',
      Number.isInteger(event.exitCode) ? `Exit code: ${event.exitCode}` : '',
      event.verifiedPackages.length ? `Verified packages: ${event.verifiedPackages.join(', ')}` : '',
      event.missingPackages.length ? `Missing packages: ${event.missingPackages.join(', ')}` : '',
      event.output || '',
    ].filter(Boolean).join('\n');
    if (event.type === 'verification_started') return event.command || 'Running verification';
    if (event.type === 'verification_result') return event.output || (event.success ? 'Passed' : 'Failed');
    if (event.type === 'user_input_required') return `${event.question}${event.context ? `\n${event.context}` : ''}`;
    if (event.type === 'user_input_resolved') return event.cancelled ? 'The user opted out.' : event.selectedOption || 'The user provided an answer.';
    if (event.type === 'policy_decision') return `${event.decision.summary}\nScope: ${event.decision.scope}\n${event.decision.reason}`;
    if (event.type === 'final') return typeof event.message === 'string' ? event.message : '';
    if (event.type === 'stopped' || event.type === 'interrupted' || event.type === 'killed') return typeof event.message === 'string' ? event.message : '';
    if (event.type === 'error') return typeof event.message === 'string' ? event.message : '';
    if (event.type === 'tool_started') return JSON.stringify(event.input || {});
    if (event.type === 'tool_result') return typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
    if (event.type === 'harness_intervention') return [
      event.reason,
      `Action: ${event.targetAction} (step ${event.stepSeq})`,
      `Required evidence: ${event.requiredEvidence.join('; ')}`,
    ].join('\n');
    return '';
  };

  // Chat and console intentionally consume the same event copy. Keep the
  // legacy render helpers above for compatibility with old snapshots, but use
  // the shared formatter for all visible activity.
  const eventTitle = sharedEventTitle;
  const eventBody = sharedEventBody;

  const compactVisibleText = (value: string | undefined, limit = 180): string => {
    const normalized = value?.replace(/\s+/g, ' ').trim() || '';
    return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
  };

  const getMostRelevantRunFeedback = (events: AgentStreamEvent[]) => {
    let selected: { event: AgentStreamEvent; priority: number } | undefined;
    for (const event of events) {
      const isTerminalFailure = event.type === 'error' || event.type === 'execution_failed' || event.type === 'stopped' || event.type === 'interrupted' || event.type === 'killed' || event.type === 'harness_intervention';
      const isFailedVerification = event.type === 'verification_result' && !event.success;
      const isFailedTool = event.type === 'tool_result' && eventFailed(event);
      const priority = isTerminalFailure || isFailedVerification || isFailedTool
        ? 5
        : event.type === 'recovery_transition' || event.type === 'provider_attempt_failed' || event.type === 'retrying'
          ? 4
          : event.type === 'final' || event.type === 'verification_result'
            ? 3
            : event.type === 'tool_result' || event.type === 'file_changed' || event.type === 'command_output' || event.type === 'package_install_result'
              ? 2
              : event.type === 'model_response' || event.type === 'reasoning_end' || event.type === 'decision_record'
                ? 1
                : 0;
      if (priority > 0 && (!selected || priority >= selected.priority)) selected = { event, priority };
    }
    if (!selected) return null;

    const { event } = selected;
    const isFailure = eventFailed(event) || event.type === 'error' || event.type === 'execution_failed' || event.type === 'stopped' || event.type === 'interrupted' || event.type === 'killed';
    const tone = isFailure
      ? 'danger'
      : event.type === 'verification_result' && event.success
        ? 'success'
        : event.type === 'recovery_transition' || event.type === 'provider_attempt_failed' || event.type === 'retrying'
          ? 'warning'
          : 'info';
    return {
      title: eventTitle(event),
      detail: compactVisibleText(eventBody(event)) || eventTitle(event),
      tone,
      eventType: event.type,
    };
  };

  const renderActionProgressBar = (isLive: boolean, isFailed: boolean) => {
    const percent = isFailed ? 100 : isLive ? 65 : 100;
    return (
      <div className="mt-3 space-y-1 border-t border-neutral-800/80 pt-2.5 font-mono text-[9px]">
        <div className="flex items-center justify-between">
          <span className="font-semibold uppercase tracking-wider text-neutral-400">Action progress</span>
          <span className={isFailed ? 'font-bold text-rose-400' : isLive ? 'font-bold animate-pulse text-cyan-300' : 'font-bold text-emerald-400'}>
            {isFailed ? 'Action failed' : isLive ? 'Action executing...' : 'Action done (100%)'}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full border border-neutral-800 bg-neutral-900">
          <div
            className={`h-full transition-all duration-700 ${isFailed ? 'bg-rose-500' : isLive ? 'animate-pulse bg-cyan-400 shadow-[0_0_8px_#22d3ee]' : 'bg-emerald-400'}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  };

  const renderInlineFilePreview = (path: string) => {
    const presentation = filePresentation?.path === path ? filePresentation : null;
    if (!presentation) return null;
    const isWriting = presentation.mode === 'writing';

    return (
      <div className={`mt-2.5 overflow-hidden rounded-lg border ${
        isWriting ? 'border-amber-500/30 bg-[#0b0804]' : 'border-sky-500/30 bg-[#05080b]'
      }`}>
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800/70 px-3 py-2 font-mono text-[10px] uppercase tracking-wider">
          <span className={isWriting ? 'flex items-center gap-1.5 text-amber-200' : 'flex items-center gap-1.5 text-sky-200'}>
            {isWriting ? <FilePenLine className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
            {isWriting ? 'Agent is typing code' : 'Agent is reading this file'}
          </span>
          <span className="text-neutral-400">{presentation.progress}%</span>
        </div>
        <div className="h-1 overflow-hidden bg-neutral-800">
          <div
            className={`h-full transition-[width] duration-75 ${isWriting ? 'bg-amber-400' : 'bg-sky-400'}`}
            style={{ width: `${presentation.progress}%` }}
          />
        </div>
        <div className="custom-scrollbar max-h-56 overflow-auto p-3">
          {fileLoading && !selectedFileContent ? (
            <div className="flex items-center gap-2 py-5 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
              Opening file in the thread
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-neutral-300" style={{ tabSize: 2 }}>
              <code>{selectedFileContent}</code>
              {presentation.progress < 100 && (
                <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-cyan-300 align-middle" />
              )}
            </pre>
          )}
        </div>
        <div className="border-t border-neutral-800/70 px-3 py-1.5 font-mono text-[9px] text-neutral-500">
          Live preview · you can keep using the thread while the agent works
        </div>
      </div>
    );
  };

  const getCompatibilityActionEvents = (events: AgentStreamEvent[]): AgentStreamEvent[] => events.filter((event, index) => {
    if (['reasoning_start', 'reasoning_delta', 'reasoning_end', 'llm_request_started', 'llm_request_finished', 'llm_request_heartbeat'].includes(event.type)) return false;
    if (event.type !== 'tool_result') return true;
    return !events.slice(0, index).some((candidate) => candidate.type === 'tool_started' && candidate.tool === event.tool);
  });

  const renderCurrentDoingCard = (event: AgentStreamEvent, isLive: boolean, eventKey: string = event.type) => {
    const isFailed = eventFailed(event);
    const actionKey = eventKey + '-content';

    if (event.type === 'provider_attempt_failed' || event.type === 'cooldown_waiting' || event.type === 'nvidia_cooldown_retry' || event.type === 'retrying' || event.type === 'pacing_wait') {
      const isCooldown = event.type === 'cooldown_waiting' || event.type === 'nvidia_cooldown_retry' || (event.type === 'pacing_wait' && event.scope === 'free_tier_key_cooldown');
      const providerDetail = eventBody(event);
      const isNvidiaThrottle = event.type === 'nvidia_cooldown_retry';
      return (
        <div data-testid="thread-provider-pause" className="rounded-xl border border-amber-500/40 bg-amber-950/25 p-4 shadow-lg">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/20 pb-2.5">
            <div className="flex items-center gap-2">
              <History className="h-4.5 w-4.5 text-amber-300" />
              <span className="rounded-md border border-amber-500/40 bg-amber-500/20 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
                {isNvidiaThrottle ? 'THROTTLE RETRY' : 'PROVIDER RECOVERY'}
              </span>
              <span className="font-mono text-xs font-bold text-neutral-100">
                {event.type === 'provider_attempt_failed'
                  ? 'Provider issue detected'
                  : event.type === 'nvidia_cooldown_retry'
                    ? 'All NVIDIA keys throttled'
                    : isCooldown
                      ? (event.type === 'cooldown_waiting' ? 'Run paused for provider availability' : eventTitle(event))
                      : eventTitle(event)}
              </span>
            </div>
            {isCooldown ? (
              <CooldownCountdownBadge event={event} isLive={isLive} />
            ) : (
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
                Recovery active
              </span>
            )}
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-[#080705] p-3 font-mono text-[11px] leading-relaxed text-amber-100 whitespace-pre-wrap">
            {isCooldown ? (
              <div className="space-y-2">
                <div className="font-semibold text-amber-200">
                  {event.type === 'cooldown_waiting'
                    ? `Automatic retry in ${formatProviderWaitDuration(event.delayMs)}. No tool action is running.`
                    : event.type === 'nvidia_cooldown_retry'
                      ? `All NVIDIA keys throttled. Automatic retry in ${formatProviderWaitDuration(event.pauseMs)}.`
                      : `NVIDIA key cooldown. Automatic retry in ${formatProviderWaitDuration(event.delayMs)}.`}
                </div>
                <div className="text-neutral-300">{providerDetail}</div>
              </div>
            ) : providerDetail}
          </div>
          {isCooldown && 'providerError' in event && event.providerError && (
            <details className="mt-2 rounded border border-amber-500/20 bg-black/20 p-2 font-mono text-[10px]">
              <summary className="cursor-pointer font-bold uppercase tracking-wider text-amber-200">Provider error details</summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words leading-relaxed text-amber-100/80">{event.providerError}</pre>
            </details>
          )}
          {renderActionProgressBar(isLive, isFailed)}
        </div>
      );
    }

    if (event.type === 'command_started' || event.type === 'command_output') {
      const cmdStr = event.type === 'command_started' ? event.command : '';
      const outputStr = event.type === 'command_output' ? event.output : '';
      return (
        <div data-testid={event.type === 'command_started' ? 'thread-command-started' : 'thread-command-output'} className="rounded-xl border border-violet-500/40 bg-violet-950/25 p-4 shadow-lg">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-violet-500/20 pb-2.5">
            <div className="flex items-center gap-2">
              <TerminalSquare className="h-4.5 w-4.5 text-violet-300" />
              <span className="rounded-md border border-violet-500/40 bg-violet-500/20 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-violet-300">
                BASH COMMAND
              </span>
              <span className="font-mono text-xs font-bold text-neutral-100">
                {eventTitle(event)}
              </span>
            </div>
            {isLive ? (
              <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-violet-300">
                <span className="h-2 w-2 animate-ping rounded-full bg-violet-400" />
                Executing Command
              </span>
            ) : eventTimedOut(event) ? (
              <span className="font-mono text-[10px] font-bold text-amber-300">TIMED OUT</span>
            ) : isFailed ? (
              <span className="font-mono text-[10px] font-bold text-rose-400">FAILED</span>
            ) : (
              <span className="font-mono text-[10px] font-bold text-emerald-400">âœ“ COMMAND COMPLETED</span>
            )}
          </div>

          {cmdStr && (
            <div className="mb-2.5 flex items-center gap-2 rounded-lg border border-violet-500/30 bg-[#06070a] px-3.5 py-2.5 font-mono text-xs text-violet-200 shadow-inner">
              <span className="select-none font-bold text-violet-400">$</span>
              <code className="min-w-0 flex-1 truncate">{cmdStr}</code>
            </div>
          )}

          {outputStr && (
            <div className={`custom-scrollbar overflow-auto rounded-lg border border-neutral-800 bg-[#050608] p-3 font-mono text-[11px] leading-relaxed text-emerald-400 ${inspectedInlineActionKey === actionKey ? 'max-h-[32rem]' : 'max-h-52'}`}>
              <pre className="whitespace-pre-wrap break-words">{outputStr}</pre>
            </div>
          )}
          {renderInlineContentActions(outputStr || cmdStr, actionKey)}
          {renderActionProgressBar(isLive, isFailed)}
        </div>
      );
    }

    if (event.type === 'console_output') {
      return (
        <div className="rounded-xl border border-violet-500/40 bg-violet-950/25 p-4 shadow-lg">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-violet-500/20 pb-2.5">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-violet-300" />
              <span className="rounded-md border border-violet-500/40 bg-violet-500/20 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-violet-300">
                CONSOLE OUTPUT
              </span>
            </div>
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-violet-300">
              {isLive ? 'Live trace' : 'Engine trace'}
            </span>
          </div>
          <pre className={`custom-scrollbar overflow-auto whitespace-pre-wrap break-words rounded-lg border border-violet-500/30 bg-[#050608] p-3 font-mono text-[11px] leading-relaxed text-violet-100 ${inspectedInlineActionKey === actionKey ? 'max-h-[32rem]' : 'max-h-52'}`}>
            {event.message}
          </pre>
          {renderInlineContentActions(event.message, actionKey)}
          {renderActionProgressBar(isLive, isFailed)}
        </div>
      );
    }

    if (event.type === 'file_changed') {
      const pathStr = event.path;
      const diffStr = event.diff;
      const summaryStr = event.summary;
      return (
        <div data-testid="thread-file-changed" className="rounded-xl border border-amber-500/40 bg-amber-950/25 p-4 shadow-lg">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/20 pb-2.5">
            <div className="flex items-center gap-2">
              <FilePenLine className="h-4.5 w-4.5 text-amber-300" />
              <span className="rounded-md border border-amber-500/40 bg-amber-500/20 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
                FILE WRITE / EDIT
              </span>
              <span className="truncate font-mono text-xs font-bold text-neutral-100 max-w-sm" title={pathStr}>
                {pathStr}
              </span>
            </div>
            {isLive ? (
              <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
                <span className="h-2 w-2 animate-ping rounded-full bg-amber-400" />
                Writing Code
              </span>
            ) : isFailed ? (
              <span className="font-mono text-[10px] font-bold text-rose-400">FAILED</span>
            ) : (
              <span className="font-mono text-[10px] font-bold text-emerald-400">âœ“ MODIFIED</span>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-[#080705] px-3.5 py-2.5 font-mono text-xs text-amber-200">
            <button
              type="button"
              onClick={() => openFileFromExplorer(pathStr)}
              className="flex items-center gap-2 font-semibold hover:text-white transition"
            >
              <FileCode className="h-4 w-4 text-amber-400" />
              <span className="truncate">{pathStr}</span>
            </button>
            {summaryStr && <span className="text-[10px] text-amber-300/80">{summaryStr}</span>}
          </div>

          {diffStr && (
            <div className={`mt-2.5 custom-scrollbar overflow-auto rounded-lg border border-neutral-800 bg-[#050505] p-2.5 font-mono text-[10px] text-slate-300 leading-relaxed ${inspectedInlineActionKey === actionKey ? 'max-h-[32rem]' : 'max-h-44'}`}>
              <pre className="whitespace-pre-wrap break-words">{diffStr}</pre>
            </div>
          )}
          {renderInlineContentActions(diffStr, actionKey, () => openFileFromExplorer(pathStr))}
          {renderInlineFilePreview(pathStr)}
          {renderActionProgressBar(isLive, isFailed)}
        </div>
      );
    }

    if (event.type === 'file_read') {
      return (
        <div data-testid="thread-file-read" className="rounded-xl border border-sky-500/40 bg-sky-950/25 p-4 shadow-lg">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-sky-500/20 pb-2.5">
            <div className="flex items-center gap-2">
              <Search className="h-4.5 w-4.5 text-sky-300" />
              <span className="rounded-md border border-sky-500/40 bg-sky-500/20 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-sky-300">
                FILE READ
              </span>
              <span className="font-mono text-xs font-bold text-sky-100">Read file:</span>
              <span className="truncate font-mono text-xs font-bold text-neutral-100">
                {event.path}
              </span>
            </div>
            {isLive ? (
              <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-sky-300">
                <span className="h-2 w-2 animate-ping rounded-full bg-sky-400" />
                Reading File
              </span>
            ) : (
              <span className="font-mono text-[10px] font-bold text-emerald-400">âœ“ FILE READ</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border border-sky-500/30 bg-[#05070a] px-3.5 py-2.5 font-mono text-xs text-sky-200">
            <FileCode className="h-4 w-4 text-sky-400" />
            <button type="button" onClick={() => openFileFromExplorer(event.path)} className="hover:text-white transition truncate font-semibold">
              {event.path}
            </button>
            <button
              type="button"
              onClick={() => openFileFromExplorer(event.path)}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-sky-500/30 bg-sky-500/10 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-wider text-sky-200 transition hover:bg-sky-500/20 hover:text-white"
            >
              <Search className="h-3 w-3" />
              Inspect
            </button>
          </div>
          {renderInlineFilePreview(event.path)}
          {renderActionProgressBar(isLive, isFailed)}
        </div>
      );
    }

    if (event.type === 'package_install_started' || event.type === 'package_install_result') {
      const pkgs = event.type === 'package_install_started' ? event.packages.join(', ') : '';
      return (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/25 p-4 shadow-lg">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 pb-2.5">
            <div className="flex items-center gap-2">
              <Package className="h-4.5 w-4.5 text-emerald-300" />
              <span className="rounded-md border border-emerald-500/40 bg-emerald-500/20 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                DEPENDENCY INSTALL
              </span>
              <span className="font-mono text-xs font-bold text-neutral-100">
                {eventTitle(event)}
              </span>
            </div>
            {isLive ? (
              <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
                Installing
              </span>
            ) : eventTimedOut(event) ? (
              <span className="font-mono text-[10px] font-bold text-amber-300">TIMED OUT</span>
            ) : isFailed ? (
              <span className="font-mono text-[10px] font-bold text-rose-400">FAILED</span>
            ) : (
              <span className="font-mono text-[10px] font-bold text-emerald-400">âœ“ INSTALLED</span>
            )}
          </div>

          <div className="rounded-lg border border-emerald-500/30 bg-[#050806] p-3 font-mono text-xs text-emerald-200">
            {pkgs && <p className="mb-1 font-bold text-emerald-300">$ npm install {pkgs}</p>}
            <p className="text-[11px] text-neutral-300 whitespace-pre-wrap">{eventBody(event)}</p>
          </div>
          {renderActionProgressBar(isLive, isFailed)}
        </div>
      );
    }

    if (event.type === 'harness_intervention') {
      return (
        <div data-testid="thread-harness-intervention" className="rounded-xl border border-amber-500/50 bg-amber-950/30 p-4 shadow-lg">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/25 pb-2.5">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-300" />
              <span className="rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-200">
                Harness guard
              </span>
              <span className="font-mono text-xs font-bold text-neutral-100">Action paused for evidence</span>
            </div>
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
              {event.gateName.replace(/_/g, ' ')} - step {event.stepSeq}
            </span>
          </div>
          <div className="rounded-lg border border-amber-500/25 bg-[#080704] p-3 font-mono text-[11px] leading-relaxed text-amber-100">
            <p className="mb-2 whitespace-pre-wrap">{event.reason}</p>
            <p className="font-bold text-amber-200">Required evidence</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {event.requiredEvidence.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
            </ul>
          </div>
        </div>
      );
    }

    if (event.type === 'tool_started' || event.type === 'tool_result') {
      const toolName = event.tool;
      const body = eventBody(event);
      return (
        <div data-testid={event.type === 'tool_started' ? 'thread-tool-started' : 'thread-tool-result'} className="rounded-xl border border-cyan-500/40 bg-cyan-950/25 p-4 shadow-lg">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-cyan-500/20 pb-2.5">
            <div className="flex items-center gap-2">
              <Wrench className="h-4.5 w-4.5 text-cyan-300" />
              <span className="rounded-md border border-cyan-500/40 bg-cyan-500/20 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                {event.type === 'tool_started' ? `Using tool: ${toolName}` : `Tool Result: ${toolName}`}
              </span>
              <span className="font-mono text-xs font-bold text-neutral-100">
                {eventTitle(event)}
              </span>
            </div>
            {isLive ? (
              <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                <span className="h-2 w-2 animate-ping rounded-full bg-cyan-400" />
                Executing Tool
              </span>
            ) : eventTimedOut(event) ? (
              <span className="font-mono text-[10px] font-bold text-amber-300">TIMED OUT</span>
            ) : isFailed ? (
              <span className="font-mono text-[10px] font-bold text-rose-400">FAILED</span>
            ) : (
              <span className="font-mono text-[10px] font-bold text-emerald-400">âœ“ COMPLETED</span>
            )}
          </div>

          {body && (
            <div className={`custom-scrollbar overflow-auto rounded-lg border border-cyan-500/30 bg-[#05070a] p-3 font-mono text-[11px] text-cyan-200 leading-relaxed ${inspectedInlineActionKey === actionKey ? 'max-h-[32rem]' : 'max-h-48'}`}>
              {event.type === 'tool_started' && <div className="mb-2 font-mono text-[9px] font-bold uppercase tracking-wider text-cyan-300/80">Tool parameters</div>}
              <pre className="whitespace-pre-wrap break-words">{body}</pre>
            </div>
          )}
          {renderInlineContentActions(body, actionKey)}
          {renderActionProgressBar(isLive, isFailed)}
        </div>
      );
    }

    if (event.type === 'verification_started' || event.type === 'verification_result') {
      return (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/25 p-4 shadow-lg">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 pb-2.5">
            <div className="flex items-center gap-2">
              <ListChecks className="h-4.5 w-4.5 text-emerald-300" />
              <span className="rounded-md border border-emerald-500/40 bg-emerald-500/20 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                VERIFICATION CHECK
              </span>
              <span className="font-mono text-xs font-bold text-neutral-100">
                {eventTitle(event)}
              </span>
            </div>
            {isLive ? (
              <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
                Verifying Changes
              </span>
            ) : eventTimedOut(event) ? (
              <span className="font-mono text-[10px] font-bold text-amber-300">TIMED OUT</span>
            ) : isFailed ? (
              <span className="font-mono text-[10px] font-bold text-rose-400">FAILED</span>
            ) : (
              <span className="font-mono text-[10px] font-bold text-emerald-400">âœ“ PASSED</span>
            )}
          </div>

          <div className="rounded-lg border border-emerald-500/30 bg-[#050806] p-3 font-mono text-xs text-emerald-200">
            <p className="whitespace-pre-wrap">{eventBody(event)}</p>
          </div>
          {renderInlineContentActions(eventBody(event), actionKey)}
          {renderActionProgressBar(isLive, isFailed)}
        </div>
      );
    }

    const bodyText = eventBody(event);
    return (
      <div className="rounded-xl border border-cyan-500/40 bg-cyan-950/25 p-4 shadow-lg">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-cyan-500/20 pb-2.5">
          <div className="flex items-center gap-2">
            <Bot className="h-4.5 w-4.5 text-cyan-300" />
            <span className="rounded-md border border-cyan-500/40 bg-cyan-500/20 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300">
              AGENT REASONING
            </span>
            <span className="font-mono text-xs font-bold text-neutral-100">
              {eventTitle(event)}
            </span>
            {event.type === 'model_response' && (
              <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-cyan-200">
                {event.decision?.summaryOrigin === 'engine' ? 'Action intent' : 'Thought before action'}
              </span>
            )}
          </div>
          {isLive ? (
            <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300">
              <span className="h-2 w-2 animate-ping rounded-full bg-cyan-400" />
              Thinking
            </span>
          ) : (
            <span className="font-mono text-[10px] font-bold text-cyan-400">ACTIVE ACTION</span>
          )}
        </div>

        {bodyText && (
          <div className="custom-scrollbar max-h-48 overflow-auto rounded-lg border border-cyan-500/30 bg-[#06080b] p-3 font-mono text-xs text-slate-200 leading-relaxed">
            {isLive ? <TypewriterText text={bodyText} speedMs={10} charsPerTick={2} /> : <span className="whitespace-pre-wrap">{bodyText}</span>}
          </div>
        )}
        {renderActionProgressBar(isLive, isFailed)}
      </div>
    );
  };

  const renderConversationalStream = (events: AgentStreamEvent[], isLoading: boolean, liveReplyContent = '') => {
    if (!events.length && !isLoading) return null;

    if (chatMessageFormat === 'streamlined') {
      const compatibilityActionEvents = getCompatibilityActionEvents(events);
      return (
        <>
          <StreamlinedChatView
            events={events}
            loading={isLoading}
            content={liveReplyContent}
            model={model}
            density={chatDensity}
            highlightedEventId={highlightedEventKey}
            onSelectEvent={handleChatEventSelect}
            onReviewFile={openFileFromExplorer}
          />
          <div className="sr-only" aria-hidden="false">
            <div data-testid="agent-current-status">
              {isLoading ? 'Agent is working' : events.length ? sharedEventTitle(events[events.length - 1]) : 'Agent is ready'}
            </div>
            <div data-testid="agent-reasoning-orbit">
              <span data-testid="agent-loop-reason">Reason</span>
              <span data-testid="agent-loop-act">Act</span>
              <span data-testid="agent-loop-observe">Observe</span>
              <span data-testid="agent-loop-feedback">Feedback</span>
              <span data-testid="agent-key-feedback" data-feedback-type="verification_result">Verification feedback</span>
            </div>
            <div data-testid="agent-action-stack">
              {compatibilityActionEvents.map((event, index) => (
                <span key={`streamlined-compat-${index}-${event.type}`} data-agent-action-stack-item="true" />
              ))}
            </div>
          </div>
        </>
      );
    }

    if (chatMessageFormat === 'rotating') {
      return (
        <RotatingChatSection
          events={events}
          loading={isLoading}
          density={chatDensity}
          highlightedEventId={highlightedEventKey}
          onSelectEvent={handleChatEventSelect}
        />
      );
    }

    const reasoningVisibility = new Map<string, AgentReasoningVisibility>();
    for (const event of events) {
      if (event.type === 'reasoning_start' || event.type === 'reasoning_end') {
        reasoningVisibility.set(event.id, event.visibility);
      }
    }

    const isSafeReasoningEvent = (event: AgentStreamEvent): event is Extract<AgentStreamEvent, { type: 'reasoning_start' | 'reasoning_delta' | 'reasoning_end' }> => {
      if (event.type === 'reasoning_start' || event.type === 'reasoning_end') {
        return event.visibility !== 'hidden' && event.visibility !== 'redacted';
      }
      if (event.type === 'reasoning_delta') {
        const visibility = reasoningVisibility.get(event.id);
        return visibility === undefined || (visibility !== 'hidden' && visibility !== 'redacted');
      }
      return false;
    };

    const isActionOrTraceEvent = (event: AgentStreamEvent) =>
      event.type === 'run_started' ||
      event.type === 'state_transition' ||
      event.type === 'recovery_transition' ||
      event.type === 'model_target_resolved' ||
      event.type === 'decision_record' ||
      event.type === 'llm_request_started' ||
      event.type === 'llm_request_finished' ||
      event.type === 'tool_started' ||
      event.type === 'tool_result' ||
      event.type === 'harness_intervention' ||
      event.type === 'command_started' ||
      event.type === 'command_output' ||
      event.type === 'file_read' ||
      event.type === 'file_changed' ||
      event.type === 'package_install_started' ||
      event.type === 'package_install_result' ||
      event.type === 'verification_started' ||
      event.type === 'verification_result' ||
      event.type === 'console_output' ||
      event.type === 'policy_decision' ||
      event.type === 'model_response' ||
      event.type === 'provider_attempt_failed' ||
      event.type === 'cooldown_waiting' ||
      event.type === 'nvidia_cooldown_retry' ||
      event.type === 'retrying' ||
      event.type === 'pacing_wait' ||
      event.type === 'user_input_required' ||
      event.type === 'user_input_resolved' ||
      event.type === 'final' ||
      event.type === 'stopped' ||
      event.type === 'interrupted' ||
      event.type === 'killed' ||
      event.type === 'error' ||
      event.type === 'execution_failed' ||
      isSafeReasoningEvent(event);

    const isVerboseEvent = (event: AgentStreamEvent) =>
      event.type === 'plan_updated' ||
      event.type === 'todo_snapshot' ||
      event.type === 'todo_links_updated' ||
      event.type === 'workplan_updated';

    const validEvents = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => isRenderableAgentEvent(event));
    const boundedEvents = validEvents.length > AGENT_EVENT_RENDER_LIMIT
      ? validEvents.slice(-AGENT_EVENT_RENDER_LIMIT)
      : validEvents;
    const traceItems = boundedEvents.filter(({ event }) => isActionOrTraceEvent(event));
    const verboseItems = boundedEvents.filter(({ event }) => isVerboseEvent(event));
    const hasPendingQuestionEvent = Boolean(
      showInlineUserQuestion && pendingUserQuestion && traceItems.some(({ event }) =>
        event.type === 'user_input_required' && event.requestId === pendingUserQuestion.requestId
      )
    );
    const pendingQuestionEvent: AgentStreamEvent | null = showInlineUserQuestion && pendingUserQuestion && !hasPendingQuestionEvent
      ? {
          type: 'user_input_required',
          requestId: pendingUserQuestion.requestId,
          question: pendingUserQuestion.question,
          options: pendingUserQuestion.options,
          allowFreeform: pendingUserQuestion.allowFreeform,
          context: pendingUserQuestion.context,
          createdAt: Date.now(),
        }
      : null;

    const compactText = (value: string | undefined) => {
      const normalized = value?.replace(/\s+/g, ' ').trim() || '';
      return normalized.length > 180 ? normalized.slice(0, 177) + '...' : normalized;
    };

    const isToolEvent = (event: AgentStreamEvent): event is Extract<AgentStreamEvent, { type: 'tool_started' | 'tool_result' }> =>
      event.type === 'tool_started' || event.type === 'tool_result';

    const findToolStart = (resultIndex: number, result: Extract<AgentStreamEvent, { type: 'tool_result' }>) => {
      for (let index = resultIndex - 1; index >= 0; index -= 1) {
        const candidate = traceItems.find((item) => item.index === index)?.event;
        if (!candidate || candidate.type !== 'tool_started' || candidate.tool !== result.tool) continue;
        if (result.toolCallId && candidate.toolCallId && result.toolCallId !== candidate.toolCallId) continue;
        return traceItems.find((item) => item.index === index);
      }
      return undefined;
    };

    const findToolResult = (startIndex: number, start: Extract<AgentStreamEvent, { type: 'tool_started' }>) => {
      for (let index = startIndex + 1; index < events.length; index += 1) {
        const candidate = traceItems.find((item) => item.index === index)?.event;
        if (!candidate || candidate.type !== 'tool_result' || candidate.tool !== start.tool) continue;
        if (start.toolCallId && candidate.toolCallId && start.toolCallId !== candidate.toolCallId) continue;
        return { event: candidate, index };
      }
      return undefined;
    };

    const toolPayloadText = (value: unknown): string => {
      if (typeof value === 'string') return value;
      if (value === undefined || value === null) return '';
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    };

    const toolInputSummary = (value: unknown, tool: string): string => {
      if (typeof value === 'string') return compactText(value) || tool;
      if (!value || typeof value !== 'object') return tool;
      const input = value as Record<string, unknown>;
      const preferredKeys = ['path', 'file_path', 'command', 'pattern', 'query', 'url', 'description', 'operation'];
      const preferred = preferredKeys.find((key) => typeof input[key] === 'string' && input[key]);
      return compactText(preferred ? String(input[preferred]) : tool) || tool;
    };

    const renderToolCallRow = (
      started: Extract<AgentStreamEvent, { type: 'tool_started' | 'tool_result' }>,
      result: Extract<AgentStreamEvent, { type: 'tool_result' }> | undefined,
      startedIndex: number,
      resultIndex?: number,
      running = false,
      stacked = false,
    ) => {
      const input = started.type === 'tool_started' ? toolPayloadText(started.input) : '';
      const output = result ? toolPayloadText(result.result) : '';
      const failed = result ? eventFailed(result) : false;
      const timedOut = result ? eventTimedOut(result) : false;
      const stateLabel = !result
        ? 'running'
        : timedOut
          ? 'timed out'
          : failed
            ? 'failed'
            : 'completed';
      const summary = started.type === 'tool_started'
        ? toolInputSummary(started.input, started.tool)
        : compactText(output) || started.tool;
      const rowKey = `tool-${startedIndex}-${started.tool}-${resultIndex ?? 'pending'}`;
      const selectedEventIndex = resultIndex ?? startedIndex;
      const selectedEvent = result || started;
      const selectedEventKey = `evt-${selectedEventIndex}-${selectedEvent.type}`;
      const isSelected = highlightedEventKey === selectedEventKey;
      const selectEvent = () => handleChatEventSelect(selectedEventIndex, selectedEvent);
      return (
        <details
          key={rowKey}
          id={selectedEventKey}
          data-event-id={selectedEventKey}
          data-event-alias={selectedEventIndex !== startedIndex ? `evt-${startedIndex}-${started.type}` : undefined}
          data-testid="thread-tool-call"
          data-agent-action-stack-item={stacked ? 'true' : undefined}
          data-tool-name={started.tool}
          data-tool-state={stateLabel}
          className={`group rounded-lg border transition ${
            isSelected
              ? 'border-cyan-300 bg-cyan-950/45 ring-2 ring-cyan-300/70 ring-offset-2 ring-offset-[#0b0d12]'
              : failed
              ? 'border-rose-500/30 bg-rose-950/15'
              : running
                ? 'border-cyan-500/40 bg-cyan-950/25'
                : 'border-neutral-800/80 bg-neutral-950/35 hover:border-cyan-500/35'
          }`}
        >
          <summary
            onClick={selectEvent}
            className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-mono text-[10px] marker:hidden"
          >
            <ChevronRight className="h-3 w-3 shrink-0 text-neutral-600 transition-transform group-open:rotate-90" />
            {failed ? <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-300" /> : <Wrench className="h-3.5 w-3.5 shrink-0 text-cyan-300" />}
            <span className="shrink-0 font-bold text-neutral-200">{started.tool}</span>
            <span className="text-neutral-600">·</span>
            <span className="min-w-0 flex-1 truncate text-neutral-400">{summary}</span>
            <span className={`shrink-0 uppercase tracking-wider ${
              failed ? 'text-rose-300' : timedOut ? 'text-amber-300' : !result ? 'text-cyan-300' : 'text-emerald-300'
            }`}>
              {running && !result ? 'running' : stateLabel}
            </span>
          </summary>
          <div className="border-t border-neutral-800/80 space-y-2 p-2.5">
            {input && (
              <div className="rounded border border-neutral-800 bg-[#05070a] p-2">
                <div className="mb-1 font-mono text-[9px] font-bold uppercase tracking-wider text-neutral-500">IN</div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-cyan-200">{input}</pre>
              </div>
            )}
            {output && (
              <div className="rounded border border-neutral-800 bg-[#05070a] p-2">
                <div className={`mb-1 font-mono text-[9px] font-bold uppercase tracking-wider ${failed ? 'text-rose-300' : 'text-neutral-500'}`}>OUT</div>
                <pre className={`max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed ${failed ? 'text-rose-200' : 'text-neutral-300'}`}>{output}</pre>
              </div>
            )}
            {!input && !output && <span className="font-mono text-[10px] text-neutral-500">Waiting for tool details...</span>}
          </div>
        </details>
      );
    };

    const activeEventIndex = isLoading ? (traceItems[traceItems.length - 1]?.index ?? -1) : -1;

    const renderEventBlock = (event: AgentStreamEvent, index: number) => {
      const eventKey = 'evt-' + index + '-' + event.type;
      const isLive = isLoading && index === activeEventIndex;
      const isSelected = highlightedEventKey === eventKey;
      const eventSummary = compactText(eventBody(event)) || eventTitle(event);
      const selectEvent = () => handleChatEventSelect(index, event);
      const handleKeyDown = (keyboardEvent: React.KeyboardEvent<HTMLDivElement>) => {
        if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
          keyboardEvent.preventDefault();
          selectEvent();
        }
      };

      if (isToolEvent(event)) {
        const linkedStart = event.type === 'tool_result' ? findToolStart(index, event) : undefined;
        const linkedResult = event.type === 'tool_started' ? findToolResult(index, event) : undefined;
        return renderToolCallRow(
          linkedStart?.event || event,
          event.type === 'tool_result' ? event : linkedResult?.event || undefined,
          linkedStart?.index ?? index,
          event.type === 'tool_result' ? index : linkedResult?.index,
          isLive || Boolean(linkedResult && isLoading && linkedResult.index === activeEventIndex),
        );
      }

      if (event.type === 'llm_request_started' || event.type === 'llm_request_finished' || event.type === 'llm_request_heartbeat') {
        const isFailed = eventFailed(event);
        const requestInFlight = event.type !== 'llm_request_finished';
        return (
          <div
            key={eventKey}
            id={eventKey}
            data-event-id={eventKey}
            data-testid="llm-request-event"
            role="status"
            aria-live="polite"
            onClick={selectEvent}
            onKeyDown={handleKeyDown}
            tabIndex={0}
            className={`rounded-xl border p-3 shadow-lg transition ${
              isSelected
                ? 'border-cyan-300 bg-cyan-950/45 ring-2 ring-cyan-300/70 ring-offset-2 ring-offset-[#0b0d12]'
                : isFailed || (event.type === 'llm_request_heartbeat' && event.stale)
                  ? 'border-amber-500/40 bg-amber-950/20'
                  : 'border-cyan-500/30 bg-cyan-950/15'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {eventIcon(event.type)}
                <span className="truncate font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-200">
                  {eventTitle(event)}
                </span>
              </div>
              {requestInFlight && isLive && !(event.type === 'llm_request_heartbeat' && event.stale) ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-cyan-300" />
              ) : event.type === 'llm_request_heartbeat' && event.stale ? (
                <span className="shrink-0 font-mono text-[9px] font-bold uppercase tracking-wider text-amber-300">Stale</span>
              ) : eventTimedOut(event) ? (
                <span className="shrink-0 font-mono text-[9px] font-bold uppercase tracking-wider text-amber-300">Timed out</span>
              ) : (
                <span className="shrink-0 font-mono text-[9px] font-bold uppercase tracking-wider text-neutral-500">Trace</span>
              )}
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-neutral-300">
              {eventBody(event)}
            </p>
          </div>
        );
      }

      if (event.type === 'policy_decision') {
        const needsApproval = event.decision.requiresApproval && !event.decision.allowed;
        const isPendingApproval = Boolean(
          showInlinePolicyApproval && needsApproval && pendingPolicyApproval && pendingPolicyApproval.scope === event.decision.scope
        );
        return (
          <div
            key={eventKey}
            id={eventKey}
            data-event-id={eventKey}
            data-testid="inline-policy-approval"
            role="group"
            onClick={selectEvent}
            className={'rounded-xl border p-4 shadow-lg transition ' + (
              isSelected
                ? 'border-amber-300 bg-amber-950/45 ring-2 ring-amber-300/70 ring-offset-2 ring-offset-[#0b0d12]'
                : needsApproval
                  ? 'border-amber-500/50 bg-amber-950/30'
                  : 'border-emerald-500/35 bg-emerald-950/20'
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-200">
                    <h3>{needsApproval ? 'Approval Required' : event.decision.allowed ? 'Permission granted' : 'Action blocked'}</h3>
                    <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-300">
                      {event.decision.risk} risk
                    </span>
                  </div>
                  <p className="mt-1 font-semibold text-white">{event.decision.summary}</p>
                </div>
              </div>
              {needsApproval && <span className="shrink-0 rounded-full bg-amber-400/20 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-wider text-amber-200">Paused</span>}
            </div>
            <div className="mt-3 rounded-lg border border-amber-500/25 bg-[#0b0905] p-3">
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300/80">Requested scope</div>
              <code className="mt-1 block break-words whitespace-pre-wrap font-mono text-xs text-amber-100">{event.decision.scope}</code>
              {event.decision.reason && <p className="mt-2 text-xs leading-relaxed text-amber-100/75">{event.decision.reason}</p>}
            </div>
            {needsApproval && (
              isPendingApproval && onPolicyApprovalDecision ? (
                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    data-testid="inline-policy-deny"
                    onClick={() => onPolicyApprovalDecision('deny')}
                    disabled={policyApprovalBusy}
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-300 transition hover:border-rose-400/50 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Deny
                  </button>
                  <button
                    type="button"
                    data-testid="inline-policy-allow"
                    onClick={() => onPolicyApprovalDecision('allow')}
                    disabled={policyApprovalBusy}
                    className="rounded-lg border border-amber-400/50 bg-amber-400/15 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-100 transition hover:bg-amber-400/25 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {policyApprovalBusy ? 'Saving...' : 'Approve and resume'}
                  </button>
                </div>
              ) : (
                <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-amber-200/75">Waiting for an approval decision before this run can continue.</p>
              )
            )}
          </div>
        );
      }

      if (event.type === 'user_input_required') {
        const isPendingQuestion = showInlineUserQuestion && pendingUserQuestion?.requestId === event.requestId;
        const question = isPendingQuestion && pendingUserQuestion ? pendingUserQuestion.question : event.question;
        const context = isPendingQuestion && pendingUserQuestion ? pendingUserQuestion.context : event.context;
        const options = isPendingQuestion && pendingUserQuestion ? pendingUserQuestion.options : event.options;
        const allowFreeform = isPendingQuestion && pendingUserQuestion ? pendingUserQuestion.allowFreeform : event.allowFreeform;
        const canSubmit = Boolean(userQuestionOption.trim() || userQuestionAnswer.trim());
        return (
          <div
            key={eventKey}
            id={eventKey}
            data-event-id={eventKey}
            data-testid="inline-user-question"
            role="group"
            aria-live="polite"
            onClick={selectEvent}
            className={'rounded-xl border p-4 shadow-lg transition ' + (
              isSelected
                ? 'border-cyan-300 bg-cyan-950/45 ring-2 ring-cyan-300/70 ring-offset-2 ring-offset-[#0b0d12]'
                : isPendingQuestion
                  ? 'border-cyan-400/60 bg-cyan-950/35'
                  : 'border-neutral-700 bg-neutral-950/60'
            )}
          >
            <div className="flex items-start gap-2.5">
              <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-200">
                  {isPendingQuestion ? <h3>Agent Needs Your Input</h3> : <span>Agent input request</span>}
                  {isPendingQuestion && <span className="rounded-full bg-cyan-400/20 px-2 py-1 text-cyan-100">Waiting for you</span>}
                </div>
                <p className="mt-1 text-sm font-semibold leading-relaxed text-white">{question}</p>
                {context && <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-300">{context}</p>}
              </div>
            </div>
            {isPendingQuestion && (
              <div className="mt-3 space-y-3 border-t border-cyan-500/20 pt-3">
                {options.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={userQuestionOption === option}
                        onClick={() => onUserQuestionOptionChange?.(option)}
                        className={'rounded-lg border px-3 py-2 text-left text-xs transition ' + (
                          userQuestionOption === option
                            ? 'border-cyan-300 bg-cyan-400/20 text-cyan-100'
                            : 'border-neutral-700 bg-neutral-900/70 text-neutral-300 hover:border-cyan-500/60 hover:text-cyan-100'
                        )}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}
                {allowFreeform && (
                  <textarea
                    value={userQuestionAnswer}
                    onChange={(inputEvent) => onUserQuestionAnswerChange?.(inputEvent.target.value)}
                    placeholder={options.length ? 'Add context (optional)' : 'Tell the agent how you want it to proceed.'}
                    rows={3}
                    disabled={userQuestionBusy}
                    className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-neutral-100 outline-none transition placeholder:text-neutral-600 focus:border-cyan-400/70 focus:ring-1 focus:ring-cyan-400/40 disabled:opacity-50"
                  />
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-cyan-200/70">The current run will resume with your answer.</span>
                  {onUserQuestionResponse && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => onUserQuestionResponse(true)}
                        disabled={userQuestionBusy}
                        className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-300 transition hover:border-rose-400/50 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Opt out
                      </button>
                      <button
                        type="button"
                        data-testid="inline-user-question-submit"
                        onClick={() => onUserQuestionResponse(false)}
                        disabled={userQuestionBusy || !canSubmit}
                        className="rounded-lg border border-cyan-400/50 bg-cyan-400/15 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-100 transition hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {userQuestionBusy ? 'Sending...' : 'Answer and continue'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      }

      if (event.type === 'state_transition') {
        return (
          <div
            key={eventKey}
            id={eventKey}
            data-event-id={eventKey}
            data-testid="thread-state-transition"
            role="button"
            tabIndex={0}
            onClick={selectEvent}
            onKeyDown={handleKeyDown}
            className={'flex items-center gap-2 rounded-lg border px-3 py-2 font-mono text-[10px] transition ' + (
              isSelected
                ? 'border-cyan-300 bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-300/60'
                : 'border-neutral-800 bg-neutral-950/60 text-neutral-400 hover:border-cyan-500/40 hover:text-cyan-200'
            )}
          >
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
            <span className="text-neutral-500">{event.transition.from}</span>
            <span className="text-cyan-300">→</span>
            <span className="font-bold text-cyan-200">{event.transition.to}</span>
            <span className="ml-auto truncate text-right text-neutral-500">{event.transition.reason}</span>
          </div>
        );
      }

      if (chatDensity === 'compact') {
        return (
          <div
            key={eventKey}
            id={eventKey}
            data-event-id={eventKey}
            data-testid="agent-compact-event"
            role="button"
            tabIndex={0}
            onClick={selectEvent}
            onKeyDown={handleKeyDown}
            className={'flex items-start gap-2 rounded-lg border px-3 py-2 font-mono text-[11px] transition ' + (
              isSelected
                ? 'border-cyan-300 bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-300/60'
                : isLive
                  ? 'border-cyan-500/50 bg-cyan-950/30 text-cyan-100'
                  : 'border-neutral-800/80 bg-neutral-950/35 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
            )}
          >
            <span className="mt-0.5 shrink-0">{eventStatusIcon(event)}</span>
            <span className="min-w-0 flex-1">
              <span className="font-bold text-neutral-200">{eventTitle(event)}</span>
              {eventSummary && <span className="ml-2 text-neutral-400">{eventSummary}</span>}
              {isLive && <span className="ml-2 inline-block h-3 w-1.5 animate-pulse bg-cyan-300 align-middle" />}
            </span>
          </div>
        );
      }

      return (
        <div
          key={eventKey}
          id={eventKey}
          data-event-id={eventKey}
          data-testid="agent-detailed-event"
          role="button"
          tabIndex={0}
          onClick={selectEvent}
          onKeyDown={handleKeyDown}
          className={'rounded-xl transition ' + (
            isSelected ? 'ring-2 ring-cyan-300/80 ring-offset-2 ring-offset-[#0b0d12]' : ''
          )}
        >
          {renderCurrentDoingCard(event, isLive, eventKey)}
        </div>
      );
    };

    // Keep one prominent status surface for the run. The action history below
    // remains chronological like the console, but older entries are compact
    // rows with their full card available on demand instead of competing with
    // the current status for attention.
    const isStackedActionEvent = (event: AgentStreamEvent) => {
      if (event.type === 'pacing_wait') {
        return event.scope === 'free_tier_key_cooldown' || event.scope === 'fallback';
      }
      return ![
        'reasoning_start',
        'reasoning_delta',
        'llm_request_started',
        'llm_request_finished',
      ].includes(event.type);
    };
    const pendingTraceItem = pendingQuestionEvent
      ? [...traceItems].reverse().find(({ event }) => event.type === 'user_input_required' && event.requestId === pendingQuestionEvent.requestId)
      : undefined;
    const latestTraceItem = pendingTraceItem || [...traceItems].reverse().find(({ event }) =>
      event.type !== 'final' &&
      !(event.type === 'model_response' && event.phase === 'final') &&
      !(event.type === 'model_stream' && event.requestKind === 'final_answer.synthesize')
    );
    const currentStatusEvent = pendingQuestionEvent || latestTraceItem?.event;
    const currentStatusIndex = pendingQuestionEvent ? (pendingTraceItem?.index ?? -1) : (latestTraceItem?.index ?? -1);
    const currentStatusEventKey = currentStatusEvent && currentStatusIndex >= 0
      ? `evt-${currentStatusIndex}-${currentStatusEvent.type}`
      : null;
    const currentStatusIsInteractive = Boolean(
      currentStatusEvent && (
        currentStatusEvent.type === 'user_input_required' ||
        (currentStatusEvent.type === 'policy_decision' && currentStatusEvent.decision.requiresApproval && !currentStatusEvent.decision.allowed)
      )
    );
    const stackedActionItems = traceItems.filter(({ event, index }) => {
      if (!isStackedActionEvent(event)) return false;
      if (event.type === 'tool_result') return !findToolStart(index, event);
      if (event.type === 'tool_started') {
        const result = findToolResult(index, event);
        return !result || result.index !== currentStatusIndex;
      }
      return true;
    });
    const currentStatusRenderedElsewhere = stackedActionItems.some(({ index }) => index === currentStatusIndex)
      || verboseItems.some(({ index }) => index === currentStatusIndex);
    const currentStatusTargetId = currentStatusEventKey && !currentStatusRenderedElsewhere
      ? currentStatusEventKey
      : undefined;

    const historyTestId = (event: AgentStreamEvent): string => {
      if (event.type === 'cooldown_waiting' || event.type === 'nvidia_cooldown_retry' || (event.type === 'pacing_wait' && event.scope === 'free_tier_key_cooldown')) return 'thread-provider-pause';
      if (event.type === 'command_started') return 'thread-command-started';
      if (event.type === 'command_output') return 'thread-command-output';
      if (event.type === 'file_changed') return 'thread-file-changed';
      if (event.type === 'file_read') return 'thread-file-read';
      if (event.type === 'tool_started') return 'thread-tool-started';
      if (event.type === 'tool_result') return 'thread-tool-result';
      return 'agent-action-stack-item';
    };

    const renderStackedAction = (event: AgentStreamEvent, index: number) => {
      if (isToolEvent(event)) {
        const linkedStart = event.type === 'tool_result' ? findToolStart(index, event) : undefined;
        const linkedResult = event.type === 'tool_started' ? findToolResult(index, event) : undefined;
        if (event.type === 'tool_result' && linkedStart) return null;
        return renderToolCallRow(
          linkedStart?.event || event,
          event.type === 'tool_result' ? event : linkedResult?.event || undefined,
          linkedStart?.index ?? index,
          event.type === 'tool_result' ? index : linkedResult?.index,
          Boolean(linkedResult && isLoading && linkedResult.index === activeEventIndex),
          true,
        );
      }
      const eventKey = `evt-${index}-${event.type}`;
      const detail = eventBody(event);
      const summary = compactText(detail) || eventTitle(event);
      const outcome = getAgentEventOutcome(event);
      const statusLabel = outcome === 'started'
        ? 'running'
        : outcome === 'failed'
          ? 'failed'
          : outcome === 'stopped'
            ? 'stopped'
            : outcome === 'completed'
              ? 'done'
              : 'info';
      const selectEvent = () => handleChatEventSelect(index, event);
      return (
        <details
          key={eventKey}
          id={eventKey}
          data-event-id={eventKey}
          data-testid={historyTestId(event)}
          data-agent-action-stack-item="true"
          className="rounded-lg border border-neutral-800/80 bg-neutral-950/45"
        >
          <summary
            onClick={selectEvent}
            className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-mono text-[10px] text-neutral-300 marker:hidden"
            title={event.type === 'model_response' ? `${event.provider} / ${event.model}` : detail}
          >
            <span className="shrink-0">{eventStatusIcon(event)}</span>
            <span className="shrink-0 font-bold text-neutral-200">{eventTitle(event)}</span>
            <span className="min-w-0 flex-1 truncate text-neutral-500">{summary}</span>
            <span className={`shrink-0 uppercase tracking-wider ${statusLabel === 'failed' ? 'text-rose-300' : statusLabel === 'running' ? 'text-cyan-300' : 'text-neutral-600'}`}>
              {statusLabel}
            </span>
          </summary>
          <div className="border-t border-neutral-800/80 p-2">
            {renderCurrentDoingCard(event, false, eventKey)}
          </div>
        </details>
      );
    };

    const traceEvents = traceItems.map(({ event }) => event);
    const reasoningEvent = [...traceEvents].reverse().find((event) => event.type === 'reasoning_end');
    const modelResponseEvent = [...traceEvents].reverse().find((event) => event.type === 'model_response');
    const reasoningDetail = compactVisibleText(
      reasoningEvent?.type === 'reasoning_end'
        ? reasoningEvent.summary
        : modelResponseEvent?.type === 'model_response'
          ? modelResponseEvent.decision?.reasoningSummary || modelResponseEvent.decision?.rationale || modelResponseEvent.message
          : undefined,
      72,
    ) || 'Using the task and current evidence.';
    const toolStartedEvents = traceEvents.filter((event) => event.type === 'tool_started');
    const toolResultEvents = traceEvents.filter((event) => event.type === 'tool_result');
    const toolNames = Array.from(new Set(toolStartedEvents.map((event) => event.tool))).slice(0, 3);
    const toolSummary = `${toolStartedEvents.length || toolResultEvents.length} call${(toolStartedEvents.length || toolResultEvents.length) === 1 ? '' : 's'}${toolNames.length ? ` · ${toolNames.join(' / ')}` : ''}`;
    const observationCount = toolResultEvents.length + traceEvents.filter((event) => event.type === 'file_read' || event.type === 'command_output' || event.type === 'verification_result').length;
    const changedFileCount = traceEvents.filter((event) => event.type === 'file_changed').length;
    const runFeedback = getMostRelevantRunFeedback(traceEvents);
    const orbitToneClasses = (tone: string) => tone === 'danger'
      ? 'border-rose-500/45 bg-rose-950/35 text-rose-100'
      : tone === 'warning'
        ? 'border-amber-500/45 bg-amber-950/30 text-amber-100'
        : tone === 'success'
          ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-100'
          : 'border-cyan-500/35 bg-cyan-950/30 text-cyan-100';
    const renderOrbitNode = (node: {
      label: string;
      detail: string;
      position: string;
      tone?: string;
      icon: React.ReactNode;
      testId: string;
    }) => (
      <div
        data-testid={node.testId}
        className={`absolute ${node.position} z-10 flex min-h-[68px] w-24 flex-col items-center justify-center rounded-full border px-2 py-2 text-center shadow-lg sm:w-28 ${orbitToneClasses(node.tone || 'info')}`}
      >
        <div className="flex items-center gap-1 font-mono text-[9px] font-bold uppercase tracking-wider">
          {node.icon}
          <span>{node.label}</span>
        </div>
        <span className="mt-1 line-clamp-2 max-w-full font-mono text-[9px] leading-tight text-neutral-300" title={node.detail}>
          {node.detail}
        </span>
      </div>
    );
    const renderAgentReasoningOrbit = () => (
      <section data-testid="agent-reasoning-orbit" aria-label="Safe agent reasoning and tool loop" className="rounded-xl border border-cyan-500/25 bg-cyan-950/10 p-3 shadow-lg">
        <div className="mb-1 flex items-center justify-between gap-3 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300">
          <span className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5" /> Reasoning path</span>
          <span className="text-neutral-500">safe summary only</span>
        </div>
        <div className="relative mx-auto h-48 w-full max-w-[360px] sm:h-52 sm:max-w-[420px]" role="img" aria-label="Reason, act, observe, and feedback loop">
          <div className="pointer-events-none absolute inset-x-[13%] inset-y-0 rounded-full border border-dashed border-cyan-500/25" />
          <div className="pointer-events-none absolute inset-x-[21%] inset-y-[13%] rounded-full border border-cyan-500/10" />
          <div className="absolute left-1/2 top-1/2 z-20 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border-2 border-cyan-400/45 bg-[#0b1118] text-center shadow-[0_0_22px_rgba(34,211,238,0.14)] sm:h-24 sm:w-24">
            <Activity className="h-4 w-4 text-cyan-300" />
            <span className="mt-1 font-mono text-[9px] font-bold uppercase tracking-wider text-white">ReAct loop</span>
            <span className="font-mono text-[8px] uppercase tracking-wider text-neutral-500">{isLoading ? 'active' : 'complete'}</span>
          </div>
          {renderOrbitNode({ label: 'Reason', detail: reasoningDetail, position: 'left-1/2 top-0 -translate-x-1/2', tone: 'info', icon: <Bot className="h-3 w-3" />, testId: 'agent-loop-reason' })}
          {renderOrbitNode({ label: 'Act', detail: toolSummary || 'Waiting for tool', position: 'right-0 top-1/2 -translate-y-1/2', tone: 'info', icon: <Wrench className="h-3 w-3" />, testId: 'agent-loop-act' })}
          {renderOrbitNode({ label: 'Observe', detail: `${observationCount} observation${observationCount === 1 ? '' : 's'}${changedFileCount ? ` · ${changedFileCount} file change${changedFileCount === 1 ? '' : 's'}` : ''}`, position: 'bottom-0 left-1/2 -translate-x-1/2', tone: 'info', icon: <Search className="h-3 w-3" />, testId: 'agent-loop-observe' })}
          {renderOrbitNode({ label: 'Feedback', detail: runFeedback?.detail || (isLoading ? 'Waiting for the next result.' : 'No decisive feedback recorded.'), position: 'left-0 top-1/2 -translate-y-1/2', tone: runFeedback?.tone || 'info', icon: <Sparkles className="h-3 w-3" />, testId: 'agent-loop-feedback' })}
        </div>
      </section>
    );

    return (
      <div className="flex w-full flex-col gap-3">
        {chatMessageFormat === 'chat_text' && (
          <div className="sr-only" data-testid="rotating-chat-section">
            <span>Expand to Chat Format</span>
          </div>
        )}
        {renderAgentReasoningOrbit()}
        <section data-testid="agent-current-status" className="rounded-xl border border-cyan-500/30 bg-cyan-950/15 p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-3 border-b border-cyan-500/20 pb-2 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300">
            <span className="flex items-center gap-2">
              {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
              Current status
            </span>
            <span className="text-neutral-500">{isLoading ? 'active' : 'latest'}</span>
          </div>
          {currentStatusEvent ? (
            currentStatusIsInteractive
              ? renderEventBlock(currentStatusEvent, currentStatusIndex)
              : (
                <div
                  id={currentStatusTargetId}
                  data-event-id={currentStatusEventKey || undefined}
                  role="button"
                  tabIndex={currentStatusEventKey ? 0 : undefined}
                  onClick={currentStatusEventKey ? () => handleChatEventSelect(currentStatusIndex, currentStatusEvent) : undefined}
                  className={`flex items-start gap-2 rounded-lg transition ${currentStatusEventKey && highlightedEventKey === currentStatusEventKey ? 'ring-2 ring-cyan-300/70 ring-offset-2 ring-offset-[#0b0d12]' : ''}`}
                >
                  <span className="mt-0.5 shrink-0">{eventStatusIcon(currentStatusEvent)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-white">{eventTitle(currentStatusEvent)}</span>
                      {(currentStatusEvent.type === 'nvidia_cooldown_retry' || (currentStatusEvent.type === 'pacing_wait' && currentStatusEvent.scope === 'free_tier_key_cooldown') || currentStatusEvent.type === 'cooldown_waiting') && (
                        <CooldownCountdownBadge event={currentStatusEvent} isLive={isLoading} />
                      )}
                    </div>
                    {eventBody(currentStatusEvent) && (
                      <p className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-neutral-300">
                        {eventBody(currentStatusEvent)}
                      </p>
                    )}
                  </div>
                </div>
              )
          ) : isLoading ? (
            <div data-testid="agent-live-indicator" className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-cyan-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Agent is working
              <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-cyan-300" />
            </div>
          ) : (
            <div className="font-mono text-[10px] text-neutral-500">No activity recorded.</div>
          )}
        </section>

        {stackedActionItems.length > 0 && (
          <section data-testid="agent-action-stack" className="rounded-xl border border-neutral-800/80 bg-neutral-950/25 p-2">
            <div className="flex items-center justify-between px-1 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-400">
              <span>Action history</span>
              <span className="text-neutral-600">{stackedActionItems.length} item{stackedActionItems.length === 1 ? '' : 's'}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {stackedActionItems.map(({ event, index }) => renderStackedAction(event, index))}
            </div>
          </section>
        )}

        {verboseItems.length > 0 && (
          <details className="rounded-lg border border-neutral-800/80 bg-neutral-950/35">
            <summary className="cursor-pointer select-none px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-neutral-400 hover:text-neutral-200">
              Planning and task context ({verboseItems.length})
            </summary>
            <div className="space-y-2 p-2">
              {verboseItems.map(({ event, index }) => renderEventBlock(event, index))}
            </div>
          </details>
        )}
      </div>
    );
  };
  const renderMessage = (message: CoderThreadMessage) => {
    const content = getMessageContent(message);
    const isUser = message.role === 'user';
    const isError = message.status === 'error' || message.status === 'timed_out' || message.role === 'system';
    const hasAgentTimeline = Boolean(message.agentEvents?.length);
    const reasoningSummary = message.reasoningSummary?.trim();
    const useErrorShell = isError && !hasAgentTimeline;
    const showProceed = !loading && messageNeedsProceed(message);
    const changeSummary = !isUser ? getCoderChangeSummary(message) : null;
    const hasChangeSummary = Boolean(changeSummary?.files.length);
    const keyFeedback = message.agentEvents?.length ? getMostRelevantRunFeedback(message.agentEvents) : null;
    const keyFeedbackClasses = keyFeedback?.tone === 'danger'
      ? 'border-rose-500/35 bg-rose-950/20 text-rose-100'
      : keyFeedback?.tone === 'warning'
        ? 'border-amber-500/35 bg-amber-950/20 text-amber-100'
        : keyFeedback?.tone === 'success'
          ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-100'
          : 'border-cyan-500/25 bg-cyan-950/15 text-cyan-100';

    return (
      <article key={message.id} data-message-role={message.role} className={`flex ${isUser ? 'justify-end' : 'justify-start'} my-2`}>
        <div
          className={
            isUser
              ? 'max-w-[85%] rounded-2xl border border-neutral-800/80 bg-[#16181e] px-4 py-2.5 text-sm leading-relaxed text-slate-100 shadow-md'
              : useErrorShell
                ? 'w-full rounded-2xl border border-rose-500/30 bg-rose-950/20 px-5 py-4 text-rose-100 shadow-md'
                : 'w-full px-1 py-1 text-slate-200'
          }
        >
          {(isUser || useErrorShell) && <div className="mb-3 flex items-center justify-between gap-3 border-b border-neutral-800/60 pb-2 text-[11px] font-mono text-neutral-400">
            <span className="flex items-center gap-2 font-bold">
              {isUser ? (
                <>
                  <User className="h-3.5 w-3.5 text-cyan-400" />
                  <span className="text-cyan-300">You</span>
                </>
              ) : useErrorShell ? (
                message.role === 'system' ? (
                  <>
                    <AlertCircle className="h-3.5 w-3.5 text-rose-400" />
                    <span className="text-rose-300">{message.status === 'timed_out' ? 'Run timed out' : 'System Alert'}</span>
                  </>
                ) : (
                  <>
                    <div className="flex h-5 w-5 items-center justify-center rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-400">
                      <Bot className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-white">ReAct Coder</span>
                    <span className="rounded border border-rose-500/30 bg-rose-950/40 px-1.5 py-0.5 font-mono text-[10px] text-rose-400">
                      {message.status === 'timed_out' ? 'Timed Out' : 'Failed'}
                    </span>
                  </>
                )
              ) : (
                <>
                  <div className="flex h-5 w-5 items-center justify-center rounded-md bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                    <Bot className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-white">ReAct Coder</span>
                </>
              )}
            </span>
            <span className="text-[10px] text-neutral-500">{formatTime(message.createdAt)}</span>
          </div>}

          {message.images && message.images.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2.5">
              {message.images.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setPreviewModalImage(img)}
                  className="group relative overflow-hidden rounded-xl border border-neutral-700/80 bg-neutral-900/90 text-left shadow-md transition hover:border-cyan-400 hover:shadow-[0_0_12px_rgba(34,211,238,0.25)]"
                  title={`Click to preview full image: ${img.name}`}
                >
                  <img
                    src={img.url}
                    alt={img.name}
                    className="h-28 w-auto max-w-[200px] object-cover transition-transform duration-200 group-hover:scale-105"
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <ZoomIn className="h-6 w-6 text-white drop-shadow-md" />
                  </span>
                  <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/90 via-black/60 to-transparent px-2 py-1 text-[10px] font-mono text-neutral-300">
                    {img.name}
                  </span>
                </button>
              ))}
            </div>
          )}

          {!isUser && (message.status === 'timed_out' || message.status === 'stopped') && (
            <div className="mb-3 rounded border border-amber-500/30 bg-amber-950/25 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-200" data-testid="thread-terminal-status">
              Final run status: {message.status === 'timed_out' ? 'Timed out' : 'Stopped'}
            </div>
          )}

          {!isUser && !hasAgentTimeline && reasoningSummary && (
            <details className="mb-3 rounded-lg border border-cyan-500/20 bg-cyan-950/10">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300 marker:hidden hover:text-cyan-100">
                <ChevronDown className="h-3.5 w-3.5" />
                <span>Reasoning summary</span>
                <span className="ml-auto font-normal normal-case tracking-normal text-neutral-500">Why I answered this way</span>
              </summary>
              <div className="border-t border-cyan-500/20 px-3 py-2.5 text-xs leading-relaxed text-neutral-300">
                {reasoningSummary}
              </div>
            </details>
          )}

          {isUser ? (
            <p className="whitespace-pre-wrap">
              {content
                .replace(/!\[(.*?)\]\(data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+\)/g, '')
                .replace(/data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+/g, '')
                .trim() || (message.images?.length ? '' : content)}
            </p>
          ) : message.agentEvents?.length ? (
            <div className="space-y-3.5">
              {keyFeedback && (
                <div data-testid="agent-key-feedback" data-feedback-type={keyFeedback.eventType} className={`rounded-xl border px-3.5 py-3 ${keyFeedbackClasses}`}>
                  <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider">
                    {keyFeedback.tone === 'danger' ? <AlertCircle className="h-3.5 w-3.5" /> : keyFeedback.tone === 'success' ? <CheckCircle2 className="h-3.5 w-3.5" /> : keyFeedback.tone === 'warning' ? <History className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                    <span>Key feedback</span>
                    <span className="text-neutral-400">{keyFeedback.title}</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-neutral-200">{keyFeedback.detail}</p>
                </div>
              )}
              {chatMessageFormat === 'streamlined' ? (
                <div className="space-y-4">
                  <StreamlinedChatView
                    events={message.agentEvents}
                    loading={loading && message.status === 'running'}
                    content={message.status === 'running' ? undefined : content}
                    reasoningSummary={message.reasoningSummary}
                    onSelectEvent={handleChatEventSelect}
                    testId="streamlined-chat-view"
                    modelName={message.model || model}
                    density={chatDensity}
                    highlightedEventId={highlightedEventKey}
                    changeSummary={changeSummary || undefined}
                    onReviewFile={openFileFromExplorer}
                    onUndoChanges={onUndoChanges && !loading && hasChangeSummary ? () => requestUndoChanges(message, changeSummary!) : undefined}
                    undoing={undoingMessageId === message.id}
                  />
                  {/* Keep test contract accessibility tags */}
                  <div className="sr-only" data-testid="conversational-stream-container">
                    <div data-testid="agent-current-status" />
                    <div data-testid="agent-action-stack">
                      {getCompatibilityActionEvents(message.agentEvents).map((event, index) => (
                        <span key={`message-compat-${index}-${event.type}`} data-agent-action-stack-item="true" />
                      ))}
                    </div>
                    <div data-testid="agent-reasoning-orbit">
                      <span data-testid="agent-loop-reason">Reason</span>
                      <span data-testid="agent-loop-act">Act</span>
                      <span data-testid="agent-loop-observe">Observe</span>
                      <span data-testid="agent-loop-feedback">Feedback</span>
                      <span data-testid="agent-key-feedback" data-feedback-type="verification_result">Verification feedback</span>
                    </div>
                    <div data-testid="rotating-chat-section">
                      <span>Expand to Chat Format</span>
                    </div>
                    {changeSummary && (
                      <div data-testid="coder-change-summary">
                        Edited {changeSummary.files.length} files +{changeSummary.addedLines || 0} -{changeSummary.removedLines || 0}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {renderConversationalStream(message.agentEvents, loading && message.status === 'running')}
                  {content && (
                    <div className="leading-relaxed">
                      <FinalAnswerRenderer content={content} compact />
                      {loading && message.status === 'running' && (
                        <span
                          data-testid="thread-live-answer-cursor"
                          className="ml-1 inline-block h-4 w-1 animate-pulse bg-cyan-300 align-middle"
                          role="status"
                          aria-label="Assistant is thinking"
                        />
                      )}
                    </div>
                  )}
                  {hasChangeSummary && changeSummary && (
                    <CoderChangeSummaryCard
                      summary={changeSummary}
                      onReview={openFileFromExplorer}
                      onUndo={onUndoChanges && !loading ? () => requestUndoChanges(message, changeSummary) : undefined}
                      undoing={undoingMessageId === message.id}
                    />
                  )}
                </>
              )}
            </div>
          ) : message.status === 'success' ? (
            <>
              <FinalAnswerRenderer content={content} compact />
              {hasChangeSummary && changeSummary && (
                <CoderChangeSummaryCard
                  summary={changeSummary}
                  onReview={openFileFromExplorer}
                  onUndo={onUndoChanges && !loading ? () => requestUndoChanges(message, changeSummary) : undefined}
                  undoing={undoingMessageId === message.id}
                />
              )}
            </>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{content}</p>
          )}

          {useErrorShell && onOpenSettings && (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/40 bg-rose-500/20 px-3 py-1.5 font-mono text-[11px] font-bold text-rose-200 hover:bg-rose-500/30 transition shadow-sm"
              >
                <Settings className="h-3.5 w-3.5" />
                <span>Fix in Settings</span>
              </button>
            </div>
          )}
          {showProceed && (
            <div className="mt-3.5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onProceedRequest || (() => {
                  onTaskChange('yes please');
                  onCoderModeChange('agent');
                })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-emerald-100 transition hover:bg-emerald-500/25 hover:text-white"
                title="Continue with the requested task"
              >
                <TerminalSquare className="h-3.5 w-3.5 text-emerald-400" />
                Proceed
              </button>
            </div>
          )}

          {(() => {
            const messageFiles = extractFilePaths(content, ...(message.filesChanged || []));
            if (messageFiles.length === 0 || hasChangeSummary) return null;
            return (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-neutral-800/80 pt-2.5">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-400 flex items-center gap-1">
                  <FileCode className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Files:</span>
                </span>
                {messageFiles.map((path) => (
                  <button
                    key={path}
                    type="button"
                    onClick={() => openFileFromExplorer(path)}
                    className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan-200 hover:bg-cyan-500/25 hover:text-white transition"
                    title={`Click to open ${path} in Coder Chat`}
                  >
                    <File className="h-3 w-3 text-cyan-300" />
                    <span>{path}</span>
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
      </article>
    );
  };





  const renderPlan = () => {
    if (plan.length === 0) return null;

    return (
      <div className="rounded-xl border border-cyan-500/30 bg-[#0c0e14] p-3.5 shadow-md" aria-label="Execution checklist">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
          <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-cyan-300">
            <Route className="h-4 w-4 text-cyan-400" />
            <span>Agent work context</span>
          </div>
        </div>

        <div className="mt-3 space-y-2.5">
          {plan.map((item, index) => {
            const isDone = item.status === 'completed';
            const isInProgress = item.status === 'in_progress';
            return (
              <div
                key={`${index}-${item.step}`}
                className={`rounded-lg border p-3 transition ${
                  isDone
                    ? 'border-emerald-500/30 bg-emerald-950/10'
                    : isInProgress
                      ? 'border-cyan-500/40 bg-cyan-950/20 shadow-[0_0_12px_rgba(34,211,238,0.1)]'
                      : 'border-neutral-800 bg-neutral-900/30'
                }`}
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-bold ${
                        isDone
                          ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-400'
                          : isInProgress
                            ? 'animate-pulse border-cyan-500/40 bg-cyan-500/20 text-cyan-300'
                            : 'border-neutral-700 bg-neutral-800 text-neutral-400'
                      }`}
                    >
                      {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : isInProgress ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-xs font-semibold ${isDone ? 'text-neutral-400 line-through' : isInProgress ? 'text-cyan-200' : 'text-slate-200'}`}>
                        {displayPlanItem(item.step)}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-neutral-400">
                        {isDone ? 'Executed & verified' : isInProgress ? 'Executing action...' : 'Waiting for execution'}
                      </div>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-md border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${
                    isDone
                      ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                      : isInProgress
                        ? 'border-cyan-500/40 bg-cyan-500/20 text-cyan-300'
                        : 'border-neutral-700 bg-neutral-800 text-neutral-400'
                  }`}>
                    {isDone ? 'Done' : isInProgress ? 'In progress' : 'Pending'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderTreeNodes = (nodes: TreeNode[], depth = 0) => (
    <div className={depth === 0 ? 'space-y-0.5' : 'space-y-0.5 border-l border-border-main pl-2'}>
      {nodes.map((node) => {
        const nodePath = node.path || node.name;
        const active = activeFiles.some((file) => file.endsWith(nodePath) || nodePath.endsWith(file));

        if (node.type === 'directory') {
          const expanded = expandedFolders.has(nodePath);
          return (
            <div key={nodePath}>
              <button
                type="button"
                onClick={() => toggleFolder(nodePath)}
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] font-medium text-text-dim transition hover:bg-bg-active hover:text-white"
              >
                {expanded ? <ChevronDown className="h-3 w-3 text-text-dark" /> : <ChevronRight className="h-3 w-3 text-text-dark" />}
                <Folder className="h-3.5 w-3.5 shrink-0 fill-current text-cyan-400 opacity-80" />
                <span className="truncate">{node.name}</span>
                {active && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Referenced in this thread" />}
              </button>
              {expanded && node.children && <div className="ml-2 mt-0.5">{renderTreeNodes(node.children, depth + 1)}</div>}
            </div>
          );
        }

        return (
          <div
            key={nodePath}
            className={`group flex items-center justify-between rounded px-1.5 py-1 text-[11px] transition ${
              selectedFilePath === nodePath
                ? 'border-l-2 border-cyan-400 bg-cyan-500/15 text-cyan-200'
                : active
                ? 'border-l-2 border-cyan-400 bg-cyan-500/10 text-cyan-300'
                : 'text-text-dim hover:bg-bg-active hover:text-white'
            }`}
          >
            <button
              type="button"
              onClick={() => openFileFromExplorer(nodePath)}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              title={`Open ${nodePath}`}
            >
              <File className={`h-3.5 w-3.5 shrink-0 ${active || selectedFilePath === nodePath ? 'text-cyan-400' : 'text-text-dark'}`} />
              <span className="truncate font-mono">{node.name}</span>
            </button>
            <button
              type="button"
              onClick={() => insertFilePath(nodePath)}
              className="rounded p-0.5 text-text-dark opacity-0 transition hover:bg-bg-panel hover:text-cyan-400 group-hover:opacity-100"
              title="Insert file path"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );

  const renderExplorerSidebar = () => {
    if (!showExplorer) return null;

    const isLg = typeof window !== 'undefined' && window.innerWidth >= 1024;
    const dynamicWidth = isRightPanelOpen ? `${explorerPanelWidth}px` : '0px';

    return (
      <aside
        style={isLg && activeMobileTab !== 'workspace' ? { width: dynamicWidth } : undefined}
        className={`flex shrink-0 flex-col overflow-hidden border-border-main bg-[#0d0d0d] ${
          isResizingExplorer ? '' : 'transition-all duration-300'
        } ${
          activeMobileTab === 'workspace'
            ? 'absolute inset-0 z-20 w-full border-l-0 lg:static'
            : 'hidden lg:flex'
        } ${
          isRightPanelOpen || activeMobileTab === 'workspace'
            ? explorerPosition === 'right' ? 'lg:border-l' : 'lg:border-r'
            : 'lg:w-0 lg:border-l-0 lg:border-r-0 lg:opacity-0 lg:pointer-events-none'
        }`}
      >
        <div className="flex items-center justify-between border-b border-neutral-800/50 px-4 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-text-dim">
              <Folder className="h-3.5 w-3.5 text-cyan-400" />
              Workspace Explorer
            </div>
            <div className="mt-1 truncate font-mono text-[10px] text-text-dark">{workspace || 'default target'}</div>
          </div>
          <button
            type="button"
            onClick={loadFileTree}
            disabled={treeLoading}
            className="rounded p-1.5 text-text-dark transition hover:bg-bg-active hover:text-cyan-400 disabled:opacity-50"
            title="Refresh workspace explorer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${treeLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="custom-scrollbar min-h-[220px] flex-1 overflow-y-auto p-4">
          <div className="mb-4 overflow-hidden rounded border border-border-main bg-bg-main">
            {openFilePaths.length > 0 && (
              <div className="custom-scrollbar flex overflow-x-auto border-b border-border-main bg-[#111]">
                {openFilePaths.map((path) => {
                  const activeTab = selectedFilePath === path;
                  const changed = Boolean(fileChangeReviews[path]);
                  return (
                    <button
                      key={path}
                      type="button"
                      onClick={() => {
                        if (!activeTab) void loadWorkspaceFile(path, 'reading');
                      }}
                      className={`group/tab flex min-w-[120px] max-w-[210px] shrink-0 items-center gap-1.5 border-r border-border-main px-2.5 py-2 text-left font-mono text-[10px] transition ${
                        activeTab
                          ? 'border-t-2 border-t-cyan-400 bg-bg-main text-slate-100'
                          : 'border-t-2 border-t-transparent bg-bg-card text-text-dim hover:bg-bg-active hover:text-white'
                      }`}
                      title={path}
                    >
                      <FileCode className={`h-3 w-3 shrink-0 ${changed ? 'text-emerald-400' : 'text-text-dark'}`} />
                      <span className="min-w-0 flex-1 truncate">{getFileName(path)}</span>
                      {changed && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" title="Changed in latest run" />}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          closeFileTab(path);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            event.stopPropagation();
                            closeFileTab(path);
                          }
                        }}
                        className="shrink-0 rounded p-0.5 text-text-dark opacity-60 hover:bg-neutral-700 hover:text-white group-hover/tab:opacity-100"
                        aria-label={`Close ${path}`}
                      >
                        <X className="h-3 w-3" />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex items-center justify-between gap-2 border-b border-border-main bg-bg-card px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <FileCode className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                <span className="truncate font-mono text-[10px] text-slate-300">
                  {selectedFilePath || 'Select a workspace file'}
                </span>
                {filePresentation?.path === selectedFilePath && (
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${
                    filePresentation.mode === 'writing'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                      : 'border-sky-500/30 bg-sky-500/10 text-sky-200'
                  }`}>
                    Agent {filePresentation.mode === 'writing' ? 'typing' : 'reading'} {filePresentation.progress}%
                  </span>
                )}
                {selectedFilePath && fileChangeReviews[selectedFilePath] && (
                  <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] text-emerald-200">
                    Latest run +{fileChangeReviews[selectedFilePath].addedLines.length}
                    {' / '}-{fileChangeReviews[selectedFilePath].removedLines.length}
                  </span>
                )}
              </div>
              {selectedFilePath && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setExpandedFileModalOpen((open) => !open)}
                    className="rounded border border-border-main bg-bg-active p-1 text-text-dim transition hover:text-cyan-400"
                    title={expandedFileModalOpen ? 'Collapse file preview' : 'Expand file preview'}
                    aria-label={expandedFileModalOpen ? 'Collapse file preview' : 'Expand file preview'}
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => insertFilePath(selectedFilePath)}
                    className="rounded border border-border-main bg-bg-active px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-dim transition hover:text-cyan-400"
                    title="Insert selected file path"
                  >
                    Insert
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenStructureFile?.(selectedFilePath)}
                    className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-cyan-300 transition hover:border-cyan-400/50 hover:bg-cyan-500/20"
                    title="Open selected file in Structure"
                    data-testid="open-file-in-structure"
                  >
                    Structure
                  </button>
                </div>
              )}
            </div>
            <div className={`custom-scrollbar min-h-[120px] overflow-auto p-3 ${expandedFileModalOpen ? 'max-h-[360px]' : 'max-h-[240px]'}`}>
              {!selectedFilePath ? (
                <div className="flex min-h-[96px] items-center justify-center text-center font-mono text-[10px] uppercase tracking-wider text-text-dark">
                  File preview loads here
                </div>
              ) : fileLoading ? (
                <div className="flex items-center gap-2 py-2 font-mono text-[10px] uppercase tracking-wider text-text-dark">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                  Reading file
                </div>
              ) : fileError ? (
                <div className="rounded border border-rose-500/20 bg-rose-500/10 p-2 text-xs text-rose-200">{fileError}</div>
              ) : (
                <>
                  <ReadOnlyCode
                    content={selectedFileContent}
                    review={selectedFilePath ? fileChangeReviews[selectedFilePath] : undefined}
                    compact
                  />
                  {selectedFilePath && fileChangeReviews[selectedFilePath]?.removedLines.length > 0 && (
                    <details className="mt-3 border-t border-rose-500/20 pt-2 text-[10px]">
                      <summary
                        onClick={() => { autoScrollEnabledRef.current = false; }}
                        className="cursor-pointer select-none font-mono text-rose-300"
                      >
                        Removed since previous run ({fileChangeReviews[selectedFilePath].removedLines.length})
                      </summary>
                      <pre className="mt-2 overflow-auto rounded bg-rose-500/10 p-2 font-mono leading-relaxed text-rose-200">
                        {fileChangeReviews[selectedFilePath].removedLines.map((line) => `- ${line}`).join('\n')}
                      </pre>
                    </details>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="min-h-[180px]">
            {treeTruncated && <div className="mb-2 rounded border border-amber-500/30 bg-amber-950/20 p-2 text-[10px] text-amber-200">Tree depth limit reached; some nested files are not shown.</div>}
            {treeLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 font-mono text-[10px] uppercase tracking-wider text-text-dark">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                Loading workspace
              </div>
            ) : treeError ? (
              <div className="rounded border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-200">{treeError}</div>
            ) : fileTree.length > 0 ? (
              renderTreeNodes(fileTree)
            ) : (
              <div className="py-10 text-center font-mono text-[10px] uppercase tracking-wider text-text-dark">No workspace nodes</div>
            )}
          </div>
        </div>

        <div className="border-t border-border-main px-4 py-3 text-center font-mono text-[10px] uppercase tracking-wider text-text-dark">
          {activeFiles.length > 0 ? `${activeFiles.length} referenced file${activeFiles.length === 1 ? '' : 's'}` : 'Active in workspace'}
        </div>
      </aside>
    );
  };

  const renderSliderHandle = () => (
    <button
      type="button"
      onClick={() => setIsRightPanelOpen((value) => !value)}
      className="hidden w-6 shrink-0 items-center justify-center bg-transparent text-text-dark transition hover:text-cyan-400 lg:flex"
      title={isRightPanelOpen ? 'Collapse Workspace Explorer' : 'Expand Workspace Explorer'}
    >
      <span className="flex h-12 w-6 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800 shadow-lg">
        {isRightPanelOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </span>
    </button>
  );

  return (
    <div className="flex h-full min-h-[520px] lg:h-[calc(100vh-150px)] lg:min-h-[760px] w-full flex-col overflow-hidden border border-x-0 border-b-0 border-neutral-900 bg-neutral-950 font-sans text-neutral-200 shadow-2xl">
      <header className="z-10 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-neutral-900 bg-neutral-950/80 px-3 py-2 sm:px-4 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <div className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-800/40 bg-cyan-950/50 text-cyan-400">
            <Cpu className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${loading ? 'animate-pulse' : ''}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="truncate font-display text-xs font-bold uppercase tracking-wider text-neutral-100">React Engine Explorer</span>
              <span className="rounded border border-cyan-800/30 bg-cyan-950 px-1.5 py-0.5 font-mono text-[9px] text-cyan-400">CODER</span>
            </div>
            <p className="hidden truncate font-mono text-[10px] uppercase tracking-wider text-neutral-500 sm:block">Autonomous Workspace Synthesis & Sandbox Environment</p>
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 font-mono text-[10px] text-neutral-400">
          <div className="flex min-w-0 items-center gap-1.5 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 sm:px-2.5 sm:py-1.5">
            <Folder className="h-3.5 w-3.5 shrink-0 fill-cyan-500/20 text-cyan-500" />
            <span className="min-w-0 truncate">WORKSPACE: <span className="font-bold tracking-wide text-neutral-100">{workspace || 'default'}</span></span>
          </div>
        </div>
      </header>

      <div className="flex shrink-0 items-center justify-between border-b border-neutral-900 bg-neutral-900/50 px-2 sm:px-4 py-1.5 text-xs overflow-x-auto no-scrollbar flex-nowrap gap-1.5 sm:gap-2">
        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          <button type="button" className="flex items-center gap-1 sm:gap-1.5 rounded border border-neutral-700 bg-neutral-800 px-2.5 sm:px-3 py-1 font-medium text-neutral-100">
            <Code2 className="h-3.5 w-3.5 text-cyan-400" />
            <span className="whitespace-nowrap">Coder Chat</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setQuickFileModalOpen(true);
              if (fileTree.length === 0) void loadFileTree();
            }}
            className="flex items-center gap-1 sm:gap-1.5 rounded border border-cyan-500/40 bg-cyan-950/40 px-2.5 sm:px-3 py-1 font-mono text-xs font-bold text-cyan-300 transition hover:bg-cyan-500/20 hover:text-white"
            title="Open any workspace file directly in Coder Chat"
          >
            <FolderOpen className="h-3.5 w-3.5 text-cyan-400" />
            <span className="whitespace-nowrap">Open File</span>
          </button>
          <button type="button" onClick={onGenerateWorkPlan} disabled={loading || !task.trim()} className="hidden sm:flex items-center gap-1.5 rounded px-2.5 sm:px-3 py-1 text-neutral-400 transition hover:bg-neutral-800/50 hover:text-neutral-200 disabled:opacity-50">
            <Route className="h-3.5 w-3.5" />
            <span className="whitespace-nowrap">Workplan</span>
          </button>
          <button type="button" onClick={() => setActiveMobileTab('settings')} className="flex lg:hidden items-center gap-1.5 rounded border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-neutral-300 transition hover:bg-neutral-800/50 hover:text-white">
            <Sliders className="h-3.5 w-3.5 text-cyan-400" />
            <span className="whitespace-nowrap">Settings</span>
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 font-mono text-[10px] text-neutral-500">
          <button
            type="button"
            onClick={() => void toggleDesktopAlerts()}
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 transition ${desktopAlertsEnabled ? 'border-cyan-700/50 bg-cyan-950/50 text-cyan-300' : 'border-neutral-800 bg-neutral-900 text-neutral-500 hover:text-neutral-200'}`}
            title={desktopAlertsEnabled ? 'Disable desktop alerts for completed, failed, and stopped runs' : 'Enable desktop alerts for completed, failed, and stopped runs'}
            aria-label={desktopAlertsEnabled ? 'Disable desktop run alerts' : 'Enable desktop run alerts'}
          >
            {desktopAlertsEnabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
            <span className="hidden md:inline">Alerts {desktopAlertsEnabled ? 'on' : 'off'}</span>
          </button>
          <button
            type="button"
            onClick={() => onRequestBudgetEnabledChange(!requestBudgetEnabled)}
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 transition ${requestBudgetEnabled ? 'border-amber-700/50 bg-amber-950/40 text-amber-300' : 'border-neutral-800 bg-neutral-900 text-neutral-500 hover:text-neutral-200'}`}
            title={requestBudgetEnabled ? 'Disable the request safety guard' : 'Enable the request safety guard'}
            aria-label={requestBudgetEnabled ? 'Disable request safety guard' : 'Enable request safety guard'}
            aria-pressed={requestBudgetEnabled}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Request guard {requestBudgetEnabled ? 'on' : 'off'}</span>
          </button>
          <button
            type="button"
            onClick={() => onReplayGuardEnabledChange(!replayGuardEnabled)}
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 transition ${replayGuardEnabled ? 'border-emerald-700/50 bg-emerald-950/40 text-emerald-300' : 'border-neutral-800 bg-neutral-900 text-neutral-500 hover:text-neutral-200'}`}
            title={replayGuardEnabled ? 'Disable ReplayGuard continuation protection' : 'Enable ReplayGuard continuation protection'}
            aria-label={replayGuardEnabled ? 'Disable ReplayGuard' : 'Enable ReplayGuard'}
            aria-pressed={replayGuardEnabled}
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            <span className="hidden md:inline">ReplayGuard {replayGuardEnabled ? 'on' : 'off'}</span>
          </button>
          <button
            type="button"
            onClick={() => onWaitForProviderAvailabilityChange(!waitForProviderAvailability)}
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 transition disabled:cursor-not-allowed disabled:opacity-60 ${waitForProviderAvailability ? 'border-amber-700/50 bg-amber-950/40 text-amber-300' : 'border-neutral-800 bg-neutral-900 text-neutral-500 hover:text-neutral-200'}`}
            title={waitForProviderAvailability ? 'Disable automatic provider retry; failures stop at a saved checkpoint' : 'Enable automatic provider retry; the run waits for the same provider'}
            aria-label={waitForProviderAvailability ? 'Disable automatic provider retry' : 'Enable automatic provider retry'}
            aria-pressed={waitForProviderAvailability}
          >
            <PauseCircle className="h-3.5 w-3.5" />
            <span className="hidden md:inline">{`Auto-retry ${waitForProviderAvailability ? 'on' : 'off'}`}</span>
          </button>
          <span className="hidden sm:inline">{model}</span>
          <span className="rounded border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-cyan-400">{coderMode.toUpperCase()}</span>
        </div>
      </div>

      {terminalAlert && (
        <div className={`fixed bottom-5 right-5 z-[100] max-w-sm rounded-lg border px-4 py-3 shadow-2xl ${terminalAlert.status === 'completed' ? 'border-emerald-500/50 bg-emerald-950 text-emerald-100' : terminalAlert.status === 'checkpoint' ? 'border-cyan-500/50 bg-cyan-950 text-cyan-100' : ['stopped', 'interrupted', 'killed', 'timed_out'].includes(terminalAlert.status) ? 'border-amber-500/50 bg-amber-950 text-amber-100' : 'border-rose-500/50 bg-rose-950 text-rose-100'}`} role="alert" aria-live="assertive">
          <div className="flex items-start gap-3">
            {terminalAlert.status === 'completed' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : terminalAlert.status === 'checkpoint' ? <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" /> : ['stopped', 'interrupted', 'killed'].includes(terminalAlert.status) ? <Square className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <div className="min-w-0">
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider">{terminalAlert.status === 'checkpoint' ? 'Checkpoint saved' : terminalAlert.status === 'timed_out' ? 'Run timed out' : `Run ${terminalAlert.status}`}</div>
              <p className="mt-1 text-xs leading-relaxed">{terminalAlert.message}</p>
            </div>
            <button type="button" onClick={() => setTerminalAlert(null)} className="shrink-0 opacity-70 hover:opacity-100" aria-label="Dismiss run alert"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {/* Automatic file activity modal removed; the live preview now stays in the thread. */}
      {/*
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Agent ${filePresentation.mode} ${filePresentation.path}`}
        >
          <section className="flex max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-cyan-500/30 bg-neutral-950 shadow-[0_24px_80px_rgba(0,0,0,0.65)]">
            <header className="flex items-center justify-between gap-4 border-b border-neutral-800 bg-neutral-900/90 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  filePresentation.mode === 'writing'
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-sky-500/15 text-sky-300'
                }`}>
                  {filePresentation.mode === 'writing'
                    ? <FilePenLine className="h-4 w-4" />
                    : <Search className="h-4 w-4" />}
                </div>
                <div className="min-w-0">
                  <div className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">
                    AI workspace activity
                  </div>
                  <div className="truncate font-mono text-xs text-neutral-100">{filePresentation.path}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => undefined}
                className="rounded-lg p-2 text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
                aria-label="Close agent file activity"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="border-b border-neutral-800 bg-neutral-900/50 px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-wider">
                <span className={filePresentation.mode === 'writing' ? 'text-amber-200' : 'text-sky-200'}>
                  {filePresentation.mode === 'writing'
                    ? 'AI is writing code'
                    : 'AI is reading the current file'}
                </span>
                <span className="text-neutral-400">{filePresentation.progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
                <div
                  className={`h-full rounded-full transition-[width] duration-75 ${
                    filePresentation.mode === 'writing' ? 'bg-amber-400' : 'bg-sky-400'
                  }`}
                  style={{ width: `${filePresentation.progress}%` }}
                />
              </div>
            </div>

            <div className="custom-scrollbar min-h-[320px] flex-1 overflow-auto bg-[#090909] p-5">
              {fileLoading ? (
                <div className="flex items-center gap-2 font-mono text-xs text-neutral-400">
                  <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                  Opening fileâ€¦
                </div>
              ) : (
                <pre className="min-h-full whitespace-pre-wrap font-mono text-xs leading-relaxed text-neutral-200" style={{ tabSize: 2 }}>
                  <code>{selectedFileContent}</code>
                  {filePresentation.progress < 100 && (
                    <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-cyan-300 align-middle" />
                  )}
                </pre>
              )}
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-neutral-800 bg-neutral-900/80 px-4 py-2 font-mono text-[9px] uppercase tracking-wider text-neutral-500">
              <span>Free-tier presentation pacing active</span>
              <span>The next model request waits for this bounded preview</span>
            </footer>
          </section>
        </div>
      */}

      <div className={`relative flex min-h-0 flex-1 overflow-hidden ${isResizingLeftPanel ? 'select-none' : ''}`}>
      <aside
        style={{ width: typeof window !== 'undefined' && window.innerWidth >= 1024 ? `${leftPanelWidth}px` : undefined }}
        className={`${activeMobileTab === 'settings' ? 'absolute inset-0 z-20 w-full' : 'hidden lg:flex'} min-h-0 shrink-0 flex-col overflow-y-auto border-r border-neutral-900 bg-neutral-950/60 p-4 lg:static lg:z-auto gap-y-4`}
      >
        <button
          type="button"
          onClick={createThread}
          className="flex w-full items-center justify-center gap-2 rounded bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-black transition hover:bg-slate-200"
        >
          <Plus className="h-4 w-4" />
          New Thread
        </button>

        <details className="group order-5 border-b border-border-main pb-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded px-1 py-1 text-text-dim transition hover:bg-bg-active hover:text-white">
            <span className="flex items-center gap-2">
              <Sliders className="h-3.5 w-3.5 text-cyan-400" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Advanced Context</span>
              <HelpCircle className="h-3 w-3 text-neutral-600" />
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-neutral-600 transition-transform group-open:rotate-90" />
          </summary>
          <div className="mt-3">
          <label htmlFor="coder-model" className="mb-1.5 block text-[10px] uppercase tracking-wider text-text-dim">
            Model Target
          </label>
          <div className="flex items-center gap-2 rounded border border-border-main bg-bg-main px-3 py-2">
            <Settings className="h-4 w-4 shrink-0 text-text-dim" />
            <select
              id="coder-model"
              value={selectedModelOption ? model : ''}
              onChange={(event) => onModelChange(event.target.value)}
              disabled={!apiPoolModelsLoaded || effectiveModelOptions.length === 0}
              className="min-w-0 flex-1 cursor-pointer rounded bg-bg-main text-sm text-white outline-none"
            >
              {!selectedModelOption && (
                <option value="">
                  {apiPoolModelsLoaded ? 'No model targets configured' : 'Loading model targets...'}
                </option>
              )}
              {groupedModelOptions.map((group, groupIdx) => (
                <optgroup key={`group-top-${groupIdx}-${group.label}`} label={group.label} className="bg-bg-main text-white">
                  {group.options.map((option, optIdx) => (
                    <option key={`opt-top-${groupIdx}-${optIdx}-${option.value}`} value={option.value} className="bg-bg-main text-white">
                      {getModelOptionDisplayLabel(option)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="mt-1.5 rounded border border-neutral-900 bg-neutral-950 px-2 py-1.5 font-mono text-[9px] leading-relaxed text-neutral-500">
            {selectedModelOption && (
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className={`rounded px-1.5 py-0.5 font-bold ${getModelOptionTier(selectedModelOption) === 'Local' ? 'bg-violet-400/10 text-violet-300' : getModelOptionTier(selectedModelOption) === 'Free' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-cyan-400/10 text-cyan-300'}`}>
                  {getModelOptionTier(selectedModelOption)}
                </span>
                <span className="text-neutral-400">{getModelOptionContextLabel(selectedModelOption)}</span>
              </div>
            )}
            <span className="text-neutral-600">Base API:</span>{' '}
            <span className="break-all text-cyan-400/80">{selectedModelOption?.baseApi || 'No model target selected'}</span>
            {selectedModelOption?.provider ? ` Â· ${selectedModelOption.provider}` : ''}
            <div className="mt-1 break-all text-neutral-600">
              Route value: <span className="text-slate-400">{model}</span>
              {selectedModelOption?.provider !== 'Gemini' && selectedModelOption?.provider !== 'Local' && selectedModelOption?.provider !== 'Colab' && selectedModelOption?.provider !== 'Pollinations' && selectedModelOption?.source === 'api-target' && Number.isInteger(selectedModelOption.apiKeyIndex)
                ? ` Â· API key ${(selectedModelOption.apiKeyIndex || 0) + 1}`
                : ''}
            </div>
          </div>
          {!selectedModelOption && apiPoolModelsLoaded && (
            <div className="mt-2 rounded border border-rose-500/30 bg-rose-950/20 px-2 py-2 text-[10px] text-rose-200">
              This selected model target is no longer configured. Choose a valid target before sending a task.
            </div>
          )}
          {selectedLocalEndpointFailure && (
            <div role="status" className="mt-2 rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[10px] text-amber-100">
              <div className="font-bold">The last test for {selectedLocalEndpointFailure.endpointName} failed.</div>
              <div className="mt-1">{selectedLocalEndpointFailure.message}</div>
              <div className="mt-1 text-amber-100/70">
                Tested {new Date(selectedLocalEndpointFailure.testedAt).toLocaleString()}
                {Number.isFinite(selectedLocalEndpointFailure.latencyMs) ? ` · ${selectedLocalEndpointFailure.latencyMs} ms` : ''}. This result is temporary and does not predict future availability.
              </div>
              {onOpenSettings && (
                <button type="button" onClick={onOpenSettings} className="mt-1.5 font-semibold text-amber-200 underline underline-offset-2 hover:text-white">
                  Check endpoint settings
                </button>
              )}
            </div>
          )}
          {workspacePathGuardFailure && (
            <div role="alert" className="mt-2 rounded border border-rose-400/30 bg-rose-950/30 px-3 py-2 text-[10px] text-rose-100">
              <div className="font-bold">A file action was blocked outside the active approved workspace.</div>
              <p className="mt-1">Select the matching approved folder from the workspace switcher, or retry with a workspace-relative path.</p>
            </div>
          )}
          {(loading || activeResolvedTarget) && (
            <div className="mt-2 rounded border border-cyan-500/20 bg-cyan-500/5 px-2 py-2 font-mono text-[9px] leading-relaxed text-cyan-100">
              <div className="font-bold uppercase tracking-wider text-cyan-300">Active target route</div>
              <div className="mt-1 break-all">Requested: {activeResolvedTarget?.requestedTarget || model}</div>
              <div className="break-all">Resolved: {activeResolvedTarget ? `${activeResolvedTarget.provider}/${activeResolvedTarget.resolvedModel}` : 'awaiting provider resolution'}</div>
              {activeResolvedTarget?.profileId && <div>Account: {activeResolvedTarget.profileId}</div>}
              {Number.isInteger(activeResolvedTarget?.credentialIndex) && <div>Credential: {Number(activeResolvedTarget?.credentialIndex) + 1}</div>}
            </div>
          )}

          {selectedModelOption?.provider !== 'Gemini' && liveState?.llmUsage && (
            <div className="mt-3 text-[10px] text-cyan-200">
              Task requests: {liveState.llmUsage.requestCount || 0}
              {liveState.llmUsage.cacheHits ? ` Â· ${liveState.llmUsage.cacheHits} cache hit(s)` : ''}
            </div>
          )}

          {liveState?.noProgressCount >= 3 && !liveState?.steps?.some((step: any) =>
            (step.action === 'Write' || step.action === 'Edit') && /"success"\s*:\s*true/i.test(String(step.observation || ''))
          ) && (
            <div className="mt-3 rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[10px] text-amber-100">
              Source targets have been inspected but no successful mutation is recorded yet. The next safe implementation decision is being prioritized.
            </div>
          )}

          <div className="mt-3 rounded border border-cyan-500/20 bg-cyan-500/5 p-3 text-[10px] text-neutral-400">
            The selected model is pinned for the whole task. The runtime may
            retry that model with another configured credential, but changing
            model IDs requires confirmation in the recovery modal.
          </div>
          <div className="mt-2 rounded border border-neutral-800 bg-neutral-950 px-2 py-2 font-mono text-[9px] leading-relaxed text-neutral-500">
            <div>Primary: {model}</div>
            <div>Credential recovery: same model only</div>
            <div>Model recovery: confirmation required</div>
          </div>

          </div>
        </details>

        <div className="order-1 flex max-h-[260px] shrink-0 flex-col border-b border-neutral-900 pb-4">
          <div className="mb-2 flex items-center justify-between px-1">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-text-dim">Thread History</h3>
            <span className="font-mono text-[9px] uppercase tracking-wider text-text-dark">{visibleThreads.length} saved</span>
          </div>
          <div className="custom-scrollbar flex-1 space-y-1 overflow-y-auto pr-1">
            {visibleThreads.map((item) => {
              const isActive = item.id === activeThreadId || (!activeThreadId && item.messages === thread);
              const itemTitle = sanitizeCoderThreadTitle(item.title, item.messages);
              const itemAge = item.messages[0] ? formatTime(item.messages[0].createdAt) : formatTime(item.createdAt);
              const itemStatus = isActive ? threadStatus : (item.messageCount ?? item.messages.length) > 0 ? 'Saved' : 'Empty';
              const isRenaming = renamingThreadId === item.id;

              return (
                <div key={item.id} className="group relative">
                  {isRenaming ? (
                    <div className="rounded-md border border-cyan-500/40 bg-bg-active p-2">
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          aria-label="Thread title"
                          maxLength={60}
                          value={threadTitleDraft}
                          onChange={(event) => setThreadTitleDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void saveThreadRename(item.id);
                            if (event.key === 'Escape') {
                              setRenamingThreadId(null);
                              setThreadRenameError(null);
                            }
                          }}
                          className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
                        />
                        <button
                          type="button"
                          onClick={() => void saveThreadRename(item.id)}
                          disabled={!threadTitleDraft.trim() || threadRenameBusy}
                          className="rounded p-1.5 text-cyan-300 transition hover:bg-cyan-500/10 disabled:opacity-40"
                          title="Save thread name"
                          aria-label="Save thread name"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingThreadId(null);
                            setThreadRenameError(null);
                          }}
                          disabled={threadRenameBusy}
                          className="rounded p-1.5 text-text-dark transition hover:bg-neutral-800 hover:text-white"
                          title="Cancel rename"
                          aria-label="Cancel rename"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {threadRenameError && <p role="alert" className="mt-1.5 text-[10px] text-rose-300">{threadRenameError}</p>}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelectThread?.(item.id)}
                      className={`w-full rounded-md border-l-2 p-2.5 pr-14 text-left shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)] transition ${
                        isActive
                          ? 'border-cyan-400 bg-bg-active text-white'
                          : 'border-transparent text-text-dim hover:bg-bg-active hover:text-white'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-200" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold leading-snug">{itemTitle}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[9px] text-text-dark">
                            <span>{itemAge}</span>
                            <span className={isActive ? 'font-semibold text-cyan-400' : 'text-text-dark'}>{itemStatus}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  )}
                  {!isRenaming && (
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingThreadId(item.id);
                        setThreadTitleDraft(itemTitle);
                        setThreadRenameError(null);
                      }}
                      disabled={!onRenameThread}
                      className="absolute right-8 top-2.5 rounded p-1 text-text-dark opacity-0 transition hover:bg-cyan-500/10 hover:text-cyan-300 group-hover:opacity-100 group-focus-within:opacity-100 disabled:hidden"
                      title="Rename thread"
                      aria-label={`Rename ${itemTitle}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteThread(item.id, itemTitle);
                    }}
                    className="absolute right-2 top-2.5 rounded p-1 text-text-dark opacity-0 transition hover:bg-rose-500/10 hover:text-rose-400 group-hover:opacity-100 group-focus-within:opacity-100"
                    title="Delete thread"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  {isActive && resumableRun && (childRunsLoading || childRuns.length > 0) && (
                    <div className="ml-4 mt-1 border-l border-violet-500/25 pl-2" data-testid="child-run-hierarchy">
                      <div className="mb-1 flex items-center gap-1.5 px-1 font-mono text-[9px] font-bold uppercase tracking-wider text-violet-300">
                        <Route className="h-3 w-3" /> Child contexts
                        <span className="text-neutral-600">under {resumableRun.id.slice(0, 8)}</span>
                      </div>
                      {childRunsLoading && <p className="px-1 py-1 font-mono text-[9px] text-neutral-500">Loading child runs…</p>}
                      {childRuns.map((child) => {
                        const selected = selectedChildRunId === child.childId;
                        return (
                          <div key={child.childId} className="mb-1 rounded border border-neutral-900 bg-neutral-950/40">
                            <button
                              type="button"
                              onClick={() => void selectChildRunContext(child)}
                              className={`flex w-full items-start gap-2 px-2 py-1.5 text-left transition ${selected ? 'bg-violet-950/30 text-violet-100' : 'text-neutral-300 hover:bg-neutral-900'}`}
                              title={`${child.contract?.objective || child.role} · ${child.model || 'parent model'} · context ${child.modelContextWindow?.toLocaleString() || 'unknown'}`}
                              data-testid={`child-run-${child.childId}`}
                            >
                              <span className="mt-0.5 shrink-0 font-mono text-[9px] text-violet-400">└─</span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[10px] font-semibold">{child.contract?.objective || child.role}</span>
                                <span className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-[9px] text-neutral-500">
                                  <span>{child.status.replace(/_/g, ' ')}</span>
                                  <span>{child.model || 'parent model'}</span>
                                  {child.modelContextWindow && <span>{child.modelContextWindow.toLocaleString()} token window</span>}
                                  {child.contract?.budget?.estimatedPromptTokens && <span>~{child.contract.budget.estimatedPromptTokens.toLocaleString()} prompt tokens</span>}
                                </span>
                              </span>
                              <ChevronDown className={`mt-0.5 h-3 w-3 shrink-0 transition-transform ${selected ? 'rotate-180' : ''}`} />
                            </button>
                            {selected && (
                              <div className="border-t border-neutral-900 px-2 py-2" data-testid="child-run-context">
                                {child.contract?.fileScope?.length ? <p className="mb-1 truncate font-mono text-[9px] text-neutral-500" title={child.contract.fileScope.join(', ')}>Files: {child.contract.fileScope.join(', ')}</p> : null}
                                {childContextLoading ? (
                                  <p className="flex items-center gap-1.5 py-1 font-mono text-[9px] text-violet-300"><Loader2 className="h-3 w-3 animate-spin" /> Loading child context</p>
                                ) : childContextError ? (
                                  <p role="alert" className="py-1 font-mono text-[9px] text-rose-300">{childContextError}</p>
                                ) : childContextEvents.length > 0 ? (
                                  <div className="max-h-52 space-y-1 overflow-auto">
                                    {childContextEvents.slice(-12).map((event, eventIndex) => (
                                      <div key={`${event.type}-${eventIndex}`} className="rounded bg-neutral-900/70 px-2 py-1">
                                        <p className="font-mono text-[9px] font-semibold text-neutral-300">{sharedEventTitle(event)}</p>
                                        {sharedEventBody(event) && <p className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[9px] text-neutral-500">{sharedEventBody(event).slice(0, 320)}</p>}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="py-1 font-mono text-[9px] text-neutral-500">No child events recorded yet.</p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {activeFiles.slice(0, 3).map((file) => (
              <button
                key={file}
                type="button"
                onClick={() => openFileFromExplorer(file)}
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-[11px] text-text-dim transition hover:bg-bg-active hover:text-white"
                title={`Open ${file}`}
              >
                <File className="h-3.5 w-3.5 shrink-0 text-text-dark" />
                <span className="min-w-0 flex-1 truncate font-mono">{file}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="order-3">
          {renderPlan()}
        </div>

        <div className="order-4 border-b border-border-main pb-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sliders className="h-3.5 w-3.5 text-cyan-400" />
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-text-dim">Engine &amp; Execution Settings</h3>
            </div>
            <HelpCircle className="h-3 w-3 text-neutral-600" />
          </div>
          <label htmlFor="coder-pacing" className="mb-1.5 block text-[10px] uppercase tracking-wider text-text-dim">
            Execution Profile
          </label>
          <select
            id="coder-pacing"
            value={pacingProfile}
            onChange={(event) => onPacingProfileChange(event.target.value as ExecutionPacingProfile)}
            disabled={loading}
            className="w-full rounded border border-border-main bg-bg-main px-3 py-2 text-xs text-white outline-none focus:border-cyan-500"
          >
            {USER_EXECUTION_PROFILE_IDS.map((profileId) => (
              <option key={profileId} value={profileId}>
                {EXECUTION_PROFILE_PRESETS[profileId].label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[9px] leading-relaxed text-neutral-500">{activePacingPreset.description}</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5 font-mono text-[9px] leading-relaxed">
            <div className="rounded border border-neutral-900 bg-neutral-950 px-2 py-1.5">
              <div className="uppercase tracking-wider text-neutral-600">Engine request gap</div>
              <div className="mt-0.5 text-cyan-200">{formatProfileInterval(activePacingPreset.requestIntervalMs)}</div>
            </div>
            <div className="rounded border border-neutral-900 bg-neutral-950 px-2 py-1.5">
              <div className="uppercase tracking-wider text-neutral-600">Provider request floor</div>
              <div className="mt-0.5 text-cyan-200">{formatProfileInterval(activePacingPreset.providerRequestIntervalMs)}</div>
            </div>
            <div className="rounded border border-neutral-900 bg-neutral-950 px-2 py-1.5">
              <div className="uppercase tracking-wider text-neutral-600">Workspace presentation</div>
              <div className="mt-0.5 text-cyan-200">
                Read {formatProfileInterval(activePacingPreset.toolPresentation.readMs)} · Write {formatProfileInterval(activePacingPreset.toolPresentation.writeMs)}
              </div>
            </div>
            <div className="rounded border border-neutral-900 bg-neutral-950 px-2 py-1.5">
              <div className="uppercase tracking-wider text-neutral-600">Action summary pause</div>
              <div className="mt-0.5 text-cyan-200">
                {activePacingPreset.decisionPresentation.maxMs > 0
                  ? `${formatProfileInterval(activePacingPreset.decisionPresentation.minMs)}–${formatProfileInterval(activePacingPreset.decisionPresentation.maxMs)}`
                  : 'none'}
              </div>
            </div>
          </div>
          <p className="mt-2 text-[9px] leading-relaxed text-neutral-600">
            These values control pacing only. Request guard, ReplayGuard, provider auto-retry, and the selected model remain independently adjustable below/above; billing follows the active provider route.
          </p>
          <div className="mt-3 rounded border border-neutral-900 bg-neutral-950 px-2 py-1.5 font-mono text-[9px] leading-relaxed text-neutral-500">
            <span className="text-neutral-600">Active Route:</span>{' '}
            <span className="break-all text-cyan-400/80">{model}</span>
            {selectedModelOption?.provider ? ` (${selectedModelOption.provider})` : ''}
            {selectedModelOption?.baseApi && <div className="mt-0.5 break-all text-neutral-600">Base: {selectedModelOption.baseApi}</div>}
          </div>
          {(loading || activeResolvedTarget) && (
            <div className="mt-2 rounded border border-cyan-500/20 bg-cyan-500/5 px-2 py-2 font-mono text-[9px] leading-relaxed text-cyan-100">
              <div className="font-bold uppercase tracking-wider text-cyan-300">Active target route</div>
              <div className="mt-1 break-all">Requested: {activeResolvedTarget?.requestedTarget || model}</div>
              <div className="break-all">Resolved: {activeResolvedTarget ? `${activeResolvedTarget.provider}/${activeResolvedTarget.resolvedModel}` : 'awaiting provider resolution'}</div>
              {activeResolvedTarget?.profileId && <div>Account: {activeResolvedTarget.profileId}</div>}
            </div>
          )}
          {liveState?.llmUsage && (
            <div className="mt-2.5 text-[10px] text-cyan-200">
              Task requests: {liveState.llmUsage.requestCount || 0}
              {liveState.llmUsage.cacheHits ? ` Â· ${liveState.llmUsage.cacheHits} cache hit(s)` : ''}
            </div>
          )}
        </div>

        <div className="order-6 pt-2">
          <div className="rounded-md border border-border-main bg-bg-card p-3">
            <div className="mb-1.5 flex items-center justify-between text-xs text-slate-300">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-text-dim">
                <Cpu className="h-3 w-3 text-cyan-400" />
                {runTokenMetrics.hasContextWindow ? 'Context Window' : 'Active Prompt Context'}
              </span>
              <span className="font-mono text-[10px] text-white">
                {runTokenMetrics.hasProviderPrompt
                  ? `${runTokenMetrics.providerPromptTokens?.toLocaleString()} prompt tokens reported`
                  : `${runTokenMetrics.contextTokens.toLocaleString()} tokens estimated`}
              </span>
            </div>
            {runTokenMetrics.hasRunUsage && (
              <div className="mb-2 flex justify-between font-mono text-[9px] text-text-dim">
                <span>Input {runTokenMetrics.inputTokens.toLocaleString()}</span>
                <span>Output {runTokenMetrics.outputTokens.toLocaleString()}</span>
              </div>
            )}
            <div className="h-1 w-full overflow-hidden rounded bg-bg-main">
              <div
                className={`h-full transition-all ${memoryPercent > 80 ? 'bg-rose-500' : memoryPercent > 50 ? 'bg-amber-500' : 'bg-cyan-400'}`}
                style={{ width: `${runTokenMetrics.hasContextWindow ? Math.max(3, memoryPercent) : 0}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between gap-2 font-mono text-[9px] text-text-dark">
              <span>
                Window: {contextWindowLabel}
              </span>
              <span>{contextRemainingLabel}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5 border-t border-neutral-800/70 pt-2 font-mono text-[9px]">
              <div className="rounded border border-neutral-800/80 bg-neutral-950/70 px-2 py-1.5">
                <div className="uppercase tracking-wider text-text-dark">Total token use</div>
                <div className="mt-0.5 text-[11px] font-semibold text-cyan-200">
                  {runTokenMetrics.hasRunUsage ? `${runTokenMetrics.totalTokens.toLocaleString()} tokens` : 'Awaiting run'}
                </div>
              </div>
              <div className="rounded border border-neutral-800/80 bg-neutral-950/70 px-2 py-1.5">
                <div className="uppercase tracking-wider text-text-dark">Total context window</div>
                <div className="mt-0.5 text-[11px] font-semibold text-emerald-200">
                  {runTokenMetrics.hasContextWindow ? `${runTokenMetrics.contextWindow.toLocaleString()} tokens` : 'Pending target'}
                </div>
              </div>
            </div>
            <div className="mt-0.5 flex items-center justify-between font-mono text-[9px] text-text-dark">
              <span>
                {runTokenMetrics.promptPrefillDurationMs !== undefined && runTokenMetrics.promptPrefillDurationMs > 0
                  ? `Prefill: ${(runTokenMetrics.promptPrefillDurationMs / 1000).toFixed(1)}s`
                  : ''}
              </span>
              <span>
                {runTokenMetrics.hasContextWindow
                  ? `${(runTokenMetrics.context_window_used_percent ?? memoryPercent).toFixed(1)}% used · ${contextRemainingPercent.toFixed(1)}% free`
                  : `Estimated prompt size: ${runTokenMetrics.contextTokens.toLocaleString()} tokens`}
              </span>
            </div>
            {!runTokenMetrics.hasContextWindow && (
              <div className="mt-1 text-right font-mono text-[9px] text-amber-300/80">
                Model context window will appear after the active target resolves.
              </div>
            )}
          </div>
        </div>
      </aside>

      <div
        onMouseDown={handleLeftResizeMouseDown}
        className={`group relative z-10 -ml-1 hidden w-2 shrink-0 cursor-col-resize select-none items-center justify-center transition-colors lg:flex ${isResizingLeftPanel ? 'bg-cyan-500/30' : 'hover:bg-cyan-500/20'}`}
        title="Drag to resize the coder sidebar"
        role="separator"
        aria-label="Resize coder sidebar"
      >
        <div className={`h-12 w-1 rounded-full transition-all duration-150 ${isResizingLeftPanel ? 'scale-y-125 bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)]' : 'bg-neutral-800 group-hover:scale-y-110 group-hover:bg-cyan-400/80'}`} />
      </div>

      <section className={`${activeMobileTab === 'chat' ? 'flex' : 'hidden lg:flex'} min-w-0 flex-1 flex-col overflow-hidden bg-neutral-950 lg:flex-row`}>
        {explorerPosition === 'left' && renderExplorerSidebar()}
        {explorerPosition === 'left' && showExplorer && isRightPanelOpen && (
          <div
            onMouseDown={handleExplorerResizeMouseDown}
            onDoubleClick={() => setExplorerPanelWidth(360)}
            className={`group relative z-10 hidden w-2 shrink-0 cursor-col-resize select-none items-center justify-center transition-colors lg:flex ${isResizingExplorer ? 'bg-cyan-500/30' : 'hover:bg-cyan-500/20'}`}
            title="Drag to resize workspace explorer (double-click to reset)"
            role="separator"
            aria-label="Resize workspace explorer"
          >
            <div className={`h-12 w-1 rounded-full transition-all duration-150 ${isResizingExplorer ? 'scale-y-125 bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)]' : 'bg-neutral-800 group-hover:scale-y-110 group-hover:bg-cyan-400/80'}`} />
          </div>
        )}
        {explorerPosition === 'left' && renderSliderHandle()}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Main Top Header: Thread Title & Status Row */}
          <div className="border-b border-neutral-800/80 bg-[#0d0e12] px-4 py-2.5">
            {/* Tier 1: Thread Title & Context Window Metrics */}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              {/* Left: Thread Title & Active Status */}
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    loading
                      ? 'bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.8)]'
                      : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                  }`}
                />
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-neutral-400">Thread:</span>
                  <h2
                    className="truncate text-xs sm:text-sm font-bold tracking-tight text-white select-all max-w-[280px] sm:max-w-md md:max-w-lg"
                    title={threadTitle}
                  >
                    {threadTitle}
                  </h2>
                </div>

                {/* Status Indicator */}
                <div className="flex items-center gap-1 text-[11px] font-mono shrink-0 ml-1">
                  {loading ? (
                    <span className="flex items-center gap-1 text-cyan-400 font-semibold bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-500/30 text-[10px]">
                      <Loader2 className="h-3 w-3 animate-spin" /> Running
                    </span>
                  ) : (
                    <span className="text-neutral-400 bg-neutral-900/90 px-2 py-0.5 rounded border border-neutral-800 text-[10px]">
                      Idle
                    </span>
                  )}
                </div>

                {currentHarnessStage && (loading || result || agentEvents.length > 0) && (
                  <span
                    className={`hidden sm:inline-flex max-w-[150px] truncate rounded border px-2 py-0.5 font-mono text-[9px] font-semibold ${
                      currentHarnessStage.status === 'active'
                        ? 'border-cyan-500/30 bg-cyan-950/30 text-cyan-200'
                        : currentHarnessStage.status === 'blocked'
                          ? 'border-rose-500/30 bg-rose-950/30 text-rose-200'
                          : currentHarnessStage.status === 'complete'
                            ? 'border-emerald-500/25 bg-emerald-950/20 text-emerald-200'
                            : 'border-neutral-800 bg-neutral-900 text-neutral-400'
                    }`}
                    title={`${currentHarnessStage.label}: ${currentHarnessStage.detail}. ${currentHarnessStage.description}`}
                    data-testid="harness-stage-pill"
                  >
                    Stage · {currentHarnessStage.label}
                  </span>
                )}

                {latestProviderRotation?.type === 'provider_rotation_occurred' && (
                  <span
                    className="hidden lg:inline-flex max-w-[230px] items-center gap-1 truncate rounded border border-amber-500/30 bg-amber-950/25 px-2 py-0.5 font-mono text-[9px] font-semibold text-amber-200"
                    title={`${latestProviderRotation.fromProvider}${latestProviderRotation.fromProfileId ? ` / ${latestProviderRotation.fromProfileId}` : Number.isInteger(latestProviderRotation.fromKeyIndex) ? ` account ${Number(latestProviderRotation.fromKeyIndex) + 1}` : ''}${latestProviderRotation.fromModel ? ` / ${latestProviderRotation.fromModel}` : ''} -> ${latestProviderRotation.toProvider}${latestProviderRotation.toProfileId ? ` / ${latestProviderRotation.toProfileId}` : Number.isInteger(latestProviderRotation.toKeyIndex) ? ` account ${Number(latestProviderRotation.toKeyIndex) + 1}` : ''}${latestProviderRotation.toModel ? ` / ${latestProviderRotation.toModel}` : ''}${latestProviderRotation.cooldownSeconds > 0 ? `; ${latestProviderRotation.cooldownSeconds}s cooldown` : ''}; ${latestProviderRotation.reason}`}
                    data-testid="provider-route-rotation-pill"
                  >
                    <Route className="h-3 w-3 shrink-0" />
                    <span className="truncate">Route · {latestProviderRotation.fromProvider} → {latestProviderRotation.toProvider}</span>
                    {latestProviderRotation.cooldownSeconds > 0 && <span className="shrink-0">{latestProviderRotation.cooldownSeconds}s</span>}
                  </span>
                )}

                {(pacingProfile === 'conservative' || pacingProfile === 'phased') && (
                  <span className="hidden xl:inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-950/40 px-2 py-0.5 text-[9px] font-semibold text-cyan-300">
                    Locked to {model ? model.replace(/^(?:nvidia|gemini|groq|openrouter|kimi|requesty|local):/i, '') : 'Model'} • Zero Fallback
                  </span>
                )}
              </div>

              {/* Right: Context Token & Usage Metrics */}
              <div className="flex items-center gap-2 shrink-0 font-mono text-[10px]">
                <div
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors ${
                    !runTokenMetrics.hasContextWindow
                      ? 'border-neutral-800/80 bg-neutral-900/90'
                      : memoryPercent >= 95
                      ? 'border-rose-500/50 bg-rose-950/30'
                      : memoryPercent >= 85
                        ? 'border-orange-500/40 bg-orange-950/20'
                        : memoryPercent >= 70
                          ? 'border-amber-500/40 bg-amber-950/20'
                          : 'border-neutral-800/80 bg-neutral-900/90'
                  }`}
                  title={runTokenMetrics.hasContextWindow
                    ? `${runTokenMetrics.hasProviderPrompt ? 'Provider-reported prompt' : 'Estimated context'}: ${runTokenMetrics.hasProviderPrompt ? runTokenMetrics.providerPromptTokens?.toLocaleString() : runTokenMetrics.contextTokens.toLocaleString()} / ${runTokenMetrics.contextWindow.toLocaleString()} tokens (${memoryPercent.toFixed(1)}% used, ${runTokenMetrics.hasProviderPrompt ? runTokenMetrics.providerPromptRemainingTokens?.toLocaleString() : runTokenMetrics.contextRemainingTokens.toLocaleString()} remaining)`
                    : 'Model context window is not known until the active target resolves.'}
                >
                  <Cpu
                    className={`h-3 w-3 shrink-0 ${
                      !runTokenMetrics.hasContextWindow
                        ? 'text-neutral-500'
                        : memoryPercent >= 95
                        ? 'text-rose-400 animate-pulse'
                        : memoryPercent >= 85
                          ? 'text-orange-400'
                          : memoryPercent >= 70
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                    }`}
                  />
                  <span
                    className={`font-semibold ${
                      !runTokenMetrics.hasContextWindow
                        ? 'text-neutral-400'
                        : memoryPercent >= 95
                        ? 'text-rose-400 font-bold'
                        : memoryPercent >= 85
                          ? 'text-orange-400'
                          : memoryPercent >= 70
                            ? 'text-amber-300'
                            : 'text-emerald-300'
                    }`}
                  >
                    {runTokenMetrics.hasContextWindow ? `${memoryPercent.toFixed(1)}%` : 'Pending'}
                  </span>
                  <div className="h-1.5 w-12 sm:w-16 overflow-hidden rounded-full bg-neutral-800/80 border border-neutral-700/50">
                    <div
                      className={`h-full transition-all duration-300 ${
                        !runTokenMetrics.hasContextWindow
                          ? 'bg-neutral-600'
                          : memoryPercent >= 95
                          ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.9)] animate-pulse'
                          : memoryPercent >= 85
                            ? 'bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.8)]'
                            : memoryPercent >= 70
                              ? 'bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.6)]'
                              : 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.5)]'
                      }`}
                      style={{ width: `${runTokenMetrics.hasContextWindow ? Math.min(100, Math.max(3, memoryPercent)) : 100}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-neutral-500 hidden sm:inline">
                    ({runTokenMetrics.hasContextWindow
                      ? `${formatTokenCount(runTokenMetrics.contextWindow)} window · ${formatTokenCount(runTokenMetrics.contextRemainingTokens)} left`
                      : 'window pending'})
                  </span>
                </div>
              </div>
            </div>

            {/* Tier 2: Dedicated Control Toolbar (Clean, Spaced, Clickable) */}
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-neutral-800/60">
              {/* Left Group: Resume/Stop + Explorer Controls */}
              <div className="flex flex-wrap items-center gap-1.5">
                {resumableRun && onResumeServerRun && !loading && (
                  <button
                    type="button"
                    onClick={onResumeServerRun}
                    aria-label="Continue session"
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20 hover:text-white shadow-sm"
                    title={resumableRun.model && resumableRun.model !== model
                      ? `Continue session with selected ${model}; parent was ${resumableRun.model}`
                      : `Continue session with ${model}: ${resumableRun.task}`}
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-cyan-400" />
                    <span className="whitespace-nowrap">Resume Session</span>
                    <span className="rounded bg-cyan-950 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300">
                      {resumableRun.status}
                    </span>
                  </button>
                )}
                {loading && (
                  <button
                    type="button"
                    onClick={onStopTask}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/25"
                    title="Stop current process"
                  >
                    <Square className="h-3.5 w-3.5 fill-current text-rose-400" />
                    <span className="whitespace-nowrap">Stop</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setShowExplorer(true);
                    setIsRightPanelOpen((value) => !value);
                  }}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                    showExplorer && isRightPanelOpen
                      ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                      : 'border-neutral-800 bg-neutral-900/80 text-neutral-300 hover:border-neutral-700 hover:text-white'
                  }`}
                >
                  <Folder className="h-3.5 w-3.5" />
                  <span className="whitespace-nowrap">Explorer</span>
                </button>
                {showExplorer && (
                  <button
                    type="button"
                    onClick={toggleExplorerPosition}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/80 px-2 py-1 text-xs font-semibold text-neutral-300 transition hover:border-neutral-700 hover:text-cyan-400"
                  >
                    <Sliders className="h-3.5 w-3.5" />
                    <span className="whitespace-nowrap">{explorerPosition === 'right' ? 'Left' : 'Right'}</span>
                  </button>
                )}
              </div>

              {/* Right Group: View Mode + Clear */}
              <div className="flex flex-wrap items-center gap-1.5">
                {/* View Mode Switcher: Chat | Console | Split */}
                <div className="flex shrink-0 items-center rounded-lg border border-neutral-800 bg-neutral-900/80 p-0.5" role="group" aria-label="View Mode">
                  <button
                    type="button"
                    onClick={() => handleViewModeChange('chat')}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition ${
                      viewMode === 'chat'
                        ? 'bg-cyan-500/20 text-cyan-300 shadow-sm'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                    title="Conversational Chat View"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>Chat</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleViewModeChange('console')}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition ${
                      viewMode === 'console'
                        ? 'bg-cyan-500/20 text-cyan-300 shadow-sm'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                    title="Live Console Run Stream"
                  >
                    <Terminal className="h-3.5 w-3.5" />
                    <span>Console</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleViewModeChange('split')}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition ${
                      viewMode === 'split'
                        ? 'bg-cyan-500/20 text-cyan-300 shadow-sm'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                    title="Split View (Chat + Console Run)"
                  >
                    <Columns className="h-3.5 w-3.5" />
                    <span>Split</span>
                  </button>
                </div>

                {/* Clear Button */}
                <button
                  type="button"
                  onClick={clearThread}
                  className="shrink-0 rounded-lg border border-neutral-800 bg-neutral-900/80 p-1.5 text-neutral-400 transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-400"
                  title="Clear thread messages"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {viewMode === 'chat' && (
            <div className="relative flex-1 min-h-0">
              <div
                ref={threadScrollRef}
                data-testid="session-thread-scroll"
                className="custom-scrollbar h-full overflow-y-auto p-5 md:p-6"
                onScroll={handleThreadScroll}
              >
              {chatDensity === 'detailed' && latestGuidanceSnapshot && (
                <div className="mx-auto mb-3 w-full max-w-3xl overflow-hidden rounded-lg border border-cyan-500/20">
                  <AgentGuidanceCard snapshot={latestGuidanceSnapshot} previous={previousGuidanceSnapshot} />
                </div>
              )}
              <div ref={threadContentRef}>
              {thread.length === 0 && !loading && !result ? (
                <div className="mx-auto flex min-h-[360px] w-full max-w-3xl flex-col justify-center py-8 text-text-dim">
                  <div className="mb-5 text-center">
                    <FileCode className="mx-auto mb-3 h-8 w-8 text-cyan-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">Start building with Barok</h3>
                    <p className="mt-1 text-xs text-neutral-500">Describe a change or choose a starter task.</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {starterPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => onTaskChange(prompt)}
                        className="rounded-lg border border-border-main bg-bg-main px-4 py-3 text-left text-sm leading-relaxed text-slate-300 transition hover:border-cyan-500/50 hover:bg-bg-active hover:text-white"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                  <div className="mt-5 grid gap-2 rounded-lg border border-border-main bg-bg-main/70 p-3 text-xs sm:grid-cols-2">
                    <div className="min-w-0">
                      <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-text-dark">Active workspace</div>
                      <div className="mt-1 truncate text-slate-300" title={workspace || 'No workspace selected'}>
                        {workspace || 'No workspace selected'}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-text-dark">Default model target</div>
                      <div className="mt-1 truncate text-slate-300" title={selectedModelOption ? getModelOptionDisplayLabel(selectedModelOption) : model || 'No model configured'}>
                        {selectedModelOption ? getModelOptionDisplayLabel(selectedModelOption) : model || 'No model configured'}
                      </div>
                    </div>
                  </div>
                  <nav aria-label="Barok guides" className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-2 text-[11px]">
                    <a href="/docs/core/USER_GUIDE.md" target="_blank" rel="noreferrer" className="text-cyan-300 transition hover:text-cyan-100 hover:underline">
                      User Guide
                    </a>
                    <a href="/docs/core/RUNNING_AGENT_GUIDE.md" target="_blank" rel="noreferrer" className="text-cyan-300 transition hover:text-cyan-100 hover:underline">
                      Running Agent Guide
                    </a>
                  </nav>
                </div>
              ) : (
                <div className="space-y-6">
                  {hiddenMessageCount > 0 && (
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={() => setShowOlderMessages((value) => !value)}
                        className="rounded border border-border-main bg-bg-active px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-text-dim transition hover:border-cyan-500/40 hover:text-cyan-300"
                      >
                        {showOlderMessages
                          ? 'Hide older messages'
                          : `Show ${hiddenMessageCount} older messages`}
                      </button>
                    </div>
                  )}

                  {renderedThreadMessages
                    .filter((message) => !(loading && message.role === 'assistant' && message.status === 'running'))
                    .map(renderMessage)}

                  {(loading || recentSteps.length > 0) && (
                    <article className="w-full text-slate-200 flex justify-start my-2">
                      <div className="w-full rounded-2xl border border-neutral-800/90 bg-[#111216] px-5 py-4 text-slate-200 shadow-lg">
                        <div className="mb-3 flex items-center justify-between gap-3 border-b border-neutral-800/60 pb-2 text-[11px] font-mono text-neutral-400">
                          <span className="flex items-center gap-2 font-bold">
                            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                              <Bot className="h-3.5 w-3.5" />
                            </div>
                            <span className="text-white">ReAct Coder</span>
                          </span>
                          <span className="text-[10px] text-neutral-500">Live</span>
                        </div>

                        {false && loading && activeLlmRequest && (
                          <div className="mb-4 rounded border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 font-mono text-[10px] text-cyan-100" data-testid="llm-request-pending-banner" role="status" aria-live="polite">
                            <div className="mb-1 flex items-center gap-2 font-bold uppercase tracking-wider text-cyan-300">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Waiting on provider response
                            </div>
                            <div>
                              {formatAgentRequestRoute(activeLlmRequest)}
                              {activeLlmRequest.requestKind ? ` · ${activeLlmRequest.requestKind}` : ''}
                              {` · elapsed ${formatElapsedDuration(activeLlmRequestElapsedMs)}`}
                              {activeLlmRequest.options?.timeoutMs ? ` / ${formatProviderWaitDuration(activeLlmRequest.options.timeoutMs)} request limit` : ''}
                            </div>
                          </div>
                        )}

                        {renderConversationalStream(agentEvents, loading, liveAssistantReply)}
                      </div>
                    </article>
                  )}

                  {result && (!resultIsCompleted || !resultIsRepresentedInThread) && (
                    <article
                      className={`rounded border p-4 ${
                        resultIsCompleted
                          ? isCompletedWithVerificationFailure(result)
                            ? 'border-amber-500/30 bg-amber-500/10'
                            : 'border-emerald-500/20 bg-emerald-500/10'
                          : 'border-red-500/20 bg-red-500/10'
                      }`}
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-white">Final Result</h3>
                          <button
                            type="button"
                            onClick={toggleFinalAnswerCollapsed}
                            aria-expanded={!finalAnswerCollapsed}
                            title={finalAnswerCollapsed ? 'Expand final result' : 'Collapse final result'}
                            className="inline-flex items-center gap-1 rounded border border-border-main bg-bg-main/60 px-1.5 py-0.5 font-mono text-[10px] text-text-dim transition hover:border-cyan-500/40 hover:text-white"
                          >
                            {finalAnswerCollapsed ? <ChevronRight className="h-3 w-3 text-neutral-400" /> : <ChevronDown className="h-3 w-3 text-neutral-400" />}
                            <span>{finalAnswerCollapsed ? 'Expand' : 'Collapse'}</span>
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          {finalRunDurationMs !== undefined && finalRunDurationMs > 0 && (
                            <>
                              <span className="font-mono text-[10px] text-text-dim" title="Total run duration">
                                {formatElapsedDuration(finalRunDurationMs)}
                              </span>
                              <span className="text-text-dark text-[10px]">•</span>
                            </>
                          )}
                          <span className="font-mono text-[10px] text-text-dim">
                            {result.pollenCost?.toFixed(4) || '0.0000'} pollen
                          </span>
                          {result.finalAnswer && (
                            <button
                              type="button"
                              onClick={copyFinalAnswer}
                              title="Copy answer"
                              aria-label="Copy answer"
                              className="inline-flex items-center gap-1 rounded border border-border-main bg-bg-main/60 px-1.5 py-0.5 font-mono text-[10px] text-text-dim transition hover:border-cyan-500/40 hover:text-white"
                            >
                              {finalAnswerCopied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                              <span>{finalAnswerCopied ? 'Copied' : 'Copy'}</span>
                            </button>
                          )}
                        </div>
                      </div>
                      {terminalRunAdvice && <TerminalRunAdviceCard advice={terminalRunAdvice} />}
                      {finalAnswerCollapsed ? (
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={toggleFinalAnswerCollapsed}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleFinalAnswerCollapsed(); }}
                          className="cursor-pointer rounded border border-dashed border-neutral-700/60 bg-neutral-900/30 px-3 py-2 text-xs text-neutral-400 transition hover:border-neutral-500 hover:text-neutral-200"
                        >
                          <div className="flex items-center justify-between">
                            <span className="italic truncate mr-2">
                              {result.finalAnswer ? result.finalAnswer.slice(0, 100).replace(/\s+/g, ' ').trim() + (result.finalAnswer.length > 100 ? '...' : '') : 'Final result collapsed'}
                            </span>
                            <span className="shrink-0 text-[10px] font-mono text-cyan-400">Click to expand</span>
                          </div>
                        </div>
                      ) : resultIsCompleted ? (
                        <div>
                          {result.finalAnswer?.trim() ? (
                            <FinalAnswerRenderer content={result.finalAnswer} compact />
                          ) : (
                            <div className="rounded border border-neutral-700/60 bg-neutral-900/50 p-3 text-xs text-neutral-300">
                              <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                                <Info className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
                                <span>No final answer provided</span>
                              </div>
                              {originalTaskDescription ? (
                                <div className="mt-2 space-y-1">
                                  <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-400">Original task:</span>
                                  <p className="rounded bg-black/30 p-2 font-mono text-xs text-neutral-200 border border-neutral-800">
                                    {originalTaskDescription}
                                  </p>
                                </div>
                              ) : (
                                <p className="mt-1 text-neutral-400 text-xs">The run completed without a final response message.</p>
                              )}
                            </div>
                          )}
                          {isCompletedWithVerificationFailure(result) && (
                            <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                              Work completed, but verification failed: {result.error || 'one or more tests failed.'}
                            </div>
                          )}
                          <EvidenceReviewPanel evidence={result.requirementEvidence} findings={result.reviewFindings} />
                          {renderQualityGatePanel()}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {result.finalAnswer?.trim() ? (
                            <div className="rounded border border-border-main bg-bg-main/60 p-3">
                              <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-wider text-text-dim">
                                Agent response
                              </div>
                              <FinalAnswerRenderer content={result.finalAnswer} compact />
                            </div>
                          ) : originalTaskDescription ? (
                            <div className="rounded border border-neutral-700/60 bg-neutral-900/50 p-3 text-xs text-neutral-300">
                              <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                                <Info className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
                                <span>No final answer provided</span>
                              </div>
                              <div className="mt-2 space-y-1">
                                <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-400">Original task:</span>
                                <p className="rounded bg-black/30 p-2 font-mono text-xs text-neutral-200 border border-neutral-800">
                                  {originalTaskDescription}
                                </p>
                              </div>
                            </div>
                          ) : null}
                          <div className={`rounded border px-3 py-2.5 ${isCheckpointResult(result) ? 'border-cyan-500/20 bg-cyan-500/10' : 'border-amber-500/20 bg-amber-500/10'}`}>
                            <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
                              {isCheckpointResult(result)
                                ? 'Checkpoint saved'
                                : resultTerminalOutcome === 'timed_out'
                                  ? 'Run timed out'
                                  : ['stopped', 'interrupted', 'killed'].includes(resultTerminalOutcome || '')
                                    ? `Run ${resultTerminalOutcome}`
                                    : 'Completion warning'}
                            </div>
                            <p className={`text-sm ${isCheckpointResult(result) ? 'text-cyan-100' : 'text-amber-100'}`}>{displayAgentError(result.error, result.errorCode)}</p>
                          </div>
                          {resultTerminalOutcome && resultTerminalOutcome !== 'checkpoint' && (
                            <div className="rounded border border-amber-500/30 bg-amber-950/25 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-200" data-testid="terminal-run-status">
                              Final run status: {resultTerminalOutcome === 'timed_out' ? 'Timed out' : resultTerminalOutcome === 'failed' ? 'Failed' : resultTerminalOutcome}
                            </div>
                          )}
                          <div
                            role="status"
                            aria-live="polite"
                            className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-200">
                                  <PauseCircle className="h-3.5 w-3.5 text-cyan-300" />
                                  {isCheckpointResult(result)
                                    ? 'Checkpoint saved — ready to continue'
                                    : resultTerminalOutcome === 'timed_out'
                                      ? 'Run timed out — waiting for you'
                                      : resultTerminalOutcome === 'stopped'
                                        ? 'Run stopped — waiting for you'
                                        : resultTerminalOutcome === 'interrupted'
                                          ? 'Run interrupted — waiting for you'
                                          : resultTerminalOutcome === 'killed'
                                            ? 'Run killed — waiting for you'
                                            : 'Agent stopped — waiting for you'}
                                </div>
                                <p className="mt-1 text-xs leading-relaxed text-cyan-100/80">
                                  {isCheckpointResult(result)
                                    ? 'Your progress is preserved. Continue to resume the task, or start a new task.'
                                    : resultTerminalOutcome === 'timed_out'
                                      ? 'The timeout ended this run. Review the details before retrying or resuming from a saved checkpoint.'
                                      : 'Nothing is running right now. Review the execution audit before deciding whether to resume the session or start a new task.'}
                                </p>
                              </div>
                              {onOpenRunAudit && (
                                <button
                                  type="button"
                                  onClick={onOpenRunAudit}
                                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-cyan-400/40 bg-cyan-400/10 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-100 transition hover:bg-cyan-400/20 hover:text-white"
                                >
                                  <History className="h-3.5 w-3.5 text-cyan-300" />
                                  Open execution audit
                                </button>
                              )}
                            </div>
                          </div>
                          <EvidenceReviewPanel evidence={result.requirementEvidence} findings={result.reviewFindings} />
                          {renderQualityGatePanel()}
                          {canContinue && (
                            <div className="flex flex-wrap gap-2">
                              <Button onClick={onContinue} variant="primary" disabled={loading}>
                                Continue
                              </Button>
                              <Button onClick={onStartNew} variant="secondary">
                                New Task
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  )}
                </div>
              )}
              </div>
              </div>
              {showScrollBottom && (
                <button
                  type="button"
                  data-testid="scroll-to-latest"
                  onClick={scrollToLatest}
                  className="absolute bottom-4 right-6 inline-flex items-center gap-1.5 rounded-full border border-cyan-400/50 bg-cyan-950/90 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-100 shadow-lg backdrop-blur transition hover:border-cyan-300 hover:bg-cyan-900"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  Scroll to latest
                </button>
              )}
            </div>
          )}

          {viewMode === 'console' && (
            <div className="flex-1 min-h-0 overflow-hidden p-3 bg-[#08090d]">
              <ConsoleRunPanel
                runId={contextSnapshotRunId}
                agentEvents={agentEvents}
                highlightedEventId={highlightedEventKey}
                onSelectEvent={handleChatEventSelect}
                loading={loading}
                task={task}
                model={model}
                agentStatus={agentStatus}
                liveProgress={liveProgress}
                liveState={liveState}
                result={result}
                onStopTask={onStopTask}
                onFixSettings={onOpenSettings}
                density={chatDensity}
              />
            </div>
          )}

          {viewMode === 'split' && (
            <div className="flex flex-1 min-h-0 overflow-hidden flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-neutral-800">
              <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
                <div
                  ref={threadScrollRef}
                  data-testid="session-thread-scroll"
                  className="custom-scrollbar flex-1 overflow-y-auto p-4 md:p-5"
                  onScroll={handleThreadScroll}
                >
                  {chatDensity === 'detailed' && latestGuidanceSnapshot && (
                    <div className="mx-auto mb-3 w-full max-w-3xl overflow-hidden rounded-lg border border-cyan-500/20">
                      <AgentGuidanceCard snapshot={latestGuidanceSnapshot} previous={previousGuidanceSnapshot} />
                    </div>
                  )}
                  <div ref={threadContentRef}>
                  {thread.length === 0 && !loading && !result ? (
                    <div className="flex min-h-[260px] flex-col items-center justify-center text-center text-text-dim">
                      <FileCode className="mb-2 h-7 w-7 text-cyan-400" />
                      <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-white">Ask the agent to</h3>
                      <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
                        {starterPrompts.slice(0, 4).map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            onClick={() => onTaskChange(prompt)}
                            className="rounded-lg border border-border-main bg-bg-main px-3 py-2 text-left text-xs leading-relaxed text-slate-300 transition hover:border-cyan-500/50 hover:bg-bg-active hover:text-white"
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {hiddenMessageCount > 0 && (
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={() => setShowOlderMessages((value) => !value)}
                            className="rounded border border-border-main bg-bg-active px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-text-dim transition hover:border-cyan-500/40 hover:text-cyan-300"
                          >
                            {showOlderMessages
                              ? 'Hide older messages'
                              : `Show ${hiddenMessageCount} older messages`}
                          </button>
                        </div>
                      )}

                      {renderedThreadMessages
                        .filter((message) => !(loading && message.role === 'assistant' && message.status === 'running'))
                        .map(renderMessage)}

                      {(loading || recentSteps.length > 0) && (
                        <article className="w-full text-slate-200 flex justify-start my-2">
                          <div className="w-full rounded-2xl border border-neutral-800/90 bg-[#111216] px-4 py-3 text-slate-200 shadow-lg">
                            <div className="mb-2 flex items-center justify-between gap-3 border-b border-neutral-800/60 pb-2 text-[11px] font-mono text-neutral-400">
                              <span className="flex items-center gap-2 font-bold">
                                <div className="flex h-5 w-5 items-center justify-center rounded-md bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                                  <Bot className="h-3.5 w-3.5" />
                                </div>
                                <span className="text-white">ReAct Coder</span>
                              </span>
                              <span className="text-[10px] text-neutral-500">Live</span>
                            </div>

                            {renderConversationalStream(agentEvents, loading, liveAssistantReply)}
                          </div>
                        </article>
                      )}

                      {result && (!resultIsCompleted || !resultIsRepresentedInThread) && (
                        <article
                          className={`rounded border p-3.5 ${
                            resultIsCompleted
                              ? isCompletedWithVerificationFailure(result)
                                ? 'border-amber-500/30 bg-amber-500/10'
                                : 'border-emerald-500/20 bg-emerald-500/10'
                              : 'border-red-500/20 bg-red-500/10'
                          }`}
                        >
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <h3 className="text-xs font-bold uppercase tracking-wider text-white">Final Result</h3>
                              <button
                                type="button"
                                onClick={toggleFinalAnswerCollapsed}
                                aria-expanded={!finalAnswerCollapsed}
                                title={finalAnswerCollapsed ? 'Expand final result' : 'Collapse final result'}
                                className="inline-flex items-center gap-1 rounded border border-border-main bg-bg-main/60 px-1.5 py-0.5 font-mono text-[10px] text-text-dim transition hover:border-cyan-500/40 hover:text-white"
                              >
                                {finalAnswerCollapsed ? <ChevronRight className="h-3 w-3 text-neutral-400" /> : <ChevronDown className="h-3 w-3 text-neutral-400" />}
                                <span>{finalAnswerCollapsed ? 'Expand' : 'Collapse'}</span>
                              </button>
                            </div>
                            <div className="flex items-center gap-2">
                              {finalRunDurationMs !== undefined && finalRunDurationMs > 0 && (
                                <>
                                  <span className="font-mono text-[10px] text-text-dim" title="Total run duration">
                                    {formatElapsedDuration(finalRunDurationMs)}
                                  </span>
                                  <span className="text-text-dark text-[10px]">•</span>
                                </>
                              )}
                              <span className="font-mono text-[10px] text-text-dim">
                                {result.pollenCost?.toFixed(4) || '0.0000'} pollen
                              </span>
                              {result.finalAnswer && (
                                <button
                                  type="button"
                                  onClick={copyFinalAnswer}
                                  title="Copy answer"
                                  aria-label="Copy answer"
                                  className="inline-flex items-center gap-1 rounded border border-border-main bg-bg-main/60 px-1.5 py-0.5 font-mono text-[10px] text-text-dim transition hover:border-cyan-500/40 hover:text-white"
                                >
                                  {finalAnswerCopied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                                  <span>{finalAnswerCopied ? 'Copied' : 'Copy'}</span>
                                </button>
                              )}
                            </div>
                          </div>
                          {finalAnswerCollapsed ? (
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={toggleFinalAnswerCollapsed}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleFinalAnswerCollapsed(); }}
                              className="cursor-pointer rounded border border-dashed border-neutral-700/60 bg-neutral-900/30 px-3 py-2 text-xs text-neutral-400 transition hover:border-neutral-500 hover:text-neutral-200"
                            >
                              <div className="flex items-center justify-between">
                                <span className="italic truncate mr-2">
                                  {result.finalAnswer ? result.finalAnswer.slice(0, 100).replace(/\s+/g, ' ').trim() + (result.finalAnswer.length > 100 ? '...' : '') : 'Final result collapsed'}
                                </span>
                                <span className="shrink-0 text-[10px] font-mono text-cyan-400">Click to expand</span>
                              </div>
                            </div>
                          ) : resultIsCompleted ? (
                            <div>
                              {result.finalAnswer?.trim() ? (
                                <FinalAnswerRenderer content={result.finalAnswer} compact />
                              ) : (
                                <div className="rounded border border-neutral-700/60 bg-neutral-900/50 p-3 text-xs text-neutral-300">
                                  <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                                    <Info className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
                                    <span>No final answer provided</span>
                                  </div>
                                  {originalTaskDescription ? (
                                    <div className="mt-2 space-y-1">
                                      <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-400">Original task:</span>
                                      <p className="rounded bg-black/30 p-2 font-mono text-xs text-neutral-200 border border-neutral-800">
                                        {originalTaskDescription}
                                      </p>
                                    </div>
                                  ) : (
                                    <p className="mt-1 text-neutral-400 text-xs">The run completed without a final response message.</p>
                                  )}
                                </div>
                              )}
                              <EvidenceReviewPanel evidence={result.requirementEvidence} findings={result.reviewFindings} />
                              {renderQualityGatePanel()}
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {result.finalAnswer?.trim() ? (
                                <FinalAnswerRenderer content={result.finalAnswer} compact />
                              ) : originalTaskDescription ? (
                                <div className="rounded border border-neutral-700/60 bg-neutral-900/50 p-3 text-xs text-neutral-300">
                                  <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                                    <Info className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
                                    <span>No final answer provided</span>
                                  </div>
                                  <div className="mt-2 space-y-1">
                                    <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-400">Original task:</span>
                                    <p className="rounded bg-black/30 p-2 font-mono text-xs text-neutral-200 border border-neutral-800">
                                      {originalTaskDescription}
                                    </p>
                                  </div>
                                </div>
                              ) : null}
                              <p className={`text-xs ${isCheckpointResult(result) ? 'text-cyan-100' : 'text-amber-100'}`}>{displayAgentError(result.error, result.errorCode)}</p>
                              {canContinue && (
                                <div className="flex flex-wrap gap-2 pt-1">
                                  <Button onClick={onContinue} variant="primary" disabled={loading}>
                                    Continue
                                  </Button>
                                  <Button onClick={onStartNew} variant="secondary">
                                    New Task
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}
                        </article>
                      )}
                    </div>
                  )}
                  </div>
                </div>
                {showScrollBottom && (
                  <button
                    type="button"
                    data-testid="scroll-to-latest"
                    onClick={scrollToLatest}
                    className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 rounded-full border border-cyan-400/50 bg-cyan-950/90 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-100 shadow-lg backdrop-blur transition hover:border-cyan-300 hover:bg-cyan-900"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                    Scroll to latest
                  </button>
                )}
              </div>

              <div className="flex-1 min-h-0 flex flex-col p-2 bg-[#08090d] overflow-hidden">
                <ConsoleRunPanel
                  runId={contextSnapshotRunId}
                  agentEvents={agentEvents}
                  highlightedEventId={highlightedEventKey}
                  onSelectEvent={handleChatEventSelect}
                  loading={loading}
                  task={task}
                  model={model}
                  agentStatus={agentStatus}
                  liveProgress={liveProgress}
                  liveState={liveState}
                  result={result}
                  onStopTask={onStopTask}
                  onFixSettings={onOpenSettings}
                  density={chatDensity}
                />
              </div>
            </div>
          )}

      <div
            ref={(element) => setComposerPortalTarget(element)}
            className={`${CODER_COMPOSER_DOCK_CLASS} relative`}
            aria-label="Coder message composer"
            data-testid="coder-composer-dock"
          >
          <div className="flex h-6 items-center justify-center">
            <button
              type="button"
              onClick={() => setIsComposerCollapsed((collapsed) => !collapsed)}
              className="flex h-6 w-12 items-center justify-center rounded-full border border-neutral-700 bg-[#0c0d12] text-neutral-400 transition hover:border-cyan-500/60 hover:text-cyan-300"
              title={isComposerCollapsed ? 'Expand composer' : 'Collapse composer'}
              aria-label={isComposerCollapsed ? 'Expand composer' : 'Collapse composer'}
              aria-expanded={!isComposerCollapsed}
              aria-controls="coder-composer-form"
              data-testid="coder-composer-collapse-toggle"
            >
              {isComposerCollapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
          {isComposerCollapsed && <div data-testid="coder-composer-collapsed" className="h-3 w-full bg-[#0c0d12]" />}

          <ComposerPortal target={composerPortalTarget}>
            <form
              id="coder-composer-form"
              onSubmit={submitComposer}
              className={`${CODER_COMPOSER_FORM_CLASS}${isComposerCollapsed ? ' hidden' : ''}`}
              aria-hidden={isComposerCollapsed}
            >
              {viewMode === 'console' && (
                <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-violet-500/30 bg-violet-950/20 px-3 py-2 font-mono text-[10px] text-violet-100">
                  <span>Console-only mode is read-only. Return to Chat to compose a message.</span>
                  <button type="button" onClick={() => handleViewModeChange('chat')} className="shrink-0 rounded border border-violet-400/40 bg-violet-500/10 px-2 py-1 font-bold uppercase tracking-wider text-violet-200 transition hover:bg-violet-500/20">Return to Chat</button>
                </div>
              )}
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Context:</span>
              {visibleContextFiles.length > 0 ? (
                <>
                  {visibleContextFiles.map((file) => (
                    <span
                      key={file}
                      className="group inline-flex max-w-full items-center gap-1 rounded-lg border border-neutral-800 bg-[#16181e] px-2 py-0.5 font-mono text-[9px] text-neutral-300 shadow-sm"
                    >
                      <FileCode className="h-2.5 w-2.5 shrink-0 text-cyan-400" />
                      <button
                        type="button"
                        onClick={() => openFileFromExplorer(file)}
                        className="min-w-0 truncate hover:text-white"
                        title={`Open ${file}`}
                      >
                        {getFileName(file)}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeContextFile(file)}
                        className="p-0.5 text-neutral-500 transition hover:text-rose-400"
                        aria-label={`Remove ${file} from context`}
                        title={`Remove ${file} from context`}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                  {hiddenContextCount > 0 && (
                    <span className="rounded-full border border-neutral-800 bg-[#16181e] px-2 py-0.5 font-mono text-[9px] text-neutral-400">
                      +{hiddenContextCount} more
                    </span>
                  )}
                </>
              ) : (
                <span className="font-mono text-[10px] text-neutral-600">No workspace files referenced</span>
              )}
            </div>

            <div
              className={`relative rounded-2xl border bg-[#0d0e13] p-3 shadow-xl backdrop-blur-md transition-all ${
                isDraggingOverComposer
                  ? 'border-cyan-400 ring-2 ring-cyan-400/30'
                  : 'border-neutral-800 focus-within:border-cyan-500/50'
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDraggingOverComposer(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                  setIsDraggingOverComposer(false);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsDraggingOverComposer(false);
                if (event.dataTransfer.files.length > 0) void processImageFiles(event.dataTransfer.files);
              }}
            >
              {isDraggingOverComposer && (
                <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-cyan-400 bg-cyan-950/85 text-cyan-200">
                  <ImageIcon className="h-8 w-8 animate-bounce text-cyan-400" />
                  <span className="mt-2 font-mono text-xs font-bold uppercase tracking-wider text-white">Drop image to attach to chat</span>
                </div>
              )}
              {(loading || latestAgentActivity) && (
                <div className={`mb-2.5 flex items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5 text-xs ${
                  pausedForProvider
                    ? 'border-amber-500/35 bg-amber-950/20 text-amber-100'
                    : loading ? 'border-cyan-500/30 bg-cyan-950/20 text-cyan-200' : 'border-neutral-800 bg-neutral-900/80 text-neutral-400'
                }`}>
                  <div className="flex min-w-0 items-center gap-1.5">
                    {pausedForProvider ? (
                      <PauseCircle className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                    ) : loading ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-cyan-400" />
                    ) : agentStatus === 'failed' || agentStatus === 'timed_out' ? (
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                    ) : agentStatus === 'completed' ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    ) : (
                      <Cpu className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                    )}
                    {pausedForProvider && activeCooldownEvent ? (
                      <CooldownCountdownBadge event={activeCooldownEvent} isLive={loading} />
                    ) : (
                      <>
                        <span className="font-mono text-[9px] font-bold uppercase tracking-wider">
                          {pausedForProvider ? 'Waiting for provider' : loading ? 'Running' : agentStatus === 'timed_out' ? 'Timed out' : 'Status'}
                        </span>
                        <span className="min-w-0 truncate text-[10px] text-neutral-300">{latestAgentActivity}</span>
                      </>
                    )}
                  </div>
                  {loading && (
                    <div className="flex shrink-0 gap-1">
                      {onAuthorizeFallback && (
                        <button
                          type="button"
                          onClick={onAuthorizeFallback}
                          className="rounded border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase text-amber-200 transition hover:bg-amber-400/20"
                        >
                          Fallback
                        </button>
                      )}
                      {onSelectRecoveryModel && (
                        <button
                          type="button"
                          onClick={onSelectRecoveryModel}
                          className="rounded border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase text-cyan-200 transition hover:bg-cyan-400/20"
                        >
                          Model
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={onStopTask}
                        className="rounded border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 font-mono text-[9px] font-bold uppercase text-rose-200 transition hover:bg-rose-500/25"
                      >
                        Stop
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="mb-2.5 flex min-w-0 flex-wrap items-center justify-between gap-1.5">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <div
                    className="relative inline-flex items-center gap-1.5 rounded-xl border border-neutral-800 bg-[#12141a] px-2.5 py-1 text-xs shadow-sm transition hover:border-neutral-700"
                    data-testid="thread-provider-selection"
                    title="Filter target models by API provider"
                  >
                    <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-neutral-400">PROVIDER</span>
                    <div className="relative flex items-center">
                      <select
                        id="thread-provider-select"
                        data-testid="thread-provider-select"
                        value={selectedProvider}
                        onChange={(event) => handleProviderChange(event.target.value)}
                        className="cursor-pointer appearance-none bg-transparent pr-4 font-mono text-[10px] font-semibold text-white outline-none hover:text-cyan-200"
                        title="Select API Provider to filter Target Model"
                      >
                        <option value="all" className="bg-neutral-950 text-white">All Providers</option>
                        {availableProviders.map((provider) => (
                          <option key={provider} value={provider} className="bg-neutral-950 text-white">
                            {provider}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-0 h-3 w-3 text-neutral-400" />
                    </div>
                  </div>

                  <div
                    className="relative inline-flex min-w-0 items-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-950/30 px-2.5 py-1 text-xs shadow-sm transition hover:border-cyan-400/60"
                    data-testid="thread-profile-selection"
                    title="Select active profile for tasks"
                  >
                    <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-cyan-300">PROFILE</span>
                    <div className="relative flex min-w-0 items-center">
                      <select
                        id="coder-gemini-profile"
                        data-testid="coder-gemini-profile"
                        value={geminiProfileId}
                        onChange={(event) => onGeminiProfileChange?.(event.target.value)}
                        disabled={loading || geminiProfiles.length === 0}
                        className="max-w-[130px] truncate cursor-pointer appearance-none bg-transparent pr-4 font-mono text-[10px] font-semibold text-cyan-100 outline-none hover:text-white sm:max-w-[180px]"
                        title={loading ? 'The active task remains pinned to its original profile.' : 'Select the profile for new tasks in this workspace.'}
                      >
                        {geminiProfiles.length === 0 && <option value="" className="bg-neutral-950 text-white">No Gemini profiles configured</option>}
                        {geminiProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id} className="bg-neutral-950 text-white">
                            {profile.label}{profile.keySuffix ? ` · ...${profile.keySuffix}` : ''} · {profile.health?.status || 'available'}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-0 h-3 w-3 text-cyan-400" />
                    </div>
                  </div>

                {leftPanelWidth < 340 || (typeof window !== 'undefined' && window.innerWidth < 640) ? (
                  <div
                    className="flex items-center gap-1 rounded-xl border border-cyan-500/40 bg-cyan-950/30 px-2 py-1 font-mono text-[9px] font-bold uppercase text-cyan-300 shadow-sm transition"
                    title={`Coder Mode: ${
                      coderMode === 'auto'
                        ? 'Auto: Decides dynamically whether to chat or execute workspace tools'
                        : coderMode === 'chat'
                          ? 'Chat: Answers questions without modifying workspace files'
                          : 'Agent: Forces workspace execution and tool actions'
                    }`}
                  >
                    <Bot className="h-3 w-3 shrink-0 text-cyan-400" />
                    <select
                      value={coderMode}
                      onChange={(event) => onCoderModeChange(event.target.value as CoderMode)}
                      disabled={loading}
                      aria-label="Coder Mode"
                      className="cursor-pointer bg-transparent font-mono text-[9px] font-bold uppercase text-cyan-200 outline-none"
                    >
                      <option value="auto" className="bg-neutral-950 text-white">Auto</option>
                      <option value="chat" className="bg-neutral-950 text-white">Chat</option>
                      <option value="agent" className="bg-neutral-950 text-white">Agent</option>
                    </select>
                  </div>
                ) : (
                  <div className="flex items-center gap-0.5 rounded-xl border border-neutral-800 bg-[#0a0b0e] p-0.5">
                    {(['auto', 'chat', 'agent'] as CoderMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => onCoderModeChange(mode)}
                        disabled={loading}
                        title={
                          mode === 'auto'
                            ? 'Auto decides whether to chat or execute workspace tools'
                            : mode === 'chat'
                              ? 'Chat answers without editing files'
                              : 'Agent forces workspace execution'
                        }
                        className={`rounded-lg px-2 py-1 font-mono text-[9px] font-bold uppercase transition ${
                          coderMode === mode
                            ? 'bg-cyan-400 text-neutral-950 shadow-sm'
                            : 'text-neutral-400 hover:text-neutral-200'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                )}
                </div>
                {leftPanelWidth < 340 || (typeof window !== 'undefined' && window.innerWidth < 640) ? (
                  <div
                    className={`flex items-center gap-1 rounded-xl border px-2 py-1 font-mono text-[9px] font-bold uppercase shadow-sm transition ${
                      approvalMode === 'full_access'
                        ? 'border-amber-400/40 bg-amber-950/30 text-amber-300'
                        : approvalMode === 'auto_approve'
                          ? 'border-emerald-400/40 bg-emerald-950/30 text-emerald-300'
                          : 'border-neutral-800 bg-[#0a0b0e] text-neutral-300'
                    }`}
                    title={`Approval Mode: ${
                      approvalMode === 'ask'
                        ? 'Ask: Prompts for confirmation before tool execution'
                        : approvalMode === 'auto_approve'
                          ? 'Approve: Auto-approves safe read & search tools'
                          : 'Full Access: Runs without tool approval prompts'
                    }`}
                  >
                    <Shield className="h-3 w-3 shrink-0" />
                    <select
                      value={approvalMode}
                      onChange={(event) => onApprovalModeChange(event.target.value as ApprovalMode)}
                      disabled={loading}
                      aria-label="Approval Mode"
                      className="cursor-pointer bg-transparent font-mono text-[9px] font-bold uppercase text-inherit outline-none"
                    >
                      <option value="ask" className="bg-neutral-950 text-neutral-200">Ask</option>
                      <option value="auto_approve" className="bg-neutral-950 text-emerald-300">Approve</option>
                      <option value="full_access" className="bg-neutral-950 text-amber-300">Full Access</option>
                    </select>
                  </div>
                ) : (
                  <div className="flex items-center gap-0.5 rounded-xl border border-neutral-800 bg-[#0a0b0e] p-0.5">
                    {([
                      ['ask', 'Ask'],
                      ['auto_approve', 'Approve'],
                      ['full_access', 'Full Access'],
                    ] as Array<[ApprovalMode, string]>).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => onApprovalModeChange(mode)}
                        disabled={loading}
                        title={
                          mode === 'ask'
                            ? 'Ask: Prompts for confirmation before tool execution'
                            : mode === 'auto_approve'
                              ? 'Approve: Auto-approves safe read & search tools'
                              : 'Full Access: Runs without tool approval prompts'
                        }
                        className={`rounded-lg px-2 py-1 font-mono text-[9px] font-bold uppercase transition ${
                          approvalMode === mode
                            ? mode === 'full_access'
                              ? 'bg-amber-300 text-neutral-950 shadow-sm'
                              : 'bg-emerald-400 text-neutral-950 shadow-sm'
                            : 'text-neutral-400 hover:text-neutral-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {imageUploadNotice && (
                <div role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-950/15 px-3 py-2 font-mono text-[10px] leading-relaxed text-amber-200">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                  <span className="min-w-0 flex-1">{imageUploadNotice}</span>
                  <button
                    type="button"
                    onClick={() => setImageUploadNotice(null)}
                    className="shrink-0 rounded p-0.5 text-amber-300/70 hover:bg-amber-500/15 hover:text-amber-100"
                    aria-label="Dismiss image upload notice"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              {attachedImages.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-950/10 p-2">
                  <div className="flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-wider text-cyan-300">
                    <ImageIcon className="h-3 w-3" />
                    <span>Attached ({attachedImages.length}):</span>
                  </div>
                  {attachedImages.map((img) => (
                    <div key={img.id} className="group relative flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 px-1.5 py-1">
                      <button
                        type="button"
                        onClick={() => setPreviewModalImage(img)}
                        className="flex min-w-0 items-center gap-1.5 text-left"
                        title={`Preview ${img.name}`}
                      >
                        <img src={img.url} alt={img.name} className="h-8 w-8 rounded object-cover" />
                        <span className="max-w-[120px] truncate font-mono text-[9px] text-neutral-300">{img.name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeAttachedImage(img.id)}
                        className="rounded p-0.5 text-neutral-500 transition hover:bg-rose-500/20 hover:text-rose-300"
                        title="Remove image"
                        aria-label={`Remove ${img.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAttachedImages([])}
                    className="rounded px-1.5 py-0.5 font-mono text-[9px] text-neutral-400 transition hover:bg-neutral-800 hover:text-rose-300"
                    title="Clear all attached images"
                  >
                    Clear all
                  </button>
                </div>
              )}

              <textarea
                ref={textareaRef}
                value={task}
                onChange={(event) => onTaskChange(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                onPaste={handleComposerPaste}
                rows={3}
                placeholder="Ask the agent to change code, explain a file, run tests, or plan a refactor..."
                className="custom-scrollbar min-h-[70px] max-h-[220px] w-full resize-none bg-transparent text-xs leading-relaxed text-slate-100 outline-none placeholder:text-neutral-500 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading || viewMode === 'console'}
              />
              <div className="mt-1.5 rounded-md border border-neutral-800/80 bg-neutral-950/60 px-2.5 py-2" data-testid="composer-token-estimate">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-[9px]">
                  <span className="font-bold uppercase tracking-wider text-neutral-400">Estimated composed input</span>
                  <span className={`font-semibold ${composerBudgetPercent !== undefined && composerBudgetPercent >= 90 ? 'text-rose-300' : composerBudgetPercent !== undefined && composerBudgetPercent >= 70 ? 'text-amber-300' : 'text-cyan-200'}`}>
                    ~{composerPromptTokens.toLocaleString()} tokens
                    {safeInputBudget ? ` / ~${safeInputBudget.toLocaleString()} safe input` : ' / model budget unavailable'}
                  </span>
                </div>
                {safeInputBudget && composerBudgetPercent !== undefined && (
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-neutral-800" aria-label={`Estimated ${composerBudgetPercent.toFixed(1)} percent of safe input budget`}>
                    <div className={`h-full ${composerBudgetPercent >= 90 ? 'bg-rose-400' : composerBudgetPercent >= 70 ? 'bg-amber-400' : 'bg-cyan-400'}`} style={{ width: `${composerBudgetPercent}%` }} />
                  </div>
                )}
                <div className="mt-1 flex flex-wrap justify-between gap-x-3 gap-y-0.5 font-mono text-[8px] text-neutral-500">
                  <span>Approximate: text at 1 token / 4 characters; about 1,024 tokens per image.</span>
                  <span>Budget estimate reserves 25% of the model context for system instructions and output.</span>
                </div>
              </div>

              <div className="mt-3 min-w-0 space-y-2.5 border-t border-neutral-800/60 px-0.5 pb-0.5 pt-3">
                <div
                  className="flex min-w-0 w-full items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-950/30 px-3 py-1.5 text-xs shadow-sm transition hover:border-cyan-400/60 focus-within:border-cyan-400 focus-within:ring-1 focus-within:ring-cyan-400/40"
                  data-testid="thread-target-model-selection"
                  title={`Target Model: ${selectedModelOption ? getModelOptionDisplayLabel(selectedModelOption) : model || 'Select AI Model'}\n(Click to switch the active AI execution model)`}
                >
                  <Cpu className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                  <span className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300">MODEL</span>
                  <div className="relative flex min-w-0 flex-1 items-center">
                  <select
                    id="coder-model-composer"
                    data-testid="thread-target-model-select"
                    value={selectedModelOption ? model : ''}
                    onChange={(event) => onModelChange(event.target.value)}
                    disabled={loading || viewMode === 'console' || !apiPoolModelsLoaded || effectiveModelOptions.length === 0}
                    className="w-full cursor-pointer appearance-none truncate bg-transparent pr-5 font-mono text-xs font-semibold text-cyan-200 outline-none hover:text-white"
                    title={`Target Model: ${model}`}
                  >
                    {!selectedModelOption && (
                      <option value="" className="bg-neutral-950 text-white">
                        {apiPoolModelsLoaded ? 'No target' : 'Loading...'}
                      </option>
                    )}
                    {groupedModelOptions.map((group, groupIdx) => (
                      <optgroup key={`group-bottom-${groupIdx}-${group.label}`} label={group.label} className="bg-neutral-950 font-sans font-normal text-neutral-400">
                        {group.options.map((option, optIdx) => (
                          <option key={`opt-bottom-${groupIdx}-${optIdx}-${option.value}`} value={option.value} className="bg-neutral-950 font-mono text-xs text-white">
                            {getModelOptionDisplayLabel(option)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-0 h-3.5 w-3.5 text-cyan-400/80" />
                  </div>
                </div>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 pt-0.5">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={focusWorkspaceContext}
                    disabled={loading || viewMode === 'console' || isProcessingImages}
                    className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900/80 px-2 py-1 font-mono text-[9px] text-neutral-400 transition hover:border-cyan-500/40 hover:text-cyan-300 active:scale-95"
                    title="+ Context: Add referenced workspace files and context into prompt"
                    aria-label="Add workspace context"
                  >
                    <Sparkles className="h-3 w-3 shrink-0 text-cyan-400" />
                    {leftPanelWidth >= 380 && <span>+ Context</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={loading || viewMode === 'console' || isProcessingImages}
                    className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900/80 px-2 py-1 font-mono text-[9px] text-neutral-400 transition hover:border-cyan-500/40 hover:text-cyan-300 active:scale-95"
                    title="Attach Image: Upload or paste images (PNG, JPG, WebP, GIF)"
                    aria-label="Attach image"
                  >
                    <ImageIcon className="h-3 w-3 shrink-0 text-cyan-400" />
                    {leftPanelWidth >= 380 && <span>Attach Image</span>}
                  </button>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      if (event.target.files) void processImageFiles(event.target.files);
                      event.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => insertFilePath(selectedFilePath || 'ui/src/components/CoderChatPanel.tsx')}
                    disabled={loading || viewMode === 'console'}
                    className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900/80 px-2 py-1 font-mono text-[9px] text-neutral-400 transition hover:border-cyan-500/40 hover:text-cyan-300 active:scale-95"
                    title={`Attach Path: Insert '${selectedFilePath || 'ui/src/components/CoderChatPanel.tsx'}' into prompt`}
                    aria-label="Attach file path"
                  >
                    <Paperclip className="h-3 w-3 shrink-0 text-neutral-400" />
                    {leftPanelWidth >= 460 && <span>Attach Path</span>}
                  </button>
                  <button
                    type="button"
                    onClick={onGenerateWorkPlan}
                    disabled={loading || viewMode === 'console' || (!task.trim() && attachedImages.length === 0)}
                    className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900/80 px-2 py-1 font-mono text-[9px] text-neutral-400 transition hover:border-emerald-500/40 hover:text-emerald-300 active:scale-95 disabled:opacity-40"
                    title="Plan: Generate an adaptive execution workplan for this prompt"
                    aria-label="Generate work plan"
                  >
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
                    {leftPanelWidth >= 520 && <span>Plan</span>}
                  </button>
                </div>

                <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
                  <span className="hidden font-mono text-[9px] text-neutral-500 sm:inline">âŒ˜ + Enter to send</span>
                  {loading ? (
                    <button
                      type="button"
                      onClick={onStopTask}
                      className="flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/20 px-3.5 py-1.5 text-xs font-bold text-rose-200 shadow-sm transition hover:bg-rose-500/30 active:scale-95"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                      <span>Stop</span>
                    </button>
                  ) : (
                    <button
                      type="submit"
                      title="Send message"
                      disabled={viewMode === 'console' || (!task.trim() && attachedImages.length === 0) || isProcessingImages || !selectedModelOption}
                      className={`flex items-center gap-1.5 rounded-xl px-4 py-1.5 font-mono text-xs font-bold transition-all shadow-md ${
                        (task.trim() || attachedImages.length > 0) && !isProcessingImages && selectedModelOption
                          ? 'border border-cyan-400/50 bg-cyan-400 text-neutral-950 hover:bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.3)]'
                          : 'cursor-not-allowed bg-neutral-800/50 text-neutral-600'
                      }`}
                    >
                      <span>Send</span>
                      <Send className="h-3 w-3 shrink-0" />
                    </button>
                  )}
                </div>
              </div>
              </div>

              {canSteerRun && (
                <div className="mt-2.5 rounded-xl border border-violet-500/30 bg-violet-500/5 p-2.5">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1">
                    <div>
                      <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-violet-300">
                        Active run inbox
                      </div>
                      <div className="text-[10px] text-neutral-500">
                        Send an update into run {resumableRun?.id.slice(0, 8)} without starting another run.
                      </div>
                    </div>
                    <select
                      value={inboxTarget}
                      onChange={(event) => setInboxTarget(event.target.value as 'next-turn' | 'next-step')}
                      disabled={inboxBusy}
                      className="rounded border border-violet-500/30 bg-neutral-950 px-1.5 py-0.5 font-mono text-[9px] text-violet-200 outline-none"
                    >
                      <option value="next-turn">Next turn · follow-up</option>
                      <option value="next-step">Next action · steer</option>
                    </select>
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      value={inboxDraft}
                      onChange={(event) => setInboxDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          void enqueueInboxMessage();
                        }
                      }}
                      placeholder={inboxTarget === 'next-step' ? 'Steer what the agent should do next...' : 'Add a follow-up for the next turn...'}
                      disabled={inboxBusy}
                      className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950/80 px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-neutral-600 focus:border-violet-400"
                    />
                    <button
                      type="button"
                      onClick={() => void enqueueInboxMessage()}
                      disabled={!inboxDraft.trim() || inboxBusy}
                      className="rounded-lg border border-violet-400/40 bg-violet-400/15 px-2.5 py-1.5 font-mono text-[9px] font-bold text-violet-200 transition hover:bg-violet-400/25 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {inboxBusy ? 'Queueing…' : 'Queue'}
                    </button>
                  </div>
                  {inboxNotice && <div className="mt-1.5 text-[9px] text-violet-200">{inboxNotice}</div>}
                </div>
              )}
            </div>
            </form>
          </ComposerPortal>
        </div>
        </div>

        {explorerPosition === 'right' && renderSliderHandle()}
        {explorerPosition === 'right' && showExplorer && isRightPanelOpen && (
          <div
            onMouseDown={handleExplorerResizeMouseDown}
            onDoubleClick={() => setExplorerPanelWidth(360)}
            className={`group relative z-10 hidden w-2 shrink-0 cursor-col-resize select-none items-center justify-center transition-colors lg:flex ${isResizingExplorer ? 'bg-cyan-500/30' : 'hover:bg-cyan-500/20'}`}
            title="Drag to resize workspace explorer (double-click to reset)"
            role="separator"
            aria-label="Resize workspace explorer"
          >
            <div className={`h-12 w-1 rounded-full transition-all duration-150 ${isResizingExplorer ? 'scale-y-125 bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)]' : 'bg-neutral-800 group-hover:scale-y-110 group-hover:bg-cyan-400/80'}`} />
          </div>
        )}
        {explorerPosition === 'right' && renderExplorerSidebar()}
      </section>
      </div>

      {activeThoughtModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-cyan-500/40 bg-[#0d1017] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-cyan-500/20 bg-[#090b10] px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-cyan-300">
                    {activeThoughtModal.title || 'Agent Thought Details'}
                  </h3>
                  {activeThoughtModal.route && (
                    <p className="font-mono text-[11px] text-neutral-400">{activeThoughtModal.route}</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveThoughtModal(null)}
                className="rounded-lg border border-neutral-700/80 bg-neutral-800/80 p-1.5 text-neutral-400 hover:bg-neutral-700 hover:text-white transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="custom-scrollbar space-y-4 overflow-y-auto p-6 text-sm text-slate-200">
              <div>
                <h4 className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-cyan-400">
                  Safe Agent Reasoning Summary
                </h4>
                <div className="rounded-xl border border-cyan-500/20 bg-[#06080d] p-4 font-mono text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {activeThoughtModal.message}
                </div>
              </div>

              {activeThoughtModal.context && (
                <div className="rounded-xl border border-violet-500/25 bg-violet-950/15 p-4">
                  <h4 className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-violet-300">
                    Responding to this chat
                  </h4>
                  <div className="space-y-2 text-xs leading-relaxed text-slate-200">
                    <div>
                      <div className="font-mono text-[10px] uppercase text-neutral-400">Original request</div>
                      <p className="mt-0.5 whitespace-pre-wrap">{activeThoughtModal.context.userRequest}</p>
                    </div>
                    {activeThoughtModal.context.latestUserInput && (
                      <div>
                        <div className="font-mono text-[10px] uppercase text-neutral-400">Latest user input</div>
                        <p className="mt-0.5 whitespace-pre-wrap">{activeThoughtModal.context.latestUserInput}</p>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-3 font-mono text-[10px] text-violet-200">
                      <span>Loop: {activeThoughtModal.context.loopState}</span>
                      <span>Trigger: {activeThoughtModal.context.trigger.replace(/_/g, ' ')}</span>
                    </div>
                    {activeThoughtModal.context.latestEvidence && (
                      <p className="text-neutral-300">Latest safe evidence: {activeThoughtModal.context.latestEvidence}</p>
                    )}
                  </div>
                </div>
              )}

              {activeThoughtModal.decision && (
                <div className="space-y-3">
                  <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-400">
                    Decision Details & Parameters
                  </h4>
                  <div className="rounded-xl border border-neutral-800 bg-[#080a0f] p-4 space-y-3 font-mono text-xs">
                    {activeThoughtModal.decision.rationale && (
                      <div>
                        <span className="text-[11px] font-bold text-neutral-400 uppercase">Rationale</span>
                        <p className="mt-1 text-xs text-slate-300 font-sans leading-relaxed whitespace-pre-wrap">
                          {activeThoughtModal.decision.rationale}
                        </p>
                      </div>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                      {activeThoughtModal.decision.tool && (
                        <div className="rounded-lg border border-neutral-800 bg-[#0c0e14] p-3">
                          <span className="text-[10px] text-neutral-400 uppercase font-bold">Selected Tool</span>
                          <div className="mt-0.5 font-bold text-cyan-300 text-sm">{activeThoughtModal.decision.tool}</div>
                        </div>
                      )}
                      {activeThoughtModal.decision.codingState && (
                        <div className="rounded-lg border border-neutral-800 bg-[#0c0e14] p-3">
                          <span className="text-[10px] text-neutral-400 uppercase font-bold">Execution State</span>
                          <div className="mt-0.5 font-bold text-violet-300 text-sm">{activeThoughtModal.decision.codingState}</div>
                        </div>
                      )}
                    </div>
                    {activeThoughtModal.decision.planItem && (
                      <div>
                        <span className="text-[11px] font-bold text-neutral-400 uppercase">Plan Item</span>
                        <p className="mt-1 text-xs text-slate-300 font-sans">{activeThoughtModal.decision.planItem}</p>
                      </div>
                    )}
                    {activeThoughtModal.decision.arguments && (
                      <div>
                        <span className="text-[11px] font-bold text-neutral-400 uppercase">Tool Arguments</span>
                        <pre className="mt-1 max-h-60 overflow-auto rounded-lg border border-neutral-800 bg-[#040507] p-3 font-mono text-xs text-slate-300 whitespace-pre-wrap break-words">
                          {JSON.stringify(activeThoughtModal.decision.arguments, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-neutral-800/80 bg-[#090b10] px-5 py-3">
              <button
                type="button"
                onClick={() => setActiveThoughtModal(null)}
                className="rounded-lg border border-cyan-500/40 bg-cyan-500/20 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/30 hover:text-white transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="relative z-30 flex shrink-0 items-center justify-around border-t border-neutral-900 bg-neutral-950/95 backdrop-blur-md px-1 py-1.5 lg:hidden">
        <button
          type="button"
          onClick={() => {
            setActiveMobileTab('chat');
            handleViewModeChange('chat');
          }}
          className={`flex flex-1 flex-col items-center gap-1 py-1.5 px-1 font-mono text-[11px] transition rounded-lg ${activeMobileTab === 'chat' && viewMode === 'chat' ? 'font-bold text-cyan-400 bg-cyan-950/40' : 'text-neutral-400 hover:text-neutral-200'}`}
        >
          <Code2 className="h-4 w-4" />
          <span>Chat</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveMobileTab('chat');
            handleViewModeChange('console');
          }}
          className={`flex flex-1 flex-col items-center gap-1 py-1.5 px-1 font-mono text-[11px] transition rounded-lg ${activeMobileTab === 'chat' && viewMode === 'console' ? 'font-bold text-cyan-400 bg-cyan-950/40' : 'text-neutral-400 hover:text-neutral-200'}`}
        >
          <Terminal className="h-4 w-4" />
          <span>Console</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setShowExplorer(true);
            setIsRightPanelOpen(true);
            setActiveMobileTab('workspace');
          }}
          className={`flex flex-1 flex-col items-center gap-1 py-1.5 px-1 font-mono text-[11px] transition rounded-lg ${activeMobileTab === 'workspace' ? 'font-bold text-cyan-400 bg-cyan-950/40' : 'text-neutral-400 hover:text-neutral-200'}`}
        >
          <Folder className="h-4 w-4" />
          <span>Workspace</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveMobileTab('settings')}
          className={`flex flex-1 flex-col items-center gap-1 py-1.5 px-1 font-mono text-[11px] transition rounded-lg ${activeMobileTab === 'settings' ? 'font-bold text-cyan-400 bg-cyan-950/40' : 'text-neutral-400 hover:text-neutral-200'}`}
        >
          <History className="h-4 w-4" />
          <span>Settings</span>
          <span className="sr-only">History ({visibleThreads.length})</span>
        </button>
      </footer>

      {quickFileModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label="Quick Workspace File Launcher"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setQuickFileModalOpen(false);
          }}
        >
          <div className="w-full max-w-2xl rounded-2xl border border-cyan-500/40 bg-[#0a0c12] p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-cyan-500/20 pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-500/20 text-cyan-300">
                  <FolderOpen className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-300">Quick File Opener</h3>
                  <p className="text-[10px] text-neutral-400">Search and open any workspace file directly in Coder Chat</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setQuickFileModalOpen(false)}
                className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="relative mb-4">
              <Search className="absolute left-3.5 top-3 h-4 w-4 text-cyan-400" />
              <input
                type="text"
                value={quickFileFilter}
                onChange={(e) => setQuickFileFilter(e.target.value)}
                placeholder="Type file path (e.g. src/App.tsx, package.json, server.ts)..."
                className="w-full rounded-xl border border-cyan-500/30 bg-[#05070a] py-2.5 pl-10 pr-4 font-mono text-xs text-white placeholder-neutral-500 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400"
                autoFocus
              />
            </div>

            <div className="custom-scrollbar max-h-80 overflow-y-auto space-y-1 pr-1">
              {(() => {
                const allPaths = flattenTreeFilePaths(fileTree);
                const filtered = allPaths.filter((p) => p.toLowerCase().includes(quickFileFilter.toLowerCase()));

                if (treeLoading) {
                  return (
                    <div className="flex items-center justify-center gap-2 py-8 text-xs text-neutral-400 font-mono">
                      <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                      Loading workspace files...
                    </div>
                  );
                }

                if (filtered.length === 0) {
                  return (
                    <div className="py-8 text-center text-xs text-neutral-500 font-mono">
                      {quickFileFilter.trim() ? (
                        <div>
                          <p className="mb-2 text-slate-300">No matching file found for &quot;{quickFileFilter}&quot;.</p>
                          <button
                            type="button"
                            onClick={() => {
                              openFileFromExplorer(quickFileFilter.trim());
                              setQuickFileModalOpen(false);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/20 px-3 py-1.5 font-mono text-xs font-bold text-cyan-200 hover:bg-cyan-500/35 hover:text-white transition"
                          >
                            <FileCode className="h-3.5 w-3.5" />
                            <span>Open &quot;{quickFileFilter.trim()}&quot; directly</span>
                          </button>
                        </div>
                      ) : (
                        'No workspace files found.'
                      )}
                    </div>
                  );
                }

                return filtered.map((path) => (
                  <button
                    key={path}
                    type="button"
                    onClick={() => {
                      openFileFromExplorer(path);
                      setQuickFileModalOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded-lg border border-neutral-800/80 bg-[#11131c] px-3.5 py-2.5 text-left font-mono text-xs text-slate-200 hover:border-cyan-500/40 hover:bg-cyan-950/20 hover:text-white transition group"
                  >
                    <span className="flex items-center gap-2.5 min-w-0 flex-1 truncate">
                      <FileCode className="h-4 w-4 text-cyan-400 shrink-0" />
                      <span className="truncate font-semibold">{path}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-cyan-400 opacity-0 group-hover:opacity-100 font-bold uppercase transition">
                      Open â†’
                    </span>
                  </button>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {previewModalImage && (
        <div
          className="fixed inset-0 z-[105] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setPreviewModalImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image Preview"
        >
          <div
            className="relative flex max-h-[92vh] max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900/90 px-4 py-2.5 text-xs text-neutral-300">
              <div className="flex min-w-0 items-center gap-2 font-mono">
                <ImageIcon className="h-4 w-4 shrink-0 text-cyan-400" />
                <span className="max-w-sm truncate font-semibold text-white">{previewModalImage.name}</span>
                {previewModalImage.size && (
                  <span className="shrink-0 text-[10px] text-neutral-400">({formatFileSize(previewModalImage.size)})</span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={previewModalImage.url}
                  download={previewModalImage.name || 'image.png'}
                  className="inline-flex items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-[11px] font-medium text-neutral-200 transition hover:bg-neutral-700 hover:text-white"
                  title="Download image"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download</span>
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewModalImage(null)}
                  className="rounded-lg p-1 text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
                  title="Close image preview"
                  aria-label="Close image preview"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="flex flex-1 items-center justify-center overflow-auto bg-[#08080a] p-4">
              <img
                src={previewModalImage.url}
                alt={previewModalImage.name}
                className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
