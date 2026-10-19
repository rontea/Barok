/**
 * Quality Gate Orchestrator - Phase 8.7
 * Combines all quality gates (8.1-8.6) into unified quality assessment
 */

import type { ComplianceReport as RequestSatisfactionResult } from './requestSatisfactionValidator.js';
import type { VerificationCoverageReport as VerificationSignalAnalysis } from './verificationSignalMapper.js';
import type { ContractValidationResult } from './contractValidator.js';
import type { DocumentationValidationReport as DocumentationValidationResult } from './documentationValidator.js';
import type { RiskAssessmentResult } from './riskAssessmentEngine.js';
import type { ReviewWorkflow } from './reviewerAssignment.js';

/**
 * Individual gate result from any of the 6 gates
 */
export interface GateResult {
  gateId: string;
  gateName: string;
  passed: boolean;
  status: 'passed' | 'failed' | 'warning';
  score: number; // 0-100
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  findings: string[];
  recommendations: string[];
  details: Record<string, unknown>;
}

/**
 * Overall quality gate assessment combining all gates
 */
export interface QualityGateAssessment {
  taskId: string;
  timestamp: number;
  
  // Individual gate results
  gates: GateResult[];
  
  // Overall metrics
  overallScore: number; // 0-100, weighted average
  overallStatus: 'passed' | 'failed' | 'warning' | 'critical'; // Fail if any critical
  passRate: number; // percentage of gates passed
  
  // Critical findings
  criticalFindings: string[];
  blockingIssues: string[];
  
  // Aggregated recommendations
  topRecommendations: string[]; // Prioritized by severity
  
  // Summary statistics
  gatesPassedCount: number;
  gatesWarningCount: number;
  gatesFailedCount: number;
  
  // History tracking
  createdAt: number;
  assessmentId: string;
}

/**
 * Quality gate history for benchmarking and tracking
 */
export interface QualityGateHistory {
  assessmentId: string;
  taskId: string;
  timestamp: number;
  overallScore: number;
  status: string;
  gateResults: Array<{ gateName: string; score: number; status: string }>;
}

/**
 * Quality gate configuration for thresholds and weighting
 */
export interface QualityGateConfig {
  gates: {
    [key: string]: {
      weight: number; // 0-1, how much this gate affects overall score
      criticalThreshold: number; // Score below this = critical
      failThreshold: number; // Score below this = failed
      warningThreshold: number; // Score below this = warning
    };
  };
  overallCriticalThreshold: number; // Overall score for critical status
  overallFailThreshold: number; // Overall score for failed status
  overallWarningThreshold: number; // Overall score for warning status
}

// Default configuration for quality gates
const DEFAULT_GATE_CONFIG: QualityGateConfig = {
  gates: {
    'request-satisfaction': {
      weight: 0.15,
      criticalThreshold: 60,
      failThreshold: 70,
      warningThreshold: 85
    },
    'verification-signals': {
      weight: 0.15,
      criticalThreshold: 60,
      failThreshold: 70,
      warningThreshold: 85
    },
    'contract-validation': {
      weight: 0.20,
      criticalThreshold: 70,
      failThreshold: 75,
      warningThreshold: 90
    },
    'documentation': {
      weight: 0.15,
      criticalThreshold: 50,
      failThreshold: 65,
      warningThreshold: 80
    },
    'risk-assessment': {
      weight: 0.20,
      criticalThreshold: 40,
      failThreshold: 55,
      warningThreshold: 75
    },
    'reviewer-approval': {
      weight: 0.15,
      criticalThreshold: 0, // Rejection = critical
      failThreshold: 50, // Pending too long = failed
      warningThreshold: 75 // Conditional = warning
    }
  },
  overallCriticalThreshold: 55,
  overallFailThreshold: 65,
  overallWarningThreshold: 80
};

/**
 * Create a quality gate result from any gate type
 */
