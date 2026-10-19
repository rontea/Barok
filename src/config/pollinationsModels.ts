import { getSQLiteAppStore } from '../persistence/sqliteStore.js';
import { getRuntimePollinationsApiKey } from './runtimeEnv.js';

export const POLLINATIONS_MODEL_CATALOG_SETTING_KEY = 'pollinations.modelCatalog';
export const POLLINATIONS_MODEL_PREFIX = 'pollinations:';
export const POLLINATIONS_V1_MODELS_URL = 'https://gen.pollinations.ai/v1/models';
export const POLLINATIONS_TEXT_MODELS_URL = 'https://gen.pollinations.ai/text/models';
export const POLLINATIONS_IMAGE_MODELS_URL = 'https://gen.pollinations.ai/image/models';
export const POLLINATIONS_AUDIO_MODELS_URL = 'https://gen.pollinations.ai/audio/models';
export const POLLINATIONS_VIDEO_MODELS_URL = 'https://gen.pollinations.ai/video/models';

export type PollinationsModelCategory = 'text' | 'image' | 'audio' | 'video' | 'embedding' | 'unknown';

export interface PollinationsModelPricing {
  [key: string]: string | number;
}

export interface PollinationsModel {
  id: string;
  label: string;
  description?: string;
  provider?: string;
  category: PollinationsModelCategory;
  aliases: string[];
  inputModalities: string[];
  outputModalities: string[];
  supportedEndpoints: string[];
  capabilities: string[];
  supportsTools: boolean;
  supportsReasoning: boolean;
  contextLength?: number;
  maxOutputTokens?: number;
  pricing?: PollinationsModelPricing;
  isFree?: boolean;
  createdAt?: number;
}

export interface PollinationsModelCatalog {
  version: 1;
  source: string;
  syncedAt: string;
  models: PollinationsModel[];
}

export interface PollinationsModelTarget {
  id: string;
  title: string;
  modelId: string;
  value: string;
  category: 'text';
  contextLength?: number;
  maxTokens?: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  inputModalities: string[];
  outputModalities: string[];
  isFree?: boolean;
  createdAt: number;
  updatedAt: number;
}

type RecordValue = Record<string, unknown>;

const MODEL_CATEGORIES = new Set<PollinationsModelCategory>([
  'text',
  'image',
  'audio',
  'video',
  'embedding',
  'unknown',
]);

const MODEL_ENDPOINTS = [
  { category: 'text' as const, url: POLLINATIONS_TEXT_MODELS_URL },
  { category: 'image' as const, url: POLLINATIONS_IMAGE_MODELS_URL },
  { category: 'audio' as const, url: POLLINATIONS_AUDIO_MODELS_URL },
  { category: 'video' as const, url: POLLINATIONS_VIDEO_MODELS_URL },
  { category: 'v1' as const, url: POLLINATIONS_V1_MODELS_URL },
];

function asRecord(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    .map((entry) => entry.trim())));
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function modelIdFromRaw(raw: RecordValue): string | undefined {
  return stringValue(raw.id) || stringValue(raw.name) || stringValue(raw.model);
}

function categoryFromRaw(raw: RecordValue, fallback?: PollinationsModelCategory): PollinationsModelCategory {
  const explicit = stringValue(raw.category)?.toLowerCase() as PollinationsModelCategory | undefined;
  if (explicit && MODEL_CATEGORIES.has(explicit)) return explicit;

  const endpoints = stringArray(raw.supported_endpoints ?? raw.supportedEndpoints).map((endpoint) => endpoint.toLowerCase());
  const outputModalities = stringArray(raw.output_modalities ?? raw.outputModalities).map((modality) => modality.toLowerCase());
  if (outputModalities.includes('image') || endpoints.some((endpoint) => endpoint.includes('/image'))) return 'image';
  if (outputModalities.includes('audio') || endpoints.some((endpoint) => endpoint.includes('/audio'))) return 'audio';
  if (outputModalities.includes('video') || endpoints.some((endpoint) => endpoint.includes('/video'))) return 'video';
  if (endpoints.some((endpoint) => endpoint.includes('embedding'))) return 'embedding';
  if (endpoints.some((endpoint) => endpoint.includes('/text') || endpoint.includes('chat/completions'))) return 'text';
  return fallback || 'unknown';
}

function mergePrimitiveArrays(left: unknown, right: unknown): string[] {
  return Array.from(new Set([...stringArray(left), ...stringArray(right)]));
}

function normalizePricing(value: unknown): PollinationsModelPricing | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const entries = Object.entries(raw).filter(([, entry]) =>
    typeof entry === 'string' || (typeof entry === 'number' && Number.isFinite(entry))
  );
  if (entries.length === 0) return undefined;
  const pricing: PollinationsModelPricing = {};
  for (const [key, entry] of entries) pricing[key] = entry as string | number;
  return pricing;
}

