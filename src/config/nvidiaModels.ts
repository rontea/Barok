export type NvidiaApiFamily =
  | 'chat-completions'
  | 'responses'
  | 'embeddings'
  | 'rerank'
  | 'vision'
  | 'audio'
  | 'async-nvcf';

export interface NvidiaModelMetadata {
  provider: 'nvidia';
  modelId: string;
  label: string;
  apiFamily: NvidiaApiFamily;
  endpoint: string;
  supportsStreaming: boolean;
  supportsTools: boolean;
  inputModalities: Array<'text' | 'image' | 'audio' | 'video'>;
  outputModalities: Array<'text' | 'embedding' | 'audio'>;
  defaultParams: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
  };
  contextWindow?: number;
  uiSelectable: boolean;
  description: string;
}

export const NVIDIA_BASE_URL_DEFAULT = 'https://integrate.api.nvidia.com/v1';
/** Known responsive NVIDIA free-endpoint fallback for degraded large models. */
export const NVIDIA_FREE_FALLBACK_MODEL = 'minimaxai/minimax-m3';

/** Provider model IDs that were renamed while saved targets may still use the old ID. */
export const NVIDIA_MODEL_ID_REPLACEMENTS: Record<string, string> = {
  'deepseek-ai/deepseek-v4-flash': 'deepseek-ai/deepseek-v4-flash-0731',
};

