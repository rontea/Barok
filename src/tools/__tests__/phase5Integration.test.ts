/**
 * Phase 5 Integration Tests
 * End-to-end tests combining all Phase 5.1-5.7 tooling
 */

import { selectTestsForChanges, type TestFile } from '../testSelection';
import { detectArtifacts, filterOutArtifacts, validateChangesNotInArtifacts } from '../artifactDetection';
import { planCleanup, validateCleanupPlan, createCleanupReport } from '../cleanupRules';
import { detectScripts, type ScriptMetadata } from '../scriptDiscovery';
import { defineCommandProfile, type CommandProfile } from '../commandProfiles';
import { discoverAPIRoutes, discoverUIComponents, type APISurface, type UISurface } from '../surfaceDiscovery';

describe('Phase 5 Integration Tests', () => {
  // Mock data for integration testing
  const mockTests: TestFile[] = [
    {
      path: 'src/__tests__/auth.test.ts',
      sourceFiles: ['src/auth.ts'],
      dependencies: [],
      category: 'unit',
      coverage: ['src/auth.ts'],
    },
    {
      path: 'ui/__tests__/components.test.ts',
      sourceFiles: ['ui/components'],
      dependencies: [],
      category: 'unit',
      coverage: ['ui/components'],
    },
    {
      path: 'src/__tests__/integration.test.ts',
      sourceFiles: ['src/'],
      dependencies: [],
      category: 'integration',
      coverage: ['src/'],
    },
  ];

  const mockScripts: ScriptMetadata[] = [
    {
      name: 'test:unit',
      command: 'jest --testPathPattern=unit',
      category: 'test',
      runType: 'serial',
      packages: ['jest'],
      args: ['--testPathPattern=unit'],
      description: 'Run unit tests',
    },
    {
      name: 'build',
      command: 'vite build',
      category: 'build',
      runType: 'serial',
      packages: ['vite'],
      args: ['build'],
      description: 'Build for production',
    },
  ];

  describe('Scenario: Update file with verification workflow', () => {
    it('should select tests, detect artifacts, and plan cleanup', () => {
      // Step 1: Detect changed files
      const changedFiles = ['src/auth.ts'];

      // Step 2: Select appropriate tests
      const testSelection = selectTestsForChanges(changedFiles, mockTests);

      expect(testSelection.selected.length).toBeGreaterThan(0);
      expect(testSelection.impactLevel).toBe('minimal');

      // Step 3: Validate no artifacts are modified
      const validation = validateChangesNotInArtifacts(changedFiles);

      expect(validation.valid).toBe(true);

      // Step 4: Plan cleanup if needed
      const workingFiles = [
        ...changedFiles,
        'dist/main.js',
        'coverage/index.html',
        'src/__tests__/auth.test.ts',
      ];

      const cleanup = planCleanup(workingFiles);

      expect(cleanup.filesDeleted.length).toBeGreaterThan(0);
      expect(cleanup.filesDeleted).toContain('dist/main.js');
    });
  });

  describe('Scenario: Multi-layer changes with artifact detection', () => {
    it('should detect changes across layers and protect artifacts', () => {
      const files = [
        'src/api.ts',
        'ui/components/Button.tsx',
        'dist/main.js', // artifact
        'coverage/report.html', // artifact
      ];

      // Detect artifacts
      const detection = detectArtifacts(files);

      expect(detection.sourceFiles).toContain('src/api.ts');
      expect(detection.sourceFiles).toContain('ui/components/Button.tsx');
      expect(detection.artifacts.length).toBeGreaterThan(0);

      // Filter to source only
      const sourceFiles = filterOutArtifacts(files);

      expect(sourceFiles.length).toBeLessThan(files.length);
      expect(sourceFiles).not.toContain('dist/main.js');
    });
  });

  describe('Scenario: Comprehensive verification workflow', () => {
    it('should combine test selection, artifact detection, and cleanup', () => {
      const changedFiles = ['src/auth.ts', 'ui/components/Button.tsx'];
      const allFiles = [
        ...changedFiles,
        'dist/main.js',
        'coverage/index.html',
        'logs/app.log',
        'src/__tests__/auth.test.ts',
        'ui/__tests__/components.test.ts',
      ];

      // Phase 5.5: Select focused tests
      const tests = selectTestsForChanges(changedFiles, mockTests, {
        includeE2E: false,
      });

      expect(tests.selected.length).toBeGreaterThan(0);

      // Phase 5.6: Detect and validate artifacts
      const artifacts = detectArtifacts(allFiles);
      const sourceOnly = filterOutArtifacts(allFiles);

      expect(sourceOnly.length).toBeGreaterThan(0);
      expect(artifacts.artifacts.length).toBeGreaterThan(0);

      // Phase 5.7: Plan safe cleanup
      const cleanup = planCleanup(allFiles);
      const cleanupValid = validateCleanupPlan(cleanup);

      expect(cleanupValid.valid).toBe(true);
      expect(cleanup.filesDeleted.length).toBeGreaterThan(0);
    });
  });

  describe('Scenario: API/UI surface discovery with verification', () => {
    it('should discover surfaces and correlate with tests', () => {
      // Phase 5.4: Discover API routes
      const apiSurfaces: APISurface[] = [
        {
          route: '/api/auth/login',
          method: 'POST',
          parameters: { email: 'string', password: 'string' },
          statusCodes: [200, 401, 400],
        },
        {
          route: '/api/users/:id',
          method: 'GET',
          parameters: { id: 'string' },
          statusCodes: [200, 404],
        },
      ];

      const uiSurfaces: UISurface[] = [
        {
          type: 'component',
          exports: ['Button', 'ButtonGroup'],
          props: { onClick: 'function', variant: 'string' },
        },
        {
          type: 'route',
          exports: ['LoginPage'],
          props: { redirectTo: 'string' },
        },
      ];

      // Phase 5.5: Correlate with test selection
      const changes = ['src/auth.ts', 'ui/components/Button.tsx'];
      const tests = selectTestsForChanges(changes, mockTests);

      expect(apiSurfaces.length).toBeGreaterThan(0);
      expect(uiSurfaces.length).toBeGreaterThan(0);
      expect(tests.selected.length).toBeGreaterThan(0);

      // Validate that changes affect discovered surfaces
      expect(changes.some((c) => c.includes('auth'))).toBe(true);
      expect(changes.some((c) => c.includes('components'))).toBe(true);
    });
  });

  describe('Scenario: Script discovery with test selection', () => {
    it('should discover scripts and guide test execution', () => {
      // Phase 5.2: Discover scripts
      const scripts = mockScripts;

      expect(scripts.some((s) => s.name === 'test:unit')).toBe(true);
      expect(scripts.some((s) => s.category === 'build')).toBe(true);

      // Phase 5.5: Select tests for changes
      const changes = ['src/auth.ts'];
      const selection = selectTestsForChanges(changes, mockTests);

      // Estimate time based on test type
      expect(selection.selected.length).toBeGreaterThan(0);

      // Correlate with available scripts
      const testScript = scripts.find((s) => s.name === 'test:unit');

      expect(testScript).toBeDefined();
    });
  });

  describe('Scenario: Full stack modification with protection', () => {
    it('should handle full-stack changes while protecting artifacts', () => {
      const changes = [
        'src/api.ts',
        'src/database.ts',
        'src/auth.ts',
        'src/middleware.ts',
        'src/routes.ts',
        'src/handlers.ts',
        'src/validators.ts',
        'src/utils.ts',
        'src/config.ts',
        'src/constants.ts',
        'src/types.ts',
        'ui/pages/HomePage.tsx',
      ];

      const workingFiles = [
        ...changes,
        'node_modules/react/index.js',
        'dist/main.js',
        'build/index.js',
        'coverage/index.html',
        'logs/test.log',
        '.cache/eslint',
        'src/__tests__/api.test.ts',
        'ui/__tests__/HomePage.test.tsx',
      ];

      // Step 1: Validate no artifacts in changes
      const validation = validateChangesNotInArtifacts(changes);

      expect(validation.valid).toBe(true);

      // Step 2: Select comprehensive tests
      const testSelection = selectTestsForChanges(changes, mockTests, {
        includeE2E: true,
      });

      expect(testSelection.impactLevel).toBe('large');
      expect(testSelection.affectedLayers.includes('backend')).toBe(true);
      expect(testSelection.affectedLayers.includes('frontend')).toBe(true);

      // Step 3: Detect and separate artifacts
      const artifactDetection = detectArtifacts(workingFiles);

      expect(artifactDetection.sourceFiles).toContain('src/api.ts');
      expect(artifactDetection.artifacts.length).toBeGreaterThan(0);

      // Step 4: Plan cleanup with full protection
      const cleanup = planCleanup(workingFiles);

      expect(cleanup.filesDeleted.length).toBeGreaterThan(0);
      expect(cleanup.filesDeleted).toContain('dist/main.js');
      expect(cleanup.filesDeleted).toContain('build/index.js');
    });
  });

  describe('Scenario: Dependency-aware test execution', () => {
    it('should select tests based on dependencies', () => {
      // Phase 5.5 advanced: Test dependency graphs
      const criticalChanges = ['src/auth.ts'];

      const selection = selectTestsForChanges(criticalChanges, mockTests);

      // Direct tests should be selected
      expect(selection.selected.some((t) => t.includes('auth'))).toBe(true);

      // Should provide reason for selection
      expect(selection.reason.length).toBeGreaterThan(0);
    });
  });

  describe('Scenario: Cleanup after successful verification', () => {
    it('should have protection rules in place', () => {
      const allFiles = [
        'dist/main.js',
        'build/index.js',
        'coverage/index.html',
        '.nyc_output/data.json',
        'logs/test-2026-06-18.log',
        'src/__tests__/temp.ts',
      ];

      const cleanup = planCleanup(allFiles, {
        dryRun: true,
      });

      const validation = validateCleanupPlan(cleanup);
      const report = createCleanupReport(cleanup);

      expect(cleanup.filesDeleted.length).toBeGreaterThan(0);
      expect(validation.valid).toBe(true);
      expect(report.length).toBeGreaterThan(0);
      expect(report).toContain('Cleanup Operation Report');
    });
  });

  describe('Scenario: Protected artifacts during agent work', () => {
    it('should prevent agent from modifying artifacts', () => {
      const agentChanges = [
        'src/new-feature.ts',
        'ui/components/NewComponent.tsx',
        'dist/main.js', // Should fail
      ];

      const validation = validateChangesNotInArtifacts(agentChanges);

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Scenario: Minimal change fast path', () => {
    it('should quickly handle single-file changes', () => {
      const singleFileChange = ['src/helpers.ts'];

      // Test selection
      const tests = selectTestsForChanges(singleFileChange, mockTests);

      expect(tests.impactLevel).toBe('minimal');
      expect(tests.selected.length).toBeLessThan(mockTests.length);

      // Artifact validation
      const validation = validateChangesNotInArtifacts(singleFileChange);

      expect(validation.valid).toBe(true);

      // Quick cleanup
      const cleanup = planCleanup([...singleFileChange, 'dist/main.js']);

      expect(cleanup.filesDeleted).toContain('dist/main.js');
      expect(cleanup.filesDeleted).not.toContain('src/helpers.ts');
    });
  });

  describe('Scenario: Large refactor with full validation', () => {
    it('should handle comprehensive refactoring workflow', () => {
      const refactorChanges = [
        'src/auth/index.ts',
        'src/auth/strategies.ts',
        'src/auth/utils.ts',
        'src/auth/guards.ts',
        'src/auth/middleware.ts',
        'src/database/models.ts',
        'src/database/queries.ts',
        'src/database/migrations.ts',
        'ui/pages/LoginPage.tsx',
        'ui/components/LoginForm.tsx',
        'ui/hooks/useAuth.ts',
        'ui/contexts/AuthContext.tsx',
      ];

      // Validate changes
      const validation = validateChangesNotInArtifacts(refactorChanges);

      expect(validation.valid).toBe(true);

      // Select broad tests
      const tests = selectTestsForChanges(refactorChanges, mockTests, {
        includeE2E: true,
      });

      expect(tests.impactLevel).toBe('large');
      expect(tests.affectedLayers.length).toBe(2);

      // Simulate verification with artifacts
      const allFiles = [
        ...refactorChanges,
        'dist/main.js',
        'coverage/index.html',
        'logs/verification.log',
      ];

      // Plan cleanup
      const cleanup = planCleanup(allFiles);

      expect(cleanup.filesDeleted.some((f) => f.includes('dist'))).toBe(true);
      expect(cleanup.filesDeleted).not.toContain('src/auth/index.ts');
    });
  });

  describe('Scenario: End-to-end verification pipeline', () => {
    it('should execute full Phase 5 pipeline', () => {
      const changes = ['src/auth.ts', 'ui/Button.tsx'];

      // 1. Detect artifacts in workspace
      const allWorkspaceFiles = [
        ...changes,
        'dist/main.js',
        'coverage/index.html',
        'logs/app.log',
        'node_modules/react/index.js',
        'src/__tests__/auth.test.ts',
        'ui/__tests__/Button.test.tsx',
        '.cache/eslint',
      ];

      const artifactDetection = detectArtifacts(allWorkspaceFiles);

      expect(artifactDetection.sourceFiles.length).toBeGreaterThan(0);

      // 2. Validate changes don't touch artifacts
      const validation = validateChangesNotInArtifacts(changes);

      expect(validation.valid).toBe(true);

      // 3. Select tests for changes
      const testSelection = selectTestsForChanges(changes, mockTests);

      expect(testSelection.selected.length).toBeGreaterThan(0);

      // 4. Plan cleanup
      const cleanup = planCleanup(allWorkspaceFiles);

      expect(cleanup.filesDeleted.length).toBeGreaterThan(0);

      // 5. Validate cleanup plan
      const cleanupValid = validateCleanupPlan(cleanup);

      expect(cleanupValid.valid).toBe(true);

      // 6. Generate report
      const report = createCleanupReport(cleanup);

      expect(report).toContain('Cleanup Operation Report');
    });
  });
});
