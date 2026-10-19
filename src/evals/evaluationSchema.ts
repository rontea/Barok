import { z } from 'zod';
import type { StoredAgentRun, StoredAgentRunEvent, StoredAgentRunStatus } from '../persistence/sqliteStore.js';

export const EVALUATION_SCHEMA_VERSION = 1 as const;

export const EvaluationTerminalStatusSchema = z.enum([
  'completed',
  'failed',
  'blocked',
  'stopped',
  'cancelled',
  'timed_out',
  'crashed',
]);

export const EvaluationRunStatusSchema = z.union([
  z.literal('running'),
  EvaluationTerminalStatusSchema,
]);

export const CheckOutcomeSchema = z.enum([
  'passed',
  'failed',
  'unavailable',
  'skipped',
  'cancelled',
  'timed_out',
]);

const StableIdSchema = z.string().trim().min(1);
const TimestampSchema = z.number().int().nonnegative();
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/i);

export const RequirementEvidenceSchema = z.object({
  id: StableIdSchema,
  text: z.string().min(1),
  source: z.string().min(1).optional(),
  status: z.enum(['pending', 'satisfied', 'unsatisfied', 'blocked']),
  evidenceIds: z.array(StableIdSchema).default([]),
}).passthrough();

export const ActionEvidenceSchema = z.object({
  id: StableIdSchema,
  sequence: z.number().int().nonnegative(),
  tool: z.string().min(1),
  input: z.unknown().optional(),
  status: z.enum(['selected', 'dispatched', 'succeeded', 'failed', 'rejected', 'recovery']),
  expectedEvidence: z.array(z.string().min(1)).default([]),
  startedAt: TimestampSchema.optional(),
  finishedAt: TimestampSchema.optional(),
}).passthrough();

export const ObservationEvidenceSchema = z.object({
  id: StableIdSchema,
  sequence: z.number().int().nonnegative(),
  actionId: StableIdSchema.optional(),
  kind: z.string().min(1),
  success: z.boolean().optional(),
  data: z.unknown(),
  timestamp: TimestampSchema,
}).passthrough();

export const MutationEvidenceSchema = z.object({
  id: StableIdSchema,
  actionId: StableIdSchema.optional(),
  path: z.string().min(1),
  operation: z.enum(['created', 'modified', 'deleted', 'moved', 'formatted']),
  success: z.boolean(),
  beforeHash: HashSchema.optional(),
  afterHash: HashSchema.optional(),
  diffArtifact: z.string().min(1).optional(),
  overlapsUserChange: z.boolean().default(false),
  timestamp: TimestampSchema,
}).passthrough();

export const VerificationEvidenceSchema = z.object({
  id: StableIdSchema,
  requirementIds: z.array(StableIdSchema).default([]),
  actionId: StableIdSchema.optional(),
  name: z.string().min(1),
  outcome: CheckOutcomeSchema,
  summary: z.string().optional(),
  outputArtifact: z.string().min(1).optional(),
  timestamp: TimestampSchema,
}).passthrough();

export const FinalClaimEvidenceSchema = z.object({
  id: StableIdSchema,
  text: z.string().min(1),
  requirementIds: z.array(StableIdSchema).default([]),
  evidenceIds: z.array(StableIdSchema).default([]),
  support: z.enum(['supported', 'contradicted', 'unverifiable']),
}).passthrough();

export const EvaluationMetricsSchema = z.object({
  taskSuccess: z.boolean().optional(),
  falseCompletion: z.boolean().optional(),
  validToolCallRate: z.number().min(0).max(1).optional(),
  repeatedActions: z.number().int().nonnegative().optional(),
  /** Latency from run start to the first non-recovery useful action. */
  firstUsefulActionLatencyMs: z.number().nonnegative().optional(),
  /** Alias with explicit operating-gate wording for repeatedActions. */
  duplicateActionCount: z.number().int().nonnegative().optional(),
  unknownOutcomeCount: z.number().int().nonnegative().optional(),
  recoveryCount: z.number().int().nonnegative().optional(),
  childCompletionRate: z.number().min(0).max(1).optional(),
  /** Provider/tool cost as recorded by the evaluation adapter. */
  tokenCost: z.number().nonnegative().optional(),
  firstMutationLatencyMs: z.number().nonnegative().optional(),
  verificationCoverage: z.number().min(0).max(1).optional(),
  cost: z.number().nonnegative().optional(),
  totalDurationMs: z.number().nonnegative(),
}).passthrough();

