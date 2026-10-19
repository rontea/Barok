import { redactPolicyPayload, redactPolicyText } from '@barok/core';
import {
  DURABLE_CONTEXT_SNAPSHOT_VERSION,
  type DurableContextMessage,
  type StoredAgentContextSnapshot,
} from '../persistence/contextSnapshot.js';
import type { ReactCheckpoint } from './checkpoint.js';
import { estimateTextTokens } from '@barok/engine';

const CONTEXT_COMPACTION_VERSION = 'react-checkpoint-v1';
const MAX_CONTEXT_MESSAGES = 160;
const MAX_MESSAGE_CHARS = 24_000;

function compactText(value: string, limit = MAX_MESSAGE_CHARS): string {
  const redacted = redactPolicyText(value).replace(/\s+/g, ' ').trim();
  return redacted.length > limit ? `${redacted.slice(0, limit - 3)}...` : redacted;
}

function message(id: string, role: DurableContextMessage['role'], content: string, eventSeq: number): DurableContextMessage {
  return { id, role, content: compactText(content), sourceEventSeq: eventSeq };
}

function jsonContent(value: unknown): string {
  try {
    return JSON.stringify(redactPolicyPayload(value));
  } catch {
    return String(value);
  }
}

/**
 * Build a durable, observable context projection from a checkpoint. Model
 * reasoning/thought fields are intentionally excluded; the action and tool
 * result are sufficient to reconstruct the execution direction safely.
 */
export function createReactContextSnapshot(
  runId: string,
  checkpoint: ReactCheckpoint,
  eventSeq: number,
): StoredAgentContextSnapshot {
  const state = checkpoint.state;
  const messages: DurableContextMessage[] = [
    message(`${runId}:task`, 'user', state.task, eventSeq),
  ];

  if (state.plan.length > 0) {
    messages.push(message(`${runId}:plan:${state.current_step}`, 'system', `Execution plan:\n${state.plan.map((item) => `- [${item.status}] ${item.step}`).join('\n')}`, eventSeq));
  }
  for (const [index, update] of (state.conversationUpdates || []).entries()) {
    messages.push(message(`${runId}:conversation:${index}`, 'user', update, eventSeq));
  }
  for (const [index, step] of state.steps.entries()) {
    messages.push({
      ...message(`${runId}:step:${index}:action`, 'assistant', jsonContent({ action: step.action, action_input: step.action_input }), eventSeq),
    });
    if (step.observation) {
      messages.push({
        ...message(`${runId}:step:${index}:result`, 'tool', step.observation, eventSeq),
        toolName: step.action,
      });
    }
  }

  const retained = messages.length > MAX_CONTEXT_MESSAGES
    ? [messages[0], ...messages.slice(-MAX_CONTEXT_MESSAGES + 1)]
    : messages;
  const tokenEstimate = retained.reduce((sum, item) => sum + estimateTextTokens(item.content) + 8, 0);
  const evidenceIds = [...new Set((state.toolEvidence || []).map((record) => record.id).filter((id): id is string => typeof id === 'string'))].slice(-100);

  return {
    version: DURABLE_CONTEXT_SNAPSHOT_VERSION,
    runId,
    contextId: `${runId}:react-context`,
    revision: Math.max(0, Number(state.current_step) || 0),
    eventSeq: Math.max(0, eventSeq),
    ...(state.model ? { model: state.model } : {}),
    ...(state.modelContextWindow && state.modelContextWindow > 0 ? { modelContextWindow: state.modelContextWindow } : {}),
    tokenEstimate,
    compactionVersion: CONTEXT_COMPACTION_VERSION,
    messages: retained,
    evidenceIds,
    createdAt: checkpoint.createdAt,
    updatedAt: checkpoint.createdAt,
  };
}
