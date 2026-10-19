import { afterEach, describe, expect, it } from '@jest/globals';
import {
  CHAT_DENSITY_STORAGE_KEY,
  CHAT_MESSAGE_FORMAT_STORAGE_KEY,
  DEFAULT_INTERFACE_DISPLAY_PREFERENCES,
  readInterfaceDisplayPreferences,
  writeInterfaceDisplayPreferences,
} from '../../ui/src/utils/interfaceDisplayPreferences';

const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
});

describe('interface display preferences', () => {
  it('uses the streamlined/detailed defaults when no preference is stored', () => {
    expect(DEFAULT_INTERFACE_DISPLAY_PREFERENCES).toEqual({
      chatMessageFormat: 'streamlined',
      chatDensity: 'detailed',
    });
    expect(readInterfaceDisplayPreferences()).toEqual(DEFAULT_INTERFACE_DISPLAY_PREFERENCES);
  });

  it('persists valid updates and ignores invalid stored values', () => {
    const values = new Map<string, string>();
    const fakeWindow = {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
      dispatchEvent: () => true,
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });

    values.set(CHAT_MESSAGE_FORMAT_STORAGE_KEY, 'not-a-format');
    values.set(CHAT_DENSITY_STORAGE_KEY, 'not-a-density');
    expect(readInterfaceDisplayPreferences()).toEqual(DEFAULT_INTERFACE_DISPLAY_PREFERENCES);

    expect(writeInterfaceDisplayPreferences({ chatMessageFormat: 'streamlined', chatDensity: 'compact' })).toEqual({
      chatMessageFormat: 'streamlined',
      chatDensity: 'compact',
    });
    expect(values.get(CHAT_MESSAGE_FORMAT_STORAGE_KEY)).toBe('streamlined');
    expect(values.get(CHAT_DENSITY_STORAGE_KEY)).toBe('compact');
  });

  it('can reset only the presentation preferences', () => {
    const values = new Map<string, string>([
      [CHAT_MESSAGE_FORMAT_STORAGE_KEY, 'streamlined'],
      [CHAT_DENSITY_STORAGE_KEY, 'compact'],
    ]);
    const fakeWindow = {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
      dispatchEvent: () => true,
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });

    writeInterfaceDisplayPreferences(DEFAULT_INTERFACE_DISPLAY_PREFERENCES);
    expect(readInterfaceDisplayPreferences()).toEqual(DEFAULT_INTERFACE_DISPLAY_PREFERENCES);
  });
});
