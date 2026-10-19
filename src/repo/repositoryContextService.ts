import { readFile, stat } from 'fs/promises';
import { readFileSync } from 'node:fs';
import path from 'path';
import { buildProjectFileMap, type ProjectFileMap, type ProjectFileMapEntry } from '../coder/projectFileMap.js';
import {
  discoverRepositoryMap,
  type RepositoryMap,
} from './repositoryMap.js';
import {
  buildContextPack,
  type ContextPack,
} from './contextPack.js';
import {
  buildDependencyGraph,
  extractExports,
  extractImports,
  type DependencyGraphQuery,
  type DependencySignal,
} from './dependencyGraph.js';
import {
  discoverAPIRoutes,
  discoverUIComponents,
  discoverUIRoutes,
  type APISurface,
  type UISurface,
} from '../tools/surfaceDiscovery.js';
import {
  createScriptMetadata,
  categorizeScripts,
  detectScripts,
  type CategorizedScripts,
  type ScriptMetadata,
} from '../tools/scriptDiscovery.js';

export interface RepositoryContextSnapshot {
  workspace: string;
  repositoryMap: RepositoryMap;
  fileMap: ProjectFileMap;
  scripts: CategorizedScripts;
  apiRoutes: APISurface[];
  uiComponents: UISurface[];
  uiRoutes: UISurface[];
  dependencySignals: DependencySignal[];
  dependencyGraph: DependencyGraphQuery;
  generatedAt: number;
}

export interface RelevantFile {
  path: string;
  score: number;
  reasons: string[];
  entry: ProjectFileMapEntry;
}

export interface SymbolMatch {
  symbol: string;
  path: string;
  line: number;
  kind: 'definition' | 'reference';
  text: string;
}

export interface ReadFileResult {
  path: string;
  content: string;
  truncated: boolean;
  bytes: number;
}

export interface RepositoryContextServiceOptions {
  maxRelevantFiles?: number;
  maxReadFiles?: number;
  maxBytesPerFile?: number;
  maxDependencyFiles?: number;
}

interface CachedRead {
  mtimeMs: number;
  size: number;
  content: string;
}

const DEFAULT_OPTIONS: Required<RepositoryContextServiceOptions> = {
  maxRelevantFiles: 20,
  maxReadFiles: 12,
  maxBytesPerFile: 64 * 1024,
  maxDependencyFiles: 180,
};

