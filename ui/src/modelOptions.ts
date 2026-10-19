export interface ModelOption {
  value: string;
  label: string;
  provider?: 'NVIDIA' | 'Gemini' | 'Groq' | 'Cerebras' | 'SambaNova' | 'OpenRouter' | 'Kimi' | 'Requesty' | 'Local' | 'Colab' | 'Pollinations' | 'Custom';
  baseApi?: string;
  source?: 'api-target' | 'direct' | 'alias';
  modelId?: string;
  contextWindow?: number;
  endpointId?: string;
  apiKeyIndex?: number;
  profileId?: string;
}

const FRIENDLY_MODEL_NAMES: Record<string, string> = {
  'dots-studio/dots-3-note-preview': 'Dots 3 Note Preview',
  'gemini-3.6-flash': 'Gemini 3.6 Flash',
  'qwen3.8-27b-iq3s': 'Qwen 27B IQ3S',
  'openrouter/free': 'OpenRouter Free Model Router',
};

const CONTEXT_WINDOWS: Record<string, number> = {
  'dots-studio/dots-3-note-preview': 512_000,
  'gemini-3.6-flash': 1_000_000,
  'qwen3.8-27b-iq3s': 32_768,
};

const normalizedModelId = (option: ModelOption): string =>
  (option.modelId || option.value || '')
    .trim()
    .toLowerCase()
    .replace(/^(?:openrouter|nvidia|gemini|groq|kimi|requesty|local|colab|pollinations):/, '')
    .replace(/:free$/, '');

const humanizeModelId = (modelId: string): string => {
  const parts = modelId.split('/').filter(Boolean);
  const slug = parts[parts.length - 1] || modelId;
  return slug.split(/[-_]+/).filter(Boolean).map((part) => {
    if (/^(?:iq\d+s|vl|oss|api|ai|llm|it)$/i.test(part)) return part.toUpperCase();
    if (/^\d+[bmk]$/i.test(part)) return part.slice(0, -1) + part.slice(-1).toUpperCase();
    return part[0].toUpperCase() + part.slice(1);
  }).join(' ');
};

export function getModelOptionTier(option: ModelOption): 'Free' | 'Local' | 'Paid' {
  if (option.provider === 'Local' || option.provider === 'Colab'
      || /^(?:local|colab)(?:-target)?:/i.test(option.value)) return 'Local';
  if (/(?:^|[/:])free(?:$|[/:])|:free$/i.test(option.value)
      || /\(free\)/i.test(option.label)) return 'Free';
  return 'Paid';
}

export function getModelOptionContextWindow(option: ModelOption): number | undefined {
  if (Number.isFinite(option.contextWindow) && (option.contextWindow || 0) > 0) return option.contextWindow;
  const modelId = normalizedModelId(option);
  const knownWindow = CONTEXT_WINDOWS[modelId];
  if (knownWindow) return knownWindow;
  if (option.provider === 'Gemini' && /^gemini-(?:2\.5|3)/i.test(modelId)) return 1_000_000;
  return undefined;
}

const compactContextWindow = (tokens: number): string => {
  if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) return `${tokens / 1_000_000}m`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return tokens.toLocaleString();
};

export function getModelOptionContextLabel(option: ModelOption): string {
  const contextWindow = getModelOptionContextWindow(option);
  return contextWindow ? `${compactContextWindow(contextWindow)} context` : 'Context size not reported';
}

export function getModelOptionDisplayLabel(option: ModelOption): string {
  const modelId = normalizedModelId(option);
  const knownName = FRIENDLY_MODEL_NAMES[modelId];
  const labelParts = option.label.split(/\s+(?:·|-)\s+/);
  const labelName = labelParts[0]?.trim() || '';
  const looksLikeId = /[/:]/.test(labelName) || /^(?:openrouter|local|colab|nvidia|gemini):/i.test(labelName);
  const name = knownName || (looksLikeId ? humanizeModelId(modelId) : labelName);
  const contextWindow = getModelOptionContextWindow(option);
  const contextLabel = contextWindow ? `${compactContextWindow(contextWindow)} ctx` : 'ctx unreported';
  const accountLabel = option.profileId
    ? ` · ${option.profileId}`
    : option.source === 'api-target' && Number.isInteger(option.apiKeyIndex)
      && option.provider !== 'Local' && option.provider !== 'Colab' && option.provider !== 'Pollinations'
      ? ` · Account ${(option.apiKeyIndex || 0) + 1}`
      : '';
  return `${name} [${getModelOptionTier(option)} · ${contextLabel}]${accountLabel}`;
}

