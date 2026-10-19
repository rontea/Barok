import type { FullStackTaskSpec } from './taskSpec.js';

/**
 * Versioned task meaning shared by analysis, execution, persistence, and UI.
 *
 * `CoderTaskAnalysis` remains the compatibility shape exposed by the existing
 * API. This contract is the authoritative, additive representation used by
 * new code and can be adapted back to the legacy shape without data loss.
 */

export const CODING_TASK_CONTRACT_VERSION = 1 as const;

export type CodingTaskBehaviorIntent =
  | 'answer'
  | 'inspect'
  | 'fix_existing_behavior'
  | 'add_new_behavior'
  | 'maintain_structure'
  | 'continue_prior_work'
  | 'documentation_only';

export type CodingTaskTodoAction = 'none' | 'implement_then_update' | 'documentation_only';

export interface CodingTaskCriterion {
  id: string;
  description: string;
  required: boolean;
  source: 'user_request' | 'todo' | 'analysis' | 'verification';
}

export interface CodingTaskPermissions {
  workspace: string;
  canInspect: boolean;
  canMutate: boolean;
  canRunCommands: boolean;
  approvalPolicy: 'ask' | 'auto_approve' | 'full_access';
}

export interface CodingTaskEvidenceRequirements {
  requireRelevantInspectionBeforeMutation: boolean;
  requireSourceMutationForFeatureCompletion: boolean;
  requireVerificationForCompletion: boolean;
  requireRequirementMapping: boolean;
  requiredChecks: string[];
}

export interface CodingTaskHistoricalClaim {
  claim: string;
  trust: 'untrusted';
  reason: string;
}

export interface CodingTaskBlocker {
  code: 'missing_workspace' | 'workspace_mismatch' | 'missing_acceptance_criteria' | 'ambiguous_request' | 'permission_required';
  message: string;
  resolution: string;
}

export interface CodingTaskContract {
  contractVersion: typeof CODING_TASK_CONTRACT_VERSION;
  id: string;
  originalRequest: string;
  resolvedRequest: string;
  requestedOutcome: string;
  behaviorIntent: CodingTaskBehaviorIntent;
  taskKind: string;
  workspace: string;
  candidateFiles: string[];
  requirementSources: string[];
  acceptanceCriteria: CodingTaskCriterion[];
  permissions: CodingTaskPermissions;
  nonGoals: string[];
  verificationRequirements: string[];
  completionEvidenceRequirements: CodingTaskEvidenceRequirements;
  todoAction: CodingTaskTodoAction;
  historicalClaims: CodingTaskHistoricalClaim[];
  blocker?: CodingTaskBlocker;
}

