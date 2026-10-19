import { randomUUID } from 'crypto';
import { Context } from '@deepseek-ai/cordis';

export type CordisRuntimeEvent =
  | {
      type: 'cordis_runtime_created';
      runtimeId: string;
      runId?: string;
      enabled: true;
      createdAt: number;
    }
  | {
      type: 'cordis_runtime_disabled';
      runtimeId: string;
      runId?: string;
      enabled: false;
      createdAt: number;
    }
  | {
      type: 'cordis_runtime_disposed';
      runtimeId: string;
      runId?: string;
      enabled: boolean;
      reason: string;
      disposedAt: number;
    };

export interface CordisRuntimeOptions {
  runId?: string;
  /** Disable the Cordis adapter while preserving the same scope contract. */
  enabled?: boolean;
  onEvent?: (event: CordisRuntimeEvent) => void;
}

export interface CordisRuntimeResource {
  dispose?: () => void | Promise<void>;
  close?: () => void | Promise<void>;
}

export interface CordisRuntime {
  readonly id: string;
  readonly runId?: string;
  readonly enabled: boolean;
  readonly context?: Context;
  readonly isDisposed: boolean;
  /** Register a service owned by this runtime context. */
  provide(name: string, value: unknown): void;
  /** Read a service from the active Cordis context. */
  get<T = unknown>(name: string): T | undefined;
  /** Register a runtime event listener owned by this context. */
  on(name: string, listener: (...args: unknown[]) => unknown): () => boolean;
  /** Emit an ephemeral runtime event. Durable events must use HarnessEvent/SQLite. */
  emit(name: string, ...args: unknown[]): void;
  /** Register an adapter-owned resource for reverse-order cleanup. */
  registerResource(resource: CordisRuntimeResource | (() => void | Promise<void>)): () => void;
  dispose(reason?: string): Promise<void>;
}

abstract class BaseCordisRuntime implements CordisRuntime {
  readonly id = randomUUID();
  readonly runId?: string;
  abstract readonly enabled: boolean;
  abstract readonly context?: Context;
  private disposed = false;
  private readonly resources = new Set<CordisRuntimeResource | (() => void | Promise<void>)>();

  constructor(protected readonly options: CordisRuntimeOptions) {
    this.runId = options.runId;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  protected assertActive(): void {
    if (this.disposed) throw new Error('Cordis runtime has already been disposed.');
  }

  abstract provide(name: string, value: unknown): void;
  abstract get<T = unknown>(name: string): T | undefined;
  abstract on(name: string, listener: (...args: unknown[]) => unknown): () => boolean;
  abstract emit(name: string, ...args: unknown[]): void;
  abstract dispose(reason?: string): Promise<void>;

  registerResource(resource: CordisRuntimeResource | (() => void | Promise<void>)): () => void {
    this.assertActive();
    this.resources.add(resource);
    return () => this.resources.delete(resource);
  }

  protected async disposeResources(): Promise<void> {
    const resources = [...this.resources].reverse();
    this.resources.clear();
    for (const resource of resources) {
      try {
        if (typeof resource === 'function') await resource();
        else if (resource.dispose) await resource.dispose();
        else if (resource.close) await resource.close();
      } catch {
        // Runtime teardown is best-effort. SQLite/checkpoint state remains authoritative.
      }
    }
  }

  protected markDisposed(): void {
    this.disposed = true;
  }
}

class DisabledCordisRuntime extends BaseCordisRuntime {
  readonly enabled = false as const;
  readonly context = undefined;

  constructor(options: CordisRuntimeOptions) {
    super(options);
    options.onEvent?.({
      type: 'cordis_runtime_disabled',
      runtimeId: this.id,
      ...(this.runId ? { runId: this.runId } : {}),
      enabled: false,
      createdAt: Date.now(),
    });
  }

  provide(_name: string, _value: unknown): void {
    this.assertActive();
  }

  get<T = unknown>(_name: string): T | undefined {
    this.assertActive();
    return undefined;
  }

  on(_name: string, _listener: (...args: unknown[]) => unknown): () => boolean {
    this.assertActive();
    return () => false;
  }

  emit(_name: string, ..._args: unknown[]): void {
    this.assertActive();
  }

  async dispose(reason = 'runtime_disposed'): Promise<void> {
    if (this.isDisposed) return;
    this.markDisposed();
    await this.disposeResources();
    this.options.onEvent?.({
      type: 'cordis_runtime_disposed',
      runtimeId: this.id,
      ...(this.runId ? { runId: this.runId } : {}),
      enabled: false,
      reason: reason.slice(0, 500),
      disposedAt: Date.now(),
    });
  }
}

class ActiveCordisRuntime extends BaseCordisRuntime {
  readonly enabled = true as const;
  readonly context: Context;

  constructor(options: CordisRuntimeOptions) {
    super(options);
    this.context = new Context();
    options.onEvent?.({
      type: 'cordis_runtime_created',
      runtimeId: this.id,
      ...(this.runId ? { runId: this.runId } : {}),
      enabled: true,
      createdAt: Date.now(),
    });
  }

  provide(name: string, value: unknown): void {
    this.assertActive();
    this.context.provide(name, value);
  }

  get<T = unknown>(name: string): T | undefined {
    this.assertActive();
    return (this.context as any).get(name) as T | undefined;
  }

  on(name: string, listener: (...args: unknown[]) => unknown): () => boolean {
    this.assertActive();
    return (this.context as any).on(name, listener);
  }

  emit(name: string, ...args: unknown[]): void {
    this.assertActive();
    (this.context as any).emit(name, ...args);
  }

  async dispose(reason = 'runtime_disposed'): Promise<void> {
    if (this.isDisposed) return;
    this.markDisposed();
    await this.disposeResources();
    await this.context.fiber.dispose();
    this.options.onEvent?.({
      type: 'cordis_runtime_disposed',
      runtimeId: this.id,
      ...(this.runId ? { runId: this.runId } : {}),
      enabled: true,
      reason: reason.slice(0, 500),
      disposedAt: Date.now(),
    });
  }
}

export function createCordisRuntime(options: CordisRuntimeOptions = {}): CordisRuntime {
  return options.enabled === false
    ? new DisabledCordisRuntime(options)
    : new ActiveCordisRuntime(options);
}
