import { describe, expect, it } from '@jest/globals';
import type { StoredAgentRun, StoredAgentRunEvent } from '../../persistence/sqliteStore';
import {
  CheckOutcomeSchema,
  EVALUATION_SCHEMA_VERSION,
  EvaluationTerminalStatusSchema,
  adaptStoredRunToEvaluationRecord,
  createEvidenceId,
  normalizeStoredRunStatus,
  parseEvaluationRunRecord,
  parseEvaluationRunRecordJson,
  serializeEvaluationRunRecord,
} from '../evaluationSchema';

function createValidRecord() {
  return {
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    runId: 'run-1',
    fixture: {
      id: 'fixture-feature',
      version: '1.0.0',
      workspaceFingerprint: 'workspace-sha256',
      runtimeVersion: '1.0.0',
      providerAdapter: 'mock',
      randomSeed: 7,
    },
    task: {
      id: 'task-1',
      request: 'Implement the feature and verify it.',
      kind: 'new_feature',
      workspace: 'C:/workspace',
      contractVersion: '1',
    },
    provider: { name: 'mock', model: 'mock-tools' },
    status: 'completed',
    startedAt: 100,
    finishedAt: 200,
    requirements: [{
      id: 'requirement-1',
      text: 'Feature is implemented.',
      status: 'satisfied',
      evidenceIds: ['mutation-1', 'verification-1'],
    }],
    actions: [{
      id: 'action-1',
      sequence: 1,
      tool: 'Edit',
      input: { file_path: 'src/feature.ts' },
      status: 'succeeded',
      expectedEvidence: ['source mutation'],
      startedAt: 120,
      finishedAt: 130,
    }],
    observations: [{
      id: 'observation-1',
      sequence: 2,
      actionId: 'action-1',
      kind: 'tool_result',
      success: true,
      data: { success: true },
      timestamp: 130,
    }],
    mutations: [{
      id: 'mutation-1',
      actionId: 'action-1',
      path: 'src/feature.ts',
      operation: 'modified',
      success: true,
      beforeHash: 'a'.repeat(64),
      afterHash: 'b'.repeat(64),
      overlapsUserChange: false,
      timestamp: 130,
    }],
    verificationChecks: [{
      id: 'verification-1',
      requirementIds: ['requirement-1'],
      name: 'unit tests',
      outcome: 'passed',
      summary: 'All targeted tests passed.',
      timestamp: 180,
    }],
    finalClaims: [{
      id: 'claim-1',
      text: 'Implemented and verified the feature.',
      requirementIds: ['requirement-1'],
      evidenceIds: ['mutation-1', 'verification-1'],
      support: 'supported',
    }],
    metrics: {
      taskSuccess: true,
      falseCompletion: false,
      validToolCallRate: 1,
      repeatedActions: 0,
      firstMutationLatencyMs: 30,
      verificationCoverage: 1,
      cost: 0,
      totalDurationMs: 100,
    },
    source: { kind: 'evaluation', lastEventSequence: 3 },
  } as const;
}

describe('evaluation schema', () => {
  it('parses a complete evidence-linked record', () => {
    const record = parseEvaluationRunRecord(createValidRecord());

    expect(record.schemaVersion).toBe(1);
    expect(record.task.id).toBe('task-1');
    expect(record.status).toBe('completed');
    expect(record.finalClaims[0].support).toBe('supported');
  });

  it('round-trips through the serialized representation', () => {
    const record = parseEvaluationRunRecord(createValidRecord());
    const serialized = serializeEvaluationRunRecord(record);

    expect(parseEvaluationRunRecordJson(serialized)).toEqual(record);
  });

  it('rejects duplicate evidence IDs across record categories', () => {
    const input = createValidRecord() as any;
    input.observations[0].id = 'action-1';

    expect(() => parseEvaluationRunRecord(input)).toThrow('Duplicate evidence ID: action-1');
  });

  it('rejects missing action, requirement, and supporting-evidence references', () => {
    const input = createValidRecord() as any;
    input.observations[0].actionId = 'missing-action';
    input.verificationChecks[0].requirementIds = ['missing-requirement'];
    input.finalClaims[0].evidenceIds = ['claim-1'];

    expect(() => parseEvaluationRunRecord(input)).toThrow('references missing');
  });

  it('requires valid terminal timestamps and bounded metrics', () => {
    const missingFinish = createValidRecord() as any;
    delete missingFinish.finishedAt;
    expect(() => parseEvaluationRunRecord(missingFinish)).toThrow('requires finishedAt');

    const invalidOrder = createValidRecord() as any;
    invalidOrder.finishedAt = 99;
    expect(() => parseEvaluationRunRecord(invalidOrder)).toThrow('cannot be earlier');

    const invalidRate = createValidRecord() as any;
    invalidRate.metrics.validToolCallRate = 1.1;
    expect(() => parseEvaluationRunRecord(invalidRate)).toThrow();
  });

  it('defines the complete terminal and check outcome vocabularies', () => {
    for (const status of ['completed', 'failed', 'blocked', 'stopped', 'cancelled', 'timed_out', 'crashed']) {
      expect(EvaluationTerminalStatusSchema.parse(status)).toBe(status);
    }
    for (const outcome of ['passed', 'failed', 'unavailable', 'skipped', 'cancelled', 'timed_out']) {
      expect(CheckOutcomeSchema.parse(outcome)).toBe(outcome);
    }
    expect(CheckOutcomeSchema.safeParse('success').success).toBe(false);
  });
});

