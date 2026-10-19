import { describe, expect, it } from '@jest/globals';
import { createHarnessEvent } from '../harnessEvent.js';
import { projectHarnessEvents } from '../harnessProjection.js';

describe('harness event projection', () => {
  it('projects harness interventions as bounded tool evidence', () => {
    const projection = projectHarnessEvents([
      createHarnessEvent({
        runId: 'run-intervention', seq: 1, type: 'harness_intervention', timestamp: 1,
        data: {
          type: 'harness_intervention',
          gateName: 'requires_source_mutation',
          reason: 'Verification requires source mutation evidence.',
          requiredEvidence: ['A successful source mutation.'],
          targetAction: 'Bash',
          stepSeq: 4,
          toolCallId: 'call-4',
          evidenceId: 'evidence-4',
        },
      }),
    ]);

    expect(projection.timeline[0].summary).toContain('Harness intervention (requires_source_mutation)');
    expect(projection.rawEvidence).toMatchObject([
      { kind: 'tool', type: 'harness_intervention', data: expect.objectContaining({ evidenceId: 'evidence-4' }) },
    ]);
  });

  it('rebuilds timeline, state, evidence, gaps, and terminal outcome from events alone', () => {
    const events = [
      createHarnessEvent({
        runId: 'run-1', sessionId: 'session-1', seq: 1, type: 'tool_started', timestamp: 1,
        data: { type: 'tool_started', tool: 'Read', toolCallId: 'call-1', input: { file_path: 'src/app.ts' } },
      }),
      createHarnessEvent({
        runId: 'run-1', sessionId: 'session-1', seq: 3, type: 'tool_result', timestamp: 3,
        data: { type: 'tool_result', tool: 'Read', toolCallId: 'call-1', result: 'source' },
      }),
      createHarnessEvent({
        runId: 'run-1', sessionId: 'session-1', seq: 4, type: 'state', timestamp: 4,
        data: { codingState: 'verify' },
      }),
      createHarnessEvent({
        runId: 'run-1', sessionId: 'session-1', seq: 5, type: 'future.event', timestamp: 5,
        data: { opaque: true },
      }),
      createHarnessEvent({
        runId: 'run-1', sessionId: 'session-1', seq: 6, type: 'done', timestamp: 6,
        data: { success: true },
      }),
    ];

    const projection = projectHarnessEvents(events);

    expect(projection).toMatchObject({
      runId: 'run-1',
      sessionId: 'session-1',
      eventCount: 5,
      lastSeq: 6,
      contiguous: false,
      missingSequences: [2],
      duplicateSequences: [],
      latestState: { codingState: 'verify' },
      terminal: { type: 'done', data: { success: true } },
      unknownEventTypes: ['future.event'],
    });
    expect(projection.activeTools).toEqual([]);
    expect(projection.timeline.map((item) => item.summary)).toEqual(expect.arrayContaining([
      'Tool started: Read',
      'Tool result: source',
    ]));
    expect(projection.rawEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tool', type: 'tool_started' }),
      expect.objectContaining({ kind: 'tool', type: 'tool_result' }),
    ]));
  });

  it('supports a summary projection without timeline or raw evidence payloads', () => {
    const projection = projectHarnessEvents([
      createHarnessEvent({
        runId: 'run-summary', seq: 1, type: 'model_response', timestamp: 1,
        data: { message: 'visible summary', provider: 'mock', model: 'mock-model' },
      }),
      createHarnessEvent({
        runId: 'run-summary', seq: 2, type: 'tool_result', timestamp: 2,
        data: { tool: 'Read', toolCallId: 'call-1', result: 'large payload' },
      }),
    ], { includeTimeline: false, includeRawEvidence: false });

    expect(projection.eventCount).toBe(2);
    expect(projection.timeline).toEqual([]);
    expect(projection.rawEvidence).toEqual([]);
    expect(projection.replayInvariants).toBeDefined();
  });

  it('accepts a fully enclosed model step with paired mutation evidence', () => {
    const events = [
      createHarnessEvent({
        runId: 'run-valid', sessionId: 'session-valid', seq: 1, type: 'llm_request_started', timestamp: 1,
        data: { request: { requestId: 'request-1', stepId: 'step-1', status: 'started' } },
      }),
      createHarnessEvent({
        runId: 'run-valid', sessionId: 'session-valid', seq: 2, type: 'llm_request_finished', timestamp: 2,
        data: { request: { requestId: 'request-1', stepId: 'step-1', status: 'succeeded' } },
      }),
      createHarnessEvent({
        runId: 'run-valid', sessionId: 'session-valid', seq: 3, type: 'model_response', timestamp: 3,
        data: { message: 'I will update the file.', provider: 'mock', model: 'mock-model', stepId: 'step-1', requestId: 'request-1', toolCallId: 'call-1' },
      }),
      createHarnessEvent({
        runId: 'run-valid', sessionId: 'session-valid', seq: 4, type: 'tool_started', timestamp: 4,
        data: { tool: 'Write', toolCallId: 'call-1', requestId: 'request-1', stepId: 'step-1', input: { file_path: 'src/app.ts' } },
      }),
      createHarnessEvent({
        runId: 'run-valid', sessionId: 'session-valid', seq: 5, type: 'tool_evidence', timestamp: 5,
        data: { record: { id: 'evidence-1', action: 'Write', status: 'success' } },
      }),
      createHarnessEvent({
        runId: 'run-valid', sessionId: 'session-valid', seq: 6, type: 'tool_result', timestamp: 6,
        data: { tool: 'Write', toolCallId: 'call-1', requestId: 'request-1', stepId: 'step-1', evidenceId: 'evidence-1', result: '{"success":true}' },
      }),
      createHarnessEvent({
        runId: 'run-valid', sessionId: 'session-valid', seq: 7, type: 'file_changed', timestamp: 7,
        data: { path: 'src/app.ts', evidenceId: 'evidence-1' },
      }),
      createHarnessEvent({
        runId: 'run-valid', sessionId: 'session-valid', seq: 8, type: 'done', timestamp: 8,
        data: { success: true },
      }),
    ];

    const projection = projectHarnessEvents(events);

    expect(projection.replayInvariants.valid).toBe(true);
    expect(projection.replayInvariants.callResultPairing).toMatchObject({
      startedCallIds: ['call-1'],
      closedCallIds: ['call-1'],
      unmatchedCallIds: [],
    });
    expect(projection.replayInvariants.mutationEvidence).toMatchObject({
      mutationCallIds: ['call-1'],
      missingEvidenceCallIds: [],
      unresolvedEvidenceIds: [],
    });
  });

  it('surfaces sequence, enclosure, pairing, and mutation-evidence violations', () => {
    const events = [
      createHarnessEvent({
        runId: 'run-invalid', seq: 1, type: 'model_response', timestamp: 1,
        data: { message: 'Use the tool.', provider: 'mock', model: 'mock-model', stepId: 'step-1', toolCallId: 'call-1' },
      }),
      createHarnessEvent({
        runId: 'run-invalid', seq: 3, type: 'tool_started', timestamp: 3,
        data: { tool: 'Write', toolCallId: 'call-1', stepId: 'step-1' },
      }),
      createHarnessEvent({
        runId: 'run-invalid', seq: 4, type: 'tool_result', timestamp: 4,
        data: { tool: 'Write', toolCallId: 'call-1', stepId: 'step-1', result: 'missing evidence' },
      }),
      createHarnessEvent({
        runId: 'run-invalid', seq: 5, type: 'tool_result', timestamp: 5,
        data: { tool: 'Write', toolCallId: 'call-1', stepId: 'step-1', result: 'duplicate result' },
      }),
    ];

    const projection = projectHarnessEvents(events);

    expect(projection.replayInvariants.valid).toBe(false);
    expect(projection.replayInvariants.sequence).toMatchObject({ valid: false, missingSequences: [2] });
    expect(projection.replayInvariants.callResultPairing).toMatchObject({
      valid: false,
      duplicateResultCallIds: ['call-1'],
    });
    expect(projection.replayInvariants.mutationEvidence).toMatchObject({
      valid: false,
      missingEvidenceCallIds: ['call-1'],
    });
    expect(projection.replayInvariants.violations.map((item) => item.code)).toEqual(expect.arrayContaining([
      'duplicate_tool_result',
      'missing_mutation_evidence',
    ]));
  });
});
