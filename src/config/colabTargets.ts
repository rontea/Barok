import { getSQLiteAppStore } from '../persistence/sqliteStore.js';
import { getRuntimeEnvValue } from './runtimeEnv.js';
import {
  normalizeLocalAIBaseUrl,
  normalizeLocalAIEndpointId,
  normalizeLocalAIEndpoints,
  type LocalAIEndpoint,
} from './localAITargets.js';

/** OpenAI-compatible endpoints exposed by a Colab notebook (usually through a tunnel). */
export type ColabEndpoint = LocalAIEndpoint;

export interface ColabModelTarget extends ColabEndpoint {
  value: string;
}

export const COLAB_ENDPOINTS_SETTING_KEY = 'colab.endpoints';
export const COLAB_TARGET_PREFIX = 'colab-target:';

export function normalizeColabBaseUrl(value: unknown): string {
  return normalizeLocalAIBaseUrl(value, false);
}

export function normalizeColabEndpoints(
  values: unknown,
  options: { strict?: boolean; requireModel?: boolean } = {},
): ColabEndpoint[] {
  return normalizeLocalAIEndpoints(values, {
    strict: options.strict,
    requireModel: options.requireModel,
    // Colab routes are intentionally remote; the user controls which tunnel
    // URL is trusted and can keep source-code fallback approval disabled.
    requireLocalNetwork: false,
  });
}

function getEnvironmentEndpoint(): ColabEndpoint[] {
  if (getRuntimeEnvValue('COLAB_MODEL_ENABLED', 'false').toLowerCase() !== 'true') return [];
  const baseUrl = getRuntimeEnvValue('COLAB_MODEL_BASE_URL', '').trim();
  if (!baseUrl) return [];
  return [{
    id: 'colab-environment',
    title: getRuntimeEnvValue('COLAB_MODEL_TITLE', 'Colab model').trim() || 'Colab model',
    baseUrl: normalizeColabBaseUrl(baseUrl),
    modelId: getRuntimeEnvValue('COLAB_MODEL_MODEL', '').trim(),
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    source: 'environment',
  }];
}

export function getColabEndpoints(): ColabEndpoint[] {
  const saved = getSQLiteAppStore().getSetting<unknown>(COLAB_ENDPOINTS_SETTING_KEY);
  if (saved !== null) return normalizeColabEndpoints(saved);
  return getEnvironmentEndpoint();
}

export function saveColabEndpoints(values: unknown): ColabEndpoint[] {
  const endpoints = normalizeColabEndpoints(values, { strict: true });
  const saved = endpoints.map(({ source: _source, ...endpoint }) => endpoint);
  getSQLiteAppStore().saveSetting(COLAB_ENDPOINTS_SETTING_KEY, saved);
  return saved.map((endpoint) => ({ ...endpoint, source: 'settings' }));
}

export function getColabTargetValue(id: string): string {
  return `${COLAB_TARGET_PREFIX}${normalizeLocalAIEndpointId(id)}`;
}

export function isColabTargetValue(model: string): boolean {
  return model.startsWith(COLAB_TARGET_PREFIX) && model.length > COLAB_TARGET_PREFIX.length;
}

export function getColabTargetId(model: string): string {
  return normalizeLocalAIEndpointId(model.slice(COLAB_TARGET_PREFIX.length));
}

export function getColabModelTargets(): ColabModelTarget[] {
  return getColabEndpoints()
    .filter((endpoint) => endpoint.enabled && endpoint.modelId)
    .map((endpoint) => ({ ...endpoint, value: getColabTargetValue(endpoint.id) }));
}

export function resolveColabModelTarget(model: string): ColabEndpoint | null {
  if (!isColabTargetValue(model)) return null;
  const id = getColabTargetId(model);
  return getColabEndpoints().find((endpoint) => endpoint.id === id && endpoint.enabled) || null;
}
