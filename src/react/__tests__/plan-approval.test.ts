import { describe, expect, it } from '@jest/globals';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { SQLiteAppStore } from '../../persistence/sqliteStore.js';
import { createReactCheckpoint } from '../checkpoint.js';
import {
  createPlanApprovalState,
  normalizeApprovedPlan,
  resolvePlanApproval,
  shouldRequirePlanApproval,
} from '../plan-approval.js';
import { ServerRunManager } from '../run-manager.js';

const analysis = {
  approvalPolicy: 'ask',
  taskKind: 'new_feature',
  riskLevel: 'medium',
  affectedFiles: [
    { path: 'src/a.ts', intent: 'modify', reason: 'feature', mustReadBeforeEdit: true },
    { path: 'src/b.ts', intent: 'modify', reason: 'feature', mustReadBeforeEdit: true },
  ],
  requiredInspections: ['Read src/a.ts'],
  verificationPlan: ['npm run test:unit'],
  expectedChangeIntent: 'modify',
} as any;

describe('plan approval control', () => {
  it('requires approval for ask-mode mutation tasks', () => {
    expect(shouldRequirePlanApproval(analysis)).toBe(true);
    expect(shouldRequirePlanApproval({ ...analysis, approvalPolicy: 'full_access' })).toBe(false);
  });

  it('pauses every normal mutation before the first tool action', () => {
    const singleFileFix = {
      ...analysis,
      taskKind: 'bug_fix',
      riskLevel: 'medium',
      affectedFiles: [analysis.affectedFiles[0]],
    } as any;

    expect(shouldRequirePlanApproval(singleFileFix)).toBe(true);
    expect(shouldRequirePlanApproval({
      ...singleFileFix,
      expectedChangeIntent: 'read_only',
    })).toBe(false);
    expect(shouldRequirePlanApproval({
      ...singleFileFix,
      taskKind: 'continuation',
    })).toBe(false);
  });

  it('explains what each TODO step is for', () => {
    const pending = createPlanApprovalState(analysis);
    expect(pending.proposedPlan.map((item) => item.step).join('\n')).toEqual(expect.stringContaining('understand the current state'));
    expect(pending.proposedPlan.map((item) => item.step).join('\n')).toEqual(expect.stringContaining('keep the edit focused'));
    expect(pending.proposedPlan.map((item) => item.step).join('\n')).toEqual(expect.stringContaining('catch regressions'));
  });

  it('supports edit then approve without losing the approved scope', () => {
    const pending = createPlanApprovalState(analysis, 10);
    const edited = resolvePlanApproval(pending, 'edit', [{ step: 'Inspect both files' }], 'Simplified plan', 20);
    expect(edited.status).toBe('pending');
    const approved = resolvePlanApproval(edited, 'approve', undefined, undefined, 30);
    expect(approved).toMatchObject({ status: 'approved', approvedPlan: [{ step: 'Inspect both files', status: 'pending' }] });
    expect(approved.scope.files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('normalizes edited plans and falls back when the payload is empty', () => {
    const fallback = [{ step: 'Keep this', status: 'pending' as const }];
    expect(normalizeApprovedPlan([{ step: 'One' }, 'Two'], fallback)).toEqual([
      { step: 'One', status: 'pending' }, { step: 'Two', status: 'pending' },
    ]);
    expect(normalizeApprovedPlan([], fallback)).toEqual(fallback);
  });

  it('persists an approval decision at the checkpoint boundary', async () => {
    const store = new SQLiteAppStore(path.join(mkdtempSync(path.join(tmpdir(), 'react-plan-approval-')), 'runs.sqlite'));
    const manager = new ServerRunManager(store);
    const run = manager.startRun({ kind: 'coder', task: 'complex feature' }, async () => ({ success: false, steps: [], stepCount: 0, pollenCost: 0 }));
    const planApproval = createPlanApprovalState(analysis, 10);
    const state = {
      task: run.task,
      workspace: process.cwd(),
      plan: planApproval.proposedPlan,
      steps: [],
      current_step: 0,
      max_steps: 10,
      total_pollen_cost: 0,
      budget: 100,
      repairAttempts: 0,
      codingState: 'awaiting_plan_approval',
      planApproval,
    } as any;
    manager.updateRunMetadata(run.id, { checkpoint: createReactCheckpoint(state) });

    const result = manager.decidePlanApproval(run.id, { decision: 'approve' });
    expect(result.ok).toBe(true);
    expect(manager.getCheckpoint(run.id)?.state).toMatchObject({
      codingState: 'inspect',
      planApproval: { status: 'approved' },
    });
    expect(manager.getRun(run.id)?.metadata?.planApproval).toMatchObject({ status: 'approved' });
  });
});
