import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, stat, writeFile, copyFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { validateAndResolvePath } from '@barok/adapter-node';

export const DEFAULT_RESTORE_POINT_LIMITS = {
  maxFiles: 50_000,
  maxTotalBytes: 500 * 1024 * 1024,
  maxFileBytes: 50 * 1024 * 1024,
} as const;

const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  '.turbo',
  '.cache',
  '.vite',
  '.parcel-cache',
  '.output',
  '.svelte-kit',
  '.nuxt',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  'logs',
  'storage',
]);

export interface RestorePointLimits {
  maxFiles?: number;
  maxTotalBytes?: number;
  maxFileBytes?: number;
}

export interface RestorePointSummary {
  id: string;
  label: string;
  source: 'manual' | 'pre-restore';
  createdAt: number;
  workspace: string;
  fileCount: number;
  totalBytes: number;
}

interface RestorePointManifest extends RestorePointSummary {
  files: Array<{ path: string; size: number; mode?: number }>;
}

export class RestorePointError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid' | 'limit' | 'cancelled' | 'not_found' | 'unsafe',
  ) {
    super(message);
    this.name = 'RestorePointError';
  }
}

interface FileEntry {
  relativePath: string;
  absolutePath: string;
  size: number;
  mode: number;
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
}

function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RestorePointError('Restore point operation cancelled.', 'cancelled');
}

function safeRestorePointId(id: string): string {
  if (!/^[a-f0-9-]{20,80}$/i.test(id)) {
    throw new RestorePointError('Restore point ID is invalid.', 'invalid');
  }
  return id;
}

function limitsOf(input?: RestorePointLimits) {
  const limits = {
    maxFiles: input?.maxFiles ?? DEFAULT_RESTORE_POINT_LIMITS.maxFiles,
    maxTotalBytes: input?.maxTotalBytes ?? DEFAULT_RESTORE_POINT_LIMITS.maxTotalBytes,
    maxFileBytes: input?.maxFileBytes ?? DEFAULT_RESTORE_POINT_LIMITS.maxFileBytes,
  };
  if (!Number.isInteger(limits.maxFiles) || limits.maxFiles < 1 || !Number.isFinite(limits.maxTotalBytes) || limits.maxTotalBytes < 1 || !Number.isFinite(limits.maxFileBytes) || limits.maxFileBytes < 1) {
    throw new RestorePointError('Restore point limits are invalid.', 'invalid');
  }
  return limits;
}

async function collectFiles(
  workspaceRoot: string,
  limits: ReturnType<typeof limitsOf>,
  signal?: AbortSignal,
): Promise<FileEntry[]> {
  const files: FileEntry[] = [];
  let totalBytes = 0;

  const walk = async (directory: string, relativeDirectory: string): Promise<void> => {
    assertNotCancelled(signal);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      assertNotCancelled(signal);
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const relativePath = normalizeRelativePath(relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name);
      const absolutePath = validateAndResolvePath(relativePath, workspaceRoot);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const metadata = await lstat(absolutePath);
      if (metadata.size > limits.maxFileBytes) {
        throw new RestorePointError(`File ${relativePath} exceeds the ${limits.maxFileBytes}-byte restore-point file limit.`, 'limit');
      }
      if (files.length >= limits.maxFiles || totalBytes + metadata.size > limits.maxTotalBytes) {
        throw new RestorePointError(`Workspace exceeds the restore-point limit of ${limits.maxFiles} files or ${limits.maxTotalBytes} bytes.`, 'limit');
      }
      files.push({ relativePath, absolutePath, size: metadata.size, mode: metadata.mode });
      totalBytes += metadata.size;
    }
  };

  await walk(workspaceRoot, '');
  return files;
}

function restorePointDirectory(storageRoot: string, id: string): string {
  return path.resolve(storageRoot, safeRestorePointId(id));
}

async function readManifest(storageRoot: string, id: string): Promise<RestorePointManifest> {
  const directory = restorePointDirectory(storageRoot, id);
  try {
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as RestorePointManifest;
    if (!manifest || manifest.id !== id || !Array.isArray(manifest.files)) throw new Error('Invalid restore-point manifest.');
    return manifest;
  } catch (error) {
    if (error instanceof RestorePointError) throw error;
    throw new RestorePointError('Restore point was not found or is unreadable.', 'not_found');
  }
}

