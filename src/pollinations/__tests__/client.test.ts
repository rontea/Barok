import { describe, expect, it } from '@jest/globals';
import { PollinationsClient } from '../client.js';

function createJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('PollinationsClient auth handling', () => {
  it('omits Authorization and uses the public text endpoint when constructed with null', async () => {
    const requests: Array<{ url: string; authorization?: string }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        authorization: (init?.headers as Record<string, string> | undefined)?.Authorization,
      });

      return createJsonResponse({
        choices: [{ message: { content: 'public response' } }],
      });
    }) as typeof fetch;

    const client = new PollinationsClient(null, fetchImpl);
    const result = await client.chatCompletion({
      messages: [{ role: 'user', content: 'hello' }],
      model: 'qwen-coder',
    });

    expect(result.content).toBe('public response');
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://text.pollinations.ai/');
    expect(requests[0].authorization).toBeUndefined();
  });

  it('accepts plain text responses from the public text endpoint', async () => {
    const fetchImpl = (async () => (
      new Response('plain public response', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    )) as typeof fetch;

    const client = new PollinationsClient(null, fetchImpl);
    const result = await client.chatCompletion({
      messages: [{ role: 'user', content: 'hello' }],
      model: 'qwen-coder',
    });

    expect(result.content).toBe('plain public response');
  });

  it('uses Authorization when an explicit key is provided', async () => {
    const requests: Array<{ url: string; authorization?: string }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        authorization: (init?.headers as Record<string, string> | undefined)?.Authorization,
      });

      return createJsonResponse({
        choices: [{ message: { content: 'auth response' } }],
      });
    }) as typeof fetch;

    const client = new PollinationsClient('sk_test', fetchImpl);
    const result = await client.chatCompletion({
      messages: [{ role: 'user', content: 'hello' }],
      model: 'qwen-coder',
    });

    expect(result.content).toBe('auth response');
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://gen.pollinations.ai/v1/chat/completions');
    expect(requests[0].authorization).toBe('Bearer sk_test');
  });

  it('passes the documented reasoning_effort field to authenticated chat requests', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      return createJsonResponse({
        choices: [{ message: { content: 'reasoned response' } }],
      });
    }) as typeof fetch;

    const client = new PollinationsClient('sk_test', fetchImpl);
    await client.chatCompletion({
      messages: [{ role: 'user', content: 'hello' }],
      model: 'MarcosFRG/qwen3.8-27b',
      max_tokens: 1024,
      reasoning_effort: 'low',
    });

    expect(requestBody).toMatchObject({
      model: 'MarcosFRG/qwen3.8-27b',
      max_tokens: 1024,
      reasoning_effort: 'low',
    });
  });
});
