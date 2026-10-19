import { scanDirtyTree, type DirtyTreeState } from './dirty-tree-scanner.js';

/** Dirty tree cache entry. */
export interface DirtyTreeCacheEntry {
  state: DirtyTreeState;
  hash: string;
  cachedAt: number;
  ttlMs: number;
}

const dirtyTreeCache = new Map<string, DirtyTreeCacheEntry>();

function hashDirtyTreeState(state: DirtyTreeState): string {
  const fileHashes = state.files.map((file) => `${file.path}:${file.status}`).join('|');
  return `${state.totalChanges}:${fileHashes}`;
}

/** Return a cached Git workspace snapshot or scan and cache it. */
export function getDirtyTreeState(repoRoot: string, ttlMs = 60_000): DirtyTreeState {
  const cached = dirtyTreeCache.get(repoRoot);
  if (cached && Date.now() - cached.cachedAt < cached.ttlMs) return cached.state;

  const state = scanDirtyTree(repoRoot);
  dirtyTreeCache.set(repoRoot, {
    state,
    hash: hashDirtyTreeState(state),
    cachedAt: Date.now(),
    ttlMs,
  });
  return state;
}

/** Invalidate one repository snapshot or clear every cached workspace. */
export function invalidateDirtyTreeCache(repoRoot?: string): void {
  if (repoRoot) dirtyTreeCache.delete(repoRoot);
  else dirtyTreeCache.clear();
}
