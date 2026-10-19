import { redactPolicyPayload, redactPolicyText } from '@barok/core';

export const OBSERVATION_COMPACTION_VERSION = '1';

const DEFAULT_INPUT_THRESHOLD = 12_000;
const DEFAULT_OUTPUT_LIMIT = 7_200;
const DEFAULT_TOTAL_LIMIT = 12_000;
const HARD_INPUT_THRESHOLD = 100_000;
const HARD_OUTPUT_LIMIT = 24_000;
const HARD_TOTAL_LIMIT = 40_000;
const DEFAULT_HEAD_LINES = 12;
const DEFAULT_TAIL_LINES = 24;
const DEFAULT_MAX_HIGHLIGHTS = 24;
const DEFAULT_MAX_ERRORS = 16;

/**
 * Approximate number of characters per token used when converting a model's
 * declared context window (in tokens) to a character-based compaction threshold.
 * Code-heavy workloads average ~4 chars/token; this constant is intentionally
 * conservative so the threshold is slightly under, not over, the real limit.
 */
export const CHARS_PER_TOKEN = 4;

/**
 * Fraction of a model's effective character budget at which the observation
 * compactor should begin compressing tool outputs when running under a
 * free-tier pacing profile ('conservative' or 'phased').
 * 0.65 means "start compacting when an observation would consume more than
 * 65% of the model's total character capacity".
 */
export const FREE_TIER_COMPACTION_RATIO = 0.65;

/**
 * Returns the per-observation `inputThreshold` (in characters) to use when
 * the engine is running under a free-tier pacing profile.
 *
 * The value is derived as:
 *   min(HARD_INPUT_THRESHOLD, floor(contextWindowTokens × CHARS_PER_TOKEN × FREE_TIER_COMPACTION_RATIO))
 *
 * If `contextWindowTokens` is 0 or not finite, the global `DEFAULT_INPUT_THRESHOLD`
 * is returned so the compactor degrades gracefully when the window is unknown.
 *
 * @param contextWindowTokens - The model's declared context window in tokens.
 */
export function freeTierCompactionThreshold(contextWindowTokens: number): number {
  if (!Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) {
    return DEFAULT_INPUT_THRESHOLD;
  }
  const derived = Math.floor(contextWindowTokens * CHARS_PER_TOKEN * FREE_TIER_COMPACTION_RATIO);
  return Math.min(HARD_INPUT_THRESHOLD, Math.max(derived, 1));
}

export type ObservationCompactorKind = 'command' | 'grep' | 'glob' | 'read' | 'unknown' | 'none';

export interface PersistedArtifactMetadata {
  path?: string;
  originalLength?: number;
  previewLength?: number;
  persisted?: boolean;
}

export interface ObservationCompactionLimits {
  inputThreshold?: number;
  outputLimit?: number;
  totalLimit?: number;
  headLines?: number;
  tailLines?: number;
  maxHighlights?: number;
  maxErrors?: number;
}

export interface CompactionMetrics {
  kind: ObservationCompactorKind;
  compacted: boolean;
  originalCharacters: number;
  retainedCharacters: number;
  savedCharacters: number;
  reductionPercentage: number;
  rawArtifactPersisted: boolean;
}

export interface CompactedObservation {
  success: boolean;
  status: string;
  output: string;
  summary: string;
  highlights: string[];
  errors: string[];
  counts: Record<string, number>;
  truncated: boolean;
  originalLength: number;
  artifactPath?: string;
  compactionVersion: string;
  compaction: CompactionMetrics;
  [key: string]: unknown;
}

export interface ObservationCompactionResult {
  observation: string;
  metrics: CompactionMetrics;
  artifactPath?: string;
}

/** Host instrumentation can be supplied without coupling Engine to a runtime. */
export interface ObservationCompactionSerialization {
  parse<T = unknown>(text: string): T;
  stringify(value: unknown): string;
}

