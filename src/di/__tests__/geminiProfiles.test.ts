import { jest } from '@jest/globals';
import {
  GEMINI_PROFILE_ASSIGNMENTS_SETTING_KEY,
  GeminiProfileRegistry,
  GeminiProfileScheduler,
  assignGeminiProfile,
  parseLegacyGeminiAccountProfiles,
  parseGeminiProfileConfig,
  selectGeminiProfileId,
} from '../../config/geminiProfiles.js';
import { getSQLiteAppStore } from '../../persistence/sqliteStore.js';
import { GeminiLLMProvider, CompositeLLMProvider } from '../providers/llmProvider.js';
import { prepareGeminiMessages, resetGeminiRequestReliabilityState } from '../providers/geminiRequestReliability.js';
import type { LLMProvider, LLMRequestTelemetry } from '../types.js';

const profiles = () => new GeminiProfileRegistry([
  { id: 'account-a', label: 'Account A', purpose: 'development', apiKey: 'gemini-account-a-secret', enabled: true, envVar: 'A' },
  { id: 'account-b', label: 'Account B', purpose: 'testing', apiKey: 'gemini-account-b-secret', enabled: true, envVar: 'B' },
  { id: 'account-c', label: 'Account C', purpose: 'workspace', apiKey: 'gemini-account-c-secret', enabled: true, envVar: 'C' },
]);

const provider = () => new GeminiLLMProvider(
  undefined,
  undefined,
  profiles(),
  new GeminiProfileScheduler({ maxConcurrentRequests: 1, persist: false }),
);

