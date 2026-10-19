import { GEMINI_FREE_MODEL_REGISTRY, isRetiredGeminiModel, type GeminiModelMetadata } from './geminiModels.js';
import {
  getNvidiaModelReplacement,
  NVIDIA_MODEL_REGISTRY,
  type NvidiaModelMetadata,
} from './nvidiaModels.js';
import { resolveModelContextWindow } from './modelConfig.js';
import { getSavedPollinationsModelCatalog, type PollinationsModel } from './pollinationsModels.js';

export type ModelCapabilityValue = 'yes' | 'no' | 'unknown';
export type ModelArchitecture = 'MoE' | 'Dense' | 'Unknown';
export type ModelCapabilityKey =
  | 'reasoning'
  | 'toolCalling'
  | 'vision'
  | 'streaming'
  | 'coding'
  | 'longContext'
  | 'structuredOutput';

export type ModelCapabilityProvider =
  | 'nvidia'
  | 'gemini'
  | 'openrouter'
  | 'groq'
  | 'cerebras'
  | 'sambanova'
  | 'kimi'
  | 'requesty'
  | 'local'
  | 'colab'
  | 'pollinations'
  | 'unknown';

export interface ModelCapabilityProfile {
  provider: ModelCapabilityProvider;
  modelId: string;
  label: string;
  description?: string;
  architecture: ModelArchitecture;
  capabilities: Record<ModelCapabilityKey, ModelCapabilityValue>;
  contextWindow?: number;
  engineUsage: {
    reasoning: 'react-planner' | 'provider-native' | 'unknown';
    toolCalling: 'native' | 'structured-text' | 'unknown';
    architecture: 'automatic';
  };
  notes: string[];
  /** Provider/API details that are useful when inspecting a configured route. */
  apiFamily?: string;
  endpoint?: string;
  baseApi?: string;
  routeId?: string;
  credentialIndex?: number;
  inputModalities?: string[];
  outputModalities?: string[];
  defaultParams?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
  };
  maxOutputTokens?: number;
  supportsSamplingParameters?: boolean;
  freeTier?: boolean;
  source?: 'provider-registry' | 'provider-catalog' | 'configured-route' | 'unknown';
  configuredParams?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    stream?: boolean;
  };
}

const CAPABILITY_KEYS: ModelCapabilityKey[] = [
  'reasoning',
  'toolCalling',
  'vision',
  'streaming',
  'coding',
  'longContext',
  'structuredOutput',
];

function yesNo(value: boolean | undefined): ModelCapabilityValue {
  return value === undefined ? 'unknown' : value ? 'yes' : 'no';
}

function modelArchitecture(description: string): ModelArchitecture {
  if (/\b(?:sparse\s+)?MoE\b/i.test(description)) return 'MoE';
  return 'Unknown';
}

function baseCapabilities(): Record<ModelCapabilityKey, ModelCapabilityValue> {
  return Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, 'unknown'])) as Record<ModelCapabilityKey, ModelCapabilityValue>;
}

function fromNvidia(metadata: NvidiaModelMetadata): ModelCapabilityProfile {
  const capabilities = baseCapabilities();
  const description = metadata.description || '';
  capabilities.reasoning = /reasoning|agentic|complex\s+workflows/i.test(description) ? 'yes' : 'unknown';
  capabilities.toolCalling = yesNo(metadata.supportsTools);
  capabilities.vision = yesNo(metadata.inputModalities.some((modality) => modality !== 'text'));
  capabilities.streaming = yesNo(metadata.supportsStreaming);
  capabilities.coding = /coding|developer|terminal/i.test(description) ? 'yes' : 'unknown';
  capabilities.structuredOutput = metadata.supportsTools ? 'yes' : 'unknown';

  return {
    provider: 'nvidia',
    modelId: metadata.modelId,
    label: metadata.label,
    description: metadata.description,
    architecture: modelArchitecture(description),
    capabilities,
    contextWindow: metadata.contextWindow ?? resolveModelContextWindow(metadata.modelId),
    apiFamily: metadata.apiFamily,
    endpoint: metadata.endpoint,
    inputModalities: metadata.inputModalities,
    outputModalities: metadata.outputModalities,
    defaultParams: metadata.defaultParams,
    maxOutputTokens: metadata.defaultParams.maxTokens,
    source: 'provider-registry',
    engineUsage: {
      reasoning: 'react-planner',
      toolCalling: metadata.supportsTools ? 'native' : 'structured-text',
      architecture: 'automatic',
    },
    notes: [
      metadata.supportsTools
        ? 'The engine sends provider-native tools when the route advertises tool support.'
        : 'The engine uses its structured text action protocol because this route does not advertise native tools.',
      'MoE/Dense is model-internal; the application cannot switch the architecture on or off.',
    ],
  };
}

