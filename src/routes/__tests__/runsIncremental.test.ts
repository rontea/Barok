import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRouter } from '../runs.js';
import { SQLiteAppStore } from '../../persistence/sqliteStore.js';
import { ServerRunManager } from '../../react/run-manager.js';
import { createApiAccessMiddleware } from '../../security/networkSecurity.js';

const servers: Server[] = [];
const stores: SQLiteAppStore[] = [];
const temporaryRoots: string[] = [];

async function waitForCompleted(manager: ServerRunManager, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (manager.getRun(runId)?.status === 'completed') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for the run to complete.');
}

describe('incremental run views', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    for (const store of stores.splice(0)) store.close();
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('bounds detail polling and exposes projection and raw evidence as separate cursored views', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'runs-incremental-'));
    temporaryRoots.push(root);
    const store = new SQLiteAppStore(path.join(root, 'runs.sqlite'));
    stores.push(store);
    const manager = new ServerRunManager(store);
    const run = manager.startRun(
      { kind: 'react', task: 'incremental run view' },
      async ({ emit }) => {
        emit('model_response', { message: 'hello', provider: 'mock', model: 'mock-model' });
        for (let index = 1; index <= 1_604; index += 1) emit('progress', `step-${index}`);
        return { success: true, steps: [], stepCount: 0, pollenCost: 0 };
      },
    );
    await waitForCompleted(manager, run.id);

    const app = express();
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
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const detail = await fetch(`${baseUrl}/api/runs/${run.id}?limit=1`).then((response) => response.json());
    expect(detail.projectionMode).toBe('summary');
    expect(detail.events).toHaveLength(1);
    expect(detail.eventCursor).toMatchObject({ nextSeq: 1, hasMore: true });
    expect(detail.projection.eventCount).toBe(1_606);
    expect(detail.projection.timeline).toEqual([]);
    expect(detail.projection.rawEvidence).toEqual([]);

    const events = await fetch(`${baseUrl}/api/runs/${run.id}/events?afterSeq=1&limit=1`).then((response) => response.json());
    expect(events.events).toHaveLength(1);
    expect(events.events[0].seq).toBe(2);
    expect(events.cursor).toMatchObject({ afterSeq: 1, nextSeq: 2, hasMore: true });

    const projection = await fetch(`${baseUrl}/api/runs/${run.id}/projection?afterSeq=1&limit=1`).then((response) => response.json());
    expect(projection.projectionMode).toBe('delta');
    expect(projection.projection.eventCount).toBe(1);
    expect(projection.projection.lastSeq).toBe(2);

    const evidence = await fetch(`${baseUrl}/api/runs/${run.id}/evidence?limit=10`).then((response) => response.json());
    expect(evidence.rawEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'model_response', kind: 'provider' }),
    ]));
  });

  it('serves a development prompt reconstruction from bounded in-memory data only', async () => {
    const priorNodeEnv = process.env.NODE_ENV;
    const priorApiToken = process.env.SERVER_API_TOKEN;
    process.env.NODE_ENV = 'development';
    process.env.SERVER_API_TOKEN = 'context-snapshot-test-token';

    const root = mkdtempSync(path.join(tmpdir(), 'runs-context-snapshot-'));
    temporaryRoots.push(root);
    const store = new SQLiteAppStore(path.join(root, 'runs.sqlite'));
    stores.push(store);
    const manager = new ServerRunManager(store);
    const run = manager.startRun(
      { kind: 'react', task: 'snapshot prompt context' },
      async () => ({ success: true, steps: [], stepCount: 0, pollenCost: 0 }),
    );
    const snapshot = {
      stepSeq: 2,
      exactRequest: false,
      systemPrompt: 'Safe system instructions',
      userPrompt: 'Task: snapshot prompt context',
      promptText: '[SYSTEM]\nSafe system instructions\n\n[USER]\nTask: snapshot prompt context',
      categoryTokens: { task: 8, plan: 0, evidence: 0, activeErrors: 0, memory: 0, history: 0, system: 30 },
    };
    manager.recordPlannerContextSnapshot(run.id, 2, snapshot);

    const app = express();
    app.use('/api', createApiAccessMiddleware({ apiToken: process.env.SERVER_API_TOKEN }));
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
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      process.env.NODE_ENV = 'production';
      const productionResponse = await fetch(`${baseUrl}/api/runs/${run.id}/context-snapshot?seq=2`, {
        headers: { 'X-API-Token': 'context-snapshot-test-token' },
      });
      expect(productionResponse.status).toBe(404);

      process.env.NODE_ENV = 'development';
      const response = await fetch(`${baseUrl}/api/runs/${run.id}/context-snapshot?seq=2`, {
        headers: { 'X-API-Token': 'context-snapshot-test-token' },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(await response.json()).toMatchObject({ runId: run.id, ...snapshot });
      expect(store.getAgentRunContextSnapshot(run.id)).toBeNull();
      expect(manager.listEvents(run.id).some((event) => JSON.stringify(event.event).includes('Safe system instructions'))).toBe(false);
    } finally {
      if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv;
      if (priorApiToken === undefined) delete process.env.SERVER_API_TOKEN; else process.env.SERVER_API_TOKEN = priorApiToken;
    }
  });
});
