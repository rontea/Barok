import type {
  LLMCompletionOptions,
  LLMCompletionResult,
  LLMCompletionStreamEvent,
  LLMProvider,
  LLMToolCall,
  LLMUsage,
  ModelCapabilities,
  ProviderHealth,
  RateLimitSnapshot,
} from '../types.js';
import {
  getGroqModelCapabilities,
  loadGroqRuntimeConfigSafe,
  readGroqHealth,
  recordGroqAggregateUsage,
  resolveGroqRoleModel,
  saveGroqHealth,
  type GroqRuntimeConfig,
  type GroqSettings,
} from '../../config/groqConfig.js';
import { isLegacyGroqTargetModelValue } from '../../config/groqTargets.js';
import {
  classifyOpenAICompatibleProviderError,
  NormalizedProviderError,
  redactProviderSecrets,
  type ProviderError,
} from './providerErrors.js';
import { getGroqScheduler, type ProviderSchedulerSnapshot } from './providerScheduler.js';
import {
  createProviderRequestFingerprint,
  getCachedProviderResponse,
  prepareProviderMessages,
  runReliableProviderRequest,
  type ProviderRequestIdentity,
} from './requestReliability.js';
import { updateProviderRateLimitHeaders } from './rateLimitMonitor.js';
import { extractSafeReasoningSummary, extractSafeReasoningSummaryDelta, reportCompletionResult } from '../reasoning.js';

interface GroqTransportOutput {
  result: LLMCompletionResult;
  events?: LLMCompletionStreamEvent[];
  attempts: number;
  queueWaitMs: number;
}

function parseNumberHeader(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseResetHeader(value: string | null): string | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1_000;
    return new Date(milliseconds).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

export function parseRateLimitSnapshot(headers: Headers): RateLimitSnapshot | undefined {
  const remainingRequests = parseNumberHeader(headers, 'x-ratelimit-remaining-requests');
  const remainingTokens = parseNumberHeader(headers, 'x-ratelimit-remaining-tokens');
  const requestResetAt = parseResetHeader(headers.get('x-ratelimit-reset-requests') || headers.get('x-ratelimit-reset'));
  const tokenResetAt = parseResetHeader(headers.get('x-ratelimit-reset-tokens'));
  const retryAfter = headers.get('retry-after');
  const retryAfterMs = retryAfter
    ? Number.isFinite(Number(retryAfter))
      ? Math.max(0, Number(retryAfter) * 1_000)
      : Math.max(0, Date.parse(retryAfter) - Date.now())
    : undefined;
  if ([remainingRequests, remainingTokens, requestResetAt, tokenResetAt, retryAfterMs].every((value) => value === undefined)) {
    return undefined;
  }
  return { remainingRequests, remainingTokens, requestResetAt, tokenResetAt, retryAfterMs };
}

function usageFrom(value: any): LLMUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const inputTokens = Number(value.prompt_tokens);
  const outputTokens = Number(value.completion_tokens);
  const totalTokens = Number(value.total_tokens);
  const usage: LLMUsage = {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : undefined,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : undefined,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : undefined,
  };
  return Object.values(usage).some((entry) => entry !== undefined) ? usage : undefined;
}

function toolCallsFrom(value: any): LLMToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.map((toolCall: any, index: number) => ({
    id: typeof toolCall?.id === 'string' ? toolCall.id : `tool-call-${index}`,
    type: 'function' as const,
    function: {
      name: typeof toolCall?.function?.name === 'string' ? toolCall.function.name : '',
      arguments: typeof toolCall?.function?.arguments === 'string' ? toolCall.function.arguments : '{}',
    },
  })).filter((toolCall) => toolCall.function.name);
}

function publicMessage(error: ProviderError): string {
  const labels: Partial<Record<ProviderError['code'], string>> = {
    AUTHENTICATION_FAILED: 'Groq authentication failed.',
    PERMISSION_DENIED: 'Groq denied access to this model or organization.',
    MODEL_NOT_FOUND: 'The configured Groq model was not found.',
    MODEL_UNAVAILABLE: 'The configured Groq model is unavailable.',
    RATE_LIMITED: 'Groq is rate limited. No other Groq account was used; retry later, approve a non-Groq fallback, or pause.',
    QUOTA_EXHAUSTED: 'Groq quota is exhausted. No other Groq account was used; wait for reset, approve a non-Groq fallback, or pause.',
    REQUEST_TIMEOUT: 'The Groq request timed out.',
    TEMPORARILY_UNAVAILABLE: 'Groq is temporarily unavailable.',
    NETWORK_ERROR: 'The Groq service could not be reached.',
    CANCELLED: 'The Groq request was cancelled.',
    UNSUPPORTED_CAPABILITY: 'The configured Groq model does not support the requested capability.',
    MISCONFIGURED: 'Groq is not configured.',
  };
  return labels[error.code] || redactProviderSecrets(error.safeMessage);
}

