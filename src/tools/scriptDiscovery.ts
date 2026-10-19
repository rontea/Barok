/**
 * Phase 5.2: Script Discovery from package.json
 * Detects npm/yarn/pnpm scripts and categorizes them by type
 */

/**
 * Metadata about a discovered script
 */
export interface ScriptMetadata {
  name: string; // script name (e.g., 'build', 'test:unit')
  command: string; // full command (e.g., 'tsx build.ts && vite build')
  args: string[]; // parsed arguments
  description?: string; // optional description inferred from name
  runType: 'serial' | 'parallel'; // whether script can run in parallel
  category: ScriptCategory; // build | test | lint | dev | util | other
  packages?: string[]; // detected package names from command
}

export type ScriptCategory = 'build' | 'test' | 'lint' | 'dev' | 'util' | 'other';

/**
 * Result of detecting scripts from package.json
 */
export interface DetectScriptsResult {
  success: boolean;
  scripts: ScriptMetadata[];
  errors: string[];
  packagePath?: string;
}

/**
 * Result of categorizing scripts
 */
export interface CategorizedScripts {
  build: ScriptMetadata[];
  test: ScriptMetadata[];
  lint: ScriptMetadata[];
  dev: ScriptMetadata[];
  util: ScriptMetadata[];
  other: ScriptMetadata[];
}

/**
 * Configuration for script validation
 */
export interface ScriptValidationConfig {
  allowedPackages?: string[]; // packages allowed in scripts
  forbiddenPatterns?: string[]; // patterns not allowed
  requirePackagePrefix?: boolean; // require known package names
}

/**
 * Result of validating a script command
 */
export interface ScriptValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  packages: string[];
}

/**
 * Detect scripts from package.json
 */
