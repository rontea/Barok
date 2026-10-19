# @barok/engine

This private workspace is the home for Barok's optional standalone ReAct
engine. Its current slices include structural ReAct step/result, reasoning,
work-plan and approval-request contracts; coding-state transitions, recovery
record contracts and phase budgets; recovery-transition classification using
host-supplied success evidence; the provider-neutral structured
agent-decision protocol, plan-approval state and plan-item contracts,
host-neutral budget and model-pricing logic,
performance tracing, run safety limits, retry policy, local output-budget rules, token and
context accounting, cost tracking, continuation path normalization and handoff
summaries, verification-command classification, verification plan selection,
acceptance-evidence assessment and repair-loop decisions, and shared run-control decisions. The app
imports these through the public `@barok/engine` entry; the former
`src/react/` modules remain compatibility re-exports.

The package also owns the structural `ToolAction` contract and the host-neutral rule that blocks text-file writes to PDF/DOCX source documents. The ReAct loop sends selected actions through `ReActEngineRuntime.executeToolAction`; the Node composition supplies Barok's guarded filesystem/process executor.

Engine also owns action category/risk classification and the structural policy audit record. Filesystem-aware authorization and approval checks remain in the app's permission adapter, which re-exports these shared contracts for compatibility.

Generated-app behavior now has host-neutral Engine slices too: app request classification/spec normalization, manifest and verification contracts, successful-output projection with an injected path resolver, and verification-repair analysis/task construction. The old `src/react/app-spec.ts`, `app-manifest.ts`, and policy portion of `app-repair.ts` remain compatibility facades. Browser verification, filesystem repair-file discovery, canonical path resolution, and durable manifest storage stay in host implementations.

Verification planning and completion evidence review live in Engine. Repair signatures receive a host hashing function; the ReAct runtime supplies the same Node SHA-256 implementation used for request envelopes. The former `src/tools/verificationPlanner.ts` and `verificationCoordinator.ts` paths remain compatibility facades, while command execution stays app-owned.

The generated-app quality gate definitions, evidence checks, scoring, and formatting also live here. The former `src/react/quality-gates.ts` path re-exports the Engine implementation.

Terminal run advice classification and its bounded operator guidance are also Engine-owned. The server run manager imports the package API directly; the old source module remains a compatibility facade.

Structured and legacy tool-observation success interpretation, reasoning-summary selection, verification-observation projection, and verification-failure formatting are also exported by Engine. The existing `src/react/engine.ts` path re-exports these helpers for compatibility.

Planner response text handling now lives in Engine: safe extraction of JSON and XML-like tool calls, malformed JSON repair, and assistant-message envelope normalization. The planner imports these pure helpers from the package; its previous exported helper names remain available through `src/react/planner.ts` for compatibility. Provider requests, tool selection policy, and Barok state-aware recovery remain in the app.

Execution pacing calculations are pure Engine functions that receive a resolved execution-profile preset; profile selection and defaults stay with the host runtime.

Inspection replay rules for already-visible file ranges and recent unchanged reads are Engine-owned. The app supplies current-task steps and retained-context coverage, keeping prompt construction and state slicing host-side.

Cross-run exact-replay classification and stable action-input comparison also live in Engine. The app facade supplies the saved run marker and current steps.

The `RunScopedWorkspaceCapability` shape is a structural Engine contract. Workspace creation, authorization checks, and deletion are implemented by `adapter-node` and exposed to the loop through the runtime's optional cleanup port.

Engine identifier creation also goes through `ReActEngineRuntime.createId()`. The Node adapter provides the RFC 4122 version 4 implementation using `node:crypto`.

Per-run capability-scope creation now goes through `ReActEngineRuntime.createCapabilityScope()`. The standalone app still supplies its Cordis-backed scope implementation, while the ReAct loop depends on the structural scope contract.

Node timer `unref()` behavior is also an optional runtime capability, so the loop does not depend on the Node timer class. Hosts without referenced timers can omit it.

The host platform identifier is supplied through `ReActEngineRuntime.getPlatform()`. Engine formats platform-specific shell guidance from that string, and `adapter-node` provides the process-backed implementation.

