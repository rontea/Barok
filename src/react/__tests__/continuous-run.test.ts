import { describe, expect, it } from '@jest/globals';
import {
  CONTINUOUS_RUN_STEP_LIMIT,
  CONTINUOUS_RUN_STEP_WINDOW,
  DEFAULT_MAX_RECOVERY_TRANSITIONS,
  DEFAULT_RUN_WALL_CLOCK_BUDGET_MS,
  MAX_MAX_RECOVERY_TRANSITIONS,
  MAX_RUN_WALL_CLOCK_BUDGET_MS,
  resolveGlobalStepLimit,
  resolveMaxRecoveryTransitions,
  resolveRunWallClockBudgetMs,
  resolveStepWindow,
} from '../continuous-run';

describe('bounded run safety limits', () => {
  it('keeps global action limits finite and clamps oversized requests', () => {
    expect(resolveGlobalStepLimit(25)).toBe(25);
    expect(resolveGlobalStepLimit(Number.POSITIVE_INFINITY)).toBe(CONTINUOUS_RUN_STEP_LIMIT);
    expect(resolveGlobalStepLimit(100_000_000)).toBe(CONTINUOUS_RUN_STEP_LIMIT);
  });

  it('keeps rolling windows separate while never exceeding the global limit', () => {
    expect(resolveStepWindow(5, 100)).toBe(5);
    expect(resolveStepWindow(500, 100)).toBe(100);
    expect(resolveStepWindow(undefined, 100)).toBe(CONTINUOUS_RUN_STEP_WINDOW);
    expect(resolveStepWindow(undefined, 10)).toBe(10);
  });

  it('bounds wall-clock and recovery budgets', () => {
    expect(resolveRunWallClockBudgetMs(undefined)).toBe(DEFAULT_RUN_WALL_CLOCK_BUDGET_MS);
    expect(resolveRunWallClockBudgetMs(1)).toBe(1_000);
    expect(resolveRunWallClockBudgetMs(Number.MAX_SAFE_INTEGER)).toBe(MAX_RUN_WALL_CLOCK_BUDGET_MS);
    expect(resolveMaxRecoveryTransitions(undefined)).toBe(DEFAULT_MAX_RECOVERY_TRANSITIONS);
    expect(resolveMaxRecoveryTransitions(0)).toBe(1);
    expect(resolveMaxRecoveryTransitions(Number.MAX_SAFE_INTEGER)).toBe(MAX_MAX_RECOVERY_TRANSITIONS);
  });
});
