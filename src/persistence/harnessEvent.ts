/**
 * Versioned, JSON-safe event contract for persisted harness run events.
 *
 * The SQLite table already provides the run/sequence index. This envelope
 * makes the serialized payload self-describing so replay, migration, and
 * future projections do not have to infer its shape from a transport event.
 */

export const HARNESS_EVENT_SCHEMA_VERSION = 1 as const;

export const HARNESS_EVENT_TYPES = [
  'run_started', 'progress', 'state', 'console_output',
  'plan_updated', 'todo_snapshot', 'todo_links_updated', 'workplan_updated', 'task_analysis_ready', 'agent_guidance_snapshot', 'plan_approval_required', 'plan_approval_resolved',
  'state_transition', 'recovery_transition', 'model_target_resolved',
  'reasoning_start', 'reasoning_delta', 'reasoning_end', 'model_response', 'decision_record', 'model_stream',
  'llm_request_started', 'llm_request_finished', 'llm_request_heartbeat', 'provider_rotation_occurred',
  'provider_attempt_failed', 'cooldown_waiting', 'nvidia_cooldown_retry', 'retrying', 'execution_failed', 'pacing_wait',
  'tool_started', 'tool_result', 'tool_outcome_unknown', 'tool_evidence', 'harness_intervention',
  'file_read', 'file_changed', 'command_started', 'command_output', 'package_install_started', 'package_install_result',
  'verification_started', 'verification_result',
  'user_input_required', 'user_input_resolved', 'user_message_queued', 'user_message_processed',
  'inbox_message_enqueued', 'inbox_message_claimed', 'inbox_message_replaced', 'inbox_message_cancelled',
  'inbox_message_processed', 'inbox_cleared', 'inbox_requeued', 'inbox_claims_released',
  'policy_decision', 'checkpoint', 'final', 'stopped', 'interrupted', 'killed', 'error', 'done',
  'cordis_runtime_created', 'cordis_runtime_disabled', 'cordis_runtime_disposed',
  'child_created', 'child_started', 'child_status_changed', 'child_follow_up_requested', 'child_report', 'child_terminal',
  'workflow_started', 'workflow_step_started', 'workflow_step_completed', 'workflow_step_failed', 'workflow_step_blocked', 'workflow_completed',
] as const;

export type HarnessEventType = typeof HARNESS_EVENT_TYPES[number];
export type UnknownEventPolicy = 'preserve' | 'reject';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface HarnessEventCorrelation {
  parentEventId?: string;
  requestId?: string;
  toolCallId?: string;
  stepId?: string;
}

export interface HarnessEventEnvelope {
  schemaVersion: typeof HARNESS_EVENT_SCHEMA_VERSION;
  eventId: string;
  runId: string;
  sessionId: string;
  seq: number;
  type: string;
  data: JsonValue;
  timestamp: number;
  correlation?: HarnessEventCorrelation;
}

export interface HarnessEventFallback {
  runId: string;
  sessionId?: string;
  seq: number;
  type: string;
  timestamp: number;
}

const knownEventTypes = new Set<string>(HARNESS_EVENT_TYPES);

export function isKnownHarnessEventType(value: unknown): value is HarnessEventType {
  return typeof value === 'string' && knownEventTypes.has(value);
}

export function assertHarnessEventType(type: string, policy: UnknownEventPolicy = 'preserve'): void {
  if (policy === 'reject' && !isKnownHarnessEventType(type)) {
    throw new HarnessEventValidationError(`Unknown harness event type "${type}" is rejected by policy.`);
  }
}

export class HarnessEventValidationError extends Error {
  readonly code = 'INVALID_HARNESS_EVENT';

  constructor(message: string) {
    super(message);
    this.name = 'HarnessEventValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function assertNonEmptyString(value: unknown, field: string, maxLength = 512): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new HarnessEventValidationError(`${field} must be a non-empty string of at most ${maxLength} characters.`);
  }
}

function assertSafeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new HarnessEventValidationError(`${field} must be a positive safe integer.`);
  }
}

function assertTimestamp(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new HarnessEventValidationError('timestamp must be a finite non-negative number.');
  }
}

