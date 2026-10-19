/**
 * Phase 3.2 - Work Plan Integration Tests
 * Tests for combining Phase 2 context with Phase 3 work planning
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  assignContextualOwnership,
  analyzeDependencyImpact,
  identifyAffectedModules,
  createDirtyTreeWarnings,
  createIntegratedWorkPlan,
  validateIntegratedWorkPlan,
  summarizeIntegratedWorkPlan,
  type IntegratedWorkPlan,
  type Phase2Context,
} from '../workPlanIntegration.js';
import type { ModuleResponsibility } from '../moduleResponsibilities.js';
import type { DependencySignal, DependencyGraphQuery } from '../dependencyGraph.js';
import type { DirtyTreeState } from '../dirtyTreeTracker.js';
import type { OverwriteCheckResult } from '../overwritePreventionPlan.js';
import type { FullStackWorkPlan } from '../workPlanOrchestrator.js';

describe('Phase 3.2 - Work Plan Integration', () => {
  let mockModules: ModuleResponsibility[];
  let mockDependencyGraph: DependencyGraphQuery;
  let mockDirtyTree: DirtyTreeState;
  let mockOverwriteCheck: OverwriteCheckResult;
  let mockBasePlan: FullStackWorkPlan;
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
        dependents: ['ui'],
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
    ];

    mockDependencyGraph = {
      getSignalsFrom: (source: string) => {
        if (source === 'src/api/index.ts') {
          return [
            {
              source: 'src/api/index.ts',
              target: 'ui/App.tsx',
              type: 'import',
              confidence: 'high',
            } as DependencySignal,
          ];
        }
        return [];
      },
      getSignalsTo: (target: string) => {
        if (target === 'src/api/index.ts') {
          return [
            {
              source: 'ui/App.tsx',
              target: 'src/api/index.ts',
              type: 'import',
              confidence: 'high',
            } as DependencySignal,
          ];
        }
        return [];
      },
      findImportPath: () => [],
      getConnectedModules: () => [],
    } as DependencyGraphQuery;

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

    mockBasePlan = {
      id: 'plan-1',
      userRequest: 'Add authentication to API',
      createdAt: Date.now(),
      estimatedComplexity: 'moderate',
      classification: 'feature',
      touchedLayers: ['backend', 'frontend', 'tests'],
      targetSurfaces: ['api.ts', 'App.tsx'],
      affectedFiles: ['src/api/auth.ts', 'src/middleware/auth.ts', 'ui/components/Login.tsx'],
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
    };

    phase2Context = {
      modules: mockModules,
      dependencyGraph: mockDependencyGraph,
      dirtyTree: mockDirtyTree,
      overwriteCheck: mockOverwriteCheck,
    };
  });

  describe('Contextual Ownership Assignment', () => {
    it('should assign ownership based on module boundaries', () => {
      const files = ['src/api/auth.ts', 'ui/components/Login.tsx'];
      const ownership = assignContextualOwnership(files, mockModules);

      expect(ownership).toHaveLength(2);
      expect(ownership[0]).toMatchObject({
        file: 'src/api/auth.ts',
        owner: 'backend',
        reason: 'module-boundary',
        confidence: 'high',
        relatedModule: 'backend',
      });
      expect(ownership[1]).toMatchObject({
        file: 'ui/components/Login.tsx',
        owner: 'frontend',
        reason: 'module-boundary',
        confidence: 'high',
        relatedModule: 'frontend',
      });
    });

    it('should fallback to path patterns when module not found', () => {
      const files = ['data/seeds.ts'];
      const ownership = assignContextualOwnership(files, mockModules);

      expect(ownership).toHaveLength(1);
      expect(ownership[0]).toMatchObject({
        file: 'data/seeds.ts',
        owner: 'data',
        reason: 'path-pattern',
        confidence: 'medium',
      });
    });

    it('should use default backend owner for unrecognized paths', () => {
      const files = ['config/unknown.ts'];
      const ownership = assignContextualOwnership(files, mockModules);

      expect(ownership[0]).toMatchObject({
        file: 'config/unknown.ts',
        owner: 'backend',
        reason: 'path-pattern',
      });
    });
  });

  describe('Dependency Impact Analysis', () => {
    it('should identify low-risk isolated changes', () => {
      const impact = analyzeDependencyImpact(['src/utils/helpers.ts'], mockDependencyGraph);

      expect(impact.riskLevel).toBe('low');
      expect(impact.directlyAffected).toContain('src/utils/helpers.ts');
      expect(impact.transitivelyAffected).toHaveLength(0);
      expect(impact.reason).toContain('isolated');
    });

    it('should identify medium-risk with few dependents', () => {
      const impact = analyzeDependencyImpact(['src/api/index.ts'], mockDependencyGraph);

      expect(['low', 'medium']).toContain(impact.riskLevel);
      expect(impact.directlyAffected).toContain('src/api/index.ts');
    });

    it('should include transitively affected files', () => {
      const impact = analyzeDependencyImpact(['src/api/index.ts'], mockDependencyGraph);

      expect(impact).toHaveProperty('transitivelyAffected');
      expect(Array.isArray(impact.transitivelyAffected)).toBe(true);
    });

    it('should assess critical risk for many dependents', () => {
      const manyDependents: DependencySignal[] = Array.from({ length: 15 }, (_, i) => ({
        source: `file-${i}.ts`,
        target: 'core-api.ts',
        type: 'import',
        confidence: 'high',
      }));

      mockDependencyGraph.getSignalsTo = () => manyDependents;
      const impact = analyzeDependencyImpact(['core-api.ts'], mockDependencyGraph);

      expect(impact.riskLevel).toBe('critical');
    });
  });

  describe('Affected Module Identification', () => {
    it('should identify directly affected modules', () => {
      const affected = identifyAffectedModules(['src/api/auth.ts'], mockModules);

      expect(affected).toHaveLength(1);
      expect(affected[0]).toMatchObject({
        module: mockModules[0],
        impactType: 'direct',
      });
    });

    it('should handle multiple modules', () => {
      const affected = identifyAffectedModules(
        ['src/api/auth.ts', 'ui/components/Login.tsx'],
        mockModules
      );

      expect(affected).toHaveLength(2);
      expect(affected.map((a) => a.module.name)).toContain('backend');
      expect(affected.map((a) => a.module.name)).toContain('frontend');
    });

    it('should avoid duplicates', () => {
      const affected = identifyAffectedModules(
        ['src/api/auth.ts', 'src/middleware/auth.ts'],
        mockModules
      );

      expect(affected).toHaveLength(1);
      expect(affected[0].module.name).toBe('backend');
    });
  });

  describe('Dirty Tree Warnings', () => {
    it('should create no warnings for clean tree', () => {
      const warnings = createDirtyTreeWarnings(['src/api/auth.ts'], mockDirtyTree);

      expect(warnings).toHaveLength(0);
    });

    it('should create critical warning for core file conflicts', () => {
      mockDirtyTree.files = [
        {
          path: 'package.json',
          status: 'modified',
          hunks: [],
          lastModified: Date.now(),
        },
      ];

      const warnings = createDirtyTreeWarnings(['package.json'], mockDirtyTree);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        file: 'package.json',
        conflictSeverity: 'critical',
      });
      expect(warnings[0].suggestion).toContain('BLOCKING');
    });

    it('should create high warning for regular file conflicts', () => {
      mockDirtyTree.files = [
        {
          path: 'src/api/auth.ts',
          status: 'modified',
          hunks: [],
          lastModified: Date.now(),
        },
      ];

      const warnings = createDirtyTreeWarnings(['src/api/auth.ts'], mockDirtyTree);

      expect(warnings).toHaveLength(1);
      expect(warnings[0].conflictSeverity).toBe('high');
    });

    it('should create medium warning for test file conflicts', () => {
      mockDirtyTree.files = [
        {
          path: 'src/api/__tests__/auth.test.ts',
          status: 'modified',
          hunks: [],
          lastModified: Date.now(),
        },
      ];

      const warnings = createDirtyTreeWarnings(['src/api/__tests__/auth.test.ts'], mockDirtyTree);

      expect(warnings).toHaveLength(1);
      expect(warnings[0].conflictSeverity).toBe('medium');
    });
  });

  describe('Integrated Work Plan Creation', () => {
    it('should create integrated plan with module context', () => {
      const integrated = createIntegratedWorkPlan(mockBasePlan, phase2Context);

      expect(integrated).toHaveProperty('moduleContext');
      expect(integrated.moduleContext).toBe(mockModules);
    });

    it('should include impacted modules', () => {
      const integrated = createIntegratedWorkPlan(mockBasePlan, phase2Context);

      expect(integrated.impactedModules).toHaveLength(2);
      expect(integrated.impactedModules[0].impactType).toBe('direct');
    });

    it('should include dependency impact analysis', () => {
      const integrated = createIntegratedWorkPlan(mockBasePlan, phase2Context);

      expect(integrated.dependencyImpactAnalysis).toHaveProperty('riskLevel');
      expect(integrated.dependencyImpactAnalysis).toHaveProperty('transitivelyAffected');
    });

    it('should include contextual ownership', () => {
      const integrated = createIntegratedWorkPlan(mockBasePlan, phase2Context);

      expect(integrated.contextualOwnership).toHaveLength(3);
      expect(integrated.contextualOwnership[0]).toHaveProperty('owner');
    });

    it('should assess safety correctly', () => {
      const integrated = createIntegratedWorkPlan(mockBasePlan, phase2Context);

      expect(integrated.safetyAssessment).toMatchObject({
        hasConflicts: false,
        canProceedWithApproval: true,
        requiresManualReview: false,
      });
    });

    it('should flag for review on high risk', () => {
      mockDependencyGraph.getSignalsTo = () =>
        Array.from({ length: 12 }, (_, i) => ({
          source: `file-${i}.ts`,
          target: 'src/api/index.ts',
          type: 'import',
          confidence: 'high',
        })) as DependencySignal[];

      const integrated = createIntegratedWorkPlan(mockBasePlan, phase2Context);

      expect(integrated.dependencyImpactAnalysis.riskLevel).toBe('critical');
      expect(integrated.safetyAssessment.requiresManualReview).toBe(true);
    });
  });

  describe('Integrated Work Plan Validation', () => {
    it('should validate clean plans', () => {
      const integrated = createIntegratedWorkPlan(mockBasePlan, phase2Context);
      const validation = validateIntegratedWorkPlan(integrated);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should catch critical dirty file conflicts', () => {
      mockDirtyTree.files = [
        {
          path: 'src/api/auth.ts',
          status: 'modified',
          hunks: [],
          lastModified: Date.now(),
        },
      ];
      mockOverwriteCheck.hasConflicts = true;
      mockOverwriteCheck.mergeStrategy = 'abort';

      const integrated = createIntegratedWorkPlan(mockBasePlan, phase2Context);
      const validation = validateIntegratedWorkPlan(integrated);

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('should warn on dependency impact', () => {
      mockDependencyGraph.getSignalsTo = () =>
        Array.from({ length: 15 }, (_, i) => ({
          source: `file-${i}.ts`,
          target: 'src/api/index.ts',
          type: 'import',
          confidence: 'high',
        })) as DependencySignal[];

      const integrated = createIntegratedWorkPlan(mockBasePlan, phase2Context);
      const validation = validateIntegratedWorkPlan(integrated);

      expect(validation.warnings.length).toBeGreaterThan(0);
      expect(validation.warnings[0]).toContain('CRITICAL');
    });

    it('should collect multiple warnings', () => {
      mockDependencyGraph.getSignalsTo = () =>
        Array.from({ length: 12 }, (_, i) => ({
          source: `file-${i}.ts`,
          target: 'src/api/index.ts',
          type: 'import',
          confidence: 'high',
        })) as DependencySignal[];

      mockOverwriteCheck.hasConflicts = true;
      mockOverwriteCheck.conflicts = [{ file: 'src/api/auth.ts', type: 'direct-overwrite' }];

      const integrated = createIntegratedWorkPlan(mockBasePlan, phase2Context);
      const validation = validateIntegratedWorkPlan(integrated);

      expect(validation.warnings.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Integrated Work Plan Summary', () => {
    it('should generate readable summary', () => {
      const integrated = createIntegratedWorkPlan(mockBasePlan, phase2Context);
      const summary = summarizeIntegratedWorkPlan(integrated);

      expect(Array.isArray(summary)).toBe(true);
      expect(summary.length).toBeGreaterThan(0);
      expect(summary.join('\n')).toContain('INTEGRATED FULL-STACK WORK PLAN');
    });

    it('should include request and classification', () => {
      const integrated = createIntegratedWorkPlan(mockBasePlan, phase2Context);
      const summary = summarizeIntegratedWorkPlan(integrated);
      const text = summary.join('\n');

      expect(text).toContain('Add authentication to API');
      expect(text).toContain('feature');
      expect(text).toContain('moderate');
    });

    it('should include module context', () => {
      const integrated = createIntegratedWorkPlan(mockBasePlan, phase2Context);
      const summary = summarizeIntegratedWorkPlan(integrated);
      const text = summary.join('\n');

      expect(text).toContain('MODULES AFFECTED');
      expect(text).toContain('backend');
    });

    it('should include dependency impact', () => {
      const integrated = createIntegratedWorkPlan(mockBasePlan, phase2Context);
      const summary = summarizeIntegratedWorkPlan(integrated);
      const text = summary.join('\n');

      expect(text).toContain('DEPENDENCY IMPACT');
      expect(text).toContain('Risk Level');
    });

    it('should include safety assessment', () => {
      const integrated = createIntegratedWorkPlan(mockBasePlan, phase2Context);
      const summary = summarizeIntegratedWorkPlan(integrated);
      const text = summary.join('\n');

      expect(text).toContain('SAFETY ASSESSMENT');
      expect(text).toContain('Conflicts');
    });
  });

  describe('Integration Flows', () => {
    it('should handle complex multi-module changes', () => {
      const files = ['src/api/auth.ts', 'src/middleware/auth.ts', 'ui/components/Login.tsx', 'ui/pages/Auth.tsx'];
      const integrated = createIntegratedWorkPlan(
        { ...mockBasePlan, affectedFiles: files },
        phase2Context
      );

      expect(integrated.impactedModules.length).toBeGreaterThan(0);
      expect(integrated.contextualOwnership.length).toBe(files.length);
      expect(integrated.safetyAssessment).toBeDefined();
    });

    it('should handle bug fix with minimal scope', () => {
      const bugFixPlan: FullStackWorkPlan = {
        ...mockBasePlan,
        userRequest: 'Fix auth validation bug',
        classification: 'bug_fix',
        affectedFiles: ['src/middleware/auth.ts'],
        estimatedComplexity: 'simple',
      };

      const integrated = createIntegratedWorkPlan(bugFixPlan, phase2Context);

      expect(integrated.dependencyImpactAnalysis.riskLevel).toMatch(/low|medium/);
      expect(integrated.safetyAssessment.requiresManualReview).toBe(false);
    });

    it('should handle infrastructure changes with high scrutiny', () => {
      const infraPlan: FullStackWorkPlan = {
        ...mockBasePlan,
        userRequest: 'Update authentication provider',
        classification: 'infrastructure',
        affectedFiles: ['package.json', 'src/config/auth.ts', 'src/middleware/auth.ts'],
        estimatedComplexity: 'complex',
      };

      mockDirtyTree.files = [
        {
          path: 'package.json',
          status: 'modified',
          hunks: [],
          lastModified: Date.now(),
        },
      ];

      const integrated = createIntegratedWorkPlan(infraPlan, phase2Context);
      const validation = validateIntegratedWorkPlan(integrated);

      expect(integrated.dirtyTreeWarnings.length).toBeGreaterThan(0);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('should create complete integrated plan for feature request', () => {
      const featurePlan: FullStackWorkPlan = {
        ...mockBasePlan,
        userRequest: 'Add two-factor authentication',
        classification: 'feature',
        touchedLayers: ['backend', 'frontend', 'data', 'tests'],
        affectedFiles: [
          'src/services/auth.ts',
          'src/api/2fa.ts',
          'ui/components/2FASetup.tsx',
          'data/migrations/add_2fa.sql',
          'tests/auth.test.ts',
        ],
        estimatedComplexity: 'complex',
      };

      const integrated = createIntegratedWorkPlan(featurePlan, phase2Context);
      const validation = validateIntegratedWorkPlan(integrated);
      const summary = summarizeIntegratedWorkPlan(integrated);

      expect(integrated.impactedModules.length).toBeGreaterThan(0);
      expect(integrated.contextualOwnership.length).toBe(5);
      expect(validation.valid).toBe(true);
      expect(summary.length).toBeGreaterThan(20);
    });
  });
});