export interface ObservationCompactionOptions extends ObservationCompactionLimits {
  persistedObservation?: string;
  persistedArtifact?: PersistedArtifactMetadata;
  serialization?: ObservationCompactionSerialization;
}

const nativeSerialization: ObservationCompactionSerialization = {
  parse: <T = unknown>(text: string): T => JSON.parse(text) as T,
  stringify: (value) => JSON.stringify(value) ?? 'null',
};

interface ParsedObservation extends Record<string, unknown> {
  success?: unknown;
  status?: unknown;
  output?: unknown;
  error?: unknown;
  stdout?: unknown;
  stderr?: unknown;
  fullOutput?: unknown;
  outputArtifact?: unknown;
  command?: unknown;
  truncated?: unknown;
}

interface CompactionContext {
  toolName: string;
  toolInput: Record<string, unknown>;
  observation: string;
  parsed: ParsedObservation;
  output: string;
  artifactPath?: string;
  sourceTruncated: boolean;
  limits: Required<ObservationCompactionLimits>;
  serialization: ObservationCompactionSerialization;
}

function clamp(value: number | undefined, fallback: number, maximum: number, minimum = 1): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value as number)));
}

function resolveLimits(options: ObservationCompactionLimits = {}): Required<ObservationCompactionLimits> {
  const totalLimit = clamp(options.totalLimit, DEFAULT_TOTAL_LIMIT, HARD_TOTAL_LIMIT, 1);
  return {
    inputThreshold: clamp(options.inputThreshold, DEFAULT_INPUT_THRESHOLD, HARD_INPUT_THRESHOLD, 1),
    outputLimit: clamp(options.outputLimit, DEFAULT_OUTPUT_LIMIT, Math.min(HARD_OUTPUT_LIMIT, totalLimit), 1),
    totalLimit,
    headLines: clamp(options.headLines, DEFAULT_HEAD_LINES, 100, 1),
    tailLines: clamp(options.tailLines, DEFAULT_TAIL_LINES, 200, 1),
    maxHighlights: clamp(options.maxHighlights, DEFAULT_MAX_HIGHLIGHTS, 100, 1),
    maxErrors: clamp(options.maxErrors, DEFAULT_MAX_ERRORS, 100, 1),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function guardedReadHash(value: string): string | undefined {
  return value.match(/\[guarded-read-hash:\s*([a-f0-9]{64})\]/i)?.[1];
}

function boundedText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const side = Math.max(1, Math.floor((limit - 48) / 2));
  return `${value.slice(0, side)}\n...[field compacted]\n${value.slice(-side)}`;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function findArtifactPath(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const path = stringValue(record.path);
  if (path) return path;
  for (const key of ['fullOutput', 'outputArtifact', 'command']) {
    const nested = findArtifactPath(record[key]);
    if (nested) return nested;
  }
  return undefined;
}

function observationKind(toolName: string, toolInput: Record<string, unknown>): ObservationCompactorKind {
  if (toolName === 'Read' || toolName === 'DocumentRead') return 'read';
  if (toolName === 'Grep') return 'grep';
  if (toolName === 'Glob') return 'glob';
  if (toolName === 'Command' && toolInput.operation === 'list_directory') return 'glob';
  if (toolName === 'Bash' || toolName === 'Command') return 'command';
  return 'unknown';
}

function statusFor(parsed: ParsedObservation): string {
  if (typeof parsed.status === 'string' && parsed.status.trim()) return parsed.status;
  if (parsed.skipped === true || parsed.verificationUnavailable === true) return 'skipped';
  if (parsed.success === false) return 'failed';
  if (parsed.success === true) return 'passed';
  return 'unknown';
}

function outputFor(parsed: ParsedObservation): string | undefined {
  for (const key of ['output', 'stdout', 'stderr']) {
    const value = stringValue(parsed[key]);
    if (value) return value;
  }
  return undefined;
}

function lineKey(line: string): string {
  return line
    .replace(/\d+(?:\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isProgressLine(line: string): boolean {
  return /(?:^|\s)(?:progress|processing|building|bundling|transforming|downloading|running)\b.*(?:\.{3}|\b\d+%|\|)/i.test(line)
    || /^[\s\[\]#=>-]*(?:\d+%|[|=-]{3,})[\s\]#=>-]*$/i.test(line);
}

function normalizeLines(value: string): string[] {
  const seenProgress = new Set<string>();
  const result: string[] = [];
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    if (isProgressLine(line)) {
      const key = lineKey(line);
      if (seenProgress.has(key)) continue;
      seenProgress.add(key);
    }
    result.push(line);
  }
  return result;
}

function isErrorLine(line: string): boolean {
  return /\b(?:error|errors|failed|failure|exception|fatal|panic|traceback|enoent|拒绝)\b/i.test(line)
    || /^\s*(?:FAIL|✖|×)\b/i.test(line)
    || /(?:^|\s)[^\s:()]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java)(?:\([^)]*\)|:\d+(?::\d+)?)\s*[-:]?\s*error\b/i.test(line);
}

function isMeaningfulLine(line: string): boolean {
  return isErrorLine(line)
    || /\b(?:test suites?|tests?|specs?|passed|passing|failed|failures?|total|warning|warnings|compiled|built|lint|duration|time|completed|success|snapshot|checks?)\b/i.test(line);
}

function uniqueLines(lines: string[], limit: number, normalize = true): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const key = normalize ? lineKey(line) : line.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(line);
    if (result.length >= limit) break;
  }
  return result;
}

function representativeLines(lines: string[], limit: number, pinned: string[] = []): string[] {
  const headCount = Math.ceil(limit / 2);
  const tailCount = Math.floor(limit / 2);
  return uniqueLines(
    [...pinned, ...lines.slice(0, headCount), ...lines.slice(Math.max(0, lines.length - tailCount))],
    limit,
    false,
  );
}

function boundedLineSelection(lines: string[], context: CompactionContext): { highlights: string[]; errors: string[] } {
  const errorIndexes = lines.flatMap((line, index) => isErrorLine(line) ? [index] : []);
  const aroundErrors = errorIndexes.flatMap((index) => lines.slice(Math.max(0, index - 1), index + 2));
  const head = lines.slice(0, context.limits.headLines);
  const tail = lines.slice(Math.max(0, lines.length - context.limits.tailLines));
  const meaningful = lines.filter(isMeaningfulLine);
  const highlights = uniqueLines(
    [...head, ...aroundErrors, ...meaningful, ...tail],
    context.limits.maxHighlights,
  ).map(redactPolicyText);
  const errors = uniqueLines(
    [...aroundErrors, ...lines.filter(isErrorLine)],
    context.limits.maxErrors,
  ).map(redactPolicyText);
  return { highlights, errors };
}

function summaryFor(
  parsed: ParsedObservation,
  lines: string[],
  errors: string[],
  kind: ObservationCompactorKind,
): string {
  const status = statusFor(parsed);
  const command = asRecord(parsed.command);
  const exitCode = numberValue(parsed.exitCode) ?? numberValue(command?.exitCode);
  const durationMs = numberValue(parsed.durationMs) ?? numberValue(command?.durationMs);
  const details = uniqueLines(lines.filter(isMeaningfulLine).slice(-8), 4);
  const facts = [status, exitCode !== undefined ? `exit ${exitCode}` : '', durationMs !== undefined ? `${durationMs}ms` : '']
    .filter(Boolean)
    .join(', ');
  if (details.length) return `${kind} ${facts}: ${details.join(' | ')}`.slice(0, 900);
  if (errors.length) return `${kind} ${facts}: ${errors[0]}`.slice(0, 900);
  return `${kind} ${facts || 'observation'} (${lines.length} lines)`.slice(0, 900);
}

function numericCounts(lines: string[], parsed: ParsedObservation): Record<string, number> {
  const count = (pattern: RegExp): number => lines.filter((line) => pattern.test(line)).length;
  const counts: Record<string, number> = {
    lines: lines.length,
    errors: count(/\b(?:error|errors|exception|fatal|panic)\b/i),
    warnings: count(/\bwarn(?:ing|ings)?\b/i),
    failures: count(/\b(?:fail(?:ed|ure|ures)?|FAIL)\b/i),
    passed: count(/\b(?:pass(?:ed|ing)?|success(?:ful)?)\b/i),
  };
  for (const key of ['tests', 'testSuites', 'matches', 'files', 'entries']) {
    const value = numberValue(parsed[key]);
    if (value !== undefined) counts[key] = value;
  }
  return counts;
}

function compactCommand(context: CompactionContext): { output: string; highlights: string[]; errors: string[]; counts: Record<string, number>; summary: string; truncated: boolean } {
  const lines = normalizeLines(context.output);
  const selected = boundedLineSelection(lines, context);
  const counts = numericCounts(lines, context.parsed);
  counts.lines = context.output.split(/\r?\n/).filter((line) => line.trim()).length;
  const blocks = [
    selected.errors.length ? `Errors:\n${selected.errors.join('\n')}` : '',
    `Highlights:\n${selected.highlights.join('\n')}`,
  ].filter(Boolean);
  let output = blocks.join('\n\n');
  let truncated = lines.length > selected.highlights.length || selected.errors.length < counts.errors;
  if (output.length > context.limits.outputLimit) {
    output = `${output.slice(0, Math.max(0, context.limits.outputLimit - 64))}\n...[command output compacted]`;
    truncated = true;
  } else if (truncated) {
    output += `\n...[${Math.max(0, lines.length - selected.highlights.length)} lines omitted]`;
  }
  return {
    output,
    highlights: selected.highlights,
    errors: selected.errors,
    counts,
    summary: summaryFor(context.parsed, lines, selected.errors, 'command'),
    truncated,
  };
}

function explicitInputTokens(input: Record<string, unknown>): string[] {
  return ['path', 'file_path', 'filename', 'file', 'directory'].flatMap((key) => {
    const value = input[key];
    return typeof value === 'string' && value.trim() ? [value.trim().replace(/\\/g, '/')] : [];
  });
}

function compactList(context: CompactionContext): { output: string; highlights: string[]; errors: string[]; counts: Record<string, number>; summary: string; truncated: boolean } {
  const lines = normalizeLines(context.output);
  const pinnedTokens = explicitInputTokens(context.toolInput);
  const pinned = lines.filter((line) => pinnedTokens.some((token) => line.includes(token)));
  const selected = representativeLines(lines, context.limits.maxHighlights, pinned).map(redactPolicyText);
  const omitted = Math.max(0, lines.length - selected.length);
  const counts = {
    ...numericCounts(lines, context.parsed),
    entries: lines.length,
    retained: selected.length,
    omitted,
  };
  const output = omitted > 0
    ? `${selected.join('\n')}\n...[${omitted} entries omitted]`
    : selected.join('\n');
  return {
    output: output.slice(0, context.limits.outputLimit),
    highlights: selected,
    errors: [],
    counts,
    summary: `${context.toolName} returned ${lines.length} entries; retained ${selected.length}${omitted ? ` and omitted ${omitted}` : ''}.`,
    truncated: omitted > 0 || context.sourceTruncated,
  };
}

function compactGrep(context: CompactionContext): { output: string; highlights: string[]; errors: string[]; counts: Record<string, number>; summary: string; truncated: boolean } {
  if (/^\(no matches found\)$/i.test(context.output.trim())) {
    return {
      output: context.output.trim(),
      highlights: [],
      errors: [],
      counts: { matches: 0, files: 0, retained: 0, omitted: 0 },
      summary: 'Grep found no matches.',
      truncated: context.sourceTruncated,
    };
  }
  const lines = normalizeLines(context.output);
  const selected = representativeLines(lines, context.limits.maxHighlights).map(redactPolicyText);
  const files = new Set(lines.map((line) => line.split(/:\d+(?::\d+)?:/)[0] || line));
  const omitted = Math.max(0, lines.length - selected.length);
  const output = `${selected.join('\n')}${omitted ? `\n...[${omitted} matches omitted]` : ''}`;
  const counts = { matches: lines.length, files: files.size, retained: selected.length, omitted };
  return {
    output: output.slice(0, context.limits.outputLimit),
    highlights: selected,
    errors: [],
    counts,
    summary: `Grep found ${lines.length} matches across ${files.size} files; retained ${selected.length}${omitted ? ` and omitted ${omitted}` : ''}.`,
    truncated: omitted > 0 || context.sourceTruncated,
  };
}

function buildFallbackResult(
  originalObservation: string,
  fallbackObservation: string,
  kind: ObservationCompactorKind,
  artifactPath: string | undefined,
  rawArtifactPersisted: boolean,
): ObservationCompactionResult {
  return {
    observation: fallbackObservation,
    artifactPath,
    metrics: createMetrics(kind, false, originalObservation.length, fallbackObservation.length, rawArtifactPersisted),
  };
}

function createMetrics(
  kind: ObservationCompactorKind,
  compacted: boolean,
  originalCharacters: number,
  retainedCharacters: number,
  rawArtifactPersisted: boolean,
): CompactionMetrics {
  const savedCharacters = Math.max(0, originalCharacters - retainedCharacters);
  return {
    kind,
    compacted,
    originalCharacters,
    retainedCharacters,
    savedCharacters,
    reductionPercentage: originalCharacters > 0 ? Number(((savedCharacters / originalCharacters) * 100).toFixed(2)) : 0,
    rawArtifactPersisted,
  };
}

function compactedOutput(
  context: CompactionContext,
  compacted: { output: string; highlights: string[]; errors: string[]; counts: Record<string, number>; summary: string; truncated: boolean },
): string {
  const redacted = redactPolicyPayload(context.parsed) as ParsedObservation;
  for (const key of ['stdout', 'stderr', 'error']) {
    if (typeof redacted[key] === 'string') {
      redacted[key] = boundedText(redacted[key] as string, 1_200);
    }
  }
  const artifactPath = context.artifactPath;
  const metrics = createMetrics(
    context.toolName === 'Grep' ? 'grep' : context.toolName === 'Glob' || context.toolInput.operation === 'list_directory' ? 'glob' : 'command',
    true,
    context.observation.length,
    0,
    Boolean(artifactPath),
  );
  const hash = guardedReadHash(context.output);
  let compactedOutputText = compacted.output;
  if (hash && !compactedOutputText.includes(hash)) {
    compactedOutputText = `${compactedOutputText}\n[guarded-read-hash: ${hash}]`;
  }
  const envelope: CompactedObservation = {
    ...redacted,
    success: context.parsed.success === true,
    status: statusFor(context.parsed),
    output: compactedOutputText,
    summary: compacted.summary,
    highlights: compacted.highlights,
    errors: compacted.errors,
    counts: compacted.counts,
    truncated: Boolean(context.parsed.truncated) || compacted.truncated,
    originalLength: context.observation.length,
    ...(artifactPath ? { artifactPath } : {}),
    compactionVersion: OBSERVATION_COMPACTION_VERSION,
    compaction: metrics,
  };
  let serialized = context.serialization.stringify(envelope);
  if (serialized.length > context.limits.totalLimit) {
    const reducedHighlights = envelope.highlights.slice(0, Math.max(4, Math.floor(envelope.highlights.length / 2)));
    const reducedErrors = envelope.errors.slice(0, Math.max(2, Math.floor(envelope.errors.length / 2)));
    envelope.highlights = reducedHighlights;
    envelope.errors = reducedErrors;
    envelope.output = `${envelope.output.slice(0, Math.max(0, context.limits.outputLimit - 64))}\n...[envelope compacted]`;
    serialized = context.serialization.stringify(envelope);
  }
  // The metrics are part of the serialized envelope, so settle the retained
  // character count after serialization rather than reporting a stale value.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    envelope.compaction = createMetrics(
      metrics.kind,
      true,
      context.observation.length,
      serialized.length,
      Boolean(artifactPath),
    );
    const nextSerialized = context.serialization.stringify(envelope);
    if (nextSerialized.length === serialized.length) return nextSerialized;
    serialized = nextSerialized;
  }
  return serialized;
}

