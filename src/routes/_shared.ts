import { timingSafeEqual } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { access, constants, mkdir, realpath, stat } from 'fs/promises';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { validateAndResolvePath, PathValidationError } from '@barok/adapter-node';
import { RestorePointError } from '../workspace/restorePoints.js';
import { sanitizeError as _sanitizeError } from '../utils/sanitizeError.js';
import { getSQLiteAppStore } from '../persistence/sqliteStore.js';

// ─── Re-export sanitizeError so all route modules import from one place ───────
export { sanitizeError } from '../utils/sanitizeError.js';

// ─── Authorization ────────────────────────────────────────────────────────────

export function isProviderSettingsMutationAuthorized(req: Request): boolean {
  const expectedToken = process.env.PROVIDER_SETTINGS_TOKEN?.trim();
  const providedToken = String(req.get('x-provider-settings-token') || '');
  if (expectedToken && providedToken.length === expectedToken.length) {
    const expected = Buffer.from(expectedToken);
    const provided = Buffer.from(providedToken);
    if (timingSafeEqual(expected, provided)) return true;
  }

  const origin = req.get('origin');
  const host = req.get('host');
  if (origin) {
    try {
      return Boolean(host && new URL(origin).host === host);
    } catch {
      return false;
    }
  }

  const remoteAddress = req.socket.remoteAddress || '';
  return remoteAddress === '127.0.0.1'
    || remoteAddress === '::1'
    || remoteAddress === '::ffff:127.0.0.1';
}

// ─── Workspace path helpers ───────────────────────────────────────────────────

/** Resolves the configured default workspace folder from environment variables. */
function getDefaultTargetFolder(): string {
  return process.env.WORKSPACE_ROOT || process.env.REACT_TARGET_FOLDER || 'target';
}

const WORKSPACE_ALLOWED_ROOTS_ENV = 'WORKSPACE_ALLOWED_ROOTS';
const WORKSPACE_APPROVED_ROOTS_SETTING = 'workspace.approvedRoots';

/** Raised when an HTTP-selected workspace is outside the server's allow-list. */
export class WorkspacePolicyError extends Error {
  readonly code = 'WORKSPACE_NOT_APPROVED';

  constructor(workspace: string) {
    super(`Workspace is not approved by the server policy: ${workspace}`);
    this.name = 'WorkspacePolicyError';
  }
}

