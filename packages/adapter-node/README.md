# Node Adapter

`@barok/adapter-node` holds Node-specific implementations of Core and Engine host capabilities. Extracted slices include the SHA-256 callback used by Core's hash-only request-envelope builder, generated-app manifest persistence, checkpoint workspace fingerprinting, canonical workspace path validation, and the guarded process/command runtime.

```ts
import { hashSerializedRequestValue } from '@barok/adapter-node';

const hash = hashSerializedRequestValue(JSON.stringify({ task: 'example' }));
```

Manifest persistence exports `saveManifest`, `loadManifest`, `discoverManifests`, `updateManifestWithVerification`, and `getLatestManifest`. The adapter owns the Node filesystem operations; its public types describe only the fields needed to store and select manifest records.

`fingerprintWorkspace` is the Node implementation of Engine's workspace fingerprint provider. It reads tracked workspace files and returns hashes used to reject stale checkpoint resumes.

Generated-app Playwright verification now lives here as `verifyApp`, `verifyHtmlApp`, and `verifyViteApp`. The package declares Playwright as a dependency. `discoverVerificationRepairFiles` performs filesystem-backed entry-point and HTML reference discovery for scoped repair. The former `src/react/app-verifier.ts` and `src/react/app-repair.ts` paths remain compatibility facades; Engine policy stays in `@barok/engine`.

`scanDirtyTree`, `getGitStatus`, `getUntrackedFiles`, and `getFileDiff` provide the Git-backed dirty-workspace snapshot used by the standalone app. `getDirtyTreeState` and `invalidateDirtyTreeCache` provide a bounded process-local snapshot cache. The former `src/repo/dirtyTreeTracker.ts` module keeps Barok's role-mapping and merge-impact helpers while re-exporting the adapter operations.

Workspace path validation also lives here. `validateAndResolvePath` canonicalizes a user-supplied path against a workspace, checks lexical containment, and resolves existing symlinks before returning a target. `getWorkspaceRelativePath` returns a canonical relative path for evidence and manifests. The former `src/tools/pathValidator.ts` path remains a compatibility facade.

`normalizeWorkspacePathKey` preserves the planner's cross-platform path matching behavior for mutation targets and retained file evidence.

`normalizeWorkspacePathKey` preserves the planner's cross-platform path matching behavior for mutation targets and retained file evidence.

Run-scoped temporary workspace creation, capability validation, cleanup, and managed-root checks also live here. The Engine package defines only the structural capability contract; its runtime cleanup port lets the Node host dispose of owned workspaces.

`createId()` supplies the Engine runtime's UUID generator through Node's built-in crypto API.

`getPlatform()` supplies the host platform identifier used by Engine to format planner shell guidance.

`getEnvironmentVariable()` and `getWorkingDirectory()` keep direct `process.env` and `process.cwd()` access in the Node adapter. The standalone app's runtime composition still owns Barok provider and model configuration, but obtains these process values through the adapter.

The process command runtime detects supported shells and package managers, resolves structured verification and Git commands, and executes them with timeout/cancellation handling. DevTools imports the package entry; the former `src/tools/commandRuntime.ts` path remains a compatibility facade.

The package is a private `0.0.0` workspace with ESM and declaration output. The former `src/di/requestEnvelopeHash.ts`, `src/di/appManifestStorage.ts`, `src/tools/commandRuntime.ts`, and `src/tools/pathValidator.ts` paths preserve app imports during migration. Provider/configuration, most workspace, and other persistence implementations remain in the existing app and are future extraction slices.
