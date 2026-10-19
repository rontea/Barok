/**
 * Phase 3.2 - Work Plan Integration with Phase 2 Context
 * Combines module responsibilities, dependency signals, and dirty tree awareness
 * into comprehensive work plans with full repository context
 */

import type { ModuleResponsibility } from './moduleResponsibilities.js';
import type { DependencySignal, DependencyGraphQuery } from './dependencyGraph.js';
import type { DirtyTreeState } from './dirtyTreeTracker.js';
import type { OverwriteCheckResult } from './overwritePreventionPlan.js';
import type { FullStackWorkPlan, FileOwnership } from './workPlanOrchestrator.js';

/**
 * Context-aware work plan with Phase 2 integration
 */
export interface IntegratedWorkPlan extends Omit<FullStackWorkPlan, 'dirtyTreeWarnings' | 'overwriteCheckResult'> {
  // Phase 2 context integration
  moduleContext: ModuleResponsibility[]; // Modules involved in this work
  relevantDependencies: DependencySignal[]; // Dependencies between touched modules
  impactedModules: {
    module: ModuleResponsibility;
    impactType: 'direct' | 'transitive' | 'dependent'; // How this module is affected
    reason: string;
  }[];
  dirtyTreeWarnings: {
    file: string;
    status: string; // 'modified' | 'added' | 'deleted'
    conflictSeverity: 'critical' | 'high' | 'medium' | 'low';
    suggestion: string;
  }[];
  overwriteCheckResult: OverwriteCheckResult | null;
  contextualOwnership: {
    file: string;
    owner: string;
    reason: 'module-boundary' | 'path-pattern' | 'historical' | 'expertise';
    confidence: 'high' | 'medium' | 'low';
    relatedModule?: string;
  }[];
  dependencyImpactAnalysis: {
    directlyAffected: string[]; // Files we're changing
    transitivelyAffected: string[]; // Files that depend on changed files
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    reason: string;
  };
  safetyAssessment: {
    hasConflicts: boolean;
    canProceedWithApproval: boolean;
    requiresManualReview: boolean;
    escalationPath?: string;
  };
}

/**
 * Integration context combining all Phase 2 systems
 */
export interface Phase2Context {
  modules: ModuleResponsibility[];
  dependencyGraph: DependencyGraphQuery;
  dirtyTree: DirtyTreeState;
  overwriteCheck: OverwriteCheckResult;
}

/**
 * Enriches file ownership with module boundary information
 */
export function assignContextualOwnership(
  files: string[],
  modules: ModuleResponsibility[]
): Array<{
  file: string;
  owner: string;
  reason: 'module-boundary' | 'path-pattern';
  confidence: 'high' | 'medium';
  relatedModule?: string;
}> {
  return files.map((file) => {
    // Find module that owns this file
    for (const module of modules) {
      if (file.startsWith(module.path)) {
        // Determine owner from module layer
        const ownerMap: Record<string, string> = {
          frontend: 'frontend',
          backend: 'backend',
          data: 'data',
          tests: 'test',
          docs: 'documentation',
          'vscode-extension': 'vscode-extension',
        };

        return {
          file,
          owner: ownerMap[module.layer] || 'backend',
          reason: 'module-boundary' as const,
          confidence: 'high' as const,
          relatedModule: module.name,
        };
      }
    }

    // Fallback to path patterns
    const pathOwnerMap: Record<string, string> = {
      'ui/': 'frontend',
      'src/': 'backend',
      'tests/': 'test',
      'docs/': 'documentation',
      'vscode-extension/': 'vscode-extension',
      'data/': 'data',
    };

    for (const [pattern, owner] of Object.entries(pathOwnerMap)) {
      if (file.startsWith(pattern)) {
        return {
          file,
          owner,
          reason: 'path-pattern' as const,
          confidence: 'medium' as const,
        };
      }
    }

    return {
      file,
      owner: 'backend', // Default
      reason: 'path-pattern' as const,
      confidence: 'medium' as const,
    };
  });
}

/**
 * Analyzes transitive impact through dependency graph
 */
