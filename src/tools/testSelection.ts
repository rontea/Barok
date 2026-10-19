/**
 * Phase 5.5: Dependency-Aware Test Selection
 * Select focused tests for small changes, broader suites for large changes
 */

/**
 * Represents a test file with its dependencies
 */
export interface TestFile {
  path: string; // e.g., 'src/utils/__tests__/helpers.test.ts'
  sourceFiles: string[]; // Files this test covers
  dependencies: string[]; // Test dependencies (imports, fixtures)
  category: TestCategory; // unit | integration | e2e | smoke
  relatedTests?: string[]; // Other tests that may be affected
  coverage?: string[]; // Files covered by this test
}

export type TestCategory = 'unit' | 'integration' | 'e2e' | 'smoke';

/**
 * Result of test selection
 */
export interface TestSelectionResult {
  selected: string[]; // Selected test files to run
  skipped: string[]; // Tests that can be skipped
  reason: string; // Why these tests were selected
  affectedLayers: string[]; // Layers affected by changes
  impactLevel: 'minimal' | 'small' | 'medium' | 'large'; // Impact assessment
}

/**
 * Configuration for test selection
 */
export interface TestSelectionConfig {
  includeIntegration?: boolean; // Include integration tests
  includeE2E?: boolean; // Include E2E tests
  maxTestCount?: number; // Maximum tests to run
  minCoverage?: number; // Minimum coverage % required
}

/**
 * Mapping of source files to their test files
 */
export interface TestMapping {
  sourceFile: string;
  testFiles: TestFile[];
  directTests: TestFile[]; // Direct test file (e.g., helpers.test.ts)
  indirectTests: TestFile[]; // Tests affected through dependencies
}

/**
 * Select tests based on changed files
 */
export function selectTestsForChanges(
  changedFiles: string[],
  allTests: TestFile[],
  config?: TestSelectionConfig
): TestSelectionResult {
  const selected = new Set<string>();
  const skipped = new Set<string>();
  const affectedLayers = new Set<string>();
  let impactLevel: 'minimal' | 'small' | 'medium' | 'large' = 'minimal';

  // Find directly affected tests
  for (const changedFile of changedFiles) {
    for (const test of allTests) {
      // Direct coverage
      if (test.sourceFiles?.includes(changedFile)) {
        selected.add(test.path);
      }

      // Through dependencies
      if (test.dependencies?.includes(changedFile)) {
        selected.add(test.path);
      }
    }
  }

  // Determine impact level
  const changeCount = changedFiles.length;
  if (changeCount === 1) {
    impactLevel = 'minimal';
  } else if (changeCount <= 3) {
    impactLevel = 'small';
  } else if (changeCount <= 10) {
    impactLevel = 'medium';
  } else {
    impactLevel = 'large';
  }

  // Add integration tests for medium/large changes
  if (impactLevel === 'medium' || impactLevel === 'large') {
    if (config?.includeIntegration !== false) {
      for (const test of allTests) {
        if (test.category === 'integration') {
          selected.add(test.path);
        }
      }
    }
  }

  // Add E2E tests for large changes
  if (impactLevel === 'large' && config?.includeE2E !== false) {
    for (const test of allTests) {
      if (test.category === 'e2e') {
        selected.add(test.path);
      }
    }
  }

  // Find unaffected tests to skip
  for (const test of allTests) {
    if (!selected.has(test.path)) {
      skipped.add(test.path);
    }
  }

  // Determine affected layers
  for (const file of changedFiles) {
    if (file.includes('ui/') || file.includes('react/')) {
      affectedLayers.add('frontend');
    }
    if (file.includes('src/') && !file.includes('ui/')) {
      affectedLayers.add('backend');
    }
    if (file.includes('tests/')) {
      affectedLayers.add('tests');
    }
    if (file.includes('docs/')) {
      affectedLayers.add('docs');
    }
  }

  const reason = formatSelectionReason(changeCount, impactLevel, selected.size);

  return {
    selected: Array.from(selected).sort(),
    skipped: Array.from(skipped).sort(),
    reason,
    affectedLayers: Array.from(affectedLayers),
    impactLevel,
  };
}

/**
 * Build test dependency graph
 */
export function buildTestDependencyGraph(tests: TestFile[]): Map<string, TestFile[]> {
  const graph = new Map<string, TestFile[]>();

  for (const test of tests) {
    // Find tests that depend on this test
    const dependents: TestFile[] = [];
    for (const other of tests) {
      if (other.path !== test.path && other.dependencies?.includes(test.path)) {
        dependents.push(other);
      }
    }
    graph.set(test.path, dependents);
  }

  return graph;
}

