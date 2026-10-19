import { describe, expect, it } from '@jest/globals';
import { mergeCoderThreadHistory } from '../../ui/src/utils/coderThreadHistory';
import type { CoderThreadSummary } from '../../ui/src/components/CoderChatPanel';

const thread = (id: string, updatedAt: number, messageCount: number): CoderThreadSummary => ({
  id,
  title: `Thread ${id}`,
  createdAt: 1,
  updatedAt,
  messages: Array.from({ length: messageCount }, (_value, index) => ({
    id: `${id}-message-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${index}`,
    createdAt: index + 1,
  })),
});

describe('Coder Chat thread history hydration', () => {
  it('keeps a newer local thread and marks it for SQLite synchronization', () => {
    const local = thread('shared', 200, 4);
    const backend = thread('shared', 100, 2);

    const result = mergeCoderThreadHistory([local], [backend]);

    expect(result.threads).toEqual([local]);
    expect(result.localThreadIdsNeedingSync).toEqual(['shared']);
  });

  it('uses a newer backend thread and retains browser-only threads', () => {
    const localShared = thread('shared', 100, 2);
    const localOnly = thread('local-only', 150, 1);
    const backendShared = thread('shared', 200, 5);

    const result = mergeCoderThreadHistory([localShared, localOnly], [backendShared]);

    expect(result.threads).toEqual([backendShared, localOnly]);
    expect(result.localThreadIdsNeedingSync).toEqual([]);
  });

  it('preserves the more complete copy when timestamps are equal', () => {
    const local = thread('shared', 200, 4);
    const backend = thread('shared', 200, 3);

    const result = mergeCoderThreadHistory([local], [backend]);

    expect(result.threads[0].messages).toHaveLength(4);
    expect(result.localThreadIdsNeedingSync).toEqual(['shared']);
  });

  it('does not replace cached messages with a metadata-only API summary', () => {
    const local = thread('shared', 200, 4);
    const summary = { ...thread('shared', 300, 0), messageCount: 12, messagesLoaded: false };

    const result = mergeCoderThreadHistory([local], [summary]);

    expect(result.threads).toEqual([local]);
    expect(result.localThreadIdsNeedingSync).toEqual([]);
  });

  it('adds backend-only summaries as unloaded thread shells', () => {
    const summary = { ...thread('backend-only', 300, 0), messageCount: 12, messagesLoaded: false };

    const result = mergeCoderThreadHistory([], [summary]);

    expect(result.threads).toEqual([summary]);
    expect(result.threads[0].messages).toEqual([]);
  });
});
