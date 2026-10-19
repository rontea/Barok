import { describe, expect, it } from '@jest/globals';
import { createRequestEnvelope, hashRequestText } from '../requestEnvelope.js';

describe('request envelope', () => {
  it('records reconstructable request identity without retaining prompt or tool contents', () => {
    const envelope = createRequestEnvelope({
      requestId: 'request-1',
      stepId: 'step-1',
      requestKind: 'step.plan_action',
      status: 'started',
      startedAt: 100,
      requestedRoute: { provider: 'groq', model: 'llama' },
      taskId: 'private task',
      workspaceId: 'C:/workspace',
      repositoryCommitHash: 'abc123',
      messages: [
        { role: 'system', content: 'secret system prompt' },
        { role: 'user', content: 'private user request' },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'Read',
          description: 'read a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      }],
      toolSchemaVersion: 'tools-1',
      maxTokens: 500,
      timeoutMs: 10_000,
    });

    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.input).toMatchObject({
      messageCount: 2,
      messageRoles: ['system', 'user'],
      contentCharacters: 'secret system promptprivate user request'.length,
      contentPolicy: 'hash_only',
    });
    expect(envelope.input.contentHash).toHaveLength(64);
    expect(envelope.input.contentHash).toBe(createRequestEnvelope({
      requestId: 'request-1-replay',
      status: 'started',
      startedAt: 100,
      requestedRoute: { provider: 'groq', model: 'llama' },
      messages: [
        { role: 'system', content: 'secret system prompt' },
        { role: 'user', content: 'private user request' },
      ],
    }).input.contentHash);
    expect(envelope.tools).toMatchObject({ schemaVersion: 'tools-1', names: ['Read'] });
    expect(JSON.stringify(envelope)).not.toContain('secret system prompt');
    expect(JSON.stringify(envelope)).not.toContain('private user request');
    expect(JSON.stringify(envelope)).not.toContain('read a file');
  });

  it('records bounded outcome metadata and route changes', () => {
    const envelope = createRequestEnvelope({
      requestId: 'request-2',
      status: 'succeeded',
      startedAt: 100,
      completedAt: 175,
      requestedRoute: { provider: 'nvidia', model: 'primary' },
      resolvedRoute: { provider: 'nvidia', model: 'recovery', credentialIndex: 1 },
      messages: [{ role: 'user', content: 'hello' }],
      response: {
        textCharacters: 5,
        textHash: hashRequestText('hello'),
        toolCallCount: 1,
        finishReason: 'stop',
        providerRequestId: 'provider-request',
      },
    });

    expect(envelope).toMatchObject({
      status: 'succeeded',
      durationMs: 75,
      resolvedRoute: { provider: 'nvidia', model: 'recovery', credentialIndex: 1 },
      response: { textCharacters: 5, toolCallCount: 1, finishReason: 'stop' },
    });
  });
});
