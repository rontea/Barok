import { afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import { getSQLiteAppStore } from '../../persistence/sqliteStore.js';
import {
  OPENROUTER_ACCOUNT_SETTINGS_KEY,
  getConfiguredOpenRouterApiKey,
  getOpenRouterPublicAccountSettings,
  saveOpenRouterAccountSettings,
} from '../openRouterConfig.js';
import {
  OPENROUTER_MODEL_TARGETS_SETTING_KEY,
  OPENROUTER_KNOWN_TARGETS_MIGRATION_KEY,
  OPENROUTER_KNOWN_TARGETS_MIGRATION_VERSION,
  OPENROUTER_STRUCTURED_MODEL_SETTING_KEY,
  getConfiguredOpenRouterStructuredModel,
  getOpenRouterTargetModelValue,
  getOpenRouterModelTarget,
  getSavedOpenRouterModelTargets,
  isOpenRouterFreeModel,
  normalizeOpenRouterModelTargets,
  saveConfiguredOpenRouterStructuredModel,
  saveOpenRouterModelTargets,
  syncOpenRouterModelTargetMetadata,
} from '../openRouterTargets.js';
import { resolveOpenRouterMaxTokens } from '../../di/providers/llmProvider.js';

describe('OpenRouter Settings configuration', () => {
  const originalEnvironmentKey = process.env.OPENROUTER_API_KEY;
  const originalStructuredEnvironmentModel = process.env.OPENROUTER_STRUCTURED_MODEL;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = '';
    process.env.OPENROUTER_STRUCTURED_MODEL = '';
    const store = getSQLiteAppStore();
    store.saveSetting(OPENROUTER_ACCOUNT_SETTINGS_KEY, {});
    store.saveSetting(OPENROUTER_MODEL_TARGETS_SETTING_KEY, []);
    store.saveSetting(OPENROUTER_STRUCTURED_MODEL_SETTING_KEY, {});
    store.saveSetting(OPENROUTER_KNOWN_TARGETS_MIGRATION_KEY, false);
  });

  afterAll(() => {
    if (originalEnvironmentKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalEnvironmentKey;
    if (originalStructuredEnvironmentModel === undefined) delete process.env.OPENROUTER_STRUCTURED_MODEL;
    else process.env.OPENROUTER_STRUCTURED_MODEL = originalStructuredEnvironmentModel;
  });

  it('uses only the environment key and clears a legacy database copy', () => {
    const store = getSQLiteAppStore();
    store.saveSetting(OPENROUTER_ACCOUNT_SETTINGS_KEY, { apiKey: 'sk-or-v1-database-secret' });
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-environment-secret';

    expect(getConfiguredOpenRouterApiKey()).toBe('sk-or-v1-environment-secret');
    const settings = getOpenRouterPublicAccountSettings();
    expect(settings.keySource).toBe('environment');
    expect(settings).not.toHaveProperty('apiKeyPreview');
    expect(JSON.stringify(settings)).not.toContain('sk-or-v1-environment-secret');
    expect(store.getSetting(OPENROUTER_ACCOUNT_SETTINGS_KEY)).toEqual({});
  });

  it('rejects API key writes from Settings', () => {
    expect(() => saveOpenRouterAccountSettings({ apiKey: 'sk-or-v1-settings-secret' })).toThrow(/environment-only/i);
    process.env.OPENROUTER_API_KEY = '';
    expect(getConfiguredOpenRouterApiKey()).toBe('');
    expect(getOpenRouterPublicAccountSettings()).toMatchObject({
      apiKeyConfigured: false,
      keySource: 'none',
    });
  });

  it('normalizes model targets and emits provider-routable values', () => {
    const targets = normalizeOpenRouterModelTargets([
      { id: 'fast-model', title: 'Fast', modelId: 'openrouter:provider/fast' },
      { id: 'duplicate', title: 'Duplicate', modelId: 'provider/fast' },
      { title: 'Free', modelId: 'openrouter/free' },
    ]);

    expect(targets).toHaveLength(2);
    expect(targets[0].modelId).toBe('provider/fast');
    expect(getOpenRouterTargetModelValue(targets[1].modelId)).toBe('openrouter:openrouter/free');
  });

  it('recognizes OpenRouter free variants, including the automatic free router', () => {
    expect(isOpenRouterFreeModel('openrouter:minimax/minimax-m3:free')).toBe(true);
    expect(isOpenRouterFreeModel('openrouter/free')).toBe(true);
    expect(isOpenRouterFreeModel('openai/gpt-5')).toBe(false);
  });

  it('caps requests at the selected OpenRouter model output limit', () => {
    saveOpenRouterModelTargets([{
      id: 'provider-model',
      title: 'Provider model',
      modelId: 'provider/model',
      apiKeyIndex: 0,
      maxTokens: 4096,
      contextLength: 32768,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]);

    expect(resolveOpenRouterMaxTokens('provider/model', 8192)).toBe(4096);
    expect(resolveOpenRouterMaxTokens('provider/model', 128)).toBe(128);
  });

  it('syncs the OpenRouter catalog limit into an existing saved target', () => {
    saveOpenRouterModelTargets([{
      id: 'catalog-route',
      title: 'Catalog route',
      modelId: 'catalog/model',
      apiKeyIndex: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]);

    syncOpenRouterModelTargetMetadata([{
      modelId: 'catalog/model',
      maxTokens: 2048,
      contextLength: 65536,
    }]);

    expect(getOpenRouterModelTarget('catalog/model')).toMatchObject({
      maxTokens: 2048,
      contextLength: 65536,
    });
  });

  it('uses the persisted structured default and ignores legacy environment model values', () => {
    process.env.OPENROUTER_STRUCTURED_MODEL = 'provider/structured-model';
    saveOpenRouterModelTargets([{
      id: 'primary-route',
      title: 'Primary route',
      modelId: 'provider/primary-model',
      apiKeyIndex: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]);

    const targets = getSavedOpenRouterModelTargets();
    expect(targets.map((target) => target.modelId)).toEqual([
      'provider/primary-model',
      'dots-studio/dots-3-note-preview:free',
      'openrouter/free',
      'inclusionai/ling-3.0-flash-fin:free',
      'cohere/north-mini-code:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'stealth/ox-alpha',
      'inclusionai/ling-3.0-flash-sante:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'poolside/laguna-s-2.1:free',
      'poolside/laguna-xs-2.1:free',
      'thinkingmachines/inkling:free',
      'google/gemma-4-26b-a4b-it:free',
      'google/gemma-4-31b-it:free',
    ]);
    expect(getSQLiteAppStore().getSetting<unknown[]>(OPENROUTER_MODEL_TARGETS_SETTING_KEY)).toHaveLength(14);
    expect(getSQLiteAppStore().getSetting<number>(OPENROUTER_KNOWN_TARGETS_MIGRATION_KEY))
      .toBe(OPENROUTER_KNOWN_TARGETS_MIGRATION_VERSION);
    expect(targets.find((target) => target.modelId === 'openrouter/free')).toMatchObject({
      title: 'OpenRouter Free Models Router',
      contextLength: 200_000,
      supportsTools: true,
      supportsVision: true,
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
    });
    expect(targets.find((target) => target.modelId === 'inclusionai/ling-3.0-flash-fin:free')).toMatchObject({
      title: 'OpenRouter InclusionAI Ling 3.0 Flash Fin (Free)',
      maxTokens: 32_768,
      contextLength: 262_144,
      supportsTools: true,
      supportsVision: false,
      inputModalities: ['text'],
      outputModalities: ['text'],
    });
    expect(targets.find((target) => target.modelId === 'stealth/ox-alpha')).toMatchObject({
      title: 'Ox Alpha',
      maxTokens: 131_072,
      contextLength: 1_048_576,
    });
    expect(targets.find((target) => target.modelId === 'inclusionai/ling-3.0-flash-sante:free')).toMatchObject({
      contextLength: 262_144,
      supportsTools: true,
      supportsVision: false,
    });
    expect(getConfiguredOpenRouterStructuredModel()).toBe('dots-studio/dots-3-note-preview:free');

    saveConfiguredOpenRouterStructuredModel('provider/primary-model');
    expect(getConfiguredOpenRouterStructuredModel()).toBe('provider/primary-model');
  });

  it('keeps the full Ox Alpha completion ceiling when the caller has a small planner budget', () => {
    expect(resolveOpenRouterMaxTokens('stealth/ox-alpha', 128)).toBe(131_072);

    expect(resolveOpenRouterMaxTokens('stealth/ox-alpha', 200_000)).toBe(131_072);

    saveOpenRouterModelTargets([{
      id: 'ox-alpha',
      title: 'Ox Alpha',
      modelId: 'stealth/ox-alpha',
      apiKeyIndex: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]);
    expect(getOpenRouterModelTarget('stealth/ox-alpha')).toMatchObject({
      maxTokens: 131_072,
      contextLength: 1_048_576,
      supportsTools: true,
      supportsVision: true,
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
    });
  });

  it('migrates the free models router into existing target lists', () => {
    const store = getSQLiteAppStore();
    saveOpenRouterModelTargets([{
      id: 'existing-route',
      title: 'Existing route',
      modelId: 'provider/existing-model',
      apiKeyIndex: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]);
    store.saveSetting(OPENROUTER_KNOWN_TARGETS_MIGRATION_KEY, 4);

    const targets = getSavedOpenRouterModelTargets();

    expect(targets.some((target) => target.modelId === 'openrouter/free')).toBe(true);
    expect(targets.some((target) => target.modelId === 'inclusionai/ling-3.0-flash-fin:free')).toBe(true);
    expect(store.getSetting<number>(OPENROUTER_KNOWN_TARGETS_MIGRATION_KEY))
      .toBe(OPENROUTER_KNOWN_TARGETS_MIGRATION_VERSION);
  });
});
