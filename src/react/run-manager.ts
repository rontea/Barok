import type { Response } from 'express';
import { createId, normalizePathIdentity } from '@barok/adapter-node';
import {
  getSQLiteAppStore,
  type SQLiteAppStore,
  type AgentRunEventProjection,
  type StoredAgentRun,
  type StoredAgentRunEvent,
  type StoredAgentRunEventPage,
  type StoredAgentRunStatus,
  AgentInboxConflictError,
  type AgentInboxStatus,
  type AgentInboxTarget,
  type StoredAgentInboxEntry,
} from '../persistence/sqliteStore.js';
import {
  createHarnessEvent,
  normalizeHarnessEvent,
  type HarnessEventEnvelope,
} from '../persistence/harnessEvent.js';
import {
  createUnknownRequestEnvelope,
  createUnknownToolOutcome,
  findUnfinishedModelRequests,
  findUnfinishedToolCalls,
  type UnknownToolOutcome,
} from '../persistence/toolLifecycle.js';
import {
  projectHarnessEvents,
  type HarnessProjectionOptions,
  type HarnessRunProjection,
} from '../persistence/harnessProjection.js';
import { createReactContextSnapshot } from './context-snapshot.js';
import {
  CONTINUOUS_RUN_STEP_LIMIT,
  CONTINUOUS_RUN_STEP_WINDOW,
  resolveGlobalStepLimit,
  resolveMaxRecoveryTransitions,
  resolveRunWallClockBudgetMs,
  resolveStepWindow,
} from './continuous-run.js';
import {
  getPerformanceTrace,
  PerformanceTrace,
  isContinuationHandoff,
  measureContinuationQuality,
  summarizeContinuationState,
  type PerformanceTraceSummary,
} from '@barok/engine';
import {
  createReactCheckpoint,
  isCheckpointWorkspaceFresh,
  validateReactCheckpoint,
  type ReactCheckpoint,
} from './checkpoint.js';
import { attachReactCheckpointHandoff, createReactCheckpointHandoff, hasSuccessfulMutationInCheckpoint } from '@barok/engine';
import { resolvePlanApproval, type PlanApprovalDecision, type PlanApprovalState } from '@barok/engine';
import type { ReactState } from './state-manager.js';
import { activeApprovalGrants, type ApprovalScopeGrant } from '../tools/permissionPolicy.js';
import { getCapabilityPack, type CapabilityPackName } from './capability-scope.js';
import { calculateModelQualityMetrics } from '@barok/engine';
import { resolveTerminalRunAdvice } from '@barok/engine';
import {
  extractProviderRetryAfterMs as extractEngineProviderRetryAfterMs,
  formatProviderResumeAt as formatEngineProviderResumeAt,
  formatRetryAfterMs as formatEngineRetryAfterMs,
  isRecoverableRunProviderAvailabilityError,
  normalizeProviderWaitMs as normalizeEngineProviderWaitMs,
  isMaxStepsExceededResult,
  isRetryableCompletedRun,
  isRunWallClockBudgetExceeded as isEngineRunWallClockBudgetExceeded,
  normalizeRunLifecycleResult,
  remainingRunWallClockBudgetMs as getEngineRemainingRunWallClockBudgetMs,
  resultIndicatesRunFailure,
} from '@barok/engine';
import {
  createChildRunRecord,
  normalizeChildBudget,
  normalizeChildReport,
  type ChildRunCapabilities,
  type ChildRunBudget,
  type ChildRunModelTarget,
  type ChildRunRecord,
  type ChildRunReport,
  type ChildRunRequest,
  type ChildRunStatus,
} from '../agents/child-runs.js';

export type ServerRunKind = 'react' | 'coder' | 'app' | 'agent';

export type ServerRunEvent = HarnessEventEnvelope;

export const DEFAULT_RUN_EVENT_PAGE_SIZE = 250;

export interface StartServerRunInput {
  /** Internal stable ID used by the child-run protocol and continuation adapters. */
  id?: string;
  kind: ServerRunKind;
  task: string;
  threadId?: string;
  workspace?: string;
  model?: string;
  metadata?: Record<string, unknown>;
  /** Number of actions in each rolling autonomous checkpoint window. */
  maxSteps?: number;
  /** Explicit window size for resumed runs whose maxSteps is an absolute step target. */
  executionStepWindow?: number;
  /** Optional maximum automatic retries after a recoverable provider availability failure. */
  maxProviderCooldownRetries?: number;
  /** Keep the run paused until the selected provider route becomes available. */
  waitForProviderAvailability?: boolean;
  /** Keep executing until the completion gates pass. */
  continuousRun?: boolean;
  /** Finite total action budget shared by all rolling windows. */
  globalStepLimit?: number;
  /** Finite wall-clock budget shared by all rolling windows. */
  wallClockBudgetMs?: number;
  /** Maximum engine recovery transitions before pausing/termination. */
  maxRecoveryTransitions?: number;
}

export interface RunListFilter {
  kind?: ServerRunKind;
  /** Return only runs that can be continued from a live run or saved checkpoint. */
  resumable?: boolean;
}

export interface RunExecutionContext {
  runId: string;
  signal: AbortSignal;
  emit: (type: string, data: unknown) => ServerRunEvent;
  /** Present only for an internal provider retry, never for an explicit continuation. */
  providerRetryAttempt: number;
  /** Number of rolling checkpoint continuations completed for this active run. */
  continuationAttempt: number;
  /** Fresh action budget to allocate when the current checkpoint window ends. */
  continuationStepBudget: number;
  /** Finite total action budget shared by all rolling windows. */
  globalStepLimit: number;
  /** Original server-run start time, preserved across continuations. */
  runStartedAt: number;
  /** Finite wall-clock budget shared by all rolling windows. */
  wallClockBudgetMs: number;
  /** Maximum engine recovery transitions before pausing/termination. */
  maxRecoveryTransitions: number;
  /** The fresh, durable state from which an internal retry must resume. */
  checkpoint?: ReactCheckpoint;
  requestUserInput: (request: UserInputRequest) => Promise<UserInputResponse>;
  consumeQueuedMessages: () => QueuedUserMessage[];
  acknowledgeQueuedMessages: (messageIds: string[]) => void;
}

export interface StartChildRunInput extends ChildRunRequest {
  /** Optional explicit child ID for idempotent launch/reconnect flows. */
  childId?: string;
}

export type ChildRunLaunchResult =
  | { ok: true; record: ChildRunRecord; metadata: Record<string, unknown> }
  | { ok: false; reason: 'not_found' | 'terminal' | 'depth_limit' | 'invalid_request' | 'duplicate' | 'unsupported_provider'; message: string };

export interface UserInputRequest {
  requestId?: string;
  question: string;
  options?: string[];
  allowFreeform?: boolean;
  context?: string;
}

export interface PendingUserInputRequest {
  requestId: string;
  question: string;
  options: string[];
  allowFreeform: boolean;
  context?: string;
  createdAt: number;
}

export interface UserInputResponse {
  requestId: string;
  answer?: string;
  selectedOption?: string;
  cancelled: boolean;
}

export interface QueuedUserMessage {
  id: string;
  message: string;
  queuedAt: number;
  source?: string;
  target?: AgentInboxTarget;
  inboxSeq?: number;
  status?: AgentInboxStatus;
  claimId?: string;
}

export interface InboxMessageInput {
  message: string;
  messageId?: string;
  source?: string;
  target?: AgentInboxTarget;
}

export interface PlanApprovalDecisionInput {
  decision: PlanApprovalDecision;
  plan?: unknown;
  reason?: string;
}

export interface ModelTargetAuditEntry {
  requestedTarget: string;
  provider: string;
  resolvedModel: string;
  profileId?: string;
  credentialIndex?: number;
  targetId?: string;
  contextWindow?: number;
  route: 'primary' | 'recovery' | 'fallback';
  role?: 'implementation' | 'exploration' | 'verification' | 'summarization';
  reason?: string;
  timestamp: number;
}

export type ResumeContext =
  | { ok: true; prior: StoredAgentRun; checkpoint: ReactCheckpoint }
  | { ok: false; reason: 'not_found' | 'missing_checkpoint' | 'stale_workspace' };

export interface StartupRecoveryReport {
  runId: string;
  repairedModelRequests: number;
  repairedToolCalls: number;
  contextSnapshotRebuilt: boolean;
  blockedSideEffects: number;
}

type RunExecutor = (context: RunExecutionContext) => Promise<unknown>;
interface Subscriber {
  write: (event: ServerRunEvent) => void;
  end: () => void;
}

// Keep idle model-thinking streams alive through proxies and browser network
// layers. Qwen can spend a while producing hidden reasoning without emitting a
// user-visible event, so an otherwise healthy run must still send traffic.
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

