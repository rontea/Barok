/** Compatibility facade for generated-app contracts and manifest helpers. */

import { getWorkspaceRelativePath } from '@barok/adapter-node';
import {
  extractSuccessfulWorkspaceOutputs as extractWithResolver,
  type WorkspaceOutputEvidenceStep,
} from '@barok/engine';

export {
  createManifest,
  generateManifestId,
  type AppManifest,
  type GeneratedAppVerificationCheck as VerificationCheck,
  type VerificationQualityGate,
  type VerificationResult,
  type VerificationSignal,
} from '@barok/engine';

/** Preserve the former app helper signature while supplying its Node resolver. */
export function extractSuccessfulWorkspaceOutputs(
  steps: WorkspaceOutputEvidenceStep[],
  workspace = '.',
): string[] {
  return extractWithResolver(steps, workspace, getWorkspaceRelativePath);
}
