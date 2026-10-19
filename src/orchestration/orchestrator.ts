/**
 * Phase 4.2 - Orchestrator State Machine
 * Defines the 9-state workflow for full-stack development orchestration
 * States: analyzing → planning → assigning → implementing → integrating → verifying → repairing → reviewing → summarizing
 */

import type { BoundedAgentTask, AgentTaskExecution } from './agentTasking.js';
import type { FullStackWorkPlan } from '../repo/workPlanOrchestrator.js';

/**
 * Orchestration states in workflow sequence
 */
export type OrchestrationState =
  | 'analyzing' // Analyzing user request and repository context
  | 'planning' // Creating full-stack work plan
  | 'assigning' // Assigning tasks to agents
  | 'implementing' // Executing agent tasks
  | 'integrating' // Merging and reconciling outputs
  | 'verifying' // Running verification checks
  | 'repairing' // Fixing failures and retrying
  | 'reviewing' // Final review by ReviewerAgent
  | 'summarizing'; // Creating final report

/**
 * State transition with metadata and rollback capability
 */
export interface StateTransition {
  fromState: OrchestrationState;
  toState: OrchestrationState;
  timestamp: number;
  reason: string;
  rollbackable: boolean;
  data?: Record<string, unknown>;
}

/**
 * Checkpoint for rollback recovery
 */
export interface Checkpoint {
  state: OrchestrationState;
  timestamp: number;
  taskSnapshots: Record<string, AgentTaskExecution>;
  workPlan?: FullStackWorkPlan;
  outputs?: Record<string, unknown>;
  errors?: string[];
}

/**
 * Orchestration context with state history
 */
export interface OrchestrationContext {
  // State tracking
  currentState: OrchestrationState;
  previousState?: OrchestrationState;
  stateHistory: OrchestrationState[];
  transitionHistory: StateTransition[];

  // Data
  userRequest: string;
  workPlan?: FullStackWorkPlan;
  assignedTasks: Map<string, BoundedAgentTask>;
  taskExecutions: Map<string, AgentTaskExecution>;

  // Checkpoints for rollback
  checkpoints: Checkpoint[];
  lastCheckpointState?: OrchestrationState;

  // Error handling
  errors: Array<{
    state: OrchestrationState;
    error: string;
    timestamp: number;
    recoverable: boolean;
  }>;
  recoveryAttempts: number;
  maxRecoveryAttempts: number;

