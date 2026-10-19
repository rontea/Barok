import { Router } from 'express';
import { createHash } from 'crypto';
import { sanitizeError, isProviderSettingsMutationAuthorized } from './_shared.js';
import { getRuntimeSettings } from '../config/runtimeSettings.js';
import {
  getCachedGeminiAccountProfiles,
  getGeminiProfileRegistry,
  getManagedGeminiProfiles,
  saveManagedGeminiProfile,
  removeManagedGeminiProfile,
  selectGeminiProfileId,
  assignGeminiProfile,
  getGeminiProfileAssignments,
  geminiProfileScheduler,
} from '../config/geminiProfiles.js';
import {
  getGeminiApiKeySummaries,
  getGeminiTargetModelValue,
  getSavedGeminiModelTargets,
  resolveGeminiModelTarget,
  getGeminiModelTargetResolutionIssue,
  isGeminiTargetModelValue,
  saveGeminiModelTargets,
} from '../config/geminiTargets.js';
import {
  getNvidiaApiKeySummaries,
  getNvidiaTargetModelValue,
  getSavedNvidiaModelTargets,
  resolveNvidiaModelTarget,
  isNvidiaTargetModelValue,
  parseNvidiaRuntimeKeys,
  saveNvidiaModelTargets,
} from '../config/nvidiaTargets.js';
import {
  getLocalAIEndpoints,
  normalizeLocalAIEndpoints,
  saveLocalAIEndpoints,
  getLocalAIModelTargets,
  isLocalAITargetValue,
  resolveLocalAIModelTarget,
} from '../config/localAITargets.js';
import {
  getColabEndpoints,
  normalizeColabEndpoints,
  saveColabEndpoints,
  getColabModelTargets,
  isColabTargetValue,
  resolveColabModelTarget,
} from '../config/colabTargets.js';
import {
  getSavedOpenRouterModelTargets,
  getOpenRouterModelTarget,
  getOpenRouterTargetModelValue,
  getConfiguredOpenRouterStructuredModel,
  saveConfiguredOpenRouterStructuredModel,
  normalizeOpenRouterModelTargets,
  saveOpenRouterModelTargets,
  addOpenRouterModelTarget,
  removeOpenRouterModelTarget,
  syncOpenRouterModelTargetMetadata,
} from '../config/openRouterTargets.js';
import { getConfiguredOpenRouterApiKey, getOpenRouterPublicAccountSettings } from '../config/openRouterConfig.js';
import {
  loadGroqRuntimeConfigSafe,
  saveGroqSettings,
  readGroqAggregateUsage,
  getGroqPublicSettings,
} from '../config/groqConfig.js';
import { getGroqModelTargets } from '../config/groqTargets.js';
import { resetGroqScheduler } from '../di/providers/providerScheduler.js';
import {
  CerebrasLLMProvider,
  GeminiLLMProvider,
  GroqLLMProvider,
  KimiLLMProvider,
  ColabModelLLMProvider,
  LocalModelLLMProvider,
  NvidiaLLMProvider,
  OpenRouterLLMProvider,
  PollinationsLLMProvider,
  RequestyLLMProvider,
  SambaNovaLLMProvider,
  resolveOpenRouterRequestModel,
} from '../di/providers/llmProvider.js';
import { SAMBANOVA_MODEL_CATALOG } from '../config/sambaNovaModels.js';
import { pollinationsClient } from '../pollinations/client.js';
import {
  getSavedPollinationsModelCatalog,
  fetchAndSavePollinationsModelCatalog,
  getPollinationsTextModelTargets,
  isPollinationsTextChatModel,
} from '../config/pollinationsModels.js';
import {
  getProviderRateLimitStatuses,
  resetProviderRoute,
  recordProviderSuccess,
  recordProviderFailure,
} from '../di/providers/rateLimitMonitor.js';
import { resetDIContainer } from '../di/container.js';
import {
  getRuntimeGeminiApiKey,
  getRuntimeEnvValue,
  getLegacyOpenRouterConfigurationWarning,
  getLegacyGroqConfigurationWarning,
  getRuntimeOpenRouterBaseUrl,
  getRuntimeGroqApiKey,
  getRuntimeCerebrasApiKey,
  getRuntimeCerebrasBaseUrl,
  getRuntimeCerebrasModel,
  getRuntimeSambaNovaApiKey,
  getRuntimeSambaNovaBaseUrl,
  getRuntimeKimiApiKey,
  getRuntimeKimiBaseUrl,
  getRuntimeRequestyApiKey,
  getRuntimeRequestyBaseUrl,
  getRuntimePollinationsApiKey,
} from '../config/runtimeEnv.js';
import { parseOpenRouterAccountStatus } from '../di/providers/openRouterAccount.js';
import {
  getConfiguredKimiModel,
  getConfiguredOpenRouterModel,
  getConfiguredRequestyModel,
  getConfiguredSambaNovaModel,
  saveConfiguredProviderModel,
} from '../config/providerRouteSettings.js';
import { normalizeCoderModelSelection } from '../config/providerSelection.js';
import { getConfiguredCoderModelSelection } from '../config/coderModel.js';
import { getModelCapabilityProfile, getProviderModelCapabilityProfile } from '../config/modelCapabilities.js';
import { getNvidiaModelMetadata, isNvidiaModel } from '../config/nvidiaModels.js';
import { getGeminiFreeChatModelIds } from '../config/geminiModels.js';
import { PerformanceCache } from '../utils/performanceCache.js';

const PROVIDER_MODEL_DISCOVERY_TTL_MS = 60_000;
const providerModelDiscoveryCache = new PerformanceCache<string[]>({
  ttlMs: PROVIDER_MODEL_DISCOVERY_TTL_MS,
  maxEntries: 8,
});

function summarizePollinationsBalanceFailure(status: number | null, body: string): string {
  if (/worker threw exception|cf-error-code[^>]*>\s*1101|error\s+1101/i.test(body)) {
    return `Pollinations balance service hit a Cloudflare Worker error (1101${status ? `, HTTP ${status}` : ''}). Try again shortly.`;
  }

  if (status !== null && status >= 500 && /<\s*!doctype\s+html|<html\b/i.test(body)) {
    return `Pollinations balance service returned an HTML error page (HTTP ${status}). Try again shortly.`;
  }

  const detail = sanitizeError(body).replace(/\s+/g, ' ').trim().slice(0, 240);
  return detail || (status === null
    ? 'Pollinations balance service could not be reached.'
    : `Pollinations balance request failed (HTTP ${status}).`);
}

async function getCachedProviderModelDiscovery(
  provider: 'kimi' | 'requesty',
  apiKey: string,
  baseUrl: string,
  discover: () => Promise<string[]>,
): Promise<string[]> {
  const credentialFingerprint = createHash('sha256')
    .update(baseUrl + '\0' + apiKey)
    .digest('hex');
  const cacheKey = provider + ':' + credentialFingerprint;
  const cached = providerModelDiscoveryCache.getStaleWhileRevalidate(cacheKey, discover);
  if (cached !== null) return cached;
  return providerModelDiscoveryCache.getOrCompute(cacheKey, discover);
}

export type ApiKeyHealth = {
  isHealthy: boolean;
  healthStatus: 'healthy' | 'error' | 'timeout';
  errorCode?: string;
  errorMessage?: string;
  lastChecked: string;
};
export const keyHealthCache = new Map<string, { expiresAt: number; result: ApiKeyHealth }>();

export async function checkApiKeyHealth(
  provider: 'gemini' | 'nvidia',
  keyIndex: number,
  apiKey: string
): Promise<ApiKeyHealth> {
  const cacheKey = `${provider}:${keyIndex}`;
  const cached = keyHealthCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const lastChecked = new Date().toISOString();
  try {
    const response = provider === 'gemini'
      ? await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
          headers: { 'x-goog-api-key': apiKey },
          signal: AbortSignal.timeout(8_000),
        })
      : await fetch('https://integrate.api.nvidia.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8_000),
        });
    const result: ApiKeyHealth = response.ok
      ? { isHealthy: true, healthStatus: 'healthy', lastChecked }
      : {
          isHealthy: false,
          healthStatus: 'error',
          errorCode: String(response.status),
          errorMessage: `${provider === 'gemini' ? 'Gemini' : 'NVIDIA'} authentication check returned HTTP ${response.status}.`,
          lastChecked,
        };
    keyHealthCache.set(cacheKey, { expiresAt: Date.now() + 60_000, result });
    return result;
  } catch (error) {
    const timedOut = error instanceof Error && /timeout|abort/i.test(`${error.name} ${error.message}`);
    const result: ApiKeyHealth = {
      isHealthy: false,
      healthStatus: timedOut ? 'timeout' : 'error',
      errorCode: timedOut ? 'TIMEOUT' : 'CONNECTION_ERROR',
      errorMessage: timedOut
        ? `${provider === 'gemini' ? 'Gemini' : 'NVIDIA'} health check timed out.`
        : sanitizeError(error instanceof Error ? error.message : String(error)),
      lastChecked,
    };
    keyHealthCache.set(cacheKey, { expiresAt: Date.now() + 15_000, result });
    return result;
  }
}

export interface LocalAIDiscovery {
  models: string[];
  /** Actual context configured in the running OpenAI-compatible server. */
  runtimeContextWindow?: number;
  contextWindowByModel: Record<string, number>;
  supportsTools?: boolean;
  totalSlots?: number;
}

