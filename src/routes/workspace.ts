import { createHash } from 'crypto';
import { Router } from 'express';
import path from 'path';
import { mkdir, writeFile, readdir, stat, lstat, readFile, rm, unlink } from 'fs/promises';
import {
  createRestorePoint,
  deleteRestorePoint,
  listRestorePoints,
  restoreRestorePoint,
} from '../workspace/restorePoints.js';
import {
  sanitizeError,
  ensureWorkspaceRoot,
  resolveApprovedDirectoryBrowsePath,
  resolveApprovedWorkspacePath,
  getApprovedWorkspaceRoots,
  getRemovableWorkspaceRoots,
  pathErrorResponse,
  restorePointErrorResponse,
  addApprovedWorkspaceRoot,
  removeApprovedWorkspaceRoot,
  isProviderSettingsMutationAuthorized,
} from './_shared.js';

export const EXCLUDED_WORKSPACE_TREE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage',
  '.turbo', '.cache', '.vite', '.parcel-cache', '.output', '.svelte-kit',
  '.nuxt', 'vendor', '.venv', 'venv', '__pycache__', 'logs', 'storage',
]);

const EXCLUDED_ARCHIVE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage',
  '.turbo', '.cache', '.vite', 'storage', '.output',
]);

interface WorkspaceArchiveFile {
  absolutePath: string;
  relativePath: string;
  size: number;
}

interface WorkspaceArchiveLimits {
  maxBytes: number;
  maxFiles: number;
  maxFileBytes: number;
}

function configuredPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function getWorkspaceArchiveLimits(): WorkspaceArchiveLimits {
  return {
    maxBytes: configuredPositiveInteger('WORKSPACE_ZIP_MAX_BYTES', 500 * 1024 * 1024),
    maxFiles: configuredPositiveInteger('WORKSPACE_ZIP_MAX_FILES', 50_000),
    maxFileBytes: configuredPositiveInteger('WORKSPACE_ZIP_MAX_FILE_BYTES', 50 * 1024 * 1024),
  };
}

export async function scanWorkspaceArchive(
  rootPath: string,
  limits = getWorkspaceArchiveLimits(),
): Promise<{ files: WorkspaceArchiveFile[]; totalBytes: number; skippedLargeFiles: number }> {
  const files: WorkspaceArchiveFile[] = [];
  let totalBytes = 0;
  let skippedLargeFiles = 0;
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!EXCLUDED_ARCHIVE_DIRS.has(entry.name)) await visit(path.join(directory, entry.name));
        continue;
      }
      // ZIP exports contain regular files only; sockets/devices/FIFOs are not
      // useful workspace artifacts and must never be followed or streamed.
      if (!entry.isFile()) continue;
      const absolutePath = path.join(directory, entry.name);
      const fileStats = await lstat(absolutePath);
      if (!fileStats.isFile()) continue;
      if (fileStats.size > limits.maxFileBytes) {
        skippedLargeFiles += 1;
        continue;
      }
      if (files.length + 1 > limits.maxFiles) {
        throw Object.assign(new Error('Workspace ZIP exceeds the configured file-count limit.'), { code: 'WORKSPACE_ZIP_LIMIT', status: 413 });
      }
      totalBytes += fileStats.size;
      if (totalBytes > limits.maxBytes) {
        throw Object.assign(new Error('Workspace ZIP exceeds the configured uncompressed-size limit.'), { code: 'WORKSPACE_ZIP_LIMIT', status: 413 });
      }
      files.push({
        absolutePath,
        relativePath: path.relative(rootPath, absolutePath).split(path.sep).join('/'),
        size: fileStats.size,
      });
    }
  };
  await visit(rootPath);
  return { files, totalBytes, skippedLargeFiles };
}

function getSingleQueryString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : null;
}

