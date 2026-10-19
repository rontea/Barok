/**
 * Tasks Module Exports
 * Full-stack task specification, classification, and orchestration
 */

export type {
  TaskClassification,
  DevelopmentLayer,
  FileOwnershipPlan,
  TaskDependency,
  AcceptanceCriterion,
  VerificationPlan,
  FullStackTaskSpec,
} from '@barok/core';

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

export {
  classifyTask,
  detectTouchedLayers,
  canRunInParallel,
  detectParallelCompatibility,
  orderTasksByDependency,
  estimateComplexity,
  createTaskSpec,
} from '@barok/core';
