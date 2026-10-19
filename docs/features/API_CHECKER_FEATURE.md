# API Settings and Gemini Profile Health

The API Settings screen reports provider availability and manages saved model
targets. Gemini is represented as isolated account profiles, never as a shared
key pool.

## Gemini profiles

The server loads up to three profiles from
`GEMINI_ACCOUNT_A_API_KEY`, `GEMINI_ACCOUNT_B_API_KEY`, and
`GEMINI_ACCOUNT_C_API_KEY`. `GEMINI_API_KEY` is supported only as one legacy
`default` profile when no named account profile is configured.

The browser receives only safe metadata:

- profile ID, label, and purpose;
- masked key suffix;
- available, cooldown, or disabled state;
- active and queued request counts;
- request/error totals and last successful use.

Raw keys remain server-side and are not written to SQLite.

## Endpoints

### `GET /api/gemini/profiles`

Returns configured profile summaries, profile-local health, saved assignments,
the selected profile for an optional `workspace` and `userId`, and the
per-task request limit.

### `PUT /api/gemini/profiles/assignment`

Saves a workspace, user, or application-default assignment. The body contains
`profileId` plus an optional `workspace` or `userId`.

### `GET /api/gemini/validate?profileId=account-a`

Tests only the named profile. Validation never tries another Gemini account.

### `GET /api/gemini/pool-status`

Retained as a compatibility alias for older UI clients. Its response describes
isolated profiles and does not expose a rotation strategy.

## Runtime behavior

A new task selects a profile using workspace, user, task, then application
default priority. The profile ID is persisted in task metadata and cannot be
changed while the task is active.

HTTP 429 and `RESOURCE_EXHAUSTED` place only that profile into cooldown.
Transient HTTP 408/5xx and network failures retry with jitter on the same
profile. Authentication errors disable only the affected profile.

Use the **Test** control beside a profile to validate it. A failed validation
does not silently test or activate another account.

## Other providers

The same screen continues to manage Pollinations status and saved NVIDIA,
OpenRouter, Groq, Kimi, and Requesty model routes. Those providers keep their
own route-specific behavior and do not alter Gemini profile assignment.

## OpenRouter single-account route

`GET /api/openrouter/pool-status` checks the one configured
`OPENROUTER_API_KEY` against OpenRouter's current-key endpoint and returns only
safe advisory metadata such as free-tier state and key usage/limit fields. The
`/api/openrouter/status` path remains as a compatibility alias and returns a
`Link` header identifying `/api/openrouter/pool-status` as canonical.

`OPENROUTER_API_KEYS` is unsupported and ignored with a startup warning. The
integration does not rotate or pool multiple OpenRouter keys to extend the
account-level free-model allowance.

## Groq provider

`GET /api/groq/status` reports safe configuration and health metadata for the
single configured Groq organization without making a network request.
`POST /api/groq/health` performs an explicit low-token health check, and
`POST /api/groq/test` performs one
low-token completion test using `GROQ_API_KEY`. The browser never receives the
key or a masked key suffix.

`GET /api/groq/settings` returns non-secret role, queue, retry, cache, streaming,
and fallback settings. `PUT /api/groq/settings` validates and persists those
settings. The explicit enabled switch defaults off. Health status includes safe
queue depth, active count, cooldown end, aggregate usage, and normalized error
state.

Settings mutations require a same-origin browser request, a loopback CLI
request, or the optional server-side `PROVIDER_SETTINGS_TOKEN` supplied through
`x-provider-settings-token`. Cross-origin browser mutations are rejected.

`GET /api/groq/model-targets` returns at most one configured model route using
the stable `groq:<model>` value. Older saved `groq-target:key-N` values migrate
to that route and discard the former credential index.

`GROQ_API_KEYS` is unsupported and ignored with a startup warning. The
integration does not rotate or orchestrate multiple Groq accounts to bypass
rate limits or quotas.

Role IDs are entered explicitly for default, fast/classifier/summarizer,
planner, coder, reviewer, and repair work. Missing roles fall back only to the
configured default. Capabilities and context/output limits are explicit
per-model settings; they are never inferred from a model name.

Every request enters the single-organization scheduler. HTTP 408, retryable
network errors, and HTTP 500/502/503/504 use bounded exponential backoff. HTTP
429 creates cooldown, queues deadline-compatible later work, and permits one
recovery probe after cooldown. The UI message states that no other Groq account
was used.

Outbound messages are deduplicated, bounded, and scanned for credentials,
tokens, private keys, database URLs, cookies, and webhook secrets. Workspace
policy can redact, block, or require approval. `.env`, credential, dependency,
generated-output, binary, and lockfile context is excluded by default.

Core tests use a local OpenAI-compatible mock server. To run an optional live
smoke check, set `RUN_GROQ_SMOKE=1` alongside a complete enabled Groq
configuration, then run the Groq provider test file. The normal suite skips the
live check.
