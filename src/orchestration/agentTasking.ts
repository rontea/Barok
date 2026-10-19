/**
 * Phase 4.1 - Agent Task Types & Bounded Specifications
 * Defines bounded agent tasks with explicit inputs, outputs, owned files, and stop conditions
 */

import type { ExecutionLayer } from '../repo/workPlanOrchestrator.js';

/**
 * Represents a bounded agent task with explicit inputs, outputs, and constraints
 * Ensures each agent has clear scope, success criteria, and termination conditions
 */
export interface BoundedAgentTask {
  // Identity and routing
  id: string; // Unique task identifier
  agentRole: 'frontend' | 'backend' | 'data' | 'test' | 'reviewer' | 'documentation';

  // Task specification
  userRequest: string; // Original user request or subtask description
  classification: 'bug_fix' | 'feature' | 'refactor' | 'test_only' | 'docs_only' | 'infrastructure' | 'investigation';
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'expert';

  // Input specification
  inputs: {
    codeContext?: string; // Relevant code snippets for context
    specifications?: Record<string, string>; // Key specifications (e.g., API endpoint, component name)
    testData?: Record<string, unknown>; // Test data or fixtures
    configuration?: Record<string, unknown>; // Config overrides or parameters
  };

  // Output specification
  expectedOutputs: {
    changedFiles: string[]; // Expected files to be modified
    fileTypes: string[]; // Expected file types (ts, tsx, sql, etc.)
    outputFormat?: 'code' | 'documentation' | 'test' | 'mixed'; // Output format hint
  };

  // Ownership and scope
  ownedFiles: string[]; // Files this agent owns/can modify
  touchedLayers: ExecutionLayer[]; // Layers this task affects
  allowedTools: string[]; // Allowed tools for this task

  // Execution constraints
  stopConditions: {
    type: 'all_tests_pass' | 'file_count' | 'modification_complete' | 'time_limit' | 'linting_clean' | 'custom';
    value?: unknown; // Condition-specific value (e.g., max files: 10)
    description: string;
  }[];

  // Resource limits
  timeoutMs: number; // Max execution time in milliseconds
  maxRetries: number; // Maximum retry attempts on failure
  maxFilesToModify?: number; // Safety limit on file modifications

  // Task relationships
  dependsOn?: string[]; // Task IDs that must complete first
  blockingTasks?: string[]; // Task IDs waiting on this task
  parentTaskId?: string; // Parent task if this is a subtask

  // Metadata
  createdAt: number; // Timestamp when task was created
  priority: 'low' | 'medium' | 'high' | 'critical'; // Task priority
  retryContext?: string; // Context from previous retry (error details, narrowed scope, etc.)
}

/**
 * Represents the execution state of an agent task
 */
export interface AgentTaskExecution {
  // Task reference
  taskId: string;
  agentRole: string;

  // Execution state
  status: 'pending' | 'assigned' | 'executing' | 'paused' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0-100 percentage

  // Timing
  startTime?: number;
  endTime?: number;
  durationMs?: number;
  lastUpdatedAt: number;

  // Results
  outputs: {
    changedFiles: string[];
    commandsRun: string[];
    testResults?: Record<string, boolean>;
    errors?: string[];
    warnings?: string[];
    metrics?: Record<string, number>;
  };

  // Error tracking
  errors: Array<{
    message: string;
    code?: string;
    timestamp: number;
    recoverable: boolean;
  }>;

  // Quality metrics
  confidence: number; // 0-1 confidence score
  stopConditionsMetAt?: string; // Which stop condition was met

  // Retry tracking
  attemptNumber: number;
  retryHistory: Array<{
    attemptNumber: number;
    error: string;
    errorCode?: string;
    durationMs?: number;
    scopeNarrowed?: string[];
    timestamp: number;
  }>;
}

/**
 * Validates that a task is well-formed and can be executed
 */
