/**
 * Full-Stack Agent Capability Definitions
 * Defines specialized capabilities and expertise for each agent role
 */

/**
 * Represents a specific capability an agent can perform
 */
export interface AgentCapability {
  /** Unique capability identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Detailed description */
  description: string;

  /** Which agent role provides this capability */
  agentRole: string;

  /** Affected development layers */
  affectedLayers: string[];

  /** Tools required to perform this capability */
  requiredTools: string[];

  /** Estimated complexity (trivial, simple, moderate, complex, expert) */
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'expert';

  /** Minimum confidence score (0-1) to consider agent capable */
  minConfidence: number;

  /** Preconditions that must be met */
  preconditions: string[];

  /** Success criteria */
  successCriteria: string[];

  /** Potential failure modes and recovery strategies */
  failureStrategies: Array<{
    failure: string;
    recovery: string;
  }>;
}

/**
 * FRONTEND Agent Capabilities
 */
export const FRONTEND_CAPABILITIES: AgentCapability[] = [
  {
    id: 'cap-frontend-component-create',
    name: 'Create React Components',
    description: 'Create new React components with hooks, props, and styling',
    agentRole: 'frontend',
    affectedLayers: ['frontend', 'tests'],
    requiredTools: ['write', 'edit', 'read', 'exec'],
    complexity: 'moderate',
    minConfidence: 0.7,
    preconditions: [
      'ui/src/ directory exists',
      'React 19.2+ installed',
      'Component specification provided',
    ],
    successCriteria: [
      'Component renders without errors',
      'Props validated with TypeScript',
      'Component story or test provided',
      'Accessibility checks pass',
    ],
    failureStrategies: [
      { failure: 'Build fails', recovery: 'Check TypeScript errors, fix imports' },
      { failure: 'Runtime error', recovery: 'Debug with console logs, check props' },
      { failure: 'Test fails', recovery: 'Review test assertions, fix component logic' },
    ],
  },
  {
    id: 'cap-frontend-styling',
    name: 'Update Component Styling',
    description: 'Modify styles, themes, and responsive layouts in React components',
    agentRole: 'frontend',
    affectedLayers: ['frontend'],
    requiredTools: ['edit', 'read', 'exec'],
    complexity: 'simple',
    minConfidence: 0.6,
    preconditions: ['UI components exist', 'CSS framework configured'],
    successCriteria: [
      'Styles apply correctly',
      'Responsive breakpoints work',
      'No layout shift on resize',
      'Accessibility maintained',
    ],
    failureStrategies: [
      { failure: 'Styles not applying', recovery: 'Check CSS specificity, clear cache' },
      { failure: 'Layout breaks', recovery: 'Review responsive grid, test viewport sizes' },
    ],
  },
  {
    id: 'cap-frontend-accessibility',
    name: 'Improve Accessibility',
    description: 'Add ARIA labels, semantic HTML, keyboard navigation, and screen reader support',
    agentRole: 'frontend',
    affectedLayers: ['frontend'],
    requiredTools: ['edit', 'read', 'exec', 'bash'],
    complexity: 'moderate',
    minConfidence: 0.75,
    preconditions: ['React components exist', 'Accessibility testing tools available'],
    successCriteria: [
      'WCAG 2.1 AA compliance verified',
      'Keyboard navigation works',
      'Screen reader announces content',
      'Color contrast meets standards',
    ],
    failureStrategies: [
      { failure: 'ARIA violations', recovery: 'Use axe DevTools to identify and fix' },
      { failure: 'Keyboard trap', recovery: 'Review focus management, fix tabindex' },
    ],
  },
  {
    id: 'cap-frontend-state-management',
    name: 'Implement State Management',
    description: 'Create state management solutions with hooks, context, or external libraries',
    agentRole: 'frontend',
    affectedLayers: ['frontend', 'tests'],
    requiredTools: ['write', 'edit', 'read', 'exec'],
    complexity: 'complex',
    minConfidence: 0.8,
    preconditions: [
      'React application structure exists',
      'Component hierarchy understood',
      'State flow documented',
    ],
    successCriteria: [
      'State updates correctly',
      'No memory leaks',
      'Components re-render efficiently',
      'Tests pass for state changes',
    ],
    failureStrategies: [
      {
        failure: 'Infinite re-renders',
        recovery: 'Check dependency arrays in useEffect',
      },
      { failure: 'State not updating', recovery: 'Verify immutability, check dispatch' },
    ],
  },
];