export async function createRestorePoint(
  workspaceRoot: string,
  storageRoot: string,
  options: RestorePointLimits & { label?: string; source?: 'manual' | 'pre-restore'; signal?: AbortSignal } = {},
): Promise<RestorePointSummary> {
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const resolvedStorage = path.resolve(storageRoot);
  const limits = limitsOf(options);
  const workspaceStats = await stat(resolvedWorkspace).catch(() => undefined);
  if (!workspaceStats?.isDirectory()) throw new RestorePointError('Workspace must be an existing directory.', 'invalid');
  assertNotCancelled(options.signal);

  const files = await collectFiles(resolvedWorkspace, limits, options.signal);
  const id = randomUUID();
  const directory = restorePointDirectory(resolvedStorage, id);
  const filesDirectory = path.join(directory, 'files');
  await mkdir(filesDirectory, { recursive: true });
  try {
    for (const file of files) {
      assertNotCancelled(options.signal);
      const target = path.join(filesDirectory, file.relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(file.absolutePath, target);
      await chmod(target, file.mode).catch(() => undefined);
    }
    const summary: RestorePointSummary = {
      id,
      label: (options.label || 'Workspace restore point').trim().slice(0, 120) || 'Workspace restore point',
      source: options.source || 'manual',
      createdAt: Date.now(),
      workspace: resolvedWorkspace,
      fileCount: files.length,
      totalBytes: files.reduce((total, file) => total + file.size, 0),
    };
    const manifest: RestorePointManifest = {
      ...summary,
      files: files.map(({ relativePath, size, mode }) => ({ path: relativePath, size, mode })),
    };
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    return summary;
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function listRestorePoints(storageRoot: string, workspaceRoot?: string): Promise<RestorePointSummary[]> {
  const directory = path.resolve(storageRoot);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const summaries: RestorePointSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = await readManifest(directory, entry.name);
      if (!workspaceRoot || path.resolve(manifest.workspace) === path.resolve(workspaceRoot)) summaries.push(manifest);
    } catch {
      // Ignore incomplete/corrupt snapshots; they are not offered as recoverable points.
    }
  }
  return summaries.sort((a, b) => b.createdAt - a.createdAt);
}

export async function restoreRestorePoint(
  storageRoot: string,
  workspaceRoot: string,
  id: string,
  options: RestorePointLimits & { signal?: AbortSignal } = {},
): Promise<{ restored: RestorePointSummary; rollback: RestorePointSummary; deletedFiles: number }> {
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const manifest = await readManifest(storageRoot, id);
  if (path.resolve(manifest.workspace) !== resolvedWorkspace) {
    throw new RestorePointError('Restore point belongs to a different workspace.', 'unsafe');
  }
  const limits = limitsOf(options);
  if (manifest.files.length > limits.maxFiles || manifest.totalBytes > limits.maxTotalBytes || manifest.files.some((file) => file.size > limits.maxFileBytes)) {
    throw new RestorePointError('Restore point exceeds the configured restore limits.', 'limit');
  }
  assertNotCancelled(options.signal);
  const rollback = await createRestorePoint(resolvedWorkspace, storageRoot, {
    ...limits,
    label: `Before restore of ${manifest.label}`,
    source: 'pre-restore',
    signal: options.signal,
  });

  const currentFiles = await collectFiles(resolvedWorkspace, limits, options.signal);
  const expected = new Set(manifest.files.map((file) => normalizeRelativePath(file.path)));
  let deletedFiles = 0;
  for (const file of currentFiles) {
    assertNotCancelled(options.signal);
    if (expected.has(file.relativePath)) continue;
    await rm(file.absolutePath, { force: true });
    deletedFiles += 1;
  }

  const snapshotDirectory = path.join(restorePointDirectory(storageRoot, id), 'files');
  for (const file of manifest.files) {
    assertNotCancelled(options.signal);
    const relativePath = normalizeRelativePath(file.path);
    const target = validateAndResolvePath(relativePath, resolvedWorkspace);
    const source = validateAndResolvePath(relativePath, snapshotDirectory);
    const sourceStats = await lstat(source).catch(() => undefined);
    if (!sourceStats?.isFile()) throw new RestorePointError(`Restore point file ${relativePath} is missing.`, 'not_found');
    const targetStats = await lstat(target).catch(() => undefined);
    if (targetStats?.isSymbolicLink()) throw new RestorePointError(`Refusing to overwrite symlink ${relativePath}.`, 'unsafe');
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    if (file.mode) await chmod(target, file.mode).catch(() => undefined);
  }
  return { restored: manifest, rollback, deletedFiles };
}

export async function deleteRestorePoint(storageRoot: string, id: string, workspaceRoot?: string): Promise<void> {
  const manifest = await readManifest(storageRoot, id);
  if (workspaceRoot && path.resolve(manifest.workspace) !== path.resolve(workspaceRoot)) {
    throw new RestorePointError('Restore point belongs to a different workspace.', 'unsafe');
  }
  await rm(restorePointDirectory(storageRoot, id), { recursive: true, force: true });
}
