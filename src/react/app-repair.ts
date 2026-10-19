/** Compatibility facade for Engine repair policy and adapter-node discovery. */
export {
  analyzeFailures,
  createRepairTask,
  formatRepairPrompt,
  getRepairSuccessLikelihood,
  shouldRepair,
  type RepairAppSpecInput,
  type RepairCheck,
  type RepairManifestInput,
  type RepairPlan,
  type RepairQualityGate,
  type RepairSuggestion,
  type RepairVerificationResult,
} from '@barok/engine';
export { discoverVerificationRepairFiles } from '@barok/adapter-node';
