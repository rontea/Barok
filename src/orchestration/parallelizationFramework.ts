/**
 * Main parallelization framework for sub-agent coordination
 */

import { FullStackTaskSpec, orderTasksByDependency, detectParallelCompatibility } from '@barok/core';
import {
  ExecutionGroup,
  ParallelExecutionOptions,
  ScopedRetryTask,
  ExecutionSummary,
  AgentExecutionResult,
  FileEditOperation,
} from './types.js';
import {
  detectEditConflicts,
  detectOwnershipConflicts,
  detectDependencyConflicts,
  hasConflicts,
} from './conflictDetection.js';
import { mergeAgentOutputs, validateMergedOutput } from './mergeReconciliation.js';
import {
  createExecutionSummary,
  generateExecutionSummary,
  recordAgentResult,
  getExecutionStats,
} from './executionSummary.js';

/**
 * Validates ownership plans before parallel execution
 */
export function validateOwnershipPlans(tasks: FullStackTaskSpec[]): boolean {
  const allOwnedFiles = new Map<string, string>();

  for (const task of tasks) {
    for (const plan of task.ownershipPlan) {
      if (!plan.readOnly) {
        if (allOwnedFiles.has(plan.path)) {
          const existingOwner = allOwnedFiles.get(plan.path)!;
          if (existingOwner !== plan.owner) {
            // Conflict - same file owned by different owners
            return false;
          }
        }
        allOwnedFiles.set(plan.path, plan.owner);
      }
    }
  }

  return true;
}

/**
 * Creates execution groups for parallel task execution
 */
export function planParallelExecution(
  tasks: FullStackTaskSpec[],
  options: ParallelExecutionOptions = {}
): ExecutionGroup[] {
  const maxGroups = options.maxParallelGroups || 10;
  const groups: ExecutionGroup[] = [];

  // Order tasks by dependency
  const orderedTasks = orderTasksByDependency(tasks);

  // Track which tasks have been scheduled
  const scheduled = new Set<string>();

  let sequenceNumber = 0;

  while (scheduled.size < orderedTasks.length && sequenceNumber < maxGroups) {
    const groupTasks: string[] = [];
    const groupDependencies: string[] = [];
    const groupTaskObjects: FullStackTaskSpec[] = [];

    // Try to add tasks to this group
    for (const task of orderedTasks) {
      if (scheduled.has(task.id)) {
        continue;
      }

      // Check if dependencies are met
      const unmetDeps = task.dependencies.filter(
        d => d.type === 'hard' && !scheduled.has(d.dependsOn)
      );

      if (unmetDeps.length > 0) {
        // Hard dependencies not met - skip for now
        continue;
      }

      // Check if this task is compatible with existing group tasks
      if (groupTaskObjects.length > 0) {
        let compatible = true;
        for (const groupTask of groupTaskObjects) {
          if (!detectParallelCompatibility(task, groupTask)) {
            compatible = false;
            break;
          }
        }

        if (!compatible) {
          continue;
        }
      }

      // Add to group
      groupTasks.push(task.id);
      groupTaskObjects.push(task);
      scheduled.add(task.id);

      // Collect dependencies
      for (const dep of task.dependencies) {
        if (!groupDependencies.includes(dep.dependsOn)) {
          groupDependencies.push(dep.dependsOn);
        }
      }
    }

    if (groupTasks.length > 0) {
      const agentIds = [
        ...new Set(groupTaskObjects.flatMap(t => t.implementationOrder)),
      ];

      const ownedFiles = new Map<string, string[]>();
      for (const task of groupTaskObjects) {
        for (const plan of task.ownershipPlan) {
          if (!plan.readOnly) {
            if (!ownedFiles.has(plan.owner)) {
              ownedFiles.set(plan.owner, []);
            }
            ownedFiles.get(plan.owner)!.push(plan.path);
          }
        }
      }

      const group: ExecutionGroup = {
        groupId: `group-${sequenceNumber}-${Date.now()}`,
        sequenceNumber,
        taskIds: groupTasks,
        agentIds,
        ownedFiles,
        dependencies: groupDependencies,
        canRunInParallel: groupTasks.length > 1,
        estimatedDuration: Math.max(...groupTaskObjects.map(t => t.estimatedComplexity?.length || 0)),
      };

      groups.push(group);
      sequenceNumber++;
    }
  }

  return groups;
}

/**
 * Validates execution plan for conflicts
 */
export function validateExecutionPlan(
  groups: ExecutionGroup[],
  tasks: Map<string, FullStackTaskSpec>
) {
  const taskDependencies = new Map<string, string[]>();
  const ownershipPlans = new Map<string, any[]>();

  for (const [taskId, task] of tasks) {
    taskDependencies.set(
      taskId,
      task.dependencies.map(d => d.dependsOn)
    );
    ownershipPlans.set(taskId, task.ownershipPlan);
  }

  const conflicts = [
    ...detectEditConflicts([], new Map()),
    ...detectOwnershipConflicts(groups, ownershipPlans),
    ...detectDependencyConflicts(groups, taskDependencies),
  ];

  return { valid: !hasConflicts(conflicts), conflicts };
}

/**
 * Creates a scoped retry task that narrows the scope
 */
