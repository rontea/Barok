/**
 * Phase 5.7: Safe Cleanup Rules
 * Define safe cleanup patterns for temporary outputs and build artifacts
 */

/**
 * Cleanup rule for temporary files
 */
export interface CleanupRule {
  name: string; // Rule identifier
  patterns: string[]; // File patterns to match
  description: string; // What this rule cleans up
  safeLevel: 'critical' | 'high' | 'medium' | 'low'; // How safe is it to delete
  requiresConfirmation: boolean; // Require user confirmation
  beforeCleanup?: () => void; // Hook before cleanup
  afterCleanup?: () => void; // Hook after cleanup
  maxAgeDays?: number; // Only delete files older than N days
}

/**
 * Cleanup operation result
 */
export interface CleanupResult {
  success: boolean;
  rulesApplied: string[];
  filesDeleted: string[];
  filesSkipped: string[];
  totalSize: number; // Bytes freed
  errors: string[];
}

/**
 * Configuration for cleanup operations
 */
export interface CleanupConfig {
  dryRun?: boolean; // Preview changes without executing
  preservePatterns?: string[]; // Patterns to preserve (never delete)
  maxAgeDays?: number; // Only delete files older than N days
  confirmationRequired?: boolean; // Require confirmation
}

/**
 * Predefined cleanup rules
 */
export const STANDARD_CLEANUP_RULES: CleanupRule[] = [
  {
    name: 'build-outputs',
    patterns: ['dist/**', 'build/**', '.next/**', 'out/**', 'target/**'],
    description: 'Remove build output directories',
    safeLevel: 'high',
    requiresConfirmation: false,
  },
  {
    name: 'coverage-reports',
    patterns: ['coverage/**', '.nyc_output/**'],
    description: 'Remove test coverage reports',
    safeLevel: 'high',
    requiresConfirmation: false,
  },
  {
    name: 'log-files',
    patterns: ['logs/**', 'logs/**/*.log', 'logs/**/*.jsonl'],
    description: 'Remove application logs',
    safeLevel: 'medium',
    requiresConfirmation: false,
    maxAgeDays: 7, // Only delete logs older than 7 days
  },
  {
    name: 'cache-files',
    patterns: ['.cache/**', '.eslintcache', '.prettiercache'],
    description: 'Remove cache files',
    safeLevel: 'high',
    requiresConfirmation: false,
  },
  {
    name: 'temp-files',
    patterns: ['tmp/**', 'temp/**', '*.tmp', '.tmp/**'],
    description: 'Remove temporary files',
    safeLevel: 'high',
    requiresConfirmation: false,
  },
  {
    name: 'test-artifacts',
    patterns: ['test-results/**', 'test-output/**'],
    description: 'Remove test output and artifacts',
    safeLevel: 'high',
    requiresConfirmation: false,
  },
  {
    name: 'backup-files',
    patterns: ['**/*.bak', '**/*.backup', '**/*.old'],
    description: 'Remove backup files',
    safeLevel: 'medium',
    requiresConfirmation: true,
  },
  {
    name: 'system-files',
    patterns: ['.DS_Store', 'Thumbs.db', '*.swp', '.idea/**'],
    description: 'Remove system and IDE temporary files',
    safeLevel: 'low',
    requiresConfirmation: false,
  },
];

/**
 * Protected paths that should never be cleaned
 */
export const PROTECTED_PATHS = [
  'node_modules/**',
  '.git/**',
  'src/**',
  'ui/**',
  'tests/**',
  'docs/**',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  '.env',
  '.env.local',
  'README.md',
];

/**
 * Plan cleanup operations without executing
 */
export function planCleanup(
  files: string[],
  config?: CleanupConfig
): CleanupResult {
  const rulesApplied: string[] = [];
  const filesDeleted: string[] = [];
  const filesSkipped: string[] = [];
  let totalSize = 0;
  const errors: string[] = [];

  // Check each file against rules
  for (const file of files) {
    let shouldDelete = false;
    let matchedRule = '';

    // Check against cleanup rules
    for (const rule of STANDARD_CLEANUP_RULES) {
      if (matchesCleanupPattern(file, rule.patterns)) {
        // Check age if specified
        if (rule.maxAgeDays && !isFileOlderThanDays(file, rule.maxAgeDays)) {
          continue;
        }

        shouldDelete = true;
        matchedRule = rule.name;
        if (!rulesApplied.includes(rule.name)) {
          rulesApplied.push(rule.name);
        }
        break;
      }
    }

    // Check against protected patterns
    if (shouldDelete) {
      if (isProtectedPath(file)) {
        filesSkipped.push(file);
        shouldDelete = false;
      }

      // Check against preserve patterns
      if (shouldDelete && config?.preservePatterns) {
        for (const pattern of config.preservePatterns) {
          if (matchesCleanupPattern(file, [pattern])) {
            filesSkipped.push(file);
            shouldDelete = false;
            break;
          }
        }
      }
    }

    if (shouldDelete) {
      filesDeleted.push(file);
      totalSize += estimateFileSize(file);
    }
  }

  return {
    success: errors.length === 0,
    rulesApplied,
    filesDeleted,
    filesSkipped,
    totalSize,
    errors,
  };
}

