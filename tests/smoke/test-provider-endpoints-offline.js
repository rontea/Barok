import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'provider-endpoints-offline-'));
process.env.REACT_ENGINE_DB_PATH = path.join(temporaryDirectory, 'provider-smoke.sqlite');
Object.assign(process.env, {
  GEMINI_API_KEY: 'offline-gemini-key',
  NVIDIA_API_KEY: 'offline-nvidia-key',
  NVIDIA_API_KEYS: '',
  OPENROUTER_API_KEY: 'offline-openrouter-key',
  GROQ_ENABLED: 'true',
  GROQ_API_KEY: 'offline-groq-key',
  GROQ_DEFAULT_MODEL: 'llama-3.3-70b-versatile',
  CEREBRAS_API_KEY: 'offline-cerebras-key',
  CEREBRAS_MODEL: 'gpt-oss-120b',
  SAMBANOVA_API_KEY: 'offline-sambanova-key',
  SAMBANOVA_MODEL: 'gpt-oss-120b',
  KIMI_API_KEY: 'offline-kimi-key',
  REQUESTY_API_KEY: 'offline-requesty-key',
  POLLINATIONS_API_KEY: 'offline-pollinations-key',
});

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname === '127.0.0.1' && ['19998', '19999'].includes(url.port)) {
    const body = url.pathname.endsWith('/props')
      ? { n_ctx: 4096, total_slots: 1 }
      : { data: [{ id: 'offline-local-model', n_ctx: 4096 }] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return originalFetch(input, init);
};

const providerMarkers = {
  gemini: 'GEMINI_TARGET_OK',
  nvidia: 'NVIDIA_TARGET_OK',
  'local-ai': 'LOCAL_ROUTE_OK',
  colab: 'COLAB_ROUTE_OK',
  'openrouter-target': 'OPENROUTER_TARGET_OK',
  openrouter: 'OPENROUTER_ROUTE_OK',
  groq: 'GROQ_ROUTE_OK',
  cerebras: 'CEREBRAS_ROUTE_OK',
  sambanova: 'SAMBANOVA_ROUTE_OK',
  kimi: 'KIMI_ROUTE_OK',
  requesty: 'REQUESTY_ROUTE_OK',
  pollinations: 'POLLINATIONS_ROUTE_OK',
};

let server;
let testStore;
try {
  const { getSQLiteAppStore } = await import('../../src/persistence/sqliteStore.ts');
  const { createRouter } = await import('../../src/routes/providers.ts');
  testStore = getSQLiteAppStore();
  const app = express();
  app.use(express.json());
  app.use(createRouter({
    ensureWorkspaceRoot: async (workspace) => workspace || process.cwd(),
    createTestProvider: (provider) => ({
      createChatCompletion: async (messages) => {
        const marker = providerMarkers[provider] || 'OFFLINE_PROVIDER_OK';
        const prompt = Array.isArray(messages)
          ? messages.map((message) => String(message?.content || '')).join('\n')
          : '';
        const requested = prompt.match(/Reply with exactly:\s*([A-Z_]+)/i)?.[1];
        return requested || marker;
      },
    }),
  }));

  server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string', 'offline provider smoke server must expose a TCP port');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const post = async (pathname, body = {}) => {
    const response = await originalFetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Connection: 'close' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    assert.equal(response.status, 200, `${pathname} returned HTTP ${response.status}: ${JSON.stringify(payload)}`);
    assert.equal(payload.configured, true, `${pathname} should report a configured route`);
    assert.equal(typeof payload.message, 'string', `${pathname} should return a message`);
    assert.equal(typeof payload.responsePreview, 'string', `${pathname} should return a response preview`);
    return payload;
  };

  const getFirstTargetId = async (pathname) => {
    const response = await originalFetch(`${baseUrl}${pathname}`, {
      headers: { Connection: 'close' },
    });
    const payload = await response.json();
    assert.equal(response.status, 200, `${pathname} target listing failed`);
    assert(Array.isArray(payload.targets) && payload.targets.length > 0, `${pathname} should expose a target for the offline test`);
    return payload.targets[0].id;
  };

  const geminiTargetId = await getFirstTargetId('/api/gemini/model-targets');
  const nvidiaTargetId = await getFirstTargetId('/api/nvidia/model-targets');
  const openRouterTargetId = await getFirstTargetId('/api/openrouter/model-targets');

  await post(`/api/gemini/model-targets/${encodeURIComponent(geminiTargetId)}/test`);
  await post(`/api/nvidia/model-targets/${encodeURIComponent(nvidiaTargetId)}/test`);
  await post('/api/local-ai/test', {
    endpoint: { title: 'Offline Local', baseUrl: 'http://127.0.0.1:19998/v1', modelId: 'offline-local-model' },
  });
  await post('/api/colab/test', {
    endpoint: { title: 'Offline Colab', baseUrl: 'http://127.0.0.1:19999/v1', modelId: 'offline-local-model' },
  });
  await post(`/api/openrouter/model-targets/${encodeURIComponent(openRouterTargetId)}/test`);
  await post('/api/openrouter/test');
  await post('/api/groq/test');
  await post('/api/cerebras/test');
  await post('/api/sambanova/test');
  await post('/api/kimi/test');
  await post('/api/requesty/test');
  await post('/api/pollinations/test');

  console.log('All provider test endpoints returned their expected offline response shape.');
} finally {
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  globalThis.fetch = originalFetch;
  testStore?.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
