import { z } from 'zod';
import type { ModelCapabilities, ProviderHealth } from '../di/types.js';
import { getSQLiteAppStore } from '../persistence/sqliteStore.js';
import { getRuntimeEnvValue, getRuntimeGroqApiKey, getRuntimeGroqBaseUrl } from './runtimeEnv.js';
import { getConfiguredGroqModel, saveConfiguredProviderModel } from './providerRouteSettings.js';

export const GROQ_SETTINGS_KEY = 'groq.providerSettings';
export const GROQ_HEALTH_KEY = 'groq.providerHealth';
export const GROQ_USAGE_KEY = 'groq.aggregateUsage';
export const GROQ_FALLBACK_AUDIT_KEY = 'groq.fallbackAudit';

export type GroqModelRole = 'default' | 'fast' | 'classifier' | 'summarizer' | 'planner' | 'coder' | 'reviewer' | 'repair';

const capabilitiesSchema = z.object({
  streaming: z.boolean().default(false),
  toolCalling: z.boolean().default(false),
  structuredOutput: z.boolean().default(false),
  jsonMode: z.boolean().default(false),
  vision: z.boolean().default(false),
  contextTokenLimit: z.number().int().min(1_024).max(10_000_000).optional(),
  outputTokenLimit: z.number().int().min(1).max(1_000_000).optional(),
});

export const groqSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  defaultModel: z.string().trim().max(200).default(''),
  fastModel: z.string().trim().max(200).default(''),
  classifierModel: z.string().trim().max(200).default(''),
  summarizerModel: z.string().trim().max(200).default(''),
  plannerModel: z.string().trim().max(200).default(''),
  coderModel: z.string().trim().max(200).default(''),
  reviewerModel: z.string().trim().max(200).default(''),
  repairModel: z.string().trim().max(200).default(''),
  requestTimeoutSeconds: z.number().int().min(5).max(300).default(90),
  maxRetries: z.number().int().min(0).max(3).default(3),
  retryBaseDelayMs: z.number().int().min(1).max(10_000).default(2_000),
  retryMaxDelayMs: z.number().int().min(1).max(30_000).default(30_000),
  maxConcurrency: z.number().int().min(1).max(8).default(1),
  maxPendingRequests: z.number().int().min(1).max(100).default(25),
  maxRequestsPerTask: z.number().int().min(1).max(50).default(10),
  fallbackEnabled: z.boolean().default(false),
  fallbackProviders: z.array(z.string().trim().min(1).max(50)).max(10).default([]),
  fallbackRequiresApproval: z.boolean().default(true),
  streamingEnabled: z.boolean().default(true),
  cacheTtlSeconds: z.number().int().min(0).max(86_400).default(300),
  capabilities: z.record(z.string(), capabilitiesSchema).default({}),
});

export type GroqSettings = z.infer<typeof groqSettingsSchema>;

export interface GroqRuntimeConfig extends GroqSettings {
  apiKey: string;
  baseUrl: string;
  configurationError?: string;
}

export interface GroqAggregateUsage {
  requests: number;
  retries: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  cacheHits: number;
  fallbackCount: number;
  updatedAt: string;
}

const DEFAULT_SETTINGS: GroqSettings = groqSettingsSchema.parse({});

function readBooleanEnv(name: string): boolean | undefined {
  const value = getRuntimeEnvValue(name, '');
  if (!value) return undefined;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  throw new Error(`${name} must be true or false.`);
}

