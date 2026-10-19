/**
 * LLM Provider Implementations
 * Adapters for different LLM backends
 */

import type { LLMCompletionOptions, LLMCompletionResult, LLMCompletionStreamEvent, LLMProvider, LLMReasoningOptions, LLMRequestBudget, LLMRequestTelemetry, LLMToolCall, LLMUsage, ModelCapabilities } from '../types.js';
import { extractSafeReasoningSummary, extractSafeReasoningSummaryDelta, reportCompletionResult, SAFE_REASONING_SUMMARY_MAX_CHARS } from '../reasoning.js';
import { PollinationsClient, pollinationsClient } from '../../pollinations/client.js';
import { ApiKeyPool, parseGeminiError } from './apiKeyPool.js';
import { isGeminiModel } from '../../validation/stringValidators.js';
import {
  getRuntimeGeminiApiKey,
  getRuntimeKimiApiKey,
  getRuntimeKimiBaseUrl,
  getRuntimeRequestyApiKey,
  getRuntimeRequestyBaseUrl,
  getRuntimeNvidiaApiKey,
  getRuntimeNvidiaApiKeys,
  getRuntimeNvidiaBaseUrl,
  getRuntimeOpenRouterBaseUrl,
  getRuntimeCerebrasApiKey,
  getRuntimeCerebrasBaseUrl,
  getRuntimeCerebrasModel,
  getRuntimeSambaNovaApiKey,
  getRuntimeSambaNovaBaseUrl,
  getRuntimePollinationsApiKey,
  getRuntimeEnvValue,
  getRuntimeLocalActionIdleTimeoutMs,
  getRuntimeLocalActionOverallTimeoutMs,
} from '../../config/runtimeEnv.js';
import { getConfiguredGroqModel, getConfiguredKimiModel, getConfiguredOpenRouterModel, getConfiguredRequestyModel, getConfiguredSambaNovaModel } from '../../config/providerRouteSettings.js';
import { getConfiguredOpenRouterApiKey } from '../../config/openRouterConfig.js';
import {
  DEFAULT_OPENROUTER_STRUCTURED_MODEL,
  getConfiguredOpenRouterStructuredModel,
  getOpenRouterKnownModelMetadata,
  getOpenRouterModelTarget,
  getOpenRouterModelTargetMaxTokens,
  getSavedOpenRouterModelTargets,
  isOpenRouterFreeModel,
} from '../../config/openRouterTargets.js';
import {
  getNvidiaChatModelIds,
  getNvidiaModelMetadata,
  isNvidiaModel,
  normalizeNvidiaModelId,
  NVIDIA_BASE_URL_DEFAULT,
  NVIDIA_FREE_FALLBACK_MODEL,
} from '../../config/nvidiaModels.js';
import { isNvidiaTargetModelValue, resolveNvidiaModelTarget } from '../../config/nvidiaTargets.js';
import { isGeminiTargetModelValue, parseGeminiRuntimeKeys, resolveGeminiModelTarget } from '../../config/geminiTargets.js';
import { supportsGeminiSamplingParameters } from '../../config/geminiModels.js';
import {
  GeminiProfileRegistry,
  GeminiProfileScheduler,
  geminiProfileScheduler,
  getGeminiProfileRegistry,
  type GeminiAccountProfile,
} from '../../config/geminiProfiles.js';
import { classifyGeminiProviderError } from './providerErrors.js';
import {
  createGeminiRequestFingerprint,
  getCachedGeminiResponse,
  prepareGeminiMessages,
  runDeduplicatedGeminiRequest,
} from './geminiRequestReliability.js';
import { isLegacyGroqTargetModelValue } from '../../config/groqTargets.js';
import { getExecutionProfileProviderIntervalMs } from '../../config/executionProfiles.js';
import {
  getProviderRoutePauseReason,
  getProviderRouteHealthScore,
  getProviderRouteStatus,
  isProviderRoutePaused,
  releaseProviderRouteProbe,
  recordProviderFailure,
  recordProviderSuccess,
  tryAcquireProviderRoute,
  updateProviderRateLimitHeaders,
} from './rateLimitMonitor.js';
import { GroqLLMProvider } from './groqProvider.js';
export { GroqLLMProvider } from './groqProvider.js';
export { resetGroqScheduler as resetGroqRequestScheduler } from './providerScheduler.js';
import { recordGroqFallbackAudit } from '../../config/groqConfig.js';
import {
  DEFAULT_LOCAL_AI_INPUT_TOKEN_LIMIT,
  getLocalAIEndpoints,
  isLocalAITargetValue,
  resolveLocalAIModelTarget,
} from '../../config/localAITargets.js';
import {
  getColabEndpoints,
  isColabTargetValue,
  resolveColabModelTarget,
} from '../../config/colabTargets.js';

const POLLINATIONS_GEMINI_FALLBACK_MODEL = 'openai-fast';
const POLLINATIONS_PUBLIC_FALLBACK_MODEL = 'openai-fast';
const GEMINI_PROVIDER_FALLBACK_MODEL = 'gemini-3.6-flash';
// Keep the provider-wide fallback on a model that responds inside the bounded
// handover window. GLM-5.2 remains selectable explicitly, but it can spend an
// entire 90-second request timing out across otherwise healthy NVIDIA accounts.
const NVIDIA_PROVIDER_FALLBACK_MODEL = NVIDIA_FREE_FALLBACK_MODEL;
const OPENROUTER_MODEL_PREFIX = 'openrouter:';
const POLLINATIONS_MODEL_PREFIX = 'pollinations:';
const OPENROUTER_DYNAMIC_FREE_MODEL = 'openrouter/free';
const OPENROUTER_OX_ALPHA_MODEL = 'stealth/ox-alpha';
const OPENROUTER_DYNAMIC_FREE_MIN_OUTPUT_TOKENS = 2_048;
// Ox Alpha is a reasoning model. Its reasoning effort is allocated from the
// requested completion limit, so applying the caller's small generic planner
// budget can leave no room for visible text/tool JSON. Use the model's full
// advertised completion ceiling instead of reducing it to the old 8K floor.
const OPENROUTER_OX_ALPHA_DEFAULT_MAX_OUTPUT_TOKENS = 131_072;
// Recovery routes are ordinary OpenRouter models. Do not inherit Ox Alpha's
// 131K reasoning budget: many free/structured routes reject that max_tokens
// value before they can produce the visible answer recovery is meant to get.
const OPENROUTER_RECOVERY_MAX_OUTPUT_TOKENS = 8_192;
const REQUESTY_MIN_OUTPUT_TOKENS = 512;
const GROQ_MODEL_PREFIX = 'groq:';
const CEREBRAS_MODEL_PREFIX = 'cerebras:';
const SAMBANOVA_MODEL_PREFIX = 'sambanova:';
const KIMI_MODEL_PREFIX = 'kimi:';
const REQUESTY_MODEL_PREFIX = 'requesty:';
const POLLINATIONS_GENERAL_FALLBACK_MODELS = [
  'openai-fast',
  'qwen-coder',
  'mistral-small-3.2',
  'nova-fast',
  'openai',
  'gpt-oss-20b',
];
const POLLINATIONS_ONLY_MODEL_PREFIXES = [
  'claude',
  'deepseek',
  'gemma',
  'glm',
  'gpt-oss',
  'grok',
  'kimi',
  'llama',
  'mercury',
  'midijourney',
  'minimax',
  'mistral',
  'nova',
  'openai',
  'perplexity',
  'polly',
  'qwen',
  'step',
];
const POLLINATIONS_ONLY_MODELS = new Set([
  'gpt-oss-20b',
  'gemini',
  'gemini-3-flash',
  'gemini-fast',
  'gemini-flash-lite-3.1',
  'gemini-large',
  'gemini-search',
  'gemini-search-fast',
  'gemini-search-large',
  'ovh-reasoning',
]);
const GEMINI_MIN_ATTEMPT_MS = 10_000;
const NVIDIA_MIN_ATTEMPT_MS = 30_000;
// A free-tier NVIDIA route may need one request for the selected model and a
// second request for the bounded same-provider fallback. Keep enough room for
// both when CompositeLLMProvider gives each credential a fair slice.
const NVIDIA_FALLBACK_MIN_ATTEMPT_MS = 15_000;
const DEFAULT_NVIDIA_FREE_ATTEMPT_TIMEOUT_MS = 45_000;
// On free-tier pacing profiles, the provider will wait up to this long for a
// throttled API key to recover rather than skipping it and exhausting attempts.
// Configured via REACT_ENGINE_NVIDIA_FREE_TIER_MAX_KEY_WAIT_MS.
const DEFAULT_NVIDIA_FREE_KEY_WAIT_MS = 120_000;
const POLLINATIONS_MIN_ATTEMPT_MS = 8_000;
const DEFAULT_NVIDIA_MAX_ATTEMPTS = 3;
const DEFAULT_NVIDIA_REQUEST_INTERVAL_MS = 1_000;
const CONSERVATIVE_NVIDIA_REQUEST_INTERVAL_MS = 3_000;
const DEFAULT_FREE_PROVIDER_REQUEST_INTERVAL_MS = 6_000;
// Fast execution is still deliberately rate-limited for OpenRouter because a
// single account key is shared by every run in this process. Three seconds is
// a 20-request/minute ceiling while preserving a materially faster path than
// the normal free-provider pacing profile.
const DEFAULT_OPENROUTER_REQUEST_INTERVAL_MS = 3_000;
const DEFAULT_LLM_REQUEST_LIMIT = 10;
const DEFAULT_NVIDIA_MAX_CONCURRENT_REQUESTS_PER_MODEL = 1;
const DEFAULT_NVIDIA_RETRY_BASE_MS = 500;
const DEFAULT_NVIDIA_RETRY_MAX_MS = 10_000;
const NVIDIA_QUEUE_AGING_INTERVAL_MS = 1_000;
const PROVIDER_SLICE_HEADROOM_MS = 250;

function monotonicNow(): number {
  return performance.now();
}

function estimateProviderInputTokens(messages: Array<{ role: string; content: string }>): number {
  return Math.max(1, Math.ceil(messages.reduce((total, message) => total + message.role.length + message.content.length, 0) / 4));
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(getRuntimeEnvValue(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function isFreeExecutionPacingEnabled(options: LLMCompletionOptions | undefined): boolean {
  if (!options?.pacingProfile || options.pacingProfile === 'fast') return false;
  return getRuntimeEnvValue('REACT_ENGINE_FREE_EXECUTION_PACING', 'true').toLowerCase() !== 'false';
}

function readRequestInterval(name: string): number | undefined {
  const raw = getRuntimeEnvValue(name);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0
    ? Math.min(Math.floor(value), 60_000)
    : undefined;
}

function getGeminiRequestIntervalMs(options: LLMCompletionOptions | undefined): number {
  if (options?.pacingProfile === 'fast') return 0;

  const configured = readRequestInterval('REACT_ENGINE_GEMINI_MIN_REQUEST_INTERVAL_MS');
  if (configured !== undefined) return configured;
  if (!isFreeExecutionPacingEnabled(options)) return 0;

  const requestedInterval = Number.isFinite(options?.minimumRouteIntervalMs)
    ? Number(options?.minimumRouteIntervalMs)
    : 0;
  const profileInterval = getExecutionProfileProviderIntervalMs(options?.pacingProfile);
  return Math.max(
    profileInterval || DEFAULT_FREE_PROVIDER_REQUEST_INTERVAL_MS,
    Math.min(Math.floor(requestedInterval), 60_000),
  );
}

function normalizeRequestLimit(value: number | undefined): number {
  if (Number.isFinite(value) && Number(value) > 0) return Math.floor(Number(value));
  return readPositiveInteger('REACT_ENGINE_LLM_MAX_REQUESTS_PER_TASK', DEFAULT_LLM_REQUEST_LIMIT);
}

function createRequestBudget(
  parent: AbortSignal | undefined,
  timeoutMs: number | undefined,
  requestLimit?: number,
  parentBudget?: LLMRequestBudget,
): LLMRequestBudget {
  const controller = new AbortController();
  const startedAt = monotonicNow();
  const durationMs = timeoutMs && timeoutMs > 0 ? timeoutMs : Number.POSITIVE_INFINITY;
  let remainingRequestCount = normalizeRequestLimit(requestLimit);
  const abortFromParent = () => controller.abort(parent?.reason || new Error('LLM request cancelled'));
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener('abort', abortFromParent, { once: true });
  const timer = Number.isFinite(durationMs)
    ? setTimeout(() => controller.abort(new Error(`LLM request timed out after ${timeoutMs}ms`)), durationMs)
    : undefined;

  return {
    signal: controller.signal,
    remainingMs: () => Math.max(0, durationMs - (monotonicNow() - startedAt)),
    remainingRequests: () => parentBudget?.remainingRequests() ?? remainingRequestCount,
    tryConsumeRequest: () => {
      if (parentBudget) return parentBudget.tryConsumeRequest();
      if (remainingRequestCount <= 0) return false;
      remainingRequestCount--;
      return true;
    },
    cleanup: () => {
      if (timer) clearTimeout(timer);
      parent?.removeEventListener('abort', abortFromParent);
    },
  };
}

function getEffectiveRequestTimeoutMs(options: LLMCompletionOptions | undefined, model?: string): number | undefined {
  if (options?.overallTimeoutMs && options.overallTimeoutMs > 0) return options.overallTimeoutMs;
  const requestedTimeoutMs = options?.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : undefined;
  const streamedLocalAction = Boolean(
    options?.stream
      && options.requestKind === 'step.plan_action'
      && model
      && (isLocalModel(model) || isColabModel(model)),
  );
  return streamedLocalAction
    ? Math.max(requestedTimeoutMs || 0, getRuntimeLocalActionOverallTimeoutMs())
    : requestedTimeoutMs;
}

function getRequestBudget(options: LLMCompletionOptions | undefined, model?: string): { budget: LLMRequestBudget; owned: boolean } {
  if (options?.requestBudget) return { budget: options.requestBudget, owned: false };
  return {
    budget: createRequestBudget(options?.signal, getEffectiveRequestTimeoutMs(options, model), options?.requestLimit),
    owned: true,
  };
}

function budgetCanFit(budget: LLMRequestBudget, minimumMs: number): boolean {
  return budget.remainingRequests() > 0
    && (!Number.isFinite(budget.remainingMs()) || budget.remainingMs() >= minimumMs);
}

function consumeRequestBudget(budget: LLMRequestBudget, provider: string, model: string): void {
  if (budget.tryConsumeRequest()) return;
  throw new Error(
    `Error: Provider request budget exhausted\n` +
    `Cause: The routed task reached its maximum number of provider transport calls\n` +
    `Suggested Fix: Reduce retries/fallbacks or increase REACT_ENGINE_LLM_MAX_REQUESTS_PER_TASK.\n` +
    `Context: Provider: ${provider}, Model: ${model}`
  );
}

function createAttemptDeadline(
  parent: AbortSignal | undefined,
  timeoutMs: number | undefined,
  idleTimeoutMs?: number,
) {
  const controller = new AbortController();
  let timedOut = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const normalizedIdleTimeoutMs = idleTimeoutMs && idleTimeoutMs > 0 ? Math.floor(idleTimeoutMs) : undefined;
  const abortFromParent = () => controller.abort(parent?.reason || new Error('LLM request cancelled'));
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener('abort', abortFromParent, { once: true });
  const timer = timeoutMs && timeoutMs > 0
    ? setTimeout(() => {
        timedOut = true;
        controller.abort(new Error(`LLM provider attempt timed out after ${timeoutMs}ms`));
      }, timeoutMs)
    : undefined;
  const touch = () => {
    if (!normalizedIdleTimeoutMs || controller.signal.aborted) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(`LLM provider stream idle timed out after ${normalizedIdleTimeoutMs}ms`));
    }, normalizedIdleTimeoutMs);
  };
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    touch,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      if (idleTimer) clearTimeout(idleTimer);
      parent?.removeEventListener('abort', abortFromParent);
    },
  };
}

async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', abort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const abort = () => finish(() => reject(signal.reason || new Error('LLM request aborted')));
    signal.addEventListener('abort', abort, { once: true });
    // Attach both handlers before checking an already-aborted signal. This
    // prevents a later Undici rejection from becoming an unhandled rejection.
    Promise.resolve(promise).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
    if (signal.aborted) abort();
  });
}

function emitTelemetry(options: LLMCompletionOptions | undefined, telemetry: LLMRequestTelemetry): void {
  try {
    options?.onTelemetry?.(telemetry);
  } catch {
    // Observability must never change provider behavior.
  }
}

export function summarizeProviderFailure(provider: string, error: string): string {
  // Provider error bodies often include a generic suggestion such as
  // "verify API key". Do not treat that wording as proof of an auth failure:
  // it previously turned 400/429/model errors into the misleading message
  // "authentication or access failure".
  if (/API_KEY_SERVICE_BLOCKED|GenerativeService\.GenerateContent.*blocked|generativelanguage\.googleapis\.com.*blocked/i.test(error)) {
    return `${provider}: generation is blocked for this API key's Google project (enable/unblock the Generative Language API)`;
  }
  if (/project has been denied access|denied access[^\n]*contact support/i.test(error)) {
    return `${provider}: Google project denied access (contact provider support or use a key from an allowed project)`;
  }
  if (/attempts? skipped due to exhausted request budget|remaining budget is below|\bAttempts:\s*0\b/i.test(error)) {
    return `${provider}: not called (allocated request budget was below the provider minimum; no API request was sent)`;
  }
  if (/(?:account|organization|org[-\s])[^\n]{0,160}suspend(?:ed)?[^\n]{0,160}(?:insufficient balance|billing)|insufficient balance|recharge (?:your )?account|payment required/i.test(error)) {
    return `${provider}: billing required (account suspended or balance unavailable)`;
  }
  const recoveryFailure = error.match(/\nRecovery route ([^\n]+) also failed:\s*([\s\S]+)/i);
  if (recoveryFailure && /returned no usable chat content/i.test(error)) {
    const recoveryClassification = summarizeProviderFailure(provider, recoveryFailure[2]).replace(`${provider}: `, '');
    return `${provider}: primary returned no usable chat content; recovery route ${recoveryClassification}`;
  }
  if (/upstream_provider_shared_pool|temporarily rate-limited upstream/i.test(error)) {
    return `${provider}: upstream shared pool rate-limited (model is temporarily busy on OpenRouter upstream; retry shortly or switch model)`;
  }
  if (/free-models-per-day|free model rate limit exceeded|daily (?:request )?(?:quota|limit)[^\n]{0,80}(?:exhausted|exceeded|reached)|quota (?:is )?exhausted/i.test(error)) {
    return `${provider}: quota exhausted (wait for reset or update the provider plan)`;
  }
  if (/\b(?:HTTP\s*)?429\b|throttl|\brate[\s_-]*limit(?:ed| exceeded| reached| hit| reset| cooldown)\b|RESOURCE_EXHAUSTED/i.test(error)) return `${provider}: throttled (check quota/cooldown)`;
  if (/\b(?:HTTP\s*)?(?:401|403)\b|\b(?:UNAUTHENTICATED|PERMISSION_DENIED)\b/i.test(error)) {
    return `${provider}: authentication or access failure`;
  }
  if (/\b503\b|UNAVAILABLE|high demand|overloaded/i.test(error)) {
    return `${provider}: temporarily overloaded (retry shortly; fallback routes were attempted)`;
  }
  if (/INVALID_ARGUMENT|invalid request deadline|\bHTTP 400\b/i.test(error)) return `${provider}: invalid local/provider request configuration`;
  if (/timed out|timeout|deadline/i.test(error)) return `${provider}: timed out`;
  // Only call this an API-family mismatch when the provider explicitly says
  // the selected model cannot use chat completions. NVIDIA error suggestions
  // also mention "api family" for ordinary route failures, which previously
  // produced the false and overly definitive "retired model" diagnosis.
  if (/cannot use chat completions|uses apiFamily|requires \/?[^\s,]+,? not chat completions/i.test(error)) {
    return `${provider}: incompatible model/API family`;
  }
  const unavailableStatus = error.match(/\bHTTP\s*(404|410)\b/i)?.[1];
  if (unavailableStatus) {
    return `${provider}: model route unavailable (HTTP ${unavailableStatus}; check model access/endpoint)`;
  }
  const primaryCause = error.match(/Cause:\s*([^\n]+)/i)?.[1] || error.split('\n')[0] || 'failed';
  return `${provider}: ${redactProviderText(primaryCause)}`;
}

type ProviderFailureContext = {
  provider: string;
  requestedTarget: string;
  model: string;
  apiKeyIndex?: number;
  error: string;
};

function summarizeProviderRouteFailure(entry: ProviderFailureContext): string {
  const prefix = `${entry.provider}: `;
  const classification = summarizeProviderFailure(entry.provider, entry.error).replace(prefix, '');
  const selectedCredentialIndex = entry.provider === 'nvidia'
    ? resolveNvidiaModelTarget(entry.requestedTarget)?.apiKeyIndex
    : entry.provider === 'gemini'
      ? resolveGeminiModelTarget(entry.requestedTarget)?.apiKeyIndex
      : undefined;
  const credential = Number.isInteger(entry.apiKeyIndex)
    ? selectedCredentialIndex === undefined
      ? `API key ${Number(entry.apiKeyIndex) + 1}`
      : entry.apiKeyIndex === selectedCredentialIndex
        ? `selected API key ${Number(entry.apiKeyIndex) + 1}`
        : `fallback API key ${Number(entry.apiKeyIndex) + 1} (independent account; selected API key ${Number(selectedCredentialIndex) + 1})`
    : entry.provider === 'groq'
      ? 'single configured organization'
      : 'provider key pool';
  const route = [
    entry.provider,
    entry.requestedTarget !== entry.model ? `selected target "${entry.requestedTarget}"` : undefined,
    `model "${entry.model}"`,
    credential,
  ].filter(Boolean).join(' | ');
  const detail = redactProviderText(entry.error);
  return `- ${route}: ${classification}. Provider detail: ${detail}`;
}

function isSkippedProviderAttempt(error: string): boolean {
  return /attempts? skipped due to exhausted request budget|remaining budget is below|\bAttempts:\s*0\b/i.test(error);
}

function getProviderFailureForRateMonitor(providerName: string, message: string): string {
  // An Ox Alpha empty-content recovery can fail on a different OpenRouter
  // model. Do not mark the requested Ox Alpha route as throttled because that
  // secondary model returned HTTP 429; the primary request already received a
  // successful HTTP response and must remain eligible for the next attempt.
  if (providerName !== 'openrouter') return message;
  return message.split(/\nRecovery route [^\n]+ also failed:/i, 1)[0] || message;
}

function getProviderMinimumSliceMs(providerName: string): number {
  if (providerName === 'gemini') {
    return Math.max(
      GEMINI_MIN_ATTEMPT_MS,
      readPositiveInteger('REACT_ENGINE_GEMINI_MIN_ATTEMPT_MS', GEMINI_MIN_ATTEMPT_MS),
    );
  }
  if (providerName === 'nvidia') {
    return readPositiveInteger('REACT_ENGINE_NVIDIA_MIN_ATTEMPT_MS', NVIDIA_MIN_ATTEMPT_MS);
  }
  if (providerName === 'pollinations') return POLLINATIONS_MIN_ATTEMPT_MS;
  return 1;
}

function isPollinationsOnlyModel(modelName: string): boolean {
  const normalizedModel = normalizePollinationsModelAlias(modelName);
  return normalizedModel.startsWith(POLLINATIONS_MODEL_PREFIX)
    || POLLINATIONS_ONLY_MODELS.has(normalizedModel) || POLLINATIONS_ONLY_MODEL_PREFIXES.some(
    (prefix) => normalizedModel === prefix || normalizedModel.startsWith(`${prefix}-`)
  );
}

