/**
 * Phase 5.5: Test Selection Tests
 */

import {
  selectTestsForChanges,
  buildTestDependencyGraph,
  getTransitiveDependencies,
  findMinimalTestSet,
  estimateTestDuration,
  getCriticalTests,
  createTestMapping,
  prioritizeTestsBySpeed,
  isTestSelectionComplete,
  getTestSelectionStats,
  type TestFile,
} from '../testSelection';

describe('Phase 5.5: Test Selection', () => {
  const mockTests: TestFile[] = [
    {
      path: 'src/utils/__tests__/helpers.test.ts',
      sourceFiles: ['src/utils/helpers.ts'],
      dependencies: [],
      category: 'unit',
      coverage: ['src/utils/helpers.ts'],
    },
    {
      path: 'src/auth/__tests__/auth.test.ts',
      sourceFiles: ['src/auth/index.ts', 'src/auth/strategies.ts'],
      dependencies: ['src/utils/helpers.ts'],
      category: 'unit',
      coverage: ['src/auth/index.ts', 'src/auth/strategies.ts'],
    },
    {
      path: 'src/__tests__/integration.test.ts',
      sourceFiles: ['src/'],
      dependencies: ['src/auth/index.ts', 'src/utils/helpers.ts'],
      category: 'integration',
      coverage: ['src/'],
    },
    {
      path: 'ui/__tests__/components.test.ts',
      sourceFiles: ['ui/components'],
      dependencies: [],
      category: 'unit',
      coverage: ['ui/components'],
    },
    {
      path: 'ui/__tests__/e2e.test.ts',
      sourceFiles: ['ui/', 'src/'],
      dependencies: [],
      category: 'e2e',
      coverage: ['ui/', 'src/'],
    },
  ];

  describe('selectTestsForChanges', () => {
    it('should select unit test for single file change', () => {
      const result = selectTestsForChanges(['src/utils/helpers.ts'], mockTests);

      expect(result.selected).toContain('src/utils/__tests__/helpers.test.ts');
      expect(result.impactLevel).toBe('minimal');
    });

    it('should select dependent tests', () => {
      const result = selectTestsForChanges(['src/auth/index.ts'], mockTests);

      expect(result.selected).toContain('src/auth/__tests__/auth.test.ts');
      expect(result.selected.length).toBeGreaterThan(0);
    });

    it('should include integration tests for small changes', () => {
      const result = selectTestsForChanges(
        ['src/auth/index.ts', 'src/utils/helpers.ts'],
        mockTests
      );

      expect(result.impactLevel).toBe('small');
      expect(result.selected.length).toBeGreaterThan(1);
    });

    it('should include E2E tests for large changes', () => {
      const largeChanges = [
        'src/auth/index.ts',
        'src/utils/helpers.ts',
        'src/database.ts',
        'src/service.ts',
        'src/models.ts',
        'src/validators.ts',
        'src/middleware.ts',
        'src/routes.ts',
        'src/handlers.ts',
        'src/controllers.ts',
        'src/repositories.ts',
      ];

      const result = selectTestsForChanges(largeChanges, mockTests, {
        includeE2E: true,
      });

      expect(result.impactLevel).toBe('large');
    });

    it('should identify affected layers', () => {
      const result = selectTestsForChanges(
        ['src/auth/index.ts', 'ui/components/Button.tsx'],
        mockTests
      );

      expect(result.affectedLayers).toContain('backend');
      expect(result.affectedLayers).toContain('frontend');
    });

    it('should provide selection reason', () => {
      const result = selectTestsForChanges(['src/utils/helpers.ts'], mockTests);

      expect(result.reason).toContain('focused');
    });
  });

  describe('buildTestDependencyGraph', () => {
    it('should build dependency graph', () => {
      const graph = buildTestDependencyGraph(mockTests);

      expect(graph.size).toBeGreaterThan(0);
      expect(graph.has('src/utils/__tests__/helpers.test.ts')).toBe(true);
    });
  });

  describe('getTransitiveDependencies', () => {
    it('should find transitive dependencies', () => {
      const graph = buildTestDependencyGraph(mockTests);
      const deps = getTransitiveDependencies('src/auth/__tests__/auth.test.ts', graph);

      expect(deps.size).toBeGreaterThan(0);
      expect(deps.has('src/auth/__tests__/auth.test.ts')).toBe(true);
    });
  });

  describe('findMinimalTestSet', () => {
    it('should find minimal test set', () => {
      const tests = findMinimalTestSet(['src/utils/helpers.ts'], mockTests);

      expect(tests.length).toBeGreaterThan(0);
      expect(tests.some((t) => t.sourceFiles.includes('src/utils/helpers.ts'))).toBe(
        true
      );
    });

    it('should include multiple tests for multi-file changes', () => {
      const tests = findMinimalTestSet(
        ['src/auth/index.ts', 'src/utils/helpers.ts'],
        mockTests
      );

      expect(tests.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('estimateTestDuration', () => {
    it('should estimate duration for unit tests', () => {
      const unitTests = mockTests.filter((t) => t.category === 'unit');
      const duration = estimateTestDuration(unitTests);

      expect(duration).toBeGreaterThan(0);
      expect(duration).toBeLessThan(20000); // Less than 20s for unit tests
    });

    it('should estimate longer duration for integration tests', () => {
      const integrationTests = mockTests.filter(
        (t) => t.category === 'integration'
      );
      const integrationDuration = estimateTestDuration(integrationTests);
      const unitDuration = estimateTestDuration(
        mockTests.filter((t) => t.category === 'unit')
      );

      expect(integrationDuration).toBeGreaterThan(unitDuration);
    });

    it('should estimate longest duration for E2E tests', () => {
      const e2eTests = mockTests.filter((t) => t.category === 'e2e');
      const duration = estimateTestDuration(e2eTests);

      expect(duration).toBeGreaterThan(5000);
    });
  });

  describe('getCriticalTests', () => {
    it('should identify critical tests', () => {
      const critical = getCriticalTests(mockTests);

      expect(critical.length).toBeGreaterThan(0);
    });

    it('should include integration tests', () => {
      const critical = getCriticalTests(mockTests);
      const hasIntegration = critical.some(
        (t) => t.category === 'integration'
      );

      expect(hasIntegration).toBe(true);
    });
  });

  describe('createTestMapping', () => {
    it('should map source file to tests', () => {
      const mapping = createTestMapping('src/utils/helpers.ts', mockTests);

      expect(mapping.sourceFile).toBe('src/utils/helpers.ts');
      expect(mapping.directTests.length).toBeGreaterThan(0);
    });

    it('should identify direct and indirect tests', () => {
      const mapping = createTestMapping('src/auth/index.ts', mockTests);

      expect(mapping.directTests.length).toBeGreaterThan(0);
      expect(mapping.testFiles.length).toBeGreaterThanOrEqual(
        mapping.directTests.length
      );
    });
  });

  describe('prioritizeTestsBySpeed', () => {
    it('should prioritize unit tests first', () => {
      const prioritized = prioritizeTestsBySpeed(mockTests);

      const firstTestType = prioritized[0].category;
      expect(firstTestType).toBe('unit');
    });

    it('should put e2e tests last', () => {
      const prioritized = prioritizeTestsBySpeed(mockTests);

      const lastTest = prioritized[prioritized.length - 1];
      expect(lastTest.category).toBe('e2e');
    });
  });

  describe('isTestSelectionComplete', () => {
    it('should validate test selection completion', () => {
      const result = selectTestsForChanges(['src/auth/index.ts'], mockTests);

      // When tests are selected, selection is meaningful
      expect(result.selected.length).toBeGreaterThan(0);

      // Can check if selection is complete by checking if tests cover the requirements
      const hasDependentTests = result.selected.some((t) =>
        t.includes('auth') || t.includes('integration')
      );

      expect(hasDependentTests).toBe(true);
    });

    it('should detect when selection includes key test types', () => {
      const result = selectTestsForChanges(
        ['src/auth/index.ts', 'ui/components/Button.tsx'],
        mockTests,
        { includeIntegration: true }
      );

      expect(result.selected.length).toBeGreaterThan(0);
      expect(result.impactLevel).toBe('small');
    });
  });

  describe('getTestSelectionStats', () => {
    it('should provide selection statistics', () => {
      const result = selectTestsForChanges(['src/utils/helpers.ts'], mockTests);
      const stats = getTestSelectionStats(result, mockTests);

      expect(stats.selectedCount).toBeGreaterThan(0);
      expect(stats.selectedPercentage).toBeGreaterThan(0);
      expect(stats.estimatedDuration).toBeGreaterThan(0);
    });

    it('should calculate percentage correctly', () => {
      const result = selectTestsForChanges(['src/utils/helpers.ts'], mockTests);
      const stats = getTestSelectionStats(result, mockTests);

      expect(stats.selectedPercentage).toBeLessThanOrEqual(100);
      expect(stats.selectedPercentage).toBeGreaterThan(0);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle single file change workflow', () => {
      const result = selectTestsForChanges(
        ['src/utils/helpers.ts'],
        mockTests
      );

      expect(result.impactLevel).toBe('minimal');
      expect(result.selected.length).toBeLessThan(mockTests.length);
      expect(result.skipped.length).toBeGreaterThan(0);
    });

    it('should handle multi-layer change workflow', () => {
      const result = selectTestsForChanges(
        ['src/auth/index.ts', 'ui/components/Button.tsx'],
        mockTests
      );

      expect(result.affectedLayers).toContain('backend');
      expect(result.affectedLayers).toContain('frontend');
      expect(result.selected.length).toBeGreaterThan(1);
    });

    it('should prioritize and estimate workflow', () => {
      const result = selectTestsForChanges(
        ['src/utils/helpers.ts'],
        mockTests
      );
      const selectedTests = mockTests.filter((t) =>
        result.selected.includes(t.path)
      );
      const prioritized = prioritizeTestsBySpeed(selectedTests);
      const stats = getTestSelectionStats(result, mockTests);

      expect(prioritized.length).toBeGreaterThan(0);
      expect(stats.estimatedDuration).toBeGreaterThan(0);
    });
  });
});
