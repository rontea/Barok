/** Provider-neutral structured decision protocol.
 *
 * Providers may return native tool calls, function-call parts, or legacy text
 * JSON. This module turns those shapes into one validated envelope before a
 * tool reaches execution. Raw malformed material is never returned without
 * secret redaction.
 */

export const AGENT_DECISION_VERSION = 1 as const;

export type AgentDecisionStatus = 'act' | 'respond' | 'ask' | 'complete' | 'blocked' | 'retry';
export type AgentProviderKind = 'openai' | 'anthropic' | 'gemini' | 'nvidia' | 'legacy_text' | 'unknown';
export type AgentReasoningVisibility = 'hidden' | 'collapsed' | 'full' | 'redacted';
export type AgentReasoningSource = 'engine' | 'model' | 'provider' | 'native';
export type AgentReasoningPhase = 'planning' | 'final';
export type AgentDecisionCategory = 'planning' | 'inspection' | 'implementation' | 'verification' | 'recovery' | 'coordination' | 'clarification' | 'completion' | 'unknown';
export type AgentEvidenceCheckType =
  | 'file_exists'
  | 'contains_text'
  | 'command_passed'
  | 'files_changed'
  | 'verification_passed'
  | 'search_match'
  | 'package_installed'
  | 'workspace_change_detected';

export interface AgentEvidenceCheck {
  type: AgentEvidenceCheckType;
  path?: string;
  text?: string;
  command?: string;
  packageName?: string;
}

export interface NormalizedToolAction {
  action: string;
  action_input: Record<string, unknown>;
}

export interface AgentDecisionMetadata {
  rationale?: string;
  planUpdate?: string[];
  expectedEvidence?: string[];
  evidenceChecks?: AgentEvidenceCheck[];
  preconditions?: string[];
  stopCondition?: string;
  confidence?: number;
}

export type AgentDecisionRecordStatus = 'pending' | 'succeeded' | 'failed' | 'invalidated';
export type AgentDecisionEvidenceStatus = 'success' | 'failure' | 'unknown';
export type AgentDecisionEvidenceAssessment = 'supported' | 'contradicted' | 'unverified';

export type AgentEvidenceCheckResultStatus = 'passed' | 'failed' | 'unverified';

export interface AgentEvidenceCheckResult {
  type: AgentEvidenceCheckType;
  status: AgentEvidenceCheckResultStatus;
  detail?: string;
}

export interface AgentDecisionObservation {
  status: AgentDecisionEvidenceStatus;
  assessment?: AgentDecisionEvidenceAssessment;
  checkResults?: AgentEvidenceCheckResult[];
  /** Bounded, redacted summary. Raw tool output never belongs in this record. */
  summary: string;
}

/**
 * Durable lifecycle record for one selected action. This deliberately stores
 * the safe rationale and evidence contract, never provider-private reasoning.
 */
export interface AgentDecisionRecord extends AgentDecisionMetadata {
  version: typeof AGENT_DECISION_VERSION;
  id: string;
  step: number;
  provider: AgentProviderKind;
  model: string;
  action: NormalizedToolAction;
  /** Derived only from structured runtime state and the selected action. */
  decisionCategory?: AgentDecisionCategory;
  reasoningId?: string;
  reasoningVisibility: AgentReasoningVisibility;
  reasoningSource: AgentReasoningSource;
  status: AgentDecisionRecordStatus;
  observedEvidence?: AgentDecisionObservation;
  toolEvidenceId?: string;
  createdAt: number;
  completedAt?: number;
}

export interface CreateAgentDecisionRecordInput extends AgentDecisionMetadata {
  id: string;
  step: number;
  provider: AgentProviderKind;
  model: string;
  action: NormalizedToolAction;
  decisionCategory?: AgentDecisionCategory;
  reasoningId?: string;
  reasoningVisibility?: AgentReasoningVisibility;
  reasoningSource?: AgentReasoningSource;
}

export interface AgentDecision extends AgentDecisionMetadata {
  version: typeof AGENT_DECISION_VERSION;
  id: string;
  provider: AgentProviderKind;
  status: AgentDecisionStatus;
  action?: NormalizedToolAction;
}

function summarizeDecisionObservation(value: string): string {
  let summary = value;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const candidate = typeof parsed.error === 'string'
      ? parsed.error
      : typeof parsed.output === 'string'
        ? parsed.output
        : typeof parsed.message === 'string'
          ? parsed.message
          : typeof parsed.status === 'string'
            ? parsed.status
            : value;
    summary = candidate;
  } catch {
    // Legacy tool observations are already plain text.
  }
  return redactSecrets(summary.replace(/\s+/g, ' ').trim()).slice(0, 240) || 'Tool returned no output.';
}

