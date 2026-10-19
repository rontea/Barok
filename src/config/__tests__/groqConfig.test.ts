import { describe, expect, it } from '@jest/globals';
import { groqSettingsSchema, resolveGroqRoleModel } from '../groqConfig.js';

describe('Groq configuration', () => {
  it('uses bounded, disabled-by-default settings without a hard-coded model', () => {
    const settings = groqSettingsSchema.parse({});
    expect(settings.enabled).toBe(false);
    expect(settings.defaultModel).toBe('');
    expect(settings.maxConcurrency).toBe(1);
    expect(settings.maxPendingRequests).toBe(25);
    expect(settings.maxRequestsPerTask).toBe(10);
    expect(settings.fallbackEnabled).toBe(false);
  });

  it('rejects settings outside safe bounds', () => {
    expect(() => groqSettingsSchema.parse({ requestTimeoutSeconds: 1 })).toThrow();
    expect(() => groqSettingsSchema.parse({ maxRetries: 4 })).toThrow();
    expect(() => groqSettingsSchema.parse({ maxConcurrency: 0 })).toThrow();
    expect(() => groqSettingsSchema.parse({ maxPendingRequests: 101 })).toThrow();
  });

  it('resolves role models before the configured default', () => {
    const settings = groqSettingsSchema.parse({ defaultModel: 'default-id', coderModel: 'coder-id' });
    expect(resolveGroqRoleModel('coder', settings)).toBe('coder-id');
    expect(resolveGroqRoleModel('reviewer', settings)).toBe('default-id');
  });

  it('returns a configuration error when neither role nor default is configured', () => {
    expect(() => resolveGroqRoleModel('planner', groqSettingsSchema.parse({}))).toThrow(/not configured/i);
  });

  it('stores capabilities as explicit configuration rather than model-name inference', () => {
    const settings = groqSettingsSchema.parse({
      capabilities: {
        arbitrary_model_name: {
          streaming: true,
          toolCalling: true,
          structuredOutput: false,
          jsonMode: true,
          vision: false,
          contextTokenLimit: 8192,
          outputTokenLimit: 1024,
        },
      },
    });
    expect(settings.capabilities.arbitrary_model_name.contextTokenLimit).toBe(8192);
    expect(settings.capabilities['llama-3.3-70b-versatile']).toBeUndefined();
  });
});
