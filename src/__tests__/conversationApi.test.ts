import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import type { Server } from 'http';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { SQLiteAppStore } from '../persistence/sqliteStore';
import { createRouter as createCoderRouter, migrateLegacyCoderThreads } from '../routes/coder';

describe('Conversation Persistence API Endpoints', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;
  let store: SQLiteAppStore;

  beforeAll(async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'react-engine-convo-api-'));
    store = new SQLiteAppStore(path.join(root, 'runs.sqlite'));

    app = express();
    app.use(express.json());
    app.use(createCoderRouter({
      store,
      runManager: { getRun: () => undefined, listEvents: () => [] } as any,
      purgeThreadHistory: async (threadId) => {
        if (threadId) store.deleteThread(threadId);
        else store.clearThreads();
        return { threadsDeleted: threadId ? 1 : 0 };
      },
    }));

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('GET /api/conversations returns empty sessions list initially', async () => {
    const res = await fetch(`${baseUrl}/api/conversations`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ sessions: [], page: { limit: 50, hasMore: false, nextCursor: null } });
  });

  it('GET /api/conversations/:id returns 404 for unknown session', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/unknown-id`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Conversation session not found.');
  });

  it('PUT /api/conversations/:id creates a new session', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/test-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Project Architecture Discussion',
        messages: [
          { role: 'user', content: 'What is the design?' },
          { role: 'assistant', content: 'Here is the design...' },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.id).toBe('test-1');
    expect(body.session.title).toBe('Project Architecture Discussion');
    expect(body.session.messageCount).toBe(2);
    expect(body.session.messages).toBeUndefined();
    expect(typeof body.session.createdAt).toBe('number');
    expect(typeof body.session.updatedAt).toBe('number');
  });

  it('GET /api/conversations/:id retrieves an existing session', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/test-1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.id).toBe('test-1');
    expect(body.session.title).toBe('Project Architecture Discussion');
  });

  it('GET /api/conversations returns all saved sessions', async () => {
    const res = await fetch(`${baseUrl}/api/conversations`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].id).toBe('test-1');
    expect(body.sessions[0].messages).toBeUndefined();
    expect(body.page.hasMore).toBe(false);
  });

  it('PUT /api/conversations/:id caps message history at 200 items and returns only its summary', async () => {
    const excessMessages = Array.from({ length: 250 }, (_, i) => ({
      role: 'user',
      content: `Message ${i}`,
    }));

    const res = await fetch(`${baseUrl}/api/conversations/test-large`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Large thread',
        messages: excessMessages,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.messageCount).toBe(200);
    expect(body.session.messages).toBeUndefined();

    const detailRes = await fetch(`${baseUrl}/api/conversations/test-large?limit=200`);
    const detailBody = await detailRes.json();
    expect(detailBody.session.messages).toHaveLength(100);
    // Page limits cap at 100; the newest messages are returned first.
    expect(detailBody.session.messages[0].content).toBe('Message 150');
    expect(detailBody.session.messages[99].content).toBe('Message 249');
    expect(detailBody.page.hasMore).toBe(true);
  });

  it('DELETE /api/conversations/:id removes a session', async () => {
    const delRes = await fetch(`${baseUrl}/api/conversations/test-1`, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(200);
    const delBody = await delRes.json();
    expect(delBody.success).toBe(true);

    const getRes = await fetch(`${baseUrl}/api/conversations/test-1`);
    expect(getRes.status).toBe(404);
  });

  it('returns compact paginated coder thread summaries and bounded message detail pages', async () => {
    const messages = Array.from({ length: 120 }, (_, index) => ({
      id: `large-${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${index} ${'x'.repeat(9_000)}`,
      createdAt: index + 1,
      ...(index === 119 ? { images: [{ id: 'image-1', name: 'screen.png', mimeType: 'image/png', url: `data:image/png;base64,${'A'.repeat(20_000)}` }] } : {}),
    }));
    store.upsertThread({
      id: 'large-coder-thread',
      title: 'Large coder thread',
      messages,
      createdAt: 1,
      updatedAt: Date.now() + 10_000,
    });

    const listRes = await fetch(`${baseUrl}/api/coder/threads?limit=1`);
    expect(listRes.status).toBe(200);
    const listText = await listRes.text();
    const listBody = JSON.parse(listText);
    expect(Buffer.byteLength(listText, 'utf8')).toBeLessThan(64 * 1024);
    expect(listBody.threads[0].id).toBe('large-coder-thread');
    expect(listBody.threads[0].messageCount).toBe(120);
    expect(listBody.threads[0].messages).toBeUndefined();
    expect(listBody.page.nextCursor).toEqual(expect.any(String));

    const firstRes = await fetch(`${baseUrl}/api/coder/threads/large-coder-thread?limit=10`);
    const firstText = await firstRes.text();
    const firstBody = JSON.parse(firstText);
    expect(Buffer.byteLength(firstText, 'utf8')).toBeLessThanOrEqual(256 * 1024);
    expect(firstBody.thread.messages).toHaveLength(10);
    expect(firstBody.thread.messages[0].id).toBe('large-110');
    expect(firstBody.thread.messages[9].id).toBe('large-119');
    expect(firstBody.thread.messages[0].content.length).toBeLessThanOrEqual(6_000);
    expect(firstText).not.toContain('data:image/png;base64');
    expect(firstBody.thread.messages[9].images[0]).toEqual({
      id: 'image-1',
      name: 'screen.png',
      mimeType: 'image/png',
    });
    expect((store.getThread('large-coder-thread')?.messages[119] as any).images[0].url).toContain('data:image/png;base64');

    const nextRes = await fetch(`${baseUrl}/api/coder/threads/large-coder-thread?limit=10&cursor=${encodeURIComponent(firstBody.page.nextCursor)}`);
    const nextBody = await nextRes.json();
    expect(nextBody.thread.messages[0].id).toBe('large-100');
    expect(nextBody.thread.messages[9].id).toBe('large-109');
    expect(nextBody.page.hasMore).toBe(true);

    const maxPageRes = await fetch(`${baseUrl}/api/coder/threads/large-coder-thread?limit=100`);
    const maxPageText = await maxPageRes.text();
    const maxPageBody = JSON.parse(maxPageText);
    expect(Buffer.byteLength(maxPageText, 'utf8')).toBeLessThanOrEqual(256 * 1024);
    expect(maxPageBody.thread.messages.length).toBeLessThan(100);
    expect(maxPageBody.page.hasMore).toBe(true);
  });

  it('returns the updated coder thread and memory summaries after upsert', async () => {
    const updatedAt = Date.now();
    const threadRes = await fetch(`${baseUrl}/api/coder/threads/returned-thread`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated thread', messages: [], createdAt: 10, updatedAt }),
    });
    expect(threadRes.status).toBe(200);
    expect(await threadRes.json()).toEqual({
      success: true,
      thread: { id: 'returned-thread', title: 'Updated thread', updatedAt },
    });

    const memoryRes = await fetch(`${baseUrl}/api/memory/returned-memory`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'thread', content: 'remember this', createdAt: 11, updatedAt }),
    });
    expect(memoryRes.status).toBe(200);
    expect(await memoryRes.json()).toEqual({
      success: true,
      memory: {
        id: 'returned-memory',
        scope: 'thread',
        content: 'remember this',
        createdAt: 11,
        updatedAt,
      },
    });
  });

  it('keeps thread hydration reads write-free and migrates legacy payloads once at startup', async () => {
    store.upsertThread({
      id: 'legacy-thread',
      title: 'Legacy thread',
      messages: [{ role: 'assistant', content: 'legacy', images: [{ url: `data:image/png;base64,${'A'.repeat(32)}` }] }],
      createdAt: 1,
      updatedAt: 2,
    });
    const upsertSpy = jest.spyOn(store, 'upsertThread');

    const read = await fetch(`${baseUrl}/api/coder/threads/legacy-thread`);
    expect(read.status).toBe(200);
    expect(upsertSpy).not.toHaveBeenCalled();
    expect((store.getThread('legacy-thread')?.messages[0] as any).images[0].url).toContain('data:image/png;base64');

    const runManager = { listEvents: () => [], getRun: () => undefined } as any;
    await expect(migrateLegacyCoderThreads(runManager, store)).resolves.toEqual({ threadsScanned: 4, threadsUpdated: 2 });
    const migrated = store.getThread('legacy-thread')?.messages[0] as any;
    expect(migrated.images[0]).toMatchObject({ name: 'Attached image', mimeType: 'image/png' });
    expect(migrated.images[0].url).toBeUndefined();
    await expect(migrateLegacyCoderThreads(runManager, store)).resolves.toEqual({ threadsScanned: 4, threadsUpdated: 0 });
    upsertSpy.mockRestore();
  });

  it('paginates conversation summaries and rejects a cursor from a different session', async () => {
    store.upsertConversationSession({
      id: 'cursor-session-a', title: 'Cursor session A', messages: [{ role: 'user', content: 'A' }], createdAt: 1, updatedAt: Date.now() + 60_000,
    });
    store.upsertConversationSession({
      id: 'cursor-session-b', title: 'Cursor session B', messages: [{ role: 'user', content: 'B' }], createdAt: 1, updatedAt: Date.now() + 50_000,
    });

    const firstRes = await fetch(`${baseUrl}/api/conversations?limit=1`);
    const firstBody = await firstRes.json();
    expect(firstBody.sessions).toHaveLength(1);
    expect(firstBody.sessions[0].id).toBe('cursor-session-a');
    expect(firstBody.sessions[0].messages).toBeUndefined();
    expect(firstBody.page.nextCursor).toEqual(expect.any(String));

    const nextRes = await fetch(`${baseUrl}/api/conversations?limit=1&cursor=${encodeURIComponent(firstBody.page.nextCursor)}`);
    const nextBody = await nextRes.json();
    expect(nextBody.sessions[0].id).toBe('cursor-session-b');

    const wrongThreadCursor = Buffer.from(JSON.stringify({ threadId: 'other-session', beforeIndex: 0 })).toString('base64url');
    const detailRes = await fetch(`${baseUrl}/api/conversations/cursor-session-a?cursor=${wrongThreadCursor}`);
    expect(detailRes.status).toBe(400);
  });
});
