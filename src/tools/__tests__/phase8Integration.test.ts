/**
 * Phase 8 Integration Tests - Phase 8.9
 * End-to-end testing of all quality gates combining 8.1-8.8
 */

import {
  createGateResult,
  assessQualityGates,
  generateQualityReport,
  canProceedWithMerge,
  compareAssessments,
  GateResult,
  QualityGateAssessment
} from '../qualityGateOrchestrator';

describe('Phase 8 Integration Tests', () => {
  // Test 1: Happy path - All gates passing
  it('should handle happy path with all gates passing', () => {
    const gateResults: GateResult[] = [
      { gateId: 'request-satisfaction', gateName: 'Request Satisfaction', passed: true, status: 'passed', score: 95, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'verification-signals', gateName: 'Verification Signals', passed: true, status: 'passed', score: 90, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'contract-validation', gateName: 'Contract Validation', passed: true, status: 'passed', score: 100, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'documentation', gateName: 'Documentation', passed: true, status: 'passed', score: 85, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'risk-assessment', gateName: 'Risk Assessment', passed: true, status: 'passed', score: 92, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'reviewer-approval', gateName: 'Reviewer Approval', passed: true, status: 'passed', score: 100, severity: 'info', findings: [], recommendations: [], details: {} }
    ];

    const assessment = assessQualityGates('task-happy-path', gateResults);

    expect(assessment.overallStatus).toBe('passed');
    expect(assessment.gatesPassedCount).toBe(6);
    expect(assessment.gatesFailedCount).toBe(0);
    expect(assessment.overallScore).toBeGreaterThan(90);
    expect(canProceedWithMerge(assessment)).toBe(true);
  });

  // Test 2: Multi-layer bug fix scenario
  it('should validate bug fix across multiple layers', () => {
    const bugFixGates: GateResult[] = [
      {
        gateId: 'request-satisfaction',
        gateName: 'Request Satisfaction',
        passed: true,
        status: 'passed',
        score: 88,
        severity: 'info',
        findings: ['Fixed auth validation bug', 'Prevents invalid tokens'],
        recommendations: ['Add regression tests'],
        details: {}
      },
      {
        gateId: 'verification-signals',
        gateName: 'Verification Signals',
        passed: true,
        status: 'passed',
        score: 82,
        severity: 'low',
        findings: ['Unit tests cover fix', '2 e2e tests verify behavior'],
        recommendations: ['Add edge case tests'],
        details: {}
      },
      {
        gateId: 'contract-validation',
        gateName: 'Contract Validation',
        passed: true,
        status: 'passed',
        score: 95,
        severity: 'info',
        findings: ['Auth response contract maintained'],
        recommendations: [],
        details: {}
      },
      {
        gateId: 'documentation',
        gateName: 'Documentation',
        passed: false,
        status: 'warning',
        score: 75,
        severity: 'medium',
        findings: ['Auth flow docs updated'],
        recommendations: ['Document breaking change note'],
        details: {}
      },
      {
        gateId: 'risk-assessment',
        gateName: 'Risk Assessment',
        passed: true,
        status: 'passed',
        score: 80,
        severity: 'medium',
        findings: ['Changes in auth layer (medium risk)', 'No global state changes'],
        recommendations: ['Monitor auth failures in production'],
        details: {}
      },
      {
        gateId: 'reviewer-approval',
        gateName: 'Reviewer Approval',
        passed: true,
        status: 'passed',
        score: 100,
        severity: 'info',
        findings: ['Security team approved'],
        recommendations: [],
        details: {}
      }
    ];

    const assessment = assessQualityGates('task-bug-fix', bugFixGates);

    expect(assessment.overallStatus).toBe('warning');
    expect(assessment.gatesPassedCount).toBe(5);
    expect(assessment.gatesWarningCount).toBe(1);
    expect(canProceedWithMerge(assessment)).toBe(true); // Warning allows merge
    expect(assessment.topRecommendations).toContain('Add regression tests');
  });

  // Test 3: Feature implementation scenario
  it('should validate feature across all layers with partial verification', () => {
    const featureGates: GateResult[] = [
      {
        gateId: 'request-satisfaction',
        gateName: 'Request Satisfaction',
        passed: true,
        status: 'passed',
        score: 92,
        severity: 'info',
        findings: ['Two-factor auth fully implemented', 'All user stories completed'],
        recommendations: [],
        details: {}
      },
      {
        gateId: 'verification-signals',
        gateName: 'Verification Signals',
        passed: false,
        status: 'warning',
        score: 72,
        severity: 'medium',
        findings: ['85% test coverage', 'Backend tests complete', 'UI tests incomplete'],
        recommendations: ['Add UI component tests', 'Add e2e flow tests'],
        details: {}
      },
      {
        gateId: 'contract-validation',
        gateName: 'Contract Validation',
        passed: true,
        status: 'passed',
        score: 88,
        severity: 'info',
        findings: ['New API contracts defined', 'Backwards compatible'],
        recommendations: [],
        details: {}
      },
      {
        gateId: 'documentation',
        gateName: 'Documentation',
        passed: false,
        status: 'warning',
        score: 70,
        severity: 'medium',
        findings: ['README updated', 'API docs missing examples'],
        recommendations: ['Document 2FA setup flow', 'Add configuration examples'],
        details: {}
      },
      {
        gateId: 'risk-assessment',
        gateName: 'Risk Assessment',
        passed: false,
        status: 'warning',
        score: 65,
        severity: 'high',
        findings: ['New backend service introduced (high risk)', 'External API dependency'],
        recommendations: ['Add fallback mechanism', 'Add service health checks'],
        details: {}
      },
      {
        gateId: 'reviewer-approval',
        gateName: 'Reviewer Approval',
        passed: false,
        status: 'warning',
        score: 60,
        severity: 'high',
        findings: ['Architecture team: approved with conditions', 'Security team: pending review'],
        recommendations: ['Address architecture conditions', 'Wait for security review'],
        details: {}
      }
    ];

    const assessment = assessQualityGates('task-feature', featureGates);

    expect(assessment.overallStatus).toBe('warning');
    expect(assessment.gatesWarningCount).toBeGreaterThan(2);
    // Blocking issues contain warnings and findings from gates
    expect(assessment.topRecommendations.length).toBeGreaterThan(0);
  });

  // Test 4: Refactoring scenario
  it('should validate refactoring with risk assessment', () => {
    const refactorGates: GateResult[] = [
      {
        gateId: 'request-satisfaction',
        gateName: 'Request Satisfaction',
        passed: true,
        status: 'passed',
        score: 85,
        severity: 'info',
        findings: ['Extracted service layer', 'No functional changes'],
        recommendations: [],
        details: {}
      },
      {
        gateId: 'verification-signals',
        gateName: 'Verification Signals',
        passed: true,
        status: 'passed',
        score: 95,
        severity: 'info',
        findings: ['All unit tests pass', '100% code coverage maintained'],
        recommendations: [],
        details: {}
      },
      {
        gateId: 'contract-validation',
        gateName: 'Contract Validation',
        passed: true,
        status: 'passed',
        score: 100,
        severity: 'info',
        findings: ['Contracts unchanged', 'Public APIs preserved'],
        recommendations: [],
        details: {}
      },
      {
        gateId: 'documentation',
        gateName: 'Documentation',
        passed: true,
        status: 'passed',
        score: 90,
        severity: 'info',
        findings: ['Architecture docs updated', 'Refactoring documented'],
        recommendations: [],
        details: {}
      },
      {
        gateId: 'risk-assessment',
        gateName: 'Risk Assessment',
        passed: true,
        status: 'passed',
        score: 88,
        severity: 'low',
        findings: ['Low complexity changes', 'Well-isolated refactoring'],
        recommendations: ['Run integration tests in staging'],
        details: {}
      },
      {
        gateId: 'reviewer-approval',
        gateName: 'Reviewer Approval',
        passed: true,
        status: 'passed',
        score: 100,
        severity: 'info',
        findings: ['Approved by architecture team'],
        recommendations: [],
        details: {}
      }
    ];

    const assessment = assessQualityGates('task-refactor', refactorGates);

    expect(assessment.overallStatus).toBe('passed');
    expect(assessment.gatesPassedCount).toBe(6);
    expect(assessment.overallScore).toBeGreaterThan(90);
  });

  // Test 5: Critical failure scenario - blocked gates
  it('should block merge when critical gates fail', () => {
    const failedGates: GateResult[] = [
      {
        gateId: 'request-satisfaction',
        gateName: 'Request Satisfaction',
        passed: false,
        status: 'failed',
        score: 40,
        severity: 'high',
        findings: ['Multiple requirements not addressed', 'Only 60% coverage'],
        recommendations: ['Address missing requirements', 'Add missing features'],
        details: {}
      },
      {
        gateId: 'verification-signals',
        gateName: 'Verification Signals',
        passed: false,
        status: 'failed',
        score: 35,
        severity: 'critical',
        findings: ['Critical files untested', 'Only 30% verification coverage'],
        recommendations: ['Add critical path tests', 'Increase verification coverage to 80%'],
        details: {}
      },
      {
        gateId: 'contract-validation',
        gateName: 'Contract Validation',
        passed: false,
        status: 'failed',
        score: 45,
        severity: 'high',
        findings: ['Breaking API changes', 'UI-API contract violated'],
        recommendations: ['Maintain backwards compatibility', 'Add migration path'],
        details: {}
      },
      {
        gateId: 'documentation',
        gateName: 'Documentation',
        passed: false,
        status: 'failed',
        score: 50,
        severity: 'medium',
        findings: ['No docs updated'],
        recommendations: ['Update all affected documentation'],
        details: {}
      },
      {
        gateId: 'risk-assessment',
        gateName: 'Risk Assessment',
        passed: false,
        status: 'failed',
        score: 30,
        severity: 'critical',
        findings: ['Critical risk detected', 'Global state modifications', 'Uncontrolled side effects'],
        recommendations: ['Eliminate global state changes', 'Refactor for isolation'],
        details: {}
      },
      {
        gateId: 'reviewer-approval',
        gateName: 'Reviewer Approval',
        passed: false,
        status: 'failed',
        score: 0,
        severity: 'critical',
        findings: ['Rejected by security team', 'SQL injection vulnerability detected'],
        recommendations: ['Fix security vulnerability', 'Add input validation'],
        details: {}
      }
    ];

    const assessment = assessQualityGates('task-critical-fail', failedGates);

    expect(assessment.overallStatus).toBe('critical');
    expect(assessment.gatesFailedCount).toBeGreaterThan(3);
    expect(canProceedWithMerge(assessment)).toBe(false);
    expect(assessment.blockingIssues.length).toBeGreaterThan(0);
  });

  // Test 6: Multi-layer infrastructure change
  it('should validate infrastructure changes affecting multiple layers', () => {
    const infraGates: GateResult[] = [
      {
        gateId: 'request-satisfaction',
        gateName: 'Request Satisfaction',
        passed: true,
        status: 'passed',
        score: 88,
        severity: 'info',
        findings: ['Database migration completed', 'Data integrity verified'],
        recommendations: [],
        details: {}
      },
      {
        gateId: 'verification-signals',
        gateName: 'Verification Signals',
        passed: true,
        status: 'passed',
        score: 85,
        severity: 'low',
        findings: ['Migration tests added', 'Data validation tests pass'],
        recommendations: ['Add performance tests'],
        details: {}
      },
      {
        gateId: 'contract-validation',
        gateName: 'Contract Validation',
        passed: false,
        status: 'warning',
        score: 78,
        severity: 'medium',
        findings: ['Data model changes', 'API response format may change'],
        recommendations: ['Add deprecation period', 'Provide data mapping'],
        details: {}
      },
      {
        gateId: 'documentation',
        gateName: 'Documentation',
        passed: false,
        status: 'warning',
        score: 72,
        severity: 'medium',
        findings: ['Migration guide missing', 'New schema docs incomplete'],
        recommendations: ['Document migration steps', 'Update data model docs'],
        details: {}
      },
      {
        gateId: 'risk-assessment',
        gateName: 'Risk Assessment',
        passed: false,
        status: 'warning',
        score: 68,
        severity: 'high',
        findings: ['Database downtime required', 'Large scale changes'],
        recommendations: ['Plan maintenance window', 'Add rollback plan'],
        details: {}
      },
      {
        gateId: 'reviewer-approval',
        gateName: 'Reviewer Approval',
        passed: true,
        status: 'passed',
        score: 85,
        severity: 'low',
        findings: ['Devops team: approved with caution', 'DBA review complete'],
        recommendations: [],
        details: {}
      }
    ];

    const assessment = assessQualityGates('task-infrastructure', infraGates);

    expect(assessment.overallStatus).toBe('warning');
    expect(assessment.gatesWarningCount).toBeGreaterThanOrEqual(3);
    expect(assessment.topRecommendations.length).toBeGreaterThan(0);
  });

  // Test 7: Compare good assessment to improved assessment
  it('should detect improvements between assessments', () => {
    const poorGates: GateResult[] = [
      { gateId: 'request-satisfaction', gateName: 'Request Satisfaction', passed: false, status: 'warning', score: 65, severity: 'medium', findings: [], recommendations: [], details: {} },
      { gateId: 'verification-signals', gateName: 'Verification Signals', passed: false, status: 'warning', score: 60, severity: 'high', findings: [], recommendations: [], details: {} }
    ];

    const improvedGates: GateResult[] = [
      { gateId: 'request-satisfaction', gateName: 'Request Satisfaction', passed: true, status: 'passed', score: 88, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'verification-signals', gateName: 'Verification Signals', passed: true, status: 'passed', score: 85, severity: 'info', findings: [], recommendations: [], details: {} }
    ];

    const poorAssessment = assessQualityGates('task-initial', poorGates);
    const improvedAssessment = assessQualityGates('task-improved', improvedGates);

    const comparison = compareAssessments(poorAssessment, improvedAssessment);

    expect(comparison.scoreChange).toBeGreaterThan(0);
    expect(comparison.improvementAreas.length).toBeGreaterThan(0);
    expect(comparison.regressionAreas.length).toBe(0);
  });

  // Test 8: Compare good assessment to regressed assessment
  it('should detect regressions between assessments', () => {
    const goodGates: GateResult[] = [
      { gateId: 'request-satisfaction', gateName: 'Request Satisfaction', passed: true, status: 'passed', score: 90, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'verification-signals', gateName: 'Verification Signals', passed: true, status: 'passed', score: 85, severity: 'info', findings: [], recommendations: [], details: {} }
    ];

    const regressionGates: GateResult[] = [
      { gateId: 'request-satisfaction', gateName: 'Request Satisfaction', passed: false, status: 'warning', score: 70, severity: 'medium', findings: [], recommendations: [], details: {} },
      { gateId: 'verification-signals', gateName: 'Verification Signals', passed: false, status: 'warning', score: 65, severity: 'medium', findings: [], recommendations: [], details: {} }
    ];

    const goodAssessment = assessQualityGates('task-good', goodGates);
    const regressionAssessment = assessQualityGates('task-regressed', regressionGates);

    const comparison = compareAssessments(goodAssessment, regressionAssessment);

    expect(comparison.scoreChange).toBeLessThan(0);
    expect(comparison.regressionAreas.length).toBeGreaterThan(0);
  });

  // Test 9: Edge case - single gate partial pass
  it('should handle single gate with mixed success indicators', () => {
    const singleGate: GateResult[] = [
      {
        gateId: 'contract-validation',
        gateName: 'Contract Validation',
        passed: false,
        status: 'warning',
        score: 72,
        severity: 'medium',
        findings: ['Some breaking changes', 'Backwards compatibility maintained for v1'],
        recommendations: ['Document breaking changes', 'Provide migration guide'],
        details: {}
      }
    ];

    const assessment = assessQualityGates('task-single-warning', singleGate);

    expect(assessment.gates.length).toBe(1);
    expect(assessment.gatesWarningCount).toBe(1);
    expect(assessment.overallStatus).toBe('warning');
  });

  // Test 10: Edge case - multiple gates with same failure
  it('should aggregate multiple gates with same failure type', () => {
    const multipleFailures: GateResult[] = [
      {
        gateId: 'verification-signals',
        gateName: 'Verification Signals',
        passed: false,
        status: 'failed',
        score: 40,
        severity: 'high',
        findings: ['Critical backend logic untested'],
        recommendations: ['Add unit tests'],
        details: {}
      },
      {
        gateId: 'risk-assessment',
        gateName: 'Risk Assessment',
        passed: false,
        status: 'failed',
        score: 45,
        severity: 'high',
        findings: ['Untested critical logic poses risks'],
        recommendations: ['Add integration tests'],
        details: {}
      }
    ];

    const assessment = assessQualityGates('task-multiple-failures', multipleFailures);

    expect(assessment.gatesFailedCount).toBe(2);
    expect(assessment.blockingIssues.length).toBeGreaterThanOrEqual(2);
  });

  // Test 11: Generate report with all gate types
  it('should generate comprehensive report with all gate types', () => {
    const allGates: GateResult[] = [
      { gateId: 'g1', gateName: 'Gate 1', passed: true, status: 'passed', score: 95, severity: 'info', findings: ['Finding 1'], recommendations: ['Rec 1'], details: {} },
      { gateId: 'g2', gateName: 'Gate 2', passed: true, status: 'passed', score: 90, severity: 'info', findings: ['Finding 2'], recommendations: ['Rec 2'], details: {} },
      { gateId: 'g3', gateName: 'Gate 3', passed: false, status: 'warning', score: 75, severity: 'medium', findings: ['Finding 3'], recommendations: ['Rec 3'], details: {} }
    ];

    const assessment = assessQualityGates('task-report', allGates);
    const report = generateQualityReport(assessment);

    expect(report).toContain('Quality Gate Assessment Report');
    expect(report).toContain('Overall Status');
    expect(report).toContain('Gate 1');
    expect(report).toContain('Gate 2');
    expect(report).toContain('Gate 3');
    expect(report).toContain('Recommendations');
    expect(report).toContain('Summary Statistics');
  });

  // Test 12: Scenario - API breaking change detection
  it('should detect API breaking change and require additional verification', () => {
    const breakingChangeGates: GateResult[] = [
      {
        gateId: 'contract-validation',
        gateName: 'Contract Validation',
        passed: false,
        status: 'failed',
        score: 35,
        severity: 'critical',
        findings: ['Breaking API change detected', 'Removed endpoint /api/v1/users/{id}', 'Changed response type'],
        recommendations: ['Maintain endpoint with deprecation warning', 'Provide v2 alongside v1'],
        details: {}
      },
      {
        gateId: 'documentation',
        gateName: 'Documentation',
        passed: false,
        status: 'warning',
        score: 60,
        severity: 'high',
        findings: ['No migration guide'],
        recommendations: ['Create v1→v2 migration guide'],
        details: {}
      },
      {
        gateId: 'reviewer-approval',
        gateName: 'Reviewer Approval',
        passed: false,
        status: 'warning',
        score: 50,
        severity: 'high',
        findings: ['API team: needs deprecation plan'],
        recommendations: [],
        details: {}
      }
    ];

    const assessment = assessQualityGates('task-breaking-change', breakingChangeGates);

    // Contract validation failure with critical severity results in critical status
    expect(['failed', 'critical']).toContain(assessment.overallStatus);
    expect(canProceedWithMerge(assessment)).toBe(false);
    expect(assessment.blockingIssues.some(i => i.includes('Contract'))).toBe(true);
  });

  // Test 13: Scenario - Documentation gaps discovery
  it('should detect documentation gaps during review', () => {
    const docGapGates: GateResult[] = [
      {
        gateId: 'request-satisfaction',
        gateName: 'Request Satisfaction',
        passed: true,
        status: 'passed',
        score: 90,
        severity: 'info',
        findings: [],
        recommendations: [],
        details: {}
      },
      {
        gateId: 'documentation',
        gateName: 'Documentation',
        passed: false,
        status: 'warning',
        score: 65,
        severity: 'medium',
        findings: ['README incomplete', 'API examples outdated', 'No setup guide'],
        recommendations: ['Update README', 'Fix API examples', 'Add setup instructions'],
        details: {}
      }
    ];

    const assessment = assessQualityGates('task-doc-gap', docGapGates);

    expect(assessment.topRecommendations.length).toBeGreaterThan(0);
    expect(assessment.topRecommendations.some(r => r.includes('README') || r.includes('setup') || r.includes('API'))).toBe(true);
  });

  // Test 14: Scenario - Risk assessment with mitigation
  it('should recommend mitigation strategies for high-risk changes', () => {
    const riskGates: GateResult[] = [
      {
        gateId: 'risk-assessment',
        gateName: 'Risk Assessment',
        passed: false,
        status: 'warning',
        score: 65,
        severity: 'high',
        findings: ['Global state changes detected', 'Cache invalidation logic complex'],
        recommendations: ['Add feature flag for rollback', 'Add canary deployment', 'Monitor metrics closely'],
        details: {}
      }
    ];

    const assessment = assessQualityGates('task-risk-mitigation', riskGates);

    expect(assessment.topRecommendations).toContain('Add feature flag for rollback');
    expect(assessment.topRecommendations.some(r => r.includes('canary') || r.includes('monitor'))).toBe(true);
  });

  // Test 15: Scenario - Conditional approval with requirements
  it('should track conditional approval requirements', () => {
    const conditionalGates: GateResult[] = [
      {
        gateId: 'reviewer-approval',
        gateName: 'Reviewer Approval',
        passed: false,
        status: 'warning',
        score: 50,
        severity: 'high',
        findings: ['Architecture team: approved with conditions'],
        recommendations: ['Add performance benchmarks', 'Document architecture decisions', 'Schedule architecture review'],
        details: {}
      }
    ];

    const assessment = assessQualityGates('task-conditional', conditionalGates);

    expect(assessment.topRecommendations.length).toBeGreaterThan(0);
    // Single high-severity warning can result in critical or warning status
    expect(['warning', 'critical']).toContain(assessment.overallStatus);
  });

  // Test 16: Scenario - Ready for production merge
  it('should confirm ready for production when all gates pass', () => {
    const productionReady: GateResult[] = [
      { gateId: 'request-satisfaction', gateName: 'Request Satisfaction', passed: true, status: 'passed', score: 96, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'verification-signals', gateName: 'Verification Signals', passed: true, status: 'passed', score: 94, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'contract-validation', gateName: 'Contract Validation', passed: true, status: 'passed', score: 100, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'documentation', gateName: 'Documentation', passed: true, status: 'passed', score: 92, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'risk-assessment', gateName: 'Risk Assessment', passed: true, status: 'passed', score: 90, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'reviewer-approval', gateName: 'Reviewer Approval', passed: true, status: 'passed', score: 100, severity: 'info', findings: [], recommendations: [], details: {} }
    ];

    const assessment = assessQualityGates('task-production', productionReady);

    expect(assessment.overallStatus).toBe('passed');
    expect(canProceedWithMerge(assessment)).toBe(true);
    expect(assessment.overallScore).toBeGreaterThan(93);
    expect(assessment.gatesPassedCount).toBe(6);
  });

  // Test 17: Scenario - Staged rollout decision
  it('should recommend staged rollout for complex changes', () => {
    const complexGates: GateResult[] = [
      {
        gateId: 'risk-assessment',
        gateName: 'Risk Assessment',
        passed: false,
        status: 'warning',
        score: 72,
        severity: 'high',
        findings: ['Complex business logic change', 'Multiple dependency updates'],
        recommendations: ['Use feature flag', 'Staged rollout: 5% → 25% → 50% → 100%', 'Monitor user engagement metrics'],
        details: {}
      },
      {
        gateId: 'verification-signals',
        gateName: 'Verification Signals',
        passed: true,
        status: 'passed',
        score: 88,
        severity: 'low',
        findings: ['Good test coverage'],
        recommendations: [],
        details: {}
      }
    ];

    const assessment = assessQualityGates('task-rollout', complexGates);

    expect(assessment.topRecommendations.some(r => r.includes('feature flag') || r.includes('rollout'))).toBe(true);
  });

  // Test 18: Scenario - Security concern requires blocking
  it('should block merge when security gate fails', () => {
    const securityConcern: GateResult[] = [
      {
        gateId: 'reviewer-approval',
        gateName: 'Reviewer Approval',
        passed: false,
        status: 'failed',
        score: 0,
        severity: 'critical',
        findings: ['Security team: REJECTED', 'SQL injection vulnerability', 'Unvalidated user input in query'],
        recommendations: ['Use parameterized queries', 'Add input validation', 'Run security audit'],
        details: {}
      }
    ];

    const assessment = assessQualityGates('task-security', securityConcern);

    expect(assessment.overallStatus).toBe('critical');
    expect(canProceedWithMerge(assessment)).toBe(false);
    expect(assessment.blockingIssues[0]).toContain('Reviewer');
  });

  // Test 19: Scenario - Performance regression detected
  it('should flag performance regression in risk assessment', () => {
    const perfRegression: GateResult[] = [
      {
        gateId: 'risk-assessment',
        gateName: 'Risk Assessment',
        passed: false,
        status: 'warning',
        score: 70,
        severity: 'high',
        findings: ['Performance regression detected', '40% slower in high-load scenario', 'Memory usage increased 25%'],
        recommendations: ['Profile code', 'Optimize hot paths', 'Consider caching strategy', 'Run load tests in staging'],
        details: {}
      }
    ];

    const assessment = assessQualityGates('task-perf-regression', perfRegression);

    expect(assessment.topRecommendations.some(r => r.includes('Profile') || r.includes('caching'))).toBe(true);
  });

  // Test 20: Scenario - Data migration with verification
  it('should validate data migration across layers', () => {
    const migrationGates: GateResult[] = [
      {
        gateId: 'request-satisfaction',
        gateName: 'Request Satisfaction',
        passed: true,
        status: 'passed',
        score: 88,
        severity: 'info',
        findings: ['User data successfully migrated'],
        recommendations: [],
        details: {}
      },
      {
        gateId: 'verification-signals',
        gateName: 'Verification Signals',
        passed: true,
        status: 'passed',
        score: 90,
        severity: 'info',
        findings: ['Migration tests pass', 'Data validation complete'],
        recommendations: [],
        details: {}
      },
      {
        gateId: 'contract-validation',
        gateName: 'Contract Validation',
        passed: false,
        status: 'warning',
        score: 78,
        severity: 'medium',
        findings: ['Data schema changed', 'API response format updated'],
        recommendations: ['Add backwards compatibility layer'],
        details: {}
      }
    ];

    const assessment = assessQualityGates('task-migration', migrationGates);

    expect(assessment.overallStatus).toBe('warning');
    expect(assessment.topRecommendations.some(r => r.includes('compatibility'))).toBe(true);
  });

  // Test 21: Full workflow - from draft to production
  it('should track quality progression through workflow stages', () => {
    const draftGates: GateResult[] = [
      { gateId: 'request-satisfaction', gateName: 'Request Satisfaction', passed: false, status: 'failed', score: 40, severity: 'high', findings: [], recommendations: [], details: {} },
      { gateId: 'verification-signals', gateName: 'Verification Signals', passed: false, status: 'failed', score: 35, severity: 'critical', findings: [], recommendations: [], details: {} },
      { gateId: 'contract-validation', gateName: 'Contract Validation', passed: true, status: 'passed', score: 50, severity: 'medium', findings: [], recommendations: [], details: {} },
      { gateId: 'documentation', gateName: 'Documentation', passed: true, status: 'passed', score: 55, severity: 'medium', findings: [], recommendations: [], details: {} },
      { gateId: 'risk-assessment', gateName: 'Risk Assessment', passed: false, status: 'warning', score: 60, severity: 'medium', findings: [], recommendations: [], details: {} },
      { gateId: 'reviewer-approval', gateName: 'Reviewer Approval', passed: false, status: 'failed', score: 30, severity: 'high', findings: [], recommendations: [], details: {} }
    ];

    const refinedGates: GateResult[] = [
      { gateId: 'request-satisfaction', gateName: 'Request Satisfaction', passed: true, status: 'passed', score: 88, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'verification-signals', gateName: 'Verification Signals', passed: true, status: 'passed', score: 85, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'contract-validation', gateName: 'Contract Validation', passed: true, status: 'passed', score: 90, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'documentation', gateName: 'Documentation', passed: true, status: 'passed', score: 87, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'risk-assessment', gateName: 'Risk Assessment', passed: true, status: 'passed', score: 84, severity: 'info', findings: [], recommendations: [], details: {} },
      { gateId: 'reviewer-approval', gateName: 'Reviewer Approval', passed: true, status: 'passed', score: 92, severity: 'info', findings: [], recommendations: [], details: {} }
    ];

    const draftAssessment = assessQualityGates('task-draft', draftGates);
    const refinedAssessment = assessQualityGates('task-refined', refinedGates);

    expect(['failed', 'critical', 'warning']).toContain(draftAssessment.overallStatus);
    expect(refinedAssessment.overallStatus).toBe('passed');

    const progression = compareAssessments(draftAssessment, refinedAssessment);
    expect(progression.scoreChange).toBeGreaterThan(30);
  });

  // Test 22: Complete end-to-end scenario - real-world task
  it('should handle complete end-to-end quality gate assessment workflow', () => {
    // Simulate a real task with all 6 gates
    const realWorldGates: GateResult[] = [
      {
        gateId: 'request-satisfaction',
        gateName: 'Request Satisfaction',
        passed: true,
        status: 'passed',
        score: 87,
        severity: 'info',
        findings: ['User onboarding flow improved', '85% of acceptance criteria met'],
        recommendations: ['Add email notification feature'],
        details: {}
      },
      {
        gateId: 'verification-signals',
        gateName: 'Verification Signals',
        passed: true,
        status: 'passed',
        score: 81,
        severity: 'low',
        findings: ['78% unit test coverage', 'Integration tests added', '2 e2e flows tested'],
        recommendations: ['Increase coverage to 85%'],
        details: {}
      },
      {
        gateId: 'contract-validation',
        gateName: 'Contract Validation',
        passed: true,
        status: 'passed',
        score: 92,
        severity: 'info',
        findings: ['API contracts stable', 'Backwards compatible'],
        recommendations: [],
        details: {}
      },
      {
        gateId: 'documentation',
        gateName: 'Documentation',
        passed: false,
        status: 'warning',
        score: 73,
        severity: 'medium',
        findings: ['README updated', 'API docs missing new endpoints'],
        recommendations: ['Document new auth endpoint', 'Add example payloads'],
        details: {}
      },
      {
        gateId: 'risk-assessment',
        gateName: 'Risk Assessment',
        passed: true,
        status: 'passed',
        score: 79,
        severity: 'low',
        findings: ['Low to medium risk changes', 'No critical path modifications'],
        recommendations: ['Monitor error rates post-deployment'],
        details: {}
      },
      {
        gateId: 'reviewer-approval',
        gateName: 'Reviewer Approval',
        passed: true,
        status: 'passed',
        score: 90,
        severity: 'info',
        findings: ['Approved by backend team', 'Approved by frontend team'],
        recommendations: [],
        details: {}
      }
    ];

    const assessment = assessQualityGates('task-real-world', realWorldGates);
    const report = generateQualityReport(assessment);

    // Verify assessment
    expect(assessment.overallStatus).toBe('warning');
    expect(assessment.gatesPassedCount).toBe(5);
    expect(assessment.gatesWarningCount).toBe(1);
    expect(assessment.overallScore).toBeGreaterThan(82);

    // Verify merge readiness
    expect(canProceedWithMerge(assessment)).toBe(true); // Warnings allow merge

    // Verify report content
    expect(report).toContain('Quality Gate Assessment Report');
    expect(report).toMatch(/Overall Status:.*WARNING/i);
    expect(report).toContain('Request Satisfaction');
    expect(report.length).toBeGreaterThan(500);
  });
});
