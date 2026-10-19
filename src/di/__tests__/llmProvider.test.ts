import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { CerebrasLLMProvider, CompositeLLMProvider, GeminiLLMProvider, GroqLLMProvider, KimiLLMProvider, LocalModelLLMProvider, NvidiaLLMProvider, OpenRouterLLMProvider, PollinationsLLMProvider, RequestyLLMProvider, SambaNovaLLMProvider, resetGroqRequestScheduler, resetNvidiaRequestScheduler, resetOpenRouterRequestScheduler, summarizeProviderFailure } from '../providers/llmProvider.js';
import { ApiKeyPool } from '../providers/apiKeyPool.js';
import { DefaultDIContainer } from '../container.js';
import { getNvidiaModelMetadata } from '../../config/nvidiaModels.js';
import { getDefaultNvidiaModelTargets, getSavedNvidiaModelTargets, saveNvidiaModelTargets } from '../../config/nvidiaTargets.js';
import { getSavedGeminiModelTargets, saveGeminiModelTargets } from '../../config/geminiTargets.js';
import { getConfiguredGroqModel, getConfiguredKimiModel, getConfiguredOpenRouterModel, getConfiguredRequestyModel, saveConfiguredProviderModel } from '../../config/providerRouteSettings.js';
import type { LLMProvider } from '../types.js';
import { getProviderRateLimitStatuses, recordProviderSuccess, resetProviderRateLimitMonitor } from '../providers/rateLimitMonitor.js';

function createProvider(
  name: string,
  handler: (model: string) => Promise<string>
): LLMProvider {
  return {
    createChatCompletion: async (_messages, model) => handler(model),
    estimateStepCost: () => 0,
    getProviderName: () => name,
    isAvailable: () => true,
  };
}

