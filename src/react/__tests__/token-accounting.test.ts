import {
  estimateContextWindow,
  estimateMessagesTokens,
  estimateReactStepContext,
  compactContextByBudget,
  estimateTextTokens,
  extractTokenUsageSnapshot,
  estimateCompactionTokenSavings,
  DEFAULT_CONTEXT_BUDGETS,
  LOCAL_CONTEXT_BUDGETS,
  resolveContextBudgets,
} from '../token-accounting.js';

describe('token-accounting', () => {
  it('selects a smaller context profile for local routes while preserving cloud defaults', () => {
    expect(resolveContextBudgets({ provider: 'local' })).toBe(LOCAL_CONTEXT_BUDGETS);
    expect(resolveContextBudgets({ provider: 'COLAB' })).toBe(LOCAL_CONTEXT_BUDGETS);
    expect(resolveContextBudgets({ model: 'local:qwen3-local' })).toBe(LOCAL_CONTEXT_BUDGETS);
    expect(resolveContextBudgets({ provider: 'openrouter', model: 'openai/gpt-5' })).toBe(DEFAULT_CONTEXT_BUDGETS);

    const defaultTotal = DEFAULT_CONTEXT_BUDGETS.reduce((sum, budget) => sum + budget.maxTokens, 0);
    const localTotal = LOCAL_CONTEXT_BUDGETS.reduce((sum, budget) => sum + budget.maxTokens, 0);
    expect(LOCAL_CONTEXT_BUDGETS.find((budget) => budget.category === 'history')?.maxTokens).toBe(1_500);
    expect(localTotal).toBeLessThan(defaultTotal);
  });

  it('estimates text and message tokens with stable overhead', () => {
    expect(estimateTextTokens('123456789')).toBe(3);

    const tokens = estimateMessagesTokens([
      { role: 'user', content: 'hello world' },
      { role: 'assistant', content: { action: 'Read', path: 'src/index.ts' } },
    ]);

    expect(tokens).toBeGreaterThan(16);
  });

  it('extracts OpenAI token usage', () => {
    expect(extractTokenUsageSnapshot({
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
      },
    })).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      source: 'openai',
    });
  });

  it('extracts Gemini token usage with totalTokenCount when available', () => {
    expect(extractTokenUsageSnapshot({
      usageMetadata: {
        promptTokenCount: 200,
        candidatesTokenCount: 50,
        totalTokenCount: 260,
      },
    })).toEqual({
      promptTokens: 200,
      completionTokens: 50,
      totalTokens: 260,
      source: 'gemini',
    });
  });

  it('uses the latest known usage as a baseline and estimates only new messages', () => {
    const estimate = estimateContextWindow([
      { role: 'user', content: 'old prompt' },
      { role: 'assistant', content: 'old response', tokenUsage: { promptTokens: 80, completionTokens: 20, totalTokens: 100 } },
      { role: 'user', content: 'new follow-up' },
    ]);

    expect(estimate.baselineTokens).toBe(100);
    expect(estimate.usageSource).toBe('react');
    expect(estimate.estimatedNewTokens).toBe(estimateMessagesTokens([{ role: 'user', content: 'new follow-up' }]));
    expect(estimate.totalTokens).toBe(100 + estimate.estimatedNewTokens);
  });

  it('estimates ReAct step context from thoughts, actions, observations, and final answers', () => {
    const estimate = estimateReactStepContext([
      {
        thought: 'Need to inspect the file.',
        action: 'Read',
        action_input: { path: 'src/react/engine.ts' },
        observation: 'file contents',
      },
      {
        thought: 'Done.',
        action: 'Finish',
        action_input: {},
        final_answer: 'All set.',
      },
    ]);

    expect(estimate.messageCount).toBe(4);
    expect(estimate.totalTokens).toBeGreaterThan(0);
  });

  it('compacts history without consuming required active-error budget', () => {
    const compacted = compactContextByBudget({
      task: 'Implement the requested behavior.',
      active_errors: 'E'.repeat(20_000),
      history: 'H'.repeat(40_000),
    });
    expect(compacted.active_errors).toContain('[active_errors compacted]');
    expect(compacted.history).toContain('[history compacted]');
    expect(compacted.task).toBe('Implement the requested behavior.');
  });

  it('compares estimated context tokens before and after observation compaction', () => {
    const savings = estimateCompactionTokenSavings('x'.repeat(20_000), 'x'.repeat(2_000));
    expect(savings.originalTokens).toBe(5_000);
    expect(savings.compactedTokens).toBe(500);
    expect(savings.savedTokens).toBe(4_500);
    expect(savings.reductionPercentage).toBe(90);
  });
});
