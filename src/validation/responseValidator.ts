/**
 * Centralized API Response Validation
 * 
 * Validates responses from:
 * - Pollinations API (image generation, text generation, chat)
 * - Gemini API (content generation)
 * - MCP tool responses (Call Tool Result format)
 * - Dev tools (file operations, bash, etc.)
 * - Agent outputs (React reasoning steps and final results)
 * 
 * Features:
 * - Type-safe validation using Zod
 * - Detailed error reporting
 * - Graceful fallbacks for backward compatibility
 * - Automatic response normalization
 */

import { z } from 'zod/v4';
import {
  PollinationsImageResponseSchema,
  PollinationsTextResponseSchema,
  PollinationsChatResponseSchema,
  GeminiGenerateContentResponseSchema,
  CallToolResultSchema,
  DevToolResultSchema,
  APIResponseSchema,
  type PollinationsImageResponse,
  type PollinationsTextResponse,
  type PollinationsChatResponse,
  type GeminiGenerateContentResponse,
  type CallToolResult,
  type DevToolResult,
  type APIResponse,
} from '../types/schemas.js';
export { validateReactStep, validateReactResult } from '@barok/engine';

/**
 * Validation error context
 */
export class ResponseValidationError extends Error {
  constructor(
    public readonly apiType: string,
    public readonly fieldPath: string,
    public readonly expectedType: string,
    public readonly receivedValue: unknown,
    message: string,
  ) {
    super(
      `Error: ${apiType} API response validation failed\n` +
      `Cause: ${message}\n` +
      `Suggested Fix: Verify ${apiType} API is responding correctly. Check service status and API documentation.\n` +
      `Context: Field: ${fieldPath}, Expected: ${expectedType}, Received: ${typeof receivedValue}`
    );
    this.name = 'ResponseValidationError';
  }
}

/**
 * Response validation result with detailed error information
 */
export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: Array<{
    field: string;
    message: string;
  }>;
  warnings?: string[];
}

/**
 * Validates Pollinations image generation response
 */
export function validatePollinationsImageResponse(data: unknown): ValidationResult<PollinationsImageResponse> {
  try {
    const validated = PollinationsImageResponseSchema.parse(data);
    return { success: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        errors: error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      };
    }
    return {
      success: false,
      errors: [{ field: 'root', message: `Unknown validation error: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
}

/**
 * Validates Pollinations text generation response
 */
export function validatePollinationsTextResponse(data: unknown): ValidationResult<PollinationsTextResponse> {
  try {
    const validated = PollinationsTextResponseSchema.parse(data);
    return { success: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        errors: error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      };
    }
    return {
      success: false,
      errors: [{ field: 'root', message: `Unknown validation error: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
}

/**
 * Validates Pollinations chat completion response
 */
export function validatePollinationsChatResponse(data: unknown): ValidationResult<PollinationsChatResponse> {
  try {
    const validated = PollinationsChatResponseSchema.parse(data);
    return { success: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        errors: error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      };
    }
    return {
      success: false,
      errors: [{ field: 'root', message: `Unknown validation error: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
}

/**
 * Validates Gemini API response
 */
export function validateGeminiResponse(data: unknown): ValidationResult<GeminiGenerateContentResponse> {
  try {
    const validated = GeminiGenerateContentResponseSchema.parse(data);
    
    // Extract text from nested structure if present
    const warnings: string[] = [];
    if (validated.candidates && validated.candidates.length > 0) {
      warnings.push(`Response had ${validated.candidates.length} candidates; using first`);
    }
    
    return { success: true, data: validated, warnings };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        errors: error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      };
    }
    return {
      success: false,
      errors: [{ field: 'root', message: `Unknown validation error: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
}

/**
 * Validates MCP CallToolResult response
 */
export function validateCallToolResult(data: unknown): ValidationResult<CallToolResult> {
  try {
    const validated = CallToolResultSchema.parse(data);
    return { success: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        errors: error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      };
    }
    return {
      success: false,
      errors: [{ field: 'root', message: `Unknown validation error: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
}

/**
 * Validates dev tool response (file operations, bash, etc.)
 */
export function validateDevToolResult(data: unknown): ValidationResult<DevToolResult> {
  try {
    const validated = DevToolResultSchema.parse(data);
    return { success: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        errors: error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      };
    }
    return {
      success: false,
      errors: [{ field: 'root', message: `Unknown validation error: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
}

/**
 * Generic response validator - attempts to validate against any API response type
 */
export function validateAPIResponse(data: unknown): ValidationResult<APIResponse> {
  try {
    const validated = APIResponseSchema.parse(data);
    return { success: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        errors: error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      };
    }
    return {
      success: false,
      errors: [{ field: 'root', message: `Unknown validation error: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
}

/**
 * Response validation with logging and error context
 */
export interface ValidatorOptions {
  logErrors?: boolean;
  throwOnError?: boolean;
  logPrefix?: string;
}

/**
 * Creates a validated response with error context and logging
 */
export function createValidatedResponse<T>(
  data: unknown,
  schema: z.ZodSchema,
  apiType: string,
  options: ValidatorOptions = {},
): T | null {
  const { logErrors = true, throwOnError = false, logPrefix = '[Response Validation]' } = options;

  try {
    return schema.parse(data) as T;
  } catch (error) {
    const message = error instanceof z.ZodError
      ? `${apiType} response validation failed: ${error.issues.map(i => `${i.path.join('.')} - ${i.message}`).join('; ')}`
      : `${apiType} validation error: ${error instanceof Error ? error.message : String(error)}`;

    if (logErrors) {
      console.error(`${logPrefix} ${message}`);
    }

    if (throwOnError) {
      throw new ResponseValidationError(
        apiType,
        error instanceof z.ZodError ? error.issues[0]?.path.join('.') ?? 'root' : 'root',
        'See message for details',
        data,
        message,
      );
    }

    return null;
  }
}

/**
 * Safe response extraction helper - returns data or null on validation failure
 */
export function safeValidateResponse<T>(
  data: unknown,
  validator: (data: unknown) => ValidationResult<T>,
  apiType: string = 'API',
): T | null {
  const result = validator(data);

  if (!result.success) {
    console.error(`[${apiType}] Response validation failed:`, result.errors);
    return null;
  }

  if (result.warnings?.length) {
    console.warn(`[${apiType}] Response warnings:`, result.warnings);
  }

  return result.data ?? null;
}

/**
 * Batch validate multiple responses
 */
export function validateResponseBatch<T>(
  responses: unknown[],
  validator: (data: unknown) => ValidationResult<T>,
  apiType: string = 'API',
): Array<{ success: boolean; data?: T; error?: string; index: number }> {
  return responses.map((data, index) => {
    const result = validator(data);
    return {
      index,
      success: result.success,
      data: result.data,
      error: result.errors?.map(e => `${e.field}: ${e.message}`).join('; '),
    };
  });
}