describe('isolated Gemini account profiles', () => {
  beforeEach(() => {
    resetGeminiRequestReliabilityState();
  });

  it('parses profile metadata that references server-side environment variables', () => {
    expect(parseGeminiProfileConfig(`
providers:
  gemini:
    profiles:
      account_a:
        api_key_env: GEMINI_ACCOUNT_A_API_KEY
        enabled: true
        purpose: development
      account_b:
        api_key_env: GEMINI_ACCOUNT_B_API_KEY
        enabled: false
        purpose: testing
    `)).toEqual([
      { id: 'account_a', apiKeyEnv: 'GEMINI_ACCOUNT_A_API_KEY', enabled: true, purpose: 'development' },
      { id: 'account_b', apiKeyEnv: 'GEMINI_ACCOUNT_B_API_KEY', enabled: false, purpose: 'testing' },
    ]);
  });

  it('exposes legacy primary and pooled keys as isolated API profiles', () => {
    const parsed = parseLegacyGeminiAccountProfiles(
      'primary-key',
      'second-key,third-key,second-key',
    );

    expect(parsed).toEqual([
      expect.objectContaining({ id: 'default', label: 'Gemini API 1', apiKey: 'primary-key' }),
      expect.objectContaining({ id: 'legacy-api-2', label: 'Gemini API 2', apiKey: 'second-key' }),
      expect.objectContaining({ id: 'legacy-api-3', label: 'Gemini API 3', apiKey: 'third-key' }),
    ]);
  });

  it('selects workspace, then user, then new-task, then default profile', () => {
    const store = getSQLiteAppStore();
    const original = store.getSetting(GEMINI_PROFILE_ASSIGNMENTS_SETTING_KEY);
    try {
      store.saveSetting(GEMINI_PROFILE_ASSIGNMENTS_SETTING_KEY, { workspaces: {}, users: {} });
      const registry = profiles();
      assignGeminiProfile({ profileId: 'account-c' }, registry);
      assignGeminiProfile({ userId: 'profile-test-user', profileId: 'account-b' }, registry);
      assignGeminiProfile({ workspace: 'C:\\profile-test-workspace', profileId: 'account-a' }, registry);

      expect(selectGeminiProfileId({
        workspace: 'C:\\profile-test-workspace',
        userId: 'profile-test-user',
        taskProfileId: 'account-c',
      }, profiles())).toBe('account-a');
      expect(selectGeminiProfileId({
        workspace: 'C:\\another-profile-test-workspace',
        userId: 'profile-test-user',
        taskProfileId: 'account-c',
      }, profiles())).toBe('account-b');
      expect(selectGeminiProfileId({
        workspace: 'C:\\another-profile-test-workspace',
        taskProfileId: 'account-c',
      }, profiles())).toBe('account-c');
    } finally {
      store.saveSetting(GEMINI_PROFILE_ASSIGNMENTS_SETTING_KEY, original || { workspaces: {}, users: {} });
    }
  });

  it('keeps the explicitly selected profile after a 429 and never calls sibling accounts', async () => {
    const gemini = provider();
    const calls: string[] = [];
    (gemini as any).getClient = async (apiKey: string) => ({
      models: {
        generateContent: async () => {
          calls.push(apiKey);
          throw new Error('HTTP 429 RESOURCE_EXHAUSTED retry-after: 60s');
        },
      },
    });

    await expect(gemini.createChatCompletion(
      [{ role: 'user', content: 'Stay on account A' }],
      'gemini-3.5-flash',
      { geminiProfileId: 'account-a', timeoutMs: 20_000 },
    )).rejects.toThrow(/task remains assigned to Account A/i);

    expect(calls).toEqual(['gemini-account-a-secret']);
    expect(gemini.getProfileHealth().find((profile) => profile.id === 'account-a')?.scheduler.status).toBe('cooldown');
    expect(gemini.getProfileHealth().find((profile) => profile.id === 'account-b')?.scheduler.status).toBe('available');
  });

  it('deduplicates identical in-flight requests, including a page reconnect, into one provider call', async () => {
    const gemini = provider();
    let release!: (value: { text: string }) => void;
    const response = new Promise<{ text: string }>((resolve) => { release = resolve; });
    let calls = 0;
    (gemini as any).getClient = async () => ({
      models: { generateContent: async () => { calls++; return response; } },
    });
    const options = {
      geminiProfileId: 'account-b',
      workspaceId: 'workspace-one',
      repositoryCommitHash: 'abc123',
      timeoutMs: 20_000,
    };
    const first = gemini.createChatCompletion([{ role: 'user', content: 'same' }], 'gemini-3.5-flash', options);
    const second = gemini.createChatCompletion([{ role: 'user', content: 'same' }], 'gemini-3.5-flash', options);
    await Promise.resolve();
    release({ text: 'one result' });

    await expect(Promise.all([first, second])).resolves.toEqual(['one result', 'one result']);
    expect(calls).toBe(1);
  });

  it('omits retired sampling controls for current Gemini models', async () => {
    const gemini = provider();
    let receivedConfig: Record<string, unknown> | undefined;
    (gemini as any).getClient = async () => ({
      models: {
        generateContent: async (request: any) => {
          receivedConfig = request.config;
          return { text: 'current model response' };
        },
      },
    });

    await expect(gemini.createChatCompletion(
      [{ role: 'user', content: 'use the current model' }],
      'gemini-3.6-flash',
      {
        geminiProfileId: 'account-a',
        temperature: 0.8,
        topP: 0.7,
        maxTokens: 128,
        timeoutMs: 20_000,
      },
    )).resolves.toBe('current model response');

    expect(receivedConfig).toEqual(expect.objectContaining({ maxOutputTokens: 128 }));
    expect(receivedConfig).not.toHaveProperty('temperature');
    expect(receivedConfig).not.toHaveProperty('topP');
  });

  it('isolates cached responses by workspace and profile', async () => {
    const gemini = provider();
    let calls = 0;
    (gemini as any).getClient = async () => ({
      models: { generateContent: async () => ({ text: `result-${++calls}` }) },
    });
    const messages = [{ role: 'user', content: 'classify this repository' }];
    const base = { repositoryCommitHash: 'commit-1', cacheable: true, timeoutMs: 20_000 };

    await gemini.createChatCompletion(messages, 'gemini-3.5-flash', { ...base, workspaceId: 'one', geminiProfileId: 'account-a' });
    await gemini.createChatCompletion(messages, 'gemini-3.5-flash', { ...base, workspaceId: 'one', geminiProfileId: 'account-a' });
    await gemini.createChatCompletion(messages, 'gemini-3.5-flash', { ...base, workspaceId: 'two', geminiProfileId: 'account-a' });
    await gemini.createChatCompletion(messages, 'gemini-3.5-flash', { ...base, workspaceId: 'one', geminiProfileId: 'account-b' });

    expect(calls).toBe(3);
  });

  it('isolates cached private responses by repository commit and user', async () => {
    const gemini = provider();
    let calls = 0;
    (gemini as any).getClient = async () => ({
      models: { generateContent: async () => ({ text: `private-${++calls}` }) },
    });
    const messages = [{ role: 'user', content: 'review unchanged private code' }];
    const base = {
      workspaceId: 'private-workspace',
      geminiProfileId: 'account-a',
      cacheable: true,
      timeoutMs: 20_000,
    };

    await gemini.createChatCompletion(messages, 'gemini-3.5-flash', { ...base, repositoryCommitHash: 'one', userId: 'alice' });
    await gemini.createChatCompletion(messages, 'gemini-3.5-flash', { ...base, repositoryCommitHash: 'one', userId: 'alice' });
    await gemini.createChatCompletion(messages, 'gemini-3.5-flash', { ...base, repositoryCommitHash: 'two', userId: 'alice' });
    await gemini.createChatCompletion(messages, 'gemini-3.5-flash', { ...base, repositoryCommitHash: 'one', userId: 'bob' });

    expect(calls).toBe(3);
  });

  it('compresses older repeated context before dispatch', () => {
    const originalLimit = process.env.GEMINI_CONTEXT_MAX_CHARACTERS;
    const originalTrigger = process.env.GEMINI_CONTEXT_SUMMARY_TRIGGER_PERCENTAGE;
    process.env.GEMINI_CONTEXT_MAX_CHARACTERS = '4000';
    process.env.GEMINI_CONTEXT_SUMMARY_TRIGGER_PERCENTAGE = '50';
    try {
      const input = Array.from({ length: 10 }, (_, index) => ({
        role: index % 2 ? 'assistant' : 'user',
        content: `message ${index} ${'x'.repeat(350)}`,
      }));
      const prepared = prepareGeminiMessages(input, { model: 'gemini-3.5-flash' });
      expect(prepared.messages.some((message) => message.content.includes('[compressed conversation context]'))).toBe(true);
      expect(prepared.removedCharacters).toBeGreaterThan(0);
      expect(prepared.messages.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThan(
        input.reduce((sum, message) => sum + message.content.length, 0),
      );
    } finally {
      if (originalLimit === undefined) delete process.env.GEMINI_CONTEXT_MAX_CHARACTERS;
      else process.env.GEMINI_CONTEXT_MAX_CHARACTERS = originalLimit;
      if (originalTrigger === undefined) delete process.env.GEMINI_CONTEXT_SUMMARY_TRIGGER_PERCENTAGE;
      else process.env.GEMINI_CONTEXT_SUMMARY_TRIGGER_PERCENTAGE = originalTrigger;
    }
  });

  it('redacts common credentials before sending request context', async () => {
    const gemini = provider();
    let sent = '';
    (gemini as any).getClient = async () => ({
      models: {
        generateContent: async (request: any) => {
          sent = request.contents.map((content: any) => content.parts[0].text).join('\n');
          return { text: 'safe' };
        },
      },
    });
    await gemini.createChatCompletion(
      [{ role: 'user', content: 'api_key=super-secret-test-value' }],
      'gemini-3.5-flash',
      { geminiProfileId: 'account-c', timeoutMs: 20_000 },
    );
    expect(sent).toContain('[REDACTED]');
    expect(sent).not.toContain('super-secret-test-value');
  });

  it('disables only the profile with invalid credentials', async () => {
    const gemini = provider();
    (gemini as any).getClient = async () => ({
      models: { generateContent: async () => { throw new Error('HTTP 401 UNAUTHENTICATED invalid api key'); } },
    });
    await expect(gemini.createChatCompletion(
      [{ role: 'user', content: 'authenticate' }],
      'gemini-3.5-flash',
      { geminiProfileId: 'account-a', timeoutMs: 20_000 },
    )).rejects.toThrow(/AUTHENTICATED|invalid api key/i);
    const health = gemini.getProfileHealth();
    expect(health.find((profile) => profile.id === 'account-a')?.scheduler.status).toBe('disabled');
    expect(health.find((profile) => profile.id === 'account-b')?.scheduler.status).toBe('available');
  });

  it('keeps the legacy single-key constructor backward compatible as one default profile', async () => {
    const gemini = new GeminiLLMProvider(
      'legacy-single-key',
      undefined,
      undefined,
      new GeminiProfileScheduler({ persist: false }),
    );
    let selectedKey = '';
    (gemini as any).getClient = async (apiKey: string) => ({
      models: { generateContent: async () => { selectedKey = apiKey; return { text: 'ok' }; } },
    });
    await expect(gemini.createChatCompletion(
      [{ role: 'user', content: 'legacy' }],
      'gemini-3.5-flash',
      { timeoutMs: 20_000 },
    )).resolves.toBe('ok');
    expect(selectedKey).toBe('legacy-single-key');
    expect(gemini.getProfileSummaries()).toEqual([
      expect.objectContaining({ id: 'default', label: 'Gemini Default Account' }),
    ]);
  });

  it('never exposes profile credentials through health or statistics responses', () => {
    const gemini = provider();
    const serialized = JSON.stringify({
      health: gemini.getProfileHealth(),
      stats: gemini.getPoolStats(),
    });
    expect(serialized).not.toContain('gemini-account-a-secret');
    expect(serialized).not.toContain('gemini-account-b-secret');
    expect(serialized).not.toContain('gemini-account-c-secret');
  });

  it('redacts credentials from provider errors', async () => {
    const gemini = provider();
    (gemini as any).getClient = async (apiKey: string) => ({
      models: {
        generateContent: async () => {
          throw new Error(`HTTP 401 Authorization: Bearer ${apiKey}`);
        },
      },
    });
    let message = '';
    try {
      await gemini.createChatCompletion(
        [{ role: 'user', content: 'authenticate safely' }],
        'gemini-3.5-flash',
        { geminiProfileId: 'account-a', timeoutMs: 20_000 },
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain('gemini-account-a-secret');
    expect(message).toContain('[REDACTED]');
  });

  it('requires explicit permission before falling back from Gemini to another provider', async () => {
    const gemini: LLMProvider = {
      createChatCompletion: async () => { throw new Error('Gemini unavailable'); },
      estimateStepCost: () => 0,
      getProviderName: () => 'gemini',
      isAvailable: () => true,
    };
    let nvidiaCalls = 0;
    const nvidia: LLMProvider = {
      createChatCompletion: async () => { nvidiaCalls++; return 'fallback'; },
      estimateStepCost: () => 0,
      getProviderName: () => 'nvidia',
      isAvailable: () => true,
    };
    const composite = new CompositeLLMProvider([gemini, nvidia]);

    await expect(composite.createChatCompletion(
      [{ role: 'user', content: 'private code' }],
      'gemini-3.5-flash',
      { timeoutMs: 20_000, allowCrossProviderFallback: false },
    )).rejects.toThrow(/All LLM providers failed/);
    expect(nvidiaCalls).toBe(0);
  });

  it('uses the approved local fallback before NVIDIA', async () => {
    const calls: string[] = [];
    const fake = (name: string, outcome: 'fail' | 'success'): LLMProvider => ({
      createChatCompletion: async () => {
        calls.push(name);
        if (outcome === 'fail') throw new Error(`${name} unavailable`);
        return `${name} result`;
      },
      estimateStepCost: () => 0,
      getProviderName: () => name,
      isAvailable: () => true,
    });
    const composite = new CompositeLLMProvider([
      fake('gemini', 'fail'),
      fake('nvidia', 'success'),
      fake('local', 'fail'),
    ]);
    await expect(composite.createChatCompletion(
      [{ role: 'user', content: 'approved private code' }],
      'gemini-3.5-flash',
      {
        timeoutMs: 20_000,
        allowCrossProviderFallback: true,
        fallbackApprovalGranted: true,
        approvedFallbackProviders: ['local', 'nvidia'],
      },
    )).resolves.toBe('nvidia result');
    expect(calls).toEqual(['gemini', 'local', 'nvidia']);
  });

  it('runs only one request at a time per profile while allowing another profile independently', async () => {
    const scheduler = new GeminiProfileScheduler({ maxConcurrentRequests: 1, persist: false });
    const order: string[] = [];
    let releaseA!: () => void;
    const aGate = new Promise<void>((resolve) => { releaseA = resolve; });
    const firstA = scheduler.run('account-a', async () => { order.push('a1-start'); await aGate; order.push('a1-end'); return 1; });
    const secondA = scheduler.run('account-a', async () => { order.push('a2'); return 2; });
    const firstB = scheduler.run('account-b', async () => { order.push('b1'); return 3; });
    await firstB;
    expect(order).toEqual(['a1-start', 'b1']);
    releaseA();
    await Promise.all([firstA, secondA]);
    expect(order).toEqual(['a1-start', 'b1', 'a1-end', 'a2']);
  });

  it('spaces queued requests for the same profile across callers', async () => {
    jest.useFakeTimers({ now: 10_000 });
    try {
      const scheduler = new GeminiProfileScheduler({ maxConcurrentRequests: 1, persist: false });
      const starts: number[] = [];
      const waits: number[] = [];

      await scheduler.run('account-a', async () => {
        starts.push(Date.now());
        return 'first';
      }, { minIntervalMs: 50 });
      await Promise.resolve();

      const second = scheduler.run('account-a', async () => {
        starts.push(Date.now());
        return 'second';
      }, { minIntervalMs: 50, onPacingWait: (delayMs) => waits.push(delayMs) });

      expect(starts).toEqual([10_000]);
      expect(waits).toEqual([50]);
      await jest.advanceTimersByTimeAsync(49);
      expect(starts).toEqual([10_000]);
      await jest.advanceTimersByTimeAsync(1);
      await expect(second).resolves.toBe('second');
      expect(starts).toEqual([10_000, 10_050]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports retries on transient 503 errors without changing profiles', async () => {
    jest.useFakeTimers();
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    const geminiProvider = provider();
    const calls: string[] = [];
    const telemetry: LLMRequestTelemetry[] = [];
    (geminiProvider as any).getClient = async (apiKey: string) => ({
      models: {
        generateContent: async () => {
          calls.push(apiKey);
          if (calls.length === 1) throw new Error('HTTP 503 SERVICE_UNAVAILABLE');
          return { text: 'recovered' };
        },
      },
    });
    try {
      const request = geminiProvider.createChatCompletion(
        [{ role: 'user', content: 'retry transiently' }],
        'gemini-3.5-flash',
        { geminiProfileId: 'account-b', timeoutMs: 30_000, onTelemetry: (event) => telemetry.push(event) },
      );
      await jest.advanceTimersByTimeAsync(2_100);
      await expect(request).resolves.toBe('recovered');
      expect(calls).toEqual(['gemini-account-b-secret', 'gemini-account-b-secret']);
      expect(telemetry.some((event) => event.fallbackDecision === 'retry_same_profile')).toBe(true);
    } finally {
      random.mockRestore();
      jest.useRealTimers();
    }
  });
});
