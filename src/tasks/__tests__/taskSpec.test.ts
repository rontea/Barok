/**
 * Tests for Full-Stack Task Specification and Classification
 */

import { describe, it, expect } from '@jest/globals';
import {
  classifyTask,
  detectTouchedLayers,
  canRunInParallel,
  detectParallelCompatibility,
  orderTasksByDependency,
  estimateComplexity,
  createTaskSpec,
} from '../taskSpec.js';
import type { FullStackTaskSpec, FileOwnershipPlan } from '../taskSpec.js';

describe('Task Classification', () => {
  it('should classify bug fixes', () => {
    expect(classifyTask('Fix the login button bug')).toBe('bug_fix');
    expect(classifyTask('There is a broken component')).toBe('bug_fix');
    expect(classifyTask('API timeout bug: needs fixing')).toBe('bug_fix');
  });

  it('should classify features', () => {
    expect(classifyTask('Add dark mode support')).toBe('feature');
    expect(classifyTask('Implement new user profile page')).toBe('feature');
    expect(classifyTask('Create a new feature for admin panel')).toBe('feature');
  });

  it('should classify refactors', () => {
    expect(classifyTask('Refactor the authentication service')).toBe('refactor');
    expect(classifyTask('Reorganize utility functions')).toBe('refactor');
    expect(classifyTask('Optimize database queries')).toBe('refactor');
  });

  it('should classify test-only tasks', () => {
    expect(classifyTask('Add unit tests for validation')).toBe('test_only');
    expect(classifyTask('Write integration tests')).toBe('test_only');
    expect(classifyTask('Improve test coverage')).toBe('test_only');
  });

  it('should classify documentation tasks', () => {
    expect(classifyTask('Update README with new instructions')).toBe('docs_only');
    expect(classifyTask('Write API documentation')).toBe('docs_only');
    expect(classifyTask('Update CHANGELOG')).toBe('docs_only');
  });

  it('should classify infrastructure tasks', () => {
    expect(classifyTask('Set up CI/CD pipeline')).toBe('infrastructure');
    expect(classifyTask('Update build configuration')).toBe('infrastructure');
    expect(classifyTask('Configure ESLint and Prettier')).toBe('infrastructure');
  });

  it('should route browser implementation requests away from infrastructure', () => {
    expect(classifyTask('Build a vanilla HTML CSS JavaScript browser simulation')).toBe('generated_app');
    expect(classifyTask('Update the frontend build configuration')).toBe('infrastructure');
  });

  it('should classify generated app tasks', () => {
    expect(classifyTask('Generate a new React app')).toBe('generated_app');
  });

  it('should default to investigation', () => {
    expect(classifyTask('Look into the performance issue')).toBe('investigation');
  });
});

describe('Layer Detection', () => {
  it('should detect frontend layer', () => {
    const layers = detectTouchedLayers(['ui/src/App.tsx', 'ui/src/components/Button.tsx']);
    expect(layers).toContain('frontend');
  });

  it('should detect backend layer', () => {
    const layers = detectTouchedLayers(['src/react/engine.ts', 'src/di/container.ts']);
    expect(layers).toContain('backend');
  });

  it('should detect data layer', () => {
    const layers = detectTouchedLayers(['src/data/models.ts', 'migrations/001_initial.sql']);
    expect(layers).toContain('data');
  });

  it('should detect config layer', () => {
    const layers = detectTouchedLayers(['tsconfig.json', 'vite.config.ts']);
    expect(layers).toContain('config');
  });

  it('should detect test layer', () => {
    const layers = detectTouchedLayers(['src/__tests__/engine.test.ts', 'tests/smoke/app.spec.ts']);
    expect(layers).toContain('tests');
  });

  it('should detect docs layer', () => {
    const layers = detectTouchedLayers(['docs/API.md', 'README.md', 'CHANGELOG.md']);
    expect(layers).toContain('docs');
  });

  it('should detect CLI layer', () => {
    const layers = detectTouchedLayers(['src/cli/commands.ts']);
    expect(layers).toContain('cli');
  });

  it('should detect VSCode extension layer', () => {
    const layers = detectTouchedLayers(['vscode-extension/extension.ts']);
    expect(layers).toContain('vscode_extension');
  });

  it('should detect multiple layers', () => {
    const layers = detectTouchedLayers([
      'ui/src/App.tsx',
      'src/api.ts',
      'src/__tests__/api.test.ts',
    ]);
    expect(layers.length).toBe(3);
    expect(layers).toContain('frontend');
    expect(layers).toContain('backend');
    expect(layers).toContain('tests');
  });
});