function getProviderModel(providerName: string, requestedModel: string): string {
  const normalizedModel = normalizePollinationsModelAlias(requestedModel);

  if (isLocalAITargetValue(requestedModel) || requestedModel.startsWith('local:')) {
    if (providerName === 'local') return requestedModel;
    if (providerName === 'openrouter') return getConfiguredOpenRouterModel();
    if (providerName === 'groq') return getConfiguredGroqModel();
    if (providerName === 'cerebras') return getRuntimeCerebrasModel();
    if (providerName === 'sambanova') return getConfiguredSambaNovaModel();
    if (providerName === 'kimi') return getConfiguredKimiModel();
    if (providerName === 'requesty') return getConfiguredRequestyModel();
    if (providerName === 'gemini') return GEMINI_PROVIDER_FALLBACK_MODEL;
    if (providerName === 'nvidia') return NVIDIA_PROVIDER_FALLBACK_MODEL;
    return POLLINATIONS_PUBLIC_FALLBACK_MODEL;
  }

  if (isColabTargetValue(requestedModel)) {
    if (providerName === 'colab') return requestedModel;
    if (providerName === 'openrouter') return getConfiguredOpenRouterModel();
    if (providerName === 'groq') return getConfiguredGroqModel();
    if (providerName === 'cerebras') return getRuntimeCerebrasModel();
    if (providerName === 'sambanova') return getConfiguredSambaNovaModel();
    if (providerName === 'kimi') return getConfiguredKimiModel();
    if (providerName === 'requesty') return getConfiguredRequestyModel();
    if (providerName === 'gemini') return GEMINI_PROVIDER_FALLBACK_MODEL;
    if (providerName === 'nvidia') return NVIDIA_PROVIDER_FALLBACK_MODEL;
    return POLLINATIONS_PUBLIC_FALLBACK_MODEL;
  }

  if (isLegacyGroqTargetModelValue(requestedModel)) {
    if (providerName === 'groq') return getConfiguredGroqModel();
    if (providerName === 'openrouter') return getConfiguredOpenRouterModel();
    if (providerName === 'cerebras') return getRuntimeCerebrasModel();
    if (providerName === 'sambanova') return getConfiguredSambaNovaModel();
    if (providerName === 'gemini') return GEMINI_PROVIDER_FALLBACK_MODEL;
    if (providerName === 'nvidia') return NVIDIA_PROVIDER_FALLBACK_MODEL;
    return POLLINATIONS_PUBLIC_FALLBACK_MODEL;
  }

  if (requestedModel.toLowerCase().startsWith(POLLINATIONS_MODEL_PREFIX)) {
    const pollinationsModel = requestedModel.slice(POLLINATIONS_MODEL_PREFIX.length).trim();
    if (providerName === 'pollinations') return normalizePollinationsModelAlias(pollinationsModel);
    if (providerName === 'openrouter') return getConfiguredOpenRouterModel();
    if (providerName === 'groq') return getConfiguredGroqModel();
    if (providerName === 'cerebras') return getRuntimeCerebrasModel();
    if (providerName === 'sambanova') return getConfiguredSambaNovaModel();
    if (providerName === 'kimi') return getConfiguredKimiModel();
    if (providerName === 'requesty') return getConfiguredRequestyModel();
    if (providerName === 'gemini') return GEMINI_PROVIDER_FALLBACK_MODEL;
    if (providerName === 'nvidia') return NVIDIA_PROVIDER_FALLBACK_MODEL;
    return POLLINATIONS_PUBLIC_FALLBACK_MODEL;
  }

  if (requestedModel.startsWith(OPENROUTER_MODEL_PREFIX)) {
    const openRouterModel = requestedModel.slice(OPENROUTER_MODEL_PREFIX.length).trim();
    if (providerName === 'openrouter') return openRouterModel;
    if (providerName === 'gemini') return GEMINI_PROVIDER_FALLBACK_MODEL;
    if (providerName === 'nvidia') {
      return isNvidiaModel(openRouterModel) ? openRouterModel : NVIDIA_PROVIDER_FALLBACK_MODEL;
    }
    if (providerName === 'groq') return getConfiguredGroqModel();
    if (providerName === 'cerebras') return getRuntimeCerebrasModel();
    return POLLINATIONS_PUBLIC_FALLBACK_MODEL;
  }

  if (requestedModel.startsWith(GROQ_MODEL_PREFIX)) {
    const groqModel = requestedModel.slice(GROQ_MODEL_PREFIX.length).trim();
    if (providerName === 'groq') return groqModel;
    if (providerName === 'openrouter') return getConfiguredOpenRouterModel();
    if (providerName === 'cerebras') return getRuntimeCerebrasModel();
    if (providerName === 'sambanova') return getConfiguredSambaNovaModel();
    if (providerName === 'gemini') return GEMINI_PROVIDER_FALLBACK_MODEL;
    return NVIDIA_PROVIDER_FALLBACK_MODEL;
  }

  if (requestedModel.startsWith(CEREBRAS_MODEL_PREFIX)) {
    const cerebrasModel = requestedModel.slice(CEREBRAS_MODEL_PREFIX.length).trim();
    if (providerName === 'cerebras') return cerebrasModel;
    if (providerName === 'openrouter') return getConfiguredOpenRouterModel();
    if (providerName === 'groq') return getConfiguredGroqModel();
    if (providerName === 'kimi') return getConfiguredKimiModel();
    if (providerName === 'requesty') return getConfiguredRequestyModel();
    if (providerName === 'gemini') return GEMINI_PROVIDER_FALLBACK_MODEL;
    if (providerName === 'nvidia') return NVIDIA_PROVIDER_FALLBACK_MODEL;
    return POLLINATIONS_PUBLIC_FALLBACK_MODEL;
  }

  if (requestedModel.startsWith(SAMBANOVA_MODEL_PREFIX)) {
    const sambaNovaModel = requestedModel.slice(SAMBANOVA_MODEL_PREFIX.length).trim();
    if (providerName === 'sambanova') return sambaNovaModel;
    if (providerName === 'openrouter') return getConfiguredOpenRouterModel();
    if (providerName === 'groq') return getConfiguredGroqModel();
    if (providerName === 'cerebras') return getRuntimeCerebrasModel();
    if (providerName === 'kimi') return getConfiguredKimiModel();
    if (providerName === 'requesty') return getConfiguredRequestyModel();
    if (providerName === 'gemini') return GEMINI_PROVIDER_FALLBACK_MODEL;
    if (providerName === 'nvidia') return NVIDIA_PROVIDER_FALLBACK_MODEL;
    return POLLINATIONS_PUBLIC_FALLBACK_MODEL;
  }

  if (requestedModel.startsWith(KIMI_MODEL_PREFIX)) {
    const kimiModel = requestedModel.slice(KIMI_MODEL_PREFIX.length).trim();
    if (providerName === 'kimi') return kimiModel;
    if (providerName === 'openrouter') return getConfiguredOpenRouterModel();
    if (providerName === 'groq') return getConfiguredGroqModel();
    if (providerName === 'gemini') return GEMINI_PROVIDER_FALLBACK_MODEL;
    if (providerName === 'nvidia') return NVIDIA_PROVIDER_FALLBACK_MODEL;
    return POLLINATIONS_PUBLIC_FALLBACK_MODEL;
  }

  if (requestedModel.startsWith(REQUESTY_MODEL_PREFIX)) {
    const requestyModel = requestedModel.slice(REQUESTY_MODEL_PREFIX.length).trim();
    if (providerName === 'requesty') return requestyModel;
    if (providerName === 'openrouter') return getConfiguredOpenRouterModel();
    if (providerName === 'groq') return getConfiguredGroqModel();
    if (providerName === 'kimi') return getConfiguredKimiModel();
    if (providerName === 'gemini') return GEMINI_PROVIDER_FALLBACK_MODEL;
    if (providerName === 'nvidia') return NVIDIA_PROVIDER_FALLBACK_MODEL;
    return POLLINATIONS_PUBLIC_FALLBACK_MODEL;
  }

  if (providerName === 'openrouter') {
    // A fallback into OpenRouter must use the route configured for that
    // provider. Reusing a NVIDIA model id can silently select a paid or
    // inaccessible OpenRouter route (for example, z-ai/glm-5.2).
    return getConfiguredOpenRouterModel();
  }

  if (providerName === 'groq') return getConfiguredGroqModel();
  if (providerName === 'cerebras') return getRuntimeCerebrasModel();
  if (providerName === 'sambanova') return getConfiguredSambaNovaModel();
  if (providerName === 'kimi') return getConfiguredKimiModel();
  if (providerName === 'requesty') return getConfiguredRequestyModel();

  if (providerName === 'nvidia') {
    if (isNvidiaModel(requestedModel) || isNvidiaTargetModelValue(requestedModel)) {
      return normalizeNvidiaModelId(requestedModel);
    }
    // Native Gemini failures always get one known NVIDIA chat fallback rather
    // than an implicit rotation through the whole NVIDIA catalog.
    return NVIDIA_PROVIDER_FALLBACK_MODEL;
  }

  if (isNvidiaModel(requestedModel) || isNvidiaTargetModelValue(requestedModel)) {
    return providerName === 'gemini' ? GEMINI_PROVIDER_FALLBACK_MODEL : POLLINATIONS_PUBLIC_FALLBACK_MODEL;
  }

  if (isGeminiTargetModelValue(requestedModel)) {
    return providerName === 'gemini' ? requestedModel : POLLINATIONS_PUBLIC_FALLBACK_MODEL;
  }

  if (providerName === 'pollinations' && isGeminiModel(requestedModel) && !isPollinationsOnlyModel(requestedModel)) {
    return POLLINATIONS_GEMINI_FALLBACK_MODEL;
  }

  if (providerName === 'gemini' && (!isGeminiModel(normalizedModel) || isPollinationsOnlyModel(normalizedModel))) {
    return GEMINI_PROVIDER_FALLBACK_MODEL;
  }

  return normalizedModel;
}

function normalizePollinationsModelAlias(modelName: string): string {
  const trimmed = modelName.trim();
  const normalized = trimmed.toLowerCase().replace(/[\s_]+/g, '-');
  const aliases: Record<string, string> = {
    'deepseek-v4-pro': 'deepseek-pro',
    'deepseek-4-pro': 'deepseek-pro',
    'deepseek-pro-v4': 'deepseek-pro',
    'deepseek-v4': 'deepseek',
    'gpt-5.5': 'openai-large',
    'gpt-5.5-reasoning': 'openai-large',
    'gpt-5.4-nano': 'openai',
    'gpt-5-nano': 'openai-fast',
    'gpt-5-mini': 'gpt-5.4-mini',
    'openai-mini': 'gpt-5.4-mini',
  };

  // Aliases are matched case-insensitively, but registry model IDs are
  // provider-owned identifiers and may contain case-sensitive owner/model
  // segments. Preserve those IDs when they are not one of our aliases.
  return aliases[normalized] || trimmed;
}

function isOpenRouterModel(modelName: string): boolean {
  return modelName.startsWith(OPENROUTER_MODEL_PREFIX) && modelName.length > OPENROUTER_MODEL_PREFIX.length;
}

function isGroqModel(modelName: string): boolean {
  return modelName.startsWith(GROQ_MODEL_PREFIX) && modelName.length > GROQ_MODEL_PREFIX.length;
}

function isCerebrasModel(modelName: string): boolean {
  return modelName.startsWith(CEREBRAS_MODEL_PREFIX) && modelName.length > CEREBRAS_MODEL_PREFIX.length;
}

function isSambaNovaModel(modelName: string): boolean {
  return modelName.startsWith(SAMBANOVA_MODEL_PREFIX) && modelName.length > SAMBANOVA_MODEL_PREFIX.length;
}

function isKimiModel(modelName: string): boolean {
  return modelName.startsWith(KIMI_MODEL_PREFIX) && modelName.length > KIMI_MODEL_PREFIX.length;
}

function isRequestyModel(modelName: string): boolean {
  return modelName.startsWith(REQUESTY_MODEL_PREFIX) && modelName.length > REQUESTY_MODEL_PREFIX.length;
}

function isLocalModel(modelName: string): boolean {
  return isLocalAITargetValue(modelName)
    || (modelName.startsWith('local:') && modelName.length > 'local:'.length);
}

function isColabModel(modelName: string): boolean {
  return isColabTargetValue(modelName)
    || (modelName.startsWith('colab:') && modelName.length > 'colab:'.length);
}

function getPollinationsModelRotation(requestedModel: string): string[] {
  const model = normalizePollinationsModelAlias(requestedModel);
  const modelFamily = model.toLowerCase();

  const familyFallbacks = modelFamily.startsWith('deepseek')
    ? [model, 'deepseek', 'deepseek-pro', 'qwen-coder', 'qwen-large', 'mistral-small-3.2', POLLINATIONS_PUBLIC_FALLBACK_MODEL]
    : modelFamily.startsWith('qwen')
    ? [model, 'qwen-coder', 'qwen-large', 'openai-fast']
    : modelFamily.startsWith('openai-large') || modelFamily.startsWith('gpt-5.4') || modelFamily.startsWith('gpt-5.5')
    ? [model, 'gpt-5.4-mini', 'openai', POLLINATIONS_PUBLIC_FALLBACK_MODEL, 'qwen-coder']
    : modelFamily.startsWith('claude')
    ? [model, 'claude-fast', 'qwen-coder', POLLINATIONS_PUBLIC_FALLBACK_MODEL]
    : modelFamily.startsWith('mistral')
    ? [model, 'mistral-small-3.2', 'qwen-coder', POLLINATIONS_PUBLIC_FALLBACK_MODEL]
    : [model, ...POLLINATIONS_GENERAL_FALLBACK_MODELS];

  return Array.from(new Set(familyFallbacks.filter(Boolean)));
}

function shouldUsePublicPollinationsFallback(errorMessage: string): boolean {
  return /HTTP (401|402)|UNAUTHORIZED|PAYMENT_REQUIRED|Insufficient balance/i.test(errorMessage);
}

function isPollinationsCredentialFailure(errorMessage: string): boolean {
  return /a valid api key is required|invalid (?:pollinations )?(?:api )?key|invalid bearer token|expired (?:api )?key/i.test(errorMessage);
}

function isRetryablePollinationsModelError(errorMessage: string): boolean {
  return /HTTP (408|429|500|502|503|504)|SERVICE_UNAVAILABLE|service overloaded|rate limit|timeout|ECONNRESET|ETIMEDOUT|empty response/i.test(errorMessage);
}

function parseNvidiaApiKeys(primaryKey?: string, keyPool?: string): string[] {
  return Array.from(new Set([
    primaryKey,
    ...(keyPool || '').split(','),
  ]
    .map((key) => key?.trim())
    .filter((key): key is string => Boolean(key))));
}

type NvidiaFailureClass = 'authentication' | 'model' | 'throttled' | 'transient' | 'unknown';

class NvidiaHttpError extends Error {
  constructor(
    readonly status: number,
    readonly classification: NvidiaFailureClass,
    readonly retryAfterMs: number | undefined,
    readonly requestId: string | undefined,
    readonly responseSummary: string,
    model: string,
  ) {
    const suggestedFix = classification === 'throttled'
      ? 'Wait for the cooldown or check NVIDIA account quota.'
      : classification === 'authentication'
        ? 'Verify the NVIDIA API key and model access.'
        : classification === 'model'
          ? 'Verify the model id and API family for this endpoint.'
          : 'Retry through another eligible route or provider.';
    super(
      `Error: NVIDIA API request failed\n` +
      `Cause: HTTP ${status} (${classification}) from NVIDIA NIM\n` +
      `Suggested Fix: ${suggestedFix}\n` +
      `Context: Model: ${model}${requestId ? `, Request: ${requestId}` : ''}${retryAfterMs !== undefined ? `, Retry after: ${retryAfterMs}ms` : ''}${responseSummary ? `, Response: ${responseSummary}` : ''}`
    );
  }
}

function classifyNvidiaStatus(status: number, responseBody = ''): NvidiaFailureClass {
  if (status === 401 || status === 403) return 'authentication';
  if (status === 404) return 'model';
  if (status === 429 || /resource[_\s-]*exhausted|request\s+(?:limit|quota)[^\n]{0,80}(?:reached|exceeded)|quota\s+(?:is\s+)?(?:exhausted|exceeded)/i.test(responseBody)) {
    return 'throttled';
  }
  if (status === 202 || status === 408 || status >= 500) return 'transient';
  return 'unknown';
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const rawMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  if (!Number.isFinite(rawMs) || rawMs < 0) return undefined;
  return Math.ceil(rawMs);
}

function getNvidiaBackoffDelayMs(retryNumber: number): number {
  const baseMs = readPositiveInteger('REACT_ENGINE_NVIDIA_RETRY_BASE_MS', DEFAULT_NVIDIA_RETRY_BASE_MS);
  const maxMs = Math.max(
    baseMs,
    readPositiveInteger('REACT_ENGINE_NVIDIA_RETRY_MAX_MS', DEFAULT_NVIDIA_RETRY_MAX_MS),
  );
  const exponentialCap = Math.min(maxMs, baseMs * (2 ** Math.max(0, retryNumber - 1)));
  // Full jitter avoids synchronized retries when several free-tier requests are
  // released from a provider limit at the same time.
  return Math.floor(Math.random() * (exponentialCap + 1));
}

function redactProviderText(value: string, maxLength = 240): string {
  return value
    .replace(/(?:rqsty-sk-|sk-or-v1-|gsk_|nvapi|AIzaSy|AQ\.)[A-Za-z0-9._+\/-]+={0,2}/g, '[REDACTED]')
    .replace(/"(?:api[_-]?key|token|authorization|secret)"\s*:\s*"[^"]+"/gi, '"credential":"[REDACTED]"')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, maxLength);
}

function isStructuredRequestKind(requestKind: string | undefined): boolean {
  return requestKind === 'step.plan_action' || requestKind === 'step.check_done';
}

function getOpenRouterStructuredModel(): string {
  // The structured route is persisted in OpenRouter Settings. Loading the
  // targets keeps the selected route available for model-capability limits.
  getSavedOpenRouterModelTargets();
  return getConfiguredOpenRouterStructuredModel()
    || DEFAULT_OPENROUTER_STRUCTURED_MODEL;
}

function normalizeOpenRouterModelId(model: string): string {
  return model.trim().replace(/^openrouter:/i, '').trim();
}

export function resolveOpenRouterRequestModel(requestedModel: string, requestKind?: string): string {
  return requestedModel === OPENROUTER_DYNAMIC_FREE_MODEL && isStructuredRequestKind(requestKind)
    ? getOpenRouterStructuredModel()
    : requestedModel;
}

export function resolveOpenRouterMaxTokens(model: string, requestedMaxTokens?: number): number | undefined {
  const routeMinimum = model === OPENROUTER_DYNAMIC_FREE_MODEL
    ? OPENROUTER_DYNAMIC_FREE_MIN_OUTPUT_TOKENS
    : undefined;
  const configuredLimit = getOpenRouterModelTargetMaxTokens(model);
  const requested = Number.isFinite(requestedMaxTokens) && (requestedMaxTokens || 0) > 0
    ? Math.floor(requestedMaxTokens as number)
    : undefined;

  if (isOpenRouterOxAlphaModel(model)) {
    // The planner's maxTokens value is a generic visible-response budget. It
    // must not become Ox Alpha's total completion budget because OpenRouter
    // counts reasoning tokens inside max_tokens. The target/catalog value is
    // the authoritative model ceiling; use the known limit when an older
    // persisted target has not been populated yet.
    return configuredLimit ?? OPENROUTER_OX_ALPHA_DEFAULT_MAX_OUTPUT_TOKENS;
  }

  if (configuredLimit) {
    const minimum = routeMinimum ? Math.min(configuredLimit, routeMinimum) : 0;
    const desired = requested ?? configuredLimit;
    return Math.min(configuredLimit, Math.max(minimum, desired));
  }
  if (routeMinimum) return Math.max(requested || 0, routeMinimum);
  return requested;
}

function resolveOpenRouterRecoveryMaxTokens(model: string, requestedMaxTokens?: number): number {
  const requested = Number.isFinite(requestedMaxTokens) && (requestedMaxTokens || 0) > 0
    ? Math.min(Math.floor(requestedMaxTokens as number), OPENROUTER_RECOVERY_MAX_OUTPUT_TOKENS)
    : OPENROUTER_RECOVERY_MAX_OUTPUT_TOKENS;
  return resolveOpenRouterMaxTokens(model, requested)
    ?? OPENROUTER_RECOVERY_MAX_OUTPUT_TOKENS;
}

function getOpenRouterEmptyResponseFallbackModel(
  requestedModel: string,
): string | undefined {
  if (!isOpenRouterOxAlphaModel(requestedModel)) return undefined;

  // Do not use openrouter/free here. That route is intentionally random and
  // can select Ox Alpha again, reproducing the same empty-content response.
  // The configured structured route is deterministic and supports both text
  // recovery and tool-capable planner responses.
  const configured = normalizeOpenRouterModelId(getOpenRouterStructuredModel());
  if (
    configured
    && !isOpenRouterOxAlphaModel(configured)
    && configured.toLowerCase() !== OPENROUTER_DYNAMIC_FREE_MODEL
  ) {
    return configured;
  }

  // Keep a safe built-in escape hatch if the operator accidentally points the
  // structured route at Ox Alpha or the random free router itself.
  return DEFAULT_OPENROUTER_STRUCTURED_MODEL;
}


async function waitWithAbort(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0) return;
  await raceWithAbort(new Promise<void>((resolve) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
    };
    signal.addEventListener('abort', abort, { once: true });
    if (typeof (timer as any).unref === 'function') (timer as any).unref();
  }), signal);
}

function getOpenRouterRequestIntervalMs(options: LLMCompletionOptions | undefined): number {
  const configured = readRequestInterval('OPENROUTER_MIN_REQUEST_INTERVAL_MS');
  if (configured !== undefined) return configured;
  if (options?.pacingProfile === 'fast') return DEFAULT_OPENROUTER_REQUEST_INTERVAL_MS;
  if (!isFreeExecutionPacingEnabled(options)) return 0;

  const requestedInterval = Number.isFinite(options?.minimumRouteIntervalMs)
    ? Number(options?.minimumRouteIntervalMs)
    : 0;
  const profileInterval = getExecutionProfileProviderIntervalMs(options?.pacingProfile);
  return Math.max(
    profileInterval || DEFAULT_FREE_PROVIDER_REQUEST_INTERVAL_MS,
    Math.min(Math.floor(requestedInterval), 60_000),
  );
}

// Engine instances are intentionally independent, but OpenRouter's account
// quota is not. Serialize admission to the shared account-level pacing gate
// so simultaneous runs cannot all observe the same available slot.
let openRouterNextRequestAt = 0;
let openRouterPacingTail = Promise.resolve();

export function resetOpenRouterRequestScheduler(): void {
  openRouterNextRequestAt = 0;
  openRouterPacingTail = Promise.resolve();
}

async function waitForOpenRouterRequestSlot(
  options: LLMCompletionOptions | undefined,
  signal: AbortSignal,
): Promise<void> {
  const intervalMs = getOpenRouterRequestIntervalMs(options);
  if (intervalMs <= 0) return;

  const predecessor = openRouterPacingTail;
  let release: () => void = () => {};
  openRouterPacingTail = new Promise<void>((resolve) => {
    release = resolve;
  });

  try {
    await raceWithAbort(predecessor, signal);
    const delayMs = Math.max(0, openRouterNextRequestAt - Date.now());
    if (delayMs > 0) {
      options?.onPacingWait?.({
        delayMs,
        provider: 'openrouter',
        scope: 'request',
      });
      await waitWithAbort(delayMs, signal);
    }
    // Reserve the next slot before releasing the gate. A failed request still
    // consumes the spacing window, preventing an immediate retry burst.
    openRouterNextRequestAt = Date.now() + intervalMs;
  } finally {
    release();
  }
}

type NvidiaKeySchedule = {
  lastStartedAt: number;
  notBeforeAt: number;
};

type NvidiaQueuedRequest = {
  id: number;
  apiKey: string;
  model: string;
  options: LLMCompletionOptions | undefined;
  signal: AbortSignal;
  request: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  priority: number;
  enqueuedAt: number;
  concurrencyLimit: number;
  abort: () => void;
};

// NVIDIA provider objects are created per run. Keep scheduling state at module
// scope so simultaneous runs share concurrency, cooldown, and priority state.
const nvidiaKeySchedules = new Map<string, NvidiaKeySchedule>();
const nvidiaPendingRequests: NvidiaQueuedRequest[] = [];
const nvidiaActiveByKey = new Map<string, number>();
const nvidiaActiveByModel = new Map<string, number>();
// Key and route cooldown timestamps must also survive instance boundaries: a key
// throttled during task A must still be respected when task B creates a fresh
// NvidiaLLMProvider (e.g. from the engine's DI-container fallback constructor).
const nvidiaKeyCooldowns = new Map<string, number>();
const nvidiaRouteCooldowns = new Map<string, number>();
let nvidiaQueueSequence = 0;
let nvidiaDrainTimer: NodeJS.Timeout | undefined;
let nvidiaDrainAt = Number.POSITIVE_INFINITY;

