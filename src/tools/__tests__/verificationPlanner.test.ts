/**
 * Phase 6: Verification Planner Tests
 */

import {
  createVerificationPlan,
  createVerificationResult,
  calculateConfidence,
  createRepairTask,
  getSuggestedActions,
  estimateChecksDuration,
  generateRequestId,
  generateTaskId,
  shouldStopVerification,
  getVerificationSummary,
  getCriticalChecks,
  getOptionalChecks,
  type CheckResult,
} from '../verificationPlanner';

describe('Phase 6: Verification Planner', () => {
  describe('createVerificationPlan', () => {
    it('should create plan for frontend layer', () => {
      const plan = createVerificationPlan(['frontend'], ['ui/components/Button.tsx']);

      expect(plan.affectedLayers).toContain('frontend');
      expect(plan.plannedChecks).toContain('typescript');
      expect(plan.plannedChecks).toContain('lint');
      expect(plan.plannedChecks).toContain('build');
      expect(plan.plannedChecks).toContain('console-errors');
    });

    it('should create plan for backend layer', () => {
      const plan = createVerificationPlan(['backend'], ['src/api.ts']);

      expect(plan.affectedLayers).toContain('backend');
      expect(plan.plannedChecks).toContain('typescript');
      expect(plan.plannedChecks).toContain('lint');
      expect(plan.plannedChecks).toContain('validation');
      expect(plan.plannedChecks).toContain('api-smoke');
    });

    it('should add security checks for auth changes', () => {
      const plan = createVerificationPlan(['backend'], ['src/auth.ts']);

      expect(plan.plannedChecks).toContain('security');
      expect(plan.criticalChecks).toContain('security');
    });

    it('should create plan for data layer', () => {
      const plan = createVerificationPlan(['data'], ['src/migrations']);

      expect(plan.plannedChecks).toContain('schema');
      expect(plan.plannedChecks).toContain('persistence');
      expect(plan.plannedChecks).toContain('seed-data');
    });

    it('should create plan for test layer', () => {
      const plan = createVerificationPlan(['tests'], ['src/__tests__/api.test.ts']);

      expect(plan.plannedChecks).toContain('unit-tests');
    });

    it('should create plan for docs layer', () => {
      const plan = createVerificationPlan(['docs'], ['docs/API.md']);

      expect(plan.plannedChecks).toContain('links');
      expect(plan.plannedChecks).toContain('examples');
      expect(plan.plannedChecks).toContain('references');
      expect(plan.plannedChecks).toContain('api-names');
    });

    it('should handle multiple layers', () => {
      const plan = createVerificationPlan(
        ['frontend', 'backend', 'data'],
        ['ui/App.tsx', 'src/api.ts', 'src/migrations']
      );

      expect(plan.affectedLayers.length).toBe(3);
      expect(plan.plannedChecks.length).toBeGreaterThan(6);
    });

    it('should set high priority for backend changes', () => {
      const plan = createVerificationPlan(['backend'], ['src/api.ts']);

      expect(plan.priority).toBe('high');
    });

    it('should set critical priority for auth changes', () => {
      const plan = createVerificationPlan(['backend'], ['src/auth/index.ts']);

      expect(plan.priority).toBe('critical');
    });

    it('should estimate duration correctly', () => {
      const plan = createVerificationPlan(['frontend'], ['ui/App.tsx']);

      expect(plan.estimatedDuration).toBeGreaterThan(0);
      expect(plan.estimatedDuration).toBeLessThan(120000); // Less than 2 minutes
    });

    it('should include playwright checks for large UI changes', () => {
      const largeUIChanges = Array(5)
        .fill(0)
        .map((_, i) => `ui/components/Component${i}.tsx`);

      const plan = createVerificationPlan(['frontend'], largeUIChanges);

      expect(plan.plannedChecks.length).toBeGreaterThan(4);
    });

    it('should include integration tests for large changes', () => {
      const largeChanges = Array(10)
        .fill(0)
        .map((_, i) => `src/module${i}.ts`);

      const plan = createVerificationPlan(['tests'], largeChanges);

      expect(plan.plannedChecks.length).toBeGreaterThan(0);
    });
  });

  describe('calculateConfidence', () => {
    it('should calculate high confidence when all tests pass', () => {
      const mockResults: CheckResult[] = [
        {
          checkType: 'typescript',
          passed: true,
          duration: 1000,
          errors: [],
          warnings: [],
          details: {},
        },
        {
          checkType: 'lint',
          passed: true,
          duration: 500,
          errors: [],
          warnings: [],
          details: {},
        },
      ];

      const plan = createVerificationPlan(['frontend'], ['ui/App.tsx']);
      const confidence = calculateConfidence(plan, mockResults);

      expect(confidence).toBeGreaterThan(0.4);
      expect(confidence).toBeLessThanOrEqual(1);
    });

    it('should reduce confidence when optional tests fail', () => {
      const mockResults: CheckResult[] = [
        {
          checkType: 'typescript',
          passed: true,
          duration: 1000,
          errors: [],
          warnings: [],
          details: {},
        },
        {
          checkType: 'console-errors',
          passed: false,
          duration: 500,
          errors: ['Console error found'],
          warnings: [],
          details: {},
        },
      ];

      const plan = createVerificationPlan(['frontend'], ['ui/App.tsx']);
      const confidence = calculateConfidence(plan, mockResults);

      expect(confidence).toBeGreaterThan(0);
      expect(confidence).toBeLessThan(1);
    });

    it('should reduce confidence more when critical tests fail', () => {
      const mockResults: CheckResult[] = [
        {
          checkType: 'typescript',
          passed: false,
          duration: 1000,
          errors: ['TypeScript error'],
          warnings: [],
          details: {},
        },
      ];

      const plan = createVerificationPlan(['frontend'], ['ui/App.tsx']);
      const confidence = calculateConfidence(plan, mockResults);

      expect(confidence).toBeLessThan(0.5);
    });
  });

  describe('createVerificationResult', () => {
    it('should create passed result when all checks pass', () => {
      const mockResults: CheckResult[] = [
        {
          checkType: 'typescript',
          passed: true,
          duration: 1000,
          errors: [],
          warnings: [],
          details: {},
        },
      ];

      const plan = createVerificationPlan(['frontend'], ['ui/App.tsx']);
      const result = createVerificationResult(plan, mockResults);

      expect(result.status).toBe('passed');
      expect(result.failedChecks.length).toBe(0);
    });

    it('should create failed result when critical check fails', () => {
      const mockResults: CheckResult[] = [
        {
          checkType: 'typescript',
          passed: false,
          duration: 1000,
          errors: ['Error'],
          warnings: [],
          details: {},
        },
      ];

      const plan = createVerificationPlan(['frontend'], ['ui/App.tsx']);
      const result = createVerificationResult(plan, mockResults);

      expect(result.status).toBe('failed');
      expect(result.failedChecks.length).toBe(1);
    });

    it('should create partial result when optional check fails', () => {
      const mockResults: CheckResult[] = [
        {
          checkType: 'typescript',
          passed: true,
          duration: 1000,
          errors: [],
          warnings: [],
          details: {},
        },
        {
          checkType: 'console-errors',
          passed: false,
          duration: 500,
          errors: ['Error'],
          warnings: [],
          details: {},
        },
      ];

      const plan = createVerificationPlan(['frontend'], ['ui/App.tsx']);
      const result = createVerificationResult(plan, mockResults);

      expect(result.status).toBe('partial');
    });
  });

  describe('createRepairTask', () => {
    it('should create repair task for failed verification', () => {
      const mockResults: CheckResult[] = [
        {
          checkType: 'typescript',
          passed: false,
          duration: 1000,
          errors: ['TS error'],
          warnings: [],
          details: {},
        },
      ];

      const plan = createVerificationPlan(['frontend'], ['ui/App.tsx']);
      const result = createVerificationResult(plan, mockResults);
      const task = createRepairTask(result);

      expect(task.taskId).toBeDefined();
      expect(task.failedChecks.length).toBeGreaterThan(0);
      expect(task.suggestedActions.length).toBeGreaterThan(0);
    });

    it('should set critical priority for failed critical checks', () => {
      const mockResults: CheckResult[] = [
        {
          checkType: 'typescript',
          passed: false,
          duration: 1000,
          errors: ['Error'],
          warnings: [],
          details: {},
        },
      ];

      const plan = createVerificationPlan(['frontend'], ['ui/App.tsx']);
      const result = createVerificationResult(plan, mockResults);
      const task = createRepairTask(result);

      expect(task.priority).toBe('critical');
    });
  });

  describe('getSuggestedActions', () => {
    it('should suggest fix for TypeScript errors', () => {
      const mockResults: CheckResult[] = [
        {
          checkType: 'typescript',
          passed: false,
          duration: 1000,
          errors: ['Type error'],
          warnings: [],
          details: {},
        },
      ];

      const plan = createVerificationPlan(['frontend'], ['ui/App.tsx']);
      const result = createVerificationResult(plan, mockResults);
      const actions = getSuggestedActions(result);

      expect(actions.some((a) => a.includes('TypeScript'))).toBe(true);
    });

    it('should suggest lint fix command', () => {
      const mockResults: CheckResult[] = [
        {
          checkType: 'lint',
          passed: false,
          duration: 500,
          errors: ['Lint error'],
          warnings: [],
          details: {},
        },
      ];

      const plan = createVerificationPlan(['frontend'], ['ui/App.tsx']);
      const result = createVerificationResult(plan, mockResults);
      const actions = getSuggestedActions(result);

      expect(actions.some((a) => a.includes('lint:fix'))).toBe(true);
    });

    it('should suggest security review', () => {
      const mockResults: CheckResult[] = [
        {
          checkType: 'security',
          passed: false,
          duration: 3000,
          errors: ['Security issue'],
          warnings: [],
          details: {},
        },
      ];

      const plan = createVerificationPlan(['backend'], ['src/auth.ts']);
      const result = createVerificationResult(plan, mockResults);
      const actions = getSuggestedActions(result);

      expect(actions.some((a) => a.includes('security'))).toBe(true);
    });
  });

  describe('estimateChecksDuration', () => {
    it('should estimate single check duration', () => {
      const duration = estimateChecksDuration(['typescript']);

      expect(duration).toBeGreaterThan(0);
      expect(duration).toBeLessThan(10000);
    });

    it('should estimate multiple check duration', () => {
      const single = estimateChecksDuration(['typescript']);
      const multiple = estimateChecksDuration(['typescript', 'lint', 'build']);

      expect(multiple).toBeGreaterThan(single);
    });

    it('should estimate high-duration checks correctly', () => {
      const duration = estimateChecksDuration(['unit-tests', 'integration-tests']);

      expect(duration).toBeGreaterThan(20000);
    });
  });

  describe('Utility functions', () => {
    it('should generate unique request IDs', () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^verify-/);
    });

    it('should generate unique task IDs', () => {
      const id1 = generateTaskId();
      const id2 = generateTaskId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^repair-/);
    });

    it('should determine stop on failure correctly', () => {
      const plan = createVerificationPlan(['frontend'], ['ui/App.tsx']);
      const criticalCheck: CheckResult = {
        checkType: 'typescript',
        passed: false,
        duration: 1000,
        errors: ['Error'],
        warnings: [],
        details: {},
      };

      const shouldStop = shouldStopVerification(plan, criticalCheck);

      expect(shouldStop).toBe(plan.breakOnFailure);
    });

    it('should generate verification summary', () => {
      const mockResults: CheckResult[] = [
        {
          checkType: 'typescript',
          passed: true,
          duration: 1000,
          errors: [],
          warnings: [],
          details: {},
        },
      ];

      const plan = createVerificationPlan(['frontend'], ['ui/App.tsx']);
      const result = createVerificationResult(plan, mockResults);
      const summary = getVerificationSummary(result);

      expect(summary).toContain('Verification Result');
      expect(summary).toContain('Status');
      expect(summary).toContain('Confidence');
    });
  });

  describe('Critical vs Optional checks', () => {
    it('should identify critical checks', () => {
      const plan = createVerificationPlan(['frontend'], ['ui/App.tsx']);
      const critical = getCriticalChecks(plan);

      expect(critical).toContain('typescript');
      expect(critical).toContain('build');
    });

    it('should identify optional checks', () => {
      const plan = createVerificationPlan(['frontend'], ['ui/App.tsx']);
      const optional = getOptionalChecks(plan);

      expect(optional.length).toBeGreaterThan(0);
      expect(optional).not.toContain('typescript');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle frontend verification workflow', () => {
      const plan = createVerificationPlan(['frontend'], ['ui/App.tsx']);

      expect(plan.plannedChecks.length).toBeGreaterThan(0);
      expect(plan.priority).toBe('medium');
      expect(plan.estimatedDuration).toBeGreaterThan(0);
    });

    it('should handle backend verification workflow', () => {
      const plan = createVerificationPlan(['backend'], ['src/api.ts']);

      expect(plan.plannedChecks.length).toBeGreaterThan(3);
      expect(plan.priority).toBe('high');
    });

    it('should handle multi-layer verification workflow', () => {
      const plan = createVerificationPlan(
        ['frontend', 'backend', 'data'],
        [
          'ui/App.tsx',
          'src/api.ts',
          'src/migrations/001_init.sql',
        ]
      );

      expect(plan.plannedChecks.length).toBeGreaterThan(8);
      expect(plan.affectedLayers.length).toBe(3);
    });
  });
});
