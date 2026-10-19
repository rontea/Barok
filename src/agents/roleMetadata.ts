/**
 * Agent Role Metadata System
 * Defines specialized roles for full-stack development with ownership boundaries and tool allowlists
 */

/**
 * Escalation rule for agent task failures
 */
export interface EscalationRule {
  /** Condition that triggers escalation */
  condition: string;
  /** Which role to escalate to */
  escalateTo: string;
  /** Why escalation is needed */
  reason: string;
}

/**
 * Verification command for role-specific checks
 */
export interface VerificationCommand {
  /** Command name (e.g., 'lint', 'test', 'build') */
  name: string;
  /** Shell command to execute */
  command: string;
  /** Expected output pattern or exit code */
  expectation: string;
  /** Is this verification required before completion? */
  required: boolean;
}

/**
 * Agent Role Metadata
 * Defines specialization, ownership, tools, and verification for a role
 */
export interface AgentRoleMetadata {
  /** Unique role identifier */
  id: string;

  /** Human-readable role name */
  name: string;

  /** Role description and purpose */
  purpose: string;

  /** File paths this role owns and can safely modify */
  ownedPaths: string[];

  /** File patterns this role can read but not modify */
  readablePaths: string[];

  /** File patterns this role cannot access */
  excludedPaths: string[];

  /** Tools allowed for this role */
  allowedTools: string[];

  /** Preferred LLM model tier for this role's tasks */
  preferredModelTier: 'ultra-cheap' | 'cheap' | 'balanced' | 'capable' | 'expert';

  /** Verification commands to run after this role completes work */
  verificationCommands: VerificationCommand[];

  /** Rules for escalating tasks when this role encounters issues */
  escalationRules: EscalationRule[];

  /** Related roles that might collaborate with this one */
  collaboratesWith: string[];

  /** Expertise areas for this role */
  expertiseAreas: string[];
}

/**
 * FrontendAgent Metadata
 * Specializes in React UI, components, styling, accessibility, and browser behavior
 */
export const FRONTEND_AGENT_METADATA: AgentRoleMetadata = {
  id: 'frontend',
  name: 'FrontendAgent',
  purpose:
    'Handles React UI development, component structure, styling, accessibility, and browser behavior',
  ownedPaths: [
    'ui/src/**/*.tsx',
    'ui/src/**/*.ts',
    'ui/src/**/*.css',
    'ui/src/components/**',
    'ui/src/App.tsx',
  ],
  readablePaths: ['src/**', 'docs/**', 'package.json', 'tsconfig.json', 'vite.config.ts'],
  excludedPaths: ['vscode-extension/**', 'server.ts', 'src/server/**'],
  allowedTools: [
    'Write',
    'Edit',
    'Read',
    'Glob',
    'Grep',
    'Bash', // For Vite dev server, build, etc.
  ],
  preferredModelTier: 'capable',
  verificationCommands: [
    {
      name: 'typescript',
      command: 'npx tsc --noEmit ui/',
      expectation: 'exit code 0',
      required: true,
    },
    {
      name: 'lint',
      command: 'npx eslint ui/src/',
      expectation: 'no errors',
      required: true,
    },
    {
      name: 'build',
      command: 'npx vite build',
      expectation: 'success with dist/ folder',
      required: true,
    },
    {
      name: 'responsive',
      command: 'npx playwright test --project="Desktop Responsive"',
      expectation: '0 failures',
      required: false,
    },
    {
      name: 'accessibility',
      command: 'npm run test -- ui',
      expectation: 'accessibility tests pass',
      required: false,
    },
  ],
  escalationRules: [
    {
      condition: 'API integration needed',
      escalateTo: 'backend',
      reason: 'API routes and contracts outside frontend scope',
    },
    {
      condition: 'Build or tooling failure',
      escalateTo: 'reviewer',
      reason: 'Tooling issues need broader context review',
    },
  ],
  collaboratesWith: ['backend', 'test', 'documentation'],
  expertiseAreas: [
    'React hooks and component composition',
    'CSS and responsive design',
    'Accessibility (a11y) standards',
    'TypeScript component types',
    'Client-side state management',
    'Browser APIs and DOM manipulation',
  ],
};

/**
 * BackendAgent Metadata
 * Specializes in API routes, services, validation, auth boundaries, and server-side behavior
 */
