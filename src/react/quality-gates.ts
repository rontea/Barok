/** Compatibility facade for generated-app quality gate rules in @barok/engine. */
export {
  allCriticalGatesPassed,
  allRequiredGatesPassed,
  calculateQualityScore,
  checkQualityGates,
  formatQualityGates,
  getCriticalFailedGates,
  getFailedGates,
} from '@barok/engine';
export type { QualityGate, QualityGateCheckData, QualityGateResult, QualityGateType } from '@barok/engine';
