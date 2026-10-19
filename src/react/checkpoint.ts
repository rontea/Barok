import { fingerprintWorkspace as nodeFingerprintWorkspace } from '@barok/adapter-node';
import {
  REACT_CHECKPOINT_HANDOFF_VERSION,
  REACT_CHECKPOINT_VERSION,
  attachReactCheckpointHandoff as attachEngineCheckpointHandoff,
  createReactCheckpoint as createEngineReactCheckpoint,
  isCheckpointWorkspaceFresh as isEngineCheckpointWorkspaceFresh,
  prepareReactRepairState as prepareEngineRepairState,
  prepareReactResumeState as prepareEngineResumeState,
  prepareReactWorkspaceRebaseState as prepareEngineWorkspaceRebaseState,
  validateReactCheckpoint as validateEngineReactCheckpoint,
} from '@barok/engine';
import type {
  ReactCheckpoint as EngineReactCheckpoint,
  ReactCheckpointHandoff as EngineReactCheckpointHandoff,
  ReactRepairOptions,
  ReactResumeOptions,
  WorkspaceFingerprint,
  WorkspaceFingerprintEntry,
  WorkspaceFingerprintProvider,
} from '@barok/engine';
import type { ReactState } from './state-manager.js';

export { REACT_CHECKPOINT_HANDOFF_VERSION, REACT_CHECKPOINT_VERSION };
export { fingerprintWorkspace } from '@barok/adapter-node';
export type {
  ReactCheckpointEvidenceWindow,
  ReactCheckpointHandoff,
  ReactCheckpointRequestIdentity,
  ReactProgressCursor,
  WorkspaceFingerprint,
  WorkspaceFingerprintEntry,
  WorkspaceFingerprintProvider,
} from '@barok/engine';
export type { ReactRepairOptions, ReactResumeOptions };
export type ReactCheckpoint = EngineReactCheckpoint<ReactState>;

/** Compatibility facade that supplies the existing Barok Node fingerprint default. */
export function createReactCheckpoint(
  state: ReactState,
  fingerprint: WorkspaceFingerprintProvider = nodeFingerprintWorkspace,
): ReactCheckpoint {
  return createEngineReactCheckpoint(state, fingerprint);
}

export function attachReactCheckpointHandoff(
  checkpoint: ReactCheckpoint,
  handoff: EngineReactCheckpointHandoff,
): ReactCheckpoint {
  return attachEngineCheckpointHandoff(checkpoint, handoff);
}

export function prepareReactResumeState(
  state: ReactState,
  freshStepBudget = 40,
  now = Date.now(),
  options: ReactResumeOptions = {},
): ReactState {
  return prepareEngineResumeState(state, freshStepBudget, now, options);
}

export function prepareReactRepairState(
  state: ReactState,
  options: ReactRepairOptions,
  now = Date.now(),
): ReactState {
  return prepareEngineRepairState(state, options, now);
}

export function prepareReactWorkspaceRebaseState(
  state: ReactState,
  freshStepBudget = 40,
  now = Date.now(),
): ReactState {
  return prepareEngineWorkspaceRebaseState(state, freshStepBudget, now);
}

export function validateReactCheckpoint(checkpoint: unknown): checkpoint is ReactCheckpoint {
  return validateEngineReactCheckpoint(checkpoint);
}

export function isCheckpointWorkspaceFresh(
  checkpoint: ReactCheckpoint,
  fingerprint: WorkspaceFingerprintProvider = nodeFingerprintWorkspace,
): boolean {
  return isEngineCheckpointWorkspaceFresh(checkpoint, fingerprint);
}