export function detectScripts(packagePath: string): DetectScriptsResult {
  const errors: string[] = [];
  const scripts: ScriptMetadata[] = [];

  try {
    // Read and parse package.json
    let pkg: any;
    try {
      const { readFileSync } = require('fs');
      const content = readFileSync(packagePath, 'utf-8');
      pkg = JSON.parse(content);
    } catch (e) {
      return {
        success: false,
        scripts: [],
        errors: [`Failed to read/parse package.json: ${e instanceof Error ? e.message : String(e)}`],
        packagePath,
      };
    }

    if (!pkg.scripts || typeof pkg.scripts !== 'object') {
      return {
        success: true,
        scripts: [],
        errors: errors.length > 0 ? errors : [],
        packagePath,
      };
    }

    // Process each script
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (typeof command !== 'string') {
        errors.push(`Script '${name}' has non-string command`);
        continue;
      }

      try {
        const meta = createScriptMetadata(name, command);
        scripts.push(meta);
      } catch (e) {
        errors.push(`Failed to process script '${name}': ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return {
      success: errors.length === 0,
      scripts,
      errors,
      packagePath,
    };
  } catch (e) {
    return {
      success: false,
      scripts: [],
      errors: [String(e)],
      packagePath,
    };
  }
}

/**
 * Create script metadata from name and command
 */
export function createScriptMetadata(name: string, command: string): ScriptMetadata {
  const args = parseCommand(command);
  const category = inferCategory(name);
  const packages = detectPackages(command);
  const runType = inferRunType(name, category);

  return {
    name,
    command,
    args,
    description: inferDescription(name),
    runType,
    category,
    packages,
  };
}

/**
 * Parse command into arguments
 */
export function parseCommand(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if ((char === '"' || char === "'") && (i === 0 || command[i - 1] !== '\\')) {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === ' ' && !inQuotes) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    args.push(current);
  }

  return args;
}

/**
 * Infer script category from name
 */
export function inferCategory(name: string): ScriptCategory {
  const lower = name.toLowerCase();

  if (lower.includes('build') || lower.includes('compile')) return 'build';
  if (lower.includes('test') || lower.includes('spec') || lower.includes('coverage')) return 'test';
  if (lower.includes('lint') || lower.includes('format')) return 'lint';
  if (lower.includes('dev') || lower.includes('start') || lower.includes('serve')) return 'dev';
  if (lower.includes('preinstall') || lower.includes('postinstall') || lower.includes('setup')) return 'util';

  return 'other';
}

/**
 * Infer description from script name
 */
export function inferDescription(name: string): string | undefined {
  const descriptions: Record<string, string> = {
    build: 'Build the project',
    'build:prod': 'Build for production',
    dev: 'Start development server',
    start: 'Start the application',
    test: 'Run tests',
    'test:unit': 'Run unit tests',
    'test:watch': 'Run tests in watch mode',
    'test:coverage': 'Run tests with coverage report',
    lint: 'Lint code',
    format: 'Format code',
    clean: 'Clean build artifacts',
    prepare: 'Prepare distribution',
  };

  return descriptions[name] || undefined;
}

/**
 * Infer run type (serial or parallel)
 */
export function inferRunType(name: string, category: ScriptCategory): 'serial' | 'parallel' {
  // Tests and builds are generally serial
  if (category === 'build' || category === 'test') {
    return 'serial';
  }

  // Watch/dev tasks are serial
  if (name.includes('watch') || name.includes('dev')) {
    return 'serial';
  }

  // Linting and formatting can be parallel
  return 'parallel';
}

/**
 * Detect package names used in command
 */
export function detectPackages(command: string): string[] {
  const packages = new Set<string>();

  // Common package executables and patterns
  const patterns = [
    /\b(tsx|ts-node)\b/g,
    /\b(eslint|prettier)\b/g,
    /\b(jest|vitest|mocha)\b/g,
    /\b(vite|webpack|rollup)\b/g,
    /\b(tsx|tsc|typescript)\b/g,
    /\b(node|npm|yarn|pnpm)\b/g,
    /\bnode_modules\/\.bin\/([a-z-]+)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(command)) !== null) {
      if (match[1]) {
        packages.add(match[1]);
      } else {
        packages.add(match[0]);
      }
    }
  }

  return Array.from(packages).sort();
}

/**
 * Categorize scripts by type
 */
export function categorizeScripts(scripts: ScriptMetadata[]): CategorizedScripts {
  return {
    build: scripts.filter((s) => s.category === 'build'),
    test: scripts.filter((s) => s.category === 'test'),
    lint: scripts.filter((s) => s.category === 'lint'),
    dev: scripts.filter((s) => s.category === 'dev'),
    util: scripts.filter((s) => s.category === 'util'),
    other: scripts.filter((s) => s.category === 'other'),
  };
}

/**
 * Validate script command
 */
export function validateScriptCommand(
  command: string,
  config?: ScriptValidationConfig
): ScriptValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const packages = detectPackages(command);

  // Check for empty command
  if (!command || command.trim().length === 0) {
    errors.push('Command is empty');
    return { valid: false, errors, warnings, packages };
  }

  // Check forbidden patterns
  if (config?.forbiddenPatterns) {
    for (const pattern of config.forbiddenPatterns) {
      if (new RegExp(pattern).test(command)) {
        errors.push(`Command matches forbidden pattern: ${pattern}`);
      }
    }
  }

  // Validate package names if required
  if (config?.requirePackagePrefix && packages.length === 0) {
    warnings.push('No recognized packages detected in command');
  }

  // Check allowed packages
  if (config?.allowedPackages && packages.length > 0) {
    for (const pkg of packages) {
      if (!config.allowedPackages.includes(pkg)) {
        warnings.push(`Package '${pkg}' not in allowed list`);
      }
    }
  }

  // Check for dangerous patterns
  if (command.includes('rm -rf') && !command.includes('dist') && !command.includes('build')) {
    warnings.push('Potentially dangerous rm -rf command detected');
  }

  // Check for shell injection risks
  if (/(;\s*rm|`|eval|exec)/.test(command)) {
    warnings.push('Potential shell injection risk detected');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    packages,
  };
}

/**
 * Find scripts matching a pattern
 */
export function findScripts(scripts: ScriptMetadata[], pattern: string | RegExp): ScriptMetadata[] {
  const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
  return scripts.filter((s) => regex.test(s.name) || regex.test(s.command));
}

/**
 * Get script dependencies (scripts that should run first)
 */
export function getScriptDependencies(scripts: ScriptMetadata[], scriptName: string): ScriptMetadata[] {
  const script = scripts.find((s) => s.name === scriptName);
  if (!script) return [];

  const deps: ScriptMetadata[] = [];

  // Build scripts typically depend on lint/format
  if (script.category === 'build') {
    const lint = scripts.filter((s) => s.category === 'lint');
    deps.push(...lint);
  }

  // Test scripts typically depend on build
  if (script.category === 'test') {
    const builds = scripts.filter((s) => s.category === 'build');
    deps.push(...builds);
  }

  return deps;
}

/**
 * Estimate execution time for a script (in milliseconds)
 */
export function estimateScriptDuration(script: ScriptMetadata): number {
  // Base estimates for different categories
  const baseEstimates: Record<ScriptCategory, number> = {
    build: 30000, // 30s
    test: 60000, // 60s
    lint: 10000, // 10s
    dev: 5000, // 5s (usually quick to start)
    util: 5000, // 5s
    other: 10000, // 10s
  };

  let estimate = baseEstimates[script.category];

  // Adjust for watch mode (quick, just startup)
  if (script.name.includes('watch')) {
    estimate = Math.min(estimate, 5000);
  }

  // Adjust for coverage (typically slower)
  if (script.name.includes('coverage')) {
    estimate = Math.max(estimate, 60000);
  }

  // Adjust for multiple steps (&&, |)
  const stepCount = (script.command.match(/(\s&&\s|\s\|\s)/g) || []).length + 1;
  estimate = estimate * stepCount;

  return estimate;
}
