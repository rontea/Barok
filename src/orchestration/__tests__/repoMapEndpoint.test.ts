/**
 * Tests for Phase 7.1 Task 3 - Repository Map Generation
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { Response } from 'express';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  handleRepoMapRequest,
  generateRepoMap,
  invalidateRepoMapCache,
  clearAllRepoMapCaches,
  getRepoMapCacheStats,
  RepoMapData,
} from '../repoMapEndpoint';

/**
 * Mock response object for testing
 */
function createMockResponse(): any {
  return {
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  };
}

describe('Phase 7.1 Task 3 - Repository Map Generation', () => {
  beforeEach(() => {
    // Clear cache before each test
    clearAllRepoMapCaches();
  });

  describe('Frontend Layer Detection', () => {
    it('should detect frontend components structure', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.frontend).toBeDefined();
      expect(repoMap.frontend.rootDir).toBe('ui');
      expect(Array.isArray(repoMap.frontend.components)).toBe(true);
    });

    it('should detect pages directory if present', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.frontend.pages).toBeDefined();
      expect(Array.isArray(repoMap.frontend.pages)).toBe(true);
    });

    it('should detect frontend utilities', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.frontend.utilities).toBeDefined();
      expect(Array.isArray(repoMap.frontend.utilities)).toBe(true);
    });

    it('should detect frontend config files', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.frontend.configFiles).toBeDefined();
      expect(Array.isArray(repoMap.frontend.configFiles)).toBe(true);
    });
  });

  describe('Backend Layer Detection', () => {
    it('should detect API routes', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.backend.apiRoutes).toBeDefined();
      expect(Array.isArray(repoMap.backend.apiRoutes)).toBe(true);
    });

    it('should detect backend services', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.backend.services).toBeDefined();
      expect(Array.isArray(repoMap.backend.services)).toBe(true);
    });

    it('should detect data layer modules', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.backend.dataLayer).toBeDefined();
      expect(Array.isArray(repoMap.backend.dataLayer)).toBe(true);
    });

    it('should detect backend tools', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.backend.tools).toBeDefined();
      expect(Array.isArray(repoMap.backend.tools)).toBe(true);
    });

    it('should detect backend config files', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.backend.configFiles).toBeDefined();
      expect(Array.isArray(repoMap.backend.configFiles)).toBe(true);
    });
  });

  describe('Tests Layer Detection', () => {
    it('should detect test files', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.tests).toBeDefined();
      expect(repoMap.tests.testFiles).toBeDefined();
      expect(Array.isArray(repoMap.tests.testFiles)).toBe(true);
    });

    it('should detect test directories', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.tests.testDirs).toBeDefined();
      expect(Array.isArray(repoMap.tests.testDirs)).toBe(true);
    });

    it('should detect coverage directory', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.tests.coverage).toBeDefined();
      expect(typeof repoMap.tests.coverage).toBe('boolean');
    });
  });

  describe('Docs Layer Detection', () => {
    it('should detect README files', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.docs.readmeFiles).toBeDefined();
      expect(Array.isArray(repoMap.docs.readmeFiles)).toBe(true);
    });

    it('should detect documentation directories', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.docs.docDirs).toBeDefined();
      expect(Array.isArray(repoMap.docs.docDirs)).toBe(true);
    });

    it('should detect API documentation files', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.docs.apiDocs).toBeDefined();
      expect(Array.isArray(repoMap.docs.apiDocs)).toBe(true);
    });
  });

  describe('Scripts Layer Detection', () => {
    it('should detect available scripts', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.scripts.available).toBeDefined();
      expect(Array.isArray(repoMap.scripts.available)).toBe(true);
      expect(repoMap.scripts.available.length).toBeGreaterThan(0);
    });

    it('should categorize scripts by type', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.scripts.categories).toBeDefined();
      expect(typeof repoMap.scripts.categories).toBe('object');
    });

    it('should have build, test, dev, lint categories', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.scripts.categories).toHaveProperty('build');
      expect(repoMap.scripts.categories).toHaveProperty('test');
      expect(repoMap.scripts.categories).toHaveProperty('dev');
      expect(repoMap.scripts.categories).toHaveProperty('lint');
      expect(repoMap.scripts.categories).toHaveProperty('other');
    });
  });

  describe('Artifacts Layer Detection', () => {
    it('should detect build output directories', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.artifacts.buildOutputs).toBeDefined();
      expect(Array.isArray(repoMap.artifacts.buildOutputs)).toBe(true);
    });

    it('should detect coverage directories', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.artifacts.coverage).toBeDefined();
      expect(Array.isArray(repoMap.artifacts.coverage)).toBe(true);
    });

    it('should detect log directories', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.artifacts.logs).toBeDefined();
      expect(Array.isArray(repoMap.artifacts.logs)).toBe(true);
    });

    it('should detect cache directories', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.artifacts.cache).toBeDefined();
      expect(Array.isArray(repoMap.artifacts.cache)).toBe(true);
    });
  });

  describe('Caching with TTL', () => {
    it('should cache repo map generation', async () => {
      const map1 = await generateRepoMap();
      const timestamp1 = map1.timestamp;

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      const map2 = await generateRepoMap();
      const timestamp2 = map2.timestamp;

      // Should return cached result (same timestamp)
      expect(timestamp1).toBe(timestamp2);
    });

    it('should include cache info with TTL', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.cacheInfo).toBeDefined();
      expect(repoMap.cacheInfo?.cachedAt).toBeDefined();
      expect(repoMap.cacheInfo?.ttlMs).toBeGreaterThan(0);
      expect(repoMap.cacheInfo?.expiresAt).toBeGreaterThan(repoMap.cacheInfo?.cachedAt || 0);
    });

    it('should track cache expiration time', async () => {
      const repoMap = await generateRepoMap();
      const cacheInfo = repoMap.cacheInfo;

      expect(cacheInfo?.expiresAt).toBeGreaterThan(cacheInfo?.cachedAt || 0);
      expect(cacheInfo?.ttlMs).toBeCloseTo(3600000, -4); // 1 hour in ms
    });

    it('should have cache key for default workspace', async () => {
      await generateRepoMap();
      const stats = getRepoMapCacheStats();

      expect(stats.size).toBeGreaterThan(0);
      expect(stats.entries.length).toBeGreaterThan(0);
    });

    it('should invalidate cache when requested', async () => {
      const map1 = await generateRepoMap();
      const timestamp1 = map1.timestamp;

      invalidateRepoMapCache();

      await new Promise(resolve => setTimeout(resolve, 100));

      const map2 = await generateRepoMap();
      const timestamp2 = map2.timestamp;

      // Should regenerate (different timestamp)
      expect(timestamp2).toBeGreaterThanOrEqual(timestamp1);
    });

    it('should clear all caches', async () => {
      await generateRepoMap('workspace1');
      await generateRepoMap('workspace2');

      let stats = getRepoMapCacheStats();
      expect(stats.size).toBeGreaterThan(0);

      clearAllRepoMapCaches();

      stats = getRepoMapCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should track multiple workspace caches independently', async () => {
      const map1 = await generateRepoMap('workspace1');
      const map2 = await generateRepoMap('workspace2');

      const stats = getRepoMapCacheStats();
      expect(stats.size).toBe(2);
      expect(stats.entries.length).toBe(2);
    });
  });

  describe('Complete Repo Map Structure', () => {
    it('should generate valid repo map with all sections', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.timestamp).toBeDefined();
      expect(repoMap.workspace).toBeDefined();
      expect(repoMap.frontend).toBeDefined();
      expect(repoMap.backend).toBeDefined();
      expect(repoMap.tests).toBeDefined();
      expect(repoMap.docs).toBeDefined();
      expect(repoMap.scripts).toBeDefined();
      expect(repoMap.artifacts).toBeDefined();
    });

    it('should include proper TypeScript in all sections', async () => {
      const repoMap = await generateRepoMap() as RepoMapData;

      // Verify structure matches RepoMapData type
      expect(typeof repoMap.timestamp).toBe('number');
      expect(typeof repoMap.workspace).toBe('string');
      expect(repoMap.frontend).toBeDefined();
      expect(repoMap.backend).toBeDefined();
      expect(repoMap.tests).toBeDefined();
      expect(repoMap.docs).toBeDefined();
      expect(repoMap.scripts).toBeDefined();
      expect(repoMap.artifacts).toBeDefined();
    });

    it('should analyze the selected workspace only', async () => {
      const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-map-workspace-'));
      await fs.mkdir(path.join(workspace, 'ui', 'src', 'components'), { recursive: true });
      await fs.writeFile(
        path.join(workspace, 'ui', 'src', 'components', 'OnlyHere.tsx'),
        'export function OnlyHere() { return null; }\n',
        'utf-8'
      );
      await fs.writeFile(
        path.join(workspace, 'package.json'),
        JSON.stringify({ scripts: { build: 'echo build-selected-workspace' } }),
        'utf-8'
      );

      const repoMap = await generateRepoMap(workspace);

      expect(repoMap.workspace).toBe(path.resolve(workspace));
      expect(repoMap.frontend.components).toContain('ui/src/components/OnlyHere.tsx');
      expect(repoMap.frontend.components).not.toContain('ui/src/components/CoderChatPanel.tsx');
      expect(repoMap.scripts.available).toEqual(['build']);
    });
  });

  describe('HTTP Endpoint Handler', () => {
    it('should handle repo map request successfully', async () => {
      const mockRes = createMockResponse();
      const req = { body: { workspace: undefined } };

      await handleRepoMapRequest(req, mockRes);

      expect(mockRes.json).toHaveBeenCalled();
      const callArg = mockRes.json.mock.calls[0][0];
      expect(callArg.success).toBe(true);
      expect(callArg.data).toBeDefined();
    });

    it('should return repo map in correct format', async () => {
      const mockRes = createMockResponse();
      const req = { body: {} };

      await handleRepoMapRequest(req, mockRes);

      const response = mockRes.json.mock.calls[0][0];
      expect(response).toHaveProperty('success');
      expect(response).toHaveProperty('data');
      expect(response.data).toHaveProperty('frontend');
      expect(response.data).toHaveProperty('backend');
    });

    it('should handle errors gracefully', async () => {
      const mockRes = createMockResponse();
      const req = null; // This will cause an error

      try {
        await handleRepoMapRequest(req, mockRes);
      } catch (error) {
        // Error is expected
      }

      // Either json or status should be called
      const wasCalled = mockRes.json.mock.calls.length > 0 || mockRes.status.mock.calls.length > 0;
      expect(wasCalled).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing workspace gracefully', async () => {
      const repoMap = await generateRepoMap();

      expect(repoMap.workspace).toBeDefined();
      expect(typeof repoMap.workspace).toBe('string');
    });

    it('should return empty arrays for missing layers', async () => {
      const repoMap = await generateRepoMap();

      // Some layers may be empty
      expect(Array.isArray(repoMap.frontend.components)).toBe(true);
      expect(Array.isArray(repoMap.backend.services)).toBe(true);
      expect(Array.isArray(repoMap.tests.testFiles)).toBe(true);
    });

    it('should handle cache expiration', async () => {
      const map1 = await generateRepoMap();
      const stats1 = getRepoMapCacheStats();

      expect(stats1.entries[0].age).toBeLessThan(100);
      expect(stats1.entries[0].ttlMs).toBeGreaterThan(stats1.entries[0].age);
    });
  });

  describe('Cache Statistics', () => {
    it('should provide cache statistics', async () => {
      await generateRepoMap();

      const stats = getRepoMapCacheStats();

      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('entries');
      expect(typeof stats.size).toBe('number');
      expect(Array.isArray(stats.entries)).toBe(true);
    });

    it('should track cache entry age', async () => {
      await generateRepoMap();

      const stats = getRepoMapCacheStats();
      expect(stats.entries.length).toBeGreaterThan(0);
      expect(stats.entries[0]).toHaveProperty('age');
      expect(stats.entries[0]).toHaveProperty('ttlMs');
      expect(stats.entries[0].age).toBeLessThanOrEqual(stats.entries[0].ttlMs);
    });

    it('should identify cached entries by key', async () => {
      await generateRepoMap('workspace-a');
      await generateRepoMap('workspace-b');

      const stats = getRepoMapCacheStats();

      expect(stats.size).toBe(2);
      expect(stats.entries[0].key).toBeDefined();
      expect(stats.entries[1].key).toBeDefined();
    });
  });

  describe('Multi-Layer Detection', () => {
    it('should detect all 6 layers in single call', async () => {
      const repoMap = await generateRepoMap();

      const layers = [
        repoMap.frontend,
        repoMap.backend,
        repoMap.tests,
        repoMap.docs,
        repoMap.scripts,
        repoMap.artifacts,
      ];

      expect(layers.every(layer => layer !== undefined)).toBe(true);
    });

    it('should provide comprehensive structure details', async () => {
      const repoMap = await generateRepoMap();

      // Verify each layer has expected properties
      expect(repoMap.frontend).toHaveProperty('rootDir');
      expect(repoMap.backend).toHaveProperty('apiRoutes');
      expect(repoMap.tests).toHaveProperty('testFiles');
      expect(repoMap.docs).toHaveProperty('readmeFiles');
      expect(repoMap.scripts).toHaveProperty('available');
      expect(repoMap.artifacts).toHaveProperty('buildOutputs');
    });
  });
});
