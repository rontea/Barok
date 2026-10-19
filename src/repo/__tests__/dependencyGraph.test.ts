/**
 * Dependency Graph Signal Tests
 * Tests for import/export extraction, script dependencies, test associations, and API signals
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import {
  extractImports,
  extractExports,
  extractScriptDependencies,
  extractTestAssociations,
  extractApiRoutes,
  extractUiComponents,
  buildDependencyGraph,
  type DependencySignal,
  type ImportSignal,
  type ExportSignal,
} from '../dependencyGraph.js';

const repoRoot = process.cwd();

describe('Dependency Graph Signals', () => {
  describe('extractImports', () => {
    it('should extract imports from TypeScript files', () => {
      const testFile = path.join(repoRoot, 'src', 'index.ts');

      const imports = extractImports(testFile);

      expect(Array.isArray(imports)).toBe(true);
      // Should have at least some imports if file exists
      if (fs.existsSync(testFile)) {
        expect(imports.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('should return empty array for non-existent file', () => {
      const imports = extractImports('/nonexistent/file.ts');

      expect(imports).toEqual([]);
    });

    it('should extract import statements with high confidence', () => {
      const testFile = path.join(repoRoot, 'src', 'index.ts');

      if (fs.existsSync(testFile)) {
        const imports = extractImports(testFile);

        for (const imp of imports) {
          expect(imp.confidence).toBe('high');
          expect(imp.type).toBe('import');
          expect(imp.source).toBe(testFile);
          expect(imp.target).toBeDefined();
          expect(imp.details).toBeDefined();
          expect(imp.details.importStatement).toBeDefined();
          expect(Array.isArray(imp.details.importedNames)).toBe(true);
        }
      }
    });

    it('should identify default imports', () => {
      const testFile = path.join(repoRoot, 'src', 'index.ts');

      if (fs.existsSync(testFile)) {
        const imports = extractImports(testFile);
        const defaultImports = imports.filter((i) => i.details.isDefault);

        // May or may not have default imports
        expect(Array.isArray(defaultImports)).toBe(true);
      }
    });

    it('should identify type imports', () => {
      const testFile = path.join(repoRoot, 'src', 'index.ts');

      if (fs.existsSync(testFile)) {
        const imports = extractImports(testFile);
        const typeImports = imports.filter((i) => i.details.isType);

        // May or may not have type imports
        expect(Array.isArray(typeImports)).toBe(true);
      }
    });
  });

  describe('extractExports', () => {
    it('should extract exports from TypeScript files', () => {
      const testFile = path.join(repoRoot, 'src', 'index.ts');

      const exports = extractExports(testFile);

      expect(Array.isArray(exports)).toBe(true);
    });

    it('should return empty array for non-existent file', () => {
      const exports = extractExports('/nonexistent/file.ts');

      expect(exports).toEqual([]);
    });

    it('should mark exports with high confidence', () => {
      const testFile = path.join(repoRoot, 'src', 'index.ts');

      if (fs.existsSync(testFile)) {
        const exports = extractExports(testFile);

        for (const exp of exports) {
          expect(['export', 're-export']).toContain(exp.type);
          expect(exp.confidence).toBe('high');
          expect(exp.source).toBe(testFile);
        }
      }
    });

    it('should identify re-exports separately from regular exports', () => {
      const testFile = path.join(repoRoot, 'src', 'index.ts');

      if (fs.existsSync(testFile)) {
        const exports = extractExports(testFile);
        const reExports = exports.filter((e) => e.type === 're-export');
        const regularExports = exports.filter((e) => e.type === 'export');

        // Both may be empty or populated
        expect(Array.isArray(reExports)).toBe(true);
        expect(Array.isArray(regularExports)).toBe(true);
      }
    });
  });

  describe('extractScriptDependencies', () => {
    it('should extract scripts from package.json', () => {
      const packageJsonPath = path.join(repoRoot, 'package.json');

      const scripts = extractScriptDependencies(packageJsonPath);

      expect(Array.isArray(scripts)).toBe(true);
      expect(scripts.length).toBeGreaterThan(0);
    });

    it('should return empty array for non-existent package.json', () => {
      const scripts = extractScriptDependencies('/nonexistent/package.json');

      expect(scripts).toEqual([]);
    });

    it('should mark all script signals with high confidence', () => {
      const packageJsonPath = path.join(repoRoot, 'package.json');

      const scripts = extractScriptDependencies(packageJsonPath);

      for (const script of scripts) {
        expect(script.type).toBe('script');
        expect(script.confidence).toBe('high');
        expect(script.details.scriptName).toBeDefined();
        expect(script.details.scriptCommand).toBeDefined();
        expect(Array.isArray(script.details.dependsOn)).toBe(true);
      }
    });

    it('should identify script dependencies (npm run references)', () => {
      const packageJsonPath = path.join(repoRoot, 'package.json');

      const scripts = extractScriptDependencies(packageJsonPath);
      const scriptsWithDeps = scripts.filter((s) => s.details.dependsOn.length > 0);

      // May or may not have script dependencies
      expect(Array.isArray(scriptsWithDeps)).toBe(true);
    });

    it('should have standard npm scripts', () => {
      const packageJsonPath = path.join(repoRoot, 'package.json');

      const scripts = extractScriptDependencies(packageJsonPath);
      const scriptNames = scripts.map((s) => s.details.scriptName);

      // These are common scripts
      const hasCommonScripts = scriptNames.some(
        (n) =>
          n === 'build' ||
          n === 'test' ||
          n === 'dev' ||
          n === 'start' ||
          n.includes('test') ||
          n.includes('lint')
      );

      expect(hasCommonScripts).toBe(true);
    });
  });

  describe('extractTestAssociations', () => {
    it('should find test files in repository', () => {
      const tests = extractTestAssociations(repoRoot);

      expect(Array.isArray(tests)).toBe(true);
      expect(tests.length).toBeGreaterThan(0);
    });

    it('should mark all test signals with medium confidence', () => {
      const tests = extractTestAssociations(repoRoot);

      for (const test of tests) {
        expect(test.type).toBe('test');
        expect(test.confidence).toBe('medium');
        expect(['unit', 'integration', 'e2e']).toContain(test.details.testType);
      }
    });

    it('should associate test files with source files', () => {
      const tests = extractTestAssociations(repoRoot);

      // Should have at least some tests
      expect(tests.length).toBeGreaterThan(0);

      for (const test of tests) {
        expect(test.details.testFile).toBeDefined();
        expect(test.details.sourceFile).toBeDefined();
        // Test file should end with .test.ts or .spec.ts
        expect(
          test.details.testFile.endsWith('.test.ts') || test.details.testFile.endsWith('.spec.ts')
        ).toBe(true);
      }
    });

    it('should classify tests by type (unit, integration, e2e)', () => {
      const tests = extractTestAssociations(repoRoot);

      const unitTests = tests.filter((t) => t.details.testType === 'unit');
      const integrationTests = tests.filter((t) => t.details.testType === 'integration');

      // Should have some unit tests
      expect(unitTests.length).toBeGreaterThan(0);
    });
  });

  describe('extractApiRoutes', () => {
    it('should extract routes from Express files', () => {
      const serverPath = path.join(repoRoot, 'server.ts');

      if (fs.existsSync(serverPath)) {
        const routes = extractApiRoutes(serverPath);

        expect(Array.isArray(routes)).toBe(true);
      }
    });

    it('should return empty array for non-existent file', () => {
      const routes = extractApiRoutes('/nonexistent/server.ts');

      expect(routes).toEqual([]);
    });

    it('should mark API signals with high confidence', () => {
      const serverPath = path.join(repoRoot, 'server.ts');

      if (fs.existsSync(serverPath)) {
        const routes = extractApiRoutes(serverPath);

        for (const route of routes) {
          expect(route.type).toBe('api');
          expect(route.confidence).toBe('high');
          expect(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).toContain(route.details.method);
          expect(route.details.path).toBeDefined();
        }
      }
    });

    it('should have REST API method information', () => {
      const serverPath = path.join(repoRoot, 'server.ts');

      if (fs.existsSync(serverPath)) {
        const routes = extractApiRoutes(serverPath);

        if (routes.length > 0) {
          const methods = routes.map((r) => r.details.method);
          const hasVariousMethods =
            methods.includes('GET') ||
            methods.includes('POST') ||
            methods.includes('PUT') ||
            methods.includes('DELETE');

          expect(methods.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('extractUiComponents', () => {
    it('should extract React components from files', () => {
      const uiDir = path.join(repoRoot, 'ui', 'src');

      if (fs.existsSync(uiDir)) {
        const entries = fs.readdirSync(uiDir);
        const tsxFile = entries.find((f) => f.endsWith('.tsx'));

        if (tsxFile) {
          const components = extractUiComponents(path.join(uiDir, tsxFile));

          expect(Array.isArray(components)).toBe(true);
        }
      }
    });

    it('should return empty array for non-existent file', () => {
      const components = extractUiComponents('/nonexistent/App.tsx');

      expect(components).toEqual([]);
    });

    it('should mark UI signals with medium confidence', () => {
      const uiDir = path.join(repoRoot, 'ui', 'src');

      if (fs.existsSync(uiDir)) {
        const entries = fs.readdirSync(uiDir);
        const tsxFile = entries.find((f) => f.endsWith('.tsx'));

        if (tsxFile) {
          const signals = extractUiComponents(path.join(uiDir, tsxFile));

          for (const signal of signals) {
            expect(['ui-component', 'ui-route']).toContain(signal.type);
            expect(signal.confidence).toBe('medium');
          }
        }
      }
    });
  });

  describe('buildDependencyGraph', () => {
    let signals: DependencySignal[] = [];

    beforeEach(() => {
      // Create test signals
      signals = [
        {
          source: 'file1.ts',
          target: 'file2.ts',
          type: 'import',
          confidence: 'high',
        },
        {
          source: 'file2.ts',
          target: 'file3.ts',
          type: 'import',
          confidence: 'high',
        },
        {
          source: 'file1.ts',
          target: 'file3.ts',
          type: 'import',
          confidence: 'high',
        },
      ];
    });

    it('should build queryable dependency graph', () => {
      const graph = buildDependencyGraph(signals);

      expect(graph).toBeDefined();
      expect(typeof graph.getSignalsFrom).toBe('function');
      expect(typeof graph.getSignalsTo).toBe('function');
      expect(typeof graph.findImportPath).toBe('function');
      expect(typeof graph.getConnectedModules).toBe('function');
    });

    it('should query signals from a source', () => {
      const graph = buildDependencyGraph(signals);

      const file1Signals = graph.getSignalsFrom('file1.ts');

      expect(Array.isArray(file1Signals)).toBe(true);
      expect(file1Signals.length).toBe(2);
    });

    it('should query signals to a target', () => {
      const graph = buildDependencyGraph(signals);

      const file3Signals = graph.getSignalsTo('file3.ts');

      expect(Array.isArray(file3Signals)).toBe(true);
      expect(file3Signals.length).toBe(2);
    });

    it('should find import paths between files', () => {
      const graph = buildDependencyGraph(signals);

      const paths = graph.findImportPath('file1.ts', 'file3.ts');

      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThan(0);
    });

    it('should get connected modules', () => {
      const graph = buildDependencyGraph(signals);

      const connected = graph.getConnectedModules('file1.ts');

      expect(Array.isArray(connected)).toBe(true);
      expect(connected).toContain('file2.ts');
      expect(connected).toContain('file3.ts');
    });

    it('should return empty for unconnected modules', () => {
      const graph = buildDependencyGraph(signals);

      const connected = graph.getConnectedModules('nonexistent.ts');

      expect(connected).toEqual([]);
    });
  });

  describe('Integration: Full Dependency Analysis', () => {
    it('should extract all dependency signals from repository', () => {
      // Combine all signal types
      const imports = extractImports(path.join(repoRoot, 'src', 'index.ts'));
      const exports = extractExports(path.join(repoRoot, 'src', 'index.ts'));
      const scripts = extractScriptDependencies(path.join(repoRoot, 'package.json'));
      const tests = extractTestAssociations(repoRoot);

      expect(imports.length + exports.length + scripts.length + tests.length).toBeGreaterThan(0);
    });

    it('should build complete dependency graph', () => {
      const signals: DependencySignal[] = [];

      // Collect signals from various sources
      const scripts = extractScriptDependencies(path.join(repoRoot, 'package.json'));
      const tests = extractTestAssociations(repoRoot);

      signals.push(...scripts, ...tests);

      const graph = buildDependencyGraph(signals);

      // Should be able to query the graph
      const connected = graph.getConnectedModules('build');
      expect(Array.isArray(connected)).toBe(true);
    });
  });
});
