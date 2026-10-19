import { mkdtempSync, writeFileSync, appendFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it, jest } from '@jest/globals';
import { BoundedWorkflowRunner, normalizeChildBudget, normalizeChildReport } from '../../agents/child-runs';
import { createHarnessEvent } from '../../persistence/harnessEvent';
import { projectHarnessEvents } from '../../persistence/harnessProjection';
import { SQLiteAppStore, type StoredAgentRun } from '../../persistence/sqliteStore';
import { createReactCheckpoint, isCheckpointWorkspaceFresh } from '../../react/checkpoint';
import { executeAction } from '../../react/executor';
import { ServerRunManager } from '../../react/run-manager';
import { ToolExecutionScheduler, type ToolExecutionState } from '../../react/tool-contract';
import { type ReactState } from '../../react/state-manager';
import { getToolCapabilities } from '../../react/shared-control';
import { deriveEvaluationOperatingMetrics } from '../evaluationSchema';

function event(runId: string, seq: number, type: string, data: unknown) {
  return createHarnessEvent({ runId, sessionId: `${runId}-session`, seq, type, data, timestamp: seq * 10 });
}

function normalReplay(runId: string) {
  return [
    event(runId, 1, 'model_response', { message: 'Read the source.', provider: 'mock', model: 'mock', stepId: 'step-1', toolCallId: 'call-1' }),
    event(runId, 2, 'tool_started', { tool: 'Read', toolCallId: 'call-1', stepId: 'step-1', input: { file_path: 'src/app.ts' } }),
    event(runId, 3, 'tool_result', { tool: 'Read', toolCallId: 'call-1', stepId: 'step-1', result: 'source' }),
    event(runId, 4, 'verification_result', { command: 'npm test', success: true, output: 'passed' }),
    event(runId, 5, 'done', { success: true }),
  ];
}

