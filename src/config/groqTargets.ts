import { getConfiguredGroqModel } from './providerRouteSettings.js';
import { getRuntimeGroqApiKey } from './runtimeEnv.js';

export interface GroqModelTarget {
  id: string;
  title: string;
  modelId: string;
  value: string;
}

export const GROQ_MODEL_PREFIX = 'groq:';
const LEGACY_GROQ_TARGET_PATTERN = /^groq-target:key-\d+$/i;

export function getGroqModelValue(modelId = getConfiguredGroqModel()): string {
  return `${GROQ_MODEL_PREFIX}${modelId.trim()}`;
}

export function isLegacyGroqTargetModelValue(model: string): boolean {
  return LEGACY_GROQ_TARGET_PATTERN.test(model.trim());
}

/**
 * Legacy targets encoded a credential index. Migration intentionally discards
 * that identity and resolves to the one configured Groq model route.
 */
export function migrateLegacyGroqModelValue(model: string): string {
  return isLegacyGroqTargetModelValue(model) ? getGroqModelValue() : model;
}

export function getGroqModelTargets(
  configured = Boolean(getRuntimeGroqApiKey()),
  modelId = getConfiguredGroqModel(),
): GroqModelTarget[] {
  if (!configured || !modelId.trim()) return [];
  return [{
    id: 'default',
    title: 'Groq Provider',
    modelId: modelId.trim(),
    value: getGroqModelValue(modelId),
  }];
}
