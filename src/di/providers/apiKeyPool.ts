/**
 * Gemini API Key Pool Manager
 * 
 * Manages multiple Gemini API keys for:
 * - Load balancing across keys
 * - Automatic fallback on rate limit errors
 * - Key rotation and health tracking
 * - Request distribution
 */

import { getRuntimeEnvValue } from '../../config/runtimeEnv.js';

export interface ApiKeyPoolConfig {
  keys: string[];
  primaryKey?: string;  // Main model - gets priority
  rotationStrategy?: 'round-robin' | 'random' | 'least-used' | 'primary-first';
  enableHealthTracking?: boolean;
}

export interface KeyHealthMetrics {
  key: string;
  label: string;
  usageCount: number;
  errorCount: number;
  lastUsed: Date;
  isHealthy: boolean;
  rateLimitReset?: Date;
  isPrimary?: boolean;  // True if this is the main model key
}

/**
 * Manages a pool of API keys with rotation and health tracking
 * Supports hierarchical model: primary key (main model) + secondary keys (sub-agents)
 */
export class ApiKeyPool {
  private keys: string[];
  private primaryKey: string | null;
  private rotationStrategy: 'round-robin' | 'random' | 'least-used' | 'primary-first';
  private enableHealthTracking: boolean;
  private currentIndex: number = 0;
  private metrics: Map<string, KeyHealthMetrics> = new Map();

  constructor(config: ApiKeyPoolConfig) {
    if (!config.keys || config.keys.length === 0) {
      throw new Error('API key pool must have at least one key');
    }

    this.keys = config.keys.filter(k => k && k.trim().length > 0);
    if (this.keys.length === 0) {
      throw new Error('No valid API keys provided');
    }

    // Set primary key (main model) - defaults to first key if not specified
    this.primaryKey = config.primaryKey && config.primaryKey.trim().length > 0 ? config.primaryKey : this.keys[0];

    // Default to 'primary-first' if multiple keys, otherwise 'round-robin'
    this.rotationStrategy = config.rotationStrategy || (this.keys.length > 1 ? 'primary-first' : 'round-robin');
    this.enableHealthTracking = config.enableHealthTracking !== false;

    // Initialize metrics for all keys
    this.keys.forEach((key, index) => {
      this.metrics.set(key, {
        key,
        label: `agent ${index + 1}`,
        usageCount: 0,
        errorCount: 0,
        lastUsed: new Date(0),
        isHealthy: true,
        isPrimary: key === this.primaryKey,
      });
    });
  }

  /**
   * Get the next API key based on rotation strategy
   * @param preferHealthy - If true, prioritize healthy keys
   * @returns Next API key to use
   */
  getNextKey(preferHealthy: boolean = true): string {
    this.refreshExpiredRateLimits();
    let selectedKey: string | null = null;

    if (preferHealthy && this.enableHealthTracking) {
      const healthyKeys = this.keys.filter(k => {
        const metrics = this.metrics.get(k);
        return metrics?.isHealthy !== false;
      });

      if (healthyKeys.length > 0) {
        selectedKey = this.selectByStrategy(healthyKeys);
      }
    }

    if (!selectedKey) {
      selectedKey = this.selectByStrategy(this.keys);
    }

    this.recordUsage(selectedKey);
    return selectedKey;
  }

  /**
   * Get candidate keys for a request without recording usage.
   * Useful when a caller needs to avoid retrying the same key in one retry cycle.
   */
  getCandidateKeys(preferHealthy: boolean = true): string[] {
    this.refreshExpiredRateLimits();
    let candidates = this.keys;

    if (preferHealthy && this.enableHealthTracking) {
      const healthyKeys = this.keys.filter(k => {
        const metrics = this.metrics.get(k);
        return metrics?.isHealthy !== false;
      });

      if (healthyKeys.length > 0) {
        candidates = healthyKeys;
      }
    }

    return this.sortByStrategy(candidates).filter((key, index, keys) => keys.indexOf(key) === index);
  }

  /**
   * Select a key based on configured rotation strategy
   */
  private selectByStrategy(keyList: string[]): string {
    switch (this.rotationStrategy) {
      case 'random':
        return keyList[Math.floor(Math.random() * keyList.length)];

      case 'least-used':
        return this.selectLeastUsed(keyList);

      case 'primary-first':
        return this.selectPrimaryFirst(keyList);

      case 'round-robin':
      default:
        return this.selectRoundRobin(keyList);
    }
  }

