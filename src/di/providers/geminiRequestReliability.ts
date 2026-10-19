import { createHash } from 'crypto';
import { getRuntimeEnvValue } from '../../config/runtimeEnv.js';
import { getSQLiteAppStore } from '../../persistence/sqliteStore.js';
import { redactProviderSecrets } from './providerErrors.js';

export interface GeminiPreparedRequest {
  messages: Array<{ role: string; content: string }>;
  estimatedInputTokens: number;
  removedCharacters: number;
}

export interface GeminiRequestIdentity {
  workspaceId: string;
  repositoryCommitHash: string;
  userId: string;
  profileId: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  settings: unknown;
  toolSchemaVersion?: string;
}

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const inFlight = new Map<string, Promise<string>>();
const responseCache = new Map<string, CacheEntry>();
const GEMINI_CACHE_REFERENCES_SETTING_KEY = 'gemini.responseCacheReferences';

function persistCacheReference(
  fingerprint: string,
  identity: Pick<GeminiRequestIdentity, 'workspaceId' | 'repositoryCommitHash' | 'userId' | 'profileId' | 'model'>,
  expiresAt: number,
): void {
  try {
    const store = getSQLiteAppStore();
    const now = Date.now();
    const references = store.getSetting<Record<string, Record<string, unknown>>>(GEMINI_CACHE_REFERENCES_SETTING_KEY) || {};
    for (const [key, reference] of Object.entries(references)) {
      if (Number(reference.expiresAt) <= now) delete references[key];
    }
    references[fingerprint] = {
      ...identity,
      provider: 'gemini',
      expiresAt,
    };
    store.saveSetting(GEMINI_CACHE_REFERENCES_SETTING_KEY, references);
  } catch {
    // Cache metadata is an optimization and must never fail a model request.
  }
}