/**
 * BACKEND Agent Capabilities
 */
export const BACKEND_CAPABILITIES: AgentCapability[] = [
  {
    id: 'cap-backend-route-create',
    name: 'Create API Routes',
    description: 'Create new API endpoints with request validation and error handling',
    agentRole: 'backend',
    affectedLayers: ['backend', 'tests', 'data'],
    requiredTools: ['write', 'edit', 'read', 'exec'],
    complexity: 'moderate',
    minConfidence: 0.75,
    preconditions: [
      'Backend server exists',
      'API framework configured (Express, etc)',
      'Route specification provided',
    ],
    successCriteria: [
      'Route responds to HTTP requests',
      'Request validation works',
      'Error responses formatted correctly',
      'Route tests pass',
    ],
    failureStrategies: [
      { failure: '404 Not Found', recovery: 'Check route path and registration' },
      { failure: 'Validation fails', recovery: 'Review validator config, test edge cases' },
    ],
  },
  {
    id: 'cap-backend-service-create',
    name: 'Create Services',
    description: 'Build business logic services with dependency injection and error handling',
    agentRole: 'backend',
    affectedLayers: ['backend', 'tests', 'data'],
    requiredTools: ['write', 'edit', 'read', 'exec'],
    complexity: 'complex',
    minConfidence: 0.8,
    preconditions: [
      'Backend architecture understood',
      'Domain entity described',
      'Dependencies identified',
    ],
    successCriteria: [
      'Service methods work correctly',
      'Error handling comprehensive',
      'Dependencies injected properly',
      'Service tests pass',
    ],
    failureStrategies: [
      { failure: 'Circular dependency', recovery: 'Refactor service structure' },
      { failure: 'Method error', recovery: 'Add error handling, update tests' },
    ],
  },
  {
    id: 'cap-backend-validation',
    name: 'Implement Request Validation',
    description: 'Create validators for API request parameters and payload schemas',
    agentRole: 'backend',
    affectedLayers: ['backend', 'tests'],
    requiredTools: ['write', 'edit', 'read', 'exec'],
    complexity: 'simple',
    minConfidence: 0.7,
    preconditions: ['API routes exist', 'Request schema documented'],
    successCriteria: [
      'Valid requests pass validation',
      'Invalid requests rejected',
      'Error messages are helpful',
      'Validation tests pass',
    ],
    failureStrategies: [
      { failure: 'Too strict', recovery: 'Review schema, add optional fields' },
      { failure: 'Too lenient', recovery: 'Tighten constraints, add format checks' },
    ],
  },
  {
    id: 'cap-backend-security',
    name: 'Implement Security Controls',
    description: 'Add authentication, authorization, rate limiting, and input sanitization',
    agentRole: 'backend',
    affectedLayers: ['backend'],
    requiredTools: ['write', 'edit', 'read', 'bash'],
    complexity: 'expert',
    minConfidence: 0.9,
    preconditions: [
      'API routes exist',
      'Security requirements documented',
      'Auth library available',
    ],
    successCriteria: [
      'Unauthorized requests denied',
      'Rate limiting works',
      'SQL injection prevented',
      'Security tests pass',
    ],
    failureStrategies: [
      { failure: 'Auth fails', recovery: 'Check token validation, verify claims' },
      { failure: 'Bypass found', recovery: 'Update security checks, add tests' },
    ],
  },
];

