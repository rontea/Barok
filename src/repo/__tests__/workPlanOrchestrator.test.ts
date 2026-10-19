/**
 * Phase 3 Work Plan Orchestrator Tests
 * Tests for task classification, layer detection, ownership planning, and orchestration
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  classifyTask,
  detectTouchedLayers,
  assignFileOwnership,
  canTasksRunParallel,
  groupTasksForParallel,
  estimateComplexity,
  createWorkPlan,
  validateWorkPlan,
  summarizeWorkPlan,
  type ExecutionLayer,
  type TaskClassification,
  type TaskComplexity,
  type ModuleResponsibility,
  type PlanningContext,
  type FullStackWorkPlan,
} from '../workPlanOrchestrator.js';

describe('Phase 3 - Work Plan Orchestrator', () => {
  let mockModules: ModuleResponsibility[];
  let planningContext: PlanningContext;

  beforeEach(() => {
    mockModules = [
      {
        name: 'backend',
        path: 'src',
        layer: 'backend',
        description: 'Backend services',
        exports: [],
        keyFiles: ['src/index.ts'],
        entryPoints: ['src/index.ts'],
        dependencies: [],
        dependents: [],
        lastAnalyzed: Date.now(),
      },
      {
        name: 'frontend',
        path: 'ui',
        layer: 'frontend',
        description: 'React UI',
        exports: [],
        keyFiles: ['ui/src/App.tsx'],
        entryPoints: ['ui/src/main.tsx'],
        dependencies: [],
        dependents: [],
        lastAnalyzed: Date.now(),
      },
      {
        name: 'data',
        path: 'src/data',
        layer: 'data',
        description: 'Data models',
        exports: [],
        keyFiles: ['src/data/index.ts'],
        entryPoints: ['src/data/index.ts'],
        dependencies: [],
        dependents: [],
        lastAnalyzed: Date.now(),
      },
    ];

    planningContext = {
      modules: mockModules,
      signals: [],
      dirtyTree: {
        isDirty: false,
        files: [],
        modifiedCount: 0,
        addedCount: 0,
        deletedCount: 0,
        untrackedCount: 0,
        totalChanges: 0,
        lastScanned: Date.now(),
      },
    };
  });

  describe('Task Classification', () => {
    it('should classify bug fixes', () => {
      const classifications: Array<[string, TaskClassification]> = [
        ['fix the login bug', 'bug_fix'],
        ['there is an error in validation', 'bug_fix'],
        ['broken api endpoint', 'bug_fix'],
      ];

      for (const [request, expected] of classifications) {
        expect(classifyTask(request)).toBe(expected);
      }
    });

    it('should classify feature requests', () => {
      const classifications: Array<[string, TaskClassification]> = [
        ['add dark mode', 'new_feature'],
        ['implement user authentication', 'new_feature'],
        ['create admin panel', 'new_feature'],
      ];

      for (const [request, expected] of classifications) {
        expect(classifyTask(request)).toBe(expected);
      }
    });

    it('should classify refactoring tasks', () => {
      const classifications: Array<[string, TaskClassification]> = [
        ['refactor the auth module', 'refactor'],
        ['restructure database layer', 'refactor'],
        ['cleanup unused code', 'refactor'],
      ];

      for (const [request, expected] of classifications) {
        expect(classifyTask(request)).toBe(expected);
      }
    });

    it('should classify test-only tasks', () => {
      expect(classifyTask('add unit tests for utils')).toBe('test_only');
      expect(classifyTask('improve test coverage')).toBe('test_only');
    });

    it('should classify documentation tasks', () => {
      expect(classifyTask('update readme')).toBe('docs_only');
      expect(classifyTask('add API documentation')).toBe('docs_only');
    });

    it('should classify coder lifecycle task kinds', () => {
      const classifications: Array<[string, TaskClassification]> = [
        ['fix the send button', 'bug_fix'],
        ['add a new settings page', 'new_feature'],
        ['start a new agent instance', 'new_instance'],
        ['continue the last task', 'continuation'],
        ['review the current app', 'investigation'],
        ['refactor the planner', 'refactor'],
        ['add unit tests for task analysis', 'test_only'],
        ['update docs for coder chat', 'docs_only'],
      ];

      for (const [request, expected] of classifications) {
        expect(classifyTask(request)).toBe(expected);
      }
    });

    it('should classify infrastructure tasks', () => {
      expect(classifyTask('setup CI pipeline')).toBe('infrastructure');
      expect(classifyTask('configure deployment')).toBe('infrastructure');
    });

    it('should handle edge cases', () => {
      expect(classifyTask('unknown task')).toBe('new_feature');
      expect(classifyTask('')).toBe('new_feature');
    });
  });

  describe('Layer Detection', () => {
    it('should detect frontend layer from file patterns', () => {
      const layers = detectTouchedLayers(['ui/src/App.tsx', 'ui/components/Button.tsx'], 'new_feature');
      expect(layers).toContain('frontend');
    });

    it('should detect backend layer from file patterns', () => {
      const layers = detectTouchedLayers(['src/services/auth.ts', 'src/routes/api.ts'], 'new_feature');
      expect(layers).toContain('backend');
    });

    it('should detect data layer from file patterns', () => {
      const layers = detectTouchedLayers(['src/data/models.ts', 'src/data/repository.ts'], 'new_feature');
      expect(layers).toContain('data');
    });

    it('should detect test layer', () => {
      const layers = detectTouchedLayers(['tests/unit.test.ts', 'tests/integration.spec.ts'], 'test_only');
      expect(layers).toContain('tests');
    });

    it('should detect docs layer', () => {
      const layers = detectTouchedLayers(['docs/api.md', 'README.md'], 'docs_only');
      expect(layers).toContain('docs');
    });

    it('should detect multiple layers', () => {
      const layers = detectTouchedLayers(
        ['ui/src/App.tsx', 'src/services/auth.ts', 'src/data/models.ts'],
        'new_feature'
      );
      expect(layers.length).toBeGreaterThanOrEqual(3);
    });

    it('should add layer based on classification', () => {
      const layers = detectTouchedLayers([], 'test_only');
      expect(layers).toContain('tests');
    });
  });

  describe('File Ownership Assignment', () => {
    it('should assign ownership based on module', () => {
      const ownership = assignFileOwnership(['src/services/auth.ts'], mockModules);
      expect(ownership[0].owner).toBe('backend');
      expect(ownership[0].confidence).toBe('high');
    });

    it('should assign multiple owners', () => {
      const ownership = assignFileOwnership(
        ['ui/src/App.tsx', 'src/services/auth.ts', 'src/data/models.ts'],
        mockModules
      );
      expect(ownership.length).toBe(3);
      expect(ownership.map((o) => o.owner).sort()).toEqual(['backend', 'backend', 'frontend']);
    });

    it('should provide reasons for ownership', () => {
      const ownership = assignFileOwnership(['src/services/auth.ts'], mockModules);
      expect(ownership[0].reason).toBeDefined();
    });

    it('should handle files without module match', () => {
      const ownership = assignFileOwnership(['unknown/file.ts'], mockModules);
      expect(ownership[0].owner).toBe('reviewer');
      expect(ownership[0].confidence).toBe('medium');
    });

    it('should infer ownership from file paths', () => {
      const ownership = assignFileOwnership(['ui/new-component.tsx'], mockModules);
      expect(ownership[0].owner).toBe('frontend');
    });
  });

  describe('Parallel Execution Detection', () => {
    it('should keep single-owner tasks sequential', () => {
      const ownership = [
        { file: 'ui/App.tsx', owner: 'frontend', confidence: 'high' as const, reason: 'Frontend' },
        {
          file: 'ui/components/Button.tsx',
          owner: 'frontend',
          confidence: 'high' as const,
          reason: 'Frontend',
        },
      ];

      expect(canTasksRunParallel(ownership)).toBe(false);
    });

    it('should allow non-overlapping multi-owner tasks to run in parallel', () => {
      const ownership = [
        { file: 'ui/App.tsx', owner: 'frontend', confidence: 'high' as const, reason: 'Frontend' },
        { file: 'src/auth.ts', owner: 'backend', confidence: 'high' as const, reason: 'Backend' },
      ];

      expect(canTasksRunParallel(ownership)).toBe(true);
    });

    it('should keep overlapping file ownership sequential', () => {
      const ownership = [
        { file: 'ui/App.tsx', owner: 'frontend', confidence: 'high' as const, reason: 'Frontend' },
        { file: 'ui/App.tsx', owner: 'reviewer', confidence: 'high' as const, reason: 'Review' },
      ];

      expect(canTasksRunParallel(ownership)).toBe(false);
    });

    it('should group tasks by owner', () => {
      const ownership = [
        { file: 'ui/App.tsx', owner: 'frontend', confidence: 'high' as const, reason: 'Frontend' },
        { file: 'ui/Button.tsx', owner: 'frontend', confidence: 'high' as const, reason: 'Frontend' },
        { file: 'src/auth.ts', owner: 'backend', confidence: 'high' as const, reason: 'Backend' },
        { file: 'src/db.ts', owner: 'backend', confidence: 'high' as const, reason: 'Backend' },
      ];

      const groups = groupTasksForParallel(ownership);
      expect(groups.length).toBe(2);
    });
  });

  describe('Complexity Estimation', () => {
    it('should estimate trivial or simple complexity', () => {
      const complexity = estimateComplexity(['single-file.ts'], [], 'test_only');
      expect(['trivial', 'simple']).toContain(complexity);
    });

    it('should estimate simple complexity', () => {
      const complexity = estimateComplexity(
        ['ui/component.tsx'],
        ['frontend'],
        'test_only'
      );
      expect(complexity).toBe('simple');
    });

    it('should estimate moderate complexity', () => {
      const complexity = estimateComplexity(
        ['ui/App.tsx', 'ui/Button.tsx'],
        ['frontend', 'backend'],
        'new_feature'
      );
      expect(complexity).toMatch(/moderate|complex/);
    });

    it('should estimate expert complexity for large changes', () => {
      const files = Array.from({ length: 15 }, (_, i) => `src/file${i}.ts`);
      const layers: ExecutionLayer[] = ['frontend', 'backend', 'data', 'tests'];
      const complexity = estimateComplexity(files, layers, 'refactor');
      expect(['complex', 'expert']).toContain(complexity);
    });
  });

  describe('Work Plan Creation', () => {
    it('should create valid work plan', () => {
      const plan = createWorkPlan(
        'add user authentication',
        ['ui/Login.tsx', 'src/auth.ts', 'src/data/user.ts'],
        planningContext
      );

      expect(plan).toBeDefined();
      expect(plan.userRequest).toBe('add user authentication');
      expect(plan.classification).toBe('new_feature');
      expect(plan.affectedFiles.length).toBe(3);
    });

    it('should include module context', () => {
      const plan = createWorkPlan(
        'update auth',
        ['src/auth.ts'],
        planningContext
      );

      expect(plan.moduleContext.length).toBeGreaterThan(0);
    });

    it('should assign file ownership', () => {
      const plan = createWorkPlan(
        'update auth',
        ['src/auth.ts', 'ui/Login.tsx'],
        planningContext
      );

      expect(plan.fileOwnership.length).toBe(2);
    });

    it('should create acceptance criteria', () => {
      const plan = createWorkPlan(
        'add feature',
        ['src/new-feature.ts'],
        planningContext
      );

      expect(plan.acceptanceCriteria.length).toBeGreaterThan(0);
    });

    it('should create verification plan', () => {
      const plan = createWorkPlan(
        'update ui',
        ['ui/App.tsx'],
        planningContext
      );

      expect(plan.verificationPlan.length).toBeGreaterThan(0);
    });

    it('should calculate safety score', () => {
      const plan = createWorkPlan(
        'simple fix',
        ['src/utils.ts'],
        planningContext
      );

      expect(plan.safetyScore).toBeGreaterThanOrEqual(0);
      expect(plan.safetyScore).toBeLessThanOrEqual(100);
    });

    it('should include dirty tree warnings', () => {
      const contextWithDirty: PlanningContext = {
        ...planningContext,
        dirtyTree: {
          isDirty: true,
          files: [
            {
              path: 'src/auth.ts',
              status: 'modified',
              hunks: [],
              lastModified: Date.now(),
            },
          ],
          modifiedCount: 1,
          addedCount: 0,
          deletedCount: 0,
          untrackedCount: 0,
          totalChanges: 1,
          lastScanned: Date.now(),
        },
      };

      const plan = createWorkPlan(
        'update auth',
        ['src/auth.ts'],
        contextWithDirty
      );

      expect(plan.dirtyTreeWarnings).toBeDefined();
      expect(plan.dirtyTreeWarnings?.length ?? 0).toBeGreaterThan(0);
    });

    it('should treat unclear-risk tasks as sequential', () => {
      const plan = createWorkPlan(
        'continue the last task',
        ['ui/src/App.tsx', 'src/server.ts'],
        planningContext
      );

      expect(plan.classification).toBe('continuation');
      expect(plan.executionStrategy).toBe('sequential');
      expect(plan.canRunParallel).toBe(false);
      expect(plan.riskFactors).toContain('Unclear risk requires sequential execution');
    });

    it('should make plans touching the same file sequential', () => {
      const plan = createWorkPlan(
        'add feature in shared app shell',
        ['ui/src/App.tsx', 'ui/src/App.tsx'],
        planningContext
      );

      expect(plan.executionStrategy).toBe('sequential');
      expect(plan.canRunParallel).toBe(false);
      expect(plan.riskFactors).toContain('Multiple planned tasks touch the same file');
    });

    it('should allow independent non-overlapping work to be parallelizable', () => {
      const plan = createWorkPlan(
        'add frontend panel and backend endpoint',
        ['ui/src/components/Panel.tsx', 'src/api/panel.ts'],
        planningContext
      );

      expect(plan.executionStrategy).toBe('parallel');
      expect(plan.canRunParallel).toBe(true);
      expect(plan.parallelGroups?.length).toBe(2);
    });

    it('should avoid parallel edits when risk is unclear from dirty tree state', () => {
      const dirtyContext: PlanningContext = {
        ...planningContext,
        dirtyTree: {
          isDirty: true,
          files: [],
          modifiedCount: 1,
          addedCount: 0,
          deletedCount: 0,
          untrackedCount: 0,
          totalChanges: 1,
          lastScanned: Date.now(),
        },
      };

      const plan = createWorkPlan(
        'add frontend panel and backend endpoint',
        ['ui/src/components/Panel.tsx', 'src/api/panel.ts'],
        dirtyContext
      );

      expect(plan.executionStrategy).toBe('sequential');
      expect(plan.canRunParallel).toBe(false);
      expect(plan.riskFactors).toContain('Unclear risk requires sequential execution');
    });
  });

  describe('Work Plan Validation', () => {
    let validPlan: FullStackWorkPlan;

    beforeEach(() => {
      validPlan = createWorkPlan(
        'add feature',
        ['src/feature.ts'],
        planningContext
      );
    });

    it('should validate complete plans', () => {
      const result = validateWorkPlan(validPlan);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should reject empty user request', () => {
      const plan = { ...validPlan, userRequest: '' };
      const result = validateWorkPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('User request'))).toBe(true);
    });

    it('should reject missing affected files', () => {
      const plan = { ...validPlan, affectedFiles: [] };
      const result = validateWorkPlan(plan);
      expect(result.valid).toBe(false);
    });

    it('should allow broad investigation plans without affected files', () => {
      const plan = createWorkPlan('investigate the current app architecture', [], planningContext);
      const result = validateWorkPlan(plan);

      expect(plan.classification).toBe('investigation');
      expect(result.valid).toBe(true);
    });

    it('should check for unowned files', () => {
      const plan = { ...validPlan, fileOwnership: [] };
      const result = validateWorkPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('ownership'))).toBe(true);
    });
  });

  describe('Work Plan Summary', () => {
    it('should generate readable summary', () => {
      const plan = createWorkPlan(
        'add user authentication',
        ['ui/Login.tsx', 'src/auth.ts'],
        planningContext
      );

      const summary = summarizeWorkPlan(plan);
      expect(Array.isArray(summary)).toBe(true);
      expect(summary.length).toBeGreaterThan(0);
    });

    it('should include request information', () => {
      const plan = createWorkPlan(
        'add user authentication',
        ['ui/Login.tsx'],
        planningContext
      );

      const summary = summarizeWorkPlan(plan).join('\n');
      expect(summary).toContain('add user authentication');
    });

    it('should include classification', () => {
      const plan = createWorkPlan(
        'add feature',
        ['src/feature.ts'],
        planningContext
      );

      const summary = summarizeWorkPlan(plan).join('\n');
      expect(summary).toContain('Classification');
      expect(summary).toContain('new_feature');
    });

    it('should include scope information', () => {
      const plan = createWorkPlan(
        'update files',
        ['src/a.ts', 'src/b.ts', 'ui/c.tsx'],
        planningContext
      );

      const summary = summarizeWorkPlan(plan).join('\n');
      expect(summary).toContain('Files');
      expect(summary).toContain('Layers');
    });

    it('should include verification information', () => {
      const plan = createWorkPlan(
        'add feature',
        ['ui/component.tsx'],
        planningContext
      );

      const summary = summarizeWorkPlan(plan).join('\n');
      expect(summary).toContain('Verification');
    });

    it('should include safety information', () => {
      const plan = createWorkPlan(
        'add feature',
        ['src/feature.ts'],
        planningContext
      );

      const summary = summarizeWorkPlan(plan).join('\n');
      expect(summary).toContain('Safety');
      expect(summary).toContain('Score');
    });

    it('should be formatted for display', () => {
      const plan = createWorkPlan(
        'add feature',
        ['src/feature.ts'],
        planningContext
      );

      const summary = summarizeWorkPlan(plan);
      expect(summary[0]).toContain('╔');
      expect(summary.some((line) => line.includes('╚'))).toBe(true);
    });
  });

  describe('Integration: Full Work Plan Flow', () => {
    it('should handle bug fix workflow', () => {
      const plan = createWorkPlan(
        'fix login button not responding',
        ['ui/components/Login.tsx', 'src/handlers/auth.ts'],
        planningContext
      );

      expect(plan.classification).toBe('bug_fix');
      expect(plan.touchedLayers).toContain('frontend');
      expect(plan.touchedLayers).toContain('backend');
      expect(validateWorkPlan(plan).valid).toBe(true);
    });

    it('should handle feature workflow', () => {
      const plan = createWorkPlan(
        'implement dark mode toggle',
        ['ui/App.tsx', 'ui/hooks/useDarkMode.ts', 'src/settings/theme.ts', 'src/data/preferences.ts'],
        planningContext
      );

      expect(plan.classification).toBe('new_feature');
      expect(plan.touchedLayers.length).toBeGreaterThanOrEqual(2);
      expect(plan.acceptanceCriteria.length).toBeGreaterThan(0);
      expect(validateWorkPlan(plan).valid).toBe(true);
    });

    it('should handle refactor workflow', () => {
      const plan = createWorkPlan(
        'refactor authentication module',
        ['src/auth/core.ts', 'src/auth/strategies.ts', 'tests/auth.test.ts'],
        planningContext
      );

      expect(plan.classification).toBe('refactor');
      expect(plan.touchedLayers).toContain('backend');
      expect(plan.touchedLayers).toContain('tests');
    });

    it('should handle multi-layer changes', () => {
      const plan = createWorkPlan(
        'add notification system',
        [
          'ui/components/Notifications.tsx',
          'src/services/notifications.ts',
          'src/data/notifications.ts',
          'tests/notifications.test.ts',
          'docs/features/notifications.md',
        ],
        planningContext
      );

      expect(plan.touchedLayers.length).toBeGreaterThanOrEqual(4);
      expect(plan.fileOwnership.length).toBe(5);
      expect(validateWorkPlan(plan).valid).toBe(true);
    });
  });
});
