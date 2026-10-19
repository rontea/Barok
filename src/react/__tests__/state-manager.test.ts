import { describe, expect, it } from '@jest/globals';
import { EDIT_STAGNATION_FAILURE_LIMIT, isEditStagnated, isHashConflictOrStalePreimageError, trackMutationFailure, actionSignature, addStep, advancePlan, assessCodingState, buildRetainedReadContext, buildStepHistory, classifyRecoveryTransition, getCodingStateBudget, getCodingStateTimeBudget, getCurrentTaskSteps, getLatestReadFailureDetails, getPendingApprovalRequest, getRetainedReadCoverage, getStateEntryGateFailure, getStateExitGateFailure, getStateSnapshot, hasAnsweredUserQuestion, hasBaselineVerificationEvidence, hasEmptyWorkspaceInspectionEvidence, hasRelevantInspectionEvidence, hasRepeatedSuccessfulInspectionLoop, hasSuccessfulSourceMutation, isCodingStateBudgetExceeded, isCodingStateTimeBudgetExceeded, isCodingStateTransitionAllowed, primePlanCursor, recordAnsweredUserQuestion, requiresSourceMutation, shouldTripContinuousRunNoProgressCircuit, resetRecoveryBudgetAfterProgress, startRecovery, type ReactState } from '../state-manager';
import { estimateTextTokens } from '../token-accounting';
import { getCodingStateBudget as getEngineCodingStateBudget, isCodingStateTransitionAllowed as isEngineCodingStateTransitionAllowed } from '@barok/engine';

function createState(stepCount: number): ReactState {
  return {
    task: 'Long noisy run',
    workspace: process.cwd(),
    plan: [],
    steps: Array.from({ length: stepCount }, (_value, index) => ({
      thought: `thought ${index} ${'x'.repeat(2000)}`,
      action: index % 2 === 0 ? 'Read' : 'Bash',
      action_input: { command: 'node script.js', content: 'y'.repeat(4000) },
      observation: `observation ${index} ${'z'.repeat(7000)}`,
    })),
    current_step: stepCount,
    max_steps: 50,
    total_pollen_cost: 0,
    budget: 100,
    repairAttempts: 0,
  };
}

describe('getStateSnapshot', () => {
  it('returns a bounded recent step window with truncated noisy fields', () => {
    const snapshot = getStateSnapshot(createState(20));

    expect(snapshot.steps_total).toBe(20);
    expect(snapshot.steps).toHaveLength(8);
    expect(snapshot.steps_window_start).toBe(12);
    expect(snapshot.steps[0].thought.length).toBeLessThan(1700);
    expect(snapshot.steps[0].observation).toContain('[truncated');
    expect(snapshot.steps[0].action_input.truncated).toBe(true);
  });

  it('preserves structured success when a large observation is truncated', () => {
    const state = createState(1);
    state.steps[0].observation = JSON.stringify({
      success: true,
      status: 'passed',
      output: `console.error is intentionally shown in this file ${'x'.repeat(9000)}`,
    });

    const observation = JSON.parse(getStateSnapshot(state).steps[0].observation || '{}');

    expect(observation.success).toBe(true);
    expect(observation.status).toBe('passed');
    expect(observation.truncated).toBe(true);
  });

  it('persists the pinned provider profile and task usage in state snapshots', () => {
    const state = createState(1);
    state.providerProfile = 'account-a';
    state.model = 'gemini-2.5-pro';
    state.modelContextWindow = 1_000_000;
    state.llmUsage = {
      requestCount: 3,
      retryCount: 1,
      cacheHits: 2,
      inputTokens: 12000,
      outputTokens: 2400,
      lastPromptTokens: 4200,
      peakPromptTokens: 4800,
      lastPromptPrefillDurationMs: 2_750,
    };

    const snapshot = getStateSnapshot(state);

    expect(snapshot.providerProfile).toBe('account-a');
    expect(snapshot.llmUsage).toEqual(state.llmUsage);
    expect(snapshot.runTokenUsage).toMatchObject({
      inputTokens: 12000,
      outputTokens: 2400,
      totalTokens: 14400,
      contextWindow: 1_000_000,
      estimated: false,
      contextUsageSource: 'provider',
      providerReportedPromptTokens: 4200,
      providerPeakPromptTokens: 4800,
      providerPromptRemainingTokens: 995800,
      providerPromptUsedPercent: 0.42,
      promptPrefillDurationMs: 2_750,
      prompt_prefill_duration_ms: 2_750,
      contextMeasurement: 'provider',
    });
    expect(snapshot.runTokenUsage.estimatedContextTokens).toBeGreaterThan(0);
    expect(snapshot.runTokenUsage.contextRemainingTokens).toBe(
      1_000_000 - snapshot.runTokenUsage.estimatedContextTokens
    );
  });

  it('reports separate global and rolling-window budgets', () => {
    const state = createState(2);
    state.current_step = 12;
    state.globalStepLimit = 100;
    state.globalStepCount = 12;
    state.stepWindowStart = 10;
    state.stepWindowLimit = 20;
    state.runStartedAt = Date.now() - 250;
    state.wallClockBudgetMs = 2_000;
    state.maxRecoveryTransitions = 8;
    state.recoveryCount = 14;
    state.recoveryWindowCount = 3;

    const budget = getStateSnapshot(state).runBudget;

    expect(budget).toMatchObject({
      globalStepLimit: 100,
      globalStepsUsed: 12,
      globalStepsRemaining: 88,
      windowStepLimit: 20,
      windowStepsUsed: 2,
      windowStepsRemaining: 18,
      wallClockBudgetMs: 2_000,
      maxRecoveryTransitions: 8,
      recoveryTransitionsUsed: 3,
      recoveryTransitionsTotal: 14,
      recoveryTransitionsRemaining: 5,
    });
    expect(budget.wallClockRemainingMs).toBeGreaterThan(0);
    expect(budget.wallClockRemainingMs).toBeLessThanOrEqual(2_000);
  });

  it('does not let addStep reset a stale global action cursor', () => {
    const state = createState(2);
    state.current_step = 2;
    state.globalStepCount = 0;

    addStep(state, {
      action: 'Read',
      action_input: { file_path: 'src/app.ts' },
      observation: JSON.stringify({ success: true }),
    });

    expect(state.globalStepCount).toBe(3);
  });
});

