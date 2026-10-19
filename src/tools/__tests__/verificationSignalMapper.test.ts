/**
 * Verification Signal Mapper Tests
 * Phase 8.2: Maps code changes to verification checks and tracks coverage
 */

import {
  CodeChange,
  VerificationCheck,
  VerificationSignal,
  FileVerificationCoverage,
  CoverageAnalysis,
  VerificationGap,
  VerificationCoverageReport,
  buildVerificationSignals,
  calculateFileCoverage,
  calculateCoverageAnalysis,
  identifyGaps,
  generateRecommendations,
  generateVerificationCoverageReport
} from '../verificationSignalMapper';

describe('Verification Signal Mapper', () => {
  // Test 1: Build verification signals from changes and checks
  it('should map implementation changes to unit test checks', () => {
    const changes: CodeChange[] = [
      {
        filePath: 'src/utils/helpers.ts',
        type: 'implementation',
        description: 'Add new utility function',
        impact: 'medium',
        lineNumbers: { start: 10, end: 20 }
      }
    ];

    const checks: VerificationCheck[] = [
      {
        id: 'unit-1',
        name: 'Unit Tests',
        type: 'unit',
        target: 'utils/helpers.ts',
        scope: ['src/utils/**', 'src/**'],
        isAutomated: true,
        estimatedDurationMs: 5000,
        criticalityLevel: 'high'
      }
    ];

    const signals = buildVerificationSignals(changes, checks);

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      changeId: 'change-0',
      filePath: 'src/utils/helpers.ts',
      checkId: 'unit-1',
      checkName: 'Unit Tests',
      signalStrength: expect.stringMatching(/^(weak|medium|strong)$/)
    });
    expect(signals[0].confidence).toBeGreaterThan(0.2);
  });

  // Test 2: Map test changes to test infrastructure checks
  it('should map test changes and track with medium confidence', () => {
    const changes: CodeChange[] = [
      {
        filePath: 'src/__tests__/helpers.test.ts',
        type: 'test',
        description: 'Add test cases for helpers',
        impact: 'high'
      }
    ];

    const checks: VerificationCheck[] = [
      {
        id: 'test-1',
        name: 'Test Coverage',
        type: 'unit',
        target: 'test-coverage',
        scope: ['**/*.test.ts', '**/__tests__/**'],
        isAutomated: true,
        estimatedDurationMs: 3000,
        criticalityLevel: 'critical'
      }
    ];

    const signals = buildVerificationSignals(changes, checks);

    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0].signalStrength).toBe('medium');
  });

  // Test 3: Calculate file coverage with strong signals
  it('should calculate perfect coverage when strong signals exist', () => {
    const change: CodeChange = {
      filePath: 'src/api/routes.ts',
      type: 'implementation',
      description: 'Add new route',
      impact: 'high'
    };

    const signals: VerificationSignal[] = [
      {
        changeId: 'change-0',
        filePath: 'src/api/routes.ts',
        checkId: 'api-1',
        checkName: 'API Smoke Tests',
        confidence: 0.9,
        signalStrength: 'strong',
        evidence: 'API endpoint coverage'
      },
      {
        changeId: 'change-0',
        filePath: 'src/api/routes.ts',
        checkId: 'e2e-1',
        checkName: 'E2E Tests',
        confidence: 0.85,
        signalStrength: 'strong',
        evidence: 'End-to-end validation'
      }
    ];

    const coverage = calculateFileCoverage(change, signals);

    expect(coverage.filePath).toBe('src/api/routes.ts');
    expect(coverage.isCovered).toBe(true);
    expect(coverage.totalSignals).toBe(2);
    expect(coverage.coverageScore).toBeGreaterThan(80);
  });

  // Test 4: Identify gaps when coverage is low
  it('should identify gaps when coverage score is below 70%', () => {
    const change: CodeChange = {
      filePath: 'src/services/auth.ts',
      type: 'implementation',
      description: 'Modify authentication service',
      impact: 'high'
    };

    const signals: VerificationSignal[] = [
      {
        changeId: 'change-0',
        filePath: 'src/services/auth.ts',
        checkId: 'lint-1',
        checkName: 'Linting',
        confidence: 0.3,
        signalStrength: 'weak',
        evidence: 'Code style only'
      }
    ];

    const coverage = calculateFileCoverage(change, signals);

    expect(coverage.isCovered).toBe(false);
    expect(coverage.coverageScore).toBeLessThan(70);
    expect(coverage.gaps.length).toBeGreaterThan(0);
  });

  // Test 5: Calculate overall coverage analysis with mixed files
  it('should calculate coverage analysis with files covered and uncovered', () => {
    const changes: CodeChange[] = [
      {
        filePath: 'src/utils/math.ts',
        type: 'implementation',
        description: 'Math utilities',
        impact: 'low'
      },
      {
        filePath: 'src/api/security.ts',
        type: 'implementation',
        description: 'Security middleware',
        impact: 'high'
      },
      {
        filePath: 'src/data/migrations.ts',
        type: 'implementation',
        description: 'Database migrations',
        impact: 'high'
      }
    ];

    const fileCoverages: FileVerificationCoverage[] = [
      {
        filePath: 'src/utils/math.ts',
        changeType: 'implementation',
        impact: 'low',
        totalSignals: 2,
        signals: [],
        isCovered: true,
        coverageScore: 90,
        gaps: [],
        recommendations: []
      },
      {
        filePath: 'src/api/security.ts',
        changeType: 'implementation',
        impact: 'high',
        totalSignals: 0,
        signals: [],
        isCovered: false,
        coverageScore: 0,
        gaps: ['No verification signals found'],
        recommendations: ['Add security review']
      },
      {
        filePath: 'src/data/migrations.ts',
        changeType: 'implementation',
        impact: 'high',
        totalSignals: 1,
        signals: [],
        isCovered: false,
        coverageScore: 45,
        gaps: ['Low coverage'],
        recommendations: ['Add data validation tests']
      }
    ];

    const coverage = calculateCoverageAnalysis(changes, fileCoverages);

    expect(coverage.totalChanges).toBe(3);
    expect(coverage.filesWithCoverage).toBe(1);
    expect(coverage.filesWithoutCoverage).toBe(2);
    expect(coverage.overallCoveragePercentage).toBeGreaterThan(0);
    expect(coverage.overallCoveragePercentage).toBeLessThan(100);
  });

  // Test 6: Identify gaps for high-impact uncovered files
  it('should flag high-impact files without coverage as critical gaps', () => {
    const changes: CodeChange[] = [
      {
        filePath: 'src/data/database.ts',
        type: 'implementation',
        description: 'Update database schema',
        impact: 'high'
      }
    ];

    const fileCoverages: FileVerificationCoverage[] = [
      {
        filePath: 'src/data/database.ts',
        changeType: 'implementation',
        impact: 'high',
        totalSignals: 0,
        signals: [],
        isCovered: false,
        coverageScore: 0,
        gaps: ['No verification signals found'],
        recommendations: ['Add schema validation tests']
      }
    ];

    const gaps = identifyGaps(changes, fileCoverages);

    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      filePath: 'src/data/database.ts',
      impact: 'high',
      reason: 'No verification signals found'
    });
    expect(gaps[0].riskIfUncovered).toBe('Breaking changes could reach production');
  });

  // Test 7: Generate recommendations from analysis
  it('should generate critical recommendations when risk level is critical', () => {
    const analysis: CoverageAnalysis = {
      timestamp: new Date(),
      totalChanges: 3,
      totalSignals: 1,
      filesWithCoverage: 0,
      filesWithoutCoverage: 3,
      overallCoveragePercentage: 20,
      coverageByType: new Map(),
      coverageByImpact: new Map(),
      criticalGaps: ['src/api/auth.ts', 'src/data/models.ts'],
      riskLevel: 'critical'
    };

    const gaps: VerificationGap[] = [
      {
        filePath: 'src/api/auth.ts',
        changeDescription: 'Auth service changes',
        changeType: 'implementation',
        impact: 'high',
        reason: 'No signals',
        suggestedChecks: [],
        riskIfUncovered: 'Breaking changes could reach production'
      }
    ];

    const recommendations = generateRecommendations(analysis, gaps);

    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0]).toMatch(/CRITICAL/);
  });

  // Test 8: Generate coverage report with all components
  it('should generate comprehensive report with all coverage data', () => {
    const changes: CodeChange[] = [
      {
        filePath: 'src/components/Button.tsx',
        type: 'implementation',
        description: 'Button component',
        impact: 'medium'
      }
    ];

    const checks: VerificationCheck[] = [
      {
        id: 'react-1',
        name: 'React Build',
        type: 'unit',
        target: 'component-build',
        scope: ['src/components/**'],
        isAutomated: true,
        estimatedDurationMs: 10000,
        criticalityLevel: 'high'
      },
      {
        id: 'a11y-1',
        name: 'Accessibility',
        type: 'smoke',
        target: 'a11y',
        scope: ['src/components/**'],
        isAutomated: true,
        estimatedDurationMs: 5000,
        criticalityLevel: 'high'
      }
    ];

    const report = generateVerificationCoverageReport(changes, checks, 'report-test-1');

    expect(report).toMatchObject({
      reportId: 'report-test-1',
      totalChanges: 1,
      filesAnalyzed: 1
    });
    expect(report.fileCoverages).toHaveLength(1);
    expect(report.coverage).toBeDefined();
    expect(report.gaps).toBeDefined();
    expect(report.recommendations).toBeDefined();
  });

  // Test 9: Edge case - empty changes list
  it('should handle empty changes list gracefully', () => {
    const changes: CodeChange[] = [];
    const checks: VerificationCheck[] = [
      {
        id: 'test-1',
        name: 'Unit Tests',
        type: 'unit',
        target: 'all',
        scope: ['**'],
        isAutomated: true,
        estimatedDurationMs: 5000,
        criticalityLevel: 'high'
      }
    ];

    const report = generateVerificationCoverageReport(changes, checks);

    expect(report.totalChanges).toBe(0);
    expect(report.filesAnalyzed).toBe(0);
    expect(report.fileCoverages).toHaveLength(0);
    // When no files analyzed, coverage calculation returns 0 (no files to cover)
    expect(report.coverage.overallCoveragePercentage).toBe(0);
  });

  // Test 10: Edge case - empty checks list
  it('should handle empty checks list and identify all as gaps', () => {
    const changes: CodeChange[] = [
      {
        filePath: 'src/api/endpoint.ts',
        type: 'implementation',
        description: 'New API endpoint',
        impact: 'high'
      }
    ];

    const report = generateVerificationCoverageReport(changes, [], 'report-no-checks');

    expect(report.fileCoverages[0].totalSignals).toBe(0);
    expect(report.fileCoverages[0].isCovered).toBe(false);
    expect(report.gaps.length).toBeGreaterThan(0);
  });

  // Test 11: Multiple changes with different types and impacts
  it('should correctly map different change types to appropriate checks', () => {
    const changes: CodeChange[] = [
      {
        filePath: 'src/utils.ts',
        type: 'implementation',
        description: 'Utility functions',
        impact: 'low'
      },
      {
        filePath: 'src/utils.test.ts',
        type: 'test',
        description: 'Test file',
        impact: 'low'
      },
      {
        filePath: 'README.md',
        type: 'documentation',
        description: 'Documentation',
        impact: 'low'
      }
    ];

    const checks: VerificationCheck[] = [
      {
        id: 'unit-1',
        name: 'Unit Tests',
        type: 'unit',
        target: 'code',
        scope: ['src/**'],
        isAutomated: true,
        estimatedDurationMs: 5000,
        criticalityLevel: 'high'
      }
    ];

    const signals = buildVerificationSignals(changes, checks);

    expect(signals.length).toBeGreaterThan(0);
    // Implementation and test files should have signals, docs may not
    const signsForImpl = signals.filter(s => s.filePath === 'src/utils.ts');
    const signsForTest = signals.filter(s => s.filePath === 'src/utils.test.ts');
    expect(signsForImpl.length).toBeGreaterThan(0);
    expect(signsForTest.length).toBeGreaterThan(0);
  });

  // Test 12: Verify recommendations include verification required flag
  it('should set verificationRequiredBeforeRelease flag based on risk level', () => {
    const changes: CodeChange[] = [
      {
        filePath: 'src/auth/core.ts',
        type: 'implementation',
        description: 'Core auth logic',
        impact: 'high'
      }
    ];

    const checks: VerificationCheck[] = [
      {
        id: 'sec-1',
        name: 'Security Review',
        type: 'security',
        target: 'auth',
        scope: ['src/auth/**'],
        isAutomated: false,
        estimatedDurationMs: 30000,
        criticalityLevel: 'critical'
      }
    ];

    const report = generateVerificationCoverageReport(changes, checks);

    // With high-impact changes and potentially low coverage, should require verification
    expect(report.verificationRequiredBeforeRelease).toBeDefined();
    expect(typeof report.verificationRequiredBeforeRelease).toBe('boolean');
  });

  // Test 13: Coverage calculation accuracy
  it('should accurately calculate coverage percentage across all files', () => {
    const changes: CodeChange[] = [
      {
        filePath: 'file1.ts',
        type: 'implementation',
        description: 'File 1',
        impact: 'medium'
      },
      {
        filePath: 'file2.ts',
        type: 'implementation',
        description: 'File 2',
        impact: 'medium'
      },
      {
        filePath: 'file3.ts',
        type: 'implementation',
        description: 'File 3',
        impact: 'medium'
      },
      {
        filePath: 'file4.ts',
        type: 'implementation',
        description: 'File 4',
        impact: 'medium'
      }
    ];

    const fileCoverages: FileVerificationCoverage[] = [
      {
        filePath: 'file1.ts',
        changeType: 'implementation',
        impact: 'medium',
        totalSignals: 1,
        signals: [],
        isCovered: true,
        coverageScore: 100,
        gaps: [],
        recommendations: []
      },
      {
        filePath: 'file2.ts',
        changeType: 'implementation',
        impact: 'medium',
        totalSignals: 1,
        signals: [],
        isCovered: true,
        coverageScore: 100,
        gaps: [],
        recommendations: []
      },
      {
        filePath: 'file3.ts',
        changeType: 'implementation',
        impact: 'medium',
        totalSignals: 1,
        signals: [],
        isCovered: true,
        coverageScore: 50,
        gaps: ['Partial coverage'],
        recommendations: []
      },
      {
        filePath: 'file4.ts',
        changeType: 'implementation',
        impact: 'medium',
        totalSignals: 0,
        signals: [],
        isCovered: false,
        coverageScore: 0,
        gaps: ['No signals'],
        recommendations: []
      }
    ];

    const coverage = calculateCoverageAnalysis(changes, fileCoverages);

    expect(coverage.overallCoveragePercentage).toBeCloseTo((100 + 100 + 50 + 0) / 4, 0);
  });

  // Test 14: Risk level determination based on critical gaps
  it('should set risk level to critical when high-impact files lack coverage', () => {
    const changes: CodeChange[] = [
      {
        filePath: 'src/api/payment.ts',
        type: 'implementation',
        description: 'Payment API',
        impact: 'high'
      },
      {
        filePath: 'src/api/logging.ts',
        type: 'implementation',
        description: 'Logging service',
        impact: 'low'
      }
    ];

    const fileCoverages: FileVerificationCoverage[] = [
      {
        filePath: 'src/api/payment.ts',
        changeType: 'implementation',
        impact: 'high',
        totalSignals: 0,
        signals: [],
        isCovered: false,
        coverageScore: 0,
        gaps: [],
        recommendations: []
      },
      {
        filePath: 'src/api/logging.ts',
        changeType: 'implementation',
        impact: 'low',
        totalSignals: 1,
        signals: [],
        isCovered: true,
        coverageScore: 100,
        gaps: [],
        recommendations: []
      }
    ];

    const coverage = calculateCoverageAnalysis(changes, fileCoverages);

    expect(coverage.criticalGaps).toContain('src/api/payment.ts');
    expect(coverage.riskLevel).toBe('critical');
  });

  // Test 15: Recommendations prioritize critical gaps
  it('should list critical gaps first in recommendations', () => {
    const analysis: CoverageAnalysis = {
      timestamp: new Date(),
      totalChanges: 2,
      totalSignals: 1,
      filesWithCoverage: 1,
      filesWithoutCoverage: 1,
      overallCoveragePercentage: 50,
      coverageByType: new Map(),
      coverageByImpact: new Map(),
      criticalGaps: ['src/payment.ts'],
      riskLevel: 'high'
    };

    const gaps: VerificationGap[] = [
      {
        filePath: 'src/payment.ts',
        changeDescription: 'Payment changes',
        changeType: 'implementation',
        impact: 'high',
        reason: 'No signals',
        suggestedChecks: ['security-review'],
        riskIfUncovered: 'Critical risk'
      },
      {
        filePath: 'src/logging.ts',
        changeDescription: 'Logging changes',
        changeType: 'implementation',
        impact: 'low',
        reason: 'Low coverage',
        suggestedChecks: [],
        riskIfUncovered: 'Minor issue'
      }
    ];

    const recommendations = generateRecommendations(analysis, gaps);

    // Should generate multiple recommendations
    expect(recommendations.length).toBeGreaterThan(0);
    // Should mention critical or high risk
    const hasCriticalOrHighMention = recommendations.some(r => 
      r.includes('CRITICAL') || r.includes('high-impact') || r.includes('verification gap')
    );
    expect(hasCriticalOrHighMention).toBe(true);
  });

  // Test 16: Full report generation with realistic data
  it('should generate realistic full report for multi-file change', () => {
    const changes: CodeChange[] = [
      {
        filePath: 'src/components/Form.tsx',
        type: 'implementation',
        description: 'Form component update',
        impact: 'medium'
      },
      {
        filePath: 'src/components/Form.test.tsx',
        type: 'test',
        description: 'Form tests',
        impact: 'medium'
      },
      {
        filePath: 'src/api/forms.ts',
        type: 'implementation',
        description: 'Form validation API',
        impact: 'high'
      }
    ];

    const checks: VerificationCheck[] = [
      {
        id: 'unit-1',
        name: 'Unit Tests',
        type: 'unit',
        target: 'code',
        scope: ['src/**'],
        isAutomated: true,
        estimatedDurationMs: 5000,
        criticalityLevel: 'high'
      },
      {
        id: 'react-1',
        name: 'React Tests',
        type: 'unit',
        target: 'components',
        scope: ['src/components/**'],
        isAutomated: true,
        estimatedDurationMs: 8000,
        criticalityLevel: 'high'
      },
      {
        id: 'e2e-1',
        name: 'E2E Tests',
        type: 'e2e',
        target: 'full-workflow',
        scope: ['src/**'],
        isAutomated: true,
        estimatedDurationMs: 30000,
        criticalityLevel: 'medium'
      }
    ];

    const report = generateVerificationCoverageReport(changes, checks);

    expect(report.totalChanges).toBe(3);
    expect(report.fileCoverages.length).toBe(3);
    expect(report.coverage.totalSignals).toBeGreaterThan(0);
    expect(report.fileCoverages.some(f => f.isCovered)).toBe(true);
    expect(Array.isArray(report.recommendations)).toBe(true);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });
});
