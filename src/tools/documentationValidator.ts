/**
 * Documentation Validator
 * Phase 8.4: Validates documentation updates for public interface changes
 */

export interface PublicInterfaceItem {
  name: string;
  type: 'function' | 'class' | 'interface' | 'enum' | 'type' | 'constant';
  signature: string;
  parameters?: string[];
  returnType?: string;
  description?: string;
  isExported: boolean;
  deprecated?: boolean;
}

export interface InterfaceChange {
  itemName: string;
  itemType: 'function' | 'class' | 'interface' | 'enum' | 'type' | 'constant';
  changeType: 'added' | 'removed' | 'modified' | 'deprecated';
  isBreaking: boolean;
  details: string;
  affectedDocuments: string[];
}

export interface CodeExample {
  id: string;
  code: string;
  language: string;
  expectedOutput?: string;
  filePath: string;
  lineRange: { start: number; end: number };
}

export interface ExampleValidationResult {
  exampleId: string;
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface DocumentationGap {
  type: 'missing-doc' | 'outdated-example' | 'missing-readme-update' | 'undocumented-breaking-change';
  itemName: string;
  suggestion: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  requiredAction: string;
}

export interface ChangelogEntry {
  version: string;
  date: Date;
  changes: {
    added: string[];
    fixed: string[];
    changed: string[];
    deprecated: string[];
    removed: string[];
  };
  breaking: boolean;
}

export interface DocumentationValidationReport {
  reportId: string;
  timestamp: Date;
  interfaceChanges: InterfaceChange[];
  documentationGaps: DocumentationGap[];
  exampleValidationResults: ExampleValidationResult[];
  changelogUpdates: ChangelogEntry[];
  readmeUpdates: string[];
  recommendations: string[];
  documentationScore: number; // 0-100
  isCompletelyDocumented: boolean;
}

/**
 * Extract public interface from source code
 */
export function extractPublicInterface(sourceCode: string): PublicInterfaceItem[] {
  const items: PublicInterfaceItem[] = [];

  // Extract exported functions
  const functionMatches = sourceCode.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\((.*?)\)/g);
  for (const match of functionMatches) {
    items.push({
      name: match[1],
      type: 'function',
      signature: `function ${match[1]}(${match[2]})`,
      parameters: match[2].split(',').map(p => p.trim()),
      isExported: true
    });
  }

