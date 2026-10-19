import type { ReactStep } from './react-contracts.js';
import type { ReActEngineState } from './react-state.js';
import { getCodingStateBudget, getCodingStateTimeBudget } from './coding-state.js';
import { estimateReactStepContext } from './token-accounting.js';

function truncateLiveText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[truncated ${value.length - limit} chars]`;
}
const LIVE_STATE_STEP_LIMIT = 8;
const LIVE_STATE_THOUGHT_LIMIT = 1500;
const LIVE_STATE_OBSERVATION_LIMIT = 5000;
const LIVE_STATE_INPUT_LIMIT = 3000;
function truncateLiveValue(value: unknown, limit: number): unknown {
  if (typeof value === 'string') return truncateLiveText(value, limit);
  if (!value || typeof value !== 'object') return value;

  const json = JSON.stringify(value);
  if (json.length <= limit) return value;
  return {
    truncated: true,
    preview: truncateLiveText(json, limit),
  };
}

function truncateLiveObservation(value: string, limit: number): string {
  if (value.length <= limit) return value;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return truncateLiveText(value, limit);

    const summary: Record<string, unknown> = {};
    for (const key of ['success', 'status', 'skipped', 'verificationUnavailable', 'exitCode', 'durationMs']) {
      if (key in parsed) summary[key] = parsed[key];
    }
    for (const key of ['error', 'output', 'stdout', 'stderr']) {
      if (typeof parsed[key] === 'string') summary[key] = truncateLiveText(parsed[key] as string, Math.max(160, Math.floor(limit / 3)));
    }
    summary.truncated = true;
    const serialized = JSON.stringify(summary);
    if (serialized.length <= limit) return serialized;
    return JSON.stringify({
      success: parsed.success,
      status: parsed.status,
      truncated: true,
      preview: truncateLiveText(String(parsed.error || parsed.output || ''), Math.max(80, limit - 120)),
    });
  } catch {
    return truncateLiveText(value, limit);
  }
}

function toLiveStepSnapshot(step: ReactStep): ReactStep {
  return {
    ...step,
    thought: truncateLiveText(step.thought || '', LIVE_STATE_THOUGHT_LIMIT),
    action_input: truncateLiveValue(step.action_input || {}, LIVE_STATE_INPUT_LIMIT) as Record<string, unknown>,
    observation: step.observation
      ? truncateLiveObservation(step.observation, LIVE_STATE_OBSERVATION_LIMIT)
      : step.observation,
    final_answer: step.final_answer
      ? truncateLiveText(step.final_answer, LIVE_STATE_OBSERVATION_LIMIT)
      : step.final_answer,
  };
}


export function getStateSnapshot(state: ReActEngineState): Record<string, any> {
  const recentSteps = state.steps.slice(-LIVE_STATE_STEP_LIMIT).map(toLiveStepSnapshot);
  const contextEstimate = estimateReactStepContext(state.steps);
  const contextWindow = state.modelContextWindow || 0;
  const inputTokens = state.llmUsage?.inputTokens || 0;
  const outputTokens = state.llmUsage?.outputTokens || 0;
  return {
    task: state.task,
    workspace: state.workspace,
    taskAnalysis: state.taskAnalysis,
    taskRouting: state.taskRouting,
    toolEvidence: state.toolEvidence?.slice(-20),
    pacingProfile: state.pacingProfile,
    providerProfile: state.providerProfile,
    llmUsage: state.llmUsage,
    runTokenUsage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedContextTokens: contextEstimate.totalTokens,
      contextWindow: contextWindow || undefined,
      contextRemainingTokens: contextWindow
        ? Math.max(0, contextWindow - contextEstimate.totalTokens)
        : undefined,
      contextUsedPercent: contextWindow
        ? Number(Math.min(100, (contextEstimate.totalTokens / contextWindow) * 100).toFixed(2))
        : undefined,
      context_window_used_percent: contextWindow
        ? Number(Math.min(100, ((state.llmUsage?.lastPromptTokens ?? contextEstimate.totalTokens) / contextWindow) * 100).toFixed(2))
        : undefined,
      promptPrefillDurationMs: state.llmUsage?.lastPromptPrefillDurationMs,
      prompt_prefill_duration_ms: state.llmUsage?.lastPromptPrefillDurationMs,
      providerReportedPromptTokens: state.llmUsage?.lastPromptTokens,
      providerPeakPromptTokens: state.llmUsage?.peakPromptTokens,
      providerPromptRemainingTokens: state.llmUsage?.lastPromptTokens !== undefined && contextWindow
        ? Math.max(0, contextWindow - state.llmUsage.lastPromptTokens)
        : undefined,
      providerPromptUsedPercent: state.llmUsage?.lastPromptTokens !== undefined && contextWindow
        ? Number(Math.min(100, (state.llmUsage.lastPromptTokens / contextWindow) * 100).toFixed(2))
        : undefined,
      contextMeasurement: state.llmUsage?.lastPromptTokens !== undefined ? 'provider' : 'estimated',
      contextUsageSource: state.llmUsage?.lastPromptTokens !== undefined ? 'provider' : 'estimated',
      estimated: state.llmUsage?.lastPromptTokens === undefined,
    },
    runBudget: {
      globalStepLimit: state.globalStepLimit,
      globalStepsUsed: state.globalStepCount ?? state.current_step,
      globalStepsRemaining: typeof state.globalStepLimit === 'number'
        ? Math.max(0, state.globalStepLimit - (state.globalStepCount ?? state.current_step))
        : undefined,
      windowStepLimit: state.stepWindowLimit ?? state.max_steps,
      windowStepsUsed: Math.max(0, state.current_step - (state.stepWindowStart || 0)),
      windowStepsRemaining: typeof (state.stepWindowLimit ?? state.max_steps) === 'number'
        ? Math.max(0, (state.stepWindowLimit ?? state.max_steps) - Math.max(0, state.current_step - (state.stepWindowStart || 0)))
        : undefined,
      runStartedAt: state.runStartedAt,
      wallClockBudgetMs: state.wallClockBudgetMs,
      wallClockElapsedMs: state.runStartedAt ? Math.max(0, Date.now() - state.runStartedAt) : undefined,
      wallClockRemainingMs: state.runStartedAt && state.wallClockBudgetMs
        ? Math.max(0, state.wallClockBudgetMs - Math.max(0, Date.now() - state.runStartedAt))
        : undefined,
      maxRecoveryTransitions: state.maxRecoveryTransitions,
      recoveryTransitionsUsed: state.recoveryWindowCount ?? state.recoveryCount ?? 0,
      recoveryTransitionsTotal: state.recoveryCount || 0,
      recoveryTransitionsRemaining: typeof state.maxRecoveryTransitions === 'number'
        ? Math.max(0, state.maxRecoveryTransitions - (state.recoveryWindowCount ?? state.recoveryCount ?? 0))
        : undefined,
    },
    appSpec: state.appSpec,
    codingState: state.codingState,
    sharedState: state.sharedState,
    sharedTransitions: state.sharedTransitions?.slice(-20),
    outcome: state.outcome,
    planApproval: state.planApproval,
    conversationUpdates: state.conversationUpdates?.slice(-10),
    answeredUserQuestions: state.answeredUserQuestions?.slice(-8),
    forceMutationNextAction: state.forceMutationNextAction === true,
    forceMutationTarget: state.forceMutationTarget,
    forceReadNextAction: state.forceReadNextAction === true,
    forceReadTarget: state.forceReadTarget,
    blockedReason: state.blockedReason,
    recoveryReason: state.recoveryReason,
    recoveryCount: state.recoveryCount || 0,
    lastRecovery: state.lastRecovery,
    noProgressCount: state.noProgressCount || 0,
    consecutiveDecisionMismatchCount: state.consecutiveDecisionMismatchCount || 0,
    lastActionSignature: state.lastActionSignature,
    state_step_budget: getCodingStateBudget(state.codingState || 'understand'),
    state_steps_elapsed: state.current_step - (state.codingStateStartedStep || 0),
    state_time_budget_ms: getCodingStateTimeBudget(state.codingState || 'understand'),
    state_time_elapsed_ms: Date.now() - (state.codingStateStartedAt || Date.now()),
    plan: state.plan,
    todoRevision: state.todoRevision || 0,
    workPlan: state.workPlan,
    subtaskDispatch: state.subtaskDispatch,
    current_step: state.current_step,
    max_steps: state.max_steps,
    total_cost: state.total_pollen_cost,
    budget: state.budget,
    steps_completed: state.steps.length,
    steps_total: state.steps.length,
    steps_window_start: Math.max(0, state.steps.length - recentSteps.length),
    steps: recentSteps,
    is_done: state.steps.some((s) => s.is_done),
  };
}

