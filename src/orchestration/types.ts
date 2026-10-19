/**
 * Type definitions for sub-agent parallelization framework
 */

import { FullStackTaskSpec, FileOwnershipPlan } from '@barok/core';

/**
 * Represents a file edit operation with path and content change
 */
export interface FileEditOperation {
  filePath: string;
  originalContent: string;
  newContent: string;
  agentId: string;
  timestamp: number;
}

/**
 * Represents a conflict between two file edits
 */
export interface ConflictInfo {
  type: 'ownership_conflict' | 'edit_conflict' | 'dependency_conflict';
  affectedFiles: string[];
  conflictingAgents: string[];
  reason: string;
  severity: 'critical' | 'warning' | 'info';
  suggestedResolution?: string;
}

/**
 * Represents the result of a single agent's execution
 */
export interface AgentExecutionResult {
  agentId: string;
  taskId: string;
  status: 'success' | 'failure' | 'partial' | 'skipped';
  changedFiles: string[];
  editOperations: FileEditOperation[];
  commandsRun: string[];
  output: string;
  errors: string[];
  warnings: string[];
  confidence: number; // 0-1 score
  duration: number; // milliseconds
  timestamp: number;
  retryAttempts: number;
  verificationResults?: Record<string, boolean>;
}

/**
 * Represents an execution group of tasks that can run in parallel
 */
export interface ExecutionGroup {
  groupId: string;
  sequenceNumber: number;
  taskIds: string[];
  agentIds: string[];
  ownedFiles: Map<string, string[]>; // agent -> [files]
  dependencies: string[]; // task IDs from previous groups
  canRunInParallel: boolean;
  estimatedDuration: number;
}

/**
 * Represents a merged output from multiple agents
 */
export interface MergedOutput {
  taskIds: string[];
  agentIds: string[];
  mergedFiles: Map<string, string>; // file path -> final content
  mergeConflicts: ConflictInfo[];
  resolutionLog: string[];
  integrityChecks: {
    name: string;
    passed: boolean;
    details: string;
  }[];
}

/**
 * Represents a scoped retry task after a failure
 */
export interface ScopedRetryTask {
  originalTaskId: string;
  retryNumber: number;
  narrowedScope: string[]; // subset of affected files
  narrowingReason: string;
  failureAnalysis: string;
  previousAttempts: AgentExecutionResult[];
}

/**
 * Represents a complete execution summary
 */
export interface ExecutionSummary {
  executionId: string;
  startTime: number;
  endTime: number;
  totalDuration: number;
  taskGroups: ExecutionGroup[];
  agentResults: Map<string, AgentExecutionResult[]>;
  conflicts: ConflictInfo[];
  mergedOutput: MergedOutput;
  retryLog: {
    taskId: string;
    attempts: number;
    finalStatus: 'success' | 'failure';
    scopeNarrowingSteps: string[];
  }[];
  overallStatus: 'success' | 'partial_failure' | 'failure';
  changedFiles: Set<string>;
  verification: {
    performed: boolean;
    results: Record<string, boolean>;
    failedChecks: string[];
  };
  monitoring: {
    parallelExecutions: number;
    conflictsDetected: number;
    conflictsResolved: number;
    retryAttemptsNeeded: number;
    scopeNarrowingEvents: number;
  };
  summary: string;
}

/**
 * Options for parallel execution strategy
 */
export interface ParallelExecutionOptions {
  maxParallelGroups?: number;
  retryStrategy?: 'narrow_scope' | 'full_retry' | 'skip';
  maxRetries?: number;
  conflictResolutionMode?: 'strict' | 'lenient' | 'merge_first';
  enableMonitoring?: boolean;
  enableLogging?: boolean;
}
