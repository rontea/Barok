/**
 * Agent Selection and Task Routing
 * Routes tasks to the most appropriate agent(s) based on requirements and capabilities
 */

import { createTaskSpec, FullStackTaskSpec } from '@barok/core';
import {
  AgentCapability,
  getAllCapabilities,
  getCapabilitiesForRole,
} from './capabilityDefinitions.js';

/**
 * Represents agent selection for a task
 */
export interface AgentSelection {
  /** Primary agent(s) to handle this task */
  primaryAgents: string[];

  /** Supporting/collaborating agents */
  supportingAgents: string[];

  /** Agents needed for verification */
  verificationAgents: string[];

  /** Capabilities required for this task */
  requiredCapabilities: string[];

  /** Confidence that selected agents can complete task (0-1) */
  confidence: number;

  /** Reasoning for agent selection */
  reasoning: string;

  /** Potential issues and mitigations */
  risks: Array<{
    issue: string;
    mitigation: string;
  }>;
}

/**
 * Selects the best agents to work on a task
 */
export function selectAgentsForTask(task: FullStackTaskSpec): AgentSelection {
  const allCapabilities = getAllCapabilities();
  const requiredCapabilities: AgentCapability[] = [];
  const selectedAgents = new Map<string, number>(); // role -> score

  // Score agents based on task characteristics
  scoreAgentsByClassification(task.classification, selectedAgents);
  scoreAgentsByLayers(task.touchedLayers, selectedAgents);
  scoreAgentsByOwnership(task.ownershipPlan, selectedAgents);

  // Select primary agents (score > 0.5)
  const primaryAgents = Array.from(selectedAgents.entries())
    .filter(([_, score]) => score > 0.5)
    .sort((a, b) => b[1] - a[1])
    .map(([role, _]) => role);

  // Add supporting agents if needed
  const supportingAgents = addSupportingAgents(primaryAgents, task);

  // Add verification agents
  const verificationAgents = selectVerificationAgents(primaryAgents, task);

  // Find matching capabilities
  for (const agent of primaryAgents) {
    const caps = getCapabilitiesForRole(agent);
    requiredCapabilities.push(
      ...caps.filter(cap =>
        task.affectedFiles.some(file =>
          file.includes(cap.affectedLayers[0] || '')
        )
      )
    );
  }

  // Calculate overall confidence
  const confidence = calculateSelectionConfidence(
    primaryAgents,
    requiredCapabilities,
    task
  );

  // Build reasoning
  const reasoning = buildSelectionReasoning(task, primaryAgents, supportingAgents);

  // Identify risks
  const risks = identifySelectionRisks(task, primaryAgents, supportingAgents);

  return {
    primaryAgents,
    supportingAgents,
    verificationAgents,
    requiredCapabilities: requiredCapabilities.map(c => c.id),
    confidence,
    reasoning,
    risks,
  };
}

/**
 * Build the canonical task contract for callers that only have a request
 * string, such as the legacy CLI crew entry point.
 */
export function selectAgentsForRequest(
  request: string,
  affectedFiles: string[] = [],
): AgentSelection {
  return selectAgentsForTask(createTaskSpec('Runtime task', request, affectedFiles));
}

/**
 * Scores agents based on task classification
 */
function scoreAgentsByClassification(
  classification: string,
  scores: Map<string, number>
): void {
  const scoreMap: Record<string, Record<string, number>> = {
    bug_fix: {
      backend: 0.8,
      frontend: 0.7,
      test: 0.7,
      data: 0.6,
      reviewer: 0.5,
    },
    feature: {
      frontend: 0.9,
      backend: 0.8,
      data: 0.7,
      test: 0.6,
      documentation: 0.4,
    },
    refactor: {
      backend: 0.8,
      frontend: 0.7,
      test: 0.7,
      data: 0.6,
      reviewer: 0.6,
    },
    test_only: {
      test: 0.95,
      backend: 0.5,
      frontend: 0.5,
    },
    docs_only: {
      documentation: 0.95,
      reviewer: 0.5,
    },
    infrastructure: {
      backend: 0.7,
      data: 0.6,
      reviewer: 0.5,
    },
    generated_app: {
      frontend: 0.9,
      backend: 0.5,
    },
    investigation: {
      reviewer: 0.8,
      backend: 0.5,
      frontend: 0.5,
    },
  };

  const classificationScores = scoreMap[classification] || {};
  for (const [role, score] of Object.entries(classificationScores)) {
    scores.set(role, (scores.get(role) || 0) + score);
  }
}

/**
 * Scores agents based on affected development layers
 */
