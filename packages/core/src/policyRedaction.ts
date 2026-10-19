const SECRET_PATTERN = /(?:\b(?:sk|pk)_[A-Za-z0-9_-]{8,}|\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi;

/** Redact common credential formats from text that may be shown or persisted. */
export function redactPolicyText(value: string): string {
  return value.replace(SECRET_PATTERN, (match) => {
    const separator = match.indexOf('=') >= 0 ? '=' : match.indexOf(':') >= 0 ? ':' : '';
    return separator ? `${match.slice(0, match.indexOf(separator) + 1)}[REDACTED]` : '[REDACTED]';
  });
}

/** Recursively redact strings in a value before it crosses a logging boundary. */
export function redactPolicyPayload(value: unknown): unknown {
  if (typeof value === 'string') return redactPolicyText(value);
  if (Array.isArray(value)) return value.map(redactPolicyPayload);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactPolicyPayload(item)]),
    );
  }
  return value;
}
