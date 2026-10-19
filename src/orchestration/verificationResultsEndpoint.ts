/**
 * Phase 7.1 Task 5: Verification Results Integration
 * 
 * Compatibility endpoint for the original Phase 7 UI contract.
 *
 * The active orchestration flow uses /api/agents/stream, which runs real
 * workspace verification commands. This endpoint remains for older clients,
 * but deliberately reports deterministic skipped checks instead of fabricating
 * pass/fail, latency, or project metrics.
 * 
 * Integration points:
 * - Input: AgentTaskExecution with changed files and affected layers
 * - Output: VerificationResult with all check results
 * - UI: AgentTimeline displays results with check status and coverage
 */

import type { Response } from 'express';
import type { VerificationResult, VerificationPlan, CheckResult, CheckType } from '../tools/verificationPlanner.js';

/**
 * Stream event for verification results
 */
export interface VerificationStreamEvent {
  type:
    | 'verification-start'
    | 'planning-checks'
    | 'executing-checks'
    | 'check-complete'
    | 'verification-complete'
    | 'gate-evaluation'
    | 'repair-recommended'
    | 'error';
  data: any;
  timestamp?: number;
}

/**
 * Agent execution info for verification
 */
export interface AgentExecutionForVerification {
  taskId: string;
  agentRole: string;
  affectedFiles: string[];
  affectedLayers: string[];
  changesSummary: string;
  testsRun?: string[];
  commandsExecuted?: string[];
}

/**
 * Quality gate result
 */
export interface QualityGateResult {
  gate: string;
  status: 'pass' | 'fail' | 'warning';
  reason: string;
  suggestedFix?: string;
}

/**
 * Map layers to verification checks
 */
function getChecksForLayers(layers: string[]): CheckType[] {
  const checks: Set<CheckType> = new Set();

  for (const layer of layers) {
    switch (layer) {
      case 'frontend':
        checks.add('typescript');
        checks.add('lint');
        checks.add('build');
        checks.add('responsive');
        checks.add('console-errors');
        break;
      case 'backend':
        checks.add('typescript');
        checks.add('lint');
        checks.add('api-smoke');
        checks.add('validation');
        checks.add('security');
        break;
      case 'data':
        checks.add('schema');
        checks.add('persistence');
        checks.add('seed-data');
        break;
      case 'tests':
        checks.add('unit-tests');
        checks.add('integration-tests');
        break;
      case 'docs':
        checks.add('links');
        checks.add('examples');
        checks.add('references');
        checks.add('api-names');
        break;
    }
  }

  return Array.from(checks);
}

/**
 * Create the compatibility verification plan.
 */
function createVerificationPlan(execution: AgentExecutionForVerification): VerificationPlan {
  const checks = getChecksForLayers(execution.affectedLayers);
  const criticalChecks = checks.filter((c) => ['typescript', 'lint', 'build', 'schema'].includes(c));

  return {
    requestId: `verify-${execution.taskId}`,
    affectedLayers: execution.affectedLayers,
    plannedChecks: checks,
    criticalChecks,
    estimatedDuration: Math.max(5000, checks.length * 1000),
    priority: execution.affectedLayers.includes('backend') ? 'high' : 'medium',
    breakOnFailure: true,
  };
}

/**
 * Return a deterministic compatibility result. Real command verification is
 * owned by agentExecutionEndpoint.runVerificationCommands.
 */
function executeCheck(checkType: CheckType, execution: AgentExecutionForVerification): CheckResult {
  return {
    checkType,
    passed: false,
    skipped: true,
    duration: 1,
    errors: [],
    warnings: [`${checkType} was not executed by the compatibility endpoint; use the managed agent run for real verification.`],
    details: {
      mode: 'compatibility-skipped',
      affectedLayers: execution.affectedLayers,
      affectedFiles: execution.affectedFiles,
    },
  };
}

/**
 * Evaluate quality gates based on results
 */
