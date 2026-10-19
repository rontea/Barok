import { createHash } from 'node:crypto';
import {
  assessVerification,
  createCoordinatedVerificationPlan,
  decideVerificationRepair,
  reviewVerification,
  type RepairDecision,
  type VerificationObservation,
} from '@barok/engine';

export {
  assessVerification,
  createCoordinatedVerificationPlan,
  reviewVerification,
};
export type {
  CoordinatedVerificationPlan,
  RepairDecision,
  RequirementEvidence,
  VerificationCommandStatus,
  VerificationDecision,
  VerificationObservation,
} from '@barok/engine';

/** Preserve the former Node-backed API while the ReAct loop supplies its host hash port. */
export function decideRepair(
  observation: VerificationObservation,
  priorSignatures: string[],
  maxAttempts = 2,
): RepairDecision {
  return decideVerificationRepair(
    observation,
    priorSignatures,
    (serialized) => createHash('sha256').update(serialized, 'utf8').digest('hex'),
    maxAttempts,
  );
}
