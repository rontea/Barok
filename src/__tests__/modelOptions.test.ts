import { describe, expect, it } from '@jest/globals';
import { dedupeModelOptions, POLLINATIONS_TEXT_MODEL_OPTIONS, type ModelOption } from '../../ui/src/modelOptions';

describe('coder model options', () => {
  it('keeps current free OpenRouter routes selectable', () => {
    const freeRoutes = [
      'openrouter:openrouter/free',
      'openrouter:inclusionai/ling-3.0-flash-fin:free',
      'openrouter:inclusionai/ling-3.0-flash-sante:free',
      'openrouter:cohere/north-mini-code:free',
      'openrouter:nvidia/nemotron-3-ultra-550b-a55b:free',
      'openrouter:nvidia/nemotron-3-super-120b-a12b:free',
      'openrouter:poolside/laguna-s-2.1:free',
      'openrouter:poolside/laguna-xs-2.1:free',
      'openrouter:dots-studio/dots-3-note-preview:free',
      'openrouter:thinkingmachines/inkling:free',
      'openrouter:google/gemma-4-26b-a4b-it:free',
      'openrouter:google/gemma-4-31b-it:free',
    ];

    for (const value of freeRoutes) {
      expect(POLLINATIONS_TEXT_MODEL_OPTIONS.map((option) => option.value)).toContain(value);
    }
    expect(POLLINATIONS_TEXT_MODEL_OPTIONS.map((option) => option.value))
      .not.toContain('openrouter:stealth/ox-alpha');
    expect(POLLINATIONS_TEXT_MODEL_OPTIONS.map((option) => option.value))
      .not.toContain('openrouter:minimax/minimax-m3:free');
    expect(POLLINATIONS_TEXT_MODEL_OPTIONS.map((option) => option.value))
      .not.toContain('openrouter:z-ai/glm-5.2:free');
  });

  it('deduplicates configured targets and direct routes by provider/model identity', () => {
    const options: ModelOption[] = [
      {
        value: 'nvidia-target:key-1-poolside-laguna-xs-2-1',
        label: 'Key 1 - Poolside Laguna XS 2.1',
        provider: 'NVIDIA',
        source: 'api-target',
        modelId: 'poolside/laguna-xs-2.1',
      },
      {
        value: 'poolside/laguna-xs-2.1',
        label: 'NVIDIA Poolside Laguna XS 2.1',
        provider: 'NVIDIA',
        source: 'direct',
      },
    ];

    expect(dedupeModelOptions(options).map((option) => option.value))
      .toEqual(['nvidia-target:key-1-poolside-laguna-xs-2-1']);
  });

  it('preserves the current route when it is an equivalent duplicate', () => {
    const options: ModelOption[] = [
      {
        value: 'gemini-target:primary-gemini-3-6-flash',
        label: 'Primary - Gemini 3.6 Flash',
        provider: 'Gemini',
        source: 'api-target',
        modelId: 'gemini-3.6-flash',
        profileId: 'primary',
      },
      {
        value: 'gemini-3.6-flash',
        label: 'Gemini (Native) 3.6 Flash',
        provider: 'Gemini',
        source: 'direct',
      },
    ];

    expect(dedupeModelOptions(options, 'gemini-3.6-flash').map((option) => option.value))
      .toEqual(['gemini-3.6-flash']);
  });

  it('keeps the same NVIDIA model selectable for each configured API key', () => {
    const options: ModelOption[] = [0, 1, 2].map((apiKeyIndex) => ({
      value: `nvidia-target:key-${apiKeyIndex + 1}-minimax-m3`,
      label: `Key ${apiKeyIndex + 1} - NVIDIA MiniMax M3`,
      provider: 'NVIDIA',
      source: 'api-target',
      modelId: 'minimaxai/minimax-m3',
      apiKeyIndex,
    }));

    expect(dedupeModelOptions(options).map((option) => option.value))
      .toEqual([
        'nvidia-target:key-1-minimax-m3',
        'nvidia-target:key-2-minimax-m3',
        'nvidia-target:key-3-minimax-m3',
      ]);
  });
});