function readNumberEnv(name: string): number | undefined {
  const value = getRuntimeEnvValue(name, '');
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number.`);
  return parsed;
}

function readListEnv(name: string): string[] | undefined {
  const value = getRuntimeEnvValue(name, '');
  return value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : undefined;
}

function envModel(name: string): string | undefined {
  const value = getRuntimeEnvValue(name, '').trim();
  return value || undefined;
}

export function loadGroqSettings(): GroqSettings {
  const store = getSQLiteAppStore();
  const saved = store.getSetting<Partial<GroqSettings>>(GROQ_SETTINGS_KEY) || {};
  const legacyModel = getConfiguredGroqModel();
  const candidate = {
    ...DEFAULT_SETTINGS,
    ...saved,
    defaultModel: envModel('GROQ_DEFAULT_MODEL') ?? saved.defaultModel ?? legacyModel ?? '',
    fastModel: envModel('GROQ_FAST_MODEL') ?? saved.fastModel ?? '',
    classifierModel: envModel('GROQ_CLASSIFIER_MODEL') ?? saved.classifierModel ?? '',
    summarizerModel: envModel('GROQ_SUMMARIZER_MODEL') ?? saved.summarizerModel ?? '',
    plannerModel: envModel('GROQ_PLANNER_MODEL') ?? saved.plannerModel ?? '',
    coderModel: envModel('GROQ_CODER_MODEL') ?? saved.coderModel ?? '',
    reviewerModel: envModel('GROQ_REVIEWER_MODEL') ?? saved.reviewerModel ?? '',
    repairModel: envModel('GROQ_REPAIR_MODEL') ?? saved.repairModel ?? '',
    enabled: readBooleanEnv('GROQ_ENABLED') ?? saved.enabled ?? DEFAULT_SETTINGS.enabled,
    requestTimeoutSeconds: readNumberEnv('GROQ_REQUEST_TIMEOUT_SECONDS') ?? saved.requestTimeoutSeconds,
    maxRetries: readNumberEnv('GROQ_MAX_RETRIES') ?? saved.maxRetries,
    retryBaseDelayMs: readNumberEnv('GROQ_RETRY_BASE_DELAY_MS') ?? saved.retryBaseDelayMs,
    retryMaxDelayMs: readNumberEnv('GROQ_RETRY_MAX_DELAY_MS') ?? saved.retryMaxDelayMs,
    maxConcurrency: readNumberEnv('GROQ_MAX_CONCURRENCY') ?? saved.maxConcurrency,
    maxPendingRequests: readNumberEnv('GROQ_MAX_PENDING_REQUESTS') ?? saved.maxPendingRequests,
    maxRequestsPerTask: readNumberEnv('GROQ_MAX_REQUESTS_PER_TASK') ?? saved.maxRequestsPerTask,
    fallbackEnabled: readBooleanEnv('GROQ_FALLBACK_ENABLED') ?? saved.fallbackEnabled,
    fallbackProviders: readListEnv('GROQ_FALLBACK_PROVIDERS') ?? saved.fallbackProviders,
    fallbackRequiresApproval: readBooleanEnv('GROQ_FALLBACK_REQUIRES_APPROVAL') ?? saved.fallbackRequiresApproval,
    streamingEnabled: readBooleanEnv('GROQ_STREAMING_ENABLED') ?? saved.streamingEnabled,
    cacheTtlSeconds: readNumberEnv('GROQ_CACHE_TTL_SECONDS') ?? saved.cacheTtlSeconds,
  };
  const parsed = groqSettingsSchema.parse(candidate);
  if (!store.getSetting(GROQ_SETTINGS_KEY)) store.saveSetting(GROQ_SETTINGS_KEY, parsed);
  return parsed;
}

export function loadGroqRuntimeConfig(): GroqRuntimeConfig {
  return {
    ...loadGroqSettings(),
    apiKey: getRuntimeGroqApiKey(),
    baseUrl: getRuntimeGroqBaseUrl().replace(/\/+$/, ''),
  };
}

export function loadGroqRuntimeConfigSafe(): GroqRuntimeConfig {
  try {
    return loadGroqRuntimeConfig();
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      enabled: false,
      apiKey: getRuntimeGroqApiKey(),
      baseUrl: getRuntimeGroqBaseUrl().replace(/\/+$/, ''),
      configurationError: 'Groq configuration contains an invalid value.',
    };
  }
}

export function saveGroqSettings(value: unknown): GroqSettings {
  const current = loadGroqSettings();
  const input = value && typeof value === 'object' ? value as Partial<GroqSettings> : {};
  const parsed = groqSettingsSchema.parse({ ...current, ...input });
  getSQLiteAppStore().saveSetting(GROQ_SETTINGS_KEY, parsed);
  if (parsed.defaultModel) saveConfiguredProviderModel('groq', parsed.defaultModel);
  return parsed;
}

export function getGroqPublicSettings(): GroqSettings {
  try {
    return loadGroqSettings();
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function resolveGroqRoleModel(
  role: GroqModelRole | undefined,
  settings = loadGroqSettings(),
): string {
  const roleKey: Partial<Record<GroqModelRole, keyof GroqSettings>> = {
    fast: 'fastModel',
    classifier: 'classifierModel',
    summarizer: 'summarizerModel',
    planner: 'plannerModel',
    coder: 'coderModel',
    reviewer: 'reviewerModel',
    repair: 'repairModel',
  };
  const selected = role && role !== 'default' ? String(settings[roleKey[role]!] || '').trim() : '';
  const model = selected || settings.defaultModel.trim();
  if (!model) throw new Error(`Groq ${role || 'default'} model is not configured.`);
  return model;
}

export function getGroqModelCapabilities(model: string, settings = loadGroqSettings()): ModelCapabilities {
  return settings.capabilities[model] || {
    streaming: false,
    toolCalling: false,
    structuredOutput: false,
    jsonMode: false,
    vision: false,
  };
}

export function readGroqHealth(): ProviderHealth {
  const saved = getSQLiteAppStore().getSetting<ProviderHealth>(GROQ_HEALTH_KEY);
  if (saved) return saved;
  const config = loadGroqRuntimeConfigSafe();
  if (!config.enabled) return { state: 'disabled', credentialState: config.apiKey ? 'configured' : 'not_configured', message: 'Groq is disabled.' };
  if (!config.apiKey || !config.defaultModel) {
    return { state: 'misconfigured', credentialState: config.apiKey ? 'configured' : 'not_configured', message: 'Groq requires GROQ_API_KEY and a default model.' };
  }
  return { state: 'available', credentialState: 'configured', message: 'Groq is configured.', model: config.defaultModel };
}

export function saveGroqHealth(health: ProviderHealth): void {
  getSQLiteAppStore().saveSetting(GROQ_HEALTH_KEY, health);
}

export function readGroqAggregateUsage(): GroqAggregateUsage {
  return getSQLiteAppStore().getSetting<GroqAggregateUsage>(GROQ_USAGE_KEY) || {
    requests: 0, retries: 0, failures: 0, inputTokens: 0, outputTokens: 0,
    cacheHits: 0, fallbackCount: 0, updatedAt: new Date(0).toISOString(),
  };
}

export function recordGroqAggregateUsage(delta: Partial<Omit<GroqAggregateUsage, 'updatedAt'>>): GroqAggregateUsage {
  const current = readGroqAggregateUsage();
  const next = {
    ...current,
    ...Object.fromEntries(Object.entries(delta).map(([key, value]) => [
      key,
      Number(current[key as keyof GroqAggregateUsage] || 0) + Number(value || 0),
    ])),
    updatedAt: new Date().toISOString(),
  } as GroqAggregateUsage;
  getSQLiteAppStore().saveSetting(GROQ_USAGE_KEY, next);
  return next;
}

export function recordGroqFallbackAudit(entry: {
  destination: string;
  reason: 'rate_limit' | 'quota_exhausted' | 'model_unavailable' | 'temporarily_unavailable';
  approved: boolean;
}): void {
  const store = getSQLiteAppStore();
  const current = store.getSetting<Array<Record<string, unknown>>>(GROQ_FALLBACK_AUDIT_KEY) || [];
  current.push({ ...entry, provider: 'groq', at: new Date().toISOString() });
  store.saveSetting(GROQ_FALLBACK_AUDIT_KEY, current.slice(-100));
  recordGroqAggregateUsage({ fallbackCount: 1 });
}
