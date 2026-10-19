import { pollinationsClient } from '../pollinations/client.js';
import { ReActEngine } from '../react/engine.js';
import { executeWithRetry, type RetryConfig } from '@barok/engine';
import { logger } from '../logging/structuredLogger.js';
import { OrchestratorAgent, formatSubtaskResultsForPrompt, MAX_SUBTASK_RESULT_LENGTH, type DelegationDecision, type Task as OrchestratedTask } from './orchestrator.js';
import { selectAgentsForRequest, type AgentSelection } from './capabilities/agentSelection.js';
import type { LLMProvider } from '../di/types.js';
import { getConfiguredCoderModelSelection } from '../config/coderModel.js';

// ============================================================================
// SPECIALIZED AGENTS
// ============================================================================

export enum AgentRole {
  CODER = 'coder',
  RESEARCHER = 'researcher',
  TESTER = 'tester',
  REVIEWER = 'reviewer',
  PLANNER = 'planner',
  DOCUMENTER = 'documenter',
  SPECIALIST = 'specialist',
}

function crewRoleForCapabilityAgent(selection: AgentSelection): AgentRole | undefined {
  const primary = selection.primaryAgents[0];
  switch (primary) {
    case 'frontend':
    case 'backend':
    case 'data':
      return AgentRole.CODER;
    case 'test':
      return AgentRole.TESTER;
    case 'reviewer':
      return AgentRole.REVIEWER;
    case 'documentation':
      return AgentRole.DOCUMENTER;
    default:
      return undefined;
  }
}

interface AgentConfig {
  role: AgentRole;
  goal: string;
  backstory: string;
  tools: string[];
}

const AGENT_CONFIGS: Record<AgentRole, AgentConfig> = {
  [AgentRole.CODER]: {
    role: AgentRole.CODER,
    goal: 'Write high-quality, efficient code that solves the given problem',
    backstory: 'You are an expert software engineer with deep knowledge of multiple programming languages and best practices. You write clean, well-documented, and maintainable code.',
    tools: ['Write', 'Edit', 'Read', 'Bash', 'Glob', 'Grep'],
  },

  [AgentRole.RESEARCHER]: {
    role: AgentRole.RESEARCHER,
    goal: 'Find and synthesize information from available resources',
    backstory: 'You are a skilled researcher who excels at finding relevant information, understanding complex topics, and explaining findings clearly.',
    tools: ['WebFetch', 'Glob', 'Grep', 'Read', 'Bash'],
  },

  [AgentRole.TESTER]: {
    role: AgentRole.TESTER,
    goal: 'Ensure code quality through comprehensive testing',
    backstory: 'You are a quality assurance specialist who writes thorough tests, identifies edge cases, and validates functionality.',
    tools: ['Bash', 'Read', 'Glob', 'Write'],
  },

  [AgentRole.REVIEWER]: {
    role: AgentRole.REVIEWER,
    goal: 'Review code and provide constructive feedback for improvement',
    backstory: 'You are a senior code reviewer with keen attention to detail. You spot bugs, suggest optimizations, and ensure code follows best practices.',
    tools: ['Read', 'Grep', 'Bash'],
  },
  
  [AgentRole.PLANNER]: {
    role: AgentRole.PLANNER,
    goal: 'Create structured plans and break down complex tasks',
    backstory: 'You are a project manager and systems architect. You excel at taking a high-level requirement and breaking it down into actionable sub-tasks and system designs.',
    tools: ['Read', 'Bash', 'Glob'],
  },
  
  [AgentRole.DOCUMENTER]: {
    role: AgentRole.DOCUMENTER,
    goal: 'Write user-centric documentation and readmes',
    backstory: 'You are a technical writer who communicates complex system functionality into easy-to-read guides, markdown files, and inline comments.',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Bash'],
  },

  [AgentRole.SPECIALIST]: {
    role: AgentRole.SPECIALIST,
    goal: 'Act as a dedicated fallback and handle highly specialized edge-case tasks',
    backstory: 'You are a highly adaptable specialist who steps in when primary agents are unavailable or unable to complete complex, non-standard tasks.',
    tools: ['Read', 'Write', 'Bash', 'Glob', 'Grep', 'WebFetch'],
  },
};

