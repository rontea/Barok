import type { FormatFailureSwitchPolicy, FormatFailureSwitchTarget } from './agent-decision.js';
import type { StoredAgentContextSnapshot } from './context-snapshot.js';
import type { ThinkingDepth } from './react-contracts.js';
import type {
  ReActEngineCapabilityPack,
  ReActEngineCapabilityScope,
  ReActEngineLLMProvider,
  ReActEnginePacingProfile,
  ReActEngineRuntime,
  ReActEngineToolRegistry,
} from './react-runtime.js';
import type { RunScopedWorkspaceCapability } from './run-scoped-workspace.js';
import type { EngineSubtaskDispatchResult, SubtaskDispatchTrigger } from './subtask-dispatcher.js';
import type { ReactCheckpoint } from './checkpoint.js';

/**
 * Host-neutral configuration contract for Barok's standalone ReAct engine.
 * State, event, checkpoint, and task-analysis payloads stay generic so the
 * app can preserve its existing contracts without making Engine import them.
 */
export interface ReActEngineConfig<
  State = unknown,
  Event = unknown,
  Checkpoint = ReactCheckpoint,
  TaskAnalysis = unknown,
  TaskRouting = unknown,
  ApprovalGrant = unknown,
  Continuation = unknown,
  StateSnapshot = unknown,
> {
  onProgress?: (message: string) => void;
  onStateUpdate?: (state: StateSnapshot) => void;
  onCheckpoint?: (checkpoint: Checkpoint) => void;
  onEvent?: (event: Event) => void;
  /** Receives a redacted prompt reconstruction for a recent step; callers keep it in memory only. */
  onPlannerContextSnapshot?: (stepSeq: number, snapshot: Record<string, unknown>) => void;
  /** Optional opt-in fresh-context dispatch callback, invoked near context pressure or overflow. */
  onSubtaskDispatch?: (state: State, trigger: SubtaskDispatchTrigger) => Promise<EngineSubtaskDispatchResult>;
  consumeQueuedMessages?: () => Array<{
    id: string;
    message: string;
    queuedAt: number;
    source?: string;
    target?: 'next-turn' | 'next-step';
    claimId?: string;
  }>;
  acknowledgeQueuedMessages?: (messageIds: string[]) => void;
  requestUserInput?: (request: {
    requestId?: string;
    question: string;
    options?: string[];
    allowFreeform?: boolean;
    context?: string;
  }) => Promise<{
    requestId: string;
    answer?: string;
    selectedOption?: string;
    cancelled: boolean;
  }>;
  signal?: AbortSignal;
  runId?: string;
  auditRunId?: string;
  threadId?: string;
  parentRunId?: string;
  attemptIndex?: number;
  threadTitle?: string;
  continuousRun?: boolean;
  maxSteps?: number;
  globalStepLimit?: number;
  wallClockBudgetMs?: number;
  runStartedAt?: number;
  maxRecoveryTransitions?: number;
  model?: string;
  contextWindow?: number;
  modelTargetPinned?: boolean;
  geminiProfileId?: string;
  maxLlmRequestsPerTask?: number;
  maxToolCalls?: number;
  replayGuardEnabled?: boolean;
  userId?: string;
  repositoryCommitHash?: string;
  allowCrossProviderFallback?: boolean;
  approvedFallbackProviders?: string[];
  sameProviderFallbackModels?: string[];
  fallbackApprovalGranted?: boolean;
  allowedExternalProviders?: string[];
  privateWorkspace?: boolean;
  sendPrivateSourceCode?: boolean;
  plannerModel?: string;
  llmRequestTimeoutMs?: number;
  plannerRequestTimeoutMs?: number;
  pacingProfile?: ReActEnginePacingProfile;
  allowProviderRouteProbe?: boolean;
  llmRequestIntervalMs?: number;
  thinkingDepth?: ThinkingDepth;
  verbose?: boolean;
  budget?: number;
  workspace?: string;
  runScopedWorkspaceCapability?: RunScopedWorkspaceCapability;
  taskAnalysis?: TaskAnalysis;
  taskRouting?: TaskRouting;
  continuationHandoff?: Continuation;
  approvalGrantProvider?: () => ApprovalGrant[];
  llmProvider?: ReActEngineLLMProvider;
  allowPollinationsFallback?: boolean;
  allowNvidiaModelFallback?: boolean;
  toolRegistry?: ReActEngineToolRegistry;
  capabilityScope?: ReActEngineCapabilityScope;
  capabilityScopeOwned?: boolean;
  cordisRuntimeEnabled?: boolean;
  runtime?: ReActEngineRuntime;
  contextSnapshot?: StoredAgentContextSnapshot;
  capabilityPack?: string | ReActEngineCapabilityPack;
  debug?: boolean;
  formatFailureSwitchPolicy?: FormatFailureSwitchPolicy;
  onFormatFailureSwitch?: (target: FormatFailureSwitchTarget) => void;
}