  // Metadata
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

/**
 * Valid state transitions (defines the state machine)
 */
const VALID_TRANSITIONS: Record<OrchestrationState, OrchestrationState[]> = {
  analyzing: ['planning', 'summarizing'],
  planning: ['assigning', 'analyzing', 'summarizing'],
  assigning: ['implementing', 'planning', 'summarizing'],
  implementing: ['integrating', 'repairing', 'summarizing'],
  integrating: ['verifying', 'summarizing'],
  verifying: ['reviewing', 'repairing', 'summarizing'],
  repairing: ['implementing', 'verifying', 'summarizing'],
  reviewing: ['summarizing'],
  summarizing: [],
};

/**
 * State-specific error recovery strategies
 */
const RECOVERY_STRATEGIES: Record<OrchestrationState, string> = {
  analyzing: 'Restart request analysis with additional context',
  planning: 'Revise work plan with adjusted complexity estimates',
  assigning: 'Reassign tasks with different agents or narrowed scope',
  implementing: 'Narrow task scope and retry with fewer files',
  integrating: 'Resolve merge conflicts manually or narrow scope',
  verifying: 'Fix failing checks and re-verify',
  repairing: 'Apply fixes and transition to verifying state',
  reviewing: 'Address reviewer feedback and transition to repairing',
  summarizing: 'Generate final report despite partial failures',
};

/**
 * Creates a new orchestration context
 */
export function createOrchestrationContext(userRequest: string): OrchestrationContext {
  return {
    currentState: 'analyzing',
    stateHistory: ['analyzing'],
    transitionHistory: [],
    userRequest,
    assignedTasks: new Map(),
    taskExecutions: new Map(),
    checkpoints: [],
    errors: [],
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3,
    createdAt: Date.now(),
  };
}

/**
 * Validates if a state transition is allowed
 */
export function isValidTransition(fromState: OrchestrationState, toState: OrchestrationState): boolean {
  const validTargets = VALID_TRANSITIONS[fromState];
  return validTargets ? validTargets.includes(toState) : false;
}

/**
 * Attempts to transition to a new state
 */
export function transitionState(
  context: OrchestrationContext,
  newState: OrchestrationState,
  reason: string
): {
  success: boolean;
  error?: string;
  updated?: OrchestrationContext;
} {
  if (!isValidTransition(context.currentState, newState)) {
    return {
      success: false,
      error: `Invalid transition from ${context.currentState} to ${newState}`,
    };
  }

  const updated = { ...context };
  const transition: StateTransition = {
    fromState: context.currentState,
    toState: newState,
    timestamp: Date.now(),
    reason,
    rollbackable: newState !== 'summarizing',
  };

  updated.previousState = context.currentState;
  updated.currentState = newState;
  updated.stateHistory = [...context.stateHistory, newState];
  updated.transitionHistory = [...context.transitionHistory, transition];

  // Start timer on first real transition from analyzing
  if (!context.startedAt && newState !== 'analyzing') {
    (updated as any).startedAt = Date.now();
  }

  return { success: true, updated };
}

/**
 * Creates a checkpoint at current state
 */
export function createCheckpoint(context: OrchestrationContext): Checkpoint {
  const taskSnapshots: Record<string, AgentTaskExecution> = {};
  context.taskExecutions.forEach((execution, taskId) => {
    taskSnapshots[taskId] = JSON.parse(JSON.stringify(execution));
  });

  return {
    state: context.currentState,
    timestamp: Date.now(),
    taskSnapshots,
    workPlan: context.workPlan,
    outputs: {},
    errors: context.errors.map((e) => e.error),
  };
}

/**
 * Saves current state as a checkpoint
 */
export function saveCheckpoint(context: OrchestrationContext): OrchestrationContext {
  const checkpoint = createCheckpoint(context);
  const updated = { ...context };
  updated.checkpoints = [...context.checkpoints, checkpoint];
  updated.lastCheckpointState = context.currentState;
  return updated;
}

/**
 * Rolls back to a previous checkpoint
 */
export function rollbackToCheckpoint(context: OrchestrationContext, checkpointIndex: number): {
  success: boolean;
  error?: string;
  updated?: OrchestrationContext;
} {
  if (checkpointIndex < 0 || checkpointIndex >= context.checkpoints.length) {
    return {
      success: false,
      error: `Invalid checkpoint index: ${checkpointIndex}`,
    };
  }

  const checkpoint = context.checkpoints[checkpointIndex];
  const updated = { ...context };

  // Restore state
  updated.currentState = checkpoint.state;
  updated.stateHistory = updated.stateHistory.slice(0, checkpointIndex + 1);
  updated.transitionHistory = [];

  // Restore task executions
  updated.taskExecutions = new Map(Object.entries(checkpoint.taskSnapshots));

  // Restore work plan
  if (checkpoint.workPlan) {
    updated.workPlan = checkpoint.workPlan;
  }

  updated.checkpoints = context.checkpoints.slice(0, checkpointIndex + 1);
  updated.recoveryAttempts += 1;

  return { success: true, updated };
}

/**
 * Records an error in a state
 */
export function recordStateError(
  context: OrchestrationContext,
  error: string,
  recoverable: boolean = true
): OrchestrationContext {
  return {
    ...context,
    errors: [
      ...context.errors,
      {
        state: context.currentState,
        error,
        timestamp: Date.now(),
        recoverable,
      },
    ],
  };
}

/**
 * Gets recovery strategy for current state
 */
export function getRecoveryStrategy(context: OrchestrationContext): string {
  return RECOVERY_STRATEGIES[context.currentState];
}

/**
 * Determines if orchestration can recover from current error
 */
export function canRecover(context: OrchestrationContext): boolean {
  // Check if we have recovery attempts left
  if (context.recoveryAttempts >= context.maxRecoveryAttempts) {
    return false;
  }

  // Check if current state has a recovery path
  const validNext = VALID_TRANSITIONS[context.currentState];
  return validNext && validNext.length > 0;
}

/**
 * Attempts to recover from error in current state
 */
export function attemptRecovery(
  context: OrchestrationContext,
  reason: string
): {
  success: boolean;
  nextState?: OrchestrationState;
  error?: string;
} {
  if (!canRecover(context)) {
    return {
      success: false,
      error: `Cannot recover: max attempts (${context.maxRecoveryAttempts}) exceeded or no recovery path`,
    };
  }

  const validNext = VALID_TRANSITIONS[context.currentState];
  if (!validNext || validNext.length === 0) {
    return {
      success: false,
      error: `No valid recovery transitions from ${context.currentState}`,
    };
  }

  // For most states, go back to previous state or a safe state
  let nextState = validNext[0];

  if (context.currentState === 'implementing' || context.currentState === 'integrating') {
    nextState = 'repairing';
  } else if (context.currentState === 'verifying') {
    nextState = 'repairing';
  } else if (context.currentState === 'repairing') {
    nextState = 'implementing';
  }

  return {
    success: true,
    nextState,
  };
}

/**
 * Completes orchestration and records final timing
 */
export function completeOrchestration(context: OrchestrationContext): OrchestrationContext {
  const now = Date.now();
  return {
    ...context,
    currentState: 'summarizing',
    completedAt: now,
    durationMs: (context.startedAt ? now - context.startedAt : now - context.createdAt),
  };
}

/**
 * Gets current state statistics
 */
export function getStateStatistics(context: OrchestrationContext): {
  currentState: OrchestrationState;
  totalStates: number;
  transitionsCount: number;
  errorsCount: number;
  recoveryAttemptsCount: number;
  checkpointsCount: number;
  durationMs?: number;
} {
  return {
    currentState: context.currentState,
    totalStates: context.stateHistory.length,
    transitionsCount: context.transitionHistory.length,
    errorsCount: context.errors.length,
    recoveryAttemptsCount: context.recoveryAttempts,
    checkpointsCount: context.checkpoints.length,
    durationMs: context.durationMs,
  };
}

/**
 * Formats state history for display
 */
export function formatStateHistory(context: OrchestrationContext): string {
  const stateFlow = context.stateHistory.join(' → ');
  const timing = context.durationMs ? ` (${context.durationMs}ms)` : '';
  const errors = context.errors.length > 0 ? ` [${context.errors.length} errors]` : '';
  return `${stateFlow}${timing}${errors}`;
}