function inferRole(requestKind?: string): LLMCompletionOptions['role'] {
  if (!requestKind) return undefined;
  if (/check_done|review/i.test(requestKind)) return 'reviewer';
  if (/final_answer|summari/i.test(requestKind)) return 'summarizer';
  if (/plan\.create|reason/i.test(requestKind)) return 'planner';
  if (/plan_action|classif/i.test(requestKind)) return 'fast';
  if (/repair/i.test(requestKind)) return 'repair';
  if (/code|implement/i.test(requestKind)) return 'coder';
  return undefined;
}

function groqReasoningModelKind(model: string): 'gpt-oss' | 'qwen' | undefined {
  const normalized = model.toLowerCase();
  if (/(?:^|[/:_-])gpt[-_]?oss(?:[/:_-]|$)/i.test(normalized)) return 'gpt-oss';
  if (/(?:^|[/:_-])qwen(?:[/:_-])?qwen3(?:\.6)?[-_/](?:27b|32b)(?:[-_/]|$)/i.test(normalized)) return 'qwen';
  return undefined;
}

function getGroqNativeReasoningFields(
  model: string,
  reasoning?: LLMCompletionOptions['reasoning'],
): Record<string, unknown> | undefined {
  const kind = groqReasoningModelKind(model);
  if (!kind || !reasoning) return undefined;

  if (kind === 'qwen') {
    return {
      reasoning_effort: reasoning.effort === 'none' ? 'none' : 'default',
      reasoning_format: 'hidden',
    };
  }

  if (!reasoning.effort || reasoning.effort === 'none') {
    return { reasoning_format: 'hidden' };
  }
  return {
    reasoning_effort: reasoning.effort === 'minimal' || reasoning.effort === 'low'
      ? 'low'
      : reasoning.effort === 'high' || reasoning.effort === 'xhigh' || reasoning.effort === 'max'
        ? 'high'
        : 'medium',
    reasoning_format: 'hidden',
  };
}

export class GroqLLMProvider implements LLMProvider {
  private readonly injectedApiKey?: string;
  private readonly settingsOverride?: Partial<GroqRuntimeConfig>;

  constructor(apiKey?: string, settingsOverride?: Partial<GroqRuntimeConfig>) {
    this.injectedApiKey = apiKey;
    this.settingsOverride = settingsOverride;
  }

  private config(): GroqRuntimeConfig {
    const runtime = loadGroqRuntimeConfigSafe();
    return {
      ...runtime,
      ...this.settingsOverride,
      apiKey: this.injectedApiKey ?? runtime.apiKey,
      enabled: this.settingsOverride?.enabled ?? (this.injectedApiKey !== undefined ? true : runtime.enabled),
    };
  }

  getProviderName(): string {
    return 'groq';
  }

  isAvailable(): boolean {
    const config = this.config();
    return Boolean(config.enabled && config.apiKey && (config.defaultModel || this.injectedApiKey));
  }

  estimateStepCost(): number {
    return 0.0001;
  }

  getModelCapabilities(model: string): ModelCapabilities {
    return getGroqModelCapabilities(model.replace(/^groq:/, ''), this.config());
  }

  getHealth(): ProviderHealth {
    const config = this.config();
    const saved = readGroqHealth();
    if (config.configurationError) return { state: 'misconfigured', credentialState: config.apiKey ? 'configured' : 'not_configured', message: config.configurationError };
    if (!config.enabled) return { state: 'disabled', credentialState: config.apiKey ? 'configured' : 'not_configured', message: 'Groq is disabled.' };
    if (!config.apiKey || !config.defaultModel) {
      return {
        state: 'misconfigured',
        credentialState: config.apiKey ? 'configured' : 'not_configured',
        message: 'Groq requires one server-side key and a default model.',
      };
    }
    const scheduler = this.scheduler(config).getSnapshot();
    if (scheduler.cooldownUntil) {
      return {
        ...saved,
        state: 'cooldown',
        credentialState: 'configured',
        model: config.defaultModel,
        cooldownUntil: scheduler.cooldownUntil,
        message: 'Groq is cooling down. No other Groq account is being used.',
      };
    }
    return { ...saved, state: saved.state === 'misconfigured' || saved.state === 'disabled' ? 'available' : saved.state, credentialState: 'configured', model: config.defaultModel };
  }

