import type { ReactStep } from './react-contracts.js';
import { estimateTextTokens } from './token-accounting.js';
import { isVerificationAction } from './verification-action.js';

function successfulHistoryStep(step: ReactStep): boolean {
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
const STEP_HISTORY_DEFAULT_TOKEN_BUDGET = 10_000;
const STEP_HISTORY_RECENT_LIMIT = 6;
const STEP_HISTORY_THOUGHT_LIMIT = 900;
const STEP_HISTORY_INPUT_LIMIT = 1200;
const STEP_HISTORY_OBSERVATION_LIMIT = 2000;
const STEP_HISTORY_SUMMARY_LIMIT = 240;
const RETAINED_READ_CONTEXT_DEFAULT_TOKEN_BUDGET = 2_000;
const RETAINED_READ_CONTEXT_ENTRY_CHAR_LIMIT = 8_000;
const RETAINED_READ_CONTEXT_MAX_ENTRIES = 8;

export interface StepHistoryOptions {
  maxTokens?: number;
  recentStepCount?: number;
  thoughtLimit?: number;
  inputLimit?: number;
  observationLimit?: number;
  /** Read ranges already rendered in the separate retained-file-context section. */
  retainedReadCoverage?: readonly RetainedReadCoverage[];
  /** Enable compact read pointers when retained file context is rendered separately. */
  deduplicateReadContext?: boolean;
}

function truncateLiveText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[truncated ${value.length - limit} chars]`;
}

function truncateHistoryText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const omitted = value.length - limit;
  const detailedMarker = `\n...[server step-history compaction: ${omitted} chars omitted from this prompt; this alone does not mean tool output was truncated. Check the tool result's truncated status and retained file context.]`;
  const marker = detailedMarker.length < limit
    ? detailedMarker
    : `...[history compacted; ${omitted} chars omitted]`.slice(0, limit);
  return `${value.slice(0, Math.max(0, limit - marker.length))}${marker}`;
}

function stringifyHistoryValue(value: unknown, limit: number): string {
  try {
    return truncateHistoryText(JSON.stringify(value), limit);
  } catch {
    return truncateHistoryText(String(value), limit);
  }
}

function observationStatus(step: ReactStep): string {
  const observation = step.observation || '';
  if (!observation) return 'pending';
  try {
    const parsed = JSON.parse(observation);
    if (parsed && typeof parsed === 'object' && 'success' in parsed) {
      return (parsed as { success?: unknown }).success ? 'success' : 'failed';
    }
  } catch {
    // Fall through to text checks for legacy observations.
  }
  return /error executing|tool execution failed|failed|error|guarded mutation rejected/i.test(observation)
    ? 'failed'
    : 'observed';
}

/**
 * Mutation results can contain large diffs and opaque hashes. They are useful
 * to the executor, but copying them into the planner prompt encourages some
 * models to continue a truncated JSON value instead of selecting a tool.
 * Keep only the semantic result fields needed for planning.
 */
function observationForStepHistory(step: ReactStep): string {
  const observation = step.observation || '';
  if (!observation || (step.action !== 'Write' && step.action !== 'Edit')) return observation;

  try {
    const parsed = JSON.parse(observation) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return observation;

    const summary: Record<string, unknown> = {};
    for (const key of ['success', 'status', 'type', 'filepath', 'changedFiles', 'error', 'output']) {
      if (key in parsed) summary[key] = parsed[key];
    }

    return JSON.stringify(summary);
  } catch {
    return observation;
  }
}

function retainedReadCoverageKey(path: string, startLine: number, endLine: number): string {
  return `${path.toLowerCase()}:${startLine}:${Number.isFinite(endLine) ? endLine : 'eof'}`;
}

function historyReadRangeKey(step: ReactStep): string | undefined {
  const path = retainedReadPath(step);
  const read = retainedReadContent(step);
  if (!path || !read) return undefined;
  const range = retainedReadRange(step, read.output, read.parsed);
  return retainedReadCoverageKey(path, range.startLine, range.endLine);
}

function readObservationForStepHistory(
  step: ReactStep,
  index: number,
  latestSuccessfulReadIndex: number,
  retainedReadKeys: ReadonlySet<string>,
  deduplicateReadContext: boolean,
): string {
  const read = retainedReadContent(step);
  if (!read || !deduplicateReadContext) return observationForStepHistory(step);

  const path = retainedReadPath(step) || 'the file';
  const pointer = retainedReadKeys.has(historyReadRangeKey(step) || '')
    ? `Read ${read.output.length.toLocaleString()} chars from ${path} (content retained in File Context above)`
    : `Read ${read.output.length.toLocaleString()} chars from ${path} (content not retained in File Context; reread a specific range if needed)`;

  // Preserve one useful source payload when retained memory omitted the latest
  // read. Earlier omitted reads get a pointer so they do not duplicate large
  // file bodies while still recording that evidence was observed.
  return !retainedReadKeys.has(historyReadRangeKey(step) || '') && index === latestSuccessfulReadIndex
    ? observationForStepHistory(step)
    : pointer;
}

function summarizeHistoryStep(
  step: ReactStep,
  index: number,
  latestSuccessfulReadIndex = -1,
  retainedReadKeys: ReadonlySet<string> = new Set(),
  deduplicateReadContext = false,
): string {
  const input = step.action_input || {};
  const command = typeof input.command === 'string' ? input.command : undefined;
  const path = typeof input.path === 'string'
    ? input.path
    : typeof input.file_path === 'string'
      ? input.file_path
      : undefined;
  const target = command || path || stringifyHistoryValue(input, 120);
  const observation = truncateHistoryText(readObservationForStepHistory(
    step,
    index,
    latestSuccessfulReadIndex,
    retainedReadKeys,
    deduplicateReadContext,
  ).replace(/\s+/g, ' ').trim(), STEP_HISTORY_SUMMARY_LIMIT);
  let artifactReference = '';
  try {
    const parsed = JSON.parse(step.observation || '{}') as { fullOutput?: { persisted?: boolean; path?: string }; outputArtifact?: { path?: string } };
    const path = parsed.fullOutput?.persisted ? parsed.fullOutput.path : parsed.outputArtifact?.path;
    if (path) artifactReference = `; authoritative full output: ${path}`;
  } catch {
    // Legacy observations have no typed artifact metadata.
  }
  const suffix = `${observation ? `; observation: ${observation}` : ''}${artifactReference}`;
  return `- Action ${index + 1}: ${step.action} ${target ? `(${truncateHistoryText(target, 180)}) ` : ''}-> ${observationStatus(step)}${suffix}`;
}

function fitHistoryToBudget(history: string, maxTokens: number): string {
  if (estimateTextTokens(history) <= maxTokens) return history;

  const maxChars = Math.max(800, maxTokens * 4);
  if (history.length <= maxChars) return history;

  const headLength = Math.floor(maxChars * 0.25);
  const tailLength = Math.max(400, maxChars - headLength - 80);
  return `${history.slice(0, headLength)}
...[step history truncated to fit prompt budget]...
${history.slice(-tailLength)}`;
}

export interface RetainedReadContextOptions {
  maxTokens?: number;
  maxEntries?: number;
  entryCharLimit?: number;
}

export interface RetainedReadCoverage {
  path: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
  /** True only when an unbounded, non-preview full-file read is retained in prompt memory. */
  fullContentRetained: boolean;
  stepIndex: number;
}

interface RetainedReadEntry extends RetainedReadCoverage {
  path: string;
  action: 'Read' | 'DocumentRead';
  content: string;
}

function retainedReadPath(step: ReactStep): string | undefined {
  const value = step.action_input?.file_path ?? step.action_input?.path;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function retainedReadRange(step: ReactStep, output: string, parsed: Record<string, unknown>): Pick<RetainedReadEntry, 'startLine' | 'endLine' | 'truncated'> {
  const rawStart = Number(step.action_input?.offset);
  const startLine = Number.isFinite(rawStart) && rawStart > 0 ? Math.floor(rawStart) : 1;
  const rawLimit = Number(step.action_input?.limit);
  const hasLimit = Number.isFinite(rawLimit) && rawLimit > 0;
  const visibleLines = output ? output.split(/\r?\n/).length : 0;
  const fullOutput = parsed.fullOutput && typeof parsed.fullOutput === 'object'
    ? parsed.fullOutput as { persisted?: unknown }
    : undefined;
  const truncated = parsed.truncated === true || fullOutput?.persisted === true ||
    (hasLimit && visibleLines > 0 && visibleLines >= Math.floor(rawLimit));
  const endLine = visibleLines === 0
    ? startLine
    : hasLimit || truncated
      ? startLine + visibleLines - 1
      : Number.POSITIVE_INFINITY;
  return { startLine, endLine, truncated };
}

function retainedReadContent(step: ReactStep): { output: string; parsed: Record<string, unknown> } | undefined {
  if (!successfulHistoryStep(step) || (step.action !== 'Read' && step.action !== 'DocumentRead')) return undefined;
  const rawObservation = step.observation || '';
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(rawObservation) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    // Legacy tools may return plain text instead of a JSON envelope.
  }
  const output = typeof parsed.output === 'string'
    ? parsed.output
    : parsed.output === undefined && rawObservation && Object.keys(parsed).length === 0
      ? rawObservation
      : '';
  return { output, parsed };
}

function boundedRetainedReadText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const marker = '\n...[retained read compacted]...\n';
  const available = Math.max(0, limit - marker.length);
  const head = Math.max(1, Math.floor(available * 0.72));
  const tail = Math.max(0, available - head);
  return `${value.slice(0, head)}${marker}${tail ? value.slice(-tail) : ''}`;
}

