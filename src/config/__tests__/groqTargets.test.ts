import { describe, expect, it } from '@jest/globals';
import {
  getGroqModelTargets,
  getGroqModelValue,
  isLegacyGroqTargetModelValue,
  migrateLegacyGroqModelValue,
} from '../groqTargets.js';
import { getLegacyGroqConfigurationWarning } from '../runtimeEnv.js';

describe('single-organization Groq model routing', () => {
  it('exposes one provider route without credential identity', () => {
    expect(getGroqModelTargets(true, 'configured-model')).toEqual([{
      id: 'default',
      title: 'Groq Provider',
      modelId: 'configured-model',
      value: 'groq:configured-model',
    }]);
    expect(getGroqModelTargets(false, 'configured-model')).toEqual([]);
  });

  it('migrates every legacy credential target to the configured model route', () => {
    expect(isLegacyGroqTargetModelValue('groq-target:key-9')).toBe(true);
    expect(migrateLegacyGroqModelValue('groq-target:key-9')).toBe(getGroqModelValue());
    expect(migrateLegacyGroqModelValue('groq:configured-model')).toBe('groq:configured-model');
  });

  it('warns about legacy multi-account configuration without echoing credentials', () => {
    const warning = getLegacyGroqConfigurationWarning('gsk_secret_one,gsk_secret_two');
    expect(warning).toMatch(/no longer supported.*ignored/i);
    expect(warning).not.toContain('gsk_secret_one');
    expect(getLegacyGroqConfigurationWarning('')).toBeNull();
  });
});
