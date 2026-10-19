/**
 * Phase 4.4 - Execution Planner
 * Plans task execution order with parallel detection, dependency resolution, and resource optimization
 */

import type { BoundedAgentTask, AgentTaskExecution } from './agentTasking.js';
import type { FullStackWorkPlan, ExecutionLayer } from '../repo/workPlanOrchestrator.js';

/**
 * Represents a group of independent tasks that can execute in parallel
 */
export interface ExecutionGroup {
  id: string;
  tasks: BoundedAgentTask[];
  parallelizable: boolean;
  estimatedDurationMs: number;
  dependsOnGroups: string[];
  blockedByGroups: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * Execution plan with ordering and parallelization strategy
 */
export interface ExecutionPlan {
  groups: ExecutionGroup[];
  totalEstimatedDurationMs: number;
  parallelizationScore: number; // 0-100: higher = more parallelizable
  criticalPath: string[]; // Sequence of task/group IDs on critical path
  estimatedResourceUsage: {
    maxConcurrentTasks: number;
    totalFilesModified: number;
    totalCommandsRun: number;
  };
  warnings: string[];
}

/**
 * Task dependency information
 */
export interface TaskDependency {
  taskId: string;
  dependsOn: string[];
  blockedBy: string[];
  fileConflicts: Array<{
    file: string;
    conflictingTasks: string[];
  }>;
}

/**
 * Complexity estimation for tasks
 */
const COMPLEXITY_DURATIONS: Record<BoundedAgentTask['complexity'], number> = {
  trivial: 5000, // 5 seconds
  simple: 15000, // 15 seconds
  moderate: 45000, // 45 seconds
  complex: 120000, // 2 minutes
  expert: 300000, // 5 minutes
};

/**
 * Detects if two tasks have file conflicts
 */
export function hasFileConflict(task1: BoundedAgentTask, task2: BoundedAgentTask): boolean {
  const files1 = new Set(task1.expectedOutputs.changedFiles);
  const files2 = new Set(task2.expectedOutputs.changedFiles);

  for (const file of files1) {
    if (files2.has(file)) return true;
  }

  return false;
}

/**
 * Detects if two tasks have layer conflicts (e.g., both modify backend)
 */
export function hasLayerConflict(task1: BoundedAgentTask, task2: BoundedAgentTask): boolean {
  const layers1 = new Set(task1.touchedLayers);
  const layers2 = new Set(task2.touchedLayers);

  for (const layer of layers1) {
    if (layers2.has(layer)) return true;
  }

  return false;
}

/**
 * Detects if two tasks can execute in parallel
 */
export function canRunInParallel(
  task1: BoundedAgentTask,
  task2: BoundedAgentTask,
  allowLayerConflicts: boolean = false
): boolean {
  // File conflicts prevent parallel execution
  if (hasFileConflict(task1, task2)) return false;

  // Different agents can work on different layers
  if (task1.agentRole !== task2.agentRole) {
    // Allow different agents to work on different layers
    if (!allowLayerConflicts && hasLayerConflict(task1, task2)) {
      return false;
    }
  } else {
    // Same agent shouldn't have layer conflicts
    if (hasLayerConflict(task1, task2)) return false;
  }

  return true;
}

/**
 * Analyzes task dependencies
 */
export function analyzeDependencies(tasks: BoundedAgentTask[]): Map<string, TaskDependency> {
  const dependencies = new Map<string, TaskDependency>();

  for (const task of tasks) {
    const dep: TaskDependency = {
      taskId: task.id,
      dependsOn: task.dependsOn || [],
      blockedBy: task.blockingTasks || [],
      fileConflicts: [],
    };

    // Find file conflicts with other tasks
    for (const otherTask of tasks) {
      if (otherTask.id !== task.id && hasFileConflict(task, otherTask)) {
        const existingConflict = dep.fileConflicts.find((c) => c.file === otherTask.id);
        if (existingConflict) {
          existingConflict.conflictingTasks.push(otherTask.id);
        } else {
          for (const file of otherTask.expectedOutputs.changedFiles) {
            if (task.expectedOutputs.changedFiles.includes(file)) {
              dep.fileConflicts.push({
                file,
                conflictingTasks: [otherTask.id],
              });
            }
          }
        }
      }
    }

    dependencies.set(task.id, dep);
  }

  return dependencies;
}

/**
 * Groups independent tasks for parallel execution
 */
export function groupTasksForParallel(tasks: BoundedAgentTask[]): BoundedAgentTask[][] {
  if (tasks.length === 0) return [];

  const groups: BoundedAgentTask[][] = [];
  const used = new Set<string>();

  for (const task of tasks) {
    if (used.has(task.id)) continue;

    // Start a new group with this task
    const group: BoundedAgentTask[] = [task];
    used.add(task.id);

    // Try to add more tasks to this group
    for (const otherTask of tasks) {
      if (!used.has(otherTask.id) && group.every((t) => canRunInParallel(t, otherTask))) {
        group.push(otherTask);
        used.add(otherTask.id);
      }
    }

    groups.push(group);
  }

  return groups;
}

/**
 * Respects explicit task dependencies
 */
export function orderByDependencies(
  tasks: BoundedAgentTask[],
  dependencies: Map<string, TaskDependency>
): BoundedAgentTask[] {
  const ordered: BoundedAgentTask[] = [];
  const pending = new Set(tasks.map((t) => t.id));
  const maxIterations = tasks.length * 2;
  let iterations = 0;

  while (pending.size > 0 && iterations < maxIterations) {
    iterations++;
    let added = false;

    for (const taskId of Array.from(pending)) {
      const task = tasks.find((t) => t.id === taskId)!;
      const dep = dependencies.get(taskId)!;

      // Check if all dependencies are satisfied
      const dependenciesSatisfied = dep.dependsOn.every((depId) =>
        ordered.some((t) => t.id === depId)
      );

      if (dependenciesSatisfied) {
        ordered.push(task);
        pending.delete(taskId);
        added = true;
      }
    }

    if (!added && pending.size > 0) {
      // Circular dependency or all remaining have unmet deps
      // Add next pending task anyway
      const taskId = Array.from(pending)[0];
      const task = tasks.find((t) => t.id === taskId)!;
      ordered.push(task);
      pending.delete(taskId);
    }
  }

  return ordered;
}

/**
 * Creates execution groups respecting dependencies
 */
export function createExecutionGroups(tasks: BoundedAgentTask[]): ExecutionGroup[] {
  if (tasks.length === 0) return [];

  const dependencies = analyzeDependencies(tasks);
  const orderedTasks = orderByDependencies(tasks, dependencies);
  const parallelGroups = groupTasksForParallel(orderedTasks);

  const groups: ExecutionGroup[] = [];
  let groupSequence = 0;

  for (const groupTasks of parallelGroups) {
    const groupId = `group-${groupSequence++}`;

    // Determine dependencies on previous groups
    const dependsOnGroups: string[] = [];
    const usedTaskIds = new Set(groups.flatMap((g) => g.tasks.map((t) => t.id)));

    for (const task of groupTasks) {
      const taskDeps = dependencies.get(task.id)!;
      for (const depId of taskDeps.dependsOn) {
        for (const prevGroup of groups) {
          if (prevGroup.tasks.some((t) => t.id === depId)) {
            dependsOnGroups.push(prevGroup.id);
          }
        }
      }
    }

    // Remove duplicates
    const uniqueDependencies = Array.from(new Set(dependsOnGroups));

    const estimatedDurationMs = Math.max(
      ...groupTasks.map((t) => COMPLEXITY_DURATIONS[t.complexity] || 30000)
    );

    groups.push({
      id: groupId,
      tasks: groupTasks,
      parallelizable: groupTasks.length > 1,
      estimatedDurationMs,
      dependsOnGroups: uniqueDependencies,
      blockedByGroups: [], // Will be calculated from other groups
      priority:
        groupTasks.some((t) => t.priority === 'critical')
          ? 'critical'
          : groupTasks.some((t) => t.priority === 'high')
            ? 'high'
            : 'medium',
    });
  }

  // Calculate blockedByGroups
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (groups[j].dependsOnGroups.includes(groups[i].id)) {
        groups[i].blockedByGroups.push(groups[j].id);
      }
    }
  }

  return groups;
}

