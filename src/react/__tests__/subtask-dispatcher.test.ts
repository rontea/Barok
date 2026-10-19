import { describe, expect, it } from '@jest/globals';
import { CHILD_RUN_PROTOCOL_VERSION, type ChildRunReport } from '../../agents/child-runs.js';
import type { ReactState } from '../state-manager.js';
import { EngineSubtaskDispatcher } from '../subtask-dispatcher.js';

function createState(
  objectives = ['Update src/alpha.ts', 'Update src/beta.ts'],
  files = ['src/alpha.ts', 'src/beta.ts'],
): ReactState {
  return {
    task: 'Implement the requested scoped changes.',
    workspace: 'C:/workspace',
    model: 'parent-model',
    modelContextWindow: 32_768,
    plan: objectives.map((step) => ({ step, status: 'pending' as const })),
    steps: [{
      thought: 'PRIVATE_REASONING_SHOULD_NOT_CROSS_THE_CHILD_BOUNDARY',
      action: 'Command',
      action_input: { command: 'npm test -- --runInBand' },
      observation: JSON.stringify({ success: false, error: 'One scoped check failed.' }),
    }],
    taskAnalysis: {
      taskKind: 'feature',
      affectedFiles: files.map((file) => ({ path: file, intent: 'modify', reason: 'Requested implementation work.', mustReadBeforeEdit: true })),
      verificationPlan: ['Run the relevant scoped checks.'],
    },
  } as unknown as ReactState;
}

function report(childId: string, success = true, changedFiles: string[] = []): ChildRunReport {
  return {
    protocolVersion: CHILD_RUN_PROTOCOL_VERSION,
    childId,
    success,
    changedFiles,
    checks: [{ name: 'scoped verification', status: success ? 'passed' : 'failed', output: 'x'.repeat(800) }],
    blockers: success ? [] : ['Scoped verification failed.'],
    evidenceRefs: [`${childId}:verification`],
    createdAt: 1,
  };
}

describe('EngineSubtaskDispatcher', () => {
  it('dispatches disjoint fresh-context work sequentially and aggregates bounded child reports', async () => {
    const state = createState();
    const events: Array<{ type: string; data: any }> = [];
    const launched: Array<{ contract: any; task: string; evidenceSummary: string }> = [];
    let activeChildren = 0;
    let maxActiveChildren = 0;
    const dispatcher = new EngineSubtaskDispatcher({
      contextWindow: 32_768,
      model: 'gemini-3.1-flash',
      onEvent: (type, data) => events.push({ type, data }),
      launch: async (input) => {
        activeChildren += 1;
        maxActiveChildren = Math.max(maxActiveChildren, activeChildren);
        launched.push(input);
        await Promise.resolve();
        activeChildren -= 1;
        return report(input.contract.id, true, input.contract.fileScope);
      },
    });

    const result = await dispatcher.dispatch(state, 'context_pressure');

    expect(result.status).toBe('completed');
    expect(result.model).toBe('gemini-3.1-flash');
    expect(result.contextWindow).toBe(32_768);
    expect(launched.map((input) => input.contract.id)).toEqual(['subtask-01', 'subtask-02']);
    expect(launched[1].contract.dependencies).toEqual(['subtask-01']);
    expect(launched[1].task).toContain('Completed dependency report');
    expect(launched[0].task).toContain('Start with fresh workspace inspection');
    expect(launched[0].task).not.toContain('PRIVATE_REASONING_SHOULD_NOT_CROSS_THE_CHILD_BOUNDARY');
    expect(maxActiveChildren).toBe(1);
    expect(result.reports).toHaveLength(2);
    expect(result.reports[0].changedFiles).toEqual(['src/alpha.ts']);
    expect(result.reports[0].checks[0].output?.length).toBeLessThanOrEqual(240);
    expect(events.find((event) => event.type === 'subtask_started')?.data).toMatchObject({
      model: 'gemini-3.1-flash',
      contextWindow: 32_768,
      sequence: 1,
      total: 2,
    });
    expect(events.at(-1)?.type).toBe('subtask_dispatch_completed');
  });

  it('blocks conflicting file scopes before launching a child', async () => {
    let launchCount = 0;
    const dispatcher = new EngineSubtaskDispatcher({
      contextWindow: 32_768,
      launch: async () => {
        launchCount += 1;
        return report('unexpected');
      },
    });

    const result = await dispatcher.dispatch(
      createState(['Update src/shared.ts in phase one', 'Update src/shared.ts in phase two'], ['src/shared.ts']),
      'context_pressure',
    );

    expect(result.status).toBe('blocked');
    expect(result.blockers[0]).toMatch(/file scopes .* overlap/i);
    expect(launchCount).toBe(0);
  });

  it('does not start dependent work after an earlier child fails', async () => {
    const started: string[] = [];
    const dispatcher = new EngineSubtaskDispatcher({
      contextWindow: 32_768,
      launch: async ({ contract }) => {
        started.push(contract.id);
        return report(contract.id, false, contract.fileScope);
      },
    });

    const result = await dispatcher.dispatch(createState(), 'context_pressure');

    expect(started).toEqual(['subtask-01']);
    expect(result.status).toBe('blocked');
    expect(result.reports).toHaveLength(1);
    expect(result.blockers[0]).toContain('subtask-01 failed');
  });

  it('hands off bounded overflow evidence without parent reasoning or raw history', async () => {
    let childTask = '';
    const dispatcher = new EngineSubtaskDispatcher({
      contextWindow: 32_768,
      launch: async ({ contract, task }) => {
        childTask = task;
        return report(contract.id, true, contract.fileScope);
      },
    });

    await dispatcher.dispatch(createState(), 'context_overflow');

    expect(childTask).toContain('previous parent prompt exceeded the resolved model context');
    expect(childTask).not.toContain('PRIVATE_REASONING_SHOULD_NOT_CROSS_THE_CHILD_BOUNDARY');
    expect(childTask).not.toContain('npm test -- --runInBand');
  });

  it('stops dispatch when the parent cancellation signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let launchCount = 0;
    const dispatcher = new EngineSubtaskDispatcher({
      contextWindow: 32_768,
      signal: controller.signal,
      launch: async () => {
        launchCount += 1;
        return report('unexpected');
      },
    });

    const result = await dispatcher.dispatch(createState(), 'context_pressure');

    expect(result.status).toBe('cancelled');
    expect(launchCount).toBe(0);
  });

  it('rejects a child contract that cannot fit the resolved context budget', async () => {
    let launchCount = 0;
    const dispatcher = new EngineSubtaskDispatcher({
      contextWindow: 1_024,
      launch: async () => {
        launchCount += 1;
        return report('unexpected');
      },
    });

    const result = await dispatcher.dispatch(createState(), 'context_pressure');

    expect(result.status).toBe('blocked');
    expect(result.blockers[0]).toMatch(/safe input budget/i);
    expect(launchCount).toBe(0);
  });
});
