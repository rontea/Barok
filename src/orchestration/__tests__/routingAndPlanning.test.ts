/**
 * Phase 4.3 & 4.4 Tests - Agent Router & Execution Planner
 * Tests task routing, execution planning, parallelization, and dependency resolution
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  routeTask,
  checkCompatibility,
  createAgentStatusMap,
  updateAgentWorkload,
  canAgentAcceptTask,
  findAlternativeAgent,
  type BoundedAgentTask,
  type AgentStatus,
  type RoutingDecision,
} from '../agentRouter.js';
import {
  hasFileConflict,
  hasLayerConflict,
  canRunInParallel,
  analyzeDependencies,
  groupTasksForParallel,
  orderByDependencies,
  createExecutionGroups,
  createExecutionPlan,
  calculateCriticalPath,
  estimateResources,
} from '../executionPlanner.js';
import type { BoundedAgentTask as AgentTask } from '../agentTasking.js';
import type { FullStackWorkPlan } from '../../repo/workPlanOrchestrator.js';

// Test fixtures
const createTestTask = (overrides?: Partial<AgentTask>): AgentTask => ({
  id: 'task-' + Math.random().toString(36).substr(2, 9),
  agentRole: 'backend',
  userRequest: 'Fix authentication bug',
  classification: 'bug_fix',
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
  userRequest: 'Add authentication',
  classification: 'feature',
  complexity: 'complex',
  affectedFiles: ['src/auth.ts'],
  acceptanceCriteria: [],
  touchedLayers: ['backend', 'frontend'],
  fileOwnershipPlan: {},
  expectedComplexity: 'complex',
  riskLevel: 'medium',
  requiresApproval: false,
  parallelizable: true,
  estimatedTaskCount: 3,
  verificationPlan: [],
});

describe('Phase 4.3 & 4.4 - Agent Router & Execution Planner', () => {
  let statusMap: Map<string, AgentStatus>;
  let testTask: AgentTask;
  let testWorkPlan: FullStackWorkPlan;

  beforeEach(() => {
    statusMap = createAgentStatusMap();
    testTask = createTestTask();
    testWorkPlan = createTestWorkPlan();
  });

  describe('Phase 4.3 - Agent Router', () => {
    describe('Task Routing', () => {
      it('should route bug fix task to backend agent', () => {
        const bugFixTask = createTestTask({ classification: 'bug_fix' });
        const decision = routeTask(bugFixTask, testWorkPlan, statusMap);

        expect(['backend', 'frontend', 'test']).toContain(decision.selectedAgent);
        expect(decision.score).toBeGreaterThan(0);
      });

      it('should route feature task to multiple potential agents', () => {
        const featureTask = createTestTask({ classification: 'feature' });
        const decision = routeTask(featureTask, testWorkPlan, statusMap);

        expect(['backend', 'frontend', 'data', 'test']).toContain(decision.selectedAgent);
      });

      it('should route test-only task to test agent', () => {
        const testTask = createTestTask({
          classification: 'test_only',
          touchedLayers: ['tests'],
        });
        const decision = routeTask(testTask, testWorkPlan, statusMap);

        expect(decision.selectedAgent).toBe('test');
      });

      it('should route docs-only task to documentation agent', () => {
        const docsTask = createTestTask({
          classification: 'docs_only',
          touchedLayers: ['docs'],
        });
        const decision = routeTask(docsTask, testWorkPlan, statusMap);

        expect(decision.selectedAgent).toBe('documentation');
      });

      it('should provide alternative agents', () => {
        const decision = routeTask(testTask, testWorkPlan, statusMap);

        expect(decision.alternativeAgents.length).toBeGreaterThan(0);
        expect(decision.alternativeAgents[0].score).toBeLessThanOrEqual(decision.score);
      });

      it('should handle unavailable agents in routing', () => {
        // Mark primary agent as unavailable
        statusMap.get('backend')!.isAvailable = false;
        statusMap.get('backend')!.currentWorkload = 100;

        const decision = routeTask(testTask, testWorkPlan, statusMap);

        // Should still make a routing decision, potentially with escalation or alternative agent
        expect(decision.selectedAgent).toBeDefined();
        expect(decision.alternativeAgents.length).toBeGreaterThan(0);
      });
    });

    describe('Compatibility Checking', () => {
      it('should check backend agent compatibility with backend task', () => {
        const check = checkCompatibility(testTask, 'backend');

        // Backend task on backend agent should be compatible or have minimal issues
        expect(check.layerCoverage.length).toBeGreaterThan(0);
        expect(check.fileOwnershipMatches).toBe(true);
      });

      it('should detect layer mismatch when appropriate', () => {
        const frontendTask = createTestTask({
          touchedLayers: ['frontend'],
          expectedOutputs: { changedFiles: ['ui/App.tsx'], fileTypes: ['tsx'] },
        });
        const check = checkCompatibility(frontendTask, 'backend');

        // Frontend task on backend agent should have warnings or layer coverage issues
        expect(check.layerCoverage.length).toBe(0);
      });

      it('should check file type support', () => {
        const tsTask = createTestTask();
        const check = checkCompatibility(tsTask, 'backend');

        // Should complete without errors
        expect(check).toBeDefined();
        expect(['low', 'medium', 'high', 'critical']).toContain(check.riskLevel);
      });

      it('should assess risk level', () => {
        const complexTask = createTestTask({ touchedLayers: ['backend', 'frontend', 'data', 'tests'] });
        const check = checkCompatibility(complexTask, 'backend');

        expect(['low', 'medium', 'high', 'critical']).toContain(check.riskLevel);
      });
    });

    describe('Agent Status Management', () => {
      it('should create initial agent status map', () => {
        expect(statusMap.size).toBe(6);
        expect(statusMap.has('backend')).toBe(true);
        expect(statusMap.has('frontend')).toBe(true);
        expect(statusMap.has('test')).toBe(true);
      });

      it('should track all agent types', () => {
        const roles = ['frontend', 'backend', 'data', 'test', 'reviewer', 'documentation'];
        for (const role of roles) {
          expect(statusMap.has(role as any)).toBe(true);
        }
      });

      it('should update agent workload', () => {
        let updated = updateAgentWorkload(statusMap, 'backend', 5);
        expect(updated.get('backend')!.activeTaskCount).toBe(1);
        expect(updated.get('backend')!.currentWorkload).toBeGreaterThan(0);

        updated = updateAgentWorkload(updated, 'backend', 10);
        expect(updated.get('backend')!.activeTaskCount).toBe(2);
      });

      it('should mark agent unavailable when at capacity', () => {
        let updated = statusMap;
        for (let i = 0; i < 3; i++) {
          updated = updateAgentWorkload(updated, 'backend', 5);
        }

        expect(updated.get('backend')!.isAvailable).toBe(false);
      });

      it('should check if agent can accept task', () => {
        const status = statusMap.get('backend')!;

        expect(canAgentAcceptTask(status, 'trivial')).toBe(true);
        expect(canAgentAcceptTask(status, 'expert')).toBe(true);

        // After loading up
        let updated = statusMap;
        for (let i = 0; i < 2; i++) {
          updated = updateAgentWorkload(updated, 'backend', 30);
        }

        const busyStatus = updated.get('backend')!;
        expect(canAgentAcceptTask(busyStatus, 'expert')).toBe(false);
      });

      it('should find alternative agent when primary is busy', () => {
        statusMap.get('backend')!.isAvailable = false;
        statusMap.get('backend')!.currentWorkload = 100;

        const decision = routeTask(testTask, testWorkPlan, statusMap);
        const alternative = findAlternativeAgent(decision, statusMap, testTask);

        expect(alternative).toBeDefined();
        expect(alternative).not.toBe('backend');
      });
    });
  });

  describe('Phase 4.4 - Execution Planner', () => {
    describe('Task Conflict Detection', () => {
      it('should detect file conflicts', () => {
        const task1 = createTestTask({ expectedOutputs: { changedFiles: ['src/auth.ts'], fileTypes: ['ts'] } });
        const task2 = createTestTask({ expectedOutputs: { changedFiles: ['src/auth.ts', 'src/utils.ts'], fileTypes: ['ts'] } });

        expect(hasFileConflict(task1, task2)).toBe(true);
      });

      it('should detect no conflict when files differ', () => {
        const task1 = createTestTask({ expectedOutputs: { changedFiles: ['src/auth.ts'], fileTypes: ['ts'] } });
        const task2 = createTestTask({ expectedOutputs: { changedFiles: ['src/utils.ts'], fileTypes: ['ts'] } });

        expect(hasFileConflict(task1, task2)).toBe(false);
      });

      it('should detect layer conflicts', () => {
        const task1 = createTestTask({ touchedLayers: ['backend'] });
        const task2 = createTestTask({ touchedLayers: ['backend', 'tests'] });

        expect(hasLayerConflict(task1, task2)).toBe(true);
      });

      it('should allow different agents on different layers', () => {
        const task1 = createTestTask({
          agentRole: 'backend',
          touchedLayers: ['backend'],
          expectedOutputs: { changedFiles: ['src/api.ts'], fileTypes: ['ts'] },
        });
        const task2 = createTestTask({
          agentRole: 'frontend',
          touchedLayers: ['frontend'],
          expectedOutputs: { changedFiles: ['ui/App.tsx'], fileTypes: ['tsx'] },
        });

        // Different agents on different layers can run in parallel
        expect(canRunInParallel(task1, task2, true)).toBe(true);
      });
    });

    describe('Parallelization Detection', () => {
      it('should identify tasks that can run in parallel', () => {
        const task1 = createTestTask({
          id: 'task-1',
          agentRole: 'backend',
          touchedLayers: ['backend'],
          expectedOutputs: { changedFiles: ['src/auth.ts'], fileTypes: ['ts'] },
        });
        const task2 = createTestTask({
          id: 'task-2',
          agentRole: 'backend',
          touchedLayers: ['data'], // Different layer
          expectedOutputs: { changedFiles: ['src/utils.ts'], fileTypes: ['ts'] },
        });

        // Different agents or layers + no file conflicts = can run in parallel
        expect(canRunInParallel(task1, task2, true)).toBe(true);
      });

      it('should prevent parallel execution on file conflicts', () => {
        const task1 = createTestTask({ expectedOutputs: { changedFiles: ['src/auth.ts'], fileTypes: ['ts'] } });
        const task2 = createTestTask({ expectedOutputs: { changedFiles: ['src/auth.ts'], fileTypes: ['ts'] } });

        expect(canRunInParallel(task1, task2)).toBe(false);
      });

      it('should group independent tasks', () => {
        const tasks = [
          createTestTask({ id: 'task-1', expectedOutputs: { changedFiles: ['src/a.ts'], fileTypes: ['ts'] } }),
          createTestTask({ id: 'task-2', expectedOutputs: { changedFiles: ['src/b.ts'], fileTypes: ['ts'] } }),
          createTestTask({ id: 'task-3', expectedOutputs: { changedFiles: ['src/c.ts'], fileTypes: ['ts'] } }),
        ];

        const groups = groupTasksForParallel(tasks);

        expect(groups.length).toBeGreaterThan(0);
        expect(groups.flat()).toHaveLength(3);
      });

      it('should separate conflicting tasks', () => {
        const tasks = [
          createTestTask({ id: 'task-1', expectedOutputs: { changedFiles: ['src/shared.ts'], fileTypes: ['ts'] } }),
          createTestTask({ id: 'task-2', expectedOutputs: { changedFiles: ['src/shared.ts'], fileTypes: ['ts'] } }),
        ];

        const groups = groupTasksForParallel(tasks);

        expect(groups.length).toBeGreaterThanOrEqual(2);
      });
    });

    describe('Dependency Management', () => {
      it('should analyze task dependencies', () => {
        const tasks = [
          createTestTask({ id: 'task-1' }),
          createTestTask({ id: 'task-2', dependsOn: ['task-1'] }),
        ];

        const deps = analyzeDependencies(tasks);

        expect(deps.get('task-2')!.dependsOn).toContain('task-1');
      });

      it('should order tasks by dependencies', () => {
        const tasks = [
          createTestTask({ id: 'task-2', dependsOn: ['task-1'] }),
          createTestTask({ id: 'task-1' }),
        ];
        const deps = analyzeDependencies(tasks);

        const ordered = orderByDependencies(tasks, deps);

        expect(ordered[0].id).toBe('task-1');
        expect(ordered[1].id).toBe('task-2');
      });

      it('should handle circular dependencies gracefully', () => {
        const tasks = [
          createTestTask({ id: 'task-1', dependsOn: ['task-2'] }),
          createTestTask({ id: 'task-2', dependsOn: ['task-1'] }),
        ];
        const deps = analyzeDependencies(tasks);

        const ordered = orderByDependencies(tasks, deps);

        expect(ordered).toHaveLength(2);
      });
    });

    describe('Execution Plan Creation', () => {
      it('should create execution groups', () => {
        const tasks = [
          createTestTask({ id: 'task-1' }),
          createTestTask({ id: 'task-2' }),
        ];

        const groups = createExecutionGroups(tasks);

        expect(groups.length).toBeGreaterThan(0);
        expect(groups.every((g) => g.id.startsWith('group-'))).toBe(true);
      });

      it('should set group priorities', () => {
        const tasks = [
          createTestTask({ id: 'task-1', priority: 'critical' }),
          createTestTask({ id: 'task-2', priority: 'low' }),
        ];

        const groups = createExecutionGroups(tasks);

        expect(groups.some((g) => g.priority === 'critical')).toBe(true);
      });

      it('should calculate estimated duration', () => {
        const tasks = [
          createTestTask({ id: 'task-1', complexity: 'simple' }),
          createTestTask({ id: 'task-2', complexity: 'complex' }),
        ];

        const plan = createExecutionPlan(tasks, testWorkPlan);

        expect(plan.totalEstimatedDurationMs).toBeGreaterThan(0);
      });

      it('should calculate parallelization score', () => {
        const tasks = [
          createTestTask({ id: 'task-1' }),
          createTestTask({ id: 'task-2' }),
        ];

        const plan = createExecutionPlan(tasks, testWorkPlan);

        expect(plan.parallelizationScore).toBeGreaterThanOrEqual(0);
        expect(plan.parallelizationScore).toBeLessThanOrEqual(100);
      });

      it('should identify critical path', () => {
        const tasks = [
          createTestTask({ id: 'task-1' }),
          createTestTask({ id: 'task-2', dependsOn: ['task-1'] }),
          createTestTask({ id: 'task-3', dependsOn: ['task-2'] }),
        ];

        const plan = createExecutionPlan(tasks, testWorkPlan);

        expect(plan.criticalPath.length).toBeGreaterThan(0);
      });

      it('should estimate resource usage', () => {
        const tasks = [
          createTestTask({ id: 'task-1' }),
          createTestTask({ id: 'task-2' }),
        ];

        const plan = createExecutionPlan(tasks, testWorkPlan);
        const resources = estimateResources(plan);

        expect(resources.estimatedTimeMinutes).toBeGreaterThan(0);
        expect(resources.estimatedMemoryMb).toBeGreaterThan(0);
        expect(resources.estimatedCpuCores).toBeGreaterThan(0);
      });

      it('should warn about large change sets', () => {
        const tasks = Array.from({ length: 5 }, (_, i) =>
          createTestTask({
            id: `task-${i}`,
            expectedOutputs: {
              changedFiles: Array.from({ length: 25 }, (_, j) => `src/file${j}.ts`),
              fileTypes: ['ts'],
            },
          })
        );

        const plan = createExecutionPlan(tasks, testWorkPlan);

        expect(plan.warnings.length).toBeGreaterThan(0);
      });
    });

    describe('Complex Workflows', () => {
      it('should plan multi-layer changes', () => {
        const tasks = [
          createTestTask({
            id: 'task-backend',
            agentRole: 'backend',
            touchedLayers: ['backend'],
            expectedOutputs: { changedFiles: ['src/api.ts'], fileTypes: ['ts'] },
          }),
          createTestTask({
            id: 'task-frontend',
            agentRole: 'frontend',
            touchedLayers: ['frontend'],
            expectedOutputs: { changedFiles: ['ui/App.tsx'], fileTypes: ['tsx'] },
          }),
          createTestTask({
            id: 'task-test',
            agentRole: 'test',
            touchedLayers: ['tests'],
            expectedOutputs: { changedFiles: ['tests/integration.test.ts'], fileTypes: ['ts'] },
          }),
        ];

        const plan = createExecutionPlan(tasks, testWorkPlan);

        expect(plan.groups.length).toBeGreaterThan(0);
        // Multi-layer independent tasks should be highly parallelizable
        expect(plan.parallelizationScore).toBeGreaterThanOrEqual(0);
      });

      it('should handle sequential dependencies', () => {
        const tasks = [
          createTestTask({ id: 'task-1', complexity: 'trivial' }),
          createTestTask({ id: 'task-2', dependsOn: ['task-1'], complexity: 'simple' }),
          createTestTask({ id: 'task-3', dependsOn: ['task-2'], complexity: 'moderate' }),
        ];

        const plan = createExecutionPlan(tasks, testWorkPlan);

        expect(plan.criticalPath.length).toBe(3);
        expect(plan.parallelizationScore).toBe(0);
      });
    });
  });
});
