/**
 * Phase 7: Real Agent Execution Streaming Endpoint
 *
 * Routes agent task execution through the ReAct engine and streams real tool,
 * file, command, verification, and completion events to the UI.
 */

import type { Response } from 'express';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { ReActEngine } from '../react/engine.js';
import type { ReactResult } from '@barok/engine';
import type { AgentStreamEvent } from '../react/state-manager.js';
import { getServerRunManager, type RunExecutionContext } from '../react/run-manager.js';
import { analyzeCoderTask, type CoderTaskAnalysis } from '../coder/taskAnalysis.js';
import { buildProjectFileMap } from '../coder/projectFileMap.js';
import { getConfiguredCoderModelSelection } from '../config/coderModel.js';
import { CONTINUOUS_RUN_COST_LIMIT, CONTINUOUS_RUN_STEP_LIMIT } from '../react/continuous-run.js';

const execFileAsync = promisify(execFile);

/**
 * Agent execution stream event types and payloads
 */
export interface AgentExecutionStreamEvent {
  type:
    | 'task-assigned'
    | 'execution-start'
    | 'progress-update'
    | 'file-change'
    | 'command-executed'
    | 'verification-start'
    | 'verification-complete'
    | 'error'
    | 'completion'
    | 'done';
  taskId: string;
  agentRole?: string;
  data: any;
  timestamp?: number;
}

/**
 * Request body for agent execution streaming
 */
export interface AgentExecutionRequest {
  taskId: string;
  agentRole: string;
  userRequest: string;
  ownedFiles: string[];
  workspace?: string;
  model?: string;
  allowCrossProviderFallback?: boolean;
  approvedFallbackProviders?: string[];
  fallbackApprovalGranted?: boolean;
  allowedExternalProviders?: string[];
}

export interface VerificationCommandResult {
  command: string;
  available: boolean;
  skipped?: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  duration: number;
  reason?: string;
}

export interface AgentExecutionCompletion {
  implementationCompleted: boolean;
  failedVerification: boolean;
  verificationStatus: 'passed' | 'failed' | 'blocked' | 'incomplete' | 'unavailable';
  verificationPassed: boolean;
}

/** Keeps post-run test failures separate from whether the implementation ran to completion. */
export function resolveAgentExecutionCompletion(
  result: Pick<ReactResult, 'success' | 'executionCompleted' | 'verificationStatus'>,
  verificationResults: VerificationCommandResult[],
): AgentExecutionCompletion {
  const failedVerification = verificationResults.some((item) => item.available && item.exitCode !== 0);
  const implementationCompleted = result.success || result.executionCompleted === true;
  const verificationStatus = failedVerification || result.verificationStatus === 'failed'
    ? 'failed'
    : result.verificationStatus || 'passed';
  return {
    implementationCompleted,
    failedVerification,
    verificationStatus,
    verificationPassed: !failedVerification && result.verificationStatus !== 'failed',
  };
}

export interface RealAgentExecutionRunner {
  (request: Required<Pick<AgentExecutionRequest, 'taskId' | 'agentRole' | 'userRequest'>> &
    Omit<AgentExecutionRequest, 'taskId' | 'agentRole' | 'userRequest'>,
    context: RunExecutionContext): Promise<unknown>;
}

let injectedRunner: RealAgentExecutionRunner | undefined;

export function setAgentExecutionRunnerForTests(runner?: RealAgentExecutionRunner): void {
  injectedRunner = runner;
}

function resolveWorkspaceRoot(workspace?: string): string {
  return path.resolve(workspace || process.cwd());
}

function makePayload(
  type: AgentExecutionStreamEvent['type'],
  taskId: string,
  agentRole: string,
  data: any
): AgentExecutionStreamEvent {
  return {
    type,
    taskId,
    agentRole,
    data,
    timestamp: Date.now(),
  };
}

function emitAgentEvent(
  emit: RunExecutionContext['emit'],
  type: AgentExecutionStreamEvent['type'],
  taskId: string,
  agentRole: string,
  data: any
): void {
  const payload = makePayload(type, taskId, agentRole, data);
  emit(type, payload);
}

async function readPackageScripts(workspaceRoot: string): Promise<Record<string, string>> {
  try {
    const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, 'package.json'), 'utf-8'));
    return packageJson && typeof packageJson.scripts === 'object' && packageJson.scripts
      ? packageJson.scripts
      : {};
  } catch {
    return {};
  }
}

