import { getSQLiteAppStore } from '../persistence/sqliteStore.js';
import { getRuntimeEnvValue } from './runtimeEnv.js';

export interface LocalAIEndpoint {
  id: string;
  title: string;
  baseUrl: string;
  modelId: string;
  /** Input context window in tokens for the local model served by this route. */
  contextWindow?: number;
  /**
   * Context window reported by the live server during endpoint discovery.
   * This is kept separate from the user-editable value so stale settings can
   * be corrected without hard-coding a model-specific limit.
   */
  runtimeContextWindow?: number;
  /** Approximate input-token budget before the app compacts messages for this route. */
  inputTokenLimit?: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  source?: 'settings' | 'environment';
}

export interface LocalAIModelTarget extends LocalAIEndpoint {
  value: string;
}

export const LOCAL_AI_ENDPOINTS_SETTING_KEY = 'localAI.endpoints';
export const LOCAL_AI_TARGET_PREFIX = 'local-target:';
export const DEFAULT_LOCAL_AI_CONTEXT_WINDOW = 32_768;
export const DEFAULT_LOCAL_AI_INPUT_TOKEN_LIMIT = 2_750;
const MIN_LOCAL_AI_INPUT_TOKEN_LIMIT = 512;
const MAX_LOCAL_AI_INPUT_TOKEN_LIMIT = 10_000_000;
const MAX_LOCAL_AI_ENDPOINTS = 20;

export function normalizeLocalAIEndpointId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function isAllowedLocalHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost'
    || normalized === '::1'
    || normalized === 'host.docker.internal'
    || normalized.endsWith('.localhost')
    || isPrivateIpv4(normalized)
    || /^f[cd][0-9a-f]{2}:/i.test(normalized)
    || /^fe80:/i.test(normalized);
}

export function normalizeLocalAIBaseUrl(value: unknown, requireLocalNetwork = true): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) throw new Error('Local AI base URL is required.');
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error('Local AI base URL must be a valid HTTP URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Local AI base URL must use http or https.');
  }
  if (url.username || url.password) throw new Error('Local AI base URL cannot contain credentials.');
  if (url.search || url.hash) throw new Error('Local AI base URL cannot contain a query string or fragment.');
  if (requireLocalNetwork && !isAllowedLocalHostname(url.hostname)) {
    throw new Error('Local AI endpoints must use localhost, host.docker.internal, or a private-network IP address.');
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = !pathname || pathname === '/' ? '/v1' : pathname;
  return url.toString().replace(/\/+$/, '');
}

function normalizeEndpoint(
  value: Partial<LocalAIEndpoint>,
  index: number,
  options: { strict: boolean; requireModel: boolean; requireLocalNetwork: boolean },
): LocalAIEndpoint | null {
  try {
    const title = typeof value.title === 'string' ? value.title.trim() : '';
    const modelId = typeof value.modelId === 'string' ? value.modelId.trim() : '';
    if (!title) throw new Error('Local AI name is required.');
    if (title.length > 80) throw new Error('Local AI name must be 80 characters or fewer.');
    if (options.requireModel && !modelId) throw new Error(`Model ID is required for ${title}.`);
    if (modelId.length > 200) throw new Error('Local AI model ID must be 200 characters or fewer.');
    const rawContextWindow = value.contextWindow === undefined || value.contextWindow === null
      ? undefined
      : Number(value.contextWindow);
    if (rawContextWindow !== undefined && (!Number.isFinite(rawContextWindow) || rawContextWindow < 1_024 || rawContextWindow > 10_000_000)) {
      throw new Error('Local AI context window must be between 1,024 and 10,000,000 tokens.');
    }
    const rawRuntimeContextWindow = value.runtimeContextWindow === undefined || value.runtimeContextWindow === null
      ? undefined
      : Number(value.runtimeContextWindow);
    if (rawRuntimeContextWindow !== undefined && (!Number.isFinite(rawRuntimeContextWindow) || rawRuntimeContextWindow < 1_024 || rawRuntimeContextWindow > 10_000_000)) {
      throw new Error('Local AI runtime context window must be between 1,024 and 10,000,000 tokens.');
    }
    const rawInputTokenLimit = value.inputTokenLimit === undefined || value.inputTokenLimit === null
      ? undefined
      : Number(value.inputTokenLimit);
    if (rawInputTokenLimit !== undefined && (!Number.isFinite(rawInputTokenLimit) || rawInputTokenLimit < MIN_LOCAL_AI_INPUT_TOKEN_LIMIT || rawInputTokenLimit > MAX_LOCAL_AI_INPUT_TOKEN_LIMIT)) {
      throw new Error(`Local AI prompt input budget must be between ${MIN_LOCAL_AI_INPUT_TOKEN_LIMIT.toLocaleString()} and ${MAX_LOCAL_AI_INPUT_TOKEN_LIMIT.toLocaleString()} tokens.`);
    }
    const id = normalizeLocalAIEndpointId(
      typeof value.id === 'string' && value.id.trim() ? value.id : `${title}-${index + 1}`,
    );
    if (!id) throw new Error('Local AI endpoint ID is invalid.');
    const now = Date.now();
    return {
      id,
      title,
      baseUrl: normalizeLocalAIBaseUrl(value.baseUrl, options.requireLocalNetwork),
      modelId,
      ...(rawContextWindow !== undefined ? { contextWindow: Math.floor(rawContextWindow) } : {}),
      ...(rawRuntimeContextWindow !== undefined ? { runtimeContextWindow: Math.floor(rawRuntimeContextWindow) } : {}),
      ...(rawInputTokenLimit !== undefined ? { inputTokenLimit: Math.floor(rawInputTokenLimit) } : {}),
      enabled: value.enabled !== false,
      createdAt: Number(value.createdAt) || now,
      updatedAt: Number(value.updatedAt) || now,
      source: value.source === 'environment' ? 'environment' : 'settings',
    };
  } catch (error) {
    if (options.strict) throw error;
    return null;
  }
}

