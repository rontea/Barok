/**
 * Host-neutral coding-state lifecycle contracts and phase budgets.
 * Persistence, evidence collection, and state updates remain with the host.
 */

export type CodingState =
  | 'understand'
  | 'discover'
  | 'plan'
  | 'awaiting_plan_approval'
  | 'inspect'
  | 'implement'
  | 'verify'
  | 'repair'
  | 'review'
  | 'complete'
  | 'blocked';

export type RecoveryReason =
  | 'missing_mutation_evidence'
  | 'failed_mutation'
  | 'failed_verification'
  | 'provider_failure'
  | 'invalid_tool_selection'
  | 'decision_evidence_mismatch';

export interface RecoveryEvidence {
  stepCount: number;
  evidenceStartStep?: number;
  latestAction?: string;
  latestActionSucceeded?: boolean;
  successfulMutationCount: number;
  failedMutationCount: number;
  successfulVerificationCount: number;
  failedVerificationCount: number;
}

export interface RecoveryRecord {
  reason: RecoveryReason;
  message: string;
  from: CodingState;
  to: CodingState;
  attempt: number;
  createdAt: number;
  evidence: RecoveryEvidence;
  decisionId?: string;
}

export const CODING_STATE_TRANSITIONS: Readonly<Record<CodingState, readonly CodingState[]>> = {
  understand: ['discover', 'plan', 'awaiting_plan_approval', 'blocked'],
  discover: ['plan', 'inspect', 'implement', 'awaiting_plan_approval', 'blocked'],
  plan: ['inspect', 'implement', 'awaiting_plan_approval', 'blocked'],
  awaiting_plan_approval: ['inspect', 'plan', 'blocked'],
  inspect: ['implement', 'repair', 'blocked'],
  implement: ['verify', 'repair', 'inspect', 'blocked'],
  verify: ['review', 'repair', 'implement', 'blocked'],
  repair: ['inspect', 'implement', 'verify', 'blocked'],
  review: ['complete', 'repair', 'blocked'],
  complete: [],
  blocked: ['understand', 'discover', 'inspect', 'implement'],
};

export function isCodingStateTransitionAllowed(from: CodingState, to: CodingState): boolean {
  return from === to || CODING_STATE_TRANSITIONS[from].includes(to);
}

export interface CodingStateAssessment {
  state: CodingState;
  noProgressCount: number;
  actionSignature?: string;
  blockReason?: string;
  evidence: {
    inspected: boolean;
    relevantInspected: boolean;
    mutated: boolean;
    sourceMutated: boolean;
    verified: boolean;
    blocked: boolean;
  };
}

const CODING_STATE_STEP_BUDGETS: Readonly<Record<CodingState, number>> = {
  understand: 2,
  discover: 4,
  plan: 3,
  inspect: 5,
  implement: 8,
  awaiting_plan_approval: 1,
  verify: 4,
  repair: 4,
  review: 3,
  complete: 1,
  blocked: 2,
};

const CODING_STATE_TIME_BUDGETS_MS: Readonly<Record<CodingState, number>> = {
  understand: 60_000,
  discover: 120_000,
  plan: 90_000,
  inspect: 180_000,
  awaiting_plan_approval: 24 * 60 * 60_000,
  implement: 300_000,
  verify: 180_000,
  repair: 180_000,
  review: 120_000,
  complete: 30_000,
  blocked: 60_000,
};

export function getCodingStateBudget(state: CodingState): number {
  return CODING_STATE_STEP_BUDGETS[state];
}

export function getCodingStateTimeBudget(state: CodingState): number {
  return CODING_STATE_TIME_BUDGETS_MS[state];
}

export function isCodingStateTimeBudgetExceeded(
  state: { codingState?: CodingState; codingStateStartedAt?: number },
  now = Date.now(),
): boolean {
  const phase = state.codingState || 'understand';
  const startedAt = state.codingStateStartedAt ?? now;
  return now - startedAt >= getCodingStateTimeBudget(phase);
}

export function isCodingStateBudgetExceeded(
  state: { codingState?: CodingState; codingStateStartedStep?: number; current_step: number },
): boolean {
  const phase = state.codingState || 'understand';
  const started = state.codingStateStartedStep ?? 0;
  return state.current_step - started >= getCodingStateBudget(phase);
}