export function analyzeDependencyImpact(
  affectedFiles: string[],
  dependencyGraph: DependencyGraphQuery
): {
  directlyAffected: string[];
  transitivelyAffected: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
} {
  const directlyAffected = affectedFiles;
  const transitivelyAffected = new Set<string>();

  // Find all files that depend on our changes
  for (const file of affectedFiles) {
    const dependents = dependencyGraph.getSignalsTo(file) || [];
    for (const signal of dependents) {
      if (signal.type === 'import') {
        transitivelyAffected.add(signal.source);
      }
    }
  }

  // Assess risk based on transitive impact
  const transitiveCount = transitivelyAffected.size;
  let riskLevel: 'low' | 'medium' | 'high' | 'critical';
  let reason = '';

  if (transitiveCount === 0) {
    riskLevel = 'low';
    reason = 'Changes are isolated with no dependents';
  } else if (transitiveCount <= 3) {
    riskLevel = 'medium';
    reason = `${transitiveCount} files depend on changes`;
  } else if (transitiveCount <= 10) {
    riskLevel = 'high';
    reason = `${transitiveCount} files depend on changes, potential cascade`;
  } else {
    riskLevel = 'critical';
    reason = `${transitiveCount}+ files depend on changes, significant cascade risk`;
  }

  return {
    directlyAffected,
    transitivelyAffected: Array.from(transitivelyAffected),
    riskLevel,
    reason,
  };
}

/**
 * Identifies modules affected by planned changes
 */
export function identifyAffectedModules(
  affectedFiles: string[],
  modules: ModuleResponsibility[]
): Array<{
  module: ModuleResponsibility;
  impactType: 'direct' | 'transitive' | 'dependent';
  reason: string;
}> {
  const affected: Array<{
    module: ModuleResponsibility;
    impactType: 'direct' | 'transitive' | 'dependent';
    reason: string;
  }> = [];
  const seenModules = new Set<string>();

  for (const file of affectedFiles) {
    for (const module of modules) {
      if (
        file.startsWith(module.path) &&
        !seenModules.has(module.name)
      ) {
        affected.push({
          module,
          impactType: 'direct',
          reason: `File ${file} belongs to this module`,
        });
        seenModules.add(module.name);
      }
    }
  }

  return affected;
}

/**
 * Creates dirty tree warnings specific to work plan
 */
export function createDirtyTreeWarnings(
  affectedFiles: string[],
  dirtyTree: DirtyTreeState
): Array<{
  file: string;
  status: string;
  conflictSeverity: 'critical' | 'high' | 'medium' | 'low';
  suggestion: string;
}> {
  const warnings: Array<{
    file: string;
    status: string;
    conflictSeverity: 'critical' | 'high' | 'medium' | 'low';
    suggestion: string;
  }> = [];

  // Check for overlaps between planned changes and dirty files
  for (const plannedFile of affectedFiles) {
    const dirtyFile = dirtyTree.files.find((df) => df.path === plannedFile);

    if (dirtyFile) {
      let severity: 'critical' | 'high' | 'medium' | 'low' = 'high';

      // Core files get critical severity
      const coreFiles = [
        'package.json',
        'tsconfig.json',
        'vite.config.ts',
        'jest.config.cjs',
      ];
      if (coreFiles.includes(plannedFile)) {
        severity = 'critical';
      }

      // Test files get lower severity
      if (plannedFile.includes('.test.ts') || plannedFile.includes('.spec.ts')) {
        severity = 'medium';
      }

      warnings.push({
        file: plannedFile,
        status: dirtyFile.status,
        conflictSeverity: severity,
        suggestion:
          severity === 'critical'
            ? 'BLOCKING: This core file has uncommitted changes. Commit or stash before proceeding.'
            : severity === 'high'
              ? 'WARNING: File has uncommitted changes. Plan will overwrite. Approval required.'
              : 'INFO: File has uncommitted changes but impact is limited.',
      });
    }
  }

  return warnings;
}

/**
 * Creates integrated work plan combining Phase 2 and Phase 3 context
 */
