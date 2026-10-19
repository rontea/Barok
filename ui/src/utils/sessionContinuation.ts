export interface SessionContinuationRun {
  id: string;
  threadId?: string;
  status: 'running' | 'waiting_for_user' | 'waiting_for_provider' | 'completed' | 'failed' | 'stopped' | 'interrupted' | 'killed';
  createdAt?: number;
  updatedAt?: number;
  metadata?: { continuationAvailable?: boolean };
}

interface SessionMessageWithRunId {
  runId?: string;
}

/**
 * Select only the newest resumable run belonging to the open thread. A new
 * thread must never inherit a run from another thread, and a terminal or
 * superseding run must prevent an older interrupted task from resurfacing.
 */
export function selectSessionContinuationRun<T extends SessionContinuationRun>(
  runs: T[],
  activeThreadId: string | null | undefined,
  messages: SessionMessageWithRunId[]
): T | undefined {
  if (!activeThreadId) return undefined;

  const isResumable = (run: T) =>
    run.status === 'running' || run.status === 'waiting_for_user' || run.status === 'waiting_for_provider' || run.status === 'interrupted' || run.status === 'killed' || run.status === 'failed' || run.status === 'stopped' ||
    (run.status === 'completed' && run.metadata?.continuationAvailable === true);
  const newestFirst = (left: T, right: T) =>
    (right.createdAt || right.updatedAt || 0) - (left.createdAt || left.updatedAt || 0);

  // Thread messages are the strongest lineage signal. If the latest linked
  // run is terminal or no longer returned by the resumable-run endpoint, do
  // not fall back to an older run from the same conversation.
  const latestMessageRunId = [...messages].reverse().find((message) => message.runId)?.runId;
  if (latestMessageRunId) {
    const messageRun = runs.find((run) => run.id === latestMessageRunId);
    if (!messageRun || !isResumable(messageRun)) return undefined;
    if (messageRun.threadId && messageRun.threadId !== activeThreadId) return undefined;
    return messageRun;
  }

  const latestThreadRun = runs
    .filter((run) => run.threadId === activeThreadId)
    .sort(newestFirst)[0];

  return latestThreadRun && isResumable(latestThreadRun) ? latestThreadRun : undefined;
}
