/**
 * Phase 5.3: Command Profiles Tests
 * Test suite for standardized command profiles and execution
 */

import {
  defineCommandProfile,
  resolveCommand,
  createExecutionPlan,
  estimateCommandDuration,
  getCommandDependencies,
  getProfile,
  findProfilesByCategory,
  validateCommandOutput,
  createExecutionResult,
  mergeProfiles,
  getCriticalProfiles,
  getParallelizableProfiles,
  STANDARD_PROFILES,
  type CommandProfile,
  type CommandCategory,
} from '../commandProfiles';

describe('Phase 5.3: Command Profiles', () => {
  describe('defineCommandProfile', () => {
    it('should create a lint profile', () => {
      const profile = defineCommandProfile({
        name: 'custom-lint',
        command: 'eslint',
        category: 'lint',
      });

      expect(profile.name).toBe('custom-lint');
      expect(profile.command).toBe('eslint');
      expect(profile.category).toBe('lint');
      expect(profile.critical).toBe(false);
    });

    it('should create a critical test profile', () => {
      const profile = defineCommandProfile({
        name: 'critical-test',
        command: 'jest',
        category: 'test',
        critical: true,
        timeout: 180000,
      });

      expect(profile.critical).toBe(true);
      expect(profile.timeout).toBe(180000);
    });

    it('should throw on missing name', () => {
      expect(() =>
        defineCommandProfile({
          command: 'eslint',
          category: 'lint',
        } as any)
      ).toThrow('must have name');
    });

    it('should throw on missing command', () => {
      expect(() =>
        defineCommandProfile({
          name: 'test',
          category: 'lint',
        } as any)
      ).toThrow('must have name and command');
    });

    it('should use default values', () => {
      const profile = defineCommandProfile({
        name: 'test',
        command: 'echo',
      });

      expect(profile.timeout).toBe(60000);
      expect(profile.parallel).toBe(false);
      expect(profile.retryable).toBe(true);
    });
  });

  describe('resolveCommand', () => {
    it('should resolve basic command', () => {
      const profile = defineCommandProfile({
        name: 'test',
        command: 'echo',
        args: ['hello', 'world'],
      });

      const resolved = resolveCommand(profile);

      expect(resolved).toContain('echo');
      expect(resolved).toContain('hello');
      expect(resolved).toContain('world');
    });

    it('should resolve command with node_modules path', () => {
      const profile = defineCommandProfile({
        name: 'test',
        command: 'eslint',
        args: ['src/'],
      });

      const resolved = resolveCommand(profile, {
        nodeModulesPath: './node_modules/.bin',
      });

      expect(resolved).toContain('node_modules/.bin');
      expect(resolved).toContain('eslint');
    });

    it('should handle Windows platform', () => {
      const profile = defineCommandProfile({
        name: 'test',
        command: 'eslint',
      });

      const resolved = resolveCommand(profile, { platform: 'win32' });

      // Should handle Windows paths/commands
      expect(resolved).toBeTruthy();
    });

    it('uses the Windows npm launcher for the smoke profile', () => {
      expect(resolveCommand(STANDARD_PROFILES.smoke, { platform: 'win32' })).toBe('npm.cmd run smoke');
    });

    it('should build full command string', () => {
      const profile = defineCommandProfile({
        name: 'test',
        command: 'jest',
        args: ['--runInBand', '--coverage'],
      });

      const resolved = resolveCommand(profile);

      expect(resolved).toContain('jest');
      expect(resolved).toContain('--runInBand');
      expect(resolved).toContain('--coverage');
    });
  });

  describe('createExecutionPlan', () => {
    it('should create plan for lint profile', () => {
      const profile = STANDARD_PROFILES['lint'];

      const plan = createExecutionPlan(profile);

      expect(plan.profile).toBe(profile);
      expect(plan.fullCommand).toBeTruthy();
      expect(plan.environment).toBeTruthy();
      expect(plan.estimatedDuration).toBeGreaterThan(0);
    });

    it('should include dependencies', () => {
      const profile = STANDARD_PROFILES['build'];

      const plan = createExecutionPlan(profile);

      expect(plan.dependencies.length).toBeGreaterThan(0);
      // Build should depend on lint
      expect(plan.dependencies.some((d) => d.category === 'lint')).toBe(true);
    });

    it('should include environment variables', () => {
      const profile = STANDARD_PROFILES['test_unit'];

      const plan = createExecutionPlan(profile);

      expect(plan.environment.NODE_ENV).toBe('test');
    });

    it('should estimate duration', () => {
      const profile = STANDARD_PROFILES['build'];

      const plan = createExecutionPlan(profile);

      expect(plan.estimatedDuration).toBeGreaterThan(0);
      expect(plan.estimatedDuration).toBeLessThanOrEqual(90000);
    });
  });

  describe('estimateCommandDuration', () => {
    it('should estimate lint duration', () => {
      const profile = STANDARD_PROFILES['lint'];

      const duration = estimateCommandDuration(profile);

      expect(duration).toBeGreaterThan(0);
      expect(duration).toBeLessThanOrEqual(15000);
    });

    it('should estimate test duration', () => {
      const profile = STANDARD_PROFILES['test_unit'];

      const duration = estimateCommandDuration(profile);

      expect(duration).toBeGreaterThan(0);
      expect(duration).toBeLessThanOrEqual(120000);
    });

    it('should estimate build duration', () => {
      const profile = STANDARD_PROFILES['build'];

      const duration = estimateCommandDuration(profile);

      expect(duration).toBeGreaterThan(0);
      expect(duration).toBeLessThanOrEqual(90000);
    });

    it('should estimate playwright duration', () => {
      const profile = STANDARD_PROFILES['playwright'];

      const duration = estimateCommandDuration(profile);

      expect(duration).toBeGreaterThan(0);
    });
  });

  describe('getCommandDependencies', () => {
    it('should have no deps for lint', () => {
      const profile = STANDARD_PROFILES['lint'];

      const deps = getCommandDependencies(profile);

      expect(deps.length).toBe(0);
    });

    it('should depend on build for test', () => {
      const profile = STANDARD_PROFILES['test_unit'];

      const deps = getCommandDependencies(profile);

      expect(deps.length).toBeGreaterThan(0);
      expect(deps.some((d) => d.category === 'build')).toBe(true);
    });

    it('should depend on lint for build', () => {
      const profile = STANDARD_PROFILES['build'];

      const deps = getCommandDependencies(profile);

      expect(deps.some((d) => d.category === 'lint')).toBe(true);
    });

    it('should depend on build for smoke tests', () => {
      const profile = STANDARD_PROFILES['smoke'];

      const deps = getCommandDependencies(profile);

      expect(deps.some((d) => d.category === 'build')).toBe(true);
    });
  });

  describe('getProfile', () => {
    it('should get lint profile', () => {
      const profile = getProfile('lint');

      expect(profile).toBeTruthy();
      expect(profile?.name).toBe('lint');
    });

    it('should get test:unit profile', () => {
      const profile = getProfile('test_unit');

      expect(profile).toBeTruthy();
      expect(profile?.category).toBe('test');
    });

    it('should return undefined for unknown profile', () => {
      const profile = getProfile('unknown');

      expect(profile).toBeUndefined();
    });
  });

  describe('findProfilesByCategory', () => {
    it('should find all lint profiles', () => {
      const profiles = findProfilesByCategory('lint');

      expect(profiles.length).toBeGreaterThan(0);
      expect(profiles.every((p) => p.category === 'lint')).toBe(true);
    });

    it('should find all test profiles', () => {
      const profiles = findProfilesByCategory('test');

      expect(profiles.length).toBeGreaterThan(0);
      expect(profiles.every((p) => p.category === 'test')).toBe(true);
    });

    it('should find build profile', () => {
      const profiles = findProfilesByCategory('build');

      expect(profiles.length).toBeGreaterThan(0);
    });
  });

  describe('validateCommandOutput', () => {
    it('should validate success pattern', () => {
      const profile = STANDARD_PROFILES['lint'];

      // Without failure, should be valid
      const result = validateCommandOutput(profile, 'ESLint passed');

      expect(result).toBe(true);
    });

    it('should detect failure pattern', () => {
      const profile = STANDARD_PROFILES['test_unit'];

      const result = validateCommandOutput(profile, 'FAIL: tests failed');

      expect(result).toBe(false);
    });

    it('should validate without rules', () => {
      const profile = defineCommandProfile({
        name: 'test',
        command: 'echo',
        category: 'other',
      });

      const result = validateCommandOutput(profile, 'any output');

      expect(result).toBe(true);
    });

    it('should check success pattern when specified', () => {
      const profile = STANDARD_PROFILES['build'];

      const result = validateCommandOutput(profile, 'Build compiled successfully');

      expect(result).toBe(true);
    });
  });

  describe('createExecutionResult', () => {
    it('should create successful result', () => {
      const profile = STANDARD_PROFILES['lint'];

      const result = createExecutionResult(profile, 'eslint src/', 0, 'Success', '', 1000);

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.duration).toBe(1000);
    });

    it('should create failed result on non-zero exit', () => {
      const profile = STANDARD_PROFILES['test_unit'];

      const result = createExecutionResult(profile, 'jest', 1, 'FAIL', 'tests failed', 5000);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('should validate output in result', () => {
      const profile = STANDARD_PROFILES['test_unit'];

      const result = createExecutionResult(profile, 'jest', 0, 'PASS: 10 passed', '', 5000);

      expect(result.validationPassed).toBe(true);
    });

    it('should include timestamp', () => {
      const profile = STANDARD_PROFILES['lint'];

      const result = createExecutionResult(profile, 'eslint', 0, '', '', 1000);

      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('mergeProfiles', () => {
    it('should merge environment variables', () => {
      const base = STANDARD_PROFILES['lint'];
      const merged = mergeProfiles(base, {
        environment: {
          CUSTOM_VAR: 'value',
        },
      });

      expect(merged.environment?.NODE_ENV).toBe('development');
      expect(merged.environment?.CUSTOM_VAR).toBe('value');
    });

    it('should override properties', () => {
      const base = STANDARD_PROFILES['test_unit'];
      const merged = mergeProfiles(base, {
        timeout: 300000,
        critical: false,
      });

      expect(merged.timeout).toBe(300000);
      expect(merged.critical).toBe(false);
    });

    it('should preserve base profile', () => {
      const base = STANDARD_PROFILES['build'];
      const baseTimeout = base.timeout;

      mergeProfiles(base, { timeout: 999999 });

      expect(base.timeout).toBe(baseTimeout);
    });
  });

  describe('getCriticalProfiles', () => {
    it('should return critical profiles', () => {
      const critical = getCriticalProfiles();

      expect(critical.length).toBeGreaterThan(0);
      expect(critical.every((p) => p.critical)).toBe(true);
    });

    it('should include build profile', () => {
      const critical = getCriticalProfiles();

      expect(critical.some((p) => p.name === 'build')).toBe(true);
    });

    it('should include test profile', () => {
      const critical = getCriticalProfiles();

      expect(critical.some((p) => p.category === 'test')).toBe(true);
    });
  });

  describe('getParallelizableProfiles', () => {
    it('should return parallelizable profiles', () => {
      const parallel = getParallelizableProfiles();

      expect(parallel.length).toBeGreaterThan(0);
      expect(parallel.every((p) => p.parallel)).toBe(true);
    });

    it('should include lint profile', () => {
      const parallel = getParallelizableProfiles();

      expect(parallel.some((p) => p.category === 'lint')).toBe(true);
    });
  });

  describe('Standard profiles validation', () => {
    it('should have lint profile with correct settings', () => {
      const lint = STANDARD_PROFILES['lint'];

      expect(lint.name).toBe('lint');
      expect(lint.category).toBe('lint');
      expect(lint.parallel).toBe(true);
      expect(lint.critical).toBe(false);
    });

    it('should have build profile with correct settings', () => {
      const build = STANDARD_PROFILES['build'];

      expect(build.name).toBe('build');
      expect(build.category).toBe('build');
      expect(build.critical).toBe(true);
      expect(build.outputs?.length).toBeGreaterThan(0);
    });

    it('should have test profile with correct settings', () => {
      const test = STANDARD_PROFILES['test_unit'];

      expect(test.category).toBe('test');
      expect(test.critical).toBe(true);
      expect(test.timeout).toBeGreaterThan(60000);
    });

    it('should have smoke tests profile', () => {
      const smoke = STANDARD_PROFILES['smoke'];

      expect(smoke.name).toBe('smoke');
      expect(smoke.category).toBe('smoke');
    });

    it('should have playwright profile', () => {
      const playwright = STANDARD_PROFILES['playwright'];

      expect(playwright.name).toBe('playwright');
      expect(playwright.category).toBe('playwright');
      expect(playwright.timeout).toBeGreaterThan(100000);
    });

    it('should have verify profile', () => {
      const verify = STANDARD_PROFILES['verify'];

      expect(verify.name).toBe('verify');
      expect(verify.category).toBe('verify');
      expect(verify.critical).toBe(true);
    });
  });

  describe('Integration scenarios', () => {
    it('should create complete execution workflow', () => {
      const lint = STANDARD_PROFILES['lint'];
      const build = STANDARD_PROFILES['build'];
      const test = STANDARD_PROFILES['test_unit'];

      // Create plans
      const lintPlan = createExecutionPlan(lint);
      const buildPlan = createExecutionPlan(build);
      const testPlan = createExecutionPlan(test);

      // Verify order: lint -> build -> test
      expect(lintPlan.dependencies.length).toBe(0);
      expect(buildPlan.dependencies.some((d) => d.category === 'lint')).toBe(true);
      expect(testPlan.dependencies.some((d) => d.category === 'build')).toBe(true);
    });

    it('should identify parallelizable commands', () => {
      const parallel = getParallelizableProfiles();
      const critical = getCriticalProfiles();

      // Format can run in parallel
      expect(parallel.some((p) => p.name === 'format')).toBe(true);

      // Build is critical but not parallel
      expect(critical.some((p) => p.name === 'build')).toBe(true);
      expect(
        critical.some((p) => p.name === 'build' && !p.parallel)
      ).toBe(true);
    });

    it('should merge custom profile with standard', () => {
      const base = STANDARD_PROFILES['lint'];
      const custom = mergeProfiles(base, {
        timeout: 45000,
        environment: {
          CUSTOM: 'value',
        },
      });

      expect(custom.timeout).toBe(45000);
      expect(custom.environment?.CUSTOM).toBe('value');
      expect(custom.environment?.NODE_ENV).toBe('development'); // Preserved from base
    });
  });
});
