# ADR-0002: Native Node.js SQLite (`node:sqlite`) for Local Persistence

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** Barok Core Team
- **Relevant Issues / PRs:** `src/persistence/sqliteStore.ts`

## 1. Context and Problem Statement
Barok requires persistent local storage for conversational sessions (`coder_threads`), execution runs (`agent_runs`), event-sourced telemetry (`agent_run_events`), context snapshots (`context_snapshots`), workspace rollback points (`restore_points`), and server instance states.

Previously, projects often relied on third-party native C++ bindings (such as `better-sqlite3` or `sqlite3`) or network database daemons (such as PostgreSQL). Native C++ modules frequently introduce compilation issues across diverse operating systems (Windows MSVC, macOS clang, Linux gcc) and require python / node-gyp build tooling during `npm install`.

## 2. Decision Drivers
- Zero external build toolchains or compiler requirements during installation.
- Synchronous, transactional ACID guarantees for atomic step persistence.
- Single-file local storage located within the project's `storage/` directory.
- Fast query performance for large event-sourced audit logs.

## 3. Considered Options
1. **Third-party Native Bindings (`better-sqlite3`):**
   - *Pros:* High performance, mature API.
   - *Cons:* Binary compilation step (`node-gyp`), potential rebuild failures across Node version upgrades.
2. **Pure JavaScript SQLite (e.g. `sql.js` via WebAssembly):**
   - *Pros:* Portable.
   - *Cons:* In-memory only by default, requires manual disk synchronization, slower for multi-megabyte audit histories.
3. **Native Node.js `node:sqlite` (`DatabaseSync`) (Chosen):**
   - *Pros:* Built directly into Node.js (v22+), zero dependencies, zero compilation steps, synchronous API matching ACID requirements, official Node foundation support.
   - *Cons:* Experimental warning emitted by Node.js runtime.

## 4. Decision Outcome
Chosen option: **Native `node:sqlite` (`DatabaseSync`)**.

### Implementation Architecture
- The persistence layer is centralized in `src/persistence/sqliteStore.ts`.
- `storage/react-engine.sqlite` serves as the primary local store.
- During test execution, Jest generates an isolated temporary database in the operating system's temp directory (`os.tmpdir()`), preventing race conditions between test suites.
- Checkpoints and context snapshots are serialized as JSON blobs within relational event tables.

### Consequences
- **Positive:** Fresh project clones can run `npm install` without needing C++ compilers or native rebuild steps.
- **Positive:** Synchronous transactional writes ensure that if the server process terminates abruptly, no partial step events are left in an uncommitted state.
- **Trade-off:** Node emits an `ExperimentalWarning: SQLite is an experimental feature`. This is suppressed or accounted for in test runners.

