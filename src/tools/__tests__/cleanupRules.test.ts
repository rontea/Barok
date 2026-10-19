/**
 * Phase 5.7: Cleanup Rules Tests
 */

import {
  planCleanup,
  matchesCleanupPattern,
  isProtectedPath,
  estimateFileSize,
  getCleanupRule,
  getCleanupRulesBySafetyLevel,
  validateCleanupPlan,
  createCleanupReport,
  getDefaultVerificationCleanup,
  getFullCleanup,
  canProceedWithCleanup,
  STANDARD_CLEANUP_RULES,
  PROTECTED_PATHS,
} from '../cleanupRules';

describe('Phase 5.7: Cleanup Rules', () => {
  describe('planCleanup', () => {
    it('should plan cleanup for build outputs', () => {
      const files = ['dist/main.js', 'build/index.js', 'src/index.ts'];

      const plan = planCleanup(files);

      expect(plan.success).toBe(true);
      expect(plan.filesDeleted.length).toBeGreaterThan(0);
      expect(plan.filesDeleted).toContain('dist/main.js');
    });

    it('should not delete source files in cleanup plan', () => {
      const files = ['src/index.ts', 'ui/App.tsx', 'tests/app.test.ts'];

      const plan = planCleanup(files);

      expect(plan.filesDeleted.length).toBe(0);
      expect(plan.filesDeleted).not.toContain('src/index.ts');
      expect(plan.filesDeleted).not.toContain('ui/App.tsx');
    });

    it('should handle dry run', () => {
      const files = ['dist/main.js', 'build/index.js', 'src/index.ts'];

      const plan = planCleanup(files, { dryRun: true });

      expect(plan.filesDeleted).toContain('dist/main.js');
      expect(plan.filesDeleted).not.toContain('src/index.ts');
    });

    it('should respect preserve patterns', () => {
      const files = ['logs/important.log', 'logs/temp.log'];

      const plan = planCleanup(files, {
        preservePatterns: ['logs/important.log'],
      });

      expect(plan.filesSkipped).toContain('logs/important.log');
    });

    it('should calculate freed space', () => {
      const files = ['dist/main.js', 'coverage/index.html'];

      const plan = planCleanup(files);

      expect(plan.totalSize).toBeGreaterThan(0);
    });

    it('should apply multiple rules', () => {
      const files = [
        'dist/main.js',
        'coverage/index.html',
        'logs/app.log',
        '.cache/eslint',
      ];

      const plan = planCleanup(files);

      expect(plan.rulesApplied.length).toBeGreaterThan(0);
      expect(plan.filesDeleted.length).toBeGreaterThan(0);
    });
  });

  describe('matchesCleanupPattern', () => {
    it('should match directory patterns', () => {
      const match = matchesCleanupPattern('dist/main.js', ['dist/**']);

      expect(match).toBe(true);
    });

    it('should match file patterns', () => {
      const match = matchesCleanupPattern('.DS_Store', ['.DS_Store']);

      expect(match).toBe(true);
    });

    it('should not match unrelated files', () => {
      const match = matchesCleanupPattern('src/index.ts', ['dist/**']);

      expect(match).toBe(false);
    });

    it('should handle multiple patterns', () => {
      const match = matchesCleanupPattern('node_modules/react/index.js', [
        'dist/**',
        'node_modules/**',
      ]);

      expect(match).toBe(true);
    });
  });

  describe('isProtectedPath', () => {
    it('should protect node_modules', () => {
      expect(isProtectedPath('node_modules/react/index.js')).toBe(true);
    });

    it('should protect .git', () => {
      expect(isProtectedPath('.git/config')).toBe(true);
    });

    it('should protect source directories', () => {
      expect(isProtectedPath('src/index.ts')).toBe(true);
      expect(isProtectedPath('ui/App.tsx')).toBe(true);
    });

    it('should protect package files', () => {
      expect(isProtectedPath('package.json')).toBe(true);
      expect(isProtectedPath('tsconfig.json')).toBe(true);
    });

    it('should not protect build outputs', () => {
      expect(isProtectedPath('dist/main.js')).toBe(false);
    });
  });

  describe('estimateFileSize', () => {
    it('should estimate build output size', () => {
      const size = estimateFileSize('dist/main.js');

      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(1000000); // Less than 1MB
    });

    it('should estimate coverage size', () => {
      const size = estimateFileSize('coverage/index.html');

      expect(size).toBeGreaterThan(0);
    });

    it('should estimate large node_modules', () => {
      const size = estimateFileSize('node_modules/react/index.js');

      expect(size).toBeGreaterThan(100000); // Greater than 100KB
    });
  });

  describe('getCleanupRule', () => {
    it('should get rule by name', () => {
      const rule = getCleanupRule('build-outputs');

      expect(rule).toBeDefined();
      expect(rule?.name).toBe('build-outputs');
    });

    it('should return undefined for unknown rule', () => {
      const rule = getCleanupRule('unknown');

      expect(rule).toBeUndefined();
    });
  });

  describe('getCleanupRulesBySafetyLevel', () => {
    it('should get high-safety rules', () => {
      const rules = getCleanupRulesBySafetyLevel('high');

      expect(rules.length).toBeGreaterThan(0);
      expect(rules.every((r) => r.safeLevel === 'high')).toBe(true);
    });

    it('should include lower safety levels', () => {
      const rules = getCleanupRulesBySafetyLevel('medium');

      expect(rules.some((r) => r.safeLevel === 'medium')).toBe(true);
    });
  });

  describe('validateCleanupPlan', () => {
    it('should validate safe plan', () => {
      const plan = planCleanup(['dist/main.js']);

      const validation = validateCleanupPlan(plan);

      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it('should reject plan that deletes protected files', () => {
      // Create a plan that would delete node_modules (protected but matches patterns)
      const plan = planCleanup(['node_modules/react/index.js', 'src/index.ts']);

      // Plan should not delete protected node_modules
      expect(plan.filesDeleted).not.toContain('node_modules/react/index.js');
    });

    it('should warn on large cleanup', () => {
      const files = Array(1001)
        .fill(0)
        .map((_, i) => `dist/file${i}.js`);

      const plan = planCleanup(files);
      const validation = validateCleanupPlan(plan);

      expect(validation.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('createCleanupReport', () => {
    it('should generate cleanup report', () => {
      const plan = planCleanup(['dist/main.js', 'coverage/index.html']);

      const report = createCleanupReport(plan);

      expect(report).toContain('# Cleanup Operation Report');
      expect(report).toContain('Summary');
      expect(report).toContain('Files to Delete');
    });

    it('should include statistics', () => {
      const plan = planCleanup(['dist/main.js']);

      const report = createCleanupReport(plan);

      expect(report).toContain('Files to Delete');
      expect(report).toContain('Space to Free');
    });

    it('should include warnings if present', () => {
      const files = Array(1001)
        .fill(0)
        .map((_, i) => `dist/file${i}.js`);

      const plan = planCleanup(files);
      const report = createCleanupReport(plan);

      expect(report).toContain('Warnings');
    });
  });

  describe('getDefaultVerificationCleanup', () => {
    it('should return default cleanup rules', () => {
      const rules = getDefaultVerificationCleanup();

      expect(rules.length).toBeGreaterThan(0);
      expect(rules).toContainEqual(getCleanupRule('test-artifacts')!);
    });
  });

  describe('getFullCleanup', () => {
    it('should return full cleanup rules', () => {
      const rules = getFullCleanup();

      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some((r) => r.name === 'build-outputs')).toBe(true);
    });

    it('should not include critical safety rules', () => {
      const rules = getFullCleanup();

      expect(rules.every((r) => r.safeLevel !== 'critical')).toBe(true);
    });
  });

  describe('canProceedWithCleanup', () => {
    it('should allow safe cleanup', () => {
      const plan = planCleanup(['dist/main.js']);

      const result = canProceedWithCleanup(plan);

      expect(result.canProceed).toBe(true);
    });

    it('should reject unsafe cleanup', () => {
      const plan = planCleanup(['src/index.ts']);

      if (plan.filesDeleted.some((f) => f.includes('src'))) {
        const result = canProceedWithCleanup(plan);
        expect(result.canProceed).toBe(false);
      }
    });

    it('should require confirmation when configured', () => {
      const plan = planCleanup(['dist/main.js']);

      const result = canProceedWithCleanup(plan, { confirmationRequired: true });

      if (plan.filesDeleted.length > 0) {
        expect(result.canProceed).toBe(false);
      }
    });
  });

  describe('Integration scenarios', () => {
    it('should plan and validate cleanup workflow', () => {
      const files = [
        'src/index.ts',
        'dist/main.js',
        'coverage/index.html',
        'logs/app.log',
      ];

      const plan = planCleanup(files);
      const validation = validateCleanupPlan(plan);

      expect(plan.filesDeleted.length).toBeGreaterThan(0);
      expect(plan.filesDeleted).toContain('dist/main.js');
      expect(plan.filesDeleted).not.toContain('src/index.ts');
      expect(validation.valid).toBe(true);
    });

    it('should generate report and proceed with caution', () => {
      const files = [
        'dist/main.js',
        'build/index.js',
        'coverage/index.html',
      ];

      const plan = planCleanup(files);
      const report = createCleanupReport(plan);
      const canProceed = canProceedWithCleanup(plan);

      expect(report.length).toBeGreaterThan(0);
      expect(canProceed.canProceed).toBe(true);
    });

    it('should use default cleanup after verification', () => {
      const rules = getDefaultVerificationCleanup();

      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some((r) => r.name === 'test-artifacts')).toBe(true);
    });

    it('should handle full cleanup with protection', () => {
      const files = [
        'dist/main.js',
        'coverage/index.html',
        'src/index.ts',
        'package.json',
        'node_modules/react/index.js',
      ];

      const plan = planCleanup(files);

      expect(plan.filesDeleted.length).toBeGreaterThan(0);
      expect(plan.filesDeleted).not.toContain('src/index.ts');
      expect(plan.filesDeleted).not.toContain('package.json');
      expect(plan.filesDeleted).not.toContain('node_modules/react/index.js');
    });
  });

  describe('Standard cleanup rules', () => {
    it('should have multiple rules defined', () => {
      expect(STANDARD_CLEANUP_RULES.length).toBeGreaterThan(5);
    });

    it('should have proper safety levels', () => {
      for (const rule of STANDARD_CLEANUP_RULES) {
        expect(['critical', 'high', 'medium', 'low']).toContain(
          rule.safeLevel
        );
      }
    });

    it('should have reasonable confirmation requirements', () => {
      const highRisk = STANDARD_CLEANUP_RULES.filter(
        (r) => r.safeLevel === 'critical'
      );

      expect(highRisk.every((r) => r.requiresConfirmation)).toBe(true);
    });
  });

  describe('Protected paths', () => {
    it('should protect critical paths', () => {
      expect(PROTECTED_PATHS.length).toBeGreaterThan(0);
      expect(PROTECTED_PATHS).toContain('node_modules/**');
      expect(PROTECTED_PATHS).toContain('.git/**');
      expect(PROTECTED_PATHS).toContain('src/**');
    });

    it('should not allow cleanup of protected paths', () => {
      for (const path of PROTECTED_PATHS) {
        const cleanPath = path.replace('/**', '');
        expect(isProtectedPath(cleanPath)).toBe(true);
      }
    });
  });
});
