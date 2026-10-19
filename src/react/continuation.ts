/** Compatibility facade for Engine's host-neutral continuation handoff rules. */
export {
  CONTINUATION_HANDOFF_VERSION,
  createContinuationHandoff,
  isContinuationHandoff,
  isContinuationReason,
  measureContinuationQuality,
  summarizeContinuationState,
} from '@barok/engine';
export type {
  ContinuationHandoff,
  ContinuationHandoffPreview,
  ContinuationLastRun,
  ContinuationPlanItem,
  ContinuationQualityMetrics,
  ContinuationReason,
  ContinuationState,
  ContinuationStep,
} from '@barok/engine';
