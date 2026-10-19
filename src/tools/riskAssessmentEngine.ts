/**
 * Risk Assessment Engine - Phase 8.5
 * Analyzes code changes for risk factors including complexity, dependencies, side effects, and risky patterns.
 */

/**
 * Represents the complexity metrics of a code file
 */
export interface CodeComplexity {
  cyclomaticComplexity: number; // 1-10+ scale
  linesOfCode: number;
  functionCount: number;
  nestedDepth: number;
  hasGlobalState: boolean;
  hasSideEffects: boolean;
}

/**
 * Represents a dependency in the codebase
 */
export interface Dependency {
  source: string;
  target: string;
  type: 'import' | 'export' | 'api' | 'data' | 'config';
  transitive: boolean;
}

/**
 * Represents detected risky patterns in code
 */
export interface RiskyPattern {
  type: 'global-state' | 'api-modification' | 'data-model-change' | 'auth-logic' | 'database-change' | 'config-change';
  description: string;
  location: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Represents the risk level for a changed file
 */
export interface FileRisk {
  filePath: string;
  complexity: CodeComplexity;
  riskScore: number; // 0-100
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  patterns: RiskyPattern[];
  transitiveDependencies: Dependency[];
  sideEffects: string[];
  mitigation: string[];
}

/**
 * Represents risk assessment result
 */
export interface RiskAssessmentResult {
  timestamp: string;
  totalFiles: number;
  riskDistribution: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  overallRiskScore: number; // 0-100
  overallRiskLevel: 'low' | 'medium' | 'high' | 'critical';
  criticalFiles: FileRisk[];
  recommendations: string[];
  additionalVerificationRequired: boolean;
  verificationSuggestions: string[];
}

/**
 * Analyzes code complexity from source code
 */
export function analyzeComplexity(sourceCode: string, filePath: string): CodeComplexity {
  const lines = sourceCode.split('\n').filter(l => l.trim().length > 0);
  const linesOfCode = lines.length;

  // Count functions
  const functionMatches = sourceCode.matchAll(/(?:function|const\s+\w+\s*=\s*(?:async\s*)?\(|async\s+function)\s*\w*\s*\(/g);
  const functionCount = Array.from(functionMatches).length;

  // Estimate cyclomatic complexity (1-10 scale based on keywords)
  const complexityKeywords = sourceCode.match(/\b(if|else|case|catch|for|while|&&|\|\||!)\b/g) || [];
  let cyclomaticComplexity = Math.min(10, Math.max(1, Math.ceil(complexityKeywords.length / 5)));

  // Detect nested depth
  let nestedDepth = 0;
  let maxNested = 0;
  for (const char of sourceCode) {
    if (char === '{') {
      nestedDepth++;
      maxNested = Math.max(maxNested, nestedDepth);
    } else if (char === '}') {
      nestedDepth--;
    }
  }

  // Detect global state and side effects
  const hasGlobalState = /\b(?:global|globalThis|window|process\.env|singleton)\b/.test(sourceCode);
  const hasSideEffects = /\b(?:console\.|localStorage|sessionStorage|location\.href|import\s+.*from|export\s+(?:const|class|interface))\b/.test(sourceCode);

  return {
    cyclomaticComplexity,
    linesOfCode,
    functionCount,
    nestedDepth: maxNested,
    hasGlobalState,
    hasSideEffects
  };
}

/**
 * Detects risky patterns in code
 */
export function detectRiskyPatterns(sourceCode: string, filePath: string): RiskyPattern[] {
  const patterns: RiskyPattern[] = [];

  // Global state pattern
  if (/\b(?:global|globalThis|window|singleton|static\s+\w+\s*:)/g.test(sourceCode)) {
    patterns.push({
      type: 'global-state',
      description: 'Code uses global state or singletons',
      location: filePath,
      severity: 'high'
    });
  }

  // API modification pattern
  if (/(DELETE|PUT|PATCH|POST)\s+\/|\.delete\(|\.put\(|\.patch\(|\.post\(/.test(sourceCode)) {
    patterns.push({
      type: 'api-modification',
      description: 'Code modifies API endpoints or makes data-changing requests',
      location: filePath,
      severity: 'high'
    });
  }

  // Data model change pattern
  if (/schema|interface.*{.*:.*type|export\s+interface|\bmodel\b|migration/.test(sourceCode)) {
    patterns.push({
      type: 'data-model-change',
      description: 'Code modifies data models or schema definitions',
      location: filePath,
      severity: 'critical'
    });
  }

  // Auth logic pattern
  if (/(?:auth|login|password|token|jwt|session|permission|role)/.test(sourceCode.toLowerCase())) {
    patterns.push({
      type: 'auth-logic',
      description: 'Code contains authentication or authorization logic',
      location: filePath,
      severity: 'critical'
    });
  }

  // Database change pattern
  if (/(?:database|db\.|sql|query|migration|seed|fixture)/.test(sourceCode.toLowerCase())) {
    patterns.push({
      type: 'database-change',
      description: 'Code modifies database, queries, or migrations',
      location: filePath,
      severity: 'critical'
    });
  }

  // Config change pattern
  if (/(config|\.env|environment|settings|configuration)/.test(sourceCode.toLowerCase())) {
    patterns.push({
      type: 'config-change',
      description: 'Code modifies configuration or environment settings',
      location: filePath,
      severity: 'high'
    });
  }

  return patterns;
}

/**
 * Identifies transitive dependencies and side effects
 */
export function identifyTransitiveDependencies(
  filePath: string,
  allDependencies: Map<string, string[]>,
  changedFiles: string[]
): Dependency[] {
  const transitiveDeps: Dependency[] = [];
  const visited = new Set<string>();

  const traverse = (file: string, depth: number = 0) => {
    if (visited.has(file) || depth > 3) return;
    visited.add(file);

    const deps = allDependencies.get(file) || [];
    for (const dep of deps) {
      transitiveDeps.push({
        source: file,
        target: dep,
        type: 'import',
        transitive: depth > 0
      });

      if (changedFiles.includes(dep)) {
        traverse(dep, depth + 1);
      }
    }
  };

  traverse(filePath);
  return transitiveDeps;
}

/**
 * Calculates risk score for a single file (0-100)
 */
export function calculateFileRiskScore(
  complexity: CodeComplexity,
  patterns: RiskyPattern[],
  transitiveDeps: number,
  changedLines: number
): number {
  let score = 0;

  // Complexity factor (0-30 points)
  const complexityScore = Math.min(30, (complexity.cyclomaticComplexity / 10) * 30);
  score += complexityScore;

  // LOC factor (0-20 points) - larger changes = higher risk
  const locScore = Math.min(20, (complexity.linesOfCode / 500) * 20);
  score += locScore;

  // Pattern severity factor (0-30 points)
  const criticalPatterns = patterns.filter(p => p.severity === 'critical').length;
  const highPatterns = patterns.filter(p => p.severity === 'high').length;
  const patternScore = (criticalPatterns * 15) + (highPatterns * 8);
  score += Math.min(30, patternScore);

  // Transitive dependency factor (0-20 points)
  const depScore = Math.min(20, (transitiveDeps / 5) * 20);
  score += depScore;

  // Changed lines factor (0-10 points)
  const changeScore = Math.min(10, (changedLines / 100) * 10);
  score += changeScore;

  return Math.min(100, Math.round(score));
}

/**
 * Determines risk level from risk score
 */
export function determineRiskLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

/**
 * Generates mitigation strategies for identified risks
 */
export function generateMitigation(patterns: RiskyPattern[], riskScore: number): string[] {
  const mitigations: string[] = [];

  if (riskScore >= 80) {
    mitigations.push('Conduct thorough code review with multiple reviewers');
    mitigations.push('Require comprehensive test coverage (>90%) before merge');
    mitigations.push('Plan detailed rollback procedure');
  }

  if (patterns.some(p => p.type === 'global-state')) {
    mitigations.push('Refactor to use dependency injection instead of global state');
    mitigations.push('Add integration tests for global state interactions');
  }

  if (patterns.some(p => p.type === 'api-modification')) {
    mitigations.push('Include backwards compatibility testing');
    mitigations.push('Plan API versioning strategy');
    mitigations.push('Notify consumers of API changes');
  }

  if (patterns.some(p => p.type === 'data-model-change')) {
    mitigations.push('Create migration strategy for existing data');
    mitigations.push('Test migration on production-like dataset');
    mitigations.push('Plan rollback strategy for data changes');
  }

  if (patterns.some(p => p.type === 'auth-logic')) {
    mitigations.push('Security audit required before merge');
    mitigations.push('Add comprehensive security tests');
    mitigations.push('Review authentication/authorization changes');
  }

  if (patterns.some(p => p.type === 'database-change')) {
    mitigations.push('Perform database migration testing');
    mitigations.push('Create backup before applying changes');
    mitigations.push('Verify data integrity after migration');
  }

  return mitigations;
}

/**
 * Generates verification suggestions based on risk assessment
 */
export function generateVerificationSuggestions(
  fileRisks: FileRisk[],
  overallRiskLevel: string
): string[] {
  const suggestions: string[] = [];

  const criticalCount = fileRisks.filter(f => f.riskLevel === 'critical').length;
  const highCount = fileRisks.filter(f => f.riskLevel === 'high').length;

  if (criticalCount > 0) {
    suggestions.push(`Perform in-depth review of ${criticalCount} critical risk file(s)`);
    suggestions.push('Add integration tests for changed critical components');
    suggestions.push('Consider staging deployment with canary testing');
  }

  if (highCount > 2) {
    suggestions.push('Add comprehensive end-to-end tests');
    suggestions.push('Consider phased rollout instead of full deployment');
  }

  if (fileRisks.some(f => f.patterns.some(p => p.type === 'api-modification'))) {
    suggestions.push('Add API contract tests');
    suggestions.push('Test with multiple API client versions');
  }

  if (fileRisks.some(f => f.patterns.some(p => p.type === 'data-model-change'))) {
    suggestions.push('Run migration tests on production-like data');
    suggestions.push('Verify backwards compatibility');
  }

  if (fileRisks.some(f => f.patterns.some(p => p.type === 'auth-logic'))) {
    suggestions.push('Perform security penetration testing');
    suggestions.push('Add authorization edge case tests');
  }

  return suggestions;
}

/**
 * Performs comprehensive risk assessment on code changes
 */
export function assessRisk(
  changedFiles: Map<string, { sourceCode: string; changedLines: number }>,
  allDependencies: Map<string, string[]> = new Map(),
  existingTests: number = 0
): RiskAssessmentResult {
  const fileRisks: FileRisk[] = [];
  const riskDistribution = { low: 0, medium: 0, high: 0, critical: 0 };

  for (const [filePath, { sourceCode, changedLines }] of changedFiles) {
    const complexity = analyzeComplexity(sourceCode, filePath);
    const patterns = detectRiskyPatterns(sourceCode, filePath);
    const transitiveDeps = identifyTransitiveDependencies(filePath, allDependencies, Array.from(changedFiles.keys()));
    const riskScore = calculateFileRiskScore(complexity, patterns, transitiveDeps.length, changedLines);
    const riskLevel = determineRiskLevel(riskScore);
    const mitigation = generateMitigation(patterns, riskScore);

    fileRisks.push({
      filePath,
      complexity,
      riskScore,
      riskLevel,
      patterns,
      transitiveDependencies: transitiveDeps,
      sideEffects: patterns.map(p => p.description),
      mitigation
    });

    riskDistribution[riskLevel]++;
  }

  // Calculate overall risk score (weighted average)
  const overallRiskScore =
    fileRisks.length > 0
      ? Math.round(fileRisks.reduce((sum, f) => sum + f.riskScore, 0) / fileRisks.length)
      : 0;

  const overallRiskLevel = determineRiskLevel(overallRiskScore);
  const criticalFiles = fileRisks.filter(f => f.riskLevel === 'critical');
  const additionalVerificationRequired = overallRiskLevel === 'high' || overallRiskLevel === 'critical';

  const recommendations: string[] = [];
  if (criticalFiles.length > 0) {
    recommendations.push(`${criticalFiles.length} file(s) identified as critical risk`);
  }
  if (overallRiskScore > 70) {
    recommendations.push('Consider breaking changes into smaller, more manageable pieces');
  }
  if (existingTests === 0 && fileRisks.some(f => f.patterns.length > 0)) {
    recommendations.push('Add test coverage for changed files');
  }

  const verificationSuggestions = generateVerificationSuggestions(fileRisks, overallRiskLevel);

  return {
    timestamp: new Date().toISOString(),
    totalFiles: changedFiles.size,
    riskDistribution,
    overallRiskScore,
    overallRiskLevel,
    criticalFiles,
    recommendations,
    additionalVerificationRequired,
    verificationSuggestions
  };
}

/**
 * Generates detailed risk assessment report
 */
export function generateRiskAssessmentReport(assessment: RiskAssessmentResult): string {
  let report = `# Risk Assessment Report\n\n`;
  report += `**Generated:** ${assessment.timestamp}\n\n`;
  report += `## Overall Assessment\n`;
  report += `- **Risk Level:** ${assessment.overallRiskLevel.toUpperCase()}\n`;
  report += `- **Risk Score:** ${assessment.overallRiskScore}/100\n`;
  report += `- **Files Analyzed:** ${assessment.totalFiles}\n`;
  report += `- **Additional Verification Required:** ${assessment.additionalVerificationRequired ? 'Yes' : 'No'}\n\n`;

  report += `## Risk Distribution\n`;
  report += `- **Low Risk:** ${assessment.riskDistribution.low} file(s)\n`;
  report += `- **Medium Risk:** ${assessment.riskDistribution.medium} file(s)\n`;
  report += `- **High Risk:** ${assessment.riskDistribution.high} file(s)\n`;
  report += `- **Critical Risk:** ${assessment.riskDistribution.critical} file(s)\n\n`;

  if (assessment.criticalFiles.length > 0) {
    report += `## Critical Risk Files\n`;
    for (const file of assessment.criticalFiles) {
      report += `\n### ${file.filePath}\n`;
      report += `- **Risk Score:** ${file.riskScore}/100\n`;
      report += `- **Complexity:** ${file.complexity.cyclomaticComplexity}/10\n`;
      report += `- **Lines of Code:** ${file.complexity.linesOfCode}\n`;
      if (file.patterns.length > 0) {
        report += `- **Patterns:**\n`;
        for (const pattern of file.patterns) {
          report += `  - ${pattern.description} (${pattern.severity})\n`;
        }
      }
      if (file.mitigation.length > 0) {
        report += `- **Mitigation Strategies:**\n`;
        for (const mit of file.mitigation) {
          report += `  - ${mit}\n`;
        }
      }
    }
  }

  if (assessment.recommendations.length > 0) {
    report += `\n## Recommendations\n`;
    for (const rec of assessment.recommendations) {
      report += `- ${rec}\n`;
    }
  }

  if (assessment.verificationSuggestions.length > 0) {
    report += `\n## Additional Verification Suggestions\n`;
    for (const suggestion of assessment.verificationSuggestions) {
      report += `- ${suggestion}\n`;
    }
  }

  return report;
}
