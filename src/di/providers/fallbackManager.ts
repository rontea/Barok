import type { LLMProvider } from '../types.js';

interface RetryConfig {
  maxAttempts?: number;
  delayMs?: number;
  backoffMultiplier?: number;
  fallbackProviders?: string[];
}

interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  attemptedProviders: string[];
  attemptedModels: string[];
  lastError?: Error;
  delayMs?: number;
}

export class ProviderFallbackManager {
  private providers: Map<string, LLMProvider> = new Map();
  private retryConfig: Required<RetryConfig>;

  constructor(config: RetryConfig = {}) {
    this.retryConfig = {
      maxAttempts: config.maxAttempts || 3,
      delayMs: config.delayMs || 1000,
      backoffMultiplier: config.backoffMultiplier || 1.5,
      fallbackProviders: config.fallbackProviders || ['gemini', 'pollinations', 'claude'],
    };
  }

  registerProvider(name: string, provider: LLMProvider): void {
    this.providers.set(name, provider);
  }

  getProvider(name: string): LLMProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Retry operation with fallback to alternative providers
   */
  async retryWithFallback<T>(
    operation: (provider: LLMProvider, providerName: string) => Promise<T>,
    primaryProvider: string,
    fallbackProviders?: string[]
  ): Promise<RetryResult<T>> {
    const providers = [
      primaryProvider,
      ...(fallbackProviders || this.retryConfig.fallbackProviders).filter(
        (p) => p !== primaryProvider
      ),
    ];

    const attemptedProviders: string[] = [];
    const attemptedModels: string[] = [];
    let lastError: Error | undefined;
    let delayMs = this.retryConfig.delayMs;

    for (let attempt = 0; attempt < this.retryConfig.maxAttempts; attempt++) {
      for (const providerName of providers) {
        const provider = this.getProvider(providerName);
        if (!provider) {
          console.warn(`Provider not registered: ${providerName}`);
          continue;
        }

        attemptedProviders.push(providerName);

        try {
          console.log(
            `[Retry ${attempt + 1}/${this.retryConfig.maxAttempts}] Attempting ${providerName}`
          );
          const result = await operation(provider, providerName);
          return {
            success: true,
            data: result,
            attemptedProviders,
            attemptedModels,
          };
        } catch (error: any) {
          lastError = error;
          const errorMessage = error?.message || String(error);
          console.warn(
            `[Retry ${attempt + 1}/${this.retryConfig.maxAttempts}] ${providerName} failed: ${errorMessage.substring(0, 100)}`
          );

          // Check if error is retryable
          if (!isRetryableError(error)) {
            console.warn(`Non-retryable error, stopping attempts for ${providerName}`);
            break;
          }

          // Wait before retry
          if (attempt < this.retryConfig.maxAttempts - 1 || providers.length > 1) {
            await sleep(delayMs);
            delayMs = Math.round(delayMs * this.retryConfig.backoffMultiplier);
          }
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || 'All providers failed',
      attemptedProviders,
      attemptedModels,
      lastError,
      delayMs,
    };
  }

  /**
   * Retry single provider with model fallback
   */
  async retryWithModelFallback<T>(
    operation: (provider: LLMProvider, model: string) => Promise<T>,
    provider: LLMProvider,
    primaryModel: string,
    fallbackModels?: string[]
  ): Promise<RetryResult<T>> {
    const models = [primaryModel, ...(fallbackModels || [])];
    const attemptedModels: string[] = [];
    let lastError: Error | undefined;
    let delayMs = this.retryConfig.delayMs;

    for (let attempt = 0; attempt < this.retryConfig.maxAttempts; attempt++) {
      for (const model of models) {
        attemptedModels.push(model);

        try {
          console.log(
            `[Retry ${attempt + 1}/${this.retryConfig.maxAttempts}] Attempting model ${model}`
          );
          const result = await operation(provider, model);
          return {
            success: true,
            data: result,
            attemptedProviders: [model],
            attemptedModels,
          };
        } catch (error: any) {
          lastError = error;
          const errorMessage = error?.message || String(error);
          console.warn(
            `[Retry ${attempt + 1}/${this.retryConfig.maxAttempts}] Model ${model} failed: ${errorMessage.substring(0, 100)}`
          );

          if (!isRetryableError(error)) {
            console.warn(`Non-retryable error for model ${model}`);
            break;
          }

          if (attempt < this.retryConfig.maxAttempts - 1 || models.length > 1) {
            await sleep(delayMs);
            delayMs = Math.round(delayMs * this.retryConfig.backoffMultiplier);
          }
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || 'All models failed',
      attemptedProviders: ['single-provider'],
      attemptedModels,
      lastError,
      delayMs,
    };
  }

  /**
   * Get sorted providers by fallback order
   */
  getProviderFallbackOrder(primary: string): string[] {
    const order = [primary];
    for (const provider of this.retryConfig.fallbackProviders) {
      if (provider !== primary && !order.includes(provider)) {
        order.push(provider);
      }
    }
    return order;
  }
}

/**
 * Determine if an error is retryable
 */
function isRetryableError(error: any): boolean {
  const message = error?.message?.toLowerCase() || '';
  const code = error?.code || error?.status;

  // Non-retryable errors
  if (message.includes('authentication') || message.includes('invalid')) {
    return false;
  }
  if (code === 401 || code === 403) {
    return false;
  }
  if (message.includes('permission')) {
    return false;
  }

  // Retryable errors
  if (message.includes('timeout') || message.includes('econnrefused')) {
    return true;
  }
  if (code === 429 || code === 503 || code === 502) {
    return true;
  }
  if (message.includes('rate limit') || message.includes('quota')) {
    return true;
  }

  // Default: attempt retry
  return true;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format error message for user display
 */
export function formatFallbackErrorMessage(
  result: RetryResult<any>,
  primaryProvider: string
): string {
  const providers = [...new Set(result.attemptedProviders)];
  const models = [...new Set(result.attemptedModels)];

  if (result.success) {
    return 'Success';
  }

  let message = `All LLM providers failed: `;

  if (providers.length === 1) {
    message += `${providers[0]}: ${result.error}`;
  } else {
    message += providers.map((p) => `${p}: attempted`).join(', ');
  }

  if (models.length > 0) {
    message += ` (Models: ${models.join(', ')})`;
  }

  message += ` (${result.attemptedProviders.length} attempts)`;

  return message;
}

/**
 * Create suggested fixes based on error
 */
export function getSuggestedFixes(error: any, provider: string): string[] {
  const message = error?.message?.toLowerCase() || '';
  const fixes: string[] = [];

  if (message.includes('authentication') || message.includes('401')) {
    fixes.push(`Verify ${provider} API key is valid and not expired`);
    fixes.push(`Check ${provider} service status and authentication scopes`);
  }

  if (message.includes('rate limit') || message.includes('429')) {
    fixes.push('Wait a few moments before retrying');
    fixes.push(`Check ${provider} rate limit quotas`);
    fixes.push('Use multiple API keys for load balancing');
  }

  if (message.includes('quota') || message.includes('exhausted')) {
    fixes.push(`Request quota increase in ${provider} console`);
    fixes.push('Use alternative provider or API key');
    fixes.push('Wait for quota reset (usually daily)');
  }

  if (message.includes('timeout') || message.includes('connection')) {
    fixes.push(`Check ${provider} service availability`);
    fixes.push('Verify network connectivity');
    fixes.push('Retry after a moment');
  }

  if (message.includes('permission') || message.includes('blocked')) {
    fixes.push(`Enable required APIs in ${provider} console`);
    fixes.push('Check if API key has necessary permissions');
    fixes.push('Remove any API key restrictions');
  }

  if (fixes.length === 0) {
    fixes.push(`Check ${provider} API configuration`);
    fixes.push('Review error logs for more details');
    fixes.push('Contact support if issues persist');
  }

  return fixes;
}
