import { afterEach, describe, expect, it } from '@jest/globals';
import {
  DEFAULT_ORCHESTRATION_PREFERENCES,
  ORCHESTRATION_PREFERENCES_STORAGE_KEY,
  readOrchestrationPreferences,
  resetOrchestrationPreferences,
  writeOrchestrationPreferences,
} from '../../ui/src/utils/orchestrationPreferences';

const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
});

describe('orchestration preferences', () => {
  it('uses a visible plan tab by default', () => {
    expect(readOrchestrationPreferences('thread-a')).toEqual(DEFAULT_ORCHESTRATION_PREFERENCES);
  });

  it('persists visibility and selected tab independently per thread', () => {
    const values = new Map<string, string>();
    const fakeWindow = {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });

    expect(writeOrchestrationPreferences('thread-a', { visible: false, tab: 'diffs' })).toEqual({
      visible: false,
      tab: 'diffs',
    });
    expect(readOrchestrationPreferences('thread-a')).toEqual({ visible: false, tab: 'diffs' });
    expect(readOrchestrationPreferences('thread-b')).toEqual(DEFAULT_ORCHESTRATION_PREFERENCES);
    expect(values.has(ORCHESTRATION_PREFERENCES_STORAGE_KEY)).toBe(true);
  });

  it('ignores invalid stored preferences and can reset one thread', () => {
    const values = new Map<string, string>([
      [ORCHESTRATION_PREFERENCES_STORAGE_KEY, JSON.stringify({
        'thread-a': { visible: 'yes', tab: 'unknown' },
        'thread-b': { visible: false, tab: 'execution' },
      })],
    ]);
    const fakeWindow = {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });

    expect(readOrchestrationPreferences('thread-a')).toEqual(DEFAULT_ORCHESTRATION_PREFERENCES);
    expect(readOrchestrationPreferences('thread-b')).toEqual({ visible: false, tab: 'execution' });
    resetOrchestrationPreferences('thread-b');
    expect(readOrchestrationPreferences('thread-b')).toEqual(DEFAULT_ORCHESTRATION_PREFERENCES);
    expect(readOrchestrationPreferences('thread-a')).toEqual(DEFAULT_ORCHESTRATION_PREFERENCES);
  });
});
