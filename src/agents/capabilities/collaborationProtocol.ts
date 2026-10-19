/**
 * Agent Collaboration Protocol
 * Defines how agents communicate, coordinate, and resolve conflicts
 */

/**
 * Represents communication between agents
 */
export interface AgentMessage {
  /** Unique message ID */
  id: string;

  /** Sender agent role */
  from: string;

  /** Recipient agent role(s) */
  to: string[];

  /** Message type */
  messageType:
    | 'request'
    | 'response'
    | 'status_update'
    | 'error'
    | 'confirmation'
    | 'escalation';

  /** Message content */
  content: string;

  /** References to task or execution ID */
  contextId: string;

  /** Message metadata */
  metadata: Record<string, unknown>;

  /** Timestamp */
  timestamp: number;

  /** Required response? */
  requiresResponse: boolean;
}

/**
 * Represents a collaboration agreement between agents
 */
export interface CollaborationAgreement {
  /** Unique agreement ID */
  id: string;

  /** Agents involved */
  agentRoles: string[];

  /** What this agreement covers */
  scope: string;

  /** Task or execution this agreement is for */
  contextId: string;

  /** Specific responsibilities per agent */
  responsibilities: Record<string, string[]>;

  /** Communication frequency */
  communicationFrequency: 'per_step' | 'per_phase' | 'on_change' | 'on_error';

  /** Escalation triggers */
  escalationTriggers: string[];

  /** Agreement status */
  status: 'active' | 'paused' | 'completed' | 'failed';

  /** Created at */
  createdAt: number;

  /** Expected completion */
  expectedCompletion: number;
}

/**
 * Represents a handoff between agents
 */
export interface AgentHandoff {
  /** Handoff ID */
  id: string;

  /** From agent */
  fromAgent: string;

  /** To agent(s) */
  toAgents: string[];

  /** What is being handed off */
  deliverables: Array<{
    name: string;
    type: string;
    status: 'ready' | 'pending' | 'failed';
  }>;

  /** Context and reasoning */
  context: string;

  /** Dependencies or assumptions */
  assumptions: string[];

  /** Expected next steps */
  expectedNextSteps: string[];

  /** Timestamp */
  timestamp: number;

  /** Acknowledgment from receiving agent */
  acknowledged: boolean;
}

/**
 * Creates collaboration agreement between agents
 */
export function createCollaborationAgreement(
  agentRoles: string[],
  scope: string,
  contextId: string,
  responsibilities: Record<string, string[]>
): CollaborationAgreement {
  return {
    id: `collab-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    agentRoles,
    scope,
    contextId,
    responsibilities,
    communicationFrequency: 'per_phase',
    escalationTriggers: [
      'Agent fails task',
      'Conflict detected',
      'Resource constraint',
      'Timeline risk',
    ],
    status: 'active',
    createdAt: Date.now(),
    expectedCompletion: Date.now() + 3600000, // 1 hour default
  };
}

/**
 * Creates agent handoff from one to another
 */
export function createAgentHandoff(
  fromAgent: string,
  toAgents: string[],
  deliverables: Array<{ name: string; type: string; status: 'ready' | 'pending' | 'failed' }>,
  context: string
): AgentHandoff {
  return {
    id: `handoff-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    fromAgent,
    toAgents,
    deliverables,
    context,
    assumptions: [],
    expectedNextSteps: [],
    timestamp: Date.now(),
    acknowledged: false,
  };
}

/**
 * Defines protocol for agent-to-agent communication
 */
export class CollaborationProtocol {
  private messages: AgentMessage[] = [];
  private agreements: Map<string, CollaborationAgreement> = new Map();
  private handoffs: AgentHandoff[] = [];

  /**
   * Sends a message between agents
   */
  sendMessage(
    from: string,
    to: string[],
    messageType: AgentMessage['messageType'],
    content: string,
    contextId: string
  ): AgentMessage {
    const message: AgentMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      from,
      to,
      messageType,
      content,
      contextId,
      metadata: {},
      timestamp: Date.now(),
      requiresResponse: messageType === 'request' || messageType === 'escalation',
    };

    this.messages.push(message);
    return message;
  }

  /**
   * Retrieves messages for an agent
   */
  getMessagesForAgent(agent: string, unreadOnly = false): AgentMessage[] {
    return this.messages.filter(
      m =>
        m.to.includes(agent) &&
        (!unreadOnly || !m.metadata.read)
    );
  }

  /**
   * Marks message as read
   */
  markMessageAsRead(messageId: string): void {
    const message = this.messages.find(m => m.id === messageId);
    if (message) {
      message.metadata.read = true;
    }
  }

  /**
   * Establishes collaboration agreement
   */
  establishAgreement(agreement: CollaborationAgreement): void {
    this.agreements.set(agreement.id, agreement);
  }

  /**
   * Gets active agreements for an agent
   */
  getAgreementsForAgent(agent: string): CollaborationAgreement[] {
    return Array.from(this.agreements.values()).filter(
      a => a.agentRoles.includes(agent) && a.status === 'active'
    );
  }

  /**
   * Records agent handoff
   */
  recordHandoff(handoff: AgentHandoff): void {
    this.handoffs.push(handoff);
  }

  /**
   * Acknowledges handoff receipt
   */
  acknowledgeHandoff(handoffId: string): boolean {
    const handoff = this.handoffs.find(h => h.id === handoffId);
    if (handoff) {
      handoff.acknowledged = true;
      return true;
    }
    return false;
  }

  /**
   * Gets communication history between agents
   */
  getCommunicationHistory(
    agent1: string,
    agent2: string,
    limit = 50
  ): AgentMessage[] {
    return this.messages
      .filter(
        m =>
          (m.from === agent1 && m.to.includes(agent2)) ||
          (m.from === agent2 && m.to.includes(agent1))
      )
      .slice(-limit);
  }
}

