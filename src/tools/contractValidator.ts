/**
 * Cross-Layer Contract Validator
 * Phase 8.3: Validates contracts between layer boundaries
 */

export interface ContractSchema {
  name: string;
  version: string;
  type: 'request' | 'response' | 'model' | 'event';
  properties: Record<string, PropertySchema>;
  required: string[];
  additionalPropertiesAllowed: boolean;
}

export interface PropertySchema {
  name: string;
  type: string; // 'string', 'number', 'boolean', 'array', 'object', etc.
  required: boolean;
  description?: string;
  constraints?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    enum?: string[];
    min?: number;
    max?: number;
  };
}

export interface LayerBoundary {
  name: string;
  from: 'ui' | 'api' | 'data' | 'test';
  to: 'ui' | 'api' | 'data' | 'test';
  contracts: ContractSchema[];
}

export interface ContractChange {
  property: string;
  from: PropertySchema;
  to: PropertySchema;
  isBreaking: boolean;
  reason: string;
}

export interface ContractViolation {
  boundaryName: string;
  contractName: string;
  violationType: 'missing-property' | 'type-mismatch' | 'constraint-violation' | 'removed-property' | 'breaking-change';
  property: string;
  expected: string;
  actual: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  suggestion: string;
}

export interface ContractValidationResult {
  isValid: boolean;
  violations: ContractViolation[];
  breakingChanges: ContractChange[];
  warnings: string[];
  validatedBoundaries: number;
  totalBoundaries: number;
  validationScore: number; // 0-100
}

export interface ContractCompatibilityReport {
  reportId: string;
  timestamp: Date;
  totalContracts: number;
  validContracts: number;
  validationResults: ContractValidationResult[];
  breakingChangesSummary: ContractChange[];
  recommendations: string[];
  overallCompatibilityScore: number; // 0-100
  requiresReview: boolean;
}

/**
 * Define standard contract schemas for each layer boundary
 */
export function defineStandardContracts(): LayerBoundary[] {
  return [
    {
      name: 'UI-API Contract',
      from: 'ui',
      to: 'api',
      contracts: [
        {
          name: 'APIRequest',
          version: '1.0',
          type: 'request',
          properties: {
            method: { name: 'method', type: 'string', required: true, description: 'HTTP method' },
            path: { name: 'path', type: 'string', required: true, description: 'API path' },
            headers: { name: 'headers', type: 'object', required: false },
            body: { name: 'body', type: 'object', required: false },
            queryParams: { name: 'queryParams', type: 'object', required: false }
          },
          required: ['method', 'path'],
          additionalPropertiesAllowed: true
        },
        {
          name: 'APIResponse',
          version: '1.0',
          type: 'response',
          properties: {
            statusCode: { name: 'statusCode', type: 'number', required: true },
            data: { name: 'data', type: 'object', required: false },
            error: { name: 'error', type: 'string', required: false },
            timestamp: { name: 'timestamp', type: 'string', required: true }
          },
          required: ['statusCode', 'timestamp'],
          additionalPropertiesAllowed: true
        }
      ]
    },
    {
      name: 'API-Data Contract',
      from: 'api',
      to: 'data',
      contracts: [
        {
          name: 'DataModel',
          version: '1.0',
          type: 'model',
          properties: {
            id: { name: 'id', type: 'string', required: true, description: 'Unique identifier' },
            createdAt: { name: 'createdAt', type: 'string', required: true, description: 'Creation timestamp' },
            updatedAt: { name: 'updatedAt', type: 'string', required: true, description: 'Last update timestamp' }
          },
          required: ['id', 'createdAt', 'updatedAt'],
          additionalPropertiesAllowed: true
        },
        {
          name: 'QueryFilter',
          version: '1.0',
          type: 'model',
          properties: {
            where: { name: 'where', type: 'object', required: false },
            orderBy: { name: 'orderBy', type: 'object', required: false },
            limit: { name: 'limit', type: 'number', required: false },
            offset: { name: 'offset', type: 'number', required: false }
          },
          required: [],
          additionalPropertiesAllowed: true
        }
      ]
    },
    {
      name: 'Data-Test Contract',
      from: 'data',
      to: 'test',
      contracts: [
        {
          name: 'TestFixture',
          version: '1.0',
          type: 'model',
          properties: {
            id: { name: 'id', type: 'string', required: true },
            name: { name: 'name', type: 'string', required: true },
            data: { name: 'data', type: 'object', required: true },
            expectedResult: { name: 'expectedResult', type: 'object', required: true }
          },
          required: ['id', 'name', 'data', 'expectedResult'],
          additionalPropertiesAllowed: false
        }
      ]
    }
  ];
}

/**
 * Validate a schema against a contract
 */
