/**
 * Verification Signal Mapper
 * Phase 8.2: Maps code changes to verification checks and tracks coverage
 */

export interface CodeChange {
  filePath: string;
  type: 'implementation' | 'test' | 'documentation' | 'config';
  description: string;
  lineNumbers?: { start: number; end: number };
  impact: 'low' | 'medium' | 'high';
}

export interface VerificationCheck {
  id: string;
  name: string;
  type: 'unit' | 'integration' | 'e2e' | 'lint' | 'type' | 'smoke' | 'security' | 'accessibility' | 'performance';
  target: string; // What this check validates
  scope: string[]; // Files/patterns this check covers
  isAutomated: boolean;
  estimatedDurationMs: number;
  criticalityLevel: 'critical' | 'high' | 'medium' | 'low';
}

export interface VerificationSignal {
  changeId: string;
  filePath: string;
  checkId: string;
  checkName: string;
  confidence: number; // 0-1: How confident this check validates this change
  signalStrength: 'weak' | 'medium' | 'strong'; // Based on confidence
  evidence: string; // Why this check covers this change
}

export interface FileVerificationCoverage {
  filePath: string;
  changeType: CodeChange['type'];
  impact: CodeChange['impact'];
  totalSignals: number;
  signals: VerificationSignal[];
  isCovered: boolean; // Has at least one strong signal
  coverageScore: number; // 0-100
  gaps: string[]; // What's not covered
  recommendations: string[];
}

export interface CoverageAnalysis {
  timestamp: Date;
  totalChanges: number;
  totalSignals: number;
  filesWithCoverage: number;
  filesWithoutCoverage: number;
  overallCoveragePercentage: number;
  coverageByType: Map<CodeChange['type'], number>;
  coverageByImpact: Map<CodeChange['impact'], number>;
  criticalGaps: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface VerificationGap {
  filePath: string;
  changeDescription: string;
  changeType: CodeChange['type'];
  impact: CodeChange['impact'];
  reason: string;
  suggestedChecks: string[];
  riskIfUncovered: string;
}

export interface VerificationCoverageReport {
  reportId: string;
  timestamp: Date;
  totalChanges: number;
  filesAnalyzed: number;
  fileCoverages: FileVerificationCoverage[];
  coverage: CoverageAnalysis;
  gaps: VerificationGap[];
  recommendations: string[];
  verificationRequiredBeforeRelease: boolean;
}

/**
 * Build verification signals mapping changes to checks
 */
export function buildVerificationSignals(
  changes: CodeChange[],
  checks: VerificationCheck[]
): VerificationSignal[] {
  const signals: VerificationSignal[] = [];
  
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    
    for (const check of checks) {
      // Determine if check covers this change
      let confidence = 0;
      const evidence: string[] = [];
      
      // Type-based matching
      if (change.type === 'implementation') {
        if (['unit', 'integration', 'e2e'].includes(check.type)) confidence += 0.3;
        if (check.type === 'unit') evidence.push('Unit test covers implementation');
      } else if (change.type === 'test') {
        if (check.type === 'unit' || check.type === 'integration') confidence += 0.4;
        evidence.push('Test coverage validates test code');
      } else if (change.type === 'documentation') {
        if (check.type === 'smoke') confidence += 0.2;
        evidence.push('Smoke test validates doc examples');
      }
      
      // File pattern matching
      for (const scope of check.scope) {
        if (matchesPattern(change.filePath, scope)) {
          confidence += 0.3;
          evidence.push(`Check scope matches: ${scope}`);
          break;
        }
      }
      
      // Impact-based matching
      if (change.impact === 'high' && check.criticalityLevel === 'critical') {
        confidence += 0.2;
        evidence.push('Critical check for high-impact change');
      }
      
      if (confidence > 0.2) { // Minimum threshold
        signals.push({
          changeId: `change-${i}`,
          filePath: change.filePath,
          checkId: check.id,
          checkName: check.name,
          confidence: Math.min(confidence, 1),
          signalStrength: confidence < 0.4 ? 'weak' : confidence < 0.7 ? 'medium' : 'strong',
          evidence: evidence.join('; ')
        });
      }
    }
  }
  
  return signals;
}

