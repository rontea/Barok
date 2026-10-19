# Changelog

All notable changes to this project are documented here.

## [0.0.1-experimental] - 2026-10-19

### Added
- Created master system documentation in `docs/system_documentation/` (`SYSTEM_DOCUMENTATION.md` and `README.md`) covering system architecture, monorepo packages, ReAct engine, security sandboxing, multi-agent orchestration, LLM provider routing, persistence, UI/API endpoints, and verification gates.
- Linked System Documentation into the master documentation hub in `docs/README.md`.

### Changed
- Aligned project versions to `0.0.1-experimental` across the root package and all extracted monorepo packages (`@barok/core`, `@barok/engine`, `@barok/adapter-node`, `@barok/adapter-mcp`, `@barok/plugin-deepseek`, `@barok/mcp-server`, `barok-core-consumer-example`).
- Synchronized all internal package dependency constraints to `0.0.1-experimental`.
- Generalised setup and execution instructions across `README.md` and `packages/plugin-deepseek/README.md` by replacing machine-specific hardcoded paths with cross-platform placeholders (`<path-to-barok>`, `<path-to-deepseek-harness>`, `<path-to-models>`) and multi-OS examples.

### Deleted
- Cleaned up obsolete root output and log redirects (`debug.log`, `out.log`, `out2.log`, `out3.log`, `out4.log`, `out_directed.log`, `out_directed2.log`, `test_out.txt`) and empty `scratch/` directory (~536 KB reclaimed).

## [Latest] - 2026-06-19

### Fixed
- Routed Gemini model requests to the Gemini provider first and normalized Pollinations fallback calls to `qwen-coder`, preventing Pollinations from rejecting `gemini-2.5-flash` as an invalid model alias.
- Updated Gemini runtime defaults to `gemini-3.5-flash`, added Gemini model rotation on native SDK retries, and improved retry logs to show the attempted model names.

### Changed
- Restructured documentation into organized categories (api, architecture, core, features, security)
- Reorganized source code with new modules: config, di, logging, validation, cli
- Enhanced React engine with new components: budget-manager, executor, logger, planner, state-manager, tool-router

### Added
- Comprehensive test suite with Jest configuration
- TypeScript configuration for Vite
- ESLint configuration
- Path validation and execution timeout utilities
- Response validation and string validators
- Retry policy utilities
- Filesystem security documentation
- Multi-key pool guide
- Type safety improvements documentation
- Tool execution analysis
- Dependency injection summary
- UI component guide with React/TSX components
- Smoke tests for various API endpoints

### Deleted
- Legacy documentation files (moved to docs/)
- fix.ts (functionality integrated elsewhere)

### Commit Hash
`aa5f208` - Comprehensive project refactor

---

## Format for New Entries

```
## [Version] - YYYY-MM-DD

### Added
- Item 1
- Item 2

### Changed
- Item 1

### Fixed
- Item 1

### Deleted
- Item 1

### Security
- Item 1

### Commit Hash
`hash` - Brief description
```
