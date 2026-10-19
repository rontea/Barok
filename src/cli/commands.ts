import { Command } from 'commander';
import dotenv from 'dotenv';
import { join } from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { exit } from 'process';

import { startMCPServer } from '../mcp/server.js';
import { ReActEngine } from '../react/engine.js';
import { pollinationsClient } from '../pollinations/client.js';
import { logBanner, logSuccess, logError, logWarning, logInfo } from './ui.js';
import { ensureApiKey, checkApiHealth } from './prompts.js';
import { question, questionYN, rl } from './startup.js';
import { getConfiguredCoderModelSelection } from '../config/coderModel.js';

dotenv.config();

const program = new Command();

// ============================================================================
// MCP SERVER
// ============================================================================

/**
 * Registers the 'mcp' command for starting the Model Context Protocol server.
 * 
 * Starts an MCP server compatible with Claude Desktop, Cursor, Continue, and other MCP clients.
 * Requires POLLINATIONS_API_KEY to be set in environment or .env file.
 * Uses stderr for logging (stdout is reserved for JSON-RPC protocol messages).
 * 
 * Options:
 * - --debug: Enable debug logging (default: false)
 * 
 * @returns {void}
 * @example
 * setupMcpCommand();
 * // Then run: npm start -- mcp --debug
 */
export function setupMcpCommand() {
  program
    .command('mcp')
    .description('Start MCP server (Claude Desktop / Cursor / Continue)')
    .option('--debug', 'Enable debug logging', false)
    .action(async (options) => {
      // MCP clients like Continue.dev and Claude Desktop use stdout for JSON-RPC.
      // ANY console.log will corrupt the protocol.
      console.error(chalk.gray('Starting MCP server...'));
      console.error(chalk.gray('Connect from Claude Desktop, Cursor, Continue, or any MCP client\n'));
      
      // Non-interactive API key check
      const apiKey = process.env.POLLINATIONS_API_KEY;
      if (!apiKey) {
        console.error(chalk.red('❌ POLLINATIONS_API_KEY is not set in environment or .env.'));
        console.error(chalk.gray('For MCP usage, please ensure it is set in your MCP client config env variables, or in the local .env file.'));
        console.error(chalk.yellow('⚠️ Proceeding anyway (some tools may fail if they require the API key).'));
      } else {
        pollinationsClient.setApiKey(apiKey);
      }
      
      await startMCPServer(options.debug);
    });
}

// ============================================================================
// BALANCE CHECK
// ============================================================================

/**
 * Registers the 'balance' command for checking Pollinations account balance.
 * 
 * Displays the current pollen balance associated with the API key.
 * Requires a valid API key (preferably a secret key 'sk_' for full account information).
 * Warns if balance is low (< 10 pollen).
 * 
 * @returns {void}
 * @example
 * setupBalanceCommand();
 * // Then run: npm start -- balance
 */
export function setupBalanceCommand() {
  program
    .command('balance')
    .description('Check your Pollinations pollen balance')
    .action(async () => {
      logBanner();
      const apiKey = await ensureApiKey();

      try {
        const balance = await pollinationsClient.getBalance();
        if (balance) {
          console.log(`💰 Current balance: ${balance.pollen} ${balance.currency}`);
          if (balance.pollen < 10) {
            logWarning('Low balance — add more at https://enter.pollinations.ai');
          }
        } else {
          console.log(
            chalk.yellow('⚠️  Balance check requires a secret API key (sk_...)')
          );
          console.log(
            chalk.gray('   Get a secret key at: https://enter.pollinations.ai')
          );
        }
      } catch (error: any) {
        logError(`Failed to fetch balance: ${error.message}`);
        rl.close();
        process.exit(1);
      }
    });
}

// ============================================================================
// REACT LOOP
// ============================================================================

/**
 * Registers the 'react' command for running a ReAct loop to solve tasks.
 * 
 * Executes a reasoning + action loop powered by LLM reasoning and tool use.
 * Validates API connectivity, checks pollen balance, and provides detailed task execution results.
 * 
 * Arguments:
 * - task: Task description (required)
 * 
 * Options:
 * - --model: LLM model to use (default: the persisted OpenRouter Settings route)
 * - --max-steps: Internal checkpoint window for one autonomous turn (default: MAX_STEPS env or 10)
 * - --budget: Maximum pollen to spend (default: BUDGET env or 100)
 * - --verbose: Show the action trace (default: false)
 * 
 * @returns {void}
 * @example
 * setupReactCommand();
 * // Then run: npm start -- react "What is the capital of France?"
 * // Or: npm start -- react "Write a function" --model openai-large --budget 50 --verbose
 */
