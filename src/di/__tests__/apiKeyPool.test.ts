/**
 * Multi-Gemini API Key Pool Support - Test Suite
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { ApiKeyPool, parseApiKeyPool, parseGeminiError, createApiKeyPoolFromEnv } from '../providers/apiKeyPool.js';

describe('ApiKeyPool', () => {
  describe('initialization', () => {
    it('should create pool with multiple keys', () => {
      const keys = ['key1', 'key2', 'key3'];
      const pool = new ApiKeyPool({ keys });
      expect(pool.getTotalKeyCount()).toBe(3);
    });

    it('should throw error with empty keys', () => {
      expect(() => new ApiKeyPool({ keys: [] })).toThrow('must have at least one key');
    });

    it('should filter out empty keys', () => {
      const keys = ['key1', '', 'key2', '  '];
      const pool = new ApiKeyPool({ keys });
      expect(pool.getTotalKeyCount()).toBe(2);
    });

    it('should accept round-robin strategy', () => {
      const pool = new ApiKeyPool({
        keys: ['key1', 'key2'],
        rotationStrategy: 'round-robin',
      });
      expect(pool.getTotalKeyCount()).toBe(2);
    });

    it('should set first key as primary by default', () => {
      const keys = ['key1', 'key2', 'key3'];
      const pool = new ApiKeyPool({ keys });
      expect(pool.getPrimaryKey()).toBe('key1');
    });

    it('should assign non-secret agent labels to each key', () => {
      const pool = new ApiKeyPool({ keys: ['key1', 'key2', 'key3'] });

      expect(pool.getKeyLabel('key1')).toBe('agent 1');
      expect(pool.getKeyLabel('key2')).toBe('agent 2');
      expect(pool.getKeyLabel('key3')).toBe('agent 3');
      expect(pool.getMetrics().map((metric) => metric.label)).toEqual([
        'agent 1',
        'agent 2',
        'agent 3',
      ]);
    });

    it('should set specified primary key', () => {
      const keys = ['key1', 'key2', 'key3'];
      const pool = new ApiKeyPool({ keys, primaryKey: 'key2' });
      expect(pool.getPrimaryKey()).toBe('key2');
    });

    it('should accept primary-first strategy', () => {
      const pool = new ApiKeyPool({
        keys: ['key1', 'key2'],
        rotationStrategy: 'primary-first',
      });
      expect(pool.getPrimaryKey()).toBe('key1');
    });

    it('should use primary-first as default with multiple keys', () => {
      const pool = new ApiKeyPool({ keys: ['key1', 'key2', 'key3'] });
      // Strategy should be primary-first by default for multiple keys
      const firstKey = pool.getNextKey();
      expect(firstKey).toBe('key1'); // Primary key
    });

    it('should accept random strategy', () => {
      const pool = new ApiKeyPool({
        keys: ['key1', 'key2'],
        rotationStrategy: 'random',
      });
      expect(pool.getTotalKeyCount()).toBe(2);
    });

    it('should accept least-used strategy', () => {
      const pool = new ApiKeyPool({
        keys: ['key1', 'key2'],
        rotationStrategy: 'least-used',
      });
      expect(pool.getTotalKeyCount()).toBe(2);
    });
  });

  describe('key rotation', () => {
    let pool: ApiKeyPool;

    beforeEach(() => {
      pool = new ApiKeyPool({
        keys: ['key1', 'key2', 'key3'],
        rotationStrategy: 'round-robin',
      });
    });

    it('should rotate through keys in round-robin', () => {
      const keys = [pool.getNextKey(), pool.getNextKey(), pool.getNextKey()];
      expect(new Set(keys).size).toBe(3);
    });

    it('should return healthy keys when available', () => {
      pool.recordError('key1', 'RATE_LIMIT');
      const key = pool.getNextKey(true);
      expect(key).not.toBe('key1');
    });

    it('should prefer least-used keys', () => {
      const pool2 = new ApiKeyPool({
        keys: ['key1', 'key2'],
        rotationStrategy: 'least-used',
      });

      // Use key1 multiple times
      pool2.getNextKey();
      pool2.getNextKey();
      pool2.getNextKey();

      // Next should be key2 (less used)
      const key = pool2.getNextKey();
      expect(key).toBe('key2');
    });
  });

  describe('error tracking', () => {
    let pool: ApiKeyPool;

    beforeEach(() => {
      pool = new ApiKeyPool({
        keys: ['key1', 'key2'],
        enableHealthTracking: true,
      });
    });

    it('should track error count', () => {
      pool.recordError('key1', 'OTHER');
      const metrics = pool.getKeyMetrics('key1');
      expect(metrics?.errorCount).toBe(1);
    });

    it('should mark AUTH_ERROR keys as unhealthy', () => {
      pool.recordError('key1', 'AUTH_ERROR');
      const metrics = pool.getKeyMetrics('key1');
      expect(metrics?.isHealthy).toBe(false);
    });

    it('should mark RATE_LIMIT keys as unhealthy', () => {
      pool.recordError('key1', 'RATE_LIMIT');
      const metrics = pool.getKeyMetrics('key1');
      expect(metrics?.isHealthy).toBe(false);
    });

    it('should recover unhealthy keys after rate limit window', async () => {
      const resetTime = new Date(Date.now() + 200);
      pool.recordError('key1', 'RATE_LIMIT', resetTime);
      expect(pool.getKeyMetrics('key1')?.isHealthy).toBe(false);

      // Wait for recovery (resetTime + 1s buffer)
      await new Promise((resolve) => setTimeout(resolve, 1300));
      expect(pool.getKeyMetrics('key1')?.isHealthy).toBe(true);
    }, 3000);

    it('should count healthy keys correctly', () => {
      pool.recordError('key1', 'AUTH_ERROR');
      expect(pool.getHealthyKeyCount()).toBe(1);
    });

    it('should have healthy keys after recovery', () => {
      expect(pool.hasHealthyKeys()).toBe(true);
    });
  });

  describe('metrics and stats', () => {
    let pool: ApiKeyPool;

    beforeEach(() => {
      pool = new ApiKeyPool({
        keys: ['key1', 'key2', 'key3'],
      });
    });

    it('should track usage count', () => {
      pool.getNextKey();
      pool.getNextKey();
      const metrics = pool.getMetrics();
      const totalUsage = metrics.reduce((sum, m) => sum + m.usageCount, 0);
      expect(totalUsage).toBe(2);
    });

    it('should calculate statistics', () => {
      pool.getNextKey();
      pool.getNextKey();
      pool.recordError('key1', 'OTHER');

      const stats = pool.getStats();
      expect(stats.totalKeys).toBe(3);
      expect(stats.totalRequests).toBe(2);
      expect(stats.totalErrors).toBe(1);
    });

    it('should reset all metrics', () => {
      pool.getNextKey();
      pool.recordError('key1', 'OTHER');
      pool.resetMetrics();

      const stats = pool.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalErrors).toBe(0);
    });
  });

  describe('utilities', () => {
    it('should parse comma-separated keys', () => {
      const result = parseApiKeyPool('key1,key2,key3');
      expect(result.keys).toEqual(['key1', 'key2', 'key3']);
      expect(result.primaryKey).toBeUndefined();
    });

    it('should parse comma-separated keys with primary designation', () => {
      const result = parseApiKeyPool('key1:primary,key2,key3');
      expect(result.keys).toEqual(['key1', 'key2', 'key3']);
      expect(result.primaryKey).toBe('key1');
    });

    it('should trim whitespace from keys', () => {
      const result = parseApiKeyPool(' key1 , key2 , key3 ');
      expect(result.keys).toEqual(['key1', 'key2', 'key3']);
    });

    it('should handle empty string', () => {
      const result = parseApiKeyPool('');
      expect(result.keys).toEqual([]);
      expect(result.primaryKey).toBeUndefined();
    });

    it('should create pool from environment', () => {
      process.env.TEST_API_KEYS = 'key1,key2';
      const pool = createApiKeyPoolFromEnv('TEST_API_KEYS', 'TEST_PRIMARY_KEY', undefined);
      expect(pool?.getTotalKeyCount()).toBe(2);
      delete process.env.TEST_API_KEYS;
    });

    it('should use primary key from dedicated env var', () => {
      process.env.TEST_API_KEYS = 'key1,key2,key3';
      process.env.TEST_PRIMARY_KEY = 'key1';
      const pool = createApiKeyPoolFromEnv('TEST_API_KEYS', 'TEST_PRIMARY_KEY');
      expect(pool?.getPrimaryKey()).toBe('key1');
      delete process.env.TEST_API_KEYS;
      delete process.env.TEST_PRIMARY_KEY;
    });

    it('should include dedicated primary key when it is not listed in the pool', () => {
      process.env.TEST_API_KEYS = 'key2,key3';
      process.env.TEST_PRIMARY_KEY = 'key1';
      const pool = createApiKeyPoolFromEnv('TEST_API_KEYS', 'TEST_PRIMARY_KEY');

      expect(pool?.getPrimaryKey()).toBe('key1');
      expect(pool?.getTotalKeyCount()).toBe(3);

      delete process.env.TEST_API_KEYS;
      delete process.env.TEST_PRIMARY_KEY;
    });

    it('should distribute env pool keys by default for delegated parallel work', () => {
      process.env.TEST_API_KEYS = 'key1:primary,key2,key3';
      const pool = createApiKeyPoolFromEnv('TEST_API_KEYS', 'TEST_PRIMARY_KEY');

      expect(pool?.getNextKey()).toBe('key1');
      expect(pool?.getNextKey()).toBe('key2');
      expect(pool?.getNextKey()).toBe('key3');

      delete process.env.TEST_API_KEYS;
    });

    it('should allow primary-first env pool strategy when configured', () => {
      process.env.TEST_API_KEYS = 'key1:primary,key2,key3';
      process.env.GEMINI_KEY_ROTATION_STRATEGY = 'primary-first';
      const pool = createApiKeyPoolFromEnv('TEST_API_KEYS', 'TEST_PRIMARY_KEY');

      expect(pool?.getNextKey()).toBe('key1');
      expect(pool?.getNextKey()).toBe('key1');

      delete process.env.TEST_API_KEYS;
      delete process.env.GEMINI_KEY_ROTATION_STRATEGY;
    });

    it('should use fallback key when env not set', () => {
      const pool = createApiKeyPoolFromEnv('NONEXISTENT', undefined, 'fallback_key');
      expect(pool?.getTotalKeyCount()).toBe(1);
    });

    it('should return null when no keys available', () => {
      const pool = createApiKeyPoolFromEnv('NONEXISTENT');
      expect(pool).toBeNull();
    });
  });

  describe('error parsing', () => {
    it('should detect rate limit errors (429)', () => {
      const error = new Error('429 Too Many Requests');
      const parsed = parseGeminiError(error);
      expect(parsed.type).toBe('RATE_LIMIT');
    });

    it('should detect rate limit errors (RESOURCE_EXHAUSTED)', () => {
      const error = new Error('RESOURCE_EXHAUSTED: Rate limit exceeded');
      const parsed = parseGeminiError(error);
      expect(parsed.type).toBe('RATE_LIMIT');
    });

    it('should parse Gemini retryDelay seconds for rate limit recovery', () => {
      const error = new Error('{"error":{"code":429,"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"57s"}]}}');
      const parsed = parseGeminiError(error);

      expect(parsed.type).toBe('RATE_LIMIT');
      expect(parsed.resetTime).toBeInstanceOf(Date);
      expect(parsed.resetTime!.getTime()).toBeGreaterThan(Date.now());
    });

    it('should parse Gemini retry-in text for rate limit recovery', () => {
      const error = new Error('Please retry in 57.054516335s.');
      const parsed = parseGeminiError(error);

      expect(parsed.type).toBe('RATE_LIMIT');
      expect(parsed.resetTime).toBeInstanceOf(Date);
      expect(parsed.resetTime!.getTime()).toBeGreaterThan(Date.now());
    });

    it('should detect auth errors (401)', () => {
      const error = new Error('401 Unauthorized');
      const parsed = parseGeminiError(error);
      expect(parsed.type).toBe('AUTH_ERROR');
    });

    it('should detect auth errors (UNAUTHENTICATED)', () => {
      const error = new Error('UNAUTHENTICATED: Invalid API key');
      const parsed = parseGeminiError(error);
      expect(parsed.type).toBe('AUTH_ERROR');
    });

    it('should detect server errors (503)', () => {
      const error = new Error('503 Service Unavailable');
      const parsed = parseGeminiError(error);
      expect(parsed.type).toBe('SERVER_ERROR');
    });

    it('should classify unknown errors', () => {
      const error = new Error('Unknown error');
      const parsed = parseGeminiError(error);
      expect(parsed.type).toBe('OTHER');
    });

    it('should truncate error message', () => {
      const longError = new Error('x'.repeat(500));
      const parsed = parseGeminiError(longError);
      expect(parsed.message.length).toBeLessThanOrEqual(200);
    });
  });

  describe('primary/sub-agent hierarchy', () => {
    it('should identify primary key', () => {
      const pool = new ApiKeyPool({
        keys: ['key1', 'key2', 'key3'],
        primaryKey: 'key1',
      });
      expect(pool.getPrimaryKey()).toBe('key1');
    });

    it('should get sub-agent keys', () => {
      const pool = new ApiKeyPool({
        keys: ['key1', 'key2', 'key3'],
        primaryKey: 'key1',
      });
      const subAgents = pool.getSubAgentKeys();
      expect(subAgents).toEqual(['key2', 'key3']);
    });

    it('should check primary key health', () => {
      const pool = new ApiKeyPool({
        keys: ['key1', 'key2'],
        primaryKey: 'key1',
      });
      expect(pool.isPrimaryKeyHealthy()).toBe(true);

      pool.recordError('key1', 'AUTH_ERROR');
      expect(pool.isPrimaryKeyHealthy()).toBe(false);
    });

    it('should get primary key status', () => {
      const pool = new ApiKeyPool({
        keys: ['key1', 'key2'],
        primaryKey: 'key1',
      });
      const status = pool.getPrimaryKeyStatus();
      expect(status?.key).toBe('key1');
      expect(status?.healthy).toBe(true);

      pool.recordError('key1', 'RATE_LIMIT');
      const unhealthyStatus = pool.getPrimaryKeyStatus();
      expect(unhealthyStatus?.healthy).toBe(false);
    });

    it('should mark primary key metrics as primary', () => {
      const pool = new ApiKeyPool({
        keys: ['key1', 'key2'],
        primaryKey: 'key1',
      });
      const metrics = pool.getMetrics();
      const primaryMetrics = metrics.find(m => m.key === 'key1');
      expect(primaryMetrics?.isPrimary).toBe(true);
    });

    it('should prioritize primary key in primary-first mode', () => {
      const pool = new ApiKeyPool({
        keys: ['key1', 'key2', 'key3'],
        rotationStrategy: 'primary-first',
        primaryKey: 'key1',
      });

      // First three calls should use key1 (primary)
      const key1 = pool.getNextKey();
      const key2 = pool.getNextKey();
      const key3 = pool.getNextKey();

      expect(key1).toBe('key1');
      expect(key2).toBe('key1');
      expect(key3).toBe('key1');
    });

    it('should fallback to sub-agents when primary is unhealthy', () => {
      const pool = new ApiKeyPool({
        keys: ['key1', 'key2', 'key3'],
        rotationStrategy: 'primary-first',
        primaryKey: 'key1',
      });

      // Mark primary as unhealthy
      pool.recordError('key1', 'AUTH_ERROR');

      // Should use a sub-agent key
      const key = pool.getNextKey();
      expect(key).not.toBe('key1');
      expect(['key2', 'key3']).toContain(key);
    });
  });
});