function parseWorkspaceRegistry(rawValue = process.env[WORKSPACE_ALLOWED_ROOTS_ENV]): string[] {
  return (rawValue || '')
    .split(/[\r\n,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function getPersistedWorkspaceRegistry(): string[] {
  const saved = getSQLiteAppStore().getSetting<unknown>(WORKSPACE_APPROVED_ROOTS_SETTING);
  return Array.isArray(saved)
    ? saved.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
    : [];
}

function getConfiguredWorkspaceRoots(): string[] {
  return [getDefaultTargetFolder(), ...parseWorkspaceRegistry()];
}

function workspacePathIdentity(value: string): string {
  const normalized = path.resolve(value).replace(/[\\/]+/g, path.sep);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isSameWorkspacePath(left: string, right: string): boolean {
  return workspacePathIdentity(left) === workspacePathIdentity(right);
}

function isWorkspaceDescendant(candidate: string, root: string): boolean {
  const relativePath = path.relative(workspacePathIdentity(root), workspacePathIdentity(candidate));
  return relativePath !== '' && !relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath);
}

function isWorkspaceOrDescendant(candidate: string, root: string): boolean {
  return isSameWorkspacePath(candidate, root) || isWorkspaceDescendant(candidate, root);
}

/**
 * Resolve a path through existing symlinks/junctions while preserving a
 * non-existent suffix. This lets a configured workspace be created safely
 * without treating a symlinked path as an unrelated lexical directory.
 */
async function canonicalizeWorkspacePath(candidate: string): Promise<string> {
  const pendingSegments: string[] = [];
  let current = path.resolve(candidate);

  while (true) {
    try {
      const canonicalBase = await realpath(current);
      return path.resolve(canonicalBase, ...pendingSegments);
    } catch (error: any) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(current, ...pendingSegments);
      pendingSegments.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Returns the explicitly approved workspace roots. WORKSPACE_ROOT (or the
 * legacy REACT_TARGET_FOLDER default) is always included, while
 * WORKSPACE_ALLOWED_ROOTS and launcher approvals provide additional roots.
 */
export async function getApprovedWorkspaceRoots(): Promise<string[]> {
  const configured = [...getConfiguredWorkspaceRoots(), ...getPersistedWorkspaceRegistry()];
  const canonicalRoots = await Promise.all(configured.map((root) => canonicalizeWorkspacePath(root)));
  return [...new Map(canonicalRoots.map((root) => [workspacePathIdentity(root), root])).values()];
}

/** Return launcher approvals that are not fixed by server environment settings. */
export async function getRemovableWorkspaceRoots(): Promise<string[]> {
  const configuredRoots = await Promise.all(getConfiguredWorkspaceRoots().map((root) => canonicalizeWorkspacePath(root)));
  const persistedRoots = await Promise.all(getPersistedWorkspaceRegistry().map((root) => canonicalizeWorkspacePath(root)));
  const removableRoots = persistedRoots.filter((root) =>
    !configuredRoots.some((configuredRoot) => isSameWorkspacePath(configuredRoot, root)),
  );
  return [...new Map(removableRoots.map((root) => [workspacePathIdentity(root), root])).values()];
}

/** Add an existing directory to the persistent workspace approval registry. */
export async function addApprovedWorkspaceRoot(value: unknown): Promise<{ root: string; roots: string[]; removableRoots: string[]; added: boolean }> {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Enter a folder path on the server.');
  const requestedPath = value.trim();
  if (requestedPath.length > 2_048) throw new Error('Folder path must be 2,048 characters or fewer.');
  if (!path.isAbsolute(requestedPath)) throw new Error('Enter the full absolute path to a folder on the server.');

  const root = await realpath(path.resolve(requestedPath));
  const rootStats = await stat(root);
  if (!rootStats.isDirectory()) throw new Error('The selected path is not a folder.');
  if (path.resolve(root) === path.parse(root).root) {
    throw new Error('A filesystem root cannot be approved. Choose a project folder instead.');
  }

  const approvedRoots = await getApprovedWorkspaceRoots();
  if (approvedRoots.some((approvedRoot) => isSameWorkspacePath(approvedRoot, root))) {
    return { root, roots: approvedRoots, removableRoots: await getRemovableWorkspaceRoots(), added: false };
  }

  const persistedRoots = getPersistedWorkspaceRegistry();
  persistedRoots.push(root);
  getSQLiteAppStore().saveSetting(WORKSPACE_APPROVED_ROOTS_SETTING, [...new Set(persistedRoots)]);
  return {
    root,
    roots: await getApprovedWorkspaceRoots(),
    removableRoots: await getRemovableWorkspaceRoots(),
    added: true,
  };
}

/** Remove a saved launcher approval without touching the workspace files. */
export async function removeApprovedWorkspaceRoot(value: unknown): Promise<{ root: string; roots: string[]; removableRoots: string[]; removed: true }> {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Choose a workspace to remove.');
  const requestedPath = value.trim();
  if (requestedPath.length > 2_048) throw new Error('Folder path must be 2,048 characters or fewer.');
  if (!path.isAbsolute(requestedPath)) throw new Error('Workspace path must be an absolute server path.');

  const root = await canonicalizeWorkspacePath(path.resolve(requestedPath));
  const configuredRoots = await Promise.all(getConfiguredWorkspaceRoots().map((configuredRoot) => canonicalizeWorkspacePath(configuredRoot)));
  if (configuredRoots.some((configuredRoot) => isSameWorkspacePath(configuredRoot, root))) {
    throw new Error('This workspace is configured by server settings and cannot be removed from the launcher.');
  }

  const persistedRoots = getPersistedWorkspaceRegistry();
  const canonicalPersistedRoots = await Promise.all(persistedRoots.map((persistedRoot) => canonicalizeWorkspacePath(persistedRoot)));
  const remainingRoots = persistedRoots.filter((_, index) => !isSameWorkspacePath(canonicalPersistedRoots[index], root));
  if (remainingRoots.length === persistedRoots.length) {
    throw new Error('This workspace does not have a removable launcher approval.');
  }

  getSQLiteAppStore().saveSetting(WORKSPACE_APPROVED_ROOTS_SETTING, remainingRoots);
  return {
    root,
    roots: await getApprovedWorkspaceRoots(),
    removableRoots: await getRemovableWorkspaceRoots(),
    removed: true,
  };
}

/**
 * Verify a path against the approved registry. Exact root matching is used
 * for workspace selections; descendants are opt-in for directory browsing.
 */
export async function assertApprovedWorkspacePath(
  candidate: string,
  options: { allowDescendant?: boolean } = {},
): Promise<string> {
  const canonicalCandidate = await canonicalizeWorkspacePath(candidate);
  const approvedRoots = await getApprovedWorkspaceRoots();
  const approved = approvedRoots.some((root) =>
    isSameWorkspacePath(canonicalCandidate, root) ||
    (options.allowDescendant === true && isWorkspaceDescendant(canonicalCandidate, root)),
  );
  if (!approved) throw new WorkspacePolicyError(candidate);
  return canonicalCandidate;
}

/**
 * Resolve, validate, and optionally create a configured workspace root. The
 * policy check completes before mkdir so rejected selections cannot create
 * directories outside the approved registry.
 */
export async function resolveApprovedWorkspaceRoot(
  workspace?: string,
  options: { createIfMissing?: boolean } = { createIfMissing: true },
): Promise<string> {
  const requested = resolveWorkspaceRoot(workspace);
  let workspaceRoot = await assertApprovedWorkspacePath(requested);
  if (options.createIfMissing !== false) {
    await mkdir(requested, { recursive: true });
    workspaceRoot = await assertApprovedWorkspacePath(requested);
  }
  return workspaceRoot;
}

/**
 * Normalises a raw workspace path value so Windows absolute paths work on all
 * platforms, and empty/missing values fall back to `'.'`.
 */
export function cleanWorkspacePath(value?: string): string {
  if (!value) return '.';
  if (/^[A-Z]:[\\/]/i.test(value)) {
    if (process.platform !== 'win32') {
      const cleaned = value.replace(/^[A-Z]:[\\/]/i, '');
      return cleaned.split(/[\\/]/).filter(Boolean).join(path.sep) || 'target';
    }
    return value;
  }
  return value;
}

/** Returns the absolute path for the default workspace root (no arg). */
export function resolveDefaultWorkspaceRoot(): string {
  const rawWorkspace = getDefaultTargetFolder();
  if (/^[A-Z]:[\\/]/i.test(rawWorkspace)) {
    if (process.platform !== 'win32') return path.resolve(process.cwd(), cleanWorkspacePath(rawWorkspace));
    return path.resolve(rawWorkspace);
  }
  return path.isAbsolute(rawWorkspace)
    ? path.resolve(rawWorkspace)
    : path.resolve(process.cwd(), rawWorkspace);
}

/**
 * Resolves the absolute workspace root for an optional caller-supplied
 * `workspace` string, falling back to the configured default.
 */
export function resolveWorkspaceRoot(workspace?: string): string {
  const target = workspace || getDefaultTargetFolder();
  if (/^[A-Z]:[\\/]/i.test(target)) {
    if (process.platform !== 'win32') return path.resolve(process.cwd(), cleanWorkspacePath(target));
    return path.resolve(target);
  }
  return path.isAbsolute(target) ? path.resolve(target) : path.resolve(process.cwd(), target);
}

/**
 * Resolves and validates a file/directory path relative to the workspace root.
 * Throws `PathValidationError` for path-traversal attempts.
 */
export function resolveWorkspacePath(targetPath: string, workspace?: string): string {
  return validateAndResolvePath(targetPath, resolveWorkspaceRoot(workspace));
}

/**
 * Like `resolveWorkspacePath` but intended for directory browsing — accepts
 * Windows absolute paths on non-Windows by stripping the drive prefix.
 */
export function resolveDirectoryBrowsePath(targetPath: string, workspace?: string): string {
  const cleanedTarget = cleanWorkspacePath(targetPath);
  if (/^[A-Z]:[\\/]/i.test(targetPath)) {
    if (process.platform !== 'win32') return path.resolve(process.cwd(), cleanedTarget);
    return path.resolve(targetPath);
  }
  return path.isAbsolute(cleanedTarget)
    ? path.resolve(cleanedTarget)
    : path.resolve(resolveWorkspaceRoot(workspace), cleanedTarget || '.');
}

/**
 * Resolve a directory-picker path through the path validator and approved-root
 * policy. Absolute paths may select any configured root; relative paths remain
 * anchored to the selected workspace.
 */
export async function resolveApprovedDirectoryBrowsePath(
  targetPath: string,
  workspace?: string,
): Promise<string> {
  const workspaceRoot = await ensureWorkspaceRoot(workspace);
  const isAbsoluteBrowsePath = path.isAbsolute(targetPath) || /^[A-Z]:[\\/]/i.test(targetPath);
  if (!isAbsoluteBrowsePath) {
    return resolveApprovedWorkspacePath(targetPath || '.', workspaceRoot);
  }

  const candidate = resolveDirectoryBrowsePath(targetPath, workspaceRoot);
  const approvedRoots = await getApprovedWorkspaceRoots();
  const anchorRoot = approvedRoots.find((root) => isWorkspaceOrDescendant(candidate, root));
  if (!anchorRoot) throw new WorkspacePolicyError(candidate);

  const relativeTarget = path.relative(anchorRoot, candidate) || '.';
  const resolvedPath = validateAndResolvePath(relativeTarget, anchorRoot);
  const canonicalPath = await assertApprovedWorkspacePath(resolvedPath, { allowDescendant: true });
  if (!isWorkspaceOrDescendant(canonicalPath, anchorRoot)) {
    throw new WorkspacePolicyError(canonicalPath);
  }
  return canonicalPath;
}

/**
 * Returns all accessible filesystem roots.
 * On Windows this enumerates drive letters; on POSIX it returns `['/']`.
 */
export async function resolveLocalDirectoryRoots(): Promise<string[]> {
  if (process.platform === 'win32') {
    const roots: string[] = [];
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const rootPath = `${letter}:\\`;
      try {
        await access(rootPath, constants.R_OK);
        roots.push(rootPath);
      } catch {
        // ignore inaccessible or nonexistent drives
      }
    }
    return roots.length > 0 ? roots : ['C:\\'];
  }
  return ['/'];
}

/**
 * Resolves the workspace root and creates it if it does not exist.
 * Returns the absolute path.
 */
export async function ensureWorkspaceRoot(workspace?: string): Promise<string> {
  return resolveApprovedWorkspaceRoot(workspace);
}

/**
 * Resolve a workspace-relative file/directory target and reject symlink or
 * junction targets whose canonical location leaves the approved workspace.
 */
export async function resolveApprovedWorkspacePath(targetPath: string, workspace?: string): Promise<string> {
  const workspaceRoot = await ensureWorkspaceRoot(workspace);
  const resolvedPath = validateAndResolvePath(targetPath, workspaceRoot);
  const canonicalPath = await assertApprovedWorkspacePath(resolvedPath, { allowDescendant: true });
  if (!isWorkspaceOrDescendant(canonicalPath, workspaceRoot)) {
    throw new WorkspacePolicyError(canonicalPath);
  }
  return canonicalPath;
}

function getWorkspaceRequestValues(req: Request): Array<{ source: 'body' | 'query' | 'workPlan'; value: string }> {
  const values: Array<{ source: 'body' | 'query' | 'workPlan'; value: string }> = [];
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : undefined;
  const queryWorkspace = typeof req.query.workspace === 'string' ? req.query.workspace.trim() : '';
  const bodyWorkspace = typeof body?.workspace === 'string' ? body.workspace.trim() : '';
  const workPlan = body?.workPlan && typeof body.workPlan === 'object'
    ? body.workPlan as Record<string, unknown>
    : undefined;
  const workPlanWorkspace = typeof workPlan?.workspace === 'string' ? workPlan.workspace.trim() : '';

  if (queryWorkspace) values.push({ source: 'query', value: queryWorkspace });
  if (bodyWorkspace) values.push({ source: 'body', value: bodyWorkspace });
  if (workPlanWorkspace) values.push({ source: 'workPlan', value: workPlanWorkspace });
  return values;
}

/**
 * Enforce the workspace policy at the HTTP boundary, including legacy routes
 * that resolve workspace paths outside the main route modules.
 */
export function createWorkspacePolicyMiddleware(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const values = getWorkspaceRequestValues(req);
      for (const { source, value } of values) {
        const approved = await ensureWorkspaceRoot(value);
        if (source === 'query') req.query.workspace = approved;
        if (source === 'body' && req.body && typeof req.body === 'object') req.body.workspace = approved;
        if (source === 'workPlan' && req.body?.workPlan && typeof req.body.workPlan === 'object') {
          req.body.workPlan.workspace = approved;
        }
      }
      next();
    } catch (error) {
      const response = pathErrorResponse(error);
      res.status(response.status).json({ error: response.error });
    }
  };
}

const execFileAsync = promisify(execFile);

/**
 * Returns the current HEAD commit hash for the git repository at
 * `workspaceRoot`, or `'uncommitted'` if not in a git repo.
 */
export async function getRepositoryCommitHash(workspaceRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', workspaceRoot, 'rev-parse', 'HEAD'], {
      windowsHide: true,
      timeout: 5_000,
    });
    return stdout.trim() || 'uncommitted';
  } catch {
    return 'uncommitted';
  }
}

// ─── Error-response helpers ───────────────────────────────────────────────────

/** Maps a path-validation or generic error to a `{ status, error }` payload. */
export function pathErrorResponse(error: unknown): { status: number; error: string } {
  if (error instanceof WorkspacePolicyError) {
    return { status: 403, error: 'Workspace is not approved by the server policy.' };
  }
  if (error instanceof PathValidationError) {
    return { status: 403, error: `Access denied: ${error.reason}` };
  }
  return {
    status: 500,
    error: error instanceof Error ? _sanitizeError(error.message) : 'Unknown error',
  };
}

/** Maps a restore-point or path-validation error to a `{ status, error }` payload. */
export function restorePointErrorResponse(error: unknown): { status: number; error: string } {
  if (error instanceof RestorePointError) {
    return {
      status: error.code === 'not_found' ? 404 : error.code === 'limit' ? 413 : error.code === 'cancelled' ? 499 : 400,
      error: _sanitizeError(error.message || String(error)),
    };
  }
  return pathErrorResponse(error);
}
