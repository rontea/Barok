/**
 * Centralized Retry Logic & Backoff Strategies
 * 
 * Provides:
 * - Exponential backoff with jitter
 * - Configurable retry policies
 * - Error classification for retry decisions
 * - Retry result tracking
 * 
 * Supports both sequential retry (simple) and model rotation retry (complex).
 */

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Backoff strategy */
  backoffStrategy: 'exponential' | 'linear' | 'exponential-jitter';
  /** Base delay in milliseconds */
  baseDelayMs: number;
  /** Backoff multiplier (for exponential strategies) */
  multiplier: number;
  /** Maximum delay cap in milliseconds */
  maxDelayMs: number;
  /** Whether to enable jitter on exponential backoff */
  jitter: boolean;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  backoffStrategy: 'exponential-jitter',
  baseDelayMs: 1000,
  multiplier: 2,
  maxDelayMs: 30000,
  jitter: true,
};

/**
 * Result from a retry operation
 */
export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error | string;
  attempts: number;
  totalDelayMs: number;
  lastError?: Error;
  retryable: boolean; // Could it have succeeded with more retries
}

/**
 * Classification of errors for retry decisions
 */
export enum RetryableErrorType {
  /** Error that should not be retried */
  PERMANENT = 'permanent',
  /** Error that might succeed on retry */
  TRANSIENT = 'transient',
  /** Error condition unknown - treat as transient by default */
  UNKNOWN = 'unknown',
}

/**
 * Error classification result
 */
export interface ErrorClassification {
  type: RetryableErrorType;
  reason: string;
  suggestedDelay?: number; // If error suggests a retry-after header
}

/**
 * Classify an error to determine if it's retryable
 */
export function classifyError(error: unknown, context?: string): ErrorClassification {
  if (!error) {
    return {
      type: RetryableErrorType.TRANSIENT,
      reason: 'Empty error',
    };
  }

  const errorStr = error instanceof Error ? error.message : String(error);
  const errorCode = (error as any)?.code ?? (error as any)?.status ?? null;

  // Extract retry-after header if present
  let suggestedDelay: number | undefined;
  const retryAfterMatch = errorStr.match(/retry[_-]?after[:\s]+(\d+)/i);
  if (retryAfterMatch) {
    suggestedDelay = parseInt(retryAfterMatch[1], 10) * 1000; // Convert seconds to ms
  }

  // Permanent errors - should not retry
  if (
    errorStr.includes('401') || // Unauthorized
    errorStr.includes('403') || // Forbidden
    errorStr.includes('404') || // Not found
    errorStr.includes('invalid api key') ||
    errorStr.includes('authentication failed') ||
    errorStr.includes('permission denied') ||
    errorStr.includes('unauthorized')
  ) {
    return {
      type: RetryableErrorType.PERMANENT,
      reason: 'Authentication/authorization error',
    };
  }

  // Quota errors - permanent until quota resets
  if (
    errorStr.includes('quota') ||
    errorStr.includes('exceeded your current quota') ||
    errorStr.includes('plan and billing') ||
    errorStr.includes('insufficient_quota') ||
    errorStr.includes('quota_exceeded') ||
    errorStr.includes('resource_exhausted')
  ) {
    return {
      type: RetryableErrorType.PERMANENT,
      reason: 'Quota exhausted',
      suggestedDelay,
    };
  }

  // Transient errors - should retry
  if (
    errorCode === 429 || // Rate limit
    errorCode === 408 || // Request timeout
    errorCode === 500 || // Server error
    errorCode === 502 || // Bad gateway
    errorCode === 503 || // Service unavailable
    errorCode === 504 || // Gateway timeout
    errorStr.includes('429') ||
    errorStr.includes('timeout') ||
    errorStr.includes('ECONNREFUSED') ||
    errorStr.includes('ECONNRESET') ||
    errorStr.includes('ETIMEDOUT') ||
    errorStr.includes('ENOTFOUND') ||
    errorStr.includes('temporarily unavailable') ||
    errorStr.includes('service unavailable') ||
    errorStr.includes('503')
  ) {
    return {
      type: RetryableErrorType.TRANSIENT,
      reason: 'Transient network/server error',
      suggestedDelay,
    };
  }

  // Unknown errors - treat as transient by default
  return {
    type: RetryableErrorType.TRANSIENT,
    reason: 'Unknown error - will retry',
    suggestedDelay,
  };
}

/**
 * Calculate delay for a retry attempt
 * 
 * @param attempt - Attempt number (0-indexed)
 * @param config - Retry configuration
 * @param overrideDelay - Override the calculated delay (e.g., from retry-after header)
 * @returns Delay in milliseconds
 */