function inferFree(pricing: PollinationsModelPricing | undefined, raw: RecordValue): boolean | undefined {
  if (typeof raw.is_free === 'boolean') return raw.is_free;
  if (typeof raw.isFree === 'boolean') return raw.isFree;
  if (!pricing) return undefined;
  const amounts = Object.entries(pricing)
    .filter(([key]) => key.toLowerCase() !== 'currency')
    .map(([, value]) => Number(value))
    .filter((value) => Number.isFinite(value));
  return amounts.length > 0 ? amounts.every((value) => value === 0) : undefined;
}

function normalizeRawModel(raw: RecordValue, fallbackCategory?: PollinationsModelCategory): PollinationsModel | null {
  const id = modelIdFromRaw(raw);
  if (!id) return null;

  const aliases = stringArray(raw.aliases);
  const inputModalities = stringArray(raw.input_modalities ?? raw.inputModalities);
  const outputModalities = stringArray(raw.output_modalities ?? raw.outputModalities);
  const supportedEndpoints = stringArray(raw.supported_endpoints ?? raw.supportedEndpoints);
  const capabilities = stringArray(raw.capabilities);
  const pricing = normalizePricing(raw.pricing);
  const label = stringValue(raw.title) || stringValue(raw.label) || stringValue(raw.name) || id;
  const contextLength = finiteNumber(raw.context_length ?? raw.contextLength);
  const maxOutputTokens = finiteNumber(raw.max_completion_tokens ?? raw.maxOutputTokens ?? raw.max_tokens);
  const createdAt = finiteNumber(raw.created ?? raw.created_at ?? raw.added_date ?? raw.addedDate);
  const supportsTools = raw.tools === true
    || raw.supports_tools === true
    || raw.supportsTools === true
    || capabilities.some((capability) => /tool|function/i.test(capability));
  const supportsReasoning = raw.reasoning === true
    || raw.supports_reasoning === true
    || raw.supportsReasoning === true
    || capabilities.some((capability) => /reason/i.test(capability));

  return {
    id,
    label,
    ...(stringValue(raw.description) ? { description: stringValue(raw.description) } : {}),
    ...(stringValue(raw.brand) || stringValue(raw.owned_by) || stringValue(raw.ownedBy)
      ? { provider: stringValue(raw.brand) || stringValue(raw.owned_by) || stringValue(raw.ownedBy) }
      : {}),
    category: categoryFromRaw(raw, fallbackCategory),
    aliases,
    inputModalities,
    outputModalities,
    supportedEndpoints,
    capabilities,
    supportsTools,
    supportsReasoning,
    ...(contextLength !== undefined ? { contextLength } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(pricing ? { pricing } : {}),
    ...(inferFree(pricing, raw) !== undefined ? { isFree: inferFree(pricing, raw) } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
  };
}

function mergeModels(existing: PollinationsModel, incoming: PollinationsModel): PollinationsModel {
  const pricing: PollinationsModelPricing | undefined = existing.pricing || incoming.pricing
    ? { ...(existing.pricing || {}), ...(incoming.pricing || {}) }
    : undefined;
  const category = existing.category === 'unknown' ? incoming.category : existing.category;
  return {
    ...existing,
    ...incoming,
    label: incoming.label !== incoming.id || existing.label === existing.id ? incoming.label : existing.label,
    description: incoming.description || existing.description,
    provider: incoming.provider || existing.provider,
    category,
    aliases: mergePrimitiveArrays(existing.aliases, incoming.aliases),
    inputModalities: mergePrimitiveArrays(existing.inputModalities, incoming.inputModalities),
    outputModalities: mergePrimitiveArrays(existing.outputModalities, incoming.outputModalities),
    supportedEndpoints: mergePrimitiveArrays(existing.supportedEndpoints, incoming.supportedEndpoints),
    capabilities: mergePrimitiveArrays(existing.capabilities, incoming.capabilities),
    supportsTools: existing.supportsTools || incoming.supportsTools,
    supportsReasoning: existing.supportsReasoning || incoming.supportsReasoning,
    contextLength: incoming.contextLength ?? existing.contextLength,
    maxOutputTokens: incoming.maxOutputTokens ?? existing.maxOutputTokens,
    pricing,
    isFree: incoming.isFree ?? existing.isFree,
    createdAt: incoming.createdAt ?? existing.createdAt,
  };
}

function extractModels(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.models)) return record.models;
  return [];
}

function catalogSort(left: PollinationsModel, right: PollinationsModel): number {
  const categoryOrder: Record<PollinationsModelCategory, number> = {
    text: 0,
    image: 1,
    audio: 2,
    video: 3,
    embedding: 4,
    unknown: 5,
  };
  return categoryOrder[left.category] - categoryOrder[right.category]
    || left.label.localeCompare(right.label)
    || left.id.localeCompare(right.id);
}