export function validateSchemaAgainstContract(
  actualSchema: Record<string, any>,
  expectedContract: ContractSchema
): ContractViolation[] {
  const violations: ContractViolation[] = [];

  // Check required properties
  for (const requiredProp of expectedContract.required) {
    if (!(requiredProp in actualSchema)) {
      violations.push({
        boundaryName: 'schema-validation',
        contractName: expectedContract.name,
        violationType: 'missing-property',
        property: requiredProp,
        expected: 'required',
        actual: 'missing',
        severity: 'critical',
        suggestion: `Add required property "${requiredProp}" to schema`
      });
    }
  }

  // Check property types
  for (const [propName, propDef] of Object.entries(expectedContract.properties)) {
    if (propName in actualSchema) {
      const actualType = typeof actualSchema[propName];
      const expectedType = propDef.type.toLowerCase();

      if (!typeMatches(actualType, expectedType)) {
        violations.push({
          boundaryName: 'schema-validation',
          contractName: expectedContract.name,
          violationType: 'type-mismatch',
          property: propName,
          expected: expectedType,
          actual: actualType,
          severity: propDef.required ? 'high' : 'medium',
          suggestion: `Update property "${propName}" type from ${actualType} to ${expectedType}`
        });
      }
    }
  }

  // Check additional properties
  if (!expectedContract.additionalPropertiesAllowed) {
    for (const propName of Object.keys(actualSchema)) {
      if (!(propName in expectedContract.properties)) {
        violations.push({
          boundaryName: 'schema-validation',
          contractName: expectedContract.name,
          violationType: 'constraint-violation',
          property: propName,
          expected: 'no additional properties',
          actual: propName,
          severity: 'low',
          suggestion: `Remove additional property "${propName}"`
        });
      }
    }
  }

  return violations;
}

/**
 * Check if types match (handles type equivalencies)
 */
function typeMatches(actual: string, expected: string): boolean {
  if (actual === expected) return true;

  // Allow type equivalencies
  const equivalencies: Record<string, string[]> = {
    number: ['number', 'bigint'],
    string: ['string'],
    boolean: ['boolean'],
    object: ['object'],
    array: ['object'] // arrays are objects in typeof
  };

  const expectedEquivalents = equivalencies[expected.toLowerCase()] || [expected];
  return expectedEquivalents.includes(actual.toLowerCase());
}

/**
 * Detect breaking changes between two schemas
 */
export function detectBreakingChanges(
  oldSchema: ContractSchema,
  newSchema: ContractSchema
): ContractChange[] {
  const changes: ContractChange[] = [];

  // Check for removed required properties (breaking)
  for (const requiredProp of oldSchema.required) {
    if (!newSchema.required.includes(requiredProp)) {
      const oldProp = oldSchema.properties[requiredProp];
      const newProp = newSchema.properties[requiredProp] || {
        name: requiredProp,
        type: 'undefined',
        required: false
      };

      changes.push({
        property: requiredProp,
        from: oldProp,
        to: newProp,
        isBreaking: true,
        reason: `Required property "${requiredProp}" was made optional or removed`
      });
    }
  }

  // Check for type changes (breaking)
  for (const [propName, newProp] of Object.entries(newSchema.properties)) {
    const oldProp = oldSchema.properties[propName];
    if (oldProp && oldProp.type !== newProp.type) {
      changes.push({
        property: propName,
        from: oldProp,
        to: newProp,
        isBreaking: true,
        reason: `Type of "${propName}" changed from ${oldProp.type} to ${newProp.type}`
      });
    }
  }

  // Check for new required properties (breaking for clients)
  for (const requiredProp of newSchema.required) {
    if (!oldSchema.required.includes(requiredProp)) {
      const oldProp = oldSchema.properties[requiredProp];
      const newProp = newSchema.properties[requiredProp];

      if (!oldProp) {
        changes.push({
          property: requiredProp,
          from: { name: requiredProp, type: 'undefined', required: false },
          to: newProp,
          isBreaking: true,
          reason: `New required property "${requiredProp}" added (breaks existing clients)`
        });
      }
    }
  }

  return changes;
}

/**
 * Validate contracts for a specific layer boundary
 */
export function validateLayerBoundary(
  boundary: LayerBoundary,
  actualImplementation: Record<string, any>
): ContractValidationResult {
  const violations: ContractViolation[] = [];
  const breakingChanges: ContractChange[] = [];
  const warnings: string[] = [];

  for (const contract of boundary.contracts) {
    if (contract.name in actualImplementation) {
      const actualSchema = actualImplementation[contract.name];

      // Validate schema
      const schemaViolations = validateSchemaAgainstContract(actualSchema, contract);
      violations.push(
        ...schemaViolations.map(v => ({
          ...v,
          boundaryName: boundary.name,
          contractName: contract.name
        }))
      );

      // Detect breaking changes
      if ('version' in actualSchema && actualSchema.version !== contract.version) {
        const oldVersion = contract.version;
        const newVersion = actualSchema.version;
        warnings.push(`Version mismatch for ${contract.name}: ${oldVersion} → ${newVersion}`);
      }
    } else {
      warnings.push(`Contract "${contract.name}" not implemented in ${boundary.to} layer`);
    }
  }

  const isValid = violations.length === 0;
  const validationScore = isValid ? 100 : Math.max(0, 100 - violations.length * 10);

  return {
    isValid,
    violations,
    breakingChanges,
    warnings,
    validatedBoundaries: 1,
    totalBoundaries: 1,
    validationScore
  };
}