export const BACKEND_AGENT_METADATA: AgentRoleMetadata = {
  id: 'backend',
  name: 'BackendAgent',
  purpose:
    'Handles API routes, services, validation, authentication boundaries, and server-side behavior',
  ownedPaths: ['src/**/*.ts', 'server.ts', 'src/react/**', 'src/agents/**', 'src/utils/**'],
  readablePaths: ['ui/src', 'docs', 'package.json', 'tsconfig.json'],
  excludedPaths: ['ui/src/**', 'vscode-extension/**', 'docs/**'],
  allowedTools: [
    'Write',
    'Edit',
    'Read',
    'Glob',
    'Grep',
    'Bash', // For running server, tests, etc.
  ],
  preferredModelTier: 'expert',
  verificationCommands: [
    {
      name: 'typescript',
      command: 'npx tsc --noEmit src/',
      expectation: 'exit code 0',
      required: true,
    },
    {
      name: 'lint',
      command: 'npx eslint src/',
      expectation: 'no errors',
      required: true,
    },
    {
      name: 'build',
      command: 'npm run build',
      expectation: 'exit code 0 with dist folder',
      required: true,
    },
    {
      name: 'tests',
      command: 'npm test',
      expectation: '178+ tests passing',
      required: true,
    },
    {
      name: 'server-health',
      command: 'node dist/server.js --health-check',
      expectation: 'server starts without errors',
      required: false,
    },
  ],
  escalationRules: [
    {
      condition: 'UI changes needed',
      escalateTo: 'frontend',
      reason: 'UI rendering outside backend scope',
    },
    {
      condition: 'Test coverage below threshold',
      escalateTo: 'test',
      reason: 'Test strategy review needed',
    },
  ],
  collaboratesWith: ['frontend', 'data', 'test', 'reviewer'],
  expertiseAreas: [
    'API design and RESTful patterns',
    'TypeScript backend services',
    'Error handling and validation',
    'Authentication and authorization',
    'Performance optimization',
    'Logging and monitoring',
  ],
};

/**
 * DataAgent Metadata
 * Specializes in schemas, persistence, migrations, seed data, and data contracts
 */
export const DATA_AGENT_METADATA: AgentRoleMetadata = {
  id: 'data',
  name: 'DataAgent',
  purpose:
    'Handles schemas, persistence, migrations, seed data, and data contracts between UI and backend',
  ownedPaths: [
    'src/data/**',
    'src/types/schemas.ts',
    'migrations/**',
    'seeds/**',
    'src/db/**',
  ],
  readablePaths: ['src/**', 'ui/src', 'docs', 'package.json'],
  excludedPaths: ['ui/src/**', 'vscode-extension/**'],
  allowedTools: [
    'Write',
    'Edit',
    'Read',
    'Glob',
    'Grep',
    'Bash', // For running migrations, seeders
  ],
  preferredModelTier: 'capable',
  verificationCommands: [
    {
      name: 'schema-validation',
      command: 'npm run test -- src/types',
      expectation: 'schema tests pass',
      required: true,
    },
    {
      name: 'migrations',
      command: 'npm run migrations:validate',
      expectation: 'all migrations valid',
      required: false,
    },
    {
      name: 'seed-integrity',
      command: 'npm run seed:verify',
      expectation: 'seed data valid',
      required: false,
    },
  ],
  escalationRules: [
    {
      condition: 'API contract changes needed',
      escalateTo: 'backend',
      reason: 'API changes affect data flow',
    },
    {
      condition: 'UI data display issues',
      escalateTo: 'frontend',
      reason: 'Data transformation for rendering needed',
    },
  ],
  collaboratesWith: ['backend', 'frontend', 'test'],
  expertiseAreas: [
    'Database schema design',
    'Data persistence patterns',
    'Schema migrations',
    'Data validation and contracts',
    'Seed data management',
    'Serialization and deserialization',
  ],
};

/**
 * TestAgent Metadata
 * Specializes in unit, integration, smoke, and Playwright test coverage
 */
export const TEST_AGENT_METADATA: AgentRoleMetadata = {
  id: 'test',
  name: 'TestAgent',
  purpose:
    'Handles unit testing, integration testing, smoke testing, and Playwright e2e verification',
  ownedPaths: [
    'src/**/__tests__/**',
    '**/*.test.ts',
    '**/*.spec.ts',
    'tests/**',
    'jest.config.cjs',
    'playwright.config.ts',
  ],
  readablePaths: ['src/**', 'ui/src', 'docs', 'package.json'],
  excludedPaths: [],
  allowedTools: [
    'Write',
    'Edit',
    'Read',
    'Glob',
    'Grep',
    'Bash', // For running tests
  ],
  preferredModelTier: 'balanced',
  verificationCommands: [
    {
      name: 'unit-tests',
      command: 'npm test',
      expectation: '178+ tests passing',
      required: true,
    },
    {
      name: 'test-coverage',
      command: 'npm run test:coverage',
      expectation: 'coverage report generated',
      required: false,
    },
  ],
  escalationRules: [
    {
      condition: 'Test failures indicate logic errors',
      escalateTo: 'backend',
      reason: 'Logic bugs need backend fix',
    },
    {
      condition: 'UI test failures',
      escalateTo: 'frontend',
      reason: 'Component or rendering issues',
    },
  ],
  collaboratesWith: ['backend', 'frontend', 'reviewer'],
  expertiseAreas: [
    'Unit test design and mocking',
    'Integration test patterns',
    'Test coverage analysis',
    'Playwright e2e testing',
    'Test data setup',
    'Continuous integration',
  ],
};

