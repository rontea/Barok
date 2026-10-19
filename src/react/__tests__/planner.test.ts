import { describe, it, expect } from '@jest/globals';
import {
  createExecutionPlan,
  checkIfDone,
  extractJsonFromText,
  normalizeAssistantText,
  planAction,
  hasCompletionEvidence,
  getPlannerActionTokenLimit,
  getDeterministicInspectionAnswer,
  hasSuccessfulVerificationSignal,
  hasUninspectedKnownMutationTargets,
  formatContinuationCheckpointContext,
  formatTaskAnalysisContext,
  isForcedMutationSelectionError,
  reason,
  synthesizeAnswer,
  classifyTaskType,
  getMutatedFiles,
  getPlatformShellInstruction,
  createPlannerContextSnapshot,
} from '../planner';
import type { LLMProvider, ToolRegistry } from '../../di/types';
import type { CodingState, ReactState } from '../state-manager';
import { buildFallbackAppSpec } from '../app-spec';
import { CommandSchema } from '../../types/schemas';
import { LocalActionBudgetController } from '../local-action-budget.js';
import { DEFAULT_CONTEXT_BUDGETS, LOCAL_CONTEXT_BUDGETS, estimateMessagesTokens } from '../token-accounting.js';

function createMockLlm(response: string): LLMProvider {
  return {
    createChatCompletion: async () => response,
    estimateStepCost: () => 0,
    getProviderName: () => 'mock',
    isAvailable: () => true,
  };
}

function createCapturingLlm(response: string): LLMProvider & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    createChatCompletion: async (messages) => {
      prompts.push(messages.map((message) => message.content).join('\n'));
      return response;
    },
    estimateStepCost: () => 0,
    getProviderName: () => 'mock',
    isAvailable: () => true,
  };
}

function createCapturingLlmWithOptions(response: string): LLMProvider & { prompts: string[]; optionsCaptured: any[] } {
  const prompts: string[] = [];
  const optionsCaptured: any[] = [];
  return {
    prompts,
    optionsCaptured,
    createChatCompletion: async (messages, model, options) => {
      prompts.push(messages.map((message) => message.content).join('\n'));
      optionsCaptured.push(options);
      return response;
    },
    estimateStepCost: () => 0,
    getProviderName: () => 'mock',
    isAvailable: () => true,
  };
}

function createSequentialLlm(responses: string[]): LLMProvider & { calls: number } {
  let calls = 0;
  const llm = {
    get calls() {
      return calls;
    },
    createChatCompletion: async () => responses[Math.min(calls++, responses.length - 1)],
    estimateStepCost: () => 0,
    getProviderName: () => 'mock',
    isAvailable: () => true,
  };

  return llm;
}

