import { createHash } from 'crypto';
import type { LLMCompletionOptions } from '../types.js';
import { getSQLiteAppStore } from '../../persistence/sqliteStore.js';
import { NormalizedProviderError } from './providerErrors.js';

export interface ProviderRequestIdentity {
  provider: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  tools?: unknown;
  settings?: unknown;
  workspaceId?: string;
  repositoryCommitHash?: string;
  userId?: string;
  taskId?: string;
  stepId?: string;
  attemptGeneration?: number;
  toolSchemaVersion?: string;
}

export interface PreparedProviderMessages {
  messages: Array<{ role: string; content: string }>;
  estimatedInputTokens: number;
  removedCharacters: number;
  secretsDetected: boolean;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  repositoryCommitHash?: string;
}

interface SharedRequest<T> {
  controller: AbortController;
  promise: Promise<T>;
  subscribers: number;
}

const inFlight = new Map<string, SharedRequest<unknown>>();
const responseCache = new Map<string, CacheEntry<unknown>>();
const CACHE_REFERENCES_KEY = 'provider.responseCacheReferences';

const OUTBOUND_SECRET_PATTERNS = [
  /\b(?:bearer\s+)[A-Za-z0-9._~+/-]{12,}/gi,
  /\b(?:gsk_|sk-|ghp_|github_pat_|npm_|glpat-)[A-Za-z0-9_-]{12,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s]+/gi,
  /(?:api[_-]?key|token|secret|password|cookie|client_secret|webhook_secret)\s*[:=]\s*(?:"[^"]+"|'[^']+'|[^\s,;]+)/gi,
];

function redactSecrets(text: string): { text: string; detected: boolean } {
  let redacted = text;
  let detected = false;
  for (const pattern of OUTBOUND_SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(redacted)) detected = true;
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  return { text: redacted, detected };
}

function normalizeMessages(messages: Array<{ role: string; content: string }>): Array<{ role: string; content: string }> {
  return messages.map((message) => ({ role: message.role, content: message.content.replace(/\r\n/g, '\n').trimEnd() }));
}

export function createProviderRequestFingerprint(identity: ProviderRequestIdentity): string {
  return createHash('sha256').update(JSON.stringify({
    ...identity,
    messages: normalizeMessages(identity.messages),
  })).digest('hex');
}

export function createStepIdempotencyKey(taskId: string, stepId: string, attemptGeneration = 0): string {
  return createHash('sha256').update(`${taskId}\u0000${stepId}\u0000${attemptGeneration}`).digest('hex');
}

export function prepareProviderMessages(
  messages: Array<{ role: string; content: string }>,
  options: LLMCompletionOptions & {
    contextTokenLimit?: number;
    outputTokenLimit?: number;
    maxFiles?: number;
    maxFileCharacters?: number;
    maxToolOutputCharacters?: number;
  } = {},
): PreparedProviderMessages {
  const contextTokenLimit = options.contextTokenLimit || 32_768;
  const outputReserve = Math.min(options.outputTokenLimit || options.maxTokens || 2_048, Math.floor(contextTokenLimit / 2));
  const maxCharacters = Math.max(4_000, (contextTokenLimit - outputReserve) * 4);
  const maxFiles = options.maxFiles || 12;
  const maxFileCharacters = options.maxFileCharacters || 30_000;
  const maxToolOutput = options.maxToolOutputCharacters || 20_000;
  const prepared: Array<{ role: string; content: string }> = [];
  let removedCharacters = 0;
  let secretsDetected = false;
  let fileCount = 0;

  for (const message of normalizeMessages(messages)) {
    const secretResult = redactSecrets(message.content);
    secretsDetected ||= secretResult.detected;
    if (secretResult.detected && options.outboundSecretPolicy === 'block') {
      throw new NormalizedProviderError({
        provider: 'groq',
        code: 'INVALID_REQUEST',
        retryable: false,
        safeMessage: 'Outbound content contains secret-like data and workspace policy blocks external dispatch.',
      });
    }
    if (secretResult.detected && options.outboundSecretPolicy === 'require_approval' && !options.outboundSecretApprovalGranted) {
      throw new NormalizedProviderError({
        provider: 'groq',
        code: 'INVALID_REQUEST',
        retryable: false,
        safeMessage: 'Outbound content requires approval because secret-like data was detected.',
      });
    }
    let content = secretResult.text;
    const pathMatch = content.match(/(?:^|\n)(?:file|path):\s*([^\n]+)/i);
    const excludedPath = pathMatch && /(?:^|[\\/])(?:\.env(?:\.|$)|credentials?|secrets?|node_modules|dist|build|coverage)(?:[\\/]|$)|(?:package-lock|yarn\.lock|pnpm-lock)/i.test(pathMatch[1]);
    if (excludedPath) {
      removedCharacters += content.length;
      continue;
    }
    if (pathMatch) {
      fileCount++;
      if (fileCount > maxFiles) {
        removedCharacters += content.length;
        continue;
      }
      if (content.length > maxFileCharacters) {
        removedCharacters += content.length - maxFileCharacters;
        content = `${content.slice(0, maxFileCharacters)}\n...[file excerpt truncated]`;
      }
    }
    if (/tool|observation/i.test(message.role) && content.length > maxToolOutput) {
      removedCharacters += content.length - maxToolOutput;
      content = `${content.slice(0, maxToolOutput)}\n...[tool output truncated]`;
    }
    const previous = prepared[prepared.length - 1];
    if (previous?.role === message.role && previous.content === content) {
      removedCharacters += content.length;
      continue;
    }
    prepared.push({ role: message.role, content });
  }

  let totalCharacters = prepared.reduce((sum, message) => sum + message.content.length, 0);
  if (totalCharacters > maxCharacters * 0.75 && prepared.length > 6) {
    const preservedStart = prepared[0]?.role === 'system' ? 1 : 0;
    const count = Math.max(0, prepared.length - preservedStart - 4);
    if (count) {
      const removed = prepared.splice(preservedStart, count);
      const summary = removed.map((message) => `${message.role}: ${message.content.replace(/\s+/g, ' ').slice(0, 240)}`).join('\n');
      const summaryContent = `[compressed prior context]\n${summary.slice(0, Math.floor(maxCharacters * 0.15))}`;
      removedCharacters += removed.reduce((sum, message) => sum + message.content.length, 0) - summaryContent.length;
      prepared.splice(preservedStart, 0, { role: 'user', content: summaryContent });
      totalCharacters = prepared.reduce((sum, message) => sum + message.content.length, 0);
    }
  }
  while (totalCharacters > maxCharacters && prepared.length > 2) {
    const index = prepared[0]?.role === 'system' ? 1 : 0;
    const [removed] = prepared.splice(index, 1);
    totalCharacters -= removed.content.length;
    removedCharacters += removed.content.length;
  }
  if (totalCharacters > maxCharacters && prepared.length) {
    const index = prepared.length - 1;
    const allowed = Math.max(1_000, maxCharacters - (totalCharacters - prepared[index].content.length));
    removedCharacters += Math.max(0, prepared[index].content.length - allowed);
    prepared[index] = { ...prepared[index], content: `${prepared[index].content.slice(0, allowed)}\n...[context truncated]` };
  }

  return {
    messages: prepared,
    estimatedInputTokens: Math.ceil(prepared.reduce((sum, message) => sum + message.content.length, 0) / 4),
    removedCharacters,
    secretsDetected,
  };
}

