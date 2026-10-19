import { describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  createHarnessEvent,
  HARNESS_EVENT_SCHEMA_VERSION,
  HarnessEventValidationError,
  isKnownHarnessEventType,
  isHarnessEvent,
  normalizeHarnessEvent,
} from '../harnessEvent';
import { SQLiteAppStore } from '../sqliteStore';

function createStore(): { store: SQLiteAppStore; root: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'harness-events-'));
  return { root, store: new SQLiteAppStore(path.join(root, 'events.sqlite')) };
}

describe('harness event contract', () => {
  it('creates a stable, versioned JSON event envelope', () => {
    const event = createHarnessEvent({
      runId: 'run-1',
      seq: 3,
      type: 'tool_result',
      data: { tool: 'Read', success: true, output: 'ok' },
      timestamp: 123,
    });

    expect(event).toEqual({
      schemaVersion: HARNESS_EVENT_SCHEMA_VERSION,
      eventId: 'run-1:3',
      runId: 'run-1',
      sessionId: 'run-1',
      seq: 3,
      type: 'tool_result',
      data: { tool: 'Read', success: true, output: 'ok' },
      timestamp: 123,
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.data)).toBe(true);
    expect(isHarnessEvent(event)).toBe(true);
  });

  it('normalizes legacy transport-shaped events without losing their payload', () => {
    const event = normalizeHarnessEvent({
      runId: 'legacy-run',
      seq: 1,
      type: 'progress',
      data: 'legacy payload',
      timestamp: 456,
    }, {
      runId: 'legacy-run',
      seq: 1,
      type: 'progress',
      timestamp: 456,
    });

    expect(event).toMatchObject({
      schemaVersion: 1,
      eventId: 'legacy-run:1',
      runId: 'legacy-run',
      seq: 1,
      type: 'progress',
      data: 'legacy payload',
    });
  });

  it('rejects unsafe payloads and unsupported event schemas', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => createHarnessEvent({
      runId: 'run-1', seq: 1, type: 'progress', data: cyclic, timestamp: 1,
    })).toThrow(HarnessEventValidationError);

    expect(() => normalizeHarnessEvent({
      schemaVersion: 99,
      runId: 'run-1',
      seq: 1,
      type: 'progress',
      data: null,
      timestamp: 1,
    }, {
      runId: 'run-1', seq: 1, type: 'progress', timestamp: 1,
    })).toThrow(/Unsupported harness event schema version/);

    expect(isHarnessEvent({
      schemaVersion: 1,
      eventId: 'run-1:1',
      runId: 'run-1',
      seq: 1,
      type: 'progress',
      timestamp: 1,
    })).toBe(false);
  });

  it('guards known payloads while preserving or rejecting unknown event types by policy', () => {
    expect(isKnownHarnessEventType('tool_result')).toBe(true);
    expect(isKnownHarnessEventType('future.event')).toBe(false);
    expect(() => createHarnessEvent({
      runId: 'run-1', seq: 1, type: 'tool_started', data: { input: {} }, timestamp: 1,
    })).toThrow(/requires a non-empty tool/);
    expect(createHarnessEvent({
      runId: 'run-1', seq: 2, type: 'future.event', data: { opaque: true }, timestamp: 2,
    }).type).toBe('future.event');
    expect(() => createHarnessEvent({
      runId: 'run-1', seq: 3, type: 'future.event', data: { opaque: true }, timestamp: 3, unknownEventPolicy: 'reject',
    })).toThrow(/Unknown harness event type/);
  });

  it('persists and replays the versioned envelope through the existing event table', () => {
    const { store, root } = createStore();
    try {
      store.createAgentRun({
        id: 'run-1',
        kind: 'react',
        status: 'running',
        task: 'event contract',
        createdAt: 1,
        updatedAt: 1,
        lastEventSeq: 0,
      });

      store.appendAgentRunEvent({
        runId: 'run-1',
        seq: 1,
        eventType: 'progress',
        event: { runId: 'run-1', seq: 1, type: 'progress', data: { ok: true }, timestamp: 2 },
        createdAt: 2,
      });

      const [event] = store.listAgentRunEvents('run-1');
      expect(event.event).toMatchObject({
        schemaVersion: 1,
        eventId: 'run-1:1',
        type: 'progress',
        data: { ok: true },
      });
      expect(store.getAgentRun('run-1')?.lastEventSeq).toBe(1);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns bounded event pages with a resumable cursor', () => {
    const { store, root } = createStore();
    try {
      store.createAgentRun({
        id: 'run-page',
        kind: 'react',
        status: 'running',
        task: 'event page',
        createdAt: 1,
        updatedAt: 1,
        lastEventSeq: 0,
      });
      for (let seq = 1; seq <= 5; seq += 1) {
        store.appendAgentRunEvent({
          runId: 'run-page',
          seq,
          eventType: 'progress',
          event: createHarnessEvent({ runId: 'run-page', seq, type: 'progress', data: `step-${seq}`, timestamp: seq }),
          createdAt: seq,
        });
      }

      const first = store.listAgentRunEventPage('run-page', 0, 2);
      expect(first.events.map((event) => event.seq)).toEqual([1, 2]);
      expect(first).toMatchObject({ afterSeq: 0, nextSeq: 2, lastSeq: 5, hasMore: true });

      const second = store.listAgentRunEventPage('run-page', first.nextSeq, 2);
      expect(second.events.map((event) => event.seq)).toEqual([3, 4]);
      expect(second).toMatchObject({ afterSeq: 2, nextSeq: 4, lastSeq: 5, hasMore: true });

      const final = store.listAgentRunEventPage('run-page', second.nextSeq, 2);
      expect(final.events.map((event) => event.seq)).toEqual([5]);
      expect(final).toMatchObject({ afterSeq: 4, nextSeq: 5, lastSeq: 5, hasMore: false });

      const exhausted = store.listAgentRunEventPage('run-page', 99, 2);
      expect(exhausted).toMatchObject({ afterSeq: 99, nextSeq: 99, lastSeq: 5, hasMore: false });
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects an event whose payload identity disagrees with its storage row', () => {
    const { store, root } = createStore();
    try {
      store.createAgentRun({
        id: 'run-1',
        kind: 'react',
        status: 'running',
        task: 'event identity',
        createdAt: 1,
        updatedAt: 1,
        lastEventSeq: 0,
      });

      expect(() => store.appendAgentRunEvent({
        runId: 'run-1',
        seq: 1,
        eventType: 'progress',
        event: { runId: 'other-run', seq: 1, type: 'progress', data: null, timestamp: 2 },
        createdAt: 2,
      })).toThrow(/does not match its SQLite row/);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rolls back the event when the atomic run projection cannot be serialized', () => {
    const { store, root } = createStore();
    try {
      store.createAgentRun({
        id: 'run-atomic', kind: 'react', status: 'running', task: 'atomic projection', createdAt: 1, updatedAt: 1, lastEventSeq: 0,
      });
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      expect(() => store.appendAgentRunEvent({
        runId: 'run-atomic', seq: 1, eventType: 'progress',
        event: { runId: 'run-atomic', seq: 1, type: 'progress', data: 'checkpointing', timestamp: 2 }, createdAt: 2,
      }, { metadata: cyclic })).toThrow();
      expect(store.listAgentRunEvents('run-atomic')).toHaveLength(0);
      expect(store.getAgentRun('run-atomic')?.lastEventSeq).toBe(0);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
