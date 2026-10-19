import { redactPolicyText } from '@barok/core';
import type { ChildRunReport, ChildRunSubtaskContract } from './child-run-contracts.js';
import { estimateTextTokens } from './token-accounting.js';

export type SubtaskDispatchTrigger = 'context_pressure' | 'context_overflow';

export type BoundedSubtaskContract = ChildRunSubtaskContract;

/** The host's live run state, narrowed to fields used by dispatch policy. */
export interface EngineSubtaskParentState {
  task: string;
  plan?: Array<{ step: string; status: string }>;
  taskAnalysis?: {
    taskKind?: string;
    affectedFiles?: Array<{ path: string; intent?: string; reason?: string }>;
    verificationPlan?: unknown;
  };
  conversationUpdates?: string[];
  steps?: Array<{
    action: string;
    action_input?: { file_path?: unknown; path?: unknown; [key: string]: unknown };
    observation?: string;
  }>;
}

export interface EngineSubtaskDispatchResult {
  status: 'completed' | 'blocked' | 'cancelled' | 'skipped';
  trigger: SubtaskDispatchTrigger;
  model?: string;
  contextWindow?: number;
  contracts: BoundedSubtaskContract[];
  reports: ChildRunReport[];
  blockers: string[];
  createdAt: number;
}

export interface EngineSubtaskDispatcherOptions {
  contextWindow: number;
  model?: string;
  signal?: AbortSignal;
  maxSubtasks?: number;
  launch: (input: {
    contract: BoundedSubtaskContract;
    task: string;
    evidenceSummary: string;
  }) => Promise<ChildRunReport>;
  onEvent?: (type: string, data: unknown) => void;
}

const SUBTASK_TRIGGER_RATIO = 0.62;
const SUBTASK_OUTPUT_RESERVE_RATIO = 0.25;
const SUBTASK_SYSTEM_TOOL_RESERVE_RATIO = 0.2;
const SUBTASK_MIN_SYSTEM_TOOL_RESERVE = 2_048;
const SUBTASK_EVIDENCE_LIMIT = 4_000;
const SUBTASK_OBJECTIVE_LIMIT = 1_600;
const SUBTASK_FILE_SCOPE_LIMIT = 12;
const SUBTASK_ACCEPTANCE_LIMIT = 6;
const TEST_FILES_PER_SUBTASK = 4;

function normalizeUniqueStrings(values: unknown, limit: number, maxLength = 300): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.replace(/\s+/g, ' ').trim().slice(0, maxLength))
    .filter(Boolean)))
    .slice(0, limit);
}

function contextBudget(contextWindow: number): { maxPromptTokens: number; reservedOutputTokens: number; systemToolReserveTokens: number } {
  const reservedOutputTokens = Math.ceil(contextWindow * SUBTASK_OUTPUT_RESERVE_RATIO);
  const systemToolReserveTokens = Math.max(
    SUBTASK_MIN_SYSTEM_TOOL_RESERVE,
    Math.ceil(contextWindow * SUBTASK_SYSTEM_TOOL_RESERVE_RATIO),
  );
  return {
    reservedOutputTokens,
    systemToolReserveTokens,
    maxPromptTokens: Math.max(0, contextWindow - reservedOutputTokens),
  };
}

