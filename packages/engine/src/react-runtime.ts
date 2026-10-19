import type { MalformedProviderResponseAudit } from './agent-decision.js';
import type { AppManifest, VerificationResult } from './app-manifest.js';
import type { PerformanceTraceSummary } from './performance-trace.js';
import type { RunSafetyDefaults } from './run-limits.js';
import type { ToolAction } from './tool-action.js';
import type { ToolCapabilities } from './shared-control.js';
import type { WorkspaceFingerprint, WorkspaceFingerprintState } from './workspace-fingerprint.js';
import type { RunScopedWorkspaceCapability } from './run-scoped-workspace.js';
import type { LLMCompletionResult } from './llm-contracts.js';

/** Host implementation for running one guarded tool action. */
export type ReActEngineToolActionExecutor = (
  action: ToolAction,
  registry?: any,
  signal?: AbortSignal,
  context?: ReActEngineToolExecutionContext,
) => Promise<string>;

export interface ReActEngineToolExecutionContext {
  onAuthorized?: (action: ToolAction) => void;
  onActionNormalized?: (action: ToolAction) => void;
  onEvent?: (event: any) => void;
  [key: string]: any;
}

/** Small structural tool surface accepted from a host registry. */
export interface ReActEngineToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  handler: (...args: any[]) => Promise<unknown>;
  capabilities?: ToolCapabilities;
  timeoutMs?: number;
}

export interface ReActEngineToolRegistry {
  getAll(): ReActEngineToolDefinition[];
  get(name: string): ReActEngineToolDefinition | undefined;
  getEnabled(): ReActEngineToolDefinition[];
  has(name: string): boolean;
  register(tool: ReActEngineToolDefinition): void;
  setEnabled(name: string, enabled: boolean): void;
  getNames(): string[];
  size(): number;
}

export interface ReActEngineCapabilityScope {
  readonly signal: AbortSignal;
  readonly toolRegistry: ReActEngineToolRegistry;
  readonly usage: { llmRequests: number };
  readonly cordisServices: {
    contextAssembly: any;
    telemetry: { record(event: any): void };
  };
  reserveLlmRequest(): boolean;
  restoreUsage(usage: { llmRequests?: number; toolCalls?: number; cost?: number }): void;
  updateModelRoute(route: {
    requested?: string;
    resolved?: string;
    planner?: string;
    provider?: string;
    profileId?: string;
  }): void;
  recordCost(cost: number): void;
  dispose(reason?: string): Promise<void>;
}

export interface ReActEngineCapabilityPack {
  id: string;
  description: string;
  allowedTools?: readonly string[];
  deniedTools?: readonly string[];
  policyMode: string;
  allowExternalProviders: boolean;
  allowWorkspaceMutation: boolean;
  defaultTimeoutClass?: string;
}

export interface ReActEngineCapabilityScopeOptions {
  runId?: string;
  modelRoute: {
    requested: string;
    resolved: string;
    planner?: string;
    profileId?: string;
  };
  contextWindow?: number;
  toolRegistry: ReActEngineToolRegistry;
  pack?: string | ReActEngineCapabilityPack;
  policy?: { taskId?: string; approvalGrants?: any[] };
  workspace: {
    root: string;
    privateWorkspace: boolean;
    sendPrivateSourceCode: boolean;
    allowedExternalProviders: string[];
  };
  budgets: {
    maxSteps: number;
    maxLlmRequests: number;
    maxCost: number;
    maxToolCalls: number;
  };
  signal?: AbortSignal;
  onEvent?: (event: any) => void;
  cordis?: { enabled?: boolean; contextSnapshot?: any; onEvent?: (event: any) => void };
}