/**
 * Creates complete execution plan
 */
export function createExecutionPlan(
  tasks: BoundedAgentTask[],
  workPlan: FullStackWorkPlan
): ExecutionPlan {
  const groups = createExecutionGroups(tasks);
  const warnings: string[] = [];

  // Calculate total estimated duration
  let totalEstimatedDurationMs = 0;
  let maxConcurrentTasks = 0;

  for (const group of groups) {
    totalEstimatedDurationMs += group.estimatedDurationMs;
    maxConcurrentTasks = Math.max(maxConcurrentTasks, group.tasks.length);

    if (group.tasks.length > 3) {
      warnings.push(`Group ${group.id} has ${group.tasks.length} concurrent tasks`);
    }
  }

  // Calculate parallelization score
  const possibleParallelTaskCount = tasks.length;
  const actualParallelTaskCount = groups.reduce((sum, g) => sum + (g.tasks.length - 1), 0);
  const parallelizationScore = Math.round(
    (actualParallelTaskCount / Math.max(possibleParallelTaskCount - 1, 1)) * 100
  );

  // Calculate critical path
  const criticalPath = calculateCriticalPath(groups);

  // Calculate resource usage
  const totalFilesModified = tasks.reduce((sum, t) => sum + t.expectedOutputs.changedFiles.length, 0);
  const totalCommandsRun = tasks.length * 3; // Estimate

  if (totalFilesModified > 100) {
    warnings.push(`Large change set: ${totalFilesModified} files modified`);
  }

  return {
    groups,
    totalEstimatedDurationMs,
    parallelizationScore,
    criticalPath,
    estimatedResourceUsage: {
      maxConcurrentTasks,
      totalFilesModified,
      totalCommandsRun,
    },
    warnings,
  };
}