export function shouldDispatchForContextPressure(promptTokens: number, contextWindow: number): boolean {
  if (!Number.isFinite(promptTokens) || promptTokens <= 0 || !Number.isFinite(contextWindow) || contextWindow < 1_024) return false;
  return promptTokens >= Math.floor(contextWindow * SUBTASK_TRIGGER_RATIO);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function filesMentionedBy(text: string, files: string[]): string[] {
  const normalized = text.replace(/\\/g, '/').toLowerCase();
  return files.filter((file) => {
    const candidate = file.replace(/\\/g, '/');
    return new RegExp(`(?:^|[^a-z0-9_./-])${escapeRegex(candidate.toLowerCase())}(?:$|[^a-z0-9_./-])`).test(normalized);
  });
}

function pendingObjectives(state: EngineSubtaskParentState): string[] {
  return (state.plan || [])
    .filter((item) => item.status !== 'completed')
    .map((item) => item.step.replace(/\s+/g, ' ').trim().slice(0, SUBTASK_OBJECTIVE_LIMIT))
    .filter(Boolean);
}

interface SubtaskWorkUnit {
  objective: string;
  fileScope: string[];
}

function initialFileWorkUnits(state: EngineSubtaskParentState, maxSubtasks: number): SubtaskWorkUnit[] {
  if ((state.plan || []).length > 0) return [];
  return (state.taskAnalysis?.affectedFiles || [])
    .filter((file) => file.intent !== 'read_only' && typeof file.path === 'string' && file.path.trim())
    .slice(0, maxSubtasks)
    .map((file) => ({
      objective: `${(file.reason || '').replace(/\s+/g, ' ').trim().slice(0, 800) || 'Complete the requested change'} in ${file.path}`,
      fileScope: [file.path],
    }));
}

function testSuiteWorkUnits(state: EngineSubtaskParentState, maxSubtasks: number): SubtaskWorkUnit[] {
  if (state.taskAnalysis?.taskKind !== 'test_only') return [];
  const files = (state.taskAnalysis.affectedFiles || [])
    .filter((file) => /(?:__tests__|\.(?:test|spec)\.)/i.test(file.path))
    .slice(0, 48);
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const normalized = file.path.replace(/\\/g, '/');
    const testFolder = normalized.toLowerCase().indexOf('/__tests__/');
    const group = testFolder >= 0
      ? normalized.slice(0, testFolder)
      : normalized.slice(0, normalized.lastIndexOf('/')) || '.';
    groups.set(group, [...(groups.get(group) || []), normalized]);
  }
  const units: SubtaskWorkUnit[] = [];
  for (const [group, scopedFiles] of groups) {
    for (let offset = 0; offset < scopedFiles.length; offset += TEST_FILES_PER_SUBTASK) {
      const batch = scopedFiles.slice(offset, offset + TEST_FILES_PER_SUBTASK);
      units.push({
        objective: `Run and verify test files ${batch.join(', ')} for the parent goal`,
        fileScope: batch,
      });
      if (units.length >= maxSubtasks) return units;
    }
  }
  return units;
}

export function hasBoundedSubtaskPlan(state: EngineSubtaskParentState, maxSubtasks = 6): boolean {
  const objectives = pendingObjectives(state).slice(0, maxSubtasks);
  if (objectives.length >= 2) return workScopes(state, objectives).every((scope) => scope.length > 0);
  return testSuiteWorkUnits(state, maxSubtasks).length >= 2 || initialFileWorkUnits(state, maxSubtasks).length >= 2;
}

function workScopes(state: EngineSubtaskParentState, objectives: string[]): string[][] {
  const files = normalizeUniqueStrings(state.taskAnalysis?.affectedFiles?.map((file) => file.path), SUBTASK_FILE_SCOPE_LIMIT, 500);
  if (files.length === 0) return [];
  return objectives.map((objective) => {
    const mentioned = filesMentionedBy(objective, files);
    return mentioned.length > 0 ? mentioned : files;
  });
}

function checkList(state: EngineSubtaskParentState, objective: string): string[] {
  const testSuiteWork = state.taskAnalysis?.taskKind === 'test_only' || /\b(?:test|suite|spec)\b/i.test(objective);
  const checks = testSuiteWork
    ? ['Run only the tests in this bounded suite/file scope; keep command output concise and retain failing test names.']
    : normalizeUniqueStrings(state.taskAnalysis?.verificationPlan, SUBTASK_ACCEPTANCE_LIMIT, 300);
  return [
    `Complete this objective: ${objective}`,
    ...checks,
    'Report changed files, checks run, and any blocker in the child report.',
  ].slice(0, SUBTASK_ACCEPTANCE_LIMIT);
}

