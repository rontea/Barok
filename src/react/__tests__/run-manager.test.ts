import { EventEmitter } from 'events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it, jest } from '@jest/globals';
import { SQLiteAppStore } from '../../persistence/sqliteStore';
import { createHarnessEvent } from '../../persistence/harnessEvent';
import { ServerRunManager } from '../run-manager';
import { createReactCheckpoint } from '../checkpoint';
import { createReactContextSnapshot } from '../context-snapshot';
import { createContinuationHandoff } from '../continuation';
import { createCapabilityScope } from '../capability-scope';

function createStore(): SQLiteAppStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'react-engine-runs-'));
  return new SQLiteAppStore(path.join(dir, 'runs.sqlite'));
}

function createMockSseResponse() {
  const emitter = new EventEmitter();
  const writes: string[] = [];
  const response = {
    writes,
    destroyed: false,
    writableEnded: false,
    setHeader: () => undefined,
    flushHeaders: () => undefined,
    write: (value: string) => {
      writes.push(value);
      return true;
    },
    end: () => {
      response.writableEnded = true;
      return response;
    },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      emitter.on(event, listener);
      return response;
    },
    emitClose: () => emitter.emit('close'),
  };
  return response;
}

async function waitForStatus(manager: ServerRunManager, runId: string, status: string) {
  for (let i = 0; i < 40; i += 1) {
    const run = manager.getRun(runId);
    if (run?.status === status) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${status}`);
}

describe('ServerRunManager', () => {
  it('finds a failed Coder attempt with a successful mutation for same-thread retry deduplication', () => {
    const store = createStore();
    const manager = new ServerRunManager(store);
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-equivalent-run-'));
    const checkpoint = createReactCheckpoint({
      task: 'Build the page',
      workspace,
      plan: [{ step: 'Write the page', status: 'completed' }],
      steps: [{
        action: 'Write',
        action_input: { file_path: 'index.html', content: '<!doctype html>' },
        observation: '{"success":true}',
      }],
      current_step: 1,
      max_steps: 10,
      total_pollen_cost: 0,
      budget: 100,
      repairAttempts: 0,
    } as any);
    store.createAgentRun({
      id: 'failed-after-write',
      kind: 'coder',
      threadId: 'coder-thread-1',
      status: 'failed',
      task: checkpoint.state.task,
      workspace,
      model: 'model-a',
      metadata: { displayTask: 'Build the page', checkpoint },
      createdAt: 1,
      updatedAt: 20,
      lastEventSeq: 0,
    });

    expect(manager.findEquivalentCoderRun({
      threadId: 'coder-thread-1',
      workspace: `${workspace}\\`,
      displayTask: '  Build   the page ',
    })).toEqual(expect.objectContaining({ id: 'failed-after-write' }));
    expect(manager.findEquivalentCoderRun({
      threadId: 'coder-thread-1',
      workspace,
      displayTask: 'Build a different page',
    })).toBeNull();

    store.updateAgentRun({
      id: 'failed-after-write',
      status: 'completed',
      result: { success: false, executionCompleted: true, verificationStatus: 'failed' },
    });
    expect(manager.findEquivalentCoderRun({
      threadId: 'coder-thread-1',
      workspace,
      displayTask: 'Build the page',
    })).toEqual(expect.objectContaining({ id: 'failed-after-write', status: 'completed' }));
  });

  it('does not deduplicate a terminal run that never completed a Write or Edit', () => {
    const store = createStore();
    const manager = new ServerRunManager(store);
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-equivalent-read-'));
    const checkpoint = createReactCheckpoint({
      task: 'Inspect the page',
      workspace,
      plan: [{ step: 'Inspect the page', status: 'in_progress' }],
      steps: [{
        action: 'Read',
        action_input: { file_path: 'index.html' },
        observation: '{"success":true}',
      }],
      current_step: 1,
      max_steps: 10,
      total_pollen_cost: 0,
      budget: 100,
      repairAttempts: 0,
    } as any);
    store.createAgentRun({
      id: 'failed-before-write',
      kind: 'coder',
      threadId: 'coder-thread-2',
      status: 'failed',
      task: checkpoint.state.task,
      workspace,
      metadata: { displayTask: 'Inspect the page', checkpoint },
      createdAt: 1,
      updatedAt: 20,
      lastEventSeq: 0,
    });

    expect(manager.findEquivalentCoderRun({
      threadId: 'coder-thread-2',
      workspace,
      displayTask: 'Inspect the page',
    })).toBeNull();
  });

  it('does not mark persisted active runs interrupted when a manager is constructed', () => {
    const store = createStore();
    store.createAgentRun({
      id: 'active-before-manager-construction',
      kind: 'coder',
      status: 'waiting_for_provider',
      task: 'preserve this active run',
      createdAt: 1,
      updatedAt: 1,
      lastEventSeq: 0,
    });

    const manager = new ServerRunManager(store);
    expect(manager.getRun('active-before-manager-construction')?.status).toBe('waiting_for_provider');

    manager.recoverActiveRuns('Explicit startup recovery');
    expect(manager.getRun('active-before-manager-construction')).toEqual(expect.objectContaining({
      status: 'interrupted',
      stopReason: 'Explicit startup recovery',
    }));
  });

  it('reports an active provider request and marks its deadline outcome unknown', () => {
    const store = createStore();
    const manager = new ServerRunManager(store);
    const runId = 'provider-liveness-run';
    const now = Date.now();
    const startedAt = now - 30_000;
    const deadlineAt = startedAt + 20_000;
    store.createAgentRun({
      id: runId,
      kind: 'coder',
      status: 'running',
      task: 'observe a provider request',
      createdAt: startedAt,
      updatedAt: startedAt,
      lastEventSeq: 0,
    });
    const append = (seq: number, type: string, data: unknown) => {
      const event = createHarnessEvent({ runId, seq, type, data, timestamp: startedAt + seq });
      store.appendAgentRunEvent({ runId, seq, eventType: type, event, createdAt: startedAt + seq });
    };
    append(1, 'llm_request_started', {
      type: 'llm_request_started',
      request: {
        requestId: 'request-live-1',
        requestKind: 'step.reason',
        startedAt,
        requestedRoute: { provider: 'local', model: 'qwen-local' },
        options: { timeoutMs: 20_000 },
      },
    });
    append(2, 'llm_request_heartbeat', {
      type: 'llm_request_heartbeat',
      requestId: 'request-live-1',
      requestKind: 'step.reason',
      provider: 'local',
      model: 'qwen-local',
      startedAt,
      elapsedMs: 30_000,
      deadlineAt,
      stale: true,
    });

    expect(manager.getRunLiveness(runId, now)).toMatchObject({
      activeRequest: {
        requestId: 'request-live-1',
        requestKind: 'step.reason',
        provider: 'local',
        model: 'qwen-local',
        elapsedMs: 30_000,
        effectiveDeadlineAt: deadlineAt,
        stale: true,
        outcome: 'unknown',
      },
    });
  });

  it('preserves the durable context projection when startup recovery interrupts a run', () => {
    const store = createStore();
    const manager = new ServerRunManager(store);
    const runId = 'recovery-context-run';
    const now = Date.now();
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-recovery-context-'));
    store.createAgentRun({
      id: runId,
      kind: 'coder',
      status: 'running',
      task: 'recover context after restart',
      workspace,
      model: 'model-a',
      createdAt: now,
      updatedAt: now,
      lastEventSeq: 0,
    });
    const checkpoint = createReactCheckpoint({
      task: 'recover context after restart',
      workspace,
      plan: [{ step: 'Continue implementation', status: 'in_progress' }],
      steps: [{ action: 'Read', action_input: { file_path: 'src/app.ts' }, observation: '{"success":true}' }],
      current_step: 1,
      max_steps: 10,
      total_pollen_cost: 0,
      budget: 100,
      repairAttempts: 0,
    } as any);
    const contextSnapshot = createReactContextSnapshot(runId, checkpoint, 1);
    const event = createHarnessEvent({
      runId,
      seq: 1,
      type: 'checkpoint',
      data: checkpoint,
      timestamp: now + 1,
    });
    store.appendAgentRunEvent({ runId, seq: 1, eventType: 'checkpoint', event, createdAt: now + 1 }, {
      metadata: { checkpoint },
      contextSnapshot,
    });

    manager.recoverActiveRuns('Server restarted during provider cooldown.');

    expect(manager.getRun(runId)).toEqual(expect.objectContaining({ status: 'interrupted' }));
    expect(manager.getContextSnapshot(runId)).toEqual(contextSnapshot);
    expect(manager.listEvents(runId).at(-1)?.eventType).toBe('interrupted');
  });

  it('repairs unfinished calls, rebuilds a missing context snapshot, and blocks side-effect replay', () => {
    const store = createStore();
    const manager = new ServerRunManager(store);
    const runId = 'recovery-repair-run';
    const now = Date.now();
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-recovery-repair-'));
    const checkpoint = createReactCheckpoint({
      task: 'repair an interrupted call', workspace, plan: [{ step: 'Verify the result', status: 'in_progress' }],
      steps: [], current_step: 0, max_steps: 10, total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any);
    store.createAgentRun({
      id: runId,
      kind: 'coder',
      status: 'running',
      task: checkpoint.state.task,
      workspace,
      model: 'model-a',
      metadata: { checkpoint },
      createdAt: now,
      updatedAt: now,
      lastEventSeq: 0,
    });
    const append = (seq: number, type: string, data: unknown) => {
      const event = createHarnessEvent({ runId, seq, type, data, timestamp: now + seq });
      store.appendAgentRunEvent({ runId, seq, eventType: type, event, createdAt: now + seq });
    };
    append(1, 'llm_request_started', { request: { requestId: 'request-1', stepId: 'step-1', model: 'model-a' } });
    append(2, 'tool_started', {
      type: 'tool_started', tool: 'Write', toolCallId: 'tool-1', requestId: 'request-1',
      input: { file_path: 'src/app.ts', content: 'side effect' },
    });

    const reports = manager.recoverActiveRuns('Recovery repair test');

    expect(reports).toEqual([expect.objectContaining({
      runId,
      repairedModelRequests: 1,
      repairedToolCalls: 1,
      contextSnapshotRebuilt: true,
      blockedSideEffects: 1,
    })]);
    expect(manager.getRun(runId)).toEqual(expect.objectContaining({
      status: 'interrupted',
      metadata: expect.objectContaining({
        startupRecovery: expect.objectContaining({
          repairedModelRequests: 1,
          repairedToolCalls: 1,
          contextSnapshotRebuilt: true,
          blockedSideEffects: 1,
          resumable: true,
        }),
      }),
    }));
    expect(manager.getContextSnapshot(runId)).toEqual(expect.objectContaining({
      runId,
      contextId: `${runId}:react-context`,
    }));
    expect(manager.listEvents(runId).map((event) => event.eventType)).toEqual([
      'llm_request_started',
      'tool_started',
      'llm_request_finished',
      'tool_outcome_unknown',
      'checkpoint',
      'run_terminal_advice',
      'interrupted',
    ]);
    expect(manager.getCheckpoint(runId)?.state.uncertainToolCalls).toEqual([
      expect.objectContaining({ toolCallId: 'tool-1', retryPolicy: 'verify_before_retry' }),
    ]);
  });

  it('survives throttle handoff across a manager restart and completes from hydrated Cordis context', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'react-engine-cordis-restart-'));
    const dbPath = path.join(directory, 'runs.sqlite');
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-cordis-restart-workspace-'));
    const storeBeforeRestart = new SQLiteAppStore(dbPath);
    const managerBeforeRestart = new ServerRunManager(storeBeforeRestart);
    const initial = managerBeforeRestart.startRun(
      { kind: 'coder', task: 'resume after throttle', workspace, model: 'model-a' },
      async ({ emit }) => {
        emit('checkpoint', createReactCheckpoint({
          task: 'resume after throttle', workspace, plan: [{ step: 'Finish safely', status: 'in_progress' }],
          steps: [{ action: 'Read', action_input: { file_path: 'src/app.ts' }, observation: '{"success":true}' }],
          current_step: 1, max_steps: 10, total_pollen_cost: 0, budget: 100, repairAttempts: 0,
        } as any));
        return { success: true, steps: [], stepCount: 1, pollenCost: 0 };
      },
    );
    await waitForStatus(managerBeforeRestart, initial.id, 'completed');

    // Persist the exact durable state a process has while waiting on a
    // provider. The process can now disappear without taking SQLite with it.
    const waiting = managerBeforeRestart.getRun(initial.id)!;
    storeBeforeRestart.updateAgentRun({
      id: initial.id,
      status: 'waiting_for_provider',
      finishedAt: undefined,
      stopReason: undefined,
      result: undefined,
      updatedAt: Date.now(),
    });
    const cooldownEvent = createHarnessEvent({
      runId: initial.id,
      seq: waiting.lastEventSeq + 1,
      type: 'cooldown_waiting',
      data: { type: 'cooldown_waiting', attempt: 1, delayMs: 30_000, provider: 'model-a' },
      timestamp: Date.now(),
    });
    storeBeforeRestart.appendAgentRunEvent({
      runId: initial.id,
      seq: waiting.lastEventSeq + 1,
      eventType: 'cooldown_waiting',
      event: cooldownEvent,
      createdAt: cooldownEvent.timestamp,
    });
    storeBeforeRestart.close();

    const storeAfterRestart = new SQLiteAppStore(dbPath);
    const managerAfterRestart = new ServerRunManager(storeAfterRestart);
    const reports = managerAfterRestart.recoverActiveRuns('Server stopped during provider cooldown.');
    expect(reports).toEqual([expect.objectContaining({
      runId: initial.id,
      repairedModelRequests: 0,
      repairedToolCalls: 0,
      contextSnapshotRebuilt: false,
    })]);
    expect(managerAfterRestart.getRun(initial.id)?.status).toBe('interrupted');
    const snapshot = managerAfterRestart.getContextSnapshot(initial.id);
    expect(snapshot?.messages.some((message) => 'thought' in message)).toBe(false);

    const resumed = managerAfterRestart.startRun(
      {
        kind: 'coder',
        task: 'resume after throttle',
        workspace,
        model: 'model-a',
        metadata: { parentRunId: initial.id },
      },
      async ({ runId }) => {
        const scope = createCapabilityScope({
          runId,
          modelRoute: { requested: 'model-a', resolved: 'model-a' },
          toolRegistry: {
            getAll: () => [], get: () => undefined, getEnabled: () => [], has: () => false,
            register: () => undefined, setEnabled: () => undefined, getNames: () => [], size: () => 0,
          } as any,
          workspace: { root: workspace, privateWorkspace: false, sendPrivateSourceCode: false, allowedExternalProviders: [] },
          budgets: { maxSteps: 4, maxLlmRequests: 2, maxCost: 10, maxToolCalls: 8 },
          cordis: { contextSnapshot: managerAfterRestart.getContextSnapshot(initial.id) || undefined },
        });
        try {
          const assembly = scope.cordis.get<any>('contextAssembly');
          expect(assembly.getSnapshot()).toEqual(snapshot);
          assembly.markHydrated();
          expect(assembly.hydrated).toBe(true);
        } finally {
          await scope.dispose('restart_fixture_complete');
        }
        return { success: true, resumedFrom: initial.id, steps: [], stepCount: 0, pollenCost: 0 };
      },
    );
    const completed = await waitForStatus(managerAfterRestart, resumed.id, 'completed');
    expect(completed.result).toEqual(expect.objectContaining({ success: true, resumedFrom: initial.id }));
    expect(managerAfterRestart.listEvents(initial.id).some((event) => event.eventType === 'tool_result')).toBe(false);
    storeAfterRestart.close();
  });

  it('pauses one active run for user input and resumes that same executor', async () => {
    const manager = new ServerRunManager(createStore());
    let executorCompleted = false;
    let executorRunId = '';
    const run = manager.startRun(
      { kind: 'coder', task: 'ask before choosing', model: 'selected-model' },
      async ({ runId, requestUserInput }) => {
        executorRunId = runId;
        const response = await requestUserInput({
          requestId: 'question-1',
          question: 'Which browser target should I support?',
          options: ['Desktop', 'Mobile'],
          allowFreeform: true,
          context: 'This choice changes the responsive layout.',
        });
        executorCompleted = true;
        return { success: true, response, steps: [], stepCount: 0, pollenCost: 0 };
      },
    );

    const waiting = await waitForStatus(manager, run.id, 'waiting_for_user');
    expect(executorRunId).toBe(run.id);
    expect(waiting.model).toBe('selected-model');
    expect(executorCompleted).toBe(false);
    expect(manager.getPendingUserInput(run.id)).toEqual(expect.objectContaining({
      requestId: 'question-1',
      options: ['Desktop', 'Mobile'],
    }));
    expect(manager.listEvents(run.id).map((event) => event.eventType)).toEqual(['user_input_required']);

    expect(manager.respondToUserInput(run.id, 'wrong-question', { selectedOption: 'Desktop' })).toEqual({
      ok: false,
      reason: 'request_mismatch',
    });
    expect(manager.respondToUserInput(run.id, 'question-1', { selectedOption: 'Tablet' })).toEqual({
      ok: false,
      reason: 'invalid_option',
    });

    const accepted = manager.respondToUserInput(run.id, 'question-1', {
      selectedOption: 'Mobile',
      answer: 'Prioritize touch controls.',
    });
    expect(accepted).toEqual(expect.objectContaining({ ok: true }));
    const completed = await waitForStatus(manager, run.id, 'completed');
    expect(executorCompleted).toBe(true);
    expect(completed.id).toBe(run.id);
    expect(completed.model).toBe('selected-model');
    expect((completed.result as any).response).toEqual({
      requestId: 'question-1',
      selectedOption: 'Mobile',
      answer: 'Prioritize touch controls.',
      cancelled: false,
    });
    expect(manager.listEvents(run.id).map((event) => event.eventType)).toEqual([
      'user_input_required',
      'user_input_resolved',
      'done',
    ]);
  });

  it('persists bounded, credential-safe target transition audit entries', async () => {
    const manager = new ServerRunManager(createStore());
    const run = manager.startRun(
      { kind: 'coder', task: 'audit target' },
      async () => ({ success: true, steps: [], stepCount: 0, pollenCost: 0 }),
    );
    manager.recordModelTargetTransition(run.id, {
      requestedTarget: 'gemini-target:default-gemini-3-6-flash',
      provider: 'gemini',
      resolvedModel: 'gemini-3.6-flash',
      profileId: 'default',
      route: 'primary',
      reason: 'selected_model',
    });

    expect(manager.getRun(run.id)?.metadata?.modelTargetAudit).toEqual([
      expect.objectContaining({
        requestedTarget: 'gemini-target:default-gemini-3-6-flash',
        provider: 'gemini',
        resolvedModel: 'gemini-3.6-flash',
        profileId: 'default',
        route: 'primary',
        reason: 'selected_model',
      }),
    ]);
    await waitForStatus(manager, run.id, 'completed');
  });

  it('hides an interrupted parent after a newer continuation run supersedes it', () => {
    const store = createStore();
    store.createAgentRun({
      id: 'interrupted-parent', kind: 'coder', threadId: 'thread-1', status: 'interrupted',
      task: 'first task', createdAt: 100, updatedAt: 100, lastEventSeq: 0,
    });
    store.createAgentRun({
      id: 'continuation-child', kind: 'coder', threadId: 'thread-1', status: 'completed',
      task: 'first task', metadata: { parentRunId: 'interrupted-parent' },
      createdAt: 200, updatedAt: 200, lastEventSeq: 0,
    });
    const manager = new ServerRunManager(store);

    expect(manager.listRuns({ kind: 'coder' }).map((run) => run.id)).not.toContain('interrupted-parent');
  });

  it('keeps a run alive when an SSE subscriber disconnects', async () => {
    const manager = new ServerRunManager(createStore());
    let capturedSignal: AbortSignal | null = null;
    const run = manager.startRun(
      { kind: 'react', task: 'long task' },
      async ({ signal }) => {
        capturedSignal = signal;
        await new Promise((resolve) => setTimeout(resolve, 80));
        return { success: true, steps: [], stepCount: 0, pollenCost: 0 };
      }
    );

    const res = createMockSseResponse();
    expect(manager.subscribe(run.id, res as any)).toBe(true);
    res.emitClose();

    expect(capturedSignal?.aborted).toBe(false);
    await waitForStatus(manager, run.id, 'completed');
  });

  it('aborts a run only through stopRun', async () => {
    const manager = new ServerRunManager(createStore());
    let capturedSignal: AbortSignal | null = null;
    const run = manager.startRun(
      { kind: 'coder', task: 'stop me' },
      async ({ signal }) => {
        capturedSignal = signal;
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('RUN_CANCELLED')), { once: true });
        });
      }
    );

    expect(manager.stopRun(run.id, 'Stopped in test')).toBe(true);
    expect(capturedSignal?.aborted).toBe(true);
    expect(capturedSignal?.reason).toMatchObject({
      name: 'RunCancellationError',
      code: 'RUN_CANCELLED',
      message: 'Stopped in test',
    });
    expect(capturedSignal?.reason).not.toBeInstanceOf(Error);
    const stopped = await waitForStatus(manager, run.id, 'stopped');
    expect(stopped.stopReason).toBe('Stopped in test');
  });

  it('queues active-thread messages and drains them at a safe checkpoint', async () => {
    const manager = new ServerRunManager(createStore());
    const run = manager.startRun(
      { kind: 'coder', threadId: 'conversation-1', task: 'long task' },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { success: true, steps: [], stepCount: 0, pollenCost: 0 };
      },
    );
    const queued = manager.queueUserMessage(run.id, { message: 'Also update the README.', source: 'test' });
    expect(queued.ok).toBe(true);
    expect(manager.getRun(run.id)?.metadata).toEqual(expect.objectContaining({ queuedMessageCount: 1 }));
    expect(manager.listEvents(run.id).map((event) => event.eventType)).toContain('user_message_queued');
    expect(manager.consumeQueuedMessages(run.id)).toEqual([
      expect.objectContaining({ message: 'Also update the README.', source: 'test' }),
    ]);
    expect(manager.consumeQueuedMessages(run.id)).toEqual([]);
    await waitForStatus(manager, run.id, 'completed');
  });

  it('sends SSE heartbeats while a run is waiting on the model', async () => {
    jest.useFakeTimers();
    let releaseRun!: () => void;
    const runFinished = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const manager = new ServerRunManager(createStore());
    const run = manager.startRun(
      { kind: 'react', task: 'wait for model' },
      async () => {
        await runFinished;
        return { success: true, steps: [], stepCount: 0, pollenCost: 0 };
      }
    );
    const res = createMockSseResponse();

    try {
      expect(manager.subscribe(run.id, res as any)).toBe(true);
      jest.advanceTimersByTime(15_000);
      expect(res.writes).toContain(': keep-alive\n\n');
      res.emitClose();
    } finally {
      releaseRun();
      jest.useRealTimers();
    }
    await waitForStatus(manager, run.id, 'completed');
  });

  it('claims inbox updates at a boundary and acknowledges them after prompt assembly', async () => {
    const manager = new ServerRunManager(createStore());
    const run = manager.startRun(
      { kind: 'react', task: 'durable boundary' },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { success: true, steps: [], stepCount: 0, pollenCost: 0 };
      },
    );
    const queued = manager.enqueueInboxMessage(run.id, {
      message: 'Steer the next action toward the README.',
      messageId: 'steer-1',
      source: 'steering',
      target: 'next-step',
    });
    expect(queued.ok).toBe(true);
    const claimed = manager.consumeQueuedMessages(run.id);
    expect(claimed).toEqual([expect.objectContaining({ id: 'steer-1', target: 'next-step', status: 'claimed', claimId: expect.any(String) })]);
    expect(manager.listInbox(run.id, { status: 'claimed' })).toHaveLength(1);
    manager.acknowledgeQueuedMessages(run.id, ['steer-1']);
    expect(manager.listInbox(run.id, { status: 'processed' })).toHaveLength(1);
    expect(manager.listEvents(run.id).map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'inbox_message_enqueued',
      'inbox_message_claimed',
      'inbox_message_processed',
    ]));
    await waitForStatus(manager, run.id, 'completed');
  });

  it('releases claimed inbox work on interruption and copies it into a continuation', async () => {
    const manager = new ServerRunManager(createStore());
    const parent = manager.startRun(
      { kind: 'react', task: 'parent task' },
      async ({ signal }) => await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('RUN_CANCELLED')), { once: true })),
    );
    manager.enqueueInboxMessage(parent.id, { message: 'Keep this for continuation.', messageId: 'continue-1' });
    manager.consumeQueuedMessages(parent.id);
    expect(manager.listInbox(parent.id, { status: 'claimed' })).toHaveLength(1);
    expect(manager.interruptRun(parent.id, 'Pause before continuation')).toBe(true);
    await waitForStatus(manager, parent.id, 'interrupted');
    expect(manager.listInbox(parent.id, { status: 'pending' })).toHaveLength(1);

    const child = manager.startRun(
      { kind: 'react', task: 'continuation task', metadata: { parentRunId: parent.id } },
      async () => ({ success: true, steps: [], stepCount: 0, pollenCost: 0 }),
    );
    expect(manager.listInbox(child.id, { status: 'pending' })).toEqual([
      expect.objectContaining({ messageId: 'continue-1', message: 'Keep this for continuation.' }),
    ]);
    expect(manager.listEvents(child.id).map((event) => event.eventType)).toContain('inbox_requeued');
    await waitForStatus(manager, child.id, 'completed');
  });

  it('distinguishes interrupt and kill lifecycle outcomes', async () => {
    const manager = new ServerRunManager(createStore());
    const interrupted = manager.startRun(
      { kind: 'coder', task: 'interrupt me' },
      async ({ signal }) => await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('RUN_CANCELLED')), { once: true })),
    );
    expect(manager.interruptRun(interrupted.id, 'Pause this run')).toBe(true);
    const interruptedRun = await waitForStatus(manager, interrupted.id, 'interrupted');
    expect(interruptedRun.stopReason).toBe('Pause this run');
    expect((interruptedRun.result as any).errorCode).toBe('RUN_INTERRUPTED');

    const killed = manager.startRun(
      { kind: 'coder', task: 'kill me' },
      async ({ signal }) => await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('RUN_CANCELLED')), { once: true })),
    );
    expect(manager.killRun(killed.id, 'Terminate this run')).toBe(true);
    const killedRun = await waitForStatus(manager, killed.id, 'killed');
    expect(killedRun.stopReason).toBe('Terminate this run');
    expect((killedRun.result as any).errorCode).toBe('RUN_KILLED');
  });

  it('persists ordered events and can list missed events after a sequence', async () => {
    const manager = new ServerRunManager(createStore());
    const run = manager.startRun(
      { kind: 'react', task: 'sequence task' },
      async ({ emit }) => {
        emit('progress', 'first');
        emit('progress', 'second');
        return { success: true, steps: [], stepCount: 0, pollenCost: 0 };
      }
    );

    await waitForStatus(manager, run.id, 'completed');
    const events = manager.listEvents(run.id);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(events.map((event) => event.eventType)).toEqual(['progress', 'progress', 'done']);

    const missed = manager.listEvents(run.id, 1);
    expect(missed.map((event) => event.eventType)).toEqual(['progress', 'done']);
  });

  it('emits terminal advice before the final event for unsuccessful runs', async () => {
    const manager = new ServerRunManager(createStore());
    const run = manager.startRun(
      { kind: 'react', task: 'stop at the configured step limit' },
      async () => ({ success: false, error: 'Maximum step limit reached.', errorCode: 'GLOBAL_STEP_LIMIT_EXCEEDED' }),
    );

    await waitForStatus(manager, run.id, 'failed');
    const events = manager.listEvents(run.id);
    expect(events.map((event) => event.eventType)).toEqual(['run_terminal_advice', 'done']);
    expect(events[0].event.data).toEqual(expect.objectContaining({
      type: 'run_terminal_advice',
      category: 'step_limit',
      guidance: expect.arrayContaining([expect.any(String)]),
      learnMoreUrl: expect.stringContaining('docs/core/RUNNING_AGENT_GUIDE.md'),
    }));
  });

  it('projects only the bounded event delta for repeated polling', async () => {
    const manager = new ServerRunManager(createStore());
    const run = manager.startRun(
      { kind: 'react', task: 'incremental projection task' },
      async ({ emit }) => {
        for (let index = 1; index <= 6; index += 1) emit('progress', `step-${index}`);
        return { success: true, steps: [], stepCount: 0, pollenCost: 0 };
      },
    );

    await waitForStatus(manager, run.id, 'completed');
    const page = manager.projectEventPage(run.id, 2, 2);

    expect(page.events.map((event) => event.seq)).toEqual([3, 4]);
    expect(page.projection.eventCount).toBe(2);
    expect(page.projection.lastSeq).toBe(4);
    expect(page.nextSeq).toBe(4);
    expect(page.lastSeq).toBe(7);
    expect(page.hasMore).toBe(true);
  });

  it('uses the same fresh-checkpoint gate as the resume endpoint', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-resume-'));
    mkdirSync(path.join(workspace, 'src'));
    const trackedFile = path.join(workspace, 'src', 'app.ts');
    writeFileSync(trackedFile, 'export const value = 1;');
    const manager = new ServerRunManager(createStore());
    const checkpoint = createReactCheckpoint({
      task: 'resume task', workspace, plan: [{ step: 'verify', status: 'pending' }], steps: [], current_step: 1,
      max_steps: 5, total_pollen_cost: 0, budget: 100, repairAttempts: 0,
      taskAnalysis: { contract: { candidateFiles: ['src/app.ts'] } },
    } as any);
    const run = manager.startRun({ kind: 'react', task: 'resume task', workspace }, async ({ emit }) => {
      emit('checkpoint', checkpoint);
      return { success: true, steps: [], stepCount: 0, pollenCost: 0 };
    });
    await waitForStatus(manager, run.id, 'completed');

    const fresh = manager.getResumeContext(run.id);
    expect(fresh.ok).toBe(true);
    if (fresh.ok) expect(fresh.checkpoint.state.plan[0].status).toBe('pending');
    expect(manager.listRuns().find((item) => item.id === run.id)?.metadata).toEqual(expect.objectContaining({
      continuationPreview: {
        currentGoal: 'resume task',
        remainingPlanItem: 'verify',
      },
    }));

    writeFileSync(trackedFile, 'export const value = 2;');
    expect(manager.getResumeContext(run.id)).toEqual({ ok: false, reason: 'stale_workspace' });
  });

  it('persists lineage-aware continuation quality in details and lightweight summaries', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-continuation-quality-'));
    const parentStep = {
      thought: 'inspect', action: 'Read', action_input: { file_path: 'app.ts' }, observation: '{"success":true}',
    };
    const parentState = {
      task: 'continue quality task', workspace, plan: [{ step: 'Finish', status: 'in_progress' }],
      steps: [parentStep], current_step: 1, max_steps: 2, total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any;
    const continuationHandoff = createContinuationHandoff({
      parentRunId: 'parent-quality', reason: 'max_steps', state: parentState, createdAt: 1,
    });
    const childState = {
      ...parentState,
      continuationHandoff,
      steps: [...parentState.steps, { ...parentStep }],
      current_step: 2,
    };
    const manager = new ServerRunManager(createStore());
    const run = manager.startRun(
      { kind: 'coder', task: childState.task, workspace, metadata: { parentRunId: 'parent-quality', continuationReason: 'max_steps' } },
      async ({ emit }) => {
        emit('checkpoint', createReactCheckpoint(childState));
        return { success: true };
      }
    );
    await waitForStatus(manager, run.id, 'completed');

    expect((manager.getRun(run.id)?.metadata as any).continuationQuality).toEqual(expect.objectContaining({
      repeatedParentActions: 1,
      staleParentFileReads: 1,
    }));
    expect(manager.listRuns().find((item) => item.id === run.id)?.metadata).toEqual(expect.objectContaining({
      continuationQuality: expect.objectContaining({
        repeatedParentActions: 1,
        staleParentFileReads: 1,
      }),
    }));
  });

  it('stores returned success:false results as failed runs', async () => {
    const manager = new ServerRunManager(createStore());
    const run = manager.startRun(
      { kind: 'react', task: 'recoverable failure' },
      async () => ({ success: false, error: 'Completion evidence missing', steps: [], stepCount: 0, pollenCost: 0 })
    );

    const failed = await waitForStatus(manager, run.id, 'failed');
    expect(failed.stopReason).toBe('Completion evidence missing');
  });

  it('stores completed implementation with failed verification as a completed run', async () => {
    const manager = new ServerRunManager(createStore());
    const run = manager.startRun(
      { kind: 'coder', task: 'implementation finished but tests failed' },
      async () => ({
        success: false,
        executionCompleted: true,
        verificationStatus: 'failed',
        outcome: 'completed',
        finalAnswer: 'The requested implementation was written.',
        error: 'npm run test:unit failed',
        steps: [],
        stepCount: 2,
        pollenCost: 0,
      }),
    );

    const completed = await waitForStatus(manager, run.id, 'completed');
    expect(completed.stopReason).toBeUndefined();
    expect(completed.result).toEqual(expect.objectContaining({
      executionCompleted: true,
      verificationStatus: 'failed',
      error: 'npm run test:unit failed',
    }));
  });

  it('continues the same active run automatically after a max-step checkpoint', async () => {
    const manager = new ServerRunManager(createStore());
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-auto-continuation-'));
    let attempts = 0;
    const contexts: Array<{ continuationAttempt: number; checkpointStep?: number; stepBudget: number }> = [];
    const run = manager.startRun(
      { kind: 'coder', task: 'continue past the action window', workspace, maxSteps: 2 },
      async ({ emit, checkpoint, continuationAttempt, continuationStepBudget }) => {
        attempts += 1;
        contexts.push({
          continuationAttempt,
          checkpointStep: checkpoint?.state.current_step,
          stepBudget: continuationStepBudget,
        });
        if (attempts === 1) {
          emit('checkpoint', createReactCheckpoint({
            task: 'continue past the action window',
            workspace,
            plan: [{ step: 'Finish the task', status: 'in_progress' }],
            steps: [{ action: 'Read', action_input: { file_path: 'src/app.ts' }, observation: '{"success":true}' }],
            current_step: 1,
            max_steps: 2,
            total_pollen_cost: 0,
            budget: 100,
            repairAttempts: 0,
          } as any));
          return {
            success: false,
            error: 'Autonomous turn checkpoint reached; resume from the saved state to continue.',
            errorCode: 'MAX_STEPS_EXCEEDED',
          };
        }
        return { success: true, finalAnswer: 'Finished after the automatic continuation.' };
      },
    );

    const completed = await waitForStatus(manager, run.id, 'completed');

    expect(completed.id).toBe(run.id);
    expect(attempts).toBe(2);
    expect(contexts).toEqual([
      { continuationAttempt: 0, stepBudget: 2 },
      { continuationAttempt: 1, checkpointStep: 1, stepBudget: 2 },
    ]);
    expect(manager.listEvents(run.id).map((event) => event.eventType)).toEqual([
      'checkpoint',
      'progress',
      'done',
    ]);
    expect(manager.listEvents(run.id).find((event) => event.eventType === 'progress')?.event.data)
      .toMatch(/continuing automatically/i);
  });

  it('pauses for provider cooldown and resumes from the latest checkpoint', async () => {
    const manager = new ServerRunManager(createStore());
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-provider-cooldown-'));
    const checkpoint = createReactCheckpoint({
      task: 'wait for provider route', workspace, plan: [], steps: [], current_step: 0, max_steps: 10,
      total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any);
    let attempts = 0;
    let retryAttempt = 0;
    let retryCheckpointStep: number | undefined;
    const run = manager.startRun(
      { kind: 'coder', task: 'wait for provider route', workspace, maxProviderCooldownRetries: 1 },
      async ({ emit, checkpoint: retryCheckpoint, providerRetryAttempt }) => {
        attempts += 1;
        if (attempts === 1) {
          emit('checkpoint', checkpoint);
          throw new Error('All LLM providers failed:\ngemini: temporarily overloaded\nopenrouter: HTTP 429 retry after 100 ms');
        }
        retryAttempt = providerRetryAttempt;
        retryCheckpointStep = retryCheckpoint?.state.current_step;
        return { success: true, steps: [], stepCount: 0, pollenCost: 0 };
      },
    );

    const waiting = await waitForStatus(manager, run.id, 'waiting_for_provider');
    expect((waiting.metadata as any).providerWait).toEqual(expect.objectContaining({ attempt: 1, retryAfterMs: 100 }));
    const completed = await waitForStatus(manager, run.id, 'completed');
    expect(attempts).toBe(2);
    expect(retryAttempt).toBe(1);
    expect(retryCheckpointStep).toBe(0);
    expect((completed.metadata as any).providerWait).toBeUndefined();
    const events = manager.listEvents(run.id);
    const cooldown = events.find((event) => event.eventType === 'cooldown_waiting');
    expect((cooldown?.event as any).data.message).toMatch(/run is paused/);
    expect((cooldown?.event as any).data.message).toMatch(/no fallback will be used/);
    expect((cooldown?.event as any).data.message).toMatch(/saved action checkpoint/);
    expect(manager.getContextSnapshot(run.id)).toEqual(expect.objectContaining({
      runId: run.id,
      contextId: `${run.id}:react-context`,
      revision: 0,
      eventSeq: 1,
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'wait for provider route' }),
      ]),
    }));
    expect(manager.getContextSnapshot(run.id)?.messages.some((message) => 'thought' in message)).toBe(false);
    expect(events.map((event) => event.eventType).filter((type) => type !== 'checkpoint'))
      .toEqual(['cooldown_waiting', 'retrying', 'done']);
  });

  it('uses the provider retry-after value and preserves the exact OpenRouter error', async () => {
    const manager = new ServerRunManager(createStore());
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-openrouter-shared-pool-wait-'));
    const checkpoint = createReactCheckpoint({
      task: 'pause on OpenRouter shared pool limit', workspace, plan: [], steps: [], current_step: 1, max_steps: 10,
      total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any);
    const providerError = [
      'All LLM providers failed:',
      '- openrouter | model "z-ai/glm-5.2:free" | provider key pool: upstream shared pool rate-limited',
      'Provider detail: HTTP 429 from OpenRouter',
      'Retry after: 5, Response: upstream shared pool rate-limited:',
    ].join('\n');
    let attempts = 0;
    const run = manager.startRun(
      { kind: 'coder', task: 'pause on OpenRouter shared pool limit', workspace },
      async ({ emit }) => {
        attempts += 1;
        emit('checkpoint', checkpoint);
        throw new Error(providerError);
      },
    );

    const waiting = await waitForStatus(manager, run.id, 'waiting_for_provider');
    expect(attempts).toBe(1);
    expect((waiting.metadata as any).providerWait).toEqual(expect.objectContaining({ retryAfterMs: 5_000 }));
    const cooldown = manager.listEvents(run.id).find((event) => event.eventType === 'cooldown_waiting');
    expect(cooldown?.event.data).toEqual(expect.objectContaining({
      delayMs: 5_000,
      providerError,
      message: expect.stringMatching(/run is paused/i),
    }));

    expect(manager.stopRun(run.id, 'Stop after asserting OpenRouter pause')).toBe(true);
    await waitForStatus(manager, run.id, 'stopped');
  });

  it('allows callers to opt into repeated provider cooldown retries', async () => {
    const manager = new ServerRunManager(createStore());
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-provider-repeat-wait-'));
    const checkpoint = createReactCheckpoint({
      task: 'wait through provider throttles', workspace, plan: [], steps: [], current_step: 1, max_steps: 10,
      total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any);
    let attempts = 0;
    const run = manager.startRun(
      { kind: 'coder', task: 'wait through provider throttles', workspace, maxProviderCooldownRetries: 4 },
      async ({ emit }) => {
        attempts += 1;
        if (attempts < 5) {
          emit('checkpoint', checkpoint);
          throw new Error('All LLM providers failed: gemini: HTTP 429 retry after 20 ms');
        }
        return { success: true, steps: [], stepCount: 0, pollenCost: 0 };
      },
    );

    await waitForStatus(manager, run.id, 'waiting_for_provider');
    const completed = await waitForStatus(manager, run.id, 'completed');
    expect(attempts).toBe(5);
    expect(completed.result).toEqual(expect.objectContaining({ success: true }));
    expect(manager.listEvents(run.id).map((event) => event.eventType).filter((type) => type !== 'checkpoint'))
      .toEqual([
        'cooldown_waiting', 'retrying',
        'cooldown_waiting', 'retrying',
        'cooldown_waiting', 'retrying',
        'cooldown_waiting', 'retrying',
        'done',
      ]);
  });

  it('stops after one automatic provider cooldown retry by default', async () => {
    const manager = new ServerRunManager(createStore());
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-provider-default-limit-'));
    const checkpoint = createReactCheckpoint({
      task: 'stop after provider cooldown retry', workspace, plan: [], steps: [], current_step: 1, max_steps: 10,
      total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any);
    let attempts = 0;
    const run = manager.startRun(
      { kind: 'coder', task: 'stop after provider cooldown retry', workspace },
      async ({ emit }) => {
        attempts += 1;
        emit('checkpoint', checkpoint);
        throw new Error('All LLM providers failed: nvidia: timed out; Retry available in 1 ms');
      },
    );

    const failed = await waitForStatus(manager, run.id, 'failed');
    expect(attempts).toBe(2);
    expect(failed.result).toEqual(expect.objectContaining({
      errorCode: 'PROVIDER_RETRY_LIMIT',
      recoverable: true,
    }));
    expect((failed.metadata as any).providerWait).toEqual(expect.objectContaining({
      attempt: 2,
      terminalReason: 'PROVIDER_RETRY_LIMIT',
    }));
  });

  it('stops after an explicitly configured provider retry limit', async () => {
    const manager = new ServerRunManager(createStore());
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-provider-explicit-limit-'));
    const checkpoint = createReactCheckpoint({
      task: 'stop after repeated provider failures', workspace, plan: [], steps: [], current_step: 1, max_steps: 10,
      total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any);
    let attempts = 0;
    const run = manager.startRun(
      { kind: 'coder', task: 'stop after explicitly bounded provider failures', workspace, maxProviderCooldownRetries: 3 },
      async ({ emit }) => {
        attempts += 1;
        emit('checkpoint', checkpoint);
        throw new Error('All LLM providers failed: gemini: HTTP 429 retry after 1 ms');
      },
    );

    const failed = await waitForStatus(manager, run.id, 'failed');
    expect(attempts).toBe(4);
    expect(failed.result).toEqual(expect.objectContaining({
      errorCode: 'PROVIDER_RETRY_LIMIT',
      recoverable: true,
    }));
    expect((failed.metadata as any).providerWait).toEqual(expect.objectContaining({
      attempt: 4,
      terminalReason: 'PROVIDER_RETRY_LIMIT',
    }));
  });

  it('bounds automatic provider retries for continuous runs', async () => {
    const manager = new ServerRunManager(createStore());
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-continuous-provider-default-limit-'));
    const checkpoint = createReactCheckpoint({
      task: 'bound continuous provider recovery', workspace, plan: [], steps: [], current_step: 1, max_steps: 10,
      total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any);
    let attempts = 0;
    const run = manager.startRun(
      { kind: 'coder', task: 'bound continuous provider recovery', workspace, continuousRun: true },
      async ({ emit }) => {
        attempts += 1;
        emit('checkpoint', checkpoint);
        throw new Error('All LLM providers failed: local: timed out; Retry available in 1 ms');
      },
    );

    const failed = await waitForStatus(manager, run.id, 'failed');
    expect(attempts).toBe(4);
    expect(failed.result).toEqual(expect.objectContaining({
      errorCode: 'PROVIDER_RETRY_LIMIT',
      recoverable: true,
    }));
    expect((failed.metadata as any).providerWait).toEqual(expect.objectContaining({
      attempt: 4,
      terminalReason: 'PROVIDER_RETRY_LIMIT',
    }));
  });

  it('honors an explicit provider retry limit for continuous runs', async () => {
    const manager = new ServerRunManager(createStore());
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-continuous-provider-explicit-limit-'));
    const checkpoint = createReactCheckpoint({
      task: 'stop continuous provider recovery', workspace, plan: [], steps: [], current_step: 1, max_steps: 10,
      total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any);
    let attempts = 0;
    const run = manager.startRun(
      {
        kind: 'coder',
        task: 'stop continuous provider recovery',
        workspace,
        continuousRun: true,
        maxProviderCooldownRetries: 0,
      },
      async ({ emit }) => {
        attempts += 1;
        emit('checkpoint', checkpoint);
        throw new Error('All LLM providers failed: local: timed out; Retry available in 1 ms');
      },
    );

    const failed = await waitForStatus(manager, run.id, 'failed');
    expect(attempts).toBe(1);
    expect(failed.result).toEqual(expect.objectContaining({
      errorCode: 'PROVIDER_RETRY_LIMIT',
      recoverable: true,
    }));
    expect((failed.metadata as any).providerWait).toEqual(expect.objectContaining({
      attempt: 1,
      terminalReason: 'PROVIDER_RETRY_LIMIT',
    }));
  });

  it('asks for a user decision when automatic provider waiting is disabled', async () => {
    const manager = new ServerRunManager(createStore());
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-provider-wait-disabled-'));
    const checkpoint = createReactCheckpoint({
      task: 'choose provider after throttle', workspace, plan: [], steps: [], current_step: 1, max_steps: 10,
      total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any);
    let attempts = 0;
    const run = manager.startRun(
      {
        kind: 'coder',
        task: 'choose provider after throttle',
        workspace,
        waitForProviderAvailability: false,
      },
      async ({ emit }) => {
        attempts += 1;
        emit('checkpoint', checkpoint);
        throw new Error('All LLM providers failed: gemini: HTTP 429 retry after 20 ms');
      },
    );

    const failed = await waitForStatus(manager, run.id, 'failed');
    expect(attempts).toBe(1);
    expect(failed.result).toEqual(expect.objectContaining({
      errorCode: 'PROVIDER_WAIT_DISABLED',
      recoverable: true,
      error: expect.stringMatching(/Automatic waiting is disabled.*Continue.*same model.*another provider\/model/i),
    }));
    expect((failed.metadata as any).providerWait).toEqual(expect.objectContaining({
      terminalReason: 'PROVIDER_WAIT_DISABLED',
      retryAfterMs: 20,
    }));
    expect(manager.listEvents(run.id).map((event) => event.eventType).filter((type) => type !== 'checkpoint'))
      .toEqual(['execution_failed', 'run_terminal_advice', 'error', 'done']);
  });

  it('keeps fast runs alive through transient provider throttles', async () => {
    const manager = new ServerRunManager(createStore());
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-fast-provider-policy-'));
    const checkpoint = createReactCheckpoint({
      task: 'fail fast on provider throttle', workspace, plan: [], steps: [], current_step: 1, max_steps: 10,
      total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any);
    let attempts = 0;
    const run = manager.startRun(
      {
        kind: 'coder',
        task: 'wait through provider throttle in fast mode',
        workspace,
        metadata: { pacingProfile: 'fast' },
        waitForProviderAvailability: true,
      },
      async ({ emit }) => {
        attempts += 1;
        emit('checkpoint', checkpoint);
        if (attempts === 1) {
          throw new Error('All LLM providers failed: openrouter: HTTP 429 retry after 20 ms');
        }
        return { success: true, response: 'continued after throttle' };
      },
    );

    const waiting = await waitForStatus(manager, run.id, 'waiting_for_provider');
    expect(waiting.metadata?.providerWait).toEqual(expect.objectContaining({ attempt: 1, retryAfterMs: 20 }));
    const completed = await waitForStatus(manager, run.id, 'completed');
    expect(attempts).toBe(2);
    expect(completed.result).toEqual(expect.objectContaining({ success: true, response: 'continued after throttle' }));
    expect(manager.listEvents(run.id).map((event) => event.eventType).filter((type) => type !== 'checkpoint'))
      .toEqual(['cooldown_waiting', 'retrying', 'done']);
  });

  it('reconnects once on a fast provider timeout from the saved checkpoint', async () => {
    const manager = new ServerRunManager(createStore());
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-fast-provider-reconnect-'));
    const checkpoint = createReactCheckpoint({
      task: 'reconnect after provider timeout', workspace, plan: [], steps: [], current_step: 2, max_steps: 10,
      total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any);
    let attempts = 0;
    const run = manager.startRun(
      {
        kind: 'coder',
        task: 'reconnect after provider timeout',
        workspace,
        metadata: { pacingProfile: 'fast' },
        waitForProviderAvailability: false,
      },
      async ({ emit }) => {
        attempts += 1;
        emit('checkpoint', checkpoint);
        if (attempts === 1) {
          throw new Error('All LLM providers failed: openrouter | provider key pool: timed out');
        }
        return { success: true, response: 'reconnected' };
      },
    );

    const completed = await waitForStatus(manager, run.id, 'completed');
    expect(attempts).toBe(2);
    expect(completed.result).toEqual(expect.objectContaining({ success: true, response: 'reconnected' }));
    expect(manager.listEvents(run.id).map((event) => event.eventType)).toEqual([
      'checkpoint',
      'retrying',
      'checkpoint',
      'done',
    ]);
    expect(manager.listEvents(run.id).find((event) => event.eventType === 'retrying')?.event.data).toEqual(expect.objectContaining({
      type: 'retrying',
      attempt: 1,
      message: expect.stringMatching(/timed out.*reconnecting once.*fast mode/i),
    }));
    expect(manager.listEvents(run.id).map((event) => event.eventType)).not.toContain('cooldown_waiting');
  });

  it('reconnects once on a fast provider rate-limit pause without bypassing quota', async () => {
    const manager = new ServerRunManager(createStore());
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-fast-provider-rate-limit-reconnect-'));
    const checkpoint = createReactCheckpoint({
      task: 'reconnect after provider cooldown', workspace, plan: [], steps: [], current_step: 2, max_steps: 10,
      total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any);
    let attempts = 0;
    const run = manager.startRun(
      {
        kind: 'coder',
        task: 'reconnect after provider cooldown',
        workspace,
        metadata: { pacingProfile: 'fast' },
        waitForProviderAvailability: false,
      },
      async ({ emit }) => {
        attempts += 1;
        emit('checkpoint', checkpoint);
        if (attempts === 1) {
          throw new Error('All LLM providers failed: openrouter | provider key pool: throttled (check quota/cooldown). Provider detail: Route is paused because its rate-limit cooldown has not expired.');
        }
        return { success: true, response: 'reconnected after cooldown' };
      },
    );

    const completed = await waitForStatus(manager, run.id, 'completed');
    expect(attempts).toBe(2);
    expect(completed.result).toEqual(expect.objectContaining({ success: true, response: 'reconnected after cooldown' }));
    expect(manager.listEvents(run.id).map((event) => event.eventType)).toEqual([
      'checkpoint',
      'retrying',
      'checkpoint',
      'done',
    ]);
  });

  it('does not cooldown-loop on a successful OpenRouter response with empty content', async () => {
    const manager = new ServerRunManager(createStore());
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-openrouter-empty-content-'));
    const checkpoint = createReactCheckpoint({
      task: 'handle OpenRouter empty content', workspace, plan: [], steps: [], current_step: 1, max_steps: 10,
      total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any);
    let attempts = 0;
    const run = manager.startRun(
      { kind: 'coder', task: 'handle OpenRouter empty content', workspace, model: 'openrouter:stealth/ox-alpha' },
      async ({ emit }) => {
        attempts += 1;
        emit('checkpoint', checkpoint);
        throw new Error(
          'All LLM providers failed: - openrouter | model "stealth/ox-alpha" | provider key pool: ' +
          'empty response (finish reason: stop) Context: Requested model: stealth/ox-alpha ' +
          'Provider detail: Error: OpenRouter returned no usable chat content\n' +
          'Cause: empty response (finish reason: stop)'
        );
      },
    );

    const failed = await waitForStatus(manager, run.id, 'failed');
    expect(attempts).toBe(1);
    expect(failed.result).toEqual(expect.objectContaining({
      error: expect.stringMatching(/OpenRouter returned no usable chat content/),
    }));
    expect(manager.listEvents(run.id).map((event) => event.eventType).filter((type) => type !== 'checkpoint'))
      .toEqual(['execution_failed', 'run_terminal_advice', 'error']);
  });

  it('treats direct SambaNova availability failures as recoverable', async () => {
    const manager = new ServerRunManager(createStore());
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-sambanova-recovery-'));
    const checkpoint = createReactCheckpoint({
      task: 'recover SambaNova task', workspace, plan: [], steps: [], current_step: 0, max_steps: 10,
      total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any);
    let attempts = 0;
    const run = manager.startRun(
      { kind: 'coder', task: 'recover SambaNova task', workspace, model: 'sambanova:gpt-oss-120b', maxProviderCooldownRetries: 1 },
      async ({ emit }) => {
        attempts += 1;
        if (attempts === 1) {
          emit('checkpoint', checkpoint);
          throw new Error('Error: SambaNova API request failed\\nCause: HTTP 404 model unavailable from SambaNova\\nSuggested Fix: retry after 100 ms');
        }
        return { success: true, steps: [], stepCount: 0, pollenCost: 0 };
      },
    );

    const waiting = await waitForStatus(manager, run.id, 'waiting_for_provider');
    expect((waiting.metadata as any).providerWait).toEqual(expect.objectContaining({ attempt: 1, retryAfterMs: 100 }));
    const completed = await waitForStatus(manager, run.id, 'completed');
    expect(attempts).toBe(2);
    expect(completed.result).toEqual(expect.objectContaining({ success: true }));
  });

  it('recovers a free-mode Pollinations empty response through the checkpoint path', async () => {
    const manager = new ServerRunManager(createStore());
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-free-provider-recovery-'));
    const checkpoint = createReactCheckpoint({
      task: 'recover free model', workspace, plan: [], steps: [], current_step: 0, max_steps: 10,
      total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any);
    let attempts = 0;
    const run = manager.startRun(
      {
        kind: 'coder',
        task: 'recover free model',
        workspace,
        metadata: { pacingProfile: 'conservative' },
      },
      async ({ emit }) => {
        attempts += 1;
        if (attempts === 1) {
          emit('checkpoint', checkpoint);
          throw new Error(
            'Error: Pollinations model rotation failed\n' +
            'Cause: empty response; retry after 100 ms'
          );
        }
        return { success: true, steps: [], stepCount: 0, pollenCost: 0 };
      },
    );

    const waiting = await waitForStatus(manager, run.id, 'waiting_for_provider');
    expect((waiting.metadata as any).providerWait).toEqual(expect.objectContaining({
      attempt: 1,
      retryAfterMs: 100,
    }));
    const completed = await waitForStatus(manager, run.id, 'completed');
    expect(attempts).toBe(2);
    expect(completed.result).toEqual(expect.objectContaining({ success: true }));
    expect(manager.listEvents(run.id).map((event) => event.eventType).filter((type) => type !== 'checkpoint'))
      .toEqual(['cooldown_waiting', 'retrying', 'done']);
  });

  it('keeps long provider quota waits paused instead of falling back', async () => {
    const manager = new ServerRunManager(createStore());
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-provider-long-cooldown-'));
    const checkpoint = createReactCheckpoint({
      task: 'recover from quota', workspace, plan: [], steps: [], current_step: 2, max_steps: 10,
      total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any);
    let attempts = 0;
    const run = manager.startRun(
      { kind: 'coder', task: 'recover from quota', workspace },
      async ({ emit }) => {
        attempts += 1;
        emit('checkpoint', checkpoint);
        if (attempts === 1) {
          throw new Error('All LLM providers failed: gemini: quota exhausted; retry after 30 minutes');
        }
        return { success: true, steps: [], stepCount: 0, pollenCost: 0 };
      },
    );

    const waiting = await waitForStatus(manager, run.id, 'waiting_for_provider');
    expect((waiting.metadata as any).providerWait).toEqual(expect.objectContaining({
      attempt: 1,
      retryAfterMs: 30 * 60_000,
    }));
    expect(waiting.status).toBe('waiting_for_provider');
    expect(manager.listEvents(run.id).map((event) => event.eventType).filter((type) => type !== 'checkpoint'))
      .toEqual(['cooldown_waiting']);
    manager.stopRun(run.id, 'Stop long quota wait after asserting pause behavior');
    const stopped = await waitForStatus(manager, run.id, 'stopped');
    expect(stopped.stopReason).toBe('Stop long quota wait after asserting pause behavior');
  });

  it('stops cleanly while waiting for provider cooldown', async () => {
    const manager = new ServerRunManager(createStore());
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-provider-cooldown-stop-'));
    const checkpoint = createReactCheckpoint({
      task: 'stop during provider cooldown', workspace, plan: [], steps: [], current_step: 0, max_steps: 10,
      total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any);
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      const run = manager.startRun(
        { kind: 'coder', task: 'ask before fallback', workspace, maxProviderCooldownRetries: 1 },
        async ({ emit }) => {
          emit('checkpoint', checkpoint);
          throw new Error('All LLM providers failed: nvidia: timed out; retry after 5 seconds');
        },
      );

      await waitForStatus(manager, run.id, 'waiting_for_provider');
      expect(manager.stopRun(run.id, 'Stopped during provider cooldown')).toBe(true);
      const stopped = await waitForStatus(manager, run.id, 'stopped');
      expect(stopped.stopReason).toBe('Stopped during provider cooldown');
      expect(manager.listEvents(run.id).map((event) => event.eventType)).toContain('done');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('preserves the latest fresh checkpoint while retrying the provider', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-provider-retry-'));
    const manager = new ServerRunManager(createStore());
    const checkpoint = createReactCheckpoint({
      task: 'resume after timeout', workspace,
      plan: [{ step: 'Implement the page', status: 'in_progress' }],
      steps: [
        { thought: 'list', action: 'Command', action_input: { operation: 'list_directory', args: ['.'] }, observation: '{"success":true}' },
        { thought: 'read', action: 'Read', action_input: { file_path: 'index.html' }, observation: '{"success":true}' },
        { thought: 'read', action: 'Read', action_input: { file_path: 'style.css' }, observation: '{"success":true}' },
      ],
      current_step: 3, max_steps: 10, total_pollen_cost: 0, budget: 100, repairAttempts: 0,
      codingState: 'implement', noProgressCount: 3,
      llmUsage: { requestCount: 3, retryCount: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0 },
      continuationCount: 0,
    } as any);
    let calls = 0;
    const executedActions: string[] = [];
    let retryCheckpointStep: number | undefined;
    const run = manager.startRun(
      { kind: 'coder', task: 'resume after timeout', workspace, maxProviderCooldownRetries: 1 },
      async ({ emit, checkpoint: retryCheckpoint, providerRetryAttempt }) => {
        calls += 1;
        if (calls === 1) {
          executedActions.push('Command:list_directory', 'Read:index.html', 'Read:style.css');
          emit('checkpoint', checkpoint);
          throw new Error('All LLM providers failed: nvidia: timed out; retry after 1 ms');
        }
        retryCheckpointStep = retryCheckpoint?.state.current_step;
        expect(providerRetryAttempt).toBe(1);
        return { success: true, steps: [], stepCount: 0, pollenCost: 0 };
      },
    );

    const completed = await waitForStatus(manager, run.id, 'completed');
    expect(completed.result).toEqual(expect.objectContaining({ success: true }));
    expect(calls).toBe(2);
    expect(retryCheckpointStep).toBe(3);
    expect(executedActions).toEqual([
      'Command:list_directory',
      'Read:index.html',
      'Read:style.css',
    ]);
    expect(manager.getCheckpoint(run.id)?.state.current_step).toBe(3);
    expect((manager.getRun(run.id)?.metadata as any).efficiencyTelemetry).toEqual(expect.objectContaining({
      logicalLlmRequests: 3,
      successfulReads: 2,
      repeatedReads: 0,
      checkpointStep: 3,
      lastSuccessfulAction: expect.objectContaining({ action: 'Read' }),
      inspectedAllKnownTargetsWithoutMutation: false,
    }));
  });

  it('honors a zero automatic provider retry limit with a resumable failure', async () => {
    const manager = new ServerRunManager(createStore());
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-provider-retry-bound-'));
    const checkpoint = createReactCheckpoint({
      task: 'bounded retry', workspace, plan: [], steps: [], current_step: 0, max_steps: 10,
      total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any);
    let attempts = 0;
    const run = manager.startRun(
      { kind: 'coder', task: 'bounded retry', workspace, maxProviderCooldownRetries: 0 },
      async ({ emit }) => {
        attempts += 1;
        emit('checkpoint', checkpoint);
        throw new Error('All LLM providers failed: nvidia: timed out; retry after 1 ms');
      },
    );

    const failed = await waitForStatus(manager, run.id, 'failed');
    expect(attempts).toBe(1);
    expect(failed.result).toEqual(expect.objectContaining({
      errorCode: 'PROVIDER_RETRY_LIMIT',
      recoverable: true,
    }));
  });

  it('keeps non-provider exceptions as failed runs', async () => {
    const manager = new ServerRunManager(createStore());
    const run = manager.startRun(
      { kind: 'coder', task: 'hard failure' },
      async () => {
        throw new Error('Tool execution failed: test suite failed');
      },
    );

    const failed = await waitForStatus(manager, run.id, 'failed');
    expect(failed.result).toEqual({ error: 'Tool execution failed: test suite failed' });
  });

  it('keeps a seen failed coder run discoverable when it has a resumable checkpoint', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-failed-resume-'));
    const manager = new ServerRunManager(createStore());
    const checkpoint = createReactCheckpoint({
      task: 'continue after provider failure', workspace,
      plan: [{ step: 'Implement phase', status: 'in_progress' }],
      steps: [], current_step: 0, max_steps: 10, total_pollen_cost: 0, budget: 100, repairAttempts: 0,
    } as any);
    const run = manager.startRun(
      { kind: 'coder', threadId: 'thread-failed', task: 'continue after provider failure', workspace },
      async ({ emit }) => {
        emit('checkpoint', checkpoint);
        return { success: false, error: 'Providers exhausted', steps: [], stepCount: 0, pollenCost: 0 };
      },
    );
    await waitForStatus(manager, run.id, 'failed');
    manager.markSeen(run.id);

    expect(manager.listRuns({ kind: 'coder' }).map((item) => item.id)).not.toContain(run.id);
    expect(manager.listRuns({ kind: 'coder', resumable: true })).toEqual([
      expect.objectContaining({
        id: run.id,
        status: 'failed',
        metadata: expect.objectContaining({ continuationAvailable: true }),
      }),
    ]);
  });

  it('lists lightweight run summaries without checkpoint or result payloads', async () => {
    const manager = new ServerRunManager(createStore());
    const run = manager.startRun(
      {
        kind: 'coder',
        task: 'summary task',
        metadata: { displayTask: 'Visible task', checkpoint: { large: 'x'.repeat(20_000) } },
      },
      async () => ({ success: true, output: 'x'.repeat(20_000), steps: [], stepCount: 0, pollenCost: 0 })
    );

    await waitForStatus(manager, run.id, 'completed');
    const summary = manager.listRuns().find((item) => item.id === run.id);

    expect(summary?.metadata).toEqual({ displayTask: 'Visible task' });
    expect(summary?.result).toBeUndefined();
  });

  it('filters coder run summaries before applying the picker limit', () => {
    const store = createStore();
    store.createAgentRun({
      id: 'saved-coder-run', kind: 'coder', threadId: 'thread-1', status: 'interrupted', task: 'Resume the coder session',
      createdAt: 1, updatedAt: 1, lastEventSeq: 0,
    });
    store.createAgentRun({
      id: 'newer-agent-run', kind: 'agent', status: 'completed', task: 'Background agent record',
      createdAt: 2, updatedAt: 2, lastEventSeq: 0,
    });

    expect(store.listAgentRunSummaries(1, 'coder').map((run) => run.id)).toEqual(['saved-coder-run']);
  });

  it('stores server and engine performance traces in run metadata', async () => {
    const manager = new ServerRunManager(createStore());
    const engineTrace = {
      name: 'react-engine-run',
      startedAt: Date.now(),
      endedAt: Date.now(),
      durationMs: 1,
      eventCounts: { run_started: 1 },
      counters: { steps: 0 },
      spans: [],
    };
    const run = manager.startRun(
      { kind: 'react', task: 'trace me' },
      async ({ emit }) => {
        emit('progress', 'working');
        return {
          success: true,
          steps: [],
          stepCount: 0,
          pollenCost: 0,
          performanceTrace: engineTrace,
        };
      }
    );

    const completed = await waitForStatus(manager, run.id, 'completed');
    const metadata = completed.metadata as any;

    expect(metadata.performanceTrace.server.name).toBe('server-run');
    expect(metadata.performanceTrace.server.eventCounts.progress).toBe(1);
    expect(metadata.performanceTrace.server.eventCounts.done).toBe(1);
    expect(metadata.performanceTrace.engine).toEqual(engineTrace);
  });

  it('persists performance traces on run audit records', () => {
    const store = createStore();
    const performanceTrace = {
      name: 'react-engine-run',
      startedAt: Date.now(),
      endedAt: Date.now(),
      durationMs: 42,
      eventCounts: { run_started: 1 },
      counters: { estimated_context_tokens: 1234 },
      spans: [{ name: 'step.execute_tool', startedAt: Date.now(), endedAt: Date.now(), durationMs: 17 }],
    };

    store.saveRun({
      id: 'TRACE1',
      task: 'trace audit',
      model: 'test-model',
      timestamp: new Date().toISOString(),
      success: true,
      stepCount: 0,
      totalPollenCost: 0,
      budget: 100,
      steps: [],
      performanceTrace,
    }, 'raw log');

    const [run] = store.getRecentRuns<any>(1);
    expect(run.performanceTrace).toEqual(performanceTrace);
  });

  it('persists task-scoped approval decisions and drops expired grants', async () => {
    const manager = new ServerRunManager(createStore());
    const run = manager.startRun({ kind: 'coder', task: 'approval scope' }, async () => ({ success: true }));
    const approvals = manager.decideApprovalScope(run.id, { scope: 'install:npm install demo', decision: 'allow' });
    expect(approvals).toEqual([expect.objectContaining({ scope: 'install:npm install demo', decision: 'allow' })]);
    expect(manager.getApprovalGrants(run.id)).toHaveLength(1);
    manager.decideApprovalScope(run.id, { scope: 'install:npm install demo', decision: 'deny' });
    expect(manager.getApprovalGrants(run.id)).toEqual([expect.objectContaining({ decision: 'deny' })]);
    manager.setApprovalGrants(run.id, [{ scope: '*', decision: 'allow', createdAt: 1, expiresAt: 2 }]);
    expect(manager.getApprovalGrants(run.id)).toEqual([]);
    await waitForStatus(manager, run.id, 'completed');
  });
});
