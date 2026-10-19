import { randomUUID } from 'crypto';
import type { ToolDefinition, ToolRegistry } from '../di/types.js';
import type { StoredAgentContextSnapshot } from '../persistence/contextSnapshot.js';
import type { ApprovalScopeGrant, PermissionMode } from '../tools/permissionPolicy.js';
import type { ToolCapabilities, ToolTimeoutClass } from '@barok/engine';
import { getToolCatalog } from './tool-router.js';
import {
  createCordisRuntime,
  type CordisRuntime,
  type CordisRuntimeEvent,
} from '../runtime/cordis/runtime.js';
import {
  createCordisRuntimeServices,
  type CordisContextTarget,
  type CordisRuntimeServices,
} from '../runtime/cordis/services.js';

export type CapabilityPackName =
  | 'read-only-review'
  | 'implementation'
  | 'verification-only'
  | 'browser'
  | 'delegated-child';

export interface CapabilityPack {
  id: CapabilityPackName;
  description: string;
  allowedTools?: readonly string[];
  deniedTools?: readonly string[];
  policyMode: PermissionMode;
  allowExternalProviders: boolean;
  allowWorkspaceMutation: boolean;
  defaultTimeoutClass?: ToolTimeoutClass;
}

const READ_ONLY_TOOLS = [
  'Read', 'DocumentRead', 'Glob', 'Grep', 'WorkspaceChanges', 'Wiki', 'TaskList', 'Todo', 'WorkPlan', 'Command',
] as const;

const VERIFICATION_TOOLS = [
  'Read', 'DocumentRead', 'Glob', 'Grep', 'Command', 'TaskList',
] as const;

/** Declarative capability presets. A pack narrows the registry; policy still applies. */
export const CAPABILITY_PACKS: Readonly<Record<CapabilityPackName, CapabilityPack>> = Object.freeze({
  'read-only-review': {
    id: 'read-only-review',
    description: 'Inspect the workspace and produce a review without authorizing source mutation.',
    allowedTools: READ_ONLY_TOOLS,
    policyMode: 'read_only',
    allowExternalProviders: false,
    allowWorkspaceMutation: false,
    defaultTimeoutClass: 'standard',
  },
  implementation: {
    id: 'implementation',
    description: 'Implement within the workspace using the normal task policy and approval boundaries.',
    policyMode: 'scoped_auto_approve',
    allowExternalProviders: false,
    allowWorkspaceMutation: true,
  },
  'verification-only': {
    id: 'verification-only',
    description: 'Run inspection and verification tools only; mutation tools are absent from the snapshot.',
    allowedTools: VERIFICATION_TOOLS,
    policyMode: 'scoped_auto_approve',
    allowExternalProviders: false,
    allowWorkspaceMutation: false,
  },
  browser: {
    id: 'browser',
    description: 'Inspect a workspace and use approved web lookup without local source mutation.',
    allowedTools: [...READ_ONLY_TOOLS, 'WebSearch'],
    policyMode: 'ask',
    allowExternalProviders: true,
    allowWorkspaceMutation: false,
    defaultTimeoutClass: 'long',
  },
  'delegated-child': {
    id: 'delegated-child',
    description: 'A bounded child run with inspection, command, and scoped implementation tools.',
    allowedTools: [
      ...READ_ONLY_TOOLS, 'Bash', 'Write', 'Edit', 'Note', 'Sample', 'Wiki', 'TaskList', 'Todo', 'WorkPlan',
    ],
    deniedTools: ['PackageInstall', 'SubAgent'],
    policyMode: 'ask',
    allowExternalProviders: false,
    allowWorkspaceMutation: true,
  },
});

export interface ToolCatalogEntry {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  enabled: boolean;
  capabilities: ToolCapabilities;
  example?: string;
  commonErrors?: string[];
}

export interface RunModelRoute {
  requested: string;
  resolved: string;
  planner?: string;
  provider?: string;
  profileId?: string;
}

export interface RunWorkspacePolicy {
  root: string;
  privateWorkspace: boolean;
  sendPrivateSourceCode: boolean;
  allowedExternalProviders: string[];
}

export interface RunScopeBudgets {
  maxSteps: number;
  maxLlmRequests: number;
  maxCost: number;
  maxToolCalls: number;
}

export interface RunScopeUsage {
  llmRequests: number;
  toolCalls: number;
  cost: number;
}