describe('LLM provider model routing', () => {
  const originalNvidiaInterval = process.env.REACT_ENGINE_NVIDIA_MIN_REQUEST_INTERVAL_MS;

  beforeEach(() => {
    process.env.REACT_ENGINE_NVIDIA_MIN_REQUEST_INTERVAL_MS = '0';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetProviderRateLimitMonitor();
    void resetGroqRequestScheduler();
    resetNvidiaRequestScheduler();
    resetOpenRouterRequestScheduler();
    if (originalNvidiaInterval === undefined) delete process.env.REACT_ENGINE_NVIDIA_MIN_REQUEST_INTERVAL_MS;
    else process.env.REACT_ENGINE_NVIDIA_MIN_REQUEST_INTERVAL_MS = originalNvidiaInterval;
  });

  it('persists OpenRouter, Groq, Kimi, and Requesty model routes outside environment configuration', () => {
    const originalOpenRouter = getConfiguredOpenRouterModel();
    const originalGroq = getConfiguredGroqModel();
    const originalKimi = getConfiguredKimiModel();
    const originalRequesty = getConfiguredRequestyModel();
    try {
      saveConfiguredProviderModel('openrouter', 'openrouter:test/provider-model');
      saveConfiguredProviderModel('groq', 'groq:test-groq-model');
      saveConfiguredProviderModel('kimi', 'kimi:kimi-k2.7-code');
      saveConfiguredProviderModel('requesty', 'requesty:poolside/laguna-m.1');

      expect(getConfiguredOpenRouterModel()).toBe('test/provider-model');
      expect(getConfiguredGroqModel()).toBe('test-groq-model');
      expect(getConfiguredKimiModel()).toBe('kimi-k2.7-code');
      expect(getConfiguredRequestyModel()).toBe('poolside/laguna-m.1');
    } finally {
      if (originalOpenRouter) saveConfiguredProviderModel('openrouter', originalOpenRouter);
      if (originalGroq) saveConfiguredProviderModel('groq', originalGroq);
      if (originalKimi) saveConfiguredProviderModel('kimi', originalKimi);
      if (originalRequesty) saveConfiguredProviderModel('requesty', originalRequesty);
    }
  });

  it('routes an explicit local target only to the local provider', async () => {
    const calls: string[] = [];
    const remote = createProvider('openrouter', async (model) => {
      calls.push(`remote:${model}`);
      return 'remote';
    });
    const local = createProvider('local', async (model) => {
      calls.push(`local:${model}`);
      return 'local response';
    });
    const provider = new CompositeLLMProvider([remote, local]);

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'hello' }],
      'local-target:desktop-llm',
      {
        allowCrossProviderFallback: false,
        fallbackApprovalGranted: false,
        approvedFallbackProviders: [],
      },
    )).resolves.toBe('local response');
    expect(calls).toEqual(['local:local-target:desktop-llm']);
  });

  it('does not expose raw reasoning_content from OpenAI-compatible local servers', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '', reasoning_content: 'local reasoning response' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const provider = new LocalModelLLMProvider('http://localhost:8080/v1', 'local-model', true);

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'hello' }],
      'local:local-model',
      { timeoutMs: 1_000 },
    )).rejects.toThrow(/no usable content/);
  });

  it('disables Qwen3 thinking only for an explicitly requested health probe', async () => {
    let payload: any;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url, init) => {
      payload = JSON.parse(String((init as RequestInit).body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'LOCAL_ROUTE_OK' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);
    const provider = new LocalModelLLMProvider('http://localhost:8080/v1', 'qwen3-4b-local', true);

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Reply with exactly: LOCAL_ROUTE_OK' }],
      'local:qwen3-4b-local',
      { maxTokens: 64, timeoutMs: 1_000, requestKind: 'api_pool.test', disableLocalThinking: true },
    )).resolves.toBe('LOCAL_ROUTE_OK');
    expect(payload.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it('retains Qwen3 thinking for normal provider requests', async () => {
    let payload: any;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url, init) => {
      payload = JSON.parse(String((init as RequestInit).body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'HARNESS_OK' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);
    const provider = new LocalModelLLMProvider('http://localhost:8080/v1', 'qwen3-4b-local', true);

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Choose the next harness action.' }],
      'local:qwen3-4b-local',
      { maxTokens: 800, timeoutMs: 1_000, requestKind: 'step.reason' },
    )).resolves.toBe('HARNESS_OK');
    expect(payload.chat_template_kwargs).toEqual({ enable_thinking: true });
    expect(payload.cache_prompt).toBe(true);
  });

  it('emits estimated token telemetry for local routes used by adaptive action budgets', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'LOCAL_RESULT' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const telemetry: any[] = [];
    const provider = new CompositeLLMProvider([
      new LocalModelLLMProvider('http://localhost:8080/v1', 'local-model', true),
    ]);

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Reply with exactly: LOCAL_RESULT' }],
      'local:local-model',
      { requestKind: 'step.reason', onTelemetry: (event) => telemetry.push(event) },
    )).resolves.toBe('LOCAL_RESULT');

    expect(telemetry).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'local',
        status: 'succeeded',
        estimatedInputTokens: expect.any(Number),
        estimatedOutputTokens: expect.any(Number),
      }),
    ]));
  });

  it('streams visible local Qwen output while keeping private think markup out of chat', async () => {
    const payloads: any[] = [];
    const events: any[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url, init) => {
      payloads.push(JSON.parse(String((init as RequestInit).body)));
      return new Response([
        'data: {"choices":[{"delta":{"content":"<think>private scratch</think>"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Visible response"}}]}\n\n',
        'data: {"choices":[{"finish_reason":"stop","delta":{}}]}\n\n',
        'data: [DONE]\n\n',
      ].join(''), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as typeof fetch);
    const provider = new LocalModelLLMProvider('http://localhost:8080/v1', 'qwen3-4b-local', true);

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Answer normally.' }],
      'local:qwen3-4b-local',
      { maxTokens: 1_024, timeoutMs: 1_000, stream: true, onStreamEvent: (event) => events.push(event) },
    )).resolves.toBe('Visible response');
    expect(payloads[0].stream).toBe(true);
    expect(events.filter((event) => event.type === 'text_delta').map((event) => event.delta)).toEqual(['Visible response']);
    expect(events.some((event) => event.type === 'usage' && event.usage.outputTokens > 0)).toBe(true);
    expect(events.some((event) => JSON.stringify(event).includes('private scratch'))).toBe(false);
  });

  it('streams structured local action tool calls without returning partial JSON', async () => {
    const events: any[] = [];
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"Read","arguments":"{\\"file_path\\":\\"src/app.ts\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"finish_reason":"tool_calls","delta":{}}]}\n\n',
      'data: [DONE]\n\n',
    ].join(''), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));
    const provider = new LocalModelLLMProvider('http://localhost:8080/v1', 'qwen3-4b-local', true);

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Choose the next action.' }],
      'local:qwen3-4b-local',
      {
        maxTokens: 1_024,
        timeoutMs: 1_000,
        overallTimeoutMs: 1_000,
        idleTimeoutMs: 100,
        requestKind: 'step.plan_action',
        stream: true,
        onStreamEvent: (event) => events.push(event),
      },
    )).resolves.toContain('"tool_calls"');

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool_call_delta', index: 0, name: 'Read' }),
    ]));
  });

  it('aborts a stalled streamed local action after the idle timeout', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"{"}}]}\n\n'));
      },
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));
    const provider = new LocalModelLLMProvider('http://localhost:8080/v1', 'qwen3-4b-local', true);

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Choose the next action.' }],
      'local:qwen3-4b-local',
      {
        maxTokens: 1_024,
        timeoutMs: 1_000,
        overallTimeoutMs: 1_000,
        idleTimeoutMs: 20,
        requestKind: 'step.plan_action',
        stream: true,
      },
    )).rejects.toThrow(/idle timed out/i);
  });

  it('keeps a streamed reasoning turn alive when the server emits only private reasoning', async () => {
    const events: any[] = [];
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"reasoning_content":"private analysis only"}}]}\n\n',
      'data: {"choices":[{"finish_reason":"stop","delta":{}}]}\n\n',
      'data: [DONE]\n\n',
    ].join(''), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));
    const provider = new LocalModelLLMProvider('http://localhost:8080/v1', 'qwen3-4b-local', true);

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Choose the next harness action.' }],
      'local:qwen3-4b-local',
      { maxTokens: 1_024, timeoutMs: 1_000, requestKind: 'step.reason', stream: true, onStreamEvent: (event) => events.push(event) },
    )).resolves.toMatch(/reviewed the current evidence/i);
    expect(events.some((event) => JSON.stringify(event).includes('private analysis only'))).toBe(false);
  });

  it('reserves output space for Qwen3 thinking when a harness check requests a tiny budget', async () => {
    let payload: any;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url, init) => {
      payload = JSON.parse(String((init as RequestInit).body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'NO' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);
    const provider = new LocalModelLLMProvider('http://localhost:8080/v1', 'qwen3-4b-local', true);

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Is the task complete? Reply only YES or NO.' }],
      'local:qwen3-4b-local',
      { maxTokens: 40, timeoutMs: 1_000, requestKind: 'step.check_done' },
    )).resolves.toBe('NO');
    expect(payload.max_tokens).toBeGreaterThanOrEqual(1_024);
    expect(payload.chat_template_kwargs).toEqual({ enable_thinking: true });
  });

  it('retries a Qwen3 reasoning-only response with a larger visible output budget', async () => {
    const payloads: any[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url, init) => {
      const payload = JSON.parse(String((init as RequestInit).body));
      payloads.push(payload);
      const response = payloads.length === 1
        ? { choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'Still thinking.' } }] }
        : { choices: [{ finish_reason: 'stop', message: { content: 'HARNESS_OK' } }] };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);
    const provider = new LocalModelLLMProvider('http://localhost:8080/v1', 'qwen3-4b-local', true);

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Choose the next harness action.' }],
      'local:qwen3-4b-local',
      { maxTokens: 1_024, timeoutMs: 1_000, requestKind: 'step.reason' },
    )).resolves.toBe('HARNESS_OK');
    expect(payloads).toHaveLength(2);
    expect(payloads[0].max_tokens).toBe(1_024);
    expect(payloads[1].max_tokens).toBe(2_048);
    expect(payloads[1].chat_template_kwargs).toEqual({ enable_thinking: true });
  });

  it('compacts oversized local contexts before sending them to small local servers', async () => {
    let payload: any;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url, init) => {
      payload = JSON.parse(String((init as RequestInit).body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'LOCAL_OK' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);
    const provider = new LocalModelLLMProvider('http://localhost:8080/v1', 'local-model', true);
    const oversized = 'workspace context '.repeat(3_000);

    await expect(provider.createChatCompletion(
      [{ role: 'system', content: oversized }, { role: 'user', content: 'Reply exactly LOCAL_OK' }],
      'local:local-model',
      { maxTokens: 4_000, timeoutMs: 1_000 },
    )).resolves.toBe('LOCAL_OK');
    expect(payload.max_tokens).toBe(1_024);
    expect(payload.messages.reduce((total: number, message: { content: string }) => total + message.content.length, 0)).toBeLessThan(12_000);
  });

  it('preserves Gemini project-level generation blocks instead of misreporting auth', () => {
    const summary = summarizeProviderFailure(
      'gemini',
      'HTTP 403 PERMISSION_DENIED: API_KEY_SERVICE_BLOCKED; GenerativeService.GenerateContent is blocked',
    );

    expect(summary).toMatch(/generation is blocked/i);
    expect(summary).toMatch(/Generative Language API/i);
  });

  it('reports a provider-denied Gemini project separately from a bad API key', () => {
    const summary = summarizeProviderFailure(
      'gemini',
      'HTTP 403 PERMISSION_DENIED: Your project has been denied access. Please contact support.',
    );

    expect(summary).toMatch(/Google project denied access/i);
    expect(summary).not.toMatch(/authentication or access failure/i);
  });

  it('does not classify a NVIDIA route failure as authentication or a retired model', () => {
    const summary = summarizeProviderFailure(
      'nvidia',
      'HTTP 410 error from NVIDIA NIM. Suggested Fix: Verify NVIDIA_API_KEY, model access, and model-specific API family.',
    );

    expect(summary).toMatch(/model route unavailable.*HTTP 410/i);
    expect(summary).not.toMatch(/authentication or access failure/i);
    expect(summary).not.toMatch(/retired/i);
  });

  it('reports an explicit NVIDIA chat/API-family mismatch precisely', () => {
    const summary = summarizeProviderFailure(
      'nvidia',
      'Cause: Model openai/gpt-oss-120b uses apiFamily responses',
    );

    expect(summary).toBe('nvidia: incompatible model/API family');
  });

  it('reports Kimi insufficient balance as billing required instead of a temporary throttle', () => {
    const summary = summarizeProviderFailure(
      'kimi',
      'HTTP 429: Your account org-example is suspended due to insufficient balance, please recharge your account',
    );

    expect(summary).toBe('kimi: billing required (account suspended or balance unavailable)');
  });

  it('reports an OpenRouter daily free cap as exhausted quota', () => {
    const summary = summarizeProviderFailure(
      'openrouter',
      'HTTP 429: Rate limit exceeded: free-models-per-day. X-RateLimit-Remaining: 0',
    );

    expect(summary).toBe('openrouter: quota exhausted (wait for reset or update the provider plan)');
  });

  it('reports Requesty free-model exhaustion as quota instead of a temporary throttle', () => {
    expect(summarizeProviderFailure(
      'requesty',
      'HTTP 429 from Requesty: Free model rate limit exceeded',
    )).toBe('requesty: quota exhausted (wait for reset or update the provider plan)');
  });

  it('distinguishes a provider skipped by budget from an API failure', async () => {
    const telemetry: any[] = [];
    const provider = createProvider('nvidia', async () => {
      throw new Error('Cause: Remaining budget is below the 5000ms minimum viable NVIDIA attempt window Context: Attempts: 0');
    });

    await expect(new CompositeLLMProvider([provider]).createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'z-ai/glm-5.2',
      { onTelemetry: (event) => telemetry.push(event) },
    )).rejects.toThrow(/nvidia .*: not called \(allocated request budget was below the provider minimum; no API request was sent\)/);
    expect(telemetry).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'nvidia', status: 'skipped_budget' }),
    ]));
  });

  it('keeps Pollinations available for explicitly selected model targets', () => {
    const container = new DefaultDIContainer({
      apiKeys: { pollinations: 'pk_test', gemini: 'gemini-test', nvidia: 'nvapi_test' },
    });

    const providerName = container.getLLMProvider().getProviderName();
    expect(providerName).toContain('gemini');
    expect(providerName).toContain('nvidia');
    expect(providerName).toContain('pollinations');
  });

  it('reports Gemini 503 as temporary overload after fallback exhaustion', async () => {
    const provider = new CompositeLLMProvider([
      createProvider('gemini', async () => {
        throw new Error('{"error":{"code":503,"status":"UNAVAILABLE","message":"high demand"}}');
      }),
    ]);

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'gemini-3.5-flash',
    )).rejects.toThrow(/temporarily overloaded/);
  });

  it('falls back from NVIDIA to Gemini 3.6 Flash only', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const nvidia = createProvider('nvidia', async (model) => {
      calls.push({ provider: 'nvidia', model });
      throw new Error('NVIDIA unavailable');
    });
    const gemini = createProvider('gemini', async (model) => {
      calls.push({ provider: 'gemini', model });
      return 'recovered';
    });

    await expect(new CompositeLLMProvider([gemini, nvidia]).createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'nvidia/nemotron-3-super-120b-a12b',
    )).resolves.toBe('recovered');
    expect(calls).toEqual([
      { provider: 'nvidia', model: 'nvidia/nemotron-3-super-120b-a12b' },
      { provider: 'gemini', model: 'gemini-3.6-flash' },
    ]);
  });

  it('reserves OpenRouter as the final dynamic fallback for native model requests', async () => {
    const calls: string[] = [];
    const nvidia = createProvider('nvidia', async () => {
      calls.push('nvidia');
      throw new Error('NVIDIA unavailable');
    });
    const gemini = createProvider('gemini', async () => {
      calls.push('gemini');
      throw new Error('Gemini unavailable');
    });
    const openrouter = createProvider('openrouter', async () => {
      calls.push('openrouter');
      return 'dynamic fallback recovered';
    });

    await expect(new CompositeLLMProvider([openrouter, gemini, nvidia]).createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'z-ai/glm-5.2',
    )).resolves.toBe('dynamic fallback recovered');
    expect(calls).toEqual(['nvidia', 'gemini', 'openrouter']);
  });

  it('gives the first NVIDIA route its viable attempt floor in a five-route fallback plan', async () => {
    const telemetry: any[] = [];
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'NVIDIA route called' } }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const fail = (provider: string) => createProvider(provider, async () => {
      throw new Error(`${provider} should only be a fallback`);
    });
    const provider = new CompositeLLMProvider([
      new NvidiaLLMProvider('nvapi_primary', undefined, 'nvapi_worker'),
      fail('gemini'),
      fail('groq'),
      fail('openrouter'),
    ]);

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'z-ai/glm-5.2',
      { timeoutMs: 90_000, onTelemetry: (event) => telemetry.push(event) },
    )).resolves.toBe('NVIDIA route called');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(telemetry).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'nvidia', status: 'succeeded' }),
    ]));
    expect(Math.max(...telemetry
      .filter((event) => event.provider === 'nvidia' && event.status === 'succeeded')
      .map((event) => Number(event.allocatedBudgetMs) || 0)))
      .toBeGreaterThanOrEqual(20_000);
  });

  it('leaves room for a same-provider NVIDIA fallback inside a credential route slice', async () => {
    const previousMinimum = process.env.REACT_ENGINE_NVIDIA_MIN_ATTEMPT_MS;
    const previousFallbackMinimum = process.env.REACT_ENGINE_NVIDIA_FALLBACK_MIN_ATTEMPT_MS;
    process.env.REACT_ENGINE_NVIDIA_MIN_ATTEMPT_MS = '20';
    process.env.REACT_ENGINE_NVIDIA_FALLBACK_MIN_ATTEMPT_MS = '5';
    const requestModels: string[] = [];
    try {
      jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        requestModels.push(body.model);
        if (body.model === 'z-ai/glm-5.2') {
          return await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('NVIDIA request timed out')), { once: true });
          });
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: 'fallback recovered' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch);

      await expect(new CompositeLLMProvider([
        new NvidiaLLMProvider('nvapi_slice_primary', 'https://integrate.api.nvidia.com/v1', 'nvapi_slice_worker_2,nvapi_slice_worker_3'),
      ]).createChatCompletion(
        [{ role: 'user', content: 'Choose the next action.' }],
        'z-ai/glm-5.2',
        {
          pinModel: true,
          allowNvidiaModelFallback: true,
          freeTierResilience: true,
          requestLimit: 2,
          timeoutMs: 900,
          pacingProfile: 'fast',
        },
      )).resolves.toBe('fallback recovered');

      expect(requestModels).toEqual(['z-ai/glm-5.2', 'minimaxai/minimax-m3']);
    } finally {
      if (previousMinimum === undefined) delete process.env.REACT_ENGINE_NVIDIA_MIN_ATTEMPT_MS;
      else process.env.REACT_ENGINE_NVIDIA_MIN_ATTEMPT_MS = previousMinimum;
      if (previousFallbackMinimum === undefined) delete process.env.REACT_ENGINE_NVIDIA_FALLBACK_MIN_ATTEMPT_MS;
      else process.env.REACT_ENGINE_NVIDIA_FALLBACK_MIN_ATTEMPT_MS = previousFallbackMinimum;
    }
  });

  it('maps an OpenRouter planner target to explicitly approved provider-native fallback models', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const openrouter = createProvider('openrouter', async (model) => {
      calls.push({ provider: 'openrouter', model });
      throw new Error('HTTP 429 from OpenRouter');
    });
    const gemini = createProvider('gemini', async (model) => {
      calls.push({ provider: 'gemini', model });
      throw new Error('Gemini timed out');
    });
    const nvidia = createProvider('nvidia', async (model) => {
      calls.push({ provider: 'nvidia', model });
      throw new Error('NVIDIA unavailable');
    });
    const groq = createProvider('groq', async (model) => {
      calls.push({ provider: 'groq', model });
      return 'Groq recovered';
    });

    await expect(new CompositeLLMProvider([openrouter, gemini, nvidia, groq]).createChatCompletion(
      [{ role: 'user', content: 'Choose the next coder action' }],
      'openrouter:openrouter/free',
      {
        allowCrossProviderFallback: true,
        fallbackApprovalGranted: true,
        approvedFallbackProviders: ['groq'],
        allowedExternalProviders: ['openrouter', 'groq'],
      },
    )).resolves.toBe('Groq recovered');
    expect(calls).toEqual([
      { provider: 'openrouter', model: 'openrouter/free' },
      { provider: 'groq', model: getConfiguredGroqModel() },
    ]);
    expect(calls.filter(({ provider }) => provider === 'nvidia' || provider === 'groq'))
      .not.toContainEqual(expect.objectContaining({ model: 'openai-fast' }));
  });

  it('preserves an Ox Alpha target at the composite routing boundary', async () => {
    const calls: string[] = [];
    const openrouter = createProvider('openrouter', async (model) => {
      calls.push(model);
      return 'free router response';
    });

    await expect(new CompositeLLMProvider([openrouter]).createChatCompletion(
      [{ role: 'user', content: 'Choose the next coder action' }],
      'openrouter:stealth/ox-alpha',
    )).resolves.toBe('free router response');
    expect(calls).toEqual(['stealth/ox-alpha']);
  });

  it('allows one explicit fast probe after an OpenRouter rate-limit cooldown', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation((async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response('{"error":{"message":"Provider returned error"}}', { status: 429 });
      }
      return new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: 'OX_ALPHA_RECOVERED' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);
    const provider = new OpenRouterLLMProvider('openrouter-test-key');
    const composite = new CompositeLLMProvider([provider]);

    await expect(composite.createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'openrouter:stealth/ox-alpha',
      { timeoutMs: 20_000 },
    )).rejects.toThrow(/HTTP 429|rate limit/i);

    await expect(composite.createChatCompletion(
      [{ role: 'user', content: 'Continue' }],
      'openrouter:stealth/ox-alpha',
      { timeoutMs: 20_000, pacingProfile: 'fast', allowProviderRouteProbe: true },
    )).resolves.toBe('OX_ALPHA_RECOVERED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('collapses identical terminal diagnoses from repeated provider routes', async () => {
    const nvidia = createProvider('nvidia', async () => {
      throw new Error('Cause: HTTP 410 (unknown) from NVIDIA NIM');
    });

    const completion = new CompositeLLMProvider([nvidia, nvidia]).createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'z-ai/glm-5.2',
    );

    await expect(completion).rejects.toThrow(
      /All LLM providers failed:\n- nvidia \| model "z-ai\/glm-5\.2" \| provider key pool: model route unavailable \(HTTP 410; check model access\/endpoint\)\. Provider detail: Cause: HTTP 410/,
    );
  });

  it('reports the exact selected target, resolved model, and API key slot on failure', async () => {
    const now = Date.now();
    const originalTargets = getSavedNvidiaModelTargets();

    try {
      saveNvidiaModelTargets([{
        id: 'coder-key-2',
        title: 'Coder Key 2',
        modelId: 'google/gemma-4-31b-it',
        apiKeyIndex: 1,
        apiFamily: 'chat-completions',
        endpoint: '/chat/completions',
        createdAt: now,
        updatedAt: now,
      }]);
      const nvidia = createProvider('nvidia', async () => {
        throw new Error('HTTP 429 RESOURCE_EXHAUSTED for selected route');
      });

      await expect(new CompositeLLMProvider([nvidia]).createChatCompletion(
        [{ role: 'user', content: 'Hello' }],
        'nvidia-target:coder-key-2',
      )).rejects.toThrow(
        /nvidia \| selected target "nvidia-target:coder-key-2" \| model "google\/gemma-4-31b-it" \| selected API key 2: throttled.*Provider detail: HTTP 429 RESOURCE_EXHAUSTED/,
      );
    } finally {
      saveNvidiaModelTargets(originalTargets);
    }
  });

  it('falls back from Gemini to the bounded NVIDIA MiniMax route', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const gemini = createProvider('gemini', async (model) => {
      calls.push({ provider: 'gemini', model });
      throw new Error('Gemini unavailable');
    });
    const nvidia = createProvider('nvidia', async (model) => {
      calls.push({ provider: 'nvidia', model });
      return 'recovered';
    });

    await expect(new CompositeLLMProvider([nvidia, gemini]).createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'gemini-2.5-flash',
    )).resolves.toBe('recovered');
    expect(calls).toEqual([
      { provider: 'gemini', model: 'gemini-2.5-flash' },
      { provider: 'nvidia', model: 'minimaxai/minimax-m3' },
    ]);
  });

  it('retries the same NVIDIA model with API key 2 after key 1 throttles and Gemini fallback fails', async () => {
    const authHeaders: string[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      authHeaders.push((init?.headers as Record<string, string>).Authorization);
      if (authHeaders.length === 1) return new Response('rate limited', {
        status: 429,
        headers: { 'retry-after': '60' },
      });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'key 2 recovered' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);
    const geminiCalls: string[] = [];
    const gemini = createProvider('gemini', async (model) => {
      geminiCalls.push(model);
      throw new Error('Gemini unavailable');
    });
    const nvidia = new NvidiaLLMProvider('nvapi_primary', 'https://integrate.api.nvidia.com/v1', 'nvapi_worker');

    await expect(new CompositeLLMProvider([gemini, nvidia]).createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'z-ai/glm-5.2',
      { timeoutMs: 90_000 },
    )).resolves.toBe('key 2 recovered');
    expect(geminiCalls).toEqual(['gemini-3.6-flash']);
    expect(authHeaders).toEqual(['Bearer nvapi_primary', 'Bearer nvapi_worker']);
  });

  it('tries the credential pinned by a selected NVIDIA target before other healthy keys', async () => {
    const authHeaders: string[] = [];
    const originalTargets = getSavedNvidiaModelTargets();
    const now = Date.now();
    try {
      saveNvidiaModelTargets([{
        id: 'selected-key-three',
        title: 'Selected key three',
        modelId: 'z-ai/glm-5.2',
        apiKeyIndex: 2,
        apiFamily: 'chat-completions',
        endpoint: '/chat/completions',
        createdAt: now,
        updatedAt: now,
      }]);
      jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
        authHeaders.push((init?.headers as Record<string, string>).Authorization);
        return new Response(JSON.stringify({ choices: [{ message: { content: 'selected target ok' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch);
      const nvidia = new NvidiaLLMProvider(
        'nvapi_primary',
        'https://integrate.api.nvidia.com/v1',
        'nvapi_worker,nvapi_fresh',
      );

      await expect(new CompositeLLMProvider([nvidia]).createChatCompletion(
        [{ role: 'user', content: 'Hello' }],
        'nvidia-target:selected-key-three',
        { timeoutMs: 60_000 },
      )).resolves.toBe('selected target ok');

      expect(authHeaders).toEqual(['Bearer nvapi_fresh']);
    } finally {
      saveNvidiaModelTargets(originalTargets);
    }
  });

  it('identifies sibling NVIDIA failures as independent fallback accounts', async () => {
    const originalTargets = getSavedNvidiaModelTargets();
    try {
      saveNvidiaModelTargets([{
        id: 'selected-account-two',
        title: 'Selected account two',
        modelId: 'z-ai/glm-5.2',
        apiKeyIndex: 1,
        apiFamily: 'chat-completions',
        endpoint: '/chat/completions',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }]);
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
        '{"error":{"message":"account quota exhausted"}}',
        { status: 429 },
      ));
      const provider = new NvidiaLLMProvider(
        'nvapi_account_one',
        'https://integrate.api.nvidia.com/v1',
        'nvapi_account_two',
      );

      const failure = new CompositeLLMProvider([provider]).createChatCompletion(
        [{ role: 'user', content: 'Hello' }],
        'nvidia-target:selected-account-two',
        { timeoutMs: 60_000 },
      );

      await expect(failure).rejects.toThrow(/selected API key 2/);
      await expect(failure).rejects.toThrow(/fallback API key 1 \(independent account; selected API key 2\)/);
    } finally {
      saveNvidiaModelTargets(originalTargets);
    }
  });

  it('keeps Gemini on one account before an explicitly allowed provider handoff', async () => {
    const previousMaxAttempts = process.env.REACT_ENGINE_GEMINI_MAX_ATTEMPTS;
    process.env.REACT_ENGINE_GEMINI_MAX_ATTEMPTS = '1';
    const sequence: string[] = [];
    const messages = [{ role: 'user', content: 'Keep this handover context intact' }];
    const pool = new ApiKeyPool({
      keys: ['gemini-account-1', 'gemini-account-2', 'gemini-account-3'],
      rotationStrategy: 'least-used',
    });
    const gemini = new GeminiLLMProvider(undefined, pool);
    (gemini as any).getClient = async (apiKey: string) => ({
      models: {
        generateContent: async () => {
          sequence.push(apiKey);
          throw new Error('503 high demand');
        },
      },
    });
    const requesty: LLMProvider = {
      createChatCompletion: async (receivedMessages) => {
        expect(receivedMessages).toBe(messages);
        sequence.push('requesty');
        throw new Error('Requesty transient failure');
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'requesty',
      isAvailable: () => true,
    };

    try {
      await expect(new CompositeLLMProvider([gemini, requesty]).createChatCompletion(
        messages,
        'gemini-3.5-flash',
        {
          timeoutMs: 90_000,
          allowCrossProviderFallback: true,
          fallbackApprovalGranted: true,
          approvedFallbackProviders: ['requesty'],
        },
      )).rejects.toThrow(/All LLM providers failed/);

      expect(sequence).toEqual(['gemini-account-1', 'requesty']);
    } finally {
      if (previousMaxAttempts === undefined) delete process.env.REACT_ENGINE_GEMINI_MAX_ATTEMPTS;
      else process.env.REACT_ENGINE_GEMINI_MAX_ATTEMPTS = previousMaxAttempts;
    }
  });

  it('keeps a selected Gemini target pinned to its configured account', async () => {
    const originalTargets = getSavedGeminiModelTargets();
    const pool = new ApiKeyPool({
      keys: ['gemini-account-1', 'gemini-account-2', 'gemini-account-3'],
      rotationStrategy: 'least-used',
    });
    const gemini = new GeminiLLMProvider(undefined, pool);
    const sequence: string[] = [];
    try {
      saveGeminiModelTargets([{
        id: 'selected-gemini-account-2',
        title: 'Selected Gemini account 2',
        modelId: 'gemini-3.5-flash',
        apiKeyIndex: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }]);
      (gemini as any).getClient = async (apiKey: string) => ({
        models: {
          generateContent: async () => {
            sequence.push(apiKey);
            if (apiKey === 'gemini-account-3') return { text: 'sibling recovered' };
            throw new Error('429 exceeded your current quota');
          },
        },
      });

      await expect(new CompositeLLMProvider([gemini]).createChatCompletion(
        [{ role: 'user', content: 'Keep working' }],
        'gemini-target:selected-gemini-account-2',
        { timeoutMs: 45_000 },
      )).rejects.toThrow(/task remains assigned to Legacy Gemini Account 2/i);

      expect(sequence).toEqual(['gemini-account-2']);
    } finally {
      saveGeminiModelTargets(originalTargets);
    }
  });

  it('promotes a recently successful healthy provider ahead of a cold selected route', async () => {
    const calls: string[] = [];
    const requestyModel = getConfiguredRequestyModel();
    recordProviderSuccess('requesty', requestyModel, Date.now(), undefined);
    recordProviderSuccess('requesty', requestyModel, Date.now(), undefined);

    const nvidia = createProvider('nvidia', async () => {
      calls.push('nvidia');
      throw new Error('NVIDIA should not be needed');
    });
    const requesty = createProvider('requesty', async () => {
      calls.push('requesty');
      return 'healthy handover';
    });

    await expect(new CompositeLLMProvider([nvidia, requesty]).createChatCompletion(
      [{ role: 'user', content: 'Continue the task' }],
      'z-ai/glm-5.2',
      { timeoutMs: 90_000 },
    )).resolves.toBe('healthy handover');
    expect(calls).toEqual(['requesty']);
  });

  it('times out a slow provider, emits telemetry, and falls back', async () => {
    const telemetry: Array<{ provider: string; status: string }> = [];
    const slow = createProvider('pollinations', async () => await new Promise<string>(() => {}));
    const fast = createProvider('gemini', async () => 'fallback response');
    const provider = new CompositeLLMProvider([slow, fast]);

    const result = await provider.createChatCompletion(
      [{ role: 'user', content: 'Choose a tool' }],
      'openai-fast',
      {
        timeoutMs: 100,
        requestKind: 'step.plan_action',
        onTelemetry: (entry) => telemetry.push({ provider: entry.provider, status: entry.status }),
      },
    );

    expect(result).toBe('fallback response');
    expect(telemetry).toEqual([
      { provider: 'pollinations', status: 'timed_out' },
      { provider: 'gemini', status: 'succeeded' },
    ]);
  });

  it('hands a NVIDIA model timeout to the next independent credential while budget remains', async () => {
    const previousMinimum = process.env.REACT_ENGINE_NVIDIA_MIN_ATTEMPT_MS;
    process.env.REACT_ENGINE_NVIDIA_MIN_ATTEMPT_MS = '20';
    let nvidiaCalls = 0;
    try {
      jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
        nvidiaCalls += 1;
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('NVIDIA request timed out')), { once: true });
        });
      }) as typeof fetch);
      const nvidia = new NvidiaLLMProvider('nvapi_primary', 'https://integrate.api.nvidia.com/v1', 'nvapi_worker');
      const gemini = createProvider('gemini', async () => {
        throw new Error('Gemini unavailable');
      });

      await expect(new CompositeLLMProvider([nvidia, gemini]).createChatCompletion(
        [{ role: 'user', content: 'Choose a tool' }],
        'z-ai/glm-5.2',
        { timeoutMs: 1_000 },
      )).rejects.toThrow(/All LLM providers failed/);

      expect(nvidiaCalls).toBe(2);
    } finally {
      if (previousMinimum === undefined) delete process.env.REACT_ENGINE_NVIDIA_MIN_ATTEMPT_MS;
      else process.env.REACT_ENGINE_NVIDIA_MIN_ATTEMPT_MS = previousMinimum;
    }
  });

  it('attaches provider rejection handling even when the request is already aborted', async () => {
    const pending = new Promise<string>(() => {});
    const thenSpy = jest.spyOn(pending, 'then');
    const provider = new CompositeLLMProvider([{
      createChatCompletion: () => pending,
      estimateStepCost: () => 0,
      getProviderName: () => 'nvidia',
      isAvailable: () => true,
    }]);
    const controller = new AbortController();
    controller.abort(new Error('cancelled before dispatch'));

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Choose a tool' }],
      'z-ai/glm-5.2',
      { signal: controller.signal, timeoutMs: 90_000 },
    )).rejects.toThrow('cancelled before dispatch');

    expect(thenSpy).toHaveBeenCalled();
  });

  it('tries Gemini before Pollinations for Gemini model requests', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const pollinations = createProvider('pollinations', async (model) => {
      calls.push({ provider: 'pollinations', model });
      return 'pollinations response';
    });
    const gemini = createProvider('gemini', async (model) => {
      calls.push({ provider: 'gemini', model });
      return 'gemini response';
    });

    const provider = new CompositeLLMProvider([pollinations, gemini]);

    const result = await provider.createChatCompletion(
      [{ role: 'user', content: 'Build arcade snake' }],
      'gemini-2.5-flash'
    );

    expect(result).toBe('gemini response');
    expect(calls).toEqual([{ provider: 'gemini', model: 'gemini-2.5-flash' }]);
  });

  it('routes Gemini model target values to the Gemini provider before fallbacks', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const pollinations = createProvider('pollinations', async (model) => {
      calls.push({ provider: 'pollinations', model });
      return 'pollinations response';
    });
    const gemini = createProvider('gemini', async (model) => {
      calls.push({ provider: 'gemini', model });
      return 'gemini target response';
    });

    const provider = new CompositeLLMProvider([pollinations, gemini]);
    const result = await provider.createChatCompletion(
      [{ role: 'user', content: 'hello' }],
      'gemini-target:flash-key-2'
    );

    expect(result).toBe('gemini target response');
    expect(calls).toEqual([{ provider: 'gemini', model: 'gemini-target:flash-key-2' }]);
  });

  it('uses the configured same-provider Gemini model recovery order before any cross-provider route', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const routed: Array<{ provider: string; model: string; reason: string }> = [];
    const gemini = createProvider('gemini', async (model) => {
      calls.push({ provider: 'gemini', model });
      if (model === 'gemini-3.5-flash') throw new Error('Gemini temporarily unavailable');
      return 'Gemini recovery response';
    });
    const pollinations = createProvider('pollinations', async (model) => {
      calls.push({ provider: 'pollinations', model });
      return 'cross-provider response';
    });

    const result = await new CompositeLLMProvider([pollinations, gemini]).createChatCompletion(
      [{ role: 'user', content: 'hello' }],
      'gemini-3.5-flash',
      {
        allowCrossProviderFallback: true,
        fallbackApprovalGranted: true,
        approvedFallbackProviders: ['pollinations'],
        sameProviderFallbackModels: ['gemini-3.6-flash', 'gemini-3.1-flash-lite'],
        onRouteSelected: (route) => routed.push({ provider: route.provider, model: route.resolvedModel, reason: route.reason }),
      },
    );

    expect(result).toBe('Gemini recovery response');
    expect(calls).toEqual([
      { provider: 'gemini', model: 'gemini-3.5-flash' },
      { provider: 'gemini', model: 'gemini-3.6-flash' },
    ]);
    expect(routed).toEqual([{ provider: 'gemini', model: 'gemini-3.6-flash', reason: 'same_provider_model' }]);
  });

  it('keeps a pinned request on the selected model and never starts fallback model routes', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const gemini = createProvider('gemini', async (model) => {
      calls.push({ provider: 'gemini', model });
      throw new Error('Gemini temporarily unavailable');
    });
    const pollinations = createProvider('pollinations', async (model) => {
      calls.push({ provider: 'pollinations', model });
      return 'must not run';
    });

    await expect(new CompositeLLMProvider([pollinations, gemini]).createChatCompletion(
      [{ role: 'user', content: 'hello' }],
      'gemini-3.5-flash',
      {
        pinModel: true,
        allowCrossProviderFallback: true,
        fallbackApprovalGranted: true,
        approvedFallbackProviders: ['pollinations'],
        sameProviderFallbackModels: ['gemini-3.6-flash'],
      },
    )).rejects.toThrow('Gemini temporarily unavailable');

    expect(calls).toEqual([{ provider: 'gemini', model: 'gemini-3.5-flash' }]);
  });

  it('uses openai-fast when Pollinations is the fallback for a native Gemini model', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const gemini = createProvider('gemini', async (model) => {
      calls.push({ provider: 'gemini', model });
      throw new Error('Gemini unavailable');
    });
    const pollinations = createProvider('pollinations', async (model) => {
      calls.push({ provider: 'pollinations', model });
      return 'pollinations response';
    });

    const provider = new CompositeLLMProvider([pollinations, gemini]);

    const result = await provider.createChatCompletion(
      [{ role: 'user', content: 'Build arcade snake' }],
      'gemini-2.5-flash'
    );

    expect(result).toBe('pollinations response');
    expect(calls).toEqual([
      { provider: 'gemini', model: 'gemini-2.5-flash' },
      { provider: 'pollinations', model: 'openai-fast' },
    ]);
  });

  it('paces fallback routes inside a single composite request', async () => {
    const attemptTimes: number[] = [];
    const pacingWaits: Array<{ delayMs: number; provider?: string; scope: string }> = [];
    const primary = createProvider('gemini', async () => {
      attemptTimes.push(Date.now());
      throw new Error('temporary provider failure');
    });
    const fallback = createProvider('pollinations', async () => {
      attemptTimes.push(Date.now());
      return 'fallback response';
    });

    const result = await new CompositeLLMProvider([primary, fallback]).createChatCompletion(
      [{ role: 'user', content: 'Choose a tool' }],
      'gemini-2.5-flash',
      {
        timeoutMs: 10_000,
        minimumRouteIntervalMs: 30,
        pacingProfile: 'conservative',
        onPacingWait: (event) => pacingWaits.push(event),
      },
    );

    expect(result).toBe('fallback response');
    expect(attemptTimes[1] - attemptTimes[0]).toBeGreaterThanOrEqual(20);
    expect(pacingWaits).toEqual([
      expect.objectContaining({ provider: 'pollinations', scope: 'fallback' }),
    ]);
  });

  it('waits for a short provider threshold and retries that route once', async () => {
    let calls = 0;
    const pacingWaits: Array<{ delayMs: number; provider?: string; scope: string }> = [];
    const gemini = createProvider('gemini', async () => {
      calls += 1;
      if (calls === 1) throw new Error('HTTP 429: retry in 0.02 seconds');
      return 'recovered after threshold';
    });

    const result = await new CompositeLLMProvider([gemini]).createChatCompletion(
      [{ role: 'user', content: 'Choose a tool' }],
      'gemini-2.5-flash',
      {
        timeoutMs: 15_000,
        minimumRouteIntervalMs: 5,
        pacingProfile: 'conservative',
        onPacingWait: (event) => pacingWaits.push(event),
      },
    );

    expect(result).toBe('recovered after threshold');
    expect(calls).toBe(2);
    expect(pacingWaits).toEqual([
      expect.objectContaining({ provider: 'gemini', scope: 'fallback' }),
    ]);
  });


  it('falls back to native Gemini when a Pollinations-only model fails', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const pollinations = createProvider('pollinations', async (model) => {
      calls.push({ provider: 'pollinations', model });
      throw new Error('Pollinations balance too low');
    });
    const gemini = createProvider('gemini', async (model) => {
      calls.push({ provider: 'gemini', model });
      return 'gemini response';
    });

    const provider = new CompositeLLMProvider([pollinations, gemini]);

    const result = await provider.createChatCompletion(
      [{ role: 'user', content: 'Build arcade snake' }],
      'qwen-large'
    );

    expect(result).toBe('gemini response');
    expect(calls).toEqual([
      { provider: 'pollinations', model: 'qwen-large' },
      { provider: 'gemini', model: 'gemini-3.6-flash' },
    ]);
  });

  it('routes Pollinations Gemini aliases to Pollinations before native Gemini', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const gemini = createProvider('gemini', async (model) => {
      calls.push({ provider: 'gemini', model });
      return 'native gemini response';
    });
    const pollinations = createProvider('pollinations', async (model) => {
      calls.push({ provider: 'pollinations', model });
      return 'pollinations response';
    });

    const provider = new CompositeLLMProvider([gemini, pollinations]);

    const result = await provider.createChatCompletion(
      [{ role: 'user', content: 'Plan this coding task' }],
      'gemini-fast'
    );

    expect(result).toBe('pollinations response');
    expect(calls).toEqual([{ provider: 'pollinations', model: 'gemini-fast' }]);
  });

  it('routes new coding aliases to Pollinations', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const gemini = createProvider('gemini', async (model) => {
      calls.push({ provider: 'gemini', model });
      return 'native gemini response';
    });
    const pollinations = createProvider('pollinations', async (model) => {
      calls.push({ provider: 'pollinations', model });
      return 'pollinations response';
    });

    const provider = new CompositeLLMProvider([gemini, pollinations]);

    const result = await provider.createChatCompletion(
      [{ role: 'user', content: 'Write a TypeScript refactor' }],
      'kimi-code'
    );

    expect(result).toBe('pollinations response');
    expect(calls).toEqual([{ provider: 'pollinations', model: 'kimi-code' }]);
  });

  it('routes NVIDIA model ids to the NVIDIA provider before other providers', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const pollinations = createProvider('pollinations', async (model) => {
      calls.push({ provider: 'pollinations', model });
      return 'pollinations response';
    });
    const nvidia = createProvider('nvidia', async (model) => {
      calls.push({ provider: 'nvidia', model });
      return 'nvidia response';
    });

    const provider = new CompositeLLMProvider([pollinations, nvidia]);

    const result = await provider.createChatCompletion(
      [{ role: 'user', content: 'Write a TypeScript refactor' }],
      'qwen/qwen3-coder-480b-a35b-instruct'
    );

    expect(result).toBe('nvidia response');
    expect(calls).toEqual([{ provider: 'nvidia', model: 'qwen/qwen3-coder-480b-a35b-instruct' }]);
  });

  it('maps a foreign planner model to a valid NVIDIA chat model during fallback', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const pollinations = createProvider('pollinations', async (model) => {
      calls.push({ provider: 'pollinations', model });
      throw new Error('Pollinations timed out');
    });
    const gemini = createProvider('gemini', async (model) => {
      calls.push({ provider: 'gemini', model });
      throw new Error('Gemini timed out');
    });
    const nvidia = createProvider('nvidia', async (model) => {
      calls.push({ provider: 'nvidia', model });
      return 'nvidia fallback';
    });
    const provider = new CompositeLLMProvider([pollinations, gemini, nvidia]);

    const result = await provider.createChatCompletion(
      [{ role: 'user', content: 'Choose a tool' }],
      'openai-fast'
    );

    expect(result).toBe('nvidia fallback');
    const nvidiaCall = calls.find((call) => call.provider === 'nvidia');
    expect(nvidiaCall?.model).not.toBe('openai-fast');
    expect(getNvidiaModelMetadata(nvidiaCall?.model || '')?.apiFamily).toBe('chat-completions');
  });

  it('registers MiniMax M3 as a NVIDIA chat-completions model', () => {
    expect(getNvidiaModelMetadata('minimaxai/minimax-m3')).toMatchObject({
      provider: 'nvidia',
      modelId: 'minimaxai/minimax-m3',
      apiFamily: 'chat-completions',
      endpoint: '/chat/completions',
      uiSelectable: true,
    });
  });

  it('registers Z.ai GLM-5.2 as a NVIDIA chat-completions model', () => {
    expect(getNvidiaModelMetadata('z-ai/glm-5.2')).toMatchObject({
      provider: 'nvidia',
      modelId: 'z-ai/glm-5.2',
      apiFamily: 'chat-completions',
      endpoint: '/chat/completions',
      uiSelectable: true,
    });
  });

  it('registers the current DeepSeek V4 Flash route as a NVIDIA tool-capable chat-completions model', () => {
    expect(getNvidiaModelMetadata('deepseek-ai/deepseek-v4-flash-0731')).toMatchObject({
      provider: 'nvidia',
      modelId: 'deepseek-ai/deepseek-v4-flash-0731',
      apiFamily: 'chat-completions',
      endpoint: '/chat/completions',
      supportsTools: true,
      uiSelectable: true,
      defaultParams: {
        temperature: 1,
        maxTokens: 16384,
        topP: 0.95,
      },
    });
    expect(getNvidiaModelMetadata('deepseek-ai/deepseek-v4-flash')).toMatchObject({
      uiSelectable: false,
    });
  });

  it('registers Step 3.7 Flash as a NVIDIA multimodal tool-capable chat model', () => {
    expect(getNvidiaModelMetadata('stepfun-ai/step-3.7-flash')).toMatchObject({
      provider: 'nvidia',
      modelId: 'stepfun-ai/step-3.7-flash',
      apiFamily: 'chat-completions',
      endpoint: '/chat/completions',
      supportsTools: true,
      inputModalities: ['text', 'image'],
      uiSelectable: true,
      defaultParams: {
        temperature: 1,
        maxTokens: 16384,
        topP: 0.95,
      },
    });
  });

  it('registers Google Gemma 4 31B IT as a NVIDIA multimodal tool-capable chat model', () => {
    expect(getNvidiaModelMetadata('google/gemma-4-31b-it')).toMatchObject({
      provider: 'nvidia',
      modelId: 'google/gemma-4-31b-it',
      apiFamily: 'chat-completions',
      endpoint: '/chat/completions',
      supportsTools: true,
      inputModalities: ['text', 'image', 'video'],
      uiSelectable: true,
      defaultParams: {
        temperature: 1,
        maxTokens: 16384,
        topP: 0.95,
      },
    });
  });

  it('keeps DiffusionGemma 26B A4B IT separate as a NVIDIA multimodal chat model', () => {
    expect(getNvidiaModelMetadata('google/diffusiongemma-26b-a4b-it')).toMatchObject({
      provider: 'nvidia',
      modelId: 'google/diffusiongemma-26b-a4b-it',
      apiFamily: 'chat-completions',
      endpoint: '/chat/completions',
      supportsTools: true,
      inputModalities: ['text', 'image', 'video'],
      uiSelectable: true,
      defaultParams: {
        temperature: 0.8,
        maxTokens: 16384,
        topP: 0.95,
      },
    });
  });

  it('registers Kimi K2.6 as a NVIDIA multimodal tool-capable chat model', () => {
    expect(getNvidiaModelMetadata('moonshotai/kimi-k2.6')).toMatchObject({
      provider: 'nvidia',
      modelId: 'moonshotai/kimi-k2.6',
      apiFamily: 'chat-completions',
      endpoint: '/chat/completions',
      supportsTools: true,
      inputModalities: ['text', 'image', 'video'],
      uiSelectable: true,
      defaultParams: {
        temperature: 1,
        maxTokens: 16384,
        topP: 1,
      },
    });
  });

  it('routes prefixed OpenRouter models to OpenRouter and strips the local prefix', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const nvidia = createProvider('nvidia', async (model) => {
      calls.push({ provider: 'nvidia', model });
      return 'nvidia response';
    });
    const openrouter = createProvider('openrouter', async (model) => {
      calls.push({ provider: 'openrouter', model });
      return 'openrouter response';
    });

    await expect(new CompositeLLMProvider([nvidia, openrouter]).createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'openrouter:google/gemma-4-31b-it:free',
    )).resolves.toBe('openrouter response');
    expect(calls).toEqual([{ provider: 'openrouter', model: 'google/gemma-4-31b-it:free' }]);
  });

  it('uses the configured OpenRouter model when a NVIDIA route falls back', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const nvidia = createProvider('nvidia', async (model) => {
      calls.push({ provider: 'nvidia', model });
      throw new Error('NVIDIA unavailable');
    });
    const openrouter = createProvider('openrouter', async (model) => {
      calls.push({ provider: 'openrouter', model });
      return 'openrouter fallback';
    });

    await expect(new CompositeLLMProvider([nvidia, openrouter]).createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'z-ai/glm-5.2',
    )).resolves.toBe('openrouter fallback');
    expect(calls).toEqual([
      { provider: 'nvidia', model: 'z-ai/glm-5.2' },
      { provider: 'openrouter', model: getConfiguredOpenRouterModel() },
    ]);
  });

  it('sends OpenAI-compatible tool calls through OpenRouter', async () => {
    let requestUrl = '';
    let requestHeaders: Record<string, string> = {};
    let requestBody: any;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (url: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(url);
      requestHeaders = init?.headers as Record<string, string>;
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', tool_calls: [{
          id: 'call_read', type: 'function', function: { name: 'Read', arguments: '{"file_path":"package.json"}' },
        }] } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);

    const provider = new OpenRouterLLMProvider('openrouter-test-key');
    const result = await provider.createChatCompletion(
      [{ role: 'user', content: 'Read package.json' }],
      'google/gemma-4-31b-it:free',
      {
        tools: [{ type: 'function', function: {
          name: 'Read', description: 'Read a file', parameters: { type: 'object', properties: { file_path: { type: 'string' } } },
        } }],
        toolChoice: 'required',
      },
    );

    expect(requestUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(requestHeaders.Authorization).toBe('Bearer openrouter-test-key');
    expect(requestBody).toMatchObject({
      model: 'google/gemma-4-31b-it:free',
      tool_choice: 'required',
      tools: [{ function: { name: 'Read' } }],
    });
    expect(JSON.parse(result).tool_calls[0].function.name).toBe('Read');
  });

  it('reports OpenRouter prompt usage for actual context monitoring', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      model: 'google/gemma-4-31b-it:free',
      choices: [{
        message: { role: 'assistant', content: 'Visible answer' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 4_321, completion_tokens: 87, total_tokens: 4_408 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const telemetry: any[] = [];
    const completions: any[] = [];
    const provider = new OpenRouterLLMProvider('openrouter-test-key');
    const result = await new CompositeLLMProvider([provider]).createChatCompletion(
      [{ role: 'user', content: 'Monitor this request.' }],
      'openrouter:google/gemma-4-31b-it:free',
      {
        onTelemetry: (event) => telemetry.push(event),
        onCompletionResult: (completion) => completions.push(completion),
      },
    );

    expect(result).toBe('Visible answer');
    expect(completions.at(-1)).toMatchObject({
      usage: { inputTokens: 4_321, outputTokens: 87, totalTokens: 4_408 },
      provider: 'openrouter',
    });
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]).toMatchObject({
      provider: 'openrouter',
      status: 'succeeded',
      reportedInputTokens: 4_321,
      reportedOutputTokens: 87,
      estimatedInputTokens: expect.any(Number),
    });
  });

  it('uses Groq identity and endpoint in OpenAI-compatible transport errors', async () => {
    let requestUrl = '';
    let requestHeaders: Record<string, string> = {};
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (url: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(url);
      requestHeaders = init?.headers as Record<string, string>;
      return new Response('{"error":{"message":"rate limit reached"}}', { status: 429 });
    }) as typeof fetch);
    const provider = new GroqLLMProvider('groq-test-key');

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'llama-3.3-70b-versatile',
    )).rejects.toThrow(/Groq is rate limited.*No other Groq account was used/i);
    expect(requestUrl).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(requestHeaders).not.toHaveProperty('X-OpenRouter-Title');
  });

  it('does not call or report Groq when another provider was selected without Groq fallback approval', async () => {
    const calls: string[] = [];
    const openrouter = createProvider('openrouter', async () => {
      calls.push('openrouter');
      throw new Error('Selected OpenRouter route failed');
    });
    const groq = new GroqLLMProvider('gsk_unselected');
    jest.spyOn(globalThis, 'fetch').mockImplementation((async () => {
      calls.push('groq');
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'SHOULD_NOT_RUN' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);

    await expect(new CompositeLLMProvider([openrouter, groq]).createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'openrouter:openrouter/free',
      {
        allowCrossProviderFallback: false,
        approvedFallbackProviders: [],
        allowedExternalProviders: ['openrouter'],
      },
    )).rejects.toThrow(/Selected OpenRouter route failed/);

    expect(calls).toEqual(['openrouter']);
  });

  it.each(['gemini', 'nvidia', 'openrouter', 'groq', 'kimi', 'requesty', 'pollinations'])(
    'does not call an unapproved %s destination when another provider was selected',
    async (destination) => {
      const calls: string[] = [];
      const selectedProvider = destination === 'openrouter' ? 'nvidia' : 'openrouter';
      const selectedModel = selectedProvider === 'nvidia'
        ? 'z-ai/glm-5.2'
        : 'openrouter:openrouter/free';
      const primary = createProvider(selectedProvider, async () => {
        calls.push(selectedProvider);
        throw new Error('Selected provider failed');
      });
      const fallback = createProvider(destination, async () => {
        calls.push(destination);
        return 'UNAPPROVED_FALLBACK';
      });

      await expect(new CompositeLLMProvider([fallback, primary]).createChatCompletion(
        [{ role: 'user', content: 'Hello' }],
        selectedModel,
        {
          allowCrossProviderFallback: false,
          fallbackApprovalGranted: false,
          approvedFallbackProviders: [],
        },
      )).rejects.toThrow(/Selected provider failed/);

      expect(calls).toEqual([selectedProvider]);
    },
  );

  it('does not let skipped provider routes dilute the selected provider deadline', async () => {
    let selectedTimeoutMs = 0;
    const selected: LLMProvider = {
      createChatCompletion: async (_messages, _model, options) => {
        selectedTimeoutMs = options?.timeoutMs || 0;
        return 'SELECTED_PROVIDER_OK';
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'nvidia',
      isAvailable: () => true,
    };
    const skippedProviders = ['gemini', 'openrouter', 'groq', 'kimi', 'requesty', 'pollinations']
      .map((providerName) => createProvider(providerName, async () => {
        throw new Error(`${providerName} should not run`);
      }));

    await expect(new CompositeLLMProvider([selected, ...skippedProviders]).createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'z-ai/glm-5.2',
      {
        timeoutMs: 90_000,
        allowCrossProviderFallback: false,
        fallbackApprovalGranted: false,
        approvedFallbackProviders: [],
      },
    )).resolves.toBe('SELECTED_PROVIDER_OK');

    expect(selectedTimeoutMs).toBeGreaterThanOrEqual(89_000);
  });

  it.each(['gemini', 'nvidia', 'groq', 'kimi', 'requesty', 'pollinations', 'local'])(
    'uses an approved %s destination only after the selected provider fails',
    async (destination) => {
      const calls: string[] = [];
      const primary = createProvider('openrouter', async () => {
        calls.push('openrouter');
        throw new Error('Selected OpenRouter route failed');
      });
      const fallback = createProvider(destination, async () => {
        calls.push(destination);
        return 'APPROVED_FALLBACK';
      });

      await expect(new CompositeLLMProvider([fallback, primary]).createChatCompletion(
        [{ role: 'user', content: 'Hello' }],
        'openrouter:openrouter/free',
        {
          allowCrossProviderFallback: true,
          fallbackApprovalGranted: true,
          approvedFallbackProviders: [destination],
          allowedExternalProviders: ['openrouter', destination],
        },
      )).resolves.toBe('APPROVED_FALLBACK');

      expect(calls).toEqual(['openrouter', destination]);
    },
  );

  it('blocks every external fallback from receiving private workspace source without approval', async () => {
    const calls: string[] = [];
    const openrouter = createProvider('openrouter', async () => {
      calls.push('openrouter');
      throw new Error('Selected OpenRouter route failed');
    });
    const gemini = createProvider('gemini', async () => {
      calls.push('gemini');
      return 'SHOULD_NOT_RUN';
    });

    await expect(new CompositeLLMProvider([gemini, openrouter]).createChatCompletion(
      [{ role: 'user', content: 'Private source' }],
      'openrouter:openrouter/free',
      {
        allowCrossProviderFallback: true,
        fallbackApprovalGranted: true,
        approvedFallbackProviders: ['gemini'],
        allowedExternalProviders: ['openrouter', 'gemini'],
        privateWorkspace: true,
        sendPrivateSourceCode: false,
      },
    )).rejects.toThrow(/Private workspace source cannot be sent to openrouter/);

    expect(calls).toEqual([]);
  });

  it('uses Groq as a destination only when cross-provider, approval, and workspace policies all allow it', async () => {
    const calls: string[] = [];
    const openrouter = createProvider('openrouter', async () => {
      calls.push('openrouter');
      throw new Error('Selected OpenRouter route failed');
    });
    const groq = new GroqLLMProvider('gsk_approved');
    jest.spyOn(globalThis, 'fetch').mockImplementation((async () => {
      calls.push('groq');
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'APPROVED_GROQ_FALLBACK' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);

    await expect(new CompositeLLMProvider([openrouter, groq]).createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'openrouter:openrouter/free',
      {
        allowCrossProviderFallback: true,
        fallbackApprovalGranted: true,
        approvedFallbackProviders: ['groq'],
        allowedExternalProviders: ['openrouter', 'groq'],
      },
    )).resolves.toBe('APPROVED_GROQ_FALLBACK');

    expect(calls).toEqual(['openrouter', 'groq']);
  });

  it('never consults another Groq credential after a quota failure', async () => {
    const authorizationHeaders: string[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string>).Authorization;
      authorizationHeaders.push(authorization);
      return new Response('{"error":{"message":"Free model rate limit exceeded"}}', { status: 429 });
    }) as typeof fetch);
    const provider = new GroqLLMProvider('gsk_test_primary');

    await expect(new CompositeLLMProvider([provider]).createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'groq:llama-3.3-70b-versatile',
      { timeoutMs: 20_000 },
    )).rejects.toThrow(/quota|rate limit|HTTP 429/i);

    expect(authorizationHeaders).toEqual(['Bearer gsk_test_primary']);
    const statuses = getProviderRateLimitStatuses()
      .filter((status) => status.provider === 'groq');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({
      status: 'quota_exhausted',
      failureCount: 1,
    });
    expect(statuses[0].credentialIndex).toBeUndefined();
  });

  it('rejects multiple Groq provider instances instead of aggregating accounts', () => {
    expect(() => new CompositeLLMProvider([
      new GroqLLMProvider('gsk_first'),
      new GroqLLMProvider('gsk_second'),
    ])).toThrow(/Multiple Groq provider instances are not supported/i);
  });

  it('migrates a legacy Groq credential target to the single configured route', async () => {
    const authorizationHeaders: string[] = [];
    const requestModels: string[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      authorizationHeaders.push(headers.Authorization);
      requestModels.push(JSON.parse(String(init?.body)).model);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'PINNED_GROQ_ACCOUNT_OK' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);
    const provider = new GroqLLMProvider('gsk_test_primary');

    await expect(new CompositeLLMProvider([provider]).createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'groq-target:key-2',
      { timeoutMs: 20_000 },
    )).resolves.toBe('PINNED_GROQ_ACCOUNT_OK');

    expect(authorizationHeaders).toEqual(['Bearer gsk_test_primary']);
    expect(requestModels).toEqual([getConfiguredGroqModel()]);
  });

  it('emits one merged telemetry event for a Groq request through the composite', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation((async () => new Response(JSON.stringify({
      id: 'groq-telemetry-id',
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      choices: [{ finish_reason: 'stop', message: { content: 'OK' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch);
    const telemetry: any[] = [];
    await expect(new CompositeLLMProvider([
      new GroqLLMProvider('gsk_test'),
    ]).createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'groq:test-model',
      { onTelemetry: (event) => telemetry.push(event) },
    )).resolves.toBe('OK');
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]).toMatchObject({
      provider: 'groq',
      status: 'succeeded',
      requestId: 'groq-telemetry-id',
      reportedInputTokens: 3,
      reportedOutputTokens: 2,
    });
  });

  it('requires explicit approval before falling back from Groq to another provider', async () => {
    const calls: string[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation((async () => {
      calls.push('groq');
      return new Response('{"error":{"message":"rate limit"}}', { status: 429 });
    }) as typeof fetch);
    const groq = new GroqLLMProvider('gsk_test', {
      enabled: true,
      fallbackEnabled: true,
      fallbackProviders: ['local'],
      fallbackRequiresApproval: true,
      maxRetries: 0,
    });
    const local = createProvider('local', async () => {
      calls.push('local');
      return 'LOCAL_OK';
    });
    const provider = new CompositeLLMProvider([groq, local]);

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'groq:test-model',
    )).rejects.toThrow(/rate limited.*No other Groq account/i);
    expect(calls).toEqual(['groq']);

    calls.length = 0;
    resetProviderRateLimitMonitor();
    await resetGroqRequestScheduler();
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'groq:test-model',
      {
        allowCrossProviderFallback: true,
        approvedFallbackProviders: ['local'],
        fallbackApprovalGranted: true,
      },
    )).resolves.toBe('LOCAL_OK');
    expect(calls).toEqual(['groq', 'local']);
  });

  it('reports legacy Groq selections as unavailable when no Groq key is configured', async () => {
    const local = createProvider('local', async () => 'SHOULD_NOT_RUN');
    await expect(new CompositeLLMProvider([local]).createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'groq-target:key-3',
    )).rejects.toThrow(/Groq provider is unavailable.*GROQ_ENABLED=true.*GROQ_API_KEY/i);
  });

  it('redacts Groq credentials echoed by an upstream error', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation((async () => new Response(
      '{"token":"gsk_do_not_expose_123456789","error":"invalid"}',
      { status: 401 },
    )) as typeof fetch);
    const provider = new GroqLLMProvider('gsk_do_not_expose_123456789');

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'llama-3.3-70b-versatile',
    )).rejects.not.toThrow(/gsk_do_not_expose_123456789/);
  });

  it('uses Kimi identity and the native Moonshot endpoint', async () => {
    let requestUrl = '';
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (url: string | URL | Request) => {
      requestUrl = String(url);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'KIMI_OK' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);
    const provider = new KimiLLMProvider('kimi-test-key');

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'kimi:kimi-k2.7-code',
    )).resolves.toBe('KIMI_OK');
    expect(requestUrl).toBe('https://api.moonshot.ai/v1/chat/completions');
    expect(provider.getProviderName()).toBe('kimi');
  });

  it('routes a Kimi-prefixed request to Kimi with its exact model id', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const gemini = createProvider('gemini', async (model) => {
      calls.push({ provider: 'gemini', model });
      return 'wrong provider';
    });
    const kimi = createProvider('kimi', async (model) => {
      calls.push({ provider: 'kimi', model });
      return 'Kimi response';
    });

    await expect(new CompositeLLMProvider([gemini, kimi]).createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'kimi:kimi-k2.7-code',
    )).resolves.toBe('Kimi response');
    expect(calls).toEqual([{ provider: 'kimi', model: 'kimi-k2.7-code' }]);
  });

  it('uses Requesty identity and strips its UI route prefix', async () => {
    let requestUrl = '';
    let requestBody: any;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (url: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(url);
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'REQUESTY_OK' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);
    const provider = new RequestyLLMProvider('requesty-test-key');

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'requesty:poolside/laguna-m.1',
    )).resolves.toBe('REQUESTY_OK');
    expect(requestUrl).toBe('https://router.requesty.ai/v1/chat/completions');
    expect(requestBody.model).toBe('poolside/laguna-m.1');
    expect(requestBody.max_tokens).toBe(512);
    expect(provider.getProviderName()).toBe('requesty');
  });

  it('routes a Requesty-prefixed request to Requesty first', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const gemini = createProvider('gemini', async (model) => {
      calls.push({ provider: 'gemini', model });
      return 'wrong provider';
    });
    const requesty = createProvider('requesty', async (model) => {
      calls.push({ provider: 'requesty', model });
      return 'Requesty response';
    });

    await expect(new CompositeLLMProvider([gemini, requesty]).createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'requesty:poolside/laguna-m.1',
    )).resolves.toBe('Requesty response');
    expect(calls).toEqual([{ provider: 'requesty', model: 'poolside/laguna-m.1' }]);
  });

  it('redacts OpenRouter credentials returned by an API error', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation((async () => new Response(
      '{"token":"sk-or-v1-do-not-expose","error":"invalid"}',
      { status: 401 },
    )) as typeof fetch);
    const provider = new OpenRouterLLMProvider('sk-or-v1-do-not-expose');

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'google/gemma-4-31b-it:free',
    )).rejects.not.toThrow(/sk-or-v1-do-not-expose/);
  });

  it('reports the OpenRouter cause for a successful response with no usable content', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation((async () => new Response(JSON.stringify({
      choices: [{
        finish_reason: 'length',
        message: { role: 'assistant', content: null, reasoning: 'Internal reasoning used the output budget.' },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch);
    const provider = new OpenRouterLLMProvider('openrouter-test-key');

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'google/gemma-4-26b-a4b-it:free',
    )).rejects.toThrow(/reasoning-only response \(finish reason: length\)/);
  });

  it('reserves visible output tokens and minimizes reasoning for the OpenRouter free router', async () => {
    let requestBody: any;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        model: 'example/reasoning-model:free',
        choices: [{ message: { content: 'OPENROUTER_ROUTE_OK' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);

    const provider = new OpenRouterLLMProvider('openrouter-test-key');
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Reply with exactly: OPENROUTER_ROUTE_OK' }],
      'openrouter/free',
      { maxTokens: 32 },
    )).resolves.toBe('OPENROUTER_ROUTE_OK');

    expect(requestBody).toMatchObject({
      model: 'openrouter/free',
      max_tokens: 2_048,
      reasoning: { effort: 'minimal', exclude: true },
    });
  });

  it('sends exact OpenRouter model requests without fallback array', async () => {
    let requestBody: any;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        model: 'minimax/minimax-m3:free',
        choices: [{ message: { content: 'OPENROUTER_EXACT_OK' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);

    const provider = new OpenRouterLLMProvider('openrouter-test-key');
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Reply with exactly: OPENROUTER_EXACT_OK' }],
      'minimax/minimax-m3:free',
      { freeTierResilience: true, pinModel: true, maxTokens: 512 },
    )).resolves.toBe('OPENROUTER_EXACT_OK');

    expect(requestBody).toMatchObject({ model: 'minimax/minimax-m3:free' });
    expect(requestBody).not.toHaveProperty('models');
    expect(requestBody).not.toHaveProperty('provider');
  });

  it('reports upstream shared pool rate limits clearly from OpenRouter error metadata', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation((async () => {
      return new Response(JSON.stringify({
        error: {
          message: 'Provider returned error',
          code: 429,
          metadata: {
            raw: 'google/gemma-4-26b-a4b-it:free is temporarily rate-limited upstream. Please retry shortly.',
            limit_source: 'upstream_provider_shared_pool',
          },
        },
      }), { status: 429, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);

    const provider = new OpenRouterLLMProvider('openrouter-test-key');
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'google/gemma-4-26b-a4b-it:free',
      { maxTokens: 512 },
    )).rejects.toThrow(/upstream shared pool rate-limited/i);
  });

  it('keeps a pinned OpenRouter free model request exact without resilience enabled', async () => {
    let requestBody: any;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'OPENROUTER_EXACT_OK' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);

    const provider = new OpenRouterLLMProvider('openrouter-test-key');
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Reply with exactly: OPENROUTER_EXACT_OK' }],
      'minimax/minimax-m3:free',
      { pinModel: true, maxTokens: 512 },
    )).resolves.toBe('OPENROUTER_EXACT_OK');

    expect(requestBody).toMatchObject({ model: 'minimax/minimax-m3:free' });
    expect(requestBody).not.toHaveProperty('models');
  });

  it('prevents circular fallback loops when primary model is openrouter/free', async () => {
    let requestBody: any;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'DYNAMIC_FREE_OK' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);

    const provider = new OpenRouterLLMProvider('openrouter-test-key');
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'openrouter/free',
      { freeTierResilience: true, maxTokens: 512 },
    )).resolves.toBe('DYNAMIC_FREE_OK');

    expect(requestBody).toMatchObject({ model: 'openrouter/free' });
    expect(requestBody).not.toHaveProperty('models');
  });

  it('does not send reasoning: enabled: false for mandatory reasoning models like gemma-4', async () => {
    let requestBody: any;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'MANDATORY_REASONING_OK' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);

    const provider = new OpenRouterLLMProvider('openrouter-test-key');
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Plan step' }],
      'google/gemma-4-26b-a4b-it:free',
      { requestKind: 'step.plan_action', maxTokens: 512 },
    )).resolves.toBe('MANDATORY_REASONING_OK');

    expect(requestBody.reasoning).not.toEqual({ enabled: false, exclude: true });
    expect(requestBody.reasoning).toMatchObject({ effort: 'minimal', exclude: true });
  });

  it('records telemetry for model resolutions, fallback usage, and provider failures', async () => {
    const telemetryEvents: any[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      return new Response(JSON.stringify({
        model: 'google/gemma-4-31b-it:free',
        choices: [{ message: { content: 'RESOLVED_FALLBACK_OK' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);

    const provider = new OpenRouterLLMProvider('openrouter-test-key');
    await provider.createChatCompletion(
      [{ role: 'user', content: 'Test telemetry' }],
      'minimax/minimax-m3:free',
      {
        freeTierResilience: true,
        maxTokens: 512,
        onTelemetry: (telemetry) => telemetryEvents.push(telemetry),
      },
    );

    expect(telemetryEvents).toHaveLength(1);
    expect(telemetryEvents[0]).toMatchObject({
      provider: 'openrouter',
      model: 'minimax/minimax-m3:free',
      resolvedModel: 'google/gemma-4-31b-it:free',
      fallbackUsed: true,
      status: 'succeeded',
    });

    // Failure telemetry test
    telemetryEvents.length = 0;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async () => {
      return new Response('Rate limit exceeded', { status: 429 });
    }) as typeof fetch);

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Fail telemetry' }],
      'minimax/minimax-m3:free',
      { onTelemetry: (telemetry) => telemetryEvents.push(telemetry) },
    )).rejects.toThrow();

    expect(telemetryEvents).toHaveLength(1);
    expect(telemetryEvents[0]).toMatchObject({
      provider: 'openrouter',
      model: 'minimax/minimax-m3:free',
      status: 'failed',
    });
  });

  it('passes native OpenRouter reasoning settings and reports only a safe summary', async () => {
    let requestBody: any;
    let completionResult: any;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: 'OPENROUTER_REASONING_OK',
            reasoning: 'private raw reasoning must not be surfaced',
            reasoning_details: [
              { type: 'reasoning.text', text: 'private raw detail' },
              { type: 'reasoning.summary', summary: 'Inspected the task evidence and selected the next action.' },
            ],
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);

    const provider = new OpenRouterLLMProvider('openrouter-test-key');
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Inspect the workspace.' }],
      'openai/example-reasoning-model',
      {
        reasoning: { effort: 'high', summary: 'concise' },
        onCompletionResult: (result) => { completionResult = result; },
      },
    )).resolves.toBe('OPENROUTER_REASONING_OK');

    expect(requestBody.reasoning).toEqual({ effort: 'high', summary: 'concise' });
    expect(completionResult.reasoningSummary).toBe('Inspected the task evidence and selected the next action.');
    expect(completionResult.reasoningSummary).not.toContain('private raw');
  });

  it('enables mandatory Ox Alpha reasoning and maps generic effort levels', async () => {
    let requestBody: any;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'OX_ALPHA_OK' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);

    const provider = new OpenRouterLLMProvider('openrouter-test-key');
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Reply with exactly: OX_ALPHA_OK' }],
      'stealth/ox-alpha',
      { maxTokens: 800, reasoning: { effort: 'minimal', summary: 'concise' } },
    )).resolves.toBe('OX_ALPHA_OK');

    expect(requestBody.model).toBe('stealth/ox-alpha');
    expect(requestBody.max_tokens).toBe(131_072);
    expect(requestBody.reasoning).toEqual({ effort: 'low' });
  });

  it('sends attached data-url images as OpenRouter multimodal content for Ox Alpha', async () => {
    let requestBody: any;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'IMAGE_OK' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);

    const imageUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const provider = new OpenRouterLLMProvider('openrouter-test-key');
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: `Describe this screenshot.\n\n![screenshot](${imageUrl})` }],
      'stealth/ox-alpha',
      { maxTokens: 128, reasoning: { effort: 'low', exclude: true } },
    )).resolves.toBe('IMAGE_OK');

    expect(requestBody.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this screenshot.' },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    }]);
  });

  it('spaces fast OpenRouter requests across provider instances', async () => {
    jest.useFakeTimers({ now: 10_000 });
    const originalInterval = process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS;
    process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS = '50';
    try {
      const starts: number[] = [];
      jest.spyOn(globalThis, 'fetch').mockImplementation((async () => {
        starts.push(Date.now());
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch);

      await expect(new OpenRouterLLMProvider('openrouter-fast-a').createChatCompletion(
        [{ role: 'user', content: 'first' }],
        'openrouter/free',
        { pacingProfile: 'fast', timeoutMs: 60_000 },
      )).resolves.toBe('ok');

      const second = new OpenRouterLLMProvider('openrouter-fast-b').createChatCompletion(
        [{ role: 'user', content: 'second' }],
        'openrouter/free',
        { pacingProfile: 'fast', timeoutMs: 60_000 },
      );
      await jest.advanceTimersByTimeAsync(49);
      expect(starts).toEqual([10_000]);
      await jest.advanceTimersByTimeAsync(1);

      await expect(second).resolves.toBe('ok');
      expect(starts).toEqual([10_000, 10_050]);
    } finally {
      if (originalInterval === undefined) delete process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS;
      else process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS = originalInterval;
      jest.useRealTimers();
    }
  });

  it('defaults Ox Alpha to its mandatory maximum reasoning effort when no options are supplied', async () => {
    let requestBody: any;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'OX_ALPHA_DEFAULT_OK' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);

    const provider = new OpenRouterLLMProvider('openrouter-test-key');
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Reply with exactly: OX_ALPHA_DEFAULT_OK' }],
      'stealth/ox-alpha',
    )).resolves.toBe('OX_ALPHA_DEFAULT_OK');

    expect(requestBody.reasoning).toEqual({ effort: 'max' });
    expect(requestBody.max_tokens).toBe(131_072);
  });

  it('retries an empty Ox Alpha response with a visible-answer-safe request', async () => {
    const originalInterval = process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS;
    process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS = '0';
    try {
      const requestBodies: any[] = [];
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
        requestBodies.push(JSON.parse(String(init?.body)));
        const response = fetchMock.mock.calls.length === 1
          ? {
            choices: [{
              finish_reason: 'stop',
              message: { role: 'assistant', content: null, reasoning: 'The route produced no visible answer.' },
            }],
          }
          : {
            choices: [{ finish_reason: 'stop', message: { content: 'OX_ALPHA_RECOVERED' } }],
          };
        return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch);

      const provider = new OpenRouterLLMProvider('openrouter-test-key');
      await expect(provider.createChatCompletion(
        [{ role: 'user', content: 'Choose the next coder action.' }],
        'stealth/ox-alpha',
        { requestKind: 'step.plan_action', maxTokens: 128, timeoutMs: 5_000, pinModel: true },
      )).resolves.toBe('OX_ALPHA_RECOVERED');

      expect(requestBodies).toHaveLength(2);
      expect(requestBodies[0].model).toBe('stealth/ox-alpha');
      expect(requestBodies[1].model).toBe('stealth/ox-alpha');
      expect(requestBodies[1].reasoning).toEqual({ effort: 'low', exclude: true });
    } finally {
      if (originalInterval === undefined) delete process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS;
      else process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS = originalInterval;
    }
  });

  it('uses the deterministic structured route instead of the random free router for Ox Alpha recovery', async () => {
    const originalInterval = process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS;
    process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS = '0';
    try {
      const requestBodies: any[] = [];
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
        requestBodies.push(JSON.parse(String(init?.body)));
        const response = fetchMock.mock.calls.length <= 2
          ? { choices: [{ finish_reason: 'stop', message: { content: null, reasoning: 'No visible answer.' } }] }
          : { choices: [{ finish_reason: 'stop', message: { content: 'OX_ALPHA_REASON_RECOVERED' } }] };
        return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch);

      const provider = new OpenRouterLLMProvider('openrouter-test-key');
      await expect(provider.createChatCompletion(
        [{ role: 'user', content: 'Explain the next action.' }],
        'stealth/ox-alpha',
        { requestKind: 'step.plan_action', maxTokens: 131_072, reasoning: { effort: 'high' } },
      )).resolves.toBe('OX_ALPHA_REASON_RECOVERED');

      expect(requestBodies).toHaveLength(3);
      expect(requestBodies[1].model).toBe('stealth/ox-alpha');
      expect(requestBodies[1].reasoning).toEqual({ effort: 'low', exclude: true });
      expect(requestBodies[2].model).toBe('dots-studio/dots-3-note-preview:free');
      expect(requestBodies[2]).not.toHaveProperty('reasoning');
      expect(requestBodies[2].max_tokens).toBe(8_192);
    } finally {
      if (originalInterval === undefined) delete process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS;
      else process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS = originalInterval;
    }
  });

  it('retries Ox Alpha recovery without tools when the structured route rejects the tool payload', async () => {
    const originalInterval = process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS;
    process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS = '0';
    try {
      const requestBodies: any[] = [];
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        requestBodies.push(body);
        const call = fetchMock.mock.calls.length;
        if (call <= 2) {
          return new Response(JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: null, reasoning: 'No visible answer.' } }],
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (call === 3) {
          return new Response(JSON.stringify({ error: { message: 'Provider rejected the tool payload' } }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"tool":"Read","arguments":{"file_path":"README.md"}}' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch);

      const provider = new OpenRouterLLMProvider('openrouter-test-key');
      await expect(provider.createChatCompletion(
        [{ role: 'user', content: 'Choose the next coder action.' }],
        'stealth/ox-alpha',
        {
          requestKind: 'step.plan_action',
          maxTokens: 131_072,
          tools: [{ type: 'function', function: { name: 'Read', description: 'Read a file', parameters: { type: 'object' } } }],
          toolChoice: 'required',
        },
      )).resolves.toContain('"tool":"Read"');

      expect(requestBodies).toHaveLength(4);
      expect(requestBodies[2].model).toBe('dots-studio/dots-3-note-preview:free');
      expect(requestBodies[2].max_tokens).toBe(8_192);
      expect(requestBodies[2].tools).toHaveLength(1);
      expect(requestBodies[2]).not.toHaveProperty('reasoning');
      expect(requestBodies[3].model).toBe('dots-studio/dots-3-note-preview:free');
      expect(requestBodies[3]).not.toHaveProperty('tools');
      expect(requestBodies[3]).not.toHaveProperty('tool_choice');
      expect(requestBodies[3]).not.toHaveProperty('reasoning');
    } finally {
      if (originalInterval === undefined) delete process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS;
      else process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS = originalInterval;
    }
  });

  it('advertises Ox Alpha native tools and updated token limits through OpenRouter', () => {
    const provider = new OpenRouterLLMProvider('openrouter-test-key');
    expect(provider.getModelCapabilities('stealth/ox-alpha')).toMatchObject({
      toolCalling: true,
      structuredOutput: true,
      contextTokenLimit: 1_048_576,
      outputTokenLimit: 131_072,
    });

    const composite = new CompositeLLMProvider([provider]);
    expect(composite.getModelCapabilities?.('openrouter:stealth/ox-alpha')).toMatchObject({
      toolCalling: true,
      contextTokenLimit: 1_048_576,
    });
  });

  it('advertises NVIDIA native tools through a multi-provider composite', () => {
    const nvidia = new NvidiaLLMProvider('nvapi-test-key');
    const gemini = new GeminiLLMProvider('gemini-test-key');
    const composite = new CompositeLLMProvider([gemini, nvidia]);

    expect(nvidia.getModelCapabilities('google/gemma-4-31b-it')).toMatchObject({
      toolCalling: true,
      structuredOutput: true,
      jsonMode: true,
    });
    expect(composite.getModelCapabilities?.('google/gemma-4-31b-it')).toMatchObject({
      toolCalling: true,
      structuredOutput: true,
    });
  });

  it('recovers Ox Alpha empty content before the composite reports provider exhaustion', async () => {
    const originalInterval = process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS;
    process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS = '0';
    try {
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation((async () => {
        const response = fetchMock.mock.calls.length <= 2
          ? { choices: [{ finish_reason: 'stop', message: { content: null, reasoning: 'No visible answer.' } }] }
          : { choices: [{ finish_reason: 'stop', message: { content: 'COMPOSITE_RECOVERED' } }] };
        return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch);

      const composite = new CompositeLLMProvider([new OpenRouterLLMProvider('openrouter-test-key')]);
      await expect(composite.createChatCompletion(
        [{ role: 'user', content: 'Choose the next coder action.' }],
        'openrouter:stealth/ox-alpha',
        { requestKind: 'step.plan_action', maxTokens: 128, timeoutMs: 5_000, pinModel: true },
      )).resolves.toBe('COMPOSITE_RECOVERED');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      if (originalInterval === undefined) delete process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS;
      else process.env.OPENROUTER_MIN_REQUEST_INTERVAL_MS = originalInterval;
    }
  });

  it('routes Cerebras directly and preserves native tool calls', async () => {
    let requestUrl = '';
    let requestBody: any;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (url: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(url);
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'cerebras-test-response',
        model: 'gpt-oss-120b',
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'Read', arguments: '{"path":"README.md"}' } }],
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);

    const provider = new CerebrasLLMProvider('csk_test');
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Inspect the README.' }],
      'cerebras:gpt-oss-120b',
      {
        pinModel: true,
        tools: [{ type: 'function', function: { name: 'Read', description: 'Read a file', parameters: { type: 'object' } } }],
      },
    )).resolves.toContain('"name":"Read"');

    expect(requestUrl).toBe('https://api.cerebras.ai/v1/chat/completions');
    expect(requestBody).toMatchObject({
      model: 'gpt-oss-120b',
      tool_choice: 'auto',
      stream: false,
    });
    expect(requestBody.tools).toHaveLength(1);
  });

  it('does not cross-provider fallback when a Cerebras model is pinned', async () => {
    const calls: string[] = [];
    const cerebras = createProvider('cerebras', async (model) => {
      calls.push(`cerebras:${model}`);
      throw new Error('Cerebras unavailable');
    });
    const openrouter = createProvider('openrouter', async (model) => {
      calls.push(`openrouter:${model}`);
      return 'must not run';
    });

    await expect(new CompositeLLMProvider([openrouter, cerebras]).createChatCompletion(
      [{ role: 'user', content: 'Continue.' }],
      'cerebras:gpt-oss-120b',
      {
        pinModel: true,
        allowCrossProviderFallback: true,
        fallbackApprovalGranted: true,
        approvedFallbackProviders: ['openrouter'],
      },
    )).rejects.toThrow(/Cerebras unavailable/);

    expect(calls).toEqual(['cerebras:gpt-oss-120b']);
  });

  it('routes SambaNova directly and preserves native tool calls', async () => {
    let requestUrl = '';
    let requestBody: any;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (url: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(url);
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'sambanova-test-response',
        model: 'gpt-oss-120b',
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'Read', arguments: '{"path":"README.md"}' } }],
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);

    const provider = new SambaNovaLLMProvider('sambanova-test-key');
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Inspect the README.' }],
      'sambanova:gpt-oss-120b',
      {
        pinModel: true,
        tools: [{ type: 'function', function: { name: 'Read', description: 'Read a file', parameters: { type: 'object' } } }],
      },
    )).resolves.toContain('"name":"Read"');

    expect(requestUrl).toBe('https://api.sambanova.ai/v1/chat/completions');
    expect(requestBody).toMatchObject({
      model: 'gpt-oss-120b',
      tool_choice: 'auto',
      stream: false,
    });
    expect(requestBody.tools).toHaveLength(1);
  });

  it('does not cross-provider fallback when a SambaNova model is pinned', async () => {
    const calls: string[] = [];
    const sambaNova = createProvider('sambanova', async (model) => {
      calls.push(`sambanova:${model}`);
      throw new Error('SambaNova unavailable');
    });
    const cerebras = createProvider('cerebras', async (model) => {
      calls.push(`cerebras:${model}`);
      return 'must not run';
    });

    await expect(new CompositeLLMProvider([cerebras, sambaNova]).createChatCompletion(
      [{ role: 'user', content: 'Continue.' }],
      'sambanova:gpt-oss-120b',
      {
        pinModel: true,
        allowCrossProviderFallback: true,
        fallbackApprovalGranted: true,
        approvedFallbackProviders: ['cerebras'],
      },
    )).rejects.toThrow(/SambaNova unavailable/);

    expect(calls).toEqual(['sambanova:gpt-oss-120b']);
  });

  it('uses only the stable OpenRouter route and Groq backup for completion checks', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const nvidia = createProvider('nvidia', async (model) => {
      calls.push({ provider: 'nvidia', model });
      return 'NO';
    });
    const gemini = createProvider('gemini', async (model) => {
      calls.push({ provider: 'gemini', model });
      return 'NO';
    });
    const openrouter = createProvider('openrouter', async (model) => {
      calls.push({ provider: 'openrouter', model });
      return 'NO';
    });
    const groq = createProvider('groq', async (model) => {
      calls.push({ provider: 'groq', model });
      return 'NO';
    });

    await expect(new CompositeLLMProvider([nvidia, gemini, groq, openrouter]).createChatCompletion(
      [{ role: 'user', content: 'YES or NO' }],
      'z-ai/glm-5.2',
      { requestKind: 'step.check_done', maxTokens: 40 },
    )).resolves.toBe('NO');

    expect(calls).toEqual([{
      provider: 'openrouter',
      model: 'dots-studio/dots-3-note-preview:free',
    }]);
  });

  it('creates the full NVIDIA chat-model catalog for every configured key', () => {
    const targets = getDefaultNvidiaModelTargets(['nvapi_primary', 'nvapi_worker']);
    const primaryModels = targets.filter((target) => target.apiKeyIndex === 0).map((target) => target.modelId);
    const workerModels = targets.filter((target) => target.apiKeyIndex === 1).map((target) => target.modelId);

    expect(primaryModels.length).toBeGreaterThan(0);
    expect(workerModels).toEqual(primaryModels);
    expect(targets.every((target) => target.apiFamily === 'chat-completions')).toBe(true);
    expect(primaryModels).not.toContain('qwen/qwen3-coder-480b-a35b-instruct');
  });

  it('normalizes cross-provider fallback for NVIDIA model ids', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const nvidia = createProvider('nvidia', async (model) => {
      calls.push({ provider: 'nvidia', model });
      throw new Error('NVIDIA unavailable');
    });
    const pollinations = createProvider('pollinations', async (model) => {
      calls.push({ provider: 'pollinations', model });
      return 'pollinations response';
    });

    const provider = new CompositeLLMProvider([pollinations, nvidia]);

    const result = await provider.createChatCompletion(
      [{ role: 'user', content: 'Write a TypeScript refactor' }],
      'nvidia/nemotron-3-super-120b-a12b'
    );

    expect(result).toBe('pollinations response');
    expect(calls).toEqual([
      { provider: 'nvidia', model: 'nvidia/nemotron-3-super-120b-a12b' },
      { provider: 'pollinations', model: 'openai-fast' },
    ]);
  });

  it('routes informal Pollinations model aliases to Pollinations', async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    const gemini = createProvider('gemini', async (model) => {
      calls.push({ provider: 'gemini', model });
      return 'native gemini response';
    });
    const pollinations = createProvider('pollinations', async (model) => {
      calls.push({ provider: 'pollinations', model });
      return 'pollinations response';
    });

    const provider = new CompositeLLMProvider([gemini, pollinations]);

    const result = await provider.createChatCompletion(
      [{ role: 'user', content: 'Write a TypeScript refactor' }],
      'deepseek v4 pro'
    );

    expect(result).toBe('pollinations response');
    expect(calls).toEqual([{ provider: 'pollinations', model: 'deepseek-pro' }]);
  });

  it('normalizes Gemini model names inside the direct Pollinations provider', async () => {
    const calls: string[] = [];
    const originalChatCompletion = PollinationsLLMProvider.prototype.createChatCompletion;
    const provider = new PollinationsLLMProvider('pk_test');

    try {
      (provider as any).apiKey = 'pk_test';
      const pollinationsClientModule = await import('../../pollinations/client.js');
      const originalClientMethod = pollinationsClientModule.pollinationsClient.chatCompletion;
      pollinationsClientModule.pollinationsClient.chatCompletion = (async ({ model }: any) => {
        calls.push(model);
        return { content: 'ok' };
      }) as any;

      try {
        await provider.createChatCompletion(
          [{ role: 'user', content: 'Build arcade snake' }],
          'gemini-2.5-flash'
        );
      } finally {
        pollinationsClientModule.pollinationsClient.chatCompletion = originalClientMethod;
      }
    } finally {
      PollinationsLLMProvider.prototype.createChatCompletion = originalChatCompletion;
    }

    expect(calls).toEqual(['openai-fast']);
  });

  it('preserves case-sensitive Pollinations registry model ids', async () => {
    const pollinationsClientModule = await import('../../pollinations/client.js');
    const originalClientMethod = pollinationsClientModule.pollinationsClient.chatCompletion;
    const provider = new PollinationsLLMProvider('pk_test');
    const calls: string[] = [];

    pollinationsClientModule.pollinationsClient.chatCompletion = (async ({ model }: any) => {
      calls.push(model);
      return { content: 'ok' };
    }) as any;

    try {
      await provider.createChatCompletion(
        [{ role: 'user', content: 'Build arcade snake' }],
        'pollinations:community/Example-Chat',
        { pinModel: true },
      );
    } finally {
      pollinationsClientModule.pollinationsClient.chatCompletion = originalClientMethod;
    }

    expect(calls).toEqual(['community/Example-Chat']);
  });

  it('rotates Pollinations models when a requested model is temporarily overloaded', async () => {
    const pollinationsClientModule = await import('../../pollinations/client.js');
    const originalClientMethod = pollinationsClientModule.pollinationsClient.chatCompletion;
    const provider = new PollinationsLLMProvider('sk_test');
    const calls: string[] = [];

    pollinationsClientModule.pollinationsClient.chatCompletion = (async ({ model }: any) => {
      calls.push(model);
      if (model === 'deepseek-pro') {
        throw new Error(
          'Error: Pollinations API request failed\n' +
            'Cause: HTTP 503 error from Pollinations service\n' +
            'Context: Status: 503, Response: {"code":"SERVICE_UNAVAILABLE","message":"service overloaded"}'
        );
      }
      return { content: 'fallback ok' };
    }) as any;

    try {
      const result = await provider.createChatCompletion(
        [{ role: 'user', content: 'Build arcade snake' }],
        'deepseek-v4-pro'
      );

      expect(result).toBe('fallback ok');
      expect(calls).toEqual(['deepseek-pro', 'deepseek']);
    } finally {
      pollinationsClientModule.pollinationsClient.chatCompletion = originalClientMethod;
    }
  });

  it('rotates Pollinations models when a requested model returns empty content', async () => {
    const pollinationsClientModule = await import('../../pollinations/client.js');
    const originalClientMethod = pollinationsClientModule.pollinationsClient.chatCompletion;
    const provider = new PollinationsLLMProvider('sk_test');
    const calls: string[] = [];

    pollinationsClientModule.pollinationsClient.chatCompletion = (async ({ model }: any) => {
      calls.push(model);
      if (model === 'kimi') {
        return { content: '' };
      }
      return { content: 'fallback ok' };
    }) as any;

    try {
      const result = await provider.createChatCompletion(
        [{ role: 'user', content: 'Build arcade snake' }],
        'kimi'
      );

      expect(result).toBe('fallback ok');
      expect(calls).toEqual(['kimi', 'openai-fast']);
    } finally {
      pollinationsClientModule.pollinationsClient.chatCompletion = originalClientMethod;
    }
  });

  it('keeps a pinned Pollinations model exact when access is denied', async () => {
    const pollinationsClientModule = await import('../../pollinations/client.js');
    const originalClientMethod = pollinationsClientModule.pollinationsClient.chatCompletion;
    const provider = new PollinationsLLMProvider('sk_test');
    const calls: string[] = [];

    pollinationsClientModule.pollinationsClient.chatCompletion = (async ({ model }: any) => {
      calls.push(model);
      throw new Error(
        'Error: Pollinations API request failed\n' +
          'Cause: HTTP 402 error from Pollinations service\n' +
          'Context: Status: 402, Response: {"code":"PAYMENT_REQUIRED"}'
      );
    }) as any;

    try {
      await expect(provider.createChatCompletion(
        [{ role: 'user', content: 'Build arcade snake' }],
        'qwen3.8-27b',
        { pinModel: true },
      )).rejects.toThrow('Pollinations model request failed');

      expect(calls).toEqual(['qwen3.8-27b']);
    } finally {
      pollinationsClientModule.pollinationsClient.chatCompletion = originalClientMethod;
    }
  });

  it('passes native reasoning effort to an exact Pollinations model request', async () => {
    const pollinationsClientModule = await import('../../pollinations/client.js');
    const originalClientMethod = pollinationsClientModule.pollinationsClient.chatCompletion;
    const provider = new PollinationsLLMProvider('sk_test');
    const requests: Array<Record<string, unknown>> = [];

    pollinationsClientModule.pollinationsClient.chatCompletion = (async (request: Record<string, unknown>) => {
      requests.push(request);
      return { content: 'ok' };
    }) as any;

    try {
      await provider.createChatCompletion(
        [{ role: 'user', content: 'Build arcade snake' }],
        'MarcosFRG/qwen3.8-27b',
        { pinModel: true, reasoning: { effort: 'low' } },
      );
    } finally {
      pollinationsClientModule.pollinationsClient.chatCompletion = originalClientMethod;
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      model: 'MarcosFRG/qwen3.8-27b',
      reasoning_effort: 'low',
    });
  });

  it('reports an invalid Pollinations credential instead of rotating every model', async () => {
    const pollinationsClientModule = await import('../../pollinations/client.js');
    const originalClientMethod = pollinationsClientModule.pollinationsClient.chatCompletion;
    const provider = new PollinationsLLMProvider('sk_test');
    const calls: string[] = [];

    pollinationsClientModule.pollinationsClient.chatCompletion = (async ({ model }: any) => {
      calls.push(model);
      throw new Error(
        'Error: Pollinations API request failed\n' +
          'Cause: HTTP 401 error from Pollinations service\n' +
          'Context: Response: {"code":"UNAUTHORIZED","message":"A valid API key is required."}'
      );
    }) as any;

    try {
      await expect(provider.createChatCompletion(
        [{ role: 'user', content: 'Build arcade snake' }],
        'qwen3.8-27b',
      )).rejects.toThrow('Pollinations authentication failed');
      expect(calls).toEqual(['qwen3.8-27b']);
    } finally {
      pollinationsClientModule.pollinationsClient.chatCompletion = originalClientMethod;
    }
  });

  it('tries the public Pollinations pool after retryable authenticated model failures', async () => {
    const pollinationsClientModule = await import('../../pollinations/client.js');
    const originalClientMethod = pollinationsClientModule.pollinationsClient.chatCompletion;
    const provider = new PollinationsLLMProvider('sk_test');
    const authCalls: string[] = [];
    const fetchCalls: string[] = [];

    pollinationsClientModule.pollinationsClient.chatCompletion = (async ({ model }: any) => {
      authCalls.push(model);
      throw new Error(
        'Error: Pollinations API request failed\n' +
          'Cause: HTTP 503 error from Pollinations service\n' +
          'Context: Status: 503, Response: {"code":"SERVICE_UNAVAILABLE","message":"service overloaded"}'
      );
    }) as any;

    jest.spyOn(globalThis, 'fetch').mockImplementation((async (url: string | URL | Request) => {
      fetchCalls.push(String(url));
      return new Response('public ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    }) as typeof fetch);

    try {
      const result = await provider.createChatCompletion(
        [{ role: 'user', content: 'Build arcade snake' }],
        'deepseek-pro'
      );

      expect(result).toBe('public ok');
      expect(authCalls).toContain('deepseek-pro');
      expect(authCalls).toContain('openai-fast');
      expect(fetchCalls).toEqual(['https://text.pollinations.ai/']);
    } finally {
      pollinationsClientModule.pollinationsClient.chatCompletion = originalClientMethod;
    }
  });

  it('falls back to public Pollinations text when authenticated Pollinations is unauthorized', async () => {
    const pollinationsClientModule = await import('../../pollinations/client.js');
    const originalClientMethod = pollinationsClientModule.pollinationsClient.chatCompletion;
    const provider = new PollinationsLLMProvider('sk_test');
    const fetchCalls: string[] = [];

    pollinationsClientModule.pollinationsClient.chatCompletion = (async () => {
      throw new Error(
        'Error: Pollinations API request failed\n' +
          'Cause: HTTP 401 error from Pollinations service\n' +
          'Context: Status: 401, Response: {"code":"UNAUTHORIZED"}'
      );
    }) as any;

    jest.spyOn(globalThis, 'fetch').mockImplementation((async (url: string | URL | Request) => {
      fetchCalls.push(String(url));
      return new Response('public ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    }) as typeof fetch);

    try {
      const result = await provider.createChatCompletion(
        [{ role: 'user', content: 'Build arcade snake' }],
        'openai-fast'
      );

      expect(result).toBe('public ok');
      expect(fetchCalls).toEqual(['https://text.pollinations.ai/']);
    } finally {
      pollinationsClientModule.pollinationsClient.chatCompletion = originalClientMethod;
    }
  });

  it('falls back to Gemini when authenticated and public Pollinations both fail', async () => {
    const pollinationsClientModule = await import('../../pollinations/client.js');
    const originalClientMethod = pollinationsClientModule.pollinationsClient.chatCompletion;
    const pollinations = new PollinationsLLMProvider('sk_test');
    const geminiCalls: string[] = [];
    const gemini = createProvider('gemini', async (model) => {
      geminiCalls.push(model);
      return 'gemini ok';
    });

    pollinationsClientModule.pollinationsClient.chatCompletion = (async () => {
      throw new Error(
        'Error: Pollinations API request failed\n' +
          'Cause: HTTP 402 error from Pollinations service\n' +
          'Context: Status: 402, Response: {"code":"PAYMENT_REQUIRED"}'
      );
    }) as any;

    jest.spyOn(globalThis, 'fetch').mockImplementation((async () => new Response(
      '<!DOCTYPE html><html><body>Bad gateway</body></html>',
      {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }
    )) as typeof fetch);

    try {
      const provider = new CompositeLLMProvider([pollinations, gemini]);
      const result = await provider.createChatCompletion(
        [{ role: 'user', content: 'Build arcade snake' }],
        'qwen-large'
      );

      expect(result).toBe('gemini ok');
      expect(geminiCalls).toEqual(['gemini-3.6-flash']);
    } finally {
      pollinationsClientModule.pollinationsClient.chatCompletion = originalClientMethod;
    }
  });

  it('uses the native Gemini SDK provider for current Gemini model requests', async () => {
    const calls: string[] = [];
    let requestConfig: any;
    const provider = new GeminiLLMProvider('<gemini-api-key>');

    (provider as any).getClient = async () => ({
      models: {
        generateContent: async ({ model, config }: any) => {
          calls.push(model);
          requestConfig = config;
          return { text: 'ok' };
        },
      },
    });

    const result = await provider.createChatCompletion(
      [{ role: 'user', content: 'Build arcade snake' }],
      'gemini-3.5-flash',
      { reasoning: { effort: 'high', summary: 'concise' } },
    );

    expect(result).toBe('ok');
    expect(calls).toEqual(['gemini-3.5-flash']);
    expect(requestConfig.thinkingConfig).toEqual({ includeThoughts: false, thinkingLevel: 'HIGH' });
  });

  it('builds NVIDIA chat completion requests with the exact model id', async () => {
    const fetchCalls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];

    jest.spyOn(globalThis, 'fetch').mockImplementation((async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
        headers: init?.headers as Record<string, string>,
      });
      return new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: 'nvidia ok',
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);

    const provider = new NvidiaLLMProvider('nvapi_test', 'https://integrate.api.nvidia.com/v1/');
    const result = await provider.createChatCompletion(
      [{ role: 'system', content: 'Be concise' }, { role: 'user', content: 'Hello' }],
      'qwen/qwen3-coder-480b-a35b-instruct',
      { temperature: 0.1, maxTokens: 123, topP: 0.9 }
    );

    expect(result).toBe('nvidia ok');
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(fetchCalls[0].headers.Authorization).toBe('Bearer nvapi_test');
    expect(fetchCalls[0].body).toMatchObject({
      model: 'qwen/qwen3-coder-480b-a35b-instruct',
      temperature: 0.1,
      max_tokens: 123,
      top_p: 0.9,
      stream: false,
    });
    expect(fetchCalls[0].body.messages).toEqual([
      { role: 'system', content: 'Be concise' },
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('sends NVIDIA reasoning_effort only for GPT-OSS-compatible chat routes', async () => {
    let requestBody: any;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'nvidia reasoning ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);

    const provider = new NvidiaLLMProvider('nvapi_test', 'https://integrate.api.nvidia.com/v1');
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Think carefully.' }],
      'gpt-oss-20b',
      { reasoning: { effort: 'high', summary: 'concise' } },
    )).resolves.toBe('nvidia reasoning ok');

    expect(requestBody.reasoning_effort).toBe('medium');
  });

  it('hands a stalled free NVIDIA model to the bounded MiniMax fallback', async () => {
    const requestModels: string[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requestModels.push(body.model);
      if (body.model === 'z-ai/glm-5.2') {
        return new Response(JSON.stringify({ status: 404, title: 'Not Found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'fallback ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);

    const provider = new NvidiaLLMProvider('nvapi_test', 'https://integrate.api.nvidia.com/v1');
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Keep going.' }],
      'z-ai/glm-5.2',
      { freeTierResilience: true, requestLimit: 2, timeoutMs: 90_000, pacingProfile: 'fast' },
    )).resolves.toBe('fallback ok');

    expect(requestModels).toEqual(['z-ai/glm-5.2', 'minimaxai/minimax-m3']);
  });

  it('does not switch a pinned NVIDIA model to the MiniMax fallback', async () => {
    const requestModels: string[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requestModels.push(body.model);
      return new Response(JSON.stringify({ status: 404, title: 'Not Found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);

    const provider = new NvidiaLLMProvider('nvapi_test', 'https://integrate.api.nvidia.com/v1');
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Keep going.' }],
      'z-ai/glm-5.2',
      {
        pinModel: true,
        freeTierResilience: true,
        requestLimit: 2,
        timeoutMs: 60_000,
        pacingProfile: 'fast',
      },
    )).rejects.toThrow(/NVIDIA model rotation failed|model route unavailable/);

    expect(requestModels).toEqual(['z-ai/glm-5.2']);
  });

  it('classifies NVIDIA 503 request-limit responses as quota pressure', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      message: 'ResourceExhausted: Worker local total request limit reached (268/32)',
    }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }));

    const provider = new NvidiaLLMProvider('nvapi_test', 'https://integrate.api.nvidia.com/v1');
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Keep going.' }],
      'poolside/laguna-xs-2.1',
      { pinModel: true, requestLimit: 3, timeoutMs: 90_000, pacingProfile: 'fast' },
    )).rejects.toThrow(/HTTP 503 \(throttled\).*check NVIDIA account quota/s);
  });

  it('allows the agent to recover a pinned NVIDIA model through the bounded NVIDIA fallback', async () => {
    const requestModels: string[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requestModels.push(body.model);
      if (body.model === 'z-ai/glm-5.2') {
        return new Response(JSON.stringify({ status: 404, title: 'Not Found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'agent fallback ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);

    const provider = new NvidiaLLMProvider('nvapi_test', 'https://integrate.api.nvidia.com/v1');
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Keep going.' }],
      'z-ai/glm-5.2',
      {
        pinModel: true,
        allowNvidiaModelFallback: true,
        freeTierResilience: true,
        requestLimit: 2,
        nvidiaApiKeyIndex: 0,
        timeoutMs: 90_000,
        pacingProfile: 'fast',
      },
    )).resolves.toBe('agent fallback ok');

    expect(requestModels).toEqual(['z-ai/glm-5.2', 'minimaxai/minimax-m3']);
  });

  it('serializes the same NVIDIA API key across provider instances', async () => {
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    let active = 0;
    let maxActive = 0;

    jest.spyOn(globalThis, 'fetch').mockImplementation((async () => {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      if (calls === 1) {
        markFirstStarted();
        await firstBlocked;
      }
      active--;
      return new Response(JSON.stringify({ choices: [{ message: { content: `ok ${calls}` } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);

    const firstProvider = new NvidiaLLMProvider('nvapi_shared');
    const secondProvider = new NvidiaLLMProvider('nvapi_shared');
    const first = firstProvider.createChatCompletion(
      [{ role: 'user', content: 'first' }],
      'z-ai/glm-5.2',
      { timeoutMs: 60_000, pacingProfile: 'fast' },
    );
    await firstStarted;
    const second = secondProvider.createChatCompletion(
      [{ role: 'user', content: 'second' }],
      'z-ai/glm-5.2',
      { timeoutMs: 60_000, pacingProfile: 'fast' },
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toBe(1);
    expect(maxActive).toBe(1);

    releaseFirst();
    await expect(first).resolves.toMatch(/^ok /);
    await expect(second).resolves.toMatch(/^ok /);
    expect(calls).toBe(2);
    expect(maxActive).toBe(1);
  });

  it('enforces the NVIDIA concurrency cap per model across independent API keys', async () => {
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const starts: string[] = [];

    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string>).Authorization;
      starts.push(authorization);
      if (authorization === 'Bearer nvapi_model_cap_a') {
        markFirstStarted();
        await firstBlocked;
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: authorization } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);

    const first = new NvidiaLLMProvider('nvapi_model_cap_a').createChatCompletion(
      [{ role: 'user', content: 'first' }],
      'z-ai/glm-5.2',
      { timeoutMs: 60_000, pacingProfile: 'fast' },
    );
    await firstStarted;
    const second = new NvidiaLLMProvider('nvapi_model_cap_b').createChatCompletion(
      [{ role: 'user', content: 'second' }],
      'z-ai/glm-5.2',
      { timeoutMs: 60_000, pacingProfile: 'fast' },
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(starts).toEqual(['Bearer nvapi_model_cap_a']);
    releaseFirst();
    await expect(first).resolves.toContain('nvapi_model_cap_a');
    await expect(second).resolves.toContain('nvapi_model_cap_b');
    expect(starts).toEqual(['Bearer nvapi_model_cap_a', 'Bearer nvapi_model_cap_b']);
  });

  it('dispatches higher-priority NVIDIA work before earlier low-priority work', async () => {
    let releaseBlocker!: () => void;
    let markBlockerStarted!: () => void;
    const blockerStarted = new Promise<void>((resolve) => {
      markBlockerStarted = resolve;
    });
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const starts: string[] = [];

    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string>).Authorization;
      starts.push(authorization);
      if (authorization === 'Bearer nvapi_priority_blocker') {
        markBlockerStarted();
        await blocker;
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: authorization } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);

    const active = new NvidiaLLMProvider('nvapi_priority_blocker').createChatCompletion(
      [{ role: 'user', content: 'active' }],
      'z-ai/glm-5.2',
      { timeoutMs: 60_000, pacingProfile: 'fast' },
    );
    await blockerStarted;
    const low = new NvidiaLLMProvider('nvapi_priority_low').createChatCompletion(
      [{ role: 'user', content: 'low' }],
      'z-ai/glm-5.2',
      { timeoutMs: 60_000, pacingProfile: 'fast', queuePriority: 10 },
    );
    const high = new NvidiaLLMProvider('nvapi_priority_high').createChatCompletion(
      [{ role: 'user', content: 'high' }],
      'z-ai/glm-5.2',
      { timeoutMs: 60_000, pacingProfile: 'fast', queuePriority: 90 },
    );

    releaseBlocker();
    await Promise.all([active, low, high]);
    expect(starts).toEqual([
      'Bearer nvapi_priority_blocker',
      'Bearer nvapi_priority_high',
      'Bearer nvapi_priority_low',
    ]);
  });

  it('spaces consecutive NVIDIA requests to the same key', async () => {
    jest.useFakeTimers({ now: 10_000 });
    process.env.REACT_ENGINE_NVIDIA_MIN_REQUEST_INTERVAL_MS = '50';
    try {
      const starts: number[] = [];
      jest.spyOn(globalThis, 'fetch').mockImplementation((async () => {
        starts.push(Date.now());
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch);
      const provider = new NvidiaLLMProvider('nvapi_spaced');

      await provider.createChatCompletion(
        [{ role: 'user', content: 'first' }],
        'z-ai/glm-5.2',
        { timeoutMs: 60_000 },
      );
      const second = provider.createChatCompletion(
        [{ role: 'user', content: 'second' }],
        'z-ai/glm-5.2',
        { timeoutMs: 60_000 },
      );
      await jest.advanceTimersByTimeAsync(49);
      expect(starts).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(1);

      await expect(second).resolves.toBe('ok');
      expect(starts).toEqual([10_000, 10_050]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('shares NVIDIA Retry-After cooldowns across provider instances', async () => {
    jest.useFakeTimers({ now: 20_000 });
    process.env.REACT_ENGINE_NVIDIA_MIN_REQUEST_INTERVAL_MS = '0';
    try {
      const starts: number[] = [];
      jest.spyOn(globalThis, 'fetch').mockImplementation((async () => {
        starts.push(Date.now());
        if (starts.length === 1) {
          return new Response('rate limited', { status: 429, headers: { 'retry-after': '0.05' } });
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: 'recovered' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch);

      await expect(new NvidiaLLMProvider('nvapi_cooldown', undefined, ' , ').createChatCompletion(
        [{ role: 'user', content: 'first' }],
        'z-ai/glm-5.2',
        { timeoutMs: 60_000 },
      )).rejects.toThrow(/HTTP 429/);

      const retry = new NvidiaLLMProvider('nvapi_cooldown', undefined, ' , ').createChatCompletion(
        [{ role: 'user', content: 'retry' }],
        'z-ai/glm-5.2',
        { timeoutMs: 60_000 },
      );
      await jest.advanceTimersByTimeAsync(49);
      expect(starts).toEqual([20_000]);
      await jest.advanceTimersByTimeAsync(1);

      await expect(retry).resolves.toBe('recovered');
      expect(starts).toEqual([20_000, 20_050]);
    } finally {
      resetNvidiaRequestScheduler();
      delete process.env.REACT_ENGINE_NVIDIA_MIN_REQUEST_INTERVAL_MS;
      jest.useRealTimers();
    }
  });

  it('honors the complete NVIDIA Retry-After value instead of truncating it', async () => {
    jest.useFakeTimers({ now: 30_000 });
    const previousMaxAttempts = process.env.REACT_ENGINE_NVIDIA_MAX_ATTEMPTS;
    process.env.REACT_ENGINE_NVIDIA_MAX_ATTEMPTS = '1';
    try {
      const starts: number[] = [];
      jest.spyOn(globalThis, 'fetch').mockImplementation((async () => {
        starts.push(Date.now());
        if (starts.length === 1) {
          return new Response('rate limited', { status: 429, headers: { 'retry-after': '60' } });
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: 'recovered' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch);

      await expect(new NvidiaLLMProvider('nvapi_full_retry_after', undefined, ' , ').createChatCompletion(
        [{ role: 'user', content: 'first' }],
        'z-ai/glm-5.2',
        { timeoutMs: 90_000 },
      )).rejects.toThrow(/Retry after: 60000ms/);

      const retry = new NvidiaLLMProvider('nvapi_full_retry_after', undefined, ' , ').createChatCompletion(
        [{ role: 'user', content: 'retry' }],
        'z-ai/glm-5.2',
        { timeoutMs: 90_000 },
      );
      await jest.advanceTimersByTimeAsync(59_999);
      expect(starts).toEqual([30_000]);
      await jest.advanceTimersByTimeAsync(1);
      await expect(retry).resolves.toBe('recovered');
      expect(starts).toEqual([30_000, 90_000]);
    } finally {
      resetNvidiaRequestScheduler();
      if (previousMaxAttempts === undefined) delete process.env.REACT_ENGINE_NVIDIA_MAX_ATTEMPTS;
      else process.env.REACT_ENGINE_NVIDIA_MAX_ATTEMPTS = previousMaxAttempts;
      jest.useRealTimers();
    }
  });

  it('uses exponential full jitter before rotating after a NVIDIA 429 without Retry-After', async () => {
    jest.useFakeTimers({ now: 40_000 });
    const previousBase = process.env.REACT_ENGINE_NVIDIA_RETRY_BASE_MS;
    const previousMax = process.env.REACT_ENGINE_NVIDIA_RETRY_MAX_MS;
    process.env.REACT_ENGINE_NVIDIA_RETRY_BASE_MS = '100';
    process.env.REACT_ENGINE_NVIDIA_RETRY_MAX_MS = '1000';
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const starts: number[] = [];
      jest.spyOn(globalThis, 'fetch').mockImplementation((async () => {
        starts.push(Date.now());
        if (starts.length === 1) return new Response('rate limited', { status: 429 });
        return new Response(JSON.stringify({ choices: [{ message: { content: 'rotated' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch);

      const completion = new NvidiaLLMProvider(
        'nvapi_jitter_primary',
        undefined,
        'nvapi_jitter_worker',
      ).createChatCompletion(
        [{ role: 'user', content: 'retry' }],
        'z-ai/glm-5.2',
        { timeoutMs: 60_000 },
      );
      await jest.advanceTimersByTimeAsync(0);
      expect(starts).toEqual([40_000]);
      await jest.advanceTimersByTimeAsync(49);
      expect(starts).toEqual([40_000]);
      await jest.advanceTimersByTimeAsync(1);
      await expect(completion).resolves.toBe('rotated');
      expect(starts).toEqual([40_000, 40_050]);
    } finally {
      resetNvidiaRequestScheduler();
      if (previousBase === undefined) delete process.env.REACT_ENGINE_NVIDIA_RETRY_BASE_MS;
      else process.env.REACT_ENGINE_NVIDIA_RETRY_BASE_MS = previousBase;
      if (previousMax === undefined) delete process.env.REACT_ENGINE_NVIDIA_RETRY_MAX_MS;
      else process.env.REACT_ENGINE_NVIDIA_RETRY_MAX_MS = previousMax;
      jest.useRealTimers();
    }
  });

  it('stops NVIDIA retries when the routed task request budget is exhausted', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation((async () => new Response(
      'bad request',
      { status: 400 },
    )) as typeof fetch);
    const provider = new NvidiaLLMProvider(
      'nvapi_budget_primary',
      undefined,
      'nvapi_budget_worker',
    );

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'bounded' }],
      'z-ai/glm-5.2',
      { timeoutMs: 60_000, requestLimit: 1 },
    )).rejects.toThrow(/bounded NVIDIA attempt plan did not succeed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves NVIDIA native tool-call responses as a planner-compatible envelope', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation((async () => new Response(JSON.stringify({
      choices: [{
        message: {
          role: 'assistant',
          tool_calls: [{
            id: 'call_read',
            type: 'function',
            function: { name: 'Read', arguments: '{"file_path":"package.json"}' },
          }],
        },
      }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch);

    const provider = new NvidiaLLMProvider('nvapi_test', 'https://integrate.api.nvidia.com/v1');
    const result = await provider.createChatCompletion(
      [{ role: 'user', content: 'Read package.json' }],
      'qwen/qwen3-coder-480b-a35b-instruct'
    );

    expect(JSON.parse(result)).toMatchObject({
      role: 'assistant',
      tool_calls: [{ function: { name: 'Read', arguments: '{"file_path":"package.json"}' } }],
    });
  });

  it('classifies a pending NVIDIA DeepSeek response as transient instead of parsing it as a successful chat response', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation((async () => new Response(JSON.stringify({
      requestId: 'pending-request',
      status: 'pending',
    }), {
      status: 202,
      headers: { 'content-type': 'application/json', 'retry-after': '1' },
    })) as typeof fetch);

    const provider = new NvidiaLLMProvider('nvapi_test', 'https://integrate.api.nvidia.com/v1');

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Use the DeepSeek route safely.' }],
      'deepseek-ai/deepseek-v4-flash',
      { timeoutMs: 60_000, requestLimit: 1 },
    )).rejects.toThrow(/HTTP 202 \(transient\)/);
  });

  it('turns malformed NVIDIA free-endpoint JSON into a recoverable provider error', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation((async () => new Response('{not-json', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch);

    const provider = new NvidiaLLMProvider('nvapi_test', 'https://integrate.api.nvidia.com/v1');

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Return a concise answer.' }],
      'deepseek-ai/deepseek-v4-flash',
      { timeoutMs: 60_000, requestLimit: 1 },
    )).rejects.toThrow(/malformed JSON/);
  });

  it('sends function schemas and requires a tool call for NVIDIA tool-capable models', async () => {
    let requestBody: any;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);

    const provider = new NvidiaLLMProvider('nvapi_test', 'https://integrate.api.nvidia.com/v1');
    await provider.createChatCompletion(
      [{ role: 'user', content: 'Read package.json' }],
      'qwen/qwen3-coder-480b-a35b-instruct',
      {
        tools: [{
          type: 'function',
          function: {
            name: 'Read',
            description: 'Read a file',
            parameters: { type: 'object', properties: { file_path: { type: 'string' } } },
          },
        }],
        toolChoice: 'required',
      }
    );

    expect(requestBody.tools).toEqual([{ type: 'function', function: expect.objectContaining({ name: 'Read' }) }]);
    expect(requestBody.tool_choice).toBe('required');
  });

  it('rotates NVIDIA API keys when retrying NVIDIA chat models', async () => {
    const authHeaders: string[] = [];

    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      authHeaders.push(headers.Authorization);

      if (authHeaders.length === 1) {
        return new Response('rate limited', { status: 429 });
      }

      return new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: 'rotated ok',
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);

    const provider = new NvidiaLLMProvider('nvapi_primary', 'https://integrate.api.nvidia.com/v1', 'nvapi_worker');
    const result = await provider.createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'minimaxai/minimax-m3'
    );

    expect(result).toBe('rotated ok');
    expect(authHeaders).toEqual(['Bearer nvapi_primary', 'Bearer nvapi_worker']);
  });

  it('resolves saved NVIDIA model targets to model ids and preferred API keys', async () => {
    const authHeaders: string[] = [];
    const requestModels: string[] = [];
    const requestBodies: any[] = [];
    const now = Date.now();
    const originalTargets = getSavedNvidiaModelTargets();

    try {
      saveNvidiaModelTargets([
        {
          id: 'glm-workhorse',
          title: 'GLM Workhorse',
          modelId: 'z-ai/glm-5.2',
          apiKeyIndex: 1,
          apiFamily: 'chat-completions',
          endpoint: '/chat/completions',
          maxTokens: 2048,
          temperature: 0.1,
          topP: 0.9,
          stream: true,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        const body = JSON.parse(String(init?.body));
        authHeaders.push(headers.Authorization);
        requestModels.push(body.model);
        requestBodies.push(body);

        return new Response(JSON.stringify({
          choices: [
            {
              message: {
                content: 'target ok',
              },
            },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch);

      const provider = new NvidiaLLMProvider('nvapi_primary', 'https://integrate.api.nvidia.com/v1', 'nvapi_worker');
      const result = await provider.createChatCompletion(
        [{ role: 'user', content: 'Hello' }],
        'nvidia-target:glm-workhorse'
      );

      expect(result).toBe('target ok');
      expect(requestModels).toEqual(['z-ai/glm-5.2']);
      expect(authHeaders).toEqual(['Bearer nvapi_worker']);
      expect(requestBodies[0]).toMatchObject({
        temperature: 0.1,
        max_tokens: 2048,
        top_p: 0.9,
        stream: true,
      });
    } finally {
      saveNvidiaModelTargets(originalTargets);
    }
  });

  it('does not rotate away from the API key pinned by a NVIDIA model target', async () => {
    const authHeaders: string[] = [];
    const now = Date.now();
    const originalTargets = getSavedNvidiaModelTargets();

    try {
      saveNvidiaModelTargets([{
        id: 'pinned-worker',
        title: 'Pinned Worker',
        modelId: 'z-ai/glm-5.2',
        apiKeyIndex: 1,
        apiFamily: 'chat-completions',
        endpoint: '/chat/completions',
        createdAt: now,
        updatedAt: now,
      }]);
      jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
        authHeaders.push((init?.headers as Record<string, string>).Authorization);
        return new Response('rate limited', { status: 429 });
      }) as typeof fetch);

      const provider = new NvidiaLLMProvider('nvapi_primary', 'https://integrate.api.nvidia.com/v1', 'nvapi_worker');
      await expect(provider.createChatCompletion(
        [{ role: 'user', content: 'Hello' }],
        'nvidia-target:pinned-worker'
      )).rejects.toThrow(/HTTP 429/);

      expect(authHeaders).toEqual(['Bearer nvapi_worker']);
    } finally {
      saveNvidiaModelTargets(originalTargets);
    }
  });

  it('does not send NVIDIA non-chat models to chat completion requests', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation((async () => {
      throw new Error('fetch should not be called');
    }) as typeof fetch);
    const provider = new NvidiaLLMProvider('nvapi_test');

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Embed this' }],
      'baai/bge-m3'
    )).rejects.toThrow(/uses apiFamily embeddings/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  (process.env.NVIDIA_API_KEY ? it : it.skip)('smoke-tests NVIDIA chat completions when NVIDIA_API_KEY is configured', async () => {
    const provider = new NvidiaLLMProvider(process.env.NVIDIA_API_KEY, process.env.NVIDIA_BASE_URL);

    const result = await provider.createChatCompletion(
      [{ role: 'user', content: 'Reply with exactly: nvidia smoke ok' }],
      'nvidia/nemotron-3-super-120b-a12b',
      { temperature: 0, maxTokens: 16 }
    );

    expect(result.toLowerCase()).toContain('nvidia');
  }, 30000);

  it('never rotates across injected Gemini credentials after a transient error', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const previousMaxAttempts = process.env.REACT_ENGINE_GEMINI_MAX_ATTEMPTS;
    process.env.REACT_ENGINE_GEMINI_MAX_ATTEMPTS = '1';

    const pool = new ApiKeyPool({
      keys: ['key1', 'key2', 'key3'],
      primaryKey: 'key1',
      rotationStrategy: 'primary-first',
    });
    const provider = new GeminiLLMProvider(undefined, pool);
    const calls: Array<{ key: string; model: string }> = [];

    (provider as any).getClient = async (apiKey: string) => ({
      models: {
        generateContent: async ({ model }: any) => {
          calls.push({ key: apiKey, model });
          if (apiKey !== 'key3') {
            throw new Error('503 UNAVAILABLE');
          }
          return { text: 'ok' };
        },
      },
    });

    try {
      await expect(provider.createChatCompletion(
        [{ role: 'user', content: 'Build arcade snake' }],
        'gemini-3.5-flash',
      )).rejects.toThrow(/profile legacy-1 request failed/i);
      expect(calls.map((call) => call.key)).toEqual(['key1']);
    } finally {
      if (previousMaxAttempts === undefined) delete process.env.REACT_ENGINE_GEMINI_MAX_ATTEMPTS;
      else process.env.REACT_ENGINE_GEMINI_MAX_ATTEMPTS = previousMaxAttempts;
    }
  });

  it('OM5VFE bounds a 90-second Gemini plan and never emits a sub-10-second SDK deadline', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const previousMaxAttempts = process.env.REACT_ENGINE_GEMINI_MAX_ATTEMPTS;
    process.env.REACT_ENGINE_GEMINI_MAX_ATTEMPTS = '1';
    const pool = new ApiKeyPool({
      keys: ['key1', 'key2', 'key3'],
      primaryKey: 'key1',
      rotationStrategy: 'primary-first',
    });
    const provider = new GeminiLLMProvider(undefined, pool);
    const calls: Array<{ model: string; timeout?: number }> = [];

    (provider as any).getClient = async () => ({
      models: {
        generateContent: async ({ model, config }: any) => {
          calls.push({ model, timeout: config.httpOptions?.timeout });
          throw new Error('503 SERVICE_UNAVAILABLE');
        },
      },
    });

    try {
      await expect(provider.createChatCompletion(
        [{ role: 'user', content: 'Recover this request' }],
        'gemini-3.5-flash',
        { timeoutMs: 90_000 },
      )).rejects.toThrow(/Gemini profile legacy-1 request failed/);

      expect(calls).toHaveLength(1);
      expect(calls.every((call) => (call.timeout || 0) >= 10_000)).toBe(true);
    } finally {
      if (previousMaxAttempts === undefined) delete process.env.REACT_ENGINE_GEMINI_MAX_ATTEMPTS;
      else process.env.REACT_ENGINE_GEMINI_MAX_ATTEMPTS = previousMaxAttempts;
    }
  });

  it('stops Gemini key and model rotation on INVALID_ARGUMENT', async () => {
    const pool = new ApiKeyPool({ keys: ['key1', 'key2', 'key3'], primaryKey: 'key1' });
    const provider = new GeminiLLMProvider(undefined, pool);
    const calls: any[] = [];
    (provider as any).getClient = async () => ({
      models: {
        generateContent: async (request: any) => {
          calls.push(request);
          throw new Error('400 INVALID_ARGUMENT: invalid request deadline');
        },
      },
    });

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'gemini-3.5-flash',
      { timeoutMs: 90_000 },
    )).rejects.toThrow(/INVALID_ARGUMENT/);

    expect(calls).toHaveLength(1);
  });

  it('cools down a throttled NVIDIA key and redacts provider secrets', async () => {
    const authHeaders: string[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string>).Authorization;
      authHeaders.push(authorization);
      if (authorization === 'Bearer nvapi_primary_secret') {
        return new Response('{"api_key":"nvapi_primary_secret","error":"quota"}', {
          status: 429,
          headers: { 'retry-after': '60', 'x-request-id': 'req-om5vfe' },
        });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'worker ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);

    const provider = new NvidiaLLMProvider(
      'nvapi_primary_secret',
      'https://integrate.api.nvidia.com/v1',
      'nvapi_worker_secret',
    );
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'z-ai/glm-5.2',
      { timeoutMs: 90_000 },
    )).resolves.toBe('worker ok');
    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Hello again' }],
      'z-ai/glm-5.2',
      { timeoutMs: 90_000 },
    )).resolves.toBe('worker ok');

    expect(authHeaders).toEqual([
      'Bearer nvapi_primary_secret',
      'Bearer nvapi_worker_secret',
      'Bearer nvapi_worker_secret',
    ]);
  });

  it('falls through to Gemini after the primary NVIDIA route throttles', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation((async () => new Response(
      'rate limited',
      { status: 429 },
    )) as typeof fetch);
    const nvidia = new NvidiaLLMProvider('nvapi_primary', undefined, 'nvapi_worker');
    const gemini = createProvider('gemini', async () => 'gemini recovered');
    const provider = new CompositeLLMProvider([nvidia, gemini]);

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Recover' }],
      'z-ai/glm-5.2',
      { timeoutMs: 90_000 },
    )).resolves.toBe('gemini recovered');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('redacts NVIDIA keys from terminal errors after throttling', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation((async () => new Response(
      '{"token":"nvapi_do_not_expose","error":"quota"}',
      { status: 429, headers: { 'retry-after': '60' } },
    )) as typeof fetch);
    const provider = new NvidiaLLMProvider('nvapi_do_not_expose');

    await expect(provider.createChatCompletion(
      [{ role: 'user', content: 'Hello' }],
      'z-ai/glm-5.2',
      { timeoutMs: 90_000 },
    )).rejects.not.toThrow(/nvapi_do_not_expose/);
  });

  it('keeps provider fallback inside one end-to-end deadline and reserves a final attempt', async () => {
    jest.useFakeTimers();
    try {
      const calls: Array<{ provider: string; at: number; timeout?: number }> = [];
      const pendingProvider = (name: string): LLMProvider => ({
        createChatCompletion: async (_messages, _model, options) => {
          calls.push({ provider: name, at: Date.now(), timeout: options?.timeoutMs });
          return await new Promise<string>(() => {});
        },
        estimateStepCost: () => 0,
        getProviderName: () => name,
        isAvailable: () => true,
      });
      const gemini: LLMProvider = {
        createChatCompletion: async (_messages, _model, options) => {
          calls.push({ provider: 'gemini', at: Date.now(), timeout: options?.timeoutMs });
          return 'recovered';
        },
        estimateStepCost: () => 0,
        getProviderName: () => 'gemini',
        isAvailable: () => true,
      };
      const provider = new CompositeLLMProvider([
        pendingProvider('nvidia'),
        pendingProvider('pollinations'),
        gemini,
      ]);

      const completion = provider.createChatCompletion(
        [{ role: 'user', content: 'OM5VFE' }],
        'z-ai/glm-5.2',
        { timeoutMs: 90_000 },
      );
      await jest.advanceTimersByTimeAsync(30_001);
      await jest.advanceTimersByTimeAsync(30_001);

      await expect(completion).resolves.toBe('recovered');
      expect(calls.map((call) => call.provider)).toEqual(['nvidia', 'gemini']);
      expect(calls[0].timeout).toBeGreaterThanOrEqual(29_000);
      expect(calls[0].timeout).toBeLessThanOrEqual(31_000);
      expect(calls[1].timeout).toBeGreaterThanOrEqual(10_000);
      expect(calls[1].at - calls[0].at).toBeLessThan(90_000);
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancels NVIDIA Retry-After backoff without launching another request or leaving timers', async () => {
    jest.useFakeTimers();
    try {
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation((async () => new Response(
        'rate limited',
        { status: 429, headers: { 'retry-after': '1' } },
      )) as typeof fetch);
      const controller = new AbortController();
      const provider = new NvidiaLLMProvider('nvapi_primary', undefined, 'nvapi_worker');
      const completion = provider.createChatCompletion(
        [{ role: 'user', content: 'Hello' }],
        'z-ai/glm-5.2',
        { timeoutMs: 90_000, signal: controller.signal },
      );
      await jest.advanceTimersByTimeAsync(0);
      controller.abort(new Error('caller cancelled'));

      await expect(completion).rejects.toThrow('caller cancelled');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('replays the OM5VFE provider signature without a 5-second Gemini deadline or budget overrun', async () => {
    jest.useFakeTimers();
    const observedIncident = {
      nvidiaAttemptMs: 11_250,
      pollinationsProviderMs: 90_000,
      invalidGeminiDeadlineMs: 5_000,
    };
    const originalFloor = process.env.REACT_ENGINE_NVIDIA_MIN_ATTEMPT_MS;
    const pollinationsClientModule = await import('../../pollinations/client.js');
    const originalChatCompletion = pollinationsClientModule.pollinationsClient.chatCompletion;
    try {
      process.env.REACT_ENGINE_NVIDIA_MIN_ATTEMPT_MS = '15000';
      const nvidiaCalls: string[] = [];
      jest.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string | URL | Request, init?: RequestInit) => {
        nvidiaCalls.push((init?.headers as Record<string, string>).Authorization);
        return new Response('rate limited', { status: 429 });
      }) as typeof fetch);
      pollinationsClientModule.pollinationsClient.chatCompletion = (async () => {
        return await new Promise<any>(() => {});
      }) as any;

      const geminiTimeouts: number[] = [];
      const gemini = new GeminiLLMProvider('gemini-key');
      (gemini as any).getClient = async () => ({
        models: {
          generateContent: async ({ config }: any) => {
            geminiTimeouts.push(config.httpOptions?.timeout);
            return { text: 'OM5VFE recovered' };
          },
        },
      });
      const provider = new CompositeLLMProvider([
        new NvidiaLLMProvider('nvapi_primary', undefined, 'nvapi_worker'),
        new PollinationsLLMProvider('pollinations-key'),
        gemini,
      ]);
      const startedAt = Date.now();
      const telemetry: Array<{ provider: string; allocatedBudgetMs?: number }> = [];
      const completion = provider.createChatCompletion(
        [{ role: 'user', content: 'ReAct step 15' }],
        'z-ai/glm-5.2',
        { timeoutMs: 90_000, onTelemetry: (entry) => telemetry.push(entry) },
      );
      await jest.advanceTimersByTimeAsync(45_001);

      await expect(completion).resolves.toBe('OM5VFE recovered');
      expect(nvidiaCalls.length).toBeLessThanOrEqual(2);
      expect(geminiTimeouts).toHaveLength(1);
      expect(geminiTimeouts[0]).toBeGreaterThanOrEqual(10_000);
      expect(geminiTimeouts).not.toContain(observedIncident.invalidGeminiDeadlineMs);
      expect(telemetry.filter((entry) => entry.provider === 'nvidia').map((entry) => entry.allocatedBudgetMs))
        .not.toContain(observedIncident.nvidiaAttemptMs);
      expect(telemetry.find((entry) => entry.provider === 'pollinations')).toBeUndefined();
      expect(Date.now() - startedAt).toBeLessThan(90_000);
    } finally {
      pollinationsClientModule.pollinationsClient.chatCompletion = originalChatCompletion;
      if (originalFloor === undefined) delete process.env.REACT_ENGINE_NVIDIA_MIN_ATTEMPT_MS;
      else process.env.REACT_ENGINE_NVIDIA_MIN_ATTEMPT_MS = originalFloor;
      jest.useRealTimers();
    }
  });

  // Fix G regression: a free-tier provider whose only key returns 429 on every attempt
  // must throw with the 'NVIDIA routes are throttled' cause string so that
  // isNvidiaThrottleError (engine.ts) detects it and triggers the engine-level retry loop.
  it('throws "NVIDIA routes are throttled" when a free-tier single key is 429 on every attempt', async () => {
    jest.useFakeTimers({ now: 0 });
    const prevMaxAttempts = process.env.REACT_ENGINE_NVIDIA_MAX_ATTEMPTS;
    const prevMinAttempt = process.env.REACT_ENGINE_NVIDIA_MIN_ATTEMPT_MS;
    const prevFreeTimeout = process.env.REACT_ENGINE_NVIDIA_FREE_ATTEMPT_TIMEOUT_MS;
    process.env.REACT_ENGINE_NVIDIA_MAX_ATTEMPTS = '1';
    process.env.REACT_ENGINE_NVIDIA_MIN_ATTEMPT_MS = '100';
    process.env.REACT_ENGINE_NVIDIA_FREE_ATTEMPT_TIMEOUT_MS = '200';
    try {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{"title":"Too Many Requests"}', {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
      );

      // pinModel: true prevents free-tier model fallback so the provider exhausts
      // maxAttempts on a single throttled key and throws via anyKeyThrottledOnFreeTier.
      const provider = new NvidiaLLMProvider('nvapi_fixg_only', 'https://integrate.api.nvidia.com/v1');
      // Start the assertion before advancing time so the rejection is handled.
      const assertion = expect(
        provider.createChatCompletion(
          [{ role: 'user', content: 'test' }],
          'meta/llama-3.1-8b-instruct',
          { pacingProfile: 'conservative', pinModel: true, timeoutMs: 5_000 },
        ),
      ).rejects.toThrow(/NVIDIA routes are throttled/);
      // Advance fake clock so the 429 cooldown and budget timer fire.
      await jest.advanceTimersByTimeAsync(5_000);
      await assertion;
    } finally {
      resetNvidiaRequestScheduler();
      if (prevMaxAttempts === undefined) delete process.env.REACT_ENGINE_NVIDIA_MAX_ATTEMPTS;
      else process.env.REACT_ENGINE_NVIDIA_MAX_ATTEMPTS = prevMaxAttempts;
      if (prevMinAttempt === undefined) delete process.env.REACT_ENGINE_NVIDIA_MIN_ATTEMPT_MS;
      else process.env.REACT_ENGINE_NVIDIA_MIN_ATTEMPT_MS = prevMinAttempt;
      if (prevFreeTimeout === undefined) delete process.env.REACT_ENGINE_NVIDIA_FREE_ATTEMPT_TIMEOUT_MS;
      else process.env.REACT_ENGINE_NVIDIA_FREE_ATTEMPT_TIMEOUT_MS = prevFreeTimeout;
      jest.useRealTimers();
    }
  });
});
