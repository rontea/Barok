/**
 * ReAct Engine Core Logic Tests
 * 
 * Tests cover:
 * - Step transitions (Reason → Plan → Act → Observe)
 * - Tool execution flow and result handling
 * - Retry behavior and fallback chains
 * - Budget tracking and limits
 * - Max-step termination
 * - Delegation to sub-agents
 */

import { jest, describe, it, beforeEach, expect } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mock modules BEFORE importing the module under test
jest.unstable_mockModule('../../tools/devTools', () => ({
  getAllToolDefinitions: jest.fn(() => [
    {
      name: 'Bash',
      description: 'Execute bash command',
      inputSchema: { type: 'object' },
      handler: jest.fn().mockResolvedValue({ success: true, output: 'ok' }),
    },
  ]),
  setWorkspace: jest.fn(),
  getWorkspace: jest.fn(() => '/test/workspace'),
  runWithWorkspace: jest.fn((_workspace: string, callback: () => unknown) => callback()),
}));

jest.unstable_mockModule('../../pollinations/client', () => ({
  PollinationsClient: jest.fn(() => ({
    chatCompletion: jest.fn(),
    setApiKey: jest.fn(),
  })),
  pollinationsClient: {
    chatCompletion: jest.fn(),
    setApiKey: jest.fn(),
  },
}));

jest.unstable_mockModule('../../agents/crew', () => ({
  CrewCoordinator: jest.fn(),
}));

jest.unstable_mockModule('../../react/logger', () => ({
  recordRunResult: jest.fn(),
  getPastRuns: jest.fn(),
  getRawLogFile: jest.fn(),
  clearAllLogs: jest.fn(),
}));

// Now import modules that were mocked
const { ReActEngine, isSuccessfulToolObservation, genericVerificationObservation, getCompletionEvidenceFailure, getDeterministicCoderCompletionAnswer, formatContractVerificationFailure, applyScopedVerificationRepair, enforcePhasedExecutionBoundary, getExecutionPacingIntervalMs, getToolPresentationDelayMs, getDecisionPresentationDelayMs, hasVerifiedPhaseEvidence, resolveRunTaskAnalysis, applyRunTaskAnalysis, isUnadvancedLastRunReplay, getSemanticInspectionReplayReason, getRecentUnchangedReadLoopReason, selectVisibleReasoningSummary } = await import('../engine');
const { pollinationsClient } = await import('../../pollinations/client');
const { getWorkspaceRelativePath } = await import('../../tools/pathValidator');
const { nodeReActEngineRuntime } = await import('../../di/reactEngineDefaults');
const devToolsModule = await import('../../tools/devTools');
const { isEditStagnated, trackMutationFailure } = await import('../state-manager');
const reactLoggerModule = await import('../../react/logger');

describe('visible action reasoning', () => {
  it('does not present the native planning placeholder as agent reasoning', () => {
    expect(selectVisibleReasoningSummary({
      providerReasoningSummary: '',
      modelReasoningSummary: 'Use the current task evidence and select the next concrete tool action.',
      actionRationale: '',
      actionSummary: 'I’m reading src/index.ts to inspect the current implementation.',
    })).toEqual({
      summary: 'I’m reading src/index.ts to inspect the current implementation.',
      origin: 'engine',
    });
  });

  it('preserves a bounded rationale supplied with the selected action', () => {
    expect(selectVisibleReasoningSummary({
      providerReasoningSummary: '',
      modelReasoningSummary: 'Use the current task evidence to choose the next concrete action.',
      actionRationale: 'I need to inspect initialization before changing it.',
      actionSummary: 'I’m reading src/index.ts.',
    })).toEqual({
      summary: 'I need to inspect initialization before changing it.',
      origin: 'model',
    });
  });
});

