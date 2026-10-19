import { afterEach, describe, expect, it } from '@jest/globals';
import {
  CHAT_DRAFT_STORAGE_KEY,
  CHAT_IGNORED_CONTEXT_STORAGE_KEY,
  readIgnoredContextFiles,
  readScopedChatDraft,
  writeIgnoredContextFiles,
  writeScopedChatDraft,
} from '../../ui/src/utils/chatComposerPersistence';

const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
});

describe('chat composer persistence', () => {
  it('keeps drafts scoped to their thread and removes an explicit empty draft', () => {
    const values = new Map<string, string>();
    const fakeWindow = {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });

    writeScopedChatDraft('thread-a', 'Inspect src/App.tsx');
    writeScopedChatDraft('thread-b', 'Run the UI tests');
    expect(readScopedChatDraft('thread-a')).toBe('Inspect src/App.tsx');
    expect(readScopedChatDraft('thread-b')).toBe('Run the UI tests');
    expect(JSON.parse(values.get(CHAT_DRAFT_STORAGE_KEY) || '{}')).toEqual({
      'thread-a': 'Inspect src/App.tsx',
      'thread-b': 'Run the UI tests',
    });

    writeScopedChatDraft('thread-a', '');
    expect(readScopedChatDraft('thread-a')).toBeNull();
    expect(readScopedChatDraft('thread-b')).toBe('Run the UI tests');
  });

  it('keeps ignored context files isolated and allows explicit clearing', () => {
    const values = new Map<string, string>();
    const fakeWindow = {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });

    writeIgnoredContextFiles('thread-a', new Set(['src/App.tsx', 'README.md']));
    writeIgnoredContextFiles('thread-b', new Set(['package.json']));
    expect(readIgnoredContextFiles('thread-a')).toEqual(new Set(['src/App.tsx', 'README.md']));
    expect(readIgnoredContextFiles('thread-b')).toEqual(new Set(['package.json']));

    writeIgnoredContextFiles('thread-a', new Set());
    expect(readIgnoredContextFiles('thread-a')).toEqual(new Set());
    expect(JSON.parse(values.get(CHAT_IGNORED_CONTEXT_STORAGE_KEY) || '{}')).toEqual({
      'thread-b': ['package.json'],
    });
  });
});