export function selectVerificationScriptNames(
  analysis: CoderTaskAnalysis,
  scripts: Record<string, string>
): string[] {
  const requested: string[] = [];

  if (analysis.expectedChangeIntent === 'read_only' || analysis.taskKind === 'investigation' || analysis.taskKind === 'question') {
    return [];
  }

  if (analysis.taskKind === 'docs_only') {
    if (scripts.lint) requested.push('lint');
    return requested;
  }

  if (analysis.taskKind === 'test_only') {
    requested.push('test:unit', 'test');
  } else if (analysis.taskKind === 'bug_fix') {
    requested.push('test:unit', 'lint');
  } else if (analysis.taskKind === 'new_feature' || analysis.taskKind === 'refactor') {
    requested.push('test:unit', 'build');
  } else {
    requested.push('test:unit');
  }

  return Array.from(new Set(requested)).filter((script) => scripts[script]);
}

function expectedVerificationScriptNames(analysis: CoderTaskAnalysis): string[] {
  if (analysis.expectedChangeIntent === 'read_only' || analysis.taskKind === 'investigation' || analysis.taskKind === 'question') {
    return [];
  }
  if (analysis.taskKind === 'docs_only') return ['lint'];
  if (analysis.taskKind === 'test_only') return ['test:unit', 'test'];
  if (analysis.taskKind === 'bug_fix') return ['test:unit', 'lint'];
  if (analysis.taskKind === 'new_feature' || analysis.taskKind === 'refactor') return ['test:unit', 'build'];
  return ['test:unit'];
}

export async function runVerificationCommands(
  workspaceRoot: string,
  analysis: CoderTaskAnalysis,
  emit: RunExecutionContext['emit'],
  taskId: string,
  agentRole: string
): Promise<VerificationCommandResult[]> {
  const scripts = await readPackageScripts(workspaceRoot);
  const expected = expectedVerificationScriptNames(analysis);
  const selected = selectVerificationScriptNames(analysis, scripts);
  const unavailable = expected.filter((script) => !scripts[script]);

  emitAgentEvent(emit, 'verification-start', taskId, agentRole, {
    status: 'verifying',
    message: selected.length
      ? 'Starting verification commands'
      : unavailable.length
        ? `Verification scripts unavailable: ${unavailable.join(', ')}`
        : 'No mutation verification required',
    checksCount: selected.length + unavailable.length,
    commands: selected.map((script) => `npm run ${script}`),
    unavailable,
  });

  const results: VerificationCommandResult[] = unavailable.map((script) => ({
    command: `npm run ${script}`,
    available: false,
    skipped: true,
    duration: 0,
    reason: `package.json does not define script "${script}"`,
  }));

  for (const script of selected) {
    const startedAt = Date.now();
    let result: VerificationCommandResult;
    try {
      const output = await execFileAsync('npm', ['run', script], {
        cwd: workspaceRoot,
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      });
      result = {
        command: `npm run ${script}`,
        available: true,
        exitCode: 0,
        stdout: output.stdout,
        stderr: output.stderr,
        duration: Date.now() - startedAt,
      };
    } catch (error: any) {
      result = {
        command: `npm run ${script}`,
        available: true,
        exitCode: typeof error?.code === 'number' ? error.code : 1,
        stdout: error?.stdout || '',
        stderr: error?.stderr || error?.message || String(error),
        duration: Date.now() - startedAt,
      };
    }

    results.push(result);
    emitAgentEvent(emit, 'command-executed', taskId, agentRole, {
      command: result.command,
      exitCode: result.exitCode,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      duration: result.duration,
    });
  }

  const availableResults = results.filter((result) => result.available);
  const checksPassed = availableResults.filter((result) => result.exitCode === 0).length;
  const checksFailed = availableResults.filter((result) => result.exitCode !== 0).length;

  emitAgentEvent(emit, 'verification-complete', taskId, agentRole, {
    checksTotal: results.length,
    checksPassed,
    checksFailed,
    unavailable: results.filter((result) => !result.available),
    results: results.map((result) => ({
      check: result.command,
      passed: result.available ? result.exitCode === 0 : false,
      skipped: result.skipped,
      duration: result.duration,
      reason: result.reason,
      stdout: result.stdout,
      stderr: result.stderr,
    })),
  });

  return results;
}

