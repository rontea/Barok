module.exports = {
  NVIDIA_BASE_API: 'https://integrate.api.nvidia.com/v1',
  DEFAULT_CODER_MODEL_SELECTION: 'z-ai/glm-5.2',
  GROQ_BASE_API: 'https://api.groq.com/openai/v1',
  KIMI_BASE_API: 'https://api.moonshot.ai/v1',
  OPENROUTER_BASE_API: 'https://openrouter.ai/api/v1',
  REQUESTY_BASE_API: 'https://router.requesty.ai/v1',
  SAMBANOVA_BASE_API: 'https://api.sambanova.ai/v1',
  GEMINI_BASE_API: 'https://generativelanguage.googleapis.com/v1beta',
  POLLINATIONS_TEXT_MODEL_OPTIONS: [
    { value: 'openai-fast', label: 'OpenAI Fast' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  ],
  withBaseApi: (option) => ({
    ...option,
    provider: option.provider || 'Pollinations',
    baseApi: option.baseApi || 'https://gen.pollinations.ai',
  }),
  dedupeModelOptions: (options, preferredValue) => {
    const unique = new Map();
    for (const option of options) {
      const provider = option.provider || 'Custom';
      const modelId = String(option.modelId || option.value || '').toLowerCase();
      const identity = `${provider.toLowerCase()}:${modelId}`;
      const score = (option.value === preferredValue ? 4 : 0) + (option.source === 'api-target' ? 2 : 0);
      const existing = unique.get(identity);
      if (!existing || score > existing.score) unique.set(identity, { option, score });
    }
    return Array.from(unique.values(), ({ option }) => option);
  },
};
