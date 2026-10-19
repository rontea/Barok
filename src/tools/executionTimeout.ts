/**
 * Tool Execution Timeout Protection
 * 
 * Provides configurable timeout and cancellation support for all tool executions,
 * preventing hanging subprocesses and ensuring predictable tool behavior.
 * 
 * Features:
 * - AbortController-based cancellation
 * - Configurable per-tool timeouts
 * - Runtime settings configuration
 * - Graceful cleanup and signal handling
 * - Detailed timeout error messages
 */

import { getRuntimeToolTimeouts } from '../config/runtimeSettings.js';

/**
 * Tool timeout configuration
 */
export interface ToolTimeoutConfig {
  /** Default timeout for all tools (ms) */
  default: number;
  /** Bash command timeout (ms) */
  bash: number;
  /** File operations timeout (ms) */
  fileOps: number;
  /** Glob pattern matching timeout (ms) */
  glob: number;
  /** Grep search timeout (ms) */
  grep: number;
  /** SubAgent tool timeout (ms) */
  subAgent: number;
}

/**
 * Default timeout configuration (in milliseconds)
 * Runtime overrides come from the typed RuntimeSettings store.
 */
export const DEFAULT_TOOL_TIMEOUTS: ToolTimeoutConfig = {
  default: 30000,  // 30 seconds
  bash: 30000,     // 30 seconds
  fileOps: 15000,  // 15 seconds
  glob: 10000,     // 10 seconds
  grep: 30000,     // 30 seconds
  subAgent: 120000, // 2 minutes
};

/**
 * Tool execution timeout error
 */
export class ToolTimeoutError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly timeoutMs: number,
    public readonly operation: string = 'Tool execution',
  ) {
    super(
      `Error: "${toolName}" ${operation} timed out\n` +
      `Cause: Operation did not complete within ${timeoutMs}ms limit\n` +
      `Suggested Fix: Increase timeout, optimize tool performance, or break into smaller tasks\n` +
      `Context: Tool: ${toolName}, Timeout: ${timeoutMs}ms, Operation: ${operation}`
    );
    this.name = 'ToolTimeoutError';
  }
}

/**
 * Tool execution cancelled error
 */
export class ToolCancellationError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly reason: string = 'Execution cancelled',
  ) {
    super(
      `Error: "${toolName}" execution was cancelled\n` +
      `Cause: ${reason}\n` +
      `Suggested Fix: Review cancellation reason. If unintended, retry operation. Check system resources.\n` +
      `Context: Tool: ${toolName}, Reason: ${reason}`
    );
    this.name = 'ToolCancellationError';
  }
}

/**
 * Result from a timeout-protected operation
 */
export interface TimeoutProtectedResult<T> {
  success: boolean;
  data?: T;
  error?: Error | string;
  timedOut: boolean;
  cancelled: boolean;
  executionTimeMs: number;
}

/**
 * Executes a function with timeout protection
 * 
 * @param fn - Async function to execute
 * @param toolName - Name of the tool (for error messages)
 * @param timeoutMs - Timeout in milliseconds
 * @param signal - Optional AbortSignal for cancellation
 * @returns Result with success status and timing information
 */
