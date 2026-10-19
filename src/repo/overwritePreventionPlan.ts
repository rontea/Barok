/**
 * Overwrite Prevention Plan
 * Validates planned changes against dirty files and provides safe merge strategies
 */

import type { DirtyFileStatus, DirtyTreeState } from './dirtyTreeTracker.js';

/**
 * Merge strategy for handling conflicts
 */
export type MergeStrategy = 'abort' | 'warn' | 'merge-careful' | 'merge-force';

/**
 * Conflict type classifications
 */
export type ConflictType = 'direct-overwrite' | 'cascading' | 'dependency' | 'partial-overlap' | 'scheduling';

/**
 * Individual conflict entry
 */
export interface ConflictEntry {
  type: ConflictType;
  file: string; // File path
  plannedChange: string; // What we plan to do
  dirtyStatus: string; // What's uncommitted
  severity: 'critical' | 'high' | 'medium' | 'low';
  suggestion: string; // How to resolve
}

/**
 * Overwrite check result
 */
export interface OverwriteCheckResult {
  canProceed: boolean; // Safe to proceed?
  hasConflicts: boolean; // Are there conflicts?
  conflicts: ConflictEntry[]; // Detailed conflicts
  warnings: string[]; // User-friendly warnings
  suggestions: string[]; // Resolution suggestions
  mergeStrategy: MergeStrategy; // Recommended strategy
  requiresApproval: boolean; // User approval needed?
  approvalReason?: string; // Why approval is needed
  safetyScore: number; // 0-100 safety rating
}

/**
 * Planned change specification
 */
export interface PlannedChange {
  file: string; // File to modify
  type: 'create' | 'modify' | 'delete';
  description?: string; // What's being changed
  priority?: 'low' | 'medium' | 'high';
}

/**
 * Validates that planned changes don't overwrite dirty files
 */
export function validatePlannedChanges(
  plannedChanges: PlannedChange[],
  dirtyTree: DirtyTreeState
): OverwriteCheckResult {
  const conflicts: ConflictEntry[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];
  let hasConflicts = false;
  let mergeStrategy: MergeStrategy = 'abort';
  let safetyScore = 100;

  // Check each planned change against dirty files
  for (const planned of plannedChanges) {
    const dirtyFile = dirtyTree.files.find((f) => f.path === planned.file);

    if (dirtyFile) {
      hasConflicts = true;
      safetyScore -= 25;

      // Determine conflict type and severity
      let severity: 'critical' | 'high' | 'medium' | 'low' = 'high';
      let suggestion = '';

      if (planned.type === 'delete' && dirtyFile.status === 'modified') {
        severity = 'critical';
        suggestion = `File has uncommitted modifications. Use 'git diff ${planned.file}' to review, then commit or stash before deletion.`;
      } else if (planned.type === 'modify' && dirtyFile.status === 'modified') {
        severity = 'high';
        suggestion = `File has uncommitted modifications. Review with 'git diff', then commit or stash to prevent loss.`;
      } else if (planned.type === 'create' && dirtyFile.status === 'untracked') {
        severity = 'medium';
        suggestion = `Untracked file exists. Consider renaming the planned file or committing the untracked one.`;
      } else if (planned.type === 'modify' && dirtyFile.status === 'added') {
        severity = 'high';
        suggestion = `Newly added file has uncommitted changes. Commit it first or use a different approach.`;
      }

      conflicts.push({
        type: 'direct-overwrite',
        file: planned.file,
        plannedChange: `${planned.type} (${planned.description || 'no description'})`,
        dirtyStatus: dirtyFile.status,
        severity,
        suggestion,
      });
    }
  }

  // Detect cascading conflicts (e.g., modifying a file that's imported by a dirty file)
  if (dirtyTree.files.length > 0 && plannedChanges.length > 0) {
    const potentialCascades = detectCascadingConflicts(plannedChanges, dirtyTree);
    if (potentialCascades.length > 0) {
      conflicts.push(...potentialCascades);
      hasConflicts = true;
      safetyScore -= 10 * potentialCascades.length;
    }
  }

  // Generate warnings
  if (hasConflicts) {
    warnings.push(`❌ ${conflicts.length} conflict(s) detected between planned changes and dirty files`);
    
    const criticalConflicts = conflicts.filter((c) => c.severity === 'critical');
    if (criticalConflicts.length > 0) {
      warnings.push(`⚠️  ${criticalConflicts.length} CRITICAL conflict(s) - these changes may cause data loss`);
    }

    // Merge strategy decision
    const highSeverity = conflicts.filter((c) => c.severity === 'critical' || c.severity === 'high');
    if (highSeverity.length > 0) {
      mergeStrategy = 'abort';
      suggestions.push('Recommended: Resolve conflicts first, then retry planning.');
      suggestions.push('Option 1: Commit all dirty files (git add . && git commit -m "...")');
      suggestions.push('Option 2: Stash dirty changes (git stash) and retry planning');
    } else {
      mergeStrategy = 'merge-careful';
      suggestions.push('Low-risk conflicts detected. Proceed with caution.');
      suggestions.push('Review all conflicts and approve each one before applying changes.');
    }
  } else {
    warnings.push('✅ No conflicts detected - safe to proceed');
    mergeStrategy = 'merge-force';
    safetyScore = 100;
  }

  // Large number of changes with dirty tree warning
  if (plannedChanges.length > 10 && dirtyTree.totalChanges > 0) {
    safetyScore = Math.max(0, safetyScore - 20);
    warnings.push(
      `⚠️  Large change set (${plannedChanges.length} files) with significant dirty tree (${dirtyTree.totalChanges} files)`
    );
    suggestions.push('Consider breaking this into smaller, safer changes.');
  }

  // Ensure safety score is in valid range
  safetyScore = Math.max(0, Math.min(100, safetyScore));

  const canProceedValue = mergeStrategy !== 'abort' && !hasConflicts;

  return {
    canProceed: canProceedValue,
    hasConflicts,
    conflicts,
    warnings,
    suggestions,
    mergeStrategy,
    requiresApproval: hasConflicts || safetyScore < 80,
    approvalReason: hasConflicts
      ? `${conflicts.length} conflict(s) detected - manual review required`
      : safetyScore < 80
        ? `Safety score below 80% (current: ${safetyScore}%) - caution advised`
        : undefined,
    safetyScore,
  };
}

