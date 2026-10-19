import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  registerLegacyBarokTools,
  type LegacyMcpArguments,
  type LegacyMcpValidation,
} from '@barok/adapter-mcp';
import { pollinationsClient } from '../pollinations/client.js';
import {
  ImageGenerationSchema,
  TextGenerationSchema,
  ChatCompletionSchema,
  GenerateImageParamsSchema,
  GenerateTextParamsSchema,
  ChatCompletionParamsSchema,
  SetApiKeyParamsSchema,
  type GenerateImageParams,
  type GenerateTextParams,
  type ChatCompletionParams,
} from '../types/schemas.js';
import { getAllToolDefinitions } from '../tools/devTools.js';
import { DefaultToolRegistry } from '../di/providers/toolRegistry.js';
import { executeAction } from '../react/executor.js';
import { ToolEvidenceLedger, ToolExecutionScheduler, ToolExecutionState } from '../react/tool-contract.js';
import type { PolicyAuditRecord } from '../tools/permissionPolicy.js';
import {
  validatePollinationsImageResponse,
  validatePollinationsTextResponse,
  validatePollinationsChatResponse,
  validateDevToolResult,
  validateCallToolResult,
} from '../validation/responseValidator.js';

const MCP_SERVER_VERSION = '1.0.0';
const MCP_SERVER_NAME = 'raw-react-mcp';

function validation(errors: Array<{ field: string; message: string }> | undefined): string[] {
  return errors?.map(({ field, message }) => `${field}: ${message}`) ?? [];
}

function validationPort(validate: (value: unknown) => { success: boolean; errors?: Array<{ field: string; message: string }> }): LegacyMcpValidation {
  return { errors: (value) => {
    const result = validate(value);
    return result.success ? [] : validation(result.errors);
  } };
}

function asMcpToolInputSchema(schema: unknown): Tool['inputSchema'] {
  return schema as Tool['inputSchema'];
}

export async function startMCPServer(debug = false): Promise<void> {
  const toolRegistry = new DefaultToolRegistry();
  const toolEvidenceLedger = new ToolEvidenceLedger();
  const toolExecutionState = new ToolExecutionState();
  const toolScheduler = new ToolExecutionScheduler();
  const server = new Server(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  registerLegacyBarokTools(server, {
    debug,
    pollinations: {
      tools: [
        {
          name: 'generateImage',
          description: 'Generate an image from text prompt using Pollinations AI',
          inputSchema: asMcpToolInputSchema(ImageGenerationSchema.export()),
          annotations: { readOnlyHint: false },
        },
        {
          name: 'generateText',
          description: 'Generate text using Pollinations AI models',
          inputSchema: asMcpToolInputSchema(TextGenerationSchema.export()),
          annotations: { readOnlyHint: false },
        },
        {
          name: 'chatCompletion',
          description: 'OpenAI-compatible chat completion with tool calling support',
          inputSchema: asMcpToolInputSchema(ChatCompletionSchema.export()),
          annotations: { readOnlyHint: false },
        },
      ],
      parseImageArguments: (value) => GenerateImageParamsSchema.parse(value),
      parseTextArguments: (value) => GenerateTextParamsSchema.parse(value),
      parseChatArguments: (value) => ChatCompletionParamsSchema.parse(value),
      parseApiKeyArguments: (value) => SetApiKeyParamsSchema.parse(value),
      generateImage: (args) => pollinationsClient.generateImage(args as GenerateImageParams),
      generateText: (args) => pollinationsClient.generateText(args as GenerateTextParams),
      chatCompletion: (args) => pollinationsClient.chatCompletion(args as ChatCompletionParams),
      setApiKey: (apiKey) => pollinationsClient.setApiKey(apiKey),
      validateImageResponse: validationPort(validatePollinationsImageResponse),
      validateTextResponse: validationPort(validatePollinationsTextResponse),
      validateChatResponse: validationPort(validatePollinationsChatResponse),
    },
    devTools: {
      tools: getAllToolDefinitions().map((definition) => ({
        name: definition.name,
        description: definition.description,
        inputSchema: asMcpToolInputSchema(definition.inputSchema),
      })),
      execute: async (name, args: LegacyMcpArguments) => {
        // MCP stdio does not expose a caller AbortSignal, so provide a local signal
        // to activate the shared executor timeout boundary.
        const controller = new AbortController();
        const policyAudit: PolicyAuditRecord[] = [];
        return executeAction(
          { action: name, action_input: args },
          toolRegistry,
          controller.signal,
          {
            workspace: process.cwd(),
            // The standalone MCP transport has no interactive approval UI;
            // its explicit server scope is the approval boundary.
            policy: { mode: 'full_workspace', approvedScopes: ['*'] },
            policyAudit,
            toolEvidenceLedger,
            toolExecutionState,
            toolScheduler,
          },
        );
      },
      validateResult: validationPort(validateDevToolResult),
      validateCallResult: validationPort(validateCallToolResult),
    },
  });

  const transport = new StdioServerTransport();
  console.error(`🚀 ${MCP_SERVER_NAME} v${MCP_SERVER_VERSION} starting...`);
  await server.connect(transport);
  console.error('✅ MCP server ready');
}