  /**
   * Primary-first selection: prefer primary key, use sub-agents as fallback
   * Main model gets priority, sub-agent keys used only when primary is unhealthy
   */
  private selectPrimaryFirst(keyList: string[]): string {
    // If primary key is in list and healthy, use it
    if (this.primaryKey && keyList.includes(this.primaryKey)) {
      const primaryMetrics = this.metrics.get(this.primaryKey);
      if (primaryMetrics?.isHealthy) {
        return this.primaryKey;
      }
    }

    // Primary unavailable, use least-used from remaining keys (sub-agents)
    return this.selectLeastUsed(keyList);
  }

  /**
   * Round-robin selection
   */
  private selectRoundRobin(keyList: string[]): string {
    const key = keyList[this.currentIndex % keyList.length];
    this.currentIndex++;
    return key;
  }

  /**
   * Select key with least usage
   */
  private selectLeastUsed(keyList: string[]): string {
    let minUsage = Infinity;
    let selectedKey = keyList[0];

    for (const key of keyList) {
      const metrics = this.metrics.get(key);
      const usage = metrics?.usageCount ?? 0;
      if (usage < minUsage) {
        minUsage = usage;
        selectedKey = key;
      }
    }

    return selectedKey;
  }

  /**
   * Record successful key usage
   */
  private recordUsage(key: string): void {
    const metrics = this.metrics.get(key);
    if (metrics) {
      metrics.usageCount++;
      metrics.lastUsed = new Date();
    }
  }

  /**
   * Record error for a key
   * @param key - API key that failed
   * @param errorType - Type of error (e.g., 'RATE_LIMIT', 'AUTH_ERROR', 'SERVER_ERROR')
   * @param rateLimitResetTime - Optional reset time for rate limit errors
   */
  recordError(
    key: string,
    errorType: 'RATE_LIMIT' | 'AUTH_ERROR' | 'SERVER_ERROR' | 'OTHER' = 'OTHER',
    rateLimitResetTime?: Date
  ): void {
    const metrics = this.metrics.get(key);
    if (!metrics) return;

    metrics.errorCount++;

    // Mark key as unhealthy for specific errors
    if (errorType === 'AUTH_ERROR') {
      metrics.isHealthy = false;
    } else if (errorType === 'RATE_LIMIT') {
      metrics.isHealthy = false;
      if (rateLimitResetTime) {
        metrics.rateLimitReset = rateLimitResetTime;
        // Reset health status after rate limit window
        const resetDelay = Math.max(0, rateLimitResetTime.getTime() - Date.now());
        if (resetDelay > 0) {
          const timer = setTimeout(() => {
            metrics.isHealthy = true;
            metrics.rateLimitReset = undefined;
          }, resetDelay + 1000); // Add 1s buffer
          if (typeof (timer as any).unref === 'function') {
            (timer as any).unref();
          }
        }
      } else {
        const defaultResetDelayMs = 60_000;
        metrics.rateLimitReset = new Date(Date.now() + defaultResetDelayMs);
        const timer = setTimeout(() => {
          metrics.isHealthy = true;
          metrics.rateLimitReset = undefined;
        }, defaultResetDelayMs + 1000);
        if (typeof (timer as any).unref === 'function') {
          (timer as any).unref();
        }
      }
    } else if (errorType === 'SERVER_ERROR' && metrics.errorCount > 3) {
      // Mark as unhealthy after multiple server errors
      metrics.isHealthy = false;
    }
  }

  /**
   * Mark a key as healthy
   */
  markHealthy(key: string): void {
    const metrics = this.metrics.get(key);
    if (metrics) {
      metrics.isHealthy = true;
    }
  }