export function setupReactCommand() {
  program
    .command('react')
    .description('Run a ReAct loop to solve a task')
    .argument('<task>', 'Task description')
    .option(
      '--model <model>',
      'Pollinations model to use',
      getConfiguredCoderModelSelection()
    )
    .option(
      '--max-steps <n>',
      'Internal checkpoint window for one autonomous turn',
      process.env.MAX_STEPS || '10'
    )
    .option(
      '--budget <pollen>',
      'Maximum pollen to spend (approximate)',
      process.env.BUDGET || '100'
    )
    .option(
      '--thinking-depth <depth>',
      'Reasoning depth: fast, balanced, or deep',
      process.env.THINKING_DEPTH || 'balanced'
    )
    .option('--verbose', 'Verbose logging', false)
    .action(async (task, options) => {
      logBanner();
      console.log(chalk.white(`🎯 Task: ${chalk.bold(task)}\n`));

      const apiKey = await ensureApiKey();

      // Health check
      const health = await checkApiHealth(options.verbose);
      if (!health.ok) {
        logError('Cannot connect to Pollinations API');
        logInfo('Check internet and verify your API key');
        console.log(chalk.gray('   Test with: npm run test\n'));
        rl.close();
        process.exit(1);
      }

      // Balance check — only warn, don't block (unless we know balance is truly < budget)
      const budget = parseFloat(options.budget);
      const balance = health.balance ?? null;
      if (health.hasScope && balance !== null && balance < budget) {
        logWarning(
          `Budget (${budget} pollen) exceeds balance (${balance} pollen)`
        );
        const proceed = await questionYN(
          'Continue anyway? (will stop when balance depletes)'
        );
        if (!proceed) {
          const suggested = Math.max(1, Math.floor((balance || 1) * 0.8));
          console.log(chalk.gray(`Tip: use --budget ${suggested} or lower`));
          rl.close();
          process.exit(0);
        }
      } else if (!health.hasScope && health.ok) {
        // Key works but can't check actual balance — warn user to verify manually
        logWarning('Cannot verify pollen balance (API key lacks account:usage scope)');
        console.log(chalk.gray(`   Proceeding with budget: ${budget} pollen`));
        console.log(chalk.yellow('   Ensure you have sufficient pollen at: https://enter.pollinations.ai'));
        console.log(chalk.yellow('   Add more if tasks fail with 402 errors\n'));
      }

      // Show config
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`⚙️  Configuration:`);
      console.log(`   Model: ${chalk.cyan(options.model)}`);
      console.log(`   Thinking depth: ${chalk.cyan(options.thinkingDepth)}`);
      console.log(`   Budget: ${chalk.cyan(budget)} pollen`);

      if (balance !== null) {
        const percentOfBalance = balance > 0
          ? (budget / balance * 100).toFixed(1)
          : '∞';
        console.log(
          `   Balance: ${chalk.green(balance.toString())} pollen (${percentOfBalance}% of budget)`
        );
      }
      console.log(chalk.gray('─'.repeat(50) + '\n'));

      // Run engine
      const engine = new ReActEngine({
        model: options.model,
        maxSteps: parseInt(options.maxSteps, 10),
        thinkingDepth: options.thinkingDepth,
        verbose: options.verbose,
        budget: budget,
      });

      const result = await engine.run(task);

      // ========================================================================
      // RESULTS
      // ========================================================================
      console.log(chalk.gray('\n' + '─'.repeat(50)));

      if (result.success) {
        console.log(chalk.green.bold('\n✅ Task Complete!\n'));
        console.log(chalk.white('Final answer:'));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(chalk.white(result.finalAnswer));
        console.log(chalk.gray('─'.repeat(40)));
      } else {
        console.log(chalk.red.bold('\n❌ Task Incomplete\n'));
        console.log(chalk.red(`Error: ${result.error}`));
        if (
          result.error?.includes('balance') ||
          result.error?.includes('402') ||
          result.error?.includes('Budget')
        ) {
          console.log(chalk.yellow('\n💡 Add pollen: https://enter.pollinations.ai'));
          console.log(chalk.yellow('   Or use: --budget <smaller-number>\n'));
        }
      }

      console.log(chalk.white(`\n📊 Statistics:`));
      if (result.pollenCost) {
        console.log(`   Pollen spent: ${chalk.yellow(`~${result.pollenCost.toFixed(4)}`)}`);
        if (balance !== null) {
          const remaining = balance - result.pollenCost;
          console.log(
            `   Remaining: ${
              remaining > 0 ? chalk.green(remaining.toFixed(4)) : chalk.red(remaining.toFixed(4))
            } pollen`
          );
        }
      }

      if (options.verbose && result.steps.length > 0) {
        console.log(chalk.white('\n🔍 Action trace:'));
        result.steps.forEach((step: any, i: number) => {
          console.log(chalk.gray(`\n   ${'─'.repeat(40)}`));
          console.log(chalk.cyan(`   Action ${i + 1}`));
          console.log(chalk.white(`   Thought: ${(step.thought || '').substring(0, 120)}...`));
          console.log(chalk.magenta(`   Action: ${step.action}`));
          console.log(
            chalk.gray(
              `   Input: ${JSON.stringify(step.action_input).substring(0, 80)}...`
            )
          );
          console.log(
            chalk.gray(
              `   Observation: ${((step.observation || '') as string).substring(0, 120)}...`
            )
          );
          if (step.pollenCost) {
            console.log(chalk.yellow(`   Cost: ~${step.pollenCost} pollen`));
          }
        });
      }

      console.log('');
      rl.close();
    });
}

