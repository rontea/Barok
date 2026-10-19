/**
 * Dependency Graph Signal Extraction
 * Extracts import, export, script, test, and API signals for repository structure
 */

import fs from 'fs';
import path from 'path';

/**
 * Type of dependency signal
 */
export type DependencySignalType = 'import' | 'export' | 're-export' | 'script' | 'test' | 'api' | 'ui-component' | 'ui-route';

/**
 * Confidence level for a signal
 */
export type SignalConfidence = 'high' | 'medium' | 'low';

/**
 * Dependency signal in repository
 */
export interface DependencySignal {
  source: string; // File path or module that has the dependency
  target: string; // File path or module being depended on
  type: DependencySignalType; // Type of relationship
  confidence: SignalConfidence; // How confident is this signal
  line?: number; // Line number where signal appears (for imports/exports)
  details?: Record<string, unknown>; // Additional context
}

/**
 * Extracted import from a TypeScript file
 */
export interface ImportSignal extends DependencySignal {
  type: 'import';
  details: {
    importStatement: string; // Raw import statement
    isDefault: boolean;
    isType: boolean;
    importedNames: string[]; // Names being imported
  };
}

/**
 * Extracted export from a TypeScript file
 */
export interface ExportSignal extends DependencySignal {
  type: 'export' | 're-export';
  details: {
    exportStatement: string; // Raw export statement
    isDefault: boolean;
    isType: boolean;
    exportedNames: string[];
  };
}

/**
 * Script dependency from package.json
 */
export interface ScriptSignal extends DependencySignal {
  type: 'script';
  details: {
    scriptName: string;
    scriptCommand: string;
    dependsOn: string[]; // Other scripts this script depends on
  };
}

/**
 * Test file association
 */
export interface TestSignal extends DependencySignal {
  type: 'test';
  details: {
    testFile: string; // Path to test file
    sourceFile: string; // Path to source file being tested
    testType: 'unit' | 'integration' | 'e2e';
  };
}

/**
 * API route or endpoint
 */
export interface ApiSignal extends DependencySignal {
  type: 'api';
  details: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string; // API route path
    handler: string; // Handler function name
  };
}

/**
 * UI component or route
 */
export interface UiSignal extends DependencySignal {
  type: 'ui-component' | 'ui-route';
  details: {
    componentName?: string;
    routePath?: string;
    file: string; // Component/route file
  };
}

/**
 * Extracts import statements from a TypeScript file
 * Returns high-confidence import signals
 */
export function extractImports(filePath: string): ImportSignal[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const imports: ImportSignal[] = [];

  // Match various import patterns
  const importRegex = /import\s+(?:(?:{[^}]*}|[^'"]+)\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  let lineNum = 1;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineImports = line.match(importRegex);

    if (lineImports) {
      for (const imp of lineImports) {
        const sourceMatch = imp.match(/['"]([^'"]+)['"]/);
        if (sourceMatch) {
          const source = sourceMatch[1];

          // Skip node_modules and relative paths that aren't project files
          if (!source.startsWith('.') && !source.startsWith('/')) {
            continue;
          }

          const isDefaultImport = imp.includes('import ') && !imp.includes('{');
          const isTypeImport = imp.includes('import type') || imp.includes(' type {');

          // Extract imported names
          const namesMatch = imp.match(/{([^}]*)}/);
          const importedNames = namesMatch
            ? namesMatch[1]
                .split(',')
                .map((n) => n.trim().split(' as ')[0])
                .filter((n) => n.length > 0)
            : isDefaultImport
              ? ['default']
              : [];

          imports.push({
            source: filePath,
            target: source,
            type: 'import',
            confidence: 'high',
            line: i + 1,
            details: {
              importStatement: imp,
              isDefault: isDefaultImport,
              isType: isTypeImport,
              importedNames,
            },
          });
        }
      }
    }
  }

  return imports;
}

/**
 * Extracts export statements from a TypeScript file
 * Returns high-confidence export signals
 */