export function normalizeLocalAIEndpoints(
  values: unknown,
  options: { strict?: boolean; requireModel?: boolean; requireLocalNetwork?: boolean } = {},
): LocalAIEndpoint[] {
  if (!Array.isArray(values)) {
    if (options.strict) throw new Error('Local AI endpoints must be an array.');
    return [];
  }
  if (values.length > MAX_LOCAL_AI_ENDPOINTS) throw new Error(`At most ${MAX_LOCAL_AI_ENDPOINTS} local AI endpoints can be configured.`);
  const seen = new Set<string>();
  const endpoints: LocalAIEndpoint[] = [];
  for (const [index, value] of values.entries()) {
    const endpoint = normalizeEndpoint(value as Partial<LocalAIEndpoint>, index, {
      strict: options.strict === true,
      requireModel: options.requireModel !== false,
      requireLocalNetwork: options.requireLocalNetwork !== false,
    });
    if (!endpoint) continue;
    if (seen.has(endpoint.id)) {
      if (options.strict) throw new Error(`Duplicate local AI endpoint ID: ${endpoint.id}.`);
      continue;
    }
    seen.add(endpoint.id);
    endpoints.push(endpoint);
  }
  return endpoints;
}

function getEnvironmentEndpoint(): LocalAIEndpoint[] {
  if (getRuntimeEnvValue('LOCAL_MODEL_ENABLED', 'false').toLowerCase() !== 'true') return [];
  const modelId = getRuntimeEnvValue('LOCAL_MODEL_MODEL', 'qwen2.5-coder').trim();
  if (!modelId) return [];
  const baseUrl = normalizeLocalAIBaseUrl(
    getRuntimeEnvValue('LOCAL_MODEL_BASE_URL', 'http://127.0.0.1:11434/v1'),
    false,
  );
  return [{
    id: 'environment',
    title: 'Local AI (environment)',
    baseUrl,
    modelId,
    ...(() => {
      const contextWindow = Number(getRuntimeEnvValue('LOCAL_MODEL_CONTEXT_WINDOW', String(DEFAULT_LOCAL_AI_CONTEXT_WINDOW)));
      return Number.isFinite(contextWindow) && contextWindow >= 1_024
        ? { contextWindow: Math.floor(contextWindow) }
        : {};
    })(),
    ...(() => {
      const inputTokenLimit = Number(getRuntimeEnvValue('LOCAL_MODEL_INPUT_TOKEN_LIMIT', String(DEFAULT_LOCAL_AI_INPUT_TOKEN_LIMIT)));
      return Number.isFinite(inputTokenLimit)
        && inputTokenLimit >= MIN_LOCAL_AI_INPUT_TOKEN_LIMIT
        && inputTokenLimit <= MAX_LOCAL_AI_INPUT_TOKEN_LIMIT
        ? { inputTokenLimit: Math.floor(inputTokenLimit) }
        : {};
    })(),
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    source: 'environment',
  }];
}

export function getLocalAIEndpoints(): LocalAIEndpoint[] {
  const saved = getSQLiteAppStore().getSetting<unknown>(LOCAL_AI_ENDPOINTS_SETTING_KEY);
  if (saved !== null) return normalizeLocalAIEndpoints(saved);
  return getEnvironmentEndpoint();
}

export function saveLocalAIEndpoints(values: unknown): LocalAIEndpoint[] {
  const endpoints = normalizeLocalAIEndpoints(values, { strict: true });
  const saved = endpoints.map(({ source: _source, ...endpoint }) => endpoint);
  getSQLiteAppStore().saveSetting(LOCAL_AI_ENDPOINTS_SETTING_KEY, saved);
  return saved.map((endpoint) => ({ ...endpoint, source: 'settings' }));
}

export function getLocalAITargetValue(id: string): string {
  return `${LOCAL_AI_TARGET_PREFIX}${normalizeLocalAIEndpointId(id)}`;
}

export function isLocalAITargetValue(model: string): boolean {
  return model.startsWith(LOCAL_AI_TARGET_PREFIX) && model.length > LOCAL_AI_TARGET_PREFIX.length;
}

export function getLocalAITargetId(model: string): string {
  return normalizeLocalAIEndpointId(model.slice(LOCAL_AI_TARGET_PREFIX.length));
}

export function getLocalAIModelTargets(): LocalAIModelTarget[] {
  return getLocalAIEndpoints()
    .filter((endpoint) => endpoint.enabled && endpoint.modelId)
    .map((endpoint) => ({ ...endpoint, value: getLocalAITargetValue(endpoint.id) }));
}

export function resolveLocalAIModelTarget(model: string): LocalAIEndpoint | null {
  if (!isLocalAITargetValue(model)) return null;
  const id = getLocalAITargetId(model);
  return getLocalAIEndpoints().find((endpoint) => endpoint.id === id && endpoint.enabled) || null;
}