/** Host provider surface required by the standalone loop. */
export interface ReActEngineLLMProvider {
  createChatCompletion(messages: Array<{ role: string; content: string }>, model: string, options?: any): Promise<string>;
  createChatCompletionResult?(messages: Array<{ role: string; content: string }>, model: string, options?: any): Promise<LLMCompletionResult>;
  streamChatCompletion?(messages: Array<{ role: string; content: string }>, model: string, options?: any): AsyncIterable<any>;
  getModelCapabilities?(model: string): ReActEngineModelCapabilities | undefined;
  getHealth?(): ReActEngineProviderHealth;
  estimateStepCost(model: string): number;
  getProviderName(): string;
  isAvailable(): boolean;
}

export interface ReActEngineModelCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  jsonMode: boolean;
  vision: boolean;
  contextTokenLimit?: number;
  outputTokenLimit?: number;
}

export interface ReActEngineProviderHealth {
  state: 'available' | 'degraded' | 'cooldown' | 'disabled' | 'misconfigured';
  credentialState: 'configured' | 'not_configured' | 'invalid';
  message: string;
  model?: string;
  cooldownUntil?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastErrorCode?: string;
}

/** Structural dirty-worktree snapshot shared with a host's filesystem adapter. */
export interface ReActEngineDirtyTreeState {
  isDirty: boolean;
  files: Array<{
    path: string;
    status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
    hunks: Array<{ startLine: number; endLine: number; changeType: 'added' | 'removed' | 'modified'; content?: string }>;
    lastModified: number;
    diffPreview?: string;
  }>;
  modifiedCount: number;
  addedCount: number;
  deletedCount: number;
  untrackedCount: number;
  totalChanges: number;
  lastScanned: number;
}

export interface ReActEngineHarnessInterventionEvidence {
  gateName: 'requires_source_mutation' | 'intent_mismatch' | 'task_analysis_guard';
  reason: string;
  requiredEvidence: string[];
  targetAction: string;
  stepSeq: number;
}

/** Minimal chat client surface used by the optional unauthenticated fallback. */
export interface ReActEnginePollinationsClient {
  chatCompletion(input: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    model: string;
  }): Promise<{ content?: string }>;
}

export type OutcomeKind =
  | 'completed'
  | 'checkpoint_turn_limit'
  | 'checkpoint_rate_limit'
  | 'cancelled'
  | 'fatal_error'
  | 'unknown';

export interface RunAuditOptions {
  threadId?: string;
  runId?: string;
  parentRunId?: string;
  attemptIndex?: number;
  outcomeKind?: OutcomeKind;
  threadTitle?: string;
  cumulativeCost?: number;
  cumulativeSteps?: number;
  harnessInterventions?: Array<ReActEngineHarnessInterventionEvidence & { evidenceId: string; toolCallId: string }>;
}

export interface ReActEngineAuditStep {
  thought?: string;
  action?: string;
  action_input?: Record<string, unknown>;
  observation?: string;
  pollenCost?: number;
}

export type ReActEngineRunAuditWriter = (
  task: string,
  model: string,
  budget: number,
  success: boolean,
  steps: ReActEngineAuditStep[],
  totalCost: number,
  finalAnswer?: string,
  error?: string,
  performanceTrace?: PerformanceTraceSummary,
  options?: RunAuditOptions,
) => Promise<void>;

/** Metrics shared with a host's structured execution logger. */
export interface ReActEngineExecutionMetrics {
  startTime: number;
  endTime?: number;
  duration?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cost?: number;
  success?: boolean;
  error?: string;
}

/** Structured logging operations used by the standalone ReAct loop. */
export interface ReActEngineLogger {
  startRequest(agentId?: string, metadata?: Record<string, any>): string;
  logMetric(name: string, value: number, unit?: string, metadata?: Record<string, any>): void;
  endStep(observation?: string, metrics?: ReActEngineExecutionMetrics): void;
  logError(message: string, error: Error | string, context?: Record<string, any>): void;
  endRequest(success: boolean, error?: string): void;
  flush(): Promise<void>;
}

