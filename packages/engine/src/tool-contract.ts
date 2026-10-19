import type { ToolCapabilities } from './shared-control.js';
import { getToolCapabilities } from './shared-control.js';
import type { PolicyDecision } from './action-policy.js';
import type { ToolAction } from './tool-action.js';

export type ToolExecutionStatus =
  | 'started'
  | 'success'
  | 'skipped'
  | 'error'
  | 'denied'
  | 'denied_retry'
  | 'invalid'
  | 'cancelled'
  | 'timed_out'
  | 'awaiting_plan_approval'
  | 'unknown';

/** Backward-compatible name used by older checkpoint consumers. */
export type ToolEvidenceStatus = ToolExecutionStatus;

export interface ToolInvocation {
  invocationId: string;
  toolCallId: string;
  toolId: string;
  action: string;
  input: Record<string, unknown>;
  signature: string;
  targetResources: string[];
  capabilities: ToolCapabilities;
  startedAt: number;
  timeoutMs?: number;
  attempt: number;
}

export type HarnessInterventionGateName =
  | 'requires_source_mutation'
  | 'intent_mismatch'
  | 'task_analysis_guard';

export interface HarnessInterventionEvidence {
  gateName: HarnessInterventionGateName;
  reason: string;
  requiredEvidence: string[];
  targetAction: string;
  stepSeq: number;
}

export interface ToolEvidenceRecord {
  id: string;
  /** Stable model/tool call identity. The evidence id identifies this record. */
  toolCallId: string;
  /** Logical tool name; retained separately from the stable call identity. */
  toolId: string;
  invocationId?: string;
  action: string;
  input: Record<string, unknown>;
  signature?: string;
  targetResources?: string[];
  capabilities: ToolCapabilities;
  status: ToolExecutionStatus;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  /** Compact, safe-to-display interpretation of the raw tool result. */
  summary?: string;
  output?: string;
  error?: string;
  policy?: PolicyDecision;
  staleEditIntervention?: {
    targetFile: string;
    type: 'rejected_replay' | 'recovery_guidance';
    details?: string;
  };
  /** Identifies a deliberate harness guard rejection separately from tool crashes. */
  harnessIntervention?: HarnessInterventionEvidence;
}

export interface StructuredToolResult {
  success: boolean;
  status: Exclude<ToolExecutionStatus, 'started'>;
  output?: string;
  error?: string;
  toolId: string;
  toolCallId?: string;
  invocationId?: string;
  durationMs?: number;
  attempt?: number;
  targetResources?: string[];
  evidenceIds?: string[];
  policy?: PolicyDecision;
  retryable?: boolean;
  nextAction?: string;
}

export type CanonicalToolResult = StructuredToolResult & Record<string, unknown>;

/** Deterministic JSON for signatures, deduplication, and durable evidence. */
export function stableJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') return Number.isFinite(input) ? input : String(input);
    if (typeof input === 'bigint') return `${input}n`;
    if (typeof input === 'undefined') return null;
    if (typeof input === 'function' || typeof input === 'symbol') return String(input);
    if (Array.isArray(input)) return input.map(normalize);
    if (typeof input !== 'object') return String(input);
    if (seen.has(input)) return '[Circular]';
    seen.add(input);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      try {
        result[key] = normalize((input as Record<string, unknown>)[key]);
      } catch {
        result[key] = '[Unserializable]';
      }
    }
    seen.delete(input);
    return result;
  };
  return JSON.stringify(normalize(value));
}

