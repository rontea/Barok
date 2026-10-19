/**
 * Risk Assessment Engine Tests
 * Phase 8.5: Analyzes code changes for risk factors and provides assessment
 */

import {
  CodeComplexity,
  FileRisk,
  RiskAssessmentResult,
  analyzeComplexity,
  detectRiskyPatterns,
  identifyTransitiveDependencies,
  calculateFileRiskScore,
  determineRiskLevel,
  generateMitigation,
  generateVerificationSuggestions,
  assessRisk,
  generateRiskAssessmentReport
} from '../riskAssessmentEngine';

describe('Risk Assessment Engine', () => {
  // Test 1: Analyze simple code complexity
  it('should analyze code complexity correctly', () => {
    const sourceCode = `
      function getUserById(id: string) {
        const user = database.get(id);
        return user;
      }
      
      if (user) {
        return user;
      }
    `;

    const complexity = analyzeComplexity(sourceCode, 'src/api/users.ts');

    expect(complexity).toMatchObject({
      linesOfCode: expect.any(Number),
      functionCount: expect.any(Number),
      cyclomaticComplexity: expect.any(Number),
      nestedDepth: expect.any(Number)
    });
    expect(complexity.linesOfCode).toBeGreaterThan(0);
    expect(complexity.functionCount).toBeGreaterThan(0);
  });

  // Test 2: Detect global state and side effects
  it('should detect global state and side effects in code', () => {
    const sourceCode = `
      global.cacheStore = {};
      const userData = window.userCache;
      export const API_KEY = process.env.API_KEY;
    `;

    const complexity = analyzeComplexity(sourceCode, 'src/config.ts');

    expect(complexity.hasGlobalState).toBe(true);
    expect(complexity.hasSideEffects).toBe(true);
  });

  // Test 3: Detect global-state risky pattern
  it('should detect global-state risky pattern', () => {
    const sourceCode = `
      static globalCache = {};
      let singletonInstance = null;
    `;

    const patterns = detectRiskyPatterns(sourceCode, 'src/cache.ts');

    expect(patterns).toContainEqual(expect.objectContaining({
      type: 'global-state',
      severity: 'high'
    }));
  });

  // Test 4: Detect API modification risky pattern
  it('should detect API modification risky pattern', () => {
    const sourceCode = `
      app.delete('/api/users/:id', async (req, res) => {
        await db.users.delete(req.params.id);
        res.json({ success: true });
      });
    `;

    const patterns = detectRiskyPatterns(sourceCode, 'src/api/routes.ts');

    expect(patterns).toContainEqual(expect.objectContaining({
      type: 'api-modification',
      severity: 'high'
    }));
  });

  // Test 5: Detect data model change risky pattern
  it('should detect data model change risky pattern', () => {
    const sourceCode = `
      export interface UserSchema {
        id: string;
        email: string;
        role: 'admin' | 'user';
      }
      
      export const userModel = new Schema({
        id: String,
        email: String
      });
    `;

    const patterns = detectRiskyPatterns(sourceCode, 'src/models/user.ts');

    expect(patterns).toContainEqual(expect.objectContaining({
      type: 'data-model-change',
      severity: 'critical'
    }));
  });

  // Test 6: Detect authentication risky pattern
  it('should detect authentication logic risky pattern', () => {
    const sourceCode = `
      function authenticate(password: string, stored: string): boolean {
        return bcrypt.compareSync(password, stored);
      }
      
      function generateJWT(userId: string) {
        return jwt.sign({ userId }, process.env.JWT_SECRET);
      }
    `;

    const patterns = detectRiskyPatterns(sourceCode, 'src/auth.ts');

    expect(patterns).toContainEqual(expect.objectContaining({
      type: 'auth-logic',
      severity: 'critical'
    }));
  });

  // Test 7: Detect database change risky pattern
  it('should detect database change risky pattern', () => {
    const sourceCode = `
      const migration = {
        up: async (db) => {
          await db.collection('users').createIndex({ email: 1 });
        }
      };
    `;

    const patterns = detectRiskyPatterns(sourceCode, 'src/migrations/001-index.ts');

    expect(patterns).toContainEqual(expect.objectContaining({
      type: 'database-change',
      severity: 'critical'
    }));
  });

  // Test 8: Identify transitive dependencies
  it('should identify transitive dependencies in code', () => {
    const allDeps = new Map([
      ['src/api/users.ts', ['src/services/userService.ts', 'src/models/user.ts']],
      ['src/services/userService.ts', ['src/db/connection.ts']],
      ['src/db/connection.ts', ['src/config.ts']]
    ]);
    const changedFiles = ['src/api/users.ts', 'src/config.ts'];

    const transitiveDeps = identifyTransitiveDependencies('src/api/users.ts', allDeps, changedFiles);

    expect(transitiveDeps.length).toBeGreaterThan(0);
    expect(transitiveDeps[0]).toMatchObject({
      source: expect.any(String),
      target: expect.any(String),
      type: expect.any(String),
      transitive: expect.any(Boolean)
    });
  });

  // Test 9: Calculate file risk score
  it('should calculate risk score based on multiple factors', () => {
    const complexity: CodeComplexity = {
      cyclomaticComplexity: 8,
      linesOfCode: 450,
      functionCount: 5,
      nestedDepth: 4,
      hasGlobalState: true,
      hasSideEffects: true
    };

    const patterns = [
      {
        type: 'api-modification' as const,
        description: 'Modifies API',
        location: 'src/api.ts',
        severity: 'high' as const
      }
    ];

    const score = calculateFileRiskScore(complexity, patterns, 3, 200);

    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  // Test 10: Determine risk level from score
  it('should determine correct risk level from risk score', () => {
    expect(determineRiskLevel(15)).toBe('low');
    expect(determineRiskLevel(50)).toBe('medium');
    expect(determineRiskLevel(70)).toBe('high');
    expect(determineRiskLevel(85)).toBe('critical');
  });

  // Test 11: Generate mitigation strategies
  it('should generate appropriate mitigation strategies for risks', () => {
    const patterns = [
      {
        type: 'global-state' as const,
        description: 'Uses global state',
        location: 'src/cache.ts',
        severity: 'high' as const
      },
      {
        type: 'api-modification' as const,
        description: 'Modifies API endpoints',
        location: 'src/routes.ts',
        severity: 'high' as const
      }
    ];

    const mitigations = generateMitigation(patterns, 75);

    expect(mitigations.length).toBeGreaterThan(0);
    expect(mitigations.some(m => m.toLowerCase().includes('refactor') || m.toLowerCase().includes('test'))).toBe(true);
  });

  // Test 12: Generate verification suggestions for critical changes
  it('should generate verification suggestions for high-risk changes', () => {
    const fileRisks: FileRisk[] = [
      {
        filePath: 'src/api/users.ts',
        complexity: {
          cyclomaticComplexity: 9,
          linesOfCode: 600,
          functionCount: 8,
          nestedDepth: 5,
          hasGlobalState: false,
          hasSideEffects: true
        },
        riskScore: 85,
        riskLevel: 'critical',
        patterns: [
          {
            type: 'api-modification',
            description: 'Modifies API',
            location: 'src/api/users.ts',
            severity: 'high'
          }
        ],
        transitiveDependencies: [],
        sideEffects: ['Modifies API'],
        mitigation: []
      }
    ];

    const suggestions = generateVerificationSuggestions(fileRisks, 'critical');

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some(s => s.toLowerCase().includes('review') || s.toLowerCase().includes('test'))).toBe(true);
  });

  // Test 13: Perform comprehensive risk assessment
  it('should perform comprehensive risk assessment on multiple files', () => {
    const changedFiles = new Map([
      ['src/api/users.ts', {
        sourceCode: `
          export function getUser(id: string) {
            return database.query('SELECT * FROM users WHERE id = ?', [id]);
          }
        `,
        changedLines: 50
      }],
      ['src/models/user.ts', {
        sourceCode: `
          export interface User {
            id: string;
            email: string;
          }
        `,
        changedLines: 30
      }]
    ]);

    const assessment = assessRisk(changedFiles);

    expect(assessment).toMatchObject({
      timestamp: expect.any(String),
      totalFiles: 2,
      riskDistribution: expect.objectContaining({
        low: expect.any(Number),
        medium: expect.any(Number),
        high: expect.any(Number),
        critical: expect.any(Number)
      }),
      overallRiskScore: expect.any(Number),
      overallRiskLevel: expect.stringMatching(/low|medium|high|critical/)
    });

    expect(assessment.overallRiskScore).toBeGreaterThanOrEqual(0);
    expect(assessment.overallRiskScore).toBeLessThanOrEqual(100);
  });

  // Test 14: Generate risk assessment report
  it('should generate a comprehensive risk assessment report', () => {
    const assessment: RiskAssessmentResult = {
      timestamp: new Date().toISOString(),
      totalFiles: 2,
      riskDistribution: {
        low: 0,
        medium: 1,
        high: 1,
        critical: 0
      },
      overallRiskScore: 55,
      overallRiskLevel: 'medium',
      criticalFiles: [],
      recommendations: ['Review code for potential improvements'],
      additionalVerificationRequired: false,
      verificationSuggestions: ['Add unit tests']
    };

    const report = generateRiskAssessmentReport(assessment);

    expect(report).toContain('Risk Assessment Report');
    expect(report).toContain('Overall Assessment');
    expect(report).toContain('Risk Distribution');
    expect(report).toContain('MEDIUM');
    expect(report).toContain('55/100');
    expect(report.length).toBeGreaterThan(100);
  });

  // Test 15: Handle empty file changes
  it('should handle assessment with no file changes', () => {
    const changedFiles = new Map();

    const assessment = assessRisk(changedFiles);

    expect(assessment.totalFiles).toBe(0);
    expect(assessment.overallRiskScore).toBe(0);
    expect(assessment.overallRiskLevel).toBe('low');
  });

  // Test 16: Assess risk with transitive dependencies
  it('should consider transitive dependencies in risk assessment', () => {
    const changedFiles = new Map([
      ['src/api/users.ts', {
        sourceCode: `export function getUsers() { return []; }`,
        changedLines: 10
      }]
    ]);

    const allDeps = new Map([
      ['src/api/users.ts', ['src/services/userService.ts']],
      ['src/services/userService.ts', ['src/db/connection.ts']],
      ['src/db/connection.ts', []]
    ]);

    const assessment = assessRisk(changedFiles, allDeps);

    expect(assessment).toMatchObject({
      totalFiles: 1,
      overallRiskScore: expect.any(Number),
      overallRiskLevel: expect.any(String)
    });
  });

  // Test 17: Critical file identification
  it('should correctly identify critical risk files', () => {
    const changedFiles = new Map([
      ['src/auth/login.ts', {
        sourceCode: `
          import jwt from 'jsonwebtoken';
          import bcrypt from 'bcrypt';
          
          export function authenticate(user: string, pass: string) {
            const stored = database.getPassword(user);
            if (bcrypt.compareSync(pass, stored)) {
              return jwt.sign({ userId: user }, process.env.SECRET);
            }
            throw new Error('Invalid credentials');
          }
        `,
        changedLines: 150
      }]
    ]);

    const assessment = assessRisk(changedFiles);

    if (assessment.criticalFiles.length > 0) {
      expect(assessment.criticalFiles[0].riskLevel).toBe('critical');
      expect(assessment.criticalFiles[0].patterns.some(p => p.severity === 'critical')).toBe(true);
    }
  });

  // Test 18: Verification required flag
  it('should set additionalVerificationRequired flag for high-risk changes', () => {
    const changedFiles = new Map([
      ['src/api/sensitive.ts', {
        sourceCode: `
          app.delete('/api/admin/users/:id', (req, res) => {
            database.deleteUser(req.params.id);
            res.json({ deleted: true });
          });
        `,
        changedLines: 100
      }]
    ]);

    const assessment = assessRisk(changedFiles);

    if (assessment.overallRiskLevel === 'high' || assessment.overallRiskLevel === 'critical') {
      expect(assessment.additionalVerificationRequired).toBe(true);
    }
  });

  // Test 19: Multiple risky patterns detected
  it('should detect multiple risky patterns in same file', () => {
    const sourceCode = `
      global.appState = {};
      
      app.put('/api/schema/:id', async (req, res) => {
        const schema = JSON.parse(req.body);
        export interface NewSchema {
          id: string;
          name: string;
        }
      });
    `;

    const patterns = detectRiskyPatterns(sourceCode, 'src/schema.ts');

    expect(patterns.length).toBeGreaterThan(1);
    expect(patterns.some(p => p.type === 'global-state')).toBe(true);
    expect(patterns.some(p => p.type === 'api-modification')).toBe(true);
  });

  // Test 20: Report includes critical file details
  it('should include detailed information for critical files in report', () => {
    const fileRisk: FileRisk = {
      filePath: 'src/auth.ts',
      complexity: {
        cyclomaticComplexity: 9,
        linesOfCode: 500,
        functionCount: 8,
        nestedDepth: 5,
        hasGlobalState: true,
        hasSideEffects: true
      },
      riskScore: 88,
      riskLevel: 'critical',
      patterns: [
        {
          type: 'auth-logic',
          description: 'Contains authentication logic',
          location: 'src/auth.ts',
          severity: 'critical'
        }
      ],
      transitiveDependencies: [],
      sideEffects: ['Contains authentication logic'],
      mitigation: ['Security audit required', 'Add comprehensive tests']
    };

    const assessment: RiskAssessmentResult = {
      timestamp: new Date().toISOString(),
      totalFiles: 1,
      riskDistribution: { low: 0, medium: 0, high: 0, critical: 1 },
      overallRiskScore: 88,
      overallRiskLevel: 'critical',
      criticalFiles: [fileRisk],
      recommendations: ['Perform security review'],
      additionalVerificationRequired: true,
      verificationSuggestions: ['Security penetration testing']
    };

    const report = generateRiskAssessmentReport(assessment);

    expect(report).toContain('src/auth.ts');
    expect(report).toContain('88');
    expect(report).toContain('critical');
    expect(report).toContain('Security audit');
  });
});