export function createIntegratedWorkPlan(
  basePlan: FullStackWorkPlan,
  context: Phase2Context
): IntegratedWorkPlan {
  // Extract file paths from PlannedChange objects
  const affectedFilePaths = basePlan.affectedFiles.map((change) => 
    typeof change === 'string' ? change : change.file
  );

  // Identify affected modules
  const affectedModules = identifyAffectedModules(
    affectedFilePaths,
    context.modules
  );

  // Analyze dependency impact
  const dependencyImpact = analyzeDependencyImpact(
    affectedFilePaths,
    context.dependencyGraph
  );

  // Get relevant dependency signals
  const relevantSignals: DependencySignal[] = [];
  for (const file of affectedFilePaths) {
    const signals = context.dependencyGraph.getSignalsFrom(file) || [];
    relevantSignals.push(...signals);
  }

  // Create dirty tree warnings
  const dirtyWarnings = createDirtyTreeWarnings(
    affectedFilePaths,
    context.dirtyTree
  );

  // Assign contextual ownership
  const contextualOwnership = assignContextualOwnership(
    affectedFilePaths,
    context.modules
  );

  // Assess safety
  const safetyAssessment = {
    hasConflicts: context.overwriteCheck.hasConflicts,
    canProceedWithApproval:
      context.overwriteCheck.mergeStrategy !== 'abort' ||
      dirtyWarnings.every((w) => w.conflictSeverity !== 'critical'),
    requiresManualReview:
      dependencyImpact.riskLevel === 'high' ||
      dependencyImpact.riskLevel === 'critical' ||
      dirtyWarnings.some((w) => w.conflictSeverity === 'critical'),
    escalationPath:
      dependencyImpact.riskLevel === 'critical'
        ? 'ESCALATE: High-risk transitive impact'
        : undefined,
  };

  return {
    ...basePlan,
    moduleContext: context.modules,
    relevantDependencies: relevantSignals,
    impactedModules: affectedModules,
    dirtyTreeWarnings: dirtyWarnings,
    overwriteCheckResult: context.overwriteCheck,
    contextualOwnership,
    dependencyImpactAnalysis: dependencyImpact,
    safetyAssessment,
  };
}

/**
 * Validates integrated work plan against Phase 2 context
 */