function configuredLimit(name: string, fallback: number): number {
  const value = Number(getRuntimeEnvValue(name, String(fallback)));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function prepareGeminiMessages(
  messages: Array<{ role: string; content: string }>,
  options: { model?: string } = {},
): GeminiPreparedRequest {
  const modelLimitName = options.model
    ? `GEMINI_MODEL_CONTEXT_MAX_CHARACTERS_${options.model.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
    : '';
  const maxCharacters = modelLimitName
    ? configuredLimit(modelLimitName, configuredLimit('GEMINI_CONTEXT_MAX_CHARACTERS', 120_000))
    : configuredLimit('GEMINI_CONTEXT_MAX_CHARACTERS', 120_000);
  const maxToolOutput = configuredLimit('GEMINI_CONTEXT_MAX_TOOL_OUTPUT_CHARACTERS', 20_000);
  const maxFileCharacters = configuredLimit('GEMINI_CONTEXT_MAX_FILE_CHARACTERS', 30_000);
  const maxFiles = configuredLimit('GEMINI_CONTEXT_MAX_FILES_PER_REQUEST', 12);
  const summaryTriggerPercentage = Math.min(
    100,
    configuredLimit('GEMINI_CONTEXT_SUMMARY_TRIGGER_PERCENTAGE', 75),
  );
  const deduplicated: Array<{ role: string; content: string }> = [];
  let removedCharacters = 0;

  for (const message of messages) {
    let content = redactProviderSecrets(message.content, Math.max(maxCharacters, maxToolOutput));
    const appearsToContainFile = /(?:^|\n)(?:file|path):\s*[^\n]+/i.test(content);
    if (appearsToContainFile && content.length > maxFileCharacters) {
      removedCharacters += content.length - maxFileCharacters;
      content = `${content.slice(0, maxFileCharacters)}\n...[file excerpt truncated]`;
    }
    if (/tool|observation/i.test(message.role) && content.length > maxToolOutput) {
      removedCharacters += content.length - maxToolOutput;
      content = `${content.slice(0, maxToolOutput)}\n...[tool output truncated]`;
    }
    const previous = deduplicated[deduplicated.length - 1];
    if (previous?.role === message.role && previous.content.trim() === content.trim()) {
      removedCharacters += content.length;
      continue;
    }
    deduplicated.push({ role: message.role, content });
  }

  const fileMessageIndices = deduplicated
    .map((message, index) => /(?:^|\n)(?:file|path):\s*[^\n]+/i.test(message.content) ? index : -1)
    .filter((index) => index >= 0);
  for (const index of fileMessageIndices.slice(0, Math.max(0, fileMessageIndices.length - maxFiles)).reverse()) {
    removedCharacters += deduplicated[index].content.length;
    deduplicated.splice(index, 1);
  }

  let total = deduplicated.reduce((sum, message) => sum + message.content.length, 0);
  if (total > maxCharacters * (summaryTriggerPercentage / 100) && deduplicated.length > 6) {
    const firstPreservedIndex = deduplicated[0]?.role === 'system' ? 1 : 0;
    const compressCount = Math.max(0, deduplicated.length - firstPreservedIndex - 4);
    if (compressCount > 0) {
      const compressed = deduplicated.splice(firstPreservedIndex, compressCount);
      const summary = compressed
        .map((message) => `${message.role}: ${message.content.replace(/\s+/g, ' ').slice(0, 240)}`)
        .join('\n');
      const originalCharacters = compressed.reduce((sum, message) => sum + message.content.length, 0);
      const summaryMessage = {
        role: 'user',
        content: `[compressed conversation context]\n${summary.slice(0, Math.max(1_000, Math.floor(maxCharacters * 0.15)))}`,
      };
      removedCharacters += Math.max(0, originalCharacters - summaryMessage.content.length);
      deduplicated.splice(firstPreservedIndex, 0, summaryMessage);
      total = deduplicated.reduce((sum, message) => sum + message.content.length, 0);
    }
  }
  while (total > maxCharacters && deduplicated.length > 2) {
    const removableIndex = deduplicated[0]?.role === 'system' ? 1 : 0;
    const [removed] = deduplicated.splice(removableIndex, 1);
    total -= removed.content.length;
    removedCharacters += removed.content.length;
  }
  if (total > maxCharacters && deduplicated.length > 0) {
    const index = deduplicated.length - 1;
    const allowed = Math.max(1000, maxCharacters - (total - deduplicated[index].content.length));
    removedCharacters += Math.max(0, deduplicated[index].content.length - allowed);
    deduplicated[index] = {
      ...deduplicated[index],
      content: `${deduplicated[index].content.slice(0, allowed)}\n...[context truncated]`,
    };
  }

  const characters = deduplicated.reduce((sum, message) => sum + message.content.length, 0);
  return {
    messages: deduplicated,
    estimatedInputTokens: Math.ceil(characters / 4),
    removedCharacters,
  };
}

export function createGeminiRequestFingerprint(identity: GeminiRequestIdentity): string {
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

export function getCachedGeminiResponse(fingerprint: string): string | undefined {
  const entry = responseCache.get(fingerprint);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(fingerprint);
    return undefined;
  }
  return entry.value;
}

export function runDeduplicatedGeminiRequest(
  fingerprint: string,
  request: () => Promise<string>,
  options: {
    cacheResult?: boolean;
    ttlMs?: number;
    cacheReference?: Pick<GeminiRequestIdentity, 'workspaceId' | 'repositoryCommitHash' | 'userId' | 'profileId' | 'model'>;
  } = {},
): Promise<string> {
  const existing = inFlight.get(fingerprint);
  if (existing) return existing;
  const promise = request().then((value) => {
    if (options.cacheResult) {
      const expiresAt = Date.now() + (options.ttlMs || configuredLimit('GEMINI_RESPONSE_CACHE_TTL_MS', 300_000));
      responseCache.set(fingerprint, {
        value,
        expiresAt,
      });
      if (options.cacheReference) persistCacheReference(fingerprint, options.cacheReference, expiresAt);
    }
    return value;
  }).finally(() => {
    if (inFlight.get(fingerprint) === promise) inFlight.delete(fingerprint);
  });
  inFlight.set(fingerprint, promise);
  return promise;
}

export function resetGeminiRequestReliabilityState(): void {
  inFlight.clear();
  responseCache.clear();
}