function translateReactEvent(
  event: AgentStreamEvent,
  emit: RunExecutionContext['emit'],
  taskId: string,
  agentRole: string,
  progress: { value: number },
  commandStarts: Map<string, number>
): void {
  switch (event.type) {
    case 'file_changed':
      emitAgentEvent(emit, 'file-change', taskId, agentRole, {
        file: event.path,
        status: 'modified',
        linesAdded: 0,
        linesRemoved: 0,
        diff: event.summary || `Changed ${event.path}`,
      });
      break;

    case 'command_started':
      commandStarts.set(event.command, Date.now());
      break;

    case 'command_output': {
      const startedAt = event.command ? commandStarts.get(event.command) : undefined;
      emitAgentEvent(emit, 'command-executed', taskId, agentRole, {
        command: event.command || 'command',
        exitCode: 0,
        stdout: event.output || '',
        stderr: '',
        duration: startedAt ? Date.now() - startedAt : 0,
      });
      break;
    }

    case 'verification_started':
      emitAgentEvent(emit, 'verification-start', taskId, agentRole, {
        status: 'verifying',
        message: event.command || 'Verification started',
        checksCount: 1,
      });
      break;

    case 'verification_result':
      emitAgentEvent(emit, 'verification-complete', taskId, agentRole, {
        checksTotal: 1,
        checksPassed: event.success ? 1 : 0,
        checksFailed: event.success ? 0 : 1,
        results: [{ check: 'ReAct verification', passed: event.success, output: event.output }],
      });
      break;

    case 'error':
      emitAgentEvent(emit, 'error', taskId, agentRole, { error: event.message });
      break;

    case 'final':
      progress.value = Math.max(progress.value, 90);
      emitAgentEvent(emit, 'progress-update', taskId, agentRole, {
        progress: progress.value,
        status: 'executing',
        message: 'Final answer synthesized',
      });
      break;
  }
}

async function runRealAgentExecution(
  request: Required<Pick<AgentExecutionRequest, 'taskId' | 'agentRole' | 'userRequest'>> &
    Omit<AgentExecutionRequest, 'taskId' | 'agentRole' | 'userRequest'>,
  context: RunExecutionContext
): Promise<unknown> {
  const { taskId, agentRole, userRequest } = request;
  const ownedFiles = request.ownedFiles || [];
  const workspaceRoot = resolveWorkspaceRoot(request.workspace);
  const startedAt = Date.now();
  const progress = { value: 0 };
  const changedFiles = new Set<string>();
  const commandsRun = new Set<string>();
  const commandStarts = new Map<string, number>();

  // The streaming agent route is also used outside the managed server run
  // path. Build the same bounded project map here so semantic requests such
  // as "update add to cart" resolve to existing product/cart/script files.
  const projectFileMap = await buildProjectFileMap(workspaceRoot).catch(() => undefined);
  const analysis = analyzeCoderTask({
    message: userRequest,
    mode: 'agent',
    workspace: workspaceRoot,
    projectFileMap,
  });

  const emit = context.emit;

  emitAgentEvent(emit, 'task-assigned', taskId, agentRole, {
    status: 'assigned',
    message: `${agentRole} assigned to: ${userRequest}`,
    ownedFiles,
    analysis,
  });

  emitAgentEvent(emit, 'execution-start', taskId, agentRole, {
    status: 'executing',
    progress: 0,
    message: `${agentRole} starting real ReAct execution`,
  });

  const selectedModel = request.model?.trim() || getConfiguredCoderModelSelection();
  const engine = new ReActEngine({
    runId: taskId,
    threadId: taskId,
    threadTitle: userRequest.slice(0, 120),
    continuousRun: true,
    maxSteps: context.continuationStepBudget || CONTINUOUS_RUN_STEP_LIMIT,
    globalStepLimit: context.globalStepLimit,
    runStartedAt: context.runStartedAt,
    wallClockBudgetMs: context.wallClockBudgetMs,
    maxRecoveryTransitions: context.maxRecoveryTransitions,
    model: selectedModel,
    plannerModel: selectedModel,
    budget: CONTINUOUS_RUN_COST_LIMIT,
    workspace: workspaceRoot,
    taskAnalysis: analysis,
    signal: context.signal,
    allowCrossProviderFallback: false,
    approvedFallbackProviders: [],
    sameProviderFallbackModels: [],
    fallbackApprovalGranted: false,
    allowedExternalProviders: request.allowedExternalProviders,
    requestUserInput: context.requestUserInput,
    onProgress: (message) => {
      progress.value = Math.min(85, progress.value + 10);
      emitAgentEvent(emit, 'progress-update', taskId, agentRole, {
        progress: progress.value,
        status: 'executing',
        message,
      });
    },
    onEvent: (event) => {
      if (event.type === 'file_changed') changedFiles.add(event.path);
      if (event.type === 'command_output' && event.command) commandsRun.add(event.command);
      translateReactEvent(event, emit, taskId, agentRole, progress, commandStarts);
    },
  });

  const result = await engine.run(userRequest);
  const verificationResults = await runVerificationCommands(workspaceRoot, analysis, emit, taskId, agentRole);
  const completion = resolveAgentExecutionCompletion(result, verificationResults);
  const { failedVerification, implementationCompleted, verificationStatus } = completion;

  emitAgentEvent(emit, 'completion', taskId, agentRole, {
    // Verification failure is a quality result, not an execution transport
    // failure. The implementation is still registered as completed when the
    // ReAct engine reached its own successful terminal state.
    status: implementationCompleted ? 'completed' : 'failed',
    progress: 100,
    message: implementationCompleted
      ? failedVerification
        ? `${agentRole} completed real execution with verification failures`
        : `${agentRole} completed real execution`
      : `${agentRole} execution finished with errors`,
    summary: {
      filesModified: changedFiles.size,
      commandsRun: commandsRun.size + verificationResults.filter((item) => item.available).length,
      verificationsRun: verificationResults.length,
      confidenceScore: implementationCompleted && !failedVerification ? 0.9 : implementationCompleted ? 0.55 : 0.15,
      executionTimeMs: Date.now() - startedAt,
      finalAnswer: result.finalAnswer || result.result,
      error: result.error,
      verificationStatus,
      verificationFailures: verificationResults.filter((item) => item.available && item.exitCode !== 0).map((item) => item.command),
    },
  });

  return {
    // Keep `success` tied to implementation execution. Consumers can inspect
    // verificationStatus/verificationResults without losing the completed
    // run record when a post-run test command fails.
    success: implementationCompleted,
    executionCompleted: implementationCompleted,
    verificationStatus,
    verificationPassed: completion.verificationPassed,
    result,
    verificationResults,
    changedFiles: Array.from(changedFiles),
    commandsRun: Array.from(commandsRun),
    totalExecutionTimeMs: Date.now() - startedAt,
  };
}

