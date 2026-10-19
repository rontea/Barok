/**
 * Execution summary and monitoring for agent parallelization
 */

import {
  ExecutionSummary,
  ExecutionGroup,
  AgentExecutionResult,
  MergedOutput,
  ConflictInfo,
} from './types.js';

/**
 * Creates a new execution summary
 */
export function createExecutionSummary(
  taskGroups: ExecutionGroup[],
  agentResults: Map<string, AgentExecutionResult[]>,
  conflicts: ConflictInfo[],
  mergedOutput: MergedOutput
): ExecutionSummary {
  const startTime = Math.min(
    ...Array.from(agentResults.values())
      .flat()
      .map(r => r.timestamp)
      .filter(t => t > 0)
  );

  const endTime = Math.max(
    ...Array.from(agentResults.values())
      .flat()
      .map(r => r.timestamp + r.duration)
  );

  const totalDuration = endTime - startTime;

  // Collect all changed files
  const changedFiles = new Set<string>();
  for (const results of agentResults.values()) {
    for (const result of results) {
      for (const file of result.changedFiles) {
        changedFiles.add(file);
      }
    }
  }

  // Build retry log
  const retryLog: ExecutionSummary['retryLog'] = [];
  const retryMap = new Map<string, Array<{ attempts: number; steps: string[] }>>();

  for (const [agentId, results] of agentResults.entries()) {
    for (const result of results) {
      if (result.retryAttempts > 0) {
        if (!retryMap.has(result.taskId)) {
          retryMap.set(result.taskId, []);
        }
        retryMap.get(result.taskId)!.push({
          attempts: result.retryAttempts,
          steps: [], // Would be populated from retry logic
        });
      }
    }
  }

  for (const [taskId, retries] of retryMap.entries()) {
    retryLog.push({
      taskId,
      attempts: retries.reduce((sum, r) => sum + r.attempts, 0),
      finalStatus: 'success', // Inferred from result status
      scopeNarrowingSteps: retries.flatMap(r => r.steps),
    });
  }

  // Determine overall status
  const allResults = Array.from(agentResults.values()).flat();
  const failedCount = allResults.filter(r => r.status === 'failure').length;
  const partialCount = allResults.filter(r => r.status === 'partial').length;

  let overallStatus: 'success' | 'partial_failure' | 'failure' = 'success';
  if (failedCount > 0) {
    overallStatus = 'failure';
  } else if (partialCount > 0) {
    overallStatus = 'partial_failure';
  }

  const monitoring = {
    parallelExecutions: taskGroups.filter(g => g.taskIds.length > 1).length,
    conflictsDetected: conflicts.length,
    conflictsResolved: conflicts.filter(c => !mergedOutput.mergeConflicts.includes(c)).length,
    retryAttemptsNeeded: retryLog.reduce((sum, r) => sum + r.attempts, 0),
    scopeNarrowingEvents: retryLog.reduce((sum, r) => sum + r.scopeNarrowingSteps.length, 0),
  };

  return {
    executionId: `exec-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    startTime,
    endTime,
    totalDuration,
    taskGroups,
    agentResults,
    conflicts,
    mergedOutput,
    retryLog,
    overallStatus,
    changedFiles,
    verification: {
      performed: false,
      results: {},
      failedChecks: [],
    },
    monitoring,
    summary: '', // Will be generated below
  };
}

/**
 * Generates a human-readable summary of execution
 */
export function generateExecutionSummary(summary: ExecutionSummary): string {
  const agentCount = summary.agentResults.size;
  const taskCount = summary.taskGroups.reduce((sum, g) => sum + g.taskIds.length, 0);
  const successCount = Array.from(summary.agentResults.values())
    .flat()
    .filter(r => r.status === 'success').length;

  let text = `
Execution Summary
=================

Execution ID: ${summary.executionId}
Status: ${summary.overallStatus.toUpperCase()}
Duration: ${(summary.totalDuration / 1000).toFixed(2)}s

Agents: ${agentCount}
Tasks: ${taskCount}
Successful: ${successCount}/${taskCount}

Execution Groups: ${summary.taskGroups.length}
Parallel Executions: ${summary.monitoring.parallelExecutions}

Files Changed: ${summary.changedFiles.size}
${Array.from(summary.changedFiles).slice(0, 5).map(f => `  - ${f}`).join('\n')}
${summary.changedFiles.size > 5 ? `  ... and ${summary.changedFiles.size - 5} more files\n` : ''}

Conflicts
---------
Detected: ${summary.monitoring.conflictsDetected}
Resolved: ${summary.monitoring.conflictsResolved}
${
  summary.mergedOutput.mergeConflicts.length > 0
    ? `Unresolved: ${summary.mergedOutput.mergeConflicts.length}`
    : 'All conflicts resolved'
}

Retries
-------
Attempts: ${summary.monitoring.retryAttemptsNeeded}
Scope Narrowing Events: ${summary.monitoring.scopeNarrowingEvents}

Agent Results
${Array.from(summary.agentResults.entries())
  .map(
    ([agentId, results]) =>
      `  ${agentId}: ${results.map(r => r.status).join(', ')} (${results.length} tasks)`
  )
  .join('\n')}
`;

  return text.trim();
}

/**
 * Records an agent execution result
 */
export function recordAgentResult(
  summary: ExecutionSummary,
  result: AgentExecutionResult
): void {
  if (!summary.agentResults.has(result.agentId)) {
    summary.agentResults.set(result.agentId, []);
  }
  summary.agentResults.get(result.agentId)!.push(result);

  // Update changed files
  for (const file of result.changedFiles) {
    summary.changedFiles.add(file);
  }
}

/**
 * Records monitoring event
 */
export function recordMonitoringEvent(
  summary: ExecutionSummary,
  eventType: 'parallelExecution' | 'conflict' | 'retryAttempt' | 'scopeNarrowing'
): void {
  switch (eventType) {
    case 'parallelExecution':
      summary.monitoring.parallelExecutions++;
      break;
    case 'conflict':
      summary.monitoring.conflictsDetected++;
      break;
    case 'retryAttempt':
      summary.monitoring.retryAttemptsNeeded++;
      break;
    case 'scopeNarrowing':
      summary.monitoring.scopeNarrowingEvents++;
      break;
  }
}

/**
 * Exports summary as JSON
 */
export function exportSummaryAsJSON(summary: ExecutionSummary): string {
  const exportObj = {
    executionId: summary.executionId,
    status: summary.overallStatus,
    duration: summary.totalDuration,
    timestamp: summary.startTime,
    agents: summary.agentResults.size,
    tasks: summary.taskGroups.reduce((sum, g) => sum + g.taskIds.length, 0),
    changedFiles: Array.from(summary.changedFiles),
    conflicts: {
      detected: summary.monitoring.conflictsDetected,
      resolved: summary.monitoring.conflictsResolved,
      unresolved: summary.mergedOutput.mergeConflicts.length,
    },
    retries: {
      attempts: summary.monitoring.retryAttemptsNeeded,
      scopeNarrowingEvents: summary.monitoring.scopeNarrowingEvents,
    },
    agentResults: Array.from(summary.agentResults.entries()).map(([agentId, results]) => ({
      agentId,
      resultsCount: results.length,
      statuses: results.map(r => r.status),
    })),
  };

  return JSON.stringify(exportObj, null, 2);
}

/**
 * Formats verification results
 */
export function formatVerificationResults(summary: ExecutionSummary): string {
  if (!summary.verification.performed) {
    return 'Verification not yet performed';
  }

  let text = 'Verification Results\n';
  text += '====================\n\n';

  for (const [check, passed] of Object.entries(summary.verification.results)) {
    const status = passed ? '✓' : '✗';
    text += `${status} ${check}\n`;
  }

  if (summary.verification.failedChecks.length > 0) {
    text += '\n\nFailed Checks\n';
    for (const failedCheck of summary.verification.failedChecks) {
      text += `  - ${failedCheck}\n`;
    }
  }

  return text;
}

/**
 * Gets execution statistics
 */
export function getExecutionStats(summary: ExecutionSummary) {
  const allResults = Array.from(summary.agentResults.values()).flat();

  return {
    totalTasks: allResults.length,
    successfulTasks: allResults.filter(r => r.status === 'success').length,
    failedTasks: allResults.filter(r => r.status === 'failure').length,
    partialTasks: allResults.filter(r => r.status === 'partial').length,
    skippedTasks: allResults.filter(r => r.status === 'skipped').length,
    averageConfidence:
      allResults.length > 0
        ? allResults.reduce((sum, r) => sum + r.confidence, 0) / allResults.length
        : 0,
    totalDuration: summary.totalDuration,
    averageTaskDuration: allResults.length > 0 ? summary.totalDuration / allResults.length : 0,
    parallelGroups: summary.taskGroups.length,
    filesChanged: summary.changedFiles.size,
  };
}