export function createScopedRetry(
  originalTask: FullStackTaskSpec,
  failureResult: AgentExecutionResult,
  retryNumber: number,
  failureAnalysis: string
): ScopedRetryTask {
  // Narrow scope to only failed files
  const failedFiles = failureResult.changedFiles;

  const narrowedAffectedFiles = originalTask.affectedFiles.filter(pattern => {
    // This is a simplified filter - in practice, would use glob matching
    return failedFiles.some(file => file.includes(pattern) || pattern.includes(file));
  });

  // If couldn't narrow by pattern, just use the failed files
  const finalScope = narrowedAffectedFiles.length > 0 ? narrowedAffectedFiles : failedFiles;

  return {
    originalTaskId: originalTask.id,
    retryNumber,
    narrowedScope: finalScope,
    narrowingReason: `Narrowed to ${finalScope.length} affected file(s) from ${originalTask.affectedFiles.length}`,
    failureAnalysis,
    previousAttempts: [failureResult],
  };
}

/**
 * Processes parallel execution results and merges outputs
 */
export function processParallelResults(
  results: AgentExecutionResult[],
  tasks: ExecutionGroup[]
): ExecutionSummary {
  // Group results by agent
  const agentResultsMap = new Map<string, AgentExecutionResult[]>();
  const edits: FileEditOperation[] = [];

  for (const result of results) {
    if (!agentResultsMap.has(result.agentId)) {
      agentResultsMap.set(result.agentId, []);
    }
    agentResultsMap.get(result.agentId)!.push(result);
    edits.push(...result.editOperations);
  }

  // Extract task IDs from results
  const taskIds = [...new Set(results.map(r => r.taskId))];
  const agentIds = Array.from(agentResultsMap.keys());

  // Detect conflicts between edits
  const editConflicts = detectEditConflicts(edits, new Map());

  // Merge outputs
  const mergedOutput = mergeAgentOutputs(edits, taskIds, agentIds);

  // Create summary
  const summary = createExecutionSummary(tasks, agentResultsMap, editConflicts, mergedOutput);

  // Record all results
  for (const result of results) {
    recordAgentResult(summary, result);
  }

  // Generate summary text
  summary.summary = generateExecutionSummary(summary);

  return summary;
}

/**
 * Determines if a task should be retried with narrowed scope
 */
export function shouldRetryWithNarrowedScope(result: AgentExecutionResult, maxRetries: number = 3): boolean {
  return result.status === 'failure' && result.retryAttempts < maxRetries;
}

/**
 * Gets next execution steps after failures
 */
export function getRetryStrategy(
  failedResults: AgentExecutionResult[],
  strategy: 'narrow_scope' | 'full_retry' | 'skip' = 'narrow_scope'
): 'retry_narrowed' | 'retry_full' | 'skip' | 'escalate' {
  const criticalFailures = failedResults.filter(r => r.confidence < 0.2);

  // Only escalate if more than 75% are critical failures with very low confidence
  if (failedResults.length > 2 && criticalFailures.length > (failedResults.length * 0.75)) {
    return 'escalate';
  }

  switch (strategy) {
    case 'narrow_scope':
      return 'retry_narrowed';
    case 'full_retry':
      return 'retry_full';
    case 'skip':
      return 'skip';
    default:
      return 'escalate';
  }
}

/**
 * Formats parallel execution plan for logging
 */
export function formatExecutionPlan(groups: ExecutionGroup[]): string {
  let plan = 'Parallel Execution Plan\n';
  plan += '=======================\n\n';

  for (const group of groups) {
    plan += `Group ${group.sequenceNumber} (${group.groupId})\n`;
    plan += `Tasks: ${group.taskIds.join(', ')}\n`;
    plan += `Agents: ${group.agentIds.join(', ')}\n`;
    plan += `Parallel: ${group.canRunInParallel}\n`;

    if (group.ownedFiles.size > 0) {
      plan += `Owned Files:\n`;
      for (const [agent, files] of group.ownedFiles) {
        plan += `  ${agent}: ${files.join(', ')}\n`;
      }
    }

    if (group.dependencies.length > 0) {
      plan += `Dependencies: ${group.dependencies.join(', ')}\n`;
    }

    plan += '\n';
  }

  return plan;
}

/**
 * Calculates parallel execution efficiency metrics
 */
export function calculateEfficiencyMetrics(
  groups: ExecutionGroup[],
  results: ExecutionSummary
) {
  const stats = getExecutionStats(results);

  const parallelGroups = groups.filter(g => g.canRunInParallel);
  const sequentialGroups = groups.filter(g => !g.canRunInParallel);

  const potentialSpeedup =
    sequentialGroups.length > 0 ? groups.length / sequentialGroups.length : 1;

  return {
    totalGroups: groups.length,
    parallelGroups: parallelGroups.length,
    sequentialGroups: sequentialGroups.length,
    potentialSpeedup,
    actualSuccessRate: stats.successfulTasks / stats.totalTasks,
    averageConfidence: stats.averageConfidence,
    filesChanged: stats.filesChanged,
    unresolvedConflicts: results.mergedOutput.mergeConflicts.length,
  };
}
