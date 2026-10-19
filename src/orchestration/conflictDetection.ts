/**
 * Conflict detection for multi-agent file edits
 */

import { FullStackTaskSpec, FileOwnershipPlan } from '@barok/core';
import { ConflictInfo, FileEditOperation, ExecutionGroup } from './types.js';

/**
 * Detects conflicts between overlapping file edits from different agents
 */
export function detectEditConflicts(
  edits: FileEditOperation[],
  agentGroups: Map<string, Set<string>>
): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];
  const fileEditMap = new Map<string, FileEditOperation[]>();

  // Group edits by file
  for (const edit of edits) {
    if (!fileEditMap.has(edit.filePath)) {
      fileEditMap.set(edit.filePath, []);
    }
    fileEditMap.get(edit.filePath)!.push(edit);
  }

  // Check for conflicts (same file edited by multiple agents)
  for (const [filePath, fileEdits] of fileEditMap.entries()) {
    if (fileEdits.length > 1) {
      const editingAgents = [...new Set(fileEdits.map(e => e.agentId))];
      if (editingAgents.length > 1) {
        conflicts.push({
          type: 'edit_conflict',
          affectedFiles: [filePath],
          conflictingAgents: editingAgents,
          reason: `Multiple agents attempted to edit ${filePath}`,
          severity: 'critical',
          suggestedResolution: `Merge edits manually or assign one agent as owner`,
        });
      }
    }
  }

  return conflicts;
}

/**
 * Detects ownership conflicts in parallel execution plan
 */
export function detectOwnershipConflicts(
  executionGroups: ExecutionGroup[],
  ownershipPlans: Map<string, FileOwnershipPlan[]>
): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];

  for (const group of executionGroups) {
    const fileOwners = new Map<string, Set<string>>();

    // Build ownership map for this group
    for (const taskId of group.taskIds) {
      const plans = ownershipPlans.get(taskId) || [];
      for (const plan of plans) {
        if (!plan.readOnly) {
          if (!fileOwners.has(plan.path)) {
            fileOwners.set(plan.path, new Set());
          }
          fileOwners.get(plan.path)!.add(plan.owner);
        }
      }
    }

    // Check for multiple owners of same file
    for (const [filePath, owners] of fileOwners.entries()) {
      if (owners.size > 1) {
        conflicts.push({
          type: 'ownership_conflict',
          affectedFiles: [filePath],
          conflictingAgents: Array.from(owners),
          reason: `File ${filePath} is owned by multiple agents: ${Array.from(owners).join(', ')}`,
          severity: 'critical',
          suggestedResolution: `Reassign ownership or mark as collaborative`,
        });
      }
    }
  }

  return conflicts;
}

/**
 * Detects dependency conflicts in execution groups
 */
export function detectDependencyConflicts(
  executionGroups: ExecutionGroup[],
  taskDependencies: Map<string, string[]>
): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];
  const groupsBySequence = new Map<number, Set<string>>();

  // Build map of tasks by sequence number
  for (const group of executionGroups) {
    if (!groupsBySequence.has(group.sequenceNumber)) {
      groupsBySequence.set(group.sequenceNumber, new Set());
    }
    for (const taskId of group.taskIds) {
      groupsBySequence.get(group.sequenceNumber)!.add(taskId);
    }
  }

  // Check for backward dependencies (task depends on later task)
  for (let seq = 0; seq < executionGroups.length; seq++) {
    const tasksAtSeq = groupsBySequence.get(seq) || new Set();

    for (const taskId of tasksAtSeq) {
      const deps = taskDependencies.get(taskId) || [];
      for (const depId of deps) {
        // Find which sequence contains the dependency
        let depSeq = -1;
        for (let s = 0; s < executionGroups.length; s++) {
          if (groupsBySequence.get(s)?.has(depId)) {
            depSeq = s;
            break;
          }
        }

        // Conflict if dependency is in same or later sequence
        if (depSeq >= seq) {
          conflicts.push({
            type: 'dependency_conflict',
            affectedFiles: [],
            conflictingAgents: [taskId],
            reason: `Task ${taskId} depends on ${depId}, but dependency is not in an earlier sequence`,
            severity: 'critical',
            suggestedResolution: `Reorder execution groups to resolve dependency`,
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * Checks if an execution plan has no conflicts
 */
export function hasConflicts(conflicts: ConflictInfo[]): boolean {
  return conflicts.some(c => c.severity === 'critical');
}

/**
 * Gets all conflicting agent pairs
 */
export function getConflictingAgentPairs(conflicts: ConflictInfo[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];

  for (const conflict of conflicts) {
    const agents = conflict.conflictingAgents;
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        pairs.push([agents[i], agents[j]]);
      }
    }
  }

  return pairs;
}

/**
 * Formats conflicts into a readable report
 */
export function formatConflictReport(conflicts: ConflictInfo[]): string {
  if (conflicts.length === 0) {
    return 'No conflicts detected';
  }

  const critical = conflicts.filter(c => c.severity === 'critical');
  const warnings = conflicts.filter(c => c.severity === 'warning');
  const infos = conflicts.filter(c => c.severity === 'info');

  let report = `Found ${conflicts.length} conflict(s):\n\n`;

  if (critical.length > 0) {
    report += `CRITICAL (${critical.length}):\n`;
    for (const conflict of critical) {
      report += `  - ${conflict.type}: ${conflict.reason}\n`;
      if (conflict.suggestedResolution) {
        report += `    Resolution: ${conflict.suggestedResolution}\n`;
      }
    }
    report += '\n';
  }

  if (warnings.length > 0) {
    report += `WARNING (${warnings.length}):\n`;
    for (const conflict of warnings) {
      report += `  - ${conflict.type}: ${conflict.reason}\n`;
    }
    report += '\n';
  }

  if (infos.length > 0) {
    report += `INFO (${infos.length}):\n`;
    for (const conflict of infos) {
      report += `  - ${conflict.type}: ${conflict.reason}\n`;
    }
  }

  return report;
}