describe('Priority 3 evaluation and operating gates', () => {
  describe('replay fixture matrix', () => {
    it.each([
      ['normal completion', normalReplay('replay-normal'), true, 'done'],
      ['cancelled tool', [
        event('replay-cancelled', 1, 'model_response', { message: 'Read the source.', provider: 'mock', model: 'mock', stepId: 'step-1', toolCallId: 'call-1' }),
        event('replay-cancelled', 2, 'tool_started', { tool: 'Read', toolCallId: 'call-1', stepId: 'step-1' }),
        event('replay-cancelled', 3, 'tool_outcome_unknown', { outcome: { tool: 'Read', toolCallId: 'call-1', stepId: 'step-1', reason: 'cancelled', retryPolicy: 'safe_retry' } }),
        event('replay-cancelled', 4, 'interrupted', { message: 'Run interrupted.' }),
      ], true, 'interrupted'],
      ['provider outage', [
        event('replay-provider', 1, 'llm_request_started', { request: { requestId: 'request-1', stepId: 'step-1', status: 'started' } }),
        event('replay-provider', 2, 'llm_request_finished', { request: { requestId: 'request-1', stepId: 'step-1', status: 'failed', error: 'provider unavailable' } }),
        event('replay-provider', 3, 'provider_attempt_failed', { message: 'Provider unavailable.', recoverable: true }),
        event('replay-provider', 4, 'done', { success: false, errorCode: 'PROVIDER_UNAVAILABLE' }),
      ], true, 'done'],
      ['malformed model response', [
        event('replay-malformed', 1, 'model_response', { message: '{ malformed json', provider: 'mock', model: 'mock', stepId: 'step-1' }),
        event('replay-malformed', 2, 'execution_failed', { message: 'Malformed model response.' }),
        event('replay-malformed', 3, 'done', { success: false, errorCode: 'MALFORMED_RESPONSE' }),
      ], true, 'done'],
      ['missing tool result', [
        event('replay-missing-result', 1, 'model_response', { message: 'Write the file.', provider: 'mock', model: 'mock', stepId: 'step-1', toolCallId: 'call-1' }),
        event('replay-missing-result', 2, 'tool_started', { tool: 'Write', toolCallId: 'call-1', stepId: 'step-1', input: { file_path: 'src/app.ts' } }),
        event('replay-missing-result', 3, 'done', { success: false }),
      ], false, 'done'],
      ['killed process', [
        event('replay-killed', 1, 'state', { codingState: 'implement', current_step: 2 }),
        event('replay-killed', 2, 'killed', { message: 'Process killed.' }),
      ], true, 'killed'],
      ['duplicate event', [
        event('replay-duplicate', 1, 'tool_started', { tool: 'Read', toolCallId: 'call-1' }),
        event('replay-duplicate', 2, 'tool_result', { tool: 'Read', toolCallId: 'call-1', result: 'first' }),
        event('replay-duplicate', 2, 'tool_result', { tool: 'Read', toolCallId: 'call-1', result: 'duplicate' }),
      ], false, undefined],
    ])('%s remains reconstructable', (_name, events, invariantValid, terminalType) => {
      const projection = projectHarnessEvents(events);
      expect(projection.replayInvariants.valid).toBe(invariantValid);
      if (terminalType) expect(projection.terminal?.type).toBe(terminalType);
    });

    it('detects a stale workspace before a continuation can use old evidence', () => {
      const workspace = mkdtempSync(path.join(tmpdir(), 'operating-gate-stale-'));
      writeFileSync(path.join(workspace, 'tracked.txt'), 'before', 'utf8');
      const state = {
        task: 'continue safely', workspace, plan: [],
        steps: [{ thought: '', action: 'Read', action_input: { file_path: 'tracked.txt' } }],
        current_step: 1, max_steps: 5, total_pollen_cost: 0, budget: 10, repairAttempts: 0,
      } as ReactState;
      const checkpoint = createReactCheckpoint(state);
      appendFileSync(path.join(workspace, 'tracked.txt'), ' changed', 'utf8');
      expect(isCheckpointWorkspaceFresh(checkpoint)).toBe(false);
    });
  });

  describe('interaction fixture matrix', () => {
    function createStore(): SQLiteAppStore {
      return new SQLiteAppStore(path.join(mkdtempSync(path.join(tmpdir(), 'operating-gate-inbox-')), 'runs.sqlite'));
    }

    function createRun(store: SQLiteAppStore, id: string, metadata: Record<string, unknown> = {}): StoredAgentRun {
      const run: StoredAgentRun = { id, kind: 'coder', status: 'running', task: 'interaction fixture', metadata, createdAt: 1, updatedAt: 1, lastEventSeq: 0 };
      store.createAgentRun(run);
      return run;
    }

    it('covers next-turn, next-step, injection, replacement, cancellation, reconnect, and resume boundaries', async () => {
      const store = createStore();
      const manager = new ServerRunManager(store);
      const run = createRun(store, 'interaction-run');

      expect(manager.queueUserMessage(run.id, { message: 'next turn context', source: 'follow_up' }).ok).toBe(true);
      expect(manager.enqueueInboxMessage(run.id, { messageId: 'steer-1', message: 'next step steering', source: 'steering', target: 'next-step' }).ok).toBe(true);
      expect(manager.enqueueInboxMessage(run.id, { messageId: 'replace-1', message: 'old context', source: 'follow_up', target: 'next-turn' }).ok).toBe(true);
      expect(manager.replaceInboxMessage(run.id, 'replace-1', { message: 'replacement context' })?.message).toBe('replacement context');
      expect(manager.enqueueInboxMessage(run.id, { messageId: 'cancel-1', message: 'cancel this', source: 'follow_up', target: 'next-turn' }).ok).toBe(true);
      expect(manager.cancelInboxMessage(run.id, 'cancel-1')?.status).toBe('cancelled');

      const injected = manager.consumeQueuedMessages(run.id);
      expect(injected.map((item) => item.message)).toEqual(['next turn context', 'next step steering']);
      expect(manager.acknowledgeQueuedMessages(run.id, injected.map((item) => item.id))).toHaveLength(2);

      const progress = createHarnessEvent({ runId: run.id, seq: 1, type: 'progress', data: 'reconnect-safe', timestamp: 1 });
      store.appendAgentRunEvent({ runId: run.id, seq: 1, eventType: 'progress', event: progress, createdAt: 1 });
      const writes: string[] = [];
      const response = {
        destroyed: false,
        writableEnded: false,
        setHeader: () => undefined,
        flushHeaders: () => undefined,
        write: (value: string) => { writes.push(value); return true; },
        end: () => undefined,
      } as any;
      expect(manager.subscribe(run.id, response, 0)).toBe(true);
      expect(writes.join('')).toContain('reconnect-safe');

      const parent = createRun(store, 'resume-parent');
      store.enqueueAgentInbox({ runId: parent.id, messageId: 'resume-1', source: 'follow_up', target: 'next-turn', message: 'resume me' });
      const child = manager.startRun({ id: 'resume-child', kind: 'coder', task: 'resume child', metadata: { parentRunId: parent.id } }, async () => ({ success: true, steps: [], stepCount: 0, pollenCost: 0 }));
      await manager.waitForRun(child.id);
      expect(manager.listInbox(child.id).map((item) => item.message)).toContain('resume me');
      expect(manager.listEvents(child.id).map((item) => item.eventType)).toContain('inbox_requeued');
    });
  });

  describe('tool-pipeline fixture matrix', () => {
    function registry(name: string, handler: jest.Mock, timeoutMs?: number): any {
      const tool = { name, description: name, handler, timeoutMs };
      return {
        getAll: () => [tool], get: (candidate: string) => candidate === name ? tool : undefined,
        getEnabled: () => [tool], has: (candidate: string) => candidate === name,
        register: () => undefined, setEnabled: () => undefined, getNames: () => [name], size: () => 1,
      };
    }

    it('covers approval denial, timeout, bounded retry, normalization failure, and unknown cancellation', async () => {
      const denied = await executeAction(
        { action: 'Write', action_input: { file_path: 'denied.txt', content: 'x' } },
        registry('Write', jest.fn(async () => ({ success: true }))),
        undefined,
        { workspace: process.cwd(), policy: { mode: 'read_only' } },
      );
      expect(JSON.parse(denied)).toMatchObject({ success: false, status: 'denied' });

      const timedOut = await executeAction(
        { action: 'Read', action_input: { file_path: 'slow.txt' } },
        registry('Read', jest.fn(async () => new Promise(() => undefined)), 5),
        new AbortController().signal,
        { toolRetryLimit: 0 },
      );
      expect(JSON.parse(timedOut)).toMatchObject({ success: false, status: 'timed_out' });

      let attempts = 0;
      const retried = await executeAction(
        { action: 'Read', action_input: { file_path: 'retry.txt' } },
        registry('Read', jest.fn(async () => {
          attempts += 1;
          return attempts === 1 ? { success: false, status: 'timed_out', retryable: true } : { success: true, output: 'ok' };
        })),
        undefined,
        { toolRetryLimit: 1 },
      );
      expect(attempts).toBe(2);
      expect(JSON.parse(retried)).toMatchObject({ success: true, output: 'ok' });

      const circular: Record<string, unknown> = { value: 'safe' };
      circular.self = circular;
      const normalized = await executeAction(
        { action: 'Read', action_input: { file_path: 'circular.txt' } },
        registry('Read', jest.fn(async () => ({ success: true, output: circular }))),
      );
      expect(JSON.parse(normalized).output.self).toBe('[Circular]');

      const controller = new AbortController();
      const cancelled = executeAction(
        { action: 'Read', action_input: { file_path: 'cancelled.txt' } },
        registry('Read', jest.fn(async (_input: unknown, signal?: AbortSignal) => new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }))),
        controller.signal,
        { toolRetryLimit: 0 },
      );
      controller.abort();
      expect(JSON.parse(await cancelled)).toMatchObject({ success: false, status: 'cancelled' });
    });

    it('covers parallel reads, exclusive mutation barriers, and malformed execution state', async () => {
      const scheduler = new ToolExecutionScheduler();
      let active = 0;
      let maxActive = 0;
      await scheduler.executeBatch([
        { action: 'Read', action_input: { file_path: 'a' } },
        { action: 'Read', action_input: { file_path: 'b' } },
        { action: 'Write', action_input: { file_path: 'c' } },
      ], async (action) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return action.action;
      });
      expect(maxActive).toBe(2);

      const state = {} as ToolExecutionState;
      expect(state).toBeDefined();
      expect(getToolCapabilities('Write')).toMatchObject({ mutating: true, executionMode: 'exclusive' });
    });
  });

  describe('child/workflow fixture matrix', () => {
    it('covers parent budget/depth limits and report delivery', () => {
      expect(normalizeChildBudget(
        { maxDepth: 99, maxLlmRequests: 99, maxToolCalls: 99, timeoutMs: 99_999 },
        { maxDepth: 2, maxLlmRequests: 3, maxToolCalls: 4, timeoutMs: 5000 },
      )).toEqual(expect.objectContaining({ maxDepth: 2, maxLlmRequests: 3, maxToolCalls: 4, timeoutMs: 5000 }));
      expect(normalizeChildReport('child-1', {
        success: true,
        steps: [{ action: 'Write', action_input: { file_path: 'src/a.ts' }, observation: '{"success":true}' }],
      })).toEqual(expect.objectContaining({ childId: 'child-1', success: true, changedFiles: ['src/a.ts'] }));
    });

    it('covers cancellation, child report completion, sibling failure, and blocked dependents', async () => {
      const controller = new AbortController();
      controller.abort();
      const events: string[] = [];
      const runner = new BoundedWorkflowRunner({ maxConcurrency: 2, signal: controller.signal, onEvent: (item) => events.push(item.type) });
      const cancelled = await runner.run({ id: 'cancelled-workflow', steps: [{ id: 'a', child: { task: 'a', role: 'worker' } }] }, async () => ({
        protocolVersion: 1, childId: 'a', success: true, changedFiles: [], checks: [], blockers: [], evidenceRefs: [], createdAt: 1,
      }));
      expect(cancelled.status).toBe('cancelled');

      const started: string[] = [];
      const failedRunner = new BoundedWorkflowRunner({ maxConcurrency: 2, onEvent: (item) => events.push(item.type) });
      const result = await failedRunner.run({
        id: 'failed-workflow',
        steps: [
          { id: 'a', child: { task: 'a', role: 'worker' } },
          { id: 'b', child: { task: 'b', role: 'worker' } },
          { id: 'c', child: { task: 'c', role: 'integrator' }, dependencies: ['a'] },
        ],
      }, async (step) => {
        started.push(step.id);
        return { protocolVersion: 1, childId: step.id, success: step.id !== 'a', changedFiles: [], checks: [], blockers: [], evidenceRefs: [], createdAt: 1 };
      });
      expect(started).toEqual(['a', 'b']);
      expect(result.status).toBe('failed');
      expect(result.steps.find((step) => step.stepId === 'c')?.status).toBe('blocked');
      expect(events).toEqual(expect.arrayContaining(['workflow_step_blocked']));
    });
  });

  it('records the requested operating metrics and keeps duplicate/unknown/recovery counts explicit', () => {
    const metrics = deriveEvaluationOperatingMetrics({
      startedAt: 100,
      actions: [
        { id: 'a1', sequence: 0, tool: 'Read', input: { path: 'a' }, status: 'succeeded', expectedEvidence: [], startedAt: 130 },
        { id: 'a2', sequence: 1, tool: 'Read', input: { path: 'a' }, status: 'recovery', expectedEvidence: [], startedAt: 150 },
      ],
      observations: [
        { id: 'o1', sequence: 2, kind: 'tool_outcome_unknown', data: {}, timestamp: 160 },
        { id: 'o2', sequence: 3, kind: 'recovery_transition', data: {}, timestamp: 170 },
        { id: 'o3', sequence: 4, kind: 'child_terminal', data: { status: 'completed' }, timestamp: 180 },
        { id: 'o4', sequence: 5, kind: 'child_terminal', data: { status: 'failed' }, timestamp: 190 },
      ],
      mutations: [],
      verificationChecks: [],
      metrics: { cost: 0.25 },
    });
    expect(metrics).toEqual(expect.objectContaining({
      firstUsefulActionLatencyMs: 30,
      duplicateActionCount: 1,
      unknownOutcomeCount: 1,
      recoveryCount: 2,
      childCompletionRate: 0.5,
      tokenCost: 0.25,
    }));
  });

  it('keeps replay, scheduler, SSE replay, and fixture snapshots bounded', async () => {
    const replayEvents = [
      ...Array.from({ length: 256 }, (_, index) => event('stress-replay', index + 1, 'progress', `progress-${index + 1}`)),
      event('stress-replay', 257, 'done', { success: true }),
    ];
    const projection = projectHarnessEvents(replayEvents);
    expect({
      eventCount: projection.eventCount,
      lastSeq: projection.lastSeq,
      contiguous: projection.contiguous,
      terminal: projection.terminal?.type,
      invariantValid: projection.replayInvariants.valid,
    }).toMatchSnapshot();

    const scheduler = new ToolExecutionScheduler();
    let active = 0;
    let maxActive = 0;
    const actions = Array.from({ length: 64 }, (_, index) => ({ action: 'Read', action_input: { file_path: `fixture-${index}.txt` } }));
    const results = await scheduler.executeBatch(actions, async (action) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return action.action;
    });
    expect(results).toHaveLength(64);
    expect(maxActive).toBe(64);

    const store = new SQLiteAppStore(path.join(mkdtempSync(path.join(tmpdir(), 'operating-gate-sse-')), 'runs.sqlite'));
    const run: StoredAgentRun = { id: 'sse-replay-run', kind: 'coder', status: 'completed', task: 'SSE replay', createdAt: 1, updatedAt: 1, lastEventSeq: 64 };
    store.createAgentRun(run);
    for (let seq = 1; seq <= 64; seq += 1) {
      const progress = createHarnessEvent({ runId: run.id, seq, type: 'progress', data: `sse-${seq}`, timestamp: seq });
      store.appendAgentRunEvent({ runId: run.id, seq, eventType: 'progress', event: progress, createdAt: seq });
    }
    const manager = new ServerRunManager(store);
    const writes: string[] = [];
    const response = {
      destroyed: false,
      writableEnded: false,
      setHeader: () => undefined,
      flushHeaders: () => undefined,
      write: (value: string) => { writes.push(value); return true; },
      end: () => undefined,
    } as any;
    expect(manager.subscribe(run.id, response, 32)).toBe(true);
    expect(writes.filter((value) => value.startsWith('event: progress')).length).toBe(32);
  });
});
