import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export interface LegacyMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: Tool['inputSchema'];
}

export type LegacyMcpArguments = Record<string, unknown>;

export interface LegacyMcpValidation {
  /** Return readable validation errors; an empty list means the value is valid. */
  errors: (value: unknown) => string[];
}

export interface LegacyMcpPollinationsPort {
  /** The three public Pollinations tools. `setApiKey` remains callable but unlisted for compatibility. */
  tools: readonly Tool[];
  parseImageArguments: (value: unknown) => LegacyMcpArguments;
  parseTextArguments: (value: unknown) => LegacyMcpArguments;
  parseChatArguments: (value: unknown) => LegacyMcpArguments;
  parseApiKeyArguments: (value: unknown) => { api_key: string };
  generateImage: (args: LegacyMcpArguments) => Promise<unknown>;
  generateText: (args: LegacyMcpArguments) => Promise<unknown>;
  chatCompletion: (args: LegacyMcpArguments) => Promise<unknown>;
  setApiKey: (apiKey: string) => void;
  validateImageResponse?: LegacyMcpValidation;
  validateTextResponse?: LegacyMcpValidation;
  validateChatResponse?: LegacyMcpValidation;
}

export interface LegacyMcpDevToolsPort {
  tools: readonly LegacyMcpToolDefinition[];
  /** Returns the canonical JSON observation produced by Barok's shared executor. */
  execute: (name: string, args: LegacyMcpArguments) => Promise<string>;
  validateResult?: LegacyMcpValidation;
  validateCallResult?: LegacyMcpValidation;
}

export interface LegacyMcpToolsOptions {
  pollinations: LegacyMcpPollinationsPort;
  devTools: LegacyMcpDevToolsPort;
  debug?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function describeValidationErrors(errors: string[]): string {
  return errors.join('; ');
}

function reportValidation(debug: boolean, label: string, validation: LegacyMcpValidation | undefined, value: unknown): void {
  if (!debug || !validation) return;
  const errors = validation.errors(value);
  if (errors.length > 0) console.error(`${label}:`, errors);
}

function formatThrownError(error: unknown): string {
  const candidate = asRecord(error);
  const issues = candidate?.issues;
  if (Array.isArray(issues)) {
    const details = issues.flatMap((issue) => {
      const record = asRecord(issue);
      if (!record) return [];
      const path = Array.isArray(record.path) ? record.path.join('.') : '';
      const message = typeof record.message === 'string' ? record.message : 'Invalid value';
      return [`${path}: ${message}`];
    });
    if (details.length > 0) return `Validation error: ${describeValidationErrors(details)}`;
  }
  return error instanceof Error ? error.message : 'Unknown error';
}

function parseCanonicalResult(observation: string): Record<string, unknown> {
  try {
    const result = JSON.parse(observation) as unknown;
    return asRecord(result) ?? {
      success: false,
      status: 'unknown',
      error: 'MCP tool returned an invalid canonical result.',
      output: observation,
    };
  } catch {
    return {
      success: false,
      status: 'unknown',
      error: 'MCP tool returned an invalid canonical result.',
      output: observation,
    };
  }
}

function convertDevTool(definition: LegacyMcpToolDefinition): Tool {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    annotations: { readOnlyHint: false },
  };
}

/** Attach the legacy Pollinations and DevTools surface to an MCP server. */
export function registerLegacyBarokTools(server: Server, options: LegacyMcpToolsOptions): void {
  const { pollinations, devTools, debug = false } = options;
  const allTools = [...pollinations.tools, ...devTools.tools.map(convertDevTool)];
  const devToolNames = new Set(devTools.tools.map((tool) => tool.name));

  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
    if (debug) console.error('[MCP] Listing tools:', allTools.map((tool) => tool.name));
    return { tools: allTools };
  });

  server.setRequestHandler(
    CallToolRequestSchema,
    async ({ params: { name, arguments: args } }): Promise<CallToolResult> => {
      if (debug) console.error(`[MCP] Tool call: ${name}`, args);

      try {
        if (name === 'generateImage') {
          const result = await pollinations.generateImage(pollinations.parseImageArguments(args));
          reportValidation(debug, '[MCP] Image response validation failed', pollinations.validateImageResponse, result);
          const image = asRecord(result) ?? {};
          const data = image.data as string | undefined;
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                url: image.url,
                data: data?.substring(0, 100) + '...',
              }, null, 2),
            }],
          };
        }

        if (name === 'generateText') {
          const result = await pollinations.generateText(pollinations.parseTextArguments(args));
          reportValidation(debug, '[MCP] Text response validation failed', pollinations.validateTextResponse, result);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        if (name === 'chatCompletion') {
          const result = await pollinations.chatCompletion(pollinations.parseChatArguments(args));
          reportValidation(debug, '[MCP] Chat response validation failed', pollinations.validateChatResponse, result);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        if (name === 'setApiKey') {
          const parsedArgs = pollinations.parseApiKeyArguments(args);
          pollinations.setApiKey(parsedArgs.api_key);
          return { content: [{ type: 'text', text: 'API key configured.' }] };
        }

        if (devToolNames.has(name)) {
          const observation = await devTools.execute(name, (args || {}) as LegacyMcpArguments);
          const result = parseCanonicalResult(observation);
          reportValidation(debug, '[MCP] Dev tool result validation failed', devTools.validateResult, result);

          const callToolResult: CallToolResult = {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: result.success === false,
          };
          reportValidation(debug, '[MCP] CallToolResult validation failed', devTools.validateCallResult, callToolResult);
          return callToolResult;
        }

        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Tool execution error: ${formatThrownError(error)}` }],
          isError: true,
        };
      }
    },
  );
}

