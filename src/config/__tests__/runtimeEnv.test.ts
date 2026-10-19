import { describe, expect, it } from '@jest/globals';
import { getLegacyOpenRouterConfigurationWarning, resolvePollinationsApiKey } from '../runtimeEnv.js';

describe('OpenRouter runtime configuration policy', () => {
  it('warns without exposing legacy key-pool values', () => {
    const warning = getLegacyOpenRouterConfigurationWarning('sk-or-v1-secret-value');

    expect(warning).toMatch(/OPENROUTER_API_KEYS is not supported/i);
    expect(warning).toMatch(/OPENROUTER_API_KEY/);
    expect(warning).not.toContain('sk-or-v1-secret-value');
  });

  it('does not warn when no legacy key pool is configured', () => {
    expect(getLegacyOpenRouterConfigurationWarning('')).toBeNull();
  });

  it('prefers the explicit Pollinations .env key over an inherited process key', () => {
    expect(resolvePollinationsApiKey('file-key', 'process-key')).toBe('file-key');
    expect(resolvePollinationsApiKey('', 'process-key')).toBe('process-key');
  });
});
