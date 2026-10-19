/** Host-neutral provider cooldown classification and retry timing rules. */

/** Classify errors that the run manager may wait and retry after. */
export function isRecoverableRunProviderAvailabilityError(message: string): boolean {
  const namesProvider = /All LLM providers failed|Pollinations|NVIDIA|Gemini|OpenRouter|Groq|Cerebras|SambaNova|Kimi|Requesty|Local(?: AI| model)?|Colab/i.test(message);
  const modelUnavailable = /model(?: target)?\s+(?:is\s+)?(?:unavailable|not found|retired|unsupported)|\b(?:404|410)\b/i.test(message);

  // A successful chat response without assistant content is a contract or
  // model-selection failure, not an outage that benefits from cooldown.
  if (/(?:OpenRouter|Groq|Cerebras|SambaNova|Kimi|Requesty) returned no usable chat content/i.test(message)
    && /Cause:\s*(?:empty response|reasoning-only response)\b/i.test(message)) {
    return false;
  }
  if (/Local model returned no usable content/i.test(message)) return false;

  // Definitive stale model IDs cannot recover by waiting. Other providers may
  // use 404 as a transient availability signal.
  if (modelUnavailable && /OpenRouter|NVIDIA/i.test(message)) return false;

  const availabilityFailure = /temporarily overloaded|temporarily unavailable|high demand|service unavailable|\b50[0234]\b|\b202\b|\b429\b|\brate[\s_-]*limit(?:ed| exceeded| reached| hit| reset| cooldown)\b|RESOURCE_EXHAUSTED|quota (?:is )?(?:exhausted|exceeded|reached)|cooldown|timed out|timeout|deadline|empty response|no usable content|malformed (?:JSON|response)|invalid JSON|unexpected token/i.test(message);
  return namesProvider && (availabilityFailure || modelUnavailable);
}

/** Classify provider availability failures surfaced by the ReAct loop. */
export function isRecoverableReActProviderAvailabilityError(message: string): boolean {
  const namesProvider = /All LLM providers failed|Pollinations|NVIDIA|Gemini|OpenRouter|Groq|Kimi|Requesty/i.test(message);
  // A successful response without assistant content is a route/model contract
  // failure. Repeating the same request through cooldown recovery will not fix it.
  if (/(?:OpenRouter|Groq|Kimi|Requesty) returned no usable chat content/i.test(message)
    && /Cause:\s*(?:empty response|reasoning-only response)\b/i.test(message)) {
    return false;
  }
  const availabilityFailure = /temporarily overloaded|temporarily unavailable|high demand|service unavailable|\b50[0234]\b|\b202\b|\b429\b|\brate[\s_-]*limit(?:ed| exceeded| reached| hit| reset| cooldown)\b|RESOURCE_EXHAUSTED|quota (?:is )?(?:exhausted|exceeded|reached)|cooldown|timed out|timeout|deadline|empty response|no usable content|malformed (?:JSON|response)|invalid JSON|unexpected token/i.test(message);
  return namesProvider && availabilityFailure;
}

/** Prefer a provider-supplied retry delay; otherwise classify a bounded fallback. */
export function extractProviderRetryAfterMs(message: string, now = Date.now()): number | undefined {
  const durationMatch = message.match(/(?:retry(?:[\s_-]*after|[\s_-]*delay|\s+available\s+in|\s+in)?|try again in)["':=\s]*([0-9.]+)\s*(milliseconds?|ms|seconds?|s|minutes?|m)/i);
  if (durationMatch) {
    const value = Number(durationMatch[1]);
    if (Number.isFinite(value) && value >= 0) {
      const unit = durationMatch[2].toLowerCase();
      if (unit === 'ms' || unit.startsWith('millisecond')) return Math.ceil(value);
      if (unit.startsWith('m') && !unit.startsWith('millisecond')) return Math.ceil(value * 60_000);
      return Math.ceil(value * 1_000);
    }
  }

  const retryAfterSeconds = message.match(/retry(?:[\s_-]*after|\s+in)["':=\s]+([0-9.]+)(?!\s*(?:ms|milliseconds?|s|seconds?|m|minutes?))/i);
  if (retryAfterSeconds) {
    const seconds = Number(retryAfterSeconds[1]);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  }

  const resetMatch = message.match(/(?:x-ratelimit-reset|ratelimit-reset|reset)["':=\s]+(\d{10,13})/i);
  if (resetMatch) {
    const raw = Number(resetMatch[1]);
    if (Number.isFinite(raw)) {
      const resetAt = resetMatch[1].length <= 10 ? raw * 1_000 : raw;
      return Math.max(0, resetAt - now);
    }
  }

  if (/\b429\b|\brate[\s_-]*limit(?:ed| exceeded| reached| hit| reset| cooldown)\b|RESOURCE_EXHAUSTED|quota (?:is )?(?:exhausted|exceeded|reached)/i.test(message)) return 60_000;
  if (/empty response|no usable content|malformed (?:JSON|response)|invalid JSON|unexpected token/i.test(message)) return 10_000;
  if (/timed out|timeout|deadline|temporarily overloaded|temporarily unavailable|service unavailable|\b50[0234]\b/i.test(message)) return 120_000;
  return undefined;
}

/** Bound a provider delay and apply the local-model reconnect schedule. */
export function normalizeProviderWaitMs(
  retryAfterMs: number | undefined,
  attempt: number,
  offlineModelServer = false,
): number {
  if (offlineModelServer && (!Number.isFinite(retryAfterMs) || (retryAfterMs || 0) >= 120_000)) {
    return Math.min(5_000 * Math.max(1, attempt), 60_000);
  }
  if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.min(retryAfterMs, 30 * 60_000);
  }
  return Math.min(120_000 * Math.max(1, attempt), 10 * 60_000);
}

export function formatRetryAfterMs(retryAfterMs: number): string {
  if (retryAfterMs < 60_000) return `${Math.ceil(retryAfterMs / 1_000)} seconds`;
  return `${Math.ceil(retryAfterMs / 60_000)} minutes`;
}

export function formatProviderResumeAt(timestamp: number): string {
  return `${new Date(timestamp).toISOString()} (UTC)`;
}
