/**
 * Tests for Full-Stack Agent Capabilities (Phase 1)
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  getCapabilitiesForRole,
  getAllCapabilities,
  getCapabilitiesByLayer,
  getCapabilitiesByTool,
  FRONTEND_CAPABILITIES,
  BACKEND_CAPABILITIES,
  DATA_CAPABILITIES,
  TEST_CAPABILITIES,
  REVIEWER_CAPABILITIES,
  DOCUMENTATION_CAPABILITIES,
} from '../capabilityDefinitions.js';
import {
  selectAgentsForTask,
  selectAgentsForRequest,
  routeSubtasks,
  suggestCollaborationPath,
} from '../agentSelection.js';
import {
  createCollaborationAgreement,
  createAgentHandoff,
  CollaborationProtocol,
  resolveAgentConflict,
  EscalationManager,
  CoordinationStateTracker,
} from '../collaborationProtocol.js';
import { FullStackTaskSpec } from '../../../tasks/taskSpec.js';

describe('Phase 1: Full-Stack Agent Capabilities', () => {
  it('routes request-only runtime input through the typed task contract', () => {
    expect(selectAgentsForRequest('Fix the backend API bug').primaryAgents[0]).toBe('backend');
    expect(selectAgentsForRequest('Add unit test coverage for the API').primaryAgents[0]).toBe('test');
    expect(selectAgentsForRequest('Update the README documentation').primaryAgents[0]).toBe('documentation');
  });

  describe('Capability Definitions', () => {
    it('should have frontend capabilities', () => {
      expect(FRONTEND_CAPABILITIES.length).toBeGreaterThan(0);
      expect(FRONTEND_CAPABILITIES.map(c => c.name)).toContain('Create React Components');
    });

    it('should have backend capabilities', () => {
      expect(BACKEND_CAPABILITIES.length).toBeGreaterThan(0);
      expect(BACKEND_CAPABILITIES.map(c => c.name)).toContain('Create API Routes');
    });

    it('should have data capabilities', () => {
      expect(DATA_CAPABILITIES.length).toBeGreaterThan(0);
      expect(DATA_CAPABILITIES.map(c => c.name)).toContain('Create Database Schemas');
    });

    it('should have test capabilities', () => {
      expect(TEST_CAPABILITIES.length).toBeGreaterThan(0);
      expect(TEST_CAPABILITIES.map(c => c.name)).toContain('Create Unit Tests');
    });

    it('should have reviewer capabilities', () => {
      expect(REVIEWER_CAPABILITIES.length).toBeGreaterThan(0);
      expect(REVIEWER_CAPABILITIES.map(c => c.name)).toContain('Review Code Quality');
    });

    it('should have documentation capabilities', () => {
      expect(DOCUMENTATION_CAPABILITIES.length).toBeGreaterThan(0);
      expect(DOCUMENTATION_CAPABILITIES.map(c => c.name)).toContain('Create API Documentation');
    });

    it('should retrieve capabilities for specific role', () => {
      const frontendCaps = getCapabilitiesForRole('frontend');
      expect(frontendCaps).toEqual(FRONTEND_CAPABILITIES);

      const backendCaps = getCapabilitiesForRole('backend');
      expect(backendCaps).toEqual(BACKEND_CAPABILITIES);
    });

    it('should get all capabilities', () => {
      const allCaps = getAllCapabilities();
      expect(allCaps.length).toBe(
        FRONTEND_CAPABILITIES.length +
          BACKEND_CAPABILITIES.length +
          DATA_CAPABILITIES.length +
          TEST_CAPABILITIES.length +
          REVIEWER_CAPABILITIES.length +
          DOCUMENTATION_CAPABILITIES.length
      );
    });

    it('should find capabilities by layer', () => {
      const frontendLayerCaps = getCapabilitiesByLayer('frontend');
      expect(frontendLayerCaps.length).toBeGreaterThan(0);
      expect(frontendLayerCaps.every(c => c.affectedLayers.includes('frontend'))).toBe(true);
    });

    it('should find capabilities by tool', () => {
      const writeCaps = getCapabilitiesByTool('write');
      expect(writeCaps.length).toBeGreaterThan(0);
      expect(writeCaps.every(c => c.requiredTools.includes('write'))).toBe(true);
    });

    it('should have valid capability structure', () => {
      const caps = getAllCapabilities();
      for (const cap of caps) {
        expect(cap.id).toBeTruthy();
        expect(cap.name).toBeTruthy();
        expect(cap.description).toBeTruthy();
        expect(cap.agentRole).toBeTruthy();
        expect(cap.affectedLayers).toBeDefined();
        expect(cap.requiredTools).toBeDefined();
        expect(cap.complexity).toMatch(/trivial|simple|moderate|complex|expert/);
        expect(cap.minConfidence).toBeGreaterThanOrEqual(0);
        expect(cap.minConfidence).toBeLessThanOrEqual(1);
        expect(cap.preconditions.length).toBeGreaterThanOrEqual(0);
        expect(cap.successCriteria.length).toBeGreaterThanOrEqual(0);
        expect(cap.failureStrategies.length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Agent Selection', () => {
    it('should select frontend agent for frontend feature', () => {
      const task: FullStackTaskSpec = {
        id: 'task-1',
        title: 'Create Dashboard Component',
        description: 'Build new dashboard UI',
        userRequest: 'add feature',
        targetSurfaces: [],
        affectedFiles: ['ui/src/**'],
        acceptanceCriteria: [],
        verificationPlan: { criteria: [], commands: [] },
        classification: 'feature',
        touchedLayers: ['frontend'],
        ownershipPlan: [{ path: 'ui/src/**', owner: 'frontend', readOnly: false }],
        canRunInParallel: true,
        parallelCompatibleWith: [],
        dependencies: [],
        implementationOrder: [],
        verificationTasks: [],
        sequentialSteps: [],
        estimatedComplexity: 'moderate',
        requiresManualReview: false,
        createdAt: Date.now(),
      };

      const selection = selectAgentsForTask(task);
      expect(selection.primaryAgents).toContain('frontend');
      expect(selection.confidence).toBeGreaterThan(0.5);
    });

    it('should select backend agent for backend feature', () => {
      const task: FullStackTaskSpec = {
        id: 'task-2',
        title: 'Create API Endpoint',
        description: 'Build user API',
        userRequest: 'add feature',
        targetSurfaces: [],
        affectedFiles: ['src/routes/**'],
        acceptanceCriteria: [],
        verificationPlan: { criteria: [], commands: [] },
        classification: 'feature',
        touchedLayers: ['backend'],
        ownershipPlan: [{ path: 'src/routes/**', owner: 'backend', readOnly: false }],
        canRunInParallel: true,
        parallelCompatibleWith: [],
        dependencies: [],
        implementationOrder: [],
        verificationTasks: [],
        sequentialSteps: [],
        estimatedComplexity: 'moderate',
        requiresManualReview: false,
        createdAt: Date.now(),
      };

      const selection = selectAgentsForTask(task);
      expect(selection.primaryAgents).toContain('backend');
    });

    it('should select test agent for test-only task', () => {
      const task: FullStackTaskSpec = {
        id: 'task-3',
        title: 'Add unit tests',
        description: 'Improve test coverage',
        userRequest: 'test',
        targetSurfaces: [],
        affectedFiles: ['src/**/__tests__/**'],
        acceptanceCriteria: [],
        verificationPlan: { criteria: [], commands: [] },
        classification: 'test_only',
        touchedLayers: ['tests'],
        ownershipPlan: [],
        canRunInParallel: true,
        parallelCompatibleWith: [],
        dependencies: [],
        implementationOrder: [],
        verificationTasks: [],
        sequentialSteps: [],
        estimatedComplexity: 'simple',
        requiresManualReview: false,
        createdAt: Date.now(),
      };

      const selection = selectAgentsForTask(task);
      expect(selection.primaryAgents).toContain('test');
    });

    it('should include supporting agents for features', () => {
      const task: FullStackTaskSpec = {
        id: 'task-4',
        title: 'Add new feature',
        description: 'Full feature',
        userRequest: 'add feature',
        targetSurfaces: [],
        affectedFiles: ['ui/src/**', 'src/**'],
        acceptanceCriteria: [],
        verificationPlan: { criteria: [], commands: [] },
        classification: 'feature',
        touchedLayers: ['frontend', 'backend'],
        ownershipPlan: [],
        canRunInParallel: true,
        parallelCompatibleWith: [],
        dependencies: [],
        implementationOrder: [],
        verificationTasks: [],
        sequentialSteps: [],
        estimatedComplexity: 'complex',
        requiresManualReview: false,
        createdAt: Date.now(),
      };

      const selection = selectAgentsForTask(task);
      expect(selection.supportingAgents.length).toBeGreaterThan(0);
      expect(selection.verificationAgents).toContain('reviewer');
    });

    it('should identify selection risks', () => {
      const task: FullStackTaskSpec = {
        id: 'task-5',
        title: 'Complex task',
        description: 'Touch many layers',
        userRequest: 'test',
        targetSurfaces: [],
        affectedFiles: [],
        acceptanceCriteria: [],
        verificationPlan: { criteria: [], commands: [] },
        classification: 'feature',
        touchedLayers: ['frontend', 'backend', 'data', 'tests', 'docs'],
        ownershipPlan: [],
        canRunInParallel: true,
        parallelCompatibleWith: [],
        dependencies: [],
        implementationOrder: [],
        verificationTasks: [],
        sequentialSteps: [],
        estimatedComplexity: 'complex',
        requiresManualReview: false,
        createdAt: Date.now(),
      };

      const selection = selectAgentsForTask(task);
      expect(selection.risks.length).toBeGreaterThan(0);
    });

    it('should route subtasks to appropriate agents', () => {
      const task: FullStackTaskSpec = {
        id: 'task-6',
        title: 'Full stack feature',
        description: '',
        userRequest: '',
        targetSurfaces: [],
        affectedFiles: [],
        acceptanceCriteria: [],
        verificationPlan: { criteria: [], commands: [] },
        classification: 'feature',
        touchedLayers: [],
        ownershipPlan: [],
        canRunInParallel: true,
        parallelCompatibleWith: [],
        dependencies: [],
        implementationOrder: [],
        verificationTasks: [],
        sequentialSteps: [],
        estimatedComplexity: 'moderate',
        requiresManualReview: false,
        createdAt: Date.now(),
      };

      const subtasks = [
        {
          id: 'sub-1',
          description: 'Create component',
          affectedFiles: ['ui/src/component.tsx'],
          layer: 'frontend',
        },
        {
          id: 'sub-2',
          description: 'Create API route',
          affectedFiles: ['src/routes/api.ts'],
          layer: 'backend',
        },
        {
          id: 'sub-3',
          description: 'Create tests',
          affectedFiles: ['src/__tests__/api.test.ts'],
          layer: 'tests',
        },
      ];

      const routing = routeSubtasks(task, subtasks);
      expect(routing.has('frontend')).toBe(true);
      expect(routing.has('backend')).toBe(true);
      expect(routing.has('test')).toBe(true);
    });

    it('should suggest collaboration phases', () => {
      const agents = ['frontend', 'backend', 'data', 'test', 'reviewer'];
      const phases = suggestCollaborationPath(agents);

      expect(phases.length).toBeGreaterThan(0);
      expect(phases[0].phase).toBe(1);
      expect(phases.some(p => p.agents.includes('reviewer'))).toBe(true);
    });
  });

  describe('Collaboration Protocol', () => {
    let protocol: CollaborationProtocol;

    beforeEach(() => {
      protocol = new CollaborationProtocol();
    });

    it('should send message between agents', () => {
      const message = protocol.sendMessage(
        'frontend',
        ['backend'],
        'request',
        'Ready to integrate',
        'task-1'
      );

      expect(message.from).toBe('frontend');
      expect(message.to).toContain('backend');
      expect(message.requiresResponse).toBe(true);
    });

    it('should retrieve messages for agent', () => {
      protocol.sendMessage('frontend', ['backend'], 'request', 'Ready', 'task-1');
      protocol.sendMessage('test', ['backend'], 'status_update', 'Tests passed', 'task-1');

      const backendMessages = protocol.getMessagesForAgent('backend');
      expect(backendMessages.length).toBe(2);
    });

    it('should mark messages as read', () => {
      const message = protocol.sendMessage('frontend', ['backend'], 'request', 'Ready', 'task-1');
      protocol.markMessageAsRead(message.id);

      expect((message.metadata as Record<string, unknown>).read).toBe(true);
    });

    it('should create collaboration agreement', () => {
      const agreement = createCollaborationAgreement(
        ['frontend', 'backend'],
        'Build new feature',
        'task-1',
        {
          frontend: ['Build UI components'],
          backend: ['Create API endpoints'],
        }
      );

      expect(agreement.agentRoles).toContain('frontend');
      expect(agreement.agentRoles).toContain('backend');
      expect(agreement.status).toBe('active');
    });

    it('should establish and retrieve collaboration agreements', () => {
      const agreement = createCollaborationAgreement(
        ['frontend', 'backend'],
        'Build feature',
        'task-1',
        { frontend: ['UI'], backend: ['API'] }
      );

      protocol.establishAgreement(agreement);

      const agreements = protocol.getAgreementsForAgent('frontend');
      expect(agreements).toContain(agreement);
    });

    it('should create and acknowledge handoff', () => {
      const handoff = createAgentHandoff(
        'frontend',
        ['backend'],
        [
          { name: 'Component API', type: 'interface', status: 'ready' },
          { name: 'Props types', type: 'types', status: 'ready' },
        ],
        'Frontend component ready for backend integration'
      );

      expect(handoff.acknowledged).toBe(false);
      protocol.recordHandoff(handoff);
      protocol.acknowledgeHandoff(handoff.id);
      expect(handoff.acknowledged).toBe(true);
    });

    it('should retrieve communication history', () => {
      protocol.sendMessage('frontend', ['backend'], 'request', 'Ready', 'task-1');
      protocol.sendMessage('backend', ['frontend'], 'response', 'Integrated', 'task-1');

      const history = protocol.getCommunicationHistory('frontend', 'backend');
      expect(history.length).toBe(2);
    });
  });

  describe('Conflict Resolution', () => {
    it('should resolve ownership conflicts', () => {
      const conflict = resolveAgentConflict(
        'ownership',
        ['frontend', 'backend'],
        'Both agents claim ownership of utils'
      );

      expect(conflict.conflictType).toBe('ownership');
      expect(conflict.status).toBe('pending');
      expect(conflict.proposedResolution).toContain('expertise');
    });

    it('should resolve scheduling conflicts', () => {
      const conflict = resolveAgentConflict(
        'scheduling',
        ['test', 'reviewer'],
        'Both want to run simultaneously'
      );

      expect(conflict.conflictType).toBe('scheduling');
      expect(conflict.proposedResolution).toContain('sequentially');
    });

    it('should resolve resource conflicts', () => {
      const conflict = resolveAgentConflict(
        'resource',
        ['frontend', 'backend', 'data'],
        'Competing for database access'
      );

      expect(conflict.conflictType).toBe('resource');
      expect(conflict.proposedResolution).toContain('time-slicing');
    });
  });

  describe('Escalation Management', () => {
    let escalationManager: EscalationManager;

    beforeEach(() => {
      escalationManager = new EscalationManager();
    });

    it('should get escalation path for frontend agent', () => {
      const path = escalationManager.getEscalationPath('frontend');
      expect(path).toContain('reviewer');
      expect(path[path.length - 1]).toBe('human');
    });

    it('should get escalation path for backend agent', () => {
      const path = escalationManager.getEscalationPath('backend');
      expect(path).toContain('reviewer');
    });

    it('should escalate with context', () => {
      const result = escalationManager.escalate('frontend', 'Cannot complete task', {
        taskId: 'task-1',
      });

      expect(result.nextAgent).toBe('reviewer');
      expect((result.context as Record<string, unknown>).escalatedFrom).toBe('frontend');
      expect((result.context as Record<string, unknown>).taskId).toBe('task-1');
    });
  });

  describe('Coordination State Tracking', () => {
    let tracker: CoordinationStateTracker;

    beforeEach(() => {
      tracker = new CoordinationStateTracker();
    });

    it('should start in planning phase', () => {
      const state = tracker.getState();
      expect(state.phase).toBe('planning');
    });

    it('should transition through phases', () => {
      let result = tracker.transitionPhase('assignment');
      expect(result.success).toBe(true);

      result = tracker.transitionPhase('coordination');
      expect(result.success).toBe(true);

      const state = tracker.getState();
      expect(state.phase).toBe('coordination');
    });

    it('should prevent invalid transitions', () => {
      const result = tracker.transitionPhase('completion');
      expect(result.success).toBe(false);
    });

    it('should record and clear agent issues', () => {
      tracker.recordAgentIssue('frontend', 'Component failed to render');
      tracker.recordAgentIssue('frontend', 'Test timeout');

      let state = tracker.getState();
      expect(state.agentsWithIssues.get('frontend')).toHaveLength(2);

      tracker.clearAgentIssues('frontend');
      state = tracker.getState();
      expect(state.agentsWithIssues.get('frontend')).toBeUndefined();
    });
  });

  describe('Full Integration Scenarios', () => {
    it('should handle complete full-stack task workflow', () => {
      const task: FullStackTaskSpec = {
        id: 'task-integration',
        title: 'Add user profile feature',
        description: 'Complete user profile implementation',
        userRequest: 'add feature',
        targetSurfaces: ['Profile page', 'User API'],
        affectedFiles: ['ui/src/pages/**', 'src/routes/**', 'src/db/**'],
        acceptanceCriteria: [
          { description: 'Profile page renders', verifiable: true, required: true },
          { description: 'API returns user data', verifiable: true, required: true },
        ],
        verificationPlan: { criteria: [], commands: [] },
        classification: 'feature',
        touchedLayers: ['frontend', 'backend', 'data', 'tests'],
        ownershipPlan: [
          { path: 'ui/src/pages/profile.tsx', owner: 'frontend', readOnly: false },
          { path: 'src/routes/users.ts', owner: 'backend', readOnly: false },
          { path: 'src/db/migrations/**', owner: 'data', readOnly: false },
        ],
        canRunInParallel: true,
        parallelCompatibleWith: [],
        dependencies: [],
        implementationOrder: ['backend', 'frontend', 'test'],
        verificationTasks: [],
        sequentialSteps: [],
        estimatedComplexity: 'moderate',
        requiresManualReview: false,
        createdAt: Date.now(),
      };

      const selection = selectAgentsForTask(task);
      expect(selection.primaryAgents.length).toBeGreaterThan(0);
      expect(selection.verificationAgents).toContain('reviewer');
      expect(selection.confidence).toBeGreaterThan(0.5);

      const phases = suggestCollaborationPath(selection.primaryAgents);
      expect(phases.length).toBeGreaterThan(0);
      expect(phases[0].phase).toBe(1);
    });

    it('should handle agent collaboration for complex task', () => {
      const protocol = new CollaborationProtocol();
      const tracker = new CoordinationStateTracker();

      // Establish agreement
      const agreement = createCollaborationAgreement(
        ['frontend', 'backend', 'test'],
        'Implement feature',
        'task-integration',
        {
          frontend: ['Build UI'],
          backend: ['Create API'],
          test: ['Write tests'],
        }
      );

      protocol.establishAgreement(agreement);

      // Send status updates
      protocol.sendMessage('backend', ['frontend', 'test'], 'status_update', 'API ready', 'task-integration');
      protocol.sendMessage('frontend', ['backend'], 'confirmation', 'UI integrated', 'task-integration');

      // Transition through phases
      tracker.transitionPhase('assignment');
      tracker.transitionPhase('coordination');
      tracker.transitionPhase('execution');

      // Get final state
      const state = tracker.getState();
      expect(state.phase).toBe('execution');

      const messages = protocol.getMessagesForAgent('frontend');
      expect(messages.length).toBeGreaterThan(0);
    });
  });
});