describe('retained read context', () => {
  it('keeps successful file contents available separately from compacted action history', () => {
    const state = createState(0);
    state.steps = [{
      thought: 'Inspect the target file.',
      action: 'Read',
      action_input: { file_path: 'src/app.ts' },
      observation: JSON.stringify({ success: true, output: 'export const retainedSentinel = true;' }),
    }];

    const context = buildRetainedReadContext(state.steps);

    expect(context).toContain('src/app.ts');
    expect(context).toContain('retainedSentinel');
    expect(context).toContain('do not reread covered ranges');
  });

  it('invalidates retained contents after a successful mutation of the same file', () => {
    const state = createState(0);
    state.steps = [
      {
        thought: 'Inspect the target file.',
        action: 'Read',
        action_input: { file_path: 'src/app.ts' },
        observation: JSON.stringify({ success: true, output: 'oldSentinel' }),
      },
      {
        thought: 'Update the target file.',
        action: 'Edit',
        action_input: { file_path: 'src/app.ts', old_string: 'old', new_string: 'new' },
        observation: JSON.stringify({ success: true, output: 'edited' }),
      },
    ];

    expect(buildRetainedReadContext(state.steps)).not.toContain('oldSentinel');
  });

  it('retains distinct read ranges while replacing duplicate ranges', () => {
    const state = createState(0);
    state.steps = [
      {
        thought: 'Read the first range.',
        action: 'Read',
        action_input: { file_path: 'src/app.ts', offset: 1, limit: 2 },
        observation: JSON.stringify({ success: true, output: 'first range' }),
      },
      {
        thought: 'Read the second range.',
        action: 'Read',
        action_input: { file_path: 'src/app.ts', offset: 3, limit: 2 },
        observation: JSON.stringify({ success: true, output: 'second range' }),
      },
      {
        thought: 'Refresh the first range.',
        action: 'Read',
        action_input: { file_path: 'src/app.ts', offset: 1, limit: 2 },
        observation: JSON.stringify({ success: true, output: 'refreshed first range' }),
      },
    ];

    const context = buildRetainedReadContext(state.steps);

    expect(context).toContain('refreshed first range');
    expect(context).toContain('second range');
    expect(context).not.toContain('):\nfirst range');
  });

  it('reports read ranges omitted by the retained-memory budget', () => {
    const state = createState(0);
    state.steps = [1, 2, 3].map((index) => ({
      thought: `Read range ${index}.`,
      action: 'Read',
      action_input: { file_path: `src/file-${index}.ts` },
      observation: JSON.stringify({ success: true, output: `range ${index}` }),
    }));

    const context = buildRetainedReadContext(state.steps, { maxEntries: 1 });

    expect(context).toContain('Context budget note: 2 previously read ranges omitted');
    expect(context).toContain('Omitted paths include: src/file-2.ts, src/file-1.ts');
    expect(context).toContain('not currently in active model memory');
  });
});

describe('loop-prevention state', () => {
  it('keeps mutable work mutation-gated even when stale analysis says docs_only', () => {
    const state = createState(0);
    state.taskAnalysis = {
      taskKind: 'docs_only',
      expectedChangeIntent: 'modify',
      affectedFiles: [],
      confidence: 0.5,
      userRequest: 'Create a website',
      workspace: state.workspace,
      instanceMode: 'new_instance',
    } as any;

    expect(requiresSourceMutation(state)).toBe(true);
  });

  it('remembers answered clarification questions for future continuations', () => {
    const state = createState(0);
    recordAnsweredUserQuestion(state, 'What is the company name?', 'UGG');

    expect(hasAnsweredUserQuestion(state, 'What is the company name?')).toBe(true);
    expect(hasAnsweredUserQuestion(state, 'What is the industry?')).toBe(false);
    expect(getStateSnapshot(state).answeredUserQuestions).toHaveLength(1);
  });
});

describe('engine-owned recovery records', () => {
  it('preserves the run contract and evidence while moving a completion claim back to implementation', () => {
    const state = {
      ...createState(1),
      task: 'Update src/app.ts',
      model: 'tool-capable-model',
      providerProfile: 'account-a',
      approvalGrants: [{ scope: 'workspace:write', grantedAt: 10 }],
      evidenceStartStep: 0,
      codingState: 'review',
      taskAnalysis: {
        id: 'contract-1',
        expectedChangeIntent: 'modify',
        affectedFiles: [{ path: 'src/app.ts', intent: 'modify' }],
        contract: { candidateFiles: ['src/app.ts'] },
      },
      plan: [{ step: 'Implement the app change', status: 'in_progress' }],
      steps: [{
        thought: 'Inspect the target',
        action: 'Read',
        action_input: { file_path: 'src/app.ts' },
        observation: JSON.stringify({ success: true, output: 'source' }),
      }],
      current_step: 1,
    } as any as ReactState;

    const record = startRecovery(
      state,
      'missing_mutation_evidence',
      'The model claimed completion without a successful mutation.',
    );

    expect(record).toMatchObject({
      reason: 'missing_mutation_evidence',
      from: 'review',
      to: 'implement',
      attempt: 1,
      evidence: {
        stepCount: 1,
        latestAction: 'Read',
        latestActionSucceeded: true,
        successfulMutationCount: 0,
      },
    });
    expect(state).toMatchObject({
      task: 'Update src/app.ts',
      model: 'tool-capable-model',
      providerProfile: 'account-a',
      approvalGrants: [{ scope: 'workspace:write', grantedAt: 10 }],
      evidenceStartStep: 0,
      codingState: 'implement',
      recoveryReason: 'missing_mutation_evidence',
      recoveryCount: 1,
      plan: [{ step: 'Implement the app change', status: 'in_progress' }],
    });
    expect(state.recoveryHistory).toHaveLength(1);
  });

  it('routes contradicted decision evidence back to inspection', () => {
    const state = {
      ...createState(1),
      codingState: 'implement',
      taskAnalysis: { expectedChangeIntent: 'modify' },
      steps: [{
        thought: 'Read the target',
        action: 'Read',
        action_input: { file_path: 'src/app.ts' },
        observation: JSON.stringify({ success: true, output: 'Target was not found.' }),
      }],
      current_step: 1,
    } as any as ReactState;

    const record = startRecovery(
      state,
      'decision_evidence_mismatch',
      'The expected target was contradicted by the observation.',
    );

    expect(record).toMatchObject({
      reason: 'decision_evidence_mismatch',
      from: 'implement',
      to: 'inspect',
    });
    expect(state.codingState).toBe('inspect');
  });

  it('resets the recovery streak after a successful tool action but not a plan update', () => {
    const state = { recoveryCount: 12, recoveryWindowCount: 7 } as ReactState;
    const successfulRead = {
      thought: 'Inspect the current source.',
      action: 'Read',
      action_input: { file_path: 'index.html' },
      observation: JSON.stringify({ success: true, output: '<main>current source</main>' }),
    };

    expect(resetRecoveryBudgetAfterProgress(state, successfulRead as any)).toBe(true);
    expect(state.recoveryCount).toBe(12);
    expect(state.recoveryWindowCount).toBe(0);
    expect(resetRecoveryBudgetAfterProgress(state, { ...successfulRead, action: 'Todo' } as any)).toBe(false);
  });
});

