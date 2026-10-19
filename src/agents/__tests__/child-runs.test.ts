import { describe, expect, it } from '@jest/globals';
import {
  BoundedWorkflowRunner,
  createChildRunRecord,
  normalizeChildBudget,
  normalizeChildReport,
} from '../child-runs.js';

describe('child-run protocol', () => {
  it('clamps child budgets to the parent budget', () => {
    const budget = normalizeChildBudget(
      { maxDepth: 10, maxLlmRequests: 100, maxToolCalls: 1000, timeoutMs: 999_999 },
      { maxDepth: 2, maxLlmRequests: 8, maxToolCalls: 40, timeoutMs: 10_000 },
    );
    expect(budget).toEqual(expect.objectContaining({
      maxDepth: 2,
      maxLlmRequests: 8,
      maxToolCalls: 40,
      timeoutMs: 10_000,
    }));
  });

  it('creates lineage records and derives evidence-oriented reports', () => {
    const record = createChildRunRecord({
      childId: 'child-1',
      task: 'implement the change',
      role: 'coder',
      capabilities: { pack: 'delegated-child', approvalMode: 'ask' },
    }, { runId: 'parent-1', sessionId: 'session-1' });
    expect(record).toEqual(expect.objectContaining({
      childId: 'child-1',
      parentRunId: 'parent-1',
      parentSessionId: 'session-1',
      depth: 1,
    }));

    const report = normalizeChildReport('child-1', {
      success: true,
      steps: [
        { action: 'Write', action_input: { file_path: 'src/example.ts' }, observation: '{"success":true}' },
        { action: 'Test', action_input: { command: 'npm test' }, observation: '{"success":true,"status":"passed"}' },
      ],
    });
    expect(report.success).toBe(true);
    expect(report.changedFiles).toEqual(['src/example.ts']);
    expect(report.checks).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'passed' })]));
  });

  it('runs independent workflow steps in bounded batches and blocks failed dependents', async () => {
    const started: string[] = [];
    const runner = new BoundedWorkflowRunner({ maxConcurrency: 2 });
    const result = await runner.run({
      id: 'workflow-1',
      steps: [
        { id: 'a', child: { task: 'a', role: 'research' } },
        { id: 'b', child: { task: 'b', role: 'research' } },
        { id: 'c', child: { task: 'c', role: 'integrator' }, dependencies: ['a'] },
      ],
    }, async (step) => {
      started.push(step.id);
      return {
        protocolVersion: 1,
        childId: step.id,
        success: step.id !== 'a',
        changedFiles: [],
        checks: [],
        blockers: step.id === 'a' ? ['failed'] : [],
        evidenceRefs: [],
        createdAt: Date.now(),
      };
    });

    expect(started).toEqual(['a', 'b']);
    expect(result.status).toBe('failed');
    expect(result.steps.find((step) => step.stepId === 'c')?.status).toBe('blocked');
  });
});
