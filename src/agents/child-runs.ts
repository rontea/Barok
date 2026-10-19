/**
 * Durable child-run and workflow contracts.
 *
 * The runtime may use a fresh ReAct engine, a forked checkpoint, an in-process
 * adapter, or an external/ACP adapter. Parents depend only on these small
 * contracts and on the report/event protocol, not on a particular provider.
 */

import { randomUUID } from 'crypto';
import type { PermissionMode } from '../tools/permissionPolicy.js';
import { CHILD_RUN_PROTOCOL_VERSION } from '@barok/engine';
import type { ChildRunReport, ChildRunReportCheck, ChildRunSubtaskContract } from '@barok/engine';

export { CHILD_RUN_PROTOCOL_VERSION };
export type { ChildRunReport, ChildRunReportCheck, ChildRunSubtaskContract };

export type ChildRunProviderKind = 'fresh' | 'forked' | 'in-process' | 'external' | 'acp';
export type ChildRunStatus =
  | 'created'
  | 'running'
  | 'waiting_for_user'
  | 'waiting_for_provider'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'
  | 'timed_out';

export interface ChildRunCapabilities {
  pack?: string;
  allowedTools?: string[];
  deniedTools?: string[];
  approvalMode?: PermissionMode;
  approvalScopes?: string[];
}

/** Non-secret route identity used to keep fresh child runs on the parent's resolved model. */
export interface ChildRunModelTarget {
  requestedTarget: string;
  provider: string;
  resolvedModel: string;
  profileId?: string;
  targetId?: string;
}

export interface ChildRunBudget {
  maxDepth: number;
  maxSteps: number;
  maxLlmRequests: number;
  maxToolCalls: number;
  maxCost: number;
  timeoutMs: number;
}

export interface ChildRunRequest {
  task: string;
  role: string;
  provider?: ChildRunProviderKind;
  model?: string;
  modelTarget?: ChildRunModelTarget;
  modelContextWindow?: number;
  contract?: ChildRunSubtaskContract;
  workspace?: string;
  capabilities?: ChildRunCapabilities;
  budget?: Partial<ChildRunBudget>;
  depth?: number;
  parentSessionId?: string;
  childId?: string;
}

export interface ChildRunRecord {
  protocolVersion: typeof CHILD_RUN_PROTOCOL_VERSION;
  childId: string;
  parentRunId: string;
  parentSessionId?: string;
  lineage: string[];
  provider: ChildRunProviderKind;
  model?: string;
  modelTarget?: ChildRunModelTarget;
  modelContextWindow?: number;
  contract?: ChildRunSubtaskContract;
  role: string;
  depth: number;
  workspace?: string;
  capabilities: ChildRunCapabilities;
  budget: ChildRunBudget;
  status: ChildRunStatus;
  createdAt: number;
  startedAt?: number;
  updatedAt: number;
  finishedAt?: number;
  terminalReason?: string;
  report?: ChildRunReport;
}

export interface ChildRunProviderContext {
  parentSignal: AbortSignal;
  childSignal: AbortSignal;
  emit: (type: string, data: unknown) => void;
}

export interface ChildRunHandle {
  childId: string;
  wait(): Promise<ChildRunReport>;
  followUp?(message: string): Promise<void>;
  interrupt?(reason?: string): Promise<void>;
  dispose?(): Promise<void>;
}

/** Provider seam used by workflow callers and future external/ACP adapters. */
export interface ChildRunProvider {
  readonly kind: ChildRunProviderKind;
  launch(request: ChildRunRequest, context: ChildRunProviderContext): Promise<ChildRunHandle>;
}

const DEFAULT_CHILD_BUDGET: ChildRunBudget = {
  maxDepth: 3,
  maxSteps: 20,
  maxLlmRequests: 20,
  maxToolCalls: 120,
  maxCost: 25,
  timeoutMs: 5 * 60_000,
};

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(Number(value))) return fallback;
  return Math.max(min, Math.min(max, Math.floor(Number(value))));
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(Number(value))) return fallback;
  return Math.max(min, Math.min(max, Number(value)));
}

