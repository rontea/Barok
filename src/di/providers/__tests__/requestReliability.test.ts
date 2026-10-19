import { afterEach, describe, expect, it } from '@jest/globals';
import {
  createProviderRequestFingerprint,
  createStepIdempotencyKey,
  prepareProviderMessages,
  resetProviderRequestReliability,
  runReliableProviderRequest,
} from '../requestReliability.js';

describe('provider-neutral request reliability', () => {
  afterEach(() => resetProviderRequestReliability());

  it('fingerprints provider, model, workspace, commit, tools, and settings', () => {
    const base = {
      provider: 'groq', model: 'model', messages: [{ role: 'user', content: 'hello' }],
      workspaceId: 'workspace', repositoryCommitHash: 'abc', userId: 'user',
      tools: [{ name: 'Read' }], settings: { temperature: 0 },
    };
    expect(createProviderRequestFingerprint(base)).not.toBe(createProviderRequestFingerprint({ ...base, repositoryCommitHash: 'def' }));
    expect(createStepIdempotencyKey('task', 'step', 0)).not.toBe(createStepIdempotencyKey('task', 'step', 1));
  });

  it('deduplicates identical in-flight requests', async () => {
    let calls = 0;
    let release!: (value: string) => void;
    const operation = () => new Promise<string>((resolve) => { calls++; release = resolve; });
    const first = runReliableProviderRequest('same', operation);
    const second = runReliableProviderRequest('same', operation);
    release('ok');
    await expect(Promise.all([first, second])).resolves.toEqual(['ok', 'ok']);
    expect(calls).toBe(1);
  });

  it('keeps shared transport alive while another subscriber remains', async () => {
    let upstreamAborted = false;
    let release!: (value: string) => void;
    const operation = (signal: AbortSignal) => new Promise<string>((resolve) => {
      release = resolve;
      signal.addEventListener('abort', () => { upstreamAborted = true; });
    });
    const controller = new AbortController();
    const cancelled = runReliableProviderRequest('shared', operation, { signal: controller.signal });
    const remaining = runReliableProviderRequest('shared', operation);
    controller.abort();
    await expect(cancelled).rejects.toBeDefined();
    expect(upstreamAborted).toBe(false);
    release('ok');
    await expect(remaining).resolves.toBe('ok');
  });

  it('redacts secrets, excludes sensitive paths, deduplicates, and bounds context', () => {
    const prepared = prepareProviderMessages([
      { role: 'user', content: 'token=secret_value_that_is_long_enough' },
      { role: 'user', content: 'token=secret_value_that_is_long_enough' },
      { role: 'user', content: 'file: .env\nAPI_KEY=should_not_leave' },
      { role: 'tool', content: 'x'.repeat(25_000) },
    ], { maxToolOutputCharacters: 1_000, contextTokenLimit: 2_000, outputTokenLimit: 200 });
    expect(prepared.secretsDetected).toBe(true);
    expect(JSON.stringify(prepared.messages)).not.toContain('secret_value_that_is_long_enough');
    expect(JSON.stringify(prepared.messages)).not.toContain('should_not_leave');
    expect(prepared.messages.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(prepared.removedCharacters).toBeGreaterThan(0);
  });

  it('blocks secret-bearing prompts when policy requires it', () => {
    expect(() => prepareProviderMessages([
      { role: 'user', content: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz' },
    ], { outboundSecretPolicy: 'block' })).toThrow(/workspace policy blocks/i);
  });

  it('requires explicit approval before redacting and sending secret-bearing context', () => {
    const messages = [{ role: 'user', content: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz' }];
    expect(() => prepareProviderMessages(
      messages,
      { outboundSecretPolicy: 'require_approval' },
    )).toThrow(/approval/i);
    const approved = prepareProviderMessages(messages, {
      outboundSecretPolicy: 'require_approval',
      outboundSecretApprovalGranted: true,
    });
    expect(approved.secretsDetected).toBe(true);
    expect(approved.messages[0].content).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });

  it('caches only explicitly cacheable results and isolates commit identities', async () => {
    let calls = 0;
    const identity = {
      provider: 'groq', model: 'model', messages: [{ role: 'user', content: 'hello' }],
      repositoryCommitHash: 'abc',
    };
    const operation = async () => `value-${++calls}`;
    await expect(runReliableProviderRequest('cache', operation, { cacheResult: true, identity })).resolves.toBe('value-1');
    await expect(runReliableProviderRequest('cache', operation, { cacheResult: true, identity })).resolves.toBe('value-1');
    await expect(runReliableProviderRequest('cache', operation, {
      cacheResult: true,
      identity: { ...identity, repositoryCommitHash: 'def' },
    })).resolves.toBe('value-2');
  });
});