function getNvidiaRequestIntervalMs(options: LLMCompletionOptions | undefined): number {
  if (options?.pacingProfile === 'fast') return 0;

  const configured = readRequestInterval('REACT_ENGINE_NVIDIA_MIN_REQUEST_INTERVAL_MS');
  if (configured !== undefined) return configured;

  const profileDefault = isFreeExecutionPacingEnabled(options)
    ? getExecutionProfileProviderIntervalMs(options?.pacingProfile) || DEFAULT_FREE_PROVIDER_REQUEST_INTERVAL_MS
    : options?.pacingProfile === 'conservative' || options?.pacingProfile === 'phased'
      ? CONSERVATIVE_NVIDIA_REQUEST_INTERVAL_MS
      : DEFAULT_NVIDIA_REQUEST_INTERVAL_MS;
  const requestedInterval = Number.isFinite(options?.minimumRouteIntervalMs)
    ? Number(options?.minimumRouteIntervalMs)
    : profileDefault;
  return Math.max(profileDefault, Math.min(Math.floor(requestedInterval), 60_000));
}

function getNvidiaQueuePriority(options: LLMCompletionOptions | undefined): number {
  if (Number.isFinite(options?.queuePriority)) {
    return Math.max(0, Math.min(100, Math.floor(Number(options?.queuePriority))));
  }
  if (options?.requestKind === 'step.plan_action' || options?.requestKind === 'step.check_done') return 90;
  if (options?.requestKind === 'final_answer.synthesize') return 80;
  if (options?.requestKind === 'plan.create') return 70;
  return 50;
}

function getNvidiaModelConcurrencyLimit(options: LLMCompletionOptions | undefined): number {
  const requested = options?.nvidiaMaxConcurrentRequestsPerModel;
  if (Number.isFinite(requested) && Number(requested) > 0) {
    return Math.max(1, Math.min(32, Math.floor(Number(requested))));
  }
  return Math.max(1, Math.min(32, readPositiveInteger(
    'REACT_ENGINE_NVIDIA_MAX_CONCURRENT_REQUESTS_PER_MODEL',
    DEFAULT_NVIDIA_MAX_CONCURRENT_REQUESTS_PER_MODEL,
  )));
}

function scheduleNvidiaDrain(delayMs: number): void {
  const wakeAt = Date.now() + Math.max(0, Math.ceil(delayMs));
  if (nvidiaDrainTimer && wakeAt >= nvidiaDrainAt) return;
  if (nvidiaDrainTimer) clearTimeout(nvidiaDrainTimer);
  nvidiaDrainAt = wakeAt;
  nvidiaDrainTimer = setTimeout(() => {
    nvidiaDrainTimer = undefined;
    nvidiaDrainAt = Number.POSITIVE_INFINITY;
    drainNvidiaQueue();
  }, Math.min(2_147_483_647, Math.max(0, wakeAt - Date.now())));
  if (typeof (nvidiaDrainTimer as any).unref === 'function') (nvidiaDrainTimer as any).unref();
}

function finishNvidiaRequest(entry: NvidiaQueuedRequest): void {
  const keyActive = Math.max(0, (nvidiaActiveByKey.get(entry.apiKey) || 1) - 1);
  const modelActive = Math.max(0, (nvidiaActiveByModel.get(entry.model) || 1) - 1);
  if (keyActive === 0) nvidiaActiveByKey.delete(entry.apiKey);
  else nvidiaActiveByKey.set(entry.apiKey, keyActive);
  if (modelActive === 0) nvidiaActiveByModel.delete(entry.model);
  else nvidiaActiveByModel.set(entry.model, modelActive);
  drainNvidiaQueue();
}

function startNvidiaRequest(entry: NvidiaQueuedRequest, schedule: NvidiaKeySchedule): void {
  entry.signal.removeEventListener('abort', entry.abort);
  schedule.lastStartedAt = Date.now();
  nvidiaActiveByKey.set(entry.apiKey, (nvidiaActiveByKey.get(entry.apiKey) || 0) + 1);
  nvidiaActiveByModel.set(entry.model, (nvidiaActiveByModel.get(entry.model) || 0) + 1);
  void Promise.resolve()
    .then(entry.request)
    .then(entry.resolve, entry.reject)
    .finally(() => finishNvidiaRequest(entry));
}

function drainNvidiaQueue(): void {
  if (nvidiaPendingRequests.length === 0) return;
  const now = Date.now();
  let nextWakeAt = Number.POSITIVE_INFINITY;
  let launched = true;

  while (launched) {
    launched = false;
    nvidiaPendingRequests.sort((left, right) => {
      const leftPriority = Math.min(100, left.priority + Math.floor((now - left.enqueuedAt) / NVIDIA_QUEUE_AGING_INTERVAL_MS));
      const rightPriority = Math.min(100, right.priority + Math.floor((now - right.enqueuedAt) / NVIDIA_QUEUE_AGING_INTERVAL_MS));
      return rightPriority - leftPriority || left.enqueuedAt - right.enqueuedAt || left.id - right.id;
    });

    for (let index = 0; index < nvidiaPendingRequests.length; index++) {
      const entry = nvidiaPendingRequests[index];
      if (entry.signal.aborted) {
        nvidiaPendingRequests.splice(index, 1);
        index--;
        entry.signal.removeEventListener('abort', entry.abort);
        entry.reject(entry.signal.reason || new Error('LLM request aborted'));
        continue;
      }

      if ((nvidiaActiveByKey.get(entry.apiKey) || 0) >= 1) continue;
      if ((nvidiaActiveByModel.get(entry.model) || 0) >= entry.concurrencyLimit) continue;

      const schedule = nvidiaKeySchedules.get(entry.apiKey)
        || { lastStartedAt: 0, notBeforeAt: 0 };
      if (!nvidiaKeySchedules.has(entry.apiKey)) nvidiaKeySchedules.set(entry.apiKey, schedule);
      const eligibleAt = Math.max(
        schedule.notBeforeAt,
        schedule.lastStartedAt + getNvidiaRequestIntervalMs(entry.options),
      );
      if (eligibleAt > now) {
        nextWakeAt = Math.min(nextWakeAt, eligibleAt);
        continue;
      }

      nvidiaPendingRequests.splice(index, 1);
      startNvidiaRequest(entry, schedule);
      launched = true;
      break;
    }
  }

  if (Number.isFinite(nextWakeAt)) scheduleNvidiaDrain(Math.max(0, nextWakeAt - Date.now()));
}

async function withNvidiaRequestSlot<T>(
  apiKey: string,
  model: string,
  options: LLMCompletionOptions | undefined,
  signal: AbortSignal,
  request: () => Promise<T>,
): Promise<T> {
  if (signal.aborted) throw signal.reason || new Error('LLM request aborted');
  const normalizedModel = normalizeNvidiaModelId(model);
  return await new Promise<T>((resolve, reject) => {
    const id = ++nvidiaQueueSequence;
    const abort = () => {
      const index = nvidiaPendingRequests.findIndex((entry) => entry.id === id);
      if (index < 0) return;
      nvidiaPendingRequests.splice(index, 1);
      signal.removeEventListener('abort', abort);
      reject(signal.reason || new Error('LLM request aborted'));
      drainNvidiaQueue();
    };
    const entry: NvidiaQueuedRequest = {
      id,
      apiKey,
      model: normalizedModel,
      options,
      signal,
      request,
      resolve: (value) => resolve(value as T),
      reject,
      priority: getNvidiaQueuePriority(options),
      enqueuedAt: Date.now(),
      concurrencyLimit: getNvidiaModelConcurrencyLimit(options),
      abort,
    };
    signal.addEventListener('abort', abort, { once: true });
    nvidiaPendingRequests.push(entry);
    drainNvidiaQueue();
  });
}

function deferNvidiaRequestSlot(apiKey: string, delayMs: number): void {
  const existing = nvidiaKeySchedules.get(apiKey);
  const schedule = existing || { lastStartedAt: 0, notBeforeAt: 0 };
  schedule.notBeforeAt = Math.max(schedule.notBeforeAt, Date.now() + Math.max(0, delayMs));
  if (!existing) nvidiaKeySchedules.set(apiKey, schedule);
  drainNvidiaQueue();
}

/** @internal Test isolation for the process-wide NVIDIA request scheduler. */
export function resetNvidiaRequestScheduler(): void {
  if (nvidiaDrainTimer) clearTimeout(nvidiaDrainTimer);
  nvidiaDrainTimer = undefined;
  nvidiaDrainAt = Number.POSITIVE_INFINITY;
  const pending = nvidiaPendingRequests.splice(0);
  for (const entry of pending) {
    entry.signal.removeEventListener('abort', entry.abort);
    entry.reject(new Error('NVIDIA request scheduler reset'));
  }
  nvidiaKeySchedules.clear();
  nvidiaActiveByKey.clear();
  nvidiaActiveByModel.clear();
  nvidiaKeyCooldowns.clear();
  nvidiaRouteCooldowns.clear();
  nvidiaQueueSequence = 0;
}

interface ChatCompletionEventStreamResult {
  text: string;
  model?: string;
  finishReason?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

async function readChatCompletionEventStream(
  response: Response,
  options?: LLMCompletionOptions,
  signal?: AbortSignal,
): Promise<ChatCompletionEventStreamResult> {
  if (!response.body) throw new Error('Provider stream had no response body');

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let buffer = '';
  let model: string | undefined;
  let finishReason: string | undefined;
  let usage: ChatCompletionEventStreamResult['usage'];

  const processPayload = (payload: string) => {
    if (!payload || payload === '[DONE]') return;
    let data: any;
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }

    if (typeof data.model === 'string' && data.model) model = data.model;
    const choice = data.choices?.[0];
    const delta = choice?.delta?.content;
    if (typeof delta === 'string' && delta) {
      chunks.push(delta);
      options?.onStreamEvent?.({ type: 'text_delta', delta });
    }
    if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;

    const streamUsage = data.usage;
    if (streamUsage && typeof streamUsage === 'object') {
      const nextUsage = {
        prompt_tokens: Number.isFinite(Number(streamUsage.prompt_tokens)) ? Number(streamUsage.prompt_tokens) : undefined,
        completion_tokens: Number.isFinite(Number(streamUsage.completion_tokens)) ? Number(streamUsage.completion_tokens) : undefined,
        total_tokens: Number.isFinite(Number(streamUsage.total_tokens)) ? Number(streamUsage.total_tokens) : undefined,
      };
      if (Object.values(nextUsage).some((value) => value !== undefined)) {
        usage = nextUsage;
        options?.onStreamEvent?.({
          type: 'usage',
          usage: {
            inputTokens: nextUsage.prompt_tokens,
            outputTokens: nextUsage.completion_tokens,
            totalTokens: nextUsage.total_tokens,
          },
        });
      }
    }
  };

  const processLines = (lines: string[]) => {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) processPayload(trimmed.slice('data:'.length).trim());
    }
  };

  const reader = response.body.getReader();
  try {
    while (true) {
      const next = signal ? await raceWithAbort(reader.read(), signal) : await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      processLines(lines);
    }
    buffer += decoder.decode();
    processLines(buffer.split(/\r?\n/));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  return { text: chunks.join(''), ...(model ? { model } : {}), ...(finishReason ? { finishReason } : {}), ...(usage ? { usage } : {}) };
}

async function readNvidiaStream(
  response: Response,
  options?: LLMCompletionOptions,
  signal?: AbortSignal,
): Promise<string> {
  return (await readChatCompletionEventStream(response, options, signal)).text;
}

function isOpenRouterOxAlphaModel(model: string): boolean {
  const normalized = normalizeOpenRouterModelId(model).toLowerCase();
  return normalized === OPENROUTER_OX_ALPHA_MODEL;
}

function isOpenRouterMandatoryReasoningModel(model: string): boolean {
  const normalized = normalizeOpenRouterModelId(model).toLowerCase();
  return (
    isOpenRouterOxAlphaModel(normalized) ||
    /gemma-4/i.test(normalized) ||
    /deepseek-r1/i.test(normalized) ||
    /qwq/i.test(normalized)
  );
}

function mapOxAlphaReasoningEffort(effort: LLMReasoningOptions['effort']): 'low' | 'high' | 'max' {
  if (effort === 'low' || effort === 'minimal') return 'low';
  if (effort === 'high' || effort === 'medium') return 'high';
  return 'max';
}

function buildOpenRouterReasoningPayload(
  reasoning?: LLMReasoningOptions,
  model?: string,
): Record<string, unknown> | undefined {
  // Models with mandatory reasoning reject requests without reasoning or with enabled: false.
  if (model && isOpenRouterOxAlphaModel(model)) {
    return {
      effort: mapOxAlphaReasoningEffort(reasoning?.effort),
      ...(reasoning?.exclude !== undefined ? { exclude: reasoning.exclude } : {}),
    };
  }
  if (model && isOpenRouterMandatoryReasoningModel(model)) {
    return {
      effort: reasoning?.effort || 'minimal',
      exclude: reasoning?.exclude ?? true,
      ...(reasoning?.maxTokens ? { max_tokens: reasoning.maxTokens } : {}),
      ...(reasoning?.summary ? { summary: reasoning.summary } : {}),
    };
  }
  if (!reasoning) return undefined;
  return {
    ...(reasoning.effort ? { effort: reasoning.effort } : {}),
    ...(reasoning.maxTokens ? { max_tokens: reasoning.maxTokens } : {}),
    ...(reasoning.summary ? { summary: reasoning.summary } : {}),
    ...(reasoning.exclude !== undefined ? { exclude: reasoning.exclude } : {}),
  };
}

function isGeminiThinkingModel(model: string): boolean {
  return /gemini-(?:2\.5|3(?:\.[0-9]+)?|[4-9](?:\.[0-9]+)?)(?:[-.:]|$)/i.test(model);
}

function isGeminiThreeOrLaterModel(model: string): boolean {
  return /gemini-(?:3(?:\.[0-9]+)?|[4-9](?:\.[0-9]+)?)(?:[-.:]|$)/i.test(model);
}

function mapGeminiThinkingLevel(effort: LLMReasoningOptions['effort']): 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH' {
  if (effort === 'minimal') return 'MINIMAL';
  if (effort === 'low') return 'LOW';
  if (effort === 'high' || effort === 'xhigh' || effort === 'max') return 'HIGH';
  return 'MEDIUM';
}

function mapGeminiThinkingBudget(effort: LLMReasoningOptions['effort']): number {
  if (effort === 'none') return 0;
  if (effort === 'minimal') return 256;
  if (effort === 'low') return 1_024;
  if (effort === 'high') return 4_096;
  if (effort === 'xhigh' || effort === 'max') return 8_192;
  return 2_048;
}

function getGeminiThinkingConfig(
  model: string,
  reasoning?: LLMReasoningOptions,
): Record<string, unknown> | undefined {
  if (!reasoning || !isGeminiThinkingModel(model)) return undefined;

  // Gemini 3+ uses named thinking levels. Gemini 2.5 uses a token budget;
  // older Gemini models deliberately receive no unsupported thinking field.
  if (isGeminiThreeOrLaterModel(model)) {
    return {
      includeThoughts: false,
      thinkingLevel: mapGeminiThinkingLevel(reasoning.effort),
    };
  }

  return {
    includeThoughts: false,
    thinkingBudget: reasoning.maxTokens ?? mapGeminiThinkingBudget(reasoning.effort),
  };
}

function reportSafeReasoningSummary(
  options: LLMCompletionOptions | undefined,
  data: any,
  text: string,
  provider: string,
  model: string,
): void {
  let reasoningSummary = extractSafeReasoningSummary(data);
  const message = data?.choices?.[0]?.message;
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  let promptPrefillDurationMs: number | undefined;
  if (data?.timings?.prompt_ms !== undefined && Number.isFinite(Number(data.timings.prompt_ms))) {
    promptPrefillDurationMs = Math.round(Number(data.timings.prompt_ms));
  } else if (data?.prompt_eval_duration !== undefined && Number.isFinite(Number(data.prompt_eval_duration))) {
    promptPrefillDurationMs = Math.round(Number(data.prompt_eval_duration) / 1_000_000);
  }
  const streamUsage = data?.usage;
  const usage: LLMUsage | undefined = streamUsage && typeof streamUsage === 'object' ? {
    inputTokens: Number.isFinite(Number(streamUsage.prompt_tokens)) ? Number(streamUsage.prompt_tokens) : undefined,
    outputTokens: Number.isFinite(Number(streamUsage.completion_tokens)) ? Number(streamUsage.completion_tokens) : undefined,
    totalTokens: Number.isFinite(Number(streamUsage.total_tokens)) ? Number(streamUsage.total_tokens) : undefined,
  } : undefined;
  if (!reasoningSummary && toolCalls.length === 0 && !options?.onCompletionResult && promptPrefillDurationMs === undefined && !usage) return;
  reportCompletionResult(options, {
    text,
    toolCalls,
    ...(reasoningSummary ? { reasoningSummary } : {}),
    ...(usage ? { usage } : {}),
    ...(promptPrefillDurationMs !== undefined ? { promptPrefillDurationMs } : {}),
    provider,
    model,
    finishReason: typeof data?.choices?.[0]?.finish_reason === 'string'
      ? data.choices[0].finish_reason
      : undefined,
  });
}

function openRouterUsageFrom(value: any): LLMUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const inputTokens = Number(value.prompt_tokens);
  const outputTokens = Number(value.completion_tokens);
  const totalTokens = Number(value.total_tokens);
  const usage: LLMUsage = {
    inputTokens: Number.isFinite(inputTokens) && inputTokens >= 0 ? inputTokens : undefined,
    outputTokens: Number.isFinite(outputTokens) && outputTokens >= 0 ? outputTokens : undefined,
    totalTokens: Number.isFinite(totalTokens) && totalTokens >= 0 ? totalTokens : undefined,
  };
  return Object.values(usage).some((entry) => entry !== undefined) ? usage : undefined;
}

function estimateOpenRouterInputTokens(
  messages: Array<{ role: string; content: string }>,
  options?: LLMCompletionOptions,
): number {
  const messageCharacters = messages.reduce(
    (total, message) => total + message.role.length + message.content.length,
    0,
  );
  const toolCharacters = options?.tools?.length
    ? JSON.stringify(options.tools).length + JSON.stringify(options.toolChoice || 'auto').length
    : 0;
  // This is only the pre-response fallback estimate. OpenRouter's usage field
  // replaces it whenever the provider returns prompt_tokens.
  return Math.max(1, Math.ceil((messageCharacters + toolCharacters) / 4) + (messages.length * 8));
}

type OpenRouterContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

const OPENROUTER_IMAGE_MARKDOWN_RE = /!\[[^\]]*\]\((data:image\/[a-z0-9+.-]+;base64,[A-Za-z0-9+/=]+)\)/gi;
const OPENROUTER_IMAGE_DATA_RE = /data:image\/[a-z0-9+.-]+;base64,[A-Za-z0-9+/=]+/gi;

function openRouterModelSupportsVision(model: string): boolean {
  const target = getOpenRouterModelTarget(model);
  const knownMetadata = getOpenRouterKnownModelMetadata(model);
  return target?.supportsVision
    ?? knownMetadata?.supportsVision
    ?? target?.inputModalities?.some((modality) => /^(?:image|video)$/i.test(modality))
    ?? knownMetadata?.inputModalities?.some((modality) => /^(?:image|video)$/i.test(modality))
    ?? false;
}

function openRouterMessageContent(
  content: string,
  model: string,
): string | OpenRouterContentPart[] {
  if (!content.includes('data:image/')) return content;
  if (!openRouterModelSupportsVision(model)) {
    throw new Error(
      `OpenRouter model "${model}" is not configured for image input. Enable "image/video input" for this route in Settings > OpenRouter, or choose a vision-capable model.`,
    );
  }

  const imageUrls: string[] = [];
  const addImage = (value: string) => {
    if (!imageUrls.includes(value)) imageUrls.push(value);
  };
  let text = content.replace(OPENROUTER_IMAGE_MARKDOWN_RE, (_match, url: string) => {
    addImage(url);
    return '';
  });
  text = text.replace(OPENROUTER_IMAGE_DATA_RE, (url: string) => {
    addImage(url);
    return '';
  }).trim();

  if (imageUrls.length === 0) return content;
  const parts: OpenRouterContentPart[] = [];
  if (text) parts.push({ type: 'text', text });
  imageUrls.forEach((url) => parts.push({ type: 'image_url', image_url: { url } }));
  return parts;
}

function supportsNvidiaReasoningEffort(model: string): boolean {
  // NVIDIA documents reasoning_effort for GPT-OSS models deployed through the
  // multi-LLM NIM. Do not send this parameter to GLM-5.2 or arbitrary custom
  // routes because unsupported request fields can make an otherwise valid
  // chat-completions request fail.
  return /(?:^|[/:_-])gpt[-_]?oss(?:[/:_-]|$)/i.test(model);
}

function mapNvidiaReasoningEffort(effort: LLMReasoningOptions['effort']): 'low' | 'medium' | undefined {
  if (!effort || effort === 'none') return undefined;
  return effort === 'minimal' || effort === 'low' ? 'low' : 'medium';
}

function parseNvidiaChatCompletionJson(data: any): string {
  const message = data?.choices?.[0]?.message;
  const content = message?.content ?? data?.choices?.[0]?.delta?.content;
  if (typeof content === 'string' && content.trim()) {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
      })
      .join('');
    if (text.trim()) return text;
  }

  // The shared LLM interface returns text, but NVIDIA-compatible endpoints
  // can still emit an OpenAI-style native tool call. Preserve that envelope so
  // the planner's existing tool-call normalizer can validate it instead of
  // treating a valid API response as empty.
  if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
    return JSON.stringify({
      role: typeof message.role === 'string' ? message.role : 'assistant',
      tool_calls: message.tool_calls,
    });
  }

  return '';
}

/**
 * Pollinations LLM Provider
 * Wraps the existing pollinationsClient
 */