/**
 * Detects cascading conflicts where changes might break dirty files
 */
function detectCascadingConflicts(
  plannedChanges: PlannedChange[],
  dirtyTree: DirtyTreeState
): ConflictEntry[] {
  const cascades: ConflictEntry[] = [];

  // This is a simplified detection - could be enhanced with actual dependency analysis
  for (const planned of plannedChanges) {
    // Check if this is a core infrastructure file (would affect many things)
    const isCoreFile = isCoreDependency(planned.file);

    if (isCoreFile && dirtyTree.totalChanges > 0) {
      cascades.push({
        type: 'cascading',
        file: planned.file,
        plannedChange: `${planned.type} core infrastructure file`,
        dirtyStatus: `${dirtyTree.totalChanges} dirty files exist`,
        severity: 'high',
        suggestion: `Core dependency change detected. Changes to ${planned.file} may affect dirty files. Ensure all dirty changes are compatible or committed first.`,
      });
    }
  }

  return cascades;
}

/**
 * Checks if a file is a core dependency that affects many other files
 */
function isCoreDependency(filePath: string): boolean {
  const coreDependencies = [
    'package.json',
    'tsconfig.json',
    'vite.config',
    'jest.config',
    '.env',
  ];

  // Use exact matching for these files, not substring matching
  return coreDependencies.some(
    (dep) =>
      filePath.endsWith(dep) ||
      filePath === dep ||
      // Match vite.config.ts, vite.config.js, etc.
      (dep === 'vite.config' && /^vite\.config\.(ts|js)$/.test(filePath.split('/').pop() || '')) ||
      (dep === 'jest.config' && /^jest\.config\.(cjs|ts|js)$/.test(filePath.split('/').pop() || ''))
  );
}

/**
 * Selects optimal merge strategy based on conflict analysis
 */
export function selectMergeStrategy(result: OverwriteCheckResult): MergeStrategy {
  if (result.conflicts.length === 0) {
    return 'merge-force';
  }

  const criticalCount = result.conflicts.filter((c) => c.severity === 'critical').length;
  const highCount = result.conflicts.filter((c) => c.severity === 'high').length;

  if (criticalCount > 0 || highCount > 2) {
    return 'abort';
  }

  if (highCount > 0) {
    return 'merge-careful';
  }

  return 'warn';
}

