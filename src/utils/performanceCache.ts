export interface PerformanceCacheEntry<T> {
  key: string;
  value: T;
  timestamp: number;
  ttlMs: number;
  refreshing: boolean;
}

export interface PerformanceCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
  onRefreshError?: (error: unknown) => void;
}

export interface PerformanceCacheStats {
  size: number;
  maxEntries: number;
  ttlMs: number;
  inFlight: number;
  hits: number;
  misses: number;
  staleHits: number;
  staleRefreshes: number;
  sets: number;
  evictions: number;
  deletes: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 100;

export class PerformanceCache<T> {
  private readonly cache = new Map<string, PerformanceCacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly onRefreshError?: (error: unknown) => void;
  private hits = 0;
  private misses = 0;
  private staleHits = 0;
  private staleRefreshes = 0;
  private sets = 0;
  private evictions = 0;
  private deletes = 0;

  constructor(options: PerformanceCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.now = options.now ?? Date.now;
    this.onRefreshError = options.onRefreshError;
  }

  set(key: string, value: T): void {
    this.cache.delete(key);
    this.cache.set(key, {
      key,
      value,
      timestamp: this.now(),
      ttlMs: this.ttlMs,
      refreshing: false,
    });
    this.sets += 1;
    this.evictIfNeeded();
  }

  get(key: string): T | null {
    const entry = this.getEntry(key);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    return entry.value;
  }

  getStale(key: string): T | null {
    const entry = this.getEntry(key);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    this.staleHits += 1;
    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  async getOrCompute(key: string, compute: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== null) return cached;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = compute();
    this.inFlight.set(key, promise);
    try {
      const value = await promise;
      if (this.inFlight.get(key) === promise) {
        this.set(key, value);
      }
      return value;
    } finally {
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
    }
  }

  getStaleWhileRevalidate(key: string, refresh: () => Promise<T>): T | null {
    const entry = this.getEntry(key);
    if (!entry) {
      this.misses += 1;
      return null;
    }

    if (this.isExpired(entry) && !entry.refreshing) {
      entry.refreshing = true;
      this.staleRefreshes += 1;
      const originalEntry = entry;
      const promise = refresh();
      this.inFlight.set(key, promise);

      promise
        .then((value) => {
          if (this.cache.get(key) === originalEntry) {
            this.set(key, value);
          }
        })
        .catch((error) => {
          this.onRefreshError?.(error);
          if (this.cache.get(key) === originalEntry) {
            // Keep serving the last good value and allow the next read to
            // retry the refresh. A failed refresh must not turn stale-while-
            // revalidate into a blocking cold miss on the following request.
            originalEntry.refreshing = false;
          }
        })
        .finally(() => {
          if (this.inFlight.get(key) === promise) {
            this.inFlight.delete(key);
          }
        });
    }

    this.staleHits += 1;
    return entry.value;
  }

  delete(key: string): boolean {
    this.inFlight.delete(key);
    const deleted = this.cache.delete(key);
    if (deleted) this.deletes += 1;
    return deleted;
  }

  clear(): void {
    this.deletes += this.cache.size;
    this.cache.clear();
    this.inFlight.clear();
  }

  size(): number {
    return this.cache.size;
  }

  stats(): PerformanceCacheStats {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
      inFlight: this.inFlight.size,
      hits: this.hits,
      misses: this.misses,
      staleHits: this.staleHits,
      staleRefreshes: this.staleRefreshes,
      sets: this.sets,
      evictions: this.evictions,
      deletes: this.deletes,
    };
  }

  private getEntry(key: string): PerformanceCacheEntry<T> | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  private isExpired(entry: PerformanceCacheEntry<T>): boolean {
    return this.now() - entry.timestamp > entry.ttlMs;
  }

  private evictIfNeeded(): void {
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (typeof oldestKey !== 'string') return;
      this.cache.delete(oldestKey);
      this.evictions += 1;
    }
  }
}

export function memoizeAsyncWithCache<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
  keyForArgs: (...args: Args) => string,
  options?: PerformanceCacheOptions
): ((...args: Args) => Promise<Result>) & { cache: PerformanceCache<Result> } {
  const cache = new PerformanceCache<Result>(options);

  const memoized = ((...args: Args) => {
    const key = keyForArgs(...args);
    return cache.getOrCompute(key, () => fn(...args));
  }) as ((...args: Args) => Promise<Result>) & { cache: PerformanceCache<Result> };

  memoized.cache = cache;
  return memoized;
}