// ============================================================================
// CREW DELEGATION (MULTI-AGENT)
// ============================================================================

/**
 * Registers the 'crew' command for delegating complex tasks to multiple specialized agents.
 * 
 * Breaks down a complex task and assigns sub-tasks to specialized agents (Coder, Tester, Reviewer, etc.)
 * for multi-agent orchestration and collaborative problem solving.
 * Validates API connectivity before execution.
 * 
 * Arguments:
 * - task: Complex task description (required)
 * 
 * Options:
 * - --model: LLM model for sub-agents (default: the persisted OpenRouter Settings route)
 * 
 * @returns {void}
 * @example
 * setupCrewCommand();
 * // Then run: npm start -- crew "Build and test a Node.js REST API"
 */
export function setupCrewCommand() {
  program
    .command('crew')
    .description('Run a complex task broken down and delegated to multiple specialized agents (Coder, Tester, Reviewer, etc.)')
    .argument('<task>', 'Complex task description')
    .option(
      '--model <model>',
      'Pollinations model to use for the sub-agents',
      getConfiguredCoderModelSelection()
    )
    .action(async (task, options) => {
      logBanner();
      console.log(chalk.white(`🎯 Complex Task: ${chalk.bold(task)}\n`));
      console.log(chalk.gray('This will break down the task and assign sub-tasks to specialized agents.\n'));

      const apiKey = await ensureApiKey();

      // Health check
      const health = await checkApiHealth(false);
      if (!health.ok) {
        logError('Cannot connect to Pollinations API');
        rl.close();
        process.exit(1);
      }

      pollinationsClient.setApiKey(apiKey);

      // Import dynamically so it doesn't break CLI when crew.ts has issues or if not used
      const { CrewCoordinator } = await import('../agents/crew.js');
      
      // Initialize a multi-agent system with the specified model
      const crew = new CrewCoordinator(pollinationsClient, options.model);

      console.log(chalk.cyan(`🤖 Initializing Crew with model: ${options.model}`));
      
      try {
        // Orchestrate the complex task automatically
        const answer = await crew.orchestrateComplexTask(task);

        console.log(chalk.gray('\n' + '─'.repeat(50)));
        console.log(chalk.green.bold('\n✅ Crew Execution Complete!\n'));
        console.log(chalk.white('Final synthesized result:'));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(chalk.white(answer));
        console.log(chalk.gray('─'.repeat(40)));

      } catch (error: any) {
        logError(`Crew execution failed: ${error.message}`);
      }

      console.log('');
      rl.close();
    });
}

// ============================================================================
// PRIMARY ORCHESTRATOR COMMAND (Gemini 3.6 Flash)
// ============================================================================

/**
 * Registers the 'orchestrator' command for using Gemini 3.6 Flash as primary orchestrator.
 * 
 * This command leverages Gemini 3.6 Flash for:
 * - Task planning and decomposition
 * - ReAct loop control and orchestration decisions
 * - Intelligent agent delegation
 * - Result synthesis and consolidation
 * 
 * Arguments:
 * - task: Complex task description (required)
 * 
 * @returns {void}
 * @example
 * setupOrchestratorCommand();
 * // Then run: npm start -- orchestrator "Build and test a Node.js REST API"
 */
