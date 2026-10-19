/**
 * Host-neutral safety limits for bounded and continuous Engine runs.
 * Environment lookup belongs to the host adapter; these helpers only normalize
 * values supplied by the caller.
 */
export const CONTINUOUS_RUN_STEP_LIMIT = 1_000;
export const CONTINUOUS_RUN_STEP_WINDOW = 20;
export const DEFAULT_RUN_WALL_CLOCK_BUDGET_MS = 2 * 60 * 60 * 1000;
export const MAX_RUN_WALL_CLOCK_BUDGET_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_MAX_RECOVERY_TRANSITIONS = 8;
export const MAX_MAX_RECOVERY_TRANSITIONS = 32;
export const CONTINUOUS_RUN_COST_LIMIT = Number.MAX_SAFE_INTEGER;

export interface RunSafetyDefaults {
  globalStepLimit: number;
  wallClockBudgetMs: number;
  maxRecoveryTransitions: number;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.floor(parsed)))
    : fallback;
}

export function resolveStepWindow(value: unknown, globalStepLimit: number, fallback = CONTINUOUS_RUN_STEP_WINDOW): number {
  const boundedGlobalLimit = Number.isFinite(globalStepLimit)
    ? Math.max(1, Math.floor(globalStepLimit))
    : CONTINUOUS_RUN_STEP_LIMIT;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(boundedGlobalLimit, Math.floor(parsed)))
    : Math.min(boundedGlobalLimit, fallback);
}

export function resolveGlobalStepLimit(value?: unknown): number {
  return boundedInteger(value, CONTINUOUS_RUN_STEP_LIMIT, 1, CONTINUOUS_RUN_STEP_LIMIT);
}

export function resolveRunWallClockBudgetMs(value?: unknown): number {
  return boundedInteger(
    value,
    DEFAULT_RUN_WALL_CLOCK_BUDGET_MS,
    1_000,
    MAX_RUN_WALL_CLOCK_BUDGET_MS,
  );
}

export function resolveMaxRecoveryTransitions(value?: unknown): number {
  return boundedInteger(
    value,
    DEFAULT_MAX_RECOVERY_TRANSITIONS,
    1,
    MAX_MAX_RECOVERY_TRANSITIONS,
  );
}
