// The provider route stored in OpenRouter Settings is authoritative. This is
// only the safe first-load fallback before the server returns that setting.
export const DEFAULT_CODER_MODEL_SELECTION = 'openrouter:openrouter/free';

const LEGACY_GROQ_CREDENTIAL_TARGET = /^groq-target:key-\d+$/i;

/**
 * Coder Chat historically persisted a few Pollinations-era Gemini aliases.
 * Migrate only the unambiguous text aliases at the Coder boundary; provider
 * routing still preserves search aliases.
 */
const LEGACY_CODER_GEMINI_ALIASES: Record<string, string> = {
  gemini: 'gemini-3.6-flash',
  'gemini-fast': 'gemini-3.5-flash-lite',
  'gemini-2.5-pro': 'gemini-3.1-pro-preview',
  'gemini-2.5-flash': 'gemini-3.6-flash',
  'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-flash-lite-3.1': 'gemini-3.1-flash-lite',
  'gemini-large': 'gemini-3.1-pro-preview',
  'gemini-3-flash': 'gemini-3.6-flash',
};

/**
 * Old Groq targets encoded a credential slot and are not valid user intent.
 * Reset them to the normal coder default instead of silently selecting Groq.
 * Stable `groq:<model>` selections remain explicit and are preserved.
 */
export function normalizeCoderModelSelection(
  value: unknown,
  fallback = DEFAULT_CODER_MODEL_SELECTION,
): string {
  const selected = typeof value === 'string' ? value.trim() : '';
  if (!selected || LEGACY_GROQ_CREDENTIAL_TARGET.test(selected) || selected === 'openrouter:dots-studio/dots-3-note-preview:free') return fallback;
  const normalized = selected.toLowerCase();
  return LEGACY_CODER_GEMINI_ALIASES[normalized]
    || selected;
}