function createSequentialCapturingLlm(responses: string[]): LLMProvider & { calls: number; prompts: string[] } {
  let calls = 0;
  const prompts: string[] = [];
  const llm = {
    get calls() {
      return calls;
    },
    prompts,
    createChatCompletion: async (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => {
      prompts.push(messages.map((message) => message.content).join('\n'));
      return responses[Math.min(calls++, responses.length - 1)];
    },
    estimateStepCost: () => 0,
    getProviderName: () => 'mock',
    isAvailable: () => true,
  };

  return llm;
}

function createPlannerSnapshotState(overrides: Partial<ReactState> = {}): ReactState {
  return {
    task: 'Inspect the workspace and report the current behavior.',
    workspace: process.cwd(),
    model: 'test-model',
    plan: [],
    steps: [],
    toolEvidence: [],
    current_step: 0,
    max_steps: 10,
    total_pollen_cost: 0,
    budget: 100,
    repairAttempts: 0,
    codingState: 'understand',
    noProgressCount: 0,
    codingStateStartedStep: 0,
    codingStateStartedAt: Date.now(),
    ...overrides,
  } as ReactState;
}

function createMockRegistry(includeTodo = false): ToolRegistry {
  const tools = [
    {
      name: 'Bash',
      description: 'Run a shell command',
      inputSchema: { type: 'object' },
      handler: async () => ({ success: true, output: 'ok' }),
    },
    {
      name: 'Command',
      description: 'Run a structured command operation',
      inputSchema: CommandSchema.export(),
      handler: async () => ({ success: true, output: 'ok' }),
    },
    {
      name: 'Read',
      description: 'Read a file',
      inputSchema: { type: 'object' },
      handler: async () => ({ success: true, output: 'ok' }),
    },
    {
      name: 'WorkspaceChanges',
      description: 'Inspect recent workspace file updates',
      inputSchema: { type: 'object' },
      handler: async () => ({ success: true, output: 'ok' }),
    },
    {
      name: 'Write',
      description: 'Write a file',
      inputSchema: { type: 'object' },
      handler: async () => ({ success: true, output: 'ok' }),
    },
    {
      name: 'Edit',
      description: 'Edit a file',
      inputSchema: { type: 'object' },
      handler: async () => ({ success: true, output: 'ok' }),
    },
  ];

  if (includeTodo) {
    tools.push({
      name: 'Todo',
      description: 'Manage the run todo',
      inputSchema: {
        type: 'object',
        required: ['operation'],
        properties: {
          operation: { type: 'string', enum: ['set', 'add', 'update', 'remove', 'list', 'clear'] },
        },
      },
      handler: async () => ({ success: true, output: 'ok' }),
    });
  }

  return {
    getAll: () => tools,
    get: (name) => tools.find((tool) => tool.name === name),
    getEnabled: () => tools,
    has: (name) => tools.some((tool) => tool.name === name),
    register: () => {},
    setEnabled: () => {},
    getNames: () => tools.map((tool) => tool.name),
    size: () => tools.length,
  };
}

describe('planner context reconstruction', () => {
  it('covers every coding state and keeps read-only, baseline-verification, approval, and recovery guidance conditional', () => {
    const stateLabels: Record<CodingState, string> = {
      understand: 'understand',
      discover: 'discover',
      plan: 'plan',
      awaiting_plan_approval: 'awaiting_plan_approval',
      inspect: 'inspect',
      implement: 'implement',
      verify: 'verify',
      repair: 'repair',
      review: 'review',
      complete: 'complete',
      blocked: 'blocked',
    };
    const states = Object.keys(stateLabels) as CodingState[];
    const snapshots = states.map((codingState) => createPlannerContextSnapshot(
      createPlannerSnapshotState({ codingState }),
      'test-model',
      createMockRegistry(),
    ));

    states.forEach((codingState, index) => {
      const snapshot = snapshots[index] as { systemPrompt: string; injectedDirectives: string[] };
      expect(snapshot.systemPrompt).toContain(`- ${codingState}:`);
      expect(snapshot.injectedDirectives.join('\n')).toContain(`CURRENT CODING STATE (${codingState})`);
    });

    const readOnly = createPlannerContextSnapshot(createPlannerSnapshotState({
      codingState: 'inspect',
      taskAnalysis: { expectedChangeIntent: 'read_only', affectedFiles: [] } as any,
    }), 'test-model') as { injectedDirectives: string[] };
    expect(readOnly.injectedDirectives.join('\n')).toContain('This task is read-only');
    expect(readOnly.injectedDirectives.join('\n')).not.toContain('write before verify');

    const baselineVerification = createPlannerContextSnapshot(createPlannerSnapshotState({
      codingState: 'inspect',
      taskAnalysis: {
        expectedChangeIntent: 'modify',
        affectedFiles: [{ path: 'src/app.ts', intent: 'modify', reason: 'Existing source target.' }],
        requiredInspections: ['Read the source target.'],
        verificationPlan: ['Run the existing tests.'],
        validationRequirements: ['Confirm the requested behavior.'],
      } as any,
    }), 'test-model') as { injectedDirectives: string[] };
    expect(baselineVerification.injectedDirectives.join('\n')).toContain('run baseline verification without a cosmetic edit');

    const approval = createPlannerContextSnapshot(createPlannerSnapshotState({ codingState: 'awaiting_plan_approval' }), 'test-model') as { injectedDirectives: string[] };
    expect(approval.injectedDirectives.join('\n')).toContain('Do not perform workspace mutations until approval is recorded');
    const recovery = createPlannerContextSnapshot(createPlannerSnapshotState({ codingState: 'repair' }), 'test-model') as { injectedDirectives: string[] };
    expect(recovery.injectedDirectives.join('\n')).toContain('choose a narrow repair');
  });

  it('omits private reasoning and redacts credentials from copied prompt text', () => {
    const snapshot = createPlannerContextSnapshot(createPlannerSnapshotState({
      current_step: 1,
      steps: [{
        thought: 'PRIVATE_REASONING_SHOULD_NOT_APPEAR',
        action: 'Read',
        action_input: { file_path: 'src/app.ts' },
        observation: JSON.stringify({ success: true, output: 'api_key=sk_testSecretCredential1234567890' }),
      } as any],
    }), 'test-model') as { promptText: string; retainedReadContext: string; exactRequest: boolean };

    expect(snapshot.exactRequest).toBe(false);
    expect(snapshot.promptText).not.toContain('PRIVATE_REASONING_SHOULD_NOT_APPEAR');
    expect(snapshot.promptText).not.toContain('sk_testSecretCredential1234567890');
    expect(snapshot.retainedReadContext).toContain('[REDACTED]');
  });
});

describe('planner task analysis guidance', () => {
  it('injects Windows shell alternatives only for Windows runs', () => {
    const windowsInstruction = getPlatformShellInstruction('win32');

    expect(windowsInstruction).toContain('cmd.exe');
    expect(windowsInstruction).toContain('dir /a');
    expect(windowsInstruction).toContain('Get-ChildItem -Force');
    expect(windowsInstruction).toContain('NUL');
    expect(getPlatformShellInstruction('linux')).toBe('');
  });

  it('includes the resolved workspace and expected deliverables in agent context', () => {
    const context = formatTaskAnalysisContext({
      taskAnalysis: {
        workspace: 'C:/Projects/Barok',
        taskKind: 'new_feature',
        targetLayer: 'ui',
        behaviorScope: 'new_behavior',
        expectedChangeIntent: 'modify',
        approvalPolicy: 'ask',
        riskLevel: 'medium',
        refactorRisk: 'safe_change',
        requiresApproval: true,
        rationale: 'The request asks to implement a browser experience.',
        affectedFiles: [
          { path: 'index.html', intent: 'modify', reason: 'entry point', mustReadBeforeEdit: true },
          { path: 'script.js', intent: 'create', reason: 'runtime entry point', mustReadBeforeEdit: false },
        ],
        requiredInspections: ['Read index.html'],
        verificationPlan: ['Command verify'],
        validationRequirements: ['Run a browser smoke check.'],
        riskFactors: [],
        projectFileMap: {
          workspace: 'C:/Projects/Barok',
          generatedAt: Date.now(),
          totalFiles: 1,
          omittedCount: 0,
          files: [{ path: 'index.html', layer: 'ui', role: 'entry point', exists: true }],
        },
        contract: {
          requestedOutcome: 'Implement the browser experience and verify it.',
          candidateFiles: ['index.html', 'script.js'],
          historicalClaims: [],
        },
      },
    } as ReactState);

    expect(context).toContain('Use this exact resolved workspace for every file and command action: C:/Projects/Barok');
    expect(context).toContain('Requested outcome: Implement the browser experience and verify it.');
    expect(context).toContain('- modify index.html');
    expect(context).toContain('- create script.js');
  });
});

function createWriteOnlyRegistry(): ToolRegistry {
  const tools = [
    {
      name: 'Write',
      description: 'Write a file',
      inputSchema: { type: 'object' },
      handler: async () => ({ success: true, output: 'ok' }),
    },
  ];

  return {
    getAll: () => tools,
    get: (name) => tools.find((tool) => tool.name === name),
    getEnabled: () => tools,
    has: (name) => tools.some((tool) => tool.name === name),
    register: () => {},
    setEnabled: () => {},
    getNames: () => tools.map((tool) => tool.name),
    size: () => tools.length,
  };
}

function createRegistryWithGlob(): ToolRegistry {
  const base = createMockRegistry().getAll();
  const tools = [
    ...base,
    {
      name: 'Glob',
      description: 'Find files',
      inputSchema: { type: 'object' },
      handler: async () => ({ success: true, output: 'ok' }),
    },
  ];

  return {
    getAll: () => tools,
    get: (name) => tools.find((tool) => tool.name === name),
    getEnabled: () => tools,
    has: (name) => tools.some((tool) => tool.name === name),
    register: () => {},
    setEnabled: () => {},
    getNames: () => tools.map((tool) => tool.name),
    size: () => tools.length,
  };
}

function createRegistryWithGrep(): ToolRegistry {
  const base = createMockRegistry().getAll();
  const tools = [
    ...base,
    {
      name: 'Grep',
      description: 'Search file contents',
      inputSchema: {
        type: 'object',
        required: ['pattern'],
        properties: { pattern: { type: 'string' } },
      },
      handler: async () => ({ success: true, output: 'ok' }),
    },
  ];

  return {
    getAll: () => tools,
    get: (name) => tools.find((tool) => tool.name === name),
    getEnabled: () => tools,
    has: (name) => tools.some((tool) => tool.name === name),
    register: () => {},
    setEnabled: () => {},
    getNames: () => tools.map((tool) => tool.name),
    size: () => tools.length,
  };
}

function createState(): ReactState {
  return {
    task: 'Create an app',
    steps: [],
    current_step: 0,
    max_steps: 5,
    total_pollen_cost: 0,
    budget: 100,
    workspace: process.cwd(),
    config: {
      maxSteps: 5,
      model: 'mock',
      thinkingDepth: 'balanced',
      verbose: false,
      budget: 100,
      workspace: process.cwd(),
      onProgress: () => {},
      onStateUpdate: () => {},
      llmProvider: undefined as any,
      toolRegistry: undefined as any,
      debug: false,
    },
    plan: [],
  };
}

describe('planner JSON extraction', () => {
  it('falls back to the outer JSON span when quote-heavy content confuses scanning', () => {
    const response =
      'Here is the action: {"tool":"Write","arguments":{"file_path":"piano.html","content":"<div data-note="C4">{ sound: "piano" }</div>"}}';

    expect(extractJsonFromText(response)).toBe(
      '{"tool":"Write","arguments":{"file_path":"piano.html","content":"<div data-note="C4">{ sound: "piano" }</div>"}}'
    );
  });

  it('returns null for truncated JSON with no closing brace', () => {
    const response =
      '{"tool":"Write","arguments":{"file_path":"piano.html","content":"<!DOCTYPE html>\\n<style>\\n';

    expect(extractJsonFromText(response)).toBeNull();
  });

  it('preserves the tool name in tagged provider call syntax', () => {
    const response =
      '<|tool_call>call:Todo{"operation":"set","items":[{"step":"Inspect source","status":"in_progress"}]}<tool_call|>';

    expect(extractJsonFromText(response)).toBe(
      '{"tool":"Todo","arguments":{"operation":"set","items":[{"step":"Inspect source","status":"in_progress"}]}}',
    );
  });

  it('routes a tagged Todo call to Todo instead of Command', async () => {
    const action = await planAction(
      createState(),
      'Update the run checklist.',
      createMockLlm('<|tool_call>call:Todo{"operation":"set","items":[{"step":"Inspect source","status":"in_progress"}]}<tool_call|>'),
      { model: 'mock' },
      createMockRegistry(true),
    );

    expect(action).toEqual({
      action: 'Todo',
      action_input: {
        operation: 'set',
        items: [{ step: 'Inspect source', status: 'in_progress' }],
      },
    });
  });

  it('forces concrete progress after a successful Todo during implementation', async () => {
    const state = createState();
    state.codingState = 'implement';
    state.steps = [{
      thought: 'Set the implementation checklist.',
      action: 'Todo',
      action_input: {
        operation: 'set',
        items: [{ step: 'Implement the feature', status: 'in_progress' }],
      },
      observation: JSON.stringify({ success: true, operation: 'set' }),
    }];
    const llm = createSequentialCapturingLlm([
      '{"tool":"Todo","arguments":{"operation":"set","items":[{"step":"Implement the feature","status":"in_progress"}]}}',
      '{"tool":"Read","arguments":{"file_path":"src/app.ts"}}',
    ]);

    const action = await planAction(
      state,
      'Implement the requested feature.',
      llm,
      { model: 'mock' },
      createMockRegistry(true),
    );

    expect(action).toEqual({
      action: 'Read',
      action_input: { file_path: 'src/app.ts' },
    });
    expect(llm.calls).toBe(2);
    expect(llm.prompts[0]).toContain('CONCRETE PROGRESS OVERRIDE');
    expect(llm.prompts[0]).toContain('Do not select Todo again');
  });
});

describe('active checklist action gates', () => {
  it('keeps live category token estimates within five percent of the prepared prompt total', async () => {
    let categoryTokens: Record<string, number> | undefined;
    let totalTokens = 0;
    const llm: LLMProvider = {
      createChatCompletion: async (messages, _model, options) => {
        totalTokens = estimateMessagesTokens(messages);
        categoryTokens = options?.categoryTokens as Record<string, number> | undefined;
        return '{"tool":"Read","arguments":{"file_path":"src/app.ts"}}';
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'mock',
      isAvailable: () => true,
    };

    await planAction(createState(), 'Inspect the application source.', llm, { model: 'mock' }, createMockRegistry());

    const categoryTotal = Object.values(categoryTokens || {}).reduce((sum, value) => sum + value, 0);
    expect(categoryTokens).toMatchObject({ task: expect.any(Number), plan: expect.any(Number), evidence: expect.any(Number), activeErrors: expect.any(Number), memory: expect.any(Number), history: expect.any(Number), system: expect.any(Number) });
    expect(totalTokens).toBeGreaterThan(0);
    expect(Math.abs(categoryTotal - totalTokens) / totalTokens).toBeLessThanOrEqual(0.05);
  });

  it('directs verify-state prompts to run a check and prioritizes verification tools', async () => {
    const llm = createCapturingLlm('{"tool":"Command","arguments":{"operation":"verify"}}');
    const state = createState();
    state.codingState = 'verify';

    await expect(planAction(state, 'Continue with the task.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({ action: 'Command', action_input: { operation: 'verify' } });

    const prompt = llm.prompts[0];
    expect(prompt).toContain('Current goal: You are in verification state. Execute the verification check now');
    const systemCatalogStart = prompt.indexOf('Available tools:\n');
    const systemCatalogEnd = prompt.indexOf('\nMODEL CAPABILITY CONTRACT:', systemCatalogStart);
    const systemCatalog = prompt.slice(systemCatalogStart, systemCatalogEnd);
    expect(systemCatalog.indexOf('- Command:')).toBeLessThan(systemCatalog.indexOf('- Read:'));

    const actionCatalogStart = prompt.lastIndexOf('\nAvailable tools:\n');
    const actionCatalog = prompt.slice(actionCatalogStart);
    expect(actionCatalog.indexOf('Command:')).toBeLessThan(actionCatalog.indexOf('Read:'));
  });

  it('accepts WorkspaceChanges as an inspection action', async () => {
    const llm = createMockLlm('{"tool":"WorkspaceChanges","arguments":{"max_files":10}}');
    const state = createState();
    state.plan = [{ step: 'Inspect source', status: 'in_progress', kind: 'inspect' }];

    await expect(planAction(state, 'Inspect source.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({ action: 'WorkspaceChanges', action_input: { max_files: 10 } });
  });

  it('corrects a mutation when inspection is the active item', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Write","arguments":{"file_path":"src/app.ts","content":"new"}}',
      '{"tool":"Read","arguments":{"file_path":"src/app.ts"}}',
    ]);
    const state = createState();
    state.plan = [{ step: 'Inspect source', status: 'in_progress', kind: 'inspect' }];

    await expect(planAction(state, 'Inspect source.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({ action: 'Read', action_input: { file_path: 'src/app.ts' } });
    expect(llm.calls).toBe(2);
  });

  it('corrects an inspection when implementation is the active item', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Read","arguments":{"file_path":"src/app.ts"}}',
      '{"tool":"Write","arguments":{"file_path":"src/app.ts","content":"new"}}',
    ]);
    const state = createState();
    state.plan = [{ step: 'Implement the change', status: 'in_progress', kind: 'implement' }];

    await expect(planAction(state, 'Implement the change.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({ action: 'Write', action_input: { file_path: 'src/app.ts', content: 'new' } });
    expect(llm.calls).toBe(2);
  });

  it('allows one targeted re-read after a failed mutation on an implementation item', async () => {
    const llm = createMockLlm('{"tool":"Read","arguments":{"file_path":"src/app.ts"}}');
    const state = createState();
    state.plan = [{ step: 'Implement the change', status: 'in_progress', kind: 'implement' }];
    state.steps = [{
      thought: 'apply the change',
      action: 'Edit',
      action_input: { file_path: 'src/app.ts', old_string: 'stale', new_string: 'new' },
      observation: JSON.stringify({ success: false, error: 'Transactional Edit refused: old_string was not found in the guarded preimage.' }),
    }];

    await expect(planAction(state, 'Refresh the file and retry the implementation.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({ action: 'Read', action_input: { file_path: 'src/app.ts' } });
  });

  it('rejects replaying a stale Edit after the target has been reread', async () => {
    const llm = createSequentialLlm([
      JSON.stringify({
        tool: 'Edit',
        arguments: { file_path: 'src/app.ts', old_string: 'stale', new_string: 'new', expectedHash: 'old-hash' },
      }),
      JSON.stringify({
        tool: 'Edit',
        arguments: { file_path: 'src/app.ts', old_string: 'current', new_string: 'new', expectedHash: 'fresh-hash' },
      }),
    ]);
    const state = createState();
    state.steps = [
      {
        thought: 'apply the stale patch',
        action: 'Edit',
        action_input: { file_path: 'src/app.ts', old_string: 'stale', new_string: 'new', expectedHash: 'old-hash' },
        observation: JSON.stringify({ success: false, error: 'Transactional Edit refused: old_string was not found in the guarded preimage.' }),
      },
      {
        thought: 'refresh the target',
        action: 'Read',
        action_input: { file_path: 'src/app.ts' },
        observation: JSON.stringify({ success: true, output: 'const current = true;' }),
      },
    ];

    await expect(planAction(state, 'Apply the refreshed implementation.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({
        action: 'Edit',
        action_input: { file_path: 'src/app.ts', old_string: 'current', new_string: 'new', expectedHash: 'fresh-hash' },
      });
    expect(llm.calls).toBe(2);
  });

  it('allows edits on a different file even when one file is in stale edit recovery', async () => {
    const llm = createSequentialLlm([JSON.stringify({
      tool: 'Edit',
      arguments: { file_path: 'src/other.ts', old_string: 'stale', new_string: 'new', expectedHash: 'old-hash' },
    })]);
    const state = createState();
    state.steps = [
      {
        thought: 'apply the stale patch to app.ts',
        action: 'Edit',
        action_input: { file_path: 'src/app.ts', old_string: 'stale', new_string: 'new', expectedHash: 'old-hash' },
        observation: JSON.stringify({ success: false, error: 'Transactional Edit refused: old_string was not found in the guarded preimage.' }),
      },
      {
        thought: 'refresh app.ts',
        action: 'Read',
        action_input: { file_path: 'src/app.ts' },
        observation: JSON.stringify({ success: true, output: 'const current = true;' }),
      },
    ];

    await expect(planAction(state, 'Edit other.ts.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({
        action: 'Edit',
        action_input: { file_path: 'src/other.ts', old_string: 'stale', new_string: 'new', expectedHash: 'old-hash' },
      });
    expect(llm.calls).toBe(1);
  });

  it('does not allow a failed-mutation re-read once forced recovery is active', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Read","arguments":{"file_path":"src/app.ts"}}',
      '{"tool":"Write","arguments":{"file_path":"src/app.ts","content":"new"}}',
    ]);
    const state = createState();
    state.plan = [{ step: 'Implement the change', status: 'in_progress', kind: 'implement' }];
    state.forceMutationNextAction = true;
    state.steps = [{
      thought: 'apply the change',
      action: 'Edit',
      action_input: { file_path: 'src/app.ts', old_string: 'stale', new_string: 'new' },
      observation: JSON.stringify({ success: false, error: 'Transactional Edit refused: old_string was not found in the guarded preimage.' }),
    }];

    await expect(planAction(state, 'Continue the implementation.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({ action: 'Write', action_input: { file_path: 'src/app.ts', content: 'new' } });
    expect(llm.calls).toBe(2);
  });

  it('clears stale forced-mutation recovery when every existing target is ready for baseline verification', async () => {
    const llm = createSequentialLlm(['{"tool":"Command","arguments":{"operation":"verify","args":["npm","test"]}}']);
    const state = createState();
    state.plan = [{ step: 'Verify the existing implementation', status: 'in_progress', kind: 'implement' }];
    state.taskAnalysis = {
      taskKind: 'bug_fix',
      expectedChangeIntent: 'modify',
      affectedFiles: [{ path: 'src/app.ts', intent: 'modify', reason: 'Existing source target.', mustReadBeforeEdit: true }],
    } as any;
    state.forceMutationNextAction = true;
    state.steps = [{
      thought: 'Inspect existing source.',
      action: 'Read',
      action_input: { file_path: 'src/app.ts' },
      observation: JSON.stringify({ success: true, output: 'existing source' }),
    }];

    await expect(planAction(state, 'Verify the current implementation.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({ action: 'Command', action_input: { operation: 'verify', args: ['npm', 'test'] } });
    expect(state.forceMutationNextAction).toBe(false);
    expect(llm.calls).toBe(1);
  });

  it('does not allow recovery reads for a different file', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Read","arguments":{"file_path":"src/other.ts"}}',
      '{"tool":"Write","arguments":{"file_path":"src/app.ts","content":"new"}}',
    ]);
    const state = createState();
    state.plan = [{ step: 'Implement the change', status: 'in_progress', kind: 'implement' }];
    state.steps = [{
      thought: 'apply the change',
      action: 'Edit',
      action_input: { file_path: 'src/app.ts', old_string: 'stale', new_string: 'new' },
      observation: JSON.stringify({ success: false, error: 'Transactional Edit refused: old_string was not found in the guarded preimage.' }),
    }];

    await expect(planAction(state, 'Implement the change.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({ action: 'Write', action_input: { file_path: 'src/app.ts', content: 'new' } });
    expect(llm.calls).toBe(2);
  });

  it('falls back to the failed mutation target after repeated invalid recovery reads', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Read","arguments":{"file_path":"src/other.ts"}}',
      '{"tool":"Read","arguments":{"file_path":"src/other.ts"}}',
      '{"tool":"Read","arguments":{"file_path":"src/other.ts"}}',
    ]);
    const state = createState();
    state.plan = [{ step: 'Implement the change', status: 'in_progress', kind: 'implement' }];
    state.steps = [{
      thought: 'apply the change',
      action: 'Edit',
      action_input: { file_path: 'src/app.ts', old_string: 'stale', new_string: 'new' },
      observation: JSON.stringify({ success: false, error: 'Transactional Edit refused: old_string was not found in the guarded preimage.' }),
    }];

    await expect(planAction(state, 'Implement the change.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({ action: 'Read', action_input: { file_path: 'src/app.ts' } });
    expect(llm.calls).toBe(3);
  });

  it('allows a targeted read when a failed continuation starts with no prior steps', async () => {
    const llm = createMockLlm('{"tool":"Read","arguments":{"file_path":"index.html"}}');
    const state = createState();
    state.task = `Continuation handoff. The current request is authoritative.

Latest status (unverified):
- error: Invalid corrective tool selection: Active checklist item requires implementation; Read cannot advance it.

Relevant files:
- C:\\MPC Project Test\\website test 1\\index.html

Current request:
Add model images to the homepage.`;
    state.plan = [{ step: 'Implement the change', status: 'in_progress', kind: 'implement' }];

    await expect(planAction(state, 'Recover the interrupted implementation.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({ action: 'Read', action_input: { file_path: 'index.html' } });
  });

  it('corrects a file read when verification is the active item', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Read","arguments":{"file_path":"src/app.ts"}}',
      '{"tool":"Command","arguments":{"operation":"test"}}',
    ]);
    const state = createState();
    state.plan = [{ step: 'Verify the change', status: 'in_progress', kind: 'verify' }];

    await expect(planAction(state, 'Verify the change.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({ action: 'Command', action_input: { operation: 'test' } });
    expect(llm.calls).toBe(2);
  });

  it('falls back to verification when the model repeatedly selects Write during verify phase', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Write","arguments":{"file_path":"src/app.ts","content":"hello"}}',
      '{"tool":"Write","arguments":{"file_path":"src/app.ts","content":"hello"}}',
      '{"tool":"Write","arguments":{"file_path":"src/app.ts","content":"hello"}}',
    ]);
    const state = createState();
    state.forceMutationNextAction = true;
    state.plan = [{ step: 'Verify the change', status: 'in_progress', kind: 'verify' }];

    await expect(planAction(state, 'Verify the change.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({ action: 'Command', action_input: { operation: 'verify' } });
  });

  it('falls back to Bash npm test when Command is absent and model repeatedly selects Write during verify phase', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Write","arguments":{"file_path":"src/app.ts","content":"hello"}}',
      '{"tool":"Write","arguments":{"file_path":"src/app.ts","content":"hello"}}',
      '{"tool":"Write","arguments":{"file_path":"src/app.ts","content":"hello"}}',
    ]);
    const state = createState();
    state.workspace = 'c:/workspace';
    state.forceMutationNextAction = true;
    state.plan = [{ step: 'Verify the change', status: 'in_progress', kind: 'verify' }];
    const baseRegistry = createMockRegistry();
    const registry = {
      ...baseRegistry,
      has: (name: string) => name !== 'Command' && baseRegistry.has(name),
      get: (name: string) => (name === 'Command' ? undefined : baseRegistry.get(name)),
      getAll: () => baseRegistry.getAll().filter((t) => t.name !== 'Command'),
      getEnabled: () => baseRegistry.getEnabled().filter((t) => t.name !== 'Command'),
      getNames: () => baseRegistry.getNames().filter((n) => n !== 'Command'),
    };

    const expectedCmd = process.platform === 'win32' ? 'npm.cmd test' : 'npm test';
    await expect(planAction(state, 'Verify the change.', llm, { model: 'mock' }, registry))
      .resolves.toEqual({ action: 'Bash', action_input: { command: expectedCmd, cwd: 'c:/workspace', timeout: 120000 } });
  });

  it('corrects a Write call missing content on the second corrective attempt', async () => {
    const llm = createSequentialLlm([
      // First attempt: Write with file_path but no content — invalid
      '{"tool":"Write","arguments":{"file_path":"src/app.ts"}}',
      // Second attempt (corrective): Write with both file_path and content — valid
      '{"tool":"Write","arguments":{"file_path":"src/app.ts","content":"const x = 1;"}}',
    ]);
    const state = createState();

    const result = await planAction(state, 'Write a file.', llm, { model: 'mock' }, createMockRegistry());
    expect(llm.calls).toBe(2);
    expect(result.action).toBe('Write');
    expect((result.action_input as Record<string, unknown>).file_path).toBe('src/app.ts');
    expect((result.action_input as Record<string, unknown>).content).toBe('const x = 1;');
  });

  it('throws "Write requires content" when all corrective attempts produce a Write with no content', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Write","arguments":{"file_path":"src/app.ts"}}',
      '{"tool":"Write","arguments":{"file_path":"src/app.ts"}}',
      '{"tool":"Write","arguments":{"file_path":"src/app.ts"}}',
    ]);
    const state = createState();
    state.forceMutationNextAction = true;

    await expect(
      planAction(state, 'Write a file.', llm, { model: 'mock' }, createMockRegistry())
    ).rejects.toThrow(/Write requires content or content_base64/);
  });
});

