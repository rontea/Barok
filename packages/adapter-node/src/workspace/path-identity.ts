import path from 'node:path';

/** Normalize an absolute path for stable, case-insensitive run identity checks. */
export function normalizePathIdentity(value: string): string {
  return path.resolve(value)
    .replace(/[\\/]+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}