  getQueueStatus(): ProviderSchedulerSnapshot {
    const config = this.config();
    return this.scheduler(config).getSnapshot();
  }

  getFallbackPolicy(): Pick<GroqSettings, 'fallbackEnabled' | 'fallbackProviders' | 'fallbackRequiresApproval'> {
    const config = this.config();
    return {
      fallbackEnabled: config.fallbackEnabled,
      fallbackProviders: [...config.fallbackProviders],
      fallbackRequiresApproval: config.fallbackRequiresApproval,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const config = this.config();
    const current = this.getHealth();
    if (current.state === 'disabled' || current.state === 'misconfigured' || current.state === 'cooldown') return current;
    try {
      await this.createChatCompletionResult(
        [{ role: 'user', content: 'Reply with OK.' }],
        config.defaultModel,
        { maxTokens: 8, temperature: 0, timeoutMs: Math.min(20_000, config.requestTimeoutSeconds * 1_000), requestKind: 'health_check' },
      );
      const health: ProviderHealth = {
        state: 'available', credentialState: 'configured', message: 'Groq health check succeeded.',
        model: config.defaultModel, lastSuccessAt: new Date().toISOString(),
      };
      saveGroqHealth(health);
      return health;
    } catch (error) {
      const providerError = error instanceof NormalizedProviderError ? error.providerError : classifyOpenAICompatibleProviderError('groq', error);
      const state = providerError.code === 'RATE_LIMITED' || providerError.code === 'QUOTA_EXHAUSTED' ? 'cooldown'
        : providerError.code === 'AUTHENTICATION_FAILED' || providerError.code === 'PERMISSION_DENIED' || providerError.code === 'MODEL_NOT_FOUND'
          ? 'misconfigured'
          : 'degraded';
      const health: ProviderHealth = {
        state,
        credentialState: providerError.code === 'AUTHENTICATION_FAILED' ? 'invalid' : 'configured',
        message: publicMessage(providerError),
        model: config.defaultModel,
        cooldownUntil: this.getQueueStatus().cooldownUntil,
        lastFailureAt: new Date().toISOString(),
        lastErrorCode: providerError.code,
      };
      saveGroqHealth(health);
      return health;
    }
  }

  async createChatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options?: LLMCompletionOptions,
  ): Promise<string> {
    const result = await this.createChatCompletionResult(messages, model, options);
    if (result.text.trim()) return result.text;
    if (result.toolCalls.length) return JSON.stringify({ tool_calls: result.toolCalls });
    throw new Error('Groq returned no usable completion.');
  }