  /**
   * Get health metrics for all keys
   */
  getMetrics(): KeyHealthMetrics[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Get metrics for a specific key
   */
  getKeyMetrics(key: string): KeyHealthMetrics | undefined {
    return this.metrics.get(key);
  }

  /**
   * Order keys according to the configured rotation strategy.
   * Unlike selectByStrategy, this returns every candidate.
   */
  private sortByStrategy(keyList: string[]): string[] {
    switch (this.rotationStrategy) {
      case 'random':
        return [...keyList].sort(() => Math.random() - 0.5);

      case 'least-used':
        return [...keyList].sort((a, b) => {
          const aUsage = this.metrics.get(a)?.usageCount ?? 0;
          const bUsage = this.metrics.get(b)?.usageCount ?? 0;
          return aUsage - bUsage;
        });

      case 'primary-first': {
        const ordered = [...keyList];
        if (this.primaryKey && ordered.includes(this.primaryKey)) {
          const primaryMetrics = this.metrics.get(this.primaryKey);
          if (primaryMetrics?.isHealthy) {
            return [
              this.primaryKey,
              ...ordered
                .filter(k => k !== this.primaryKey)
                .sort((a, b) => (this.metrics.get(a)?.usageCount ?? 0) - (this.metrics.get(b)?.usageCount ?? 0)),
            ];
          }
        }
        return ordered.sort((a, b) => (this.metrics.get(a)?.usageCount ?? 0) - (this.metrics.get(b)?.usageCount ?? 0));
      }

      case 'round-robin':
      default:
        return keyList.map((_, offset) => keyList[(this.currentIndex + offset) % keyList.length]);
    }
  }

  /**
   * Get the non-secret display label for a key.
   */
  getKeyLabel(key: string): string {
    return this.metrics.get(key)?.label || 'agent ?';
  }

  /**
   * Get count of healthy keys
   */
  getHealthyKeyCount(): number {
    this.refreshExpiredRateLimits();
    return Array.from(this.metrics.values()).filter(m => m.isHealthy).length;
  }

  /**
   * Check if any keys are available
   */
  hasHealthyKeys(): boolean {
    return this.getHealthyKeyCount() > 0;
  }

  /**
   * Get the primary (main model) key
   */
  getPrimaryKey(): string | null {
    return this.primaryKey;
  }

  /**
   * Get primary key metrics
   */
  getPrimaryKeyMetrics(): KeyHealthMetrics | undefined {
    if (!this.primaryKey) return undefined;
    return this.metrics.get(this.primaryKey);
  }

  /**
   * Get all sub-agent keys (non-primary)
   */
  getSubAgentKeys(): string[] {
    return this.keys.filter(k => k !== this.primaryKey);
  }

  /**
   * Get primary key with its health status
   */
  getPrimaryKeyStatus(): { key: string; healthy: boolean } | null {
    if (!this.primaryKey) return null;
    const metrics = this.metrics.get(this.primaryKey);
    return {
      key: this.primaryKey,
      healthy: metrics?.isHealthy ?? false,
    };
  }

  /**
   * Check if primary key is available and healthy
   */
  isPrimaryKeyHealthy(): boolean {
    if (!this.primaryKey) return false;
    const metrics = this.metrics.get(this.primaryKey);
    return metrics?.isHealthy ?? false;
  }

  /**
   * Get total number of keys
   */
  getTotalKeyCount(): number {
    return this.keys.length;
  }

  /** Return one configured key by stable zero-based pool position. */
  getKeyAtIndex(index: number): string | undefined {
    return Number.isInteger(index) && index >= 0 ? this.keys[index] : undefined;
  }

  hasKeyAtIndex(index: number): boolean {
    return this.getKeyAtIndex(index) !== undefined;
  }

  /**
   * Reset all metrics
   */
  resetMetrics(): void {
    for (const metrics of this.metrics.values()) {
      metrics.usageCount = 0;
      metrics.errorCount = 0;
      metrics.isHealthy = true;
    }
    this.currentIndex = 0;
  }

  /**
   * Get statistics summary
   */
  getStats(): {
    totalKeys: number;
    healthyKeys: number;
    totalRequests: number;
    totalErrors: number;
    avgErrorRate: number;
  } {
    this.refreshExpiredRateLimits();
    const allMetrics = Array.from(this.metrics.values());
    const totalRequests = allMetrics.reduce((sum, m) => sum + m.usageCount, 0);
    const totalErrors = allMetrics.reduce((sum, m) => sum + m.errorCount, 0);
    const healthyKeys = allMetrics.filter(m => m.isHealthy).length;

    return {
      totalKeys: this.keys.length,
      healthyKeys,
      totalRequests,
      totalErrors,
      avgErrorRate: totalRequests > 0 ? totalErrors / totalRequests : 0,
    };
  }

  /**
   * Restore keys whose rate-limit window has elapsed.
   */
  private refreshExpiredRateLimits(): void {
    const now = Date.now();
    for (const metrics of this.metrics.values()) {
      if (!metrics.isHealthy && metrics.rateLimitReset && metrics.rateLimitReset.getTime() <= now) {
        metrics.isHealthy = true;
        metrics.rateLimitReset = undefined;
      }
    }
  }
}

/**
 * Parse API keys from environment variable or comma-separated string
 * Returns array with optional primary key designation
 * Format: "key1,key2,key3" or "key1:primary,key2,key3"
 * @param input - Comma-separated API keys or single key
 * @returns Object with keys array and optional primaryKey
 */
export function parseApiKeyPool(input: string | undefined): { keys: string[]; primaryKey?: string } {
  if (!input) return { keys: [] };

  const result = { keys: [] as string[], primaryKey: undefined as string | undefined };

  const parts = input
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0);

  for (const part of parts) {
    // Check for primary key marker (e.g., "key:primary")
    if (part.includes(':primary')) {
      const key = part.replace(':primary', '').trim();
      if (key.length > 0) {
        result.keys.push(key);
        result.primaryKey = key;
      }
    } else {
      result.keys.push(part);
    }
  }