describe('buildStepHistory', () => {
  it('summarizes older steps and keeps recent steps detailed', () => {
    const history = buildStepHistory(createState(10).steps, {
      recentStepCount: 3,
      maxTokens: 6000,
    });

    expect(history).toContain('Earlier actions summarized (7 actions omitted from full detail)');
    expect(history).toContain('- Action 1: Read');
    expect(history).toContain('Action 8:');
    expect(history).toContain('Action 10:');
    expect(history).not.toContain('Action 1:\nThought:');
  });

  it('keeps the decision lifecycle visible without copying raw tool output', () => {
    const state = createState(1);
    state.steps[0].decisionRecord = {
      version: 1,
      id: 'decision-1',
      step: 1,
      provider: 'openai',
      model: 'planner',
      action: { action: 'Read', action_input: { file_path: 'src/app.ts' } },
      reasoningVisibility: 'collapsed',
      reasoningSource: 'model',
      status: 'succeeded',
      observedEvidence: { status: 'success', assessment: 'supported', summary: 'Target exists.' },
      createdAt: 1,
      completedAt: 2,
    };

    const history = buildStepHistory(state.steps, { recentStepCount: 1, maxTokens: 4000 });

    expect(history).toContain('Decision record: status: succeeded; observed evidence: success/supported (Target exists.)');
    expect(history).not.toContain('decision-1');
  });

  it('labels step-history compaction as prompt summarization rather than tool truncation', () => {
    const step = {
      thought: 'Inspect the complete source file.',
      action: 'Read',
      action_input: { file_path: 'script.js' },
      observation: JSON.stringify({ success: true, truncated: false, output: `(() => { ${'const value = 1; '.repeat(300)}` }),
    } as ReactState['steps'][number];

    const history = buildStepHistory([step], { recentStepCount: 1, observationLimit: 500 });

    expect(history).toContain('server step-history compaction');
    expect(history).toContain('this alone does not mean tool output was truncated');
    expect(history).not.toContain('[truncated');
    expect(history.length).toBeLessThanOrEqual(500 + 500);
  });

  it('marks only complete full-file reads as fully retained', () => {
    const fullRead = {
      thought: 'Read the whole source file.',
      action: 'Read',
      action_input: { file_path: 'src/app.js' },
      observation: JSON.stringify({ success: true, truncated: false, output: `const value = 1;\n${'const item = 2;\n'.repeat(40)}` }),
    } as ReactState['steps'][number];
    const previewRead = {
      ...fullRead,
      observation: JSON.stringify({
        success: true,
        truncated: false,
        output: 'const value = 1;',
        fullOutput: { persisted: true, path: '.react-engine/tool-results/read.txt' },
      }),
    };
    const contentCompactedRead = {
      ...fullRead,
      observation: JSON.stringify({ success: true, truncated: false, output: 'x'.repeat(9_000) }),
    };

    expect(getRetainedReadCoverage([fullRead]).find((entry) => entry.path === 'src/app.js')?.fullContentRetained).toBe(true);
    expect(getRetainedReadCoverage([previewRead]).find((entry) => entry.path === 'src/app.js')?.fullContentRetained).not.toBe(true);
    expect(getRetainedReadCoverage([contentCompactedRead], { maxTokens: 4_000 })
      .find((entry) => entry.path === 'src/app.js')?.fullContentRetained).not.toBe(true);
  });

  it('fits noisy histories into a token budget', () => {
    const history = buildStepHistory(createState(25).steps, {
      recentStepCount: 8,
      maxTokens: 900,
      thoughtLimit: 600,
      inputLimit: 600,
      observationLimit: 900,
    });

    expect(history.length).toBeLessThanOrEqual(900 * 4 + 200);
    expect(history).toContain('step history truncated to fit prompt budget');
    expect(history).toContain('Action 25:');
  });

  it('keeps token growth bounded across a 50-step run', () => {
    const history = buildStepHistory(createState(50).steps, {
      recentStepCount: 8,
      maxTokens: 1_000,
      thoughtLimit: 600,
      inputLimit: 600,
      observationLimit: 900,
    });

    expect(history.length).toBeLessThanOrEqual(1_000 * 4 + 200);
    expect(history).toContain('Action 50:');
  });

  it('preserves failed observations in older summaries', () => {
    const state = createState(8);
    state.steps[1].observation = '{"success":false,"error":"Pattern not found in src/app.tsx"}';

    const history = buildStepHistory(state.steps, {
      recentStepCount: 2,
      maxTokens: 4000,
    });

    expect(history).toContain('Action 2: Bash');
    expect(history).toContain('-> failed');
    expect(history).toContain('Pattern not found');
  });

  it('keeps persisted tool-output references authoritative after compaction', () => {
    const state = createState(8);
    state.steps[0].observation = JSON.stringify({
      success: true,
      output: 'preview only',
      fullOutput: { persisted: true, path: '.react-engine/tool-results/result.txt' },
    });

    const history = buildStepHistory(state.steps, { recentStepCount: 2, maxTokens: 4000 });

    expect(history).toContain('authoritative full output: .react-engine/tool-results/result.txt');
  });

  it('replaces retained read bodies with compact pointers', () => {
    const steps = [
      {
        thought: 'Inspect the source file.',
        action: 'Read',
        action_input: { file_path: 'src/app.ts' },
        observation: JSON.stringify({ success: true, output: 'FIRST_READ_SENTINEL' }),
      },
      {
        thought: 'Inspect the requirements document.',
        action: 'DocumentRead',
        action_input: { file_path: 'docs/spec.pdf' },
        observation: JSON.stringify({ success: true, output: 'SECOND_READ_SENTINEL' }),
      },
    ] as ReactState['steps'];
    const history = buildStepHistory(steps, {
      recentStepCount: 2,
      maxTokens: 4000,
      retainedReadCoverage: getRetainedReadCoverage(steps),
      deduplicateReadContext: true,
    });

    expect(history).toContain('Read 19 chars from src/app.ts (content retained in File Context above)');
    expect(history).toContain('Read 20 chars from docs/spec.pdf (content retained in File Context above)');
    expect(history).not.toContain('FIRST_READ_SENTINEL');
    expect(history).not.toContain('SECOND_READ_SENTINEL');
  });

  it('keeps only the latest unretained read detailed', () => {
    const steps = [
      {
        thought: 'Inspect the first file.',
        action: 'Read',
        action_input: { file_path: 'src/first.ts' },
        observation: JSON.stringify({ success: true, output: 'OLDER_UNMERGED_SENTINEL' }),
      },
      {
        thought: 'Inspect the second file.',
        action: 'Read',
        action_input: { file_path: 'src/second.ts' },
        observation: JSON.stringify({ success: true, output: 'LATEST_UNMERGED_SENTINEL' }),
      },
    ] as ReactState['steps'];
    const history = buildStepHistory(steps, {
      recentStepCount: 2,
      maxTokens: 4000,
      retainedReadCoverage: [],
      deduplicateReadContext: true,
    });

    expect(history).not.toContain('OLDER_UNMERGED_SENTINEL');
    expect(history).toContain('LATEST_UNMERGED_SENTINEL');
    expect(history).toContain('content not retained in File Context');
  });

  it('measurably reduces multi-file read history tokens', () => {
    const steps = [1, 2, 3].map((index) => ({
      thought: `Inspect file ${index}.`,
      action: 'Read',
      action_input: { file_path: `src/file-${index}.ts` },
      observation: JSON.stringify({ success: true, output: `file-${index} ${'x'.repeat(800)}` }),
    })) as ReactState['steps'];
    const rawHistory = buildStepHistory(steps, { recentStepCount: 3, maxTokens: 4000 });
    const deduplicatedHistory = buildStepHistory(steps, {
      recentStepCount: 3,
      maxTokens: 4000,
      retainedReadCoverage: getRetainedReadCoverage(steps),
      deduplicateReadContext: true,
    });

    expect(estimateTextTokens(deduplicatedHistory)).toBeLessThan(estimateTextTokens(rawHistory) * 0.6);
  });

  it('omits hashes and diffs from mutation observations', () => {
    const state = createState(8);
    state.steps[0] = {
      thought: 'Create the maze layout.',
      action: 'Write',
      action_input: { file_path: 'src/games/pacman/types/MazeLayout.ts' },
      observation: JSON.stringify({
        success: true,
        type: 'CreateFile',
        filepath: 'src/games/pacman/types/MazeLayout.ts',
        changedFiles: ['src/games/pacman/types/MazeLayout.ts'],
        afterHash: '5a691284110b8801fac9bcc805987fc7b5d235cf3223e1d017440b1d677c9b0b',
        diff: '+ export interface MazeLayout { name: string }',
      }),
    };

    const history = buildStepHistory(state.steps, { recentStepCount: 2, maxTokens: 4000 });

    expect(history).toContain('src/games/pacman/types/MazeLayout.ts');
    expect(history).toContain('CreateFile');
    expect(history).not.toContain('afterHash');
    expect(history).not.toContain('1d017440b1d677c9b0b');
    expect(history).not.toContain('export interface MazeLayout');
  });

  it('omits hashes and diffs from detailed recent mutation observations', () => {
    const state = createState(1);
    state.steps[0] = {
      thought: 'Update the maze layout.',
      action: 'Edit',
      action_input: { file_path: 'src/games/pacman/types/MazeLayout.ts' },
      observation: JSON.stringify({
        success: true,
        type: 'EditFile',
        filepath: 'src/games/pacman/types/MazeLayout.ts',
        changedFiles: ['src/games/pacman/types/MazeLayout.ts'],
        beforeHash: 'before-secret-opaque-value',
        afterHash: 'after-secret-opaque-value',
        diff: '- old\n+ new',
      }),
    };

    const history = buildStepHistory(state.steps, { recentStepCount: 1, maxTokens: 4000 });

    expect(history).toContain('EditFile');
    expect(history).not.toContain('beforeHash');
    expect(history).not.toContain('afterHash');
    expect(history).not.toContain('diff');
  });
});

