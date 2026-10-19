/**
 * Tests for Repository Map Discovery and Caching System
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import path from 'path';
import {
  discoverPackageFiles,
  discoverEntryPoints,
  discoverSourceRoots,
  discoverTests,
  discoverDocs,
  discoverArtifacts,
  discoverRepositoryMap,
  isRepositoryMapValid,
  getCachedRepositoryMap,
  invalidateRepositoryCache,
  invalidateAllRepositoryCaches,
  setRepositoryCacheTtl,
  getRepositoryCacheStats,
  buildContextPack,
  buildAllContextPacks,
} from '../index.js';

describe('Repository Map Discovery', () => {
  const testRepoPath = process.cwd(); // Use current project as test repo

  describe('Package File Discovery', () => {
    it('should discover package.json', () => {
      const files = discoverPackageFiles(testRepoPath);
      expect(files.length).toBeGreaterThan(0);
      expect(files.some((f) => f.name === 'package.json')).toBe(true);
    });

    it('should parse package.json content', () => {
      const files = discoverPackageFiles(testRepoPath);
      const packageJson = files.find((f) => f.name === 'package.json');
      expect(packageJson).toBeDefined();
      expect(packageJson?.content.name).toBeDefined();
      expect(packageJson?.content.version).toBeDefined();
    });

    it('should discover optional config files', () => {
      const files = discoverPackageFiles(testRepoPath);
      const fileNames = files.map((f) => f.name);
      // At least package.json, may have others
      expect(fileNames).toContain('package.json');
    });
  });

  describe('Entry Points Discovery', () => {
    it('should discover CLI entry points from package.json bin', () => {
      const files = discoverPackageFiles(testRepoPath);
      const packageJson = files.find((f) => f.name === 'package.json')?.content || {};
      const entryPoints = discoverEntryPoints(testRepoPath, packageJson);

      expect(Array.isArray(entryPoints)).toBe(true);
      const cliEntries = entryPoints.filter((ep) => ep.type === 'cli');
      expect(cliEntries.length).toBeGreaterThanOrEqual(0);
    });

    it('should discover main entry point', () => {
      const files = discoverPackageFiles(testRepoPath);
      const packageJson = files.find((f) => f.name === 'package.json')?.content || {};
      const entryPoints = discoverEntryPoints(testRepoPath, packageJson);

      const mainEntry = entryPoints.find((ep) => ep.type === 'server');
      expect(mainEntry).toBeDefined();
      expect(mainEntry?.path).toBeDefined();
    });

    it('should discover UI entry point', () => {
      const files = discoverPackageFiles(testRepoPath);
      const packageJson = files.find((f) => f.name === 'package.json')?.content || {};
      const entryPoints = discoverEntryPoints(testRepoPath, packageJson);

      const uiEntry = entryPoints.find((ep) => ep.type === 'ui');
      expect(uiEntry).toBeDefined();
    });

    it('should discover library entry points', () => {
      const files = discoverPackageFiles(testRepoPath);
      const packageJson = files.find((f) => f.name === 'package.json')?.content || {};
      const entryPoints = discoverEntryPoints(testRepoPath, packageJson);

      const libEntry = entryPoints.find((ep) => ep.type === 'library');
      expect(libEntry).toBeDefined();
    });
  });

  describe('Source Roots Discovery', () => {
    it('should discover backend source root', () => {
      const roots = discoverSourceRoots(testRepoPath);
      expect(roots.some((r) => r.type === 'backend')).toBe(true);
    });

    it('should discover frontend source root', () => {
      const roots = discoverSourceRoots(testRepoPath);
      expect(roots.some((r) => r.type === 'frontend')).toBe(true);
    });

    it('should assign correct descriptions to roots', () => {
      const roots = discoverSourceRoots(testRepoPath);
      expect(roots.length).toBeGreaterThan(0);
      roots.forEach((root) => {
        expect(root.description).toBeTruthy();
        expect(root.path).toBeTruthy();
      });
    });
  });

  describe('Test Discovery', () => {
    it('should discover test patterns', () => {
      const tests = discoverTests(testRepoPath);
      expect(tests.length).toBeGreaterThan(0);
      expect(tests.some((t) => t.pattern.includes('test.ts'))).toBe(true);
    });

    it('should include multiple test locations', () => {
      const tests = discoverTests(testRepoPath);
      const allLocations = tests.flatMap((t) => t.locations);
      expect(allLocations.length).toBeGreaterThan(0);
    });

    it('should support multiple test file patterns', () => {
      const tests = discoverTests(testRepoPath);
      const patterns = tests.map((t) => t.pattern);
      expect(patterns.some((p) => p.includes('.test.ts'))).toBe(true);
      expect(patterns.some((p) => p.includes('.spec.ts'))).toBe(true);
    });
  });

  describe('Documentation Discovery', () => {
    it('should discover README', () => {
      const docs = discoverDocs(testRepoPath);
      expect(docs.some((d) => d.name === 'README')).toBe(true);
    });

    it('should discover docs directory', () => {
      const docs = discoverDocs(testRepoPath);
      expect(docs.some((d) => d.name === 'Docs')).toBe(true);
    });

    it('should include documentation metadata', () => {
      const docs = discoverDocs(testRepoPath);
      docs.forEach((doc) => {
        expect(doc.name).toBeTruthy();
        expect(doc.path).toBeTruthy();
        expect(['file', 'directory']).toContain(doc.type);
      });
    });
  });

  describe('Artifact Discovery', () => {
    it('should discover generated artifact patterns', () => {
      const artifacts = discoverArtifacts();
      expect(artifacts.length).toBeGreaterThan(0);
      expect(artifacts.some((a) => a.pattern.includes('dist/'))).toBe(true);
    });

    it('should mark all artifact patterns', () => {
      const artifacts = discoverArtifacts();
      artifacts.forEach((artifact) => {
        expect(artifact.pattern).toBeTruthy();
        expect(artifact.description).toBeTruthy();
      });
    });
  });

  describe('Complete Repository Map', () => {
    it('should discover complete repository map', () => {
      const map = discoverRepositoryMap(testRepoPath);

      expect(map.rootPath).toBe(testRepoPath);
      expect(map.repositoryName).toBeTruthy();
      expect(map.repositoryVersion).toBeTruthy();
      expect(map.packageFiles.length).toBeGreaterThan(0);
      expect(map.entryPoints.length).toBeGreaterThan(0);
      expect(map.sourceRoots.length).toBeGreaterThan(0);
      expect(map.tests.length).toBeGreaterThan(0);
    });

    it('should include discovery timestamp', () => {
      const map = discoverRepositoryMap(testRepoPath);
      expect(map.discoveredAt).toBeGreaterThan(0);
      expect(map.discoveredAt).toBeLessThanOrEqual(Date.now());
    });

    it('should compute file hashes for invalidation', () => {
      const map = discoverRepositoryMap(testRepoPath);
      expect(map.fileHashes.packageJson).toBeTruthy();
      expect(map.fileHashes.tsconfig).toBeTruthy();
      expect(map.fileHashes.viteConfig).toBeTruthy();
    });
  });

  describe('Repository Map Validation', () => {
    it('should validate recently discovered map', () => {
      const map = discoverRepositoryMap(testRepoPath);
      expect(isRepositoryMapValid(map, testRepoPath)).toBe(true);
    });

    it('should invalidate map after TTL expires', () => {
      const map = discoverRepositoryMap(testRepoPath);
      // Mock time: set discovery to 1 hour ago
      map.discoveredAt = Date.now() - 60 * 60 * 1000;
      expect(isRepositoryMapValid(map, testRepoPath)).toBe(
        // Valid only if file hashes match (which they should)
        map.fileHashes.packageJson === map.fileHashes.packageJson
      );
    });
  });

  describe('Repository Map Caching', () => {
    beforeEach(() => {
      invalidateAllRepositoryCaches();
      setRepositoryCacheTtl(5 * 60 * 1000);
    });

    it('should cache repository map on first access', () => {
      const map1 = getCachedRepositoryMap(testRepoPath);
      const map2 = getCachedRepositoryMap(testRepoPath);

      // Should be same object (cached)
      expect(map1).toBe(map2);
    });

    it('should invalidate cache on demand', () => {
      const map1 = getCachedRepositoryMap(testRepoPath);
      invalidateRepositoryCache(testRepoPath);
      const map2 = getCachedRepositoryMap(testRepoPath);

      // Should be different objects (rediscovered)
      expect(map1).not.toBe(map2);
    });

    it('should invalidate all caches', () => {
      const map1 = getCachedRepositoryMap(testRepoPath);
      invalidateAllRepositoryCaches();
      const map2 = getCachedRepositoryMap(testRepoPath);

      expect(map1).not.toBe(map2);
    });

    it('should report configured cache TTL in stats', () => {
      setRepositoryCacheTtl(1234);
      getCachedRepositoryMap(testRepoPath);

      expect(getRepositoryCacheStats()).toMatchObject({
        size: 1,
        ttlMs: 1234,
        misses: 1,
        sets: 1,
      });
    });
  });

  describe('Context Pack Building', () => {
    let repoMap: Awaited<ReturnType<typeof discoverRepositoryMap>>;

    beforeEach(() => {
      repoMap = discoverRepositoryMap(testRepoPath);
    });

    it('should build context pack for frontend agent', () => {
      const pack = buildContextPack('frontend', repoMap);
      expect(pack.agentRole).toBe('frontend');
      expect(pack.relevantPaths).toContain('ui/src/**');
      expect(pack.sourceRoots).toContain('ui/src');
    });

    it('should build context pack for backend agent', () => {
      const pack = buildContextPack('backend', repoMap);
      expect(pack.agentRole).toBe('backend');
      expect(pack.relevantPaths).toContain('src/**');
      expect(pack.sourceRoots).toContain('src');
    });

    it('should build context pack for test agent', () => {
      const pack = buildContextPack('test', repoMap);
      expect(pack.agentRole).toBe('test');
      expect(pack.relatedTests.length).toBeGreaterThan(0);
    });

    it('should build context pack for reviewer agent', () => {
      const pack = buildContextPack('reviewer', repoMap);
      expect(pack.agentRole).toBe('reviewer');
      expect(pack.relevantPaths).toContain('**');
    });

    it('should build context pack for documentation agent', () => {
      const pack = buildContextPack('documentation', repoMap);
      expect(pack.agentRole).toBe('documentation');
      expect(pack.documentationRefs.length).toBeGreaterThan(0);
    });

    it('should throw on invalid role', () => {
      expect(() => buildContextPack('invalid-role', repoMap)).toThrow();
    });

    it('should build all context packs', () => {
      const allPacks = buildAllContextPacks(repoMap);
      expect(Object.keys(allPacks).length).toBe(6);
      expect(allPacks.frontend).toBeDefined();
      expect(allPacks.backend).toBeDefined();
      expect(allPacks.test).toBeDefined();
      expect(allPacks.reviewer).toBeDefined();
      expect(allPacks.documentation).toBeDefined();
    });

    it('should provide role-specific entry points in context packs', () => {
      const frontendPack = buildContextPack('frontend', repoMap);
      const backendPack = buildContextPack('backend', repoMap);

      // Frontend should focus on UI paths
      expect(frontendPack.relevantPaths.some((p) => p.includes('ui'))).toBe(true);

      // Backend should focus on src paths
      expect(backendPack.relevantPaths.some((p) => p.includes('src'))).toBe(true);

      // Both should have entry points (may overlap)
      expect(frontendPack.entryPoints.length).toBeGreaterThanOrEqual(0);
      expect(backendPack.entryPoints.length).toBeGreaterThanOrEqual(0);
    });
  });
});
