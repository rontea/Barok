import { describe, expect, it } from '@jest/globals';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { SQLiteAppStore } from '../../persistence/sqliteStore.js';
import { ServerRunManager } from '../run-manager.js';

function createStore(): SQLiteAppStore {
  const directory = mkdtempSync(path.join(tmpdir(), 'child-run-manager-'));
  return new SQLiteAppStore(path.join(directory, 'runs.sqlite'));
}

async function waitForChildReport(manager: ServerRunManager, childId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const report = manager.getChildReport(childId);
    if (report) return report;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for child report.');
}

describe('ServerRunManager child runs', () => {
  it('persists child lifecycle, report, and parent lineage', async () => {
    const manager = new ServerRunManager(createStore());
    const parent = manager.startRun(
      { kind: 'react', task: 'coordinate work', threadId: 'session-1' },
      async () => ({ success: true, steps: [], stepCount: 0, pollenCost: 0 }),
    );
    const prepared = manager.prepareChildRun(parent.id, {
      childId: 'child-report-1',
      task: 'inspect the change',
      role: 'reviewer',
      capabilities: { pack: 'verification-only', approvalMode: 'read_only' },
      budget: { maxLlmRequests: 3, maxToolCalls: 5 },
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const child = manager.startRun({
      id: prepared.record.childId,
      kind: 'agent',
      task: prepared.record.role,
      workspace: prepared.record.workspace,
      model: prepared.record.model,
      metadata: prepared.metadata,
    }, async () => ({
      success: true,
      changedFiles: ['src/reviewed.ts'],
      steps: [{ action: 'Test', action_input: {}, observation: '{"success":true,"status":"passed"}' }],
      stepCount: 1,
      pollenCost: 0,
    }));
    expect(manager.registerChildRun(parent.id, child.id)).not.toBeNull();
    await manager.waitForRun(child.id);
    const report = await waitForChildReport(manager, child.id);

    expect(report).toEqual(expect.objectContaining({ childId: child.id, success: true, changedFiles: ['src/reviewed.ts'] }));
    expect(manager.listChildRuns(parent.id)).toEqual([
      expect.objectContaining({ childId: child.id, parentRunId: parent.id, status: 'completed', report }),
    ]);
    expect(manager.listEvents(parent.id).map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'child_created', 'child_started', 'child_report', 'child_terminal',
    ]));
    expect(manager.listEvents(child.id).map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'child_created', 'child_started', 'child_report', 'child_terminal',
    ]));
  });

  it('propagates parent cancellation to an active child', async () => {
    const manager = new ServerRunManager(createStore());
    let releaseParent: (() => void) | undefined;
    const parent = manager.startRun(
      { kind: 'react', task: 'parent task' },
      async ({ signal }) => new Promise((resolve) => {
        releaseParent = () => resolve({ success: true, steps: [], stepCount: 0, pollenCost: 0 });
        signal.addEventListener('abort', () => resolve({ success: false, error: 'cancelled' }), { once: true });
      }),
    );
    const prepared = manager.prepareChildRun(parent.id, {
      childId: 'child-cancel-1',
      task: 'child task',
      role: 'worker',
      budget: { timeoutMs: 20_000 },
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const child = manager.startRun({
      id: prepared.record.childId,
      kind: 'agent',
      task: prepared.record.role,
      metadata: prepared.metadata,
    }, async ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('RUN_CANCELLED')), { once: true });
    }));
    manager.registerChildRun(parent.id, child.id);
    expect(manager.stopRun(parent.id, 'parent stopped')).toBe(true);
    await manager.waitForRun(child.id);
    await waitForChildReport(manager, child.id);

    expect(manager.getRun(child.id)?.status).toBe('interrupted');
    expect(manager.getChildRun(child.id)?.status).toBe('interrupted');
    releaseParent?.();
  });
});

