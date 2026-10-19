import { getSQLiteAppStore } from '../persistence/sqliteStore.js';
import {
  getRuntimeOpenRouterApiKey,
  getRuntimeOpenRouterBaseUrl,
} from './runtimeEnv.js';

export const OPENROUTER_ACCOUNT_SETTINGS_KEY = 'openrouter.account';

interface StoredOpenRouterAccount {
  apiKey?: string;
}

export interface OpenRouterPublicAccountSettings {
  apiKeyConfigured: boolean;
  keySource: 'environment' | 'none';
  baseUrl: string;
}

function clearLegacyStoredAccount(): void {
  const store = getSQLiteAppStore();
  const stored = store.getSetting<StoredOpenRouterAccount>(OPENROUTER_ACCOUNT_SETTINGS_KEY);
  if (stored && typeof stored.apiKey === 'string' && stored.apiKey.trim()) {
    // API credentials are environment-only. Remove copies created by the
    // previous Settings form rather than leaving secrets in SQLite.
    store.saveSetting(OPENROUTER_ACCOUNT_SETTINGS_KEY, {});
  }
}

export function getConfiguredOpenRouterApiKey(): string {
  clearLegacyStoredAccount();
  return getRuntimeOpenRouterApiKey().trim();
}

export function getOpenRouterPublicAccountSettings(): OpenRouterPublicAccountSettings {
  clearLegacyStoredAccount();
  const environmentKey = getRuntimeOpenRouterApiKey().trim();
  return {
    apiKeyConfigured: Boolean(environmentKey),
    keySource: environmentKey ? 'environment' : 'none',
    baseUrl: getRuntimeOpenRouterBaseUrl(),
  };
}

export function saveOpenRouterAccountSettings(value: unknown): OpenRouterPublicAccountSettings {
  void value;
  clearLegacyStoredAccount();
  throw new Error('OpenRouter API keys are environment-only. Set OPENROUTER_API_KEY in .env and restart the server.');
}
