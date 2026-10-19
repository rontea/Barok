import { createHash } from 'node:crypto';

/** Node's SHA-256 implementation for Core's host-neutral request-envelope API. */
export function hashSerializedRequestValue(serialized: string): string {
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}
