import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import type { StoredAgentRunEvent } from './sqliteStore.js';

const CODER_THREAD_ARTIFACT_VERSION = 1 as const;
const CODER_THREAD_ARTIFACT_DIRECTORY = join('.react-engine', 'coder-threads');

/**
 * Events that the Coder Chat UI keeps in an assistant thread message.
 * Other harness events remain available through the normal run audit stream
 * and should not be copied into the conversational projection.
 */
export const CODER_THREAD_TIMELINE_EVENT_TYPES = new Set([
  'run_started',
  'console_output',
  'model_target_resolved',
  'reasoning_start',
  'reasoning_delta',
  'reasoning_end',
  'model_response',
  'decision_record',
  'provider_attempt_failed',
  'cooldown_waiting',
  'nvidia_cooldown_retry',
  'retrying',
  'execution_failed',
  'pacing_wait',
  'plan_updated',
  'todo_snapshot',
  'todo_links_updated',
  'workplan_updated',
  'state_transition',
  'recovery_transition',
  'plan_approval_required',
  'plan_approval_resolved',
  'tool_started',
  'tool_result',
  'tool_evidence',
  'file_read',
  'file_changed',
  'command_started',
  'command_output',
  'package_install_started',
  'package_install_result',
  'verification_started',
  'verification_result',
  'user_input_required',
  'user_input_resolved',
  'user_message_queued',
  'user_message_processed',
  'inbox_message_enqueued',
  'inbox_message_claimed',
  'inbox_message_replaced',
  'inbox_message_cancelled',
  'inbox_message_processed',
  'inbox_cleared',
  'inbox_requeued',
  'inbox_claims_released',
  'policy_decision',
  'final',
  'stopped',
  'interrupted',
  'killed',
]);

export interface CoderThreadArtifactTimeline {
  events: unknown[];
  updatedAt: number;
}

export interface CoderThreadArtifact {
  version: typeof CODER_THREAD_ARTIFACT_VERSION;
  threadId: string;
  updatedAt: number;
  timelines: Record<string, CoderThreadArtifactTimeline>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validateArtifactId(threadId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(threadId)) {
    throw new Error('Invalid coder thread ID.');
  }
  return threadId;
}

function artifactPath(projectRoot: string, threadId: string): string {
  return join(projectRoot, CODER_THREAD_ARTIFACT_DIRECTORY, `${validateArtifactId(threadId)}.json`);
}

function eventData(event: StoredAgentRunEvent): unknown {
  if (!isRecord(event.event)) return event.event;
  return Object.prototype.hasOwnProperty.call(event.event, 'data')
    ? event.event.data
    : event.event;
}

/** Converts durable harness envelopes into the UI's event-data shape. */
export function coderTimelineEventsFromRunEvents(events: readonly StoredAgentRunEvent[]): unknown[] {
  return events
    .filter((event) => CODER_THREAD_TIMELINE_EVENT_TYPES.has(event.eventType))
    .map((event) => {
      const data = eventData(event);
      if (isRecord(data)) return { ...data, type: event.eventType };
      return {
        type: event.eventType,
        ...(data === undefined ? {} : { message: data }),
      };
    });
}

export function coderThreadArtifactDirectory(projectRoot = process.cwd()): string {
  return join(projectRoot, CODER_THREAD_ARTIFACT_DIRECTORY);
}

export async function saveCoderThreadArtifact(
  threadId: string,
  timelines: Record<string, CoderThreadArtifactTimeline>,
  projectRoot = process.cwd(),
): Promise<string> {
  const targetPath = artifactPath(projectRoot, threadId);
  await mkdir(coderThreadArtifactDirectory(projectRoot), { recursive: true });
  const artifact: CoderThreadArtifact = {
    version: CODER_THREAD_ARTIFACT_VERSION,
    threadId: validateArtifactId(threadId),
    updatedAt: Date.now(),
    timelines,
  };
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(artifact), 'utf8');
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  return targetPath;
}

export async function loadCoderThreadArtifact(
  threadId: string,
  projectRoot = process.cwd(),
): Promise<CoderThreadArtifact | null> {
  try {
    const parsed = JSON.parse(await readFile(artifactPath(projectRoot, threadId), 'utf8')) as Partial<CoderThreadArtifact>;
    if (parsed.version !== CODER_THREAD_ARTIFACT_VERSION || parsed.threadId !== threadId || !isRecord(parsed.timelines)) {
      return null;
    }
    return {
      version: CODER_THREAD_ARTIFACT_VERSION,
      threadId,
      updatedAt: Number(parsed.updatedAt) || 0,
      timelines: parsed.timelines as Record<string, CoderThreadArtifactTimeline>,
    };
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function deleteCoderThreadArtifact(
  threadId: string,
  projectRoot = process.cwd(),
): Promise<void> {
  await rm(artifactPath(projectRoot, threadId), { force: true });
}

export async function clearCoderThreadArtifacts(projectRoot = process.cwd()): Promise<void> {
  await rm(coderThreadArtifactDirectory(projectRoot), { recursive: true, force: true });
}