const EVIDENCE_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'be', 'before', 'by', 'for', 'from', 'has', 'have',
  'in', 'is', 'it', 'of', 'on', 'once', 'should', 'that', 'the', 'to', 'was',
  'with', 'would',
]);

function evidenceTerms(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g)?.filter((term) => term.length > 2 && !EVIDENCE_STOP_WORDS.has(term)) || [];
}

const EVIDENCE_CHECK_TYPES = new Set<AgentEvidenceCheckType>([
  'file_exists',
  'contains_text',
  'command_passed',
  'files_changed',
  'verification_passed',
  'search_match',
  'package_installed',
  'workspace_change_detected',
]);

export function normalizeAgentEvidenceChecks(value: unknown): AgentEvidenceCheck[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const checks = value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const type = typeof item.type === 'string' && EVIDENCE_CHECK_TYPES.has(item.type as AgentEvidenceCheckType)
        ? item.type as AgentEvidenceCheckType
        : undefined;
      if (!type) return undefined;
      const path = typeof item.path === 'string' ? item.path.replace(/\s+/g, ' ').trim().slice(0, 240) : undefined;
      const text = typeof item.text === 'string' ? item.text.slice(0, 600) : undefined;
      const command = typeof item.command === 'string' ? item.command.replace(/\s+/g, ' ').trim().slice(0, 600) : undefined;
      const packageName = typeof item.packageName === 'string' ? item.packageName.replace(/\s+/g, ' ').trim().slice(0, 240) : undefined;
      if (type === 'file_exists' && !path) return undefined;
      if (type === 'contains_text' && (!path || !text)) return undefined;
      if (type === 'search_match' && !text) return undefined;
      if (type === 'package_installed' && !packageName) return undefined;
      if (type === 'workspace_change_detected' && !path) return undefined;
      return { type, ...(path ? { path } : {}), ...(text ? { text } : {}), ...(command ? { command } : {}), ...(packageName ? { packageName } : {}) };
    })
    .filter((check): check is AgentEvidenceCheck => Boolean(check))
    .slice(0, 6);
  return checks.length > 0 ? checks : undefined;
}

export interface DecisionEvidenceContext {
  action: NormalizedToolAction;
  observation: string;
  toolEvidence?: {
    id: string;
    status: string;
    input?: Record<string, unknown>;
    output?: string;
  };
}

function structuredObservationSuccess(observation: string): boolean | undefined {
  try {
    const parsed = JSON.parse(observation) as { success?: unknown };
    return typeof parsed.success === 'boolean' ? parsed.success : undefined;
  } catch {
    return undefined;
  }
}

function actionPath(action: NormalizedToolAction, input?: Record<string, unknown>): string | undefined {
  const values = [input?.file_path, input?.path, input?.filename, action.action_input.file_path, action.action_input.path, action.action_input.filename];
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function normalizeEvidencePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
}