/**
 * Simple pattern matching for file paths
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  // Handle wildcards and simple patterns
  if (pattern === '*' || pattern === '**') return true;
  if (pattern.endsWith('/*') && filePath.startsWith(pattern.slice(0, -2))) return true;
  if (pattern.endsWith('/**') && filePath.startsWith(pattern.slice(0, -3))) return true;
  if (filePath.includes(pattern) || pattern.includes(filePath)) return true;
  return false;
}

/**
 * Calculate coverage for individual file
 */
export function calculateFileCoverage(
  change: CodeChange,
  signals: VerificationSignal[]
): FileVerificationCoverage {
  const relevantSignals = signals.filter(s => s.filePath === change.filePath);
  const strongSignals = relevantSignals.filter(s => s.signalStrength === 'strong');
  const isCovered = strongSignals.length > 0;
  
  // Calculate coverage score
  let coverageScore = 0;
  if (relevantSignals.length > 0) {
    const avgConfidence = relevantSignals.reduce((sum, s) => sum + s.confidence, 0) / relevantSignals.length;
    coverageScore = avgConfidence * 100;
  }
  
  // Identify gaps
  const gaps: string[] = [];
  if (!isCovered) {
    gaps.push(`No strong verification signals for ${change.type} changes`);
  }
  if (relevantSignals.length === 0) {
    gaps.push(`No verification signals found for ${change.filePath}`);
  }
  
  // Recommendations
  const recommendations: string[] = [];
  if (change.impact === 'high' && coverageScore < 70) {
    recommendations.push(`Add critical-level checks for high-impact changes (current: ${coverageScore.toFixed(0)}%)`);
  }
  if (change.type === 'implementation' && !relevantSignals.some(s => s.checkId.includes('unit'))) {
    recommendations.push(`Add unit tests for implementation changes`);
  }
  
  return {
    filePath: change.filePath,
    changeType: change.type,
    impact: change.impact,
    totalSignals: relevantSignals.length,
    signals: relevantSignals,
    isCovered,
    coverageScore,
    gaps,
    recommendations
  };
}

/**
 * Calculate overall coverage analysis
 */
export function calculateCoverageAnalysis(
  changes: CodeChange[],
  fileCoverages: FileVerificationCoverage[]
): CoverageAnalysis {
  const analysis: CoverageAnalysis = {
    timestamp: new Date(),
    totalChanges: changes.length,
    totalSignals: fileCoverages.reduce((sum, f) => sum + f.totalSignals, 0),
    filesWithCoverage: fileCoverages.filter(f => f.isCovered).length,
    filesWithoutCoverage: fileCoverages.filter(f => !f.isCovered).length,
    overallCoveragePercentage: 0,
    coverageByType: new Map(),
    coverageByImpact: new Map(),
    criticalGaps: [],
    riskLevel: 'low'
  };
  
  // Calculate overall coverage percentage
  if (fileCoverages.length > 0) {
    const totalScore = fileCoverages.reduce((sum, f) => sum + f.coverageScore, 0);
    analysis.overallCoveragePercentage = totalScore / fileCoverages.length;
  }
  
  // Coverage by type
  const typeGroups = new Map<CodeChange['type'], number>();
  for (const type of ['implementation', 'test', 'documentation', 'config']) {
    const forType = fileCoverages.filter(f => f.changeType === type as any);
    if (forType.length > 0) {
      const score = forType.reduce((sum, f) => sum + f.coverageScore, 0) / forType.length;
      typeGroups.set(type as any, score);
    }
  }
  analysis.coverageByType = typeGroups;
  
  // Coverage by impact
  const impactGroups = new Map<CodeChange['impact'], number>();
  for (const impact of ['low', 'medium', 'high']) {
    const forImpact = fileCoverages.filter(f => f.impact === impact as any);
    if (forImpact.length > 0) {
      const score = forImpact.reduce((sum, f) => sum + f.coverageScore, 0) / forImpact.length;
      impactGroups.set(impact as any, score);
    }
  }
  analysis.coverageByImpact = impactGroups;
  
  // Critical gaps
  const criticalCoverages = fileCoverages.filter(f => f.impact === 'high' && !f.isCovered);
  analysis.criticalGaps = criticalCoverages.map(f => f.filePath);
  
  // Determine risk level
  if (analysis.criticalGaps.length > 0) {
    analysis.riskLevel = 'critical';
  } else if (analysis.overallCoveragePercentage < 50) {
    analysis.riskLevel = 'high';
  } else if (analysis.overallCoveragePercentage < 70) {
    analysis.riskLevel = 'medium';
  }
  
  return analysis;
}

