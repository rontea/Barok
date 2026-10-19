import { defineSchema, field, validator } from './json-schema.js';
import { ReactStepResponseSchema, ReactResultResponseSchema } from '@barok/engine';
import { z } from 'zod/v4';

export { ReactStepResponseSchema, ReactResultResponseSchema };
export type { ReactStepResponse, ReactResultResponse } from '@barok/engine';

// ============================================================================
// POLLINATIONS API SCHEMAS
// ============================================================================

export const ImageGenerationSchema = defineSchema({
  name: 'generateImage',
  description: 'Generate an image from text prompt using Pollinations AI',
  fields: {
    prompt: field({
      type: 'string',
      description: 'Text description of the image to generate',
      required: true,
    }),
    model: field({
      type: 'string',
      description: 'Model to use: flux, turbo, gptimage, kontext, seedream, etc.',
      required: false,
      default: 'flux',
    }),
    width: field({
      type: 'integer',
      description: 'Image width in pixels (default: 1024)',
      required: false,
      default: 1024,
      validator: validator.number().int().min(256).max(2048),
    }),
    height: field({
      type: 'integer',
      description: 'Image height in pixels (default: 1024)',
      required: false,
      default: 1024,
      validator: validator.number().int().min(256).max(2048),
    }),
    seed: field({
      type: 'integer',
      description: 'Random seed for reproducible results',
      required: false,
    }),
    enhance: field({
      type: 'boolean',
      description: 'Whether to enhance the prompt automatically',
      required: false,
      default: true,
    }),
    negative_prompt: field({
      type: 'string',
      description: 'What to avoid in the generated image',
      required: false,
    }),
    quality: field({
      type: 'string',
      description: 'Quality: low, medium, high, hd',
      required: false,
      default: 'high',
      enum: ['low', 'medium', 'high', 'hd'],
    }),
  },
});

export const TextGenerationSchema = defineSchema({
  name: 'generateText',
  description: 'Generate text using Pollinations AI models',
  fields: {
    prompt: field({
      type: 'string',
      description: 'Text prompt for generation',
      required: true,
    }),
    model: field({
      type: 'string',
      description: 'Model: openai, claude, deepseek, gemini, mistral, etc.',
      required: false,
      default: 'openai',
    }),
    temperature: field({
      type: 'number',
      description: 'Sampling temperature (0.0-2.0)',
      required: false,
      default: 0.7,
      validator: validator.number().min(0).max(2),
    }),
    max_tokens: field({
      type: 'integer',
      description: 'Maximum tokens to generate',
      required: false,
      default: 1024,
      validator: validator.number().int().min(1).max(32768),
    }),
  },
});

export const ChatCompletionSchema = defineSchema({
  name: 'chatCompletion',
  description: 'OpenAI-compatible chat completion with tool calling',
  fields: {
    messages: field({
      type: 'array',
      description: 'Array of message objects (role, content)',
      required: true,
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['system', 'user', 'assistant'] },
          content: { type: 'string' },
        },
      },
    }),
    model: field({
      type: 'string',
      description: 'Model to use',
      required: false,
      default: 'openai',
    }),
    tools: field({
      type: 'array',
      description: 'Optional tools/functions the model can call',
      required: false,
    }),
  },
});

// ============================================================================
// DEV TOOLS SCHEMAS (FILE, SHELL, SEARCH)
// ============================================================================

const COMMAND_OPERATIONS = [
  'git_status',
  'git_diff',
  'git_log',
  'verify',
  'smoke',
  'test',
  'build',
  'lint',
  'typecheck',
  'file_exists',
  'list_directory',
  'process_inspect',
] as const;

export const BashSchema = defineSchema({
  name: 'Bash',
  description: 'Execute a shell command in the terminal',
  fields: {
    command: field({
      type: 'string',
      description: 'The shell command to execute',
      required: true,
    }),
    cwd: field({
      type: 'string',
      description: 'Working directory for the command',
      required: false,
    }),
    timeout: field({
      type: 'integer',
      description: 'Timeout in milliseconds',
      required: false,
      default: 30000,
    }),
  },
});

