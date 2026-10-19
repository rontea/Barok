/**
 * Dirty Working Tree Tracker
 * Tracks uncommitted changes and maps them to affected modules and agents
 */

import type {
  DirtyFileStatus,
  DirtyTreeState,
} from '@barok/adapter-node';
export {
  getFileDiff,
  getGitStatus,
  getUntrackedFiles,
  scanDirtyTree,
} from '@barok/adapter-node';
export type {
  ChangeHunk,
  DirtyFileStatus,
  DirtyTreeState,
  FileChangeStatus,
} from '@barok/adapter-node';
export {
  getDirtyTreeState,
  invalidateDirtyTreeCache,
} from '@barok/adapter-node';
export type { DirtyTreeCacheEntry } from '@barok/adapter-node';

/**
 * Maps dirty files to affected agent roles
 * Uses module boundaries and file ownership
 */
export function mapDirtyFilesToAgents(files: DirtyFileStatus[]): Map<string, DirtyFileStatus[]> {
  const agentFiles = new Map<string, DirtyFileStatus[]>();

  const agentRoles = ['frontend', 'backend', 'data', 'test', 'reviewer', 'documentation'];

  for (const role of agentRoles) {
    agentFiles.set(role, []);
  }

  for (const file of files) {
    // Route based on file path
    if (file.path.startsWith('ui/') || file.path.includes('tsx') || file.path.includes('jsx')) {
      agentFiles.get('frontend')?.push(file);
    } else if (
      file.path.startsWith('src/') &&
      !file.path.includes('test') &&
      !file.path.includes('spec')
    ) {
      agentFiles.get('backend')?.push(file);
    } else if (file.path.startsWith('tests/') || file.path.includes('.test.') || file.path.includes('.spec.')) {
      agentFiles.get('test')?.push(file);
    } else if (file.path.startsWith('docs/') || file.path.includes('README')) {
      agentFiles.get('documentation')?.push(file);
    } else if (file.path.includes('data') || file.path.includes('db') || file.path.includes('migration')) {
      agentFiles.get('data')?.push(file);
    } else {
      // Unknown category - assign to reviewer for triage
      agentFiles.get('reviewer')?.push(file);
    }
  }

  return agentFiles;
}

/**
 * Finds which files would be affected by changes to a set of files
 * Uses dependency graph to find transitive impacts
 */
export function findAffectedFiles(
  sourceFiles: string[],
  dependencyMap: Map<string, string[]>
): Set<string> {
  const affected = new Set<string>(sourceFiles);
  const toCheck = [...sourceFiles];

  while (toCheck.length > 0) {
    const current = toCheck.pop()!;
    const dependents = dependencyMap.get(current) || [];

    for (const dependent of dependents) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        toCheck.push(dependent);
      }
    }
  }

  return affected;
}

/**
 * Checks if a planned change would overwrite any dirty files
 */
export function detectOverlapWithDirtyFiles(
  plannedFiles: string[],
  dirtyFiles: DirtyFileStatus[]
): DirtyFileStatus[] {
  const dirtyPaths = dirtyFiles.map((f) => f.path);
  return dirtyFiles.filter((f) => plannedFiles.includes(f.path) || plannedFiles.some(
    (p) => p === f.path || p.startsWith(f.path.split('/')[0] + '/')
  ));
}

/**
 * Creates a summary of dirty tree status for context packs
 */
export function createDirtyTreeWarning(state: DirtyTreeState): string[] {
  const warnings: string[] = [];

  if (!state.isDirty) {
    return [];
  }

  warnings.push(
    `⚠️  Working tree is dirty: ${state.totalChanges} files have uncommitted changes`
  );

  if (state.modifiedCount > 0) {
    warnings.push(`  - Modified: ${state.modifiedCount} files`);
  }
  if (state.addedCount > 0) {
    warnings.push(`  - Added: ${state.addedCount} files`);
  }
  if (state.deletedCount > 0) {
    warnings.push(`  - Deleted: ${state.deletedCount} files`);
  }
  if (state.untrackedCount > 0) {
    warnings.push(`  - Untracked: ${state.untrackedCount} files`);
  }

  warnings.push('⚠️  Planned changes may overwrite uncommitted work!');
  warnings.push('💡 Consider committing changes or creating a new branch first.');

  return warnings;
}

/**
 * Merges dirty tree status with planned changes to show impact
 */
export interface MergeImpactAnalysis {
  hasConflicts: boolean;
  conflicts: DirtyFileStatus[]; // Dirty files that will be overwritten
  safeToMerge: boolean; // Can proceed without data loss
  recommendations: string[];
}

export function analyzeMergeImpact(
  plannedFiles: string[],
  dirtyTree: DirtyTreeState
): MergeImpactAnalysis {
  const conflicts = detectOverlapWithDirtyFiles(plannedFiles, dirtyTree.files);
  const hasConflicts = conflicts.length > 0;

  const recommendations: string[] = [];

  if (hasConflicts) {
    recommendations.push(
      `❌ ${conflicts.length} file(s) have uncommitted changes and will be overwritten`
    );
    recommendations.push('Please commit or stash these changes:');
    for (const conflict of conflicts) {
      recommendations.push(`  - ${conflict.path}`);
    }
  }

  if (plannedFiles.length > 5 && dirtyTree.totalChanges > 0) {
    recommendations.push(
      '⚠️  Large number of changes planned with dirty tree - high risk of conflicts'
    );
  }

  return {
    hasConflicts,
    conflicts,
    safeToMerge: !hasConflicts,
    recommendations,
  };
}
