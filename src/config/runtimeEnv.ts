import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { DEFAULT_CODER_MODEL_SELECTION } from './providerSelection.js';

const ENV_PATH = path.resolve(process.cwd(), '.env');

let cachedMtimeMs = -1;
let cachedValues: Record<string, string> = {};

function readEnvFile(): Record<string, string> {
  try {
    const stat = fs.statSync(ENV_PATH);
    if (stat.mtimeMs === cachedMtimeMs) return cachedValues;

    const raw = fs.readFileSync(ENV_PATH, 'utf8');
    cachedValues = dotenv.parse(raw);
    cachedMtimeMs = stat.mtimeMs;
    return cachedValues;
  } catch {
    cachedMtimeMs = -1;
    cachedValues = {};
    return cachedValues;
  }
}

export function getRuntimeEnvValue(key: string, fallback = ''): string {
  // Process-level configuration is the highest-priority override. This is
  // important for tests, child processes, and deployments that inject a
  // temporary value over the checked-in/local .env defaults.
  const fromProcess = process.env[key];
  if (typeof fromProcess === 'string') return fromProcess.trim();

  const fromFile = readEnvFile();
  if (Object.prototype.hasOwnProperty.call(fromFile, key)) {
    return String(fromFile[key] ?? '').trim();
  }
  return fallback;
}

export function resolvePollinationsApiKey(fromFile: unknown, fromProcess: unknown): string {
  if (typeof fromFile === 'string' && fromFile.trim()) return fromFile.trim();
  return typeof fromProcess === 'string' ? fromProcess.trim() : '';
}

export function getRuntimePollinationsApiKey(): string {
  // Pollinations is documented for this app through the project .env file.
  // Prefer that explicit local credential so a stale inherited shell variable
  // cannot silently replace it. Process-level configuration remains the
  // fallback for deployments that do not provide a local .env file.
  return resolvePollinationsApiKey(
    readEnvFile().POLLINATIONS_API_KEY,
    process.env.POLLINATIONS_API_KEY,
  );
}

export function getRuntimePollinationsModel(): string {
  return getRuntimeEnvValue('POLLINATIONS_MODEL', 'openai-fast');
}

export function getRuntimeGeminiApiKey(): string {
  return getRuntimeEnvValue('GEMINI_API_KEY', '');
}

export function getRuntimeNvidiaApiKey(): string {
  return getRuntimeEnvValue('NVIDIA_API_KEY', '');
}

export function getRuntimeNvidiaApiKeys(): string {
  return getRuntimeEnvValue('NVIDIA_API_KEYS', '');
}

export function getRuntimeNvidiaBaseUrl(): string {
  return getRuntimeEnvValue('NVIDIA_BASE_URL', 'https://integrate.api.nvidia.com/v1');
}

export function getRuntimeOpenRouterApiKey(): string {
  return getRuntimeEnvValue('OPENROUTER_API_KEY', '');
}

/**
 * OpenRouter free-model limits are account-level. Multiple inference keys are
 * intentionally not pooled or rotated by this application.
 *
 * Keep this warning value-only: callers can report that a legacy setting was
 * found without reading, logging, or returning any credential material.
 */
export function getLegacyOpenRouterConfigurationWarning(
  legacyKeyPool = getRuntimeEnvValue('OPENROUTER_API_KEYS', ''),
): string | null {
  return legacyKeyPool
    ? 'OPENROUTER_API_KEYS is not supported and has been ignored. Configure exactly one OpenRouter account key with OPENROUTER_API_KEY.'
    : null;
}

export function getRuntimeGroqApiKey(): string {
  return getRuntimeEnvValue('GROQ_API_KEY', '');
}

/**
 * GROQ_API_KEYS previously enabled cross-account quota rotation. It is now
 * deliberately ignored; callers can surface this warning without reading or
 * logging any of the legacy credential values.
 */
export function getLegacyGroqConfigurationWarning(
  legacyKeyPool = getRuntimeEnvValue('GROQ_API_KEYS', ''),
): string | null {
  return legacyKeyPool
    ? 'GROQ_API_KEYS is no longer supported and has been ignored. Configure exactly one Groq organization with GROQ_API_KEY.'
    : null;
}