describe('advancePlan', () => {
  it('does not complete an implementation item after inspection only', () => {
    const state = createState(0);
    state.plan = [
      { step: 'Implement the Phase 2 feature', status: 'in_progress' },
      { step: 'Verify the implementation', status: 'pending' },
    ];

    advancePlan(state, {
      thought: 'Inspect the tracker.',
      action: 'Read',
      action_input: { file_path: 'TODO.md' },
      observation: JSON.stringify({ success: true, output: '- [ ] Feature' }),
    });

    expect(state.plan[0].status).toBe('in_progress');
    expect(state.plan[1].status).toBe('pending');
  });

  it('advances implementation only after a successful mutation', () => {
    const state = createState(0);
    state.plan = [
      { step: 'Implement the Phase 2 feature', status: 'in_progress' },
      { step: 'Verify the implementation', status: 'pending' },
    ];

    advancePlan(state, {
      thought: 'Implement the maze.',
      action: 'Edit',
      action_input: { file_path: 'js/game.js' },
      observation: JSON.stringify({ success: true, output: 'Replaced 1 occurrence' }),
    });

    expect(state.plan[0].status).toBe('completed');
    expect(state.plan[1].status).toBe('in_progress');
  });

  it('primes an approved or restored plan without changing completed work', () => {
    const plan = [
      { step: 'Inspect source', status: 'completed' as const },
      { step: 'Implement change', status: 'pending' as const },
    ];

    expect(primePlanCursor(plan)).toBe(true);
    expect(plan[1].status).toBe('in_progress');
    expect(primePlanCursor(plan)).toBe(false);
    expect(plan[0].status).toBe('completed');
  });
});

