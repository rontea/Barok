export type TerminalRunAdviceCategory =
  | 'no_progress'
  | 'context_overflow'
  | 'provider_unavailable'
  | 'gate_deadlock'
  | 'step_limit'
  | 'wall_clock_budget'
  | 'recovery_exhausted'
  | 'operator_stopped'
  | 'unexpected_failure';

export interface TerminalRunAdvice {
  category: TerminalRunAdviceCategory;
  title: string;
  summary: string;
  guidance: string[];
  learnMoreUrl: string;
}

export type RunTerminalAdviceEvent = TerminalRunAdvice & { type: 'run_terminal_advice' };

type TerminalRunAdviceContent = Omit<TerminalRunAdvice, 'category' | 'learnMoreUrl'>;

const RUNNING_AGENT_GUIDE_URL = '/docs/core/RUNNING_AGENT_GUIDE.md';

const ADVICE_BY_CATEGORY: Record<TerminalRunAdviceCategory, TerminalRunAdviceContent> = {
  no_progress: {
    title: 'The agent stopped making progress',
    summary: 'Recent turns repeated actions without adding useful evidence or completing a task item.',
    guidance: [
      'Review the last few tool results and identify what new evidence is still missing.',
      'Resume with one concrete, scoped action or narrow the task to the unfinished work.',
      'Check the current diff before retrying any write or command whose outcome is uncertain.',
    ],
  },
  context_overflow: {
    title: 'The model context limit was reached',
    summary: 'The selected model could not accept the assembled prompt or its retained evidence.',
    guidance: [
      'Reduce large reads, command output, and unrelated task history first.',
      'Check the selected model’s context window and input-token limit before raising budgets.',
      'Resume the unfinished scope with a fresh bounded context if it still does not fit.',
    ],
  },
  provider_unavailable: {
    title: 'The selected provider could not complete the run',
    summary: 'The model route failed, reached a quota or cooldown, or could not safely resume.',
    guidance: [
      'Check the provider error, account quota, endpoint, and configured pacing.',
      'Review the saved checkpoint and workspace before continuing.',
      'If needed, explicitly select another approved provider or model when resuming.',
    ],
  },
  gate_deadlock: {
    title: 'A required evidence or completion gate is still blocked',
    summary: 'The run could not advance because required inspection, mutation, verification, approval, or review evidence is missing.',
    guidance: [
      'Inspect the blocked reason and latest state or verification events to find the exact missing evidence.',
      'Gather that evidence or resolve the pending approval before continuing.',
      'Run applicable verification after the latest change; do not bypass the gate by raising limits.',
    ],
  },
  step_limit: {
    title: 'The run reached its step or request limit',
    summary: 'The configured action or model-request allowance ended before the run could finish.',
    guidance: [
      'Review completed actions and the checkpoint to identify the remaining work.',
      'Resume with a narrower task or a deliberately larger step/request allowance.',
      'Keep enough budget for verification and review after the final change.',
    ],
  },
  wall_clock_budget: {
    title: 'The run reached its wall-clock budget',
    summary: 'The elapsed-time ceiling ended execution and preserved the latest checkpoint.',
    guidance: [
      'Review the checkpoint, workspace diff, and last successful action.',
      'Reduce provider wait time or split the remaining work into smaller tasks.',
      'Increase the time budget only when the task and provider pacing justify it.',
    ],
  },
  recovery_exhausted: {
    title: 'The run used its recovery allowance',
    summary: 'Repeated recovery attempts did not produce enough evidence to continue safely.',
    guidance: [
      'Read the recovery history and the last failed action before resuming.',
      'Change the failing approach or target instead of replaying the same action.',
      'Resume only after checking whether the workspace already reflects an uncertain action.',
    ],
  },
  operator_stopped: {
    title: 'The run was stopped',
    summary: 'Execution ended at an operator request or interruption.',
    guidance: [
      'Review the current diff and checkpoint before deciding whether to continue.',
      'If a command or edit was in flight, inspect its outcome before retrying it.',
    ],
  },
  unexpected_failure: {
    title: 'The run ended with an execution error',
    summary: 'The terminal error did not match a more specific run-limit, provider, context, or recovery cause.',
    guidance: [
      'Inspect the final error and nearby run events for the first failing operation.',
      'Check the workspace for partial changes before resuming or repeating a side effect.',
      'Retry only after correcting the cause or narrowing the failing action.',
    ],
  },
};

