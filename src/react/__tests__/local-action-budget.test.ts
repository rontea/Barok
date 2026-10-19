import { describe, expect, it } from '@jest/globals';
import {
  LocalActionBudgetController,
  localWriteChunkCharacters,
} from '../local-action-budget.js';

describe('adaptive local structured-action budgets', () => {
  it('caps a slow model before the provider deadline and keeps Write chunks bounded', () => {
    const controller = new LocalActionBudgetController({
      defaultGenerationTokensPerSecond: 18,
      promptTokensPerSecond: 300,
      safetyMarginMs: 10_000,
    });

    controller.observe({
      provider: 'local',
      model: 'qwen3-local',
      status: 'succeeded',
      durationMs: 90_000,
      estimatedInputTokens: 12_000,
      estimatedOutputTokens: 1_200,
    });

    const decision = controller.resolve({
      model: 'qwen3-local',
      configuredMaxTokens: 4_000,
      promptTokens: 12_000,
      remainingBudgetMs: 90_000,
      actionClass: 'implementation',
    });

    // 40 seconds remain after a 40-second prefill estimate and 10-second
    // safety margin; the measured 24 tok/s decode rate yields 960 tokens.
    expect(decision.maxTokens).toBe(960);
    expect(decision.maxTokens).toBeLessThan(4_000);
    expect(decision.measured).toBe(true);
    expect(decision.writeChunkCharacters).toBeLessThan(3_000);
    expect(localWriteChunkCharacters(decision.maxTokens)).toBe(decision.writeChunkCharacters);
  });

  it('uses smaller budgets for inspection and recovery turns', () => {
    const controller = new LocalActionBudgetController({
      defaultGenerationTokensPerSecond: 200,
      promptTokensPerSecond: 1_000,
      safetyMarginMs: 1_000,
    });

    const inspection = controller.resolve({
      model: 'local-fast',
      configuredMaxTokens: 4_000,
      promptTokens: 1_000,
      remainingBudgetMs: 60_000,
      actionClass: 'inspection',
    });
    const recovery = controller.resolve({
      model: 'local-fast',
      configuredMaxTokens: 4_000,
      promptTokens: 1_000,
      remainingBudgetMs: 60_000,
      actionClass: 'recovery',
    });

    expect(inspection.maxTokens).toBe(640);
    expect(recovery.maxTokens).toBe(512);
    expect(recovery.writeChunkCharacters).toBeLessThanOrEqual(inspection.writeChunkCharacters);
  });

  it('ignores non-local telemetry and falls back safely without a deadline', () => {
    const controller = new LocalActionBudgetController({ defaultGenerationTokensPerSecond: 20 });
    controller.observe({
      provider: 'openrouter',
      model: 'remote-model',
      status: 'succeeded',
      durationMs: 100,
      estimatedOutputTokens: 1_000,
    });

    const decision = controller.resolve({
      model: 'unseen-local',
      configuredMaxTokens: 4_000,
      promptTokens: 0,
      actionClass: 'implementation',
    });

    expect(decision.maxTokens).toBe(4_000);
    expect(decision.measured).toBe(false);
    expect(decision.generationTokensPerSecond).toBe(20);
  });

  it('does not let the structured-action minimum overrun a nearly expired deadline', () => {
    const controller = new LocalActionBudgetController({
      defaultGenerationTokensPerSecond: 20,
      promptTokensPerSecond: 1_000,
      safetyMarginMs: 1_000,
    });

    const decision = controller.resolve({
      model: 'slow-local',
      configuredMaxTokens: 4_000,
      promptTokens: 1_000,
      remainingBudgetMs: 1_500,
      actionClass: 'implementation',
    });

    expect(decision.maxTokens).toBe(1);
  });
});