export class PollinationsLLMProvider implements LLMProvider {
  private apiKey: string | undefined;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || getRuntimePollinationsApiKey() || process.env.POLLINATIONS_API_KEY;
    if (this.apiKey) {
      pollinationsClient.setApiKey(this.apiKey);
    }
  }

  async createChatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options?: LLMCompletionOptions
  ): Promise<string> {
    const normalizedMessages = messages.map((message) => ({
      role: message.role === 'assistant' || message.role === 'system' ? message.role : 'user',
      content: message.content,
    })) as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;

    const { budget, owned: ownsBudget } = getRequestBudget(options);
    const pollinationsMinAttemptMs = readPositiveInteger(
      'REACT_ENGINE_POLLINATIONS_MIN_ATTEMPT_MS',
      POLLINATIONS_MIN_ATTEMPT_MS,
    );
    const requestedProviderModel = getProviderModel(this.getProviderName(), model);
    const fullModelRotation = options?.pinModel
      ? [requestedProviderModel]
      : getPollinationsModelRotation(requestedProviderModel);
    const timeCapacity = Number.isFinite(budget.remainingMs())
      ? Math.max(0, Math.floor(budget.remainingMs() / pollinationsMinAttemptMs))
      : fullModelRotation.length;
    const budgetCapacity = Math.min(timeCapacity, budget.remainingRequests());
    const modelRotation = fullModelRotation.slice(0, budgetCapacity);
    const errors: string[] = [];
    let sawRetryableError = false;

    try {
    if (modelRotation.length === 0) {
      throw new Error(`Pollinations attempts skipped_budget: less than ${pollinationsMinAttemptMs}ms remains`);
    }
    for (const currentModel of modelRotation) {
      if (budget.signal.aborted) throw budget.signal.reason || new Error('LLM request aborted');
      const request = {
        messages: normalizedMessages,
        model: currentModel,
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
        reasoning_effort: options?.reasoning?.effort,
      };

      try {
        consumeRequestBudget(budget, 'pollinations', currentModel);
        const result = await pollinationsClient.chatCompletion({ ...request, signal: budget.signal });
        if (result.content?.trim()) {
          return result.content;
        }

        throw new Error(
          `Error: Pollinations API returned empty response\n` +
            `Cause: Chat completion response had no usable content\n` +
            `Suggested Fix: ${options?.pinModel ? 'Retry the selected model or choose another model explicitly' : 'Retry with a fallback model'}\n` +
            `Context: Model: ${currentModel}`
        );
      } catch (error) {
        if (options?.signal?.aborted || budget.signal.aborted) throw options?.signal?.reason || budget.signal.reason || error;
        const message = error instanceof Error ? error.message : String(error);
        if (isPollinationsCredentialFailure(message)) {
          throw new Error(
            `Error: Pollinations authentication failed\n` +
              `Cause: The configured POLLINATIONS_API_KEY was rejected by Pollinations.\n` +
              `Suggested Fix: Replace POLLINATIONS_API_KEY with a current key from https://enter.pollinations.ai/keys, then restart the server.`
          );
        }
        errors.push(`${currentModel}: ${message}`);
        const isRetryable = isRetryablePollinationsModelError(message);
        sawRetryableError ||= isRetryable;

        // Pinned model requests must remain exact. Only an unpinned
        // Pollinations request may use the public transport fallback.
        if (!options?.pinModel && shouldUsePublicPollinationsFallback(message)) {
          const publicFallbackModel = POLLINATIONS_PUBLIC_FALLBACK_MODEL;
          try {
            consumeRequestBudget(budget, 'pollinations', publicFallbackModel);
            const publicResult = await new PollinationsClient(null).chatCompletion({
              ...request,
              model: publicFallbackModel,
              signal: budget.signal,
            });
            if (!publicResult.content?.trim()) {
              throw new Error(
                `Error: Pollinations public fallback returned empty response\n` +
                  `Cause: Public chat completion response had no usable content\n` +
                  `Suggested Fix: Try again shortly\n` +
                  `Context: Model: ${publicFallbackModel}`
              );
            }
            return publicResult.content;
          } catch (publicError) {
            const publicMessage = publicError instanceof Error ? publicError.message : String(publicError);
            // Keep the authenticated failure in the final diagnosis. A
            // failed public fallback must not hide an invalid key, suspended
            // account, or inaccessible authenticated route behind its own
            // 401/402 response.
            errors.push(
              `${currentModel}: authenticated request failed: ${message}; ` +
                `public fallback ${publicFallbackModel} failed: ${publicMessage}`,
            );
          }
        }

        if (!isRetryable) {
          break;
        }
      }
    }

    if (sawRetryableError && !options?.pinModel) {
      try {
        const publicFallbackModel = POLLINATIONS_PUBLIC_FALLBACK_MODEL;
        consumeRequestBudget(budget, 'pollinations', publicFallbackModel);
        const publicResult = await new PollinationsClient(null).chatCompletion({
          messages: normalizedMessages,
          model: publicFallbackModel,
          temperature: options?.temperature,
          max_tokens: options?.maxTokens,
          signal: budget.signal,
        });
        if (!publicResult.content?.trim()) {
          throw new Error(
            `Error: Pollinations public fallback returned empty response\n` +
              `Cause: Public chat completion response had no usable content\n` +
              `Suggested Fix: Try again shortly\n` +
              `Context: Model: ${publicFallbackModel}`
          );
        }
        return publicResult.content;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`public:${POLLINATIONS_PUBLIC_FALLBACK_MODEL}: ${message}`);
      }
    }

    const pinnedRequest = options?.pinModel === true;
    throw new Error(
      `Error: ${pinnedRequest ? 'Pollinations model request failed' : 'Pollinations model rotation failed'}\n` +
        `Cause: ${pinnedRequest ? 'The selected model failed; pinned requests do not use fallback models' : 'All fallback models failed or the last error was non-retryable'}\n` +
        `Suggested Fix: ${pinnedRequest ? 'Check access to the selected model and POLLINATIONS_API_KEY, then retry' : `Try again shortly, or choose one of: ${POLLINATIONS_GENERAL_FALLBACK_MODELS.join(', ')}`}\n` +
        `Context: Requested model: ${model}, Attempted: ${modelRotation.join(', ')}, Errors: ${errors.map((err) => err.substring(0, 180)).join(' | ')}`
    );
    } finally {
      if (ownsBudget) budget.cleanup();
    }
  }

  estimateStepCost(model: string): number {
    // Simplified estimation: average cost per step
    const modelCosts: Record<string, number> = {
      'openai-fast': 0.00001,
      'openai': 0.00001,
      'gpt-oss': 0.00001,
      'gpt-oss-20b': 0.00001,
      'flux': 0.00002,
    };
    return modelCosts[model] || 0.00001;
  }

  getProviderName(): string {
    return 'pollinations';
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey || getRuntimePollinationsApiKey());
  }
}

function retryAfterMsFromError(error: unknown): number | undefined {
  const text = error instanceof Error ? error.message : String(error);
  const match = text.match(/retry[- ]after\s*[:=]?\s*(\d+(?:\.\d+)?)(?:\s*ms|\s*s)?/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  return /ms/i.test(match[0]) ? Math.max(0, Math.floor(value)) : Math.max(0, Math.floor(value * 1000));
}

/**
 * Gemini provider with explicit account profiles and profile-scoped queues.
 * Legacy ApiKeyPool input is converted to named profiles; it is never rotated.
 */
export class GeminiLLMProvider implements LLMProvider {
  private apiKey: string | undefined;
  private profileRegistry: GeminiProfileRegistry;
  private profileScheduler: GeminiProfileScheduler;
  private readonly usesLegacyApiKeyPool: boolean;
  private clients: Map<string, any> = new Map();

  constructor(
    apiKey?: string,
    apiKeyPool?: ApiKeyPool,
    profileRegistry?: GeminiProfileRegistry,
    profileScheduler: GeminiProfileScheduler = geminiProfileScheduler,
  ) {
    this.usesLegacyApiKeyPool = Boolean(apiKeyPool);
    const legacyProfiles: GeminiAccountProfile[] = apiKeyPool
      ? apiKeyPool.getMetrics().map((metric, index) => ({
        id: `legacy-${index + 1}`,
        label: `Legacy Gemini Account ${index + 1}`,
        purpose: 'legacy-explicit-selection',
        apiKey: metric.key,
        enabled: true,
        envVar: 'LEGACY_API_KEY_POOL',
      }))
      : [];
    this.profileRegistry = profileRegistry || (
      legacyProfiles.length > 0
        ? new GeminiProfileRegistry(legacyProfiles)
        : apiKey
          ? new GeminiProfileRegistry([{
            id: 'default', label: 'Gemini Default Account', purpose: 'general',
            apiKey, enabled: true, envVar: 'GEMINI_API_KEY',
          }])
          : getGeminiProfileRegistry()
    );
    this.profileScheduler = apiKeyPool
      ? new GeminiProfileScheduler({ maxConcurrentRequests: 1, persist: false })
      : profileScheduler;
    if (apiKeyPool) {
      const metrics = apiKeyPool.getMetrics();
      if (metrics.length > 0) {
        this.apiKey = metrics[0].key;
      }
    } else {
      // Single key fallback
      this.apiKey = apiKey || getRuntimeGeminiApiKey() || process.env.GEMINI_API_KEY;
      if (!this.apiKey) {
        this.apiKey = parseGeminiRuntimeKeys()[0];
      }
    }
  }

  getProfileSummaries() {
    return this.profileRegistry.summaries();
  }

  getProfileHealth() {
    return this.profileRegistry.list().map((profile) => ({
      id: profile.id,
      label: profile.label,
      purpose: profile.purpose,
      enabled: profile.enabled,
      scheduler: this.profileScheduler.getStatus(profile.id)[0],
    }));
  }

  getApiKeyCount(): number {
    return this.profileRegistry.list().length;
  }

  hasKeyAtIndex(index: number): boolean {
    if (!Number.isInteger(index) || index < 0) return false;
    return index < this.profileRegistry.list().length;
  }

  /**
   * Get or create Gemini client for specific API key
   */
  private async getClient(apiKey: string) {
    if (this.clients.has(apiKey)) {
      return this.clients.get(apiKey);
    }

    try {
      const { GoogleGenAI } = await import('@google/genai');
      const client = new GoogleGenAI({ apiKey });
      this.clients.set(apiKey, client);
      return client;
    } catch (error) {
      throw new Error('Failed to initialize Gemini client: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  /** Create a completion under one explicitly resolved account profile. */
  async createChatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options?: LLMCompletionOptions
  ): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('Gemini API key not configured');
    }

    return this.createProfileChatCompletion(messages, model, options);
  }

  private resolveProfile(model: string, options?: LLMCompletionOptions): GeminiAccountProfile {
    const target = resolveGeminiModelTarget(model);
    const requestedId = options?.geminiProfileId || target?.profileId;
    if (requestedId) {
      const selected = this.profileRegistry.get(requestedId);
      if (selected) return selected;
      // Legacy ApiKeyPool callers persisted profile IDs from the runtime
      // account registry, while the compatibility provider names its slots
      // legacy-1, legacy-2, etc. Preserve the target's explicit slot only in
      // that compatibility mode; named provider profiles remain fail-closed.
      if (this.usesLegacyApiKeyPool && !options?.geminiProfileId && target?.apiKeyIndex !== undefined) {
        const indexed = this.profileRegistry.list()[target.apiKeyIndex];
        if (indexed) return indexed;
      }
      throw new Error(`Gemini profile "${requestedId}" is not configured or enabled`);
    }
    if (options?.geminiApiKeyIndex !== undefined) {
      const selected = this.profileRegistry.list()[options.geminiApiKeyIndex];
      if (!selected) throw new Error(`Gemini profile index ${options.geminiApiKeyIndex} is not configured or enabled`);
      return selected;
    }
    if (target?.apiKeyIndex !== undefined) {
      const selected = this.profileRegistry.list()[target.apiKeyIndex];
      if (selected) return selected;
    }
    const selected = this.profileRegistry.get();
    if (!selected) throw new Error('Gemini account profile is not configured');
    return selected;
  }

  private async createProfileChatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options?: LLMCompletionOptions,
  ): Promise<string> {
    const target = resolveGeminiModelTarget(model);
    const profile = this.resolveProfile(model, options);
    const currentModel = target?.modelId || model;
    const supportsSamplingParameters = supportsGeminiSamplingParameters(currentModel);
    const prepared = prepareGeminiMessages(messages, { model: currentModel });
    const fingerprint = createGeminiRequestFingerprint({
      workspaceId: options?.workspaceId || 'unscoped-workspace',
      repositoryCommitHash: options?.repositoryCommitHash || 'unknown-commit',
      userId: options?.userId || 'local-user',
      profileId: profile.id,
      model: currentModel,
      messages: prepared.messages,
      settings: {
        temperature: supportsSamplingParameters ? options?.temperature ?? target?.temperature : undefined,
        maxTokens: options?.maxTokens ?? target?.maxTokens,
        topP: supportsSamplingParameters ? options?.topP ?? target?.topP : undefined,
        reasoning: options?.reasoning,
        tools: options?.tools,
      },
      toolSchemaVersion: options?.toolSchemaVersion,
    });
    const safeCacheKind = /summary|classification|architecture|compression|review/i.test(options?.requestKind || '');
    const cacheable = options?.cacheable === true || safeCacheKind;
    const cached = cacheable ? getCachedGeminiResponse(fingerprint) : undefined;
    if (cached !== undefined) {
      emitTelemetry(options, {
        provider: 'gemini', profileId: profile.id, model: currentModel,
        requestKind: options?.requestKind, startedAt: Date.now(), durationMs: 0,
        status: 'succeeded', keyLabel: profile.label, cacheHit: true,
        estimatedInputTokens: prepared.estimatedInputTokens,
        estimatedOutputTokens: Math.ceil(cached.length / 4),
      });
      return cached;
    }

    return runDeduplicatedGeminiRequest(
      fingerprint,
      () => this.executeProfileChatCompletion(prepared.messages, model, profile, prepared.estimatedInputTokens, options),
      {
        cacheResult: cacheable,
        cacheReference: cacheable
          ? {
              workspaceId: options?.workspaceId || 'unscoped-workspace',
              repositoryCommitHash: options?.repositoryCommitHash || 'unknown-commit',
              userId: options?.userId || 'local-user',
              profileId: profile.id,
              model: currentModel,
            }
          : undefined,
      },
    );
  }

  private async executeProfileChatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string,
    profile: GeminiAccountProfile,
    estimatedInputTokens: number,
    options?: LLMCompletionOptions,
  ): Promise<string> {
    const { budget, owned: ownsBudget } = getRequestBudget(options);
    const target = resolveGeminiModelTarget(model);
    const currentModel = target?.modelId || model;
    const supportsSamplingParameters = supportsGeminiSamplingParameters(currentModel);
    const minimumAttemptMs = Math.max(
      GEMINI_MIN_ATTEMPT_MS,
      readPositiveInteger('REACT_ENGINE_GEMINI_MIN_ATTEMPT_MS', GEMINI_MIN_ATTEMPT_MS),
    );
    const configuredMax = process.env.REACT_ENGINE_GEMINI_MAX_ATTEMPTS
      ? readPositiveInteger('REACT_ENGINE_GEMINI_MAX_ATTEMPTS', 4)
      : readPositiveInteger('REACT_ENGINE_GEMINI_MAX_RETRIES', 3) + 1;
    const maxAttempts = Math.max(1, Math.min(configuredMax, budget.remainingRequests()));
    let lastError: unknown;

    try {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (budget.signal.aborted) throw budget.signal.reason || new Error('LLM request aborted');
        if (!budgetCanFit(budget, minimumAttemptMs)) break;
        const remaining = budget.remainingMs();
        const attemptsLeft = maxAttempts - attempt;
        const attemptTimeoutMs = Number.isFinite(remaining)
          ? Math.min(Math.floor(remaining), Math.max(minimumAttemptMs, Math.floor(remaining / attemptsLeft)))
          : undefined;
        const deadline = createAttemptDeadline(budget.signal, attemptTimeoutMs);
        const startedAt = Date.now();
        try {
          const response: any = await this.profileScheduler.run(
            profile.id,
            async () => {
              consumeRequestBudget(budget, 'gemini', currentModel);
              const client = await this.getClient(profile.apiKey);
              return raceWithAbort<any>(client.models.generateContent({
                model: currentModel,
                contents: messages.map((msg) => ({
                  role: msg.role === 'assistant' ? 'model' : 'user',
                  parts: [{ text: msg.content }],
                })),
                config: {
                  ...(supportsSamplingParameters
                    ? { temperature: options?.temperature ?? target?.temperature }
                    : {}),
                  maxOutputTokens: options?.maxTokens ?? target?.maxTokens,
                  ...(supportsSamplingParameters
                    ? { topP: options?.topP ?? target?.topP }
                    : {}),
                  ...(getGeminiThinkingConfig(currentModel, options?.reasoning)
                    ? { thinkingConfig: getGeminiThinkingConfig(currentModel, options?.reasoning) }
                    : {}),
                  abortSignal: deadline.signal,
                  httpOptions: attemptTimeoutMs && attemptTimeoutMs >= GEMINI_MIN_ATTEMPT_MS
                    ? { timeout: attemptTimeoutMs }
                    : undefined,
                },
              }), deadline.signal);
            },
            {
              priority: options?.queuePriority,
              signal: budget.signal,
              minIntervalMs: getGeminiRequestIntervalMs(options),
              onPacingWait: (delayMs) => {
                try {
                  options?.onPacingWait?.({
                    delayMs,
                    provider: 'gemini',
                    model: currentModel,
                    scope: 'request',
                  });
                } catch {
                  // Pacing telemetry must never affect provider execution.
                }
              },
            },
          );
          this.profileScheduler.recordSuccess(profile.id);
          const responseText = String(response.text || '');
          const reasoningSummary = extractSafeReasoningSummary(response);
          reportCompletionResult(options, {
            text: responseText,
            toolCalls: [],
            ...(reasoningSummary ? { reasoningSummary } : {}),
            provider: 'gemini',
            model: currentModel,
          });
          emitTelemetry(options, {
            provider: 'gemini', profileId: profile.id, model: currentModel, requestKind: options?.requestKind,
            startedAt, durationMs: Date.now() - startedAt, status: 'succeeded',
            attempt: attempt + 1, keyLabel: profile.label,
            allocatedBudgetMs: attemptTimeoutMs, remainingBudgetMs: Math.floor(budget.remainingMs()),
            estimatedInputTokens,
            estimatedOutputTokens: Math.ceil(responseText.length / 4),
            retry: attempt > 0,
          });
          return responseText;
        } catch (error) {
          if (options?.signal?.aborted) throw options.signal.reason || error;
          lastError = deadline.timedOut()
            ? new Error(`Gemini profile ${profile.id} request timed out after ${attemptTimeoutMs}ms`)
            : error;
          const errorInfo = parseGeminiError(lastError);
          const normalizedError = classifyGeminiProviderError(lastError, profile.id);
          const retryAfter = retryAfterMsFromError(lastError);
          this.profileScheduler.recordFailure(
            profile.id,
            errorInfo.type,
            retryAfter ? Date.now() + retryAfter : errorInfo.resetTime?.getTime(),
          );
          const retryable = normalizedError.retryable;
          emitTelemetry(options, {
            provider: 'gemini', profileId: profile.id, model: currentModel, requestKind: options?.requestKind,
            startedAt, durationMs: Date.now() - startedAt,
            status: deadline.timedOut() ? 'timed_out' : 'failed', attempt: attempt + 1,
            keyLabel: profile.label, allocatedBudgetMs: attemptTimeoutMs,
            remainingBudgetMs: Math.floor(budget.remainingMs()),
            classification: normalizedError.code.toLowerCase(),
            fallbackDecision: retryable && attempt < maxAttempts - 1 ? 'retry_same_profile' : 'next_provider',
            error: normalizedError.safeMessage,
            estimatedInputTokens,
            retry: attempt > 0,
          });
          if (!retryable || attempt >= maxAttempts - 1) break;
          const exponential = Math.min(30_000, 2_000 * (2 ** attempt));
          const requestedDelay = retryAfter !== undefined
            ? Math.max(retryAfter, exponential)
            : exponential;
          const jitteredDelay = requestedDelay + Math.floor(Math.random() * Math.max(1, Math.min(500, requestedDelay * 0.25)));
          await waitWithAbort(jitteredDelay, budget.signal);
        } finally {
          deadline.cleanup();
        }
      }
    } finally {
      if (ownsBudget) budget.cleanup();
    }

    const finalError = classifyGeminiProviderError(lastError, profile.id);
    if (finalError.code === 'QUOTA_EXHAUSTED' || finalError.code === 'RATE_LIMITED') {
      const cooldownUntil = this.profileScheduler.getStatus(profile.id)[0]?.cooldownUntil;
      throw new Error(
        `${profile.label} has reached its current API limit.\n` +
        `This task remains assigned to ${profile.label}.\n` +
        `${cooldownUntil ? `Retry after ${new Date(cooldownUntil).toISOString()}.\n` : ''}` +
        'Available actions: wait for the cooldown, continue with an approved provider, or start a new task under a manually selected workspace profile.'
      );
    }
    throw new Error(
      `Error: Gemini profile ${profile.id} request failed after ${maxAttempts} attempt(s)\n` +
      `Cause: ${finalError.safeMessage}\n` +
      'Suggested Fix: Wait for this account cooldown or explicitly choose another approved provider.'
    );
  }

  /** Return redacted profile health without exposing credentials. */
  getPoolStats() {
    return {
      type: 'profile-scoped',
      available: this.isAvailable(),
      profiles: this.getProfileHealth(),
    };
  }

  estimateStepCost(model: string): number {
    // Gemini pricing estimates
    const target = resolveGeminiModelTarget(model);
    const modelCosts: Record<string, number> = {
      'gemini-1.5-pro': 0.00075, // ~$0.75 per 1M input tokens
      'gemini-1.5-flash': 0.000075, // ~$0.075 per 1M input tokens
      'gemini-pro': 0.00005,
      'gemini-2.5-flash': 0.000075,
      'gemini-3.6-flash': 0.000075,
      'gemini-3.5-flash-lite': 0.00003,
      'gemini-3.5-flash': 0.000075,
    };
    return modelCosts[target?.modelId || model] || 0.00005;
  }

  getProviderName(): string {
    return 'gemini';
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey || this.profileRegistry.list().length > 0 || parseGeminiRuntimeKeys().length > 0);
  }
}

/**
 * NVIDIA NIM LLM Provider
 * Uses hosted NVIDIA NIM APIs. Chat models are OpenAI-compatible, but each
 * model keeps metadata so non-chat APIs do not get sent to chat completion code.
 */
