export type ProviderRouteState =
  | 'available'
  | 'near_limit'
  | 'rate_limited'
  | 'cooldown'
  | 'quota_exhausted'
  | 'billing_required';

export type ProviderCircuitState = 'closed' | 'open' | 'half_open';

export interface ProviderRouteDescriptor {
  provider: string;
  model: string;
  tier?: 'free' | 'paid' | 'unknown';
  /** Zero-based credential index when a provider has an independently billed/keyed pool. */
  credentialIndex?: number;
}

export interface ProviderRateLimitStatus extends ProviderRouteDescriptor {
  status: ProviderRouteState;
  requestCount: number;
  successCount: number;
  failureCount: number;
  rateLimitHits: number;
  timeoutHits: number;
  consecutiveTimeouts: number;
  consecutiveFailures: number;
  circuitState: ProviderCircuitState;
  pauseReason?: 'rate_limit' | 'timeouts' | 'transient_failures' | 'quota_exhausted' | 'billing_required';
  remainingRequests?: number;
  remainingTokens?: number;
  pausedUntil?: string;
  retryAfterMs?: number;
  lastRequestAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  healthScore?: number;
}

type MutableProviderRateLimitStatus = Omit<ProviderRateLimitStatus,
  'pausedUntil' | 'lastRequestAt' | 'lastSuccessAt' | 'lastFailureAt'
> & {
  pausedUntil?: number;
  lastRequestAt?: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  halfOpenProbeInFlight?: boolean;
};

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const TIMEOUT_CIRCUIT_BREAKER_THRESHOLD = 2;
const TIMEOUT_CIRCUIT_BREAKER_COOLDOWN_MS = 2 * 60_000;
const TRANSIENT_CIRCUIT_BREAKER_THRESHOLD = 3;
const TRANSIENT_CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;
const routes = new Map<string, MutableProviderRateLimitStatus>();

function normalizeCredentialIndex(credentialIndex: number | undefined): number | undefined {
  return Number.isInteger(credentialIndex) && Number(credentialIndex) >= 0
    ? Number(credentialIndex)
    : undefined;
}

function routeKey(provider: string, model: string, credentialIndex?: number): string {
  const credential = normalizeCredentialIndex(credentialIndex);
  return `${provider.trim().toLowerCase()}\u0000${model.trim().toLowerCase()}\u0000${credential ?? 'pool'}`;
}

