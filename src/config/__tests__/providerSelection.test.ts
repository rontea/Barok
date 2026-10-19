import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_CODER_MODEL_SELECTION,
  normalizeCoderModelSelection,
} from '../providerSelection.js';

describe('coder provider selection migration', () => {
  it('replaces legacy credential-indexed Groq targets with the normal coder default', () => {
    expect(normalizeCoderModelSelection('groq-target:key-2')).toBe(DEFAULT_CODER_MODEL_SELECTION);
    expect(normalizeCoderModelSelection(' GROQ-TARGET:KEY-9 ')).toBe(DEFAULT_CODER_MODEL_SELECTION);
    expect(normalizeCoderModelSelection('openrouter:dots-studio/dots-3-note-preview:free')).toBe(DEFAULT_CODER_MODEL_SELECTION);
  });

  it('preserves explicit stable Groq and non-Groq selections', () => {
    expect(normalizeCoderModelSelection('groq:llama-3.3-70b-versatile'))
      .toBe('groq:llama-3.3-70b-versatile');
    expect(normalizeCoderModelSelection('openrouter:openrouter/free'))
      .toBe('openrouter:openrouter/free');
  });

  it('preserves the explicit OpenRouter Ox Alpha route', () => {
    expect(normalizeCoderModelSelection('openrouter:stealth/ox-alpha'))
      .toBe('openrouter:stealth/ox-alpha');
    expect(normalizeCoderModelSelection('stealth/ox-alpha'))
      .toBe('stealth/ox-alpha');
  });

  it('migrates legacy Coder Gemini aliases to valid native model IDs', () => {
    expect(normalizeCoderModelSelection('gemini')).toBe('gemini-3.6-flash');
    expect(normalizeCoderModelSelection('GEMINI-FAST')).toBe('gemini-3.5-flash-lite');
    expect(normalizeCoderModelSelection('gemini-2.5-flash-lite')).toBe('gemini-3.5-flash-lite');
    expect(normalizeCoderModelSelection('gemini-2.5-flash')).toBe('gemini-3.6-flash');
    expect(normalizeCoderModelSelection('gemini-2.5-pro')).toBe('gemini-3.1-pro-preview');
    expect(normalizeCoderModelSelection('gemini-3-flash')).toBe('gemini-3.6-flash');
    expect(normalizeCoderModelSelection('gemini-search')).toBe('gemini-search');
  });
});
