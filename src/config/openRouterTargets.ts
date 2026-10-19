import { getSQLiteAppStore } from '../persistence/sqliteStore.js';
import { getConfiguredOpenRouterModel, saveConfiguredProviderModel } from './providerRouteSettings.js';

export interface OpenRouterModelTarget {
  id: string;
  title: string;
  modelId: string;
  apiKeyIndex: 0;
  maxTokens?: number;
  contextLength?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  inputModalities?: string[];
  outputModalities?: string[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface OpenRouterModelCatalogMetadata {
  modelId: string;
  title?: string;
  maxTokens?: number;
  contextLength?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  inputModalities?: string[];
  outputModalities?: string[];
}

export const OPENROUTER_KNOWN_MODEL_METADATA: Record<string, OpenRouterModelCatalogMetadata> = {
  'openrouter/free': {
    modelId: 'openrouter/free',
    title: 'OpenRouter Free Models Router',
    contextLength: 200_000,
    supportsTools: true,
    supportsVision: true,
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
  },
  'inclusionai/ling-3.0-flash-fin:free': {
    modelId: 'inclusionai/ling-3.0-flash-fin:free',
    title: 'OpenRouter InclusionAI Ling 3.0 Flash Fin (Free)',
    maxTokens: 32_768,
    contextLength: 262_144,
    supportsTools: true,
    supportsVision: false,
    inputModalities: ['text'],
    outputModalities: ['text'],
  },
  'cohere/north-mini-code:free': {
    modelId: 'cohere/north-mini-code:free',
    title: 'OpenRouter Cohere North Mini Code (Free)',
  },
  'nvidia/nemotron-3-ultra-550b-a55b:free': {
    modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    title: 'OpenRouter NVIDIA Nemotron 3 Ultra (Free)',
  },
  'stealth/ox-alpha': {
    modelId: 'stealth/ox-alpha',
    title: 'Ox Alpha',
    maxTokens: 131_072,
    contextLength: 1_048_576,
    supportsTools: true,
    supportsVision: true,
    inputModalities: ['text', 'image', 'video'],
    outputModalities: ['text'],
  },
  'dots-studio/dots-3-note-preview:free': {
    modelId: 'dots-studio/dots-3-note-preview:free',
    title: 'OpenRouter Dots 3 Note Preview (Free)',
    contextLength: 512_000,
    supportsTools: true,
    supportsVision: true,
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
  },
  'inclusionai/ling-3.0-flash-sante:free': {
    modelId: 'inclusionai/ling-3.0-flash-sante:free',
    title: 'OpenRouter InclusionAI Ling 3.0 Flash Sante (Free)',
    maxTokens: 32_768,
    contextLength: 262_144,
    supportsTools: true,
    supportsVision: false,
    inputModalities: ['text'],
    outputModalities: ['text'],
  },
  'nvidia/nemotron-3-super-120b-a12b:free': {
    modelId: 'nvidia/nemotron-3-super-120b-a12b:free',
    title: 'OpenRouter NVIDIA Nemotron 3 Super (Free)',
    maxTokens: 235_929,
    contextLength: 262_144,
    supportsTools: true,
    supportsVision: false,
    inputModalities: ['text'],
    outputModalities: ['text'],
  },
  'poolside/laguna-s-2.1:free': {
    modelId: 'poolside/laguna-s-2.1:free',
    title: 'OpenRouter Poolside Laguna S 2.1 (Free)',
    maxTokens: 32_768,
    contextLength: 262_144,
    supportsTools: true,
    supportsVision: false,
    inputModalities: ['text'],
    outputModalities: ['text'],
  },
  'poolside/laguna-xs-2.1:free': {
    modelId: 'poolside/laguna-xs-2.1:free',
    title: 'OpenRouter Poolside Laguna XS 2.1 (Free)',
    maxTokens: 32_768,
    contextLength: 262_144,
    supportsTools: true,
    supportsVision: false,
    inputModalities: ['text'],
    outputModalities: ['text'],
  },
  'thinkingmachines/inkling:free': {
    modelId: 'thinkingmachines/inkling:free',
    title: 'OpenRouter Thinking Machines Inkling (Free)',
  },
  'google/gemma-4-26b-a4b-it:free': {
    modelId: 'google/gemma-4-26b-a4b-it:free',
    title: 'OpenRouter Google Gemma 4 26B A4B IT (Free)',
  },
  'google/gemma-4-31b-it:free': {
    modelId: 'google/gemma-4-31b-it:free',
    title: 'OpenRouter Google Gemma 4 31B IT (Free)',
  },
};

export const OPENROUTER_MODEL_TARGETS_SETTING_KEY = 'openrouter.modelTargets';
export const OPENROUTER_STRUCTURED_MODEL_SETTING_KEY = 'openrouter.structuredModel';
export const OPENROUTER_KNOWN_TARGETS_MIGRATION_KEY = 'openrouter.knownTargetsMigrated';
// Version 6 removes stale free routes (minimax/minimax-m3:free, z-ai/glm-5.2:free)
// and updates the active free routes.
export const OPENROUTER_KNOWN_TARGETS_MIGRATION_VERSION = 6;
export const DEFAULT_OPENROUTER_STRUCTURED_MODEL = 'dots-studio/dots-3-note-preview:free';

function normalizeModelId(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw.replace(/^openrouter:/i, '').trim();
}

export function isOpenRouterFreeModel(value: unknown): boolean {
  const modelId = normalizeModelId(value).toLowerCase();
  return modelId === 'openrouter/free' || modelId.endsWith(':free');
}

function normalizePositiveTokenLimit(value: unknown, maximum = 1_048_576): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(maximum, Math.floor(parsed));
}

function normalizeModalities(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const modalities = Array.from(new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)));
  return modalities.length > 0 ? modalities : undefined;
}

