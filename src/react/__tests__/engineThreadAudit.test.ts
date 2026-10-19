import { jest, describe, it, beforeEach, expect } from '@jest/globals';

const mockRecordRunResult = jest.fn();

jest.unstable_mockModule('../logger.js', () => ({
  recordRunResult: mockRecordRunResult,
  getPastRuns: jest.fn(),
  getRawLogFile: jest.fn(),
  clearAllLogs: jest.fn(),
}));

const { ReActEngine } = await import('../engine.js');

describe('Thread-Scoped Audit Logging in ReActEngine', () => {
  beforeEach(() => {
    mockRecordRunResult.mockClear();
  });

  it('records completed outcomeKind with thread metadata on success', async () => {
    const readHandler = jest.fn().mockResolvedValue({ success: true, output: 'file contents' });
    const toolRegistry = {
      getAll: () => [{ name: 'Read', description: 'Read file', inputSchema: { type: 'object' }, handler: readHandler }],
      get: (name: string) => (name === 'Read' ? { name: 'Read', description: 'Read file', inputSchema: { type: 'object' }, handler: readHandler } : undefined),
      getEnabled: () => [{ name: 'Read', description: 'Read file', inputSchema: { type: 'object' }, handler: readHandler }],
      has: (name: string) => name === 'Read',
      register: jest.fn(),
      setEnabled: jest.fn(),
      getNames: () => ['Read'],
      size: () => 1,
    };

    const engine = new ReActEngine({
      model: 'test-model',
      threadId: 'THREAD-42',
      parentRunId: 'RUN-PREV',
      attemptIndex: 2,
      threadTitle: 'Inspect Pacman Codebase',
      pacingProfile: 'fast',
      maxSteps: 3,
      budget: 100,
      toolRegistry: toolRegistry as any,
      taskAnalysis: {
        id: 'inspect-task',
        expectedChangeIntent: 'read_only',
        contract: {},
      } as any,
      llmProvider: {
        createChatCompletion: async (_messages: any, _model: string, options?: any) => {
          if (options?.requestKind === 'step.reason') return 'Inspect the file.';
          if (options?.requestKind === 'step.plan_action') {
            return '{"tool":"Read","arguments":{"file_path":"test.ts"}}';
          }
          if (options?.requestKind === 'step.check_done') return 'true';
          if (options?.requestKind === 'final_answer.synthesize') return 'Inspection complete.';
          return 'Done';
        },
        estimateStepCost: () => 0,
        getProviderName: () => 'mock',
        isAvailable: () => true,
      },
    });

    const result = await engine.run('Inspect Pacman Codebase');
    expect(result.success).toBe(true);

    expect(mockRecordRunResult).toHaveBeenCalledWith(
      'Inspect Pacman Codebase',
      'test-model',
      100,
      true,
      expect.any(Array),
      expect.any(Number),
      expect.any(String),
      undefined,
      expect.anything(),
      expect.objectContaining({
        threadId: 'THREAD-42',
        parentRunId: 'RUN-PREV',
        attemptIndex: 2,
        threadTitle: 'Inspect Pacman Codebase',
        outcomeKind: 'completed',
      })
    );
  });

  it('records checkpoint_turn_limit outcomeKind when turn limit is reached', async () => {
    const toolRegistry = {
      getAll: () => [{ name: 'Read', description: 'Read a file', inputSchema: { type: 'object' }, handler: jest.fn().mockResolvedValue('content') }],
      get: (name: string) => (name === 'Read' ? { name: 'Read', description: 'Read a file', inputSchema: { type: 'object' }, handler: jest.fn().mockResolvedValue('content') } : undefined),
      getEnabled: () => [{ name: 'Read', description: 'Read a file', inputSchema: { type: 'object' }, handler: jest.fn().mockResolvedValue('content') }],
      has: (name: string) => name === 'Read',
      register: jest.fn(),
      setEnabled: jest.fn(),
      getNames: () => ['Read'],
      size: () => 1,
    };

    const engine = new ReActEngine({
      model: 'test-model',
      threadId: 'THREAD-42',
      attemptIndex: 1,
      threadTitle: 'Implement Pacman Game',
      pacingProfile: 'fast',
      maxSteps: 1,
      budget: 100,
      toolRegistry: toolRegistry as any,
      llmProvider: {
        createChatCompletion: async () => 'Action: Read\nAction Input: {"file_path":"test.ts"}',
        estimateStepCost: () => 0,
        getProviderName: () => 'mock',
        isAvailable: () => true,
      },
    });

    const result = await engine.run('Implement Pacman Game');
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('MAX_STEPS_EXCEEDED');

    expect(mockRecordRunResult).toHaveBeenCalledWith(
      'Implement Pacman Game',
      'test-model',
      100,
      false,
      expect.any(Array),
      expect.any(Number),
      undefined,
      expect.stringContaining('Turn limit reached'),
      undefined,
      expect.objectContaining({
        threadId: 'THREAD-42',
        attemptIndex: 1,
        outcomeKind: 'checkpoint_turn_limit',
      })
    );
  });

  it('records cancelled outcomeKind when run signal is aborted', async () => {
    const abortController = new AbortController();
    abortController.abort();

    const toolRegistry = {
      getAll: () => [],
      get: () => undefined,
      getEnabled: () => [],
      has: () => false,
      register: jest.fn(),
      setEnabled: jest.fn(),
      getNames: () => [],
      size: () => 0,
    };

    const engine = new ReActEngine({
      model: 'test-model',
      threadId: 'THREAD-42',
      attemptIndex: 1,
      threadTitle: 'Aborted Task',
      signal: abortController.signal,
      toolRegistry: toolRegistry as any,
      llmProvider: {
        createChatCompletion: async () => 'Action: Read',
        estimateStepCost: () => 0,
        getProviderName: () => 'mock',
        isAvailable: () => true,
      },
    });

    const result = await engine.run('Aborted Task');
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('USER_STOPPED');

    expect(mockRecordRunResult).toHaveBeenCalledWith(
      'Aborted Task',
      'test-model',
      expect.any(Number),
      false,
      expect.any(Array),
      expect.any(Number),
      undefined,
      'Run stopped by user.',
      expect.anything(),
      expect.objectContaining({
        threadId: 'THREAD-42',
        outcomeKind: 'cancelled',
      })
    );
  });
});
