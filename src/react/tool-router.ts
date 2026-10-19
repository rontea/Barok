/**
 * Tool Router Module
 * Handles tool lookup and dispatch
 */

import type { ToolHandlerContext, ToolRegistry } from '../di/types.js';
import { DefaultToolRegistry, FilteredToolRegistry } from '../di/providers/toolRegistry.js';
import { getAllToolDefinitions } from '../tools/devTools.js';
import { normalizeToolResult, serializeToolResult } from './tool-contract.js';
import { getToolCapabilities, type ToolCapabilities } from '@barok/engine';
import type { ToolAction } from '@barok/engine';
import type { CapabilityScope } from './capability-scope.js';
import type { ToolCatalogEntry } from './capability-scope.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  handler: (params: unknown, signal?: AbortSignal, context?: ToolHandlerContext) => Promise<unknown>;
  capabilities?: ToolCapabilities;
  timeoutMs?: number;
}

export type { ToolAction } from '@barok/engine';

export interface ToolInputValidation {
  valid: boolean;
  errors: string[];
  toolId: string;
}

function schemaForTool(tool: ToolDefinition): Record<string, unknown> {
  return (tool.parameters || tool.inputSchema || {}) as Record<string, unknown>;
}

function exampleValueForSchemaType(type: unknown): unknown {
  if (type === 'string') return '...';
  if (type === 'boolean') return false;
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'array') return [];
  if (type === 'object') return {};
  return '...';
}

function compactToolExample(name: string, schema: Record<string, unknown>): string {
  const properties = schema.properties && typeof schema.properties === 'object'
    ? schema.properties as Record<string, Record<string, unknown>>
    : {};
  const required = Array.isArray(schema.required) ? schema.required.filter((field): field is string => typeof field === 'string').slice(0, 4) : [];
  const args = Object.fromEntries(required.map((field) => [field, exampleValueForSchemaType(properties[field]?.type)]));
  const full = JSON.stringify({ tool: name, arguments: args });
  return full.length <= 120 ? full : JSON.stringify({ tool: name, arguments: {} });
}

function commonToolErrors(name: string): string[] | undefined {
  const known: Record<string, string[]> = {
    Bash: ['Use a non-empty `command` string.'],
    Command: ['Use `operation` for the operation name; do not send `cmd` or `command` as the operation field.'],
    Edit: ['Include `file_path`, `old_string`, and `new_string`; confirm the old text occurs in the current file.'],
    Read: ['Use `file_path` and a path inside the selected workspace.'],
    Write: ['Use `file_path` and either `content` or `content_base64`.'],
  };
  return known[name];
}

/** Validate the JSON-schema surface before a handler is invoked. */
export function validateToolInput(action: ToolAction, registry?: ToolRegistry): ToolInputValidation {
  const tool = lookupTool(action.action, registry);
  if (!tool) return { valid: false, errors: [`Tool "${action.action}" is not available.`], toolId: action.action };
  const input = action.action_input;
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) errors.push('action_input must be an object.');
  const schema = schemaForTool(tool);
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const field of required) {
    if (typeof field === 'string' && (input?.[field] === undefined || input?.[field] === null)) {
      errors.push(`Missing required input: ${field}.`);
    }
  }
  const properties = schema.properties && typeof schema.properties === 'object'
    ? schema.properties as Record<string, Record<string, unknown>>
    : {};
  for (const [name, property] of Object.entries(properties)) {
    const value = input?.[name];
    if (value === undefined || value === null || typeof property?.type !== 'string') continue;
    const expected = property.type;
    const actual = Array.isArray(value) ? 'array' : typeof value;
    if (expected !== actual && !(expected === 'integer' && actual === 'number' && Number.isInteger(value))) {
      errors.push(`Input ${name} must be ${expected}.`);
    }
    if (Array.isArray(property.enum) && !property.enum.includes(value)) {
      errors.push(`Input ${name} must be one of: ${property.enum.join(', ')}.`);
    }
  }
  return { valid: errors.length === 0, errors, toolId: action.action };
}

/**
 * Registry used by an independent verifier. Mutation-capable tools are not
 * merely blocked by policy; they are absent from the verifier's tool surface.
 */
export function createVerificationOnlyToolRegistry(registry?: ToolRegistry): ToolRegistry {
  const source = registry || new DefaultToolRegistry();
  return new FilteredToolRegistry(source, [
    'Read',
    'DocumentRead',
    'Glob',
    'Grep',
    'Command',
    'TaskList',
  ]);
}

let cachedDefaultTools: ToolDefinition[] | undefined;
let cachedDefaultToolMap: Map<string, ToolDefinition> | undefined;
let cachedDefaultDescriptions: string | undefined;
let cachedDefaultSummary: string | undefined;
let cachedDefaultNames: string | undefined;