  async createChatCompletionResult(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options: LLMCompletionOptions = {},
  ): Promise<LLMCompletionResult> {
    const config = this.config();
    this.assertConfigured(config);
    this.assertWorkspacePolicy(options);
    const resolvedModel = this.resolveModel(model, options, config);
    const capabilities = getGroqModelCapabilities(resolvedModel, config);
    this.assertCapabilities(capabilities, options);
    const prepared = prepareProviderMessages(messages, {
      ...options,
      contextTokenLimit: capabilities.contextTokenLimit,
      outputTokenLimit: capabilities.outputTokenLimit,
    });
    const identity: ProviderRequestIdentity = {
      provider: 'groq',
      model: resolvedModel,
      messages: prepared.messages,
      tools: options.tools,
      settings: { temperature: options.temperature, topP: options.topP, maxTokens: options.maxTokens, responseFormat: options.responseFormat, stream: options.stream },
      workspaceId: options.workspaceId,
      repositoryCommitHash: options.repositoryCommitHash,
      userId: options.userId,
      taskId: options.taskId,
      stepId: options.stepId,
      attemptGeneration: options.attemptGeneration,
      toolSchemaVersion: options.toolSchemaVersion,
    };
    const fingerprint = createProviderRequestFingerprint(identity);
    const cached = options.cacheable ? getCachedProviderResponse<LLMCompletionResult>(fingerprint, options.repositoryCommitHash) : undefined;
    if (cached) {
      recordGroqAggregateUsage({ cacheHits: 1 });
      options.onTelemetry?.({
        provider: 'groq', model: resolvedModel, requestKind: options.requestKind,
        startedAt: Date.now(), durationMs: 0, status: 'succeeded', cacheHit: true,
        role: options.role, estimatedInputTokens: prepared.estimatedInputTokens,
      });
      return { ...cached, cacheHit: true };
    }
    const startedAt = Date.now();
    const output = await runReliableProviderRequest(
      fingerprint,
      (sharedSignal) => this.executeScheduled(prepared.messages, resolvedModel, capabilities, { ...options, signal: sharedSignal }, config),
      {
        signal: options.signal,
        cacheResult: options.cacheable && !prepared.secretsDetected,
        ttlMs: options.cacheTtlMs ?? config.cacheTtlSeconds * 1_000,
        identity,
      },
    );
    recordGroqAggregateUsage({
      requests: output.attempts,
      retries: Math.max(0, output.attempts - 1),
      inputTokens: output.result.usage?.inputTokens || prepared.estimatedInputTokens,
      outputTokens: output.result.usage?.outputTokens || 0,
    });
    options.onTelemetry?.({
      provider: 'groq', model: resolvedModel, requestKind: options.requestKind,
      startedAt, durationMs: Date.now() - startedAt, status: 'succeeded',
      role: options.role, stream: Boolean(options.stream), retryCount: Math.max(0, output.attempts - 1),
      requestId: output.result.requestId, queueWaitMs: output.queueWaitMs,
      estimatedInputTokens: prepared.estimatedInputTokens,
      reportedInputTokens: output.result.usage?.inputTokens,
      reportedOutputTokens: output.result.usage?.outputTokens,
    });
    return output.result;
  }

