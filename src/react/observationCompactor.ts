import {
  compactObservation as compactEngineObservation,
  getObservationCompactionMetrics as getEngineObservationCompactionMetrics,
  type ObservationCompactionOptions,
  type ObservationCompactionSerialization,
} from '@barok/engine';
import { jsonParse, jsonStringify } from '../utils/slowOperations.js';

export {
  CHARS_PER_TOKEN,
  FREE_TIER_COMPACTION_RATIO,
  OBSERVATION_COMPACTION_VERSION,
  freeTierCompactionThreshold,
} from '@barok/engine';
export type {
  CompactedObservation,
  CompactionMetrics,
  ObservationCompactionLimits,
  ObservationCompactionOptions,
  ObservationCompactionResult,
  ObservationCompactionSerialization,
  ObservationCompactorKind,
  PersistedArtifactMetadata,
} from '@barok/engine';

const nodeSerialization: ObservationCompactionSerialization = {
  parse: <T = unknown>(text: string): T => jsonParse<T>(text),
  stringify: (value) => jsonStringify(value),
};

export function compactObservation(
  toolName: string,
  toolInput: Record<string, unknown> = {},
  serializedObservation: string,
  options: ObservationCompactionOptions = {},
) {
  return compactEngineObservation(toolName, toolInput, serializedObservation, {
    ...options,
    serialization: options.serialization ?? nodeSerialization,
  });
}

export function getObservationCompactionMetrics(observation: string) {
  return getEngineObservationCompactionMetrics(observation, nodeSerialization);
}
