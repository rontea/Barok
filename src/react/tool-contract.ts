/**
 * Node-backed compatibility facade for Engine's tool evidence contracts.
 * Engine callers provide an ID source; Barok's app keeps its UUID default here.
 */
import { randomUUID } from 'crypto';
import { ToolEvidenceLedger as EngineToolEvidenceLedger } from '@barok/engine';

export {
  actionSignature,
  getToolTargetResources,
  normalizeToolResult,
  parseStructuredToolResult,
  safeJsonStringify,
  serializeToolResult,
  stableJson,
  summarizeToolOutput,
  ToolExecutionScheduler,
  ToolExecutionState,
} from '@barok/engine';
export type {
  CanonicalToolResult,
  HarnessInterventionEvidence,
  HarnessInterventionGateName,
  StructuredToolResult,
  ToolEvidenceRecord,
  ToolEvidenceStatus,
  ToolExecutionStatus,
  ToolInvocation,
} from '@barok/engine';

export class ToolEvidenceLedger extends EngineToolEvidenceLedger {
  constructor(createId: () => string = randomUUID) {
    super(createId);
  }
}