function scoreAgentsByLayers(layers: string[], scores: Map<string, number>): void {
  const layerMap: Record<string, Record<string, number>> = {
    frontend: { frontend: 0.9, test: 0.4 },
    backend: { backend: 0.9, data: 0.5, test: 0.4 },
    data: { data: 0.9, backend: 0.5, test: 0.3 },
    tests: { test: 0.95 },
    docs: { documentation: 0.9 },
    config: { backend: 0.6, reviewer: 0.5 },
    cli: { backend: 0.8, test: 0.4 },
    vscode_extension: { frontend: 0.6, backend: 0.5, test: 0.5 },
  };

  for (const layer of layers) {
    const layerScores = layerMap[layer] || {};
    for (const [role, score] of Object.entries(layerScores)) {
      scores.set(role, (scores.get(role) || 0) + score);
    }
  }
}

/**
 * Scores agents based on file ownership plan
 */
function scoreAgentsByOwnership(
  ownershipPlan: any[],
  scores: Map<string, number>
): void {
  for (const plan of ownershipPlan) {
    if (plan.owner && !plan.readOnly) {
      scores.set(plan.owner, (scores.get(plan.owner) || 0) + 1.0);
    }
  }
}

/**
 * Adds supporting agents for specific task types
 */
function addSupportingAgents(primaryAgents: string[], task: FullStackTaskSpec): string[] {
  const supporting = new Set<string>();

  // Add test agent if modifying backend or frontend
  if (
    (primaryAgents.includes('backend') || primaryAgents.includes('frontend')) &&
    !primaryAgents.includes('test')
  ) {
    supporting.add('test');
  }

  // Add documentation agent if significant feature
  if (task.classification === 'feature' && !primaryAgents.includes('documentation')) {
    supporting.add('documentation');
  }

  // Add data agent if backend and database affected
  if (
    primaryAgents.includes('backend') &&
    task.affectedFiles.some(f => f.includes('migrations') || f.includes('seeds'))
  ) {
    supporting.add('data');
  }

  return Array.from(supporting);
}

/**
 * Selects agents for verification phase
 */
function selectVerificationAgents(
  primaryAgents: string[],
  task: FullStackTaskSpec
): string[] {
  const verification = new Set<string>();

  // Reviewer always verifies
  verification.add('reviewer');

  // Add test agent if not primary
  if (!primaryAgents.includes('test')) {
    verification.add('test');
  }

  // Add appropriate layer agents for verification
  if (task.touchedLayers.includes('frontend') && !primaryAgents.includes('frontend')) {
    verification.add('frontend');
  }

  if (task.touchedLayers.includes('backend') && !primaryAgents.includes('backend')) {
    verification.add('backend');
  }

  return Array.from(verification);
}

/**
 * Calculates confidence in agent selection
 */
function calculateSelectionConfidence(
  agents: string[],
  capabilities: AgentCapability[],
  task: FullStackTaskSpec
): number {
  let confidence = 0.5; // Base confidence

  // Add confidence if we have primary agents
  if (agents.length > 0) {
    confidence += 0.3;
  }

  // Add confidence if we have matching capabilities
  const matchingCapabilities = capabilities.filter(cap =>
    cap.affectedLayers.some((layer) => task.touchedLayers.includes(layer as typeof task.touchedLayers[number]))
  );

  if (matchingCapabilities.length > 0) {
    confidence += 0.2 * Math.min(1, matchingCapabilities.length / capabilities.length);
  }

  // Factor in task complexity
  const complexityMap: Record<string, number> = {
    trivial: 0.9,
    simple: 0.8,
    moderate: 0.7,
    complex: 0.6,
    expert: 0.5,
  };

  const complexityFactor = complexityMap[task.estimatedComplexity] || 0.5;
  confidence *= complexityFactor;

  return Math.min(1, confidence);
}

/**
 * Builds reasoning for agent selection
 */
function buildSelectionReasoning(
  task: FullStackTaskSpec,
  primaryAgents: string[],
  supportingAgents: string[]
): string {
  let reasoning = `Task: ${task.title}\n`;
  reasoning += `Classification: ${task.classification}\n`;
  reasoning += `Touched Layers: ${task.touchedLayers.join(', ')}\n\n`;

  reasoning += `Primary Agents: ${primaryAgents.join(', ') || 'None'}\n`;
  reasoning += 'Rationale: ';

  if (task.classification === 'feature') {
    reasoning += 'Feature development requires primary implementation agent + supporting test and docs agents. ';
  } else if (task.classification === 'bug_fix') {
    reasoning +=
      'Bug fixes require implementation agent with verification to ensure fix works without regressions. ';
  } else if (task.classification === 'test_only') {
    reasoning += 'Test-only tasks are handled by test agent. ';
  } else if (task.classification === 'docs_only') {
    reasoning += 'Documentation tasks are handled by documentation agent. ';
  }

  reasoning += `\nSupporting Agents: ${supportingAgents.join(', ') || 'None'}\n`;
  reasoning += 'These agents provide support for verification, documentation, or cross-layer concerns.\n';

  return reasoning;
}

