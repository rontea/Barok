/** Compatibility entry retained for existing Barok app imports. */
export type {
  CodingTaskBehaviorIntent,
  CodingTaskTodoAction,
  CodingTaskCriterion,
  CodingTaskPermissions,
  CodingTaskEvidenceRequirements,
  CodingTaskHistoricalClaim,
  CodingTaskBlocker,
  CodingTaskContract,
  CodingTaskContractInput,
} from '@barok/core';

export {
  CODING_TASK_CONTRACT_VERSION,
  createCodingTaskContract,
  createCodingTaskContractFromFullStackTaskSpec,
  validateCodingTaskContract,
  contractCandidateFiles,
} from '@barok/core';