function getDefaultTools(): ToolDefinition[] {
  if (!cachedDefaultTools) {
    cachedDefaultTools = getAllToolDefinitions() as unknown as ToolDefinition[];
  }
  return cachedDefaultTools;
}

function getDefaultToolMap(): Map<string, ToolDefinition> {
  if (!cachedDefaultToolMap) {
    cachedDefaultToolMap = new Map(getDefaultTools().map((tool) => [tool.name, tool]));
  }
  return cachedDefaultToolMap;
}

function getToolNames(registry?: ToolRegistry): string {
  if (registry) return registry.getAll().map((tool) => tool.name).join(', ');
  if (!cachedDefaultNames) cachedDefaultNames = getDefaultTools().map((tool) => tool.name).join(', ');
  return cachedDefaultNames;
}

/**
 * Look up a tool by name in the registry
 */
export function lookupTool(
  toolName: string,
  registry?: ToolRegistry
): ToolDefinition | undefined {
  if (registry) {
    return registry.get(toolName);
  }

  // Fallback to default tools
  return getDefaultToolMap().get(toolName);
}

/**
 * Get all available tools
 */
export function getAvailableTools(registry?: ToolRegistry): ToolDefinition[] {
  if (registry) {
    return registry.getAll();
  }

  // Fallback to default tools
  return getDefaultTools();
}

/** Single machine-readable catalog used by prompts, native tools, and scope tests. */
export function getToolCatalog(registry?: ToolRegistry): ToolCatalogEntry[] {
  const tools = getAvailableTools(registry);
  const enabled = new Set((registry ? registry.getEnabled() : tools).map((tool) => tool.name));
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: schemaForTool(tool),
    enabled: enabled.has(tool.name),
    capabilities: tool.capabilities || getToolCapabilities(tool.name),
    example: compactToolExample(tool.name, schemaForTool(tool)),
    ...(commonToolErrors(tool.name) ? { commonErrors: commonToolErrors(tool.name) } : {}),
  }));
}

/**
 * Get tool descriptions for LLM context
 */
export function getToolDescriptions(registry?: ToolRegistry): string {
  if (registry) return getToolCatalog(registry).map((tool) => `${tool.name}: ${tool.description}\nSchema: ${JSON.stringify(tool.schema)}`).join('\n');
  if (!cachedDefaultDescriptions) {
    cachedDefaultDescriptions = getToolCatalog().map((tool) => `${tool.name}: ${tool.description}\nSchema: ${JSON.stringify(tool.schema)}`).join('\n');
  }
  return cachedDefaultDescriptions;
}

/**
 * Get compact tool summaries for reasoning prompts.
 */
export function getToolSummaryList(registry?: ToolRegistry): string {
  if (registry) return getToolCatalog(registry).map((tool) => `- ${tool.name}: ${tool.description}`).join('\n');
  if (!cachedDefaultSummary) {
    cachedDefaultSummary = getToolCatalog().map((tool) => `- ${tool.name}: ${tool.description}`).join('\n');
  }
  return cachedDefaultSummary;
}

/**
 * Dispatch tool execution
 */
export async function dispatchTool(
  action: ToolAction,
  registry?: ToolRegistry,
  signal?: AbortSignal,
  scope?: CapabilityScope,
): Promise<string> {
  if (signal?.aborted) {
    return serializeToolResult({
      success: false,
      status: 'cancelled',
      toolId: action.action,
      error: 'Tool execution cancelled before start.',
    });
  }

  const tool = lookupTool(action.action, registry);

  if (!tool) {
    const available = getToolNames(registry);
    return serializeToolResult({
      success: false,
      status: 'invalid',
      toolId: action.action,
      error: `Tool "${action.action}" is not available. Available tools: ${available}`,
    });
  }

  const validation = validateToolInput(action, registry);
  if (!validation.valid) {
    return serializeToolResult({ success: false, status: 'invalid', toolId: validation.toolId, error: validation.errors.join(' ') });
  }

  try {
    const result = scope
      ? await tool.handler(action.action_input, signal, { scope })
      : await tool.handler(action.action_input, signal);
    return serializeToolResult(normalizeToolResult(action.action, result));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return serializeToolResult({ success: false, status: 'error', toolId: action.action, error: errorMsg });
  }
}

/**
 * Check if tool exists
 */
export function toolExists(toolName: string, registry?: ToolRegistry): boolean {
  if (registry) {
    return registry.has(toolName);
  }

  // Fallback to default tools
  return getDefaultToolMap().has(toolName);
}

/**
 * Get tool count
 */
export function getToolCount(registry?: ToolRegistry): number {
  if (registry) {
    return registry.size();
  }

  return getDefaultTools().length;
}