export async function executeWithTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  toolName: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<TimeoutProtectedResult<T>> {
  const startTime = Date.now();

  // Create combined abort controller for both timeout and external cancellation
  const controller = new AbortController();
  // Always pass the controller signal to the handler. Passing the external
  // signal directly would make the local timeout abort the controller without
  // actually cancelling the running tool.
  const combinedSignal = controller.signal;

  // Listen for external cancellation
  let externalCancelled = false;
  const cancelHandler = () => {
    externalCancelled = true;
    controller.abort(signal?.reason);
  };
  if (signal) {
    if (signal.aborted) cancelHandler();
    signal.addEventListener('abort', cancelHandler);
  }

  // Set timeout
  let timeoutId: NodeJS.Timeout | undefined;
  let timedOut = false;

  try {
    if (signal?.aborted) {
      externalCancelled = true;
      return {
        success: false,
        error: new ToolCancellationError(toolName, 'External cancellation'),
        timedOut: false,
        cancelled: true,
        executionTimeMs: Date.now() - startTime,
      };
    }

    let rejectOnTimeout!: (error: Error) => void;
    const timeoutPromise = new Promise<never>((_, reject) => {
      rejectOnTimeout = reject;
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort(new ToolTimeoutError(toolName, timeoutMs));
        rejectOnTimeout(new ToolTimeoutError(toolName, timeoutMs));
      }, timeoutMs);
    });
    // A handler may not observe AbortSignal. The race makes the boundary
    // authoritative while the catch prevents a late handler rejection from
    // becoming an unhandled process error.
    const operationPromise = Promise.resolve().then(() => fn(combinedSignal));
    operationPromise.catch(() => undefined);
    const data = await Promise.race([operationPromise, timeoutPromise]);
    clearTimeout(timeoutId);

    return {
      success: true,
      data,
      timedOut: false,
      cancelled: false,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    // Determine error type
    if (timedOut) {
      return {
        success: false,
        error: new ToolTimeoutError(toolName, timeoutMs),
        timedOut: true,
        cancelled: false,
        executionTimeMs: Date.now() - startTime,
      };
    }

    if (externalCancelled || combinedSignal.aborted) {
      return {
        success: false,
        error: new ToolCancellationError(toolName, 'External cancellation'),
        timedOut: false,
        cancelled: true,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Regular error
    return {
      success: false,
      error: error instanceof Error ? error : String(error),
      timedOut: false,
      cancelled: false,
      executionTimeMs: Date.now() - startTime,
    };
  } finally {
    // Clean up event listener
    if (signal) {
      signal.removeEventListener('abort', cancelHandler);
    }
  }
}

/**
 * Higher-order function to wrap a tool with timeout protection
 * 
 * @param fn - Tool function to wrap
 * @param toolName - Name of the tool
 * @param timeoutMs - Timeout in milliseconds
 * @returns Wrapped function with timeout protection
 */
export function withTimeout<Args extends any[], R>(
  fn: (args: Args, signal: AbortSignal) => Promise<R>,
  toolName: string,
  timeoutMs: number,
): (args: Args, signal?: AbortSignal) => Promise<TimeoutProtectedResult<R>> {
  return async (args: Args, signal?: AbortSignal) => {
    return executeWithTimeout(
      (sig) => fn(args, sig),
      toolName,
      timeoutMs,
      signal,
    );
  };
}

/**
 * Creates a cancellation token (AbortController) with optional timeout
 * 
 * @param timeoutMs - Optional timeout in milliseconds
 * @returns AbortController for cancellation control
 */
export function createCancellationToken(timeoutMs?: number): AbortController {
  const controller = new AbortController();

  if (timeoutMs && timeoutMs > 0) {
    setTimeout(() => controller.abort(), timeoutMs);
  }

  return controller;
}

/**
 * Checks if a signal has been aborted (safe utility)
 */
export function isSignalAborted(signal?: AbortSignal): boolean {
  return signal?.aborted ?? false;
}

/**
 * Utility to wait for abort signal (for graceful shutdown)
 */
export async function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

/**
 * Get timeout for a specific tool
 */
export function getToolTimeout(toolName: string, config?: ToolTimeoutConfig): number {
  const activeConfig = config || getRuntimeToolTimeouts();
  switch (toolName.toLowerCase()) {
    case 'bash':
      return activeConfig.bash;
    case 'read':
    case 'write':
    case 'edit':
      return activeConfig.fileOps;
    case 'glob':
      return activeConfig.glob;
    case 'grep':
      return activeConfig.grep;
    case 'subagent':
      return activeConfig.subAgent;
    default:
      return activeConfig.default;
  }
}

/**
 * Format timeout error for user display
 */
export function formatTimeoutError(error: Error | string, toolName: string): string {
  if (error instanceof ToolTimeoutError) {
    return `${toolName} execution timed out after ${error.timeoutMs}ms`;
  }
  if (error instanceof ToolCancellationError) {
    return `${toolName} was cancelled: ${error.reason}`;
  }
  return `${toolName} error: ${error instanceof Error ? error.message : String(error)}`;
}
