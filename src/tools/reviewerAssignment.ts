/**
 * Reviewer Assignment & Workflow - Phase 8.6
 * Routes multi-layer changes to appropriate reviewers and manages approval workflow
 */

/**
 * Represents a reviewer agent
 */
export interface Reviewer {
  id: string;
  name: string;
  role: 'security' | 'performance' | 'api' | 'frontend' | 'data' | 'architecture';
  layers: string[];
  expertise: string[];
  availabilityScore: number; // 0-100
}

/**
 * Represents review feedback from a reviewer
 */
export interface ReviewFeedback {
  reviewerId: string;
  reviewerName: string;
  status: 'approved' | 'approved-with-conditions' | 'rejected' | 'pending' | 'in-review';
  feedback: string;
  concerns: string[];
  suggestions: string[];
  conditions?: string[];
  timestamp: string;
}

/**
 * Represents a review decision summary
 */
export interface ReviewDecision {
  reviewId: string;
  overallStatus: 'approved' | 'approved-with-conditions' | 'rejected' | 'pending';
  reviewers: ReviewFeedback[];
  requiredApprovals: number;
  approvalsReceived: number;
  rationale: string;
  timestamp: string;
}

/**
 * Represents the complete review workflow
 */
export interface ReviewWorkflow {
  taskId: string;
  affectedLayers: string[];
  multiLayerChange: boolean;
  reviewRequired: boolean;
  assignedReviewers: Reviewer[];
  feedback: ReviewFeedback[];
  decision?: ReviewDecision;
  workflowStatus: 'pending' | 'reviewing' | 'complete' | 'rejected';
  createdAt: string;
  completedAt?: string;
}

/**
 * Default reviewer pool
 */
const DEFAULT_REVIEWERS: Reviewer[] = [
  {
    id: 'reviewer-security',
    name: 'Security Reviewer',
    role: 'security',
    layers: ['backend', 'data', 'config'],
    expertise: ['authentication', 'authorization', 'encryption', 'validation'],
    availabilityScore: 95
  },
  {
    id: 'reviewer-api',
    name: 'API Reviewer',
    role: 'api',
    layers: ['backend', 'frontend'],
    expertise: ['api-design', 'contracts', 'backwards-compatibility'],
    availabilityScore: 90
  },
  {
    id: 'reviewer-frontend',
    name: 'Frontend Reviewer',
    role: 'frontend',
    layers: ['frontend', 'ui'],
    expertise: ['accessibility', 'performance', 'responsive-design'],
    availabilityScore: 85
  },
  {
    id: 'reviewer-data',
    name: 'Data Reviewer',
    role: 'data',
    layers: ['data', 'backend'],
    expertise: ['schema-design', 'migrations', 'performance'],
    availabilityScore: 80
  },
  {
    id: 'reviewer-performance',
    name: 'Performance Reviewer',
    role: 'performance',
    layers: ['backend', 'frontend', 'data'],
    expertise: ['optimization', 'caching', 'profiling'],
    availabilityScore: 75
  },
  {
    id: 'reviewer-architecture',
    name: 'Architecture Reviewer',
    role: 'architecture',
    layers: ['backend', 'frontend', 'data', 'config'],
    expertise: ['design-patterns', 'scalability', 'maintainability'],
    availabilityScore: 88
  }
];

/**
 * Identifies if a change requires review based on layers touched
 */
export function requiresReview(affectedLayers: string[]): boolean {
  // Multi-layer changes always require review
  if (affectedLayers.length > 1) return true;

  // Single-layer changes requiring review: backend, data, config
  const criticalLayers = ['backend', 'data', 'config', 'security'];
  return affectedLayers.some(layer => criticalLayers.includes(layer.toLowerCase()));
}

/**
 * Assigns appropriate reviewers based on affected layers
 */