/**
 * Get transitive test dependencies
 */
export function getTransitiveDependencies(
  testPath: string,
  graph: Map<string, TestFile[]>
): Set<string> {
  const visited = new Set<string>();
  const stack = [testPath];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;

    visited.add(current);
    const deps = graph.get(current) || [];

    for (const dep of deps) {
      if (!visited.has(dep.path)) {
        stack.push(dep.path);
      }
    }
  }

  return visited;
}

/**
 * Find minimal test set for changes
 */
export function findMinimalTestSet(
  changedFiles: string[],
  allTests: TestFile[]
): TestFile[] {
  const selected = new Set<TestFile>();

  for (const changedFile of changedFiles) {
    for (const test of allTests) {
      // Direct match
      if (test.sourceFiles?.includes(changedFile)) {
        selected.add(test);
      } else if (test.coverage?.includes(changedFile)) {
        selected.add(test);
      }
    }
  }

  return Array.from(selected);
}

/**
 * Estimate test run time
 */
export function estimateTestDuration(tests: TestFile[]): number {
  let totalTime = 0;

  for (const test of tests) {
    // Estimate based on category
    switch (test.category) {
      case 'unit':
        totalTime += 1000; // 1s per unit test
        break;
      case 'integration':
        totalTime += 5000; // 5s per integration test
        break;
      case 'e2e':
        totalTime += 15000; // 15s per E2E test
        break;
      case 'smoke':
        totalTime += 3000; // 3s per smoke test
        break;
    }
  }

  return totalTime;
}

/**
 * Get critical tests that must always run
 */
export function getCriticalTests(allTests: TestFile[]): TestFile[] {
  return allTests.filter((t) => {
    // Tests marked as critical
    const path = t.path.toLowerCase();
    return (
      path.includes('critical') ||
      path.includes('essential') ||
      path.includes('core') ||
      t.category === 'integration'
    );
  });
}

/**
 * Format selection reason
 */
export function formatSelectionReason(
  changeCount: number,
  impactLevel: string,
  testCount: number
): string {
  const impacts: Record<string, string> = {
    minimal: `Small change (${changeCount} file(s)) - running focused tests only`,
    small: `Small changes (${changeCount} files) - running affected unit and integration tests`,
    medium: `Medium changes (${changeCount} files) - running full test suite`,
    large: `Large changes (${changeCount} files) - running full suite including E2E tests`,
  };

  return `${impacts[impactLevel]} (${testCount} tests selected)`;
}

/**
 * Create test file mapping
 */
export function createTestMapping(
  sourceFile: string,
  allTests: TestFile[]
): TestMapping {
  const directTests: TestFile[] = [];
  const indirectTests: TestFile[] = [];

  for (const test of allTests) {
    if (test.sourceFiles?.includes(sourceFile)) {
      directTests.push(test);
    } else if (test.dependencies?.includes(sourceFile)) {
      indirectTests.push(test);
    }
  }

  return {
    sourceFile,
    testFiles: [...directTests, ...indirectTests],
    directTests,
    indirectTests,
  };
}

/**
 * Prioritize tests by speed
 */
export function prioritizeTestsBySpeed(tests: TestFile[]): TestFile[] {
  const categoryPriority: Record<TestCategory, number> = {
    unit: 1,
    smoke: 2,
    integration: 3,
    e2e: 4,
  };

  return [...tests].sort(
    (a, b) => categoryPriority[a.category] - categoryPriority[b.category]
  );
}

/**
 * Check if test selection is complete
 */
export function isTestSelectionComplete(
  selection: TestSelectionResult,
  requiredCoverage: string[]
): boolean {
  // All required files must have tests selected
  for (const required of requiredCoverage) {
    const hasCoverage = selection.selected.some((test) => test.includes(required));
    if (!hasCoverage) {
      return false;
    }
  }

  return true;
}

/**
 * Get test selection statistics
 */
export function getTestSelectionStats(
  selection: TestSelectionResult,
  allTests: TestFile[]
): {
  selectedCount: number;
  skippedCount: number;
  selectedPercentage: number;
  estimatedDuration: number;
} {
  const selectedTests = allTests.filter((t) => selection.selected.includes(t.path));
  const selectedCount = selectedTests.length;
  const skippedCount = selection.skipped.length;
  const selectedPercentage = allTests.length > 0 ? (selectedCount / allTests.length) * 100 : 0;
  const estimatedDuration = estimateTestDuration(selectedTests);

  return {
    selectedCount,
    skippedCount,
    selectedPercentage,
    estimatedDuration,
  };
}
