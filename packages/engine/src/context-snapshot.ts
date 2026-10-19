export const DURABLE_CONTEXT_SNAPSHOT_VERSION = 1 as const;

export type DurableContextMessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Observable model context only. This deliberately has no thought/reasoning
 * field so a durable snapshot cannot become a private chain-of-thought store.
 */
export interface DurableContextMessage {
  id: string;
  role: DurableContextMessageRole;
  content: string;
  sourceEventSeq?: number;
  toolName?: string;
  toolCallId?: string;
}

export interface StoredAgentContextSnapshot {
  version: typeof DURABLE_CONTEXT_SNAPSHOT_VERSION;
  runId: string;
  contextId: string;
  revision: number;
  eventSeq: number;
  model?: string;
  modelContextWindow?: number;
  tokenEstimate: number;
  compactionVersion: string;
  messages: DurableContextMessage[];
  evidenceIds: string[];
  createdAt: number;
  updatedAt: number;
}

const MESSAGE_ROLES = new Set<DurableContextMessageRole>(['system', 'user', 'assistant', 'tool']);

export function validateAgentContextSnapshot(value: unknown): value is StoredAgentContextSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredAgentContextSnapshot>;
  if (
    candidate.version !== DURABLE_CONTEXT_SNAPSHOT_VERSION ||
    typeof candidate.runId !== 'string' ||
    typeof candidate.contextId !== 'string' ||
    !Number.isInteger(candidate.revision) || Number(candidate.revision) < 0 ||
    !Number.isInteger(candidate.eventSeq) || Number(candidate.eventSeq) < 0 ||
    !Number.isFinite(candidate.tokenEstimate) || (candidate.tokenEstimate as number) < 0 ||
    typeof candidate.compactionVersion !== 'string' ||
    !Array.isArray(candidate.messages) ||
    !Array.isArray(candidate.evidenceIds) ||
    !Number.isFinite(candidate.createdAt) ||
    !Number.isFinite(candidate.updatedAt)
  ) return false;
  if (candidate.model !== undefined && typeof candidate.model !== 'string') return false;
  if (candidate.modelContextWindow !== undefined && (!Number.isInteger(candidate.modelContextWindow) || candidate.modelContextWindow <= 0)) return false;
  if (!candidate.messages.every((message) => Boolean(
    message && typeof message === 'object' &&
    typeof message.id === 'string' && message.id.length > 0 &&
    MESSAGE_ROLES.has(message.role as DurableContextMessageRole) &&
    typeof message.content === 'string' &&
    (message.sourceEventSeq === undefined || (Number.isInteger(message.sourceEventSeq) && message.sourceEventSeq >= 0)) &&
    (message.toolName === undefined || typeof message.toolName === 'string') &&
    (message.toolCallId === undefined || typeof message.toolCallId === 'string')
  ))) return false;
  return candidate.evidenceIds.every((id) => typeof id === 'string');
}