export function createGateResult(
  gateId: string,
  gateName: string,
  gateData: RequestSatisfactionResult | VerificationSignalAnalysis | ContractValidationResult | DocumentationValidationResult | RiskAssessmentResult | ReviewWorkflow | any,
  gateType: string
): GateResult {
  let score = 0;
  let passed = false;
  let status: 'passed' | 'failed' | 'warning' = 'failed';
  let severity: 'critical' | 'high' | 'medium' | 'low' | 'info' = 'high';
  const findings: string[] = [];
  const recommendations: string[] = [];
  const details: Record<string, unknown> = {};

  // Extract data based on gate type
  if (gateType === 'request-satisfaction' && gateData.satisfactionScore !== undefined) {
    score = gateData.satisfactionScore;
    passed = gateData.status === 'satisfied';
    findings.push(gateData.status === 'satisfied' ? 'All requirements satisfied' : 'Some requirements not addressed');
    if (gateData.gaps && gateData.gaps.length > 0) {
      findings.push(`${gateData.gaps.length} gaps identified`);
      recommendations.push(...gateData.gaps.map((g: any) => g.suggestion || 'Address gap'));
    }
    details.status = gateData.status;
    details.coveragePercentage = gateData.coverage?.percentage || 0;
  } else if (gateType === 'verification-signals' && gateData.coverage !== undefined) {
    score = gateData.coverage?.percentage || 0;
    passed = gateData.riskLevel !== 'critical';
    findings.push(`Verification coverage: ${score}%`);
    if (gateData.gaps && gateData.gaps.length > 0) {
      findings.push(`${gateData.gaps.length} uncovered files`);
      recommendations.push(...gateData.gaps.map((g: any) => g.suggestion || 'Add verification'));
    }
    details.riskLevel = gateData.riskLevel;
    details.releaseRequired = gateData.releaseRequired;
  } else if (gateType === 'contract-validation' && gateData.compatibilityScore !== undefined) {
    score = gateData.compatibilityScore;
    passed = gateData.violations && gateData.violations.length === 0;
    findings.push(`Contract compatibility: ${score}%`);
    if (gateData.violations && gateData.violations.length > 0) {
      findings.push(`${gateData.violations.length} contract violations`);
      recommendations.push(...gateData.violations.map((v: any) => v.suggestion || 'Fix contract'));
    }
    details.violations = gateData.violations?.length || 0;
  } else if (gateType === 'documentation' && gateData.completionPercentage !== undefined) {
    score = gateData.completionPercentage;
    passed = gateData.hasCriticalGaps !== true;
    findings.push(`Documentation completeness: ${score}%`);
    if (gateData.gaps && gateData.gaps.length > 0) {
      findings.push(`${gateData.gaps.length} documentation gaps`);
      recommendations.push(...gateData.gaps.map((g: any) => g.recommendation || 'Update docs'));
    }
    details.hasBreakingChanges = gateData.hasBreakingChanges;
    details.gaps = gateData.gaps?.length || 0;
  } else if (gateType === 'risk-assessment' && gateData.overallRiskScore !== undefined) {
    score = Math.max(0, 100 - gateData.overallRiskScore);
    passed = gateData.overallRiskLevel === 'low' || gateData.overallRiskLevel === 'medium';
    findings.push(`Risk score: ${gateData.overallRiskScore}%`);
    if (gateData.criticalFiles && gateData.criticalFiles.length > 0) {
      findings.push(`${gateData.criticalFiles.length} critical risk files`);
      recommendations.push(...gateData.criticalFiles.map((f: any) => f.file || 'Review critical file'));
    }
    details.riskLevel = gateData.overallRiskLevel;
    details.criticalFiles = gateData.criticalFiles?.length || 0;
  } else if (gateType === 'reviewer-approval' && gateData.feedback !== undefined) {
    const approved = gateData.feedback?.some((f: any) => f.status === 'approved');
    const rejected = gateData.feedback?.some((f: any) => f.status === 'rejected');
    const conditional = gateData.feedback?.some((f: any) => f.status === 'approved-with-conditions');
    
    if (rejected) {
      score = 0;
      passed = false;
      severity = 'critical';
      findings.push('Reviewer(s) rejected the changes');
      recommendations.push('Address reviewer concerns and resubmit');
    } else if (conditional) {
      score = 50;
      passed = false;
      status = 'warning';
      severity = 'high';
      findings.push('Changes approved with conditions');
      if (gateData.feedback) {
        recommendations.push(...gateData.feedback
          .filter((f: any) => f.conditions && f.conditions.length > 0)
          .flatMap((f: any) => f.conditions));
      }
    } else if (approved) {
      score = 100;
      passed = true;
      status = 'passed';
      severity = 'info';
      findings.push('All reviewers approved');
    } else {
      score = 30;
      passed = false;
      findings.push('Review workflow pending');
    }
    details.feedback = gateData.feedback?.length || 0;
    details.decision = gateData.decision?.overallStatus || 'pending';
  } else {
    score = 50;
    findings.push('Unable to determine score');
  }

  // Determine status based on score and thresholds
  if (!passed) {
    if (score < 60) {
      status = 'failed';
    } else if (score < 80) {
      status = 'warning';
    } else {
      status = 'passed';
      passed = true;
    }
  } else {
    status = 'passed';
  }

  // Set severity based on score and status
  if (status === 'failed') {
    severity = score < 40 ? 'critical' : 'high';
  } else if (status === 'warning') {
    severity = 'medium';
  } else {
    severity = 'info';
  }

  return {
    gateId,
    gateName,
    passed,
    status,
    score: Math.round(score),
    severity,
    findings,
    recommendations,
    details
  };
}