export function setupOrchestratorCommand() {
  program
    .command('orchestrator')
    .alias('orch')
    .description('Run a complex task with Gemini 3.6 Flash as the PRIMARY ORCHESTRATOR (task planning, ReAct loop control, delegation, synthesis)')
    .argument('<task>', 'Complex task description')
    .action(async (task) => {
      logBanner();
      console.log(chalk.blue.bold('\n🎯 PRIMARY ORCHESTRATOR MODE (Gemini 3.6 Flash)\n'));
      console.log(chalk.cyan(`Task: ${chalk.bold(task)}\n`));
      console.log(chalk.gray('This will use Gemini 3.6 Flash to orchestrate task planning,'));
      console.log(chalk.gray('delegation decisions, and result synthesis.\n'));

      const apiKey = await ensureApiKey();

      // Health check
      const health = await checkApiHealth(false);
      if (!health.ok) {
        logError('Cannot connect to Pollinations API');
        rl.close();
        process.exit(1);
      }

      pollinationsClient.setApiKey(apiKey);

      // Verify Gemini API is configured
      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        logError('GEMINI_API_KEY environment variable is not set');
        console.log(chalk.yellow('\nTo use the primary orchestrator, set your Gemini API key:'));
        console.log(chalk.gray('  export GEMINI_API_KEY="your_gemini_key_here"\n'));
        rl.close();
        process.exit(1);
      }

      // Import dynamically
      const { CrewCoordinator } = await import('../agents/crew.js');
      
      // Initialize crew with orchestrator
      const crew = new CrewCoordinator(pollinationsClient, 'claude');

      console.log(chalk.cyan(`🚀 Initializing Gemini 3.6 Flash Orchestrator...\n`));
      
      try {
        // Orchestrate the complex task using primary orchestrator
        const answer = await crew.orchestrateWithPrimaryOrchestrator(task);

        console.log(chalk.gray('\n' + '═'.repeat(50)));
        console.log(chalk.green.bold('\n✅ ORCHESTRATION COMPLETE!\n'));
        console.log(chalk.white('Final Synthesized Result:'));
        console.log(chalk.gray('═'.repeat(50)));
        console.log(chalk.white(answer));
        console.log(chalk.gray('═'.repeat(50)));

        // Display orchestrator metrics
        const metrics = crew.getOrchestratorMetrics();
        if (metrics.metrics) {
          console.log(chalk.cyan('\n📊 Orchestration Metrics:'));
          console.log(`   Total Time: ${(metrics.metrics.totalTime / 1000).toFixed(2)}s`);
          console.log(`   Tasks: ${metrics.metrics.completedTasks}/${metrics.metrics.totalTasks} completed`);
          console.log(`   ReAct Steps: ${metrics.metrics.reactSteps}`);
        }

      } catch (error: any) {
        logError(`Orchestration failed: ${error.message}`);
      }

      console.log('');
      rl.close();
    });
}

// ============================================================================
// QUICK DEMO
// ============================================================================

/**
 * Registers the 'demo' command for running a safe, low-cost demo task.
 * 
 * Executes a minimal ReAct task with a tiny budget (~0.5 pollen) to verify
 * that the entire system is working correctly without significant cost.
 * Useful for onboarding and validation.
 * 
 * @returns {void}
 * @example
 * setupDemoCommand();
 * // Then run: npm start -- demo
 */
export function setupDemoCommand() {
  program
    .command('demo')
    .description('Run a quick demo task (safe, low cost)')
    .action(async () => {
      logBanner();
      console.log(chalk.white('🧪 Running demo task...\n'));
      console.log(chalk.gray('This uses a tiny budget to verify everything works.\n'));

      const apiKey = await ensureApiKey();
      pollinationsClient.setApiKey(apiKey);

      const health = await checkApiHealth(false);
      if (!health.ok) {
        logError('API not reachable — check connection and API key');
        rl.close();
        process.exit(1);
      }

      const demoBudget = Math.min(2, health.balance ?? 2);
      console.log(chalk.gray(`Using budget: ${demoBudget} pollen\n`));

      const engine = new ReActEngine({
        model: 'openai-fast', // cheapest viable model with tools
        maxSteps: 2,
        verbose: false,
        budget: demoBudget,
      });

      const result = await engine.run('Say hello in one word');

      if (result.success) {
        console.log(chalk.green('\n✅ Demo complete!'));
        console.log(chalk.white('Response: ' + result.finalAnswer));
        if (result.pollenCost) {
          console.log(chalk.gray(`Pollen used: ~${result.pollenCost.toFixed(4)}`));
        }
      } else {
        logWarning('Demo did not complete');
        if (result.pollenCost) {
          console.log(chalk.gray(`Pollen spent: ~${result.pollenCost.toFixed(4)}`));
        }
      }

      console.log(chalk.white('\n💡 Next: npm run react "your task here"'));
      console.log('');
      rl.close();
    });
}

