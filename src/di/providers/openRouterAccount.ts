export interface OpenRouterAccountStatus {
  isFreeTier?: boolean;
  usage?: number;
  limit?: number;
  limitRemaining?: number;
  limitReset?: string;
  expiresAt?: string;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Keep only non-sensitive advisory fields from GET /api/v1/key.
 * Hashes, user ids, labels, and raw upstream payloads stay server-side.
 */
export function parseOpenRouterAccountStatus(payload: unknown): OpenRouterAccountStatus {
  const data = payload && typeof payload === 'object' && 'data' in payload
    ? (payload as { data?: unknown }).data
    : undefined;
  if (!data || typeof data !== 'object') return {};
  const value = data as Record<string, unknown>;
  return {
    isFreeTier: typeof value.is_free_tier === 'boolean' ? value.is_free_tier : undefined,
    usage: finiteNumber(value.usage),
    limit: finiteNumber(value.limit),
    limitRemaining: finiteNumber(value.limit_remaining),
    limitReset: stringValue(value.limit_reset),
    expiresAt: stringValue(value.expires_at),
  };
}
