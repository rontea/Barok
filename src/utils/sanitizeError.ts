import { redactProviderSecrets } from '../di/providers/providerErrors.js';

/**
 * Remove provider credentials from messages that may be returned to clients or
 * written to logs. Keep only a short provider-specific prefix where it helps
 * identify which credential family failed.
 */
export function sanitizeError(value: unknown): string {
  const message = value == null ? '' : String(value);
  if (!message) return message;

  let cleaned = message.replace(/\b(?:pk|sk)_[a-z0-9]{10,}\b/gi, (match) => {
    return `${match.slice(0, 3)}...[REDACTED]`;
  });
  cleaned = cleaned.replace(/\bnvapi[a-z0-9._-]{8,}\b/gi, 'nvapi...[REDACTED]');
  cleaned = cleaned.replace(/\bAIzaSy[a-z0-9_-]{15,}\b/gi, 'AIzaSy...[REDACTED]');
  cleaned = cleaned.replace(/\bAQ\.[a-z0-9._-]{10,}\b/gi, 'AQ....[REDACTED]');
  cleaned = cleaned.replace(/\bgsk_[a-z0-9._-]{10,}\b/gi, 'gsk_...[REDACTED]');
  cleaned = cleaned.replace(/\bcsk-[a-z0-9._~+/=-]{10,}\b/gi, 'csk-...[REDACTED]');
  cleaned = cleaned.replace(/\b(?:kimi|moonshot)[-_][a-z0-9._~+/=-]{10,}\b/gi, (match) => {
    const prefix = match.match(/^[a-z]+(?:-[a-z]+)?[-_]/i)?.[0];
    return `${prefix || `${match.slice(0, 1)}-`}...[REDACTED]`;
  });
  cleaned = cleaned.replace(/\brqsty-sk-[a-z0-9+/_=.-]{10,}\b/gi, 'rqsty-sk-...[REDACTED]');
  cleaned = cleaned.replace(/\brqsty-[a-z0-9+/_=.-]{10,}\b/gi, 'rqsty-...[REDACTED]');
  cleaned = cleaned.replace(/\bBearer\s+[a-z0-9][a-z0-9._~+/=-]{32,}\b/gi, 'Bearer [REDACTED]');

  return redactProviderSecrets(cleaned, 2_000);
}
