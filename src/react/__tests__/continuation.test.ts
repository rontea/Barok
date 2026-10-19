import { describe, expect, it } from '@jest/globals';
import { createContinuationHandoff, measureContinuationQuality, summarizeContinuationState } from '../continuation';
import { getContinuationWorkspaceRelativePath } from '../continuation-path';
import { tmpdir } from 'os';
import path from 'path';

describe('continuation handoffs', () => {
  const state = {
    task: 'Finish continuation Phase 2.',
    plan: [
      { step: 'Inspect paths', status: 'completed' as const },
      { step: 'Add lineage', status: 'in_progress' as const },
      { step: 'Run tests', status: 'pending' as const },
    ],
    steps: [
      {
        thought: 'inspect',
        action: 'Read',
        action_input: { file_path: 'src/app.ts' },
        observation: JSON.stringify({ success: true, content: 'current source' }),
      },
      {
        thought: 'verify',
        action: 'Command',
        action_input: { operation: 'test', command: 'npm.cmd test' },
        observation: JSON.stringify({ success: true, status: 'passed', output: 'ok' }),
      },
    ],
    codingState: 'blocked' as const,
    blockedReason: 'Approval is required.',
    lastRun: {
      completedStepCount: 2,
      lastAction: 'Command',
      lastActionInput: { operation: 'test', command: 'npm.cmd test' },
      lastActionSucceeded: true,
      nextPlanItem: 'Add lineage',
      recordedAt: 1200,
    },
  };

  it('normalizes paths lexically without Node filesystem APIs', () => {
    expect(getContinuationWorkspaceRelativePath('src\\react\\app.ts', 'C:\\Projects\\Barok')).toBe('src/react/app.ts');
    expect(getContinuationWorkspaceRelativePath('C:\\Projects\\Barok\\src\\react\\app.ts', 'C:\\Projects\\Barok')).toBe('src/react/app.ts');
    expect(getContinuationWorkspaceRelativePath('/work/project/src/app.ts', '/work/project')).toBe('src/app.ts');
    expect(getContinuationWorkspaceRelativePath('/workspace/src/app.ts', 'C:\\Projects\\Barok')).toBe('src/app.ts');
    expect(getContinuationWorkspaceRelativePath('\\\\server\\share\\project\\src\\app.ts', '\\\\server\\share\\project')).toBe('src/app.ts');
    expect(() => getContinuationWorkspaceRelativePath('../outside.ts', 'C:\\Projects\\Barok')).toThrow();
    expect(() => getContinuationWorkspaceRelativePath('C:\\Projects\\Other\\outside.ts', 'C:\\Projects\\Barok')).toThrow();
  });

  it('derives one bounded preview from current checkpoint evidence', () => {
    expect(summarizeContinuationState(state)).toEqual({
      currentGoal: 'Finish continuation Phase 2.',
      completedPlanItems: ['Inspect paths'],
      remainingPlanItems: ['Add lineage', 'Run tests'],
      updatedFiles: [],
      verifiedChecks: ['unit-tests: npm.cmd test'],
      remainingPlanItem: 'Add lineage',
      latestVerifiedCheck: 'unit-tests: npm.cmd test',
      blocker: 'Approval is required.',
      lastRun: {
        completedStepCount: 2,
        lastAction: 'Command',
        lastActionSucceeded: true,
        nextPlanItem: 'Add lineage',
        recordedAt: 1200,
      },
      recentActions: [
        { action: 'Read', target: 'src/app.ts', outcome: 'succeeded' },
        { action: 'Command', target: 'npm.cmd test', outcome: 'succeeded' },
      ],
    });
  });

  it('does not carry provider recovery text into the next project plan item', () => {
    expect(summarizeContinuationState({
      ...state,
      plan: [
        { step: 'Verify integration and resolve throttling issues with Groq API', status: 'in_progress' as const },
        { step: 'Implement the next playable mini-pong slice and verify it', status: 'pending' as const },
      ],
    })).toEqual(expect.objectContaining({
      remainingPlanItem: 'Implement the next playable mini-pong slice and verify it',
    }));
  });

  it('preserves the parent model context window in the compact handoff', () => {
    const handoff = createContinuationHandoff({
      parentRunId: 'parent-context-window',
      reason: 'max_steps',
      state: { ...state, modelContextWindow: 262_144 },
    });

    expect(handoff.modelContextWindow).toBe(262_144);
    expect(summarizeContinuationState({ ...state, modelContextWindow: 262_144 }).modelContextWindow).toBe(262_144);
  });

  it.each(['conversational_confirmation', 'max_steps', 'saved_run'] as const)(
    'uses the typed handoff for %s continuation',
    (reason) => {
      const handoff = createContinuationHandoff({ parentRunId: 'parent-1', reason, state, createdAt: 1234 });
      expect(handoff).toEqual(expect.objectContaining({
        version: 1,
        parentRunId: 'parent-1',
        reason,
        createdAt: 1234,
        currentGoal: 'Finish continuation Phase 2.',
        completedPlanItems: ['Inspect paths'],
        remainingPlanItems: ['Add lineage', 'Run tests'],
        updatedFiles: [],
        verifiedChecks: ['unit-tests: npm.cmd test'],
        remainingPlanItem: 'Add lineage',
        latestVerifiedCheck: 'unit-tests: npm.cmd test',
        blocker: 'Approval is required.',
        lastRun: expect.objectContaining({
          completedStepCount: 2,
          lastAction: 'Command',
          nextPlanItem: 'Add lineage',
        }),
        evidence: expect.objectContaining({ parentStepCount: 2, childStepOffset: 2 }),
        quality: expect.objectContaining({
          repeatedParentActions: 0,
          staleParentFileReads: 0,
        }),
      }));
      expect(handoff.quality.handoffPromptTokens).toBeLessThan(450);
      expect(handoff.quality.promptReductionTokens).toBeGreaterThanOrEqual(0);
    }
  );

  it('records completed updates as bounded checkpoint evidence for the next agent', () => {
    const preview = summarizeContinuationState({
      ...state,
      steps: [
        ...state.steps,
        {
          thought: 'update',
          action: 'Edit',
          action_input: { file_path: 'src/app.ts' },
          observation: JSON.stringify({ success: true, output: 'updated source' }),
        },
      ],
    });

    expect(preview.updatedFiles).toEqual(['src/app.ts']);
    expect(preview.latestUpdatedFile).toBe('src/app.ts');
  });

  it('revalidates output and continuation paths against the active workspace', () => {
    const outsidePath = path.join(tmpdir(), 'react-engine-outside', 'rejected.js');
    const preview = summarizeContinuationState({
      ...state,
      workspace: process.cwd(),
      steps: [
        {
          thought: 'complete output',
          action: 'Write',
          action_input: { file_path: 'README.md' },
          observation: JSON.stringify({ success: true }),
        },
        {
          thought: 'blocked path',
          action: 'Write',
          action_input: { file_path: outsidePath },
          observation: JSON.stringify({ success: false, error: `Mutation rejected: ${outsidePath} is outside the workspace.` }),
        },
        {
          thought: 'search stale path',
          action: 'Grep',
          action_input: { pattern: 'task', includePattern: outsidePath },
          observation: JSON.stringify({ success: false, error: `Search path rejected: ${outsidePath}` }),
        },
      ],
    });
    const handoff = createContinuationHandoff({
      parentRunId: 'outside-path-parent',
      reason: 'max_steps',
      state: { ...state, workspace: process.cwd(), steps: [
        {
          thought: 'blocked path',
          action: 'Write',
          action_input: { file_path: outsidePath },
          observation: JSON.stringify({ success: false, error: `Mutation rejected: ${outsidePath} is outside the workspace.` }),
        },
        {
          thought: 'search stale path',
          action: 'Grep',
          action_input: { pattern: 'task', includePattern: outsidePath },
          observation: JSON.stringify({ success: false, error: `Search path rejected: ${outsidePath}` }),
        },
      ] },
    });

    expect(preview.updatedFiles).toEqual(['README.md']);
    expect(JSON.stringify(preview)).not.toContain(outsidePath);
    expect(handoff.updatedFiles).toEqual([]);
    expect(JSON.stringify(handoff)).not.toContain(outsidePath);
  });

  it('keeps only five compact recent actions without successful tool output', () => {
    const preview = summarizeContinuationState({
      ...state,
      steps: Array.from({ length: 7 }, (_, index) => ({
        thought: `step ${index}`,
        action: index === 6 ? 'Command' : 'Read',
        action_input: index === 6
          ? { command: 'npm.cmd test' }
          : { file_path: `src/file-${index}.ts` },
        observation: index === 6
          ? JSON.stringify({ success: false, error: `Test failed ${'details '.repeat(80)}` })
          : JSON.stringify({ success: true, content: 'SOURCE_CONTENT_MUST_NOT_ENTER_HANDOFF' }),
      })),
    });

    expect(preview.recentActions).toHaveLength(5);
    expect(preview.recentActions?.[0]).toEqual({ action: 'Read', target: 'src/file-2.ts', outcome: 'succeeded' });
    expect(preview.recentActions?.at(-1)).toEqual(expect.objectContaining({
      action: 'Command',
      target: 'npm.cmd test',
      outcome: 'failed',
      failure: expect.stringMatching(/^Test failed/),
    }));
    expect(JSON.stringify(preview.recentActions)).not.toContain('SOURCE_CONTENT_MUST_NOT_ENTER_HANDOFF');
    expect(preview.recentActions?.at(-1)?.failure?.length).toBeLessThanOrEqual(180);

    const handoff = createContinuationHandoff({
      parentRunId: 'parent-large-output',
      reason: 'max_steps',
      state: {
        ...state,
        steps: [{
          thought: 'read source',
          action: 'Read',
          action_input: { file_path: 'src/large.ts' },
          observation: JSON.stringify({ success: true, content: 'large source '.repeat(2_000) }),
        }],
      },
    });
    expect(handoff.quality.sourcePromptTokens).toBeGreaterThan(handoff.quality.handoffPromptTokens);
    expect(handoff.quality.promptReductionTokens).toBeGreaterThan(1_000);
  });

  it('deduplicates multi-round failures while preserving the goal and next plan item', () => {
    const repeatedFailures = Array.from({ length: 24 }, (_, index) => ({
      thought: `private thought ${index}`,
      action: index % 2 === 0 ? 'Edit' : 'Command',
      action_input: index % 2 === 0
        ? { file_path: 'src/app.ts', old_string: 'stale', new_string: 'next' }
        : { operation: 'verify', command: 'npm.cmd test' },
      observation: JSON.stringify({ success: false, error: index % 2 === 0 ? 'stale expected hash; refresh the source preimage' : 'test command failed with a bounded diagnostic' }),
    }));
    const preview = summarizeContinuationState({
      ...state,
      task: 'Preserve the requested source behavior and complete the scoped repair.',
      plan: [
        { step: 'Inspect the existing source', status: 'completed' as const },
        { step: 'Repair src/app.ts and rerun verification', status: 'in_progress' as const },
        { step: 'Report the result', status: 'pending' as const },
      ],
      steps: repeatedFailures,
    });
    const handoff = createContinuationHandoff({
      parentRunId: 'parent-repeated-failures',
      reason: 'max_steps',
      state: {
        ...state,
        task: 'Preserve the requested source behavior and complete the scoped repair.',
        plan: [
          { step: 'Inspect the existing source', status: 'completed' as const },
          { step: 'Repair src/app.ts and rerun verification', status: 'in_progress' as const },
          { step: 'Report the result', status: 'pending' as const },
        ],
        steps: repeatedFailures,
      },
    });

    expect(preview.currentGoal).toBe('Preserve the requested source behavior and complete the scoped repair.');
    expect(preview.remainingPlanItem).toBe('Repair src/app.ts and rerun verification');
    expect(preview.recentActions).toHaveLength(2);
    expect(new Set(preview.recentActions?.map((action) => action.failure)).size).toBe(2);
    expect(handoff.quality.handoffPromptTokens).toBeLessThanOrEqual(3_000);
    expect(JSON.stringify(handoff)).not.toContain('private thought');
  });

  it('counts only child actions that repeat parent work and stale parent reads before mutation', () => {
    const handoff = createContinuationHandoff({ parentRunId: 'parent-1', reason: 'max_steps', state, createdAt: 1234 });
    const childSteps = [
      ...state.steps,
      { ...state.steps[1] },
      { ...state.steps[0] },
      { thought: 'edit', action: 'Edit', action_input: { file_path: 'src/app.ts' }, observation: '{"success":true}' },
      { ...state.steps[0] },
    ];

    expect(measureContinuationQuality(handoff, childSteps)).toEqual(expect.objectContaining({
      repeatedParentActions: 3,
      staleParentFileReads: 1,
    }));
  });
});