export function getRuntimeGroqBaseUrl(): string {
  return getRuntimeEnvValue('GROQ_BASE_URL', 'https://api.groq.com/openai/v1');
}

export function getRuntimeCerebrasApiKey(): string {
  return getRuntimeEnvValue('CEREBRAS_API_KEY', '');
}

export function getRuntimeCerebrasBaseUrl(): string {
  return getRuntimeEnvValue('CEREBRAS_BASE_URL', 'https://api.cerebras.ai/v1');
}

export function getRuntimeCerebrasModel(): string {
  return getRuntimeEnvValue('CEREBRAS_MODEL', 'gpt-oss-120b');
}

export function getRuntimeSambaNovaApiKey(): string {
  return getRuntimeEnvValue('SAMBANOVA_API_KEY', '');
}

export function getRuntimeSambaNovaBaseUrl(): string {
  return getRuntimeEnvValue('SAMBANOVA_BASE_URL', 'https://api.sambanova.ai/v1');
}

export function getRuntimeSambaNovaModel(): string {
  return getRuntimeEnvValue('SAMBANOVA_MODEL', 'gpt-oss-120b');
}

export function getRuntimeKimiApiKey(): string {
  return getRuntimeEnvValue('KIMI_API_KEY', '');
}

export function getRuntimeKimiBaseUrl(): string {
  return getRuntimeEnvValue('KIMI_BASE_URL', 'https://api.moonshot.ai/v1');
}

export function getRuntimeRequestyApiKey(): string {
  return getRuntimeEnvValue('REQUESTY_API_KEY', '');
}

export function getRuntimeRequestyBaseUrl(): string {
  return getRuntimeEnvValue('REQUESTY_BASE_URL', 'https://router.requesty.ai/v1');
}

export function getRuntimeOpenRouterBaseUrl(): string {
  return getRuntimeEnvValue('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1');
}

export function getRuntimeGeminiFallbackModel(): string {
  return getRuntimeEnvValue('GEMINI_FALLBACK_MODEL', 'gemini-3.6-flash');
}

export function getRuntimePlannerModel(): string {
  // Model selection is owned by persisted Settings/API routes. This legacy
  // accessor must not resurrect a stale DEFAULT_MODEL environment value.
  return DEFAULT_CODER_MODEL_SELECTION;
}

export function getRuntimeLlmRequestTimeoutMs(): number {
  const parsed = Number(getRuntimeEnvValue('REACT_ENGINE_LLM_TIMEOUT_MS', '90000'));
  return Number.isFinite(parsed) ? Math.max(5_000, Math.min(parsed, 300_000)) : 90_000;
}

/**
 * Tool selection is a small, structured request and should fail over faster
 * than a full planning, verification, or synthesis request. Keeping this
 * separate prevents one stalled provider attempt from making every agent step
 * feel unresponsive.
 */
export function getRuntimePlannerRequestTimeoutMs(): number {
  const parsed = Number(getRuntimeEnvValue('REACT_ENGINE_PLANNER_TIMEOUT_MS', '90000'));
  return Number.isFinite(parsed) ? Math.max(2_000, Math.min(parsed, 120_000)) : 90_000;
}

/** Idle period allowed between streamed local structured-action payloads. */
export function getRuntimeLocalActionIdleTimeoutMs(): number {
  const parsed = Number(getRuntimeEnvValue('REACT_ENGINE_LOCAL_ACTION_IDLE_TIMEOUT_MS', '10000'));
  return Number.isFinite(parsed) ? Math.max(1_000, Math.min(parsed, 60_000)) : 10_000;
}

/** Overall sanity ceiling for a streamed local structured-action request. */
export function getRuntimeLocalActionOverallTimeoutMs(): number {
  const parsed = Number(getRuntimeEnvValue('REACT_ENGINE_LOCAL_ACTION_OVERALL_TIMEOUT_MS', '300000'));
  return Number.isFinite(parsed) ? Math.max(30_000, Math.min(parsed, 900_000)) : 300_000;
}

export function getRuntimeDefaultModel(): string {
  // Kept for compatibility with older callers; the web runtime resolves its
  // model from persisted provider settings instead of process.env.
  return DEFAULT_CODER_MODEL_SELECTION;
}