/**
 * Identifies potential risks in agent selection
 */
function identifySelectionRisks(
  task: FullStackTaskSpec,
  primaryAgents: string[],
  supportingAgents: string[]
): Array<{ issue: string; mitigation: string }> {
  const risks: Array<{ issue: string; mitigation: string }> = [];

  // Risk: No primary agents selected
  if (primaryAgents.length === 0) {
    risks.push({
      issue: 'No primary agents selected for task',
      mitigation: 'Task may need manual routing or escalation to human',
    });
  }

  // Risk: Cross-layer complexity
  if (task.touchedLayers.length > 3) {
    risks.push({
      issue: 'Task touches many layers, increasing complexity',
      mitigation:
        'Ensure supporting agents are selected for coordination and verification',
    });
  }

  // Risk: Conflicting file ownership
  const ownerConflicts = new Map<string, Set<string>>();
  for (const plan of task.ownershipPlan) {
    if (!ownerConflicts.has(plan.path)) {
      ownerConflicts.set(plan.path, new Set());
    }
    ownerConflicts.get(plan.path)!.add(plan.owner);
  }

  for (const [path, owners] of ownerConflicts.entries()) {
    if (owners.size > 1) {
      risks.push({
        issue: `File ${path} has conflicting owners: ${Array.from(owners).join(', ')}`,
        mitigation: 'Resolve ownership conflict before task execution',
      });
    }
  }

  // Risk: No test verification
  if (
    !primaryAgents.includes('test') &&
    !supportingAgents.includes('test') &&
    task.classification !== 'docs_only'
  ) {
    risks.push({
      issue: 'No test agent assigned for verification',
      mitigation: 'Add test agent as supporting agent for verification phase',
    });
  }

  return risks;
}

/**
 * Routes subtasks to specific agents based on task breakdown
 */
export function routeSubtasks(
  task: FullStackTaskSpec,
  subtasks: Array<{
    id: string;
    description: string;
    affectedFiles: string[];
    layer: string;
  }>
): Map<string, Array<{ id: string; description: string; affectedFiles: string[] }>> {
  const routing = new Map<
    string,
    Array<{ id: string; description: string; affectedFiles: string[] }>
  >();

  // Map layers to agents
  const layerToAgent: Record<string, string> = {
    frontend: 'frontend',
    backend: 'backend',
    data: 'data',
    tests: 'test',
    docs: 'documentation',
    config: 'backend',
    cli: 'backend',
    vscode_extension: 'frontend',
  };

  for (const subtask of subtasks) {
    const agent = layerToAgent[subtask.layer] || 'backend';
    if (!routing.has(agent)) {
      routing.set(agent, []);
    }
    routing.get(agent)!.push(subtask);
  }

  return routing;
}

/**
 * Suggests agent collaboration paths for complex tasks
 */
export function suggestCollaborationPath(
  agents: string[]
): Array<{ phase: number; agents: string[]; description: string }> {
  const phases: Array<{ phase: number; agents: string[]; description: string }> = [];

  // Phase 1: Implementation by primary agents
  const primaryAgents = agents.filter(a => ['frontend', 'backend', 'data'].includes(a));
  if (primaryAgents.length > 0) {
    phases.push({
      phase: 1,
      agents: primaryAgents,
      description: 'Implementation: Primary agents work in parallel on their layers',
    });
  }

  // Phase 2: Testing
  if (agents.includes('test')) {
    phases.push({
      phase: 2,
      agents: ['test'],
      description: 'Testing: Verify implementation with unit and integration tests',
    });
  }

  // Phase 3: Review
  if (agents.includes('reviewer')) {
    phases.push({
      phase: 3,
      agents: ['reviewer'],
      description: 'Review: Code quality, security, and best practices review',
    });
  }

  // Phase 4: Documentation
  if (agents.includes('documentation')) {
    phases.push({
      phase: 4,
      agents: ['documentation'],
      description: 'Documentation: Update docs and examples',
    });
  }

  return phases;
}
