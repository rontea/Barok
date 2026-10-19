import type { Request, RequestHandler, Response } from 'express';

interface IpRateLimitOptions {
  limit: number;
  windowMs: number;
}

interface IpRateLimitEntry {
  count: number;
  resetAt: number;
}

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const PROVIDER_PROBE_LIMIT = 20;
const LLM_WRITE_LIMIT = 8;

function getClientIp(req: Request): string {
  // This server binds directly to its configured interface and does not trust
  // forwarded headers. Using the socket address prevents callers from
  // bypassing limits by supplying a forged X-Forwarded-For value.
  return req.socket.remoteAddress || 'unknown';
}

function sendRateLimitResponse(
  res: Response,
  limit: number,
  windowMs: number,
  remaining: number,
  resetAt: number,
  now: number,
): void {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
  res.setHeader('RateLimit-Limit', String(limit));
  res.setHeader('RateLimit-Remaining', String(remaining));
  res.setHeader('RateLimit-Reset', String(retryAfterSeconds));
  res.setHeader('RateLimit-Policy', `${limit};w=${Math.ceil(windowMs / 1000)}`);
  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.setHeader('Cache-Control', 'no-store');
  res.status(429).json({
    error: 'Too many requests. Please try again later.',
    retryAfterSeconds,
  });
}

function createIpRateLimiter({ limit, windowMs }: IpRateLimitOptions): RequestHandler {
  const entries = new Map<string, IpRateLimitEntry>();
  let nextCleanupAt = 0;

  return (req, res, next) => {
    const now = Date.now();
    if (now >= nextCleanupAt) {
      for (const [ip, entry] of entries) {
        if (entry.resetAt <= now) entries.delete(ip);
      }
      nextCleanupAt = now + 60_000;
    }

    const ip = getClientIp(req);
    let entry = entries.get(ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      entries.set(ip, entry);
    }

    entry.count = Math.min(limit + 1, entry.count + 1);
    const remaining = Math.max(0, limit - entry.count);
    if (entry.count > limit) {
      sendRateLimitResponse(res, limit, windowMs, remaining, entry.resetAt, now);
      return;
    }

    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
    res.setHeader('RateLimit-Policy', `${limit};w=${Math.ceil(windowMs / 1000)}`);
    next();
  };
}

const providerProbeLimiter = createIpRateLimiter({
  limit: PROVIDER_PROBE_LIMIT,
  windowMs: RATE_LIMIT_WINDOW_MS,
});

const llmWriteLimiter = createIpRateLimiter({
  limit: LLM_WRITE_LIMIT,
  windowMs: RATE_LIMIT_WINDOW_MS,
});

function isProviderProbe(path: string): boolean {
  return /\/(?:test|validate)$/i.test(path) || path.toLowerCase() === '/api/groq/health';
}

function isLlmWrite(method: string, path: string): boolean {
  if (method !== 'POST') return false;
  const normalizedPath = path.toLowerCase();
  return normalizedPath === '/api/gemini/generate'
    || normalizedPath === '/api/direct-chat'
    || normalizedPath === '/api/coder/respond'
    || normalizedPath === '/api/runs'
    || normalizedPath === '/api/react'
    || normalizedPath === '/api/react/stream'
    || /^\/api\/runs\/[^/]+\/resume$/.test(normalizedPath)
    || /^\/api\/runs\/[^/]+\/children$/.test(normalizedPath)
    || /^\/api\/runs\/[^/]+\/children\/[^/]+\/follow-up$/.test(normalizedPath);
}

/**
 * Limits provider test/validation requests and API writes that start or
 * continue work with an LLM. Routine API reads and run polling are unaffected.
 */
export function createApiRateLimitMiddleware(): RequestHandler {
  return (req, res, next) => {
    const path = req.path;
    if (!path.startsWith('/api/')) return next();

    if (isProviderProbe(path)) return providerProbeLimiter(req, res, next);
    if (isLlmWrite(req.method.toUpperCase(), path)) return llmWriteLimiter(req, res, next);
    return next();
  };
}