/**
 * Return the provider/model identity used by the coder selector.
 * Saved API-pool targets use target ids as their select value while shipped
 * routes use the raw model id, so comparing `value` alone makes duplicates.
 */
export function getModelOptionIdentity(option: ModelOption): string {
  const provider = option.provider || 'Custom';
  let modelId = (option.modelId || option.value || '').trim().toLowerCase();
  if (provider === 'OpenRouter' && modelId.startsWith('openrouter:')) {
    modelId = modelId.slice('openrouter:'.length);
  }
  // NVIDIA and Gemini model targets can point at the same model through
  // different configured API accounts. A direct route has no key index and
  // represents the primary account, so keep it equivalent to key 0 while
  // preserving key 1/2/... as distinct selectable routes.
  const credentialIdentity = provider === 'NVIDIA' || provider === 'Gemini'
    ? `:key-${Number.isInteger(option.apiKeyIndex) ? option.apiKeyIndex : 0}`
    : '';
  return `${provider.toLowerCase()}:${modelId}${credentialIdentity}`;
}

/**
 * Keep one selectable route per provider/model while preserving the current
 * selection when it is one of several equivalent route values. Configured
 * API-pool targets win over shipped direct entries for new selections.
 */
export function dedupeModelOptions(options: ModelOption[], preferredValue?: string): ModelOption[] {
  const unique = new Map<string, { option: ModelOption; score: number }>();

  for (const option of options) {
    const identity = getModelOptionIdentity(option);
    const score = (option.value === preferredValue ? 4 : 0) + (option.source === 'api-target' ? 2 : 0);
    const existing = unique.get(identity);
    if (!existing || score > existing.score) unique.set(identity, { option, score });
  }

  return Array.from(unique.values(), ({ option }) => option);
}

export const NVIDIA_BASE_API = "https://integrate.api.nvidia.com/v1";
export const GEMINI_BASE_API = "https://generativelanguage.googleapis.com/v1beta";
export const POLLINATIONS_BASE_API = "https://gen.pollinations.ai";
export const OPENROUTER_BASE_API = "https://openrouter.ai/api/v1";
export const GROQ_BASE_API = "https://api.groq.com/openai/v1";
export const CEREBRAS_BASE_API = "https://api.cerebras.ai/v1";
export const SAMBANOVA_BASE_API = "https://api.sambanova.ai/v1";
export const KIMI_BASE_API = "https://api.moonshot.ai/v1";
export const REQUESTY_BASE_API = "https://router.requesty.ai/v1";
export const LOCAL_BASE_API = "http://localhost:8080/v1";
// The server replaces this with the persisted provider setting during model
// target hydration. Keep the same first-load fallback as the backend.
export const DEFAULT_CODER_MODEL_SELECTION = "openrouter:openrouter/free";

const NVIDIA_MODEL_SELECTION_REPLACEMENTS: Record<string, string> = {
  "deepseek-ai/deepseek-v4-flash": "deepseek-ai/deepseek-v4-flash-0731",
};

export function normalizeCoderModelSelection(
  value: unknown,
  fallback = DEFAULT_CODER_MODEL_SELECTION,
): string {
  const selected = typeof value === "string" ? value.trim() : "";
  if (!selected || /^groq-target:key-\d+$/i.test(selected) || selected === "openrouter:dots-studio/dots-3-note-preview:free") return fallback;
  const normalized = selected.toLowerCase();
  return NVIDIA_MODEL_SELECTION_REPLACEMENTS[normalized]
    || LEGACY_CODER_GEMINI_ALIASES[normalized]
    || selected;
}

