import { describe, expect, it } from '@jest/globals';
import { normalizePendingUserQuestion } from '../../ui/src/utils/pendingUserQuestion';

describe('pending user question hydration', () => {
  it('normalizes a durable request for the reconnected modal', () => {
    expect(normalizePendingUserQuestion('run-1', {
      requestId: ' question-1 ',
      question: ' Which target should be used? ',
      options: ['Desktop', ' Desktop ', '', 42],
      allowFreeform: false,
      context: ' Choose the layout. ',
    })).toEqual({
      runId: 'run-1',
      requestId: 'question-1',
      question: 'Which target should be used?',
      options: ['Desktop'],
      allowFreeform: false,
      context: 'Choose the layout.',
    });
  });

  it('rejects an incomplete request so it cannot replace a live question', () => {
    expect(normalizePendingUserQuestion('run-1', { requestId: 'question-1' })).toBeNull();
  });

  it('allows freeform answers when no options were persisted', () => {
    expect(normalizePendingUserQuestion('run-1', {
      requestId: 'question-1',
      question: 'What should change?',
      options: [],
      allowFreeform: false,
    })?.allowFreeform).toBe(true);
  });
});