export function getConfiguredOpenRouterStructuredModel(): string {
  const store = getSQLiteAppStore();
  const stored = store.getSetting<{ modelId?: unknown }>(OPENROUTER_STRUCTURED_MODEL_SETTING_KEY);
  const configured = normalizeModelId(stored?.modelId);
  if (configured) return configured;
  // Materialize the built-in default in the same Settings store so the
  // structured route is no longer an implicit environment fallback.
  store.saveSetting(OPENROUTER_STRUCTURED_MODEL_SETTING_KEY, { modelId: DEFAULT_OPENROUTER_STRUCTURED_MODEL });
  return DEFAULT_OPENROUTER_STRUCTURED_MODEL;
}

export function saveConfiguredOpenRouterStructuredModel(value: unknown): string {
  const modelId = normalizeModelId(value);
  if (!modelId) throw new Error('OpenRouter structured fallback model is required.');
  if (modelId.length > 200) throw new Error('OpenRouter structured fallback model must be 200 characters or fewer.');
  getSQLiteAppStore().saveSetting(OPENROUTER_STRUCTURED_MODEL_SETTING_KEY, { modelId });
  return modelId;
}

export function getOpenRouterKnownModelMetadata(modelIdValue: unknown): OpenRouterModelCatalogMetadata | undefined {
  const modelId = normalizeModelId(modelIdValue).toLowerCase();
  return modelId ? OPENROUTER_KNOWN_MODEL_METADATA[modelId] : undefined;
}