export function normalizePollinationsModels(value: unknown): PollinationsModel[] {
  const candidates = Array.isArray(value)
    ? value
    : asRecord(value)?.models && Array.isArray(asRecord(value)?.models)
      ? asRecord(value)?.models as unknown[]
      : [];
  const models = new Map<string, PollinationsModel>();

  for (const candidate of candidates) {
    const normalized = normalizeRawModel(asRecord(candidate) || {});
    if (!normalized) continue;
    const key = normalized.id.toLowerCase();
    const existing = models.get(key);
    models.set(key, existing ? mergeModels(existing, normalized) : normalized);
  }

  return Array.from(models.values()).sort(catalogSort);
}

function normalizeSavedCatalog(value: unknown): PollinationsModelCatalog | null {
  const record = asRecord(value);
  const models = normalizePollinationsModels(record || value);
  if (models.length === 0) return null;
  const syncedAt = stringValue(record?.syncedAt) || stringValue(record?.updatedAt) || new Date(0).toISOString();
  return {
    version: 1,
    source: stringValue(record?.source) || 'database',
    syncedAt,
    models,
  };
}

export function getSavedPollinationsModelCatalog(): PollinationsModelCatalog {
  const saved = normalizeSavedCatalog(getSQLiteAppStore().getSetting<unknown>(POLLINATIONS_MODEL_CATALOG_SETTING_KEY));
  return saved || {
    version: 1,
    source: 'database',
    syncedAt: '',
    models: [],
  };
}

export function savePollinationsModelCatalog(
  models: unknown,
  source = 'gen.pollinations.ai',
  syncedAt = new Date().toISOString(),
): PollinationsModelCatalog {
  const catalog: PollinationsModelCatalog = {
    version: 1,
    source,
    syncedAt,
    models: normalizePollinationsModels(models),
  };
  if (catalog.models.length === 0) throw new Error('Pollinations returned no usable models.');
  getSQLiteAppStore().saveSetting(POLLINATIONS_MODEL_CATALOG_SETTING_KEY, catalog);
  return catalog;
}

async function fetchModelList(
  url: string,
  fetchImpl: typeof fetch,
): Promise<unknown[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const apiKey = getRuntimePollinationsApiKey();
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Pollinations model registry returned HTTP ${response.status}.`);
    }
    return extractModels(payload);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchAndSavePollinationsModelCatalog(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ catalog: PollinationsModelCatalog; sources: string[]; failedSources: string[] }> {
  const results = await Promise.all(MODEL_ENDPOINTS.map(async ({ category, url }) => {
    try {
      const rawModels = await fetchModelList(url, fetchImpl);
      return {
        category,
        url,
        models: rawModels
          .map((raw) => normalizeRawModel(asRecord(raw) || {}, category === 'v1' ? undefined : category))
          .filter((model): model is PollinationsModel => Boolean(model)),
      };
    } catch (error) {
      return {
        category,
        url,
        models: [] as PollinationsModel[],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));

  const merged = new Map<string, PollinationsModel>();
  for (const result of results) {
    for (const model of result.models) {
      const key = model.id.toLowerCase();
      const existing = merged.get(key);
      merged.set(key, existing ? mergeModels(existing, model) : model);
    }
  }

  if (merged.size === 0) {
    const errors = results
      .filter((result) => result.error)
      .map((result) => `${result.url}: ${result.error}`)
      .join(' | ');
    throw new Error(errors || 'Pollinations model registry returned no usable models.');
  }

  const sources = results.filter((result) => result.models.length > 0).map((result) => result.url);
  const failedSources = results.filter((result) => result.error).map((result) => result.url);
  const catalog = savePollinationsModelCatalog(
    Array.from(merged.values()).sort(catalogSort),
    sources.join(' + '),
  );
  return { catalog, sources, failedSources };
}

export function isPollinationsTextChatModel(model: PollinationsModel): boolean {
  return model.category === 'text'
    && (model.supportedEndpoints.length === 0 || model.supportedEndpoints.some((endpoint) =>
      endpoint === '/v1/chat/completions' || endpoint.includes('chat/completions')
    ));
}

function targetId(modelId: string): string {
  const slug = modelId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `pollinations-${slug || 'model'}`;
}

export function getPollinationsTextModelTargets(
  catalog = getSavedPollinationsModelCatalog(),
): PollinationsModelTarget[] {
  const updatedAt = catalog.syncedAt ? Date.parse(catalog.syncedAt) || 0 : 0;
  return catalog.models
    .filter(isPollinationsTextChatModel)
    .map((model) => ({
      id: targetId(model.id),
      title: `Pollinations · ${model.label}`,
      modelId: model.id,
      value: `${POLLINATIONS_MODEL_PREFIX}${model.id}`,
      category: 'text' as const,
      ...(model.contextLength !== undefined ? { contextLength: model.contextLength } : {}),
      ...(model.maxOutputTokens !== undefined ? { maxTokens: model.maxOutputTokens } : {}),
      supportsTools: model.supportsTools,
      supportsVision: model.inputModalities.includes('image'),
      supportsReasoning: model.supportsReasoning,
      inputModalities: model.inputModalities,
      outputModalities: model.outputModalities,
      ...(model.isFree !== undefined ? { isFree: model.isFree } : {}),
      createdAt: model.createdAt || 0,
      updatedAt,
    }));
}
