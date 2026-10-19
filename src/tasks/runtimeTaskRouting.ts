import {
  createTaskSpec,
  type DevelopmentLayer,
  type FullStackTaskSpec,
  type TaskClassification,
} from '@barok/core';
import { selectAgentsForTask, type AgentSelection } from '../agents/capabilities/agentSelection.js';
import { normalizeFilePathCandidates } from '@barok/core';

const MAX_ROUTED_FILES = 50;
const MAX_FILE_PATH_LENGTH = 512;

/**
 * The bounded, JSON-safe portion of the typed task contract that is useful to
 * a running server task. It is deliberately smaller than FullStackTaskSpec so
 * run metadata cannot grow with prompts, project maps, or generated plans.
 */
export interface RuntimeTaskRouting {
  classification: TaskClassification;
  estimatedComplexity: FullStackTaskSpec['estimatedComplexity'];
  touchedLayers: DevelopmentLayer[];
  affectedFiles: string[];
  primaryAgents: string[];
  supportingAgents: string[];
  verificationAgents: string[];
  requiredCapabilities: string[];
  confidence: number;
  reasoning: string;
  risks: AgentSelection['risks'];
}

function normalizeAffectedFiles(affectedFiles: string[]): string[] {
  return Array.from(new Set(
    normalizeFilePathCandidates(affectedFiles)
      .filter((file): file is string => typeof file === 'string')
      .map((file) => file.trim().slice(0, MAX_FILE_PATH_LENGTH))
      .filter(Boolean),
  )).slice(0, MAX_ROUTED_FILES);
}

/** Build the canonical typed routing decision used by server-backed runs. */
export function createRuntimeTaskRouting(
  userRequest: string,
  affectedFiles: string[] = [],
): RuntimeTaskRouting {
  const normalizedFiles = normalizeAffectedFiles(affectedFiles);
  const task = createTaskSpec('Runtime task', userRequest, normalizedFiles);
  const selection = selectAgentsForTask(task);

  return {
    classification: task.classification,
    estimatedComplexity: task.estimatedComplexity,
    touchedLayers: task.touchedLayers,
    affectedFiles: normalizedFiles,
    primaryAgents: selection.primaryAgents,
    supportingAgents: selection.supportingAgents,
    verificationAgents: selection.verificationAgents,
    requiredCapabilities: selection.requiredCapabilities,
    confidence: selection.confidence,
    reasoning: selection.reasoning,
    risks: selection.risks,
  };
}