  return result;
}

/**
 * Create API key pool from environment variable
 * Falls back to single key if environment variable format is detected
 * Supports hierarchical configuration: primary key + sub-agent keys
 * Format: GEMINI_API_KEY=key1 (primary), GEMINI_API_KEYS=key1:primary,key2,key3
 * @param envVarName - Name of environment variable (e.g., 'GEMINI_API_KEYS')
 * @param primaryKeyEnvVar - Environment variable for primary key (e.g., 'GEMINI_API_KEY')
 * @param fallbackKey - Single key fallback (e.g., process.env.GEMINI_API_KEY)
 * @returns ApiKeyPool instance or null if no keys found
 */
export function createApiKeyPoolFromEnv(
  envVarName: string,
  primaryKeyEnvVar?: string,
  fallbackKey?: string
): ApiKeyPool | null {
  const configuredStrategy = getRuntimeEnvValue('GEMINI_KEY_ROTATION_STRATEGY') as
    | ApiKeyPoolConfig['rotationStrategy']
    | undefined;
  const isValidStrategy =
    configuredStrategy === 'round-robin' ||
    configuredStrategy === 'random' ||
    configuredStrategy === 'least-used' ||
    configuredStrategy === 'primary-first';
  const multiKeyStrategy = isValidStrategy ? configuredStrategy : 'least-used';

  // Try to get pool from environment variable
  const poolEnv = getRuntimeEnvValue(envVarName);
  if (poolEnv) {
    const parsed = parseApiKeyPool(poolEnv);
    if (parsed.keys.length > 0) {
      // If no explicit primary in config, check primary key env var
      const primaryKey = parsed.primaryKey || (primaryKeyEnvVar ? getRuntimeEnvValue(primaryKeyEnvVar) : undefined) || fallbackKey;
      const keys = primaryKey && !parsed.keys.includes(primaryKey)
        ? [primaryKey, ...parsed.keys]
        : parsed.keys;

      return new ApiKeyPool({
        keys,
        primaryKey,
        rotationStrategy: keys.length > 1 ? multiKeyStrategy : 'primary-first',
      });
    }
  }

  // Try to get primary key from dedicated env var
  const primaryKey = primaryKeyEnvVar ? getRuntimeEnvValue(primaryKeyEnvVar) || fallbackKey : fallbackKey;
  if (primaryKey) {
    return new ApiKeyPool({
      keys: [primaryKey],
      primaryKey,
      rotationStrategy: 'primary-first',
    });
  }

  return null;
}

/**
 * Parse error response to determine error type and rate limit info
 */
export function parseGeminiError(
  error: unknown
): {
  type: 'RATE_LIMIT' | 'AUTH_ERROR' | 'SERVER_ERROR' | 'OTHER';
  resetTime?: Date;
  message: string;
} {
  const errorStr = error instanceof Error ? error.message : String(error);
  const message = errorStr.substring(0, 200);

  if (
    errorStr.includes('429') ||
    errorStr.includes('RESOURCE_EXHAUSTED') ||
    errorStr.includes('rate limit') ||
    /retry in\s+\d+(?:\.\d+)?s/i.test(errorStr) ||
    /"retryDelay"\s*:\s*"\d+(?:\.\d+)?s"/i.test(errorStr)
  ) {
    // Parse rate limit reset time if available
    const resetMatch =
      errorStr.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i) ||
      errorStr.match(/retry(?:Delay)?\s*[:=]\s*"?(\d+(?:\.\d+)?)s"?/i) ||
      errorStr.match(/retry in\s+(\d+(?:\.\d+)?)s/i) ||
      errorStr.match(/reset[s]? (?:at|in)\s*(\d+(?:\.\d+)?)/i);
    const resetSeconds = resetMatch ? Number.parseFloat(resetMatch[1]) : undefined;
    const resetTime = Number.isFinite(resetSeconds)
      ? new Date(Date.now() + Math.max(1, resetSeconds!) * 1000)
      : undefined;

    return {
      type: 'RATE_LIMIT',
      resetTime,
      message,
    };
  }

  if (
    errorStr.includes('401') ||
    errorStr.includes('403') ||
    errorStr.includes('UNAUTHENTICATED') ||
    errorStr.includes('PERMISSION_DENIED') ||
    errorStr.includes('invalid api key')
  ) {
    return {
      type: 'AUTH_ERROR',
      message,
    };
  }

  if (errorStr.includes('500') || errorStr.includes('502') || errorStr.includes('503') || errorStr.includes('SERVICE_UNAVAILABLE')) {
    return {
      type: 'SERVER_ERROR',
      message,
    };
  }

  return {
    type: 'OTHER',
    message,
  };
}
