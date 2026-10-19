import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, describe, expect, it } from '@jest/globals';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildTree, scanWorkspaceArchive, createRouter as createWorkspaceRouter } from '../workspace.js';

const temporaryDirectories: string[] = [];
const servers: Server[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function startWorkspaceServer(workspace: string): Promise<string> {
  const app = express();
  app.use(createWorkspaceRouter({ restorePointDirectory: path.join(workspace, '.restore-points') }));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Workspace test server did not expose a TCP address.');
  return `http://127.0.0.1:${address.port}`;
}

describe('workspace traversal and archive limits', () => {
  const originalWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const originalLegacyWorkspace = process.env.REACT_TARGET_FOLDER;
  const originalAllowedRoots = process.env.WORKSPACE_ALLOWED_ROOTS;
  const originalZipMaxBytes = process.env.WORKSPACE_ZIP_MAX_BYTES;
  const originalZipMaxFiles = process.env.WORKSPACE_ZIP_MAX_FILES;
  const originalZipMaxFileBytes = process.env.WORKSPACE_ZIP_MAX_FILE_BYTES;

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
    if (originalWorkspaceRoot === undefined) delete process.env.WORKSPACE_ROOT; else process.env.WORKSPACE_ROOT = originalWorkspaceRoot;
    if (originalLegacyWorkspace === undefined) delete process.env.REACT_TARGET_FOLDER; else process.env.REACT_TARGET_FOLDER = originalLegacyWorkspace;
    if (originalAllowedRoots === undefined) delete process.env.WORKSPACE_ALLOWED_ROOTS; else process.env.WORKSPACE_ALLOWED_ROOTS = originalAllowedRoots;
    if (originalZipMaxBytes === undefined) delete process.env.WORKSPACE_ZIP_MAX_BYTES; else process.env.WORKSPACE_ZIP_MAX_BYTES = originalZipMaxBytes;
    if (originalZipMaxFiles === undefined) delete process.env.WORKSPACE_ZIP_MAX_FILES; else process.env.WORKSPACE_ZIP_MAX_FILES = originalZipMaxFiles;
    if (originalZipMaxFileBytes === undefined) delete process.env.WORKSPACE_ZIP_MAX_FILE_BYTES; else process.env.WORKSPACE_ZIP_MAX_FILE_BYTES = originalZipMaxFileBytes;
  });

  it('reports when a workspace tree reaches its depth limit', async () => {
    const workspace = temporaryDirectory('workspace-tree-depth-');
    mkdirSync(path.join(workspace, 'a', 'b', 'c'), { recursive: true });
    writeFileSync(path.join(workspace, 'top.txt'), 'top');
    writeFileSync(path.join(workspace, 'a', 'b', 'c', 'deep.txt'), 'deep');

    const result = await buildTree(workspace, workspace, 2);

    expect(result.truncated).toBe(true);
    expect(result.tree.find((node) => node.name === 'top.txt')).toBeDefined();
    expect(result.tree.find((node) => node.name === 'a').children[0].children).toEqual([]);
  });

  it('skips files above the per-file cap and rejects inventories over total size or count', async () => {
    const workspace = temporaryDirectory('workspace-zip-inventory-');
    mkdirSync(path.join(workspace, 'node_modules'), { recursive: true });
    writeFileSync(path.join(workspace, 'small.txt'), '123');
    writeFileSync(path.join(workspace, 'large.bin'), '12345');
    writeFileSync(path.join(workspace, 'node_modules', 'ignored.txt'), 'ignored');

    const inventory = await scanWorkspaceArchive(workspace, { maxBytes: 10, maxFiles: 2, maxFileBytes: 4 });
    expect(inventory).toMatchObject({ totalBytes: 3, skippedLargeFiles: 1 });
    expect(inventory.files.map((file) => file.relativePath)).toEqual(['small.txt']);
    await expect(scanWorkspaceArchive(workspace, { maxBytes: 2, maxFiles: 2, maxFileBytes: 4 }))
      .rejects.toMatchObject({ code: 'WORKSPACE_ZIP_LIMIT', status: 413 });

    writeFileSync(path.join(workspace, 'second.txt'), 'two');
    await expect(scanWorkspaceArchive(workspace, { maxBytes: 10, maxFiles: 1, maxFileBytes: 4 }))
      .rejects.toMatchObject({ code: 'WORKSPACE_ZIP_LIMIT', status: 413 });
  });

  it('rejects an oversized ZIP before starting the archive response', async () => {
    const parent = temporaryDirectory('workspace-zip-route-');
    const workspace = path.join(parent, 'workspace');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(path.join(workspace, 'one.txt'), 'one');
    writeFileSync(path.join(workspace, 'two.txt'), 'two');
    process.env.WORKSPACE_ROOT = workspace;
    delete process.env.REACT_TARGET_FOLDER;
    delete process.env.WORKSPACE_ALLOWED_ROOTS;
    process.env.WORKSPACE_ZIP_MAX_FILES = '1';
    const baseUrl = await startWorkspaceServer(workspace);

    const response = await fetch(`${baseUrl}/api/workspace/download-zip`);
    const payload = await response.json();

    expect(response.status).toBe(413);
    expect(payload.limits.maxFiles).toBe(1);
    expect(existsSync(path.join(workspace, 'one.txt'))).toBe(true);
  });

  it('keeps workspace-file Content-Disposition limited to a sanitized basename', async () => {
    const parent = temporaryDirectory('workspace-file-header-');
    const workspace = path.join(parent, 'workspace');
    mkdirSync(path.join(workspace, 'private', 'nested'), { recursive: true });
    writeFileSync(path.join(workspace, 'private', 'nested', 'preview.html'), '<h1>ok</h1>');
    process.env.WORKSPACE_ROOT = workspace;
    delete process.env.REACT_TARGET_FOLDER;
    delete process.env.WORKSPACE_ALLOWED_ROOTS;
    const baseUrl = await startWorkspaceServer(workspace);

    const response = await fetch(`${baseUrl}/workspace-file?path=${encodeURIComponent('private/nested/preview.html')}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('inline; filename="preview.html"');
    expect(await response.text()).toBe('<h1>ok</h1>');
  });
});