const NVIDIA_DIRECT_MODELS = new Set([
  "nvidia/nemotron-3-ultra-550b-a55b",
  "nvidia/nemotron-3-super-120b-a12b",
  "poolside/laguna-xs-2.1",
  "minimaxai/minimax-m3",
  "z-ai/glm-5.2",
  "deepseek-ai/deepseek-v4-flash",
  "deepseek-ai/deepseek-v4-flash-0731",
  "stepfun-ai/step-3.7-flash",
  "google/gemma-4-31b-it",
  "google/diffusiongemma-26b-a4b-it",
  "moonshotai/kimi-k2.6",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "nvidia/nemotron-3-nano-30b-a3b",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  "nvidia/nvidia-nemotron-nano-9b-v2",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "mistralai/mistral-nemotron",
  "thinkingmachines/inkling",
  "nvidia/llama-3.3-nemotron-super-49b-v1",
  "nvidia/llama-3.1-nemotron-nano-8b-v1",
  "nvidia/llama-3.1-nemotron-nano-vl-8b-v1",
]);

const GEMINI_DIRECT_MODELS = new Set([
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite",
]);

const LEGACY_CODER_GEMINI_ALIASES: Record<string, string> = {
  gemini: "gemini-3.5-flash-lite",
  "gemini-fast": "gemini-3.5-flash-lite",
  "gemini-2.5-pro": "gemini-3.1-pro-preview",
  "gemini-2.5-flash": "gemini-3.5-flash",
  "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
  "gemini-flash-lite-3.1": "gemini-3.1-flash-lite",
  "gemini-large": "gemini-3.1-pro-preview",
  "gemini-3-flash": "gemini-3.5-flash",
};

export function withBaseApi(option: ModelOption): ModelOption {
  if (option.provider && option.baseApi) return option;
  if (option.value.startsWith("nvidia-target:") || NVIDIA_DIRECT_MODELS.has(option.value)) {
    return {
      ...option,
      provider: "NVIDIA",
      baseApi: NVIDIA_BASE_API,
      source: option.source || (option.value.startsWith("nvidia-target:") ? "api-target" : "direct"),
    };
  }
  if (option.value.startsWith("gemini-target:") || GEMINI_DIRECT_MODELS.has(option.value)) {
    return {
      ...option,
      provider: "Gemini",
      baseApi: GEMINI_BASE_API,
      source: option.source || (option.value.startsWith("gemini-target:") ? "api-target" : "direct"),
    };
  }
  if (option.value.startsWith("openrouter:")) {
    return { ...option, provider: "OpenRouter", baseApi: OPENROUTER_BASE_API, source: option.source || "direct" };
  }
  if (option.value.startsWith("groq:")) {
    return {
      ...option,
      provider: "Groq",
      baseApi: GROQ_BASE_API,
      source: option.source || "direct",
    };
  }
  if (option.value.startsWith("kimi:")) {
    return { ...option, provider: "Kimi", baseApi: KIMI_BASE_API, source: option.source || "direct" };
  }
  if (option.value.startsWith("requesty:")) {
    return { ...option, provider: "Requesty", baseApi: REQUESTY_BASE_API, source: option.source || "direct" };
  }
  if (option.value.startsWith("local-target:") || option.value.startsWith("local:")) {
    return { ...option, provider: "Local", baseApi: option.baseApi || LOCAL_BASE_API, source: option.source || "api-target" };
  }
  if (option.value.startsWith("cerebras:")) {
    return {
      ...option,
      provider: "Cerebras",
      baseApi: CEREBRAS_BASE_API,
      source: option.source || "direct",
    };
  }
  if (option.value.startsWith("sambanova:")) {
    return {
      ...option,
      provider: "SambaNova",
      baseApi: SAMBANOVA_BASE_API,
      source: option.source || "direct",
    };
  }
  if (option.value.startsWith("colab-target:")) {
    return { ...option, provider: "Colab", baseApi: option.baseApi, source: option.source || "api-target" };
  }
  return { ...option, provider: "Pollinations", baseApi: POLLINATIONS_BASE_API, source: option.source || "alias" };
}

