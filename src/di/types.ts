/**
 * Dependency Injection Types
 * Defines all interfaces for injectable dependencies
 */

import type { LLMCompletionResult, LLMCompletionStreamEvent, LLMRequestTelemetry, LLMToolCall, LLMUsage, RateLimitSnapshot } from '@barok/engine';
export type { LLMCompletionResult, LLMCompletionStreamEvent, LLMRequestTelemetry, LLMToolCall, LLMUsage, RateLimitSnapshot } from '@barok/engine';

/**
 * LLM Provider Interface
 * Abstraction for language model providers (Gemini, Pollinations, etc.)
 */
export type LLMReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface LLMReasoningOptions {
  /** Normalized effort requested from providers that support native reasoning. */
  effort?: LLMReasoningEffort;
  /** Optional provider-side reasoning token budget. */
  maxTokens?: number;
  /** Ask providers for a concise, provider-generated summary when supported. */
  summary?: 'concise';
  /** Keep native reasoning out of the transport response when no summary is needed. */
  exclude?: boolean;
}

export interface ModelCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  jsonMode: boolean;
  vision: boolean;
  contextTokenLimit?: number;
  outputTokenLimit?: number;
}

export type ProviderHealthState = 'available' | 'degraded' | 'cooldown' | 'disabled' | 'misconfigured';

export interface ProviderHealth {
  state: ProviderHealthState;
  credentialState: 'configured' | 'not_configured' | 'invalid';
  message: string;
  model?: string;
  cooldownUntil?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastErrorCode?: string;
}

/** Internal monotonic request budget shared by provider fallback and rotation. */
export interface LLMRequestBudget {
  readonly signal: AbortSignal;
  remainingMs(): number;
  /** Number of provider transport calls still allowed for this routed task. */
  remainingRequests(): number;
  /** Atomically reserve one provider transport call. */
  tryConsumeRequest(): boolean;
  cleanup(): void;
}

export interface LLMCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  reasoning?: LLMReasoningOptions;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** @internal Maximum quiet period between streamed local-model payloads. */
  idleTimeoutMs?: number;
  /** @internal Overall ceiling used with an idle timeout for long local generations. */
  overallTimeoutMs?: number;
  requestKind?: string;
  /** Estimated prompt tokens by bounded planner section; contains counts only. */
  categoryTokens?: {
    task: number;
    plan: number;
    evidence: number;
    activeErrors: number;
    memory: number;
    history: number;
    system: number;
  };
  /** Stable harness request identity shared by telemetry and lifecycle events. */
  requestId?: string;
  onTelemetry?: (telemetry: LLMRequestTelemetry) => void;
  /** Internal metadata channel used to preserve safe provider summaries. */
  onCompletionResult?: (result: LLMCompletionResult) => void;
  /** @internal Minimum spacing between provider routes inside one fallback request. */
  minimumRouteIntervalMs?: number;
  /** @internal Suppress structured-route reasoning payloads for non-reasoning recovery models. */
  disableOpenRouterReasoning?: boolean;
  /** @internal Disable local-model thinking for short probes or structured action requests. */
  disableLocalThinking?: boolean;
  /** @internal Ask OpenAI-compatible local servers to reuse their prompt KV cache. */
  cachePrompt?: boolean;
  /** @internal Structured action phase used by adaptive local output budgets. */
  structuredActionClass?: 'inspection' | 'recovery' | 'implementation';
  /** @internal Selected run pacing profile. */
  pacingProfile?: 'automatic' | 'conservative' | 'phased' | 'fast';
  /**
   * Permit one explicit probe of a locally rate-limited route. Fast runs use
   * this for a new run/Continue action; it never enables automatic retry loops.
   */
  allowProviderRouteProbe?: boolean;
  /** @internal Reports an intentional wait without counting it as an LLM attempt. */
  onPacingWait?: (event: { delayMs: number; provider?: string; model?: string; scope: 'request' | 'fallback' | 'free_tier_key_cooldown' }) => void;
  /** @internal Shared end-to-end deadline. Callers should normally set timeoutMs. */
  requestBudget?: LLMRequestBudget;
  /** Maximum provider transport calls across retries and fallbacks for this routed task. */
  requestLimit?: number;
  /** Queue priority from 0 (background) to 100 (critical). */
  queuePriority?: number;
  /** Optional override for NVIDIA's process-wide per-model concurrency cap. */
  nvidiaMaxConcurrentRequestsPerModel?: number;
  /** @internal Select one zero-based NVIDIA key for an explicit fallback route. */
  nvidiaApiKeyIndex?: number;
  /** @internal Select one zero-based Gemini key for an explicit fallback route. */
  geminiApiKeyIndex?: number;
  /** Explicit Gemini account profile. It remains fixed for the whole request. */
  geminiProfileId?: string;
  /** Stable task/run identifier for provider usage and audit telemetry. */
  taskId?: string;
  workspaceId?: string;
  repositoryCommitHash?: string;
  userId?: string;
  toolSchemaVersion?: string;
  /** Enable response caching only for safe, reusable request kinds. */
  cacheable?: boolean;
  cacheTtlMs?: number;
  /** Stable step identity used to suppress duplicate frontend/backend delivery. */
  stepId?: string;
  attemptGeneration?: number;
  role?: 'fast' | 'classifier' | 'summarizer' | 'planner' | 'coder' | 'reviewer' | 'repair';
  stream?: boolean;
  onStreamEvent?: (event: LLMCompletionStreamEvent) => void;
  responseFormat?: 'text' | 'json';
  requiresVision?: boolean;
  privateWorkspace?: boolean;
  sendPrivateSourceCode?: boolean;
  allowedExternalProviders?: string[];
  fallbackApprovalGranted?: boolean;
  outboundSecretPolicy?: 'redact' | 'block' | 'require_approval';
  outboundSecretApprovalGranted?: boolean;
  /** Cross-provider fallback requires an explicit task/workspace policy. */
  allowCrossProviderFallback?: boolean;
  /**
   * Keep every transport attempt on the requested model ID. Agent requests
   * set this to true; credential/account retries remain allowed.
   */
  pinModel?: boolean;
  /**
   * Permit a bounded same-provider free-tier handoff when the selected
   * NVIDIA route is unavailable or stalls. The selected model remains first.
   */
  freeTierResilience?: boolean;
  /** @internal Allows agent-pinned NVIDIA requests to use the bounded same-provider fallback. */
  allowNvidiaModelFallback?: boolean;
  approvedFallbackProviders?: string[];
  /** Ordered, compatible model recovery routes that remain on the selected provider/account. */
  sameProviderFallbackModels?: string[];
  /** @internal Announces a model-level fallback before its transport call begins. */
  onRouteSelected?: (route: { provider: string; requestedTarget: string; resolvedModel: string; profileId?: string; credentialIndex?: number; reason: 'same_provider_model' }) => void;
  /** Optional OpenAI-compatible function tools for providers that support them. */
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
    };
  }>;
  toolChoice?: 'auto' | 'required';
}

