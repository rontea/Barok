/**
 * Phase 4.2 Tests - Orchestrator State Machine
 * Tests the 9-state workflow with transitions, rollbacks, error recovery, and logging
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  createOrchestrationContext,
  isValidTransition,
  transitionState,
  createCheckpoint,
  saveCheckpoint,
  rollbackToCheckpoint,
  recordStateError,
  getRecoveryStrategy,
  canRecover,
  attemptRecovery,
  completeOrchestration,
  getStateStatistics,
  formatStateHistory,
  type OrchestrationContext,
} from '../orchestrator.js';

describe('Phase 4.2 - Orchestrator State Machine', () => {
  let context: OrchestrationContext;

  beforeEach(() => {
    context = createOrchestrationContext('Add authentication to user dashboard');
  });

  describe('State Machine Initialization', () => {
    it('should create orchestration context in analyzing state', () => {
      expect(context.currentState).toBe('analyzing');
      expect(context.stateHistory).toContain('analyzing');
      expect(context.userRequest).toBe('Add authentication to user dashboard');
    });

    it('should initialize with empty state history and transitions', () => {
      expect(context.stateHistory).toHaveLength(1);
      expect(context.transitionHistory).toHaveLength(0);
      expect(context.errors).toHaveLength(0);
    });

    it('should initialize with zero recovery attempts', () => {
      expect(context.recoveryAttempts).toBe(0);
      expect(context.maxRecoveryAttempts).toBe(3);
    });

    it('should create checkpoints map and task executions map', () => {
      expect(context.checkpoints).toHaveLength(0);
      expect(context.assignedTasks.size).toBe(0);
      expect(context.taskExecutions.size).toBe(0);
    });
  });

  describe('Valid State Transitions', () => {
    it('should allow analyzing → planning', () => {
      expect(isValidTransition('analyzing', 'planning')).toBe(true);
    });

    it('should allow planning → assigning', () => {
      expect(isValidTransition('planning', 'assigning')).toBe(true);
    });

    it('should allow assigning → implementing', () => {
      expect(isValidTransition('assigning', 'implementing')).toBe(true);
    });

    it('should allow implementing → integrating', () => {
      expect(isValidTransition('implementing', 'integrating')).toBe(true);
    });

    it('should allow integrating → verifying', () => {
      expect(isValidTransition('integrating', 'verifying')).toBe(true);
    });

    it('should allow verifying → reviewing', () => {
      expect(isValidTransition('verifying', 'reviewing')).toBe(true);
    });

    it('should allow reviewing → summarizing', () => {
      expect(isValidTransition('reviewing', 'summarizing')).toBe(true);
    });

    it('should allow error recovery: verifying → repairing', () => {
      expect(isValidTransition('verifying', 'repairing')).toBe(true);
    });

    it('should allow error recovery: repairing → implementing', () => {
      expect(isValidTransition('repairing', 'implementing')).toBe(true);
    });

    it('should allow any state → summarizing', () => {
      expect(isValidTransition('planning', 'summarizing')).toBe(true);
      expect(isValidTransition('implementing', 'summarizing')).toBe(true);
      expect(isValidTransition('verifying', 'summarizing')).toBe(true);
    });
  });

  describe('Invalid State Transitions', () => {
    it('should reject analyzing → implementing (skip phases)', () => {
      expect(isValidTransition('analyzing', 'implementing')).toBe(false);
    });

    it('should reject planning → implementing (skip assigning)', () => {
      expect(isValidTransition('planning', 'implementing')).toBe(false);
    });

    it('should reject implementing → reviewing (skip verification)', () => {
      expect(isValidTransition('implementing', 'reviewing')).toBe(false);
    });

    it('should reject completed state transitions', () => {
      expect(isValidTransition('summarizing', 'reviewing')).toBe(false);
      expect(isValidTransition('summarizing', 'planning')).toBe(false);
    });

    it('should reject backward transitions except for recovery', () => {
      expect(isValidTransition('implementing', 'analyzing')).toBe(false);
      expect(isValidTransition('verifying', 'planning')).toBe(false);
    });
  });

  describe('State Transitions with Logging', () => {
    it('should execute valid transition and update history', () => {
      const result = transitionState(context, 'planning', 'Analysis complete');
      expect(result.success).toBe(true);
      expect(result.updated!.currentState).toBe('planning');
      expect(result.updated!.previousState).toBe('analyzing');
    });

    it('should track state history', () => {
      let ctx = context;
      const result1 = transitionState(ctx, 'planning', 'Analysis complete');
      ctx = result1.updated!;
      const result2 = transitionState(ctx, 'assigning', 'Planning complete');
      ctx = result2.updated!;

      expect(ctx.stateHistory).toEqual(['analyzing', 'planning', 'assigning']);
    });

    it('should record transition details', () => {
      const result = transitionState(context, 'planning', 'Analysis complete');
      expect(result.updated!.transitionHistory).toHaveLength(1);

      const transition = result.updated!.transitionHistory[0];
      expect(transition.fromState).toBe('analyzing');
      expect(transition.toState).toBe('planning');
      expect(transition.reason).toBe('Analysis complete');
      expect(transition.timestamp).toBeDefined();
    });

    it('should reject invalid transition', () => {
      const result = transitionState(context, 'implementing', 'Skip planning');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid transition');
    });

    it('should mark transitions as rollbackable (except to summarizing)', () => {
      const result = transitionState(context, 'planning', 'Start planning');
      expect(result.updated!.transitionHistory[0].rollbackable).toBe(true);

      const ctx = result.updated!;
      const result2 = transitionState(ctx, 'summarizing', 'Complete');
      expect(result2.updated!.transitionHistory[1].rollbackable).toBe(false);
    });
  });

  describe('Checkpoints & Rollback', () => {
    it('should create checkpoint at current state', () => {
      const checkpoint = createCheckpoint(context);
      expect(checkpoint.state).toBe('analyzing');
      expect(checkpoint.timestamp).toBeDefined();
      expect(checkpoint.taskSnapshots).toBeDefined();
    });

    it('should save checkpoint to context', () => {
      const result1 = transitionState(context, 'planning', 'Plan start');
      let ctx = result1.updated!;
      ctx = saveCheckpoint(ctx);

      expect(ctx.checkpoints).toHaveLength(1);
      expect(ctx.lastCheckpointState).toBe('planning');
    });

    it('should save multiple checkpoints across states', () => {
      let ctx = context;
      ctx = saveCheckpoint(ctx);

      const result1 = transitionState(ctx, 'planning', 'Plan');
      ctx = result1.updated!;
      ctx = saveCheckpoint(ctx);

      const result2 = transitionState(ctx, 'assigning', 'Assign');
      ctx = result2.updated!;
      ctx = saveCheckpoint(ctx);

      expect(ctx.checkpoints).toHaveLength(3);
      expect(ctx.checkpoints[0].state).toBe('analyzing');
      expect(ctx.checkpoints[1].state).toBe('planning');
      expect(ctx.checkpoints[2].state).toBe('assigning');
    });

    it('should rollback to previous checkpoint', () => {
      let ctx = context;
      ctx = saveCheckpoint(ctx);
      const result1 = transitionState(ctx, 'planning', 'Start');
      ctx = result1.updated!;
      ctx = saveCheckpoint(ctx);

      const result2 = transitionState(ctx, 'assigning', 'Assign');
      ctx = result2.updated!;

      // Rollback to first checkpoint (analyzing state)
      const rollback = rollbackToCheckpoint(ctx, 0);
      expect(rollback.success).toBe(true);
      expect(rollback.updated!.currentState).toBe('analyzing');
      expect(rollback.updated!.recoveryAttempts).toBe(1);
    });

    it('should reject rollback to invalid checkpoint', () => {
      const result = rollbackToCheckpoint(context, 5);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid checkpoint');
    });
  });

  describe('Error Tracking & Recovery', () => {
    it('should record error in state', () => {
      let ctx = recordStateError(context, 'Task execution failed', true);
      expect(ctx.errors).toHaveLength(1);
      expect(ctx.errors[0].error).toBe('Task execution failed');
      expect(ctx.errors[0].state).toBe('analyzing');
      expect(ctx.errors[0].recoverable).toBe(true);
    });

    it('should track multiple errors', () => {
      let ctx = recordStateError(context, 'Error 1', true);
      ctx = recordStateError(ctx, 'Error 2', true);
      ctx = recordStateError(ctx, 'Error 3', false);

      expect(ctx.errors).toHaveLength(3);
      expect(ctx.errors[2].recoverable).toBe(false);
    });

    it('should get recovery strategy for current state', () => {
      expect(getRecoveryStrategy(context)).toContain('analysis');

      const result = transitionState(context, 'planning', 'Plan');
      expect(getRecoveryStrategy(result.updated!)).toContain('work plan');
    });
  });

  describe('Recovery Mechanism', () => {
    it('should indicate recovery possible in implementing state', () => {
      let ctx = context;
      const result = transitionState(ctx, 'planning', 'Plan');
      ctx = result.updated!;
      const result2 = transitionState(ctx, 'assigning', 'Assign');
      ctx = result2.updated!;
      const result3 = transitionState(ctx, 'implementing', 'Implement');
      ctx = result3.updated!;

      expect(canRecover(ctx)).toBe(true);
    });

    it('should deny recovery when max attempts exceeded', () => {
      let ctx = context;
      ctx.recoveryAttempts = 3;
      ctx.maxRecoveryAttempts = 3;

      expect(canRecover(ctx)).toBe(false);
    });

    it('should attempt recovery from implementing state', () => {
      let ctx = context;
      const result = transitionState(ctx, 'planning', 'Plan');
      ctx = result.updated!;
      const result2 = transitionState(ctx, 'assigning', 'Assign');
      ctx = result2.updated!;
      const result3 = transitionState(ctx, 'implementing', 'Implement');
      ctx = result3.updated!;

      const recovery = attemptRecovery(ctx, 'Task timeout');
      expect(recovery.success).toBe(true);
      expect(recovery.nextState).toBe('repairing');
    });

    it('should attempt recovery from verifying state', () => {
      let ctx = context;
      const result1 = transitionState(ctx, 'planning', 'Plan');
      ctx = result1.updated!;
      const result2 = transitionState(ctx, 'assigning', 'Assign');
      ctx = result2.updated!;
      const result3 = transitionState(ctx, 'implementing', 'Implement');
      ctx = result3.updated!;
      const result4 = transitionState(ctx, 'integrating', 'Integrate');
      ctx = result4.updated!;
      const result5 = transitionState(ctx, 'verifying', 'Verify');
      ctx = result5.updated!;

      const recovery = attemptRecovery(ctx, 'Verification failed');
      expect(recovery.success).toBe(true);
      expect(recovery.nextState).toBe('repairing');
    });

    it('should reject recovery when max attempts reached', () => {
      let ctx = context;
      ctx.recoveryAttempts = 3;
      ctx.maxRecoveryAttempts = 3;

      const recovery = attemptRecovery(ctx, 'Failed recovery');
      expect(recovery.success).toBe(false);
    });
  });

  describe('Orchestration Completion', () => {
    it('should complete orchestration and record timing', () => {
      let ctx = context;
      ctx = saveCheckpoint(ctx);

      const result = transitionState(ctx, 'planning', 'Plan');
      ctx = result.updated!;

      ctx = completeOrchestration(ctx);
      expect(ctx.currentState).toBe('summarizing');
      expect(ctx.completedAt).toBeDefined();
      expect(ctx.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should calculate duration from start to completion', (done) => {
      const ctx1 = createOrchestrationContext('Test');
      const result = transitionState(ctx1, 'planning', 'Start');
      const ctx2 = result.updated!;

      // Wait a bit to show measurable duration
      setTimeout(() => {
        const completed = completeOrchestration(ctx2);
        expect(completed.durationMs).toBeGreaterThan(0);
        done();
      }, 10);
    });
  });

  describe('State Statistics & Reporting', () => {
    it('should get state statistics', () => {
      let ctx = context;
      const result = transitionState(ctx, 'planning', 'Plan');
      ctx = result.updated!;

      const stats = getStateStatistics(ctx);
      expect(stats.currentState).toBe('planning');
      expect(stats.totalStates).toBe(2);
      expect(stats.transitionsCount).toBe(1);
      expect(stats.errorsCount).toBe(0);
    });

    it('should include error and recovery counts in statistics', () => {
      let ctx = recordStateError(context, 'Error', true);
      ctx.recoveryAttempts = 2;

      const stats = getStateStatistics(ctx);
      expect(stats.errorsCount).toBe(1);
      expect(stats.recoveryAttemptsCount).toBe(2);
    });

    it('should format state history for display', () => {
      let ctx = context;
      const result = transitionState(ctx, 'planning', 'Plan');
      ctx = result.updated!;
      const result2 = transitionState(ctx, 'assigning', 'Assign');
      ctx = result2.updated!;

      const history = formatStateHistory(ctx);
      expect(history).toContain('analyzing');
      expect(history).toContain('planning');
      expect(history).toContain('assigning');
      expect(history).toContain('→');
    });

    it('should include error count in formatted history', () => {
      let ctx = recordStateError(context, 'Error', true);
      const history = formatStateHistory(ctx);
      expect(history).toContain('1 errors');
    });
  });

  describe('Complex Workflows', () => {
    it('should complete happy path: analyzing → planning → assigning → implementing → integrating → verifying → reviewing → summarizing', () => {
      let ctx = context;

      const steps = [
        { to: 'planning' as const, reason: 'Analysis done' },
        { to: 'assigning' as const, reason: 'Plan done' },
        { to: 'implementing' as const, reason: 'Assignment done' },
        { to: 'integrating' as const, reason: 'Implementation done' },
        { to: 'verifying' as const, reason: 'Integration done' },
        { to: 'reviewing' as const, reason: 'Verification done' },
        { to: 'summarizing' as const, reason: 'Review done' },
      ];

      for (const step of steps) {
        const result = transitionState(ctx, step.to, step.reason);
        expect(result.success).toBe(true);
        ctx = result.updated!;
      }

      expect(ctx.currentState).toBe('summarizing');
      expect(ctx.stateHistory).toHaveLength(8);
    });

    it('should handle error recovery workflow: implementing → repairing → implementing', () => {
      let ctx = context;
      const result1 = transitionState(ctx, 'planning', 'Plan');
      ctx = result1.updated!;
      const result2 = transitionState(ctx, 'assigning', 'Assign');
      ctx = result2.updated!;
      const result3 = transitionState(ctx, 'implementing', 'Implement');
      ctx = result3.updated!;

      // Error occurs
      ctx = recordStateError(ctx, 'Task failed', true);

      // Attempt recovery
      const recovery = attemptRecovery(ctx, 'Retry with narrowed scope');
      expect(recovery.nextState).toBe('repairing');

      // Transition to repair
      const result4 = transitionState(ctx, 'repairing', recovery.nextState!);
      ctx = result4.updated!;

      // Retry implementation
      const result5 = transitionState(ctx, 'implementing', 'Retry implementation');
      ctx = result5.updated!;

      expect(ctx.stateHistory).toContain('repairing');
      expect(ctx.recoveryAttempts).toBe(0); // Not yet incremented until rollback
    });

    it('should handle early completion with summarizing', () => {
      let ctx = context;
      const result = transitionState(ctx, 'planning', 'Plan');
      ctx = result.updated!;

      // Decide to stop and summarize
      const result2 = transitionState(ctx, 'summarizing', 'Stop early');
      expect(result2.success).toBe(true);
      expect(result2.updated!.currentState).toBe('summarizing');
    });
  });
});