/**
 * DATA Agent Capabilities
 */
export const DATA_CAPABILITIES: AgentCapability[] = [
  {
    id: 'cap-data-schema-create',
    name: 'Create Database Schemas',
    description: 'Design and create database schemas with relationships and constraints',
    agentRole: 'data',
    affectedLayers: ['data', 'backend', 'tests'],
    requiredTools: ['write', 'edit', 'read', 'exec'],
    complexity: 'moderate',
    minConfidence: 0.8,
    preconditions: ['Database system configured', 'Entity model documented'],
    successCriteria: [
      'Schema creates without errors',
      'Relationships are correct',
      'Constraints enforce data integrity',
      'Schema tests pass',
    ],
    failureStrategies: [
      { failure: 'Migration fails', recovery: 'Check existing data compatibility' },
      { failure: 'Constraint violation', recovery: 'Review unique/foreign key constraints' },
    ],
  },
  {
    id: 'cap-data-migration-create',
    name: 'Create Database Migrations',
    description: 'Write safe database migrations with rollback capability',
    agentRole: 'data',
    affectedLayers: ['data'],
    requiredTools: ['write', 'edit', 'read', 'exec'],
    complexity: 'complex',
    minConfidence: 0.85,
    preconditions: ['Migration system configured', 'Schema changes documented'],
    successCriteria: [
      'Migration applies successfully',
      'Rollback works correctly',
      'No data loss',
      'Migration tested',
    ],
    failureStrategies: [
      { failure: 'Deadlock', recovery: 'Adjust migration script timing' },
      { failure: 'Data loss', recovery: 'Restore backup, revise migration' },
    ],
  },
  {
    id: 'cap-data-persistence',
    name: 'Implement Data Persistence',
    description: 'Create repository/ORM layer for data access and manipulation',
    agentRole: 'data',
    affectedLayers: ['data', 'backend', 'tests'],
    requiredTools: ['write', 'edit', 'read', 'exec'],
    complexity: 'moderate',
    minConfidence: 0.75,
    preconditions: ['Database schema exists', 'ORM configured'],
    successCriteria: [
      'CRUD operations work',
      'Queries are efficient',
      'Connections managed properly',
      'Persistence tests pass',
    ],
    failureStrategies: [
      { failure: 'Query timeout', recovery: 'Add indexes, optimize query' },
      { failure: 'Connection leak', recovery: 'Review connection pooling' },
    ],
  },
  {
    id: 'cap-data-seeding',
    name: 'Create Seed Data',
    description: 'Generate test and development seed data for database population',
    agentRole: 'data',
    affectedLayers: ['data'],
    requiredTools: ['write', 'edit', 'read', 'exec'],
    complexity: 'simple',
    minConfidence: 0.6,
    preconditions: ['Database exists', 'Seed structure defined'],
    successCriteria: [
      'Seed data loads without errors',
      'Data matches schema',
      'Seed script is idempotent',
    ],
    failureStrategies: [
      { failure: 'Duplicate key', recovery: 'Make seed idempotent with upsert' },
      { failure: 'Invalid data', recovery: 'Validate data against schema' },
    ],
  },
];

/**
 * TEST Agent Capabilities
 */