function normalizeRelative(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function tokenize(query: string): string[] {
  return unique(query.toLowerCase().split(/[^a-z0-9_.-]+/).filter((token) => token.length >= 2));
}

function isSafeRelativePath(filePath: string): boolean {
  const normalized = normalizeRelative(filePath);
  return normalized !== '' && normalized !== '.' && !path.posix.isAbsolute(normalized) && !normalized.split('/').includes('..');
}

function normalizeDependencySignal(signal: DependencySignal, workspace: string): DependencySignal {
  const sourceRelative = path.isAbsolute(signal.source)
    ? normalizeRelative(path.relative(workspace, signal.source))
    : normalizeRelative(signal.source);
  let target = signal.target;
  if (path.isAbsolute(target)) {
    target = normalizeRelative(path.relative(workspace, target));
  } else if (target.startsWith('.')) {
    target = normalizeRelative(path.join(path.dirname(sourceRelative), target));
  }
  return { ...signal, source: sourceRelative, target };
}

function fallbackApiRoutes(content: string, filePath: string): APISurface[] {
  const routes: APISurface[] = [];
  const pattern = /(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) {
    routes.push({ route: match[2], method: match[1].toUpperCase() as APISurface['method'], description: `${match[1].toUpperCase()} ${match[2]}`, filePath });
  }
  return routes;
}

function readNativeText(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function fallbackUiComponents(content: string, filePath: string): UISurface[] {
  const components: UISurface[] = [];
  const pattern = /export\s+(?:default\s+)?(?:function|const)\s+([A-Z]\w*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) {
    components.push({ type: 'component', name: match[1], exports: [match[1]], filePath });
  }
  return components;
}

function fallbackUiRoutes(content: string, filePath: string): UISurface[] {
  const routes: UISurface[] = [];
  const found = new Set<string>();
  const pattern = /path\s*=\s*['"`]([^'"`]+)['"`]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) found.add(match[1]);
  for (const routePath of found) routes.push({ type: 'route', name: routePath.split('/').filter(Boolean).pop() || 'root', path: routePath, exports: [routePath], filePath, isPage: true });
  return routes;
}

export class RepositoryContextService {
  private readonly workspace: string;
  private readonly options: Required<RepositoryContextServiceOptions>;
  private snapshot?: RepositoryContextSnapshot;
  private readonly inspectedFiles = new Set<string>();
  private readonly readCache = new Map<string, CachedRead>();

  constructor(workspace: string, options: RepositoryContextServiceOptions = {}) {
    this.workspace = path.resolve(workspace);
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async getWorkspaceSummary(forceRefresh = false): Promise<RepositoryContextSnapshot> {
    if (this.snapshot && !forceRefresh) return this.snapshot;

    const [repositoryMap, fileMap] = await Promise.all([
      Promise.resolve(discoverRepositoryMap(this.workspace)),
      buildProjectFileMap(this.workspace),
    ]);
    const packagePath = path.join(this.workspace, 'package.json');
    const scriptResult = detectScripts(packagePath);
    let discoveredScripts = scriptResult.scripts;
    // `detectScripts` is intentionally retained as the primary adapter. The
    // native read fallback keeps this service deterministic when an embedding
    // environment mocks CommonJS `fs` while still exposing a real package file.
    if (discoveredScripts.length === 0) {
      const packageText = await readFile(packagePath, 'utf8').catch(() => undefined);
      if (packageText) {
        try {
          const packageJson = JSON.parse(packageText) as { scripts?: Record<string, unknown> };
          discoveredScripts = Object.entries(packageJson.scripts || {})
            .filter(([, command]) => typeof command === 'string')
            .map(([name, command]) => createScriptMetadata(name, command as string));
        } catch {
          // The primary adapter owns parse-error reporting.
        }
      }
    }
    const scripts = categorizeScripts(discoveredScripts);
    const filesForSignals = fileMap.files
      .filter((entry) => /\.(?:tsx?|jsx?|mjs|cjs)$/.test(entry.path))
      .slice(0, this.options.maxDependencyFiles);
    const dependencySignals: DependencySignal[] = [];

    for (const entry of filesForSignals) {
      const fullPath = path.join(this.workspace, entry.path);
      dependencySignals.push(
        ...extractImports(fullPath).map((signal) => normalizeDependencySignal(signal, this.workspace)),
        ...extractExports(fullPath).map((signal) => normalizeDependencySignal(signal, this.workspace)),
      );
    }

    const packageSignalsPath = await stat(packagePath).then(() => packagePath).catch(() => undefined);
    if (packageSignalsPath) {
      const { extractScriptDependencies } = await import('./dependencyGraph.js');
      dependencySignals.push(...extractScriptDependencies(packageSignalsPath).map((signal) => normalizeDependencySignal(signal, this.workspace)));
    }

    const apiPath = path.join(this.workspace, 'server.ts');
    const apiDiscovery = discoverAPIRoutes(apiPath);
    const apiRoutes = apiDiscovery.routes.length > 0
      ? apiDiscovery.routes
      : fallbackApiRoutes(readNativeText(apiPath) || await readFile(apiPath, 'utf8').catch(() => ''), apiPath);
    const uiComponents: UISurface[] = [];
    const uiRoutes: UISurface[] = [];
    for (const entry of fileMap.files.filter((item) => /^ui\/.+\.(?:tsx|jsx|ts|js)$/.test(item.path)).slice(0, this.options.maxDependencyFiles)) {
      const fullPath = path.join(this.workspace, entry.path);
      const content = readNativeText(fullPath) || await readFile(fullPath, 'utf8').catch(() => '');
      const componentDiscovery = discoverUIComponents(fullPath);
      const routeDiscovery = discoverUIRoutes(fullPath);
      uiComponents.push(...(componentDiscovery.components.length > 0 ? componentDiscovery.components : fallbackUiComponents(content, entry.path)));
      uiRoutes.push(...(routeDiscovery.routes.length > 0 ? routeDiscovery.routes : fallbackUiRoutes(content, entry.path)));
    }

    this.snapshot = {
      workspace: this.workspace,
      repositoryMap,
      fileMap,
      scripts,
      apiRoutes,
      uiComponents,
      uiRoutes,
      dependencySignals,
      dependencyGraph: buildDependencyGraph(dependencySignals),
      generatedAt: Date.now(),
    };
    return this.snapshot;
  }

  async getContextPack(role: string): Promise<ContextPack> {
    const snapshot = await this.getWorkspaceSummary();
    return buildContextPack(role, snapshot.repositoryMap);
  }

  async rankRelevantFiles(query: string, limit = this.options.maxRelevantFiles): Promise<RelevantFile[]> {
    const snapshot = await this.getWorkspaceSummary();
    const tokens = tokenize(query);
    const lowerQuery = query.toLowerCase();
    const results: RelevantFile[] = [];
    for (const entry of snapshot.fileMap.files) {
      const lowerPath = entry.path.toLowerCase();
      const baseName = path.posix.basename(lowerPath);
      const reasons: string[] = [];
      let score = 0;

      for (const token of tokens) {
        if (lowerPath.includes(token)) {
          score += baseName.includes(token) ? 8 : 4;
          reasons.push(`path:${token}`);
        }
      }
      if (lowerQuery.includes(entry.layer)) {
        score += 2;
        reasons.push(`layer:${entry.layer}`);
      }
      if (lowerQuery.includes(entry.role.toLowerCase())) {
        score += 2;
        reasons.push(`role:${entry.role}`);
      }
      const fullPath = path.join(this.workspace, entry.path);
      const content = await readFile(fullPath, 'utf8').catch(() => '');
      for (const token of tokens) {
        if (new RegExp(`\\b(?:function|class|interface|type|const|let|var)\\s+\\w*${token}\\w*`, 'i').test(content)) {
          score += 5;
          reasons.push(`definition:${token}`);
        } else if (content.toLowerCase().includes(token)) {
          score += 2;
          reasons.push(`content:${token}`);
        }
      }
      const incoming = snapshot.dependencyGraph.getSignalsTo(entry.path).length;
      const outgoing = snapshot.dependencyGraph.getSignalsFrom(entry.path).length;
      if (incoming > 0) {
        score += Math.min(4, incoming);
        reasons.push('referenced-by-project');
      }
      if (outgoing > 0) {
        score += Math.min(2, outgoing);
        reasons.push('has-dependencies');
      }
      if (/\b(entry|main|server|app|index|readme|todo)\b/i.test(baseName)) {
        score += 1;
        reasons.push('entry-or-guidance-file');
      }

      results.push({ path: entry.path, score, reasons: unique(reasons), entry });
    }

    return results
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, Math.max(0, limit));
  }

  async lookupSymbols(symbol: string, limit = 50): Promise<SymbolMatch[]> {
    const candidates = await this.rankRelevantFiles(symbol, this.options.maxRelevantFiles);
    const matches: SymbolMatch[] = [];
    const definition = new RegExp(`\\b(?:export\\s+)?(?:async\\s+)?(?:function|class|interface|type|const|let|var)\\s+${symbol}\\b`);
    const reference = new RegExp(`\\b${symbol}\\b`);

    for (const candidate of candidates) {
      const [read] = await this.readFiles([candidate.path], { maxFiles: 1 });
      if (!read) continue;
      read.content.split('\n').forEach((text, index) => {
        if (definition.test(text)) matches.push({ symbol, path: candidate.path, line: index + 1, kind: 'definition', text: text.trim() });
        else if (reference.test(text)) matches.push({ symbol, path: candidate.path, line: index + 1, kind: 'reference', text: text.trim() });
      });
      if (matches.length >= limit) break;
    }
    return matches.slice(0, Math.max(0, limit));
  }

  async findReferences(symbol: string, limit = 50): Promise<SymbolMatch[]> {
    return (await this.lookupSymbols(symbol, limit * 2)).filter((match) => match.kind === 'reference').slice(0, Math.max(0, limit));
  }

  async readFiles(filePaths: string[], options: { maxFiles?: number; maxBytesPerFile?: number } = {}): Promise<ReadFileResult[]> {
    const maxFiles = options.maxFiles ?? this.options.maxReadFiles;
    const maxBytes = options.maxBytesPerFile ?? this.options.maxBytesPerFile;
    const results: ReadFileResult[] = [];
    for (const requestedPath of unique(filePaths)) {
      if (results.length >= Math.max(0, maxFiles)) break;
      const relativePath = normalizeRelative(requestedPath);
      if (!isSafeRelativePath(relativePath)) continue;
      const fullPath = path.resolve(this.workspace, relativePath);
      if (!fullPath.startsWith(`${this.workspace}${path.sep}`) && fullPath !== this.workspace) continue;
      const fileStat = await stat(fullPath).catch(() => undefined);
      if (!fileStat?.isFile()) continue;
      const cached = this.readCache.get(relativePath);
      let content: string;
      if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
        content = cached.content;
      } else {
        content = await readFile(fullPath, 'utf8');
        this.readCache.set(relativePath, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, content });
      }
      this.inspectedFiles.add(relativePath);
      const bytes = Buffer.byteLength(content, 'utf8');
      const truncated = bytes > maxBytes;
      results.push({
        path: relativePath,
        content: truncated ? Buffer.from(content, 'utf8').subarray(0, maxBytes).toString('utf8') : content,
        truncated,
        bytes,
      });
    }
    return results;
  }

  async discoverProjectCommands(): Promise<ScriptMetadata[]> {
    const snapshot = await this.getWorkspaceSummary();
    return Object.values(snapshot.scripts).flat();
  }

  getInspectedFiles(): string[] {
    return Array.from(this.inspectedFiles).sort();
  }

  clearInspectedFiles(): void {
    this.inspectedFiles.clear();
  }

  invalidate(filePaths: string[] = []): void {
    if (filePaths.length === 0) {
      this.snapshot = undefined;
      this.readCache.clear();
      return;
    }
    for (const filePath of filePaths.map(normalizeRelative)) this.readCache.delete(filePath);
    if (filePaths.some((filePath) => /^(package\.json|tsconfig\.json|vite\.config\.ts|server\.ts|src\/|ui\/)/.test(normalizeRelative(filePath)))) {
      this.snapshot = undefined;
    }
  }
}

export function createRepositoryContextService(workspace: string, options?: RepositoryContextServiceOptions): RepositoryContextService {
  return new RepositoryContextService(workspace, options);
}
