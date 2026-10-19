import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { recordProviderFailure, resetProviderRateLimitMonitor } from '../../di/providers/rateLimitMonitor.js';
import { SQLiteAppStore } from '../../persistence/sqliteStore.js';
import { ServerRunManager } from '../../react/run-manager.js';
import { createRouter } from '../runs.js';

const servers: Server[] = [];
const stores: SQLiteAppStore[] = [];
const temporaryRoots: string[] = [];

describe('run provider preflight', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    for (const store of stores.splice(0)) store.close();
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
    resetProviderRateLimitMonitor();
  });

  it('rejects a definitively cooling provider route before creating a run record', async () => {
    resetProviderRateLimitMonitor();
    const model = 'openrouter:openai/gpt-4o-mini';
    recordProviderFailure('openrouter', model, 'HTTP 429 rate limit; retry after 600 seconds');

    const root = mkdtempSync(path.join(tmpdir(), 'runs-provider-preflight-'));
    temporaryRoots.push(root);
    const store = new SQLiteAppStore(path.join(root, 'runs.sqlite'));
    stores.push(store);
    const manager = new ServerRunManager(store);
    const app = express();
    app.use(express.json());
    app.use(createRouter({
      runManager: manager,
      ensureWorkspaceRoot: async (workspace) => workspace || root,
      getRepositoryCommitHash: async () => 'test-commit',
    }));
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP address.');

    const response = await fetch(`http://127.0.0.1:${address.port}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'start only if the selected provider route is available', model }),
    });

    expect(response.status).toBe(424);
    expect(await response.json()).toMatchObject({
      preflight: {
        code: 'PROVIDER_ROUTE_UNAVAILABLE',
        source: 'cached_route_state',
        route: { provider: 'openrouter', model },
      },
    });
    expect(manager.listRuns()).toHaveLength(0);
  });
});
