import { describe, expect, it } from '@jest/globals';
import { createHarnessEvent } from '../harnessEvent.js';
import { projectHarnessEvents } from '../harnessProjection.js';

function event(seq: number, type: string, data: unknown) {
  return createHarnessEvent({ runId: 'todo-run', sessionId: 'todo-session', seq, type, data, timestamp: seq });
}

describe('durable todo projection', () => {
  it('replays the latest whole-list snapshot and keeps links separate from status', () => {
    const projection = projectHarnessEvents([
      event(1, 'run_started', { task: 'maintain todos' }),
      event(2, 'todo_snapshot', {
        revision: 4,
        items: [
          { id: 'inspect', content: 'Inspect the source', status: 'completed' },
          { id: 'verify', content: 'Verify the result', status: 'in_progress' },
        ],
      }),
      event(3, 'todo_links_updated', {
        revision: 4,
        links: [{ itemId: 'verify', acceptanceCriteria: ['The check passes'], evidenceIds: ['evidence-7'] }],
        acceptanceCriteria: ['The run has typed evidence'],
        progressCursor: { currentItemId: 'verify', currentStep: 3, phase: 'verify', remainingItemIds: ['verify'] },
      }),
      event(4, 'state', {
        codingState: 'verify',
        current_step: 3,
        plan: [{ id: 'verify', step: 'Verify the result', status: 'in_progress' }],
      }),
      event(5, 'child_status_changed', { childId: 'child-1', status: 'running' }),
    ]);

    expect(projection.todo).toEqual({
      revision: 4,
      items: [
        { id: 'inspect', content: 'Inspect the source', status: 'completed' },
        { id: 'verify', content: 'Verify the result', status: 'in_progress' },
      ],
      links: [{ itemId: 'verify', acceptanceCriteria: ['The check passes'], evidenceIds: ['evidence-7'] }],
      acceptanceCriteria: ['The run has typed evidence'],
      progressCursor: { currentItemId: 'verify', currentStep: 3, phase: 'verify', remainingItemIds: ['verify'] },
      source: { eventId: 'todo-run:3', seq: 3, type: 'todo_links_updated' },
    });
  });

  it('ignores an older snapshot and does not let a legacy plan event overwrite a durable one', () => {
    const projection = projectHarnessEvents([
      event(1, 'todo_snapshot', { revision: 2, items: [{ id: 'new', content: 'New item', status: 'pending' }] }),
      event(2, 'plan_updated', { plan: [{ id: 'legacy', step: 'Legacy item', status: 'completed' }] }),
      event(3, 'todo_snapshot', { revision: 1, items: [{ id: 'old', content: 'Old item', status: 'completed' }] }),
      event(4, 'todo_links_updated', { revision: 2, links: [], acceptanceCriteria: [] }),
    ]);

    expect(projection.todo?.revision).toBe(2);
    expect(projection.todo?.items).toEqual([{ id: 'new', content: 'New item', status: 'pending' }]);
  });

  it('falls back to durable state events for runs created before todo snapshots', () => {
    const projection = projectHarnessEvents([
      event(1, 'plan_updated', { plan: [{ id: 'inspect', step: 'Inspect files', status: 'in_progress' }] }),
      event(2, 'workplan_updated', { workPlan: { acceptanceCriteria: ['A relevant file was inspected'] } }),
      event(3, 'state', { current_step: 2, codingState: 'inspect', plan: [{ id: 'inspect', step: 'Inspect files', status: 'in_progress' }] }),
    ]);

    expect(projection.todo).toMatchObject({
      revision: 1,
      items: [{ id: 'inspect', content: 'Inspect files', status: 'in_progress' }],
      acceptanceCriteria: ['A relevant file was inspected'],
      progressCursor: { currentItemId: 'inspect', currentStep: 2, phase: 'inspect', remainingItemIds: ['inspect'] },
    });
  });

  it('does not create a todo view from process-local activation or live status events', () => {
    const projection = projectHarnessEvents([
      event(1, 'run_started', { task: 'no plan yet' }),
      event(2, 'progress', 'Working'),
      event(3, 'child_status_changed', { childId: 'child-1', status: 'running' }),
    ]);

    expect(projection.todo).toBeUndefined();
  });
});
