/**
 * Model configuration manager
 * Manages model registry, pricing, and parameters
 */

import { BaseConfigManager } from './baseManager.js';
import { ModelConfig, ModelDefinition, ConfigValidationError } from './types.js';
import { NVIDIA_BASE_URL_DEFAULT, NVIDIA_MODEL_REGISTRY } from './nvidiaModels.js';
import { getOpenRouterKnownModelMetadata } from './openRouterTargets.js';
import { isLocalAITargetValue, resolveLocalAIModelTarget } from './localAITargets.js';
import { isColabTargetValue, resolveColabModelTarget } from './colabTargets.js';

const MODEL_REGISTRY: Record<string, ModelDefinition> = {
  // Gemini models
  'gemini-1.5-pro': {
    name: 'Gemini 1.5 Pro',
    provider: 'gemini',
    type: 'multimodal',
    pricing: {
      promptTokens: 0.00075, // $0.75 per 1M tokens
      completionTokens: 0.003, // $3 per 1M tokens
    },
    maxTokens: 8192,
    contextWindow: 1000000,
    supportsVision: true,
    supportsToolUse: true,
    supportsFunctionCalling: true,
    isActive: true,
    description: 'Google Gemini 1.5 Pro - Multimodal with 1M context',
  },

  'gemini-1.5-flash': {
    name: 'Gemini 1.5 Flash',
    provider: 'gemini',
    type: 'multimodal',
    pricing: {
      promptTokens: 0.000075,
      completionTokens: 0.0003,
    },
    maxTokens: 8192,
    contextWindow: 1000000,
    supportsVision: true,
    supportsToolUse: true,
    supportsFunctionCalling: true,
    isActive: true,
    description: 'Google Gemini 1.5 Flash - Fast and economical',
  },

  'gemini-3.5-flash': {
    name: 'Gemini 3.5 Flash',
    provider: 'gemini',
    type: 'multimodal',
    pricing: {
      promptTokens: 0.000035, // $0.035 per 1M tokens
      completionTokens: 0.00014, // $0.14 per 1M tokens
    },
    maxTokens: 16384,
    contextWindow: 1000000,
    supportsVision: true,
    supportsToolUse: true,
    supportsFunctionCalling: true,
    isActive: true,
    description: 'Google Gemini 3.5 Flash - Latest ultrafast model, ideal for orchestration',
  },

  'gemini-3.6-flash': {
    name: 'Gemini 3.6 Flash',
    provider: 'gemini',
    type: 'multimodal',
    pricing: {
      promptTokens: 0.0015, // $1.50 per 1M tokens
      completionTokens: 0.0075, // $7.50 per 1M tokens
    },
    maxTokens: 65536,
    contextWindow: 1000000,
    supportsVision: true,
    supportsToolUse: false,
    supportsFunctionCalling: false,
    isActive: true,
    description: 'Google Gemini 3.6 Flash - Latest stable model for agentic coding and multimodal work',
  },

  'claude-3.5-sonnet': {
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    type: 'text',
    pricing: {
      promptTokens: 0.003,
      completionTokens: 0.015,
    },
    maxTokens: 4096,
    contextWindow: 200000,
    supportsVision: false,
    supportsToolUse: true,
    supportsFunctionCalling: true,
    isActive: true,
    description: 'Anthropic Claude 3.5 Sonnet - Balanced performance',
  },

  // Pollinations models
  'flux': {
    name: 'Flux',
    provider: 'pollinations',
    type: 'image',
    pricing: {
      promptTokens: 0,
      completionTokens: 0.01,
    },
    maxTokens: 1000,
    contextWindow: 1000,
    supportsVision: false,
    supportsToolUse: false,
    supportsFunctionCalling: false,
    isActive: true,
    description: 'Flux - Fast image generation',
  },

  'qwen': {
    name: 'Qwen',
    provider: 'pollinations',
    type: 'text',
    pricing: {
      promptTokens: 0.0001,
      completionTokens: 0.0002,
    },
    maxTokens: 4096,
    contextWindow: 32000,
    supportsVision: false,
    supportsToolUse: true,
    supportsFunctionCalling: false,
    isActive: true,
    description: 'Qwen - Fast text generation via Pollinations',
  },

  'qwen-coder': {
    name: 'Qwen Coder',
    provider: 'pollinations',
    type: 'text',
    pricing: {
      promptTokens: 0.00012,
      completionTokens: 0.00025,
    },
    maxTokens: 4096,
    contextWindow: 32000,
    supportsVision: false,
    supportsToolUse: true,
    supportsFunctionCalling: false,
    isActive: true,
    description: 'Qwen Coder - Optimized for code tasks',
  },

  'openai-gpt-4': {
    name: 'OpenAI GPT-4',
    provider: 'openai',
    type: 'text',
    pricing: {
      promptTokens: 0.03,
      completionTokens: 0.06,
    },
    maxTokens: 8192,
    contextWindow: 8192,
    supportsVision: false,
    supportsToolUse: true,
    supportsFunctionCalling: true,
    isActive: false,
    description: 'OpenAI GPT-4 - Not configured',
  },

  'nvidia/nemotron-3-ultra-550b-a55b': {
    name: 'NVIDIA Nemotron 3 Ultra 550B',
    provider: 'nvidia',
    type: 'text',
    modelId: NVIDIA_MODEL_REGISTRY['nvidia/nemotron-3-ultra-550b-a55b'].modelId,
    apiFamily: NVIDIA_MODEL_REGISTRY['nvidia/nemotron-3-ultra-550b-a55b'].apiFamily,
    endpoint: NVIDIA_MODEL_REGISTRY['nvidia/nemotron-3-ultra-550b-a55b'].endpoint,
    pricing: {
      promptTokens: 0.0008,
      completionTokens: 0.0008,
    },
    maxTokens: 4096,
    contextWindow: 131072,
    supportsVision: false,
    supportsToolUse: false,
    supportsFunctionCalling: false,
    supportsStreaming: true,
    isActive: true,
    description: NVIDIA_MODEL_REGISTRY['nvidia/nemotron-3-ultra-550b-a55b'].description,
  },

  'nvidia/nemotron-3-super-120b-a12b': {
    name: 'NVIDIA Nemotron 3 Super 120B',
    provider: 'nvidia',
    type: 'text',
    modelId: NVIDIA_MODEL_REGISTRY['nvidia/nemotron-3-super-120b-a12b'].modelId,
    apiFamily: NVIDIA_MODEL_REGISTRY['nvidia/nemotron-3-super-120b-a12b'].apiFamily,
    endpoint: NVIDIA_MODEL_REGISTRY['nvidia/nemotron-3-super-120b-a12b'].endpoint,
    pricing: {
      promptTokens: 0.0004,
      completionTokens: 0.0004,
    },
    maxTokens: 4096,
    contextWindow: 131072,
    supportsVision: false,
    supportsToolUse: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    isActive: true,
    description: NVIDIA_MODEL_REGISTRY['nvidia/nemotron-3-super-120b-a12b'].description,
  },

  'poolside/laguna-xs-2.1': {
    name: 'NVIDIA Poolside Laguna XS 2.1',
    provider: 'nvidia',
    type: 'text',
    modelId: NVIDIA_MODEL_REGISTRY['poolside/laguna-xs-2.1'].modelId,
    apiFamily: NVIDIA_MODEL_REGISTRY['poolside/laguna-xs-2.1'].apiFamily,
    endpoint: NVIDIA_MODEL_REGISTRY['poolside/laguna-xs-2.1'].endpoint,
    pricing: {
      promptTokens: 0,
      completionTokens: 0,
    },
    maxTokens: 8192,
    contextWindow: 262144,
    supportsVision: false,
    supportsToolUse: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    isActive: true,
    description: NVIDIA_MODEL_REGISTRY['poolside/laguna-xs-2.1'].description,
  },

  'qwen/qwen3-coder-480b-a35b-instruct': {
    name: 'NVIDIA Qwen3 Coder 480B',
    provider: 'nvidia',
    type: 'text',
    modelId: NVIDIA_MODEL_REGISTRY['qwen/qwen3-coder-480b-a35b-instruct'].modelId,
    apiFamily: NVIDIA_MODEL_REGISTRY['qwen/qwen3-coder-480b-a35b-instruct'].apiFamily,
    endpoint: NVIDIA_MODEL_REGISTRY['qwen/qwen3-coder-480b-a35b-instruct'].endpoint,
    pricing: {
      promptTokens: 0.0003,
      completionTokens: 0.0003,
    },
    maxTokens: 4096,
    contextWindow: 131072,
    supportsVision: false,
    supportsToolUse: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    isActive: true,
    description: NVIDIA_MODEL_REGISTRY['qwen/qwen3-coder-480b-a35b-instruct'].description,
  },

  'minimaxai/minimax-m3': {
    name: 'NVIDIA MiniMax M3',
    provider: 'nvidia',
    type: 'multimodal',
    modelId: NVIDIA_MODEL_REGISTRY['minimaxai/minimax-m3'].modelId,
    apiFamily: NVIDIA_MODEL_REGISTRY['minimaxai/minimax-m3'].apiFamily,
    endpoint: NVIDIA_MODEL_REGISTRY['minimaxai/minimax-m3'].endpoint,
    pricing: {
      promptTokens: 0.0003,
      completionTokens: 0.0003,
    },
    maxTokens: 4096,
    contextWindow: 131072,
    supportsVision: true,
    supportsToolUse: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    isActive: true,
    description: NVIDIA_MODEL_REGISTRY['minimaxai/minimax-m3'].description,
  },

  'z-ai/glm-5.2': {
    name: 'NVIDIA Z.ai GLM-5.2',
    provider: 'nvidia',
    type: 'text',
    modelId: NVIDIA_MODEL_REGISTRY['z-ai/glm-5.2'].modelId,
    apiFamily: NVIDIA_MODEL_REGISTRY['z-ai/glm-5.2'].apiFamily,
    endpoint: NVIDIA_MODEL_REGISTRY['z-ai/glm-5.2'].endpoint,
    pricing: {
      promptTokens: 0.0003,
      completionTokens: 0.0003,
    },
    maxTokens: 4096,
    contextWindow: 1000000,
    supportsVision: false,
    supportsToolUse: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    isActive: true,
    description: NVIDIA_MODEL_REGISTRY['z-ai/glm-5.2'].description,
  },

  'deepseek-ai/deepseek-v4-flash': {
    name: 'NVIDIA DeepSeek V4 Flash',
    provider: 'nvidia',
    type: 'text',
    modelId: NVIDIA_MODEL_REGISTRY['deepseek-ai/deepseek-v4-flash'].modelId,
    apiFamily: NVIDIA_MODEL_REGISTRY['deepseek-ai/deepseek-v4-flash'].apiFamily,
    endpoint: NVIDIA_MODEL_REGISTRY['deepseek-ai/deepseek-v4-flash'].endpoint,
    pricing: {
      promptTokens: 0.0003,
      completionTokens: 0.0003,
    },
    maxTokens: 16384,
    contextWindow: 1000000,
    supportsVision: false,
    supportsToolUse: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    isActive: true,
    description: NVIDIA_MODEL_REGISTRY['deepseek-ai/deepseek-v4-flash'].description,
  },

  'stepfun-ai/step-3.7-flash': {
    name: 'NVIDIA Step 3.7 Flash',
    provider: 'nvidia',
    type: 'multimodal',
    modelId: NVIDIA_MODEL_REGISTRY['stepfun-ai/step-3.7-flash'].modelId,
    apiFamily: NVIDIA_MODEL_REGISTRY['stepfun-ai/step-3.7-flash'].apiFamily,
    endpoint: NVIDIA_MODEL_REGISTRY['stepfun-ai/step-3.7-flash'].endpoint,
    pricing: {
      promptTokens: 0.0003,
      completionTokens: 0.0003,
    },
    maxTokens: 16384,
    contextWindow: 262144,
    supportsVision: true,
    supportsToolUse: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    isActive: true,
    description: NVIDIA_MODEL_REGISTRY['stepfun-ai/step-3.7-flash'].description,
  },

  'google/gemma-4-31b-it': {
    name: 'NVIDIA Google Gemma 4 31B IT',
    provider: 'nvidia',
    type: 'multimodal',
    modelId: NVIDIA_MODEL_REGISTRY['google/gemma-4-31b-it'].modelId,
    apiFamily: NVIDIA_MODEL_REGISTRY['google/gemma-4-31b-it'].apiFamily,
    endpoint: NVIDIA_MODEL_REGISTRY['google/gemma-4-31b-it'].endpoint,
    pricing: {
      promptTokens: 0.0003,
      completionTokens: 0.0003,
    },
    maxTokens: 16384,
    contextWindow: 262144,
    supportsVision: true,
    supportsToolUse: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    isActive: true,
    description: NVIDIA_MODEL_REGISTRY['google/gemma-4-31b-it'].description,
  },

  'google/diffusiongemma-26b-a4b-it': {
    name: 'NVIDIA Google DiffusionGemma 26B A4B IT',
    provider: 'nvidia',
    type: 'multimodal',
    modelId: NVIDIA_MODEL_REGISTRY['google/diffusiongemma-26b-a4b-it'].modelId,
    apiFamily: NVIDIA_MODEL_REGISTRY['google/diffusiongemma-26b-a4b-it'].apiFamily,
    endpoint: NVIDIA_MODEL_REGISTRY['google/diffusiongemma-26b-a4b-it'].endpoint,
    pricing: {
      promptTokens: 0.0003,
      completionTokens: 0.0003,
    },
    maxTokens: 16384,
    contextWindow: 262144,
    supportsVision: true,
    supportsToolUse: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    isActive: true,
    description: NVIDIA_MODEL_REGISTRY['google/diffusiongemma-26b-a4b-it'].description,
  },

  'moonshotai/kimi-k2.6': {
    name: 'NVIDIA Moonshot Kimi K2.6',
    provider: 'nvidia',
    type: 'multimodal',
    modelId: NVIDIA_MODEL_REGISTRY['moonshotai/kimi-k2.6'].modelId,
    apiFamily: NVIDIA_MODEL_REGISTRY['moonshotai/kimi-k2.6'].apiFamily,
    endpoint: NVIDIA_MODEL_REGISTRY['moonshotai/kimi-k2.6'].endpoint,
    pricing: {
      promptTokens: 0.0003,
      completionTokens: 0.0003,
    },
    maxTokens: 16384,
    contextWindow: 262144,
    supportsVision: true,
    supportsToolUse: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    isActive: true,
    description: NVIDIA_MODEL_REGISTRY['moonshotai/kimi-k2.6'].description,
  },

  'openai/gpt-oss-120b': {
    name: 'NVIDIA GPT OSS 120B',
    provider: 'nvidia',
    type: 'text',
    modelId: NVIDIA_MODEL_REGISTRY['openai/gpt-oss-120b'].modelId,
    apiFamily: NVIDIA_MODEL_REGISTRY['openai/gpt-oss-120b'].apiFamily,
    endpoint: NVIDIA_MODEL_REGISTRY['openai/gpt-oss-120b'].endpoint,
    pricing: {
      promptTokens: 0.0001,
      completionTokens: 0.0001,
    },
    maxTokens: 4096,
    contextWindow: 131072,
    supportsVision: false,
    supportsToolUse: false,
    supportsFunctionCalling: false,
    supportsStreaming: true,
    isActive: true,
    description: NVIDIA_MODEL_REGISTRY['openai/gpt-oss-120b'].description,
  },

  'baai/bge-m3': {
    name: 'NVIDIA BAAI BGE-M3',
    provider: 'nvidia',
    type: 'text',
    modelId: NVIDIA_MODEL_REGISTRY['baai/bge-m3'].modelId,
    apiFamily: NVIDIA_MODEL_REGISTRY['baai/bge-m3'].apiFamily,
    endpoint: NVIDIA_MODEL_REGISTRY['baai/bge-m3'].endpoint,
    pricing: {
      promptTokens: 0.00001,
      completionTokens: 0,
    },
    maxTokens: 8192,
    contextWindow: 8192,
    supportsVision: false,
    supportsToolUse: false,
    supportsFunctionCalling: false,
    supportsStreaming: false,
    isActive: false,
    description: NVIDIA_MODEL_REGISTRY['baai/bge-m3'].description,
  },
};