export const CommandSchema = defineSchema({
  name: 'Command',
  description: 'Run a safe, platform-aware repository operation without composing shell syntax. Use Read for file contents; Command.args must be an array of literal strings.',
  fields: {
    operation: field({
      type: 'string',
      description: 'One of git_status, git_diff, git_log, verify, smoke, test, build, lint, typecheck, file_exists, list_directory, process_inspect. smoke resolves the target workspace smoke script. "read" is not supported; use Read for file contents.',
      required: true,
      enum: [...COMMAND_OPERATIONS],
    }),
    args: field({ type: 'array', description: 'Operation-specific literal string arguments only; for example ["."] for list_directory. Never pass an object.', required: false }),
    cwd: field({ type: 'string', description: 'Workspace-relative working directory', required: false }),
    timeout: field({ type: 'integer', description: 'Timeout in milliseconds', required: false, default: 30000 }),
  },
});

export const ReadFileSchema = defineSchema({
  name: 'Read',
  description: 'Read contents of a file',
  fields: {
    file_path: field({
      type: 'string',
      description: 'Absolute path to the file',
      required: true,
    }),
    offset: field({
      type: 'integer',
      description: 'Line number to start reading from (optional)',
      required: false,
    }),
    limit: field({
      type: 'integer',
      description: 'Number of lines to read (optional)',
      required: false,
    }),
  },
});

export const DocumentReadSchema = defineSchema({
  name: 'DocumentRead',
  description: 'Extract readable text from a PDF or DOCX document without returning raw binary bytes',
  fields: {
    file_path: field({
      type: 'string',
      description: 'Workspace-contained PDF or DOCX path',
      required: true,
    }),
  },
});

export const WriteFileSchema = defineSchema({
  name: 'Write',
  description: 'Write content to a file (creates or overwrites)',
  fields: {
    file_path: field({
      type: 'string',
      description: 'Absolute path to the file',
      required: true,
    }),
    content: field({
      type: 'string',
      description: 'Content to write. For large or quote-heavy content, use content_base64 instead.',
      required: false,
    }),
    content_base64: field({
      type: 'string',
      description: 'Optional UTF-8 file content encoded as base64. Prefer this for large HTML/CSS/JS payloads.',
      required: false,
    }),
    append: field({
      type: 'boolean',
      description: 'Append to the file instead of overwriting it. Use for chunked large-file writes.',
      required: false,
      default: false,
    }),
    expectedHash: field({
      type: 'string',
      description: 'Expected file hash from a prior guarded read when modifying an existing file.',
      required: false,
    }),
    allowCreate: field({
      type: 'boolean',
      description: 'Explicitly allow creating a new file in guarded mutation mode.',
      required: false,
    }),
    allowOverwrite: field({
      type: 'boolean',
      description: 'Explicitly allow overwriting an existing file in guarded mutation mode.',
      required: false,
    }),
    reason: field({
      type: 'string',
      description: 'Reason for the file mutation in guarded mutation mode.',
      required: false,
    }),
  },
});

export const EditFileSchema = defineSchema({
  name: 'Edit',
  description: 'Perform exact string replacement in a file',
  fields: {
    file_path: field({
      type: 'string',
      description: 'Absolute path to the file',
      required: true,
    }),
    old_string: field({
      type: 'string',
      description: 'Exact text to replace',
      required: true,
    }),
    new_string: field({
      type: 'string',
      description: 'Replacement text',
      required: true,
    }),
    expectedHash: field({
      type: 'string',
      description: 'Expected file hash from a prior guarded read.',
      required: false,
    }),
    reason: field({
      type: 'string',
      description: 'Reason for the file edit in guarded mutation mode.',
      required: false,
    }),
  },
});

export const GlobSchema = defineSchema({
  name: 'Glob',
  description: 'Find files matching a glob pattern',
  fields: {
    pattern: field({
      type: 'string',
      description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.js")',
      required: true,
    }),
  },
});

export const GrepSchema = defineSchema({
  name: 'Grep',
  description: 'Search file contents using regex',
  fields: {
    pattern: field({
      type: 'string',
      description: 'Regex pattern or literal string to search',
      required: true,
    }),
    path: field({
      type: 'string',
      description: 'Directory or file to search in (defaults to workspace root)',
      required: false,
    }),
    type: field({
      type: 'string',
      description: 'Output format: "content" (matches with line context) or "files_with_matches" (just file paths)',
      required: false,
      default: 'files_with_matches',
    }),
    includePattern: field({
      type: 'string',
      description: 'Glob pattern for files to search (e.g., "*.ts", "src/**/*.js")',
      required: false,
    }),
    isRegex: field({
      type: 'boolean',
      description: 'Treat pattern as regex (true) or literal string (false)',
      required: false,
      default: true,
    }),
    limit: field({
      type: 'number',
      description: 'Maximum number of results to return',
      required: false,
    }),
  },
});

