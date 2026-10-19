import { describe, expect, it } from '@jest/globals';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createRestorePoint,
  DEFAULT_RESTORE_POINT_LIMITS,
  listRestorePoints,
  restoreRestorePoint,
  RestorePointError,
} from '../restorePoints.js';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'react-engine-restore-'));
  const workspace = path.join(root, 'workspace');
  const storage = path.join(root, 'storage');
  await mkdir(workspace, { recursive: true });
  await mkdir(storage, { recursive: true });
  return { root, workspace, storage };
}

describe('workspace restore points', () => {
  it('snapshots and restores non-Git workspace files with a recoverable rollback point', async () => {
    const { root, workspace, storage } = await fixture();
    try {
      await mkdir(path.join(workspace, 'src'), { recursive: true });
      await writeFile(path.join(workspace, 'src', 'app.ts'), 'original\n', 'utf8');
      const point = await createRestorePoint(workspace, storage, { label: 'Before edit' });

      await writeFile(path.join(workspace, 'src', 'app.ts'), 'changed\n', 'utf8');
      await writeFile(path.join(workspace, 'stale.txt'), 'remove me\n', 'utf8');
      const result = await restoreRestorePoint(storage, workspace, point.id);

      expect(await readFile(path.join(workspace, 'src', 'app.ts'), 'utf8')).toBe('original\n');
      await expect(readFile(path.join(workspace, 'stale.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect(result.restored.id).toBe(point.id);
      expect(result.rollback.source).toBe('pre-restore');
      expect(result.deletedFiles).toBe(1);
      expect((await listRestorePoints(storage, workspace)).map((item) => item.source)).toEqual(['pre-restore', 'manual']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('enforces file and aggregate limits and supports cancellation', async () => {
    const { root, workspace, storage } = await fixture();
    try {
      await writeFile(path.join(workspace, 'large.txt'), '1234567890', 'utf8');
      await expect(createRestorePoint(workspace, storage, { maxFileBytes: 4 })).rejects.toMatchObject<RestorePointError>({ code: 'limit' });
      const controller = new AbortController();
      controller.abort();
      await expect(createRestorePoint(workspace, storage, { signal: controller.signal })).rejects.toMatchObject<RestorePointError>({ code: 'cancelled' });
      expect(DEFAULT_RESTORE_POINT_LIMITS.maxFiles).toBe(50_000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects tampered manifest paths before reading outside the snapshot', async () => {
    const { root, workspace, storage } = await fixture();
    try {
      await writeFile(path.join(workspace, 'safe.txt'), 'safe\n', 'utf8');
      const point = await createRestorePoint(workspace, storage);
      const manifestPath = path.join(storage, point.id, 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { files: Array<{ path: string }> };
      manifest.files[0].path = '../outside.txt';
      await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
      await expect(restoreRestorePoint(storage, workspace, point.id)).rejects.toThrow(/Invalid path|escapes workspace/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