describe('Parallel Execution Compatibility', () => {
  it('should detect conflicts when agents own same file', () => {
    const plans: FileOwnershipPlan[][] = [
      [{ path: 'src/utils.ts', owner: 'backend' }],
      [{ path: 'src/utils.ts', owner: 'test' }],
    ];
    expect(canRunInParallel(plans)).toBe(false);
  });

  it('should allow parallel when no file conflicts', () => {
    const plans: FileOwnershipPlan[][] = [
      [{ path: 'src/api.ts', owner: 'backend' }],
      [{ path: 'ui/src/App.tsx', owner: 'frontend' }],
    ];
    expect(canRunInParallel(plans)).toBe(true);
  });

  it('should detect parallelization between task specs', () => {
    const taskA: FullStackTaskSpec = {
      id: 'task-1',
      title: 'Backend API',
      description: 'Add API endpoint',
      userRequest: 'Add API',
      targetSurfaces: [],
      affectedFiles: ['src/api.ts'],
      acceptanceCriteria: [],
      verificationPlan: { criteria: [], commands: [], manualReview: false },
      classification: 'feature',
      touchedLayers: ['backend'],
      ownershipPlan: [{ path: 'src/api.ts', owner: 'backend' }],
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

    const taskB: FullStackTaskSpec = {
      ...taskA,
      id: 'task-2',
      affectedFiles: ['ui/src/App.tsx'],
      ownershipPlan: [{ path: 'ui/src/App.tsx', owner: 'frontend' }],
      touchedLayers: ['frontend'],
    };

    expect(detectParallelCompatibility(taskA, taskB)).toBe(true);
  });

  it('should detect conflicts between task specs with same ownership', () => {
    const taskA: FullStackTaskSpec = {
      id: 'task-1',
      title: 'Task A',
      description: '',
      userRequest: '',
      targetSurfaces: [],
      affectedFiles: ['src/api.ts'],
      acceptanceCriteria: [],
      verificationPlan: { criteria: [], commands: [], manualReview: false },
      classification: 'feature',
      touchedLayers: ['backend'],
      ownershipPlan: [{ path: 'src/api.ts', owner: 'backend' }],
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

    const taskB: FullStackTaskSpec = {
      ...taskA,
      id: 'task-2',
      affectedFiles: ['src/service.ts'],
      ownershipPlan: [{ path: 'src/service.ts', owner: 'backend' }],
    };

    expect(detectParallelCompatibility(taskA, taskB)).toBe(false);
  });

  it('should detect conflicts when tasks touch same files', () => {
    const taskA: FullStackTaskSpec = {
      id: 'task-1',
      title: 'Task A',
      description: '',
      userRequest: '',
      targetSurfaces: [],
      affectedFiles: ['src/api.ts'],
      acceptanceCriteria: [],
      verificationPlan: { criteria: [], commands: [], manualReview: false },
      classification: 'feature',
      touchedLayers: ['backend'],
      ownershipPlan: [{ path: 'src/api.ts', owner: 'backend' }],
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

    const taskB: FullStackTaskSpec = {
      ...taskA,
      id: 'task-2',
      ownershipPlan: [{ path: 'src/api.ts', owner: 'backend' }],
    };

    expect(detectParallelCompatibility(taskA, taskB)).toBe(false);
  });
});

describe('Task Dependency Ordering', () => {
  it('should order tasks by dependencies', () => {
    const taskA: FullStackTaskSpec = {
      id: 'task-1',
      title: 'Base Task',
      description: '',
      userRequest: '',
      targetSurfaces: [],
      affectedFiles: [],
      acceptanceCriteria: [],
      verificationPlan: { criteria: [], commands: [], manualReview: false },
      classification: 'feature',
      touchedLayers: [],
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

    const taskB: FullStackTaskSpec = {
      ...taskA,
      id: 'task-2',
      dependencies: [{ dependsOn: 'task-1', reason: 'Needs base task', type: 'hard' }],
    };

    const ordered = orderTasksByDependency([taskB, taskA]);
    expect(ordered[0].id).toBe('task-1');
    expect(ordered[1].id).toBe('task-2');
  });

  it('should handle complex dependency chains', () => {
    const base: FullStackTaskSpec = {
      id: 'task-1',
      title: '',
      description: '',
      userRequest: '',
      targetSurfaces: [],
      affectedFiles: [],
      acceptanceCriteria: [],
      verificationPlan: { criteria: [], commands: [], manualReview: false },
      classification: 'feature',
      touchedLayers: [],
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

    const taskA = { ...base, id: 'task-a', dependencies: [{ dependsOn: 'task-1', reason: '', type: 'hard' as const }] };
    const taskB = { ...base, id: 'task-b', dependencies: [{ dependsOn: 'task-a', reason: '', type: 'hard' as const }] };

    const ordered = orderTasksByDependency([taskB, taskA, base]);
    expect(ordered[0].id).toBe('task-1');
    expect(ordered[1].id).toBe('task-a');
    expect(ordered[2].id).toBe('task-b');
  });
});

describe('Complexity Estimation', () => {
  it('should estimate trivial complexity', () => {
    expect(estimateComplexity('docs_only', ['README.md'], [])).toBe('trivial');
  });

  it('should estimate simple complexity', () => {
    expect(estimateComplexity('bug_fix', ['src/utils.ts'], ['backend'])).toBe(
      'simple'
    );
  });

  it('should estimate moderate complexity', () => {
    expect(estimateComplexity('feature', ['src/api.ts', 'ui/src/Page.tsx'], [
      'backend',
      'frontend',
    ])).toBe('moderate');
  });

  it('should estimate complex', () => {
    expect(
      estimateComplexity('refactor', [
        'src/api.ts',
        'src/service.ts',
        'ui/src/Page.tsx',
        'ui/src/components/Button.tsx',
      ], ['backend', 'frontend', 'tests'])
    ).toBe('complex');
  });

  it('should estimate expert complexity', () => {
    expect(
      estimateComplexity('generated_app', [
        'src/api.ts',
        'src/service.ts',
        'ui/src/Page.tsx',
        'ui/src/components/Button.tsx',
        'ui/src/components/Form.tsx',
      ], ['backend', 'frontend', 'tests', 'data'])
    ).toBe('expert');
  });
});

describe('Task Spec Creation', () => {
  it('should create basic task spec', () => {
    const spec = createTaskSpec(
      'Add login feature',
      'Implement user login with OAuth',
      ['src/auth.ts', 'ui/src/LoginPage.tsx', 'src/__tests__/auth.test.ts']
    );

    expect(spec.id).toBeTruthy();
    expect(spec.title).toBe('Add login feature');
    expect(spec.classification).toBe('feature');
    expect(spec.touchedLayers).toContain('backend');
    expect(spec.touchedLayers).toContain('frontend');
    expect(spec.touchedLayers).toContain('tests');
  });

  it('should auto-classify from request', () => {
    const spec = createTaskSpec(
      'Bug fix',
      'Fix the broken authentication flow',
      ['src/auth.ts']
    );

    expect(spec.classification).toBe('bug_fix');
    expect(spec.requiresManualReview).toBe(true);
  });

  it('should mark expert tasks for manual review', () => {
    const spec = createTaskSpec(
      'Complex refactor',
      'Refactor entire payment system',
      [
        'src/payments/api.ts',
        'src/payments/service.ts',
        'src/payments/models.ts',
        'src/data/payments.ts',
        'ui/src/PaymentPage.tsx',
        'ui/src/components/PaymentForm.tsx',
        'src/__tests__/payments.test.ts',
        'docs/PAYMENTS.md',
      ]
    );

    expect(spec.estimatedComplexity).toBe('expert');
    expect(spec.requiresManualReview).toBe(true);
  });

  it('should include default verification plan', () => {
    const spec = createTaskSpec('Task', 'Request', ['src/file.ts']);
    expect(spec.verificationPlan.commands).toContain('npm run build');
    expect(spec.verificationPlan.commands).toContain('npm run test:unit');
  });

  it('should have unique IDs', () => {
    const spec1 = createTaskSpec('Task 1', 'Req 1', ['file1.ts']);
    const spec2 = createTaskSpec('Task 2', 'Req 2', ['file2.ts']);
    expect(spec1.id).not.toBe(spec2.id);
  });

  it('should set timestamp', () => {
    const before = Date.now();
    const spec = createTaskSpec('Task', 'Request', ['file.ts']);
    const after = Date.now();

    expect(spec.createdAt).toBeGreaterThanOrEqual(before);
    expect(spec.createdAt).toBeLessThanOrEqual(after);
  });
});
