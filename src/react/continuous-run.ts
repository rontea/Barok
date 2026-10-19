import { getRuntimeEnvValue } from '../config/runtimeEnv.js';
import {
  CONTINUOUS_RUN_STEP_LIMIT as engineStepLimit,
  DEFAULT_MAX_RECOVERY_TRANSITIONS as engineRecoveryLimit,
  DEFAULT_RUN_WALL_CLOCK_BUDGET_MS as engineWallClockLimit,
  resolveGlobalStepLimit as normalizeGlobalStepLimit,
  resolveMaxRecoveryTransitions as normalizeMaxRecoveryTransitions,
  resolveRunWallClockBudgetMs as normalizeRunWallClockBudgetMs,
} from '@barok/engine';
export {
  CONTINUOUS_RUN_COST_LIMIT,
  CONTINUOUS_RUN_STEP_LIMIT,
  CONTINUOUS_RUN_STEP_WINDOW,
  DEFAULT_MAX_RECOVERY_TRANSITIONS,
  DEFAULT_RUN_WALL_CLOCK_BUDGET_MS,
  MAX_MAX_RECOVERY_TRANSITIONS,
  MAX_RUN_WALL_CLOCK_BUDGET_MS,
  resolveStepWindow,
  type RunSafetyDefaults,
} from '@barok/engine';

/** App compatibility adapter: omitted limits continue to read Barok settings. */
export function resolveGlobalStepLimit(value?: unknown): number {
  return normalizeGlobalStepLimit(
    value ?? getRuntimeEnvValue('REACT_ENGINE_GLOBAL_STEP_LIMIT', String(engineStepLimit)),
  );
}

/** App compatibility adapter: omitted limits continue to read Barok settings. */
export function resolveRunWallClockBudgetMs(value?: unknown): number {
  return normalizeRunWallClockBudgetMs(
    value ?? getRuntimeEnvValue('REACT_ENGINE_MAX_RUN_DURATION_MS', String(engineWallClockLimit)),
  );
}

/** App compatibility adapter: omitted limits continue to read Barok settings. */
export function resolveMaxRecoveryTransitions(value?: unknown): number {
  return normalizeMaxRecoveryTransitions(
    value ?? getRuntimeEnvValue('REACT_ENGINE_MAX_RECOVERY_TRANSITIONS', String(engineRecoveryLimit)),
  );
}