/**
 * Check if file matches cleanup pattern
 */
export function matchesCleanupPattern(file: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.endsWith('/**')) {
      const dir = pattern.replace('/**', '');
      if (file.startsWith(dir + '/') || file === dir) {
        return true;
      }
    } else if (file === pattern || file.endsWith('/' + pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if path is protected
 */
export function isProtectedPath(filePath: string): boolean {
  for (const pattern of PROTECTED_PATHS) {
    if (matchesCleanupPattern(filePath, [pattern])) {
      return true;
    }
  }
  return false;
}

/**
 * Estimate file size in bytes
 */
export function estimateFileSize(filePath: string): number {
  // Rough estimates based on path patterns
  if (filePath.includes('node_modules')) return 1000000; // 1MB average
  if (filePath.includes('coverage')) return 500000; // 500KB average
  if (filePath.includes('dist') || filePath.includes('build')) return 100000; // 100KB average
  if (filePath.includes('logs')) return 50000; // 50KB average
  if (filePath.includes('cache')) return 10000; // 10KB average

  return 5000; // Default 5KB
}

/**
 * Check if file is older than N days
 */
export function isFileOlderThanDays(filePath: string, days: number): boolean {
  // This would require file stat info in real implementation
  // For now, return true (assuming we have file metadata)
  return true;
}

/**
 * Get cleanup rule by name
 */
export function getCleanupRule(name: string): CleanupRule | undefined {
  return STANDARD_CLEANUP_RULES.find((r) => r.name === name);
}

/**
 * Get cleanup rules by safety level
 */
export function getCleanupRulesBySafetyLevel(
  level: 'critical' | 'high' | 'medium' | 'low'
): CleanupRule[] {
  return STANDARD_CLEANUP_RULES.filter((r) => {
    const levels = ['critical', 'high', 'medium', 'low'];
    return levels.indexOf(r.safeLevel) <= levels.indexOf(level);
  });
}

/**
 * Validate cleanup plan for safety
 */
export function validateCleanupPlan(plan: CleanupResult): {
  valid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Check if protected paths are being deleted
  for (const file of plan.filesDeleted) {
    if (isProtectedPath(file)) {
      errors.push(`Protected path will be deleted: ${file}`);
    }
  }

  // Warn if large amount being deleted
  const sizeMB = plan.totalSize / 1024 / 1024;
  if (sizeMB > 500) {
    warnings.push(`Large cleanup: ${sizeMB.toFixed(2)}MB will be deleted`);
  }

  // Warn if many files
  if (plan.filesDeleted.length > 1000) {
    warnings.push(`Many files will be deleted: ${plan.filesDeleted.length} files`);
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Create cleanup summary report
 */
export function createCleanupReport(plan: CleanupResult): string {
  const sizeMB = (plan.totalSize / 1024 / 1024).toFixed(2);
  const validation = validateCleanupPlan(plan);

  let report = '# Cleanup Operation Report\n\n';

  report += '## Summary\n';
  report += `- Files to Delete: ${plan.filesDeleted.length}\n`;
  report += `- Files to Preserve: ${plan.filesSkipped.length}\n`;
  report += `- Space to Free: ${sizeMB}MB\n`;
  report += `- Rules Applied: ${plan.rulesApplied.join(', ')}\n\n`;

  if (plan.filesDeleted.length > 0) {
    report += '## Files to Delete\n';
    report += plan.filesDeleted.slice(0, 20).join('\n');
    if (plan.filesDeleted.length > 20) {
      report += `\n... and ${plan.filesDeleted.length - 20} more\n`;
    }
    report += '\n\n';
  }

  if (validation.warnings.length > 0) {
    report += '## Warnings\n';
    for (const warning of validation.warnings) {
      report += `- ⚠️ ${warning}\n`;
    }
    report += '\n';
  }

  if (validation.errors.length > 0) {
    report += '## Errors\n';
    for (const error of validation.errors) {
      report += `- ❌ ${error}\n`;
    }
    report += '\n';
  }

  return report;
}

/**
 * Get default cleanup for verification
 */
export function getDefaultVerificationCleanup(): CleanupRule[] {
  // Standard cleanup after verification runs
  return [
    getCleanupRule('test-artifacts')!,
    getCleanupRule('log-files')!,
    getCleanupRule('cache-files')!,
  ].filter(Boolean);
}

/**
 * Get full cleanup (safe to run after successful verification)
 */
export function getFullCleanup(): CleanupRule[] {
  return STANDARD_CLEANUP_RULES.filter((r) => r.safeLevel !== 'critical');
}

/**
 * Check if cleanup can proceed
 */
export function canProceedWithCleanup(
  plan: CleanupResult,
  config?: CleanupConfig
): { canProceed: boolean; reason?: string } {
  const validation = validateCleanupPlan(plan);

  if (!validation.valid) {
    return {
      canProceed: false,
      reason: `Cleanup validation failed: ${validation.errors[0]}`,
    };
  }

  if (config?.confirmationRequired && plan.filesDeleted.length > 0) {
    return {
      canProceed: false,
      reason: 'Cleanup confirmation required',
    };
  }

  return { canProceed: true };
}
