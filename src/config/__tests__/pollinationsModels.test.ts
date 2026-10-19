import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getSQLiteAppStore } from '../../persistence/sqliteStore.js';
import { getProviderModelCapabilityProfile } from '../modelCapabilities.js';
import {
  POLLINATIONS_MODEL_CATALOG_SETTING_KEY,
  fetchAndSavePollinationsModelCatalog,
  getPollinationsTextModelTargets,
  getSavedPollinationsModelCatalog,
  normalizePollinationsModels,
  savePollinationsModelCatalog,
} from '../pollinationsModels.js';

describe('Pollinations model registry', () => {
  const store = getSQLiteAppStore();
  const originalCatalog = store.getSetting<unknown>(POLLINATIONS_MODEL_CATALOG_SETTING_KEY);

  beforeEach(() => {
    store.saveSetting(POLLINATIONS_MODEL_CATALOG_SETTING_KEY, null);
  });

  afterAll(() => {
    store.saveSetting(POLLINATIONS_MODEL_CATALOG_SETTING_KEY, originalCatalog);
  });

  it('normalizes and deduplicates models from the v1 and modality registries', () => {
    const models = normalizePollinationsModels([
      {
        name: 'example-chat',
        category: 'text',
        title: 'Example Chat',
        supported_endpoints: ['/text'],
        input_modalities: ['text'],
      },
      {
        id: 'example-chat',
        supported_endpoints: ['/v1/chat/completions'],
        capabilities: ['tool_calling', 'reasoning'],
        tools: true,
        reasoning: true,
        context_length: 32768,
      },
    ]);

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: 'example-chat',
      label: 'Example Chat',
      category: 'text',
      supportsTools: true,
      supportsReasoning: true,
      contextLength: 32768,
    });
    expect(getPollinationsTextModelTargets({
      version: 1,
      source: 'test',
      syncedAt: new Date().toISOString(),
      models,
    })[0]).toMatchObject({
      modelId: 'example-chat',
      value: 'pollinations:example-chat',
      supportsTools: true,
      supportsReasoning: true,
    });
  });

  it('fetches all Pollinations registries, merges them, and persists the catalog', async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.endsWith('/v1/models')
        ? { data: [{ id: 'example-chat', supported_endpoints: ['/v1/chat/completions'], tools: true }] }
        : url.endsWith('/text/models')
          ? [{ name: 'example-chat', category: 'text', title: 'Example Chat', description: 'A test route' }]
          : url.endsWith('/image/models')
            ? [{ name: 'example-image', category: 'image', title: 'Example Image', output_modalities: ['image'] }]
            : url.endsWith('/audio/models')
              ? [{ name: 'example-audio', category: 'audio', title: 'Example Audio', output_modalities: ['audio'] }]
              : [{ name: 'example-video', category: 'video', title: 'Example Video', output_modalities: ['video'] }];
      return {
        ok: true,
        status: 200,
        json: async () => payload,
      } as Response;
    });

    const result = await fetchAndSavePollinationsModelCatalog(fetchImpl as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(result.catalog.models.map((model) => model.id)).toEqual([
      'example-chat',
      'example-image',
      'example-audio',
      'example-video',
    ]);
    expect(result.catalog.models.find((model) => model.id === 'example-chat')).toMatchObject({
      label: 'Example Chat',
      description: 'A test route',
      supportsTools: true,
    });
    expect(getSavedPollinationsModelCatalog().models).toHaveLength(4);
    expect(store.getSetting(POLLINATIONS_MODEL_CATALOG_SETTING_KEY)).toBeTruthy();
  });

  it('keeps the saved catalog readable after a database reload', () => {
    savePollinationsModelCatalog([
      { id: 'saved-chat', category: 'text', supported_endpoints: ['/v1/chat/completions'] },
    ], 'test-source', '2026-01-01T00:00:00.000Z');

    const saved = getSavedPollinationsModelCatalog();
    expect(saved).toMatchObject({ source: 'test-source', syncedAt: '2026-01-01T00:00:00.000Z' });
    expect(getPollinationsTextModelTargets(saved)).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: 'saved-chat', value: 'pollinations:saved-chat' }),
    ]));
    expect(getProviderModelCapabilityProfile('pollinations:saved-chat', 'pollinations')).toMatchObject({
      provider: 'pollinations',
      contextWindow: undefined,
      source: 'provider-catalog',
    });
  });
});
