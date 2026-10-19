import { getOpenRouterTargetModelValue } from './openRouterTargets.js';
import { getConfiguredOpenRouterModel } from './providerRouteSettings.js';
import { DEFAULT_CODER_MODEL_SELECTION } from './providerSelection.js';

/**
 * Resolve the model used by coder/agent entry points when the request does
 * not explicitly provide one. API Pool > OpenRouter is authoritative; the
 * shared constant is only a first-install fallback.
 */
export function getConfiguredCoderModelSelection(): string {
  const configuredModel = getConfiguredOpenRouterModel().trim();
  return configuredModel
    ? getOpenRouterTargetModelValue(configuredModel)
    : DEFAULT_CODER_MODEL_SELECTION;
}
