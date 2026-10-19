/**
 * Phase 4.7 - Retry Logic with Scope Narrowing
 * Implements exponential backoff and scope narrowing on failures
 */

import type { BoundedAgentTask, AgentTaskExecution } from './agentTasking.js';

/**
 * Retry strategy for a failed task
 */
export interface RetryStrategy {
  shouldRetry: boolean;
  reason: string;
  nextAttempt: number;
  delayMs: number;
  scopeNarrowing?: {
    excludeFiles: string[];
    excludeLayers: string[];
    reduceComplexity: boolean;
    reason: string;
  };
  escalationRequired: boolean;
  escalationPath?: string;
}

/**
 * Retry configuration for task execution
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number; // Exponential backoff factor
  scopeNarrowingFactor: number; // How aggressively to narrow scope (0.25 = 25% reduction per retry)
  escalateAfterAttempts: number;
  escalationCriteria: {
    maxConsecutiveErrors: number;
    timeoutThreshold: number;
    errorTypeThreshold: Record<string, number>;
  };
}

/**
 * Retry history tracking
 */
export interface RetryHistory {
  attemptNumber: number;
  error: string;
  errorCode?: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  scopeNarrowedBy?: string[];
  recovery: boolean;
}

/**
 * Creates default retry configuration
 */
export function createDefaultRetryConfig(): RetryConfig {
  return {
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    scopeNarrowingFactor: 0.33, // Reduce scope by ~33% each retry
    escalateAfterAttempts: 2,
    escalationCriteria: {
      maxConsecutiveErrors: 2,
      timeoutThreshold: 300000, // 5 minutes
      errorTypeThreshold: {
        timeout: 1,
        'file-conflict': 1,
        'dependency-error': 1,
        'auth-error': 1,
      },
    },
  };
}

/**
 * Determines if a task should be retried
 */
export function shouldRetry(
  execution: AgentTaskExecution,
  config: RetryConfig
): RetryStrategy {
  // Check if max retries exceeded
  if (execution.attemptNumber >= config.maxRetries) {
    return {
      shouldRetry: false,
      reason: `Max retries (${config.maxRetries}) exceeded`,
      nextAttempt: execution.attemptNumber + 1,
      delayMs: 0,
      escalationRequired: true,
      escalationPath: 'manual-review',
    };
  }

  // Check for non-recoverable errors
  const nonRecoverableErrors = execution.errors.filter((e) => !e.recoverable);
  if (nonRecoverableErrors.length > 0) {
    return {
      shouldRetry: false,
      reason: `Non-recoverable error: ${nonRecoverableErrors[0].message}`,
      nextAttempt: execution.attemptNumber + 1,
      delayMs: 0,
      escalationRequired: true,
      escalationPath: 'manual-fix',
    };
  }

  // Check if any recoverable errors exist
  if (execution.errors.length === 0) {
    return {
      shouldRetry: false,
      reason: 'No errors to retry',
      nextAttempt: execution.attemptNumber + 1,
      delayMs: 0,
      escalationRequired: false,
    };
  }

  // Calculate exponential backoff delay
  const delayMs = Math.min(
    config.baseDelayMs * Math.pow(config.backoffMultiplier, execution.attemptNumber - 1),
    config.maxDelayMs
  );

  // Determine if scope narrowing is needed
  const requiresScopeNarrowing = shouldNarrowScope(execution, config);

  // Determine if escalation is required
  const escalationRequired = execution.attemptNumber >= config.escalateAfterAttempts;

  return {
    shouldRetry: true,
    reason: `Recoverable errors found (${execution.errors.length})`,
    nextAttempt: execution.attemptNumber + 1,
    delayMs,
    scopeNarrowing: requiresScopeNarrowing ? createScopeNarrowing(execution, config) : undefined,
    escalationRequired,
    escalationPath: escalationRequired ? 'reviewer-approval' : undefined,
  };
}

