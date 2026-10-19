/**
 * Request Satisfaction Validator
 * Phase 8.1: Validates that executed changes satisfy the original user request
 * and work plan acceptance criteria
 */

import { FullStackWorkPlan } from '../repo/workPlanOrchestrator.js';

export interface UserRequirement {
  id: string;
  text: string;
  category: 'functional' | 'non-functional' | 'constraint' | 'acceptance';
  priority: 'critical' | 'high' | 'medium' | 'low';
  addressed: boolean;
}

export interface RequirementMapping {
  requirementId: string;
  addressedBy: string[]; // File paths or change descriptions that address this requirement
  confidence: number; // 0-1: how confident we are this requirement is satisfied
  evidence: string[]; // Supporting evidence from changes
}

export interface CoverageAnalysis {
  totalRequirements: number;
  addressedRequirements: number;
  coveragePercentage: number;
  criticalityCoverage: Map<string, number>; // Coverage by priority level
  categoryBreakdown: Map<string, { total: number; addressed: number }>;
}

export interface Gap {
  requirementId: string;
  requirementText: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  reason: string; // Why it wasn't addressed
  suggestion: string; // What could address it
}

export interface ComplianceReport {
  requestId: string;
  timestamp: Date;
  satisfactionScore: number; // 0-100
  status: 'satisfied' | 'partially-satisfied' | 'unsatisfied';
  requirementsMapped: number;
  requirementsAddressed: number;
  coverage: CoverageAnalysis;
  gaps: Gap[];
  riskAssessment: string; // Overall risk summary
  recommendations: string[];
}

export interface ExecutedChange {
  filePath: string;
  description: string;
  impact: string; // What this change affects
  type: 'implementation' | 'test' | 'documentation' | 'config';
}

/**
 * Extract requirements from user request text
 * Uses simple heuristics to identify requirement patterns
 */
export function extractRequirements(userRequest: string): UserRequirement[] {
  const requirements: UserRequirement[] = [];
  const lines = userRequest.split('\n').filter(l => l.trim());
  
  let index = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('//')) continue;
    
    // Detect requirement patterns
    let category: 'functional' | 'non-functional' | 'constraint' | 'acceptance' = 'functional';
    let priority: 'critical' | 'high' | 'medium' | 'low' = 'medium';
    
    // Determine category
    if (trimmed.toLowerCase().includes('must') || trimmed.toLowerCase().includes('should')) {
      category = 'functional';
    } else if (trimmed.toLowerCase().includes('performance') || trimmed.toLowerCase().includes('accessible')) {
      category = 'non-functional';
    } else if (trimmed.toLowerCase().includes('constraint') || trimmed.toLowerCase().includes('cannot')) {
      category = 'constraint';
    } else if (trimmed.toLowerCase().includes('accept') || trimmed.toLowerCase().includes('when')) {
      category = 'acceptance';
    }
    
    // Determine priority
    if (trimmed.toLowerCase().includes('critical') || trimmed.toLowerCase().includes('must')) {
      priority = 'critical';
    } else if (trimmed.toLowerCase().includes('important') || trimmed.toLowerCase().includes('should')) {
      priority = 'high';
    } else if (trimmed.toLowerCase().includes('nice')) {
      priority = 'low';
    }
    
    requirements.push({
      id: `req-${index}`,
      text: trimmed,
      category,
      priority,
      addressed: false
    });
    
    index++;
  }
  
  return requirements;
}

/**
 * Extract acceptance criteria from work plan
 */
export function extractAcceptanceCriteria(workPlan: FullStackWorkPlan): UserRequirement[] {
  const criteria: UserRequirement[] = [];
  
  if (!workPlan.acceptanceCriteria) {
    return criteria;
  }
  
  for (let i = 0; i < workPlan.acceptanceCriteria.length; i++) {
    const criterion = workPlan.acceptanceCriteria[i];
    criteria.push({
      id: `ac-${i}`,
      text: criterion.description,
      category: 'acceptance',
      priority: criterion.required ? 'critical' : 'high',
      addressed: false
    });
  }
  
  return criteria;
}

/**
 * Combine requirements and acceptance criteria
 */