export const NVIDIA_MODEL_REGISTRY: Record<string, NvidiaModelMetadata> = {
  'nvidia/nemotron-3-ultra-550b-a55b': {
    provider: 'nvidia',
    modelId: 'nvidia/nemotron-3-ultra-550b-a55b',
    label: 'NVIDIA Nemotron 3 Ultra 550B',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: false,
    inputModalities: ['text'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 1,
      maxTokens: 16384,
      topP: 0.95,
    },
    uiSelectable: true,
    description: 'Frontier-scale NVIDIA reasoning/chat model for complex agentic workflows.',
  },
  'nvidia/nemotron-3-super-120b-a12b': {
    provider: 'nvidia',
    modelId: 'nvidia/nemotron-3-super-120b-a12b',
    label: 'NVIDIA Nemotron 3 Super 120B',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: false,
    inputModalities: ['text'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 1,
      maxTokens: 16384,
      topP: 0.95,
    },
    uiSelectable: true,
    description: 'General reasoning/chat model for agent systems and high-volume workloads.',
  },
  'poolside/laguna-xs-2.1': {
    provider: 'nvidia',
    modelId: 'poolside/laguna-xs-2.1',
    label: 'NVIDIA Poolside Laguna XS 2.1',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 1,
      maxTokens: 8192,
      topP: 0.95,
    },
    uiSelectable: true,
    description: 'Efficient Poolside 33B MoE model for long-horizon agentic coding and terminal tasks hosted through NVIDIA NIM.',
  },
  'qwen/qwen3-coder-480b-a35b-instruct': {
    provider: 'nvidia',
    modelId: 'qwen/qwen3-coder-480b-a35b-instruct',
    label: 'NVIDIA Qwen3 Coder 480B',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 0.2,
      maxTokens: 4096,
      topP: 0.95,
    },
    uiSelectable: false,
    description: 'Deprecated NVIDIA free endpoint retained for compatibility with explicitly saved targets.',
  },
  'minimaxai/minimax-m3': {
    provider: 'nvidia',
    modelId: 'minimaxai/minimax-m3',
    label: 'NVIDIA MiniMax M3',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text', 'image', 'video'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 1,
      maxTokens: 8192,
      topP: 0.95,
    },
    uiSelectable: true,
    description: 'MiniMax M3 multimodal reasoning, coding, and creative workflow model hosted through NVIDIA NIM.',
  },
  'z-ai/glm-5.2': {
    provider: 'nvidia',
    modelId: 'z-ai/glm-5.2',
    label: 'NVIDIA Z.ai GLM-5.2',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 1,
      maxTokens: 16384,
      topP: 1,
    },
    uiSelectable: true,
    description: 'Z.ai GLM-5.2 long-context reasoning and coding model hosted through NVIDIA NIM.',
  },
  'deepseek-ai/deepseek-v4-flash': {
    provider: 'nvidia',
    modelId: 'deepseek-ai/deepseek-v4-flash',
    label: 'NVIDIA DeepSeek V4 Flash',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 1,
      maxTokens: 16384,
      topP: 0.95,
    },
    contextWindow: 1_000_000,
    uiSelectable: false,
    description: 'Retired NVIDIA endpoint; saved targets are migrated to deepseek-ai/deepseek-v4-flash-0731.',
  },
  'deepseek-ai/deepseek-v4-flash-0731': {
    provider: 'nvidia',
    modelId: 'deepseek-ai/deepseek-v4-flash-0731',
    label: 'NVIDIA DeepSeek V4 Flash 0731',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 1,
      maxTokens: 16384,
      topP: 0.95,
    },
    contextWindow: 1_000_000,
    uiSelectable: true,
    description: 'DeepSeek V4 Flash 284B MoE model with 1M-token context for fast coding and agentic workflows hosted through NVIDIA NIM.',
  },
  'stepfun-ai/step-3.7-flash': {
    provider: 'nvidia',
    modelId: 'stepfun-ai/step-3.7-flash',
    label: 'NVIDIA Step 3.7 Flash',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 1,
      maxTokens: 16384,
      topP: 0.95,
    },
    uiSelectable: true,
    description: 'Step 3.7 Flash sparse MoE multimodal reasoning model for coding, agentic, and vision workflows hosted through NVIDIA NIM.',
  },
  'google/gemma-4-31b-it': {
    provider: 'nvidia',
    modelId: 'google/gemma-4-31b-it',
    label: 'NVIDIA Google Gemma 4 31B IT',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text', 'image', 'video'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 1,
      maxTokens: 16384,
      topP: 0.95,
    },
    uiSelectable: true,
    description: 'Google Gemma 4 31B multimodal instruction model for reasoning, coding, agentic, and function-calling workflows hosted through NVIDIA NIM.',
  },
  'google/diffusiongemma-26b-a4b-it': {
    provider: 'nvidia',
    modelId: 'google/diffusiongemma-26b-a4b-it',
    label: 'NVIDIA Google DiffusionGemma 26B A4B IT',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text', 'image', 'video'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 0.8,
      maxTokens: 16384,
      topP: 0.95,
    },
    uiSelectable: true,
    description: 'Google DeepMind DiffusionGemma 26B A4B multimodal diffusion model for high-speed reasoning, coding, and function-calling workflows hosted through NVIDIA NIM.',
  },
  'moonshotai/kimi-k2.6': {
    provider: 'nvidia',
    modelId: 'moonshotai/kimi-k2.6',
    label: 'NVIDIA Moonshot Kimi K2.6',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text', 'image', 'video'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 1,
      maxTokens: 16384,
      topP: 1,
    },
    uiSelectable: true,
    description: 'Moonshot Kimi K2.6 1T multimodal MoE model for long-horizon coding, agentic tool use, and image/video understanding hosted through NVIDIA NIM.',
  },
  'openai/gpt-oss-120b': {
    provider: 'nvidia',
    modelId: 'openai/gpt-oss-120b',
    label: 'NVIDIA GPT OSS 120B',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 1,
      maxTokens: 4096,
      topP: 1,
    },
    contextWindow: 131_072,
    uiSelectable: true,
    description: 'OpenAI GPT OSS 120B reasoning MoE text model hosted through NVIDIA NIM.',
  },
  'openai/gpt-oss-20b': {
    provider: 'nvidia',
    modelId: 'openai/gpt-oss-20b',
    label: 'NVIDIA GPT OSS 20B',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: false,
    inputModalities: ['text'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 1,
      maxTokens: 4096,
      topP: 1,
    },
    contextWindow: 131_072,
    uiSelectable: true,
    description: 'OpenAI GPT OSS 20B reasoning MoE text model hosted through NVIDIA NIM.',
  },
  'nvidia/nemotron-3-nano-30b-a3b': {
    provider: 'nvidia',
    modelId: 'nvidia/nemotron-3-nano-30b-a3b',
    label: 'NVIDIA Nemotron 3 Nano 30B',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 1,
      maxTokens: 16384,
      topP: 1,
    },
    contextWindow: 262_144,
    uiSelectable: true,
    description: 'Efficient NVIDIA Nemotron 3 Nano MoE model for coding, reasoning, long context, and tool calling.',
  },
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning': {
    provider: 'nvidia',
    modelId: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
    label: 'NVIDIA Nemotron 3 Nano Omni 30B',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: false,
    inputModalities: ['text', 'image', 'audio', 'video'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 0.6,
      maxTokens: 65536,
      topP: 0.95,
    },
    contextWindow: 262_144,
    uiSelectable: true,
    description: 'NVIDIA omni-modal reasoning model for text, image, audio, and video understanding.',
  },
  'nvidia/nvidia-nemotron-nano-9b-v2': {
    provider: 'nvidia',
    modelId: 'nvidia/nvidia-nemotron-nano-9b-v2',
    label: 'NVIDIA Nemotron Nano 9B V2',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: false,
    inputModalities: ['text'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 0.6,
      maxTokens: 2048,
      topP: 0.95,
    },
    contextWindow: 131_072,
    uiSelectable: true,
    description: 'Efficient NVIDIA reasoning and agentic model with a switchable thinking budget.',
  },
  'nvidia/llama-3.3-nemotron-super-49b-v1.5': {
    provider: 'nvidia',
    modelId: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    label: 'NVIDIA Llama 3.3 Nemotron Super 49B',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 0.6,
      maxTokens: 65536,
      topP: 0.95,
    },
    contextWindow: 131_072,
    uiSelectable: true,
    description: 'NVIDIA Llama 3.3 Nemotron Super model for reasoning, coding, chat, and function calling.',
  },
  'mistralai/mistral-nemotron': {
    provider: 'nvidia',
    modelId: 'mistralai/mistral-nemotron',
    label: 'NVIDIA Mistral Nemotron',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 0.6,
      maxTokens: 4096,
      topP: 0.7,
    },
    contextWindow: 131_072,
    uiSelectable: true,
    description: 'Mistral Nemotron model for coding, instruction following, and function calling.',
  },
  'thinkingmachines/inkling': {
    provider: 'nvidia',
    modelId: 'thinkingmachines/inkling',
    label: 'NVIDIA Thinking Machines Inkling',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 1,
      maxTokens: 8192,
      topP: 0.95,
    },
    contextWindow: 131_072,
    uiSelectable: true,
    description: 'Multimodal Thinking Machines reasoning MoE model with tool use hosted through NVIDIA NIM.',
  },
  'nvidia/llama-3.3-nemotron-super-49b-v1': {
    provider: 'nvidia',
    modelId: 'nvidia/llama-3.3-nemotron-super-49b-v1',
    label: 'NVIDIA Llama 3.3 Nemotron Super 49B V1',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 0.6,
      maxTokens: 4096,
      topP: 0.95,
    },
    contextWindow: 131_072,
    uiSelectable: true,
    description: 'NVIDIA Llama 3.3 Nemotron Super model for reasoning, coding, chat, and function calling.',
  },
  'nvidia/llama-3.1-nemotron-nano-8b-v1': {
    provider: 'nvidia',
    modelId: 'nvidia/llama-3.1-nemotron-nano-8b-v1',
    label: 'NVIDIA Llama 3.1 Nemotron Nano 8B',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: true,
    inputModalities: ['text'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 0.6,
      maxTokens: 4096,
      topP: 0.95,
    },
    contextWindow: 131_072,
    uiSelectable: true,
    description: 'Compact NVIDIA reasoning and agentic model with function calling for efficient coding workflows.',
  },
  'nvidia/llama-3.1-nemotron-nano-vl-8b-v1': {
    provider: 'nvidia',
    modelId: 'nvidia/llama-3.1-nemotron-nano-vl-8b-v1',
    label: 'NVIDIA Llama 3.1 Nemotron Nano VL 8B',
    apiFamily: 'chat-completions',
    endpoint: '/chat/completions',
    supportsStreaming: true,
    supportsTools: false,
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    defaultParams: {
      temperature: 1,
      maxTokens: 1024,
      topP: 0.01,
    },
    contextWindow: 131_072,
    uiSelectable: true,
    description: 'NVIDIA compact vision-language model for image understanding and document intelligence.',
  },
  'baai/bge-m3': {
    provider: 'nvidia',
    modelId: 'baai/bge-m3',
    label: 'NVIDIA BAAI BGE-M3',
    apiFamily: 'embeddings',
    endpoint: '/embeddings',
    supportsStreaming: false,
    supportsTools: false,
    inputModalities: ['text'],
    outputModalities: ['embedding'],
    defaultParams: {},
    uiSelectable: false,
    description: 'Retrieval embedding model; keep out of chat completion routing.',
  },
};

