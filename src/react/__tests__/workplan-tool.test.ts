import { describe, expect, it } from '@jest/globals';
import { createWorkPlanTool } from '../workplan-tool.js';
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

describe('harness WorkPlan tool', () => {
  it('lets the agent create and update optional strategic context', async () => {
    const state = createState();
    const updates: Array<string | undefined> = [];
    const tool = createWorkPlanTool({
      getState: () => state,
      onWorkPlanUpdated: (workPlan) => updates.push(workPlan?.objective),
    });

    await expect(tool.handler({
      operation: 'set',
      objective: 'Deliver the requested change',
      scope: ['src/react/engine.ts'],
      steps: ['Inspect the current flow', 'Implement and verify the change'],
      verification: ['Run the focused test suite'],
    })).resolves.toMatchObject({ success: true, operation: 'set' });
    expect(state.workPlan).toEqual(expect.objectContaining({
      objective: 'Deliver the requested change',
      status: 'active',
      steps: ['Inspect the current flow', 'Implement and verify the change'],
    }));

    await expect(tool.handler({ operation: 'update', status: 'completed' }))
      .resolves.toMatchObject({ success: true, operation: 'update' });
    expect(state.workPlan?.status).toBe('completed');
    expect(updates).toEqual(['Deliver the requested change', 'Deliver the requested change']);
  });

  it('does not let WorkPlan maintenance auto-complete a todo item', () => {
    const state = createState();
    state.plan = [{ id: 'one', step: 'Do the work', status: 'in_progress' }];
    const changed = advancePlan(state, {
      thought: 'Record the strategy',
      action: 'WorkPlan',
      action_input: { operation: 'list' },
      observation: JSON.stringify({ success: true }),
    });

    expect(changed).toBe(false);
    expect(state.plan[0].status).toBe('in_progress');
  });

  it('keeps list read-only and supports clearing the run workplan', async () => {
    const state = createState();
    const tool = createWorkPlanTool({ getState: () => state });
    await tool.handler({ operation: 'set', objective: 'Keep context available' });

    await expect(tool.handler({ operation: 'list' })).resolves.toMatchObject({ changed: false });
    expect(state.workPlan?.objective).toBe('Keep context available');
    await expect(tool.handler({ operation: 'clear' })).resolves.toMatchObject({ changed: true });
    expect(state.workPlan).toBeUndefined();
  });
});