  // Extract exported classes
  const classMatches = sourceCode.matchAll(/export\s+class\s+(\w+)(?:\s+extends\s+(\w+))?\s*\{/g);
  for (const match of classMatches) {
    items.push({
      name: match[1],
      type: 'class',
      signature: `class ${match[1]}${match[2] ? ` extends ${match[2]}` : ''}`,
      isExported: true
    });
  }

  // Extract exported interfaces
  const interfaceMatches = sourceCode.matchAll(/export\s+interface\s+(\w+)/g);
  for (const match of interfaceMatches) {
    items.push({
      name: match[1],
      type: 'interface',
      signature: `interface ${match[1]}`,
      isExported: true
    });
  }

  // Extract exported constants
  const constMatches = sourceCode.matchAll(/export\s+const\s+(\w+)\s*[:=]/g);
  for (const match of constMatches) {
    items.push({
      name: match[1],
      type: 'constant',
      signature: `const ${match[1]}`,
      isExported: true
    });
  }

  return items;
}

/**
 * Compare old and new interfaces to detect changes
 */
export function detectInterfaceChanges(
  oldInterface: PublicInterfaceItem[],
  newInterface: PublicInterfaceItem[]
): InterfaceChange[] {
  const changes: InterfaceChange[] = [];

  const oldMap = new Map(oldInterface.map(item => [item.name, item]));
  const newMap = new Map(newInterface.map(item => [item.name, item]));

  // Detect removed items (breaking change)
  for (const [name, item] of oldMap) {
    if (!newMap.has(name)) {
      changes.push({
        itemName: name,
        itemType: item.type,
        changeType: 'removed',
        isBreaking: true,
        details: `${item.type} "${name}" was removed from the public API`,
        affectedDocuments: ['API.md', 'CHANGELOG.md']
      });
    }
  }

  // Detect added items (may require docs)
  for (const [name, item] of newMap) {
    if (!oldMap.has(name)) {
      changes.push({
        itemName: name,
        itemType: item.type,
        changeType: 'added',
        isBreaking: false,
        details: `${item.type} "${name}" was added to the public API`,
        affectedDocuments: ['API.md']
      });
    }
  }

  // Detect modified items
  for (const [name, newItem] of newMap) {
    const oldItem = oldMap.get(name);
    if (oldItem && oldItem.signature !== newItem.signature) {
      // Check if it's a breaking change
      const parametersChanged = oldItem.parameters?.length !== newItem.parameters?.length;
      const returnTypeChanged = oldItem.returnType !== newItem.returnType;
      const isBreaking = parametersChanged || returnTypeChanged;

      changes.push({
        itemName: name,
        itemType: newItem.type,
        changeType: 'modified',
        isBreaking,
        details: `${newItem.type} "${name}" signature changed: ${oldItem.signature} → ${newItem.signature}`,
        affectedDocuments: isBreaking ? ['API.md', 'CHANGELOG.md'] : ['API.md']
      });
    }
  }

  return changes;
}

/**
 * Check if documentation covers breaking changes
 */
export function validateBreakingChangeDocumentation(
  changes: InterfaceChange[],
  documentation: string,
  changelog: string
): DocumentationGap[] {
  const gaps: DocumentationGap[] = [];

  for (const change of changes) {
    if (change.isBreaking) {
      // Check if breaking change is documented in CHANGELOG
      if (!changelog.includes(change.itemName)) {
        gaps.push({
          type: 'undocumented-breaking-change',
          itemName: change.itemName,
          suggestion: `Add breaking change for "${change.itemName}" to CHANGELOG.md`,
          severity: 'critical',
          requiredAction: `Document breaking change in "## Breaking Changes" section`
        });
      }

      // Check if documented in API docs
      if (!documentation.includes(change.itemName)) {
        gaps.push({
          type: 'missing-doc',
          itemName: change.itemName,
          suggestion: `Add documentation for breaking change of "${change.itemName}"`,
          severity: 'high',
          requiredAction: `Update API.md with migration guide for "${change.itemName}"`
        });
      }
    }
  }

  return gaps;
}

/**
 * Validate code examples in documentation
 */
export function validateCodeExamples(
  examples: CodeExample[],
  _sourceCode: string // Could be used for semantic validation
): ExampleValidationResult[] {
  const results: ExampleValidationResult[] = [];

  for (const example of examples) {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic validation: check for syntax errors
    if (example.code.trim().length === 0) {
      errors.push('Example code is empty');
    }

    // Check for common issues
    if (example.language === 'javascript' || example.language === 'typescript') {
      if (!example.code.includes('import') && !example.code.includes('require')) {
        warnings.push('Example missing import statements');
      }

      // Check for unresolved references
      const undefinedPattern = /\b(console\.log|console\.error|fetch|setTimeout|async|await)\b/;
      if (undefinedPattern.test(example.code)) {
        if (!example.code.includes('async') && example.code.includes('await')) {
          errors.push('await used outside async function');
        }
      }
    }

    // Check expected output format
    if (example.expectedOutput && example.expectedOutput.trim().length === 0) {
      warnings.push('Example has empty expected output');
    }

    results.push({
      exampleId: example.id,
      isValid: errors.length === 0,
      errors,
      warnings
    });
  }

  return results;
}

/**
 * Check README updates for matching changes
 */
export function validateReadmeUpdates(
  interfaceChanges: InterfaceChange[],
  readmeContent: string
): DocumentationGap[] {
  const gaps: DocumentationGap[] = [];

  // Major features section should be updated for significant additions
  const majorAdditions = interfaceChanges.filter(c => c.changeType === 'added' && c.itemType === 'function');

  if (majorAdditions.length > 0 && !readmeContent.includes('## Features')) {
    gaps.push({
      type: 'missing-readme-update',
      itemName: 'Features Section',
      suggestion: 'Add "## Features" section documenting new functionality',
      severity: 'medium',
      requiredAction: 'Update README.md with feature descriptions'
    });
  }

  // Check for migration guide if breaking changes
  const breakingChanges = interfaceChanges.filter(c => c.isBreaking);
  if (breakingChanges.length > 0 && !readmeContent.includes('## Migration Guide')) {
    gaps.push({
      type: 'missing-readme-update',
      itemName: 'Migration Guide',
      suggestion: 'Add "## Migration Guide" section for breaking changes',
      severity: 'critical',
      requiredAction: 'Create migration guide in README.md'
    });
  }

  return gaps;
}

/**
 * Generate changelog entries from interface changes
 */
export function generateChangelogEntries(
  changes: InterfaceChange[],
  version: string
): ChangelogEntry {
  const entry: ChangelogEntry = {
    version,
    date: new Date(),
    changes: {
      added: [],
      fixed: [],
      changed: [],
      deprecated: [],
      removed: []
    },
    breaking: changes.some(c => c.isBreaking)
  };

  for (const change of changes) {
    switch (change.changeType) {
      case 'added':
        entry.changes.added.push(`- ${change.itemName} (${change.itemType})`);
        break;
      case 'removed':
        entry.changes.removed.push(`- ${change.itemName} (${change.itemType})`);
        break;
      case 'modified':
        if (change.isBreaking) {
          entry.changes.changed.push(`- **BREAKING**: ${change.itemName} - ${change.details}`);
        } else {
          entry.changes.changed.push(`- ${change.itemName} - ${change.details}`);
        }
        break;
      case 'deprecated':
        entry.changes.deprecated.push(`- ${change.itemName}`);
        break;
    }
  }

  return entry;
}

/**
 * Calculate documentation completeness score
 */
export function calculateDocumentationScore(
  interfaceChanges: InterfaceChange[],
  gaps: DocumentationGap[],
  exampleResults: ExampleValidationResult[]
): number {
  let score = 100;

  // Penalty for critical documentation gaps
  const criticalGaps = gaps.filter(g => g.severity === 'critical');
  score -= criticalGaps.length * 20;

  // Penalty for high severity gaps
  const highGaps = gaps.filter(g => g.severity === 'high');
  score -= highGaps.length * 10;

  // Penalty for invalid code examples
  const invalidExamples = exampleResults.filter(r => !r.isValid);
  score -= invalidExamples.length * 5;

  // Penalty for undocumented breaking changes
  const undocumentedBreaking = gaps.filter(
    g => g.type === 'undocumented-breaking-change'
  ).length;
  score -= undocumentedBreaking * 15;

  return Math.max(0, score);
}

/**
 * Generate recommendations for documentation improvements
 */
export function generateDocumentationRecommendations(
  gaps: DocumentationGap[],
  changes: InterfaceChange[],
  exampleResults: ExampleValidationResult[]
): string[] {
  const recommendations: string[] = [];

  if (gaps.length === 0 && exampleResults.every(r => r.isValid)) {
    recommendations.push('Documentation is complete and up-to-date');
    return recommendations;
  }

  // Critical issues
  const criticalGaps = gaps.filter(g => g.severity === 'critical');
  if (criticalGaps.length > 0) {
    recommendations.push(`Fix ${criticalGaps.length} critical documentation issue(s) before release:`);
    criticalGaps.forEach(g => {
      recommendations.push(`- ${g.requiredAction}`);
    });
  }

  // Breaking changes
  const breakingChanges = changes.filter(c => c.isBreaking);
  if (breakingChanges.length > 0) {
    recommendations.push(`Document ${breakingChanges.length} breaking change(s):`);
    breakingChanges.forEach(c => {
      recommendations.push(`- ${c.itemName}: ${c.details}`);
    });
  }

  // Invalid examples
  const invalidExamples = exampleResults.filter(r => !r.isValid);
  if (invalidExamples.length > 0) {
    recommendations.push(`Fix ${invalidExamples.length} invalid code example(s)`);
  }

  // High severity gaps
  const highGaps = gaps.filter(g => g.severity === 'high');
  if (highGaps.length > 0) {
    recommendations.push(`Address ${highGaps.length} high-priority documentation gap(s)`);
  }

  return recommendations;
}

/**
 * Generate comprehensive documentation validation report
 */
export function generateDocumentationValidationReport(
  oldSourceCode: string,
  newSourceCode: string,
  documentation: string,
  changelog: string,
  readme: string,
  examples: CodeExample[],
  reportId: string = `report-${Date.now()}`
): DocumentationValidationReport {
  // Extract interfaces
  const oldInterface = extractPublicInterface(oldSourceCode);
  const newInterface = extractPublicInterface(newSourceCode);

  // Detect changes
  const interfaceChanges = detectInterfaceChanges(oldInterface, newInterface);

  // Validate documentation
  const docGaps = validateBreakingChangeDocumentation(interfaceChanges, documentation, changelog);

  // Validate README
  const readmeGaps = validateReadmeUpdates(interfaceChanges, readme);

  // Validate examples
  const exampleResults = validateCodeExamples(examples, newSourceCode);

  // Generate changelog
  const changelogUpdates = [generateChangelogEntries(interfaceChanges, '1.0.0')];

  // Calculate score
  const allGaps = [...docGaps, ...readmeGaps];
  const score = calculateDocumentationScore(interfaceChanges, allGaps, exampleResults);

  // Generate recommendations
  const recommendations = generateDocumentationRecommendations(allGaps, interfaceChanges, exampleResults);

  const isCompletelyDocumented = score === 100 && allGaps.length === 0;

  return {
    reportId,
    timestamp: new Date(),
    interfaceChanges,
    documentationGaps: allGaps,
    exampleValidationResults: exampleResults,
    changelogUpdates,
    readmeUpdates: readme.length > 0 ? ['README.md'] : [],
    recommendations,
    documentationScore: score,
    isCompletelyDocumented
  };
}
