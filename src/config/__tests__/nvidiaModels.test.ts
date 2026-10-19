import { describe, expect, it } from '@jest/globals';
import {
  getNvidiaChatModelIds,
  getNvidiaModelMetadata,
  getNvidiaModelReplacement,
  getNvidiaTargetModelId,
} from '../nvidiaModels.js';
import { getDefaultNvidiaModelTargets } from '../nvidiaTargets.js';

describe('NVIDIA model catalog', () => {
  it('retires the broken DeepSeek ID and keeps saved target IDs stable', () => {
    const modelIds = getNvidiaChatModelIds();

    expect(modelIds).not.toContain('deepseek-ai/deepseek-v4-flash');
    expect(modelIds).toContain('deepseek-ai/deepseek-v4-flash-0731');
    expect(getNvidiaModelReplacement('deepseek-ai/deepseek-v4-flash')).toBe(
      'deepseek-ai/deepseek-v4-flash-0731',
    );
    expect(getNvidiaTargetModelId('deepseek-ai/deepseek-v4-flash-0731')).toBe(
      'deepseek-ai/deepseek-v4-flash',
    );
  });

  it('includes the currently available NVIDIA free chat models', () => {
    const modelIds = getNvidiaChatModelIds();
    const expectedModelIds = [
      'poolside/laguna-xs-2.1',
      'nvidia/nemotron-3-nano-30b-a3b',
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
      'nvidia/nvidia-nemotron-nano-9b-v2',
      'nvidia/llama-3.3-nemotron-super-49b-v1.5',
      'openai/gpt-oss-20b',
      'openai/gpt-oss-120b',
      'mistralai/mistral-nemotron',
      'thinkingmachines/inkling',
      'nvidia/llama-3.3-nemotron-super-49b-v1',
      'nvidia/llama-3.1-nemotron-nano-8b-v1',
      'nvidia/llama-3.1-nemotron-nano-vl-8b-v1',
    ];

    for (const modelId of expectedModelIds) {
      expect(modelIds).toContain(modelId);
      expect(getNvidiaModelMetadata(modelId)?.apiFamily).toBe('chat-completions');
    }
  });

  it('provides editable request controls for every selectable NVIDIA chat target', () => {
    const targets = getDefaultNvidiaModelTargets(['test-key']);

    expect(targets).toHaveLength(getNvidiaChatModelIds().length);
    for (const target of targets) {
      expect(target.temperature).toEqual(expect.any(Number));
      expect(target.topP).toEqual(expect.any(Number));
      expect(target.maxTokens).toEqual(expect.any(Number));
      expect(target.stream).toBe(false);
    }
  });
});