// Custom CrewAI Agent wrapper that uses Pollinations LLM
class PollinationsAgent {
  public readonly role: AgentRole;
  private config: AgentConfig;
  private llm: typeof pollinationsClient;
  private reactEngine: ReActEngine;
  private workspace?: string;

  constructor(role: AgentRole, llm: typeof pollinationsClient, model = getConfiguredCoderModelSelection(), workspace?: string, llmProvider?: LLMProvider) {
    this.role = role;
    this.config = AGENT_CONFIGS[role];
    this.llm = llm;
    this.workspace = workspace;
    this.reactEngine = new ReActEngine({
      model: model,
      verbose: false,
      workspace,
      llmProvider,
    });
  }

  async execute(taskDescription: string): Promise<string> {
    const prompt = `
You are a ${this.role} agent.

GOAL: ${this.config.goal}

BACKGROUND: ${this.config.backstory}

AVAILABLE TOOLS: ${this.config.tools.join(', ')}

WORKSPACE: ${this.workspace || process.cwd()}
All file paths must be relative to this workspace unless the task explicitly provides an in-workspace absolute path.

TASK: ${taskDescription}

Use the ReAct loop (Reason → Act → Observe → Repeat) to complete this task efficiently.
Be thorough but concise in your approach.
`;

    const result = await this.reactEngine.run(prompt);
    return result.success ? (result.finalAnswer || 'Task completed') : `Failed: ${result.error}`;
  }

  getRole(): AgentRole {
    return this.role;
  }
}

/**
 * Formats subtask results into a clean numbered list fallback when synthesis fails.
 */
export function formatCrewFallbackOutput(
  tasks: Array<{ description: string; status: string; result?: string | null }>,
  maxResultLength: number = MAX_SUBTASK_RESULT_LENGTH
): string {
  if (tasks.length === 0) {
    return 'No subtasks were executed.';
  }
  return tasks
    .map((t, idx) => {
      const statusIcon = t.status === 'completed' ? '✅' : '❌';
      const preview = (t.result ?? 'No result')
        .slice(0, maxResultLength)
        .replace(/\n/g, ' ');
      const truncated = (t.result ?? '').length > maxResultLength ? '… [truncated]' : '';
      return `${idx + 1}. ${statusIcon} **${t.description}**\n   ${preview}${truncated}`;
    })
    .join('\n\n');
}

// ============================================================================
// CREW COORDINATOR
// ============================================================================

export class CrewCoordinator {
  private agents: Map<AgentRole, PollinationsAgent>;
  private tasks: Array<{
    id: string;
    description: string;
    assignedTo?: AgentRole;
    fallbackTo?: AgentRole;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    result?: string | null;
  }> = [];
  private llm: typeof pollinationsClient;
  private defaultModel: string;
  private orchestrator: OrchestratorAgent;

  constructor(llm: typeof pollinationsClient, defaultModel = getConfiguredCoderModelSelection(), workspace?: string, llmProvider?: LLMProvider) {
    this.llm = llm;
    this.defaultModel = defaultModel;
    this.agents = new Map();
    this.orchestrator = new OrchestratorAgent({
      model: defaultModel,
      verbose: true,
      workspace,
    });
    // Initialize all agent types
    Object.values(AgentRole).forEach(role => {
      this.agents.set(role, new PollinationsAgent(role, llm, defaultModel, workspace, llmProvider));
    });
  }

  async createTask(description: string, assignee?: AgentRole, fallback?: AgentRole): Promise<string> {
    const taskId = `task_${this.tasks.length + 1}`;
    const task = {
      id: taskId,
      description,
      assignedTo: assignee,
      fallbackTo: fallback ?? AgentRole.SPECIALIST,
      status: 'pending' as const,
    };
    this.tasks.push(task);
    console.log(`📋 Created task ${taskId}: ${description.substring(0, 50)}...`);
    return taskId;
  }