export function normalizeOpenRouterTargetId(id: string): string {
  return id.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function getOpenRouterTargetModelValue(modelId: string): string {
  return 'openrouter:' + normalizeModelId(modelId);
}

function normalizeTarget(target: Partial<OpenRouterModelTarget>, index: number): OpenRouterModelTarget | null {
  const modelId = normalizeModelId(target.modelId);
  if (!modelId) return null;
  const title = typeof target.title === 'string' && target.title.trim()
    ? target.title.trim()
    : modelId;
  const id = normalizeOpenRouterTargetId(
    typeof target.id === 'string' && target.id.trim()
      ? target.id
      : title + '-' + (index + 1),
  );
  if (!id) return null;
  const now = Date.now();
  const knownMetadata = getOpenRouterKnownModelMetadata(modelId);
  const maxTokens = normalizePositiveTokenLimit(target.maxTokens) ?? knownMetadata?.maxTokens;
  const contextLength = normalizePositiveTokenLimit(target.contextLength, 10_000_000) ?? knownMetadata?.contextLength;
  const inputModalities = normalizeModalities(target.inputModalities) ?? knownMetadata?.inputModalities;
  const outputModalities = normalizeModalities(target.outputModalities) ?? knownMetadata?.outputModalities;
  const supportsVision = typeof target.supportsVision === 'boolean'
    ? target.supportsVision
    : knownMetadata?.supportsVision ?? (inputModalities?.includes('image') || inputModalities?.includes('video') || undefined);
  return {
    id,
    title,
    modelId,
    apiKeyIndex: 0,
    ...(maxTokens ? { maxTokens } : {}),
    ...(contextLength ? { contextLength } : {}),
    supportsTools: target.supportsTools !== false,
    ...(supportsVision !== undefined ? { supportsVision } : {}),
    ...(inputModalities ? { inputModalities } : {}),
    ...(outputModalities ? { outputModalities } : {}),
    notes: typeof target.notes === 'string' && target.notes.trim() ? target.notes.trim() : undefined,
    createdAt: Number(target.createdAt) || now,
    updatedAt: Number(target.updatedAt) || now,
  };
}

function appendKnownOpenRouterModelTargets(targets: OpenRouterModelTarget[]): OpenRouterModelTarget[] {
  let next = targets;
  for (const metadata of Object.values(OPENROUTER_KNOWN_MODEL_METADATA)) {
    if (next.some((target) => target.modelId.toLowerCase() === metadata.modelId.toLowerCase())) continue;
    const target = normalizeTarget({
      id: 'openrouter-known-' + metadata.modelId,
      title: metadata.title || metadata.modelId,
      modelId: metadata.modelId,
      supportsTools: metadata.supportsTools,
      notes: 'Known OpenRouter model; edit this target in Settings.',
    }, next.length);
    if (target) next = [...next, target];
  }
  return next;
}

export function normalizeOpenRouterModelTargets(value: unknown): OpenRouterModelTarget[] {
  const rawTargets = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { targets?: unknown }).targets)
      ? (value as { targets: unknown[] }).targets
      : [];
  const seenIds = new Set<string>();
  const seenModels = new Set<string>();
  const normalized: OpenRouterModelTarget[] = [];
  for (const [index, rawTarget] of rawTargets.entries()) {
    if (!rawTarget || typeof rawTarget !== 'object') continue;
    const target = normalizeTarget(rawTarget as Partial<OpenRouterModelTarget>, index);
    if (!target || seenIds.has(target.id) || seenModels.has(target.modelId.toLowerCase())) continue;
    seenIds.add(target.id);
    seenModels.add(target.modelId.toLowerCase());
    normalized.push(target);
  }
  return normalized;
}

export function getSavedOpenRouterModelTargets(): OpenRouterModelTarget[] {
  const store = getSQLiteAppStore();
  let saved = normalizeOpenRouterModelTargets(store.getSetting(OPENROUTER_MODEL_TARGETS_SETTING_KEY));
  let structuredModel = getConfiguredOpenRouterStructuredModel();

  if (saved.length > 0) {
    const originalTargetCount = saved.length;
    if (structuredModel && !saved.some((target) => target.modelId.toLowerCase() === structuredModel.toLowerCase())) {
      const migratedTarget = normalizeTarget({
        id: 'openrouter-structured-' + structuredModel,
        title: 'OpenRouter structured fallback',
        modelId: structuredModel,
        supportsTools: true,
        notes: 'Migrated from OPENROUTER_STRUCTURED_MODEL; edit this target in Settings.',
      }, saved.length);
      if (migratedTarget) {
        saved = [...saved, migratedTarget];
      }
    }
    const knownTargetsMigrated = store.getSetting<number>(OPENROUTER_KNOWN_TARGETS_MIGRATION_KEY)
      === OPENROUTER_KNOWN_TARGETS_MIGRATION_VERSION;
    const STALE_KNOWN_FREE_MODELS = new Set([
      'minimax/minimax-m3:free',
      'z-ai/glm-5.2:free',
    ]);
    if (!knownTargetsMigrated) {
      saved = saved.filter((target) => !STALE_KNOWN_FREE_MODELS.has(target.modelId.toLowerCase()));
    }
    const withKnownTargets = knownTargetsMigrated ? saved : appendKnownOpenRouterModelTargets(saved);
    if (withKnownTargets.length !== saved.length) saved = withKnownTargets;
    if (saved.length !== originalTargetCount || !knownTargetsMigrated) {
      store.saveSetting(OPENROUTER_MODEL_TARGETS_SETTING_KEY, saved);
      store.saveSetting(OPENROUTER_KNOWN_TARGETS_MIGRATION_KEY, OPENROUTER_KNOWN_TARGETS_MIGRATION_VERSION);
    }
    return saved;
  }

  const configuredModel = getConfiguredOpenRouterModel();
  const fallback = normalizeTarget({
    id: 'configured-route',
    title: 'OpenRouter default',
    modelId: configuredModel,
    supportsTools: true,
    createdAt: 0,
    updatedAt: 0,
  }, 0);
  if (!fallback) return [];

  const targets = [fallback];
  if (structuredModel && structuredModel.toLowerCase() !== fallback.modelId.toLowerCase()) {
    const migratedTarget = normalizeTarget({
      id: 'openrouter-structured-' + structuredModel,
      title: 'OpenRouter structured fallback',
      modelId: structuredModel,
      supportsTools: true,
      notes: 'Migrated from OPENROUTER_STRUCTURED_MODEL; edit this target in Settings.',
    }, targets.length);
    if (migratedTarget) targets.push(migratedTarget);
  }
  const withKnownTargets = appendKnownOpenRouterModelTargets(targets);
  store.saveSetting(OPENROUTER_MODEL_TARGETS_SETTING_KEY, withKnownTargets);
  store.saveSetting(OPENROUTER_KNOWN_TARGETS_MIGRATION_KEY, OPENROUTER_KNOWN_TARGETS_MIGRATION_VERSION);
  return withKnownTargets;
}

