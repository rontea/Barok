/**
 * Phase 5.6: Generated Artifact Detection
 * Detect and exclude build outputs and temporary files from agent processing
 */

/**
 * Types of generated artifacts
 */
export type ArtifactType = 'build' | 'coverage' | 'logs' | 'cache' | 'temp' | 'node_modules';

/**
 * Generated artifact information
 */
export interface GeneratedArtifact {
  path: string; // e.g., 'dist', 'coverage'
  type: ArtifactType;
  pattern: string; // glob pattern for matching
  description: string;
  safeToDelete?: boolean; // Is it safe to delete
  recreatable?: boolean; // Can be safely regenerated
}

/**
 * Artifact detection result
 */
export interface ArtifactDetectionResult {
  success: boolean;
  artifacts: GeneratedArtifact[];
  sourceFiles: string[]; // Non-artifact files
  errors: string[];
}

/**
 * Configuration for artifact detection
 */
export interface ArtifactDetectionConfig {
  includeNodeModules?: boolean; // Include node_modules in detection
  includeCache?: boolean; // Include .cache, .eslintcache, etc.
  customPatterns?: string[]; // Additional patterns to consider artifacts
}

/**
 * Predefined generated artifact patterns
 */
export const STANDARD_ARTIFACTS: GeneratedArtifact[] = [
  // Build outputs
  {
    path: 'dist',
    type: 'build',
    pattern: 'dist/**',
    description: 'Build output directory',
    safeToDelete: true,
    recreatable: true,
  },
  {
    path: 'build',
    type: 'build',
    pattern: 'build/**',
    description: 'Alternative build output',
    safeToDelete: true,
    recreatable: true,
  },
  {
    path: 'out',
    type: 'build',
    pattern: 'out/**',
    description: 'TypeScript build output',
    safeToDelete: true,
    recreatable: true,
  },
  {
    path: '.next',
    type: 'build',
    pattern: '.next/**',
    description: 'Next.js build output',
    safeToDelete: true,
    recreatable: true,
  },

  // Coverage reports
  {
    path: 'coverage',
    type: 'coverage',
    pattern: 'coverage/**',
    description: 'Test coverage reports',
    safeToDelete: true,
    recreatable: true,
  },
  {
    path: '.nyc_output',
    type: 'coverage',
    pattern: '.nyc_output/**',
    description: 'NYC coverage output',
    safeToDelete: true,
    recreatable: true,
  },

  // Logs
  {
    path: 'logs',
    type: 'logs',
    pattern: 'logs/**',
    description: 'Application logs',
    safeToDelete: true,
    recreatable: false,
  },
  {
    path: '.logs',
    type: 'logs',
    pattern: '.logs/**',
    description: 'Hidden logs directory',
    safeToDelete: true,
    recreatable: false,
  },

  // Cache
  {
    path: '.cache',
    type: 'cache',
    pattern: '.cache/**',
    description: 'General cache directory',
    safeToDelete: true,
    recreatable: true,
  },
  {
    path: '.eslintcache',
    type: 'cache',
    pattern: '.eslintcache',
    description: 'ESLint cache',
    safeToDelete: true,
    recreatable: true,
  },
  {
    path: 'node_modules',
    type: 'node_modules',
    pattern: 'node_modules/**',
    description: 'NPM dependencies',
    safeToDelete: true,
    recreatable: true,
  },

  // Temporary files
  {
    path: 'tmp',
    type: 'temp',
    pattern: 'tmp/**',
    description: 'Temporary files',
    safeToDelete: true,
    recreatable: false,
  },
  {
    path: 'target',
    type: 'build',
    pattern: 'target/**',
    description: 'Gradle/Rust build output',
    safeToDelete: true,
    recreatable: true,
  },
];

/**
 * Detect generated artifacts in file list
 */
export function detectArtifacts(
  files: string[],
  config?: ArtifactDetectionConfig
): ArtifactDetectionResult {
  const artifacts: GeneratedArtifact[] = [];
  const sourceFiles: string[] = [];
  const errors: string[] = [];

  const patternsToCheck = config?.includeCache
    ? STANDARD_ARTIFACTS
    : STANDARD_ARTIFACTS.filter((a) => a.type !== 'cache');

  for (const file of files) {
    let isArtifact = false;

    // Check against standard patterns
    for (const artifact of patternsToCheck) {
      if (matchesPattern(file, artifact.pattern)) {
        if (!artifacts.find((a) => a.path === artifact.path)) {
          artifacts.push(artifact);
        }
        isArtifact = true;
        break;
      }
    }

    // Check custom patterns
    if (!isArtifact && config?.customPatterns) {
      for (const pattern of config.customPatterns) {
        if (matchesPattern(file, pattern)) {
          isArtifact = true;
          break;
        }
      }
    }

    if (!isArtifact) {
      sourceFiles.push(file);
    }
  }

  return {
    success: errors.length === 0,
    artifacts,
    sourceFiles,
    errors,
  };
}