/**
 * Preserve model-visible file reads as a separate prompt section. Step
 * history is intentionally compacted, so relying on it alone can make the
 * model forget a successful read and ask for the same file again. Successful
 * mutations invalidate the retained read for that path; a fresh read then
 * becomes the new authoritative context.
 */
export function buildRetainedReadContext(
  steps: readonly ReactStep[],
  options: RetainedReadContextOptions = {},
): string {
  const entries = new Map<string, RetainedReadEntry>();

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const path = retainedReadPath(step);
    if (!path) continue;
    const pathKey = path.toLowerCase();

    if ((step.action === 'Write' || step.action === 'Edit') && successfulHistoryStep(step)) {
      for (const key of [...entries.keys()]) {
        if (key.startsWith(`${pathKey}:`)) entries.delete(key);
      }
      continue;
    }

    if (step.action !== 'Read' && step.action !== 'DocumentRead') continue;
    const read = retainedReadContent(step);
    if (!read) continue;
    const range = retainedReadRange(step, read.output, read.parsed);
    const endLabel = Number.isFinite(range.endLine) ? range.endLine : 'eof';
    const key = `${pathKey}:${range.startLine}:${endLabel}`;
    entries.set(key, {
      path,
      action: step.action,
      startLine: range.startLine,
      endLine: range.endLine,
      content: boundedRetainedReadText(read.output || '(empty output)', options.entryCharLimit ?? RETAINED_READ_CONTEXT_ENTRY_CHAR_LIMIT),
      truncated: range.truncated,
      fullContentRetained: range.startLine === 1 && !Number.isFinite(range.endLine) &&
        !range.truncated && read.output.length > 0 &&
        read.output.length <= (options.entryCharLimit ?? RETAINED_READ_CONTEXT_ENTRY_CHAR_LIMIT),
      stepIndex: index,
    });
  }

  const maxTokens = options.maxTokens ?? RETAINED_READ_CONTEXT_DEFAULT_TOKEN_BUDGET;
  const maxEntries = options.maxEntries ?? RETAINED_READ_CONTEXT_MAX_ENTRIES;
  const orderedEntries = [...entries.values()]
    .sort((left, right) => right.stepIndex - left.stepIndex)
  const retained = orderedEntries.slice(0, Math.max(1, maxEntries));
  const omittedByEntryLimit = orderedEntries.slice(Math.max(1, maxEntries));
  if (retained.length === 0) return '';

  const blocks: string[] = [];
  let usedTokens = estimateTextTokens('Retained file context (already read; do not reread covered ranges unless the file changed):');
  const selectedKeys = new Set<string>();
  for (const entry of retained) {
    const rangeLabel = entry.action === 'DocumentRead'
      ? 'extracted document'
      : Number.isFinite(entry.endLine)
        ? `lines ${entry.startLine}-${entry.endLine}`
        : `lines ${entry.startLine}-EOF`;
    const block = `${entry.path} (${rangeLabel}${entry.truncated ? '; preview was truncated' : ''}):\n${entry.content}`;
    const blockTokens = estimateTextTokens(block);
    if (blocks.length > 0 && usedTokens + blockTokens > maxTokens) continue;
    blocks.push(block);
    selectedKeys.add(`${entry.path.toLowerCase()}:${entry.startLine}:${Number.isFinite(entry.endLine) ? entry.endLine : 'eof'}`);
    usedTokens += blockTokens;
  }

  const omitted = [
    ...omittedByEntryLimit,
    ...retained.filter((entry) => !selectedKeys.has(`${entry.path.toLowerCase()}:${entry.startLine}:${Number.isFinite(entry.endLine) ? entry.endLine : 'eof'}`)),
  ];
  const omittedPaths = [...new Set(omitted.map((entry) => entry.path))].slice(0, 6);
  const omissionNotice = omitted.length > 0
    ? `Context budget note: ${omitted.length} previously read range${omitted.length === 1 ? '' : 's'} omitted from this prompt because retained memory is capped at ${maxTokens.toLocaleString()} tokens${omittedPaths.length ? `. Omitted paths include: ${omittedPaths.join(', ')}.` : '.'} The omitted ranges are not currently in active model memory; reread only a specific omitted range if the task requires it.`
    : '';

  return [
    'Retained file context (already read; do not reread covered ranges unless the file changed):',
    ...blocks,
    omissionNotice,
  ].filter(Boolean).join('\n\n');
}