export interface LLMProvider {
  /**
   * Create a chat completion response
   */
  createChatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options?: LLMCompletionOptions
  ): Promise<string>;

  /** Optional structured result path; string consumers remain supported. */
  createChatCompletionResult?(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options?: LLMCompletionOptions
  ): Promise<LLMCompletionResult>;

  /** Optional normalized streaming path. */
  streamChatCompletion?(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options?: LLMCompletionOptions
  ): AsyncIterable<LLMCompletionStreamEvent>;

  getModelCapabilities?(model: string): ModelCapabilities | undefined;
  getHealth?(): ProviderHealth;

  /**
   * Estimate the cost of a step
   */
  estimateStepCost(model: string): number;

  /**
   * Get the provider name
   */
  getProviderName(): string;

  /**
   * Check if provider is available (has required API key)
   */
  isAvailable(): boolean;
}

/**
 * Tool Definition with Handler
 */
import type { ToolCapabilities } from '@barok/engine';
import type { CapabilityScope } from '../react/capability-scope.js';

export interface ToolHandlerContext {
  scope?: CapabilityScope;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  handler: (params: unknown, signal?: AbortSignal, context?: ToolHandlerContext) => Promise<unknown>;
  /** Engine-owned execution metadata shared by every transport. */
  capabilities?: ToolCapabilities;
  /** Optional explicit timeout override for provider or integration tools. */
  timeoutMs?: number;
}

/**
 * Tool Registry Interface
 * Abstraction for managing available tools
 */
export interface ToolRegistry {
  /**
   * Get all available tools
   */
  getAll(): ToolDefinition[];

  /**
   * Get a specific tool by name
   */
  get(name: string): ToolDefinition | undefined;

  /**
   * Get enabled tools
   */
  getEnabled(): ToolDefinition[];

  /**
   * Check if a tool exists
   */
  has(name: string): boolean;

  /**
   * Register a new tool
   */
  register(tool: ToolDefinition): void;

  /**
   * Enable/disable a tool
   */
  setEnabled(name: string, enabled: boolean): void;