export const POLLINATIONS_TEXT_MODEL_OPTIONS: ModelOption[] = [
  { value: "nvidia/nemotron-3-ultra-550b-a55b", label: "NVIDIA Nemotron 3 Ultra 550B" },
  { value: "nvidia/nemotron-3-super-120b-a12b", label: "NVIDIA Nemotron 3 Super 120B" },
  { value: "poolside/laguna-xs-2.1", label: "NVIDIA Poolside Laguna XS 2.1" },
  { value: "minimaxai/minimax-m3", label: "NVIDIA MiniMax M3" },
  { value: "z-ai/glm-5.2", label: "NVIDIA Z.ai GLM-5.2" },
  { value: "deepseek-ai/deepseek-v4-flash-0731", label: "NVIDIA DeepSeek V4 Flash 0731" },
  { value: "stepfun-ai/step-3.7-flash", label: "NVIDIA Step 3.7 Flash" },
  { value: "google/gemma-4-31b-it", label: "NVIDIA Google Gemma 4 31B IT" },
  { value: "google/diffusiongemma-26b-a4b-it", label: "NVIDIA Google DiffusionGemma 26B A4B IT" },
  { value: "moonshotai/kimi-k2.6", label: "NVIDIA Moonshot Kimi K2.6" },
  { value: "nvidia/nemotron-3-nano-30b-a3b", label: "NVIDIA Nemotron 3 Nano 30B" },
  { value: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", label: "NVIDIA Nemotron 3 Nano Omni 30B" },
  { value: "nvidia/nvidia-nemotron-nano-9b-v2", label: "NVIDIA Nemotron Nano 9B V2" },
  { value: "nvidia/llama-3.3-nemotron-super-49b-v1.5", label: "NVIDIA Llama 3.3 Nemotron Super 49B" },
  { value: "openai/gpt-oss-120b", label: "NVIDIA GPT OSS 120B" },
  { value: "openai/gpt-oss-20b", label: "NVIDIA GPT OSS 20B" },
  { value: "mistralai/mistral-nemotron", label: "NVIDIA Mistral Nemotron" },
  { value: "thinkingmachines/inkling", label: "NVIDIA Thinking Machines Inkling" },
  { value: "nvidia/llama-3.3-nemotron-super-49b-v1", label: "NVIDIA Llama 3.3 Nemotron Super 49B V1" },
  { value: "nvidia/llama-3.1-nemotron-nano-8b-v1", label: "NVIDIA Llama 3.1 Nemotron Nano 8B" },
  { value: "nvidia/llama-3.1-nemotron-nano-vl-8b-v1", label: "NVIDIA Llama 3.1 Nemotron Nano VL 8B" },
  { value: "openrouter:openrouter/free", label: "OpenRouter Free Models Router" },
  { value: "openrouter:inclusionai/ling-3.0-flash-fin:free", label: "OpenRouter InclusionAI Ling 3.0 Flash Fin (Free)" },
  { value: "openrouter:inclusionai/ling-3.0-flash-sante:free", label: "OpenRouter InclusionAI Ling 3.0 Flash Sante (Free)" },
  { value: "openrouter:cohere/north-mini-code:free", label: "OpenRouter Cohere North Mini Code (Free)" },
  { value: "openrouter:nvidia/nemotron-3-ultra-550b-a55b:free", label: "OpenRouter NVIDIA Nemotron 3 Ultra (Free)" },
  { value: "openrouter:nvidia/nemotron-3-super-120b-a12b:free", label: "OpenRouter NVIDIA Nemotron 3 Super (Free)" },
  { value: "openrouter:poolside/laguna-s-2.1:free", label: "OpenRouter Poolside Laguna S 2.1 (Free)" },
  { value: "openrouter:poolside/laguna-xs-2.1:free", label: "OpenRouter Poolside Laguna XS 2.1 (Free)" },
  { value: "openrouter:thinkingmachines/inkling:free", label: "OpenRouter Thinking Machines Inkling (Free)" },
  { value: "openrouter:dots-studio/dots-3-note-preview:free", label: "OpenRouter Dots 3 Note Preview (Free)" },
  { value: "cerebras:gpt-oss-120b", label: "Cerebras GPT OSS 120B" },
  { value: "sambanova:gpt-oss-120b", label: "SambaNova GPT OSS 120B" },
  { value: "openrouter:google/gemma-4-26b-a4b-it:free", label: "OpenRouter Google Gemma 4 26B A4B IT (Free)" },
  { value: "openrouter:google/gemma-4-31b-it:free", label: "OpenRouter Google Gemma 4 31B IT (Free)" },
  { value: "gemini-3.6-flash", label: "Gemini (Native) 3.6 Flash" },
  { value: "gemini-3.5-flash-lite", label: "Gemini (Native) 3.5 Flash-Lite" },
  { value: "gemini-3.5-flash", label: "Gemini (Native) 3.5 Flash" },
  { value: "gemini-3.1-pro-preview", label: "Gemini (Native) 3.1 Pro Preview" },
  { value: "gemini-3.1-flash-lite", label: "Gemini (Native) 3.1 Flash-Lite" },
  { value: "qwen-safety", label: "Qwen3Guard 8B" },
  { value: "nova-fast", label: "Nova Micro" },
  { value: "gemini-fast", label: "Gemini 3.5 Flash-Lite" },
  { value: "mistral-small-3.2", label: "Mistral Small 3.2" },
  { value: "gemini-search", label: "Google Gemini 2.5 Flash Lite Search" },
  { value: "llama-scout", label: "Meta Llama 4 Scout" },
  { value: "mistral", label: "Mistral Small 4" },
  { value: "qwen-coder", label: "Qwen3 Coder 30B" },
  { value: "gemma", label: "Gemma 4 26B A4B" },
  { value: "openai", label: "GPT-5.4 Nano" },
  { value: "qwen-coder-large", label: "Qwen3 Coder Next" },
  { value: "qwen-vision", label: "Qwen3 VL 30B A3B Instruct" },
  { value: "gemini-flash-lite-3.1", label: "Gemini 3.1 Flash Lite" },
  { value: "openai-fast", label: "GPT-5 Nano" },
  { value: "llama", label: "Meta Llama 3.3 70B" },
  { value: "minimax-m2.7", label: "MiniMax M2.7" },
  { value: "perplexity-fast", label: "Perplexity Sonar" },
  { value: "step-3.5-flash", label: "StepFun Step 3.5 Flash" },
  { value: "gemini-search-fast", label: "Gemini 3.1 Flash Lite Search" },
  { value: "deepseek", label: "DeepSeek V4 Flash (Lite)" },
  { value: "perplexity-deep", label: "Perplexity Sonar Deep" },
  { value: "nova", label: "Nova 2 Lite" },
  { value: "midijourney", label: "MIDIjourney" },
  { value: "step-flash", label: "StepFun Step 3.7 Flash" },
  { value: "llama-maverick", label: "Meta Llama 4 Maverick" },
  { value: "grok", label: "Grok 4.20 Non-Reasoning" },
  { value: "mistral-large", label: "Mistral Large 3" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { value: "qwen-vision-pro", label: "Qwen3 VL 235B A22B Thinking" },
  { value: "openai-audio", label: "GPT Audio Mini" },
  { value: "gemini-3-flash", label: "Gemini 3 Flash" },
  { value: "grok-large", label: "Grok 4.3" },
  { value: "minimax", label: "MiniMax M3" },
  { value: "openai-audio-large", label: "GPT Audio 1.5" },
  { value: "grok-4-20-reasoning", label: "Grok 4.20 Reasoning" },
  { value: "claude-fast", label: "Claude Haiku 4.5" },
  { value: "qwen-large", label: "Qwen3.7 Plus" },
  { value: "perplexity", label: "Perplexity Sonar Pro" },
  { value: "perplexity-reasoning", label: "Perplexity Sonar Reasoning" },
  { value: "kimi", label: "Moonshot Kimi K2.6" },
  { value: "gemini", label: "Gemini 3.5 Flash" },
  { value: "glm", label: "Z.ai GLM-5.2" },
  { value: "deepseek-pro", label: "DeepSeek V4 Pro" },
  { value: "midijourney-large", label: "MIDIjourney Large" },
  { value: "openai-large", label: "GPT-5.5" },
  { value: "kimi-code", label: "Moonshot Kimi K2.7 Code" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gemini-large", label: "Gemini 3.1 Pro" },
  { value: "gemini-search-large", label: "Gemini 3.5 Flash Search" },
  { value: "claude", label: "Claude Sonnet 4.6" },
  { value: "claude-opus-4.6", label: "Claude Opus 4.6" },
  { value: "claude-opus-4.7", label: "Claude Opus 4.7" },
  { value: "claude-large", label: "Claude Opus 4.8" },
  { value: "mercury", label: "Mercury 2" },
  { value: "polly", label: "Polly by @Itachi-1824" },
];