export const TERMINAL_RUN_ADVICE: Readonly<Record<TerminalRunAdviceCategory, TerminalRunAdvice>> =
  Object.freeze(Object.fromEntries(
    Object.entries(ADVICE_BY_CATEGORY).map(([category, content]) => [category, {
      category,
      ...content,
      learnMoreUrl: RUNNING_AGENT_GUIDE_URL,
    }]),
  ) as Record<TerminalRunAdviceCategory, TerminalRunAdvice>);

export interface TerminalRunAdviceInput {
  status?: string;
  result?: unknown;
  stopReason?: string;
  blockedReason?: string;
  noProgressCount?: number;
}

const recordFor = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {};

const textFor = (value: unknown): string => typeof value === 'string' ? value : '';

export function resolveTerminalRunAdvice(input: TerminalRunAdviceInput): TerminalRunAdvice | undefined {
  const result = recordFor(input.result);
  const errorCode = textFor(result.errorCode).toUpperCase();
  const error = textFor(result.error);
  const status = (input.status || '').toLowerCase();
  const diagnostics = `${errorCode} ${error} ${textFor(result.verificationStatus)} ${input.stopReason || ''} ${input.blockedReason || ''}`;

  const completedWithFailedVerification = result.executionCompleted === true && result.verificationStatus === 'failed';
  if (result.success === true && !completedWithFailedVerification) return undefined;
  if (result.success !== false && !diagnostics.trim() && !['failed', 'stopped', 'interrupted', 'killed', 'cancelled', 'canceled', 'stalled'].includes(status)) {
    return undefined;
  }

  let category: TerminalRunAdviceCategory;
  if (/USER_STOPPED|RUN_INTERRUPTED|RUN_KILLED|cancelled|canceled|stopped by user|interrupted by user|killed by user/i.test(`${errorCode} ${error} ${input.stopReason || ''}`) || ['stopped', 'interrupted', 'killed', 'cancelled', 'canceled'].includes(status)) {
    category = 'operator_stopped';
  } else if (/RUN_WALL_CLOCK_LIMIT_EXCEEDED|wall[- ]clock (?:budget|limit)|run duration limit/i.test(diagnostics)) {
    category = 'wall_clock_budget';
  } else if (/context[_\s-]*(?:length|window|overflow)|(?:maximum|max(?:imum)?|exceed(?:ed|s)?)\s+(?:input\s+)?tokens|too many tokens|prompt too long|(?:prompt|input).{0,40}(?:too large|too long)/i.test(diagnostics)) {
    category = 'context_overflow';
  } else if (/PROVIDER_|MODEL_FALLBACK_CONFIRMATION_REQUIRED|provider.{0,50}(?:unavailable|cooldown|quota|rate.limit|failed)|(?:429|503)\b/i.test(diagnostics)) {
    category = 'provider_unavailable';
  } else if (
    /no.progress|repeated inspection|repeated read|without verified progress|did not advance|no new evidence|state budget (?:was )?exhausted|execution state budget/i.test(diagnostics) ||
    (typeof input.noProgressCount === 'number' && input.noProgressCount >= 4)
  ) {
    category = 'no_progress';
  } else if (/MAX_STEPS_EXCEEDED|GLOBAL_STEP_LIMIT_EXCEEDED|TASK_LLM_REQUEST_BUDGET_REACHED|(?:^|\s)BUDGET_EXCEEDED(?:\s|$)|step (?:or request )?(?:limit|budget)|request budget/i.test(diagnostics)) {
    category = 'step_limit';
  } else if (completedWithFailedVerification || /verification.{0,50}(?:failed|failure|gate|evidence)|completion (?:evidence|gate).{0,60}(?:fail|missing|block|reject|incomplete)|cannot (?:enter|complete)|gate (?:failure|rejected|blocked|deadlock)|blocked.{0,40}(?:evidence|verification|approval|review)|approval (?:is )?required|pending approval/i.test(diagnostics)) {
    category = 'gate_deadlock';
  } else if (/RECOVERY_BUDGET_EXCEEDED|recovery.{0,30}(?:budget|allowance|transition).{0,30}(?:exhausted|reached|exceeded)/i.test(diagnostics)) {
    category = 'recovery_exhausted';
  } else if (status === 'stalled') {
    category = 'no_progress';
  } else {
    category = 'unexpected_failure';
  }

  return TERMINAL_RUN_ADVICE[category];
}