export function normalizeChildBudget(
  requested: Partial<ChildRunBudget> | undefined,
  parent?: Partial<ChildRunBudget>,
): ChildRunBudget {
  const upper = {
    maxDepth: boundedInteger(parent?.maxDepth, DEFAULT_CHILD_BUDGET.maxDepth, 1, 20),
    maxSteps: boundedInteger(parent?.maxSteps, 1000, 1, 1000),
    maxLlmRequests: boundedInteger(parent?.maxLlmRequests, 1000, 1, 1000),
    maxToolCalls: boundedInteger(parent?.maxToolCalls, 10_000, 1, 10_000),
    maxCost: boundedNumber(parent?.maxCost, 1_000_000, 0, 1_000_000),
    timeoutMs: boundedInteger(parent?.timeoutMs, 60 * 60_000, 1_000, 60 * 60_000),
  };
  return {
    maxDepth: boundedInteger(requested?.maxDepth, Math.min(DEFAULT_CHILD_BUDGET.maxDepth, upper.maxDepth), 1, upper.maxDepth),
    maxSteps: boundedInteger(requested?.maxSteps, Math.min(DEFAULT_CHILD_BUDGET.maxSteps, upper.maxSteps), 1, upper.maxSteps),
    maxLlmRequests: boundedInteger(requested?.maxLlmRequests, Math.min(DEFAULT_CHILD_BUDGET.maxLlmRequests, upper.maxLlmRequests), 1, upper.maxLlmRequests),
    maxToolCalls: boundedInteger(requested?.maxToolCalls, Math.min(DEFAULT_CHILD_BUDGET.maxToolCalls, upper.maxToolCalls), 1, upper.maxToolCalls),
    maxCost: boundedNumber(requested?.maxCost, Math.min(DEFAULT_CHILD_BUDGET.maxCost, upper.maxCost), 0, upper.maxCost),
    timeoutMs: boundedInteger(requested?.timeoutMs, Math.min(DEFAULT_CHILD_BUDGET.timeoutMs, upper.timeoutMs), 1_000, upper.timeoutMs),
  };
}

function uniqueStrings(values: unknown, limit = 100): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim().slice(0, 500)))].slice(0, limit);
}

function extractObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function successfulObservation(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed.success === true || parsed.status === 'passed';
  } catch {
    return /\b(?:passed|success(?:ful)?)\b/i.test(value) && !/\b(?:failed|error)\b/i.test(value);
  }
}

/** Build a report from a normal ReAct result without treating prose as proof. */
export function normalizeChildReport(
  childId: string,
  result: unknown,
  terminalReason?: string,
  now = Date.now(),
): ChildRunReport {
  const object = extractObject(result);
  const steps = Array.isArray(object.steps) ? object.steps : [];
  const changedFiles = uniqueStrings([
    ...(Array.isArray(object.changedFiles) ? object.changedFiles : []),
    ...(Array.isArray(object.filesChanged) ? object.filesChanged : []),
    ...steps.flatMap((step) => {
      const item = extractObject(step);
      if ((item.action !== 'Write' && item.action !== 'Edit') || !successfulObservation(item.observation)) return [];
      const input = extractObject(item.action_input);
      return [input.file_path || input.path];
    }),
  ]);
  const checks: ChildRunReportCheck[] = [];
  for (const raw of Array.isArray(object.checks) ? object.checks : []) {
    const check = extractObject(raw);
    const status = check.status === 'passed' || check.status === 'failed' || check.status === 'skipped' || check.status === 'unknown'
      ? check.status
      : 'unknown';
    if (typeof check.name === 'string' && check.name.trim()) {
      checks.push({ name: check.name.trim().slice(0, 200), status, ...(typeof check.output === 'string' ? { output: check.output.slice(0, 2_000) } : {}) });
    }
  }
  for (const raw of steps) {
    const step = extractObject(raw);
    const action = typeof step.action === 'string' ? step.action : '';
    if (!/verif|test|check|build|lint/i.test(action) || typeof step.observation !== 'string') continue;
    checks.push({
      name: action,
      status: successfulObservation(step.observation) ? 'passed' : 'failed',
      output: step.observation.slice(0, 2_000),
    });
  }
  const blockers = uniqueStrings([
    ...(Array.isArray(object.blockers) ? object.blockers : []),
    ...(typeof object.error === 'string' ? [object.error] : []),
  ]);
  const evidenceRefs = uniqueStrings([
    ...(Array.isArray(object.evidenceRefs) ? object.evidenceRefs : []),
    ...(Array.isArray(object.evidenceIds) ? object.evidenceIds : []),
    ...steps.flatMap((step) => {
      const item = extractObject(step);
      const evidence = extractObject(item.evidence);
      return [evidence.id, ...(Array.isArray(evidence.ids) ? evidence.ids : [])];
    }),
  ]);
  return {
    protocolVersion: CHILD_RUN_PROTOCOL_VERSION,
    childId,
    success: object.success === true && !terminalReason,
    ...(Object.prototype.hasOwnProperty.call(object, 'finalAnswer') ? { result: object.finalAnswer } : { result }),
    changedFiles,
    checks: checks.slice(-100),
    blockers,
    evidenceRefs,
    ...(terminalReason ? { terminalReason: terminalReason.slice(0, 2_000) } : {}),
    createdAt: now,
  };
}

