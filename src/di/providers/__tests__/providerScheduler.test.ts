import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { NormalizedProviderError } from '../providerErrors.js';
import { ProviderScheduler } from '../providerScheduler.js';

const retryable = () => new NormalizedProviderError({
  provider: 'groq', code: 'TEMPORARILY_UNAVAILABLE', retryable: true,
  safeMessage: 'temporary',
});

describe('ProviderScheduler', () => {
  afterEach(() => jest.useRealTimers());

  it('retries only normalized transient failures within the configured limit', async () => {
    const scheduler = new ProviderScheduler({
      provider: 'groq', maxConcurrency: 1, maxPending: 5, maxRetries: 2,
      maxRequestsPerTask: 5, baseRetryDelayMs: 1, maxRetryDelayMs: 1, random: () => 0,
    });
    let calls = 0;
    await expect(scheduler.run(async () => {
      calls++;
      if (calls < 3) throw retryable();
      return 'ok';
    }, { taskId: 'retry-task' })).resolves.toBe('ok');
    expect(calls).toBe(3);
    expect(scheduler.getSnapshot().totals.retries).toBe(2);
  });

  it('does not retry authentication, capability, or rate-limit failures', async () => {
    for (const code of ['AUTHENTICATION_FAILED', 'UNSUPPORTED_CAPABILITY', 'RATE_LIMITED'] as const) {
      const scheduler = new ProviderScheduler({
        provider: 'groq', maxConcurrency: 1, maxPending: 5, maxRetries: 3, maxRequestsPerTask: 5,
      });
      let calls = 0;
      await expect(scheduler.run(async () => {
        calls++;
        throw new NormalizedProviderError({ provider: 'groq', code, retryable: false, safeMessage: code });
      })).rejects.toThrow(code);
      expect(calls).toBe(1);
      await scheduler.shutdown();
    }
  });

  it('rejects queue overflow safely', async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const scheduler = new ProviderScheduler({
      provider: 'groq', maxConcurrency: 1, maxPending: 1, maxRetries: 0, maxRequestsPerTask: 5,
    });
    const active = scheduler.run(async () => { await blocker; return 'active'; });
    const queued = scheduler.run(async () => 'queued');
    await expect(scheduler.run(async () => 'overflow')).rejects.toMatchObject({
      providerError: { code: 'CAPACITY_EXCEEDED' },
    });
    release();
    await expect(Promise.all([active, queued])).resolves.toEqual(['active', 'queued']);
  });

  it('uses priority with FIFO ordering inside a priority', async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const order: string[] = [];
    const scheduler = new ProviderScheduler({
      provider: 'groq', maxConcurrency: 1, maxPending: 5, maxRetries: 0, maxRequestsPerTask: 10,
    });
    const active = scheduler.run(async () => { await blocker; order.push('active'); });
    const low = scheduler.run(async () => { order.push('low'); }, { priority: 10 });
    const high1 = scheduler.run(async () => { order.push('high1'); }, { priority: 90 });
    const high2 = scheduler.run(async () => { order.push('high2'); }, { priority: 90 });
    release();
    await Promise.all([active, low, high1, high2]);
    expect(order).toEqual(['active', 'high1', 'high2', 'low']);
  });

  it('removes an aborted queued request before transport', async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const scheduler = new ProviderScheduler({
      provider: 'groq', maxConcurrency: 1, maxPending: 5, maxRetries: 0, maxRequestsPerTask: 5,
    });
    const active = scheduler.run(async () => blocker);
    const controller = new AbortController();
    let dispatched = false;
    const queued = scheduler.run(async () => { dispatched = true; }, { signal: controller.signal });
    controller.abort();
    release();
    await active;
    await expect(queued).rejects.toBeDefined();
    expect(dispatched).toBe(false);
  });

  it('waits through cooldown and permits one recovery probe before normal dispatch', async () => {
    jest.useFakeTimers();
    let now = 1_000;
    let releaseProbe!: () => void;
    const probeBlocker = new Promise<void>((resolve) => { releaseProbe = resolve; });
    const order: string[] = [];
    const scheduler = new ProviderScheduler({
      provider: 'groq', maxConcurrency: 3, maxPending: 5, maxRetries: 0, maxRequestsPerTask: 10,
      now: () => now,
    });
    scheduler.setCooldown(2_000, 'RATE_LIMITED');
    const probe = scheduler.run(async () => { order.push('probe'); await probeBlocker; return 'probe'; });
    const next = scheduler.run(async () => { order.push('next'); return 'next'; });
    expect(order).toEqual([]);
    now = 2_001;
    await jest.advanceTimersByTimeAsync(1_001);
    expect(order).toEqual(['probe']);
    releaseProbe();
    await expect(probe).resolves.toBe('probe');
    await expect(next).resolves.toBe('next');
    expect(order).toEqual(['probe', 'next']);
  });

  it('enforces task budgets and expires queued work before transport', async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const scheduler = new ProviderScheduler({
      provider: 'groq', maxConcurrency: 1, maxPending: 5, maxRetries: 0, maxRequestsPerTask: 1,
    });
    const first = scheduler.run(async () => { await blocker; return 'first'; }, { taskId: 'bounded-task' });
    let dispatched = false;
    const budgetExceeded = scheduler.run(async () => { dispatched = true; }, { taskId: 'bounded-task' });
    const expired = scheduler.run(async () => { dispatched = true; }, { deadlineAt: Date.now() - 1 });
    release();
    await expect(first).resolves.toBe('first');
    await expect(budgetExceeded).rejects.toMatchObject({ providerError: { code: 'INVALID_REQUEST' } });
    await expect(expired).rejects.toMatchObject({ providerError: { code: 'REQUEST_TIMEOUT' } });
    expect(dispatched).toBe(false);
  });

  it('cancels pending work during graceful shutdown and rejects new work', async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const scheduler = new ProviderScheduler({
      provider: 'groq', maxConcurrency: 1, maxPending: 5, maxRetries: 0, maxRequestsPerTask: 5,
    });
    const active = scheduler.run(async () => { await blocker; return 'active'; });
    const queued = scheduler.run(async () => 'queued');
    await scheduler.shutdown();
    await expect(queued).rejects.toMatchObject({ providerError: { code: 'CANCELLED' } });
    await expect(scheduler.run(async () => 'late')).rejects.toMatchObject({
      providerError: { code: 'CAPACITY_EXCEEDED' },
    });
    release();
    await expect(active).resolves.toBe('active');
  });
});
