/**
 * String and format validation utilities
 * 
 * Centralized helpers for common string validation patterns:
 * - API key format validation
 * - URL/URI validation
 * - JSON string validation and extraction
 * - Pattern matching (startsWith, includes, regex)
 */

/**
 * Validates Pollinations API key format
 * @param apiKey - The API key to validate
 * @returns true if valid (starts with 'pk_' or 'sk_'), false otherwise
 */
export function isValidPollinationsApiKey(apiKey: string): boolean {
  return apiKey.startsWith('pk_') || apiKey.startsWith('sk_');
}

/**
 * Validates Gemini API key format
 * @param apiKey - The API key to validate
 * @returns true if valid Gemini key format, false otherwise
 */
export function isValidGeminiApiKey(apiKey: string): boolean {
  // Gemini supports legacy standard keys and newer auth keys such as AQ.*.
  return apiKey.length >= 20 && /^[a-zA-Z0-9._\-]+$/.test(apiKey);
}

/**
 * Validates generic API key presence and non-emptiness
 * @param apiKey - The API key to validate
 * @returns true if non-empty string, false otherwise
 */
export function hasValidApiKey(apiKey: string | undefined): boolean {
  return Boolean(apiKey?.trim());
}

/**
 * Validation result for API key checks
 */
export interface ApiKeyValidationResult {
  valid: boolean;
  key?: string;
  error?: string;
}

/**
 * Comprehensive API key validation
 * @param apiKey - The API key to validate
 * @param provider - The provider name (e.g., 'Pollinations', 'Gemini')
 * @param strict - If true, use strict format validation; if false, only check non-empty
 * @returns Validation result with error message if invalid
 */
export function validateApiKey(
  apiKey: string | undefined,
  provider: 'Pollinations' | 'Gemini' = 'Pollinations',
  strict = true
): ApiKeyValidationResult {
  if (!hasValidApiKey(apiKey)) {
    return {
      valid: false,
      error: `${provider} API key is empty or not set`,
    };
  }

  const trimmedKey = apiKey!.trim();

  if (!strict) {
    return { valid: true, key: trimmedKey };
  }

  if (provider === 'Pollinations') {
    if (!isValidPollinationsApiKey(trimmedKey)) {
      return {
        valid: false,
        error: `Invalid ${provider} API key format — must start with pk_ or sk_`,
      };
    }
  } else if (provider === 'Gemini') {
    if (!isValidGeminiApiKey(trimmedKey)) {
      return {
        valid: false,
        error: `Invalid ${provider} API key format — expected a standard API key or auth key`,
      };
    }
  }

  return { valid: true, key: trimmedKey };
}

/**
 * JSON extraction result
 */
export interface JsonExtractionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  rawString?: string;
}

/**
 * Safely parse a JSON string with detailed error reporting
 * @param jsonStr - The JSON string to parse
 * @returns Extraction result with parsed data or error
 */
export function parseJsonString<T = unknown>(jsonStr: string): JsonExtractionResult<T> {
  if (!jsonStr || typeof jsonStr !== 'string') {
    return {
      success: false,
      error: 'JSON string is empty or not a string',
      rawString: jsonStr,
    };
  }

  try {
    const parsed = JSON.parse(jsonStr) as T;
    return {
      success: true,
      data: parsed,
      rawString: jsonStr,
    };
  } catch (parseError) {
    return {
      success: false,
      error: parseError instanceof Error ? parseError.message : 'Unknown parse error',
      rawString: jsonStr.substring(0, 200),
    };
  }
}

/**
 * Pattern validation result
 */
export interface PatternValidationResult {
  valid: boolean;
  matches: string[];
  error?: string;
}

/**
 * Check if a string starts with any of the given prefixes
 * @param str - String to check
 * @param prefixes - Array of prefixes to match against
 * @returns Validation result with matching prefix
 */
export function startsWithAny(str: string, prefixes: string[]): PatternValidationResult {
  if (!str) {
    return {
      valid: false,
      matches: [],
      error: 'Input string is empty',
    };
  }

  const matches = prefixes.filter(prefix => str.startsWith(prefix));
  return {
    valid: matches.length > 0,
    matches,
    error: matches.length === 0
      ? `String does not start with any of: ${prefixes.join(', ')}`
      : undefined,
  };
}

/**
 * Check if a string includes all of the given substrings
 * @param str - String to check
 * @param substrings - Array of substrings that must be included
 * @returns Validation result with matching substrings
 */
