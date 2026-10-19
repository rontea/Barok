/**
 * Tests for Phase 7.1 - Work Plan Generation Endpoint
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { Response } from 'express';
import {
  loadPhase2Context,
  sendSSEEvent,
  streamWorkPlanGeneration,
  handleWorkPlanRequest,
  type WorkPlanRequest,
  type WorkPlanStreamEvent
} from '../workPlanEndpoint.js';

describe('Phase 7.1 - Work Plan Generation Endpoint', () => {
  let mockRes: any;
  let eventsSent: WorkPlanStreamEvent[];

  beforeEach(() => {
    eventsSent = [];
    mockRes = {
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn((data: string) => {
        // Parse SSE event format: event: type\ndata: {...}\n\n
        const lines = data.split('\n');
        const eventType = lines[0]?.replace('event: ', '');
        const dataStr = lines[1]?.replace('data: ', '');
        if (eventType && dataStr) {
          try {
            const parsed = JSON.parse(dataStr);
            eventsSent.push({
              type: eventType as any,
              data: parsed.data,
              timestamp: parsed.timestamp
            });
          } catch (e) {
            // Ignore parse errors
          }
        }
      }),
      flush: jest.fn(),
      end: jest.fn(),
      get: jest.fn()
    };
  });

  describe('loadPhase2Context', () => {
    it('should load modules', async () => {
      const context = await loadPhase2Context();
      expect(context.modules).toBeDefined();
      expect(context.modules.length).toBeGreaterThan(0);
    });

    it('should include frontend module', async () => {
      const context = await loadPhase2Context();
      const frontend = context.modules.find(m => m.layer === 'frontend');
      expect(frontend).toBeDefined();
      expect(frontend?.layer).toBe('frontend');
    });

    it('should include backend module', async () => {
      const context = await loadPhase2Context();
      const backend = context.modules.find(m => m.name === 'backend');
      expect(backend).toBeDefined();
      expect(backend?.layer).toBe('backend');
    });

    it('should load dependency signals', async () => {
      const context = await loadPhase2Context();
      expect(context.signals).toBeDefined();
      expect(Array.isArray(context.signals)).toBe(true);
    });

    it('should load dirty tree state', async () => {
      const context = await loadPhase2Context();
      expect(context.dirtyTree).toBeDefined();
      expect(context.dirtyTree.files).toBeDefined();
      expect(typeof context.dirtyTree.totalChanges).toBe('number');
    });

    it('should include real repo map context', async () => {
      const context = await loadPhase2Context();
      expect(context.repoMap).toBeDefined();
      expect(context.repoMap?.workspace).toBeDefined();
    });
  });

  describe('sendSSEEvent', () => {
    it('should format SSE events correctly', () => {
      const event: WorkPlanStreamEvent = {
        type: 'planning-start',
        data: { test: 'value' }
      };

      sendSSEEvent(mockRes, event);

      expect(mockRes.write).toHaveBeenCalled();
      const call = (mockRes.write as any).mock.calls[0][0];
      expect(call).toContain('event: planning-start');
      expect(call).toContain('test');
    });

    it('should include timestamp in events', () => {
      const event: WorkPlanStreamEvent = {
        type: 'context-loaded',
        data: { message: 'test' }
      };

      sendSSEEvent(mockRes, event);

      expect(mockRes.write).toHaveBeenCalled();
      const call = (mockRes.write as any).mock.calls[0][0];
      expect(call).toContain('timestamp');
    });
  });

  describe('streamWorkPlanGeneration', () => {
    it('should require userRequest in request body', async () => {
      const req = { body: {} };
      await streamWorkPlanGeneration(req, mockRes);

      expect(mockRes.end).toHaveBeenCalled();
      const errorEvent = eventsSent.find(e => e.type === 'error');
      expect(errorEvent).toBeDefined();
    });

    it('should send planning-start event', async () => {
      const req = {
        body: {
          userRequest: 'Add new feature',
          affectedFiles: ['src/feature.ts']
        }
      };

      await streamWorkPlanGeneration(req, mockRes);

      const startEvent = eventsSent.find(e => e.type === 'planning-start');
      expect(startEvent).toBeDefined();
      expect(startEvent?.data.userRequest).toBe('Add new feature');
    });

    it('should send context-loading event', async () => {
      const req = {
        body: {
          userRequest: 'Fix bug',
          affectedFiles: []
        }
      };

      await streamWorkPlanGeneration(req, mockRes);

      const loadingEvent = eventsSent.find(e => e.type === 'context-loading');
      expect(loadingEvent).toBeDefined();
    });

    it('should send context-loaded event with counts', async () => {
      const req = {
        body: {
          userRequest: 'Refactor code',
          affectedFiles: []
        }
      };

      await streamWorkPlanGeneration(req, mockRes);

      const loadedEvent = eventsSent.find(e => e.type === 'context-loaded');
      expect(loadedEvent).toBeDefined();
      expect(loadedEvent?.data.moduleCount).toBeGreaterThan(0);
    });

    it('should send plan-created event', async () => {
      const req = {
        body: {
          userRequest: 'Add authentication',
          affectedFiles: ['src/auth.ts', 'ui/src/login.tsx']
        }
      };

      await streamWorkPlanGeneration(req, mockRes);

      const createdEvent = eventsSent.find(e => e.type === 'plan-created');
      expect(createdEvent).toBeDefined();
      expect(createdEvent?.data.planId).toBeDefined();
      expect(createdEvent?.data.classification).toBeDefined();
    });

    it('should send plan-validated event on success', async () => {
      const req = {
        body: {
          userRequest: 'Update documentation',
          affectedFiles: ['docs/README.md']
        }
      };

      await streamWorkPlanGeneration(req, mockRes);

      const validatedEvent = eventsSent.find(e => e.type === 'plan-validated');
      expect(validatedEvent).toBeDefined();
    });

    it('should send done event on success', async () => {
      const req = {
        body: {
          userRequest: 'Add unit tests',
          affectedFiles: ['src/utils.test.ts']
        }
      };

      await streamWorkPlanGeneration(req, mockRes);

      const doneEvent = eventsSent.find(e => e.type === 'done');
      expect(doneEvent).toBeDefined();
      expect(doneEvent?.data.success).toBe(true);
      expect(doneEvent?.data.plan).toBeDefined();
    });

    it('should allow broad investigation plans without affected files', async () => {
      const req = {
        body: {
          userRequest: 'investigate the current app architecture',
          affectedFiles: []
        }
      };

      await streamWorkPlanGeneration(req, mockRes);

      const errorEvent = eventsSent.find(e => e.type === 'error');
      const doneEvent = eventsSent.find(e => e.type === 'done');
      expect(errorEvent).toBeUndefined();
      expect(doneEvent).toBeDefined();
      expect(doneEvent?.data.plan.classification).toBe('investigation');
    });

    it('should set correct SSE headers', async () => {
      const req = { body: { userRequest: 'Test request' } };
      await streamWorkPlanGeneration(req, mockRes);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    });
  });

  describe('handleWorkPlanRequest', () => {
    it('should delegate to streamWorkPlanGeneration', async () => {
      const req = {
        body: {
          userRequest: 'Test delegation'
        }
      };

      await handleWorkPlanRequest(req, mockRes);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    });

    it('should handle errors gracefully', async () => {
      const req = {
        body: null
      };

      try {
        await handleWorkPlanRequest(req, mockRes);
      } catch (e) {
        // Expected
      }

      expect(mockRes.end).toHaveBeenCalled();
    });
  });

  describe('Event sequence validation', () => {
    it('should emit events in correct order', async () => {
      const req = {
        body: {
          userRequest: 'Fix authentication bug',
          affectedFiles: ['src/auth.ts']
        }
      };

      await streamWorkPlanGeneration(req, mockRes);

      const eventTypes = eventsSent.map(e => e.type);
      const expectedOrder = [
        'planning-start',
        'context-loading',
        'context-loaded',
        'plan-created',
        'plan-validated',
        'done'
      ];

      expectedOrder.forEach((expected, index) => {
        expect(eventTypes[index]).toBe(expected);
      });
    });

    it('should not emit error if plan is valid', async () => {
      const req = {
        body: {
          userRequest: 'Valid request',
          affectedFiles: ['src/test.ts']
        }
      };

      await streamWorkPlanGeneration(req, mockRes);

      const doneEvent = eventsSent.find(e => e.type === 'done');
      expect(doneEvent).toBeDefined();
    });
  });
});
