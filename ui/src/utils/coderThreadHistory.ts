import type { CoderThreadSummary } from '../components/CoderChatPanel';

export interface MergedCoderThreadHistory {
  threads: CoderThreadSummary[];
  localThreadIdsNeedingSync: string[];
}

/**
 * Reconcile the browser snapshot with SQLite without letting a delayed backend
 * write replace newer messages that are still available in localStorage.
 */
export function mergeCoderThreadHistory(
  localThreads: CoderThreadSummary[],
  backendThreads: CoderThreadSummary[],
): MergedCoderThreadHistory {
  const merged = new Map(localThreads.map((thread) => [thread.id, thread]));
  const localThreadIdsNeedingSync = new Set<string>();

  for (const backendThread of backendThreads) {
    const localThread = merged.get(backendThread.id);
    if (!localThread) {
      merged.set(backendThread.id, backendThread);
      continue;
    }

    // A paginated API list is metadata only. Keep any locally cached message
    // history until the selected thread is hydrated through its detail route.
    if (backendThread.messagesLoaded === false) continue;

    const localUpdatedAt = Number(localThread.updatedAt) || 0;
    const backendUpdatedAt = Number(backendThread.updatedAt) || 0;
    const localMessageCount = Array.isArray(localThread.messages) ? localThread.messages.length : 0;
    const backendMessageCount = Array.isArray(backendThread.messages) ? backendThread.messages.length : 0;
    const backendIsNewer = backendUpdatedAt > localUpdatedAt
      || (backendUpdatedAt === localUpdatedAt && backendMessageCount > localMessageCount);
    const localIsNewer = localUpdatedAt > backendUpdatedAt
      || (localUpdatedAt === backendUpdatedAt && localMessageCount > backendMessageCount);

    if (backendIsNewer) {
      merged.set(backendThread.id, backendThread);
    } else if (localIsNewer) {
      localThreadIdsNeedingSync.add(localThread.id);
    }
  }

  return {
    threads: Array.from(merged.values()),
    localThreadIdsNeedingSync: Array.from(localThreadIdsNeedingSync),
  };
}
