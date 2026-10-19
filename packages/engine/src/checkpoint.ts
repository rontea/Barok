import { CONTINUOUS_RUN_STEP_LIMIT, resolveStepWindow } from './run-limits.js';
import type {
  WorkspaceFingerprint,
  WorkspaceFingerprintProvider,
  WorkspaceFingerprintState,
} from './workspace-fingerprint.js';

export const REACT_CHECKPOINT_VERSION = 1 as const;
export const REACT_CHECKPOINT_HANDOFF_VERSION = 1 as const;

export interface ReactCheckpointStep {
  action: string;
  action_input?: Record<string, unknown>;
  observation?: string;
}

export interface ReactCheckpointPlanItem {
  step: string;
  status: string;
}

/** Structural state used by Engine checkpoint logic; app-specific fields pass through unchanged. */
export interface ReactCheckpointState extends WorkspaceFingerprintState {
  task: string;
  workspace: string;
  plan: readonly ReactCheckpointPlanItem[];
  steps: readonly ReactCheckpointStep[];
  current_step: number;
  max_steps: number;
  llmUsage?: {
    requestCount: number;
    retryCount: number;
    cacheHits: number;
    inputTokens: number;
    outputTokens: number;
  };
  globalStepLimit?: number;
  globalStepCount?: number;
  stepWindowStart?: number;
  stepWindowLimit?: number;
  blockedReason?: string;
  forceMutationNextAction?: boolean;
  forceMutationTarget?: string;
  codingState?: string;
  planApproval?: { status: string };
  noProgressCount?: number;
  consecutiveEditFailureCount?: number;
  consecutiveEditFailureTarget?: string;
  lastActionSignature?: string;
  codingStateStartedStep?: number;
  codingStateStartedAt?: number;
  continuationCount?: number;
  evidenceStartStep?: number;
  repairAttempts?: number;
  lastRun?: {
    completedStepCount: number;
    lastAction?: string;
    lastActionInput?: Record<string, unknown>;
    lastActionSucceeded?: boolean;
    nextPlanItem?: string;
    recordedAt: number;
  };
  activeRepair?: {
    check: string;
    strategy: 'inspect' | 'repair';
    reason: string;
    changedFiles: string[];
  };
  forceReadNextAction?: boolean;
  forceReadTarget?: string;
  verificationResult?: unknown;
  verificationRepairSignatures?: string[];
}

const MUTATION_RECOVERY_BLOCKED_REASON =
  /(?:Execution state budget exhausted before a source mutation succeeded|Run blocked after (?:repeated inspection|a repeated inspection loop) without (?:a source mutation|a Write or Edit action)|Implementation was required after a repeated loop|Repeated inspection blocked|Repeated clarification blocked|The model could not produce a valid Write or Edit action|Resume with a scoped Write or Edit action)/i;
/** The request identity that was current when a checkpoint was handed off. */
export interface ReactCheckpointRequestIdentity {
  requestId: string;
  eventId: string;
  status: 'started' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled' | 'unknown';
  stepId?: string;
}

/** Bounded event/evidence references retained with a checkpoint. */
export interface ReactCheckpointEvidenceWindow {
  startStep: number;
  endStep: number;
  startEventSeq: number;
  endEventSeq: number;
  eventIds: string[];
  evidenceIds: string[];
}

/** Forward-only progress information used to resume without replaying work. */
export interface ReactProgressCursor {
  version: typeof REACT_CHECKPOINT_HANDOFF_VERSION;
  currentStep: number;
  phase: string;
  currentPlanItem?: string;
  remainingPlanItems: string[];
  lastMeaningfulProgress?: string;
  blockedReason?: string;
}

/** Atomic handoff metadata attached to the checkpoint event and run projection. */
export interface ReactCheckpointHandoff {
  version: typeof REACT_CHECKPOINT_HANDOFF_VERSION;
  eventSeq: number;
  requestEnvelope?: ReactCheckpointRequestIdentity;
  evidenceWindow: ReactCheckpointEvidenceWindow;
  progressCursor: ReactProgressCursor;
}