/** Aggregate cache counters exposed to performance traces. */
export interface ReActEngineCacheMetrics {
  hits: number;
  misses: number;
  staleHits: number;
  staleRefreshes: number;
  sets: number;
  evictions: number;
  deletes: number;
  runtimeEntries: number;
  repositoryEntries: number;
  projectFileMapEntries: number;
}

/** Per-run aggregate from an optional host slow-operation recorder. */
export interface ReActEngineSlowOperationMetrics {
  count: number;
  totalMs: number;
  maxMs: number;
}

/** Optional cache lifecycle used by hosts that persist run caches. */
export interface ReActEngineCachePort {
  load(workspace: string): Promise<void>;
  persist(workspace: string): Promise<void>;
  formatStats(): string;
  getMetrics(): ReActEngineCacheMetrics;
}

/** Host model metadata used for routing, pacing, and context accounting. */
export interface ReActEngineModelConfig {
  gemini: boolean;
  openRouterFree: boolean;
  nvidia: boolean;
  nvidiaTarget: boolean;
  localTarget: boolean;
  colabTarget: boolean;
  groqStreaming: boolean;
  contextWindow?: number;
}

export type ReActEnginePacingProfile = 'automatic' | 'conservative' | 'phased' | 'fast';

/** Routing categories and results returned by the host's task/model policy. */
export type ReActEngineTaskComplexity = 'classification' | 'simple-planning' | 'complex-architecture' | 'repair' | 'review';
export type ReActEngineCodingTaskComplexity = 'informational' | 'simple' | 'medium' | 'complex' | 'high-risk';

export interface ReActEngineModelCapabilityAdvisory {
  complexity: ReActEngineCodingTaskComplexity;
  selectedModel: string;
  knownModel: boolean;
  supportsTools?: boolean;
  verificationSensitive: boolean;
  suitable: boolean;
  escalationRecommended: boolean;
  recommendedModel?: string;
  reasons: string[];
}

export interface ReActEngineToolCapableModelResolution {
  requestedModel: string;
  model: string;
  changed: boolean;
  capability: ReActEngineModelCapabilityAdvisory;
  reason?: string;
}

/** Execution profile fields consumed by the standalone loop. */
export interface ReActEngineExecutionProfile {
  requestIntervalMs: number;
  requestTimeoutFloorMs: number;
  toolPresentation: { readMs: number; writeMs: number };
  decisionPresentation: { minMs: number; maxMs: number; charactersPerStep: number };
}

/**
 * Host-supplied services and defaults consumed by ReActEngine. Implementations
 * may read host settings or process state; the engine uses these narrow
 * capabilities instead of owning those integrations.
 */
