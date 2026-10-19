import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
  type ListToolsResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  normalizeFilePathCandidates,
  redactPolicyText,
  toCoderTaskAnalysisView,
  classifyTask,
} from '@barok/core';

const CORE_TOOLS: Tool[] = [
  {
    name: 'barok_classify_task',
    description: 'Classify a task with Barok Core task policy.',
    inputSchema: {
      type: 'object',
      properties: { task: { type: 'string', minLength: 1 } },
      required: ['task'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'barok_normalize_file_paths',
    description: 'Normalize and deduplicate candidate file paths using Barok Core.',
    inputSchema: {
      type: 'object',
      properties: { paths: { type: 'array', items: { type: 'string' } } },
      required: ['paths'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'barok_sanitize_task_analysis',
    description: 'Project an untrusted task-analysis value into Barok Core’s bounded, redacted view.',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'object' } },
      required: ['value'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'barok_redact_policy_text',
    description: 'Redact common credential formats from text using Barok Core.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
];

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function inputError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/** Attach the read-only Core tool surface to an MCP server instance. */
export function registerBarokCoreTools(server: Server): void {
  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => ({
    tools: CORE_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async ({ params }): Promise<CallToolResult> => {
    const args = record(params.arguments);
    if (!args) return inputError('Tool arguments must be an object.');

    switch (params.name) {
      case 'barok_classify_task':
        if (typeof args.task !== 'string' || args.task.trim() === '') {
          return inputError('task must be a non-empty string.');
        }
        return jsonResult({ classification: classifyTask(args.task) });
      case 'barok_normalize_file_paths':
        if (!Array.isArray(args.paths) || !args.paths.every((path) => typeof path === 'string')) {
          return inputError('paths must be an array of strings.');
        }
        return jsonResult({ paths: normalizeFilePathCandidates(args.paths as string[]) });
      case 'barok_sanitize_task_analysis':
        if (record(args.value) === undefined) return inputError('value must be an object.');
        return jsonResult(toCoderTaskAnalysisView(args.value));
      case 'barok_redact_policy_text':
        if (typeof args.text !== 'string') return inputError('text must be a string.');
        return jsonResult({ text: redactPolicyText(args.text) });
      default:
        return inputError(`Unknown Barok Core tool: ${params.name}`);
    }
  });
}

export const barokCoreToolDefinitions: readonly Tool[] = CORE_TOOLS;

export {
  registerLegacyBarokTools,
  type LegacyMcpArguments,
  type LegacyMcpDevToolsPort,
  type LegacyMcpPollinationsPort,
  type LegacyMcpToolDefinition,
  type LegacyMcpToolsOptions,
  type LegacyMcpValidation,
} from './legacy-tools.js';