/**
 * Determines if scope should be narrowed on retry
 */
export function shouldNarrowScope(execution: AgentTaskExecution, config: RetryConfig): boolean {
  // No narrowing on first retry
  if (execution.attemptNumber <= 1) return false;

  // Check for specific error types that warrant narrowing
  const errorMessages = execution.errors.map((e) => e.message.toLowerCase());

  const narrowingTriggers = [
    'timeout',
    'file-conflict',
    'file conflict',
    'too many files',
    'memory',
    'resource',
    'dependency',
  ];

  return errorMessages.some((msg) => narrowingTriggers.some((trigger) => msg.includes(trigger)));
}

/**
 * Creates scope narrowing directives
 */
export function createScopeNarrowing(
  execution: AgentTaskExecution,
  config: RetryConfig
): RetryStrategy['scopeNarrowing'] {
  const reason = execution.errors[0]?.message || 'Unknown error';

  // Determine which files to exclude (narrow from changed files or others)
  const excludeFiles: string[] = [];
  const excludeLayers: string[] = [];
  let reduceComplexity = false;

  // If timeout error, exclude large files or reduce scope
  const timeoutErrors = execution.errors.filter((e) => e.message.toLowerCase().includes('timeout'));
  if (timeoutErrors.length > 0) {
    // Remove last ~33% of files worked on
    const fileCount = execution.outputs.changedFiles.length;
    const reduceBy = Math.ceil(fileCount * config.scopeNarrowingFactor);
    if (reduceBy > 0 && fileCount > 1) {
      excludeFiles.push(...execution.outputs.changedFiles.slice(-reduceBy));
      reduceComplexity = true;
    }
  }

  // If file conflict, exclude conflicting files
  const conflictErrors = execution.errors.filter((e) =>
    e.message.toLowerCase().includes('conflict')
  );
  if (conflictErrors.length > 0 && execution.outputs.changedFiles.length > 1) {
    // Exclude last few conflicting files
    const excludeCount = Math.max(1, Math.ceil(execution.outputs.changedFiles.length * 0.25));
    excludeFiles.push(...execution.outputs.changedFiles.slice(-excludeCount));
  }

  return {
    excludeFiles: excludeFiles.length > 0 ? excludeFiles : [],
    excludeLayers,
    reduceComplexity,
    reason,
  };
}

/**
 * Applies scope narrowing to a task
 */
export function applyStricterScope(
  task: BoundedAgentTask,
  narrowing: RetryStrategy['scopeNarrowing']
): BoundedAgentTask {
  if (!narrowing) return task;

  const updated = { ...task };

  // Remove excluded files from changed files
  if (narrowing.excludeFiles.length > 0) {
    const excludeSet = new Set(narrowing.excludeFiles);
    updated.expectedOutputs = {
      ...updated.expectedOutputs,
      changedFiles: updated.expectedOutputs.changedFiles.filter((f) => !excludeSet.has(f)),
    };

    // Ensure at least one file remains
    if (updated.expectedOutputs.changedFiles.length === 0) {
      updated.expectedOutputs.changedFiles = task.expectedOutputs.changedFiles.slice(0, 1);
    }
  }

  // Remove excluded layers
  if (narrowing.excludeLayers.length > 0) {
    const excludeSet = new Set(narrowing.excludeLayers);
    (updated as any).touchedLayers = updated.touchedLayers.filter((l) => !excludeSet.has(l));
  }

  // Reduce complexity if needed
  if (narrowing.reduceComplexity && task.complexity !== 'trivial') {
    const complexityLevels: BoundedAgentTask['complexity'][] = [
      'trivial',
      'simple',
      'moderate',
      'complex',
      'expert',
    ];
    const currentIndex = complexityLevels.indexOf(task.complexity);
    if (currentIndex > 0) {
      (updated as any).complexity = complexityLevels[currentIndex - 1];
    }
  }

  // Reduce file modification limit
  if (updated.maxFilesToModify) {
    updated.maxFilesToModify = Math.max(1, Math.floor(updated.maxFilesToModify * 0.7));
  }

  // Add retry context
  updated.retryContext = `Retry #${task.id}: ${narrowing.reason}. Narrowed scope to ${updated.expectedOutputs.changedFiles.length} file(s).`;

  return updated;
}