export function assignReviewers(
  affectedLayers: string[],
  reviewerPool: Reviewer[] = DEFAULT_REVIEWERS
): Reviewer[] {
  const assigned: Reviewer[] = [];
  const layerLowercase = affectedLayers.map(l => l.toLowerCase());

  // Add primary reviewers based on layer coverage
  for (const reviewer of reviewerPool) {
    const layerMatch = reviewer.layers.some(l => layerLowercase.includes(l.toLowerCase()));
    if (layerMatch) {
      assigned.push(reviewer);
    }
  }

  // If multiple layers, always add architecture reviewer
  if (affectedLayers.length > 1) {
    const archReviewer = reviewerPool.find(r => r.role === 'architecture');
    if (archReviewer && !assigned.find(r => r.id === archReviewer.id)) {
      assigned.push(archReviewer);
    }
  }

  // If backend or data affected, add security reviewer
  if (layerLowercase.some(l => ['backend', 'data'].includes(l))) {
    const secReviewer = reviewerPool.find(r => r.role === 'security');
    if (secReviewer && !assigned.find(r => r.id === secReviewer.id)) {
      assigned.push(secReviewer);
    }
  }

  // Sort by availability score (highest first)
  return assigned.sort((a, b) => b.availabilityScore - a.availabilityScore);
}

/**
 * Initiates a review workflow for a task
 */
export function initiateReviewWorkflow(
  taskId: string,
  affectedLayers: string[],
  reviewerPool: Reviewer[] = DEFAULT_REVIEWERS
): ReviewWorkflow {
  const multiLayerChange = affectedLayers.length > 1;
  const reviewRequired = requiresReview(affectedLayers);
  const assignedReviewers = reviewRequired ? assignReviewers(affectedLayers, reviewerPool) : [];

  return {
    taskId,
    affectedLayers,
    multiLayerChange,
    reviewRequired,
    assignedReviewers,
    feedback: [],
    workflowStatus: reviewRequired ? 'pending' : 'complete',
    createdAt: new Date().toISOString(),
    completedAt: reviewRequired ? undefined : new Date().toISOString()
  };
}

/**
 * Submits review feedback from a reviewer
 */
export function submitReviewFeedback(
  workflow: ReviewWorkflow,
  reviewerId: string,
  status: 'approved' | 'approved-with-conditions' | 'rejected',
  feedback: string,
  concerns: string[] = [],
  suggestions: string[] = [],
  conditions: string[] = []
): ReviewWorkflow {
  const reviewer = workflow.assignedReviewers.find(r => r.id === reviewerId);
  if (!reviewer) {
    throw new Error(`Reviewer ${reviewerId} not assigned to this workflow`);
  }

  const reviewFeedback: ReviewFeedback = {
    reviewerId,
    reviewerName: reviewer.name,
    status,
    feedback,
    concerns,
    suggestions,
    conditions: status === 'approved-with-conditions' ? conditions : undefined,
    timestamp: new Date().toISOString()
  };

  const updatedFeedback = workflow.feedback.filter(f => f.reviewerId !== reviewerId);
  updatedFeedback.push(reviewFeedback);

  return {
    ...workflow,
    feedback: updatedFeedback,
    workflowStatus: 'reviewing'
  };
}

/**
 * Calculates review decision based on all feedback
 */
export function calculateReviewDecision(workflow: ReviewWorkflow): ReviewDecision {
  const totalReviewers = workflow.assignedReviewers.length;
  const approvalsReceived = workflow.feedback.filter(f =>
    f.status === 'approved' || f.status === 'approved-with-conditions'
  ).length;

  // Determine overall status
  let overallStatus: 'approved' | 'approved-with-conditions' | 'rejected' | 'pending';
  let rationale = '';

  const hasRejection = workflow.feedback.some(f => f.status === 'rejected');
  const hasConditions = workflow.feedback.some(f => f.status === 'approved-with-conditions');

  if (hasRejection) {
    overallStatus = 'rejected';
    rationale = 'One or more reviewers rejected the changes';
  } else if (approvalsReceived < totalReviewers) {
    overallStatus = 'pending';
    rationale = `Awaiting approval from ${totalReviewers - approvalsReceived} reviewer(s)`;
  } else if (hasConditions) {
    overallStatus = 'approved-with-conditions';
    const conditionList = workflow.feedback
      .filter(f => f.conditions && f.conditions.length > 0)
      .flatMap(f => f.conditions || []);
    rationale = `Approved with ${conditionList.length} condition(s): ${conditionList.join(', ')}`;
  } else {
    overallStatus = 'approved';
    rationale = `All ${totalReviewers} reviewer(s) approved`;
  }

  return {
    reviewId: `review-${workflow.taskId}`,
    overallStatus,
    reviewers: workflow.feedback,
    requiredApprovals: totalReviewers,
    approvalsReceived,
    rationale,
    timestamp: new Date().toISOString()
  };
}