// Keep the engine registry aligned with the provider catalog. This prevents a
// newly added NVIDIA target from silently losing its context/capability data.
for (const metadata of Object.values(NVIDIA_MODEL_REGISTRY)) {
  if (!metadata.uiSelectable || metadata.apiFamily !== 'chat-completions' || MODEL_REGISTRY[metadata.modelId]) {
    continue;
  }

  MODEL_REGISTRY[metadata.modelId] = {
    name: metadata.label,
    provider: 'nvidia',
    type: metadata.inputModalities.some((modality) => modality !== 'text') ? 'multimodal' : 'text',
    modelId: metadata.modelId,
    apiFamily: metadata.apiFamily,
    endpoint: metadata.endpoint,
    pricing: {
      promptTokens: 0,
      completionTokens: 0,
    },
    maxTokens: metadata.defaultParams.maxTokens || 4096,
    contextWindow: metadata.contextWindow || 131_072,
    supportsVision: metadata.inputModalities.some((modality) => modality !== 'text'),
    supportsToolUse: metadata.supportsTools,
    supportsFunctionCalling: metadata.supportsTools,
    supportsStreaming: metadata.supportsStreaming,
    isActive: true,
    description: metadata.description,
  };
}

/** Returns a known model context window without guessing for unregistered providers. */
export function resolveModelContextWindow(modelName: string): number | undefined {
  const trimmed = modelName.trim();
  if (isLocalAITargetValue(trimmed)) {
    const target = resolveLocalAIModelTarget(trimmed);
    return target?.runtimeContextWindow || target?.contextWindow;
  }
  if (isColabTargetValue(trimmed)) {
    const target = resolveColabModelTarget(trimmed);
    return target?.runtimeContextWindow || target?.contextWindow;
  }
  const openRouterMetadata = getOpenRouterKnownModelMetadata(trimmed);
  if (openRouterMetadata?.contextLength) return openRouterMetadata.contextLength;

  const direct = MODEL_REGISTRY[trimmed]?.contextWindow;
  if (direct) return direct;

  const unprefixed = trimmed.replace(/^(?:nvidia|gemini|groq|openrouter|kimi|requesty|local):/i, '');
  const registered = MODEL_REGISTRY[unprefixed]?.contextWindow;
  if (registered) return registered;

  // Supported Gemini generations in this app use the provider's 1M-token input context.
  if (/^gemini-(?:2\.5|3)/i.test(unprefixed)) return 1_000_000;
  return undefined;
}