export interface ReactCheckpoint<TState extends ReactCheckpointState = ReactCheckpointState> {
  version: typeof REACT_CHECKPOINT_VERSION;
  createdAt: number;
  state: TState;
  workspaceFingerprint: WorkspaceFingerprint;
  handoff?: ReactCheckpointHandoff;
}

export interface ReactResumeOptions {
  /** Reset the per-continuation request allowance (explicit user resume). */
  resetRequestBudget?: boolean;
  /** Legacy compatibility flag; all continuation windows remain globally bounded. */
  allowUnboundedSteps?: boolean;
}

export interface ReactRepairOptions {
  /** The repair task becomes the active request while the prior task stays in history. */
  task: string;
  check: string;
  reason: string;
  /** Bounded files discovered or implicated by the failed check. */
  changedFiles: string[];
  freshStepBudget?: number;
}

function resumeMutationTarget(state: ReactCheckpointState): string | undefined {
  if (state.forceMutationTarget) return state.forceMutationTarget;
  const targetFromBlocked = state.blockedReason?.match(/Target:\s*([^.\r\n]+(?:\.[a-zA-Z0-9_-]+)?)/i)?.[1]?.trim();
  if (typeof targetFromBlocked === 'string' && targetFromBlocked.trim()) return targetFromBlocked.trim();
  const affectedTarget = state.taskAnalysis?.affectedFiles?.find((file) => file.intent !== 'read_only')?.path;
  if (affectedTarget) return affectedTarget;
  const candidateTarget = state.taskAnalysis?.contract?.candidateFiles?.[0];
  return typeof candidateTarget === 'string' && candidateTarget.trim() ? candidateTarget.trim() : undefined;
}

export function createReactCheckpoint<TState extends ReactCheckpointState>(
  state: TState,
  fingerprint: WorkspaceFingerprintProvider,
): ReactCheckpoint<TState> {
  const createdAt = Date.now();
  const snapshot = structuredClone(state);
  // ReplayGuard is a synthetic refusal, not agent progress. Preserve the last
  // real tool action while still advancing completedStepCount past the refusal.
  const lastStep = [...snapshot.steps].reverse().find((step) => step.action !== 'ReplayGuard');
  const remainingPlanItem = snapshot.plan.find((item) => item.status === 'in_progress') ||
    snapshot.plan.find((item) => item.status === 'pending');
  snapshot.lastRun = {
    completedStepCount: snapshot.steps.length,
    ...(lastStep
      ? {
          lastAction: lastStep.action,
          lastActionInput: structuredClone(lastStep.action_input || {}),
          lastActionSucceeded: successfulObservation(lastStep.observation),
        }
      : {}),
    ...(remainingPlanItem ? { nextPlanItem: remainingPlanItem.step } : {}),
    recordedAt: createdAt,
  };
  return { version: REACT_CHECKPOINT_VERSION, createdAt, state: snapshot, workspaceFingerprint: fingerprint(snapshot) };
}

/** Attach the event-bound handoff only after the run manager has allocated its sequence. */
export function attachReactCheckpointHandoff<TState extends ReactCheckpointState>(
  checkpoint: ReactCheckpoint<TState>,
  handoff: ReactCheckpointHandoff,
): ReactCheckpoint<TState> {
  return { ...checkpoint, handoff };
}

function successfulObservation(observation: string | undefined): boolean {
  if (!observation) return false;
  try {
    const parsed = JSON.parse(observation) as { success?: unknown; status?: unknown };
    if (parsed.success === false) return false;
    return parsed.status === undefined || parsed.status === 'passed' || parsed.status === 'success';
  } catch {
    return !/\b(error|failed|cancelled|canceled)\b/i.test(observation);
  }
}

