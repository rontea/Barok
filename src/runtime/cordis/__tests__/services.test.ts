import { describe, expect, it } from '@jest/globals';
import { createCordisContextAssemblyService } from '../services.js';
import { estimateMessagesTokens, estimateTextTokens } from '../../../react/token-accounting.js';
import { reason } from '../../../react/planner.js';
import type { ReactState } from '../../../react/state-manager.js';
import type { LLMProvider } from '../../../di/types.js';

describe('Cordis context assembly service', () => {
  it('hydrates a durable snapshot and rebinds the live target window', () => {
    const service = createCordisContextAssemblyService({
      version: 1,
      runId: 'run-1',
      contextId: 'run-1:react-context',
      revision: 1,
      eventSeq: 2,
      model: 'parent-model',
      modelContextWindow: 32_768,
      tokenEstimate: 10,
      compactionVersion: 'test',
      messages: [{ id: 'task', role: 'user', content: 'saved task' }],
      evidenceIds: [],
      createdAt: 1,
      updatedAt: 1,
    }, { model: 'child-model', contextWindow: 8_192 });

    expect(service.getMessages()).toEqual([{ id: 'task', role: 'user', content: 'saved task' }]);
    expect(service.getTarget()).toMatchObject({ model: 'child-model', contextWindow: 8_192 });

    service.setTarget({ model: 'replacement-model', contextWindow: 16_384 });
    expect(service.getTarget()).toMatchObject({ model: 'replacement-model', contextWindow: 16_384 });
  });

  it('compacts a prompt before it exceeds the active model budget', () => {
    const service = createCordisContextAssemblyService(undefined, {
      model: 'small-local-model',
      contextWindow: 8_192,
    });
    const messages = [
      { role: 'system', content: 'System rules' },
      { role: 'user', content: 'x'.repeat(50_000) },
    ];

    const prepared = service.prepareMessages(messages);

    expect(prepared.promptBudgetTokens).toBe(6_144);
    expect(prepared.removedCharacters).toBeGreaterThan(0);
    expect(prepared.estimatedInputTokens).toBeLessThanOrEqual(prepared.promptBudgetTokens!);
    expect(estimateTextTokens(prepared.messages.at(-1)?.content || '')).toBeLessThan(6_144);
  });

  it('scales planner sections when the active model has a smaller window', () => {
    const service = createCordisContextAssemblyService(undefined, {
      model: 'small-local-model',
      contextWindow: 8_192,
    });
    const compacted = service.compactSections({
      task: 'task',
      plan: 'plan',
      active_errors: 'errors',
      permissions: 'permissions',
      evidence: 'evidence',
      history: 'h'.repeat(40_000),
    });

    expect(compacted.history.length).toBeLessThan(16_000);
    expect(compacted.task).toBe('task');
  });

  it('keeps the planner request inside the same local window used after resume', async () => {
    const service = createCordisContextAssemblyService(undefined, {
      model: 'small-local-model',
      contextWindow: 8_192,
    });
    const prompts: Array<Array<{ role: string; content: string }>> = [];
    const llm: LLMProvider = {
      createChatCompletion: async (messages) => {
        prompts.push(messages);
        return 'Inspect the current task evidence.';
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'mock',
      isAvailable: () => true,
    };
    const state = {
      task: 'Resume and finish the implementation safely.',
      workspace: process.cwd(),
      steps: Array.from({ length: 12 }, (_, index) => ({
        thought: 'Inspect the current implementation.',
        action: 'Read',
        action_input: { file_path: `src/file-${index}.ts` },
        observation: 'x'.repeat(4_000),
      })),
      plan: [{ step: 'Finish the implementation', status: 'in_progress' }],
      current_step: 12,
      max_steps: 20,
      total_pollen_cost: 0,
      budget: 100,
    } as unknown as ReactState;

    await reason(state, llm, { model: 'small-local-model', contextAssembly: service });

    expect(prompts).toHaveLength(1);
    expect(estimateMessagesTokens(prompts[0])).toBeLessThanOrEqual(6_144);
  });
});
