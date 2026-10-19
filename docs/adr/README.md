# Architecture Decision Records (ADRs)

Architecture Decision Records capture important architectural decisions made during the design, evolution, and maintenance of the Barok project.

## What is an ADR?

An Architecture Decision Record (ADR) is a lightweight document that records:
1. **Context:** The context, problem statement, or requirement that motivated the decision.
2. **Options Considered:** The alternatives evaluated.
3. **Decision:** The chosen path, including technical rationale.
4. **Consequences:** The positive outcomes, trade-offs, and technical debt incurred.

ADRs are immutable once accepted. If a decision changes in the future, a new ADR is created that explicitly supersedes the older one.

---

## Index of Records

| ADR # | Title | Date | Status | Summary |
| :--- | :--- | :--- | :--- | :--- |
| [**0001**](./0001-monorepo-extraction.md) | Single Monorepo with Modular Package Extractions | 2026-10-09 | **Accepted** | Keep Barok in one monorepo and extract `@barok/core`, `@barok/engine`, `@barok/adapter-node`, `@barok/adapter-mcp`, and `@barok/plugin-deepseek` as distinct npm packages. |
| [**0002**](./0002-node-sqlite-persistence.md) | Native Node.js SQLite (`node:sqlite`) for Local Persistence | 2026-10-10 | **Accepted** | Use Node 22's built-in `DatabaseSync` (`node:sqlite`) for zero-external-dependency ACID storage of threads, runs, checkpoints, and event streams. |
| [**0003**](./0003-version-alignment-experimental.md) | Unified `0.0.1-experimental` Pre-Release Versioning | 2026-10-19 | **Accepted** | Align the root application and all internal packages to `0.0.1-experimental` to establish a semver-compliant pre-release baseline. |

---

## ADR Template for New Proposals

When proposing a new architectural change, copy the template below and save it as `docs/adr/NNNN-title-in-kebab-case.md`:

```markdown
# ADR-NNNN: [Short Title]

- **Status:** Proposed | Accepted | Deprecated | Superseded by [ADR-XXXX]
- **Date:** YYYY-MM-DD
- **Deciders:** [Contributors / Team]
- **Relevant Issues / PRs:** [#XXX]

## 1. Context and Problem Statement
What context, requirements, or technical challenges triggered this decision?

## 2. Decision Drivers
- [Driver 1, e.g. strict type safety]
- [Driver 2, e.g. zero runtime overhead]
- [Driver 3, e.g. backward compatibility with existing hosts]

## 3. Considered Options
1. **Option 1:** [Description, Pros, Cons]
2. **Option 2:** [Description, Pros, Cons]
3. **Option 3:** [Description, Pros, Cons]

## 4. Decision Outcome
Chosen option: **Option X** because [rationale].

### Positive Consequences
- [Advantage 1]
- [Advantage 2]

### Negative Consequences / Trade-offs
- [Trade-off 1]
- [Technical debt or follow-up work needed]

## 5. Implementation Notes & Validation
How will this decision be verified and implemented?
```

