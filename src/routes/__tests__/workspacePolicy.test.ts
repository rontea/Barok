import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, describe, expect, it } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  createWorkspacePolicyMiddleware,
  ensureWorkspaceRoot,
  getApprovedWorkspaceRoots,
  resolveApprovedWorkspacePath,
  WorkspacePolicyError,
} from '../_shared.js';
import { PathValidationError } from '../../tools/pathValidator.js';

const servers: Server[] = [];

describe('workspace approval policy', () => {
  const originalWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const originalLegacyWorkspace = process.env.REACT_TARGET_FOLDER;
  const originalAllowedRoots = process.env.WORKSPACE_ALLOWED_ROOTS;
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
    if (originalWorkspaceRoot === undefined) delete process.env.WORKSPACE_ROOT; else process.env.WORKSPACE_ROOT = originalWorkspaceRoot;
    if (originalLegacyWorkspace === undefined) delete process.env.REACT_TARGET_FOLDER; else process.env.REACT_TARGET_FOLDER = originalLegacyWorkspace;
    if (originalAllowedRoots === undefined) delete process.env.WORKSPACE_ALLOWED_ROOTS; else process.env.WORKSPACE_ALLOWED_ROOTS = originalAllowedRoots;
  });

  it('allows only configured exact roots and rejects before creating an outside directory', async () => {
    const base = mkdtempSync(join(process.cwd(), 'workspace-policy-test-'));
    temporaryRoots.push(base);
    const defaultRoot = join(base, 'default');
    const registeredRoot = join(base, 'registered');
    const rejectedRoot = join(base, 'rejected');
    mkdirSync(defaultRoot, { recursive: true });
    mkdirSync(registeredRoot, { recursive: true });
    process.env.WORKSPACE_ROOT = defaultRoot;
    delete process.env.REACT_TARGET_FOLDER;
    process.env.WORKSPACE_ALLOWED_ROOTS = registeredRoot;

    await expect(ensureWorkspaceRoot(defaultRoot)).resolves.toBe(realpathSync(defaultRoot));
    await expect(ensureWorkspaceRoot(registeredRoot)).resolves.toBe(realpathSync(registeredRoot));
    await expect(ensureWorkspaceRoot(rejectedRoot)).rejects.toBeInstanceOf(WorkspacePolicyError);
    expect(existsSync(rejectedRoot)).toBe(false);
    await expect(getApprovedWorkspaceRoots()).resolves.toEqual(
      expect.arrayContaining([realpathSync(defaultRoot), realpathSync(registeredRoot)]),
    );
  });

  it('rejects a symlinked workspace that resolves outside the approved root', async () => {
    const base = mkdtempSync(join(process.cwd(), 'workspace-policy-link-test-'));
    temporaryRoots.push(base);
    const approvedRoot = join(base, 'approved');
    const outsideRoot = join(base, 'outside');
    const escapeLink = join(approvedRoot, 'linked-outside');
    mkdirSync(approvedRoot, { recursive: true });
    mkdirSync(outsideRoot, { recursive: true });
    symlinkSync(outsideRoot, escapeLink, process.platform === 'win32' ? 'junction' : 'dir');
    process.env.WORKSPACE_ROOT = approvedRoot;
    delete process.env.REACT_TARGET_FOLDER;
    delete process.env.WORKSPACE_ALLOWED_ROOTS;

    await expect(ensureWorkspaceRoot(escapeLink)).rejects.toBeInstanceOf(WorkspacePolicyError);
  });

  it('rejects a symlinked file target that resolves outside the approved workspace', async () => {
    const base = mkdtempSync(join(process.cwd(), 'workspace-policy-file-link-test-'));
    temporaryRoots.push(base);
    const approvedRoot = join(base, 'approved');
    const outsideRoot = join(base, 'outside');
    const escapeLink = join(approvedRoot, 'linked-files');
    mkdirSync(approvedRoot, { recursive: true });
    mkdirSync(outsideRoot, { recursive: true });
    writeFileSync(join(outsideRoot, 'file.txt'), 'outside', 'utf8');
    symlinkSync(outsideRoot, escapeLink, process.platform === 'win32' ? 'junction' : 'dir');
    process.env.WORKSPACE_ROOT = approvedRoot;
    delete process.env.REACT_TARGET_FOLDER;
    delete process.env.WORKSPACE_ALLOWED_ROOTS;

    const caughtError = await resolveApprovedWorkspacePath('linked-files/file.txt', approvedRoot).catch((e) => e);
    expect(caughtError instanceof WorkspacePolicyError || caughtError instanceof PathValidationError).toBe(true);
  });

  it('enforces the policy at the HTTP boundary and normalizes accepted workspaces', async () => {
    const base = mkdtempSync(join(process.cwd(), 'workspace-policy-http-test-'));
    temporaryRoots.push(base);
    const approvedRoot = join(base, 'approved');
    const rejectedRoot = join(base, 'rejected');
    mkdirSync(approvedRoot, { recursive: true });
    process.env.WORKSPACE_ROOT = approvedRoot;
    delete process.env.REACT_TARGET_FOLDER;
    delete process.env.WORKSPACE_ALLOWED_ROOTS;

    const app = express();
    app.use(express.json());
    app.use(createWorkspacePolicyMiddleware());
    app.post('/workspace', (req, res) => res.json({ workspace: req.body.workspace }));
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP address.');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const rejected = await fetch(`${baseUrl}/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace: rejectedRoot }),
    });
    const accepted = await fetch(`${baseUrl}/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace: approvedRoot }),
    });

    expect(rejected.status).toBe(403);
    expect(existsSync(rejectedRoot)).toBe(false);
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toEqual({ workspace: realpathSync(approvedRoot) });
  });
});
