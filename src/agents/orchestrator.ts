/**
 * Primary Orchestrator Agent powered by Gemini 3.6 Flash
 * 
 * Responsibilities:
 * - Task planning and decomposition
 * - ReAct loop control and state management
 * - Intelligent delegation decisions
 * - Result synthesis and consolidation
 */

import { ReActEngine } from '../react/engine.js';
import { executeWithRetry, type RetryConfig } from '@barok/engine';
import { logger } from '../logging/structuredLogger.js';
import { AgentRole } from './crew.js';
import { SubAgentPool, type SubAgentExecutionResult } from './subagents.js';
import { di } from '../di/container.js';
import { selectAgentsForRequest } from './capabilities/agentSelection.js';
import { isNvidiaModel } from '../config/nvidiaModels.js';
import { isNvidiaTargetModelValue } from '../config/nvidiaTargets.js';
import { isOpenRouterFreeModel } from '../config/openRouterTargets.js';
import { getConfiguredCoderModelSelection } from '../config/coderModel.js';
import type { LLMCompletionStreamEvent } from '../di/types.js';

// ============================================================================
// ORCHESTRATOR STATE & TYPES
// ============================================================================

export interface SubtaskResult {
  taskId: string;
  description: string;
  result: string | null;
  success?: boolean;
}

export interface SynthesisOptions {
  onStreamEvent?: (event: LLMCompletionStreamEvent) => void;
}

export const MAX_SUBTASK_RESULT_LENGTH = 1500;

export function formatSubtaskResultsForPrompt(
  taskResults: SubtaskResult[],
  maxResultLength: number = MAX_SUBTASK_RESULT_LENGTH
): string {
  return taskResults
    .map((tr, idx) => {
      const isFailed = tr.success === false || tr.result === null || (typeof tr.result === 'string' && tr.result.startsWith('Failed:'));
      const status = isFailed ? '❌ FAILED' : '✅ COMPLETED';
      const rawResult = tr.result ?? 'No result produced';
      const resultText = rawResult.length > maxResultLength
        ? `${rawResult.slice(0, maxResultLength)}... [truncated]`
        : rawResult;
      return `${idx + 1}. Task: "${tr.description}" (ID: ${tr.taskId})\n   Status: ${status}\n   Result: ${resultText}`;
    })
    .join('\n\n');
}

export interface Task {
  id: string;
  description: string;
  objective?: string;
  complexity: 'low' | 'medium' | 'high';
  priority: number; // 1-10
  estimatedSteps: number;
  requiredCapabilities: AgentRole[];
  subAgentType?: 'code' | 'research' | 'tool' | 'reviewer' | 'documentation'; // NEW: Sub-agent specialization
  executionMode?: 'architect' | 'worker' | 'integrator' | 'reviewer' | 'tester' | 'documenter';
  ownedFiles?: string[];
  readOnlyContext?: string[];
  dependencies?: string[];
  acceptanceCriteria?: string[];
  integrationNotes?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  metadata?: Record<string, any>;
}

export interface DelegationDecision {
  taskId: string;
  assignedAgent: AgentRole;
  reasoning: string;
  fallbackAgents: AgentRole[];
  estimatedCost: number;
  confidence: number; // 0-1
}

export interface OrchestratorState {
  requestId: string;
  originalTask: string;
  startTime: number;
  state: 'planning' | 'delegating' | 'executing' | 'synthesizing' | 'complete' | 'failed';
  tasks: Task[];
  decisions: Map<string, DelegationDecision>;
  completedTasks: string[];
  failedTasks: string[];
  reactSteps: Array<{
    step: number;
    thought: string;
    action: AgentRole;
    observation: string;
  }>;
  synthesisInProgress: boolean;
}

// ============================================================================
// ORCHESTRATOR CONFIGURATION
// ============================================================================

interface OrchestratorConfig {
  model?: string;
  maxTasks?: number;
  maxReactSteps?: number;
  timeout?: number; // milliseconds
  verbose?: boolean;
  workspace?: string;
}

// ============================================================================
// PRIMARY ORCHESTRATOR AGENT
// ============================================================================

