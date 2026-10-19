/** Provider request/result metadata shared by Engine and host adapters. */
export interface LLMRequestTelemetry {
  provider: string;
  model: string;
  requestKind?: string;
  startedAt: number;
  durationMs: number;
  status: 'succeeded' | 'failed' | 'timed_out' | 'cancelled' | 'skipped_budget';
  maxTokens?: number;
  error?: string;
  attempt?: number;
  keyLabel?: string;
  allocatedBudgetMs?: number;
  remainingBudgetMs?: number;
  classification?: string;
  fallbackDecision?: string;
  credentialIndex?: number;
  healthScore?: number;
  profileId?: string;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  cacheHit?: boolean;
  retry?: boolean;
  role?: string;
  requestId?: string;
  stream?: boolean;
  retryCount?: number;
  reportedInputTokens?: number;
  reportedOutputTokens?: number;
  queueWaitMs?: number;
  cooldownUntil?: string;
  resolvedModel?: string;
  fallbackUsed?: boolean;
  requestedModels?: string[];
  promptPrefillDurationMs?: number;
}

export interface LLMToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface RateLimitSnapshot {
  remainingRequests?: number;
  remainingTokens?: number;
  requestResetAt?: string;
  tokenResetAt?: string;
  retryAfterMs?: number;
}

export interface LLMCompletionResult {
  text: string;
  toolCalls: LLMToolCall[];
  /** Provider-labelled, bounded summary only; never a raw reasoning trace. */
  reasoningSummary?: string;
  finishReason?: string;
  usage?: LLMUsage;
  provider: string;
  model: string;
  requestId?: string;
  rateLimit?: RateLimitSnapshot;
  cacheHit?: boolean;
  promptPrefillDurationMs?: number;
}

export type LLMCompletionStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call_delta'; index: number; id?: string; name?: string; argumentsDelta?: string }
  /** Provider-labelled summary text only; raw reasoning fields are never streamed. */
  | { type: 'reasoning_summary_delta'; delta: string; source: 'provider' | 'native' }
  | { type: 'usage'; usage: LLMUsage }
  | { type: 'completed'; result: LLMCompletionResult }
  | { type: 'error'; error: { code: string; message: string; requestId?: string } };