  async *streamChatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options: LLMCompletionOptions = {},
  ): AsyncIterable<LLMCompletionStreamEvent> {
    const events: LLMCompletionStreamEvent[] = [];
    let wake: (() => void) | undefined;
    let done = false;
    const push = (event: LLMCompletionStreamEvent) => {
      events.push(event);
      options.onStreamEvent?.(event);
      wake?.();
      wake = undefined;
    };
    const completion = this.createChatCompletionResult(messages, model, {
        ...options,
        stream: true,
        onStreamEvent: push,
      }).catch((error) => {
      const providerError = error instanceof NormalizedProviderError ? error.providerError : classifyOpenAICompatibleProviderError('groq', error);
      push({ type: 'error', error: { code: providerError.code, message: publicMessage(providerError), requestId: providerError.requestId } });
    }).finally(() => {
      done = true;
      wake?.();
      wake = undefined;
    });
    while (!done || events.length) {
      if (!events.length) await new Promise<void>((resolve) => { wake = resolve; });
      while (events.length) yield events.shift()!;
    }
    await completion;
  }

  private scheduler(config: GroqRuntimeConfig) {
    return getGroqScheduler({
      maxConcurrency: config.maxConcurrency,
      maxPending: config.maxPendingRequests,
      maxRetries: config.maxRetries,
      maxRequestsPerTask: config.maxRequestsPerTask,
      baseRetryDelayMs: config.retryBaseDelayMs,
      maxRetryDelayMs: config.retryMaxDelayMs,
    });
  }

  private async executeScheduled(
    messages: Array<{ role: string; content: string }>,
    model: string,
    capabilities: ModelCapabilities,
    options: LLMCompletionOptions,
    config: GroqRuntimeConfig,
  ): Promise<GroqTransportOutput> {
    const enqueuedAt = Date.now();
    let attempts = 0;
    let queueWaitMs = 0;
    const timeoutMs = Math.min(options.timeoutMs || config.requestTimeoutSeconds * 1_000, config.requestTimeoutSeconds * 1_000);
    const deadlineAt = Date.now() + timeoutMs;
    try {
      const result = await this.scheduler(config).run(
        async (_attempt, signal) => {
          attempts++;
          return options.stream && capabilities.streaming
            ? this.transportStreaming(messages, model, options, config, signal)
            : { result: await this.transportNonStreaming(messages, model, options, config, signal) };
        },
        {
          priority: options.queuePriority,
          signal: options.signal,
          deadlineAt,
          taskId: options.taskId,
          requestBudget: options.requestBudget,
          onAttempt: () => {
            if (attempts === 0) queueWaitMs = Math.max(0, Date.now() - enqueuedAt);
          },
        },
      );
      return { ...result, attempts, queueWaitMs };
    } catch (error) {
      const providerError = error instanceof NormalizedProviderError ? error.providerError : classifyOpenAICompatibleProviderError('groq', error);
      recordGroqAggregateUsage({ requests: attempts, retries: Math.max(0, attempts - 1), failures: 1 });
      const health: ProviderHealth = {
        state: providerError.code === 'RATE_LIMITED' || providerError.code === 'QUOTA_EXHAUSTED' ? 'cooldown' : 'degraded',
        credentialState: providerError.code === 'AUTHENTICATION_FAILED' ? 'invalid' : 'configured',
        message: publicMessage(providerError),
        model,
        cooldownUntil: this.getQueueStatus().cooldownUntil,
        lastFailureAt: new Date().toISOString(),
        lastErrorCode: providerError.code,
      };
      saveGroqHealth(health);
      options.onTelemetry?.({
        provider: 'groq', model, requestKind: options.requestKind, startedAt: enqueuedAt,
        durationMs: Date.now() - enqueuedAt,
        status: providerError.code === 'CANCELLED' ? 'cancelled' : providerError.code === 'REQUEST_TIMEOUT' ? 'timed_out' : 'failed',
        error: publicMessage(providerError), classification: providerError.code,
        requestId: providerError.requestId, role: options.role, stream: Boolean(options.stream),
        retryCount: Math.max(0, attempts - 1), queueWaitMs: Math.max(0, Date.now() - enqueuedAt),
        cooldownUntil: this.getQueueStatus().cooldownUntil,
      });
      throw error instanceof NormalizedProviderError
        ? new NormalizedProviderError({ ...providerError, safeMessage: publicMessage(providerError) })
        : new NormalizedProviderError({ ...providerError, safeMessage: publicMessage(providerError) });
    }
  }

  private async transportNonStreaming(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options: LLMCompletionOptions,
    config: GroqRuntimeConfig,
    signal: AbortSignal,
  ): Promise<LLMCompletionResult> {
    const response = await this.fetchCompletion(messages, model, options, config, signal, false);
    const requestId = response.headers.get('x-request-id') || undefined;
    const rateLimit = parseRateLimitSnapshot(response.headers);
    updateProviderRateLimitHeaders('groq', model, response.headers);
    if (!response.ok) throw await this.responseError(response, requestId, rateLimit?.retryAfterMs);
    let data: any;
    try {
      data = await response.json();
    } catch (error) {
      throw new NormalizedProviderError({
        provider: 'groq', code: 'INVALID_REQUEST', retryable: false,
        safeMessage: 'Groq returned malformed JSON.', requestId, internalCause: error,
      });
    }
    const choice = data?.choices?.[0];
    const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    const toolCalls = toolCallsFrom(choice?.message?.tool_calls);
    if (!text.trim() && toolCalls.length === 0) {
      throw new NormalizedProviderError({
        provider: 'groq', code: 'INVALID_REQUEST', retryable: false,
        safeMessage: 'Groq returned no usable text or tool calls.', requestId,
      });
    }
    const result: LLMCompletionResult = {
      text,
      toolCalls,
      ...(extractSafeReasoningSummary(data) ? { reasoningSummary: extractSafeReasoningSummary(data) } : {}),
      finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined,
      usage: usageFrom(data?.usage),
      provider: 'groq',
      model: typeof data?.model === 'string' ? data.model : model,
      requestId: typeof data?.id === 'string' ? data.id : requestId,
      rateLimit,
    };
    reportCompletionResult(options, result);
    saveGroqHealth({
      state: 'available', credentialState: 'configured', message: 'Groq request succeeded.',
      model, lastSuccessAt: new Date().toISOString(),
    });
    return result;
  }

  private async transportStreaming(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options: LLMCompletionOptions,
    config: GroqRuntimeConfig,
    signal: AbortSignal,
  ): Promise<{ result: LLMCompletionResult; events: LLMCompletionStreamEvent[] }> {
    const response = await this.fetchCompletion(messages, model, options, config, signal, true);
    const requestId = response.headers.get('x-request-id') || undefined;
    const rateLimit = parseRateLimitSnapshot(response.headers);
    updateProviderRateLimitHeaders('groq', model, response.headers);
    if (!response.ok) throw await this.responseError(response, requestId, rateLimit?.retryAfterMs);
    if (!response.body) throw new NormalizedProviderError({ provider: 'groq', code: 'NETWORK_ERROR', retryable: true, safeMessage: 'Groq stream had no response body.', requestId });
    const events: LLMCompletionStreamEvent[] = [];
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let finishReason: string | undefined;
    let usage: LLMUsage | undefined;
    let reasoningSummary: string | undefined;
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    let emitted = false;
    try {
      for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          const data = JSON.parse(payload);
          const reasoningDelta = extractSafeReasoningSummaryDelta(data, reasoningSummary);
          if (reasoningDelta) {
            reasoningSummary = `${reasoningSummary ? `${reasoningSummary} ` : ''}${reasoningDelta}`.replace(/\s+/g, ' ').trim().slice(0, 600);
            const event: LLMCompletionStreamEvent = { type: 'reasoning_summary_delta', delta: reasoningDelta, source: 'provider' };
            events.push(event); options.onStreamEvent?.(event); emitted = true;
          }
          const choice = data?.choices?.[0];
          const delta = choice?.delta;
          if (typeof delta?.content === 'string' && delta.content) {
            text += delta.content;
            const event: LLMCompletionStreamEvent = { type: 'text_delta', delta: delta.content };
            events.push(event); options.onStreamEvent?.(event); emitted = true;
          }
          for (const fragment of Array.isArray(delta?.tool_calls) ? delta.tool_calls : []) {
            const index = Number(fragment.index) || 0;
            const current = toolCalls.get(index) || { id: '', name: '', arguments: '' };
            if (fragment.id) current.id += fragment.id;
            if (fragment.function?.name) current.name += fragment.function.name;
            if (fragment.function?.arguments) current.arguments += fragment.function.arguments;
            toolCalls.set(index, current);
            const event: LLMCompletionStreamEvent = {
              type: 'tool_call_delta', index, id: fragment.id,
              name: fragment.function?.name, argumentsDelta: fragment.function?.arguments,
            };
            events.push(event); options.onStreamEvent?.(event); emitted = true;
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          const chunkUsage = usageFrom(data?.usage);
          if (chunkUsage) {
            usage = chunkUsage;
            const event: LLMCompletionStreamEvent = { type: 'usage', usage };
            events.push(event); options.onStreamEvent?.(event);
          }
        }
      }
    } catch (error) {
      const classified = classifyOpenAICompatibleProviderError('groq', error, { requestId });
      throw new NormalizedProviderError({ ...classified, retryable: emitted ? false : classified.retryable });
    }
    const normalizedToolCalls: LLMToolCall[] = Array.from(toolCalls.entries()).sort(([a], [b]) => a - b).map(([index, call]) => ({
      id: call.id || `tool-call-${index}`, type: 'function' as const, function: { name: call.name, arguments: call.arguments || '{}' },
    })).filter((call) => call.function.name);
    if (!text.trim() && normalizedToolCalls.length === 0) {
      throw new NormalizedProviderError({ provider: 'groq', code: 'INVALID_REQUEST', retryable: false, safeMessage: 'Groq stream completed without usable content.', requestId });
    }
    const result: LLMCompletionResult = {
      text, toolCalls: normalizedToolCalls, finishReason, usage, provider: 'groq', model, requestId, rateLimit,
      ...(reasoningSummary ? { reasoningSummary } : {}),
    };
    reportCompletionResult(options, result);
    const completed: LLMCompletionStreamEvent = { type: 'completed', result };
    events.push(completed); options.onStreamEvent?.(completed);
    return { result, events };
  }

  private fetchCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options: LLMCompletionOptions,
    config: GroqRuntimeConfig,
    signal: AbortSignal,
    stream: boolean,
  ): Promise<Response> {
    return fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', Accept: stream ? 'text/event-stream' : 'application/json' },
      body: JSON.stringify({
        model,
        messages: messages.map((message) => ({
          role: message.role === 'assistant' || message.role === 'system' ? message.role : 'user',
          content: message.content,
        })),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: options.topP,
        stream,
        ...getGroqNativeReasoningFields(model, options.reasoning),
        ...(stream ? { stream_options: { include_usage: true } } : {}),
        ...(options.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
        ...(options.tools?.length ? { tools: options.tools, tool_choice: options.toolChoice || 'auto' } : {}),
      }),
      signal,
    }).catch((error) => {
      const classified = classifyOpenAICompatibleProviderError('groq', error);
      throw new NormalizedProviderError(classified);
    });
  }

  private async responseError(response: Response, requestId?: string, retryAfterMs?: number): Promise<NormalizedProviderError> {
    const text = await response.text().catch(() => '');
    const classified = classifyOpenAICompatibleProviderError(
      'groq',
      `HTTP ${response.status}${text ? `: ${redactProviderSecrets(text, 300)}` : ''}`,
      { statusCode: response.status, retryAfterMs, requestId },
    );
    return new NormalizedProviderError({ ...classified, safeMessage: publicMessage(classified) });
  }

  private resolveModel(model: string, options: LLMCompletionOptions, config: GroqRuntimeConfig): string {
    const role = options.role || inferRole(options.requestKind);
    if (role && (!model || model.replace(/^groq:/, '') === config.defaultModel)) return resolveGroqRoleModel(role, config);
    if (isLegacyGroqTargetModelValue(model)) return resolveGroqRoleModel('default', config);
    const requested = model.replace(/^groq:/, '').trim();
    if (this.injectedApiKey && requested) return requested;
    const configuredModels = new Set([
      config.defaultModel, config.fastModel, config.classifierModel, config.summarizerModel,
      config.plannerModel, config.coderModel, config.reviewerModel, config.repairModel,
    ].filter(Boolean));
    if (requested && configuredModels.has(requested)) return requested;
    if (requested && !configuredModels.has(requested)) {
      throw new NormalizedProviderError({
        provider: 'groq', code: 'MODEL_UNAVAILABLE', retryable: false,
        safeMessage: 'The requested Groq model is not one of the explicitly configured routes.',
      });
    }
    return resolveGroqRoleModel('default', config);
  }

  private assertConfigured(config: GroqRuntimeConfig): void {
    if (config.configurationError) throw new NormalizedProviderError({ provider: 'groq', code: 'MISCONFIGURED', retryable: false, safeMessage: config.configurationError });
    if (!config.enabled) throw new NormalizedProviderError({ provider: 'groq', code: 'MISCONFIGURED', retryable: false, safeMessage: 'Groq is disabled.' });
    if (!config.apiKey) throw new NormalizedProviderError({ provider: 'groq', code: 'MISCONFIGURED', retryable: false, safeMessage: 'GROQ_API_KEY is not configured.' });
    if (!config.defaultModel && !this.injectedApiKey) throw new NormalizedProviderError({ provider: 'groq', code: 'MISCONFIGURED', retryable: false, safeMessage: 'GROQ_DEFAULT_MODEL is not configured.' });
  }

  private assertCapabilities(capabilities: ModelCapabilities, options: LLMCompletionOptions): void {
    const unsupported = (options.stream && !capabilities.streaming && !this.injectedApiKey)
      || (Boolean(options.tools?.length) && !capabilities.toolCalling)
      || (options.responseFormat === 'json' && !capabilities.jsonMode)
      || (options.requiresVision && !capabilities.vision);
    if (unsupported) {
      throw new NormalizedProviderError({
        provider: 'groq', code: 'UNSUPPORTED_CAPABILITY', retryable: false,
        safeMessage: 'The configured Groq model does not support the requested capability.',
      });
    }
  }

  private assertWorkspacePolicy(options: LLMCompletionOptions): void {
    if (options.allowedExternalProviders && !options.allowedExternalProviders.includes('groq')) {
      throw new NormalizedProviderError({ provider: 'groq', code: 'PERMISSION_DENIED', retryable: false, safeMessage: 'Workspace policy does not allow Groq.' });
    }
    if (options.privateWorkspace && !options.sendPrivateSourceCode) {
      throw new NormalizedProviderError({ provider: 'groq', code: 'PERMISSION_DENIED', retryable: false, safeMessage: 'Private source code is not approved for external providers.' });
    }
  }
}
