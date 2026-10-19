import { describe, expect, it } from '@jest/globals';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { SQLiteAppStore, type StoredConversationSession } from '../sqliteStore';
import { createHarnessEvent } from '../harnessEvent';

function createStore(): SQLiteAppStore {
  const root = mkdtempSync(path.join(tmpdir(), 'react-engine-conversations-'));
  return new SQLiteAppStore(path.join(root, 'runs.sqlite'));
}

describe('Conversation Sessions persistence', () => {
  it('lists empty sessions when newly initialized', () => {
    const store = createStore();
    expect(store.listConversationSessions()).toEqual([]);
  });

  it('can upsert, get, and list conversation sessions', () => {
    const store = createStore();
    const session1: StoredConversationSession = {
      id: 'session-1',
      title: 'First Conversation',
      messages: [{ role: 'user', content: 'Hello' }],
      createdAt: 1000,
      updatedAt: 1000,
    };
    const session2: StoredConversationSession = {
      id: 'session-2',
      title: 'Second Conversation',
      messages: [{ role: 'user', content: 'Hi there' }],
      createdAt: 2000,
      updatedAt: 2500,
    };

    store.upsertConversationSession(session1);
    store.upsertConversationSession(session2);

    const retrieved1 = store.getConversationSession('session-1');
    expect(retrieved1).toEqual(session1);

    const nonExistent = store.getConversationSession('non-existent');
    expect(nonExistent).toBeNull();

    // List returns in descending order of updatedAt
    const list = store.listConversationSessions();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('session-2');
    expect(list[1].id).toBe('session-1');
  });

  it('updates an existing session with upsert', () => {
    const store = createStore();
    const initial: StoredConversationSession = {
      id: 'session-update',
      title: 'Original Title',
      messages: [{ role: 'user', content: 'Initial message' }],
      createdAt: 1000,
      updatedAt: 1000,
    };
    store.upsertConversationSession(initial);

    const updated: StoredConversationSession = {
      id: 'session-update',
      title: 'Updated Title',
      messages: [
        { role: 'user', content: 'Initial message' },
        { role: 'assistant', content: 'Response' },
      ],
      createdAt: 1000,
      updatedAt: 2000,
    };
    store.upsertConversationSession(updated);

    const result = store.getConversationSession('session-update');
    expect(result).toEqual(updated);
  });

  it('deletes a conversation session by ID', () => {
    const store = createStore();
    store.upsertConversationSession({
      id: 'session-to-delete',
      title: 'To Delete',
      messages: [],
      createdAt: 1000,
      updatedAt: 1000,
    });

    expect(store.getConversationSession('session-to-delete')).not.toBeNull();

    store.deleteConversationSession('session-to-delete');
    expect(store.getConversationSession('session-to-delete')).toBeNull();
  });

  it('clears all conversation sessions', () => {
    const store = createStore();
    store.upsertConversationSession({
      id: 's1',
      title: 'S1',
      messages: [],
      createdAt: 1000,
      updatedAt: 1000,
    });
    store.upsertConversationSession({
      id: 's2',
      title: 'S2',
      messages: [],
      createdAt: 2000,
      updatedAt: 2000,
    });

    expect(store.listConversationSessions()).toHaveLength(2);
    store.clearConversationSessions();
    expect(store.listConversationSessions()).toHaveLength(0);
  });

  it('deletes thread-linked runs, events, and audits with the conversation', () => {
    const store = createStore();
    store.upsertThread({ id: 'thread-with-history', title: 'History', messages: [], createdAt: 1, updatedAt: 1 });
    store.createAgentRun({
      id: 'thread-run-1',
      kind: 'coder',
      threadId: 'thread-with-history',
      status: 'completed',
      task: 'Build the feature',
      model: 'local-target:test',
      createdAt: 1,
      updatedAt: 2,
      lastEventSeq: 0,
    });
    store.appendAgentRunEvent({
      runId: 'thread-run-1',
      seq: 1,
      eventType: 'progress',
      event: createHarnessEvent({ runId: 'thread-run-1', seq: 1, type: 'progress', data: 'working', timestamp: 2 }),
      createdAt: 2,
    });
    store.saveRun({
      id: 'thread-audit-1',
      threadId: 'thread-with-history',
      runId: 'thread-run-1',
      task: 'Build the feature',
      model: 'local-target:test',
      timestamp: new Date(2).toISOString(),
      success: true,
      stepCount: 1,
      totalPollenCost: 0,
      budget: 100,
      steps: [],
    }, 'audit');
    store.recordProtocolAudit({
      id: 'thread-protocol-1',
      runId: 'thread-run-1',
      auditType: 'response_contract',
      provider: 'local',
      errors: ['test'],
      recoverable: false,
      rawRedacted: 'test',
    });

    const result = store.deleteThreadHistory('thread-with-history');

    expect(result).toEqual(expect.objectContaining({
      threadsDeleted: 1,
      runsDeleted: 1,
      eventsDeleted: 1,
      runAuditsDeleted: 1,
      protocolAuditsDeleted: 1,
    }));
    expect(store.getConversationSession('thread-with-history')).toBeNull();
    expect(store.getAgentRun('thread-run-1')).toBeNull();
    expect(store.listAgentRunEvents('thread-run-1')).toEqual([]);
    expect(store.getThreadDetails('thread-with-history')).toBeNull();
  });
});
