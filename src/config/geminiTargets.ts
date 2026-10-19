import { getSQLiteAppStore } from '../persistence/sqliteStore.js';
import { getRuntimeGeminiApiKey } from './runtimeEnv.js';
import {
  GEMINI_MODEL_MIGRATIONS,
  getGeminiFreeChatModelIds,
  getGeminiModelMigration,
  getGeminiModelMetadata,
  isRetiredGeminiModel,
  normalizeGeminiModelId,
} from './geminiModels.js';
import { getGeminiProfileRegistry, invalidateGeminiProfileRegistryCache } from './geminiProfiles.js';

export interface GeminiApiKeySummary {
  index: number;
  profileId?: string;
  name: string;
  keySuffix: string;
  keyPreview: string;
  isPrimary: boolean;
}

export interface GeminiModelTarget {
  id: string;
  title: string;
  modelId: string;
  apiKeyIndex: number;
  profileId?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  supportsTools?: boolean;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type GeminiTargetResolutionIssue =
  | 'missing_target'
  | 'retired_model'
  | 'unsupported_model'
  | 'missing_profile'
  | 'invalid_key_slot';

export const GEMINI_MODEL_TARGETS_SETTING_KEY = 'gemini.modelTargets';
export const GEMINI_TARGET_MODEL_PREFIX = 'gemini-target:';

export function parseGeminiRuntimeKeys(primaryKey = getRuntimeGeminiApiKey()): string[] {
  const key = primaryKey?.trim();
  return key ? [key] : [];
}

export function getGeminiApiKeySummaries(): GeminiApiKeySummary[] {
  const profiles = getGeminiProfileRegistry().list();
  const keys = profiles.length > 0 ? profiles.map((profile) => profile.apiKey) : parseGeminiRuntimeKeys();
  return keys.map((key, index) => {
    const profile = profiles[index];
    const keySuffix = key.length >= 5 ? key.slice(-5) : key;
    return {
      index,
      ...(profile ? { profileId: profile.id } : {}),
      name: profile?.label || `Gemini API Key ${index + 1}`,
      keySuffix,
      keyPreview: `Key ${index + 1} (...${keySuffix})`,
      isPrimary: index === 0,
    };
  });
}

export function normalizeGeminiTargetId(id: string): string {
  return id.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function getGeminiTargetModelValue(id: string): string {
  return `${GEMINI_TARGET_MODEL_PREFIX}${normalizeGeminiTargetId(id)}`;
}

export function isGeminiTargetModelValue(model: string): boolean {
  return model.startsWith(GEMINI_TARGET_MODEL_PREFIX);
}

export function getGeminiTargetIdFromModelValue(model: string): string {
  return normalizeGeminiTargetId(model.slice(GEMINI_TARGET_MODEL_PREFIX.length));
}

export function getDefaultGeminiModelTargets(
  profiles = getGeminiProfileRegistry().list(),
): GeminiModelTarget[] {
  const keys: Array<{ apiKey: string; id?: string; label?: string }> = profiles.length > 0
    ? profiles
    : parseGeminiRuntimeKeys().map((apiKey) => ({ apiKey }));

  return keys.flatMap((profile, apiKeyIndex) =>
    getGeminiFreeChatModelIds().map((modelId) => {
      const metadata = getGeminiModelMetadata(modelId);
      const keyLabel = profile.label || `Key ${apiKeyIndex + 1}`;
      return {
        id: normalizeGeminiTargetId(`${keyLabel}-${modelId}`),
        title: `${keyLabel} - ${metadata?.label || modelId}`,
        modelId,
        apiKeyIndex,
        ...(profile.id ? { profileId: profile.id } : {}),
        temperature: metadata?.defaultParams.temperature,
        maxTokens: metadata?.defaultParams.maxTokens,
        topP: metadata?.defaultParams.topP,
        supportsTools: metadata?.supportsTools === true,
        notes: 'Auto-created Gemini free model target',
        createdAt: 0,
        updatedAt: 0,
      };
    })
  );
}

function normalizeTarget(target: Partial<GeminiModelTarget>, fallbackIndex: number): GeminiModelTarget | null {
  const rawModelId = typeof target.modelId === 'string' ? normalizeGeminiModelId(target.modelId) : '';
  const modelId = rawModelId ? getGeminiModelMigration(rawModelId) : '';
  const rawTitle = typeof target.title === 'string' ? target.title.trim() : '';
  if (!modelId || !rawTitle || isRetiredGeminiModel(modelId)) return null;

  const id = normalizeGeminiTargetId(
    typeof target.id === 'string' && target.id.trim()
      ? target.id
      : `${rawTitle}-${fallbackIndex + 1}`
  );
  if (!id) return null;

  const now = Date.now();
  const metadata = getGeminiModelMetadata(modelId);
  // Targets may have custom labels, but their model must be in the supported
  // catalog so capability and fallback decisions remain unambiguous.
  if (!metadata) return null;
  const maxTokens = Number(target.maxTokens);
  const temperature = Number(target.temperature);
  const topP = Number(target.topP);

  return {
    id,
    title: rawTitle,
    modelId,
    apiKeyIndex: Math.max(0, Number.isFinite(Number(target.apiKeyIndex)) ? Number(target.apiKeyIndex) : 0),
    ...(typeof target.profileId === 'string' && target.profileId.trim() ? { profileId: target.profileId.trim() } : {}),
    temperature: Number.isFinite(temperature) ? temperature : metadata?.defaultParams.temperature,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : metadata?.defaultParams.maxTokens,
    topP: Number.isFinite(topP) ? topP : metadata?.defaultParams.topP,
    supportsTools: target.supportsTools === true || metadata?.supportsTools === true,
    notes: typeof target.notes === 'string'
      ? target.notes.trim()
      : rawModelId !== modelId
        ? `Migrated from ${rawModelId}`
        : undefined,
    createdAt: Number(target.createdAt) || now,
    updatedAt: Number(target.updatedAt) || now,
  };
}

export function normalizeGeminiModelTargets(targets: unknown): GeminiModelTarget[] {
  if (!Array.isArray(targets)) return [];
  const seen = new Set<string>();
  const normalized: GeminiModelTarget[] = [];

  for (const [index, target] of targets.entries()) {
    const next = normalizeTarget(target as Partial<GeminiModelTarget>, index);
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    normalized.push(next);
  }

  return normalized;
}

function targetScopeKey(target: GeminiModelTarget): string {
  return `${target.profileId || `key:${target.apiKeyIndex}`}::${target.modelId}`;
}

function getMigratedTargetId(targetId: string): string {
  return Object.entries(GEMINI_MODEL_MIGRATIONS).reduce((currentId, [from, to]) => {
    const fromSlug = normalizeGeminiTargetId(from);
    const toSlug = normalizeGeminiTargetId(to);
    return currentId.endsWith(`-${fromSlug}`)
      ? `${currentId.slice(0, -(fromSlug.length))}${toSlug}`
      : currentId;
  }, targetId);
}

/**
 * Ensures the saved target catalog has one target for every current model on
 * every configured Gemini profile. Existing target ids and custom settings
 * win for the same profile/model pair; missing targets are generated from the
 * current catalog. This also migrates retired model ids before deduplication.
 */
export function synchronizeGeminiModelTargets(
  targets: unknown,
  profiles = getGeminiProfileRegistry().list(),
): GeminiModelTarget[] {
  const normalizedTargets = bindGeminiTargetsToConfiguredProfiles(
    normalizeGeminiModelTargets(targets),
    profiles,
  );
  const synchronized = new Map<string, GeminiModelTarget>();

  for (const target of getDefaultGeminiModelTargets(profiles)) {
    synchronized.set(targetScopeKey(target), target);
  }
  for (const target of normalizedTargets) {
    synchronized.set(targetScopeKey(target), target);
  }

  return Array.from(synchronized.values()).sort((a, b) =>
    a.apiKeyIndex - b.apiKeyIndex ||
    a.modelId.localeCompare(b.modelId) ||
    a.title.localeCompare(b.title)
  );
}

/**
 * Bind saved targets to the accounts that exist now. This prevents old
 * index-only entries such as "Key 2" from silently executing on Key 1 after
 * an account was removed.
 */
export function bindGeminiTargetsToConfiguredProfiles(
  targets: GeminiModelTarget[],
  profiles = getGeminiProfileRegistry().list(),
): GeminiModelTarget[] {
  const runtimeKeyCount = profiles.length > 0 ? profiles.length : parseGeminiRuntimeKeys().length;

  return targets.flatMap((target): GeminiModelTarget[] => {
    if (target.profileId) {
      const profileIndex = profiles.findIndex((profile) => profile.id === target.profileId);
      if (profileIndex < 0) return [];
      return [{ ...target, apiKeyIndex: profileIndex }];
    }

    if (target.apiKeyIndex < 0 || target.apiKeyIndex >= runtimeKeyCount) return [];
    const profile = profiles[target.apiKeyIndex];
    return [profile ? { ...target, profileId: profile.id } : target];
  });
}

export function getGeminiTargetBindingIssue(
  target: GeminiModelTarget,
  profiles = getGeminiProfileRegistry().list(),
): GeminiTargetResolutionIssue | undefined {
  if (isRetiredGeminiModel(target.modelId)) return 'retired_model';
  if (!getGeminiModelMetadata(target.modelId)) return 'unsupported_model';
  if (target.profileId && !profiles.some((profile) => profile.id === target.profileId)) return 'missing_profile';
  const runtimeKeyCount = profiles.length > 0 ? profiles.length : parseGeminiRuntimeKeys().length;
  if (!target.profileId && (target.apiKeyIndex < 0 || target.apiKeyIndex >= runtimeKeyCount)) return 'invalid_key_slot';
  return undefined;
}

export function getSavedGeminiModelTargets(): GeminiModelTarget[] {
  const profiles = getGeminiProfileRegistry().list();
  const store = getSQLiteAppStore();
  const rawSetting = store.getSetting(GEMINI_MODEL_TARGETS_SETTING_KEY);
  const synchronized = synchronizeGeminiModelTargets(rawSetting, profiles);
  // Persist the complete matrix once so retired targets, missing profiles,
  // and partial per-profile catalogs cannot reappear after a restart.
  if (JSON.stringify(rawSetting) !== JSON.stringify(synchronized)) {
    store.saveSetting(GEMINI_MODEL_TARGETS_SETTING_KEY, synchronized);
  }
  return synchronized;
}

export function saveGeminiModelTargets(targets: unknown): GeminiModelTarget[] {
  const registry = getGeminiProfileRegistry();
  const profiles = registry.list();
  const synchronized = synchronizeGeminiModelTargets(targets, profiles);
  getSQLiteAppStore().saveSetting(GEMINI_MODEL_TARGETS_SETTING_KEY, synchronized);
  invalidateGeminiProfileRegistryCache();
  return synchronized;
}

export function resolveGeminiModelTarget(model: string): GeminiModelTarget | null {
  if (!isGeminiTargetModelValue(model)) return null;
  const targetId = getGeminiTargetIdFromModelValue(model);
  const targets = getSavedGeminiModelTargets();
  return targets.find((target) => target.id === targetId)
    || targets.find((target) => target.id === getMigratedTargetId(targetId))
    || null;
}

/** Returns a safe explanation for a target that can no longer be resolved. */
export function getGeminiModelTargetResolutionIssue(model: string): GeminiTargetResolutionIssue | undefined {
  if (!isGeminiTargetModelValue(model)) return 'missing_target';
  const targetId = getGeminiTargetIdFromModelValue(model);
  const rawSetting = getSQLiteAppStore().getSetting(GEMINI_MODEL_TARGETS_SETTING_KEY);
  const rawTarget = Array.isArray(rawSetting)
    ? rawSetting.find((candidate) => candidate && typeof candidate === 'object'
      && normalizeGeminiTargetId(String((candidate as Partial<GeminiModelTarget>).id || '')) === targetId) as Partial<GeminiModelTarget> | undefined
    : undefined;
  if (!rawTarget) {
    const migratedTargetId = getMigratedTargetId(targetId);
    if (migratedTargetId !== targetId && getSavedGeminiModelTargets().some((target) => target.id === migratedTargetId)) {
      return undefined;
    }
    return 'missing_target';
  }
  const rawModelId = typeof rawTarget.modelId === 'string' ? normalizeGeminiModelId(rawTarget.modelId) : '';
  const modelId = getGeminiModelMigration(rawModelId);
  if (isRetiredGeminiModel(modelId)) return 'retired_model';
  if (!getGeminiModelMetadata(modelId)) return 'unsupported_model';
  const normalized = normalizeTarget(rawTarget, 0);
  if (!normalized) return 'unsupported_model';
  return getGeminiTargetBindingIssue(normalized) || 'missing_target';
}
