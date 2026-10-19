/**
 * Interpret structured and legacy tool observations using the Barok engine's
 * existing success rules.
 */
export function isSuccessfulToolObservation(observation: string): boolean {
  try {
    const parsed = JSON.parse(observation);
    if (parsed && typeof parsed === 'object' && 'success' in parsed) {
      if (['failed', 'error', 'denied', 'rejected', 'invalid', 'blocked', 'cancelled', 'canceled', 'timed_out', 'unavailable', 'skipped']
        .includes(String(parsed.status || '').toLowerCase())) return false;
      return Boolean(parsed.success);
    }
  } catch {
    // Fall back to text checks for legacy string tool results.
  }

  return !/^(Error executing|Tool execution failed)|"success"\s*:\s*false|Guarded mutation rejected|failed|error/i.test(observation);
}