const EvaluationRunRecordBaseSchema = z.object({
  schemaVersion: z.literal(EVALUATION_SCHEMA_VERSION),
  runId: StableIdSchema,
  fixture: z.object({
    id: StableIdSchema,
    version: z.string().min(1),
    workspaceFingerprint: z.string().min(1),
    runtimeVersion: z.string().min(1),
    providerAdapter: z.string().min(1).optional(),
    randomSeed: z.number().int().optional(),
  }).passthrough(),
  task: z.object({
    id: StableIdSchema,
    request: z.string().min(1),
    kind: z.string().min(1).optional(),
    workspace: z.string().min(1).optional(),
    contractVersion: z.string().min(1).optional(),
  }).passthrough(),
  provider: z.object({
    name: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
  }).passthrough().optional(),
  status: EvaluationRunStatusSchema,
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema.optional(),
  requirements: z.array(RequirementEvidenceSchema).default([]),
  actions: z.array(ActionEvidenceSchema).default([]),
  observations: z.array(ObservationEvidenceSchema).default([]),
  mutations: z.array(MutationEvidenceSchema).default([]),
  verificationChecks: z.array(VerificationEvidenceSchema).default([]),
  finalClaims: z.array(FinalClaimEvidenceSchema).default([]),
  metrics: EvaluationMetricsSchema,
  source: z.object({
    kind: z.enum(['evaluation', 'stored_run']),
    legacyStatus: z.string().min(1).optional(),
    lastEventSequence: z.number().int().nonnegative().optional(),
  }).passthrough(),
}).passthrough();