export interface RunScopePolicy {
  mode: PermissionMode;
  taskId?: string;
  approvalGrants: ApprovalScopeGrant[];
  approvedScopes: string[];
}

export type CapabilityScopeEvent =
  | { type: 'capability_scope_created'; scopeId: string; pack: CapabilityPackName; toolCount: number; catalogVersion: number }
  | { type: 'capability_scope_registry_changed'; scopeId: string; reason: string; toolCount: number; catalogVersion: number }
  | { type: 'capability_scope_disposed'; scopeId: string; reason: string; toolCount: number; catalogVersion: number }
  | CordisRuntimeEvent;

export interface ScopeResource {
  dispose?: () => void | Promise<void>;
  close?: () => void | Promise<void>;
}

export interface CapabilityScopeCordisOptions {
  enabled?: boolean;
  contextSnapshot?: StoredAgentContextSnapshot;
  onEvent?: (event: CordisRuntimeEvent) => void;
}

/** Read-only runtime seam exposed to Cordis plugins; persistence stays outside. */
export interface CapabilityRuntimeServices {
  scopeId: string;
  runId?: string;
  signal: AbortSignal;
  getModelRoute: () => RunModelRoute;
  getToolRegistry: () => ImmutableToolRegistry;
  getCatalog: () => ToolCatalogEntry[];
  getPolicy: () => RunScopePolicy;
  getWorkspace: () => RunWorkspacePolicy;
  getBudgets: () => RunScopeBudgets;
  getUsage: () => RunScopeUsage;
}

export interface CapabilityScopeOptions {
  runId?: string;
  modelRoute: RunModelRoute;
  contextWindow?: number;
  toolRegistry: ToolRegistry;
  pack?: CapabilityPackName | CapabilityPack;
  policy?: Partial<RunScopePolicy>;
  workspace: RunWorkspacePolicy;
  budgets: RunScopeBudgets;
  signal?: AbortSignal;
  onEvent?: (event: CapabilityScopeEvent) => void;
  cordis?: CapabilityScopeCordisOptions;
}

export class CapabilityScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityScopeError';
  }
}

function freezeValue<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) freezeValue(child);
  return Object.freeze(value);
}

function snapshotTool(tool: ToolDefinition): ToolDefinition {
  const snapshot = {
    ...tool,
    ...(tool.parameters ? { parameters: freezeValue({ ...tool.parameters }) } : {}),
    ...(tool.inputSchema ? { inputSchema: freezeValue({ ...tool.inputSchema }) } : {}),
    ...(tool.capabilities ? { capabilities: freezeValue({ ...tool.capabilities }) } : {}),
  };
  return Object.freeze(snapshot);
}

/** Immutable registry captured at a declared capability-scope boundary. */
export class ImmutableToolRegistry implements ToolRegistry {
  private readonly tools: readonly ToolDefinition[];
  private readonly enabledNames: ReadonlySet<string>;

  constructor(tools: readonly ToolDefinition[], enabledNames: readonly string[] = tools.map((tool) => tool.name)) {
    this.tools = Object.freeze(tools.map(snapshotTool));
    this.enabledNames = new Set(enabledNames);
  }

  getAll(): ToolDefinition[] { return [...this.tools]; }
  get(name: string): ToolDefinition | undefined { return this.tools.find((tool) => tool.name === name); }
  getEnabled(): ToolDefinition[] { return this.tools.filter((tool) => this.enabledNames.has(tool.name)); }
  has(name: string): boolean { return this.tools.some((tool) => tool.name === name); }
  register(): void { throw new CapabilityScopeError('This tool registry is an immutable per-run snapshot. Apply changes at a capability-scope boundary.'); }
  setEnabled(): void { throw new CapabilityScopeError('This tool registry is an immutable per-run snapshot. Apply changes at a capability-scope boundary.'); }
  getNames(): string[] { return this.tools.map((tool) => tool.name); }
  size(): number { return this.tools.length; }
}

function resolvePack(pack: CapabilityPackName | CapabilityPack | undefined): CapabilityPack {
  if (!pack) return CAPABILITY_PACKS.implementation;
  if (typeof pack !== 'string') return {
    ...pack,
    allowedTools: pack.allowedTools ? [...pack.allowedTools] : undefined,
    deniedTools: pack.deniedTools ? [...pack.deniedTools] : undefined,
  };
  const resolved = CAPABILITY_PACKS[pack];
  if (!resolved) throw new CapabilityScopeError(`Unknown capability pack: ${pack}`);
  return resolved;
}

