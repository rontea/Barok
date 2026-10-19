import { describe, expect, it } from '@jest/globals';
import { sanitizeError } from '../sanitizeError.js';

describe('sanitizeError', () => {
  it.each([
    ['pk_abcdefghijklmnop123', 'pk_'],
    ['sk_abcdefghijklmnop123', 'sk_'],
    ['nvapi-1234567890abcdef', 'nvapi'],
    ['AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz', 'AIzaSy'],
    ['AQ.1234567890abcdef', 'AQ.'],
    ['gsk_1234567890abcdef', 'gsk_'],
    ['csk-1234567890abcdef', 'csk-'],
    ['kimi-sk-1234567890abcdef', 'kimi-sk-'],
    ['rqsty-sk-1234567890abcdef', 'rqsty-sk-'],
    ['Bearer abcdefghijklmnopqrstuvwxyz-0123456789', 'Bearer '],
  ])('redacts %s credentials', (credential, visiblePrefix) => {
    const sanitized = sanitizeError(`request failed: ${credential}`);

    expect(sanitized).not.toContain(credential);
    expect(sanitized).toContain('[REDACTED]');
    if (visiblePrefix !== 'Bearer ') expect(sanitized).toContain(visiblePrefix);
  });

  it('redacts credentials embedded in JSON and mixed-case bearer headers', () => {
    const credential = 'Bearer ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789';
    const sanitized = sanitizeError(`{"error":"AUTHORIZATION: ${credential}"}`);

    expect(sanitized).not.toContain(credential);
    expect(sanitized).toContain('[REDACTED]');
  });

  it('redacts credentials at the start and end of a message', () => {
    const startCredential = 'Sk_abcdefghijklmnop123';
    const endCredential = 'Csk-1234567890abcdef';

    expect(sanitizeError(startCredential)).not.toContain(startCredential);
    expect(sanitizeError(`request failed: ${endCredential}`)).not.toContain(endCredential);
  });

  it('preserves non-secret context and bounds oversized messages', () => {
    const sanitized = sanitizeError(`Provider failed: ${'x'.repeat(3_000)}`);

    expect(sanitized).toContain('Provider failed:');
    expect(sanitized.length).toBe(2_000);
  });
});
