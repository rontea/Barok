/**
 * Budget Management Module
 * Handles cost estimation, calculation, and budget validation
 */

/**
 * Model pricing table: cost per token
 * Format: { model: { prompt: cost_per_token, completion: cost_per_token } }
 */
export const PRICING_TABLE: Record<string, { prompt: number; completion: number }> = {
  'openai': { prompt: 1.5e-7, completion: 9.375e-7 },
  'openai-fast': { prompt: 3.75e-8, completion: 3e-7 },
  'openai-large': { prompt: 0.0000025, completion: 0.000015 },
  'gpt-5.4-mini': { prompt: 5.625e-7, completion: 0.000003375 },
  'gpt-5.4': { prompt: 0.0000025, completion: 0.000015 },
  'gpt-5.5': { prompt: 0.000005, completion: 0.00003 },
  'mercury': { prompt: 2.5e-7, completion: 7.5e-7 },
  'qwen-fast': { prompt: 6e-8, completion: 2.2e-7 },
  'qwen-coder': { prompt: 6e-8, completion: 2.2e-7 },
  'mistral': { prompt: 7.5e-8, completion: 2e-7 },
  'mistral-small-3.2': { prompt: 7.5e-8, completion: 2e-7 },
  'mistral-4': { prompt: 1.5e-7, completion: 6e-7 },
  'openai-audio': { prompt: 6e-7, completion: 0.0000024 },
  'openai-audio-large': { prompt: 0.0000025, completion: 0.00001 },
  'gemini': { prompt: 5e-7, completion: 0.000003 },
  'gemini-3.6-flash': { prompt: 0.0000015, completion: 0.0000075 },
  'gemini-3.5-flash': { prompt: 0.0000015, completion: 0.000009 },
  'gemini-3-flash': { prompt: 5e-7, completion: 0.000003 },
  'gemini-flash-lite-3.1': { prompt: 2.5e-7, completion: 0.0000015 },
  'gemini-fast': { prompt: 1e-7, completion: 4e-7 },
  'deepseek': { prompt: 1.4e-7, completion: 2.8e-7 },
  'gemma': { prompt: 6e-8, completion: 3.3e-7 },
  'deepseek-pro': { prompt: 0.00000174, completion: 0.00000348 },
  'grok': { prompt: 0.000002, completion: 0.000006 },
  'grok-4-20-reasoning': { prompt: 0.000002, completion: 0.000006 },
  'grok-large': { prompt: 0.000002, completion: 0.000006 },
  'grok-4.3': { prompt: 0.00000125, completion: 0.0000025 },
  'gemini-search': { prompt: 1e-7, completion: 4e-7 },
  'gemini-search-fast': { prompt: 2.5e-7, completion: 0.0000015 },
  'gemini-search-large': { prompt: 0.0000015, completion: 0.000009 },
  'midijourney': { prompt: 5.625e-7, completion: 0.000003375 },
  'midijourney-large': { prompt: 0.000005, completion: 0.00003 },
  'claude-fast': { prompt: 0.000001, completion: 0.000005 },
  'claude': { prompt: 0.000003, completion: 0.000015 },
  'claude-large': { prompt: 0.000005, completion: 0.000025 },
  'claude-opus-4.7': { prompt: 0.000005, completion: 0.000025 },
  'claude-opus-4.8': { prompt: 0.000005, completion: 0.000025 },
  'claude-fable-5': { prompt: 0.00001, completion: 0.00005 },
  'perplexity-fast': { prompt: 0.000001, completion: 0.000001 },
  'perplexity-deep': { prompt: 0.000001, completion: 0.000001 },
  'perplexity': { prompt: 0.000003, completion: 0.000015 },
  'perplexity-reasoning': { prompt: 0.000002, completion: 0.000008 },
  'kimi': { prompt: 6e-7, completion: 0.000003 },
  'kimi-code': { prompt: 6e-7, completion: 0.000003 },
  'kimi-k2.6': { prompt: 9.5e-7, completion: 0.000004 },
  'gemini-large': { prompt: 0.000002, completion: 0.000012 },
  'nova-fast': { prompt: 3.5e-8, completion: 1.4e-7 },
  'nova': { prompt: 3.3e-7, completion: 0.00000275 },
  'glm': { prompt: 0.000001, completion: 0.0000032 },
  'llama': { prompt: 5.325e-7, completion: 5.325e-7 },
  'llama-maverick': { prompt: 1.875e-7, completion: 7.5e-7 },
  'llama-scout': { prompt: 8e-8, completion: 3e-7 },
  'minimax': { prompt: 3e-7, completion: 0.0000012 },
  'minimax-m2.7': { prompt: 3e-7, completion: 0.0000012 },
  'minimax-m3': { prompt: 3e-7, completion: 0.0000012 },
  'mistral-large': { prompt: 3.75e-7, completion: 0.000001125 },
  'qwen-coder-large': { prompt: 3e-7, completion: 0.0000015 },
  'qwen-large': { prompt: 5e-7, completion: 0.000003 },
  'qwen-vision': { prompt: 1.3e-7, completion: 5.2e-7 },
  'qwen-vision-pro': { prompt: 2.6e-7, completion: 0.0000026 },
  'step-flash': { prompt: 2e-7, completion: 0.00000115 },
  'step-3.5-flash': { prompt: 9e-8, completion: 3e-7 },
  'qwen-safety': { prompt: 1e-8, completion: 1e-8 },
  'polly': { prompt: 0, completion: 0 },
};

