import { readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

/** Remove stale per-port and legacy server instance records. */
export async function pruneStaleServerInstances(
  directory: string,
  isAlive: (pid: number) => boolean = isPidAlive,
): Promise<number> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return 0;
    throw error;
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/^server-instance(?:-\d+)?\.json$/i.test(entry.name)) continue;
    const recordPath = path.join(directory, entry.name);
    let pid: number | undefined;
    try {
      const record = JSON.parse(await readFile(recordPath, 'utf8')) as { pid?: unknown };
      if (typeof record.pid === 'number' && Number.isInteger(record.pid) && record.pid > 0) pid = record.pid;
    } catch {
      // A malformed registry record cannot describe a live server instance.
    }
    if (pid !== undefined && isAlive(pid)) continue;
    await unlink(recordPath);
    removed += 1;
  }
  return removed;
}
