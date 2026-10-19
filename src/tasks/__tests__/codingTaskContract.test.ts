import { describe, expect, it } from '@jest/globals';
import {
  CODING_TASK_CONTRACT_VERSION,
  createCodingTaskContract,
  createCodingTaskContractFromFullStackTaskSpec,
  validateCodingTaskContract,
} from '../codingTaskContract.js';

const baseInput = {
  id: 'analysis-1',
  originalRequest: 'Implement Phase 1 and mark the TODO done.',
  resolvedRequest: 'Implement Phase 1 and mark the TODO done.',
  taskKind: 'new_feature',
  behaviorScope: 'new_behavior',
  expectedChangeIntent: 'modify',
  workspace: 'C:/workspace',
  candidateFiles: ['src/feature.ts', 'TODO.md'],
  approvalPolicy: 'ask' as const,
  requiresApproval: true,
  validationRequirements: ['Read target files first.'],
  verificationPlan: ['npm run test:unit'],
  riskLevel: 'medium',
};

describe('CodingTaskContract', () => {
  it('creates a versioned contract with explicit completion evidence', () => {
    const contract = createCodingTaskContract(baseInput);

    expect(contract.contractVersion).toBe(CODING_TASK_CONTRACT_VERSION);
    expect(contract.requestedOutcome).toMatch(/Implement the requested behavior/i);
    expect(contract.behaviorIntent).toBe('add_new_behavior');
    expect(contract.todoAction).toBe('implement_then_update');
    expect(contract.requirementSources).toEqual(['TODO.md']);
    expect(contract.candidateFiles).toEqual(['src/feature.ts']);
    expect(contract.completionEvidenceRequirements.requireSourceMutationForFeatureCompletion).toBe(true);
    expect(contract.completionEvidenceRequirements.requireVerificationForCompletion).toBe(true);
    expect(contract.acceptanceCriteria.map((criterion) => criterion.id)).toEqual(
      expect.arrayContaining(['requested-outcome', 'scope-preserved', 'todo-backed-implementation'])
    );
    expect(validateCodingTaskContract(contract)).toEqual([]);
  });

  it('keeps documentation-only TODO work separate from implementation work', () => {
    const contract = createCodingTaskContract({
      ...baseInput,
      taskKind: 'docs_only',
      originalRequest: 'Mark the Phase 1 TODO as done.',
      resolvedRequest: 'Mark the Phase 1 TODO as done.',
      expectedChangeIntent: 'modify',
    });

    expect(contract.todoAction).toBe('documentation_only');
    expect(contract.acceptanceCriteria.map((criterion) => criterion.id)).not.toContain('todo-backed-implementation');
    expect(contract.completionEvidenceRequirements.requireSourceMutationForFeatureCompletion).toBe(false);
  });

  it.each(['bug_fix', 'refactor', 'test_only'])('requires source mutation evidence for mutable %s work', (taskKind) => {
    const contract = createCodingTaskContract({
      ...baseInput,
      taskKind,
      originalRequest: `Apply the ${taskKind} and verify it.`,
      resolvedRequest: `Apply the ${taskKind} and verify it.`,
      expectedChangeIntent: 'modify',
    });

    expect(contract.completionEvidenceRequirements.requireSourceMutationForFeatureCompletion).toBe(true);
  });

  it('marks historical conversation claims as untrusted', () => {
    const contract = createCodingTaskContract({ ...baseInput, taskKind: 'continuation' });

    expect(contract.behaviorIntent).toBe('continue_prior_work');
    expect(contract.historicalClaims[0].trust).toBe('untrusted');
    expect(contract.nonGoals.join('\n')).toMatch(/current evidence/i);
  });

  it('creates a blocker for an unresolved ambiguous request', () => {
    const contract = createCodingTaskContract({
      ...baseInput,
      taskKind: 'question',
      expectedChangeIntent: 'unknown',
      originalRequest: 'make it better',
      resolvedRequest: 'make it better',
    });

    expect(contract.blocker?.code).toBe('ambiguous_request');
    expect(contract.blocker?.resolution).toMatch(/intended/i);
  });

  it('adapts the existing FullStackTaskSpec without changing its fields', () => {
    const contract = createCodingTaskContractFromFullStackTaskSpec({
      id: 'task-1',
      title: 'Add feature',
      description: 'Add the feature and verify it.',
      userRequest: 'Add the feature.',
      targetSurfaces: ['App'],
      affectedFiles: ['src/App.tsx'],
      acceptanceCriteria: [{ description: 'Feature works', verifiable: true, required: true }],
      verificationPlan: { criteria: [], commands: ['npm run test:unit'], manualReview: false },
      classification: 'feature',
      touchedLayers: ['frontend'],
      ownershipPlan: [],
      canRunInParallel: false,
      parallelCompatibleWith: [],
      dependencies: [],
      implementationOrder: ['coder'],
      verificationTasks: ['tests'],
      sequentialSteps: [],
      estimatedComplexity: 'simple',
      requiresManualReview: false,
      createdAt: 1,
    });

    expect(contract.id).toBe('task-1');
    expect(contract.taskKind).toBe('new_feature');
    expect(contract.candidateFiles).toEqual(['src/App.tsx']);
    expect(contract.verificationRequirements).toEqual(['npm run test:unit']);
    expect(validateCodingTaskContract(contract)).toEqual([]);
  });
});
