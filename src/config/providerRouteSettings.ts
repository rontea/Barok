import { getSQLiteAppStore } from '../persistence/sqliteStore.js';
import { getRuntimeSambaNovaModel } from './runtimeEnv.js';

export type ConfigurableRouteProvider = 'openrouter' | 'groq' | 'kimi' | 'requesty' | 'sambanova';

export interface ProviderRouteSettings {
  openrouterModel: string;
  groqModel: string;
  kimiModel: string;
  requestyModel: string;
  sambanovaModel: string;
}

export const PROVIDER_ROUTE_SETTINGS_KEY = 'llm.providerRoutes';
// OpenRouter model selection is persisted in SQLite/API Settings. This value
// is only the first-install default used when no route has been saved yet.
export const DEFAULT_OPENROUTER_MODEL = 'dots-studio/dots-3-note-preview:free';
export const DEFAULT_GROQ_MODEL = '';
export const DEFAULT_KIMI_MODEL = 'kimi-k2.7-code';
export const DEFAULT_REQUESTY_MODEL = 'poolside/laguna-m.1';
export const DEFAULT_SAMBANOVA_MODEL = 'gpt-oss-120b';

function normalizeModel(provider: ConfigurableRouteProvider, value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const prefix = `${provider}:`;
  const normalized = (raw.startsWith(prefix) ? raw.slice(prefix.length) : raw).trim();
  return normalized;
}

function readSettings(): ProviderRouteSettings {
  const store = getSQLiteAppStore();
  const saved = store.getSetting<Partial<ProviderRouteSettings>>(PROVIDER_ROUTE_SETTINGS_KEY);
  const openrouterModel = normalizeModel('openrouter', saved?.openrouterModel)
    || DEFAULT_OPENROUTER_MODEL;
  const groqModel = normalizeModel('groq', saved?.groqModel)
    || DEFAULT_GROQ_MODEL;
  const kimiModel = normalizeModel('kimi', saved?.kimiModel)
    || DEFAULT_KIMI_MODEL;
  const requestyModel = normalizeModel('requesty', saved?.requestyModel)
    || DEFAULT_REQUESTY_MODEL;
  const sambanovaModel = normalizeModel('sambanova', saved?.sambanovaModel)
    || getRuntimeSambaNovaModel().trim()
    || DEFAULT_SAMBANOVA_MODEL;
  const normalized = { openrouterModel, groqModel, kimiModel, requestyModel, sambanovaModel };

  if (!saved || saved.openrouterModel !== openrouterModel || saved.groqModel !== groqModel || saved.kimiModel !== kimiModel || saved.requestyModel !== requestyModel || saved.sambanovaModel !== sambanovaModel) {
    // Initialize defaults once; subsequent changes are owned by API Pool.
    store.saveSetting(PROVIDER_ROUTE_SETTINGS_KEY, normalized);
  }
  return normalized;
}

export function getConfiguredOpenRouterModel(): string {
  return readSettings().openrouterModel;
}

export function getConfiguredGroqModel(): string {
  return readSettings().groqModel;
}

export function getConfiguredKimiModel(): string {
  return readSettings().kimiModel;
}

export function getConfiguredRequestyModel(): string {
  return readSettings().requestyModel;
}

export function getConfiguredSambaNovaModel(): string {
  return readSettings().sambanovaModel;
}

export function saveConfiguredProviderModel(
  provider: ConfigurableRouteProvider,
  model: unknown,
): ProviderRouteSettings {
  const normalizedModel = normalizeModel(provider, model);
  if (!normalizedModel) throw new Error(`${provider === 'groq' ? 'Groq' : provider === 'kimi' ? 'Kimi' : provider === 'requesty' ? 'Requesty' : provider === 'sambanova' ? 'SambaNova' : 'OpenRouter'} model is required.`);
  if (normalizedModel.length > 200) throw new Error('Provider model must be 200 characters or fewer.');

  const current = readSettings();
  const next = provider === 'openrouter'
    ? { ...current, openrouterModel: normalizedModel }
    : provider === 'groq'
      ? { ...current, groqModel: normalizedModel }
      : provider === 'kimi'
        ? { ...current, kimiModel: normalizedModel }
        : provider === 'requesty'
          ? { ...current, requestyModel: normalizedModel }
          : { ...current, sambanovaModel: normalizedModel };
  getSQLiteAppStore().saveSetting(PROVIDER_ROUTE_SETTINGS_KEY, next);
  return next;
}
