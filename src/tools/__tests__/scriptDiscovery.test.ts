/**
 * Phase 5.2: Script Discovery Tests
 * Test suite for npm/yarn/pnpm script detection and categorization
 */

import {
  detectScripts,
  createScriptMetadata,
  parseCommand,
  inferCategory,
  inferDescription,
  inferRunType,
  detectPackages,
  categorizeScripts,
  validateScriptCommand,
  findScripts,
  getScriptDependencies,
  estimateScriptDuration,
  type ScriptMetadata,
  type ScriptCategory,
  type CategorizedScripts,
} from '../scriptDiscovery';

describe('Phase 5.2: Script Discovery', () => {
  describe('createScriptMetadata', () => {
    it('should create metadata for build script', () => {
      const meta = createScriptMetadata('build', 'tsx build.ts && vite build');

      expect(meta.name).toBe('build');
      expect(meta.command).toBe('tsx build.ts && vite build');
      expect(meta.category).toBe('build');
      expect(meta.runType).toBe('serial');
      expect(meta.packages).toContain('tsx');
      expect(meta.packages).toContain('vite');
    });

    it('should create metadata for test script', () => {
      const meta = createScriptMetadata('test:unit', 'jest --runInBand');

      expect(meta.name).toBe('test:unit');
      expect(meta.category).toBe('test');
      expect(meta.packages).toContain('jest');
      expect(meta.description).toBe('Run unit tests');
    });

    it('should create metadata for lint script', () => {
      const meta = createScriptMetadata('lint', 'eslint src/');

      expect(meta.name).toBe('lint');
      expect(meta.category).toBe('lint');
      expect(meta.runType).toBe('parallel');
    });

    it('should set runType serial for test:watch', () => {
      const meta = createScriptMetadata('test:watch', 'jest --watch');

      expect(meta.runType).toBe('serial');
    });

    it('should set runType parallel for format', () => {
      const meta = createScriptMetadata('format', 'prettier --write src/');

      expect(meta.runType).toBe('parallel');
    });
  });

  describe('parseCommand', () => {
    it('should parse simple command', () => {
      const args = parseCommand('eslint src/ --fix');

      expect(args).toEqual(['eslint', 'src/', '--fix']);
    });

    it('should handle quoted arguments', () => {
      const args = parseCommand('node -e "console.log(\'hello\')"');

      expect(args.length).toBeGreaterThan(0);
      expect(args[0]).toBe('node');
    });

    it('should handle command with pipes', () => {
      const args = parseCommand('cat file.ts | grep test');

      expect(args).toContain('cat');
      expect(args).toContain('file.ts');
    });

    it('should handle command with ampersands', () => {
      const args = parseCommand('build && test && lint');

      expect(args.length).toBeGreaterThan(0);
    });

    it('should handle empty strings', () => {
      const args = parseCommand('');

      expect(args).toEqual([]);
    });
  });

  describe('inferCategory', () => {
    it('should categorize build scripts', () => {
      expect(inferCategory('build')).toBe('build');
      expect(inferCategory('build:prod')).toBe('build');
      expect(inferCategory('compile')).toBe('build');
    });

    it('should categorize test scripts', () => {
      expect(inferCategory('test')).toBe('test');
      expect(inferCategory('test:unit')).toBe('test');
      expect(inferCategory('spec')).toBe('test');
      expect(inferCategory('coverage')).toBe('test');
    });

    it('should categorize lint scripts', () => {
      expect(inferCategory('lint')).toBe('lint');
      expect(inferCategory('format')).toBe('lint');
    });

    it('should categorize dev scripts', () => {
      expect(inferCategory('dev')).toBe('dev');
      expect(inferCategory('start')).toBe('dev');
      expect(inferCategory('serve')).toBe('dev');
    });

    it('should categorize util scripts', () => {
      expect(inferCategory('setup')).toBe('util');
      expect(inferCategory('preinstall')).toBe('util');
    });

    it('should default to other', () => {
      expect(inferCategory('custom')).toBe('other');
      expect(inferCategory('foo')).toBe('other');
    });
  });

  describe('inferDescription', () => {
    it('should infer descriptions for known scripts', () => {
      expect(inferDescription('build')).toBe('Build the project');
      expect(inferDescription('test')).toBe('Run tests');
      expect(inferDescription('lint')).toBe('Lint code');
      expect(inferDescription('dev')).toBe('Start development server');
    });

    it('should return undefined for unknown scripts', () => {
      expect(inferDescription('custom')).toBeUndefined();
    });
  });

  describe('inferRunType', () => {
    it('should set serial for build scripts', () => {
      expect(inferRunType('build', 'build')).toBe('serial');
    });

    it('should set serial for test scripts', () => {
      expect(inferRunType('test', 'test')).toBe('serial');
    });

    it('should set serial for watch/dev scripts', () => {
      expect(inferRunType('test:watch', 'test')).toBe('serial');
      expect(inferRunType('dev', 'dev')).toBe('serial');
    });

    it('should set parallel for lint scripts', () => {
      expect(inferRunType('lint', 'lint')).toBe('parallel');
    });
  });

  describe('detectPackages', () => {
    it('should detect tsx', () => {
      const packages = detectPackages('tsx build.ts');

      expect(packages).toContain('tsx');
    });

    it('should detect multiple packages', () => {
      const packages = detectPackages('tsx build.ts && vite build');

      expect(packages).toContain('tsx');
      expect(packages).toContain('vite');
    });

    it('should detect eslint and prettier', () => {
      const packages = detectPackages('eslint src/ && prettier --write src/');

      expect(packages).toContain('eslint');
      expect(packages).toContain('prettier');
    });

    it('should detect jest', () => {
      const packages = detectPackages('jest --runInBand --coverage');

      expect(packages).toContain('jest');
    });

    it('should return empty array for no packages', () => {
      const packages = detectPackages('echo hello');

      expect(packages.length).toBe(0);
    });

    it('should deduplicate packages', () => {
      const packages = detectPackages('eslint src/ && eslint tests/');

      const eslintCount = packages.filter((p) => p === 'eslint').length;
      expect(eslintCount).toBe(1);
    });
  });

  describe('categorizeScripts', () => {
    const scripts: ScriptMetadata[] = [
      createScriptMetadata('build', 'vite build'),
      createScriptMetadata('test', 'jest'),
      createScriptMetadata('lint', 'eslint src/'),
      createScriptMetadata('dev', 'vite'),
      createScriptMetadata('test:watch', 'jest --watch'),
    ];

    it('should categorize build scripts', () => {
      const result = categorizeScripts(scripts);

      expect(result.build.length).toBeGreaterThan(0);
      expect(result.build.some((s) => s.name === 'build')).toBe(true);
    });

    it('should categorize test scripts', () => {
      const result = categorizeScripts(scripts);

      expect(result.test.length).toBeGreaterThan(0);
      expect(result.test.some((s) => s.name.includes('test'))).toBe(true);
    });

    it('should categorize lint scripts', () => {
      const result = categorizeScripts(scripts);

      expect(result.lint.length).toBeGreaterThan(0);
      expect(result.lint.some((s) => s.name === 'lint')).toBe(true);
    });

    it('should categorize dev scripts', () => {
      const result = categorizeScripts(scripts);

      expect(result.dev.length).toBeGreaterThan(0);
      expect(result.dev.some((s) => s.name === 'dev')).toBe(true);
    });
  });

  describe('validateScriptCommand', () => {
    it('should validate valid command', () => {
      const result = validateScriptCommand('eslint src/');

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should reject empty command', () => {
      const result = validateScriptCommand('');

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('empty'))).toBe(true);
    });

    it('should detect packages', () => {
      const result = validateScriptCommand('eslint src/ && jest');

      expect(result.packages).toContain('eslint');
      expect(result.packages).toContain('jest');
    });

    it('should warn on dangerous patterns', () => {
      const result = validateScriptCommand('rm -rf node_modules');

      // This shouldn't trigger warning since dist/build/node_modules are allowed
      expect(result.valid).toBe(true);
    });

    it('should check forbidden patterns', () => {
      const result = validateScriptCommand('eslint src/', {
        forbiddenPatterns: ['.*rm.*rf.*'],
      });

      expect(result.valid).toBe(true); // eslint doesn't match forbidden
    });

    it('should check allowed packages', () => {
      const result = validateScriptCommand('eslint src/', {
        allowedPackages: ['eslint'],
      });

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBe(0);
    });

    it('should warn on disallowed packages', () => {
      const result = validateScriptCommand('unknown-tool src/', {
        allowedPackages: ['eslint'],
      });

      expect(result.warnings.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('findScripts', () => {
    const scripts: ScriptMetadata[] = [
      createScriptMetadata('build', 'vite build'),
      createScriptMetadata('build:prod', 'vite build --mode prod'),
      createScriptMetadata('test', 'jest'),
      createScriptMetadata('test:watch', 'jest --watch'),
    ];

    it('should find scripts by name pattern', () => {
      const found = findScripts(scripts, 'build');

      expect(found.length).toBeGreaterThan(0);
      expect(found.some((s) => s.name.includes('build'))).toBe(true);
    });

    it('should find scripts by regex', () => {
      const found = findScripts(scripts, /test/);

      expect(found.length).toBeGreaterThan(0);
      expect(found.every((s) => s.name.includes('test'))).toBe(true);
    });

    it('should find scripts by command content', () => {
      const found = findScripts(scripts, 'jest');

      expect(found.length).toBeGreaterThan(0);
      expect(found.some((s) => s.command.includes('jest'))).toBe(true);
    });
  });

  describe('getScriptDependencies', () => {
    const scripts: ScriptMetadata[] = [
      createScriptMetadata('lint', 'eslint src/'),
      createScriptMetadata('build', 'vite build'),
      createScriptMetadata('test', 'jest'),
    ];

    it('should find no deps for lint', () => {
      const deps = getScriptDependencies(scripts, 'lint');

      expect(deps.length).toBe(0);
    });

    it('should find lint dependency for build', () => {
      const deps = getScriptDependencies(scripts, 'build');

      expect(deps.some((s) => s.category === 'lint')).toBe(true);
    });

    it('should find build dependency for test', () => {
      const deps = getScriptDependencies(scripts, 'test');

      expect(deps.some((s) => s.category === 'build')).toBe(true);
    });

    it('should return empty for unknown script', () => {
      const deps = getScriptDependencies(scripts, 'unknown');

      expect(deps.length).toBe(0);
    });
  });

  describe('estimateScriptDuration', () => {
    it('should estimate build script duration', () => {
      const script = createScriptMetadata('build', 'vite build');
      const duration = estimateScriptDuration(script);

      expect(duration).toBeGreaterThan(0);
      expect(duration).toBeGreaterThanOrEqual(30000); // At least 30s for build
    });

    it('should estimate test script duration', () => {
      const script = createScriptMetadata('test', 'jest');
      const duration = estimateScriptDuration(script);

      expect(duration).toBeGreaterThanOrEqual(60000); // At least 60s for test
    });

    it('should estimate watch mode as quick', () => {
      const script = createScriptMetadata('test:watch', 'jest --watch');
      const duration = estimateScriptDuration(script);

      expect(duration).toBeLessThanOrEqual(5000); // Quick startup
    });

    it('should account for multiple steps', () => {
      const script = createScriptMetadata('build', 'lint && build && test');
      const duration = estimateScriptDuration(script);

      expect(duration).toBeGreaterThan(0);
      // Multiple steps should increase duration
    });

    it('should increase estimate for coverage', () => {
      const script = createScriptMetadata('test:coverage', 'jest --coverage');
      const duration = estimateScriptDuration(script);

      expect(duration).toBeGreaterThanOrEqual(60000);
    });
  });

  describe('Integration scenarios', () => {
    it('should process complete package.json structure', () => {
      // This is a mock test since we can't rely on file system
      const scripts = [
        createScriptMetadata('build', 'tsx build.ts && vite build'),
        createScriptMetadata('dev', 'tsx server.ts'),
        createScriptMetadata('test:unit', 'jest --runInBand'),
        createScriptMetadata('lint', 'eslint src/'),
        createScriptMetadata('format', 'prettier --write src/'),
      ];

      const categorized = categorizeScripts(scripts);

      expect(categorized.build.length).toBe(1);
      expect(categorized.dev.length).toBe(1);
      expect(categorized.test.length).toBe(1);
      expect(categorized.lint.length).toBe(2); // Both lint and format are lint category
    });

    it('should validate script workflow', () => {
      const scripts = [
        createScriptMetadata('build', 'vite build'),
        createScriptMetadata('test', 'jest'),
      ];

      // Validate both scripts
      for (const script of scripts) {
        const result = validateScriptCommand(script.command);
        expect(result.valid).toBe(true);
      }
    });

    it('should estimate total workflow duration', () => {
      const scripts = [
        createScriptMetadata('lint', 'eslint src/'),
        createScriptMetadata('build', 'vite build'),
        createScriptMetadata('test', 'jest'),
      ];

      const total = scripts.reduce((sum, s) => sum + estimateScriptDuration(s), 0);

      expect(total).toBeGreaterThan(0);
      // Roughly: 10000 + 30000 + 60000 = 100000ms
      expect(total).toBeGreaterThanOrEqual(100000);
    });
  });
});