export function extractExports(filePath: string): (ExportSignal | DependencySignal)[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const exports: (ExportSignal | DependencySignal)[] = [];

  // Match export patterns
  const exportRegex = /export\s+(?:default\s+)?(?:function|class|interface|type|const|let|var|{[^}]*})\s+(\w+)?/g;
  const reExportRegex = /export\s+(?:{[^}]*})\s+from\s+['"]([^'"]+)['"]/g;

  const lines = content.split('\n');
  let match;

  // Find re-exports first (higher priority)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const reExports = line.match(reExportRegex);

    if (reExports) {
      for (const exp of reExports) {
        const sourceMatch = exp.match(/from\s+['"]([^'"]+)['"]/);
        if (sourceMatch) {
          const source = sourceMatch[1];
          const namesMatch = exp.match(/{([^}]*)}/);
          const exportedNames = namesMatch
            ? namesMatch[1]
                .split(',')
                .map((n) => n.trim().split(' as ')[0])
                .filter((n) => n.length > 0)
            : [];

          exports.push({
            source: filePath,
            target: source,
            type: 're-export',
            confidence: 'high',
            line: i + 1,
            details: {
              exportStatement: exp,
              isDefault: false,
              isType: false,
              exportedNames,
            },
          } as ExportSignal);
        }
      }
    }
  }

  // Find regular exports
  while ((match = exportRegex.exec(content)) !== null) {
    const exportName = match[1] || 'default';
    const isDefault = content.substring(match.index, match.index + 20).includes('export default');

    exports.push({
      source: filePath,
      target: filePath,
      type: 'export',
      confidence: 'high',
      details: {
        exportStatement: match[0],
        isDefault,
        isType: match[0].includes('type '),
        exportedNames: [exportName],
      },
    } as ExportSignal);
  }

  return exports;
}

/**
 * Extracts script dependencies from package.json
 */
export function extractScriptDependencies(packageJsonPath: string): ScriptSignal[] {
  if (!fs.existsSync(packageJsonPath)) {
    return [];
  }

  try {
    const content = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const scripts = content.scripts || {};
    const signals: ScriptSignal[] = [];

    for (const [scriptName, scriptCommand] of Object.entries(scripts)) {
      if (typeof scriptCommand !== 'string') continue;

      // Find other scripts referenced in this script
      const dependsOn: string[] = [];
      const scriptRefRegex = /npm run ([a-z0-9\-:]+)/g;
      let scriptMatch;

      while ((scriptMatch = scriptRefRegex.exec(scriptCommand)) !== null) {
        dependsOn.push(scriptMatch[1]);
      }

      signals.push({
        source: 'package.json',
        target: scriptName,
        type: 'script',
        confidence: 'high',
        details: {
          scriptName,
          scriptCommand,
          dependsOn,
        },
      });
    }

    return signals;
  } catch {
    return [];
  }
}

/**
 * Finds test file associations
 * Matches test files to source files they test
 */
export function extractTestAssociations(repoRoot: string): TestSignal[] {
  const signals: TestSignal[] = [];
  const testPattern = /\.(test|spec)\.ts$/;
  const ignoredDirs = new Set(['node_modules', 'dist', 'coverage', '.git', 'build', '.react-engine']);

  // Find all test files
  function findTestFiles(dir: string, relativePath = ''): string[] {
    const testFiles: string[] = [];

    if (!fs.existsSync(dir)) return testFiles;

    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith('.') || ignoredDirs.has(entry)) continue;

      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        testFiles.push(...findTestFiles(fullPath, path.join(relativePath, entry)));
      } else if (testPattern.test(entry)) {
        testFiles.push(path.join(relativePath, entry));
      }
    }

    return testFiles;
  }

  const testFiles = findTestFiles(repoRoot);

  for (const testFile of testFiles) {
    // Infer source file from test file name
    let sourceFile = testFile.replace(/\.(test|spec)\.ts$/, '.ts');

    // Handle common test naming patterns
    if (testFile.includes('__tests__')) {
      sourceFile = testFile.replace(/[/\\]__tests__[/\\]/, path.sep);
      sourceFile = sourceFile.replace(/\.(test|spec)\.ts$/, '.ts');
    }

    // Determine test type
    let testType: 'unit' | 'integration' | 'e2e' = 'unit';
    if (testFile.includes('integration') || testFile.includes('e2e')) {
      testType = testFile.includes('e2e') ? 'e2e' : 'integration';
    }

    signals.push({
      source: testFile,
      target: sourceFile,
      type: 'test',
      confidence: 'medium',
      details: {
        testFile,
        sourceFile,
        testType,
      },
    });
  }

  return signals;
}

