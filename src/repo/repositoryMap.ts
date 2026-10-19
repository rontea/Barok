/**
 * Repository Map Type and Discovery System
 * Provides centralized repository structure understanding for multi-agent coordination
 */

import fs from 'fs';
import path from 'path';

/**
 * Package file entry with resolved path and content
 */
export interface PackageFileEntry {
  name: string; // package.json, tsconfig.json, jest.config.cjs, vite.config.ts
  path: string; // Relative to repo root
  content: Record<string, unknown>; // Parsed content
}

/**
 * Entry point definition for executable or importable modules
 */
export interface EntryPoint {
  name: string; // 'cli', 'server', 'react-engine', 'ui'
  type: 'cli' | 'server' | 'library' | 'ui';
  path: string; // Relative path to entry file or directory
  description: string;
}

/**
 * Test discovery entry
 */
export interface TestEntry {
  pattern: string; // Glob pattern: '**/*.test.ts', '**/*.spec.ts', 'tests/**'
  count: number; // Estimated count (may be 0 if not scanned yet)
  locations: string[]; // Known test directories/patterns
}

/**
 * Documentation discovery entry
 */
export interface DocEntry {
  name: string; // 'README', 'API', 'Architecture', 'Changelog', 'Contributing'
  path: string; // Relative path
  type: 'file' | 'directory';
}

/**
 * Generated artifact entry (not tracked for edits)
 */
export interface ArtifactEntry {
  pattern: string; // Glob pattern: 'dist/**', 'coverage/**', 'logs/**', 'target/**'
  description: string;
}

/**
 * Source root entry with role assignment
 */
export interface SourceRoot {
  path: string; // 'src', 'ui/src', etc.
  type: 'backend' | 'frontend' | 'shared' | 'cli';
  description: string;
}

/**
 * Complete repository map
 */
export interface RepositoryMap {
  // Repository metadata
  rootPath: string; // Absolute path to repo root
  repositoryName: string; // From package.json
  repositoryVersion: string; // From package.json

  // Key file references
  packageFiles: PackageFileEntry[];
  configFiles: string[]; // tsconfig.json, vite.config.ts, eslint.config.js, jest.config.cjs

  // Entry points for execution
  entryPoints: EntryPoint[];

  // Source code organization
  sourceRoots: SourceRoot[];

  // Test locations and patterns
  tests: TestEntry[];

  // Documentation locations
  docs: DocEntry[];

  // Generated artifacts (not edited)
  artifacts: ArtifactEntry[];

  // Metadata for cache invalidation
  discoveredAt: number; // Unix timestamp
  fileHashes: {
    // Hashes to detect changes
    packageJson: string;
    tsconfig: string;
    viteConfig: string;
  };
}

/**
 * Discovers package.json and similar files in repo
 */
export function discoverPackageFiles(rootPath: string): PackageFileEntry[] {
  const entries: PackageFileEntry[] = [];

  const packageFiles = [
    { name: 'package.json', required: true },
    { name: 'tsconfig.json', required: false },
    { name: 'jest.config.cjs', required: false },
    { name: 'vite.config.ts', required: false },
    { name: 'eslint.config.js', required: false },
  ];

  for (const { name, required } of packageFiles) {
    const filePath = path.join(rootPath, name);
    try {
      if (fs.existsSync(filePath)) {
        let content: Record<string, unknown> = {};
        if (name === 'package.json') {
          const text = fs.readFileSync(filePath, 'utf-8');
          content = JSON.parse(text);
        }
        entries.push({
          name,
          path: name,
          content,
        });
      } else if (required) {
        throw new Error(`Required file not found: ${name}`);
      }
    } catch (error) {
      if (required) throw error;
      // Skip optional files that fail to parse
    }
  }

  return entries;
}

/**
 * Discovers entry points (executable and importable modules)
 */
export function discoverEntryPoints(
  rootPath: string,
  packageJson: Record<string, unknown>
): EntryPoint[] {
  const entries: EntryPoint[] = [];

  // Check bin field for CLI entry points
  const bin = packageJson.bin as Record<string, string> | undefined;
  if (bin) {
    Object.entries(bin).forEach(([name, filePath]) => {
      entries.push({
        name: name.replace(/^raw-react-mcp-/, ''),
        type: 'cli',
        path: filePath,
        description: `CLI entry point: ${name}`,
      });
    });
  }

  // Check main field
  const main = packageJson.main as string | undefined;
  if (main) {
    entries.push({
      name: 'server',
      type: 'server',
      path: main,
      description: 'Main server entry point',
    });
  }

  // Check for UI entry
  if (fs.existsSync(path.join(rootPath, 'ui', 'src', 'main.tsx'))) {
    entries.push({
      name: 'ui',
      type: 'ui',
      path: 'ui/src/main.tsx',
      description: 'React UI entry point',
    });
  }

  // Check for React engine library
  if (fs.existsSync(path.join(rootPath, 'src', 'react', 'engine.ts'))) {
    entries.push({
      name: 'react-engine',
      type: 'library',
      path: 'src/react/engine.ts',
      description: 'ReAct engine library export',
    });
  }

  return entries;
}

/**
 * Discovers source roots with role assignments
 */