export const WebSearchSchema = defineSchema({
  name: 'WebSearch',
  description: 'Search the public web using Tavily and return source URLs with relevant excerpts',
  fields: {
    query: field({
      type: 'string',
      description: 'The web search query',
      required: true,
    }),
    max_results: field({
      type: 'integer',
      description: 'Maximum number of results to return (1-20)',
      required: false,
      default: 5,
      validator: validator.number().int().min(1).max(20),
    }),
    search_depth: field({
      type: 'string',
      description: 'Search depth. "basic" is faster; "advanced" is more thorough.',
      required: false,
      default: 'basic',
      enum: ['basic', 'advanced'],
    }),
    topic: field({
      type: 'string',
      description: 'Search category',
      required: false,
      default: 'general',
      enum: ['general', 'news', 'finance'],
    }),
    include_answer: field({
      type: 'boolean',
      description: 'Include a short answer synthesized from the search results',
      required: false,
      default: false,
    }),
    include_domains: field({
      type: 'array',
      description: 'Optional domain allowlist, such as ["openai.com", "github.com"]',
      required: false,
      items: { type: 'string' },
    }),
    exclude_domains: field({
      type: 'array',
      description: 'Optional domains to exclude from results',
      required: false,
      items: { type: 'string' },
    }),
  },
});

export const PackageInstallSchema = defineSchema({
  name: 'PackageInstall',
  description: 'Install declared or named packages through a structured package-manager invocation. Requires explicit approval and verifies named packages after installation.',
  fields: {
    manager: field({ type: 'string', description: 'Package manager: npm, pnpm, yarn, or bun.', required: false, default: 'npm' }),
    packages: field({ type: 'array', description: 'Literal package names/specifiers. Leave empty to install dependencies already declared by the project.', required: false }),
    dev: field({ type: 'boolean', description: 'Save named packages as development dependencies.', required: false, default: false }),
    cwd: field({ type: 'string', description: 'Workspace-relative project directory.', required: false }),
    timeout: field({ type: 'integer', description: 'Timeout in milliseconds.', required: false, default: 300000 }),
  },
});

export const WorkspaceChangesSchema = defineSchema({
  name: 'WorkspaceChanges',
  description: 'Inspect the most recently modified workspace files without changing anything. Use this to identify the latest update before reading or editing a target.',
  fields: {
    path: field({
      type: 'string',
      description: 'Optional workspace-relative directory to scan (defaults to the workspace root).',
      required: false,
    }),
    since: field({
      type: 'number',
      description: 'Optional Unix timestamp in milliseconds; only files modified after this time are returned.',
      required: false,
    }),
    max_files: field({
      type: 'integer',
      description: 'Maximum number of files to return (1-100).',
      required: false,
      default: 25,
    }),
    max_depth: field({
      type: 'integer',
      description: 'Maximum directory depth to scan (0-8).',
      required: false,
      default: 5,
    }),
    include_hash: field({
      type: 'boolean',
      description: 'Include a SHA-256 content hash for each returned file.',
      required: false,
      default: false,
    }),
  },
});

export const NoteSchema = defineSchema({
  name: 'Note',
  description: 'Add, retrieve, or list durable notes scoped to the current project',
  fields: {
    operation: field({
      type: 'string',
      description: 'Operation to perform: add, get, or list',
      required: true,
      enum: ['add', 'get', 'list'],
    }),
    title: field({
      type: 'string',
      description: 'Short note title. Required for add.',
      required: false,
    }),
    content: field({
      type: 'string',
      description: 'Note body in Markdown. Required for add.',
      required: false,
    }),
    note_id: field({
      type: 'string',
      description: 'Reference returned by add, such as note:architecture-decision-a1b2c3d4. Required for get.',
      required: false,
    }),
  },
});

