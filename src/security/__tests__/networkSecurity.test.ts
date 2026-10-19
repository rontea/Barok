import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, describe, expect, it } from '@jest/globals';
import {
  createApiAccessMiddleware,
  createConfiguredCorsMiddleware,
  getNetworkSecurityConfig,
  isLoopbackHost,
  parseCorsOrigins,
} from '../networkSecurity.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function startSecurityTestServer(): Promise<{ baseUrl: string; state: { mutations: number } }> {
  const app = express();
  const state = { mutations: 0 };
  app.use(express.json());
  app.use(createConfiguredCorsMiddleware(['http://trusted.example']));
  app.use('/api', createApiAccessMiddleware({ apiToken: 'test-api-token' }));
  app.use('/workspace-file', createApiAccessMiddleware({ apiToken: 'test-api-token' }));
  app.use('/strict-api', createApiAccessMiddleware({ apiToken: 'test-api-token', requireTokenForAllNonHealth: true }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/private', (_req, res) => res.json({ secret: 'protected' }));
  app.get('/strict-api/private', (_req, res) => res.json({ secret: 'strictly protected' }));
  app.post('/api/private', (_req, res) => {
    state.mutations += 1;
    res.json({ ok: true });
  });
  app.get('/workspace-file', (_req, res) => res.type('text/plain').send('protected workspace file'));

  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP address.');
  return { baseUrl: `http://127.0.0.1:${address.port}`, state };
}

describe('network security', () => {
  it('defaults to loopback and rejects wildcard CORS configuration', () => {
    const originalHost = process.env.SERVER_HOST;
    const originalAllowLan = process.env.SERVER_ALLOW_LAN;
    const originalToken = process.env.SERVER_API_TOKEN;
    const originalOrigins = process.env.SERVER_CORS_ORIGINS;
    try {
      delete process.env.SERVER_HOST;
      delete process.env.SERVER_ALLOW_LAN;
      delete process.env.SERVER_API_TOKEN;
      delete process.env.SERVER_CORS_ORIGINS;
      expect(getNetworkSecurityConfig()).toEqual({
        host: '127.0.0.1',
        allowLan: false,
        apiToken: undefined,
        corsOrigins: [],
      });
      expect(isLoopbackHost('127.0.0.1')).toBe(true);
      expect(isLoopbackHost('0.0.0.0')).toBe(false);
      expect(() => parseCorsOrigins('http://localhost:3000,*')).toThrow('wildcard');
    } finally {
      if (originalHost === undefined) delete process.env.SERVER_HOST; else process.env.SERVER_HOST = originalHost;
      if (originalAllowLan === undefined) delete process.env.SERVER_ALLOW_LAN; else process.env.SERVER_ALLOW_LAN = originalAllowLan;
      if (originalToken === undefined) delete process.env.SERVER_API_TOKEN; else process.env.SERVER_API_TOKEN = originalToken;
      if (originalOrigins === undefined) delete process.env.SERVER_CORS_ORIGINS; else process.env.SERVER_CORS_ORIGINS = originalOrigins;
    }
  });

  it('requires an explicit LAN opt-in and API token', () => {
    const originalHost = process.env.SERVER_HOST;
    const originalAllowLan = process.env.SERVER_ALLOW_LAN;
    const originalToken = process.env.SERVER_API_TOKEN;
    try {
      process.env.SERVER_HOST = '0.0.0.0';
      delete process.env.SERVER_ALLOW_LAN;
      delete process.env.SERVER_API_TOKEN;
      expect(() => getNetworkSecurityConfig()).toThrow('SERVER_ALLOW_LAN');
      process.env.SERVER_ALLOW_LAN = 'true';
      expect(() => getNetworkSecurityConfig()).toThrow('SERVER_API_TOKEN');
      process.env.SERVER_API_TOKEN = 'test-api-token';
      expect(getNetworkSecurityConfig().host).toBe('0.0.0.0');
    } finally {
      if (originalHost === undefined) delete process.env.SERVER_HOST; else process.env.SERVER_HOST = originalHost;
      if (originalAllowLan === undefined) delete process.env.SERVER_ALLOW_LAN; else process.env.SERVER_ALLOW_LAN = originalAllowLan;
      if (originalToken === undefined) delete process.env.SERVER_API_TOKEN; else process.env.SERVER_API_TOKEN = originalToken;
    }
  });

  it('blocks untrusted origins from reading or mutating API state', async () => {
    const { baseUrl, state } = await startSecurityTestServer();
    const read = await fetch(`${baseUrl}/api/private`, { headers: { Origin: 'http://evil.example' } });
    const mutate = await fetch(`${baseUrl}/api/private`, {
      method: 'POST',
      headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(read.status).toBe(401);
    expect(mutate.status).toBe(401);
    expect(state.mutations).toBe(0);
    expect(read.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('protects the legacy workspace file endpoint outside the API namespace', async () => {
    const { baseUrl } = await startSecurityTestServer();
    const untrusted = await fetch(`${baseUrl}/workspace-file?path=secret.txt`, {
      headers: { Origin: 'http://evil.example' },
    });
    const authenticated = await fetch(`${baseUrl}/workspace-file?path=secret.txt`, {
      headers: { 'X-API-Token': 'test-api-token' },
    });

    expect(untrusted.status).toBe(401);
    expect(authenticated.status).toBe(200);
    await expect(authenticated.text()).resolves.toBe('protected workspace file');
  });

  it('allows health, same-origin UI traffic, and token-authenticated configured origins', async () => {
    const { baseUrl } = await startSecurityTestServer();
    const health = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'http://evil.example' } });
    const sameOrigin = await fetch(`${baseUrl}/api/private`, { headers: { Origin: baseUrl } });
    const trusted = await fetch(`${baseUrl}/api/private`, {
      headers: { Origin: 'http://trusted.example', 'X-API-Token': 'test-api-token' },
    });
    expect(health.status).toBe(200);
    expect(sameOrigin.status).toBe(200);
    expect(trusted.status).toBe(200);
    expect(trusted.headers.get('access-control-allow-origin')).toBe('http://trusted.example');
  });

  it('can require the token even for same-origin requests in LAN mode', async () => {
    const { baseUrl } = await startSecurityTestServer();
    const withoutToken = await fetch(`${baseUrl}/strict-api/private`, { headers: { Origin: baseUrl } });
    const withCookie = await fetch(`${baseUrl}/strict-api/private`, {
      headers: { Cookie: 'server_api_token=test-api-token' },
    });
    expect(withoutToken.status).toBe(401);
    expect(withCookie.status).toBe(200);
  });
});
