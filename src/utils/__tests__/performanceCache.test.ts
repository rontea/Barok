import { describe, expect, it } from '@jest/globals';
import { PerformanceCache, memoizeAsyncWithCache } from '../performanceCache';

describe('PerformanceCache', () => {
  it('stores and retrieves fresh entries', () => {
    const cache = new PerformanceCache<string>({ ttlMs: 1000, maxEntries: 2 });

    cache.set('a', 'first');

    expect(cache.get('a')).toBe('first');
    expect(cache.has('a')).toBe(true);
  });

  it('expires stale entries', () => {
    let now = 0;
    const cache = new PerformanceCache<string>({
      ttlMs: 100,
      maxEntries: 2,
      now: () => now,
    });

    cache.set('a', 'first');
    now = 101;

    expect(cache.get('a')).toBeNull();
    expect(cache.size()).toBe(0);
  });

  it('evicts least recently used entries when full', () => {
    const cache = new PerformanceCache<string>({ ttlMs: 1000, maxEntries: 2 });

    cache.set('a', 'first');
    cache.set('b', 'second');
    expect(cache.get('a')).toBe('first');
    cache.set('c', 'third');

    expect(cache.get('a')).toBe('first');
    expect(cache.get('b')).toBeNull();
    expect(cache.get('c')).toBe('third');
    expect(cache.stats().evictions).toBe(1);
  });

  it('deduplicates concurrent async cold misses', async () => {
    let calls = 0;
    const memoized = memoizeAsyncWithCache(
      async (value: string) => {
        calls += 1;
        await Promise.resolve();
        return value.toUpperCase();
      },
      (value) => value,
      { ttlMs: 1000, maxEntries: 2 }
    );

    const [first, second] = await Promise.all([memoized('a'), memoized('a')]);

    expect(first).toBe('A');
    expect(second).toBe('A');
    expect(calls).toBe(1);
  });

  it('returns stale values while refreshing expired entries', async () => {
    let now = 0;
    const cache = new PerformanceCache<string>({
      ttlMs: 100,
      maxEntries: 2,
      now: () => now,
    });

    cache.set('a', 'old');
    now = 101;

    const stale = cache.getStaleWhileRevalidate('a', async () => 'new');
    expect(stale).toBe('old');

    await Promise.resolve();
    await Promise.resolve();

    expect(cache.get('a')).toBe('new');
    expect(cache.stats().staleHits).toBe(1);
    expect(cache.stats().staleRefreshes).toBe(1);
  });

  it('tracks hits, misses, sets, and deletes', () => {
    const cache = new PerformanceCache<string>({ ttlMs: 1000, maxEntries: 2 });

    cache.set('a', 'first');
    expect(cache.get('a')).toBe('first');
    expect(cache.get('b')).toBeNull();
    expect(cache.delete('a')).toBe(true);

    expect(cache.stats()).toMatchObject({
      hits: 1,
      misses: 1,
      sets: 1,
      deletes: 1,
    });
  });
});
