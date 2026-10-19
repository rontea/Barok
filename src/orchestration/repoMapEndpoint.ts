/**
 * Phase 7.1 Task 3: Real Repo Map Generation
 * 
 * Detects and caches repository structure across 6 layers:
 * 1. Frontend (ui/, components, pages)
 * 2. Backend (src/api, src/services, src/data, src/tools)
 * 3. Tests (tests/, **\/*.test.ts)
 * 4. Docs (docs/, README, IMPLEMENTATION)
 * 5. Scripts (package.json scripts)
 * 6. Generated Artifacts (dist/, coverage/, logs/, target/)
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { Response } from 'express';

/**
 * Repository map cache with TTL support
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  invalidators: string[]; // Files that invalidate this cache
}

/**
 * Repository map structure
 */
export interface RepoMapData {
  timestamp: number;
  workspace: string;
  frontend: {
    rootDir: string;
    components: string[];
    pages: string[];
    utilities: string[];
    configFiles: string[];
  };
  backend: {
    apiRoutes: string[];
    services: string[];
    dataLayer: string[];
    tools: string[];
    configFiles: string[];
  };
  tests: {
    testFiles: string[];
    testDirs: string[];
    coverage: boolean;
  };
  docs: {
    readmeFiles: string[];
    docDirs: string[];
    apiDocs: string[];
  };
  scripts: {
    available: string[];
    categories: Record<string, string[]>;
  };
  artifacts: {
    buildOutputs: string[];
    coverage: string[];
    logs: string[];
    cache: string[];
  };
  cacheInfo?: {
    cachedAt: number;
    ttlMs: number;
    expiresAt: number;
  };
}

/**
 * In-memory cache for repo maps with TTL
 */
const repoMapCache = new Map<string, CacheEntry<RepoMapData>>();
const CACHE_TTL_MS = 3600000; // 1 hour

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveWorkspaceRoot(workspace?: string): string {
  return path.resolve(workspace || process.cwd());
}

/**
 * Get all files in a directory recursively with depth limit
 */
