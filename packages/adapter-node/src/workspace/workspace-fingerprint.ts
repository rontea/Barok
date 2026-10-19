import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type {
  WorkspaceFingerprint,
  WorkspaceFingerprintState,
} from '@barok/engine';

function trackedPaths(state: WorkspaceFingerprintState): string[] {
  const paths = new Set<string>(state.taskAnalysis?.contract?.candidateFiles ?? []);
  for (const step of state.steps) {
    const value = step.action_input?.file_path ?? step.action_input?.path;
    if (typeof value === 'string') paths.add(value);
  }
  return [...paths].filter((value) =>
    value && !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..'),
  );
}

/** Snapshot file metadata and hashes for checkpoint freshness checks. */
export function fingerprintWorkspace(state: WorkspaceFingerprintState): WorkspaceFingerprint {
  const entries: WorkspaceFingerprint['entries'] = [];
  for (const relativePath of trackedPaths(state)) {
    try {
      const absolutePath = path.resolve(state.workspace, relativePath);
      const stats = statSync(absolutePath);
      const contentHash = stats.isFile()
        ? createHash('sha256').update(readFileSync(absolutePath)).digest('hex')
        : `non-file:${stats.mode}`;
      entries.push({
        path: relativePath.replace(/\\/g, '/'),
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        contentHash,
      });
    } catch {
      entries.push({
        path: relativePath.replace(/\\/g, '/'),
        size: -1,
        mtimeMs: -1,
        contentHash: 'missing',
      });
    }
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return { entries, digest: createHash('sha256').update(JSON.stringify(entries)).digest('hex') };
}
