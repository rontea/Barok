import { getContinuationWorkspaceRelativePath } from './continuation-path.js';
import { estimateTextTokens } from './token-accounting.js';
import { isVerificationAction, verificationCheckForAction } from './verification-action.js';
import { redactPolicyText } from '@barok/core';

export const CONTINUATION_HANDOFF_VERSION = 1 as const;

export type ContinuationReason = 'conversational_confirmation' | 'max_steps' | 'saved_run';

export interface ContinuationStep {
  action: string;
  action_input?: Record<string, unknown>;
  observation?: string;
}

export interface ContinuationPlanItem {
  step: string;
  status: string;
}

export interface ContinuationLastRun {
  completedStepCount: number;
  lastAction?: string;
  lastActionInput?: Record<string, unknown>;
  lastActionSucceeded?: boolean;
  nextPlanItem?: string;
  recordedAt: number;
}

/** Minimal host-neutral state needed to create a bounded continuation handoff. */
export interface ContinuationState {
  task: string;
  plan: readonly ContinuationPlanItem[];
  steps: readonly ContinuationStep[];
  workspace?: string;
  modelContextWindow?: number;
  blockedReason?: string;
  codingState?: string;
  lastRun?: ContinuationLastRun;
}

export interface ContinuationHandoffPreview {
  currentGoal: string;
  /** Actual input context window of the model used by the parent run. */
  modelContextWindow?: number;
  /** The workspace changed after the parent checkpoint, so old reads are context rather than current evidence. */
  workspaceRebased?: boolean;
  /** Bounded, checkpoint-derived ledger used to avoid replaying finished work. */
  completedPlanItems?: string[];
  remainingPlanItems?: string[];
  updatedFiles?: string[];
  verifiedChecks?: string[];
  remainingPlanItem?: string;
  latestUpdatedFile?: string;
  latestVerifiedCheck?: string;
  blocker?: string;
  /** Warning if prior turn suffered from repeated edit hash conflicts on the same file. */
  stagnationWarning?: string;
  lastRun?: ContinuationLastRun;
  /** Compact execution tail; never includes successful tool output or file contents. */
  recentActions?: Array<{
    action: string;
    target?: string;
    outcome: 'succeeded' | 'failed';
    failure?: string;
  }>;
}

export interface ContinuationHandoff extends ContinuationHandoffPreview {
  version: typeof CONTINUATION_HANDOFF_VERSION;
  parentRunId: string;
  reason: ContinuationReason;
  createdAt: number;
  evidence: {
    parentStepCount: number;
    childStepOffset: number;
    actionSignatures: string[];
    fileReadPaths: string[];
  };
  quality: ContinuationQualityMetrics;
}

export interface ContinuationQualityMetrics {
  sourcePromptTokens: number;
  handoffPromptTokens: number;
  promptReductionTokens: number;
  promptReductionRatio: number;
  repeatedParentActions: number;
  staleParentFileReads: number;
}

function successfulStep(step: ContinuationStep): boolean {
  if (!step.observation) return false;
  try {
    const parsed = JSON.parse(step.observation) as { success?: unknown; status?: unknown; skipped?: unknown; verificationUnavailable?: unknown };
    if (parsed.success === false || parsed.skipped === true || parsed.verificationUnavailable === true) return false;
    if (isVerificationAction(step.action, step.action_input) &&
      (parsed.status === 'skipped' || parsed.status === 'unavailable')) return false;
    if (isVerificationAction(step.action, step.action_input) &&
      (parsed.success === true || parsed.status === 'passed' || parsed.status === 'success')) {
      const output = (parsed as { output?: unknown }).output;
      if (typeof output !== 'string' || !output.trim()) return false;
    }
    return parsed.status === undefined || parsed.status === 'passed' || parsed.status === 'success';
  } catch {
    return !/\b(error|failed|cancelled|canceled|unavailable|skipped)\b/i.test(step.observation);
  }
}

function latestVerifiedCheck(steps: readonly ContinuationStep[]): string | undefined {
  return verifiedChecks(steps).at(-1);
}

function isInfrastructureRecoveryPlanItem(step: string): boolean {
  return /\b(?:rate.?limit|throttl|quota|cooldown|api\s+key|provider|fallback|handover|all\s+llm\s+providers|groq|gemini|nvidia|openrouter|requesty|kimi)\b/i.test(step);
}

