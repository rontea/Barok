import { describe, expect, it } from '@jest/globals';
import { loadGroqRuntimeConfigSafe } from '../../../config/groqConfig.js';
import { GroqLLMProvider } from '../groqProvider.js';

describe('optional live Groq smoke test', () => {
  const enabled = process.env.RUN_GROQ_SMOKE === '1';
  (enabled ? it : it.skip)('responds through the explicitly configured Groq route', async () => {
    const config = loadGroqRuntimeConfigSafe();
    expect(config.enabled).toBe(true);
    expect(config.apiKey).toBeTruthy();
    expect(config.defaultModel).toBeTruthy();
    const response = await new GroqLLMProvider().createChatCompletion(
      [{ role: 'user', content: 'Reply with exactly: GROQ_SMOKE_OK' }],
      config.defaultModel,
      { temperature: 0, maxTokens: 16, timeoutMs: 20_000 },
    );
    expect(response.toUpperCase()).toContain('GROQ_SMOKE_OK');
  });
});