// ============================================================================
// DIAGNOSTICS
// ============================================================================

/**
 * Registers the 'doctor' command for diagnosing system configuration issues.
 * 
 * Runs comprehensive diagnostics to check:
 * - .env file configuration
 * - POLLINATIONS_API_KEY setting
 * - Dependencies installation (node_modules)
 * - Build artifacts presence
 * - API connectivity and authentication
 * - Account balance status
 * 
 * Reports all issues found and suggests fixes.
 * 
 * @returns {void}
 * @example
 * setupDoctorCommand();
 * // Then run: npm start -- doctor
 */
export function setupDoctorCommand() {
  program
    .command('doctor')
    .description('Run diagnostics and suggest fixes')
    .action(async () => {
      logBanner();
      console.log(chalk.white('🔧 Running diagnostics...\n'));

      const issues: string[] = [];

      const envPath = join(process.cwd(), '.env');
      if (!fs.existsSync(envPath)) {
        issues.push('❌ .env file not found');
        logWarning('Create .env with POLLINATIONS_API_KEY');
      } else {
        logSuccess('.env file exists');
        const env = dotenv.parse(fs.readFileSync(envPath, 'utf-8'));
        if (!env.POLLINATIONS_API_KEY) {
          issues.push('❌ POLLINATIONS_API_KEY missing from .env');
          logError('Add: POLLINATIONS_API_KEY=your_key_here');
        } else {
          logSuccess('POLLINATIONS_API_KEY configured');
        }
      }

      // Dependencies
      if (fs.existsSync(join(process.cwd(), 'node_modules'))) {
        logSuccess('Dependencies installed');
      } else {
        issues.push('❌ Run: npm install');
        logError('node_modules not found');
      }

      // Build
      if (fs.existsSync(join(process.cwd(), 'dist', 'cli.js'))) {
        logSuccess('Build artifacts present');
      } else {
        issues.push('⚠️  Build missing — run: npm run build');
        logWarning('Project not built yet');
      }

      // API connectivity
      const apiKey = process.env.POLLINATIONS_API_KEY;
      if (apiKey) {
        pollinationsClient.setApiKey(apiKey);
        const health = await checkApiHealth(false);
        if (health.ok) {
          logSuccess('Pollinations API reachable');
          const balance = health.balance ?? null;
          if (balance !== null) {
            if (balance > 0) {
              logSuccess(`Balance: ${balance} pollen`);
            } else {
              issues.push('⚠️  Balance is 0 — add pollen for ReAct');
              logWarning('Account has 0 pollen');
            }
          } else {
            logWarning('Balance check unavailable (no account:usage scope)');
          }
        } else {
          issues.push('❌ API connection failed');
          logError('Invalid key or network issue');
        }
      }

      console.log(chalk.white('\n' + '─'.repeat(50)));
      if (issues.length === 0) {
        console.log(chalk.green.bold('\n✅ All systems go!\n'));
        console.log(chalk.white('Try:'));
        console.log('  npm run demo      # Safe demo');
        console.log('  npm run react "hello"  # Your task');
        console.log('  npm run crew "large task" # Multi-agent task');
        console.log('  npm start -- mcp  # MCP server\n');
      } else {
        console.log(chalk.red.bold(`\n⚠️  ${issues.length} issue(s):\n`));
        issues.forEach(issue => console.log(chalk.white(`   ${issue}`)));
        console.log(chalk.white('\n💡 Fix: run the setup wizard'));
        console.log(chalk.cyan('   npm run setup\n'));
      }
    });
}

// ============================================================================
// API DIAGNOSTICS
// ============================================================================

/**
 * Registers the 'diagnose' command for comprehensive API health diagnostics.
 * 
 * Tests all configured APIs:
 * - Each configured Gemini account profile independently
 * - Pollinations API
 * 
 * Provides detailed error messages and suggested fixes.
 * 
 * @returns {void}
 * @example
 * setupDiagnosticCommand();
 * // Then run: npm start -- diagnose
 */
export function setupDiagnosticCommand() {
  program
    .command('diagnose')
    .alias('diag')
    .description('Run comprehensive API diagnostics')
    .action(async () => {
      try {
        const { runDiagnostics } = await import('../tools/diagnostics.js');
        await runDiagnostics();
      } catch (error) {
        console.error(chalk.red('Diagnostic failed:'), error);
        exit(1);
      }
    });
}

// ============================================================================
// TEST CONNECTION
// ============================================================================

