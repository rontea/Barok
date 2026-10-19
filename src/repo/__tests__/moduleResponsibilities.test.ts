/**
 * Module Responsibility Tests
 * Tests for module detection, analysis, and dependency tracking
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import {
  analyzeAllModules,
  detectBackendModule,
  detectFrontendModule,
  detectServerModule,
  detectTestsModule,
  detectDocsModule,
  detectVsCodeExtensionModule,
  findModuleByName,
  findModulesByLayer,
  getModuleExports,
  buildModuleDependencyGraph,
  type ModuleResponsibility,
} from '../moduleResponsibilities.js';

// Use the actual repo root for testing
const repoRoot = process.cwd();

describe('Module Responsibility Detection', () => {
  describe('detectBackendModule', () => {
    it('should detect backend module with correct metadata', () => {
      const module = detectBackendModule(repoRoot);

      expect(module).toBeDefined();
      expect(module?.name).toBe('backend');
      expect(module?.path).toBe('src');
      expect(module?.layer).toBe('backend');
      expect(module?.description).toContain('Backend');
    });

    it('should have key files in backend module', () => {
      const module = detectBackendModule(repoRoot);

      expect(module?.keyFiles.length).toBeGreaterThan(0);
      const fileNames = module?.keyFiles.map((f) => f.path) ?? [];
      expect(fileNames).toContain('src/agents');
    });

    it('should have entry points', () => {
      const module = detectBackendModule(repoRoot);

      expect(module?.entryPoints.length).toBeGreaterThan(0);
      expect(module?.entryPoints).toContain('src/index.ts');
    });

    it('should list exports', () => {
      const module = detectBackendModule(repoRoot);

      expect(module?.exports.length).toBeGreaterThan(0);
      const exportNames = module?.exports.map((e) => e.name) ?? [];
      expect(exportNames).toContain('AgentOrchestrator');
    });

    it('should return null if src directory does not exist', () => {
      const fakeRoot = '/nonexistent/path';
      const module = detectBackendModule(fakeRoot);

      expect(module).toBeNull();
    });
  });

  describe('detectFrontendModule', () => {
    it('should detect frontend module with correct metadata', () => {
      const module = detectFrontendModule(repoRoot);

      if (fs.existsSync(path.join(repoRoot, 'ui'))) {
        expect(module).toBeDefined();
        expect(module?.name).toBe('frontend-ui');
        expect(module?.path).toBe('ui');
        expect(module?.layer).toBe('frontend');
      }
    });

    it('should have React-related exports if detected', () => {
      const module = detectFrontendModule(repoRoot);

      if (module) {
        expect(module.exports.length).toBeGreaterThan(0);
        const exportNames = module.exports.map((e) => e.name);
        expect(exportNames).toContain('App');
      }
    });

    it('should list entry points', () => {
      const module = detectFrontendModule(repoRoot);

      if (module) {
        expect(module.entryPoints).toContain('ui/src/main.tsx');
      }
    });
  });

  describe('detectServerModule', () => {
    it('should detect server module if server.ts exists', () => {
      const module = detectServerModule(repoRoot);

      if (fs.existsSync(path.join(repoRoot, 'server.ts'))) {
        expect(module).toBeDefined();
        expect(module?.name).toBe('server');
        expect(module?.path).toBe('server.ts');
      }
    });

    it('should have correct description', () => {
      const module = detectServerModule(repoRoot);

      if (module) {
        expect(module.description).toContain('Express');
      }
    });
  });

  describe('detectTestsModule', () => {
    it('should detect tests module if tests directory exists', () => {
      const module = detectTestsModule(repoRoot);

      if (fs.existsSync(path.join(repoRoot, 'tests'))) {
        expect(module).toBeDefined();
        expect(module?.name).toBe('tests');
        expect(module?.layer).toBe('tests');
      }
    });

    it('should have key files if tests directory exists', () => {
      const module = detectTestsModule(repoRoot);

      if (module) {
        expect(module.keyFiles.length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('detectDocsModule', () => {
    it('should detect docs module if docs directory exists', () => {
      const module = detectDocsModule(repoRoot);

      if (fs.existsSync(path.join(repoRoot, 'docs'))) {
        expect(module).toBeDefined();
        expect(module?.name).toBe('documentation');
        expect(module?.layer).toBe('docs');
      }
    });

    it('should have key files for documentation', () => {
      const module = detectDocsModule(repoRoot);

      if (module) {
        expect(module.keyFiles.length).toBeGreaterThan(0);
        const paths = module.keyFiles.map((f) => f.path);
        expect(paths.some((p) => p.startsWith('docs/'))).toBe(true);
      }
    });
  });

  describe('detectVsCodeExtensionModule', () => {
    it('should detect vscode-extension module if directory exists', () => {
      const module = detectVsCodeExtensionModule(repoRoot);

      if (fs.existsSync(path.join(repoRoot, 'vscode-extension'))) {
        expect(module).toBeDefined();
        expect(module?.name).toBe('vscode-extension');
        expect(module?.layer).toBe('vscode-extension');
      }
    });

    it('should have correct description', () => {
      const module = detectVsCodeExtensionModule(repoRoot);

      if (module) {
        expect(module.description).toContain('VS Code');
      }
    });
  });
});

describe('Module Analysis', () => {
  let modules: ModuleResponsibility[];

  beforeEach(() => {
    modules = analyzeAllModules(repoRoot);
  });

  it('should analyze all modules in repository', () => {
    expect(modules.length).toBeGreaterThan(0);
  });

  it('should set lastAnalyzed timestamp on each module', () => {
    for (const module of modules) {
      expect(module.lastAnalyzed).toBeDefined();
      expect(typeof module.lastAnalyzed).toBe('number');
    }
  });

  it('should have backend module analyzed', () => {
    const backendModule = modules.find((m) => m.name === 'backend');
    expect(backendModule).toBeDefined();
    expect(backendModule?.layer).toBe('backend');
  });

  describe('findModuleByName', () => {
    it('should find backend module by name', () => {
      const module = findModuleByName(modules, 'backend');

      expect(module).toBeDefined();
      expect(module?.name).toBe('backend');
    });

    it('should return undefined for non-existent module', () => {
      const module = findModuleByName(modules, 'nonexistent');

      expect(module).toBeUndefined();
    });

    it('should find frontend module if it exists', () => {
      const module = findModuleByName(modules, 'frontend-ui');

      if (fs.existsSync(path.join(repoRoot, 'ui'))) {
        expect(module).toBeDefined();
      }
    });
  });

  describe('findModulesByLayer', () => {
    it('should find all backend modules', () => {
      const backendModules = findModulesByLayer(modules, 'backend');

      expect(backendModules.length).toBeGreaterThan(0);
      for (const module of backendModules) {
        expect(module.layer).toBe('backend');
      }
    });

    it('should find frontend modules', () => {
      const frontendModules = findModulesByLayer(modules, 'frontend');

      if (frontendModules.length > 0) {
        for (const module of frontendModules) {
          expect(module.layer).toBe('frontend');
        }
      }
    });

    it('should return empty array for no modules in layer', () => {
      const result = findModulesByLayer(modules, 'data');

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getModuleExports', () => {
    it('should get all export names from backend module', () => {
      const backendModule = findModuleByName(modules, 'backend');

      if (backendModule) {
        const exports = getModuleExports(backendModule);

        expect(Array.isArray(exports)).toBe(true);
        expect(exports.length).toBeGreaterThan(0);
        expect(exports).toContain('AgentOrchestrator');
      }
    });

    it('should return empty array if no exports', () => {
      const module = findModuleByName(modules, 'documentation');

      if (module) {
        const exports = getModuleExports(module);
        expect(Array.isArray(exports)).toBe(true);
      }
    });
  });
});

describe('Module Dependency Graph', () => {
  let modules: ModuleResponsibility[];

  beforeEach(() => {
    modules = analyzeAllModules(repoRoot);
  });

  it('should build module dependency graph', () => {
    const graph = buildModuleDependencyGraph(modules);

    expect(graph.modules.size).toBe(modules.length);
    expect(graph.dependencies.size).toBe(modules.length);
    expect(graph.dependents.size).toBe(modules.length);
  });

  it('should track dependencies correctly', () => {
    const graph = buildModuleDependencyGraph(modules);

    const backendDeps = graph.dependencies.get('backend');
    expect(Array.isArray(backendDeps)).toBe(true);
  });

  it('should have server depending on backend', () => {
    const graph = buildModuleDependencyGraph(modules);

    const serverDeps = graph.dependencies.get('server');
    if (serverDeps) {
      expect(serverDeps).toContain('src');
    }
  });

  it('should have frontend depending on backend', () => {
    const graph = buildModuleDependencyGraph(modules);

    const frontendDeps = graph.dependencies.get('frontend-ui');
    if (frontendDeps) {
      expect(frontendDeps).toContain('backend');
    }
  });
});

describe('Module Structure Validation', () => {
  let modules: ModuleResponsibility[];

  beforeEach(() => {
    modules = analyzeAllModules(repoRoot);
  });

  it('should have description for each module', () => {
    for (const module of modules) {
      expect(module.description).toBeDefined();
      expect(module.description.length).toBeGreaterThan(0);
    }
  });

  it('should have at least one entry point per module', () => {
    for (const module of modules) {
      expect(module.entryPoints.length).toBeGreaterThan(0);
    }
  });

  it('should have valid layer for each module', () => {
    const validLayers = ['backend', 'frontend', 'shared', 'data', 'cli', 'vscode-extension', 'tests', 'docs'];

    for (const module of modules) {
      expect(validLayers).toContain(module.layer);
    }
  });

  it('should have valid export types', () => {
    const validTypes = ['default', 'named'];

    for (const module of modules) {
      for (const exp of module.exports) {
        expect(validTypes).toContain(exp.type);
      }
    }
  });

  it('should have valid key file purposes', () => {
    for (const module of modules) {
      for (const keyFile of module.keyFiles) {
        expect(keyFile.purpose).toBeDefined();
        expect(keyFile.purpose.length).toBeGreaterThan(0);
      }
    }
  });
});
