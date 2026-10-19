/**
 * Phase 5.3: Command Profiles
 * Define standardized command profiles for common development tasks
 */

/**
 * Environment variables for command execution
 */
export interface CommandEnvironment {
  [key: string]: string | undefined;
}

/**
 * Configuration for a command output validation
 */
export interface OutputValidation {
  successPatterns?: string[]; // Regex patterns that indicate success
  failurePatterns?: string[]; // Regex patterns that indicate failure
  minOutputLength?: number; // Minimum expected output length
  maxOutputLength?: number; // Maximum expected output length
}

/**
 * A standardized command profile for execution
 */
export interface CommandProfile {
  name: string; // Unique identifier (e.g., 'lint', 'test:unit')
  command: string; // Command to execute
  args?: string[]; // Arguments to pass
  environment?: CommandEnvironment; // Environment variables
  description?: string; // Human-readable description
  timeout?: number; // Timeout in milliseconds
  outputs?: string[]; // Expected output files/directories
  validation?: OutputValidation; // Output validation rules
  category: CommandCategory; // Category of command
  parallel: boolean; // Can run in parallel with other commands
  critical: boolean; // Is this command critical to success
  retryable: boolean; // Should this command be retried on failure
}

export type CommandCategory = 'lint' | 'test' | 'build' | 'verify' | 'smoke' | 'playwright' | 'other';

/**
 * Configuration for profile resolution
 */
export interface ProfileResolutionConfig {
  projectRoot?: string;
  nodeModulesPath?: string;
  platform?: 'linux' | 'darwin' | 'win32';
}

/**
 * Execution plan for a command profile
 */
export interface CommandExecutionPlan {
  profile: CommandProfile;
  fullCommand: string; // Full command with args
  environment: CommandEnvironment;
  estimatedDuration: number;
  dependencies: CommandProfile[]; // Commands that must run first
}

/**
 * Result of command execution
 */
export interface CommandExecutionResult {
  success: boolean;
  profile: CommandProfile;
  command: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  duration: number; // milliseconds
  timestamp: Date;
  validationPassed?: boolean;
  error?: string;
}

/**
 * Predefined command profiles
 */
export const STANDARD_PROFILES: Record<string, CommandProfile> = {
  // Linting
  lint: {
    name: 'lint',
    command: 'eslint',
    args: ['src/', '--format', 'json'],
    description: 'Lint TypeScript source code',
    timeout: 30000,
    outputs: [],
    category: 'lint',
    parallel: true,
    critical: false,
    retryable: true,
    environment: {
      NODE_ENV: 'development',
    },
    validation: {
      failurePatterns: ['"ruleId"'], // JSON errors indicate failures
    },
  },

  // Unit tests
  test_unit: {
    name: 'test:unit',
    command: 'node',
    args: ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--runInBand', '--no-coverage'],
    description: 'Run unit tests',
    timeout: 120000,
    outputs: [],
    category: 'test',
    parallel: false,
    critical: true,
    retryable: false,
    environment: {
      NODE_ENV: 'test',
    },
    validation: {
      successPatterns: ['PASS', 'passed'],
      failurePatterns: ['FAIL', 'failed'],
    },
  },

  // Build
  build: {
    name: 'build',
    command: 'tsx',
    args: ['build.ts'],
    description: 'Build the project',
    timeout: 90000,
    outputs: ['dist/', 'out/'],
    category: 'build',
    parallel: false,
    critical: true,
    retryable: true,
    environment: {
      NODE_ENV: 'production',
    },
    validation: {
      successPatterns: ['compiled', 'bundled', 'built'],
      failurePatterns: ['error', 'failed'],
    },
  },

  // App verification
  verify: {
    name: 'verify',
    command: 'npm',
    args: ['run', 'doctor'],
    description: 'Verify application health and dependencies',
    timeout: 60000,
    outputs: [],
    category: 'verify',
    parallel: false,
    critical: true,
    retryable: true,
    environment: {
      NODE_ENV: 'development',
    },
    validation: {
      successPatterns: ['OK', 'healthy', 'ready'],
      failurePatterns: ['ERROR', 'failed', 'broken'],
    },
  },

  // Smoke tests
  smoke: {
    name: 'smoke',
    command: 'npm',
    args: ['run', 'smoke'],
    description: 'Run the target workspace smoke script',
    timeout: 45000,
    outputs: [],
    category: 'smoke',
    parallel: false,
    critical: false,
    retryable: true,
    environment: {
      NODE_ENV: 'test',
    },
    validation: {
      successPatterns: ['passed', 'completed'],
      failurePatterns: ['failed', 'error'],
    },
  },

  // Playwright tests
  playwright: {
    name: 'playwright',
    command: 'npx',
    args: ['playwright', 'test'],
    description: 'Run Playwright end-to-end tests',
    timeout: 180000, // E2E tests can be slow
    outputs: ['test-results/'],
    category: 'playwright',
    parallel: false,
    critical: false,
    retryable: true,
    environment: {
      NODE_ENV: 'test',
    },
    validation: {
      successPatterns: ['passed', 'all passed'],
      failurePatterns: ['failed', 'error'],
    },
  },

  // Format code
  format: {
    name: 'format',
    command: 'prettier',
    args: ['--write', 'src/'],
    description: 'Format code with Prettier',
    timeout: 30000,
    outputs: [],
    category: 'lint',
    parallel: true,
    critical: false,
    retryable: true,
    environment: {
      NODE_ENV: 'development',
    },
  },
};