export const SampleSchema = defineSchema({
  name: 'Sample',
  description: 'Add, retrieve, list, or search reusable examples scoped to the current project',
  fields: {
    operation: field({
      type: 'string',
      description: 'Operation to perform: add, get, list, search, set_folder, or get_folder',
      required: true,
      enum: ['add', 'get', 'list', 'search', 'set_folder', 'get_folder'],
    }),
    title: field({
      type: 'string',
      description: 'Short sample title. Required for add.',
      required: false,
    }),
    description: field({
      type: 'string',
      description: 'Optional explanation of when or how to use the sample.',
      required: false,
    }),
    content: field({
      type: 'string',
      description: 'Reusable sample content. Required for add.',
      required: false,
    }),
    language: field({
      type: 'string',
      description: 'Optional language or format, such as typescript, react, sql, or markdown.',
      required: false,
    }),
    tags: field({
      type: 'array',
      description: 'Optional searchable tags.',
      required: false,
      items: { type: 'string' },
    }),
    sample_id: field({
      type: 'string',
      description: 'Reference returned by add, such as sample:express-route-a1b2c3d4. Required for get.',
      required: false,
    }),
    query: field({
      type: 'string',
      description: 'Words to match against sample titles, descriptions, languages, tags, and content. Required for search.',
      required: false,
    }),
    folder: field({
      type: 'string',
      description: 'Workspace-relative sample repository folder. Required for set_folder.',
      required: false,
    }),
  },
});

export const WikiSchema = defineSchema({
  name: 'Wiki',
  description: 'List, search, or read user-authored Markdown wiki pages in the configured project folder',
  fields: {
    operation: field({
      type: 'string',
      description: 'Operation to perform: list, get, or search',
      required: true,
      enum: ['list', 'get', 'search'],
    }),
    page: field({
      type: 'string',
      description: 'Wiki reference such as wiki:guides/setup. Required for get.',
      required: false,
    }),
    query: field({
      type: 'string',
      description: 'Words to find in wiki titles and Markdown content. Required for search.',
      required: false,
    }),
  },
});

// ============================================================================
// REACT STATE SCHEMAS (LangGraph)
// ============================================================================

export const ReactStepSchema = defineSchema({
  name: 'ReactStep',
  description: 'One step in the ReAct loop',
  fields: {
    thought: field({
      type: 'string',
      description: 'LLM reasoning about current state',
      required: true,
    }),
    action: field({
      type: 'string',
      description: 'Tool name to call',
      required: true,
    }),
    action_input: field({
      type: 'object',
      description: 'Input parameters for the tool',
      required: true,
    }),
    observation: field({
      type: 'string',
      description: 'Result from tool execution',
      required: false,
    }),
    is_done: field({
      type: 'boolean',
      description: 'Whether the task is complete',
      required: false,
      default: false,
    }),
    final_answer: field({
      type: 'string',
      description: 'Final answer when task is complete',
      required: false,
    }),
  },
});

export const ReactStateSchema = defineSchema({
  name: 'ReactState',
  description: 'Complete ReAct loop state',
  fields: {
    task: field({
      type: 'string',
      description: 'Original task description',
      required: true,
    }),
    steps: field({
      type: 'array',
      description: 'History of ReAct steps',
      required: false,
      default: [],
      items: { $ref: '#/definitions/ReactStep' },
    }),
    current_step: field({
      type: 'integer',
      description: 'Current step index',
      required: false,
      default: 0,
    }),
    max_steps: field({
      type: 'integer',
      description: 'Maximum steps before termination',
      required: false,
      default: 10,
    }),
  },
});

// ============================================================================
// ZOD SCHEMAS FOR POLLINATIONS API (TYPE-SAFE PARAMETERS)
// ============================================================================

/**
 * Zod schemas for Pollinations API calls
 * These provide type-safe parameter validation without unsafe `as any` casts
 */

export const GenerateImageParamsSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  model: z.string().default('flux'),
  width: z.number().int().min(256).max(2048).default(1024),
  height: z.number().int().min(256).max(2048).default(1024),
  seed: z.number().int().optional(),
  enhance: z.boolean().default(true),
  negative_prompt: z.string().optional(),
  quality: z.enum(['low', 'medium', 'high', 'hd']).default('high'),
});

export type GenerateImageParams = z.infer<typeof GenerateImageParamsSchema>;

export const GenerateTextParamsSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  model: z.string().default('openai'),
  temperature: z.number().min(0).max(2).default(0.7),
  max_tokens: z.number().int().min(1).max(32768).default(1024),
});

