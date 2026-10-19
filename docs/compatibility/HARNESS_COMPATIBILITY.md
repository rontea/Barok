# DeepSeek Harness Compatibility

## Tested development line

| Component | Version observed in the local Harness checkout | Verification |
|---|---:|---|
| DeepSeek Harness (`dsh`) | `0.2.0-rc.2` | Disposable profile selected the bundle layer and booted a real `runProfile` context. |
| `@deepseek-ai/cordis` | `4.0.4` | Plugin typecheck and runtime registration. |
| `@deepseek-ai/dsh-tools` | `0.2.0-rc.2` | Plugin typecheck, tool registration, schema lookup, and tool execution. |
| `@barok/core` | local packed workspace build (`0.0.1-experimental`) | Installed as a package dependency from a Core tarball in the temporary profile; no source was copied into the Harness checkout. |

This documents one runtime-tested development line only. It is not a promise of support for all `0.2.x` releases or future Harness versions. The plugin manifest declares peer ranges `@deepseek-ai/cordis >=4.0.4 <5.0.0 || 4.0.5-alpha.2`, `@deepseek-ai/dsh-tools >=0.2.0-rc.2 <0.3.0 || 0.2.1-alpha.4`, and `@deepseek-ai/dsh-system-prompt >=0.2.0-rc.2 <0.3.0 || 0.2.1-alpha.4`; only the exact versions above have been exercised at runtime.

## Current alpha source review

- Reviewed the local DeepSeek Harness `0.2.1-alpha.4` source on 2026-10-16. The plugin's `defineTool`, `tools.register`, and `systemPrompt.section` API usage remains available.
- Harness `0.2.1-alpha.4` uses Cordis `4.0.5-alpha.2`; the plugin's Cordis peer range explicitly includes that prerelease. Its `dsh-tools` and `dsh-system-prompt` ranges also cover `0.2.1-alpha.4`.
- This was a source and version-range review, not a profile load test. The runtime-tested boundary above remains `0.2.0-rc.2` with Cordis `4.0.4`.

## What was exercised

- Built the private local bundle from `packages/plugin-deepseek/` and validated it against declarations from the separate Harness checkout.
- Installed a staged packed plugin in a disposable profile using the profile package manager. For this test only, the staged plugin manifest pointed to a packed Core tarball through a local `file:` dependency because Core is not published; the checked-in manifest remains at `@barok/core: 0.0.1-experimental`.
- Also ran the local source-checkout command `dsh plugin --profile barok-dev add <path-to-barok>\packages\plugin-deepseek` through the Harness `0.2.0-rc.2` checkout with an isolated `DSH_HOME`; the profile manager linked the Barok workspace package and `dsh --profile barok-dev --dump-config` selected its bundle layer.
- Confirmed `dsh --dump-config` selected the bundle layer, booted the profile's real `runProfile`, and observed `barok_classify_task` in the Harness tool registry.
- Called `barok_classify_task` through the Harness tool registry and received the Core result `{ classification: "bug_fix" }`.
- Follow-up on 2026-10-12: booted the source-checkout profile through `runProfile`, called `barok_classify_task` and received `{ classification: "bug_fix" }`, confirmed empty `task` returns an error, then shut down and confirmed the plugin's tool registrations were removed.
- Separately used an MCP SDK client over stdio to list the new MCP tools, call Core-backed tools, and confirm malformed path input returns an error.
- Latest root verification on 2026-10-13: typecheck and production build passed; the full unit suite passed (175 suites, 2,981 tests; 1 suite and 2 tests skipped) after additional Engine policy, host-port, timer-reference, ReAct output-schema, context-contract, and run-scoped tool extractions. Focused Engine, validation, context, and tool suites also passed. This updates root verification only; the Harness profile/tool exercise remains the tested development compatibility boundary recorded above.

## Current plugin boundary

The bundle registers two read-only tools (`barok_classify_task` and `barok_normalize_file_paths`) through the Harness `tools` service. Both delegate to the public Core API. It does not start Barok's ReAct loop, access the filesystem, write session state, use credentials/settings/storage, or open Harness databases.

The MCP package separately exposes four read-only Core operations over local stdio. It is independent of the Harness plugin. The legacy `src/mcp/server.ts` composition now uses Pollinations and DevTools handlers from `packages/adapter-mcp/`, with app-specific services injected at startup.

## Release status and limits

- The plugin package is private and depends on `@barok/core` version `0.0.1-experimental`; this dependency is only usable through the local development artifact workflow.
- Nothing has been published. npm returned E404/no accessible version for `@barok/core`, `@barok/engine`, `@barok/adapter-node`, `@barok/adapter-mcp`, and `@barok/plugin-deepseek`; the response also covers packages the current account cannot read, so scope ownership and package reservation remain unconfirmed.
- No published dependency resolution, normal released-profile installation/update, version matrix, or persistence migration has been verified. Plugin disposal was verified for the tested local Harness line.
- Before claiming another Harness version, repeat typecheck, bundle load, tool registration/call, malformed-input handling, and disposal checks against that version and record the exact result here.