function fromGemini(metadata: GeminiModelMetadata): ModelCapabilityProfile {
  const capabilities = baseCapabilities();
  const description = metadata.description || '';
  capabilities.reasoning = /reasoning|agentic|complex\s+tasks/i.test(description) ? 'yes' : 'yes';
  capabilities.toolCalling = yesNo(metadata.supportsTools);
  capabilities.vision = yesNo(metadata.inputModalities.some((modality) => modality !== 'text'));
  capabilities.streaming = yesNo(metadata.supportsStreaming);
  capabilities.coding = /coding|agentic/i.test(description) ? 'yes' : 'unknown';
  capabilities.longContext = 'yes';
  capabilities.structuredOutput = metadata.supportsTools ? 'yes' : 'unknown';

  return {
    provider: 'gemini',
    modelId: metadata.modelId,
    label: metadata.label,
    description: metadata.description,
    architecture: 'Unknown',
    capabilities,
    contextWindow: 1_000_000,
    apiFamily: 'generate-content',
    endpoint: `/models/${metadata.modelId}:generateContent`,
    inputModalities: metadata.inputModalities,
    outputModalities: metadata.outputModalities,
    defaultParams: metadata.defaultParams,
    maxOutputTokens: metadata.defaultParams.maxTokens,
    supportsSamplingParameters: metadata.supportsSamplingParameters,
    freeTier: metadata.freeTier,
    source: 'provider-registry',
    engineUsage: {
      reasoning: 'react-planner',
      toolCalling: metadata.supportsTools ? 'native' : 'structured-text',
      architecture: 'automatic',
    },
    notes: [
      'The ReAct planner supplies the reasoning loop and verification context.',
      'Gemini architecture is not asserted when the provider catalog does not expose it.',
    ],
  };
}

function fromPollinations(model: PollinationsModel, selectedModelId: string): ModelCapabilityProfile {
  const capabilities = baseCapabilities();
  const description = model.description || '';
  capabilities.reasoning = yesNo(model.supportsReasoning);
  capabilities.toolCalling = yesNo(model.supportsTools);
  capabilities.vision = yesNo(model.inputModalities.includes('image'));
  capabilities.streaming = 'no';
  capabilities.coding = /coding|code|developer|agent/i.test(`${model.label} ${description}`) ? 'yes' : 'unknown';
  capabilities.longContext = model.contextLength && model.contextLength >= 32_000 ? 'yes' : 'unknown';
  capabilities.structuredOutput = yesNo(model.supportsTools);

  return {
    provider: 'pollinations',
    modelId: selectedModelId,
    label: model.label,
    description: model.description,
    architecture: 'Unknown',
    capabilities,
    contextWindow: model.contextLength,
    apiFamily: 'chat-completions',
    endpoint: '/v1/chat/completions',
    inputModalities: model.inputModalities,
    outputModalities: model.outputModalities,
    maxOutputTokens: model.maxOutputTokens,
    freeTier: model.isFree,
    source: 'provider-catalog',
    engineUsage: {
      reasoning: 'react-planner',
      toolCalling: model.supportsTools ? 'native' : 'structured-text',
      architecture: 'automatic',
    },
    notes: [
      model.supportsTools
        ? 'The Pollinations registry advertises native tool support for this route.'
        : 'The engine uses its structured text action protocol because this route does not advertise native tools.',
      'Pollinations model availability and limits come from the saved provider catalog until the next sync.',
    ],
  };
}

function providerFromModelId(modelId: string): ModelCapabilityProvider {
  const lower = modelId.toLowerCase();
  if (lower.startsWith('gemini')) return 'gemini';
  if (lower.startsWith('openrouter:')) return 'openrouter';
  if (lower.startsWith('groq:')) return 'groq';
  if (lower.startsWith('cerebras:')) return 'cerebras';
  if (lower.startsWith('sambanova:')) return 'sambanova';
  if (lower.startsWith('kimi:')) return 'kimi';
  if (lower.startsWith('requesty:')) return 'requesty';
  if (lower.startsWith('local:') || lower.startsWith('local-target:')) return 'local';
  if (lower.startsWith('colab-target:')) return 'colab';
  if (lower.startsWith('nvidia:') || Object.hasOwn(NVIDIA_MODEL_REGISTRY, modelId)) return 'nvidia';
  if (lower.startsWith('pollinations:')) return 'pollinations';
  return 'unknown';
}