export async function buildTree(
  dir: string,
  baseDir: string,
  maxDepth = 10,
  currentDepth = 0,
): Promise<{ tree: any[]; truncated: boolean }> {
  const items = await readdir(dir, { withFileTypes: true });
  if (currentDepth >= maxDepth) {
    const truncated = items.some((item) =>
      !item.isSymbolicLink() && (item.isFile() || (item.isDirectory() && !EXCLUDED_WORKSPACE_TREE_DIRS.has(item.name))),
    );
    return { tree: [], truncated };
  }
  const result = [];
  let truncated = false;

  for (const item of items) {
    if (item.isDirectory() && EXCLUDED_WORKSPACE_TREE_DIRS.has(item.name)) continue;
    // Do not expose symlinks in the tree. File operations independently
    // validate every selected path before accessing it.
    if (item.isSymbolicLink()) continue;

    const fullPath = path.join(dir, item.name);
    const relativePath = path.relative(baseDir, fullPath);
    if (item.isDirectory()) {
      const childTree = await buildTree(fullPath, baseDir, maxDepth, currentDepth + 1);
      truncated ||= childTree.truncated;
      result.push({
        name: item.name,
        type: 'directory',
        path: relativePath,
        children: childTree.tree,
      });
    } else {
      result.push({
        name: item.name,
        type: 'file',
        path: relativePath,
      });
    }
  }

  const tree = result.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === 'directory' ? -1 : 1;
  });
  return { tree, truncated };
}

interface WorkspaceRouterDependencies {
  restorePointDirectory: string;
}

