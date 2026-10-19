import { describe, expect, it } from '@jest/globals';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  AgentInboxConflictError,
  SQLiteAppStore,
  type StoredAgentRun,
} from '../sqliteStore';

function createStore(): SQLiteAppStore {
  const root = mkdtempSync(path.join(tmpdir(), 'react-engine-inbox-'));
  return new SQLiteAppStore(path.join(root, 'runs.sqlite'));
}

function createRun(store: SQLiteAppStore, id: string, metadata: Record<string, unknown> = {}): StoredAgentRun {
  const now = Date.now();
  const run: StoredAgentRun = {
    id,
    kind: 'react',
    status: 'running',
    task: 'test inbox',
    metadata,
    createdAt: now,
    updatedAt: now,
    lastEventSeq: 0,
  };
  store.createAgentRun(run);
  return run;
}

describe('durable run inbox', () => {
  it('allocates FIFO sequence numbers and rejects duplicate pending IDs', () => {
    const store = createStore();
    createRun(store, 'run-1');

    const first = store.enqueueAgentInbox({
      runId: 'run-1', messageId: 'message-1', source: 'follow_up', target: 'next-turn', message: 'first', createdAt: 10,
    });
    const second = store.enqueueAgentInbox({
      runId: 'run-1', messageId: 'message-2', source: 'steering', target: 'next-step', message: 'second', createdAt: 20,
    });

    expect(first.inboxSeq).toBe(1);
    expect(second.inboxSeq).toBe(2);
    expect(store.listAgentRunInbox('run-1')).toEqual([first, second]);
    expect(() => store.enqueueAgentInbox({
      runId: 'run-1', messageId: 'message-1', source: 'follow_up', target: 'next-turn', message: 'retry',
    })).toThrow(AgentInboxConflictError);
  });

  it('migrates legacy queued metadata into the inbox once', () => {
    const store = createStore();
    createRun(store, 'legacy-run', {
      queuedMessages: [{ id: 'legacy-message', message: 'preserve me', queuedAt: 42, source: 'legacy-ui' }],
      queuedMessageCount: 1,
      other: 'metadata',
    });

    const entries = store.listAgentRunInbox('legacy-run');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      messageId: 'legacy-message',
      message: 'preserve me',
      source: 'legacy-ui',
      target: 'next-turn',
      status: 'pending',
      createdAt: 42,
    });
    expect(store.getAgentRun('legacy-run')?.metadata).toEqual(expect.objectContaining({
      other: 'metadata',
      queuedMessageCount: 1,
      inboxPendingCount: 1,
    }));
    expect(store.getAgentRun('legacy-run')?.metadata).not.toHaveProperty('queuedMessages');
  });

  it('claims next-step batches and one next-turn item idempotently', () => {
    const store = createStore();
    createRun(store, 'run-2');
    store.enqueueAgentInbox({ runId: 'run-2', messageId: 'turn-1', source: 'follow_up', target: 'next-turn', message: 'turn' });
    store.enqueueAgentInbox({ runId: 'run-2', messageId: 'step-1', source: 'steering', target: 'next-step', message: 'step one' });
    store.enqueueAgentInbox({ runId: 'run-2', messageId: 'step-2', source: 'harness', target: 'next-step', message: 'step two' });

    const steps = store.claimAgentRunInbox('run-2', 'next-step', 'boundary-1', 20);
    expect(steps.map((entry) => entry.messageId)).toEqual(['step-1', 'step-2']);
    expect(store.claimAgentRunInbox('run-2', 'next-step', 'boundary-1', 20)).toEqual(steps);
    const turns = store.claimAgentRunInbox('run-2', 'next-turn', 'boundary-1', 1);
    expect(turns.map((entry) => entry.messageId)).toEqual(['turn-1']);
    expect(store.listAgentRunInbox('run-2', { status: 'claimed' })).toHaveLength(3);
  });

  it('supports acknowledgement, replacement, cancellation, release, and continuation copy', () => {
    const store = createStore();
    createRun(store, 'parent');
    createRun(store, 'child');
    store.enqueueAgentInbox({ runId: 'parent', messageId: 'pending', source: 'follow_up', target: 'next-turn', message: 'pending' });
    store.enqueueAgentInbox({ runId: 'parent', messageId: 'claimed', source: 'steering', target: 'next-step', message: 'claimed' });
    store.enqueueAgentInbox({ runId: 'parent', messageId: 'cancelled', source: 'follow_up', target: 'next-turn', message: 'cancel me' });

    store.claimAgentRunInbox('parent', 'next-step', 'claim-1');
    expect(store.processAgentRunInboxEntry('parent', 'claimed', 'wrong-claim')).toBeNull();
    expect(store.processAgentRunInboxEntry('parent', 'claimed', 'claim-1')?.status).toBe('processed');
    expect(store.processAgentRunInboxEntry('parent', 'claimed', 'claim-1')?.status).toBe('processed');
    expect(store.replaceAgentRunInboxEntry('parent', 'pending', { message: 'replaced' })?.message).toBe('replaced');
    expect(store.cancelAgentRunInboxEntry('parent', 'cancelled')?.status).toBe('cancelled');
    expect(store.cancelAgentRunInboxEntry('parent', 'cancelled')?.status).toBe('cancelled');

    store.claimAgentRunInbox('parent', 'next-turn', 'claim-2', 1);
    store.releaseAgentRunInboxClaims('parent');
    expect(store.getAgentRunInboxEntry('parent', 'pending')?.status).toBe('pending');

    const copied = store.copyPendingAgentInbox('parent', 'child');
    expect(copied.map((entry) => entry.messageId)).toEqual(['pending']);
    expect(store.getAgentRunInboxEntry('child', 'pending')?.status).toBe('pending');
    expect(store.clearAgentRunInbox('child')).toHaveLength(1);
    expect(store.clearAgentRunInbox('child')).toEqual([]);
  });
});
