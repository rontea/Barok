#!/usr/bin/env node

/**
 * Demo: ReAct Loop Simulation
 * Shows the full cycle: Reason → Act → Observe → Repeat
 *
 * This simulates the LLM making decisions and executing tools
 * (no actual API calls needed for this demo)
 */

import { ReActEngine } from '../src/react/engine.js';
import { pollinationsClient } from '../src/pollinations/client.js';
import { getAllToolDefinitions } from '../src/tools/devTools.js';
import { validators, validateToolCall } from '../src/validation/validators.js';

// ── MOCK POLLINATIONS CLIENT FOR DEMO ───────────────────────────────────────
// In production, use real API. Here we simulate LLM responses to show the loop.

class MockLLM {
  private step = 0;

  async chatCompletion(params: {
    messages: Array<{ role: string; content: string }>;
    model?: string;
  }): Promise<{ content: string }> {
    this.step++;

    const lastUserMsg = params.messages[params.messages.length - 1].content.toLowerCase();

    // Simulate LLM reasoning based on task phase
    if (lastUserMsg.includes('what should you do next')) {
      const response = this.planNextAction(lastUserMsg);
      return { content: response };
    }

    if (lastUserMsg.includes('determine if the original task has been completed')) {
      const isDone = this.shouldTerminate(lastUserMsg);
      return { content: isDone ? 'YES' : 'NO' };
    }

    if (lastUserMsg.includes('provide a clear, concise final answer')) {
      return { content: this.synthesizeAnswer(lastUserMsg) };
    }

    // Reasoning step
    const thoughts = [
      'First, I need to understand the current state. Let me check what files exist.',
      'I should create the necessary file structure first.',
      'Now I need to write the implementation code.',
      'Let me verify the code works by examining it.',
      'The task appears complete. Let me review requirements.',
    ];
    return { content: thoughts[Math.min(this.step - 1, thoughts.length - 1)] || 'Proceeding to next step.' };
  }

  private planNextAction(msg: string): string {
    if (msg.includes('read') || msg.includes('check')) {
      return JSON.stringify({
        tool: 'Bash',
        arguments: { command: 'ls -la' },
      });
    }
    if (msg.includes('create') || msg.includes('write')) {
      return JSON.stringify({
        tool: 'Write',
        arguments: {
          file_path: '/tmp/demo.txt',
          content: 'Hello from ReAct loop demo!\nTimestamp: ' + new Date().toISOString(),
        },
      });
    }
    if (msg.includes('find')) {
      return JSON.stringify({
        tool: 'Glob',
        arguments: { pattern: '**/*.js' },
      });
    }
    if (msg.includes('search')) {
      return JSON.stringify({
        tool: 'Grep',
        arguments: { pattern: 'function', type: 'files_with_matches' },
      });
    }
    if (msg.includes('execute') || msg.includes('run')) {
      return JSON.stringify({
        tool: 'Bash',
        arguments: { command: 'echo "Demo command executed"' },
      });
    }
    // Default: read current directory
    return JSON.stringify({
      tool: 'Bash',
      arguments: { command: 'pwd' },
    });
  }

  private shouldTerminate(_msg: string): boolean {
    // Terminate after 3 simulated steps for demo
    return this.step >= 3;
  }

  private synthesizeAnswer(_msg: string): string {
    return `Task completed successfully through ${this.step} ReAct steps. The workflow demonstrated: Reason → Act → Observe → Repeat cycle.`;
  }
}

// ── DEMO REACT ENGINE WITH MOCK LLM ─────────────────────────────────────────
class DemoReActEngine {
  private llm = new MockLLM();
  private maxSteps = 5;
  private verbose = true;

  async run(task: string): Promise<{
    success: boolean;
    finalAnswer?: string;
    steps: Array<{ thought: string; action: string; observation: string }>;
  }> {
    console.log(`🎯 Task: ${task}\n`);

    const state = {
      task,
      steps: [] as Array<{ thought: string; action: string; observation: string }>,
      current_step: 0,
    };

    while (state.current_step < this.maxSteps) {
      console.log(`📍 Step ${state.current_step + 1}/${this.maxSteps}`);

      // ── REASON ─────────────────────────────────────────────────────────────
      const thought = await this.reason(state);
      console.log(`💭 Thought: ${thought}`);

      // ── PLAN ACTION ────────────────────────────────────────────────────────
      const { action, action_input } = await this.planAction(thought);
      console.log(`🔨 Action: ${action}(${JSON.stringify(action_input)})`);

      // ── ACT ────────────────────────────────────────────────────────────────
      const observation = await this.executeAction(action, action_input);
      console.log(`👁️  Observed: ${observation.substring(0, 80)}...\n`);

      state.steps.push({ thought, action: `${action}(${JSON.stringify(action_input)})`, observation });
      state.current_step++;

      // ── CHECK DONE ─────────────────────────────────────────────────────────
      const isDone = await this.checkIfDone(state);
      if (isDone) {
        const finalAnswer = await this.synthesizeAnswer(state);
        return { success: true, finalAnswer, steps: state.steps };
      }
    }

    return { success: false, error: 'Max steps exceeded', steps: state.steps };
  }