interface ActiveRun {
  controller: AbortController;
  subscribers: Set<Subscriber>;
  promise: Promise<void>;
  lastEventSeq: number;
  boundaryCount: number;
  executionStepWindow: number;
  globalStepLimit: number;
  runStartedAt: number;
  wallClockBudgetMs: number;
  maxRecoveryTransitions: number;
  pendingUserInput?: {
    request: PendingUserInputRequest;
    resolve: (response: UserInputResponse) => void;
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function queuedMessageFromInbox(entry: StoredAgentInboxEntry): QueuedUserMessage {
  return {
    id: entry.messageId,
    message: entry.message,
    queuedAt: entry.createdAt,
    source: entry.source,
    target: entry.target,
    inboxSeq: entry.inboxSeq,
    status: entry.status,
    ...(entry.claimedBy ? { claimId: entry.claimedBy } : {}),
  };
}

function childRecordFromRun(run: StoredAgentRun | null | undefined): ChildRunRecord | undefined {
  const metadata = run?.metadata && typeof run.metadata === 'object' && !Array.isArray(run.metadata)
    ? run.metadata as Record<string, unknown>
    : undefined;
  const value = metadata?.childRun;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as ChildRunRecord;
  if (record.protocolVersion !== 1 || typeof record.childId !== 'string' || typeof record.parentRunId !== 'string' || typeof record.role !== 'string') return undefined;
  return record;
}

function objectMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function childModelTargetFromMetadata(value: unknown): ChildRunModelTarget | undefined {
  const target = objectMetadata(value);
  if (typeof target.requestedTarget !== 'string' || typeof target.provider !== 'string' || typeof target.resolvedModel !== 'string') return undefined;
  return {
    requestedTarget: target.requestedTarget,
    provider: target.provider,
    resolvedModel: target.resolvedModel,
    ...(typeof target.profileId === 'string' ? { profileId: target.profileId } : {}),
    ...(typeof target.targetId === 'string' ? { targetId: target.targetId } : {}),
  };
}

function normalizeRunIdentity(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

function normalizeWorkspaceIdentity(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return normalizePathIdentity(value);
}

function childStatusForRun(status: StoredAgentRunStatus, record: ChildRunRecord): ChildRunStatus {
  if (record.status === 'timed_out') return 'timed_out';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'interrupted') return 'interrupted';
  if (status === 'killed' || status === 'stopped') return 'cancelled';
  if (status === 'waiting_for_user') return 'waiting_for_user';
  if (status === 'waiting_for_provider') return 'waiting_for_provider';
  return record.status === 'created' ? 'created' : 'running';
}

function approvalModeRank(mode: unknown): number {
  return mode === 'read_only' ? 0 : mode === 'ask' ? 1 : mode === 'scoped_auto_approve' ? 2 : mode === 'full_workspace' ? 3 : 1;
}

function approvalModeAtMost(parent: unknown, requested: unknown): string {
  const parentRank = approvalModeRank(parent);
  const requestedRank = approvalModeRank(requested);
  const rank = Math.min(parentRank, requestedRank);
  return rank === 0 ? 'read_only' : rank === 1 ? 'ask' : rank === 2 ? 'scoped_auto_approve' : 'full_workspace';
}

const terminalStatuses: StoredAgentRunStatus[] = ['completed', 'failed', 'stopped', 'interrupted', 'killed'];
// Bounded callers retain one automatic recovery attempt by default. Continuous
// offline runs get a small recovery budget so a dead or unreachable local
// model cannot keep a run alive forever. Callers can opt into a different
// finite limit through maxProviderCooldownRetries.
const DEFAULT_MAX_PROVIDER_COOLDOWN_RETRIES = 1;
const DEFAULT_CONTINUOUS_MAX_PROVIDER_COOLDOWN_RETRIES = 3;
const DEFAULT_EXECUTION_STEP_WINDOW = 10;
type RunCancellationReason = {
  name: 'RunCancellationError';
  code: 'RUN_CANCELLED';
  message: string;
};

export class ServerRunManager {
  private activeRuns = new Map<string, ActiveRun>();
  private childParentAbortCleanups = new Map<string, () => void>();
  private childTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private plannerContextSnapshots = new Map<string, Map<number, Record<string, unknown>>>();
  private plannerContextSnapshotOrder: Array<{ runId: string; stepSeq: number }> = [];

  constructor(private store: SQLiteAppStore = getSQLiteAppStore()) {}

  /**
   * Validate and shape a child launch before a provider-specific adapter
   * creates the actual agent run. The returned metadata is safe to persist on
   * the child and is also the parent/child policy handoff contract.
   */
  prepareChildRun(parentRunId: string, input: StartChildRunInput): ChildRunLaunchResult {
    const parent = this.getRun(parentRunId);
    if (!parent) return { ok: false, reason: 'not_found', message: 'Parent run was not found.' };
    if (terminalStatuses.includes(parent.status)) return { ok: false, reason: 'terminal', message: 'A terminal run cannot create a child.' };
    if (typeof input.task !== 'string' || !input.task.trim() || typeof input.role !== 'string' || !input.role.trim()) {
      return { ok: false, reason: 'invalid_request', message: 'Child task and role are required.' };
    }
    const provider = input.provider || 'fresh';
    if (!['fresh', 'forked', 'in-process', 'external', 'acp'].includes(provider)) {
      return { ok: false, reason: 'unsupported_provider', message: `Unsupported child provider: ${provider}` };
    }
    if (input.childId && this.getRun(input.childId)) {
      return { ok: false, reason: 'duplicate', message: `Child run ${input.childId} already exists.` };
    }

    const parentMetadata = objectMetadata(parent.metadata);
    const parentChild = childRecordFromRun(parent);
    const parentBudget = normalizeChildBudget(
      (parentMetadata.childBudget && typeof parentMetadata.childBudget === 'object' ? parentMetadata.childBudget : undefined) as Partial<ChildRunBudget> | undefined,
      parentChild?.budget,
    );
    const parentPackDefinition = objectMetadata(parentMetadata.capabilityPackDefinition);
    const parentPackId = typeof parentPackDefinition.id === 'string'
      ? parentPackDefinition.id
      : typeof parentMetadata.capabilityPack === 'string' ? parentMetadata.capabilityPack : undefined;
    let builtInParentPack: ReturnType<typeof getCapabilityPack> | undefined;
    if (parentPackId) {
      try {
        builtInParentPack = getCapabilityPack(parentPackId as CapabilityPackName);
      } catch {
        // A custom pack definition is handled through the parent's persisted constraints below.
      }
    }
    const parentAllowedTools = parentChild?.capabilities.allowedTools || (
      Array.isArray(parentPackDefinition.allowedTools)
        ? parentPackDefinition.allowedTools.filter((value): value is string => typeof value === 'string')
        : Array.isArray(parentMetadata.allowedTools)
          ? parentMetadata.allowedTools.filter((value): value is string => typeof value === 'string')
          : builtInParentPack?.allowedTools ? [...builtInParentPack.allowedTools] : undefined
    );
    const requestedCapabilities = input.capabilities || {};
    const requestedAllowed = requestedCapabilities.allowedTools;
    const allowedTools = parentAllowedTools
      ? (requestedAllowed ? requestedAllowed.filter((tool) => parentAllowedTools.includes(tool)) : [...parentAllowedTools])
      : requestedAllowed;
    const parentDenied = parentChild?.capabilities.deniedTools || (
      Array.isArray(parentPackDefinition.deniedTools)
        ? parentPackDefinition.deniedTools.filter((value): value is string => typeof value === 'string')
        : Array.isArray(parentMetadata.deniedTools)
          ? parentMetadata.deniedTools.filter((value): value is string => typeof value === 'string')
          : builtInParentPack?.deniedTools ? [...builtInParentPack.deniedTools] : []
    );
    const parentModelTarget = childModelTargetFromMetadata(parentMetadata.activeModelTarget) || childModelTargetFromMetadata(parentMetadata.modelTarget);
    const modelTarget = input.modelTarget || (!input.model ? parentModelTarget : undefined);
    const modelContextWindow = input.modelContextWindow || (!input.model && Number.isFinite(Number(parentMetadata.modelContextWindow))
      ? Number(parentMetadata.modelContextWindow)
      : undefined);
    const parentApprovalMode = parentChild?.capabilities.approvalMode || (
      parentMetadata.approvalPolicy === 'full_access' ? 'full_workspace'
        : parentMetadata.approvalPolicy === 'auto_approve' ? 'scoped_auto_approve'
          : parentMetadata.approvalPolicy === 'read_only' ? 'read_only'
            : parentPackDefinition.policyMode === 'full_workspace' || parentPackDefinition.policyMode === 'scoped_auto_approve' || parentPackDefinition.policyMode === 'read_only'
              ? parentPackDefinition.policyMode
              : 'ask'
    );
    const parentApprovalScopes = parentChild?.capabilities.approvalScopes || (
      Array.isArray(parentPackDefinition.approvalScopes)
        ? parentPackDefinition.approvalScopes.filter((value): value is string => typeof value === 'string')
        : Array.isArray(parentMetadata.approvalScopes) ? parentMetadata.approvalScopes.filter((value): value is string => typeof value === 'string') : undefined
    );
    const requestedScopes = requestedCapabilities.approvalScopes;
    const approvalScopes = parentApprovalScopes
      ? requestedScopes ? requestedScopes.filter((scope) => parentApprovalScopes.includes(scope)) : parentApprovalScopes
      : requestedScopes;
    const capabilities: ChildRunCapabilities = {
      pack: requestedCapabilities.pack || parentChild?.capabilities.pack || parentPackId || 'delegated-child',
      ...(allowedTools ? { allowedTools: [...new Set(allowedTools)] } : {}),
      deniedTools: [...new Set([...parentDenied, ...(requestedCapabilities.deniedTools || [])])],
      approvalMode: approvalModeAtMost(
        parentApprovalMode,
        requestedCapabilities.approvalMode || 'ask',
      ) as ChildRunCapabilities['approvalMode'],
      ...(approvalScopes ? { approvalScopes: [...new Set(approvalScopes)] } : {}),
    };
    const workspace = input.workspace || parent.workspace;
    const childRequest: StartChildRunInput = {
      ...input,
      task: input.task.trim().slice(0, 64_000),
      role: input.role.trim().slice(0, 120),
      provider,
      ...(workspace ? { workspace } : {}),
      ...(input.model || modelTarget?.requestedTarget || parent.model ? { model: input.model || modelTarget?.requestedTarget || parent.model } : {}),
      ...(modelTarget ? { modelTarget } : {}),
      ...(modelContextWindow ? { modelContextWindow } : {}),
      capabilities,
      depth: input.depth ?? (parentChild ? parentChild.depth + 1 : 1),
    };
    const record = createChildRunRecord(childRequest, {
      runId: parent.id,
      sessionId: parentChild?.parentSessionId || parent.threadId || (typeof parentMetadata.sessionId === 'string' ? parentMetadata.sessionId : undefined),
      lineage: [...(parentChild?.lineage || [parent.id]), ...(parentChild ? [parentChild.childId] : [])],
      budget: parentBudget,
    });
    if (record.depth > parentBudget.maxDepth) {
      return { ok: false, reason: 'depth_limit', message: `Child depth ${record.depth} exceeds the parent limit of ${parentBudget.maxDepth}.` };
    }
    const metadata: Record<string, unknown> = {
      parentRunId: parent.id,
      parentSessionId: record.parentSessionId,
      childRun: record,
      ...(record.modelTarget ? { pinnedModelTarget: record.modelTarget } : {}),
      ...(record.modelContextWindow ? { modelContextWindow: record.modelContextWindow } : {}),
      ...(record.modelTarget?.profileId ? { providerProfile: record.modelTarget.profileId } : {}),
      ...(parentMetadata.delegationSettingsSnapshot ? { delegationSettingsSnapshot: parentMetadata.delegationSettingsSnapshot } : {}),
      ...(Array.isArray(parentMetadata.allowedExternalProviders) ? { allowedExternalProviders: parentMetadata.allowedExternalProviders.filter((value): value is string => typeof value === 'string') } : {}),
      ...(parentMetadata.privateWorkspace === true ? { privateWorkspace: true } : {}),
      ...(parentMetadata.sendPrivateSourceCode === true ? { sendPrivateSourceCode: true } : {}),
      childProvider: record.provider,
      childRole: record.role,
      capabilityPack: record.capabilities.pack,
      capabilityPackDefinition: {
        id: record.capabilities.pack || 'delegated-child',
        description: `Child capability scope for the ${record.role} role.`,
        ...(record.capabilities.allowedTools ? { allowedTools: record.capabilities.allowedTools } : {}),
        ...(record.capabilities.deniedTools?.length ? { deniedTools: record.capabilities.deniedTools } : {}),
        ...(record.capabilities.approvalScopes?.length ? { approvalScopes: record.capabilities.approvalScopes } : {}),
        policyMode: record.capabilities.approvalMode || 'ask',
        allowExternalProviders: false,
        allowWorkspaceMutation: record.capabilities.approvalMode !== 'read_only' && parentPackDefinition.allowWorkspaceMutation !== false && builtInParentPack?.allowWorkspaceMutation !== false,
        ...(typeof parentPackDefinition.defaultTimeoutClass === 'string'
          ? { defaultTimeoutClass: parentPackDefinition.defaultTimeoutClass }
          : builtInParentPack?.defaultTimeoutClass ? { defaultTimeoutClass: builtInParentPack.defaultTimeoutClass } : {}),
      },
      approvalPolicy: record.capabilities.approvalMode === 'full_workspace' ? 'full_access' : record.capabilities.approvalMode === 'scoped_auto_approve' ? 'auto_approve' : record.capabilities.approvalMode,
      maximumRequestsPerTask: record.budget.maxLlmRequests,
      maxToolCalls: record.budget.maxToolCalls,
      childBudget: record.budget,
      childDepth: record.depth,
      childLineage: record.lineage,
    };
    return { ok: true, record, metadata };
  }

  /** Register an already-created server run as a durable child. */
  registerChildRun(parentRunId: string, childRunId: string): ChildRunRecord | null {
    const parent = this.getRun(parentRunId);
    const child = this.getRun(childRunId);
    const record = childRecordFromRun(child);
    if (!parent || !child || !record || record.parentRunId !== parentRunId) return null;
    const startedAt = record.startedAt || Date.now();
    const started: ChildRunRecord = { ...record, status: 'running', startedAt, updatedAt: Date.now() };
    this.persistChildRecord(childRunId, started);
    this.emitChildLifecycle(parentRunId, childRunId, 'child_created', { child: started });
    this.emitChildLifecycle(parentRunId, childRunId, 'child_started', { child: started });

    const parentActive = this.activeRuns.get(parentRunId);
    if (parentActive) {
      const onParentAbort = () => {
        this.interruptRun(childRunId, `Parent run ${parentRunId} was cancelled.`);
      };
      parentActive.controller.signal.addEventListener('abort', onParentAbort, { once: true });
      this.childParentAbortCleanups.set(childRunId, () => parentActive.controller.signal.removeEventListener('abort', onParentAbort));
      if (parentActive.controller.signal.aborted) onParentAbort();
    }
    if (started.budget.timeoutMs > 0) {
      const timeout = setTimeout(() => {
        this.setChildStatus(childRunId, 'timed_out', `Child exceeded its ${started.budget.timeoutMs}ms timeout.`);
        this.interruptRun(childRunId, `Child exceeded its ${started.budget.timeoutMs}ms timeout.`);
      }, started.budget.timeoutMs);
      this.childTimeouts.set(childRunId, timeout);
    }
    void this.waitForRun(childRunId).then(() => this.finalizeChildRun(parentRunId, childRunId));
    return started;
  }

  listChildRuns(parentRunId: string): ChildRunRecord[] {
    return this.store.listAgentRuns(1000)
      .map((run) => {
        const record = childRecordFromRun(run);
        return record ? { run, record } : undefined;
      })
      .filter((value): value is { run: StoredAgentRun; record: ChildRunRecord } => Boolean(value && value.record.parentRunId === parentRunId))
      .map(({ run, record }) => ({ ...record, status: childStatusForRun(run.status, record) }))
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  getChildRun(childRunId: string): ChildRunRecord | null {
    const run = this.getRun(childRunId);
    const record = childRecordFromRun(run);
    return record && run ? { ...record, status: childStatusForRun(run.status, record) } : null;
  }

  getChildReport(childRunId: string): ChildRunReport | null {
    return this.getChildRun(childRunId)?.report || null;
  }

  async waitForChildReport(parentRunId: string, childRunId: string): Promise<ChildRunReport | null> {
    const child = this.getChildRun(childRunId);
    if (!child || child.parentRunId !== parentRunId) return null;
    await this.waitForRun(childRunId);
    this.finalizeChildRun(parentRunId, childRunId);
    return this.getChildReport(childRunId);
  }

  /** Preserve the child identity contract when the existing resume endpoint forks a run. */
  inheritChildLineage(priorChildRunId: string, nextRunId: string): ChildRunRecord | null {
    const prior = this.getChildRun(priorChildRunId);
    const next = this.getRun(nextRunId);
    if (!prior || !next || priorChildRunId === nextRunId) return null;
    const record: ChildRunRecord = {
      ...prior,
      childId: nextRunId,
      lineage: [...new Set([...prior.lineage, prior.childId])],
      status: 'created',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      startedAt: undefined,
      finishedAt: undefined,
      terminalReason: undefined,
      report: undefined,
    };
    const metadata = objectMetadata(next.metadata);
    this.store.updateAgentRun({ id: nextRunId, metadata: { ...metadata, childRun: record, parentRunId: record.parentRunId }, updatedAt: Date.now() });
    return this.registerChildRun(record.parentRunId, nextRunId);
  }

  sendChildFollowUp(parentRunId: string, childRunId: string, input: { message: string; messageId?: string }): ReturnType<ServerRunManager['enqueueInboxMessage']> | { ok: false; reason: 'not_child' } {
    const child = this.getChildRun(childRunId);
    if (!child || child.parentRunId !== parentRunId) return { ok: false, reason: 'not_child' };
    const result = this.enqueueInboxMessage(childRunId, {
      message: input.message,
      messageId: input.messageId,
      source: 'parent_follow_up',
      target: 'next-turn',
    });
    if (result.ok) this.emitChildLifecycle(parentRunId, childRunId, 'child_follow_up_requested', { messageId: result.message.id });
    return result;
  }

  interruptChildRun(parentRunId: string, childRunId: string, reason = 'Child interrupted by parent.'): boolean {
    const child = this.getChildRun(childRunId);
    if (!child || child.parentRunId !== parentRunId) return false;
    const interrupted = this.interruptRun(childRunId, reason);
    if (interrupted) this.emitChildLifecycle(parentRunId, childRunId, 'child_status_changed', { status: 'interrupted', reason });
    return interrupted;
  }

  private persistChildRecord(childRunId: string, record: ChildRunRecord): void {
    const child = this.getRun(childRunId);
    if (!child) return;
    const metadata = objectMetadata(child.metadata);
    this.store.updateAgentRun({ id: childRunId, metadata: { ...metadata, childRun: record }, updatedAt: Date.now() });
  }

  private setChildStatus(childRunId: string, status: ChildRunStatus, reason?: string): void {
    const child = this.getRun(childRunId);
    const record = childRecordFromRun(child);
    if (!record) return;
    const next: ChildRunRecord = {
      ...record,
      status,
      updatedAt: Date.now(),
      ...(reason ? { terminalReason: reason.slice(0, 2_000) } : {}),
      ...(terminalStatuses.includes(child?.status || 'running') || ['completed', 'failed', 'interrupted', 'cancelled', 'timed_out'].includes(status)
        ? { finishedAt: record.finishedAt || Date.now() }
        : {}),
    };
    this.persistChildRecord(childRunId, next);
  }

  private emitChildLifecycle(parentRunId: string, childRunId: string, type: string, data: unknown): void {
    const childActive = this.activeRuns.get(childRunId);
    this.appendAndBroadcast(childRunId, childActive, childActive?.subscribers || new Set<Subscriber>(), type, data);
    const parentActive = this.activeRuns.get(parentRunId);
    this.appendAndBroadcast(parentRunId, parentActive, parentActive?.subscribers || new Set<Subscriber>(), type, { childId: childRunId, ...objectMetadata(data) });
  }

  private finalizeChildRun(parentRunId: string, childRunId: string): void {
    const child = this.getRun(childRunId);
    const record = childRecordFromRun(child);
    if (!child || !record) return;
    if (record.report && terminalStatuses.includes(child.status)) return;
    const status = childStatusForRun(child.status, record);
    const reason = child.stopReason || (status === 'failed' ? this.resultErrorMessage(child.result) : undefined);
    const report = record.report || normalizeChildReport(childRunId, child.result, reason, Date.now());
    const next: ChildRunRecord = {
      ...record,
      status,
      updatedAt: Date.now(),
      ...(child.finishedAt ? { finishedAt: child.finishedAt } : ['completed', 'failed', 'interrupted', 'cancelled', 'timed_out'].includes(status) ? { finishedAt: Date.now() } : {}),
      ...(reason ? { terminalReason: reason.slice(0, 2_000) } : {}),
      report,
    };
    this.persistChildRecord(childRunId, next);
    this.emitChildLifecycle(parentRunId, childRunId, 'child_report', { report });
    this.emitChildLifecycle(parentRunId, childRunId, 'child_terminal', { status, report, ...(reason ? { reason } : {}) });
    const cleanup = this.childParentAbortCleanups.get(childRunId);
    cleanup?.();
    this.childParentAbortCleanups.delete(childRunId);
    const timeout = this.childTimeouts.get(childRunId);
    if (timeout) clearTimeout(timeout);
    this.childTimeouts.delete(childRunId);
  }

  /** Repair runs left active by a previous server process and leave them resumable. */
  recoverActiveRuns(reason = 'Server restarted before the run completed.'): StartupRecoveryReport[] {
    const activeRuns = this.store.listAgentRuns(1000).filter((run) =>
      run.status === 'running' || run.status === 'waiting_for_user' || run.status === 'waiting_for_provider'
    );
    const reports: StartupRecoveryReport[] = [];
    for (const run of activeRuns) {
      const checkpoint = this.getCheckpoint(run.id);
      const contextSnapshotRebuilt = Boolean(checkpoint && !this.getContextSnapshot(run.id));
      if (checkpoint && contextSnapshotRebuilt) {
        this.store.upsertAgentRunContextSnapshot(createReactContextSnapshot(run.id, checkpoint, run.lastEventSeq));
      }
      const claimedInbox = this.store.listAgentRunInbox(run.id, { status: 'claimed' });
      const releasedInbox = claimedInbox.length > 0 ? this.store.releaseAgentRunInboxClaims(run.id) : [];
      if (claimedInbox.length > 0) {
        this.appendAndBroadcast(
          run.id,
          undefined,
          new Set<Subscriber>(),
          'inbox_claims_released',
          { type: 'inbox_claims_released', reason, messageIds: claimedInbox.map((entry) => entry.messageId), pending: releasedInbox },
        );
      }
      const events = this.store.listAgentRunEvents(run.id);
      const unfinishedRequests = findUnfinishedModelRequests(events);
      for (const request of unfinishedRequests) {
        this.appendAndBroadcast(
          run.id,
          undefined,
          new Set<Subscriber>(),
          'llm_request_finished',
          {
            request: createUnknownRequestEnvelope(
              request,
              `${reason} Model request ${request.requestId} stopped before a durable terminal outcome was recorded.`,
            ),
          },
        );
      }
      const unfinished = findUnfinishedToolCalls(events);
      for (const call of unfinished) {
        const outcome = createUnknownToolOutcome(call, `${reason} ${call.tool} stopped before a durable result was recorded.`);
        this.appendAndBroadcast(
          run.id,
          undefined,
          new Set<Subscriber>(),
          'tool_outcome_unknown',
          { type: 'tool_outcome_unknown', outcome },
        );
        this.recordUncertainToolOutcome(run.id, outcome);
      }
      const currentCheckpoint = this.getCheckpoint(run.id);
      const blockedSideEffects = currentCheckpoint?.state.uncertainToolCalls?.length || 0;
      const latestRun = this.getRun(run.id);
      const currentMetadata = latestRun?.metadata && typeof latestRun.metadata === 'object'
        ? latestRun.metadata as Record<string, unknown>
        : {};
      this.store.updateAgentRun({
        id: run.id,
        metadata: {
          ...currentMetadata,
          startupRecovery: {
            version: 1,
            repairedAt: Date.now(),
            reason: reason.slice(0, 500),
            repairedModelRequests: unfinishedRequests.length,
            repairedToolCalls: unfinished.length,
            contextSnapshotRebuilt,
            blockedSideEffects,
            resumable: Boolean(currentCheckpoint),
          },
        },
        updatedAt: Date.now(),
      });
      const interruptedResult = this.normalizeLifecycleResult({ error: reason }, 'interrupted');
      const terminalAdvice = resolveTerminalRunAdvice({
        status: 'interrupted',
        result: interruptedResult,
        stopReason: reason,
        blockedReason: currentCheckpoint?.state.blockedReason,
        noProgressCount: currentCheckpoint?.state.noProgressCount,
      });
      if (terminalAdvice) {
        this.appendAndBroadcast(run.id, undefined, new Set<Subscriber>(), 'run_terminal_advice', {
          type: 'run_terminal_advice',
          ...terminalAdvice,
        });
      }
      this.appendAndBroadcast(
        run.id,
        undefined,
        new Set<Subscriber>(),
        'interrupted',
        { type: 'interrupted', message: reason },
      );
      reports.push({
        runId: run.id,
        repairedModelRequests: unfinishedRequests.length,
        repairedToolCalls: unfinished.length,
        contextSnapshotRebuilt,
        blockedSideEffects,
      });
    }
    this.store.markRunningAgentRunsInterrupted(reason);
    // Child records are projections too: close them after the root status
    // repair so a restarted process never leaves a durable child "running".
    for (const child of this.store.listAgentRuns(1000).map((candidate) => childRecordFromRun(candidate)).filter((value): value is ChildRunRecord => Boolean(value && (value.status === 'running' || value.status === 'waiting_for_user' || value.status === 'waiting_for_provider')))) {
      this.finalizeChildRun(child.parentRunId, child.childId);
    }
    return reports;
  }

  startRun(input: StartServerRunInput, executor: RunExecutor): StoredAgentRun {
    const now = Date.now();
    const continuousRun = input.continuousRun === true || input.metadata?.continuousRun === true;
    const globalStepLimit = resolveGlobalStepLimit(input.globalStepLimit ?? input.metadata?.globalStepLimit);
    const wallClockBudgetMs = resolveRunWallClockBudgetMs(input.wallClockBudgetMs ?? input.metadata?.wallClockBudgetMs);
    const maxRecoveryTransitions = resolveMaxRecoveryTransitions(input.maxRecoveryTransitions ?? input.metadata?.maxRecoveryTransitions);
    const executionStepWindow = this.normalizeExecutionStepWindow(
      continuousRun
        ? Math.min(globalStepLimit, CONTINUOUS_RUN_STEP_WINDOW)
        : input.executionStepWindow ?? input.maxSteps ?? input.metadata?.executionStepWindow,
      globalStepLimit,
    );
    const run: StoredAgentRun = {
      id: input.id || createId(),
      kind: input.kind,
      threadId: input.threadId,
      status: 'running',
      task: input.task,
      workspace: input.workspace,
      model: input.model,
      metadata: {
        ...(input.metadata || {}),
        executionStepWindow,
        ...(Number.isFinite(input.maxProviderCooldownRetries)
          ? { maxProviderCooldownRetries: Math.max(0, Math.min(10, Math.floor(Number(input.maxProviderCooldownRetries)))) }
          : {}),
        ...(typeof input.waitForProviderAvailability === 'boolean'
          ? { waitForProviderAvailability: input.waitForProviderAvailability }
          : {}),
        continuousRun,
        globalStepLimit,
        wallClockBudgetMs,
        maxRecoveryTransitions,
      },
      createdAt: now,
      updatedAt: now,
      lastEventSeq: 0,
    };
    this.store.createAgentRun(run);

    const controller = new AbortController();
    const subscribers = new Set<Subscriber>();
    const activeRun: ActiveRun = {
      controller,
      subscribers,
      promise: Promise.resolve(),
      lastEventSeq: run.lastEventSeq,
      boundaryCount: 0,
      executionStepWindow,
      globalStepLimit,
      runStartedAt: now,
      wallClockBudgetMs,
      maxRecoveryTransitions,
    };
    this.activeRuns.set(run.id, activeRun);
    const parentRunId = typeof input.metadata?.parentRunId === 'string' ? input.metadata.parentRunId : undefined;
    if (parentRunId) {
      const copiedInbox = this.store.copyPendingAgentInbox(parentRunId, run.id);
      if (copiedInbox.length > 0) {
        this.appendAndBroadcast(run.id, activeRun, subscribers, 'inbox_requeued', {
          type: 'inbox_requeued',
          parentRunId,
          entries: copiedInbox,
        });
      }
    }
    activeRun.promise = this.executeRun(run.id, controller, subscribers, executor);
    return this.getRun(run.id) || run;
  }

  getRun(runId: string): StoredAgentRun | null {
    return this.store.getAgentRun(runId);
  }

  getRunLiveness(runId: string, now = Date.now()): {
    lastActivityAt: number;
    lastMeaningfulProgressAt?: number;
    lastWorkspaceChangeAt?: number;
    lastSuccessfulVerificationAt?: number;
    activeRequest?: {
      requestId: string;
      requestKind?: string;
      provider: string;
      model: string;
      startedAt: number;
      elapsedMs: number;
      effectiveDeadlineAt?: number;
      stale: boolean;
      outcome: 'pending' | 'unknown';
    };
  } | null {
    const run = this.getRun(runId);
    if (!run) return null;
    const afterSeq = Math.max(0, run.lastEventSeq - 500);
    const events = run.status === 'running' ? this.listEvents(runId, afterSeq) : [];
    let lastActivityAt = run.updatedAt;
    const metadata = objectMetadata(run.metadata);
    const lastMeaningfulProgressAt = typeof metadata.lastMeaningfulProgressAt === 'number' && Number.isFinite(metadata.lastMeaningfulProgressAt)
      ? metadata.lastMeaningfulProgressAt
      : undefined;
    const lastWorkspaceChangeAt = typeof metadata.lastWorkspaceChangeAt === 'number' && Number.isFinite(metadata.lastWorkspaceChangeAt)
      ? metadata.lastWorkspaceChangeAt
      : undefined;
    const lastSuccessfulVerificationAt = typeof metadata.lastSuccessfulVerificationAt === 'number' && Number.isFinite(metadata.lastSuccessfulVerificationAt)
      ? metadata.lastSuccessfulVerificationAt
      : undefined;
    const progressTimestamps = {
      ...(lastMeaningfulProgressAt !== undefined ? { lastMeaningfulProgressAt } : {}),
      ...(lastWorkspaceChangeAt !== undefined ? { lastWorkspaceChangeAt } : {}),
      ...(lastSuccessfulVerificationAt !== undefined ? { lastSuccessfulVerificationAt } : {}),
    };
    const activeRequests = new Map<string, Record<string, unknown>>();

    for (const stored of events) {
      lastActivityAt = Math.max(lastActivityAt, stored.createdAt);
      const envelope = objectValue(stored.event);
      const payload = objectValue(envelope?.data) || envelope;
      if (!payload) continue;
      if (stored.eventType === 'llm_request_started') {
        const request = objectValue(payload.request);
        if (request && typeof request.requestId === 'string') activeRequests.set(request.requestId, request);
      } else if (stored.eventType === 'llm_request_finished') {
        const request = objectValue(payload.request);
        if (typeof request?.requestId === 'string') activeRequests.delete(request.requestId);
      } else if (stored.eventType === 'llm_request_heartbeat' && typeof payload.requestId === 'string') {
        const prior = activeRequests.get(payload.requestId) || {};
        const route = objectValue(prior.resolvedRoute) || objectValue(prior.requestedRoute) || {};
        activeRequests.set(payload.requestId, {
          ...prior,
          requestKind: payload.requestKind ?? prior.requestKind,
          startedAt: payload.startedAt ?? prior.startedAt,
          requestedRoute: {
            ...route,
            ...(typeof payload.provider === 'string' ? { provider: payload.provider } : {}),
            ...(typeof payload.model === 'string' ? { model: payload.model } : {}),
          },
          ...(typeof payload.deadlineAt === 'number' ? { deadlineAt: payload.deadlineAt } : {}),
        });
      }
    }

    const activeEntries = [...activeRequests.entries()];
    const active = activeEntries[activeEntries.length - 1];
    if (!active) return { lastActivityAt, ...progressTimestamps };
    const [requestId, request] = active;
    const route = objectValue(request.resolvedRoute) || objectValue(request.requestedRoute) || {};
    const options = objectValue(request.options) || {};
    const startedAt = typeof request.startedAt === 'number' && Number.isFinite(request.startedAt)
      ? request.startedAt
      : lastActivityAt;
    const explicitDeadline = typeof request.deadlineAt === 'number' ? request.deadlineAt : undefined;
    const timeoutMs = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : undefined;
    const effectiveDeadlineAt = explicitDeadline ?? (timeoutMs ? startedAt + timeoutMs : undefined);
    const stale = effectiveDeadlineAt !== undefined && now > effectiveDeadlineAt;
    return {
      lastActivityAt,
      ...progressTimestamps,
      activeRequest: {
        requestId,
        ...(typeof request.requestKind === 'string' ? { requestKind: request.requestKind } : {}),
        provider: typeof route.provider === 'string' ? route.provider : 'unknown',
        model: typeof route.model === 'string' ? route.model : 'unknown',
        startedAt,
        elapsedMs: Math.max(0, now - startedAt),
        ...(effectiveDeadlineAt !== undefined ? { effectiveDeadlineAt } : {}),
        stale,
        outcome: stale ? 'unknown' : 'pending',
      },
    };
  }

  /**
   * Find a terminal Coder attempt that already changed the workspace for the
   * same thread, workspace, and visible user request. A fresh POST for this
   * identity must resume the checkpoint instead of creating another writer.
   */
  findEquivalentCoderRun(input: {
    threadId?: string;
    workspace?: string;
    displayTask?: string;
  }): StoredAgentRun | null {
    const threadId = typeof input.threadId === 'string' && input.threadId.trim() ? input.threadId.trim() : undefined;
    const displayTask = normalizeRunIdentity(input.displayTask);
    if (!threadId || !displayTask) return null;
    const workspace = normalizeWorkspaceIdentity(input.workspace);

    return this.store.listAgentRuns(1000)
      .filter((run) => {
        const terminalFailure = ['failed', 'stopped', 'interrupted', 'killed'].includes(run.status)
          || isRetryableCompletedRun(run.status, run.result);
        if (run.kind !== 'coder' || !terminalFailure) return false;
        if (run.threadId !== threadId || normalizeWorkspaceIdentity(run.workspace) !== workspace) return false;
        const metadata = objectMetadata(run.metadata);
        const savedDisplayTask = normalizeRunIdentity(metadata.displayTask || run.task);
        if (savedDisplayTask !== displayTask) return false;
        const checkpoint = this.getCheckpoint(run.id);
        return Boolean(checkpoint && hasSuccessfulMutationInCheckpoint(checkpoint));
      })
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] || null;
  }

  listRuns(filter: RunListFilter = {}): StoredAgentRun[] {
    const cutoff = Date.now() - 1000 * 60 * 60 * 24;
    const runs = this.store.listAgentRunSummaries(100, filter.kind);
    const supersededParentIds = new Set(runs.flatMap((run) => {
      const metadata = run.metadata && typeof run.metadata === 'object'
        ? run.metadata as Record<string, unknown>
        : {};
      return typeof metadata.parentRunId === 'string' ? [metadata.parentRunId] : [];
    }));
    const selectedRuns = runs.filter((run) => {
      if (supersededParentIds.has(run.id)) return false;
      if (filter.resumable) {
        if (run.status === 'running' || run.status === 'waiting_for_user' || run.status === 'waiting_for_provider') return true;
        const checkpoint = this.getCheckpoint(run.id);
        if (!checkpoint) return false;
        if (run.status === 'interrupted' || run.status === 'failed' || run.status === 'stopped' || run.status === 'killed') return true;
        const detailed = run.status === 'completed' ? this.getRun(run.id) : null;
        const result = detailed?.result;
        return Boolean(result && typeof result === 'object' && (result as { errorCode?: unknown }).errorCode === 'PHASE_COMPLETED');
      }
      if (run.status === 'running' || run.status === 'waiting_for_user' || run.status === 'waiting_for_provider' || run.status === 'interrupted' || run.status === 'killed') return true;
      if (run.seenAt && run.seenAt >= run.updatedAt) return false;
      return run.updatedAt >= cutoff || run.seenAt === undefined;
    });
    return filter.resumable
      ? selectedRuns.map((run) => ({
          ...run,
          metadata: {
            ...(run.metadata && typeof run.metadata === 'object' ? run.metadata : {}),
            continuationAvailable: true,
          },
        }))
      : selectedRuns;
  }

  listEvents(runId: string, afterSeq = 0): StoredAgentRunEvent[] {
    return this.store.listAgentRunEvents(runId, afterSeq);
  }

  listEventPage(runId: string, afterSeq = 0, limit = DEFAULT_RUN_EVENT_PAGE_SIZE): StoredAgentRunEventPage {
    return this.store.listAgentRunEventPage(runId, afterSeq, limit);
  }

  /** Rebuild the compact run view from the persisted event stream. */
  projectEvents(runId: string, afterSeq = 0, options: HarnessProjectionOptions = {}): HarnessRunProjection {
    const events = this.listEvents(runId, afterSeq).map((stored) => normalizeHarnessEvent(stored.event, {
      runId: stored.runId,
      seq: stored.seq,
      type: stored.eventType,
      timestamp: stored.createdAt,
    }));
    return projectHarnessEvents(events, options);
  }

  /** Project only one bounded event page for incremental polling. */
  projectEventPage(
    runId: string,
    afterSeq = 0,
    limit = DEFAULT_RUN_EVENT_PAGE_SIZE,
    options: HarnessProjectionOptions = {},
  ): StoredAgentRunEventPage & { projection: HarnessRunProjection } {
    const page = this.listEventPage(runId, afterSeq, limit);
    const events = page.events.map((stored) => normalizeHarnessEvent(stored.event, {
      runId: stored.runId,
      seq: stored.seq,
      type: stored.eventType,
      timestamp: stored.createdAt,
    }));
    return { ...page, projection: projectHarnessEvents(events, options) };
  }

  getCheckpoint(runId: string): ReactCheckpoint | null {
    const run = this.store.getAgentRun(runId);
    const checkpoint = run?.metadata && typeof run.metadata === 'object'
      ? (run.metadata as Record<string, unknown>).checkpoint
      : undefined;
    return validateReactCheckpoint(checkpoint) ? checkpoint : null;
  }

  /** Durable policy state shared by the server, planner, executor, and direct tools. */
  getApprovalGrants(runId: string): ApprovalScopeGrant[] {
    const metadata = this.getRun(runId)?.metadata;
    const raw = metadata && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>).approvalGrants
      : undefined;
    if (!Array.isArray(raw)) return [];
    return activeApprovalGrants(raw.filter((grant): grant is ApprovalScopeGrant => Boolean(
      grant && typeof grant === 'object' && typeof (grant as ApprovalScopeGrant).scope === 'string' &&
      ((grant as ApprovalScopeGrant).decision === 'allow' || (grant as ApprovalScopeGrant).decision === 'deny') &&
      typeof (grant as ApprovalScopeGrant).createdAt === 'number'
    )));
  }

  setApprovalGrants(runId: string, grants: ApprovalScopeGrant[]): ApprovalScopeGrant[] | null {
    const run = this.getRun(runId);
    if (!run) return null;
    const metadata = run.metadata && typeof run.metadata === 'object' ? run.metadata as Record<string, unknown> : {};
    const active = activeApprovalGrants(grants);
    this.store.updateAgentRun({ id: runId, metadata: { ...metadata, approvalGrants: active } });
    return active;
  }

  /** Updates durable run metadata for future internal retries without changing prior events. */
  updateRunMetadata(runId: string, updates: Record<string, unknown>): StoredAgentRun | null {
    const run = this.getRun(runId);
    if (!run) return null;
    const metadata = run.metadata && typeof run.metadata === 'object' ? run.metadata as Record<string, unknown> : {};
    this.store.updateAgentRun({ id: runId, metadata: { ...metadata, ...updates }, updatedAt: Date.now() });
    return this.getRun(runId);
  }

  getContextSnapshot(runId: string) {
    return this.store.getAgentRunContextSnapshot(runId);
  }

  /** Keep only a small recent window in memory; prompt text is never persisted or added to run events. */
  recordPlannerContextSnapshot(runId: string, stepSeq: number, snapshot: Record<string, unknown>): void {
    if (!runId || !Number.isInteger(stepSeq) || stepSeq < 1 || !snapshot || typeof snapshot !== 'object') return;
    let snapshots = this.plannerContextSnapshots.get(runId);
    if (!snapshots) {
      snapshots = new Map();
      this.plannerContextSnapshots.set(runId, snapshots);
    }
    snapshots.set(stepSeq, structuredClone(snapshot));
    this.plannerContextSnapshotOrder = this.plannerContextSnapshotOrder.filter((entry) => entry.runId !== runId || entry.stepSeq !== stepSeq);
    this.plannerContextSnapshotOrder.push({ runId, stepSeq });

    while (snapshots.size > 10) {
      const oldestStep = snapshots.keys().next().value as number | undefined;
      if (oldestStep === undefined) break;
      snapshots.delete(oldestStep);
    }
    while (this.plannerContextSnapshotOrder.length > 200) {
      const oldest = this.plannerContextSnapshotOrder.shift();
      if (!oldest) break;
      const runSnapshots = this.plannerContextSnapshots.get(oldest.runId);
      runSnapshots?.delete(oldest.stepSeq);
      if (runSnapshots?.size === 0) this.plannerContextSnapshots.delete(oldest.runId);
    }
  }

  getPlannerContextSnapshot(runId: string, stepSeq: number): Record<string, unknown> | null {
    const snapshot = this.plannerContextSnapshots.get(runId)?.get(stepSeq);
    return snapshot ? structuredClone(snapshot) : null;
  }

  queueUserMessage(
    runId: string,
    input: { message: string; source?: string },
  ): { ok: true; message: QueuedUserMessage; run: StoredAgentRun } | { ok: false; reason: 'not_found' | 'terminal' | 'invalid_message' | 'duplicate_message' } {
    return this.enqueueInboxMessage(runId, {
      message: input.message,
      source: input.source || 'follow_up',
      target: 'next-turn',
    });
  }

  enqueueInboxMessage(
    runId: string,
    input: InboxMessageInput,
  ): { ok: true; message: QueuedUserMessage; entry: StoredAgentInboxEntry; run: StoredAgentRun } | { ok: false; reason: 'not_found' | 'terminal' | 'invalid_message' | 'duplicate_message' } {
    const run = this.getRun(runId);
    const message = typeof input.message === 'string' ? input.message.trim().slice(0, 8_000) : '';
    if (!run) return { ok: false, reason: 'not_found' };
    if (terminalStatuses.includes(run.status)) return { ok: false, reason: 'terminal' };
    if (!message) return { ok: false, reason: 'invalid_message' };
    const source = typeof input.source === 'string' && input.source.trim() ? input.source.trim().slice(0, 80) : 'follow_up';
    const target = input.target || (source === 'steering' || source === 'harness' ? 'next-step' : 'next-turn');
    const messageId = typeof input.messageId === 'string' && input.messageId.trim() ? input.messageId.trim().slice(0, 256) : createId();
    let entry: StoredAgentInboxEntry;
    try {
      entry = this.store.enqueueAgentInbox({
        runId,
        messageId,
        source,
        target,
        message,
      });
    } catch (error) {
      if (error instanceof AgentInboxConflictError) return { ok: false, reason: 'duplicate_message' };
      throw error;
    }
    const queued = queuedMessageFromInbox(entry);
    const active = this.activeRuns.get(runId);
    if (active && entry.status === 'pending') {
      this.appendAndBroadcast(runId, active, active.subscribers, 'inbox_message_enqueued', { type: 'inbox_message_enqueued', entry });
      this.appendAndBroadcast(runId, active, active.subscribers, 'user_message_queued', {
        type: 'user_message_queued',
        messageId: queued.id,
        message: queued.message,
        queuedAt: queued.queuedAt,
        source: queued.source,
        target: queued.target,
      });
    }
    return { ok: true, message: queued, entry, run: this.getRun(runId) || run };
  }

  consumeQueuedMessages(runId: string): QueuedUserMessage[] {
    const run = this.getRun(runId);
    if (!run || terminalStatuses.includes(run.status)) return [];
    const active = this.activeRuns.get(runId);
    if (active) active.boundaryCount += 1;
    const claimId = `${runId}:boundary:${active?.boundaryCount || Date.now()}:${createId()}`;
    const nextStep = this.store.claimAgentRunInbox(runId, 'next-step', claimId, 20);
    const nextTurn = this.store.claimAgentRunInbox(runId, 'next-turn', claimId, 1);
    const claimed = [...nextStep, ...nextTurn].sort((left, right) => left.inboxSeq - right.inboxSeq);
    if (claimed.length > 0 && active) {
      this.appendAndBroadcast(runId, active, active.subscribers, 'inbox_message_claimed', {
        type: 'inbox_message_claimed',
        claimId,
        entries: claimed,
        boundary: active.boundaryCount,
      });
    }
    return claimed.map(queuedMessageFromInbox);
  }

  listInbox(runId: string, options: { status?: AgentInboxStatus; target?: AgentInboxTarget } = {}): StoredAgentInboxEntry[] {
    return this.store.listAgentRunInbox(runId, options);
  }

  acknowledgeQueuedMessages(runId: string, messageIds: string[]): StoredAgentInboxEntry[] {
    const active = this.activeRuns.get(runId);
    const processed: StoredAgentInboxEntry[] = [];
    for (const messageId of [...new Set(messageIds.filter((id) => typeof id === 'string' && id.trim()))]) {
      const before = this.store.getAgentRunInboxEntry(runId, messageId);
      if (!before || before.status === 'cancelled') continue;
      if (before.status === 'processed') continue;
      const entry = this.store.processAgentRunInboxEntry(runId, messageId, before.claimedBy);
      if (!entry) continue;
      processed.push(entry);
      if (active) this.appendAndBroadcast(runId, active, active.subscribers, 'inbox_message_processed', { type: 'inbox_message_processed', entry });
    }
    return processed;
  }

  replaceInboxMessage(
    runId: string,
    messageId: string,
    input: { message: string; source?: string; target?: AgentInboxTarget },
  ): StoredAgentInboxEntry | null {
    const message = typeof input.message === 'string' ? input.message.trim().slice(0, 8_000) : '';
    if (!message) return null;
    const before = this.store.getAgentRunInboxEntry(runId, messageId);
    const entry = this.store.replaceAgentRunInboxEntry(runId, messageId, {
      message,
      ...(input.source ? { source: input.source.trim().slice(0, 80) } : {}),
      ...(input.target ? { target: input.target } : {}),
    });
    const isIdempotentRetry = Boolean(
      before?.status === 'pending' &&
      before.message === message &&
      (input.source === undefined || before.source === input.source.trim().slice(0, 80)) &&
      (input.target === undefined || before.target === input.target)
    );
    if (entry && !isIdempotentRetry) {
      const active = this.activeRuns.get(runId);
      if (active) this.appendAndBroadcast(runId, active, active.subscribers, 'inbox_message_replaced', { type: 'inbox_message_replaced', entry });
    }
    return entry;
  }

  cancelInboxMessage(runId: string, messageId: string): StoredAgentInboxEntry | null {
    const before = this.store.getAgentRunInboxEntry(runId, messageId);
    const entry = this.store.cancelAgentRunInboxEntry(runId, messageId);
    if (entry && before?.status !== 'cancelled') {
      const active = this.activeRuns.get(runId);
      if (active) this.appendAndBroadcast(runId, active, active.subscribers, 'inbox_message_cancelled', { type: 'inbox_message_cancelled', entry });
    }
    return entry;
  }

  clearInbox(runId: string, target?: AgentInboxTarget): StoredAgentInboxEntry[] {
    const entries = this.store.clearAgentRunInbox(runId, target);
    const active = this.activeRuns.get(runId);
    if (active && entries.length > 0) this.appendAndBroadcast(runId, active, active.subscribers, 'inbox_cleared', { type: 'inbox_cleared', target, entries });
    return entries;
  }

  private releaseInboxClaims(runId: string, reason: string): void {
    const claimed = this.store.listAgentRunInbox(runId, { status: 'claimed' });
    if (claimed.length === 0) return;
    const pending = this.store.releaseAgentRunInboxClaims(runId);
    const active = this.activeRuns.get(runId);
    this.appendAndBroadcast(runId, active, active?.subscribers || new Set<Subscriber>(), 'inbox_claims_released', {
      type: 'inbox_claims_released',
      reason,
      messageIds: claimed.map((entry) => entry.messageId),
      pending,
    });
  }

  /** Stores a bounded, credential-safe record of every explicit target transition. */
  recordModelTargetTransition(runId: string, entry: Omit<ModelTargetAuditEntry, 'timestamp'>): void {
    const run = this.getRun(runId);
    if (!run) return;
    const metadata = run.metadata && typeof run.metadata === 'object' ? run.metadata as Record<string, unknown> : {};
    const prior = Array.isArray(metadata.modelTargetAudit) ? metadata.modelTargetAudit : [];
    const safeEntry: ModelTargetAuditEntry = {
      requestedTarget: entry.requestedTarget,
      provider: entry.provider,
      resolvedModel: entry.resolvedModel,
      ...(entry.profileId ? { profileId: entry.profileId } : {}),
      ...(Number.isInteger(entry.credentialIndex) ? { credentialIndex: entry.credentialIndex } : {}),
      ...(entry.targetId ? { targetId: entry.targetId } : {}),
      ...(typeof entry.contextWindow === 'number' && Number.isFinite(entry.contextWindow) && entry.contextWindow > 0
        ? { contextWindow: entry.contextWindow }
        : {}),
      route: entry.route,
      ...(entry.role ? { role: entry.role } : {}),
      ...(entry.reason ? { reason: entry.reason } : {}),
      timestamp: Date.now(),
    };
    this.store.updateAgentRun({
      id: runId,
      metadata: { ...metadata, modelTargetAudit: [...prior, safeEntry].slice(-50) },
      updatedAt: Date.now(),
    });
  }

  decideApprovalScope(runId: string, input: Omit<ApprovalScopeGrant, 'createdAt'> & { createdAt?: number }): ApprovalScopeGrant[] | null {
    const grant: ApprovalScopeGrant = {
      scope: input.scope,
      decision: input.decision,
      createdAt: input.createdAt || Date.now(),
      expiresAt: input.expiresAt,
      reason: input.reason,
    };
    const retained = this.getApprovalGrants(runId).filter((item) => item.scope !== grant.scope);
    return this.setApprovalGrants(runId, [...retained, grant]);
  }

  /** Resolve the durable plan boundary without replaying prior inspection. */
  decidePlanApproval(
    runId: string,
    input: PlanApprovalDecisionInput,
  ): { ok: true; approval: PlanApprovalState; checkpoint: ReactCheckpoint } | { ok: false; reason: 'not_found' | 'missing_checkpoint' | 'not_pending' } {
    const run = this.getRun(runId);
    if (!run) return { ok: false, reason: 'not_found' };
    const checkpoint = this.getCheckpoint(runId);
    if (!checkpoint) return { ok: false, reason: 'missing_checkpoint' };
    const current = checkpoint.state.planApproval;
    if (!current || current.status !== 'pending') return { ok: false, reason: 'not_pending' };

    const approval = resolvePlanApproval(current, input.decision, input.plan, input.reason);
    const state: ReactState = structuredClone(checkpoint.state);
    state.planApproval = approval;
    if (approval.status === 'approved') {
      state.plan = approval.approvedPlan || approval.proposedPlan;
      state.codingState = 'inspect';
      state.blockedReason = undefined;
    } else if (approval.status === 'pending') {
      state.plan = approval.proposedPlan;
      state.codingState = 'awaiting_plan_approval';
      state.blockedReason = 'Plan approval is required before mutations begin.';
    } else {
      state.codingState = 'blocked';
      state.blockedReason = approval.status === 'rejected' ? 'The user rejected the proposed plan.' : 'The user cancelled plan approval.';
    }

    const updatedCheckpoint = createReactCheckpoint(state);
    const metadata = run.metadata && typeof run.metadata === 'object' ? run.metadata as Record<string, unknown> : {};
    const priorAudit = Array.isArray(metadata.planApprovalAudit) ? metadata.planApprovalAudit : [];
    this.store.updateAgentRun({
      id: runId,
      metadata: {
        ...metadata,
        checkpoint: updatedCheckpoint,
        planApproval: approval,
        planApprovalAudit: [...priorAudit, {
          decision: input.decision,
          status: approval.status,
          at: Date.now(),
          ...(input.reason ? { reason: input.reason.slice(0, 500) } : {}),
        }].slice(-20),
      },
      updatedAt: Date.now(),
    });
    const active = this.activeRuns.get(runId);
    this.appendAndBroadcast(runId, active, active?.subscribers || new Set<Subscriber>(), 'plan_approval_resolved', {
      type: 'plan_approval_resolved',
      approval,
    });
    return { ok: true, approval, checkpoint: updatedCheckpoint };
  }

  /** Shared by HTTP and non-HTTP callers so every resume uses the same stale-evidence gate. */
  getResumeContext(runId: string): ResumeContext {
    const prior = this.getRun(runId);
    if (!prior) return { ok: false, reason: 'not_found' };
    const checkpoint = this.getCheckpoint(runId);
    if (!checkpoint) return { ok: false, reason: 'missing_checkpoint' };
    if (!isCheckpointWorkspaceFresh(checkpoint)) return { ok: false, reason: 'stale_workspace' };
    return { ok: true, prior, checkpoint };
  }

  stopRun(runId: string, reason = 'Run stopped by user.'): boolean {
    const active = this.activeRuns.get(runId);
    if (!active) {
      const run = this.store.getAgentRun(runId);
      return !!run && terminalStatuses.includes(run.status);
    }

    this.releaseInboxClaims(runId, `Run stopped: ${reason}`);
    this.store.updateAgentRun({
      id: runId,
      status: 'stopped',
      stopReason: reason,
      result: this.normalizeLifecycleResult({ error: reason }, 'stopped'),
      updatedAt: Date.now(),
    });
    if (!active.controller.signal.aborted) {
      // AbortController otherwise creates a generic DOMException AbortError.
      // Use a stackless domain reason so an expected user stop is not printed
      // as an unexplained platform failure by transports or process tooling.
      const cancellation: RunCancellationReason = {
        name: 'RunCancellationError',
        code: 'RUN_CANCELLED',
        message: reason,
      };
      active.controller.abort(cancellation);
    }
    if (active.pendingUserInput) {
      const pending = active.pendingUserInput;
      active.pendingUserInput = undefined;
      pending.resolve({ requestId: pending.request.requestId, cancelled: true });
    }
    return true;
  }

  interruptRun(runId: string, reason = 'Run interrupted by user.'): boolean {
    return this.cancelActiveRun(runId, 'interrupted', reason);
  }

  killRun(runId: string, reason = 'Run killed by user.'): boolean {
    return this.cancelActiveRun(runId, 'killed', reason);
  }

  private cancelActiveRun(runId: string, status: 'interrupted' | 'killed', reason: string): boolean {
    const active = this.activeRuns.get(runId);
    if (!active) {
      const run = this.store.getAgentRun(runId);
      if (!run || terminalStatuses.includes(run.status)) return Boolean(run && run.status === status);
      const result = this.normalizeLifecycleResult({ error: reason }, status);
      const advice = resolveTerminalRunAdvice({ status, result, stopReason: reason });
      if (advice) {
        this.appendAndBroadcast(runId, undefined, new Set<Subscriber>(), 'run_terminal_advice', {
          type: 'run_terminal_advice',
          ...advice,
        });
      }
      this.store.updateAgentRun({ id: runId, status, stopReason: reason, result, finishedAt: Date.now(), updatedAt: Date.now() });
      return true;
    }
    this.releaseInboxClaims(runId, `Run ${status}: ${reason}`);
    this.store.updateAgentRun({
      id: runId,
      status,
      stopReason: reason,
      result: this.normalizeLifecycleResult({ error: reason }, status),
      updatedAt: Date.now(),
    });
    if (!active.controller.signal.aborted) {
      active.controller.abort({ name: 'RunCancellationError', code: 'RUN_CANCELLED', message: reason });
    }
    if (active.pendingUserInput) {
      const pending = active.pendingUserInput;
      active.pendingUserInput = undefined;
      pending.resolve({ requestId: pending.request.requestId, cancelled: true });
    }
    return true;
  }

  getPendingUserInput(runId: string): PendingUserInputRequest | null {
    return this.activeRuns.get(runId)?.pendingUserInput?.request || null;
  }

  respondToUserInput(
    runId: string,
    requestId: string,
    input: { answer?: string; selectedOption?: string; cancelled?: boolean }
  ): { ok: true; response: UserInputResponse } | { ok: false; reason: 'not_found' | 'not_waiting' | 'request_mismatch' | 'invalid_option' | 'invalid_response' } {
    const active = this.activeRuns.get(runId);
    if (!active) return { ok: false, reason: 'not_found' };
    const pending = active.pendingUserInput;
    if (!pending) return { ok: false, reason: 'not_waiting' };
    if (pending.request.requestId !== requestId) return { ok: false, reason: 'request_mismatch' };

    const selectedOption = typeof input.selectedOption === 'string' ? input.selectedOption.trim() : undefined;
    if (selectedOption && !pending.request.options.includes(selectedOption)) {
      return { ok: false, reason: 'invalid_option' };
    }
    const answer = typeof input.answer === 'string' ? input.answer.trim().slice(0, 8_000) : undefined;
    if (input.cancelled !== true && !selectedOption && !answer) {
      return { ok: false, reason: 'invalid_response' };
    }
    if (answer && !pending.request.allowFreeform && !selectedOption) {
      return { ok: false, reason: 'invalid_response' };
    }
    const response: UserInputResponse = {
      requestId,
      ...(answer ? { answer } : {}),
      ...(selectedOption ? { selectedOption } : {}),
      cancelled: input.cancelled === true,
    };
    active.pendingUserInput = undefined;
    const run = this.getRun(runId);
    const metadata = run?.metadata && typeof run.metadata === 'object' ? run.metadata as Record<string, unknown> : {};
    this.store.updateAgentRun({
      id: runId,
      status: 'running',
      metadata: { ...metadata, pendingUserInput: undefined },
      updatedAt: Date.now(),
    });
    this.appendAndBroadcast(runId, active, active.subscribers, 'user_input_resolved', {
      type: 'user_input_resolved',
      requestId,
      cancelled: response.cancelled,
      ...(selectedOption ? { selectedOption } : {}),
      hasAnswer: Boolean(answer),
    });
    pending.resolve(response);
    return { ok: true, response };
  }

  markSeen(runId: string): void {
    this.store.markAgentRunSeen(runId);
  }

  async waitForRun(runId: string): Promise<void> {
    await this.activeRuns.get(runId)?.promise;
  }

  subscribe(runId: string, res: Response, afterSeq = 0): boolean {
    const run = this.store.getAgentRun(runId);
    if (!run) return false;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const write = (event: ServerRunEvent) => {
      if (res.destroyed || res.writableEnded) return;
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event.data)}\n`);
      res.write(`id: ${event.seq}\n\n`);
      (res as any).flush?.();
    };

    for (const storedEvent of this.store.listAgentRunEvents(runId, afterSeq)) {
      write(this.toServerEvent(storedEvent));
    }

    const active = this.activeRuns.get(runId);
    if (!active) {
      if (!res.writableEnded) res.end();
      return true;
    }

    const subscriber: Subscriber = {
      write,
      end: () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = undefined;
        }
        if (!res.writableEnded) res.end();
      },
    };
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    heartbeatTimer = setInterval(() => {
      if (res.destroyed || res.writableEnded) {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = undefined;
        }
        return;
      }
      res.write(': keep-alive\n\n');
      (res as any).flush?.();
    }, SSE_HEARTBEAT_INTERVAL_MS);
    active.subscribers.add(subscriber);
    res.on?.('close', () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
      active.subscribers.delete(subscriber);
    });
    return true;
  }

  private async executeRun(
    runId: string,
    controller: AbortController,
    subscribers: Set<Subscriber>,
    executor: RunExecutor
  ): Promise<void> {
    const activeRun = this.activeRuns.get(runId);
    const serverTrace = new PerformanceTrace('server-run');
    let terminalAdviceEmitted = false;
    const emit = (type: string, data: unknown) => {
      if (!terminalAdviceEmitted && (type === 'done' || type === 'error')) {
        const checkpoint = this.getCheckpoint(runId);
        const advice = resolveTerminalRunAdvice({
          status: type === 'error' ? 'failed' : undefined,
          result: data,
          blockedReason: checkpoint?.state.blockedReason,
          noProgressCount: checkpoint?.state.noProgressCount,
        });
        if (advice) {
          terminalAdviceEmitted = true;
          serverTrace.recordEvent('run_terminal_advice');
          this.appendAndBroadcast(
            runId,
            activeRun,
            subscribers,
            'run_terminal_advice',
            { type: 'run_terminal_advice', ...advice },
          );
        }
      }
      serverTrace.recordEvent(type);
      return serverTrace.measureSync(
        'event.append_broadcast',
        () => this.appendAndBroadcast(runId, activeRun, subscribers, type, data),
        { type }
      );
    };

    let providerWaitAttempts = 0;
    let continuationAttempt = 0;
    const run = this.store.getAgentRun(runId);
    const runMetadata = run?.metadata && typeof run.metadata === 'object'
      ? run.metadata as Record<string, unknown>
      : {};
    const modelTarget = runMetadata.modelTarget && typeof runMetadata.modelTarget === 'object'
      ? runMetadata.modelTarget as Record<string, unknown>
      : {};
    const providerModel = typeof modelTarget.resolvedModel === 'string'
      ? modelTarget.resolvedModel
      : typeof runMetadata.resolvedModel === 'string'
        ? runMetadata.resolvedModel
        : typeof run?.model === 'string'
          ? run.model
          : undefined;
    const providerName = typeof modelTarget.provider === 'string'
      ? modelTarget.provider
      : providerModel?.toLowerCase().startsWith('gemini') || providerModel?.toLowerCase().startsWith('gemini-target:')
        ? 'gemini'
        : undefined;
    const providerProfile = providerName?.toLowerCase() === 'gemini' && typeof runMetadata.providerProfile === 'string'
      ? runMetadata.providerProfile
      : undefined;
    const providerRoute = [
      providerName ? `${providerName.charAt(0).toUpperCase()}${providerName.slice(1)}` : 'Selected provider',
      providerModel ? `model ${providerModel}` : undefined,
      providerProfile ? `profile ${providerProfile}` : undefined,
    ].filter(Boolean).join(' · ');
    const configuredRetryLimit = Number(run?.metadata && typeof run.metadata === 'object'
      ? (run.metadata as Record<string, unknown>).maxProviderCooldownRetries
      : undefined);
    // Every run needs a finite automatic recovery policy. Continuous runs may
    // keep executing after a checkpoint boundary, but they must not wait on an
    // unavailable provider forever. An explicit limit is honored for both
    // bounded and continuous runs.
    const continuousRun = runMetadata.continuousRun === true;
    const maxProviderCooldownRetries = Number.isFinite(configuredRetryLimit)
      ? Math.max(0, Math.min(10, Math.floor(configuredRetryLimit)))
      : continuousRun
      ? DEFAULT_CONTINUOUS_MAX_PROVIDER_COOLDOWN_RETRIES
      : DEFAULT_MAX_PROVIDER_COOLDOWN_RETRIES;
    // Pacing and provider recovery are independent concerns. Continuous runs
    // always wait for provider availability; bounded callers can opt out.
    const waitForProviderAvailability = continuousRun || runMetadata.waitForProviderAvailability !== false;

    try {
      while (true) {
        if (this.isRunWallClockBudgetExceeded(activeRun)) {
          this.finishRunAtWallClockLimit(runId, emit, serverTrace);
          return;
        }
        try {
          const checkpoint = providerWaitAttempts > 0 || continuationAttempt > 0
            ? this.getCheckpoint(runId)
            : undefined;
          if (providerWaitAttempts > 0 && !checkpoint) {
            this.finishProviderRecoveryFailure(
              runId,
              emit,
              serverTrace,
              'PROVIDER_RETRY_CHECKPOINT_MISSING',
              'The provider became available, but no valid checkpoint exists to safely resume this run. Use Continue to restart from the last saved state.',
              providerWaitAttempts,
            );
            return;
          }
          if (checkpoint && !isCheckpointWorkspaceFresh(checkpoint)) {
            this.finishProviderRecoveryFailure(
              runId,
              emit,
              serverTrace,
              'PROVIDER_RETRY_CHECKPOINT_STALE',
              'The workspace changed while the provider was cooling down. Use Continue to review the latest files before retrying.',
              providerWaitAttempts,
            );
            return;
          }
          const result = await executor({
            runId,
            signal: controller.signal,
            emit,
            providerRetryAttempt: providerWaitAttempts,
            continuationAttempt,
            continuationStepBudget: activeRun?.executionStepWindow || DEFAULT_EXECUTION_STEP_WINDOW,
            globalStepLimit: activeRun?.globalStepLimit || resolveGlobalStepLimit(runMetadata.globalStepLimit),
            runStartedAt: activeRun?.runStartedAt || Date.now(),
            wallClockBudgetMs: activeRun?.wallClockBudgetMs || resolveRunWallClockBudgetMs(runMetadata.wallClockBudgetMs),
            maxRecoveryTransitions: activeRun?.maxRecoveryTransitions || resolveMaxRecoveryTransitions(runMetadata.maxRecoveryTransitions),
            checkpoint: checkpoint ?? undefined,
            requestUserInput: (request) => this.waitForUserInput(runId, activeRun, emit, request, controller.signal),
            consumeQueuedMessages: () => this.consumeQueuedMessages(runId),
            acknowledgeQueuedMessages: (messageIds) => { this.acknowledgeQueuedMessages(runId, messageIds); },
          });
          if (this.isRunWallClockBudgetExceeded(activeRun)) {
            this.finishRunAtWallClockLimit(runId, emit, serverTrace);
            return;
          }
          const latest = this.store.getAgentRun(runId);
           if (latest?.status === 'stopped' || latest?.status === 'interrupted' || latest?.status === 'killed' || controller.signal.aborted) {
             const lifecycleStatus = latest?.status === 'interrupted' || latest?.status === 'killed' ? latest.status : 'stopped';
             const lifecycleResult = this.normalizeLifecycleResult(result, lifecycleStatus);
             emit(lifecycleStatus, { type: lifecycleStatus, message: latest?.stopReason || `Run ${lifecycleStatus} by user.` });
             emit('done', lifecycleResult);
             this.finishRun(runId, lifecycleStatus, lifecycleResult, latest?.stopReason || `Run ${lifecycleStatus} by user.`, serverTrace.finish(), getPerformanceTrace(lifecycleResult));
          } else if (this.isMaxStepsResult(result)) {
            const continuationCheckpoint = this.getCheckpoint(runId);
            if (!continuationCheckpoint) {
              // A max-step result is only safe to roll forward when the
              // engine actually persisted the boundary. Keep the original
              // result visible if a custom executor violates that contract.
              emit('done', result);
              this.finishRun(runId, 'failed', result, this.resultErrorMessage(result), serverTrace.finish(), getPerformanceTrace(result));
              return;
            }

            continuationAttempt += 1;
            const currentStep = continuationCheckpoint.state.current_step;
            const currentRun = this.getRun(runId);
            const currentMetadata = objectMetadata(currentRun?.metadata);
            this.store.updateAgentRun({
              id: runId,
              status: 'running',
              stopReason: undefined,
              result: undefined,
              finishedAt: undefined,
              metadata: {
                ...currentMetadata,
                autonomousContinuation: {
                  count: continuationAttempt,
                  checkpointStep: currentStep,
                  updatedAt: Date.now(),
                },
              },
              updatedAt: Date.now(),
            });
            emit('progress', `Checkpoint window reached at step ${currentStep}; continuing automatically from the saved checkpoint.`);
            continue;
          } else {
            this.clearProviderWait(runId);
            emit('done', result);
            const failedResult = this.resultIndicatesFailure(result);
            this.finishRun(runId, failedResult ? 'failed' : 'completed', result, failedResult ? this.resultErrorMessage(result) : undefined, serverTrace.finish(), getPerformanceTrace(result));
          }
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const latest = this.store.getAgentRun(runId);
           if (controller.signal.aborted || latest?.status === 'stopped' || latest?.status === 'interrupted' || latest?.status === 'killed' || message.includes('RUN_CANCELLED')) {
             const lifecycleStatus = latest?.status === 'interrupted' || latest?.status === 'killed' ? latest.status : 'stopped';
             const lifecycleResult = this.normalizeLifecycleResult({ error: latest?.stopReason || `Run ${lifecycleStatus} by user.` }, lifecycleStatus);
             emit(lifecycleStatus, { type: lifecycleStatus, message: latest?.stopReason || `Run ${lifecycleStatus} by user.` });
             emit('done', lifecycleResult);
             this.finishRun(runId, lifecycleStatus, lifecycleResult, latest?.stopReason || `Run ${lifecycleStatus} by user.`, serverTrace.finish(), getPerformanceTrace(lifecycleResult));
            return;
          }

          if (this.isRecoverableProviderAvailabilityError(message)) {
            providerWaitAttempts += 1;
            const checkpoint = this.getCheckpoint(runId);
            if (!checkpoint) {
              this.finishProviderRecoveryFailure(
                runId,
                emit,
                serverTrace,
                'PROVIDER_RETRY_CHECKPOINT_MISSING',
                'The provider is temporarily unavailable, but no valid checkpoint exists to safely resume this run. Use Continue to restart from the last saved state.',
                providerWaitAttempts,
                message,
              );
              return;
            }
            if (!isCheckpointWorkspaceFresh(checkpoint)) {
              this.finishProviderRecoveryFailure(
                runId,
                emit,
                serverTrace,
                'PROVIDER_RETRY_CHECKPOINT_STALE',
                'The workspace changed while the provider was unavailable. Use Continue to review the latest files before retrying.',
                providerWaitAttempts,
                message,
              );
              return;
            }
            const isOfflineModelServer = providerName === 'local' || providerName === 'colab';
            const retryAfterMs = this.normalizeProviderWaitMs(
              this.extractProviderRetryAfterMs(message),
              providerWaitAttempts,
              isOfflineModelServer,
            );
            // A provider cooldown is part of the run's wall-clock budget. Do
            // not park a run past its durable deadline only to discover the
            // limit after the next provider attempt.
            const wallClockRemainingMs = this.remainingRunWallClockBudgetMs(activeRun);
            if (wallClockRemainingMs !== undefined && wallClockRemainingMs <= retryAfterMs) {
              this.finishRunAtWallClockLimit(runId, emit, serverTrace);
              return;
            }
            if (!waitForProviderAvailability) {
              const fastReconnectEligible = runMetadata.pacingProfile === 'fast'
                && providerWaitAttempts === 1
                && this.isFastProviderReconnectError(message);
              if (fastReconnectEligible) {
                this.store.updateAgentRun({
                  id: runId,
                  status: 'running',
                  updatedAt: Date.now(),
                });
                emit('retrying', {
                  type: 'retrying',
                  attempt: providerWaitAttempts,
                  checkpointStep: checkpoint.state.current_step,
                  message: `${providerRoute} timed out. Reconnecting once from the saved action checkpoint (fast mode; no cooldown wait).`,
                });
                continue;
              }
              const recoveryMessage = runMetadata.pacingProfile === 'fast' && providerWaitAttempts > 1
                ? `${providerRoute} remained unavailable after one fast reconnect attempt. Automatic waiting is disabled. Choose Continue to retry the same model or select another provider/model.`
                : `${providerRoute} is unavailable because the provider limit or cooldown was reached. Automatic waiting is disabled. Choose Continue to retry the same model or select another provider/model.`;
              const waitingUntil = Date.now() + retryAfterMs;
              this.finishProviderRecoveryFailure(
                runId,
                emit,
                serverTrace,
                'PROVIDER_WAIT_DISABLED',
                recoveryMessage,
                providerWaitAttempts,
                message,
                retryAfterMs,
                waitingUntil,
              );
              return;
            }
            if (providerWaitAttempts > maxProviderCooldownRetries) {
              this.finishProviderRecoveryFailure(
                runId,
                emit,
                serverTrace,
                'PROVIDER_RETRY_LIMIT',
                `${providerRoute} remained unavailable after ${providerWaitAttempts} automatic cooldown attempt${providerWaitAttempts === 1 ? '' : 's'}. Use Continue or choose another approved profile/model. Last provider error: ${message.slice(0, 800)}`,
                providerWaitAttempts,
                message,
              );
              return;
            }

            const waitingUntil = Date.now() + retryAfterMs;
            this.rememberProviderWait(runId, {
              attempt: providerWaitAttempts,
              lastError: message,
              lastFailureCategory: 'provider_availability',
              retryAfterMs,
              waitingUntil,
            });
            this.store.updateAgentRun({
              id: runId,
              status: 'waiting_for_provider',
              stopReason: undefined,
              updatedAt: Date.now(),
            });
            emit('cooldown_waiting', {
              type: 'cooldown_waiting',
              attempt: providerWaitAttempts,
              delayMs: retryAfterMs,
              waitingUntil,
              provider: providerName,
              model: providerModel,
              profileId: providerProfile,
              providerError: message.slice(0, 2_000),
              message: `${providerRoute} is temporarily unavailable. The run is paused at the saved action checkpoint; no tool action is running. It will retry the same model after the next availability check at ${this.formatProviderResumeAt(waitingUntil)} (in ${this.formatRetryAfter(retryAfterMs)}); no fallback will be used.`,
            });

            try {
              await this.waitForProviderCooldown(retryAfterMs, controller.signal);
            } catch (waitError) {
              const stoppedRun = this.store.getAgentRun(runId);
              if (controller.signal.aborted || stoppedRun?.status === 'stopped' || stoppedRun?.status === 'interrupted' || stoppedRun?.status === 'killed' || this.isRunCancellationError(waitError)) {
                const lifecycleStatus = stoppedRun?.status === 'interrupted' || stoppedRun?.status === 'killed' ? stoppedRun.status : 'stopped';
                const stoppedResult = this.normalizeLifecycleResult({ error: stoppedRun?.stopReason || `Run ${lifecycleStatus} by user.` }, lifecycleStatus);
                emit(lifecycleStatus, { type: lifecycleStatus, message: stoppedRun?.stopReason || `Run ${lifecycleStatus} by user.` });
                emit('done', stoppedResult);
                this.finishRun(runId, lifecycleStatus, stoppedResult, stoppedRun?.stopReason || `Run ${lifecycleStatus} by user.`, serverTrace.finish(), getPerformanceTrace(stoppedResult));
                return;
              }
              const waitMessage = waitError instanceof Error ? waitError.message : String(waitError);
              const waitResult = { success: false, error: waitMessage, errorCode: 'PROVIDER_COOLDOWN_WAIT_FAILED' };
              emit('execution_failed', { message: waitMessage, errorCode: 'PROVIDER_COOLDOWN_WAIT_FAILED' });
              emit('error', waitResult);
              this.finishRun(runId, 'failed', waitResult, waitMessage, serverTrace.finish());
              return;
            }

            const resumedRun = this.store.getAgentRun(runId);
            if (resumedRun?.status === 'stopped' || resumedRun?.status === 'interrupted' || resumedRun?.status === 'killed' || controller.signal.aborted) {
              const lifecycleStatus = resumedRun?.status === 'interrupted' || resumedRun?.status === 'killed' ? resumedRun.status : 'stopped';
              const stoppedResult = this.normalizeLifecycleResult({ error: resumedRun?.stopReason || `Run ${lifecycleStatus} by user.` }, lifecycleStatus);
              emit(lifecycleStatus, { type: lifecycleStatus, message: resumedRun?.stopReason || `Run ${lifecycleStatus} by user.` });
              emit('done', stoppedResult);
              this.finishRun(runId, lifecycleStatus, stoppedResult, resumedRun?.stopReason || `Run ${lifecycleStatus} by user.`, serverTrace.finish(), getPerformanceTrace(stoppedResult));
              return;
            }

            this.store.updateAgentRun({
              id: runId,
              status: 'running',
              updatedAt: Date.now(),
            });
            emit('retrying', {
              type: 'retrying',
              attempt: providerWaitAttempts,
              checkpointStep: checkpoint.state.current_step,
              message: 'Provider cooldown ended. Resuming from the saved action checkpoint.',
            });
            continue;
          }

          const errorPayload = { error: message };
          emit('execution_failed', { message, errorCode: 'EXECUTION_FAILED' });
          emit('error', errorPayload);
          this.finishRun(runId, 'failed', errorPayload, message, serverTrace.finish());
          return;
        }
      }
    } finally {
      this.activeRuns.delete(runId);
      for (const subscriber of subscribers) subscriber.end();
      subscribers.clear();
    }
  }

  private appendAndBroadcast(
    runId: string,
    activeRun: ActiveRun | undefined,
    subscribers: Set<Subscriber>,
    type: string,
    data: unknown
  ): ServerRunEvent {
    const current = this.store.getAgentRun(runId);
    let seq: number;
    if (activeRun) {
      seq = activeRun.lastEventSeq + 1;
    } else {
      seq = (current?.lastEventSeq || 0) + 1;
    }
    let eventData = data;
    let priorEvents: HarnessEventEnvelope[] = [];
    let checkpointForProjection: ReactCheckpoint | undefined;
    if (type === 'checkpoint' && validateReactCheckpoint(data)) {
      priorEvents = this.store.listAgentRunEvents(runId).map((stored) => normalizeHarnessEvent(stored.event, {
        runId: stored.runId,
        seq: stored.seq,
        type: stored.eventType,
        timestamp: stored.createdAt,
      }));
      const previousCheckpoint = current?.metadata && typeof current.metadata === 'object'
        ? (current.metadata as Record<string, unknown>).checkpoint
        : undefined;
      const decorated = attachReactCheckpointHandoff(
        data,
        createReactCheckpointHandoff(
          runId,
          seq,
          data,
          priorEvents,
          validateReactCheckpoint(previousCheckpoint) ? previousCheckpoint : undefined,
        ),
      );
      eventData = decorated;
      checkpointForProjection = decorated;
    }
    const event = createHarnessEvent({
      runId,
      sessionId: current?.threadId || runId,
      seq,
      type,
      data: eventData,
      timestamp: Date.now(),
    });
    let projection: AgentRunEventProjection | undefined;
    if (type === 'checkpoint' && checkpointForProjection) {
      const metadata = current?.metadata && typeof current.metadata === 'object' ? current.metadata as Record<string, unknown> : {};
      const continuationQuality = isContinuationHandoff(checkpointForProjection.state.continuationHandoff)
        ? measureContinuationQuality(checkpointForProjection.state.continuationHandoff, checkpointForProjection.state.steps)
        : undefined;
      projection = {
        metadata: {
          ...metadata,
          checkpoint: checkpointForProjection,
          continuationPreview: summarizeContinuationState(checkpointForProjection.state),
          ...(continuationQuality ? { continuationQuality } : {}),
          uncertainToolCalls: checkpointForProjection.state.uncertainToolCalls || [],
          efficiencyTelemetry: {
            ...(metadata.efficiencyTelemetry && typeof metadata.efficiencyTelemetry === 'object' ? metadata.efficiencyTelemetry as Record<string, unknown> : {}),
            ...this.summarizeEfficiencyTelemetry(checkpointForProjection),
          },
        },
        contextSnapshot: createReactContextSnapshot(runId, checkpointForProjection, seq),
      };
    }
    const successfulVerification = type === 'verification_result' && objectMetadata(data).success === true;
    if (type === 'file_changed' || successfulVerification) {
      const priorMetadata = projection?.metadata || objectMetadata(current?.metadata);
      projection = {
        ...(projection || {}),
        metadata: {
          ...priorMetadata,
          lastMeaningfulProgressAt: event.timestamp,
          ...(type === 'file_changed' ? { lastWorkspaceChangeAt: event.timestamp } : {}),
          ...(successfulVerification ? { lastSuccessfulVerificationAt: event.timestamp } : {}),
        },
      };
    }
    this.store.appendAgentRunEvent({
      runId,
      seq,
      eventType: type,
      event,
      createdAt: event.timestamp,
    }, projection);
    if (activeRun) activeRun.lastEventSeq = seq;
    if (type === 'model_target_resolved' && data && typeof data === 'object') {
      const target = data as Record<string, unknown>;
      if (typeof target.requestedTarget === 'string' && typeof target.provider === 'string' && typeof target.resolvedModel === 'string') {
        this.recordModelTargetTransition(runId, {
          requestedTarget: target.requestedTarget,
          provider: target.provider,
          resolvedModel: target.resolvedModel,
          route: target.route === 'recovery' || target.route === 'fallback' ? target.route : 'primary',
          ...(typeof target.profileId === 'string' ? { profileId: target.profileId } : {}),
          ...(typeof target.targetId === 'string' ? { targetId: target.targetId } : {}),
          ...(typeof target.contextWindow === 'number' && Number.isFinite(target.contextWindow) && target.contextWindow > 0
            ? { contextWindow: target.contextWindow }
            : {}),
          ...(typeof target.reason === 'string' ? { reason: target.reason } : {}),
        });
      }
    }
    if (type === 'model_response') this.clearProviderWait(runId);
    for (const subscriber of subscribers) subscriber.write(event);
    return event;
  }

  private recordUncertainToolOutcome(runId: string, outcome: UnknownToolOutcome): void {
    const checkpoint = this.getCheckpoint(runId);
    if (!checkpoint) return;
    const state = structuredClone(checkpoint.state);
    const prior = state.uncertainToolCalls || [];
    if (prior.some((item) => item.toolCallId === outcome.toolCallId)) return;
    state.uncertainToolCalls = [...prior, outcome].slice(-20);
    state.steps = [
      ...state.steps,
      {
        thought: `The ${outcome.tool} tool call has an unknown outcome. Verify its effect before retrying it.`,
        action: 'ToolOutcomeUnknown',
        action_input: {
          tool: outcome.tool,
          toolCallId: outcome.toolCallId,
          ...(outcome.input ? { input: structuredClone(outcome.input) } : {}),
        },
        observation: JSON.stringify({
          success: false,
          status: 'outcome_unknown',
          tool: outcome.tool,
          toolCallId: outcome.toolCallId,
          reason: outcome.reason,
          retryPolicy: outcome.retryPolicy,
        }),
        is_done: false,
        pollenCost: 0,
        startTime: outcome.repairedAt,
        endTime: outcome.repairedAt,
        durationMs: 0,
      },
    ].slice(-200);
    state.codingState = 'blocked';
    state.blockedReason = `The ${outcome.tool} tool call stopped before its effect was known. Verify the workspace or command result before retrying it.`;
    const updatedCheckpoint = createReactCheckpoint(state);
    const active = this.activeRuns.get(runId);
    this.appendAndBroadcast(runId, active, active?.subscribers || new Set<Subscriber>(), 'checkpoint', updatedCheckpoint);
  }

  private summarizeEfficiencyTelemetry(checkpoint: ReactCheckpoint): Record<string, unknown> {
    const successful = (step: any) => /"success"\s*:\s*true/i.test(String(step?.observation || ''));
    const reads = checkpoint.state.steps.filter((step) => step.action === 'Read' && successful(step));
    const readPaths = reads.map((step) => String(step.action_input?.file_path || step.action_input?.path || '')).filter(Boolean);
    const repeatedReads = readPaths.length - new Set(readPaths).size;
    const lastSuccessful = [...checkpoint.state.steps].reverse().find(successful);
    const mutated = checkpoint.state.steps.some((step) => successful(step) && (step.action === 'Write' || step.action === 'Edit'));
    const targets = checkpoint.state.taskAnalysis?.contract?.candidateFiles || [];
    const allKnownTargetsInspected = targets.length > 0 && targets.every((path) => readPaths.includes(path));
    return {
      logicalLlmRequests: checkpoint.state.llmUsage?.requestCount || 0,
      repeatedReads,
      successfulReads: readPaths.length,
      lastSuccessfulAction: lastSuccessful ? { action: lastSuccessful.action, input: lastSuccessful.action_input } : undefined,
      checkpointStep: checkpoint.state.current_step,
      timeToFirstMutationMs: mutated ? Math.max(0, checkpoint.createdAt - (checkpoint.state.codingStateStartedAt || checkpoint.createdAt)) : undefined,
      inspectedAllKnownTargetsWithoutMutation: allKnownTargetsInspected && !mutated,
    };
  }

  private finishRun(
    runId: string,
    status: StoredAgentRunStatus,
    result: unknown,
    stopReason?: string,
    serverTrace?: PerformanceTraceSummary,
    engineTrace?: PerformanceTraceSummary
  ): void {
    const current = this.store.getAgentRun(runId);
    const currentMetadata = current?.metadata && typeof current.metadata === 'object'
      ? current.metadata as Record<string, unknown>
      : {};
    const checkpoint = this.getCheckpoint(runId);
    const quality = checkpoint ? this.calculateModelQuality(checkpoint) : undefined;
    this.store.updateAgentRun({
      id: runId,
      status,
      result,
      stopReason,
      metadata: {
        ...currentMetadata,
        lifecycle: {
          status,
          ...(result && typeof result === 'object' && typeof (result as Record<string, unknown>).outcome === 'string'
            ? { outcome: (result as Record<string, unknown>).outcome }
            : {}),
          recordedAt: Date.now(),
        },
        ...(quality ? { modelQuality: quality } : {}),
        performanceTrace: {
          server: serverTrace,
          engine: engineTrace,
        },
      },
      finishedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  private resultIndicatesFailure(result: unknown): boolean {
    return resultIndicatesRunFailure(result);
  }

  private isMaxStepsResult(result: unknown): boolean {
    return isMaxStepsExceededResult(result);
  }

  private normalizeExecutionStepWindow(value: unknown, globalStepLimit = CONTINUOUS_RUN_STEP_LIMIT): number {
    return resolveStepWindow(value, globalStepLimit, DEFAULT_EXECUTION_STEP_WINDOW);
  }

  private remainingRunWallClockBudgetMs(activeRun?: ActiveRun, now = Date.now()): number | undefined {
    return getEngineRemainingRunWallClockBudgetMs(activeRun, now);
  }

  private isRunWallClockBudgetExceeded(activeRun?: ActiveRun, now = Date.now()): boolean {
    return isEngineRunWallClockBudgetExceeded(activeRun, now);
  }

  private finishRunAtWallClockLimit(
    runId: string,
    emit: (type: string, data: unknown) => ServerRunEvent,
    serverTrace: PerformanceTrace,
  ): void {
    const error = 'Run wall-clock budget reached. Progress was saved at a checkpoint; review it and continue when ready.';
    const result = {
      success: false,
      error,
      errorCode: 'RUN_WALL_CLOCK_LIMIT_EXCEEDED' as const,
      recoverable: true,
      suggestedNextAction: 'Review the saved checkpoint before continuing the run.',
    };
    emit('execution_failed', { message: error, errorCode: result.errorCode });
    emit('error', result);
    emit('done', result);
    this.finishRun(runId, 'failed', result, error, serverTrace.finish(), getPerformanceTrace(result));
  }

  private resultErrorMessage(result: unknown): string | undefined {
    if (!result || typeof result !== 'object') return undefined;
    const error = (result as Record<string, unknown>).error;
    return typeof error === 'string' ? error : undefined;
  }

  private isRecoverableProviderAvailabilityError(message: string): boolean {
    return isRecoverableRunProviderAvailabilityError(message);
  }

  private isFastProviderReconnectError(message: string): boolean {
    if (/(?:billing|required|quota\s+(?:is\s+)?(?:exhausted|exceeded|reached)|insufficient\s+balance)/i.test(message)) {
      return false;
    }
    return /\b(?:timed out|timeout|deadline|429)\b|rate[-_\s]?limit|throttled|cooldown/i.test(message);
  }

  private normalizeLifecycleResult(result: unknown, status: 'stopped' | 'interrupted' | 'killed'): unknown {
    return normalizeRunLifecycleResult(result, status);
  }

  private waitForUserInput(
    runId: string,
    activeRun: ActiveRun | undefined,
    emit: (type: string, data: unknown) => ServerRunEvent,
    input: UserInputRequest,
    signal: AbortSignal
  ): Promise<UserInputResponse> {
    if (!activeRun) return Promise.reject(new Error('Run is not active.'));
    if (activeRun.pendingUserInput) return Promise.reject(new Error('Run already has a pending user question.'));
    const question = String(input.question || '').trim().slice(0, 4_000);
    if (!question) return Promise.reject(new Error('A non-empty user question is required.'));
    const options = Array.isArray(input.options)
      ? [...new Set(input.options.map((option) => String(option).trim()).filter(Boolean))].slice(0, 8)
      : [];
    const request: PendingUserInputRequest = {
      requestId: input.requestId || createId(),
      question,
      options,
      allowFreeform: input.allowFreeform !== false || options.length === 0,
      ...(input.context ? { context: String(input.context).trim().slice(0, 2_000) } : {}),
      createdAt: Date.now(),
    };

    return new Promise<UserInputResponse>((resolve) => {
      const finish = (response: UserInputResponse) => {
        signal.removeEventListener('abort', onAbort);
        resolve(response);
      };
      const onAbort = () => {
        if (activeRun.pendingUserInput?.request.requestId === request.requestId) {
          activeRun.pendingUserInput = undefined;
        }
        finish({ requestId: request.requestId, cancelled: true });
      };
      activeRun.pendingUserInput = { request, resolve: finish };
      const run = this.getRun(runId);
      const metadata = run?.metadata && typeof run.metadata === 'object' ? run.metadata as Record<string, unknown> : {};
      this.store.updateAgentRun({
        id: runId,
        status: 'waiting_for_user',
        metadata: { ...metadata, pendingUserInput: request },
        updatedAt: Date.now(),
      });
      emit('user_input_required', { type: 'user_input_required', ...request });
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private calculateModelQuality(checkpoint: ReactCheckpoint): ReturnType<typeof calculateModelQualityMetrics> {
    const steps = checkpoint.state.steps || [];
    const successful = (step: ReactCheckpoint['state']['steps'][number]) => {
      try {
        const parsed = JSON.parse(step.observation || '{}') as { success?: unknown; output?: unknown; skipped?: unknown; verificationUnavailable?: unknown };
        return parsed.success !== false && parsed.skipped !== true && parsed.verificationUnavailable !== true;
      } catch {
        return !/\b(error|failed|cancelled|unavailable|skipped)\b/i.test(step.observation || '');
      }
    };
    const usefulIndex = steps.findIndex((step) => successful(step) && ['Read', 'DocumentRead', 'Glob', 'Grep', 'WorkspaceChanges', 'Write', 'Edit', 'Command', 'Bash'].includes(step.action));
    const verifications = steps.filter((step) => step.action === 'Command' && ['verify', 'test', 'build', 'typecheck', 'lint'].includes(String(step.action_input?.operation || '').toLowerCase()));
    const passedVerifications = verifications.filter((step) => successful(step) && /"output"\s*:\s*"[^"\n]+/i.test(step.observation || '')).length;
    return calculateModelQualityMetrics({
      firstUsefulActionStep: usefulIndex >= 0 ? usefulIndex + 1 : undefined,
      successfulMutation: steps.some((step) => successful(step) && (step.action === 'Write' || step.action === 'Edit')),
      verificationPassed: passedVerifications,
      verificationTotal: verifications.length,
      recoveryCount: checkpoint.state.recoveryCount || 0,
    });
  }

  private isRunCancellationError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    return (error as Record<string, unknown>).code === 'RUN_CANCELLED'
      || (error as Record<string, unknown>).name === 'RunCancellationError';
  }

  private extractProviderRetryAfterMs(message: string): number | undefined {
    return extractEngineProviderRetryAfterMs(message);
  }

  private normalizeProviderWaitMs(retryAfterMs: number | undefined, attempt: number, offlineModelServer = false): number {
    return normalizeEngineProviderWaitMs(retryAfterMs, attempt, offlineModelServer);
  }

  private formatRetryAfter(retryAfterMs: number): string {
    return formatEngineRetryAfterMs(retryAfterMs);
  }

  private formatProviderResumeAt(timestamp: number): string {
    return formatEngineProviderResumeAt(timestamp);
  }

  private waitForProviderCooldown(delayMs: number, signal: AbortSignal): Promise<void> {
    if (delayMs <= 0) return Promise.resolve();
    if (signal.aborted) return Promise.reject(signal.reason || new Error('RUN_CANCELLED'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason || new Error('RUN_CANCELLED'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private rememberProviderWait(
    runId: string,
    wait: { attempt: number; lastError: string; lastFailureCategory: string; retryAfterMs: number; waitingUntil: number },
  ): void {
    const current = this.store.getAgentRun(runId);
    const currentMetadata = current?.metadata && typeof current.metadata === 'object'
      ? current.metadata as Record<string, unknown>
      : {};
    this.store.updateAgentRun({
      id: runId,
      metadata: {
        ...currentMetadata,
        efficiencyTelemetry: {
          ...(currentMetadata.efficiencyTelemetry && typeof currentMetadata.efficiencyTelemetry === 'object'
            ? currentMetadata.efficiencyTelemetry as Record<string, unknown>
            : {}),
          providerAttemptFailures: wait.attempt,
          cooldownMs: Number((currentMetadata.efficiencyTelemetry as any)?.cooldownMs || 0) + wait.retryAfterMs,
        },
        providerWait: {
          ...wait,
          lastError: wait.lastError.slice(0, 2000),
        },
      },
      updatedAt: Date.now(),
    });
  }

  private clearProviderWait(runId: string): void {
    const current = this.store.getAgentRun(runId);
    const metadata = current?.metadata && typeof current.metadata === 'object'
      ? current.metadata as Record<string, unknown>
      : {};
    if (!('providerWait' in metadata)) return;
    const { providerWait: _providerWait, ...retainedMetadata } = metadata;
    this.store.updateAgentRun({ id: runId, metadata: retainedMetadata, updatedAt: Date.now() });
  }

  private finishProviderRecoveryFailure(
    runId: string,
    emit: (type: string, data: unknown) => ServerRunEvent,
    serverTrace: PerformanceTrace,
    errorCode: 'MODEL_FALLBACK_CONFIRMATION_REQUIRED' | 'PROVIDER_WAIT_DISABLED' | 'PROVIDER_RETRY_LIMIT' | 'PROVIDER_RETRY_CHECKPOINT_MISSING' | 'PROVIDER_RETRY_CHECKPOINT_STALE' | 'PROVIDER_COOLDOWN_TOO_LONG',
    error: string,
    attempt: number,
    lastError?: string,
    retryAfterMs?: number,
    waitingUntil?: number,
  ): void {
    const current = this.store.getAgentRun(runId);
    const metadata = current?.metadata && typeof current.metadata === 'object'
      ? current.metadata as Record<string, unknown>
      : {};
    this.store.updateAgentRun({
      id: runId,
      metadata: {
        ...metadata,
        providerWait: {
          attempt,
          lastError: (lastError || error).slice(0, 2000),
          lastFailureCategory: 'provider_availability',
          terminalReason: errorCode,
          ...(typeof retryAfterMs === 'number' ? { retryAfterMs } : {}),
          ...(typeof waitingUntil === 'number' ? { waitingUntil } : {}),
        },
      },
      updatedAt: Date.now(),
    });
    const result = { success: false, error, errorCode, recoverable: true };
    emit('execution_failed', { message: error, errorCode });
    emit('error', result);
    emit('done', result);
    this.finishRun(runId, 'failed', result, error, serverTrace.finish(), getPerformanceTrace(result));
  }

  private toServerEvent(event: StoredAgentRunEvent): ServerRunEvent {
    return normalizeHarnessEvent(event.event, {
      runId: event.runId,
      seq: event.seq,
      type: event.eventType,
      timestamp: event.createdAt,
    });
  }
}

let sharedRunManager: ServerRunManager | null = null;

export function getServerRunManager(): ServerRunManager {
  if (!sharedRunManager) sharedRunManager = new ServerRunManager();
  return sharedRunManager;
}
