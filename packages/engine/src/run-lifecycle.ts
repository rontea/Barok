export type RunLifecycleStopStatus = 'stopped' | 'interrupted' | 'killed';

/** Whether a completed result should persist as a failed run. */
export function resultIndicatesRunFailure(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const record = result as Record<string, unknown>;
  // A completed implementation with a failed test/verification remains a
  // completed run with a visible warning, rather than an execution failure.
  if (record.executionCompleted === true) return false;
  return record.success === false;
}

/**
 * Whether a stored completed result remains eligible for checkpointed retry.
 * This is intentionally distinct from run failure classification: a completed
 * implementation with failed verification can still be retried from its
 * checkpoint when a new request targets the same work.
 */
export function isRetryableCompletedRun(status: unknown, result: unknown): boolean {
  if (status !== 'completed' || !result || typeof result !== 'object' || Array.isArray(result)) return false;
  return (result as Record<string, unknown>).success === false;
}

export function isMaxStepsExceededResult(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const record = result as Record<string, unknown>;
  return record.success === false && record.errorCode === 'MAX_STEPS_EXCEEDED';
}

/** Build the stable result envelope used for user-stopped/interrupted runs. */
export function normalizeRunLifecycleResult(
  result: unknown,
  status: RunLifecycleStopStatus,
): unknown {
  const errorCode = status === 'killed' ? 'RUN_KILLED' : status === 'interrupted' ? 'RUN_INTERRUPTED' : 'USER_STOPPED';
  const outcome = status === 'killed' ? 'cancelled' : status;
  if (result && typeof result === 'object') {
    return { success: false, ...(result as Record<string, unknown>), errorCode, outcome };
  }
  return { success: false, error: `Run ${status} by user.`, errorCode, outcome, steps: [], stepCount: 0, pollenCost: 0 };
}

export interface RunWallClockBudget {
  runStartedAt: number;
  wallClockBudgetMs: number;
}

export function remainingRunWallClockBudgetMs(
  run?: RunWallClockBudget,
  now = Date.now(),
): number | undefined {
  if (!run || run.wallClockBudgetMs <= 0) return undefined;
  return Math.max(0, run.wallClockBudgetMs - Math.max(0, now - run.runStartedAt));
}

export function isRunWallClockBudgetExceeded(run?: RunWallClockBudget, now = Date.now()): boolean {
  return remainingRunWallClockBudgetMs(run, now) === 0;
}
