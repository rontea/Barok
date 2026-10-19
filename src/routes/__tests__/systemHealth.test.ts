import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createRouter as createSystemRouter } from '../system.js';

const servers: Server[] = [];

async function startServer(store: { checkHealth: () => void }): Promise<string> {
  const app = express();
  app.use(createSystemRouter({
    ensureWorkspaceRoot: async (workspace) => workspace || process.cwd(),
    healthStartedAt: Date.now(),
    store: store as any,
  }));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Health test server did not expose a TCP address.');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('SQLite readiness health endpoint', () => {
  it('reports readiness when SQLite responds', async () => {
    const checkHealth = jest.fn();
    const baseUrl = await startServer({ checkHealth });

    const response = await fetch(`${baseUrl}/api/health/ready`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: 'ready', checks: { sqlite: 'ok' } });
    expect(checkHealth).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when SQLite is unavailable', async () => {
    const checkHealth = jest.fn(() => { throw new Error('database unavailable'); });
    const baseUrl = await startServer({ checkHealth });

    const response = await fetch(`${baseUrl}/api/health/ready`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, status: 'not_ready', checks: { sqlite: 'unavailable' } });
  });
});