export function createChildRunRecord(
  request: ChildRunRequest,
  parent: { runId: string; sessionId?: string; lineage?: string[]; budget?: Partial<ChildRunBudget> },
  now = Date.now(),
): ChildRunRecord {
  const childId = request.childId || randomUUID();
  const depth = boundedInteger(request.depth, (parent.lineage?.length || 0) + 1, 1, 20);
  const lineage = [...new Set([...(parent.lineage || [parent.runId]), parent.runId])];
  return {
    protocolVersion: CHILD_RUN_PROTOCOL_VERSION,
    childId,
    parentRunId: parent.runId,
    ...(request.parentSessionId || parent.sessionId ? { parentSessionId: request.parentSessionId || parent.sessionId } : {}),
    lineage,
    provider: request.provider || 'fresh',
    ...(request.model ? { model: request.model } : {}),
    ...(request.modelTarget ? { modelTarget: { ...request.modelTarget } } : {}),
    ...(Number.isFinite(request.modelContextWindow) && (request.modelContextWindow || 0) > 0
      ? { modelContextWindow: Math.floor(request.modelContextWindow!) }
      : {}),
    ...(request.contract
      ? {
          contract: {
            id: request.contract.id.trim().slice(0, 80),
            objective: request.contract.objective.trim().slice(0, 1_600),
            fileScope: uniqueStrings(request.contract.fileScope).slice(0, 48),
            acceptanceChecks: uniqueStrings(request.contract.acceptanceChecks).slice(0, 8),
            dependencies: uniqueStrings(request.contract.dependencies).slice(0, 8),
            budget: {
              estimatedPromptTokens: boundedInteger(request.contract.budget.estimatedPromptTokens, 0, 0, 10_000_000),
              maxPromptTokens: boundedInteger(request.contract.budget.maxPromptTokens, 0, 0, 10_000_000),
              reservedOutputTokens: boundedInteger(request.contract.budget.reservedOutputTokens, 0, 0, 10_000_000),
              systemToolReserveTokens: boundedInteger(request.contract.budget.systemToolReserveTokens, 0, 0, 10_000_000),
              dependencyHandoffReserveTokens: boundedInteger(request.contract.budget.dependencyHandoffReserveTokens, 0, 0, 10_000_000),
              maxSteps: boundedInteger(request.contract.budget.maxSteps, 1, 1, 1_000),
              maxLlmRequests: boundedInteger(request.contract.budget.maxLlmRequests, 1, 1, 1_000),
              maxToolCalls: boundedInteger(request.contract.budget.maxToolCalls, 1, 1, 10_000),
              maxCost: boundedNumber(request.contract.budget.maxCost, 0, 0, 1_000_000),
              timeoutMs: boundedInteger(request.contract.budget.timeoutMs, 1_000, 1_000, 60 * 60_000),
            },
          },
        }
      : {}),
    role: request.role.trim().slice(0, 120),
    depth,
    ...(request.workspace ? { workspace: request.workspace } : {}),
    capabilities: {
      ...(request.capabilities?.pack ? { pack: request.capabilities.pack } : {}),
      ...(request.capabilities?.allowedTools ? { allowedTools: uniqueStrings(request.capabilities.allowedTools) } : {}),
      ...(request.capabilities?.deniedTools ? { deniedTools: uniqueStrings(request.capabilities.deniedTools) } : {}),
      ...(request.capabilities?.approvalMode ? { approvalMode: request.capabilities.approvalMode } : {}),
      ...(request.capabilities?.approvalScopes ? { approvalScopes: uniqueStrings(request.capabilities.approvalScopes) } : {}),
    },
    budget: normalizeChildBudget(request.budget, parent.budget),
    status: 'created',
    createdAt: now,
    updatedAt: now,
  };
}

export interface WorkflowStep {
  id: string;
  child: ChildRunRequest;
  dependencies?: string[];
}

export interface WorkflowPlan {
  id: string;
  steps: WorkflowStep[];
  maxConcurrency?: number;
}

export interface WorkflowStepResult {
  stepId: string;
  status: 'completed' | 'failed' | 'blocked' | 'cancelled';
  report?: ChildRunReport;
  error?: string;
}

export interface WorkflowRunResult {
  workflowId: string;
  status: 'completed' | 'failed' | 'cancelled';
  steps: WorkflowStepResult[];
}

export interface WorkflowRunnerOptions {
  maxConcurrency?: number;
  maxSteps?: number;
  signal?: AbortSignal;
  onEvent?: (event: { type: string; workflowId: string; stepId?: string; data?: unknown }) => void;
}

export type WorkflowStepExecutor = (step: WorkflowStep, signal: AbortSignal) => Promise<ChildRunReport>;

