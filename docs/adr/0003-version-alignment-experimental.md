# ADR-0003: Unified `0.0.1-experimental` Pre-Release Versioning

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** Barok Core Team
- **Relevant Issues / PRs:** PR-VersionAlignment

## 1. Context and Problem Statement
During early extraction, the monorepo packages (`@barok/core`, `@barok/engine`, `@barok/adapter-node`, `@barok/adapter-mcp`, `@barok/plugin-deepseek`, `@barok/mcp-server`, and `barok-core-consumer-example`) were assigned placeholder versions (`0.0.0`), while the root application manifest retained an initial version (`1.0.0`). 

Having `0.0.0` prevented standard semver resolution and dependency tracking, while `1.0.0` at root inaccurately signaled a production-stable public API release for an architecture undergoing active extraction.

## 2. Decision Drivers
- Need for a valid Semantic Versioning (SemVer 2.0.0) format across all packages.
- Need for pre-release signaling (`-experimental`) to indicate ongoing API evolution and extraction.
- Keeping major and minor numbers at zero (`0.0.x`) to reflect the active extraction status.
- Synchronized internal package dependency resolution within npm workspaces.

## 3. Considered Options
1. **Retain `0.0.0` Local Placeholders:**
   - *Pros:* No version bump required.
   - *Cons:* Confusing; incompatible with external profile managers and standard semver tooling.
2. **Jump to `0.1.0-dev` or `1.0.0-experimental`:**
   - *Pros:* Higher version ordinal.
   - *Cons:* Unnecessary version inflation before feature completeness.
3. **Harmonize all packages to `0.0.1-experimental` (Chosen):**
   - *Pros:* Clear pre-release indicator; aligns root and subpackages; preserves zero-major/minor convention.

## 4. Decision Outcome
Chosen option: **Harmonize all packages to `0.0.1-experimental`**.

### Scope of Changes
- Root `package.json` set to `0.0.1-experimental`.
- All extracted packages in `packages/` and `apps/` set to `0.0.1-experimental`.
- Inter-package dependencies updated from `0.0.0` to `0.0.1-experimental`.
- Documentation (`docs/compatibility/HARNESS_COMPATIBILITY.md`, `SYSTEM_DOCUMENTATION.md`) updated to reflect the new version line.

### Consequences
- **Positive:** All packages now declare compliant semver ranges.
- **Positive:** npm workspaces correctly resolve dependencies between `@barok/core`, `@barok/engine`, and adapters.
- **Next Steps:** When package APIs stabilize and extraction milestones in `barok_move_todo` are complete, packages can advance to `0.1.0` or release candidates.

