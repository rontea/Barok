import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { GroqLLMProvider, parseRateLimitSnapshot } from '../groqProvider.js';
import { NormalizedProviderError } from '../providerErrors.js';
import { resetGroqScheduler } from '../providerScheduler.js';
import { resetProviderRequestReliability } from '../requestReliability.js';

type MockHandler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, body: string) => void;

describe('Groq provider against a local compatible mock server', () => {
  let server: Server;
  let baseUrl = '';
  let handler: MockHandler;

  beforeEach(async () => {
    await resetGroqScheduler();
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'request-default', model: 'configured-model', choices: [{ finish_reason: 'stop', message: { content: 'OK' } }] }));
    };
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => handler(req, res, body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/openai/v1`;
  });

  afterEach(async () => {
    resetProviderRequestReliability();
    await resetGroqScheduler();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function provider(overrides: Record<string, unknown> = {}) {
    return new GroqLLMProvider('gsk_mock_key', {
      enabled: true,
      defaultModel: 'configured-model',
      baseUrl,
      maxRetries: 0,
      maxConcurrency: 1,
      maxPendingRequests: 25,
      maxRequestsPerTask: 10,
      capabilities: {
        'configured-model': {
          streaming: true,
          toolCalling: true,
          structuredOutput: true,
          jsonMode: true,
          vision: false,
          contextTokenLimit: 8192,
          outputTokenLimit: 2048,
        },
      },
      ...overrides,
    });
  }

  it('normalizes non-streaming text, finish reason, usage, model, request ID, and rate limits', async () => {
    handler = (_req, res, body) => {
      expect(JSON.parse(body).model).toBe('configured-model');
      res.writeHead(200, {
        'content-type': 'application/json',
        'x-request-id': 'header-id',
        'x-ratelimit-remaining-requests': '12',
        'x-ratelimit-remaining-tokens': '3456',
      });
      res.end(JSON.stringify({
        id: 'body-id',
        model: 'configured-model',
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        choices: [{ finish_reason: 'stop', message: { content: 'NORMALIZED_OK' } }],
      }));
    };
    const result = await provider().createChatCompletionResult!(
      [{ role: 'user', content: 'hello' }],
      'configured-model',
    );
    expect(result).toMatchObject({
      text: 'NORMALIZED_OK',
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      provider: 'groq',
      model: 'configured-model',
      requestId: 'body-id',
      rateLimit: { remainingRequests: 12, remainingTokens: 3456 },
    });
  });

  it('enables native hidden reasoning for GPT-OSS routes', async () => {
    handler = (_req, res, body) => {
      const request = JSON.parse(body);
      expect(request.reasoning_effort).toBe('high');
      expect(request.reasoning_format).toBe('hidden');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'reasoned' } }] }));
    };
    const result = await provider({
      defaultModel: 'openai/gpt-oss-20b',
      capabilities: {
        'openai/gpt-oss-20b': {
          streaming: false,
          toolCalling: false,
          structuredOutput: false,
          jsonMode: false,
          vision: false,
        },
      },
    }).createChatCompletion(
      [{ role: 'user', content: 'reason about this' }],
      'openai/gpt-oss-20b',
      { reasoning: { effort: 'high', summary: 'concise' } },
    );
    expect(result).toBe('reasoned');
  });

  it('resolves a configured role model exactly and falls back only to the configured default', async () => {
    const models: string[] = [];
    handler = (_req, res, body) => {
      models.push(JSON.parse(body).model);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"choices":[{"finish_reason":"stop","message":{"content":"OK"}}]}');
    };
    const configured = provider({
      coderModel: 'configured-coder',
      capabilities: {
        'configured-model': { streaming: false, toolCalling: false, structuredOutput: false, jsonMode: false, vision: false },
        'configured-coder': { streaming: false, toolCalling: false, structuredOutput: false, jsonMode: false, vision: false },
      },
    });
    await configured.createChatCompletion(
      [{ role: 'user', content: 'code' }], 'configured-model', { role: 'coder' },
    );
    await configured.createChatCompletion(
      [{ role: 'user', content: 'summarize' }], 'configured-model', { role: 'summarizer' },
    );
    expect(models).toEqual(['configured-coder', 'configured-model']);
  });

  it('parses Retry-After seconds and HTTP dates without exposing arbitrary headers', () => {
    const seconds = parseRateLimitSnapshot(new Headers({ 'retry-after': '2', 'x-untrusted-secret': 'do-not-copy' }));
    expect(seconds).toEqual({ retryAfterMs: 2_000 });
    const retryAt = new Date(Date.now() + 5_000).toUTCString();
    const dated = parseRateLimitSnapshot(new Headers({ 'retry-after': retryAt }));
    expect(dated?.retryAfterMs).toBeGreaterThan(0);
    expect(JSON.stringify(dated)).not.toContain('do-not-copy');
    expect(parseRateLimitSnapshot(new Headers())).toBeUndefined();
  });

  it('normalizes native tool calls and preserves the string compatibility envelope', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ finish_reason: 'tool_calls', message: {
          content: null,
          tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'Read', arguments: '{"path":"README.md"}' } }],
        } }],
      }));
    };
    const result = await provider().createChatCompletion(
      [{ role: 'user', content: 'read' }],
      'configured-model',
      { tools: [{ type: 'function', function: { name: 'Read', parameters: { type: 'object' } } }] },
    );
    expect(JSON.parse(result).tool_calls[0].function.name).toBe('Read');
  });

  it('assembles streaming text, fragmented tool calls, usage, and exactly one completion', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'stream-id' });
      res.write('data: {"reasoning_summary":"Inspecting the target."}\n\n');
      res.write('data: {"reasoning_summary":"Inspecting the target. Selecting a safe edit."}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"world","tool_calls":[{"index":0,"id":"call-","function":{"name":"Re","arguments":"{\\"pa"}}]}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"1","function":{"name":"ad","arguments":"th\\":\\"README.md\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":5,"total_tokens":8}}\n\n');
      res.end('data: [DONE]\n\n');
    };
    const events: any[] = [];
    const result = await provider().createChatCompletionResult!(
      [{ role: 'user', content: 'hello' }],
      'configured-model',
      { stream: true, onStreamEvent: (event) => events.push(event) },
    );
    expect(result.text).toBe('Hello world');
    expect(result.reasoningSummary).toBe('Inspecting the target. Selecting a safe edit.');
    expect(result.toolCalls[0]).toMatchObject({ id: 'call-1', function: { name: 'Read', arguments: '{"path":"README.md"}' } });
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 5, totalTokens: 8 });
    expect(events.filter((event) => event.type === 'completed')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'reasoning_summary_delta')).toEqual([
      { type: 'reasoning_summary_delta', delta: 'Inspecting the target.', source: 'provider' },
      { type: 'reasoning_summary_delta', delta: 'Selecting a safe edit.', source: 'provider' },
    ]);
  });

  it.each([
    [401, 'AUTHENTICATION_FAILED'],
    [403, 'PERMISSION_DENIED'],
    [404, 'MODEL_NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [503, 'TEMPORARILY_UNAVAILABLE'],
  ] as const)('maps HTTP %s to %s', async (status, code) => {
    handler = (_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json', 'retry-after': '1' });
      res.end('{"error":{"message":"provider failure"}}');
    };
    await expect(provider().createChatCompletion(
      [{ role: 'user', content: 'hello' }],
      'configured-model',
    )).rejects.toMatchObject({ providerError: { code } });
  });

  it('retries a temporary 503 in the scheduler and succeeds within the bound', async () => {
    let requests = 0;
    handler = (_req, res) => {
      requests++;
      res.writeHead(requests === 1 ? 503 : 200, { 'content-type': 'application/json' });
      res.end(requests === 1
        ? '{"error":{"message":"temporary"}}'
        : '{"choices":[{"finish_reason":"stop","message":{"content":"RECOVERED"}}]}');
    };
    await expect(provider({
      maxRetries: 1,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 1,
    }).createChatCompletion(
      [{ role: 'user', content: 'hello' }], 'configured-model',
    )).resolves.toBe('RECOVERED');
    expect(requests).toBe(2);
  });

  it('stops after bounded 5xx retry exhaustion', async () => {
    let requests = 0;
    handler = (_req, res) => {
      requests++;
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('{"error":{"message":"still unavailable"}}');
    };
    await expect(provider({
      maxRetries: 1,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 1,
    }).createChatCompletion(
      [{ role: 'user', content: 'hello' }], 'configured-model',
    )).rejects.toMatchObject({ providerError: { code: 'TEMPORARILY_UNAVAILABLE' } });
    expect(requests).toBe(2);
  });

  it('does not retry a 429 and enters organization cooldown without another credential', async () => {
    let requests = 0;
    handler = (_req, res) => {
      requests++;
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end('{"error":{"message":"rate limited"}}');
    };
    const configured = provider({ maxRetries: 3 });
    await expect(configured.createChatCompletion(
      [{ role: 'user', content: 'hello' }], 'configured-model',
    )).rejects.toMatchObject({ providerError: { code: 'RATE_LIMITED' } });
    expect(requests).toBe(1);
    expect(configured.getQueueStatus().cooldownUntil).toBeDefined();
  });

  it('rejects unsupported capabilities before transport', async () => {
    let requests = 0;
    handler = (_req, res) => { requests++; res.end(); };
    await expect(provider({ capabilities: {} }).createChatCompletion(
      [{ role: 'user', content: 'use a tool' }],
      'configured-model',
      { tools: [{ type: 'function', function: { name: 'Read', parameters: {} } }] },
    )).rejects.toMatchObject({ providerError: { code: 'UNSUPPORTED_CAPABILITY' } });
    expect(requests).toBe(0);
  });

  it('rejects malformed and empty responses', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{not-json');
    };
    await expect(provider().createChatCompletion(
      [{ role: 'user', content: 'hello' }], 'configured-model',
    )).rejects.toMatchObject({ providerError: { code: 'INVALID_REQUEST' } });

    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"choices":[{"finish_reason":"stop","message":{"content":""}}]}');
    };
    await expect(provider().createChatCompletion(
      [{ role: 'user', content: 'hello' }], 'configured-model',
    )).rejects.toMatchObject({ providerError: { code: 'INVALID_REQUEST' } });
  });

  it('cancels an active request without later retry', async () => {
    let requests = 0;
    handler = (_req, res) => {
      requests++;
      setTimeout(() => {
        if (!res.destroyed) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{"choices":[{"message":{"content":"late"}}]}');
        }
      }, 100);
    };
    const controller = new AbortController();
    const pending = provider({ maxRetries: 3 }).createChatCompletion(
      [{ role: 'user', content: 'hello' }], 'configured-model', { signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toBeDefined();
    expect(requests).toBeLessThanOrEqual(1);
  });

  it('normalizes an interrupted streaming connection to one terminal network error', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
      res.destroy();
    };
    const events: any[] = [];
    await expect(provider().createChatCompletionResult!(
      [{ role: 'user', content: 'hello' }], 'configured-model',
      { stream: true, onStreamEvent: (event) => events.push(event) },
    )).rejects.toMatchObject({ providerError: { code: 'NETWORK_ERROR' } });
    expect(events.filter((event) => event.type === 'completed')).toHaveLength(0);
  });

  it('does not expose an echoed Groq key through normalized errors', async () => {
    handler = (_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{"error":{"message":"gsk_mock_key must not escape"}}');
    };
    try {
      await provider().createChatCompletion([{ role: 'user', content: 'hello' }], 'configured-model');
      throw new Error('Expected request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(NormalizedProviderError);
      expect(String(error)).not.toContain('gsk_mock_key');
      expect(JSON.stringify(error)).not.toContain('gsk_mock_key');
    }
  });

  it('blocks unapproved external and private-workspace dispatch before transport', async () => {
    let requests = 0;
    handler = (_req, res) => { requests++; res.end(); };
    const configured = provider();
    await expect(configured.createChatCompletion(
      [{ role: 'user', content: 'hello' }], 'configured-model',
      { allowedExternalProviders: ['local'] },
    )).rejects.toMatchObject({ providerError: { code: 'PERMISSION_DENIED' } });
    await expect(configured.createChatCompletion(
      [{ role: 'user', content: 'private code' }], 'configured-model',
      { privateWorkspace: true, sendPrivateSourceCode: false },
    )).rejects.toMatchObject({ providerError: { code: 'PERMISSION_DENIED' } });
    expect(requests).toBe(0);
  });
});
