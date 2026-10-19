import { afterEach, describe, expect, it } from '@jest/globals';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pruneStaleServerInstances } from '../serverInstanceRegistry.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('server instance registry cleanup', () => {
  it('removes stale records and preserves records for live PIDs', async () => {
    const directory = mkdtempSync(join(process.cwd(), 'server-instance-registry-test-'));
    temporaryDirectories.push(directory);
    mkdirSync(directory, { recursive: true });
    const stalePath = join(directory, 'server-instance-3500.json');
    const livePath = join(directory, 'server-instance-3501.json');
    writeFileSync(stalePath, JSON.stringify({ pid: 2_000_000_000, port: 3500 }));
    writeFileSync(livePath, JSON.stringify({ pid: process.pid, port: 3501 }));

    const removed = await pruneStaleServerInstances(directory);

    expect(removed).toBe(1);
    expect(existsSync(stalePath)).toBe(false);
    expect(existsSync(livePath)).toBe(true);
  });
});
