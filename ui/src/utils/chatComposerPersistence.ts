export const CHAT_DRAFT_STORAGE_KEY = 'coder_chat_drafts';
export const CHAT_IGNORED_CONTEXT_STORAGE_KEY = 'coder_chat_ignored_context';

export const chatStorageScope = (threadId?: string | null) => threadId || 'default';

export const readScopedChatDraft = (threadId?: string | null): string | null => {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(CHAT_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const drafts = JSON.parse(raw) as Record<string, unknown>;
    const draft = drafts[chatStorageScope(threadId)];
    return typeof draft === 'string' ? draft : null;
  } catch {
    return null;
  }
};

export const writeScopedChatDraft = (threadId: string | null | undefined, value: string) => {
  try {
    const raw = window.localStorage.getItem(CHAT_DRAFT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const drafts = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
    const scope = chatStorageScope(threadId);
    if (value) drafts[scope] = value;
    else delete drafts[scope];
    window.localStorage.setItem(CHAT_DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // Draft persistence is optional and must not block chat interaction.
  }
};

export const readIgnoredContextFiles = (threadId?: string | null): Set<string> => {
  try {
    if (typeof window === 'undefined') return new Set();
    const raw = window.localStorage.getItem(CHAT_IGNORED_CONTEXT_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const values = parsed[chatStorageScope(threadId)];
    return Array.isArray(values)
      ? new Set(values.filter((value): value is string => typeof value === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
};

export const writeIgnoredContextFiles = (threadId: string | null | undefined, files: Set<string>) => {
  try {
    const raw = window.localStorage.getItem(CHAT_IGNORED_CONTEXT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const scoped = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
    const scope = chatStorageScope(threadId);
    if (files.size > 0) scoped[scope] = Array.from(files);
    else delete scoped[scope];
    window.localStorage.setItem(CHAT_IGNORED_CONTEXT_STORAGE_KEY, JSON.stringify(scoped));
  } catch {
    // Context presentation state is best effort only.
  }
};
