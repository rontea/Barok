import type { ToolRegistry } from '../../di/types.js';
import { describe, expect, it, jest } from '@jest/globals';
import { executeAction } from '../executor.js';
import { validateToolInput } from '../tool-router.js';
import { getToolCapabilities } from '../shared-control.js';
import {
  actionSignature,
  parseStructuredToolResult,
  safeJsonStringify,
  ToolEvidenceLedger,
  ToolExecutionScheduler,
  ToolExecutionState,
} from '../tool-contract.js';

function registryFor(
  name: string,
  handler: jest.Mock,
  inputSchema: Record<string, unknown> = {},
  options: { timeoutMs?: number } = {},
): ToolRegistry {
  const tool = { name, description: name, inputSchema, handler, ...options };
  return {
    getAll: () => [tool] as any,
    get: (candidate: string) => candidate === name ? tool as any : undefined,
    getEnabled: () => [tool] as any,
    has: (candidate: string) => candidate === name,
    register: () => undefined,
    setEnabled: () => undefined,
    getNames: () => [name],
    size: () => 1,
  };
}

describe('tool capability contract', () => {
  it('exposes deterministic capability and action metadata', () => {
    expect(getToolCapabilities('Read')).toMatchObject({
      readOnly: true,
      mutating: false,
      idempotent: true,
      parallelSafe: true,
      executionMode: 'parallel',
      timeoutClass: 'short',
    });
    expect(actionSignature({ action: 'Read', action_input: { b: 2, a: 1 } }))
      .toBe(actionSignature({ action: 'Read', action_input: { a: 1, b: 2 } }));
  });

  it('validates required and typed inputs before invoking a handler', () => {
    const handler = jest.fn(async () => ({ success: true }));
    const registry = registryFor('Read', handler, {
      type: 'object', required: ['file_path'], properties: { file_path: { type: 'string' } },
    });
    expect(validateToolInput({ action: 'Read', action_input: {} }, registry)).toMatchObject({ valid: false });
    expect(validateToolInput({ action: 'Read', action_input: { file_path: 42 } }, registry).errors[0]).toContain('must be string');
  });

  it('validates enum-backed Command operations before dispatch', () => {
    const handler = jest.fn(async () => ({ success: true }));
    const registry = registryFor('Command', handler, {
      type: 'object',
      required: ['operation'],
      properties: { operation: { type: 'string', enum: ['list_directory', 'test'] } },
    });

    const result = validateToolInput({ action: 'Command', action_input: { operation: 'run_dev_server' } }, registry);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('must be one of');
  });

  it('records structured tool evidence and blocks unchanged denied retries', async () => {
    const handler = jest.fn(async () => ({ success: true }));
    const ledger = new ToolEvidenceLedger();
    const state = new ToolExecutionState();
    const registry = registryFor('Write', handler);
    const action = { action: 'Write', action_input: { file_path: 'x.ts', content: 'x' } } as const;
    const context = { workspace: process.cwd(), policy: { mode: 'read_only' as const }, toolEvidenceLedger: ledger, toolExecutionState: state };

    const denied = await executeAction(action, registry, undefined, context);
    const retried = await executeAction(action, registry, undefined, context);
    expect(JSON.parse(denied)).toMatchObject({ success: false, status: 'denied' });
    expect(JSON.parse(retried)).toMatchObject({ success: false, status: 'denied_retry' });
    expect(handler).not.toHaveBeenCalled();
    expect(ledger.list().map((record) => record.status)).toEqual(['denied', 'denied_retry']);
    expect(ledger.list()[0].input).toEqual(action.action_input);
  });

  it('runs independent reads concurrently and serializes mutations', async () => {
    const scheduler = new ToolExecutionScheduler();
    let active = 0;
    let maxActive = 0;
    const operation = async (action: { action: string; action_input: Record<string, unknown> }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return action.action;
    };
    await scheduler.executeBatch([
      { action: 'Read', action_input: { file_path: 'a.ts' } },
      { action: 'Read', action_input: { file_path: 'b.ts' } },
      { action: 'Write', action_input: { file_path: 'c.ts' } },
    ], operation);
    expect(maxActive).toBe(2);

    maxActive = 0;
    await Promise.all([
      scheduler.execute({ action: 'Write', action_input: { file_path: 'a.ts' } }, () => operation({ action: 'Write', action_input: {} })),
      scheduler.execute({ action: 'Edit', action_input: { file_path: 'b.ts' } }, () => operation({ action: 'Edit', action_input: {} })),
    ]);
    expect(maxActive).toBe(1);
  });

  it('does not let a read overlap an active exclusive operation', async () => {
    const scheduler = new ToolExecutionScheduler();
    let releaseMutation!: () => void;
    let mutationStarted!: () => void;
    const mutationReady = new Promise<void>((resolve) => { mutationStarted = resolve; });
    const mutationRelease = new Promise<void>((resolve) => { releaseMutation = resolve; });
    const write = scheduler.execute(
      { action: 'Write', action_input: { file_path: 'a.ts' } },
      async () => {
        mutationStarted();
        await mutationRelease;
        return 'write';
      },
    );
    await mutationReady;
    let readRan = false;
    const read = scheduler.execute(
      { action: 'Read', action_input: { file_path: 'b.ts' } },
      async () => {
        readRan = true;
        return 'read';
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(readRan).toBe(false);
    releaseMutation();
    await expect(write).resolves.toBe('write');
    await expect(read).resolves.toBe('read');
  });

  it('keeps circular handler results inside the canonical JSON boundary', async () => {
    const circular: Record<string, unknown> = { value: 'safe' };
    circular.self = circular;
    const handler = jest.fn(async () => ({ success: true, output: circular }));
    const ledger = new ToolEvidenceLedger();
    const observation = await executeAction(
      { action: 'Read', action_input: { file_path: 'a.ts' } },
      registryFor('Read', handler),
      undefined,
      { toolEvidenceLedger: ledger, toolCallId: 'call-circular' },
    );
    const parsed = JSON.parse(observation);
    expect(parsed).toMatchObject({ success: true, status: 'success', toolCallId: 'call-circular' });
    expect(parsed.output.self).toBe('[Circular]');
    expect(ledger.list()[0].status).toBe('success');
    expect(() => safeJsonStringify(circular)).not.toThrow();
  });

  it('normalizes cancellation and timeout without throwing unstructured output', async () => {
    const cancelHandler = jest.fn(async (_params: unknown, signal?: AbortSignal) => new Promise<never>((_, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const controller = new AbortController();
    const cancelled = executeAction(
      { action: 'Read', action_input: { file_path: 'a.ts' } },
      registryFor('Read', cancelHandler),
      controller.signal,
      { toolRetryLimit: 0 },
    );
    controller.abort();
    expect(JSON.parse(await cancelled)).toMatchObject({ success: false, status: 'cancelled' });

    const hangingHandler = jest.fn(async () => new Promise<never>(() => undefined));
    const timedOut = await executeAction(
      { action: 'Read', action_input: { file_path: 'a.ts' } },
      registryFor('Read', hangingHandler, {}, { timeoutMs: 5 }),
      new AbortController().signal,
      { toolRetryLimit: 0 },
    );
    expect(parseStructuredToolResult('Read', timedOut)).toMatchObject({ success: false, status: 'timed_out' });
  });

  it('records stale edit interventions as structured diagnostic trace evidence', () => {
    const ledger = new ToolEvidenceLedger();
    const action = { action: 'Edit', action_input: { file_path: 'src/app.ts', old_string: 'old', new_string: 'new' } };

    const record = ledger.recordStaleEditIntervention(
      action,
      'src/app.ts',
      'rejected_replay',
      'The exact Edit for src/app.ts was already rejected because old_string was not found.'
    );

    expect(record.status).toBe('denied_retry');
    expect(record.staleEditIntervention).toEqual({
      targetFile: 'src/app.ts',
      type: 'rejected_replay',
      details: 'The exact Edit for src/app.ts was already rejected because old_string was not found.',
    });
    expect(ledger.list()[0].summary).toContain('[Stale Edit Replay Blocked] src/app.ts');
  });
});
