export interface GeminiModelMetadata {
  provider: 'gemini';
  modelId: string;
  label: string;
  supportsStreaming: boolean;
  supportsTools: boolean;
  /** False for models whose API rejects legacy temperature/top-p controls. */
  supportsSamplingParameters?: boolean;
  inputModalities: Array<'text' | 'image' | 'audio' | 'video'>;
  outputModalities: Array<'text' | 'audio'>;
  freeTier: boolean;
  defaultParams: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
  };
  uiSelectable: boolean;
  description: string;
}

/** Current stable Gemini text model used as the native provider default. */
export const GEMINI_DEFAULT_MODEL_ID = 'gemini-3.6-flash';

/**
 * Model ids that were accepted by older target catalogs but are no longer
 * usable by the configured Gemini accounts. Keep the replacement explicit so
 * saved targets can be migrated without breaking their target id.
 */
export const GEMINI_MODEL_MIGRATIONS: Record<string, string> = {
  'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite',
};

/** Ordered same-provider recovery models, from newest to most conservative. */
export const GEMINI_SAME_PROVIDER_FALLBACK_MODEL_IDS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
] as const;

export const GEMINI_FREE_MODEL_REGISTRY: Record<string, GeminiModelMetadata> = {
  'gemini-3.6-flash': {
    provider: 'gemini',
    modelId: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    supportsStreaming: true,
    supportsTools: true,
    supportsSamplingParameters: false,
    inputModalities: ['text', 'image', 'audio', 'video'],
    outputModalities: ['text'],
    freeTier: true,
    defaultParams: { maxTokens: 4096 },
    uiSelectable: true,
    description: 'Current GA Gemini Flash model for agentic and multimodal work.',
  },
  'gemini-3.5-flash-lite': {
    provider: 'gemini',
    modelId: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    supportsStreaming: true,
    supportsTools: true,
    supportsSamplingParameters: false,
    inputModalities: ['text', 'image', 'audio', 'video'],
    outputModalities: ['text'],
    freeTier: true,
    defaultParams: { maxTokens: 4096 },
    uiSelectable: true,
    description: 'Current GA Gemini Flash-Lite model for fast, high-volume work.',
  },
  'gemini-3.5-flash': {
    provider: 'gemini',
    modelId: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text', 'image', 'audio', 'video'],
    outputModalities: ['text'],
    freeTier: true,
    defaultParams: { temperature: 0.2, maxTokens: 4096, topP: 0.95 },
    uiSelectable: true,
    description: 'Free-tier Gemini Flash model for fast multimodal text generation.',
  },
  'gemini-3.1-flash-lite': {
    provider: 'gemini',
    modelId: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash-Lite',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text', 'image', 'audio', 'video'],
    outputModalities: ['text'],
    freeTier: true,
    defaultParams: { temperature: 0.2, maxTokens: 4096, topP: 0.95 },
    uiSelectable: true,
    description: 'Free-tier high-volume Gemini model for lightweight agent work.',
  },
  'gemini-3.1-pro-preview': {
    provider: 'gemini',
    modelId: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro Preview',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text', 'image', 'audio', 'video'],
    outputModalities: ['text'],
    // Google documents this preview as API-accessible but not free-tier.
    freeTier: false,
    defaultParams: { temperature: 0.2, maxTokens: 4096, topP: 0.95 },
    uiSelectable: true,
    description: 'Preview Gemini Pro model for complex reasoning and coding tasks.',
  },
  'gemini-3-flash-preview': {
    provider: 'gemini',
    modelId: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash Preview',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text', 'image', 'audio', 'video'],
    outputModalities: ['text'],
    freeTier: true,
    defaultParams: { temperature: 0.2, maxTokens: 4096, topP: 0.95 },
    uiSelectable: true,
    description: 'Free-tier Gemini 3 Flash preview model for text generation.',
  },
  'gemini-2.5-pro': {
    provider: 'gemini',
    modelId: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text', 'image', 'audio', 'video'],
    outputModalities: ['text'],
    freeTier: true,
    defaultParams: { temperature: 0.2, maxTokens: 4096, topP: 0.95 },
    uiSelectable: true,
    description: 'Free-tier Gemini Pro model for complex reasoning and coding tasks.',
  },
  'gemini-2.5-flash': {
    provider: 'gemini',
    modelId: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text', 'image', 'audio', 'video'],
    outputModalities: ['text'],
    freeTier: true,
    defaultParams: { temperature: 0.2, maxTokens: 4096, topP: 0.95 },
    uiSelectable: true,
    description: 'Free-tier Gemini Flash model with a 1M token context window.',
  },
  'gemini-2.5-flash-lite': {
    provider: 'gemini',
    modelId: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash-Lite',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text', 'image', 'audio', 'video'],
    outputModalities: ['text'],
    freeTier: true,
    defaultParams: { temperature: 0.2, maxTokens: 4096, topP: 0.95 },
    uiSelectable: true,
    description: 'Free-tier low-cost Gemini model for high-throughput text generation.',
  },
};

const RETIRED_GEMINI_MODEL_IDS = new Set([
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3-flash-preview',
  'gemini-2.5-flash-lite-preview-09-2025',
]);

export function normalizeGeminiModelId(model: string): string {
  return model.trim().toLowerCase();
}

export function getGeminiModelMigration(model: string): string {
  const normalized = normalizeGeminiModelId(model);
  return GEMINI_MODEL_MIGRATIONS[normalized] || normalized;
}

export function getGeminiModelMetadata(model: string): GeminiModelMetadata | undefined {
  return GEMINI_FREE_MODEL_REGISTRY[normalizeGeminiModelId(model)];
}

export function isRetiredGeminiModel(model: string): boolean {
  return RETIRED_GEMINI_MODEL_IDS.has(normalizeGeminiModelId(model));
}

export function supportsGeminiSamplingParameters(model: string): boolean {
  return getGeminiModelMetadata(model)?.supportsSamplingParameters !== false;
}

export function getGeminiFreeChatModelIds(): string[] {
  return Object.values(GEMINI_FREE_MODEL_REGISTRY)
    .filter((model) => model.freeTier && model.uiSelectable && model.outputModalities.includes('text'))
    .filter((model) => !isRetiredGeminiModel(model.modelId))
    .map((model) => model.modelId);
}

/**
 * Safe, same-account recovery order for a Gemini request. This deliberately
 * excludes the selected model so the composite router never repeats a model
 * that has just failed before trying the next compatible Gemini route.
 */
export function getGeminiSameProviderFallbackModelIds(model: string): string[] {
  const selectedModel = normalizeGeminiModelId(model);
  return GEMINI_SAME_PROVIDER_FALLBACK_MODEL_IDS.filter((candidate) =>
    candidate !== selectedModel && Boolean(getGeminiModelMetadata(candidate)?.supportsTools),
  );
}
