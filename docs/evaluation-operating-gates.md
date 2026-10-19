# Evaluation and operating gates

The harness has a deterministic gate suite in
`src/evals/__tests__/operatingGates.test.ts`. It is deliberately separate from
provider-dependent evaluations so replay, interaction, tool, and child/workflow
contracts can run without network credentials.

Run the focused gate suite with:

```text
npm run test:operating-gates
```

The fixture matrix covers:

- replay: normal completion, cancelled tool, killed process, provider outage,
  malformed response, missing result, stale workspace, and duplicate event;
- interaction: next-turn and next-step inboxes, injected context, replacement,
  cancellation, reconnect, and continuation requeue;
- tools: policy denial, timeout, retry, normalization, cancellation, parallel
  reads, and exclusive mutation scheduling;
- child/workflow: bounded depth and budgets, cancellation, reports, sibling
  failure, and blocked dependents.

The gate suite also contains a bounded replay/scheduler/SSE stress fixture with
a checked-in projection snapshot. Context-assembly bounds remain covered by the
continuation and planner test suites; no broad stress suite is added outside
those bottleneck paths.

Evaluation records now expose first-useful-action latency, duplicate action
count, unknown outcomes, recovery count, child completion rate, token cost,
first mutation latency, verification coverage, and total duration. These are
observability signals; they do not turn a checklist or final prose into proof
of completion.

The broader local validation command is:

```text
npm run verify:harness
```

It runs typecheck, unit tests, operating gates, build, offline smoke, and the
scripted evaluation catalog.