  async assignTask(taskId: string, agentRole: AgentRole): Promise<boolean> {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return false;

    task.assignedTo = agentRole;
    console.log(`👤 Assigned ${taskId} → ${agentRole}`);
    return true;
  }

  async executeTask(taskId: string): Promise<string | null> {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return null;

    if (!task.assignedTo) {
      // Auto-assign based on task analysis
      task.assignedTo = await this.recommendAgent(task.description);
      console.log(`🤖 Auto-assigned ${taskId} → ${task.assignedTo}`);
    }

    task.status = 'in_progress';
    console.log(`⚡ Executing ${taskId} (${task.assignedTo})...`);

    const executeWithAgent = async (agentRole: AgentRole): Promise<string | null> => {
      const agent = this.agents.get(agentRole);
      if (!agent) return null;
      try {
        return await agent.execute(task.description);
      } catch (err) {
        return `Failed: ${err}`;
      }
    };

    let result = await executeWithAgent(task.assignedTo!);

    // Fallback logic
    if ((!result || result.startsWith('Failed:')) && task.fallbackTo && task.fallbackTo !== task.assignedTo) {
      console.log(`⚠️ Primary agent (${task.assignedTo}) failed. Falling back to ${task.fallbackTo}...`);
      result = await executeWithAgent(task.fallbackTo);
    }

    if (result && !result.startsWith('Failed:')) {
      task.result = result;
      task.status = 'completed';
      console.log(`✅ ${taskId} completed`);
    } else {
      task.result = result;
      task.status = 'failed';
      console.log(`❌ ${taskId} failed`);
    }

    return result;
  }

  async runAll(parallel: boolean = false): Promise<Array<{ taskId: string; result: string | null }>> {
    const pending = this.tasks.filter(t => t.status === 'pending');
    const results: Array<{ taskId: string; result: string | null }> = [];

    if (parallel) {
      // Execute all in parallel
      const promises = pending.map(t => this.executeTask(t.id).then(r => ({ taskId: t.id, result: r })));
      results.push(...(await Promise.all(promises)));
    } else {
      // Execute sequentially
      for (const task of pending) {
        const result = await this.executeTask(task.id);
        results.push({ taskId: task.id, result: result || '' });
      }
    }

    return results;
  }