describe('ReActEngine', () => {
  let engine: any;
  let mockChatCompletion: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    // Update the mock for this test
    mockChatCompletion = pollinationsClient.chatCompletion as jest.Mock;
    mockChatCompletion.mockResolvedValue({
      content: 'I will read the file',
    });

    engine = new ReActEngine({
      model: 'test-model',
      maxSteps: 5,
      verbose: false,
      budget: 100,
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  it('creates the unauthenticated Pollinations fallback through the runtime port', async () => {
    const fallbackChatCompletion = jest.fn(async () => ({ content: 'host fallback response' }));
    const createUnauthenticatedPollinationsClient = jest.fn(() => ({
      chatCompletion: fallbackChatCompletion,
    }));
    const runtime = {
      ...nodeReActEngineRuntime,
      createUnauthenticatedPollinationsClient,
    };
    const runtimeEngine = new ReActEngine({
      model: 'test-model',
      runtime,
      budget: 100,
    });

    const result = await (runtimeEngine as any).generatePollinationsWithRetry(
      [{ role: 'user', content: 'test' }],
      'openai-fast',
      false,
    );

    expect(result).toBe('host fallback response');
    expect(createUnauthenticatedPollinationsClient).toHaveBeenCalledTimes(1);
    expect(fallbackChatCompletion).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: 'test' }],
      model: 'openai-fast',
    });
  });

  // BASIC FUNCTIONALITY TESTS
  // ──────────────────────────────────────────────────────────────────────────

  it('classifies decision categories from structured state and action fixtures only', () => {
    const classify = (codingState: string, action: string, input: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
      (engine as any).classifyDecisionCategory({ codingState, plan: [], ...extra }, action, input);

    expect(classify('understand', 'Read')).toBe('inspection');
    expect(classify('plan', 'Todo')).toBe('coordination');
    expect(classify('implement', 'Write')).toBe('implementation');
    expect(classify('verify', 'Command', { operation: 'verify' })).toBe('verification');
    expect(classify('repair', 'Write')).toBe('recovery');
    expect(classify('awaiting_plan_approval', 'AskUserQuestion')).toBe('clarification');
    expect(classify('review', 'CustomTool')).toBe('completion');
    expect(classify('unrecognized_state', 'CustomTool')).toBe('unknown');
    expect(classify('understand', 'CustomTool', {}, { recoveryReason: 'invalid_tool_selection' })).toBe('recovery');
  });

  it('emits planner guidance snapshots across state changes and includes active gate failures', () => {
    const events: any[] = [];
    const eventEngine = new ReActEngine({ model: 'test-model', onEvent: (event) => events.push(event) });
    const emitSnapshot = (eventEngine as any).emitPlannerGuidanceSnapshot.bind(eventEngine);

    emitSnapshot({
      codingState: 'inspect',
      injectedDirective: 'Inspect relevant source.',
      permissionConstraints: ['Workspace mutation requires approval.'],
      activeGateFailures: [],
      contextBudgetUsed: 1_200,
    }, 3, 'step-inspect');
    emitSnapshot({
      codingState: 'verify',
      injectedDirective: 'Run the applicable verification now.',
      permissionConstraints: ['Workspace mutation requires approval.'],
      activeGateFailures: ['Verification evidence is still required.'],
      contextBudgetUsed: 1_450,
    }, 4, 'step-verify');

    expect(events.filter((event) => event.type === 'agent_guidance_snapshot')).toEqual([
      expect.objectContaining({
        type: 'agent_guidance_snapshot',
        codingState: 'inspect',
        injectedDirective: 'Inspect relevant source.',
        activeGateFailures: [],
        contextBudgetUsed: 1_200,
        step: 3,
        stepId: 'step-inspect',
      }),
      expect.objectContaining({
        type: 'agent_guidance_snapshot',
        codingState: 'verify',
        injectedDirective: 'Run the applicable verification now.',
        activeGateFailures: ['Verification evidence is still required.'],
        contextBudgetUsed: 1_450,
        step: 4,
        stepId: 'step-verify',
      }),
    ]);
  });

  it('keeps child dispatch opt-in and records bounded reports in parent state and events', async () => {
    const events: any[] = [];
    const updates: any[] = [];
    const report = {
      protocolVersion: 1,
      childId: 'child-1',
      success: true,
      changedFiles: ['src/alpha.ts'],
      checks: [{ name: 'scoped verification', status: 'passed' }],
      blockers: [],
      evidenceRefs: ['child-1:check'],
      createdAt: 1,
    };
    const dispatchResult = {
      status: 'completed',
      trigger: 'context_pressure',
      model: 'pinned-model',
      contextWindow: 32_768,
      contracts: [],
      reports: [report],
      blockers: [],
      createdAt: 1,
    };
    const parentState: any = {
      task: 'Parent task',
      workspace: '/workspace-with-no-tracked-inputs',
      steps: [],
      plan: [],
      current_step: 0,
      max_steps: 10,
      total_pollen_cost: 0,
      budget: 100,
      modelContextWindow: 32_768,
    };

    const disabledEngine = new ReActEngine({ model: 'pinned-model' }) as any;
    expect(await disabledEngine.dispatchSubtasks(parentState, 'context_pressure')).toBe(false);
    expect(parentState.subtaskDispatch).toBeUndefined();

    const enabledEngine = new ReActEngine({
      model: 'pinned-model',
      contextWindow: 32_768,
      onSubtaskDispatch: async () => dispatchResult as any,
      onEvent: (event) => events.push(event),
      onStateUpdate: (state) => updates.push(state),
    }) as any;
    expect(await enabledEngine.dispatchSubtasks(parentState, 'context_pressure')).toBe(true);

    expect(parentState.subtaskDispatch.reports).toEqual([report]);
    expect(updates.at(-1).subtaskDispatch.reports).toEqual([report]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'subtask_dispatch_started', trigger: 'context_pressure' }),
      expect.objectContaining({
        type: 'subtask_dispatch_result',
        status: 'completed',
        trigger: 'context_pressure',
        childCount: 1,
        reports: [expect.objectContaining({ childId: 'child-1', changedFiles: ['src/alpha.ts'] })],
      }),
    ]));
  });

  describe('Basic Engine Operations', () => {
    it('should initialize with correct config', () => {
      expect(engine).toBeDefined();
      expect(engine.config.maxSteps).toBe(5);
      expect(engine.config.budget).toBe(100);
      expect(engine.config).not.toHaveProperty('agentDirective');
    });

    it('keeps continuous runs completion-driven instead of applying turn budgets', () => {
      const continuous = new ReActEngine({
        model: 'test-model',
        continuousRun: true,
        maxSteps: 1,
        maxLlmRequestsPerTask: 1,
        maxToolCalls: 1,
        budget: 1,
      }) as any;

      expect(continuous.config.continuousRun).toBe(true);
      expect(continuous.config.maxSteps).toBe(1);
      expect(continuous.config.globalStepLimit).toBe(1_000);
      expect(continuous.config.maxLlmRequestsPerTask).toBe(Number.POSITIVE_INFINITY);
      expect(continuous.config.maxToolCalls).toBe(Number.POSITIVE_INFINITY);
      expect(continuous.config.budget).toBeGreaterThan(1_000_000_000_000);
    });

    it('stops a run before another model turn when the durable wall-clock budget is spent', async () => {
      const engineWithExpiredWallClock = new ReActEngine({
        model: 'test-model',
        maxSteps: 5,
        wallClockBudgetMs: 1_000,
        runStartedAt: Date.now() - 2_000,
        budget: 100,
      });

      const result = await engineWithExpiredWallClock.run('continue the task');

      expect(result.errorCode).toBe('RUN_WALL_CLOCK_LIMIT_EXCEEDED');
      expect(result.recoverable).toBe(true);
      expect(result.steps).toHaveLength(0);
    });

    it('stops a restored run when its finite global action budget is exhausted', async () => {
      const engineWithExhaustedGlobalBudget = new ReActEngine({
        model: 'test-model',
        continuousRun: true,
        maxSteps: 20,
        globalStepLimit: 2,
        budget: 100,
      });

      const result = await engineWithExhaustedGlobalBudget.run('continue the task', {
        current_step: 2,
        max_steps: 20,
        globalStepCount: 2,
        steps: [],
      });

      expect(result.errorCode).toBe('GLOBAL_STEP_LIMIT_EXCEEDED');
      expect(result.recoverable).toBe(true);
    });

    it('rolls the recovery window over instead of blocking at the limit', () => {
      const onProgress = jest.fn();
      const recoveryEngine = new ReActEngine({
        model: 'test-model',
        maxRecoveryTransitions: 1,
        onProgress,
        budget: 100,
      });
      const state: any = {
        task: 'recover the task',
        workspace: '/workspace',
        plan: [],
        steps: [],
        current_step: 2,
        max_steps: 5,
        globalStepLimit: 5,
        globalStepCount: 2,
        total_pollen_cost: 0,
        budget: 100,
        repairAttempts: 0,
        codingState: 'implement',
        recoveryCount: 1,
        recoveryWindowCount: 1,
        maxRecoveryTransitions: 1,
      };

      const firstRecord = (recoveryEngine as any).transitionToRecovery(state, 'provider_failure', 'temporary provider failure');
      const nextWindowRecord = (recoveryEngine as any).transitionToRecovery(state, 'provider_failure', 'temporary provider failure again');

      expect(firstRecord.attempt).toBe(1);
      expect(nextWindowRecord.attempt).toBe(1);
      expect(state.recoveryCount).toBe(3);
      expect(state.recoveryWindowCount).toBe(1);
      expect(state.codingState).not.toBe('blocked');
      expect(state.recoveryHistory).toHaveLength(2);
      expect(onProgress.mock.calls.filter(([message]) => String(message).includes('continuing in a fresh recovery window'))).toHaveLength(2);
    });

    it('reopens a saved recovery-budget checkpoint when the task resumes', () => {
      const onProgress = jest.fn();
      const recoveryEngine = new ReActEngine({ model: 'test-model', onProgress, budget: 100 });
      const state: any = {
        task: 'finish the saved task',
        workspace: '/workspace',
        plan: [],
        steps: [],
        current_step: 8,
        max_steps: 20,
        globalStepLimit: 100,
        globalStepCount: 8,
        total_pollen_cost: 0,
        budget: 100,
        repairAttempts: 0,
        codingState: 'blocked',
        blockedReason: 'Run recovery budget reached after 8 transitions. Progress was saved at a checkpoint; review the provider, task, or workspace before continuing.',
        outcome: 'blocked',
        recoveryReason: 'provider_failure',
        recoveryCount: 8,
        recoveryWindowCount: 8,
        maxRecoveryTransitions: 8,
        sharedState: 'failed',
        sharedTransitions: [],
      };

      const resumed = (recoveryEngine as any).resumeRecoveryBudgetCheckpoint(state);

      expect(resumed).toBe(true);
      expect(state).toMatchObject({ codingState: 'repair', recoveryCount: 8, recoveryWindowCount: 0, sharedState: 'repairing' });
      expect(state.blockedReason).toBeUndefined();
      expect(state.outcome).toBeUndefined();
      expect(state.sharedTransitions.at(-1)).toMatchObject({ reason: 'recovery_budget_checkpoint_resumed', from: 'failed', to: 'repairing' });
      expect(onProgress).toHaveBeenCalledWith('Resuming the saved task in repair state with a fresh recovery window.');
    });

    it('should create engine instance', () => {
      expect(engine).toBeInstanceOf(ReActEngine);
    });

    it('hydrates the optional Cordis context from an observable durable snapshot', async () => {
      const contextSnapshot = {
        version: 1 as const,
        runId: 'saved-run',
        contextId: 'saved-run:react-context',
        revision: 2,
        eventSeq: 7,
        model: 'test-model',
        modelContextWindow: 32_000,
        tokenEstimate: 18,
        compactionVersion: 'test-v1',
        messages: [{ id: 'task', role: 'user' as const, content: 'saved task', sourceEventSeq: 7 }],
        evidenceIds: ['evidence-1'],
        createdAt: 1,
        updatedAt: 2,
      };
      const hydrated = new ReActEngine({ model: 'test-model', contextSnapshot });
      expect((hydrated as any).capabilityScope.cordis.context.get('contextSnapshot')).toEqual(contextSnapshot);
      await (hydrated as any).capabilityScope.dispose('hydration_test_complete');
    });

    it('blocks an ambiguous mutable contract before requesting a model decision', async () => {
      let modelCalls = 0;
      const guardedEngine = new ReActEngine({
        model: 'test-model',
        maxSteps: 5,
        budget: 100,
        workspace: '/test/workspace',
        llmProvider: {
          createChatCompletion: async () => {
            modelCalls += 1;
            return '{"tool":"Read","arguments":{}}';
          },
          estimateStepCost: () => 0,
          getProviderName: () => 'mock',
          isAvailable: () => true,
        },
        taskAnalysis: {
          id: 'ambiguous-request',
          taskKind: 'bug_fix',
          expectedChangeIntent: 'modify',
          affectedFiles: [],
          contract: {
            blocker: {
              code: 'missing_acceptance_criteria',
              message: 'The requested mutation is too broad to execute safely.',
              resolution: 'Identify the target and success condition.',
            },
          },
        } as any,
      });

      const result = await guardedEngine.run('Fix the website.');

      expect(modelCalls).toBe(0);
      expect(result.outcome).toBe('blocked');
      expect(result.error).toContain('too broad');
    });

    it('returns a resumable blocked result when forced mutation correction keeps selecting Read', async () => {
      const responses = [
        '{"tool":"Read","arguments":{"file_path":"src/app.ts"}}',
        '{"tool":"Read","arguments":{"file_path":"src/app.ts"}}',
        '{"tool":"Read","arguments":{"file_path":"src/app.ts"}}',
      ];
      let calls = 0;
      const tools = [
        { name: 'Read', description: 'Read a file', inputSchema: { type: 'object' }, handler: jest.fn() },
        { name: 'Write', description: 'Write a file', inputSchema: { type: 'object' }, handler: jest.fn() },
        { name: 'Edit', description: 'Edit a file', inputSchema: { type: 'object' }, handler: jest.fn() },
      ];
      const toolRegistry = {
        getAll: () => tools,
        get: (name: string) => tools.find((tool) => tool.name === name),
        getEnabled: () => tools,
        has: (name: string) => tools.some((tool) => tool.name === name),
        register: jest.fn(),
        setEnabled: jest.fn(),
        getNames: () => tools.map((tool) => tool.name),
        size: () => tools.length,
      };
      const recoveryEngine = new ReActEngine({
        model: 'test-model',
        maxSteps: 5,
        budget: 100,
        workspace: '/test/workspace',
        toolRegistry,
        llmProvider: {
          createChatCompletion: async () => responses[Math.min(calls++, responses.length - 1)],
          estimateStepCost: () => 0,
          getProviderName: () => 'mock',
          isAvailable: () => true,
        },
        taskAnalysis: {
          id: 'forced-mutation-recovery',
          taskKind: 'feature',
          expectedChangeIntent: 'modify',
          approvalPolicy: 'full_access',
          contract: {
            candidateFiles: ['src/app.ts'],
            completionEvidenceRequirements: { requireSourceMutationForFeatureCompletion: true },
          },
          affectedFiles: [{ path: 'src/app.ts', intent: 'modify' }],
          requiredInspections: [],
          verificationPlan: [],
          validationRequirements: [],
          sourceFiles: [],
          riskFactors: [],
        } as any,
      });

      const result = await recoveryEngine.run('Implement the requested change.', {
        codingState: 'implement',
        forceMutationNextAction: true,
        noProgressCount: 4,
      });

      expect(result.outcome).toBe('blocked');
      expect(result.recoverable).toBe(true);
      expect(result.error).toContain('Resume with a scoped Write or Edit action.');
      expect(calls).toBe(16);
    });

    it('directs the agent to implementation and recovers from a guarded forced mutation', async () => {
      const workspace = mkdtempSync(path.join(os.tmpdir(), 'barok-forced-mutation-'));
      mkdirSync(path.join(workspace, 'src'), { recursive: true });
      writeFileSync(path.join(workspace, 'src/app.ts'), 'current source');
      const currentHash = createHash('sha256').update('current source').digest('hex');
      let planCalls = 0;
      const responses = [
        '{"tool":"Read","arguments":{"file_path":"src/app.ts"}}',
        '{"tool":"Read","arguments":{"file_path":"src/app.ts"}}',
        '{"tool":"Read","arguments":{"file_path":"src/app.ts"}}',
        '{"tool":"Write","arguments":{"file_path":"src/app.ts","content":"fixed"}}',
      ];
      const readHandler = jest.fn().mockResolvedValue({
        success: true,
        output: `current source\n[guarded-read-hash: ${currentHash}]`,
      });
      const writeHandler = jest.fn().mockResolvedValue({ success: true, output: 'written' });
      const tools = [
        { name: 'Read', description: 'Read a file', inputSchema: { type: 'object' }, handler: readHandler },
        { name: 'Write', description: 'Write a file', inputSchema: { type: 'object' }, handler: writeHandler },
        { name: 'Edit', description: 'Edit a file', inputSchema: { type: 'object' }, handler: jest.fn() },
      ];
      const toolRegistry = {
        getAll: () => tools,
        get: (name: string) => tools.find((tool) => tool.name === name),
        getEnabled: () => tools,
        has: (name: string) => tools.some((tool) => tool.name === name),
        register: jest.fn(),
        setEnabled: jest.fn(),
        getNames: () => tools.map((tool) => tool.name),
        size: () => tools.length,
      };
      const hostToolExecutor = jest.fn(async (...args: Parameters<typeof nodeReActEngineRuntime.executeToolAction>) =>
        nodeReActEngineRuntime.executeToolAction(...args));
      const recoveryEngine = new ReActEngine({
        model: 'test-model',
        maxSteps: 5,
        budget: 100,
        workspace,
        toolRegistry,
        runtime: { ...nodeReActEngineRuntime, executeToolAction: hostToolExecutor },
        llmProvider: {
          createChatCompletion: async (_messages, _model, options) => {
            if (options?.requestKind === 'step.reason') return 'Implement the change.';
            if (options?.requestKind === 'step.check_done') {
              return readFileSync(path.join(workspace, 'src/app.ts'), 'utf8') === 'fixed' ? 'true' : 'false';
            }
            if (options?.requestKind === 'step.plan_action') {
              return responses[Math.min(planCalls++, responses.length - 1)];
            }
            return 'Complete the requested change.';
          },
          estimateStepCost: () => 0,
          getProviderName: () => 'mock',
          isAvailable: () => true,
        },
        taskAnalysis: {
          id: 'directed-mutation-recovery',
          taskKind: 'feature',
          expectedChangeIntent: 'modify',
          approvalPolicy: 'full_access',
          contract: {
            candidateFiles: ['src/app.ts'],
            completionEvidenceRequirements: { requireSourceMutationForFeatureCompletion: true },
          },
          affectedFiles: [{ path: 'src/app.ts', intent: 'modify' }],
          requiredInspections: [],
          verificationPlan: [],
          validationRequirements: [],
          sourceFiles: [],
          riskFactors: [],
        } as any,
      });

      try {
        const result = await recoveryEngine.run('Implement the requested change.', {
          codingState: 'implement',
          forceMutationNextAction: true,
          forceMutationTarget: 'src/app.ts',
          noProgressCount: 4,
        });

        expect(result.outcome).not.toBe('blocked');
        expect(hostToolExecutor).toHaveBeenCalled();
        expect(readHandler).toHaveBeenCalledTimes(1);
        expect(readHandler.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ file_path: 'src/app.ts' }));
        expect(writeHandler).not.toHaveBeenCalled();
        expect(readFileSync(path.join(workspace, 'src/app.ts'), 'utf8')).toBe('fixed');
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    });

    it('allows one targeted read when failed-mutation recovery overlaps forced mutation recovery', async () => {
      const readHandler = jest.fn().mockResolvedValue({
        success: true,
        output: 'current source',
        hash: 'a'.repeat(64),
      });
      const tools = [
        { name: 'Read', description: 'Read a file', inputSchema: { type: 'object' }, handler: readHandler },
        { name: 'Write', description: 'Write a file', inputSchema: { type: 'object' }, handler: jest.fn() },
        { name: 'Edit', description: 'Edit a file', inputSchema: { type: 'object' }, handler: jest.fn() },
      ];
      const toolRegistry = {
        getAll: () => tools,
        get: (name: string) => tools.find((tool) => tool.name === name),
        getEnabled: () => tools,
        has: (name: string) => tools.some((tool) => tool.name === name),
        register: jest.fn(),
        setEnabled: jest.fn(),
        getNames: () => tools.map((tool) => tool.name),
        size: () => tools.length,
      };
      let planCalls = 0;
      let latestSnapshot: any;
      const recoveryEngine = new ReActEngine({
        model: 'test-model',
        maxSteps: 1,
        budget: 100,
        workspace: '/test/workspace',
        toolRegistry,
        onStateUpdate: (snapshot) => {
          latestSnapshot = snapshot;
        },
        llmProvider: {
          createChatCompletion: async (_messages, _model, options) => {
            if (options?.requestKind === 'step.reason') return 'Repair the affected source file.';
            if (options?.requestKind === 'step.plan_action') {
              planCalls += 1;
              return '{"tool":"Write","arguments":{"file_path":"src/app.ts","content":"new"}}';
            }
            return 'false';
          },
          estimateStepCost: () => 0,
          getProviderName: () => 'mock',
          isAvailable: () => true,
        },
        taskAnalysis: {
          id: 'overlapping-mutation-recovery',
          taskKind: 'feature',
          expectedChangeIntent: 'modify',
          approvalPolicy: 'full_access',
          contract: {
            candidateFiles: ['src/app.ts'],
            completionEvidenceRequirements: { requireSourceMutationForFeatureCompletion: true },
          },
          affectedFiles: [{ path: 'src/app.ts', intent: 'modify' }],
          requiredInspections: [],
          verificationPlan: [],
          validationRequirements: [],
          sourceFiles: [],
          riskFactors: [],
        } as any,
      });

      const result = await recoveryEngine.run('Repair the affected source file.', {
        codingState: 'implement',
        forceMutationNextAction: true,
        forceMutationTarget: 'src/app.ts',
        forceReadNextAction: true,
        forceReadTarget: 'src/app.ts',
        noProgressCount: 4,
        steps: [{
          thought: 'Apply the repair.',
          action: 'Edit',
          action_input: { file_path: 'src/app.ts', old_string: 'stale', new_string: 'new' },
          observation: JSON.stringify({ success: false, error: 'old_string was not found' }),
        }],
      });

      expect(result.error).toBe('Turn limit reached. Progress was saved at a checkpoint; continue to resume the task.');
      expect(readHandler).toHaveBeenCalledTimes(1);
      expect(planCalls).toBe(1);
      expect(latestSnapshot?.forceReadNextAction).toBe(false);
      expect(latestSnapshot?.forceMutationNextAction).toBe(true);
    });

    it('releases forced read recovery after the targeted read fails', async () => {
      const readHandler = jest.fn().mockResolvedValue({
        success: false,
        error: 'ENOENT: no such file or directory, open /test/workspace/src/app.ts',
      });
      const writeHandler = jest.fn().mockResolvedValue({
        success: true,
        output: 'updated source',
      });
      const tools = [
        { name: 'Read', description: 'Read a file', inputSchema: { type: 'object' }, handler: readHandler },
        { name: 'Write', description: 'Write a file', inputSchema: { type: 'object' }, handler: writeHandler },
        { name: 'Edit', description: 'Edit a file', inputSchema: { type: 'object' }, handler: jest.fn() },
      ];
      const toolRegistry = {
        getAll: () => tools,
        get: (name: string) => tools.find((tool) => tool.name === name),
        getEnabled: () => tools,
        has: (name: string) => tools.some((tool) => tool.name === name),
        register: jest.fn(),
        setEnabled: jest.fn(),
        getNames: () => tools.map((tool) => tool.name),
        size: () => tools.length,
      };
      let latestSnapshot: any;
      let planCalls = 0;
      const recoveryEngine = new ReActEngine({
        model: 'test-model',
        maxSteps: 3,
        budget: 100,
        workspace: '/test/workspace',
        toolRegistry,
        onStateUpdate: (snapshot) => {
          latestSnapshot = snapshot;
        },
        llmProvider: {
          createChatCompletion: async (_messages, _model, options) => {
            if (options?.requestKind === 'step.reason') return 'Refresh the failed mutation target.';
            if (options?.requestKind === 'step.plan_action') {
              planCalls += 1;
              return planCalls === 1
                ? '{"tool":"Read","arguments":{"file_path":"src/app.ts"}}'
                : '{"tool":"Write","arguments":{"file_path":"src/app.ts","content":"new"}}';
            }
            return 'false';
          },
          estimateStepCost: () => 0,
          getProviderName: () => 'mock',
          isAvailable: () => true,
        },
        taskAnalysis: {
          id: 'failed-mutation-read-recovery',
          taskKind: 'feature',
          expectedChangeIntent: 'modify',
          approvalPolicy: 'full_access',
          contract: {
            candidateFiles: ['src/app.ts'],
            completionEvidenceRequirements: { requireSourceMutationForFeatureCompletion: true },
          },
          affectedFiles: [{ path: 'src/app.ts', intent: 'modify' }],
          requiredInspections: [],
          verificationPlan: [],
          validationRequirements: [],
          sourceFiles: [],
          riskFactors: [],
        } as any,
      });

      const result = await recoveryEngine.run('Refresh the failed mutation target.', {
        codingState: 'implement',
        forceMutationNextAction: true,
        forceMutationTarget: 'src/app.ts',
        forceReadNextAction: true,
        forceReadTarget: 'src/app.ts',
        noProgressCount: 4,
        steps: [{
          thought: 'Apply the repair.',
          action: 'Edit',
          action_input: { file_path: 'src/app.ts', old_string: 'stale', new_string: 'new' },
          observation: JSON.stringify({ success: false, error: 'old_string was not found' }),
        }],
      });

      expect(result.error).toBe('Turn limit reached. Progress was saved at a checkpoint; continue to resume the task.');
      expect(readHandler).toHaveBeenCalledTimes(1);
      expect(writeHandler).toHaveBeenCalledTimes(1);
      expect(planCalls).toBe(2);
      expect(latestSnapshot?.forceReadNextAction).toBe(false);
      expect(latestSnapshot?.forceReadTarget).toBeUndefined();
      expect(latestSnapshot?.forceMutationNextAction).toBe(false);
    });

    it('adds a run-scoped AskUserQuestion tool that returns the user answer', async () => {
      const requestUserInput = jest.fn(async (request: any) => ({
        requestId: request.requestId,
        selectedOption: 'Mobile',
        answer: 'Use touch controls.',
        cancelled: false,
      }));
      const registryTools = [
        { name: 'Read', description: 'Read', parameters: {}, handler: jest.fn() },
        { name: 'SubAgent', description: 'Launch another model', parameters: {}, handler: jest.fn() },
      ];
      const toolRegistry = {
        getAll: () => registryTools,
        get: (name: string) => registryTools.find((tool) => tool.name === name),
        getEnabled: () => registryTools,
        has: (name: string) => registryTools.some((tool) => tool.name === name),
        register: jest.fn(),
        setEnabled: jest.fn(),
        getNames: () => registryTools.map((tool) => tool.name),
        size: () => registryTools.length,
      };
      const interactiveEngine = new ReActEngine({
        model: 'selected-model',
        requestUserInput,
        toolRegistry,
      }) as any;

      const tool = interactiveEngine.toolRegistry.get('AskUserQuestion');
      expect(tool).toBeDefined();
      expect(interactiveEngine.toolRegistry.has('SubAgent')).toBe(false);
      expect(interactiveEngine.toolRegistry.getNames()).toEqual(['Read', 'Todo', 'WorkPlan', 'Think', 'AskUserQuestion']);
      const result = await tool.handler({
        question: 'Which target?',
        options: ['Desktop', 'Mobile'],
        allowFreeform: true,
      });

      expect(requestUserInput).toHaveBeenCalledWith(expect.objectContaining({
        question: 'Which target?',
        options: ['Desktop', 'Mobile'],
      }));
      expect(result).toEqual(expect.objectContaining({
        success: true,
        output: 'Mobile',
        answer: 'Use touch controls.',
      }));
      expect(interactiveEngine.config.model).toBe('selected-model');
      expect(interactiveEngine.config.plannerModel).toBe('selected-model');
    });

    it('uses a freshly computed task analysis instead of a stale continuation contract', () => {
      const staleAnalysis = {
        id: 'stale',
        expectedChangeIntent: 'modify',
        affectedFiles: [{ path: 'TODO.md', intent: 'modify', mustReadBeforeEdit: true }],
      } as any;
      const currentAnalysis = {
        id: 'current',
        expectedChangeIntent: 'modify',
        affectedFiles: [{ path: 'TODO.md', intent: 'create', mustReadBeforeEdit: false }],
      } as any;

      expect(resolveRunTaskAnalysis(currentAnalysis, staleAnalysis)).toBe(currentAnalysis);
      expect(resolveRunTaskAnalysis(undefined, staleAnalysis)).toBe(staleAnalysis);
    });

    it('starts a fresh evidence scope when the authoritative contract changes', () => {
      const state = {
        taskAnalysis: { id: 'phase-4' },
        steps: [{ action: 'Edit', action_input: { file_path: 'src/types.ts' }, observation: '{"success":true}' }],
        current_step: 1,
        codingState: 'review',
      } as any;
      const currentAnalysis = {
        id: 'phase-5',
        expectedChangeIntent: 'modify',
        contract: {
          completionEvidenceRequirements: {
            requireSourceMutationForFeatureCompletion: true,
            requireVerificationForCompletion: false,
          },
        },
      } as any;

      applyRunTaskAnalysis(state, currentAnalysis);

      expect(state.taskAnalysis).toBe(currentAnalysis);
      expect(state.evidenceStartStep).toBe(1);
      expect(getCompletionEvidenceFailure(state, 'I completed Phase 5.', getWorkspaceRelativePath)).toContain('successful source mutation evidence');
    });

    it('retains parent evidence when resuming the same contract', () => {
      const analysis = {
        id: 'same-task',
        expectedChangeIntent: 'modify',
        contract: {
          completionEvidenceRequirements: {
            requireSourceMutationForFeatureCompletion: true,
            requireVerificationForCompletion: false,
          },
        },
      } as any;
      const state = {
        taskAnalysis: analysis,
        steps: [{ action: 'Edit', action_input: { file_path: 'src/types.ts' }, observation: '{"success":true}' }],
        current_step: 1,
        codingState: 'review',
      } as any;

      applyRunTaskAnalysis(state, analysis);

      expect(state.evidenceStartStep).toBeUndefined();
      expect(getCompletionEvidenceFailure(state, 'I updated src/types.ts.', getWorkspaceRelativePath)).toBeNull();
    });

    it('allows cross-run inspection recovery while blocking protected exact replay until the continuation advances', () => {
      const stateFor = (action: string, actionInput: Record<string, unknown>) => ({
        lastRun: {
          completedStepCount: 1,
          lastAction: action,
          lastActionInput: actionInput,
          lastActionSucceeded: true,
          nextPlanItem: 'Implement fix',
          recordedAt: 1234,
        },
        steps: [{
          action,
          action_input: actionInput,
          observation: '{"success":true}',
        }],
      }) as any;

      const readOnlyActions = [
        { action: 'Read', action_input: { file_path: 'src/app.ts', offset: 1, limit: 50 } },
        { action: 'DocumentRead', action_input: { file_path: 'requirements.pdf' } },
        { action: 'Grep', action_input: { pattern: 'Phase 6|Pellet|Scoring', path: '.' } },
        { action: 'Glob', action_input: { pattern: 'src/**/*.ts' } },
        { action: 'Command', action_input: { operation: 'list_directory', args: ['src'] } },
        { action: 'WebSearch', action_input: { query: 'current documentation' } },
      ];
      for (const action of readOnlyActions) {
        expect(isUnadvancedLastRunReplay(
          stateFor(action.action, action.action_input),
          action,
        )).toBe(false);
      }

      const protectedActions = [
        { action: 'Write', action_input: { file_path: 'src/app.ts', content: 'next' } },
        { action: 'Edit', action_input: { file_path: 'src/app.ts', old_string: 'old', new_string: 'new' } },
        { action: 'Bash', action_input: { command: 'npm test' } },
        { action: 'Command', action_input: { operation: 'test', args: ['--runInBand'] } },
        { action: 'TaskUpdate', action_input: { id: 'task-1', status: 'completed' } },
      ];
      for (const action of protectedActions) {
        expect(isUnadvancedLastRunReplay(
          stateFor(action.action, action.action_input),
          action,
        )).toBe(true);
      }

      const writeAction = protectedActions[0];
      const advancedState = stateFor(writeAction.action, writeAction.action_input);
      advancedState.steps.push({
        action: 'Grep',
        action_input: { pattern: 'TODO' },
        observation: '{"success":true}',
      });
      expect(isUnadvancedLastRunReplay(advancedState, writeAction)).toBe(false);
    });

    it('allows uncovered TODO ranges while blocking ranges already present in memory', () => {
      const lines = (start: number) =>
        Array.from({ length: 10 }, (_value, index) => `line ${start + index}`).join('\n');
      const state = {
        steps: [
          { action: 'Read', action_input: { file_path: 'pacman todo.md', offset: 1, limit: 10 }, observation: JSON.stringify({ success: true, output: lines(1), truncated: true }) },
          { action: 'Read', action_input: { file_path: 'pacman todo.md', offset: 11, limit: 10 }, observation: JSON.stringify({ success: true, output: lines(11), truncated: true }) },
          { action: 'Read', action_input: { file_path: 'pacman todo.md', offset: 21, limit: 10 }, observation: JSON.stringify({ success: true, output: lines(21), truncated: true }) },
        ],
      } as any;

      expect(getSemanticInspectionReplayReason(state, {
        action: 'Read',
        action_input: { file_path: 'PACMAN TODO.md', offset: 31, limit: 10 },
      })).toBeUndefined();
      expect(getSemanticInspectionReplayReason(state, {
        action: 'Read',
        action_input: { file_path: '.\\pacman todo.md', offset: 11, limit: 10 },
      })).toContain('already present in model-visible memory');
      expect(getSemanticInspectionReplayReason(state, {
        action: 'Read',
        action_input: { file_path: 'pacman todo.md', offset: 15, limit: 10 },
      })).toContain('already present in model-visible memory');
      expect(getSemanticInspectionReplayReason(state, {
        action: 'Read',
        action_input: { file_path: 'src/gameLoop.ts' },
      })).toBeUndefined();
    });

    it('suppresses a near-term reread only when full unchanged file content remains retained', () => {
      const read = {
        action: 'Read',
        action_input: { file_path: 'src/app.js' },
        observation: JSON.stringify({ success: true, truncated: false, output: `const value = 1;\n${'const next = value + 1;\n'.repeat(120)}` }),
      };
      const state = {
        steps: [
          read,
          { action: 'Grep', action_input: { pattern: 'value' }, observation: '{"success":true,"output":"matches"}' },
          { action: 'Glob', action_input: { pattern: 'src/*.js' }, observation: '{"success":true,"output":"src/app.js"}' },
        ],
      } as any;
      const reread = { action: 'Read', action_input: { file_path: 'SRC\\app.js' } };

      expect(getRecentUnchangedReadLoopReason(state, reread)).toContain('Repeated Read suppressed');
      expect(getRecentUnchangedReadLoopReason(state, reread)).toContain('full content is still in Retained File Context');

      state.steps.push({ action: 'Command', action_input: { operation: 'list_directory' }, observation: '{"success":true,"output":"src"}' });
      expect(getRecentUnchangedReadLoopReason(state, reread)).toContain('Repeated Read suppressed');
      state.steps.push({ action: 'Grep', action_input: { pattern: 'next' }, observation: '{"success":true,"output":"matches"}' });
      expect(getRecentUnchangedReadLoopReason(state, reread)).toBeUndefined();

      const changedState = {
        steps: [
          read,
          { action: 'Edit', action_input: { file_path: 'src/app.js' }, observation: '{"success":true,"output":"updated"}' },
        ],
      } as any;
      expect(getRecentUnchangedReadLoopReason(changedState, reread)).toBeUndefined();
    });

    it('blocks duplicate compacted previews and reads beyond a known empty boundary', () => {
      const state = {
        steps: [
          {
            action: 'Read',
            action_input: { file_path: 'pacman todo.md' },
            observation: JSON.stringify({
              success: true,
              output: 'preview line 1\npreview line 2',
              truncated: false,
              fullOutput: { persisted: true, path: 'raw.txt' },
            }),
          },
          {
            action: 'Read',
            action_input: { file_path: 'pacman todo.md', offset: 2000, limit: 100 },
            observation: '{"success":true,"output":"","truncated":false}',
          },
        ],
      } as any;

      expect(getSemanticInspectionReplayReason(state, {
        action: 'Read',
        action_input: { file_path: 'pacman todo.md' },
      })).toContain('unbounded read');
      expect(getSemanticInspectionReplayReason(state, {
        action: 'Read',
        action_input: { file_path: 'pacman todo.md', offset: 100, limit: 50 },
      })).toBeUndefined();
      expect(getSemanticInspectionReplayReason(state, {
        action: 'Read',
        action_input: { file_path: 'pacman todo.md', offset: 2500, limit: 50 },
      })).toContain('previously returned no content from line 2000');

      state.steps.push({
        action: 'Edit',
        action_input: { file_path: 'src/gameLoop.ts' },
        observation: '{"success":true}',
      });
      expect(getSemanticInspectionReplayReason(state, {
        action: 'Read',
        action_input: { file_path: 'pacman todo.md' },
      })).toBeUndefined();
    });

    it('allows a reread when an older range was omitted from bounded retained memory', () => {
      const state = {
        steps: Array.from({ length: 9 }, (_value, index) => ({
          action: 'Read',
          action_input: { file_path: 'pacman todo.md', offset: index * 10 + 1, limit: 10 },
          observation: JSON.stringify({
            success: true,
            output: Array.from({ length: 10 }, (_line, lineIndex) => `range ${index} line ${lineIndex}`).join('\n'),
            truncated: true,
          }),
        })),
      } as any;

      expect(getSemanticInspectionReplayReason(state, {
        action: 'Read',
        action_input: { file_path: 'pacman todo.md', offset: 1, limit: 10 },
      })).toBeUndefined();
      expect(getSemanticInspectionReplayReason(state, {
        action: 'Read',
        action_input: { file_path: 'pacman todo.md', offset: 81, limit: 10 },
      })).toContain('already present in model-visible memory');
    });

    it('creates a readable agent update and retains the exact successful model route', () => {
      (engine as any).recordLlmTelemetry({
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        requestKind: 'step.plan_action',
        startedAt: Date.now(),
        durationMs: 25,
        status: 'succeeded',
      });

      expect((engine as any).lastSuccessfulLlmRouteByKind.get('step.plan_action')).toEqual({
        provider: 'gemini',
        model: 'gemini-3.5-flash',
      });
      expect((engine as any).describeModelDecision(
        { action: 'Read', action_input: { file_path: 'src/index.ts' } },
        'Inspect the implementation',
      )).toContain('I’m reading src/index.ts');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP TRANSITIONS
  // ──────────────────────────────────────────────────────────────────────────

  describe('Step Transitions', () => {
    it('should have run method', () => {
      expect(typeof engine.run).toBe('function');
    });

    it('should accept task description', async () => {
      mockChatCompletion.mockResolvedValueOnce({ content: 'Understood' });

      const task = 'Simple task';
      // Test that run method exists and is callable
      expect(engine.run).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CONFIGURATION
  // ──────────────────────────────────────────────────────────────────────────

  describe('Configuration & Defaults', () => {
    it('should have default config values', () => {
      const engineWithDefaults = new ReActEngine({
        model: 'test',
      });

      expect(engineWithDefaults).toBeDefined();
    });

    it('pins planning to the selected model even when a different planner model is supplied', () => {
      expect(new ReActEngine({ model: 'selected-model' }).config.plannerModel).toBe('selected-model');
      expect(new ReActEngine({
        model: 'selected-model',
        plannerModel: 'confirmed-planner-model',
      }).config.plannerModel).toBe('selected-model');
    });

    it('should accept custom max steps', () => {
      const engineWith10Steps = new ReActEngine({
        model: 'test',
        maxSteps: 10,
      });

      expect(engineWith10Steps.config.maxSteps).toBe(10);
    });

    it('should accept custom budget', () => {
      const engineWith50Budget = new ReActEngine({
        model: 'test',
        budget: 50,
      });

      expect(engineWith50Budget.config.budget).toBe(50);
    });

    it('enables ReplayGuard by default and accepts an explicit opt-out', () => {
      expect(new ReActEngine({ model: 'test' }).config.replayGuardEnabled).toBe(true);
      expect(new ReActEngine({ model: 'test', replayGuardEnabled: false }).config.replayGuardEnabled).toBe(false);
    });

    it('maps execution pacing profiles to safe request intervals', () => {
      expect(getExecutionPacingIntervalMs('automatic')).toBe(0);
      expect(getExecutionPacingIntervalMs('conservative')).toBe(6000);
      expect(getExecutionPacingIntervalMs('phased')).toBe(10000);
      expect(getExecutionPacingIntervalMs('fast')).toBe(0);
      expect(getExecutionPacingIntervalMs('conservative', 2500)).toBe(2500);
    });

    it('reserves a bounded UI presentation window for file actions unless fast pacing is selected', () => {
      expect(getToolPresentationDelayMs('conservative', 'Read')).toBe(1600);
      expect(getToolPresentationDelayMs('phased', 'Write')).toBe(4800);
      expect(getToolPresentationDelayMs('phased', 'Edit')).toBe(4800);
      expect(getToolPresentationDelayMs('automatic', 'Read')).toBe(0);
      expect(getToolPresentationDelayMs('automatic', 'Write')).toBe(0);
      expect(getToolPresentationDelayMs('fast', 'Write')).toBe(0);
      expect(getToolPresentationDelayMs('conservative', 'Bash')).toBe(0);
      expect(getDecisionPresentationDelayMs('conservative', 'Short summary')).toBe(1000);
      expect(getDecisionPresentationDelayMs('phased', 'x'.repeat(241))).toBe(3000);
      expect(getDecisionPresentationDelayMs('automatic', 'Long summary')).toBe(0);
    });

    it('keeps pacing independent from agent-selected actions', () => {
      const phasedEngine = new ReActEngine({ model: 'test', pacingProfile: 'phased' });
      expect((phasedEngine as any).config).not.toHaveProperty('agentDirective');
      expect((phasedEngine as any).config.pacingProfile).toBe('phased');

      const state = {
        task: 'Fix the application behavior',
        workspace: '/test/workspace',
        plan: [],
        current_step: 2,
        max_steps: 10,
        total_pollen_cost: 0,
        budget: 100,
        repairAttempts: 0,
        steps: [
          { thought: 'Implement', action: 'Edit', action_input: { file_path: 'src/app.ts' }, observation: '{"success":true}' },
          { thought: 'Verify', action: 'Bash', action_input: { command: 'npm test' }, observation: '{"success":true}' },
        ],
      } as any;

      expect(hasVerifiedPhaseEvidence(state, 0)).toBe(true);
      expect(hasVerifiedPhaseEvidence({ ...state, steps: state.steps.slice(0, 1) }, 0)).toBe(false);
    });

    it('holds the active TODO phase after mutation and stops immediately after verification', () => {
      const state = {
        task: 'Implement one TODO phase',
        workspace: '/test/workspace',
        plan: [
          { step: 'Phase 1: implement and verify the first slice', status: 'completed' },
          { step: 'Phase 2: implement the next slice', status: 'in_progress' },
        ],
        current_step: 1,
        max_steps: 10,
        total_pollen_cost: 0,
        budget: 100,
        repairAttempts: 0,
        taskAnalysis: { expectedChangeIntent: 'modify' },
        steps: [
          { thought: 'Implement', action: 'Edit', action_input: { file_path: 'src/app.ts' }, observation: '{"success":true}' },
        ],
      } as any;

      expect(enforcePhasedExecutionBoundary(state, 0, 0)).toBe(false);
      expect(state.plan).toEqual([
        expect.objectContaining({ status: 'in_progress' }),
        expect.objectContaining({ status: 'pending' }),
      ]);

      state.steps.push({
        thought: 'Verify', action: 'Bash', action_input: { command: 'npm test' }, observation: '{"success":true}',
      });
      expect(enforcePhasedExecutionBoundary(state, 0, 0)).toBe(true);
      expect(state.plan).toEqual([
        expect.objectContaining({ status: 'completed' }),
        expect.objectContaining({ status: 'pending' }),
      ]);
    });

    it('does not switch provider-pinned runs to Pollinations', async () => {
      const geminiFailure = new Error('Gemini quota exhausted');
      const pinnedProvider = {
        createChatCompletion: jest.fn<() => Promise<string>>().mockRejectedValue(geminiFailure),
        estimateStepCost: jest.fn(() => 0),
        getProviderName: jest.fn(() => 'gemini'),
        isAvailable: jest.fn(() => true),
      };
      const pinnedEngine = new ReActEngine({
        model: 'gemini-3.5-flash',
        llmProvider: pinnedProvider,
        allowPollinationsFallback: false,
      });

      await expect(
        (pinnedEngine as any).createChatCompletion([{ role: 'user', content: 'test' }], 'gemini-3.5-flash')
      ).rejects.toBe(geminiFailure);
      expect(pinnedProvider.createChatCompletion).toHaveBeenCalledTimes(1);
      expect(mockChatCompletion).not.toHaveBeenCalled();
    });

    it('preserves model capabilities through the paced provider wrapper', () => {
      const capabilities = {
        supportsNativeTools: true,
        supportsReasoning: true,
        supportsStructuredOutput: false,
        contextWindow: 114_688,
      };
      const provider = {
        createChatCompletion: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
        estimateStepCost: jest.fn(() => 0),
        getProviderName: jest.fn(() => 'openrouter'),
        isAvailable: jest.fn(() => true),
        getModelCapabilities: jest.fn(() => capabilities),
      };
      const capabilityEngine = new ReActEngine({
        model: 'stealth/ox-alpha',
        llmProvider: provider,
      });

      expect((capabilityEngine as any).llm.getModelCapabilities('stealth/ox-alpha')).toBe(capabilities);
      expect(provider.getModelCapabilities).toHaveBeenCalledWith('stealth/ox-alpha');
    });

    it('stops model calls at the configured per-task request budget', async () => {
      const completion = jest.fn<() => Promise<string>>().mockResolvedValue('ok');
      const budgetedEngine = new ReActEngine({
        model: 'gemini-3.5-flash',
        maxLlmRequestsPerTask: 1,
        pacingProfile: 'custom',
        llmRequestIntervalMs: 0,
        llmProvider: {
          createChatCompletion: completion,
          estimateStepCost: () => 0,
          getProviderName: () => 'gemini',
          isAvailable: () => true,
        },
      });
      (budgetedEngine as any).activeRunState = {
        task: 'budget-test',
        llmUsage: { requestCount: 0, retryCount: 0, cacheHits: 0, estimatedInputTokens: 0, estimatedOutputTokens: 0 },
      };

      await expect((budgetedEngine as any).llm.createChatCompletion(
        [{ role: 'user', content: 'first' }],
        'gemini-3.5-flash',
      )).resolves.toBe('ok');
      await expect((budgetedEngine as any).llm.createChatCompletion(
        [{ role: 'user', content: 'second' }],
        'gemini-3.5-flash',
      )).rejects.toThrow(/explicit user approval/i);
      expect(completion).toHaveBeenCalledTimes(1);
    });

    it('turns the task request limit into a recoverable checkpoint continuation', async () => {
      const checkpoints: any[] = [];
      const budgetedEngine = new ReActEngine({
        model: 'gemini-3.5-flash',
        onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
      });
      const state = {
        task: 'finish the implementation',
        workspace: process.cwd(),
        plan: [
          { step: 'Inspect source', status: 'completed' },
          { step: 'Implement fix', status: 'in_progress' },
        ],
        steps: [{
          thought: 'inspect',
          action: 'Read',
          action_input: { file_path: 'src/app.ts' },
          observation: '{"success":true}',
        }],
        current_step: 1,
        max_steps: 5,
        total_pollen_cost: 0,
        budget: 100,
        repairAttempts: 0,
      } as any;

      const result = await (budgetedEngine as any).handleTaskRequestBudgetReached(
        state,
        'Task LLM request budget reached (10/10). Start a continuation only after explicit user approval.',
      );

      expect(result).toEqual(expect.objectContaining({
        success: false,
        recoverable: true,
        errorCode: 'TASK_LLM_REQUEST_BUDGET_REACHED',
        resumeState: state,
      }));
      expect(checkpoints.at(-1)?.state.lastRun).toEqual(expect.objectContaining({
        completedStepCount: 1,
        lastAction: 'Read',
        nextPlanItem: 'Implement fix',
      }));
    });
  });

  it('does not treat a passing verification without command output as evidence', () => {
    expect(genericVerificationObservation({
      thought: '',
      action: 'Command',
      action_input: { operation: 'test', args: [] },
      observation: JSON.stringify({ success: true, status: 'passed' }),
    }, 0)).toMatchObject({ status: 'failed', output: '' });
    expect(genericVerificationObservation({
      thought: '',
      action: 'Command',
      action_input: { operation: 'test', args: [] },
      observation: '',
    }, 1)).toMatchObject({ status: 'failed' });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ERROR HANDLING
  // ──────────────────────────────────────────────────────────────────────────

  describe('Error Handling', () => {
    it('should handle invalid models gracefully', () => {
      expect(() => {
        new ReActEngine({ model: '' });
      }).not.toThrow();
    });

    it('should handle negative budget', () => {
      expect(() => {
        new ReActEngine({ model: 'test', budget: -1 });
      }).not.toThrow();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TOOL DEFINITIONS
  // ──────────────────────────────────────────────────────────────────────────

  describe('Tool Definitions', () => {
    it('should have access to tools', () => {
      const tools = devToolsModule.getAllToolDefinitions();
      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
    });
  });

  describe('Durable request correlation', () => {
    it('emits a bounded request lifecycle with one stable request id', async () => {
      const events: any[] = [];
      const telemetry: any[] = [];
      const completionProvider = {
        createChatCompletion: jest.fn(async (_messages: any, _model: string, options: any) => {
          options?.onTelemetry?.({
            provider: 'mock',
            model: 'mock-model',
            requestKind: 'step.reason',
            startedAt: Date.now(),
            durationMs: 2,
            status: 'succeeded',
          });
          options?.onCompletionResult?.({
            text: 'safe response',
            toolCalls: [],
            provider: 'mock',
            model: 'mock-model',
            requestId: 'provider-request-1',
          });
          return 'safe response';
        }),
        estimateStepCost: () => 0,
        getProviderName: () => 'mock',
        isAvailable: () => true,
      };
      const requestEngine = new ReActEngine({
        model: 'mock-model',
        pacingProfile: 'fast',
        llmRequestIntervalMs: 0,
        onEvent: (event) => events.push(event),
      });
      const wrapped = (requestEngine as any).createPacedLlmProvider(completionProvider);

      const result = await wrapped.createChatCompletion(
        [
          { role: 'system', content: 'private system prompt' },
          { role: 'user', content: 'private user request' },
        ],
        'mock-model',
        {
          requestKind: 'step.reason',
          stepId: 'step-1',
          onTelemetry: (entry: any) => telemetry.push(entry),
        },
      );

      const started = events.find((event) => event.type === 'llm_request_started');
      const finished = events.find((event) => event.type === 'llm_request_finished');
      expect(result).toBe('safe response');
      expect(started.request).toMatchObject({
        status: 'started',
        stepId: 'step-1',
        requestKind: 'step.reason',
        requestedRoute: { provider: 'mock', model: 'mock-model' },
      });
      expect(finished.request).toMatchObject({
        status: 'succeeded',
        stepId: 'step-1',
        resolvedRoute: { provider: 'mock', model: 'mock-model' },
        response: { textCharacters: 'safe response'.length, providerRequestId: 'provider-request-1' },
      });
      expect(started.request.requestId).toBe(finished.request.requestId);
      expect(telemetry[0].requestId).toBe(started.request.requestId);
      expect(JSON.stringify(started.request)).not.toContain('private system prompt');
      expect(JSON.stringify(finished.request)).not.toContain('safe response');
    });

    it('emits provider rotation telemetry when a 429 attempt succeeds on another account', async () => {
      const events: any[] = [];
      const startedAt = Date.now() - 500;
      const completionProvider = {
        createChatCompletion: jest.fn(async (_messages: any, _model: string, options: any) => {
          options?.onTelemetry?.({
            provider: 'gemini', model: 'gemini-3.6-flash', status: 'failed',
            startedAt, durationMs: 100, error: '429 rate limit', classification: 'rate_limit',
            credentialIndex: 0, cooldownUntil: new Date(Date.now() + 20_000).toISOString(),
          });
          options?.onTelemetry?.({
            provider: 'gemini', model: 'gemini-3.6-flash', status: 'succeeded',
            startedAt: Date.now(), durationMs: 5, credentialIndex: 1,
          });
          return 'recovered';
        }),
        estimateStepCost: () => 0,
        getProviderName: () => 'gemini',
        isAvailable: () => true,
      };
      const requestEngine = new ReActEngine({
        model: 'gemini-3.6-flash',
        pacingProfile: 'fast',
        llmRequestIntervalMs: 0,
        onEvent: (event) => events.push(event),
      });
      const wrapped = (requestEngine as any).createPacedLlmProvider(completionProvider);

      await expect(wrapped.createChatCompletion(
        [{ role: 'system', content: 'planner' }, { role: 'user', content: 'choose' }],
        'gemini-3.6-flash',
        { requestKind: 'step.plan_action', stepId: 'step-429' },
      )).resolves.toBe('recovered');

      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'provider_rotation_occurred',
          fromProvider: 'gemini',
          toProvider: 'gemini',
          fromKeyIndex: 0,
          toKeyIndex: 1,
          reason: 'rate_limit',
          requestId: expect.any(String),
          stepId: 'step-429',
        }),
      ]));
    });

    it('enables local structured-action streaming and forwards safe progress events', async () => {
      const events: any[] = [];
      const completionProvider = {
        createChatCompletion: jest.fn(async (_messages: any, _model: string, options: any) => {
          options?.onStreamEvent?.({ type: 'tool_call_delta', index: 0, name: 'Read', argumentsDelta: '{' });
          options?.onStreamEvent?.({ type: 'usage', usage: { outputTokens: 12 } });
          options?.onCompletionResult?.({
            text: '{"tool":"Read","arguments":{"file_path":"src/app.ts"}}',
            toolCalls: [],
            provider: 'local',
            model: 'qwen3-4b-local',
          });
          return '{"tool":"Read","arguments":{"file_path":"src/app.ts"}}';
        }),
        estimateStepCost: () => 0,
        getProviderName: () => 'local',
        isAvailable: () => true,
      };
      const requestEngine = new ReActEngine({
        model: 'local:qwen3-4b-local',
        pacingProfile: 'fast',
        llmRequestIntervalMs: 0,
        onEvent: (event) => events.push(event),
      });
      const wrapped = (requestEngine as any).createPacedLlmProvider(completionProvider);

      await expect(wrapped.createChatCompletion(
        [{ role: 'system', content: 'planner' }, { role: 'user', content: 'choose' }],
        'local:qwen3-4b-local',
        { requestKind: 'step.plan_action' },
      )).resolves.toContain('"tool"');

      expect(completionProvider.createChatCompletion).toHaveBeenCalledWith(
        expect.any(Array),
        'local:qwen3-4b-local',
        expect.objectContaining({ stream: true }),
      );
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'model_stream', eventType: 'tool_call_delta', delta: '{' }),
        expect.objectContaining({ type: 'model_stream', eventType: 'usage', delta: expect.stringContaining('12') }),
      ]));
    });
  });

  describe('Tool observation success detection', () => {
    it('treats successful ToolResult JSON as successful', () => {
      expect(isSuccessfulToolObservation(JSON.stringify({ success: true, output: 'ok' }))).toBe(true);
    });

    it('treats failed ToolResult JSON as unsuccessful', () => {
      expect(isSuccessfulToolObservation(JSON.stringify({ success: false, error: 'Pattern not found' }))).toBe(false);
    });

    it('treats guarded mutation rejection as unsuccessful', () => {
      expect(isSuccessfulToolObservation('Guarded mutation rejected: file must be read before edit')).toBe(false);
    });

    it('emits file change events for filename aliases', () => {
      const events: any[] = [];
      const streamEngine = new ReActEngine({
        model: 'test',
        onEvent: (event) => events.push(event),
      });

      (streamEngine as any).emitToolResult(
        { action: 'Write', action_input: { filename: 'TODO.md' } },
        JSON.stringify({ success: true, output: 'Written', diff: '--- before\n+++ after\n+New task' })
      );

      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'file_changed',
            path: 'TODO.md',
            diff: '--- before\n+++ after\n+New task',
          }),
        ])
      );
    });

    it('extracts changed files from file aliases', () => {
      expect((engine as any).extractOutputFilesFromSteps([
        {
          action: 'Write',
          action_input: { filename: 'TODO.md' },
          observation: JSON.stringify({ success: true }),
        },
        {
          action: 'Edit',
          action_input: { file: 'src/game.ts' },
          observation: JSON.stringify({ success: true }),
        },
      ])).toEqual(['TODO.md', 'src/game.ts']);
    });
  });

  describe('Completion evidence guard', () => {
    it('builds a coder completion summary without another LLM request', () => {
      const state = {
        task: 'Create a website',
        workspace: '/workspace',
        plan: [],
        steps: [
          {
            thought: 'Create page',
            action: 'Write',
            action_input: { file_path: 'index.html', content: '<html></html>' },
            observation: JSON.stringify({ success: true, changedFiles: ['index.html'] }),
          },
          {
            thought: 'Verify page',
            action: 'Bash',
            action_input: { command: 'npm run build' },
            observation: JSON.stringify({ success: true, output: 'built' }),
          },
        ],
        current_step: 2,
        max_steps: 10,
        total_pollen_cost: 0,
        budget: 100,
        repairAttempts: 0,
        taskAnalysis: {
          expectedChangeIntent: 'create',
        },
      } as any;

      expect(getDeterministicCoderCompletionAnswer(state, getWorkspaceRelativePath)).toBe(
        'I’ve implemented the requested changes.\n\nSummary:\n- Create a website\n\nChanged files:\n- index.html\n\nVerification passed:\n- build',
      );
    });

    it('blocks a BVRWBG-style false success after a failed final edit and no successful mutations', () => {
      const state = {
        task: 'Update TODO.md and game.js',
        workspace: '/workspace',
        plan: [],
        steps: [
          {
            thought: 'Try edit',
            action: 'Edit',
            action_input: {},
            observation: JSON.stringify({ success: false, error: 'Invalid Edit action: file_path is required.' }),
          },
        ],
        current_step: 1,
        max_steps: 10,
        total_pollen_cost: 0,
        budget: 100,
        repairAttempts: 0,
        taskAnalysis: {
          expectedChangeIntent: 'modify',
        },
      } as any;

      expect(getCompletionEvidenceFailure(state, 'I updated TODO.md and implemented the maze grid.', getWorkspaceRelativePath)).toContain(
        'could not be verified'
      );
    });

    it('routes the recurring no-successful-Write/Edit completion warning into recovery', async () => {
      const checkpoints: any[] = [];
      const events: any[] = [];
      const recoveryEngine = new ReActEngine({
        model: 'test-model',
        llmProvider: {
          createChatCompletion: jest.fn<() => Promise<string>>().mockResolvedValue('I updated the project and completed the task.'),
          estimateStepCost: () => 0,
          getProviderName: () => 'test',
          isAvailable: () => true,
        },
        onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
        onEvent: (event) => events.push(event),
      });
      const state = {
        task: 'Update the project',
        workspace: '/workspace',
        plan: [{ step: 'Implement the project update', status: 'in_progress' }],
        steps: [
          {
            thought: 'Inspect source',
            action: 'Read',
            action_input: { file_path: 'src/app.ts' },
            observation: JSON.stringify({ success: true, output: 'source' }),
          },
          {
            thought: 'Apply a shell mutation',
            action: 'Bash',
            action_input: { command: 'Set-Content src/app.ts updated' },
            observation: JSON.stringify({ success: true, output: 'updated' }),
          },
          {
            thought: 'Run verification',
            action: 'Bash',
            action_input: { command: 'npm test' },
            observation: JSON.stringify({ success: true, output: 'passed' }),
          },
        ],
        current_step: 3,
        max_steps: 10,
        total_pollen_cost: 0,
        budget: 100,
        repairAttempts: 0,
        codingState: 'review',
        taskAnalysis: {
          expectedChangeIntent: 'modify',
          affectedFiles: [{ path: 'src/app.ts', intent: 'modify' }],
          contract: { candidateFiles: ['src/app.ts'] },
        },
      } as any;

      const result = await (recoveryEngine as any).handleCompletion(state);

      expect(result).toBeUndefined();
      expect(state.recoveryReason).toBe('missing_mutation_evidence');
      expect(state.codingState).toBe('implement');
      expect(state.steps).toHaveLength(3);
      expect(checkpoints.at(-1).state.lastRecovery).toMatchObject({
        reason: 'missing_mutation_evidence',
        evidence: { stepCount: 3, latestAction: 'Bash' },
      });
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'recovery_transition', reason: 'missing_mutation_evidence' }),
      ]));
    });

    it('allows mutation claims when supported by a successful Write or Edit', () => {
      const state = {
        task: 'Update TODO.md',
        workspace: '/workspace',
        plan: [],
        steps: [
          {
            thought: 'Edit TODO',
            action: 'Edit',
            action_input: { file_path: 'TODO.md', old_string: '- [ ]', new_string: '- [x]' },
            observation: JSON.stringify({ success: true, output: 'Edited TODO.md' }),
          },
        ],
        current_step: 1,
        max_steps: 10,
        total_pollen_cost: 0,
        budget: 100,
        repairAttempts: 0,
      } as any;

      expect(getCompletionEvidenceFailure(state, 'I updated TODO.md.', getWorkspaceRelativePath)).toBeNull();
    });

    it('does not report parent-run mutations in a continuation completion summary', () => {
      const state = {
        task: 'Create the current page',
        workspace: '/workspace',
        plan: [],
        steps: [
          {
            thought: 'Parent run created the old entry point',
            action: 'Write',
            action_input: { file_path: 'index.js' },
            observation: JSON.stringify({ success: true, output: 'Created index.js' }),
          },
          {
            thought: 'Create the current page',
            action: 'Write',
            action_input: { file_path: 'src/page.tsx' },
            observation: JSON.stringify({ success: true, output: 'Created src/page.tsx' }),
          },
          {
            thought: 'Verify the current page',
            action: 'Bash',
            action_input: { command: 'npm run build' },
            observation: JSON.stringify({ success: true, output: 'built' }),
          },
        ],
        continuationHandoff: { evidence: { childStepOffset: 1 } },
        current_step: 3,
        max_steps: 10,
        total_pollen_cost: 0,
        budget: 100,
        repairAttempts: 0,
        taskAnalysis: {
          expectedChangeIntent: 'create',
        },
      } as any;

      expect(getDeterministicCoderCompletionAnswer(state, getWorkspaceRelativePath)).toBe(
        'I’ve implemented the requested changes.\n\nSummary:\n- Create the current page\n\nChanged files:\n- src/page.tsx\n\nVerification passed:\n- build',
      );
    });

    it('includes completed plan details and useful side notes in the agent handoff', () => {
      const state = {
        task: 'Update the dashboard',
        workspace: '/workspace',
        plan: [
          { step: 'Connect the dashboard to live data', status: 'completed' },
          { step: 'Add an optional export button', status: 'pending' },
        ],
        steps: [
          {
            thought: 'First edit missed the target',
            action: 'Edit',
            action_input: { file_path: 'src/dashboard.ts' },
            observation: JSON.stringify({ success: false, error: 'Pattern not found' }),
          },
          {
            thought: 'Apply the corrected edit',
            action: 'Edit',
            action_input: { file_path: 'src/dashboard.ts' },
            observation: JSON.stringify({ success: true }),
          },
          {
            thought: 'Build failed before repair',
            action: 'Bash',
            action_input: { command: 'npm run build' },
            observation: JSON.stringify({ success: false, error: 'Type error' }),
          },
          {
            thought: 'Build after repair',
            action: 'Bash',
            action_input: { command: 'npm run build' },
            observation: JSON.stringify({ success: true }),
          },
        ],
        current_step: 4,
        max_steps: 10,
        total_pollen_cost: 0,
        budget: 100,
        repairAttempts: 1,
        taskAnalysis: { expectedChangeIntent: 'modify', userRequest: 'Use live data in the dashboard.' },
      } as any;

      const answer = getDeterministicCoderCompletionAnswer(state, getWorkspaceRelativePath);
      expect(answer).toContain('I’ve implemented the requested changes.');
      expect(answer).toContain('What I completed:\n- Connect the dashboard to live data');
      expect(answer).toContain('Changed files:\n- src/dashboard.ts');
      expect(answer).toContain('Verification passed:\n- build');
      expect(answer).toContain('An earlier file-change attempt failed, but the final recorded mutation succeeded.');
      expect(answer).toContain('Earlier verification failures were repaired; the final recorded checks passed.');
      expect(answer).toContain('Remaining plan items: Add an optional export button.');
    });

    it('does not treat negated mutation statements as file-change claims', () => {
      const state = {
        task: 'Inspect Phase 2 status',
        workspace: '/workspace',
        plan: [],
        steps: [
          {
            thought: 'List files',
            action: 'Bash',
            action_input: { command: 'dir' },
            observation: JSON.stringify({ success: true, output: 'TODO.md\njs/game.js' }),
          },
        ],
        current_step: 1,
        max_steps: 10,
        total_pollen_cost: 0,
        budget: 100,
        repairAttempts: 0,
        taskAnalysis: {
          expectedChangeIntent: 'read_only',
        },
      } as any;

      expect(getCompletionEvidenceFailure(state, 'Inspection is incomplete. No files were modified.', getWorkspaceRelativePath)).toBeNull();
    });

    it('does not treat future implementation next steps as completed file-change claims', () => {
      const state = {
        task: 'Inspect Phase 2 status',
        workspace: '/workspace',
        plan: [],
        steps: [
          {
            thought: 'Read TODO',
            action: 'Read',
            action_input: { file_path: 'TODO.md' },
            observation: JSON.stringify({ success: true, output: 'Phase 2 unchecked' }),
          },
        ],
        current_step: 1,
        max_steps: 10,
        total_pollen_cost: 0,
        budget: 100,
        repairAttempts: 0,
        taskAnalysis: {
          expectedChangeIntent: 'read_only',
        },
      } as any;

      const finalAnswer = [
        'No file changes have been made yet — this was a read-only inspection.',
        'To proceed with implementing Phase 2, I need to inspect js/game.js and js/renderer.js before making changes.',
      ].join('\n\n');

      expect(getCompletionEvidenceFailure(state, finalAnswer, getWorkspaceRelativePath)).toBeNull();
    });
  });

  describe('Contract verification completion messages', () => {
    it('distinguishes passed commands from missing requested behavior evidence', () => {
      const message = formatContractVerificationFailure({
        decision: {
          status: 'incomplete',
          requirements: [{ requirementId: 'requested-outcome', observationIds: [], status: 'missing' }],
          failures: [],
          unavailable: [],
        },
        review: {
          findings: [
            'Verification is incomplete, not passed.',
            'One or more acceptance criteria lack passed evidence.',
          ],
        },
        hasPassedVerificationCommand: true,
      });

      expect(message).toBe(
        'Completion blocked: verification command passed, but requested behavior evidence is missing. One or more acceptance criteria lack passed evidence.'
      );
    });

    it('reports an actual failed verification separately', () => {
      const message = formatContractVerificationFailure({
        decision: {
          status: 'failed',
          requirements: [],
          failures: [{ id: 'check-1', check: 'project-verification', status: 'failed', changedFiles: [], output: 'assertion failed' }],
          unavailable: [],
        },
        review: {
          findings: ['Verification is failed, not passed.'],
        },
        hasPassedVerificationCommand: false,
      });

      expect(message).toBe('Completion blocked: verification failed.');
    });
  });

  describe('Scoped verification repair', () => {
    it('changes strategy and blocks after an identical failure repeats', () => {
      const failureStep = {
        thought: 'Verify', action: 'Command', action_input: { operation: 'test' },
        observation: JSON.stringify({ success: false, status: 'failed', error: 'same assertion failed' }),
      };
      const state = {
        task: 'Fix login', workspace: '/workspace', plan: [], steps: [failureStep], current_step: 1,
        max_steps: 10, total_pollen_cost: 0, budget: 100, repairAttempts: 0, codingState: 'verify',
      } as any;

      applyScopedVerificationRepair(state, failureStep as any, getWorkspaceRelativePath, (serialized) => serialized);
      expect(state.activeRepair.strategy).toBe('repair');
      expect(state.task).toContain('Exact output');
      applyScopedVerificationRepair(state, failureStep as any, getWorkspaceRelativePath, (serialized) => serialized);
      expect(state.activeRepair.strategy).toBe('inspect');
      applyScopedVerificationRepair(state, failureStep as any, getWorkspaceRelativePath, (serialized) => serialized);
      expect(state.codingState).toBe('blocked');
      expect(state.activeRepair).toBeUndefined();
      expect(state.blockedReason).toContain('Repeated unit-tests failure');
    });

    it('records blocked runs in the audit store with their real blocker reason', async () => {
      const state = {
        task: 'Create portfolio', workspace: '/workspace', plan: [], steps: [], current_step: 3,
        max_steps: 10, total_pollen_cost: 0.04, budget: 100, repairAttempts: 2,
        codingState: 'blocked', blockedReason: 'Repeated unit-tests failure reached the 2-attempt limit.',
      } as any;

      const result = await engine.handleBlockedState(state);

      expect(result.error).toContain('Repeated unit-tests failure');
      expect(reactLoggerModule.recordRunResult).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        100,
        false,
        [],
        0.04,
        undefined,
        expect.stringContaining('Repeated unit-tests failure'),
        undefined,
        expect.objectContaining({ outcomeKind: 'checkpoint_turn_limit' })
      );
    });

    it('does not classify a failed shell command as verification from a test-named workspace path', () => {
      const shellStep = {
        thought: 'Extract document',
        action: 'Bash',
        action_input: { command: 'node extract.js', cwd: 'C:\\MPC Project Test\\test 2' },
        observation: JSON.stringify({ success: false, error: 'filename syntax is incorrect' }),
      };
      const state = {
        task: 'Create portfolio', workspace: 'C:\\MPC Project Test\\test 2', plan: [], steps: [shellStep], current_step: 1,
        max_steps: 10, total_pollen_cost: 0, budget: 100, repairAttempts: 0, codingState: 'inspect',
      } as any;

      expect(applyScopedVerificationRepair(state, shellStep as any, getWorkspaceRelativePath, (serialized) => serialized)).toBe(false);
      expect(state.repairAttempts).toBe(0);
      expect(state.codingState).toBe('inspect');
    });
  });

  describe('Edit stagnation circuit breaker', () => {
    it('blocks the run when 3 consecutive edit operations fail with hash conflict on the same target', async () => {
      const state = {
        task: 'Fix todo.md',
        workspace: '/workspace',
        plan: [{ step: 'Update todo.md', status: 'in_progress' }],
        steps: [],
        current_step: 3,
        max_steps: 10,
        total_pollen_cost: 0.03,
        budget: 100,
        repairAttempts: 0,
        codingState: 'implement',
        consecutiveEditFailureCount: 2,
        consecutiveEditFailureTarget: 'todo.md',
      } as any;

      trackMutationFailure(state, 'todo.md', true);
      expect(isEditStagnated(state)).toBe(true);

      state.codingState = 'blocked';
      state.blockedReason = `Edit stagnation: ${state.consecutiveEditFailureCount} consecutive hash-conflict or stale preimage failures on "todo.md".`;
      const result = await engine.handleBlockedState(state);

      expect(result.error).toContain('Edit stagnation: 3 consecutive hash-conflict');
      expect(result.errorCode).toBe('EXECUTION_ERROR');
      expect(result.recoverable).toBe(true);
    });
  });
});