const COMPUTE_RATE_PER_HOUR = 0.01; // $0.01 per hour
const ESTIMATED_PROMPT_TOKENS_PER_CALL = 3100;
const ESTIMATED_COMPLETION_TOKENS_PER_CALL = 300;
const LLM_CALLS_PER_STEP = 3;

/**
 * Estimate the cost of a single step for a given model
 */
export function estimateModelStepCost(model: string): number {
  const cost = PRICING_TABLE[model] || {
    prompt: 0.000001,
    completion: 0.000005,
  };

  return (
    (cost.prompt * ESTIMATED_PROMPT_TOKENS_PER_CALL +
      cost.completion * ESTIMATED_COMPLETION_TOKENS_PER_CALL) *
    LLM_CALLS_PER_STEP
  );
}

/**
 * Calculate the cost of a step based on token usage
 */
export function calculateStepCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const cost = PRICING_TABLE[model] || {
    prompt: 0.000001,
    completion: 0.000005,
  };

  return cost.prompt * promptTokens + cost.completion * completionTokens;
}

/**
 * Calculate computational time cost
 */
export function calculateTimeCost(elapsedMs: number): number {
  const elapsedHours = elapsedMs / 3600000;
  return COMPUTE_RATE_PER_HOUR * elapsedHours;
}

/**
 * Validate budget is not exceeded
 */
export function validateBudget(spent: number, limit: number): boolean {
  if (limit === Infinity) return true;
  return spent <= limit;
}

/**
 * Get budget status
 */
export function getBudgetStatus(spent: number, limit: number): {
  spent: number;
  remaining: number;
  percentUsed: number;
  isExceeded: boolean;
} {
  return {
    spent,
    remaining: Math.max(0, limit - spent),
    percentUsed: limit === Infinity ? 0 : (spent / limit) * 100,
    isExceeded: !validateBudget(spent, limit),
  };
}

/**
 * Get model pricing info
 */
export function getModelPricing(model: string) {
  return PRICING_TABLE[model] || PRICING_TABLE['claude'];
}

/**
 * Check if model is known
 */
export function isModelKnown(model: string): boolean {
  return model in PRICING_TABLE;
}

/**
 * Get all known models
 */
export function getKnownModels(): string[] {
  return Object.keys(PRICING_TABLE);
}

/**
 * Format cost for display
 */
export function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.0001) return `$${cost.toExponential(2)}`;
  return `$${cost.toFixed(6)}`;
}

/**
 * Format budget for display
 */
export function formatBudget(budget: number): string {
  if (budget === Infinity) return '∞';
  return formatCost(budget);
}
