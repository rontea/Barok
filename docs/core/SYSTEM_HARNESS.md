# System Overview: What This Project Is

## Short answer

Yes. This project is an **LLM agent harness**.

An agent harness is the runtime around a language model that gives it a controlled way to:

- receive a task;
- inspect context and workspace files;
- choose tools and execute actions;
- observe tool results;
- continue through a bounded ReAct loop;
- switch providers when a route fails;
- record the complete run for inspection and continuation.

The model is one component. The harness supplies the execution loop, tools, safety checks, provider routing, budgets, persistence, UI, and diagnostics.

## What the system does

```text
User request
    │
    ▼
Run manager / Express API
    │
    ▼
ReAct engine
    │  ├─ builds context and selects the next action
    │  ├─ asks the configured LLM provider for a tool call or response
    │  └─ validates the result and repeats within step/time/budget limits
    │
    ├──────────────► Tool router
    │                  ├─ workspace/file tools
    │                  ├─ shell and search tools
    │                  └─ path and mutation safety checks
    │
    ├──────────────► Provider composite
    │                  ├─ Isolated Gemini account profiles and model targets
    │                  ├─ NVIDIA key/model rotation
    │                  ├─ OpenRouter
    │                  ├─ Groq
    │                  ├─ Kimi/Moonshot
    │                  ├─ Requesty
    │                  └─ Pollinations fallback
    │
    └──────────────► SQLite run/audit store and live event stream
                           │
                           └─ Web UI, run history, alerts, continuation
```

## ReAct execution model

Each run follows the same bounded cycle:

1. The engine prepares the task, workspace context, previous observations, and available tools.
2. The selected model returns a structured action or a final response.
3. The action is validated against the tool contract and workspace policy.
4. The tool runs and produces an observation.
5. The observation is added to the run timeline.
6. The engine either finishes, verifies the result, or asks the model for the next action.

The run stops when the model finishes, the task fails, the user stops it, the deadline expires, or the configured step/budget limit is reached. A failed provider does not automatically mean every completed tool item failed; each timeline item has its own outcome.

## Main subsystems

| Subsystem | Responsibility | Main locations |
| --- | --- | --- |
| ReAct engine | Coordinates reasoning, actions, observations, verification, and final responses | `src/react/engine.ts`, `src/react/planner.ts` |
| Provider transport | Converts a model request into provider-specific HTTP calls and parses responses | `src/di/providers/llmProvider.ts` |
| Composite routing | Orders providers, allocates request time, skips paused routes, and records fallback failures | `src/di/providers/llmProvider.ts` |
| Rate-limit monitor | Tracks route/key health, cooldowns, timeouts, exhausted quotas, and billing pauses | `src/di/providers/rateLimitMonitor.ts` |
| Tool layer | Exposes file, search, shell, patch, and developer actions | `src/tools/`, `src/di/providers/toolRegistry.ts` |
| Safety layer | Restricts workspace paths and validates mutations/tool responses | `packages/adapter-node/src/workspace/path-validator.ts` (compatibility facade: `src/tools/pathValidator.ts`), `src/tools/permissionPolicy.ts` |
| Run manager | Starts, streams, stops, resumes, and persists server runs | `src/react/run-manager.ts`, `server.ts` |
| Persistence | Stores threads, memories, run events, audits, settings, and provider targets | `src/persistence/sqliteStore.ts` |
| Web UI | Provides Coder Chat, API Pool, run audits, timeline events, alerts, and continuation | `ui/src/`, `server.ts` |
| MCP server | Exposes the tool set to MCP clients such as Cursor or Claude Desktop | `src/mcp/server.ts` |
| CLI | Runs ReAct, crew, MCP, setup, diagnostics, and test commands | `src/cli/` |

## Provider routing and fallback

Providers are independent routes, not one shared API. A route is identified by provider, model, and—when applicable—credential index.

The composite provider:

- prioritizes the provider named by an explicit model target;
- allocates a bounded slice of the end-to-end request deadline;
- skips routes whose cooldown or permanent pause is still active;
- records the exact provider and model plus safe route identity in failure details;
- moves to another configured provider when the current route fails.

The API Pool screen can discover models, save selected routes in SQLite, test live completions, and show the route’s exact model name.

Current integrations include native Gemini and NVIDIA transports plus OpenAI-compatible routes for OpenRouter, Groq, Kimi, and Requesty. Pollinations remains available as a standalone/default provider and fallback integration.

Groq uses one server-side account/organization credential. HTTP 429, quota,
authentication, timeout, and other failures never hand work to another Groq
credential. Cross-provider fallback requires an explicitly allowed and
approved non-Groq or local destination.

## Rate-limit behavior

The monitor separates different failure meanings:

- `rate_limited`: temporary 429/cooldown;
- `cooldown`: repeated timeout circuit breaker;
- `near_limit`: provider headers indicate little capacity remains;
- `quota_exhausted`: daily/free allowance is exhausted;
- `billing_required`: the provider account is suspended or needs balance/payment action.

Fallback routing skips paused routes. The UI shows the route status, remaining cooldown, last error, and a manual **Retry route** action. A successful route test clears the local failure state.

Important limitation: the harness can detect provider responses and pause routes, but it cannot recharge an account, change provider billing, or guarantee that two API keys belong to separate provider organizations.

## Persistence and observability

The default SQLite database is `storage/react-engine.sqlite`. It stores:

- server agent runs and their event sequence;
- final status: completed, failed, stopped, interrupted, or running;
- per-item timeline events and model responses;
- execution audits and raw run logs;
- protocol audits for malformed provider responses;
- API Pool model selections and application settings.

The web UI consumes the streaming run API and audit APIs. It displays successful items independently from terminal failures, supports browser/in-app alerts, and can continue an interrupted or saved run when continuation evidence is available.

## Security boundaries

This is a local developer automation harness, not a sandboxed cloud execution service. Its important boundaries are:

- `.env` and real credentials are ignored by git;
- provider errors are redacted before being shown or persisted where possible;
- workspace paths are validated before file operations;
- tool actions are schema-checked;
- mutation and shell operations pass through execution policy checks;
- provider/API keys are not intended to be returned to the model or UI.

Run it only with a workspace and credentials you trust. Review shell/write actions for high-impact tasks, and rotate any key that is pasted into chat, logs, screenshots, or commits.

## What it is not

The harness is not:

- an LLM model itself;
- a replacement for provider accounts or billing;
- a guarantee that a task is correct merely because a model returned text;
- a general-purpose remote code execution sandbox;
- a fully autonomous production deployment system.

It provides orchestration and evidence. Verification, human review, provider access, and the correctness of the requested change still matter.

## How to use the terminology

The most precise description is:

> **A local TypeScript LLM agent harness with a bounded ReAct execution engine, safe developer tools, multi-provider fallback routing, MCP support, and a React observability UI.**

“Agent framework” is also understandable, but “harness” emphasizes that this repository wraps and controls external LLMs rather than being a model-training or model-serving platform.

## Relevant entry points

- Web application: `npm run dev`, then `http://localhost:3000`
- Production build: `npm run build && npm start`
- CLI ReAct run: `npm run react -- "your task"`
- MCP server: `npm run build && npm run mcp`
- Unit tests: `npm run test:unit`
- Main server API: `server.ts`
- Environment template: `.env.example`
