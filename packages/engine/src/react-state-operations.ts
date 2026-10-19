import type { AppSpec } from './app-spec.js';
import type { VerificationResult } from './app-manifest.js';
import type { ReactStep } from './react-contracts.js';
import type { ReActEngineState } from './react-state.js';
import { isVerificationAction } from './verification-action.js';

/** Update the recorded cost on a completed step. */
export function updateStepCost(step: ReactStep, cost: number): void {
  step.pollenCost = cost;
}

/** Return whether a ReAct run has recorded a terminal answer. */
export function isStateComplete(state: Pick<ReActEngineState, 'steps'>): boolean {
  return state.steps.some((step) => step.is_done);
}

/** Return whether the current checkpoint window has exhausted its step limit. */
export function isMaxStepsReached(state: Pick<ReActEngineState, 'current_step' | 'max_steps'>): boolean {
  return state.current_step >= state.max_steps;
}

/** Return whether the run has spent more than its configured cost budget. */
export function isBudgetExceeded(state: Pick<ReActEngineState, 'total_pollen_cost' | 'budget'>): boolean {
  return state.total_pollen_cost > state.budget;
}

/** Store the normalized app-generation contract on a run state. */
export function setAppSpec<State extends { appSpec?: AppSpec }>(state: State, appSpec: AppSpec): void {
  state.appSpec = appSpec;
}

/** Project the budget fields exposed by the existing ReAct state API. */
export function getReactStateBudgetStatus(
  state: Pick<ReActEngineState, 'total_pollen_cost' | 'budget'>,
): { spent: number; remaining: number; percentUsed: number } {
  return {
    spent: state.total_pollen_cost,
    remaining: Math.max(0, state.budget - state.total_pollen_cost),
    percentUsed: state.budget === Infinity ? 0 : (state.total_pollen_cost / state.budget) * 100,
  };
}

/** Interpret structured and legacy observations for state evidence decisions. */
export function isSuccessfulReactStep(step: ReactStep): boolean {
  const observation = step.observation || '';
  if (!observation) return false;
  try {
    const parsed = JSON.parse(observation);
    if (parsed && typeof parsed === 'object' && 'success' in parsed) {
      const result = parsed as { success?: unknown; status?: unknown; skipped?: unknown; verificationUnavailable?: unknown };
      if (isVerificationAction(step.action, step.action_input) &&
        (result.success === true || result.status === 'passed' || result.status === 'success')) {
        const output = typeof (parsed as { output?: unknown }).output === 'string'
          ? (parsed as { output: string }).output
          : '';
        if (!output.trim()) return false;
      }
      if (isVerificationAction(step.action, step.action_input) &&
        (result.status === 'skipped' || result.status === 'unavailable')) return false;
      return result.success !== false && result.skipped !== true && result.verificationUnavailable !== true;
    }
  } catch { /* legacy text observations */ }
  return !/\b(error|failed|cancelled|canceled|unavailable|skipped)\b/i.test(observation);
}

/** Reset the recovery streak after successful work; plan-only actions do not count. */
export function resetRecoveryBudgetAfterProgress(
  state: Pick<ReActEngineState, 'recoveryWindowCount'>,
  step: ReactStep,
): boolean {
  if (!state.recoveryWindowCount || !isSuccessfulReactStep(step) || ['Todo', 'WorkPlan'].includes(step.action)) return false;
  state.recoveryWindowCount = 0;
  return true;
}

export function canonicalizeReactActionInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeReactActionInput);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalizeReactActionInput(record[key])]),
    );
  }
  return value;
}

/** Build a stable signature for an action and its input. */
export function reactActionSignature(step: Pick<ReactStep, 'action' | 'action_input'>): string {
  return `${step.action}:${JSON.stringify(canonicalizeReactActionInput(step.action_input || {}))}`.toLowerCase();
}

/**
 * Continuations retain parent steps as context, but parent actions do not
 * belong to a child run's current-task step window.
 */
export function getCurrentTaskSteps(
  state: Pick<ReActEngineState, 'steps' | 'continuationHandoff'>,
): ReactStep[] {
  const offset = state.continuationHandoff?.evidence?.childStepOffset;
  if (typeof offset !== 'number' || offset <= 0) return state.steps;
  return state.steps.slice(Math.min(Math.floor(offset), state.steps.length));
}

/** Return steps within the active evidence contract, when one has an offset. */
export function getTaskEvidenceSteps(
  state: Pick<ReActEngineState, 'steps'> & Partial<Pick<ReActEngineState, 'evidenceStartStep'>>,
): ReactStep[] {
  const offset = state.evidenceStartStep;
  if (typeof offset !== 'number' || offset <= 0) return state.steps;
  return state.steps.slice(Math.min(Math.floor(offset), state.steps.length));
}

function isExplicitMonitoringWait(step: ReactStep): boolean {
  if (step.action !== 'Bash' && step.action !== 'Command') return false;
  const command = String(step.action_input?.command || '');
  const operation = String(step.action_input?.operation || '').toLowerCase();
  return operation === 'wait' || operation === 'sleep' ||
    /(?:^|[;&|\s])(?:sleep|start-sleep|timeout\s+\/t)\s+\d+/i.test(command);
}