/**
 * Extracts API routes from Express server files
 */
export function extractApiRoutes(filePath: string): ApiSignal[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const signals: ApiSignal[] = [];

  // Match Express route patterns: app.get('/path', handler), router.post('/path', handler)
  const routeRegex = /(app|router)\.(get|post|put|delete|patch)\(['"]([^'"]+)['"][,\s]/gi;
  let match;

  while ((match = routeRegex.exec(content)) !== null) {
    const method = (match[2].toUpperCase() as any) as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    const routePath = match[3];

    signals.push({
      source: filePath,
      target: routePath,
      type: 'api',
      confidence: 'high',
      details: {
        method,
        path: routePath,
        handler: 'handler', // Would need more complex parsing for handler name
      },
    });
  }

  return signals;
}

/**
 * Extracts React component and route definitions
 */
export function extractUiComponents(filePath: string): UiSignal[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const signals: UiSignal[] = [];

  // Match React component exports: export function Name() or export const Name =
  const componentRegex = /export\s+(?:function|const)\s+(\w+)/g;
  let match;

  while ((match = componentRegex.exec(content)) !== null) {
    const componentName = match[1];

    // Check if it looks like a component (starts with capital letter and ends with common suffixes)
    if (/^[A-Z]/.test(componentName)) {
      signals.push({
        source: filePath,
        target: componentName,
        type: 'ui-component',
        confidence: 'medium',
        details: {
          componentName,
          file: filePath,
        },
      });
    }
  }

  // Extract React Router routes: <Route path="/path" element={<Component />} />
  const routeRegex = /path=['"]([^'"]+)['"]/g;
  while ((match = routeRegex.exec(content)) !== null) {
    signals.push({
      source: filePath,
      target: match[1],
      type: 'ui-route',
      confidence: 'medium',
      details: {
        routePath: match[1],
        file: filePath,
      },
    });
  }

  return signals;
}

/**
 * Dependency graph for querying signals
 */
export interface DependencyGraphQuery {
  getSignalsFrom(source: string): DependencySignal[];
  getSignalsTo(target: string): DependencySignal[];
  findImportPath(from: string, to: string): DependencySignal[][];
  getConnectedModules(module: string): string[];
}

/**
 * Builds a queryable dependency graph from signals
 */
export function buildDependencyGraph(signals: DependencySignal[]): DependencyGraphQuery {
  const signalsBySource = new Map<string, DependencySignal[]>();
  const signalsByTarget = new Map<string, DependencySignal[]>();

  for (const signal of signals) {
    if (!signalsBySource.has(signal.source)) {
      signalsBySource.set(signal.source, []);
    }
    signalsBySource.get(signal.source)!.push(signal);

    if (!signalsByTarget.has(signal.target)) {
      signalsByTarget.set(signal.target, []);
    }
    signalsByTarget.get(signal.target)!.push(signal);
  }

  return {
    getSignalsFrom: (source: string) => signalsBySource.get(source) || [],
    getSignalsTo: (target: string) => signalsByTarget.get(target) || [],
    findImportPath: (from: string, to: string) => {
      // BFS to find import path
      const paths: DependencySignal[][] = [];
      const queue: [string, DependencySignal[]][] = [[from, []]];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const [current, path] = queue.shift()!;

        if (visited.has(current)) continue;
        visited.add(current);

        const signals = signalsBySource.get(current) || [];
        for (const signal of signals) {
          const newPath = [...path, signal];

          if (signal.target === to) {
            paths.push(newPath);
          } else if (!visited.has(signal.target)) {
            queue.push([signal.target, newPath]);
          }
        }
      }

      return paths;
    },
    getConnectedModules: (module: string) => {
      const connected = new Set<string>();
      const fromSignals = signalsBySource.get(module) || [];
      const toSignals = signalsByTarget.get(module) || [];

      for (const signal of fromSignals) {
        connected.add(signal.target);
      }
      for (const signal of toSignals) {
        connected.add(signal.source);
      }

      return Array.from(connected);
    },
  };
}