describe('stale edit candidate validation', () => {
  it('does not block an Edit when the candidate has no file_path or path field', async () => {
    // A candidate missing the target field entirely must not be mistaken for a
    // stale-replay match: staleEditRecoveryContext must return undefined for it.
    // We set up a stale-edit history on src/app.ts and confirm the planner does
    // not immediately error on a candidate with no file_path (it may get a
    // different validation error, but not the stale-replay guard).
    const llm = createSequentialLlm([
      // First response: an Edit with no file_path — should NOT be caught as stale-replay.
      JSON.stringify({ tool: 'Edit', arguments: { old_string: 'stale', new_string: 'new', expectedHash: 'h1' } }),
      // Second response: a valid Edit on a different string — accepted.
      JSON.stringify({ tool: 'Edit', arguments: { file_path: 'src/app.ts', old_string: 'current', new_string: 'updated', expectedHash: 'h2' } }),
    ]);
    const state = createState();
    state.steps = [
      {
        thought: 'apply the stale patch',
        action: 'Edit',
        action_input: { file_path: 'src/app.ts', old_string: 'stale', new_string: 'new', expectedHash: 'h1' },
        observation: JSON.stringify({ success: false, error: 'Transactional Edit refused: old_string was not found in the guarded preimage.' }),
      },
      {
        thought: 'refresh the target',
        action: 'Read',
        action_input: { file_path: 'src/app.ts' },
        observation: JSON.stringify({ success: true, output: 'const current = true;' }),
      },
    ];

    // The planner must reach at least 2 LLM calls: the first candidate (no
    // file_path) gets rejected for a different reason and triggers a correction;
    // the second candidate (valid, different old_string) is accepted.
    const result = await planAction(state, 'Apply the edit.', llm, { model: 'mock' }, createMockRegistry());
    expect(llm.calls).toBeGreaterThanOrEqual(2);
    expect(result.action).toBe('Edit');
    expect((result.action_input as Record<string, unknown>).old_string).toBe('current');
  });

  it('treats differently-cased Windows paths as the same stale edit target', async () => {
    const llm = createSequentialLlm([
      // Attempts to replay the exact stale payload — must be rejected.
      JSON.stringify({ tool: 'Edit', arguments: { file_path: 'C:\\Workspace\\Src\\App.ts', old_string: 'stale', new_string: 'new', expectedHash: 'h1' } }),
      // Corrected payload with a fresh old_string — must be accepted.
      JSON.stringify({ tool: 'Edit', arguments: { file_path: 'C:\\Workspace\\Src\\App.ts', old_string: 'refreshed', new_string: 'new', expectedHash: 'h2' } }),
    ]);
    const state = createState();
    // Windows workspace path ensures mutationPathKey lowercases both sides.
    state.workspace = 'C:\\Workspace';
    state.steps = [
      {
        thought: 'apply the stale patch',
        action: 'Edit',
        action_input: { file_path: 'C:\\Workspace\\Src\\App.ts', old_string: 'stale', new_string: 'new', expectedHash: 'h1' },
        observation: JSON.stringify({ success: false, error: 'Transactional Edit refused: old_string was not found in the guarded preimage.' }),
      },
      {
        thought: 'refresh with differently-cased path',
        action: 'Read',
        action_input: { file_path: 'c:\\workspace\\src\\app.ts' },
        observation: JSON.stringify({ success: true, output: 'const refreshed = true;' }),
      },
    ];

    // The stale replay guard must fire for the identically-stale payload; the
    // second attempt (different old_string) is accepted.
    const result = await planAction(state, 'Retry with refreshed content.', llm, { model: 'mock' }, createMockRegistry());
    expect(result.action).toBe('Edit');
    expect((result.action_input as Record<string, unknown>).old_string).toBe('refreshed');
  });

  it('clears stale edit recovery once a later successful mutation exists for the same target', async () => {
    const llm = createSequentialLlm([JSON.stringify({
      tool: 'Edit',
      arguments: { file_path: 'src/app.ts', old_string: 'stale', new_string: 'new', expectedHash: 'stale-hash' },
    })]);
    const state = createState();
    state.steps = [
      {
        thought: 'first stale attempt',
        action: 'Edit',
        action_input: { file_path: 'src/app.ts', old_string: 'stale', new_string: 'new', expectedHash: 'stale-hash' },
        observation: JSON.stringify({ success: false, error: 'Transactional Edit refused: old_string was not found in the guarded preimage.' }),
      },
      {
        thought: 'refresh the file',
        action: 'Read',
        action_input: { file_path: 'src/app.ts' },
        observation: JSON.stringify({ success: true, output: 'const current = true;' }),
      },
      {
        thought: 'apply the correct edit',
        action: 'Edit',
        action_input: { file_path: 'src/app.ts', old_string: 'current', new_string: 'updated', expectedHash: 'fresh-hash' },
        observation: JSON.stringify({ success: true, output: 'Edit applied.' }),
      },
    ];

    // After a successful Edit on the same target, the stale-replay guard must be
    // cleared. The original stale payload should now be accepted without a
    // correction loop (only one LLM call required).
    const result = await planAction(state, 'Apply another patch.', llm, { model: 'mock' }, createMockRegistry());
    expect(llm.calls).toBe(1);
    expect(result.action).toBe('Edit');
  });

  it('does not let a stale edit on fileA block a clean edit on fileB', async () => {
    const llm = createSequentialLlm([JSON.stringify({
      tool: 'Edit',
      arguments: { file_path: 'src/other.ts', old_string: 'target', new_string: 'updated', expectedHash: 'h-other' },
    })]);
    const state = createState();
    state.steps = [
      {
        thought: 'stale patch on app.ts',
        action: 'Edit',
        action_input: { file_path: 'src/app.ts', old_string: 'stale', new_string: 'new', expectedHash: 'h-app' },
        observation: JSON.stringify({ success: false, error: 'Transactional Edit refused: old_string was not found in the guarded preimage.' }),
      },
      {
        thought: 'refresh app.ts',
        action: 'Read',
        action_input: { file_path: 'src/app.ts' },
        observation: JSON.stringify({ success: true, output: 'const current = true;' }),
      },
    ];

    // A clean edit on src/other.ts must pass immediately — the stale-replay
    // guard is scoped to src/app.ts and must not interfere.
    const result = await planAction(state, 'Edit other.ts.', llm, { model: 'mock' }, createMockRegistry());
    expect(llm.calls).toBe(1);
    expect(result.action).toBe('Edit');
    expect((result.action_input as Record<string, unknown>).file_path).toBe('src/other.ts');
  });
});

