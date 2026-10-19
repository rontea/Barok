import { Router } from 'express';
import {
  clearCoderThreadArtifacts,
  coderTimelineEventsFromRunEvents,
  deleteCoderThreadArtifact,
  loadCoderThreadArtifact,
  saveCoderThreadArtifact,
} from '../persistence/coderThreadArtifacts.js';
import { getSQLiteAppStore } from '../persistence/sqliteStore.js';
import type { SQLiteAppStore } from '../persistence/sqliteStore.js';
import type { ServerRunManager } from '../react/run-manager.js';
import { sanitizeCoderThreadTitle } from '../utils/coderThreadTitle.js';
import { sanitizeError } from './_shared.js';
import {
  boundThreadSummaryPage,
  createThreadMessagePage,
  createThreadSummary,
  parsePageLimit,
  parseThreadListCursor,
  parseThreadMessageCursor,
  THREAD_LIST_DEFAULT_LIMIT,
  THREAD_LIST_MAX_LIMIT,
  THREAD_MESSAGES_DEFAULT_LIMIT,
  THREAD_MESSAGES_MAX_LIMIT,
} from './threadPagination.js';

type CoderThreadMessageRecord = Record<string, unknown>;

interface CoderRouterDependencies {
  runManager: ServerRunManager;
  purgeThreadHistory: (threadId?: string) => Promise<unknown>;
  store?: SQLiteAppStore;
}

const isCoderThreadRecord = (value: unknown): value is CoderThreadMessageRecord =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const compactCoderThreadMessage = (message: unknown): CoderThreadMessageRecord => {
  if (!isCoderThreadRecord(message)) return {};
  const content = typeof message.content === 'string' ? message.content : '';
  const compact: CoderThreadMessageRecord = {
    id: typeof message.id === 'string' ? message.id : undefined,
    role: typeof message.role === 'string' ? message.role : 'assistant',
    content: content
      .replace(/!\[(.*?)\]\(data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+\)/g, '[image omitted]')
      .replace(/data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+/g, '[image omitted]'),
    ...(typeof message.status === 'string' ? { status: message.status } : {}),
    ...(typeof message.reasoningSummary === 'string' && message.reasoningSummary.trim()
      ? { reasoningSummary: message.reasoningSummary.trim().slice(0, 600) }
      : {}),
    ...(typeof message.runId === 'string' ? { runId: message.runId } : {}),
    ...(Number.isFinite(message.createdAt) ? { createdAt: Number(message.createdAt) } : {}),
    ...(Array.isArray(message.filesChanged)
      ? { filesChanged: message.filesChanged.filter((file): file is string => typeof file === 'string').slice(0, 100) }
      : {}),
  };
  if (Array.isArray(message.images)) {
    const images = message.images
      .filter(isCoderThreadRecord)
      .map((image) => ({
        id: typeof image.id === 'string' ? image.id : undefined,
        name: typeof image.name === 'string' ? image.name : 'Attached image',
        ...(Number.isFinite(image.size) ? { size: Number(image.size) } : {}),
        mimeType: typeof image.mimeType === 'string' ? image.mimeType : 'image/png',
      }));
    if (images.length > 0) compact.images = images;
  }
  return compact;
};

const compactCoderThreadMessages = (messages: unknown[]): CoderThreadMessageRecord[] =>
  messages.map(compactCoderThreadMessage);

const coderThreadTimelineKey = (message: CoderThreadMessageRecord, index: number): string =>
  typeof message.runId === 'string' && message.runId.trim()
    ? message.runId
    : typeof message.id === 'string' && message.id.trim()
      ? message.id
      : `message-${index}`;

/**
 * One-time startup migration for legacy thread rows that kept agent timelines
 * and image payloads inline. HTTP reads stay read-only after this migration.
 */
export async function migrateLegacyCoderThreads(
  runManager: ServerRunManager,
  store: SQLiteAppStore = getSQLiteAppStore(),
): Promise<{ threadsScanned: number; threadsUpdated: number }> {
  const threads = store.listThreads();
  let threadsUpdated = 0;

  for (const thread of threads) {
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    const artifact = await loadCoderThreadArtifact(thread.id);
    const timelines = { ...(artifact?.timelines || {}) };
    let artifactChanged = false;

    messages.forEach((candidate: unknown, index: number) => {
      if (!isCoderThreadRecord(candidate)) return;
      const key = coderThreadTimelineKey(candidate, index);
      const existing = timelines[key];
      if (existing && Array.isArray(existing.events) && existing.events.length > 0) return;

      let events = Array.isArray(candidate.agentEvents) ? candidate.agentEvents : [];
      const runId = typeof candidate.runId === 'string' ? candidate.runId.trim() : '';
      if (events.length === 0 && runId) {
        events = coderTimelineEventsFromRunEvents(runManager.listEvents(runId));
      }
      if (events.length === 0) return;
      timelines[key] = { events, updatedAt: Date.now() };
      artifactChanged = true;
    });

    const compactMessages = compactCoderThreadMessages(messages);
    const rowChanged = JSON.stringify(compactMessages) !== JSON.stringify(messages);
    if (!artifactChanged && !rowChanged) continue;
    if (artifactChanged) await saveCoderThreadArtifact(thread.id, timelines);
    if (rowChanged) {
      store.upsertThread({
        ...thread,
        messages: compactMessages,
      });
    }
    threadsUpdated += 1;
  }

  return { threadsScanned: threads.length, threadsUpdated };
}

