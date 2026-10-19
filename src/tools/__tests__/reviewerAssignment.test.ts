/**
 * Reviewer Assignment & Workflow Tests
 * Phase 8.6: Routes multi-layer changes to appropriate reviewers and manages approval workflow
 */

import {
  Reviewer,
  ReviewFeedback,
  ReviewWorkflow,
  requiresReview,
  assignReviewers,
  initiateReviewWorkflow,
  submitReviewFeedback,
  calculateReviewDecision,
  finalizeReviewWorkflow,
  generateReviewSummary,
  isReadyForMerge,
  hasConditionalApproval,
  getApprovalConditions
} from '../reviewerAssignment';

describe('Reviewer Assignment & Workflow', () => {
  const mockReviewers: Reviewer[] = [
    {
      id: 'reviewer-api',
      name: 'API Reviewer',
      role: 'api',
      layers: ['backend', 'frontend'],
      expertise: ['api-design'],
      availabilityScore: 90
    },
    {
      id: 'reviewer-frontend',
      name: 'Frontend Reviewer',
      role: 'frontend',
      layers: ['frontend'],
      expertise: ['accessibility'],
      availabilityScore: 85
    },
    {
      id: 'reviewer-security',
      name: 'Security Reviewer',
      role: 'security',
      layers: ['backend', 'data'],
      expertise: ['authentication'],
      availabilityScore: 95
    },
    {
      id: 'reviewer-architecture',
      name: 'Architecture Reviewer',
      role: 'architecture',
      layers: ['backend', 'frontend', 'data'],
      expertise: ['design-patterns'],
      availabilityScore: 88
    }
  ];

  // Test 1: Determine if single-layer frontend change requires review
  it('should not require review for frontend-only changes', () => {
    const result = requiresReview(['frontend']);
    expect(result).toBe(false);
  });

  // Test 2: Determine if single-layer backend change requires review
  it('should require review for backend-only changes', () => {
    const result = requiresReview(['backend']);
    expect(result).toBe(true);
  });

  // Test 3: Multi-layer changes always require review
  it('should require review for multi-layer changes', () => {
    const result = requiresReview(['frontend', 'backend']);
    expect(result).toBe(true);
  });

  // Test 4: Assign reviewers based on affected layers
  it('should assign reviewers matching affected layers', () => {
    const assigned = assignReviewers(['backend'], mockReviewers);

    expect(assigned.length).toBeGreaterThan(0);
    expect(assigned.some(r => r.role === 'security')).toBe(true);
    expect(assigned.some(r => r.role === 'api')).toBe(true);
  });

  // Test 5: Multi-layer changes get architecture reviewer
  it('should assign architecture reviewer for multi-layer changes', () => {
    const assigned = assignReviewers(['frontend', 'backend'], mockReviewers);

    expect(assigned.some(r => r.role === 'architecture')).toBe(true);
  });

  // Test 6: Reviewers sorted by availability score
  it('should sort reviewers by availability score', () => {
    const assigned = assignReviewers(['backend'], mockReviewers);

    for (let i = 0; i < assigned.length - 1; i++) {
      expect(assigned[i].availabilityScore).toBeGreaterThanOrEqual(assigned[i + 1].availabilityScore);
    }
  });

  // Test 7: Initiate review workflow for change requiring review
  it('should initiate review workflow with assigned reviewers', () => {
    const workflow = initiateReviewWorkflow('task-123', ['backend'], mockReviewers);

    expect(workflow.taskId).toBe('task-123');
    expect(workflow.reviewRequired).toBe(true);
    expect(workflow.assignedReviewers.length).toBeGreaterThan(0);
    expect(workflow.workflowStatus).toBe('pending');
    expect(workflow.createdAt).toBeTruthy();
  });

  // Test 8: Submit review feedback
  it('should accept and track review feedback', () => {
    const workflow = initiateReviewWorkflow('task-456', ['backend'], mockReviewers);
    const reviewer = workflow.assignedReviewers[0];

    const updated = submitReviewFeedback(
      workflow,
      reviewer.id,
      'approved',
      'Looks good',
      [],
      ['Consider adding error handling'],
      []
    );

    expect(updated.feedback.length).toBe(1);
    expect(updated.feedback[0].status).toBe('approved');
    expect(updated.feedback[0].feedback).toBe('Looks good');
    expect(updated.feedback[0].suggestions.length).toBe(1);
    expect(updated.workflowStatus).toBe('reviewing');
  });

  // Test 9: Calculate review decision with all approvals
  it('should determine approved decision when all reviewers approve', () => {
    let workflow = initiateReviewWorkflow('task-789', ['backend'], mockReviewers);

    for (const reviewer of workflow.assignedReviewers) {
      workflow = submitReviewFeedback(workflow, reviewer.id, 'approved', 'Approved');
    }

    const decision = calculateReviewDecision(workflow);

    expect(decision.overallStatus).toBe('approved');
    expect(decision.approvalsReceived).toBe(decision.requiredApprovals);
    expect(decision.rationale).toContain('All');
  });

  // Test 10: Calculate review decision with rejection
  it('should determine rejected decision when one reviewer rejects', () => {
    let workflow = initiateReviewWorkflow('task-reject', ['backend'], mockReviewers);
    const rejector = workflow.assignedReviewers[0];

    workflow = submitReviewFeedback(
      workflow,
      rejector.id,
      'rejected',
      'Needs significant changes',
      ['Security risk', 'Performance issue']
    );

    const decision = calculateReviewDecision(workflow);

    expect(decision.overallStatus).toBe('rejected');
    expect(decision.rationale).toContain('rejected');
  });

  // Test 11: Calculate review decision with conditions
  it('should determine approved-with-conditions when reviewers approve with conditions', () => {
    let workflow = initiateReviewWorkflow('task-conditions', ['backend', 'frontend'], mockReviewers);

    for (const reviewer of workflow.assignedReviewers) {
      workflow = submitReviewFeedback(
        workflow,
        reviewer.id,
        'approved-with-conditions',
        'Approved',
        [],
        [],
        [`Address ${reviewer.name} concerns`]
      );
    }

    const decision = calculateReviewDecision(workflow);

    expect(decision.overallStatus).toBe('approved-with-conditions');
    expect(decision.rationale).toContain('condition');
  });

  // Test 12: Check if workflow is ready for merge
  it('should indicate ready for merge when approved', () => {
    let workflow = initiateReviewWorkflow('task-merge', ['backend'], mockReviewers);

    for (const reviewer of workflow.assignedReviewers) {
      workflow = submitReviewFeedback(workflow, reviewer.id, 'approved', 'Approved');
    }

    workflow = finalizeReviewWorkflow(workflow);

    expect(isReadyForMerge(workflow)).toBe(true);
  });

  // Test 13: Check if workflow not ready for merge when rejected
  it('should indicate not ready for merge when rejected', () => {
    let workflow = initiateReviewWorkflow('task-not-merge', ['backend'], mockReviewers);
    const rejector = workflow.assignedReviewers[0];

    workflow = submitReviewFeedback(workflow, rejector.id, 'rejected', 'Not approved');
    workflow = finalizeReviewWorkflow(workflow);

    expect(isReadyForMerge(workflow)).toBe(false);
  });

  // Test 14: Generate review summary report
  it('should generate comprehensive review summary', () => {
    let workflow = initiateReviewWorkflow('task-summary', ['backend', 'frontend'], mockReviewers);

    for (const reviewer of workflow.assignedReviewers) {
      workflow = submitReviewFeedback(
        workflow,
        reviewer.id,
        'approved',
        'Looks good',
        [],
        ['Add tests'],
        []
      );
    }

    const summary = generateReviewSummary(workflow);

    expect(summary).toContain('Review Summary');
    expect(summary).toContain('backend');
    expect(summary).toContain('frontend');
    expect(summary).toContain('Assigned Reviewers');
    expect(summary).toContain('Review Feedback');
    expect(summary.length).toBeGreaterThan(100);
  });

  // Test 15: Get approval conditions from workflow
  it('should extract all approval conditions', () => {
    let workflow = initiateReviewWorkflow('task-conds', ['backend'], mockReviewers);
    const reviewer1 = workflow.assignedReviewers[0];
    const reviewer2 = workflow.assignedReviewers[1];

    workflow = submitReviewFeedback(
      workflow,
      reviewer1.id,
      'approved-with-conditions',
      'Approved',
      [],
      [],
      ['Fix security issue', 'Add logging']
    );

    workflow = submitReviewFeedback(
      workflow,
      reviewer2.id,
      'approved-with-conditions',
      'Approved',
      [],
      [],
      ['Update documentation']
    );

    workflow = finalizeReviewWorkflow(workflow);

    const conditions = getApprovalConditions(workflow);

    expect(conditions.length).toBe(3);
    expect(conditions).toContain('Fix security issue');
    expect(conditions).toContain('Add logging');
    expect(conditions).toContain('Update documentation');
  });

  // Test 16: No review required for frontend-only changes
  it('should complete workflow immediately for no-review changes', () => {
    const workflow = initiateReviewWorkflow('task-no-review', ['frontend']);

    expect(workflow.reviewRequired).toBe(false);
    expect(workflow.workflowStatus).toBe('complete');
    expect(workflow.completedAt).toBeTruthy();
    expect(isReadyForMerge(workflow)).toBe(true);
  });

  // Test 17: Conditional approval status detection
  it('should detect conditional approval status', () => {
    let workflow = initiateReviewWorkflow('task-detect-cond', ['backend'], mockReviewers);

    for (const reviewer of workflow.assignedReviewers) {
      workflow = submitReviewFeedback(
        workflow,
        reviewer.id,
        'approved-with-conditions',
        'Approved',
        [],
        [],
        ['Condition']
      );
    }

    workflow = finalizeReviewWorkflow(workflow);

    expect(hasConditionalApproval(workflow)).toBe(true);
  });

  // Test 18: Error handling for invalid reviewer
  it('should throw error when submitting feedback for non-assigned reviewer', () => {
    const workflow = initiateReviewWorkflow('task-invalid', ['backend'], mockReviewers);

    expect(() => {
      submitReviewFeedback(workflow, 'invalid-reviewer', 'approved', 'Approved');
    }).toThrow();
  });

  // Test 19: Complete workflow finalization
  it('should finalize workflow and set completion timestamp', () => {
    let workflow = initiateReviewWorkflow('task-finalize', ['backend'], mockReviewers);

    for (const reviewer of workflow.assignedReviewers) {
      workflow = submitReviewFeedback(workflow, reviewer.id, 'approved', 'Approved');
    }

    const finalized = finalizeReviewWorkflow(workflow);

    expect(finalized.workflowStatus).toBe('complete');
    expect(finalized.completedAt).toBeTruthy();
    expect(finalized.decision).toBeTruthy();
    expect(finalized.decision?.overallStatus).toBe('approved');
  });

  // Test 20: Multi-layer change review assignment completeness
  it('should assign multiple reviewers for complex multi-layer changes', () => {
    const assigned = assignReviewers(['frontend', 'backend', 'data'], mockReviewers);

    expect(assigned.length).toBeGreaterThan(2);
    // Should have architecture, security, api, and frontend reviewers
    const roles = assigned.map(r => r.role);
    expect(roles).toContain('architecture');
    expect(roles.some(r => ['api', 'security'].includes(r))).toBe(true);
  });
});