/**
 * Identify verification gaps
 */
export function identifyGaps(
  changes: CodeChange[],
  fileCoverages: FileVerificationCoverage[]
): VerificationGap[] {
  const gaps: VerificationGap[] = [];
  
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const coverage = fileCoverages[i];
    
    if (coverage.coverageScore < 100) {
      // Determine suggested checks
      const suggestedChecks: string[] = [];
      if (change.type === 'implementation') {
        suggestedChecks.push('Unit tests', 'Integration tests', 'Type checking');
      } else if (change.type === 'test') {
        suggestedChecks.push('Test coverage analysis', 'Integration tests');
      }
      
      if (change.impact === 'high') {
        suggestedChecks.push('E2E tests', 'Security review');
      }
      
      gaps.push({
        filePath: change.filePath,
        changeDescription: change.description,
        changeType: change.type,
        impact: change.impact,
        reason: coverage.gaps.length > 0 ? coverage.gaps[0] : 'Low coverage score',
        suggestedChecks,
        riskIfUncovered: change.impact === 'high' ? 'Breaking changes could reach production' : 'Minor regressions possible'
      });
    }
  }
  
  return gaps;
}

/**
 * Generate recommendations for improving coverage
 */
export function generateRecommendations(
  analysis: CoverageAnalysis,
  gaps: VerificationGap[]
): string[] {
  const recommendations: string[] = [];
  
  if (analysis.riskLevel === 'critical') {
    recommendations.push(`CRITICAL: ${analysis.criticalGaps.length} high-impact files lack verification coverage`);
    gaps.slice(0, 3).forEach(gap => {
      recommendations.push(`- Add verification for ${gap.filePath}: ${gap.riskIfUncovered}`);
    });
  }
  
  if (analysis.overallCoveragePercentage < 70) {
    recommendations.push(`Increase overall coverage from ${analysis.overallCoveragePercentage.toFixed(0)}% to target 100%`);
  }
  
  const lowTypeCoverage = Array.from(analysis.coverageByType.entries())
    .filter(([_, score]) => score < 70)
    .map(([type, score]) => `${type}: ${score.toFixed(0)}%`);
  
  if (lowTypeCoverage.length > 0) {
    recommendations.push(`Improve coverage for: ${lowTypeCoverage.join(', ')}`);
  }
  
  if (gaps.length > 0) {
    recommendations.push(`Address ${gaps.length} verification gap(s) before release`);
  }
  
  if (recommendations.length === 0) {
    recommendations.push('All changes have adequate verification coverage');
  }
  
  return recommendations;
}

/**
 * Generate comprehensive verification coverage report
 */
export function generateVerificationCoverageReport(
  changes: CodeChange[],
  checks: VerificationCheck[],
  reportId: string = `report-${Date.now()}`
): VerificationCoverageReport {
  // Build signals
  const signals = buildVerificationSignals(changes, checks);
  
  // Calculate file coverage
  const fileCoverages = changes.map(change => calculateFileCoverage(change, signals));
  
  // Calculate overall analysis
  const coverage = calculateCoverageAnalysis(changes, fileCoverages);
  
  // Identify gaps
  const gaps = identifyGaps(changes, fileCoverages);
  
  // Generate recommendations
  const recommendations = generateRecommendations(coverage, gaps);
  
  // Determine if verification required
  const verificationRequiredBeforeRelease = coverage.riskLevel === 'critical' || 
                                           coverage.riskLevel === 'high' ||
                                           gaps.some(g => g.impact === 'high');
  
  return {
    reportId,
    timestamp: new Date(),
    totalChanges: changes.length,
    filesAnalyzed: fileCoverages.length,
    fileCoverages,
    coverage,
    gaps,
    recommendations,
    verificationRequiredBeforeRelease
  };
}
