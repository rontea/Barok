import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import type { LLMProvider, ToolDefinition, ToolRegistry } from '../di/types.js';
import { ReActEngine } from '../react/engine.js';
import { validateAndResolvePath } from '@barok/adapter-node';
import { materializeProjectFixture, type MaterializeFixtureOptions } from './evaluationRunner.js';
import type { EvaluationProjectFixture } from './fixtureSchema.js';

export interface ProductionEngineFixtureScenario {
  task: string;
  actions: Array<{ action: 'Read' | 'Write' | 'Edit' | 'Bash'; action_input: Record<string, unknown> }>;
  finalAnswer: string;
  affectedFiles: string[];
}

export interface ProductionEngineFixtureResult {
  success: boolean;
  steps: Array<{ action: string; observation?: string }>;
  finalAnswer?: string;
  workspace: string;
  changedFiles: string[];
  error?: string;
}

class ScenarioProvider implements LLMProvider {
  private actionIndex = 0;
  constructor(private readonly scenario: ProductionEngineFixtureScenario) {}

  async createChatCompletion(messages: Array<{ role: string; content: string }>): Promise<string> {
    const system = messages[0]?.content || '';
    const prompt = messages.map((message) => message.content).join('\n');
    if (/Create the execution plan/i.test(system)) return JSON.stringify([{ step: 'Execute fixture actions', status: 'pending' }]);
    if (/tool planner|PHASE:\s*ACTION/i.test(prompt)) {
      const rawAction = this.scenario.actions[this.actionIndex++] || this.scenario.actions.at(-1)!;
      // Return in tool/arguments format that the engine's normalizer expects.
      return JSON.stringify({ tool: rawAction.action, arguments: rawAction.action_input });
    }
    if (/evaluating whether a task has been completed/i.test(system)) return this.actionIndex >= this.scenario.actions.length ? 'YES' : 'NO';
    if (/summarizing the result|writing the final response for a chat thread/i.test(system)) return this.scenario.finalAnswer;
    return 'Fixture response';
  }
  estimateStepCost(): number { return 0; }
  getProviderName(): string { return 'production-engine-fixture'; }
  isAvailable(): boolean { return true; }
}

function sha(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function fixtureToolRegistry(workspace: string): ToolRegistry {
  const tools: ToolDefinition[] = [
    {
      name: 'Read', description: 'Read a fixture file.', parameters: {}, handler: async (params) => {
        const filePath = String((params as any).file_path);
        const content = await readFile(validateAndResolvePath(filePath, workspace), 'utf8');
        return { success: true, output: `${content}\n[guarded-read-hash: ${sha(content)}]` };
      },
    },
    {
      name: 'Write', description: 'Write a fixture file.', parameters: {}, handler: async (params) => {
        const filePath = String((params as any).file_path);
        const content = String((params as any).content ?? '');
        const fullPath = validateAndResolvePath(filePath, workspace);
        const { writeFile: wf, mkdir: md } = await import('fs/promises');
        await md(path.dirname(fullPath), { recursive: true });
        await wf(fullPath, content, 'utf8');
        return { success: true, output: `Wrote ${filePath}` };
      },
    },
    {
      name: 'Edit', description: 'Edit a fixture file.', parameters: {}, handler: async (params) => {
        const filePath = String((params as any).file_path);
        const content = String((params as any).content ?? '');
        const fullPath = validateAndResolvePath(filePath, workspace);
        const { writeFile: wf, mkdir: md } = await import('fs/promises');
        await md(path.dirname(fullPath), { recursive: true });
        await wf(fullPath, content, 'utf8');
        return { success: true, output: `Edited ${filePath}` };
      },
    },
    {
      name: 'Bash', description: 'Run a fixture verification command.', parameters: {}, handler: async (params) => {
        const command = String((params as any).command || '');
        const executable = process.platform === 'win32'
          ? 'cmd.exe'
          : process.env.SHELL && existsSync(process.env.SHELL)
            ? process.env.SHELL
            : ['/bin/sh', '/bin/bash', '/usr/bin/sh', '/usr/bin/bash'].find((candidate) => existsSync(candidate)) || '/bin/sh';
        const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];
        const result = spawnSync(executable, args, { cwd: workspace, encoding: 'utf8' });
        return { success: result.status === 0, status: result.status === 0 ? 'success' : 'failed', output: result.stdout || result.stderr || '', error: result.status === 0 ? undefined : result.stderr || 'Verification failed' };
      },
    },
  ];
  return {
    getAll: () => tools,
    get: (name) => tools.find((tool) => tool.name === name),
    getEnabled: () => tools,
    has: (name) => tools.some((tool) => tool.name === name),
    register: () => undefined,
    setEnabled: () => undefined,
    getNames: () => tools.map((tool) => tool.name),
    size: () => tools.length,
  };
}

/** Runs the real ReAct engine against a disposable fixture with a deterministic provider. */
export async function runProductionEngineFixture(
  project: EvaluationProjectFixture,
  scenario: ProductionEngineFixtureScenario,
  options: MaterializeFixtureOptions = {},
): Promise<ProductionEngineFixtureResult> {
  const materialized = await materializeProjectFixture(project, options);
  try {
    const engine = new ReActEngine({
      model: 'production-engine-fixture', maxSteps: scenario.actions.length + 1, budget: 100, pacingProfile: 'fast',
      // The deterministic provider answers several bounded prompts per
      // action (plan, selection, completion, and final synthesis). Keep the
      // fixture budget proportional to its declared action script so the
      // evaluation measures the workflow rather than the default request cap.
      maxLlmRequestsPerTask: Math.max(20, scenario.actions.length * 4),
      workspace: materialized.path, llmProvider: new ScenarioProvider(scenario), toolRegistry: fixtureToolRegistry(materialized.path), verbose: false,
    });
    const result = await engine.run(scenario.task);
    return { success: result.success, steps: result.steps.map((step) => ({ action: step.action, observation: step.observation })), finalAnswer: result.finalAnswer, workspace: materialized.path, changedFiles: result.outputFiles || [], error: result.error };
  } finally {
    if (!options.root) await materialized.cleanup();
  }
}
