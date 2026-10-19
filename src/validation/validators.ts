import { z } from 'zod/v4';

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

type SafeParseReturnType<T, U> = { success: true; data: U; } | { success: false; error: z.ZodError; };


export class Validator {
  static schema<T extends z.ZodType>(schema: T) {
    return {
      validate: (data: unknown): SafeParseReturnType<unknown, z.infer<T>> => {
        return schema.safeParse(data) as SafeParseReturnType<unknown, z.infer<T>>;
      },
      parse: (data: unknown): z.infer<T> => {
        return schema.parse(data);
      },
    };
  }
}

// Tool argument validators
export const validators = {
  bash: Validator.schema(
    z.object({
      command: z.string().min(1),
      cwd: z.string().optional(),
      timeout: z.number().int().min(100).max(300000).default(30000),
    })
  ),

  readFile: Validator.schema(
    z.object({
      file_path: z.string().min(1),
      offset: z.number().int().min(1).optional(),
      limit: z.number().int().positive().optional(),
    })
  ),

  writeFile: Validator.schema(
    z.object({
      file_path: z.string().min(1),
      content: z.string(),
    })
  ),

  editFile: Validator.schema(
    z.object({
      file_path: z.string().min(1),
      old_string: z.string().min(1),
      new_string: z.string(),
    })
  ),

  glob: Validator.schema(
    z.object({
      pattern: z.string().min(1),
    })
  ),

  grep: Validator.schema(
    z.object({
      pattern: z.string().min(1),
      path: z.string().optional(),
      type: z.enum(['content', 'files_with_matches']).default('files_with_matches'),
    })
  ),

  generateImage: Validator.schema(
    z.object({
      prompt: z.string().min(3).max(1000),
      model: z.string().default('flux'),
      width: z.number().int().min(256).max(2048).default(1024),
      height: z.number().int().min(256).max(2048).default(1024),
      enhance: z.boolean().default(true),
      seed: z.number().int().optional(),
      quality: z.enum(['low', 'medium', 'high', 'hd']).default('high'),
    })
  ),

  generateText: Validator.schema(
    z.object({
      prompt: z.string().min(1).max(10000),
      model: z.string().default('openai'),
      temperature: z.number().min(0).max(2).default(0.7),
      max_tokens: z.number().int().min(1).max(32768).default(1024),
    })
  ),

  chatCompletion: Validator.schema(
    z.object({
      messages: z.array(
        z.object({
          role: z.enum(['system', 'user', 'assistant']),
          content: z.string(),
        })
      ).min(1),
      model: z.string().default('openai'),
      tools: z.array(z.any()).optional(),
    })
  ),
};

export type ValidationResult<T> = {
  isValid: boolean;
  data?: T;
  error?: string;
};

export function validateToolCall(toolName: string, args: unknown): ValidationResult<unknown> {
  const validator = (validators as any)[toolName.toLowerCase()];
  if (!validator) {
    return { isValid: false, error: `Unknown tool: ${toolName}` };
  }

  const result = validator.validate(args);
  if (result.success) {
    return { isValid: true, data: result.data };
  } else {
    return {
      isValid: false,
      error: result.error?.issues?.[0]?.message || 'Validation failed',
    };
  }
}