function compactStepEvidence(state: EngineSubtaskParentState, trigger: SubtaskDispatchTrigger): string {
  const lines: string[] = [];
  if (trigger === 'context_overflow') lines.push('Provider evidence: the previous parent prompt exceeded the resolved model context; unfinished plan items are being moved into bounded fresh child contexts.');
  const updates = state.conversationUpdates?.slice(-4).map((update) => redactPolicyText(update).replace(/\s+/g, ' ').slice(0, 300));
  if (updates?.length) lines.push(`Parent user updates: ${updates.join(' | ')}`);
  const completed = (state.plan || []).filter((item) => item.status === 'completed').map((item) => item.step.slice(0, 180));
  if (completed.length > 0) lines.push(`Completed plan items: ${completed.slice(-4).join(' | ')}`);

  const steps = (state.steps || []).slice(-10);
  for (const step of steps) {
    if (step.action !== 'Write' && step.action !== 'Edit' && step.action !== 'Command' && step.action !== 'Bash') continue;
    let status = 'outcome recorded';
    let detail = '';
    try {
      const value = JSON.parse(step.observation || '{}') as Record<string, unknown>;
      if (value.success === true || value.status === 'passed') status = 'succeeded';
      else if (value.success === false || value.status === 'failed') status = 'failed';
      const error = typeof value.error === 'string' ? value.error : typeof value.message === 'string' && status === 'failed' ? value.message : '';
      if (error) detail = `: ${redactPolicyText(error).replace(/\s+/g, ' ').slice(0, 220)}`;
    } catch {
      if (/\b(?:failed|error)\b/i.test(step.observation || '')) status = 'reported failure';
    }
    const input = step.action_input || {};
    const target = typeof input.file_path === 'string' ? input.file_path : typeof input.path === 'string' ? input.path : '';
    lines.push(`${step.action}${target ? ` ${target}` : ''}: ${status}${detail}`);
  }

  const summary = lines.length > 0 ? lines.slice(-8).join('\n') : 'No prior subtask execution evidence is being handed off.';
  return summary.slice(0, SUBTASK_EVIDENCE_LIMIT);
}

function makeContracts(
  state: EngineSubtaskParentState,
  contextWindow: number,
  maxSubtasks: number,
  evidenceSummary: string,
): { status: 'ready'; contracts: BoundedSubtaskContract[] } | { status: 'skipped' | 'blocked'; reason: string } {
  const objectives = pendingObjectives(state).slice(0, maxSubtasks);
  const testUnits = testSuiteWorkUnits(state, maxSubtasks);
  const units = testUnits.length >= 2
    ? testUnits
    : objectives.length >= 2
    ? (() => {
        const scopes = workScopes(state, objectives);
        return objectives.map((objective, index) => ({ objective, fileScope: scopes[index] || [] }));
      })()
    : initialFileWorkUnits(state, maxSubtasks);
  if (units.length < 2) return { status: 'skipped', reason: 'At least two bounded unfinished work items are required for a safe automatic split.' };
  if (units.some((unit) => unit.fileScope.length === 0)) {
    return { status: 'blocked', reason: 'The task analysis has no bounded file scope for the unfinished plan.' };
  }
  const claimedFiles = new Map<string, string>();
  for (let index = 0; index < units.length; index += 1) {
    for (const file of units[index].fileScope) {
      const normalizedFile = file.replace(/\\/g, '/').toLowerCase();
      const earlierSubtask = claimedFiles.get(normalizedFile);
      if (earlierSubtask) {
        return {
          status: 'blocked',
          reason: `The bounded file scopes for ${earlierSubtask} and subtask-${String(index + 1).padStart(2, '0')} overlap at ${file}; automatic dispatch requires disjoint scopes.`,
        };
      }
      claimedFiles.set(normalizedFile, `subtask-${String(index + 1).padStart(2, '0')}`);
    }
  }

  const budget = contextBudget(contextWindow);
  if (budget.maxPromptTokens < 512) return { status: 'blocked', reason: 'The resolved context window is too small after system, tool, and output reserves.' };

  const contracts: BoundedSubtaskContract[] = units.map(({ objective, fileScope }, index) => {
    const id = `subtask-${String(index + 1).padStart(2, '0')}`;
    const acceptanceChecks = checkList(state, objective);
    const draft = {
      parentGoal: state.task.slice(0, 8_000),
      objective,
      fileScope,
      acceptanceChecks,
      dependencies: index > 0 ? [`subtask-${String(index).padStart(2, '0')}`] : [],
      evidenceSummary,
    };
    const dependencyHandoffReserveTokens = Math.min(1_000, index * 180);
    const estimatedPromptTokens = estimateTextTokens(JSON.stringify(draft)) + budget.systemToolReserveTokens + dependencyHandoffReserveTokens + 512;
    return {
      id,
      objective,
      fileScope,
      acceptanceChecks,
      dependencies: draft.dependencies,
      budget: {
        estimatedPromptTokens,
        maxPromptTokens: budget.maxPromptTokens,
        reservedOutputTokens: budget.reservedOutputTokens,
        systemToolReserveTokens: budget.systemToolReserveTokens,
        dependencyHandoffReserveTokens,
        maxSteps: 20,
        maxLlmRequests: 20,
        maxToolCalls: 120,
        maxCost: 25,
        timeoutMs: 5 * 60_000,
      },
    };
  });

  const oversized = contracts.find((contract) => contract.budget.estimatedPromptTokens > contract.budget.maxPromptTokens);
  if (oversized) return {
    status: 'blocked',
    reason: `Subtask ${oversized.id} is estimated at ${oversized.budget.estimatedPromptTokens} tokens, above its ${oversized.budget.maxPromptTokens}-token safe input budget.`,
  };
  return { status: 'ready', contracts };
}

