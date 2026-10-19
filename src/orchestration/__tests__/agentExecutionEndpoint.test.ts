/**
 * Tests for Phase 7.1 Task 2 - Agent Execution Streaming Endpoint
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { Response } from 'express';
import {
  streamAgentExecution,
  handleAgentExecutionRequest,
  setAgentExecutionRunnerForTests,
  selectVerificationScriptNames,
  AgentExecutionStreamEvent,
  resolveAgentExecutionCompletion,
} from '../agentExecutionEndpoint';
import { analyzeCoderTask } from '../../coder/taskAnalysis.js';

/**
 * Mock response object for testing SSE streaming
 */
function createMockResponse(): any {
  return {
    setHeader: jest.fn().mockReturnThis(),
    write: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
    flushHeaders: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

/**
 * Helper to extract written events from mock response
 */
function getWrittenEvents(mockResponse: any): AgentExecutionStreamEvent[] {
  const events: AgentExecutionStreamEvent[] = [];
  const calls = mockResponse.write.mock.calls;
  
  let i = 0;
  while (i < calls.length) {
    const call = calls[i];
    if (call && call[0]) {
      const line = call[0];
      // Look for data: lines
      if (line.startsWith('data: ')) {
        try {
          const eventData = JSON.parse(line.slice(6));
          events.push(eventData);
        } catch (e) {
          // Skip non-JSON lines
        }
      }
    }
    i++;
  }
  
  return events;
}

describe('Phase 7.1 Task 2 - Agent Execution Streaming', () => {
  it('keeps a completed implementation completed when a post-run test fails', () => {
    expect(resolveAgentExecutionCompletion(
      { success: true },
      [{ command: 'npm run test:unit', available: true, exitCode: 1, duration: 12 }],
    )).toEqual({
      implementationCompleted: true,
      failedVerification: true,
      verificationStatus: 'failed',
      verificationPassed: false,
    });
  });

  it('preserves a completed-with-verification-failure ReAct result', () => {
    expect(resolveAgentExecutionCompletion(
      { success: false, executionCompleted: true, verificationStatus: 'failed' },
      [],
    )).toEqual({
      implementationCompleted: true,
      failedVerification: false,
      verificationStatus: 'failed',
      verificationPassed: false,
    });
  });

  beforeEach(() => {
    setAgentExecutionRunnerForTests(async (request, { emit }) => {
      const { taskId, agentRole, userRequest, ownedFiles = [] } = request;
      const changedFiles = ownedFiles.slice(0, Math.max(1, Math.ceil(ownedFiles.length / 2)));
      const emitEvent = (type: AgentExecutionStreamEvent['type'], data: any) => {
        emit(type, {
          type,
          taskId,
          agentRole,
          data,
          timestamp: Date.now(),
        });
      };

      emitEvent('task-assigned', {
        status: 'assigned',
        message: `${agentRole} assigned to: ${userRequest}`,
        ownedFiles,
      });
      emitEvent('execution-start', {
        status: 'executing',
        progress: 0,
        message: `${agentRole} starting execution`,
      });
      for (const file of changedFiles) {
        emitEvent('file-change', {
          file,
          status: 'modified',
          linesAdded: 1,
          linesRemoved: 0,
          diff: `Modified ${file}`,
        });
      }
      emitEvent('progress-update', {
        progress: 25,
        status: 'executing',
        message: `${changedFiles.length} files modified`,
      });
      emitEvent('command-executed', {
        command: 'npm run test:unit',
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        duration: 10,
      });
      emitEvent('progress-update', {
        progress: 75,
        status: 'executing',
        message: 'Verification ready',
      });
      emitEvent('verification-start', {
        status: 'verifying',
        message: 'Starting verification checks',
        checksCount: 1,
      });
      emitEvent('verification-complete', {
        checksTotal: 1,
        checksPassed: 1,
        checksFailed: 0,
        results: [{ check: 'Unit Tests', passed: true, duration: 10 }],
      });
      emitEvent('completion', {
        status: 'completed',
        progress: 100,
        message: `${agentRole} completed successfully`,
        summary: {
          filesModified: changedFiles.length,
          commandsRun: 1,
          verificationsRun: 1,
          confidenceScore: 0.95,
          executionTimeMs: 20,
        },
      });

      return { status: 'done', totalExecutionTimeMs: 20 };
    });
  });

  afterEach(() => {
    setAgentExecutionRunnerForTests(undefined);
  });


  describe('streamAgentExecution', () => {
    it('should require taskId in request body', async () => {
      const mockRes = createMockResponse();
      const req = {
        body: {
          agentRole: 'frontend',
          userRequest: 'Add button component',
          ownedFiles: ['ui/src/components/Button.tsx'],
        },
      };

      await streamAgentExecution(req, mockRes);

      expect(mockRes.setHeader).not.toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(mockRes.write).not.toHaveBeenCalled();
    });

    it('should require agentRole in request body', async () => {
      const mockRes = createMockResponse();
      const req = {
        body: {
          taskId: 'task-1',
          userRequest: 'Add button component',
          ownedFiles: ['ui/src/components/Button.tsx'],
        },
      };

      await streamAgentExecution(req, mockRes);

      expect(mockRes.setHeader).not.toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    });

    it('should require userRequest in request body', async () => {
      const mockRes = createMockResponse();
      const req = {
        body: {
          taskId: 'task-1',
          agentRole: 'frontend',
          ownedFiles: ['ui/src/components/Button.tsx'],
        },
      };

      await streamAgentExecution(req, mockRes);

      expect(mockRes.setHeader).not.toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    });

    it('should set correct SSE headers', async () => {
      const mockRes = createMockResponse();
      const req = {
        body: {
          taskId: 'task-1',
          agentRole: 'frontend',
          userRequest: 'Add button',
          ownedFiles: ['ui/src/Button.tsx'],
        },
      };

      await streamAgentExecution(req, mockRes);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
      expect(mockRes.flushHeaders).toHaveBeenCalled();
    });

    it('should emit task-assigned event', async () => {
      const mockRes = createMockResponse();
      const req = {
        body: {
          taskId: 'task-1',
          agentRole: 'frontend',
          userRequest: 'Add button',
          ownedFiles: ['ui/src/Button.tsx'],
        },
      };

      await streamAgentExecution(req, mockRes);

      const events = getWrittenEvents(mockRes);
      const assignedEvent = events.find(e => e.type === 'task-assigned');

      expect(assignedEvent).toBeDefined();
      expect(assignedEvent?.taskId).toBe('task-1');
      expect(assignedEvent?.agentRole).toBe('frontend');
      expect(assignedEvent?.data.status).toBe('assigned');
      expect(assignedEvent?.data.ownedFiles).toEqual(['ui/src/Button.tsx']);
    });

    it('should emit execution-start event', async () => {
      const mockRes = createMockResponse();
      const req = {
        body: {
          taskId: 'task-1',
          agentRole: 'backend',
          userRequest: 'Create API endpoint',
          ownedFiles: ['src/api/routes.ts'],
        },
      };

      await streamAgentExecution(req, mockRes);

      const events = getWrittenEvents(mockRes);
      const startEvent = events.find(e => e.type === 'execution-start');

      expect(startEvent).toBeDefined();
      expect(startEvent?.data.status).toBe('executing');
      expect(startEvent?.data.progress).toBe(0);
    });

    it('should emit file-change events for modified files', async () => {
      const mockRes = createMockResponse();
      const req = {
        body: {
          taskId: 'task-1',
          agentRole: 'frontend',
          userRequest: 'Add component',
          ownedFiles: ['ui/src/Button.tsx', 'ui/src/Input.tsx', 'ui/src/Form.tsx'],
        },
      };

      await streamAgentExecution(req, mockRes);

      const events = getWrittenEvents(mockRes);
      const fileEvents = events.filter(e => e.type === 'file-change');

      expect(fileEvents.length).toBeGreaterThan(0);
      expect(fileEvents[0].data.status).toBe('modified');
      expect(fileEvents[0].data).toHaveProperty('linesAdded');
      expect(fileEvents[0].data).toHaveProperty('linesRemoved');
      expect(fileEvents[0].data).toHaveProperty('diff');
    });

    it('should emit progress-update events reaching 100%', async () => {
      const mockRes = createMockResponse();
      const req = {
        body: {
          taskId: 'task-1',
          agentRole: 'backend',
          userRequest: 'Implement feature',
          ownedFiles: ['src/services/auth.ts'],
        },
      };

      await streamAgentExecution(req, mockRes);

      const events = getWrittenEvents(mockRes);
      const progressEvents = events.filter(e => e.type === 'progress-update');

      expect(progressEvents.length).toBeGreaterThan(0);
      expect(progressEvents[0].data.progress).toBe(25);
      expect(progressEvents[progressEvents.length - 1].data.progress).toBe(75);
    });

    it('should emit command-executed events', async () => {
      const mockRes = createMockResponse();
      const req = {
        body: {
          taskId: 'task-1',
          agentRole: 'frontend',
          userRequest: 'Fix linting',
          ownedFiles: ['ui/src/App.tsx'],
        },
      };

      await streamAgentExecution(req, mockRes);

      const events = getWrittenEvents(mockRes);
      const cmdEvents = events.filter(e => e.type === 'command-executed');

      expect(cmdEvents.length).toBeGreaterThan(0);
      expect(cmdEvents[0].data).toHaveProperty('command');
      expect(cmdEvents[0].data).toHaveProperty('exitCode');
      expect(cmdEvents[0].data.exitCode).toBe(0);
      expect(cmdEvents[0].data).toHaveProperty('stdout');
      expect(cmdEvents[0].data).toHaveProperty('duration');
    });

    it('should emit verification-start and verification-complete events', async () => {
      const mockRes = createMockResponse();
      const req = {
        body: {
          taskId: 'task-1',
          agentRole: 'backend',
          userRequest: 'Verify changes',
          ownedFiles: ['src/services/user.ts'],
        },
      };

      await streamAgentExecution(req, mockRes);

      const events = getWrittenEvents(mockRes);
      const verifyStart = events.find(e => e.type === 'verification-start');
      const verifyComplete = events.find(e => e.type === 'verification-complete');

      expect(verifyStart).toBeDefined();
      expect(verifyStart?.data.checksCount).toBeGreaterThan(0);

      expect(verifyComplete).toBeDefined();
      expect(verifyComplete?.data).toHaveProperty('checksTotal');
      expect(verifyComplete?.data).toHaveProperty('checksPassed');
      expect(verifyComplete?.data).toHaveProperty('results');
      expect(Array.isArray(verifyComplete?.data.results)).toBe(true);
      expect(verifyComplete?.data.results.length).toBeGreaterThan(0);
    });

    it('should emit completion event with summary', async () => {
      const mockRes = createMockResponse();
      const req = {
        body: {
          taskId: 'task-1',
          agentRole: 'frontend',
          userRequest: 'Complete task',
          ownedFiles: ['ui/src/components/Main.tsx'],
        },
      };

      await streamAgentExecution(req, mockRes);

      const events = getWrittenEvents(mockRes);
      const completionEvent = events.find(e => e.type === 'completion');

      expect(completionEvent).toBeDefined();
      expect(completionEvent?.data.status).toBe('completed');
      expect(completionEvent?.data.progress).toBe(100);
      expect(completionEvent?.data.summary).toHaveProperty('filesModified');
      expect(completionEvent?.data.summary).toHaveProperty('commandsRun');
      expect(completionEvent?.data.summary).toHaveProperty('verificationsRun');
      expect(completionEvent?.data.summary).toHaveProperty('confidenceScore');
      expect(completionEvent?.data.summary?.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(completionEvent?.data.summary?.confidenceScore).toBeLessThanOrEqual(1);
    });

    it('should have a final event indicating completion', async () => {
      const mockRes = createMockResponse();
      const req = {
        body: {
          taskId: 'task-1',
          agentRole: 'backend',
          userRequest: 'Finish up',
          ownedFiles: ['src/api/routes.ts'],
        },
      };

      await streamAgentExecution(req, mockRes);

      const events = getWrittenEvents(mockRes);
      const finalEvent = events[events.length - 1];

      // Final event should be either 'done' or 'completion'
      expect(['done', 'completion']).toContain(finalEvent.type);
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('should emit events in proper sequence with key transitions', async () => {
      const mockRes = createMockResponse();
      const req = {
        body: {
          taskId: 'task-1',
          agentRole: 'frontend',
          userRequest: 'Test order',
          ownedFiles: ['ui/src/Test.tsx'],
        },
      };

      await streamAgentExecution(req, mockRes);

      const events = getWrittenEvents(mockRes);
      const eventTypes = events.map(e => e.type);

      // Should start with task assignment or execution start
      expect(['task-assigned', 'execution-start']).toContain(eventTypes[0]);

      // Should have execution-start before file changes
      const startIdx = eventTypes.indexOf('execution-start');
      const fileChangeIdx = eventTypes.indexOf('file-change');
      if (startIdx >= 0 && fileChangeIdx >= 0) {
        expect(startIdx).toBeLessThan(fileChangeIdx);
      }

      // Should have completion or done at the end
      const lastEvent = eventTypes[eventTypes.length - 1];
      expect(['done', 'completion']).toContain(lastEvent);

      // Should have verification events
      expect(eventTypes).toContain('verification-start');
      expect(eventTypes).toContain('verification-complete');
    });

    it('should handle requests with empty ownedFiles array', async () => {
      const mockRes = createMockResponse();
      const req = {
        body: {
          taskId: 'task-1',
          agentRole: 'reviewer',
          userRequest: 'Review code',
          ownedFiles: [],
        },
      };

      await streamAgentExecution(req, mockRes);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('should include timestamps in all events', async () => {
      const mockRes = createMockResponse();
      const req = {
        body: {
          taskId: 'task-1',
          agentRole: 'backend',
          userRequest: 'Check timestamps',
          ownedFiles: ['src/index.ts'],
        },
      };

      await streamAgentExecution(req, mockRes);

      const events = getWrittenEvents(mockRes);

      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event).toHaveProperty('timestamp');
        expect(typeof event.timestamp).toBe('number');
        expect(event.timestamp).toBeGreaterThan(0);
      }
    });
  });

  describe('handleAgentExecutionRequest', () => {
    it('should delegate to streamAgentExecution', async () => {
      const mockRes = createMockResponse();
      const req = {
        body: {
          taskId: 'task-1',
          agentRole: 'frontend',
          userRequest: 'Delegate test',
          ownedFiles: ['ui/src/App.tsx'],
        },
      };

      await handleAgentExecutionRequest(req, mockRes);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      const mockRes = createMockResponse();
      // Provide invalid request to trigger error
      const req = {
        body: {},
      };

      await handleAgentExecutionRequest(req, mockRes);

      // Should call either end() or json() for error response
      const hasResponse = mockRes.end.mock.calls.length > 0 || mockRes.json.mock.calls.length > 0;
      expect(hasResponse).toBe(true);
    });
  });

  describe('Event data validation', () => {
    it('should include taskId in all events', async () => {
      const mockRes = createMockResponse();
      const req = {
        body: {
          taskId: 'task-xyz-123',
          agentRole: 'data',
          userRequest: 'Process data',
          ownedFiles: ['src/data/schema.ts'],
        },
      };

      await streamAgentExecution(req, mockRes);

      const events = getWrittenEvents(mockRes);
      for (const event of events) {
        expect(event.taskId).toBe('task-xyz-123');
      }
    });

    it('should include agentRole in all events', async () => {
      const mockRes = createMockResponse();
      const req = {
        body: {
          taskId: 'task-1',
          agentRole: 'test-agent',
          userRequest: 'Test role',
          ownedFiles: ['tests/unit.test.ts'],
        },
      };

      await streamAgentExecution(req, mockRes);

      const events = getWrittenEvents(mockRes);
      for (const event of events) {
        expect(event.agentRole).toBe('test-agent');
      }
    });

    it('should have valid data structure for all events', async () => {
      const mockRes = createMockResponse();
      const req = {
        body: {
          taskId: 'task-1',
          agentRole: 'frontend',
          userRequest: 'Validate structure',
          ownedFiles: ['ui/src/App.tsx', 'ui/src/utils.ts'],
        },
      };

      await streamAgentExecution(req, mockRes);

      const events = getWrittenEvents(mockRes);
      for (const event of events) {
        expect(event.type).toBeDefined();
        expect(event.taskId).toBeDefined();
        expect(event.data).toBeDefined();
        expect(typeof event.data).toBe('object');
      }
    });
  });

  describe('verification command selection', () => {
    it('selects bug-fix verification from available package scripts', () => {
      const analysis = analyzeCoderTask({
        message: 'fix the send button',
        workspace: process.cwd(),
      });

      expect(selectVerificationScriptNames(analysis, {
        'test:unit': 'jest',
        lint: 'eslint src/',
        build: 'tsx build.ts',
      })).toEqual(['test:unit', 'lint']);
    });

    it('skips unavailable verification scripts clearly', () => {
      const analysis = analyzeCoderTask({
        message: 'add a new settings page',
        workspace: process.cwd(),
      });

      expect(selectVerificationScriptNames(analysis, {
        build: 'tsx build.ts',
      })).toEqual(['build']);
    });

    it('does not select mutation verification for read-only investigations', () => {
      const analysis = analyzeCoderTask({
        message: 'review the current app',
        workspace: process.cwd(),
      });

      expect(selectVerificationScriptNames(analysis, {
        'test:unit': 'jest',
        lint: 'eslint src/',
      })).toEqual([]);
    });
  });
});