/**
 * Compare two boundary implementations and detect breaking changes
 */
export function compareImplementations(
  boundary: LayerBoundary,
  oldImplementation: Record<string, ContractSchema>,
  newImplementation: Record<string, ContractSchema>
): ContractChange[] {
  const allChanges: ContractChange[] = [];

  for (const contract of boundary.contracts) {
    const oldSchema = oldImplementation[contract.name];
    const newSchema = newImplementation[contract.name];

    if (oldSchema && newSchema) {
      const changes = detectBreakingChanges(oldSchema, newSchema);
      allChanges.push(...changes);
    } else if (oldSchema && !newSchema) {
      allChanges.push({
        property: contract.name,
        from: oldSchema as any,
        to: { name: contract.name, type: 'undefined', required: false },
        isBreaking: true,
        reason: `Contract "${contract.name}" was removed`
      });
    } else if (!oldSchema && newSchema) {
      allChanges.push({
        property: contract.name,
        from: { name: contract.name, type: 'undefined', required: false },
        to: newSchema as any,
        isBreaking: false,
        reason: `New contract "${contract.name}" was added`
      });
    }
  }

  return allChanges;
}

/**
 * Generate contract violation report with recommendations
 */
export function generateRecommendations(violations: ContractViolation[], changes: ContractChange[]): string[] {
  const recommendations: string[] = [];

  if (violations.length === 0 && changes.length === 0) {
    recommendations.push('All contracts are valid and compatible');
    return recommendations;
  }

  // Critical violations
  const criticalViolations = violations.filter(v => v.severity === 'critical');
  if (criticalViolations.length > 0) {
    recommendations.push(`Fix ${criticalViolations.length} critical contract violation(s) before release`);
    criticalViolations.forEach(v => {
      recommendations.push(`- ${v.suggestion}`);
    });
  }

  // Breaking changes
  const breaking = changes.filter(c => c.isBreaking);
  if (breaking.length > 0) {
    recommendations.push(`Address ${breaking.length} breaking change(s):`);
    breaking.forEach(c => {
      recommendations.push(`- ${c.reason}`);
    });
    recommendations.push('Consider versioning the API to avoid breaking existing clients');
  }

  // High severity
  const highViolations = violations.filter(v => v.severity === 'high');
  if (highViolations.length > 0) {
    recommendations.push(`Review ${highViolations.length} high-priority violation(s)`);
  }

  return recommendations;
}

/**
 * Generate comprehensive contract validation report
 */
export function generateContractValidationReport(
  boundaries: LayerBoundary[],
  implementations: Record<string, Record<string, any>>,
  reportId: string = `report-${Date.now()}`
): ContractCompatibilityReport {
  const validationResults: ContractValidationResult[] = [];
  const allViolations: ContractViolation[] = [];
  const allChanges: ContractChange[] = [];
  let validContracts = 0;

  for (const boundary of boundaries) {
    const impl = implementations[boundary.name] || {};
    const result = validateLayerBoundary(boundary, impl);
    validationResults.push(result);

    allViolations.push(...result.violations);
    allChanges.push(...result.breakingChanges);

    if (result.isValid) {
      validContracts += boundary.contracts.length;
    }
  }

  const totalContracts = boundaries.reduce((sum, b) => sum + b.contracts.length, 0);
  const recommendations = generateRecommendations(allViolations, allChanges);

  // Calculate overall compatibility score
  const violationPenalty = allViolations.reduce((sum, v) => {
    switch (v.severity) {
      case 'critical':
        return sum + 15;
      case 'high':
        return sum + 10;
      case 'medium':
        return sum + 5;
      case 'low':
        return sum + 2;
      default:
        return sum;
    }
  }, 0);

  const breakingChangePenalty = allChanges.filter(c => c.isBreaking).length * 10;
  const overallCompatibilityScore = Math.max(0, 100 - violationPenalty - breakingChangePenalty);

  const requiresReview = allViolations.some(v => v.severity === 'critical') ||
                         allChanges.some(c => c.isBreaking);

  return {
    reportId,
    timestamp: new Date(),
    totalContracts,
    validContracts,
    validationResults,
    breakingChangesSummary: allChanges,
    recommendations,
    overallCompatibilityScore,
    requiresReview
  };
}
