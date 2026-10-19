import { getSQLiteAppStore } from '../persistence/sqliteStore.js';
import { getRuntimeNvidiaApiKey, getRuntimeNvidiaApiKeys } from './runtimeEnv.js';
import {
  getNvidiaChatModelIds,
  getNvidiaModelMetadata,
  getNvidiaModelReplacement,
  getNvidiaTargetModelId,
} from './nvidiaModels.js';

export interface NvidiaApiKeySummary {
  index: number;
  name: string;
  keySuffix: string;
  keyPreview: string;
  isPrimary: boolean;
}

export interface NvidiaModelTarget {
  id: string;
  title: string;
  modelId: string;
  apiKeyIndex: number;
  apiFamily: 'chat-completions';
  endpoint: '/chat/completions';
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /** Request-level streaming preference; model capability is tracked separately. */
  stream?: boolean;
  supportsStreaming?: boolean;
  supportsTools?: boolean;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export const NVIDIA_MODEL_TARGETS_SETTING_KEY = 'nvidia.modelTargets';
export const NVIDIA_TARGET_MODEL_PREFIX = 'nvidia-target:';

export function parseNvidiaRuntimeKeys(primaryKey = getRuntimeNvidiaApiKey(), keyPool = getRuntimeNvidiaApiKeys()): string[] {
  return Array.from(new Set([
    primaryKey,
    ...(keyPool || '').split(','),
  ]
    .map((key) => key?.trim())
    .filter((key): key is string => Boolean(key))));
}

export function getNvidiaApiKeySummaries(): NvidiaApiKeySummary[] {
  return parseNvidiaRuntimeKeys().map((key, index) => {
    const keySuffix = key.length >= 5 ? key.slice(-5) : key;
    return {
      index,
      name: index === 0 ? `NVIDIA API Key ${index + 1} (Primary)` : `NVIDIA API Key ${index + 1}`,
      keySuffix,
      keyPreview: `Key ${index + 1} (...${keySuffix})`,
      isPrimary: index === 0,
    };
  });
}

export function normalizeNvidiaTargetId(id: string): string {
  return id.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function getNvidiaTargetModelValue(id: string): string {
  return `${NVIDIA_TARGET_MODEL_PREFIX}${normalizeNvidiaTargetId(id)}`;
}

export function isNvidiaTargetModelValue(model: string): boolean {
  return model.startsWith(NVIDIA_TARGET_MODEL_PREFIX);
}

export function getNvidiaTargetIdFromModelValue(model: string): string {
  return normalizeNvidiaTargetId(model.slice(NVIDIA_TARGET_MODEL_PREFIX.length));
}

export function getDefaultNvidiaModelTargets(keys = parseNvidiaRuntimeKeys()): NvidiaModelTarget[] {
  return keys.flatMap((_key, apiKeyIndex) =>
    getNvidiaChatModelIds().map((modelId) => {
      const metadata = getNvidiaModelMetadata(modelId);
      const keyLabel = `Key ${apiKeyIndex + 1}`;
      return {
        id: normalizeNvidiaTargetId(`${keyLabel}-${getNvidiaTargetModelId(modelId)}`),
        title: `${keyLabel} - ${metadata?.label || modelId}`,
        modelId,
        apiKeyIndex,
        apiFamily: 'chat-completions' as const,
        endpoint: '/chat/completions' as const,
        temperature: metadata?.defaultParams.temperature,
        maxTokens: metadata?.defaultParams.maxTokens,
        topP: metadata?.defaultParams.topP,
        stream: false,
        supportsStreaming: metadata?.supportsStreaming !== false,
        supportsTools: metadata?.supportsTools === true,
        notes: 'Auto-created NVIDIA chat model target',
        createdAt: 0,
        updatedAt: 0,
      };
    })
  );
}

function normalizeTarget(target: Partial<NvidiaModelTarget>, fallbackIndex: number): NvidiaModelTarget | null {
  const originalModelId = typeof target.modelId === 'string' ? target.modelId.trim().toLowerCase() : '';
  const rawModelId = getNvidiaModelReplacement(originalModelId) || originalModelId;
  const rawTitle = typeof target.title === 'string' ? target.title.trim() : '';
  if (!rawModelId || !rawTitle) return null;

  const id = normalizeNvidiaTargetId(
    typeof target.id === 'string' && target.id.trim()
      ? target.id
      : `${rawTitle}-${fallbackIndex + 1}`
  );
  if (!id) return null;

  const now = Date.now();
  const maxTokens = Number(target.maxTokens);
  const temperature = Number(target.temperature);
  const topP = Number(target.topP);
  const stream = target.stream === true;

  return {
    id,
    title: getNvidiaModelReplacement(originalModelId)
      ? rawTitle.replace(/deepseek\s+v4\s+flash(?!\s+0731)/i, 'DeepSeek V4 Flash 0731')
      : rawTitle,
    modelId: rawModelId,
    apiKeyIndex: Math.max(0, Number.isFinite(Number(target.apiKeyIndex)) ? Number(target.apiKeyIndex) : 0),
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    temperature: Number.isFinite(temperature) ? temperature : undefined,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : undefined,
    topP: Number.isFinite(topP) ? topP : undefined,
    stream,
    supportsStreaming: target.supportsStreaming !== false,
    supportsTools: target.supportsTools === true,
    notes: typeof target.notes === 'string' ? target.notes.trim() : undefined,
    createdAt: Number(target.createdAt) || now,
    updatedAt: Number(target.updatedAt) || now,
  };
}

export function normalizeNvidiaModelTargets(targets: unknown): NvidiaModelTarget[] {
  if (!Array.isArray(targets)) return [];
  const seen = new Set<string>();
  const normalized: NvidiaModelTarget[] = [];

  for (const [index, target] of targets.entries()) {
    const next = normalizeTarget(target as Partial<NvidiaModelTarget>, index);
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    normalized.push(next);
  }

  return normalized;
}

export function getSavedNvidiaModelTargets(): NvidiaModelTarget[] {
  const store = getSQLiteAppStore();
  const tableTargets = normalizeNvidiaModelTargets(store.listNvidiaModelTargets());
  const legacyTargets = normalizeNvidiaModelTargets(store.getSetting(NVIDIA_MODEL_TARGETS_SETTING_KEY));
  if (tableTargets.length === 0 && legacyTargets.length > 0) {
    store.replaceNvidiaModelTargets(legacyTargets);
  }
  const savedTargets = tableTargets.length > 0 ? tableTargets : legacyTargets;
  const merged = new Map<string, NvidiaModelTarget>();

  for (const target of getDefaultNvidiaModelTargets()) {
    merged.set(target.id, target);
  }
  for (const target of savedTargets) {
    const metadata = getNvidiaModelMetadata(target.modelId);
    if (target.notes === 'Auto-created NVIDIA chat model target' && metadata?.uiSelectable === false) {
      continue;
    }
    merged.set(target.id, target);
  }

  return Array.from(merged.values()).sort((a, b) =>
    a.apiKeyIndex - b.apiKeyIndex ||
    a.modelId.localeCompare(b.modelId) ||
    a.title.localeCompare(b.title)
  );
}

export function saveNvidiaModelTargets(targets: unknown): NvidiaModelTarget[] {
  const normalized = normalizeNvidiaModelTargets(targets);
  const store = getSQLiteAppStore();
  store.replaceNvidiaModelTargets(normalized);
  store.saveSetting(NVIDIA_MODEL_TARGETS_SETTING_KEY, normalized);
  return normalized;
}

export function resolveNvidiaModelTarget(model: string): NvidiaModelTarget | null {
  if (!isNvidiaTargetModelValue(model)) return null;
  const targetId = getNvidiaTargetIdFromModelValue(model);
  return getSavedNvidiaModelTargets().find((target) => target.id === targetId) || null;
}