describe('planner action parsing', () => {
  it('removes pseudo-tool markup from reasoning rationale', async () => {
    const llm = createMockLlm(
      'Inspect the requested file first. <tool_call><function=Read>file_path=src/app.ts</function></tool_call> ```tool_call\n{"name":"Read"}\n```',
    );

    const rationale = await reason(createState(), llm, { model: 'mock' }, createMockRegistry());

    expect(rationale).toBe('Inspect the requested file first.');
    expect(rationale).not.toMatch(/tool_call|function=|```/i);
  });

  it('uses the local context budget profile for local planner routes', async () => {
    let capturedBudgets: readonly unknown[] | undefined;
    const contextAssembly = {
      prepareMessages: (messages: Array<{ role: string; content: string }>) => ({ messages }),
      compactSections: (sections: Record<string, string>, budgets: readonly unknown[]) => {
        capturedBudgets = budgets;
        return sections;
      },
    } as any;
    const llm: LLMProvider = {
      createChatCompletion: async () => 'Inspect the current task evidence.',
      estimateStepCost: () => 0,
      getProviderName: () => 'local',
      isAvailable: () => true,
    };

    await reason(createState(), llm, {
      model: 'local:qwen3-local',
      contextAssembly,
    }, createMockRegistry());

    expect(capturedBudgets).toBe(LOCAL_CONTEXT_BUDGETS);
    expect(capturedBudgets).not.toBe(DEFAULT_CONTEXT_BUDGETS);
  });

  it('classifies exhausted forced-mutation selections for engine recovery', () => {
    expect(isForcedMutationSelectionError(
      'Invalid corrective tool selection: The engine is forcing implementation after a repeated loop; Read is not allowed. Choose Write or Edit now.',
    )).toBe(true);
    expect(isForcedMutationSelectionError(
      'Invalid corrective tool selection: Active checklist item requires implementation; Read cannot advance it.',
    )).toBe(false);
  });

  it('uses small action budgets outside implementation and larger chunks for implementation', () => {
    expect(getPlannerActionTokenLimit({ codingState: 'inspect' })).toBe(640);
    expect(getPlannerActionTokenLimit({ codingState: 'verify' })).toBe(640);
    expect(getPlannerActionTokenLimit({ codingState: 'implement' })).toBe(4_000);
    expect(getPlannerActionTokenLimit({ codingState: 'repair' })).toBe(4_000);
  });

  it('passes a slow local model an adaptive implementation budget and chunk hint', async () => {
    const localActionBudget = new LocalActionBudgetController({
      defaultGenerationTokensPerSecond: 18,
      promptTokensPerSecond: 300,
      safetyMarginMs: 10_000,
    });
    localActionBudget.observe({
      provider: 'local',
      model: 'qwen3-local',
      status: 'succeeded',
      durationMs: 90_000,
      estimatedInputTokens: 12_000,
      estimatedOutputTokens: 1_200,
    });
    let capturedOptions: any;
    let capturedPrompt = '';
    const llm: LLMProvider = {
      createChatCompletion: async (messages, _model, options) => {
        capturedPrompt = messages.map((message) => message.content).join('\n');
        capturedOptions = options;
        return '{"tool":"Write","arguments":{"file_path":"src/app.ts","content":"export const app = true;"}}';
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'local',
      isAvailable: () => true,
    };
    const state = createState();
    state.codingState = 'implement';

    await planAction(state, 'Create the app source.', llm, {
      model: 'qwen3-local',
      requestTimeoutMs: 90_000,
      localActionBudget,
    }, createMockRegistry());

    expect(capturedOptions.structuredActionClass).toBe('implementation');
    expect(capturedOptions.maxTokens).toBeLessThan(4_000);
    expect(capturedPrompt).toMatch(/Keep each Write content or content_base64 chunk at or below [\d,]+ characters/);
  });

  it('does not apply local action caps to remote planner routes', async () => {
    const localActionBudget = new LocalActionBudgetController({ defaultGenerationTokensPerSecond: 18 });
    let capturedMaxTokens = 0;
    const llm: LLMProvider = {
      createChatCompletion: async (_messages, _model, options) => {
        capturedMaxTokens = options?.maxTokens || 0;
        return '{"tool":"Read","arguments":{"file_path":"README.md"}}';
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'openrouter',
      isAvailable: () => true,
    };
    const state = createState();
    state.codingState = 'implement';

    await planAction(state, 'Inspect the app.', llm, {
      model: 'openrouter:test-model',
      requestTimeoutMs: 2_000,
      localActionBudget,
    }, createMockRegistry());

    expect(capturedMaxTokens).toBe(4_000);
  });

  it('routes tool selection through the configured fast planner model', async () => {
    const calls: Array<{ model: string; maxTokens?: number; requestKind?: string }> = [];
    const llm: LLMProvider = {
      createChatCompletion: async (_messages, model, options) => {
        calls.push({ model, maxTokens: options?.maxTokens, requestKind: options?.requestKind });
        return '{"tool":"Read","arguments":{"file_path":"index.html"}}';
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'mock',
      isAvailable: () => true,
    };
    const state = createState();
    state.codingState = 'inspect';

    await planAction(state, 'Inspect the entry point.', llm, {
      model: 'large-primary',
      plannerModel: 'openai-fast',
      requestKind: 'step.plan_action',
    }, createMockRegistry());

    expect(calls).toEqual([{ model: 'openai-fast', maxTokens: 640, requestKind: 'step.plan_action' }]);
  });

  it('keeps a pinned Coder target authoritative for planner calls', async () => {
    const calls: string[] = [];
    const llm: LLMProvider = {
      createChatCompletion: async (_messages, model) => {
        calls.push(model);
        return '{"tool":"Read","arguments":{"file_path":"index.html"}}';
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'mock',
      isAvailable: () => true,
    };
    const target = 'nvidia-target:key-2-google-gemma-4-31b-it';

    await planAction(
      createState(),
      'Inspect the entry point.',
      llm,
      { model: target, plannerModel: target, requestKind: 'step.plan_action' },
      createMockRegistry()
    );

    expect(calls).toEqual([target]);
  });

  it('provides active tool schemas to a NVIDIA tool-capable planner target', async () => {
    let capturedOptions: any;
    const llm: LLMProvider = {
      createChatCompletion: async (_messages, _model, options) => {
        capturedOptions = options;
        return '{"tool":"Read","arguments":{"file_path":"package.json"}}';
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'nvidia',
      isAvailable: () => true,
    };

    await planAction(
      createState(),
      'Read package.json.',
      llm,
      { model: 'qwen/qwen3-coder-480b-a35b-instruct' },
      createMockRegistry()
    );

    expect(capturedOptions.toolChoice).toBe('required');
    expect(capturedOptions.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'Read' }) }),
    ]));
  });

  it('provides active tool schemas to an OpenRouter model advertising native tools', async () => {
    let capturedOptions: any;
    const llm: LLMProvider = {
      createChatCompletion: async (_messages, _model, options) => {
        capturedOptions = options;
        return '{"tool":"Read","arguments":{"file_path":"package.json"}}';
      },
      getModelCapabilities: () => ({
        streaming: true,
        toolCalling: true,
        structuredOutput: true,
        jsonMode: true,
        vision: false,
      }),
      estimateStepCost: () => 0,
      getProviderName: () => 'openrouter',
      isAvailable: () => true,
    };

    await planAction(
      createState(),
      'Read package.json.',
      llm,
      { model: 'stealth/ox-alpha' },
      createMockRegistry()
    );

    expect(capturedOptions.toolChoice).toBe('required');
    expect(capturedOptions.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'Read' }) }),
    ]));
  });

  it('skips the separate reasoning request when native tool planning is enabled', async () => {
    const llm = createCapturingLlm('This response should not be requested.');

    await expect(reason(
      createState(),
      llm,
      { model: 'stealth/ox-alpha', skipSeparateReasoning: true },
    )).resolves.toBe('Use the current task evidence and select the next concrete tool action.');

    expect(llm.prompts).toHaveLength(0);
  });

  it('uses one local structured request with native thinking when separate reasoning is skipped', async () => {
    let capturedOptions: any;
    let capturedMessages: Array<{ role: string; content: string }> = [];
    const llm: LLMProvider = {
      createChatCompletion: async (messages, _model, options) => {
        capturedMessages = messages;
        capturedOptions = options;
        return '{"tool":"Read","arguments":{"file_path":"README.md"}}';
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'local',
      isAvailable: () => true,
    };

    await planAction(
      createState(),
      'Use the current evidence.',
      llm,
      { model: 'local:qwen3-local', skipSeparateReasoning: true },
      createMockRegistry(),
    );

    expect(capturedMessages).toHaveLength(3);
    expect(capturedMessages[2].content).toContain('Use native private reasoning as needed');
    expect(capturedOptions.disableLocalThinking).toBe(false);
    expect(capturedOptions.cachePrompt).toBe(true);
  });

  it('shows an early recovery cue after an exact tool failure repeats', async () => {
    const state = createState();
    state.steps = [
      {
        thought: 'inspect the directory',
        action: 'Bash',
        action_input: { command: 'dir"' },
        observation: JSON.stringify({ success: false, error: "'dir\"' is not recognized as an internal or external command" }),
      },
      {
        thought: 'try the same command',
        action: 'Bash',
        action_input: { command: 'dir"' },
        observation: JSON.stringify({ success: false, error: "'dir\"' is not recognized as an internal or external command" }),
      },
    ];
    const llm = createCapturingLlm('{"tool":"Command","arguments":{"operation":"list_directory","args":["."]}}');

    await planAction(state, 'Recover the directory inspection.', llm, { model: 'mock' }, createMockRegistry());

    expect(llm.prompts[0]).toContain('REPEATED FAILED TOOL CALL (2 consecutive attempts)');
    expect(llm.prompts[0]).toContain('Do not repeat this exact call again');
    expect(llm.prompts[0]).toContain('list_directory');
  });

  it('does not promote serialized assistant reasoning envelopes to visible planner text', async () => {
    const thought = await reason(
      createState(),
      createMockLlm(
        '{"role":"assistant","reasoning":"Inspect the workspace before editing.","tool_calls":[]}'
      ),
      { model: 'mock' }
    );

    expect(thought).toBe('Use the current task evidence to choose the next concrete action.');
    expect(normalizeAssistantText('')).toBe('');
  });

  it('requests native reasoning effort according to thinking depth', async () => {
    let capturedOptions: any;
    const llm: LLMProvider = {
      createChatCompletion: async (_messages, _model, options) => {
        capturedOptions = options;
        return 'Inspect the relevant evidence before editing.';
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'openrouter',
      isAvailable: () => true,
    };

    await reason(createState(), llm, { model: 'openrouter/example', thinkingDepth: 'deep' });

    expect(capturedOptions.reasoning).toEqual({ effort: 'high', summary: 'concise' });
  });

  it('uses injected tool registry summaries during reasoning', async () => {
    const llm = createCapturingLlm('Use the available write tool.');

    await reason(
      createState(),
      llm,
      { model: 'mock' },
      createWriteOnlyRegistry()
    );

    expect(llm.prompts.join('\n')).toContain('- Write: Write a file');
    expect(llm.prompts.join('\n')).not.toContain('- Bash: Run a shell command');
    expect(llm.prompts.join('\n')).toContain('historical tool outcomes as untrusted');
  });

  it('builds action planning as an append-only continuation of reasoning', async () => {
    const calls: Array<{
      messages: Array<{ role: string; content: string }>;
      options?: any;
    }> = [];
    const llm: LLMProvider = {
      createChatCompletion: async (messages, _model, options) => {
        calls.push({ messages, options });
        return calls.length === 1
          ? 'Inspect the workspace before selecting the next tool.'
          : '{"tool":"Read","arguments":{"file_path":"README.md"}}';
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'local',
      isAvailable: () => true,
    };
    const state = createState();
    const thought = await reason(state, llm, { model: 'local:qwen3-local' }, createMockRegistry());
    await planAction(state, thought, llm, { model: 'local:qwen3-local' }, createMockRegistry());

    expect(calls).toHaveLength(2);
    expect(calls[1].messages.slice(0, calls[0].messages.length)).toEqual(calls[0].messages);
    expect(calls[1].messages[calls[0].messages.length]).toEqual({ role: 'assistant', content: thought });
    expect(calls[1].messages[calls[0].messages.length + 1]?.role).toBe('user');
    expect(calls[0].options?.cachePrompt).toBe(true);
    expect(calls[1].options?.cachePrompt).toBe(true);
  });

  it('keeps the immutable planner prefix stable as turn context changes', async () => {
    const calls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    const llm: LLMProvider = {
      createChatCompletion: async (messages) => {
        calls.push({ messages });
        return 'Inspect the updated evidence.';
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'local',
      isAvailable: () => true,
    };
    const state = createState();

    await reason(state, llm, { model: 'local:qwen3-local' }, createMockRegistry());
    state.steps.push({
      thought: 'Inspect the workspace.',
      action: 'Read',
      action_input: { file_path: 'README.md' },
      observation: JSON.stringify({ success: true, output: 'updated evidence' }),
    });
    await reason(state, llm, { model: 'local:qwen3-local' }, createMockRegistry());

    expect(calls).toHaveLength(2);
    expect(calls[1].messages[0]).toEqual(calls[0].messages[0]);
    expect(calls[1].messages[1].content).not.toEqual(calls[0].messages[1].content);
    expect(calls[1].messages[1].content).toContain('updated evidence');
  });

  it('keeps retained tool turns as append-only assistant and observation messages', async () => {
    const calls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    const llm: LLMProvider = {
      createChatCompletion: async (messages) => {
        calls.push({ messages });
        return 'Continue from the retained observation.';
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'local',
      isAvailable: () => true,
    };
    const state = createState();
    state.steps.push({
      thought: 'Inspect the entry point.',
      action: 'Read',
      action_input: { file_path: 'index.html' },
      observation: JSON.stringify({ success: true, output: 'entry point' }),
    });

    await reason(state, llm, { model: 'local:qwen3-local' }, createMockRegistry());
    state.steps.push({
      thought: 'Inspect the script.',
      action: 'Read',
      action_input: { file_path: 'script.js' },
      observation: JSON.stringify({ success: true, output: 'script evidence' }),
    });
    await reason(state, llm, { model: 'local:qwen3-local' }, createMockRegistry());

    expect(calls[1].messages.slice(2, 4)).toEqual(calls[0].messages.slice(2, 4));
    expect(calls[1].messages[4]).toEqual({
      role: 'assistant',
      content: '{"tool":"Read","arguments":{"file_path":"script.js"}}',
    });
    expect(calls[1].messages[4]?.content).not.toContain('Inspect the script.');
    expect(calls[1].messages[5]).toMatchObject({
      role: 'user',
      content: expect.stringContaining('Read 15 chars from script.js (content available in the bounded planner context)'),
    });
  });

  it('keeps a successful read in the next model prompt even when action history is compacted', async () => {
    const state = createState();
    state.steps = [{
      thought: 'Inspect the target file.',
      action: 'Read',
      action_input: { file_path: 'src/app.ts' },
      observation: JSON.stringify({ success: true, output: 'export const promptMemorySentinel = true;' }),
    }];
    const llm = createCapturingLlm('Use the retained file context.');

    await reason(state, llm, { model: 'mock' }, createMockRegistry());

    expect(llm.prompts.join('\n')).toContain('Retained file context');
    const prompt = llm.prompts.join('\n');
    expect(prompt).toContain('promptMemorySentinel');
    expect(prompt.match(/promptMemorySentinel/g)).toHaveLength(1);
    expect(prompt).toContain('content available in the bounded planner context');
    expect(prompt).toContain('do not reread covered ranges');
  });

  it('gives a continued agent the exact remaining plan and completed-work ledger', async () => {
    const state = createState();
    state.plan = [
      { step: 'Update src/app.ts', status: 'completed' },
      { step: 'Run the focused tests', status: 'in_progress' },
    ];
    state.continuationHandoff = {
      version: 1,
      parentRunId: 'parent-1',
      reason: 'max_steps',
      createdAt: 1,
      currentGoal: state.task,
      completedPlanItems: ['Update src/app.ts'],
      remainingPlanItems: ['Run the focused tests'],
      updatedFiles: ['src/app.ts'],
      verifiedChecks: [],
      remainingPlanItem: 'Run the focused tests',
      recentActions: [
        { action: 'Edit', target: 'src/app.ts', outcome: 'succeeded' },
        { action: 'Command', target: 'npm test', outcome: 'failed', failure: 'One focused assertion failed' },
      ],
      evidence: { parentStepCount: 2, childStepOffset: 2, actionSignatures: [], fileReadPaths: [] },
      quality: {
        sourcePromptTokens: 100,
        handoffPromptTokens: 20,
        promptReductionTokens: 80,
        promptReductionRatio: 0.8,
        repeatedParentActions: 0,
        staleParentFileReads: 0,
      },
    };
    const llm = createCapturingLlm('{"tool":"Bash","arguments":{"command":"npm test"}}');

    await planAction(state, 'Continue from the checkpoint.', llm, { model: 'mock' }, createMockRegistry());

    const prompt = llm.prompts.join('\n');
    expect(prompt).toContain('Execution checkpoint and remaining plan:');
    expect(prompt).toContain('1. [completed] Update src/app.ts');
    expect(prompt).toContain('2. [in_progress] Run the focused tests');
    expect(prompt).toContain('Files already updated: src/app.ts');
    expect(prompt).toContain('Recent parent actions (compact, newest execution tail):');
    expect(prompt).toContain('Edit: src/app.ts — succeeded');
    expect(prompt).toContain('Command: npm test — failed (One focused assertion failed)');
    expect(prompt).toContain('Do not repeat a completed item or prior mutation');
    expect(prompt).toContain('Read-only inspection may be repeated only when the compact handoff omitted evidence');
  });

  it('uses the compact handoff instead of replaying the parent transcript into continuation memory', async () => {
    const state = createState();
    state.plan = [
      { step: 'Inspect source', status: 'completed' },
      { step: 'Implement fix', status: 'in_progress' },
    ];
    state.steps = [
      {
        thought: 'parent read',
        action: 'Read',
        action_input: { file_path: 'src/parent.ts' },
        observation: '{"success":true,"output":"PARENT_TRANSCRIPT_SENTINEL"}',
      },
      {
        thought: 'parent edit',
        action: 'Edit',
        action_input: { file_path: 'src/parent.ts' },
        observation: '{"success":true,"output":"PARENT_MUTATION_SENTINEL"}',
      },
      {
        thought: 'child guard',
        action: 'ReplayGuard',
        action_input: { attempted_action: 'Edit' },
        observation: '{"success":false,"error":"Semantic inspection loop prevented: CHILD_REPLAY_GUARD_SENTINEL"}',
      },
    ];
    state.continuationCount = 1;
    state.continuationHandoff = {
      version: 1,
      parentRunId: 'parent-1',
      reason: 'max_steps',
      createdAt: 1,
      currentGoal: state.task,
      completedPlanItems: ['Inspect source'],
      remainingPlanItems: ['Implement fix'],
      updatedFiles: ['src/parent.ts'],
      verifiedChecks: [],
      remainingPlanItem: 'Implement fix',
      evidence: { parentStepCount: 2, childStepOffset: 2, actionSignatures: [], fileReadPaths: [] },
      quality: {
        sourcePromptTokens: 100,
        handoffPromptTokens: 20,
        promptReductionTokens: 80,
        promptReductionRatio: 0.8,
        repeatedParentActions: 0,
        staleParentFileReads: 0,
      },
    };
    const llm = createCapturingLlm('{"tool":"Write","arguments":{"file_path":"src/new.ts","content":"export const fixed = true;"}}');

    await planAction(state, 'Advance the continuation.', llm, { model: 'mock' }, createMockRegistry());

    const prompt = llm.prompts.join('\n');
    expect(prompt).toContain('Files already updated: src/parent.ts');
    expect(prompt).toContain('CHILD_REPLAY_GUARD_SENTINEL');
    expect(prompt).toContain('request a genuinely uncovered range');
    expect(prompt).not.toContain('PARENT_TRANSCRIPT_SENTINEL');
    expect(prompt).not.toContain('PARENT_MUTATION_SENTINEL');
  });

  it('bounds planner prompt categories while retaining active failures', async () => {
    const state = createState();
    state.task = `Implement the change.\n${'task detail '.repeat(10_000)}`;
    state.plan = [{ step: `Verify result ${'p'.repeat(10_000)}`, status: 'in_progress', kind: 'verify' }];
    state.steps = Array.from({ length: 50 }, (_value, index) => ({
      thought: `thought ${index} ${'x'.repeat(1_000)}`,
      action: index === 3 ? 'Edit' : 'Read',
      action_input: { file_path: `src/file-${index}.ts` },
      observation: index === 3
        ? JSON.stringify({ success: false, error: 'Pattern not found in src/file-3.ts' })
        : `ok ${'y'.repeat(2_000)}`,
    }));
    const llm = createCapturingLlm('{"tool":"Command","arguments":{"operation":"test"}}');

    await planAction(state, 'Inspect the failed edit.', llm, { model: 'mock' }, createMockRegistry());

    const prompt = llm.prompts.join('\n');
    expect(prompt.length).toBeLessThan(45_000);
    expect(prompt).toContain('[task compacted]');
    expect(prompt).toContain('Pattern not found in src/file-3.ts');
    expect(prompt).toContain('Permission constraints:');
    expect(prompt).toContain('Never echo a previous observation or file contents');
  });

  it('parses raw tool-selection JSON with base64 write content', async () => {
    const action = await planAction(
      createState(),
      'Write the app file using base64 content.',
      createMockLlm(
        '{"tool":"Write","arguments":{"file_path":"app.html","content_base64":"PGgxPk9LPC9oMT4="}}'
      ),
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({
      action: 'Write',
      action_input: {
        file_path: 'app.html',
        content_base64: 'PGgxPk9LPC9oMT4=',
      },
    });
  });

  it('retries a Write when its base64 payload is not valid UTF-8', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Write","arguments":{"file_path":"app.html","content_base64":"wyg="}}',
      '{"tool":"Write","arguments":{"file_path":"app.html","content":"<h1>OK</h1>"}}',
    ]);

    const action = await planAction(
      createState(),
      'Write the app file.',
      llm,
      { model: 'mock' },
      createMockRegistry()
    );

    expect(llm.calls).toBe(2);
    expect(action).toEqual({
      action: 'Write',
      action_input: {
        file_path: 'app.html',
        content: '<h1>OK</h1>',
      },
    });
  });

  it('parses direct tool_calls from serialized assistant envelopes', async () => {
    const action = await planAction(
      createState(),
      'Write the app file.',
      createMockLlm(
        '{"role":"assistant","reasoning":"Use Write next.","tool_calls":[{"name":"Write","arguments":{"file_path":"app.html","content":"<h1>OK</h1>"}}]}'
      ),
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({
      action: 'Write',
      action_input: {
        file_path: 'app.html',
        content: '<h1>OK</h1>',
      },
    });
  });

  it('parses OpenAI-style function tool_calls from serialized assistant envelopes', async () => {
    const action = await planAction(
      createState(),
      'Write the app file.',
      createMockLlm(
        '{"role":"assistant","reasoning":"Use Write next.","tool_calls":[{"id":"call_1","type":"function","function":{"name":"Write","arguments":"{\\"file_path\\":\\"app.html\\",\\"content\\":\\"<h1>OK</h1>\\"}"}}]}'
      ),
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({
      action: 'Write',
      action_input: {
        file_path: 'app.html',
        content: '<h1>OK</h1>',
      },
    });
  });

  it('parses XML-style tool calls emitted by smaller OpenRouter models', async () => {
    const action = await planAction(
      createState(),
      'Read the app file.',
      createMockLlm(String.raw`<tool_call>Read <arg_key>file_path</arg_key> <arg_value>C:\MPC Project Test\pacman 2\index.html</arg_value> </tool_call>`),
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({
      action: 'Read',
      action_input: {
        file_path: String.raw`C:\MPC Project Test\pacman 2\index.html`,
      },
    });
  });

  it('retries with a smaller tool selection when the first response is truncated JSON', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Write","arguments":{"file_path":"app.html","content_base64":"PGgx',
      '{"tool":"Write","arguments":{"file_path":"app.html","content":"<h1>OK</h1>","append":false}}',
    ]);

    const action = await planAction(
      createState(),
      'Write the app file.',
      llm,
      { model: 'mock' },
      createMockRegistry()
    );

    expect(llm.calls).toBe(2);
    expect(action).toEqual({
      action: 'Write',
      action_input: {
        file_path: 'app.html',
        content: '<h1>OK</h1>',
        append: false,
      },
    });
  });

  it('retries with base64 when a large Write selection has malformed content JSON', async () => {
    const llm = createSequentialLlm([
      '{\n  "tool": "Write",\n  "arguments": {\n    "file_path": "app.html",\n    "content": "px;\\n  box-shadow: var(--shadow);\\n',
      '{"tool":"Write","arguments":{"file_path":"app.html","content_base64":"PGgxPk9LPC9oMT4=","append":false}}',
    ]);

    const action = await planAction(
      createState(),
      'Write the app file.',
      llm,
      { model: 'mock' },
      createMockRegistry()
    );

    expect(llm.calls).toBe(2);
    expect(action).toEqual({
      action: 'Write',
      action_input: {
        file_path: 'app.html',
        content_base64: 'PGgxPk9LPC9oMT4=',
        append: false,
      },
    });
  });

  it('retries when generated Tailwind config is returned as a bare JavaScript object', async () => {
    const llm = createSequentialLlm([
      `{
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'sans-serif'],
      },
      colors: {
        ink: '#101828',
      },
    },
  },
}`,
      '{"tool":"Write","arguments":{"file_path":"index.html","content_base64":"PCFET0NUWVBFIGh0bWw+","append":false}}',
    ]);

    const action = await planAction(
      createState(),
      'Create the portfolio app entry point.',
      llm,
      { model: 'mock' },
      createMockRegistry(),
    );

    expect(llm.calls).toBe(2);
    expect(action).toEqual({
      action: 'Write',
      action_input: {
        file_path: 'index.html',
        content_base64: 'PCFET0NUWVBFIGh0bWw+',
        append: false,
      },
    });
  });

  it('retries when a CSS declaration block is returned instead of a tool selection', async () => {
    const llm = createSequentialLlm([
      '{ background: #000; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }',
      '{"tool":"Write","arguments":{"file_path":"index.html","content_base64":"PCFET0NUWVBFIGh0bWw+","append":false}}',
    ]);

    const action = await planAction(
      createState(),
      'Create the standalone app entry point.',
      llm,
      { model: 'mock' },
      createMockRegistry(),
    );

    expect(llm.calls).toBe(2);
    expect(action).toEqual({
      action: 'Write',
      action_input: {
        file_path: 'index.html',
        content_base64: 'PCFET0NUWVBFIGh0bWw+',
        append: false,
      },
    });
  });

  it('uses the Write recovery prompt when CSS is returned during a corrective selection', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Read","arguments":{"file_path":"index.html"}}',
      '{ box-sizing: border-box; margin: 0; padding: 0; }',
      '{"tool":"Write","arguments":{"file_path":"index.html","content_base64":"PCFET0NUWVBFIGh0bWw+","append":false}}',
    ]);
    const state = createState();
    state.codingState = 'implement';
    state.forceMutationNextAction = true;
    state.noProgressCount = 4;

    const action = await planAction(
      state,
      'Recover the implementation.',
      llm,
      { model: 'mock' },
      createMockRegistry(),
    );

    expect(llm.calls).toBe(3);
    expect(action).toEqual({
      action: 'Write',
      action_input: {
        file_path: 'index.html',
        content_base64: 'PCFET0NUWVBFIGh0bWw+',
        append: false,
      },
    });
  });

  it('turns repeated CSS corrective responses into a resumable mutation blocker', async () => {
    const cssResponse = '{ box-sizing: border-box; margin: 0; padding: 0; }';
    const llm = createSequentialLlm([
      '{"tool":"Read","arguments":{"file_path":"index.html"}}',
      cssResponse,
      cssResponse,
    ]);
    const state = createState();
    state.codingState = 'implement';
    state.forceMutationNextAction = true;
    state.noProgressCount = 4;

    await expect(
      planAction(state, 'Recover the implementation.', llm, { model: 'mock' }, createMockRegistry()),
    ).rejects.toThrow('The model could not produce a valid Write or Edit action');
    expect(llm.calls).toBe(3);
  });

  it('retries with Write recovery when CSS declaration block with comments is returned', async () => {
    const userCss = `{\n    /* Default biome: Normal Plains (Day) */\n    --sky-color: #87ceeb;\n    --sky-color-2: #b0e0e6;\n    --ground-color: #7ec850;\n    --ground-color-2: #5fa83a;\n\n    --title-color: #2c3e50;\n}`;
    const llm = createSequentialCapturingLlm([
      userCss,
      '{"tool":"Write","arguments":{"file_path":"styles.css","content_base64":"LS1za3ktY29sb3I6ICM4N2NlZWI7","append":false}}',
    ]);

    const action = await planAction(
      createState(),
      'Add the biome styles to styles.css',
      llm,
      { model: 'mock' },
      createMockRegistry(),
    );

    expect(llm.calls).toBe(2);
    expect(llm.prompts[1]).toContain('content_base64');
    expect(action).toEqual({
      action: 'Write',
      action_input: {
        file_path: 'styles.css',
        content_base64: 'LS1za3ktY29sb3I6ICM4N2NlZWI7',
        append: false,
      },
    });
  });

  it('parses tool selection JSON containing comments', async () => {
    const jsonWithComments = `{\n  /* Write the biome styles */\n  "tool": "Write",\n  // target styles file\n  "arguments": {\n    "file_path": "styles.css",\n    "content": "body { margin: 0; }"\n  }\n}`;
    const llm = createMockLlm(jsonWithComments);

    const action = await planAction(
      createState(),
      'Add the biome styles',
      llm,
      { model: 'mock' },
      createMockRegistry(),
    );

    expect(action).toEqual({
      action: 'Write',
      action_input: {
        file_path: 'styles.css',
        content: 'body { margin: 0; }',
      },
    });
  });

  it('prefers embedded tool selection over preceding CSS block with comments', () => {
    const text = `I will add the biome styles:\n\`\`\`css\n:root {\n  /* Default biome */\n  --sky-color: #87ceeb;\n}\n\`\`\`\n\n{"tool":"Write","arguments":{"file_path":"styles.css","content":"body { margin: 0; }"}}`;
    expect(extractJsonFromText(text)).toBe('{"tool":"Write","arguments":{"file_path":"styles.css","content":"body { margin: 0; }"}}');
  });

  it('repairs numeric Tailwind color keys in a bare JavaScript object', async () => {
    const llm = createSequentialLlm([
      `{
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          500: '#3366ff',
          950: '#07112d',
        },
      },
    },
  },
}`,
      '{"tool":"Write","arguments":{"file_path":"index.html","content_base64":"PCFET0NUWVBFIGh0bWw+","append":false}}',
    ]);

    const action = await planAction(
      createState(),
      'Create the portfolio app entry point.',
      llm,
      { model: 'mock' },
      createMockRegistry(),
    );

    expect(llm.calls).toBe(2);
    expect(action).toEqual({
      action: 'Write',
      action_input: {
        file_path: 'index.html',
        content_base64: 'PCFET0NUWVBFIGh0bWw+',
        append: false,
      },
    });
  });

  it('retries with base64 when malformed Write JSON has an expected-comma parse error', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Write","arguments":{"file_path":"creative-gpt55html.html","append":false,"content":"<!DOCTYPE html>\\n<html lang=\\"en\\">" "background":"twilight"}}',
      '{"tool":"Write","arguments":{"file_path":"creative-gpt55html.html","content_base64":"PCFET0NUWVBFIGh0bWw+","append":false}}',
    ]);

    const action = await planAction(
      createState(),
      'Create the standalone paint studio HTML file.',
      llm,
      { model: 'mock' },
      createMockRegistry()
    );

    expect(llm.calls).toBe(2);
    expect(action).toEqual({
      action: 'Write',
      action_input: {
        file_path: 'creative-gpt55html.html',
        content_base64: 'PCFET0NUWVBFIGh0bWw+',
        append: false,
      },
    });
  });

  it('recovers from the IEPW1N-style unterminated absolute Write response', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Write","arguments":{"file_path":"C:\\\\MPC Project Test\\\\creative-gpt55html.html","content":"<!DOCTYPE html>\\n<html lang=\\"en\\">\\n<head>\\n<meta charset=\\"UTF-8\\">\\n<title>Paint Studio & Vector Canvas</title>\\n<style>\\n:root { --bg: #151225; --panel: rgba(255,255,255,.08); }\\n.canvas-wrap { box-shadow: 0 24px 80px rgba(0,0,0,.35); }\\n',
      '{"tool":"Write","arguments":{"file_path":"creative-gpt55html.html","content_base64":"PCFET0NUWVBFIGh0bWw+","append":false}}',
    ]);
    const state = {
      ...createState(),
      task: 'Create a gorgeous standalone Paint Studio & Vector Canvas app at "creative-gpt55html.html" in the target workspace.',
      workspace: 'C:\\MPC Project Test',
      steps: [
        {
          thought: 'Inspect the workspace first.',
          action: 'Bash',
          action_input: { command: 'cmd /c dir', cwd: 'C:\\MPC Project Test' },
          observation: 'ok',
        },
      ],
    };

    const action = await planAction(
      state,
      'Create the standalone paint studio HTML file.',
      llm,
      { model: 'mock' },
      createMockRegistry()
    );

    expect(llm.calls).toBe(2);
    expect(action).toEqual({
      action: 'Write',
      action_input: {
        file_path: 'creative-gpt55html.html',
        content_base64: 'PCFET0NUWVBFIGh0bWw+',
        append: false,
      },
    });
  });

  it('repairs a Z13H6K-style Read selection missing the final object brace', async () => {
    const action = await planAction(
      createState(),
      'Inspect the player tank entity.',
      createMockLlm(
        '{"tool":"Read","arguments":{"file_path":"C:\\\\MPC Project Test\\\\tank\\\\src\\\\entities\\\\PlayerTank.ts"}'
      ),
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({
      action: 'Read',
      action_input: {
        file_path: 'C:\\MPC Project Test\\tank\\src\\entities\\PlayerTank.ts',
      },
    });
  });

  it('repairs unescaped Windows paths containing a JSON unicode escape prefix', async () => {
    const action = await planAction(
      createState(),
      'Inspect the generated UI module.',
      createMockLlm(
        '{"tool":"Read","arguments":{"file_path":"C:\\MPC Project Test\\Pacman\\js\\ui.js"}}'
      ),
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({
      action: 'Read',
      action_input: {
        file_path: 'C:\\MPC Project Test\\Pacman\\js\\ui.js',
      },
    });
  });

  it('preserves JSON-significant backslashes in unescaped Windows paths', async () => {
    const state = createState();
    state.workspace = 'C:\\MPC Project Test\\test 3';
    state.config.workspace = state.workspace;
    const llm = createMockLlm(
      '{"tool":"Read","arguments":{"file_path":"C:\\MPC Project Test\\test 3\\nstyle.css"}}'
    );

    const action = await planAction(
      state,
      'Inspect the stylesheet.',
      llm,
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({
      action: 'Read',
      action_input: {
        file_path: 'C:\\MPC Project Test\\test 3\\nstyle.css',
      },
    });
  });

  it('repairs a 4NQAHM-style Read selection with a quoted numeric limit terminator', async () => {
    const action = await planAction(
      createState(),
      'Read the generated tank index file.',
      createMockLlm(
        '{"tool":"Read","arguments":{"file_path":"C:\\\\MPC Project Test\\\\tank\\\\index.html","offset":1,"limit":1000"}}'
      ),
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({
      action: 'Read',
      action_input: {
        file_path: 'C:\\MPC Project Test\\tank\\index.html',
        offset: 1,
        limit: 1000,
      },
    });
  });

  it('aliases hallucinated repo_browser.open_file to Read', async () => {
    const action = await planAction(
      createState(),
      'Inspect the main file.',
      createMockLlm('{"tool":"repo_browser.open_file","arguments":{"path":"tank/src/main.js"}}'),
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({
      action: 'Read',
      action_input: {
        path: 'tank/src/main.js',
        file_path: 'tank/src/main.js',
      },
    });
  });

  it('aliases generic run_command selections to the native Bash tool', async () => {
    const action = await planAction(
      createState(),
      'Run the project check.',
      createMockLlm('{"tool":"run_command","arguments":{"command":"npm test"}}'),
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({
      action: 'Bash',
      action_input: { command: 'npm test' },
    });
  });

  it('aliases tool_bash selections to the native Bash tool', async () => {
    const action = await planAction(
      createState(),
      'Run the project check.',
      createMockLlm('{"tool":"tool_bash","arguments":{"cmd":"npm test"}}'),
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({
      action: 'Bash',
      action_input: { cmd: 'npm test', command: 'npm test' },
    });
  });

  it('aliases repo_browser.read to Read', async () => {
    const action = await planAction(
      createState(),
      'Inspect the main file.',
      createMockLlm('{"tool":"repo_browser.read","arguments":{"path":"src/main.ts"}}'),
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({
      action: 'Read',
      action_input: { path: 'src/main.ts', file_path: 'src/main.ts' },
    });
  });

  it('aliases repo_browser.search to Grep and maps query to pattern', async () => {
    const action = await planAction(
      createState(),
      'Search the source files.',
      createMockLlm('{"tool":"repo_browser.search","arguments":{"query":"requestAnimationFrame","path":"src"}}'),
      { model: 'mock' },
      createRegistryWithGrep()
    );

    expect(action).toEqual({
      action: 'Grep',
      action_input: { query: 'requestAnimationFrame', path: 'src', pattern: 'requestAnimationFrame' },
    });
  });

  it('aliases hallucinated repo_browser.print_tree to a safe tree listing', async () => {
    const action = await planAction(
      createState(),
      'Inspect the tree.',
      createMockLlm('{"tool":"repo_browser.print_tree","arguments":{"path":"tank"}}'),
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({
      action: 'Bash',
      action_input: {
        command: process.platform === 'win32' ? 'cmd /c dir /b /s' : 'find . -maxdepth 3 -type f',
        cwd: 'tank',
        timeout: 30000,
      },
    });
  });

  it('aliases hallucinated repo_browser.glob to Glob', async () => {
    const action = await planAction(
      createState(),
      'Inspect project files.',
      createMockLlm('{"tool":"repo_browser.glob","arguments":{"path":"js"}}'),
      { model: 'mock' },
      createRegistryWithGlob()
    );

    expect(action).toEqual({
      action: 'Glob',
      action_input: {
        path: 'js',
        pattern: 'js/**/*',
      },
    });
  });

  it('treats a bare file_path object as a safe Read action', async () => {
    const action = await planAction(
      createState(),
      'Read the todo file.',
      createMockLlm('{"file_path":"C:\\\\MPC Project Test\\\\Pacman\\\\TODO.md"}'),
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({
      action: 'Read',
      action_input: {
        file_path: 'C:\\MPC Project Test\\Pacman\\TODO.md',
      },
    });
  });

  it('uses a different safe fallback when the target file was already read successfully', async () => {
    const state = createState();
    state.steps = [{
      thought: 'Inspect the tracker.',
      action: 'Read',
      action_input: { file_path: 'TODO.md' },
      observation: JSON.stringify({ success: true, output: '- [ ] Feature' }),
    }];
    const quote = String.fromCharCode(34);
    const malformed = JSON.stringify({
      tool: 'Bash',
      arguments: { command: 'echo ok', cwd: '.', timeout: 30000 },
    }).replace('echo ok', `echo ${quote}broken`);

    const action = await planAction(
      state,
      'Inspect repository state.',
      createMockLlm(malformed),
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({
      action: 'Bash',
      action_input: {
        command: process.platform === 'win32' ? 'cmd /c dir' : 'ls -la',
        cwd: state.workspace,
        timeout: 30000,
      },
    });
  });

  it('repairs a UM9JY9-style malformed bare file_path key as Read', async () => {
    const action = await planAction(
      createState(),
      'Read the todo file.',
      createMockLlm('{"file_path: C:\\\\MPC Project":"C:\\\\MPC Project Test\\\\Pacman\\\\TODO.md"}'),
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({
      action: 'Read',
      action_input: {
        'file_path: C:\\MPC Project': 'C:\\MPC Project Test\\Pacman\\TODO.md',
        file_path: 'C:\\MPC Project Test\\Pacman\\TODO.md',
      },
    });
  });

  it('falls back to reading the target file when malformed Write correction is truncated', async () => {
    const llm = createSequentialLlm([
      '{\n  "tool": "Write",\n  "arguments": {\n    "file_path": "app.html",\n    "content": "px;\\n  box-shadow: var(--shadow);\\n',
      '{"tool":"Write","arguments":{"file_path":"app.html","content_base64":"PGh0bWw+CiAgPGhlYWQ+',
    ]);
    const state = {
      ...createState(),
      steps: [
        {
          thought: 'Start file.',
          action: 'Write',
          action_input: { file_path: 'app.html', content: '<!doctype html>' },
          observation: 'ok',
        },
      ],
    };

    const action = await planAction(
      state,
      'Write the app file.',
      llm,
      { model: 'mock' },
      createMockRegistry()
    );

    expect(llm.calls).toBe(2);
    expect(action).toEqual({
      action: 'Read',
      action_input: {
        file_path: 'app.html',
      },
    });
  });

  it('falls back to reading the task entry point when malformed Write correction is also invalid JSON', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Write","arguments":{"file_path":"creative-gpt55.html","content":"<!DOCTYPE html>\\n<html>\\n<style>\\n.card{color:red;}\\n',
      '{"tool":"Write","arguments":{"file_path":"creative-gpt55.html","content":"<!DOCTYPE html>\\n<html>\\n<head>\\n<meta charset=\\"utf-8\\">\\n<title>Paint Studio & Vector Canvas</title>\\n<style>\\n',
    ]);
    const state = {
      ...createState(),
      task: 'Repair the generated app "Paint Studio & Vector Canvas". Entry point: creative-gpt55.html',
    };

    const action = await planAction(
      state,
      'Replace the app file with a complete standalone HTML implementation.',
      llm,
      { model: 'mock' },
      createMockRegistry()
    );

    expect(llm.calls).toBe(2);
    expect(action).toEqual({
      action: 'Read',
      action_input: {
        file_path: 'creative-gpt55.html',
      },
    });
  });

  it('retries when tool selection is an assistant envelope with empty tool_calls', async () => {
    const llm = createSequentialLlm([
      '{"role":"assistant","reasoning":"Use Write next.","tool_calls":[]}',
      '{"tool":"Write","arguments":{"file_path":"app.html","content":"<h1>OK</h1>"}}',
    ]);

    const action = await planAction(
      createState(),
      'Write the app file.',
      llm,
      { model: 'mock' },
      createMockRegistry()
    );

    expect(llm.calls).toBe(2);
    expect(action).toEqual({
      action: 'Write',
      action_input: {
        file_path: 'app.html',
        content: '<h1>OK</h1>',
      },
    });
  });

  it('keeps retrying when the first corrective response is still an assistant envelope', async () => {
    const llm = createSequentialLlm([
      '{"role":"assistant","reasoning":"Use Write next.","tool_calls":[]}',
      '{"role":"assistant","reasoning":"Still thinking about Write.","tool_calls":[]}',
      '{"tool":"Write","arguments":{"file_path":"app.html","content":"<h1>OK</h1>"}}',
    ]);

    const action = await planAction(
      createState(),
      'Write the app file.',
      llm,
      { model: 'mock' },
      createMockRegistry()
    );

    expect(llm.calls).toBe(3);
    expect(action).toEqual({
      action: 'Write',
      action_input: {
        file_path: 'app.html',
        content: '<h1>OK</h1>',
      },
    });
  });

  it('recovers when the planner echoes package metadata instead of selecting a tool', async () => {
    const llm = createSequentialLlm([
      '{"name":"pacman-game","version":"1.0.0","description":"A Pac-Man game","main":"dist/index.js","scripts":{"build":"tsc"},"devDependencies":{"typescript":"^5.0.0"},"keywords":["pacman"],"license":"MIT"}',
      '{"tool":"Read","arguments":{"file_path":"src/games/pacman/PacManGame.ts"}}',
    ]);
    const audits: Array<{ errors: string[]; model?: string; attempt?: number; parsedKeys?: string[]; recoveryOutcome?: string }> = [];

    const action = await planAction(
      createState(),
      'Continue working on the Pacman game.',
      llm,
      { model: 'mock', onMalformedProviderResponse: (audit) => { audits.push(audit); } },
      createMockRegistry()
    );

    expect(llm.calls).toBe(2);
    expect(action).toEqual({
      action: 'Read',
      action_input: { file_path: 'src/games/pacman/PacManGame.ts' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].errors[0]).toContain('does not select a tool');
    expect(audits[0]).toMatchObject({
      model: 'mock',
      attempt: 1,
      parsedKeys: ['name', 'version', 'description', 'main', 'scripts', 'devDependencies', 'keywords', 'license'],
      recoveryOutcome: 'correcting',
    });
  });

  it('bounds repeated observation-shaped responses and uses the safe fallback', async () => {
    const packageMetadata = '{"name":"pacman-game","version":"1.0.0"}';
    const llm = createSequentialLlm([packageMetadata, packageMetadata, packageMetadata]);
    const state = {
      ...createState(),
      steps: [{
        thought: 'Create the game entry point.',
        action: 'Write',
        action_input: { file_path: 'src/games/pacman/PacManGame.ts', content: 'export {};' },
        observation: JSON.stringify({ success: true }),
      }],
    };
    const audits: Array<{ attempt?: number; recoveryOutcome?: string }> = [];

    const action = await planAction(
      state,
      'Continue working on the Pacman game.',
      llm,
      { model: 'mock', onMalformedProviderResponse: (audit) => { audits.push(audit); } },
      createMockRegistry()
    );

    expect(llm.calls).toBe(3);
    expect(action).toEqual({
      action: 'Read',
      action_input: { file_path: 'src/games/pacman/PacManGame.ts' },
    });
    expect(audits).toEqual([
      expect.objectContaining({ attempt: 1, recoveryOutcome: 'correcting' }),
      expect.objectContaining({ attempt: 2, recoveryOutcome: 'correcting' }),
      expect.objectContaining({ attempt: 2, recoveryOutcome: 'fallback' }),
    ]);
  });

  it('prefers an embedded tool selection over a preceding JSON observation', () => {
    expect(extractJsonFromText(
      'Observation: {"name":"pacman-game","version":"1.0.0"}\nNext: {"tool":"Read","arguments":{"file_path":"package.json"}}'
    )).toBe('{"tool":"Read","arguments":{"file_path":"package.json"}}');
  });

  it('extracts an embedded action from assistant envelope reasoning', async () => {
    const action = await planAction(
      createState(),
      'Write the app file.',
      createMockLlm(
        '{"role":"assistant","reasoning":"Action: Write\\nAction Input: {\\"file_path\\":\\"app.html\\",\\"content\\":\\"<h1>OK</h1>\\"}","tool_calls":[]}'
      ),
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({
      action: 'Write',
      action_input: {
        file_path: 'app.html',
        content: '<h1>OK</h1>',
      },
    });
  });

  it('falls back to reading the target file when repeated assistant envelopes contain no action', async () => {
    const llm = createSequentialLlm([
      '{"role":"assistant","reasoning":"I should continue the implementation.","tool_calls":[]}',
      '{"role":"assistant","reasoning":"Still considering the next implementation chunk.","tool_calls":[]}',
      '{"role":"assistant","reasoning":"Need to inspect the current file before continuing.","tool_calls":[]}',
    ]);
    const state = {
      ...createState(),
      steps: [
        {
          thought: 'Start file.',
          action: 'Write',
          action_input: { file_path: 'app.html', content: '<!doctype html>' },
          observation: 'ok',
        },
      ],
    };

    const action = await planAction(
      state,
      'Continue building the app file.',
      llm,
      { model: 'mock' },
      createMockRegistry()
    );

    expect(llm.calls).toBe(3);
    expect(action).toEqual({
      action: 'Read',
      action_input: {
        file_path: 'app.html',
      },
    });
  });

  it('rejects assistant message envelopes as invalid tool selections instead of executing undefined', async () => {
    await expect(
      planAction(
        createState(),
        'Write the app file.',
        createMockLlm('{"role":"assistant","reasoning":"Use Write next.","tool_calls":[]}'),
        { model: 'mock' },
        createWriteOnlyRegistry()
      )
    ).rejects.toThrow('Missing tool name');
  });

  it('throws a helpful error when tool selection contains no JSON object', async () => {
    const audits: Array<{ provider: string; rawRedacted: string; errors: string[] }> = [];
    await expect(
      planAction(
        createState(),
        'Write the app file.',
        createMockLlm('I should probably write the file next.'),
        {
          model: 'mock',
          onMalformedProviderResponse: (audit) => {
            audits.push(audit);
          },
        },
        createMockRegistry()
      )
    ).rejects.toThrow('Could not parse tool selection');
    expect(audits).toHaveLength(1);
    expect(audits[0].provider).toBe('unknown');
    expect(audits[0].rawRedacted).toContain('I should probably write');
    expect(audits[0].errors[0]).toContain('Could not parse tool selection');
  });

  it('retries when the model returns prose instead of a tool selection', async () => {
    const llm = createSequentialLlm([
      'The dependency install needs approval, so I should explain that to the user.',
      '{"tool":"Read","arguments":{"file_path":"package.json"}}',
    ]);

    const action = await planAction(
      createState(),
      'Continue from the latest observation.',
      llm,
      { model: 'mock' },
      createMockRegistry()
    );

    expect(llm.calls).toBe(2);
    expect(action).toEqual({
      action: 'Read',
      action_input: { file_path: 'package.json' },
    });
  });

  it('preserves a concise model rationale alongside the normalized action', async () => {
    const action = await planAction(
      createState(),
      'Inspect the entry point before editing.',
      createMockLlm('{"tool":"Read","arguments":{"file_path":"src/index.ts"},"rationale":"I need to inspect application initialization before changing it."}'),
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({
      action: 'Read',
      action_input: { file_path: 'src/index.ts' },
      rationale: 'I need to inspect application initialization before changing it.',
    });
  });

  it('retries malformed Bash JSON and accepts the next valid Windows command selection', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Bash","arguments":{"command":"set -e; if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo \\\"GIT_INSIDE=1\\\""',
      '{"tool":"Bash","arguments":{"command":"npm.cmd test","cwd":"."}}',
    ]);
    const action = await planAction(createState(), 'Inspect the Windows project and run its tests.', llm, { model: 'mock' }, createMockRegistry());
    expect(action).toEqual({ action: 'Bash', action_input: { command: 'npm.cmd test', cwd: '.' } });
    expect(llm.calls).toBe(2);
  });

  it('yields a stale verification plan after an inline Node quoting failure and guides recovery', async () => {
    const state = createState();
    state.codingState = 'verify';
    state.plan = [{ step: 'Verify the app', status: 'in_progress', kind: 'verify' }];
    state.steps = [{
      thought: 'Run an inline check.',
      action: 'Bash',
      action_input: { command: 'node -e "const fs=require(\\\'fs\\\')"' },
      observation: JSON.stringify({
        success: false,
        error: '[eval]:1\n"const\n^^^^^^\nUnterminated string constant\nSyntaxError: Invalid or unexpected token',
      }),
    }];
    const llm = createCapturingLlm('{"tool":"Read","arguments":{"file_path":"index.html"}}');

    const action = await planAction(state, 'Recover from the failed check.', llm, { model: 'mock' }, createMockRegistry());

    expect(action).toMatchObject({ action: 'Read', action_input: { file_path: 'index.html' } });
    expect(llm.prompts[0]).toContain('HARD COMMAND RECOVERY');
    expect(llm.prompts[0]).toContain('Do not repeat Bash/node -e or create a verifier file');
    expect(llm.prompts[0]).not.toContain('Current goal: You are in verification state.');
  });

  it('does not resume a verification-only plan after an out-of-scope verifier write', async () => {
    const state = createState();
    state.codingState = 'verify';
    state.plan = [{ step: 'Verify the app', status: 'in_progress', kind: 'verify' }];
    state.steps = [{
      thought: 'Create a custom verifier.',
      action: 'Write',
      action_input: { file_path: 'verify.js', content: 'console.log("check")' },
      observation: JSON.stringify({
        success: false,
        error: 'Mutation rejected: verify.js is not a declared task output and is not in affected files.',
      }),
    }];
    const llm = createCapturingLlm('{"tool":"Read","arguments":{"file_path":"index.html"}}');

    const action = await planAction(state, 'Recover from the rejected helper write.', llm, { model: 'mock' }, createMockRegistry());

    expect(action).toMatchObject({ action: 'Read', action_input: { file_path: 'index.html' } });
    expect(llm.prompts[0]).toContain('HARD SCOPE RECOVERY');
    expect(llm.prompts[0]).toContain('Do not read or write that helper');
    expect(llm.prompts[0]).not.toContain('Current goal: You are in verification state.');
  });

  it('rejects an empty Bash tool call before dispatch and requests corrected arguments', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Bash","arguments":{}}',
      '{"tool":"Read","arguments":{"file_path":"index.html"}}',
    ]);

    const action = await planAction(createState(), 'Inspect index.html.', llm, { model: 'mock' }, createMockRegistry());

    expect(action).toEqual({ action: 'Read', action_input: { file_path: 'index.html' } });
    expect(llm.calls).toBe(2);
  });

  it('normalizes flattened Bash arguments from provider tool envelopes', async () => {
    const action = await planAction(
      createState(),
      'Inspect the project.',
      createMockLlm('{"tool":"Bash","command":"cmd /c dir"}'),
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({ action: 'Bash', action_input: { command: 'cmd /c dir' } });
  });

  it('accepts a flattened Command envelope during corrective selection', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Command","arguments":{}}',
      '{"tool":"Command","operation":"list_directory","args":["."]}',
    ]);

    const action = await planAction(createState(), 'Inspect the project.', llm, { model: 'mock' }, createMockRegistry());

    expect(action).toEqual({
      action: 'Command',
      action_input: { operation: 'list_directory', args: ['.'] },
    });
    expect(llm.calls).toBe(2);
  });

  it('rejects an unsupported Command operation before dispatch', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Command","arguments":{"operation":"run_dev_server"}}',
      '{"tool":"Command","arguments":{"operation":"list_directory","args":["."]}}',
    ]);

    const action = await planAction(createState(), 'Inspect the project.', llm, { model: 'mock' }, createMockRegistry());

    expect(action).toEqual({
      action: 'Command',
      action_input: { operation: 'list_directory', args: ['.'] },
    });
    expect(llm.calls).toBe(2);
  });

  it('repairs JavaScript-style object literals returned during corrective selection', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Command","arguments":{}}',
      "{\n darkMode: 'class',\n }",
      '{"tool":"Command","operation":"list_directory","args":["."]}',
    ]);

    const action = await planAction(createState(), 'Inspect the project.', llm, { model: 'mock' }, createMockRegistry());

    expect(action).toEqual({
      action: 'Command',
      action_input: { operation: 'list_directory', args: ['.'] },
    });
    expect(llm.calls).toBe(3);
  });

  it('normalizes bare Command arguments when the provider omits the tool envelope', async () => {
    const action = await planAction(
      createState(),
      'Inspect the project.',
      createMockLlm('{"operation":"list_directory","args":["."],"cwd":".","timeout":30000}'),
      { model: 'mock' },
      createMockRegistry()
    );

    expect(action).toEqual({
      action: 'Command',
      action_input: {
        operation: 'list_directory',
        args: ['.'],
        cwd: '.',
        timeout: 30000,
      },
    });
  });

  it('normalizes a bare wildcard pattern as Glob when the provider omits the tool envelope', async () => {
    const action = await planAction(
      createState(),
      'List project files.',
      createMockLlm('{"pattern":"**/*.*"}'),
      { model: 'mock' },
      createRegistryWithGlob()
    );

    expect(action).toEqual({
      action: 'Glob',
      action_input: { pattern: '**/*.*' },
    });
  });

  it('retries an ambiguous plain pattern instead of guessing a tool', async () => {
    const llm = createSequentialLlm([
      '{"pattern":"PacManGame"}',
      '{"tool":"Read","arguments":{"file_path":"src/games/pacman/PacManGame.ts"}}',
    ]);

    const action = await planAction(
      createState(),
      'Inspect the Pacman game.',
      llm,
      { model: 'mock' },
      createMockRegistry()
    );

    expect(llm.calls).toBe(2);
    expect(action).toEqual({
      action: 'Read',
      action_input: { file_path: 'src/games/pacman/PacManGame.ts' },
    });
  });

  it('retries mixed bare arguments that could identify multiple tools', async () => {
    const llm = createSequentialLlm([
      '{"command":"cmd /c dir","file_path":"README.md"}',
      '{"tool":"Bash","arguments":{"command":"cmd /c dir"}}',
    ]);

    const action = await planAction(
      createState(),
      'Inspect the project.',
      llm,
      { model: 'mock' },
      createMockRegistry()
    );

    expect(llm.calls).toBe(2);
    expect(action).toEqual({ action: 'Bash', action_input: { command: 'cmd /c dir' } });
  });

  it('forces Write after one authoritative discovery proves a create workspace is empty', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Glob","arguments":{"pattern":"**/*"}}',
      '{"tool":"Write","arguments":{"file_path":"index.html","content":"<h1>Game</h1>"}}',
    ]);
    const state = createState();
    state.taskAnalysis = {
      taskKind: 'new_feature',
      expectedChangeIntent: 'create',
      affectedFiles: [],
      requiredInspections: ['Inspect the workspace root'],
      verificationPlan: ['Run the production build'],
    } as any;
    state.codingState = 'implement';
    state.noProgressCount = 1;
    state.steps = [1].map((index) => ({
      thought: `inspect ${index}`,
      action: 'Command',
      action_input: { operation: 'list_directory', args: ['.'] },
      observation: '{"success":true,"output":""}',
    }));

    const action = await planAction(state, 'Continue the empty-workspace create task.', llm, { model: 'mock' }, createRegistryWithGlob());

    expect(action).toEqual({
      action: 'Write',
      action_input: { file_path: 'index.html', content: '<h1>Game</h1>' },
    });
    expect(llm.calls).toBe(2);
  });

  it('rejects repeated inspection and requires a mutation after four no-progress actions', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Command","arguments":{"operation":"list_directory","args":["."]}}',
      '{"tool":"Write","arguments":{"file_path":"src/game.ts","content":"export const game = true;"}}',
    ]);
    const state = createState();
    state.codingState = 'implement';
    state.noProgressCount = 4;

    const action = await planAction(state, 'Implement the requested feature.', llm, { model: 'mock' }, createMockRegistry());

    expect(action).toEqual({
      action: 'Write',
      action_input: { file_path: 'src/game.ts', content: 'export const game = true;' },
    });
    expect(llm.calls).toBe(2);
  });

  it('explains a failed Read and directs the model to create a missing scoped target', async () => {
    const state = createState();
    state.taskAnalysis = {
      taskKind: 'docs_only',
      workspace: process.cwd(),
      expectedChangeIntent: 'modify',
      affectedFiles: [{ path: 'README.md', intent: 'modify', reason: 'Update project documentation.', mustReadBeforeEdit: true }],
      requiredInspections: [],
      verificationPlan: [],
      validationRequirements: [],
      riskFactors: [],
    } as any;
    state.steps = [{
      thought: 'Inspect the documentation target.',
      action: 'Read',
      action_input: { file_path: 'README.md' },
      observation: JSON.stringify({ success: false, error: 'README.md does not exist.' }),
    }];
    const llm = createCapturingLlm('{"tool":"Write","arguments":{"file_path":"README.md","content":"# Project","allowCreate":true}}');

    await planAction(state, 'Implement the requested documentation update.', llm, { model: 'mock' }, createMockRegistry());

    const prompt = llm.prompts.join('\n');
    expect(prompt).toContain('LATEST READ FAILURE');
    expect(prompt).toContain('README.md does not exist');
    expect(prompt).toContain('Do not retry Read');
    expect(prompt).toContain('allowCreate: true');
  });

  it('hard-blocks a repeated Read of the same missing absolute target', async () => {
    const missingTarget = 'C:/MPC Project Test/fake desktop/package.json';
    const llm = createSequentialLlm([
      JSON.stringify({ tool: 'Read', arguments: { file_path: missingTarget } }),
      JSON.stringify({ tool: 'Command', arguments: { operation: 'list_directory', args: ['.'] } }),
    ]);
    const state = createState();
    state.workspace = 'C:/MPC Project Test/fake desktop';
    state.steps = [{
      thought: 'Inspect package metadata.',
      action: 'Read',
      action_input: { file_path: missingTarget },
      observation: JSON.stringify({
        success: false,
        error: `ENOENT: no such file or directory, open '${missingTarget}'`,
      }),
    }];

    await expect(planAction(state, 'Continue the project task.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({
        action: 'Command',
        action_input: { operation: 'list_directory', args: ['.'] },
      });
    expect(llm.calls).toBe(2);
  });

  it('requires a mutation once all known editable targets were inspected', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Read","arguments":{"file_path":"style.css"}}',
      '{"tool":"Write","arguments":{"file_path":"style.css","content":"body { color: white; }"}}',
    ]);
    const state = createState();
    state.codingState = 'implement';
    state.noProgressCount = 3;
    state.taskAnalysis = {
      taskKind: 'new_feature',
      expectedChangeIntent: 'modify',
      approvalPolicy: 'full_access',
      contract: {
        candidateFiles: ['index.html', 'style.css'],
        completionEvidenceRequirements: { requireSourceMutationForFeatureCompletion: true },
      },
      affectedFiles: [],
      requiredInspections: ['Read index.html', 'Read style.css'],
      verificationPlan: [],
      validationRequirements: [],
      sourceFiles: [],
      riskFactors: [],
    } as any;
    state.steps = [
      { thought: 'read markup', action: 'Read', action_input: { file_path: 'index.html' }, observation: '{"success":true,"output":"<main />"}' },
      { thought: 'read styles', action: 'Read', action_input: { file_path: 'style.css' }, observation: '{"success":true,"output":"body {}"}' },
    ];

    const action = await planAction(state, 'Implement the portfolio.', llm, { model: 'mock' }, createMockRegistry());

    expect(action).toEqual({
      action: 'Write',
      action_input: { file_path: 'style.css', content: 'body { color: white; }' },
    });
    expect(llm.calls).toBe(2);
  });

  it('keeps inspection available when a known dependency has not been read', async () => {
    const llm = createSequentialLlm(['{"tool":"Read","arguments":{"file_path":"app.css"}}']);
    const state = createState();
    state.codingState = 'implement';
    state.noProgressCount = 4;
    state.taskAnalysis = {
      taskKind: 'new_feature', expectedChangeIntent: 'modify', approvalPolicy: 'full_access',
      contract: { candidateFiles: ['index.html', 'app.css'], completionEvidenceRequirements: { requireSourceMutationForFeatureCompletion: true } },
      affectedFiles: [], requiredInspections: ['Read index.html', 'Read app.css'], verificationPlan: [], validationRequirements: [], sourceFiles: [], riskFactors: [],
    } as any;
    state.steps = [{ thought: 'read markup', action: 'Read', action_input: { file_path: 'index.html' }, observation: '{"success":true}' }];

    await expect(planAction(state, 'Implement the feature.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({ action: 'Read', action_input: { file_path: 'app.css' } });
    expect(llm.calls).toBe(1);
  });

  it('forces a mutation for a broad update after relevant source inspection', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Read","arguments":{"file_path":"style.css"}}',
      '{"tool":"Write","arguments":{"file_path":"style.css","content":"body { color: white; }"}}',
    ]);
    const state = createState();
    state.codingState = 'implement';
    state.noProgressCount = 4;
    state.taskAnalysis = {
      taskKind: 'new_feature',
      expectedChangeIntent: 'modify',
      approvalPolicy: 'full_access',
      contract: { candidateFiles: [] },
      affectedFiles: [],
      requiredInspections: [],
      verificationPlan: [],
      validationRequirements: [],
      sourceFiles: [],
      riskFactors: [],
    } as any;
    state.steps = [{
      thought: 'inspect styles',
      action: 'Read',
      action_input: { file_path: 'style.css' },
      observation: '{"success":true,"output":"body {}"}',
    }];

    await expect(planAction(state, 'Implement the requested update.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({
        action: 'Write',
        action_input: { file_path: 'style.css', content: 'body { color: white; }' },
      });
    expect(llm.calls).toBe(2);
  });

  it('does not force mutation when approval or conflict evidence requires review', async () => {
    const llm = createSequentialLlm(['{"tool":"Read","arguments":{"file_path":"index.html"}}']);
    const state = createState();
    state.codingState = 'inspect';
    state.noProgressCount = 4;
    state.taskAnalysis = {
      taskKind: 'new_feature', expectedChangeIntent: 'modify', approvalPolicy: 'ask',
      contract: { candidateFiles: ['index.html'], completionEvidenceRequirements: { requireSourceMutationForFeatureCompletion: true } },
      affectedFiles: [], requiredInspections: ['Read index.html'], verificationPlan: [], validationRequirements: [], sourceFiles: [], riskFactors: [],
    } as any;
    state.steps = [{ thought: 'conflict', action: 'Edit', action_input: { file_path: 'index.html' }, observation: '{"success":false,"error":"Transactional mutation rejected: index.html overlaps uncommitted user changes."}' }];

    await expect(planAction(state, 'Implement the feature.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({ action: 'Read', action_input: { file_path: 'index.html' } });
    expect(llm.calls).toBe(1);
  });

  it('forces mutation after approved inspection reaches the no-progress limit', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Read","arguments":{"file_path":"index.html"}}',
      '{"tool":"Write","arguments":{"file_path":"index.html","content":"<main />"}}',
    ]);
    const state = createState();
    state.codingState = 'inspect';
    state.noProgressCount = 4;
    state.approvalGrants = [{ scope: 'write:index.html', decision: 'allow', createdAt: Date.now() }];
    state.taskAnalysis = {
      taskKind: 'new_feature', expectedChangeIntent: 'modify', approvalPolicy: 'ask',
      contract: { candidateFiles: ['index.html'], completionEvidenceRequirements: { requireSourceMutationForFeatureCompletion: true } },
      affectedFiles: [], requiredInspections: ['Read index.html'], verificationPlan: [], validationRequirements: [], sourceFiles: [], riskFactors: [],
    } as any;
    state.steps = [{ thought: 'read target', action: 'Read', action_input: { file_path: 'index.html' }, observation: '{"success":true}' }];

    await expect(planAction(state, 'Implement the feature.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({ action: 'Write', action_input: { file_path: 'index.html', content: '<main />' } });
    expect(llm.calls).toBe(2);
  });

  it('keeps the no-progress guard open while a known mutation target remains uninspected', () => {
    const state = createState();
    state.taskAnalysis = {
      taskKind: 'new_feature',
      expectedChangeIntent: 'modify',
      contract: { candidateFiles: ['index.html', 'style.css'] },
      affectedFiles: [],
    } as any;
    state.steps = [{
      thought: 'read markup',
      action: 'Read',
      action_input: { file_path: 'index.html' },
      observation: '{"success":true}',
    }];

    expect(hasUninspectedKnownMutationTargets(state)).toBe(true);
    state.steps.push({
      thought: 'read styles',
      action: 'Read',
      action_input: { file_path: 'style.css' },
      observation: '{"success":true}',
    });
    expect(hasUninspectedKnownMutationTargets(state)).toBe(false);
  });

  it('matches an absolute Windows read to a workspace-relative mutation target', () => {
    const state = createState();
    state.workspace = 'C:\\MPC Project Test\\game 1';
    state.taskAnalysis = {
      taskKind: 'bug_fix',
      expectedChangeIntent: 'modify',
      contract: { candidateFiles: ['index.js'] },
      affectedFiles: [{ path: 'index.js', intent: 'modify' }],
    } as any;
    state.steps = [{
      thought: 'read entry point',
      action: 'Read',
      action_input: { file_path: 'C:\\MPC Project Test\\game 1\\index.js' },
      observation: '{"success":true}',
    }];

    expect(hasUninspectedKnownMutationTargets(state)).toBe(false);
  });

  it('does not keep inspection open for a confirmed-missing non-create target', () => {
    const state = createState();
    state.workspace = 'C:\\MPC Project Test\\game 1';
    state.taskAnalysis = {
      taskKind: 'bug_fix',
      expectedChangeIntent: 'modify',
      projectFileMap: {
        workspace: state.workspace,
        generatedAt: Date.now(),
        totalFiles: 2,
        omittedCount: 0,
        files: [
          { path: 'index.js', exists: true, layer: 'unknown', role: 'project file' },
          { path: 'Node.js', exists: false, layer: 'unknown', role: 'project file' },
        ],
      },
      contract: { candidateFiles: ['index.js', 'Node.js'] },
      affectedFiles: [
        { path: 'index.js', intent: 'modify' },
        { path: 'Node.js', intent: 'modify' },
      ],
    } as any;
    state.steps = [{
      thought: 'read entry point',
      action: 'Read',
      action_input: { file_path: 'C:\\MPC Project Test\\game 1\\index.js' },
      observation: '{"success":true}',
    }];

    expect(hasUninspectedKnownMutationTargets(state)).toBe(false);
  });

  it('retries when the first corrective response still inspects after the no-progress limit', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Command","arguments":{"operation":"list_directory","args":["."]}}',
      '{"tool":"Read","arguments":{"file_path":"src/game.ts"}}',
      '{"tool":"Write","arguments":{"file_path":"src/game.ts","content":"export const game = true;"}}',
    ]);
    const state = createState();
    state.codingState = 'implement';
    state.noProgressCount = 4;

    const action = await planAction(state, 'Implement the requested feature.', llm, { model: 'mock' }, createMockRegistry());

    expect(action).toEqual({
      action: 'Write',
      action_input: { file_path: 'src/game.ts', content: 'export const game = true;' },
    });
    expect(llm.calls).toBe(3);
  });

  it('does not allow inspection when the engine has forced mutation recovery', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Read","arguments":{"file_path":"style.css"}}',
      '{"tool":"Write","arguments":{"file_path":"index.html","content":"<main />"}}',
    ]);
    const state = createState();
    state.codingState = 'implement';
    state.forceMutationNextAction = true;
    state.noProgressCount = 4;
    state.taskAnalysis = {
      taskKind: 'new_feature',
      expectedChangeIntent: 'modify',
      approvalPolicy: 'full_access',
      contract: {
        candidateFiles: ['index.html', 'style.css'],
        completionEvidenceRequirements: { requireSourceMutationForFeatureCompletion: true },
      },
      affectedFiles: [],
      requiredInspections: ['Read index.html', 'Read style.css'],
      verificationPlan: [],
      validationRequirements: [],
      sourceFiles: [],
      riskFactors: [],
    } as any;

    await expect(planAction(state, 'Recover the implementation.', llm, { model: 'mock' }, createMockRegistry()))
      .resolves.toEqual({
        action: 'Write',
        action_input: { file_path: 'index.html', content: '<main />' },
      });
    expect(llm.calls).toBe(2);
  });

  it('normalizes common FindFile aliases to Glob', async () => {
    const action = await planAction(
      createState(),
      'Find the application entry point.',
      createMockLlm('{"tool":"FindFile","arguments":{"file_path":"src/app.ts"}}'),
      { model: 'mock' },
      createRegistryWithGlob(),
    );

    expect(action).toEqual({
      action: 'Glob',
      action_input: { file_path: 'src/app.ts', pattern: '**/app.ts' },
    });
  });

  it('classifies a missing corrective tool as forced mutation recovery', async () => {
    const llm = createSequentialLlm([
      '{"tool":"FindFile","arguments":{"file_path":"src/app.ts"}}',
      '{"role":"assistant","content":"I will inspect the file."}',
      '{"role":"assistant","content":"I will inspect the file."}',
    ]);
    const state = createState();
    state.codingState = 'implement';
    state.forceMutationNextAction = true;
    state.noProgressCount = 4;

    await expect(planAction(state, 'Recover the implementation.', llm, { model: 'mock' }, createMockRegistry()))
      .rejects.toThrow('The engine is forcing implementation after a repeated loop');
    expect(llm.calls).toBe(3);
  });

  it('does not return a read policy fallback when forced correction cannot reach the model', async () => {
    let calls = 0;
    const llm: LLMProvider = {
      createChatCompletion: async () => {
        calls++;
        if (calls === 1) return '{"tool":"Read","arguments":{"file_path":"src/game.ts"}}';
        throw new Error('All LLM providers failed');
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'mock',
      isAvailable: () => true,
    };
    const state = createState();
    state.codingState = 'implement';
    state.forceMutationNextAction = true;
    state.noProgressCount = 4;

    await expect(planAction(state, 'Recover the implementation.', llm, { model: 'mock' }, createMockRegistry()))
      .rejects.toThrow('All LLM providers failed');
    expect(calls).toBe(2);
  });

  it('does not use the read fallback when forced recovery responses never select a tool', async () => {
    const packageMetadata = '{"name":"pacman-game","version":"1.0.0"}';
    const llm = createSequentialLlm([packageMetadata, packageMetadata, packageMetadata]);
    const state = createState();
    state.codingState = 'implement';
    state.forceMutationNextAction = true;
    state.noProgressCount = 4;
    state.steps = [{
      thought: 'Inspect the target.',
      action: 'Read',
      action_input: { file_path: 'src/game.ts' },
      observation: JSON.stringify({ success: true, output: 'export const game = false;' }),
    }];

    await expect(planAction(state, 'Recover the implementation.', llm, { model: 'mock' }, createMockRegistry()))
      .rejects.toThrow(/Invalid tool selection|Missing tool name/);
    expect(llm.calls).toBe(3);
  });

  it('does not re-read a failed mutation target after forced recovery rejects Read', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Read","arguments":{"file_path":"src/game.ts"}}',
      '{"tool":"Read","arguments":{"file_path":"src/game.ts"}}',
      '{"tool":"Read","arguments":{"file_path":"src/game.ts"}}',
    ]);
    const state = createState();
    state.codingState = 'implement';
    state.forceMutationNextAction = true;
    state.noProgressCount = 4;
    state.plan = [{ step: 'Implement the change', status: 'in_progress', kind: 'implement' }];
    state.steps = [{
      thought: 'Apply the change.',
      action: 'Edit',
      action_input: { file_path: 'src/game.ts', old_string: 'stale', new_string: 'new' },
      observation: JSON.stringify({ success: false, error: 'old_string was not found' }),
    }];

    await expect(planAction(state, 'Continue the implementation.', llm, { model: 'mock' }, createMockRegistry()))
      .rejects.toThrow(/Invalid corrective tool selection|cannot advance/);
    expect(llm.calls).toBe(3);
  });

  it('accepts a valid inspection action when mutation corrections are exhausted', async () => {
    const llm = createSequentialLlm([
      '{"tool":"Read","arguments":{"file_path":"src/game.ts"}}',
      '{"tool":"Read","arguments":{"file_path":"src/game.ts"}}',
      '{"tool":"Read","arguments":{"file_path":"src/game.ts"}}',
    ]);
    const state = createState();
    state.codingState = 'implement';
    state.noProgressCount = 4;

    const action = await planAction(state, 'Implement the requested feature.', llm, { model: 'mock' }, createMockRegistry());

    expect(action).toEqual({
      action: 'Read',
      action_input: { file_path: 'src/game.ts' },
    });
    expect(llm.calls).toBe(3);
  });

  it('keeps the valid inspection action when the corrective provider request fails', async () => {
    let calls = 0;
    const llm: LLMProvider = {
      createChatCompletion: async () => {
        calls++;
        if (calls === 1) {
          return '{"tool":"Command","arguments":{"operation":"list_directory","args":["."]}}';
        }
        throw new Error('All LLM providers failed');
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'mock',
      isAvailable: () => true,
    };
    const state = createState();
    state.codingState = 'implement';
    state.noProgressCount = 4;

    const action = await planAction(state, 'Implement the requested feature.', llm, { model: 'mock' }, createMockRegistry());

    expect(action).toEqual({
      action: 'Command',
      action_input: { operation: 'list_directory', args: ['.'] },
    });
    expect(calls).toBe(2);
  });

  it('stops for user confirmation when Git initialization is needed', async () => {
    const state = createState();
    state.steps = [
      {
        thought: 'Check git status before mutation.',
        action: 'Bash',
        action_input: { command: 'git status --short' },
        observation: JSON.stringify({
          success: true,
          output:
            'No Git repository was detected in C:\\MPC Project Test\\Pacman.\nBefore initializing Git here, ask the user for confirmation.\nIf the user approves, run `git init` in this workspace, then continue with the dirty-tree check.',
        }),
      },
    ];

    await expect(checkIfDone(state, createMockLlm('NO'), { model: 'mock' })).resolves.toBe(true);
  });
});