export function createRouter({ runManager, purgeThreadHistory, store: injectedStore }: CoderRouterDependencies) {
  const router = Router();
  const store = injectedStore || getSQLiteAppStore();

  const isTerminalCoderRun = (runId: string): boolean => {
    const status = runManager.getRun(runId)?.status;
    return status === 'completed' || status === 'failed' || status === 'stopped'
      || status === 'interrupted' || status === 'killed';
  };

  const archiveCoderThreadTimelines = async (
    threadId: string,
    messages: unknown[],
    includeActiveRuns = false,
  ): Promise<boolean> => {
    const existing = await loadCoderThreadArtifact(threadId);
    const timelines = { ...(existing?.timelines || {}) };
    let changed = false;

    messages.forEach((candidate, index) => {
      if (!isCoderThreadRecord(candidate)) return;
      const runId = typeof candidate.runId === 'string' && candidate.runId.trim()
        ? candidate.runId.trim()
        : undefined;
      const key = coderThreadTimelineKey(candidate, index);
      let events: unknown[] = [];
      if (runId && (includeActiveRuns || isTerminalCoderRun(runId))) {
        events = coderTimelineEventsFromRunEvents(runManager.listEvents(runId));
      }
      if (events.length === 0 && Array.isArray(candidate.agentEvents)) {
        events = candidate.agentEvents;
      }
      if (events.length > 0) {
        timelines[key] = { events, updatedAt: Date.now() };
        changed = true;
      }
    });

    if (changed) await saveCoderThreadArtifact(threadId, timelines);
    return changed;
  };

  const hydrateCoderThread = async (thread: any): Promise<any> => {
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    const artifact = await loadCoderThreadArtifact(String(thread.id));
    const hydratedMessages = messages.map((candidate: unknown, index: number) => {
      if (!isCoderThreadRecord(candidate)) return candidate;
      const timeline = artifact?.timelines[coderThreadTimelineKey(candidate, index)];
      if (timeline && Array.isArray(timeline.events) && timeline.events.length > 0) {
        return { ...candidate, agentEvents: timeline.events };
      }
      if (Array.isArray(candidate.agentEvents) && candidate.agentEvents.length > 0) {
        return candidate;
      }
      const runId = typeof candidate.runId === 'string' ? candidate.runId : '';
      if (!runId) return candidate;
      const events = coderTimelineEventsFromRunEvents(runManager.listEvents(runId));
      if (events.length === 0) return candidate;
      return { ...candidate, agentEvents: events };
    });
    return {
      ...thread,
      title: sanitizeCoderThreadTitle(thread.title, hydratedMessages),
      messages: hydratedMessages,
    };
  };

  router.get('/api/coder/threads', async (req, res) => {
    try {
      const limit = parsePageLimit(req.query.limit, THREAD_LIST_DEFAULT_LIMIT, THREAD_LIST_MAX_LIMIT);
      const cursor = parseThreadListCursor(req.query.cursor);
      if (limit === null || cursor === null) {
        return res.status(400).json({ error: 'Invalid thread pagination parameters.' });
      }
      const rows = store.listThreadSummaries(limit + 1, cursor);
      const page = boundThreadSummaryPage(rows.map((thread) => {
        const summary = createThreadSummary(thread);
        return { ...summary, title: sanitizeCoderThreadTitle(summary.title) };
      }), limit);
      return res.json({ threads: page.items, page: page.page });
    } catch (error: any) {
      return res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.get('/api/coder/threads/:id', async (req, res) => {
    try {
      const limit = parsePageLimit(req.query.limit, THREAD_MESSAGES_DEFAULT_LIMIT, THREAD_MESSAGES_MAX_LIMIT);
      const cursor = parseThreadMessageCursor(req.query.cursor, req.params.id);
      if (limit === null || cursor === null) {
        return res.status(400).json({ error: 'Invalid thread message pagination parameters.' });
      }
      const thread = store.getThread(req.params.id);
      if (!thread) return res.status(404).json({ error: 'Coder thread not found.' });
      const hydrated = await hydrateCoderThread(thread);
      return res.json(createThreadMessagePage(hydrated, limit, cursor?.beforeIndex));
    } catch (error: any) {
      return res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.put('/api/coder/threads/:id', async (req, res) => {
    try {
      const now = Date.now();
      const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
      await archiveCoderThreadTimelines(req.params.id, messages);
      const updatedThread = {
        id: req.params.id,
        title: sanitizeCoderThreadTitle(req.body?.title, messages),
        messages: compactCoderThreadMessages(messages),
        createdAt: Number(req.body?.createdAt) || now,
        updatedAt: Number(req.body?.updatedAt) || now,
      };
      store.upsertThread(updatedThread);
      res.json({
        success: true,
        thread: {
          id: updatedThread.id,
          title: updatedThread.title,
          updatedAt: updatedThread.updatedAt,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.patch('/api/coder/threads/:id/title', (req, res) => {
    try {
      const existing = store.getThread(req.params.id);
      const now = Date.now();
      const updatedThread = {
        ...(existing || {
          id: req.params.id,
          messages: [],
          createdAt: now,
        }),
        title: sanitizeCoderThreadTitle(req.body?.title, existing?.messages || []),
        updatedAt: now,
      };
      store.upsertThread(updatedThread);
      return res.json({ thread: createThreadSummary(updatedThread) });
    } catch (error: any) {
      return res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.delete('/api/coder/threads/:id', async (req, res) => {
    try {
      const result = await purgeThreadHistory(req.params.id);
      await deleteCoderThreadArtifact(req.params.id);
      res.json({ success: true, purge: result });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.delete('/api/coder/threads', async (_req, res) => {
    try {
      const result = await purgeThreadHistory();
      await clearCoderThreadArtifacts();
      res.json({ success: true, purge: result });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.get('/api/memory', (req, res) => {
    try {
      const scope = req.query.scope ? String(req.query.scope) : 'global';
      const limit = req.query.limit ? Number.parseInt(String(req.query.limit), 10) : 50;
      res.json({ memories: store.listMemories(scope, Number.isFinite(limit) ? limit : 50) });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.put('/api/memory/:id', (req, res) => {
    try {
      const now = Date.now();
      const updatedMemory = {
        id: req.params.id,
        scope: String(req.body?.scope || 'global'),
        content: String(req.body?.content || ''),
        metadata: req.body?.metadata,
        createdAt: Number(req.body?.createdAt) || now,
        updatedAt: Number(req.body?.updatedAt) || now,
      };
      store.upsertMemory(updatedMemory);
      res.json({ success: true, memory: updatedMemory });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.delete('/api/memory/:id', (req, res) => {
    try {
      store.deleteMemory(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.get('/api/conversations', (req, res) => {
    try {
      const limit = parsePageLimit(req.query.limit, THREAD_LIST_DEFAULT_LIMIT, THREAD_LIST_MAX_LIMIT);
      const cursor = parseThreadListCursor(req.query.cursor);
      if (limit === null || cursor === null) {
        return res.status(400).json({ error: 'Invalid conversation pagination parameters.' });
      }
      const rows = store.listConversationSessionSummaries(limit + 1, cursor);
      const page = boundThreadSummaryPage(rows.map((session) => createThreadSummary(session)), limit);
      return res.json({ sessions: page.items, page: page.page });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.get('/api/conversations/:id', (req, res) => {
    try {
      const limit = parsePageLimit(req.query.limit, THREAD_MESSAGES_DEFAULT_LIMIT, THREAD_MESSAGES_MAX_LIMIT);
      const cursor = parseThreadMessageCursor(req.query.cursor, req.params.id);
      if (limit === null || cursor === null) {
        return res.status(400).json({ error: 'Invalid conversation message pagination parameters.' });
      }
      const session = store.getConversationSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Conversation session not found.' });
      const page = createThreadMessagePage(session, limit, cursor?.beforeIndex);
      return res.json({ session: page.thread, page: page.page });
    } catch (error: any) {
      return res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.put('/api/conversations/:id', (req, res) => {
    try {
      const now = Date.now();
      const existing = store.getConversationSession(req.params.id);
      const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-200) : existing?.messages || [];
      const session = {
        id: req.params.id,
        title: typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim().slice(0, 200) : existing?.title || 'New conversation',
        messages,
        createdAt: Number(req.body?.createdAt) || existing?.createdAt || now,
        updatedAt: now,
      };
      store.upsertConversationSession(session);
      return res.json({ session: createThreadSummary(session) });
    } catch (error: any) {
      return res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.delete('/api/conversations/:id', async (req, res) => {
    try {
      const result = await purgeThreadHistory(req.params.id);
      await deleteCoderThreadArtifact(req.params.id);
      return res.json({ success: true, purge: result });
    } catch (error: any) {
      return res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  return router;
}
