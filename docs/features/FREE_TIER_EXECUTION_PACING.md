# Execution pacing profiles

The Coder execution selector exposes four profiles. Their values are defined
in [`src/config/executionProfiles.ts`](../../src/config/executionProfiles.ts),
which is the single adjustment point shared by the runtime and UI.

| Profile | Engine gap | Provider floor | Presentation | Intended use |
| --- | ---: | ---: | --- | --- |
| Paid | 0s | route-specific | none | Lowest latency on paid/protected routes |
| Adaptive | 1.5s | 6s for free-aware routes | light | General-purpose default with provider backoff |
| Free | 6s | 6s | readable | Normal free-tier usage |
| Free Conservative | 10s | 10s | slowest/readable | Strongest free-tier protection |

The profile names above are user-facing labels. Existing persisted/API values
(`fast`, `automatic`, `conservative`, and `phased`) remain stable so saved runs
and direct integrations continue to work.

Native Gemini and hosted NVIDIA NIM calls are treated as free/development
routes unless an operator explicitly overrides the pacing settings.

## Provider limits

- Gemini free-tier limits are project-scoped and measured across requests per
  minute, input tokens per minute, and requests per day. Google says the active
  values vary by model/account, are visible in AI Studio, are not guaranteed,
  and daily quotas reset at midnight Pacific time. See the [Gemini rate-limit
  documentation](https://ai.google.dev/gemini-api/docs/rate-limits).
- NVIDIA provides free NIM API-catalog access for prototyping and development,
  but its public documentation does not define one universal RPM/TPM quota for
  every hosted model. The implementation therefore uses conservative pacing,
  response headers, and 429/reset handling instead of assuming a fixed quota.
  See the [NVIDIA NIM FAQ](https://docs.api.nvidia.com/nim/docs/product).

## Runtime behavior

- Paced runs use a six-second minimum between Gemini requests for the same
  account profile, shared across simultaneous runs.
- Paced NVIDIA runs use a six-second minimum between requests for the same API
  key, with one active request per key and a one-request-per-model concurrency
  cap by default.
- Provider `Retry-After`, reset headers, 429 responses, and quota-exhausted
  errors pause the affected route. A daily provider quota cannot be prevented
  from ending once the provider has consumed it; the route is stopped and
  exposed through the provider rate-limit status endpoint instead of being
  repeatedly hammered.
- Non-paid NVIDIA runs use a bounded free-endpoint handoff: if the selected
  NVIDIA model stalls or is unavailable, the request moves once to the
  responsive `minimaxai/minimax-m3` route rather than holding the full task
  deadline. The selected model remains the first attempt.

## Configuration

```dotenv
REACT_ENGINE_FREE_EXECUTION_PACING=true
REACT_ENGINE_GEMINI_MIN_REQUEST_INTERVAL_MS=
REACT_ENGINE_NVIDIA_MIN_REQUEST_INTERVAL_MS=
REACT_ENGINE_NVIDIA_FREE_ATTEMPT_TIMEOUT_MS=20000
```

Leave the provider intervals blank to use the profile's provider floor. Set a
provider interval to `0` to disable that provider's interval, or set
`REACT_ENGINE_FREE_EXECUTION_PACING=false` when the route is paid or protected
by an external rate limiter. The `Paid` profile is the latency-sensitive,
operator-controlled option; provider-specific safeguards can still apply.
