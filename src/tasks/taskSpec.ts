/** Compatibility entry retained for existing Barok app imports. */
export type {
  TaskClassification,
  DevelopmentLayer,
  FileOwnershipPlan,
  TaskDependency,
  AcceptanceCriterion,
  VerificationPlan,
  FullStackTaskSpec,
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