  async orchestrateComplexTask(task: string): Promise<string> {
    // Start structured logging for crew orchestration
    const requestId = logger.startRequest('crew-agent', { task });
    
    // Break down complex task into subtasks
    console.log('🔍 Analyzing task complexity...');

    const breakdownPrompt = `
Break this task into 2-5 concrete subtasks that can be executed independently or sequentially.
Task: "${task}"

Respond with ONLY a JSON array of strings (the subtasks).
Example: ["setup environment", "write core logic", "add tests", "finalize"]`;

    const retryConfig: RetryConfig = {
      maxAttempts: 5,
      backoffStrategy: 'exponential-jitter',
      baseDelayMs: 2000,
      multiplier: 1.5,
      maxDelayMs: 30000,
      jitter: true,
    };

    const breakdownResult = await executeWithRetry(
      async () => {
        const res = await this.llm.chatCompletion({
          messages: [{ role: 'user', content: breakdownPrompt }],
          model: this.defaultModel,
        });
        return res;
      },
      retryConfig,
      (attempt, error, nextDelayMs) => {
        console.log(`⚠️ Orchestrate failed (attempt ${attempt}), retrying in ${(nextDelayMs / 1000).toFixed(1)}s... (${error.message})`);
      }
    );

    if (!breakdownResult.success) {
      throw breakdownResult.error;
    }

    const res = breakdownResult.data;
    
    let subtasks: string[] = [];
    if (res && res.content) {
      try {
        const jsonMatch = res.content.match(/\[.*\]/s);
        if (jsonMatch) {
          subtasks = JSON.parse(jsonMatch[0]);
        }
      } catch {
        subtasks = [task]; // fallback
      }
    } else {
      subtasks = [task];
    }

    if (subtasks.length <= 1) {
      // Simple task, use single agent
      const coder = this.agents.get(AgentRole.CODER)!;
      return await coder.execute(task);
    }

    console.log(`📋 Task broken into ${subtasks.length} subtasks:`);
    subtasks.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));

    // Create and execute tasks
    const coordinator = this;
    for (const subtask of subtasks) {
      const taskId = await coordinator.createTask(subtask);
      await coordinator.executeTask(taskId);
    }

    // Synthesize final result
    // Build rich subtask context: description + status + truncated result per task
    const subtaskResultsForPrompt = formatSubtaskResultsForPrompt(
      this.tasks.map(t => ({
        taskId: t.id,
        description: t.description,
        result: t.result ?? null,
        success: t.status === 'completed',
      })),
      MAX_SUBTASK_RESULT_LENGTH
    );

    // Structured fallback: numbered list with descriptions and truncated results
    // (used when LLM synthesis fails so the output remains human-readable)
    const structuredFallback = formatCrewFallbackOutput(this.tasks, MAX_SUBTASK_RESULT_LENGTH);

    const synthesisPrompt = `You are a master synthesizer and final result compiler.

ORIGINAL TASK:
"${task}"

SUBTASK RESULTS:
${subtaskResultsForPrompt}

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

    const synthesisResult = await executeWithRetry(
      async () => {
        return await this.llm.chatCompletion({
          messages: [
            {
              role: 'user',
              content: synthesisPrompt,
            },
          ],
          model: this.defaultModel,
        });
      },
      retryConfig,
      (attempt, error, nextDelayMs) => {
        console.log(`⚠️ Synthesis failed (attempt ${attempt}), retrying in ${(nextDelayMs / 1000).toFixed(1)}s... (${error.message})`);
      }
    );

    if (!synthesisResult.success) {
      logger.endRequest(false, String(synthesisResult.error));
      await logger.flush();
      return structuredFallback;
    }

    const result = synthesisResult.data?.content ? synthesisResult.data.content : structuredFallback;
    logger.endRequest(true);
    await logger.flush();
    
    return result;
  }

  /**
   * Orchestrate a complex task using Gemini 3.6 Flash as the PRIMARY ORCHESTRATOR
   * 
   * This method uses the OrchestratorAgent to:
   * 1. Plan and decompose the task
   * 2. Manage the ReAct loop for orchestration decisions
   * 3. Delegate to specialized agents intelligently
   * 4. Synthesize final results
   */
  async orchestrateWithPrimaryOrchestrator(task: string): Promise<string> {
    console.log('\n' + '═'.repeat(50));
    console.log('🎯 USING PRIMARY ORCHESTRATOR (Gemini 3.6 Flash)');
    console.log('═'.repeat(50) + '\n');

    try {
      // Initialize orchestrator state
      this.orchestrator.createState(task);

      // PHASE 1: Task Planning
      console.log('📋 PHASE 1: Planning and Decomposition\n');
      const tasks = await this.orchestrator.planTask(task);

      // PHASE 2: ReAct Loop Control
      console.log('\n🔄 PHASE 2: ReAct Loop Control (Orchestration Decisions)\n');
      await this.orchestrator.executeReActLoop(tasks);

      // PHASE 3 & Execution: Contracted delegation with bounded ownership
      console.log('\nPHASE 3: Contracted Task Execution\n');
      const taskResults = await this.executePlannedTaskWaves(tasks);

      // PHASE 4: Result Synthesis
      console.log('\n🧠 PHASE 4: Result Synthesis (Gemini 3.6 Flash)\n');
      const finalAnswer = await this.orchestrator.synthesizeResults(task, taskResults);

      // Print orchestration metrics
      const metrics = this.orchestrator.getMetrics();
      if (metrics) {
        console.log('\n' + '─'.repeat(50));
        console.log('📊 ORCHESTRATION METRICS');
        console.log('─'.repeat(50));
        console.log(`  Total Time: ${(metrics.totalTime / 1000).toFixed(2)}s`);
        console.log(`  Total Tasks: ${metrics.totalTasks}`);
        console.log(`  Completed: ${metrics.completedTasks}`);
        console.log(`  Failed: ${metrics.failedTasks}`);
        console.log(`  ReAct Steps: ${metrics.reactSteps}`);
        console.log('─'.repeat(50) + '\n');
      }

      return finalAnswer;
    } catch (error: any) {
      console.error('❌ Orchestration failed:', error.message);
      throw error;
    }
  }

  private async executePlannedTaskWaves(
    tasks: OrchestratedTask[]
  ): Promise<Array<{ taskId: string; description: string; result: string | null }>> {
    const taskResults: Array<{ taskId: string; description: string; result: string | null }> = [];
    const completed = new Set<string>();
    const failed = new Set<string>();

    while (completed.size + failed.size < tasks.length) {
      const batch = this.selectNextExecutableBatch(tasks, completed, failed);

      if (!batch.length) {
        const blocked = tasks
          .filter((candidate) => !completed.has(candidate.id) && !failed.has(candidate.id))
          .map((candidate) => candidate.id)
          .join(', ');
        throw new Error(`No executable task batch found. Blocked tasks: ${blocked}`);
      }

      console.log(
        `\nExecuting ${batch.length > 1 ? 'parallel worker batch' : 'task'}: ${batch
          .map((item) => item.id)
          .join(', ')}`
      );

      const waveResults = await Promise.all(
        batch.map(async (orchestratorTask) => {
          const decision = this.orchestrator.getDecisions().get(orchestratorTask.id);
          const result = await this.executeContractedTask(orchestratorTask, decision);

          if (result && !result.startsWith('Failed:')) {
            completed.add(orchestratorTask.id);
            this.orchestrator.markTaskCompleted(orchestratorTask.id, result);
          } else {
            failed.add(orchestratorTask.id);
            this.orchestrator.markTaskFailed(orchestratorTask.id, result || 'Unknown task failure');
          }

          return {
            taskId: orchestratorTask.id,
            description: orchestratorTask.description,
            result,
          };
        })
      );

      taskResults.push(...waveResults);
    }

    return taskResults;
  }

  private selectNextExecutableBatch(
    tasks: OrchestratedTask[],
    completed: Set<string>,
    failed: Set<string>
  ): OrchestratedTask[] {
    const ready = tasks
      .filter((task) => !completed.has(task.id) && !failed.has(task.id))
      .filter((task) => (task.dependencies || []).every((dependency) => completed.has(dependency)))
      .sort((a, b) => {
        const modeOrder = this.getModeOrder(a.executionMode) - this.getModeOrder(b.executionMode);
        return modeOrder || b.priority - a.priority;
      });

    if (!ready.length) return [];

    const first = ready[0];
    if (!this.canRunInParallel(first)) {
      return [first];
    }

    const batch: OrchestratedTask[] = [];
    const owned = new Set<string>();

    for (const candidate of ready) {
      if (!this.canRunInParallel(candidate)) continue;
      const candidateFiles = candidate.ownedFiles || [];
      if (candidateFiles.length === 0) continue;
      if (candidateFiles.some((file) => owned.has(file))) continue;

      batch.push(candidate);
      candidateFiles.forEach((file) => owned.add(file));
    }

    return batch.length ? batch : [first];
  }

  private getModeOrder(mode: OrchestratedTask['executionMode']): number {
    const order: Record<NonNullable<OrchestratedTask['executionMode']>, number> = {
      architect: 0,
      worker: 1,
      documenter: 2,
      integrator: 3,
      tester: 4,
      reviewer: 5,
    };
    return order[mode || 'worker'];
  }

  private canRunInParallel(task: OrchestratedTask): boolean {
    return (
      (task.executionMode === 'worker' || task.executionMode === 'documenter') &&
      (task.ownedFiles || []).length > 0
    );
  }

  private async executeContractedTask(
    orchestratorTask: OrchestratedTask,
    decision?: DelegationDecision
  ): Promise<string | null> {
    const primaryRole = decision?.assignedAgent || this.agentRoleForMode(orchestratorTask.executionMode);
    const fallbackRoles = decision?.fallbackAgents?.length ? decision.fallbackAgents : [AgentRole.SPECIALIST];
    const prompt = this.buildContractedTaskPrompt(orchestratorTask);

    console.log(`\nExecuting ${orchestratorTask.id}: ${orchestratorTask.description}`);
    console.log(`   Mode: ${orchestratorTask.executionMode || 'worker'}`);
    console.log(`   Assigned to: ${primaryRole}`);
    if (orchestratorTask.ownedFiles?.length) {
      console.log(`   Owns: ${orchestratorTask.ownedFiles.join(', ')}`);
    }

    const subAgentResult = await this.orchestrator.executeTaskWithSubAgent(orchestratorTask, prompt);
    let result: string | null = subAgentResult.success
      ? subAgentResult.output
      : `Failed: ${subAgentResult.output}`;

    if (subAgentResult.toolsUsed.length) {
      console.log(`   Sub-agent tools: ${subAgentResult.toolsUsed.join(', ')}`);
    }

    const tryAgent = async (role: AgentRole): Promise<string | null> => {
      const agent = this.agents.get(role);
      if (!agent) return null;
      return agent.execute(prompt);
    };

    if ((!result || result.startsWith('Failed:')) && fallbackRoles.length > 0) {
      for (const fallbackRole of fallbackRoles) {
        if (fallbackRole === primaryRole) continue;
        console.log(`   Primary failed; trying fallback ${fallbackRole}`);
        result = await tryAgent(fallbackRole);
        if (result && !result.startsWith('Failed:')) break;
      }
    }

    console.log(
      result && !result.startsWith('Failed:')
        ? `   Completed ${orchestratorTask.id}`
        : `   Failed ${orchestratorTask.id}`
    );
    return result;
  }

  private agentRoleForMode(mode: OrchestratedTask['executionMode']): AgentRole {
    switch (mode) {
      case 'architect':
        return AgentRole.PLANNER;
      case 'integrator':
        return AgentRole.CODER;
      case 'reviewer':
        return AgentRole.REVIEWER;
      case 'tester':
        return AgentRole.TESTER;
      case 'documenter':
        return AgentRole.DOCUMENTER;
      case 'worker':
      default:
        return AgentRole.CODER;
    }
  }

  private buildContractedTaskPrompt(task: OrchestratedTask): string {
    const ownedFiles = task.ownedFiles?.length ? task.ownedFiles.join('\n- ') : 'No write ownership granted.';
    const readOnlyContext = task.readOnlyContext?.length
      ? task.readOnlyContext.join('\n- ')
      : 'Use discovery tools as needed.';
    const dependencies = task.dependencies?.length ? task.dependencies.join(', ') : 'None';
    const acceptanceCriteria = task.acceptanceCriteria?.length
      ? task.acceptanceCriteria.map((criterion) => `- ${criterion}`).join('\n')
      : '- Complete the assigned objective and report verification performed.';

    return `You are one agent in a coordinated coding workflow. You are not alone in the codebase.