describe('planner app contract context', () => {
  it('includes the app-building contract when creating an execution plan', async () => {
    const llm = createCapturingLlm(
      '[{"step":"Inspect workspace","status":"pending"},{"step":"Build app from contract","status":"pending"},{"step":"Verify app contract checks","status":"pending"}]'
    );
    const state = {
      ...createState(),
      appSpec: buildFallbackAppSpec('Create a standalone timer tool'),
    };

    await createExecutionPlan(state, llm, { model: 'mock' });

    expect(llm.prompts.join('\n')).toContain('App-building contract');
    expect(llm.prompts.join('\n')).toContain('Verification');
  });

  it('asks the model to adapt its milestones instead of forcing a phase count', async () => {
    const llm = createCapturingLlm('[{"step":"Implement and verify phase one","status":"pending"}]');

    await createExecutionPlan(createState(), llm, { model: 'mock', phasedExecution: true });

    const prompt = llm.prompts.join('\n');
    expect(prompt).toContain('Choose as many or as few milestones as the task actually needs');
    expect(prompt).toContain('adaptive working memory');
    expect(prompt).not.toContain('leave later phases pending');
  });

  it('includes the app-building contract when synthesizing the final answer', async () => {
    const llm = createCapturingLlm('Created the app and verified it.');
    const state = {
      ...createState(),
      appSpec: buildFallbackAppSpec('Create a standalone piano tool'),
    };

    const answer = await synthesizeAnswer(state, llm, { model: 'mock' });

    expect(answer).toBe('Created the app and verified it.');
    expect(llm.prompts.join('\n')).toContain('App-building contract');
    expect(llm.prompts.join('\n')).toContain('Verification');
  });

  describe('synthesizeAnswer structured prompt & task type quality', () => {
    it('structures the prompt with required sections: accomplished, key changes, issues, next steps', async () => {
      const llm = createCapturingLlm('Summary response');
      const state = {
        ...createState(),
        task: 'Fix the login button bug',
        taskAnalysis: { taskKind: 'bug_fix', expectedChangeIntent: 'modify' } as any,
      };

      await synthesizeAnswer(state, llm, { model: 'mock' });

      const prompt = llm.prompts.join('\n');
      expect(prompt).toContain('## What was accomplished');
      expect(prompt).toContain('## Key changes / outputs');
      expect(prompt).toContain('## Issues or caveats');
      expect(prompt).toContain('## Suggested next steps');
    });

    it('uses temperature 0.2 and read-only guidance for questions and investigations', async () => {
      const llm = createCapturingLlmWithOptions('Direct answer to user question.');
      const state = {
        ...createState(),
        task: 'Where is the auth configuration located?',
        taskAnalysis: { taskKind: 'question', expectedChangeIntent: 'read_only' } as any,
      };

      await synthesizeAnswer(state, llm, { model: 'mock' });

      expect(llm.optionsCaptured[0]?.temperature).toBe(0.2);
      const prompt = llm.prompts.join('\n');
      expect(prompt).toContain('State the direct answer, findings, or information produced directly');
    });

    it('uses temperature 0.5 and mutation guidance for code modification tasks', async () => {
      const llm = createCapturingLlmWithOptions('Implemented the feature.');
      const state = {
        ...createState(),
        task: 'Add logout endpoint',
        taskAnalysis: { taskKind: 'new_feature', expectedChangeIntent: 'create' } as any,
      };

      await synthesizeAnswer(state, llm, { model: 'mock' });

      expect(llm.optionsCaptured[0]?.temperature).toBe(0.5);
      const prompt = llm.prompts.join('\n');
      expect(prompt).toContain('List the files modified, commands run, or artefacts produced');
    });

    it('includes mutated files in prompt context when successful mutations occurred', async () => {
      const llm = createCapturingLlm('Updated files.');
      const state = {
        ...createState(),
        task: 'Refactor auth service',
        taskAnalysis: { taskKind: 'refactor', expectedChangeIntent: 'modify' } as any,
        steps: [
          {
            thought: 'Read file',
            action: 'Read',
            action_input: { file_path: 'src/auth.ts' },
            observation: '{"success":true,"output":"content"}',
          },
          {
            thought: 'Write updated auth file',
            action: 'Write',
            action_input: { file_path: 'src/auth.ts', content: 'new content' },
            observation: '{"success":true}',
          },
          {
            thought: 'Edit config',
            action: 'Edit',
            action_input: { file_path: 'src/config.ts', old_string: 'a', new_string: 'b' },
            observation: '{"success":true}',
          },
          {
            thought: 'Failed edit on test',
            action: 'Edit',
            action_input: { file_path: 'src/fail.ts', old_string: 'x', new_string: 'y' },
            observation: '{"success":false,"error":"old_string not found"}',
          },
        ],
      };

      await synthesizeAnswer(state, llm, { model: 'mock' });

      const prompt = llm.prompts.join('\n');
      expect(prompt).toContain('Files modified:\n- src/auth.ts\n- src/config.ts');
      expect(prompt).not.toContain('- src/fail.ts');
    });

    it('correctly classifies task types using classifyTaskType', () => {
      expect(classifyTaskType({
        task: 'What is the port?',
        taskAnalysis: { taskKind: 'question', expectedChangeIntent: 'read_only' } as any,
        steps: [],
      })).toBe('read_only');

      expect(classifyTaskType({
        task: 'Check the logs',
        taskAnalysis: { taskKind: 'investigation', expectedChangeIntent: 'read_only' } as any,
        steps: [],
      })).toBe('read_only');

      expect(classifyTaskType({
        task: 'Restructure database models',
        taskAnalysis: { taskKind: 'refactor', expectedChangeIntent: 'modify' } as any,
        steps: [],
      })).toBe('refactor');

      expect(classifyTaskType({
        task: 'Implement auth token refresh',
        taskAnalysis: { taskKind: 'new_feature', expectedChangeIntent: 'create' } as any,
        steps: [],
      })).toBe('code_change');

      // Without taskAnalysis, recognizes question task
      expect(classifyTaskType({
        task: 'How does the caching layer work?',
        steps: [],
      } as any)).toBe('read_only');
    });

    it('extracts unique mutated files correctly while ignoring non-mutating and failed steps', () => {
      const steps: any[] = [
        { action: 'Read', action_input: { file_path: 'read.ts' }, observation: '{"success":true}' },
        { action: 'Write', action_input: { file_path: '.\\src\\app.ts' }, observation: '{"success":true}' },
        { action: 'Write', action_input: { file_path: 'src/app.ts' }, observation: '{"success":true}' },
        { action: 'Edit', action_input: { file: 'src/utils.ts' }, observation: '{"success":true}' },
        { action: 'Edit', action_input: { path: 'src/failed.ts' }, observation: '{"success":false,"error":"bad"}' },
        { action: 'Write', action_input: { file_path: 'src/failed2.ts' }, observation: 'error occurred' },
      ];

      const mutated = getMutatedFiles(steps);
      expect(mutated).toEqual(['src/app.ts', 'src/utils.ts']);
    });
  });
});