export interface ReActEngineRuntime {
  /** Create a unique identifier for a run event, request, or evidence record. */
  createId(): string;
  /** Let a host release a timer's event-loop reference when that is supported. */
  unrefTimer?(timer: unknown): void;
  /** Create the host's per-run capability scope around the selected tools and budgets. */
  createCapabilityScope(options: ReActEngineCapabilityScopeOptions): ReActEngineCapabilityScope;
  /** Resolve host-configured defaults for global run safety budgets. */
  getRunSafetyDefaults?(): RunSafetyDefaults;
  getLlmRequestTimeoutMs(): number;
  getPlannerRequestTimeoutMs(): number;
  getMaxLlmRequestsPerTask(): number;
  getThinkingDepth(): string | undefined;
  /** Return the host platform label used for command suggestions. */
  getPlatform(): string;
  getWorkingDirectory(): string;
  /** Resolve the host's model selection when a run did not specify a model. */
  getDefaultModelSelection(): string;
  /** Return provider/model traits and limits needed by the engine. */
  getModelConfig(
    model: string,
    options?: { includeContextWindow?: boolean; includeGroqStreaming?: boolean },
  ): ReActEngineModelConfig;
  /** Keep task routing policy and provider-specific model escalation with the host. */
  classifyTaskComplexity(task: string): ReActEngineTaskComplexity;
  estimateTaskCost(task: string): number;
  assessModelCapability(
    task: string,
    selectedModel: string,
    likelyFiles?: string[],
  ): ReActEngineModelCapabilityAdvisory;
  resolveToolCapableModel(
    task: string,
    selectedModel: string,
    likelyFiles?: string[],
  ): ReActEngineToolCapableModelResolution;
  /** Hash pre-serialized audit content without retaining its source text. */
  hashRequestPayload(serialized: string): string;
  /** Resolve the host's pacing and presentation settings for a run. */
  getExecutionProfilePreset(profile: ReActEnginePacingProfile): ReActEngineExecutionProfile;
  /** Whether the host has configured a Gemini API key for the fallback decision. */
  hasGeminiApiKey(): boolean;
  /** Resolve a validated canonical workspace-relative path for run evidence. */
  getWorkspaceRelativePath(userPath: string, workspaceRoot: string): string;
  /** Capture the host workspace's current uncommitted-change baseline. */
  scanDirtyTree(workspace: string): ReActEngineDirtyTreeState;
  /** Fingerprint checkpoint-relevant workspace files for stale-resume detection. */
  fingerprintWorkspace(state: WorkspaceFingerprintState): WorkspaceFingerprint;
  isCordisRuntimeEnabled(): boolean;
  /** Resolve the host's default provider when ReactConfig does not supply one. */
  getLLMProvider?(): ReActEngineLLMProvider;
  /** Create the host's unauthenticated Pollinations fallback client when supported. */
  createUnauthenticatedPollinationsClient?(): ReActEnginePollinationsClient;
  /** Resolve the host's default tools when ReactConfig does not supply them. */
  getToolRegistry?(): ReActEngineToolRegistry;
  /** Execute a tool action through the host's policy, capability, and dispatch boundary. */
  executeToolAction: ReActEngineToolActionExecutor;
  /** Return the host's structured execution logger when logging is supported. */
  getLogger?(): ReActEngineLogger;
  /** Route low-level engine messages through the host's logging surface. */
  writeHostLog?(level: 'log' | 'warn', ...values: unknown[]): void;
  /** Read slow-operation aggregates for the current run when host profiling is enabled. */
  getSlowOperationMetrics?(startedAt: number): ReActEngineSlowOperationMetrics;
  /** Optional cache implementation; hosts can omit it to run without caching. */
  cache?: ReActEngineCachePort;
  /** Persist an execution audit when the host maintains run history. */
  recordRunResult?: ReActEngineRunAuditWriter;
  /** Persist a redacted malformed-provider-response audit when supported. */
  recordProtocolAudit?(audit: MalformedProviderResponseAudit, runId?: string): Promise<void>;
  /** Persist generated-app manifests when the host provides durable workspace storage. */
  saveAppManifest?(manifest: AppManifest, workspace: string): Promise<string>;
  /** Persist verification results for a previously saved app manifest. */
  updateAppManifestWithVerification?(
    manifest: AppManifest,
    result: VerificationResult,
    workspace: string,
  ): Promise<void>;
  /** Run the host's generated-app verification implementation when supported. */
  verifyGeneratedApp?: (manifest: AppManifest, options?: any, appSpec?: any) => Promise<VerificationResult>;
  /** Discover existing workspace files that may be needed for a verification repair. */
  discoverVerificationRepairFiles?: (
    manifest: Pick<AppManifest, 'workspace' | 'entryPoint' | 'outputFiles'>,
  ) => Promise<string[]>;
  /** Expand the host task-analysis scope for files requested by app verification repair. */
  extendTaskAnalysisForRepair?(
    analysis: any,
    repairFiles: string[],
  ): any;
  /** Dispose a temporary workspace capability when this host owns workspace cleanup. */
  disposeRunScopedWorkspace?(capability: RunScopedWorkspaceCapability): Promise<void>;
}