/**
 * Define a new command profile
 */
export function defineCommandProfile(overrides: Partial<CommandProfile>): CommandProfile {
  const defaults: CommandProfile = {
    name: '',
    command: '',
    category: 'other',
    parallel: false,
    critical: false,
    retryable: true,
    timeout: 60000,
  };

  const profile = { ...defaults, ...overrides };

  if (!profile.name || !profile.command) {
    throw new Error('CommandProfile must have name and command');
  }

  return profile;
}

/**
 * Resolve a command profile to a full execution command
 */
export function resolveCommand(
  profile: CommandProfile,
  config?: ProfileResolutionConfig
): string {
  let command = profile.command;

  // Handle platform-specific commands
  const platform = config?.platform || 'linux';

  // Resolve node_modules paths
  if (profile.command === 'eslint' || profile.command === 'prettier') {
    const modulePath = config?.nodeModulesPath || 'node_modules/.bin';
    command = `${modulePath}/${command}`;

    // Handle Windows
    if (platform === 'win32') {
      command = `${modulePath}\\${command}.cmd`;
    }
  }

  if (profile.command === 'npm' && platform === 'win32') command = 'npm.cmd';

  // Build full command with args
  const args = profile.args || [];
  const fullCommand = [command, ...args].join(' ');

  return fullCommand;
}

/**
 * Create an execution plan for a command profile
 */
export function createExecutionPlan(
  profile: CommandProfile,
  config?: ProfileResolutionConfig
): CommandExecutionPlan {
  const fullCommand = resolveCommand(profile, config);
  const environment = profile.environment || {};
  const estimatedDuration = estimateCommandDuration(profile);
  const dependencies = getCommandDependencies(profile);

  return {
    profile,
    fullCommand,
    environment,
    estimatedDuration,
    dependencies,
  };
}

/**
 * Estimate command duration in milliseconds
 */
export function estimateCommandDuration(profile: CommandProfile): number {
  const baseEstimates: Record<CommandCategory, number> = {
    lint: 15000,
    test: 90000,
    build: 60000,
    verify: 30000,
    smoke: 30000,
    playwright: 120000,
    other: 30000,
  };

  let estimate = baseEstimates[profile.category];

  // Apply timeout if available
  if (profile.timeout) {
    estimate = Math.min(estimate, profile.timeout / 2); // Assume timeout is 2x estimate
  }

  return estimate;
}

/**
 * Get command dependencies (commands that must run first)
 */
export function getCommandDependencies(profile: CommandProfile): CommandProfile[] {
  const deps: CommandProfile[] = [];

  // Tests depend on build
  if (profile.category === 'test' || profile.category === 'playwright') {
    const buildProfile = STANDARD_PROFILES['build'];
    if (buildProfile) deps.push(buildProfile);
  }

  // Smoke tests depend on build
  if (profile.category === 'smoke') {
    const buildProfile = STANDARD_PROFILES['build'];
    if (buildProfile) deps.push(buildProfile);
  }

  // Build depends on linting
  if (profile.category === 'build') {
    const lintProfile = STANDARD_PROFILES['lint'];
    if (lintProfile) deps.push(lintProfile);
  }

  return deps;
}

/**
 * Get profile by name
 */
export function getProfile(name: string): CommandProfile | undefined {
  return STANDARD_PROFILES[name] || STANDARD_PROFILES[name.replace(/:/g, '_')];
}

/**
 * Find profiles by category
 */
export function findProfilesByCategory(category: CommandCategory): CommandProfile[] {
  return Object.values(STANDARD_PROFILES).filter((p) => p.category === category);
}

/**
 * Validate command output against profile validation rules
 */
export function validateCommandOutput(profile: CommandProfile, output: string): boolean {
  if (!profile.validation) return true;

  const { successPatterns, failurePatterns } = profile.validation;

  // Check for failure patterns first
  if (failurePatterns) {
    for (const pattern of failurePatterns) {
      if (new RegExp(pattern, 'i').test(output)) {
        return false;
      }
    }
  }

  // Check for success patterns if specified
  if (successPatterns && successPatterns.length > 0) {
    for (const pattern of successPatterns) {
      if (new RegExp(pattern, 'i').test(output)) {
        return true;
      }
    }
    return false;
  }

  return true;
}

/**
 * Create an execution result from command output
 */
export function createExecutionResult(
  profile: CommandProfile,
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
  duration: number
): CommandExecutionResult {
  const success = exitCode === 0;
  const validationPassed = validateCommandOutput(profile, stdout + stderr);

  return {
    success: success && validationPassed,
    profile,
    command,
    exitCode,
    stdout,
    stderr,
    duration,
    timestamp: new Date(),
    validationPassed,
  };
}

/**
 * Merge profiles (for customization)
 */
export function mergeProfiles(base: CommandProfile, overrides: Partial<CommandProfile>): CommandProfile {
  return {
    ...base,
    ...overrides,
    validation: {
      ...base.validation,
      ...overrides.validation,
    },
    environment: {
      ...base.environment,
      ...overrides.environment,
    },
  };
}

/**
 * Get critical profiles (commands that must succeed)
 */
export function getCriticalProfiles(): CommandProfile[] {
  return Object.values(STANDARD_PROFILES).filter((p) => p.critical);
}

/**
 * Get parallelizable profiles
 */
export function getParallelizableProfiles(): CommandProfile[] {
  return Object.values(STANDARD_PROFILES).filter((p) => p.parallel);
}
