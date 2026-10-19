# Reference UI migration contracts

The active application is the Vite app under `ui/`. The reference snapshot is a design source only; it does not replace the destination run manager, capability scope, provider policy, or persistence layer.

## Workspace boundaries

- Coder Chat, Console, Split, Test Suite, Run Audits, Studio, API Pool, Agents, and Structure are projections of destination state.
- Tests execute through the run manager and retain run IDs, event evidence, diagnostics, changed files, and audit links. Run Audits displays persisted evidence; it does not generate sample history.
- Structure reads and writes only through `/api/workspace/tree` and `/api/workspace/file`. Writes require the hash from a prior read and return a conflict revision when the file changed.
- Restore points use `/api/workspace/restore-points`. They are filesystem-native, bounded, skip generated/dependency/cache directories and symlinks, reject traversal, support cancellation, and create an automatic pre-restore rollback snapshot.
- Project upload/import is not enabled. Existing ZIP export remains an explicit, path-validated workspace export; no legacy project registry or simulated upload route is introduced.

## Settings and model policy

Interface & Display preferences are presentation-only. The model-native context window and observed compaction metrics are authoritative; the UI does not expose a cosmetic context slider. Attachments, context chips, thread history, continuation checkpoints, and run metadata remain separate from display preferences.

Execution settings are server-authoritative and are captured in run metadata without credentials. Delegation settings include a server-enforced role allowlist and bounded role rules. A role rule is appended below the agent safety/system prompt and cannot override capability, approval, workspace, or provider policy. Delegated workers use their saved provider/profile target and do not silently cross providers or switch model targets.

Provider availability recovery is enabled by default when a run has a valid checkpoint. NVIDIA and Gemini same-provider recovery is bounded by the model catalog and context metadata; cross-provider fallback remains explicitly disabled unless an authorized run policy enables it.

## Validation baseline

Before enabling broader shell changes, run:

```text
npm run typecheck
npm test
npm run build
npm run smoke
```

The browser smoke suite covers all seven top-level tabs at desktop and narrow widths, Studio generation/verification/repair, Structure file handoff/read/write/conflict/refresh/restore controls, and Chat/Console event selection. Security-focused tests cover workspace traversal, restore-point manifest tampering, limits, cancellation, symlink refusal, delegation role denial, and bounded role rules.

The reference `.env.local`, demo archives, patch scripts, generated fix scripts, and credentials are intentionally not copied.