export function getOpenRouterModelTarget(modelIdValue: unknown): OpenRouterModelTarget | undefined {
  const modelId = normalizeModelId(modelIdValue).toLowerCase();
  if (!modelId) return undefined;
  return getSavedOpenRouterModelTargets().find((target) => target.modelId.toLowerCase() === modelId);
}

export function getOpenRouterModelTargetMaxTokens(modelIdValue: unknown): number | undefined {
  return getOpenRouterModelTarget(modelIdValue)?.maxTokens
    ?? getOpenRouterKnownModelMetadata(modelIdValue)?.maxTokens;
}

export function syncOpenRouterModelTargetMetadata(
  catalog: readonly OpenRouterModelCatalogMetadata[],
): OpenRouterModelTarget[] {
  const current = getSavedOpenRouterModelTargets();
  let changed = false;
  const next = current.map((target) => {
    const modelId = normalizeModelId(target.modelId).toLowerCase();
    const metadata = catalog.find((entry) => normalizeModelId(entry.modelId).toLowerCase() === modelId);
    if (!metadata) return target;
    const maxTokens = normalizePositiveTokenLimit(metadata.maxTokens);
    const contextLength = normalizePositiveTokenLimit(metadata.contextLength, 10_000_000);
    const inputModalities = normalizeModalities(metadata.inputModalities);
    const outputModalities = normalizeModalities(metadata.outputModalities);
    const supportsVision = typeof metadata.supportsVision === 'boolean'
      ? metadata.supportsVision
      : inputModalities?.includes('image') || inputModalities?.includes('video');
    const nextMaxTokens = maxTokens ?? target.maxTokens;
    const nextContextLength = contextLength ?? target.contextLength;
    const nextSupportsVision = supportsVision ?? target.supportsVision;
    const nextInputModalities = inputModalities ?? target.inputModalities;
    const nextOutputModalities = outputModalities ?? target.outputModalities;
    if (
      nextMaxTokens === target.maxTokens
      && nextContextLength === target.contextLength
      && nextSupportsVision === target.supportsVision
      && JSON.stringify(nextInputModalities) === JSON.stringify(target.inputModalities)
      && JSON.stringify(nextOutputModalities) === JSON.stringify(target.outputModalities)
    ) return target;
    changed = true;
    return {
      ...target,
      ...(nextMaxTokens ? { maxTokens: nextMaxTokens } : {}),
      ...(nextContextLength ? { contextLength: nextContextLength } : {}),
      ...(nextSupportsVision !== undefined ? { supportsVision: nextSupportsVision } : {}),
      ...(nextInputModalities ? { inputModalities: nextInputModalities } : {}),
      ...(nextOutputModalities ? { outputModalities: nextOutputModalities } : {}),
      updatedAt: Date.now(),
    };
  });
  return changed ? saveOpenRouterModelTargets(next) : current;
}