/**
 * Bounded dependency runner for model-authored plans. It runs only validated
 * data and callbacks; it never evaluates model-authored code. The default is
 * in-process. A worker-thread adapter can be added when host-loop isolation is
 * needed, but worker threads are not a security boundary.
 */
export class BoundedWorkflowRunner {
  private readonly options: Required<Omit<WorkflowRunnerOptions, 'signal' | 'onEvent'>> & Pick<WorkflowRunnerOptions, 'signal' | 'onEvent'>;

  constructor(options: WorkflowRunnerOptions = {}) {
    this.options = {
      maxConcurrency: boundedInteger(options.maxConcurrency, 2, 1, 32),
      maxSteps: boundedInteger(options.maxSteps, 32, 1, 1000),
      signal: options.signal,
      onEvent: options.onEvent,
    };
  }

  async run(plan: WorkflowPlan, execute: WorkflowStepExecutor): Promise<WorkflowRunResult> {
    if (!plan || typeof plan.id !== 'string' || !plan.id.trim()) throw new Error('A workflow ID is required.');
    if (!Array.isArray(plan.steps) || plan.steps.length === 0) throw new Error('A workflow must contain at least one step.');
    if (plan.steps.length > this.options.maxSteps) throw new Error(`Workflow exceeds the ${this.options.maxSteps}-step limit.`);
    const byId = new Map<string, WorkflowStep>();
    for (const step of plan.steps) {
      if (!step.id.trim() || byId.has(step.id)) throw new Error(`Workflow step IDs must be unique: ${step.id}`);
      byId.set(step.id, { ...step, dependencies: [...new Set(step.dependencies || [])] });
    }
    for (const step of byId.values()) {
      for (const dependency of step.dependencies || []) {
        if (!byId.has(dependency)) throw new Error(`Workflow step ${step.id} depends on unknown step ${dependency}.`);
      }
    }
    this.assertAcyclic([...byId.values()]);

    const results = new Map<string, WorkflowStepResult>();
    const pending = new Set(byId.keys());
    const emit = (type: string, stepId?: string, data?: unknown) => this.options.onEvent?.({ type, workflowId: plan.id, ...(stepId ? { stepId } : {}), data });
    while (pending.size > 0) {
      if (this.options.signal?.aborted) {
        for (const stepId of pending) results.set(stepId, { stepId, status: 'cancelled', error: 'Workflow cancelled.' });
        return { workflowId: plan.id, status: 'cancelled', steps: plan.steps.map((step) => results.get(step.id) || { stepId: step.id, status: 'cancelled' }) };
      }
      const blocked = [...pending].filter((stepId) => (byId.get(stepId)?.dependencies || []).some((dependency) => {
        const dependencyResult = results.get(dependency);
        return dependencyResult?.status === 'failed' || dependencyResult?.status === 'blocked' || dependencyResult?.status === 'cancelled';
      }));
      for (const stepId of blocked) {
        pending.delete(stepId);
        results.set(stepId, { stepId, status: 'blocked', error: 'A dependency did not complete successfully.' });
        emit('workflow_step_blocked', stepId);
      }
      const ready = [...pending].filter((stepId) => (byId.get(stepId)?.dependencies || []).every((dependency) => results.get(dependency)?.status === 'completed'));
      if (ready.length === 0) {
        if (pending.size > 0) throw new Error('Workflow cannot make progress after dependency validation.');
        break;
      }
      const batch = ready.slice(0, this.options.maxConcurrency);
      await Promise.all(batch.map(async (stepId) => {
        const step = byId.get(stepId)!;
        pending.delete(stepId);
        emit('workflow_step_started', stepId);
        try {
          const report = await execute(step, this.options.signal || new AbortController().signal);
          results.set(stepId, { stepId, status: report.success ? 'completed' : 'failed', report, ...(report.terminalReason ? { error: report.terminalReason } : {}) });
          emit(report.success ? 'workflow_step_completed' : 'workflow_step_failed', stepId, report);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.set(stepId, { stepId, status: 'failed', error: message });
          emit('workflow_step_failed', stepId, { error: message });
        }
      }));
    }
    const steps = plan.steps.map((step) => results.get(step.id)!);
    return {
      workflowId: plan.id,
      status: steps.some((step) => step.status === 'failed' || step.status === 'blocked') ? 'failed' : 'completed',
      steps,
    };
  }

  private assertAcyclic(steps: WorkflowStep[]): void {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const walk = (id: string) => {
      if (visiting.has(id)) throw new Error(`Workflow dependency cycle includes ${id}.`);
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dependency of steps.find((step) => step.id === id)?.dependencies || []) walk(dependency);
      visiting.delete(id);
      visited.add(id);
    };
    for (const step of steps) walk(step.id);
  }
}