/**
 * Registers the 'test' command for testing API connectivity and displaying account info.
 * 
 * Tests the Pollinations API connection with a sample request, retrieves and displays:
 * - Account balance and currency
 * - Available image models (count and sample names)
 * - Available text models (count and sample names)
 * - Specific error messages if API key is invalid or insufficient funds
 * 
 * Useful for validating configuration and checking available credits.
 * 
 * @returns {void}
 * @example
 * setupTestCommand();
 * // Then run: npm start -- test
 */
export function setupTestCommand() {
  program
    .command('test')
    .description('Test API connection and show account info')
    .action(async () => {
      logBanner();
      console.log(chalk.white('🧪 Testing API connection...\n'));

      const apiKey = await ensureApiKey();
      pollinationsClient.setApiKey(apiKey);

      try {
        // Test API with a simple request
        await pollinationsClient.chatCompletion({
          messages: [{ role: 'user', content: 'test' }],
          model: 'openai',
        });
        logSuccess('API request succeeded');
      } catch (error: any) {
        if (error.message.includes('402')) {
          logError('Insufficient pollen balance');
          console.log(chalk.yellow('   Add pollen: https://enter.pollinations.ai\n'));
        } else if (error.message.includes('401') || error.message.includes('403')) {
          logError('API key invalid or unauthorized');
          console.log(chalk.yellow('   Verify key: https://enter.pollinations.ai\n'));
        } else {
          logError(`API error: ${error.message}`);
        }
        rl.close();
        process.exit(1);
      }

      // Balance
      try {
        const balance = await pollinationsClient.getBalance();
        if (balance) {
          console.log(
            chalk.white(`\n💰 Account balance: ${chalk.green(balance.pollen + ' pollen')}`)
          );
          if (balance.pollen < 1) {
            logWarning('Very low balance — ReAct tasks need pollen');
          }
        } else {
          console.log(
            chalk.yellow('\n⚠️  Cannot check balance (key lacks account:usage scope)')
          );
          console.log(chalk.gray('   This is normal for public API keys\n'));
        }
      } catch {
        console.log(chalk.yellow('\n⚠️  Balance check unavailable\n'));
      }

      // Models
      try {
        const imageModels = await pollinationsClient.listModels('image');
        console.log(chalk.white(`🖼️  Image models (${imageModels.length}):`));
        const imgNames = imageModels.map((m: any) => m.name || m).slice(0, 6);
        console.log(chalk.gray(`   ${imgNames.join(', ')}${imageModels.length > 6 ? '...' : ''}`));

        const textModels = await pollinationsClient.listModels('text');
        console.log(chalk.white(`\n💬 Text models (${textModels.length}):`));
        const txtNames = textModels.map((m: any) => m.name || m).slice(0, 6);
        console.log(chalk.gray(`   ${txtNames.join(', ')}${textModels.length > 6 ? '...' : ''}`));
      } catch {
        logWarning('Could not fetch model list');
      }

      console.log(chalk.green('\n✅ All systems operational\n'));
      rl.close();
    });
}

// ============================================================================
// LIST MODELS
// ============================================================================

/**
 * Registers the 'models' command for listing available Pollinations AI models with pricing.
 * 
 * Fetches and displays available text models sorted by cost (lowest first).
 * Shows for each model:
 * - Model name and aliases
 * - Description
 * - Cost per 1K output tokens
 * - Tool support indicator (✓ or ✗)
 * - Chain-of-thought (CoT) reasoning support indicator
 * 
 * Provides helpful tips for model selection and usage.
 * 
 * @returns {void}
 * @example
 * setupModelsCommand();
 * // Then run: npm start -- models
 */
