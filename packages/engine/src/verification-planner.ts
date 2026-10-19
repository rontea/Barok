/**
 * Phase 6: Verification Planner
 * Select and execute verification checks based on touched layers
 */

/**
 * Verification check types
 */
export type CheckType =
  | 'project-verification'
  | 'typescript'
  | 'lint'
  | 'build'
  | 'playwright'
  | 'responsive'
  | 'console-errors'
  | 'api-smoke'
  | 'validation'
  | 'security'
  | 'schema'
  | 'persistence'
  | 'seed-data'
  | 'unit-tests'
  | 'integration-tests'
  | 'links'
  | 'examples'
  | 'references'
  | 'api-names';

/**
 * Verification check result
 */
export interface CheckResult {
  checkType: CheckType;
  passed: boolean;
  skipped?: boolean;
  duration: number; // milliseconds
  errors: string[];
  warnings: string[];
  details: Record<string, unknown>;
}

/**
 * Verification plan
 */
export interface VerificationPlan {
  requestId: string;
  affectedLayers: string[];
  plannedChecks: CheckType[];
  criticalChecks: CheckType[];
  estimatedDuration: number; // milliseconds
  priority: 'low' | 'medium' | 'high' | 'critical';
  breakOnFailure: boolean;
}

/**
 * Verification execution result
 */
export interface PlannerVerificationResult {
  planId: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'partial';
  checks: CheckResult[];
  totalDuration: number;
  failedChecks: CheckResult[];
  startTime: Date;
  endTime?: Date;
  confidence: number; // 0-1, how confident we are in the verification
}

/**
 * Repair task for failed verification
 */
export interface PlannerRepairTask {
  taskId: string;
  failedVerification: PlannerVerificationResult;
  failedChecks: CheckResult[];
  suggestedActions: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  createdAt: Date;
}

/**
 * Create verification plan based on affected layers
 */
export function createVerificationPlan(
  affectedLayers: string[],
  touchedFiles: string[]
): VerificationPlan {
  const plannedChecks: CheckType[] = [];
  const criticalChecks: CheckType[] = [];

  // Frontend layer checks
  if (affectedLayers.includes('frontend')) {
    plannedChecks.push(
      'typescript',
      'lint',
      'build',
      'console-errors'
    );
    criticalChecks.push('typescript', 'build');

    // Add UI-specific checks if significant changes
    if (touchedFiles.filter((f) => f.includes('ui/')).length > 3) {
      plannedChecks.push('playwright', 'responsive');
    }
  }

  // Backend layer checks
  if (affectedLayers.includes('backend')) {
    plannedChecks.push(
      'typescript',
      'lint',
      'validation',
      'api-smoke'
    );
    criticalChecks.push('typescript', 'validation');

    // Add security checks if auth-related
    if (touchedFiles.some((f) => f.includes('auth'))) {
      plannedChecks.push('security');
      criticalChecks.push('security');
    }
  }

  // Data layer checks
  if (affectedLayers.includes('data')) {
    plannedChecks.push('schema', 'persistence', 'seed-data');
    criticalChecks.push('schema', 'persistence');
  }

  // Test layer checks
  if (affectedLayers.includes('tests')) {
    // Focused tests if few changes
    if (touchedFiles.length <= 5) {
      plannedChecks.push('unit-tests');
    } else {
      // Broader suite if many changes
      plannedChecks.push('unit-tests', 'integration-tests');
    }
  }

  // Documentation layer checks
  if (affectedLayers.includes('docs')) {
    plannedChecks.push('links', 'examples', 'references', 'api-names');
  }

  // Determine priority
  let priority: 'low' | 'medium' | 'high' | 'critical' = 'medium';
  if (affectedLayers.includes('backend')) {
    priority = 'high';
  }
  if (touchedFiles.some((f) => f.includes('auth')) || 
      touchedFiles.some((f) => f.includes('security'))) {
    priority = 'critical';
  }

  // Estimate duration
  const estimatedDuration = estimateChecksDuration(plannedChecks);

  return {
    requestId: generateRequestId(),
    affectedLayers,
    plannedChecks: [...new Set(plannedChecks)], // Remove duplicates
    criticalChecks: [...new Set(criticalChecks)],
    estimatedDuration,
    priority,
    breakOnFailure: priority === 'critical',
  };
}

/**
 * Estimate total check duration
 */
export function estimateChecksDuration(checks: CheckType[]): number {
  const durationMap: Record<CheckType, number> = {
    'project-verification': 3000,
    typescript: 2000,
    lint: 1500,
    build: 3000,
    playwright: 5000,
    responsive: 3000,
    'console-errors': 1000,
    'api-smoke': 2000,
    validation: 1500,
    security: 3000,
    schema: 1000,
    persistence: 2000,
    'seed-data': 1500,
    'unit-tests': 10000,
    'integration-tests': 15000,
    links: 2000,
    examples: 1500,
    references: 1000,
    'api-names': 500,
  };

  return checks.reduce((total, check) => total + (durationMap[check] || 1000), 0);
}

/**
 * Get critical checks that must pass
 */
export function getCriticalChecks(plan: VerificationPlan): CheckType[] {
  return plan.criticalChecks;
}

/**
 * Get optional checks that can be skipped on failure
 */
export function getOptionalChecks(plan: VerificationPlan): CheckType[] {
  return plan.plannedChecks.filter((c) => !plan.criticalChecks.includes(c));
}

/**
 * Create verification result from check results
 */
