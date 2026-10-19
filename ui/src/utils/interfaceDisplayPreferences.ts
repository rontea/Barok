export type ChatMessageFormat = 'streamlined' | 'rotating' | 'chat_text';
export type ChatViewDensity = 'compact' | 'detailed';

export interface InterfaceDisplayPreferences {
  chatMessageFormat: ChatMessageFormat;
  chatDensity: ChatViewDensity;
}

export const INTERFACE_DISPLAY_EVENT = 'coder-interface-display-changed';
export const CHAT_MESSAGE_FORMAT_STORAGE_KEY = 'coder_chat_message_format';
export const CHAT_DENSITY_STORAGE_KEY = 'coder_chat_density';

export const DEFAULT_INTERFACE_DISPLAY_PREFERENCES: InterfaceDisplayPreferences = {
  chatMessageFormat: 'streamlined',
  chatDensity: 'detailed',
};

const isChatMessageFormat = (value: string | null): value is ChatMessageFormat =>
  value === 'streamlined' || value === 'rotating' || value === 'chat_text';

const isChatViewDensity = (value: string | null): value is ChatViewDensity =>
  value === 'compact' || value === 'detailed';

export const readInterfaceDisplayPreferences = (): InterfaceDisplayPreferences => {
  const defaults = DEFAULT_INTERFACE_DISPLAY_PREFERENCES;
  if (typeof window === 'undefined') return defaults;

  try {
    const storedFormat = window.localStorage.getItem(CHAT_MESSAGE_FORMAT_STORAGE_KEY);
    const storedDensity = window.localStorage.getItem(CHAT_DENSITY_STORAGE_KEY);
    return {
      chatMessageFormat: isChatMessageFormat(storedFormat) ? storedFormat : defaults.chatMessageFormat,
      chatDensity: isChatViewDensity(storedDensity) ? storedDensity : defaults.chatDensity,
    };
  } catch {
    return defaults;
  }
};

export const writeInterfaceDisplayPreferences = (
  preferences: Partial<InterfaceDisplayPreferences>,
): InterfaceDisplayPreferences => {
  const next = { ...readInterfaceDisplayPreferences(), ...preferences };
  try {
    window.localStorage.setItem(CHAT_MESSAGE_FORMAT_STORAGE_KEY, next.chatMessageFormat);
    window.localStorage.setItem(CHAT_DENSITY_STORAGE_KEY, next.chatDensity);
    const event = typeof CustomEvent === 'function'
      ? new CustomEvent<InterfaceDisplayPreferences>(INTERFACE_DISPLAY_EVENT, { detail: next })
      : new Event(INTERFACE_DISPLAY_EVENT);
    window.dispatchEvent(event);
  } catch {
    // Preferences remain active for the current component even when storage is unavailable.
  }
  return next;
};
