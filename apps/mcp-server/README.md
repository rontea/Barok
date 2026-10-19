# Barok Core MCP Server

An independent MCP stdio composition over `@barok/adapter-mcp`. It registers
only read-only Core operations and does not start the standalone ReAct engine.
Run `npm run build:mcp-server`, then `npm run start --workspace=@barok/mcp-server`.

The existing application MCP entry point and its Pollinations/dev-tool surface
remain in `src/mcp/server.ts`; this package currently proves the separate,
host-neutral Core path without changing that app-facing protocol.