export interface CodingTaskContractInput {
  id: string;
  originalRequest: string;
  resolvedRequest: string;
  taskKind: string;
  behaviorScope: string;
  expectedChangeIntent: string;
  workspace: string;
  candidateFiles: string[];
  approvalPolicy: CodingTaskPermissions['approvalPolicy'];
  requiresApproval: boolean;
  validationRequirements: string[];
  verificationPlan: string[];
  riskLevel: string;
  blocker?: CodingTaskBlocker;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isTodoRequest(request: string): boolean {
  return /\b(todo|todos|checklist|task list)\b/i.test(request);
}

function isDocumentationOnly(taskKind: string): boolean {
  return taskKind === 'docs_only';
}

function isRequirementSource(file: string): boolean {
  return /(^|\/)(todo|todos|checklist|task-list)(\/|\.|$)/i.test(file) ||
    /(^|\/)(TODO|CHECKLIST)(?:\.\w+)?$/i.test(file) ||
    /\.(?:pdf|docx)$/i.test(file);
}

function behaviorIntentFor(input: CodingTaskContractInput): CodingTaskBehaviorIntent {
  if (input.expectedChangeIntent === 'read_only') return input.taskKind === 'question' ? 'answer' : 'inspect';
  if (input.taskKind === 'continuation') return 'continue_prior_work';
  if (isDocumentationOnly(input.taskKind)) return 'documentation_only';
  if (input.taskKind === 'bug_fix') return 'fix_existing_behavior';
  if (input.taskKind === 'new_feature') return 'add_new_behavior';
  return 'maintain_structure';
}

function requestedOutcomeFor(input: CodingTaskContractInput): string {
  if (input.expectedChangeIntent === 'read_only') return 'Provide an evidence-based answer from the inspected workspace without making changes.';
  if (input.taskKind === 'bug_fix') return 'Correct the reported existing behavior and verify the correction.';
  if (input.taskKind === 'new_feature') return 'Implement the requested behavior, preserve unrelated behavior, and verify it.';
  if (isDocumentationOnly(input.taskKind)) return 'Update only the requested documentation or tracker content.';
  if (input.taskKind === 'continuation') return 'Continue the previously approved workspace task and finish its remaining verified work.';
  return 'Complete the requested scoped workspace change and verify the result.';
}

function acceptanceCriteriaFor(input: CodingTaskContractInput): CodingTaskCriterion[] {
  const criteria: CodingTaskCriterion[] = [
    {
      id: 'requested-outcome',
      description: requestedOutcomeFor(input),
      required: true,
      source: 'user_request',
    },
  ];

  if (input.expectedChangeIntent !== 'read_only') {
    criteria.push({
      id: 'scope-preserved',
      description: 'Keep mutations limited to the requested scope and candidate files unless new evidence justifies expansion.',
      required: true,
      source: 'analysis',
    });
  }

  if (isTodoRequest(input.resolvedRequest) && !isDocumentationOnly(input.taskKind)) {
    criteria.push({
      id: 'todo-backed-implementation',
      description: 'Implement and verify the underlying work before updating its TODO or checklist status.',
      required: true,
      source: 'todo',
    });
  }

  return criteria;
}

export function createCodingTaskContract(input: CodingTaskContractInput): CodingTaskContract {
  const readOnly = input.expectedChangeIntent === 'read_only';
  const todoAction: CodingTaskTodoAction = !isTodoRequest(input.resolvedRequest)
    ? 'none'
    : isDocumentationOnly(input.taskKind)
      ? 'documentation_only'
      : 'implement_then_update';

  const inferredBlocker = input.taskKind === 'question' &&
    (!input.resolvedRequest.trim() || input.expectedChangeIntent === 'unknown')
    ? {
        code: 'ambiguous_request' as const,
        message: 'No actionable request was resolved.',
        resolution: 'Provide the intended question or workspace outcome.',
      }
    : undefined;
  const blocker = input.blocker ?? inferredBlocker;

  return {
    contractVersion: CODING_TASK_CONTRACT_VERSION,
    id: input.id,
    originalRequest: input.originalRequest,
    resolvedRequest: input.resolvedRequest,
    requestedOutcome: requestedOutcomeFor(input),
    behaviorIntent: behaviorIntentFor(input),
    taskKind: input.taskKind,
    workspace: input.workspace,
    candidateFiles: unique(input.candidateFiles).filter((file) => isDocumentationOnly(input.taskKind) || !isRequirementSource(file)),
    requirementSources: unique(input.candidateFiles).filter(isRequirementSource),
    acceptanceCriteria: acceptanceCriteriaFor(input),
    permissions: {
      workspace: input.workspace,
      canInspect: true,
      canMutate: !readOnly,
      canRunCommands: !readOnly,
      approvalPolicy: input.approvalPolicy,
    },
    nonGoals: [
      'Do not claim historical work as current evidence without checking the workspace.',
      ...(readOnly ? ['Do not mutate files or claim file changes.'] : ['Do not make unrelated changes outside the task scope.']),
    ],
    verificationRequirements: unique(input.verificationPlan),
    completionEvidenceRequirements: {
      requireRelevantInspectionBeforeMutation: !readOnly,
      // Every mutable task needs an objective source change before it can be
      // reported complete.  The previous feature-only rule let bug fixes and
      // refactors finish after inspection alone, which encouraged endless
      // reads without ever addressing the requested change.
      requireSourceMutationForFeatureCompletion: !readOnly && !isDocumentationOnly(input.taskKind),
      requireVerificationForCompletion: !readOnly && input.riskLevel !== 'low',
      requireRequirementMapping: true,
      requiredChecks: unique(input.verificationPlan),
    },
    todoAction,
    historicalClaims: [
      {
        claim: 'Prior conversation, plan, or completion statements describe intent only until current workspace evidence confirms them.',
        trust: 'untrusted',
        reason: 'Filesystem and tool evidence are authoritative for current state.',
      },
    ],
    blocker,
  };
}

export function validateCodingTaskContract(contract: CodingTaskContract): string[] {
  const errors: string[] = [];
  if (contract.contractVersion !== CODING_TASK_CONTRACT_VERSION) errors.push('Unsupported coding task contract version.');
  if (!contract.id.trim()) errors.push('Contract id is required.');
  if (!contract.originalRequest.trim()) errors.push('Original request is required.');
  if (!contract.resolvedRequest.trim()) errors.push('Resolved request is required.');
  if (!contract.workspace.trim()) errors.push('Workspace is required.');
  if (contract.acceptanceCriteria.length === 0) errors.push('At least one acceptance criterion is required.');
  if (contract.completionEvidenceRequirements.requiredChecks.some((check) => !contract.verificationRequirements.includes(check))) {
    errors.push('Required checks must be present in verification requirements.');
  }
  if (contract.todoAction === 'implement_then_update' && !contract.completionEvidenceRequirements.requireSourceMutationForFeatureCompletion) {
    errors.push('TODO implementation contracts must require source mutation evidence.');
  }
  return errors;
}

/** Adapt the existing orchestration spec without forcing a breaking migration. */
export function createCodingTaskContractFromFullStackTaskSpec(spec: FullStackTaskSpec): CodingTaskContract {
  const expectedChangeIntent = spec.classification === 'investigation' ? 'read_only' : 'modify';
  const taskKind = spec.classification === 'feature' ? 'new_feature' : spec.classification;
  const verificationPlan = spec.verificationPlan.commands.length > 0
    ? spec.verificationPlan.commands
    : spec.acceptanceCriteria.filter((criterion) => criterion.required).map((criterion) => criterion.description);

  const contract = createCodingTaskContract({
    id: spec.id,
    originalRequest: spec.userRequest,
    resolvedRequest: spec.description || spec.userRequest,
    taskKind,
    behaviorScope: expectedChangeIntent === 'read_only' ? 'read_only' : 'maintenance',
    expectedChangeIntent,
    workspace: 'unspecified',
    candidateFiles: spec.affectedFiles,
    approvalPolicy: 'ask',
    requiresApproval: expectedChangeIntent !== 'read_only',
    validationRequirements: spec.acceptanceCriteria.map((criterion) => criterion.description),
    verificationPlan,
    riskLevel: spec.requiresManualReview ? 'high' : 'medium',
  });

  contract.acceptanceCriteria = spec.acceptanceCriteria.map((criterion, index) => ({
    id: `spec-criterion-${index + 1}`,
    description: criterion.description,
    required: criterion.required,
    source: 'user_request',
  }));
  contract.nonGoals.push('Do not change ownership, dependency, or sequencing metadata while implementing this task.');
  return contract;
}

// Kept as a narrow compatibility helper for callers that only have legacy fields.
export function contractCandidateFiles(contract: CodingTaskContract): string[] {
  return [...contract.candidateFiles];
}