export function calculateDelay(
  attempt: number,
  config: RetryConfig,
  overrideDelay?: number,
): number {
  if (overrideDelay !== undefined && overrideDelay > 0) {
    return Math.min(overrideDelay, config.maxDelayMs);
  }

  let delay: number;

  switch (config.backoffStrategy) {
    case 'linear':
      delay = config.baseDelayMs * (attempt + 1);
      break;

    case 'exponential':
      delay = config.baseDelayMs * Math.pow(config.multiplier, attempt);
      break;

    case 'exponential-jitter':
    default:
      delay = config.baseDelayMs * Math.pow(config.multiplier, attempt);
      if (config.jitter) {
        // Add random jitter: ±20% of calculated delay
        const jitterAmount = delay * 0.2;
        const jitter = (Math.random() - 0.5) * 2 * jitterAmount;
        delay = Math.max(config.baseDelayMs, delay + jitter);
      }
      break;
  }

  return Math.min(delay, config.maxDelayMs);
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 */
export async function executeWithRetry<T>(
  fn: (attempt: number) => Promise<T>,
  config: Partial<RetryConfig> = {},
  onRetry?: (attempt: number, error: Error, nextDelayMs: number) => void,
): Promise<RetryResult<T>> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | undefined;
  let totalDelayMs = 0;
  let lastErrorClassification: ErrorClassification | undefined;

  for (let attempt = 0; attempt < finalConfig.maxAttempts; attempt++) {
    try {
      const result = await fn(attempt);
      return {
        success: true,
        data: result,
        attempts: attempt + 1,
        totalDelayMs,
        retryable: false,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      lastErrorClassification = classifyError(error);

      // If error is permanent, stop retrying
      if (lastErrorClassification.type === RetryableErrorType.PERMANENT) {
        return {
          success: false,
          error: lastError,
          attempts: attempt + 1,
          totalDelayMs,
          lastError,
          retryable: false,
        };
      }

      // On last attempt, return failure
      if (attempt === finalConfig.maxAttempts - 1) {
        return {
          success: false,
          error: lastError,
          attempts: attempt + 1,
          totalDelayMs,
          lastError,
          retryable: true, // Could succeed with more retries
        };
      }

      // Calculate delay before next attempt
      const nextDelayMs = calculateDelay(
        attempt,
        finalConfig,
        lastErrorClassification.suggestedDelay,
      );
      totalDelayMs += nextDelayMs;

      // Notify about retry
      if (onRetry) {
        onRetry(attempt + 1, lastError, nextDelayMs);
      }

      // Wait before retry
      await sleep(nextDelayMs);
    }
  }

  // Should not reach here, but return failure if we do
  return {
    success: false,
    error: lastError,
    attempts: finalConfig.maxAttempts,
    totalDelayMs,
    lastError,
    retryable: true,
  };
}

/**
 * Execute function with model/option rotation retry
 * 
 * Tries each option in sequence with retries, moving to next option on failure.
 */
export async function executeWithRotation<T, O>(
  options: O[],
  fn: (option: O, attempt: number) => Promise<T>,
  config: Partial<RetryConfig> = {},
  onRetry?: (option: O, attempt: number, error: Error, nextDelayMs: number) => void,
  onRotate?: (fromOption: O, toOption: O, reason: string) => void,
): Promise<RetryResult<T>> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let totalDelayMs = 0;
  let lastError: Error | undefined;
  let totalAttempts = 0;

  for (let optionIdx = 0; optionIdx < options.length; optionIdx++) {
    const option = options[optionIdx];

    for (let attempt = 0; attempt < finalConfig.maxAttempts; attempt++) {
      totalAttempts++;

      try {
        const result = await fn(option, attempt);
        return {
          success: true,
          data: result,
          attempts: totalAttempts,
          totalDelayMs,
          retryable: false,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const classification = classifyError(error);

        // Permanent error - try next option
        if (classification.type === RetryableErrorType.PERMANENT) {
          if (onRotate && optionIdx < options.length - 1) {
            onRotate(option, options[optionIdx + 1], classification.reason);
          }
          break; // Move to next option
        }

        // Last attempt with this option
        if (attempt === finalConfig.maxAttempts - 1) {
          if (optionIdx < options.length - 1) {
            if (onRetry) {
              onRetry(option, attempt + 1, lastError, 0);
            }
            if (onRotate) {
              onRotate(option, options[optionIdx + 1], 'Max retries exceeded');
            }
            break; // Move to next option
          }
          continue; // Try next option
        }

        // Calculate delay before retry with same option
        const nextDelayMs = calculateDelay(
          attempt,
          finalConfig,
          classification.suggestedDelay,
        );
        totalDelayMs += nextDelayMs;

        if (onRetry) {
          onRetry(option, attempt + 1, lastError, nextDelayMs);
        }

        await sleep(nextDelayMs);
      }
    }
  }

  // All options exhausted
  return {
    success: false,
    error: lastError,
    attempts: totalAttempts,
    totalDelayMs,
    lastError,
    retryable: true,
  };
}

/**
 * Format retry result for logging
 */
export function formatRetryResult<T>(result: RetryResult<T>): string {
  if (result.success) {
    return `Success after ${result.attempts} attempt(s), ${result.totalDelayMs}ms total delay`;
  }

  const retryable = result.retryable ? 'retryable' : 'permanent';
  const errorMsg = result.error instanceof Error
    ? result.error.message
    : String(result.error);

  return `Failed after ${result.attempts} attempt(s), ${result.totalDelayMs}ms total delay [${retryable}]: ${errorMsg}`;
}