/**
 * Calculates wait time before retry with jitter
 */
export function calculateRetryDelay(strategy: RetryStrategy): number {
  const baseDelay = strategy.delayMs;
  const jitterFactor = 0.1; // +/- 10% jitter
  const jitter = baseDelay * jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, baseDelay + jitter);
}

/**
 * Checks if further retries are worthwhile
 */
export function isRetryWorthwhile(
  execution: AgentTaskExecution,
  config: RetryConfig
): boolean {
  // Don't retry if we've tried too many times
  if (execution.attemptNumber > config.maxRetries) {
    return false;
  }

  // Don't retry if last attempt was very recent (might indicate thrashing)
  const lastError = execution.errors[execution.errors.length - 1];
  if (lastError && execution.retryHistory.length > 0) {
    const lastRetry = execution.retryHistory[execution.retryHistory.length - 1];
    if (lastRetry.durationMs && lastRetry.durationMs < 1000) {
      // Very quick failure might indicate a fundamental issue
      return execution.attemptNumber < 2;
    }
  }

  // Check if we have the same error repeatedly
  if (execution.errors.length >= 2) {
    const lastTwo = execution.errors.slice(-2);
    if (
      lastTwo[0].message === lastTwo[1].message &&
      lastTwo[0].code === lastTwo[1].code
    ) {
      // Same error twice in a row - might need to escalate instead
      return execution.attemptNumber < 2;
    }
  }

  return true;
}

/**
 * Formats retry history for display
 */
export function formatRetryHistory(history: RetryHistory[]): string {
  if (history.length === 0) return 'No retries';

  const lines = history.map((h, i) => {
    const duration = h.durationMs ? ` (${h.durationMs}ms)` : '';
    const narrowing = h.scopeNarrowedBy && h.scopeNarrowedBy.length > 0 ? 
      ` [narrowed: ${h.scopeNarrowedBy.join(', ')}]` : '';
    return `Attempt ${h.attemptNumber}: ${h.error}${narrowing}${duration}`;
  });

  return lines.join('\n');
}

/**
 * Determines if task is in a retry loop (same error recurring)
 */
export function isInRetryLoop(execution: AgentTaskExecution): boolean {
  if (execution.retryHistory.length < 2) return false;

  // Check if last 2 retries had the same error
  const recent = execution.retryHistory.slice(-2);
  return recent[0].error === recent[1].error && 
         recent[0].errorCode === recent[1].errorCode;
}

/**
 * Gets escalation recommendation
 */
export function getEscalationRecommendation(
  execution: AgentTaskExecution,
  config: RetryConfig
): string | undefined {
  // Check for retry loop
  if (isInRetryLoop(execution)) {
    return 'Task in retry loop - manual intervention required';
  }

  // Check for too many attempts
  if (execution.attemptNumber >= config.maxRetries) {
    return `Max retries (${config.maxRetries}) reached - escalate to reviewer`;
  }

  // Check for critical errors
  const criticalErrors = execution.errors.filter((e) => !e.recoverable);
  if (criticalErrors.length > 0) {
    return `Non-recoverable error detected: ${criticalErrors[0].message}`;
  }

  // Check for timeout pattern
  const timeoutErrors = execution.errors.filter((e) => e.message.toLowerCase().includes('timeout'));
  if (timeoutErrors.length >= config.escalationCriteria.maxConsecutiveErrors) {
    return 'Repeated timeouts - may need to split task into smaller subtasks';
  }

  return undefined;
}
