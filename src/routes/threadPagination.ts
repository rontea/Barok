import type { StoredCoderThread } from '../persistence/sqliteStore.js';

export const THREAD_LIST_DEFAULT_LIMIT = 50;
export const THREAD_LIST_MAX_LIMIT = 200;
export const THREAD_LIST_MAX_RESPONSE_BYTES = 64 * 1024;
export const THREAD_MESSAGES_DEFAULT_LIMIT = 25;
export const THREAD_MESSAGES_MAX_LIMIT = 100;
export const THREAD_MESSAGES_MAX_RESPONSE_BYTES = 256 * 1024;
const THREAD_LIST_RESPONSE_BUDGET_BYTES = THREAD_LIST_MAX_RESPONSE_BYTES - 512;
const THREAD_MESSAGES_RESPONSE_BUDGET_BYTES = THREAD_MESSAGES_MAX_RESPONSE_BYTES - 512;
const MAX_MESSAGE_CONTENT_CHARS = 6_000;
const MAX_REASONING_SUMMARY_CHARS = 1_000;

export interface ThreadListCursor {
  updatedAt: number;
  id: string;
}

export interface ThreadMessageCursor {
  threadId: string;
  beforeIndex: number;
}

export interface ThreadSummary {
  id: string;
  title: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const redactImageData = (value: string): string => value
  .replace(/!\[(.*?)\]\(data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+\)/g, '[image omitted]')
  .replace(/data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+/g, '[image omitted]');

export function parsePageLimit(value: unknown, defaultLimit: number, maxLimit: number): number | null {
  if (value === undefined) return defaultLimit;
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return Math.min(parsed, maxLimit);
}

function decodeCursor<T>(value: unknown): T | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

function encodeCursor(value: ThreadListCursor | ThreadMessageCursor): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function parseThreadListCursor(value: unknown): ThreadListCursor | null | undefined {
  const decoded = decodeCursor<ThreadListCursor>(value);
  if (decoded === undefined || decoded === null) return decoded;
  if (!Number.isSafeInteger(decoded.updatedAt) || decoded.updatedAt < 0 ||
      typeof decoded.id !== 'string' || decoded.id.length === 0 || decoded.id.length > 256) return null;
  return decoded;
}

export function encodeThreadListCursor(cursor: ThreadListCursor): string {
  return encodeCursor(cursor);
}

export function parseThreadMessageCursor(value: unknown, threadId: string): ThreadMessageCursor | null | undefined {
  const decoded = decodeCursor<ThreadMessageCursor>(value);
  if (decoded === undefined || decoded === null) return decoded;
  if (decoded.threadId !== threadId || !Number.isSafeInteger(decoded.beforeIndex) || decoded.beforeIndex < 0) return null;
  return decoded;
}

function boundedJson(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactImageData(value).slice(0, 1_000);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (depth >= 4) return '[detail omitted]';
  if (Array.isArray(value)) return value.slice(-12).map((entry) => boundedJson(entry, depth + 1));
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(Object.entries(value).slice(0, 24).map(([key, entry]) => [
    key.slice(0, 100), boundedJson(entry, depth + 1),
  ]));
}

export function createThreadSummary(
  thread: Pick<StoredCoderThread, 'id' | 'title' | 'createdAt' | 'updatedAt'> & {
    messages?: unknown[];
    messageCount?: number;
  },
): ThreadSummary {
  return {
    id: thread.id.slice(0, 256),
    title: redactImageData(thread.title).slice(0, 200),
    messageCount: Number.isSafeInteger(thread.messageCount)
      ? Math.max(0, Number(thread.messageCount))
      : thread.messages?.length || 0,
    createdAt: Number(thread.createdAt) || 0,
    updatedAt: Number(thread.updatedAt) || 0,
  };
}

function createBoundedMessage(message: unknown): Record<string, unknown> {
  if (!isRecord(message)) return { role: 'system', content: '[message omitted]' };
  const content = typeof message.content === 'string' ? redactImageData(message.content) : '';
  const output: Record<string, unknown> = {
    id: typeof message.id === 'string' ? message.id.slice(0, 256) : undefined,
    role: typeof message.role === 'string' ? message.role.slice(0, 32) : 'assistant',
    content: content.slice(0, MAX_MESSAGE_CONTENT_CHARS),
    ...(content.length > MAX_MESSAGE_CONTENT_CHARS ? { contentTruncated: true } : {}),
    ...(typeof message.status === 'string' ? { status: message.status.slice(0, 40) } : {}),
    ...(typeof message.reasoningSummary === 'string' && message.reasoningSummary.trim()
      ? { reasoningSummary: redactImageData(message.reasoningSummary).trim().slice(0, MAX_REASONING_SUMMARY_CHARS) }
      : {}),
    ...(typeof message.runId === 'string' ? { runId: message.runId.slice(0, 256) } : {}),
    ...(Number.isFinite(message.createdAt) ? { createdAt: Number(message.createdAt) } : {}),
  };
  if (Array.isArray(message.filesChanged)) {
    output.filesChanged = message.filesChanged
      .filter((file): file is string => typeof file === 'string')
      .slice(0, 50)
      .map((file) => redactImageData(file).slice(0, 500));
  }
  if (Array.isArray(message.images)) {
    output.images = message.images.filter(isRecord).slice(0, 12).map((image) => ({
      id: typeof image.id === 'string' ? image.id.slice(0, 256) : undefined,
      name: typeof image.name === 'string' ? redactImageData(image.name).slice(0, 200) : 'Attached image',
      ...(Number.isFinite(image.size) ? { size: Number(image.size) } : {}),
      mimeType: typeof image.mimeType === 'string' ? image.mimeType.slice(0, 100) : 'image/png',
    }));
  }
  if (Array.isArray(message.agentEvents) && message.agentEvents.length > 0) {
    output.agentEvents = message.agentEvents.slice(-20).map((event) => boundedJson(event));
  }
  return output;
}

export function createThreadMessagePage(
  thread: StoredCoderThread,
  limit: number,
  beforeIndex?: number,
): { thread: Omit<ThreadSummary, 'messageCount'> & { messages: Record<string, unknown>[] }; page: { limit: number; totalMessages: number; hasMore: boolean; nextCursor: string | null } } {
  const totalMessages = thread.messages.length;
  const endIndex = beforeIndex === undefined ? totalMessages : Math.min(totalMessages, beforeIndex);
  let startIndex = Math.max(0, endIndex - limit);
  let messages = thread.messages.slice(startIndex, endIndex).map(createBoundedMessage);

  const createPayload = () => ({
    thread: {
      id: thread.id.slice(0, 256),
      title: redactImageData(thread.title).slice(0, 200),
      createdAt: Number(thread.createdAt) || 0,
      updatedAt: Number(thread.updatedAt) || 0,
      messages,
    },
    page: {
      limit,
      totalMessages,
      hasMore: startIndex > 0,
      nextCursor: startIndex > 0 ? encodeCursor({ threadId: thread.id, beforeIndex: startIndex }) : null,
    },
  });

  let payload = createPayload();
  let payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  while (payloadBytes > THREAD_MESSAGES_RESPONSE_BUDGET_BYTES && messages.length > 1) {
    const currentBytes = payloadBytes;
    const targetLength = Math.max(1, Math.floor(messages.length * THREAD_MESSAGES_RESPONSE_BUDGET_BYTES / currentBytes));
    const removeCount = Math.max(1, messages.length - targetLength);
    messages = messages.slice(removeCount);
    startIndex += removeCount;
    payload = createPayload();
    payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  }

  // All nested fields are already bounded; this final guard protects the API
  // if future message metadata expands beyond the current projection.
  if (payloadBytes > THREAD_MESSAGES_RESPONSE_BUDGET_BYTES) {
    messages = messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: typeof message.content === 'string' ? message.content.slice(0, 500) : '',
      contentTruncated: true,
      ...(message.createdAt === undefined ? {} : { createdAt: message.createdAt }),
    }));
    payload = createPayload();
    payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  }

  return payload;
}

export function boundThreadSummaryPage<T extends ThreadSummary>(
  rows: T[],
  requestedLimit: number,
): { items: T[]; page: { limit: number; hasMore: boolean; nextCursor: string | null } } {
  let items = rows.slice(0, requestedLimit);
  let hasMore = rows.length > items.length;
  const makePayload = () => ({ items, page: { limit: requestedLimit, hasMore, nextCursor: hasMore && items.length > 0
    ? encodeThreadListCursor({ updatedAt: items[items.length - 1].updatedAt, id: items[items.length - 1].id })
    : null } });
  let payload = makePayload();
  let payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  while (payloadBytes > THREAD_LIST_RESPONSE_BUDGET_BYTES && items.length > 0) {
    const targetLength = Math.floor(items.length * THREAD_LIST_RESPONSE_BUDGET_BYTES / payloadBytes);
    items = items.slice(0, Math.max(0, Math.min(items.length - 1, targetLength)));
    hasMore = true;
    payload = makePayload();
    payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  }
  return payload;
}
