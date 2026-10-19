import { timingSafeEqual } from 'crypto';
import cors from 'cors';
import type { Request, RequestHandler } from 'express';

export interface NetworkSecurityConfig {
  host: string;
  allowLan: boolean;
  apiToken?: string;
  corsOrigins: string[];
}

export interface ApiAccessOptions {
  apiToken?: string;
  publicPaths?: readonly string[];
  requireTokenForAllNonHealth?: boolean;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const DEFAULT_PUBLIC_PATHS = ['/health'];

function parseBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true' || value?.trim() === '1';
}

function normalizeOrigin(origin: string): string | undefined {
  try {
    const parsed = new URL(origin.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export function parseCorsOrigins(rawValue = process.env.SERVER_CORS_ORIGINS): string[] {
  const values = (rawValue || '')
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.some((value) => value === '*')) {
    throw new Error('SERVER_CORS_ORIGINS must not contain the wildcard origin (*).');
  }
  const normalized = values.map(normalizeOrigin);
  if (values.some((value, index) => !normalized[index])) {
    throw new Error('SERVER_CORS_ORIGINS must contain only absolute http(s) origins.');
  }
  return [...new Set(normalized.filter((origin): origin is string => Boolean(origin)))];
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return LOOPBACK_HOSTS.has(normalized);
}

export function isLoopbackAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1';
}

export function isLanBinding(host: string): boolean {
  return !isLoopbackHost(host) && host !== '';
}

export function getNetworkSecurityConfig(): NetworkSecurityConfig {
  const host = process.env.SERVER_HOST?.trim() || '127.0.0.1';
  const allowLan = parseBoolean(process.env.SERVER_ALLOW_LAN);
  const apiToken = process.env.SERVER_API_TOKEN?.trim() || undefined;

  if (isLanBinding(host) && !allowLan) {
    throw new Error('LAN binding is disabled by default. Set SERVER_ALLOW_LAN=true to expose the server beyond loopback.');
  }
  if (isLanBinding(host) && !apiToken) {
    throw new Error('LAN binding requires SERVER_API_TOKEN to protect non-health API endpoints.');
  }

  return {
    host,
    allowLan,
    apiToken,
    corsOrigins: parseCorsOrigins(),
  };
}

function requestOriginMatchesHost(req: Request, origin: string): boolean {
  const normalizedOrigin = normalizeOrigin(origin);
  const requestHost = req.get('host')?.trim().toLowerCase();
  if (!normalizedOrigin || !requestHost) return false;
  try {
    const requestOrigin = new URL(`${req.protocol}://${requestHost}`).origin;
    return new URL(normalizedOrigin).origin === requestOrigin;
  } catch {
    return false;
  }
}

export function isAllowedCorsOrigin(req: Request, origin: string | undefined, configuredOrigins: readonly string[]): boolean {
  if (!origin) return true;
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return false;
  return configuredOrigins.includes(normalizedOrigin) || requestOriginMatchesHost(req, normalizedOrigin);
}

export function createConfiguredCorsMiddleware(configuredOrigins = parseCorsOrigins()): RequestHandler {
  return cors((req, callback) => {
    const origin = req.get('origin');
    const allowed = isAllowedCorsOrigin(req, origin, configuredOrigins);
    callback(null, {
      origin: allowed && origin ? origin : false,
      credentials: false,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      allowedHeaders: 'Content-Type, Authorization, X-API-Token, X-Provider-Settings-Token',
      maxAge: 600,
    });
  });
}

function tokenMatches(providedToken: string | undefined, expectedToken: string | undefined): boolean {
  if (!providedToken || !expectedToken) return false;
  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(providedToken);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function getProvidedApiToken(req: Request): string | undefined {
  const headerToken = req.get('x-api-token')?.trim();
  if (headerToken) return headerToken;
  const authorization = req.get('authorization')?.trim();
  const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearerToken) return bearerToken;
  const cookieToken = req.get('cookie')?.match(/(?:^|;\s*)server_api_token=([^;]+)/i)?.[1];
  if (!cookieToken) return undefined;
  try {
    return decodeURIComponent(cookieToken);
  } catch {
    return undefined;
  }
}

function isSameOriginBrowserRequest(req: Request): boolean {
  const origin = req.get('origin');
  if (origin) return requestOriginMatchesHost(req, origin);
  return req.get('sec-fetch-site')?.toLowerCase() === 'same-origin';
}

export function createApiAccessMiddleware({
  apiToken,
  publicPaths = DEFAULT_PUBLIC_PATHS,
  requireTokenForAllNonHealth = false,
}: ApiAccessOptions): RequestHandler {
  return (req, res, next) => {
    if (publicPaths.includes(req.path)) return next();
    if (tokenMatches(getProvidedApiToken(req), apiToken)) return next();
    if (requireTokenForAllNonHealth) {
      res.status(401).json({ error: 'Authentication required for this API endpoint.' });
      return;
    }
    if (isSameOriginBrowserRequest(req)) return next();
    if (!req.get('origin') && isLoopbackAddress(req.socket.remoteAddress || '')) return next();

    res.status(401).json({ error: 'Authentication required for this API endpoint.' });
  };
}
