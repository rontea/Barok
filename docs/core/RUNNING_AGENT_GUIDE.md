# Running Agent Guide

Operator reference for starting, monitoring, diagnosing, and tuning server-backed agent runs. This guide describes the current TypeScript/Express runtime; for installation basics see [QUICKSTART.md](./QUICKSTART.md), and for end-user workflows see [USER_GUIDE.md](./USER_GUIDE.md).

## Table of contents

- [Operator checklist](#operator-checklist)
- [Start and inspect a run](#start-and-inspect-a-run)
- [The ReAct loop](#the-react-loop)
- [Coding states and budgets](#coding-states-and-budgets)
- [Read the event stream](#read-the-event-stream)
- [Recovery and termination](#recovery-and-termination)
- [Context budgets](#context-budgets)
- [Completion and quality gates](#completion-and-quality-gates)
- [Common failure patterns](#common-failure-patterns)
- [Model tuning quick reference](#model-tuning-quick-reference)
- [Configuration and source map](#configuration-and-source-map)

## Operator checklist

Before starting a consequential task:

1. Confirm the workspace is the intended repository and the working tree is understood.
2. Confirm the selected model target supports tool calls and is reachable. `GET /api/model-capabilities?model=<target>` reports the server's capability assessment; the UI's API Pool can also test configured routes.
3. Keep the run bounded. Set a useful step/request budget and use a pacing profile appropriate to the provider quota.
4. Watch structured tool and verification evidence, not just the model's explanation or final answer.
5. Before resuming a stopped or failed run, inspect its checkpoint, current diff, last successful action, and unresolved recovery or approval request.

Runs can read and change workspace files and execute commands. The harness applies path validation, capability restrictions, approval policy, tool timeouts, and evidence gates, but it is not a remote-code sandbox. Use it only with workspaces and credentials you trust; review high-impact shell and mutation actions.

## Start and inspect a run

### Start the server

From the repository root:

```bash
npm install
npm run dev
```

The development server defaults to `127.0.0.1:3000`. Check liveness and SQLite readiness separately:

```text
GET http://127.0.0.1:3000/api/health
GET http://127.0.0.1:3000/api/health/ready
```

For production-style operation, use `npm run build` followed by `npm start`. The database is normally stored at `storage/react-engine.sqlite`.

The browser dashboard is the simplest operator interface. The managed run API is useful for automation:

```http
POST /api/runs
Content-Type: application/json

{
  "kind": "coder",
  "task": "Fix the cache invalidation bug and run its focused tests.",
  "workspace": "<path-to-workspace>",
  "model": "<configured-model-target>",
  "maxSteps": 20
}
```

`kind` can be `coder`, `react`, `agent`, or `app`. The server returns a `runId`. Omit `model` to use the configured default. A run may also carry request and pacing settings; see `src/routes/runs.ts` and the Settings screen for the accepted fields. If `SERVER_API_TOKEN` is configured, send it as a bearer token for protected API requests.

### Follow, stop, or resume

- Follow live events with `GET /api/runs/:runId/stream`.
- Read ordered event pages with `GET /api/runs/:runId/events?afterSeq=<cursor>&limit=<n>`. Save the returned cursor and use it after reconnecting.
- Read a compact run summary and child list with `GET /api/runs/:runId`; use `/projection` for incremental state and `/evidence` for raw evidence pages.
- Stop active work with `POST /api/runs/:runId/stop`. A stopped run may have a resumable checkpoint; inspect it before calling `POST /api/runs/:runId/resume`.
- Use `GET /api/runs/:runId/children` and `GET /api/runs/:runId/children/:childId/report` when diagnosing delegated work.

The server binds to loopback by default. To expose it on a LAN, follow the explicit `SERVER_HOST`, `SERVER_ALLOW_LAN`, `SERVER_API_TOKEN`, and `SERVER_CORS_ORIGINS` guidance in `.env.example`. Do not expose an unauthenticated server or commit API keys.

## The ReAct loop

The run manager creates a durable run record and checkpoint boundary, resolves the provider/model target and workspace, loads task analysis and policy, then starts a `ReActEngine`.

Each engine turn follows this cycle:

1. **Reason:** assemble the bounded task context and ask the selected model for a next step.
2. **Plan:** validate and normalize the model's structured tool selection against the available tool catalog and current task state.
3. **Execute:** enforce workspace, capability, approval, and tool-timeout rules, then invoke the selected tool.
4. **Observe:** record the tool result, file or command evidence, and any verification outcome.
5. **Assess:** update the plan and `codingState`; continue, request approval, enter recovery, or evaluate completion gates.

The final answer is not proof that the task is complete. Completion depends on current run evidence, applicable verification, scope, and any app-specific gates. Run events, checkpoints, and successful tool results remain individually inspectable if a later provider request fails.

## Coding states and budgets

`codingState` describes the engine's work phase. It is different from the server run status (`running`, `waiting_for_user`, `completed`, `failed`, `interrupted`, and related terminal or waiting states). A run can be active while its engine is `blocked` on approval or input.

The following are the current per-state step and elapsed-time budgets. They are **recovery prompts/phase limits**, not a promise that every run uses that many turns or a separate hard wall-clock timer. Ordinary tasks often pass through a state in one or a few tool turns; use the state counters in the projection for the actual run.

| `codingState` | Operator meaning and common entry evidence | Normal next step | Step budget | Time budget |
| --- | --- | --- | ---: | ---: |
| `understand` | Initial request is being resolved into an actionable outcome. | `discover`, `plan`, or approval. | 2 | 60 s |
| `discover` | Workspace and likely targets are being located. | `inspect`, `plan`, or implementation when scope is clear. | 4 | 120 s |
| `plan` | Work items, order, and checks are being selected. | `inspect`/`implement`, or `awaiting_plan_approval`. | 3 | 90 s |
| `awaiting_plan_approval` | A plan needs an operator decision. No implementation should proceed until approval is resolved. | `inspect` or back to `plan`. | 1 | 24 h |
| `inspect` | Read relevant sources and gather pre-mutation evidence. | `implement` or scoped `repair`. | 5 | 180 s |
| `implement` | Make requested, scoped changes. | `verify`; failed/stale mutations can return to `inspect` or `repair`. | 8 | 300 s |
| `verify` | Run applicable checks against the current implementation. | `review` on success; `repair` or `implement` on failure. | 4 | 180 s |
| `repair` | Recover from a failed action, failed check, or invalid selection. | Reinspect, implement the repair, then verify again. | 4 | 180 s |
| `review` | Confirm scope and evidence before finalization. | `complete` or `repair`. | 3 | 120 s |
| `complete` | Completion gates passed; terminal engine phase. | None. | 1 | 30 s |
| `blocked` | Approval, user direction, or a repeated failure prevents safe progress. | Resume into an allowed working state after the blocker is resolved. | 2 | 60 s |

The allowed transition graph is explicit in `CODING_STATE_TRANSITIONS` in `src/react/state-manager.ts`. In normal mutable work, the evidence path is roughly `understand` → `discover`/`plan` → `inspect` → `implement` → `verify` → `review` → `complete`. Recovery can revisit inspection, implementation, or verification. A read-only task can skip mutation and applicable verification gates.

Monitor `state_step_budget`, `state_steps_elapsed`, `state_time_budget_ms`, and `state_time_elapsed_ms` in run state. If a phase is at its budget, the next planner turn is prompted to make an evidence-producing transition rather than repeat the same action. Continuous runs also have global action and elapsed-time ceilings described under [Recovery and termination](#recovery-and-termination).

## Read the event stream

Events are ordered and persisted. The SSE stream is for live monitoring; the paginated events endpoint is the recovery path after a disconnect. Start with the `seq`/cursor, then correlate event-level `requestId`, `stepId`, and `toolCallId` when present.

| Event | What it tells the operator | What to inspect |
| --- | --- | --- |
| `run_started` | The engine accepted the task. | Task, workspace, selected run kind. |
| `model_target_resolved` | The target was resolved for this run or request. | `provider`, `resolvedModel`, optional profile/target, `contextWindow`, and `route` (`primary`, `recovery`, `fallback`). A fallback route is a different provider/model decision; check it explicitly. |
| `llm_request_started` / `llm_request_finished` | A provider request began or ended. | Request kind, route identity, timestamps, status, token usage, and failure summary. Never copy credentials from local config into a ticket. |
| `llm_request_heartbeat` | A long request is still being tracked. | `elapsedMs`, `deadlineAt`, and `stale`; a stale heartbeat warrants checking the provider and request deadline. |
| `provider_attempt_failed`, `cooldown_waiting`, `pacing_wait`, `retrying` | A route failed, is cooling down, is intentionally paced, or is retrying. | Provider/model, attempt, `waitingUntil`, and whether the error is rate limit, quota, timeout, or availability. |
| `plan_updated`, `workplan_updated`, `todo_snapshot`, `todo_links_updated` | The work plan or durable TODO projection changed. | Pending items and whether the plan still matches the requested scope. |
| `plan_approval_required` / `plan_approval_resolved` | The run is waiting for or received a plan decision. | Approval status and plan revision. Do not interpret a pending plan as execution progress. |
| `reasoning_start` / `reasoning_end`, `model_response` | A model phase started or ended; a response was returned. | Phase and safe summary metadata. Reasoning text is not mutation or verification evidence. |
| `decision_record` | A structured decision record was emitted. | Selected action, preconditions, expected evidence, and status. Use structured fields; do not infer rejected choices from prose. |
| `tool_started` / `tool_result` | A tool call began and produced a result. | Tool name, arguments, success/error payload, and matching IDs. A start without a durable result may be an uncertain outcome; inspect before retrying side effects. |
| `file_read`, `file_changed`, `command_started`, `command_output` | Workspace or command activity was observed. | Paths, whether a change succeeded, command exit/result, and current diff. |
| `verification_started` / `verification_result` | A named verification action began or returned. | Success, output, and whether it happened after the latest successful mutation. |
| `state_transition` | Shared run state changed. | `from`, `to`, reason, and evidence references. |
| `recovery_transition` | The engine recorded a recovery boundary. | Reason, from/to state, attempt count, message, and evidence counters. This is the most useful event when the run appears to loop. |
| `user_input_required` / `user_input_resolved` | The engine needs a human answer or approval decision. | Request ID, question, scope, and whether it was cancelled. |
| `subtask_dispatch_started`, `subtask_dispatch_result`, child lifecycle events | Optional bounded child work was launched or reported. | Contract scope, child status, compact evidence, and blockers. Children are visible under the parent run. |
| `final`, `stopped`, `error`, `execution_failed` | A terminal or user-visible outcome was emitted. | Compare the message with run status, verification evidence, and the last checkpoint; prose alone does not override gates. |

For context overflow, inspect the target's `contextWindow`, request kind, last successful action, recent observations, and any compaction/truncation output. For provider trouble, compare `model_target_resolved` with subsequent failed request events; do not assume a configured fallback was actually used until the route event confirms it.

## Recovery and termination

`recovery_transition` records a bounded checkpoint and preserves the tool history. Its `reason` is one of:

| Reason | Typical trigger | Usual destination |
| --- | --- | --- |
| `missing_mutation_evidence` | A completion suggestion has no successful requested mutation or required baseline evidence. | `inspect` or `implement`, depending on relevant inspection evidence. |
| `failed_mutation` | A Write/Edit failed or the latest mutation is not successful. | `inspect` before retrying the scoped mutation. |
| `failed_verification` | Required verification is absent, failed, or no longer follows the latest change. | `repair`. |
| `provider_failure` | A provider failed before the next action. | Remain in the current coding state and continue from checkpoint when recoverable. |
| `invalid_tool_selection` | The response cannot be parsed or does not identify a valid tool. | Retry/repair selection in the current phase. |
| `decision_evidence_mismatch` | Observed action evidence contradicts the selected action's expected result. | `inspect`. |

`repair` is a coding phase, not a second task or an instruction to rewrite the project. Inspect the failure, make the smallest scoped change, and rerun the relevant check. Some local retry paths also cap repeated attempts per reason; app verification repair is capped at two automatic repairs per run.

There is no separate `reflection` state or `reflection` event in the engine. After a recovery transition, the normal reason/plan cycle runs again with the failure summary and preserved evidence; operators may call that a reflection pass, but should diagnose it through `recovery_transition`, the next model request, and the selected action.

The default total recovery-transition budget is 8. `REACT_ENGINE_MAX_RECOVERY_TRANSITIONS` can configure 1–32. A continuous run additionally uses a default rolling window of 20 action steps, a global ceiling of 1,000 steps, and a default two-hour wall-clock budget (maximum configured value: 24 hours). Relevant settings are `REACT_ENGINE_GLOBAL_STEP_LIMIT` and `REACT_ENGINE_MAX_RUN_DURATION_MS`. When a limit is reached, the server saves a checkpoint so an operator can inspect and explicitly continue. A run is not automatically safe to resume just because it is recoverable.

Provider request limits are separate from action/recovery limits. `REACT_ENGINE_LLM_MAX_REQUESTS_PER_TASK` sets the default request allowance (10 in `.env.example`; runtime settings also expose it). Provider retries, pacing, cooldowns, and per-route request caps can end a run before its action budget is used.

## Context budgets

The planner assembles independent context categories and clips each section separately. The approximate character cap is four characters per configured token; provider tokenizers, system messages, tool schemas, and provider-side wrappers add their own overhead. These figures are category limits, **not** the model's native context size or a guarantee that a full prompt fits.

| Category | Contains | Default cloud cap | Local/Colab cap |
| --- | --- | ---: | ---: |
| `task` | Current resolved task and latest request text. | 1,200 | 1,000 |
| `plan` | Active plan, TODO progress, work-plan status. | 1,000 | 800 |
| `active_errors` | Recent failures, stale-edit/replay guidance, recovery and uncertain tool outcomes. | 1,500 | 1,000 |
| `permissions` | Approval policy, tool capability and workspace instructions. | 500 | 500 |
| `evidence` | Task analysis, acceptance criteria, verification plan, routing, completion evidence, recent user updates. | 1,500 | 1,000 |
| `memory` | Retained relevant reads and their coverage. | 2,000 | 1,500 |
| `history` | Bounded recent action/observation history. | 4,000 | 1,500 |

The configured caps sum to about 11,700 tokens for the standard cloud profile and 6,300 for local/Colab, before system/tool overhead. Content is trimmed within each category; memory/history have smaller caps for local routes so current task and execution evidence have room. A smaller context window may still require a smaller task or fresh bounded subtasks.

Tune in this order:

1. Reduce irrelevant file reads and huge command output; prefer focused tests and targeted evidence.
2. Reduce the input/context allowance for the route or use a model with a larger native context window.
3. Only then raise category or provider limits, and only up to the provider/model's actual supported context.

Provider-side limits are additional. Gemini currently has settings for total request characters, number and size of file messages, tool-output characters, and the context-summary trigger (`GEMINI_CONTEXT_MAX_CHARACTERS`, `GEMINI_CONTEXT_MAX_FILES_PER_REQUEST`, `GEMINI_CONTEXT_MAX_FILE_CHARACTERS`, `GEMINI_CONTEXT_MAX_TOOL_OUTPUT_CHARACTERS`, `GEMINI_CONTEXT_SUMMARY_TRIGGER_PERCENTAGE`). Defaults are 120,000 total characters, 12 files, 30,000 characters per file, 20,000 per tool output, and a 75% summary trigger. These do not replace the planner's token budgets.

For locally served models, each Local AI target has both a native `contextWindow` and an `inputTokenLimit`. Set both to values the server and loaded model can honor; the environment defaults are 32,768 and 2,750 tokens respectively. Increasing the native window alone does not automatically raise the input compaction limit.

## Completion and quality gates

### Agent lifecycle gates

| Gate | What must be true | If it fails |
| --- | --- | --- |
| Relevant inspection before mutation | For a mutable task with analysis, inspect a relevant source target first. A confirmed empty-workspace create is a special case. | Engine routes back to inspection; do not force a write against an unread existing file. |
| Mutation before verification | Record a successful source mutation, or the allowed baseline evidence for existing targets, before entering verification. | `verify` is rejected and recovery returns to inspection/implementation. |
| Verification after the latest mutation | Applicable verification must succeed after the most recent successful Write/Edit. | Rerun checks after the final edit; older passing evidence does not cover a newer change. |
| Review before completion | A mutable task with applicable verification must reach `review` after evidence passes. | Inspect `state_transition` and the last verification/mutation order. |
| Completion evidence and scope | Required files/actions must have successful evidence; latest mutation must not be failed; completion cannot exceed analyzed scope without new evidence. | The model's “done” response is rejected and the run enters recovery or returns incomplete. |
| Approval | A policy-blocked action or plan approval remains pending until explicitly resolved. | Resolve the matching approval/input request, then resume; changing prose does not grant permission. |

Read-only tasks and docs-only work can have different verification requirements; inspect the task contract instead of assuming every run needs a build. A failed check is evidence of failure, not a reason to silently omit the check.

### App verification gates

The app verifier also emits named quality gates. These apply when the app-generation verifier runs, not to every repository coding task.

| Gate ID | Check | Operator interpretation |
| --- | --- | --- |
| `request-satisfaction` | App spec has an app name, required features, and an entry point. | Missing app contract/entry point means task intent or generated deliverables were not resolved. |
| `responsive-layout` | Verification has a passing `responsive` signal. | Inspect viewport verification and responsive CSS/layout. |
| `interactive-controls` | Interactive app types (`game`, `tool`, `dashboard`, `editor`) have a passing `interactive` signal. Other app types pass this gate without the signal. | Test the visible controls and their behavior. |
| `console-clean` | Verification has a passing `no-console-errors` signal. | Inspect browser console output and the failed page-load step. |
| `persistence-working` | If persistence was requested, a passing `persistence` signal is present. | Check the requested persistence path and rerun its interaction test. If persistence was not requested, this gate passes. |
| `accessible-labels` | Non-critical placeholder gate; current implementation does not fail it. | Do not treat a pass as a real accessibility audit; manually verify labels/keyboard behavior when required. |
| `no-build-errors` | A passing `build-success` or `page-load` signal is present. | Run the applicable build or inspect static page-load evidence; vanilla apps may not have a build script. |

`verification_result` reports the verifier outcome; inspect its structured `qualityGates` and signals where available. The gate's `critical`/`required` flags matter: a critical app gate can block app verification even when a non-critical advisory gate passes.

## Common failure patterns

| Signature | Likely cause | Operator response |
| --- | --- | --- |
| Repeated successful `Read`/`Grep`/`Glob` on the same target; rising `noProgressCount`; `ReplayGuard` or “Repeated inspection blocked” | The model is gathering no new evidence instead of acting. | Check whether task scope is mutable and targets are identified. Use the recorded forced target; if the task is genuinely read-only, narrow or clarify the request rather than forcing mutation. |
| Model says complete, but no successful mutation or post-mutation verification exists; `recovery_transition` says `missing_mutation_evidence` or `failed_verification` | Final text got ahead of evidence, or a newer edit invalidated prior checks. | Inspect current diff; complete the missing scoped action and run the relevant check after the last edit. |
| `blockedReason` repeats, state returns `inspect` → `verify` or `review` → `repair`, with no new evidence | A gate is being re-entered without the missing evidence changing. | Identify the exact entry gate in state/contract, then gather the requested evidence. Avoid changing budgets to bypass an evidence gate. |
| `provider_attempt_failed`, repeated `cooldown_waiting`, request heartbeat becomes stale, no `model_target_resolved` fallback event | Provider quota, outage, deadline, or selected route failure. | Check provider status/credentials and pacing. Reduce concurrent runs, wait for the cooldown, or explicitly resume with a different model if policy allows. |
| Context-length/token error or provider-side truncation; requests near the model's context limit | Large history, source excerpts, tool output, or model context mismatch. | Reduce input scope/output first; check native window and route input limit; use a context-capable model or bounded subtasks. |
| Local run starts slowly or OOMs as context grows | Loaded local context/KV cache or model does not fit available hardware; input compaction may be set above the practical limit. | Reduce loaded context/input limit, use a smaller/quantized tool-capable model, or move the run to a cloud target. Change one limit at a time. |
| `plan_approval_required`, `user_input_required`, or policy decision with `requiresApproval` | Human decision is part of the run contract. | Resolve the exact pending request; then resume. Do not replay the tool call directly. |
| `RECOVERY_BUDGET_EXCEEDED`, `GLOBAL_STEP_LIMIT_EXCEEDED`, or wall-clock limit | The run reached a safety ceiling, not necessarily a task-specific failure. | Review the checkpoint and completed actions, then resume with a narrower remaining task or explicitly raised limit. |
| One required app gate repeatedly fails after a repair | Verification signal, app contract, and changed files may disagree. | Inspect the failing gate and its underlying signal; repair the smallest implicated scope, rerun verification, and confirm the final signal changed. |

## Model tuning quick reference

These are operator starting points, not performance guarantees. First confirm that the selected model and serving endpoint support structured tool calls; then observe request latency, input size, failure rate, and evidence quality before changing multiple settings.

### Local llama.cpp or another OpenAI-compatible local server

- Configure a Local AI target in the UI or set `LOCAL_MODEL_ENABLED=true`, `LOCAL_MODEL_BASE_URL`, `LOCAL_MODEL_MODEL`, `LOCAL_MODEL_CONTEXT_WINDOW`, and `LOCAL_MODEL_INPUT_TOKEN_LIMIT`. The checked-in environment example points at `http://127.0.0.1:11434/v1` for Ollama; use the actual `/v1` base URL exposed by your llama.cpp server.
- Set the context window no higher than the model's loaded `--ctx-size` (or equivalent). Start with the default 2,750-token input limit on constrained hardware; increase gradually only if prompt processing and KV-cache memory remain stable.
- The engine selects smaller local context-category budgets automatically. Keep tool-output and history limits conservative on CPU or low-VRAM machines. Prefer a smaller tool-capable instruct model over an oversized model that cannot keep the serving process stable.
- If the model returns malformed tool selections, first verify its chat template/tool-call support and exact served model ID. Increasing context or retries will not fix a tool protocol mismatch.

### Cloud Gemini

- Configure an explicit Gemini target and account profile in the API Pool. Runs pin a selected profile; quota failure does not mean the task silently moves to a different Gemini account.
- For free-tier operation, keep `REACT_ENGINE_FREE_EXECUTION_PACING=true` and `GEMINI_MAX_CONCURRENT_REQUESTS_PER_PROFILE=1`. Default provider spacing is about six seconds; tune `REACT_ENGINE_GEMINI_MIN_REQUEST_INTERVAL_MS` only to a limit the account can sustain.
- Keep the context summary trigger near the default 75% initially. If requests fail at provider limits, reduce retained files/tool output or lower the trigger. Adjust `GEMINI_CONTEXT_MAX_*` values only after checking the model/profile's actual supported request envelope.
- `REACT_ENGINE_GEMINI_MAX_RETRIES` and request timeout settings affect recovery time, not quota. More retries can make a rate-limited run take longer without making the quota available.

### OpenRouter

- Configure one inference key in `OPENROUTER_API_KEY`, then choose exact model targets in Settings → API Pool → OpenRouter. The service intentionally does not pool multiple OpenRouter keys to extend account limits.
- Verify the target supports tool calling, and inspect `model_target_resolved` to confirm which model and route the run actually used. The selected model remains authoritative; moving to a different model is an explicit resume decision.
- Fast pacing still has a default three-second request interval for the shared OpenRouter account. `OPENROUTER_MIN_REQUEST_INTERVAL_MS` can override it; use zero only when the account/model limits are known to support that rate. Free execution pacing may be slower.
- If a free model returns 429s or becomes unavailable, lower concurrency, wait for cooldown, or select a currently available target. Retrying faster or rotating another key is not a supported quota workaround.

### Hardware/provider-independent controls

| Setting | Operational effect |
| --- | --- |
| `MAX_STEPS` / per-run `maxSteps` | Bounds action turns for a normal run; smaller values are useful for diagnosis, but can stop work before verification. |
| `REACT_ENGINE_LLM_MAX_REQUESTS_PER_TASK` | Caps provider requests independently of action steps. Increase only when the task needs more model turns and cost/rate limits are understood. |
| `REACT_ENGINE_GLOBAL_STEP_LIMIT` | Continuous-run total action ceiling; default 1,000. |
| `REACT_ENGINE_MAX_RUN_DURATION_MS` | Continuous-run wall-clock ceiling; default 7,200,000 ms (two hours). |
| `REACT_ENGINE_MAX_RECOVERY_TRANSITIONS` | Total recovery boundary allowance; default 8, clamp 1–32. |
| `REACT_ENGINE_FREE_EXECUTION_PACING` and pacing profile | Provider request spacing and presentation pacing. `fast` removes intentional engine delay but provider/account safeguards can still apply. |

## Configuration and source map

| Operator question | Source |
| --- | --- |
| How is a run created, routed, resumed, or stopped? | [`src/routes/runs.ts`](../../src/routes/runs.ts), [`src/react/run-manager.ts`](../../src/react/run-manager.ts) |
| How do coding states, gates, and snapshots work? | [`src/react/state-manager.ts`](../../src/react/state-manager.ts), [`src/react/engine.ts`](../../src/react/engine.ts) |
| How are context sections bounded? | [`src/react/token-accounting.ts`](../../src/react/token-accounting.ts), [`src/react/planner.ts`](../../src/react/planner.ts) |
| How are model/provider requests sent and paced? | [`src/di/providers/llmProvider.ts`](../../src/di/providers/llmProvider.ts), [`src/config/executionProfiles.ts`](../../src/config/executionProfiles.ts) |
| Where are local targets and runtime settings? | [`src/config/localAITargets.ts`](../../src/config/localAITargets.ts), [`src/config/runtimeSettings.ts`](../../src/config/runtimeSettings.ts), [`.env.example`](../../.env.example) |
| What are the app-specific quality gates? | [`src/react/quality-gates.ts`](../../src/react/quality-gates.ts), [`src/react/app-verifier.ts`](../../src/react/app-verifier.ts) |

Related operator references: [system harness overview](./SYSTEM_HARNESS.md), [Gemini profile and pacing guide](../features/MULTI_KEY_POOL_GUIDE.md), [tool timeout protection](../features/TOOL_TIMEOUT_PROTECTION.md), and [filesystem security](../security/FILESYSTEM_SECURITY.md).
