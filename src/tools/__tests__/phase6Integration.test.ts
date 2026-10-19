/**
 * Phase 6: Integration Tests
 * End-to-end verification workflows combining all Phase 6 components
 */

import {
  createVerificationPlan,
  createVerificationResult,
  createRepairTask,
  type CheckResult,
  type VerificationResult,
} from '../verificationPlanner';

import {
  runFrontendChecks,
} from '../verificationChecks/frontendChecks';

import {
  runBackendChecks,
} from '../verificationChecks/backendChecks';

import {
  runDataChecks,
  runTestChecks,
  runDocsChecks,
} from '../verificationChecks/dataTestDocsChecks';

import {
  storeVerificationResult,
  getVerificationHistory,
  getFailedVerifications,
  clearVerificationHistory,
  type StoredVerification,
} from '../verificationResultStorage';

describe('Phase 6: Integration Tests', () => {
  beforeEach(() => {
    clearVerificationHistory();
  });

  describe('Scenario: Frontend verification workflow', () => {
    it('should verify frontend changes end-to-end', () => {
      // Step 1: Create verification plan
      const plan = createVerificationPlan(['frontend'], [
        'ui/components/Button.tsx',
        'ui/pages/Home.tsx',
      ]);

      expect(plan.affectedLayers).toContain('frontend');
      expect(plan.plannedChecks.length).toBeGreaterThan(0);

      // Step 2: Run checks
      const checkResults = runFrontendChecks({
        checkTypeScript: true,
        checkLint: true,
        checkBuild: true,
        checkConsoleErrors: true,
      });

      expect(checkResults.length).toBeGreaterThan(0);

      // Step 3: Create verification result
      const result = createVerificationResult(plan, checkResults);

      expect(result.status).toBe('passed');
      expect(result.failedChecks.length).toBe(0);

      // Step 4: Store result
      const stored: StoredVerification = {
        id: 'verify-frontend-1',
        workPlanId: 'plan-frontend-1',
        result,
        layers: ['frontend'],
        changedFiles: ['ui/components/Button.tsx', 'ui/pages/Home.tsx'],
        timestamp: new Date(),
      };

      storeVerificationResult(stored);

      // Step 5: Verify storage
      const history = getVerificationHistory();
      expect(history.passedCount).toBe(1);
      expect(history.failedCount).toBe(0);
    });
  });

  describe('Scenario: Backend verification workflow with security checks', () => {
    it('should verify backend changes with security', () => {
      // Step 1: Create plan for auth changes
      const plan = createVerificationPlan(['backend'], [
        'src/auth/strategies.ts',
        'src/auth/utils.ts',
      ]);

      expect(plan.plannedChecks).toContain('security');
      expect(plan.criticalChecks).toContain('security');
      expect(plan.priority).toBe('critical');

      // Step 2: Run backend checks
      const checkResults = runBackendChecks({
        checkTypeScript: true,
        checkValidation: true,
        checkSecurity: true,
      });

      expect(checkResults.some((c) => c.checkType === 'security')).toBe(true);

      // Step 3: Create verification result
      const result = createVerificationResult(plan, checkResults);

      expect(result.status).toBe('passed');

      // Step 4: Store result
      const stored: StoredVerification = {
        id: 'verify-backend-1',
        workPlanId: 'plan-backend-1',
        result,
        layers: ['backend'],
        changedFiles: ['src/auth/strategies.ts', 'src/auth/utils.ts'],
        timestamp: new Date(),
        executorAgent: 'BackendAgent',
      };

      storeVerificationResult(stored);

      const history = getVerificationHistory();
      expect(history.passedCount).toBe(1);
    });
  });

  describe('Scenario: Data layer verification', () => {
    it('should verify data changes with schema and persistence', () => {
      const plan = createVerificationPlan(['data'], [
        'src/migrations/001_init.sql',
      ]);

      expect(plan.plannedChecks).toContain('schema');
      expect(plan.plannedChecks).toContain('persistence');

      const checkResults = runDataChecks();

      const result = createVerificationResult(plan, checkResults);

      expect(result.status).toBe('passed');

      const stored: StoredVerification = {
        id: 'verify-data-1',
        workPlanId: 'plan-data-1',
        result,
        layers: ['data'],
        changedFiles: ['src/migrations/001_init.sql'],
        timestamp: new Date(),
      };

      storeVerificationResult(stored);

      const history = getVerificationHistory();
      expect(history.passedCount).toBe(1);
    });
  });

  describe('Scenario: Multi-layer verification workflow', () => {
    it('should handle verification across multiple layers', () => {
      // Create plans for each layer
      const frontendPlan = createVerificationPlan(['frontend'], ['ui/App.tsx']);
      const backendPlan = createVerificationPlan(['backend'], ['src/api.ts']);
      const dataPlan = createVerificationPlan(['data'], ['src/migrations']);

      expect(frontendPlan.affectedLayers.length).toBe(1);
      expect(backendPlan.affectedLayers.length).toBe(1);
      expect(dataPlan.affectedLayers.length).toBe(1);

      // Run all checks
      const frontendChecks = runFrontendChecks();
      const backendChecks = runBackendChecks();
      const dataChecks = runDataChecks();

      // Create results
      const frontendResult = createVerificationResult(frontendPlan, frontendChecks);
      const backendResult = createVerificationResult(backendPlan, backendChecks);
      const dataResult = createVerificationResult(dataPlan, dataChecks);

      // Store all results
      storeVerificationResult({
        id: 'verify-fe',
        workPlanId: 'plan-multi',
        result: frontendResult,
        layers: ['frontend'],
        changedFiles: ['ui/App.tsx'],
        timestamp: new Date(),
      });

      storeVerificationResult({
        id: 'verify-be',
        workPlanId: 'plan-multi',
        result: backendResult,
        layers: ['backend'],
        changedFiles: ['src/api.ts'],
        timestamp: new Date(),
      });

      storeVerificationResult({
        id: 'verify-data',
        workPlanId: 'plan-multi',
        result: dataResult,
        layers: ['data'],
        changedFiles: ['src/migrations'],
        timestamp: new Date(),
      });

      const history = getVerificationHistory();
      expect(history.totalVerifications).toBe(3);
      expect(history.passedCount).toBe(3);
    });
  });

  describe('Scenario: Verification with failure and repair', () => {
    it('should handle failed verification and create repair task', () => {
      const plan = createVerificationPlan(['frontend'], ['ui/App.tsx']);

      // Simulate failed check
      const failedCheck: CheckResult = {
        checkType: 'typescript',
        passed: false,
        duration: 1000,
        errors: ['Type mismatch in Button component'],
        warnings: [],
        details: { layer: 'frontend' },
      };

      const result = createVerificationResult(plan, [failedCheck]);

      expect(result.status).toBe('failed');
      expect(result.failedChecks.length).toBe(1);

      // Create repair task
      const repairTask = createRepairTask(result);

      expect(repairTask.failedChecks.length).toBe(1);
      expect(repairTask.suggestedActions.length).toBeGreaterThan(0);
      expect(repairTask.priority).toBe('critical');

      // Store result with repair task reference
      const stored: StoredVerification = {
        id: 'verify-failed',
        workPlanId: 'plan-failed',
        result,
        layers: ['frontend'],
        changedFiles: ['ui/App.tsx'],
        timestamp: new Date(),
        repairTasks: [repairTask],
      };

      storeVerificationResult(stored);

      const failed = getFailedVerifications();
      expect(failed.length).toBe(1);
      expect(failed[0].repairTasks?.length).toBe(1);
    });
  });

  describe('Scenario: Documentation verification', () => {
    it('should verify documentation changes', () => {
      const plan = createVerificationPlan(['docs'], [
        'docs/API.md',
        'docs/GUIDE.md',
      ]);

      expect(plan.plannedChecks).toContain('links');
      expect(plan.plannedChecks).toContain('examples');
      expect(plan.plannedChecks).toContain('references');

      const checkResults = runDocsChecks();

      const result = createVerificationResult(plan, checkResults);

      expect(result.status).toBe('passed');

      const stored: StoredVerification = {
        id: 'verify-docs',
        workPlanId: 'plan-docs',
        result,
        layers: ['docs'],
        changedFiles: ['docs/API.md', 'docs/GUIDE.md'],
        timestamp: new Date(),
      };

      storeVerificationResult(stored);

      const history = getVerificationHistory();
      expect(history.passedCount).toBeGreaterThan(0);
    });
  });

  describe('Scenario: Test-focused verification', () => {
    it('should run focused tests for small changes', () => {
      const plan = createVerificationPlan(['tests'], ['src/__tests__/api.test.ts']);

      const checkResults = runTestChecks({ focusedOnly: true });

      const result = createVerificationResult(plan, checkResults);

      expect(result.status).toBe('passed');
      expect(result.confidence).toBeGreaterThan(0.7);

      const stored: StoredVerification = {
        id: 'verify-tests',
        workPlanId: 'plan-tests',
        result,
        layers: ['tests'],
        changedFiles: ['src/__tests__/api.test.ts'],
        timestamp: new Date(),
      };

      storeVerificationResult(stored);

      const history = getVerificationHistory();
      expect(history.passedCount).toBe(1);
    });
  });

  describe('Scenario: Comprehensive full-stack verification', () => {
    it('should execute complete verification for full-stack changes', () => {
      // Multi-layer changes
      const layers = ['frontend', 'backend', 'data', 'tests'];
      const files = [
        'ui/components/Button.tsx',
        'src/api.ts',
        'src/migrations',
        'src/__tests__/api.test.ts',
      ];

      // Create comprehensive plan
      const plan = createVerificationPlan(layers, files);

      expect(plan.affectedLayers).toContain('frontend');
      expect(plan.affectedLayers).toContain('backend');
      expect(plan.affectedLayers).toContain('data');
      expect(plan.affectedLayers).toContain('tests');
      expect(plan.plannedChecks.length).toBeGreaterThanOrEqual(9);

      // Run all checks
      const frontendChecks = runFrontendChecks();
      const backendChecks = runBackendChecks();
      const dataChecks = runDataChecks();
      const testChecks = runTestChecks();

      const allChecks = [
        ...frontendChecks,
        ...backendChecks,
        ...dataChecks,
        ...testChecks,
      ];

      // Create result
      const result = createVerificationResult(plan, allChecks);

      expect(result.status).toBe('passed');
      expect(result.confidence).toBeGreaterThan(0.8);

      // Store result
      const stored: StoredVerification = {
        id: 'verify-fullstack',
        workPlanId: 'plan-fullstack',
        result,
        layers,
        changedFiles: files,
        timestamp: new Date(),
        notes: 'Full-stack verification completed successfully',
      };

      storeVerificationResult(stored);

      const history = getVerificationHistory();
      expect(history.totalVerifications).toBe(1);
      expect(history.passedCount).toBe(1);
      expect(history.avgConfidence).toBeGreaterThan(0.8);
    });
  });

  describe('Scenario: Partial verification with warnings', () => {
    it('should handle partial verification status', () => {
      const plan = createVerificationPlan(['frontend'], ['ui/App.tsx']);

      // Mix of passed and failed (non-critical) checks
      const checks: CheckResult[] = [
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
          errors: ['Deprecation warning found'],
          warnings: [],
          details: {},
        },
      ];

      const result = createVerificationResult(plan, checks);

      expect(result.status).toBe('partial');
      expect(result.failedChecks.length).toBe(1);
      expect(result.confidence).toBeGreaterThan(0.3);
      expect(result.confidence).toBeLessThan(0.6);

      const stored: StoredVerification = {
        id: 'verify-partial',
        workPlanId: 'plan-partial',
        result,
        layers: ['frontend'],
        changedFiles: ['ui/App.tsx'],
        timestamp: new Date(),
        notes: 'Warnings found but critical checks passed',
      };

      storeVerificationResult(stored);

      const history = getVerificationHistory();
      expect(history.partialCount).toBe(1);
    });
  });

  describe('Scenario: Verification history and reporting', () => {
    it('should track multiple verifications and generate reports', () => {
      // Create 5 verifications with different statuses
      for (let i = 0; i < 5; i++) {
        const plan = createVerificationPlan(['frontend'], ['ui/App.tsx']);
        const checkResults = runFrontendChecks();
        const result = createVerificationResult(plan, checkResults);

        storeVerificationResult({
          id: `verify-${i}`,
          workPlanId: `plan-${i}`,
          result,
          layers: ['frontend'],
          changedFiles: ['ui/App.tsx'],
          timestamp: new Date(),
        });
      }

      const history = getVerificationHistory();

      expect(history.totalVerifications).toBe(5);
      expect(history.passedCount).toBe(5);
      expect(history.failedCount).toBe(0);
      expect(history.avgConfidence).toBe(1);
    });
  });
});