/**
 * Finalizes the review workflow with decision
 */
export function finalizeReviewWorkflow(workflow: ReviewWorkflow): ReviewWorkflow {
  if (workflow.workflowStatus === 'complete') {
    return workflow;
  }

  const decision = calculateReviewDecision(workflow);
  const isComplete = decision.overallStatus === 'approved' || 
                     decision.overallStatus === 'approved-with-conditions' ||
                     decision.overallStatus === 'rejected';

  return {
    ...workflow,
    decision,
    workflowStatus: isComplete ? 'complete' : 'reviewing',
    completedAt: isComplete ? new Date().toISOString() : undefined
  };
}

/**
 * Generates a review summary report
 */
export function generateReviewSummary(workflow: ReviewWorkflow): string {
  let summary = `# Review Summary for Task ${workflow.taskId}\n\n`;

  summary += `**Affected Layers:** ${workflow.affectedLayers.join(', ')}\n`;
  summary += `**Multi-Layer Change:** ${workflow.multiLayerChange ? 'Yes' : 'No'}\n`;
  summary += `**Review Required:** ${workflow.reviewRequired ? 'Yes' : 'No'}\n\n`;

  if (!workflow.reviewRequired) {
    summary += `## Status: No Review Required\n`;
    return summary;
  }

  summary += `## Assigned Reviewers\n`;
  for (const reviewer of workflow.assignedReviewers) {
    summary += `- ${reviewer.name} (${reviewer.role}) - Availability: ${reviewer.availabilityScore}%\n`;
  }

  summary += `\n## Review Feedback\n`;
  if (workflow.feedback.length === 0) {
    summary += `No feedback yet. Awaiting reviewer responses.\n`;
  } else {
    for (const feedback of workflow.feedback) {
      summary += `\n### ${feedback.reviewerName} - ${feedback.status.toUpperCase()}\n`;
      summary += `**Feedback:** ${feedback.feedback}\n`;
      if (feedback.concerns.length > 0) {
        summary += `**Concerns:** ${feedback.concerns.join(', ')}\n`;
      }
      if (feedback.suggestions.length > 0) {
        summary += `**Suggestions:** ${feedback.suggestions.join(', ')}\n`;
      }
      if (feedback.conditions && feedback.conditions.length > 0) {
        summary += `**Conditions:** ${feedback.conditions.join(', ')}\n`;
      }
    }
  }

  if (workflow.decision) {
    summary += `\n## Review Decision\n`;
    summary += `**Overall Status:** ${workflow.decision.overallStatus.toUpperCase()}\n`;
    summary += `**Approvals:** ${workflow.decision.approvalsReceived}/${workflow.decision.requiredApprovals}\n`;
    summary += `**Rationale:** ${workflow.decision.rationale}\n`;
  }

  return summary;
}

/**
 * Checks if workflow is ready for merge
 */
export function isReadyForMerge(workflow: ReviewWorkflow): boolean {
  if (!workflow.reviewRequired) {
    return true;
  }

  if (!workflow.decision) {
    return false;
  }

  return workflow.decision.overallStatus === 'approved' ||
         workflow.decision.overallStatus === 'approved-with-conditions';
}

/**
 * Determines if conditions need to be addressed
 */
export function hasConditionalApproval(workflow: ReviewWorkflow): boolean {
  return workflow.decision?.overallStatus === 'approved-with-conditions';
}

/**
 * Gets all conditions that need to be addressed
 */
export function getApprovalConditions(workflow: ReviewWorkflow): string[] {
  if (!workflow.decision) return [];

  const conditions: string[] = [];
  for (const feedback of workflow.decision.reviewers) {
    if (feedback.conditions) {
      conditions.push(...feedback.conditions);
    }
  }
  return conditions;
}