export function saveOpenRouterModelTargets(value: unknown): OpenRouterModelTarget[] {
  const normalized = normalizeOpenRouterModelTargets(value);
  if (normalized.length === 0) throw new Error('At least one OpenRouter model is required.');
  getSQLiteAppStore().saveSetting(OPENROUTER_MODEL_TARGETS_SETTING_KEY, normalized);
  const configuredModel = getConfiguredOpenRouterModel();
  if (!normalized.some((target) => target.modelId.toLowerCase() === configuredModel.toLowerCase())) {
    saveConfiguredProviderModel('openrouter', normalized[0].modelId);
  }
  return normalized;
}

export function addOpenRouterModelTarget(
  modelIdValue: unknown,
  titleValue?: unknown,
  makeDefault = false,
  metadata?: Partial<Pick<OpenRouterModelTarget, 'maxTokens' | 'contextLength' | 'supportsTools' | 'supportsVision' | 'inputModalities' | 'outputModalities'>>,
): OpenRouterModelTarget[] {
  const modelId = normalizeModelId(modelIdValue);
  if (!modelId) throw new Error('OpenRouter model is required.');
  if (modelId.length > 200) throw new Error('OpenRouter model must be 200 characters or fewer.');
  const current = getSavedOpenRouterModelTargets();
  const existing = current.find((target) => target.modelId.toLowerCase() === modelId.toLowerCase());
  const now = Date.now();
  const maxTokens = normalizePositiveTokenLimit(metadata?.maxTokens);
  const contextLength = normalizePositiveTokenLimit(metadata?.contextLength, 10_000_000);
  const inputModalities = normalizeModalities(metadata?.inputModalities);
  const outputModalities = normalizeModalities(metadata?.outputModalities);
  const supportsVision = typeof metadata?.supportsVision === 'boolean'
    ? metadata.supportsVision
    : inputModalities?.includes('image') || inputModalities?.includes('video');
  const nextTarget: OpenRouterModelTarget = existing
    ? {
      ...existing,
      title: typeof titleValue === 'string' && titleValue.trim() ? titleValue.trim() : existing.title,
      ...(maxTokens ? { maxTokens } : {}),
      ...(contextLength ? { contextLength } : {}),
      ...(metadata?.supportsTools !== undefined ? { supportsTools: metadata.supportsTools !== false } : {}),
      ...(metadata?.supportsVision !== undefined || supportsVision !== undefined ? { supportsVision } : {}),
      ...(inputModalities ? { inputModalities } : {}),
      ...(outputModalities ? { outputModalities } : {}),
      updatedAt: now,
    }
    : {
      id: normalizeOpenRouterTargetId('openrouter-' + modelId) || 'openrouter-' + now,
      title: typeof titleValue === 'string' && titleValue.trim() ? titleValue.trim() : modelId,
      modelId,
      apiKeyIndex: 0,
      ...(maxTokens ? { maxTokens } : {}),
      ...(contextLength ? { contextLength } : {}),
      supportsTools: metadata?.supportsTools !== false,
      ...(supportsVision !== undefined ? { supportsVision } : {}),
      ...(inputModalities ? { inputModalities } : {}),
      ...(outputModalities ? { outputModalities } : {}),
      createdAt: now,
      updatedAt: now,
    };
  const targets = existing
    ? current.map((target) => target.id === existing.id ? nextTarget : target)
    : [...current, nextTarget];
  if (makeDefault) saveConfiguredProviderModel('openrouter', modelId);
  return saveOpenRouterModelTargets(targets);
}

export function removeOpenRouterModelTarget(id: string): OpenRouterModelTarget[] {
  const normalizedId = normalizeOpenRouterTargetId(id);
  const current = getSavedOpenRouterModelTargets();
  if (current.length <= 1) throw new Error('Keep at least one OpenRouter model configured.');
  const removed = current.find((target) => target.id === normalizedId);
  if (!removed) throw new Error('OpenRouter model target was not found.');
  const targets = current.filter((target) => target.id !== normalizedId);
  if (getConfiguredOpenRouterModel().toLowerCase() === removed.modelId.toLowerCase()) {
    saveConfiguredProviderModel('openrouter', targets[0].modelId);
  }
  return saveOpenRouterModelTargets(targets);
}