describe('evidence-driven coding state assessment', () => {
  it('keeps child reporting scoped while reusing fresh parent checkpoint evidence', () => {
    const state = createState(0);
    const parentMutation = {
      thought: 'Parent mutation',
      action: 'Write',
      action_input: { file_path: 'index.js' },
      observation: '{"success":true,"output":"created"}',
    };
    const childInspection = {
      thought: 'Current inspection',
      action: 'Read',
      action_input: { file_path: 'src/page.tsx' },
      observation: '{"success":true,"output":"source"}',
    };
    state.steps = [parentMutation, childInspection];
    state.current_step = 2;
    state.continuationHandoff = { evidence: { childStepOffset: 1 } } as any;

    expect(getCurrentTaskSteps(state)).toEqual([childInspection]);
    expect(hasSuccessfulSourceMutation(state)).toBe(true);
    expect(hasRelevantInspectionEvidence(state)).toBe(true);
    expect(assessCodingState(state).state).toBe('verify');

    addStep(state, {
      thought: 'Verify the continued task.',
      action: 'Bash',
      action_input: { command: 'npm run build' },
      observation: '{"success":true,"output":"built"}',
    });
    expect(state.codingState).toBe('review');
    expect(getStateEntryGateFailure(state, 'complete')).toBeNull();
  });

  it('requires a new check after a continued run makes a later mutation', () => {
    const state = createState(0);
    state.steps = [
      { thought: 'parent edit', action: 'Edit', action_input: { file_path: 'src/app.ts' }, observation: '{"success":true}' },
      { thought: 'parent verify', action: 'Bash', action_input: { command: 'npm test' }, observation: '{"success":true,"output":"passed"}' },
      { thought: 'child edit', action: 'Edit', action_input: { file_path: 'src/next.ts' }, observation: '{"success":true}' },
    ];
    state.current_step = 3;
    state.continuationHandoff = { evidence: { childStepOffset: 2 } } as any;

    expect(assessCodingState(state).state).toBe('verify');
    expect(getStateEntryGateFailure(state, 'complete')).toContain('verification');
  });

  it('does not treat directory inspection as implementation evidence', () => {
    const state = createState(0);
    state.steps = [
      { thought: 'inspect', action: 'Bash', action_input: { command: 'dir' }, observation: '{"success":true,"output":"src"}' },
    ];
    expect(assessCodingState(state).evidence.mutated).toBe(false);
    expect(assessCodingState(state).state).toBe('discover');
  });

  it('treats distinct successful inspections as evidence progress', () => {
    const state = createState(0);
    state.steps = [1, 2, 3].map((index) => ({
      thought: `probe ${index}`, action: 'Read', action_input: { file_path: `src/${index}.ts` }, observation: '{"success":true,"output":"ok"}',
    }));
    const assessment = assessCodingState(state);
    expect(assessment.noProgressCount).toBe(0);
    expect(assessment.state).toBe('implement');
  });

  it('does not invent no-progress evidence from distinct probes when another probe is blocked', () => {
    const state = createState(0);
    state.steps = [
      { thought: 'probe 1', action: 'Glob', action_input: { pattern: '**/*' }, observation: '{"success":true,"output":""}' },
      { thought: 'probe 2', action: 'Command', action_input: { operation: 'list_directory' }, observation: '{"success":true,"output":""}' },
      { thought: 'blocked probe', action: 'Bash', action_input: { command: 'dir' }, observation: '{"success":false,"error":"Policy blocked action"}' },
    ];

    expect(assessCodingState(state).noProgressCount).toBe(0);
  });

  it('retains no-progress evidence across a semantic replay refusal', () => {
    const state = createState(0);
    state.steps = [
      { thought: 'probe 1', action: 'Read', action_input: { file_path: 'src/app.ts' }, observation: '{"success":true}' },
      { thought: 'probe 2', action: 'Read', action_input: { file_path: 'src/app.ts', offset: 1000 }, observation: '{"success":true}' },
      { thought: 'probe 3', action: 'Read', action_input: { file_path: 'src/app.ts', offset: 2000 }, observation: '{"success":true}' },
      {
        thought: 'semantic loop blocked',
        action: 'ReplayGuard',
        action_input: { semantic_path: 'src/app.ts' },
        observation: '{"success":false,"skipped":true,"error":"Semantic inspection loop prevented"}',
      },
    ];

    const assessment = assessCodingState(state);
    expect(assessment.noProgressCount).toBe(0);
    expect(assessment.state).toBe('implement');
  });

  it('counts repeated identical inspection evidence as no progress', () => {
    const state = createState(0);
    state.steps = [1, 2, 3].map((index) => ({
      thought: `probe ${index}`, action: 'Read', action_input: { file_path: 'src/app.ts' }, observation: '{"success":true,"output":"same evidence"}',
    }));
    expect(assessCodingState(state).noProgressCount).toBe(2);
  });

  it('allows a create task to implement after a successful empty workspace inspection', () => {
    const state = createState(0);
    state.taskAnalysis = { taskKind: 'new_feature', expectedChangeIntent: 'create', affectedFiles: [] } as any;
    state.steps = [{
      thought: 'inspect root',
      action: 'Command',
      action_input: { operation: 'list_directory', args: ['.'] },
      observation: '{"success":true,"status":"passed","output":""}',
    }];

    expect(hasEmptyWorkspaceInspectionEvidence(state)).toBe(true);
    expect(getStateEntryGateFailure(state, 'implement')).toBeNull();
    addStep(state, {
      thought: 'confirm empty',
      action: 'Glob',
      action_input: { pattern: '**/*' },
      observation: '{"success":true,"output":""}',
    });
    expect(state.codingState).toBe('implement');
  });

  it('lets an agent-led run leave inspection after reading its task document', () => {
    const state = createState(0);
    state.steps = [{
      thought: 'Read task brief',
      action: 'Read',
      action_input: { file_path: 'todo/todo.md' },
      observation: '{"success":true,"output":"Create the requested app."}',
    }];

    expect(getStateEntryGateFailure(state, 'implement')).toBeNull();
    addStep(state, {
      thought: 'Confirm requirements',
      action: 'Read',
      action_input: { file_path: 'todo/todo.md' },
      observation: '{"success":true,"output":"Create the requested app."}',
    });
    expect(state.codingState).toBe('implement');
  });

  it('treats successful JSON observations as evidence even when source text contains error words', () => {
    const state = createState(0);
    state.taskAnalysis = {
      taskKind: 'bug_fix', expectedChangeIntent: 'modify',
      affectedFiles: [{ path: 'src/app.ts', intent: 'modify', reason: 'target', mustReadBeforeEdit: true }],
    } as any;
    state.steps = [{
      thought: 'inspect',
      action: 'Read',
      action_input: { file_path: 'src/app.ts' },
      observation: JSON.stringify({ success: true, output: 'console.error("visible source text")' }),
    }];

    expect(hasRelevantInspectionEvidence(state)).toBe(true);
    expect(assessCodingState(state).state).toBe('verify');
  });

  it('blocks an alternating inspect/retry loop after three identical mutation failures', () => {
    const state = createState(0);
    const rejected = JSON.stringify({ success: false, error: 'Mutation rejected: src/app.ts was not read.' });
    state.steps = [
      { thought: 'write 1', action: 'Write', action_input: { file_path: 'src/app.ts' }, observation: rejected },
      { thought: 'inspect 1', action: 'Read', action_input: { file_path: 'src/app.ts' }, observation: '{"success":true,"output":"source"}' },
      { thought: 'write 2', action: 'Write', action_input: { file_path: 'src/app.ts' }, observation: rejected },
      { thought: 'inspect 2', action: 'Read', action_input: { file_path: 'src/app.ts' }, observation: '{"success":true,"output":"source"}' },
      { thought: 'write 3', action: 'Write', action_input: { file_path: 'src/app.ts' }, observation: rejected },
    ];

    const assessment = assessCodingState(state);
    expect(assessment.state).toBe('blocked');
    expect(assessment.blockReason).toContain('3-attempt safety limit');
  });

  it('gives stale Edit failures a targeted recovery instruction', () => {
    const state = createState(0);
    const rejected = JSON.stringify({
      success: false,
      error: 'Transactional Edit refused: old_string was not found in the guarded preimage.',
    });
    state.steps = [1, 2, 3].map((index) => ({
      thought: `edit ${index}`,
      action: 'Edit',
      action_input: { file_path: 'src/app.ts', old_string: 'stale', new_string: 'new' },
      observation: rejected,
    }));

    const assessment = assessCodingState(state);

    expect(assessment.state).toBe('blocked');
    expect(assessment.blockReason).toContain('new exact old_string');
    expect(assessment.blockReason).toContain('src/app.ts');
  });

  it('keeps repeated malformed Bash probes recoverable through the platform-aware command operation', () => {
    const state = createState(0);
    const rejected = JSON.stringify({
      success: false,
      error: `'dir"' is not recognized as an internal or external command, operable program or batch file.`,
    });
    state.steps = [1, 2, 3].map((index) => ({
      thought: `inspect ${index}`,
      action: 'Bash',
      action_input: { command: 'dir"' },
      observation: rejected,
    }));

    const assessment = assessCodingState(state);

    expect(assessment.state).not.toBe('blocked');
    expect(assessment.evidence.blocked).toBe(false);
  });

  it('stops repeated malformed inline Node evals with a quoting-specific recovery path', () => {
    const state = createState(0);
    const rejected = JSON.stringify({
      success: false,
      error: '[eval]:1\n"const\n^^^^^^\nUnterminated string constant\nSyntaxError: Invalid or unexpected token',
    });
    state.steps = [1, 2, 3].map((index) => ({
      thought: `verify ${index}`,
      action: 'Bash',
      action_input: { command: 'node -e "const fs=require(\\\'fs\\\')"' },
      observation: rejected,
    }));

    const assessment = assessCodingState(state);

    expect(assessment.state).toBe('blocked');
    expect(assessment.blockReason).toContain('inline Node eval');
    expect(assessment.blockReason).toContain('Do not retry this payload');
    expect(assessment.blockReason).toContain('repair only the declared task outputs');
    expect(classifyRecoveryTransition(state.steps.at(-1))).toBe('retry');
  });

  it('explains how to recover when a failed Bash check is followed by an unscoped verifier write', () => {
    const state = createState(0);
    const parseFailure = (index: number) => JSON.stringify({
      success: false,
      error: `[eval]:1\n"const${index}\n^^^^^^\nUnterminated string constant`,
    });
    state.steps = [1, 2, 3].map((index) => ({
      thought: `verify ${index}`,
      action: 'Bash',
      action_input: { command: `node -e "const fs=require(\\\'fs\\\'); // ${index}"` },
      observation: parseFailure(index),
    }));
    state.steps.push({
      thought: 'write verifier',
      action: 'Write',
      action_input: { file_path: 'verify.js', content: 'console.log("verify")' },
      observation: JSON.stringify({
        success: false,
        error: 'Mutation rejected: verify.js is not a declared task output. Do not create or inspect an unrequested verification helper to expand scope.',
      }),
    });

    const assessment = assessCodingState(state);

    expect(assessment.state).toBe('blocked');
    expect(assessment.blockReason).toContain('undeclared verification helper');
    expect(assessment.blockReason).toContain('Do not read or write it to expand scope');
    expect(assessment.blockReason).toContain('Command operation "verify"');
  });

  it('gives a targeted repair instruction for repeated invalid HTML verification', () => {
    const state = createState(0);
    const rejected = JSON.stringify({ success: false, error: 'Invalid HTML document: index.html' });
    state.steps = [1, 2, 3].map((index) => ({
      thought: `verify ${index}`,
      action: 'Command',
      action_input: { operation: 'verify', args: ['.'] },
      observation: rejected,
    }));

    const assessment = assessCodingState(state);

    expect(assessment.state).toBe('blocked');
    expect(assessment.blockReason).toContain('Read the reported HTML file');
    expect(assessment.blockReason).toContain('use Edit');
  });

  it('routes failed custom acceptance checks to repair and keeps their missing-content hint when paused', () => {
    const state = createState(0);
    state.steps = [
      'MISSING: <section id="about"',
      'MISSING: <section id="services"',
      'MISSING: <section id="contact"',
      'MISSING: contact link',
    ].map((diagnostic, index) => ({
      thought: `check output ${index + 1}`,
      action: 'Command',
      action_input: { operation: 'run', args: [`check-${index + 1}`] },
      observation: JSON.stringify({ success: false, error: diagnostic }),
    }));

    const assessment = assessCodingState(state);

    expect(assessment.state).toBe('blocked');
    expect(assessment.blockReason).toContain('MISSING: contact link');
    expect(assessment.blockReason).toContain('Read the file named by the check');
    expect(assessment.blockReason).toContain('implement the missing content');
    expect(classifyRecoveryTransition(state.steps.at(-1))).toBe('repair');
  });

  it('canonicalizes action argument key order for repeat detection', () => {
    const first = { action: 'Command', action_input: { operation: 'list_directory', args: ['.'] } };
    const reordered = { action: 'Command', action_input: { args: ['.'], operation: 'list_directory' } };

    expect(actionSignature(first as any)).toBe(actionSignature(reordered as any));
  });

  it('preserves the cause and recovery action when a missing scoped target is read repeatedly', () => {
    const state = createState(0);
    state.taskAnalysis = {
      expectedChangeIntent: 'modify',
      affectedFiles: [{ path: 'README.md', intent: 'modify', reason: 'Update project documentation.', mustReadBeforeEdit: true }],
    } as any;
    const rejected = JSON.stringify({ success: false, error: 'README.md does not exist.' });
    state.steps = [1, 2, 3].map((index) => ({
      thought: `read ${index}`,
      action: 'Read',
      action_input: { file_path: 'README.md' },
      observation: rejected,
    }));

    const details = getLatestReadFailureDetails(state);
    const assessment = assessCodingState(state);

    expect(details).toEqual(expect.objectContaining({
      target: 'README.md',
      missingTarget: true,
      canRecoverAsMutation: true,
    }));
    expect(details?.guidance).toContain('Choose Write');
    expect(assessment.blockReason).toContain('README.md');
    expect(assessment.blockReason).toContain('does not exist');
    expect(assessment.blockReason).toContain('allowCreate: true');
  });

  it('keeps source-document mutation failures on the document recovery path', () => {
    const state = createState(0);
    const rejected = JSON.stringify({
      success: false,
      status: 'invalid',
      error: 'Mutation rejected: resume.docx is a read-only source document.',
    });
    state.steps = [1, 2, 3].map((index) => ({
      thought: `write source document ${index}`,
      action: 'Write',
      action_input: { file_path: 'resume.docx', content: 'not a document update' },
      observation: rejected,
    }));

    expect(assessCodingState(state).state).not.toBe('blocked');
  });

  it.each([
    {
      command: 'ls -la',
      error: "'ls' is not recognized as an internal or external command",
      guidance: 'dir /a',
    },
    {
      command: 'npm test > /dev/null 2>&1',
      error: 'Native Windows command rejected: Unix-only syntax "/dev/null" requires an explicitly available Bash or WSL profile.',
      guidance: 'Replace "/dev/null" with "NUL"',
    },
  ])('gives repeated native Windows shell failures a concrete recovery path', ({ command, error, guidance }) => {
    const state = createState(0);
    const rejected = JSON.stringify({ success: false, error });
    state.steps = [1, 2, 3].map((index) => ({
      thought: 'retry shell command ' + index,
      action: 'Bash',
      action_input: { command },
      observation: rejected,
    }));

    const assessment = assessCodingState(state);

    expect(assessment.state).toBe('blocked');
    expect(assessment.blockReason).toContain(guidance);
  });

  it('resets repeated Read failures after a successful equivalent document inspection', () => {
    const state = createState(0);
    const rejected = JSON.stringify({
      success: false,
      error: 'Binary document resume.docx cannot be read as UTF-8 text. Use DocumentRead for PDF or DOCX extraction.',
    });
    state.steps = [
      { thought: 'read 1', action: 'Read', action_input: { file_path: 'resume.docx' }, observation: rejected },
      { thought: 'read 2', action: 'Read', action_input: { file_path: 'resume.docx' }, observation: rejected },
      { thought: 'extract document', action: 'DocumentRead', action_input: { file_path: 'resume.docx' }, observation: JSON.stringify({ success: true, output: 'resume text' }) },
      { thought: 'read again', action: 'Read', action_input: { file_path: 'resume.docx' }, observation: rejected },
    ];

    expect(assessCodingState(state).state).not.toBe('blocked');
  });

  it('resets repeated mutation failures after a successful edit of the same target', () => {
    const state = createState(0);
    const rejected = JSON.stringify({ success: false, error: 'Pattern not found' });
    const accepted = JSON.stringify({ success: true, output: 'updated' });
    state.steps = [
      { thought: 'write 1', action: 'Edit', action_input: { file_path: 'src/app.ts' }, observation: rejected },
      { thought: 'inspect', action: 'Read', action_input: { file_path: 'src/app.ts' }, observation: '{"success":true,"output":"source"}' },
      { thought: 'write 2', action: 'Edit', action_input: { file_path: 'src/app.ts' }, observation: rejected },
      { thought: 'repair', action: 'Edit', action_input: { file_path: 'src/app.ts' }, observation: accepted },
      { thought: 'inspect after edit', action: 'Read', action_input: { file_path: 'src/app.ts' }, observation: '{"success":true,"output":"updated source"}' },
      { thought: 'write 3', action: 'Edit', action_input: { file_path: 'src/app.ts' }, observation: rejected },
    ];

    expect(assessCodingState(state).state).not.toBe('blocked');
  });

  it('requires mutation and verification before review', () => {
    const state = createState(0);
    state.steps = [
      { thought: 'inspect', action: 'Read', action_input: { file_path: 'src/app.ts' }, observation: '{"success":true}' },
      { thought: 'edit', action: 'Edit', action_input: { file_path: 'src/app.ts' }, observation: '{"success":true}' },
      { thought: 'verify', action: 'Bash', action_input: { command: 'npm run test' }, observation: '{"success":true,"output":"tests passed"}' },
    ];
    expect(assessCodingState(state).state).toBe('review');
  });

  it('requires a relevant source read before implementation and source mutation before verification', () => {
    const state = createState(0);
    state.taskAnalysis = {
      taskKind: 'bug_fix', expectedChangeIntent: 'modify',
      affectedFiles: [
        { path: 'src/app.ts', intent: 'modify', reason: 'target', mustReadBeforeEdit: true },
        { path: 'src/view.ts', intent: 'modify', reason: 'second target', mustReadBeforeEdit: true },
      ],
    } as any;
    expect(getStateEntryGateFailure(state, 'implement')).toContain('inspect a relevant source file');

    state.steps.push({ thought: 'Read', action: 'Read', action_input: { file_path: 'src/app.ts' }, observation: '{"success":true}' });
    expect(getStateEntryGateFailure(state, 'implement')).toBeNull();
    expect(getStateEntryGateFailure(state, 'verify')).toContain('source mutation');

    state.steps.push({ thought: 'Edit', action: 'Edit', action_input: { file_path: 'src/app.ts' }, observation: '{"success":true}' });
    expect(hasSuccessfulSourceMutation(state)).toBe(true);
    expect(getStateEntryGateFailure(state, 'verify')).toBeNull();
    expect(getStateEntryGateFailure(state, 'complete')).toContain('verification');
  });

  it('allows verification against an inspected baseline only after all existing source targets are confirmed', () => {
    const state = createState(0);
    state.taskAnalysis = {
      taskKind: 'bug_fix', expectedChangeIntent: 'modify',
      affectedFiles: [
        { path: 'src/app.ts', intent: 'modify', reason: 'Application source.', mustReadBeforeEdit: true },
        { path: 'src/view.ts', intent: 'modify', reason: 'View source.', mustReadBeforeEdit: true },
      ],
    } as any;
    state.steps = [{
      thought: 'Inspect application source.',
      action: 'Read',
      action_input: { file_path: 'src/app.ts' },
      observation: '{"success":true,"output":"existing application source"}',
    }];

    expect(hasBaselineVerificationEvidence(state)).toBe(false);
    expect(getStateEntryGateFailure(state, 'verify')).toContain('source mutation');

    state.steps.push({
      thought: 'Confirm remaining workspace files.',
      action: 'WorkspaceChanges',
      action_input: {},
      observation: JSON.stringify({
        success: true,
        output: JSON.stringify({ files: [{ path: 'src/app.ts' }, { path: 'src/view.ts' }] }),
      }),
    });

    expect(hasBaselineVerificationEvidence(state)).toBe(true);
    expect(getStateEntryGateFailure(state, 'verify')).toBeNull();
    expect(getStateEntryGateFailure(state, 'complete')).toContain('verification');

    state.steps.push({
      thought: 'Run baseline verification.',
      action: 'Command',
      action_input: { operation: 'verify', args: ['npm', 'test'] },
      observation: JSON.stringify({ success: true, status: 'passed', output: 'tests passed' }),
    });

    expect(assessCodingState(state).state).toBe('review');
    expect(getStateEntryGateFailure(state, 'complete')).toBeNull();
  });

  it('inherits matching continuation mutation evidence only while the workspace remains based on the checkpoint', () => {
    const state = createState(0);
    state.taskAnalysis = {
      taskKind: 'bug_fix', expectedChangeIntent: 'modify',
      affectedFiles: [{ path: 'src/app.ts', intent: 'modify', reason: 'Application source.', mustReadBeforeEdit: true }],
    } as any;
    state.continuationHandoff = { updatedFiles: ['src/app.ts'] } as any;

    expect(hasSuccessfulSourceMutation(state)).toBe(true);
    expect(getStateEntryGateFailure(state, 'verify')).toBeNull();

    state.continuationHandoff = { updatedFiles: ['src/other.ts'] } as any;
    expect(hasSuccessfulSourceMutation(state)).toBe(false);
    expect(getStateEntryGateFailure(state, 'verify')).toContain('source mutation');

    state.continuationHandoff = { updatedFiles: ['src/app.ts'], workspaceRebased: true } as any;
    expect(hasSuccessfulSourceMutation(state)).toBe(false);
    expect(getStateEntryGateFailure(state, 'verify')).toContain('source mutation');
  });

  it('does not use baseline verification to skip create, delete, or rename source changes', () => {
    for (const intent of ['create', 'delete', 'rename'] as const) {
      const state = createState(0);
      state.taskAnalysis = {
        taskKind: 'bug_fix', expectedChangeIntent: 'modify',
        affectedFiles: [{ path: 'src/app.ts', intent, reason: 'Requested source change.', mustReadBeforeEdit: true }],
      } as any;
      state.steps = [{
        thought: 'Inspect the source target.',
        action: 'Read',
        action_input: { file_path: 'src/app.ts' },
        observation: '{"success":true,"output":"existing source"}',
      }];

      expect(hasBaselineVerificationEvidence(state)).toBe(false);
      expect(getStateEntryGateFailure(state, 'verify')).toContain('source mutation');
    }
  });

  it('does not let an is_done flag bypass hard completion evidence', () => {
    const state = createState(0);
    state.taskAnalysis = { taskKind: 'new_feature', expectedChangeIntent: 'modify', affectedFiles: [] } as any;
    state.steps = [{ thought: 'claim done', action: 'Read', action_input: { file_path: 'src/app.ts' }, observation: '{"success":true}', is_done: true }];
    expect(getStateEntryGateFailure(state, 'complete')).toContain('source mutation');
  });

  it('returns to inspection when restored or malformed state tries to verify without source evidence', () => {
    const state = createState(0);
    state.taskAnalysis = {
      taskKind: 'bug_fix', expectedChangeIntent: 'modify', affectedFiles: [],
      // This is the shape emitted by older runs. It must not disable the
      // source-mutation gate for a mutable task after the contract fix.
      contract: { completionEvidenceRequirements: { requireSourceMutationForFeatureCompletion: false } },
    } as any;
    state.codingState = 'implement';
    addStep(state, { thought: 'tracker-only mutation', action: 'Write', action_input: { file_path: 'TODO.md' }, observation: '{"success":true,"output":"updated tracker"}' });
    expect(state.codingState).toBe('inspect');
    expect(getStateExitGateFailure(state, 'implement', 'verify')).toContain('source mutation');
  });

  it('produces stable repeated-action signatures', () => {
    expect(actionSignature({ action: 'Read', action_input: { file_path: 'src/App.tsx' } }))
      .toBe('read:{"file_path":"src/app.tsx"}');
  });

  it('does not mistake eight distinct successful inspections for a loop', () => {
    const state = createState(0);
    state.steps = Array.from({ length: 8 }, (_, index) => ({
      thought: `inspect ${index}`,
      action: 'Read',
      action_input: { file_path: `src/file-${index}.ts` },
      observation: '{"success":true,"output":"source"}',
    }));

    expect(hasRepeatedSuccessfulInspectionLoop(state)).toBe(false);
  });

  it('detects a repeated successful inspection loop in the trailing window', () => {
    const state = createState(0);
    state.steps = [
      ...Array.from({ length: 4 }, (_, index) => ({
        thought: `inspect ${index}`,
        action: 'Read',
        action_input: { file_path: `src/file-${index}.ts` },
        observation: '{"success":true,"output":"source"}',
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        thought: `repeat ${index}`,
        action: 'Command',
        action_input: { operation: 'list_directory', args: ['.'] },
        observation: '{"success":true,"output":"src"}',
      })),
    ];

    expect(hasRepeatedSuccessfulInspectionLoop(state)).toBe(true);
  });

  it('opens the continuous-run circuit for repeated probes but not distinct inspections', () => {
    const repeated = createState(0);
    repeated.steps = Array.from({ length: 9 }, () => ({
      thought: 'check status',
      action: 'Command',
      action_input: { operation: 'process_inspect', args: ['server'] },
      observation: '{"success":true,"output":"server running"}',
    }));
    repeated.noProgressCount = assessCodingState(repeated).noProgressCount;

    const distinct = createState(0);
    distinct.steps = Array.from({ length: 8 }, (_, index) => ({
      thought: `inspect ${index}`,
      action: 'Read',
      action_input: { file_path: `logs/${index}.log` },
      observation: `{"success":true,"output":"sample ${index}"}`,
    }));
    distinct.noProgressCount = assessCodingState(distinct).noProgressCount;

    expect(shouldTripContinuousRunNoProgressCircuit(repeated, true)).toBe(true);
    expect(shouldTripContinuousRunNoProgressCircuit(distinct, true)).toBe(false);
    expect(shouldTripContinuousRunNoProgressCircuit(repeated, false)).toBe(false);
  });

  it('resets continuous-run no-progress evidence after a useful wait or a source change', () => {
    const waiting = createState(0);
    waiting.steps = [
      ...Array.from({ length: 9 }, () => ({
        thought: 'check status',
        action: 'Command',
        action_input: { operation: 'process_inspect', args: ['server'] },
        observation: '{"success":true,"output":"server running"}',
      })),
      {
        thought: 'wait for the service interval',
        action: 'Bash',
        action_input: { command: 'sleep 2' },
        observation: '{"success":true,"output":"waited"}',
      },
    ];
    waiting.noProgressCount = assessCodingState(waiting).noProgressCount;

    const progressed = createState(0);
    progressed.steps = [
      ...Array.from({ length: 9 }, () => ({
        thought: 'check status',
        action: 'Command',
        action_input: { operation: 'process_inspect', args: ['server'] },
        observation: '{"success":true,"output":"server running"}',
      })),
      {
        thought: 'record the discovered state',
        action: 'Write',
        action_input: { file_path: 'status.md' },
        observation: '{"success":true,"output":"updated status.md"}',
      },
    ];
    progressed.noProgressCount = assessCodingState(progressed).noProgressCount;

    expect(waiting.noProgressCount).toBe(0);
    expect(progressed.noProgressCount).toBe(0);
    expect(shouldTripContinuousRunNoProgressCircuit(waiting, true)).toBe(false);
    expect(shouldTripContinuousRunNoProgressCircuit(progressed, true)).toBe(false);
  });

  it('enforces bounded per-state step budgets', () => {
    const state = createState(0);
    state.codingState = 'inspect';
    state.codingStateStartedStep = 2;
    state.current_step = 2 + getCodingStateBudget('inspect');
    expect(isCodingStateBudgetExceeded(state)).toBe(true);
  });

  it('classifies failure-specific recovery transitions deterministically', () => {
    expect(classifyRecoveryTransition({ action: 'Edit', action_input: {}, observation: 'Pattern not found' })).toBe('inspect');
    expect(classifyRecoveryTransition({ action: 'Write', action_input: {}, observation: '{"success":false,"error":"permission denied"}' })).toBe('blocked');
    expect(classifyRecoveryTransition({
      action: 'Command',
      action_input: { operation: 'build', args: ['npm install'] },
      observation: '{"success":false,"error":"Policy blocked action","policy":{"requiresApproval":true}}',
    })).toBe('blocked');
    expect(classifyRecoveryTransition({ action: 'Bash', action_input: { command: 'npm test' }, observation: '{"success":false,"error":"failed"}' })).toBe('repair');
    expect(classifyRecoveryTransition({ action: 'Read', action_input: {}, observation: 'Invalid JSON in tool selection' })).toBe('retry');
    expect(classifyRecoveryTransition({ action: 'Read', action_input: {}, observation: 'context window token limit exceeded' })).toBe('summarize');
  });

  it('moves directly to blocked when a policy result requires approval', () => {
    const state = createState(0);
    addStep(state, {
      thought: 'Install required dependencies.',
      action: 'Command',
      action_input: { operation: 'build', args: ['npm install'] },
      observation: '{"success":false,"error":"Policy blocked action: explicit approval required","policy":{"requiresApproval":true}}',
    });

    expect(state.codingState).toBe('blocked');
    expect(state.blockedReason).toContain('External confirmation or permission');
  });

  it('turns the Git initialization confirmation into a structured approval request', () => {
    const state = createState(0);
    state.steps = [{
      thought: 'Check Git status before mutation.',
      action: 'Bash',
      action_input: { command: 'git status --short' },
      observation: JSON.stringify({
        success: true,
        output: 'No Git repository was detected.\nBefore initializing Git here, ask the user for confirmation.\nIf the user approves, run `git init` in this workspace.',
      }),
    }];

    expect(getPendingApprovalRequest(state)).toEqual({
      category: 'git',
      risk: 'low',
      scope: 'git:git init',
      summary: 'Initialize Git in the current workspace',
      reason: 'No Git repository was detected. Initializing Git changes workspace metadata and requires your confirmation.',
    });
  });

  it('leaves the blocked state after approval is granted and a resumed action succeeds', () => {
    const state = createState(0);
    addStep(state, {
      thought: 'Install required dependencies.',
      action: 'Command',
      action_input: { operation: 'build', args: ['npm install'] },
      observation: '{"success":false,"error":"Policy blocked action","policy":{"requiresApproval":true}}',
    });
    addStep(state, {
      thought: 'Resume after approval.',
      action: 'Read',
      action_input: { file_path: 'package.json' },
      observation: '{"success":true,"output":"{}"}',
    });

    expect(state.codingState).not.toBe('blocked');
    expect(state.blockedReason).toBeUndefined();
  });

  it('enforces a wall-clock budget per coding state', () => {
    const state = createState(0);
    state.codingState = 'verify';
    state.codingStateStartedAt = 10_000;
    expect(isCodingStateTimeBudgetExceeded(state, 10_000 + getCodingStateTimeBudget('verify'))).toBe(true);
  });

  it('allows only evidence-compatible state transitions', () => {
    expect(isCodingStateTransitionAllowed('inspect', 'implement')).toBe(true);
    expect(isCodingStateTransitionAllowed('implement', 'complete')).toBe(false);
    expect(isCodingStateTransitionAllowed('blocked', 'inspect')).toBe(true);
  });

  it('exports coding-state lifecycle policy through Engine and preserves the app facade', () => {
    expect(getEngineCodingStateBudget('inspect')).toBe(getCodingStateBudget('inspect'));
    expect(isEngineCodingStateTransitionAllowed('implement', 'complete')).toBe(
      isCodingStateTransitionAllowed('implement', 'complete'),
    );
  });
});