export const EvaluationRunRecordSchema = EvaluationRunRecordBaseSchema.superRefine((record, context) => {
  const allEvidenceIds = new Set<string>();
  const duplicateIds = new Set<string>();
  const addId = (id: string) => {
    if (allEvidenceIds.has(id)) duplicateIds.add(id);
    allEvidenceIds.add(id);
  };

  record.requirements.forEach((item) => addId(item.id));
  record.actions.forEach((item) => addId(item.id));
  record.observations.forEach((item) => addId(item.id));
  record.mutations.forEach((item) => addId(item.id));
  record.verificationChecks.forEach((item) => addId(item.id));
  record.finalClaims.forEach((item) => addId(item.id));

  for (const id of duplicateIds) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Duplicate evidence ID: ${id}`,
    });
  }

  const requirementIds = new Set(record.requirements.map((item) => item.id));
  const actionIds = new Set(record.actions.map((item) => item.id));
  const supportingEvidenceIds = new Set([
    ...record.observations.map((item) => item.id),
    ...record.mutations.map((item) => item.id),
    ...record.verificationChecks.map((item) => item.id),
  ]);
  const supportsAction = (actionId: string | undefined, label: string) => {
    if (actionId && !actionIds.has(actionId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} references missing action ID: ${actionId}`,
      });
    }
  };
  const supportsRequirements = (ids: string[], label: string) => {
    for (const id of ids) {
      if (!requirementIds.has(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} references missing requirement ID: ${id}`,
        });
      }
    }
  };
  const supportsEvidence = (ids: string[], label: string) => {
    for (const id of ids) {
      if (!supportingEvidenceIds.has(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} references missing supporting evidence ID: ${id}`,
        });
      }
    }
  };

  record.requirements.forEach((item) => supportsEvidence(item.evidenceIds, item.id));
  record.observations.forEach((item) => supportsAction(item.actionId, item.id));
  record.mutations.forEach((item) => supportsAction(item.actionId, item.id));
  record.verificationChecks.forEach((item) => {
    supportsAction(item.actionId, item.id);
    supportsRequirements(item.requirementIds, item.id);
  });
  record.finalClaims.forEach((item) => {
    supportsRequirements(item.requirementIds, item.id);
    supportsEvidence(item.evidenceIds, item.id);
  });

  if (record.status !== 'running' && record.finishedAt === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Terminal run status ${record.status} requires finishedAt`,
      path: ['finishedAt'],
    });
  }

  if (record.finishedAt !== undefined && record.finishedAt < record.startedAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'finishedAt cannot be earlier than startedAt',
      path: ['finishedAt'],
    });
  }
});

export type EvaluationTerminalStatus = z.infer<typeof EvaluationTerminalStatusSchema>;
export type EvaluationRunStatus = z.infer<typeof EvaluationRunStatusSchema>;
export type CheckOutcome = z.infer<typeof CheckOutcomeSchema>;
export type RequirementEvidence = z.infer<typeof RequirementEvidenceSchema>;
export type ActionEvidence = z.infer<typeof ActionEvidenceSchema>;
export type ObservationEvidence = z.infer<typeof ObservationEvidenceSchema>;
export type MutationEvidence = z.infer<typeof MutationEvidenceSchema>;
export type VerificationEvidence = z.infer<typeof VerificationEvidenceSchema>;
export type FinalClaimEvidence = z.infer<typeof FinalClaimEvidenceSchema>;
export type EvaluationRunRecord = z.infer<typeof EvaluationRunRecordSchema>;

export interface EvaluationOperatingMetricInput {
  startedAt: number;
  actions: ActionEvidence[];
  observations: ObservationEvidence[];
  mutations: MutationEvidence[];
  verificationChecks: VerificationEvidence[];
  metrics?: { cost?: number };
}

function stableMetricValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableMetricValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableMetricValue(item)]));
  }
  return value;
}

function metricSignature(tool: string, input: unknown): string {
  return `${tool}:${JSON.stringify(stableMetricValue(input))}`;
}

function nestedStatus(value: unknown): string | undefined {
  const record = asRecord(value);
  const child = asRecord(record?.child);
  const status = record?.status ?? child?.status;
  return typeof status === 'string' ? status : undefined;
}

/** Derive the operating signals shared by scripted and stored-run evaluations. */
export function deriveEvaluationOperatingMetrics(
  input: EvaluationOperatingMetricInput,
): Pick<z.infer<typeof EvaluationMetricsSchema>, 'firstUsefulActionLatencyMs' | 'duplicateActionCount' | 'unknownOutcomeCount' | 'recoveryCount' | 'childCompletionRate' | 'tokenCost'> {
  const firstUsefulAction = input.actions.find((action) =>
    action.status !== 'rejected' && action.status !== 'recovery' && action.startedAt !== undefined
  );
  const seen = new Set<string>();
  let duplicateActionCount = 0;
  for (const action of input.actions) {
    const signature = metricSignature(action.tool, action.input);
    if (seen.has(signature)) duplicateActionCount += 1;
    else seen.add(signature);
  }
  const unknownOutcomeCount = input.observations.filter((observation) =>
    observation.kind === 'tool_outcome_unknown' || observation.kind === 'unknown_tool_outcome'
  ).length;
  const recoveryCount = input.actions.filter((action) => action.status === 'recovery').length +
    input.observations.filter((observation) => [
      'recovery_transition',
      'provider_attempt_failed',
      'retrying',
      'inbox_claims_released',
    ].includes(observation.kind)).length;
  const childTerminalEvents = input.observations.filter((observation) => observation.kind === 'child_terminal');
  const childCompletionRate = childTerminalEvents.length > 0
    ? childTerminalEvents.filter((observation) => ['completed', 'succeeded', 'success'].includes(nestedStatus(observation.data) || '')).length / childTerminalEvents.length
    : undefined;

  return {
    ...(firstUsefulAction?.startedAt !== undefined
      ? { firstUsefulActionLatencyMs: Math.max(0, firstUsefulAction.startedAt - input.startedAt) }
      : {}),
    duplicateActionCount,
    unknownOutcomeCount,
    recoveryCount,
    ...(childCompletionRate === undefined ? {} : { childCompletionRate }),
    ...(input.metrics?.cost === undefined ? {} : { tokenCost: input.metrics.cost }),
  };
}

export interface StoredRunEvaluationAdapterInput {
  run: StoredAgentRun;
  events: StoredAgentRunEvent[];
  fixture: {
    id: string;
    version: string;
    workspaceFingerprint: string;
    runtimeVersion: string;
    providerAdapter?: string;
    randomSeed?: number;
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(record: Record<string, unknown> | null, field: string): string | undefined {
  const value = record?.[field];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberField(record: Record<string, unknown> | null, field: string): number | undefined {
  const value = record?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanField(record: Record<string, unknown> | null, field: string): boolean | undefined {
  const value = record?.[field];
  return typeof value === 'boolean' ? value : undefined;
}

export function normalizeStoredRunStatus(status: StoredAgentRunStatus): EvaluationRunStatus {
  switch (status) {
    case 'running':
    case 'waiting_for_user':
    case 'waiting_for_provider':
      return 'running';
    case 'completed':
    case 'failed':
    case 'stopped':
      return status;
    case 'interrupted':
      return 'crashed';
    case 'killed':
      return 'cancelled';
  }
}

export function createEvidenceId(runId: string, kind: string, sequence: number | string): string {
  return `${runId}:${kind}:${sequence}`;
}

export function adaptStoredRunToEvaluationRecord(
  input: StoredRunEvaluationAdapterInput
): EvaluationRunRecord {
  const sortedEvents = [...input.events].sort((left, right) => left.seq - right.seq);
  const actions: ActionEvidence[] = [];
  const observations: ObservationEvidence[] = [];
  const mutations: MutationEvidence[] = [];
  const verificationChecks: VerificationEvidence[] = [];
  const finalClaims: FinalClaimEvidence[] = [];
  let activeActionId: string | undefined;

  for (const storedEvent of sortedEvents) {
    const envelope = asRecord(storedEvent.event);
    const data = envelope && 'data' in envelope ? envelope.data : storedEvent.event;
    const dataRecord = asRecord(data);
    const observationId = createEvidenceId(input.run.id, 'observation', storedEvent.seq);

    if (storedEvent.eventType === 'tool_started') {
      activeActionId = createEvidenceId(input.run.id, 'action', storedEvent.seq);
      actions.push({
        id: activeActionId,
        sequence: storedEvent.seq,
        tool: stringField(dataRecord, 'tool') || 'unknown',
        input: dataRecord?.input,
        status: 'dispatched',
        expectedEvidence: [],
        startedAt: storedEvent.createdAt,
      });
    }

    const eventSuccess = storedEvent.eventType === 'error'
      ? false
      : booleanField(dataRecord, 'success');
    observations.push({
      id: observationId,
      sequence: storedEvent.seq,
      actionId: storedEvent.eventType === 'tool_result' ? activeActionId : undefined,
      kind: storedEvent.eventType,
      success: eventSuccess,
      data,
      timestamp: storedEvent.createdAt,
    });

    if (storedEvent.eventType === 'tool_result' && activeActionId) {
      const action = actions.find((item) => item.id === activeActionId);
      if (action) {
        action.status = eventSuccess === false ? 'failed' : 'succeeded';
        action.finishedAt = storedEvent.createdAt;
      }
      activeActionId = undefined;
    }

    if (storedEvent.eventType === 'file_changed') {
      const path = stringField(dataRecord, 'path');
      if (path) {
        mutations.push({
          id: createEvidenceId(input.run.id, 'mutation', storedEvent.seq),
          path,
          operation: 'modified',
          success: eventSuccess !== false,
          overlapsUserChange: false,
          timestamp: storedEvent.createdAt,
        });
      }
    }

    if (storedEvent.eventType === 'verification_result') {
      const success = booleanField(dataRecord, 'success');
      verificationChecks.push({
        id: createEvidenceId(input.run.id, 'verification', storedEvent.seq),
        requirementIds: [],
        name: stringField(dataRecord, 'command') || 'legacy verification',
        outcome: success === true ? 'passed' : 'failed',
        summary: stringField(dataRecord, 'output'),
        timestamp: storedEvent.createdAt,
      });
    }

    if (storedEvent.eventType === 'final') {
      const text = stringField(dataRecord, 'message');
      if (text) {
        finalClaims.push({
          id: createEvidenceId(input.run.id, 'claim', storedEvent.seq),
          text,
          requirementIds: [],
          evidenceIds: [],
          support: 'unverifiable',
        });
      }
    }
  }

  const result = asRecord(input.run.result);
  const finishedAt = input.run.status === 'running' || input.run.status === 'waiting_for_user' || input.run.status === 'waiting_for_provider'
    ? undefined
    : input.run.finishedAt ?? input.run.updatedAt;
  const totalDurationMs = Math.max(0, (finishedAt ?? input.run.updatedAt) - input.run.createdAt);
  const storedMetrics = {
    taskSuccess: booleanField(result, 'success'),
    cost: numberField(result, 'pollenCost'),
    totalDurationMs,
  };

  return parseEvaluationRunRecord({
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    runId: input.run.id,
    fixture: input.fixture,
    task: {
      id: createEvidenceId(input.run.id, 'task', 0),
      request: input.run.task,
      kind: input.run.kind,
      workspace: input.run.workspace,
    },
    provider: input.run.model ? { model: input.run.model } : undefined,
    status: normalizeStoredRunStatus(input.run.status),
    startedAt: input.run.createdAt,
    finishedAt,
    requirements: [],
    actions,
    observations,
    mutations,
    verificationChecks,
    finalClaims,
    metrics: {
      ...storedMetrics,
      ...deriveEvaluationOperatingMetrics({
        startedAt: input.run.createdAt,
        actions,
        observations,
        mutations,
        verificationChecks,
        metrics: storedMetrics,
      }),
    },
    source: {
      kind: 'stored_run',
      legacyStatus: input.run.status,
      lastEventSequence: input.run.lastEventSeq,
    },
  });
}

export function parseEvaluationRunRecord(value: unknown): EvaluationRunRecord {
  return EvaluationRunRecordSchema.parse(value);
}

export function serializeEvaluationRunRecord(record: EvaluationRunRecord): string {
  return JSON.stringify(parseEvaluationRunRecord(record));
}

export function parseEvaluationRunRecordJson(value: string): EvaluationRunRecord {
  return parseEvaluationRunRecord(JSON.parse(value));
}
