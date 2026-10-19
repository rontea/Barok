import { describe, expect, it } from '@jest/globals';
import { createHarnessEvent } from '../harnessEvent.js';
import { createUnknownRequestEnvelope, createUnknownToolOutcome, findUnfinishedModelRequests, findUnfinishedToolCalls } from '../toolLifecycle.js';
import { createReactCheckpoint } from '../../react/checkpoint.js';
import { ServerRunManager } from '../../react/run-manager.js';
import { SQLiteAppStore, type StoredAgentRun } from '../sqliteStore.js';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

describe('tool lifecycle repair', () => {
  it('finds model requests without a terminal envelope and creates an explicit unknown repair', () => {
    const requests = findUnfinishedModelRequests([
      {
        eventType: 'llm_request_started',
        event: { timestamp: 100, data: { request: { requestId: 'request-1', stepId: 'step-1', status: 'started' } } },
      },
      {
        eventType: 'llm_request_started',
        event: { timestamp: 101, data: { request: { requestId: 'request-2', status: 'started' } } },
      },
      {
        eventType: 'llm_request_finished',
        event: { timestamp: 110, data: { request: { requestId: 'request-2', status: 'failed' } } },
      },
    ]);

    expect(requests).toEqual([expect.objectContaining({ requestId: 'request-1', stepId: 'step-1', startedAt: 100 })]);
    expect(createUnknownRequestEnvelope(requests[0], 'process stopped', 120)).toMatchObject({
      requestId: 'request-1',
      stepId: 'step-1',
      status: 'unknown',
      completedAt: 120,
      durationMs: 20,
      error: 'process stopped',
    });
  });

  it('finds only started calls without a result or prior repair', () => {
    const events = [
      {
        eventType: 'tool_started',
        event: {
          timestamp: 100,
          data: { type: 'tool_started', tool: 'Write', toolCallId: 'call-1', input: { file_path: 'a.ts' } },
        },
      },
      {
        eventType: 'tool_result',
        event: {
          timestamp: 110,
          data: { type: 'tool_result', tool: 'Read', toolCallId: 'call-2', result: 'ok' },
        },
      },
      {
        eventType: 'tool_outcome_unknown',
        event: {
          timestamp: 120,
          data: {
            type: 'tool_outcome_unknown',
            outcome: { toolCallId: 'call-3', tool: 'Bash', repairedAt: 120, reason: 'repaired', retryPolicy: 'verify_before_retry' },
          },
        },
      },
    ];

    expect(findUnfinishedToolCalls(events)).toEqual([
      expect.objectContaining({
        toolCallId: 'call-1',
        tool: 'Write',
        input: { file_path: 'a.ts' },
        startedAt: 100,
      }),
    ]);
  });

  it('repairs an interrupted run and carries the unknown outcome into its checkpoint', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'tool-repair-'));
    const store = new SQLiteAppStore(path.join(workspace, 'runs.sqlite'));
    const manager = new ServerRunManager(store);
    const runId = 'run-unknown-tool';
    const checkpoint = createReactCheckpoint({
      task: 'repair the app',
      workspace,
      plan: [{ step: 'Implement the repair', status: 'in_progress' }],
      steps: [],
      current_step: 0,
      max_steps: 10,
      total_pollen_cost: 0,
      budget: 100,
      repairAttempts: 0,
    } as any);
    const now = Date.now();
    const run: StoredAgentRun = {
      id: runId,
      kind: 'react',
      status: 'running',
      task: 'repair the app',
      workspace,
      metadata: { checkpoint },
      createdAt: now,
      updatedAt: now,
      lastEventSeq: 0,
    };
    store.createAgentRun(run);
    const event = createHarnessEvent({
      runId,
      seq: 1,
      type: 'tool_started',
      timestamp: 100,
      data: {
        type: 'tool_started',
        tool: 'Write',
        toolCallId: 'call-1',
        stepId: 'step-1',
        input: { file_path: 'src/app.ts' },
      },
    });
    store.appendAgentRunEvent({ runId, seq: 1, eventType: 'tool_started', event, createdAt: 100 });

    manager.recoverActiveRuns('Server crashed.');
    manager.recoverActiveRuns('Server restarted again.');

    const repairedRun = store.getAgentRun(runId);
    const repairedEvents = manager.listEvents(runId);
    const repairedCheckpoint = manager.getCheckpoint(runId);
    const repairedUnknown = repairedEvents.find((event) => event.eventType === 'tool_outcome_unknown');
    expect(repairedRun?.status).toBe('interrupted');
    expect(repairedEvents.filter((event) => event.eventType === 'tool_outcome_unknown')).toHaveLength(1);
    expect(repairedEvents.at(-1)?.eventType).toBe('interrupted');
    expect(repairedUnknown?.event.data).toMatchObject({
      type: 'tool_outcome_unknown',
      outcome: {
        toolCallId: 'call-1',
        tool: 'Write',
        retryPolicy: 'verify_before_retry',
      },
    });
    expect(repairedCheckpoint?.state.uncertainToolCalls).toEqual([
      expect.objectContaining({ toolCallId: 'call-1', tool: 'Write' }),
    ]);
    expect(repairedCheckpoint?.state.steps.at(-1)).toMatchObject({ action: 'ToolOutcomeUnknown' });
    expect(manager.projectEvents(runId).replayInvariants).toMatchObject({
      valid: false,
      callResultPairing: { valid: true, unmatchedCallIds: [] },
    });
  });

  it('repairs an open model request before marking the run interrupted', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'request-repair-'));
    const store = new SQLiteAppStore(path.join(workspace, 'runs.sqlite'));
    const manager = new ServerRunManager(store);
    const runId = 'run-unknown-request';
    const now = Date.now();
    store.createAgentRun({
      id: runId,
      kind: 'react',
      status: 'running',
      task: 'repair the request',
      workspace,
      createdAt: now,
      updatedAt: now,
      lastEventSeq: 0,
    });
    const event = createHarnessEvent({
      runId,
      seq: 1,
      type: 'llm_request_started',
      timestamp: 100,
      data: { request: { requestId: 'request-1', stepId: 'step-1', status: 'started' } },
    });
    store.appendAgentRunEvent({ runId, seq: 1, eventType: 'llm_request_started', event, createdAt: 100 });

    manager.recoverActiveRuns('Server crashed.');

    const repaired = manager.listEvents(runId);
    expect(store.getAgentRun(runId)?.status).toBe('interrupted');
    const repairedRequest = repaired.find((event) => event.eventType === 'llm_request_finished');
    expect(repaired.at(-1)?.eventType).toBe('interrupted');
    expect(repairedRequest?.event.data).toMatchObject({ request: { requestId: 'request-1', status: 'unknown' } });
    expect(manager.projectEvents(runId).replayInvariants.requestPairing).toMatchObject({
      valid: true,
      openRequestIds: [],
    });
  });

  it('marks repaired outcomes with verify-before-retry policy', () => {
    const outcome = createUnknownToolOutcome({
      toolCallId: 'call-1',
      tool: 'PackageInstall',
      repairedAt: 0,
      reason: '',
      retryPolicy: 'verify_before_retry',
    }, 'interrupted', 123);
    expect(outcome).toMatchObject({
      repairedAt: 123,
      reason: 'interrupted',
      retryPolicy: 'verify_before_retry',
    });
  });
});
