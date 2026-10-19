# @barok/adapter-mcp

This private workspace provides MCP request handlers without starting a
transport. Its Core-backed tools validate each input and return bounded JSON
results or a stable error message. A separate injected legacy registration
supports the application's Pollinations and DevTools surfaces without importing
the app's providers, schemas, executor, filesystem, or database.

Current tools are `barok_classify_task`, `barok_normalize_file_paths`,
`barok_sanitize_task_analysis`, and `barok_redact_policy_text`. The independent
stdio composition is in [`apps/mcp-server`](../../apps/mcp-server/README.md).
The independent Core-only stdio composition is in
[`apps/mcp-server`](../../apps/mcp-server/README.md). The existing application
entry at `src/mcp/server.ts` now composes the Pollinations and DevTools ports
with the handlers exported here; provider, schema, and tool execution
implementations remain in the app.

Build with `npm run build:adapter-mcp`. The workspace depends only on Core and
the MCP SDK.