export function setupModelsCommand() {
  program
    .command('models')
    .description('List available Pollinations AI models with pricing')
    .action(async () => {
      logBanner();
      console.log(chalk.white('📚 Available Pollinations Models\n'));

      const apiKey = await ensureApiKey();
      pollinationsClient.setApiKey(apiKey);

      try {
        const textModels = await pollinationsClient.listModels('text');
        
        console.log(chalk.cyan('💬 Text Models (for reasoning/chat):\n'));
        
        // Sort by cost (lowest first)
        const sorted = textModels.sort((a: any, b: any) => {
          const costA = parseFloat(a.pricing?.completionTextTokens || '0');
          const costB = parseFloat(b.pricing?.completionTextTokens || '0');
          return costA - costB;
        });

        sorted.forEach((model: any, i: number) => {
          const costPer1K = (parseFloat(model.pricing?.completionTextTokens || '0') * 1000).toFixed(4);
          const tools = model.tools ? chalk.green('✓ tools') : chalk.red('✗ no tools');
          const reasoning = model.reasoning ? chalk.cyan('CoT') : '';
          const aliases = model.aliases?.length ? `(${model.aliases.slice(0,2).join(', ')})` : '';
          
          console.log(chalk.white(`  ${(i+1).toString().padStart(2)}. ${chalk.magenta(model.name.padEnd(25))} ${aliases}`));
          console.log(chalk.gray(`     ${model.description || 'No description'}`));
          console.log(chalk.yellow(`     Cost: ~${costPer1K} pollen / 1K output tokens   ${tools}   ${reasoning}`));
          console.log('');
        });

        console.log(chalk.white('💡 Tips:'));
        console.log('   • Fast & cheap: openai-fast, nova-fast, qwen-coder');
        console.log('   • Best reasoning: openai-large, kimi-k2.6, glm, nova-2');
        console.log('   • With tools: look for "✓ tools" above');
        console.log('   • Use: node dist/cli.js react --model <name> "your task"\n');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logError('Failed to fetch models: ' + message);
        console.log(chalk.gray('\nFallback model list (known models):'));
        console.log(chalk.white('  • openai-fast (fastest, cheapest)'));
        console.log(chalk.white('  • openai / claude-fast (balanced)'));
        console.log(chalk.white('  • openai-large / claude (most capable)'));
        console.log(chalk.white('  • mistral, llama, qwen (various)'));
      }
      rl.close();
    });
}

// ============================================================================
// SETUP WIZARD
// ============================================================================

/**
 * Registers the 'setup' command for the interactive setup wizard.
 * 
 * Guides users through a comprehensive setup process:
 * 1. API key input and validation
 * 2. Account verification and balance check
 * 3. Dependency installation (npm install)
 * 4. Project build (npm run build)
 * 
 * Saves configuration to .env file and provides next steps guidance.
 * 
 * @returns {void}
 * @example
 * setupSetupCommand();
 * // Then run: npm start -- setup
 */
export function setupSetupCommand() {
  program
    .command('setup')
    .description('Interactive setup wizard')
    .action(async () => {
      logBanner();
      console.log(
        chalk.white('👋 Welcome to the Raw ReAct MCP setup wizard!\n')
      );
      console.log(chalk.gray('Let\'s configure everything step by step.\n'));

      console.log(chalk.cyan('Step 1: Pollinations API Key'));
      console.log(chalk.gray('Get your free key at: https://enter.pollinations.ai\n'));

      let apiKey = process.env.POLLINATIONS_API_KEY;
      if (apiKey) {
        const use = await questionYN(
          `Found key (${apiKey.substring(0, 12)}...). Use existing?`
        );
        if (!use) apiKey = '';
      }

      if (!apiKey) {
        console.log(chalk.white('Enter your API key:'));
        try {
          apiKey = await question('> ');
        } catch {
          logError('No input');
          rl.close();
          process.exit(1);
        }
        apiKey = apiKey.trim();

        if (!apiKey) {
          logError('API key required');
          rl.close();
          process.exit(1);
        }
        if (!apiKey.startsWith('pk_') && !apiKey.startsWith('sk_')) {
          logError('Invalid key format — must start with pk_ or sk_');
          rl.close();
          process.exit(1);
        }
      }

      // Save .env
      const envPath = join(process.cwd(), '.env');
      const defaultEnv = `POLLINATIONS_API_KEY=${apiKey}
MAX_STEPS=10
BUDGET=100
`;
      if (fs.existsSync(envPath)) {
        let content = fs.readFileSync(envPath, 'utf-8');
        if (content.includes('POLLINATIONS_API_KEY=')) {
          content = content.replace(
            /POLLINATIONS_API_KEY=.*/g,
            `POLLINATIONS_API_KEY=${apiKey}`
          );
        } else {
          content += `\nPOLLINATIONS_API_KEY=${apiKey}\n`;
        }
        // Ensure other vars exist
        if (!content.includes('MAX_STEPS=')) content += `\nMAX_STEPS=10`;
        if (!content.includes('BUDGET=')) content += `\nBUDGET=100`;
        fs.writeFileSync(envPath, content);
      } else {
        fs.writeFileSync(envPath, defaultEnv);
      }
      logSuccess('Configuration saved to .env\n');

      // Balance
      console.log(chalk.cyan('Step 2: Checking account...'));
      pollinationsClient.setApiKey(apiKey);
      try {
        const balance = await pollinationsClient.getBalance();
        if (balance && balance.pollen > 0) {
          logSuccess(`Balance: ${balance.pollen} pollen`);
          console.log(chalk.gray(`   ≈ ${Math.floor(balance.pollen / 0.24)} steps available\n`));
        } else {
          logWarning('Balance: 0 or cannot check');
          console.log(chalk.yellow('   Add pollen at: https://enter.pollinations.ai\n'));
        }
      } catch {
        logWarning('Could not check balance');
      }

      // Install dependencies if needed
      console.log(chalk.cyan('Step 3: Dependencies'));
      if (!fs.existsSync(join(process.cwd(), 'node_modules'))) {
        console.log(chalk.gray('   Running npm install (this may take a minute)...'));
        try {
          require('child_process').execSync('npm install', { stdio: 'pipe' });
          logSuccess('Dependencies installed');
        } catch {
          logError('npm install failed — run manually');
        }
      } else {
        logSuccess('Dependencies already installed');
      }

      // Build
      console.log(chalk.cyan('Step 4: Build'));
      try {
        require('child_process').execSync('npm run build', { stdio: 'pipe' });
        logSuccess('Build complete');
      } catch {
        logError('Build failed — check errors above');
      }

      // Done
      console.log(chalk.gray('\n' + '─'.repeat(50)));
      console.log(chalk.green.bold('\n✅ Setup complete!\n'));
      console.log(chalk.white('Next steps:'));
      console.log('  npm run test       # Verify API works');
      console.log('  npm run balance    # See your balance');
      console.log('  npm run demo       # Try a safe demo');
      console.log('  npm run react "your task"  # Start using\n');
      console.log(chalk.white('For Claude Desktop:'));
      console.log(chalk.gray('  Add to: claude_desktop_config.json\n'));
      rl.close();
    });
}

