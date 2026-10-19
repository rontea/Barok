# Child runs and workflows

Child runs are ordinary durable harness runs with a `childRun` metadata projection. The projection contains the child ID, parent run/session, lineage, provider kind, role, capability snapshot, budget, status, terminal reason, and structured report. Child events are written to both the child stream and the parent stream so a parent can audit lifecycle changes without scraping logs.

The server exposes:

- `POST /api/runs/:runId/children` to launch a bounded child.
- `GET /api/runs/:runId/children` and `GET /api/runs/:runId/children/:childId/report` to inspect children and reports.
- `POST /api/runs/:runId/children/:childId/follow-up` to enqueue a parent follow-up at the child’s next-turn boundary.
- `POST /api/runs/:runId/children/:childId/interrupt` to stop one child without erasing sibling evidence.

`ChildRunProvider` is the provider seam for fresh, forked, in-process, external, and ACP adapters. The current HTTP adapter uses the existing ReAct server run for fresh/forked/in-process execution; external and ACP launches return `501` until an adapter is registered. `BoundedWorkflowRunner` accepts validated dependency plans, limits concurrency, and preserves independent sibling results. Workflow callbacks are in-process; worker threads may be added for host-loop isolation later, but they are not a security boundary.

Reports contain result data, changed-file paths, checks, blockers, and evidence references. They deliberately do not use model confidence as completion proof.
