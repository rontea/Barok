import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from '@jest/globals';
import { SQLiteAppStore } from '../sqliteStore.js';
import { DURABLE_CONTEXT_SNAPSHOT_VERSION, type StoredAgentContextSnapshot } from '../contextSnapshot.js';

function createRun(store: SQLiteAppStore, runId: string): void {
  const now = Date.now();
  store.createAgentRun({
    id: runId,
    kind: 'react',
    status: 'running',
    task: 'persist context',
    workspace: process.cwd(),
    model: 'model-a',
    createdAt: now,
    updatedAt: now,
    lastEventSeq: 0,
  });
}

function snapshot(runId: string, eventSeq = 1): StoredAgentContextSnapshot {
  const now = Date.now();
  return {
    version: DURABLE_CONTEXT_SNAPSHOT_VERSION,
    runId,
    contextId: `${runId}:context`,
    revision: 1,
    eventSeq,
    model: 'model-a',
    modelContextWindow: 32_000,
    tokenEstimate: 24,
    compactionVersion: 'test-v1',
    messages: [
      { id: 'task', role: 'user', content: 'persist context', sourceEventSeq: eventSeq },
      { id: 'result', role: 'tool', content: 'read completed', toolName: 'Read', sourceEventSeq: eventSeq },
    ],
    evidenceIds: ['evidence-1'],
    createdAt: now,
    updatedAt: now,
  };
}

describe('durable context snapshots', () => {
  it('persists a snapshot atomically with its harness event and reloads it', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'react-context-snapshot-'));
    const store = new SQLiteAppStore(path.join(root, 'runs.sqlite'));
    const runId = randomUUID();
    try {
      createRun(store, runId);
      const context = snapshot(runId);
      store.appendAgentRunEvent({
        runId,
        seq: 1,
        eventType: 'progress',
        event: { type: 'progress', message: 'checkpointed' },
        createdAt: context.updatedAt,
      }, { contextSnapshot: context });

      expect(store.getAgentRunContextSnapshot(runId)).toEqual(context);
      expect(store.getAgentRun(runId)?.lastEventSeq).toBe(1);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects snapshots for unknown runs without leaving a partial row', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'react-context-snapshot-invalid-'));
    const store = new SQLiteAppStore(path.join(root, 'runs.sqlite'));
    try {
      expect(() => store.upsertAgentRunContextSnapshot(snapshot('missing-run'))).toThrow('unknown run');
      expect(store.getAgentRunContextSnapshot('missing-run')).toBeNull();
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
