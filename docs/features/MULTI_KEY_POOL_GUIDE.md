# Isolated Gemini Account Profiles

Gemini credentials are configured as independent account profiles. They are
not combined into shared capacity and the application never changes Gemini
profiles because of rate limits or quota exhaustion.

## Configuration

Configure up to three server-side profiles:

```env
GEMINI_ACCOUNT_A_API_KEY=
GEMINI_ACCOUNT_A_LABEL=Gemini Account A
GEMINI_ACCOUNT_A_PURPOSE=development

GEMINI_ACCOUNT_B_API_KEY=
GEMINI_ACCOUNT_B_LABEL=Gemini Account B
GEMINI_ACCOUNT_B_PURPOSE=testing

GEMINI_ACCOUNT_C_API_KEY=
GEMINI_ACCOUNT_C_LABEL=Gemini Account C
GEMINI_ACCOUNT_C_PURPOSE=separate-workspace

GEMINI_DEFAULT_PROFILE=account-a
GEMINI_MAX_CONCURRENT_REQUESTS_PER_PROFILE=1
REACT_ENGINE_GEMINI_MAX_RETRIES=3
REACT_ENGINE_LLM_MAX_REQUESTS_PER_TASK=10
REACT_ENGINE_LLM_TIMEOUT_MS=120000
```

Profiles may instead be declared in `react-engine.providers.yaml` while the
credentials remain in environment variables:

```yaml
providers:
  gemini:
    profiles:
      account_a:
        api_key_env: GEMINI_ACCOUNT_A_API_KEY
        enabled: true
        purpose: development
      account_b:
        api_key_env: GEMINI_ACCOUNT_B_API_KEY
        enabled: true
        purpose: testing
      account_c:
        api_key_env: GEMINI_ACCOUNT_C_API_KEY
        enabled: true
        purpose: separate-workspace
```

Set `REACT_ENGINE_PROVIDER_CONFIG` to use a different YAML path. The file stores
only environment-variable names and profile metadata, never raw credentials.

When none of the three account variables is configured, `GEMINI_API_KEY`
becomes the `default` profile and additional comma-separated
`GEMINI_API_KEYS` entries become independently selectable legacy profiles.
They remain isolated accounts and are never used for automatic cross-account
rotation.

Credentials are loaded only by the server. APIs and browser code receive the
profile ID, label, purpose, health state, and a short masked suffix.

## Selection and pinning

Profile selection follows this order:

1. Workspace assignment
2. Authenticated user assignment
3. New-task selection
4. Application default

The selected profile ID is stored in run metadata and ReAct task state. A
resumed task retains its original profile. The UI disables profile changes
while a task is active.

Workspace assignments can be managed with:

```http
GET /api/gemini/profiles?workspace=%2Fpath%2Fto%2Fworkspace

PUT /api/gemini/profiles/assignment
Content-Type: application/json

{
  "workspace": "/path/to/workspace",
  "profileId": "account-a"
}
```

Raw API keys are never stored in SQLite.

## Reliability behavior

Each profile owns an asynchronous priority queue. Concurrency defaults to one,
so concurrent requests wait on the same profile instead of moving to another
account.

- HTTP 408, 500, 502, 503, 504, and temporary network failures retry on the
  same profile with approximately 2, 4, and 8 second full-jitter backoff,
  capped at 30 seconds.
- HTTP 429 and `RESOURCE_EXHAUSTED` do not trigger an account switch or an
  immediate retry. The selected profile receives a persisted cooldown and its
  queued work waits for that cooldown.
- Authentication failures disable only the affected profile.
- Repeated transient failures open a profile-local circuit temporarily.

Cooldown, circuit, request, and error state is stored under
`gemini.profileHealth` in application settings.

## Deduplication, caching, and context controls

Identical in-flight Gemini requests reuse one promise. The SHA-256 request
fingerprint includes workspace, commit, user, profile, model, normalized
messages, generation settings, tool schema, and tools.

Reusable request kinds such as repository summaries, classifications,
architecture analysis, compression, and review can use a short-lived response
cache. Cache keys isolate workspace, user, repository commit, and profile.
Only cache references and expiration metadata are persisted under
`gemini.responseCacheReferences`; cached response bodies remain process-local.

Before dispatch, the Gemini adapter:

- removes consecutive duplicate messages;
- redacts common API keys, authorization values, and private key blocks;
- truncates oversized tool output;
- drops older messages when the configured character budget is exceeded;
- estimates input and output usage for task telemetry.

Relevant configuration:

```env
GEMINI_CONTEXT_MAX_CHARACTERS=120000
GEMINI_CONTEXT_MAX_FILES_PER_REQUEST=12
GEMINI_CONTEXT_MAX_FILE_CHARACTERS=30000
GEMINI_CONTEXT_MAX_TOOL_OUTPUT_CHARACTERS=20000
GEMINI_CONTEXT_SUMMARY_TRIGGER_PERCENTAGE=75
GEMINI_RESPONSE_CACHE_TTL_MS=300000
```

Model-specific character budgets can be configured with a normalized model
suffix, for example
`GEMINI_MODEL_CONTEXT_MAX_CHARACTERS_GEMINI_3_5_FLASH=120000`.

## Fallback policy

Cross-provider fallback is disabled for normal application runs. A task must
set `allowCrossProviderFallback: true`; it may additionally restrict
`approvedFallbackProviders`.

This permission is independent of Gemini profile selection. A quota error never
selects account B or C for a task pinned to account A.

When approved and configured, fallback order is the selected Gemini profile,
then the OpenAI-compatible local endpoint, then NVIDIA. Configure the optional
local route with:

```env
LOCAL_MODEL_ENABLED=true
LOCAL_MODEL_BASE_URL=http://127.0.0.1:11434/v1
LOCAL_MODEL_MODEL=qwen2.5-coder
```

## Tests

```bash
npm run test:unit -- --runTestsByPath src/di/__tests__/geminiProfiles.test.ts
```

The suite verifies profile pinning after 429, per-profile cooldown isolation,
request deduplication, cache isolation, context credential redaction, explicit
fallback permission, per-profile concurrency, and same-profile transient
retries.