function applyPack(registry: ToolRegistry, pack: CapabilityPack): ImmutableToolRegistry {
  const denied = new Set(pack.deniedTools || []);
  const allowed = pack.allowedTools ? new Set(pack.allowedTools) : undefined;
  const tools = registry.getAll().filter((tool) => (!allowed || allowed.has(tool.name)) && !denied.has(tool.name));
  const enabled = registry.getEnabled().map((tool) => tool.name).filter((name) => tools.some((tool) => tool.name === name));
  return new ImmutableToolRegistry(tools, enabled);
}

function createScopeSignal(signal?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      signal?.removeEventListener('abort', abort);
      if (!controller.signal.aborted) controller.abort(new CapabilityScopeError('Capability scope disposed.'));
    },
  };
}

export class CapabilityScope {
  readonly id: string;
  readonly runId?: string;
  private currentModelRoute: RunModelRoute;
  readonly pack: CapabilityPack;
  readonly policy: RunScopePolicy;
  readonly workspace: RunWorkspacePolicy;
  readonly budgets: RunScopeBudgets;
  readonly signal: AbortSignal;
  readonly cordis: CordisRuntime;
  readonly cordisServices: CordisRuntimeServices;
  private readonly onEvent?: (event: CapabilityScopeEvent) => void;
  private readonly signalDisposer: () => void;
  private resources = new Set<ScopeResource | (() => void | Promise<void>)>();
  private currentRegistry: ImmutableToolRegistry;
  private currentCatalog: ToolCatalogEntry[];
  private catalogVersion = 1;
  private disposed = false;
  private usageState: RunScopeUsage = { llmRequests: 0, toolCalls: 0, cost: 0 };

  constructor(options: CapabilityScopeOptions) {
    this.id = randomUUID();
    this.runId = options.runId;
    this.currentModelRoute = { ...options.modelRoute };
    this.pack = resolvePack(options.pack);
    this.policy = {
      mode: options.policy?.mode || this.pack.policyMode,
      taskId: options.policy?.taskId,
      approvalGrants: [...(options.policy?.approvalGrants || [])],
      approvedScopes: [...(options.policy?.approvedScopes || [])],
    };
    this.workspace = {
      ...options.workspace,
      allowedExternalProviders: [...options.workspace.allowedExternalProviders],
    };
    this.budgets = { ...options.budgets };
    const scopeSignal = createScopeSignal(options.signal);
    this.signal = scopeSignal.signal;
    this.signalDisposer = scopeSignal.dispose;
    this.onEvent = options.onEvent;
    this.currentRegistry = applyPack(options.toolRegistry, this.pack);
    this.currentCatalog = getToolCatalog(this.currentRegistry);
    this.cordis = createCordisRuntime({
      runId: this.runId,
      enabled: options.cordis?.enabled,
      onEvent: options.cordis?.onEvent,
    });
    const contextTarget: CordisContextTarget = {
      model: options.modelRoute.resolved || options.modelRoute.requested,
      contextWindow: options.contextWindow,
    };
    this.cordisServices = createCordisRuntimeServices(options.cordis?.contextSnapshot, contextTarget);
    this.cordisServices.lifecycle.transition('active', 'capability_scope_created');
    this.cordis.provide('capabilityScopeId', this.id);
    this.cordis.provide('capabilityPack', this.pack);
    this.cordis.provide('capabilitySignal', this.signal);
    if (options.cordis?.contextSnapshot) this.cordis.provide('contextSnapshot', options.cordis.contextSnapshot);
    const capabilityRuntime: CapabilityRuntimeServices = {
      scopeId: this.id,
      ...(this.runId ? { runId: this.runId } : {}),
      signal: this.signal,
      getModelRoute: () => this.modelRoute,
      getToolRegistry: () => this.toolRegistry,
      getCatalog: () => this.catalog,
      getPolicy: () => ({ ...this.policy, approvalGrants: [...this.policy.approvalGrants], approvedScopes: [...this.policy.approvedScopes] }),
      getWorkspace: () => ({ ...this.workspace, allowedExternalProviders: [...this.workspace.allowedExternalProviders] }),
      getBudgets: () => ({ ...this.budgets }),
      getUsage: () => this.usage,
    };
    this.cordis.provide('capabilityRuntime', capabilityRuntime);
    this.cordis.provide('contextAssembly', this.cordisServices.contextAssembly);
    this.cordis.provide('providerCooldown', this.cordisServices.providerCooldown);
    this.cordis.provide('telemetry', this.cordisServices.telemetry);
    this.cordis.provide('lifecycle', this.cordisServices.lifecycle);
    this.onEvent?.({
      type: 'capability_scope_created',
      scopeId: this.id,
      pack: this.pack.id,
      toolCount: this.currentRegistry.size(),
      catalogVersion: this.catalogVersion,
    });
  }

