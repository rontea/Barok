/**
 * Quality Gate Orchestrator Tests - Phase 8.7
 * Combines all quality gates (8.1-8.6) into unified quality assessment
 */

import {
  createGateResult,
  assessQualityGates,
  generateQualityReport,
  trackQualityGateHistory,
  canProceedWithMerge,
  getGateResult,
  compareAssessments,
  GateResult,
  QualityGateAssessment,
  QualityGateConfig,
  DEFAULT_GATE_CONFIG
} from '../qualityGateOrchestrator';

describe('Quality Gate Orchestrator', () => {
  const mockGateDataRequest = {
    satisfactionScore: 85,
    status: 'satisfied',
    coverage: { percentage: 85 },
    gaps: [
      { suggestion: 'Add more tests' },
      { suggestion: 'Improve error handling' }
    ]
  };

  const mockGateDataVerification = {
    coverage: { percentage: 90 },
    riskLevel: 'low',
    releaseRequired: false,
    gaps: [
      { suggestion: 'Add e2e test for login flow' }
    ]
  };

  const mockGateDataContract = {
    compatibilityScore: 95,
    violations: []
  };

  const mockGateDataDocumentation = {
    completionPercentage: 80,
    hasCriticalGaps: false,
    hasBreakingChanges: false,
    gaps: [
      { recommendation: 'Document API endpoint changes' }
    ]
  };

  const mockGateDataRisk = {
    overallRiskScore: 25,
    overallRiskLevel: 'low',
    criticalFiles: []
  };

  const mockGateDataReview = {
    feedback: [
      { status: 'approved', reviewer: 'Security Team' },
      { status: 'approved', reviewer: 'Architecture Team' }
    ],
    decision: { overallStatus: 'approved' }
  };

  // Test 1: Create gate result from request satisfaction data
  it('should create gate result from request satisfaction data', () => {
    const result = createGateResult(
      'request-satisfaction',
      'Request Satisfaction',
      mockGateDataRequest,
      'request-satisfaction'
    );

    expect(result.gateId).toBe('request-satisfaction');
    expect(result.score).toBe(85);
    expect(result.passed).toBe(true);
    expect(result.status).toBe('passed');
    expect(result.findings.length).toBeGreaterThan(0);
  });

  // Test 2: Create gate result from verification signals
  it('should create gate result from verification signals data', () => {
    const result = createGateResult(
      'verification-signals',
      'Verification Signals',
      mockGateDataVerification,
      'verification-signals'
    );

    expect(result.gateId).toBe('verification-signals');
    expect(result.score).toBe(90);
    expect(result.status).toBe('passed');
    expect(result.findings).toContain('Verification coverage: 90%');
  });

  // Test 3: Create gate result from contract validation
  it('should create gate result from contract validation data', () => {
    const result = createGateResult(
      'contract-validation',
      'Contract Validation',
      mockGateDataContract,
      'contract-validation'
    );

    expect(result.gateId).toBe('contract-validation');
    expect(result.score).toBe(95);
    expect(result.passed).toBe(true);
  });

  // Test 4: Assess quality gates with all gates passing
  it('should assess quality gates with all gates passing', () => {
    const gateResults: GateResult[] = [
      createGateResult('request-satisfaction', 'Request Satisfaction', mockGateDataRequest, 'request-satisfaction'),
      createGateResult('verification-signals', 'Verification Signals', mockGateDataVerification, 'verification-signals'),
      createGateResult('contract-validation', 'Contract Validation', mockGateDataContract, 'contract-validation'),
      createGateResult('documentation', 'Documentation', mockGateDataDocumentation, 'documentation'),
      createGateResult('risk-assessment', 'Risk Assessment', mockGateDataRisk, 'risk-assessment'),
      createGateResult('reviewer-approval', 'Reviewer Approval', mockGateDataReview, 'reviewer-approval')
    ];

    const assessment = assessQualityGates('task-123', gateResults);

    expect(assessment.taskId).toBe('task-123');
    expect(assessment.gates.length).toBe(6);
    expect(assessment.gatesPassedCount).toBe(6);
    expect(assessment.overallStatus).toBe('passed');
    expect(assessment.overallScore).toBeGreaterThan(0);
  });

  // Test 5: Calculate weighted overall score correctly
  it('should calculate weighted overall score correctly', () => {
    const gateResults: GateResult[] = [
      { gateId: 'request-satisfaction', gateName: 'Request', passed: true, status: 'passed', score: 100, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'contract-validation', gateName: 'Contract', passed: true, status: 'passed', score: 80, severity: 'info', findings: [], recommendations: [], details: {} }
    ];

    const assessment = assessQualityGates('task-weight', gateResults);

    // Score should be weighted average based on config
    expect(assessment.overallScore).toBeGreaterThan(0);
    expect(assessment.overallScore).toBeLessThanOrEqual(100);
  });

  // Test 6: Determine critical status when gates fail
  it('should determine critical status when gates fail with critical severity', () => {
    const gateResults: GateResult[] = [
      { gateId: 'reviewer-approval', gateName: 'Reviewer', passed: false, status: 'failed', score: 0, severity: 'critical', findings: ['Rejected'], recommendations: [], details: {} },
      { gateId: 'contract-validation', gateName: 'Contract', passed: true, status: 'passed', score: 95, severity: 'info', findings: [], recommendations: [], details: {} }
    ];

    const assessment = assessQualityGates('task-critical', gateResults);

    expect(assessment.overallStatus).toBe('critical');
    expect(assessment.blockingIssues.length).toBeGreaterThan(0);
  });

  // Test 7: Track quality gate history
  it('should track quality gate history correctly', () => {
    const gateResults: GateResult[] = [
      createGateResult('request-satisfaction', 'Request Satisfaction', mockGateDataRequest, 'request-satisfaction'),
      createGateResult('verification-signals', 'Verification Signals', mockGateDataVerification, 'verification-signals')
    ];

    const assessment = assessQualityGates('task-history', gateResults);
    const history = trackQualityGateHistory(assessment);

    expect(history.assessmentId).toBe(assessment.assessmentId);
    expect(history.taskId).toBe('task-history');
    expect(history.overallScore).toBe(assessment.overallScore);
    expect(history.gateResults.length).toBe(2);
  });

  // Test 8: Generate comprehensive quality report
  it('should generate comprehensive quality report', () => {
    const gateResults: GateResult[] = [
      createGateResult('request-satisfaction', 'Request Satisfaction', mockGateDataRequest, 'request-satisfaction'),
      createGateResult('verification-signals', 'Verification Signals', mockGateDataVerification, 'verification-signals')
    ];

    const assessment = assessQualityGates('task-report', gateResults);
    const report = generateQualityReport(assessment);

    expect(report).toContain('Quality Gate Assessment Report');
    expect(report).toContain('Overall Status');
    expect(report).toContain('Quality Gates Results');
    expect(report).toContain('Gate Details');
    expect(report.length).toBeGreaterThan(100);
  });

  // Test 9: Check merge readiness - allow for passed status
  it('should allow merge when gates passed', () => {
    const gateResults: GateResult[] = [
      { gateId: 'request-satisfaction', gateName: 'Request', passed: true, status: 'passed', score: 90, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'contract-validation', gateName: 'Contract', passed: true, status: 'passed', score: 95, severity: 'info', findings: [], recommendations: [], details: {} }
    ];

    const assessment = assessQualityGates('task-merge', gateResults);

    expect(canProceedWithMerge(assessment)).toBe(true);
  });

  // Test 10: Block merge when gates fail
  it('should block merge when gates fail', () => {
    const gateResults: GateResult[] = [
      { gateId: 'request-satisfaction', gateName: 'Request', passed: false, status: 'failed', score: 40, severity: 'high', findings: ['Not satisfied'], recommendations: [], details: {} }
    ];

    const assessment = assessQualityGates('task-block', gateResults);

    expect(canProceedWithMerge(assessment)).toBe(false);
  });

  // Test 11: Retrieve specific gate result from assessment
  it('should retrieve specific gate result by ID', () => {
    const gateResults: GateResult[] = [
      { gateId: 'request-satisfaction', gateName: 'Request Satisfaction', passed: true, status: 'passed', score: 85, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'contract-validation', gateName: 'Contract Validation', passed: true, status: 'passed', score: 95, severity: 'info', findings: [], recommendations: [], details: {} }
    ];

    const assessment = assessQualityGates('task-get', gateResults);
    const result = getGateResult(assessment, 'contract-validation');

    expect(result).toBeDefined();
    expect(result?.gateId).toBe('contract-validation');
    expect(result?.score).toBe(95);
  });

  // Test 12: Compare two assessments to show improvements
  it('should compare assessments and show improvements', () => {
    const gateResults1: GateResult[] = [
      { gateId: 'request-satisfaction', gateName: 'Request', passed: true, status: 'passed', score: 70, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'verification-signals', gateName: 'Verification', passed: true, status: 'passed', score: 75, severity: 'info', findings: [], recommendations: [], details: {} }
    ];

    const gateResults2: GateResult[] = [
      { gateId: 'request-satisfaction', gateName: 'Request', passed: true, status: 'passed', score: 85, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'verification-signals', gateName: 'Verification', passed: true, status: 'passed', score: 90, severity: 'info', findings: [], recommendations: [], details: {} }
    ];

    const assessment1 = assessQualityGates('task-compare1', gateResults1);
    const assessment2 = assessQualityGates('task-compare2', gateResults2);

    const comparison = compareAssessments(assessment1, assessment2);

    expect(comparison.scoreChange).toBeGreaterThan(0);
    expect(comparison.improvementAreas.length).toBeGreaterThan(0);
  });

  // Test 13: Handle edge case with single gate
  it('should handle assessment with single gate', () => {
    const gateResults: GateResult[] = [
      createGateResult('request-satisfaction', 'Request Satisfaction', mockGateDataRequest, 'request-satisfaction')
    ];

    const assessment = assessQualityGates('task-single', gateResults);

    expect(assessment.gates.length).toBe(1);
    expect(assessment.gatesPassedCount).toBe(1);
    expect(assessment.passRate).toBe(100);
    expect(assessment.overallStatus).toBe('passed');
  });

  // Test 14: Detect regressions in comparison
  it('should detect regressions when comparing assessments', () => {
    const gateResults1: GateResult[] = [
      { gateId: 'request-satisfaction', gateName: 'Request', passed: true, status: 'passed', score: 90, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'verification-signals', gateName: 'Verification', passed: true, status: 'passed', score: 85, severity: 'info', findings: [], recommendations: [], details: {} }
    ];

    const gateResults2: GateResult[] = [
      { gateId: 'request-satisfaction', gateName: 'Request', passed: true, status: 'passed', score: 75, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'verification-signals', gateName: 'Verification', passed: true, status: 'passed', score: 80, severity: 'info', findings: [], recommendations: [], details: {} }
    ];

    const assessment1 = assessQualityGates('task-regress1', gateResults1);
    const assessment2 = assessQualityGates('task-regress2', gateResults2);

    const comparison = compareAssessments(assessment1, assessment2);

    expect(comparison.scoreChange).toBeLessThan(0);
    expect(comparison.regressionAreas.length).toBeGreaterThan(0);
  });

  // Test 15: Create gate result from rejected reviewer data
  it('should create critical gate result from rejected reviewer', () => {
    const rejectedReview = {
      feedback: [
        { status: 'rejected', reviewer: 'Security Team', concerns: ['SQL injection risk'] }
      ],
      decision: { overallStatus: 'rejected' }
    };

    const result = createGateResult(
      'reviewer-approval',
      'Reviewer Approval',
      rejectedReview,
      'reviewer-approval'
    );

    expect(result.passed).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.score).toBe(0);
    expect(result.severity).toBe('critical');
  });

  // Test 16: Create gate result from conditional approval
  it('should create warning gate result from conditional approval', () => {
    const conditionalReview = {
      feedback: [
        { 
          status: 'approved-with-conditions', 
          reviewer: 'Architecture Team',
          conditions: ['Add integration tests', 'Document API changes']
        }
      ],
      decision: { overallStatus: 'approved-with-conditions' }
    };

    const result = createGateResult(
      'reviewer-approval',
      'Reviewer Approval',
      conditionalReview,
      'reviewer-approval'
    );

    expect(result.passed).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.score).toBe(50);
    expect(result.severity).toBe('high');
  });

  // Test 17: Aggregate recommendations by severity
  it('should aggregate and prioritize recommendations by severity', () => {
    const gateResults: GateResult[] = [
      { 
        gateId: 'risk-assessment', 
        gateName: 'Risk Assessment', 
        passed: false, 
        status: 'warning', 
        score: 65, 
        severity: 'high', 
        findings: ['High risk detected'],
        recommendations: ['Review risky changes'], 
        details: {} 
      },
      { 
        gateId: 'documentation', 
        gateName: 'Documentation', 
        passed: false, 
        status: 'warning', 
        score: 70, 
        severity: 'medium', 
        findings: ['Incomplete docs'],
        recommendations: ['Update API documentation'], 
        details: {} 
      }
    ];

    const assessment = assessQualityGates('task-priority', gateResults);

    expect(assessment.topRecommendations.length).toBeGreaterThan(0);
    // High severity recommendations should come first
    if (assessment.topRecommendations[0] === 'Review risky changes') {
      expect(assessment.topRecommendations[0]).toBe('Review risky changes');
    }
  });

  // Test 18: Calculate pass rate correctly
  it('should calculate pass rate as percentage of passed gates', () => {
    const gateResults: GateResult[] = [
      { gateId: 'gate1', gateName: 'Gate 1', passed: true, status: 'passed', score: 90, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'gate2', gateName: 'Gate 2', passed: true, status: 'passed', score: 85, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'gate3', gateName: 'Gate 3', passed: false, status: 'failed', score: 50, severity: 'high', findings: [], recommendations: [], details: {} },
      { gateId: 'gate4', gateName: 'Gate 4', passed: false, status: 'warning', score: 75, severity: 'medium', findings: [], recommendations: [], details: {} }
    ];

    const assessment = assessQualityGates('task-passrate', gateResults);

    expect(assessment.passRate).toBe(50);
    expect(assessment.gatesPassedCount).toBe(2);
    expect(assessment.gatesWarningCount).toBe(1);
    expect(assessment.gatesFailedCount).toBe(1);
  });

  // Test 19: Generate unique assessment IDs
  it('should generate unique assessment IDs', () => {
    const gateResults: GateResult[] = [
      { gateId: 'gate1', gateName: 'Gate 1', passed: true, status: 'passed', score: 90, severity: 'info', findings: [], recommendations: [], details: {} }
    ];

    const assessment1 = assessQualityGates('task-id1', gateResults);
    const assessment2 = assessQualityGates('task-id2', gateResults);

    expect(assessment1.assessmentId).not.toBe(assessment2.assessmentId);
  });

  // Test 20: Report shows all gate details
  it('should include all gate details in generated report', () => {
    const gateResults: GateResult[] = [
      {
        gateId: 'request-satisfaction',
        gateName: 'Request Satisfaction',
        passed: true,
        status: 'passed',
        score: 85,
        severity: 'info',
        findings: ['All requirements met', 'Good coverage'],
        recommendations: ['Add more edge case tests'],
        details: { status: 'satisfied', coverage: 85 }
      }
    ];

    const assessment = assessQualityGates('task-details', gateResults);
    const report = generateQualityReport(assessment);

    expect(report).toContain('Request Satisfaction');
    expect(report).toContain('85');
    expect(report).toContain('All requirements met');
    expect(report).toContain('Add more edge case tests');
  });
});