/**
 * Calculates the critical path through execution groups
 */
export function calculateCriticalPath(groups: ExecutionGroup[]): string[] {
  const path: string[] = [];
  const visited = new Set<string>();

  function traverse(groupId: string): number {
    if (visited.has(groupId)) return 0;
    visited.add(groupId);

    const group = groups.find((g) => g.id === groupId);
    if (!group) return 0;

    let maxDownstreamDuration = 0;
    for (const blockedGroupId of group.blockedByGroups) {
      const duration = traverse(blockedGroupId);
      if (duration > maxDownstreamDuration) {
        maxDownstreamDuration = duration;
      }
    }

    return group.estimatedDurationMs + maxDownstreamDuration;
  }

  // Start from first groups with no dependencies
  const startGroups = groups.filter((g) => g.dependsOnGroups.length === 0);

  for (const group of startGroups) {
    visited.clear();
    const groupPath = [group.id];
    let currentGroup = group;

    while (currentGroup.blockedByGroups.length > 0) {
      // Find the blocked group with longest estimated duration
      let nextGroup = groups.find((g) => g.id === currentGroup.blockedByGroups[0])!;
      let maxDuration = nextGroup.estimatedDurationMs;

      for (const blockedId of currentGroup.blockedByGroups.slice(1)) {
        const g = groups.find((g) => g.id === blockedId)!;
        if (g.estimatedDurationMs > maxDuration) {
          maxDuration = g.estimatedDurationMs;
          nextGroup = g;
        }
      }

      groupPath.push(nextGroup.id);
      currentGroup = nextGroup;
    }

    if (groupPath.length > path.length) {
      path.length = 0;
      path.push(...groupPath);
    }
  }

  return path;
}

/**
 * Estimates resource requirements
 */
export function estimateResources(plan: ExecutionPlan): {
  estimatedTimeMinutes: number;
  estimatedMemoryMb: number;
  estimatedCpuCores: number;
} {
  return {
    estimatedTimeMinutes: Math.ceil(plan.totalEstimatedDurationMs / 60000),
    estimatedMemoryMb: Math.max(256, plan.estimatedResourceUsage.maxConcurrentTasks * 128),
    estimatedCpuCores: plan.estimatedResourceUsage.maxConcurrentTasks,
  };
}