/**
 * Assess quality gates based on individual gate results
 */
export function assessQualityGates(
  taskId: string,
  gateResults: GateResult[],
  config: QualityGateConfig = DEFAULT_GATE_CONFIG
): QualityGateAssessment {
  const assessmentId = `assessment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Calculate metrics
  const gatesPassedCount = gateResults.filter(g => g.passed).length;
  const gatesWarningCount = gateResults.filter(g => !g.passed && g.status === 'warning').length;
  const gatesFailedCount = gateResults.filter(g => !g.passed && g.status === 'failed').length;
  const passRate = (gatesPassedCount / gateResults.length) * 100;

  // Calculate weighted overall score
  let overallScore = 0;
  let totalWeight = 0;
  
  for (const gate of gateResults) {
    const gateConfig = config.gates[gate.gateId];
    if (gateConfig) {
      overallScore += gate.score * gateConfig.weight;
      totalWeight += gateConfig.weight;
    }
  }
  
  overallScore = totalWeight > 0 ? Math.round(overallScore / totalWeight) : 0;

  // Determine overall status
  let overallStatus: 'passed' | 'failed' | 'warning' | 'critical' = 'passed';
  const criticalGates = gateResults.filter(g => g.severity === 'critical');
  const failedGates = gateResults.filter(g => g.status === 'failed');
  const warningGates = gateResults.filter(g => g.status === 'warning');

  if (criticalGates.length > 0 || overallScore < config.overallCriticalThreshold) {
    overallStatus = 'critical';
  } else if (failedGates.length > 0 || overallScore < config.overallFailThreshold) {
    overallStatus = 'failed';
  } else if (warningGates.length > 0 || overallScore < config.overallWarningThreshold) {
    overallStatus = 'warning';
  }

  // Collect findings and recommendations
  const criticalFindings = gateResults
    .filter(g => g.severity === 'critical')
    .flatMap(g => g.findings);
  
  const blockingIssues = gateResults
    .filter(g => g.status === 'failed' || g.severity === 'critical')
    .map(g => `${g.gateName}: ${g.findings[0] || 'Failed'}`);

  // Collect and prioritize recommendations
  const allRecommendations = gateResults
    .flatMap(g => g.recommendations.map(r => ({ text: r, severity: g.severity })))
    .sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    })
    .map(r => r.text);

  const topRecommendations = allRecommendations.slice(0, 5);

  return {
    taskId,
    timestamp: Date.now(),
    gates: gateResults,
    overallScore,
    overallStatus,
    passRate: Math.round(passRate),
    criticalFindings,
    blockingIssues,
    topRecommendations,
    gatesPassedCount,
    gatesWarningCount,
    gatesFailedCount,
    createdAt: Date.now(),
    assessmentId
  };
}

/**
 * Generate comprehensive quality report
 */
export function generateQualityReport(assessment: QualityGateAssessment): string {
  const lines: string[] = [];
  
  lines.push('# Quality Gate Assessment Report\n');
  lines.push(`**Assessment ID**: ${assessment.assessmentId}`);
  lines.push(`**Task ID**: ${assessment.taskId}`);
  lines.push(`**Timestamp**: ${new Date(assessment.timestamp).toISOString()}\n`);

  // Overall status
  const statusEmoji = {
    passed: '✅',
    warning: '⚠️',
    failed: '❌',
    critical: '🔴'
  };
  
  lines.push(`## Overall Status: ${statusEmoji[assessment.overallStatus]} ${assessment.overallStatus.toUpperCase()}`);
  lines.push(`**Overall Quality Score**: ${assessment.overallScore}/100`);
  lines.push(`**Pass Rate**: ${assessment.passRate}% (${assessment.gatesPassedCount}/${assessment.gates.length} gates)\n`);

  // Gate-by-gate results
  lines.push('## Quality Gates Results\n');
  lines.push('| Gate | Status | Score | Severity |');
  lines.push('|------|--------|-------|----------|');
  
  for (const gate of assessment.gates) {
    const statusIcon = gate.passed ? '✅' : gate.status === 'warning' ? '⚠️' : '❌';
    lines.push(`| ${gate.gateName} | ${statusIcon} ${gate.status} | ${gate.score}/100 | ${gate.severity} |`);
  }
  lines.push('');

  // Critical findings
  if (assessment.criticalFindings.length > 0) {
    lines.push('## Critical Findings\n');
    for (const finding of assessment.criticalFindings) {
      lines.push(`- 🔴 ${finding}`);
    }
    lines.push('');
  }

  // Blocking issues
  if (assessment.blockingIssues.length > 0) {
    lines.push('## Blocking Issues\n');
    for (const issue of assessment.blockingIssues) {
      lines.push(`- ❌ ${issue}`);
    }
    lines.push('');
  }

  // Recommendations
  if (assessment.topRecommendations.length > 0) {
    lines.push('## Top Recommendations\n');
    for (let i = 0; i < assessment.topRecommendations.length; i++) {
      lines.push(`${i + 1}. ${assessment.topRecommendations[i]}`);
    }
    lines.push('');
  }

  // Summary statistics
  lines.push('## Summary Statistics\n');
  lines.push(`- Gates Passed: ${assessment.gatesPassedCount}`);
  lines.push(`- Gates with Warnings: ${assessment.gatesWarningCount}`);
  lines.push(`- Gates Failed: ${assessment.gatesFailedCount}`);
  lines.push('');

  // Gate details
  lines.push('## Gate Details\n');
  for (const gate of assessment.gates) {
    lines.push(`### ${gate.gateName}\n`);
    lines.push(`**Score**: ${gate.score}/100 | **Status**: ${gate.status} | **Severity**: ${gate.severity}\n`);
    
    if (gate.findings.length > 0) {
      lines.push('**Findings**:');
      for (const finding of gate.findings) {
        lines.push(`- ${finding}`);
      }
      lines.push('');
    }
    
    if (gate.recommendations.length > 0) {
      lines.push('**Recommendations**:');
      for (const rec of gate.recommendations) {
        lines.push(`- ${rec}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Track quality gate assessment in history
 */
export function trackQualityGateHistory(assessment: QualityGateAssessment): QualityGateHistory {
  return {
    assessmentId: assessment.assessmentId,
    taskId: assessment.taskId,
    timestamp: assessment.timestamp,
    overallScore: assessment.overallScore,
    status: assessment.overallStatus,
    gateResults: assessment.gates.map(g => ({
      gateName: g.gateName,
      score: g.score,
      status: g.status
    }))
  };
}

/**
 * Determine if quality gates allow merge/deployment
 */
export function canProceedWithMerge(assessment: QualityGateAssessment): boolean {
  // Cannot proceed if critical status
  if (assessment.overallStatus === 'critical') {
    return false;
  }
  
  // Cannot proceed if any gate is failed
  if (assessment.gates.some(g => g.status === 'failed')) {
    return false;
  }
  
  // Can proceed with warning if approval workflow is in place
  if (assessment.overallStatus === 'warning') {
    return true; // Warnings don't block, but should require review
  }
  
  return true;
}

/**
 * Get detailed gate result by ID
 */
export function getGateResult(assessment: QualityGateAssessment, gateId: string): GateResult | undefined {
  return assessment.gates.find(g => g.gateId === gateId);
}

/**
 * Compare two assessments to show improvements/regressions
 */
export function compareAssessments(
  previous: QualityGateAssessment,
  current: QualityGateAssessment
): { scoreChange: number; statusChange: string; improvementAreas: string[]; regressionAreas: string[] } {
  const scoreChange = current.overallScore - previous.overallScore;
  const statusChange = `${previous.overallStatus} → ${current.overallStatus}`;
  
  const improvementAreas: string[] = [];
  const regressionAreas: string[] = [];

  for (const currentGate of current.gates) {
    const previousGate = previous.gates.find(g => g.gateId === currentGate.gateId);
    if (previousGate) {
      if (currentGate.score > previousGate.score) {
        improvementAreas.push(`${currentGate.gateName}: +${currentGate.score - previousGate.score} points`);
      } else if (currentGate.score < previousGate.score) {
        regressionAreas.push(`${currentGate.gateName}: -${previousGate.score - currentGate.score} points`);
      }
    }
  }

  return {
    scoreChange,
    statusChange,
    improvementAreas,
    regressionAreas
  };
}