export class NvidiaLLMProvider implements LLMProvider {
  private apiKeys: string[];
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string, apiKeyPool?: string) {
    const primaryKey = apiKey || getRuntimeNvidiaApiKey() || process.env.NVIDIA_API_KEY;
    const keyPool = apiKeyPool || getRuntimeNvidiaApiKeys() || process.env.NVIDIA_API_KEYS;
    this.apiKeys = parseNvidiaApiKeys(primaryKey, keyPool);
    this.baseUrl = (baseUrl || getRuntimeNvidiaBaseUrl() || process.env.NVIDIA_BASE_URL || NVIDIA_BASE_URL_DEFAULT).replace(/\/+$/, '');
  }

  private getCandidateKeys(preferredIndex?: number): string[] {
    if (this.apiKeys.length === 0) {
      throw new Error('NVIDIA API key not configured');
    }
    if (typeof preferredIndex === 'number' && preferredIndex >= 0 && preferredIndex < this.apiKeys.length) {
      return [
        this.apiKeys[preferredIndex],
        ...this.apiKeys.filter((_key, index) => index !== preferredIndex),
      ];
    }
    const readyKeys = this.apiKeys.filter((key) => (nvidiaKeyCooldowns.get(key) || 0) <= Date.now());
    if (readyKeys.length > 0) {
      const coolingKeys = this.apiKeys.filter((key) => (nvidiaKeyCooldowns.get(key) || 0) > Date.now());
      return [...readyKeys, ...coolingKeys];
    }
    return [...this.apiKeys].sort((a, b) => (nvidiaKeyCooldowns.get(a) || 0) - (nvidiaKeyCooldowns.get(b) || 0));
  }

  hasKeyAtIndex(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < this.apiKeys.length;
  }

  getApiKeyCount(): number {
    return this.apiKeys.length;
  }

  async createChatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options?: LLMCompletionOptions
  ): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('NVIDIA API key not configured');
    }

    const target = resolveNvidiaModelTarget(model);
    const requestedModel = target?.modelId || model;
    const requestedMetadata = getNvidiaModelMetadata(requestedModel);
    if (requestedMetadata && requestedMetadata.apiFamily !== 'chat-completions') {
      throw new Error(
        `Error: NVIDIA model cannot use chat completions\n` +
          `Cause: Model ${requestedMetadata.modelId} uses apiFamily ${requestedMetadata.apiFamily}\n` +
          `Suggested Fix: Route this model through ${requestedMetadata.endpoint} instead of /chat/completions.\n` +
          `Context: Model: ${requestedMetadata.modelId}, Endpoint: ${requestedMetadata.endpoint}`
      );
    }

    const selectedModelId = target ? target.modelId : normalizeNvidiaModelId(requestedModel);
    const useFreeTierFallback = (options?.pinModel !== true || options?.allowNvidiaModelFallback === true)
      && options?.freeTierResilience === true
      && selectedModelId !== NVIDIA_PROVIDER_FALLBACK_MODEL
      && getNvidiaModelMetadata(NVIDIA_PROVIDER_FALLBACK_MODEL)?.apiFamily === 'chat-completions';
    // Free-tier requests may hand off a stalled model to the known responsive
    // chat fallback. Agent requests remain pinned for cross-provider routing;
    // allowNvidiaModelFallback opts them into this bounded NVIDIA-only handoff.
    const modelRotation = useFreeTierFallback
      ? [selectedModelId, NVIDIA_PROVIDER_FALLBACK_MODEL]
      : [selectedModelId];
    const errors: string[] = [];
    const forcedKeyIndex = options?.nvidiaApiKeyIndex;
    const allKeyCandidates = typeof forcedKeyIndex === 'number'
      ? [this.apiKeys[forcedKeyIndex]].filter((key): key is string => Boolean(key))
      : target
      ? [this.apiKeys[target.apiKeyIndex]].filter((key): key is string => Boolean(key))
      : this.getCandidateKeys();
    if (allKeyCandidates.length === 0) {
      throw new Error(`NVIDIA API key ${Number(target?.apiKeyIndex) + 1} is not configured for target ${target?.id || model}`);
    }
    const { budget, owned: ownsBudget } = getRequestBudget(options);
    const configuredNvidiaMinAttemptMs = readPositiveInteger(
      'REACT_ENGINE_NVIDIA_MIN_ATTEMPT_MS',
      NVIDIA_MIN_ATTEMPT_MS,
    );
    const nvidiaMinAttemptMs = useFreeTierFallback
      ? Math.min(
          configuredNvidiaMinAttemptMs,
          readPositiveInteger('REACT_ENGINE_NVIDIA_FALLBACK_MIN_ATTEMPT_MS', NVIDIA_FALLBACK_MIN_ATTEMPT_MS),
        )
      : configuredNvidiaMinAttemptMs;
    const nvidiaFreeAttemptTimeoutMs = Math.max(
      nvidiaMinAttemptMs,
      readPositiveInteger(
        'REACT_ENGINE_NVIDIA_FREE_ATTEMPT_TIMEOUT_MS',
        DEFAULT_NVIDIA_FREE_ATTEMPT_TIMEOUT_MS,
      ),
    );
    const isFreeTierPacing = options?.pacingProfile === 'conservative' || options?.pacingProfile === 'phased';
    const freeTierMaxKeyWaitMs = readPositiveInteger(
      'REACT_ENGINE_NVIDIA_FREE_TIER_MAX_KEY_WAIT_MS',
      DEFAULT_NVIDIA_FREE_KEY_WAIT_MS,
    );
    const cooldownWindows = Math.ceil(freeTierMaxKeyWaitMs / nvidiaMinAttemptMs);
    const defaultNvidiaMaxAttempts = isFreeTierPacing
      ? Math.min(30, allKeyCandidates.length * Math.max(1, cooldownWindows))
      : DEFAULT_NVIDIA_MAX_ATTEMPTS;
    const configuredMax = readPositiveInteger('REACT_ENGINE_NVIDIA_MAX_ATTEMPTS', defaultNvidiaMaxAttempts);
    const timeCapacity = Number.isFinite(budget.remainingMs())
      ? Math.max(1, Math.floor(budget.remainingMs() / nvidiaMinAttemptMs))
      : configuredMax;
    const budgetCapacity = Math.min(timeCapacity, budget.remainingRequests());
    const maxAttempts = Math.min(configuredMax, budgetCapacity);
    let launchedAttempts = 0;
    let stopAfterRequestedModelThrottle = false;
    // Tracks whether any key was throttled during a free-tier run. When maxAttempts
    // is exhausted with all keys still cooling down, the final throw must use the
    // 'NVIDIA routes are throttled' cause string so isNvidiaThrottleError (engine.ts)
    // can detect it and trigger the engine-level retry loop (Fix G).
    let anyKeyThrottledOnFreeTier = false;

    if (maxAttempts === 0) {
      if (ownsBudget) budget.cleanup();
      throw new Error(
        `Error: NVIDIA attempts skipped due to exhausted request budget\n` +
        `Cause: Remaining budget is below the ${nvidiaMinAttemptMs}ms minimum viable NVIDIA attempt window\n` +
        `Suggested Fix: Continue to another provider with a smaller attempt floor.`
      );
    }

    try {
      for (const [modelIndex, currentModel] of modelRotation.entries()) {
        if (stopAfterRequestedModelThrottle || launchedAttempts >= maxAttempts) break;
      // An explicit target stays on its assigned credential for the selected
      // model. Once the bounded same-provider fallback takes over, it may use
      // the remaining NVIDIA pool so a single stalled key does not block it.
      const modelKeyCandidates = modelIndex > 0 && options?.allowNvidiaModelFallback === true
        ? this.getCandidateKeys()
        : allKeyCandidates;
      if (modelKeyCandidates.length === 0) continue;
      const metadata = getNvidiaModelMetadata(currentModel);
      const selectedTargetParams = target && currentModel === target.modelId ? target : undefined;
      const effectiveMetadata = metadata || {
        provider: 'nvidia' as const,
        modelId: normalizeNvidiaModelId(currentModel),
        label: normalizeNvidiaModelId(currentModel),
        apiFamily: 'chat-completions' as const,
        endpoint: '/chat/completions' as const,
        supportsStreaming: true,
        supportsTools: selectedTargetParams?.supportsTools === true,
        inputModalities: ['text' as const],
        outputModalities: ['text' as const],
        defaultParams: {},
        uiSelectable: false,
        description: 'Custom NVIDIA model target',
      };

      if (effectiveMetadata.apiFamily !== 'chat-completions') {
        errors.push(`${currentModel}: apiFamily ${effectiveMetadata.apiFamily} requires ${effectiveMetadata.endpoint}, not chat completions`);
        continue;
      }

      if (modelIndex > 0) {
        try {
          options?.onRouteSelected?.({
            provider: 'nvidia',
            requestedTarget: model,
            resolvedModel: effectiveMetadata.modelId,
            credentialIndex: target?.apiKeyIndex ?? forcedKeyIndex,
            reason: 'same_provider_model',
          });
        } catch {
          // Route observability must not affect fallback behavior.
        }
      }

      const url = `${this.baseUrl}${effectiveMetadata.endpoint}`;
      const nvidiaReasoningEffort = supportsNvidiaReasoningEffort(effectiveMetadata.modelId)
        ? mapNvidiaReasoningEffort(options?.reasoning?.effort)
        : undefined;
      const requestBody = {
        model: effectiveMetadata.modelId,
        messages: messages.map((message) => ({
          role: message.role === 'assistant' || message.role === 'system' ? message.role : 'user',
          content: message.content,
        })),
        temperature: options?.temperature ?? selectedTargetParams?.temperature ?? effectiveMetadata.defaultParams.temperature,
        max_tokens: options?.maxTokens ?? selectedTargetParams?.maxTokens ?? effectiveMetadata.defaultParams.maxTokens,
        top_p: options?.topP ?? selectedTargetParams?.topP ?? effectiveMetadata.defaultParams.topP,
        stream: selectedTargetParams?.stream ?? options?.stream ?? false,
        ...(nvidiaReasoningEffort ? { reasoning_effort: nvidiaReasoningEffort } : {}),
        ...(effectiveMetadata.supportsTools && options?.tools?.length
          ? {
              tools: options.tools,
              tool_choice: options.toolChoice || 'auto',
            }
          : {}),
      };

      const throttledKeysForModel = new Set<string>();
      const retryCounts = new Map<string, number>();
      const nonRetryableKeys = new Set<string>();
      let nextAttemptNotBeforeAt = 0;
      const attemptKeys = Array.from(
        { length: maxAttempts },
        (_value, index) => modelKeyCandidates[index % modelKeyCandidates.length],
      );
      for (const [planIndex, apiKey] of attemptKeys.entries()) {
        if (launchedAttempts >= maxAttempts) break;
        if (budget.signal.aborted) throw budget.signal.reason || new Error('LLM request aborted');
        const keyIndex = modelKeyCandidates.indexOf(apiKey);
        if (nonRetryableKeys.has(apiKey)) continue;
        const routeKey = `${apiKey}\u0000${effectiveMetadata.modelId}`;
        const cooldownUntil = Math.max(
          nextAttemptNotBeforeAt,
          nvidiaKeyCooldowns.get(apiKey) || 0,
          nvidiaRouteCooldowns.get(routeKey) || 0,
        );
        if (cooldownUntil > Date.now()) {
          const hasReadyLaterKey = attemptKeys.slice(planIndex + 1).some((laterKey) => {
            if (laterKey === apiKey) return false;
            const laterRouteKey = `${laterKey}\u0000${effectiveMetadata.modelId}`;
            return Math.max(
              nvidiaKeyCooldowns.get(laterKey) || 0,
              nvidiaRouteCooldowns.get(laterRouteKey) || 0,
            ) <= Date.now();
          });
          if (hasReadyLaterKey) {
            errors.push(`${currentModel} (key ${keyIndex + 1}): deferred_retry`);
            continue;
          }
          const delayMs = cooldownUntil - Date.now();
          const canWaitFreeTier = isFreeTierPacing && delayMs <= freeTierMaxKeyWaitMs;
          if (!canWaitFreeTier && budget.remainingMs() < delayMs + nvidiaMinAttemptMs) {
            errors.push(`${currentModel} (key ${keyIndex + 1}): skipped_budget/cooldown`);
            continue;
          }
          try {
            options?.onPacingWait?.({
              delayMs,
              provider: 'nvidia',
              model: effectiveMetadata.modelId,
              scope: canWaitFreeTier ? 'free_tier_key_cooldown' : 'request',
            });
          } catch {
            // Observability must never change retry behavior.
          }
          await waitWithAbort(delayMs, budget.signal);
          nextAttemptNotBeforeAt = 0;
        }
        if (!budgetCanFit(budget, nvidiaMinAttemptMs)) {
          emitTelemetry(options, {
            provider: 'nvidia', model: effectiveMetadata.modelId, requestKind: options?.requestKind,
            startedAt: Date.now(), durationMs: 0, status: 'skipped_budget', attempt: launchedAttempts + 1,
            keyLabel: `key ${keyIndex + 1}`, remainingBudgetMs: Math.floor(budget.remainingMs()),
            classification: 'budget', fallbackDecision: 'next_provider',
          });
          break;
        }
        launchedAttempts++;
        const remaining = budget.remainingMs();
        const remainingSlots = Math.max(1, maxAttempts - launchedAttempts + 1);
        const attemptTimeoutMs = Number.isFinite(remaining)
          ? Math.min(
              Math.floor(remaining),
              Math.max(nvidiaMinAttemptMs, Math.floor(remaining / remainingSlots)),
              ...(options?.freeTierResilience ? [nvidiaFreeAttemptTimeoutMs] : []),
            )
          : options?.freeTierResilience
            ? nvidiaFreeAttemptTimeoutMs
            : undefined;
        const deadline = createAttemptDeadline(budget.signal, attemptTimeoutMs);
        const attemptStartedAt = Date.now();
        try {
          const response = await withNvidiaRequestSlot(
            apiKey,
            effectiveMetadata.modelId,
            options,
            deadline.signal,
            async () => {
              consumeRequestBudget(budget, 'nvidia', effectiveMetadata.modelId);
              const response = await raceWithAbort(fetch(url, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  'Content-Type': 'application/json',
                  Accept: 'application/json',
                },
                body: JSON.stringify(requestBody),
                signal: deadline.signal,
              }), deadline.signal);

              const actualApiKeyIndex = this.apiKeys.indexOf(apiKey);
              updateProviderRateLimitHeaders(
                'nvidia',
                effectiveMetadata.modelId,
                response.headers,
                actualApiKeyIndex >= 0 ? actualApiKeyIndex : undefined,
              );

              if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                const classification = classifyNvidiaStatus(response.status, errorText);
                const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
                if (classification === 'throttled' && retryAfterMs !== undefined) {
                  deferNvidiaRequestSlot(apiKey, retryAfterMs);
                } else if (classification === 'authentication') {
                  deferNvidiaRequestSlot(apiKey, 5 * 60_000);
                }
                throw new NvidiaHttpError(
                  response.status,
                  classification,
                  retryAfterMs,
                  response.headers.get('x-request-id') || response.headers.get('nvcf-reqid') || undefined,
                  redactProviderText(errorText),
                  effectiveMetadata.modelId,
                );
              }

              return response;
            },
          );

          if (response.status === 202) {
            const pendingText = await response.text().catch(() => '');
            throw new NvidiaHttpError(
              response.status,
              'transient',
              parseRetryAfterMs(response.headers.get('retry-after')),
              response.headers.get('x-request-id') || response.headers.get('nvcf-reqid') || undefined,
              redactProviderText(pendingText),
              effectiveMetadata.modelId,
            );
          }

          const contentType = response.headers.get('content-type') || '';
          let result: string;
          let responseData: unknown;
          if (contentType.includes('text/event-stream')) {
            result = await readNvidiaStream(response, options, deadline.signal);
          } else {
            try {
              responseData = await response.json();
            } catch {
              throw new Error(
                `Error: NVIDIA API returned malformed JSON\n` +
                  `Cause: Response body was not valid JSON\n` +
                  `Suggested Fix: Retry the free endpoint after a short cooldown.\n` +
                  `Context: Model: ${effectiveMetadata.modelId}`
              );
            }
            result = parseNvidiaChatCompletionJson(responseData);
          }

          if (result.trim()) {
            nvidiaKeyCooldowns.delete(apiKey);
            nvidiaRouteCooldowns.delete(routeKey);
            reportSafeReasoningSummary(options, responseData, result, 'nvidia', effectiveMetadata.modelId);
            emitTelemetry(options, {
              provider: 'nvidia', model: effectiveMetadata.modelId, requestKind: options?.requestKind,
              startedAt: attemptStartedAt, durationMs: Date.now() - attemptStartedAt, status: 'succeeded',
              attempt: launchedAttempts, keyLabel: `key ${keyIndex + 1}`, allocatedBudgetMs: attemptTimeoutMs,
              remainingBudgetMs: Math.floor(budget.remainingMs()),
            });
            return result;
          }

          throw new Error(
            `Error: NVIDIA API returned empty response\n` +
              `Cause: Chat completion response had no usable content\n` +
              `Suggested Fix: Retry with another NVIDIA chat model\n` +
              `Context: Model: ${effectiveMetadata.modelId}`
          );
        } catch (error) {
          if (options?.signal?.aborted) throw options.signal.reason || error;
          const message = deadline.timedOut()
            ? `NVIDIA key/model attempt timed out after ${attemptTimeoutMs}ms`
            : error instanceof Error ? error.message : String(error);
          const classification: NvidiaFailureClass = error instanceof NvidiaHttpError
            ? error.classification
            : deadline.timedOut() || /ECONNRESET|ETIMEDOUT|fetch failed/i.test(message)
              ? 'transient'
              : 'unknown';
          errors.push(`${currentModel} (key ${keyIndex + 1}/${modelKeyCandidates.length}): ${message}`);

          emitTelemetry(options, {
            provider: 'nvidia', model: effectiveMetadata.modelId, requestKind: options?.requestKind,
            startedAt: attemptStartedAt, durationMs: Date.now() - attemptStartedAt,
            status: deadline.timedOut() ? 'timed_out' : 'failed', attempt: launchedAttempts,
            keyLabel: `key ${keyIndex + 1}`, allocatedBudgetMs: attemptTimeoutMs,
            remainingBudgetMs: Math.floor(budget.remainingMs()), classification,
            fallbackDecision: classification === 'model' ? 'next_model' : 'rotate_or_fallback', error: message,
          });

          if (classification === 'authentication') {
            nvidiaKeyCooldowns.set(apiKey, Date.now() + 5 * 60_000);
          } else if (classification === 'throttled') {
            throttledKeysForModel.add(apiKey);
            // Do not spend one task's budget repeatedly probing the same
            // throttled credential. Its shared cooldown protects later tasks;
            // this task may rotate to another independent key or provider.
            // On free-tier pacing, keep keys retryable once their cooldown expires.
            if (!isFreeTierPacing) {
              nonRetryableKeys.add(apiKey);
            }
            const retryAfterMs = error instanceof NvidiaHttpError ? error.retryAfterMs : undefined;
            const retryNumber = (retryCounts.get(apiKey) || 0) + 1;
            retryCounts.set(apiKey, retryNumber);
            const cooldownMs = retryAfterMs ?? getNvidiaBackoffDelayMs(retryNumber);
            nvidiaRouteCooldowns.set(routeKey, Date.now() + cooldownMs);
            nvidiaKeyCooldowns.set(apiKey, Date.now() + cooldownMs);
            deferNvidiaRequestSlot(apiKey, cooldownMs);
            // Short provider-directed waits apply before rotating credentials;
            // longer waits defer only the affected key so fallbacks stay usable.
            if (retryAfterMs !== undefined && retryAfterMs <= 5_000) {
              nextAttemptNotBeforeAt = Date.now() + retryAfterMs;
            } else if (retryAfterMs === undefined) {
              nextAttemptNotBeforeAt = Date.now() + cooldownMs;
            }
          } else if (classification === 'transient') {
            if (deadline.timedOut() || target || typeof forcedKeyIndex === 'number') {
              nonRetryableKeys.add(apiKey);
            } else {
              const retryNumber = (retryCounts.get(apiKey) || 0) + 1;
              retryCounts.set(apiKey, retryNumber);
              nextAttemptNotBeforeAt = Date.now() + getNvidiaBackoffDelayMs(retryNumber);
            }
          } else if (classification === 'unknown') {
            nonRetryableKeys.add(apiKey);
          }

          // A 404 means the model is unavailable at this endpoint regardless of key.
          if (classification === 'model') {
            break;
          }
        } finally {
          deadline.cleanup();
        }
      }
      if (!isFreeTierPacing && modelIndex === 0 && throttledKeysForModel.size > 0 && throttledKeysForModel.size >= modelKeyCandidates.length) {
        // Multiple keys throttled for the requested route is strong evidence of
        // account/global pressure. Do not hammer every large model with them.
        stopAfterRequestedModelThrottle = true;
      }
      // On free-tier, record any per-model throttle so the outer throw can emit
      // 'NVIDIA routes are throttled' even when stopAfterRequestedModelThrottle is
      // false (which is always the case for free-tier). isNvidiaThrottleError in
      // engine.ts matches that exact string to trigger the engine-level retry loop.
      if (isFreeTierPacing && throttledKeysForModel.size > 0) {
        anyKeyThrottledOnFreeTier = true;
      }
      }
    } finally {
      if (ownsBudget) budget.cleanup();
    }

    const isThrottleFailure = stopAfterRequestedModelThrottle || anyKeyThrottledOnFreeTier;
    throw new Error(
      `Error: NVIDIA model rotation failed\n` +
        `Cause: ${isThrottleFailure ? 'NVIDIA routes are throttled' : 'The bounded NVIDIA attempt plan did not succeed'}\n` +
        `Suggested Fix: ${isThrottleFailure ? 'Wait for cooldown, check quota, or continue with another provider.' : 'Verify authentication/model access or continue with another provider.'}\n` +
        `Context: Requested model: ${model}, Planned: ${modelRotation.join(', ')}, Attempts: ${launchedAttempts}, Errors: ${errors.map((err) => redactProviderText(err)).join(' | ')}`
    );
  }

  getModelCapabilities(model: string): ModelCapabilities {
    const target = resolveNvidiaModelTarget(model);
    const metadata = getNvidiaModelMetadata(target?.modelId || model);
    const supportsTools = target?.supportsTools ?? metadata?.supportsTools ?? false;

    return {
      streaming: target?.supportsStreaming ?? metadata?.supportsStreaming ?? false,
      toolCalling: supportsTools,
      // The planner's structured JSON action protocol remains available even
      // when a route does not advertise native function tools.
      structuredOutput: supportsTools,
      jsonMode: true,
      vision: Boolean(metadata?.inputModalities?.some((modality) => modality !== 'text')),
      contextTokenLimit: metadata?.contextWindow,
      outputTokenLimit: target?.maxTokens ?? metadata?.defaultParams.maxTokens,
    };
  }

  estimateStepCost(model: string): number {
    const target = resolveNvidiaModelTarget(model);
    const metadata = getNvidiaModelMetadata(target?.modelId || model);
    if (!metadata) return 0.0001;
    if (metadata.modelId.includes('ultra')) return 0.0008;
    if (metadata.modelId.includes('super')) return 0.0004;
    if (metadata.modelId.includes('coder')) return 0.0003;
    return 0.0001;
  }

  getProviderName(): string {
    return 'nvidia';
  }

  isAvailable(): boolean {
    return this.apiKeys.length > 0;
  }
}

/** OpenRouter OpenAI-compatible chat-completions provider. */
export class OpenRouterLLMProvider implements LLMProvider {
  private apiKey: string | undefined;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || getConfiguredOpenRouterApiKey() || process.env.OPENROUTER_API_KEY;
    this.baseUrl = (baseUrl || getRuntimeOpenRouterBaseUrl() || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1')
      .replace(/\/+$/, '');
  }