function remainingPlanItem(plan: readonly ContinuationPlanItem[]): string | undefined {
  const active = plan.find((item) => item.status === 'in_progress' && !isInfrastructureRecoveryPlanItem(item.step))?.step;
  if (active) return active;
  return plan.find((item) => item.status === 'pending' && !isInfrastructureRecoveryPlanItem(item.step))?.step;
}

function relevantPlanItems(plan: readonly ContinuationPlanItem[], status: ContinuationPlanItem['status']): string[] {
  return plan
    .filter((item) => item.status === status && !isInfrastructureRecoveryPlanItem(item.step))
    .map((item) => item.step);
}

function boundedUnique(values: Array<string | undefined>, limit = 12): string[] {
  const unique = Array.from(new Set(values.filter((value): value is string => Boolean(value))));
  return unique.slice(Math.max(0, unique.length - limit));
}

function displayStepPath(step: ContinuationStep, workspace: string): string | undefined {
  const value = step.action_input?.file_path ?? step.action_input?.path ??
    (step.action === 'Glob' ? step.action_input?.pattern : undefined) ??
    (step.action === 'Grep' ? step.action_input?.includePattern : undefined);
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    return getContinuationWorkspaceRelativePath(value, workspace);
  } catch {
    return undefined;
  }
}

function updatedFiles(steps: readonly ContinuationStep[], workspace: string): string[] {
  return boundedUnique(steps
    .filter((step) => successfulStep(step) && (step.action === 'Write' || step.action === 'Edit'))
    .map((step) => displayStepPath(step, workspace)));
}

function verifiedChecks(steps: readonly ContinuationStep[]): string[] {
  return boundedUnique(steps.map((step) => {
    const actionInput = step.action_input ?? {};
    const check = verificationCheckForAction(step.action, actionInput);
    if (!check || !successfulStep(step)) return undefined;
    const target = typeof actionInput.command === 'string'
      ? actionInput.command
      : typeof actionInput.operation === 'string'
        ? actionInput.operation
        : undefined;
    return target ? `${check}: ${target}` : check;
  }));
}

const RECENT_ACTION_LIMIT = 7;
const RECENT_ACTION_TARGET_LIMIT = 160;
const RECENT_ACTION_FAILURE_LIMIT = 180;
const FILE_PATH_ACTIONS = new Set(['Read', 'DocumentRead', 'Write', 'Edit', 'Glob', 'Grep', 'WorkspaceChanges']);

function compactActionValue(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const compacted = redactPolicyText(value).replace(/\s+/g, ' ').trim();
  return compacted.length > limit ? `${compacted.slice(0, limit - 3)}...` : compacted;
}

const MAX_HANDOFF_PROMPT_TOKENS = 3_000;

function boundedGoal(value: string, limit = 4_800): string {
  const safe = redactPolicyText(value || '').trim();
  if (safe.length <= limit) return safe;
  const startLength = Math.floor(limit * 0.68);
  const endLength = Math.max(0, limit - startLength - 90);
  const start = safe.slice(0, startLength);
  const end = endLength ? safe.slice(-endLength) : '';
  return `${start}\n...[middle of original goal omitted to keep the continuation bounded]...\n${end}`;
}