/**
 * Primary Orchestrator Agent using Gemini 3.6 Flash
 * 
 * This is the central intelligence that:
 * 1. Analyzes complex tasks and plans decomposition
 * 2. Manages the ReAct loop for orchestration decisions
 * 3. Makes intelligent delegation decisions
 * 4. Synthesizes results from multiple agents
 */
export class OrchestratorAgent {
  private config: Required<OrchestratorConfig>;
  private state: OrchestratorState | null = null;
  private reactEngine: ReActEngine;
  private subAgentPool: SubAgentPool; // NEW: Delegated sub-agent architecture

  constructor(config: OrchestratorConfig = {}) {
    this.config = {
      model: config.model || getConfiguredCoderModelSelection(),
      maxTasks: config.maxTasks || 20,
      maxReactSteps: config.maxReactSteps || 15,
      timeout: config.timeout || 300000, // 5 minutes
      verbose: config.verbose || false,
      workspace: config.workspace || process.cwd(),
    };

    this.reactEngine = new ReActEngine({
      model: this.config.model,
      maxSteps: this.config.maxReactSteps,
      verbose: this.config.verbose,
      workspace: this.config.workspace,
    });

    // NEW: Initialize specialized sub-agent pool
    this.subAgentPool = new SubAgentPool({
      model: this.config.model,
      verbose: this.config.verbose,
      workspace: this.config.workspace,
    });
  }

  private async createChatCompletion(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    options?: SynthesisOptions
  ): Promise<string> {
    return di.llm().createChatCompletion(messages, this.config.model, {
      pinModel: true,
      freeTierResilience: isNvidiaModel(this.config.model)
        || isNvidiaTargetModelValue(this.config.model)
        || isOpenRouterFreeModel(this.config.model),
      allowCrossProviderFallback: false,
      fallbackApprovalGranted: false,
      approvedFallbackProviders: [],
      sameProviderFallbackModels: [],
      stream: Boolean(options?.onStreamEvent),
      onStreamEvent: options?.onStreamEvent,
    });
  }

  /**
   * Initialize orchestrator state for a new task
   */
  private initializeState(originalTask: string): OrchestratorState {
    const requestId = logger.startRequest('orchestrator', { task: originalTask });
    
    return {
      requestId,
      originalTask,
      startTime: Date.now(),
      state: 'planning',
      tasks: [],
      decisions: new Map(),
      completedTasks: [],
      failedTasks: [],
      reactSteps: [],
      synthesisInProgress: false,
    };
  }

  /**
   * NEW: Determine appropriate sub-agent type for a task
   * 
   * Analyzes task description to route to the best specialized sub-agent:
   * - CodeAgent: coding, refactoring, debugging, implementation
   * - ResearchAgent: research, analysis, information gathering, summarization
   * - ToolAgent: filesystem operations, shell commands, system tasks
   * - ReviewerAgent: validation, review, quality checks, auditing
   * - DocumentationAgent: documentation updates, API docs, changelogs, migration guides
   */
  private determineSubAgentType(taskDescription: string, affectedFiles: string[] = []): 'code' | 'research' | 'tool' | 'reviewer' | 'documentation' {
    const typedSelection = selectAgentsForRequest(taskDescription, affectedFiles);
    const primaryAgent = typedSelection.primaryAgents[0];
    if (primaryAgent === 'documentation') return 'documentation';
    if (primaryAgent === 'reviewer' || primaryAgent === 'test') return 'reviewer';
    if (primaryAgent === 'frontend' || primaryAgent === 'backend' || primaryAgent === 'data') return 'code';

    // Compatibility fallback for requests that cannot produce a typed route.
    const desc = taskDescription.toLowerCase();

    // Documentation Agent keywords
    if (
      desc.includes('document') ||
      desc.includes('readme') ||
      desc.includes('changelog') ||
      desc.includes('api doc') ||
      desc.includes('architecture') ||
      desc.includes('install') ||
      desc.includes('example') ||
      desc.includes('outdated') ||
      desc.includes('migration') ||
      desc.includes('release note') ||
      desc.includes('feature') ||
      desc.includes('comment') ||
      desc.includes('sync')
    ) {
      return 'documentation';
    }

    // Code Agent keywords
    if (
      desc.includes('code') ||
      desc.includes('write') ||
      desc.includes('implement') ||
      desc.includes('refactor') ||
      desc.includes('debug') ||
      desc.includes('fix') ||
      desc.includes('function') ||
      desc.includes('class') ||
      desc.includes('method') ||
      desc.includes('algorithm')
    ) {
      return 'code';
    }

    // Research Agent keywords
    if (
      desc.includes('research') ||
      desc.includes('analyze') ||
      desc.includes('find') ||
      desc.includes('gather') ||
      desc.includes('summarize') ||
      desc.includes('explain') ||
      desc.includes('information') ||
      desc.includes('study')
    ) {
      return 'research';
    }

    // Tool Agent keywords
    if (
      desc.includes('file') ||
      desc.includes('directory') ||
      desc.includes('bash') ||
      desc.includes('command') ||
      desc.includes('shell') ||
      desc.includes('execute') ||
      desc.includes('run') ||
      desc.includes('filesystem') ||
      desc.includes('mcp')
    ) {
      return 'tool';
    }

    // Reviewer Agent keywords
    if (
      desc.includes('review') ||
      desc.includes('validate') ||
      desc.includes('check') ||
      desc.includes('audit') ||
      desc.includes('verify') ||
      desc.includes('test') ||
      desc.includes('quality') ||
      desc.includes('consistent')
    ) {
      return 'reviewer';
    }

    // Default to code for implementation tasks
    return 'code';
  }