export function createRouter({
  restorePointDirectory,
}: WorkspaceRouterDependencies) {
  const router = Router();


  router.get('/api/workspace/default', async (_req, res) => {
    try {
      const workspace = await ensureWorkspaceRoot();
      res.json({ workspace });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.get('/api/directory-roots', async (_req, res) => {
    try {
      const roots = await getApprovedWorkspaceRoots();
      const removableRoots = await getRemovableWorkspaceRoots();
      res.json({ roots, removableRoots });
    } catch (error: any) {
      const message = sanitizeError(error.message || String(error));
      const invalidSelection = /Gemini model target .* (?:is not configured|cannot be used)|Gemini profile .* is not configured or enabled/i.test(message);
      res.status(invalidSelection ? 400 : 500).json({ error: message });
    }
  });

  router.post('/api/directory-roots', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Workspace approvals require same-origin access or an authorized server token.' });
    }
    try {
      const result = await addApprovedWorkspaceRoot(req.body?.path);
      return res.status(201).json({ success: true, ...result });
    } catch (error: any) {
      return res.status(400).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.delete('/api/directory-roots', async (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Workspace approval changes require same-origin access or an authorized server token.' });
    }
    try {
      const result = await removeApprovedWorkspaceRoot(req.body?.path);
      return res.json({ success: true, ...result });
    } catch (error: any) {
      return res.status(400).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.get('/api/directories', async (req, res) => {
    try {
      const workspaceQuery = getSingleQueryString(req.query.workspace);
      const pathQuery = getSingleQueryString(req.query.path);
      if (workspaceQuery === null || pathQuery === null) {
        return res.status(400).json({ error: 'workspace and path must each be a single string.' });
      }
      const workspace = workspaceQuery || undefined;
      const targetPath = pathQuery || '.';
      const workspaceRoot = await ensureWorkspaceRoot(workspace);
      const resolvedPath = await resolveApprovedDirectoryBrowsePath(targetPath, workspaceRoot);

      const items = await readdir(resolvedPath, { withFileTypes: true });
      const directories = items
        .filter(item => item.isDirectory() && !item.name.startsWith('.'))
        .map(item => item.name)
        .sort();

      const candidateParentPath = path.resolve(resolvedPath, '..');
      let parentPath: string | null = null;
      if (candidateParentPath !== resolvedPath) {
        try {
          parentPath = await resolveApprovedDirectoryBrowsePath(candidateParentPath, workspaceRoot);
        } catch {
          parentPath = null;
        }
      }

      res.json({
        path: resolvedPath,
        parent: parentPath !== resolvedPath ? parentPath : null,
        directories,
      });
    } catch (error: any) {
      const response = pathErrorResponse(error);
      res.status(response.status).json({ error: response.error });
    }
  });

  router.post('/api/workspaces/upload', async (req, res) => {
    try {
      const workspace = typeof req.body?.workspace === 'string' ? req.body.workspace.trim() : '';
      const files = req.body?.files;
      if (!workspace) return res.status(400).json({ error: 'workspace is required' });
      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'At least one file is required' });
      }
      if (files.length > 5_000) {
        return res.status(413).json({ error: 'Workspace upload contains too many files.' });
      }

      const maxTotalBytes = 20 * 1024 * 1024;
      const workspaceRoot = await ensureWorkspaceRoot(workspace);
      let totalBytes = 0;
      let uploaded = 0;

      for (const entry of files) {
        if (!entry || typeof entry !== 'object') {
          return res.status(400).json({ error: 'Each upload entry must be an object.' });
        }
        const relativePath = typeof entry.path === 'string' ? entry.path.trim() : '';
        const encodedContent = typeof entry.content === 'string' ? entry.content : '';
        if (!relativePath) return res.status(400).json({ error: 'Every upload entry needs a relative path.' });
        if (entry.encoding !== 'base64') return res.status(400).json({ error: 'Uploads must use base64 encoding.' });
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedContent)) {
          return res.status(400).json({ error: `Invalid base64 content for ${sanitizeError(relativePath)}.` });
        }

        const content = Buffer.from(encodedContent, 'base64');
        totalBytes += content.byteLength;
        if (totalBytes > maxTotalBytes) {
          return res.status(413).json({ error: 'Workspace upload exceeds the 20 MB limit.' });
        }

        const resolvedPath = await resolveApprovedWorkspacePath(relativePath, workspaceRoot);
        await mkdir(path.dirname(resolvedPath), { recursive: true });
        await writeFile(resolvedPath, content);
        uploaded += 1;
      }

      return res.status(201).json({ success: true, workspace: workspaceRoot, uploaded, totalBytes });
    } catch (error: any) {
      const response = pathErrorResponse(error);
      return res.status(response.status).json({ error: response.error });
    }
  });

  router.get('/api/workspace/restore-points', async (req, res) => {
    try {
      const workspaceQuery = getSingleQueryString(req.query.workspace);
      if (workspaceQuery === null) return res.status(400).json({ error: 'workspace must be a single string.' });
      const workspace = workspaceQuery || undefined;
      const workspaceRoot = await ensureWorkspaceRoot(workspace);
      const points = await listRestorePoints(restorePointDirectory, workspaceRoot);
      return res.json({ restorePoints: points });
    } catch (error) {
      const response = restorePointErrorResponse(error);
      return res.status(response.status).json({ error: response.error });
    }
  });

  router.post('/api/workspace/restore-points', async (req, res) => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', onAbort);
    res.once('close', onClose);
    try {
      if (req.body?.workspace !== undefined && typeof req.body.workspace !== 'string') {
        return res.status(400).json({ error: 'workspace must be a string.' });
      }
      const workspace = typeof req.body?.workspace === 'string' ? req.body.workspace : undefined;
      const workspaceRoot = await ensureWorkspaceRoot(workspace);
      const restorePoint = await createRestorePoint(workspaceRoot, restorePointDirectory, {
        label: typeof req.body?.label === 'string' ? req.body.label : undefined,
        signal: controller.signal,
      });
      return res.status(201).json({ restorePoint });
    } catch (error) {
      const response = restorePointErrorResponse(error);
      return res.status(response.status).json({ error: response.error });
    } finally {
      req.off('aborted', onAbort);
      res.off('close', onClose);
    }
  });

  router.post('/api/workspace/restore-points/:id/restore', async (req, res) => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', onAbort);
    res.once('close', onClose);
    try {
      if (req.body?.workspace !== undefined && typeof req.body.workspace !== 'string') {
        return res.status(400).json({ error: 'workspace must be a string.' });
      }
      const workspace = typeof req.body?.workspace === 'string' ? req.body.workspace : undefined;
      const workspaceRoot = await ensureWorkspaceRoot(workspace);
      const result = await restoreRestorePoint(restorePointDirectory, workspaceRoot, req.params.id, { signal: controller.signal });
      return res.json(result);
    } catch (error) {
      const response = restorePointErrorResponse(error);
      return res.status(response.status).json({ error: response.error });
    } finally {
      req.off('aborted', onAbort);
      res.off('close', onClose);
    }
  });

  router.delete('/api/workspace/restore-points/:id', async (req, res) => {
    try {
      const workspaceQuery = getSingleQueryString(req.query.workspace);
      if (workspaceQuery === null) return res.status(400).json({ error: 'workspace must be a single string.' });
      const workspace = workspaceQuery || undefined;
      const workspaceRoot = await ensureWorkspaceRoot(workspace);
      await deleteRestorePoint(restorePointDirectory, req.params.id, workspaceRoot);
      return res.json({ deleted: true });
    } catch (error) {
      const response = restorePointErrorResponse(error);
      return res.status(response.status).json({ error: response.error });
    }
  });

  router.get('/api/workspace/tree', async (req, res) => {
    try {
      const workspaceQuery = getSingleQueryString(req.query.workspace);
      if (workspaceQuery === null) return res.status(400).json({ error: 'workspace must be a single string.' });
      const workspacePath = await ensureWorkspaceRoot(
        workspaceQuery || undefined,
      );
      const validatedSeedPath = await resolveApprovedWorkspacePath('.', workspacePath);
      const result = await buildTree(validatedSeedPath, validatedSeedPath);
      res.json(result);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        res.json({ tree: [], truncated: false });
      } else {
        const response = pathErrorResponse(error);
        res.status(response.status).json({ error: response.error });
      }
    }
  });

  router.get('/api/workspace/file', async (req, res) => {
    try {
      const workspaceQuery = getSingleQueryString(req.query.workspace);
      const pathQuery = getSingleQueryString(req.query.path);
      if (workspaceQuery === null || pathQuery === null) {
        return res.status(400).json({ error: 'workspace and path must each be a single string.' });
      }
      const workspace = workspaceQuery || undefined;
      const targetPath = pathQuery || '';
      if (!targetPath) return res.status(400).json({ error: 'Path is required' });

      const workspaceRoot = await ensureWorkspaceRoot(workspace);
      const resolvedPath = await resolveApprovedWorkspacePath(targetPath, workspaceRoot);
      const stats = await stat(resolvedPath);
      if (!stats.isFile()) return res.status(404).json({ error: 'File not found' });

      const content = await readFile(resolvedPath, 'utf8');
      const hash = createHash('sha256').update(content, 'utf8').digest('hex');
      res.json({ content, hash, modifiedAt: stats.mtimeMs, size: stats.size });
    } catch (error: any) {
      if (error?.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
      const response = pathErrorResponse(error);
      res.status(response.status).json({ error: response.error });
    }
  });

  router.put('/api/workspace/file', async (req, res) => {
    try {
      if ((req.body?.workspace !== undefined && typeof req.body.workspace !== 'string')
        || (req.body?.path !== undefined && typeof req.body.path !== 'string')) {
        return res.status(400).json({ error: 'workspace and path must each be strings.' });
      }
      const workspace = typeof req.body?.workspace === 'string' ? req.body.workspace : undefined;
      const targetPath = typeof req.body?.path === 'string' ? req.body.path : '';
      const content = req.body?.content;
      const expectedHash = req.body?.expectedHash ? String(req.body.expectedHash) : '';
      if (!targetPath) return res.status(400).json({ error: 'Path is required' });
      if (typeof content !== 'string') return res.status(400).json({ error: 'File content must be a string' });
      if (!expectedHash) return res.status(400).json({ error: 'expectedHash from a prior read is required' });

      const workspaceRoot = await ensureWorkspaceRoot(workspace);
      const resolvedPath = await resolveApprovedWorkspacePath(targetPath, workspaceRoot);
      const stats = await stat(resolvedPath);
      if (!stats.isFile()) return res.status(404).json({ error: 'File not found' });

      const currentContent = await readFile(resolvedPath, 'utf8');
      const currentHash = createHash('sha256').update(currentContent, 'utf8').digest('hex');
      if (currentHash !== expectedHash) {
        return res.status(409).json({
          error: 'File changed on disk. Reload it before saving or keep the local draft for manual merge.',
          conflict: true,
          content: currentContent,
          hash: currentHash,
          modifiedAt: stats.mtimeMs,
          size: stats.size,
        });
      }

      await writeFile(resolvedPath, content, 'utf8');
      const savedStats = await stat(resolvedPath);
      const hash = createHash('sha256').update(content, 'utf8').digest('hex');
      return res.json({ saved: true, hash, modifiedAt: savedStats.mtimeMs, size: savedStats.size });
    } catch (error: any) {
      if (error?.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
      const response = pathErrorResponse(error);
      return res.status(response.status).json({ error: response.error });
    }
  });

  router.get('/api/workspace/download-file', async (req, res) => {
    try {
      const workspaceQuery = getSingleQueryString(req.query.workspace);
      const pathQuery = getSingleQueryString(req.query.path);
      if (workspaceQuery === null || pathQuery === null) {
        return res.status(400).json({ error: 'workspace and path must each be a single string.' });
      }
      const workspace = workspaceQuery || undefined;
      const targetPath = pathQuery || '';
      if (!targetPath) return res.status(400).json({ error: 'Path is required' });

      const workspaceRoot = await ensureWorkspaceRoot(workspace);
      const resolvedPath = await resolveApprovedWorkspacePath(targetPath, workspaceRoot);
      const stats = await stat(resolvedPath);
      if (!stats.isFile()) return res.status(404).json({ error: 'File not found' });

      const fileName = path.basename(resolvedPath);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.sendFile(resolvedPath);
    } catch (error: any) {
      const response = pathErrorResponse(error);
      return res.status(response.status).json({ error: response.error });
    }
  });

  router.get('/api/workspace/download-zip', async (req, res) => {
    try {
      const workspaceQuery = getSingleQueryString(req.query.workspace);
      const pathQuery = getSingleQueryString(req.query.path);
      if (workspaceQuery === null || pathQuery === null) {
        return res.status(400).json({ error: 'workspace and path must each be a single string.' });
      }
      const workspace = workspaceQuery || undefined;
      const targetPath = pathQuery || '';

      const rootPath = await ensureWorkspaceRoot(workspace);
      const targetFullPath = targetPath ? await resolveApprovedWorkspacePath(targetPath, rootPath) : rootPath;
      const stats = await stat(targetFullPath);
      if (!stats.isDirectory()) return res.status(400).json({ error: 'Target path is not a directory' });

      const limits = getWorkspaceArchiveLimits();
      const archiveInventory = await scanWorkspaceArchive(targetFullPath, limits);
      const { ZipArchive } = await import('archiver');

      const folderName = targetPath ? path.basename(targetFullPath) : (workspace ? path.basename(workspace) : 'workspace');
      const zipFilename = `${folderName.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipFilename)}"`);
      res.setHeader('X-Workspace-Zip-Skipped-Large-Files', String(archiveInventory.skippedLargeFiles));

      const archive = new ZipArchive({ zlib: { level: 9 } });
      archive.on('error', (error: Error) => {
        console.error('Archive error:', sanitizeError(error instanceof Error ? error.message : String(error)));
        if (!res.headersSent) res.status(500).json({ error: 'Failed to generate ZIP archive' });
      });
      archive.pipe(res);
      for (const file of archiveInventory.files) {
        archive.file(file.absolutePath, { name: file.relativePath });
      }
      await archive.finalize();
      return undefined;
    } catch (error: any) {
      if (!res.headersSent) {
        if (error?.code === 'WORKSPACE_ZIP_LIMIT') {
          return res.status(413).json({
            error: sanitizeError(error.message || 'Workspace ZIP exceeds configured limits.'),
            limits: getWorkspaceArchiveLimits(),
          });
        }
        const response = pathErrorResponse(error);
        return res.status(response.status).json({ error: response.error });
      }
      return undefined;
    }
  });

  router.get('/workspace-file', async (req, res) => {
    try {
      const workspaceQuery = getSingleQueryString(req.query.workspace);
      const pathQuery = getSingleQueryString(req.query.path);
      if (workspaceQuery === null || pathQuery === null) {
        return res.status(400).send('workspace and path must each be a single string.');
      }
      const workspace = workspaceQuery || undefined;
      const targetPath = pathQuery || '';
      if (!targetPath) return res.status(400).send('Path is required');

      const workspaceRoot = await ensureWorkspaceRoot(workspace);
      const resolvedPath = await resolveApprovedWorkspacePath(targetPath, workspaceRoot);
      const stats = await stat(resolvedPath);
      if (!stats.isFile()) return res.status(404).send('File not found');

      res.setHeader('Cache-Control', 'no-cache');
      const fileName = path.basename(resolvedPath).replace(/[\r\n"\\]/g, '_').slice(0, 255) || 'file';
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
      res.sendFile(resolvedPath);
    } catch (error: any) {
      const response = pathErrorResponse(error);
      res.status(response.status).send(response.error);
    }
  });

  router.delete('/api/workspace/item', async (req, res) => {
    try {
      const workspaceQuery = getSingleQueryString(req.query.workspace);
      const pathQuery = getSingleQueryString(req.query.path);
      if (workspaceQuery === null || pathQuery === null) {
        return res.status(400).json({ error: 'workspace and path must each be a single string.' });
      }
      const workspace = workspaceQuery || undefined;
      const targetPath = pathQuery || '';
      if (!targetPath) return res.status(400).json({ error: 'Path is required' });

      const workspaceRoot = await ensureWorkspaceRoot(workspace);
      const resolvedPath = await resolveApprovedWorkspacePath(targetPath, workspaceRoot);
      const stats = await stat(resolvedPath);
      if (stats.isDirectory()) {
        await rm(resolvedPath, { recursive: true, force: true });
      } else {
        await unlink(resolvedPath);
      }

      res.json({ success: true });
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        res.json({ success: true });
      } else {
        const response = pathErrorResponse(error);
        res.status(response.status).json({ error: response.error });
      }
    }
  });

  return router;
}
