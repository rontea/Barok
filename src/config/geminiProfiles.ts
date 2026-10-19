import { getRuntimeEnvValue } from './runtimeEnv.js';
import path from 'path';
import fs from 'fs';
import { getSQLiteAppStore } from '../persistence/sqliteStore.js';

export interface GeminiAccountProfile {
  id: string;
  label: string;
  purpose: string;
  apiKey: string;
  enabled: boolean;
  envVar: string;
}

export interface GeminiAccountProfileSummary {
  id: string;
  label: string;
  purpose: string;
  enabled: boolean;
  configured: boolean;
  keySuffix?: string;
}

export interface GeminiProfileHealth {
  profileId: string;
  status: 'available' | 'cooldown' | 'disabled' | 'misconfigured';
  activeRequests: number;
  queuedRequests: number;
  maxConcurrentRequests: number;
  cooldownUntil?: number;
  circuitOpenUntil?: number;
  consecutiveFailures: number;
  requestCount: number;
  errorCount: number;
  lastUsedAt?: number;
  lastSuccessfulRequestAt?: number;
  lastErrorCode?: string;
}

export interface GeminiProfileAssignments {
  workspaces: Record<string, string>;
  users: Record<string, string>;
  defaultProfileId?: string;
}

export const GEMINI_PROFILE_ASSIGNMENTS_SETTING_KEY = 'gemini.profileAssignments';
export const GEMINI_PROFILE_HEALTH_SETTING_KEY = 'gemini.profileHealth';
export const GEMINI_MANAGED_PROFILES_SETTING_KEY = 'gemini.managedProfiles';

const PROFILE_DESCRIPTORS = [
  { suffix: 'A', id: 'account-a' },
  { suffix: 'B', id: 'account-b' },
  { suffix: 'C', id: 'account-c' },
] as const;

interface GeminiProfileConfigEntry {
  id: string;
  apiKeyEnv: string;
  enabled: boolean;
  purpose: string;
  label?: string;
}

export interface ManagedGeminiProfile {
  id: string;
  label: string;
  purpose: string;
  envVar: string;
  enabled: boolean;
}

interface StoredManagedGeminiProfiles {
  profiles: ManagedGeminiProfile[];
  disabledProfileIds: string[];
}

/**
 * Migrates the legacy primary + comma-separated key configuration into
 * isolated profiles. Keys remain independently selectable and are never
 * rotated as shared capacity.
 */
export function parseLegacyGeminiAccountProfiles(
  primaryKey: string,
  pooledKeys: string,
): GeminiAccountProfile[] {
  const keys = [
    primaryKey.trim(),
    ...pooledKeys.split(',').map((entry) => entry.split(':', 1)[0].trim()),
  ].filter(Boolean);
  const uniqueKeys = Array.from(new Set(keys));

  return uniqueKeys.map((apiKey, index) => ({
    id: index === 0 ? 'default' : `legacy-api-${index + 1}`,
    label: `Gemini API ${index + 1}`,
    purpose: 'general',
    apiKey,
    enabled: true,
    envVar: index === 0 ? 'GEMINI_API_KEY' : 'GEMINI_API_KEYS',
  }));
}