/**
 * Refines a plan by excluding dirty files unless explicitly approved
 */
export interface RefinedPlan {
  original: PlannedChange[];
  refined: PlannedChange[];
  excluded: PlannedChange[];
  notes: string[];
}

export function refinePlanExcludingDirtyFiles(
  plannedChanges: PlannedChange[],
  dirtyTree: DirtyTreeState,
  approvedConflicts: string[] = [] // File paths approved by user
): RefinedPlan {
  const refined: PlannedChange[] = [];
  const excluded: PlannedChange[] = [];
  const notes: string[] = [];
  const dirtyPaths = dirtyTree.files.map((f) => f.path);

  for (const planned of plannedChanges) {
    const isDirty = dirtyPaths.includes(planned.file);
    const isApproved = approvedConflicts.includes(planned.file);

    if (isDirty && !isApproved) {
      excluded.push(planned);
      notes.push(`⊘ Excluded: ${planned.file} (dirty: ${dirtyTree.files.find((f) => f.path === planned.file)?.status})`);
    } else if (isDirty && isApproved) {
      refined.push(planned);
      notes.push(`✓ Approved: ${planned.file} (overwriting dirty changes)`);
    } else {
      refined.push(planned);
    }
  }

  if (excluded.length > 0) {
    notes.unshift(
      `Excluded ${excluded.length} file(s) with uncommitted changes. Use approvedConflicts to override.`
    );
  }

  return {
    original: plannedChanges,
    refined,
    excluded,
    notes,
  };
}

/**
 * User approval workflow for conflicts
 */
export interface ApprovalRequest {
  checksum: string; // Unique ID for this set of conflicts
  conflicts: ConflictEntry[];
  strategy: MergeStrategy;
  userNotes?: string; // Why user is approving/rejecting
  approved: boolean;
  approvedAt?: number; // Timestamp
}

/**
 * Creates an approval request for user review
 */
export function createApprovalRequest(
  result: OverwriteCheckResult,
  sessionId: string
): ApprovalRequest {
  const conflictStr = result.conflicts
    .map((c) => `${c.file}:${c.type}:${c.severity}`)
    .sort()
    .join('|');
  const checksum = `${sessionId}:${Buffer.from(conflictStr).toString('base64')}`;

  return {
    checksum,
    conflicts: result.conflicts,
    strategy: result.mergeStrategy,
    approved: false,
  };
}

/**
 * Generates a user-friendly summary of overwrite check
 */
export function generateOverwriteSummary(result: OverwriteCheckResult): string[] {
  const lines: string[] = [];

  lines.push('╔════════════════════════════════════════════════════════════╗');
  lines.push('║           OVERWRITE PREVENTION CHECK RESULT                ║');
  lines.push('╚════════════════════════════════════════════════════════════╝');
  lines.push('');

  // Status
  const statusIcon = result.canProceed ? '✅' : '❌';
  const statusText = result.canProceed ? 'SAFE TO PROCEED' : 'BLOCKED';
  lines.push(`${statusIcon} Status: ${statusText}`);
  lines.push(`📊 Safety Score: ${result.safetyScore}/100`);
  lines.push('');

  // Conflicts summary
  if (result.hasConflicts) {
    lines.push(`⚠️  Conflicts Detected: ${result.conflicts.length}`);
    for (const conflict of result.conflicts) {
      const icon = conflict.severity === 'critical' ? '🔴' : conflict.severity === 'high' ? '🟠' : '🟡';
      lines.push(`   ${icon} [${conflict.severity.toUpperCase()}] ${conflict.file}`);
      lines.push(`       → ${conflict.suggestion}`);
    }
    lines.push('');
  }

  // Warnings
  if (result.warnings.length > 0) {
    lines.push('⚠️  Warnings:');
    for (const warning of result.warnings) {
      lines.push(`   • ${warning}`);
    }
    lines.push('');
  }

  // Suggestions
  if (result.suggestions.length > 0) {
    lines.push('💡 Suggestions:');
    for (const suggestion of result.suggestions) {
      lines.push(`   • ${suggestion}`);
    }
    lines.push('');
  }

  // Strategy
  lines.push(`📋 Recommended Strategy: ${result.mergeStrategy}`);
  if (result.requiresApproval) {
    lines.push(`🔐 User Approval Required: ${result.approvalReason}`);
  }
  lines.push('');

  return lines;
}