// ============================================================================
// WELCOME COMMAND
// ============================================================================

export function setupWelcomeCommand() {
  program
    .command('welcome')
    .description('Show welcome and quick start guide')
    .action(() => {
      logBanner();
      console.log(
        chalk.white(`
Welcome to Raw ReAct MCP — your friendly AI agent assistant!

No time to read? Start here:

  1. ${chalk.cyan('npm run setup')}
     Walks you through API key setup and tests connection

  2. ${chalk.cyan('npm run doctor')}
     Checks if everything is installed correctly

  3. ${chalk.cyan('npm run demo')}
     Runs a safe demo (costs only ~0.5 pollen)

  4. ${chalk.cyan('npm run react "your task"')}
     Your first real AI agent task!
     
  5. ${chalk.cyan('npm run crew "large project"')}
     Delegate complex tasks to specialized agents (Coder, Tester, etc)

📋 Command Cheat Sheet:
  ${chalk.magenta('setup    ')}${chalk.white('Interactive setup wizard (recommended)')}
  ${chalk.magenta('doctor   ')}${chalk.white('Diagnose problems')}
  ${chalk.magenta('diagnose ')}${chalk.white('Run API diagnostics')}
  ${chalk.magenta('test     ')}${chalk.white('Test API and show models')}
  ${chalk.magenta('balance  ')}${chalk.white('Check pollen balance')}
  ${chalk.magenta('demo     ')}${chalk.white('Run safe demo (low cost)')}
  ${chalk.magenta('react    ')}${chalk.white('Run agent on a task (main command)')}
  ${chalk.magenta('crew     ')}${chalk.white('Delegates a complex task across a multi-agent crew')}
  ${chalk.magenta('mcp      ')}${chalk.white('Start MCP server for Claude Desktop')}
  ${chalk.magenta('welcome  ')}${chalk.white('Show this help')}

💰 Pollen (credits):
  • Cost per step varies by model (openai-fast ~0.001, openai-large ~0.04)
  • Check balance: npm run balance
  • Add pollen: https://enter.pollinations.ai
  • Control spending: --budget 10 for 10 pollen max
  • See all models: npm run models
  • Using npm? Use: npm run react -- --budget 10 "task" (note the --)

🔧 Need help?
  • Readme: README.md
  • Issues: https://github.com/your-repo/raw-react-mcp
  • Pollinations docs: https://pollinations.ai/docs

Happy agent building! 🤖
`)
      );
    });
}

// ============================================================================
// EXPORT AND SETUP
// ============================================================================

export function setupAllCommands() {
  setupMcpCommand();
  setupBalanceCommand();
  setupReactCommand();
  setupCrewCommand();
  setupOrchestratorCommand();
  setupDemoCommand();
  setupDoctorCommand();
  setupDiagnosticCommand();
  setupTestCommand();
  setupModelsCommand();
  setupSetupCommand();
  setupWelcomeCommand();
}

export function parseCommands() {
  program.parse();
}

export function setupProcessHandlers() {
  // Close readline on exit
  process.on('SIGINT', () => {
    rl.close();
    process.exit(0);
  });
}

export { program };
