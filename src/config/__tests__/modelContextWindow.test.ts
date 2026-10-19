import { describe, expect, it } from '@jest/globals';
import { resolveModelContextWindow } from '../modelConfig';

describe('resolveModelContextWindow', () => {
  it('resolves registered and provider-prefixed model names', () => {
    expect(resolveModelContextWindow('z-ai/glm-5.2')).toBe(1_000_000);
    expect(resolveModelContextWindow('nvidia:z-ai/glm-5.2')).toBe(1_000_000);
    expect(resolveModelContextWindow('deepseek-ai/deepseek-v4-flash')).toBe(1_000_000);
    expect(resolveModelContextWindow('nvidia:deepseek-ai/deepseek-v4-flash')).toBe(1_000_000);
    expect(resolveModelContextWindow('deepseek-ai/deepseek-v4-flash-0731')).toBe(1_000_000);
    expect(resolveModelContextWindow('nvidia/nemotron-3-nano-30b-a3b')).toBe(262_144);
    expect(resolveModelContextWindow('nvidia/nvidia-nemotron-nano-9b-v2')).toBe(131_072);
    expect(resolveModelContextWindow('stepfun-ai/step-3.7-flash')).toBe(262_144);
    expect(resolveModelContextWindow('nvidia:stepfun-ai/step-3.7-flash')).toBe(262_144);
    expect(resolveModelContextWindow('google/gemma-4-31b-it')).toBe(262_144);
    expect(resolveModelContextWindow('nvidia:google/gemma-4-31b-it')).toBe(262_144);
    expect(resolveModelContextWindow('google/diffusiongemma-26b-a4b-it')).toBe(262_144);
    expect(resolveModelContextWindow('nvidia:google/diffusiongemma-26b-a4b-it')).toBe(262_144);
    expect(resolveModelContextWindow('moonshotai/kimi-k2.6')).toBe(262_144);
    expect(resolveModelContextWindow('nvidia:moonshotai/kimi-k2.6')).toBe(262_144);
  });

  it('supports known Gemini generations and leaves unknown models unresolved', () => {
    expect(resolveModelContextWindow('gemini:gemini-2.5-pro')).toBe(1_000_000);
    expect(resolveModelContextWindow('stealth/ox-alpha')).toBe(1_048_576);
    expect(resolveModelContextWindow('openrouter:stealth/ox-alpha')).toBe(1_048_576);
    expect(resolveModelContextWindow('unregistered-model')).toBeUndefined();
  });
});
