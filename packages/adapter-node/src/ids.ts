import { randomUUID } from 'node:crypto';

/** Create a process-independent RFC 4122 version 4 identifier. */
export function createId(): string {
  return randomUUID();
}
