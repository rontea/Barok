import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerBarokCoreTools } from '@barok/adapter-mcp';

const server = new Server(
  { name: 'barok-core-mcp', version: '0.0.0' },
  { capabilities: { tools: {} } },
);
registerBarokCoreTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  await server.close();
  process.exitCode = 0;
}

process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
