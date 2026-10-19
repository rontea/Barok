/**
 * Phase 4.3 - Agent Router & Assignment
 * Routes tasks to appropriate agents based on Phase 3 work plans and Phase 1 capabilities
 */

import type { BoundedAgentTask } from './agentTasking.js';
import type { FullStackWorkPlan, ExecutionLayer } from '../repo/workPlanOrchestrator.js';
import type { AgentCapability } from '../agents/capabilities/capabilityDefinitions.js';

/**
 * Agent availability and workload information
 */
export interface AgentStatus {
  agentRole: BoundedAgentTask['agentRole'];
  isAvailable: boolean;
  currentWorkload: number; // 0-100 percentage
  activeTaskCount: number;
  maxConcurrentTasks: number;
  successRate: number; // 0-1
  lastUsedAt?: number;
}

/**
 * Routing decision with matching score and alternative agents
 */
export interface RoutingDecision {
  selectedAgent: BoundedAgentTask['agentRole'];
  score: number; // 0-100
  reasoning: string;
  alternativeAgents: Array<{
    agent: BoundedAgentTask['agentRole'];
    score: number;
    reason: string;
  }>;
  requiresEscalation: boolean;
  escalationReason?: string;
}

/**
 * Routing compatibility check result
 */
export interface CompatibilityCheck {
  compatible: boolean;
  missingCapabilities: string[];
  fileOwnershipMatches: boolean;
  layerCoverage: ExecutionLayer[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  warnings: string[];
}

/**
 * Agent capability matcher interface
 */
interface CapabilityMatcher {
  agent: BoundedAgentTask['agentRole'];
  capabilities: string[];
  preferredLayers: ExecutionLayer[];
  toolset: string[];
  maxFilesPerTask: number;
  successThreshold: number;
}

/**
 * Define agent capability profiles
 */
const AGENT_PROFILES: Record<BoundedAgentTask['agentRole'], CapabilityMatcher> = {
  frontend: {
    agent: 'frontend',
    capabilities: ['component_creation', 'styling', 'accessibility', 'state_management'],
    preferredLayers: ['frontend'],
    toolset: ['typescript', 'react', 'css', 'playwright'],
    maxFilesPerTask: 20,
    successThreshold: 0.85,
  },
  backend: {
    agent: 'backend',
    capabilities: ['route_creation', 'service_creation', 'validation', 'security'],
    preferredLayers: ['backend'],
    toolset: ['typescript', 'nodejs', 'database', 'api'],
    maxFilesPerTask: 15,
    successThreshold: 0.9,
  },
  data: {
    agent: 'data',
    capabilities: ['schema_creation', 'migrations', 'persistence', 'seeding'],
    preferredLayers: ['data'],
    toolset: ['typescript', 'database', 'migrations', 'sql'],
    maxFilesPerTask: 10,
    successThreshold: 0.95,
  },
  test: {
    agent: 'test',
    capabilities: ['unit_tests', 'integration_tests', 'browser_tests', 'coverage'],
    preferredLayers: ['tests'],
    toolset: ['typescript', 'jest', 'playwright', 'testing'],
    maxFilesPerTask: 25,
    successThreshold: 0.88,
  },
  reviewer: {
    agent: 'reviewer',
    capabilities: ['code_quality', 'security', 'testing_review'],
    preferredLayers: ['frontend', 'backend', 'tests'],
    toolset: ['typescript', 'linting', 'security-scan', 'testing'],
    maxFilesPerTask: 50,
    successThreshold: 0.92,
  },
  documentation: {
    agent: 'documentation',
    capabilities: ['api_docs', 'readme', 'usage_examples'],
    preferredLayers: ['docs'],
    toolset: ['markdown', 'typedoc', 'swagger', 'templates'],
    maxFilesPerTask: 30,
    successThreshold: 0.85,
  },
};

/**
 * Maps work plan classification to optimal agents
 */
const CLASSIFICATION_TO_AGENTS: Record<string, BoundedAgentTask['agentRole'][]> = {
  bug_fix: ['backend', 'frontend', 'test'],
  feature: ['backend', 'frontend', 'data', 'test'],
  refactor: ['backend', 'frontend', 'test'],
  test_only: ['test'],
  docs_only: ['documentation'],
  infrastructure: ['backend', 'data'],
  generated_app: ['frontend', 'backend'],
  investigation: ['reviewer'],
};

/**
 * Routes a task to the most appropriate agent
 */
export function routeTask(
  task: BoundedAgentTask,
  workPlan: FullStackWorkPlan,
  agentStatus: Map<BoundedAgentTask['agentRole'], AgentStatus>
): RoutingDecision {
  const candidates = CLASSIFICATION_TO_AGENTS[task.classification] || [
    'backend',
    'frontend',
    'test',
  ];

  const scores: Array<{
    agent: BoundedAgentTask['agentRole'];
    score: number;
    reason: string;
  }> = [];

  // Score each candidate agent
  for (const agent of candidates) {
    const profile = AGENT_PROFILES[agent];
    const status = agentStatus.get(agent);

    if (!status) {
      scores.push({ agent, score: 0, reason: 'Agent status unknown' });
      continue;
    }

    let score = 50; // Base score

    // Capability match (up to +20 points)
    const taskKeywords = task.userRequest.toLowerCase();
    const capabilityMatches = profile.capabilities.filter((cap) =>
      taskKeywords.includes(cap.replace('_', ' '))
    ).length;
    score += (capabilityMatches / profile.capabilities.length) * 20;

    // Layer coverage (up to +15 points)
    const layerMatches = task.touchedLayers.filter((layer) =>
      profile.preferredLayers.includes(layer)
    ).length;
    score += (layerMatches / Math.max(task.touchedLayers.length, 1)) * 15;

    // Agent availability (up to +20 points)
    if (status.isAvailable) {
      score += 20 - (status.currentWorkload / 100) * 10;
    } else {
      score -= 15;
    }

    // Success rate (up to +15 points)
    score += status.successRate * 15;

    // File count compatibility (up to +15 points)
    const expectedFileCount = task.expectedOutputs.changedFiles.length;
    if (expectedFileCount <= profile.maxFilesPerTask) {
      score += 15;
    } else {
      score -= Math.min((expectedFileCount / profile.maxFilesPerTask) * 10, 20);
    }

    scores.push({
      agent,
      score: Math.max(0, Math.min(100, score)),
      reason: `Capability match: ${capabilityMatches}/${profile.capabilities.length}, Layers: ${layerMatches}, Availability: ${status.currentWorkload}%`,
    });
  }

  // Sort by score
  scores.sort((a, b) => b.score - a.score);

  const selectedScore = scores[0].score;
  const selectedAgent = scores[0].agent;

  // Determine if escalation is needed
  let requiresEscalation = false;
  let escalationReason: string | undefined;

  const selectedStatus = agentStatus.get(selectedAgent)!;
  if (selectedScore < 60) {
    requiresEscalation = true;
    escalationReason = `Low routing confidence (${selectedScore}%). Task may need manual review.`;
  } else if (!selectedStatus.isAvailable) {
    requiresEscalation = true;
    escalationReason = `Selected agent ${selectedAgent} is unavailable. May need alternative routing.`;
  }

  return {
    selectedAgent,
    score: selectedScore,
    reasoning: scores[0].reason,
    alternativeAgents: scores.slice(1, 3).map((s) => ({
      agent: s.agent,
      score: s.score,
      reason: s.reason,
    })),
    requiresEscalation,
    escalationReason,
  };
}

/**
 * Checks if an agent-task pairing is compatible
 */
export function checkCompatibility(
  task: BoundedAgentTask,
  agent: BoundedAgentTask['agentRole']
): CompatibilityCheck {
  const profile = AGENT_PROFILES[agent];
  const warnings: string[] = [];
  const missingCapabilities: string[] = [];

  // Check file type compatibility
  const unsupportedTypes = task.expectedOutputs.fileTypes.filter(
    (type) => !profile.toolset.some((tool) => tool.includes(type))
  );

  if (unsupportedTypes.length > 0) {
    missingCapabilities.push(`File types: ${unsupportedTypes.join(', ')}`);
  }

  // Check layer coverage
  const layerCoverage = task.touchedLayers.filter((layer) =>
    profile.preferredLayers.includes(layer)
  );

  if (layerCoverage.length < task.touchedLayers.length) {
    const uncoveredLayers = task.touchedLayers.filter(
      (l) => !profile.preferredLayers.includes(l)
    );
    warnings.push(`Agent does not typically handle layers: ${uncoveredLayers.join(', ')}`);
  }

  // Check file ownership
  const ownedFiles = task.ownedFiles;
  const fileOwnershipMatches = ownedFiles.length > 0;

  if (!fileOwnershipMatches) {
    warnings.push('Task has no clearly owned files');
  }

  // Determine risk level
  let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';

  if (missingCapabilities.length > 0) {
    riskLevel = 'high';
  } else if (warnings.length > 1) {
    riskLevel = 'medium';
  } else if (task.touchedLayers.length > 3) {
    riskLevel = 'medium';
  }

  return {
    compatible: missingCapabilities.length === 0 && layerCoverage.length > 0,
    missingCapabilities,
    fileOwnershipMatches,
    layerCoverage,
    riskLevel,
    warnings,
  };
}

/**
 * Creates initial agent status map
 */
export function createAgentStatusMap(): Map<BoundedAgentTask['agentRole'], AgentStatus> {
  const statusMap = new Map<BoundedAgentTask['agentRole'], AgentStatus>();

  const roles: BoundedAgentTask['agentRole'][] = ['frontend', 'backend', 'data', 'test', 'reviewer', 'documentation'];

  for (const role of roles) {
    statusMap.set(role, {
      agentRole: role,
      isAvailable: true,
      currentWorkload: 0,
      activeTaskCount: 0,
      maxConcurrentTasks: 3,
      successRate: 0.9,
    });
  }

  return statusMap;
}

/**
 * Updates agent status based on task assignment
 */
export function updateAgentWorkload(
  statusMap: Map<BoundedAgentTask['agentRole'], AgentStatus>,
  agentRole: BoundedAgentTask['agentRole'],
  taskFileCount: number
): Map<BoundedAgentTask['agentRole'], AgentStatus> {
  const status = statusMap.get(agentRole);
  if (!status) return statusMap;

  const updated = { ...status };
  updated.activeTaskCount += 1;
  updated.currentWorkload = Math.min(
    100,
    (updated.activeTaskCount / updated.maxConcurrentTasks) * 100 +
      (taskFileCount / 50) * 10
  );
  updated.isAvailable = updated.activeTaskCount < updated.maxConcurrentTasks;

  const newMap = new Map(statusMap);
  newMap.set(agentRole, updated);
  return newMap;
}

/**
 * Checks if agent can accept more tasks
 */
export function canAgentAcceptTask(
  status: AgentStatus,
  taskComplexity: BoundedAgentTask['complexity']
): boolean {
  if (!status.isAvailable) return false;

  const complexityWeights: Record<BoundedAgentTask['complexity'], number> = {
    trivial: 10,
    simple: 25,
    moderate: 50,
    complex: 75,
    expert: 100,
  };

  const taskWeight = complexityWeights[taskComplexity];
  const projectedWorkload = status.currentWorkload + taskWeight;

  return projectedWorkload <= 100;
}

/**
 * Attempts to find alternative agent if primary is unavailable
 */
export function findAlternativeAgent(
  decision: RoutingDecision,
  agentStatus: Map<BoundedAgentTask['agentRole'], AgentStatus>,
  task: BoundedAgentTask
): BoundedAgentTask['agentRole'] | undefined {
  // First try alternatives from the routing decision
  for (const alt of decision.alternativeAgents) {
    const status = agentStatus.get(alt.agent);
    if (status && canAgentAcceptTask(status, task.complexity)) {
      return alt.agent;
    }
  }

  // Try any available agent
  for (const [agent, status] of agentStatus) {
    if (agent !== decision.selectedAgent && canAgentAcceptTask(status, task.complexity)) {
      return agent;
    }
  }

  return undefined;
}