function snapshotJsonValue(value: unknown, field: string): JsonValue {
  const ancestors = new Set<object>();

  const visit = (candidate: unknown, location: string, root: boolean): JsonValue => {
    if (candidate === null) return null;
    if (typeof candidate === 'string' || typeof candidate === 'boolean') return candidate;
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) {
        throw new HarnessEventValidationError(`${location} must not contain NaN or Infinity.`);
      }
      return candidate;
    }
    if (candidate === undefined) {
      if (root) throw new HarnessEventValidationError(`${field} must be a JSON value.`);
      // Undefined object properties are omitted by JSON serialization. Treat
      // them as an omitted property while preserving compatibility with the
      // existing event payloads, which contain optional undefined fields.
      return null;
    }
    if (typeof candidate !== 'object') {
      throw new HarnessEventValidationError(`${location} contains an unsupported value.`);
    }
    if (ancestors.has(candidate)) {
      throw new HarnessEventValidationError(`${location} contains a circular reference.`);
    }

    ancestors.add(candidate);
    try {
      if (Array.isArray(candidate)) {
        return candidate.map((item, index) => {
          if (item === undefined) {
            throw new HarnessEventValidationError(`${location}[${index}] must be a JSON value.`);
          }
          return visit(item, `${location}[${index}]`, false);
        });
      }

      const prototype = Object.getPrototypeOf(candidate);
      // `structuredClone()` and Jest's VM can produce a plain object whose
      // Object.prototype belongs to another realm. Identify plain objects by
      // the prototype chain rather than by reference equality.
      const isPlainObject = prototype === null || Object.getPrototypeOf(prototype) === null;
      if (!isPlainObject) {
        const prototypeName = typeof prototype?.constructor?.name === 'string'
          ? prototype.constructor.name
          : 'unknown';
        throw new HarnessEventValidationError(`${location} must contain only plain objects (received ${prototypeName}).`);
      }

      const snapshot: { [key: string]: JsonValue } = {};
      for (const [key, item] of Object.entries(candidate)) {
        if (item !== undefined) snapshot[key] = visit(item, `${location}.${key}`, false);
      }
      return snapshot;
    } finally {
      ancestors.delete(candidate);
    }
  };

  return visit(value, field, true);
}

function snapshotCorrelation(value: unknown): HarnessEventCorrelation | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new HarnessEventValidationError('correlation must be an object.');

  const correlation: HarnessEventCorrelation = {};
  for (const field of ['parentEventId', 'requestId', 'toolCallId', 'stepId'] as const) {
    const candidate = value[field];
    if (candidate === undefined) continue;
    assertNonEmptyString(candidate, `correlation.${field}`, 256);
    correlation[field] = candidate;
  }
  return Object.keys(correlation).length > 0 ? Object.freeze(correlation) : undefined;
}

function derivedCorrelation(value: unknown): HarnessEventCorrelation | undefined {
  if (!isRecord(value)) return undefined;
  const nested = [value, value.request, value.outcome].find(isRecord);
  if (!nested) return undefined;
  const correlation: Record<string, unknown> = {};
  for (const field of ['parentEventId', 'requestId', 'toolCallId', 'stepId'] as const) {
    if (typeof nested[field] === 'string') correlation[field] = nested[field];
  }
  return Object.keys(correlation).length ? snapshotCorrelation(correlation) : undefined;
}

function validateKnownPayload(type: string, data: JsonValue): void {
  if (!isKnownHarnessEventType(type) || !isRecord(data)) {
    if (type === 'tool_started' || type === 'tool_result' || type === 'model_response' || type === 'checkpoint' || type === 'harness_intervention' || type === 'task_analysis_ready') {
      throw new HarnessEventValidationError(`${type} payload must be an object.`);
    }
    return;
  }
  const requiredString = (field: string) => {
    if (typeof data[field] !== 'string' || !String(data[field]).trim()) {
      throw new HarnessEventValidationError(`${type} payload requires a non-empty ${field}.`);
    }
  };
  if (type === 'tool_started' || type === 'tool_result') requiredString('tool');
  if (type === 'model_response') {
    requiredString('message');
    requiredString('provider');
    requiredString('model');
  }
  if (type === 'llm_request_started' || type === 'llm_request_finished') {
    if (!isRecord(data.request)) throw new HarnessEventValidationError(`${type} payload requires a request object.`);
  }
  if (type === 'tool_outcome_unknown') {
    if (!isRecord(data.outcome)) throw new HarnessEventValidationError('tool_outcome_unknown payload requires an outcome object.');
  }
  if (type === 'harness_intervention') {
    requiredString('gateName');
    requiredString('reason');
    requiredString('targetAction');
    if (!['requires_source_mutation', 'intent_mismatch', 'task_analysis_guard'].includes(String(data.gateName))) {
      throw new HarnessEventValidationError('harness_intervention payload has an unsupported gateName.');
    }
    if (String(data.reason).length > 500 || String(data.targetAction).length > 120) {
      throw new HarnessEventValidationError('harness_intervention reason or targetAction exceeds its size limit.');
    }
    if (!Array.isArray(data.requiredEvidence) || data.requiredEvidence.length > 5 || data.requiredEvidence.some((item) => typeof item !== 'string' || item.length > 160)) {
      throw new HarnessEventValidationError('harness_intervention payload requires at most five bounded requiredEvidence strings.');
    }
    if (!Number.isSafeInteger(data.stepSeq) || Number(data.stepSeq) < 0) {
      throw new HarnessEventValidationError('harness_intervention payload requires a non-negative integer stepSeq.');
    }
  }
  if (type === 'task_analysis_ready') {
    if (!isRecord(data.taskAnalysis)) {
      throw new HarnessEventValidationError('task_analysis_ready payload requires a taskAnalysis object.');
    }
    if (typeof data.taskAnalysis.id !== 'string' || typeof data.taskAnalysis.taskKind !== 'string') {
      throw new HarnessEventValidationError('task_analysis_ready taskAnalysis requires id and taskKind strings.');
    }
  }
  if (type === 'checkpoint' && (!isRecord(data.state) || typeof data.version !== 'number')) {
    throw new HarnessEventValidationError('checkpoint payload requires version and state fields.');
  }
}