Task ID: ${task.id}
Mode: ${task.executionMode || 'worker'}
Objective: ${task.objective || task.description}
Description: ${task.description}

Dependencies already completed: ${dependencies}

Write ownership:
- ${ownedFiles}

Read-only context:
- ${readOnlyContext}

Acceptance criteria:
${acceptanceCriteria}

Integration notes:
${task.integrationNotes || 'Respect existing interfaces and report any contract assumptions.'}

Rules:
1. Stay inside your write ownership. If you need another file changed, report it instead of editing outside your lane.
2. Inspect relevant files before editing.
3. Preserve changes made by other agents and users.
4. Keep edits minimal and compatible with the existing architecture.
5. Run targeted verification when appropriate.
6. End with changed files, verification performed, and any integration risks.`;
  }

  private async recommendAgent(description: string): Promise<AgentRole> {
    const typedSelection = selectAgentsForRequest(description);
    const typedRole = crewRoleForCapabilityAgent(typedSelection);
    if (typedRole) return typedRole;

    // Compatibility fallback for malformed or underspecified legacy requests.
    const keywords: Record<string, AgentRole> = {
      code: AgentRole.CODER,
      write: AgentRole.CODER,
      implement: AgentRole.CODER,
      fix: AgentRole.CODER,
      debug: AgentRole.CODER,
      research: AgentRole.RESEARCHER,
      find: AgentRole.RESEARCHER,
      search: AgentRole.RESEARCHER,
      investigate: AgentRole.RESEARCHER,
      learn: AgentRole.RESEARCHER,
      test: AgentRole.TESTER,
      verify: AgentRole.TESTER,
      validate: AgentRole.TESTER,
      check: AgentRole.TESTER,
      review: AgentRole.REVIEWER,
      critique: AgentRole.REVIEWER,
      improve: AgentRole.REVIEWER,
      optimize: AgentRole.REVIEWER,
      plan: AgentRole.PLANNER,
      design: AgentRole.PLANNER,
      architect: AgentRole.PLANNER,
      designate: AgentRole.PLANNER,
      document: AgentRole.DOCUMENTER,
      write_readme: AgentRole.DOCUMENTER,
      comment: AgentRole.DOCUMENTER,
      explain: AgentRole.DOCUMENTER,
    };

    const lower = description.toLowerCase();
    for (const [keyword, role] of Object.entries(keywords)) {
      if (lower.includes(keyword)) return role;
    }

    return AgentRole.CODER; // default
  }

  getAgents(): AgentRole[] {
    return Array.from(this.agents.keys());
  }

  getTasks() {
    return this.tasks;
  }

  /**
   * Get the primary orchestrator (Gemini 3.6 Flash)
   */
  getOrchestrator() {
    return this.orchestrator;
  }

  /**
   * Get orchestrator state and metrics
   */
  getOrchestratorMetrics() {
    return {
      state: this.orchestrator.getState(),
      metrics: this.orchestrator.getMetrics(),
      decisions: this.orchestrator.getDecisions(),
      reactSteps: this.orchestrator.getReActSteps(),
    };
  }

  /**
   * NEW: Get sub-agent pool for specialized task execution
   */
  getSubAgentPool() {
    return this.orchestrator.getSubAgentPool();
  }

  /**
   * NEW: Get available sub-agents
   */
  getAvailableSubAgents() {
    return this.orchestrator.getAvailableSubAgents();
  }

  /**
   * NEW: Execute task directly using a specific sub-agent
   */
  async executeWithSubAgent(
    subAgentType: 'code' | 'research' | 'tool' | 'reviewer' | 'documentation',
    task: string
  ) {
    return this.orchestrator.getSubAgentPool().executeWithAgent(subAgentType, task);
  }

  /**
   * NEW: Execute multiple tasks in parallel using sub-agents
   */
  async executeSubAgentTasks(
    tasks: Array<{
      type: 'code' | 'research' | 'tool' | 'reviewer' | 'documentation';
      task: string;
    }>
  ) {
    return this.orchestrator.getSubAgentPool().executeParallel(tasks);
  }
}

// ============================================================================
// EXPORTS: Sub-Agent Architecture
// ============================================================================

export {
  CodeAgent,
  ResearchAgent,
  ToolAgent,
  ReviewerAgent,
  DocumentationAgent,
  SubAgentPool,
  createSubAgentPool,
  type SubAgentExecutionResult,
  type SubAgentConfig,
} from './subagents.js';

export {
  OrchestratorAgent,
  type Task,
  type DelegationDecision,
  type OrchestratorState,
} from './orchestrator.js';

export {
  BoundedWorkflowRunner,
  createChildRunRecord,
  normalizeChildBudget,
  normalizeChildReport,
  type ChildRunBudget,
  type ChildRunCapabilities,
  type ChildRunHandle,
  type ChildRunProvider,
  type ChildRunProviderContext,
  type ChildRunProviderKind,
  type ChildRunRecord,
  type ChildRunReport,
  type ChildRunRequest,
  type WorkflowPlan,
  type WorkflowRunResult,
  type WorkflowStep,
} from './child-runs.js';