export function getCachedProviderResponse<T>(fingerprint: string, repositoryCommitHash?: string): T | undefined {
  const entry = responseCache.get(fingerprint) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now() || (repositoryCommitHash && entry.repositoryCommitHash !== repositoryCommitHash)) {
    responseCache.delete(fingerprint);
    return undefined;
  }
  return entry.value;
}

function persistCacheReference(identity: ProviderRequestIdentity, fingerprint: string, expiresAt: number): void {
  try {
    const store = getSQLiteAppStore();
    const references = store.getSetting<Record<string, Record<string, unknown>>>(CACHE_REFERENCES_KEY) || {};
    for (const [key, entry] of Object.entries(references)) {
      if (Number(entry.expiresAt) <= Date.now()) delete references[key];
    }
    references[fingerprint] = {
      provider: identity.provider,
      model: identity.model,
      workspaceId: identity.workspaceId,
      repositoryCommitHash: identity.repositoryCommitHash,
      userId: identity.userId,
      expiresAt,
    };
    store.saveSetting(CACHE_REFERENCES_KEY, references);
  } catch {
    // Cache metadata is optional and intentionally excludes prompt/response data.
  }
}

export function runReliableProviderRequest<T>(
  fingerprint: string,
  request: (signal: AbortSignal) => Promise<T>,
  options: {
    signal?: AbortSignal;
    cacheResult?: boolean;
    ttlMs?: number;
    identity?: ProviderRequestIdentity;
  } = {},
): Promise<T> {
  const cached = options.cacheResult
    ? getCachedProviderResponse<T>(fingerprint, options.identity?.repositoryCommitHash)
    : undefined;
  if (cached !== undefined) return Promise.resolve(cached);

  let shared = inFlight.get(fingerprint) as SharedRequest<T> | undefined;
  if (!shared) {
    const controller = new AbortController();
    const promise = request(controller.signal).then((value) => {
      if (options.cacheResult) {
        const expiresAt = Date.now() + Math.max(0, options.ttlMs || 300_000);
        responseCache.set(fingerprint, { value, expiresAt, repositoryCommitHash: options.identity?.repositoryCommitHash });
        if (options.identity) persistCacheReference(options.identity, fingerprint, expiresAt);
      }
      return value;
    }).finally(() => {
      if (inFlight.get(fingerprint)?.promise === promise) inFlight.delete(fingerprint);
    });
    shared = { controller, promise, subscribers: 0 };
    inFlight.set(fingerprint, shared as SharedRequest<unknown>);
  }
  shared.subscribers++;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const release = () => {
      if (settled) return;
      settled = true;
      shared!.subscribers = Math.max(0, shared!.subscribers - 1);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      release();
      if (shared!.subscribers === 0) shared!.controller.abort(options.signal?.reason);
      reject(options.signal?.reason || new DOMException('Request cancelled', 'AbortError'));
    };
    if (options.signal?.aborted) return onAbort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    shared!.promise.then(
      (value) => { if (!settled) { release(); resolve(value); } },
      (error) => { if (!settled) { release(); reject(error); } },
    );
  });
}

export function resetProviderRequestReliability(): void {
  for (const entry of inFlight.values()) entry.controller.abort();
  inFlight.clear();
  responseCache.clear();
}