const DEFAULT_MODEL_CONFIG: ModelConfig = {
  models: new Map(Object.entries(MODEL_REGISTRY)),
  defaultTextModel: 'z-ai/glm-5.2',
  defaultImageModel: 'flux',
  geminiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
  pollinationsBaseUrl: 'https://gen.pollinations.ai',
  nvidiaBaseUrl: NVIDIA_BASE_URL_DEFAULT,
};

export class ModelConfigManager extends BaseConfigManager<ModelConfig> {
  constructor() {
    super(DEFAULT_MODEL_CONFIG);
    this.setSource('default');
  }

  /**
   * Get model definition by name
   */
  getModel(name: string): ModelDefinition | undefined {
    return this.config.models.get(name);
  }

  /**
   * Get all available models
   */
  getAvailableModels(): ModelDefinition[] {
    return Array.from(this.config.models.values());
  }

  /**
   * Get all active models
   */
  getActiveModels(): ModelDefinition[] {
    return Array.from(this.config.models.values()).filter(m => m.isActive);
  }

  /**
   * Get models by type
   */
  getModelsByType(type: 'text' | 'image' | 'multimodal'): ModelDefinition[] {
    return Array.from(this.config.models.values()).filter(m => m.type === type);
  }

  /**
   * Get models by provider
   */
  getModelsByProvider(provider: string): ModelDefinition[] {
    return Array.from(this.config.models.values()).filter(m => m.provider === provider);
  }

