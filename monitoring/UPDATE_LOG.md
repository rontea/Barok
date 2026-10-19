# Update Log - Current Session

Track changes made in the current working session here. This serves as a running log before changes are committed and documented in CHANGELOG.md.

## Session: 2026-10-19

### Updates Made

#### Current Working Tree (2026-10-19)
- **Type**: Release / Docs / Refactor
- **Summary**: Monorepo version upgrade to 0.0.1-experimental, comprehensive system documentation, path generalization, and workspace cleanup
- **Files Changed**: 12 files

**Key Changes:**
1. Version Alignment to `0.0.1-experimental`:
   - Updated root `package.json` from `1.0.0` to `0.0.1-experimental`.
   - Updated all extracted monorepo packages (`@barok/core`, `@barok/engine`, `@barok/adapter-node`, `@barok/adapter-mcp`, `@barok/plugin-deepseek`, `@barok/mcp-server`, `barok-core-consumer-example`) from `0.0.0` to `0.0.1-experimental`.
   - Synchronized all internal package dependency versions to `0.0.1-experimental`.
2. Master System Documentation (`docs/system_documentation/`):
   - Created comprehensive `docs/system_documentation/SYSTEM_DOCUMENTATION.md` detailing system architecture, package boundaries, ReAct execution lifecycle, tool sandboxing, multi-agent orchestration, multi-key provider routing, SQLite persistence, verification gates, and configuration profiles.
   - Created folder index `docs/system_documentation/README.md` and registered the new section in `docs/README.md`.
3. Cross-Platform Path Generalization:
   - Replaced machine-specific hardcoded `C:\` paths in `README.md` and `packages/plugin-deepseek/README.md` with generic placeholders (`<path-to-barok>`, `<path-to-deepseek-harness>`, `<path-to-models>`) with clear cross-platform examples for Windows, macOS, and Linux.
4. Workspace & Filesystem Cleanup:
   - Removed 8 obsolete root command/test log dumps (`debug.log`, `out.log`, `out2.log`, `out3.log`, `out4.log`, `out_directed.log`, `out_directed2.log`, `test_out.txt`) and empty `scratch/` folder (~536 KB reclaimed).
5. Comprehensive Verification:
   - Successfully built all monorepo packages (`npm run build:packages`).
   - Verified zero TypeScript compilation errors (`npm run typecheck`).
   - Ran 175 unit test suites (2,981 passed tests; `npm run test`).
   - Verified offline smoke tests (`npm run smoke`) and offline evaluation fixtures (13/13 passed; `npm run test:evals:offline`).

**Impact**: Establishes initial versioned pre-release identity for Barok monorepo packages, provides centralized architectural documentation, enhances open-source accessibility of README instructions, and declutters working tree.
**Testing**: `npm run build:packages`, `npm run typecheck`, `npm run test`, `npm run smoke`, `npm run test:evals:offline`

## Session: 2026-06-19

### Updates Made

#### Current Working Tree (2026-06-19)
- **Type**: Fix
- **Summary**: Fixed Gemini/Pollinations provider routing and updated native Gemini retries/defaults
- **Files Changed**: 6 files

**Key Changes:**
1. LLM provider routing: Gemini model requests now prefer the Gemini provider before Pollinations.
2. Pollinations fallback: Gemini model names are normalized to `qwen-coder` when Pollinations is used as a fallback, avoiding Pollinations `BAD_REQUEST` errors for `gemini-2.5-flash`.
3. Native Gemini retries: Gemini SDK retries now rotate across current Flash fallback models and log the specific model attempted.
4. UI defaults: ReAct UI defaults and status text now use `gemini-3.5-flash`, matching the current Gemini docs examples.
5. Regression coverage: Added focused unit tests for Gemini-first routing, Pollinations fallback normalization, direct Pollinations provider normalization, and native Gemini SDK model usage.

**Impact**: Fixes failures where UI selections such as `gemini-2.5-flash` were forwarded to Pollinations and reduces repeated native Gemini retries against a busy model.
**Testing**: `npm.cmd run test:unit -- llmProvider.test.ts`; `npm.cmd run build`
**Notes**: `npm` PowerShell shim was blocked by local execution policy, so verification used `npm.cmd`.

#### Commit: aa5f208 (2026-06-19)
- **Type**: Comprehensive Refactor
- **Summary**: Major project restructuring with enhanced documentation, testing, and validation
- **Files Changed**: 113 files (34,456 insertions, 3,504 deletions)

**Key Changes:**
1. Documentation restructuring
   - Moved documentation to organized `docs/` folder
   - Categories: api, architecture, core, features, security
   - Added new docs: USER_GUIDE.md, README.md, API_RESPONSE_FORMATS.md

2. Enhanced source code structure
   - Added `src/config/` module for configuration management
   - Added `src/di/` module for dependency injection
   - Added `src/logging/` module for structured logging
   - Added `src/validation/` for validation utilities
   - Added `src/cli/` for CLI commands and UI

3. React engine improvements
   - New: budget-manager.ts - Resource budget management
   - New: executor.ts - Tool execution logic
   - New: logger.ts - React engine logging
   - New: planner.ts - Planning logic
   - New: state-manager.ts - State management
   - New: tool-router.ts - Tool routing

4. Testing infrastructure
   - Added Jest configuration
   - New test files: crew.test.ts, devTools.test.ts, pathValidator.test.ts
   - Smoke tests for various endpoints

5. New utilities
   - executionTimeout.ts - Tool timeout protection
   - pathValidator.ts - Path validation
   - responseValidator.ts - API response validation
   - stringValidators.ts - String validation utilities
   - retryPolicy.ts - Retry logic

6. UI components
   - New Vite configuration for React UI
   - Components: App.tsx, StructureExplorer.tsx
   - Component library: FormComponents, LoadingComponents, ModalComponents, etc.

---

## Format for New Entries

```
### Commit: {hash} ({date})
- **Type**: {Feature/Fix/Refactor/Test/Docs/Performance/Security}
- **Summary**: {One-line summary}
- **Files Changed**: {n} files

**Key Changes:**
1. {Category}: {Description}
2. {Category}: {Description}

**Impact**: {Potential impacts or dependencies affected}
**Testing**: {Tests added or affected}
**Notes**: {Any additional notes}
```

---

## Active Issues / TODOs

- [ ] Verify all tests pass
- [ ] Performance baseline established
- [ ] Security audit completed
- [ ] Documentation reviewed
- [ ] Team notified of changes