describe('planner completion evidence', () => {
  it('builds a deterministic final answer for a one-step empty root inspection', () => {
    const state = createState();
    state.taskAnalysis = { taskKind: 'investigation', expectedChangeIntent: 'read_only' } as any;
    state.steps = [{
      thought: 'Inspect the workspace root.',
      action: 'Command',
      action_input: { operation: 'list_directory', args: ['.'] },
      observation: JSON.stringify({ success: true, output: '' }),
    }];

    expect(getDeterministicInspectionAnswer(state)).toBe(
      'I inspected the workspace root. It is empty—no files or directories were found. No files were modified.',
    );
  });

  it('asks for a concrete target when a bare mutation verb is supplied', () => {
    const state = createState();
    state.taskAnalysis = { taskKind: 'question', expectedChangeIntent: 'read_only', userRequest: 'update' } as any;
    state.steps = [{
      thought: 'Inspect the workspace root.',
      action: 'Command',
      action_input: { operation: 'list_directory', args: ['.'] },
      observation: JSON.stringify({ success: true, output: 'index.js' }),
    }];

    expect(getDeterministicInspectionAnswer(state)).toContain('concrete target');
  });

  it('keeps LLM synthesis for broader or mutating completion states', () => {
    const multiStep = createState();
    multiStep.taskAnalysis = { taskKind: 'investigation', expectedChangeIntent: 'read_only' } as any;
    multiStep.steps = [
      { thought: 'List root', action: 'Glob', action_input: { pattern: '**/*' }, observation: '{"success":true,"output":"a.ts"}' },
      { thought: 'Read file', action: 'Read', action_input: { file_path: 'a.ts' }, observation: '{"success":true,"output":"code"}' },
    ];
    const mutating = createState();
    mutating.taskAnalysis = { taskKind: 'new_feature', expectedChangeIntent: 'create' } as any;
    mutating.steps = [{
      thought: 'List root', action: 'Command', action_input: { operation: 'list_directory' }, observation: '{"success":true,"output":""}',
    }];

    expect(getDeterministicInspectionAnswer(multiStep)).toBeUndefined();
    expect(getDeterministicInspectionAnswer(mutating)).toBeUndefined();
  });

  it('completes a classified read-only task after one successful empty workspace inspection', async () => {
    const llm = createSequentialLlm(['unused']);
    const state = createState();
    state.taskAnalysis = { taskKind: 'investigation', expectedChangeIntent: 'read_only' } as any;
    state.steps = [{
      thought: 'Inspect the workspace root.',
      action: 'Glob',
      action_input: { pattern: '**/*' },
      observation: '{"success":true,"output":""}',
    }];

    expect(hasCompletionEvidence(state)).toBe(true);
    await expect(checkIfDone(state, llm, { model: 'mock' })).resolves.toBe(true);
    expect(llm.calls).toBe(0);
  });

  it('skips the completion LLM for analyzed coder tasks until deterministic evidence exists', async () => {
    const llm = createSequentialLlm(['YES']);
    const state = createState();
    state.taskAnalysis = {
      taskKind: 'new_feature',
      behaviorScope: 'new_behavior',
      expectedChangeIntent: 'create',
    } as any;
    state.steps = [{
      thought: 'Read the source document',
      action: 'DocumentRead',
      action_input: { file_path: 'resume.pdf' },
      observation: JSON.stringify({ success: true, output: 'resume text' }),
    }];

    await expect(checkIfDone(state, llm, { model: 'mock' })).resolves.toBe(false);
    expect(llm.calls).toBe(0);
  });

  it('continues work when the advisory completion LLM is unavailable', async () => {
    const state = createState();
    let calls = 0;
    const llm = {
      createChatCompletion: async () => {
        calls++;
        throw new Error('All LLM providers failed');
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'test',
      isAvailable: () => true,
    };

    await expect(checkIfDone(state, llm, { model: 'mock' })).resolves.toBe(false);
    expect(calls).toBe(1);
  });

  it('does not treat a workspace named test as verification evidence', () => {
    const state = createState();
    state.steps = [{
      thought: 'Extract resume',
      action: 'Bash',
      action_input: { command: 'node extract.js', cwd: 'C:\\MPC Project Test\\test 2' },
      observation: JSON.stringify({ success: true, output: 'document extracted' }),
    }];

    expect(hasSuccessfulVerificationSignal(state)).toBe(false);
  });

  it('treats successful mutation plus build output as completion evidence', () => {
    const state = createState();
    state.steps = [
      {
        thought: 'Copy the updated UI files.',
        action: 'Bash',
        action_input: { command: 'powershell -NoProfile -Command "Copy-Item ui/src ui/src_backup -Recurse"' },
        observation: '{"success":true,"output":""}',
      },
      {
        thought: 'Verify the app builds.',
        action: 'Bash',
        action_input: { command: 'npm run build' },
        observation: '{"success":true,"output":"vite build\\n✓ built in 411ms"}',
      },
    ];

    expect(hasSuccessfulVerificationSignal(state)).toBe(true);
    expect(hasCompletionEvidence(state)).toBe(true);
  });

  it('does not treat a successful build alone as completion evidence', () => {
    const state = createState();
    state.steps = [
      {
        thought: 'Verify the app builds.',
        action: 'Bash',
        action_input: { command: 'npm run build' },
        observation: '{"success":true,"output":"vite build\\n✓ built in 411ms"}',
      },
    ];

    expect(hasSuccessfulVerificationSignal(state)).toBe(true);
    expect(hasCompletionEvidence(state)).toBe(false);
  });

  it('does not treat skipped verification as a successful signal', () => {
    const state = createState();
    state.steps = [{
      thought: 'Try the requested tests.',
      action: 'Bash',
      action_input: { command: 'npm run test:unit' },
      observation: JSON.stringify({
        success: true,
        skipped: true,
        verificationUnavailable: true,
        output: 'Verification unavailable: package.json not found.',
      }),
    }];

    expect(hasSuccessfulVerificationSignal(state)).toBe(false);
  });

  it('does not complete a feature task with checklist-only edits', () => {
    const state = createState();
    state.taskAnalysis = {
      taskKind: 'new_feature',
      behaviorScope: 'new_behavior',
      expectedChangeIntent: 'modify',
    } as any;
    state.steps = [
      {
        thought: 'Check off the phase.',
        action: 'Edit',
        action_input: { file_path: 'TODO.md', old_string: '- [ ] Feature', new_string: '- [x] Feature' },
        observation: JSON.stringify({ success: true, output: 'Replaced 1 occurrence in TODO.md' }),
      },
      {
        thought: 'Run the build.',
        action: 'Bash',
        action_input: { command: 'npm run build' },
        observation: JSON.stringify({ success: true, output: 'build complete' }),
      },
    ];

    expect(hasSuccessfulVerificationSignal(state)).toBe(true);
    expect(hasCompletionEvidence(state)).toBe(false);
  });

  it('reminds the planner of the prior solution state without replaying file contents', async () => {
    const state = createState();
    state.plan = [
      { step: 'Implement the remaining fix', status: 'in_progress' },
      { step: 'Run focused verification', status: 'pending' },
    ];
    state.lastRun = {
      completedStepCount: 6,
      lastAction: 'Read',
      lastActionInput: { file_path: 'src/app.ts' },
      lastActionSucceeded: true,
      nextPlanItem: 'Implement the remaining fix',
      recordedAt: 1,
    };
    state.forceMutationNextAction = true;
    state.blockedReason = 'Execution state budget exhausted before a source mutation succeeded.';
    const llm = createCapturingLlm('{"tool":"Write","arguments":{"file_path":"src/app.ts","content":"fixed"}}');

    await planAction(state, 'Continue from the last run.', llm, { model: 'mock' }, createMockRegistry());

    const prompt = llm.prompts.join('\n');
    expect(prompt).toContain('Last-run solution awareness (bounded guidance; not completion evidence)');
    expect(prompt).toContain('Attempted approach: Read src/app.ts (succeeded)');
    expect(prompt).toContain('Choose a scoped Write or Edit action now; do not repeat inspection.');
    expect(prompt).not.toContain('source contents');
  });

  it('carries a concrete mutation target into forced recovery instructions', async () => {
    const state = createState();
    state.forceMutationNextAction = true;
    state.forceMutationTarget = 'src/app.ts';
    const llm = createCapturingLlm('{"tool":"Write","arguments":{"file_path":"src/app.ts","content":"fixed"}}');

    await planAction(state, 'Continue from the blocked run.', llm, { model: 'mock' }, createMockRegistry());

    const prompt = llm.prompts.join('\n');
    expect(prompt).toContain('Target file: src/app.ts');
    expect(prompt).toContain('The scoped target is src/app.ts; include it as file_path.');
  });

  it('marks rebased continuation evidence as historical and requests current inspection', () => {
    const context = formatContinuationCheckpointContext({
      continuationHandoff: {
        version: 1,
        parentRunId: 'parent-run',
        reason: 'saved_run',
        createdAt: 1,
        currentGoal: 'Finish the remaining task',
        workspaceRebased: true,
        completedPlanItems: ['Implement completed change'],
        remainingPlanItems: ['Verify remaining behavior'],
        evidence: {
          parentStepCount: 4,
          childStepOffset: 0,
          actionSignatures: [],
          fileReadPaths: ['src/app.ts'],
        },
        quality: {
          sourcePromptTokens: 100,
          handoffPromptTokens: 20,
          promptReductionTokens: 80,
          promptReductionRatio: 0.8,
          repeatedParentActions: 0,
          staleParentFileReads: 0,
        },
      },
    });

    expect(context).toContain('Workspace-rebased continuation checkpoint');
    expect(context).toContain('workspace changed after the parent checkpoint');
    expect(context).toContain('inspect the current relevant files');
    expect(context).not.toContain('Prior tool evidence remains valid');
  });
});