describe('stored run compatibility adapter', () => {
  function createStoredRun(status: StoredAgentRun['status'] = 'completed'): StoredAgentRun {
    return {
      id: 'stored-run-1',
      kind: 'coder',
      status,
      task: 'Fix the greeting and verify it.',
      workspace: 'C:/workspace',
      model: 'mock-model',
      createdAt: 100,
      updatedAt: 220,
      finishedAt: status === 'running' ? undefined : 220,
      result: { success: status === 'completed', pollenCost: 3 },
      lastEventSeq: 5,
    };
  }

  function event(seq: number, eventType: string, data: unknown): StoredAgentRunEvent {
    return {
      runId: 'stored-run-1',
      seq,
      eventType,
      event: {
        runId: 'stored-run-1',
        seq,
        type: eventType,
        data,
        timestamp: 100 + seq,
      },
      createdAt: 100 + seq,
    };
  }

  const fixture = {
    id: 'stored-run-fixture',
    version: '1.0.0',
    workspaceFingerprint: 'workspace-fingerprint',
    runtimeVersion: '1.0.0',
    providerAdapter: 'legacy',
  };

  it('adapts current stored runs and events without mutating them', () => {
    const run = createStoredRun();
    const events = [
      event(1, 'tool_started', { tool: 'Edit', input: { file_path: 'src/a.ts' } }),
      event(2, 'tool_result', { success: true, output: 'changed' }),
      event(3, 'file_changed', { path: 'src/a.ts', success: true }),
      event(4, 'verification_result', { success: true, output: 'tests passed' }),
      event(5, 'final', { message: 'Fixed and verified the greeting.' }),
    ];
    const originalRun = structuredClone(run);
    const originalEvents = structuredClone(events);

    const record = adaptStoredRunToEvaluationRecord({ run, events, fixture });

    expect(record.status).toBe('completed');
    expect(record.task.id).toBe('stored-run-1:task:0');
    expect(record.actions).toHaveLength(1);
    expect(record.actions[0].status).toBe('succeeded');
    expect(record.observations).toHaveLength(5);
    expect(record.mutations[0].path).toBe('src/a.ts');
    expect(record.verificationChecks[0].outcome).toBe('passed');
    expect(record.finalClaims[0]).toMatchObject({
      text: 'Fixed and verified the greeting.',
      support: 'unverifiable',
    });
    expect(record.metrics).toMatchObject({ taskSuccess: true, cost: 3, totalDurationMs: 120 });
    expect(run).toEqual(originalRun);
    expect(events).toEqual(originalEvents);
  });

  it('maps interrupted legacy runs to crashed and leaves active runs running', () => {
    const interrupted = adaptStoredRunToEvaluationRecord({
      run: createStoredRun('interrupted'),
      events: [],
      fixture,
    });
    const running = adaptStoredRunToEvaluationRecord({
      run: createStoredRun('running'),
      events: [],
      fixture,
    });

    expect(interrupted.status).toBe('crashed');
    expect(interrupted.finishedAt).toBe(220);
    expect(running.status).toBe('running');
    expect(running.finishedAt).toBeUndefined();
  });

  it('creates deterministic evidence IDs and status mappings', () => {
    expect(createEvidenceId('run', 'action', 2)).toBe('run:action:2');
    expect(normalizeStoredRunStatus('stopped')).toBe('stopped');
    expect(normalizeStoredRunStatus('interrupted')).toBe('crashed');
  });
});