/**
 * Defines protocol for handling agent conflicts
 */
export interface ConflictResolution {
  /** Conflict ID */
  id: string;

  /** Type of conflict */
  conflictType:
    | 'ownership'
    | 'scheduling'
    | 'resource'
    | 'decision'
    | 'communication';

  /** Agents involved in conflict */
  agents: string[];

  /** Description of conflict */
  description: string;

  /** Proposed resolution */
  proposedResolution: string;

  /** Resolution status */
  status: 'pending' | 'accepted' | 'rejected' | 'escalated';

  /** Escalation path if rejected */
  escalationPath?: string[];

  /** Timestamp */
  timestamp: number;
}

/**
 * Resolves conflicts between agents
 */
export function resolveAgentConflict(
  conflictType: ConflictResolution['conflictType'],
  agents: string[],
  description: string
): ConflictResolution {
  let proposedResolution = '';

  switch (conflictType) {
    case 'ownership':
      proposedResolution = `Assign ownership based on expertise: ${agents.join(
        ' specializes in own area, '
      )} specializes in own area`;
      break;
    case 'scheduling':
      proposedResolution = `Execute tasks sequentially: ${agents[0]} first, then ${agents.slice(1).join(', ')}`;
      break;
    case 'resource':
      proposedResolution = `Share resources with time-slicing: ${agents.join(
        ' gets 30% time, '
      )} gets 30% time`;
      break;
    case 'decision':
      proposedResolution = `Review agent reasoning with human oversight`;
      break;
    case 'communication':
      proposedResolution = `Establish structured communication protocol with explicit message types`;
      break;
  }

  return {
    id: `conflict-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    conflictType,
    agents,
    description,
    proposedResolution,
    status: 'pending',
    timestamp: Date.now(),
  };
}

/**
 * Escalation path for agent conflicts
 */
export class EscalationManager {
  private escalationPaths: Map<string, string[]> = new Map([
    ['frontend', ['reviewer', 'backend', 'human']],
    ['backend', ['reviewer', 'data', 'human']],
    ['data', ['reviewer', 'backend', 'human']],
    ['test', ['reviewer', 'backend', 'human']],
    ['documentation', ['reviewer', 'human']],
    ['reviewer', ['human']],
  ]);

  /**
   * Gets escalation path for an agent
   */
  getEscalationPath(agent: string): string[] {
    return this.escalationPaths.get(agent) || ['human'];
  }

  /**
   * Escalates from one agent to next in chain
   */
  escalate(
    fromAgent: string,
    reason: string,
    context: Record<string, unknown>
  ): { nextAgent: string; reason: string; context: Record<string, unknown> } {
    const path = this.getEscalationPath(fromAgent);
    const nextAgent = path[0] || 'human';

    return {
      nextAgent,
      reason,
      context: {
        ...context,
        escalatedFrom: fromAgent,
        escalatedAt: Date.now(),
      },
    };
  }
}

/**
 * Agent coordination state machine
 */
export interface CoordinationState {
  /** Current phase */
  phase:
    | 'planning'
    | 'assignment'
    | 'coordination'
    | 'execution'
    | 'integration'
    | 'verification'
    | 'completion';

  /** Active agreements */
  activeAgreements: string[];

  /** Active handoffs pending acknowledgment */
  pendingHandoffs: string[];

  /** Unresolved conflicts */
  unresolvedConflicts: string[];

  /** Agents with issues */
  agentsWithIssues: Map<string, string[]>;

  /** Timestamp of last state change */
  lastStateChange: number;
}

/**
 * Coordination state tracker
 */
export class CoordinationStateTracker {
  private state: CoordinationState = {
    phase: 'planning',
    activeAgreements: [],
    pendingHandoffs: [],
    unresolvedConflicts: [],
    agentsWithIssues: new Map(),
    lastStateChange: Date.now(),
  };

  /**
   * Transitions to next phase
   */
  transitionPhase(
    newPhase: CoordinationState['phase']
  ): {
    success: boolean;
    message: string;
  } {
    // Validate phase transition
    const validTransitions: Record<string, CoordinationState['phase'][]> = {
      planning: ['assignment'],
      assignment: ['coordination'],
      coordination: ['execution'],
      execution: ['integration'],
      integration: ['verification'],
      verification: ['completion', 'execution'], // Can retry
      completion: ['planning'], // Can restart
    };

    const allowed = validTransitions[this.state.phase] || [];
    if (!allowed.includes(newPhase)) {
      return {
        success: false,
        message: `Cannot transition from ${this.state.phase} to ${newPhase}`,
      };
    }

    this.state.phase = newPhase;
    this.state.lastStateChange = Date.now();

    return {
      success: true,
      message: `Transitioned to phase: ${newPhase}`,
    };
  }

  /**
   * Gets current state
   */
  getState(): CoordinationState {
    return { ...this.state };
  }

  /**
   * Records agent issue
   */
  recordAgentIssue(agent: string, issue: string): void {
    if (!this.state.agentsWithIssues.has(agent)) {
      this.state.agentsWithIssues.set(agent, []);
    }
    this.state.agentsWithIssues.get(agent)!.push(issue);
  }

  /**
   * Clears agent issues when resolved
   */
  clearAgentIssues(agent: string): void {
    this.state.agentsWithIssues.delete(agent);
  }
}