export function discoverSourceRoots(rootPath: string): SourceRoot[] {
  const roots: SourceRoot[] = [];

  // Backend source
  if (fs.existsSync(path.join(rootPath, 'src'))) {
    roots.push({
      path: 'src',
      type: 'backend',
      description: 'Backend API, ReAct engine, agents, utilities',
    });
  }

  // Frontend source
  if (fs.existsSync(path.join(rootPath, 'ui', 'src'))) {
    roots.push({
      path: 'ui/src',
      type: 'frontend',
      description: 'React UI components, styling, state management',
    });
  }

  // Shared source
  if (fs.existsSync(path.join(rootPath, 'shared'))) {
    roots.push({
      path: 'shared',
      type: 'shared',
      description: 'Shared types, utilities, constants',
    });
  }

  // CLI source
  if (fs.existsSync(path.join(rootPath, 'src', 'cli'))) {
    roots.push({
      path: 'src/cli',
      type: 'cli',
      description: 'Command-line interface implementation',
    });
  }

  return roots;
}

/**
 * Discovers test locations and patterns
 */
export function discoverTests(_rootPath: string): TestEntry[] {
  return [
    {
      pattern: '**/__tests__/**/*.test.ts',
      count: 0,
      locations: ['src/**/__tests__', 'ui/**/__tests__'],
    },
    {
      pattern: '**/*.test.ts',
      count: 0,
      locations: ['src', 'ui/src'],
    },
    {
      pattern: '**/*.spec.ts',
      count: 0,
      locations: ['tests'],
    },
    {
      pattern: 'tests/smoke/**',
      count: 0,
      locations: ['tests/smoke'],
    },
  ];
}

/**
 * Discovers documentation
 */
export function discoverDocs(rootPath: string): DocEntry[] {
  const docs: DocEntry[] = [];

  // Root level docs
  const rootDocs = [
    { name: 'README', path: 'README.md' },
    { name: 'Changelog', path: 'CHANGELOG.md' },
    { name: 'Contributing', path: 'CONTRIBUTING.md' },
  ];

  for (const doc of rootDocs) {
    if (fs.existsSync(path.join(rootPath, doc.path))) {
      docs.push({ ...doc, type: 'file' });
    }
  }

  // Docs directory
  if (fs.existsSync(path.join(rootPath, 'docs'))) {
    docs.push({
      name: 'Docs',
      path: 'docs',
      type: 'directory',
    });
  }

  return docs;
}

/**
 * Discovers generated artifacts (not edited)
 */
export function discoverArtifacts(): ArtifactEntry[] {
  return [
    {
      pattern: 'dist/**',
      description: 'Build output (CLI, server, UI bundles)',
    },
    {
      pattern: 'coverage/**',
      description: 'Test coverage reports',
    },
    {
      pattern: 'logs/**',
      description: 'Runtime logs',
    },
    {
      pattern: 'target/**',
      description: 'Build artifacts',
    },
    {
      pattern: 'node_modules/**',
      description: 'Installed dependencies',
    },
    {
      pattern: '.git/**',
      description: 'Git repository',
    },
  ];
}

/**
 * Computes simple hash for file invalidation
 */
export function computeFileHash(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) return 'not-found';
    const stats = fs.statSync(filePath);
    return `${stats.size}-${stats.mtimeMs}`;
  } catch {
    return 'error';
  }
}

/**
 * Discovers complete repository map
 */
export function discoverRepositoryMap(rootPath: string): RepositoryMap {
  const packageFiles = discoverPackageFiles(rootPath);
  const packageJson = (packageFiles.find((f) => f.name === 'package.json')
    ?.content as Record<string, unknown> | undefined) || {};

  return {
    rootPath,
    repositoryName: (packageJson.name as string | undefined) || 'unknown',
    repositoryVersion: (packageJson.version as string | undefined) || '0.0.0',
    packageFiles,
    configFiles: packageFiles
      .filter((f) => f.name !== 'package.json')
      .map((f) => f.path),
    entryPoints: discoverEntryPoints(rootPath, packageJson),
    sourceRoots: discoverSourceRoots(rootPath),
    tests: discoverTests(rootPath),
    docs: discoverDocs(rootPath),
    artifacts: discoverArtifacts(),
    discoveredAt: Date.now(),
    fileHashes: {
      packageJson: computeFileHash(path.join(rootPath, 'package.json')),
      tsconfig: computeFileHash(path.join(rootPath, 'tsconfig.json')),
      viteConfig: computeFileHash(path.join(rootPath, 'vite.config.ts')),
    },
  };
}

/**
 * Checks if cached repository map is still valid
 */
export function isRepositoryMapValid(
  map: RepositoryMap,
  rootPath: string
): boolean {
  // Always valid if discovered within last 5 minutes
  if (Date.now() - map.discoveredAt < 5 * 60 * 1000) {
    return true;
  }

  // Check if key files changed
  const currentHashes = {
    packageJson: computeFileHash(path.join(rootPath, 'package.json')),
    tsconfig: computeFileHash(path.join(rootPath, 'tsconfig.json')),
    viteConfig: computeFileHash(path.join(rootPath, 'vite.config.ts')),
  };

  return (
    currentHashes.packageJson === map.fileHashes.packageJson &&
    currentHashes.tsconfig === map.fileHashes.tsconfig &&
    currentHashes.viteConfig === map.fileHashes.viteConfig
  );
}