export function formatSubtaskPrompt(parentGoal: string, contract: BoundedSubtaskContract, evidenceSummary: string): string {
  return [
    'BOUNDED SUBTASK CONTRACT',
    `Parent goal: ${parentGoal.slice(0, 8_000)}`,
    `Objective: ${contract.objective}`,
    `File scope: ${contract.fileScope.join(', ')}`,
    `Acceptance checks:\n${contract.acceptanceChecks.map((check) => `- ${check}`).join('\n')}`,
    `Dependencies already completed: ${contract.dependencies.length ? contract.dependencies.join(', ') : 'none'}`,
    `Prompt budget: approximately ${contract.budget.estimatedPromptTokens} tokens; maximum safe input ${contract.budget.maxPromptTokens} tokens; output reserve ${contract.budget.reservedOutputTokens} tokens.`,
    `Compact parent evidence:\n${evidenceSummary.slice(0, SUBTASK_EVIDENCE_LIMIT)}`,
    'Start with fresh workspace inspection where needed. Use only the contract and current workspace as evidence; no parent transcript is available. Stay within the listed file scope, run applicable checks, and return a concise report of changed files, check results, and blockers.',
  ].join('\n\n');
}

export class EngineSubtaskDispatcher {
  private readonly contextWindow: number;
  private readonly model?: string;
  private readonly signal?: AbortSignal;
  private readonly maxSubtasks: number;
  private readonly launch: EngineSubtaskDispatcherOptions['launch'];
  private readonly onEvent?: EngineSubtaskDispatcherOptions['onEvent'];

  constructor(options: EngineSubtaskDispatcherOptions) {
    this.contextWindow = Number.isFinite(options.contextWindow) ? Math.floor(options.contextWindow) : 0;
    this.model = options.model;
    this.signal = options.signal;
    this.maxSubtasks = Math.max(2, Math.min(6, Math.floor(options.maxSubtasks || 6)));
    this.launch = options.launch;
    this.onEvent = options.onEvent;
  }

