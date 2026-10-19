/**
 * Module Responsibility Tracking
 * Identifies and documents the purpose, structure, and key exports of each module
 */

import fs from 'fs';
import path from 'path';

/**
 * Layer classification for modules
 */
export type ModuleLayer =
  | 'backend'
  | 'frontend'
  | 'shared'
  | 'data'
  | 'cli'
  | 'vscode-extension'
  | 'tests'
  | 'docs';

/**
 * Export information from a module
 */
export interface ExportInfo {
  name: string; // Export name
  type: 'default' | 'named'; // Type of export
  from?: string; // Re-export from file
  isType?: boolean; // True if it's a type export
}

/**
 * Key file in a module
 */
export interface KeyFile {
  path: string; // Relative to repo root
  purpose: string; // What this file does
  layer?: ModuleLayer;
}

/**
 * Module responsibility definition
 */
export interface ModuleResponsibility {
  name: string; // Module name (e.g., 'backend', 'frontend-ui', 'server')
  path: string; // Relative path to module root
  layer: ModuleLayer; // What layer this module is in
  description: string; // What this module does
  exports: ExportInfo[]; // Public API of this module
  keyFiles: KeyFile[]; // Important files in this module
  entryPoints: string[]; // Entry files (index.ts, main.ts, etc.)
  dependencies: string[]; // Other modules this depends on
  dependents: string[]; // Modules that depend on this
  lastAnalyzed?: number; // Timestamp of last analysis
}

/**
 * Detects module responsibility for the backend layer (src/)
 */
export function detectBackendModule(repoRoot: string): ModuleResponsibility | null {
  const srcPath = path.join(repoRoot, 'src');

  if (!fs.existsSync(srcPath)) {
    return null;
  }

  const keyFiles: KeyFile[] = [];

  // Identify key files in src/
  const srcEntries = fs.readdirSync(srcPath);
  for (const entry of srcEntries) {
    const fullPath = path.join(srcPath, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (entry === 'agents') {
        keyFiles.push({
          path: 'src/agents',
          purpose: 'Multi-agent orchestration system',
          layer: 'backend',
        });
      } else if (entry === 'di') {
        keyFiles.push({
          path: 'src/di',
          purpose: 'Dependency injection container and providers',
          layer: 'backend',
        });
      } else if (entry === 'repo') {
        keyFiles.push({
          path: 'src/repo',
          purpose: 'Repository discovery and analysis',
          layer: 'backend',
        });
      } else if (entry === 'tasks') {
        keyFiles.push({
          path: 'src/tasks',
          purpose: 'Task specification and classification',
          layer: 'backend',
        });
      } else if (entry === 'orchestration') {
        keyFiles.push({
          path: 'src/orchestration',
          purpose: 'Multi-agent orchestration and coordination',
          layer: 'backend',
        });
      }
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      if (entry === 'server.ts') {
        keyFiles.push({
          path: 'src/server.ts',
          purpose: 'Express HTTP server and API routes',
          layer: 'backend',
        });
      } else if (entry === 'index.ts') {
        keyFiles.push({
          path: 'src/index.ts',
          purpose: 'Backend entry point and exports',
          layer: 'backend',
        });
      }
    }
  }

  return {
    name: 'backend',
    path: 'src',
    layer: 'backend',
    description:
      'Backend business logic, API routes, agents, task orchestration, and data layer',
    exports: [
      { name: 'default', type: 'default', from: 'src/index.ts' },
      { name: 'AgentOrchestrator', type: 'named', from: 'src/orchestration' },
      { name: 'FullStackTaskSpec', type: 'named', from: 'src/tasks' },
      { name: 'RepositoryMap', type: 'named', from: 'src/repo' },
    ],
    keyFiles,
    entryPoints: ['src/index.ts', 'src/server.ts'],
    dependencies: [],
    dependents: ['server.ts', 'cli'],
  };
}

/**
 * Detects module responsibility for the frontend layer (ui/)
 */
export function detectFrontendModule(repoRoot: string): ModuleResponsibility | null {
  const uiPath = path.join(repoRoot, 'ui');

  if (!fs.existsSync(uiPath)) {
    return null;
  }

  const keyFiles: KeyFile[] = [];

  const uiEntries = fs.readdirSync(uiPath);
  for (const entry of uiEntries) {
    const fullPath = path.join(uiPath, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (entry === 'src') {
        keyFiles.push({
          path: 'ui/src',
          purpose: 'React components and UI logic',
          layer: 'frontend',
        });
      }
    } else if (entry.endsWith('.config.ts') || entry === 'index.html') {
      keyFiles.push({
        path: `ui/${entry}`,
        purpose: entry === 'index.html' ? 'HTML entry point' : 'Vite configuration',
        layer: 'frontend',
      });
    }
  }

  return {
    name: 'frontend-ui',
    path: 'ui',
    layer: 'frontend',
    description: 'React UI components, pages, and frontend application',
    exports: [
      { name: 'App', type: 'named', from: 'ui/src/App.tsx' },
      { name: 'default', type: 'default', from: 'ui/src/main.tsx' },
    ],
    keyFiles,
    entryPoints: ['ui/src/main.tsx', 'ui/index.html'],
    dependencies: ['backend'],
    dependents: [],
  };
}

/**
 * Detects module responsibility for the server entry point
 */
export function detectServerModule(repoRoot: string): ModuleResponsibility | null {
  const serverPath = path.join(repoRoot, 'server.ts');

  if (!fs.existsSync(serverPath)) {
    return null;
  }

  return {
    name: 'server',
    path: 'server.ts',
    layer: 'backend',
    description: 'Express HTTP server, middleware, and API route setup',
    exports: [
      { name: 'createServer', type: 'named', from: 'server.ts' },
      { name: 'startServer', type: 'named', from: 'server.ts' },
    ],
    keyFiles: [
      {
        path: 'server.ts',
        purpose: 'Main server entry and route registration',
        layer: 'backend',
      },
    ],
    entryPoints: ['server.ts'],
    dependencies: ['src'],
    dependents: [],
  };
}