  async createChatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options?: LLMCompletionOptions
  ): Promise<string> {
    // A pinned agent request must stay on its selected model for ordinary
    // failures. Ox Alpha is the narrow exception: a successful HTTP response
    // with no assistant content is a provider contract failure, so recover
    // through the same OpenRouter account instead of returning an unusable
    // result to the planner.
    const fallbackModel = getOpenRouterEmptyResponseFallbackModel(model);
    if (!fallbackModel) {
      try {
        return await this.createChatCompletionWithApiKey(this.apiKey, messages, model, options);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const canRetryWithoutTransportTools = Boolean(options?.tools?.length)
          && /(?:HTTP 400|invalid request params|INVALID_ARGUMENT)/i.test(message)
          && (!options?.requestBudget || budgetCanFit(options.requestBudget, 1_000));
        if (!canRetryWithoutTransportTools) throw error;

        // Some OpenRouter model/provider combinations advertise tool support
        // but reject the optional OpenAI tool_choice envelope. The planner
        // always includes a provider-neutral JSON action contract, so retry
        // the same model without transport tools before surfacing the 400.
        try {
          return await this.createChatCompletionWithApiKey(
            this.apiKey,
            messages,
            model,
            { ...options, tools: undefined, toolChoice: undefined },
          );
        } catch (retryError) {
          const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
          throw new Error(
            `${redactProviderText(message, 600)}\n` +
            `Tool-free same-model retry also failed: ${redactProviderText(retryMessage, 600)}`
          );
        }
      }
    }

    // Keep an empty-content recovery inside one end-to-end budget. This makes
    // the fallback bounded and prevents a transient 200/empty response from
    // starting an untracked second request outside the caller's request limit.
    const { budget, owned: ownsBudget } = getRequestBudget(options);
    const requestOptions = { ...options, requestBudget: budget };
    try {
      try {
        return await this.createChatCompletionWithApiKey(this.apiKey, messages, model, requestOptions);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isEmptyContentFailure = /returned no usable chat content/i.test(message)
          && /(?:empty response|reasoning-only response)/i.test(message);
        if (!isEmptyContentFailure || !budgetCanFit(budget, 1)) throw error;

        try {
          // Ox Alpha can occasionally acknowledge a request with finish_reason
          // "stop" before producing visible content. Retry the same model once
          // with a low, excluded reasoning trace before spending the request on
          // a different model. This keeps the selected model authoritative and
          // avoids turning a transient empty response into a fallback quota hit.
          return await this.createChatCompletionWithApiKey(
            this.apiKey,
            messages,
            model,
            {
              ...requestOptions,
              reasoning: { effort: 'low', exclude: true },
            },
          );
        } catch (retryError) {
          const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
          if (!budgetCanFit(budget, 1)) {
            throw new Error(
              `${redactProviderText(message, 600)}\n` +
              `Ox Alpha retry also failed: ${redactProviderText(retryMessage, 600)}`
            );
          }

          try {
            return await this.createChatCompletionWithApiKey(
              this.apiKey,
              messages,
              fallbackModel,
              // Recovery is about obtaining visible text/tool JSON. Do not
              // carry Ox Alpha's native reasoning request into the deterministic
              // fallback model, which may not support that parameter. Also cap
              // the total completion budget because the fallback is not a
              // 131K-token reasoning route and may reject that request size.
              {
                ...requestOptions,
                reasoning: undefined,
                disableOpenRouterReasoning: true,
                maxTokens: resolveOpenRouterRecoveryMaxTokens(fallbackModel, options?.maxTokens),
              },
            );
          } catch (fallbackError) {
            let fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);

            // Some OpenRouter free providers advertise tool support but reject
            // a planner's full tool schema or required tool_choice with HTTP
            // 400. The planner prompt already requires the same JSON action
            // envelope, so retry this recovery route once without the optional
            // transport-level tools before surfacing provider exhaustion.
            if (
              options?.tools?.length
              && /(?:HTTP 400|INVALID_ARGUMENT)/i.test(fallbackMessage)
              && budgetCanFit(budget, 1)
            ) {
              try {
                return await this.createChatCompletionWithApiKey(
                  this.apiKey,
                  messages,
                  fallbackModel,
                  {
                    ...requestOptions,
                    reasoning: undefined,
                    disableOpenRouterReasoning: true,
                    maxTokens: resolveOpenRouterRecoveryMaxTokens(fallbackModel, options?.maxTokens),
                    tools: undefined,
                    toolChoice: undefined,
                  },
                );
              } catch (toolFreeFallbackError) {
                const toolFreeFallbackMessage = toolFreeFallbackError instanceof Error
                  ? toolFreeFallbackError.message
                  : String(toolFreeFallbackError);
                fallbackMessage = `${fallbackMessage}\n` +
                  `Tool-free recovery retry also failed: ${redactProviderText(toolFreeFallbackMessage, 600)}`;
              }
            }

            throw new Error(
              `${redactProviderText(message, 600)}\n` +
              `Ox Alpha retry also failed: ${redactProviderText(retryMessage, 600)}\n` +
              `Recovery route ${fallbackModel} also failed: ${redactProviderText(fallbackMessage, 600)}`
            );
          }
        }
      }
    } finally {
      if (ownsBudget) budget.cleanup();
    }
  }

  protected async createChatCompletionWithApiKey(
    apiKey: string | undefined,
    messages: Array<{ role: string; content: string }>,
    model: string,
    options?: LLMCompletionOptions,
    credentialIndex?: number,
  ): Promise<string> {
    const providerName = this.getProviderName();
    const streamOutput = options?.stream === true && options.requestKind === 'final_answer.synthesize';
    const providerLabel = providerName === 'groq' ? 'Groq'
      : providerName === 'cerebras' ? 'Cerebras'
        : providerName === 'sambanova' ? 'SambaNova'
        : providerName === 'kimi' ? 'Kimi'
          : providerName === 'requesty' ? 'Requesty'
            : 'OpenRouter';
    if (!apiKey) throw new Error(`${providerLabel} API key not configured`);

    const { budget, owned: ownsBudget } = getRequestBudget(options);
    const remaining = budget.remainingMs();
    const attemptTimeoutMs = Number.isFinite(remaining) ? Math.max(1, Math.floor(remaining)) : options?.timeoutMs;
    const deadline = createAttemptDeadline(budget.signal, attemptTimeoutMs);
    const isOpenRouterDynamicFreeRoute = providerName === 'openrouter' && model === OPENROUTER_DYNAMIC_FREE_MODEL;
    const isStructuredOpenRouterRoute = providerName === 'openrouter' && isStructuredRequestKind(options?.requestKind);
    const isMandatoryOpenRouterReasoningRoute = providerName === 'openrouter' && isOpenRouterMandatoryReasoningModel(model);
    const isRequestyRoute = providerName === 'requesty';
    const maxTokens = providerName === 'openrouter'
      ? resolveOpenRouterMaxTokens(model, options?.maxTokens)
      : isRequestyRoute
        ? Math.max(options?.maxTokens || 0, REQUESTY_MIN_OUTPUT_TOKENS)
        : options?.maxTokens;
    const requestedOpenRouterReasoning = providerName === 'openrouter' && !options?.disableOpenRouterReasoning && (!isStructuredOpenRouterRoute || isMandatoryOpenRouterReasoningRoute) && !isOpenRouterDynamicFreeRoute
      ? buildOpenRouterReasoningPayload(options?.reasoning, model)
      : undefined;
    const estimatedInputTokens = providerName === 'openrouter'
      ? estimateOpenRouterInputTokens(messages, options)
      : undefined;
    const startedAt = Date.now();
    try {
      if (providerName === 'openrouter') {
        await waitForOpenRouterRequestSlot(options, deadline.signal);
      }
      consumeRequestBudget(budget, providerName, model);
      const response = await raceWithAbort(fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: streamOutput ? 'text/event-stream' : 'application/json',
          ...(providerName === 'openrouter' ? { 'X-OpenRouter-Title': 'React Engine 077' } : {}),
        },
        body: JSON.stringify({
          model,
          messages: messages.map((message) => ({
            role: message.role === 'assistant' || message.role === 'system' ? message.role : 'user',
            content: openRouterMessageContent(message.content, model),
          })),
          temperature: options?.temperature,
          max_tokens: maxTokens,
          top_p: options?.topP,
          stream: streamOutput,
          // The dynamic free router can select a reasoning model. Reasoning
          // tokens share max_tokens with visible content, so a tiny caller
          // budget can otherwise end with reasoning-only + finish_reason=length.
          // Minimal effort preserves final-answer capacity; excluding the trace
          // prevents private reasoning from being mistaken for usable content.
          ...(requestedOpenRouterReasoning
            ? { reasoning: requestedOpenRouterReasoning }
            : isStructuredOpenRouterRoute && !options?.disableOpenRouterReasoning && !isMandatoryOpenRouterReasoningRoute
            ? { reasoning: { enabled: false, exclude: true } }
            : (isOpenRouterDynamicFreeRoute || isMandatoryOpenRouterReasoningRoute)
              ? { reasoning: { effort: 'minimal', exclude: true } }
              : {}),
          ...(options?.tools?.length ? {
            tools: options.tools,
            tool_choice: options.toolChoice || 'auto',
          } : {}),
        }),
        signal: deadline.signal,
      }), deadline.signal);

      updateProviderRateLimitHeaders(providerName, model, response.headers, credentialIndex);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const retryAfter = response.headers.get('retry-after');
        let errorDetail = errorText;
        try {
          const parsed = JSON.parse(errorText);
          const raw = parsed?.error?.metadata?.raw;
          const msg = parsed?.error?.message;
          const limitSource = parsed?.error?.metadata?.limit_source;
          if (limitSource === 'upstream_provider_shared_pool' && raw) {
            errorDetail = `upstream shared pool rate-limited: ${raw}`;
          } else if (raw) {
            errorDetail = raw;
          } else if (msg) {
            errorDetail = msg;
          }
        } catch {
          // Preserve the bounded provider error even when its response body is not JSON.
        }

        throw new Error(
          `Error: ${providerLabel} API request failed\n` +
          `Cause: HTTP ${response.status} from ${providerLabel}\n` +
          `Suggested Fix: Verify the API key, model access, credits, and rate limits.\n` +
          `Context: Model: ${model}${retryAfter ? `, Retry after: ${retryAfter}` : ''}${errorDetail ? `, Response: ${redactProviderText(errorDetail)}` : ''}`
        );
      }

      const streamedResponse = streamOutput && (response.headers.get('content-type') || '').includes('text/event-stream')
        ? await readChatCompletionEventStream(response, options, deadline.signal)
        : undefined;
      const data = streamedResponse
        ? {
          model: streamedResponse.model,
          choices: [{
            message: { content: streamedResponse.text },
            finish_reason: streamedResponse.finishReason,
          }],
          usage: streamedResponse.usage,
        }
        : await response.json() as any;
      const result = parseNvidiaChatCompletionJson(data);
      if (result.trim()) {
        const usage = providerName === 'openrouter' ? openRouterUsageFrom(data?.usage) : undefined;
        const message = data?.choices?.[0]?.message;
        const reasoningSummary = extractSafeReasoningSummary(data);
        reportCompletionResult(options, {
          text: result,
          toolCalls: Array.isArray(message?.tool_calls) ? message.tool_calls : [],
          ...(reasoningSummary ? { reasoningSummary } : {}),
          ...(usage ? { usage } : {}),
          provider: providerName,
          model,
          finishReason: typeof data?.choices?.[0]?.finish_reason === 'string'
            ? data.choices[0].finish_reason
            : undefined,
        });
        if (providerName === 'openrouter') {
          const resolvedModel = typeof data?.model === 'string' && data.model ? data.model : model;
          const fallbackUsed = resolvedModel.toLowerCase() !== model.toLowerCase();
          emitTelemetry(options, {
            provider: providerName,
            model,
            resolvedModel,
            fallbackUsed,
            requestKind: options?.requestKind,
            startedAt,
            durationMs: Date.now() - startedAt,
            status: 'succeeded',
            maxTokens,
            estimatedInputTokens,
            estimatedOutputTokens: Math.max(1, Math.ceil(result.length / 4)),
            reportedInputTokens: usage?.inputTokens,
            reportedOutputTokens: usage?.outputTokens,
            credentialIndex,
          });
        }
        return result;
      }
      const choice = data?.choices?.[0];
      const selectedModel = typeof data?.model === 'string' ? data.model : undefined;
      const apiError = data?.error?.message || choice?.error?.message;
      const refusal = choice?.message?.refusal;
      const finishReason = choice?.finish_reason;
      const reasoningOnly = typeof choice?.message?.reasoning === 'string' && choice.message.reasoning.trim();
      const cause = apiError
        || (typeof refusal === 'string' && refusal.trim() ? refusal : '')
        || (reasoningOnly ? `reasoning-only response${finishReason ? ` (finish reason: ${finishReason})` : ''}` : '')
        || `empty response${finishReason ? ` (finish reason: ${finishReason})` : ''}`;
      throw new Error(
        `Error: ${providerLabel} returned no usable chat content\n` +
        `Cause: ${redactProviderText(cause)}\n` +
        `Context: Requested model: ${model}${selectedModel ? `, Selected model: ${selectedModel}` : ''}, Output token limit: ${maxTokens ?? 'provider default'}\n` +
        `Suggested Fix: Verify the configured ${providerLabel} model is available and supports the requested response format.`
      );
    } catch (error) {
      if (providerName === 'openrouter') {
        const message = error instanceof Error ? error.message : String(error);
        emitTelemetry(options, {
          provider: providerName,
          model,
          requestKind: options?.requestKind,
          startedAt,
          durationMs: Date.now() - startedAt,
          status: options?.signal?.aborted ? 'cancelled' : deadline.timedOut() ? 'timed_out' : 'failed',
          error: redactProviderText(message, 600),
          credentialIndex,
        });
      }
      if (options?.signal?.aborted) throw options.signal.reason || error;
      if (deadline.timedOut()) throw new Error(`${providerLabel} request timed out after ${attemptTimeoutMs}ms`);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(redactProviderText(message, 600));
    } finally {
      deadline.cleanup();
      if (ownsBudget) budget.cleanup();
    }
  }

  estimateStepCost(): number {
    return 0.0001;
  }

  getProviderName(): string {
    return 'openrouter';
  }

  getModelCapabilities(model: string): ModelCapabilities {
    const target = getOpenRouterModelTarget(model);
    const knownMetadata = getOpenRouterKnownModelMetadata(model);
    const supportsTools = target?.supportsTools ?? knownMetadata?.supportsTools ?? false;
    return {
      streaming: true,
      toolCalling: supportsTools,
      structuredOutput: supportsTools,
      jsonMode: true,
      vision: openRouterModelSupportsVision(model),
      contextTokenLimit: target?.contextLength ?? knownMetadata?.contextLength,
      outputTokenLimit: target?.maxTokens ?? knownMetadata?.maxTokens,
    };
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey || getConfiguredOpenRouterApiKey());
  }
}

/** Kimi/Moonshot exposes an OpenAI-compatible chat-completions API. */
export class KimiLLMProvider extends OpenRouterLLMProvider {
  private readonly configuredApiKey?: string;

  constructor(apiKey?: string) {
    const resolvedApiKey = apiKey || getRuntimeKimiApiKey() || process.env.KIMI_API_KEY;
    super(resolvedApiKey, getRuntimeKimiBaseUrl());
    this.configuredApiKey = resolvedApiKey;
  }

  getProviderName(): string {
    return 'kimi';
  }

  async createChatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options?: LLMCompletionOptions,
  ): Promise<string> {
    const nativeModel = model.startsWith(KIMI_MODEL_PREFIX)
      ? model.slice(KIMI_MODEL_PREFIX.length).trim()
      : model;
    return super.createChatCompletion(messages, nativeModel, options);
  }

  isAvailable(): boolean {
    return Boolean(this.configuredApiKey || getRuntimeKimiApiKey() || process.env.KIMI_API_KEY);
  }
}

/** Requesty exposes its model gateway through OpenAI-compatible chat completions. */
export class RequestyLLMProvider extends OpenRouterLLMProvider {
  private readonly configuredApiKey?: string;

  constructor(apiKey?: string) {
    const resolvedApiKey = apiKey || getRuntimeRequestyApiKey() || process.env.REQUESTY_API_KEY;
    super(resolvedApiKey, getRuntimeRequestyBaseUrl());
    this.configuredApiKey = resolvedApiKey;
  }

  getProviderName(): string {
    return 'requesty';
  }

  async createChatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options?: LLMCompletionOptions,
  ): Promise<string> {
    const nativeModel = model.startsWith(REQUESTY_MODEL_PREFIX)
      ? model.slice(REQUESTY_MODEL_PREFIX.length).trim()
      : model;
    return super.createChatCompletion(messages, nativeModel, options);
  }

  isAvailable(): boolean {
    return Boolean(this.configuredApiKey || getRuntimeRequestyApiKey() || process.env.REQUESTY_API_KEY);
  }
}

/** Cerebras exposes a direct OpenAI-compatible chat-completions API. */
export class CerebrasLLMProvider extends OpenRouterLLMProvider {
  private readonly configuredApiKey?: string;

  constructor(apiKey?: string) {
    const resolvedApiKey = apiKey || getRuntimeCerebrasApiKey() || process.env.CEREBRAS_API_KEY;
    super(resolvedApiKey, getRuntimeCerebrasBaseUrl());
    this.configuredApiKey = resolvedApiKey;
  }

  getProviderName(): string {
    return 'cerebras';
  }

  async createChatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options?: LLMCompletionOptions,
  ): Promise<string> {
    const nativeModel = model.startsWith(CEREBRAS_MODEL_PREFIX)
      ? model.slice(CEREBRAS_MODEL_PREFIX.length).trim()
      : model || getRuntimeCerebrasModel();
    return super.createChatCompletion(messages, nativeModel, options);
  }

  isAvailable(): boolean {
    return Boolean(this.configuredApiKey || getRuntimeCerebrasApiKey() || process.env.CEREBRAS_API_KEY);
  }
}

/** SambaNova Cloud exposes a direct OpenAI-compatible chat-completions API. */
export class SambaNovaLLMProvider extends OpenRouterLLMProvider {
  private readonly configuredApiKey?: string;

  constructor(apiKey?: string) {
    const resolvedApiKey = apiKey || getRuntimeSambaNovaApiKey() || process.env.SAMBANOVA_API_KEY;
    super(resolvedApiKey, getRuntimeSambaNovaBaseUrl());
    this.configuredApiKey = resolvedApiKey;
  }

  getProviderName(): string {
    return 'sambanova';
  }

  async createChatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options?: LLMCompletionOptions,
  ): Promise<string> {
    const nativeModel = model.startsWith(SAMBANOVA_MODEL_PREFIX)
      ? model.slice(SAMBANOVA_MODEL_PREFIX.length).trim()
      : model || getConfiguredSambaNovaModel();
    return super.createChatCompletion(messages, nativeModel, options);
  }

  isAvailable(): boolean {
    return Boolean(this.configuredApiKey || getRuntimeSambaNovaApiKey() || process.env.SAMBANOVA_API_KEY);
  }
}

/** Optional OpenAI-compatible local model endpoint (for example Ollama/vLLM). */
const LOCAL_CONTEXT_RETRY_MAX_OUTPUT_TOKENS = 1024;
const LOCAL_INPUT_CONTEXT_RESERVE_RATIO = 0.75;
// Thinking models count hidden thinking tokens against max_tokens. A small visible
// response budget (for example the 40-token completion check) can therefore
// end with finish_reason=length and no message.content. Reserve enough output
// space for thinking plus the response; structured action requests suppress
// thinking but keep that visible-output reserve for their action payload.
const LOCAL_QWEN3_MIN_OUTPUT_TOKENS = 1_024;
const LOCAL_QWEN3_RETRY_MAX_OUTPUT_TOKENS = 16_384;

function isQwen3Model(model: string): boolean {
  return /\b(?:qwen[3-9]|qwq|deepseek[-_]?r1|bonsai|reasoner|thinking)\b/i.test(model)
    || /qwen3/i.test(model);
}

const LOCAL_SAFE_FINISH_REASONS = new Set([
  'stop',
  'length',
  'tool_calls',
  'function_call',
  'content_filter',
  'stop_sequence',
]);

function sanitizeLocalFinishReason(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim().toLowerCase();
  return LOCAL_SAFE_FINISH_REASONS.has(normalized) ? normalized : 'other';
}

function truncateLocalMessage(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const headChars = Math.max(1, Math.floor(maxChars * 0.62));
  const tailChars = Math.max(1, maxChars - headChars - 48);
  return `${content.slice(0, headChars)}\n...[local context compacted]\n${content.slice(-tailChars)}`;
}

function compactLocalMessages(messages: Array<{ role: string; content: string }>, inputTokenLimit = DEFAULT_LOCAL_AI_INPUT_TOKEN_LIMIT): Array<{ role: string; content: string }> {
  const maxChars = Math.max(2_048, inputTokenLimit * 4);
  if (messages.reduce((total, message) => total + message.content.length, 0) <= maxChars) return messages;
  if (messages.length <= 1) {
    return messages.map((message) => ({ ...message, content: truncateLocalMessage(message.content, maxChars) }));
  }

  const first = messages[0];
  const last = messages[messages.length - 1];
  const middle = messages.slice(1, -1);
  const firstBudget = Math.min(first.content.length, Math.floor(maxChars * 0.34));
  const lastBudget = Math.min(last.content.length, Math.floor(maxChars * 0.5));
  const middleBudget = Math.max(0, maxChars - firstBudget - lastBudget);
  const perMiddleBudget = middle.length > 0 ? Math.max(160, Math.floor(middleBudget / middle.length)) : 0;
  return [
    { ...first, content: truncateLocalMessage(first.content, firstBudget) },
    ...middle.map((message) => ({ ...message, content: truncateLocalMessage(message.content, perMiddleBudget) })),
    { ...last, content: truncateLocalMessage(last.content, lastBudget) },
  ];
}

function localContextRetryInputTokens(errorBody: string, fallbackInputTokenLimit: number): number {
  const availableTokens = Number(errorBody.match(/available context size \((\d+) tokens\)/i)?.[1]);
  if (!Number.isFinite(availableTokens) || availableTokens <= 0) return fallbackInputTokenLimit;
  return Math.max(512, availableTokens - LOCAL_CONTEXT_RETRY_MAX_OUTPUT_TOKENS - 128);
}

function stripLocalThinkingMarkup(value: string): string {
  return value
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trimStart();
}

interface LocalStreamResult {
  text: string;
  toolCalls: LLMToolCall[];
  finishReason?: string;
  usage?: LLMUsage;
  reasoningSummary?: string;
  promptPrefillDurationMs?: number;
}

async function readLocalCompletionStream(
  response: Response,
  options?: LLMCompletionOptions,
  signal?: AbortSignal,
  touch?: () => void,
): Promise<LocalStreamResult> {
  if (!response.body) throw new Error('Local model stream had no response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let rawText = '';
  let visibleText = '';
  let finishReason: string | undefined;
  let usage: LLMUsage | undefined;
  let reasoningSummary = '';
  let generatedCharacters = 0;
  let lastProgressAt = 0;
  const streamStartedAt = Date.now();
  let promptPrefillDurationMs: number | undefined;
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

  const emit = (event: LLMCompletionStreamEvent) => {
    options?.onStreamEvent?.(event);
  };

  const emitProgress = (force = false) => {
    if (generatedCharacters <= 0) return;
    const now = Date.now();
    if (!force && now - lastProgressAt < 250) return;
    lastProgressAt = now;
    emit({ type: 'usage', usage: { outputTokens: Math.max(1, Math.ceil(generatedCharacters / 4)) } });
  };

  const processPayload = (payload: string) => {
    if (!payload || payload === '[DONE]') return;
    // Private reasoning and empty assistant deltas are still server activity;
    // they must reset the idle timer without being exposed to the caller.
    touch?.();
    let data: any;
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }

    const safeReasoningDelta = extractSafeReasoningSummaryDelta(data, reasoningSummary);
    if (safeReasoningDelta) {
      reasoningSummary = `${reasoningSummary ? `${reasoningSummary} ` : ''}${safeReasoningDelta}`
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, SAFE_REASONING_SUMMARY_MAX_CHARS);
      emit({ type: 'reasoning_summary_delta', delta: safeReasoningDelta, source: 'provider' });
    }

    const choice = data?.choices?.[0];
    const delta = choice?.delta;
    if (typeof delta?.content === 'string' && delta.content) {
      generatedCharacters += delta.content.length;
      rawText += delta.content;
      const nextVisibleText = stripLocalThinkingMarkup(rawText);
      const visibleDelta = nextVisibleText.startsWith(visibleText)
        ? nextVisibleText.slice(visibleText.length)
        : nextVisibleText;
      visibleText = nextVisibleText;
      if (visibleDelta) emit({ type: 'text_delta', delta: visibleDelta });
    }

    for (const fragment of Array.isArray(delta?.tool_calls) ? delta.tool_calls : []) {
      const index = Number(fragment.index) || 0;
      const current = toolCalls.get(index) || { id: '', name: '', arguments: '' };
      if (fragment.id) current.id += fragment.id;
      if (fragment.function?.name) current.name += fragment.function.name;
      if (fragment.function?.arguments) current.arguments += fragment.function.arguments;
      generatedCharacters += typeof fragment.function?.arguments === 'string' ? fragment.function.arguments.length : 0;
      toolCalls.set(index, current);
      emit({
        type: 'tool_call_delta',
        index,
        id: fragment.id,
        name: fragment.function?.name,
        argumentsDelta: fragment.function?.arguments,
      });
    }

    emitProgress();

    if (typeof choice?.finish_reason === 'string') {
      finishReason = sanitizeLocalFinishReason(choice.finish_reason);
    }
    const streamUsage = data?.usage;
    if (streamUsage && typeof streamUsage === 'object') {
      const nextUsage: LLMUsage = {
        inputTokens: Number.isFinite(Number(streamUsage.prompt_tokens)) ? Number(streamUsage.prompt_tokens) : undefined,
        outputTokens: Number.isFinite(Number(streamUsage.completion_tokens)) ? Number(streamUsage.completion_tokens) : undefined,
        totalTokens: Number.isFinite(Number(streamUsage.total_tokens)) ? Number(streamUsage.total_tokens) : undefined,
      };
      if (Object.values(nextUsage).some((entry) => entry !== undefined)) {
        usage = nextUsage;
        emit({ type: 'usage', usage });
      }
    }

    const hasDeltaContent = typeof delta?.content === 'string' && delta.content.length > 0;
    const hasToolCall = Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0;
    const hasReasoning = Boolean(safeReasoningDelta);

    if (promptPrefillDurationMs === undefined && (hasDeltaContent || hasToolCall || hasReasoning)) {
      promptPrefillDurationMs = Math.max(0, Date.now() - streamStartedAt);
    }

    if (data?.timings?.prompt_ms !== undefined && Number.isFinite(Number(data.timings.prompt_ms))) {
      promptPrefillDurationMs = Math.round(Number(data.timings.prompt_ms));
    } else if (data?.prompt_eval_duration !== undefined && Number.isFinite(Number(data.prompt_eval_duration))) {
      promptPrefillDurationMs = Math.round(Number(data.prompt_eval_duration) / 1_000_000);
    }
  };

  if (typeof (response.body as ReadableStream<Uint8Array>).getReader === 'function') {
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    try {
      while (true) {
        const next = signal ? await raceWithAbort(reader.read(), signal) : await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          processPayload(trimmed.slice('data:'.length).trim());
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  } else {
    for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        processPayload(trimmed.slice('data:'.length).trim());
      }
    }
  }
  buffer += decoder.decode();
  for (const line of buffer.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data:')) processPayload(trimmed.slice('data:'.length).trim());
  }

  emitProgress(true);

  return {
    text: visibleText,
    toolCalls: Array.from(toolCalls.entries())
      .sort(([left], [right]) => left - right)
      .map(([index, call]) => ({
        id: call.id || `tool-call-${index}`,
        type: 'function' as const,
        function: { name: call.name, arguments: call.arguments || '{}' },
      }))
      .filter((call) => call.function.name),
    ...(finishReason ? { finishReason } : {}),
    ...(usage ? { usage } : {}),
    ...(reasoningSummary ? { reasoningSummary } : {}),
    ...(promptPrefillDurationMs !== undefined ? { promptPrefillDurationMs } : {}),
  };
}

export class LocalModelLLMProvider implements LLMProvider {
  private readonly baseUrl: string;
  private readonly configuredModel: string;
  private readonly explicitEnabled: boolean | undefined;
  private readonly routeKind: 'local' | 'colab';

  constructor(baseUrl?: string, model?: string, enabled?: boolean, routeKind: 'local' | 'colab' = 'local') {
    this.routeKind = routeKind;
    this.baseUrl = (baseUrl || (routeKind === 'colab'
      ? getRuntimeEnvValue('COLAB_MODEL_BASE_URL', '')
      : getRuntimeEnvValue('LOCAL_MODEL_BASE_URL', 'http://127.0.0.1:11434/v1'))).replace(/\/+$/, '');
    this.configuredModel = model || (routeKind === 'colab'
      ? getRuntimeEnvValue('COLAB_MODEL_MODEL', '')
      : getRuntimeEnvValue('LOCAL_MODEL_MODEL', 'qwen2.5-coder'));
    this.explicitEnabled = enabled;
  }