The app's loop imports checkpoint transforms and observation-compaction metrics directly from Engine. Node workspace fingerprints continue to enter through the runtime port; the old checkpoint facade remains for other app callers.

ReAct step/result schemas and their validation helpers live in Engine so loop output validation does not depend on the app's general-purpose response validator. Existing schema and validator exports under `src/types/schemas.ts` and `src/validation/responseValidator.ts` remain compatibility re-exports. Engine declares Zod as a direct dependency for these schemas.

The durable observable context snapshot and message shapes, plus their pure shape validator, are Engine contracts. Snapshot persistence stays in the app, with its previous persistence module re-exporting the shared contract and validator.

The run-scoped `Think`, `Todo`, and `WorkPlan` tool definitions also live here. They accept structural state access/update callbacks, while the app loop supplies event and durable-state projections. Existing `src/react/*-tool.ts` paths remain compatibility re-exports.

Retry classification, delay calculation, retry/rotation execution, and result formatting are Engine-owned. The former `src/utils/retryPolicy.ts` module had no remaining in-repository imports after consumers switched to the Engine public entry, so it was removed.

Deterministic observation compaction for command, grep, and list results also lives in Engine. The pure API accepts an optional serialization port; the app compatibility facade supplies Barok's slow-operation instrumentation. Raw tool-result persistence remains host-owned.

Bounded child-subtask planning and sequential dispatch policy use structural parent-state, launch, and event contracts. Engine owns scope separation, evidence handoff limits, budget checks, and report bounding; the app still launches child runs through its selected provider.

Checkpoint creation, handoff validation, freshness comparison, and
resume/repair/rebase state transforms now use a structural state contract and a
host-supplied workspace fingerprint function. The app's
`src/react/checkpoint.ts` facade supplies the Node implementation by default.
Engine also creates the bounded event/evidence/request-identity handoff and
resume progress cursor after the host allocates a checkpoint event sequence,
and classifies whether a checkpoint contains successful source mutation.
The full ReAct loop, run orchestration, restart recovery, continuation
triggers/orchestration, and SQLite checkpoint persistence have not moved yet.
Engine depends on Core for policy-text redaction and will use Core contracts as
more host-neutral slices move. Provider SDKs, Node
filesystem/process implementations, and host lifecycle code belong in
adapters.

The `ReActEngineRuntime` contract and its structural provider, tool, logging,
cache, workspace, and persistence port types are exported from this package.
`src/react/engine-runtime.ts` remains a compatibility type re-export; the Node
implementations stay in the existing DI composition.

Provider completion results, stream events, tool-call payloads, and request
telemetry are also Engine contracts. The previous `src/di/types.ts` exports
re-export them for app compatibility; `src/react/engine.ts` now uses Engine's
provider and tool-registry interfaces directly.

The standalone loop's `ReActEngineConfig` contract is also Engine-owned and
generic over host state, events, checkpoints, task analysis, task routing,
approval grants, and state snapshots. Barok specializes it as `ReactConfig` in
`src/react/state-manager.ts`, preserving its current app API while keeping
those app types out of Engine.

The generic `ReActEngineState` shape and `ReActEngineEvent` stream union are
Engine contracts too. The app specializes them for Barok's task analysis,
routing, approval grants, dirty-tree/tool-lifecycle records, task-analysis view,
capability-pack names, and Cordis events. `ReactState` and `AgentStreamEvent`
remain available through their existing state-manager path.

Engine also owns answered-user-question tracking, plan cursor advancement and
formatting, retained-read prompt context, and compact step-history rendering.
Engine also owns the bounded live-state projection and reusable terminal,
budget, verification, manifest, successful-step, recovery-streak, and edit-
stagnation helpers, app-spec setter, state-budget projection,
continuation-aware task/evidence windows, stable ReAct action signatures, and
repeated-inspection/no-progress detection. The app's
planner and ReAct loop import these helpers directly from Engine; the previous
state-manager exports remain for compatibility. State creation and
Barok-specific evidence gates remain app-owned.

Build the package and its declarations with `npm run build:engine` from the
repository root. The package remains private at version `0.0.0` while its API
and eventual publication are reviewed. The DeepSeek Harness plugin should use
the Harness loop where it covers an operation and should not start a second
loop by default.