  /**
   * PHASE 1: Task Planning
   * 
   * Analyzes the original task and breaks it down into manageable subtasks
   * using Gemini 3.6 Flash's superior reasoning capabilities.
   */
  async planTask(originalTask: string): Promise<Task[]> {
    if (this.state) {
      this.state.state = 'planning';
    }

    const planningPrompt = `You are a senior coding-agent architect.

TASK: "${originalTask}"

Create a disciplined multi-agent execution plan modeled on a strong coding assistant workflow:
1. Think first as the architect.
2. Delegate only bounded work with clear ownership.
3. Keep worker file ownership disjoint whenever tasks can run in parallel.
4. Run integration after worker tasks.
5. Run verification/review after integration.

Break this into 3-8 concrete subtasks. Use these execution modes:
- architect: heavy planning, interface/contracts, dependency discovery
- worker: implementation in a bounded module/file set
- integrator: connect worker outputs, resolve contracts, run build
- reviewer: inspect for bugs/regressions
- tester: add/run focused verification
- documenter: update docs only when needed

Respond ONLY with a valid JSON array of objects with these exact fields:
[
  {
    "description": "string",
    "objective": "string",
    "complexity": "low|medium|high",
    "priority": number,
    "estimatedSteps": number,
    "requiredCapabilities": ["coder|researcher|tester|reviewer|planner|documenter|specialist"],
    "executionMode": "architect|worker|integrator|reviewer|tester|documenter",
    "ownedFiles": ["relative/path.ts"],
    "readOnlyContext": ["relative/path.ts"],
    "dependencies": ["task_1"],
    "acceptanceCriteria": ["specific observable criterion"],
    "integrationNotes": "string"
  }
]

Rules:
- Architect task should usually be first and own no files.
- Worker tasks must own explicit files or directories. Keep ownership non-overlapping.
- Integrator depends on worker tasks.
- Reviewer/tester depend on integration.
- Use task ids in dependencies based on the order you output tasks: task_1, task_2, etc.`;

    try {
      const response = await this.createChatCompletion([
          {
            role: 'user',
            content: planningPrompt,
          },
        ]);

      // Parse the JSON response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('Failed to parse task planning response');
      }

      const taskDefinitions = JSON.parse(jsonMatch[0]);
      
      // Convert to Task objects with sub-agent type assignment
      const tasks: Task[] = taskDefinitions.map((def: any, index: number) => ({
        id: `task_${index + 1}`,
        description: def.description,
        objective: typeof def.objective === 'string' ? def.objective : def.description,
        complexity: def.complexity || 'medium',
        priority: def.priority || 5,
        estimatedSteps: def.estimatedSteps || 3,
        requiredCapabilities: def.requiredCapabilities || ['specialist'],
        subAgentType: this.determineSubAgentType(def.description, def.ownedFiles), // Typed capability route with keyword fallback
        executionMode: this.normalizeExecutionMode(def.executionMode),
        ownedFiles: this.normalizeStringArray(def.ownedFiles),
        readOnlyContext: this.normalizeStringArray(def.readOnlyContext),
        dependencies: this.normalizeStringArray(def.dependencies).filter((id) => /^task_\d+$/.test(id)),
        acceptanceCriteria: this.normalizeStringArray(def.acceptanceCriteria),
        integrationNotes: typeof def.integrationNotes === 'string' ? def.integrationNotes : '',
        status: 'pending' as const,
      }));

      if (this.state) {
        this.state.tasks = tasks;
      }

      if (this.config.verbose) {
        console.log(`\n📋 Planned ${tasks.length} tasks:`);
        tasks.forEach((task, idx) => {
          console.log(
            `  ${idx + 1}. [${task.complexity}] ${task.description.substring(0, 50)}...`
          );
        });
      }

      return tasks;
    } catch (error) {
      console.error('Task planning failed:', error);
      throw new Error(`Task planning failed: ${error}`);
    }
  }

  private normalizeExecutionMode(value: unknown): Task['executionMode'] {
    const validModes: Array<NonNullable<Task['executionMode']>> = [
      'architect',
      'worker',
      'integrator',
      'reviewer',
      'tester',
      'documenter',
    ];
    return typeof value === 'string' && validModes.includes(value as NonNullable<Task['executionMode']>)
      ? (value as NonNullable<Task['executionMode']>)
      : 'worker';
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  }

  /**
   * PHASE 2: ReAct Loop Control
   * 
   * Manages the Reasoning-Action-Observation loop for orchestration decisions.
   * Each step decides the next best action in the task execution flow.
   */
  async executeReActLoop(tasks: Task[]): Promise<void> {
    if (!this.state) return;

    this.state.state = 'executing';
    let stepCount = 0;

    while (
      stepCount < this.config.maxReactSteps &&
      this.state.completedTasks.length + this.state.failedTasks.length < tasks.length
    ) {
      stepCount++;

      // Get remaining tasks
      const remainingTasks = tasks.filter(t => t.status === 'pending');

      if (remainingTasks.length === 0) break;

      // REASON: Analyze the current situation
      const thoughtPrompt = `
Current orchestration state:
- Completed: ${this.state.completedTasks.length}/${tasks.length}
- Failed: ${this.state.failedTasks.length}/${tasks.length}
- Remaining: ${remainingTasks.map(t => t.description).join('; ')}

What should be the next task to process? Consider:
1. Priority and dependencies
2. Whether earlier tasks unblock later ones
3. Complexity and resource allocation

Respond concisely with ONLY the next task description and reasoning.`;

      const thought = await this.reasonAboutNextAction(thoughtPrompt);

      if (this.config.verbose) {
        console.log(`\n🤔 Step ${stepCount} - Thinking: ${thought.substring(0, 100)}...`);
      }

      // ACT: Make delegation decision for the next task
      const nextTask = [...remainingTasks].sort((a, b) => b.priority - a.priority)[0];
      const decision = await this.makeDelegationDecision(nextTask, remainingTasks);

      if (this.config.verbose) {
        console.log(`  👤 Delegating to: ${decision.assignedAgent}`);
      }

      // OBSERVE: Record the step
      this.state.reactSteps.push({
        step: stepCount,
        thought,
        action: decision.assignedAgent,
        observation: `Delegated ${nextTask.id} to ${decision.assignedAgent}`,
      });

      this.state.decisions.set(nextTask.id, decision);

      // Mark as in progress (actual execution happens in orchestrateComplexTask)
      nextTask.status = 'in_progress';
    }

    if (this.config.verbose) {
      console.log(`\n✅ ReAct loop completed after ${stepCount} steps`);
    }
  }

  /**
   * Helper: Reason about the next action
   */
  private async reasonAboutNextAction(prompt: string): Promise<string> {
    try {
      const response = await this.createChatCompletion([
          {
            role: 'user',
            content: prompt,
          },
        ]);

      return response;
    } catch (error) {
      return 'Unable to reason about next action';
    }
  }

  /**
   * PHASE 3: Delegation Decisions
   * 
   * Uses Gemini 3.6 Flash's superior reasoning to make intelligent decisions
   * about which specialized agent should handle each task.
   */
  async makeDelegationDecision(
    task: Task,
    contextTasks: Task[]
  ): Promise<DelegationDecision> {
    const delegationPrompt = `You are an expert task delegator.

TASK TO DELEGATE:
Description: "${task.description}"
Execution Mode: ${task.executionMode || 'worker'}
Complexity: ${task.complexity}
Required Capabilities: ${task.requiredCapabilities.join(', ')}
Write Ownership: ${(task.ownedFiles || []).join(', ') || 'none'}
Read-only Context: ${(task.readOnlyContext || []).join(', ') || 'discover as needed'}
Dependencies: ${(task.dependencies || []).join(', ') || 'none'}

AVAILABLE AGENTS:
- coder: Writes high-quality code and solves programming problems
- researcher: Finds and synthesizes information from resources
- tester: Ensures code quality through comprehensive testing
- reviewer: Reviews code and provides constructive feedback
- planner: Creates structured plans and breaks down complex tasks
- documenter: Writes user-centric documentation
- specialist: Handles edge cases and non-standard tasks

CONTEXT (other pending tasks):
${contextTasks.map((t, i) => `${i + 1}. ${t.description}`).join('\n')}

Determine the BEST agent for this task. Respond ONLY with a JSON object:
{
  "agent": "agent_name",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation (20 words max)",
  "fallbacks": ["fallback_agent_1", "fallback_agent_2"],
  "estimatedCost": 0.0-1.0
}`;

    try {
      const response = await this.createChatCompletion([
          {
            role: 'user',
            content: delegationPrompt,
          },
        ]);

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Failed to parse delegation decision');
      }

      const decision = JSON.parse(jsonMatch[0]);

      return {
        taskId: task.id,
        assignedAgent: decision.agent as AgentRole,
        reasoning: decision.reasoning,
        fallbackAgents: decision.fallbacks as AgentRole[],
        estimatedCost: decision.estimatedCost,
        confidence: decision.confidence,
      };
    } catch (error) {
      // Fallback to specialist agent
      return {
        taskId: task.id,
        assignedAgent: AgentRole.SPECIALIST,
        reasoning: 'Delegated to specialist due to decision error',
        fallbackAgents: [AgentRole.SPECIALIST],
        estimatedCost: 0.5,
        confidence: 0.3,
      };
    }
  }

  /**
   * PHASE 4: Result Synthesis
   * 
   * Consolidates results from multiple specialized agents into a coherent final answer
   * using Gemini 3.6 Flash's superior synthesis capabilities.
   */
  async synthesizeResults(
    originalTask: string,
    taskResults: SubtaskResult[],
    options?: SynthesisOptions
  ): Promise<string> {
    if (!this.state) return '';

    this.state.state = 'synthesizing';
    this.state.synthesisInProgress = true;

    const formattedSubtasks = formatSubtaskResultsForPrompt(taskResults);

    const synthesisPrompt = `You are a master synthesizer and final result compiler.

ORIGINAL TASK:
"${originalTask}"

SUBTASK RESULTS:
${formattedSubtasks}

Synthesize these subtask results into a comprehensive, coherent final answer using the following structure:

## Summary
A concise executive summary directly addressing the original task and overall outcome.

## Key Findings & Deliverables
- Bullet points detailing the key results, implementations, or answers produced by each subtask.
- Highlight concrete files, functions, or outputs where applicable.

## Dependencies & Connections
Explain how subtask results connect, build upon each other, or pass data. Omit if subtasks were completely independent.

## Issues or Caveats
Clearly surface any subtasks that failed, were blocked, or produced partial results, along with the cause. If all succeeded without issues, omit this section.

## Next Steps
Actionable next steps or recommendations following from the combined results.

Be concise, accurate, and surface any partial failures clearly.`;

    const retryConfig: RetryConfig = {
      maxAttempts: 3,
      backoffStrategy: 'exponential-jitter',
      baseDelayMs: 1000,
      multiplier: 1.5,
      maxDelayMs: 10000,
      jitter: true,
    };

    try {
      const synthesisResult = await executeWithRetry(
        async () => {
          const response = await this.createChatCompletion(
            [
              {
                role: 'user',
                content: synthesisPrompt,
              },
            ],
            options
          );

          return response;
        },
        retryConfig,
        (attempt, error, nextDelayMs) => {
          console.log(
            `⚠️ Synthesis attempt ${attempt} failed, retrying in ${(nextDelayMs / 1000).toFixed(1)}s...`
          );
        }
      );

      if (!synthesisResult.success) {
        throw synthesisResult.error;
      }

      const finalAnswer = synthesisResult.data ?? '';

      if (this.state) {
        this.state.state = 'complete';
        this.state.synthesisInProgress = false;
      }

      logger.endRequest(true);

      return finalAnswer;
    } catch (error) {
      console.error('Result synthesis failed:', error);
      this.state!.state = 'failed';
      this.state!.synthesisInProgress = false;
      logger.endRequest(false, String(error));
      throw error;
    }
  }

  /**
   * Get current orchestrator state
   */
  getState(): OrchestratorState | null {
    return this.state;
  }

  /**
   * Get execution metrics
   */
  getMetrics(): {
    totalTime: number;
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    reactSteps: number;
    state: string;
  } | null {
    if (!this.state) return null;

    return {
      totalTime: Date.now() - this.state.startTime,
      totalTasks: this.state.tasks.length,
      completedTasks: this.state.completedTasks.length,
      failedTasks: this.state.failedTasks.length,
      reactSteps: this.state.reactSteps.length,
      state: this.state.state,
    };
  }

  /**
   * NEW: Execute task using specialized sub-agent
   * 
   * Routes the task to the appropriate sub-agent based on type
   */
  async executeTaskWithSubAgent(
    task: Task,
    delegatedPrompt?: string
  ): Promise<SubAgentExecutionResult> {
    const subAgentType = task.subAgentType || this.determineSubAgentType(task.description, task.ownedFiles);

    if (this.config.verbose) {
      console.log(`   🔧 Using ${subAgentType} sub-agent`);
    }

    try {
      const result = await this.subAgentPool.executeWithAgent(
        subAgentType,
        delegatedPrompt || task.description
      );
      return result;
    } catch (error: any) {
      return {
        success: false,
        output: `Sub-agent execution failed: ${error.message}`,
        executionTime: 0,
        toolsUsed: [],
        confidence: 0,
        metadata: { error: error.message },
      };
    }
  }

  /**
   * NEW: Get sub-agent pool
   */
  getSubAgentPool(): SubAgentPool {
    return this.subAgentPool;
  }

  /**
   * NEW: Get available sub-agents
   */
  getAvailableSubAgents() {
    return this.subAgentPool.getAvailableAgents();
  }

  /**
   * Create and initialize state for a new orchestration
   */
  createState(originalTask: string): OrchestratorState {
    this.state = this.initializeState(originalTask);
    return this.state;
  }

  /**
   * Mark a task as completed
   */
  markTaskCompleted(taskId: string, result: string): void {
    if (!this.state) return;

    const task = this.state.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = 'completed';
      task.result = result;
      this.state.completedTasks.push(taskId);
    }
  }

  /**
   * Mark a task as failed
   */
  markTaskFailed(taskId: string, error: string): void {
    if (!this.state) return;

    const task = this.state.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = 'failed';
      task.result = `Error: ${error}`;
      this.state.failedTasks.push(taskId);
    }
  }

  /**
   * Get all tasks
   */
  getTasks(): Task[] {
    return this.state?.tasks || [];
  }

  /**
   * Get delegation decisions
   */
  getDecisions(): Map<string, DelegationDecision> {
    return this.state?.decisions || new Map();
  }

  /**
   * Get ReAct steps
   */
  getReActSteps(): Array<any> {
    return this.state?.reactSteps || [];
  }
}
