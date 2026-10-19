import {
  getProviderRateLimitStatuses,
  getProviderRouteHealthScore,
  getProviderRoutePauseReason,
  isProviderRoutePaused,
  recordProviderFailure,
  recordProviderSuccess,
  resetProviderRateLimitMonitor,
  resetProviderRoute,
  tryAcquireProviderRoute,
  updateProviderRateLimitHeaders,
} from '../rateLimitMonitor.js';

describe('provider rate-limit monitor', () => {
  beforeEach(() => resetProviderRateLimitMonitor());

  it('pauses a provider/model route after a 429 and releases it after cooldown', () => {
    const now = 1_000;
    recordProviderFailure('groq', 'llama-test', 'HTTP 429: retry in 2 seconds', now);

    expect(isProviderRoutePaused('groq', 'llama-test', now + 1_000)).toBe(true);
    const status = getProviderRateLimitStatuses([], now + 1_000)[0];
    expect(status).toMatchObject({
      provider: 'groq',
      model: 'llama-test',
      status: 'rate_limited',
      rateLimitHits: 1,
      requestCount: 1,
      retryAfterMs: 1_000,
    });
    expect(isProviderRoutePaused('groq', 'llama-test', now + 2_001)).toBe(false);
  });

  it('allows one explicit rate-limit probe without bypassing billing or quota pauses', () => {
    const now = 1_000;
    recordProviderFailure('openrouter', 'stealth/ox-alpha', 'HTTP 429 from OpenRouter', now);

    expect(tryAcquireProviderRoute('openrouter', 'stealth/ox-alpha', now + 1)).toBe(false);
    expect(tryAcquireProviderRoute('openrouter', 'stealth/ox-alpha', now + 1, undefined, true)).toBe(true);
    expect(tryAcquireProviderRoute('openrouter', 'stealth/ox-alpha', now + 1, undefined, true)).toBe(false);

    recordProviderSuccess('openrouter', 'stealth/ox-alpha', now + 2);
    expect(isProviderRoutePaused('openrouter', 'stealth/ox-alpha', now + 3)).toBe(false);
  });

  it('treats a bare Retry-After value as seconds', () => {
    recordProviderFailure('openrouter', 'openrouter/free', 'HTTP 429, Retry-After: 3', 5_000);
    expect(getProviderRateLimitStatuses([], 6_000)[0].retryAfterMs).toBe(2_000);
  });

  it('treats a bare retry-in threshold as seconds', () => {
    recordProviderFailure('gemini', 'gemini-flash', 'HTTP 429: Please retry in 2.5', 5_000);
    expect(getProviderRateLimitStatuses([], 6_000)[0]).toMatchObject({
      status: 'rate_limited',
      retryAfterMs: 1_500,
    });
  });

  it('classifies provider daily token thresholds as exhausted quota', () => {
    recordProviderFailure(
      'groq',
      'llama-test',
      'HTTP 429: Rate limit reached on tokens per day (TPD). Please try again in 56m',
      5_000,
    );
    expect(getProviderRateLimitStatuses([], 6_000)[0]).toMatchObject({
      status: 'quota_exhausted',
      pauseReason: 'quota_exhausted',
      retryAfterMs: 3_359_000,
    });
  });

  it('keeps a suspended Kimi billing route paused until success or manual reset', () => {
    const now = 10_000;
    recordProviderFailure(
      'kimi',
      'kimi-k2.7-code',
      'HTTP 429: Your account org-example is suspended due to insufficient balance, please recharge your account',
      now,
    );

    expect(isProviderRoutePaused('kimi', 'kimi-k2.7-code', now + 86_400_000)).toBe(true);
    expect(getProviderRoutePauseReason('kimi', 'kimi-k2.7-code', now + 86_400_000)).toBe('billing_required');
    expect(getProviderRateLimitStatuses([], now + 86_400_000)[0]).toMatchObject({
      status: 'billing_required',
      pauseReason: 'billing_required',
      pausedUntil: undefined,
    });

    expect(resetProviderRoute('kimi', 'kimi-k2.7-code')).toBe(true);
    expect(isProviderRoutePaused('kimi', 'kimi-k2.7-code', now + 86_400_001)).toBe(false);
  });

  it('pauses an exhausted daily OpenRouter quota until the provider reset timestamp', () => {
    const now = 1_784_550_000_000;
    const resetSeconds = Math.floor((now + 3_600_000) / 1_000);
    recordProviderFailure(
      'openrouter',
      'google/gemma-free',
      `HTTP 429: Rate limit exceeded: free-models-per-day, X-RateLimit-Remaining: 0, X-RateLimit-Reset: ${resetSeconds}`,
      now,
    );

    expect(isProviderRoutePaused('openrouter', 'google/gemma-free', now + 1)).toBe(true);
    expect(getProviderRateLimitStatuses([], now + 1)[0]).toMatchObject({
      status: 'quota_exhausted',
      pauseReason: 'quota_exhausted',
      retryAfterMs: 3_599_999,
    });
    expect(isProviderRoutePaused('openrouter', 'google/gemma-free', now + 3_600_001)).toBe(false);
    expect(getProviderRateLimitStatuses([], now + 3_600_001)[0].status).toBe('available');
  });

  it('keeps Requesty free-model allowance exhaustion paused when no reset is provided', () => {
    const now = 30_000;
    recordProviderFailure('requesty', 'poolside/laguna-m.1', 'HTTP 429: Free model rate limit exceeded', now);

    expect(isProviderRoutePaused('requesty', 'poolside/laguna-m.1', now + 86_400_000)).toBe(true);
    expect(getProviderRateLimitStatuses([], now + 86_400_000)[0]).toMatchObject({
      status: 'quota_exhausted',
      pauseReason: 'quota_exhausted',
      pausedUntil: undefined,
    });
  });

  it('isolates cooldowns by credential for the same provider and model', () => {
    const now = 10_000;
    recordProviderFailure('nvidia', 'z-ai/glm-5.2', 'HTTP 429', now, 0);

    expect(isProviderRoutePaused('nvidia', 'z-ai/glm-5.2', now + 1, 0)).toBe(true);
    expect(isProviderRoutePaused('nvidia', 'z-ai/glm-5.2', now + 1, 1)).toBe(false);

    recordProviderSuccess('nvidia', 'z-ai/glm-5.2', now + 2, 1);
    const statuses = getProviderRateLimitStatuses([], now + 3);
    expect(statuses).toHaveLength(2);
    expect(statuses.find((status) => status.credentialIndex === 0)?.status).toBe('rate_limited');
    expect(statuses.find((status) => status.credentialIndex === 1)).toMatchObject({
      status: 'available',
      successCount: 1,
    });
  });

  it('scores reliable routes above failing routes and excludes paused credentials', () => {
    const now = 50_000;
    recordProviderSuccess('requesty', 'healthy-model', now - 20);
    recordProviderSuccess('requesty', 'healthy-model', now - 10);
    recordProviderFailure('nvidia', 'slow-model', 'request timed out', now - 5, 0);
    recordProviderFailure('gemini', 'quota-model', 'HTTP 429: retry in 30 seconds', now, 2);

    const healthy = getProviderRouteHealthScore('requesty', 'healthy-model', now);
    const degraded = getProviderRouteHealthScore('nvidia', 'slow-model', now, 0);
    const paused = getProviderRouteHealthScore('gemini', 'quota-model', now, 2);

    expect(healthy).toBeGreaterThan(degraded);
    expect(paused).toBe(-10_000);
  });

  it('does not pause ordinary failures and clears a prior failure on success', () => {
    recordProviderFailure('nvidia', 'model-a', 'HTTP 503 unavailable', 1_000);
    expect(isProviderRoutePaused('nvidia', 'model-a', 1_001)).toBe(false);

    recordProviderSuccess('nvidia', 'model-a', 2_000);
    expect(getProviderRateLimitStatuses([], 2_000)[0]).toMatchObject({
      status: 'available',
      requestCount: 2,
      successCount: 1,
      failureCount: 1,
    });
  });

  it('does not classify generic provider suggestion text as a rate limit', () => {
    recordProviderFailure(
      'nvidia',
      'model-a',
      'NVIDIA model rotation failed. Suggested Fix: check credits, billing, and rate limits.',
      1_000,
    );

    expect(getProviderRateLimitStatuses([], 1_001)[0]).toMatchObject({
      status: 'available',
      rateLimitHits: 0,
    });
  });

  it('does not throttle the primary OpenRouter route for a throttled recovery model', () => {
    recordProviderFailure(
      'openrouter',
      'stealth/ox-alpha',
      'Error: OpenRouter returned no usable chat content\n' +
      'Cause: empty response (finish reason: stop)\n' +
      'Recovery route google/gemma-free also failed: Error: OpenRouter API request failed\n' +
      'Cause: HTTP 429 from OpenRouter',
      1_000,
    );

    expect(getProviderRateLimitStatuses([], 1_001)[0]).toMatchObject({
      provider: 'openrouter',
      model: 'stealth/ox-alpha',
      status: 'available',
      rateLimitHits: 0,
    });
  });

  it('opens a temporary circuit after two consecutive timeouts', () => {
    const now = 20_000;
    recordProviderFailure('nvidia', 'slow-model', 'request timed out', now, 1);
    expect(isProviderRoutePaused('nvidia', 'slow-model', now + 1, 1)).toBe(false);

    recordProviderFailure('nvidia', 'slow-model', 'deadline timeout', now + 10, 1);
    expect(isProviderRoutePaused('nvidia', 'slow-model', now + 11, 1)).toBe(true);
    expect(getProviderRateLimitStatuses([], now + 11)[0]).toMatchObject({
      status: 'cooldown',
      timeoutHits: 2,
      consecutiveTimeouts: 2,
      pauseReason: 'timeouts',
    });
    expect(isProviderRoutePaused('nvidia', 'slow-model', now + 11, 0)).toBe(false);
    expect(isProviderRoutePaused('nvidia', 'slow-model', now + 11, 2)).toBe(false);
  });

  it('opens on repeated transient failures and admits only one half-open probe', () => {
    const now = 60_000;
    recordProviderFailure('nvidia', 'unstable-model', 'HTTP 503 unavailable', now, 0);
    recordProviderFailure('nvidia', 'unstable-model', 'HTTP 502 bad gateway', now + 10, 0);
    recordProviderFailure('nvidia', 'unstable-model', 'HTTP 500 server error', now + 20, 0);

    expect(isProviderRoutePaused('nvidia', 'unstable-model', now + 21, 0)).toBe(true);
    expect(getProviderRateLimitStatuses([], now + 21)[0]).toMatchObject({
      status: 'cooldown',
      pauseReason: 'transient_failures',
      consecutiveFailures: 3,
      circuitState: 'open',
    });

    const afterCooldown = now + 60_021;
    expect(isProviderRoutePaused('nvidia', 'unstable-model', afterCooldown, 0)).toBe(false);
    expect(tryAcquireProviderRoute('nvidia', 'unstable-model', afterCooldown, 0)).toBe(true);
    expect(tryAcquireProviderRoute('nvidia', 'unstable-model', afterCooldown, 0)).toBe(false);

    recordProviderSuccess('nvidia', 'unstable-model', afterCooldown + 1, 0);
    expect(getProviderRateLimitStatuses([], afterCooldown + 1)[0]).toMatchObject({
      status: 'available',
      consecutiveFailures: 0,
      circuitState: 'closed',
    });
  });

  it('reopens a circuit when its half-open recovery probe fails', () => {
    const now = 80_000;
    recordProviderFailure('nvidia', 'probe-model', 'request timed out', now, 0);
    recordProviderFailure('nvidia', 'probe-model', 'deadline timeout', now + 1, 0);
    const afterCooldown = now + (2 * 60_000) + 2;

    expect(tryAcquireProviderRoute('nvidia', 'probe-model', afterCooldown, 0)).toBe(true);
    recordProviderFailure('nvidia', 'probe-model', 'HTTP 503 unavailable', afterCooldown + 1, 0);

    expect(isProviderRoutePaused('nvidia', 'probe-model', afterCooldown + 2, 0)).toBe(true);
    expect(getProviderRateLimitStatuses([], afterCooldown + 2)[0]).toMatchObject({
      circuitState: 'open',
      pauseReason: 'transient_failures',
    });
  });

  it('classifies Gemini current-quota exhaustion separately for each credential', () => {
    const now = 40_000;
    recordProviderFailure(
      'gemini',
      'gemini-3.5-flash',
      'HTTP 429: You exceeded your current quota, please check your plan and billing details.',
      now,
      1,
    );

    expect(getProviderRoutePauseReason('gemini', 'gemini-3.5-flash', now + 1, 1)).toBe('quota_exhausted');
    expect(isProviderRoutePaused('gemini', 'gemini-3.5-flash', now + 1, 0)).toBe(false);
    expect(isProviderRoutePaused('gemini', 'gemini-3.5-flash', now + 1, 2)).toBe(false);
  });

  it('does not interpret missing rate-limit headers as zero remaining', () => {
    updateProviderRateLimitHeaders('nvidia', 'model-without-headers', new Headers());
    expect(getProviderRateLimitStatuses()[0]).toMatchObject({ status: 'available' });
    expect(getProviderRateLimitStatuses()[0].remainingRequests).toBeUndefined();
    expect(getProviderRateLimitStatuses()[0].remainingTokens).toBeUndefined();
  });

  it('marks a route near its proactive header limit', () => {
    updateProviderRateLimitHeaders('openrouter', 'openrouter/free', new Headers({
      'x-ratelimit-remaining-requests': '1',
      'x-ratelimit-remaining-tokens': '900',
    }));

    expect(getProviderRateLimitStatuses()[0]).toMatchObject({
      status: 'near_limit',
      remainingRequests: 1,
      remainingTokens: 900,
    });
  });

  it('marks zero remaining requests as exhausted instead of merely near limit', () => {
    updateProviderRateLimitHeaders('openrouter', 'openrouter/free', new Headers({
      'x-ratelimit-remaining-requests': '0',
    }));

    expect(getProviderRateLimitStatuses()[0]).toMatchObject({
      status: 'quota_exhausted',
      pauseReason: 'quota_exhausted',
      remainingRequests: 0,
    });
  });

  it('includes configured free routes before they have activity', () => {
    const [status] = getProviderRateLimitStatuses([
      { provider: 'gemini', model: 'gemini-flash', tier: 'free' },
    ]);
    expect(status).toMatchObject({
      provider: 'gemini',
      model: 'gemini-flash',
      tier: 'free',
      status: 'available',
      requestCount: 0,
    });
  });
});
