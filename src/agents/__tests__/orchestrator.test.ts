import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  OrchestratorAgent,
  formatSubtaskResultsForPrompt,
  MAX_SUBTASK_RESULT_LENGTH,
  type SubtaskResult,
} from '../orchestrator.js';
import { di } from '../../di/container.js';
import type { LLMProvider } from '../../di/types.js';

describe('OrchestratorAgent Result Synthesis', () => {
  describe('formatSubtaskResultsForPrompt', () => {
    it('formats successful subtasks with COMPLETED status and details', () => {
      const subtasks: SubtaskResult[] = [
        {
          taskId: 'task-1',
          description: 'Set up database schema',
          result: 'Created schema in migrations/001.sql',
          success: true,
        },
      ];

      const formatted = formatSubtaskResultsForPrompt(subtasks);
      expect(formatted).toContain('1. Task: "Set up database schema" (ID: task-1)');
      expect(formatted).toContain('Status: ✅ COMPLETED');
      expect(formatted).toContain('Result: Created schema in migrations/001.sql');
    });

    it('identifies and marks failed subtasks accurately', () => {
      const subtasks: SubtaskResult[] = [
        {
          taskId: 'task-1',
          description: 'Run migrations',
          result: 'Failed: connection timeout to PostgreSQL',
          success: false,
        },
        {
          taskId: 'task-2',
          description: 'Seed test data',
          result: null,
        },
      ];

      const formatted = formatSubtaskResultsForPrompt(subtasks);
      expect(formatted).toContain('1. Task: "Run migrations" (ID: task-1)');
      expect(formatted).toContain('Status: ❌ FAILED');
      expect(formatted).toContain('Result: Failed: connection timeout to PostgreSQL');

      expect(formatted).toContain('2. Task: "Seed test data" (ID: task-2)');
      expect(formatted).toContain('Status: ❌ FAILED');
      expect(formatted).toContain('Result: No result produced');
    });

    it('truncates results exceeding MAX_SUBTASK_RESULT_LENGTH (1500 chars)', () => {
      const longResult = 'A'.repeat(2000);
      const subtasks: SubtaskResult[] = [
        {
          taskId: 'task-1',
          description: 'Analyze large log file',
          result: longResult,
          success: true,
        },
      ];

      const formatted = formatSubtaskResultsForPrompt(subtasks);
      expect(formatted).toContain('... [truncated]');
      // Formatted result should not contain the full 2000 characters
      expect(formatted).not.toContain('A'.repeat(1600));
      expect(formatted).toContain('A'.repeat(MAX_SUBTASK_RESULT_LENGTH));
    });

    it('supports custom maxResultLength for truncation', () => {
      const subtasks: SubtaskResult[] = [
        {
          taskId: 'task-1',
          description: 'Short test',
          result: 'Hello world from test',
          success: true,
        },
      ];

      const formatted = formatSubtaskResultsForPrompt(subtasks, 5);
      expect(formatted).toContain('Result: Hello... [truncated]');
    });
  });

  describe('synthesizeResults', () => {
    let mockLlm: jest.Mocked<LLMProvider>;
    let capturedMessages: any[] = [];
    let capturedOptions: any = null;

    beforeEach(() => {
      capturedMessages = [];
      capturedOptions = null;

      mockLlm = {
        createChatCompletion: jest.fn(async (messages: any, model: any, options: any) => {
          capturedMessages = messages;
          capturedOptions = options;
          if (options?.onStreamEvent) {
            options.onStreamEvent({ type: 'text_delta', delta: 'Synthesized ' });
            options.onStreamEvent({ type: 'text_delta', delta: 'answer.' });
          }
          return '## Summary\nTask completed successfully.\n\n## Key Findings\n- All good.';
        }) as any,
        estimateStepCost: jest.fn(() => 0),
        getProviderName: jest.fn(() => 'mock-gemini'),
        isAvailable: jest.fn(() => true),
      } as any;

      jest.spyOn(di, 'llm').mockReturnValue(mockLlm);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('requires structured output schema in synthesis prompt', async () => {
      const orchestrator = new OrchestratorAgent({ model: 'gemini-3.6-flash' });
      orchestrator.createState('Build authentication system');

      const subtasks: SubtaskResult[] = [
        {
          taskId: 'sub-1',
          description: 'Create user model',
          result: 'Added UserModel in src/models/user.ts',
          success: true,
        },
        {
          taskId: 'sub-2',
          description: 'Add JWT middleware',
          result: 'Failed: jwt dependency missing',
          success: false,
        },
      ];

      const result = await orchestrator.synthesizeResults('Build authentication system', subtasks);

      expect(result).toContain('## Summary');
      expect(mockLlm.createChatCompletion).toHaveBeenCalled();

      const prompt = capturedMessages[0]?.content || '';
      expect(prompt).toContain('ORIGINAL TASK:\n"Build authentication system"');
      expect(prompt).toContain('## Summary');
      expect(prompt).toContain('## Key Findings & Deliverables');
      expect(prompt).toContain('## Dependencies & Connections');
      expect(prompt).toContain('## Issues or Caveats');
      expect(prompt).toContain('## Next Steps');

      // Check that subtasks with status are in the prompt
      expect(prompt).toContain('1. Task: "Create user model" (ID: sub-1)\n   Status: ✅ COMPLETED');
      expect(prompt).toContain('2. Task: "Add JWT middleware" (ID: sub-2)\n   Status: ❌ FAILED');

      expect(orchestrator.getState()?.state).toBe('complete');
    });

    it('forwards onStreamEvent and streams output when options are provided', async () => {
      const orchestrator = new OrchestratorAgent({ model: 'gemini-3.6-flash' });
      orchestrator.createState('Refactor component tree');

      const streamedDeltas: string[] = [];
      const subtasks: SubtaskResult[] = [
        {
          taskId: 'sub-1',
          description: 'Extract header component',
          result: 'Created Header.tsx',
          success: true,
        },
      ];

      await orchestrator.synthesizeResults('Refactor component tree', subtasks, {
        onStreamEvent: (event) => {
          if (event.type === 'text_delta') {
            streamedDeltas.push(event.delta);
          }
        },
      });

      expect(capturedOptions?.stream).toBe(true);
      expect(streamedDeltas).toEqual(['Synthesized ', 'answer.']);
    });
  });
});