async function getFilesInDir(
  workspaceRoot: string,
  dirPath: string,
  maxDepth: number = 3,
  currentDepth: number = 0,
  pattern?: string
): Promise<string[]> {
  const results: string[] = [];
  const absoluteDirPath = path.resolve(workspaceRoot, dirPath);

  if (currentDepth >= maxDepth || !(await fileExists(absoluteDirPath))) {
    return results;
  }

  try {
    const entries = await fs.readdir(absoluteDirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(absoluteDirPath, entry.name);
      const relativePath = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');

      // Skip node_modules and .git
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) {
        continue;
      }

      if (entry.isFile()) {
        if (!pattern || new RegExp(pattern).test(entry.name)) {
          results.push(relativePath);
        }
      } else if (entry.isDirectory()) {
        const subFiles = await getFilesInDir(workspaceRoot, path.relative(workspaceRoot, fullPath), maxDepth, currentDepth + 1, pattern);
        results.push(...subFiles);
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read
  }

  return results;
}

/**
 * Detect frontend layer
 */
async function detectFrontendLayer(workspaceRoot: string): Promise<RepoMapData['frontend']> {
  const frontend: RepoMapData['frontend'] = {
    rootDir: 'ui',
    components: [],
    pages: [],
    utilities: [],
    configFiles: [],
  };

  // Check for components
  const componentsDir = path.join('ui', 'src', 'components');
  if (await fileExists(path.join(workspaceRoot, componentsDir))) {
    const files = await getFilesInDir(workspaceRoot, componentsDir, 2, 0, '\\.(tsx|ts|jsx|js)$');
    frontend.components = files.slice(0, 10); // Limit to 10 for display
  }

  // Check for pages
  const pagesDir = path.join('ui', 'src', 'pages');
  if (await fileExists(path.join(workspaceRoot, pagesDir))) {
    const files = await getFilesInDir(workspaceRoot, pagesDir, 2, 0, '\\.(tsx|ts|jsx|js)$');
    frontend.pages = files.slice(0, 10);
  }

  // Check for utilities
  const utilsDir = path.join('ui', 'src', 'utils');
  if (await fileExists(path.join(workspaceRoot, utilsDir))) {
    const files = await getFilesInDir(workspaceRoot, utilsDir, 2, 0, '\\.(tsx|ts|jsx|js)$');
    frontend.utilities = files.slice(0, 10);
  }

  // Check for config files
  const configPatterns = ['vite.config', 'tsconfig', 'next.config'];
  for (const pattern of configPatterns) {
    const files = await getFilesInDir(workspaceRoot, 'ui', 1, 0, pattern);
    frontend.configFiles.push(...files);
  }

  return frontend;
}

/**
 * Detect backend layer
 */
async function detectBackendLayer(workspaceRoot: string): Promise<RepoMapData['backend']> {
  const backend: RepoMapData['backend'] = {
    apiRoutes: [],
    services: [],
    dataLayer: [],
    tools: [],
    configFiles: [],
  };

  // Check for API routes
  const apiDir = path.join('src', 'api');
  if (await fileExists(path.join(workspaceRoot, apiDir))) {
    const files = await getFilesInDir(workspaceRoot, apiDir, 2, 0, '\\.(ts|js)$');
    backend.apiRoutes = files.slice(0, 15);
  }

  // Check for services
  const servicesDir = path.join('src', 'services');
  if (await fileExists(path.join(workspaceRoot, servicesDir))) {
    const files = await getFilesInDir(workspaceRoot, servicesDir, 2, 0, '\\.(ts|js)$');
    backend.services = files.slice(0, 10);
  }

  // Check for data layer
  const dataDir = path.join('src', 'data');
  if (await fileExists(path.join(workspaceRoot, dataDir))) {
    const files = await getFilesInDir(workspaceRoot, dataDir, 2, 0, '\\.(ts|js)$');
    backend.dataLayer = files.slice(0, 10);
  }

  // Check for tools
  const toolsDir = path.join('src', 'tools');
  if (await fileExists(path.join(workspaceRoot, toolsDir))) {
    const files = await getFilesInDir(workspaceRoot, toolsDir, 2, 0, '\\.(ts|js)$');
    backend.tools = files.slice(0, 10);
  }

  // Check for config files
  const configPatterns = ['tsconfig', 'jest.config', 'eslint.config'];
  for (const pattern of configPatterns) {
    const files = await getFilesInDir(workspaceRoot, '.', 1, 0, pattern);
    backend.configFiles.push(...files);
  }

  return backend;
}

/**
 * Detect tests layer
 */
async function detectTestsLayer(workspaceRoot: string): Promise<RepoMapData['tests']> {
  const tests: RepoMapData['tests'] = {
    testFiles: [],
    testDirs: [],
    coverage: false,
  };

  // Check for test directories
  const testDirs = ['tests', 'test', '__tests__', 'src/__tests__'];
  for (const dir of testDirs) {
    if (await fileExists(path.join(workspaceRoot, dir))) {
      tests.testDirs.push(dir);
    }
  }

  // Check for test files in src
  const testFiles = await getFilesInDir(workspaceRoot, 'src', 2, 0, '\\.test\\.(ts|js|tsx|jsx)$');
  tests.testFiles = testFiles.slice(0, 20);

  // Check for coverage
  tests.coverage = await fileExists(path.join(workspaceRoot, 'coverage'));

  return tests;
}

/**
 * Detect docs layer
 */
async function detectDocsLayer(workspaceRoot: string): Promise<RepoMapData['docs']> {
  const docs: RepoMapData['docs'] = {
    readmeFiles: [],
    docDirs: [],
    apiDocs: [],
  };

  // Check for README files
  const readmePatterns = ['README', 'readme'];
  for (const pattern of readmePatterns) {
    const files = await getFilesInDir(workspaceRoot, '.', 1, 0, `^${pattern}(\\.md)?$`);
    docs.readmeFiles.push(...files);
  }

  // Check for doc directories
  const docDirs = ['docs', 'doc', 'documentation'];
  for (const dir of docDirs) {
    if (await fileExists(path.join(workspaceRoot, dir))) {
      docs.docDirs.push(dir);
      const files = await getFilesInDir(workspaceRoot, dir, 2, 0, '\\.md$');
      docs.apiDocs.push(...files.slice(0, 15));
    }
  }

  return docs;
}

/**
 * Detect scripts from package.json
 */
async function detectScriptsLayer(workspaceRoot: string): Promise<RepoMapData['scripts']> {
  const scripts: RepoMapData['scripts'] = {
    available: [],
    categories: {},
  };

  try {
    const packageJsonPath = path.join(workspaceRoot, 'package.json');
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);

    if (packageJson.scripts) {
      scripts.available = Object.keys(packageJson.scripts);

      // Categorize scripts
      const categories: Record<string, string[]> = {
        build: [],
        test: [],
        dev: [],
        lint: [],
        other: [],
      };

      for (const [name, _] of Object.entries(packageJson.scripts)) {
        if (name.includes('build')) {
          categories.build.push(name);
        } else if (name.includes('test')) {
          categories.test.push(name);
        } else if (name.includes('dev')) {
          categories.dev.push(name);
        } else if (name.includes('lint')) {
          categories.lint.push(name);
        } else {
          categories.other.push(name);
        }
      }

      scripts.categories = categories;
    }
  } catch (error) {
    // package.json not found or invalid
  }

  return scripts;
}