function boundedSummary(value: string | undefined, limit: number): string | undefined {
  const safe = compactActionValue(value, limit);
  if (safe && /stack trace|\bat\s+\S+\s*\(|policy dump|private key|-----BEGIN|```/i.test(safe)) {
    return 'Detailed diagnostic omitted; use the latest run evidence.';
  }
  return safe;
}

function fitPreviewBudget(preview: ContinuationHandoffPreview): ContinuationHandoffPreview {
  let bounded = preview;
  if (estimateTextTokens(stableValue(bounded)) <= MAX_HANDOFF_PROMPT_TOKENS) return bounded;

  // Keep the active goal and the first actionable remaining item. Older
  // accomplishments are the first fields to shrink when a continuation is
  // unusually large.
  bounded = {
    ...bounded,
    completedPlanItems: bounded.completedPlanItems?.slice(-2),
    remainingPlanItems: bounded.remainingPlanItems?.slice(0, 4),
    updatedFiles: bounded.updatedFiles?.slice(-4),
    verifiedChecks: bounded.verifiedChecks?.slice(-3),
    recentActions: bounded.recentActions?.slice(-4).map((action) => ({
      ...action,
      ...(action.failure ? { failure: action.failure.slice(0, 100) } : {}),
    })),
    blocker: bounded.blocker?.slice(0, 240),
    stagnationWarning: bounded.stagnationWarning?.slice(0, 220),
  };
  if (estimateTextTokens(stableValue(bounded)) <= MAX_HANDOFF_PROMPT_TOKENS) return bounded;
  return {
    ...bounded,
    currentGoal: boundedGoal(bounded.currentGoal, 3_600),
    completedPlanItems: [],
    remainingPlanItems: bounded.remainingPlanItems?.slice(0, 2),
    updatedFiles: bounded.updatedFiles?.slice(-2),
    verifiedChecks: bounded.verifiedChecks?.slice(-2),
    recentActions: bounded.recentActions?.slice(-4),
    blocker: bounded.blocker?.slice(0, 180),
    stagnationWarning: bounded.stagnationWarning?.slice(0, 180),
  };
}

function recentActionTarget(step: ContinuationStep, workspace: string): string | undefined {
  if (FILE_PATH_ACTIONS.has(step.action)) {
    return compactActionValue(displayStepPath(step, workspace), RECENT_ACTION_TARGET_LIMIT);
  }
  if (step.action === 'Bash') return 'command';
  if (step.action === 'Command') {
    return compactActionValue(
      step.action_input?.command ?? step.action_input?.operation,
      RECENT_ACTION_TARGET_LIMIT,
    );
  }
  return compactActionValue(
    step.action_input?.operation ?? step.action_input?.query,
    RECENT_ACTION_TARGET_LIMIT,
  );
}

function recentActionFailure(step: ContinuationStep): string | undefined {
  if (successfulStep(step) || !step.observation) return undefined;
  let value = step.observation;
  try {
    const parsed = JSON.parse(step.observation) as Record<string, unknown>;
    const candidate = parsed.error ?? parsed.message ?? parsed.reason;
    if (typeof candidate === 'string') value = candidate;
  } catch {
    // Do not pass raw legacy observations or command output into a continuation.
    return `${step.action} failed`;
  }
  if (/stack trace|\bat\s+\S+\s*\(|policy dump|private key|-----BEGIN|```/i.test(value)) return `${step.action} failed`;
  return compactActionValue(value, RECENT_ACTION_FAILURE_LIMIT);
}

function hasRejectedFilePath(step: ContinuationStep, workspace: string): boolean {
  const values = step.action === 'Glob'
    ? [step.action_input?.pattern]
    : step.action === 'Grep'
      ? [step.action_input?.path, step.action_input?.includePattern]
      : [step.action_input?.file_path ?? step.action_input?.path];
  return values.some((value) => {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
      getContinuationWorkspaceRelativePath(value, workspace);
      return false;
    } catch {
      return true;
    }
  });
}