export function prepareReactResumeState<TState extends ReactCheckpointState>(
  state: TState,
  freshStepBudget = 40,
  now = Date.now(),
  options: ReactResumeOptions = {},
): TState {
  const currentStep = Math.max(0, Number(state.current_step) || 0);
  const globalStepLimit = Number.isFinite(Number(state.globalStepLimit))
    ? Math.max(1, Math.min(CONTINUOUS_RUN_STEP_LIMIT, Number(state.globalStepLimit)))
    : CONTINUOUS_RUN_STEP_LIMIT;
  const boundedFreshSteps = resolveStepWindow(freshStepBudget || 40, globalStepLimit, 40);
  const globalStepCount = Number.isFinite(Number(state.globalStepCount))
    ? Math.max(0, Number(state.globalStepCount), currentStep, state.steps.length)
    : Math.max(currentStep, state.steps.length);
  const priorUsage = state.llmUsage;
  const resetRequestBudget = options.resetRequestBudget !== false;
  const recoveryBudgetResume = state.codingState === 'blocked' &&
    /Run recovery budget reached after \d+ transitions?\b/i.test(state.blockedReason || '');
  // Older checkpoints may have been blocked by the advisory-only inspection
  // guard. Preserve that intent across the resume reset so the next run starts
  // with a scoped mutation turn instead of replaying the same reads.
  const mutationRecoveryRequired = Boolean(
    state.forceMutationNextAction ||
    (state.codingState === 'blocked' && MUTATION_RECOVERY_BLOCKED_REASON.test(state.blockedReason || '')),
  );
  return {
    ...structuredClone(state),
    // An explicit continuation starts a fresh request allowance. An internal
    // rolling checkpoint must preserve the task allowance so it cannot bypass
    // the separate LLM request safety guard merely by crossing a step window.
    llmUsage: priorUsage
      ? {
          ...structuredClone(priorUsage),
          ...(resetRequestBudget ? { requestCount: 0 } : {}),
        }
      : {
          requestCount: 0,
          retryCount: 0,
          cacheHits: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
    globalStepLimit,
    globalStepCount,
    stepWindowStart: currentStep,
    stepWindowLimit: boundedFreshSteps,
    max_steps: Math.min(globalStepLimit, currentStep + boundedFreshSteps),
    // Keep this marker until ReActEngine reopens the shared failed state and
    // records the checkpoint-resume transition.
    blockedReason: recoveryBudgetResume ? state.blockedReason : undefined,
    forceMutationNextAction: mutationRecoveryRequired,
    noProgressCount: mutationRecoveryRequired ? 4 : 0,
    consecutiveEditFailureCount: 0,
    consecutiveEditFailureTarget: undefined,
    lastActionSignature: undefined,
    codingState: recoveryBudgetResume
      ? 'blocked'
      : mutationRecoveryRequired
        ? 'implement'
        : state.planApproval?.status === 'approved' && state.codingState === 'awaiting_plan_approval'
          ? 'inspect'
          : state.codingState === 'blocked' ? 'inspect' : state.codingState,
    forceMutationTarget: mutationRecoveryRequired ? resumeMutationTarget(state) : state.forceMutationTarget,
    codingStateStartedStep: currentStep,
    codingStateStartedAt: now,
    continuationCount: Math.max(0, Number(state.continuationCount) || 0) + 1,
  } as TState;
}

/**
 * Start an incremental repair turn without replaying the parent run.
 *
 * The action log and plan are intentionally retained as durable context, but
 * completion evidence starts after the saved tail. This mirrors an append-only
 * session log: successful writes remain visible, while the repair must produce
 * its own fresh mutation and verification evidence before it can finish.
 */
export function prepareReactRepairState<TState extends ReactCheckpointState>(
  state: TState,
  options: ReactRepairOptions,
  now = Date.now(),
): TState {
  const resumed = prepareReactResumeState(
    state,
    options.freshStepBudget ?? 40,
    now,
    { resetRequestBudget: false },
  );
  const evidenceStartStep = resumed.steps.length;
  return {
    ...resumed,
    task: options.task,
    evidenceStartStep,
    codingState: 'repair',
    codingStateStartedStep: resumed.current_step,
    codingStateStartedAt: now,
    blockedReason: undefined,
    activeRepair: {
      check: options.check,
      strategy: 'repair',
      reason: options.reason,
      changedFiles: Array.from(new Set(options.changedFiles.filter((file) => Boolean(file && file.trim())))).slice(0, 24),
    },
    // A repair starts with fresh inspection. Do not inherit a stale
    // mutation-only or failed-read override from the parent turn.
    forceMutationNextAction: false,
    forceMutationTarget: undefined,
    forceReadNextAction: false,
    forceReadTarget: undefined,
    noProgressCount: 0,
    consecutiveEditFailureCount: 0,
    consecutiveEditFailureTarget: undefined,
  } as TState;
}

/**
 * Rebase a saved continuation onto a workspace that changed after its last
 * checkpoint. The plan and durable completion ledger remain useful, but old
 * tool observations are no longer current evidence and must not suppress the
 * fresh inspections needed before another mutation.
 */
export function prepareReactWorkspaceRebaseState<TState extends ReactCheckpointState>(
  state: TState,
  freshStepBudget = 40,
  now = Date.now()
): TState {
  const resumed = prepareReactResumeState(state, freshStepBudget, now);
  const priorLastRun = resumed.lastRun;
  return {
    ...resumed,
    steps: [],
    current_step: 0,
    max_steps: Math.min(
      Number(resumed.globalStepLimit) || CONTINUOUS_RUN_STEP_LIMIT,
      Math.max(1, Math.min(1000, Number(freshStepBudget) || 40)),
    ),
    stepWindowStart: 0,
    stepWindowLimit: resolveStepWindow(freshStepBudget || 40, Number(resumed.globalStepLimit) || CONTINUOUS_RUN_STEP_LIMIT, 40),
    evidenceStartStep: 0,
    codingState: 'inspect',
    codingStateStartedStep: 0,
    repairAttempts: 0,
    activeRepair: undefined,
    verificationResult: undefined,
    verificationRepairSignatures: [],
    // Keep the forward task cursor without carrying a stale Read/Grep input
    // into the exact-action replay guard. Completed items and prior mutations
    // are still represented by the continuation handoff.
    lastRun: priorLastRun
      ? {
          completedStepCount: 0,
          nextPlanItem: priorLastRun.nextPlanItem,
          recordedAt: priorLastRun.recordedAt,
        }
      : undefined,
  } as TState;
}

export function validateReactCheckpoint(checkpoint: unknown): checkpoint is ReactCheckpoint {
  const value = checkpoint as Partial<ReactCheckpoint> | undefined;
  if (!value || value.version !== REACT_CHECKPOINT_VERSION || !value.state || typeof value.state.task !== 'string' || typeof value.state.workspace !== 'string' || !Array.isArray(value.state.steps)) return false;
  if (value.handoff === undefined) return true;
  const handoff = value.handoff;
  if (!handoff || typeof handoff !== 'object') return false;
  const request = handoff.requestEnvelope;
  return Boolean(
    handoff.version === REACT_CHECKPOINT_HANDOFF_VERSION &&
    Number.isInteger(handoff.eventSeq) && handoff.eventSeq >= 0 &&
    handoff.evidenceWindow &&
    Number.isInteger(handoff.evidenceWindow.startStep) &&
    Number.isInteger(handoff.evidenceWindow.endStep) &&
    Number.isInteger(handoff.evidenceWindow.startEventSeq) &&
    Number.isInteger(handoff.evidenceWindow.endEventSeq) &&
    Array.isArray(handoff.evidenceWindow.eventIds) &&
    Array.isArray(handoff.evidenceWindow.evidenceIds) &&
    handoff.progressCursor &&
    handoff.progressCursor.version === REACT_CHECKPOINT_HANDOFF_VERSION &&
    Number.isInteger(handoff.progressCursor.currentStep) &&
    typeof handoff.progressCursor.phase === 'string' &&
    Array.isArray(handoff.progressCursor.remainingPlanItems) &&
    (!request || (
      typeof request.requestId === 'string' &&
      typeof request.eventId === 'string' &&
      ['started', 'succeeded', 'failed', 'timed_out', 'cancelled', 'unknown'].includes(request.status)
    ))
  );
}

export function isCheckpointWorkspaceFresh(
  checkpoint: ReactCheckpoint,
  fingerprint: WorkspaceFingerprintProvider,
): boolean {
  return fingerprint(checkpoint.state).digest === checkpoint.workspaceFingerprint.digest;
}