  get toolRegistry(): ImmutableToolRegistry { return this.currentRegistry; }
  get modelRoute(): RunModelRoute { return { ...this.currentModelRoute }; }
  get catalog(): ToolCatalogEntry[] { return this.currentCatalog.map((entry) => ({ ...entry, schema: { ...entry.schema }, capabilities: { ...entry.capabilities } })); }
  get usage(): RunScopeUsage { return { ...this.usageState }; }
  get isDisposed(): boolean { return this.disposed; }

  assertActive(): void {
    if (this.disposed) throw new CapabilityScopeError('Capability scope has already been disposed.');
  }

  replaceToolRegistry(registry: ToolRegistry, reason: string): void {
    this.assertActive();
    if (!reason.trim()) throw new CapabilityScopeError('A capability-scope registry change requires a reason.');
    this.currentRegistry = applyPack(registry, this.pack);
    this.currentCatalog = getToolCatalog(this.currentRegistry);
    this.catalogVersion += 1;
    this.onEvent?.({
      type: 'capability_scope_registry_changed',
      scopeId: this.id,
      reason: reason.trim().slice(0, 500),
      toolCount: this.currentRegistry.size(),
      catalogVersion: this.catalogVersion,
    });
  }

  updateModelRoute(route: Partial<RunModelRoute>): void {
    this.assertActive();
    this.currentModelRoute = { ...this.currentModelRoute, ...route };
  }

  restoreUsage(usage: Partial<RunScopeUsage>): void {
    this.assertActive();
    this.usageState = {
      llmRequests: Math.max(0, Math.floor(usage.llmRequests || 0)),
      toolCalls: Math.max(0, Math.floor(usage.toolCalls || 0)),
      cost: Math.max(0, Number(usage.cost) || 0),
    };
  }

  reserveLlmRequest(): boolean {
    this.assertActive();
    if (this.usageState.llmRequests >= this.budgets.maxLlmRequests) return false;
    this.usageState.llmRequests += 1;
    return true;
  }

  reserveToolCall(): boolean {
    this.assertActive();
    if (this.usageState.toolCalls >= this.budgets.maxToolCalls) return false;
    this.usageState.toolCalls += 1;
    return true;
  }

  recordCost(cost: number): void {
    this.assertActive();
    if (Number.isFinite(cost) && cost > 0) this.usageState.cost += cost;
  }

  registerResource(resource: ScopeResource | (() => void | Promise<void>)): () => void {
    this.assertActive();
    this.resources.add(resource);
    return () => this.resources.delete(resource);
  }

  async dispose(reason = 'run_completed'): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.cordisServices.lifecycle.transition('disposed', reason);
    this.signalDisposer();
    const resources = [...this.resources].reverse();
    this.resources.clear();
    for (const resource of resources) {
      try {
        if (typeof resource === 'function') await resource();
        else if (resource.dispose) await resource.dispose();
        else if (resource.close) await resource.close();
      } catch {
        // Disposal is best-effort; the run's terminal result remains authoritative.
      }
    }
    await this.cordis.dispose(reason);
    this.onEvent?.({
      type: 'capability_scope_disposed',
      scopeId: this.id,
      reason: reason.slice(0, 500),
      toolCount: this.currentRegistry.size(),
      catalogVersion: this.catalogVersion,
    });
  }
}

export function createCapabilityScope(options: CapabilityScopeOptions): CapabilityScope {
  return new CapabilityScope(options);
}

export function getCapabilityPack(name: CapabilityPackName): CapabilityPack {
  const pack = CAPABILITY_PACKS[name];
  if (!pack) throw new CapabilityScopeError(`Unknown capability pack: ${name}`);
  return {
    ...pack,
    allowedTools: pack.allowedTools ? [...pack.allowedTools] : undefined,
    deniedTools: pack.deniedTools ? [...pack.deniedTools] : undefined,
  };
}