  async dispatch(state: EngineSubtaskParentState, trigger: SubtaskDispatchTrigger): Promise<EngineSubtaskDispatchResult> {
    const evidenceSummary = compactStepEvidence(state, trigger);
    const planned = makeContracts(state, this.contextWindow, this.maxSubtasks, evidenceSummary);
    if (planned.status !== 'ready') {
      return {
        status: planned.status, trigger, ...(this.model ? { model: this.model } : {}),
        ...(this.contextWindow > 0 ? { contextWindow: this.contextWindow } : {}),
        contracts: [], reports: [], blockers: [planned.reason], createdAt: Date.now(),
      };
    }

    const contracts = planned.contracts;
    const reports: ChildRunReport[] = [];
    const blockers: string[] = [];
    const parentEvidence = evidenceSummary.slice(0, 2_600);
    let previousChildHandoff = '';
    for (const contract of contracts) {
      if (this.signal?.aborted) {
        return {
          status: 'cancelled', trigger, ...(this.model ? { model: this.model } : {}), contextWindow: this.contextWindow,
          contracts, reports, blockers: [...blockers, 'Parent run was cancelled during sequential child dispatch.'], createdAt: Date.now(),
        };
      }
      const unmetDependency = contract.dependencies.find((dependency) => {
        const index = contracts.findIndex((candidate) => candidate.id === dependency);
        return index < 0 || !reports[index]?.success;
      });
      if (unmetDependency) {
        blockers.push(`${contract.id} was not started because dependency ${unmetDependency} did not complete successfully.`);
        break;
      }
      const rollingEvidence = [parentEvidence, previousChildHandoff].filter(Boolean).join('\n\n').slice(0, SUBTASK_EVIDENCE_LIMIT);
      const task = formatSubtaskPrompt(state.task, contract, rollingEvidence);
      const actualPromptEstimate = estimateTextTokens(task) + contract.budget.systemToolReserveTokens;
      if (actualPromptEstimate > contract.budget.maxPromptTokens) {
        blockers.push(`${contract.id} was not started because its expanded handoff is estimated at ${actualPromptEstimate} tokens, above its ${contract.budget.maxPromptTokens}-token safe input budget.`);
        break;
      }
      this.onEvent?.('subtask_started', {
        subtaskId: contract.id,
        objective: contract.objective,
        fileScope: contract.fileScope,
        dependencies: contract.dependencies,
        estimatedPromptTokens: contract.budget.estimatedPromptTokens,
        model: this.model,
        contextWindow: this.contextWindow,
        sequence: reports.length + 1,
        total: contracts.length,
      });
      try {
        const report = await this.launch({ contract, task, evidenceSummary: rollingEvidence });
        const safeReport = boundedChildReport(report);
        reports.push(safeReport);
        const handoff = `${contract.id}: ${JSON.stringify(compactChildReport(safeReport))}`;
        previousChildHandoff = `Completed dependency report:\n${handoff}`.slice(0, 1_000);
        this.onEvent?.('subtask_report', { subtaskId: contract.id, report: compactChildReport(safeReport) });
        if (!report.success) {
          blockers.push(`${contract.id} failed: ${report.terminalReason || report.blockers.join('; ') || 'child did not meet its completion checks'}`.slice(0, 2_000));
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        blockers.push(`${contract.id} could not be dispatched: ${redactPolicyText(message).slice(0, 1_000)}`);
        break;
      }
    }

    const status = blockers.length > 0 ? 'blocked' : 'completed';
    const result: EngineSubtaskDispatchResult = {
      status,
      trigger,
      ...(this.model ? { model: this.model } : {}),
      ...(this.contextWindow > 0 ? { contextWindow: this.contextWindow } : {}),
      contracts,
      reports,
      blockers,
      createdAt: Date.now(),
    };
    this.onEvent?.('subtask_dispatch_completed', {
      status,
      trigger,
      childCount: reports.length,
      completedCount: reports.filter((report) => report.success).length,
      blockers,
      model: this.model,
      contextWindow: this.contextWindow,
    });
    return result;
  }
}

export function compactChildReport(report: ChildRunReport): Record<string, unknown> {
  return {
    childId: report.childId,
    success: report.success,
    changedFiles: report.changedFiles.slice(0, 20),
    checks: report.checks.slice(-6).map((check) => ({ name: check.name, status: check.status, ...(check.output ? { output: check.output.slice(0, 240) } : {}) })),
    blockers: report.blockers.slice(0, 4).map((blocker) => redactPolicyText(blocker).slice(0, 300)),
    evidenceRefs: report.evidenceRefs.slice(-12),
    ...(report.terminalReason ? { terminalReason: redactPolicyText(report.terminalReason).slice(0, 600) } : {}),
    createdAt: report.createdAt,
  };
}

function boundedChildReport(report: ChildRunReport): ChildRunReport {
  return {
    protocolVersion: report.protocolVersion,
    childId: report.childId,
    success: report.success,
    changedFiles: report.changedFiles.slice(0, 20),
    checks: report.checks.slice(-6).map((check) => ({
      name: check.name.slice(0, 200),
      status: check.status,
      ...(check.output ? { output: redactPolicyText(check.output).slice(0, 240) } : {}),
    })),
    blockers: report.blockers.slice(0, 4).map((blocker) => redactPolicyText(blocker).slice(0, 300)),
    evidenceRefs: report.evidenceRefs.slice(-12),
    ...(report.terminalReason ? { terminalReason: redactPolicyText(report.terminalReason).slice(0, 600) } : {}),
    createdAt: report.createdAt,
  };
}