export function combineRequirements(
  userRequirements: UserRequirement[],
  acceptanceCriteria: UserRequirement[]
): UserRequirement[] {
  const combined = [...userRequirements, ...acceptanceCriteria];
  
  // Deduplicate similar requirements
  const seen = new Set<string>();
  return combined.filter(req => {
    const key = req.text.toLowerCase().substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Map executed changes to requirements
 */
export function mapChangesToRequirements(
  requirements: UserRequirement[],
  executedChanges: ExecutedChange[]
): RequirementMapping[] {
  const mappings: RequirementMapping[] = [];
  
  for (const req of requirements) {
    const addressingChanges: string[] = [];
    const evidence: string[] = [];
    let confidence = 0;
    
    // Simple keyword-based matching
    const reqWords = req.text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    
    for (const change of executedChanges) {
      const changeText = `${change.description} ${change.impact}`.toLowerCase();
      const matchCount = reqWords.filter(word => changeText.includes(word)).length;
      const matchRatio = matchCount / reqWords.length;
      
      if (matchRatio > 0.3) { // At least 30% word match
        addressingChanges.push(change.filePath);
        evidence.push(`${change.description} (${change.type})`);
        confidence = Math.max(confidence, 0.5 + (matchRatio * 0.5));
      }
    }
    
    mappings.push({
      requirementId: req.id,
      addressedBy: addressingChanges,
      confidence: Math.min(confidence, 1),
      evidence
    });
  }
  
  return mappings;
}

/**
 * Calculate coverage statistics
 */
export function calculateCoverageAnalysis(
  requirements: UserRequirement[],
  mappings: RequirementMapping[]
): CoverageAnalysis {
  const analysis: CoverageAnalysis = {
    totalRequirements: requirements.length,
    addressedRequirements: 0,
    coveragePercentage: 0,
    criticalityCoverage: new Map(),
    categoryBreakdown: new Map()
  };
  
  // Initialize maps
  const priorities = ['critical', 'high', 'medium', 'low'];
  for (const priority of priorities) {
    analysis.criticalityCoverage.set(priority, 0);
  }
  
  // Process each requirement
  for (let i = 0; i < requirements.length; i++) {
    const req = requirements[i];
    const mapping = mappings[i];
    
    const isAddressed = mapping.addressedBy.length > 0 && mapping.confidence > 0.3;
    if (isAddressed) {
      analysis.addressedRequirements++;
    }
    
    // Update priority coverage
    const currentPriorityCoverage = analysis.criticalityCoverage.get(req.priority) || 0;
    analysis.criticalityCoverage.set(
      req.priority,
      currentPriorityCoverage + (isAddressed ? 1 : 0)
    );
    
    // Update category breakdown
    const current = analysis.categoryBreakdown.get(req.category) || { total: 0, addressed: 0 };
    analysis.categoryBreakdown.set(req.category, {
      total: current.total + 1,
      addressed: current.addressed + (isAddressed ? 1 : 0)
    });
  }
  
  analysis.coveragePercentage = analysis.totalRequirements > 0
    ? (analysis.addressedRequirements / analysis.totalRequirements) * 100
    : 0;
  
  return analysis;
}

/**
 * Identify unaddressed requirements as gaps
 */
export function identifyGaps(
  requirements: UserRequirement[],
  mappings: RequirementMapping[]
): Gap[] {
  const gaps: Gap[] = [];
  
  for (let i = 0; i < requirements.length; i++) {
    const req = requirements[i];
    const mapping = mappings[i];
    
    const isAddressed = mapping.addressedBy.length > 0 && mapping.confidence > 0.3;
    
    if (!isAddressed) {
      let reason = 'No matching changes found';
      if (mapping.addressedBy.length === 0) {
        reason = 'No changes address this requirement';
      } else if (mapping.confidence <= 0.3) {
        reason = `Low confidence match (${(mapping.confidence * 100).toFixed(0)}%)`;
      }
      
      gaps.push({
        requirementId: req.id,
        requirementText: req.text,
        priority: req.priority,
        reason,
        suggestion: `Consider ${req.category === 'functional' ? 'implementing' : 'testing'} ${req.text.substring(0, 40)}`
      });
    }
  }
  
  return gaps;
}

/**
 * Calculate satisfaction score
 */
export function calculateSatisfactionScore(
  coverage: CoverageAnalysis,
  gaps: Gap[]
): number {
  if (coverage.totalRequirements === 0) {
    return 100;
  }
  
  // Base score from coverage
  let score = coverage.coveragePercentage;
  
  // Adjust for critical gaps
  const criticalGaps = gaps.filter(g => g.priority === 'critical').length;
  const highGaps = gaps.filter(g => g.priority === 'high').length;
  
  score -= criticalGaps * 15; // Each critical gap reduces by 15%
  score -= highGaps * 5; // Each high gap reduces by 5%
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Determine satisfaction status
 */
export function determineSatisfactionStatus(score: number): 'satisfied' | 'partially-satisfied' | 'unsatisfied' {
  if (score >= 90) return 'satisfied';
  if (score >= 50) return 'partially-satisfied';
  return 'unsatisfied';
}

/**
 * Generate risk assessment
 */
export function generateRiskAssessment(
  coverage: CoverageAnalysis,
  gaps: Gap[],
  satisfactionScore: number
): string {
  const criticalGaps = gaps.filter(g => g.priority === 'critical').length;
  const riskLevel = satisfactionScore >= 90 ? 'LOW' : satisfactionScore >= 50 ? 'MEDIUM' : 'HIGH';
  
  if (criticalGaps > 0) {
    return `${riskLevel}: ${criticalGaps} critical requirement(s) not addressed`;
  }
  
  const coverageLevel = coverage.coveragePercentage.toFixed(0);
  return `${riskLevel}: ${coverageLevel}% requirement coverage`;
}

/**
 * Generate compliance recommendations
 */
export function generateRecommendations(gaps: Gap[]): string[] {
  const recommendations: string[] = [];
  
  if (gaps.length === 0) {
    recommendations.push('All requirements are satisfied');
    return recommendations;
  }
  
  const criticalGaps = gaps.filter(g => g.priority === 'critical');
  const highGaps = gaps.filter(g => g.priority === 'high');
  
  if (criticalGaps.length > 0) {
    recommendations.push(`Address ${criticalGaps.length} critical requirement(s) before release`);
    criticalGaps.slice(0, 2).forEach(gap => {
      recommendations.push(`- ${gap.suggestion}`);
    });
  }
  
  if (highGaps.length > 0) {
    recommendations.push(`Consider addressing ${highGaps.length} high-priority requirement(s)`);
  }
  
  if (gaps.length > 3) {
    recommendations.push(`Review and prioritize remaining ${gaps.length - 3} gap(s)`);
  }
  
  return recommendations;
}

/**
 * Main validation function
 */
export function validateRequestSatisfaction(
  userRequest: string,
  workPlan: FullStackWorkPlan,
  executedChanges: ExecutedChange[],
  requestId: string = `req-${Date.now()}`
): ComplianceReport {
  // Extract requirements
  const userRequirements = extractRequirements(userRequest);
  const acceptanceCriteria = extractAcceptanceCriteria(workPlan);
  const allRequirements = combineRequirements(userRequirements, acceptanceCriteria);
  
  // Map changes to requirements
  const mappings = mapChangesToRequirements(allRequirements, executedChanges);
  
  // Calculate coverage
  const coverage = calculateCoverageAnalysis(allRequirements, mappings);
  
  // Identify gaps
  const gaps = identifyGaps(allRequirements, mappings);
  
  // Calculate score
  const satisfactionScore = calculateSatisfactionScore(coverage, gaps);
  const status = determineSatisfactionStatus(satisfactionScore);
  
  // Generate assessments and recommendations
  const riskAssessment = generateRiskAssessment(coverage, gaps, satisfactionScore);
  const recommendations = generateRecommendations(gaps);
  
  return {
    requestId,
    timestamp: new Date(),
    satisfactionScore: Math.round(satisfactionScore),
    status,
    requirementsMapped: allRequirements.length,
    requirementsAddressed: coverage.addressedRequirements,
    coverage,
    gaps,
    riskAssessment,
    recommendations
  };
}
