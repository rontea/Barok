/**
 * Caching Module
 * Caches stable data like tool descriptions and workspace summaries
 */

import { promises as fs } from 'fs';
import path from 'path';
import { PerformanceCache } from '../utils/performanceCache.js';
import type { PerformanceCacheStats } from '../utils/performanceCache.js';
import { jsonParse, jsonStringify, measureSlowOperationAsync } from '../utils/slowOperations.js';

export interface CacheEntry<T> {
  key: string;
  data: T;
  timestamp: number;
  ttlMs: number; // Time to live in milliseconds
}

export interface WorkspaceSummary {
  workspace: string;
  timestamp: string;
  fileCount: number;
  directories: string[];
  summary: string;
}

export interface ToolDescriptionCache {
  tools: Array<{
    name: string;
    description: string;
  }>;
  timestamp: string;
  count: number;
}

// Global caches
const toolDescriptionCache = new PerformanceCache<ToolDescriptionCache>({
  ttlMs: 86400000,
  maxEntries: 4,
});
const workspaceSummaryCache = new PerformanceCache<WorkspaceSummary>({
  ttlMs: 3600000,
  maxEntries: 32,
});

/**
 * Cache tool descriptions
 */
export function cacheToolDescriptions(
  tools: Array<{ name: string; description: string }>
): void {
  const cacheData: ToolDescriptionCache = {
    tools,
    timestamp: new Date().toISOString(),
    count: tools.length,
  };
  toolDescriptionCache.set('__global__', cacheData);
}

/**
 * Get cached tool descriptions
 */
export function getCachedToolDescriptions(): ToolDescriptionCache | null {
  return toolDescriptionCache.get('__global__');
}

/**
 * Cache workspace summary
 */
export function cacheWorkspaceSummary(summary: WorkspaceSummary): void {
  const key = summary.workspace;
  workspaceSummaryCache.set(key, summary);
}

/**
 * Get cached workspace summary
 */
export function getCachedWorkspaceSummary(workspace: string): WorkspaceSummary | null {
  return workspaceSummaryCache.get(workspace);
}

/**
 * Clear all caches
 */
export function clearAllCaches(): void {
  toolDescriptionCache.clear();
  workspaceSummaryCache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  toolDescriptionsSize: number;
  workspaceSummariesSize: number;
  totalCacheSize: number;
  toolDescriptions: PerformanceCacheStats;
  workspaceSummaries: PerformanceCacheStats;
  totalHits: number;
  totalMisses: number;
  totalStaleHits: number;
  totalStaleRefreshes: number;
  totalSets: number;
  totalEvictions: number;
  totalDeletes: number;
} {
  const toolDescriptions = toolDescriptionCache.stats();
  const workspaceSummaries = workspaceSummaryCache.stats();
  return {
    toolDescriptionsSize: toolDescriptions.size,
    workspaceSummariesSize: workspaceSummaries.size,
    totalCacheSize: toolDescriptions.size + workspaceSummaries.size,
    toolDescriptions,
    workspaceSummaries,
    totalHits: toolDescriptions.hits + workspaceSummaries.hits,
    totalMisses: toolDescriptions.misses + workspaceSummaries.misses,
    totalStaleHits: toolDescriptions.staleHits + workspaceSummaries.staleHits,
    totalStaleRefreshes: toolDescriptions.staleRefreshes + workspaceSummaries.staleRefreshes,
    totalSets: toolDescriptions.sets + workspaceSummaries.sets,
    totalEvictions: toolDescriptions.evictions + workspaceSummaries.evictions,
    totalDeletes: toolDescriptions.deletes + workspaceSummaries.deletes,
  };
}

/**
 * Save cache to disk for persistence across sessions
 */
export async function persistCacheToDisk(workspace: string): Promise<void> {
  const toolCache = getCachedToolDescriptions();
  const workspaceSummary = getCachedWorkspaceSummary(workspace);
  if (!toolCache && !workspaceSummary) {
    return;
  }

  const cacheDir = path.join(workspace, '.react-engine', 'cache');
  await fs.mkdir(cacheDir, { recursive: true });

  // Save tool descriptions
  if (toolCache) {
    const toolCachePath = path.join(cacheDir, 'tools.json');
    await measureSlowOperationAsync(`write cache ${toolCachePath}`, () =>
      fs.writeFile(toolCachePath, jsonStringify(toolCache, null, 2), 'utf-8')
    );
  }

  // Save workspace summary
  if (workspaceSummary) {
    const summaryPath = path.join(cacheDir, 'workspace.json');
    await measureSlowOperationAsync(`write cache ${summaryPath}`, () =>
      fs.writeFile(summaryPath, jsonStringify(workspaceSummary, null, 2), 'utf-8')
    );
  }
}

/**
 * Load cache from disk
 */
export async function loadCacheFromDisk(workspace: string): Promise<void> {
  const cacheDir = path.join(workspace, '.react-engine', 'cache');

  try {
    // Load tool descriptions
    const toolCachePath = path.join(cacheDir, 'tools.json');
    const toolContent = await measureSlowOperationAsync(`read cache ${toolCachePath}`, () =>
      fs.readFile(toolCachePath, 'utf-8')
    );
    const toolCache = jsonParse<ToolDescriptionCache>(toolContent);
    cacheToolDescriptions(toolCache.tools);
  } catch {
    // Cache file doesn't exist or is invalid
  }

  try {
    // Load workspace summary
    const summaryPath = path.join(cacheDir, 'workspace.json');
    const summaryContent = await measureSlowOperationAsync(`read cache ${summaryPath}`, () =>
      fs.readFile(summaryPath, 'utf-8')
    );
    const workspaceSummary = jsonParse<WorkspaceSummary>(summaryContent);
    cacheWorkspaceSummary(workspaceSummary);
  } catch {
    // Cache file doesn't exist or is invalid
  }
}

/**
 * Format cache stats as string
 */
export function formatCacheStats(): string {
  const stats = getCacheStats();
  return [
    '📦 Cache Statistics:',
    `  - Tool Descriptions: ${stats.toolDescriptionsSize} cached`,
    `  - Workspace Summaries: ${stats.workspaceSummariesSize} cached`,
    `  - Total Items: ${stats.totalCacheSize}`,
    `  - Hits/Misses: ${stats.totalHits}/${stats.totalMisses}`,
  ].join('\n');
}
