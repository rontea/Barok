import { describe, expect, it } from '@jest/globals';
import { CompositeLLMProvider } from '../providers/llmProvider.js';
import type { LLMProvider } from '../types.js';

function provider(name: string, calls: string[]): LLMProvider {
  return {
    createChatCompletion: async (_messages, model) => {
      calls.push(`${name}:${model}`);
      return `${name} response`;
    },
    estimateStepCost: () => 0,
    getProviderName: () => name,
    isAvailable: () => true,
  };
}

describe('Pollinations model target routing', () => {
  it('routes an explicit persisted Pollinations model target to Pollinations', async () => {
    const calls: string[] = [];
    const composite = new CompositeLLMProvider([
      provider('openrouter', calls),
      provider('pollinations', calls),
    ]);

    await expect(composite.createChatCompletion(
      [{ role: 'user', content: 'hello' }],
      'pollinations:community/example-chat',
      { allowCrossProviderFallback: false },
    )).resolves.toBe('pollinations response');

    expect(calls).toEqual(['pollinations:community/example-chat']);
  });
});