  private async reason(state: typeof this): Promise<string> {
    const sys = 'You are a ReAct agent. Think about next action.';
    const res = await this.llm.chatCompletion({
      messages: [{ role: 'system', content: sys }, { role: 'user', content: `Task: ${state.task}\nWhat next?` }],
    });
    return res.content;
  }

  private async planAction(thought: string): Promise<{ action: string; action_input: Record<string, unknown> }> {
    const res = await this.llm.chatCompletion({
      messages: [{ role: 'system', content: 'Return JSON: {"tool": "...", "arguments": {...}}' }, { role: 'user', content: `Thought: ${thought}` }],
    });
    const jsonMatch = res.content.match(/\{.*\}/s);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { action: 'Bash', action_input: { command: 'echo "noop"' } };
  }

  private async executeAction(action: string, args: Record<string, unknown>): Promise<string> {
    const toolDef = getAllToolDefinitions().find(t => t.name === action);
    if (!toolDef) return `Error: Unknown tool ${action}`;

    // Validate
    const validation = validateToolCall(action, args);
    if (!validation.isValid) {
      return `Validation error: ${validation.error}`;
    }

    // In demo mode, just simulate
    if (action === 'Bash') {
      return `Simulated: executed "${(args as any).command}"\nOutput: command would run here`;
    }
    if (action === 'Write') {
      return `Simulated: wrote ${(args as any).content.length} chars to ${(args as any).file_path}`;
    }

    return `Simulated: ${action} completed`;
  }

  private async checkIfDone(_state: typeof this): Promise<boolean> {
    const res = await this.llm.chatCompletion({
      messages: [{ role: 'system', content: 'Respond YES or NO' }, { role: 'user', content: 'Done?' }],
    });
    return res.content.includes('YES');
  }

  private async synthesizeAnswer(_state: typeof this): Promise<string> {
    return '✅ Task completed via ReAct loop simulation. All steps executed successfully.';
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🧠 Raw ReAct MCP — Demo System\n');
  console.log('This demonstrates the ReAct loop without needing an API key.\n');
  console.log('In production, the real engine uses Pollinations API LLM.\n');

  // Validation demo
  console.log('── Schema Validation Demo ──────────────\n');
  const testArgs = { command: 'ls -la' };
  const result = validateToolCall('Bash', testArgs);
  console.log('Tool call:', testArgs);
  console.log('Valid:', result.isValid ? '✓' : '✗');
  console.log('Parsed:', JSON.stringify(result.data, null, 2));
  console.log();

  // Available tools
  const tools = getAllToolDefinitions();
  console.log(`🔧 Available tools (${tools.length}): ${tools.map(t => t.name).join(', ')}\n`);

  // ReAct loop demo
  console.log('── ReAct Loop Demo ──────────────────────\n');
  const engine = new DemoReActEngine();
  const result2 = await engine.run('List files in current directory and create a summary file');

  console.log('\n──────── Final Result ─────────');
  console.log('Success:', result2.success ? '✓' : '✗');
  if (result2.finalAnswer) {
    console.log('Answer:', result2.finalAnswer);
  }
  console.log(`\nSteps used: ${result2.steps.length}`);
  console.log('\nStep details:');
  result2.steps.forEach((s, i) => {
    console.log(`  [${i + 1}] ${s.action}`);
  });

  console.log('\n\n🎉 Demo complete!');
  console.log('\nNext steps:');
  console.log('1. npm install');
  console.log('2. Set POLLINATIONS_API_KEY');
  console.log('3. npm run build');
  console.log('4. npm run react "your actual task"');
  console.log('\nOr add to Claude Desktop as MCP server.');
}

main().catch(console.error);