function evaluateQualityGates(
  result: VerificationResult,
  execution: AgentExecutionForVerification
): QualityGateResult[] {
  const gates: QualityGateResult[] = [];

  // Gate 1: No critical failures
  const criticalFailed = result.failedChecks.filter((c) =>
    ['typescript', 'lint', 'build', 'schema'].includes(c.checkType)
  );
  gates.push({
    gate: 'no-critical-failures',
    status: criticalFailed.length === 0 ? 'pass' : 'fail',
    reason:
      criticalFailed.length === 0
        ? 'All critical checks passed'
        : `${criticalFailed.length} critical check(s) failed`,
    suggestedFix: criticalFailed.length > 0 ? 'Fix critical check failures before proceeding' : undefined,
  });

  // Gate 2: Coverage requirement
  const testChecks = result.checks.filter((c) => c.checkType.includes('test'));
  const testsPassed = testChecks.filter((c) => c.passed).length > 0;
  gates.push({
    gate: 'test-coverage',
    status: testsPassed ? 'pass' : 'warning',
    reason: testsPassed ? 'Tests executed successfully' : 'No tests executed',
    suggestedFix: !testsPassed ? 'Run appropriate test suite for layer changes' : undefined,
  });

  // Gate 3: Layer-specific requirements
  if (execution.affectedLayers.includes('frontend')) {
    const frontendChecks = result.checks.filter(
      (c) => ['responsive', 'console-errors', 'build'].includes(c.checkType)
    );
    const frontendPassed = frontendChecks.every((c) => c.passed);
    gates.push({
      gate: 'frontend-quality',
      status: frontendPassed ? 'pass' : 'warning',
      reason: frontendPassed ? 'Frontend quality checks passed' : 'Some frontend checks failed',
    });
  }

  if (execution.affectedLayers.includes('backend')) {
    const backendChecks = result.checks.filter(
      (c) => ['api-smoke', 'validation', 'security'].includes(c.checkType)
    );
    const backendPassed = backendChecks.every((c) => c.passed);
    gates.push({
      gate: 'backend-quality',
      status: backendPassed ? 'pass' : 'warning',
      reason: backendPassed ? 'Backend quality checks passed' : 'Some backend checks failed',
    });
  }

  return gates;
}

/**
 * Analyze results and recommend repairs if needed
 */
function generateRepairRecommendations(result: VerificationResult): string[] {
  if (result.status === 'passed') {
    return [];
  }

  const recommendations: string[] = [];

  for (const failed of result.failedChecks) {
    switch (failed.checkType) {
      case 'typescript':
        recommendations.push('Fix TypeScript compilation errors - check type definitions');
        break;
      case 'lint':
        recommendations.push('Run eslint --fix to auto-fix linting issues');
        break;
      case 'build':
        recommendations.push('Check build logs for compilation or bundling errors');
        break;
      case 'api-smoke':
        recommendations.push('Verify API endpoints are responding correctly');
        break;
      case 'validation':
        recommendations.push('Check validation logic and error handling');
        break;
      case 'security':
        recommendations.push('Review security checks - ensure auth/CORS properly configured');
        break;
      case 'schema':
        recommendations.push('Review database schema - ensure migrations are valid');
        break;
      case 'unit-tests':
        recommendations.push('Fix failing unit tests - review test output');
        break;
    }
  }

  return recommendations;
}

/**
 * Execute verification plan and collect results
 */
export async function executeVerification(execution: AgentExecutionForVerification): Promise<VerificationResult> {
  const plan = createVerificationPlan(execution);
  const startTime = new Date();
  const checks: CheckResult[] = [];

  // Execute each check (don't break early for testing purposes)
  for (const checkType of plan.plannedChecks) {
    const checkResult = executeCheck(checkType, execution);
    checks.push(checkResult);
  }

  const endTime = new Date();
  const totalDuration = endTime.getTime() - startTime.getTime();
  const failedChecks = checks.filter((c) => !c.passed && !c.skipped);
  const skippedChecks = checks.filter((c) => c.skipped);
  const status = failedChecks.length === 0 && skippedChecks.length === 0
    ? 'passed'
    : failedChecks.some((c) => plan.criticalChecks.includes(c.checkType))
      ? 'failed'
      : 'partial';

  return {
    planId: plan.requestId,
    status,
    checks,
    totalDuration,
    failedChecks,
    startTime,
    endTime,
    confidence: skippedChecks.length > 0 ? 0.5 : Math.max(0.5, 1 - failedChecks.length / checks.length),
  };
}