export type GenerateTextParams = z.infer<typeof GenerateTextParamsSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatCompletionParamsSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1, 'At least one message is required'),
  model: z.string().default('openai'),
  tools: z.array(z.unknown()).optional(),
});

export type ChatCompletionParams = z.infer<typeof ChatCompletionParamsSchema>;

export const SetApiKeyParamsSchema = z.object({
  api_key: z.string().min(1, 'API key is required'),
});

export type SetApiKeyParams = z.infer<typeof SetApiKeyParamsSchema>;

// ============================================================================
// ZOD SCHEMAS FOR DEV TOOLS (TYPE-SAFE FILE & SHELL OPERATIONS)
// ============================================================================

export const BashParamsSchema = z.object({
  command: z.string().min(1, 'Command is required'),
  cwd: z.string().optional(),
  timeout: z.number().int().positive().default(30000),
});

export type BashParams = z.infer<typeof BashParamsSchema>;

export const PackageInstallParamsSchema = z.object({
  manager: z.enum(['npm', 'pnpm', 'yarn', 'bun']).default('npm'),
  packages: z.array(z.string().min(1)).default([]),
  dev: z.boolean().default(false),
  cwd: z.string().optional(),
  timeout: z.number().int().positive().default(300000),
});

export type PackageInstallParams = z.infer<typeof PackageInstallParamsSchema>;

export const CommandParamsSchema = z.object({
  operation: z.enum(COMMAND_OPERATIONS),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  timeout: z.number().int().positive().default(30000),
});

export type CommandParams = z.infer<typeof CommandParamsSchema>;

function normalizeFilePathAliases(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const params = { ...(input as Record<string, unknown>) };
  if (typeof params.file_path !== 'string') {
    const alias = params.path ?? params.filename ?? params.file;
    if (typeof alias === 'string') {
      params.file_path = alias;
    }
  }
  return params;
}

function normalizeEditAliases(input: unknown): unknown {
  const params = normalizeFilePathAliases(input);
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
  const normalized = { ...(params as Record<string, unknown>) };
  if (typeof normalized.old_string !== 'string') {
    const alias = normalized.search ?? normalized.search_string ?? normalized.original;
    if (typeof alias === 'string') {
      normalized.old_string = alias;
    }
  }
  if (typeof normalized.new_string !== 'string') {
    const alias = normalized.replace ?? normalized.replacement ?? normalized.replacement_string;
    if (typeof alias === 'string') {
      normalized.new_string = alias;
    }
  }
  return normalized;
}

export const ReadFileParamsSchema = z.preprocess(normalizeFilePathAliases, z.object({
  file_path: z.string().min(1, 'File path is required'),
  offset: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
}));

export type ReadFileParams = z.infer<typeof ReadFileParamsSchema>;

export const DocumentReadParamsSchema = z.preprocess(normalizeFilePathAliases, z.object({
  file_path: z.string().min(1, 'Document path is required'),
}));

export type DocumentReadParams = z.infer<typeof DocumentReadParamsSchema>;

export const WriteFileParamsSchema = z.preprocess(normalizeFilePathAliases, z.object({
  file_path: z.string().min(1, 'File path is required'),
  content: z.string().optional(),
  content_base64: z.string().optional(),
  append: z.boolean().default(false),
  expectedHash: z.string().optional(),
  allowCreate: z.boolean().optional(),
  allowOverwrite: z.boolean().optional(),
  reason: z.string().optional(),
}).refine(
  (params) => typeof params.content === 'string' || typeof params.content_base64 === 'string',
  'Either content or content_base64 is required'
));

export type WriteFileParams = z.infer<typeof WriteFileParamsSchema>;

export const EditFileParamsSchema = z.preprocess(normalizeEditAliases, z.object({
  file_path: z.string().min(1, 'File path is required'),
  old_string: z.string().min(1, 'Old string is required'),
  new_string: z.string(),
  expectedHash: z.string().optional(),
  reason: z.string().optional(),
}));

export type EditFileParams = z.infer<typeof EditFileParamsSchema>;

export const GlobParamsSchema = z.object({
  pattern: z.string().min(1, 'Glob pattern is required'),
});

export type GlobParams = z.infer<typeof GlobParamsSchema>;

export const WorkspaceChangesParamsSchema = z.object({
  path: z.string().optional(),
  since: z.number().int().nonnegative().optional(),
  max_files: z.number().int().min(1).max(100).default(25),
  max_depth: z.number().int().min(0).max(8).default(5),
  include_hash: z.boolean().default(false),
});

