/**
 * Contract Validator Tests
 * Phase 8.3: Validates contracts between layer boundaries
 */

import {
  ContractSchema,
  LayerBoundary,
  ContractViolation,
  ContractChange,
  defineStandardContracts,
  validateSchemaAgainstContract,
  detectBreakingChanges,
  validateLayerBoundary,
  compareImplementations,
  generateRecommendations,
  generateContractValidationReport
} from '../contractValidator';

describe('Contract Validator', () => {
  // Test 1: Define standard contracts for all boundaries
  it('should define standard contracts for UI-API, API-Data, and Data-Test boundaries', () => {
    const contracts = defineStandardContracts();

    expect(contracts).toHaveLength(3);
    expect(contracts[0].name).toBe('UI-API Contract');
    expect(contracts[1].name).toBe('API-Data Contract');
    expect(contracts[2].name).toBe('Data-Test Contract');

    // Check UI-API has request and response contracts
    expect(contracts[0].contracts).toContainEqual(
      expect.objectContaining({ name: 'APIRequest', type: 'request' })
    );
    expect(contracts[0].contracts).toContainEqual(
      expect.objectContaining({ name: 'APIResponse', type: 'response' })
    );
  });

  // Test 2: Validate schema with valid contract
  it('should pass validation when schema matches contract', () => {
    const contract: ContractSchema = {
      name: 'TestContract',
      version: '1.0',
      type: 'model',
      properties: {
        id: { name: 'id', type: 'string', required: true },
        name: { name: 'name', type: 'string', required: true }
      },
      required: ['id', 'name'],
      additionalPropertiesAllowed: false
    };

    const schema = {
      id: 'test-123',
      name: 'Test Name'
    };

    const violations = validateSchemaAgainstContract(schema, contract);

    expect(violations).toHaveLength(0);
  });

  // Test 3: Detect missing required properties
  it('should detect missing required properties in schema', () => {
    const contract: ContractSchema = {
      name: 'TestContract',
      version: '1.0',
      type: 'model',
      properties: {
        id: { name: 'id', type: 'string', required: true },
        name: { name: 'name', type: 'string', required: true },
        email: { name: 'email', type: 'string', required: false }
      },
      required: ['id', 'name'],
      additionalPropertiesAllowed: true
    };

    const schema = {
      id: 'test-123'
      // missing 'name'
    };

    const violations = validateSchemaAgainstContract(schema, contract);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      violationType: 'missing-property',
      property: 'name',
      severity: 'critical'
    });
  });

  // Test 4: Detect type mismatches
  it('should detect type mismatches between schema and contract', () => {
    const contract: ContractSchema = {
      name: 'TestContract',
      version: '1.0',
      type: 'model',
      properties: {
        id: { name: 'id', type: 'string', required: true },
        age: { name: 'age', type: 'number', required: true }
      },
      required: ['id', 'age'],
      additionalPropertiesAllowed: true
    };

    const schema = {
      id: 'test-123',
      age: 'thirty-five' // should be number
    };

    const violations = validateSchemaAgainstContract(schema, contract);

    expect(violations).toContainEqual(
      expect.objectContaining({
        violationType: 'type-mismatch',
        property: 'age',
        expected: 'number'
      })
    );
  });

  // Test 5: Validate UI-API contract
  it('should validate UI-API request/response contracts', () => {
    const boundaries = defineStandardContracts();
    const uiApiBoundary = boundaries[0];

    const implementation = {
      APIRequest: {
        method: 'GET',
        path: '/api/users',
        headers: { 'Content-Type': 'application/json' }
      },
      APIResponse: {
        statusCode: 200,
        data: { users: [] },
        timestamp: '2026-06-23T00:00:00Z'
      }
    };

    const result = validateLayerBoundary(uiApiBoundary, implementation);

    expect(result.isValid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  // Test 6: Detect breaking changes - removed required property
  it('should detect breaking change when required property is removed', () => {
    const oldSchema: ContractSchema = {
      name: 'UserModel',
      version: '1.0',
      type: 'model',
      properties: {
        id: { name: 'id', type: 'string', required: true },
        email: { name: 'email', type: 'string', required: true },
        name: { name: 'name', type: 'string', required: true }
      },
      required: ['id', 'email', 'name'],
      additionalPropertiesAllowed: true
    };

    const newSchema: ContractSchema = {
      name: 'UserModel',
      version: '2.0',
      type: 'model',
      properties: {
        id: { name: 'id', type: 'string', required: true },
        email: { name: 'email', type: 'string', required: true }
        // 'name' was removed
      },
      required: ['id', 'email'],
      additionalPropertiesAllowed: true
    };

    const changes = detectBreakingChanges(oldSchema, newSchema);

    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0]).toMatchObject({
      isBreaking: true,
      property: 'name',
      reason: expect.stringContaining('removed')
    });
  });

  // Test 7: Detect breaking changes - type change
  it('should detect breaking change when property type is modified', () => {
    const oldSchema: ContractSchema = {
      name: 'OrderModel',
      version: '1.0',
      type: 'model',
      properties: {
        id: { name: 'id', type: 'string', required: true },
        total: { name: 'total', type: 'number', required: true }
      },
      required: ['id', 'total'],
      additionalPropertiesAllowed: true
    };

    const newSchema: ContractSchema = {
      name: 'OrderModel',
      version: '1.1',
      type: 'model',
      properties: {
        id: { name: 'id', type: 'string', required: true },
        total: { name: 'total', type: 'string', required: true } // changed to string
      },
      required: ['id', 'total'],
      additionalPropertiesAllowed: true
    };

    const changes = detectBreakingChanges(oldSchema, newSchema);

    expect(changes).toContainEqual(
      expect.objectContaining({
        property: 'total',
        isBreaking: true,
        reason: expect.stringContaining('changed from number to string')
      })
    );
  });

  // Test 8: Validate API-Data contract
  it('should validate API-Data contracts with data models and query filters', () => {
    const boundaries = defineStandardContracts();
    const apiDataBoundary = boundaries[1];

    const implementation = {
      DataModel: {
        id: 'user-123',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-06-23T00:00:00Z'
      },
      QueryFilter: {
        where: { status: 'active' },
        limit: 10
      }
    };

    const result = validateLayerBoundary(apiDataBoundary, implementation);

    expect(result.isValid).toBe(true);
  });

  // Test 9: Validate Data-Test contract
  it('should validate Data-Test contracts with strict property requirements', () => {
    const boundaries = defineStandardContracts();
    const dataTestBoundary = boundaries[2];

    const implementation = {
      TestFixture: {
        id: 'fixture-1',
        name: 'Create User',
        data: { email: 'test@example.com', password: 'secret' },
        expectedResult: { success: true }
      }
    };

    const result = validateLayerBoundary(dataTestBoundary, implementation);

    expect(result.isValid).toBe(true);
  });

  // Test 10: Compare old and new implementations for breaking changes
  it('should compare implementations and detect breaking changes', () => {
    const boundary: LayerBoundary = {
      name: 'Test Boundary',
      from: 'api',
      to: 'data',
      contracts: [
        {
          name: 'UserModel',
          version: '1.0',
          type: 'model',
          properties: {
            id: { name: 'id', type: 'string', required: true },
            email: { name: 'email', type: 'string', required: true }
          },
          required: ['id', 'email'],
          additionalPropertiesAllowed: true
        }
      ]
    };

    const oldImpl = {
      UserModel: {
        name: 'UserModel',
        version: '1.0',
        type: 'model',
        properties: {
          id: { name: 'id', type: 'string', required: true },
          email: { name: 'email', type: 'string', required: true }
        },
        required: ['id', 'email'],
        additionalPropertiesAllowed: true
      }
    };

    const newImpl = {
      UserModel: {
        name: 'UserModel',
        version: '2.0',
        type: 'model',
        properties: {
          id: { name: 'id', type: 'string', required: true },
          email: { name: 'email', type: 'string', required: true },
          phoneNumber: { name: 'phoneNumber', type: 'string', required: true } // new required
        },
        required: ['id', 'email', 'phoneNumber'],
        additionalPropertiesAllowed: true
      }
    };

    const changes = compareImplementations(boundary, oldImpl as any, newImpl as any);

    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0]).toMatchObject({
      property: 'phoneNumber',
      isBreaking: true
    });
  });

  // Test 11: Generate recommendations for violations
  it('should generate actionable recommendations from violations', () => {
    const violations: ContractViolation[] = [
      {
        boundaryName: 'UI-API',
        contractName: 'APIRequest',
        violationType: 'missing-property',
        property: 'method',
        expected: 'required',
        actual: 'missing',
        severity: 'critical',
        suggestion: 'Add required property "method"'
      },
      {
        boundaryName: 'UI-API',
        contractName: 'APIRequest',
        violationType: 'type-mismatch',
        property: 'path',
        expected: 'string',
        actual: 'number',
        severity: 'high',
        suggestion: 'Fix type of "path" from number to string'
      }
    ];

    const changes: ContractChange[] = [
      {
        property: 'statusCode',
        from: { name: 'statusCode', type: 'number', required: true },
        to: { name: 'statusCode', type: 'string', required: true },
        isBreaking: true,
        reason: 'Type changed from number to string'
      }
    ];

    const recommendations = generateRecommendations(violations, changes);

    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations.some(r => r.includes('critical'))).toBe(true);
    expect(recommendations.some(r => r.includes('breaking'))).toBe(true);
  });

  // Test 12: Generate comprehensive report
  it('should generate comprehensive contract validation report', () => {
    const boundaries = defineStandardContracts();
    const implementations = {
      'UI-API Contract': {
        APIRequest: { method: 'POST', path: '/api/users' },
        APIResponse: { statusCode: 201, timestamp: '2026-06-23T00:00:00Z' }
      },
      'API-Data Contract': {
        DataModel: { id: '1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-06-23T00:00:00Z' },
        QueryFilter: {}
      },
      'Data-Test Contract': {
        TestFixture: { id: 'test-1', name: 'Test', data: {}, expectedResult: {} }
      }
    };

    const report = generateContractValidationReport(boundaries, implementations, 'report-123');

    expect(report).toMatchObject({
      reportId: 'report-123',
      totalContracts: expect.any(Number),
      validationResults: expect.any(Array),
      breakingChangesSummary: expect.any(Array),
      recommendations: expect.any(Array)
    });
    expect(report.overallCompatibilityScore).toBeGreaterThanOrEqual(0);
    expect(report.overallCompatibilityScore).toBeLessThanOrEqual(100);
  });

  // Test 13: Detect additional properties violation
  it('should detect violations when additional properties are not allowed', () => {
    const contract: ContractSchema = {
      name: 'StrictContract',
      version: '1.0',
      type: 'model',
      properties: {
        id: { name: 'id', type: 'string', required: true },
        name: { name: 'name', type: 'string', required: true }
      },
      required: ['id', 'name'],
      additionalPropertiesAllowed: false
    };

    const schema = {
      id: 'test-1',
      name: 'Test',
      extraProperty: 'should not be here'
    };

    const violations = validateSchemaAgainstContract(schema, contract);

    expect(violations).toContainEqual(
      expect.objectContaining({
        violationType: 'constraint-violation',
        property: 'extraProperty',
        severity: 'low'
      })
    );
  });

  // Test 14: Edge case - empty schema
  it('should handle empty schema validation gracefully', () => {
    const contract: ContractSchema = {
      name: 'TestContract',
      version: '1.0',
      type: 'model',
      properties: {
        id: { name: 'id', type: 'string', required: true }
      },
      required: ['id'],
      additionalPropertiesAllowed: true
    };

    const schema = {};

    const violations = validateSchemaAgainstContract(schema, contract);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].violationType).toBe('missing-property');
  });

  // Test 15: Comprehensive multi-boundary validation
  it('should validate multiple boundaries in one report', () => {
    const boundaries = defineStandardContracts();

    const implementations = {
      'UI-API Contract': {
        APIRequest: {
          method: 'GET',
          path: '/api/data'
          // missing required headers would be violation
        },
        APIResponse: {
          statusCode: 200,
          timestamp: '2026-06-23T00:00:00Z',
          data: { result: [] }
        }
      },
      'API-Data Contract': {
        DataModel: {
          id: 'id-1',
          createdAt: 'invalid', // should still validate structure
          updatedAt: '2026-06-23T00:00:00Z'
        },
        QueryFilter: { limit: 100 }
      },
      'Data-Test Contract': {
        TestFixture: {
          id: 'test-1',
          name: 'Integration Test',
          data: { input: 'test' },
          expectedResult: { output: 'expected' }
        }
      }
    };

    const report = generateContractValidationReport(boundaries, implementations);

    expect(report.validationResults).toHaveLength(3);
    expect(report.recommendations).toBeDefined();
    expect(report.overallCompatibilityScore).toBeDefined();
  });
});