describe('edit stagnation detection and circuit breaker', () => {
  it('detects hash conflict and stale preimage errors', () => {
    expect(isHashConflictOrStalePreimageError('Transactional Edit refused: stale expected hash.')).toBe(true);
    expect(isHashConflictOrStalePreimageError('Transactional Edit refused: old_string was not found in the guarded preimage.')).toBe(true);
    expect(isHashConflictOrStalePreimageError('Transactional Edit refused: expectedHash from a guarded read is required.')).toBe(true);
    expect(isHashConflictOrStalePreimageError('Pattern not found in file. The string to replace does not exist exactly as...')).toBe(true);
    expect(isHashConflictOrStalePreimageError('{"success":true,"output":"ok"}')).toBe(false);
    expect(isHashConflictOrStalePreimageError('File not found')).toBe(false);
    expect(isHashConflictOrStalePreimageError(undefined)).toBe(false);
  });

  it('tracks consecutive mutation failures per file and resets on success', () => {
    const state = createState(0);
    expect(state.consecutiveEditFailureCount).toBeUndefined();

    trackMutationFailure(state, 'todo.md', true);
    expect(state.consecutiveEditFailureCount).toBe(1);
    expect(state.consecutiveEditFailureTarget).toBe('todo.md');
    expect(isEditStagnated(state)).toBe(false);

    trackMutationFailure(state, 'todo.md', true);
    expect(state.consecutiveEditFailureCount).toBe(2);
    expect(isEditStagnated(state)).toBe(false);

    trackMutationFailure(state, 'todo.md', true);
    expect(state.consecutiveEditFailureCount).toBe(3);
    expect(isEditStagnated(state)).toBe(true);

    // Reset on success
    trackMutationFailure(state, undefined, false);
    expect(state.consecutiveEditFailureCount).toBe(0);
    expect(state.consecutiveEditFailureTarget).toBeUndefined();
    expect(isEditStagnated(state)).toBe(false);
  });

  it('resets failure count to 1 when switching to a different target file', () => {
    const state = createState(0);

    trackMutationFailure(state, 'todo.md', true);
    trackMutationFailure(state, 'todo.md', true);
    expect(state.consecutiveEditFailureCount).toBe(2);

    // Switch to different file
    trackMutationFailure(state, 'other.ts', true);
    expect(state.consecutiveEditFailureCount).toBe(1);
    expect(state.consecutiveEditFailureTarget).toBe('other.ts');
  });
});