  async createChatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options?: LLMCompletionOptions,
  ): Promise<string> {
    if (!this.isAvailable()) throw new Error(`${this.routeKind === 'colab' ? 'Colab model' : 'Local model'} provider is disabled`);
    const configuredTarget = this.routeKind === 'colab'
      ? resolveColabModelTarget(model)
      : resolveLocalAIModelTarget(model);
    if ((isLocalAITargetValue(model) || isColabTargetValue(model)) && !configuredTarget) {
      throw new Error(`${isColabTargetValue(model) ? 'Colab model' : 'Local AI'} target "${model}" is missing or disabled.`);
    }
    const selectedBaseUrl = configuredTarget?.baseUrl || this.baseUrl;
    const selectedModel = configuredTarget?.modelId
      || (model.startsWith('local:') ? model.slice('local:'.length) : this.configuredModel);
    const runtimeContextWindow = configuredTarget?.runtimeContextWindow || configuredTarget?.contextWindow;
    const configuredInputTokenLimit = configuredTarget?.inputTokenLimit || DEFAULT_LOCAL_AI_INPUT_TOKEN_LIMIT;
    // Keep output room inside the live server context. The runtime value is
    // populated by endpoint discovery, so this adapts to new models without
    // baking a llama.cpp/model-specific limit into the provider.
    const inputTokenLimit = runtimeContextWindow
      ? Math.min(
          configuredInputTokenLimit,
          Math.max(512, Math.floor(runtimeContextWindow * LOCAL_INPUT_CONTEXT_RESERVE_RATIO)),
        )
      : configuredInputTokenLimit;
    const { budget, owned: ownsBudget } = getRequestBudget(options, model);
    const remaining = budget.remainingMs();
    const timeoutMs = Number.isFinite(remaining) ? Math.max(1, Math.floor(remaining)) : options?.timeoutMs;
    const isStreamedStructuredAction = Boolean(options?.stream && options.requestKind === 'step.plan_action');
    const isStructuredActionRequest = options?.requestKind === 'step.plan_action';
    const idleTimeoutMs = isStreamedStructuredAction
      ? options?.idleTimeoutMs || getRuntimeLocalActionIdleTimeoutMs()
      : options?.idleTimeoutMs;
    const deadline = createAttemptDeadline(budget.signal, timeoutMs, idleTimeoutMs);
    try {
      consumeRequestBudget(budget, this.routeKind, selectedModel);
      const qwenModel = isQwen3Model(selectedModel)
        || isQwen3Model(model)
        || (configuredTarget ? isQwen3Model(configuredTarget.modelId || configuredTarget.title) : false);
      // The separate reason() turn owns model thinking. Structured action
      // requests need a compact action payload, so enforce this at the local
      // adapter even when the planner's unified-thinking setting is enabled.
      const disableLocalThinking = Boolean(options?.disableLocalThinking || isStructuredActionRequest);
      const reserveQwenOutput = qwenModel && (!options?.disableLocalThinking || isStructuredActionRequest);
      const request = (requestMessages: Array<{ role: string; content: string }>, maxTokens?: number, includeTools = true) => fetch(`${selectedBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: requestMessages,
          temperature: options?.temperature,
          max_tokens: maxTokens,
          top_p: options?.topP,
          stream: Boolean(options?.stream),
          cache_prompt: options?.cachePrompt !== false,
          // Health probes and structured action requests may suppress Qwen3
          // thinking. Other harness requests explicitly set the server default.
          ...(qwenModel
            ? { chat_template_kwargs: { enable_thinking: !disableLocalThinking } }
            : {}),
          ...(includeTools && options?.tools?.length ? {
            tools: options.tools,
            tool_choice: options.toolChoice || 'auto',
          } : {}),
        }),
        signal: deadline.signal,
      });
      const preservesQwenThinking = qwenModel && !disableLocalThinking;
      const initialMessages = compactLocalMessages(messages, inputTokenLimit);
      const requestedMaxTokens = initialMessages === messages
        ? (reserveQwenOutput
            ? Math.max(options?.maxTokens || LOCAL_QWEN3_MIN_OUTPUT_TOKENS, LOCAL_QWEN3_MIN_OUTPUT_TOKENS)
            : options?.maxTokens)
        : (reserveQwenOutput
            ? Math.max(options?.maxTokens || LOCAL_QWEN3_MIN_OUTPUT_TOKENS, LOCAL_QWEN3_MIN_OUTPUT_TOKENS)
            : Math.min(options?.maxTokens || LOCAL_CONTEXT_RETRY_MAX_OUTPUT_TOKENS, LOCAL_CONTEXT_RETRY_MAX_OUTPUT_TOKENS));
      const initialMaxTokens = reserveQwenOutput
        ? Math.max(requestedMaxTokens || 0, LOCAL_QWEN3_MIN_OUTPUT_TOKENS)
        : requestedMaxTokens;
      let responseMessages = initialMessages;
      let responseMaxTokens = initialMaxTokens;
      let response = await raceWithAbort(request(initialMessages, initialMaxTokens), deadline.signal);
      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        const isContextError = response.status === 400 && /context size|exceed_context_size/i.test(errorBody);
        const isToolsUnsupported = (response.status === 400 || response.status === 422) && /tools?|tool_choice|function/i.test(errorBody) && Boolean(options?.tools?.length);
        if (isToolsUnsupported) {
          response = await raceWithAbort(request(initialMessages, initialMaxTokens, false), deadline.signal);
        } else if (isContextError) {
          const compactedMessages = compactLocalMessages(messages, localContextRetryInputTokens(errorBody, inputTokenLimit));
          const compactedRequestedMaxTokens = Math.min(options?.maxTokens || LOCAL_CONTEXT_RETRY_MAX_OUTPUT_TOKENS, LOCAL_CONTEXT_RETRY_MAX_OUTPUT_TOKENS);
          const compactedMaxTokens = preservesQwenThinking
            ? Math.max(compactedRequestedMaxTokens, LOCAL_QWEN3_MIN_OUTPUT_TOKENS)
            : compactedRequestedMaxTokens;
          responseMessages = compactedMessages;
          responseMaxTokens = compactedMaxTokens;
          response = await raceWithAbort(request(compactedMessages, compactedMaxTokens), deadline.signal);
          if (!response.ok) {
            const retryBody = await response.text().catch(() => '');
            throw new Error(`Local model request failed with HTTP ${response.status}${retryBody ? `: ${retryBody.slice(0, 500)}` : ''}`);
          }
        } else {
          throw new Error(`Local model request failed with HTTP ${response.status}${errorBody ? `: ${errorBody.slice(0, 500)}` : ''}`);
        }
      }
      if (options?.stream && (response.headers.get('content-type') || '').includes('text/event-stream')) {
        const streamed = await readLocalCompletionStream(response, options, deadline.signal, deadline.touch);
        const streamedContent = streamed.text.trim()
          ? streamed.text
          : streamed.toolCalls.length > 0
            ? JSON.stringify({ role: 'assistant', tool_calls: streamed.toolCalls })
            : options?.requestKind === 'step.reason' && streamed.reasoningSummary?.trim()
              ? streamed.reasoningSummary
              : options?.requestKind === 'step.reason'
                ? 'I reviewed the current evidence and will choose the next concrete action.'
                : '';
        reportCompletionResult(options, {
          text: streamedContent,
          toolCalls: streamed.toolCalls,
          ...(streamed.reasoningSummary ? { reasoningSummary: streamed.reasoningSummary } : {}),
          ...(streamed.finishReason ? { finishReason: sanitizeLocalFinishReason(streamed.finishReason) } : {}),
          ...(streamed.usage ? { usage: streamed.usage } : {}),
          ...(streamed.promptPrefillDurationMs !== undefined ? { promptPrefillDurationMs: streamed.promptPrefillDurationMs } : {}),
          provider: this.routeKind,
          model: selectedModel,
        });
        if (!streamedContent.trim()) {
          throw new Error(`Local model stream returned no usable content (finish reason: ${streamed.finishReason || 'unknown'})`);
        }
        return streamedContent;
      }
      let data: any = await response.json();
      let message = data?.choices?.[0]?.message;
      let content = message?.content;
      let usableContent = typeof content === 'string' && content.trim() ? stripLocalThinkingMarkup(content) : '';

      // 1. Rescue: native OpenAI-style tool_calls from local model
      if (!usableContent.trim() && Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
        const rawReasoning = (typeof message?.reasoning_content === 'string' ? message.reasoning_content : message?.reasoning) || '';
        usableContent = JSON.stringify({
          role: typeof message.role === 'string' ? message.role : 'assistant',
          ...(rawReasoning.trim() ? { reasoning: rawReasoning.trim() } : {}),
          tool_calls: message.tool_calls,
        });
      }

      // Qwen3 may spend the first budget entirely in reasoning and return an
      // otherwise successful response with no visible content. Give that
      // request one bounded retry with more room for both phases. Thinking is
      // deliberately left enabled; a reasoning-only response is not a valid
      // harness answer and must not be surfaced as the final response.
      const finishReason = data?.choices?.[0]?.finish_reason;
      const hasHiddenReasoning = (typeof message?.reasoning_content === 'string' && message.reasoning_content.trim().length > 0)
        || (typeof message?.reasoning === 'string' && message.reasoning.trim().length > 0);

      // 2. Rescue: check if model embedded a JSON tool call or action inside reasoning_content
      if (!usableContent.trim() && hasHiddenReasoning) {
        const rawReasoning = (typeof message?.reasoning_content === 'string' ? message.reasoning_content : message?.reasoning) || '';
        const jsonMatch = rawReasoning.match(/\{[\s\S]*"(?:tool|action)"[\s\S]*\}/);
        if (jsonMatch) {
          try {
            JSON.parse(jsonMatch[0]);
            usableContent = jsonMatch[0];
          } catch {
            // Ignore malformed embedded JSON and continue trying the remaining rescue formats.
          }
        }
        if (!usableContent.trim()) {
          const funcMatch = rawReasoning.match(/\{[\s\S]*"(?:name|function)"[\s\S]*"arguments"[\s\S]*\}/);
          if (funcMatch) {
            try {
              const parsed = JSON.parse(funcMatch[0]);
              const toolName = typeof parsed.name === 'string' ? parsed.name : parsed.function?.name;
              const toolArgs = parsed.arguments ?? parsed.function?.arguments;
              if (toolName && toolArgs) {
                usableContent = JSON.stringify({
                  role: 'assistant',
                  ...(rawReasoning.trim() ? { reasoning: rawReasoning.trim() } : {}),
                  tool_calls: [{
                    id: 'call_' + Date.now(),
                    type: 'function',
                    function: {
                      name: toolName,
                      arguments: typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs),
                    },
                  }],
                });
              }
            } catch {
              // Ignore malformed embedded function arguments.
            }
          }
        }
        if (!usableContent.trim()) {
          const xmlMatch = rawReasoning.match(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/i);
          if (xmlMatch) {
            usableContent = xmlMatch[0];
          }
        }
      }

      // 3. Retry with larger output budget if content was empty and reasoning truncated
      if (
        (preservesQwenThinking || hasHiddenReasoning)
        && !usableContent.trim()
        && (finishReason === 'length' || hasHiddenReasoning)
      ) {
        const retryMaxTokens = Math.min(
          Math.max((responseMaxTokens || LOCAL_QWEN3_MIN_OUTPUT_TOKENS) * 2, LOCAL_QWEN3_MIN_OUTPUT_TOKENS * 2),
          LOCAL_QWEN3_RETRY_MAX_OUTPUT_TOKENS,
        );
        if (retryMaxTokens > (responseMaxTokens || 0)) {
          try {
            const compactedMessagesForRetry = compactLocalMessages(messages, Math.max(1024, inputTokenLimit - 1000));
            const retryResponse = await raceWithAbort(request(compactedMessagesForRetry, retryMaxTokens), deadline.signal);
            if (retryResponse.ok) {
              data = await retryResponse.json();
              message = data?.choices?.[0]?.message;
              content = message?.content;
              usableContent = typeof content === 'string' && content.trim() ? stripLocalThinkingMarkup(content) : '';

              if (!usableContent.trim() && Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
                const retryReasoning = (typeof message?.reasoning_content === 'string' ? message.reasoning_content : message?.reasoning) || '';
                usableContent = JSON.stringify({
                  role: typeof message.role === 'string' ? message.role : 'assistant',
                  ...(retryReasoning.trim() ? { reasoning: retryReasoning.trim() } : {}),
                  tool_calls: message.tool_calls,
                });
              }

              if (!usableContent.trim()) {
                const retryReasoning = (typeof message?.reasoning_content === 'string' ? message.reasoning_content : message?.reasoning) || '';
                const jsonMatch = retryReasoning.match(/\{[\s\S]*"(?:tool|action)"[\s\S]*\}/);
                if (jsonMatch) {
                  try {
                    JSON.parse(jsonMatch[0]);
                    usableContent = jsonMatch[0];
                  } catch {
                    // Ignore malformed embedded JSON and continue trying the remaining rescue formats.
                  }
                }
                if (!usableContent.trim()) {
                  const funcMatch = retryReasoning.match(/\{[\s\S]*"(?:name|function)"[\s\S]*"arguments"[\s\S]*\}/);
                  if (funcMatch) {
                    try {
                      const parsed = JSON.parse(funcMatch[0]);
                      const toolName = typeof parsed.name === 'string' ? parsed.name : parsed.function?.name;
                      const toolArgs = parsed.arguments ?? parsed.function?.arguments;
                      if (toolName && toolArgs) {
                        usableContent = JSON.stringify({
                          role: 'assistant',
                          ...(retryReasoning.trim() ? { reasoning: retryReasoning.trim() } : {}),
                          tool_calls: [{
                            id: 'call_' + Date.now(),
                            type: 'function',
                            function: {
                              name: toolName,
                              arguments: typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs),
                            },
                          }],
                        });
                      }
                    } catch {
                      // Ignore malformed embedded function arguments.
                    }
                  }
                }
                if (!usableContent.trim()) {
                  const xmlMatch = retryReasoning.match(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/i);
                  if (xmlMatch) {
                    usableContent = xmlMatch[0];
                  }
                }
              }
            }
          } catch (error) {
            if (deadline.signal.aborted) throw error;
          }
        }
      }
      reportSafeReasoningSummary(options, data, usableContent, this.routeKind, selectedModel);
      if (!usableContent.trim()) throw new Error('Local model returned no usable content');
      return usableContent;
    } finally {
      deadline.cleanup();
      if (ownsBudget) budget.cleanup();
    }
  }

  async *streamChatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options: LLMCompletionOptions = {},
  ): AsyncIterable<LLMCompletionStreamEvent> {
    const events: LLMCompletionStreamEvent[] = [];
    let wake: (() => void) | undefined;
    let done = false;
    const push = (event: LLMCompletionStreamEvent) => {
      events.push(event);
      options.onStreamEvent?.(event);
      wake?.();
      wake = undefined;
    };
    const completion = this.createChatCompletion(messages, model, {
      ...options,
      stream: true,
      onStreamEvent: push,
    }).then((text) => {
      push({
        type: 'completed',
        result: {
          text,
          toolCalls: [],
          provider: this.routeKind,
          model,
        },
      });
    }).catch((error) => {
      push({ type: 'error', error: { code: 'LOCAL_STREAM_ERROR', message: error instanceof Error ? error.message : String(error) } });
    }).finally(() => {
      done = true;
      wake?.();
      wake = undefined;
    });

    while (!done || events.length) {
      if (!events.length) await new Promise<void>((resolve) => { wake = resolve; });
      while (events.length) yield events.shift()!;
    }
    await completion;
  }

  estimateStepCost(): number { return 0; }
  getProviderName(): string { return this.routeKind; }
  isAvailable(): boolean {
    return this.explicitEnabled
      ?? (this.routeKind === 'colab' ? getColabEndpoints() : getLocalAIEndpoints())
        .some((endpoint) => endpoint.enabled && Boolean(endpoint.modelId));
  }
}

export class ColabModelLLMProvider extends LocalModelLLMProvider {
  constructor(baseUrl?: string, model?: string, enabled?: boolean) {
    super(baseUrl, model, enabled, 'colab');
  }
}

/** Composite LLM provider with route-aware fallback and cooldown handling. */
export class CompositeLLMProvider implements LLMProvider {
  private providers: LLMProvider[];

  constructor(providers: LLMProvider[]) {
    const availableProviders = providers.filter((p) => p.isAvailable());
    if (availableProviders.filter((provider) => provider.getProviderName() === 'groq').length > 1) {
      throw new Error('Multiple Groq provider instances are not supported. Configure exactly one GROQ_API_KEY.');
    }
    this.providers = availableProviders;
    if (this.providers.length === 0) {
      throw new Error('No LLM providers available');
    }
  }

  async createChatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options?: LLMCompletionOptions
  ): Promise<string> {
    const errors: ProviderFailureContext[] = [];
    const { budget: requestBudget, owned: ownsBudget } = getRequestBudget(options, model);
    const estimatedInputTokens = estimateProviderInputTokens(messages);
    const explicitlyRequestsGroq = isGroqModel(model) || isLegacyGroqTargetModelValue(model);
    const explicitlyRequestsCerebras = isCerebrasModel(model);
    const explicitlyRequestsSambaNova = isSambaNovaModel(model);
    const explicitlyRequestsLocal = isLocalModel(model);
    const explicitlyRequestsColab = isColabModel(model);
    if (explicitlyRequestsGroq && !this.providers.some((provider) => provider.getProviderName() === 'groq')) {
      if (ownsBudget) requestBudget.cleanup();
      throw new Error(
        'Groq provider is unavailable. Ensure GROQ_ENABLED=true, configure one GROQ_API_KEY, and configure a Groq default model before retrying.',
      );
    }
    if (explicitlyRequestsCerebras && !this.providers.some((provider) => provider.getProviderName() === 'cerebras')) {
      if (ownsBudget) requestBudget.cleanup();
      throw new Error(
        'Cerebras provider is unavailable. Configure CEREBRAS_API_KEY and restart the server before retrying.',
      );
    }
    if (explicitlyRequestsSambaNova && !this.providers.some((provider) => provider.getProviderName() === 'sambanova')) {
      if (ownsBudget) requestBudget.cleanup();
      throw new Error(
        'SambaNova provider is unavailable. Configure SAMBANOVA_API_KEY and restart the server before retrying.',
      );
    }
    if (explicitlyRequestsLocal && !this.providers.some((provider) => provider.getProviderName() === 'local')) {
      if (ownsBudget) requestBudget.cleanup();
      throw new Error('Local AI provider is unavailable. Add and enable a local endpoint in API Pool before retrying.');
    }
    if (explicitlyRequestsColab && !this.providers.some((provider) => provider.getProviderName() === 'colab')) {
      if (ownsBudget) requestBudget.cleanup();
      throw new Error('Colab model provider is unavailable. Add and enable a Colab model endpoint in API Pool before retrying.');
    }

    const orderedProviders = explicitlyRequestsColab
      ? [
          ...this.providers.filter((provider) => provider.getProviderName() === 'colab'),
          ...this.providers.filter((provider) => provider.getProviderName() !== 'colab'),
        ]
      : explicitlyRequestsLocal
      ? [
          ...this.providers.filter((provider) => provider.getProviderName() === 'local'),
          ...this.providers.filter((provider) => provider.getProviderName() !== 'local'),
        ]
      : isOpenRouterModel(model)
      ? [
          ...this.providers.filter((provider) => provider.getProviderName() === 'openrouter'),
          ...this.providers.filter((provider) => provider.getProviderName() !== 'openrouter'),
        ]
      : explicitlyRequestsGroq
      ? [
          ...this.providers.filter((provider) => provider.getProviderName() === 'groq'),
          ...this.providers.filter((provider) => provider.getProviderName() === 'local'),
          ...this.providers.filter((provider) => provider.getProviderName() !== 'groq' && provider.getProviderName() !== 'local'),
        ]
      : isKimiModel(model)
      ? [
          ...this.providers.filter((provider) => provider.getProviderName() === 'kimi'),
          ...this.providers.filter((provider) => provider.getProviderName() !== 'kimi'),
        ]
      : isCerebrasModel(model)
      ? [
          ...this.providers.filter((provider) => provider.getProviderName() === 'cerebras'),
          ...this.providers.filter((provider) => provider.getProviderName() !== 'cerebras'),
        ]
      : isSambaNovaModel(model)
      ? [
          ...this.providers.filter((provider) => provider.getProviderName() === 'sambanova'),
          ...this.providers.filter((provider) => provider.getProviderName() !== 'sambanova'),
        ]
      : isRequestyModel(model)
      ? [
          ...this.providers.filter((provider) => provider.getProviderName() === 'requesty'),
          ...this.providers.filter((provider) => provider.getProviderName() !== 'requesty'),
        ]
      : isNvidiaModel(model)
      ? [
          ...this.providers.filter((provider) => provider.getProviderName() === 'nvidia'),
          ...this.providers.filter((provider) => provider.getProviderName() === 'openrouter'),
          ...this.providers.filter((provider) => provider.getProviderName() !== 'nvidia' && provider.getProviderName() !== 'openrouter'),
        ]
      : isNvidiaTargetModelValue(model)
      ? [
          ...this.providers.filter((provider) => provider.getProviderName() === 'nvidia'),
          ...this.providers.filter((provider) => provider.getProviderName() === 'openrouter'),
          ...this.providers.filter((provider) => provider.getProviderName() !== 'nvidia' && provider.getProviderName() !== 'openrouter'),
        ]
      : isGeminiTargetModelValue(model)
      ? [
          ...this.providers.filter((provider) => provider.getProviderName() === 'gemini'),
          ...this.providers.filter((provider) => provider.getProviderName() !== 'gemini'),
        ]
      : isPollinationsOnlyModel(model)
      ? [
          ...this.providers.filter((provider) => provider.getProviderName() === 'pollinations'),
          ...this.providers.filter((provider) => provider.getProviderName() !== 'pollinations'),
        ]
      : isGeminiModel(model)
      ? [
          ...this.providers.filter((provider) => provider.getProviderName() === 'gemini'),
          ...this.providers.filter((provider) => provider.getProviderName() !== 'gemini'),
        ]
      : this.providers;

    type ProviderRoute = {
      provider: LLMProvider;
      providerName: string;
      providerModel: string;
      nvidiaApiKeyIndex?: number;
      geminiApiKeyIndex?: number;
      resolvedModel: string;
      requestedTarget: string;
      apiKeyIndex?: number;
      routeKind: 'primary' | 'same_provider_model';
      /** One bounded retry after a provider-supplied short cooldown. */
      rateLimitRetry?: boolean;
      ignorePauseOnce?: boolean;
      notBeforeAt?: number;
    };
    const selectedNvidiaTarget = resolveNvidiaModelTarget(model);
    const selectedGeminiTarget = resolveGeminiModelTarget(model);
    const baseRoutes: ProviderRoute[] = orderedProviders.map((provider) => {
      const providerName = provider.getProviderName();
      const routedProviderModel = getProviderModel(providerName, model);
      const providerModel = providerName === 'openrouter'
        ? resolveOpenRouterRequestModel(routedProviderModel, options?.requestKind)
        : routedProviderModel;
      const selectedTarget = providerName === 'nvidia'
        ? selectedNvidiaTarget
        : providerName === 'gemini'
          ? selectedGeminiTarget
          : null;
      return {
        provider,
        providerName,
        providerModel,
        resolvedModel: selectedTarget?.modelId || providerModel,
        requestedTarget: selectedTarget ? model : providerModel,
        apiKeyIndex: selectedTarget?.apiKeyIndex,
        routeKind: 'primary',
      };
    });
    const providerRoutes: ProviderRoute[] = [];
    for (const route of baseRoutes) {
      if (route.provider instanceof NvidiaLLMProvider) {
        const initialKeyIndex = selectedNvidiaTarget?.apiKeyIndex ?? 0;
        const indices = [
          initialKeyIndex,
          ...Array.from({ length: route.provider.getApiKeyCount() }, (_value, index) => index)
            .filter((index) => index !== initialKeyIndex),
        ];
        providerRoutes.push(...indices
          .filter((index) => route.provider instanceof NvidiaLLMProvider && route.provider.hasKeyAtIndex(index))
          .map((index) => ({ ...route, nvidiaApiKeyIndex: index, apiKeyIndex: index })));
        continue;
      }
      providerRoutes.push(route);
    }

    const requestedProviderName = explicitlyRequestsColab ? 'colab'
      : explicitlyRequestsLocal ? 'local'
      : isOpenRouterModel(model) ? 'openrouter'
      : isGroqModel(model) || isLegacyGroqTargetModelValue(model) ? 'groq'
      : isCerebrasModel(model) ? 'cerebras'
      : isSambaNovaModel(model) ? 'sambanova'
      : isKimiModel(model) ? 'kimi'
      : isRequestyModel(model) ? 'requesty'
      : isNvidiaModel(model) || isNvidiaTargetModelValue(model) ? 'nvidia'
      : isPollinationsOnlyModel(model) ? 'pollinations'
      : isGeminiModel(model) || isGeminiTargetModelValue(model) ? 'gemini'
      : undefined;
    const sameProviderFallbackModels = [...new Set(options?.pinModel ? [] : options?.sameProviderFallbackModels || [])]
      .map((candidate) => candidate.trim())
      .filter((candidate) => candidate && candidate !== model);
    const isFallbackModelForSelectedProvider = (candidate: string): boolean => (
      requestedProviderName === 'gemini' && isGeminiModel(candidate)
    );
    if (requestedProviderName) {
      const selectedProvider = orderedProviders.find((provider) => provider.getProviderName() === requestedProviderName);
      for (const fallbackModel of sameProviderFallbackModels) {
        if (!selectedProvider || !isFallbackModelForSelectedProvider(fallbackModel)) continue;
        const providerModel = getProviderModel(requestedProviderName, fallbackModel);
        if (providerRoutes.some((route) => route.providerName === requestedProviderName && route.resolvedModel === providerModel)) continue;
        providerRoutes.push({
          provider: selectedProvider,
          providerName: requestedProviderName,
          providerModel,
          resolvedModel: providerModel,
          requestedTarget: model,
          routeKind: 'same_provider_model',
        });
      }
    }

    const coldPriority = (route: ProviderRoute): number => {
      const credential = route.apiKeyIndex ?? 0;
      const checkDoneOffset = options?.requestKind === 'step.check_done'
        ? ({ openrouter: -4, groq: -3, requesty: -2 } as Record<string, number>)[route.providerName] || 0
        : 0;
      const base = route.providerName === 'nvidia'
        ? credential === 0 ? 0 : 5 + (credential - 1) * 3
        : route.providerName === 'gemini'
          ? credential === 0 ? 1 : 6 + (credential - 1) * 3
          : ({ openrouter: 2, groq: 3, cerebras: 3, sambanova: 4, requesty: 5, kimi: 8 } as Record<string, number>)[route.providerName] ?? 20;
      return base + checkDoneOffset;
    };
    const scoredAt = Date.now();
    const requestedCredentialIndex = requestedProviderName === 'nvidia'
      ? selectedNvidiaTarget?.apiKeyIndex ?? 0
      : requestedProviderName === 'gemini'
        ? selectedGeminiTarget?.apiKeyIndex ?? 0
        : 0;
    const hasExplicitFallbackPolicy = typeof options?.allowCrossProviderFallback === 'boolean'
      || typeof options?.fallbackApprovalGranted === 'boolean'
      || Array.isArray(options?.approvedFallbackProviders)
      || Array.isArray(options?.allowedExternalProviders);
    const approvedFallbacks = options?.approvedFallbackProviders || [];
    const isExternalProviderName = (providerName: string): boolean => providerName !== 'local';
    const workspaceAllowsProviderName = (providerName: string): boolean =>
      !isExternalProviderName(providerName)
      || !options?.allowedExternalProviders
      || options.allowedExternalProviders.includes(providerName);
    const privateSourceAllowsProviderName = (providerName: string): boolean =>
      !isExternalProviderName(providerName)
      || !options?.privateWorkspace
      || options.sendPrivateSourceCode === true;
    const isCrossProviderRouteAuthorized = (route: ProviderRoute): boolean => {
      if (options?.pinModel) {
        return requestedProviderName
          ? route.providerName === requestedProviderName
          : route.resolvedModel === model;
      }
      if (!requestedProviderName || route.providerName === requestedProviderName) return true;
      if (!hasExplicitFallbackPolicy) return true;
      return options?.allowCrossProviderFallback === true
        && options?.fallbackApprovalGranted === true
        && approvedFallbacks.includes(route.providerName)
        && workspaceAllowsProviderName(route.providerName)
        && privateSourceAllowsProviderName(route.providerName);
    };
    const routeScore = (route: ProviderRoute): number => {
      const status = getProviderRouteStatus(
        route.providerName, route.resolvedModel, scoredAt, route.apiKeyIndex,
      );
      const selectedRouteIsStillHealthy = !status
        || status.requestCount === 0
        || status.successCount >= status.failureCount;
      return getProviderRouteHealthScore(
        route.providerName, route.resolvedModel, scoredAt, route.apiKeyIndex,
      ) + (
      options?.requestKind !== 'step.check_done'
      && route.providerName === requestedProviderName
      && (route.apiKeyIndex ?? 0) === requestedCredentialIndex
      && selectedRouteIsStillHealthy
        ? 30
        : 0
      );
    };
    providerRoutes.sort((left, right) => {
      // A route described as a fallback must never displace the provider the
      // caller selected. Legacy/internal callers without policy fields retain
      // health-first ordering until they opt into the task policy contract.
      if (hasExplicitFallbackPolicy && requestedProviderName) {
        const selectedRank = (route: ProviderRoute): number =>
          route.providerName !== requestedProviderName ? 2 : route.routeKind === 'primary' ? 0 : 1;
        const rankDifference = selectedRank(left) - selectedRank(right);
        if (rankDifference) return rankDifference;
      }
      if (requestedProviderName && left.providerName === requestedProviderName && right.providerName === requestedProviderName) {
        const routeKindDifference = (left.routeKind === 'primary' ? 0 : 1) - (right.routeKind === 'primary' ? 0 : 1);
        if (routeKindDifference) return routeKindDifference;
      }
      if (requestedProviderName === 'gemini') {
        const fallbackRank = (route: ProviderRoute): number =>
          ({ gemini: 0, local: 1, nvidia: 2 } as Record<string, number>)[route.providerName] ?? 3;
        const rankDifference = fallbackRank(left) - fallbackRank(right);
        if (rankDifference) return rankDifference;
      }
      const scoreDifference = routeScore(right) - routeScore(left);
      return scoreDifference || coldPriority(left) - coldPriority(right);
    });
    // Remove policy-ineligible destinations before calculating fair-share
    // slices. Counting routes that can never execute starves the selected
    // provider (for example, six skipped destinations could turn a 120-second
    // request into a 20-second primary attempt).
    if (hasExplicitFallbackPolicy || options?.pinModel) {
      const authorizedRoutes = providerRoutes.filter(isCrossProviderRouteAuthorized);
      providerRoutes.splice(0, providerRoutes.length, ...authorizedRoutes);
    }

    // Track every configured credential, but bound one handover chain so adding
    // keys cannot consume an unbounded planner deadline. Demoted routes become
    // eligible on the next request as healthier/cold credentials move upward.
    const activeRoutes = providerRoutes.filter((route) => !isProviderRoutePaused(
      route.providerName, route.resolvedModel, scoredAt, route.apiKeyIndex,
    )).slice(0, 10);
    const pausedRoutes = providerRoutes.filter((route) => isProviderRoutePaused(
      route.providerName, route.resolvedModel, scoredAt, route.apiKeyIndex,
    ));
    providerRoutes.splice(0, providerRoutes.length, ...activeRoutes, ...pausedRoutes);

    let lastProviderAttemptStartedAt = 0;
    let groqFailureAllowsFallback = false;
    let groqFallbackReason: 'rate_limit' | 'quota_exhausted' | 'model_unavailable' | 'temporarily_unavailable' | undefined;
    const configuredRouteIntervalMs = typeof options?.minimumRouteIntervalMs === 'number' && Number.isFinite(options.minimumRouteIntervalMs)
      ? Math.max(0, Math.min(Math.floor(options.minimumRouteIntervalMs), 60_000))
      : 0;

    try {
    for (const [providerIndex, route] of providerRoutes.entries()) {
      // Dispatch the first provider even for an already-aborted signal so its
      // returned promise receives rejection handlers (some transports reject
      // asynchronously). Never start a fallback after cancellation/expiry.
      if (providerIndex > 0 && (requestBudget.signal.aborted || requestBudget.remainingMs() <= 0)) break;
      const { provider, providerName, providerModel } = route;
      if (route.routeKind === 'same_provider_model') {
        try {
          options?.onRouteSelected?.({
            provider: providerName,
            requestedTarget: route.requestedTarget,
            resolvedModel: route.resolvedModel,
            profileId: providerName === 'gemini' ? options?.geminiProfileId : undefined,
            credentialIndex: route.apiKeyIndex,
            reason: 'same_provider_model',
          });
        } catch {
          // Route observability must not affect routing.
        }
      }
      const isGroqCrossProviderFallback = requestedProviderName === 'groq' && providerName !== 'groq';
      const isCrossProviderFallback = Boolean(
        requestedProviderName && providerName !== requestedProviderName,
      );
      const workspaceAllowsProvider = workspaceAllowsProviderName(providerName);
      const privateSourceAllowsProvider = privateSourceAllowsProviderName(providerName);

      // Apply one authorization contract to every fallback destination. The
      // explicit task policy is fail-closed; callers that do not supply policy
      // fields retain the historical composite behavior for compatibility.
      if (isCrossProviderFallback && !isCrossProviderRouteAuthorized(route)) {
        continue;
      }
      // Workspace and private-source policies also govern the provider selected
      // directly by the caller. Record that denial because it is the actionable
      // primary failure, while unauthorized fallback destinations stay silent.
      if (!isCrossProviderFallback && (!workspaceAllowsProvider || !privateSourceAllowsProvider)) {
        const policyError = !workspaceAllowsProvider
          ? `Workspace policy does not allow ${providerName}.`
          : `Private workspace source cannot be sent to ${providerName} without explicit approval.`;
        errors.push({
          provider: providerName,
          requestedTarget: route.requestedTarget,
          model: route.resolvedModel,
          apiKeyIndex: route.apiKeyIndex,
          error: policyError,
        });
        continue;
      }
      if (isGroqCrossProviderFallback && (
        !groqFailureAllowsFallback
      )) {
        continue;
      }
      if (isGroqCrossProviderFallback) {
        const groqProvider = this.providers.find((candidate): candidate is GroqLLMProvider => candidate instanceof GroqLLMProvider);
        const policy = groqProvider?.getFallbackPolicy();
        if (!policy?.fallbackEnabled
          || !policy.fallbackProviders.includes(providerName)
          || (policy.fallbackRequiresApproval && options?.fallbackApprovalGranted !== true)
          || !workspaceAllowsProvider
          || !privateSourceAllowsProvider) {
          continue;
        }
        if (groqFallbackReason) {
          recordGroqFallbackAudit({ destination: providerName, reason: groqFallbackReason, approved: true });
        }
      }
      const usesNativeRateLimitTransport = provider instanceof GeminiLLMProvider
        || provider instanceof NvidiaLLMProvider
        || provider instanceof OpenRouterLLMProvider
        || providerName === 'groq';
      const routeStatusBeforeDispatch = getProviderRouteStatus(
        providerName,
        route.resolvedModel,
        Date.now(),
        route.apiKeyIndex,
      );
      const allowExplicitRateLimitProbe = options?.allowProviderRouteProbe === true
        && route.routeKind === 'primary'
        && routeStatusBeforeDispatch?.pauseReason === 'rate_limit';
      if (usesNativeRateLimitTransport && !route.ignorePauseOnce && !allowExplicitRateLimitProbe && isProviderRoutePaused(
        providerName,
        route.resolvedModel,
        Date.now(),
        route.apiKeyIndex,
      )) {
        const pauseReason = getProviderRoutePauseReason(
          providerName,
          route.resolvedModel,
          Date.now(),
          route.apiKeyIndex,
        );
        const pausedError = pauseReason === 'billing_required'
          ? 'Route is paused because provider billing is required. Run a successful route test or reset the monitor after resolving the account balance.'
          : pauseReason === 'quota_exhausted'
            ? 'Route is paused because its request quota is exhausted. Wait for the provider reset or reset the monitor after upgrading the plan.'
          : `Route is paused because its rate-limit cooldown has not expired.${typeof routeStatusBeforeDispatch?.retryAfterMs === 'number'
              ? ` Retry available in ${Math.ceil(routeStatusBeforeDispatch.retryAfterMs / 1_000)}s.`
              : ''}`;
        errors.push({
          provider: providerName,
          requestedTarget: route.requestedTarget,
          model: route.resolvedModel,
          apiKeyIndex: route.apiKeyIndex,
          error: pausedError,
        });
        emitTelemetry(options, {
          provider: providerName,
          model: providerModel,
          requestKind: options?.requestKind,
          startedAt: Date.now(),
          durationMs: 0,
          status: 'skipped_budget',
          classification: pauseReason === 'billing_required'
            ? 'billing_required'
            : pauseReason === 'quota_exhausted'
              ? 'quota_exhausted'
              : 'rate_limit_cooldown',
          fallbackDecision: 'next_provider',
          error: pausedError,
        });
        continue;
      }
      const providerMinimumMs = getProviderMinimumSliceMs(providerName);
      const desiredRouteIntervalMs = configuredRouteIntervalMs;
      if (lastProviderAttemptStartedAt > 0 && (desiredRouteIntervalMs > 0 || route.notBeforeAt)) {
        const elapsedSinceLastRouteMs = Date.now() - lastProviderAttemptStartedAt;
        const intervalDelayMs = Math.max(0, desiredRouteIntervalMs - elapsedSinceLastRouteMs);
        const thresholdDelayMs = route.notBeforeAt ? Math.max(0, route.notBeforeAt - Date.now()) : 0;
        const requestedDelayMs = Math.max(intervalDelayMs, thresholdDelayMs);
        const remainingBeforeWaitMs = requestBudget.remainingMs();
        const maximumSafeWaitMs = Number.isFinite(remainingBeforeWaitMs)
          ? Math.max(0, Math.floor(remainingBeforeWaitMs - providerMinimumMs - PROVIDER_SLICE_HEADROOM_MS))
          : requestedDelayMs;
        const routeDelayMs = Math.min(requestedDelayMs, maximumSafeWaitMs);
        if (routeDelayMs > 0) {
          options?.onPacingWait?.({
            delayMs: routeDelayMs,
            provider: providerName,
            model: route.resolvedModel,
            scope: 'fallback',
          });
          await waitWithAbort(routeDelayMs, requestBudget.signal);
        }
      }
      const routeAcquired = !usesNativeRateLimitTransport || tryAcquireProviderRoute(
        providerName,
        route.resolvedModel,
        Date.now(),
        route.apiKeyIndex,
        allowExplicitRateLimitProbe,
      );
      if (!routeAcquired) {
        const pausedError = 'Route circuit is open or already has a half-open recovery probe in flight.';
        errors.push({
          provider: providerName,
          requestedTarget: route.requestedTarget,
          model: route.resolvedModel,
          apiKeyIndex: route.apiKeyIndex,
          error: pausedError,
        });
        emitTelemetry(options, {
          provider: providerName,
          model: providerModel,
          requestKind: options?.requestKind,
          startedAt: Date.now(),
          durationMs: 0,
          status: 'skipped_budget',
          classification: 'circuit_open',
          fallbackDecision: 'next_provider',
          error: pausedError,
        });
        continue;
      }
      const startedAt = Date.now();
      lastProviderAttemptStartedAt = startedAt;
      // Paused routes must not dilute the fair-share slice of providers that
      // can still run. Previously two cooled-down routes could leave Gemini
      // below its hard 10-second SDK minimum even though enough total budget
      // remained for Gemini and OpenRouter.
      const remainingProviders = Math.max(1, providerRoutes.slice(providerIndex).filter((candidate) => {
        const candidateUsesNativeTransport = candidate.provider instanceof GeminiLLMProvider
          || candidate.provider instanceof NvidiaLLMProvider
          || candidate.provider instanceof OpenRouterLLMProvider
          || candidate.providerName === 'groq';
        return !candidateUsesNativeTransport || !isProviderRoutePaused(
          candidate.providerName,
          candidate.resolvedModel,
          Date.now(),
          candidate.apiKeyIndex,
        );
      }).length);
      const remainingBudgetMs = requestBudget.remainingMs();
      const fairShareMs = Number.isFinite(remainingBudgetMs)
        ? Math.max(1, Math.floor(remainingBudgetMs / remainingProviders))
        : undefined;
      const viableMinimumMs = providerMinimumMs + PROVIDER_SLICE_HEADROOM_MS;
      // A provider gets a fair slice of what remains. The last provider gets the
      // rest; earlier providers cannot silently consume every fallback's time.
      // When the request can support a provider's hard attempt floor, include a
      // small handoff margin so setup overhead cannot turn an exact floor into
      // a no-call skip (for example, 20,000ms becoming 19,999ms).
      const providerSliceMs = Number.isFinite(remainingBudgetMs)
        ? Math.max(1, Math.min(
            Math.floor(remainingBudgetMs),
            remainingBudgetMs >= viableMinimumMs
              ? Math.max(fairShareMs || 1, viableMinimumMs)
              : fairShareMs || 1,
          ))
        : undefined;
      const providerBudget = createRequestBudget(
        requestBudget.signal,
        providerSliceMs,
        undefined,
        requestBudget,
      );
      let providerTelemetry: LLMRequestTelemetry | undefined;
      try {
        let completionResult: LLMCompletionResult | undefined;
        const response = await raceWithAbort(
          provider.createChatCompletion(messages, providerModel, {
            ...options,
            timeoutMs: providerSliceMs,
            signal: providerBudget.signal,
            requestBudget: providerBudget,
            nvidiaApiKeyIndex: route.nvidiaApiKeyIndex,
            geminiApiKeyIndex: route.geminiApiKeyIndex,
            onCompletionResult: (result) => {
              completionResult = result;
              options?.onCompletionResult?.(result);
            },
            onTelemetry: providerName === 'groq' || providerName === 'openrouter'
              ? (telemetry) => { providerTelemetry = telemetry; }
              : options?.onTelemetry,
          }),
          providerBudget.signal,
        );
        emitTelemetry(options, {
          ...providerTelemetry,
          provider: providerName,
          model: providerModel,
          requestKind: options?.requestKind,
          startedAt,
          durationMs: Date.now() - startedAt,
          status: 'succeeded',
          maxTokens: options?.maxTokens, allocatedBudgetMs: providerSliceMs,
          remainingBudgetMs: Math.floor(requestBudget.remainingMs()),
          estimatedInputTokens: providerTelemetry?.estimatedInputTokens ?? estimatedInputTokens,
          estimatedOutputTokens: providerTelemetry?.estimatedOutputTokens ?? Math.max(1, Math.ceil(response.length / 4)),
          reportedInputTokens: completionResult?.usage?.inputTokens ?? providerTelemetry?.reportedInputTokens,
          reportedOutputTokens: completionResult?.usage?.outputTokens ?? providerTelemetry?.reportedOutputTokens,
          promptPrefillDurationMs: completionResult?.promptPrefillDurationMs ?? providerTelemetry?.promptPrefillDurationMs,
          credentialIndex: route.apiKeyIndex,
          healthScore: routeScore(route),
        });
        recordProviderSuccess(providerName, route.resolvedModel, Date.now(), route.apiKeyIndex);
        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (providerName === 'groq') {
          groqFailureAllowsFallback = /rate limited|quota is exhausted|model (?:was not found|is unavailable)|temporarily unavailable|could not be reached/i.test(message);
          groqFallbackReason = /quota is exhausted/i.test(message) ? 'quota_exhausted'
            : /rate limited/i.test(message) ? 'rate_limit'
              : /model (?:was not found|is unavailable)/i.test(message) ? 'model_unavailable'
                : groqFailureAllowsFallback ? 'temporarily_unavailable'
                  : undefined;
        }
        const status = options?.signal?.aborted
          ? 'cancelled'
          : isSkippedProviderAttempt(message)
            ? 'skipped_budget'
          : providerBudget.signal.aborted
            ? 'timed_out'
            : 'failed';
        emitTelemetry(options, {
          ...providerTelemetry,
          provider: providerName,
          model: providerModel,
          requestKind: options?.requestKind,
          startedAt,
          durationMs: Date.now() - startedAt,
          status,
          maxTokens: options?.maxTokens,
          error: message,
          allocatedBudgetMs: providerSliceMs,
          remainingBudgetMs: Math.floor(requestBudget.remainingMs()),
          fallbackDecision: status === 'cancelled' ? 'stop' : 'next_provider',
          credentialIndex: route.apiKeyIndex,
          healthScore: routeScore(route),
        });
        errors.push({
          provider: providerName,
          requestedTarget: route.requestedTarget,
          model: route.resolvedModel,
          apiKeyIndex: route.apiKeyIndex,
          error: message,
        });
        if (status !== 'cancelled' && status !== 'skipped_budget') {
          recordProviderFailure(
            providerName,
            route.resolvedModel,
            getProviderFailureForRateMonitor(providerName, message),
            Date.now(),
            route.apiKeyIndex,
          );
        } else if (usesNativeRateLimitTransport) {
          releaseProviderRouteProbe(providerName, route.resolvedModel, route.apiKeyIndex);
        }
        const routeStatus = getProviderRouteStatus(providerName, route.resolvedModel, Date.now(), route.apiKeyIndex);
        const retryAfterMs = routeStatus?.pauseReason === 'rate_limit' ? routeStatus.retryAfterMs : undefined;
        const profileManagedGemini = provider instanceof GeminiLLMProvider;
        if (
          !profileManagedGemini &&
          providerName !== 'groq' &&
          options?.pacingProfile !== 'fast' &&
          !route.rateLimitRetry &&
          typeof retryAfterMs === 'number' &&
          retryAfterMs > 0 &&
          retryAfterMs <= 30_000 &&
          requestBudget.remainingMs() >= retryAfterMs + providerMinimumMs + PROVIDER_SLICE_HEADROOM_MS
        ) {
          providerRoutes.splice(providerIndex + 1, 0, {
            ...route,
            rateLimitRetry: true,
            ignorePauseOnce: true,
            notBeforeAt: Date.now() + retryAfterMs,
          });
        }
        if (status === 'cancelled') throw error;
      } finally {
        providerBudget.cleanup();
      }
    }
    } finally {
      if (ownsBudget) requestBudget.cleanup();
    }

    // All providers failed
    // The same provider can appear more than once when a later route retries a
    // secondary key. Keep that retry, but do not print an identical terminal
    // diagnosis twice and make it look like two independent providers failed.
    const errorSummary = Array.from(new Set(
      errors.map(summarizeProviderRouteFailure),
    )).join('\n');
    const exhausted = requestBudget.remainingMs() <= 0 || requestBudget.signal.aborted;
    throw new Error(
      `All LLM providers failed${exhausted ? ' within the end-to-end request deadline' : ''}:\n${errorSummary}`
    );
  }

  estimateStepCost(model: string): number {
    // Use first available provider's cost estimate
    return this.providers[0]?.estimateStepCost(model) ?? 0.00001;
  }

  getModelCapabilities(model: string): ModelCapabilities | undefined {
    const openRouterProvider = this.providers.find((provider) => provider.getProviderName() === 'openrouter');
    const explicitlyRequestsOpenRouter = isOpenRouterModel(model)
      || Boolean(getOpenRouterKnownModelMetadata(model))
      || Boolean(getOpenRouterModelTarget(model));
    const explicitlyRequestsNvidia = isNvidiaModel(model) || isNvidiaTargetModelValue(model);
    const selectedProvider = explicitlyRequestsOpenRouter
      ? openRouterProvider
      : explicitlyRequestsNvidia
        ? this.providers.find((provider) => provider.getProviderName() === 'nvidia')
        : this.providers.length === 1
          ? this.providers[0]
          : undefined;
    if (!selectedProvider?.getModelCapabilities) return undefined;
    return selectedProvider.getModelCapabilities(model);
  }

  getProviderName(): string {
    return `composite[${this.providers.map((p) => p.getProviderName()).join(',')}]`;
  }

  isAvailable(): boolean {
    return this.providers.length > 0;
  }
}

/**
 * Mock LLM Provider (for testing)
 */
export class MockLLMProvider implements LLMProvider {
  private responses: Map<string, string> = new Map();

  constructor(defaultResponse: string = 'Mock response') {
    this.responses.set('default', defaultResponse);
  }

  setResponse(key: string, response: string): void {
    this.responses.set(key, response);
  }

  async createChatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options?: LLMCompletionOptions
  ): Promise<string> {
    return this.responses.get(model) || this.responses.get('default') || 'Mock response';
  }

  estimateStepCost(model: string): number {
    return 0;
  }

  getProviderName(): string {
    return 'mock';
  }

  isAvailable(): boolean {
    return true;
  }
}
