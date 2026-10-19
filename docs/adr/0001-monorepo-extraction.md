# ADR-0001: Single Monorepo with Modular Package Extractions

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** Barok Core Team
- **Relevant Issues / PRs:** `barok_move_todo/TODO.md`

## 1. Context and Problem Statement
Barok originated as a unified application combining a standalone ReAct development dashboard, an Express server, an MCP stdio server, and bespoke developer tools. As the project evolved, requirements emerged to:
1. Provide a lightweight, embeddable plugin for the **DeepSeek Harness** ecosystem.
2. Expose core task classification, path normalization, and ReAct loop contracts without forcing consumers to pull in Express, React, Vite, or SQLite.
3. Keep host-specific Node.js bindings (process execution, filesystem access) separate from host-neutral algorithms.

A decision was required on whether to split the codebase into multiple independent Git repositories or retain a single monorepo with workspace-based package extractions.

## 2. Decision Drivers
- Need for atomic, single-commit updates across contracts and implementations.
- Avoid multi-repository synchronization overhead and cross-repo CI complexity during active prototyping.
- Enable independent publishing to npm under the `@barok` scope when packages reach maturity.
- Prevent circular dependencies between host-neutral logic and concrete platform adapters.

## 3. Considered Options
1. **Multi-Repo Split:** Separate Git repositories for `barok-core`, `barok-engine`, `barok-harness-plugin`, and `barok-app`.
   - *Pros:* Strict physical isolation.
   - *Cons:* High maintenance overhead; painful atomic PRs; difficult local testing during early extraction phases.
2. **Single Monorepo with npm Workspaces (Chosen):** Keep `<path-to-barok>` as the canonical root monorepo; extract decoupled packages into `packages/` (`core`, `engine`, `adapter-node`, `adapter-mcp`, `plugin-deepseek`) and standalone apps into `apps/`.
   - *Pros:* Unified Git history, shared test harness, zero git submodule friction, independent npm package versions.
   - *Cons:* Requires discipline to avoid leaking root imports into extracted packages.

## 4. Decision Outcome
Chosen option: **Single Monorepo with npm Workspaces**.

### Package Responsibility Boundaries
- **`packages/core`:** Pure TypeScript logic with zero external dependencies (no Node native APIs, no frameworks). Contains task classifiers, path normalization, sanitized analysis views, error redaction, and base contracts.
- **`packages/engine`:** Pure ReAct contracts, observation compaction, pricing & budgets, execution pacing, run lifecycle policies, and quality gate definitions.
- **`packages/adapter-node`:** Concrete Node.js implementations of injected capability ports (guarded process executor, path canonicalization, workspace fingerprinting, Playwright verifier discovery).
- **`packages/adapter-mcp`:** Stdio MCP tool definitions and request/response serialization.
- **`packages/plugin-deepseek`:** Cordis-compatible DeepSeek Harness bundle exposing Barok Core helpers and prompt guidance.
- **`src/` & `server.ts`:** The root standalone application consuming the extracted packages.

### Consequences
- **Positive:** Developers can run full unit test suites (175 suites, ~3,000 tests) and verify the entire system with a single command.
- **Positive:** Clear architectural boundaries enforced by package-level `tsconfig.json` and explicit `exports` manifests.
- **Trade-off:** Requires ongoing auditing of imports to ensure `@barok/core` and `@barok/engine` remain strictly host-neutral.

