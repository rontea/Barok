/**
 * Request Satisfaction Validator Tests
 * Phase 8.1: 12 comprehensive tests for request satisfaction validation
 */

import {
  extractRequirements,
  extractAcceptanceCriteria,
  combineRequirements,
  mapChangesToRequirements,
  calculateCoverageAnalysis,
  identifyGaps,
  calculateSatisfactionScore,
  determineSatisfactionStatus,
  generateRiskAssessment,
  generateRecommendations,
  validateRequestSatisfaction,
  ExecutedChange,
  UserRequirement
} from '../requestSatisfactionValidator';
import { FullStackWorkPlan } from '../../repo/workPlanOrchestrator';

describe('Request Satisfaction Validator - Phase 8.1', () => {
  // Helper to create a mock work plan
  const createMockWorkPlan = (): FullStackWorkPlan => ({
    id: 'plan-123',
    user_request: 'Add user authentication',
    classification: 'feature',
    complexity: 'complex',
    affected_files: [],
    acceptance_criteria: [
      { description: 'Users can login with email', required: true },
      { description: 'Password validation works', required: true }
    ],
    touched_layers: ['frontend', 'backend', 'data'],
    ownership_plan: new Map(),
    parallel_executable: false,
    dependencies: [],
    verification_plan: {
      required_checks: [],
      estimated_duration_ms: 5000,
      confidence_target: 0.95
    },
    execution_strategy: 'sequential',
    estimated_effort_ms: 10000,
    summary: 'Add authentication'
  });

  describe('Test 1: Criteria Matching - Basic', () => {
    it('should match requirements to changes with keyword overlap', () => {
      const requirements = extractRequirements('must implement user login');
      const changes: ExecutedChange[] = [
        {
          filePath: 'src/auth/login.ts',
          description: 'Implement user login form',
          impact: 'Frontend authentication UI',
          type: 'implementation'
        }
      ];

      const mappings = mapChangesToRequirements(requirements, changes);

      expect(mappings).toHaveLength(1);
      expect(mappings[0].addressedBy).toHaveLength(1);
      expect(mappings[0].addressedBy[0]).toBe('src/auth/login.ts');
      expect(mappings[0].confidence).toBeGreaterThan(0.3);
    });
  });

  describe('Test 2: Criteria Matching - Multiple', () => {
    it('should match multiple requirements to appropriate changes', () => {
      const requirements = [
        { id: 'req-0', text: 'must handle login', category: 'functional' as const, priority: 'critical' as const, addressed: false },
        { id: 'req-1', text: 'must validate password', category: 'functional' as const, priority: 'critical' as const, addressed: false },
        { id: 'req-2', text: 'must be responsive', category: 'non-functional' as const, priority: 'high' as const, addressed: false }
      ];

      const changes: ExecutedChange[] = [
        {
          filePath: 'src/auth/login.ts',
          description: 'Implement login handler',
          impact: 'Handles user authentication',
          type: 'implementation'
        },
        {
          filePath: 'src/auth/validation.ts',
          description: 'Add password validation rules',
          impact: 'Validates password requirements',
          type: 'implementation'
        },
        {
          filePath: 'ui/src/LoginPage.tsx',
          description: 'Make responsive design',
          impact: 'Works on mobile and desktop',
          type: 'implementation'
        }
      ];

      const mappings = mapChangesToRequirements(requirements, changes);

      expect(mappings).toHaveLength(3);
      expect(mappings[0].addressedBy.length).toBeGreaterThan(0); // Login addressed
      expect(mappings[1].addressedBy.length).toBeGreaterThan(0); // Password validation addressed
      expect(mappings[2].addressedBy.length).toBeGreaterThan(0); // Responsive addressed
    });
  });

  describe('Test 3: Coverage Calculation - Full', () => {
    it('should calculate 100% coverage when all requirements are addressed', () => {
      const requirements: UserRequirement[] = [
        { id: 'req-0', text: 'login', category: 'functional', priority: 'critical', addressed: false },
        { id: 'req-1', text: 'password', category: 'functional', priority: 'critical', addressed: false }
      ];

      const mappings = [
        { requirementId: 'req-0', addressedBy: ['file1'], confidence: 0.8, evidence: ['evidence1'] },
        { requirementId: 'req-1', addressedBy: ['file2'], confidence: 0.8, evidence: ['evidence2'] }
      ];

      const coverage = calculateCoverageAnalysis(requirements, mappings);

      expect(coverage.totalRequirements).toBe(2);
      expect(coverage.addressedRequirements).toBe(2);
      expect(coverage.coveragePercentage).toBe(100);
    });
  });

  describe('Test 4: Coverage Calculation - Partial', () => {
    it('should calculate partial coverage when some requirements are not addressed', () => {
      const requirements: UserRequirement[] = [
        { id: 'req-0', text: 'login', category: 'functional', priority: 'critical', addressed: false },
        { id: 'req-1', text: 'password', category: 'functional', priority: 'high', addressed: false },
        { id: 'req-2', text: 'security', category: 'non-functional', priority: 'critical', addressed: false }
      ];

      const mappings = [
        { requirementId: 'req-0', addressedBy: ['file1'], confidence: 0.8, evidence: ['evidence1'] },
        { requirementId: 'req-1', addressedBy: [], confidence: 0, evidence: [] },
        { requirementId: 'req-2', addressedBy: [], confidence: 0, evidence: [] }
      ];

      const coverage = calculateCoverageAnalysis(requirements, mappings);

      expect(coverage.totalRequirements).toBe(3);
      expect(coverage.addressedRequirements).toBe(1);
      expect(coverage.coveragePercentage).toBeCloseTo(33.33, 1);
    });
  });

  describe('Test 5: Gap Detection - No Gaps', () => {
    it('should identify no gaps when all requirements are addressed', () => {
      const requirements: UserRequirement[] = [
        { id: 'req-0', text: 'login', category: 'functional', priority: 'critical', addressed: false },
        { id: 'req-1', text: 'password', category: 'functional', priority: 'high', addressed: false }
      ];

      const mappings = [
        { requirementId: 'req-0', addressedBy: ['file1'], confidence: 0.8, evidence: ['evidence1'] },
        { requirementId: 'req-1', addressedBy: ['file2'], confidence: 0.8, evidence: ['evidence2'] }
      ];

      const gaps = identifyGaps(requirements, mappings);

      expect(gaps).toHaveLength(0);
    });
  });

  describe('Test 6: Gap Detection - Single', () => {
    it('should identify single gap when requirement is not addressed', () => {
      const requirements: UserRequirement[] = [
        { id: 'req-0', text: 'login', category: 'functional', priority: 'critical', addressed: false },
        { id: 'req-1', text: 'password validation', category: 'functional', priority: 'critical', addressed: false }
      ];

      const mappings = [
        { requirementId: 'req-0', addressedBy: ['file1'], confidence: 0.8, evidence: ['evidence1'] },
        { requirementId: 'req-1', addressedBy: [], confidence: 0, evidence: [] }
      ];

      const gaps = identifyGaps(requirements, mappings);

      expect(gaps).toHaveLength(1);
      expect(gaps[0].requirementId).toBe('req-1');
      expect(gaps[0].priority).toBe('critical');
      expect(gaps[0].reason).toBe('No changes address this requirement');
    });
  });

  describe('Test 7: Gap Detection - Multiple', () => {
    it('should identify multiple gaps from unaddressed requirements', () => {
      const requirements: UserRequirement[] = [
        { id: 'req-0', text: 'login', category: 'functional', priority: 'critical', addressed: false },
        { id: 'req-1', text: 'password', category: 'functional', priority: 'high', addressed: false },
        { id: 'req-2', text: 'MFA', category: 'functional', priority: 'high', addressed: false },
        { id: 'req-3', text: 'rate limiting', category: 'non-functional', priority: 'medium', addressed: false }
      ];

      const mappings = [
        { requirementId: 'req-0', addressedBy: ['file1'], confidence: 0.8, evidence: ['evidence1'] },
        { requirementId: 'req-1', addressedBy: [], confidence: 0, evidence: [] },
        { requirementId: 'req-2', addressedBy: [], confidence: 0, evidence: [] },
        { requirementId: 'req-3', addressedBy: [], confidence: 0, evidence: [] }
      ];

      const gaps = identifyGaps(requirements, mappings);

      expect(gaps).toHaveLength(3);
      expect(gaps.map(g => g.requirementId)).toEqual(['req-1', 'req-2', 'req-3']);
    });
  });

  describe('Test 8: Edge Case - Empty Request', () => {
    it('should handle empty user request gracefully', () => {
      const workPlan = createMockWorkPlan();
      const changes: ExecutedChange[] = [];

      const report = validateRequestSatisfaction('', workPlan, changes);

      expect(report).toBeDefined();
      expect(report.requirementsMapped).toBeGreaterThanOrEqual(0);
      expect(report.satisfactionScore).toBeGreaterThanOrEqual(0);
      expect(report.satisfactionScore).toBeLessThanOrEqual(100);
    });
  });

  describe('Test 9: Edge Case - Empty Changes', () => {
    it('should handle empty changes list (no implementation)', () => {
      const userRequest = 'must implement authentication';
      const workPlan = createMockWorkPlan();
      const changes: ExecutedChange[] = [];

      const report = validateRequestSatisfaction(userRequest, workPlan, changes);

      expect(report.satisfactionScore).toBeLessThan(50);
      expect(['partially-satisfied', 'unsatisfied']).toContain(report.status);
      expect(report.gaps.length).toBeGreaterThan(0);
    });
  });

  describe('Test 10: Compliance Scoring - Perfect', () => {
    it('should calculate 100 score for perfect compliance', () => {
      const requirements: UserRequirement[] = [
        { id: 'req-0', text: 'login', category: 'functional', priority: 'critical', addressed: false },
        { id: 'req-1', text: 'password', category: 'functional', priority: 'high', addressed: false }
      ];

      const mappings = [
        { requirementId: 'req-0', addressedBy: ['file1'], confidence: 0.9, evidence: ['evidence1'] },
        { requirementId: 'req-1', addressedBy: ['file2'], confidence: 0.9, evidence: ['evidence2'] }
      ];

      const coverage = calculateCoverageAnalysis(requirements, mappings);
      const gaps = identifyGaps(requirements, mappings);
      const score = calculateSatisfactionScore(coverage, gaps);

      expect(score).toBe(100);
    });
  });

  describe('Test 11: Compliance Scoring - Partial', () => {
    it('should calculate reduced score for partial compliance', () => {
      const requirements: UserRequirement[] = [
        { id: 'req-0', text: 'login', category: 'functional', priority: 'critical', addressed: false },
        { id: 'req-1', text: 'password', category: 'functional', priority: 'critical', addressed: false },
        { id: 'req-2', text: 'security', category: 'non-functional', priority: 'high', addressed: false }
      ];

      const mappings = [
        { requirementId: 'req-0', addressedBy: ['file1'], confidence: 0.8, evidence: ['evidence1'] },
        { requirementId: 'req-1', addressedBy: [], confidence: 0, evidence: [] },
        { requirementId: 'req-2', addressedBy: [], confidence: 0, evidence: [] }
      ];

      const coverage = calculateCoverageAnalysis(requirements, mappings);
      const gaps = identifyGaps(requirements, mappings);
      const score = calculateSatisfactionScore(coverage, gaps);

      expect(score).toBeLessThan(50);
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Test 12: Report Generation - Full', () => {
    it('should generate comprehensive compliance report', () => {
      const userRequest = `
        must implement user authentication
        should validate passwords
        must ensure HTTPS connection
        must log all access attempts
      `;
      const workPlan = createMockWorkPlan();
      const changes: ExecutedChange[] = [
        {
          filePath: 'src/auth/login.ts',
          description: 'Implement authentication service',
          impact: 'Enables user login',
          type: 'implementation'
        },
        {
          filePath: 'src/auth/validation.ts',
          description: 'Add password validation',
          impact: 'Validates user passwords',
          type: 'implementation'
        },
        {
          filePath: 'src/audit/logger.ts',
          description: 'Add access logging',
          impact: 'Logs all access attempts',
          type: 'implementation'
        },
        {
          filePath: 'tests/auth.test.ts',
          description: 'Add authentication tests',
          impact: 'Validates auth functionality',
          type: 'test'
        }
      ];

      const report = validateRequestSatisfaction(userRequest, workPlan, changes);

      expect(report).toBeDefined();
      expect(report.requestId).toBeTruthy();
      expect(report.timestamp).toBeInstanceOf(Date);
      expect(report.satisfactionScore).toBeGreaterThanOrEqual(0);
      expect(report.satisfactionScore).toBeLessThanOrEqual(100);
      expect(['satisfied', 'partially-satisfied', 'unsatisfied']).toContain(report.status);
      expect(report.requirementsMapped).toBeGreaterThan(0);
      expect(report.requirementsAddressed).toBeGreaterThanOrEqual(0);
      expect(report.requirementsAddressed).toBeLessThanOrEqual(report.requirementsMapped);
      expect(report.coverage).toBeDefined();
      expect(report.coverage.coveragePercentage).toBeGreaterThanOrEqual(0);
      expect(report.coverage.coveragePercentage).toBeLessThanOrEqual(100);
      expect(report.gaps).toBeInstanceOf(Array);
      expect(report.riskAssessment).toBeTruthy();
      expect(report.recommendations).toBeInstanceOf(Array);
    });
  });

  describe('Status Determination', () => {
    it('should determine satisfied status for high scores', () => {
      expect(determineSatisfactionStatus(95)).toBe('satisfied');
      expect(determineSatisfactionStatus(90)).toBe('satisfied');
    });

    it('should determine partially-satisfied status for medium scores', () => {
      expect(determineSatisfactionStatus(75)).toBe('partially-satisfied');
      expect(determineSatisfactionStatus(50)).toBe('partially-satisfied');
    });

    it('should determine unsatisfied status for low scores', () => {
      expect(determineSatisfactionStatus(45)).toBe('unsatisfied');
      expect(determineSatisfactionStatus(0)).toBe('unsatisfied');
    });
  });

  describe('Risk Assessment', () => {
    it('should identify HIGH risk for critical gaps', () => {
      const coverage = {
        totalRequirements: 3,
        addressedRequirements: 1,
        coveragePercentage: 33,
        criticalityCoverage: new Map(),
        categoryBreakdown: new Map()
      };
      const gaps = [
        { requirementId: 'req-1', requirementText: 'Security', priority: 'critical' as const, reason: 'Not addressed', suggestion: 'Add security checks' }
      ];

      const assessment = generateRiskAssessment(coverage, gaps, 30);

      expect(assessment).toContain('HIGH');
      expect(assessment).toContain('critical');
    });

    it('should identify MEDIUM risk for partial coverage', () => {
      const coverage = {
        totalRequirements: 4,
        addressedRequirements: 2,
        coveragePercentage: 50,
        criticalityCoverage: new Map(),
        categoryBreakdown: new Map()
      };
      const gaps = [];

      const assessment = generateRiskAssessment(coverage, gaps, 60);

      expect(assessment).toContain('MEDIUM');
    });

    it('should identify LOW risk for high coverage', () => {
      const coverage = {
        totalRequirements: 4,
        addressedRequirements: 4,
        coveragePercentage: 100,
        criticalityCoverage: new Map(),
        categoryBreakdown: new Map()
      };
      const gaps = [];

      const assessment = generateRiskAssessment(coverage, gaps, 100);

      expect(assessment).toContain('LOW');
    });
  });

  describe('Recommendations Generation', () => {
    it('should generate positive recommendation for no gaps', () => {
      const recommendations = generateRecommendations([]);

      expect(recommendations).toContain('All requirements are satisfied');
    });

    it('should prioritize critical gaps in recommendations', () => {
      const gaps = [
        { requirementId: 'req-0', requirementText: 'Critical feature', priority: 'critical' as const, reason: 'Not addressed', suggestion: 'Implement critical feature' },
        { requirementId: 'req-1', requirementText: 'Nice to have', priority: 'low' as const, reason: 'Not addressed', suggestion: 'Add nice feature' }
      ];

      const recommendations = generateRecommendations(gaps);

      expect(recommendations.some(r => r.includes('critical'))).toBe(true);
    });

    it('should suggest reviewing multiple gaps', () => {
      const gaps = Array.from({ length: 5 }, (_, i) => ({
        requirementId: `req-${i}`,
        requirementText: `Requirement ${i}`,
        priority: 'medium' as const,
        reason: 'Not addressed',
        suggestion: `Implement requirement ${i}`
      }));

      const recommendations = generateRecommendations(gaps);

      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations.some(r => r.includes('gap'))).toBe(true);
    });
  });
});