/**
 * Deterministically reduces known tool observations. This function never
 * dispatches tools, contacts a provider, or invokes a sub-agent.
 */
export function compactObservation(
  toolName: string,
  toolInput: Record<string, unknown> = {},
  serializedObservation: string,
  options: ObservationCompactionOptions = {},
): ObservationCompactionResult {
  const serialization = options.serialization ?? nativeSerialization;
  const kind = observationKind(toolName, toolInput);
  const persistedObservation = options.persistedObservation || serializedObservation;
  const artifactPath = options.persistedArtifact?.path || (() => {
    try {
      return findArtifactPath(serialization.parse<ParsedObservation>(persistedObservation));
    } catch {
      return undefined;
    }
  })() || (() => {
    try {
      return findArtifactPath(serialization.parse<ParsedObservation>(serializedObservation));
    } catch {
      return undefined;
    }
  })();
  const rawArtifactPersisted = Boolean(artifactPath);
  const limits = resolveLimits(options);

  if (kind === 'read' || kind === 'unknown') {
    return buildFallbackResult(serializedObservation, persistedObservation, kind, artifactPath, rawArtifactPersisted);
  }

  let parsed: ParsedObservation;
  try {
    parsed = serialization.parse<ParsedObservation>(serializedObservation);
  } catch {
    return buildFallbackResult(serializedObservation, persistedObservation, kind, artifactPath, rawArtifactPersisted);
  }
  // Storage may have added fullOutput metadata to its preview. Merge only
  // metadata fields here so the compactor can still select from the raw
  // dispatched output without losing the artifact recovery path.
  try {
    const persistedParsed = serialization.parse<ParsedObservation>(persistedObservation);
    for (const key of ['fullOutput', 'outputArtifact', 'artifactPath']) {
      if (persistedParsed[key] !== undefined) parsed[key] = persistedParsed[key];
    }
  } catch {
    // The raw observation remains the safe source when storage produced text.
  }
  if (parsed.success !== true && parsed.success !== false) {
    return buildFallbackResult(serializedObservation, persistedObservation, kind, artifactPath, rawArtifactPersisted);
  }

  const output = outputFor(parsed);
  if (!output || (serializedObservation.length <= limits.inputThreshold && output.length <= limits.outputLimit)) {
    return buildFallbackResult(serializedObservation, persistedObservation, kind, artifactPath, rawArtifactPersisted);
  }

  const context: CompactionContext = {
    toolName,
    toolInput,
    observation: serializedObservation,
    parsed,
    output,
    artifactPath,
    sourceTruncated: parsed.truncated === true,
    limits,
    serialization,
  };
  const compacted = kind === 'grep'
    ? compactGrep(context)
    : kind === 'glob'
      ? compactList(context)
      : compactCommand(context);
  const observation = compactedOutput(context, compacted);
  return {
    observation,
    artifactPath,
    metrics: createMetrics(kind, true, serializedObservation.length, observation.length, rawArtifactPersisted),
  };
}

export function getObservationCompactionMetrics(
  observation: string,
  serialization: ObservationCompactionSerialization = nativeSerialization,
): CompactionMetrics | undefined {
  try {
    const parsed = serialization.parse<Record<string, unknown>>(observation);
    const metrics = asRecord(parsed.compaction);
    if (!metrics || typeof metrics.kind !== 'string') return undefined;
    if (
      typeof metrics.originalCharacters !== 'number' ||
      typeof metrics.retainedCharacters !== 'number' ||
      typeof metrics.savedCharacters !== 'number'
    ) return undefined;
    return metrics as unknown as CompactionMetrics;
  } catch {
    return undefined;
  }
}