/**
 * Detect generated artifacts layer
 */
async function detectArtifactsLayer(workspaceRoot: string): Promise<RepoMapData['artifacts']> {
  const artifacts: RepoMapData['artifacts'] = {
    buildOutputs: [],
    coverage: [],
    logs: [],
    cache: [],
  };

  // Check for build outputs
  const buildDirs = ['dist', 'build', '.next', 'out', 'target'];
  for (const dir of buildDirs) {
    if (await fileExists(path.join(workspaceRoot, dir))) {
      artifacts.buildOutputs.push(dir);
    }
  }

  // Check for coverage
  const coverageDirs = ['coverage', '.nyc_output'];
  for (const dir of coverageDirs) {
    if (await fileExists(path.join(workspaceRoot, dir))) {
      artifacts.coverage.push(dir);
    }
  }

  // Check for logs
  const logDirs = ['logs', 'log'];
  for (const dir of logDirs) {
    if (await fileExists(path.join(workspaceRoot, dir))) {
      artifacts.logs.push(dir);
    }
  }

  // Check for cache
  const cacheDirs = ['.cache', '.eslintcache', 'node_modules/.cache'];
  for (const dir of cacheDirs) {
    if (await fileExists(path.join(workspaceRoot, dir))) {
      artifacts.cache.push(dir);
    }
  }

  return artifacts;
}

/**
 * Check if cache should be invalidated
 */
function shouldInvalidateCache(entry: CacheEntry<RepoMapData>): boolean {
  const now = Date.now();
  const age = now - entry.timestamp;

  if (age > CACHE_TTL_MS) {
    return true;
  }

  // Could add file-based invalidation checks here
  return false;
}

/**
 * Generate complete repo map
 */
export async function generateRepoMap(workspace?: string): Promise<RepoMapData> {
  const workspaceRoot = resolveWorkspaceRoot(workspace);
  const cacheKey = workspaceRoot;
  const cached = repoMapCache.get(cacheKey);

  if (cached && !shouldInvalidateCache(cached)) {
    return cached.data;
  }

  const repoMap: RepoMapData = {
    timestamp: Date.now(),
    workspace: workspaceRoot,
    frontend: await detectFrontendLayer(workspaceRoot),
    backend: await detectBackendLayer(workspaceRoot),
    tests: await detectTestsLayer(workspaceRoot),
    docs: await detectDocsLayer(workspaceRoot),
    scripts: await detectScriptsLayer(workspaceRoot),
    artifacts: await detectArtifactsLayer(workspaceRoot),
    cacheInfo: {
      cachedAt: Date.now(),
      ttlMs: CACHE_TTL_MS,
      expiresAt: Date.now() + CACHE_TTL_MS,
    },
  };

  // Cache the result
  repoMapCache.set(cacheKey, {
    data: repoMap,
    timestamp: Date.now(),
    invalidators: ['package.json', 'tsconfig.json', '.eslintrc.json'],
  });

  return repoMap;
}

/**
 * Invalidate cache for a workspace
 */
export function invalidateRepoMapCache(workspace?: string): void {
  const cacheKey = resolveWorkspaceRoot(workspace);
  repoMapCache.delete(cacheKey);
}

/**
 * Clear all caches
 */
export function clearAllRepoMapCaches(): void {
  repoMapCache.clear();
}

/**
 * Handler for repo map generation endpoint
 */
export async function handleRepoMapRequest(req: any, res: Response): Promise<void> {
  try {
    const { workspace } = req.body || {};

    const repoMap = await generateRepoMap(workspace);

    res.json({
      success: true,
      data: repoMap,
    });
  } catch (error: any) {
    console.error('Repo map generation error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Unknown error during repo map generation',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
}

/**
 * Get cache statistics
 */
export function getRepoMapCacheStats(): {
  size: number;
  entries: Array<{ key: string; age: number; ttlMs: number }>;
} {
  const entries: Array<{ key: string; age: number; ttlMs: number }> = [];
  const now = Date.now();

  for (const [key, entry] of repoMapCache.entries()) {
    entries.push({
      key,
      age: now - entry.timestamp,
      ttlMs: CACHE_TTL_MS,
    });
  }

  return {
    size: repoMapCache.size,
    entries,
  };
}