function recentActions(steps: readonly ContinuationStep[], workspace: string): NonNullable<ContinuationHandoffPreview['recentActions']> {
  const successes: Array<{ index: number; action: NonNullable<ContinuationHandoffPreview['recentActions']>[number] }> = [];
  const latestFailures = new Map<string, { index: number; action: NonNullable<ContinuationHandoffPreview['recentActions']>[number]; fingerprint: string }>();
  steps.forEach((step, index) => {
    const succeeded = successfulStep(step);
    const hasFilePath = FILE_PATH_ACTIONS.has(step.action);
    const target = recentActionTarget(step, workspace);
    // Never put a rejected external path or its error text into the next
    // planner context. The structured harness intervention remains auditable.
    if (hasFilePath && hasRejectedFilePath(step, workspace)) return;
    const failure = succeeded ? undefined : recentActionFailure(step);
    const action = {
      action: step.action.slice(0, 80),
      ...(target ? { target } : {}),
      outcome: succeeded ? 'succeeded' as const : 'failed' as const,
      ...(failure ? { failure } : {}),
    };
    if (succeeded) {
      successes.push({ index, action });
      return;
    }
    const category = /rate.?limit|quota|cooldown|provider|api key|policy|approval|permission/i.test(failure || '')
      ? 'provider_policy'
      : verificationCheckForAction(step.action, step.action_input) || /\bverify\b/i.test(String(step.action_input?.operation || ''))
        ? 'verification'
        : step.action === 'Write' || step.action === 'Edit' || step.action === 'ReplaceFile'
          ? 'mutation'
          : step.action === 'Command' || step.action === 'Bash'
            ? 'command'
            : 'other';
    const fingerprint = (failure || `${step.action} failed`).toLowerCase()
      .replace(/\b\d+\b/g, '#')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    const prior = latestFailures.get(category);
    if (!prior || prior.fingerprint !== fingerprint || index > prior.index) {
      latestFailures.set(category, { index, action, fingerprint });
    }
  });
  const failures = Array.from(latestFailures.values()).map(({ index, action }) => ({ index, action }));
  return [...successes.slice(-4), ...failures]
    .sort((left, right) => left.index - right.index)
    .slice(-RECENT_ACTION_LIMIT)
    .map(({ action }) => action);
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

function boundedHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function actionSignature(step: ContinuationStep): string {
  return `${step.action}:${boundedHash(stableValue(step.action_input || {}))}`;
}

function stepPath(step: ContinuationStep): string | undefined {
  const value = step.action_input?.file_path ?? step.action_input?.path;
  return typeof value === 'string' && value.trim()
    ? value.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
    : undefined;
}

function initialQuality(state: ContinuationState, preview: ContinuationHandoffPreview): ContinuationQualityMetrics {
  const sourcePromptTokens = estimateTextTokens(stableValue({ task: state.task, plan: state.plan, steps: state.steps }));
  const handoffPromptTokens = Math.min(MAX_HANDOFF_PROMPT_TOKENS, estimateTextTokens(stableValue(preview)) + 200);
  const promptReductionTokens = Math.max(0, sourcePromptTokens - handoffPromptTokens);
  return {
    sourcePromptTokens,
    handoffPromptTokens,
    promptReductionTokens,
    promptReductionRatio: sourcePromptTokens > 0 ? promptReductionTokens / sourcePromptTokens : 0,
    repeatedParentActions: 0,
    staleParentFileReads: 0,
  };
}

function detectRecentEditStagnation(steps: readonly ContinuationStep[], workspace: string): string | undefined {
  const tail = steps.slice(-10);
  const failedEdits = tail.filter((s) =>
    (s.action === 'Write' || s.action === 'Edit' || s.action === 'ReplaceFile') &&
    /stale expected hash|old_string was not found in the guarded preimage|expectedHash from a guarded read is required|Pattern not found in file/i.test(s.observation || '')
  );
  if (failedEdits.length >= 2) {
    const targets = Array.from(new Set(failedEdits
      .map((step) => displayStepPath(step, workspace))
      .filter((target): target is string => Boolean(target))));
    const targetStr = targets.length ? targets.join(', ') : 'the target file';
    return `The prior turn encountered ${failedEdits.length} edit failures (hash conflicts or stale preimages) on ${targetStr}. You MUST perform a fresh Read of the file before attempting any edit, or inspect whether the edit is already applied.`;
  }
  return undefined;
}

export function summarizeContinuationState(state: ContinuationState): ContinuationHandoffPreview {
  // Continuation summaries are shared with the browser UI. With no workspace
  // available, treat relative paths as workspace-relative and reject absolutes.
  const workspace = state.workspace || '.';
  const completedPlanItems = relevantPlanItems(state.plan || [], 'completed').slice(-12);
  const remainingPlanItems = [
    ...relevantPlanItems(state.plan || [], 'in_progress'),
    ...relevantPlanItems(state.plan || [], 'pending'),
  ].slice(0, 12);
  const checkpointUpdatedFiles = updatedFiles(state.steps || [], workspace);
  const checkpointVerifiedChecks = verifiedChecks(state.steps || []);
  const boundedLastRun = state.lastRun
    ? {
        completedStepCount: state.lastRun.completedStepCount,
        lastAction: state.lastRun.lastAction,
        lastActionSucceeded: state.lastRun.lastActionSucceeded,
        nextPlanItem: state.lastRun.nextPlanItem,
        recordedAt: state.lastRun.recordedAt,
      }
    : undefined;
  const preview: ContinuationHandoffPreview = {
    currentGoal: boundedGoal(state.task),
    ...(typeof state.modelContextWindow === 'number' && Number.isFinite(state.modelContextWindow) && state.modelContextWindow > 0
      ? { modelContextWindow: state.modelContextWindow }
      : {}),
    completedPlanItems: completedPlanItems.slice(-4).map((item) => boundedSummary(item, 160) || ''),
    remainingPlanItems: remainingPlanItems.slice(0, 6).map((item) => boundedSummary(item, 200) || ''),
    updatedFiles: checkpointUpdatedFiles.slice(-6).map((item) => boundedSummary(item, 160) || ''),
    verifiedChecks: checkpointVerifiedChecks.slice(-5).map((item) => boundedSummary(item, 180) || ''),
    remainingPlanItem: boundedSummary(remainingPlanItem(state.plan || []), 240),
    ...(checkpointUpdatedFiles.length ? { latestUpdatedFile: boundedSummary(checkpointUpdatedFiles.at(-1), 160) } : {}),
    latestVerifiedCheck: boundedSummary(latestVerifiedCheck(state.steps || []), 180),
    blocker: boundedSummary(state.blockedReason || (state.codingState === 'blocked' ? 'The run is blocked and requires review before continuing.' : undefined), 360),
    ...(boundedLastRun ? { lastRun: {
      ...boundedLastRun,
      ...(boundedLastRun.lastAction ? { lastAction: boundedSummary(boundedLastRun.lastAction, 80) } : {}),
      ...(boundedLastRun.nextPlanItem ? { nextPlanItem: boundedSummary(boundedLastRun.nextPlanItem, 200) } : {}),
    } } : {}),
    recentActions: recentActions(state.steps || [], workspace),
    ...(detectRecentEditStagnation(state.steps || [], workspace) ? { stagnationWarning: boundedSummary(detectRecentEditStagnation(state.steps || [], workspace), 260) } : {}),
  };
  return fitPreviewBudget(preview);
}

export function createContinuationHandoff(input: {
  parentRunId: string;
  reason: ContinuationReason;
  state: ContinuationState;
  includesParentSteps?: boolean;
  workspaceRebased?: boolean;
  createdAt?: number;
}): ContinuationHandoff {
  const preview = {
    ...summarizeContinuationState(input.state),
    ...(input.workspaceRebased ? { workspaceRebased: true } : {}),
  };
  return {
    version: CONTINUATION_HANDOFF_VERSION,
    parentRunId: input.parentRunId,
    reason: input.reason,
    createdAt: input.createdAt ?? Date.now(),
    ...preview,
    evidence: {
      parentStepCount: input.state.steps.length,
      childStepOffset: input.includesParentSteps === false ? 0 : input.state.steps.length,
      actionSignatures: Array.from(new Set(input.state.steps.map(actionSignature))).slice(-64),
      fileReadPaths: Array.from(new Set(input.state.steps
        .filter((step) => step.action === 'Read' || step.action === 'DocumentRead')
        .map((step) => {
          const value = stepPath(step);
          if (!value) return undefined;
          try { return getContinuationWorkspaceRelativePath(value, input.state.workspace || '.').toLowerCase(); }
          catch { return undefined; }
        })
        .filter((value): value is string => Boolean(value)))).slice(-64).map((path) => path.slice(0, 200)),
    },
    quality: initialQuality(input.state, preview),
  };
}

export function measureContinuationQuality(
  handoff: ContinuationHandoff,
  allSteps: readonly ContinuationStep[]
): ContinuationQualityMetrics {
  const childSteps = allSteps.slice(Math.min(handoff.evidence.childStepOffset, allSteps.length));
  const parentActions = new Set(handoff.evidence.actionSignatures);
  const parentReads = new Set(handoff.evidence.fileReadPaths);
  const mutatedPaths = new Set<string>();
  let repeatedParentActions = 0;
  let staleParentFileReads = 0;

  for (const step of childSteps) {
    if (parentActions.has(actionSignature(step))) repeatedParentActions += 1;
    const path = stepPath(step);
    if ((step.action === 'Write' || step.action === 'Edit') && path) mutatedPaths.add(path);
    if ((step.action === 'Read' || step.action === 'DocumentRead') && path && parentReads.has(path) && !mutatedPaths.has(path)) {
      staleParentFileReads += 1;
    }
  }

  return { ...handoff.quality, repeatedParentActions, staleParentFileReads };
}

export function isContinuationHandoff(value: unknown): value is ContinuationHandoff {
  const candidate = value as Partial<ContinuationHandoff> | undefined;
  return Boolean(candidate && candidate.version === CONTINUATION_HANDOFF_VERSION &&
    typeof candidate.parentRunId === 'string' && isContinuationReason(candidate.reason) &&
    candidate.evidence && typeof candidate.evidence.childStepOffset === 'number' && Array.isArray(candidate.evidence.actionSignatures) &&
    candidate.quality && typeof candidate.quality.sourcePromptTokens === 'number');
}

export function isContinuationReason(value: unknown): value is ContinuationReason {
  return value === 'conversational_confirmation' || value === 'max_steps' || value === 'saved_run';
}