function evidencePathsMatch(actual: string, expected: string): boolean {
  const left = normalizeEvidencePath(actual);
  const right = normalizeEvidencePath(expected);
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function parsedObservation(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function checkTypedEvidence(check: AgentEvidenceCheck, context: DecisionEvidenceContext): AgentEvidenceCheckResult {
  const success = context.toolEvidence?.status === 'success' || structuredObservationSuccess(context.observation) === true;
  const failure = context.toolEvidence?.status === 'error' || structuredObservationSuccess(context.observation) === false;
  const output = context.toolEvidence?.output || context.observation;
  const normalizedOutput = output.toLowerCase();
  const negative = /\b(?:not found|does not exist|doesn't exist|missing|unavailable|denied|blocked)\b/i.test(normalizedOutput);

  switch (check.type) {
    case 'file_exists': {
      const target = actionPath(context.action, context.toolEvidence?.input);
      const parsed = parsedObservation(context.observation);
      const outputMentionsPath = normalizedOutput.includes(normalizeEvidencePath(check.path!));
      const workspaceFiles = Array.isArray(parsed?.files) ? parsed.files : [];
      const workspaceReportsPath = workspaceFiles.some((file) => {
        const record = file && typeof file === 'object' ? file as Record<string, unknown> : undefined;
        return typeof record?.path === 'string' && evidencePathsMatch(record.path, check.path!);
      });
      if (context.action.action === 'Glob' || context.action.action === 'WorkspaceChanges') {
        if (failure || negative) return { type: check.type, status: 'failed', detail: `${check.path} was not found.` };
        return outputMentionsPath || workspaceReportsPath
          ? { type: check.type, status: 'passed', detail: `${check.path} was observed.` }
          : success ? { type: check.type, status: 'failed', detail: `${check.path} was not found.` } : { type: check.type, status: 'unverified' };
      }
      if (!target || !evidencePathsMatch(target, check.path!)) return { type: check.type, status: 'unverified' };
      if (failure || negative) return { type: check.type, status: 'failed', detail: `${check.path} was not found.` };
      return success ? { type: check.type, status: 'passed', detail: `${check.path} was observed.` } : { type: check.type, status: 'unverified' };
    }
    case 'contains_text':
      if (context.action.action !== 'Read' && context.action.action !== 'DocumentRead') return { type: check.type, status: 'unverified' };
      return normalizedOutput.includes(check.text!.toLowerCase())
        ? { type: check.type, status: 'passed', detail: `Observed ${check.text}.` }
        : { type: check.type, status: 'unverified' };
    case 'command_passed': {
      if (context.action.action !== 'Bash' && context.action.action !== 'Command' && context.action.action !== 'PackageInstall') return { type: check.type, status: 'unverified' };
      const command = String(context.action.action_input.command || context.action.action_input.operation || '');
      if (check.command && !command.includes(check.command)) return { type: check.type, status: 'unverified' };
      if (failure) return { type: check.type, status: 'failed', detail: 'The command returned a failure.' };
      return success ? { type: check.type, status: 'passed', detail: 'The command passed.' } : { type: check.type, status: 'unverified' };
    }
    case 'files_changed': {
      if (context.action.action !== 'Write' && context.action.action !== 'Edit') return { type: check.type, status: 'unverified' };
      if (failure) return { type: check.type, status: 'failed', detail: 'The mutation failed.' };
      const target = actionPath(context.action, context.toolEvidence?.input);
      if (check.path && target && target.replace(/\\/g, '/').toLowerCase() !== check.path.replace(/\\/g, '/').toLowerCase()) return { type: check.type, status: 'unverified' };
      return success ? { type: check.type, status: 'passed', detail: target ? `${target} changed.` : 'A file changed.' } : { type: check.type, status: 'unverified' };
    }
    case 'verification_passed':
      if (context.action.action !== 'Bash' && context.action.action !== 'Command') return { type: check.type, status: 'unverified' };
      if (check.command && !String(context.action.action_input.command || context.action.action_input.operation || '').includes(check.command)) return { type: check.type, status: 'unverified' };
      if (failure) return { type: check.type, status: 'failed', detail: 'Verification returned a failure.' };
      return success ? { type: check.type, status: 'passed', detail: 'Verification passed.' } : { type: check.type, status: 'unverified' };
    case 'search_match':
      if (context.action.action !== 'Grep' && context.action.action !== 'Glob' && context.action.action !== 'WebSearch') return { type: check.type, status: 'unverified' };
      if (normalizedOutput.includes(check.text!.toLowerCase())) {
        return { type: check.type, status: 'passed', detail: `Search output contains ${check.text}.` };
      }
      if (failure || /\(no matches found\)|"results"\s*:\s*\[\s*\]/i.test(output)) {
        return { type: check.type, status: 'failed', detail: `Search output did not contain ${check.text}.` };
      }
      return { type: check.type, status: 'unverified' };
    case 'package_installed': {
      if (context.action.action !== 'PackageInstall' && !(context.action.action === 'Command' && String(context.action.action_input.operation || '').toLowerCase() === 'package_install')) {
        return { type: check.type, status: 'unverified' };
      }
      const parsed = parsedObservation(context.observation);
      const packageInstall = parsed?.packageInstall && typeof parsed.packageInstall === 'object'
        ? parsed.packageInstall as Record<string, unknown>
        : undefined;
      const verifiedPackages = Array.isArray(packageInstall?.verifiedPackages) ? packageInstall.verifiedPackages.map(String) : [];
      const missingPackages = Array.isArray(packageInstall?.missingPackages) ? packageInstall.missingPackages.map(String) : [];
      const packageName = check.packageName!.toLowerCase();
      if (missingPackages.some((item) => item.toLowerCase() === packageName)) return { type: check.type, status: 'failed', detail: `${check.packageName} was not verified after installation.` };
      if (verifiedPackages.some((item) => item.toLowerCase() === packageName)) return { type: check.type, status: 'passed', detail: `${check.packageName} was verified.` };
      if (failure) return { type: check.type, status: 'failed', detail: 'Package installation returned a failure.' };
      return { type: check.type, status: 'unverified' };
    }
    case 'workspace_change_detected': {
      if (context.action.action !== 'WorkspaceChanges') return { type: check.type, status: 'unverified' };
      const parsed = parsedObservation(context.observation);
      const files = Array.isArray(parsed?.files) ? parsed.files : [];
      const found = files.some((file) => {
        const record = file && typeof file === 'object' ? file as Record<string, unknown> : undefined;
        return typeof record?.path === 'string' && evidencePathsMatch(record.path, check.path!);
      });
      if (found) return { type: check.type, status: 'passed', detail: `${check.path} appears in workspace changes.` };
      if (failure || success) return { type: check.type, status: 'failed', detail: `${check.path} was not reported as changed.` };
      return { type: check.type, status: 'unverified' };
    }
  }
}

/**
 * Assess only explicit contradictions or strong textual support. Ambiguous
 * observations remain unverified and therefore do not force a replan.
 */
export function assessAgentDecisionEvidence(
  expectedEvidence: readonly string[] | undefined,
  observation: string,
  evidenceChecks?: readonly AgentEvidenceCheck[],
  context?: DecisionEvidenceContext,
): AgentDecisionEvidenceAssessment {
  if (evidenceChecks?.length && context) {
    const results = evidenceChecks.map((check) => checkTypedEvidence(check, context));
    if (results.some((result) => result.status === 'failed')) return 'contradicted';
    if (results.every((result) => result.status === 'passed')) return 'supported';
    return 'unverified';
  }
  if (!expectedEvidence?.length) return 'unverified';
  const expectedText = expectedEvidence.join(' ').toLowerCase();
  const observedText = summarizeDecisionObservation(observation).toLowerCase();
  const expectedNegative = /\b(?:no|none|not|missing|empty|absent|failed|failure)\b/.test(expectedText);
  const observedNegative = /\b(?:not found|does not exist|doesn't exist|missing|unavailable|denied|blocked)\b/.test(observedText);
  const observedPositive = /\b(?:found|exists|present|available|passed|success|created|updated|written|read|contains|verified)\b/.test(observedText);

  if ((!expectedNegative && observedNegative) || (expectedNegative && observedPositive)) return 'contradicted';
  if (observedText.includes(expectedText.trim())) return 'supported';

  const expectedTerms = evidenceTerms(expectedText);
  const observedTerms = new Set(evidenceTerms(observedText));
  const matchedTerms = expectedTerms.filter((term) => observedTerms.has(term)).length;
  return expectedTerms.length > 0 && matchedTerms >= Math.max(1, Math.ceil(expectedTerms.length * 0.5))
    ? 'supported'
    : 'unverified';
}

function boundDecisionValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.slice(0, 1_200);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 3) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => boundDecisionValue(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).slice(0, 30).map(([key, item]) => [key.slice(0, 120), boundDecisionValue(item, depth + 1)])
  );
}

export function createAgentDecisionRecord(input: CreateAgentDecisionRecordInput): AgentDecisionRecord {
  const evidenceChecks = normalizeAgentEvidenceChecks(input.evidenceChecks);
  return {
    version: AGENT_DECISION_VERSION,
    id: input.id,
    step: input.step,
    provider: input.provider,
    model: input.model.slice(0, 160),
    action: {
      action: input.action.action.slice(0, 120),
      action_input: boundDecisionValue(input.action.action_input) as Record<string, unknown>,
    },
    ...(input.decisionCategory ? { decisionCategory: input.decisionCategory } : {}),
    ...(input.reasoningId ? { reasoningId: input.reasoningId } : {}),
    reasoningVisibility: input.reasoningVisibility || 'collapsed',
    reasoningSource: input.reasoningSource || 'model',
    status: 'pending',
    ...(input.rationale ? { rationale: input.rationale.slice(0, 600) } : {}),
    ...(input.planUpdate ? { planUpdate: input.planUpdate.slice(0, 6).map((item) => item.slice(0, 240)) } : {}),
    ...(input.expectedEvidence ? { expectedEvidence: input.expectedEvidence.slice(0, 6).map((item) => item.slice(0, 240)) } : {}),
    ...(evidenceChecks ? { evidenceChecks } : {}),
    ...(input.preconditions ? { preconditions: input.preconditions.slice(0, 6).map((item) => item.slice(0, 240)) } : {}),
    ...(input.stopCondition ? { stopCondition: input.stopCondition.slice(0, 240) } : {}),
    ...(input.confidence !== undefined ? { confidence: Math.max(0, Math.min(1, input.confidence)) } : {}),
    createdAt: Date.now(),
  };
}

export function completeAgentDecisionRecord(
  record: AgentDecisionRecord,
  observation: AgentDecisionObservation,
  context?: DecisionEvidenceContext,
): AgentDecisionRecord {
  const summary = summarizeDecisionObservation(observation.summary);
  const checkResults = record.evidenceChecks?.length && context
    ? record.evidenceChecks.map((check) => checkTypedEvidence(check, context))
    : undefined;
  const assessment = assessAgentDecisionEvidence(record.expectedEvidence, summary, record.evidenceChecks, context);
  const status: AgentDecisionRecordStatus = observation.status === 'success'
    ? assessment === 'contradicted' ? 'invalidated' : 'succeeded'
    : observation.status === 'failure'
      ? 'failed'
      : 'invalidated';
  return {
    ...record,
    status,
    observedEvidence: {
      status: observation.status,
      assessment,
      ...(checkResults ? { checkResults } : {}),
      summary,
    },
    ...(context?.toolEvidence?.id ? { toolEvidenceId: context.toolEvidence.id } : {}),
    completedAt: Date.now(),
  };
}

export interface ProviderCapabilityMetadata {
  provider: AgentProviderKind;
  nativeToolCalls: boolean;
  streaming: boolean;
  jsonSchema: boolean;
  contextWindow?: number;
  notes?: string[];
}

export interface AgentDecisionNormalizationOptions {
  provider?: AgentProviderKind;
  allowedTools?: Iterable<string>;
  maxRetries?: number;
}

export interface AgentDecisionNormalizationResult {
  decision?: AgentDecision;
  errors: string[];
  recoverable: boolean;
  retryCount: number;
  redactedRaw?: string;
}

export interface MalformedProviderResponseAudit {
  type: 'malformed_provider_response';
  protocolVersion: typeof AGENT_DECISION_VERSION;
  provider: AgentProviderKind;
  errors: string[];
  recoverable: boolean;
  rawRedacted: string;
  model?: string;
  attempt?: number;
  parsedKeys?: string[];
  recoveryOutcome?: 'correcting' | 'fallback' | 'failed';
}

export interface FormatFailureSwitchTarget {
  provider: AgentProviderKind;
  model?: string;
  failureCount: number;
  reason: string;
}

export class FormatFailureSwitchPolicy {
  private readonly threshold: number;
  private readonly fallbacks: Array<{ provider: AgentProviderKind; model?: string }>;
  private readonly failures = new Map<string, number>();

  constructor(
    fallbacks: Array<{ provider: AgentProviderKind; model?: string }>,
    threshold = 2
  ) {
    this.fallbacks = fallbacks;
    this.threshold = Math.max(1, threshold);
  }

  recordFailure(provider: AgentProviderKind, model?: string): FormatFailureSwitchTarget | undefined {
    const key = `${provider}:${model || ''}`;
    const failureCount = (this.failures.get(key) || 0) + 1;
    this.failures.set(key, failureCount);
    if (failureCount < this.threshold) return undefined;
    const next = this.fallbacks.find((candidate) => candidate.provider !== provider || candidate.model !== model);
    return next
      ? { ...next, failureCount, reason: `Repeated structured-response failures for ${key}; switch target selected.` }
      : undefined;
  }

  recordSuccess(provider: AgentProviderKind, model?: string): void {
    this.failures.delete(`${provider}:${model || ''}`);
  }

  getFailureCount(provider: AgentProviderKind, model?: string): number {
    return this.failures.get(`${provider}:${model || ''}`) || 0;
  }
}

const PROVIDER_CAPABILITIES: Record<AgentProviderKind, ProviderCapabilityMetadata> = {
  openai: { provider: 'openai', nativeToolCalls: true, streaming: true, jsonSchema: true },
  anthropic: { provider: 'anthropic', nativeToolCalls: true, streaming: true, jsonSchema: true },
  gemini: { provider: 'gemini', nativeToolCalls: true, streaming: true, jsonSchema: true },
  nvidia: { provider: 'nvidia', nativeToolCalls: true, streaming: true, jsonSchema: true },
  legacy_text: { provider: 'legacy_text', nativeToolCalls: false, streaming: false, jsonSchema: false },
  unknown: { provider: 'unknown', nativeToolCalls: false, streaming: false, jsonSchema: false },
};

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function boundedStringArray(value: unknown, limit = 6): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = unique(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()))
    .map((item) => item.slice(0, 240))
    .filter(Boolean)
    .slice(0, limit);
  return values.length > 0 ? values : undefined;
}

