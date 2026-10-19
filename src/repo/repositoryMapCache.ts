/**
 * Repository Map Caching System
 * Caches discovered repository structure with automatic invalidation
 */

import type { RepositoryMap } from './repositoryMap.js';
import { discoverRepositoryMap, isRepositoryMapValid } from './repositoryMap.js';
import { PerformanceCache } from '../utils/performanceCache.js';
import type { PerformanceCacheStats } from '../utils/performanceCache.js';

/**
 * Cache storage for repository maps
 */
class RepositoryMapCache {
  private cache: PerformanceCache<RepositoryMap>;
  private cacheTtlMs: number = 5 * 60 * 1000; // 5 minutes default

  constructor() {
    this.cache = this.createCache(this.cacheTtlMs);
  }

  /**
   * Get or discover repository map
   */
  getRepositoryMap(rootPath: string): RepositoryMap {
    const cached = this.cache.get(rootPath);

    // Return valid cache
    if (cached && isRepositoryMapValid(cached, rootPath)) {
      return cached;
    }

    // Discover and cache
    const map = discoverRepositoryMap(rootPath);
    this.cache.set(rootPath, map);
    return map;
  }

  /**
   * Invalidate cache for specific repository
   */
  invalidate(rootPath: string): void {
    this.cache.delete(rootPath);
  }

  /**
   * Invalidate all caches
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Set cache TTL
   */
  setTtl(ttlMs: number): void {
    this.cacheTtlMs = Math.max(1, ttlMs);
    this.cache = this.createCache(this.cacheTtlMs);
  }

  /**
   * Get cache size
   */
  getCacheSize(): number {
    return this.cache.size();
  }

  getStats(): PerformanceCacheStats {
    return this.cache.stats();
  }

  getTtl(): number {
    return this.cacheTtlMs;
  }

  private createCache(ttlMs: number): PerformanceCache<RepositoryMap> {
    return new PerformanceCache<RepositoryMap>({
      ttlMs,
      maxEntries: 16,
    });
  }
}

// Global cache instance
const globalCache = new RepositoryMapCache();

/**
 * Get or discover repository map (uses global cache)
 */
export function getCachedRepositoryMap(rootPath: string): RepositoryMap {
  return globalCache.getRepositoryMap(rootPath);
}

/**
 * Invalidate repository map cache
 */
export function invalidateRepositoryCache(rootPath: string): void {
  globalCache.invalidate(rootPath);
}

/**
 * Invalidate all caches
 */
export function invalidateAllRepositoryCaches(): void {
  globalCache.invalidateAll();
}

/**
 * Set global cache TTL
 */
export function setRepositoryCacheTtl(ttlMs: number): void {
  globalCache.setTtl(ttlMs);
}

/**
 * Get cache statistics
 */
export function getRepositoryCacheStats(): PerformanceCacheStats {
  return {
    ...globalCache.getStats(),
    ttlMs: globalCache.getTtl(),
  };
}

export default globalCache;
