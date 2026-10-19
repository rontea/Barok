# OpenRouter Free-Tier Resilience & Dual Chat/Console Interface

This document describes the OpenRouter free-tier resilience mechanisms, telemetry metrics, session trace ledger annotations for stale edit recovery, and the Dual Chat/Console Run UI interface in the ReAct Engine.

---

## 1. OpenRouter Free-Tier Resilience & Fallbacks

When using free endpoints on OpenRouter (e.g. `minimax/minimax-m3:free`, `meta-llama/llama-3.3-70b-instruct:free`), transient 429 rate limits or server unavailability can stall execution. The engine provides zero-cost resilience without risking unexpected paid API charges.

### Dynamic Fallback Candidates

- **Free-Only Candidate Bound**: Every model candidate in the fallback list must satisfy `isOpenRouterFreeModel`. Resilience can never turn a free selection into an unexpected paid request.
- **Dynamic Free Router Bypass (`openrouter/free`)**: When the primary model is `openrouter/free`, OpenRouter performs dynamic server-side routing. The engine bypasses candidate array construction to prevent circular or redundant fallback loops.
- **Provider Parameter Enforcement**: When fallback lists are provided alongside tools or vision requirements, requests include:
  ```json
  "provider": {
    "allow_fallbacks": true,
    "require_parameters": true
  }
  ```
  This ensures OpenRouter only routes to candidate endpoints that support the necessary parameters (e.g., function calling schemas).

### Telemetry & Resolution Metrics

Every OpenRouter completion logs structured telemetry via `emitTelemetry`:
- `resolvedModel`: The actual model ID returned by OpenRouter (e.g., `google/gemma-4-31b-it:free`).
- `fallbackUsed`: Boolean (`true` when `resolvedModel` differs from requested `model`).
- `requestedModels`: Array of candidate models sent in the request `models` array.
- `status`: `'succeeded'`, `'failed'`, `'timed_out'`, or `'cancelled'`.

---

## 2. Session Trace Ledger & Stale Edit Annotations

The `ToolEvidenceLedger` records structured diagnostic records for engine execution events, policy decisions, and stale edit interventions.

### Stale Edit Recovery Annotations

When an `Edit` action fails due to an absent `old_string` (preimage mismatch) and is followed by a `Read`:
1. **Recovery Guidance Injection**: `staleEditRecoveryGuidance` injects contextual recovery guidance for the target file.
2. **Replay Rejection**: If the LLM attempts to replay the exact rejected `old_string`/`new_string` pair, hard validation blocks dispatch before execution.
3. **Ledger Annotation**: The intervention is logged to `ToolEvidenceLedger` with:
   - `status`: `'denied_retry'` (for blocked replays) or `'invalid'` (for guidance interventions).
   - `staleEditIntervention`: `{ targetFile, type: 'rejected_replay' | 'recovery_guidance', details }`.
   - Structured summary: `[Stale Edit Replay Blocked] src/app.ts: ...`.

---

## 3. Dual Chat & Console Run UI Interface

The `CoderChatPanel` UI component supports dual conversational and live execution monitoring views.

### View Switcher Modes

- **Chat View**: Conversational assistant view with markdown formatting, code diffs, image attachments, and approval prompts.
- **Console Run View**: Real-time terminal log stream showing raw engine events, tool invocations, step timings, and token metrics.
- **Split View**: Side-by-side or stacked view presenting Chat and Console Run panes simultaneously.
- **Persistence**: The user's active view mode preference (`chat`, `console`, or `split`) is saved to `localStorage`.

### Real-Time Streaming & Console Features

- **Auto-Scroll Control**: Auto-scroll to latest log output with user pause/resume toggle when inspecting past output.
- **Log Search & Filters**: Filter logs by category: *All*, *Tool Execution*, *Info*, *Warnings*, *Network/Auth Errors*.
- **Console Actions**: Copy full console log output or clear active log buffer.

### Actionable Diagnostic Alerts & Auth Recovery

When API failures occur (e.g., Pollen API 401 Unauthorized, OpenRouter 429 Rate Limit, Gemini Quota Exceeded):
- Generic error popups are replaced with detailed diagnostic alert cards.
- **Inline Fix in Settings**: Direct link button to open Settings drawer and update API keys or change models.
- **Inline Retry**: Instant retry button to resume execution directly from the alert card without losing run state.