  /**
   * Get tool names
   */
  getNames(): string[];

  /**
   * Get tool count
   */
  size(): number;
}

/**
 * Run Report for logging
 */
export interface RunReport {
  id: string;
  task: string;
  result: string;
  error?: string;
  steps: Array<{
    action: string;
    result: string;
    reasoning: string;
  }>;
  metadata: {
    model: string;
    startTime: number;
    endTime: number;
    estimatedCost: number;
    actualCost?: number;
    tokensUsed?: {
      prompt: number;
      completion: number;
    };
  };
}

/**
 * Execution Logger Interface
 * Abstraction for logging execution runs
 */
export interface ExecutionLogger {
  /**
   * Record a completed run
   */
  recordRun(report: RunReport): Promise<void>;

  /**
   * Get recent runs
   */
  getRecentRuns(limit?: number): Promise<RunReport[]>;

  /**
   * Get a specific run
   */
  getRun(id: string): Promise<RunReport | null>;

  /** Persist a redacted malformed provider-response protocol audit. */
  recordProtocolAudit?(audit: {
    type: string;
    protocolVersion: number;
    provider: string;
    errors: string[];
    recoverable: boolean;
    rawRedacted: string;
  }, runId?: string): Promise<void>;

  /**
   * Clear runs (for testing)
   */
  clear?(): Promise<void>;
}

/**
 * Structured Logger Interface
 * Abstraction for general logging
 */
export interface StructuredLogger {
  /**
   * Start a request
   */
  startRequest(id: string, task: string): void;

  /**
   * End a step
   */
  endStep(id: string, stepNumber: number, action: string, result: string, reasoning: string): void;

  /**
   * End a request
   */
  endRequest(
    id: string,
    result: string,
    error?: string,
    metadata?: Record<string, unknown>
  ): void;

  /**
   * Flush logs
   */
  flush(): Promise<void>;

  /**
   * Log a message
   */
  log(level: 'info' | 'debug' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void;
}

/**
 * Storage Interface
 * Abstraction for persistent storage
 */
export interface Storage {
  /**
   * Save data
   */
  save(key: string, data: unknown): Promise<void>;

  /**
   * Load data
   */
  load(key: string): Promise<unknown | null>;

  /**
   * Delete data
   */
  delete(key: string): Promise<void>;

  /**
   * Check if key exists
   */
  has(key: string): Promise<boolean>;

  /**
   * List all keys
   */
  keys(): Promise<string[]>;

  /**
   * Clear all storage
   */
  clear?(): Promise<void>;
}

/**
 * Dependency Container
 * Central registry for all dependencies
 */
export interface DIContainer {
  /**
   * Get LLM provider instance
   */
  getLLMProvider(): LLMProvider;

  /**
   * Get tool registry instance
   */
  getToolRegistry(): ToolRegistry;

  /**
   * Get execution logger instance
   */
  getExecutionLogger(): ExecutionLogger;

  /**
   * Get structured logger instance
   */
  getStructuredLogger(): StructuredLogger;

  /**
   * Get storage instance
   */
  getStorage(): Storage;

  /**
   * Get provider fallback manager instance
   */
  getFallbackManager?(): unknown; // ProviderFallbackManager type (to avoid circular imports)

  /**
   * Register a dependency
   */
  register<T>(key: string, factory: () => T): void;

  /**
   * Get a registered dependency
   */
  get<T>(key: string): T | undefined;

  /**
   * Check if dependency is registered
   */
  has(key: string): boolean;

  /**
   * Clear all registrations
   */
  clear(): void;
}

/**
 * DIContainer Configuration Options
 */
export interface DIContainerOptions {
  /**
   * API keys for providers
   */
  apiKeys?: {
    pollinations?: string;
    gemini?: string;
    nvidia?: string;
    nvidiaPool?: string;
    openrouter?: string;
    groq?: string;
    cerebras?: string;
    sambanova?: string;
    requesty?: string;
    /** @deprecated Production Gemini routing uses explicit account profiles. */
    geminiPool?: string;
  };

  /**
   * LLM providers to use (in fallback order)
   */
  llmProviders?: LLMProvider[];

  /**
   * Tool registry instance
   */
  toolRegistry?: ToolRegistry;

  /**
   * Execution logger instance
   */
  executionLogger?: ExecutionLogger;

  /**
   * Structured logger instance
   */
  structuredLogger?: StructuredLogger;

  /**
   * Storage instance
   */
  storage?: Storage;

  /**
   * Workspace root path
   */
  workspaceRoot?: string;

  /**
   * Enable debug logging
   */
  debug?: boolean;
}
