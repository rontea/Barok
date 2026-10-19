/**
 * Structured error message formatting utility
 * Provides consistent error message format across the codebase:
 * - Error: Brief description
 * - Cause: Root cause analysis
 * - Suggested Fix: Actionable remediation steps
 * - Context: Additional diagnostic information
 */

export interface FormattedError {
  error: string;
  cause: string;
  suggestedFix: string;
  context: string;
}

/**
 * Formats an error message using the standard structure
 */
export function formatError(
  error: string,
  cause: string,
  suggestedFix: string,
  context: string
): string {
  return (
    `Error: ${error}\n` +
    `Cause: ${cause}\n` +
    `Suggested Fix: ${suggestedFix}\n` +
    `Context: ${context}`
  );
}

/**
 * API-specific error formatter
 */
export function formatApiError(
  apiName: string,
  statusCode: number | string,
  message: string,
  details?: Record<string, unknown>
): string {
  return formatError(
    `${apiName} API request failed`,
    `HTTP ${statusCode} error from ${apiName} service`,
    `Verify API credentials, check service status, and ensure proper quota availability. Inspect logs for detailed error.`,
    `API: ${apiName}, Status: ${statusCode}, Message: ${message}${details ? `, Details: ${JSON.stringify(details)}` : ''}`
  );
}

/**
 * Timeout-specific error formatter
 */
export function formatTimeoutError(
  toolName: string,
  timeoutMs: number,
  operation: string = 'execution'
): string {
  return formatError(
    `"${toolName}" ${operation} timed out`,
    `Operation did not complete within ${timeoutMs}ms limit`,
    `Increase timeout value, optimize tool implementation, or break operation into smaller tasks`,
    `Tool: ${toolName}, Timeout: ${timeoutMs}ms, Operation: ${operation}`
  );
}

/**
 * Validation error formatter
 */
export function formatValidationError(
  fieldName: string,
  expectedType: string,
  receivedValue: unknown,
  context: string = ''
): string {
  return formatError(
    `Validation failed for field: ${fieldName}`,
    `Field received unexpected type. Expected ${expectedType}, got ${typeof receivedValue}`,
    `Verify input data matches schema requirements. Check API documentation for valid formats.`,
    `Field: ${fieldName}, Expected: ${expectedType}, Received: ${JSON.stringify(receivedValue)}${context ? `, Context: ${context}` : ''}`
  );
}

/**
 * Authentication error formatter
 */
export function formatAuthError(
  service: string,
  missingCredential: string
): string {
  return formatError(
    `Authentication failed for ${service}`,
    `Required credential "${missingCredential}" not provided`,
    `Set environment variable ${missingCredential} or provide credentials through configuration`,
    `Service: ${service}, Missing: ${missingCredential}`
  );
}

/**
 * File operation error formatter
 */
export function formatFileError(
  operation: string,
  filePath: string,
  reason: string
): string {
  return formatError(
    `File ${operation} operation failed`,
    `Could not ${operation} file: ${reason}`,
    `Verify file permissions, check file exists/doesn't exist, ensure path is accessible`,
    `Operation: ${operation}, File: ${filePath}, Reason: ${reason}`
  );
}

/**
 * Fallback chain error formatter - when all providers fail
 */
export function formatFallbackChainError(
  primaryProvider: string,
  fallbackProviders: Array<{ name: string; error: string }>,
  context: string = ''
): string {
  const fallbackSummary = fallbackProviders
    .map((fb, i) => `  ${i + 1}) ${fb.name}: ${fb.error}`)
    .join('\n');

  return formatError(
    `All LLM providers exhausted`,
    `Primary provider ${primaryProvider} failed and all fallback chains failed:\n${fallbackSummary}`,
    `Check API keys and quotas for all providers. Verify service availability. Try again after interval.`,
    `${context || 'No additional context available'}`
  );
}

/**
 * Parsing error formatter
 */
export function formatParseError(
  parseType: string,
  input: string,
  reason: string
): string {
  return formatError(
    `Failed to parse ${parseType}`,
    `Invalid ${parseType} format: ${reason}`,
    `Verify input follows correct format. Check documentation for valid syntax. Enable debug logging.`,
    `Type: ${parseType}, Input: ${input.substring(0, 100)}${input.length > 100 ? '...' : ''}, Reason: ${reason}`
  );
}