export function includesAll(str: string, substrings: string[]): PatternValidationResult {
  if (!str) {
    return {
      valid: false,
      matches: [],
      error: 'Input string is empty',
    };
  }

  const matches = substrings.filter(sub => str.includes(sub));
  return {
    valid: matches.length === substrings.length,
    matches,
    error: matches.length < substrings.length
      ? `String does not include all required substrings. Missing: ${
          substrings.filter(s => !matches.includes(s)).join(', ')
        }`
      : undefined,
  };
}

/**
 * Check if a string matches a regex pattern
 * @param str - String to check
 * @param pattern - Regular expression pattern or string
 * @returns Validation result with match details
 */
export function matchesPattern(
  str: string,
  pattern: RegExp | string
): PatternValidationResult {
  if (!str) {
    return {
      valid: false,
      matches: [],
      error: 'Input string is empty',
    };
  }

  try {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    const matches = str.match(regex) || [];
    return {
      valid: matches.length > 0,
      matches,
      error: matches.length === 0 ? `String does not match pattern: ${pattern}` : undefined,
    };
  } catch (regexError) {
    return {
      valid: false,
      matches: [],
      error: `Invalid regex pattern: ${regexError instanceof Error ? regexError.message : 'Unknown error'}`,
    };
  }
}

/**
 * HTTP response validation result
 */
export interface HttpResponseValidationResult {
  valid: boolean;
  status?: number;
  statusText?: string;
  error?: string;
}

/**
 * Validate HTTP response status
 * @param status - HTTP status code
 * @param statusText - HTTP status text
 * @param acceptedStatuses - Array of accepted status codes (default: [200, 201, 204])
 * @returns Validation result
 */
export function isValidHttpStatus(
  status: number,
  statusText: string = '',
  acceptedStatuses: number[] = [200, 201, 204]
): HttpResponseValidationResult {
  if (acceptedStatuses.includes(status)) {
    return {
      valid: true,
      status,
      statusText,
    };
  }

  return {
    valid: false,
    status,
    statusText,
    error: `HTTP ${status}: ${statusText || 'Error'}. Expected one of: ${acceptedStatuses.join(', ')}`,
  };
}

/**
 * Validate HTTP response as successful (2xx status)
 * @param status - HTTP status code
 * @returns true if status is in 200-299 range
 */
export function isHttpSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Validate HTTP response as client error (4xx status)
 * @param status - HTTP status code
 * @returns true if status is in 400-499 range
 */
export function isHttpClientError(status: number): boolean {
  return status >= 400 && status < 500;
}

/**
 * Validate HTTP response as server error (5xx status)
 * @param status - HTTP status code
 * @returns true if status is in 500-599 range
 */
export function isHttpServerError(status: number): boolean {
  return status >= 500 && status < 600;
}

/**
 * Check if string is a valid URL
 * @param str - String to check
 * @returns true if valid URL format
 */
export function isValidUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Truncate string to max length with ellipsis
 * @param str - String to truncate
 * @param maxLength - Maximum length before truncation
 * @param suffix - Suffix to append (default: '...')
 * @returns Truncated string
 */
export function truncateString(str: string, maxLength: number = 100, suffix = '...'): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * Safely extract property from string (e.g., "key: value" → "value")
 * @param str - String to parse
 * @param separator - Separator character
 * @returns Array of parts
 */
export function splitString(str: string, separator: string = ':'): string[] {
  return str.split(separator).map(part => part.trim()).filter(Boolean);
}

/**
 * Model type checking utilities
 */

/**
 * Check if model is a Gemini model
 * @param modelName - The model name to check
 * @param geminiModelList - Optional list of specific Gemini models
 * @returns true if model is Gemini or matches list
 */
export function isGeminiModel(
  modelName: string,
  geminiModelList?: string[]
): boolean {
  if (geminiModelList && geminiModelList.includes(modelName)) {
    return true;
  }
  return modelName.startsWith('gemini');
}

/**
 * Check if model is a Pollinations model
 * @param modelName - The model name to check
 * @returns true if model is likely a Pollinations model
 */
export function isPollinationsModel(modelName: string): boolean {
  return !modelName.startsWith('gemini');
}

/**
 * Check if model supports rotation/bypass
 * @param modelName - The model name to check
 * @param bypassList - Optional list of models that support bypass
 * @returns true if model supports rotation
 */
export function supportsModelRotation(modelName: string, bypassList?: string[]): boolean {
  if (bypassList && bypassList.includes(modelName)) {
    return true;
  }
  return modelName.startsWith('gemini');
}
