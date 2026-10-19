import type { ToolRegistry } from '../../di/types.js';
import { describe, expect, it, jest } from '@jest/globals';
import {
  CapabilityScopeError,
  createCapabilityScope,
  getCapabilityPack,
  type CapabilityScopeEvent,
} from '../capability-scope.js';

function registryFor(tools: Array<{ name: string; inputSchema?: Record<string, unknown> }>): ToolRegistry {
  const definitions = tools.map((tool) => ({
    ...tool,
    description: `${tool.name} tool`,
    handler: async () => ({ success: true, output: tool.name }),
  }));
  return {
    getAll: () => definitions as any,
    get: (name) => definitions.find((tool) => tool.name === name) as any,
    getEnabled: () => definitions as any,
    has: (name) => definitions.some((tool) => tool.name === name),
    register: (tool) => definitions.push(tool as any),
    setEnabled: () => undefined,
    getNames: () => definitions.map((tool) => tool.name),
    size: () => definitions.length,
  };
}

describe('per-run capability scopes', () => {
  it('captures an immutable filtered registry and machine-readable catalog', () => {
    const source = registryFor([
      { name: 'Read', inputSchema: { type: 'object' } },
      { name: 'Write', inputSchema: { type: 'object' } },
    ]);
    const scope = createCapabilityScope({
      runId: 'run-1',
      modelRoute: { requested: 'model-a', resolved: 'model-a' },
      toolRegistry: source,
      pack: 'read-only-review',
      workspace: { root: process.cwd(), privateWorkspace: false, sendPrivateSourceCode: false, allowedExternalProviders: [] },
      budgets: { maxSteps: 4, maxLlmRequests: 2, maxCost: 10, maxToolCalls: 8 },
    });

    expect(scope.toolRegistry.getNames()).toEqual(['Read']);
    expect(scope.catalog[0]).toMatchObject({ name: 'Read', enabled: true, capabilities: { readOnly: true } });
    expect(() => scope.toolRegistry.register({ name: 'Write', description: 'late', handler: async () => ({}) })).toThrow(CapabilityScopeError);
    source.register({ name: 'Edit', description: 'late source change', handler: async () => ({}) });
    expect(scope.toolRegistry.has('Edit')).toBe(false);
    expect(scope.modelRoute.resolved).toBe('model-a');
  });

  it('enforces bounded scope budgets and tracks usage separately from global state', () => {
    const scope = createCapabilityScope({
      modelRoute: { requested: 'model-a', resolved: 'model-a' },
      toolRegistry: registryFor([{ name: 'Read' }]),
      workspace: { root: process.cwd(), privateWorkspace: false, sendPrivateSourceCode: false, allowedExternalProviders: [] },
      budgets: { maxSteps: 4, maxLlmRequests: 1, maxCost: 10, maxToolCalls: 1 },
    });
    expect(scope.reserveLlmRequest()).toBe(true);
    expect(scope.reserveLlmRequest()).toBe(false);
    expect(scope.reserveToolCall()).toBe(true);
    expect(scope.reserveToolCall()).toBe(false);
    scope.recordCost(2.5);
    expect(scope.usage).toEqual({ llmRequests: 1, toolCalls: 1, cost: 2.5 });
  });

  it('disposes resources in reverse order, aborts its signal, and logs lifecycle events', async () => {
    const events: CapabilityScopeEvent[] = [];
    const disposed: string[] = [];
    const scope = createCapabilityScope({
      modelRoute: { requested: 'model-a', resolved: 'model-a' },
      toolRegistry: registryFor([{ name: 'Read' }]),
      workspace: { root: process.cwd(), privateWorkspace: false, sendPrivateSourceCode: false, allowedExternalProviders: [] },
      budgets: { maxSteps: 4, maxLlmRequests: 2, maxCost: 10, maxToolCalls: 8 },
      onEvent: (event) => events.push(event),
    });
    const aborted = jest.fn();
    scope.signal.addEventListener('abort', aborted, { once: true });
    scope.registerResource(() => { disposed.push('first'); });
    scope.registerResource({ close: () => { disposed.push('second'); } });
    await scope.dispose('test_complete');
    await scope.dispose('ignored_duplicate');

    expect(disposed).toEqual(['second', 'first']);
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(scope.isDisposed).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      'capability_scope_created',
      'capability_scope_disposed',
    ]);
    expect(() => scope.reserveToolCall()).toThrow(CapabilityScopeError);
  });

  it('creates a per-scope Cordis context that is disposed with the scope', async () => {
    const runtimeEvents: string[] = [];
    const scope = createCapabilityScope({
      runId: 'run-cordis',
      modelRoute: { requested: 'model-a', resolved: 'model-a' },
      toolRegistry: registryFor([{ name: 'Read' }]),
      workspace: { root: process.cwd(), privateWorkspace: false, sendPrivateSourceCode: false, allowedExternalProviders: [] },
      budgets: { maxSteps: 4, maxLlmRequests: 2, maxCost: 10, maxToolCalls: 8 },
      cordis: { onEvent: (event) => runtimeEvents.push(event.type) },
    });
    const received: unknown[] = [];
    scope.cordis.provide('testService', { value: 'local' });
    scope.cordis.on('test/event', (value) => { received.push(value); });
    scope.cordis.emit('test/event', { step: 1 });

    expect(scope.cordis.enabled).toBe(true);
    expect(scope.cordis.context?.get('testService')).toEqual({ value: 'local' });
    expect(scope.cordis.context?.get('capabilityRuntime')?.getModelRoute()).toMatchObject({ resolved: 'model-a' });
    const contextAssembly = scope.cordis.get<any>('contextAssembly');
    const providerCooldown = scope.cordis.get<any>('providerCooldown');
    const telemetry = scope.cordis.get<any>('telemetry');
    const lifecycle = scope.cordis.get<any>('lifecycle');
    expect(contextAssembly).toMatchObject({ kind: 'context_assembly', version: 1, hydrated: false });
    expect(providerCooldown.begin({ attempt: 1, waitingUntil: Date.now() + 1000, provider: 'gemini' })).toMatchObject({
      status: 'waiting', attempt: 1, provider: 'gemini',
    });
    telemetry.record({ type: 'test', timestamp: Date.now(), data: { safe: true } });
    expect(telemetry.getCounts()).toEqual({ test: 1 });
    expect(lifecycle.phase).toBe('active');
    expect(received).toEqual([{ step: 1 }]);
    expect(runtimeEvents).toEqual(['cordis_runtime_created']);

    await scope.dispose('cordis_test_complete');

    expect(scope.cordis.isDisposed).toBe(true);
    expect(runtimeEvents).toEqual(['cordis_runtime_created', 'cordis_runtime_disposed']);
    expect(() => scope.cordis.emit('test/event')).toThrow('already been disposed');
  });

  it('keeps the same scope contract when Cordis is disabled', async () => {
    const scope = createCapabilityScope({
      modelRoute: { requested: 'model-a', resolved: 'model-a' },
      toolRegistry: registryFor([{ name: 'Read' }]),
      workspace: { root: process.cwd(), privateWorkspace: false, sendPrivateSourceCode: false, allowedExternalProviders: [] },
      budgets: { maxSteps: 4, maxLlmRequests: 2, maxCost: 10, maxToolCalls: 8 },
      cordis: { enabled: false },
    });

    expect(scope.cordis.enabled).toBe(false);
    expect(scope.cordis.context).toBeUndefined();
    expect(() => scope.cordis.provide('testService', {})).not.toThrow();
    await scope.dispose('cordis_disabled_test');
    expect(scope.cordis.isDisposed).toBe(true);
  });

  it('returns independent copies for capability packs', () => {
    const pack = getCapabilityPack('verification-only');
    expect(pack.allowedTools).toEqual(expect.arrayContaining(['Read', 'Command']));
    expect(() => (pack.allowedTools as string[]).push('Write')).not.toThrow();
    expect(getCapabilityPack('verification-only').allowedTools).not.toContain('Write');
  });
});
