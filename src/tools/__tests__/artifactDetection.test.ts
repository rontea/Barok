/**
 * Phase 5.6: Artifact Detection Tests
 */

import {
  detectArtifacts,
  matchesPattern,
  getArtifactsByType,
  isArtifactPath,
  filterOutArtifacts,
  getDeletableArtifacts,
  getRecreateableArtifacts,
  estimateArtifactSpace,
  isSafeForAgentProcessing,
  getProtectedPaths,
  validateChangesNotInArtifacts,
  getArtifactSummary,
  generateArtifactReport,
  STANDARD_ARTIFACTS,
} from '../artifactDetection';

describe('Phase 5.6: Artifact Detection', () => {
  describe('detectArtifacts', () => {
    it('should detect build artifacts', () => {
      const files = ['src/index.ts', 'dist/main.js', 'dist/styles.css', 'tests/main.test.ts'];

      const result = detectArtifacts(files);

      expect(result.success).toBe(true);
      expect(result.artifacts.length).toBeGreaterThan(0);
      expect(result.artifacts.some((a) => a.type === 'build')).toBe(true);
      expect(result.sourceFiles).toContain('src/index.ts');
    });

    it('should detect coverage artifacts', () => {
      const files = ['coverage/index.html', 'coverage/lcov.info', 'src/index.ts'];

      const result = detectArtifacts(files);

      expect(result.artifacts.some((a) => a.type === 'coverage')).toBe(true);
      expect(result.sourceFiles).toContain('src/index.ts');
    });

    it('should detect log artifacts', () => {
      const files = ['logs/app.log', 'logs/2026-06-18T13-20-32.jsonl', 'src/app.ts'];

      const result = detectArtifacts(files);

      expect(result.artifacts.some((a) => a.type === 'logs')).toBe(true);
    });

    it('should separate artifacts from source files', () => {
      const files = [
        'src/index.ts',
        'ui/components/App.tsx',
        'dist/main.js',
        'coverage/index.html',
        'tests/app.test.ts',
      ];

      const result = detectArtifacts(files);

      expect(result.sourceFiles.length).toBeGreaterThan(0);
      expect(result.artifacts.length).toBeGreaterThan(0);
      expect(result.sourceFiles).toContain('src/index.ts');
    });

    it('should handle node_modules separately', () => {
      const files = ['node_modules/react/index.js', 'src/index.ts'];

      const result = detectArtifacts(files, { includeNodeModules: true });

      expect(
        result.artifacts.some((a) => a.type === 'node_modules')
      ).toBe(true);
    });
  });

  describe('matchesPattern', () => {
    it('should match directory patterns', () => {
      const match = matchesPattern('dist/main.js', 'dist/**');

      expect(match).toBe(true);
    });

    it('should match exact paths', () => {
      const match = matchesPattern('.eslintcache', '.eslintcache');

      expect(match).toBe(true);
    });

    it('should not match unrelated paths', () => {
      const match = matchesPattern('src/index.ts', 'dist/**');

      expect(match).toBe(false);
    });
  });

  describe('getArtifactsByType', () => {
    it('should get build artifacts', () => {
      const artifacts = getArtifactsByType('build');

      expect(artifacts.length).toBeGreaterThan(0);
      expect(artifacts.every((a) => a.type === 'build')).toBe(true);
    });

    it('should get coverage artifacts', () => {
      const artifacts = getArtifactsByType('coverage');

      expect(artifacts.length).toBeGreaterThan(0);
      expect(artifacts.every((a) => a.type === 'coverage')).toBe(true);
    });

    it('should get log artifacts', () => {
      const artifacts = getArtifactsByType('logs');

      expect(artifacts.length).toBeGreaterThan(0);
    });
  });

  describe('isArtifactPath', () => {
    it('should identify build artifacts', () => {
      expect(isArtifactPath('dist/main.js')).toBe(true);
      expect(isArtifactPath('build/index.js')).toBe(true);
      expect(isArtifactPath('out/file.js')).toBe(true);
    });

    it('should identify coverage artifacts', () => {
      expect(isArtifactPath('coverage/index.html')).toBe(true);
      expect(isArtifactPath('.nyc_output/file')).toBe(true);
    });

    it('should identify log artifacts', () => {
      expect(isArtifactPath('logs/app.log')).toBe(true);
    });

    it('should not identify source files', () => {
      expect(isArtifactPath('src/index.ts')).toBe(false);
      expect(isArtifactPath('ui/components/App.tsx')).toBe(false);
      expect(isArtifactPath('tests/app.test.ts')).toBe(false);
    });
  });

  describe('filterOutArtifacts', () => {
    it('should remove artifacts', () => {
      const files = ['src/index.ts', 'dist/main.js', 'ui/App.tsx', 'coverage/index.html'];

      const filtered = filterOutArtifacts(files);

      expect(filtered).toContain('src/index.ts');
      expect(filtered).toContain('ui/App.tsx');
      expect(filtered).not.toContain('dist/main.js');
      expect(filtered).not.toContain('coverage/index.html');
    });
  });

  describe('getDeletableArtifacts', () => {
    it('should return safe-to-delete artifacts', () => {
      const deletable = getDeletableArtifacts();

      expect(deletable.length).toBeGreaterThan(0);
      expect(deletable.every((a) => a.safeToDelete)).toBe(true);
    });
  });

  describe('getRecreateableArtifacts', () => {
    it('should return recreatable artifacts', () => {
      const recreatable = getRecreateableArtifacts();

      expect(recreatable.length).toBeGreaterThan(0);
      expect(recreatable.some((a) => a.type === 'build')).toBe(true);
      expect(recreatable.some((a) => a.type === 'coverage')).toBe(true);
    });

    it('should distinguish recreatable from non-recreatable artifacts', () => {
      const recreatable = getRecreateableArtifacts();
      const nonRecreatable = STANDARD_ARTIFACTS.filter((a) => !a.recreatable);

      expect(recreatable.length).toBeGreaterThan(0);
      expect(nonRecreatable.length).toBeGreaterThan(0);
      expect(recreatable.some((a) => a.type === 'build')).toBe(true);
      expect(recreatable.some((a) => a.type === 'coverage')).toBe(true);
    });
  });

  describe('estimateArtifactSpace', () => {
    it('should estimate space for artifacts', () => {
      const result = estimateArtifactSpace(getArtifactsByType('build'));

      expect(result.type).toBe('artifacts');
      expect(result.estimatedSizeMB).toBeGreaterThan(0);
    });

    it('should estimate higher space for multiple artifacts', () => {
      const single = estimateArtifactSpace(getArtifactsByType('build'));
      const multiple = estimateArtifactSpace([
        ...getArtifactsByType('build'),
        ...getArtifactsByType('coverage'),
      ]);

      expect(multiple.estimatedSizeMB).toBeGreaterThanOrEqual(single.estimatedSizeMB);
    });
  });

  describe('isSafeForAgentProcessing', () => {
    it('should allow source file processing', () => {
      expect(isSafeForAgentProcessing('src/index.ts')).toBe(true);
      expect(isSafeForAgentProcessing('ui/components/App.tsx')).toBe(true);
    });

    it('should prevent artifact processing', () => {
      expect(isSafeForAgentProcessing('dist/main.js')).toBe(false);
      expect(isSafeForAgentProcessing('coverage/index.html')).toBe(false);
      expect(isSafeForAgentProcessing('logs/app.log')).toBe(false);
    });
  });

  describe('getProtectedPaths', () => {
    it('should return protected paths', () => {
      const protected_paths = getProtectedPaths();

      expect(protected_paths.length).toBeGreaterThan(0);
      expect(protected_paths).toContain('node_modules/**');
      expect(protected_paths).toContain('.git/**');
    });
  });

  describe('validateChangesNotInArtifacts', () => {
    it('should allow changes to source files', () => {
      const result = validateChangesNotInArtifacts(['src/index.ts', 'ui/App.tsx']);

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should prevent changes to artifacts', () => {
      const result = validateChangesNotInArtifacts(['dist/main.js']);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect mixed valid/invalid changes', () => {
      const result = validateChangesNotInArtifacts([
        'src/index.ts',
        'dist/main.js',
      ]);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('dist'))).toBe(true);
    });
  });

  describe('getArtifactSummary', () => {
    it('should provide summary', () => {
      const summary = getArtifactSummary();

      expect(summary.total).toBeGreaterThan(0);
      expect(summary.byType).toHaveProperty('build');
      expect(summary.byType).toHaveProperty('coverage');
      expect(summary.safe_to_delete).toBeGreaterThan(0);
    });
  });

  describe('generateArtifactReport', () => {
    it('should generate report', () => {
      const files = ['src/index.ts', 'dist/main.js', 'coverage/index.html'];
      const detection = detectArtifacts(files);
      const report = generateArtifactReport(detection);

      expect(report).toContain('# Generated Artifacts Report');
      expect(report).toContain('Summary');
      expect(report.length).toBeGreaterThan(0);
    });

    it('should include artifact details', () => {
      const files = ['dist/main.js'];
      const detection = detectArtifacts(files);
      const report = generateArtifactReport(detection);

      expect(report).toContain('Artifacts Found');
      expect(report).toContain('build');
    });
  });

  describe('Integration scenarios', () => {
    it('should detect and filter artifacts', () => {
      const files = [
        'src/index.ts',
        'ui/App.tsx',
        'dist/main.js',
        'coverage/index.html',
        'logs/app.log',
        'tests/app.test.ts',
      ];

      const result = detectArtifacts(files);

      expect(result.sourceFiles.length).toBe(3);
      expect(result.artifacts.length).toBeGreaterThan(0);
      expect(result.sourceFiles).toContain('src/index.ts');
      expect(result.sourceFiles).not.toContain('dist/main.js');
    });

    it('should validate changes and prevent artifact edits', () => {
      const sourceChanges = ['src/index.ts', 'ui/App.tsx'];
      const validation = validateChangesNotInArtifacts(sourceChanges);

      expect(validation.valid).toBe(true);
    });

    it('should provide cleanup guidance', () => {
      const files = ['dist/main.js', 'coverage/index.html', 'src/index.ts'];
      const detection = detectArtifacts(files);
      const deletable = getDeletableArtifacts();

      expect(deletable.length).toBeGreaterThan(0);
      expect(detection.artifacts.length).toBeGreaterThan(0);
    });
  });

  describe('Standard artifacts', () => {
    it('should have build artifacts defined', () => {
      const buildArtifacts = STANDARD_ARTIFACTS.filter(
        (a) => a.type === 'build'
      );

      expect(buildArtifacts.length).toBeGreaterThan(0);
      expect(buildArtifacts.some((a) => a.path === 'dist')).toBe(true);
    });

    it('should mark artifacts as safe/recreatable appropriately', () => {
      for (const artifact of STANDARD_ARTIFACTS) {
        expect(artifact.safeToDelete).toBeDefined();
        expect(artifact.recreatable).toBeDefined();
      }
    });
  });
});