/**
 * Main streaming handler for agent execution
 */
export async function streamAgentExecution(req: any, res: Response): Promise<void> {
  const {
    taskId, agentRole, userRequest, ownedFiles, workspace, model,
    allowCrossProviderFallback, approvedFallbackProviders,
    fallbackApprovalGranted, allowedExternalProviders,
  } = req.body as AgentExecutionRequest;

  if (!taskId || !agentRole || !userRequest) {
    res.status(400).json({
      error: 'Missing required fields: taskId, agentRole, userRequest',
    });
    return;
  }

  try {
    const runner = injectedRunner || runRealAgentExecution;
    const runManager = getServerRunManager();
    const run = runManager.startRun(
      {
        kind: 'agent',
        task: userRequest,
        workspace,
        model,
        metadata: {
          taskId,
          agentRole,
          ownedFiles: ownedFiles || [],
          allowCrossProviderFallback: false,
          approvedFallbackProviders: [],
          fallbackApprovalGranted: false,
          continuousRun: true,
          ...(Array.isArray(allowedExternalProviders) ? { allowedExternalProviders } : {}),
        },
      },
      async (context) => {
        const result = await runner({
          taskId,
          agentRole,
          userRequest,
          ownedFiles: ownedFiles || [],
          workspace,
          model,
          allowCrossProviderFallback,
          approvedFallbackProviders,
          fallbackApprovalGranted,
          allowedExternalProviders,
        }, context);

        if (
          result &&
          typeof result === 'object' &&
          (result as Record<string, unknown>).type === 'done'
        ) {
          return result;
        }

        return makePayload('done', taskId, agentRole, {
          status: 'done',
          result,
        });
      }
    );

    runManager.subscribe(run.id, res, 0);
    await runManager.waitForRun(run.id);
  } catch (error: any) {
    console.error('Agent execution streaming error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: error.message || 'Unknown error during agent execution',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
  }
}

/**
 * Express route handler wrapper
 */
export async function handleAgentExecutionRequest(req: any, res: Response): Promise<void> {
  return streamAgentExecution(req, res);
}