/**
 * Handle verification results HTTP request with streaming
 */
export async function handleVerificationResultsRequest(
  req: {
    body: {
      execution: AgentExecutionForVerification;
      workspace?: string;
    };
  },
  res: Response
): Promise<void> {
  const { execution, workspace } = req.body;

  // Validate request
  if (!execution || !execution.taskId || !execution.affectedLayers) {
    res.status(400).json({
      error: 'Invalid request: execution with taskId and affectedLayers required',
    });
    return;
  }

  // Set up SSE response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event: VerificationStreamEvent) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  };

  try {
    // Verification started
    sendEvent({
      type: 'verification-start',
      data: {
        timestamp: Date.now(),
        taskId: execution.taskId,
        agentRole: execution.agentRole,
      },
    });

    // Planning phase
    const plan = createVerificationPlan(execution);
    sendEvent({
      type: 'planning-checks',
      data: {
        plannedChecks: plan.plannedChecks.length,
        criticalChecks: plan.criticalChecks.length,
        estimatedDuration: plan.estimatedDuration,
      },
    });

    // Executing checks
    sendEvent({
      type: 'executing-checks',
      data: {
        totalChecks: plan.plannedChecks.length,
        timestamp: Date.now(),
      },
    });

    // Execute verification
    const result = await executeVerification(execution);

    // Stream individual check results
    for (const check of result.checks) {
      sendEvent({
        type: 'check-complete',
        data: {
          checkType: check.checkType,
          passed: check.passed,
          duration: check.duration,
          errors: check.errors,
          warnings: check.warnings,
          details: check.details,
        },
      });
    }

    // Send verification complete with summary
    sendEvent({
      type: 'verification-complete',
      data: {
        status: result.status,
        totalDuration: result.totalDuration,
        checksRun: result.checks.length,
        checksPassed: result.checks.filter((c) => c.passed).length,
        checksFailed: result.failedChecks.length,
        confidence: result.confidence,
        summary: {
          frontend: execution.affectedLayers.includes('frontend')
            ? result.checks.filter((c) => ['responsive', 'console-errors'].includes(c.checkType)).every((c) => c.passed)
              ? 'passed'
              : 'failed'
            : 'skipped',
          backend: execution.affectedLayers.includes('backend')
            ? result.checks.filter((c) => ['api-smoke', 'validation', 'security'].includes(c.checkType)).every((c) => c.passed)
              ? 'passed'
              : 'failed'
            : 'skipped',
          tests: result.checks.filter((c) => c.checkType.includes('test')).length > 0
            ? result.checks.filter((c) => c.checkType.includes('test')).every((c) => c.passed)
              ? 'passed'
              : 'failed'
            : 'skipped',
        },
      },
    });

    // Evaluate quality gates
    const gates = evaluateQualityGates(result, execution);
    sendEvent({
      type: 'gate-evaluation',
      data: {
        gates,
        passedGates: gates.filter((g) => g.status === 'pass').length,
        failedGates: gates.filter((g) => g.status === 'fail').length,
        warnings: gates.filter((g) => g.status === 'warning').length,
      },
    });

    // Repair recommendations if needed
    if (result.status !== 'passed') {
      const recommendations = generateRepairRecommendations(result);
      sendEvent({
        type: 'repair-recommended',
        data: {
          severity: result.status === 'failed' ? 'critical' : 'medium',
          recommendations,
          affectedChecks: result.failedChecks.map((c) => c.checkType),
        },
      });
    }

    res.end();
  } catch (error: any) {
    sendEvent({
      type: 'error',
      data: {
        error: error.message || 'Unknown error during verification',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
    });
    res.end();
  }
}
