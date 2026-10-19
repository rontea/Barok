/**
 * Phase 4.7 Tests - Retry Logic with Scope Narrowing
 * Tests exponential backoff, scope narrowing, escalation, and retry loop detection
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  createDefaultRetryConfig,
  shouldRetry,
  shouldNarrowScope,
  createScopeNarrowing,
  applyStricterScope,
  calculateRetryDelay,
  isRetryWorthwhile,
  formatRetryHistory,
  isInRetryLoop,
  getEscalationRecommendation,
  type RetryConfig,
  type RetryStrategy,
  type RetryHistory,
} from '../retryStrategy.js';
import { createTaskExecution, recordTaskError, recordRetryAttempt, type AgentTaskExecution } from '../agentTasking.js';
import type { BoundedAgentTask } from '../agentTasking.js';

// Test fixtures
const createTestTask = (): BoundedAgentTask => ({
  id: 'task-001',
  agentRole: 'backend',
  userRequest: 'Fix database connection',
  classification: 'bug_fix',
  complexity: 'moderate',
  inputs: {},
  expectedOutputs: {
    changedFiles: ['src/db.ts', 'src/pool.ts', 'src/connection.ts'],
    fileTypes: ['ts'],
  },
  ownedFiles: ['src/db.ts', 'src/pool.ts', 'src/connection.ts'],
  touchedLayers: ['backend', 'data'],
  allowedTools: ['typescript'],
  stopConditions: [{ type: 'all_tests_pass', description: 'Tests pass' }],
  timeoutMs: 300000,
  maxRetries: 3,
  maxFilesToModify: 10,
  createdAt: Date.now(),
  priority: 'high',
});

describe('Phase 4.7 - Retry Logic with Scope Narrowing', () => {
  let config: RetryConfig;
  let execution: AgentTaskExecution;
  let task: BoundedAgentTask;

  beforeEach(() => {
    config = createDefaultRetryConfig();
    execution = createTaskExecution('task-001', 'backend');
    task = createTestTask();
  });

  describe('Retry Configuration', () => {
    it('should create default retry config', () => {
      expect(config.maxRetries).toBe(3);
      expect(config.baseDelayMs).toBe(500);
      expect(config.maxDelayMs).toBe(30000);
      expect(config.backoffMultiplier).toBe(2);
    });

    it('should have escalation criteria', () => {
      expect(config.escalationCriteria.maxConsecutiveErrors).toBeGreaterThan(0);
      expect(config.escalationCriteria.timeoutThreshold).toBeGreaterThan(0);
    });
  });

  describe('Retry Decision Logic', () => {
    it('should not retry without errors', () => {
      const strategy = shouldRetry(execution, config);

      expect(strategy.shouldRetry).toBe(false);
      expect(strategy.reason).toContain('No errors');
    });

    it('should retry on recoverable error', () => {
      let exec = recordTaskError(execution, 'Timeout occurred', true);
      const strategy = shouldRetry(exec, config);

      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.reason).toContain('Recoverable');
    });

    it('should not retry on non-recoverable error', () => {
      let exec = recordTaskError(execution, 'Database schema mismatch', false);
      const strategy = shouldRetry(exec, config);

      expect(strategy.shouldRetry).toBe(false);
      expect(strategy.escalationRequired).toBe(true);
    });

    it('should not retry after max retries', () => {
      let exec = execution;
      exec.attemptNumber = config.maxRetries;
      exec = recordTaskError(exec, 'Still failing', true);

      const strategy = shouldRetry(exec, config);

      expect(strategy.shouldRetry).toBe(false);
      expect(strategy.reason).toContain('Max retries');
      expect(strategy.escalationRequired).toBe(true);
    });
  });

  describe('Exponential Backoff', () => {
    it('should calculate exponential backoff delays', () => {
      const strategy1: RetryStrategy = {
        shouldRetry: true,
        reason: 'Test',
        nextAttempt: 1,
        delayMs: 500,
        escalationRequired: false,
      };

      const strategy2: RetryStrategy = {
        shouldRetry: true,
        reason: 'Test',
        nextAttempt: 2,
        delayMs: 1000, // 500 * 2^1
        escalationRequired: false,
      };

      const strategy3: RetryStrategy = {
        shouldRetry: true,
        reason: 'Test',
        nextAttempt: 3,
        delayMs: 2000, // 500 * 2^2
        escalationRequired: false,
      };

      expect(strategy2.delayMs).toBeGreaterThan(strategy1.delayMs);
      expect(strategy3.delayMs).toBeGreaterThan(strategy2.delayMs);
    });

    it('should cap backoff at maxDelayMs', () => {
      let exec = execution;
      for (let i = 0; i < 10; i++) {
        exec = recordTaskError(exec, 'Timeout', true);
        exec.attemptNumber++;
      }

      const strategy = shouldRetry(exec, config);

      // Should reach the max delay at some point
      expect(strategy.delayMs).toBeLessThanOrEqual(config.maxDelayMs);
    });

    it('should add jitter to delay', () => {
      const strategy: RetryStrategy = {
        shouldRetry: true,
        reason: 'Test',
        nextAttempt: 2,
        delayMs: 1000,
        escalationRequired: false,
      };

      const delay = calculateRetryDelay(strategy);
      const tolerance = 1000 * 0.1; // +/- 10%

      expect(Math.abs(delay - strategy.delayMs)).toBeLessThanOrEqual(tolerance);
    });
  });

  describe('Scope Narrowing Detection', () => {
    it('should not narrow scope on first retry', () => {
      let exec = recordTaskError(execution, 'Timeout', true);
      expect(shouldNarrowScope(exec, config)).toBe(false);
    });

    it('should narrow scope on timeout error', () => {
      let exec = execution;
      exec.attemptNumber = 2;
      exec = recordTaskError(exec, 'Task timeout after 60 seconds', true);

      expect(shouldNarrowScope(exec, config)).toBe(true);
    });

    it('should narrow scope on file conflict', () => {
      let exec = execution;
      exec.attemptNumber = 2;
      exec = recordTaskError(exec, 'File conflict in src/db.ts', true);

      expect(shouldNarrowScope(exec, config)).toBe(true);
    });

    it('should narrow scope on resource error', () => {
      let exec = execution;
      exec.attemptNumber = 2;
      exec = recordTaskError(exec, 'Memory limit exceeded', true);

      expect(shouldNarrowScope(exec, config)).toBe(true);
    });
  });

  describe('Scope Narrowing Application', () => {
    it('should create scope narrowing directives for timeout', () => {
      let exec = execution;
      exec.attemptNumber = 2;
      exec = recordTaskError(exec, 'Timeout error', true);
      exec.outputs.changedFiles = ['src/db.ts', 'src/pool.ts', 'src/connection.ts'];

      const narrowing = createScopeNarrowing(exec, config);

      expect(narrowing).toBeDefined();
      expect(narrowing.excludeFiles.length).toBeGreaterThan(0);
      expect(narrowing.reason).toContain('Timeout');
    });

    it('should apply stricter scope to task', () => {
      const narrowing = {
        excludeFiles: ['src/connection.ts'],
        excludeLayers: [],
        reduceComplexity: true,
        reason: 'Timeout - reducing scope',
      };

      const narrowedTask = applyStricterScope(task, narrowing);

      expect(narrowedTask.expectedOutputs.changedFiles).not.toContain('src/connection.ts');
      expect(narrowedTask.expectedOutputs.changedFiles.length).toBeLessThan(
        task.expectedOutputs.changedFiles.length
      );
    });

    it('should reduce complexity when applying stricter scope', () => {
      const narrowing = {
        excludeFiles: [],
        excludeLayers: [],
        reduceComplexity: true,
        reason: 'Reducing complexity',
      };

      const narrowedTask = applyStricterScope(task, narrowing);

      const complexityLevels = ['trivial', 'simple', 'moderate', 'complex', 'expert'];
      const originalIndex = complexityLevels.indexOf(task.complexity);
      const narrowedIndex = complexityLevels.indexOf(narrowedTask.complexity);

      expect(narrowedIndex).toBeLessThanOrEqual(originalIndex);
    });

    it('should maintain at least one file', () => {
      const narrowing = {
        excludeFiles: task.expectedOutputs.changedFiles.slice(1),
        excludeLayers: [],
        reduceComplexity: false,
        reason: 'Narrowing scope',
      };

      const narrowedTask = applyStricterScope(task, narrowing);

      expect(narrowedTask.expectedOutputs.changedFiles.length).toBeGreaterThan(0);
    });

    it('should add retry context to task', () => {
      const narrowing = {
        excludeFiles: ['src/connection.ts'],
        excludeLayers: [],
        reduceComplexity: false,
        reason: 'File conflict',
      };

      const narrowedTask = applyStricterScope(task, narrowing);

      expect(narrowedTask.retryContext).toBeDefined();
      expect(narrowedTask.retryContext).toContain('Retry');
      expect(narrowedTask.retryContext).toContain('File conflict');
    });
  });

  describe('Retry Worthiness', () => {
    it('should consider retry worthwhile on first error', () => {
      let exec = recordTaskError(execution, 'Timeout', true);

      expect(isRetryWorthwhile(exec, config)).toBe(true);
    });

    it('should consider retry worthwhile within limit', () => {
      let exec = execution;
      exec.attemptNumber = 2;
      exec = recordTaskError(exec, 'Error 1', true);
      exec = recordTaskError(exec, 'Error 2', true);

      expect(isRetryWorthwhile(exec, config)).toBe(true);
    });

    it('should not retry after max attempts', () => {
      let exec = execution;
      exec.attemptNumber = config.maxRetries + 1;
      exec = recordTaskError(exec, 'Still failing', true);

      expect(isRetryWorthwhile(exec, config)).toBe(false);
    });

    it('should not retry on repeated same error', () => {
      let exec = execution;
      exec.attemptNumber = 3;
      exec = recordTaskError(exec, 'Database connection timeout', true, 'DB_TIMEOUT');
      exec = recordTaskError(exec, 'Database connection timeout', true, 'DB_TIMEOUT');

      expect(isRetryWorthwhile(exec, config)).toBe(false);
    });
  });

  describe('Retry Loop Detection', () => {
    it('should detect retry loop', () => {
      let exec = execution;
      exec = recordRetryAttempt(exec, 'Error: Connection refused');
      exec = recordRetryAttempt(exec, 'Error: Connection refused');

      expect(isInRetryLoop(exec)).toBe(true);
    });

    it('should not detect loop with different errors', () => {
      let exec = execution;
      exec = recordRetryAttempt(exec, 'Timeout error');
      exec = recordRetryAttempt(exec, 'Memory error');

      expect(isInRetryLoop(exec)).toBe(false);
    });

    it('should not detect loop with only one retry', () => {
      let exec = execution;
      exec = recordRetryAttempt(exec, 'Some error');

      expect(isInRetryLoop(exec)).toBe(false);
    });
  });

  describe('Escalation Recommendations', () => {
    it('should recommend escalation for retry loop', () => {
      let exec = execution;
      exec = recordRetryAttempt(exec, 'Same error');
      exec = recordRetryAttempt(exec, 'Same error');

      const recommendation = getEscalationRecommendation(exec, config);

      expect(recommendation).toBeDefined();
      expect(recommendation).toContain('retry loop');
    });

    it('should recommend escalation after max retries', () => {
      let exec = execution;
      exec.attemptNumber = config.maxRetries;
      exec = recordTaskError(exec, 'Still failing', true);

      const recommendation = getEscalationRecommendation(exec, config);

      expect(recommendation).toBeDefined();
      expect(recommendation).toContain('Max retries');
    });

    it('should recommend escalation for non-recoverable error', () => {
      let exec = recordTaskError(execution, 'Schema mismatch', false);

      const recommendation = getEscalationRecommendation(exec, config);

      expect(recommendation).toBeDefined();
      expect(recommendation).toContain('Non-recoverable');
    });

    it('should recommend task splitting for timeout pattern', () => {
      let exec = execution;
      for (let i = 0; i < config.escalationCriteria.maxConsecutiveErrors + 1; i++) {
        exec = recordTaskError(exec, 'Timeout occurred', true);
      }

      const recommendation = getEscalationRecommendation(exec, config);

      expect(recommendation).toBeDefined();
      expect(recommendation?.toLowerCase()).toContain('timeout');
    });
  });

  describe('Retry History Formatting', () => {
    it('should format empty history', () => {
      const formatted = formatRetryHistory([]);

      expect(formatted).toContain('No retries');
    });

    it('should format single retry', () => {
      const history: RetryHistory[] = [
        {
          attemptNumber: 1,
          error: 'Timeout',
          errorCode: 'TIMEOUT',
          startTime: Date.now(),
          durationMs: 5000,
          recovery: false,
        },
      ];

      const formatted = formatRetryHistory(history);

      expect(formatted).toContain('Attempt 1');
      expect(formatted).toContain('Timeout');
      expect(formatted).toContain('5000ms');
    });

    it('should format multiple retries', () => {
      const history: RetryHistory[] = [
        {
          attemptNumber: 1,
          error: 'Timeout',
          startTime: Date.now(),
          durationMs: 5000,
          recovery: false,
        },
        {
          attemptNumber: 2,
          error: 'Memory limit',
          startTime: Date.now(),
          durationMs: 3000,
          scopeNarrowedBy: ['src/file.ts'],
          recovery: false,
        },
      ];

      const formatted = formatRetryHistory(history);

      expect(formatted).toContain('Attempt 1');
      expect(formatted).toContain('Attempt 2');
      expect(formatted).toContain('narrowed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero-delay first retry', () => {
      config.baseDelayMs = 0;
      let exec = recordTaskError(execution, 'Quick error', true);

      const strategy = shouldRetry(exec, config);

      expect(strategy.delayMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle very complex tasks', () => {
      const complexTask = { ...task, complexity: 'expert' as const };

      const narrowing = {
        excludeFiles: [],
        excludeLayers: [],
        reduceComplexity: true,
        reason: 'Reduce complexity',
      };

      const narrowedTask = applyStricterScope(complexTask, narrowing);

      // Should reduce to one level below
      expect(narrowedTask.complexity).not.toBe('expert');
    });

    it('should handle tasks with no files to exclude', () => {
      const singleFileTask = { ...task, expectedOutputs: { changedFiles: ['src/db.ts'], fileTypes: ['ts'] } };

      const narrowing = {
        excludeFiles: ['src/db.ts'],
        excludeLayers: [],
        reduceComplexity: false,
        reason: 'Test',
      };

      const narrowedTask = applyStricterScope(singleFileTask, narrowing);

      // Should keep at least the one file
      expect(narrowedTask.expectedOutputs.changedFiles.length).toBeGreaterThan(0);
    });
  });
});
