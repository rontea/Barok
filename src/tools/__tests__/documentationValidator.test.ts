/**
 * Documentation Validator Tests
 * Phase 8.4: Validates documentation updates for public interface changes
 */

import {
  PublicInterfaceItem,
  InterfaceChange,
  CodeExample,
  ExampleValidationResult,
  DocumentationGap,
  extractPublicInterface,
  detectInterfaceChanges,
  validateBreakingChangeDocumentation,
  validateCodeExamples,
  validateReadmeUpdates,
  generateChangelogEntries,
  calculateDocumentationScore,
  generateDocumentationRecommendations,
  generateDocumentationValidationReport
} from '../documentationValidator';

describe('Documentation Validator', () => {
  // Test 1: Extract public interface from source code
  it('should extract exported functions, classes, and interfaces', () => {
    const sourceCode = `
      export function getUserById(id: string) { }
      export async function fetchData() { }
      export class UserService { }
      export interface IUser { }
      export const API_VERSION = '1.0.0';
    `;

    const items = extractPublicInterface(sourceCode);

    expect(items).toHaveLength(5);
    expect(items).toContainEqual(expect.objectContaining({ name: 'getUserById', type: 'function' }));
    expect(items).toContainEqual(expect.objectContaining({ name: 'fetchData', type: 'function' }));
    expect(items).toContainEqual(expect.objectContaining({ name: 'UserService', type: 'class' }));
    expect(items).toContainEqual(expect.objectContaining({ name: 'IUser', type: 'interface' }));
    expect(items).toContainEqual(expect.objectContaining({ name: 'API_VERSION', type: 'constant' }));
  });

  // Test 2: Detect added functions (non-breaking)
  it('should detect added functions as non-breaking changes', () => {
    const oldInterface: PublicInterfaceItem[] = [];
    const newInterface: PublicInterfaceItem[] = [
      {
        name: 'createUser',
        type: 'function',
        signature: 'function createUser(name: string)',
        parameters: ['name'],
        isExported: true
      }
    ];

    const changes = detectInterfaceChanges(oldInterface, newInterface);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      itemName: 'createUser',
      changeType: 'added',
      isBreaking: false
    });
  });

  // Test 3: Detect removed functions (breaking)
  it('should detect removed functions as breaking changes', () => {
    const oldInterface: PublicInterfaceItem[] = [
      {
        name: 'deleteUser',
        type: 'function',
        signature: 'function deleteUser(id: string)',
        isExported: true
      }
    ];
    const newInterface: PublicInterfaceItem[] = [];

    const changes = detectInterfaceChanges(oldInterface, newInterface);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      itemName: 'deleteUser',
      changeType: 'removed',
      isBreaking: true
    });
  });

  // Test 4: Detect function signature changes (breaking)
  it('should detect signature changes as breaking when parameters change', () => {
    const oldInterface: PublicInterfaceItem[] = [
      {
        name: 'updateUser',
        type: 'function',
        signature: 'function updateUser(id: string)',
        parameters: ['id'],
        isExported: true
      }
    ];
    const newInterface: PublicInterfaceItem[] = [
      {
        name: 'updateUser',
        type: 'function',
        signature: 'function updateUser(id: string, data: object)',
        parameters: ['id', 'data'],
        isExported: true
      }
    ];

    const changes = detectInterfaceChanges(oldInterface, newInterface);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      itemName: 'updateUser',
      changeType: 'modified',
      isBreaking: true
    });
  });

  // Test 5: Validate breaking change documentation
  it('should flag undocumented breaking changes', () => {
    const changes: InterfaceChange[] = [
      {
        itemName: 'deleteUser',
        itemType: 'function',
        changeType: 'removed',
        isBreaking: true,
        details: 'Function was removed',
        affectedDocuments: ['API.md']
      }
    ];

    const documentation = 'This is the API documentation without the breaking change';
    const changelog = 'No mention of deleteUser';

    const gaps = validateBreakingChangeDocumentation(changes, documentation, changelog);

    expect(gaps.length).toBeGreaterThan(0);
    // Should have at least one gap for the missing documentation
    expect(gaps.some(g => g.itemName === 'deleteUser')).toBe(true);
    expect(gaps.some(g => g.severity === 'critical' || g.severity === 'high')).toBe(true);
  });

  // Test 6: Validate documented breaking changes
  it('should not flag breaking changes that are documented', () => {
    const changes: InterfaceChange[] = [
      {
        itemName: 'getUser',
        itemType: 'function',
        changeType: 'removed',
        isBreaking: true,
        details: 'Function was removed',
        affectedDocuments: ['API.md']
      }
    ];

    const documentation = 'The getUser function is deprecated';
    const changelog = 'BREAKING: getUser function has been removed';

    const gaps = validateBreakingChangeDocumentation(changes, documentation, changelog);

    expect(gaps.length).toBe(0);
  });

  // Test 7: Validate code examples
  it('should validate code examples for syntax and structure', () => {
    const examples: CodeExample[] = [
      {
        id: 'ex1',
        code: 'import { getUser } from "./api";\nasync function main() {\n  const user = await getUser(id);\n}',
        language: 'javascript',
        filePath: 'README.md',
        lineRange: { start: 10, end: 13 }
      },
      {
        id: 'ex2',
        code: '', // Empty code
        language: 'javascript',
        filePath: 'README.md',
        lineRange: { start: 20, end: 20 }
      }
    ];

    const results = validateCodeExamples(examples, '');

    expect(results).toHaveLength(2);
    expect(results[0].isValid).toBe(true);
    expect(results[1].isValid).toBe(false);
    expect(results[1].errors).toContain('Example code is empty');
  });

  // Test 8: Validate invalid async/await usage in examples
  it('should detect invalid await usage outside async function', () => {
    const examples: CodeExample[] = [
      {
        id: 'ex-bad',
        code: 'const result = await fetchData();', // await without async
        language: 'javascript',
        filePath: 'README.md',
        lineRange: { start: 1, end: 1 }
      }
    ];

    const results = validateCodeExamples(examples, '');

    expect(results[0].errors).toContainEqual(expect.stringContaining('await'));
  });

  // Test 9: Validate README updates for breaking changes
  it('should require migration guide in README for breaking changes', () => {
    const changes: InterfaceChange[] = [
      {
        itemName: 'oldAPI',
        itemType: 'function',
        changeType: 'removed',
        isBreaking: true,
        details: 'API removed',
        affectedDocuments: ['API.md']
      }
    ];

    const readmeWithoutGuide = '# Project\n## Installation';
    const gaps = validateReadmeUpdates(changes, readmeWithoutGuide);

    expect(gaps.some(g => g.type === 'missing-readme-update')).toBe(true);
  });

  // Test 10: Accept README with migration guide
  it('should not flag README when migration guide is present', () => {
    const changes: InterfaceChange[] = [
      {
        itemName: 'oldAPI',
        itemType: 'function',
        changeType: 'removed',
        isBreaking: true,
        details: 'API removed',
        affectedDocuments: ['API.md']
      }
    ];

    const readmeWithGuide = '# Project\n## Migration Guide\nUpdate your code to use newAPI instead';
    const gaps = validateReadmeUpdates(changes, readmeWithGuide);

    expect(gaps.filter(g => g.type === 'missing-readme-update' && g.itemName === 'Migration Guide')).toHaveLength(0);
  });

  // Test 11: Generate changelog entries
  it('should generate changelog entries from interface changes', () => {
    const changes: InterfaceChange[] = [
      {
        itemName: 'newFunction',
        itemType: 'function',
        changeType: 'added',
        isBreaking: false,
        details: 'Added new function',
        affectedDocuments: []
      },
      {
        itemName: 'oldFunction',
        itemType: 'function',
        changeType: 'removed',
        isBreaking: true,
        details: 'Removed old function',
        affectedDocuments: []
      }
    ];

    const entry = generateChangelogEntries(changes, '2.0.0');

    expect(entry.version).toBe('2.0.0');
    expect(entry.breaking).toBe(true);
    expect(entry.changes.added).toContainEqual(expect.stringContaining('newFunction'));
    expect(entry.changes.removed).toContainEqual(expect.stringContaining('oldFunction'));
  });

  // Test 12: Calculate documentation score
  it('should calculate decreasing score based on documentation gaps', () => {
    const gaps: DocumentationGap[] = [
      {
        type: 'undocumented-breaking-change',
        itemName: 'test',
        suggestion: 'test',
        severity: 'critical',
        requiredAction: 'test'
      }
    ];

    const changes: InterfaceChange[] = [];
    const examples: ExampleValidationResult[] = [
      {
        exampleId: 'ex1',
        isValid: true,
        errors: [],
        warnings: []
      }
    ];

    const scoreWithGaps = calculateDocumentationScore(changes, gaps, examples);

    expect(scoreWithGaps).toBeLessThan(100);
    expect(scoreWithGaps).toBeGreaterThan(0);
  });

  // Test 13: Generate comprehensive report
  it('should generate comprehensive documentation validation report', () => {
    const oldCode = 'export function oldFunc() { }';
    const newCode = `
      export function oldFunc() { }
      export function newFunc(param: string) { }
    `;
    const docs = 'API Documentation';
    const changelog = '# Changelog\n- newFunc added';
    const readme = '# Project\n## Features';
    const examples: CodeExample[] = [
      {
        id: 'ex1',
        code: 'const result = newFunc("test");',
        language: 'javascript',
        filePath: 'README.md',
        lineRange: { start: 20, end: 20 }
      }
    ];

    const report = generateDocumentationValidationReport(oldCode, newCode, docs, changelog, readme, examples);

    expect(report).toMatchObject({
      reportId: expect.stringMatching(/^report-/),
      interfaceChanges: expect.any(Array),
      documentationGaps: expect.any(Array),
      exampleValidationResults: expect.any(Array),
      changelogUpdates: expect.any(Array),
      recommendations: expect.any(Array)
    });
    expect(report.documentationScore).toBeGreaterThanOrEqual(0);
    expect(report.documentationScore).toBeLessThanOrEqual(100);
  });

  // Test 14: Generate documentation recommendations
  it('should generate actionable recommendations based on gaps', () => {
    const gaps: DocumentationGap[] = [
      {
        type: 'undocumented-breaking-change',
        itemName: 'oldAPI',
        suggestion: 'Document breaking change',
        severity: 'critical',
        requiredAction: 'Update CHANGELOG.md'
      }
    ];

    const changes: InterfaceChange[] = [
      {
        itemName: 'oldAPI',
        itemType: 'function',
        changeType: 'removed',
        isBreaking: true,
        details: 'Function removed',
        affectedDocuments: []
      }
    ];

    const examples: ExampleValidationResult[] = [];

    const recommendations = generateDocumentationRecommendations(gaps, changes, examples);

    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations.some(r => r.includes('critical') || r.includes('breaking'))).toBe(true);
  });

  // Test 15: Handle empty old code (new project)
  it('should handle new project with no previous interface', () => {
    const oldCode = '';
    const newCode = 'export function newFunction() { }';

    const oldInterface = extractPublicInterface(oldCode);
    const newInterface = extractPublicInterface(newCode);

    expect(oldInterface).toHaveLength(0);
    expect(newInterface.length).toBeGreaterThan(0);

    const changes = detectInterfaceChanges(oldInterface, newInterface);

    expect(changes.every(c => c.changeType === 'added')).toBe(true);
  });

  // Test 16: Edge case - all critical gaps
  it('should report comprehensive issues when all documentation is missing', () => {
    const changes: InterfaceChange[] = [
      {
        itemName: 'breakingAPI',
        itemType: 'function',
        changeType: 'removed',
        isBreaking: true,
        details: 'API removed',
        affectedDocuments: ['API.md', 'CHANGELOG.md']
      },
      {
        itemName: 'anotherBreakingAPI',
        itemType: 'class',
        changeType: 'removed',
        isBreaking: true,
        details: 'Class removed',
        affectedDocuments: ['API.md', 'CHANGELOG.md']
      }
    ];

    const report = generateDocumentationValidationReport(
      'export function breakingAPI() { } export class anotherBreakingAPI { }',
      '',
      '',
      '',
      '',
      []
    );

    expect(report.documentationScore).toBeLessThan(50);
    expect(report.isCompletelyDocumented).toBe(false);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });
});
