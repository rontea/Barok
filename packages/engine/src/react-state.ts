import type { AppSpec } from './app-spec.js';
import type { VerificationResult } from './app-manifest.js';
import type { AgentWorkPlan, ReactStep } from './react-contracts.js';
import type { CodingState, RecoveryReason, RecoveryRecord } from './coding-state.js';
import type { PlanApprovalState, PlanItem } from './plan-approval.js';
import type { ToolEvidenceRecord } from './tool-contract.js';
import type { SharedRunState, SharedRunTransition, RunOutcome } from './shared-control.js';
import type { EngineSubtaskDispatchResult } from './subtask-dispatcher.js';
import type { ReActEngineDirtyTreeState, ReActEnginePacingProfile as ExecutionPacingProfile } from './react-runtime.js';
import type { ContinuationHandoff } from './continuation.js';

export interface ReActEngineState<
  TaskAnalysis = unknown,
  TaskRouting = unknown,
  ApprovalGrant = unknown,
  DirtyTreeSnapshot = ReActEngineDirtyTreeState,
  UncertainToolCall = unknown,
  Continuation = ContinuationHandoff,
> {
  task: string;
  workspace: string;
  model?: string;
  modelContextWindow?: number;
  /** Immutable provider account selection for this task. */
  providerProfile?: string;
  llmUsage?: {
    requestCount: number;
    retryCount: number;
    cacheHits: number;
    inputTokens: number;
    outputTokens: number;
    /** Latest provider-reported prompt size for the active model request. */
    lastPromptTokens?: number;
    /** Latest locally estimated prompt size when the provider did not report one. */
    lastEstimatedPromptTokens?: number;
    /** Largest provider-reported prompt size observed in this run. */
    peakPromptTokens?: number;
    /** Latest prompt prefill duration in ms (measured or provider-reported). */
    lastPromptPrefillDurationMs?: number;
  };
  taskAnalysis?: TaskAnalysis;
  /** Bounded typed routing decision used to guide the planner and telemetry. */
  taskRouting?: TaskRouting;
  pacingProfile?: ExecutionPacingProfile;
  approvalGrants?: ApprovalGrant[];
  appSpec?: AppSpec;
  appManifestId?: string; // ID of the generated app manifest
  verificationResult?: VerificationResult;
  repairAttempts: number;
  verificationRepairSignatures?: string[];
  activeRepair?: {
    check: string;
    strategy: 'inspect' | 'repair';
    reason: string;
    changedFiles: string[];
  };
  plan: PlanItem[];
  /** Monotonic revision for durable todo snapshots in this run. */
  todoRevision?: number;
  /** Dirty files present before this run started; used to protect unrelated work. */
  dirtyTreeBaseline?: DirtyTreeSnapshot;
  /** Optional strategic plan owned by the agent; never required by the engine. */
  workPlan?: AgentWorkPlan;
  /** Compact reports from opt-in fresh-context child dispatch. */
  subtaskDispatch?: EngineSubtaskDispatchResult;
  steps: ReactStep[];
  /** Tool calls repaired after a crash before a durable result was observed. */
  uncertainToolCalls?: UncertainToolCall[];
  current_step: number;
  max_steps: number;
  /** Finite total action budget shared by all checkpoint windows. */
  globalStepLimit?: number;
  /** Cumulative action count used by the global budget. */
  globalStepCount?: number;
  /** Start and size of the current rolling checkpoint window. */
  stepWindowStart?: number;
  stepWindowLimit?: number;
  /** Durable wall-clock budget shared by all automatic continuations. */
  runStartedAt?: number;
  wallClockBudgetMs?: number;
  /** Recovery-window limit; successful work resets the used transition count. */
  maxRecoveryTransitions?: number;
  total_pollen_cost: number;
  budget: number;
  codingState?: CodingState;
  /** Shared engine-owned lifecycle state, independent of model wording. */
  sharedState?: SharedRunState;
  sharedTransitions?: SharedRunTransition[];
  outcome?: RunOutcome;
  /** User updates accepted between model turns; bounded for prompt safety. */
  conversationUpdates?: string[];
  /** Clarifications already answered; prevents the same question resurfacing across continuations. */
  answeredUserQuestions?: Array<{
    question: string;
    answer: string;
    answeredAt: number;
  }>;
  /** Engine-owned one-turn instruction to leave a detected inspection loop. */
  forceMutationNextAction?: boolean;
  /** Concrete target carried into a mutation-only recovery turn. */
  forceMutationTarget?: string;
  /** A failed existing-file mutation must be preceded by a fresh guarded Read. */
  forceReadNextAction?: boolean;
  forceReadTarget?: string;
  noProgressCount?: number;
  /** Consecutive failed edits (e.g. stale hash or missing preimage) on the same target file. */
  consecutiveEditFailureCount?: number;
  consecutiveEditFailureTarget?: string;
  /** Consecutive typed-evidence mismatches before the run must stop. */
  consecutiveDecisionMismatchCount?: number;
  lastActionSignature?: string;
  codingStateStartedStep?: number;
  codingStateStartedAt?: number;
  blockedReason?: string;
  /** Latest engine-owned recovery cause and bounded transition history. */
  recoveryReason?: RecoveryReason;
  /** Total recovery transitions recorded during this task. */
  recoveryCount?: number;
  /** Consecutive recovery transitions since the last successful tool action. */
  recoveryWindowCount?: number;
  lastRecovery?: RecoveryRecord;
  recoveryHistory?: RecoveryRecord[];
  /** Durable user decision boundary for workspace mutation plans. */
  planApproval?: PlanApprovalState;
  /** Bounded engine-owned ledger of tool inputs, outputs, policy, and errors. */
  toolEvidence?: ToolEvidenceRecord[];
  /** Number of checkpoint continuations; used to keep future handoffs compact. */
  continuationCount?: number;
  continuationHandoff?: Continuation;
  /** First step whose evidence belongs to the active task contract. */
  evidenceStartStep?: number;
  /**
   * Durable forward-only resume marker. Checkpoint creation refreshes this
   * from the recorded steps and plan so a continuation knows where the prior
   * run stopped without asking the model to reconstruct that boundary.
   */
  lastRun?: {
    completedStepCount: number;
    lastAction?: string;
    lastActionInput?: Record<string, unknown>;
    lastActionSucceeded?: boolean;
    nextPlanItem?: string;
    recordedAt: number;
  };
}
