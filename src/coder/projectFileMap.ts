import { mkdir, readdir, stat, writeFile } from 'fs/promises';
import path from 'path';
import { PerformanceCache } from '../utils/performanceCache.js';
import type { PerformanceCacheStats } from '../utils/performanceCache.js';
import { jsonStringify, measureSlowOperationAsync } from '../utils/slowOperations.js';
import type { ProjectFileLayer } from '@barok/core';

export type { ProjectFileLayer } from '@barok/core';

export interface ProjectFileMapEntry {
  path: string;
  layer: ProjectFileLayer;
  role: string;
  exists: boolean;
}

export interface ProjectFileMap {
  workspace: string;
  generatedAt: number;
  totalFiles: number;
  omittedCount: number;
  files: ProjectFileMapEntry[];
}

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  'coverage',
  '.turbo',
  '.cache',
  '.vite',
  '.parcel-cache',
  '.react-engine',
  'logs',
  'storage',
]);

const MAX_FILE_MAP_ENTRIES = 450;
const PROJECT_FILE_MAP_CACHE_TTL_MS = 15_000;
// Scan the workspace rather than assuming this agent is always working in a
// TypeScript repository. walkProjectFiles already bounds the result and skips
// dependency/build directories, so this also discovers root-level static sites
// and manifests for Python, Rust, Go, .NET, and Java projects.
const SCAN_ROOTS = ['.'];
const FRESHNESS_PATHS = ['.', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml'];

interface ProjectFileMapCacheEntry {
  freshnessToken: string;
  fileMap: ProjectFileMap;
}

const projectFileMapCache = new PerformanceCache<ProjectFileMapCacheEntry>({
  ttlMs: PROJECT_FILE_MAP_CACHE_TTL_MS,
  maxEntries: 24,
});

export function getProjectFileMapCacheStats(): PerformanceCacheStats {
  return projectFileMapCache.stats();
}

function normalizeRelative(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function classifyProjectFile(filePath: string): Pick<ProjectFileMapEntry, 'layer' | 'role'> {
  const normalized = normalizeRelative(filePath).toLowerCase();
  const name = path.posix.basename(normalized);

  if (/\.(test|spec)\.(tsx|ts|jsx|js|mjs|cjs)$/.test(normalized) || normalized.includes('/__tests__/')) {
    return { layer: 'tests', role: 'test coverage' };
  }
  if (normalized.startsWith('ui/') || normalized.includes('/components/') || /\.(tsx|jsx|css|html)$/.test(normalized)) {
    return { layer: 'ui', role: normalized.includes('/components/') ? 'ui component' : 'frontend surface' };
  }
  if (normalized === 'server.ts' || normalized.startsWith('src/react/') || normalized.startsWith('src/orchestration/') || normalized.startsWith('src/tools/')) {
    return { layer: 'backend', role: normalized === 'server.ts' ? 'server endpoint' : 'agent/runtime module' };
  }
  if (normalized.startsWith('src/coder/') || normalized.startsWith('src/repo/') || normalized.startsWith('src/tasks/')) {
    return { layer: 'shared', role: 'planning or analysis module' };
  }
  if (/\.(md|mdx|txt|pdf|docx)$/.test(normalized) || name.includes('readme') || name.includes('changelog')) {
    return { layer: 'docs', role: 'documentation' };
  }
  if (/^(package(-lock)?|pnpm-lock|yarn.lock|tsconfig|vite.config|jest.config|eslint.config)/.test(name) || /\.(json|ya?ml)$/.test(normalized)) {
    return { layer: 'config', role: 'configuration' };
  }

  return { layer: 'unknown', role: 'project file' };
}

function cloneFileMap(fileMap: ProjectFileMap): ProjectFileMap {
  return {
    ...fileMap,
    generatedAt: Date.now(),
    files: fileMap.files.map((file) => ({ ...file })),
  };
}

async function addFocusedFiles(
  workspaceRoot: string,
  fileMap: ProjectFileMap,
  focusFiles: string[],
): Promise<ProjectFileMap> {
  const result = cloneFileMap(fileMap);
  const byPath = new Set(result.files.map((file) => file.path));
  let addedCount = 0;

  for (const normalized of focusFiles) {
    if (byPath.has(normalized)) continue;

    const classification = classifyProjectFile(normalized);
    const fullPath = path.resolve(workspaceRoot, normalized);
    const relativePath = path.relative(workspaceRoot, fullPath);
    const isWithinWorkspace = relativePath === '' || (
      relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath)
    );
    const exists = isWithinWorkspace
      ? await stat(fullPath).then((value) => value.isFile()).catch(() => false)
      : false;

    result.files.push({ path: normalized, exists, ...classification });
    byPath.add(normalized);
    addedCount += 1;
  }

  if (addedCount > 0) {
    result.totalFiles += addedCount;
    result.files.sort((a, b) => a.path.localeCompare(b.path));
  }

  return result;
}

async function getFreshnessToken(workspaceRoot: string): Promise<string> {
  const parts = await Promise.all(
    FRESHNESS_PATHS.map(async (relativePath) => {
      const fullPath = path.join(workspaceRoot, relativePath);
      return stat(fullPath)
        .then((value) => `${relativePath}:${value.mtimeMs}:${value.size}`)
        .catch(() => `${relativePath}:missing`);
    })
  );
  return parts.join('|');
}

function addFileEntry(root: string, fullPath: string, entries: ProjectFileMapEntry[], byPath: Map<string, ProjectFileMapEntry>): boolean {
  const relativePath = normalizeRelative(path.relative(root, fullPath));
  if (!relativePath || byPath.has(relativePath)) return false;
  const classification = classifyProjectFile(relativePath);
  const entry = {
    path: relativePath,
    exists: true,
    ...classification,
  };
  byPath.set(relativePath, entry);
  entries.push(entry);
  return true;
}

async function walkProjectFiles(
  root: string,
  dir: string,
  entries: ProjectFileMapEntry[],
  byPath: Map<string, ProjectFileMapEntry>
): Promise<number> {
  let omitted = 0;
  const items = await readdir(dir, { withFileTypes: true });

  for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
    if (item.isDirectory() && EXCLUDED_DIRS.has(item.name)) continue;

    const fullPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      if (entries.length >= MAX_FILE_MAP_ENTRIES) {
        omitted += 1;
      } else {
        omitted += await walkProjectFiles(root, fullPath, entries, byPath);
      }
      continue;
    }

    if (entries.length < MAX_FILE_MAP_ENTRIES) {
      addFileEntry(root, fullPath, entries, byPath);
    } else {
      omitted += 1;
    }
  }

  return omitted;
}