/** Return only the read ranges whose contents were selected for this prompt. */
export function getRetainedReadCoverage(
  steps: readonly ReactStep[],
  options: RetainedReadContextOptions = {},
): RetainedReadCoverage[] {
  const context = buildRetainedReadContext(steps, options);
  if (!context) return [];

  // Keep this selection aligned with the prompt builder without exposing file
  // contents to the engine's replay guard. A read is visible when its path and
  // range header appears in the retained prompt section.
  const visible = new Set<string>();
  for (const line of context.split(/\r?\n/)) {
    const match = line.match(/^([^\s].*?) \((?:(?:lines (\d+)-(\d+|EOF))|extracted document)(?:; preview was truncated)?\):$/);
    if (!match) continue;
    visible.add(`${match[1].toLowerCase()}:${match[2] || '1'}:${match[3] ? (match[3].toLowerCase() === 'eof' ? 'eof' : match[3]) : 'eof'}`);
  }

  const entries = new Map<string, RetainedReadCoverage>();
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const path = retainedReadPath(step);
    if (!path || (step.action !== 'Read' && step.action !== 'DocumentRead')) continue;
    const read = retainedReadContent(step);
    if (!read) continue;
    const range = retainedReadRange(step, read.output, read.parsed);
    const key = `${path.toLowerCase()}:${range.startLine}:${Number.isFinite(range.endLine) ? range.endLine : 'eof'}`;
    if (!visible.has(key)) continue;
    entries.set(key, {
      path,
      ...range,
      fullContentRetained: range.startLine === 1 && !Number.isFinite(range.endLine) &&
        !range.truncated && read.output.length > 0 &&
        read.output.length <= (options.entryCharLimit ?? RETAINED_READ_CONTEXT_ENTRY_CHAR_LIMIT),
      stepIndex: index,
    });
  }
  return [...entries.values()];
}