export function validateBoundedAgentTask(task: BoundedAgentTask): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Required fields
  if (!task.id) errors.push('Task must have an id');
  if (!task.userRequest) errors.push('Task must have a userRequest');
  if (!task.agentRole) errors.push('Task must have an agentRole');
  if (!task.classification) errors.push('Task must have a classification');

  // Owned files
  if (!task.ownedFiles || task.ownedFiles.length === 0) {
    errors.push('Task must have at least one owned file');
  }

  // Expected outputs
  if (!task.expectedOutputs || task.expectedOutputs.changedFiles.length === 0) {
    errors.push('Task must specify at least one expected changed file');
  }

  // Stop conditions
  if (!task.stopConditions || task.stopConditions.length === 0) {
    errors.push('Task must have at least one stop condition');
  }

  // Timeout
  if (task.timeoutMs <= 0) {
    errors.push('Task must have a positive timeout value');
  }

  // Max retries
  if (task.maxRetries < 0) {
    errors.push('Task must have non-negative maxRetries');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates task status transitions
 */
export function canTransitionTaskStatus(
  fromStatus: AgentTaskExecution['status'],
  toStatus: AgentTaskExecution['status']
): boolean {
  const validTransitions: Record<string, AgentTaskExecution['status'][]> = {
    pending: ['assigned', 'cancelled'],
    assigned: ['executing', 'cancelled'],
    executing: ['paused', 'completed', 'failed'],
    paused: ['executing', 'cancelled'],
    completed: [],
    failed: ['assigned', 'cancelled'], // Can retry or cancel
    cancelled: [],
  };

  return validTransitions[fromStatus]?.includes(toStatus) ?? false;
}

/**
 * Creates a new agent task execution tracker
 */
export function createTaskExecution(taskId: string, agentRole: string): AgentTaskExecution {
  return {
    taskId,
    agentRole,
    status: 'pending',
    progress: 0,
    lastUpdatedAt: Date.now(),
    outputs: {
      changedFiles: [],
      commandsRun: [],
    },
    errors: [],
    confidence: 0,
    attemptNumber: 1,
    retryHistory: [],
  };
}

/**
 * Updates task execution status with validation
 */
export function updateTaskExecutionStatus(
  execution: AgentTaskExecution,
  newStatus: AgentTaskExecution['status']
): {
  success: boolean;
  error?: string;
  updated?: AgentTaskExecution;
} {
  if (!canTransitionTaskStatus(execution.status, newStatus)) {
    return {
      success: false,
      error: `Cannot transition from ${execution.status} to ${newStatus}`,
    };
  }

  const updated = { ...execution, status: newStatus, lastUpdatedAt: Date.now() };

  if (newStatus === 'executing' && !execution.startTime) {
    (updated as any).startTime = Date.now();
  }

  if ((newStatus === 'completed' || newStatus === 'failed' || newStatus === 'cancelled') && !execution.endTime) {
    (updated as any).endTime = Date.now();
    (updated as any).durationMs = (updated as any).endTime - ((updated as any).startTime || Date.now());
  }

  return { success: true, updated };
}

/**
 * Records a task execution error
 */
export function recordTaskError(
  execution: AgentTaskExecution,
  error: string,
  recoverable: boolean = true,
  code?: string
): AgentTaskExecution {
  return {
    ...execution,
    errors: [
      ...execution.errors,
      {
        message: error,
        code,
        timestamp: Date.now(),
        recoverable,
      },
    ],
  };
}

/**
 * Records a retry attempt with narrowed scope
 */
export function recordRetryAttempt(
  execution: AgentTaskExecution,
  error: string,
  scopeNarrowed?: string[]
): AgentTaskExecution {
  return {
    ...execution,
    attemptNumber: execution.attemptNumber + 1,
    retryHistory: [
      ...execution.retryHistory,
      {
        attemptNumber: execution.attemptNumber,
        error,
        scopeNarrowed,
        timestamp: Date.now(),
      },
    ],
  };
}

/**
 * Checks if task timeout has been exceeded
 */
export function hasTaskTimedOut(execution: AgentTaskExecution, timeoutMs: number): boolean {
  if (!execution.startTime) return false;
  const elapsed = Date.now() - execution.startTime;
  return elapsed > timeoutMs;
}

/**
 * Calculates task completion percentage based on outputs
 */
export function calculateTaskProgress(
  execution: AgentTaskExecution,
  expectedFiles: number,
  stopConditions: number
): number {
  let progress = 0;

  // Files modified: up to 60%
  if (expectedFiles > 0) {
    const fileRatio = Math.min(execution.outputs.changedFiles.length / expectedFiles, 1);
    progress += fileRatio * 0.6;
  }

  // Commands executed: up to 10%
  if (execution.outputs.commandsRun && execution.outputs.commandsRun.length > 0) {
    progress += 0.1;
  }

  // Stop conditions met: up to 30%
  if (execution.stopConditionsMetAt) {
    progress += 0.3;
  } else if (stopConditions > 0 && execution.errors.length === 0) {
    // Partial credit if no errors (approaching stop condition)
    progress += 0.1;
  }

  return Math.round(Math.min(progress * 100, 100));
}