export async function buildProjectFileMap(workspace: string, focusFiles: string[] = []): Promise<ProjectFileMap> {
  const workspaceRoot = path.resolve(workspace);
  const workspaceStat = await stat(workspaceRoot);
  if (!workspaceStat.isDirectory()) {
    throw new Error(`Workspace is not a directory: ${workspaceRoot}`);
  }

  const normalizedFocusFiles = [...new Set(focusFiles.map(normalizeRelative))].sort();
  // Cache the workspace inventory independently of task-specific focus files.
  // Otherwise every distinct task bypasses the cache and walks the full tree.
  const cacheKey = workspaceRoot;
  const freshnessToken = await getFreshnessToken(workspaceRoot);
  const cached = projectFileMapCache.get(cacheKey);
  if (cached && cached.freshnessToken === freshnessToken) {
    return addFocusedFiles(workspaceRoot, cached.fileMap, normalizedFocusFiles);
  }

  const files: ProjectFileMapEntry[] = [];
  const byPath = new Map<string, ProjectFileMapEntry>();
  let omittedCount = 0;

  for (const scanRoot of SCAN_ROOTS) {
    if (files.length >= MAX_FILE_MAP_ENTRIES) {
      omittedCount += 1;
      continue;
    }

    const fullPath = path.join(workspaceRoot, scanRoot);
    const value = await stat(fullPath).catch(() => null);
    if (!value) continue;
    if (value.isDirectory()) {
      omittedCount += await walkProjectFiles(workspaceRoot, fullPath, files, byPath);
    } else if (value.isFile()) {
      addFileEntry(workspaceRoot, fullPath, files, byPath);
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  const fileMap: ProjectFileMap = {
    workspace: workspaceRoot,
    generatedAt: Date.now(),
    totalFiles: files.length + omittedCount,
    omittedCount,
    files,
  };

  projectFileMapCache.set(cacheKey, {
    freshnessToken,
    fileMap: cloneFileMap(fileMap),
  });

  return addFocusedFiles(workspaceRoot, fileMap, normalizedFocusFiles);
}

export async function saveProjectFileMap(fileMap: ProjectFileMap): Promise<string> {
  const targetDir = path.join(fileMap.workspace, '.react-engine');
  await mkdir(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, 'project-file-map.json');
  await measureSlowOperationAsync(`write project file map ${targetPath}`, () =>
    writeFile(targetPath, jsonStringify(fileMap, null, 2), 'utf-8')
  );
  return targetPath;
}