/** Serialization is part of the tool boundary: it must never throw. */
export function safeJsonStringify(value: unknown, fallback?: Record<string, unknown>): string {
  try {
    const serialized = stableJson(value);
    return typeof serialized === 'string' ? serialized : JSON.stringify(fallback || {
      success: false,
      status: 'error',
      error: 'Tool result could not be serialized.',
    });
  } catch (error) {
    return JSON.stringify(fallback || {
      success: false,
      status: 'error',
      error: `Tool result serialization failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export function actionSignature(action: ToolAction): string {
  return `${action.action}:${stableJson(action.action_input || {})}`;
}

function normalizedResource(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
}

/** Return stable resource identities used by scheduling and evidence. */
export function getToolTargetResources(action: ToolAction): string[] {
  const input = action.action_input || {};
  const resources: string[] = [];
  for (const key of ['file_path', 'path', 'filename', 'file', 'target', 'resource']) {
    const resource = normalizedResource(input[key]);
    if (resource) resources.push(`path:${resource}`);
  }
  const cwd = normalizedResource(input.cwd);
  if (cwd) resources.push(`cwd:${cwd}`);
  if (action.action === 'Bash' || action.action === 'Command') {
    const command = normalizedResource(input.command || input.operation);
    if (command) resources.push(`command:${command}`);
  }
  return [...new Set(resources.length ? resources : [`tool:${action.action}`])];
}

function statusFromRecord(record: Record<string, unknown>): Exclude<ToolExecutionStatus, 'started'> {
  const explicit = typeof record.status === 'string' ? record.status : undefined;
  const statuses: Array<Exclude<ToolExecutionStatus, 'started'>> = [
    'success', 'skipped', 'error', 'denied', 'denied_retry', 'invalid', 'cancelled', 'timed_out',
    'awaiting_plan_approval', 'unknown',
  ];
  if (explicit && statuses.includes(explicit as Exclude<ToolExecutionStatus, 'started'>)) {
    return explicit as Exclude<ToolExecutionStatus, 'started'>;
  }
  if (record.success !== false) return 'success';
  if (record.policy && typeof record.error === 'string') return 'denied';
  return 'error';
}

function failureFromText(text: string): Exclude<ToolExecutionStatus, 'started'> {
  if (/timed?\s*out|timeout/i.test(text)) return 'timed_out';
  if (/cancelled|canceled|abort/i.test(text)) return 'cancelled';
  if (/denied|not authorized|permission/i.test(text)) return 'denied';
  if (/invalid|malformed|required input/i.test(text)) return 'invalid';
  if (/unknown outcome/i.test(text)) return 'unknown';
  return 'error';
}

/** Convert every provider/handler shape into a lossless, canonical result. */
export function normalizeToolResult(
  toolId: string,
  observation: unknown,
  metadata: Partial<Pick<StructuredToolResult, 'toolCallId' | 'invocationId' | 'durationMs' | 'attempt' | 'targetResources' | 'evidenceIds' | 'policy'>> = {},
): CanonicalToolResult {
  let record: Record<string, unknown>;
  if (typeof observation === 'string') {
    try {
      const parsed = JSON.parse(observation);
      record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { ...(parsed as Record<string, unknown>) }
        : { output: observation };
    } catch {
      const looksFailed = /timed?\s*out|timeout|cancelled|canceled|abort|denied|not authorized|permission|invalid|malformed|required input|unknown outcome/i.test(observation);
      const status = looksFailed ? failureFromText(observation) : 'success';
      record = status === 'success' ? { output: observation } : { error: observation };
      return {
        ...record,
        success: status === 'success',
        status,
        toolId,
        ...metadata,
        retryable: status === 'cancelled' || status === 'timed_out' || status === 'unknown',
      };
    }
  } else if (observation && typeof observation === 'object' && !Array.isArray(observation)) {
    try {
      record = { ...(observation as Record<string, unknown>) };
    } catch {
      record = { error: 'Tool returned an unserializable object.' };
    }
  } else {
    record = { output: observation === undefined ? '' : String(observation) };
  }

  const status = statusFromRecord(record);
  const resultToolId = typeof record.toolId === 'string' && record.toolId.trim() ? record.toolId : toolId;
  const success = status === 'success' || status === 'skipped'
    ? record.success !== false
    : false;
  const output = typeof record.output === 'string' ? record.output : undefined;
  const error = typeof record.error === 'string' ? record.error : undefined;
  return {
    ...record,
    success,
    status,
    toolId: resultToolId,
    ...(output !== undefined ? { output } : {}),
    ...(error !== undefined ? { error } : {}),
    ...metadata,
    retryable: typeof record.retryable === 'boolean'
      ? record.retryable
      : status === 'cancelled' || status === 'timed_out' || status === 'unknown',
    ...(status === 'denied' ? { nextAction: 'request_approval_or_choose_a_different_action' } : {}),
    ...(status === 'invalid' ? { nextAction: 'correct_input_and_retry' } : {}),
  };
}

export function serializeToolResult(result: unknown, fallback?: Record<string, unknown>): string {
  return safeJsonStringify(result, fallback);
}

export function parseStructuredToolResult(toolId: string, observation: string): StructuredToolResult {
  const result = normalizeToolResult(toolId, observation);
  return {
    success: result.success,
    status: result.status,
    ...(result.output !== undefined ? { output: result.output } : {}),
    ...(result.error !== undefined ? { error: result.error } : {}),
    toolId: result.toolId,
    ...(result.toolCallId ? { toolCallId: result.toolCallId } : {}),
    ...(result.invocationId ? { invocationId: result.invocationId } : {}),
    ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
    ...(result.attempt !== undefined ? { attempt: result.attempt } : {}),
    ...(result.targetResources ? { targetResources: result.targetResources } : {}),
    ...(result.evidenceIds ? { evidenceIds: result.evidenceIds } : {}),
    ...(result.policy ? { policy: result.policy } : {}),
    ...(typeof result.retryable === 'boolean' ? { retryable: result.retryable } : {}),
    ...(typeof result.nextAction === 'string' ? { nextAction: result.nextAction } : {}),
  };
}

export function summarizeToolOutput(observation: string, maxLength = 240): string {
  const normalized = observation.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Tool returned no output.';
  try {
    const parsed = JSON.parse(observation) as Record<string, unknown>;
    const status = typeof parsed.status === 'string' ? parsed.status : parsed.success === false ? 'error' : 'success';
    const detail = typeof parsed.error === 'string'
      ? parsed.error
      : typeof parsed.output === 'string'
        ? parsed.output
        : typeof parsed.message === 'string' ? parsed.message : normalized;
    return `${status}: ${detail.replace(/\s+/g, ' ').trim().slice(0, maxLength)}`;
  } catch {
    return normalized.slice(0, maxLength);
  }
}

export class ToolEvidenceLedger {
  private records: ToolEvidenceRecord[] = [];

  constructor(private readonly createId: () => string) {}

  start(action: ToolAction, toolCallId?: string, capabilities = getToolCapabilities(action.action)): string {
    const id = this.createId();
    const startedAt = Date.now();
    this.records.push({
      id,
      toolCallId: toolCallId ?? this.createId(),
      invocationId: this.createId(),
      toolId: action.action,
      action: action.action,
      input: { ...(action.action_input || {}) },
      signature: actionSignature(action),
      targetResources: getToolTargetResources(action),
      capabilities,
      status: 'started',
      startedAt,
    });
    return id;
  }

  complete(id: string, observation: string, policy?: PolicyDecision): ToolEvidenceRecord | undefined {
    const record = this.records.find((item) => item.id === id);
    if (!record) return undefined;
    const result = parseStructuredToolResult(record.toolId, observation);
    record.status = result.status;
    record.summary = record.harnessIntervention
      ? `[Harness intervention: ${record.harnessIntervention.gateName}] ${record.harnessIntervention.reason}`.slice(0, 240)
      : summarizeToolOutput(observation);
    record.output = observation;
    record.error = result.error;
    record.policy = policy;
    record.completedAt = Date.now();
    record.durationMs = record.completedAt - record.startedAt;
    return { ...record, targetResources: record.targetResources ? [...record.targetResources] : undefined };
  }

  recordHarnessIntervention(id: string, intervention: HarnessInterventionEvidence): ToolEvidenceRecord | undefined {
    const record = this.records.find((item) => item.id === id);
    if (!record) return undefined;
    record.harnessIntervention = {
      ...intervention,
      requiredEvidence: [...intervention.requiredEvidence],
    };
    record.summary = `[Harness intervention: ${intervention.gateName}] ${intervention.reason}`.slice(0, 240);
    return {
      ...record,
      targetResources: record.targetResources ? [...record.targetResources] : undefined,
      harnessIntervention: { ...record.harnessIntervention, requiredEvidence: [...record.harnessIntervention.requiredEvidence] },
    };
  }

  recordDeniedRetry(action: ToolAction, error: string, toolCallId?: string, capabilities = getToolCapabilities(action.action)): ToolEvidenceRecord {
    const now = Date.now();
    const record: ToolEvidenceRecord = {
      id: this.createId(),
      toolCallId: toolCallId ?? this.createId(),
      invocationId: this.createId(),
      toolId: action.action,
      action: action.action,
      input: { ...(action.action_input || {}) },
      signature: actionSignature(action),
      targetResources: getToolTargetResources(action),
      capabilities,
      status: 'denied_retry',
      startedAt: now,
      completedAt: now,
      durationMs: 0,
      summary: error.slice(0, 240),
      error,
    };
    this.records.push(record);
    return { ...record, targetResources: [...(record.targetResources || [])] };
  }

  recordStaleEditIntervention(
    action: ToolAction,
    targetFile: string,
    interventionType: 'rejected_replay' | 'recovery_guidance',
    details: string,
    toolCallId?: string,
    capabilities = getToolCapabilities(action.action),
  ): ToolEvidenceRecord {
    const now = Date.now();
    const record: ToolEvidenceRecord = {
      id: this.createId(),
      toolCallId: toolCallId ?? this.createId(),
      invocationId: this.createId(),
      toolId: action.action,
      action: action.action,
      input: { ...(action.action_input || {}) },
      signature: actionSignature(action),
      targetResources: targetFile ? [targetFile] : getToolTargetResources(action),
      capabilities,
      status: interventionType === 'rejected_replay' ? 'denied_retry' : 'invalid',
      startedAt: now,
      completedAt: now,
      durationMs: 0,
      summary: `[Stale Edit ${interventionType === 'rejected_replay' ? 'Replay Blocked' : 'Recovery Guidance'}] ${targetFile}: ${details.slice(0, 180)}`,
      error: details,
      staleEditIntervention: {
        targetFile,
        type: interventionType,
        details,
      },
    };
    this.records.push(record);
    return { ...record, targetResources: [...(record.targetResources || [])] };
  }

  restore(records: ToolEvidenceRecord[]): void {
    this.records = records.slice(-500).map((record) => ({
      ...record,
      toolCallId: record.toolCallId || record.id,
      input: { ...(record.input || {}) },
      targetResources: record.targetResources ? [...record.targetResources] : getToolTargetResources({ action: record.action, action_input: record.input || {} }),
      capabilities: { ...getToolCapabilities(record.action), ...(record.capabilities || {}) },
    }));
  }

  list(): ToolEvidenceRecord[] {
    return this.records.map((record) => ({
      ...record,
      input: { ...record.input },
      targetResources: record.targetResources ? [...record.targetResources] : undefined,
      harnessIntervention: record.harnessIntervention
        ? { ...record.harnessIntervention, requiredEvidence: [...record.harnessIntervention.requiredEvidence] }
        : undefined,
    }));
  }
}

/** Shared state for a run's denied-action retry guard. */
export class ToolExecutionState {
  private denied = new Set<string>();

  isDenied(action: ToolAction): boolean {
    return this.denied.has(actionSignature(action));
  }

  markDenied(action: ToolAction): void {
    this.denied.add(actionSignature(action));
  }
}

/**
 * A small deterministic scheduler. Parallel-safe calls wait behind the last
 * exclusive call but do not wait behind one another. Exclusive calls drain all
 * active readers and are committed in invocation order.
 */
export class ToolExecutionScheduler {
  private exclusiveTail: Promise<void> = Promise.resolve();
  private activeReads = new Set<Promise<void>>();

  async execute<T>(
    action: ToolAction,
    operation: () => Promise<T>,
    capabilities: ToolCapabilities = getToolCapabilities(action.action),
  ): Promise<T> {
    if (capabilities.readOnly && capabilities.parallelSafe) {
      const read = (async () => {
        await this.exclusiveTail;
        return operation();
      })();
      const settled = read.then(() => undefined, () => undefined);
      this.activeReads.add(settled);
      try {
        return await read;
      } finally {
        this.activeReads.delete(settled);
      }
    }

    const priorExclusive = this.exclusiveTail;
    const priorReads = [...this.activeReads];
    const exclusive = (async () => {
      await priorExclusive;
      await Promise.all(priorReads);
      return operation();
    })();
    this.exclusiveTail = exclusive.then(() => undefined, () => undefined);
    return exclusive;
  }

  async executeBatch<T>(
    actions: ToolAction[],
    operation: (action: ToolAction) => Promise<T>,
    capabilitiesForAction: (action: ToolAction) => ToolCapabilities = (action) => getToolCapabilities(action.action),
  ): Promise<T[]> {
    const results: T[] = [];
    let index = 0;
    while (index < actions.length) {
      const action = actions[index];
      const capabilities = capabilitiesForAction(action);
      if (!capabilities.readOnly || !capabilities.parallelSafe) {
        results.push(await this.execute(action, () => operation(action), capabilities));
        index += 1;
        continue;
      }
      const wave: ToolAction[] = [];
      const keys = new Set<string>();
      while (index < actions.length) {
        const candidate = actions[index];
        const candidateCapabilities = capabilitiesForAction(candidate);
        const resource = getToolTargetResources(candidate).join('|');
        if (!candidateCapabilities.readOnly || !candidateCapabilities.parallelSafe || keys.has(resource)) break;
        wave.push(candidate);
        keys.add(resource);
        index += 1;
      }
      results.push(...await Promise.all(wave.map((item) => this.execute(item, () => operation(item), capabilitiesForAction(item)))));
    }
    return results;
  }
}