export const TEST_CAPABILITIES: AgentCapability[] = [
  {
    id: 'cap-test-unit-create',
    name: 'Create Unit Tests',
    description: 'Write unit tests for individual functions and modules',
    agentRole: 'test',
    affectedLayers: ['tests'],
    requiredTools: ['write', 'edit', 'read', 'exec'],
    complexity: 'moderate',
    minConfidence: 0.7,
    preconditions: ['Test framework configured', 'Code to test exists'],
    successCriteria: [
      'Tests pass',
      'Coverage >80%',
      'Edge cases covered',
      'No flaky tests',
    ],
    failureStrategies: [
      { failure: 'Test fails', recovery: 'Review test logic, fix implementation' },
      { failure: 'Timeout', recovery: 'Mock slow operations, add timeouts' },
    ],
  },
  {
    id: 'cap-test-integration-create',
    name: 'Create Integration Tests',
    description: 'Write integration tests that verify multiple components working together',
    agentRole: 'test',
    affectedLayers: ['tests'],
    requiredTools: ['write', 'edit', 'read', 'exec'],
    complexity: 'complex',
    minConfidence: 0.8,
    preconditions: [
      'Components exist',
      'Test infrastructure available',
      'Integration points documented',
    ],
    successCriteria: [
      'Integration tests pass',
      'Component communication verified',
      'Error scenarios tested',
    ],
    failureStrategies: [
      { failure: 'Flaky test', recovery: 'Add waits, fix race conditions' },
      { failure: 'Setup fails', recovery: 'Mock external dependencies' },
    ],
  },
  {
    id: 'cap-test-browser-create',
    name: 'Create Browser Tests',
    description: 'Write Playwright end-to-end tests for user interactions',
    agentRole: 'test',
    affectedLayers: ['tests', 'frontend'],
    requiredTools: ['write', 'edit', 'read', 'exec', 'bash'],
    complexity: 'complex',
    minConfidence: 0.75,
    preconditions: [
      'Application running',
      'Playwright configured',
      'Test scenarios documented',
    ],
    successCriteria: [
      'E2E tests pass',
      'User flows verified',
      'UI responsive in browsers',
      'Screenshots generated',
    ],
    failureStrategies: [
      { failure: 'Navigation fails', recovery: 'Check URLs, add waits' },
      { failure: 'Element not found', recovery: 'Update selectors, fix HTML' },
    ],
  },
  {
    id: 'cap-test-coverage',
    name: 'Measure Test Coverage',
    description: 'Generate and analyze code coverage reports to identify gaps',
    agentRole: 'test',
    affectedLayers: ['tests'],
    requiredTools: ['read', 'exec', 'bash'],
    complexity: 'simple',
    minConfidence: 0.6,
    preconditions: ['Tests exist', 'Coverage tools configured'],
    successCriteria: [
      'Coverage report generated',
      'Coverage meets threshold',
      'Gaps identified and documented',
    ],
    failureStrategies: [
      { failure: 'Coverage low', recovery: 'Write more tests for uncovered code' },
    ],
  },
];

/**
 * REVIEWER Agent Capabilities
 */
export const REVIEWER_CAPABILITIES: AgentCapability[] = [
  {
    id: 'cap-review-code-quality',
    name: 'Review Code Quality',
    description: 'Review code for readability, maintainability, and best practices',
    agentRole: 'reviewer',
    affectedLayers: [],
    requiredTools: ['read', 'bash'],
    complexity: 'moderate',
    minConfidence: 0.8,
    preconditions: ['Code changes exist'],
    successCriteria: [
      'Code follows style guide',
      'No code smells identified',
      'Performance issues addressed',
      'Suggestions are actionable',
    ],
    failureStrategies: [
      { failure: 'False positive', recovery: 'Update review criteria' },
    ],
  },
  {
    id: 'cap-review-security',
    name: 'Review Security',
    description: 'Review code for security vulnerabilities and best practices',
    agentRole: 'reviewer',
    affectedLayers: [],
    requiredTools: ['read', 'bash'],
    complexity: 'expert',
    minConfidence: 0.9,
    preconditions: ['Code changes exist', 'Security policies documented'],
    successCriteria: [
      'No vulnerabilities found',
      'Secrets not committed',
      'Permissions validated',
      'Security best practices followed',
    ],
    failureStrategies: [
      {
        failure: 'Vulnerability missed',
        recovery: 'Update security checks, add test',
      },
    ],
  },
  {
    id: 'cap-review-testing',
    name: 'Review Test Coverage',
    description: 'Review test coverage and quality for changes',
    agentRole: 'reviewer',
    affectedLayers: [],
    requiredTools: ['read', 'bash'],
    complexity: 'moderate',
    minConfidence: 0.75,
    preconditions: ['Tests exist'],
    successCriteria: [
      'Coverage adequate',
      'Edge cases tested',
      'Mocks appropriate',
      'Tests are maintainable',
    ],
    failureStrategies: [
      { failure: 'Tests weak', recovery: 'Suggest additional test scenarios' },
    ],
  },
];

