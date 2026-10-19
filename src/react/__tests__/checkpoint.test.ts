import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from '@jest/globals';
import {
  createReactCheckpoint,
  isCheckpointWorkspaceFresh,
  prepareReactRepairState,
  prepareReactResumeState,
  prepareReactWorkspaceRebaseState,
} from '../checkpoint';
import { SQLiteAppStore } from '../../persistence/sqliteStore';
import { ServerRunManager } from '../run-manager';

function state(workspace: string): any {
  return {
    task: 'resume task', workspace, plan: [{ step: 'verify', status: 'pending' }], steps: [], current_step: 1,
    max_steps: 10, total_pollen_cost: 2, budget: 100, repairAttempts: 0,
    taskAnalysis: { contract: { id: 'contract-1', candidateFiles: ['src/app.ts'], permissions: { approvalPolicy: 'ask' } } },
  };
}

describe('React checkpoints', () => {
  it('persists a versioned checkpoint in run metadata', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-checkpoint-'));
    writeFileSync(path.join(workspace, 'tracked.ts'), 'export const value = 1;');
    const store = new SQLiteAppStore(path.join(workspace, 'runs.sqlite'));
    const manager = new ServerRunManager(store);
    const checkpoint = createReactCheckpoint(state(workspace));
    const run = manager.startRun({ kind: 'react', task: 'resume task', workspace }, async ({ emit }) => {
      emit('llm_request_started', { request: { requestId: 'request-1', stepId: 'step-1', status: 'started' } });
      emit('llm_request_finished', { request: { requestId: 'request-1', stepId: 'step-1', status: 'succeeded' } });
      emit('checkpoint', checkpoint);
      return { success: true, steps: [], stepCount: 0, pollenCost: 0 };
    });
    await manager.waitForRun(run.id);
    const saved = manager.getCheckpoint(run.id);
    expect(saved).toMatchObject({
      version: 1,
      state: { task: 'resume task' },
      handoff: {
        version: 1,
        eventSeq: 3,
        requestEnvelope: { requestId: 'request-1', eventId: `${run.id}:2`, status: 'succeeded', stepId: 'step-1' },
        evidenceWindow: { startEventSeq: 1, endEventSeq: 3 },
        progressCursor: { version: 1, currentStep: 1, phase: 'understand', remainingPlanItems: ['verify'] },
      },
    });
    expect(manager.projectEvents(run.id).replayInvariants.requestPairing).toMatchObject({
      valid: true,
      startedRequestIds: ['request-1'],
      finishedRequestIds: ['request-1'],
    });
  });

  it('invalidates a checkpoint when a tracked workspace file changes', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-checkpoint-stale-'));
    const file = path.join(workspace, 'src');
    mkdirSync(file);
    const tracked = path.join(file, 'app.ts');
    writeFileSync(tracked, 'export const value = 1;');
    const checkpoint = createReactCheckpoint(state(workspace));
    writeFileSync(tracked, 'export const value = 2;');
    expect(isCheckpointWorkspaceFresh(checkpoint)).toBe(false);
  });

  it('uses the host fingerprint provider when creating and checking a checkpoint', () => {
    const hostFingerprint = (snapshot: any) => ({
      digest: `host:${snapshot.workspace}`,
      entries: [],
    });
    const checkpoint = createReactCheckpoint(state('C:\\workspace'), hostFingerprint);

    expect(checkpoint.workspaceFingerprint.digest).toBe('host:C:\\workspace');
    expect(isCheckpointWorkspaceFresh(checkpoint, hostFingerprint)).toBe(true);
  });

  it('records the last completed action and first unfinished plan item as a durable resume marker', () => {
    const current = {
      ...state('C:\\workspace'),
      plan: [
        { step: 'Inspect source', status: 'completed' },
        { step: 'Implement fix', status: 'in_progress' },
        { step: 'Run tests', status: 'pending' },
      ],
      steps: [{
        thought: 'inspect',
        action: 'Read',
        action_input: { file_path: 'src/app.ts' },
        observation: '{"success":true,"output":"source"}',
      }],
    };

    expect(createReactCheckpoint(current).state.lastRun).toEqual({
      completedStepCount: 1,
      lastAction: 'Read',
      lastActionInput: { file_path: 'src/app.ts' },
      lastActionSucceeded: true,
      nextPlanItem: 'Implement fix',
      recordedAt: expect.any(Number),
    });
  });

  it('does not mistake a synthetic replay refusal for forward task progress', () => {
    const current = {
      ...state('C:\\workspace'),
      plan: [{ step: 'Implement fix', status: 'in_progress' }],
      steps: [
        {
          thought: 'inspect',
          action: 'Read',
          action_input: { file_path: 'src/app.ts' },
          observation: '{"success":true}',
        },
        {
          thought: 'duplicate prevented',
          action: 'ReplayGuard',
          action_input: { attempted_action: 'Read' },
          observation: '{"success":false,"skipped":true}',
        },
      ],
    };

    expect(createReactCheckpoint(current).state.lastRun).toEqual(expect.objectContaining({
      completedStepCount: 2,
      lastAction: 'Read',
      lastActionInput: { file_path: 'src/app.ts' },
      lastActionSucceeded: true,
      nextPlanItem: 'Implement fix',
    }));
  });

  it('adds a fresh step budget without nesting or replacing the original task', () => {
    const original = {
      ...state('C:\\workspace'),
      task: 'Build the portfolio once.',
      current_step: 40,
      max_steps: 40,
      codingState: 'blocked',
      blockedReason: 'Max steps exceeded',
      noProgressCount: 3,
      lastActionSignature: 'bash:{}',
      llmUsage: {
        requestCount: 10,
        retryCount: 2,
        cacheHits: 1,
        inputTokens: 1200,
        outputTokens: 300,
      },
    };

    const resumed = prepareReactResumeState(original, 40, 1234);

    expect(resumed.task).toBe('Build the portfolio once.');
    expect(resumed.current_step).toBe(40);
    expect(resumed.max_steps).toBe(80);
    expect(resumed.codingState).toBe('inspect');
    expect(resumed.blockedReason).toBeUndefined();
    expect(resumed.noProgressCount).toBe(0);
    expect(resumed.lastActionSignature).toBeUndefined();
    expect(resumed.codingStateStartedAt).toBe(1234);
    expect(resumed.continuationCount).toBe(1);
    expect(resumed.llmUsage).toEqual({
      requestCount: 0,
      retryCount: 2,
      cacheHits: 1,
      inputTokens: 1200,
      outputTokens: 300,
    });

    const continuedAgain = prepareReactResumeState(resumed, 20, 2345);
    expect(continuedAgain.continuationCount).toBe(2);
    expect(continuedAgain.llmUsage?.requestCount).toBe(0);
  });

  it('keeps internal checkpoint continuations inside the same request budget', () => {
    const original = {
      ...state('C:\\workspace'),
      current_step: 1_000,
      max_steps: 1_000,
      llmUsage: {
        requestCount: 9,
        retryCount: 2,
        cacheHits: 1,
        inputTokens: 1200,
        outputTokens: 300,
      },
    };

    const continued = prepareReactResumeState(original, 40, 1234, {
      resetRequestBudget: false,
      allowUnboundedSteps: true,
    });

    expect(continued.max_steps).toBe(1_000);
    expect(continued.globalStepLimit).toBe(1_000);
    expect(continued.globalStepCount).toBe(1_000);
    expect(continued.llmUsage?.requestCount).toBe(9);
    expect(continued.continuationCount).toBe(1);
  });

  it('starts an incremental repair from preserved history and a fresh evidence window', () => {
    const original = {
      ...state('C:\\workspace'),
      task: 'Build the app.',
      plan: [{ step: 'Build and verify the app', status: 'completed' as const }],
      steps: [
        { thought: 'read', action: 'Read', action_input: { file_path: 'index.html' }, observation: '{"success":true}' },
        { thought: 'write', action: 'Write', action_input: { file_path: 'index.html' }, observation: '{"success":true}' },
        { thought: 'verify', action: 'Command', action_input: { operation: 'verify' }, observation: '{"success":false,"status":"failed"}' },
      ],
      current_step: 3,
      max_steps: 3,
      codingState: 'complete' as const,
      forceMutationNextAction: true,
      forceMutationTarget: 'index.html',
    };

    const repaired = prepareReactRepairState(original, {
      task: 'Repair the failed app verification.',
      check: 'page loads',
      reason: 'The page failed to load.',
      changedFiles: ['index.html'],
    }, 1234);

    expect(repaired.task).toBe('Repair the failed app verification.');
    expect(repaired.steps).toHaveLength(3);
    expect(repaired.steps[1].action).toBe('Write');
    expect(repaired.plan).toEqual(original.plan);
    expect(repaired.current_step).toBe(3);
    expect(repaired.max_steps).toBe(43);
    expect(repaired.evidenceStartStep).toBe(3);
    expect(repaired.codingState).toBe('repair');
    expect(repaired.activeRepair).toMatchObject({
      check: 'page loads',
      strategy: 'repair',
      changedFiles: ['index.html'],
    });
    expect(repaired.forceMutationNextAction).toBe(false);
    expect(repaired.forceMutationTarget).toBeUndefined();
  });

  it('preserves mutation recovery when resuming an old inspection-budget block', () => {
    const original = {
      ...state('C:\\workspace'),
      codingState: 'blocked',
      blockedReason:
        'Execution state budget exhausted before a source mutation succeeded. Resume with a scoped Write or Edit action.',
      noProgressCount: 9,
      forceMutationNextAction: false,
      current_step: 12,
      max_steps: 12,
    };

    const resumed = prepareReactResumeState(original, 40, 1234);

    expect(resumed.codingState).toBe('implement');
    expect(resumed.forceMutationNextAction).toBe(true);
    expect(resumed.forceMutationTarget).toBe('src/app.ts');
    expect(resumed.noProgressCount).toBe(4);
    expect(resumed.blockedReason).toBeUndefined();
  });

  it('preserves a recovery-budget marker so the engine can reopen the checkpoint for repair', () => {
    const reason = 'Run recovery budget reached after 8 transitions. Progress was saved at a checkpoint; review the provider, task, or workspace before continuing.';
    const original = {
      ...state('C:\\workspace'),
      codingState: 'blocked',
      blockedReason: reason,
      outcome: 'blocked',
      recoveryCount: 8,
      recoveryWindowCount: 8,
      sharedState: 'failed',
    };

    const resumed = prepareReactResumeState(original, 40, 1234);

    expect(resumed.codingState).toBe('blocked');
    expect(resumed.blockedReason).toBe(reason);
    expect(resumed.recoveryCount).toBe(8);
    expect(resumed.recoveryWindowCount).toBe(8);
  });

  it('does not bypass a pending mutation approval during resume', () => {
    const original = {
      ...state('C:\\workspace'),
      codingState: 'blocked',
      blockedReason:
        'Mutation approval is required before the next Write or Edit action. Grant the requested write scope, then resume this run.',
      forceMutationNextAction: false,
    };

    const resumed = prepareReactResumeState(original, 40, 1234);

    expect(resumed.codingState).toBe('inspect');
    expect(resumed.forceMutationNextAction).toBe(false);
    expect(resumed.noProgressCount).toBe(0);
  });

  it('rebases stale workspace evidence without forgetting completed plan work', () => {
    const original = {
      ...state('C:\\workspace'),
      plan: [
        { step: 'Implement completed change', status: 'completed' },
        { step: 'Verify remaining behavior', status: 'in_progress' },
      ],
      steps: [{
        thought: 'inspect old source',
        action: 'Read',
        action_input: { file_path: 'src/app.ts' },
        observation: '{"success":true,"output":"old source"}',
      }],
      current_step: 17,
      max_steps: 20,
      evidenceStartStep: 4,
      lastRun: {
        completedStepCount: 17,
        lastAction: 'Read',
        lastActionInput: { file_path: 'src/app.ts' },
        lastActionSucceeded: true,
        nextPlanItem: 'Verify remaining behavior',
        recordedAt: 1000,
      },
    };

    const rebased = prepareReactWorkspaceRebaseState(original, 40, 2000);

    expect(rebased.task).toBe(original.task);
    expect(rebased.plan).toEqual(original.plan);
    expect(rebased.steps).toEqual([]);
    expect(rebased.current_step).toBe(0);
    expect(rebased.max_steps).toBe(40);
    expect(rebased.evidenceStartStep).toBe(0);
    expect(rebased.codingState).toBe('inspect');
    expect(rebased.lastRun).toEqual({
      completedStepCount: 0,
      nextPlanItem: 'Verify remaining behavior',
      recordedAt: 1000,
    });
    expect(rebased.continuationCount).toBe(1);
    expect(rebased.llmUsage?.requestCount).toBe(0);
  });
});
