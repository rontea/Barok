import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { SQLiteAppStore } from '../sqliteStore.js';

describe('Thread-Scoped Run Audits in SQLiteAppStore', () => {
  let tempDir: string;
  let dbPath: string;
  let store: SQLiteAppStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'thread-audit-test-'));
    dbPath = join(tempDir, 'test.db');
    store = new SQLiteAppStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists and retrieves thread_id, parent_run_id, attempt_index, and outcome_kind', () => {
    store.saveRun({
      id: 'RUN-001',
      threadId: 'THREAD-ABC',
      runId: 'RUN-001',
      parentRunId: undefined,
      attemptIndex: 1,
      outcomeKind: 'checkpoint_rate_limit',
      threadTitle: 'Build Pacman Game',
      cumulativeCost: 0.015,
      cumulativeSteps: 4,
      task: 'Build Pacman Game',
      model: 'minimaxai/minimax-m3',
      timestamp: new Date().toISOString(),
      success: false,
      stepCount: 4,
      totalPollenCost: 0.015,
      budget: 100,
      steps: [
        { step: 1, thought: 'Inspect files', action: 'Read', actionInput: { file: 'index.html' } },
      ],
    }, 'raw log content');

    store.saveRun({
      id: 'RUN-002',
      threadId: 'THREAD-ABC',
      runId: 'RUN-002',
      parentRunId: 'RUN-001',
      attemptIndex: 2,
      outcomeKind: 'completed',
      threadTitle: 'Build Pacman Game',
      cumulativeCost: 0.035,
      cumulativeSteps: 8,
      task: 'Build Pacman Game',
      model: 'minimaxai/minimax-m3',
      timestamp: new Date(Date.now() + 1000).toISOString(),
      success: true,
      stepCount: 4,
      totalPollenCost: 0.020,
      budget: 100,
      finalAnswer: 'Game completed successfully.',
      steps: [
        { step: 1, thought: 'Write code', action: 'Write', actionInput: { file: 'index.html' } },
      ],
    }, 'raw log content 2');

    const recentRuns = store.getRecentRuns<any>(10);
    expect(recentRuns).toHaveLength(2);

    const latest = recentRuns[0];
    expect(latest.id).toBe('RUN-002');
    expect(latest.threadId).toBe('THREAD-ABC');
    expect(latest.parentRunId).toBe('RUN-001');
    expect(latest.attemptIndex).toBe(2);
    expect(latest.outcomeKind).toBe('completed');
    expect(latest.cumulativeCost).toBe(0.035);
    expect(latest.cumulativeSteps).toBe(8);

    const first = recentRuns[1];
    expect(first.id).toBe('RUN-001');
    expect(first.threadId).toBe('THREAD-ABC');
    expect(first.attemptIndex).toBe(1);
    expect(first.outcomeKind).toBe('checkpoint_rate_limit');
  });

  it('aggregates a thread into one lifecycle summary and preserves changed files', () => {
    const saveAttempt = (input: {
      id: string;
      timestamp: string;
      outcomeKind: string;
      parentRunId?: string;
      attemptIndex: number;
      cost: number;
      file: string;
    }) => store.saveRun({
      id: input.id,
      threadId: 'THREAD-AGGREGATE',
      runId: input.id,
      parentRunId: input.parentRunId,
      attemptIndex: input.attemptIndex,
      outcomeKind: input.outcomeKind,
      threadTitle: 'Aggregate this task',
      task: 'Aggregate this task',
      model: 'test-model',
      timestamp: input.timestamp,
      success: input.outcomeKind === 'completed',
      stepCount: 2,
      totalPollenCost: input.cost,
      budget: 100,
      filesChanged: [input.file],
      steps: [],
    }, input.id);

    saveAttempt({ id: 'RUN-A', timestamp: '2026-01-01T00:00:00.000Z', outcomeKind: 'checkpoint_turn_limit', attemptIndex: 1, cost: 0.01, file: 'src/first.ts' });
    saveAttempt({ id: 'RUN-B', timestamp: '2026-01-01T00:00:01.000Z', outcomeKind: 'completed', parentRunId: 'RUN-A', attemptIndex: 2, cost: 0.02, file: 'src/second.ts' });

    const threads = store.getRecentThreads(10);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      threadId: 'THREAD-AGGREGATE',
      threadTitle: 'Aggregate this task',
      status: 'completed',
      latestOutcomeKind: 'completed',
      totalAttempts: 2,
      totalSteps: 4,
      totalPollenCost: 0.03,
      filesChanged: ['src/first.ts', 'src/second.ts'],
      lastModel: 'test-model',
      lastTimestamp: '2026-01-01T00:00:01.000Z',
    });
    expect(threads[0].runs.map((run) => run.id)).toEqual(['RUN-A', 'RUN-B']);

    const details = store.getThreadDetails('THREAD-AGGREGATE');
    expect(details?.runs[1]).toMatchObject({ id: 'RUN-B', parentRunId: 'RUN-A', attemptIndex: 2 });
    expect(store.getThreadDetails('missing-thread')).toBeNull();
  });

  it('exposes old unscoped audits as synthetic one-attempt threads', () => {
    store.saveRun({
      id: 'LEGACY-RUN',
      task: 'Old task',
      model: 'old-model',
      timestamp: '2026-01-02T00:00:00.000Z',
      success: false,
      stepCount: 0,
      totalPollenCost: 0,
      budget: 10,
      steps: [],
    }, 'legacy');

    expect(store.getRecentThreads(10)[0]).toMatchObject({
      threadId: 'legacy:LEGACY-RUN',
      status: 'failed',
      totalAttempts: 1,
    });
  });
});
