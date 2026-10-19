/**
 * CrewAI Coordinator Tests
 *
 * Tests cover:
 * - formatCrewFallbackOutput unit tests
 * - Integration test for crew synthesis fallback formatting when LLM synthesis fails
 */

import { jest, describe, it, expect } from '@jest/globals';
import { CrewCoordinator, formatCrewFallbackOutput } from '../crew';

describe('CrewAI Coordinator', () => {
  describe('formatCrewFallbackOutput', () => {
    it('returns a fallback message when task list is empty', () => {
      const output = formatCrewFallbackOutput([]);
      expect(output).toBe('No subtasks were executed.');
    });

    it('formats completed and failed subtasks into a structured numbered list', () => {
      const tasks = [
        {
          description: 'Design database schema',
          status: 'completed',
          result: 'Created migrations table and users schema.',
        },
        {
          description: 'Implement auth routes',
          status: 'completed',
          result: 'Implemented /login and /signup endpoints.',
        },
        {
          description: 'Run end-to-end integration tests',
          status: 'failed',
          result: 'Failed: Port 3000 already in use.',
        },
      ];

      const output = formatCrewFallbackOutput(tasks);

      expect(output).toContain('1. ✅ **Design database schema**');
      expect(output).toContain('Created migrations table and users schema.');
      expect(output).toContain('2. ✅ **Implement auth routes**');
      expect(output).toContain('Implemented /login and /signup endpoints.');
      expect(output).toContain('3. ❌ **Run end-to-end integration tests**');
      expect(output).toContain('Failed: Port 3000 already in use.');
    });

    it('truncates results that exceed maxResultLength and replaces newlines', () => {
      const longResult = 'A'.repeat(500);
      const tasks = [
        {
          description: 'Analyze large log file',
          status: 'completed',
          result: `Line 1\nLine 2\n${longResult}`,
        },
      ];

      const output = formatCrewFallbackOutput(tasks, 50);

      expect(output).toContain('1. ✅ **Analyze large log file**');
      expect(output).toContain('… [truncated]');
      expect(output).not.toContain('\nLine 2');
    });

    it('handles tasks with undefined or null result gracefully', () => {
      const tasks = [
        {
          description: 'Pending task',
          status: 'pending',
          result: null,
        },
      ];

      const output = formatCrewFallbackOutput(tasks);
      expect(output).toContain('1. ❌ **Pending task**');
      expect(output).toContain('No result');
    });
  });

  describe('orchestrateComplexTask synthesis fallback integration', () => {
    it('returns formatted numbered list when LLM synthesis fails', async () => {
      let callCount = 0;
      const mockLlm = {
        chatCompletion: jest.fn<any>().mockImplementation(async () => {
          callCount++;
          // First call is decomposeTask in orchestrateComplexTask
          if (callCount === 1) {
            return {
              content: JSON.stringify(['Setup repository structure', 'Configure build tools']),
            };
          }
          // Subsequent call is synthesisPrompt in orchestrateComplexTask -> simulate permanent failure
          throw new Error('401 Unauthorized: Invalid API key');
        }),
      };

      const coordinator = new CrewCoordinator(mockLlm as any, 'mock-model');

      // Mock the subtask execution agents so they don't invoke live subprocesses
      for (const [, agent] of (coordinator as any).agents.entries()) {
        jest.spyOn(agent, 'execute').mockImplementation(async (desc: string) => {
          return `Successfully executed: ${desc}`;
        });
      }

      const result = await coordinator.orchestrateComplexTask('Build application scaffold');

      // Verify that instead of throwing or returning raw unformatted text,
      // it returns the structured fallback numbered list
      expect(result).toContain('1. ✅ **Setup repository structure**');
      expect(result).toContain('Successfully executed: Setup repository structure');
      expect(result).toContain('2. ✅ **Configure build tools**');
      expect(result).toContain('Successfully executed: Configure build tools');
    });
  });
});
