import { isValidGeminiApiKey, validateApiKey } from '../stringValidators';

describe('Gemini API key validation', () => {
  it('accepts legacy standard Gemini API keys', () => {
    expect(isValidGeminiApiKey('AIzaSyExampleKeyValue1234567890')).toBe(true);
  });

  it('accepts newer Gemini auth keys with AQ dot prefix', () => {
    expect(isValidGeminiApiKey('AQ.exampleAuthKeyValue_1234567890')).toBe(true);
    expect(validateApiKey('AQ.exampleAuthKeyValue_1234567890', 'Gemini')).toEqual({
      valid: true,
      key: 'AQ.exampleAuthKeyValue_1234567890',
    });
  });

  it('rejects Gemini keys with whitespace or unsupported characters', () => {
    expect(isValidGeminiApiKey('AQ.example auth key')).toBe(false);
    expect(validateApiKey('AQ.example auth key', 'Gemini').valid).toBe(false);
  });
});