export type WorkspaceChangesParams = z.infer<typeof WorkspaceChangesParamsSchema>;

export const GrepParamsSchema = z.object({
  pattern: z.string().min(1, 'Pattern is required'),
  path: z.string().optional(),
  type: z.enum(['content', 'files_with_matches']).default('files_with_matches'),
  includePattern: z.string().optional().describe('Glob pattern for files to search (e.g., "*.ts", "src/**/*.js")'),
  isRegex: z.boolean().default(true).describe('Treat pattern as regex (true) or literal string (false)'),
  limit: z.number().int().positive().optional().describe('Maximum number of results to return'),
});

export type GrepParams = z.infer<typeof GrepParamsSchema>;

export const WebSearchParamsSchema = z.object({
  query: z.string().trim().min(1, 'Search query is required').max(400),
  max_results: z.number().int().min(1).max(20).default(5),
  search_depth: z.enum(['basic', 'advanced']).default('basic'),
  topic: z.enum(['general', 'news', 'finance']).default('general'),
  include_answer: z.boolean().default(false),
  include_domains: z.array(z.string().trim().min(1)).max(300).optional(),
  exclude_domains: z.array(z.string().trim().min(1)).max(150).optional(),
});

export type WebSearchParams = z.infer<typeof WebSearchParamsSchema>;

export const NoteParamsSchema = z.object({
  operation: z.enum(['add', 'get', 'list']),
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().trim().min(1).max(100_000).optional(),
  note_id: z.string().trim().min(1).max(100).optional(),
}).superRefine((params, context) => {
  if (params.operation === 'add') {
    if (!params.title) {
      context.addIssue({ code: 'custom', path: ['title'], message: 'Title is required for add' });
    }
    if (!params.content) {
      context.addIssue({ code: 'custom', path: ['content'], message: 'Content is required for add' });
    }
  }
  if (params.operation === 'get' && !params.note_id) {
    context.addIssue({ code: 'custom', path: ['note_id'], message: 'Note ID is required for get' });
  }
});

export type NoteParams = z.infer<typeof NoteParamsSchema>;

export const SampleParamsSchema = z.object({
  operation: z.enum(['add', 'get', 'list', 'search', 'set_folder', 'get_folder']),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1_000).optional(),
  content: z.string().trim().min(1).max(250_000).optional(),
  language: z.string().trim().min(1).max(50).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  sample_id: z.string().trim().min(1).max(100).optional(),
  query: z.string().trim().min(1).max(200).optional(),
  folder: z.string().trim().min(1).max(500).optional(),
}).superRefine((params, context) => {
  if (params.operation === 'add') {
    if (!params.title) {
      context.addIssue({ code: 'custom', path: ['title'], message: 'Title is required for add' });
    }
    if (!params.content) {
      context.addIssue({ code: 'custom', path: ['content'], message: 'Content is required for add' });
    }
  }
  if (params.operation === 'get' && !params.sample_id) {
    context.addIssue({ code: 'custom', path: ['sample_id'], message: 'Sample ID is required for get' });
  }
  if (params.operation === 'search' && !params.query) {
    context.addIssue({ code: 'custom', path: ['query'], message: 'Query is required for search' });
  }
  if (params.operation === 'set_folder' && !params.folder) {
    context.addIssue({ code: 'custom', path: ['folder'], message: 'Folder is required for set_folder' });
  }
});

export type SampleParams = z.infer<typeof SampleParamsSchema>;

export const WikiParamsSchema = z.object({
  operation: z.enum(['list', 'get', 'search']),
  page: z.string().trim().min(1).max(500).optional(),
  query: z.string().trim().min(1).max(200).optional(),
}).superRefine((params, context) => {
  if (params.operation === 'get' && !params.page) {
    context.addIssue({ code: 'custom', path: ['page'], message: 'Page is required for get' });
  }
  if (params.operation === 'search' && !params.query) {
    context.addIssue({ code: 'custom', path: ['query'], message: 'Query is required for search' });
  }
});

export type WikiParams = z.infer<typeof WikiParamsSchema>;

export const TaskCreateParamsSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  description: z.string().optional(),
});

export type TaskCreateParams = z.infer<typeof TaskCreateParamsSchema>;