export async function discoverLocalAIModels(baseUrl: string): Promise<LocalAIDiscovery> {
  const response = await fetch(`${baseUrl}/models`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Model discovery returned HTTP ${response.status}.`);
  const entries = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  const models = [...new Set<string>(entries
    .map((entry: any) => typeof entry === 'string' ? entry : entry?.id || entry?.name)
    .filter((modelId: unknown): modelId is string => typeof modelId === 'string' && modelId.trim().length > 0)
    .map((modelId: string) => modelId.trim()))];
  const contextWindowByModel = Object.fromEntries(entries
    .map((entry: any) => {
      const modelId = typeof entry === 'string' ? entry : entry?.id || entry?.name;
      const contextWindow = Number(entry?.meta?.n_ctx ?? entry?.n_ctx);
      return typeof modelId === 'string' && Number.isFinite(contextWindow) && contextWindow >= 1_024
        ? [modelId.trim(), Math.floor(contextWindow)]
        : null;
    })
    .filter((entry: [string, number] | null): entry is [string, number] => Boolean(entry)));

  // llama.cpp exposes the authoritative runtime context and slot count at
  // /props. Other OpenAI-compatible servers may not, so this probe is
  // optional and discovery still succeeds when it is unavailable.
  let props: any = undefined;
  try {
    const rootBaseUrl = baseUrl.replace(/\/v1$/i, '');
    const propsResponse = await fetch(`${rootBaseUrl}/props`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(2_000),
    });
    if (propsResponse.ok) props = await propsResponse.json().catch(() => undefined);
  } catch {
    // /props is llama.cpp-specific; ignore unsupported or unavailable probes.
  }
  const propsContextWindow = Number(props?.n_ctx ?? props?.default_generation_settings?.n_ctx);
  const runtimeContextWindow = Number.isFinite(propsContextWindow) && propsContextWindow >= 1_024
    ? Math.floor(propsContextWindow)
    : Object.values(contextWindowByModel)[0];
  const capabilities = entries.flatMap((entry: any) => Array.isArray(entry?.capabilities) ? entry.capabilities : []);
  return {
    models,
    contextWindowByModel,
    ...(runtimeContextWindow ? { runtimeContextWindow } : {}),
    ...(capabilities.length ? { supportsTools: capabilities.some((capability: unknown) => /tool/i.test(String(capability))) } : {}),
    ...(Number.isFinite(Number(props?.total_slots)) ? { totalSlots: Math.floor(Number(props.total_slots)) } : {}),
  };
}

export function resolveDiscoveredModel(
  requestedModel: string,
  discoveredModels: string[],
  providerLabel: string,
): { model: string; warning?: string } {
  const requested = requestedModel.trim();
  if (!requested || discoveredModels.length === 0 || discoveredModels.includes(requested)) {
    return { model: requested || discoveredModels[0] || '' };
  }

  const discovered = discoveredModels[0];
  return {
    model: discovered,
    warning: `${providerLabel} model "${requested}" was not advertised by /models; using discovered model "${discovered}".`,
  };
}

export interface ProvidersRouterDependencies {
  ensureWorkspaceRoot: (workspace?: string) => Promise<string>;
  createTestProvider?: (provider: string) => { createChatCompletion: (...args: any[]) => Promise<string> };
}

export function createRouter({ ensureWorkspaceRoot, createTestProvider }: ProvidersRouterDependencies) {
  const router = Router();
  const providerForTest = (
    provider: string,
    fallback: { createChatCompletion: (...args: any[]) => Promise<string> },
  ) => createTestProvider?.(provider) || fallback;

  router.get('/api/providers/rate-limits', async (_req, res) => {
    try {
      const groqConfig = loadGroqRuntimeConfigSafe();
      const configuredRoutes = [
        ...getSavedGeminiModelTargets().map((target) => ({
          provider: 'gemini',
          model: target.modelId,
          tier: 'free' as const,
          credentialIndex: target.apiKeyIndex,
        })),
        ...getSavedNvidiaModelTargets().map((target) => ({
          provider: 'nvidia',
          model: target.modelId,
          tier: 'free' as const,
          credentialIndex: target.apiKeyIndex,
        })),
        {
          provider: 'openrouter',
          model: getConfiguredOpenRouterModel(),
          tier: 'free' as const,
        },
        ...(groqConfig.enabled && groqConfig.apiKey && groqConfig.defaultModel ? [{
          provider: 'groq',
          model: groqConfig.defaultModel,
          tier: 'free' as const,
        }] : []),
        {
          provider: 'kimi',
          model: getConfiguredKimiModel(),
          tier: 'free' as const,
        },
        {
          provider: 'requesty',
          model: getConfiguredRequestyModel(),
          tier: 'free' as const,
        },
        ...getColabModelTargets().map((target) => ({
          provider: 'colab',
          model: target.modelId,
          tier: 'unknown' as const,
        })),
      ];
      return res.json({
        generatedAt: new Date().toISOString(),
        routes: getProviderRateLimitStatuses(configuredRoutes),
      });
    } catch (error: any) {
      return res.status(500).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.post('/api/providers/rate-limits/reset', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Provider settings changes require same-origin access or an authorized server token.' });
    }
    const provider = typeof req.body?.provider === 'string' ? req.body.provider.trim() : '';
    const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
    const credentialIndex = Number.isInteger(req.body?.credentialIndex) ? req.body.credentialIndex : undefined;
    if (!provider || !model) {
      return res.status(400).json({ error: 'Provider and model are required.' });
    }
    return res.json({ success: true, removed: resetProviderRoute(provider, model, credentialIndex) });
  });

  router.get('/api/gemini/profiles', (req, res) => {
    try {
      const registry = getGeminiProfileRegistry();
      const loadedProfiles = getCachedGeminiAccountProfiles();
      const managedProfileIds = new Set(getManagedGeminiProfiles().map((profile) => profile.id));
      const assignments = getGeminiProfileAssignments();
      const profiles = registry.summaries().map((profile) => {
        const loaded = loadedProfiles.find((candidate) => candidate.id === profile.id);
        const health = geminiProfileScheduler.getStatus(profile.id)[0];
        return {
          ...profile,
          name: profile.label,
          envVar: loaded?.envVar,
          keyPreview: profile.keySuffix ? `...${profile.keySuffix}` : undefined,
          isDefault: assignments.defaultProfileId === profile.id,
          source: managedProfileIds.has(profile.id) ? 'sqlite' : 'env',
          health,
          status: health?.status || 'available',
          usageCount: health?.requestCount || 0,
          errorCount: health?.errorCount || 0,
          lastUsed: health?.lastUsedAt ? new Date(health.lastUsedAt).toISOString() : null,
          assignedTargets: [],
        };
      });
      const availableEnvVars = new Set([
        'GEMINI_API_KEY',
        'GEMINI_ACCOUNT_A_API_KEY',
        'GEMINI_ACCOUNT_B_API_KEY',
        'GEMINI_ACCOUNT_C_API_KEY',
        ...loadedProfiles.map((profile) => profile.envVar),
      ]);
      const availableEnvKeys = Array.from(availableEnvVars).flatMap((envVar) => {
        const rawValue = getRuntimeEnvValue(envVar);
        const keyValue = envVar === 'GEMINI_API_KEYS'
          ? rawValue.split(',')[0]?.split(':')[0]?.trim() || ''
          : rawValue;
        if (!keyValue) return [];
        const keySuffix = keyValue.slice(-5);
        return [{
          envVar,
          keySuffix,
          preview: `...${keySuffix}`,
          isConfigured: true,
          assignedProfiles: profiles.filter((profile) => profile.envVar === envVar).map((profile) => profile.id),
        }];
      });
      res.json({
        configured: profiles.length > 0,
        profiles,
        availableEnvKeys,
        assignments,
        defaultProfileId: assignments.defaultProfileId,
        selectedProfileId: selectGeminiProfileId({
          workspace: typeof req.query.workspace === 'string' ? req.query.workspace : undefined,
          userId: typeof req.query.userId === 'string' ? req.query.userId : undefined,
        }, registry),
        maximumRequestsPerTask: getRuntimeSettings().maxLlmRequestsPerTask,
      });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.put('/api/gemini/profiles/default', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Provider settings changes require same-origin access or an authorized server token.' });
    }
    try {
      const profileId = typeof req.body?.profileId === 'string' ? req.body.profileId.trim() : '';
      if (!profileId) return res.status(400).json({ error: 'profileId is required' });
      const registry = getGeminiProfileRegistry();
      const assignments = assignGeminiProfile({ profileId }, registry);
      return res.json({ success: true, profileId, assignments });
    } catch (error: any) {
      return res.status(400).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.post('/api/gemini/profiles', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Provider settings changes require same-origin access or an authorized server token.' });
    }
    try {
      const id = typeof req.body?.id === 'string' ? req.body.id.trim().toLowerCase() : '';
      const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
      const purpose = typeof req.body?.purpose === 'string' ? req.body.purpose.trim() : 'general';
      const envVar = typeof req.body?.envVar === 'string' ? req.body.envVar.trim() : '';
      if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(id)) {
        return res.status(400).json({ error: 'Profile ID must be 2-64 characters using letters, numbers, hyphens, or underscores.' });
      }
      if (!label || label.length > 120) return res.status(400).json({ error: 'A profile label between 1 and 120 characters is required.' });
      if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(envVar)) return res.status(400).json({ error: 'Environment key must use uppercase letters, numbers, and underscores.' });
      if (!getRuntimeEnvValue(envVar)) return res.status(400).json({ error: `Environment key ${envVar} is not configured.` });

      const profile = saveManagedGeminiProfile({ id, label, purpose: purpose || 'general', envVar, enabled: true });
      const registry = getGeminiProfileRegistry();
      if (!registry.has(profile.id)) return res.status(400).json({ error: `Environment key ${envVar} could not be loaded as a Gemini profile.` });
      if (req.body?.setAsDefault === true) assignGeminiProfile({ profileId: profile.id }, registry);
      resetDIContainer();
      return res.status(201).json({ success: true, message: `Profile "${label}" successfully created and mapped.`, profileId: profile.id });
    } catch (error: any) {
      return res.status(400).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.delete('/api/gemini/profiles/:id', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Provider settings changes require same-origin access or an authorized server token.' });
    }
    try {
      const profileId = req.params.id.trim();
      if (!profileId) return res.status(400).json({ error: 'Profile ID is required' });
      const registry = getGeminiProfileRegistry();
      if (!registry.has(profileId)) return res.status(404).json({ error: `Gemini profile "${sanitizeError(profileId)}" was not found.` });
      removeManagedGeminiProfile(profileId);
      resetDIContainer();
      return res.json({ success: true, profileId });
    } catch (error: any) {
      return res.status(400).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.put('/api/gemini/profiles/assignment', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Provider settings changes require same-origin access or an authorized server token.' });
    }
    try {
      const profileId = typeof req.body?.profileId === 'string' ? req.body.profileId.trim() : '';
      if (!profileId) return res.status(400).json({ error: 'profileId is required' });
      const workspace = typeof req.body?.workspace === 'string'
        ? await ensureWorkspaceRoot(req.body.workspace)
        : undefined;
      const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : undefined;
      const assignments = assignGeminiProfile({ workspace, userId, profileId });
      res.json({ success: true, assignments });
    } catch (error: any) {
      res.status(400).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  // Server-side Gemini generateContent compatibility endpoint.
  // Keep the API key server-side and reuse the configured profile registry.
  router.post('/api/gemini/generate', async (req, res) => {
    try {
      const { prompt, model = 'gemini-3.6-flash', contents, config, profileId } = req.body || {};
      const registry = getGeminiProfileRegistry();
      const profile = registry.get(profileId);
      const apiKey = profile?.apiKey || process.env.GEMINI_API_KEY || getRuntimeGeminiApiKey();
      if (!apiKey) return res.status(400).json({ error: 'Gemini API key is not configured on the server.' });

      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
      const response = await ai.models.generateContent({
        model,
        contents: contents || prompt || 'Hello',
        ...(config ? { config } : {}),
      });
      return res.json({ text: response.text, response });
    } catch (error: any) {
      return res.status(500).json({ error: `Gemini generation failed: ${sanitizeError(error?.message || String(error))}` });
    }
  });

  // API Route to validate Gemini Configuration and Profile Functionality
  router.get('/api/gemini/validate', async (req, res) => {
    try {
      const registry = getGeminiProfileRegistry();
      const requestedProfileId = typeof req.query.profileId === 'string' ? req.query.profileId : undefined;
      const profile = registry.get(requestedProfileId);
      const apiKey = profile?.apiKey;

      if (!apiKey) {
        return res.json({
          configured: false,
          error: requestedProfileId
            ? `Gemini profile "${sanitizeError(requestedProfileId)}" is not configured or enabled.`
            : 'No Gemini account profile is configured on the server.'
        });
      }

      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      let response;
      let usedModel = "gemini-3.6-flash";
      let lastError: unknown;
      for (const candidate of [
        "gemini-3.6-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash",
      ]) {
        try {
          usedModel = candidate;
          response = await ai.models.generateContent({
            model: candidate,
            contents: "Respond with exactly the word SUCCESS",
          });
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!response) throw lastError || new Error('Gemini validation failed for all supported models.');

      const text = response.text?.trim() || '';
      if (text.toUpperCase().includes('SUCCESS')) {
        return res.json({
          configured: true,
          message: `Gemini API is configured correctly and functioning! Validated via ${usedModel}.`,
          model: usedModel,
          profileId: profile?.id
        });
      } else {
        return res.json({
          configured: true,
          message: `Gemini API responded, but with unexpected content: "${sanitizeError(text)}".`,
          model: usedModel,
          profileId: profile?.id
        });
      }
    } catch (error: any) {
      return res.json({
        configured: false,
        error: `Gemini API validation failed: ${sanitizeError(error?.message || String(error))}`
      });
    }
  });

  // Backward-compatible route name; response semantics are isolated profiles.
  router.get('/api/gemini/pool-status', async (req, res) => {
    try {
      const registry = getGeminiProfileRegistry();
      const configuredProfiles = registry.list();
      const targets = getSavedGeminiModelTargets();

      if (configuredProfiles.length === 0) {
        return res.json({
          configured: false,
          profiles: [],
          keys: [],
          modelTargets: targets,
          message: 'No Gemini account profiles configured',
        });
      }

      const healthStatuses = await Promise.all(
        configuredProfiles.map((profile, index) => checkApiKeyHealth('gemini', index, profile.apiKey))
      );
      const profiles = registry.summaries().map((profile, index) => {
        const scheduler = geminiProfileScheduler.getStatus(profile.id)[0];
        return {
          ...profile,
          index,
          name: profile.label,
          keyPreview: profile.keySuffix ? `...${profile.keySuffix}` : '',
          ...healthStatuses[index],
          status: scheduler.status,
          cooldownUntil: scheduler.cooldownUntil,
          usageCount: scheduler.requestCount,
          errorCount: scheduler.errorCount,
          lastUsed: scheduler.lastUsedAt || null,
          assignedTargets: targets.filter((target) => target.profileId === profile.id).map((target) => target.id),
        };
      });

      return res.json({
        configured: true,
        profiles,
        keys: profiles,
        modelTargets: targets,
        profileCount: profiles.length,
        keyCount: profiles.length,
        message: `${profiles.length} isolated Gemini account profile(s) configured`,
      });
    } catch (error: any) {
      res.status(500).json({ 
        error: sanitizeError(error?.message || String(error))
      });
    }
  });

  router.get('/api/gemini/model-targets', async (_req, res) => {
    try {
      const targets = getSavedGeminiModelTargets();
      const profiles = getGeminiProfileRegistry().summaries();
      res.json({
        targets: targets.map((target) => ({
          ...target,
          capabilities: getModelCapabilityProfile(target.modelId),
          value: getGeminiTargetModelValue(target.id),
        })),
        profiles,
        keys: getGeminiApiKeySummaries(),
        models: getGeminiFreeChatModelIds(),
      });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.put('/api/gemini/model-targets', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Provider settings changes require same-origin access or an authorized server token.' });
    }
    try {
      const targets = saveGeminiModelTargets(req.body?.targets);
      res.json({
        success: true,
        targets: targets.map((target) => ({
          ...target,
          capabilities: getModelCapabilityProfile(target.modelId),
          value: getGeminiTargetModelValue(target.id),
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.post('/api/gemini/model-targets/:id/test', async (req, res) => {
    let testedTarget: { id: string; title: string; modelId: string; apiKeyIndex: number } | undefined;
    try {
      const target = getSavedGeminiModelTargets().find((item) => item.id === req.params.id);

      if (!target) {
        return res.status(404).json({
          configured: false,
          error: `Gemini model target "${sanitizeError(req.params.id)}" was not found.`,
        });
      }
      testedTarget = target;

      const provider = providerForTest('gemini', new GeminiLLMProvider());
      const response = await provider.createChatCompletion(
        [{ role: 'user', content: 'Reply with exactly: GEMINI_TARGET_OK' }],
        getGeminiTargetModelValue(target.id),
        // Current thinking models may spend a small output budget internally
        // before producing visible validation text.
        { temperature: 0, maxTokens: 1024, geminiProfileId: target.profileId }
      );

      return res.json({
        configured: true,
        targetId: target.id,
        title: target.title,
        modelId: target.modelId,
        message: response.toUpperCase().includes('GEMINI_TARGET_OK')
          ? 'Target responded successfully.'
          : 'Target responded, but not with the expected validation text.',
        responsePreview: sanitizeError(response).slice(0, 180),
      });
    } catch (error: any) {
      res.status(500).json({
        configured: false,
        error: testedTarget
          ? `Gemini target "${sanitizeError(testedTarget.title)}" (model ${sanitizeError(testedTarget.modelId)}) failed: ${sanitizeError(error?.message || String(error))}`
          : `Gemini target "${sanitizeError(req.params.id)}" test failed: ${sanitizeError(error?.message || String(error))}`,
      });
    }
  });

  router.get('/api/nvidia/pool-status', async (_req, res) => {
    try {
      const keys = getNvidiaApiKeySummaries();
      const runtimeKeys = parseNvidiaRuntimeKeys();
      const targets = getSavedNvidiaModelTargets();
      const healthStatuses = await Promise.all(
        runtimeKeys.map((apiKey, index) => checkApiKeyHealth('nvidia', index, apiKey))
      );

      return res.json({
        configured: keys.length > 0,
        keys: keys.map((key) => ({
          ...key,
          ...healthStatuses[key.index],
          usageCount: 0,
          errorCount: 0,
          lastUsed: null,
          assignedTargets: targets.filter((target) => target.apiKeyIndex === key.index).map((target) => target.id),
        })),
        keyCount: keys.length,
        modelTargets: targets,
        message: keys.length > 0
          ? `${keys.length} NVIDIA API key(s) configured`
          : 'No NVIDIA API keys configured',
      });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.get('/api/nvidia/model-targets', async (_req, res) => {
    try {
      const targets = getSavedNvidiaModelTargets();
      res.json({
        targets: targets.map((target) => ({
          ...target,
          capabilities: getModelCapabilityProfile(target.modelId),
          value: getNvidiaTargetModelValue(target.id),
        })),
        keys: getNvidiaApiKeySummaries(),
      });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.put('/api/nvidia/model-targets', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Provider settings changes require same-origin access or an authorized server token.' });
    }
    try {
      const targets = saveNvidiaModelTargets(req.body?.targets);
      res.json({
        success: true,
        targets: targets.map((target) => ({
          ...target,
          capabilities: getModelCapabilityProfile(target.modelId),
          value: getNvidiaTargetModelValue(target.id),
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.post('/api/nvidia/model-targets/:id/test', async (req, res) => {
    let testedTarget: { id: string; title: string; modelId: string; apiKeyIndex: number } | undefined;
    try {
      const target = getSavedNvidiaModelTargets().find((item) => item.id === req.params.id);

      if (!target) {
        return res.status(404).json({
          configured: false,
          error: `NVIDIA model target "${sanitizeError(req.params.id)}" was not found.`,
        });
      }
      testedTarget = target;

      const provider = providerForTest('nvidia', new NvidiaLLMProvider());
      const recommended = getNvidiaModelMetadata(target.modelId)?.defaultParams;
      const response = await provider.createChatCompletion(
        [{ role: 'user', content: 'Reply with exactly: NVIDIA_TARGET_OK' }],
        getNvidiaTargetModelValue(target.id),
         {
           temperature: recommended?.temperature ?? target.temperature,
           topP: recommended?.topP ?? target.topP,
           maxTokens: 24,
           timeoutMs: 45_000,
         }
      );

      recordProviderSuccess('nvidia', target.modelId, Date.now(), target.apiKeyIndex);

      return res.json({
        configured: true,
        targetId: target.id,
        title: target.title,
        modelId: target.modelId,
        message: response.toUpperCase().includes('NVIDIA_TARGET_OK')
          ? 'Target responded successfully.'
          : 'Target responded, but not with the expected validation text.',
        responsePreview: sanitizeError(response).slice(0, 180),
      });
    } catch (error: any) {
      if (testedTarget) {
        recordProviderFailure('nvidia', testedTarget.modelId, error?.message || String(error), Date.now(), testedTarget.apiKeyIndex);
      }
      res.status(500).json({
        configured: false,
        error: testedTarget
          ? `NVIDIA target "${sanitizeError(testedTarget.title)}" (model ${sanitizeError(testedTarget.modelId)}, API key ${testedTarget.apiKeyIndex + 1}) failed: ${sanitizeError(error?.message || String(error))}`
          : `NVIDIA target "${sanitizeError(req.params.id)}" test failed: ${sanitizeError(error?.message || String(error))}`,
      });
    }
  });

  router.get('/api/local-ai/endpoints', (_req, res) => {
    const endpoints = getLocalAIEndpoints();
    return res.json({
      configured: endpoints.some((endpoint) => endpoint.enabled && Boolean(endpoint.modelId)),
      endpoints,
      targets: getLocalAIModelTargets(),
    });
  });

  router.put('/api/local-ai/endpoints', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Local AI settings changes require a same-origin request or provider settings token.' });
    }
    try {
      const endpoints = saveLocalAIEndpoints(req.body?.endpoints);
      resetDIContainer();
      return res.json({ success: true, endpoints, targets: getLocalAIModelTargets() });
    } catch (error: any) {
      return res.status(400).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.get('/api/local-ai/model-targets', (_req, res) => {
    return res.json({ configured: getLocalAIModelTargets().length > 0, targets: getLocalAIModelTargets() });
  });

  router.post('/api/local-ai/test', async (req, res) => {
    try {
      const endpoint = normalizeLocalAIEndpoints([req.body?.endpoint], {
        strict: true,
        requireModel: false,
      })[0];
      if (!endpoint) return res.status(400).json({ error: 'Local AI endpoint is required.' });

      let discovery: LocalAIDiscovery = { models: [], contextWindowByModel: {} };
      let discoveryError: string | undefined;
      try {
        discovery = await discoverLocalAIModels(endpoint.baseUrl);
      } catch (error: any) {
        discoveryError = sanitizeError(error?.message || String(error));
      }
      const models = discovery.models;
      const modelSelection = resolveDiscoveredModel(endpoint.modelId, models, 'Local AI');
      const model = modelSelection.model;
      if (!model) {
        return res.status(502).json({
          configured: false,
          endpoint: endpoint.baseUrl,
          models,
          ...(discovery.runtimeContextWindow ? { runtimeContextWindow: discovery.runtimeContextWindow } : {}),
          error: discoveryError
            ? `No model ID was supplied and model discovery failed: ${discoveryError}`
            : 'The local endpoint returned no models. Enter a model ID manually.',
        });
      }

      const provider = providerForTest('local-ai', new LocalModelLLMProvider(endpoint.baseUrl, model, true));
      const response = await provider.createChatCompletion(
        [{ role: 'user', content: 'Reply with exactly: LOCAL_ROUTE_OK' }],
        `local:${model}`,
        // Endpoint discovery is a health probe, not a harness reasoning turn.
        // Keep it short so testing a single-slot llama.cpp server cannot spend
        // the whole probe deadline in private model thinking.
        { temperature: 0, maxTokens: 64, timeoutMs: 20_000, requestKind: 'api_pool.test', disableLocalThinking: true },
      );
      recordProviderSuccess('local', model);
      const runtimeContextWindow = discovery.contextWindowByModel[model] || discovery.runtimeContextWindow;
      const recommendedInputTokenLimit = runtimeContextWindow
        ? Math.max(512, Math.floor(runtimeContextWindow * 0.75))
        : undefined;
      const contextWarning = runtimeContextWindow && endpoint.contextWindow && endpoint.contextWindow !== runtimeContextWindow
        ? `Configured context ${endpoint.contextWindow.toLocaleString()} differs from the live server context ${runtimeContextWindow.toLocaleString()}; the live value should be used.`
        : undefined;
      return res.json({
        configured: true,
        isHealthy: true,
        endpoint: endpoint.baseUrl,
        model,
        models,
        ...(runtimeContextWindow ? { runtimeContextWindow } : {}),
        ...(recommendedInputTokenLimit ? { recommendedInputTokenLimit } : {}),
        ...(discovery.supportsTools !== undefined ? { supportsTools: discovery.supportsTools } : {}),
        ...(discovery.totalSlots !== undefined ? { totalSlots: discovery.totalSlots } : {}),
        message: /LOCAL_ROUTE_OK/i.test(response)
          ? 'Local AI route responded successfully.'
          : 'Local AI route responded with usable text.',
        ...((discoveryError || modelSelection.warning || contextWarning)
          ? { discoveryWarning: [discoveryError, modelSelection.warning, contextWarning].filter(Boolean).join(' ') }
          : {}),
        responsePreview: sanitizeError(response).slice(0, 180),
      });
    } catch (error: any) {
      const model = typeof req.body?.endpoint?.modelId === 'string' ? req.body.endpoint.modelId : 'unknown';
      recordProviderFailure('local', model, error);
      return res.status(502).json({
        configured: false,
        model,
        error: `Local AI route failed: ${sanitizeError(error?.message || String(error))}`,
      });
    }
  });

  router.get('/api/colab/endpoints', (_req, res) => {
    const endpoints = getColabEndpoints();
    return res.json({
      configured: endpoints.some((endpoint) => endpoint.enabled && Boolean(endpoint.modelId)),
      endpoints,
      targets: getColabModelTargets(),
    });
  });

  router.put('/api/colab/endpoints', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Colab model settings changes require a same-origin request or provider settings token.' });
    }
    try {
      const endpoints = saveColabEndpoints(req.body?.endpoints);
      resetDIContainer();
      return res.json({ success: true, endpoints, targets: getColabModelTargets() });
    } catch (error: any) {
      return res.status(400).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.get('/api/colab/model-targets', (_req, res) => {
    return res.json({ configured: getColabModelTargets().length > 0, targets: getColabModelTargets() });
  });

  router.post('/api/colab/test', async (req, res) => {
    try {
      const endpoint = normalizeColabEndpoints([req.body?.endpoint], {
        strict: true,
        requireModel: false,
      })[0];
      if (!endpoint) return res.status(400).json({ error: 'Colab model endpoint is required.' });

      let discovery: LocalAIDiscovery = { models: [], contextWindowByModel: {} };
      let discoveryError: string | undefined;
      try {
        discovery = await discoverLocalAIModels(endpoint.baseUrl);
      } catch (error: any) {
        discoveryError = sanitizeError(error?.message || String(error));
      }
      const models = discovery.models;
      const modelSelection = resolveDiscoveredModel(endpoint.modelId, models, 'Colab');
      const model = modelSelection.model;
      if (!model) {
        return res.status(502).json({
          configured: false,
          endpoint: endpoint.baseUrl,
          models,
          ...(discovery.runtimeContextWindow ? { runtimeContextWindow: discovery.runtimeContextWindow } : {}),
          error: discoveryError
            ? `No model ID was supplied and model discovery failed: ${discoveryError}`
            : 'The Colab endpoint returned no models. Enter a model ID manually.',
        });
      }

      const provider = providerForTest('colab', new ColabModelLLMProvider(endpoint.baseUrl, model, true));
      const response = await provider.createChatCompletion(
        [{ role: 'user', content: 'Reply with exactly: COLAB_ROUTE_OK' }],
        `local:${model}`,
        { temperature: 0, maxTokens: 64, timeoutMs: 20_000, requestKind: 'api_pool.test', disableLocalThinking: true },
      );
      recordProviderSuccess('colab', model);
      const runtimeContextWindow = discovery.contextWindowByModel[model] || discovery.runtimeContextWindow;
      const recommendedInputTokenLimit = runtimeContextWindow
        ? Math.max(512, Math.floor(runtimeContextWindow * 0.75))
        : undefined;
      const contextWarning = runtimeContextWindow && endpoint.contextWindow && endpoint.contextWindow !== runtimeContextWindow
        ? `Configured context ${endpoint.contextWindow.toLocaleString()} differs from the live server context ${runtimeContextWindow.toLocaleString()}; the live value should be used.`
        : undefined;
      return res.json({
        configured: true,
        isHealthy: true,
        endpoint: endpoint.baseUrl,
        model,
        models,
        ...(runtimeContextWindow ? { runtimeContextWindow } : {}),
        ...(recommendedInputTokenLimit ? { recommendedInputTokenLimit } : {}),
        ...(discovery.supportsTools !== undefined ? { supportsTools: discovery.supportsTools } : {}),
        ...(discovery.totalSlots !== undefined ? { totalSlots: discovery.totalSlots } : {}),
        message: /COLAB_ROUTE_OK/i.test(response)
          ? 'Colab model route responded successfully.'
          : 'Colab model route responded with usable text.',
        ...((discoveryError || modelSelection.warning || contextWarning)
          ? { discoveryWarning: [discoveryError, modelSelection.warning, contextWarning].filter(Boolean).join(' ') }
          : {}),
        responsePreview: sanitizeError(response).slice(0, 180),
      });
    } catch (error: any) {
      const model = typeof req.body?.endpoint?.modelId === 'string' ? req.body.endpoint.modelId : 'unknown';
      recordProviderFailure('colab', model, error);
      return res.status(502).json({
        configured: false,
        model,
        error: `Colab model route failed: ${sanitizeError(error?.message || String(error))}`,
      });
    }
  });

  // OpenRouter is one credential with a dynamically routable model catalog,
  // rather than a per-key provider pool. Keep it in the same API Pool surface
  // and test its configured route with a real completion. pool-status is
  // canonical; status remains an alias for existing clients.
  router.get(['/api/openrouter/pool-status', '/api/openrouter/status'], async (req, res) => {
    if (req.path === '/api/openrouter/status') {
      res.setHeader('Link', '</api/openrouter/pool-status>; rel="canonical"');
    }
    const apiKey = getConfiguredOpenRouterApiKey();
    const model = getConfiguredOpenRouterModel();
    const configurationWarning = getLegacyOpenRouterConfigurationWarning();
    if (!apiKey) {
      return res.json({
        configured: false,
        isHealthy: false,
        model,
        accountScope: 'single-account',
        credentialPolicy: 'single-key',
        ...(configurationWarning ? { configurationWarning } : {}),
        message: 'No OPENROUTER_API_KEY configured.',
      });
    }

    try {
      // The OpenRouter base URL already ends in /api/v1. The current-key
      // endpoint is /key; /auth/key is not the API key status endpoint.
      const response = await fetch(`${getRuntimeOpenRouterBaseUrl().replace(/\/+$/, '')}/key`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.status(502).json({
          configured: true,
          isHealthy: false,
          model,
          accountScope: 'single-account',
          credentialPolicy: 'single-key',
          ...(configurationWarning ? { configurationWarning } : {}),
          message: `OpenRouter credential check returned HTTP ${response.status}.`,
        });
      }

      const account = parseOpenRouterAccountStatus(data);
      return res.json({
        configured: true,
        isHealthy: true,
        model,
        accountScope: 'single-account',
        credentialPolicy: 'single-key',
        ...account,
        ...(configurationWarning ? { configurationWarning } : {}),
        message: 'Credential accepted. Use Test Route to verify a live completion.',
      });
    } catch (error: any) {
      return res.status(502).json({
        configured: true,
        isHealthy: false,
        model,
        accountScope: 'single-account',
        credentialPolicy: 'single-key',
        ...(configurationWarning ? { configurationWarning } : {}),
        message: sanitizeError(error?.message || 'OpenRouter credential check failed.'),
      });
    }
  });

  router.get('/api/openrouter/settings', async (_req, res) => {
    const targets = getSavedOpenRouterModelTargets();
    return res.json({
      ...getOpenRouterPublicAccountSettings(),
      model: getConfiguredOpenRouterModel(),
      structuredModel: getConfiguredOpenRouterStructuredModel(),
      targets: targets.map((target) => ({
        ...target,
        value: getOpenRouterTargetModelValue(target.modelId),
      })),
    });
  });

  router.put('/api/openrouter/settings', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Provider settings changes require same-origin access or an authorized server token.' });
    }
    return res.status(400).json({
      error: 'OpenRouter API keys are environment-only. Set OPENROUTER_API_KEY in .env and restart the server.',
    });
  });

  router.get('/api/openrouter/models', async (_req, res) => {
    const apiKey = getConfiguredOpenRouterApiKey();
    try {
      const response = await fetch(getRuntimeOpenRouterBaseUrl().replace(/\/+$/, '') + '/models', {
        headers: {
          Accept: 'application/json',
          ...(apiKey ? { Authorization: 'Bearer ' + apiKey } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.status(502).json({
          configured: Boolean(apiKey),
          models: [],
          error: data?.error?.message || 'OpenRouter model catalog returned HTTP ' + response.status + '.',
        });
      }
      const positiveInteger = (value: unknown, maximum: number): number | undefined => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
        return Math.min(maximum, Math.floor(parsed));
      };
      const models = Array.isArray(data?.data)
        ? data.data
          .filter((entry: any) => typeof entry?.id === 'string' && entry.id.trim())
          .map((entry: any) => {
            const contextLength = positiveInteger(entry.top_provider?.context_length, 10_000_000)
              || positiveInteger(entry.context_length, 10_000_000);
            const maxCompletionTokens = positiveInteger(entry.top_provider?.max_completion_tokens, 1_048_576)
              || positiveInteger(entry.max_completion_tokens, 1_048_576);
            const inputModalities = Array.isArray(entry.architecture?.input_modalities)
              ? entry.architecture.input_modalities.filter((value: unknown): value is string => typeof value === 'string')
              : [];
            const outputModalities = Array.isArray(entry.architecture?.output_modalities)
              ? entry.architecture.output_modalities.filter((value: unknown): value is string => typeof value === 'string')
              : [];
            const supportsVision = inputModalities.includes('image') || inputModalities.includes('video');
            return {
              id: entry.id.trim(),
              name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : entry.id.trim(),
              ...(contextLength ? { contextLength } : {}),
              ...(maxCompletionTokens ? { maxCompletionTokens } : {}),
              isFree: String(entry.pricing?.prompt ?? '') === '0' && String(entry.pricing?.completion ?? '') === '0',
              supportsTools: Array.isArray(entry.supported_parameters) && entry.supported_parameters.includes('tools'),
              supportsMaxTokens: Array.isArray(entry.supported_parameters) && entry.supported_parameters.includes('max_tokens'),
              ...(inputModalities.length > 0 ? { inputModalities } : {}),
              ...(outputModalities.length > 0 ? { outputModalities } : {}),
              supportsVision,
            };
          })
          .slice(0, 1_000)
        : [];
      syncOpenRouterModelTargetMetadata(models.map((model: any) => ({
        modelId: model.id,
        maxTokens: model.maxCompletionTokens,
        contextLength: model.contextLength,
        supportsTools: model.supportsTools,
        supportsVision: model.supportsVision,
        inputModalities: model.inputModalities,
        outputModalities: model.outputModalities,
      })));
      return res.json({ configured: Boolean(apiKey), models });
    } catch (error: any) {
      return res.status(502).json({
        configured: Boolean(apiKey),
        models: [],
        error: sanitizeError(error?.message || 'OpenRouter model discovery failed.'),
      });
    }
  });

  router.get('/api/openrouter/model-targets', async (_req, res) => {
    const targets = getSavedOpenRouterModelTargets();
    return res.json({
      configured: Boolean(getConfiguredOpenRouterApiKey()),
      model: getConfiguredOpenRouterModel(),
      structuredModel: getConfiguredOpenRouterStructuredModel(),
      targets: targets.map((target) => ({
        ...target,
        capabilities: getProviderModelCapabilityProfile(target.modelId, 'openrouter', {
          ...(target.contextLength ? { contextWindow: target.contextLength } : {}),
          ...(target.maxTokens ? { maxOutputTokens: target.maxTokens, defaultParams: { maxTokens: target.maxTokens } } : {}),
          ...(target.inputModalities ? { inputModalities: target.inputModalities } : {}),
          ...(target.outputModalities ? { outputModalities: target.outputModalities } : {}),
          capabilities: {
            ...getProviderModelCapabilityProfile(target.modelId, 'openrouter').capabilities,
            ...(target.supportsTools === undefined ? {} : {
              toolCalling: target.supportsTools ? 'yes' as const : 'no' as const,
              structuredOutput: target.supportsTools ? 'yes' as const : 'no' as const,
            }),
            ...(target.supportsVision === undefined ? {} : {
              vision: target.supportsVision ? 'yes' as const : 'no' as const,
            }),
          },
          source: target.maxTokens || target.contextLength ? 'provider-catalog' : 'configured-route',
        }),
        value: getOpenRouterTargetModelValue(target.modelId),
      })),
    });
  });

  router.put('/api/openrouter/model-target', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'OpenRouter model changes require same-origin access or an authorized server token.' });
    }
    try {
      const targets = addOpenRouterModelTarget(req.body?.modelId, req.body?.title, true, {
        maxTokens: req.body?.maxTokens,
        contextLength: req.body?.contextLength,
        supportsTools: req.body?.supportsTools,
        supportsVision: req.body?.supportsVision,
        inputModalities: req.body?.inputModalities,
        outputModalities: req.body?.outputModalities,
      });
      return res.json({
        success: true,
        model: getConfiguredOpenRouterModel(),
        targets: targets.map((target) => ({ ...target, value: getOpenRouterTargetModelValue(target.modelId) })),
      });
    } catch (error: any) {
      return res.status(400).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.put('/api/openrouter/model-targets', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'OpenRouter model changes require same-origin access or an authorized server token.' });
    }
    try {
      const normalizedTargets = normalizeOpenRouterModelTargets(req.body?.targets);
      if (normalizedTargets.length === 0) throw new Error('At least one OpenRouter model is required.');
      const requestedStructuredModel = typeof req.body?.structuredModel === 'string'
        ? req.body.structuredModel.trim()
        : getConfiguredOpenRouterStructuredModel();
      if (requestedStructuredModel) {
        if (!normalizedTargets.some((target) => target.modelId.toLowerCase() === requestedStructuredModel.toLowerCase())) {
          throw new Error('The structured fallback model must be one of the saved OpenRouter models.');
        }
      }
      const targets = saveOpenRouterModelTargets(normalizedTargets);
      if (requestedStructuredModel) saveConfiguredOpenRouterStructuredModel(requestedStructuredModel);
      return res.json({
        success: true,
        model: getConfiguredOpenRouterModel(),
        structuredModel: getConfiguredOpenRouterStructuredModel(),
        targets: targets.map((target) => ({ ...target, value: getOpenRouterTargetModelValue(target.modelId) })),
      });
    } catch (error: any) {
      return res.status(400).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.post('/api/openrouter/model-targets', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'OpenRouter model changes require same-origin access or an authorized server token.' });
    }
    try {
      const targets = addOpenRouterModelTarget(req.body?.modelId, req.body?.title, req.body?.makeDefault === true, {
        maxTokens: req.body?.maxTokens,
        contextLength: req.body?.contextLength,
        supportsTools: req.body?.supportsTools,
        supportsVision: req.body?.supportsVision,
        inputModalities: req.body?.inputModalities,
        outputModalities: req.body?.outputModalities,
      });
      return res.json({
        success: true,
        model: getConfiguredOpenRouterModel(),
        targets: targets.map((target) => ({ ...target, value: getOpenRouterTargetModelValue(target.modelId) })),
      });
    } catch (error: any) {
      return res.status(400).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.delete('/api/openrouter/model-targets/:id', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'OpenRouter model changes require same-origin access or an authorized server token.' });
    }
    try {
      const targets = removeOpenRouterModelTarget(req.params.id);
      return res.json({
        success: true,
        model: getConfiguredOpenRouterModel(),
        targets: targets.map((target) => ({ ...target, value: getOpenRouterTargetModelValue(target.modelId) })),
      });
    } catch (error: any) {
      return res.status(400).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.post('/api/openrouter/model-targets/:id/test', async (req, res) => {
    const target = getSavedOpenRouterModelTargets().find((item) => item.id === req.params.id);
    if (!target) {
      return res.status(404).json({ configured: false, error: 'OpenRouter model target was not found.' });
    }
    try {
      const provider = providerForTest('openrouter-target', new OpenRouterLLMProvider());
      const response = await provider.createChatCompletion(
        [{ role: 'user', content: 'Reply with exactly: OPENROUTER_TARGET_OK' }],
        target.modelId,
        { temperature: 0, maxTokens: 128, timeoutMs: 45_000, requestKind: 'step.plan_action' },
      );
      recordProviderSuccess('openrouter', target.modelId);
      return res.json({
        configured: true,
        model: target.modelId,
        message: response.toUpperCase().includes('OPENROUTER_TARGET_OK')
          ? 'OpenRouter model target responded successfully.'
          : 'OpenRouter model target responded with usable text.',
        responsePreview: sanitizeError(response).slice(0, 180),
      });
    } catch (error: any) {
      recordProviderFailure('openrouter', target.modelId, error);
      return res.status(502).json({
        configured: Boolean(getConfiguredOpenRouterApiKey()),
        model: target.modelId,
        error: sanitizeError(error?.message || String(error)),
      });
    }
  });

  router.post('/api/openrouter/test', async (_req, res) => {
    const model = getConfiguredOpenRouterModel();
    let testedModel = model;
    try {
      testedModel = resolveOpenRouterRequestModel(model, 'step.plan_action');
      const provider = providerForTest('openrouter', new OpenRouterLLMProvider());
      const response = await provider.createChatCompletion(
        [{ role: 'user', content: 'Reply with exactly: OPENROUTER_ROUTE_OK' }],
        testedModel,
        { temperature: 0, maxTokens: 128, timeoutMs: 45_000, requestKind: 'step.plan_action' },
      );
      recordProviderSuccess('openrouter', testedModel);
      return res.json({
        configured: true,
        model,
        testedModel,
        message: response.toUpperCase().includes('OPENROUTER_ROUTE_OK')
          ? 'Configured OpenRouter route responded successfully.'
          : 'Configured OpenRouter route responded, but not with the expected validation text.',
        responsePreview: sanitizeError(response).slice(0, 180),
      });
    } catch (error: any) {
      recordProviderFailure('openrouter', testedModel, error);
      return res.status(502).json({
        configured: Boolean(getConfiguredOpenRouterApiKey()),
        model: getConfiguredOpenRouterModel(),
        error: sanitizeError(error?.message || String(error)),
      });
    }
  });

  router.get('/api/groq/status', async (_req, res) => {
    const config = loadGroqRuntimeConfigSafe();
    const provider = new GroqLLMProvider();
    const health = provider.getHealth();
    const queue = provider.getQueueStatus();
    const configurationWarning = getLegacyGroqConfigurationWarning();
    return res.json({
      configured: health.credentialState === 'configured' && Boolean(config.defaultModel),
      isHealthy: health.state === 'available',
      credentialState: health.credentialState,
      health,
      queue,
      usage: readGroqAggregateUsage(),
      settings: getGroqPublicSettings(),
      model: config.defaultModel,
      roles: {
        fast: config.fastModel, classifier: config.classifierModel, summarizer: config.summarizerModel,
        planner: config.plannerModel, coder: config.coderModel, reviewer: config.reviewerModel, repair: config.repairModel,
      },
      capabilities: config.capabilities,
      baseUrl: config.baseUrl,
      configurationWarning,
      message: configurationWarning || health.message,
    });
  });

  router.get('/api/groq/settings', async (_req, res) => {
    const config = loadGroqRuntimeConfigSafe();
    return res.json({
      ...getGroqPublicSettings(),
      baseUrl: config.baseUrl,
      credentialState: config.apiKey ? 'configured' : 'not_configured',
      configurationError: config.configurationError,
    });
  });

  router.put('/api/groq/settings', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Provider settings changes require same-origin access or an authorized server token.' });
    }
    try {
      const settings = saveGroqSettings(req.body);
      await resetGroqScheduler();
      return res.json({ success: true, settings });
    } catch (error: any) {
      return res.status(400).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.post('/api/groq/health', async (_req, res) => {
    const health = await new GroqLLMProvider().healthCheck();
    return res.status(health.state === 'available' ? 200 : 502).json({ health });
  });

  router.get('/api/groq/model-targets', async (_req, res) => {
    const config = loadGroqRuntimeConfigSafe();
    const modelId = config.defaultModel;
    return res.json({
      configured: Boolean(config.enabled && config.apiKey && modelId),
      targets: getGroqModelTargets(Boolean(config.enabled && config.apiKey), modelId),
    });
  });

  router.put('/api/groq/model-target', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Provider settings changes require same-origin access or an authorized server token.' });
    }
    try {
      const settings = saveConfiguredProviderModel('groq', req.body?.modelId);
      saveGroqSettings({ defaultModel: settings.groqModel });
      await resetGroqScheduler();
      return res.json({ success: true, model: settings.groqModel });
    } catch (error: any) {
      return res.status(400).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.post('/api/groq/test', async (_req, res) => {
    const config = loadGroqRuntimeConfigSafe();
    const model = config.defaultModel;
    if (!config.enabled || !config.apiKey || !model) {
      return res.status(400).json({
        configured: false,
        model,
        error: config.configurationError || 'Enable Groq and configure GROQ_API_KEY plus a default model.',
      });
    }
    const provider = providerForTest('groq', new GroqLLMProvider());
    try {
      const response = await provider.createChatCompletion(
        [{ role: 'user', content: 'Reply with exactly: GROQ_ROUTE_OK' }],
        model,
        { temperature: 0, maxTokens: 32, timeoutMs: 20_000 },
      );
      recordProviderSuccess('groq', model);
      return res.json({
        configured: true,
        isHealthy: true,
        model,
        expectedResponse: response.toUpperCase().includes('GROQ_ROUTE_OK'),
        responsePreview: sanitizeError(response).slice(0, 180),
        message: 'The configured Groq route responded successfully.',
      });
    } catch (error: any) {
      recordProviderFailure('groq', model, error);
      return res.status(502).json({
        configured: true,
        isHealthy: false,
        model,
        error: sanitizeError(error?.message || String(error)),
      });
    }
  });

  router.get('/api/cerebras/status', async (_req, res) => {
    const apiKey = getRuntimeCerebrasApiKey();
    const model = getRuntimeCerebrasModel();
    return res.json({
      configured: Boolean(apiKey),
      isHealthy: undefined,
      model,
      baseUrl: getRuntimeCerebrasBaseUrl(),
      message: apiKey
        ? 'Cerebras is configured. Use Test Route to verify the direct endpoint.'
        : 'No CEREBRAS_API_KEY configured.',
    });
  });

  router.post('/api/cerebras/test', async (_req, res) => {
    const apiKey = getRuntimeCerebrasApiKey();
    const model = getRuntimeCerebrasModel();
    if (!apiKey) {
      return res.status(400).json({
        configured: false,
        model,
        error: 'Configure CEREBRAS_API_KEY and restart the server before testing Cerebras.',
      });
    }
    const provider = providerForTest('cerebras', new CerebrasLLMProvider());
    try {
      const response = await provider.createChatCompletion(
        [{ role: 'user', content: 'Reply with exactly: CEREBRAS_ROUTE_OK' }],
        `cerebras:${model}`,
        { temperature: 0, maxTokens: 32, timeoutMs: 20_000, pinModel: true },
      );
      recordProviderSuccess('cerebras', model);
      return res.json({
        configured: true,
        isHealthy: true,
        model,
        expectedResponse: response.toUpperCase().includes('CEREBRAS_ROUTE_OK'),
        responsePreview: sanitizeError(response).slice(0, 180),
        message: 'The direct Cerebras route responded successfully.',
      });
    } catch (error: any) {
      recordProviderFailure('cerebras', model, error);
      return res.status(502).json({
        configured: true,
        isHealthy: false,
        model,
        error: sanitizeError(error?.message || String(error)),
      });
    }
  });

  router.get('/api/sambanova/status', async (_req, res) => {
    const apiKey = getRuntimeSambaNovaApiKey();
    const model = getConfiguredSambaNovaModel();
    return res.json({
      configured: Boolean(apiKey),
      isHealthy: undefined,
      model,
      models: SAMBANOVA_MODEL_CATALOG.map((entry) => entry.id),
      baseUrl: getRuntimeSambaNovaBaseUrl(),
      plan: {
        free: { creditsUsd: 5, creditCardRequired: false, expiresInDays: 30 },
        developer: { billing: 'pay-as-you-go', rateLimits: 'standard' },
      },
      message: apiKey
        ? 'SambaNova is configured. Use Test Route to verify the direct endpoint.'
        : 'No SAMBANOVA_API_KEY configured.',
    });
  });

  router.get('/api/sambanova/model-targets', async (_req, res) => {
    const configured = Boolean(getRuntimeSambaNovaApiKey());
    const modelId = getConfiguredSambaNovaModel();
    const catalog = [...SAMBANOVA_MODEL_CATALOG];
    if (modelId && !catalog.some((entry) => entry.id === modelId)) {
      catalog.unshift({ id: modelId, label: modelId, category: 'Configured' });
    }
    return res.json({
      configured,
      models: catalog.map((entry) => entry.id),
      targets: configured ? catalog.map((entry) => ({
        id: entry.id,
        title: `SambaNova ${entry.label}`,
        modelId: entry.id,
        apiKeyIndex: 0,
        value: `sambanova:${entry.id}`,
      })) : [],
    });
  });

  router.put('/api/sambanova/model-target', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Provider settings changes require same-origin access or an authorized server token.' });
    }
    try {
      const settings = saveConfiguredProviderModel('sambanova', req.body?.modelId);
      return res.json({ success: true, model: settings.sambanovaModel });
    } catch (error: any) {
      return res.status(400).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.post('/api/sambanova/test', async (_req, res) => {
    const apiKey = getRuntimeSambaNovaApiKey();
    const model = getConfiguredSambaNovaModel();
    if (!apiKey) {
      return res.status(400).json({
        configured: false,
        model,
        error: 'Configure SAMBANOVA_API_KEY and restart the server before testing SambaNova.',
      });
    }
    const provider = providerForTest('sambanova', new SambaNovaLLMProvider());
    try {
      const response = await provider.createChatCompletion(
        [{ role: 'user', content: 'Reply with exactly: SAMBANOVA_ROUTE_OK' }],
        `sambanova:${model}`,
        // gpt-oss-120b may spend part of a small completion budget on
        // reasoning before emitting visible content. Keep the probe compact,
        // but leave enough room for a usable response.
        { temperature: 0, maxTokens: 256, timeoutMs: 20_000, requestKind: 'api_pool.test', pinModel: true },
      );
      recordProviderSuccess('sambanova', model);
      return res.json({
        configured: true,
        isHealthy: true,
        model,
        expectedResponse: response.toUpperCase().includes('SAMBANOVA_ROUTE_OK'),
        responsePreview: sanitizeError(response).slice(0, 180),
        message: 'The direct SambaNova route responded successfully.',
      });
    } catch (error: any) {
      recordProviderFailure('sambanova', model, error);
      return res.status(502).json({
        configured: true,
        isHealthy: false,
        model,
        error: sanitizeError(error?.message || String(error)),
      });
    }
  });

  router.get('/api/kimi/pool-status', async (_req, res) => {
    const apiKey = getRuntimeKimiApiKey();
    const model = getConfiguredKimiModel();
    if (!apiKey) {
      return res.json({ configured: false, isHealthy: false, model, models: [], message: 'No KIMI_API_KEY configured.' });
    }
    try {
      const response = await fetch(`${getRuntimeKimiBaseUrl().replace(/\/+$/, '')}/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      });
      const data: any = await response.json().catch(() => ({}));
      const models = Array.isArray(data?.data)
        ? data.data.map((entry: any) => entry?.id).filter((id: unknown): id is string => typeof id === 'string')
        : [];
      if (!response.ok) {
        return res.status(502).json({
          configured: true,
          isHealthy: false,
          model,
          models,
          message: data?.error?.message || `Kimi credential check returned HTTP ${response.status}.`,
        });
      }
      return res.json({
        configured: true,
        isHealthy: true,
        model,
        models,
        message: `Credential accepted. ${models.length} model(s) available; use Test Route to verify account balance and completion access.`,
      });
    } catch (error: any) {
      return res.status(502).json({
        configured: true,
        isHealthy: false,
        model,
        models: [],
        message: sanitizeError(error?.message || 'Kimi credential check failed.'),
      });
    }
  });

  router.get('/api/kimi/model-targets', async (_req, res) => {
    const apiKey = getRuntimeKimiApiKey();
    let models = ['kimi-k2.6', 'kimi-k2.7-code'];
    if (apiKey) {
      try {
        const baseUrl = getRuntimeKimiBaseUrl().replace(/\/+$/, '');
        const liveModels = await getCachedProviderModelDiscovery('kimi', apiKey, baseUrl, async () => {
          const response = await fetch(`${baseUrl}/models`, {
            headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(8_000),
          });
          const data: any = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data?.error?.message || `Kimi model discovery returned HTTP ${response.status}.`);
          }
          return Array.isArray(data?.data)
            ? data.data.map((entry: any) => entry?.id)
                .filter((id: unknown): id is string => typeof id === 'string' && id.startsWith('kimi-'))
            : [];
        });
        if (liveModels.length > 0) models = liveModels;
      } catch {
        // Keep the last known account-supported defaults when discovery is temporarily unavailable.
      }
    }
    return res.json({
      targets: apiKey ? models.map((modelId) => ({
        id: modelId,
        title: modelId.replace(/^kimi-/i, 'Kimi ').replace(/-/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()),
        modelId,
        apiKeyIndex: 0,
        value: `kimi:${modelId}`,
      })) : [],
      models,
    });
  });

  router.put('/api/kimi/model-target', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Provider settings changes require same-origin access or an authorized server token.' });
    }
    try {
      const settings = saveConfiguredProviderModel('kimi', req.body?.modelId);
      return res.json({ success: true, model: settings.kimiModel });
    } catch (error: any) {
      return res.status(400).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.post('/api/kimi/test', async (_req, res) => {
    const model = getConfiguredKimiModel();
    try {
      const provider = providerForTest('kimi', new KimiLLMProvider());
      const response = await provider.createChatCompletion(
        [{ role: 'user', content: 'Reply with exactly: KIMI_ROUTE_OK' }],
        model,
        { temperature: 0, maxTokens: 64, timeoutMs: 20_000, requestKind: 'api_pool.test' },
      );
      recordProviderSuccess('kimi', model);
      return res.json({
        configured: true,
        model,
        message: response.toUpperCase().includes('KIMI_ROUTE_OK')
          ? 'Configured Kimi route responded successfully.'
          : 'Configured Kimi route responded, but not with the expected validation text.',
        responsePreview: sanitizeError(response).slice(0, 180),
      });
    } catch (error: any) {
      recordProviderFailure('kimi', model, error);
      return res.status(502).json({
        configured: Boolean(getRuntimeKimiApiKey()),
        model: getConfiguredKimiModel(),
        error: `Kimi API Pool route failed: ${sanitizeError(error?.message || String(error))}`,
      });
    }
  });

  const requestyFreeModelFallbacks = [
    'poolside/laguna-m.1',
    'poolside/laguna-xs.2',
    'nvidia/nemotron-3-super-120b-a12b',
    'nvidia/nemotron-3-ultra-550b-a55b',
    'nvidia/nemotron-3-nano-30b-a3b',
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
    'google/gemma-4-31b-it',
    'novita/tencent/hy3',
    'mistral/leanstral-1-5',
    'nvidia/nemotron-3.5-content-safety',
  ];

  const fetchRequestyFreeModels = async (
    apiKey = getRuntimeRequestyApiKey(),
    configuredBaseUrl = getRuntimeRequestyBaseUrl(),
  ): Promise<string[]> => {
    if (!apiKey) return [];
    const response = await fetch(`${configuredBaseUrl.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `Requesty model discovery returned HTTP ${response.status}.`);
    return Array.isArray(data?.data)
      ? data.data
          .filter((entry: any) => Number(entry?.input_price) === 0 && Number(entry?.output_price) === 0)
          .map((entry: any) => entry?.id)
          .filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];
  };

  router.get('/api/requesty/pool-status', async (_req, res) => {
    const configured = Boolean(getRuntimeRequestyApiKey());
    const model = getConfiguredRequestyModel();
    if (!configured) {
      return res.json({ configured: false, isHealthy: false, model, models: [], message: 'No REQUESTY_API_KEY configured.' });
    }
    try {
      const models = await fetchRequestyFreeModels();
      const routeStatus = getProviderRateLimitStatuses([{
        provider: 'requesty',
        model,
        tier: 'free',
      }]).find((route) => route.provider === 'requesty' && route.model === model);
      const routeAvailable = !routeStatus || routeStatus.status === 'available' || routeStatus.status === 'near_limit';
      return res.json({
        configured: true,
        isHealthy: routeAvailable,
        model,
        models,
        routeStatus: routeStatus?.status,
        retryAfterMs: routeStatus?.retryAfterMs,
        message: routeAvailable
          ? `Credential accepted. ${models.length} zero-cost model(s) are available to this account.`
          : `Credential accepted, but the selected free route is ${String(routeStatus?.status).replace(/_/g, ' ')}.`,
      });
    } catch (error: any) {
      return res.status(502).json({
        configured: true,
        isHealthy: false,
        model,
        models: [],
        message: sanitizeError(error?.message || String(error)),
      });
    }
  });

  router.get('/api/requesty/model-targets', async (_req, res) => {
    const apiKey = getRuntimeRequestyApiKey();
    const configured = Boolean(apiKey);
    let models = requestyFreeModelFallbacks;
    if (configured) {
      try {
        const baseUrl = getRuntimeRequestyBaseUrl().replace(/\/+$/, '');
        const discovered = await getCachedProviderModelDiscovery(
          'requesty',
          apiKey,
          baseUrl,
          () => fetchRequestyFreeModels(apiKey, baseUrl),
        );
        if (discovered.length > 0) models = discovered;
      } catch {
        // Keep the last-known free catalog when discovery is temporarily unavailable.
      }
    }
    return res.json({
      targets: configured ? models.map((modelId) => ({
        id: modelId,
        title: `Requesty ${modelId}`,
        modelId,
        apiKeyIndex: 0,
        value: `requesty:${modelId}`,
      })) : [],
      models,
    });
  });

  router.put('/api/requesty/model-target', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Provider settings changes require same-origin access or an authorized server token.' });
    }
    try {
      const settings = saveConfiguredProviderModel('requesty', req.body?.modelId);
      return res.json({ success: true, model: settings.requestyModel });
    } catch (error: any) {
      return res.status(400).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.post('/api/requesty/test', async (_req, res) => {
    const model = getConfiguredRequestyModel();
    try {
      const provider = providerForTest('requesty', new RequestyLLMProvider());
      const response = await provider.createChatCompletion(
        [{ role: 'user', content: 'Reply with exactly: REQUESTY_ROUTE_OK' }],
        model,
        { temperature: 0, maxTokens: 64, timeoutMs: 30_000, requestKind: 'api_pool.test' },
      );
      recordProviderSuccess('requesty', model);
      return res.json({
        configured: true,
        model,
        message: response.toUpperCase().includes('REQUESTY_ROUTE_OK')
          ? 'Configured Requesty free route responded successfully.'
          : 'Configured Requesty route responded, but not with the expected validation text.',
        responsePreview: sanitizeError(response).slice(0, 180),
      });
    } catch (error: any) {
      recordProviderFailure('requesty', model, error);
      return res.status(502).json({
        configured: Boolean(getRuntimeRequestyApiKey()),
        model,
        error: `Requesty API Pool route failed: ${sanitizeError(error?.message || String(error))}`,
      });
    }
  });

  // API Route to fetch live Pollinations AI pollen balance and account status
  // Fetches real-time balance data from: https://gen.pollinations.ai/account/balance
  // See API docs: https://gen.pollinations.ai/docs
  router.post('/api/pollinations/test', async (req, res) => {
    const apiKey = getRuntimePollinationsApiKey();
    const requestedModel = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
    const model = requestedModel.toLowerCase().startsWith('pollinations:')
      ? requestedModel.slice('pollinations:'.length).trim()
      : requestedModel || 'openai-fast';

    if (!apiKey) {
      return res.status(400).json({
        configured: false,
        isHealthy: false,
        model,
        error: 'Configure POLLINATIONS_API_KEY before testing an authenticated Pollinations route.',
      });
    }

    try {
      const provider = providerForTest('pollinations', new PollinationsLLMProvider(apiKey));
      const response = await provider.createChatCompletion(
        [{ role: 'user', content: 'Reply with exactly: POLLINATIONS_ROUTE_OK' }],
        `pollinations:${model}`,
        {
          temperature: 0,
          maxTokens: 1024,
          reasoning: { effort: 'low', summary: 'concise' },
          timeoutMs: 90_000,
          requestKind: 'api_pool.test',
          pinModel: true,
        },
      );
      recordProviderSuccess('pollinations', model);
      return res.json({
        configured: true,
        isHealthy: true,
        model,
        expectedResponse: response.toUpperCase().includes('POLLINATIONS_ROUTE_OK'),
        responsePreview: sanitizeError(response).slice(0, 180),
        message: response.toUpperCase().includes('POLLINATIONS_ROUTE_OK')
          ? 'The configured Pollinations route responded successfully.'
          : 'The configured Pollinations route responded with usable text.',
      });
    } catch (error: any) {
      recordProviderFailure('pollinations', model, error);
      return res.status(502).json({
        configured: true,
        isHealthy: false,
        model,
        error: sanitizeError(error?.message || String(error)),
      });
    }
  });

  router.get('/api/pollinations/balance', async (req, res) => {
    try {
      const apiKey = getRuntimePollinationsApiKey();
      if (!apiKey) {
        console.log('[POLLEN] No API key configured - running in anonymous mode');
        return res.json({
          hasKey: false,
          pollen: 0,
          currency: 'pollen',
          message: "No POLLINATIONS_API_KEY configured. Running in Free / Anonymous mode.",
          type: "none",
          timestamp: new Date().toISOString(),
          liveData: false,
          apiConfigured: false
        });
      }

      const isSecret = apiKey.startsWith('sk_');
      const isPublishable = apiKey.startsWith('pk_');

      if (!isSecret) {
        console.log('[POLLEN] Balance check skipped for non-secret key');
        return res.json({
          hasKey: true,
          pollen: null,
          currency: 'pollen',
          message: `${isPublishable ? 'Publishable' : 'Configured'} key detected. Balance checks require a secret key that starts with sk_.`,
          type: isPublishable ? "publishable" : "unknown",
          timestamp: new Date().toISOString(),
          liveData: false,
          apiConfigured: true
        });
      }

      console.log(`[POLLEN] Fetching balance with ${isSecret ? 'secret' : isPublishable ? 'publishable' : 'custom'} key`);

      const POLLINATIONS_ACCOUNT_BALANCE_URLS = [
        'https://gen.pollinations.ai/account/balance',
        'https://enter.pollinations.ai/api/customer/balance',
      ];

      try {
        const failures: Array<{ status: number | null; body: string }> = [];

        for (const balanceUrl of POLLINATIONS_ACCOUNT_BALANCE_URLS) {
          let fetchRes: Response;
          try {
            fetchRes = await fetch(balanceUrl, {
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
              },
              signal: AbortSignal.timeout(5000)
            });
          } catch (error: any) {
            failures.push({ status: null, body: sanitizeError(error?.message || String(error)) });
            continue;
          }

          const responseBody = await fetchRes.text();
          if (!fetchRes.ok) {
            failures.push({ status: fetchRes.status, body: responseBody });
            continue;
          }

          let data: any;
          try {
            data = JSON.parse(responseBody);
          } catch {
            failures.push({ status: fetchRes.status, body: 'Pollinations returned invalid JSON.' });
            continue;
          }

          const tierBalance = typeof data?.tierBalance === 'number' ? data.tierBalance : 0;
          const packBalance = typeof data?.packBalance === 'number' ? data.packBalance : 0;
          const cryptoBalance = typeof data?.cryptoBalance === 'number' ? data.cryptoBalance : 0;
          const balance =
            typeof data?.balance === 'number'
              ? data.balance
              : typeof data?.pollen === 'number'
                ? data.pollen
                : tierBalance + packBalance + cryptoBalance;
          console.log(`[POLLEN] Successfully fetched balance: ${balance} pollen`);
          return res.json({
            hasKey: true,
            pollen: balance,
            currency: data?.currency || 'pollen',
            message: 'Key Active',
            type: isSecret ? "secret" : "custom",
            timestamp: new Date().toISOString(),
            liveData: true,
            apiConfigured: true
          });
        }

        const failure =
          failures.find((attempt) => attempt.status === 401 || attempt.status === 403) ??
          failures[failures.length - 1] ??
          { status: null, body: '' };
        const balanceScopeMissing =
          failure.status === 403 &&
          /account:(?:usage|balance)|balance permission/i.test(failure.body);

        if (balanceScopeMissing) {
          const message = "Pollinations key is active, but this key cannot read account balance. Add the account:usage or account:balance scope, or set a budget on the key in Pollinations.";
          console.warn(`[POLLEN] Balance unavailable: ${message}`);
          return res.json({
            hasKey: true,
            pollen: null,
            currency: 'pollen',
            message,
            type: "balance_unavailable",
            timestamp: new Date().toISOString(),
            liveData: false,
            apiConfigured: true
          });
        }

        const failureMessage = summarizePollinationsBalanceFailure(failure.status, failure.body);
        const msg = failure.status === 401
          ? 'Secret key configured, but Pollinations rejected it. Verify the key is active and copied from https://enter.pollinations.ai.'
          : failure.status !== null && failure.status >= 500
            ? 'Pollinations balance service is temporarily unavailable.'
            : 'Unable to read balance.';
        console.warn(`[POLLEN] API error${failure.status === null ? '' : ` ${failure.status}`}: ${failureMessage}`);
        return res.json({
          hasKey: true,
          pollen: null,
          currency: 'pollen',
          message: msg,
          type: failure.status === 401 ? "unauthorized" : "secret",
          error: failureMessage,
          timestamp: new Date().toISOString(),
          liveData: false,
          apiConfigured: true
        });
      } catch (e: any) {
        console.error(`[POLLEN] Connection error: ${sanitizeError(e?.message || String(e))}`);
        return res.json({
          hasKey: true,
          pollen: null,
          currency: 'pollen',
          message: 'Connection issues checking balance.',
          type: "error",
          error: sanitizeError(e.message || String(e)),
          timestamp: new Date().toISOString(),
          liveData: false,
          apiConfigured: true
        });
      }
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message) });
    }
  });

  // Pollinations model registry. The GET endpoint deliberately reads only
  // SQLite so a browser reload is stable; POST performs the live sync and
  // saves the merged text/image/audio/video catalog for the next reload.
  router.get('/api/pollinations/model-catalog', (_req, res) => {
    const catalog = getSavedPollinationsModelCatalog();
    const targets = getPollinationsTextModelTargets(catalog);
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      source: catalog.source,
      syncedAt: catalog.syncedAt,
      models: catalog.models,
      targets,
      textModelCount: targets.length,
    });
  });

  router.post('/api/pollinations/model-catalog/sync', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Pollinations model changes require same-origin access or an authorized server token.' });
    }

    try {
      const previous = getSavedPollinationsModelCatalog();
      const previousIds = new Set(previous.models.map((model) => model.id.toLowerCase()));
      const { catalog, sources, failedSources } = await fetchAndSavePollinationsModelCatalog();
      const currentIds = new Set(catalog.models.map((model) => model.id.toLowerCase()));
      const inserted = catalog.models.filter((model) => !previousIds.has(model.id.toLowerCase())).length;
      const updated = catalog.models.filter((model) => previousIds.has(model.id.toLowerCase())).length;
      const removed = previous.models.filter((model) => !currentIds.has(model.id.toLowerCase())).length;
      const targets = getPollinationsTextModelTargets(catalog);
      res.set('Cache-Control', 'no-store');
      return res.json({
        success: true,
        source: catalog.source,
        sources,
        failedSources,
        syncedAt: catalog.syncedAt,
        models: catalog.models,
        targets,
        textModelCount: targets.length,
        inserted,
        updated,
        removed,
        total: catalog.models.length,
      });
    } catch (error: any) {
      return res.status(502).json({
        success: false,
        error: sanitizeError(error?.message || String(error)),
      });
    }
  });


  router.post('/api/direct-chat', async (req, res) => {
    const { messages, model: rawModel } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required and must not be empty.' });
    }
    const validMessages = messages.filter(
      (m: unknown) =>
        m && typeof m === 'object' &&
        typeof (m as Record<string, unknown>).role === 'string' &&
        typeof (m as Record<string, unknown>).content === 'string',
    );
    if (validMessages.length === 0) {
      return res.status(400).json({ error: 'No valid messages supplied. Each message must have role (string) and content (string).' });
    }

    const modelSelection = normalizeCoderModelSelection(
      typeof rawModel === 'string' && rawModel.trim() ? rawModel.trim() : getConfiguredCoderModelSelection(),
    );

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const writeSse = (event: string, data: Record<string, unknown>) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        // Client disconnected — ignore.
      }
    };

    const ac = new AbortController();
    req.on('close', () => ac.abort());

    try {
      let provider: import('../di/types.js').LLMProvider;

      if (modelSelection.startsWith('openrouter:')) {
        provider = new OpenRouterLLMProvider();
      } else if (modelSelection.startsWith('local:') || isLocalAITargetValue(modelSelection)) {
        const endpoints = getLocalAIEndpoints();
        const enabled = endpoints.find((ep) => ep.enabled && Boolean(ep.modelId));
        if (!enabled) throw new Error('No enabled Local AI endpoint configured. Set one up in API Pool → Local AI.');
        provider = new LocalModelLLMProvider(enabled.baseUrl, enabled.modelId, false);
      } else if (modelSelection.startsWith('colab:') || isColabTargetValue(modelSelection)) {
        const endpoints = getColabEndpoints();
        const enabled = endpoints.find((ep) => ep.enabled && Boolean(ep.modelId));
        if (!enabled) throw new Error('No enabled Colab endpoint configured. Set one up in API Pool → Colab.');
        provider = new ColabModelLLMProvider(enabled.baseUrl, enabled.modelId, false);
      } else if (modelSelection.startsWith('groq:')) {
        provider = new GroqLLMProvider();
      } else if (modelSelection.startsWith('cerebras:')) {
        provider = new CerebrasLLMProvider();
      } else if (modelSelection.startsWith('sambanova:')) {
        provider = new SambaNovaLLMProvider();
      } else if (modelSelection.startsWith('kimi:')) {
        provider = new KimiLLMProvider();
      } else if (modelSelection.startsWith('requesty:')) {
        provider = new RequestyLLMProvider();
      } else if (modelSelection.startsWith('nvidia:') || isNvidiaModel(modelSelection)) {
        provider = new NvidiaLLMProvider();
      } else {
        // Default: Gemini / pollinations fallback
        provider = new GeminiLLMProvider();
      }

      if (typeof provider.streamChatCompletion === 'function') {
        const stream = provider.streamChatCompletion(validMessages, modelSelection, {
          signal: ac.signal,
          requestKind: 'direct_chat',
          timeoutMs: 120_000,
        });
        for await (const event of stream) {
          if (ac.signal.aborted) break;
          if (event.type === 'text_delta') {
            writeSse('delta', { delta: event.delta });
          } else if (event.type === 'completed') {
            writeSse('done', {
              model: event.result.model,
              provider: event.result.provider,
              usage: event.result.usage,
            });
          } else if (event.type === 'error') {
            writeSse('error', { message: event.error.message, code: event.error.code });
          }
        }
      } else {
        // Provider doesn't support streaming — fall back to single completion.
        const text = await provider.createChatCompletion(validMessages, modelSelection, {
          signal: ac.signal,
          requestKind: 'direct_chat',
          timeoutMs: 120_000,
        });
        writeSse('delta', { delta: text });
        writeSse('done', { model: modelSelection, provider: provider.getProviderName() });
      }
    } catch (error: any) {
      if (!ac.signal.aborted) {
        writeSse('error', { message: sanitizeError(error?.message || String(error)) });
      }
    } finally {
      try { res.end(); } catch { /* ignore */ }
    }
  });


  return router;
}