export function validateIntegratedWorkPlan(
  plan: IntegratedWorkPlan
): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check critical dirty tree conflicts
  const criticalDirtyFiles = plan.dirtyTreeWarnings.filter(
    (w) => w.conflictSeverity === 'critical'
  );
  if (criticalDirtyFiles.length > 0) {
    errors.push(
      `${criticalDirtyFiles.length} critical dirty file conflict(s): ${criticalDirtyFiles.map((w) => w.file).join(', ')}`
    );
  }

  // Check overwrite conflicts
  if (plan.overwriteCheckResult?.hasConflicts) {
    if (
      plan.overwriteCheckResult.mergeStrategy === 'abort'
    ) {
      errors.push(
        `Cannot proceed: ${plan.overwriteCheckResult.conflicts.length} unresolvable conflict(s)`
      );
    } else {
      warnings.push(
        `Merge strategy: ${plan.overwriteCheckResult.mergeStrategy}. ${plan.overwriteCheckResult.conflicts.length} conflict(s) detected.`
      );
    }
  }

  // Check module coverage
  if (plan.impactedModules.length === 0 && plan.affectedFiles.length > 0) {
    warnings.push('No modules identified for affected files - may indicate path mapping issue');
  }

  // Check dependency impact
  if (plan.dependencyImpactAnalysis.riskLevel === 'critical') {
    warnings.push(
      `CRITICAL: ${plan.dependencyImpactAnalysis.transitivelyAffected.length} files transitively affected - detailed testing required`
    );
  }

  // Ownership validation
  const unownedFiles = plan.contextualOwnership.filter(
    (o) => o.confidence === 'low'
  );
  if (unownedFiles.length > 0) {
    warnings.push(
      `${unownedFiles.length} file(s) with low-confidence ownership assignment`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Formats integrated work plan for display with Phase 2 context
 */
export function summarizeIntegratedWorkPlan(plan: IntegratedWorkPlan): string[] {
  const lines: string[] = [];

  lines.push('╔════════════════════════════════════════════════════════════╗');
  lines.push('║        INTEGRATED FULL-STACK WORK PLAN (Phase 2 + 3)       ║');
  lines.push('╚════════════════════════════════════════════════════════════╝');

  // Request and classification
  lines.push('');
  lines.push(`📋 REQUEST: ${plan.userRequest}`);
  lines.push(`🏷️  CLASSIFICATION: ${plan.classification}`);
  lines.push(`⚠️  COMPLEXITY: ${plan.estimatedComplexity}`);

  // Module context
  if (plan.impactedModules.length > 0) {
    lines.push('');
    lines.push('📦 MODULES AFFECTED:');
    for (const impact of plan.impactedModules) {
      lines.push(`   • ${impact.module.name} (${impact.impactType})`);
      lines.push(`     ${impact.reason}`);
    }
  }

  // Dependency impact
  lines.push('');
  lines.push('🔗 DEPENDENCY IMPACT:');
  lines.push(
    `   Directly Modified: ${plan.dependencyImpactAnalysis.directlyAffected.length} file(s)`
  );
  lines.push(
    `   Transitively Affected: ${plan.dependencyImpactAnalysis.transitivelyAffected.length} file(s)`
  );
  lines.push(`   Risk Level: ${plan.dependencyImpactAnalysis.riskLevel.toUpperCase()}`);
  lines.push(`   ${plan.dependencyImpactAnalysis.reason}`);

  // Dirty tree warnings
  if (plan.dirtyTreeWarnings.length > 0) {
    lines.push('');
    lines.push('⚠️  DIRTY TREE WARNINGS:');
    for (const warning of plan.dirtyTreeWarnings) {
      const icon =
        warning.conflictSeverity === 'critical'
          ? '🚫'
          : warning.conflictSeverity === 'high'
            ? '⛔'
            : '⚠️';
      lines.push(`   ${icon} [${warning.conflictSeverity.toUpperCase()}] ${warning.file}`);
      lines.push(`      ${warning.suggestion}`);
    }
  }

  // Ownership
  if (plan.contextualOwnership.length > 0) {
    lines.push('');
    lines.push('👥 FILE OWNERSHIP (Module-Aware):');
    const groupedByOwner = plan.contextualOwnership.reduce(
      (acc, item) => {
        if (!acc[item.owner]) acc[item.owner] = [];
        acc[item.owner].push(item);
        return acc;
      },
      {} as Record<string, typeof plan.contextualOwnership>
    );

    for (const [owner, files] of Object.entries(groupedByOwner)) {
      lines.push(`   ${owner}:`);
      for (const file of files) {
        lines.push(`     • ${file.file} (${file.reason})`);
        if (file.relatedModule) {
          lines.push(`       → ${file.relatedModule}`);
        }
      }
    }
  }

  // Safety assessment
  lines.push('');
  lines.push('🔒 SAFETY ASSESSMENT:');
  lines.push(
    `   Conflicts: ${plan.safetyAssessment.hasConflicts ? '⚠️  YES' : '✅ NO'}`
  );
  lines.push(
    `   Can Proceed: ${plan.safetyAssessment.canProceedWithApproval ? '✅ YES' : '❌ NO'}`
  );
  lines.push(
    `   Manual Review: ${plan.safetyAssessment.requiresManualReview ? '🔍 REQUIRED' : 'Not needed'}`
  );
  if (plan.safetyAssessment.escalationPath) {
    lines.push(`   ${plan.safetyAssessment.escalationPath}`);
  }

  // Execution plan
  lines.push('');
  lines.push('🎯 EXECUTION PLAN:');
  lines.push(`   Strategy: ${plan.executionStrategy}`);
  lines.push(`   Layers: ${plan.touchedLayers.join(', ')}`);
  lines.push(`   Files: ${plan.affectedFiles.length}`);

  lines.push('');
  lines.push('╔════════════════════════════════════════════════════════════╗');

  return lines;
}
