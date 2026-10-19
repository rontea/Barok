import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RunScopedWorkspaceCapability } from '@barok/engine';

interface IssuedWorkspace {
  root: string;
  runId: string;
  disposed: boolean;
}

const issuedWorkspaces = new WeakMap<object, IssuedWorkspace>();

function isWithin(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function safeRunId(runId: string): string {
  return runId.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'run';
}

export function managedTemporaryWorkspaceRoot(): string {
  let canonicalTempRoot = tmpdir();
  try { canonicalTempRoot = realpathSync(tmpdir()); } catch { /* The creator will fail if the temp root is unavailable. */ }
  return path.resolve(canonicalTempRoot, 'react-engine', 'workspaces');
}

/** Create scratch space under the engine-owned temporary root for one run. */
export async function createRunScopedWorkspace(input: {
  runId: string;
  taskScoped: true;
}): Promise<RunScopedWorkspaceCapability> {
  if (!input.runId?.trim() || input.taskScoped !== true) {
    throw new Error('A run-scoped temporary workspace requires a run ID and explicit task scope.');
  }

  const managedRoot = managedTemporaryWorkspaceRoot();
  await mkdir(managedRoot, { recursive: true });
  const canonicalManagedRoot = await realpath(managedRoot);
  if (path.relative(managedRoot, canonicalManagedRoot) !== '') {
    throw new Error('The engine-managed temporary root must not resolve through a symbolic link.');
  }
  const createdPath = await mkdtemp(path.join(canonicalManagedRoot, `task-${safeRunId(input.runId)}-`));
  const canonicalRoot = await realpath(createdPath);
  if (!isWithin(canonicalManagedRoot, canonicalRoot) || canonicalRoot === canonicalManagedRoot) {
    // Do not recursively clean a path after canonicalization says it escaped.
    throw new Error('The created temporary workspace escaped the engine-managed temp root.');
  }

  const capability = Object.freeze({
    runId: input.runId,
    root: canonicalRoot,
    taskScoped: true as const,
  });
  issuedWorkspaces.set(capability, { root: canonicalRoot, runId: input.runId, disposed: false });
  return capability;
}

/** A capability is valid only for its issuing run and exact canonical workspace. */
export async function isRunScopedWorkspaceAuthorized(input: {
  capability?: RunScopedWorkspaceCapability;
  workspace: string;
  taskWorkspace?: string;
  runId?: string;
}): Promise<boolean> {
  const capability = input.capability;
  if (!capability || capability.taskScoped !== true || !input.runId || capability.runId !== input.runId) return false;
  const issued = issuedWorkspaces.get(capability);
  if (!issued || issued.disposed || issued.runId !== input.runId) return false;

  try {
    const [managedRoot, workspace, taskWorkspace, actualRoot] = await Promise.all([
      realpath(managedTemporaryWorkspaceRoot()),
      realpath(input.workspace),
      input.taskWorkspace ? realpath(input.taskWorkspace) : Promise.resolve(''),
      realpath(issued.root),
    ]);
    return actualRoot === issued.root && workspace === issued.root && taskWorkspace === issued.root &&
      isWithin(managedRoot, actualRoot) && actualRoot !== managedRoot;
  } catch {
    return false;
  }
}

/** Remove only the exact, still-canonical directory issued to this run. */
export async function disposeRunScopedWorkspace(capability: RunScopedWorkspaceCapability): Promise<void> {
  const issued = issuedWorkspaces.get(capability);
  if (!issued || issued.disposed) return;

  const managedRoot = await realpath(managedTemporaryWorkspaceRoot());
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(issued.root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      issued.disposed = true;
      return;
    }
    throw error;
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error('Refusing to clean up a temporary workspace whose root is no longer a directory.');
  }
  const currentRoot = await realpath(issued.root);
  if (currentRoot !== issued.root || !isWithin(managedRoot, currentRoot) || currentRoot === managedRoot) {
    throw new Error('Refusing to clean up a temporary workspace outside its canonical engine-managed root.');
  }

  await rm(currentRoot, { recursive: true, force: true });
  issued.disposed = true;
}

export function isManagedTemporaryWorkspacePath(workspace: string): boolean {
  const root = managedTemporaryWorkspaceRoot();
  let candidate = path.resolve(workspace);
  try { candidate = realpathSync(candidate); } catch { /* A not-yet-created path is checked lexically. */ }
  return isWithin(root, candidate);
}