/**
 * Check if file matches artifact pattern
 */
export function matchesPattern(file: string, pattern: string): boolean {
  // Simple glob-like matching
  if (pattern.includes('/**')) {
    const dir = pattern.replace('/**', '');
    return file.startsWith(dir + '/') || file === dir;
  }

  return file === pattern || file.startsWith(pattern + '/');
}

/**
 * Get artifact by type
 */
export function getArtifactsByType(
  type: ArtifactType
): GeneratedArtifact[] {
  return STANDARD_ARTIFACTS.filter((a) => a.type === type);
}

/**
 * Check if path is an artifact
 */
export function isArtifactPath(filePath: string): boolean {
  for (const artifact of STANDARD_ARTIFACTS) {
    if (matchesPattern(filePath, artifact.pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Filter out artifacts from file list
 */
export function filterOutArtifacts(
  files: string[],
  config?: ArtifactDetectionConfig
): string[] {
  const result = detectArtifacts(files, config);
  return result.sourceFiles;
}

/**
 * Get all artifacts that should be deleted on cleanup
 */
export function getDeletableArtifacts(): GeneratedArtifact[] {
  return STANDARD_ARTIFACTS.filter((a) => a.safeToDelete);
}

/**
 * Get recreatable artifacts (can be regenerated)
 */
export function getRecreateableArtifacts(): GeneratedArtifact[] {
  return STANDARD_ARTIFACTS.filter((a) => a.recreatable);
}

/**
 * Estimate artifact disk space
 */
export function estimateArtifactSpace(artifacts: GeneratedArtifact[]): {
  type: string;
  estimatedSizeMB: number;
} {
  // Rough estimates in MB
  const estimates: Record<string, number> = {
    build: 100, // dist/, build/ typically 50-200MB
    coverage: 20, // coverage reports 5-50MB
    logs: 50, // logs can vary 10-200MB
    cache: 30, // cache files 10-100MB
    node_modules: 500, // node_modules typically 200-1000MB
    temp: 10, // temp files
  };

  let totalSize = 0;
  for (const artifact of artifacts) {
    totalSize += estimates[artifact.type] || 50;
  }

  return {
    type: 'artifacts',
    estimatedSizeMB: totalSize,
  };
}

/**
 * Check if artifact is safe to process by agent
 */
export function isSafeForAgentProcessing(filePath: string): boolean {
  // Artifacts should not be edited by agents
  return !isArtifactPath(filePath);
}

/**
 * Mark files that should not be edited
 */
export function getProtectedPaths(): string[] {
  return [
    'node_modules/**',
    'dist/**',
    'build/**',
    'coverage/**',
    'logs/**',
    '.git/**',
    '.gitignore',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
  ];
}

/**
 * Validate that changes don't touch artifacts
 */
export function validateChangesNotInArtifacts(
  changedFiles: string[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const file of changedFiles) {
    if (isArtifactPath(file)) {
      errors.push(`Cannot modify artifact: ${file}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get artifact summary
 */
export function getArtifactSummary(): {
  total: number;
  byType: Record<ArtifactType, number>;
  safe_to_delete: number;
} {
  const byType: Record<ArtifactType, number> = {
    build: 0,
    coverage: 0,
    logs: 0,
    cache: 0,
    temp: 0,
    node_modules: 0,
  };

  let safeToDelete = 0;

  for (const artifact of STANDARD_ARTIFACTS) {
    byType[artifact.type]++;
    if (artifact.safeToDelete) {
      safeToDelete++;
    }
  }

  return {
    total: STANDARD_ARTIFACTS.length,
    byType,
    safe_to_delete: safeToDelete,
  };
}

/**
 * Generate artifact report
 */
export function generateArtifactReport(
  detectionResult: ArtifactDetectionResult
): string {
  let report = '# Generated Artifacts Report\n\n';

  report += `## Summary\n`;
  report += `- Detected Artifacts: ${detectionResult.artifacts.length}\n`;
  report += `- Source Files: ${detectionResult.sourceFiles.length}\n`;
  report += `- Detection Status: ${detectionResult.success ? 'Success' : 'Failed'}\n\n`;

  if (detectionResult.artifacts.length > 0) {
    report += '## Artifacts Found\n\n';
    for (const artifact of detectionResult.artifacts) {
      report += `### ${artifact.path}\n`;
      report += `- Type: ${artifact.type}\n`;
      report += `- Description: ${artifact.description}\n`;
      report += `- Safe to Delete: ${artifact.safeToDelete ? 'Yes' : 'No'}\n`;
      report += `- Recreatable: ${artifact.recreatable ? 'Yes' : 'No'}\n\n`;
    }
  }

  return report;
}
