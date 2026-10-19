import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { jest } from '@jest/globals';
import {
  registerLegacyBarokTools,
  type LegacyMcpArguments,
  type LegacyMcpToolsOptions,
} from '../../../packages/adapter-mcp/src/legacy-tools.js';

type RequestHandler = (request: any) => Promise<any>;

function createHarness(options: LegacyMcpToolsOptions) {
  const handlers: RequestHandler[] = [];
  const server = {
    setRequestHandler: (_schema: unknown, handler: RequestHandler) => handlers.push(handler),
  } as unknown as Server;
  registerLegacyBarokTools(server, options);
  return {
    list: () => handlers[0]({}),
    call: (name: string, args?: unknown) => handlers[1]({ params: { name, arguments: args } }),
  };
}

function createOptions(overrides: Partial<LegacyMcpToolsOptions> = {}): LegacyMcpToolsOptions {
  const noopParse = (value: unknown) => value as LegacyMcpArguments;
  return {
    pollinations: {
      tools: [
        { name: 'generateImage', description: 'image', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: false } },
        { name: 'generateText', description: 'text', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: false } },
        { name: 'chatCompletion', description: 'chat', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: false } },
      ],
      parseImageArguments: noopParse,
      parseTextArguments: noopParse,
      parseChatArguments: noopParse,
      parseApiKeyArguments: (value) => value as { api_key: string },
      generateImage: async () => ({ url: 'https://images.test/result', data: 'x'.repeat(120) }),
      generateText: async () => ({ text: 'generated' }),
      chatCompletion: async () => ({ choices: [] }),
      setApiKey: jest.fn(),
    },
    devTools: {
      tools: [{ name: 'Read', description: 'read a file', inputSchema: { type: 'object', properties: {} } }],
      execute: async () => JSON.stringify({ success: true, output: 'done' }),
    },
    ...overrides,
  };
}

describe('legacy MCP tool registration', () => {
  test('lists Pollinations and DevTools while keeping setApiKey unlisted', async () => {
    const harness = createHarness(createOptions());
    const result = await harness.list();

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'generateImage', 'generateText', 'chatCompletion', 'Read',
    ]);
    expect(result.tools.every((tool: { annotations?: { readOnlyHint?: boolean } }) => tool.annotations?.readOnlyHint === false)).toBe(true);
  });

  test('formats Pollinations responses and keeps API-key setup callable', async () => {
    const options = createOptions();
    const harness = createHarness(options);
    const imageResult = await harness.call('generateImage', { prompt: 'test' });
    const imagePayload = JSON.parse(imageResult.content[0].text);
    expect(imagePayload).toEqual({
      success: true,
      url: 'https://images.test/result',
      data: `${'x'.repeat(100)}...`,
    });

    expect(await harness.call('generateText', { prompt: 'test' })).toEqual({
      content: [{ type: 'text', text: '{\n  "text": "generated"\n}' }],
    });
    expect(await harness.call('setApiKey', { api_key: 'key' })).toEqual({
      content: [{ type: 'text', text: 'API key configured.' }],
    });
    expect(options.pollinations.setApiKey).toHaveBeenCalledWith('key');
  });

  test('uses the injected executor and reports errors for malformed or unknown calls', async () => {
    const execute = jest.fn(async () => JSON.stringify({ success: false, status: 'error', error: 'denied' }));
    const harness = createHarness(createOptions({ devTools: { tools: [{ name: 'Read', description: 'read', inputSchema: { type: 'object', properties: {} } }], execute } }));

    const devToolResult = await harness.call('Read', { path: 'a.txt' });
    expect(execute).toHaveBeenCalledWith('Read', { path: 'a.txt' });
    expect(devToolResult.isError).toBe(true);
    expect(JSON.parse(devToolResult.content[0].text)).toMatchObject({ success: false, error: 'denied' });

    const malformed = createHarness(createOptions({
      pollinations: {
        ...createOptions().pollinations,
        parseImageArguments: () => { throw Object.assign(new Error('invalid'), { issues: [{ path: ['prompt'], message: 'Prompt is required' }] }); },
      },
    }));
    expect((await malformed.call('generateImage', {})).content[0].text).toBe('Tool execution error: Validation error: prompt: Prompt is required');
    expect((await harness.call('missing', {})).isError).toBe(true);
  });
});
