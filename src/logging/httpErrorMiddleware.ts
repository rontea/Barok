import type { RequestHandler } from 'express';
import winston from 'winston';
import { sanitizeError } from '../utils/sanitizeError.js';

const httpErrorLogger = winston.createLogger({
  level: 'warn',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  defaultMeta: {
    service: 'barok-server',
    event: 'http_response_error',
  },
  transports: [new winston.transports.Console()],
});

/** Logs completed 4xx and 5xx responses as bounded, structured JSON records. */
export const httpErrorLoggingMiddleware: RequestHandler = (req, res, next) => {
  const startedAt = Date.now();

  res.once('finish', () => {
    const statusCode = res.statusCode;
    if (statusCode < 400) return;

    httpErrorLogger.log({
      level: statusCode >= 500 ? 'error' : 'warn',
      message: 'HTTP request completed with an error status.',
      method: req.method,
      // req.path excludes query parameters, which may contain sensitive values.
      path: sanitizeError(req.path),
      statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
};