function compactModelId(modelId: string): string {
  return modelId.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function unknownProfile(modelId: string, provider = providerFromModelId(modelId)): ModelCapabilityProfile {
  const capabilities = baseCapabilities();
  return {
    provider,
    modelId,
    label: modelId,
    architecture: 'Unknown',
    capabilities,
    engineUsage: {
      reasoning: 'react-planner',
      toolCalling: 'unknown',
      architecture: 'automatic',
    },
    source: 'unknown',
    notes: [
      'This is a custom or dynamically routed model. Capability claims remain unknown until the provider advertises them.',
      'The ReAct planner still supplies the application-level reasoning loop.',
    ],
  };
}

/**
 * Resolve a model profile while preserving the API route that carries it.
 * A Requesty or OpenRouter route can carry a model that is also present in
 * the NVIDIA registry, but the configured API is still the route's provider.
 */
export function getProviderModelCapabilityProfile(
  model: string,
  provider: ModelCapabilityProvider,
  overrides: Partial<ModelCapabilityProfile> = {},
): ModelCapabilityProfile {
  const base = getModelCapabilityProfile(model, provider);
  return {
    ...base,
    ...overrides,
    provider,
    modelId: model.trim(),
    label: overrides.label || base.label || model.trim(),
  };
}

/** Resolve the shared capability profile for a direct model id. */
export function getModelCapabilityProfile(model: string, provider?: ModelCapabilityProvider): ModelCapabilityProfile {
  const modelId = model.trim();
  const normalizedModelId = modelId.replace(/^(?:nvidia|gemini):/i, '');
  const currentNvidiaModelId = getNvidiaModelReplacement(normalizedModelId) || normalizedModelId;
  const nvidiaMetadata = NVIDIA_MODEL_REGISTRY[currentNvidiaModelId];
  if (nvidiaMetadata) return fromNvidia(nvidiaMetadata);

  const geminiMetadata = GEMINI_FREE_MODEL_REGISTRY[normalizedModelId];
  if (geminiMetadata) return fromGemini(geminiMetadata);

  const pollinationsModelId = normalizedModelId.replace(/^pollinations:/i, '').trim();
  if (provider === 'pollinations' || /^pollinations:/i.test(modelId)) {
    const pollinationsModel = getSavedPollinationsModelCatalog().models.find((candidate) =>
      candidate.id.toLowerCase() === pollinationsModelId.toLowerCase(),
    );
    if (pollinationsModel) return fromPollinations(pollinationsModel, modelId);
  }

  // Saved target values include a readable target id rather than the raw
  // provider model id. Resolve known catalog models without loading the
  // persistence layer into this capability registry.
  const compactSelection = compactModelId(modelId);
  const targetNvidiaMetadata = Object.values(NVIDIA_MODEL_REGISTRY).find((candidate) =>
    compactSelection.includes(compactModelId(candidate.modelId)),
  );
  if (targetNvidiaMetadata) {
    const replacementId = getNvidiaModelReplacement(targetNvidiaMetadata.modelId);
    return fromNvidia(
      (replacementId && NVIDIA_MODEL_REGISTRY[replacementId]) || targetNvidiaMetadata,
    );
  }
  const targetGeminiMetadata = Object.values(GEMINI_FREE_MODEL_REGISTRY).find((candidate) =>
    compactSelection.includes(compactModelId(candidate.modelId)),
  );
  if (targetGeminiMetadata) return fromGemini(targetGeminiMetadata);

  return unknownProfile(modelId, provider);
}

/** Return all catalogued profiles for the Settings capability overview. */
export function getAllModelCapabilityProfiles(): ModelCapabilityProfile[] {
  const profiles = [
    ...Object.values(NVIDIA_MODEL_REGISTRY).filter((model) => model.uiSelectable).map(fromNvidia),
    ...Object.values(GEMINI_FREE_MODEL_REGISTRY)
      .filter((model) => model.uiSelectable && !isRetiredGeminiModel(model.modelId))
      .map(fromGemini),
  ];
  return profiles.sort((left, right) => left.provider.localeCompare(right.provider) || left.label.localeCompare(right.label));
}

/**
 * Keep model capability claims connected to the actual agent contract. This
 * text is intentionally operational rather than a request to reveal private
 * chain-of-thought.
 */
export function formatModelCapabilityInstruction(profile: ModelCapabilityProfile): string {
  const capabilitySummary = Object.entries(profile.capabilities)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
  return [
    `Selected model capability profile: ${profile.label} (${profile.modelId})`,
    `Capabilities: ${capabilitySummary}; architecture=${profile.architecture}.`,
    profile.engineUsage.reasoning === 'react-planner'
      ? 'Reasoning wiring: use the ReAct planner, current observations, and configured thinking depth; return only a concise visible rationale.'
      : 'Reasoning wiring: use the provider-native reasoning path when available and return only a concise visible rationale.',
    profile.engineUsage.toolCalling === 'native'
      ? 'Tool wiring: prefer provider-native function tools and keep the normalized single-action contract.'
      : profile.engineUsage.toolCalling === 'structured-text'
        ? 'Tool wiring: use the normalized structured JSON action protocol because native tools are not advertised.'
        : 'Tool wiring: capability is unknown; use the normalized structured action contract and do not assume native tools.',
    'Architecture wiring: MoE/Dense is model-internal and is used automatically by the selected model; it is not an application toggle.',
  ].join('\n');
}
