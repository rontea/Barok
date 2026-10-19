# @barok/core

Host-neutral Barok behavior and public contracts. The current API includes file
path candidate normalization, task specification/coding task contract helpers,
the hash-only request-envelope contract/builder, pure todo projection helpers,
credential redaction, and the sanitized task-analysis view contract.

```js
import {
  classifyTask,
  createTaskSpec,
  normalizeFilePathCandidates,
} from '@barok/core';

const paths = normalizeFilePathCandidates(['src/index.tsstyles.css']);
const classification = classifyTask('Add a browser simulation');
const task = createTaskSpec('Add a browser simulation', 'Build a browser simulation', paths);
```

The package is an internal workspace package at version `0.0.0` while its public
surface and eventual npm identity are reviewed. It must not import Node APIs,
Harness/Cordis, MCP, app modules, or persistence drivers.

Core is authored in TypeScript and emits ESM JavaScript plus declarations into
`dist/`. Run `npm run build --workspace=@barok/core` to build it; the root
`npm run build`, `npm run dev`, and `npm run typecheck` commands build Core
first. The package allowlist includes only this README and generated `dist/`
output.

## Public contract and capability boundary

The public contract includes:

- `splitConcatenatedFilePath(value)` trims a candidate, normalizes path
  separators to `/`, removes surrounding punctuation, and splits adjacent file
  names at recognized extensions.
- `normalizeFilePathCandidates(values)` applies that normalization to a readonly
  list, drops empty results, and deduplicates while preserving first-seen order.
- Task specification types and helpers for classification, dependency ordering,
  parallel compatibility, and coding task contract creation and validation.
- `RequestEnvelope` types plus `createRequestEnvelope` and `hashRequestText` for
  bounded, hash-only model-request audit records. Supply the host hasher as the
  builder's second argument.
- `DurableTodoItem`, link/cursor/projection types, `createTodoSnapshot`,
  `createTodoLinks`, `createTodoProgressCursor`, and `projectTodoEvents` for
  host-neutral durable todo views. Event replay accepts a structural event
  shape with `eventId`, `seq`, `type`, and `data`, so hosts do not pass
  Harness-specific envelope types into Core.
- `redactPolicyText` and `redactPolicyPayload` for redacting common credential
  formats in strings and nested JSON-like values before display or persistence.
- `CoderTaskAnalysisView` and `toCoderTaskAnalysisView(value)` for validating,
  redacting, and bounding task-analysis data before it is shown or persisted.
  The analyzer itself remains app-side; Core accepts unknown input and returns
  only the stable view contract.

Path, task, todo projection, and redaction operations use ordinary data and need
no host capability ports. Core does not yet export model, workspace, command,
persistence, approval, or transport-specific event ports. Request-envelope
construction accepts a synchronous `hashSerializedValue(serialized)` function
from the host so Core does not import Node crypto or choose a host's hashing
implementation. The Node adapter supplies SHA-256. When another extracted
operation needs a host service, define a small typed port for that operation
before moving its implementation. Keep async behavior, cancellation, errors,
and authorization requirements explicit; do not create one catch-all host
context or expose Node, Cordis, Harness, or transport-specific types in Core.
