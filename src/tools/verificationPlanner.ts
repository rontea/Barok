/** Compatibility facade for the Engine-owned verification planner. */
export {
  calculateConfidence,
  createPlannedRepairTask as createRepairTask,
  createVerificationPlan,
  createVerificationResult,
  estimateChecksDuration,
  generateRequestId,
  generateTaskId,
  getCriticalChecks,
  getOptionalChecks,
  getSuggestedActions,
  getVerificationSummary,
  shouldStopVerification,
} from '@barok/engine';
export type {
  CheckResult,
  CheckType,
  PlannerRepairTask as RepairTask,
  PlannerVerificationResult as VerificationResult,
  VerificationPlan,
} from '@barok/engine';