function freezeJson<T extends JsonValue>(value: T): T {
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      value.forEach((item) => freezeJson(item));
    } else {
      Object.values(value).forEach((item) => freezeJson(item));
    }
    Object.freeze(value);
  }
  return value;
}

export function createHarnessEvent(input: {
  runId: string;
  sessionId?: string;
  seq: number;
  type: string;
  data: unknown;
  timestamp: number;
  eventId?: string;
  correlation?: unknown;
  unknownEventPolicy?: UnknownEventPolicy;
}): HarnessEventEnvelope {
  assertNonEmptyString(input.runId, 'runId');
  assertSafeInteger(input.seq, 'seq');
  assertNonEmptyString(input.type, 'type', 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(input.type)) {
    throw new HarnessEventValidationError('type contains unsupported characters.');
  }
  assertTimestamp(input.timestamp);
  assertHarnessEventType(input.type, input.unknownEventPolicy);

  const eventId = input.eventId ?? `${input.runId}:${input.seq}`;
  assertNonEmptyString(eventId, 'eventId', 512);
  const correlation = snapshotCorrelation(input.correlation) || derivedCorrelation(input.data);
  const sessionId = input.sessionId || input.runId;
  assertNonEmptyString(sessionId, 'sessionId');

  const envelope: HarnessEventEnvelope = {
    schemaVersion: HARNESS_EVENT_SCHEMA_VERSION,
    eventId,
    runId: input.runId,
    sessionId,
    seq: input.seq,
    type: input.type,
    data: snapshotJsonValue(input.data, 'data'),
    timestamp: input.timestamp,
    ...(correlation ? { correlation } : {}),
  };

  validateKnownPayload(input.type, envelope.data);

  return Object.freeze({
    ...envelope,
    data: freezeJson(envelope.data),
  });
}

/**
 * Convert both current envelopes and pre-envelope run events into the current
 * contract. Legacy rows are accepted only through this boundary; new writes
 * always use the versioned shape.
 */
export function normalizeHarnessEvent(raw: unknown, fallback: HarnessEventFallback): HarnessEventEnvelope {
  assertNonEmptyString(fallback.runId, 'fallback.runId');
  assertSafeInteger(fallback.seq, 'fallback.seq');
  assertNonEmptyString(fallback.type, 'fallback.type', 128);
  assertTimestamp(fallback.timestamp);
  const fallbackSessionId = fallback.sessionId || fallback.runId;

  if (!isRecord(raw)) {
    return createHarnessEvent({ ...fallback, data: raw });
  }

  if (raw.schemaVersion !== undefined && raw.schemaVersion !== HARNESS_EVENT_SCHEMA_VERSION) {
    throw new HarnessEventValidationError(`Unsupported harness event schema version: ${String(raw.schemaVersion)}.`);
  }

  if (raw.schemaVersion === HARNESS_EVENT_SCHEMA_VERSION) {
    if (typeof raw.eventId !== 'string'
      || typeof raw.runId !== 'string'
      || typeof raw.seq !== 'number'
      || typeof raw.type !== 'string'
      || !Object.prototype.hasOwnProperty.call(raw, 'data')
      || typeof raw.timestamp !== 'number') {
      throw new HarnessEventValidationError('Versioned harness events must include eventId, runId, seq, type, data, and timestamp.');
    }
    return createHarnessEvent({
      runId: raw.runId,
      sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : fallbackSessionId,
      seq: raw.seq,
      type: raw.type,
      data: raw.data,
      timestamp: raw.timestamp,
      eventId: raw.eventId,
      correlation: raw.correlation,
    });
  }

  const data = Object.prototype.hasOwnProperty.call(raw, 'data') ? raw.data : raw;

  return createHarnessEvent({
    runId: typeof raw.runId === 'string' ? raw.runId : fallback.runId,
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : fallbackSessionId,
    seq: typeof raw.seq === 'number' ? raw.seq : fallback.seq,
    type: typeof raw.type === 'string' ? raw.type : fallback.type,
    data,
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : fallback.timestamp,
    eventId: typeof raw.eventId === 'string' ? raw.eventId : `${fallback.runId}:${fallback.seq}`,
    correlation: raw.correlation,
  });
}

export function isHarnessEvent(value: unknown): value is HarnessEventEnvelope {
  try {
    if (!isRecord(value)) return false;
    normalizeHarnessEvent(value, {
      runId: typeof value.runId === 'string' ? value.runId : 'validation-run',
      seq: typeof value.seq === 'number' ? value.seq : 1,
      type: typeof value.type === 'string' ? value.type : 'validation',
      timestamp: typeof value.timestamp === 'number' ? value.timestamp : 0,
    });
    return value.schemaVersion === HARNESS_EVENT_SCHEMA_VERSION;
  } catch {
    return false;
  }
}
