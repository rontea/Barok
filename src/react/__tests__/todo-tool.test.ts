import { describe, expect, it } from '@jest/globals';
import { createTodoTool } from '../todo-tool.js';
import { advancePlan, type ReactState } from '../state-manager.js';

function createState(): ReactState {
  return {
    task: 'test task',
    workspace: process.cwd(),
    plan: [],
    steps: [],
    current_step: 0,
    max_steps: 10,
    total_pollen_cost: 0,
    budget: 100,
    repairAttempts: 0,
  };
}

describe('harness Todo tool', () => {
  it('lets the agent create and update its own run-scoped todo', async () => {
    const state = createState();
    const updates: string[][] = [];
    const tool = createTodoTool({
      getState: () => state,
      onPlanUpdated: (plan) => updates.push(plan.map((item) => `${item.id}:${item.status}`)),
    });

    await expect(tool.handler({
      operation: 'set',
      items: ['Inspect the relevant files', { id: 'build', step: 'Implement the change' }],
    })).resolves.toMatchObject({ success: true, operation: 'set' });
    expect(state.plan).toEqual([
      expect.objectContaining({ id: 'todo-1', step: 'Inspect the relevant files', status: 'in_progress' }),
      expect.objectContaining({ id: 'build', step: 'Implement the change', status: 'pending' }),
    ]);

    await expect(tool.handler({ operation: 'update', id: 'todo-1', status: 'completed' }))
      .resolves.toMatchObject({ success: true, operation: 'update' });
    expect(state.plan[1].status).toBe('in_progress');
    expect(updates).toHaveLength(2);
  });

  it('does not let a Todo action auto-complete the active item', () => {
    const state = createState();
    state.plan = [{ id: 'one', step: 'Do the work', status: 'in_progress' }];
    const changed = advancePlan(state, {
      thought: 'Maintain the todo',
      action: 'Todo',
      action_input: { operation: 'list' },
      observation: JSON.stringify({ success: true }),
    });

    expect(changed).toBe(false);
    expect(state.plan[0].status).toBe('in_progress');
  });

  it('keeps a list operation read-only and supports clearing the run todo', async () => {
    const state = createState();
    state.plan = [{ id: 'one', step: 'Existing item', status: 'in_progress' }];
    const tool = createTodoTool({ getState: () => state });

    await expect(tool.handler({ operation: 'list' })).resolves.toMatchObject({ changed: false });
    expect(state.plan).toHaveLength(1);
    await expect(tool.handler({ operation: 'clear' })).resolves.toMatchObject({ changed: true });
    expect(state.plan).toEqual([]);
  });
});
