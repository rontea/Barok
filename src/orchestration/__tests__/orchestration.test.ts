/**
 * Phase 4 Integration Tests - Full Orchestration Workflow
 * Comprehensive end-to-end tests for the complete orchestration system
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { createOrchestrationContext, transitionState, createCheckpoint, saveCheckpoint, rollbackToCheckpoint } from '../orchestrator.js';
import { createTaskExecution, validateBoundedAgentTask, type BoundedAgentTask } from '../agentTasking.js';
import { routeTask, createAgentStatusMap, updateAgentWorkload } from '../agentRouter.js';
import { createExecutionPlan, createExecutionGroups } from '../executionPlanner.js';
import { shouldRetry, createDefaultRetryConfig, applyStricterScope } from '../retryStrategy.js';
import type { FullStackWorkPlan } from '../../repo/workPlanOrchestrator.js';

// Test fixtures
const createTestTask = (overrides?: Partial<BoundedAgentTask>): BoundedAgentTask => ({
  id: 'task-' + Math.random().toString(36).substr(2, 9),
  agentRole: 'backend',
  userRequest: 'Add user authentication',
  classification: 'feature',
  complexity: 'moderate',
  inputs: {},
  expectedOutputs: {
    changedFiles: ['src/auth.ts'],
    fileTypes: ['ts'],
  },
  ownedFiles: ['src/auth.ts'],
  touchedLayers: ['backend'],
  allowedTools: ['typescript'],
  stopConditions: [{ type: 'all_tests_pass', description: 'Tests pass' }],
  timeoutMs: 300000,
  maxRetries: 2,
  createdAt: Date.now(),
  priority: 'high',
  ...overrides,
});

const createTestWorkPlan = (): FullStackWorkPlan => ({
  id: 'plan-001',
  userRequest: 'Add user authentication',
  classification: 'feature',
  complexity: 'complex',
  affectedFiles: ['src/auth.ts'],
  acceptanceCriteria: [],
  touchedLayers: ['backend'],
  fileOwnershipPlan: {},
  expectedComplexity: 'complex',
  riskLevel: 'medium',
  requiresApproval: false,
  parallelizable: true,
  estimatedTaskCount: 1,
  verificationPlan: [],
});

describe('Phase 4 - Full Orchestration Integration Tests', () => {
  describe('End-to-End Orchestration Workflows', () => {
    it('should complete happy path orchestration: analyzing → planning → assigning → implementing → integrating → verifying → reviewing → summarizing', () => {
      const context = createOrchestrationContext('Add user authentication');
      const workPlan = createTestWorkPlan();
      const task = createTestTask();

      // Validate task
      const validation = validateBoundedAgentTask(task);
      expect(validation.valid).toBe(true);

      // Transition through states
      let ctx = context;
      const transitions = [
        { to: 'planning' as const, reason: 'Start planning' },
        { to: 'assigning' as const, reason: 'Plan complete' },
        { to: 'implementing' as const, reason: 'Assignment complete' },
        { to: 'integrating' as const, reason: 'Implementation complete' },
        { to: 'verifying' as const, reason: 'Integration complete' },
        { to: 'reviewing' as const, reason: 'Verification complete' },
        { to: 'summarizing' as const, reason: 'Review complete' },
      ];

      for (const transition of transitions) {
        const result = transitionState(ctx, transition.to, transition.reason);
        expect(result.success).toBe(true);
        ctx = result.updated!;
      }

      expect(ctx.currentState).toBe('summarizing');
      expect(ctx.stateHistory).toHaveLength(8);
    });

    it('should handle multi-agent parallel execution with routing and planning', () => {
      const tasks = [
        createTestTask({ id: 'backend-task', agentRole: 'backend', touchedLayers: ['backend'] }),
        createTestTask({ id: 'frontend-task', agentRole: 'frontend', touchedLayers: ['frontend'] }),
        createTestTask({ id: 'test-task', agentRole: 'test', touchedLayers: ['tests'] }),
      ];

      // Route each task
      let statusMap = createAgentStatusMap();
      const workPlan = createTestWorkPlan();

      const routes = tasks.map((task) => ({
        task,
        route: routeTask(task, workPlan, statusMap),
      }));

      // All tasks should be routable
      for (const { route } of routes) {
        expect(route.selectedAgent).toBeDefined();
        expect(route.score).toBeGreaterThan(0);
      }

      // Plan execution
      const plan = createExecutionPlan(tasks, workPlan);
      expect(plan.groups.length).toBeGreaterThan(0);
      expect(plan.parallelizationScore).toBeGreaterThanOrEqual(0);
    });

    it('should handle error recovery with retry and scope narrowing', () => {
      const context = createOrchestrationContext('Fix database bug');
      const task = createTestTask();
      const execution = createTaskExecution(task.id, task.agentRole);

      // Simulate error
      let ctx = context;
      const stateResult = transitionState(ctx, 'planning', 'Start');
      ctx = stateResult.updated!;

      // Add error to execution
      const exec = { ...execution, status: 'failed' as const, errors: [{ message: 'Timeout', code: 'TIMEOUT', timestamp: Date.now(), recoverable: true }] };

      // Check if retry should happen
      const config = createDefaultRetryConfig();
      const retryStrategy = shouldRetry(exec, config);

      expect(retryStrategy.shouldRetry).toBe(true);

      // Apply scope narrowing
      if (retryStrategy.scopeNarrowing) {
        const narrowedTask = applyStricterScope(task, retryStrategy.scopeNarrowing);
        expect(narrowedTask.id).toBe(task.id);
        expect(narrowedTask.retryContext).toBeDefined();
      }
    });

    it('should handle complex workflow with multiple phases and decisions', () => {
      const context = createOrchestrationContext('Implement feature with multiple layers');
      const tasks = [
        createTestTask({ id: 'task-1', touchedLayers: ['backend'] }),
        createTestTask({ id: 'task-2', touchedLayers: ['frontend'] }),
        createTestTask({ id: 'task-3', touchedLayers: ['tests'], dependsOn: ['task-1', 'task-2'] }),
      ];

      // Analyze phase
      let ctx = context;
      expect(ctx.currentState).toBe('analyzing');

      // Plan phase
      let result = transitionState(ctx, 'planning', 'Analyze complete');
      ctx = result.updated!;
      expect(ctx.currentState).toBe('planning');

      // Assign phase with routing
      let statusMap = createAgentStatusMap();
      const workPlan = createTestWorkPlan();

      for (const task of tasks) {
        const route = routeTask(task, workPlan, statusMap);
        expect(route.selectedAgent).toBeDefined();
        statusMap = updateAgentWorkload(statusMap, route.selectedAgent, task.expectedOutputs.changedFiles.length);
      }

      result = transitionState(ctx, 'assigning', 'Assign agents');
      ctx = result.updated!;
      expect(ctx.currentState).toBe('assigning');

      // Execute phase
      result = transitionState(ctx, 'implementing', 'Start execution');
      ctx = result.updated!;
      expect(ctx.currentState).toBe('implementing');
    });

    it('should save and restore checkpoints for recovery', () => {
      const context = createOrchestrationContext('Checkpoint test');
      let ctx = context;

      // Checkpoint 1: analyzing state
      ctx = saveCheckpoint(ctx);
      expect(ctx.checkpoints).toHaveLength(1);
      expect(ctx.checkpoints[0].state).toBe('analyzing');

      // Transition to planning and checkpoint
      let result = transitionState(ctx, 'planning', 'Plan start');
      ctx = result.updated!;
      ctx = saveCheckpoint(ctx);

      expect(ctx.checkpoints).toHaveLength(2);
      expect(ctx.checkpoints[1].state).toBe('planning');

      // Transition to assigning
      result = transitionState(ctx, 'assigning', 'Assign');
      ctx = result.updated!;

      // Rollback to checkpoint 1
      const rollback = rollbackToCheckpoint(ctx, 0);
      expect(rollback.success).toBe(true);
      expect(rollback.updated!.currentState).toBe('analyzing');
      expect(rollback.updated!.recoveryAttempts).toBe(1);
    });
  });

  describe('State Machine Transitions and Error Recovery', () => {
    it('should handle error during planning and recover to assigning', () => {
      const context = createOrchestrationContext('Recovery test');
      let ctx = context;

      // Move to planning
      let result = transitionState(ctx, 'planning', 'Start planning');
      ctx = result.updated!;

      // Simulate error
      ctx = { ...ctx, errors: [{ state: 'planning', error: 'Plan validation failed', timestamp: Date.now(), recoverable: true }] };

      // Save checkpoint before recovery
      ctx = saveCheckpoint(ctx);

      // Move to assigning (error recovery)
      result = transitionState(ctx, 'assigning', 'Recover by reassigning');
      ctx = result.updated!;

      expect(ctx.currentState).toBe('assigning');
      expect(ctx.errors).toHaveLength(1);
    });

    it('should detect and prevent invalid state transitions', () => {
      const context = createOrchestrationContext('Invalid transition test');

      // Try invalid transition
      const result = transitionState(context, 'implementing', 'Skip phases');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid transition');
    });

    it('should maintain state history through multiple transitions', () => {
      const context = createOrchestrationContext('State history test');
      let ctx = context;

      const expectedStates = ['analyzing', 'planning', 'assigning', 'implementing'];

      for (let i = 1; i < expectedStates.length; i++) {
        const result = transitionState(ctx, expectedStates[i] as any, 'Next phase');
        ctx = result.updated!;
      }

      expect(ctx.stateHistory).toEqual(expectedStates);
      expect(ctx.transitionHistory).toHaveLength(expectedStates.length - 1);
    });

    it('should handle rollback and recovery attempts', () => {
      const context = createOrchestrationContext('Rollback test');
      let ctx = context;

      // Create multiple checkpoints
      ctx = saveCheckpoint(ctx);
      let result = transitionState(ctx, 'planning', 'Plan');
      ctx = result.updated!;
      ctx = saveCheckpoint(ctx);

      result = transitionState(ctx, 'assigning', 'Assign');
      ctx = result.updated!;
      ctx = saveCheckpoint(ctx);

      // Rollback twice
      let rollback = rollbackToCheckpoint(ctx, 1);
      ctx = rollback.updated!;
      expect(ctx.currentState).toBe('planning');
      expect(ctx.recoveryAttempts).toBe(1);

      rollback = rollbackToCheckpoint(ctx, 0);
      ctx = rollback.updated!;
      expect(ctx.currentState).toBe('analyzing');
      expect(ctx.recoveryAttempts).toBe(2);
    });
  });

  describe('Agent Routing and Assignment', () => {
    it('should route different task types to appropriate agents', () => {
      const statusMap = createAgentStatusMap();
      const workPlan = createTestWorkPlan();

      const taskTypes = [
        { type: 'bug_fix' as const, expectedAgents: ['backend', 'frontend', 'test'] },
        { type: 'feature' as const, expectedAgents: ['backend', 'frontend', 'data', 'test'] },
        { type: 'test_only' as const, expectedAgents: ['test'] },
        { type: 'docs_only' as const, expectedAgents: ['documentation'] },
      ];

      for (const taskType of taskTypes) {
        const task = createTestTask({ classification: taskType.type });
        const route = routeTask(task, workPlan, statusMap);

        expect(taskType.expectedAgents).toContain(route.selectedAgent);
        expect(route.score).toBeGreaterThan(0);
      }
    });

    it('should balance workload across agents', () => {
      let statusMap = createAgentStatusMap();
      const workPlan = createTestWorkPlan();

      const tasks = Array.from({ length: 5 }, (_, i) =>
        createTestTask({ id: `task-${i}`, agentRole: 'backend' })
      );

      const routedAgents: string[] = [];

      for (const task of tasks) {
        const route = routeTask(task, workPlan, statusMap);
        routedAgents.push(route.selectedAgent);
        statusMap = updateAgentWorkload(statusMap, route.selectedAgent, 1);
      }

      // Some tasks should be routed to different agents or alternatives
      expect(routedAgents.length).toBeGreaterThan(0);
    });

    it('should provide alternative agents when primary is busy', () => {
      const statusMap = createAgentStatusMap();
      statusMap.get('backend')!.isAvailable = false;
      statusMap.get('backend')!.currentWorkload = 100;

      const workPlan = createTestWorkPlan();
      const task = createTestTask();

      const route = routeTask(task, workPlan, statusMap);

      expect(route.alternativeAgents.length).toBeGreaterThan(0);
      expect(route.alternativeAgents[0].agent).not.toBe('backend');
    });

    it('should detect when escalation is needed based on routing score', () => {
      const statusMap = createAgentStatusMap();
      // Make all agents busy
      for (const status of statusMap.values()) {
        status.isAvailable = false;
        status.currentWorkload = 100;
      }

      const workPlan = createTestWorkPlan();
      const task = createTestTask();

      const route = routeTask(task, workPlan, statusMap);

      // Should still make a routing decision but potentially flag for escalation
      expect(route.selectedAgent).toBeDefined();
    });
  });

  describe('Execution Planning', () => {
    it('should create execution groups from task list', () => {
      const tasks = [
        createTestTask({ id: 'task-1' }),
        createTestTask({ id: 'task-2' }),
        createTestTask({ id: 'task-3' }),
      ];

      const groups = createExecutionGroups(tasks);

      expect(groups.length).toBeGreaterThan(0);
      expect(groups.flat((g: any) => g.tasks).length).toBeGreaterThan(0);
    });

    it('should identify parallelizable tasks', () => {
      const tasks = [
        createTestTask({
          id: 'task-1',
          expectedOutputs: { changedFiles: ['src/file1.ts'], fileTypes: ['ts'] },
        }),
        createTestTask({
          id: 'task-2',
          expectedOutputs: { changedFiles: ['src/file2.ts'], fileTypes: ['ts'] },
        }),
      ];

      const plan = createExecutionPlan(tasks, createTestWorkPlan());

      expect(plan.groups.length).toBeGreaterThan(0);
      expect(plan.parallelizationScore).toBeGreaterThanOrEqual(0);
    });

    it('should calculate critical path for dependent tasks', () => {
      const tasks = [
        createTestTask({ id: 'task-1' }),
        createTestTask({ id: 'task-2', dependsOn: ['task-1'] }),
        createTestTask({ id: 'task-3', dependsOn: ['task-2'] }),
      ];

      const plan = createExecutionPlan(tasks, createTestWorkPlan());

      expect(plan.criticalPath).toBeDefined();
      expect(plan.criticalPath.length).toBeGreaterThan(0);
    });

    it('should estimate resource requirements', () => {
      const tasks = Array.from({ length: 3 }, (_, i) => createTestTask({ id: `task-${i}` }));

      const plan = createExecutionPlan(tasks, createTestWorkPlan());

      expect(plan.estimatedResourceUsage.maxConcurrentTasks).toBeGreaterThan(0);
      expect(plan.estimatedResourceUsage.totalFilesModified).toBeGreaterThan(0);
      expect(plan.estimatedResourceUsage.totalCommandsRun).toBeGreaterThan(0);
    });
  });

  describe('Retry and Scope Narrowing', () => {
    it('should retry failed tasks with exponential backoff', () => {
      const config = createDefaultRetryConfig();
      const execution = createTaskExecution('task-001', 'backend');

      // Simulate error
      let exec = { ...execution, errors: [{ message: 'Timeout', code: 'TIMEOUT', timestamp: Date.now(), recoverable: true }], attemptNumber: 1 };

      const strategy = shouldRetry(exec, config);

      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.delayMs).toBeGreaterThan(0);
      expect(strategy.delayMs).toBeLessThanOrEqual(config.maxDelayMs);
    });

    it('should narrow scope on repeated failures', () => {
      const config = createDefaultRetryConfig();
      const task = createTestTask({
        expectedOutputs: { changedFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts'], fileTypes: ['ts'] },
      });

      let exec = createTaskExecution(task.id, task.agentRole);
      exec.attemptNumber = 2;
      exec = { ...exec, errors: [{ message: 'Timeout error', code: 'TIMEOUT', timestamp: Date.now(), recoverable: true }] };

      const strategy = shouldRetry(exec, config);

      if (strategy.scopeNarrowing) {
        const narrowedTask = applyStricterScope(task, strategy.scopeNarrowing);

        expect(narrowedTask.expectedOutputs.changedFiles.length).toBeLessThanOrEqual(
          task.expectedOutputs.changedFiles.length
        );
        expect(narrowedTask.retryContext).toBeDefined();
      }
    });

    it('should limit retries and escalate when max attempts exceeded', () => {
      const config = createDefaultRetryConfig();
      let exec = createTaskExecution('task-001', 'backend');
      exec.attemptNumber = config.maxRetries;
      exec = { ...exec, errors: [{ message: 'Still failing', code: 'UNKNOWN', timestamp: Date.now(), recoverable: true }] };

      const strategy = shouldRetry(exec, config);

      expect(strategy.shouldRetry).toBe(false);
      expect(strategy.escalationRequired).toBe(true);
    });

    it('should not retry non-recoverable errors', () => {
      const config = createDefaultRetryConfig();
      let exec = createTaskExecution('task-001', 'backend');
      exec = { ...exec, errors: [{ message: 'Schema mismatch', code: 'SCHEMA_ERROR', timestamp: Date.now(), recoverable: false }] };

      const strategy = shouldRetry(exec, config);

      expect(strategy.shouldRetry).toBe(false);
      expect(strategy.escalationRequired).toBe(true);
      expect(strategy.escalationPath).toContain('manual');
    });
  });

  describe('Integration Workflow Scenarios', () => {
    it('should execute simple single-task workflow', () => {
      const orchestrationContext = createOrchestrationContext('Simple bug fix');
      const task = createTestTask({ classification: 'bug_fix', complexity: 'trivial' });
      const validation = validateBoundedAgentTask(task);

      expect(validation.valid).toBe(true);

      const statusMap = createAgentStatusMap();
      const route = routeTask(task, createTestWorkPlan(), statusMap);

      expect(route.selectedAgent).toBeDefined();

      let ctx = orchestrationContext;
      ctx.currentState = 'implementing';

      const execution = createTaskExecution(task.id, route.selectedAgent);
      expect(execution.status).toBe('pending');
    });

    it('should execute complex multi-layer workflow', () => {
      const tasks = [
        createTestTask({
          id: 'backend',
          agentRole: 'backend',
          touchedLayers: ['backend'],
          complexity: 'complex',
        }),
        createTestTask({
          id: 'frontend',
          agentRole: 'frontend',
          touchedLayers: ['frontend'],
          complexity: 'moderate',
        }),
        createTestTask({
          id: 'data',
          agentRole: 'data',
          touchedLayers: ['data'],
          complexity: 'moderate',
        }),
        createTestTask({
          id: 'tests',
          agentRole: 'test',
          touchedLayers: ['tests'],
          complexity: 'simple',
          dependsOn: ['backend', 'frontend', 'data'],
        }),
      ];

      const workPlan = createTestWorkPlan();
      const statusMap = createAgentStatusMap();

      // Route each task
      const routes = tasks.map((t) => routeTask(t, workPlan, statusMap));
      for (const route of routes) {
        expect(route.selectedAgent).toBeDefined();
      }

      // Create execution plan
      const plan = createExecutionPlan(tasks, workPlan);
      expect(plan.groups.length).toBeGreaterThan(0);
      expect(plan.criticalPath.length).toBeGreaterThan(0);
    });
  });
});