/** Detect a genuine loop of repeated successful inspection actions. */
export function hasRepeatedSuccessfulInspectionLoop(
  state: Pick<ReActEngineState, 'steps' | 'continuationHandoff'>,
  windowSize = 8,
  minimumRepeats = 3,
): boolean {
  const inspectionActions = new Set(['Read', 'DocumentRead', 'Glob', 'Grep', 'WorkspaceChanges', 'Bash', 'Command']);
  const trailing = getCurrentTaskSteps(state).slice(-windowSize);
  if (trailing.length < windowSize ||
      trailing.some((step) => !inspectionActions.has(step.action) || !isSuccessfulReactStep(step))) {
    return false;
  }

  const probes = trailing.filter((step) => !isExplicitMonitoringWait(step));
  if (probes.length < windowSize - 2) return false;
  const frequencies = new Map<string, number>();
  for (const step of probes) {
    const signature = reactActionSignature(step);
    const count = (frequencies.get(signature) || 0) + 1;
    if (count >= minimumRepeats) return true;
    frequencies.set(signature, count);
  }
  return false;
}

/** Detect repeated successful inspection evidence in the latest streak. */
export function countRepeatedSuccessfulInspectionEvidence(steps: ReactStep[]): number {
  const inspectionActions = new Set([
    'Read', 'DocumentRead', 'Glob', 'Grep', 'WorkspaceChanges', 'Bash', 'Command', 'ReplayGuard',
  ]);
  const seen = new Set<string>();
  let repeated = 0;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (isExplicitMonitoringWait(step)) break;
    if (!inspectionActions.has(step.action)) break;
    if (!isSuccessfulReactStep(step)) continue;
    let evidenceSignature: string;
    const observation = step.observation || '';
    try {
      const parsed = JSON.parse(observation) as Record<string, unknown>;
      const evidence = Object.fromEntries(
        ['success', 'status', 'output', 'error', 'summary', 'hash', 'files', 'entries', 'operation']
          .filter((key) => parsed[key] !== undefined)
          .map((key) => [key, typeof parsed[key] === 'string'
            ? (parsed[key] as string).replace(/\s+/g, ' ').trim().slice(0, 600)
            : parsed[key]]),
      );
      evidenceSignature = `${reactActionSignature(step)}:${JSON.stringify(evidence)}`;
    } catch {
      evidenceSignature = `${reactActionSignature(step)}:${observation.replace(/\s+/g, ' ').trim().slice(0, 600)}`;
    }
    if (seen.has(evidenceSignature)) repeated += 1;
    else seen.add(evidenceSignature);
  }
  return repeated;
}

/** Open the repeated-inspection circuit only for a continuous run. */
export function shouldTripContinuousRunNoProgressCircuit(
  state: Pick<ReActEngineState, 'steps' | 'continuationHandoff' | 'noProgressCount'>,
  continuousRun: boolean,
  threshold = 8,
): boolean {
  return continuousRun && (state.noProgressCount || 0) >= threshold && hasRepeatedSuccessfulInspectionLoop(state);
}

/** Store the latest verification result on the run state. */
export function setVerificationResult<State extends { verificationResult?: VerificationResult }>(
  state: State,
  result: VerificationResult,
): void {
  state.verificationResult = result;
}

/** Store the generated application manifest identifier on the run state. */
export function setAppManifestId<State extends { appManifestId?: string }>(state: State, manifestId: string): void {
  state.appManifestId = manifestId;
}

/** Increment the number of repair attempts made by the run. */
export function incrementRepairAttempts<State extends { repairAttempts: number }>(state: State): void {
  state.repairAttempts += 1;
}

export const EDIT_STAGNATION_FAILURE_LIMIT = 3;

/** Detect a stale-hash, missing-preimage, or pattern-not-found conflict. */
export function isHashConflictOrStalePreimageError(observation?: string): boolean {
  if (!observation) return false;
  return /stale expected hash|old_string was not found in the guarded preimage|expectedHash from a guarded read is required|Pattern not found in file/i.test(observation);
}

/** Track consecutive mutation failures on one target file. */
export function trackMutationFailure<State extends {
  consecutiveEditFailureCount?: number;
  consecutiveEditFailureTarget?: string;
}>(state: State, targetFile?: string, isHashConflict: boolean = false): void {
  if (!isHashConflict || !targetFile) {
    state.consecutiveEditFailureCount = 0;
    state.consecutiveEditFailureTarget = undefined;
    return;
  }

  const normalizedTarget = targetFile.replace(/\\/g, '/').toLowerCase();
  const currentTarget = state.consecutiveEditFailureTarget?.replace(/\\/g, '/').toLowerCase();

  if (currentTarget === normalizedTarget) {
    state.consecutiveEditFailureCount = (state.consecutiveEditFailureCount || 0) + 1;
  } else {
    state.consecutiveEditFailureTarget = targetFile;
    state.consecutiveEditFailureCount = 1;
  }
}

/** Return whether repeated guarded-edit conflicts have stalled the run. */
export function isEditStagnated<State extends { consecutiveEditFailureCount?: number }>(
  state: State,
  limit: number = EDIT_STAGNATION_FAILURE_LIMIT,
): boolean {
  return (state.consecutiveEditFailureCount || 0) >= limit;
}