  /**
   * Calculate cost for a model call
   */
  calculateCost(modelName: string, promptTokens: number, completionTokens: number): number {
    const model = this.getModel(modelName);
    if (!model) return 0;

    const promptCost = (promptTokens / 1000) * model.pricing.promptTokens;
    const completionCost = (completionTokens / 1000) * model.pricing.completionTokens;
    return promptCost + completionCost;
  }

  /**
   * Register a new model
   */
  registerModel(definition: ModelDefinition): void {
    this.config.models.set(definition.name, definition);
    this.source.lastModified = new Date();
  }

  /**
   * Update model definition
   */
  updateModel(name: string, updates: Partial<ModelDefinition>): void {
    const existing = this.config.models.get(name);
    if (existing) {
      this.config.models.set(name, { ...existing, ...updates });
      this.source.lastModified = new Date();
    }
  }

  /**
   * Enable/disable a model
   */
  setModelActive(name: string, active: boolean): void {
    const model = this.config.models.get(name);
    if (model) {
      model.isActive = active;
      this.source.lastModified = new Date();
    }
  }

  /**
   * Validate model configuration
   */
  validate(): ConfigValidationError[] {
    const errors: ConfigValidationError[] = [];

    // Validate default models exist
    const textModel = this.config.models.get(this.config.defaultTextModel);
    if (!textModel) {
      errors.push({
        section: 'models',
        field: 'defaultTextModel',
        value: this.config.defaultTextModel,
        error: `Model "${this.config.defaultTextModel}" not found in registry`,
      });
    }

    const imageModel = this.config.models.get(this.config.defaultImageModel);
    if (!imageModel) {
      errors.push({
        section: 'models',
        field: 'defaultImageModel',
        value: this.config.defaultImageModel,
        error: `Model "${this.config.defaultImageModel}" not found in registry`,
      });
    }

    // Validate at least one active text model exists
    const activeTextModels = this.getModelsByType('text').filter(m => m.isActive);
    if (activeTextModels.length === 0) {
      errors.push({
        section: 'models',
        field: 'models',
        value: this.config.models.size,
        error: 'No active text models available',
      });
    }

    // Validate at least one active image model exists
    const activeImageModels = this.getModelsByType('image').filter(m => m.isActive);
    if (activeImageModels.length === 0) {
      errors.push({
        section: 'models',
        field: 'models',
        value: this.config.models.size,
        error: 'No active image models available',
      });
    }

    return errors;
  }

  /**
   * Export model registry as JSON
   */
  export(includeSensitive = false): Record<string, unknown> {
    return {
      defaultTextModel: this.config.defaultTextModel,
      defaultImageModel: this.config.defaultImageModel,
      models: Object.fromEntries(this.config.models),
    };
  }
}
