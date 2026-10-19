/**
 * Phase 6: Verification Result Storage Tests
 */

import {
  storeVerificationResult,
  getVerificationResult,
  getVerificationHistory,
  getVerificationsForWorkPlan,
  getFailedVerifications,
  getVerificationsByLayer,
  getRecentVerifications,
  calculateSuccessRate,
  getAverageConfidence,
  getMostCommonFailures,
  generateVerificationReport,
  clearVerificationHistory,
  generateVerificationId,
  exportVerificationData,
  attachRepairTask,
  getRepairTasksForVerification,
  type StoredVerification,
} from '../verificationResultStorage';

import { createRepairTask, type VerificationResult } from '../verificationPlanner';

describe('Phase 6: Verification Result Storage', () => {
  beforeEach(() => {
    clearVerificationHistory();
  });

  describe('storeVerificationResult', () => {
    it('should store verification result', () => {
      const verification: StoredVerification = {
        id: 'verify-1',
        workPlanId: 'plan-1',
        result: {
          planId: 'plan-1',
          status: 'passed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 1,
        } as VerificationResult,
        layers: ['frontend'],
        changedFiles: ['ui/App.tsx'],
        timestamp: new Date(),
      };

      storeVerificationResult(verification);

      const retrieved = getVerificationResult('verify-1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.workPlanId).toBe('plan-1');
    });

    it('should generate ID if not provided', () => {
      const verification: StoredVerification = {
        id: '',
        workPlanId: 'plan-1',
        result: {
          planId: 'plan-1',
          status: 'passed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 1,
        } as VerificationResult,
        layers: ['frontend'],
        changedFiles: ['ui/App.tsx'],
        timestamp: new Date(),
      };

      storeVerificationResult(verification);

      expect(verification.id).toBeDefined();
      expect(verification.id.length).toBeGreaterThan(0);
    });

    it('should set timestamp', () => {
      const verification: StoredVerification = {
        id: 'verify-1',
        workPlanId: 'plan-1',
        result: {
          planId: 'plan-1',
          status: 'passed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 1,
        } as VerificationResult,
        layers: ['frontend'],
        changedFiles: ['ui/App.tsx'],
        timestamp: new Date('2020-01-01'),
      };

      const beforeStore = new Date();
      storeVerificationResult(verification);
      const afterStore = new Date();

      expect(verification.timestamp.getTime()).toBeGreaterThanOrEqual(
        beforeStore.getTime()
      );
      expect(verification.timestamp.getTime()).toBeLessThanOrEqual(
        afterStore.getTime()
      );
    });
  });

  describe('getVerificationResult', () => {
    it('should retrieve stored verification', () => {
      const verification: StoredVerification = {
        id: 'verify-1',
        workPlanId: 'plan-1',
        result: {
          planId: 'plan-1',
          status: 'passed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 1,
        } as VerificationResult,
        layers: ['frontend'],
        changedFiles: ['ui/App.tsx'],
        timestamp: new Date(),
      };

      storeVerificationResult(verification);
      const retrieved = getVerificationResult('verify-1');

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('verify-1');
    });

    it('should return undefined for non-existent verification', () => {
      const result = getVerificationResult('non-existent');

      expect(result).toBeUndefined();
    });
  });

  describe('getVerificationHistory', () => {
    it('should return empty history initially', () => {
      const history = getVerificationHistory();

      expect(history.totalVerifications).toBe(0);
      expect(history.passedCount).toBe(0);
      expect(history.verifications).toHaveLength(0);
    });

    it('should track passed verifications', () => {
      const verification: StoredVerification = {
        id: 'verify-1',
        workPlanId: 'plan-1',
        result: {
          planId: 'plan-1',
          status: 'passed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 1,
        } as VerificationResult,
        layers: ['frontend'],
        changedFiles: ['ui/App.tsx'],
        timestamp: new Date(),
      };

      storeVerificationResult(verification);
      const history = getVerificationHistory();

      expect(history.totalVerifications).toBe(1);
      expect(history.passedCount).toBe(1);
      expect(history.failedCount).toBe(0);
    });

    it('should track failed verifications', () => {
      const verification: StoredVerification = {
        id: 'verify-1',
        workPlanId: 'plan-1',
        result: {
          planId: 'plan-1',
          status: 'failed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 0.5,
        } as VerificationResult,
        layers: ['frontend'],
        changedFiles: ['ui/App.tsx'],
        timestamp: new Date(),
      };

      storeVerificationResult(verification);
      const history = getVerificationHistory();

      expect(history.failedCount).toBe(1);
    });

    it('should calculate average confidence', () => {
      const v1: StoredVerification = {
        id: 'verify-1',
        workPlanId: 'plan-1',
        result: {
          planId: 'plan-1',
          status: 'passed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 1,
        } as VerificationResult,
        layers: ['frontend'],
        changedFiles: ['ui/App.tsx'],
        timestamp: new Date(),
      };

      const v2: StoredVerification = {
        id: 'verify-2',
        workPlanId: 'plan-2',
        result: {
          planId: 'plan-2',
          status: 'passed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 0.8,
        } as VerificationResult,
        layers: ['backend'],
        changedFiles: ['src/api.ts'],
        timestamp: new Date(),
      };

      storeVerificationResult(v1);
      storeVerificationResult(v2);
      const history = getVerificationHistory();

      expect(history.avgConfidence).toBe(0.9);
    });
  });

  describe('getVerificationsForWorkPlan', () => {
    it('should filter verifications by work plan', () => {
      const v1: StoredVerification = {
        id: 'verify-1',
        workPlanId: 'plan-1',
        result: {
          planId: 'plan-1',
          status: 'passed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 1,
        } as VerificationResult,
        layers: ['frontend'],
        changedFiles: ['ui/App.tsx'],
        timestamp: new Date(),
      };

      const v2: StoredVerification = {
        id: 'verify-2',
        workPlanId: 'plan-2',
        result: {
          planId: 'plan-2',
          status: 'passed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 1,
        } as VerificationResult,
        layers: ['backend'],
        changedFiles: ['src/api.ts'],
        timestamp: new Date(),
      };

      storeVerificationResult(v1);
      storeVerificationResult(v2);

      const plan1Verifications = getVerificationsForWorkPlan('plan-1');

      expect(plan1Verifications.length).toBe(1);
      expect(plan1Verifications[0].workPlanId).toBe('plan-1');
    });
  });

  describe('getFailedVerifications', () => {
    it('should retrieve only failed verifications', () => {
      const passed: StoredVerification = {
        id: 'verify-1',
        workPlanId: 'plan-1',
        result: {
          planId: 'plan-1',
          status: 'passed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 1,
        } as VerificationResult,
        layers: ['frontend'],
        changedFiles: ['ui/App.tsx'],
        timestamp: new Date(),
      };

      const failed: StoredVerification = {
        id: 'verify-2',
        workPlanId: 'plan-2',
        result: {
          planId: 'plan-2',
          status: 'failed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 0.5,
        } as VerificationResult,
        layers: ['backend'],
        changedFiles: ['src/api.ts'],
        timestamp: new Date(),
      };

      storeVerificationResult(passed);
      storeVerificationResult(failed);

      const failedVerifications = getFailedVerifications();

      expect(failedVerifications.length).toBe(1);
      expect(failedVerifications[0].result.status).toBe('failed');
    });
  });

  describe('getVerificationsByLayer', () => {
    it('should filter verifications by layer', () => {
      const frontend: StoredVerification = {
        id: 'verify-1',
        workPlanId: 'plan-1',
        result: {
          planId: 'plan-1',
          status: 'passed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 1,
        } as VerificationResult,
        layers: ['frontend'],
        changedFiles: ['ui/App.tsx'],
        timestamp: new Date(),
      };

      const backend: StoredVerification = {
        id: 'verify-2',
        workPlanId: 'plan-2',
        result: {
          planId: 'plan-2',
          status: 'passed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 1,
        } as VerificationResult,
        layers: ['backend'],
        changedFiles: ['src/api.ts'],
        timestamp: new Date(),
      };

      storeVerificationResult(frontend);
      storeVerificationResult(backend);

      const frontendVerifications = getVerificationsByLayer('frontend');

      expect(frontendVerifications.length).toBe(1);
      expect(frontendVerifications[0].layers).toContain('frontend');
    });
  });

  describe('getRecentVerifications', () => {
    it('should return recent verifications', () => {
      for (let i = 0; i < 5; i++) {
        const verification: StoredVerification = {
          id: `verify-${i}`,
          workPlanId: `plan-${i}`,
          result: {
            planId: `plan-${i}`,
            status: 'passed',
            checks: [],
            totalDuration: 5000,
            failedChecks: [],
            startTime: new Date(),
            confidence: 1,
          } as VerificationResult,
          layers: ['frontend'],
          changedFiles: ['ui/App.tsx'],
          timestamp: new Date(),
        };

        storeVerificationResult(verification);
      }

      const recent = getRecentVerifications(3);

      expect(recent.length).toBe(3);
    });
  });

  describe('calculateSuccessRate', () => {
    it('should calculate success rate', () => {
      for (let i = 0; i < 3; i++) {
        const verification: StoredVerification = {
          id: `verify-${i}`,
          workPlanId: `plan-${i}`,
          result: {
            planId: `plan-${i}`,
            status: 'passed',
            checks: [],
            totalDuration: 5000,
            failedChecks: [],
            startTime: new Date(),
            confidence: 1,
          } as VerificationResult,
          layers: ['frontend'],
          changedFiles: ['ui/App.tsx'],
          timestamp: new Date(),
        };

        storeVerificationResult(verification);
      }

      const verification: StoredVerification = {
        id: 'verify-failed',
        workPlanId: 'plan-failed',
        result: {
          planId: 'plan-failed',
          status: 'failed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 0.5,
        } as VerificationResult,
        layers: ['backend'],
        changedFiles: ['src/api.ts'],
        timestamp: new Date(),
      };

      storeVerificationResult(verification);

      const rate = calculateSuccessRate();

      expect(rate).toBe(75);
    });
  });

  describe('getAverageConfidence', () => {
    it('should calculate average confidence', () => {
      const v1: StoredVerification = {
        id: 'verify-1',
        workPlanId: 'plan-1',
        result: {
          planId: 'plan-1',
          status: 'passed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 0.8,
        } as VerificationResult,
        layers: ['frontend'],
        changedFiles: ['ui/App.tsx'],
        timestamp: new Date(),
      };

      const v2: StoredVerification = {
        id: 'verify-2',
        workPlanId: 'plan-2',
        result: {
          planId: 'plan-2',
          status: 'passed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 0.6,
        } as VerificationResult,
        layers: ['backend'],
        changedFiles: ['src/api.ts'],
        timestamp: new Date(),
      };

      storeVerificationResult(v1);
      storeVerificationResult(v2);

      const avg = getAverageConfidence();

      expect(avg).toBe(0.7);
    });
  });

  describe('getMostCommonFailures', () => {
    it('should identify most common failure types', () => {
      const verification: StoredVerification = {
        id: 'verify-1',
        workPlanId: 'plan-1',
        result: {
          planId: 'plan-1',
          status: 'failed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [
            {
              checkType: 'typescript',
              passed: false,
              duration: 1000,
              errors: ['Error'],
              warnings: [],
              details: {},
            },
            {
              checkType: 'lint',
              passed: false,
              duration: 500,
              errors: ['Lint error'],
              warnings: [],
              details: {},
            },
          ],
          startTime: new Date(),
          confidence: 0.5,
        } as VerificationResult,
        layers: ['frontend'],
        changedFiles: ['ui/App.tsx'],
        timestamp: new Date(),
      };

      storeVerificationResult(verification);

      const failures = getMostCommonFailures();

      expect(failures.typescript).toBe(1);
      expect(failures.lint).toBe(1);
    });
  });

  describe('generateVerificationReport', () => {
    it('should generate report with statistics', () => {
      const verification: StoredVerification = {
        id: 'verify-1',
        workPlanId: 'plan-1',
        result: {
          planId: 'plan-1',
          status: 'passed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 1,
        } as VerificationResult,
        layers: ['frontend'],
        changedFiles: ['ui/App.tsx'],
        timestamp: new Date(),
      };

      storeVerificationResult(verification);

      const report = generateVerificationReport();

      expect(report).toContain('Verification Report');
      expect(report).toContain('Overall Statistics');
      expect(report).toContain('1');
    });
  });

  describe('attachRepairTask and getRepairTasksForVerification', () => {
    it('should attach and retrieve repair tasks', () => {
      const verification: StoredVerification = {
        id: 'verify-1',
        workPlanId: 'plan-1',
        result: {
          planId: 'plan-1',
          status: 'failed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 0.5,
        } as VerificationResult,
        layers: ['frontend'],
        changedFiles: ['ui/App.tsx'],
        timestamp: new Date(),
      };

      storeVerificationResult(verification);

      const repairTask = createRepairTask(verification.result);
      attachRepairTask('verify-1', repairTask);

      const tasks = getRepairTasksForVerification('verify-1');

      expect(tasks.length).toBe(1);
      expect(tasks[0].taskId).toBe(repairTask.taskId);
    });
  });

  describe('Utility functions', () => {
    it('should generate unique verification IDs', () => {
      const id1 = generateVerificationId();
      const id2 = generateVerificationId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^verify-/);
    });
  });

  describe('exportVerificationData', () => {
    it('should export all verification data', () => {
      const verification: StoredVerification = {
        id: 'verify-1',
        workPlanId: 'plan-1',
        result: {
          planId: 'plan-1',
          status: 'passed',
          checks: [],
          totalDuration: 5000,
          failedChecks: [],
          startTime: new Date(),
          confidence: 1,
        } as VerificationResult,
        layers: ['frontend'],
        changedFiles: ['ui/App.tsx'],
        timestamp: new Date(),
      };

      storeVerificationResult(verification);

      const exported = exportVerificationData();

      expect(exported).toHaveProperty('verifications');
      expect(exported).toHaveProperty('statistics');
      expect(exported).toHaveProperty('successRate');
    });
  });
});
