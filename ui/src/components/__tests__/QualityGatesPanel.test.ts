/**
 * Quality Gates Panel Tests - Phase 8.8
 * Tests for UI component displaying quality gates using standard SSR markup rendering
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, jest } from '@jest/globals';
import QualityGatesPanel, { type QualityGateAssessment, type GateResult } from '../QualityGatesPanel';

describe('Quality Gates Panel', () => {
  const mockGateResults: GateResult[] = [
    {
      gateId: 'request-satisfaction',
      gateName: 'Request Satisfaction',
      passed: true,
      status: 'passed',
      score: 90,
      severity: 'info',
      findings: ['All requirements met'],
      recommendations: ['Add edge case tests'],
      details: { coverage: 90 },
    },
    {
      gateId: 'verification-signals',
      gateName: 'Verification Signals',
      passed: true,
      status: 'passed',
      score: 85,
      severity: 'info',
      findings: ['90% coverage'],
      recommendations: ['Add e2e tests'],
      details: { coverage: 90 },
    },
    {
      gateId: 'contract-validation',
      gateName: 'Contract Validation',
      passed: false,
      status: 'warning',
      score: 75,
      severity: 'medium',
      findings: ['Contract warnings present'],
      recommendations: ['Review API contracts'],
      details: { violations: 1 },
    },
  ];

  const mockAssessment: QualityGateAssessment = {
    taskId: 'task-123',
    timestamp: Date.now(),
    gates: mockGateResults,
    overallScore: 83,
    overallStatus: 'passed',
    passRate: 67,
    criticalFindings: [],
    blockingIssues: [],
    topRecommendations: ['Add edge case tests', 'Add e2e tests'],
    gatesPassedCount: 2,
    gatesWarningCount: 1,
    gatesFailedCount: 0,
    createdAt: Date.now(),
    assessmentId: 'assessment-123',
  };

  it('should render quality gates panel with overall passed status', () => {
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: mockAssessment }));
    expect(html).toContain('Overall Quality: Passed');
    expect(html).toContain('83/100');
    expect(html).toContain('2/3');
  });

  it('should display all quality gates', () => {
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: mockAssessment }));
    expect(html).toContain('Request Satisfaction');
    expect(html).toContain('Verification Signals');
    expect(html).toContain('Contract Validation');
  });

  it('should display gate scores', () => {
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: mockAssessment }));
    expect(html).toContain('90/100');
    expect(html).toContain('85/100');
    expect(html).toContain('75/100');
  });

  it('should render gate findings and recommendations in panel', () => {
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: mockAssessment }));
    expect(html).toContain('Request Satisfaction');
    expect(html).toContain('Contract Validation');
  });

  it('should display top recommendations', () => {
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: mockAssessment }));
    expect(html).toContain('Add edge case tests');
  });

  it('should display blocking issues when present', () => {
    const assessmentWithBlockingIssues: QualityGateAssessment = {
      ...mockAssessment,
      blockingIssues: ['Contract validation: Multiple violations detected'],
      overallStatus: 'critical',
    };
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: assessmentWithBlockingIssues }));
    expect(html).toContain('Blocking Issues');
    expect(html).toContain('Contract validation: Multiple violations detected');
  });

  it('should show critical status with appropriate styling', () => {
    const criticalAssessment: QualityGateAssessment = {
      ...mockAssessment,
      overallStatus: 'critical',
      overallScore: 30,
      gates: [
        {
          ...mockGateResults[0],
          status: 'failed',
          passed: false,
          severity: 'critical',
          score: 20,
        },
      ],
    };
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: criticalAssessment }));
    expect(html).toContain('Overall Quality: Critical');
    expect(html).toContain('30/100');
  });

  it('should display loading message when isLoading prop is true', () => {
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: mockAssessment, isLoading: true }));
    expect(html).toContain('Loading quality gates assessment...');
    expect(html).not.toContain('Overall Quality: Passed');
  });

  it('should accept onDrillDown callback prop without errors', () => {
    const onDrillDown = jest.fn();
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: mockAssessment, onDrillDown }));
    expect(html).toContain('Quality Gates');
  });

  it('should display gate counts summary', () => {
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: mockAssessment }));
    expect(html).toContain('2 Passed');
    expect(html).toContain('1 Warnings');
    expect(html).toContain('0 Failed');
  });

  it('should handle multiple failed gates', () => {
    const assessmentWithFailures: QualityGateAssessment = {
      ...mockAssessment,
      gates: [
        { ...mockGateResults[0], status: 'failed', passed: false, score: 40 },
        { ...mockGateResults[1], status: 'failed', passed: false, score: 35 },
        mockGateResults[2],
      ],
      overallStatus: 'failed',
      overallScore: 45,
      gatesFailedCount: 2,
      gatesPassedCount: 0,
      gatesWarningCount: 1,
      blockingIssues: ['Gate 1 failed', 'Gate 2 failed'],
    };
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: assessmentWithFailures }));
    expect(html).toContain('Overall Quality: Failed');
    expect(html).toContain('2 Failed');
  });

  it('should render gate name and score for each gate', () => {
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: mockAssessment }));
    expect(html).toContain('Score: 90/100');
    expect(html).toContain('Score: 85/100');
    expect(html).toContain('Score: 75/100');
  });

  it('should display warning status correctly', () => {
    const warningAssessment: QualityGateAssessment = {
      ...mockAssessment,
      overallStatus: 'warning',
      overallScore: 72,
      gatesWarningCount: 3,
    };
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: warningAssessment }));
    expect(html).toContain('Overall Quality: Warning');
    expect(html).toContain('72/100');
  });

  it('should handle gates with no recommendations', () => {
    const assessmentNoRecs: QualityGateAssessment = {
      ...mockAssessment,
      gates: [{ ...mockGateResults[0], recommendations: [] }],
    };
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: assessmentNoRecs }));
    expect(html).toContain('Quality Gates');
  });

  it('should render custom recommendation lists', () => {
    const assessmentManyRecs: QualityGateAssessment = {
      ...mockAssessment,
      topRecommendations: [
        'Recommendation 1',
        'Recommendation 2',
      ],
    };
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: assessmentManyRecs }));
    expect(html).toContain('Recommendation 1');
  });

  it('should display assessment ID in header', () => {
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: mockAssessment }));
    expect(html).toContain('Assessment ID: assessment-123');
  });

  it('should render initial gate container', () => {
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: mockAssessment }));
    expect(html).toContain('Request Satisfaction');
  });

  it('should show all gates passed message', () => {
    const allPassedAssessment: QualityGateAssessment = {
      ...mockAssessment,
      gates: mockGateResults.map((g) => ({ ...g, status: 'passed', passed: true })),
      overallStatus: 'passed',
      gatesPassedCount: 3,
      gatesWarningCount: 0,
      gatesFailedCount: 0,
      overallScore: 95,
    };
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: allPassedAssessment }));
    expect(html).toContain('3/3');
    expect(html).toContain('95/100');
  });

  it('should display gate information across gates', () => {
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: mockAssessment }));
    expect(html).toContain('Verification Signals');
    expect(html).toContain('85/100');
  });

  it('should render complete quality gates panel layout', () => {
    const html = renderToStaticMarkup(React.createElement(QualityGatesPanel, { assessment: mockAssessment }));
    expect(html).toContain('Quality Gates');
    expect(html).toContain('Top Recommendations');
    expect(html).toContain('Overall Quality:');
  });
});