function cleanError(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function isRateLimitError(error: string): boolean {
  return /\b429\b|\brate[\s_-]*limit(?:ed| exceeded| reached| hit| reset| cooldown)\b|resource_exhausted|throttl|quota exceeded/i.test(error);
}

function isBillingRequiredError(error: string): boolean {
  return /(?:account|organization|org[-\s])[^\n]{0,160}suspend(?:ed)?[^\n]{0,160}(?:insufficient balance|billing)|insufficient balance|recharge (?:your )?account|payment required/i.test(error);
}

function isQuotaExhaustedError(error: string): boolean {
  if (/upstream_provider_shared_pool|temporarily rate-limited upstream/i.test(error)) return false;
  return /free-models-per-day|free model rate limit exceeded|daily (?:request )?(?:quota|limit)[^\n]{0,80}(?:exhausted|exceeded|reached)|(?:tokens?|requests?) per day|\b(?:TPD|RPD)\b|quota (?:is )?exhausted|exceeded your current quota|remaining(?:Requests| requests)?["':=\s]+0\b/i.test(error);
}

function parseResetAtMs(error: string): number | undefined {
  const match = error.match(/(?:x-ratelimit-reset|ratelimit-reset|reset)["':=\s]+(\d{10,13})/i);
  if (!match) return undefined;
  const raw = Number(match[1]);
  if (!Number.isFinite(raw)) return undefined;
  return match[1].length <= 10 ? raw * 1_000 : raw;
}

function parseDurationMs(error: string): number | undefined {
  const retryDelay = error.match(/(?:retry(?:[\s_-]*after|[\s_-]*delay|\s+in)?|try again in)["':=\s]*([0-9.]+)\s*(milliseconds?|ms|seconds?|s|minutes?|m)/i);
  if (!retryDelay) {
    const retryAfterSeconds = error.match(/retry(?:[\s_-]*after|\s+in)["':=\s]+([0-9.]+)(?!\s*(?:ms|milliseconds?|s|seconds?|m|minutes?))/i);
    if (!retryAfterSeconds) return undefined;
    const seconds = Number(retryAfterSeconds[1]);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1_000) : undefined;
  }
  const value = Number(retryDelay[1]);
  if (!Number.isFinite(value) || value < 0) return undefined;
  const unit = retryDelay[2].toLowerCase();
  if (unit.startsWith('m') && unit !== 'ms' && !unit.startsWith('millisecond')) return Math.ceil(value * 60_000);
  if (unit === 'ms' || unit.startsWith('millisecond')) return Math.ceil(value);
  return Math.ceil(value * 1_000);
}

function getOrCreate(
  provider: string,
  model: string,
  tier: ProviderRouteDescriptor['tier'] = 'free',
  credentialIndex?: number,
) {
  const normalizedCredentialIndex = normalizeCredentialIndex(credentialIndex);
  const key = routeKey(provider, model, normalizedCredentialIndex);
  let route = routes.get(key);
  if (!route) {
    route = {
      provider: provider.trim().toLowerCase(),
      model: model.trim(),
      tier,
      credentialIndex: normalizedCredentialIndex,
      status: 'available',
      requestCount: 0,
      successCount: 0,
      failureCount: 0,
      rateLimitHits: 0,
      timeoutHits: 0,
      consecutiveTimeouts: 0,
      consecutiveFailures: 0,
      circuitState: 'closed',
    };
    routes.set(key, route);
  }
  return route;
}

function refreshCircuitState(route: MutableProviderRateLimitStatus, now: number): void {
  if (route.circuitState !== 'open' || !route.pausedUntil || route.pausedUntil > now) return;
  route.circuitState = 'half_open';
  route.halfOpenProbeInFlight = false;
  route.status = 'available';
  route.pausedUntil = undefined;
  route.retryAfterMs = undefined;
  route.pauseReason = undefined;
}

export function isProviderRoutePaused(
  provider: string,
  model: string,
  now = Date.now(),
  credentialIndex?: number,
): boolean {
  const route = routes.get(routeKey(provider, model, credentialIndex));
  if (!route) return false;
  refreshCircuitState(route, now);
  if (route.status === 'billing_required') return true;
  if (route.status === 'quota_exhausted' && !route.pausedUntil) return true;
  if (route.circuitState === 'open') return true;
  if (route.circuitState === 'half_open' && route.halfOpenProbeInFlight) return true;
  return Boolean(route.pausedUntil && route.pausedUntil > now);
}

/**
 * Claim a route for dispatch. Once an open circuit cools down, exactly one
 * half-open probe is allowed until success or failure is recorded.
 */
export function tryAcquireProviderRoute(
  provider: string,
  model: string,
  now = Date.now(),
  credentialIndex?: number,
  allowRateLimitProbe = false,
): boolean {
  const route = getOrCreate(provider, model, 'free', credentialIndex);
  refreshCircuitState(route, now);
  if (allowRateLimitProbe && route.pauseReason === 'rate_limit') {
    if (route.halfOpenProbeInFlight) return false;
    route.circuitState = 'half_open';
    route.halfOpenProbeInFlight = true;
    return true;
  }
  if (route.status === 'billing_required') return false;
  if (route.status === 'quota_exhausted' && !route.pausedUntil) return false;
  if (route.circuitState === 'open' || (route.pausedUntil && route.pausedUntil > now)) return false;
  if (route.circuitState === 'half_open') {
    if (route.halfOpenProbeInFlight) return false;
    route.halfOpenProbeInFlight = true;
  }
  return true;
}

export function releaseProviderRouteProbe(
  provider: string,
  model: string,
  credentialIndex?: number,
): void {
  const route = routes.get(routeKey(provider, model, credentialIndex));
  if (route?.circuitState === 'half_open') route.halfOpenProbeInFlight = false;
}

export function getProviderRoutePauseReason(
  provider: string,
  model: string,
  now = Date.now(),
  credentialIndex?: number,
): ProviderRateLimitStatus['pauseReason'] | undefined {
  if (!isProviderRoutePaused(provider, model, now, credentialIndex)) return undefined;
  return routes.get(routeKey(provider, model, credentialIndex))?.pauseReason;
}

export function getProviderRouteStatus(
  provider: string,
  model: string,
  now = Date.now(),
  credentialIndex?: number,
): ProviderRateLimitStatus | undefined {
  const route = routes.get(routeKey(provider, model, credentialIndex));
  return route ? toPublicStatus(route, now) : undefined;
}

/**
 * Rank a credential/model route using observed reliability and recency.
 * Unknown routes retain a neutral score so newly-added keys are explored.
 */
export function getProviderRouteHealthScore(
  provider: string,
  model: string,
  now = Date.now(),
  credentialIndex?: number,
): number {
  const status = getProviderRouteStatus(provider, model, now, credentialIndex);
  if (!status) return 70;
  if (status.status === 'billing_required' || status.status === 'quota_exhausted'
    || status.status === 'rate_limited' || status.status === 'cooldown') {
    return -10_000;
  }

  const reliability = (status.successCount + 1) / (status.requestCount + 2);
  let score = 40 + reliability * 60;
  if (status.requestCount === 0) score += 8;
  if (status.status === 'near_limit') score -= 25;
  score -= Math.min(45, status.consecutiveTimeouts * 18);
  score -= Math.min(20, status.rateLimitHits * 4);

  if (status.lastSuccessAt) {
    const ageMs = Math.max(0, now - Date.parse(status.lastSuccessAt));
    score += 20 * Math.max(0, 1 - ageMs / (10 * 60_000));
  }
  if (status.lastFailureAt && (!status.lastSuccessAt || status.lastFailureAt > status.lastSuccessAt)) {
    const ageMs = Math.max(0, now - Date.parse(status.lastFailureAt));
    score -= 12 * Math.max(0, 1 - ageMs / (5 * 60_000));
  }
  return score;
}

export function resetProviderRoute(
  provider: string,
  model: string,
  credentialIndex?: number,
): boolean {
  return routes.delete(routeKey(provider, model, credentialIndex));
}

export function recordProviderSuccess(
  provider: string,
  model: string,
  now = Date.now(),
  credentialIndex?: number,
): void {
  const route = getOrCreate(provider, model, 'free', credentialIndex);
  route.requestCount++;
  route.successCount++;
  route.lastRequestAt = now;
  route.lastSuccessAt = now;
  route.consecutiveTimeouts = 0;
  route.consecutiveFailures = 0;
  route.circuitState = 'closed';
  route.halfOpenProbeInFlight = false;
  route.status = (route.remainingRequests !== undefined && route.remainingRequests <= 1)
    || (route.remainingTokens !== undefined && route.remainingTokens <= 1000)
    ? 'near_limit'
    : 'available';
  route.pausedUntil = undefined;
  route.retryAfterMs = undefined;
  route.lastError = undefined;
  route.pauseReason = undefined;
}

export function recordProviderFailure(
  provider: string,
  model: string,
  error: unknown,
  now = Date.now(),
  credentialIndex?: number,
): void {
  const route = getOrCreate(provider, model, 'free', credentialIndex);
  const wasHalfOpen = route.circuitState === 'half_open';
  route.halfOpenProbeInFlight = false;
  const message = error instanceof Error ? error.message : String(error);
  route.requestCount++;
  route.failureCount++;
  route.lastRequestAt = now;
  route.lastFailureAt = now;
  route.lastError = cleanError(message);
  const classificationMessage = provider.trim().toLowerCase() === 'openrouter'
    ? message.split(/\nRecovery route [^\n]+ also failed:/i, 1)[0] || message
    : message;

  if (isBillingRequiredError(classificationMessage)) {
    route.rateLimitHits++;
    route.status = 'billing_required';
    route.pauseReason = 'billing_required';
    route.pausedUntil = undefined;
    route.retryAfterMs = undefined;
    route.consecutiveTimeouts = 0;
    route.consecutiveFailures++;
    route.circuitState = 'open';
    return;
  }

  if (isQuotaExhaustedError(classificationMessage)) {
    const explicitResetAt = parseResetAtMs(classificationMessage);
    const retryAfterMs = parseDurationMs(classificationMessage);
    const resetAt = explicitResetAt ?? (retryAfterMs !== undefined ? now + retryAfterMs : undefined);
    route.rateLimitHits++;
    route.status = 'quota_exhausted';
    route.pauseReason = 'quota_exhausted';
    route.pausedUntil = resetAt && resetAt > now ? resetAt : undefined;
    route.retryAfterMs = route.pausedUntil ? route.pausedUntil - now : undefined;
    route.consecutiveTimeouts = 0;
    route.consecutiveFailures++;
    route.circuitState = 'open';
    return;
  }

  if (isRateLimitError(classificationMessage)) {
    const retryAfterMs = parseDurationMs(classificationMessage) ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS;
    route.rateLimitHits++;
    route.status = 'rate_limited';
    route.pauseReason = 'rate_limit';
    route.retryAfterMs = retryAfterMs;
    route.pausedUntil = Math.max(route.pausedUntil || 0, now + retryAfterMs);
    route.consecutiveTimeouts = 0;
    route.consecutiveFailures++;
    route.circuitState = 'open';
    return;
  }

  if (/timed out|timeout|deadline exceeded/i.test(classificationMessage)) {
    route.timeoutHits++;
    route.consecutiveTimeouts++;
    route.consecutiveFailures++;
    if (wasHalfOpen || route.consecutiveTimeouts >= TIMEOUT_CIRCUIT_BREAKER_THRESHOLD) {
      route.status = 'cooldown';
      route.pauseReason = 'timeouts';
      route.retryAfterMs = TIMEOUT_CIRCUIT_BREAKER_COOLDOWN_MS;
      route.pausedUntil = Math.max(route.pausedUntil || 0, now + TIMEOUT_CIRCUIT_BREAKER_COOLDOWN_MS);
      route.circuitState = 'open';
    }
  } else if (/HTTP 5\d\d|service unavailable|server error|ECONNRESET|fetch failed/i.test(classificationMessage)) {
    route.consecutiveTimeouts = 0;
    route.consecutiveFailures++;
    if (wasHalfOpen || route.consecutiveFailures >= TRANSIENT_CIRCUIT_BREAKER_THRESHOLD) {
      route.status = 'cooldown';
      route.pauseReason = 'transient_failures';
      route.retryAfterMs = TRANSIENT_CIRCUIT_BREAKER_COOLDOWN_MS;
      route.pausedUntil = Math.max(route.pausedUntil || 0, now + TRANSIENT_CIRCUIT_BREAKER_COOLDOWN_MS);
      route.circuitState = 'open';
    }
  } else if (wasHalfOpen) {
    route.consecutiveTimeouts = 0;
    route.consecutiveFailures++;
    route.status = 'cooldown';
    route.pauseReason = 'transient_failures';
    route.retryAfterMs = TRANSIENT_CIRCUIT_BREAKER_COOLDOWN_MS;
    route.pausedUntil = Math.max(route.pausedUntil || 0, now + TRANSIENT_CIRCUIT_BREAKER_COOLDOWN_MS);
    route.circuitState = 'open';
  } else {
    route.consecutiveTimeouts = 0;
    route.consecutiveFailures = 0;
    route.circuitState = 'closed';
  }
}

export function updateProviderRateLimitHeaders(
  provider: string,
  model: string,
  headers: Pick<Headers, 'get'>,
  credentialIndex?: number,
): void {
  const route = getOrCreate(provider, model, 'free', credentialIndex);
  const parseOptionalHeaderNumber = (value: string | null): number | undefined => {
    if (value === null || !value.trim()) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const remainingRequests = parseOptionalHeaderNumber(
    headers.get('x-ratelimit-remaining-requests')
      ?? headers.get('x-ratelimit-remaining')
      ?? headers.get('ratelimit-remaining'),
  );
  const remainingTokens = parseOptionalHeaderNumber(headers.get('x-ratelimit-remaining-tokens'));
  const resetAt = parseResetAtMs(`reset: ${headers.get('x-ratelimit-reset') ?? headers.get('ratelimit-reset') ?? ''}`);
  if (remainingRequests !== undefined) route.remainingRequests = remainingRequests;
  if (remainingTokens !== undefined) route.remainingTokens = remainingTokens;
  if (route.remainingRequests === 0) {
    route.status = 'quota_exhausted';
    route.pauseReason = 'quota_exhausted';
    route.pausedUntil = resetAt;
    route.retryAfterMs = resetAt ? Math.max(0, resetAt - Date.now()) : undefined;
    route.circuitState = 'open';
  } else if ((route.remainingRequests !== undefined && route.remainingRequests <= 1)
    || (route.remainingTokens !== undefined && route.remainingTokens <= 1000)) {
    route.status = 'near_limit';
  }
}

function toPublicStatus(route: MutableProviderRateLimitStatus, now: number): ProviderRateLimitStatus {
  refreshCircuitState(route, now);
  const indefinitelyPaused = route.status === 'billing_required'
    || (route.status === 'quota_exhausted' && !route.pausedUntil);
  const paused = indefinitelyPaused || Boolean(route.pausedUntil && route.pausedUntil > now);
  const status = paused
    ? route.status
    : route.status === 'rate_limited' || route.status === 'cooldown' || route.status === 'quota_exhausted'
      ? 'available'
      : route.status;
  const { halfOpenProbeInFlight: _halfOpenProbeInFlight, ...publicRoute } = route;
  return {
    ...publicRoute,
    status,
    pauseReason: paused ? route.pauseReason : undefined,
    pausedUntil: paused && route.pausedUntil ? new Date(route.pausedUntil).toISOString() : undefined,
    retryAfterMs: paused && route.pausedUntil ? Math.max(0, route.pausedUntil - now) : undefined,
    lastRequestAt: route.lastRequestAt ? new Date(route.lastRequestAt).toISOString() : undefined,
    lastSuccessAt: route.lastSuccessAt ? new Date(route.lastSuccessAt).toISOString() : undefined,
    lastFailureAt: route.lastFailureAt ? new Date(route.lastFailureAt).toISOString() : undefined,
  };
}

export function getProviderRateLimitStatuses(
  configuredRoutes: ProviderRouteDescriptor[] = [],
  now = Date.now(),
): ProviderRateLimitStatus[] {
  for (const descriptor of configuredRoutes) {
    getOrCreate(descriptor.provider, descriptor.model, descriptor.tier, descriptor.credentialIndex);
  }
  return Array.from(routes.values())
    .map((route) => {
      const status = toPublicStatus(route, now);
      return {
        ...status,
        healthScore: Math.round(getProviderRouteHealthScore(
          route.provider, route.model, now, route.credentialIndex,
        ) * 10) / 10,
      };
    })
    .sort((a, b) => a.provider.localeCompare(b.provider)
      || a.model.localeCompare(b.model)
      || (a.credentialIndex ?? -1) - (b.credentialIndex ?? -1));
}

export function resetProviderRateLimitMonitor(): void {
  routes.clear();
}
