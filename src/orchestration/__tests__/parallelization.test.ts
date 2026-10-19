/**
 * Tests for sub-agent parallelization framework
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  validateOwnershipPlans,
  planParallelExecution,
  validateExecutionPlan,
  createScopedRetry,
  processParallelResults,
  shouldRetryWithNarrowedScope,
  getRetryStrategy,
  formatExecutionPlan,
  calculateEfficiencyMetrics,
} from '../parallelizationFramework.js';
import {
  detectEditConflicts,
  detectOwnershipConflicts,
  detectDependencyConflicts,
  hasConflicts,
  getConflictingAgentPairs,
  formatConflictReport,
} from '../conflictDetection.js';
import {
  mergeAgentOutputs,
  validateMergedOutput,
  countUnresolvedConflicts,
  formatMergeLog,
} from '../mergeReconciliation.js';
import {
  createExecutionSummary,
  generateExecutionSummary,
  recordAgentResult,
  getExecutionStats,
} from '../executionSummary.js';
import {
  ExecutionGroup,
  AgentExecutionResult,
  FileEditOperation,
  ConflictInfo,
} from '../types.js';
import { FullStackTaskSpec } from '../../tasks/taskSpec.js';

describe('Parallelization Framework', () => {
  describe('Ownership Plan Validation', () => {
    it('should accept tasks with non-overlapping ownership', () => {
      const tasks: FullStackTaskSpec[] = [
        {
          id: 'task-1',
          title: 'Frontend Task',
          description: 'Test',
          userRequest: 'test',
          targetSurfaces: [],
          affectedFiles: ['ui/**'],
          acceptanceCriteria: [],
          verificationPlan: { criteria: [], commands: [] },
          classification: 'feature',
          touchedLayers: ['frontend'],
          ownershipPlan: [{ path: 'ui/**', owner: 'frontend', readOnly: false }],
          canRunInParallel: true,
          parallelCompatibleWith: [],
          dependencies: [],
          implementationOrder: [],
          verificationTasks: [],
          sequentialSteps: [],
          estimatedComplexity: 'simple',
          requiresManualReview: false,
          createdAt: Date.now(),
        },
        {
          id: 'task-2',
          title: 'Backend Task',
          description: 'Test',
          userRequest: 'test',
          targetSurfaces: [],
          affectedFiles: ['src/**'],
          acceptanceCriteria: [],
          verificationPlan: { criteria: [], commands: [] },
          classification: 'feature',
          touchedLayers: ['backend'],
          ownershipPlan: [{ path: 'src/**', owner: 'backend', readOnly: false }],
          canRunInParallel: true,
          parallelCompatibleWith: [],
          dependencies: [],
          implementationOrder: [],
          verificationTasks: [],
          sequentialSteps: [],
          estimatedComplexity: 'simple',
          requiresManualReview: false,
          createdAt: Date.now(),
        },
      ];

      expect(validateOwnershipPlans(tasks)).toBe(true);
    });

    it('should reject tasks with conflicting ownership', () => {
      const tasks: FullStackTaskSpec[] = [
        {
          id: 'task-1',
          title: 'Task 1',
          description: 'Test',
          userRequest: 'test',
          targetSurfaces: [],
          affectedFiles: ['src/utils/**'],
          acceptanceCriteria: [],
          verificationPlan: { criteria: [], commands: [] },
          classification: 'feature',
          touchedLayers: ['backend'],
          ownershipPlan: [{ path: 'src/utils/helper.ts', owner: 'agent1', readOnly: false }],
          canRunInParallel: true,
          parallelCompatibleWith: [],
          dependencies: [],
          implementationOrder: [],
          verificationTasks: [],
          sequentialSteps: [],
          estimatedComplexity: 'simple',
          requiresManualReview: false,
          createdAt: Date.now(),
        },
        {
          id: 'task-2',
          title: 'Task 2',
          description: 'Test',
          userRequest: 'test',
          targetSurfaces: [],
          affectedFiles: ['src/utils/**'],
          acceptanceCriteria: [],
          verificationPlan: { criteria: [], commands: [] },
          classification: 'feature',
          touchedLayers: ['backend'],
          ownershipPlan: [{ path: 'src/utils/helper.ts', owner: 'agent2', readOnly: false }],
          canRunInParallel: true,
          parallelCompatibleWith: [],
          dependencies: [],
          implementationOrder: [],
          verificationTasks: [],
          sequentialSteps: [],
          estimatedComplexity: 'simple',
          requiresManualReview: false,
          createdAt: Date.now(),
        },
      ];

      expect(validateOwnershipPlans(tasks)).toBe(false);
    });

    it('should allow read-only overlapping paths', () => {
      const tasks: FullStackTaskSpec[] = [
        {
          id: 'task-1',
          title: 'Task 1',
          description: 'Test',
          userRequest: 'test',
          targetSurfaces: [],
          affectedFiles: ['src/**'],
          acceptanceCriteria: [],
          verificationPlan: { criteria: [], commands: [] },
          classification: 'feature',
          touchedLayers: ['backend'],
          ownershipPlan: [{ path: 'src/utils/helper.ts', owner: 'agent1', readOnly: false }],
          canRunInParallel: true,
          parallelCompatibleWith: [],
          dependencies: [],
          implementationOrder: [],
          verificationTasks: [],
          sequentialSteps: [],
          estimatedComplexity: 'simple',
          requiresManualReview: false,
          createdAt: Date.now(),
        },
        {
          id: 'task-2',
          title: 'Task 2',
          description: 'Test',
          userRequest: 'test',
          targetSurfaces: [],
          affectedFiles: ['src/**'],
          acceptanceCriteria: [],
          verificationPlan: { criteria: [], commands: [] },
          classification: 'feature',
          touchedLayers: ['backend'],
          ownershipPlan: [{ path: 'src/utils/helper.ts', owner: 'agent2', readOnly: true }],
          canRunInParallel: true,
          parallelCompatibleWith: [],
          dependencies: [],
          implementationOrder: [],
          verificationTasks: [],
          sequentialSteps: [],
          estimatedComplexity: 'simple',
          requiresManualReview: false,
          createdAt: Date.now(),
        },
      ];

      expect(validateOwnershipPlans(tasks)).toBe(true);
    });
  });

  describe('Conflict Detection', () => {
    it('should detect file edit conflicts', () => {
      const edits: FileEditOperation[] = [
        {
          filePath: 'src/utils/helper.ts',
          originalContent: 'export function foo() {}',
          newContent: 'export function foo() { return 1; }',
          agentId: 'agent1',
          timestamp: Date.now(),
        },
        {
          filePath: 'src/utils/helper.ts',
          originalContent: 'export function foo() {}',
          newContent: 'export function foo() { return 2; }',
          agentId: 'agent2',
          timestamp: Date.now(),
        },
      ];

      const conflicts = detectEditConflicts(edits, new Map());
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe('edit_conflict');
      expect(conflicts[0].severity).toBe('critical');
      expect(conflicts[0].affectedFiles).toContain('src/utils/helper.ts');
    });

    it('should not flag single agent edits as conflicts', () => {
      const edits: FileEditOperation[] = [
        {
          filePath: 'src/utils/helper.ts',
          originalContent: 'export function foo() {}',
          newContent: 'export function foo() { return 1; }',
          agentId: 'agent1',
          timestamp: Date.now(),
        },
      ];

      const conflicts = detectEditConflicts(edits, new Map());
      expect(conflicts).toHaveLength(0);
    });

    it('should detect ownership conflicts', () => {
      const groups: ExecutionGroup[] = [
        {
          groupId: 'group-1',
          sequenceNumber: 0,
          taskIds: ['task-1', 'task-2'],
          agentIds: ['agent1', 'agent2'],
          ownedFiles: new Map([
            ['agent1', ['src/utils/helper.ts']],
            ['agent2', ['src/utils/helper.ts']],
          ]),
          dependencies: [],
          canRunInParallel: true,
          estimatedDuration: 100,
        },
      ];

      const plans = new Map<string, any[]>([
        [
          'task-1',
          [{ path: 'src/utils/helper.ts', owner: 'agent1', readOnly: false }],
        ],
        [
          'task-2',
          [{ path: 'src/utils/helper.ts', owner: 'agent2', readOnly: false }],
        ],
      ]);

      const conflicts = detectOwnershipConflicts(groups, plans);
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0].type).toBe('ownership_conflict');
    });

    it('should format conflict report', () => {
      const conflicts: ConflictInfo[] = [
        {
          type: 'edit_conflict',
          affectedFiles: ['src/utils/helper.ts'],
          conflictingAgents: ['agent1', 'agent2'],
          reason: 'Multiple agents edited the same file',
          severity: 'critical',
          suggestedResolution: 'Merge manually',
        },
      ];

      const report = formatConflictReport(conflicts);
      expect(report).toContain('CRITICAL');
      expect(report).toContain('edit_conflict');
      expect(report).toContain('Multiple agents');
    });

    it('should identify conflicting agent pairs', () => {
      const conflicts: ConflictInfo[] = [
        {
          type: 'edit_conflict',
          affectedFiles: ['src/file.ts'],
          conflictingAgents: ['agent1', 'agent2', 'agent3'],
          reason: 'Test',
          severity: 'critical',
        },
      ];

      const pairs = getConflictingAgentPairs(conflicts);
      expect(pairs).toHaveLength(3); // 3 choose 2 = 3 pairs
      expect(pairs).toContainEqual(['agent1', 'agent2']);
      expect(pairs).toContainEqual(['agent1', 'agent3']);
      expect(pairs).toContainEqual(['agent2', 'agent3']);
    });
  });

  describe('Merge and Reconciliation', () => {
    it('should merge non-conflicting edits', () => {
      const edits: FileEditOperation[] = [
        {
          filePath: 'src/utils/helper.ts',
          originalContent: 'export function foo() {}\nexport function bar() {}',
          newContent: 'export function foo() { return 1; }\nexport function bar() {}',
          agentId: 'agent1',
          timestamp: Date.now(),
        },
        {
          filePath: 'src/utils/index.ts',
          originalContent: 'export { foo } from "./helper";',
          newContent: 'export { foo, bar } from "./helper";',
          agentId: 'agent2',
          timestamp: Date.now() + 1,
        },
      ];

      const merged = mergeAgentOutputs(edits, ['task-1', 'task-2'], ['agent1', 'agent2']);
      expect(merged.mergedFiles.size).toBe(2);
      expect(merged.mergeConflicts).toHaveLength(0);
      expect(validateMergedOutput(merged)).toBe(true);
    });

    it('should count unresolved conflicts', () => {
      const edits: FileEditOperation[] = [
        {
          filePath: 'src/utils/helper.ts',
          originalContent: 'export function foo() {}',
          newContent: 'export function foo() { return 1; }',
          agentId: 'agent1',
          timestamp: Date.now(),
        },
        {
          filePath: 'src/utils/helper.ts',
          originalContent: 'export function foo() {}',
          newContent: 'export function foo() { return 2; }',
          agentId: 'agent2',
          timestamp: Date.now() + 1,
        },
      ];

      const merged = mergeAgentOutputs(edits, ['task-1'], ['agent1', 'agent2']);
      const conflictCount = countUnresolvedConflicts(merged);
      expect(conflictCount).toBeGreaterThan(0);
    });

    it('should format merge log', () => {
      const edits: FileEditOperation[] = [
        {
          filePath: 'src/utils/helper.ts',
          originalContent: 'export function foo() {}',
          newContent: 'export function foo() { return 1; }',
          agentId: 'agent1',
          timestamp: Date.now(),
        },
      ];

      const merged = mergeAgentOutputs(edits, ['task-1'], ['agent1']);
      const log = formatMergeLog(merged);
      expect(log).toContain('Merge Resolution Log');
      expect(log).toContain('Integrity Checks');
    });
  });

  describe('Execution Summary', () => {
    it('should create execution summary from results', () => {
      const groups: ExecutionGroup[] = [
        {
          groupId: 'group-1',
          sequenceNumber: 0,
          taskIds: ['task-1'],
          agentIds: ['agent1'],
          ownedFiles: new Map([['agent1', ['src/utils/helper.ts']]]),
          dependencies: [],
          canRunInParallel: false,
          estimatedDuration: 100,
        },
      ];

      const results = new Map<string, AgentExecutionResult[]>([
        [
          'agent1',
          [
            {
              agentId: 'agent1',
              taskId: 'task-1',
              status: 'success',
              changedFiles: ['src/utils/helper.ts'],
              editOperations: [],
              commandsRun: ['npm run build'],
              output: 'Build successful',
              errors: [],
              warnings: [],
              confidence: 0.95,
              duration: 50,
              timestamp: Date.now(),
              retryAttempts: 0,
            },
          ],
        ],
      ]);

      const summary = createExecutionSummary(groups, results, [], {
        taskIds: ['task-1'],
        agentIds: ['agent1'],
        mergedFiles: new Map(),
        mergeConflicts: [],
        resolutionLog: [],
        integrityChecks: [],
      });

      expect(summary.executionId).toBeDefined();
      expect(summary.overallStatus).toBe('success');
      expect(summary.agentResults.size).toBe(1);
    });

    it('should generate human-readable summary', () => {
      const groups: ExecutionGroup[] = [
        {
          groupId: 'group-1',
          sequenceNumber: 0,
          taskIds: ['task-1'],
          agentIds: ['agent1'],
          ownedFiles: new Map([['agent1', ['src/utils/helper.ts']]]),
          dependencies: [],
          canRunInParallel: false,
          estimatedDuration: 100,
        },
      ];

      const results = new Map<string, AgentExecutionResult[]>([
        [
          'agent1',
          [
            {
              agentId: 'agent1',
              taskId: 'task-1',
              status: 'success',
              changedFiles: ['src/utils/helper.ts'],
              editOperations: [],
              commandsRun: [],
              output: '',
              errors: [],
              warnings: [],
              confidence: 0.95,
              duration: 50,
              timestamp: Date.now(),
              retryAttempts: 0,
            },
          ],
        ],
      ]);

      const summary = createExecutionSummary(groups, results, [], {
        taskIds: ['task-1'],
        agentIds: ['agent1'],
        mergedFiles: new Map(),
        mergeConflicts: [],
        resolutionLog: [],
        integrityChecks: [],
      });

      const text = generateExecutionSummary(summary);
      expect(text).toContain('Execution Summary');
      expect(text).toContain('Status: SUCCESS');
    });

    it('should calculate execution stats', () => {
      const groups: ExecutionGroup[] = [
        {
          groupId: 'group-1',
          sequenceNumber: 0,
          taskIds: ['task-1'],
          agentIds: ['agent1'],
          ownedFiles: new Map(),
          dependencies: [],
          canRunInParallel: false,
          estimatedDuration: 100,
        },
      ];

      const results = new Map<string, AgentExecutionResult[]>([
        [
          'agent1',
          [
            {
              agentId: 'agent1',
              taskId: 'task-1',
              status: 'success',
              changedFiles: ['src/utils/helper.ts'],
              editOperations: [],
              commandsRun: [],
              output: '',
              errors: [],
              warnings: [],
              confidence: 0.95,
              duration: 50,
              timestamp: Date.now(),
              retryAttempts: 0,
            },
          ],
        ],
      ]);

      const summary = createExecutionSummary(groups, results, [], {
        taskIds: ['task-1'],
        agentIds: ['agent1'],
        mergedFiles: new Map(),
        mergeConflicts: [],
        resolutionLog: [],
        integrityChecks: [],
      });

      const stats = getExecutionStats(summary);
      expect(stats.totalTasks).toBe(1);
      expect(stats.successfulTasks).toBe(1);
      expect(stats.failedTasks).toBe(0);
    });
  });

  describe('Retry Logic', () => {
    it('should determine if retry is needed', () => {
      const result: AgentExecutionResult = {
        agentId: 'agent1',
        taskId: 'task-1',
        status: 'failure',
        changedFiles: [],
        editOperations: [],
        commandsRun: [],
        output: 'Build failed',
        errors: ['Test error'],
        warnings: [],
        confidence: 0.1,
        duration: 50,
        timestamp: Date.now(),
        retryAttempts: 1,
      };

      expect(shouldRetryWithNarrowedScope(result, 3)).toBe(true);
    });

    it('should not retry after max attempts', () => {
      const result: AgentExecutionResult = {
        agentId: 'agent1',
        taskId: 'task-1',
        status: 'failure',
        changedFiles: [],
        editOperations: [],
        commandsRun: [],
        output: 'Build failed',
        errors: ['Test error'],
        warnings: [],
        confidence: 0.1,
        duration: 50,
        timestamp: Date.now(),
        retryAttempts: 3,
      };

      expect(shouldRetryWithNarrowedScope(result, 3)).toBe(false);
    });

    it('should create scoped retry task', () => {
      const originalTask: FullStackTaskSpec = {
        id: 'task-1',
        title: 'Test Task',
        description: 'Test',
        userRequest: 'test',
        targetSurfaces: [],
        affectedFiles: ['src/utils/**', 'src/services/**'],
        acceptanceCriteria: [],
        verificationPlan: { criteria: [], commands: [] },
        classification: 'feature',
        touchedLayers: ['backend'],
        ownershipPlan: [],
        canRunInParallel: true,
        parallelCompatibleWith: [],
        dependencies: [],
        implementationOrder: [],
        verificationTasks: [],
        sequentialSteps: [],
        estimatedComplexity: 'simple',
        requiresManualReview: false,
        createdAt: Date.now(),
      };

      const failureResult: AgentExecutionResult = {
        agentId: 'agent1',
        taskId: 'task-1',
        status: 'failure',
        changedFiles: ['src/utils/helper.ts'],
        editOperations: [],
        commandsRun: [],
        output: 'Build failed',
        errors: ['Test error'],
        warnings: [],
        confidence: 0.1,
        duration: 50,
        timestamp: Date.now(),
        retryAttempts: 0,
      };

      const retry = createScopedRetry(originalTask, failureResult, 1, 'Test failure');
      expect(retry.originalTaskId).toBe('task-1');
      expect(retry.retryNumber).toBe(1);
      expect(retry.narrowedScope).toContain('src/utils/helper.ts');
    });

    it('should select appropriate retry strategy', () => {
      const failedResults: AgentExecutionResult[] = [
        {
          agentId: 'agent1',
          taskId: 'task-1',
          status: 'failure',
          changedFiles: [],
          editOperations: [],
          commandsRun: [],
          output: '',
          errors: [],
          warnings: [],
          confidence: 0.2,
          duration: 50,
          timestamp: Date.now(),
          retryAttempts: 0,
        },
      ];

      const strategy = getRetryStrategy(failedResults, 'narrow_scope');
      expect(strategy).toBe('retry_narrowed');
    });
  });

  describe('Execution Planning', () => {
    it('should format execution plan', () => {
      const groups: ExecutionGroup[] = [
        {
          groupId: 'group-1',
          sequenceNumber: 0,
          taskIds: ['task-1', 'task-2'],
          agentIds: ['agent1', 'agent2'],
          ownedFiles: new Map([
            ['agent1', ['ui/**']],
            ['agent2', ['src/**']],
          ]),
          dependencies: [],
          canRunInParallel: true,
          estimatedDuration: 100,
        },
      ];

      const plan = formatExecutionPlan(groups);
      expect(plan).toContain('Parallel Execution Plan');
      expect(plan).toContain('group-1');
      expect(plan).toContain('task-1');
    });

    it('should calculate efficiency metrics', () => {
      const groups: ExecutionGroup[] = [
        {
          groupId: 'group-1',
          sequenceNumber: 0,
          taskIds: ['task-1'],
          agentIds: ['agent1'],
          ownedFiles: new Map(),
          dependencies: [],
          canRunInParallel: false,
          estimatedDuration: 100,
        },
        {
          groupId: 'group-2',
          sequenceNumber: 1,
          taskIds: ['task-2', 'task-3'],
          agentIds: ['agent2', 'agent3'],
          ownedFiles: new Map(),
          dependencies: ['task-1'],
          canRunInParallel: true,
          estimatedDuration: 100,
        },
      ];

      const results = new Map<string, AgentExecutionResult[]>([
        [
          'agent1',
          [
            {
              agentId: 'agent1',
              taskId: 'task-1',
              status: 'success',
              changedFiles: [],
              editOperations: [],
              commandsRun: [],
              output: '',
              errors: [],
              warnings: [],
              confidence: 0.95,
              duration: 50,
              timestamp: Date.now(),
              retryAttempts: 0,
            },
          ],
        ],
      ]);

      const summary = createExecutionSummary(groups, results, [], {
        taskIds: ['task-1'],
        agentIds: ['agent1'],
        mergedFiles: new Map(),
        mergeConflicts: [],
        resolutionLog: [],
        integrityChecks: [],
      });

      const metrics = calculateEfficiencyMetrics(groups, summary);
      expect(metrics.totalGroups).toBe(2);
      expect(metrics.parallelGroups).toBe(1);
      expect(metrics.sequentialGroups).toBe(1);
    });
  });
});
