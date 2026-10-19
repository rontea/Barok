import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, describe, expect, it } from '@jest/globals';
import { createRouter as createProvidersRouter } from '../providers.js';
import { createRouter as createSettingsRouter } from '../settings.js';

const servers: Server[] = [];

const providerMutations: Array<{ method: string; path: string; body?: unknown }> = [
  { method: 'POST', path: '/api/providers/rate-limits/reset' },
  { method: 'PUT', path: '/api/gemini/profiles/default' },
  { method: 'POST', path: '/api/gemini/profiles' },
  { method: 'DELETE', path: '/api/gemini/profiles/example' },
  { method: 'PUT', path: '/api/gemini/profiles/assignment' },
  { method: 'PUT', path: '/api/gemini/model-targets' },
  { method: 'PUT', path: '/api/nvidia/model-targets' },
  { method: 'PUT', path: '/api/local-ai/endpoints' },
  { method: 'PUT', path: '/api/colab/endpoints' },
  { method: 'PUT', path: '/api/openrouter/settings' },
  { method: 'PUT', path: '/api/openrouter/model-target' },
  { method: 'PUT', path: '/api/openrouter/model-targets' },
  { method: 'POST', path: '/api/openrouter/model-targets' },
  { method: 'DELETE', path: '/api/openrouter/model-targets/example' },
  { method: 'PUT', path: '/api/groq/settings' },
  { method: 'PUT', path: '/api/groq/model-target' },
  { method: 'PUT', path: '/api/sambanova/model-target' },
  { method: 'PUT', path: '/api/kimi/model-target' },
  { method: 'PUT', path: '/api/requesty/model-target' },
  { method: 'POST', path: '/api/pollinations/model-catalog/sync' },
];

const settingsMutations: Array<{ method: string; path: string }> = [
  { method: 'PUT', path: '/api/settings/example' },
  { method: 'PUT', path: '/api/engine-settings' },
  { method: 'PUT', path: '/api/delegation/settings' },
];

async function startTestServer(): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use(createProvidersRouter({ ensureWorkspaceRoot: async (workspace) => workspace || process.cwd() }));
  app.use(createSettingsRouter({ ensureWorkspaceRoot: async (workspace) => workspace || process.cwd() }));

  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP address.');
  return `http://127.0.0.1:${address.port}`;
}

describe('provider settings mutation authorization', () => {
  const originalToken = process.env.PROVIDER_SETTINGS_TOKEN;

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    if (originalToken === undefined) delete process.env.PROVIDER_SETTINGS_TOKEN;
    else process.env.PROVIDER_SETTINGS_TOKEN = originalToken;
  });

  it('rejects every provider mutation route from a cross-origin request', async () => {
    delete process.env.PROVIDER_SETTINGS_TOKEN;
    const baseUrl = await startTestServer();

    for (const mutation of providerMutations) {
      const response = await fetch(`${baseUrl}${mutation.path}`, {
        method: mutation.method,
        headers: {
          Origin: 'https://attacker.example',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mutation.body || {}),
      });
      expect(response.status).toBe(403);
    }
  });

  it('rejects generic settings writes from a cross-origin request', async () => {
    delete process.env.PROVIDER_SETTINGS_TOKEN;
    const baseUrl = await startTestServer();

    for (const mutation of settingsMutations) {
      const response = await fetch(`${baseUrl}${mutation.path}`, {
        method: mutation.method,
        headers: {
          Origin: 'https://attacker.example',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: 'blocked' }),
      });
      expect(response.status).toBe(403);
    }
  });
});