function decisionMetadataFromRecord(value: Record<string, any>): AgentDecisionMetadata {
  const rationale = typeof value.rationale === 'string'
    ? value.rationale.trim().slice(0, 600)
    : typeof value.reason === 'string'
      ? value.reason.trim().slice(0, 600)
      : undefined;
  const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence)
    ? Math.max(0, Math.min(1, value.confidence))
    : undefined;
  const evidenceChecks = normalizeAgentEvidenceChecks(value.evidenceChecks);
  return {
    ...(rationale ? { rationale } : {}),
    ...(boundedStringArray(value.planUpdate) ? { planUpdate: boundedStringArray(value.planUpdate) } : {}),
    ...(boundedStringArray(value.expectedEvidence) ? { expectedEvidence: boundedStringArray(value.expectedEvidence) } : {}),
    ...(evidenceChecks ? { evidenceChecks } : {}),
    ...(boundedStringArray(value.preconditions) ? { preconditions: boundedStringArray(value.preconditions) } : {}),
    ...(typeof value.stopCondition === 'string' && value.stopCondition.trim()
      ? { stopCondition: value.stopCondition.trim().slice(0, 240) }
      : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

function redactSecrets(value: string): string {
  return value
    .replace(/("?(?:api[_-]?key|authorization|token|password|secret|private[_-]?key)"?\s*[:=]\s*")(.*?)(")/gi, '$1[REDACTED]$3')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, '[REDACTED]');
}

function parseJsonCandidate(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[\[{]/);
    const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function parseArguments(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseJsonCandidate(value);
    return isRecord(parsed) ? parsed : undefined;
  }
  return value === undefined ? {} : undefined;
}

function actionFromUnknown(value: unknown): NormalizedToolAction | undefined {
  if (!isRecord(value)) return undefined;
  const tool = typeof value.tool === 'string' ? value.tool : typeof value.action === 'string' ? value.action : undefined;
  const args = parseArguments(value.arguments ?? value.action_input ?? value.input);
  return tool && args ? { action: tool, action_input: args } : undefined;
}

function actionFromProviderEnvelope(value: Record<string, any>): NormalizedToolAction | undefined {
  const direct = actionFromUnknown(value);
  if (direct) return direct;

  const toolCalls = Array.isArray(value.tool_calls) ? value.tool_calls : undefined;
  const call = toolCalls?.find((item: unknown) => isRecord(item));
  if (call) {
    const tool = typeof call.name === 'string'
      ? call.name
      : typeof call.tool === 'string'
        ? call.tool
        : typeof call.function?.name === 'string'
          ? call.function.name
          : undefined;
    const args = parseArguments(call.arguments ?? call.action_input ?? call.function?.arguments ?? {});
    if (tool && args) return { action: tool, action_input: args };
  }

  const message = isRecord(value.message) ? value.message : undefined;
  if (message) {
    const nested = actionFromProviderEnvelope(message);
    if (nested) return nested;
  }

  const choices = Array.isArray(value.choices) ? value.choices : [];
  for (const choice of choices) {
    if (isRecord(choice)) {
      const nested = actionFromProviderEnvelope(choice);
      if (nested) return nested;
    }
  }

  const content = Array.isArray(value.content) ? value.content : [];
  const toolUse = content.find((item: unknown) => isRecord(item) && (item.type === 'tool_use' || item.type === 'function'));
  if (isRecord(toolUse)) {
    const tool = typeof toolUse.name === 'string' ? toolUse.name : typeof toolUse.function?.name === 'string' ? toolUse.function.name : undefined;
    const args = parseArguments(toolUse.input ?? toolUse.arguments ?? toolUse.function?.arguments ?? {});
    if (tool && args) return { action: tool, action_input: args };
  }

  const candidates = Array.isArray(value.candidates) ? value.candidates : [];
  for (const candidate of candidates) {
    const candidateContent = isRecord(candidate) && isRecord(candidate.content) ? candidate.content : undefined;
    const parts = candidateContent?.parts;
    if (!Array.isArray(parts)) continue;
    const functionPart = parts.find((part: unknown) => isRecord(part) && isRecord(part.functionCall));
    if (isRecord(functionPart) && isRecord(functionPart.functionCall)) {
      const callValue = functionPart.functionCall;
      const args = parseArguments(callValue.args ?? {});
      if (typeof callValue.name === 'string' && args) return { action: callValue.name, action_input: args };
    }
  }

  return undefined;
}

function textFallbackAction(text: string): NormalizedToolAction | undefined {
  const match = text.match(/\bAction\s*:\s*([A-Za-z][A-Za-z0-9_.-]*)/i);
  if (!match) return undefined;
  const inputIndex = text.search(/\bAction\s+Input\s*:/i);
  const inputText = inputIndex >= 0 ? text.slice(inputIndex).replace(/^.*?:/s, '').trim() : '{}';
  const args = parseArguments(inputText) || {};
  return { action: match[1], action_input: args };
}

function textContent(value: Record<string, any>): string | undefined {
  if (typeof value.content === 'string') return value.content;
  if (typeof value.text === 'string') return value.text;
  if (typeof value.reasoning === 'string') return value.reasoning;
  const parts = Array.isArray(value.content) ? value.content : [];
  const text = parts.find((part: unknown) => isRecord(part) && typeof part.text === 'string');
  return isRecord(text) ? text.text : undefined;
}

export function getProviderCapabilities(provider: AgentProviderKind): ProviderCapabilityMetadata {
  return { ...PROVIDER_CAPABILITIES[provider], notes: PROVIDER_CAPABILITIES[provider].notes ? [...PROVIDER_CAPABILITIES[provider].notes!] : undefined };
}

export function providerKindFromName(providerName: string): AgentProviderKind {
  const lower = providerName.toLowerCase();
  // A composite name contains every configured provider (for example
  // `composite[gemini,nvidia,openrouter]`). It must not be classified as the
  // first matching provider; the selected model's capability profile is the
  // authoritative source for native-tool behavior.
  if (lower.startsWith('composite[')) return 'unknown';
  if (lower.includes('anthropic') || lower.includes('claude')) return 'anthropic';
  if (lower.includes('gemini') || lower.includes('google')) return 'gemini';
  if (lower.includes('nvidia') || lower.includes('nemotron')) return 'nvidia';
  if (lower.includes('cerebras')) return 'openai';
  if (lower.includes('sambanova')) return 'openai';
  if (lower.includes('kimi') || lower.includes('moonshot')) return 'openai';
  if (lower.includes('requesty')) return 'openai';
  if (lower.includes('openai') || lower.includes('pollinations')) return 'openai';
  return 'unknown';
}

export function buildStructuredActionInstruction(provider: AgentProviderKind, nativeToolCallsOverride?: boolean): string {
  const capabilities = getProviderCapabilities(provider);
  if (nativeToolCallsOverride ?? capabilities.nativeToolCalls) {
    return 'Prefer the provider-native tool/function-call mechanism when available. If the provider returns text instead, use exactly {"tool":"ToolName","arguments":{...}}.';
  }
  return 'Use exactly one JSON object: {"tool":"ToolName","arguments":{...}}. Do not return markdown, role metadata, reasoning envelopes, or multiple actions.';
}

export function redactMalformedProviderResponse(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return redactSecrets(text).slice(0, 4000);
}

export function createMalformedProviderResponseAudit(
  raw: unknown,
  result: Pick<AgentDecisionNormalizationResult, 'errors' | 'recoverable'>,
  provider: AgentProviderKind = 'unknown',
  context: Pick<MalformedProviderResponseAudit, 'model' | 'attempt' | 'parsedKeys' | 'recoveryOutcome'> = {}
): MalformedProviderResponseAudit {
  return {
    type: 'malformed_provider_response',
    protocolVersion: AGENT_DECISION_VERSION,
    provider,
    errors: [...result.errors],
    recoverable: result.recoverable,
    rawRedacted: redactMalformedProviderResponse(raw),
    ...context,
  };
}

export function normalizeAgentDecision(raw: unknown, options: AgentDecisionNormalizationOptions = {}): AgentDecisionNormalizationResult {
  const provider = options.provider || 'unknown';
  const errors: string[] = [];
  const allowedTools = options.allowedTools ? new Set(options.allowedTools) : undefined;
  const rawText = typeof raw === 'string' ? raw : JSON.stringify(raw);
  const parsed = typeof raw === 'string' ? parseJsonCandidate(raw) : raw;
  const action = (isRecord(parsed) ? actionFromProviderEnvelope(parsed) : undefined) ||
    (typeof raw === 'string' ? textFallbackAction(raw) : undefined);
  const content = isRecord(parsed)
    ? textContent(parsed)
    : typeof raw === 'string' && !action && parsed === undefined && !/^\s*[\[{]/.test(raw)
      ? raw.trim()
      : undefined;

  if (!action && !content) {
    errors.push('Provider response did not contain a structured action or response content.');
    if (typeof raw === 'string' && parsed === undefined) errors.push('Provider response was not valid JSON.');
    return { errors, recoverable: true, retryCount: 0, redactedRaw: redactMalformedProviderResponse(raw) };
  }
  if (action && allowedTools && !allowedTools.has(action.action)) {
    errors.push(`Unknown tool: ${action.action}`);
    return { errors, recoverable: true, retryCount: 0, redactedRaw: redactMalformedProviderResponse(raw) };
  }

  const metadata = isRecord(parsed) ? decisionMetadataFromRecord(parsed) : {};
  const decision: AgentDecision = {
    version: AGENT_DECISION_VERSION,
    id: `decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    provider,
    status: action ? 'act' : 'respond',
    ...(action ? { action } : {}),
    ...(Object.keys(metadata).length > 0 ? metadata : content ? { rationale: content } : {}),
  };
  return { decision, errors, recoverable: false, retryCount: 0 };
}

export function normalizeAgentDecisionWithRecovery(
  raw: unknown,
  options: AgentDecisionNormalizationOptions = {}
): AgentDecisionNormalizationResult {
  const result = normalizeAgentDecision(raw, options);
  const maxRetries = Math.max(0, options.maxRetries ?? 2);
  if (!result.decision && result.recoverable) {
    return { ...result, retryCount: Math.min(maxRetries, 1) };
  }
  return result;
}

export function validateAgentDecision(decision: unknown, allowedTools?: Iterable<string>): string[] {
  const errors: string[] = [];
  if (!isRecord(decision)) return ['Decision must be an object.'];
  if (decision.version !== AGENT_DECISION_VERSION) errors.push('Unsupported decision version.');
  if (typeof decision.id !== 'string' || !decision.id.trim()) errors.push('Decision id is required.');
  if (!['act', 'respond', 'ask', 'complete', 'blocked', 'retry'].includes(decision.status)) errors.push('Invalid decision status.');
  if (decision.action !== undefined) {
    const action = actionFromUnknown(decision.action);
    if (!action) errors.push('Decision action must contain a tool name and object arguments.');
    else if (allowedTools && !new Set(allowedTools).has(action.action)) errors.push(`Unknown tool: ${action.action}`);
  }
  if (decision.planUpdate !== undefined && !boundedStringArray(decision.planUpdate)) errors.push('Decision planUpdate must be a non-empty string array.');
  if (decision.expectedEvidence !== undefined && !boundedStringArray(decision.expectedEvidence)) errors.push('Decision expectedEvidence must be a non-empty string array.');
  if (decision.evidenceChecks !== undefined && !normalizeAgentEvidenceChecks(decision.evidenceChecks)) errors.push('Decision evidenceChecks must contain valid typed checks.');
  if (decision.preconditions !== undefined && !boundedStringArray(decision.preconditions)) errors.push('Decision preconditions must be a non-empty string array.');
  if (decision.stopCondition !== undefined && (typeof decision.stopCondition !== 'string' || !decision.stopCondition.trim())) errors.push('Decision stopCondition must be a non-empty string.');
  if (decision.confidence !== undefined && (typeof decision.confidence !== 'number' || !Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1)) errors.push('Decision confidence must be between 0 and 1.');
  return unique(errors);
}

/** Validate the provider-neutral action shape at the final execution boundary. */
export function validateNormalizedAction(action: unknown, allowedTools?: Iterable<string>): string[] {
  const errors: string[] = [];
  if (!isRecord(action)) return ['Action must be an object.'];
  if (typeof action.action !== 'string' || !action.action.trim()) errors.push('Action tool name is required.');
  if (!isRecord(action.action_input)) errors.push('Action arguments must be an object.');
  if (allowedTools && typeof action.action === 'string' && !new Set(allowedTools).has(action.action)) {
    errors.push(`Unknown tool: ${action.action}`);
  }
  return unique(errors);
}
