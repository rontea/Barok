import type { ReactStep } from './react-contracts.js';
import type { ToolAction } from './tool-action.js';
import { isSuccessfulToolObservation } from './tool-observation.js';
import { classifyPolicyAction } from './action-policy.js';

export interface RetainedInspectionRead {
  path: string;
  stepIndex: number;
  fullContentRetained: boolean;
}

export interface LastRunReplayMarker {
  completedStepCount: number;
  lastAction?: string;
  lastActionInput?: Record<string, unknown>;
  lastActionSucceeded?: boolean;
}

interface ObservedReadRange {
  start: number;
  end: number;
  empty: boolean;
  requestedWithoutLimit: boolean;
}

export function normalizeInspectionPath(input: Record<string, unknown> | undefined): string | undefined {
  const value = input?.file_path ?? input?.path;
  return typeof value === 'string' && value.trim()
    ? value.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
    : undefined;
}

export function stableReplayValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableReplayValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableReplayValue(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

/** Protect state-changing, expensive, or external actions from exact cross-run replay. */
export function isCrossRunReplayProtectedAction(
  action: Pick<ToolAction, 'action' | 'action_input'>,
): boolean {
  const { category } = classifyPolicyAction(action);
  return category !== 'read' && category !== 'network';
}

/** A resumed run must advance beyond its last successful protected parent action. */
export function isUnadvancedLastRunReplay(
  steps: readonly ReactStep[],
  marker: LastRunReplayMarker | undefined,
  action: Pick<ToolAction, 'action' | 'action_input'>,
): boolean {
  if (!isCrossRunReplayProtectedAction(action)) return false;
  if (!marker?.lastAction || marker.lastActionSucceeded !== true || !marker.lastActionInput) return false;
  const childSteps = steps.slice(Math.min(marker.completedStepCount, steps.length));
  const hasAdvanced = childSteps.some((step) =>
    step.action !== 'ReplayGuard' && isSuccessfulToolObservation(step.observation || '')
  );
  if (hasAdvanced) return false;
  return action.action === marker.lastAction &&
    stableReplayValue(action.action_input || {}) === stableReplayValue(marker.lastActionInput);
}

function positiveInteger(value: unknown, fallback?: number): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

function requestedReadRange(input: Record<string, unknown> | undefined) {
  const start = positiveInteger(input?.offset, 1) || 1;
  const limit = positiveInteger(input?.limit);
  return {
    start,
    end: limit ? start + limit - 1 : Number.POSITIVE_INFINITY,
    limit,
  };
}

function observedReadRange(step: ReactStep): ObservedReadRange | undefined {
  if (!isSuccessfulToolObservation(step.observation || '')) return undefined;
  const requested = requestedReadRange(step.action_input);
  try {
    const parsed = JSON.parse(step.observation || '{}') as {
      output?: unknown;
      truncated?: unknown;
      fullOutput?: { persisted?: unknown };
    };
    const output = typeof parsed.output === 'string' ? parsed.output : '';
    const empty = output.trim().length === 0;
    const visibleLineCount = empty ? 0 : Math.max(1, output.split(/\r?\n/).length);
    const outputWasCompacted = parsed.fullOutput?.persisted === true;
    let end = requested.end;
    if (empty) {
      end = requested.start;
    } else if (requested.limit) {
      end = Math.min(requested.end, requested.start + visibleLineCount - 1);
    } else if (outputWasCompacted || parsed.truncated === true) {
      // Only the preview was model-visible. Do not claim coverage for the
      // persisted portion of the file that was not present in the prompt.
      end = requested.start + visibleLineCount - 1;
    }
    return {
      start: requested.start,
      end,
      empty,
      requestedWithoutLimit: !requested.limit,
    };
  } catch {
    return undefined;
  }
}

function rangeIsCovered(start: number, end: number, ranges: ObservedReadRange[]): boolean {
  if (!Number.isFinite(end)) {
    return ranges.some((range) => range.start <= start && !Number.isFinite(range.end));
  }
  const ordered = ranges
    .filter((range) => !range.empty && range.end >= start && range.start <= end)
    .sort((left, right) => left.start - right.start);
  let cursor = start;
  for (const range of ordered) {
    if (range.start > cursor) return false;
    cursor = Math.max(cursor, range.end + 1);
    if (cursor > end) return true;
  }
  return false;
}

/**
 * Track model-visible line coverage. The host supplies the current steps and
 * the indexes selected into retained prompt context, without exposing file
 * contents to the replay guard.
 */
export function getSemanticInspectionReplayReason(
  currentSteps: readonly ReactStep[],
  retainedReadStepIndexes: ReadonlySet<number>,
  action: Pick<ToolAction, 'action' | 'action_input'>,
): string | undefined {
  if (action.action !== 'Read' && action.action !== 'DocumentRead') return undefined;
  const targetPath = normalizeInspectionPath(action.action_input);
  if (!targetPath) return undefined;
  const priorRanges: ObservedReadRange[] = [];
  for (let index = currentSteps.length - 1; index >= 0; index -= 1) {
    const step = currentSteps[index];
    if ((step.action === 'Write' || step.action === 'Edit') &&
        isSuccessfulToolObservation(step.observation || '')) {
      break;
    }
    if ((step.action === 'Read' || step.action === 'DocumentRead') &&
        normalizeInspectionPath(step.action_input) === targetPath) {
      const observed = observedReadRange(step);
      if (observed && retainedReadStepIndexes.has(index)) priorRanges.push(observed);
    }
  }
  if (!priorRanges.length) return undefined;

  const requested = requestedReadRange(action.action_input);
  const knownEmptyBoundary = priorRanges
    .filter((range) => range.empty)
    .reduce((lowest, range) => Math.min(lowest, range.start), Number.POSITIVE_INFINITY);
  if (requested.start >= knownEmptyBoundary) {
    return `Semantic inspection loop prevented: ${targetPath} previously returned no content from line ${knownEmptyBoundary}. Reading from line ${requested.start} cannot add evidence. Use the captured requirements, choose Edit/Write, or inspect a different unresolved file.`;
  }
  if (rangeIsCovered(requested.start, requested.end, priorRanges)) {
    const rangeLabel = Number.isFinite(requested.end)
      ? `lines ${requested.start}-${requested.end}`
      : `line ${requested.start} through the visible end`;
    return `Semantic inspection loop prevented: ${rangeLabel} of ${targetPath} is already present in model-visible memory. Choose Edit/Write, or request a genuinely uncovered range.`;
  }
  if (!requested.limit && priorRanges.some((range) =>
    range.requestedWithoutLimit && range.start === requested.start
  )) {
    const nextUncoveredLine = priorRanges
      .filter((range) => !range.empty)
      .reduce((highest, range) => Math.max(highest, range.end), requested.start - 1) + 1;
    return `Semantic inspection loop prevented: the unbounded read of ${targetPath} from line ${requested.start} was already attempted. Its visible preview is retained. Use Grep plus a targeted range${Number.isFinite(nextUncoveredLine) ? ` starting at or after line ${nextUncoveredLine}` : ''}, or proceed to Edit/Write.`;
  }
  return undefined;
}

/** Suppress a near-term re-read only when the unchanged file's full contents remain in prompt memory. */
export function getRecentUnchangedReadLoopReason(
  currentSteps: readonly ReactStep[],
  retainedReadCoverage: readonly RetainedInspectionRead[],
  action: Pick<ToolAction, 'action' | 'action_input'>,
  recentActionWindow = 3,
): string | undefined {
  if (action.action !== 'Read' && action.action !== 'DocumentRead') return undefined;
  const targetPath = normalizeInspectionPath(action.action_input);
  if (!targetPath) return undefined;

  const actionWindow = Number.isFinite(recentActionWindow)
    ? Math.max(1, Math.floor(recentActionWindow))
    : 3;
  const windowStart = Math.max(0, currentSteps.length - 1 - actionWindow);
  let recentRead = false;
  for (let index = currentSteps.length - 1; index >= windowStart; index -= 1) {
    const step = currentSteps[index];
    const stepPath = normalizeInspectionPath(step.action_input);
    if (stepPath !== targetPath) continue;
    if ((step.action === 'Write' || step.action === 'Edit') &&
        isSuccessfulToolObservation(step.observation || '')) {
      return undefined;
    }
    if ((step.action === 'Read' || step.action === 'DocumentRead') &&
        isSuccessfulToolObservation(step.observation || '')) {
      recentRead = true;
      break;
    }
  }
  if (!recentRead) return undefined;

  const fullContentIsRetained = retainedReadCoverage.some((entry) =>
    entry.path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase() === targetPath &&
    entry.fullContentRetained,
  );
  if (!fullContentIsRetained) return undefined;

  return `Repeated Read suppressed: ${targetPath} was read within the last ${actionWindow} action turns, has not been changed since, and its full content is still in Retained File Context. Use that content; read again only if the file changes or the retained content is incomplete.`;
}