export function createVerificationResult(
  plan: VerificationPlan,
  checkResults: CheckResult[]
): PlannerVerificationResult {
  const failedChecks = checkResults.filter((c) => !c.passed);
  const allPassed = failedChecks.length === 0;
  const partialPassed = failedChecks.length > 0 && 
    failedChecks.every((c) => !plan.criticalChecks.includes(c.checkType));

  let status: 'pending' | 'running' | 'passed' | 'failed' | 'partial' = 'passed';
  if (failedChecks.length > 0) {
    status = partialPassed ? 'partial' : 'failed';
  }

  const totalDuration = checkResults.reduce((sum, c) => sum + c.duration, 0);
  const confidence = calculateConfidence(plan, checkResults);

  return {
    planId: plan.requestId,
    status,
    checks: checkResults,
    totalDuration,
    failedChecks,
    startTime: new Date(),
    confidence,
  };
}

/**
 * Calculate confidence score (0-1) for verification
 */
export function calculateConfidence(
  plan: VerificationPlan,
  results: CheckResult[]
): number {
  const critical = plan.criticalChecks.length;
  const criticalPassed = results
    .filter((r) => plan.criticalChecks.includes(r.checkType) && r.passed)
    .length;

  const optional = plan.plannedChecks.length - critical;
  const optionalPassed = results
    .filter((r) => !plan.criticalChecks.includes(r.checkType) && r.passed)
    .length;

  if (critical === 0) return 1; // No critical checks

  const criticalScore = criticalPassed / critical;
  const optionalScore = optional > 0 ? optionalPassed / optional : 1;

  // 70% weight on critical, 30% on optional
  return criticalScore * 0.7 + optionalScore * 0.3;
}

/**
 * Create repair task for failed verification
 */
export function createPlannedRepairTask(
  verification: PlannerVerificationResult
): PlannerRepairTask {
  const criticalFailures = verification.failedChecks;
  const suggestedActions = getSuggestedActions(verification);

  let priority: 'low' | 'medium' | 'high' | 'critical' = 'medium';
  if (criticalFailures.length > 0) {
    priority = 'critical';
  } else if (verification.failedChecks.length > 3) {
    priority = 'high';
  }

  return {
    taskId: generateTaskId(),
    failedVerification: verification,
    failedChecks: verification.failedChecks,
    suggestedActions,
    priority,
    createdAt: new Date(),
  };
}

/**
 * Get suggested repair actions
 */
export function getSuggestedActions(verification: PlannerVerificationResult): string[] {
  const actions: string[] = [];
  const failureMap = new Map<CheckType, string[]>();

  for (const check of verification.failedChecks) {
    failureMap.set(check.checkType, check.errors);
  }

  // TypeScript errors
  if (failureMap.has('typescript')) {
    actions.push('Fix TypeScript compilation errors');
  }

  // Linting errors
  if (failureMap.has('lint')) {
    actions.push('Run `npm run lint:fix` to fix linting issues');
  }

  // Build errors
  if (failureMap.has('build')) {
    actions.push('Review build output for bundling issues');
  }

  // Test failures
  if (failureMap.has('unit-tests')) {
    actions.push('Run failing unit tests locally and fix test failures');
  }

  if (failureMap.has('integration-tests')) {
    actions.push('Debug integration test failures (may indicate multi-layer issues)');
  }

  // API/Security issues
  if (failureMap.has('api-smoke')) {
    actions.push('Verify API endpoints are correctly implemented');
  }

  if (failureMap.has('security')) {
    actions.push('Review security-sensitive changes (auth, validation, etc.)');
  }

  // Data issues
  if (failureMap.has('schema')) {
    actions.push('Validate database schema changes');
  }

  if (failureMap.has('persistence')) {
    actions.push('Test persistence layer behavior');
  }

  // Documentation
  if (failureMap.has('links')) {
    actions.push('Fix broken documentation links');
  }

  if (failureMap.has('examples')) {
    actions.push('Update or fix code examples in documentation');
  }

  return actions.length > 0 ? actions : ['Review verification output and address failures'];
}

/**
 * Generate unique request ID
 */
export function generateRequestId(): string {
  return `verify-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate unique task ID
 */
export function generateTaskId(): string {
  return `repair-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Determine if verification should stop on current failure
 */
export function shouldStopVerification(
  plan: VerificationPlan,
  failedCheck: CheckResult
): boolean {
  if (!plan.breakOnFailure) return false;

  // Always stop on critical checks
  if (plan.criticalChecks.includes(failedCheck.checkType)) {
    return true;
  }

  return false;
}

/**
 * Get verification summary
 */
export function getVerificationSummary(result: PlannerVerificationResult): string {
  const passedCount = result.checks.length - result.failedChecks.length;
  const passedPercent = Math.round((passedCount / result.checks.length) * 100);

  let summary = `# Verification Result\n\n`;
  summary += `**Status**: ${result.status.toUpperCase()}\n`;
  summary += `**Confidence**: ${(result.confidence * 100).toFixed(1)}%\n`;
  summary += `**Passed**: ${passedCount}/${result.checks.length} checks (${passedPercent}%)\n`;
  summary += `**Duration**: ${(result.totalDuration / 1000).toFixed(2)}s\n\n`;

  if (result.failedChecks.length > 0) {
    summary += `## Failed Checks\n\n`;
    for (const check of result.failedChecks) {
      summary += `- **${check.checkType}**: ${check.errors.join(', ')}\n`;
    }
  }

  return summary;
}