/**
 * Detects module responsibility for the test layer
 */
export function detectTestsModule(repoRoot: string): ModuleResponsibility | null {
  const testsPath = path.join(repoRoot, 'tests');

  if (!fs.existsSync(testsPath)) {
    return null;
  }

  const keyFiles: KeyFile[] = [];

  const testEntries = fs.readdirSync(testsPath);
  for (const entry of testEntries) {
    const fullPath = path.join(testsPath, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory() || entry.endsWith('.ts')) {
      keyFiles.push({
        path: `tests/${entry}`,
        purpose: `Test utilities and integration tests`,
        layer: 'tests',
      });
    }
  }

  return {
    name: 'tests',
    path: 'tests',
    layer: 'tests',
    description: 'Test utilities, helpers, fixtures, and integration test suites',
    exports: [
      { name: 'default', type: 'default', from: 'tests/index.ts', isType: false },
    ],
    keyFiles,
    entryPoints: ['tests/index.ts'],
    dependencies: ['src', 'ui'],
    dependents: [],
  };
}

/**
 * Detects module responsibility for the documentation layer
 */
export function detectDocsModule(repoRoot: string): ModuleResponsibility | null {
  const docsPath = path.join(repoRoot, 'docs');

  if (!fs.existsSync(docsPath)) {
    return null;
  }

  const keyFiles: KeyFile[] = [];

  // Add key doc files
  const readmePath = path.join(docsPath, 'README.md');
  if (fs.existsSync(readmePath)) {
    keyFiles.push({
      path: 'docs/README.md',
      purpose: 'Documentation index and overview',
      layer: 'docs',
    });
  }

  const docEntries = fs.readdirSync(docsPath);
  for (const entry of docEntries) {
    if (entry.startsWith('.')) continue;

    const fullPath = path.join(docsPath, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      keyFiles.push({
        path: `docs/${entry}`,
        purpose: `${entry} documentation`,
        layer: 'docs',
      });
    }
  }

  return {
    name: 'documentation',
    path: 'docs',
    layer: 'docs',
    description: 'Project documentation, API docs, architecture, and user guides',
    exports: [],
    keyFiles,
    entryPoints: ['docs/README.md'],
    dependencies: [],
    dependents: [],
  };
}

/**
 * Detects module responsibility for the VS Code extension
 */
export function detectVsCodeExtensionModule(repoRoot: string): ModuleResponsibility | null {
  const extPath = path.join(repoRoot, 'vscode-extension');

  if (!fs.existsSync(extPath)) {
    return null;
  }

  const keyFiles: KeyFile[] = [];

  const pkgPath = path.join(extPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    keyFiles.push({
      path: 'vscode-extension/package.json',
      purpose: 'Extension manifest and metadata',
      layer: 'vscode-extension',
    });
  }

  const extEntries = fs.readdirSync(extPath);
  for (const entry of extEntries) {
    if (entry === 'src') {
      keyFiles.push({
        path: 'vscode-extension/src',
        purpose: 'Extension source code',
        layer: 'vscode-extension',
      });
    }
  }

  return {
    name: 'vscode-extension',
    path: 'vscode-extension',
    layer: 'vscode-extension',
    description: 'VS Code extension for React Engine integration',
    exports: [
      { name: 'activate', type: 'named', from: 'vscode-extension/src/extension.ts' },
    ],
    keyFiles,
    entryPoints: ['vscode-extension/src/extension.ts'],
    dependencies: ['src'],
    dependents: [],
  };
}

/**
 * Analyzes all modules in the repository
 */
export function analyzeAllModules(repoRoot: string): ModuleResponsibility[] {
  const modules: ModuleResponsibility[] = [];

  // Detect modules in priority order
  const detectors = [
    detectBackendModule,
    detectFrontendModule,
    detectServerModule,
    detectTestsModule,
    detectDocsModule,
    detectVsCodeExtensionModule,
  ];

  for (const detector of detectors) {
    const module = detector(repoRoot);
    if (module) {
      module.lastAnalyzed = Date.now();
      modules.push(module);
    }
  }

  return modules;
}

/**
 * Finds a module by name
 */
export function findModuleByName(
  modules: ModuleResponsibility[],
  name: string
): ModuleResponsibility | undefined {
  return modules.find((m) => m.name === name);
}

/**
 * Finds modules by layer
 */
export function findModulesByLayer(
  modules: ModuleResponsibility[],
  layer: ModuleLayer
): ModuleResponsibility[] {
  return modules.filter((m) => m.layer === layer);
}

/**
 * Gets all exports from a module
 */
export function getModuleExports(module: ModuleResponsibility): string[] {
  return module.exports.map((e) => e.name);
}

/**
 * Builds a dependency graph of module dependencies
 */
export interface ModuleDependencyGraph {
  modules: Map<string, ModuleResponsibility>;
  dependencies: Map<string, string[]>; // module -> list of dependencies
  dependents: Map<string, string[]>; // module -> list of modules depending on it
}

export function buildModuleDependencyGraph(
  modules: ModuleResponsibility[]
): ModuleDependencyGraph {
  const graph: ModuleDependencyGraph = {
    modules: new Map(),
    dependencies: new Map(),
    dependents: new Map(),
  };

  // Initialize maps
  for (const module of modules) {
    graph.modules.set(module.name, module);
    graph.dependencies.set(module.name, module.dependencies);
    graph.dependents.set(module.name, module.dependents);
  }

  return graph;
}
