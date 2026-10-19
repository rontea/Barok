/**
 * Phase 4.1 Tests - Agent Task Types & Bounded Specifications
 * Validates task creation, status transitions, execution tracking, and constraints
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  validateBoundedAgentTask,
  canTransitionTaskStatus,
  createTaskExecution,
  updateTaskExecutionStatus,
  recordTaskError,
  recordRetryAttempt,
  hasTaskTimedOut,
  calculateTaskProgress,
  type BoundedAgentTask,
  type AgentTaskExecution,
} from '../agentTasking.js';

describe('Phase 4.1 - Agent Task Types & Bounded Specifications', () => {
  let validTask: BoundedAgentTask;
  let taskExecution: AgentTaskExecution;

  beforeEach(() => {
    validTask = {
      id: 'task-001',
      agentRole: 'backend',
      userRequest: 'Fix authentication bug in JWT validation',
      classification: 'bug_fix',
      complexity: 'moderate',
      inputs: {
        codeContext: 'JWT validation in src/middleware/auth.ts',
        specifications: { 'token-expiry': '3600' },
      },
      expectedOutputs: {
        changedFiles: ['src/middleware/auth.ts', 'tests/auth.test.ts'],
        fileTypes: ['ts'],
        outputFormat: 'code',
      },
      ownedFiles: ['src/middleware/auth.ts', 'src/middleware/__tests__/auth.test.ts', 'tests/integration/auth.test.ts'],
      touchedLayers: ['backend', 'tests'],
      allowedTools: ['typescript', 'git', 'npm-test'],
      stopConditions: [
        {
          type: 'all_tests_pass',
          description: 'All auth tests must pass',
        },
        {
          type: 'linting_clean',
          description: 'No linting errors',
        },
      ],
      timeoutMs: 300000,
      maxRetries: 2,
      maxFilesToModify: 10,
      createdAt: Date.now(),
      priority: 'high',
    };

    taskExecution = createTaskExecution('task-001', 'backend');
  });

  describe('Task Definition & Validation', () => {
    it('should create a valid bounded agent task', () => {
      expect(validTask.id).toBe('task-001');
      expect(validTask.agentRole).toBe('backend');
      expect(validTask.ownedFiles.length).toBeGreaterThan(0);
    });

    it('should validate a complete task', () => {
      const validation = validateBoundedAgentTask(validTask);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should reject task missing id', () => {
      const incompleteTask = { ...validTask, id: '' };
      const validation = validateBoundedAgentTask(incompleteTask);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('id'))).toBe(true);
    });

    it('should reject task with no owned files', () => {
      const incompleteTask = { ...validTask, ownedFiles: [] };
      const validation = validateBoundedAgentTask(incompleteTask);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('owned file'))).toBe(true);
    });

    it('should reject task with no stop conditions', () => {
      const incompleteTask = { ...validTask, stopConditions: [] };
      const validation = validateBoundedAgentTask(incompleteTask);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('stop condition'))).toBe(true);
    });

    it('should reject task with invalid timeout', () => {
      const incompleteTask = { ...validTask, timeoutMs: -1 };
      const validation = validateBoundedAgentTask(incompleteTask);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('positive timeout'))).toBe(true);
    });
  });

  describe('Task Execution Tracking', () => {
    it('should create task execution in pending state', () => {
      expect(taskExecution.status).toBe('pending');
      expect(taskExecution.progress).toBe(0);
      expect(taskExecution.attemptNumber).toBe(1);
      expect(taskExecution.retryHistory).toHaveLength(0);
    });

    it('should track start time when transitioning to executing', () => {
      const result = updateTaskExecutionStatus(taskExecution, 'assigned');
      expect(result.success).toBe(true);

      const result2 = updateTaskExecutionStatus(result.updated!, 'executing');
      expect(result2.success).toBe(true);
      expect(result2.updated!.startTime).toBeDefined();
    });

    it('should track end time and duration on completion', () => {
      let execution = { ...taskExecution };
      execution.startTime = Date.now() - 5000; // 5 seconds ago

      const result = updateTaskExecutionStatus(execution, 'assigned');
      const result2 = updateTaskExecutionStatus(result.updated!, 'executing');
      const result3 = updateTaskExecutionStatus(result2.updated!, 'completed');

      expect(result3.updated!.endTime).toBeDefined();
      expect(result3.updated!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should track multiple errors', () => {
      let execution = taskExecution;
      execution = recordTaskError(execution, 'First error', true, 'ERR_001');
      execution = recordTaskError(execution, 'Second error', false, 'ERR_002');

      expect(execution.errors).toHaveLength(2);
      expect(execution.errors[0].message).toBe('First error');
      expect(execution.errors[1].recoverable).toBe(false);
    });
  });

  describe('Task Status Transitions', () => {
    it('should allow pending → assigned transition', () => {
      expect(canTransitionTaskStatus('pending', 'assigned')).toBe(true);
    });

    it('should allow pending → cancelled transition', () => {
      expect(canTransitionTaskStatus('pending', 'cancelled')).toBe(true);
    });

    it('should allow assigned → executing transition', () => {
      expect(canTransitionTaskStatus('assigned', 'executing')).toBe(true);
    });

    it('should allow executing → completed transition', () => {
      expect(canTransitionTaskStatus('executing', 'completed')).toBe(true);
    });

    it('should allow executing → failed transition', () => {
      expect(canTransitionTaskStatus('executing', 'failed')).toBe(true);
    });

    it('should allow failed → assigned transition (retry)', () => {
      expect(canTransitionTaskStatus('failed', 'assigned')).toBe(true);
    });

    it('should reject invalid transitions', () => {
      expect(canTransitionTaskStatus('pending', 'completed')).toBe(false);
      expect(canTransitionTaskStatus('executing', 'pending')).toBe(false);
      expect(canTransitionTaskStatus('completed', 'executing')).toBe(false);
    });

    it('should update status with valid transition', () => {
      const result = updateTaskExecutionStatus(taskExecution, 'assigned');
      expect(result.success).toBe(true);
      expect(result.updated!.status).toBe('assigned');
    });

    it('should reject status transition with invalid move', () => {
      const result = updateTaskExecutionStatus(taskExecution, 'completed');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot transition');
    });
  });

  describe('Timeout & Cancellation', () => {
    it('should detect task timeout', () => {
      let execution = taskExecution;
      execution.startTime = Date.now() - 400000; // 400 seconds ago

      const timedOut = hasTaskTimedOut(execution, 300000); // 5 minute timeout
      expect(timedOut).toBe(true);
    });

    it('should not report timeout if not started', () => {
      const timedOut = hasTaskTimedOut(taskExecution, 300000);
      expect(timedOut).toBe(false);
    });

    it('should not report timeout if within limit', () => {
      let execution = taskExecution;
      execution.startTime = Date.now() - 100000; // 100 seconds ago

      const timedOut = hasTaskTimedOut(execution, 300000); // 5 minute timeout
      expect(timedOut).toBe(false);
    });

    it('should allow pending → cancelled transition', () => {
      const result = updateTaskExecutionStatus(taskExecution, 'cancelled');
      expect(result.success).toBe(true);
      expect(result.updated!.status).toBe('cancelled');
    });
  });

  describe('Retry Logic & Scope Narrowing', () => {
    it('should record retry attempt with narrowed scope', () => {
      let execution = taskExecution;
      execution = recordRetryAttempt(
        execution,
        'Test timeout - reducing file scope',
        ['src/middleware/__tests__/auth.test.ts'] // Narrowed scope
      );

      expect(execution.attemptNumber).toBe(2);
      expect(execution.retryHistory).toHaveLength(1);
      expect(execution.retryHistory[0].error).toContain('Test timeout');
      expect(execution.retryHistory[0].scopeNarrowed).toHaveLength(1);
    });

    it('should track multiple retry attempts', () => {
      let execution = taskExecution;
      execution = recordRetryAttempt(execution, 'First retry', ['file1.ts']);
      execution = recordRetryAttempt(execution, 'Second retry', ['file2.ts']);

      expect(execution.attemptNumber).toBe(3);
      expect(execution.retryHistory).toHaveLength(2);
      expect(execution.retryHistory[0].attemptNumber).toBe(1);
      expect(execution.retryHistory[1].attemptNumber).toBe(2);
    });

    it('should include retry context in task', () => {
      const narrowedTask = {
        ...validTask,
        retryContext: 'Previous attempt timed out. Narrowing scope to critical files only.',
      };
      expect(narrowedTask.retryContext).toContain('Narrowing scope');
    });
  });

  describe('Task Progress Calculation', () => {
    it('should calculate progress based on files modified', () => {
      let execution = taskExecution;
      execution.outputs.changedFiles = ['src/middleware/auth.ts'];

      const progress = calculateTaskProgress(execution, 2, 2);
      expect(progress).toBeGreaterThan(0);
      expect(progress).toBeLessThanOrEqual(100);
    });

    it('should calculate 60% max for file modifications when all expected files are modified', () => {
      let execution = taskExecution;
      execution.outputs.changedFiles = ['file1.ts', 'file2.ts', 'file3.ts'];

      const progress = calculateTaskProgress(execution, 3, 2);
      expect(progress).toBeGreaterThanOrEqual(55); // Close to 60%
      expect(progress).toBeLessThanOrEqual(70);
    });

    it('should add 30% when stop condition is met', () => {
      let execution = taskExecution;
      execution.outputs.changedFiles = ['file1.ts', 'file2.ts'];
      execution.outputs.commandsRun = ['npm test'];
      execution.stopConditionsMetAt = 'all_tests_pass';

      const progress = calculateTaskProgress(execution, 2, 2);
      expect(progress).toBeGreaterThan(95); // 60% files + 10% commands + 30% stop condition
    });

    it('should cap progress at 100%', () => {
      let execution = taskExecution;
      execution.outputs.changedFiles = ['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts', 'file5.ts'];
      execution.outputs.commandsRun = ['npm test', 'npm run lint'];
      execution.stopConditionsMetAt = 'all_tests_pass';

      const progress = calculateTaskProgress(execution, 5, 2);
      expect(progress).toBeLessThanOrEqual(100);
    });

    it('should show progress when partially complete', () => {
      let execution = taskExecution;
      execution.outputs.changedFiles = ['src/middleware/auth.ts'];

      const progress = calculateTaskProgress(execution, 2, 2);
      // 50% file ratio * 60% = 30%, plus partial credit for stop conditions
      expect(progress).toBeGreaterThanOrEqual(25);
      expect(progress).toBeLessThanOrEqual(45);
    });

    it('should reduce progress for errors', () => {
      let execution = taskExecution;
      execution.outputs.changedFiles = ['src/middleware/auth.ts'];
      execution = recordTaskError(execution, 'Linting failed', true);
      execution = recordTaskError(execution, 'Test failed', true);

      const progress = calculateTaskProgress(execution, 2, 2);
      expect(progress).toBeGreaterThanOrEqual(0);
      // Has partial credit but no stop condition bonus due to errors
      expect(progress).toBeLessThanOrEqual(50);
    });
  });

  describe('Task Input/Output Specification', () => {
    it('should preserve task inputs', () => {
      expect(validTask.inputs.codeContext).toBe('JWT validation in src/middleware/auth.ts');
      expect(validTask.inputs.specifications).toHaveProperty('token-expiry');
    });

    it('should specify expected outputs', () => {
      expect(validTask.expectedOutputs.changedFiles).toContain('src/middleware/auth.ts');
      expect(validTask.expectedOutputs.fileTypes).toContain('ts');
      expect(validTask.expectedOutputs.outputFormat).toBe('code');
    });

    it('should track actual output changes', () => {
      let execution = taskExecution;
      execution.outputs.changedFiles = ['src/middleware/auth.ts', 'tests/auth.test.ts'];
      execution.outputs.commandsRun = ['npm test', 'npm run lint'];

      expect(execution.outputs.changedFiles).toHaveLength(2);
      expect(execution.outputs.commandsRun).toHaveLength(2);
    });
  });

  describe('Stop Conditions', () => {
    it('should support all_tests_pass stop condition', () => {
      const stopCondition = validTask.stopConditions.find((c) => c.type === 'all_tests_pass');
      expect(stopCondition).toBeDefined();
      expect(stopCondition!.description).toContain('auth tests');
    });

    it('should support file_count stop condition', () => {
      const taskWithFileLimit = {
        ...validTask,
        stopConditions: [
          {
            type: 'file_count' as const,
            value: 5,
            description: 'Modify no more than 5 files',
          },
        ],
      };
      expect(taskWithFileLimit.stopConditions[0].value).toBe(5);
    });

    it('should support time_limit stop condition', () => {
      const taskWithTimeLimit = {
        ...validTask,
        stopConditions: [
          {
            type: 'time_limit' as const,
            value: 60000,
            description: 'Complete within 60 seconds',
          },
        ],
      };
      expect(taskWithTimeLimit.stopConditions[0].value).toBe(60000);
    });

    it('should track when stop condition is met', () => {
      let execution = taskExecution;
      execution.stopConditionsMetAt = 'all_tests_pass';
      expect(execution.stopConditionsMetAt).toBe('all_tests_pass');
    });
  });

  describe('Task Priority & Dependencies', () => {
    it('should set task priority', () => {
      expect(validTask.priority).toBe('high');
    });

    it('should handle task dependencies', () => {
      const dependentTask = {
        ...validTask,
        id: 'task-002',
        dependsOn: ['task-001'],
        userRequest: 'Update frontend to use new auth endpoint',
      };
      expect(dependentTask.dependsOn).toContain('task-001');
    });

    it('should support subtasks', () => {
      const subtask = {
        ...validTask,
        id: 'task-001-sub',
        parentTaskId: 'task-001',
        userRequest: 'Fix JWT expiry validation',
      };
      expect(subtask.parentTaskId).toBe('task-001');
    });

    it('should track blocking tasks', () => {
      const blockingTask = {
        ...validTask,
        blockingTasks: ['task-003', 'task-004'],
      };
      expect(blockingTask.blockingTasks).toHaveLength(2);
    });
  });

  describe('Confidence Scoring', () => {
    it('should initialize with zero confidence', () => {
      expect(taskExecution.confidence).toBe(0);
    });

    it('should track confidence after execution', () => {
      let execution = taskExecution;
      execution.confidence = 0.95;
      expect(execution.confidence).toBe(0.95);
    });

    it('should support confidence range 0-1', () => {
      let execution = taskExecution;
      execution.confidence = 0.87;
      expect(execution.confidence).toBeGreaterThanOrEqual(0);
      expect(execution.confidence).toBeLessThanOrEqual(1);
    });
  });
});