/**
 * DOCUMENTATION Agent Capabilities
 */
export const DOCUMENTATION_CAPABILITIES: AgentCapability[] = [
  {
    id: 'cap-doc-api-docs',
    name: 'Create API Documentation',
    description: 'Write comprehensive API documentation with examples and schemas',
    agentRole: 'documentation',
    affectedLayers: ['docs'],
    requiredTools: ['write', 'edit', 'read'],
    complexity: 'moderate',
    minConfidence: 0.7,
    preconditions: ['API endpoints exist', 'Schemas defined'],
    successCriteria: [
      'All endpoints documented',
      'Examples provided',
      'Parameters explained',
      'Error codes listed',
    ],
    failureStrategies: [
      { failure: 'Documentation outdated', recovery: 'Update with new API' },
    ],
  },
  {
    id: 'cap-doc-readme',
    name: 'Update README',
    description: 'Write and update README with setup, usage, and configuration instructions',
    agentRole: 'documentation',
    affectedLayers: ['docs'],
    requiredTools: ['write', 'edit', 'read'],
    complexity: 'simple',
    minConfidence: 0.6,
    preconditions: ['Project structure understood'],
    successCriteria: [
      'README is complete',
      'Instructions are clear',
      'Commands work as documented',
    ],
    failureStrategies: [
      { failure: 'Steps incomplete', recovery: 'Add missing setup steps' },
    ],
  },
  {
    id: 'cap-doc-examples',
    name: 'Create Usage Examples',
    description: 'Write practical examples and tutorials for using features',
    agentRole: 'documentation',
    affectedLayers: ['docs'],
    requiredTools: ['write', 'edit', 'read'],
    complexity: 'moderate',
    minConfidence: 0.7,
    preconditions: ['Features implemented', 'Documentation template ready'],
    successCriteria: [
      'Examples runnable',
      'Usage is clear',
      'Common patterns covered',
    ],
    failureStrategies: [
      { failure: 'Example fails', recovery: 'Test and fix example code' },
    ],
  },
];

/**
 * Gets all capabilities for a specific agent role
 */
export function getCapabilitiesForRole(roleId: string): AgentCapability[] {
  const roleMap: Record<string, AgentCapability[]> = {
    frontend: FRONTEND_CAPABILITIES,
    backend: BACKEND_CAPABILITIES,
    data: DATA_CAPABILITIES,
    test: TEST_CAPABILITIES,
    reviewer: REVIEWER_CAPABILITIES,
    documentation: DOCUMENTATION_CAPABILITIES,
  };

  return roleMap[roleId] || [];
}

/**
 * Gets all capabilities across all roles
 */
export function getAllCapabilities(): AgentCapability[] {
  return [
    ...FRONTEND_CAPABILITIES,
    ...BACKEND_CAPABILITIES,
    ...DATA_CAPABILITIES,
    ...TEST_CAPABILITIES,
    ...REVIEWER_CAPABILITIES,
    ...DOCUMENTATION_CAPABILITIES,
  ];
}

/**
 * Finds capabilities for specific development layer
 */
export function getCapabilitiesByLayer(layer: string): AgentCapability[] {
  return getAllCapabilities().filter(cap => cap.affectedLayers.includes(layer));
}

/**
 * Finds capabilities requiring specific tool
 */
export function getCapabilitiesByTool(tool: string): AgentCapability[] {
  return getAllCapabilities().filter(cap => cap.requiredTools.includes(tool));
}