export function parseGeminiProfileConfig(source: string): GeminiProfileConfigEntry[] {
  const entries: GeminiProfileConfigEntry[] = [];
  let insideProfiles = false;
  let current: GeminiProfileConfigEntry | undefined;
  for (const rawLine of source.split(/\r?\n/)) {
    const withoutComment = rawLine.replace(/\s+#.*$/, '');
    const trimmed = withoutComment.trim();
    if (!trimmed) continue;
    const indent = withoutComment.length - withoutComment.trimStart().length;
    if (trimmed === 'profiles:') {
      insideProfiles = true;
      continue;
    }
    if (!insideProfiles) continue;
    const profileMatch = trimmed.match(/^([a-zA-Z0-9_-]+):$/);
    if (profileMatch && indent >= 6) {
      current = {
        id: profileMatch[1],
        apiKeyEnv: '',
        enabled: true,
        purpose: 'general',
      };
      entries.push(current);
      continue;
    }
    if (!current || indent < 8) continue;
    const field = trimmed.match(/^([a-zA-Z0-9_-]+):\s*(.*?)\s*$/);
    if (!field) continue;
    const value = field[2].replace(/^['"]|['"]$/g, '');
    if (field[1] === 'api_key_env') current.apiKeyEnv = value;
    else if (field[1] === 'enabled') current.enabled = value.toLowerCase() !== 'false';
    else if (field[1] === 'purpose') current.purpose = value || 'general';
    else if (field[1] === 'label') current.label = value;
  }
  return entries.filter((entry) => entry.apiKeyEnv);
}

function loadConfiguredProfileEntries(): GeminiProfileConfigEntry[] {
  const configuredPath = getRuntimeEnvValue('REACT_ENGINE_PROVIDER_CONFIG', 'react-engine.providers.yaml');
  const resolved = path.resolve(process.cwd(), configuredPath);
  try {
    return parseGeminiProfileConfig(fs.readFileSync(resolved, 'utf8'));
  } catch {
    return [];
  }
}

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readManagedGeminiProfiles(): StoredManagedGeminiProfiles {
  const saved = getSQLiteAppStore().getSetting<Partial<StoredManagedGeminiProfiles>>(GEMINI_MANAGED_PROFILES_SETTING_KEY);
  const profiles = Array.isArray(saved?.profiles)
    ? saved.profiles.flatMap((profile): ManagedGeminiProfile[] => {
      if (!profile || typeof profile !== 'object') return [];
      const candidate = profile as Partial<ManagedGeminiProfile>;
      if (
        typeof candidate.id !== 'string' || !candidate.id.trim() ||
        typeof candidate.label !== 'string' || !candidate.label.trim() ||
        typeof candidate.envVar !== 'string' || !candidate.envVar.trim()
      ) return [];
      return [{
        id: candidate.id.trim(),
        label: candidate.label.trim(),
        purpose: typeof candidate.purpose === 'string' && candidate.purpose.trim() ? candidate.purpose.trim() : 'general',
        envVar: candidate.envVar.trim(),
        enabled: candidate.enabled !== false,
      }];
    })
    : [];
  const disabledProfileIds = Array.isArray(saved?.disabledProfileIds)
    ? saved.disabledProfileIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())).map((id) => id.trim())
    : [];
  return { profiles, disabledProfileIds };
}

export function getManagedGeminiProfiles(): ManagedGeminiProfile[] {
  return readManagedGeminiProfiles().profiles.map((profile) => ({ ...profile }));
}

export function saveManagedGeminiProfile(profile: ManagedGeminiProfile): ManagedGeminiProfile {
  const saved = readManagedGeminiProfiles();
  const next = saved.profiles.filter((candidate) => candidate.id !== profile.id);
  next.push({ ...profile });
  getSQLiteAppStore().saveSetting(GEMINI_MANAGED_PROFILES_SETTING_KEY, {
    profiles: next,
    disabledProfileIds: saved.disabledProfileIds.filter((id) => id !== profile.id),
  });
  invalidateGeminiProfileRegistryCache();
  return { ...profile };
}

export function removeManagedGeminiProfile(profileId: string): void {
  const saved = readManagedGeminiProfiles();
  getSQLiteAppStore().saveSetting(GEMINI_MANAGED_PROFILES_SETTING_KEY, {
    profiles: saved.profiles.filter((profile) => profile.id !== profileId),
    disabledProfileIds: Array.from(new Set([...saved.disabledProfileIds, profileId])),
  });
  invalidateGeminiProfileRegistryCache();
}

function applyManagedGeminiProfiles(configured: GeminiAccountProfile[]): GeminiAccountProfile[] {
  const saved = readManagedGeminiProfiles();
  const disabled = new Set(saved.disabledProfileIds);
  const merged = configured.filter((profile) => !disabled.has(profile.id));

  for (const managed of saved.profiles) {
    if (!managed.enabled || disabled.has(managed.id)) continue;
    const apiKey = getRuntimeEnvValue(managed.envVar);
    if (!apiKey) continue;
    const profile: GeminiAccountProfile = {
      id: managed.id,
      label: managed.label,
      purpose: managed.purpose,
      apiKey,
      enabled: true,
      envVar: managed.envVar,
    };
    const existingIndex = merged.findIndex((candidate) => candidate.id === managed.id);
    if (existingIndex >= 0) merged[existingIndex] = profile;
    else merged.push(profile);
  }

  return merged;
}

export function loadGeminiAccountProfiles(): GeminiAccountProfile[] {
  const fileEntries = loadConfiguredProfileEntries();
  const configured: GeminiAccountProfile[] = fileEntries.length > 0
    ? fileEntries.flatMap((entry): GeminiAccountProfile[] => {
      const apiKey = getRuntimeEnvValue(entry.apiKeyEnv);
      if (!apiKey) return [];
      return [{
        id: entry.id,
        label: entry.label || entry.id.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
        purpose: entry.purpose,
        apiKey,
        enabled: entry.enabled,
        envVar: entry.apiKeyEnv,
      }];
    })
    : PROFILE_DESCRIPTORS.flatMap(({ suffix, id }): GeminiAccountProfile[] => {
    const envVar = `GEMINI_ACCOUNT_${suffix}_API_KEY`;
    const apiKey = getRuntimeEnvValue(envVar);
    if (!apiKey) return [];
    return [{
      id,
      label: getRuntimeEnvValue(`GEMINI_ACCOUNT_${suffix}_LABEL`, `Gemini Account ${suffix}`),
      purpose: getRuntimeEnvValue(`GEMINI_ACCOUNT_${suffix}_PURPOSE`, 'general'),
      apiKey,
      enabled: getRuntimeEnvValue(`GEMINI_ACCOUNT_${suffix}_ENABLED`, 'true').toLowerCase() !== 'false',
      envVar,
    }];
  });

  // Keep legacy setups working by representing every configured key as an
  // isolated profile. This exposes API 2/API 3 in model selectors without
  // reintroducing automatic cross-account rotation.
  if (configured.length === 0) {
    configured.push(...parseLegacyGeminiAccountProfiles(
      getRuntimeEnvValue('GEMINI_API_KEY'),
      getRuntimeEnvValue('GEMINI_API_KEYS'),
    ));
  }

  return applyManagedGeminiProfiles(configured);
}

export class GeminiProfileRegistry {
  private readonly profiles: Map<string, GeminiAccountProfile>;

  constructor(profiles: GeminiAccountProfile[] = getCachedGeminiAccountProfiles()) {
    this.profiles = new Map(
      profiles
        .filter((profile) => profile.enabled && profile.apiKey.trim())
        .map((profile) => [profile.id, { ...profile, apiKey: profile.apiKey.trim() }]),
    );
  }

  list(): GeminiAccountProfile[] {
    return Array.from(this.profiles.values()).map((profile) => ({ ...profile }));
  }

  get(profileId?: string): GeminiAccountProfile | undefined {
    const profile = profileId
      ? this.profiles.get(profileId)
      : this.profiles.values().next().value;
    return profile ? { ...profile } : undefined;
  }

  has(profileId: string): boolean {
    return this.profiles.has(profileId);
  }

  summaries(): GeminiAccountProfileSummary[] {
    return this.list().map((profile) => ({
      id: profile.id,
      label: profile.label,
      purpose: profile.purpose,
      enabled: profile.enabled,
      configured: true,
      keySuffix: profile.apiKey.slice(-5),
    }));
  }
}

const GEMINI_PROFILE_REGISTRY_CACHE_TTL_MS = 5_000;
let geminiProfileRegistryCache:
  | { profiles: GeminiAccountProfile[]; registry: GeminiProfileRegistry; expiresAt: number }
  | undefined;

function getGeminiProfileRegistryCache() {
  if (geminiProfileRegistryCache && geminiProfileRegistryCache.expiresAt > Date.now()) {
    return geminiProfileRegistryCache;
  }
  const profiles = loadGeminiAccountProfiles();
  const nextCache = {
    profiles,
    registry: new GeminiProfileRegistry(profiles),
    expiresAt: Date.now() + GEMINI_PROFILE_REGISTRY_CACHE_TTL_MS,
  };
  geminiProfileRegistryCache = nextCache;
  return nextCache;
}

/** Returns the profile registry hydrated from SQLite/environment at most once per TTL. */
export function getGeminiProfileRegistry(): GeminiProfileRegistry {
  return getGeminiProfileRegistryCache().registry;
}

/** Returns a copy of the profile snapshot, including disabled configured entries. */
export function getCachedGeminiAccountProfiles(): GeminiAccountProfile[] {
  return getGeminiProfileRegistryCache().profiles.map((profile) => ({ ...profile }));
}

export function invalidateGeminiProfileRegistryCache(): void {
  geminiProfileRegistryCache = undefined;
}

interface QueueItem<T> {
  priority: number;
  createdAt: number;
  minIntervalMs: number;
  onPacingWait?: (delayMs: number) => void;
  task: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal;
}

interface ProfileState {
  active: number;
  queue: QueueItem<unknown>[];
  cooldownUntil: number;
  circuitOpenUntil: number;
  consecutiveFailures: number;
  requestCount: number;
  errorCount: number;
  lastUsedAt?: number;
  lastSuccessfulRequestAt?: number;
  lastStartedAt: number;
  lastErrorCode?: string;
  disabled: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Serializes requests per Gemini account by default. A 429 pauses only that
 * account's queue; it never causes the caller to use another account.
 */
export class GeminiProfileScheduler {
  private readonly states = new Map<string, ProfileState>();
  private readonly maxConcurrentRequests: number;
  private readonly circuitFailureThreshold: number;
  private readonly circuitCooldownMs: number;
  private readonly persist: boolean;

  constructor(options: {
    maxConcurrentRequests?: number;
    circuitFailureThreshold?: number;
    circuitCooldownMs?: number;
    persist?: boolean;
  } = {}) {
    this.maxConcurrentRequests = options.maxConcurrentRequests
      || positiveInteger(getRuntimeEnvValue('GEMINI_MAX_CONCURRENT_REQUESTS_PER_PROFILE', '1'), 1);
    this.circuitFailureThreshold = options.circuitFailureThreshold || 3;
    this.circuitCooldownMs = options.circuitCooldownMs || 30_000;
    this.persist = options.persist === true;
  }

  private state(profileId: string): ProfileState {
    let state = this.states.get(profileId);
    if (!state) {
      const persisted = this.persist
        ? getSQLiteAppStore().getSetting<Record<string, Partial<ProfileState>>>(GEMINI_PROFILE_HEALTH_SETTING_KEY)?.[profileId]
        : undefined;
      state = {
        active: 0,
        queue: [],
        cooldownUntil: Number(persisted?.cooldownUntil) || 0,
        circuitOpenUntil: Number(persisted?.circuitOpenUntil) || 0,
        consecutiveFailures: Number(persisted?.consecutiveFailures) || 0,
        requestCount: Number(persisted?.requestCount) || 0,
        errorCount: Number(persisted?.errorCount) || 0,
        lastUsedAt: Number(persisted?.lastUsedAt) || undefined,
        lastSuccessfulRequestAt: Number(persisted?.lastSuccessfulRequestAt) || undefined,
        lastStartedAt: 0,
        lastErrorCode: typeof persisted?.lastErrorCode === 'string' ? persisted.lastErrorCode : undefined,
        disabled: persisted?.disabled === true,
      };
      this.states.set(profileId, state);
    }
    return state;
  }

  run<T>(
    profileId: string,
    task: () => Promise<T>,
    options: {
      priority?: number;
      signal?: AbortSignal;
      /** Minimum spacing between requests using this account profile. */
      minIntervalMs?: number;
      /** Reports an intentional free-tier pacing wait to the caller. */
      onPacingWait?: (delayMs: number) => void;
    } = {},
  ): Promise<T> {
    const state = this.state(profileId);
    return new Promise<T>((resolve, reject) => {
      if (state.disabled) {
        reject(new Error(`Gemini profile ${profileId} is disabled after an authentication failure`));
        return;
      }
      const item: QueueItem<T> = {
        priority: Math.max(0, Math.min(100, Math.floor(options.priority ?? 50))),
        createdAt: Date.now(),
        minIntervalMs: Number.isFinite(options.minIntervalMs)
          ? Math.max(0, Math.min(60_000, Math.floor(Number(options.minIntervalMs))))
          : 0,
        onPacingWait: options.onPacingWait,
        task,
        resolve,
        reject,
        signal: options.signal,
      };
      if (options.signal?.aborted) {
        reject(options.signal.reason || new Error('Gemini request cancelled while queued'));
        return;
      }
      state.queue.push(item as QueueItem<unknown>);
      this.pump(profileId);
    });
  }

  recordSuccess(profileId: string): void {
    const state = this.state(profileId);
    state.consecutiveFailures = 0;
    state.lastUsedAt = Date.now();
    state.lastSuccessfulRequestAt = state.lastUsedAt;
    state.lastErrorCode = undefined;
    state.disabled = false;
    this.persistState(profileId, state);
  }

  recordFailure(profileId: string, kind: 'RATE_LIMIT' | 'AUTH_ERROR' | 'SERVER_ERROR' | 'OTHER', retryAt?: number): void {
    const state = this.state(profileId);
    state.errorCount++;
    state.consecutiveFailures++;
    state.lastErrorCode = kind;
    const now = Date.now();
    if (kind === 'RATE_LIMIT') {
      state.cooldownUntil = Math.max(state.cooldownUntil, retryAt || now + 30_000);
    } else if (kind === 'AUTH_ERROR') {
      state.disabled = true;
    } else if (state.consecutiveFailures >= this.circuitFailureThreshold) {
      state.circuitOpenUntil = Math.max(state.circuitOpenUntil, now + this.circuitCooldownMs);
    }
    this.persistState(profileId, state);
  }

  getStatus(profileId?: string): GeminiProfileHealth[] {
    const entries = profileId ? [[profileId, this.state(profileId)] as const] : Array.from(this.states.entries());
    return entries.map(([id, state]) => ({
      profileId: id,
      status: state.disabled
        ? 'disabled'
        : Math.max(state.cooldownUntil, state.circuitOpenUntil) > Date.now()
          ? 'cooldown'
          : 'available',
      activeRequests: state.active,
      queuedRequests: state.queue.length,
      maxConcurrentRequests: this.maxConcurrentRequests,
      ...(state.cooldownUntil > Date.now() ? { cooldownUntil: state.cooldownUntil } : {}),
      ...(state.circuitOpenUntil > Date.now() ? { circuitOpenUntil: state.circuitOpenUntil } : {}),
      consecutiveFailures: state.consecutiveFailures,
      requestCount: state.requestCount,
      errorCount: state.errorCount,
      lastUsedAt: state.lastUsedAt,
      lastSuccessfulRequestAt: state.lastSuccessfulRequestAt,
      lastErrorCode: state.lastErrorCode,
    }));
  }

  private pump(profileId: string): void {
    const state = this.state(profileId);
    if (state.active >= this.maxConcurrentRequests || state.queue.length === 0) return;
    if (state.disabled) {
      const error = new Error(`Gemini profile ${profileId} is disabled after an authentication failure`);
      for (const item of state.queue.splice(0)) item.reject(error);
      return;
    }
    const now = Date.now();
    const notBefore = Math.max(state.cooldownUntil, state.circuitOpenUntil);
    if (notBefore > now) {
      if (!state.timer) {
        state.timer = setTimeout(() => {
          state.timer = undefined;
          this.pump(profileId);
        }, notBefore - now);
      }
      return;
    }

    state.queue.sort((left, right) => right.priority - left.priority || left.createdAt - right.createdAt);
    const next = state.queue[0];
    if (!next) return;

    const eligibleAt = state.lastStartedAt + next.minIntervalMs;
    if (eligibleAt > now) {
      if (!state.timer) {
        const delayMs = eligibleAt - now;
        next.onPacingWait?.(delayMs);
        state.timer = setTimeout(() => {
          state.timer = undefined;
          this.pump(profileId);
        }, delayMs);
      }
      return;
    }

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
    const item = state.queue.shift();
    if (!item) return;
    if (item.signal?.aborted) {
      item.reject(item.signal.reason || new Error('Gemini request cancelled while queued'));
      this.pump(profileId);
      return;
    }

    state.active++;
    state.requestCount++;
    state.lastStartedAt = now;
    state.lastUsedAt = now;
    this.persistState(profileId, state);
    void item.task().then(item.resolve, item.reject).finally(() => {
      state.active--;
      this.persistState(profileId, state);
      this.pump(profileId);
    });
  }

  private persistState(profileId: string, state: ProfileState): void {
    if (!this.persist) return;
    const store = getSQLiteAppStore();
    const persisted = store.getSetting<Record<string, Record<string, unknown>>>(GEMINI_PROFILE_HEALTH_SETTING_KEY) || {};
    persisted[profileId] = {
      cooldownUntil: state.cooldownUntil,
      circuitOpenUntil: state.circuitOpenUntil,
      consecutiveFailures: state.consecutiveFailures,
      requestCount: state.requestCount,
      errorCount: state.errorCount,
      lastUsedAt: state.lastUsedAt || null,
      lastSuccessfulRequestAt: state.lastSuccessfulRequestAt || null,
      lastErrorCode: state.lastErrorCode || null,
      disabled: state.disabled,
    };
    store.saveSetting(GEMINI_PROFILE_HEALTH_SETTING_KEY, persisted);
  }
}

export const geminiProfileRegistry = getGeminiProfileRegistry();
export const geminiProfileScheduler = new GeminiProfileScheduler({ persist: true });

export function getGeminiProfileSummaries(): GeminiAccountProfileSummary[] {
  return getGeminiProfileRegistry().summaries();
}

function normalizeWorkspace(workspace: string): string {
  return path.resolve(workspace).replace(/\\/g, '/').toLowerCase();
}

export function getGeminiProfileAssignments(): GeminiProfileAssignments {
  const saved = getSQLiteAppStore().getSetting<Partial<GeminiProfileAssignments>>(GEMINI_PROFILE_ASSIGNMENTS_SETTING_KEY);
  return {
    workspaces: saved?.workspaces && typeof saved.workspaces === 'object' ? saved.workspaces : {},
    users: saved?.users && typeof saved.users === 'object' ? saved.users : {},
    ...(typeof saved?.defaultProfileId === 'string' ? { defaultProfileId: saved.defaultProfileId } : {}),
  };
}

export function assignGeminiProfile(
  input: { workspace?: string; userId?: string; profileId: string },
  registry = getGeminiProfileRegistry(),
): GeminiProfileAssignments {
  if (!registry.has(input.profileId)) throw new Error(`Gemini profile "${input.profileId}" is not configured or enabled`);
  const assignments = getGeminiProfileAssignments();
  if (input.workspace) assignments.workspaces[normalizeWorkspace(input.workspace)] = input.profileId;
  if (input.userId) assignments.users[input.userId] = input.profileId;
  if (!input.workspace && !input.userId) assignments.defaultProfileId = input.profileId;
  getSQLiteAppStore().saveSetting(GEMINI_PROFILE_ASSIGNMENTS_SETTING_KEY, assignments);
  invalidateGeminiProfileRegistryCache();
  return assignments;
}

export function selectGeminiProfileId(input: {
  workspace?: string;
  userId?: string;
  taskProfileId?: string;
}, registry = getGeminiProfileRegistry()): string | undefined {
  const assignments = getGeminiProfileAssignments();
  const candidates = [
    input.workspace ? assignments.workspaces[normalizeWorkspace(input.workspace)] : undefined,
    input.userId ? assignments.users[input.userId] : undefined,
    input.taskProfileId,
    assignments.defaultProfileId,
    getRuntimeEnvValue('GEMINI_DEFAULT_PROFILE'),
    registry.list()[0]?.id,
  ];
  return candidates.find((profileId): profileId is string => Boolean(profileId && registry.has(profileId)));
}
