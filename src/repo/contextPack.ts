/**
 * Context Pack Builder
 * Builds targeted context for specific agents based on role and task
 */

import type { RepositoryMap } from './repositoryMap.js';

/**
 * Context pack for a specific agent
 */
export interface ContextPack {
  agentRole: string; // 'frontend', 'backend', 'data', 'test', 'reviewer', 'documentation'
  relevantPaths: string[]; // Paths relevant to this agent's role
  sourceRoots: string[]; // Source roots this agent should focus on
  relatedTests: string[]; // Test patterns relevant to this agent
  documentationRefs: string[]; // Doc files relevant to this agent
  entryPoints: string[]; // Entry points this agent may need to understand
  warnings: string[]; // Context-specific warnings
}

/**
 * Builds context pack for a frontend agent
 */
export function buildFrontendContextPack(repoMap: RepositoryMap): ContextPack {
  return {
    agentRole: 'frontend',
    relevantPaths: ['ui/src/**', 'ui/**/*.tsx', 'ui/**/*.ts', 'ui/**/*.css'],
    sourceRoots: ['ui/src'],
    relatedTests: ['ui/**/__tests__', 'ui/**/*.test.ts', 'ui/**/*.spec.ts'],
    documentationRefs: repoMap.docs
      .filter((d) => d.name === 'README' || d.path.includes('UI'))
      .map((d) => d.path),
    entryPoints: repoMap.entryPoints
      .filter((ep) => ep.type === 'ui')
      .map((ep) => ep.path),
    warnings: repoMap.packageFiles.some((f) => f.name === 'vite.config.ts')
      ? []
      : ['vite.config.ts not found - build may fail'],
  };
}

/**
 * Builds context pack for a backend agent
 */
export function buildBackendContextPack(repoMap: RepositoryMap): ContextPack {
  return {
    agentRole: 'backend',
    relevantPaths: [
      'src/**',
      'src/**/*.ts',
      'server.ts',
      'package.json',
      'tsconfig.json',
    ],
    sourceRoots: ['src'],
    relatedTests: ['src/**/__tests__', 'src/**/*.test.ts', 'tests/**'],
    documentationRefs: repoMap.docs
      .filter((d) => d.name === 'README' || d.name === 'API')
      .map((d) => d.path),
    entryPoints: repoMap.entryPoints
      .filter((ep) => ep.type === 'server' || ep.type === 'cli')
      .map((ep) => ep.path),
    warnings: repoMap.packageFiles.some((f) => f.name === 'tsconfig.json')
      ? []
      : ['tsconfig.json not found - TypeScript build may fail'],
  };
}

/**
 * Builds context pack for a data agent
 */
export function buildDataContextPack(repoMap: RepositoryMap): ContextPack {
  return {
    agentRole: 'data',
    relevantPaths: [
      'src/data/**',
      'src/types/**',
      'migrations/**',
      'seeds/**',
      'src/db/**',
    ],
    sourceRoots: ['src/data', 'src/types'],
    relatedTests: ['src/data/**/__tests__', 'src/types/**/__tests__'],
    documentationRefs: repoMap.docs
      .filter((d) => d.name === 'README')
      .map((d) => d.path),
    entryPoints: [],
    warnings: [],
  };
}

/**
 * Builds context pack for a test agent
 */
export function buildTestContextPack(repoMap: RepositoryMap): ContextPack {
  return {
    agentRole: 'test',
    relevantPaths: [
      'src/**/__tests__/**',
      '**/*.test.ts',
      '**/*.spec.ts',
      'tests/**',
      'jest.config.cjs',
      'playwright.config.ts',
    ],
    sourceRoots: ['tests'],
    relatedTests: repoMap.tests.map((t) => t.pattern),
    documentationRefs: [],
    entryPoints: [],
    warnings: [],
  };
}

/**
 * Builds context pack for a reviewer agent
 */
export function buildReviewerContextPack(repoMap: RepositoryMap): ContextPack {
  return {
    agentRole: 'reviewer',
    relevantPaths: ['**', '!node_modules/**', '!dist/**', '!.git/**'],
    sourceRoots: repoMap.sourceRoots.map((sr) => sr.path),
    relatedTests: repoMap.tests.map((t) => t.pattern),
    documentationRefs: repoMap.docs.map((d) => d.path),
    entryPoints: repoMap.entryPoints.map((ep) => ep.path),
    warnings: [],
  };
}

/**
 * Builds context pack for a documentation agent
 */
export function buildDocumentationContextPack(repoMap: RepositoryMap): ContextPack {
  return {
    agentRole: 'documentation',
    relevantPaths: [
      'docs/**',
      'README.md',
      'CHANGELOG.md',
      'CONTRIBUTING.md',
      'API_*.md',
      'IMPLEMENTATION_*.md',
    ],
    sourceRoots: repoMap.sourceRoots.map((sr) => sr.path),
    relatedTests: [],
    documentationRefs: repoMap.docs.map((d) => d.path),
    entryPoints: repoMap.entryPoints.map((ep) => ep.path),
    warnings: [],
  };
}

/**
 * Builds context pack for specified agent role
 */
export function buildContextPack(
  role: string,
  repoMap: RepositoryMap
): ContextPack {
  switch (role) {
    case 'frontend':
      return buildFrontendContextPack(repoMap);
    case 'backend':
      return buildBackendContextPack(repoMap);
    case 'data':
      return buildDataContextPack(repoMap);
    case 'test':
      return buildTestContextPack(repoMap);
    case 'reviewer':
      return buildReviewerContextPack(repoMap);
    case 'documentation':
      return buildDocumentationContextPack(repoMap);
    default:
      throw new Error(`Unknown agent role: ${role}`);
  }
}

/**
 * Builds context packs for all agent roles
 */
export function buildAllContextPacks(repoMap: RepositoryMap): Record<string, ContextPack> {
  return {
    frontend: buildFrontendContextPack(repoMap),
    backend: buildBackendContextPack(repoMap),
    data: buildDataContextPack(repoMap),
    test: buildTestContextPack(repoMap),
    reviewer: buildReviewerContextPack(repoMap),
    documentation: buildDocumentationContextPack(repoMap),
  };
}