/**
 * ReviewerAgent Metadata
 * Specializes in code quality, security auditing, best practices, and consistency validation
 */
export const REVIEWER_AGENT_METADATA: AgentRoleMetadata = {
  id: 'reviewer',
  name: 'ReviewerAgent',
  purpose: 'Handles code quality validation, security auditing, and best practices enforcement',
  ownedPaths: [], // Reviewer doesn't own files, audits all
  readablePaths: ['**'], // Can read everything
  excludedPaths: ['node_modules/**', 'dist/**', '.git/**'],
  allowedTools: [
    'Read',
    'Glob',
    'Grep',
    'Bash', // For running linters, security scanners
  ],
  preferredModelTier: 'expert',
  verificationCommands: [
    {
      name: 'lint',
      command: 'npx eslint src/ ui/src/',
      expectation: 'no errors',
      required: true,
    },
    {
      name: 'type-check',
      command: 'npx tsc --noEmit',
      expectation: 'exit code 0',
      required: true,
    },
    {
      name: 'security-audit',
      command: 'npm audit',
      expectation: 'no critical vulnerabilities',
      required: false,
    },
  ],
  escalationRules: [
    {
      condition: 'Critical security issue found',
      escalateTo: 'backend',
      reason: 'Security fixes need backend implementation',
    },
  ],
  collaboratesWith: ['backend', 'frontend', 'test'],
  expertiseAreas: [
    'Code quality assessment',
    'Functional correctness',
    'Security vulnerability detection',
    'Performance profiling',
    'Consistency validation',
    'Best practices adherence',
    'Test coverage analysis',
  ],
};

/**
 * DocumentationAgent Metadata
 * Specializes in README, API docs, changelog, usage examples, and migration notes
 */
export const DOCUMENTATION_AGENT_METADATA: AgentRoleMetadata = {
  id: 'documentation',
  name: 'DocumentationAgent',
  purpose:
    'Handles README, API documentation, changelog, usage examples, and migration notes',
  ownedPaths: [
    'docs/**',
    'README.md',
    'CHANGELOG.md',
    'CONTRIBUTING.md',
    'docs/**/*.md',
  ],
  readablePaths: ['src/**', 'ui/src', 'package.json'],
  excludedPaths: ['tests/**', 'vscode-extension/**'],
  allowedTools: [
    'Write',
    'Edit',
    'Read',
    'Glob',
    'Grep',
  ],
  preferredModelTier: 'cheap',
  verificationCommands: [
    {
      name: 'markdown-links',
      command: 'npm run docs:validate-links',
      expectation: 'no broken links',
      required: true,
    },
    {
      name: 'code-examples',
      command: 'npm run docs:validate-examples',
      expectation: 'all code examples valid',
      required: false,
    },
  ],
  escalationRules: [
    {
      condition: 'Documentation of new API features',
      escalateTo: 'backend',
      reason: 'API details need backend confirmation',
    },
    {
      condition: 'UI component documentation',
      escalateTo: 'frontend',
      reason: 'Component behavior details needed',
    },
  ],
  collaboratesWith: ['backend', 'frontend'],
  expertiseAreas: [
    'Technical writing',
    'API documentation',
    'Code examples and tutorials',
    'Changelog management',
    'README creation',
    'Migration guides',
  ],
};

/**
 * Get all defined role metadata
 */
export const ALL_ROLE_METADATA: Record<string, AgentRoleMetadata> = {
  frontend: FRONTEND_AGENT_METADATA,
  backend: BACKEND_AGENT_METADATA,
  data: DATA_AGENT_METADATA,
  test: TEST_AGENT_METADATA,
  reviewer: REVIEWER_AGENT_METADATA,
  documentation: DOCUMENTATION_AGENT_METADATA,
};

/**
 * Get metadata for a specific role
 */
export function getRoleMetadata(roleId: string): AgentRoleMetadata | undefined {
  return ALL_ROLE_METADATA[roleId];
}

/**
 * Get all role IDs
 */
export function getAllRoleIds(): string[] {
  return Object.keys(ALL_ROLE_METADATA);
}

/**
 * Get all roles as array
 */
export function getAllRoles(): AgentRoleMetadata[] {
  return Object.values(ALL_ROLE_METADATA);
}
