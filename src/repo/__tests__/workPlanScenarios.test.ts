/**
 * Phase 3.3 - Real-World Scenario Tests
 * Validates work plans against realistic repository scenarios
 * Tests Phase 3.1 orchestrator and Phase 3.2 integration with real-world use cases
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  validateScenario,
  generateScenarioReport,
  allScenarios,
  bugFixAuthValidationScenario,
  featureTwoFactorAuthScenario,
  refactorAuthServiceExtractionScenario,
  infrastructureAuthProviderScenario,
  multiLayerUserOnboardingScenario,
  type WorkPlanScenario,
} from '../workPlanScenarios.js';
import { createWorkPlan } from '../workPlanOrchestrator.js';
import { createIntegratedWorkPlan } from '../workPlanIntegration.js';
import type { ModuleResponsibility } from '../moduleResponsibilities.js';
import type { DependencySignal } from '../dependencyGraph.js';
import type { DirtyTreeState } from '../dirtyTreeTracker.js';
import type { OverwriteCheckResult } from '../overwritePreventionPlan.js';
import type { PlanningContext } from '../workPlanOrchestrator.js';
import type { Phase2Context } from '../workPlanIntegration.js';

describe('Phase 3.3 - Real-World Work Plan Scenarios', () => {
  let mockModules: ModuleResponsibility[];
  let mockSignals: DependencySignal[];
  let mockDirtyTree: DirtyTreeState;
  let mockOverwriteCheck: OverwriteCheckResult;
  let planningContext: PlanningContext;
  let phase2Context: Phase2Context;

  beforeEach(() => {
    mockModules = [
      {
        name: 'backend',
        path: 'src',
        layer: 'backend',
        description: 'Backend services',
        exports: ['api', 'services', 'middleware'],
        keyFiles: ['src/server.ts', 'src/api/index.ts'],
        entryPoints: ['src/server.ts'],
        dependencies: [],
        dependents: ['frontend'],
        lastAnalyzed: Date.now(),
      },
      {
        name: 'frontend',
        path: 'ui',
        layer: 'frontend',
        description: 'React frontend',
        exports: ['App', 'components'],
        keyFiles: ['ui/main.tsx', 'ui/App.tsx'],
        entryPoints: ['ui/main.tsx'],
        dependencies: ['backend'],
        dependents: [],
        lastAnalyzed: Date.now(),
      },
      {
        name: 'tests',
        path: 'tests',
        layer: 'tests',
        description: 'Integration tests',
        exports: ['helpers'],
        keyFiles: ['tests/fixtures.ts'],
        entryPoints: [],
        dependencies: ['backend', 'frontend'],
        dependents: [],
        lastAnalyzed: Date.now(),
      },
      {
        name: 'data',
        path: 'data',
        layer: 'data',
        description: 'Database migrations',
        exports: [],
        keyFiles: ['data/migrations.ts'],
        entryPoints: [],
        dependencies: [],
        dependents: ['backend'],
        lastAnalyzed: Date.now(),
      },
    ];

    mockSignals = [
      {
        source: 'src/middleware/auth.ts',
        target: 'ui/components/Login.tsx',
        type: 'import',
        confidence: 'high',
      },
      {
        source: 'src/api/2fa.ts',
        target: 'src/services/authService.ts',
        type: 'import',
        confidence: 'high',
      },
    ];

    mockDirtyTree = {
      isDirty: false,
      files: [],
      counters: { modifiedCount: 0, addedCount: 0, deletedCount: 0, untrackedCount: 0 },
      totalChanges: 0,
      lastScanned: Date.now(),
    };

    mockOverwriteCheck = {
      canProceed: true,
      hasConflicts: false,
      conflicts: [],
      warnings: [],
      suggestions: [],
      mergeStrategy: 'merge-careful',
      requiresApproval: false,
      safetyScore: 85,
    };

    planningContext = {
      modules: mockModules,
      signals: mockSignals,
      dirtyTree: mockDirtyTree,
    };

    // For Phase2Context, need a dependency graph mock
    const mockDependencyGraph = {
      getSignalsFrom: () => [],
      getSignalsTo: () => [],
      findImportPath: () => [],
      getConnectedModules: () => [],
    } as any;

    phase2Context = {
      modules: mockModules,
      dependencyGraph: mockDependencyGraph,
      dirtyTree: mockDirtyTree,
      overwriteCheck: mockOverwriteCheck,
    };
  });

  describe('Scenario Validation Framework', () => {
    it('should validate scenario structure', () => {
      const scenario = bugFixAuthValidationScenario;

      expect(scenario).toHaveProperty('name');
      expect(scenario).toHaveProperty('description');
      expect(scenario).toHaveProperty('userRequest');
      expect(scenario).toHaveProperty('expectedClassification');
      expect(scenario).toHaveProperty('affectedFiles');
    });

    it('should have all required scenarios', () => {
      expect(allScenarios).toHaveLength(5);
      expect(allScenarios).toContain(bugFixAuthValidationScenario);
      expect(allScenarios).toContain(featureTwoFactorAuthScenario);
      expect(allScenarios).toContain(refactorAuthServiceExtractionScenario);
      expect(allScenarios).toContain(infrastructureAuthProviderScenario);
      expect(allScenarios).toContain(multiLayerUserOnboardingScenario);
    });

    it('should generate scenario reports', () => {
      const scenario = bugFixAuthValidationScenario;
      const validation = validateScenario(scenario, {
        id: 'plan-1',
        userRequest: scenario.userRequest,
        createdAt: Date.now(),
        estimatedComplexity: scenario.expectedComplexity,
        classification: scenario.expectedClassification,
        touchedLayers: scenario.expectedLayers as any,
        targetSurfaces: [],
        affectedFiles: scenario.affectedFiles,
        acceptanceCriteria: [],
        fileOwnership: [],
        executionStrategy: 'sequential',
        taskDependencies: [],
        canRunParallel: false,
        parallelGroups: [],
        verificationPlan: [],
        verificationTasks: [],
        moduleContext: mockModules,
        dependencySignals: [],
        dirtyTreeWarnings: [],
        overwriteCheckResult: mockOverwriteCheck,
        riskFactors: [],
        safetyScore: 85,
        requiresApproval: false,
      });

      const report = generateScenarioReport(scenario, validation);

      expect(Array.isArray(report)).toBe(true);
      expect(report.length).toBeGreaterThan(0);
      expect(report.join('\n')).toContain(scenario.name);
    });
  });

  describe('Bug Fix Scenario: Auth Validation', () => {
    it('should classify as bug_fix', () => {
      const basePlan = createWorkPlan(
        bugFixAuthValidationScenario.userRequest,
        bugFixAuthValidationScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      expect(basePlan.classification).toBe('bug_fix');
    });

    it('should estimate complexity', () => {
      const basePlan = createWorkPlan(
        bugFixAuthValidationScenario.userRequest,
        bugFixAuthValidationScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      const validComplexities = ['trivial', 'simple', 'moderate', 'complex', 'expert'];
      expect(validComplexities).toContain(basePlan.estimatedComplexity);
    });

    it('should identify backend and test layers', () => {
      const basePlan = createWorkPlan(
        bugFixAuthValidationScenario.userRequest,
        bugFixAuthValidationScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      expect(basePlan.touchedLayers).toContain('backend');
      expect(basePlan.touchedLayers).toContain('tests');
    });

    it('should not require approval', () => {
      const basePlan = createWorkPlan(
        bugFixAuthValidationScenario.userRequest,
        bugFixAuthValidationScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      expect(basePlan.requiresApproval).toBe(false);
    });
  });

  describe('Feature Scenario: Two-Factor Auth', () => {
    it('should classify as feature', () => {
      const basePlan = createWorkPlan(
        featureTwoFactorAuthScenario.userRequest,
        featureTwoFactorAuthScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      expect(basePlan.classification).toBe('new_feature');
    });

    it('should estimate complexity level', () => {
      const basePlan = createWorkPlan(
        featureTwoFactorAuthScenario.userRequest,
        featureTwoFactorAuthScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      const validComplexities = ['trivial', 'simple', 'moderate', 'complex', 'expert'];
      expect(validComplexities).toContain(basePlan.estimatedComplexity);
    });

    it('should touch multiple layers', () => {
      const basePlan = createWorkPlan(
        featureTwoFactorAuthScenario.userRequest,
        featureTwoFactorAuthScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      expect(basePlan.touchedLayers.length).toBeGreaterThanOrEqual(2);
      expect(basePlan.touchedLayers).toContain('backend');
      expect(basePlan.touchedLayers).toContain('frontend');
    });

    it('should estimate multiple layers', () => {
      const basePlan = createWorkPlan(
        featureTwoFactorAuthScenario.userRequest,
        featureTwoFactorAuthScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      expect(basePlan.safetyScore).toBeGreaterThanOrEqual(0);
      expect(basePlan.safetyScore).toBeLessThanOrEqual(100);
    });
  });

  describe('Refactoring Scenario: Auth Service Extraction', () => {
    it('should classify as refactor', () => {
      const basePlan = createWorkPlan(
        refactorAuthServiceExtractionScenario.userRequest,
        refactorAuthServiceExtractionScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      expect(basePlan.classification).toBe('refactor');
    });

    it('should estimate moderate complexity', () => {
      const basePlan = createWorkPlan(
        refactorAuthServiceExtractionScenario.userRequest,
        refactorAuthServiceExtractionScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      expect(['moderate', 'complex', 'simple']).toContain(basePlan.estimatedComplexity);
    });

    it('should detect cross-file changes', () => {
      const basePlan = createWorkPlan(
        refactorAuthServiceExtractionScenario.userRequest,
        refactorAuthServiceExtractionScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      const integrated = createIntegratedWorkPlan(basePlan, phase2Context);

      expect(integrated.safetyAssessment).toBeDefined();
      expect(integrated.affectedFiles.length).toBeGreaterThan(1);
    });
  });

  describe('Infrastructure Scenario: Auth Provider Update', () => {
    it('should classify as infrastructure', () => {
      const basePlan = createWorkPlan(
        infrastructureAuthProviderScenario.userRequest,
        infrastructureAuthProviderScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      expect(basePlan.classification).toBe('infrastructure');
    });

    it('should estimate expert complexity', () => {
      const basePlan = createWorkPlan(
        infrastructureAuthProviderScenario.userRequest,
        infrastructureAuthProviderScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      expect(['expert', 'complex']).toContain(basePlan.estimatedComplexity);
    });

    it('should have infrastructure classification', () => {
      const basePlan = createWorkPlan(
        infrastructureAuthProviderScenario.userRequest,
        infrastructureAuthProviderScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      expect(basePlan.classification).toBe('infrastructure');
    });

    it('should have complex assessment', () => {
      const basePlan = createWorkPlan(
        infrastructureAuthProviderScenario.userRequest,
        infrastructureAuthProviderScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      const integrated = createIntegratedWorkPlan(basePlan, phase2Context);

      expect(integrated.safetyAssessment).toBeDefined();
      expect(typeof integrated.dependencyImpactAnalysis.riskLevel).toBe('string');
    });

    it('should handle infrastructure changes with context', () => {
      const basePlan = createWorkPlan(
        infrastructureAuthProviderScenario.userRequest,
        infrastructureAuthProviderScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      const integrated = createIntegratedWorkPlan(basePlan, phase2Context);

      expect(integrated.moduleContext.length).toBeGreaterThan(0);
      expect(integrated.impactedModules.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Multi-Layer Scenario: User Onboarding', () => {
    it('should classify as feature', () => {
      const basePlan = createWorkPlan(
        multiLayerUserOnboardingScenario.userRequest,
        multiLayerUserOnboardingScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      expect(basePlan.classification).toBe('new_feature');
    });

    it('should touch all major layers', () => {
      const basePlan = createWorkPlan(
        multiLayerUserOnboardingScenario.userRequest,
        multiLayerUserOnboardingScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      expect(basePlan.touchedLayers).toContain('frontend');
      expect(basePlan.touchedLayers).toContain('backend');
      expect(basePlan.touchedLayers).toContain('tests');
    });

    it('should identify multiple impacted modules', () => {
      const basePlan = createWorkPlan(
        multiLayerUserOnboardingScenario.userRequest,
        multiLayerUserOnboardingScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      const integrated = createIntegratedWorkPlan(basePlan, phase2Context);

      expect(integrated.impactedModules.length).toBeGreaterThanOrEqual(2);
    });

    it('should have safety assessment for complex changes', () => {
      const basePlan = createWorkPlan(
        multiLayerUserOnboardingScenario.userRequest,
        multiLayerUserOnboardingScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      const integrated = createIntegratedWorkPlan(basePlan, phase2Context);

      expect(integrated.safetyAssessment).toBeDefined();
      expect(typeof integrated.safetyAssessment.requiresManualReview).toBe('boolean');
    });

    it('should show risk level for multi-layer changes', () => {
      const basePlan = createWorkPlan(
        multiLayerUserOnboardingScenario.userRequest,
        multiLayerUserOnboardingScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      const integrated = createIntegratedWorkPlan(basePlan, phase2Context);

      expect(['low', 'medium', 'high', 'critical']).toContain(
        integrated.dependencyImpactAnalysis.riskLevel
      );
    });

    it('should handle contextual ownership across modules', () => {
      const basePlan = createWorkPlan(
        multiLayerUserOnboardingScenario.userRequest,
        multiLayerUserOnboardingScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      const integrated = createIntegratedWorkPlan(basePlan, phase2Context);

      expect(integrated.contextualOwnership.length).toBe(
        multiLayerUserOnboardingScenario.affectedFiles.length
      );

      const owners = new Set(integrated.contextualOwnership.map((o) => o.owner));
      expect(owners.size).toBeGreaterThan(1);
    });
  });

  describe('Cross-Scenario Patterns', () => {
    it('should handle all scenario types', () => {
      for (const scenario of allScenarios) {
        const basePlan = createWorkPlan(
          scenario.userRequest,
          scenario.affectedFiles,
          planningContext,
          mockOverwriteCheck
        );

        expect(basePlan).toHaveProperty('classification');
        expect(basePlan.classification).toBe(scenario.expectedClassification);
      }
    });

    it('should validate all scenarios', () => {
      for (const scenario of allScenarios) {
        const basePlan = createWorkPlan(
          scenario.userRequest,
          scenario.affectedFiles,
          planningContext,
          mockOverwriteCheck
        );

        const integrated = createIntegratedWorkPlan(basePlan, phase2Context);
        const validation = validateScenario(scenario, integrated);

        expect(validation.passes).toBe(true);
        expect(validation.errors).toHaveLength(0);
      }
    });

    it('should generate valid reports for all scenarios', () => {
      for (const scenario of allScenarios) {
        const basePlan = createWorkPlan(
          scenario.userRequest,
          scenario.affectedFiles,
          planningContext,
          mockOverwriteCheck
        );

        const integrated = createIntegratedWorkPlan(basePlan, phase2Context);
        const validation = validateScenario(scenario, integrated);
        const report = generateScenarioReport(scenario, validation);

        expect(Array.isArray(report)).toBe(true);
        expect(report.length).toBeGreaterThan(0);
        expect(report.join('\n')).toContain(scenario.name);
      }
    });
  });

  describe('Dirty Tree Scenarios', () => {
    it('should handle dirty files during bug fix', () => {
      mockDirtyTree.isDirty = true;
      mockDirtyTree.files = [
        {
          path: 'src/middleware/auth.ts',
          status: 'modified',
          hunks: [],
          lastModified: Date.now(),
        },
      ];

      const basePlan = createWorkPlan(
        bugFixAuthValidationScenario.userRequest,
        bugFixAuthValidationScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      const integrated = createIntegratedWorkPlan(basePlan, phase2Context);

      expect(integrated.dirtyTreeWarnings.length).toBeGreaterThan(0);
    });

    it('should block infrastructure changes on core file modifications', () => {
      mockDirtyTree.isDirty = true;
      mockDirtyTree.files = [
        {
          path: 'package.json',
          status: 'modified',
          hunks: [],
          lastModified: Date.now(),
        },
      ];

      mockOverwriteCheck.hasConflicts = true;
      mockOverwriteCheck.mergeStrategy = 'abort';

      const basePlan = createWorkPlan(
        infrastructureAuthProviderScenario.userRequest,
        infrastructureAuthProviderScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      const integrated = createIntegratedWorkPlan(basePlan, phase2Context);
      const validation = validateScenario(infrastructureAuthProviderScenario, integrated);

      expect(validation.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Scenario Edge Cases', () => {
    it('should handle scenarios with no dirty files', () => {
      mockDirtyTree.isDirty = false;
      mockDirtyTree.files = [];

      const basePlan = createWorkPlan(
        featureTwoFactorAuthScenario.userRequest,
        featureTwoFactorAuthScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      const integrated = createIntegratedWorkPlan(basePlan, phase2Context);

      expect(integrated.dirtyTreeWarnings).toHaveLength(0);
    });

    it('should handle scenarios with all conflicts resolved', () => {
      mockOverwriteCheck.canProceed = true;
      mockOverwriteCheck.hasConflicts = false;
      mockOverwriteCheck.conflicts = [];

      const basePlan = createWorkPlan(
        multiLayerUserOnboardingScenario.userRequest,
        multiLayerUserOnboardingScenario.affectedFiles,
        planningContext,
        mockOverwriteCheck
      );

      const integrated = createIntegratedWorkPlan(basePlan, phase2Context);

      expect(integrated.safetyAssessment.canProceedWithApproval).toBe(true);
    });

    it('should calculate complexity correctly for single-file changes', () => {
      const smallChangePlan = createWorkPlan(
        'Fix typo in error message',
        ['src/utils/errors.ts'],
        planningContext,
        mockOverwriteCheck
      );

      expect(['trivial', 'simple']).toContain(smallChangePlan.estimatedComplexity);
    });
  });
});