export function normalizeNvidiaModelId(model: string): string {
  return model.trim().toLowerCase();
}

export function getNvidiaModelReplacement(model: string): string | undefined {
  return NVIDIA_MODEL_ID_REPLACEMENTS[normalizeNvidiaModelId(model)];
}

/** Keep target IDs stable when a provider replaces the underlying model ID. */
export function getNvidiaTargetModelId(model: string): string {
  const normalized = normalizeNvidiaModelId(model);
  const replacement = getNvidiaModelReplacement(normalized);
  if (replacement) return normalized;
  const previousId = Object.entries(NVIDIA_MODEL_ID_REPLACEMENTS)
    .find(([, nextId]) => nextId === normalized)?.[0];
  return previousId || normalized;
}

export function getNvidiaModelMetadata(model: string): NvidiaModelMetadata | undefined {
  return NVIDIA_MODEL_REGISTRY[normalizeNvidiaModelId(model)];
}

export function isNvidiaModel(model: string): boolean {
  return Boolean(getNvidiaModelMetadata(model));
}

export function getNvidiaChatModelIds(): string[] {
  return Object.values(NVIDIA_MODEL_REGISTRY)
    .filter((model) => model.uiSelectable && model.apiFamily === 'chat-completions')
    .map((model) => model.modelId);
}