export const TaskUpdateParamsSchema = z.object({
  id: z.string().min(1, 'Task ID is required'),
  status: z.enum(['pending', 'in_progress', 'completed']).optional(),
  owner: z.string().optional(),
  role: z.string().optional(),
  fallback: z.string().optional(),
});

export type TaskUpdateParams = z.infer<typeof TaskUpdateParamsSchema>;

export const SubAgentParamsSchema = z.object({
  task: z.string().min(1, 'Task is required'),
  role: z.string().optional(),
  fallback: z.string().optional(),
  /** Optional 1-based configured delegation slot. Omit for round-robin assignment. */
  slot: z.number().int().min(1).max(16).optional(),
});

export type SubAgentParams = z.infer<typeof SubAgentParamsSchema>;

// ============================================================================
// API RESPONSE VALIDATION SCHEMAS (CENTRALIZED)
// ============================================================================

// --- Pollinations API Responses ---

export const PollinationsImageResponseSchema = z.object({
  url: z.string().url('Image URL must be valid'),
  data: z.string().optional().describe('Base64 encoded image data'),
  format: z.string().default('jpg').describe('Image format (jpg, png, etc.)'),
});

export type PollinationsImageResponse = z.infer<typeof PollinationsImageResponseSchema>;

export const PollinationsTextResponseSchema = z.object({
  text: z.string().min(1, 'Generated text cannot be empty'),
  model: z.string().describe('Model used for generation'),
  usage: z.object({
    tokens: z.number().int().nonnegative(),
  }),
});

export type PollinationsTextResponse = z.infer<typeof PollinationsTextResponseSchema>;

export const PollinationsChatToolCallSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).describe('Tool arguments object'),
});

export const PollinationsChatResponseSchema = z.object({
  content: z.string().min(1, 'Response content cannot be empty'),
  tool_calls: z.array(PollinationsChatToolCallSchema).optional(),
});

export type PollinationsChatResponse = z.infer<typeof PollinationsChatResponseSchema>;

// --- Gemini API Responses ---

export const GeminiGenerateContentResponseSchema = z.object({
  text: z.string().optional().describe('Generated text content'),
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({
        text: z.string().optional(),
      })),
    }),
  })).optional().describe('Response candidates'),
});

export type GeminiGenerateContentResponse = z.infer<typeof GeminiGenerateContentResponseSchema>;

// --- MCP Tool Responses ---

export const ToolResponseContentSchema = z.object({
  type: z.enum(['text']).describe('Content type'),
  text: z.string().describe('Text content'),
});

export const CallToolResultSchema = z.object({
  content: z.array(ToolResponseContentSchema).describe('Tool response content'),
  isError: z.boolean().optional().default(false).describe('Whether this is an error response'),
});

export type CallToolResult = z.infer<typeof CallToolResultSchema>;

export const DevToolResultSchema = z.object({
  success: z.boolean().describe('Whether tool execution succeeded'),
  output: z.string().optional().describe('Tool output/result'),
  error: z.string().optional().describe('Error message if failed'),
  truncated: z.boolean().optional().default(false).describe('Whether output was truncated due to size/limit'),
});

export type DevToolResult = z.infer<typeof DevToolResultSchema>;

// --- Agent Outputs ---

// --- Generic Agent Output Response ---

export const AgentOutputResponseSchema = z.union([
  ReactResultResponseSchema,
  DevToolResultSchema,
  PollinationsChatResponseSchema,
]).describe('Response from any agent or tool');

export type AgentOutputResponse = z.infer<typeof AgentOutputResponseSchema>;

// --- Unified Response Validator ---

export const APIResponseSchema = z.union([
  PollinationsImageResponseSchema,
  PollinationsTextResponseSchema,
  PollinationsChatResponseSchema,
  GeminiGenerateContentResponseSchema,
  CallToolResultSchema,
  DevToolResultSchema,
  ReactResultResponseSchema,
]).describe('Response from any API or tool');

export type APIResponse = z.infer<typeof APIResponseSchema>;

// Export all schemas
export const ALL_SCHEMAS = [
  ImageGenerationSchema,
  TextGenerationSchema,
  ChatCompletionSchema,
  BashSchema,
  CommandSchema,
  ReadFileSchema,
  DocumentReadSchema,
  WriteFileSchema,
  EditFileSchema,
  GlobSchema,
  GrepSchema,
  ReactStepSchema,
  ReactStateSchema,
];