export function buildStepHistory(steps: ReactStep[], options: StepHistoryOptions = {}): string {
  if (steps.length === 0) return '';

  const maxTokens = options.maxTokens ?? STEP_HISTORY_DEFAULT_TOKEN_BUDGET;
  const thoughtLimit = options.thoughtLimit ?? STEP_HISTORY_THOUGHT_LIMIT;
  const inputLimit = options.inputLimit ?? STEP_HISTORY_INPUT_LIMIT;
  const observationLimit = options.observationLimit ?? STEP_HISTORY_OBSERVATION_LIMIT;
  const deduplicateReadContext = options.deduplicateReadContext === true;
  const retainedReadKeys = new Set(
    (options.retainedReadCoverage || []).map((entry) => retainedReadCoverageKey(entry.path, entry.startLine, entry.endLine)),
  );
  const latestSuccessfulReadIndex = steps.reduce((latest, step, index) =>
    retainedReadContent(step) ? index : latest, -1);
  let recentStepCount = Math.min(
    Math.max(1, options.recentStepCount ?? STEP_HISTORY_RECENT_LIMIT),
    steps.length
  );

  const buildHistory = (detailCount: number) => {
    const detailedStart = Math.max(0, steps.length - detailCount);
    const olderSteps = steps.slice(0, detailedStart);
    const recentSteps = steps.slice(detailedStart);
    const sections: string[] = [];
    const activeFailures = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => observationStatus(step) === 'failed')
      .slice(-4)
      .map(({ step, index }) => summarizeHistoryStep(
        step,
        index,
        latestSuccessfulReadIndex,
        retainedReadKeys,
        deduplicateReadContext,
      ));
    const mutations = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.action === 'Write' || step.action === 'Edit')
      .slice(-8)
      .map(({ step, index }) => summarizeHistoryStep(
        step,
        index,
        latestSuccessfulReadIndex,
        retainedReadKeys,
        deduplicateReadContext,
      ));

    if (activeFailures.length) sections.push(`Active errors (preserved):\n${activeFailures.join('\n')}`);
    if (mutations.length) sections.push(`Mutation evidence (preserved):\n${mutations.join('\n')}`);

    if (olderSteps.length > 0) {
      const summarizedTail = olderSteps.slice(-24);
      const omitted = olderSteps.length - summarizedTail.length;
      sections.push([
        `Earlier actions summarized (${olderSteps.length} action${olderSteps.length === 1 ? '' : 's'} omitted from full detail):`,
        omitted > 0 ? `- ${omitted} oldest action${omitted === 1 ? '' : 's'} collapsed further.` : '',
        ...summarizedTail.map((step, index) => summarizeHistoryStep(
          step,
          omitted + index,
          latestSuccessfulReadIndex,
          retainedReadKeys,
          deduplicateReadContext,
        )),
      ].filter(Boolean).join('\n'));
    }

    sections.push(recentSteps
      .map((step, offset) => {
        const index = detailedStart + offset + 1;
        const decisionContract = step.decision
          ? [
              step.decision.expectedEvidence?.length ? `expected evidence: ${step.decision.expectedEvidence.join(' | ')}` : '',
              step.decision.preconditions?.length ? `preconditions: ${step.decision.preconditions.join(' | ')}` : '',
              step.decision.stopCondition ? `stop condition: ${step.decision.stopCondition}` : '',
              step.decision.evidenceChecks?.length ? `typed checks: ${step.decision.evidenceChecks.map((check) => check.type).join(' | ')}` : '',
            ].filter(Boolean).join('; ')
          : '';
        const decisionRecord = step.decisionRecord
          ? [
              `status: ${step.decisionRecord.status}`,
              step.decisionRecord.toolEvidenceId ? `tool evidence: ${step.decisionRecord.toolEvidenceId}` : '',
              step.decisionRecord.observedEvidence
                ? `observed evidence: ${step.decisionRecord.observedEvidence.status}/${step.decisionRecord.observedEvidence.assessment} (${step.decisionRecord.observedEvidence.summary})`
                : '',
            ].filter(Boolean).join('; ')
          : '';
        return `Action ${index}:
Thought: ${truncateHistoryText(step.thought || '', thoughtLimit)}
Action: ${step.action}(${stringifyHistoryValue(step.action_input || {}, inputLimit)})
Observation: ${truncateHistoryText(readObservationForStepHistory(
          step,
          detailedStart + offset,
          latestSuccessfulReadIndex,
          retainedReadKeys,
          deduplicateReadContext,
        ) || 'pending', observationLimit)}${decisionContract ? `\nDecision contract: ${truncateHistoryText(decisionContract, 520)}` : ''}${decisionRecord ? `\nDecision record: ${truncateHistoryText(decisionRecord, 420)}` : ''}`;
      })
      .join('\n'));

    return sections.join('\n\n');
  };
  let history = buildHistory(recentStepCount);
  while (estimateTextTokens(history) > maxTokens && recentStepCount > 2) {
    recentStepCount -= 1;
    history = buildHistory(recentStepCount);
  }

  return fitHistoryToBudget(history, maxTokens);
}

