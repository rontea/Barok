export type ProviderErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'PERMISSION_DENIED'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_UNAVAILABLE'
  | 'UNSUPPORTED_CAPABILITY'
  | 'CANCELLED'
  | 'CAPACITY_EXCEEDED'
  | 'MISCONFIGURED'
  | 'QUOTA_EXHAUSTED'
  | 'RATE_LIMITED'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'REQUEST_TIMEOUT'
  | 'INVALID_REQUEST'
  | 'CONTENT_REJECTED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

export interface ProviderError {
  provider: string;
  profileId?: string;
  code: ProviderErrorCode;
  retryable: boolean;
  retryAfterMs?: number;
  safeMessage: string;
  statusCode?: number;
  requestId?: string;
  internalCause?: unknown;
}

const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_-]{20,}/g,
  /(?:api[_-]?key|token|secret)\s*[:=]\s*(?:"[^"]+"|'[^']+'|[^\s,;]+)/gi,
  /authorization\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi,
  /\bbearer\s+[^\s,;]+/gi,
  /\b(?:nvapi|sk|ghp|github_pat)-[0-9A-Za-z_-]{12,}\b/g,
  /\bgsk_[0-9A-Za-z_-]{12,}\b/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\b(?:npm_[0-9A-Za-z]{20,}|glpat-[0-9A-Za-z_-]{20,})\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s]+/gi,
  /(?:client_secret|oauth_secret|cookie|webhook_secret)\s*[:=]\s*[^\s,;]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export function redactProviderSecrets(value: unknown, limit = 500): string {
  let text = value instanceof Error ? value.message : String(value ?? '');
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[REDACTED]');
  return text.slice(0, limit);
}

export function parseRetryAfterMs(text: string): number | undefined {
  const match = text.match(/retry[- ]after\s*[:=]?\s*(\d+(?:\.\d+)?)(?:\s*(ms|s|seconds?))?/i)
    || text.match(/retry(?:Delay)?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/i)
    || text.match(/retry in\s+(\d+(?:\.\d+)?)s/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  return match[2]?.toLowerCase() === 'ms' ? Math.floor(amount) : Math.floor(amount * 1000);
}

export class NormalizedProviderError extends Error {
  readonly providerError: ProviderError;

  constructor(providerError: ProviderError) {
    super(providerError.safeMessage);
    this.name = 'NormalizedProviderError';
    this.providerError = providerError;
  }

  toJSON(): Omit<ProviderError, 'internalCause'> {
    const { internalCause: _internalCause, ...safe } = this.providerError;
    return safe;
  }
}

export function classifyOpenAICompatibleProviderError(
  provider: string,
  error: unknown,
  details: { statusCode?: number; retryAfterMs?: number; requestId?: string } = {},
): ProviderError {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const parsedStatusCode = Number(raw.match(/\bHTTP\s*(\d{3})\b/i)?.[1] || 0) || undefined;
  const statusCode = details.statusCode ?? parsedStatusCode;
  const retryAfterMs = details.retryAfterMs ?? parseRetryAfterMs(raw);
  const requestId = details.requestId;
  const base = {
    provider,
    safeMessage: redactProviderSecrets(raw || `${provider} request failed`),
    internalCause: error,
    statusCode,
    requestId,
  };
  if (/abort|cancelled|canceled/i.test(raw)) return { ...base, code: 'CANCELLED', retryable: false };
  if (statusCode === 401) return { ...base, code: 'AUTHENTICATION_FAILED', retryable: false };
  if (statusCode === 403) return { ...base, code: 'PERMISSION_DENIED', retryable: false };
  if (statusCode === 404 || /model (?:not found|unavailable)|invalid model/i.test(raw)) {
    return { ...base, code: statusCode === 404 ? 'MODEL_NOT_FOUND' : 'MODEL_UNAVAILABLE', retryable: false };
  }
  if (statusCode === 429 || /rate.?limit|quota/i.test(raw)) {
    const isUpstreamShared = /upstream_provider_shared_pool|temporarily rate-limited upstream/i.test(raw);
    return {
      ...base,
      code: !isUpstreamShared && /quota exhausted|daily limit|remaining[^0-9]*0|free model rate limit exceeded/i.test(raw) ? 'QUOTA_EXHAUSTED' : 'RATE_LIMITED',
      retryable: false,
      retryAfterMs,
    };
  }
  if (statusCode === 408 || /timed out|timeout|deadline/i.test(raw)) {
    return { ...base, code: 'REQUEST_TIMEOUT', retryable: true, retryAfterMs };
  }
  if ([500, 502, 503, 504].includes(statusCode || 0)) {
    return { ...base, code: 'TEMPORARILY_UNAVAILABLE', retryable: true, retryAfterMs };
  }
  if (/network|fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket|DNS/i.test(raw)) {
    return { ...base, code: 'NETWORK_ERROR', retryable: true, retryAfterMs };
  }
  if (statusCode === 400 || /invalid request|schema|malformed/i.test(raw)) {
    return { ...base, code: 'INVALID_REQUEST', retryable: false };
  }
  if (/content.*(?:blocked|reject)|safety|prohibited/i.test(raw)) {
    return { ...base, code: 'CONTENT_REJECTED', retryable: false };
  }
  return { ...base, code: 'UNKNOWN', retryable: false };
}

export function classifyGeminiProviderError(error: unknown, profileId: string): ProviderError {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const safeMessage = redactProviderSecrets(raw);
  const retryAfterMs = parseRetryAfterMs(raw);
  const base = { provider: 'gemini', profileId, safeMessage, internalCause: error };

  if (/429|RESOURCE_EXHAUSTED|quota exceeded|current quota|daily limit/i.test(raw)) {
    return {
      ...base,
      code: /quota|RESOURCE_EXHAUSTED|daily limit/i.test(raw) ? 'QUOTA_EXHAUSTED' : 'RATE_LIMITED',
      retryable: false,
      retryAfterMs,
    };
  }
  if (/401|403|UNAUTHENTICATED|PERMISSION_DENIED|invalid api key/i.test(raw)) {
    return { ...base, code: 'AUTHENTICATION_FAILED', retryable: false };
  }
  if (/408|timed out|timeout/i.test(raw)) {
    return { ...base, code: 'REQUEST_TIMEOUT', retryable: true };
  }
  if (/500|502|503|504|SERVICE_UNAVAILABLE|temporarily unavailable|overloaded/i.test(raw)) {
    return { ...base, code: 'TEMPORARILY_UNAVAILABLE', retryable: true };
  }
  if (/network|fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket/i.test(raw)) {
    return { ...base, code: 'NETWORK_ERROR', retryable: true };
  }
  if (/400|INVALID_ARGUMENT|invalid request/i.test(raw)) {
    return { ...base, code: 'INVALID_REQUEST', retryable: false };
  }
  if (/SAFETY|content.*blocked|RECITATION|prohibited/i.test(raw)) {
    return { ...base, code: 'CONTENT_REJECTED', retryable: false };
  }
  return { ...base, code: 'UNKNOWN', retryable: false };
}
