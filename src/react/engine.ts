/**
 * ReAct Engine - Refactored Core Orchestrator
 * Orchestrates planning, execution, state management, and budgeting
 */

import {
  createRequestEnvelope as createCoreRequestEnvelope,
  hashRequestText as hashCoreRequestText,
  createTodoLinks,
  createTodoProgressCursor,
  createTodoSnapshot,
  redactPolicyPayload,
  redactPolicyText,
  type CreateRequestEnvelopeInput,
  type RequestEnvelope,
} from '@barok/core';
import {
  executeWithRotation,
  createReactCheckpoint,
  prepareReactRepairState,
  getObservationCompactionMetrics,
  isSuccessfulToolObservation,
  isRecoverableReActProviderAvailabilityError,
  selectVisibleReasoningSummary,
  genericVerificationObservation,
  formatContractVerificationFailure,
  calculateExecutionPacingIntervalMs,
  calculateToolPresentationDelayMs,
  calculateDecisionPresentationDelayMs,
  validateReactStep,
  validateReactResult,
  advancePlan,
  getStateSnapshot,
  setVerificationResult,
  setAppManifestId,
  setAppSpec,
  incrementRepairAttempts,
  isStateComplete,
  isMaxStepsReached,
  isBudgetExceeded,
  trackMutationFailure,
  isEditStagnated,
  isHashConflictOrStalePreimageError,
  resetRecoveryBudgetAfterProgress,
  getCurrentTaskSteps,
  getTaskEvidenceSteps,
  shouldTripContinuousRunNoProgressCircuit,
  primePlanCursor,
  getRetainedReadCoverage,
  createTodoTool,
  createWorkPlanTool,
  createThinkingTool,
  getSemanticInspectionReplayReason as getEngineSemanticInspectionReplayReason,
  getRecentUnchangedReadLoopReason as getEngineRecentUnchangedReadLoopReason,
  normalizeInspectionPath as normalizedInspectionPath,
  stableReplayValue,
  isCrossRunReplayProtectedAction as isEngineCrossRunReplayProtectedAction,
  isUnadvancedLastRunReplay as isEngineUnadvancedLastRunReplay,
  type RunScopedWorkspaceCapability,
  type RetryConfig,
} from '@barok/engine';
import type { CoderTaskAnalysis } from '../coder/taskAnalysis.js';
import type { RuntimeTaskRouting } from '../tasks/runtimeTaskRouting.js';
import { nodeReActEngineRuntime } from '../di/reactEngineDefaults.js';
import type {
  OutcomeKind,
  ReActEngineExecutionProfile,
  ReActEngineLogger,
  ReActEnginePollinationsClient,
  ReActEngineLLMProvider as LLMProvider,
  ReActEngineToolRegistry as ToolRegistry,
  ReActEngineRuntime,
  ReActEngineCapabilityScope,
  ReActEnginePacingProfile as ExecutionPacingProfile,
  ThinkingDepth,
  ReactResult as EngineReactResult,
  ReactStep,
  ContinuationHandoff,
  AgentReasoningContext,
  RunAuditOptions,
  LLMCompletionResult,
  LLMCompletionStreamEvent,
  LLMRequestTelemetry,
} from '@barok/engine';
import {
  completeAgentDecisionRecord,
  createAgentDecisionRecord,
  classifyPolicyAction,
  type AgentDecisionCategory,
  providerKindFromName,
  type AgentDecisionMetadata,
  type PolicyAuditRecord,
} from '@barok/engine';

// Import modular components
import type {
  ReactConfig,
  ReactState,
  AgentStreamEvent,
} from './state-manager.js';
import {
  initializeState,
  addStep,
  isCodingStateBudgetExceeded,
  isCodingStateTimeBudgetExceeded,
  getStateEntryGateFailure,
  hasBaselineVerificationEvidence,
  getUninspectedBaselineVerificationTargets,
  getLatestReadFailureDetails,
  getPendingApprovalRequest,
  requiresSourceMutation,
  hasSuccessfulSourceMutation,
  hasSuccessfulVerificationEvidence,
  startRecovery,
  type RecoveryReason,
  type RecoveryRecord,
} from './state-manager.js';
import {
  estimateModelStepCost,
  calculateTimeCost,
  validateBudget,
  formatBudget,
  getBudgetStatus,
  CONTINUOUS_RUN_COST_LIMIT,
  CONTINUOUS_RUN_STEP_WINDOW,
  resolveGlobalStepLimit,
  resolveMaxRecoveryTransitions,
  resolveRunWallClockBudgetMs,
  resolveStepWindow,
  PerformanceTrace,
  isReadOnlySourceDocumentMutation,
  type ToolAction,
} from '@barok/engine';
import {
  reason,
  planAction,
  getPlannerNativeToolMode,
  checkIfDone,
  synthesizeAnswer,
  getDeterministicInspectionAnswer,
  hasCompletionEvidence,
  hasMutationApprovalGrant,
  hasUninspectedKnownMutationTargets,
  isMutationRecoveryInspection,
  isForcedMutationSelectionError,
  activePlanKind,
  type PlannerConfig,
} from './planner.js';
import { isLocalStructuredActionModel, LocalActionBudgetController } from '@barok/engine';
import { hasAnsweredUserQuestion, recordAnsweredUserQuestion } from '@barok/engine';
import {
  createManifest,
  type AppManifest,
  type VerificationResult,
  extractSuccessfulWorkspaceOutputs,
} from '@barok/engine';

import { buildFallbackAppSpec, type AppSpec } from '@barok/engine';
import { analyzeFailures, shouldRepair, createRepairTask, type RepairPlan } from '@barok/engine';
import {
  recordAPICall,
  getCostSummary,
  formatCostSummary,
  extractGeminiTokenUsage,
} from '@barok/engine';
import { ToolEvidenceLedger, ToolExecutionScheduler, ToolExecutionState } from '@barok/engine';
import { canTransition, transitionRun, type SharedRunState, type TransitionEvidence } from '@barok/engine';
import { estimateReactStepContext, estimateTextTokens } from '@barok/engine';
import { hasBoundedSubtaskPlan, shouldDispatchForContextPressure, type SubtaskDispatchTrigger } from '@barok/engine';
import { isVerificationAction, verificationCommandReferencesFile, verificationCheckForAction } from '@barok/engine';
import {
  assessVerification,
  createCoordinatedVerificationPlan,
  decideVerificationRepair,
  reviewVerification,
  type VerificationObservation,
} from '@barok/engine';

export type ReactResult = EngineReactResult<ReactState>;
export type { ReactConfig, ReactStep, ReactState };
export {
  isSuccessfulToolObservation,
  selectVisibleReasoningSummary,
  genericVerificationObservation,
  formatContractVerificationFailure,
  calculateExecutionPacingIntervalMs,
  calculateToolPresentationDelayMs,
  calculateDecisionPresentationDelayMs,
};

function isWorkspaceBoundaryFailure(observation: string): boolean {
  return /(?:resolved (?:symlink )?path escapes (?:the )?workspace(?: root)?|path is outside the workspace|symlink escapes the workspace)/i.test(observation);
}

function mutationRecoveryTarget(state: ReactState): string | undefined {
  const latestFailedMutation = [...state.steps].reverse().find((step) =>
    (step.action === 'Write' || step.action === 'Edit') &&
    !isSuccessfulToolObservation(step.observation || '') &&
    !isReadOnlySourceDocumentMutation(step)
  );
  const failedTarget = latestFailedMutation?.action_input?.file_path ?? latestFailedMutation?.action_input?.path;
  if (typeof failedTarget === 'string' && failedTarget.trim()) return failedTarget.trim();
  const affectedTarget = state.taskAnalysis?.affectedFiles?.find((file) =>
    file.intent !== 'read_only' && !/\.(?:pdf|docx)$/i.test(file.path)
  )?.path;
  if (affectedTarget) return affectedTarget;
  const candidateTarget = state.taskAnalysis?.contract?.candidateFiles?.find((file) => !/\.(?:pdf|docx)$/i.test(file));
  if (typeof candidateTarget === 'string' && candidateTarget.trim()) return candidateTarget.trim();
  const latestRead = [...state.steps].reverse().find((step) => {
    if (step.action !== 'Read' && step.action !== 'DocumentRead') return false;
    const target = step.action_input?.file_path ?? step.action_input?.path;
    return typeof target !== 'string' || !/\.(?:pdf|docx)$/i.test(target);
  });
  const readTarget = latestRead?.action_input?.file_path ?? latestRead?.action_input?.path;
  return typeof readTarget === 'string' && readTarget.trim() ? readTarget.trim() : undefined;
}

function armMutationRecovery(state: ReactState): void {
  state.forceMutationNextAction = true;
  state.forceMutationTarget ||= mutationRecoveryTarget(state);
}

function hasActiveApprovalGrant(state: ReactState, scope: string): boolean {
  return (state.approvalGrants || []).some((grant) =>
    grant.decision === 'allow' &&
    (grant.expiresAt === undefined || grant.expiresAt > Date.now()) &&
    (grant.scope === '*' || grant.scope === scope)
  );
}

const MUTATION_ACTIONS = new Set(['Write', 'Edit']);
const NON_MUTATING_INSPECTION_ACTIONS = new Set(['Read', 'DocumentRead', 'Glob', 'Grep', 'WorkspaceChanges', 'Bash', 'Command']);
const REPEATED_INSPECTION_LIMIT = 3;
const STREAM_TEXT_LIMIT = 8000;
interface MutationEvidence {
  filesChanged: string[];
  successfulMutations: number;
  failedMutations: number;
  latestMutationFailed: boolean;
}

type NumericCounters = Record<string, number>;

function truncateStreamText(value: string, limit = STREAM_TEXT_LIMIT): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[truncated ${value.length - limit} chars]`;
}

function formatElapsed(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatTerminalAction(action: ToolAction): string {
  const input = action.action_input || {};
  const target = input.file_path ?? input.path ?? input.operation ?? input.command;
  return target ? `${action.action} ${redactPolicyText(String(target)).slice(0, 180)}` : action.action;
}

function formatTerminalObservation(observation: string): string {
  try {
    const parsed = JSON.parse(observation) as Record<string, unknown>;
    const status = parsed.status || (parsed.success === false ? 'failed' : parsed.verificationUnavailable ? 'unavailable' : 'passed');
    const detail = parsed.error || parsed.output || parsed.stdout || parsed.stderr;
    return `${status}${typeof detail === 'string' && detail.trim() ? ` | ${redactPolicyText(detail).replace(/\s+/g, ' ').slice(0, 180)}` : ''}`;
  } catch {
    return redactPolicyText(observation).replace(/\s+/g, ' ').slice(0, 200);
  }
}

const MUTATION_CLAIM_RE = /\b(updated|changed|modified|edited|wrote|created|added|removed|deleted|implemented|fixed|marked|checked off|unchecked)\b/i;
const MUTATION_VERB_RE = /\b(update[ds]?|updating|change[ds]?|changing|modif(?:y|ies|ied|ying)|edit(?:s|ed|ing)?|wrote|write[sn]?|writing|creat(?:e[ds]?|ing)|add(?:s|ed|ing)?|remov(?:e[ds]?|ing)|delet(?:e[ds]?|ing)|implement(?:s|ed|ing)?|fix(?:es|ed|ing)?|mark(?:s|ed|ing)?|check(?:s|ed|ing)? off|uncheck(?:s|ed|ing)?)\b/i;
const CHANGE_NOUN_RE = /\b(files?|changes?|edits?|modifications?|workspace|codebase)\b/i;

function isNegatedMutationSentence(sentence: string): boolean {
  const nearby = '[^.!?\\n]{0,100}';
  const patterns = [
    new RegExp(`\\bno\\b${nearby}${CHANGE_NOUN_RE.source}${nearby}${MUTATION_VERB_RE.source}`, 'i'),
    new RegExp(`${CHANGE_NOUN_RE.source}${nearby}\\b(?:was|were|is|are|has been|have been)?\\s*(?:not|never)\\b${nearby}${MUTATION_VERB_RE.source}`, 'i'),
    new RegExp(`\\b(?:did not|didn't|have not|haven't|has not|hasn't|was not|were not|not yet)\\b${nearby}${MUTATION_VERB_RE.source}`, 'i'),
    new RegExp(`\\bwithout\\b${nearby}${MUTATION_VERB_RE.source}`, 'i'),
  ];
  return patterns.some((pattern) => pattern.test(sentence));
}

function isFutureMutationSentence(sentence: string): boolean {
  const nearby = '[^.!?\\n]{0,120}';
  const patterns = [
    new RegExp(`\\b(?:to proceed with|next steps?|need(?:s)? to|required to|before|should|would|will|can|could|shall|go ahead and)\\b${nearby}${MUTATION_VERB_RE.source}`, 'i'),
    new RegExp(`${MUTATION_VERB_RE.source}${nearby}\\b(?:is needed|are needed|required|before making changes|once done|to proceed)\\b`, 'i'),
  ];
  return patterns.some((pattern) => pattern.test(sentence));
}

function finalAnswerClaimsMutation(finalAnswer?: string): boolean {
  return (finalAnswer || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .some((sentence) =>
      MUTATION_CLAIM_RE.test(sentence) &&
      !isNegatedMutationSentence(sentence) &&
      !isFutureMutationSentence(sentence)
    );
}

function filePathFromInput(input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  const filePath = input.file_path ?? input.path ?? input.filename ?? input.file;
  return typeof filePath === 'string' && filePath.trim() ? filePath : undefined;
}

type WorkspaceRelativePathResolver = (userPath: string, workspaceRoot: string) => string;

function collectMutationEvidence(
  steps: ReactStep[],
  workspace: string,
  resolveWorkspacePath: WorkspaceRelativePathResolver,
): MutationEvidence {
  const files = new Set<string>();
  let successfulMutations = 0;
  let failedMutations = 0;
  let latestMutationFailed = false;
  let sawMutation = false;

  for (const step of steps) {
    if (!MUTATION_ACTIONS.has(step.action)) continue;
    sawMutation = true;
    let ok = isSuccessfulToolObservation(step.observation || '');
    const filePath = filePathFromInput(step.action_input);
    if (ok && filePath) {
      try {
        files.add(resolveWorkspacePath(filePath, workspace));
      } catch {
        // A success-shaped or legacy observation does not make an external
        // target part of this run's workspace evidence.
        ok = false;
      }
    } else {
      ok = false;
    }
    latestMutationFailed = !ok;

    if (ok) {
      successfulMutations += 1;
    } else {
      failedMutations += 1;
    }
  }

  return {
    filesChanged: Array.from(files),
    successfulMutations,
    failedMutations,
    latestMutationFailed: sawMutation && latestMutationFailed,
  };
}

function normalizedWorkspaceEvidencePath(
  state: ReactState,
  value: string,
  resolveWorkspacePath: WorkspaceRelativePathResolver,
): string {
  try {
    return resolveWorkspacePath(value, state.workspace).toLowerCase();
  } catch {
    return '';
  }
}

function missingCreatedFileDeliverables(
  state: ReactState,
  resolveWorkspacePath: WorkspaceRelativePathResolver,
): string[] {
  const requiredPaths = (state.taskAnalysis?.affectedFiles || [])
    .filter((file) => file.intent === 'create' && typeof file.path === 'string' && file.path.trim())
    .map((file) => normalizedWorkspaceEvidencePath(state, file.path, resolveWorkspacePath))
    .filter(Boolean) || [];
  if (requiredPaths.length === 0) return [];

  const changedPaths = new Set(collectMutationEvidence(getTaskEvidenceSteps(state), state.workspace, resolveWorkspacePath).filesChanged
    .map((file) => normalizedWorkspaceEvidencePath(state, file, resolveWorkspacePath)));
  return [...new Set(requiredPaths)].filter((file) => !changedPaths.has(file));
}

function armMissingCreatedFileRecovery(
  state: ReactState,
  resolveWorkspacePath: WorkspaceRelativePathResolver,
): boolean {
  const missingCreatedFiles = missingCreatedFileDeliverables(state, resolveWorkspacePath);
  if (missingCreatedFiles.length === 0) return false;
  state.forceMutationNextAction = true;
  state.forceMutationTarget = missingCreatedFiles[0];
  state.forceReadNextAction = false;
  state.forceReadTarget = undefined;
  return true;
}

function separateWebMarkupFailure(
  state: ReactState,
  resolveWorkspacePath: WorkspaceRelativePathResolver,
): string | null {
  const analysis = state.taskAnalysis;
  const request = analysis?.contract?.originalRequest || analysis?.contract?.resolvedRequest || state.task;
  if (!analysis || !/\bseparate files?\b/i.test(request) ||
      !/\.(?:html?)\b/i.test(request) || !/\.css\b/i.test(request) || !/\.js\b/i.test(request)) {
    return null;
  }

  const htmlTargets = analysis.affectedFiles
    .map((file) => file.path)
    .filter((file) => /\.html?$/i.test(file));
  if (htmlTargets.length === 0) return null;

  const steps = getTaskEvidenceSteps(state);
  const normalizePath = (value: string) => normalizedWorkspaceEvidencePath(state, value, resolveWorkspacePath);
  for (const target of htmlTargets) {
    const targetKey = normalizePath(target);
    let lastMutationIndex = -1;
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const filePath = filePathFromInput(step.action_input);
      if ((step.action === 'Write' || step.action === 'Edit') &&
          filePath && normalizePath(filePath) === targetKey &&
          isSuccessfulToolObservation(step.observation || '')) {
        lastMutationIndex = index;
      }
    }

    let markup = '';
    for (let index = steps.length - 1; index > lastMutationIndex; index -= 1) {
      const step = steps[index];
      const filePath = filePathFromInput(step.action_input);
      if (step.action !== 'Read' || !filePath || normalizePath(filePath) !== targetKey ||
          !isSuccessfulToolObservation(step.observation || '')) continue;
      const observation = step.observation || '';
      try {
        const parsed = JSON.parse(observation) as Record<string, unknown>;
        const text = [parsed.output, parsed.content, parsed.text, parsed.stdout]
          .find((value): value is string => typeof value === 'string');
        markup = text || observation;
      } catch {
        markup = observation;
      }
      break;
    }

    if (!markup) {
      return `Completion blocked: read ${target} after its last edit so the separate CSS/JavaScript files and absence of inline code can be verified.`;
    }

    const markupTags = markup.match(/<[a-z][^>]*>/gi) || [];
    const readAttribute = (tag: string, name: string): string | undefined => {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
      return match?.[1] ?? match?.[2] ?? match?.[3];
    };
    const hasInlineStyle = /<style\b/i.test(markup) || markupTags.some((tag) => /\bstyle\s*=/i.test(tag));
    const hasInlineScript = /<script\b(?![^>]*\bsrc\s*=)(?![^>]*\btype\s*=\s*["']application\/(?:ld\+)?json["'])[^>]*>[\s\S]*?<\/script\s*>/i.test(markup);
    const hasInlineHandler = markupTags.some((tag) => /\bon[a-z]+\s*=/i.test(tag));
    if (hasInlineStyle || hasInlineScript || hasInlineHandler) {
      return `Completion blocked: ${target} contains inline CSS/JavaScript. Move styles and behavior into the requested external files, then reread and verify the HTML.`;
    }

    const hasExternalStylesheet = markupTags.some((tag) =>
      /^<link\b/i.test(tag) &&
      (readAttribute(tag, 'rel') || '').toLowerCase().split(/\s+/).includes('stylesheet') &&
      /\.css(?:[?#]|$)/i.test(readAttribute(tag, 'href') || '')
    );
    const hasExternalScript = markupTags.some((tag) =>
      /^<script\b/i.test(tag) && /\.js(?:[?#]|$)/i.test(readAttribute(tag, 'src') || '')
    );
    if (!hasExternalStylesheet || !hasExternalScript) {
      return `Completion blocked: ${target} must link to the requested external CSS and JavaScript files. Add the missing stylesheet or script reference, then reread the HTML.`;
    }
  }
  return null;
}

function compactReasoningContextText(value: string | undefined, limit: number): string | undefined {
  if (!value || !value.trim()) return undefined;
  return redactPolicyText(value).trim().slice(0, limit);
}

function buildReasoningContext(state: ReactState, activePlanItem?: string): AgentReasoningContext {
  const latestStep = state.steps[state.steps.length - 1];
  const latestUserInput = compactReasoningContextText(state.conversationUpdates?.[state.conversationUpdates.length - 1], 1_200);
  const trigger: AgentReasoningContext['trigger'] = state.recoveryReason
    ? 'recovery'
    : latestUserInput
      ? 'user_message'
      : latestStep
        ? 'tool_result'
        : state.current_step > 0
          ? 'continuation'
          : 'user_request';

  return {
    userRequest: compactReasoningContextText(state.task, 1_600) || 'The current user request.',
    ...(latestUserInput ? { latestUserInput } : {}),
    loopState: state.codingState || 'understand',
    ...(activePlanItem ? { activePlanItem: compactReasoningContextText(activePlanItem, 400) } : {}),
    trigger,
    ...(latestStep?.observation ? { latestEvidence: formatTerminalObservation(latestStep.observation) } : {}),
  };
}

function inspectionActionSignature(action: Pick<ToolAction, 'action' | 'action_input'>): string {
  const operationalInput = Object.fromEntries(
    Object.entries(action.action_input || {}).filter(([key]) => key !== 'rationale' && key !== 'context'),
  );
  return `${action.action}:${stableReplayValue(operationalInput)}`;
}

function repeatedSuccessfulInspectionCount(
  state: Pick<ReactState, 'steps' | 'continuationHandoff'>,
  action: Pick<ToolAction, 'action' | 'action_input'>,
): number {
  if (!NON_MUTATING_INSPECTION_ACTIONS.has(action.action)) return 0;
  const signature = inspectionActionSignature(action);
  let count = 0;
  for (const step of [...getCurrentTaskSteps(state)].reverse()) {
    if (MUTATION_ACTIONS.has(step.action) && isSuccessfulToolObservation(step.observation || '')) break;
    if (NON_MUTATING_INSPECTION_ACTIONS.has(step.action) &&
        inspectionActionSignature(step as ToolAction) === signature &&
        isSuccessfulToolObservation(step.observation || '')) {
      count += 1;
    }
  }
  return count;
}

function collectRuntimeCandidateFiles(
  state: ReactState,
  steps: ReactStep[],
  resolveWorkspacePath: WorkspaceRelativePathResolver,
): string[] {
  const files = new Set<string>();
  const changedFiles = collectMutationEvidence(steps, state.workspace, resolveWorkspacePath).filesChanged;
  for (const step of steps) {
    if (!isSuccessfulToolObservation(step.observation || '')) continue;
    const filePath = filePathFromInput(step.action_input);
    if (filePath) {
      if (step.action === 'Read') files.add(filePath);
      if (state.taskAnalysis?.expectedChangeIntent === 'create' && step.action === 'Write') files.add(filePath);
    }
    // A temporary smoke-test script is a verification artifact, not product
    // scope. Allow it only when a successful verification action explicitly
    // runs that exact artifact, so unrelated out-of-scope writes remain gated.
    if (isVerificationAction(step.action, step.action_input)) {
      for (const changedFile of changedFiles) {
        if (verificationCommandReferencesFile(step.action, step.action_input, changedFile)) files.add(changedFile);
      }
    }
  }
  return [...files];
}

/**
 * Coder completion is already decided by mutation and verification evidence.
 * Build its final handoff from those observations instead of spending another
 * provider request paraphrasing work the executor can report exactly.
 */
export function getDeterministicCoderCompletionAnswer(
  state: ReactState,
  resolveWorkspacePath: WorkspaceRelativePathResolver,
): string | undefined {
  if (!state.taskAnalysis || state.taskAnalysis.expectedChangeIntent === 'read_only') return undefined;

  const currentSteps = getCurrentTaskSteps(state);
  const evidence = collectMutationEvidence(currentSteps, state.workspace, resolveWorkspacePath);
  if (evidence.successfulMutations === 0 || evidence.latestMutationFailed) return undefined;

  const verificationSteps = currentSteps.filter((step) => isVerificationAction(step.action, step.action_input));
  const finalVerificationStatus = new Map<NonNullable<ReturnType<typeof verificationCheckForAction>>, boolean>();
  let sawEarlierVerificationFailure = false;
  for (const step of verificationSteps) {
    const check = verificationCheckForAction(step.action, step.action_input);
    if (!check) continue;
    const succeeded = isSuccessfulToolObservation(step.observation || '');
    if (!succeeded) sawEarlierVerificationFailure = true;
    finalVerificationStatus.set(check, succeeded);
  }
  const verification = [...finalVerificationStatus]
    .filter(([, succeeded]) => succeeded)
    .map(([check]) => check);
  const failedVerification = [...finalVerificationStatus]
    .filter(([, succeeded]) => !succeeded)
    .map(([check]) => check);

  const completedPlanItems = state.plan
    .filter((item) => item.status === 'completed')
    .map((item) => item.step.trim())
    .filter(Boolean)
    .slice(-6);
  const rawRequest = state.taskAnalysis?.userRequest || state.task;
  const latestRequest = rawRequest.match(/Current request:\s*([\s\S]+)$/i)?.[1]?.trim() || rawRequest.trim();
  const compactRequest = latestRequest.replace(/\s+/g, ' ');
  const requestSummary = compactRequest.length > 240
    ? `${compactRequest.slice(0, 237)}...`
    : compactRequest;
  const implementationSummary = completedPlanItems.length > 0
    ? `\n\nWhat I completed:\n${completedPlanItems.map((item) => `- ${item}`).join('\n')}`
    : requestSummary
      ? `\n\nSummary:\n- ${requestSummary}`
      : '';

  const changedFiles = evidence.filesChanged.length > 0
    ? `\n\nChanged files:\n${evidence.filesChanged.map((file) => `- ${file}`).join('\n')}`
    : '';
  const verificationSummary = verification.length > 0
    ? `\n\nVerification passed:\n${Array.from(new Set(verification)).map((check) => `- ${check}`).join('\n')}`
    : '';
  const notes: string[] = [];
  if (evidence.failedMutations > 0) {
    notes.push('An earlier file-change attempt failed, but the final recorded mutation succeeded.');
  }
  if (failedVerification.length > 0) {
    notes.push(`Some non-blocking checks still have failure records: ${failedVerification.join(', ')}.`);
  } else if (sawEarlierVerificationFailure) {
    notes.push('Earlier verification failures were repaired; the final recorded checks passed.');
  } else if (verification.length === 0) {
    notes.push('No automated verification command was recorded for this change.');
  }
  const remainingPlanItems = state.plan.filter((item) => item.status !== 'completed').map((item) => item.step).slice(0, 4);
  if (remainingPlanItems.length > 0) {
    notes.push(`Remaining plan items: ${remainingPlanItems.join(' | ')}.`);
  }
  const notesSummary = notes.length > 0
    ? `\n\nNotes:\n${notes.map((note) => `- ${note}`).join('\n')}`
    : '';

  return `I’ve implemented the requested changes.${implementationSummary}${changedFiles}${verificationSummary}${notesSummary}`;
}

function assessContractVerification(
  state: ReactState,
  resolveWorkspacePath: WorkspaceRelativePathResolver,
) {
  const contract = state.taskAnalysis?.contract;
  if (!contract || !contract.completionEvidenceRequirements?.requireVerificationForCompletion) return undefined;
  const currentSteps = getTaskEvidenceSteps(state);
  const changes = collectMutationEvidence(currentSteps, state.workspace, resolveWorkspacePath).filesChanged;
  const plan = createCoordinatedVerificationPlan(contract, changes);
  const observations = currentSteps.map(genericVerificationObservation).filter((item): item is VerificationObservation => Boolean(item));
  const decision = assessVerification(plan, observations);
  const review = reviewVerification(
    decision,
    changes,
    contract.candidateFiles,
    contract.workspace,
    collectRuntimeCandidateFiles(state, currentSteps, resolveWorkspacePath),
  );
  return {
    decision,
    review,
    hasPassedVerificationCommand: observations.some(
      (observation) => observation.check === 'project-verification' && observation.status === 'passed',
    ),
  };
}

function shouldAutoVerifyBrowserApp(state: ReactState, task: string): boolean {
  if (state.appSpec || state.taskAnalysis?.expectedChangeIntent === 'read_only') return false;
  const analysis = state.taskAnalysis;
  if (!analysis || (analysis.targetLayer !== 'ui' && analysis.targetLayer !== 'full_stack')) return false;
  const hasWebEntry = (analysis.projectFileMap?.files || []).some((file) => {
    const normalized = file.path.replace(/\\/g, '/').toLowerCase();
    return normalized === 'index.html' || normalized.endsWith('/index.html');
  });
  const browserIntent = /\b(browser|website|web\s*app|web\s*game|playable|frontend|ui|layout|page)\b/i.test(task);
  return hasWebEntry && browserIntent;
}

function buildExistingWebAppSpec(task: string, state?: ReactState): AppSpec {
  const fallback = buildFallbackAppSpec(task);
  const files = state?.taskAnalysis?.projectFileMap?.files || [];
  const hasReactOrViteFiles = files.some((file) => {
    const norm = file.path.replace(/\\/g, '/').toLowerCase();
    return norm.endsWith('vite.config.ts') || norm.endsWith('vite.config.js') ||
      norm.endsWith('tsconfig.json') || norm.endsWith('.tsx') || norm.endsWith('.jsx');
  });
  const outputMode = hasReactOrViteFiles || fallback.outputMode === 'vite-react' ? 'vite-react' : 'vanilla-web';
  const checks = [
    outputMode === 'vite-react' ? 'project builds successfully' : 'entry HTML file exists',
    'loads without uncaught console errors',
    'desktop and mobile layout render without overlap',
    'primary interactive controls respond',
  ];
  return {
    ...fallback,
    outputMode,
    entryPoint: 'index.html',
    verificationChecks: checks,
  };
}

function recordAppVerificationEvidence(state: ReactState, result: VerificationResult): void {
  addStep(state, {
    thought: 'The generated app was opened and checked with the browser verifier.',
    action: 'Command',
    action_input: {
      operation: 'verify',
      command: 'browser smoke verification',
    },
    observation: JSON.stringify({
      success: result.passed,
      status: result.passed ? 'passed' : 'failed',
      output: result.summary,
      checks: result.checks.slice(0, 20).map((check) => ({ name: check.name, passed: check.passed, error: check.error })),
    }),
  });
}

export function applyScopedVerificationRepair(
  state: ReactState,
  step: ReactStep,
  resolveWorkspacePath: WorkspaceRelativePathResolver,
  hashSerializedValue: (serialized: string) => string,
): boolean {
  const currentSteps = getCurrentTaskSteps(state);
  const observation = genericVerificationObservation(step, currentSteps.length - 1);
  if (!observation || observation.status === 'passed') return false;
  if (!['failed', 'timed_out', 'cancelled'].includes(observation.status)) return false;
  const changedFiles = collectMutationEvidence(getTaskEvidenceSteps(state), state.workspace, resolveWorkspacePath).filesChanged;
  observation.changedFiles = changedFiles;
  const signatures = state.verificationRepairSignatures || [];
  const repair = decideVerificationRepair(
    observation,
    signatures,
    hashSerializedValue,
  );
  state.verificationRepairSignatures = [...signatures, repair.signature];
  if (!repair.allowed) {
    state.codingState = 'blocked';
    state.blockedReason = repair.reason;
    state.activeRepair = undefined;
    state.task = `${state.taskAnalysis?.contract?.resolvedRequest || state.task}\n\nVerification repair blocked: ${repair.reason}`;
    return true;
  }
  state.repairAttempts += 1;
  state.codingState = repair.strategy;
  state.codingStateStartedStep = state.current_step;
  state.codingStateStartedAt = Date.now();
  state.activeRepair = {
    check: observation.check,
    strategy: repair.strategy as 'inspect' | 'repair',
    reason: repair.reason,
    changedFiles,
  };
  state.task = [
    state.taskAnalysis?.contract?.resolvedRequest || state.task,
    '',
    `Scoped verification ${repair.strategy}: ${observation.check} returned ${observation.status}.`,
    `Changed files: ${changedFiles.join(', ') || 'none recorded'}.`,
    `Exact output: ${(observation.output || 'No output').slice(0, 4000)}`,
    repair.reason,
    'Inspect the implicated files, make only a scoped repair, and rerun the same check.',
  ].join('\n');
  return true;
}

export function getCompletionEvidenceFailure(
  state: ReactState,
  finalAnswer: string,
  resolveWorkspacePath: WorkspaceRelativePathResolver,
): string | null {
  const evidence = collectMutationEvidence(getTaskEvidenceSteps(state), state.workspace || '.', resolveWorkspacePath);
  const expectedMutation = state.taskAnalysis?.expectedChangeIntent
    ? state.taskAnalysis.expectedChangeIntent !== 'read_only'
    : false;
  const claimsMutation = finalAnswerClaimsMutation(finalAnswer);

  if (claimsMutation && evidence.successfulMutations === 0) {
    return 'The agent response is shown below, but its claimed file changes could not be verified because no successful Write/Edit action was recorded.';
  }

  // Read-only responses may accurately report that no mutation was made; they
  // are never sent through feature completion/review gates.
  if (state.taskAnalysis?.expectedChangeIntent === 'read_only' && !claimsMutation) return null;

  const missingCreatedFiles = missingCreatedFileDeliverables(state, resolveWorkspacePath);
  if (missingCreatedFiles.length > 0) {
    return `Completion blocked: these explicitly requested new files have no successful Write/Edit evidence: ${missingCreatedFiles.join(', ')}. Create each required file, then verify the finished deliverables.`;
  }

  const markupFailure = separateWebMarkupFailure(state, resolveWorkspacePath);
  if (markupFailure) return markupFailure;

  const stateGateFailure = state.taskAnalysis ? getStateEntryGateFailure(state, 'complete') : null;
  if (stateGateFailure) return `Completion blocked: ${stateGateFailure}`;

  if ((claimsMutation || expectedMutation) && evidence.latestMutationFailed) {
    return 'Completion blocked: the latest Write/Edit action failed, so the run cannot be marked successful without recovery.';
  }

  return null;
}

function completionRecoveryReason(
  state: ReactState,
  resolveWorkspacePath: WorkspaceRelativePathResolver,
): RecoveryReason {
  const evidence = collectMutationEvidence(getTaskEvidenceSteps(state), state.workspace, resolveWorkspacePath);
  if (evidence.latestMutationFailed || (evidence.failedMutations > 0 && evidence.successfulMutations === 0)) {
    return 'failed_mutation';
  }
  if (evidence.successfulMutations === 0) {
    return 'missing_mutation_evidence';
  }
  if (!hasSuccessfulVerificationEvidence(state)) return 'failed_verification';
  return 'missing_mutation_evidence';
}

function recoveryMessage(reason: RecoveryReason, detail?: string): string {
  const messages: Record<RecoveryReason, string> = {
    missing_mutation_evidence: 'Required source changes do not yet have successful Write/Edit evidence. Resume implementation from the latest inspected targets.',
    failed_mutation: 'The latest mutation failed. Reinspect the affected target and retry a scoped Write or Edit.',
    failed_verification: 'Required verification is missing or failed. Inspect the output, make a scoped repair, and rerun the relevant check.',
    provider_failure: 'The provider failed before the next action. Resume from the latest valid checkpoint without replaying completed tools.',
    invalid_tool_selection: 'The planner response was rejected by the harness before any tool ran because it was not a valid JSON tool selection. Do not repeat prose or pseudo-tool syntax such as "Selected tool: Command({...})". Choose a different permitted tool/action if the previous route is blocked, and return only {"tool":"ToolName","arguments":{...}}.',
    decision_evidence_mismatch: 'The selected action succeeded but contradicted its expected evidence. Reinspect the target and replan from the new observation.',
  };
  return detail ? `${messages[reason]} ${detail}` : messages[reason];
}

function normalizeThinkingDepth(value: unknown): ThinkingDepth {
  return value === 'fast' || value === 'balanced' || value === 'deep'
    ? value
    : 'balanced';
}

export function getExecutionPacingIntervalMs(
  profile: ExecutionPacingProfile,
  override?: number,
  preset?: ReActEngineExecutionProfile,
): number {
  return calculateExecutionPacingIntervalMs(
    override,
    preset || nodeReActEngineRuntime.getExecutionProfilePreset(profile),
  );
}

export function getToolPresentationDelayMs(
  profile: ExecutionPacingProfile,
  action: string,
  preset?: ReActEngineExecutionProfile,
): number {
  return calculateToolPresentationDelayMs(
    action,
    preset || nodeReActEngineRuntime.getExecutionProfilePreset(profile),
  );
}

/**
 * Give free-tier users time to see the complete safe action summary before
 * the selected tool starts. This is presentation pacing only; it does not
 * add another model request or expose private chain-of-thought.
 */
export function getDecisionPresentationDelayMs(
  profile: ExecutionPacingProfile,
  summary: string,
  preset?: ReActEngineExecutionProfile,
): number {
  return calculateDecisionPresentationDelayMs(
    summary,
    preset || nodeReActEngineRuntime.getExecutionProfilePreset(profile),
  );
}

function isPhaseMutation(step: ReactStep): boolean {
  if (!isSuccessfulToolObservation(step.observation || '')) return false;
  if (step.action === 'Write' || step.action === 'Edit') return true;
  const command = String(step.action_input?.command || '');
  return step.action === 'Bash' && /\b(copy-item|new-item|set-content|add-content|out-file|move-item|rename-item)\b/i.test(command);
}

export function hasVerifiedPhaseEvidence(state: ReactState, startingStep: number): boolean {
  const phaseSteps = state.steps.slice(startingStep);
  if (!requiresSourceMutation(state)) return phaseSteps.some((step) => isSuccessfulToolObservation(step.observation || ''));
  const hasSourceEvidence = phaseSteps.some(isPhaseMutation) ||
    hasSuccessfulSourceMutation(state) || hasBaselineVerificationEvidence(state);
  return hasSourceEvidence && phaseSteps.some((step) =>
    isSuccessfulToolObservation(step.observation || '') && isVerificationAction(step.action, step.action_input)
  );
}

/**
 * Keep a phased run on its selected TODO item until objective evidence shows
 * that the item was implemented and verified. Plan wording is advisory: a
 * provider must not accidentally advance the run into the next phase merely
 * because an implementation action matched a multi-part plan label.
 */
export function enforcePhasedExecutionBoundary(
  state: ReactState,
  phaseTargetIndex: number,
  startingStep: number,
): boolean {
  const phaseTarget = state.plan[phaseTargetIndex];
  if (!phaseTarget) return false;

  const requiresMutation = requiresSourceMutation(state);
  const verified = hasVerifiedPhaseEvidence(state, startingStep);
  const phaseIsComplete = verified && (requiresMutation || phaseTarget.status === 'completed');

  if (phaseIsComplete) {
    phaseTarget.status = 'completed';
    for (const [index, item] of state.plan.entries()) {
      if (index > phaseTargetIndex && item.status === 'in_progress') item.status = 'pending';
    }
    return true;
  }

  if (requiresMutation) {
    phaseTarget.status = 'in_progress';
    for (const [index, item] of state.plan.entries()) {
      if (index > phaseTargetIndex && item.status === 'in_progress') item.status = 'pending';
    }
  }
  return false;
}

function waitForPacing(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason || new Error('RUN_CANCELLED'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isNvidiaThrottleError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || '');
  return /NVIDIA routes are throttled|NVIDIA model rotation failed.*throttled|rate.?limit.*nvidia/i.test(message);
}

/** A continuation keeps progress, but its newly computed task contract wins. */
export function resolveRunTaskAnalysis(
  currentAnalysis: CoderTaskAnalysis | undefined,
  resumedAnalysis: CoderTaskAnalysis | undefined,
): CoderTaskAnalysis | undefined {
  return currentAnalysis || resumedAnalysis;
}

function sharedStateForCodingState(state: ReactState): SharedRunState {
  if (state.codingState === 'blocked' && getPendingApprovalRequest(state)) return 'awaiting_approval';
  switch (state.codingState) {
    case 'inspect': return 'inspecting';
    case 'implement': return 'implementing';
    case 'awaiting_plan_approval': return 'awaiting_plan_approval';
    case 'verify':
    case 'review': return 'verifying';
    case 'repair': return 'repairing';
    case 'complete': return 'completed';
    case 'blocked': return 'failed';
    case 'understand':
    case 'discover':
    case 'plan':
    default: return 'planning';
  }
}

export function applyRunTaskAnalysis(
  state: Pick<ReactState, 'taskAnalysis' | 'steps' | 'current_step' | 'evidenceStartStep'>,
  currentAnalysis: CoderTaskAnalysis | undefined,
): void {
  const resumedAnalysis = state.taskAnalysis;
  if (currentAnalysis?.id && resumedAnalysis?.id && currentAnalysis.id !== resumedAnalysis.id) {
    state.evidenceStartStep = Math.min(state.current_step, state.steps.length);
  }
  state.taskAnalysis = resolveRunTaskAnalysis(currentAnalysis, resumedAnalysis);
}

function actionInputPath(input: Record<string, unknown> | undefined): string | undefined {
  const value = input?.file_path ?? input?.path ?? input?.filename ?? input?.file;
  return typeof value === 'string' && value.trim()
    ? value.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
    : undefined;
}

function isFreshUncertaintyEvidence(
  action: Pick<ToolAction, 'action' | 'action_input'>,
  unknownOutcome: { tool: string; input?: Record<string, unknown> },
): boolean {
  if (isVerificationAction(action.action, action.action_input) && action.action !== unknownOutcome.tool) return true;
  if (action.action !== 'Read' && action.action !== 'DocumentRead') return false;
  const target = actionInputPath(action.action_input);
  const uncertainTarget = actionInputPath(unknownOutcome.input);
  return Boolean(target && uncertainTarget && target === uncertainTarget);
}

/**
 * Cross-run replay protection is reserved for actions that may mutate state,
 * launch work, or repeat an expensive command. Read-only discovery must remain
 * available because compact continuation handoffs intentionally omit raw
 * parent observations. Inspection loops are handled separately using child-run
 * line coverage and repeated-probe evidence.
 */
export function isCrossRunReplayProtectedAction(
  action: Pick<ToolAction, 'action' | 'action_input'>,
): boolean {
  return isEngineCrossRunReplayProtectedAction(action);
}

/**
 * A resumed run must not repeat its last successful protected parent action
 * until a successful child action advances the checkpoint.
 */
export function isUnadvancedLastRunReplay(
  state: Pick<ReactState, 'steps' | 'lastRun'>,
  action: Pick<ToolAction, 'action' | 'action_input'>,
): boolean {
  return isEngineUnadvancedLastRunReplay(state.steps, state.lastRun, action);
}

/**
 * Track the model-visible line coverage for each file. New, non-overlapping
 * chunks remain readable; duplicate ranges and reads beyond a known EOF are
 * blocked even when offset/limit arguments are varied.
 */
export function getSemanticInspectionReplayReason(
  state: Pick<ReactState, 'steps' | 'continuationHandoff'>,
  action: Pick<ToolAction, 'action' | 'action_input'>,
): string | undefined {
  const currentSteps = getCurrentTaskSteps(state);
  const retainedReadStepIndexes = new Set(getRetainedReadCoverage(currentSteps).map((entry) => entry.stepIndex));
  return getEngineSemanticInspectionReplayReason(currentSteps, retainedReadStepIndexes, action);
}

/** Suppress a near-term re-read when an unchanged file's full contents remain in prompt memory. */
export function getRecentUnchangedReadLoopReason(
  state: Pick<ReactState, 'steps' | 'continuationHandoff'>,
  action: Pick<ToolAction, 'action' | 'action_input'>,
  recentActionWindow = 3,
): string | undefined {
  const currentSteps = getCurrentTaskSteps(state);
  return getEngineRecentUnchangedReadLoopReason(
    currentSteps,
    getRetainedReadCoverage(currentSteps),
    action,
    recentActionWindow,
  );
}

export class ReActEngine {
  private config: Omit<Required<ReactConfig>, 'onSubtaskDispatch' | 'contextSnapshot'>
    & Pick<ReactConfig, 'onSubtaskDispatch' | 'contextSnapshot'>;
  private llm: LLMProvider;
  private toolRegistry: ToolRegistry;
  private readonly executionLogger?: ReActEngineLogger;
  private workspacePathResolver!: WorkspaceRelativePathResolver;
  private readonly toolEvidenceLedger: ToolEvidenceLedger;
  private readonly toolExecutionState = new ToolExecutionState();
  private readonly toolScheduler = new ToolExecutionScheduler();
  private readonly localActionBudget = new LocalActionBudgetController();
  private capabilityScope!: ReActEngineCapabilityScope;
  private ownsCapabilityScope = false;
  private runInvocationDepth = 0;
  private estimatedStepCost: number;
  private activeTrace?: PerformanceTrace;
  private pendingModelStreamEvent?: Extract<AgentStreamEvent, { type: 'model_stream' }>;
  private pendingModelStreamTimer?: ReturnType<typeof setTimeout>;
  private cacheCounterBaseline?: NumericCounters;
  private traceStartedAt = 0;
  private lastSuccessfulLlmRouteByKind = new Map<string, { provider: string; model: string }>();
  private lastLlmRequestStartedAt = 0;
  private adaptivePacingPenaltyMs = 0;
  private activeRunState?: ReactState;
  private taskRequestCount = 0;
  private activeRunStartedAt = 0;
  private lastLlmRequestId?: string;
  private providerRouteProbeUsed = false;
  private readonly hasExplicitExternalProviderPolicy: boolean;

  private get runSignal(): AbortSignal | undefined {
    return this.capabilityScope?.signal || this.config.signal;
  }

  constructor(config: ReactConfig = {}) {
    this.hasExplicitExternalProviderPolicy = Array.isArray(config.allowedExternalProviders);
    const runtime = config.runtime || nodeReActEngineRuntime;
    this.executionLogger = runtime.getLogger?.();
    this.workspacePathResolver = (userPath, workspaceRoot) =>
      runtime.getWorkspaceRelativePath(userPath, workspaceRoot);
    const pacingProfile: ExecutionPacingProfile = config.pacingProfile === 'conservative' || config.pacingProfile === 'phased' || config.pacingProfile === 'fast'
      ? config.pacingProfile
      : 'automatic';
    const profilePreset = runtime.getExecutionProfilePreset(pacingProfile);
    const continuousRun = config.continuousRun === true;
    const plannerRequestTimeoutMs = config.plannerRequestTimeoutMs || runtime.getPlannerRequestTimeoutMs();
    const llmRequestTimeoutMs = config.llmRequestTimeoutMs || runtime.getLlmRequestTimeoutMs();
    const selectedModel = config.model || runtime.getDefaultModelSelection();
    const handoffContextWindow = config.continuationHandoff?.modelContextWindow;
    const hostSafetyDefaults = runtime.getRunSafetyDefaults?.();
    const globalStepLimit = resolveGlobalStepLimit(config.globalStepLimit ?? hostSafetyDefaults?.globalStepLimit);
    const configuredStepWindow = Number(config.maxSteps);
    const stepWindow = Number.isFinite(configuredStepWindow)
      ? resolveStepWindow(configuredStepWindow, globalStepLimit, continuousRun ? CONTINUOUS_RUN_STEP_WINDOW : 10)
      : Math.min(globalStepLimit, continuousRun ? CONTINUOUS_RUN_STEP_WINDOW : 10);
    this.config = {
      continuousRun,
      maxSteps: stepWindow,
      globalStepLimit,
      wallClockBudgetMs: resolveRunWallClockBudgetMs(config.wallClockBudgetMs ?? hostSafetyDefaults?.wallClockBudgetMs),
      runStartedAt: Number.isFinite(config.runStartedAt) ? Number(config.runStartedAt) : 0,
      maxRecoveryTransitions: resolveMaxRecoveryTransitions(config.maxRecoveryTransitions ?? hostSafetyDefaults?.maxRecoveryTransitions),
      model: selectedModel,
      contextWindow: config.contextWindow || handoffContextWindow || runtime.getModelConfig(
        selectedModel,
        { includeContextWindow: true },
      ).contextWindow || 0,
      modelTargetPinned: config.modelTargetPinned === true,
      geminiProfileId: config.geminiProfileId || '',
      maxLlmRequestsPerTask: continuousRun
        ? Number.POSITIVE_INFINITY
        : (config.maxLlmRequestsPerTask || runtime.getMaxLlmRequestsPerTask()),
      maxToolCalls: continuousRun ? Number.POSITIVE_INFINITY : (config.maxToolCalls || Number.POSITIVE_INFINITY),
      replayGuardEnabled: config.replayGuardEnabled !== false,
      userId: config.userId || 'local-user',
      repositoryCommitHash: config.repositoryCommitHash || '',
      allowCrossProviderFallback: config.allowCrossProviderFallback === true,
      approvedFallbackProviders: config.approvedFallbackProviders || [],
      sameProviderFallbackModels: config.sameProviderFallbackModels || [],
      fallbackApprovalGranted: config.fallbackApprovalGranted === true,
      allowedExternalProviders: config.allowedExternalProviders || [],
      privateWorkspace: config.privateWorkspace === true,
      sendPrivateSourceCode: config.sendPrivateSourceCode === true,
      // One selected model is authoritative for both planning and execution.
      // A confirmed change resumes with the newly selected model.
      plannerModel: selectedModel,
      llmRequestTimeoutMs: profilePreset.requestTimeoutFloorMs > 0
        ? Math.max(llmRequestTimeoutMs, profilePreset.requestTimeoutFloorMs)
        : llmRequestTimeoutMs,
      plannerRequestTimeoutMs: profilePreset.requestTimeoutFloorMs > 0
        ? Math.max(plannerRequestTimeoutMs, profilePreset.requestTimeoutFloorMs)
        : plannerRequestTimeoutMs,
      pacingProfile,
      allowProviderRouteProbe: config.allowProviderRouteProbe === true,
      llmRequestIntervalMs: typeof config.llmRequestIntervalMs === 'number' ? config.llmRequestIntervalMs : Number.NaN,
      thinkingDepth: normalizeThinkingDepth(config.thinkingDepth || runtime.getThinkingDepth()),
      verbose: config.verbose || false,
      budget: continuousRun ? CONTINUOUS_RUN_COST_LIMIT : (config.budget || Infinity),
      workspace: config.workspace || runtime.getWorkingDirectory(),
      runScopedWorkspaceCapability: config.runScopedWorkspaceCapability as RunScopedWorkspaceCapability,
      onProgress: config.onProgress || (() => {}),
      onStateUpdate: config.onStateUpdate || (() => {}),
      onCheckpoint: config.onCheckpoint || (() => {}),
      onSubtaskDispatch: config.onSubtaskDispatch,
      onEvent: config.onEvent || (() => {}),
      onPlannerContextSnapshot: config.onPlannerContextSnapshot || (() => {}),
      consumeQueuedMessages: config.consumeQueuedMessages || (() => []),
      acknowledgeQueuedMessages: config.acknowledgeQueuedMessages || (() => {}),
      requestUserInput: config.requestUserInput || (async () => ({
        requestId: runtime.createId(),
        cancelled: true,
      })),
      signal: config.signal as AbortSignal,
      runId: config.runId || '',
      auditRunId: config.auditRunId || '',
      threadId: config.threadId || '',
      parentRunId: config.parentRunId || '',
      attemptIndex: config.attemptIndex ?? 1,
      threadTitle: config.threadTitle || '',
      llmProvider: config.llmProvider as LLMProvider,
      allowPollinationsFallback: config.allowPollinationsFallback === true,
      allowNvidiaModelFallback: (pacingProfile === 'conservative' || pacingProfile === 'phased')
        ? config.allowNvidiaModelFallback === true
        : config.allowNvidiaModelFallback !== false,
      toolRegistry: config.toolRegistry as ToolRegistry,
      capabilityScope: config.capabilityScope as ReActEngineCapabilityScope,
      capabilityScopeOwned: config.capabilityScopeOwned === true,
      cordisRuntimeEnabled: config.cordisRuntimeEnabled !== false && runtime.isCordisRuntimeEnabled(),
      runtime,
      contextSnapshot: config.contextSnapshot,
      capabilityPack: config.capabilityPack || 'implementation',
      taskAnalysis: config.taskAnalysis as CoderTaskAnalysis,
      taskRouting: config.taskRouting as RuntimeTaskRouting,
      continuationHandoff: config.continuationHandoff as ContinuationHandoff,
      approvalGrantProvider: config.approvalGrantProvider || (() => []),
      debug: config.debug || false,
      formatFailureSwitchPolicy: config.formatFailureSwitchPolicy as any,
      onFormatFailureSwitch: config.onFormatFailureSwitch || (() => {}),
    };
    this.toolEvidenceLedger = new ToolEvidenceLedger(() => runtime.createId());

    // Resolve defaults through the host runtime; explicit per-run providers win.
    const llm = config.llmProvider || runtime.getLLMProvider?.();
    if (!llm) {
      throw new Error('Provide an LLM provider in ReactConfig or through ReActEngineRuntime.');
    }
    this.llm = this.createPacedLlmProvider(llm);

    const toolRegistry = config.toolRegistry || runtime.getToolRegistry?.();
    if (!toolRegistry) {
      throw new Error('Provide a tool registry in ReactConfig or through ReActEngineRuntime.');
    }
    const harnessTools = this.withThinkingTool(this.withWorkPlanTool(this.withTodoTool(toolRegistry)));
    const decoratedTools = config.requestUserInput
      ? this.withUserQuestionTool(harnessTools)
      : harnessTools;
    this.capabilityScope = config.capabilityScope || runtime.createCapabilityScope({
      runId: config.runId,
      modelRoute: {
        requested: selectedModel,
        resolved: selectedModel,
        planner: selectedModel,
        profileId: config.geminiProfileId,
      },
      contextWindow: this.config.contextWindow > 0 ? this.config.contextWindow : undefined,
      toolRegistry: decoratedTools,
      pack: config.capabilityPack || 'implementation',
      policy: {
        taskId: config.taskAnalysis?.id,
        approvalGrants: [],
      },
      workspace: {
        root: this.config.workspace,
        privateWorkspace: this.config.privateWorkspace,
        sendPrivateSourceCode: this.config.sendPrivateSourceCode,
        allowedExternalProviders: [...this.config.allowedExternalProviders],
      },
      budgets: {
        maxSteps: this.config.maxSteps,
        maxLlmRequests: this.config.maxLlmRequestsPerTask,
        maxCost: this.config.budget,
        maxToolCalls: Number.isFinite(this.config.maxToolCalls)
          ? Math.max(1, this.config.maxToolCalls)
          : Number.POSITIVE_INFINITY,
      },
      signal: config.signal,
      onEvent: (event) => this.emitCapabilityScopeEvent(event),
      cordis: {
        enabled: this.config.cordisRuntimeEnabled,
        contextSnapshot: this.config.contextSnapshot,
        onEvent: (event) => this.emitCapabilityScopeEvent(event),
      },
    });
    this.ownsCapabilityScope = !config.capabilityScope || config.capabilityScopeOwned === true;
    this.toolRegistry = this.capabilityScope.toolRegistry;

    // Estimate step cost based on model
    this.estimatedStepCost = estimateModelStepCost(this.config.model);
  }

  private withUserQuestionTool(base: ToolRegistry): ToolRegistry {
    const hiddenModelSwitchingTools = new Set(['SubAgent']);
    const visibleBaseTools = () => base.getAll().filter((tool) =>
      tool.name !== 'AskUserQuestion' && !hiddenModelSwitchingTools.has(tool.name)
    );
    const visibleEnabledTools = () => base.getEnabled().filter((tool) =>
      tool.name !== 'AskUserQuestion' && !hiddenModelSwitchingTools.has(tool.name)
    );
    const askUserQuestion = {
      name: 'AskUserQuestion',
      description: 'Pause this run and ask the user one necessary clarification before continuing. Use only when a material choice cannot be safely inferred from the task or workspace. Do not use it for routine progress updates or decisions already answered by the user.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'One concise, specific question.' },
          options: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 8,
            description: 'Optional mutually exclusive choices.',
          },
          allowFreeform: { type: 'boolean', description: 'Whether the user may enter a custom answer.' },
          context: { type: 'string', description: 'Optional short explanation of why the answer is needed.' },
        },
        required: ['question'],
      },
      handler: async (params: unknown) => {
        const input = params && typeof params === 'object' ? params as Record<string, unknown> : {};
        const question = typeof input.question === 'string' ? input.question.trim() : '';
        if (!question) {
          return { success: false, error: 'AskUserQuestion requires a non-empty question.' };
        }
        const options = Array.isArray(input.options)
          ? input.options.map((option) => String(option).trim()).filter(Boolean).slice(0, 8)
          : [];
        const response = await this.config.requestUserInput({
          requestId: this.config.runtime.createId(),
          question,
          options,
          allowFreeform: input.allowFreeform !== false || options.length === 0,
          context: typeof input.context === 'string' ? input.context.trim() : undefined,
        });
        if (response.cancelled) {
          return {
            success: false,
            status: 'cancelled',
            error: 'The user declined to answer this question. Do not repeat it unchanged; continue with a safe alternative or explain the blocker.',
          };
        }
        return {
          success: true,
          output: response.selectedOption || response.answer || '',
          answer: response.answer,
          selectedOption: response.selectedOption,
        };
      },
    };
    return {
      getAll: () => [...visibleBaseTools(), askUserQuestion],
      get: (name) => name === askUserQuestion.name
        ? askUserQuestion
        : hiddenModelSwitchingTools.has(name) ? undefined : base.get(name),
      getEnabled: () => [...visibleEnabledTools(), askUserQuestion],
      has: (name) => name === askUserQuestion.name || (!hiddenModelSwitchingTools.has(name) && base.has(name)),
      register: (tool) => base.register(tool),
      setEnabled: (name, enabled) => {
        if (name !== askUserQuestion.name) base.setEnabled(name, enabled);
      },
      getNames: () => [...visibleBaseTools().map((tool) => tool.name), askUserQuestion.name],
      size: () => visibleBaseTools().length + 1,
    };
  }

  private withThinkingTool(base: ToolRegistry): ToolRegistry {
    const thinkingTool = createThinkingTool({
      onThought: (summary) => {
        this.emitEvent({
          type: 'model_response',
          message: summary,
          provider: this.llm.getProviderName(),
          model: this.config.plannerModel || this.config.model,
          step: this.activeRunState?.current_step ? this.activeRunState.current_step + 1 : undefined,
          phase: 'planning',
        });
      },
    });
    const visibleBaseTools = () => base.getAll().filter((tool) => tool.name !== thinkingTool.name);
    const visibleEnabledTools = () => base.getEnabled().filter((tool) => tool.name !== thinkingTool.name);
    return {
      getAll: () => [...visibleBaseTools(), thinkingTool],
      get: (name) => name === thinkingTool.name ? thinkingTool : base.get(name),
      getEnabled: () => [...visibleEnabledTools(), thinkingTool],
      has: (name) => name === thinkingTool.name || base.has(name),
      register: (tool) => base.register(tool),
      setEnabled: (name, enabled) => {
        if (name !== thinkingTool.name) base.setEnabled(name, enabled);
      },
      getNames: () => [...visibleBaseTools().map((tool) => tool.name), thinkingTool.name],
      size: () => visibleBaseTools().length + 1,
    };
  }

  private withTodoTool(base: ToolRegistry): ToolRegistry {
    const todoTool = createTodoTool({
      getState: () => this.activeRunState,
      onPlanUpdated: (plan) => {
        if (this.activeRunState) {
          this.activeRunState.plan = plan;
          this.emitTodoProjection(this.activeRunState, true);
          this.config.onStateUpdate(getStateSnapshot(this.activeRunState));
        }
      },
    });
    const visibleBaseTools = () => base.getAll().filter((tool) => tool.name !== todoTool.name);
    const visibleEnabledTools = () => base.getEnabled().filter((tool) => tool.name !== todoTool.name);
    return {
      getAll: () => [...visibleBaseTools(), todoTool],
      get: (name) => name === todoTool.name ? todoTool : base.get(name),
      getEnabled: () => [...visibleEnabledTools(), todoTool],
      has: (name) => name === todoTool.name || base.has(name),
      register: (tool) => base.register(tool),
      setEnabled: (name, enabled) => {
        if (name !== todoTool.name) base.setEnabled(name, enabled);
      },
      getNames: () => [...visibleBaseTools().map((tool) => tool.name), todoTool.name],
      size: () => visibleBaseTools().length + 1,
    };
  }

  private withWorkPlanTool(base: ToolRegistry): ToolRegistry {
    const workPlanTool = createWorkPlanTool({
      getState: () => this.activeRunState,
      onWorkPlanUpdated: (workPlan) => {
        this.emitEvent({ type: 'workplan_updated', workPlan });
        if (this.activeRunState) {
          this.emitTodoProjection(this.activeRunState, false);
          this.config.onStateUpdate(getStateSnapshot(this.activeRunState));
        }
      },
    });
    const visibleBaseTools = () => base.getAll().filter((tool) => tool.name !== workPlanTool.name);
    const visibleEnabledTools = () => base.getEnabled().filter((tool) => tool.name !== workPlanTool.name);
    return {
      getAll: () => [...visibleBaseTools(), workPlanTool],
      get: (name) => name === workPlanTool.name ? workPlanTool : base.get(name),
      getEnabled: () => [...visibleEnabledTools(), workPlanTool],
      has: (name) => name === workPlanTool.name || base.has(name),
      register: (tool) => base.register(tool),
      setEnabled: (name, enabled) => {
        if (name !== workPlanTool.name) base.setEnabled(name, enabled);
      },
      getNames: () => [...visibleBaseTools().map((tool) => tool.name), workPlanTool.name],
      size: () => visibleBaseTools().length + 1,
    };
  }

  private createPacedLlmProvider(provider: LLMProvider): LLMProvider {
    return {
      createChatCompletion: async (messages, model, options) => {
        if (this.activeRunState) {
          const canReserve = this.capabilityScope
            ? this.capabilityScope.reserveLlmRequest()
            : this.taskRequestCount < this.config.maxLlmRequestsPerTask;
          if (!canReserve) {
            throw new Error(
              `Task LLM request budget reached (${this.taskRequestCount}/${this.config.maxLlmRequestsPerTask}). ` +
              'Start a continuation only after explicit user approval.'
            );
          }
          this.taskRequestCount = this.capabilityScope
            ? this.capabilityScope.usage.llmRequests
            : this.taskRequestCount + 1;
          if (this.activeRunState.llmUsage) this.activeRunState.llmUsage.requestCount = this.taskRequestCount;
        }
        const pacingPreset = typeof this.config.llmRequestIntervalMs === 'number'
          && Number.isFinite(this.config.llmRequestIntervalMs)
          ? undefined
          : this.config.runtime.getExecutionProfilePreset(this.config.pacingProfile);
        const configuredInterval = getExecutionPacingIntervalMs(
          this.config.pacingProfile,
          this.config.llmRequestIntervalMs,
          pacingPreset,
        );
        const interval = Math.max(configuredInterval, this.adaptivePacingPenaltyMs);
        const elapsed = this.lastLlmRequestStartedAt > 0 ? Date.now() - this.lastLlmRequestStartedAt : interval;
        const delayMs = Math.max(0, interval - elapsed);
        if (delayMs > 0) {
          const message = `Waiting ${(delayMs / 1000).toFixed(1)}s before the next LLM request (${this.config.pacingProfile} pacing).`;
          this.config.onProgress(message);
          this.emitEvent({ type: 'pacing_wait', profile: this.config.pacingProfile, delayMs, message, scope: 'request' });
          await waitForPacing(delayMs, options?.signal || this.runSignal);
        }

        this.lastLlmRequestStartedAt = Date.now();
        const requestStartedAt = this.lastLlmRequestStartedAt;
        const requestId = this.config.runtime.createId();
        const stepId = options?.stepId;
        const allowProviderRouteProbe = this.config.allowProviderRouteProbe && !this.providerRouteProbeUsed;
        // A probe is an explicit, one-shot escape hatch for a fast run or
        // Continue action. Consume it on the first transport request so a
        // persistent 429 cannot turn into repeated bypasses across steps.
        if (allowProviderRouteProbe) this.providerRouteProbeUsed = true;
        this.lastLlmRequestId = requestId;
        const configuredRequestTimeout = Number(options?.timeoutMs ?? this.config.llmRequestTimeoutMs);
        const effectiveRequestTimeoutMs = Number.isFinite(configuredRequestTimeout) && configuredRequestTimeout > 0
          ? configuredRequestTimeout
          : undefined;
        const effectiveRequestDeadlineAt = effectiveRequestTimeoutMs
          ? requestStartedAt + effectiveRequestTimeoutMs
          : undefined;
        let resolvedRoute: { provider: string; model: string; profileId?: string; credentialIndex?: number } = {
          provider: provider.getProviderName(),
          model,
          profileId: options?.geminiProfileId || this.config.geminiProfileId || undefined,
        };
        let completionResult: LLMCompletionResult | undefined;
        let previousProviderAttempt: LLMRequestTelemetry | undefined;
        let requestHeartbeatTimer: ReturnType<typeof setInterval> | undefined;
        try {
          const modelConfig = this.config.runtime.getModelConfig(model, { includeGroqStreaming: true });
          const freeTierResilience = modelConfig.openRouterFree
            || (this.config.pacingProfile !== 'fast'
              && (modelConfig.nvidia || modelConfig.nvidiaTarget));
          const groqModel = model.startsWith('groq:') ? model.slice('groq:'.length) : '';
          const streamGroq = Boolean(groqModel && modelConfig.groqStreaming);
          // Reasoning turns and local structured-action turns stream so the
          // chat thread can show safe progress. The completed response is
          // still parsed atomically by the planner before any tool dispatch.
          const localModelTarget = modelConfig.localTarget;
          const colabModelTarget = modelConfig.colabTarget;
          const structuredLocalActionRequest = options?.requestKind === 'step.plan_action'
            && (localModelTarget || colabModelTarget);
          const structuredLocalRequest = options?.requestKind === 'step.plan_action'
            || options?.requestKind === 'step.check_done';
          const streamLocal = localModelTarget && (structuredLocalActionRequest || !structuredLocalRequest);
          const streamColab = colabModelTarget && (structuredLocalActionRequest || !structuredLocalRequest);
          const streamFinalAnswer = options?.requestKind === 'final_answer.synthesize'
            && !groqModel
            && provider.getModelCapabilities?.(model)?.streaming === true;
          const streamModel = streamGroq || streamLocal || streamColab || streamFinalAnswer;
          const streamProvider = streamGroq
            ? 'groq'
            : streamColab
              ? 'colab'
              : streamLocal
                ? 'local'
                : undefined;
          const streamModelId = streamGroq ? groqModel : model;
          this.emitEvent({
            type: 'llm_request_started',
            request: this.createRequestEnvelope({
              requestId,
              stepId,
              requestKind: options?.requestKind,
              status: 'started',
              startedAt: requestStartedAt,
              requestedRoute: {
                provider: provider.getProviderName(),
                model,
                profileId: options?.geminiProfileId || this.config.geminiProfileId || undefined,
              },
              modelContextWindow: this.config.contextWindow > 0 ? this.config.contextWindow : undefined,
              taskId: options?.taskId ?? this.activeRunState?.task,
              workspaceId: options?.workspaceId ?? this.config.workspace,
              repositoryCommitHash: options?.repositoryCommitHash ?? this.config.repositoryCommitHash,
              messages,
              categoryTokens: options?.categoryTokens,
              tools: options?.tools,
              toolSchemaVersion: options?.toolSchemaVersion,
              maxTokens: options?.maxTokens,
              timeoutMs: effectiveRequestTimeoutMs,
              responseFormat: options?.responseFormat,
              stream: streamModel || options?.stream,
              role: options?.role,
            }),
          });
          let heartbeatCount = 0;
          let staleProgressEmitted = false;
          requestHeartbeatTimer = setInterval(() => {
            heartbeatCount += 1;
            const now = Date.now();
            const stale = effectiveRequestDeadlineAt !== undefined && now > effectiveRequestDeadlineAt;
            this.emitEvent({
              type: 'llm_request_heartbeat',
              requestId,
              ...(options?.requestKind ? { requestKind: options.requestKind } : {}),
              provider: resolvedRoute.provider,
              model: resolvedRoute.model,
              startedAt: requestStartedAt,
              elapsedMs: Math.max(0, now - requestStartedAt),
              ...(effectiveRequestDeadlineAt ? { deadlineAt: effectiveRequestDeadlineAt } : {}),
              stale,
            });
            if (stale && !staleProgressEmitted) {
              staleProgressEmitted = true;
              this.config.onProgress?.('Provider request passed its effective deadline without a completion event. Its outcome is unknown; check the run status or stop the run if needed.');
            }
            // Keep live traces bounded if a custom provider ignores its own
            // deadline. The normal request timeout and run budget remain the
            // outer cancellation boundaries.
            if (heartbeatCount >= 40 && requestHeartbeatTimer) clearInterval(requestHeartbeatTimer);
          }, 15_000);
          this.config.runtime.unrefTimer?.(requestHeartbeatTimer);
          const isNvidiaModelTarget = modelConfig.nvidia || modelConfig.nvidiaTarget;
          const isFreeTierLocked = (this.config.pacingProfile === 'conservative' || this.config.pacingProfile === 'phased')
            && isNvidiaModelTarget;
          const maxNvidiaEngineRetries = isFreeTierLocked ? 5 : 0;
          let nvidiaEngineRetry = 0;
          let result: string;
          while (true) {
            try {
              result = await provider.createChatCompletion(messages, model, {
            ...options,
            requestId,
            onTelemetry: (telemetry: LLMRequestTelemetry) => {
              const enrichedTelemetry = {
                ...telemetry,
                requestId: telemetry.requestId || requestId,
              };
              const previous = previousProviderAttempt;
              const previousFailed = previous && (
                previous.status === 'failed' || previous.status === 'timed_out' || previous.status === 'skipped_budget'
              );
              const routeChanged = previous && (
                previous.provider !== enrichedTelemetry.provider ||
                previous.model !== enrichedTelemetry.model ||
                previous.credentialIndex !== enrichedTelemetry.credentialIndex ||
                previous.profileId !== enrichedTelemetry.profileId
              );
              if (previousFailed && routeChanged) {
                const cooldownUntil = previous.cooldownUntil ? Date.parse(previous.cooldownUntil) : NaN;
                this.emitEvent({
                  type: 'provider_rotation_occurred',
                  fromProvider: previous.provider || 'unknown',
                  toProvider: enrichedTelemetry.provider || 'unknown',
                  ...(previous.model ? { fromModel: previous.model } : {}),
                  ...(enrichedTelemetry.model ? { toModel: enrichedTelemetry.model } : {}),
                  ...(previous.profileId ? { fromProfileId: previous.profileId } : {}),
                  ...(enrichedTelemetry.profileId ? { toProfileId: enrichedTelemetry.profileId } : {}),
                  ...(previous.credentialIndex !== undefined ? { fromKeyIndex: previous.credentialIndex } : {}),
                  ...(enrichedTelemetry.credentialIndex !== undefined ? { toKeyIndex: enrichedTelemetry.credentialIndex } : {}),
                  cooldownSeconds: Number.isFinite(cooldownUntil) ? Math.max(0, Math.ceil((cooldownUntil - previous.startedAt - previous.durationMs) / 1_000)) : 0,
                  reason: (previous.classification || previous.fallbackDecision || previous.error || 'Provider route failed').replace(/\s+/g, ' ').slice(0, 300),
                  requestId,
                  ...(stepId ? { stepId } : {}),
                });
              }
              previousProviderAttempt = enrichedTelemetry.status === 'succeeded' ? undefined : enrichedTelemetry;
              options?.onTelemetry?.(enrichedTelemetry);
            },
            onCompletionResult: (completion: LLMCompletionResult) => {
              completionResult = completion;
              options?.onCompletionResult?.(completion);
            },
            pacingProfile: this.config.pacingProfile,
            allowProviderRouteProbe,
            geminiProfileId: this.config.geminiProfileId || undefined,
            taskId: this.activeRunState?.task,
            workspaceId: this.config.workspace,
            repositoryCommitHash: this.config.repositoryCommitHash || 'unknown-commit',
            userId: this.config.userId,
            pinModel: true,
            freeTierResilience,
            allowNvidiaModelFallback: (this.config.pacingProfile === 'conservative' || this.config.pacingProfile === 'phased')
              ? this.config.allowNvidiaModelFallback === true
              : (this.config.allowNvidiaModelFallback ?? freeTierResilience),
            allowCrossProviderFallback: (this.config.pacingProfile === 'conservative' || this.config.pacingProfile === 'phased')
              ? false
              : this.config.allowCrossProviderFallback,
            approvedFallbackProviders: this.config.approvedFallbackProviders,
            sameProviderFallbackModels: this.config.sameProviderFallbackModels,
            onRouteSelected: (route: {
              provider: string;
              requestedTarget: string;
              resolvedModel: string;
              profileId?: string;
              credentialIndex?: number;
              reason: 'same_provider_model';
            }) => {
              resolvedRoute = {
                provider: route.provider,
                model: route.resolvedModel,
                profileId: route.profileId,
                credentialIndex: route.credentialIndex,
              };
              const routeContextWindow = this.config.runtime.getModelConfig(
                route.resolvedModel,
                { includeContextWindow: true },
              ).contextWindow;
              if (routeContextWindow) {
                this.config.contextWindow = routeContextWindow;
                if (this.activeRunState) this.activeRunState.modelContextWindow = routeContextWindow;
                this.capabilityScope?.cordisServices.contextAssembly.setTarget({
                  model: route.resolvedModel,
                  contextWindow: routeContextWindow,
                });
              } else {
                this.capabilityScope?.cordisServices.contextAssembly.setTarget({ model: route.resolvedModel });
              }
              this.emitEvent({
                type: 'model_target_resolved',
                requestedTarget: route.requestedTarget,
                provider: route.provider,
                resolvedModel: route.resolvedModel,
                profileId: route.profileId,
                credentialIndex: route.credentialIndex,
                route: 'fallback',
                reason: route.reason,
                ...(routeContextWindow ? { contextWindow: routeContextWindow } : {}),
                requestId,
                stepId,
              });
            },
            fallbackApprovalGranted: this.config.fallbackApprovalGranted,
            allowedExternalProviders: this.hasExplicitExternalProviderPolicy
              ? this.config.allowedExternalProviders
              : undefined,
            privateWorkspace: this.config.privateWorkspace,
            sendPrivateSourceCode: this.config.sendPrivateSourceCode,
            stream: streamModel,
            onStreamEvent: streamModel ? (event: LLMCompletionStreamEvent) => {
              if (event.type === 'completed' || event.type === 'error') return;
              if (event.type === 'reasoning_summary_delta') {
                // Safe reasoning summaries are forwarded to the planner's
                // lifecycle callback, where the run-scoped reasoning ID and
                // phase are attached before reaching the UI.
                options?.onStreamEvent?.(event);
                return;
              }
              this.emitEvent({
                type: 'model_stream',
                provider: streamProvider || resolvedRoute.provider,
                model: streamGroq ? streamModelId : resolvedRoute.model || streamModelId,
                eventType: event.type,
                delta: event.type === 'text_delta'
                  ? event.delta
                  : event.type === 'tool_call_delta'
                    ? event.argumentsDelta || event.name
                    : event.type === 'usage' && event.usage.outputTokens !== undefined
                      ? `Generated approximately ${event.usage.outputTokens.toLocaleString()} output tokens.`
                    : undefined,
                requestId,
                stepId,
                requestKind: options?.requestKind,
              });
              options?.onStreamEvent?.(event);
            } : options?.onStreamEvent,
            minimumRouteIntervalMs: configuredInterval,
            onPacingWait: (event: {
              delayMs: number;
              provider?: string;
              model?: string;
              scope: 'request' | 'fallback' | 'free_tier_key_cooldown';
            }) => {
              const destination = event.provider
                ? `${event.provider}${event.model ? `/${event.model}` : ''}`
                : 'the next provider';
              const message = event.scope === 'free_tier_key_cooldown'
                ? `Waiting ${(event.delayMs / 1000).toFixed(1)}s for ${destination} key cooldown to clear (${this.config.pacingProfile} pacing).`
                : `Waiting ${(event.delayMs / 1000).toFixed(1)}s before ${event.scope === 'fallback' ? `fallback ${destination}` : destination} (${this.config.pacingProfile} pacing).`;
              this.config.onProgress(message);
              this.emitEvent({
                type: 'pacing_wait',
                profile: this.config.pacingProfile,
                delayMs: event.delayMs,
                waitingUntil: Date.now() + event.delayMs,
                message,
                scope: event.scope,
                provider: event.provider,
                model: event.model,
              });
              options?.onPacingWait?.(event);
            },
          });
              break;
            } catch (err) {
              if (
                isFreeTierLocked
                && nvidiaEngineRetry < maxNvidiaEngineRetries
                && isNvidiaThrottleError(err)
                && !options?.signal?.aborted
                && !this.runSignal?.aborted
              ) {
                nvidiaEngineRetry++;
                const pauseMs = 30_000 * nvidiaEngineRetry;
                const pauseMsg = `All NVIDIA keys throttled — waiting ${(pauseMs / 1000).toFixed(0)}s before retry ${nvidiaEngineRetry}/${maxNvidiaEngineRetries}...`;
                this.config.onProgress(pauseMsg);
                this.emitEvent({
                  type: 'nvidia_cooldown_retry',
                  attempt: nvidiaEngineRetry,
                  maxAttempts: maxNvidiaEngineRetries,
                  pauseMs,
                  waitingUntil: Date.now() + pauseMs,
                  message: `All NVIDIA keys throttled — waiting ${(pauseMs / 1000).toFixed(0)}s before retry #${nvidiaEngineRetry}`,
                  provider: 'nvidia',
                  model,
                });
                this.emitEvent({
                  type: 'pacing_wait',
                  profile: this.config.pacingProfile,
                  delayMs: pauseMs,
                  waitingUntil: Date.now() + pauseMs,
                  message: pauseMsg,
                  scope: 'free_tier_key_cooldown',
                  provider: 'nvidia',
                  model,
                  attempt: nvidiaEngineRetry,
                });
                await waitForPacing(pauseMs, options?.signal || this.runSignal);
                continue;
              }
              throw err;
            }
          }
          this.adaptivePacingPenaltyMs = Math.max(0, Math.floor(this.adaptivePacingPenaltyMs * 0.5));
          if (completionResult) {
            resolvedRoute = {
              provider: completionResult.provider,
              model: completionResult.model,
              ...(resolvedRoute.profileId ? { profileId: resolvedRoute.profileId } : {}),
              ...(resolvedRoute.credentialIndex !== undefined ? { credentialIndex: resolvedRoute.credentialIndex } : {}),
            };
          }
          const completedAt = Date.now();
          if (requestHeartbeatTimer) clearInterval(requestHeartbeatTimer);
          this.emitEvent({
            type: 'llm_request_finished',
            request: this.createRequestEnvelope({
              requestId,
              stepId,
              requestKind: options?.requestKind,
              status: 'succeeded',
              startedAt: requestStartedAt,
              completedAt,
              requestedRoute: {
                provider: provider.getProviderName(),
                model,
                profileId: options?.geminiProfileId || this.config.geminiProfileId || undefined,
              },
              resolvedRoute,
              modelContextWindow: this.config.contextWindow > 0 ? this.config.contextWindow : undefined,
              taskId: options?.taskId ?? this.activeRunState?.task,
              workspaceId: options?.workspaceId ?? this.config.workspace,
              repositoryCommitHash: options?.repositoryCommitHash ?? this.config.repositoryCommitHash,
              messages,
              categoryTokens: options?.categoryTokens,
              tools: options?.tools,
              toolSchemaVersion: options?.toolSchemaVersion,
              maxTokens: options?.maxTokens,
              timeoutMs: effectiveRequestTimeoutMs,
              responseFormat: options?.responseFormat,
              stream: streamModel || options?.stream,
              role: options?.role,
              response: {
                textCharacters: result.length,
                textHash: this.hashRequestText(result),
                ...(completionResult?.toolCalls ? { toolCallCount: completionResult.toolCalls.length } : {}),
                ...(completionResult?.finishReason ? { finishReason: completionResult.finishReason } : {}),
                ...(completionResult?.requestId ? { providerRequestId: completionResult.requestId } : {}),
              },
            }),
          });
          return result;
        } catch (error) {
          if (requestHeartbeatTimer) clearInterval(requestHeartbeatTimer);
          const message = error instanceof Error ? error.message : String(error);
          if (/\b429\b|rate.?limit|resource_exhausted|throttl/i.test(message)) {
            this.adaptivePacingPenaltyMs = Math.max(this.adaptivePacingPenaltyMs, 10_000);
          }
          const completedAt = Date.now();
          const status = options?.signal?.aborted || this.runSignal?.aborted
            ? 'cancelled' as const
            : /timeout|timed out|deadline/i.test(message)
              ? 'timed_out' as const
              : 'failed' as const;
          this.emitEvent({
            type: 'llm_request_finished',
            request: this.createRequestEnvelope({
              requestId,
              stepId,
              requestKind: options?.requestKind,
              status,
              startedAt: requestStartedAt,
              completedAt,
              requestedRoute: {
                provider: provider.getProviderName(),
                model,
                profileId: options?.geminiProfileId || this.config.geminiProfileId || undefined,
              },
              resolvedRoute,
              modelContextWindow: this.config.contextWindow > 0 ? this.config.contextWindow : undefined,
              taskId: options?.taskId ?? this.activeRunState?.task,
              workspaceId: options?.workspaceId ?? this.config.workspace,
              repositoryCommitHash: options?.repositoryCommitHash ?? this.config.repositoryCommitHash,
              messages,
              categoryTokens: options?.categoryTokens,
              tools: options?.tools,
              toolSchemaVersion: options?.toolSchemaVersion,
              maxTokens: options?.maxTokens,
              timeoutMs: effectiveRequestTimeoutMs,
              responseFormat: options?.responseFormat,
              stream: options?.stream,
              role: options?.role,
              error: message,
            }),
          });
          throw error;
        }
      },
      estimateStepCost: (model) => provider.estimateStepCost(model),
      getProviderName: () => provider.getProviderName(),
      isAvailable: () => provider.isAvailable(),
      // Preserve optional provider metadata through the pacing/telemetry
      // decorator. The planner uses this to select native tool planning for
      // models such as OpenRouter's ox-alpha; dropping it here silently falls
      // back to the separate reasoning request in the live engine.
      getModelCapabilities: (model) => provider.getModelCapabilities?.(model),
    };
  }

  private recordLlmTelemetry(telemetry: LLMRequestTelemetry): void {
    this.localActionBudget.observe(telemetry);
    this.capabilityScope.cordisServices.telemetry.record({
      type: 'llm_request',
      timestamp: telemetry.startedAt,
      data: {
        provider: telemetry.provider,
        model: telemetry.model,
        requestKind: telemetry.requestKind || 'unspecified',
        status: telemetry.status,
        durationMs: telemetry.durationMs,
        ...(telemetry.error ? { error: telemetry.error.slice(0, 500) } : {}),
      },
    });
    if (this.activeRunState?.llmUsage) {
      this.activeRunState.llmUsage.inputTokens += telemetry.reportedInputTokens ?? telemetry.estimatedInputTokens ?? 0;
      this.activeRunState.llmUsage.outputTokens += telemetry.reportedOutputTokens ?? telemetry.estimatedOutputTokens ?? 0;
      if (telemetry.estimatedInputTokens !== undefined && Number.isFinite(telemetry.estimatedInputTokens)) {
        this.activeRunState.llmUsage.lastEstimatedPromptTokens = telemetry.estimatedInputTokens;
      }
      if (telemetry.reportedInputTokens !== undefined && Number.isFinite(telemetry.reportedInputTokens)) {
        this.activeRunState.llmUsage.lastPromptTokens = telemetry.reportedInputTokens;
        this.activeRunState.llmUsage.peakPromptTokens = Math.max(
          this.activeRunState.llmUsage.peakPromptTokens || 0,
          telemetry.reportedInputTokens,
        );
      }
      if (telemetry.promptPrefillDurationMs !== undefined && Number.isFinite(telemetry.promptPrefillDurationMs)) {
        this.activeRunState.llmUsage.lastPromptPrefillDurationMs = telemetry.promptPrefillDurationMs;
      }
      if (telemetry.cacheHit) this.activeRunState.llmUsage.cacheHits++;
      this.activeRunState.llmUsage.retryCount += telemetry.retryCount ?? (telemetry.retry ? 1 : 0);
    }
    if (telemetry.status === 'succeeded') {
      this.lastSuccessfulLlmRouteByKind.set(telemetry.requestKind || 'unspecified', {
        provider: telemetry.provider,
        model: telemetry.model,
      });
    }
    if (!this.activeTrace) return;
    this.activeTrace.recordSpan({
      name: 'llm.request',
      startedAt: telemetry.startedAt,
      endedAt: telemetry.startedAt + telemetry.durationMs,
      durationMs: telemetry.durationMs,
      metadata: {
        provider: telemetry.provider,
        model: telemetry.model,
        requestKind: telemetry.requestKind || 'unspecified',
        status: telemetry.status,
        maxTokens: telemetry.maxTokens,
        ...(telemetry.promptPrefillDurationMs !== undefined ? { promptPrefillDurationMs: telemetry.promptPrefillDurationMs } : {}),
        ...(telemetry.credentialIndex !== undefined ? { credentialIndex: telemetry.credentialIndex } : {}),
        ...(telemetry.healthScore !== undefined ? { healthScore: telemetry.healthScore } : {}),
        ...(telemetry.error ? { error: telemetry.error.slice(0, 500) } : {}),
      },
    });
    this.activeTrace.incrementCounter(`llm_requests_${telemetry.status}`);
    this.activeTrace.incrementCounter('llm_request_ms', telemetry.durationMs);
  }

  private async dispatchSubtasks(state: ReactState, trigger: SubtaskDispatchTrigger): Promise<boolean> {
    const dispatch = this.config.onSubtaskDispatch;
    if (!dispatch || state.subtaskDispatch) return false;
    this.emitEvent({ type: 'subtask_dispatch_started', trigger, model: this.config.model, contextWindow: state.modelContextWindow });
    try {
      const result = await dispatch(state, trigger);
      if (result.status === 'skipped') {
        this.emitEvent({
          type: 'subtask_dispatch_result',
          status: result.status,
          trigger,
          childCount: 0,
          reports: [],
          blockers: result.blockers,
        });
        return false;
      }
      state.subtaskDispatch = result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.subtaskDispatch = {
        status: 'blocked',
        trigger,
        model: this.config.model,
        ...(state.modelContextWindow ? { contextWindow: state.modelContextWindow } : {}),
        contracts: [],
        reports: [],
        blockers: [message.slice(0, 1_000)],
        createdAt: Date.now(),
      };
    }
    this.emitEvent({
      type: 'subtask_dispatch_result',
      status: state.subtaskDispatch.status,
      trigger: state.subtaskDispatch.trigger,
      childCount: state.subtaskDispatch.reports.length,
      reports: state.subtaskDispatch.reports.map((report) => ({
        childId: report.childId,
        success: report.success,
        changedFiles: report.changedFiles,
        checks: report.checks,
        blockers: report.blockers,
      })),
      blockers: state.subtaskDispatch.blockers,
    });
    this.config.onStateUpdate?.(getStateSnapshot(state));
    this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
    return state.subtaskDispatch.reports.length > 0;
  }

  private async releaseRunInvocation(): Promise<void> {
    this.runInvocationDepth = Math.max(0, this.runInvocationDepth - 1);
    if (this.runInvocationDepth !== 0) return;

    try {
      if (this.config.runScopedWorkspaceCapability) {
        await this.config.runtime.disposeRunScopedWorkspace?.(this.config.runScopedWorkspaceCapability);
      }
    } finally {
      if (this.ownsCapabilityScope) await this.capabilityScope.dispose('engine_run_finished');
    }
  }

  async run(task: string, initialState: Record<string, unknown> = {}): Promise<ReactResult> {
    this.runInvocationDepth += 1;
    this.activeRunStartedAt = this.config.runStartedAt || Date.now();
    const previousTrace = this.activeTrace;
    const previousCacheCounterBaseline = this.cacheCounterBaseline;
    const previousTraceStartedAt = this.traceStartedAt;
    const trace = new PerformanceTrace('react-engine-run');
    this.activeTrace = trace;
    this.cacheCounterBaseline = this.collectCacheCounters();
    this.traceStartedAt = Date.now();
    this.lastSuccessfulLlmRouteByKind.clear();
    // ──────────────────────────────────────────────────────────────────
    // Phase 4: Efficiency - Load caches and route to optimal models
    // ──────────────────────────────────────────────────────────────────
    const cache = this.config.runtime.cache;
    if (cache) {
      try {
        await trace.measure('cache.load', () => cache.load(this.config.workspace));
        this.log(`✓ Loaded caches`);
      } catch {
        // Cache loading is optional; continue without cache
      }
    }

    // Select optimal model based on task complexity
    const taskComplexity = trace.measureSync('task.classify', () => this.config.runtime.classifyTaskComplexity(task));
    const taskCost = trace.measureSync('task.cost_estimate', () => this.config.runtime.estimateTaskCost(task));
    const modelAdvisory = trace.measureSync('model.capability_assess', () => this.config.runtime.assessModelCapability(
      task,
      this.config.model,
      this.config.taskAnalysis?.affectedFiles?.map((file) => file.path) || [],
    ));
    this.log(`📊 Task classified as: ${taskComplexity}`);
    this.log(`💡 Estimated cost: $${taskCost.toFixed(6)}`);
    if (modelAdvisory.escalationRecommended) {
      this.log(`⚠️ Model capability warning: ${modelAdvisory.reasons.join(' ')}`);
    }

    // Start structured logging
    const requestId = this.executionLogger?.startRequest('react-engine', {
      task,
      model: this.config.model,
      modelRouting: modelAdvisory,
      taskRouting: this.config.taskRouting,
      budget: this.config.budget,
      maxSteps: this.config.maxSteps,
    }) ?? this.config.runtime.createId();

    this.log('🚀 Starting ReAct loop');
    this.log(`Task: ${task}`);

    // Initialize state
    const state = initializeState(task, this.config as Required<ReactConfig>);
    Object.assign(state, initialState);
    state.globalStepLimit = Math.min(
      this.config.globalStepLimit,
      Number.isFinite(Number(state.globalStepLimit)) ? Math.max(1, Number(state.globalStepLimit)) : this.config.globalStepLimit,
    );
    state.globalStepCount = Number.isFinite(Number(state.globalStepCount))
      ? Math.max(0, Number(state.globalStepCount), Number(state.current_step) || 0, state.steps.length)
      : Math.max(0, Number(state.current_step) || 0, state.steps.length);
    state.runStartedAt = Number.isFinite(Number(state.runStartedAt)) ? Number(state.runStartedAt) : this.activeRunStartedAt;
    state.wallClockBudgetMs = Math.min(
      this.config.wallClockBudgetMs,
      Number.isFinite(Number(state.wallClockBudgetMs)) ? Math.max(1_000, Number(state.wallClockBudgetMs)) : this.config.wallClockBudgetMs,
    );
    state.maxRecoveryTransitions = Math.min(
      this.config.maxRecoveryTransitions,
      Number.isFinite(Number(state.maxRecoveryTransitions)) ? Math.max(1, Number(state.maxRecoveryTransitions)) : this.config.maxRecoveryTransitions,
    );
    state.stepWindowStart = Number.isFinite(Number(state.stepWindowStart)) ? Number(state.stepWindowStart) : 0;
    state.stepWindowLimit = resolveStepWindow(
      Number.isFinite(Number(state.stepWindowLimit)) ? Number(state.stepWindowLimit) : this.config.maxSteps,
      state.globalStepLimit,
      this.config.maxSteps,
    );
    state.max_steps = Math.min(this.config.globalStepLimit, Math.max(1, Number(state.max_steps) || this.config.maxSteps));
    // Older/direct callers may restore steps without the matching cursor.
    // Treat the restored step list as authoritative in that case so a
    // checkpoint cannot silently grant an extra model/tool turn.
    if (
      Array.isArray(state.steps) &&
      typeof initialState.current_step !== 'number' &&
      (typeof initialState.max_steps === 'number' || state.steps.length < this.config.maxSteps)
    ) {
      state.current_step = Math.max(state.current_step, state.steps.length);
    }
    this.capabilityScope.restoreUsage({
      llmRequests: state.llmUsage?.requestCount || 0,
      cost: state.total_pollen_cost || 0,
    });
    if (!state.dirtyTreeBaseline) state.dirtyTreeBaseline = this.config.runtime.scanDirtyTree(state.workspace);
    if (!state.sharedState) state.sharedState = sharedStateForCodingState(state);
    if (!state.sharedTransitions) state.sharedTransitions = [];
    this.resumeRecoveryBudgetCheckpoint(state);
    if (state.toolEvidence?.length) this.toolEvidenceLedger.restore(state.toolEvidence);
    // Older agent-led checkpoints may predate server-side task analysis.
    // Preserve resumed progress while restoring the current run's analysis so
    // deterministic completion gates do not fall back to extra LLM requests.
    applyRunTaskAnalysis(state, this.config.taskAnalysis);
    const pendingApproval = getPendingApprovalRequest(state);
    if (state.codingState === 'blocked' && pendingApproval && hasActiveApprovalGrant(state, pendingApproval.scope)) {
      // An approved scope is a durable continuation boundary. Clear the
      // previous blocked marker before the next planner turn so the saved
      // denied/confirmation observation is not replayed as a fresh block.
      state.codingState = 'discover';
      state.blockedReason = undefined;
    }
    if (state.taskAnalysis?.contract?.blocker) {
      const blocker = state.taskAnalysis.contract.blocker;
      state.codingState = 'blocked';
      state.blockedReason = `${blocker.message} ${blocker.resolution}`;
      try {
        this.activeRunState = state;
        this.taskRequestCount = state.llmUsage?.requestCount || 0;
        this.config.onStateUpdate?.(getStateSnapshot(state));
        this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
        return await this.handleBlockedState(state);
      } finally {
        try {
          await this.releaseRunInvocation();
        } finally {
          this.activeRunState = undefined;
          this.activeTrace = previousTrace;
          this.cacheCounterBaseline = previousCacheCounterBaseline;
          this.traceStartedAt = previousTraceStartedAt;
        }
      }
    }
    const needsMutationRecovery = requiresSourceMutation(state) &&
      !hasSuccessfulSourceMutation(state) &&
      !hasBaselineVerificationEvidence(state) &&
      ((state.noProgressCount || 0) >= 4 || /Execution state budget exhausted before a source mutation succeeded/i.test(state.blockedReason || ''));
    if (needsMutationRecovery) {
      // Make an old checkpoint produced by the previous advisory-only guard
      // resume directly into a mutation turn instead of replaying inspection.
      armMutationRecovery(state);
      state.codingState = 'implement';
      state.blockedReason = undefined;
    }
    if (state.planApproval?.status === 'approved' && state.codingState === 'awaiting_plan_approval') {
      state.codingState = 'inspect';
      state.blockedReason = undefined;
    }

    // The agent owns the optional todo. Preserve an existing plan on resume,
    // but do not synthesize one from task analysis before the agent acts.
    let planChanged = false;
    if (!Array.isArray(state.plan)) state.plan = [];
    if (state.plan.length > 0 && primePlanCursor(state.plan)) planChanged = true;
    this.emitTodoProjection(state, planChanged);

    if (
      !this.config.modelTargetPinned &&
      state.taskAnalysis?.expectedChangeIntent !== 'read_only' &&
      this.config.pacingProfile !== 'conservative' &&
      this.config.pacingProfile !== 'phased'
    ) {
      const modelResolution = this.config.runtime.resolveToolCapableModel(
        task,
        this.config.model,
        state.taskAnalysis?.affectedFiles?.map((file) => file.path) || [],
      );
      if (modelResolution.changed) {
        const requestedModel = this.config.model;
        this.config.model = modelResolution.model;
        this.config.plannerModel = modelResolution.model;
        this.config.contextWindow = this.config.runtime.getModelConfig(
          modelResolution.model,
          { includeContextWindow: true },
        ).contextWindow || this.config.contextWindow;
        this.capabilityScope.cordisServices.contextAssembly.setTarget({
          model: modelResolution.model,
          contextWindow: this.config.contextWindow > 0 ? this.config.contextWindow : undefined,
        });
        this.capabilityScope.updateModelRoute({ resolved: modelResolution.model, planner: modelResolution.model });
        this.estimatedStepCost = estimateModelStepCost(modelResolution.model);
        this.log(modelResolution.reason || `Switched to tool-capable model ${modelResolution.model}.`);
        this.emitEvent({
          type: 'model_target_resolved',
          requestedTarget: requestedModel,
          provider: 'nvidia',
          resolvedModel: modelResolution.model,
          contextWindow: this.config.contextWindow > 0 ? this.config.contextWindow : undefined,
          route: 'recovery',
          reason: 'capability_escalation',
        });
      }
    }
    // Keep the resolved model target in the durable state as well as in the
    // engine config so provider recovery checkpoints retain the actual route.
    state.model = this.config.model;
    this.capabilityScope.updateModelRoute({ resolved: this.config.model, planner: this.config.plannerModel });
    state.modelContextWindow = this.config.contextWindow > 0 ? this.config.contextWindow : state.modelContextWindow;
    this.capabilityScope.cordisServices.contextAssembly.setTarget({
      model: this.config.model,
      contextWindow: state.modelContextWindow,
    });
    state.taskRouting = this.config.taskRouting || state.taskRouting;
    if (shouldAutoVerifyBrowserApp(state, task)) {
      setAppSpec(state, buildExistingWebAppSpec(task, state));
      this.log('🔍 Browser verification enabled for the detected web workspace.');
    }
    // The selected target/profile is authoritative on a resumed run. A
    // checkpoint can contain the profile used by the previous model, so
    // preferring it would silently route a confirmed model change back to the
    // old account.
    state.providerProfile = this.config.geminiProfileId || state.providerProfile || undefined;
    this.config.geminiProfileId = state.providerProfile || '';
    this.activeRunState = state;
    this.taskRequestCount = state.llmUsage?.requestCount || 0;
    try {
      if (this.config.onStateUpdate) this.config.onStateUpdate(getStateSnapshot(state));
      this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
      if (this.config.onProgress) this.config.onProgress('ReactLoop is ready; the agent is choosing its next tool action');

      while (
        (state.globalStepCount || 0) < (state.globalStepLimit || this.config.globalStepLimit) &&
        !this.isWallClockBudgetExceeded(state) &&
        state.current_step < state.max_steps &&
        Math.max(0, state.current_step - (state.stepWindowStart || 0)) < (state.stepWindowLimit || state.max_steps)
      ) {
        this.throwIfCancelled();
        this.syncSharedState(state, 'engine_turn_boundary');
        if (state.forceMutationNextAction &&
            missingCreatedFileDeliverables(state, this.workspacePathResolver).length === 0 &&
            (activePlanKind(state) === 'verify' || state.codingState === 'verify')) {
          state.forceMutationNextAction = false;
          state.forceMutationTarget = undefined;
        }
        const queuedMessages = this.config.consumeQueuedMessages?.() || [];
        const processedMessageIds: string[] = [];
        for (const queued of queuedMessages) {
          state.conversationUpdates = [...(state.conversationUpdates || []), queued.message].slice(-20);
          processedMessageIds.push(queued.id);
          this.emitEvent({
            type: 'user_message_processed',
            messageId: queued.id,
            message: queued.message,
            processedAt: Date.now(),
          });
        }
        if (processedMessageIds.length > 0) {
          this.config.acknowledgeQueuedMessages?.(processedMessageIds);
        }
        if (this.config.onSubtaskDispatch && !state.subtaskDispatch) {
          const observedPromptTokens = state.llmUsage?.lastPromptTokens ?? state.llmUsage?.lastEstimatedPromptTokens;
          const estimatedPromptTokens = observedPromptTokens ?? (
            estimateTextTokens(state.task) +
            estimateReactStepContext(state.steps).totalTokens +
            estimateTextTokens(JSON.stringify(state.plan || [])) +
            6_000
          );
          if (
            hasBoundedSubtaskPlan(state) &&
            shouldDispatchForContextPressure(estimatedPromptTokens, state.modelContextWindow || this.config.contextWindow)
          ) {
            await this.dispatchSubtasks(state, 'context_pressure');
          }
        }
        const stepStartTime = Date.now();
        const stepId = this.config.runtime.createId();

        const budgetStatus = getBudgetStatus(state.total_pollen_cost, state.budget);
        this.log(`\n[Agent turn] State: ${state.codingState || 'understand'} | Budget: ${budgetStatus.spent.toFixed(4)} / ${formatBudget(state.budget)}`);

        // ── REASON ──────────────────────────────────────────────────────────────
        const reasoningId = this.config.runtime.createId();
        const reasoningProvider = this.llm.getProviderName();
        const reasoningModel = this.config.plannerModel || this.config.model;
        const nativeToolPlanning = getPlannerNativeToolMode(this.llm, reasoningModel) === true;
        // Local Qwen-compatible targets can perform the reasoning phase in
        // native hidden <think> tokens in the same request as the structured
        // action. This avoids evaluating the large context twice while
        // keeping the visible response limited to the action envelope.
        const unifiedLocalThinking = isLocalStructuredActionModel(reasoningModel);
        const activePlanItem = state.plan.find((item) => item.status === 'in_progress')?.step;
        const reasoningContext = buildReasoningContext(state, activePlanItem);
        this.emitEvent({
          type: 'reasoning_start',
          id: reasoningId,
          provider: reasoningProvider,
          model: reasoningModel,
          step: state.current_step + 1,
          stepId,
          phase: 'planning',
          visibility: 'collapsed',
          source: 'model',
          context: reasoningContext,
        });
        let providerReasoningSummary = '';
        try {
          const plannerConfig = {
            platform: this.config.runtime.getPlatform(),
            model: this.config.model,
            plannerModel: this.config.plannerModel,
            requestTimeoutMs: this.config.plannerRequestTimeoutMs,
            signal: this.runSignal,
            stepId,
            requestKind: 'step.reason',
            onLlmTelemetry: (telemetry: LLMRequestTelemetry) => this.recordLlmTelemetry(telemetry),
            verbose: this.config.verbose,
            thinkingDepth: this.config.thinkingDepth,
            skipSeparateReasoning: nativeToolPlanning || unifiedLocalThinking,
            onReasoningSummary: (summary: string) => {
              providerReasoningSummary = summary;
            },
            onStreamEvent: (event) => {
              if (event.type !== 'reasoning_summary_delta') return;
              this.emitEvent({
                type: 'reasoning_delta',
                id: reasoningId,
                provider: reasoningProvider,
                model: reasoningModel,
                step: state.current_step + 1,
                stepId,
                phase: 'planning',
                source: event.source,
                delta: event.delta,
              });
            },
            onGuidanceSnapshot: (snapshot) => this.emitPlannerGuidanceSnapshot(snapshot, state.current_step + 1, stepId),
            onContextSnapshot: (stepSeq, snapshot) => this.config.onPlannerContextSnapshot?.(stepSeq, snapshot),
            contextAssembly: this.capabilityScope.cordisServices.contextAssembly,
            toolEvidenceLedger: this.toolEvidenceLedger,
            localActionBudget: this.localActionBudget,
          } satisfies PlannerConfig;
          const thought = await trace.measure('step.reason', () => reason(state, this.llm, plannerConfig, this.toolRegistry));
          this.log(`[Reason] ${thought}`);
          if (this.config.onProgress) this.config.onProgress(`Thinking: ${thought.substring(0, 100)}...`);

          // ── PLAN ACTION ──────────────────────────────────────────────────────
          const planningStartedAt = Date.now();
          let action = await trace.measure('step.plan_action', () => planAction(state, thought, this.llm, {
            ...plannerConfig,
            requestKind: 'step.plan_action',
            onMalformedProviderResponse: async (audit) => {
              try {
                await this.config.runtime.recordProtocolAudit?.(audit, requestId);
              } catch (auditError) {
                if (this.config.debug) {
                  this.log(`Protocol audit persistence failed: ${auditError instanceof Error ? auditError.message : String(auditError)}`);
                }
              }
              const policy = this.config.formatFailureSwitchPolicy;
              if (policy) {
                const target = policy.recordFailure(audit.provider || providerKindFromName(this.llm.getProviderName()), this.config.model);
                if (target) {
                  this.config.onFormatFailureSwitch(target);
                  const suggestedTarget = target.model || target.provider;
                  throw new Error(
                    `MODEL_FALLBACK_CONFIRMATION_REQUIRED: The selected model ${this.config.model} returned repeated malformed responses. ` +
                    `Switching to ${suggestedTarget} requires user confirmation.`
                  );
                }
              }
            },
          }, this.toolRegistry), { step: state.current_step + 1 });
          if (state.forceReadNextAction && state.forceReadTarget) {
            const selectedPath = action.action_input?.file_path ?? action.action_input?.path;
            const normalizedSelectedPath = typeof selectedPath === 'string'
              ? selectedPath.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
              : undefined;
            const normalizedTarget = state.forceReadTarget.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
            if (action.action !== 'Read' || normalizedSelectedPath !== normalizedTarget) {
              this.config.onProgress(`Recovery requires a fresh Read of ${state.forceReadTarget} before retrying the failed mutation.`);
              action = {
                action: 'Read',
                action_input: { file_path: state.forceReadTarget },
              };
            }
          }
          const selectedQuestion = action.action === 'AskUserQuestion' && typeof action.action_input?.question === 'string'
            ? action.action_input.question
            : undefined;
          if (selectedQuestion && hasAnsweredUserQuestion(state, selectedQuestion)) {
            const priorAnswer = state.answeredUserQuestions?.find((item) =>
              item.question.trim().toLowerCase().replace(/\s+/g, ' ') === selectedQuestion.trim().toLowerCase().replace(/\s+/g, ' ')
            )?.answer;
            const replayMessage = `Repeated clarification blocked: this question was already answered${priorAnswer ? ` with "${priorAnswer.slice(0, 240)}"` : ''}. Continue with the recorded answer or provide a concrete implementation action.`;
            if (hasBaselineVerificationEvidence(state)) {
              state.codingState = 'verify';
              state.blockedReason = undefined;
              this.config.onProgress(`${replayMessage} Baseline source evidence is already complete; continuing with verification.`);
              if (this.config.onStateUpdate) this.config.onStateUpdate(getStateSnapshot(state));
              this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
              continue;
            }
            if (!state.forceMutationNextAction && requiresSourceMutation(state)) {
              armMutationRecovery(state);
              state.codingState = 'implement';
              state.noProgressCount = Math.max(state.noProgressCount || 0, 4);
              state.blockedReason = undefined;
              this.config.onProgress(`${replayMessage} Forcing one implementation turn.`);
              if (this.config.onStateUpdate) this.config.onStateUpdate(getStateSnapshot(state));
              this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
              continue;
            }
            state.codingState = 'blocked';
            state.blockedReason = `${replayMessage} The model did not advance after the forced implementation turn.`;
            this.config.onProgress(replayMessage);
            if (this.config.onStateUpdate) this.config.onStateUpdate(getStateSnapshot(state));
            this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
            return await this.handleBlockedState(state);
          }
          // A failed mutation can leave both recovery flags armed: the stale
          // preimage needs one targeted Read, while the repeated-inspection
          // guard requires the next planner turn to be Write/Edit-only. The
          // forced Read above is that one permitted exception; do not block it
          // merely because mutation recovery is also active.
          const mutationRecoveryInspection = state.forceReadNextAction === true &&
            isMutationRecoveryInspection(state, action.action, action.action_input);
          if (
            state.forceMutationNextAction &&
            !MUTATION_ACTIONS.has(action.action) &&
            !mutationRecoveryInspection &&
            activePlanKind(state) !== 'verify' &&
            state.codingState !== 'verify'
          ) {
            state.codingState = 'blocked';
            state.blockedReason = `Implementation was required after a repeated loop, but the model selected ${action.action}. Resume with a scoped Write or Edit action.`;
            this.config.onProgress(state.blockedReason);
            if (this.config.onStateUpdate) this.config.onStateUpdate(getStateSnapshot(state));
            this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
            return await this.handleBlockedState(state);
          }
          const repeatedInspectionCount = repeatedSuccessfulInspectionCount(state, action as ToolAction);
          if (repeatedInspectionCount >= REPEATED_INSPECTION_LIMIT && !mutationRecoveryInspection) {
            const replayMessage = `Repeated inspection blocked: ${formatTerminalAction(action as ToolAction)} has already succeeded ${repeatedInspectionCount} times without a mutation. Choose Write/Edit or resume with a narrower implementation target.`;
            if (hasBaselineVerificationEvidence(state)) {
              state.codingState = 'verify';
              state.blockedReason = undefined;
              this.config.onProgress(`${replayMessage} Baseline source evidence is already complete; continuing with verification.`);
              if (this.config.onStateUpdate) this.config.onStateUpdate(getStateSnapshot(state));
              this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
              continue;
            }
            if (!state.forceMutationNextAction && requiresSourceMutation(state)) {
              armMutationRecovery(state);
              state.codingState = 'implement';
              state.noProgressCount = Math.max(state.noProgressCount || 0, 4);
              state.blockedReason = undefined;
              this.config.onProgress(`${replayMessage} Forcing one implementation turn.`);
              if (this.config.onStateUpdate) this.config.onStateUpdate(getStateSnapshot(state));
              this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
              continue;
            }
            state.codingState = 'blocked';
            state.blockedReason = replayMessage;
            this.config.onProgress(replayMessage);
            if (this.config.onStateUpdate) this.config.onStateUpdate(getStateSnapshot(state));
            this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
            return await this.handleBlockedState(state);
          }
          const exactReplay = isUnadvancedLastRunReplay(state, action as ToolAction);
          const semanticReplayMessage = getSemanticInspectionReplayReason(state, action as ToolAction);
          const unchangedReadLoopMessage = getRecentUnchangedReadLoopReason(state, action as ToolAction);
          if (unchangedReadLoopMessage ||
              (this.config.replayGuardEnabled && (exactReplay || semanticReplayMessage))) {
            const replayMessage = unchangedReadLoopMessage || semanticReplayMessage ||
              `Continuation replay prevented: ${action.action} with the same input was the last successful action in the saved run. Select an action that advances ${state.lastRun?.nextPlanItem || 'the remaining plan'}.`;
            const replayStep: ReactStep = {
              thought: replayMessage,
              action: 'ReplayGuard',
              action_input: {
                attempted_action: action.action,
                attempted_input: action.action_input,
                ...(semanticReplayMessage || unchangedReadLoopMessage
                  ? { semantic_path: normalizedInspectionPath(action.action_input) }
                  : {}),
              },
              observation: JSON.stringify({
                success: false,
                skipped: true,
                error: replayMessage,
              }),
              is_done: false,
              pollenCost: this.estimatedStepCost,
              startTime: stepStartTime,
              endTime: Date.now(),
              durationMs: Date.now() - stepStartTime,
            };
            addStep(state, replayStep);
            this.config.onProgress(replayMessage);
            if (this.config.onStateUpdate) this.config.onStateUpdate(getStateSnapshot(state));
            this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
            continue;
          }
          const mutationTargetInspectionExhausted = requiresSourceMutation(state) &&
            !hasBaselineVerificationEvidence(state) &&
            (state.noProgressCount || 0) >= 4 &&
            !hasUninspectedKnownMutationTargets(state) &&
            (state.taskAnalysis?.approvalPolicy !== 'ask' || hasMutationApprovalGrant(state));
          if (mutationTargetInspectionExhausted && NON_MUTATING_INSPECTION_ACTIONS.has(action.action)) {
            armMutationRecovery(state);
            const target = state.forceMutationTarget;
            const directive = `Run blocked after repeated inspection without a source mutation. Resume with a scoped Write or Edit action.${target ? ` Target: ${target}.` : ''}`;
            if (this.recoveryAttemptsForReason(state, 'missing_mutation_evidence') < 3) {
              const guardStep: ReactStep = {
                thought: directive,
                action: 'ReplayGuard',
                action_input: {
                  attempted_action: action.action,
                  attempted_input: action.action_input,
                  target,
                },
                observation: JSON.stringify({
                  success: false,
                  skipped: true,
                  error: directive,
                  directive: `Repeated inspection is blocked. Choose a scoped Write or Edit action for ${target || 'the target file'}.`,
                }),
                is_done: false,
                pollenCost: this.estimatedStepCost,
                startTime: stepStartTime,
                endTime: Date.now(),
                durationMs: Date.now() - stepStartTime,
              };
              addStep(state, guardStep);
              state.codingState = 'implement';
              state.blockedReason = undefined;
              this.transitionToRecovery(state, 'missing_mutation_evidence', directive, 'implement');
              this.config.onProgress(`Directing agent to implementation: ${directive}`);
              continue;
            }
            state.codingState = 'blocked';
            state.blockedReason = directive;
            this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
            return await this.handleBlockedState(state);
          }
          const plannerRoute = this.lastSuccessfulLlmRouteByKind.get('step.plan_action') || {
            provider: this.llm.getProviderName(),
            model: this.config.plannerModel || this.config.model,
          };
          const toolCallId = this.config.runtime.createId();
          const modelReasoningSummary = thought.trim();
          const actionRationale = (action as typeof action & { rationale?: string }).rationale?.trim() || '';
          const decisionMetadata = (action as typeof action & { decision?: AgentDecisionMetadata }).decision;
          const actionSummary = this.describeModelDecision(action as ToolAction, activePlanItem);
          // Native tool planning can skip the separate reasoning request and
          // return a generic placeholder. It is useful internally, but it is
          // not an explanation of this particular action. Prefer the action's
          // bounded rationale or deterministic action summary instead.
          const visibleSummary = selectVisibleReasoningSummary({
            providerReasoningSummary,
            modelReasoningSummary,
            actionRationale,
            actionSummary,
          });
          const visibleReasoningSummary = visibleSummary.summary;
          const agentMessage = visibleReasoningSummary || actionRationale || actionSummary;
          const summaryOrigin = visibleSummary.origin;
          const decisionRecord = createAgentDecisionRecord({
            id: this.config.runtime.createId(),
            step: state.current_step + 1,
            provider: providerKindFromName(plannerRoute.provider),
            model: plannerRoute.model,
            action: {
              action: action.action,
              action_input: redactPolicyPayload(action.action_input) as Record<string, unknown>,
            },
            decisionCategory: this.classifyDecisionCategory(state, action.action, action.action_input),
            reasoningId,
            reasoningVisibility: 'collapsed',
            reasoningSource: summaryOrigin,
            rationale: actionRationale || visibleReasoningSummary || actionSummary,
            ...(decisionMetadata?.planUpdate ? { planUpdate: decisionMetadata.planUpdate } : {}),
            ...(decisionMetadata?.expectedEvidence ? { expectedEvidence: decisionMetadata.expectedEvidence } : {}),
            ...(decisionMetadata?.evidenceChecks ? { evidenceChecks: decisionMetadata.evidenceChecks } : {}),
            ...(decisionMetadata?.preconditions ? { preconditions: decisionMetadata.preconditions } : {}),
            ...(decisionMetadata?.stopCondition ? { stopCondition: decisionMetadata.stopCondition } : {}),
            ...(decisionMetadata?.confidence !== undefined ? { confidence: decisionMetadata.confidence } : {}),
          });
          this.emitEvent({
            type: 'reasoning_end',
            id: reasoningId,
            provider: plannerRoute.provider,
            model: plannerRoute.model,
            step: state.current_step + 1,
            stepId,
            phase: 'planning',
            visibility: 'collapsed',
            source: summaryOrigin,
            summary: agentMessage,
            context: reasoningContext,
          });
          this.emitEvent({
            type: 'model_response',
            message: agentMessage,
            provider: plannerRoute.provider,
            model: plannerRoute.model,
            step: state.current_step + 1,
            stepId,
            requestId: this.lastLlmRequestId,
            toolCallId,
            phase: 'planning',
            decision: {
              tool: action.action,
              arguments: redactPolicyPayload(action.action_input) as Record<string, unknown>,
              ...(actionRationale
                ? { rationale: actionRationale, rationaleOrigin: 'model' as const }
                : {}),
              ...(visibleReasoningSummary ? { reasoningSummary: visibleReasoningSummary } : {}),
              ...(activePlanItem ? { planItem: activePlanItem } : {}),
              ...(decisionMetadata?.expectedEvidence ? { expectedEvidence: decisionMetadata.expectedEvidence } : {}),
              ...(decisionMetadata?.preconditions ? { preconditions: decisionMetadata.preconditions } : {}),
              ...(decisionMetadata?.stopCondition ? { stopCondition: decisionMetadata.stopCondition } : {}),
              ...(decisionMetadata?.confidence !== undefined ? { confidence: decisionMetadata.confidence } : {}),
              ...(decisionMetadata?.planUpdate ? { planUpdate: decisionMetadata.planUpdate } : {}),
              ...(decisionMetadata?.evidenceChecks ? { evidenceChecks: decisionMetadata.evidenceChecks } : {}),
              decisionId: decisionRecord.id,
              reasoningId,
              reasoningVisibility: decisionRecord.reasoningVisibility,
              reasoningSource: decisionRecord.reasoningSource,
              decisionStatus: decisionRecord.status,
              codingState: state.codingState,
              decisionCategory: decisionRecord.decisionCategory,
              summaryOrigin,
            },
            decisionRecord,
            context: reasoningContext,
          });
          this.emitEvent({ type: 'decision_record', record: decisionRecord });
          this.log(`[Model: ${plannerRoute.provider}/${plannerRoute.model}] ${agentMessage}`);
          this.log(`[Action] ${formatTerminalAction(action as ToolAction)} | planning ${formatElapsed(Date.now() - planningStartedAt)}`);
          const decisionPresentationDelayMs = getDecisionPresentationDelayMs(
            this.config.pacingProfile,
            agentMessage,
            this.config.runtime.getExecutionProfilePreset(this.config.pacingProfile),
          );
          if (decisionPresentationDelayMs > 0) {
            this.emitEvent({
              type: 'pacing_wait',
              profile: this.config.pacingProfile,
              delayMs: decisionPresentationDelayMs,
              message: `Showing the full safe action summary before ${action.action} starts.`,
              scope: 'presentation',
            });
            await waitForPacing(decisionPresentationDelayMs, this.runSignal);
          }
          if (this.config.onProgress) this.config.onProgress(`Executing: ${action.action}`);
          const uncertainReplay = state.uncertainToolCalls?.find((call) =>
            call.tool === action.action &&
            stableReplayValue(call.input || {}) === stableReplayValue(action.action_input || {}) &&
            isCrossRunReplayProtectedAction(action as ToolAction)
          );
          if (uncertainReplay) {
            state.codingState = 'blocked';
            state.blockedReason = `The ${action.action} tool call has an unknown prior outcome. Verify its effect before retrying the same action.`;
            this.config.onProgress(state.blockedReason);
            if (this.config.onStateUpdate) this.config.onStateUpdate(getStateSnapshot(state));
            this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
            return await this.handleBlockedState(state);
          }
          const installAction = classifyPolicyAction(action as ToolAction).category === 'install';
          if (!installAction) this.emitToolStarted(action as ToolAction, stepId, toolCallId, this.lastLlmRequestId);

          // ── EXECUTE ──────────────────────────────────────────────────────────
          const policyAudit: PolicyAuditRecord[] = [];
          state.approvalGrants = this.config.approvalGrantProvider();
          const toolStartedAt = Date.now();
          const observation = await trace.measure(
            'step.execute_tool',
            () => this.config.runtime.executeToolAction(
              action as ToolAction,
              this.toolRegistry,
              this.runSignal,
              {
                taskAnalysis: state.taskAnalysis,
                priorSteps: state.steps,
                workspace: state.workspace,
                runId: this.config.runId,
                runScopedWorkspaceCapability: this.config.runScopedWorkspaceCapability,
                continuationHandoff: state.continuationHandoff,
                evidenceStartStep: state.evidenceStartStep,
                policy: { approvalGrants: state.approvalGrants },
                policyAudit,
                onAuthorized: installAction ? (authorizedAction) => this.emitToolStarted(authorizedAction, stepId, toolCallId, this.lastLlmRequestId) : undefined,
                onActionNormalized: (normalizedAction) => {
                  action = { ...action, action_input: normalizedAction.action_input } as typeof action;
                },
                useTransactionalEdits: true,
                dirtyTreeBaseline: state.dirtyTreeBaseline,
                toolEvidenceLedger: this.toolEvidenceLedger,
                onEvent: (event) => this.emitEvent(event),
                stepSeq: state.current_step + 1,
                toolExecutionState: this.toolExecutionState,
                toolScheduler: this.toolScheduler,
                scope: this.capabilityScope,
                toolCallId,
                planApproval: state.planApproval,
                pacingProfile: this.config.pacingProfile,
                modelContextWindow: this.config.contextWindow || undefined,
              }
            ),
            { step: state.current_step + 1, tool: action.action }
          );
          for (const decision of policyAudit) this.emitEvent({ type: 'policy_decision', decision });
          state.toolEvidence = this.toolEvidenceLedger.list();
          const latestToolEvidence = state.toolEvidence[state.toolEvidence.length - 1];
          if (latestToolEvidence) this.emitEvent({ type: 'tool_evidence', record: latestToolEvidence });
          trace.incrementCounter('tool_observation_chars', observation.length);
          const compactionMetrics = getObservationCompactionMetrics(observation);
          if (compactionMetrics) {
            trace.incrementCounter('tool_observation_original_chars', compactionMetrics.originalCharacters);
            trace.incrementCounter('tool_observation_retained_chars', compactionMetrics.retainedCharacters);
            trace.incrementCounter('tool_observation_saved_chars', compactionMetrics.savedCharacters);
            if (compactionMetrics.compacted) trace.incrementCounter('tool_observation_compactions');
            this.executionLogger?.logMetric(
              'tool_observation_saved_chars',
              compactionMetrics.savedCharacters,
              'characters',
              {
                compactorKind: compactionMetrics.kind,
                rawArtifactPersisted: compactionMetrics.rawArtifactPersisted,
                reductionPercentage: compactionMetrics.reductionPercentage,
              },
            );
          }
          if (isSuccessfulToolObservation(observation)) {
            trace.incrementCounter('successful_tool_ms', Date.now() - toolStartedAt);
            trace.incrementCounter('successful_tool_count');
          }
          if (action.action === 'Read' && isSuccessfulToolObservation(observation)) {
            const filePath = this.getActionFilePath(action as ToolAction);
            const wasRead = state.steps.some((step) => step.action === 'Read' &&
              this.getActionFilePath(step as ToolAction) === filePath && isSuccessfulToolObservation(step.observation || ''));
            if (wasRead) trace.incrementCounter('repeated_reads');
          }
          if ((mutationRecoveryInspection || state.forceReadNextAction) && (action.action === 'Read' || action.action === 'DocumentRead') && !isSuccessfulToolObservation(observation)) {
            // A failed mutation gets one targeted read so a stale preimage can
            // be refreshed before retrying. If that read also fails (for
            // example, the target is absent), keep the model from being
            // forced into the same impossible read on every turn. The next
            // planner turn can use the read diagnostic to choose another
            // valid target, create an approved target, or ask for clarification.
            const recoveryTarget = state.forceReadTarget;
            state.forceReadNextAction = false;
            state.forceReadTarget = undefined;
            if (recoveryTarget) {
              this.config.onProgress(
                `Recovery Read failed for ${recoveryTarget}; released the forced-read recovery so the next action can use the diagnostic.`,
              );
            }
          }
          if ((action.action === 'Read' || action.action === 'DocumentRead') && isSuccessfulToolObservation(observation) && state.forceReadTarget) {
            const readPath = this.getActionFilePath(action as ToolAction)?.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
            const targetPath = state.forceReadTarget.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
            if (readPath === targetPath) {
              state.forceReadNextAction = false;
              state.forceReadTarget = undefined;
            }
          }
          if (action.action === 'AskUserQuestion' && isSuccessfulToolObservation(observation)) {
            const question = typeof action.action_input?.question === 'string' ? action.action_input.question : '';
            try {
              const parsed = JSON.parse(observation) as { answer?: unknown; output?: unknown; selectedOption?: unknown };
              const answer = typeof parsed.answer === 'string'
                ? parsed.answer
                : typeof parsed.selectedOption === 'string'
                  ? parsed.selectedOption
                  : typeof parsed.output === 'string' ? parsed.output : '';
              recordAnsweredUserQuestion(state, question, answer);
              if (answer.trim()) {
                state.conversationUpdates = [
                  ...(state.conversationUpdates || []),
                  `Clarification received for "${question.trim().slice(0, 240)}": ${answer.trim().slice(0, 1_000)}`,
                ].slice(-20);
              }
            } catch {
              // Keep the successful tool result in the step history if the
              // question response uses a legacy non-JSON shape.
            }
          }
          if (MUTATION_ACTIONS.has(action.action) && isSuccessfulToolObservation(observation)) {
            state.forceMutationNextAction = false;
            state.forceMutationTarget = undefined;
          }
          const actionSignature = `${action.action}:${JSON.stringify(action.action_input || {})}`;
          if (state.steps.some((step) => `${step.action}:${JSON.stringify(step.action_input || {})}` === actionSignature)) {
            trace.incrementCounter('repeated_action_signatures');
          }
          if ((action.action === 'Write' || action.action === 'Edit') && isSuccessfulToolObservation(observation) &&
            !state.steps.some((step) => (step.action === 'Write' || step.action === 'Edit') && isSuccessfulToolObservation(step.observation || ''))) {
            trace.incrementCounter('time_to_first_mutation_ms', Math.max(0, Date.now() - this.activeRunStartedAt));
          }
          if (isSuccessfulToolObservation(observation) && state.uncertainToolCalls?.length) {
            state.uncertainToolCalls = state.uncertainToolCalls.filter((call) =>
              !isFreshUncertaintyEvidence(action as ToolAction, call)
            );
          }
          this.emitToolResult(action as ToolAction, observation, stepId, toolCallId, this.lastLlmRequestId, latestToolEvidence?.id);
          const completedDecisionRecord = completeAgentDecisionRecord(decisionRecord, {
            status: isSuccessfulToolObservation(observation) ? 'success' : 'failure',
            summary: observation,
          }, {
            action: {
              action: action.action,
              action_input: action.action_input,
            },
            observation,
            ...(latestToolEvidence ? {
              toolEvidence: {
                id: latestToolEvidence.id,
                status: latestToolEvidence.status,
                input: latestToolEvidence.input,
                output: latestToolEvidence.output,
              },
            } : {}),
          });
          this.emitEvent({ type: 'decision_record', record: completedDecisionRecord });
          this.log(`[Result] ${formatTerminalObservation(observation)} | tool ${formatElapsed(Date.now() - toolStartedAt)}`);

          const stepEndTime = Date.now();
          const timeCost = calculateTimeCost(stepEndTime - stepStartTime);
          const stepCost = this.estimatedStepCost + timeCost;
          state.total_pollen_cost += stepCost;
          this.capabilityScope.recordCost(stepCost);

          // Log step metrics
          const stepMetrics = {
            startTime: stepStartTime,
            endTime: stepEndTime,
            duration: stepEndTime - stepStartTime,
            cost: stepCost,
            success: isSuccessfulToolObservation(observation),
          };
          this.executionLogger?.endStep(observation.substring(0, 500), stepMetrics);

          const presentationDelayMs = isSuccessfulToolObservation(observation)
            ? getToolPresentationDelayMs(
              this.config.pacingProfile,
              action.action,
              this.config.runtime.getExecutionProfilePreset(this.config.pacingProfile),
            )
            : 0;
          if (presentationDelayMs > 0) {
            const filePath = this.getActionFilePath(action as ToolAction) || 'the active file';
            const activity = action.action === 'Write' || action.action === 'Edit' ? 'typing' : 'reading';
            const message = `Showing ${activity} progress for ${filePath} before the next model request.`;
            this.emitEvent({
              type: 'pacing_wait',
              profile: this.config.pacingProfile,
              delayMs: presentationDelayMs,
              message,
              scope: 'presentation',
            });
            await waitForPacing(presentationDelayMs, this.runSignal);
          }

          // Check budget
          if (!validateBudget(state.total_pollen_cost, state.budget)) {
            return this.handleBudgetExceeded(state);
          }

          // Record step
          const step: ReactStep = {
            thought: providerReasoningSummary || (action as typeof action & { rationale?: string }).rationale || agentMessage,
            action: action.action,
            action_input: action.action_input,
            observation,
            is_done: false,
            pollenCost: stepCost,
            // Phase 4: Timing metrics
            startTime: stepStartTime,
            endTime: stepEndTime,
            durationMs: stepEndTime - stepStartTime,
            ...(decisionMetadata ? { decision: decisionMetadata } : {}),
            decisionRecord: completedDecisionRecord,
          };

          const stepValidation = validateReactStep(step);
          if (!stepValidation.success && this.config.debug) {
            this.config.runtime.writeHostLog?.('warn', 'Action validation warnings:', stepValidation.errors);
          }

          addStep(state, step);
          if ((action.action === 'Write' || action.action === 'Edit') && isSuccessfulToolObservation(observation)) {
            armMissingCreatedFileRecovery(state, this.workspacePathResolver);
          }
          resetRecoveryBudgetAfterProgress(state, step);
          if (advancePlan(state, step)) {
            this.emitTodoProjection(state, true);
          }
          applyScopedVerificationRepair(
            state,
            step,
            this.workspacePathResolver,
            (serialized) => this.config.runtime.hashRequestPayload(serialized),
          );
          if (isWorkspaceBoundaryFailure(observation)) {
            // A stale absolute path or workspace escape cannot be repaired by
            // rereading the same target. Stop before the normal failed-mutation
            // recovery arms another inspection and retries the rejected path.
            state.forceReadNextAction = false;
            state.forceReadTarget = undefined;
            state.forceMutationNextAction = false;
            state.forceMutationTarget = undefined;
            state.codingState = 'blocked';
            state.blockedReason = [
              'The requested path is outside the active workspace, so the action was stopped without retrying it.',
              formatTerminalObservation(observation),
              `Active workspace: ${state.workspace || 'unknown'}. Use a path inside this workspace or change the selected workspace, then resume.`,
            ].join(' ');
            this.config.onProgress(state.blockedReason);
            if (this.config.onStateUpdate) this.config.onStateUpdate(getStateSnapshot(state));
            this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
            return await this.handleBlockedState(state);
          }
          const readFailureRecovery = getLatestReadFailureDetails(state);
          if (state.codingState === 'blocked' &&
            readFailureRecovery?.canRecoverAsMutation &&
            requiresSourceMutation(state)) {
            // The repeated-failure circuit breaker has enough evidence to
            // identify a missing scoped target or a local app asset referenced
            // by inspected HTML. Preserve the diagnostic and give the agent
            // one explicit mutation-only recovery turn instead.
            armMutationRecovery(state);
            if (readFailureRecovery.recoveryTarget) {
              state.forceMutationTarget = readFailureRecovery.recoveryTarget;
            }
            state.codingState = 'implement';
            state.blockedReason = undefined;
            state.noProgressCount = Math.max(state.noProgressCount || 0, 4);
            this.config.onProgress(
              `Repeated Read failure for ${readFailureRecovery.target || 'the requested target'}: ${readFailureRecovery.failureText}. ${readFailureRecovery.guidance} Forcing one Write/Edit recovery turn.`,
            );
            if (this.config.onStateUpdate) this.config.onStateUpdate(getStateSnapshot(state));
            this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
            continue;
          }
          const decisionEvidenceMismatch = completedDecisionRecord.status === 'invalidated';
          state.consecutiveDecisionMismatchCount = decisionEvidenceMismatch
            ? (state.consecutiveDecisionMismatchCount || 0) + 1
            : 0;
          const mismatchLimitReached = decisionEvidenceMismatch && (state.consecutiveDecisionMismatchCount || 0) >= 3;
          const stepRecoveryReason: RecoveryReason | undefined = decisionEvidenceMismatch
            ? 'decision_evidence_mismatch'
            : !isSuccessfulToolObservation(observation)
              ? action.action === 'Write' || action.action === 'Edit'
                ? 'failed_mutation'
                : isVerificationAction(action.action, action.action_input)
                  ? 'failed_verification'
                  : undefined
              : undefined;
          if (stepRecoveryReason === 'failed_verification') {
            // Verification can expose that a declared output is still absent.
            // Keep the run in implementation until every required create
            // target has successful mutation evidence.
            const armedCreatedFileRecovery = armMissingCreatedFileRecovery(state, this.workspacePathResolver);
            const sourceEvidenceGateFailure = /Verification rejected: successful source mutation evidence|Cannot enter verify: successful source mutation evidence/i
              .test(formatTerminalObservation(observation));
            if (!armedCreatedFileRecovery && sourceEvidenceGateFailure &&
                requiresSourceMutation(state) && !hasSuccessfulSourceMutation(state) &&
                !hasBaselineVerificationEvidence(state)) {
              const target = getUninspectedBaselineVerificationTargets(state)[0];
              if (target) {
                state.forceMutationNextAction = false;
                state.forceMutationTarget = undefined;
                state.forceReadNextAction = true;
                state.forceReadTarget = target;
              }
            }
          }
          const isMutation = action.action === 'Write' || action.action === 'Edit' || action.action === 'ReplaceFile';
          if (isMutation) {
            const mutationTarget = this.getActionFilePath(action as ToolAction);
            if (!isSuccessfulToolObservation(observation) && isHashConflictOrStalePreimageError(observation)) {
              trackMutationFailure(state, mutationTarget, true);
              if (isEditStagnated(state)) {
                state.codingState = 'blocked';
                state.blockedReason = `Edit stagnation: ${state.consecutiveEditFailureCount} consecutive hash-conflict or stale preimage failures on "${mutationTarget || 'the target file'}". The file was modified or diverged from expected content. Read the latest version before resuming, or verify whether the intended changes are already present.`;
                this.config.onProgress(`⚠️ ${state.blockedReason}`);
                if (this.config.onStateUpdate) this.config.onStateUpdate(getStateSnapshot(state));
                this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
                return await this.handleBlockedState(state);
              }
            } else if (isSuccessfulToolObservation(observation)) {
              trackMutationFailure(state, undefined, false);
            }
          }

          if (!isSuccessfulToolObservation(observation) && (action.action === 'Write' || action.action === 'Edit') &&
            !isReadOnlySourceDocumentMutation(action as ToolAction)) {
            const failedTarget = this.getActionFilePath(action as ToolAction);
            if (failedTarget) {
              state.forceReadNextAction = true;
              state.forceReadTarget = failedTarget;
            }
          } else if (!isSuccessfulToolObservation(observation) && isReadOnlySourceDocumentMutation(action as ToolAction)) {
            // A PDF/DOCX is source evidence, never a mutation preimage. Do
            // not force a second read of it or carry it into mutation repair.
            state.forceReadNextAction = false;
            state.forceReadTarget = undefined;
            state.forceMutationNextAction = true;
            state.forceMutationTarget ||= mutationRecoveryTarget(state);
          }
          if (stepRecoveryReason && state.codingState !== 'blocked') {
            this.transitionToRecovery(
              state,
              stepRecoveryReason,
              mismatchLimitReached
                ? 'The same evidence mismatch repeated three times without a trusted correction.'
                : formatTerminalObservation(observation),
              mismatchLimitReached ? 'blocked' : undefined,
              decisionEvidenceMismatch ? decisionRecord.id : undefined,
            );
          }
          if (state.codingState === 'blocked') {
            return await this.handleBlockedState(state);
          }
          if (state.noProgressCount && state.noProgressCount >= 4 && requiresSourceMutation(state) &&
              !hasBaselineVerificationEvidence(state)) {
            if (state.taskAnalysis?.approvalPolicy === 'ask' && !hasMutationApprovalGrant(state)) {
              state.codingState = 'blocked';
              state.blockedReason = 'Mutation approval is required before the next Write or Edit action. Grant the requested write scope, then resume this run.';
              this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
              return await this.handleBlockedState(state);
            }
            // Make the no-progress boundary durable. Previously this only
            // emitted advisory text, so a model that ignored the instruction
            // could continue reading until the coding-state budget expired.
            armMutationRecovery(state);
            state.codingState = 'implement';
            state.blockedReason = undefined;
            this.config.onProgress('No-progress limit reached; the next action is restricted to Write or Edit.');
            if (this.config.onStateUpdate) this.config.onStateUpdate(getStateSnapshot(state));
            this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
          }
          // Distinct reads are useful discovery, even after eight actions.
          // Stop only when the trailing inspection window contains a genuinely
          // repeated probe and no known mutation target remains unread.
          const continuousRunCircuitOpen = shouldTripContinuousRunNoProgressCircuit(
            state,
            this.config.continuousRun === true,
          );
          const boundedMutationLoopOpen = !this.config.continuousRun &&
            (state.noProgressCount || 0) >= 8 &&
            requiresSourceMutation(state) &&
            !hasBaselineVerificationEvidence(state) &&
            !state.forceMutationNextAction &&
            !hasUninspectedKnownMutationTargets(state) &&
            shouldTripContinuousRunNoProgressCircuit(state, true);
          if (continuousRunCircuitOpen || boundedMutationLoopOpen) {
            state.codingState = 'blocked';
            state.blockedReason = continuousRunCircuitOpen
              ? 'Continuous run paused after repeated identical probes without measurable progress. Review the last probe results, then resume with a narrower monitoring target.'
              : 'Run blocked after a repeated inspection loop without a Write or Edit action. Review the task scope or resume with a specific implementation target.';
            this.config.onProgress(state.blockedReason);
            this.config.onStateUpdate?.(getStateSnapshot(state));
            this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
            return await this.handleBlockedState(state);
          }
          if (isCodingStateBudgetExceeded(state)) {
            this.config.onProgress(`State budget reached for ${state.codingState || 'understand'}; requesting recovery transition.`);
          }
          if (isCodingStateTimeBudgetExceeded(state)) {
            this.config.onProgress(`State time budget reached for ${state.codingState || 'understand'}; requesting recovery transition.`);
          }
          const stateBudgetReached = !this.config.continuousRun &&
            (isCodingStateBudgetExceeded(state) || isCodingStateTimeBudgetExceeded(state));
          if (stateBudgetReached && requiresSourceMutation(state) &&
              !hasSuccessfulSourceMutation(state) && !hasBaselineVerificationEvidence(state)) {
            // A state-budget recovery must start in the same mutation-only
            // mode as the no-progress guard. Otherwise recovery resets the
            // coding-state clock but leaves the model free to repeat Read.
            armMutationRecovery(state);
            if (this.recoveryAttemptsForReason(state, 'missing_mutation_evidence') < 3) {
              this.transitionToRecovery(
                state,
                'missing_mutation_evidence',
                'The current execution state exhausted its budget before any source mutation succeeded. Resume from implementation instead of repeating inspection.',
              );
              continue;
            }
            state.codingState = 'blocked';
            state.blockedReason = 'Execution state budget exhausted before a source mutation succeeded. Resume with a scoped Write or Edit action.';
            this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
            return await this.handleBlockedState(state);
          }
          if (this.config.onStateUpdate) this.config.onStateUpdate(getStateSnapshot(state));
          this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
          // Check if done
          const isDone = await trace.measure('step.check_done', () => checkIfDone(state, this.llm, {
            model: this.config.model,
            plannerModel: this.config.plannerModel,
            requestTimeoutMs: this.config.llmRequestTimeoutMs,
            signal: this.runSignal,
            stepId,
            requestKind: 'step.check_done',
            onLlmTelemetry: (telemetry) => this.recordLlmTelemetry(telemetry),
            verbose: this.config.verbose,
            thinkingDepth: this.config.thinkingDepth,
            contextAssembly: this.capabilityScope.cordisServices.contextAssembly,
          }), { step: state.current_step });

          // The model's completion response is advisory only. Finalization
          // requires objective mutation and verification evidence.
          if (isDone) {
            if (hasCompletionEvidence(state)) {
              const completion = await this.handleCompletion(state);
              if (completion) return completion;
              // A completion gate failure was converted into an engine-owned
              // recovery transition. Continue from the preserved checkpoint.
              continue;
            }
            const reason = completionRecoveryReason(state, this.workspacePathResolver);
            if (this.recoveryAttemptsForReason(state, reason) < 3) {
              this.transitionToRecovery(state, reason, 'The model indicated completion before the required evidence gates passed.');
              continue;
            }
          }
          if (isDone && this.config.debug) {
            this.log('Completion suggestion rejected: required implementation/verification evidence is missing.');
          }
        } catch (stepError: any) {
          const stepErrorMessage = stepError?.message || String(stepError);
          if (
            this.config.onSubtaskDispatch &&
            !state.subtaskDispatch &&
            /context[_\s-]*(?:length|window|overflow)|(?:maximum|max(?:imum)?|exceed(?:ed|s)?)\s+(?:input\s+)?tokens|too many tokens|prompt too long|(?:prompt|input).{0,40}(?:too large|too long)/i.test(stepErrorMessage)
          ) {
            const dispatched = await this.dispatchSubtasks(state, 'context_overflow');
            if (dispatched) continue;
          }
          const recoverableProviderFailure = this.isRecoverableProviderAvailabilityError(stepErrorMessage);
          if (!this.isCancelledError(stepError)) {
            this.log(recoverableProviderFailure
              ? `⏳ Provider unavailable; the action checkpoint is saved and recovery is in progress: ${stepErrorMessage}`
              : `⚠️ Action failed: ${stepErrorMessage}`);
          }
          if (isForcedMutationSelectionError(stepErrorMessage)) {
            armMutationRecovery(state);
            const target = state.forceMutationTarget;
            const directive = `The model could not produce a valid Write or Edit action after repeated inspection. Resume with a scoped Write or Edit action.${target ? ` Target: ${target}.` : ''}`;
            if (this.recoveryAttemptsForReason(state, 'missing_mutation_evidence') < 3) {
              const guardStep: ReactStep = {
                thought: directive,
                action: 'ReplayGuard',
                action_input: {
                  attempted_action: 'plan_action',
                  target,
                  error: stepErrorMessage,
                },
                observation: JSON.stringify({
                  success: false,
                  skipped: true,
                  error: directive,
                  directive: `Harness direction: You must produce a Write or Edit action for ${target || 'the target file'}. Do not repeat inspection tools (Read, Glob, Grep, Command, Bash).`,
                }),
                is_done: false,
                pollenCost: this.estimatedStepCost,
                startTime: stepStartTime,
                endTime: Date.now(),
                durationMs: Date.now() - stepStartTime,
              };
              addStep(state, guardStep);
              state.codingState = 'implement';
              state.blockedReason = undefined;
              this.transitionToRecovery(state, 'missing_mutation_evidence', directive, 'implement');
              this.config.onProgress(`Directing agent to implementation: ${directive}`);
              continue;
            }
            state.codingState = 'blocked';
            state.blockedReason = directive;
            this.config.onProgress(state.blockedReason);
            if (this.config.onStateUpdate) this.config.onStateUpdate(getStateSnapshot(state));
            this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
            return await this.handleBlockedState(state);
          }
          const invalidToolSelection = /(?:invalid .*tool selection|could not parse tool selection|missing tool name|tool selection)/i.test(stepErrorMessage);
          if (invalidToolSelection && this.recoveryAttemptsForReason(state, 'invalid_tool_selection') < 3) {
            if (activePlanKind(state) === 'verify' || state.codingState === 'verify') {
              const missingCreatedFileRecovery = armMissingCreatedFileRecovery(state, this.workspacePathResolver);
              if (!missingCreatedFileRecovery) {
                state.forceMutationNextAction = false;
                state.forceMutationTarget = undefined;
              }
            }
            this.transitionToRecovery(state, 'invalid_tool_selection', stepErrorMessage);
            continue;
          }
          throw stepError;
        }
      }

      if (this.isWallClockBudgetExceeded(state)) {
        return this.handleRunLimitExceeded(
          state,
          'RUN_WALL_CLOCK_LIMIT_EXCEEDED',
          'Run wall-clock budget reached. Progress was saved at a checkpoint; review it and continue when ready.',
          'The run exceeded its wall-clock budget. Review the saved checkpoint before continuing.',
        );
      }
      if (hasCompletionEvidence(state)) {
        if (this.config.onProgress) {
          this.config.onProgress('Autonomous turn checkpoint reached after successful verification; finalizing run.');
        }
        const completion = await this.handleCompletion(state);
        if (completion) return completion;
      }

      if ((state.globalStepCount || 0) >= (state.globalStepLimit || this.config.globalStepLimit)) {
        return this.handleRunLimitExceeded(
          state,
          'GLOBAL_STEP_LIMIT_EXCEEDED',
          'Global action-step budget reached. Progress was saved at a checkpoint; review it and continue when ready.',
          'The run reached its total action-step limit. Review the saved checkpoint before continuing.',
        );
      }

      return this.handleMaxStepsExceeded(state);
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      if (this.isCancelledError(error)) {
        this.emitEvent({ type: 'stopped', message: 'Run stopped by user.' });
        const performanceTrace = this.finishPerformanceTrace(state, false);
        await this.persistRunAudit(
          state.task,
          this.config.model,
          state.budget,
          false,
          state.steps,
          state.total_pollen_cost,
          undefined,
          'Run stopped by user.',
          performanceTrace,
          this.buildAuditOptions('cancelled', state.total_pollen_cost, state.steps.length)
        );
        return {
          success: false,
          error: 'Run stopped by user.',
          errorCode: 'USER_STOPPED',
          recoverable: true,
          plan: state.plan,
          steps: state.steps,
          stepCount: state.current_step,
          pollenCost: state.total_pollen_cost,
          performanceTrace,
        };
      }
      if (this.isTaskRequestBudgetReachedError(errorMessage)) {
        return await this.handleTaskRequestBudgetReached(state, errorMessage);
      }
      // Provider failures can be recovered by ServerRunManager. Persist the
      // state at the failure boundary so an internal retry retains the LLM
      // request that just failed, completed inspection evidence, and planner
      // state instead of replaying the run from its original request body.
      if (this.isRecoverableProviderAvailabilityError(errorMessage)) {
        this.transitionToRecovery(state, 'provider_failure', errorMessage);
        this.emitEvent({ type: 'provider_attempt_failed', message: errorMessage, recoverable: true, errorCode: 'PROVIDER_UNAVAILABLE' });
      } else {
        if (this.config.onStateUpdate) this.config.onStateUpdate(getStateSnapshot(state));
        this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
        this.emitEvent({ type: 'error', message: errorMessage });
      }
      this.executionLogger?.logError('ReAct execution failed', error, {
        step: state.current_step,
        totalCost: state.total_pollen_cost,
      });
      await this.endStructuredRequest(false, errorMessage);

      const performanceTrace = this.finishPerformanceTrace(state, false);
      const isRateLimitPause = this.isRecoverableProviderAvailabilityError(errorMessage);
      const isCancelled = Boolean(this.runSignal?.aborted);
      const outcomeKind: OutcomeKind = isCancelled
        ? 'cancelled'
        : isRateLimitPause
          ? 'checkpoint_rate_limit'
          : 'fatal_error';

      await this.persistRunAudit(
        state.task,
        this.config.model,
        state.budget,
        false,
        state.steps,
        state.total_pollen_cost,
        undefined,
        errorMessage,
        performanceTrace,
        this.buildAuditOptions(outcomeKind, state.total_pollen_cost, state.steps.length)
      );
      throw error;
    } finally {
      // Todo is run-scoped; do not leave a completed run mutable through a
      // retained tool reference or a later reuse of this engine instance.
      this.activeRunState = undefined;
      try {
        await this.releaseRunInvocation();
      } finally {
        this.activeTrace = previousTrace;
        this.cacheCounterBaseline = previousCacheCounterBaseline;
        this.traceStartedAt = previousTraceStartedAt;
      }
    }
  }

  private resumeRecoveryBudgetCheckpoint(state: ReactState): boolean {
    if (state.codingState !== 'blocked' || !/Run recovery budget reached after \d+ transitions?\b/i.test(state.blockedReason || '')) {
      return false;
    }

    state.codingState = 'repair';
    state.codingStateStartedStep = state.current_step;
    state.codingStateStartedAt = Date.now();
    state.recoveryWindowCount = 0;
    state.blockedReason = undefined;
    state.outcome = undefined;

    const nextSharedState = sharedStateForCodingState(state);
    const previousSharedState = state.sharedState;
    if (previousSharedState && previousSharedState !== nextSharedState && canTransition(previousSharedState, nextSharedState)) {
      const transition = transitionRun(previousSharedState, nextSharedState, 'recovery_budget_checkpoint_resumed', [{
        source: 'recovery',
        references: [`step:${state.current_step}`],
        summary: 'Resuming the saved task after a recovery-window checkpoint.',
      }]);
      state.sharedState = nextSharedState;
      state.sharedTransitions = [...(state.sharedTransitions || []), transition].slice(-100);
      this.emitEvent({ type: 'state_transition', transition });
    } else {
      state.sharedState = nextSharedState;
    }

    this.config.onProgress('Resuming the saved task in repair state with a fresh recovery window.');
    this.config.onStateUpdate(getStateSnapshot(state));
    this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
    return true;
  }

  private transitionToRecovery(
    state: ReactState,
    reason: RecoveryReason,
    detail?: string,
    targetState?: ReactState['codingState'],
    decisionId?: string,
  ): RecoveryRecord {
    if (this.isRecoveryBudgetExceeded(state)) {
      const exhaustedWindow = state.recoveryWindowCount ?? state.recoveryCount ?? 0;
      state.recoveryWindowCount = 0;
      this.config.onProgress(
        `Recovery window reached ${exhaustedWindow} transitions; the checkpoint is preserved and work is continuing in a fresh recovery window.`,
      );
    }
    const record = startRecovery(state, reason, recoveryMessage(reason, detail), targetState, decisionId);
    this.syncSharedState(state, `recovery:${reason}`, [{
      source: 'recovery',
      references: [`step:${state.current_step}`],
      summary: record.message,
    }]);
    this.emitEvent({
      type: 'recovery_transition',
      reason: record.reason,
      from: record.from,
      to: record.to,
      attempt: record.attempt,
      message: record.message,
      evidence: record.evidence,
      ...(record.decisionId ? { decisionId: record.decisionId } : {}),
    });
    this.config.onProgress(`Recovery: ${record.reason} -> ${record.to}`);
    this.config.onStateUpdate(getStateSnapshot(state));
    this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
    return record;
  }

  private isWallClockBudgetExceeded(state: ReactState, now = Date.now()): boolean {
    const startedAt = Number(state.runStartedAt) || this.activeRunStartedAt;
    const budgetMs = Number(state.wallClockBudgetMs) || this.config.wallClockBudgetMs;
    return budgetMs > 0 && now - startedAt >= budgetMs;
  }

  private isRecoveryBudgetExceeded(state: ReactState): boolean {
    const limit = Number(state.maxRecoveryTransitions) || this.config.maxRecoveryTransitions;
    return (state.recoveryWindowCount ?? state.recoveryCount ?? 0) >= limit;
  }

  private syncSharedState(state: ReactState, reason: string, evidence: TransitionEvidence[] = []): void {
    const next = sharedStateForCodingState(state);
    const previous = state.sharedState || next;
    if (previous === next) return;
    if (!canTransition(previous, next)) return;
    const transition = transitionRun(
      previous,
      next,
      reason,
      evidence.length ? evidence : [{ source: 'react_state', references: [`step:${state.current_step}`] }],
    );
    state.sharedState = next;
    state.sharedTransitions = [...(state.sharedTransitions || []), transition].slice(-100);
    this.emitEvent({ type: 'state_transition', transition });
  }

  private recoveryAttemptsForReason(state: ReactState, reason: RecoveryReason): number {
    return (state.recoveryHistory || []).filter((record) => record.reason === reason).length;
  }

  private isRecoverableProviderAvailabilityError(message: string): boolean {
    return isRecoverableReActProviderAvailabilityError(message);
  }

  private isTaskRequestBudgetReachedError(message: string): boolean {
    return /^Task LLM request budget reached \(\d+\/\d+\)\./i.test(message);
  }

  private async handleTaskRequestBudgetReached(state: ReactState, error: string): Promise<ReactResult> {
    if (this.config.onStateUpdate) this.config.onStateUpdate(getStateSnapshot(state));
    this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
    const result: ReactResult = {
      success: false,
      error,
      errorCode: 'TASK_LLM_REQUEST_BUDGET_REACHED',
      recoverable: true,
      suggestedNextAction:
        'After explicit user approval, continue from the durable last-run marker with a fresh request allowance.',
      appSpec: state.appSpec,
      plan: state.plan,
      steps: state.steps,
      stepCount: state.current_step,
      pollenCost: state.total_pollen_cost,
      resumeState: state,
      outcome: 'incomplete',
    };
    await this.endStructuredRequest(false, error);
    result.performanceTrace = this.finishPerformanceTrace(state, false);
    await this.persistRunAudit(
      state.task,
      this.config.model,
      state.budget,
      false,
      state.steps,
      state.total_pollen_cost,
      undefined,
      error,
      result.performanceTrace,
      this.buildAuditOptions('checkpoint_turn_limit', state.total_pollen_cost, state.steps.length)
    );
    this.emitEvent({ type: 'stopped', message: error });
    return result;
  }

  private async handlePhaseCompleted(state: ReactState, phaseIndex: number): Promise<ReactResult> {
    const completedPhase = state.plan[phaseIndex]?.step || `Phase ${phaseIndex + 1}`;
    const nextPhase = state.plan.find((item, index) => index > phaseIndex && item.status !== 'completed')?.step;
    const finalAnswer = nextPhase
      ? `Phase completed and verified: ${completedPhase}.\n\nNext phase: ${nextPhase}\n\nThe remaining TODO plan is saved. This run stopped at the Free - one TODO phase boundary. Test this phase, then use Continue when you are ready.`
      : `Phase completed and verified: ${completedPhase}.\n\nThis run stopped at the Free - one TODO phase boundary. Test the completed phase before starting or continuing more work.`;
    const phaseResult: ReactResult = {
      success: true,
      finalAnswer,
      result: finalAnswer,
      errorCode: 'PHASE_COMPLETED',
      recoverable: true,
      suggestedNextAction: 'Test the completed phase, then continue from the preserved checkpoint.',
      appSpec: state.appSpec,
      plan: state.plan,
      steps: state.steps,
      stepCount: state.current_step,
      pollenCost: state.total_pollen_cost,
      resumeState: state,
    };

    await this.endStructuredRequest(true);
    phaseResult.performanceTrace = this.finishPerformanceTrace(state, true);
    await this.measureTrace('audit.record_run_result', () => this.persistRunAudit(
      state.task,
      this.config.model,
      state.budget,
      true,
      state.steps,
      state.total_pollen_cost,
      finalAnswer,
      undefined,
      phaseResult.performanceTrace,
      this.buildAuditOptions('completed', state.total_pollen_cost, state.steps.length)
    ));
    this.emitEvent({ type: 'final', message: finalAnswer });
    return phaseResult;
  }

  private async handleCompletion(state: ReactState): Promise<ReactResult | undefined> {
    const deterministicAnswer =
      getDeterministicInspectionAnswer(state) ||
      getDeterministicCoderCompletionAnswer(state, this.workspacePathResolver);
    const finalAnswer = deterministicAnswer
      ? await this.measureTrace('final_answer.deterministic', async () => deterministicAnswer)
      : await this.measureTrace('final_answer.synthesize', () => synthesizeAnswer(state, this.llm, {
          model: this.config.model,
          requestTimeoutMs: this.config.llmRequestTimeoutMs,
          signal: this.runSignal,
          requestKind: 'final_answer.synthesize',
          onLlmTelemetry: (telemetry) => this.recordLlmTelemetry(telemetry),
          verbose: this.config.verbose,
          thinkingDepth: this.config.thinkingDepth,
          contextAssembly: this.capabilityScope.cordisServices.contextAssembly,
        }));
    if (deterministicAnswer) this.activeTrace?.incrementCounter('deterministic_final_answers');

    const finalRoute = this.lastSuccessfulLlmRouteByKind.get('final_answer.synthesize');
    this.emitEvent({
      type: 'model_response',
      message: finalAnswer,
      provider: finalRoute?.provider || this.llm.getProviderName(),
      model: finalRoute?.model || this.config.model,
      step: state.current_step,
      phase: 'final',
      requestId: this.lastLlmRequestId,
    });

    const completionEvidenceFailure = getCompletionEvidenceFailure(state, finalAnswer, this.workspacePathResolver);
    if (completionEvidenceFailure) {
      const reason = completionRecoveryReason(state, this.workspacePathResolver);
      const missingCreatedFiles = missingCreatedFileDeliverables(state, this.workspacePathResolver);
      if (missingCreatedFiles.length > 0) {
        state.forceMutationNextAction = true;
        state.forceMutationTarget = missingCreatedFiles[0];
      }
      if (this.recoveryAttemptsForReason(state, reason) < 3) {
        this.transitionToRecovery(
          state,
          reason,
          completionEvidenceFailure,
          missingCreatedFiles.length > 0 ? 'implement' : undefined,
        );
        return undefined;
      }
      const failureResult: ReactResult = {
        success: false,
        finalAnswer,
        result: finalAnswer,
        error: completionEvidenceFailure,
        errorCode: 'EXECUTION_ERROR',
        recoverable: true,
        suggestedNextAction: 'Retry from the failed mutation, inspect the target file, and only report changes after a successful Write/Edit observation.',
        appSpec: state.appSpec,
        plan: state.plan,
        steps: state.steps,
        stepCount: state.current_step,
        pollenCost: state.total_pollen_cost,
        recoveryReason: reason,
        resumeState: state,
      };

      await this.endStructuredRequest(false, completionEvidenceFailure);
      failureResult.performanceTrace = this.finishPerformanceTrace(state, false);
      await this.measureTrace('audit.record_run_result', () => this.persistRunAudit(
        state.task,
        this.config.model,
        state.budget,
        false,
        state.steps,
        state.total_pollen_cost,
        finalAnswer,
        completionEvidenceFailure,
        failureResult.performanceTrace,
        this.buildAuditOptions('fatal_error', state.total_pollen_cost, state.steps.length)
      ));
      this.emitEvent({ type: 'error', message: completionEvidenceFailure });
      return failureResult;
    }

    const lastStep = state.steps[state.steps.length - 1];
    if (lastStep) {
      lastStep.is_done = true;
      lastStep.final_answer = finalAnswer;
    }

    // ──────────────────────────────────────────────────────────────────
    // Phase 3: Verify Generated Apps (if app spec is present)
    // ──────────────────────────────────────────────────────────────────
    let verificationResult: VerificationResult | undefined;
    let manifestId: string | undefined;
    let outputFiles: string[] | undefined;

    if (state.appSpec) {
      try {
        this.log('🔍 Verifying generated app...');
        if (this.config.onProgress) this.config.onProgress('Verifying generated app...');
        this.emitEvent({ type: 'verification_started', command: 'verify generated app' });

        // Try to discover output files from steps
        outputFiles = this.extractOutputFilesFromSteps(state.steps, state.workspace);
        const requiredOutputFiles = state.appSpec.outputMode === 'vanilla-web'
          ? [...new Set((state.taskAnalysis?.affectedFiles || [])
            .map((file) => file.path)
            .filter((file) => /\.(?:html?|css|(?:m|c)?js)$/i.test(file))
            .map((file) => {
              try { return this.workspacePathResolver(file, state.workspace); } catch { return ''; }
            })
            .filter(Boolean))]
          : [];

        // Create app manifest
        const manifest = createManifest(
          state.appSpec.appName,
          state.appSpec.appType,
          state.appSpec.outputMode,
          state.workspace,
          state.appSpec.entryPoint,
          outputFiles,
          state.appSpec.verificationChecks,
          requiredOutputFiles,
        );

        // Save manifest
        const manifestPath = await this.config.runtime.saveAppManifest?.(manifest, state.workspace);
        manifestId = manifest.id;
        this.log(manifestPath
          ? `📋 Manifest saved: ${manifestPath}`
          : '📋 Manifest storage is not configured; continuing with the in-memory manifest.');
        setAppManifestId(state, manifestId);

        // Run verification
        if (!this.config.runtime.verifyGeneratedApp) {
          throw new Error('Generated-app verification is not available in this host runtime.');
        }
        verificationResult = await this.config.runtime.verifyGeneratedApp(manifest, { screenshot: true }, state.appSpec);
        setVerificationResult(state, verificationResult);
        recordAppVerificationEvidence(state, verificationResult);

        // Phase 6: Log quality gate results
        if (verificationResult.qualityGates) {
          const { formatQualityGates } = await import('@barok/engine');
          this.log(formatQualityGates(verificationResult.qualityGates));
        }

        if (verificationResult.passed) {
          this.log(`✅ App verification passed! (${verificationResult.signals.filter((s) => s.passed).length}/${verificationResult.signals.length} signals)`);
          if (this.config.onProgress) this.config.onProgress('✅ App verification passed!');
          this.emitEvent({ type: 'verification_result', success: true, output: 'App verification passed.' });

          // Update manifest with verification results
          await this.config.runtime.updateAppManifestWithVerification?.(manifest, verificationResult, state.workspace);
        } else {
          this.log(`⚠️  App verification failed (${verificationResult.signals.filter((s) => s.passed).length}/${verificationResult.signals.length} signals passed)`);
          if (this.config.onProgress) this.config.onProgress(`⚠️  App verification failed`);
          this.emitEvent({ type: 'verification_result', success: false, output: 'App verification failed.' });

          // Analyze failures for potential repair
          const repairPlan = analyzeFailures(verificationResult);
          this.log(`🔧 Repair analysis: ${repairPlan.summary}`);

          // Check if we should attempt repair
          if (
            shouldRepair(verificationResult, 2) &&
            state.repairAttempts < 2 &&
            repairPlan.canRepair
          ) {
            this.log(`🔄 Attempting repair (attempt ${state.repairAttempts + 1}/2)...`);
            if (this.config.onProgress) this.config.onProgress('Attempting repair...');

            incrementRepairAttempts(state);

            const repairFiles = await this.config.runtime.discoverVerificationRepairFiles?.(manifest) || [];
            const repairTaskAnalysis = this.config.runtime.extendTaskAnalysisForRepair?.(
              state.taskAnalysis,
              repairFiles,
            ) || state.taskAnalysis;
            if (repairTaskAnalysis && repairTaskAnalysis !== state.taskAnalysis) {
              state.taskAnalysis = repairTaskAnalysis;
              // The repair is a recursive run. Keep the expanded scope on the
              // config as well, because run() restores config.taskAnalysis at
              // every new run boundary.
              this.config.taskAnalysis = repairTaskAnalysis;
            }

            // Create repair task
            const repairTaskPrompt = createRepairTask(manifest, verificationResult, state.appSpec, repairFiles);

            // Preserve the append-only action history across the repair
            // boundary. The previous implementation discarded steps and the
            // plan here, which made the next model turn rebuild the app from
            // scratch and could repeat successful side effects. A repair gets
            // a fresh step window, while its completion evidence starts after
            // the failed verification tail.
            const repairState = prepareReactRepairState(state, {
              task: repairTaskPrompt,
              check: repairPlan.suggestions[0]?.check ||
                verificationResult.checks.find((check) => !check.passed)?.name ||
                'app verification',
              reason: repairPlan.summary,
              changedFiles: [
                ...collectMutationEvidence(getTaskEvidenceSteps(state), state.workspace, this.workspacePathResolver).filesChanged,
                ...repairFiles,
              ],
            });
            state.task = repairState.task;
            state.activeRepair = repairState.activeRepair;
            state.evidenceStartStep = repairState.evidenceStartStep;

            // Continue ReAct loop for repair
            return await this.run(repairTaskPrompt, repairState as unknown as Record<string, unknown>);
          }
        }
      } catch (verificationError) {
        this.log(`⚠️  Verification error: ${verificationError instanceof Error ? verificationError.message : String(verificationError)}`);
        // Don't fail the task due to verification errors; continue with partial success
      }
    }

    // Contract review runs after generated-app verification so browser and
    // runtime failures are part of the completion decision, rather than being
    // hidden behind an earlier missing-evidence response.
    const contractVerification = assessContractVerification(state, this.workspacePathResolver);
    if (contractVerification && (!contractVerification.review.approved || contractVerification.decision.status !== 'passed')) {
      const verificationFailure = formatContractVerificationFailure(contractVerification);
      if (this.recoveryAttemptsForReason(state, 'failed_verification') < 3) {
        this.transitionToRecovery(state, 'failed_verification', verificationFailure, 'repair');
        return undefined;
      }
      const failureResult: ReactResult = {
        success: false,
        executionCompleted: contractVerification.decision.status === 'failed',
        verificationStatus: contractVerification.decision.status,
        finalAnswer,
        result: finalAnswer,
        error: verificationFailure,
        errorCode: 'EXECUTION_ERROR',
        recoverable: true,
        suggestedNextAction: contractVerification.decision.status === 'blocked'
          ? 'Resolve the unavailable required verification before claiming completion.'
          : contractVerification.decision.status === 'incomplete' && contractVerification.hasPassedVerificationCommand
            ? 'Record or run evidence for the requested behavior, then rerun verification before claiming completion.'
            : 'Inspect the failed verification output and changed files, then make a scoped repair before retrying.',
        requirementEvidence: contractVerification.decision.requirements,
        reviewFindings: contractVerification.review.findings,
        appSpec: state.appSpec,
        plan: state.plan,
        steps: state.steps,
        stepCount: state.current_step,
        pollenCost: state.total_pollen_cost,
        recoveryReason: 'failed_verification',
        resumeState: state,
        outcome: contractVerification.decision.status === 'failed' ? 'completed' : 'incomplete',
      };
      if (contractVerification.decision.status === 'failed') {
        // The implementation is finished. Keep the failing test as an
        // auditable warning, but close the engine state and checkpoint so the
        // harness cannot leave completed work looking like an active repair.
        state.codingState = 'complete';
        state.blockedReason = undefined;
        state.outcome = 'completed';
        this.syncSharedState(state, 'implementation_completed_verification_failed', [{
          source: 'completion_gates',
          references: [`step:${state.current_step}`],
          summary: 'Implementation completed; verification reported a failure.',
        }]);
        this.config.onStateUpdate(getStateSnapshot(state));
        this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
      }
      await this.endStructuredRequest(false, verificationFailure);
      failureResult.performanceTrace = this.finishPerformanceTrace(state, false);
      this.emitEvent({ type: 'error', message: verificationFailure });
      return failureResult;
    }

    state.codingState = 'complete';
    state.blockedReason = undefined;
    this.syncSharedState(state, 'completion_gates_passed', [{
      source: 'completion_gates',
      references: [`step:${state.current_step}`],
      summary: 'Mutation, verification, and scope gates passed.',
    }]);
    state.outcome = 'completed';
    this.config.onStateUpdate(getStateSnapshot(state));
    this.config.onCheckpoint(createReactCheckpoint(state, this.config.runtime.fingerprintWorkspace));
    const successResult: ReactResult = {
      success: true,
      finalAnswer,
      result: finalAnswer,
      appSpec: state.appSpec,
      appManifestId: manifestId,
      outputFiles,
      verificationResult,
      requirementEvidence: contractVerification?.decision.requirements,
      reviewFindings: contractVerification?.review.findings,
      plan: state.plan,
      workPlan: state.workPlan,
      steps: state.steps,
      stepCount: state.current_step,
      pollenCost: state.total_pollen_cost,
      outcome: 'completed',
    };

    const resultValidation = validateReactResult(successResult);
    if (!resultValidation.success && this.config.debug) {
      this.config.runtime.writeHostLog?.('warn', 'Result validation warnings:', resultValidation.errors);
    }

    // ──────────────────────────────────────────────────────────────────
    // Phase 4: Log efficiency metrics and persist cache
    // ──────────────────────────────────────────────────────────────────
    try {
      const costSummary = getCostSummary();
      this.log(`\n${formatCostSummary(costSummary)}`);

      const cache = this.config.runtime.cache;
      if (cache) {
        this.log(`\n${cache.formatStats()}`);

        // Persist cache for the next run when the host supports it.
        await this.measureTrace('cache.persist', () => cache.persist(state.workspace));
        this.log(`✓ Cache persisted`);
      }
    } catch (efficiencyError) {
      this.log(`⚠️  Error recording efficiency metrics: ${efficiencyError instanceof Error ? efficiencyError.message : String(efficiencyError)}`);
    }

    await this.endStructuredRequest(true);

    successResult.performanceTrace = this.finishPerformanceTrace(state, true);
    await this.measureTrace('audit.record_run_result', () => this.persistRunAudit(
      state.task,
      this.config.model,
      state.budget,
      true,
      state.steps,
      state.total_pollen_cost,
      finalAnswer,
      undefined,
      successResult.performanceTrace,
      this.buildAuditOptions('completed', state.total_pollen_cost, state.steps.length)
    ));

    this.emitEvent({
      type: 'final',
      message: finalAnswer,
      filesChanged: this.extractOutputFilesFromSteps(state.steps, state.workspace),
      ...this.lastSuccessfulLlmRouteByKind.get('final_answer.synthesize'),
    });

    return successResult;
  }

  private async handleBudgetExceeded(state: ReactState): Promise<ReactResult> {
    const budgetStatus = getBudgetStatus(state.total_pollen_cost, state.budget);
    const budgetError = `Budget exceeded: spent ${budgetStatus.spent.toFixed(4)} pollen, limit ${formatBudget(state.budget)}`;

    const budgetResult: ReactResult = {
      success: false,
      error: budgetError,
      errorCode: 'BUDGET_EXCEEDED',
      recoverable: false,
      appSpec: state.appSpec,
      plan: state.plan,
      steps: state.steps,
      stepCount: state.current_step,
      pollenCost: state.total_pollen_cost,
    };

    const resultValidation = validateReactResult(budgetResult);
    if (!resultValidation.success && this.config.debug) {
      this.config.runtime.writeHostLog?.('warn', 'Result validation warnings:', resultValidation.errors);
    }

    await this.endStructuredRequest(false, budgetError);

    budgetResult.performanceTrace = this.finishPerformanceTrace(state, false);
    await this.measureTrace('audit.record_run_result', () => this.persistRunAudit(
      state.task,
      this.config.model,
      state.budget,
      false,
      state.steps,
      state.total_pollen_cost,
      undefined,
      budgetError,
      budgetResult.performanceTrace,
      this.buildAuditOptions('checkpoint_turn_limit', state.total_pollen_cost, state.steps.length)
    ));

    return budgetResult;
  }

  private async handleMaxStepsExceeded(state: ReactState): Promise<ReactResult> {
    const limitError = 'Turn limit reached. Progress was saved at a checkpoint; continue to resume the task.';
    const stepsExceededResult: ReactResult = {
      success: false,
      error: limitError,
      errorCode: 'MAX_STEPS_EXCEEDED',
      recoverable: true,
      suggestedNextAction:
        'Continue from the preserved state; the agent will choose the next useful action.',
      appSpec: state.appSpec,
      plan: state.plan,
      steps: state.steps,
      stepCount: state.current_step,
      pollenCost: state.total_pollen_cost,
    };

    const resultValidation = validateReactResult(stepsExceededResult);
    if (!resultValidation.success && this.config.debug) {
      this.config.runtime.writeHostLog?.('warn', 'Result validation warnings:', resultValidation.errors);
    }

    await this.endStructuredRequest(false, limitError);

    stepsExceededResult.performanceTrace = this.finishPerformanceTrace(state, false);
    await this.measureTrace('audit.record_run_result', () => this.persistRunAudit(
      state.task,
      this.config.model,
      state.budget,
      false,
      state.steps,
      state.total_pollen_cost,
      undefined,
      limitError,
      stepsExceededResult.performanceTrace,
      this.buildAuditOptions('checkpoint_turn_limit', state.total_pollen_cost, state.steps.length)
    ));

    return stepsExceededResult;
  }

  private async handleRunLimitExceeded(
    state: ReactState,
    errorCode: 'GLOBAL_STEP_LIMIT_EXCEEDED' | 'RUN_WALL_CLOCK_LIMIT_EXCEEDED',
    error: string,
    suggestedNextAction: string,
  ): Promise<ReactResult> {
    const result: ReactResult = {
      success: false,
      error,
      errorCode,
      recoverable: true,
      suggestedNextAction,
      appSpec: state.appSpec,
      plan: state.plan,
      steps: state.steps,
      stepCount: state.current_step,
      pollenCost: state.total_pollen_cost,
      resumeState: state,
    };
    const resultValidation = validateReactResult(result);
    if (!resultValidation.success && this.config.debug) {
      this.config.runtime.writeHostLog?.('warn', 'Result validation warnings:', resultValidation.errors);
    }
    await this.endStructuredRequest(false, error);
    result.performanceTrace = this.finishPerformanceTrace(state, false);
    await this.measureTrace('audit.record_run_result', () => this.persistRunAudit(
      state.task,
      this.config.model,
      state.budget,
      false,
      state.steps,
      state.total_pollen_cost,
      undefined,
      error,
      result.performanceTrace,
      this.buildAuditOptions('checkpoint_turn_limit', state.total_pollen_cost, state.steps.length),
    ));
    return result;
  }

  private async handleBlockedState(state: ReactState): Promise<ReactResult> {
    this.syncSharedState(state, 'blocked', [{
      source: 'blocked_state',
      references: [`step:${state.current_step}`],
      summary: state.blockedReason || 'Run blocked.',
    }]);
    state.outcome = 'blocked';
    const approvalRequest = getPendingApprovalRequest(state);
    const blockedError = approvalRequest
      ? `Approval required before continuing: ${approvalRequest.summary}`
      : `Run blocked: ${state.blockedReason || 'external confirmation or permission is required before continuing.'}`;
    const result: ReactResult = {
      success: false,
      error: blockedError,
      errorCode: approvalRequest ? 'APPROVAL_REQUIRED' : 'EXECUTION_ERROR',
      ...(approvalRequest ? { approvalRequest } : {}),
      recoverable: true,
      suggestedNextAction: approvalRequest
        ? 'Ask the user to approve or deny this exact action, then resume only if approved.'
        : 'Resolve the blocker, then resume from the preserved state and prior observations.',
      plan: state.plan,
      steps: state.steps,
      stepCount: state.current_step,
      pollenCost: state.total_pollen_cost,
      resumeState: state,
      outcome: 'blocked',
    };
    await this.endStructuredRequest(false, blockedError);
    result.performanceTrace = this.finishPerformanceTrace(state, false);
    await this.persistRunAudit(
      state.task,
      this.config.model,
      state.budget,
      false,
      state.steps,
      state.total_pollen_cost,
      undefined,
      blockedError,
      result.performanceTrace,
      this.buildAuditOptions('checkpoint_turn_limit', state.total_pollen_cost, state.steps.length)
    );
    this.emitEvent({ type: 'stopped', message: blockedError });
    return result;
  }

  private async handlePlanApprovalPending(state: ReactState): Promise<ReactResult> {
    const message = 'The TODO outline is ready. Review it before workspace changes begin.';
    const result: ReactResult = {
      success: false,
      error: message,
      errorCode: 'PLAN_APPROVAL_REQUIRED',
      recoverable: true,
      suggestedNextAction: 'Review the TODO outline, then approve, edit, reject, or cancel it before resuming.',
      plan: state.plan,
      planApproval: state.planApproval,
      steps: state.steps,
      stepCount: state.current_step,
      pollenCost: state.total_pollen_cost,
      resumeState: state,
      outcome: 'incomplete',
    };
    await this.endStructuredRequest(false, message);
    result.performanceTrace = this.finishPerformanceTrace(state, false);
    this.emitEvent({ type: 'stopped', message });
    return result;
  }

  private async generatePollinationsWithRetry(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    model: string,
    useAuthenticated = true
  ): Promise<string> {
    const uniqueModels = [model];
    const authSchedules = useAuthenticated ? [true, false] : [false];

    const modelAuthOptions: Array<{ model: string; isAuth: boolean }> = [];
    for (const isAuth of authSchedules) {
      for (const currentModel of uniqueModels) {
        modelAuthOptions.push({ model: currentModel, isAuth });
      }
    }

    const retryConfig: RetryConfig = {
      maxAttempts: 4,
      backoffStrategy: 'exponential-jitter',
      baseDelayMs: 500,
      multiplier: 1.5,
      maxDelayMs: 30000,
      jitter: true,
    };

    const result = await executeWithRotation(
      modelAuthOptions,
      async (option: { model: string; isAuth: boolean }) => {
        let clientToUse: { chatCompletion: ReActEnginePollinationsClient['chatCompletion'] };
        if (!option.isAuth) {
          const publicClient = this.config.runtime.createUnauthenticatedPollinationsClient?.();
          if (!publicClient) {
            throw new Error('Unauthenticated Pollinations fallback is unavailable in this host runtime.');
          }
          clientToUse = publicClient;
        } else {
          clientToUse = this.llm as unknown as typeof clientToUse;
        }

        const res = await clientToUse.chatCompletion({
          messages,
          model: option.model,
        });

        if (res && res.content) {
          return res.content;
        }
        throw new Error(
          `Error: Pollinations API returned empty response\n` +
            `Cause: Chat completion response missing content field\n` +
            `Suggested Fix: Verify Pollinations API is online and returning valid responses. Check model availability.\n` +
            `Context: Model: ${option.model}, Auth: ${option.isAuth}, Response: ${JSON.stringify(res)}`
        );
      },
      retryConfig,
      (option, attempt, error, nextDelayMs) => {
        const authStr = option.isAuth ? 'auth' : 'public';
        this.log(
          `⚠️ Pollinations helper (${authStr}) failed on ${option.model} (attempt ${attempt}). Retrying in ${(
            nextDelayMs / 1000
          ).toFixed(1)}s...`
        );
      },
      (fromOption, toOption, reason) => {
        const fromAuthStr = fromOption.isAuth ? 'auth' : 'public';
        const toAuthStr = toOption.isAuth ? 'auth' : 'public';
        this.log(
          `⚠️ Rotating from ${fromOption.model}/${fromAuthStr} to ${toOption.model}/${toAuthStr}... (${reason})`
        );
      }
    );

    if (!result.success) {
      throw result.error;
    }

    return result.data!;
  }

  private async createChatCompletion(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    model: string
  ): Promise<string> {
    try {
      return await this.llm.createChatCompletion(messages, model, {
        temperature: 0.7,
        maxTokens: 2000,
        pinModel: true,
      });
    } catch (primaryError: any) {
      if (!this.config.allowPollinationsFallback) {
        throw primaryError;
      }

      const errMsg = primaryError?.message || String(primaryError);

      if (this.config.runtime.getModelConfig(model).gemini) {
        if (!this.config.runtime.hasGeminiApiKey()) {
          this.log(
            `⚠️ GEMINI_API_KEY not defined for Gemini model. Falling back to Pollinations chat completion...`
          );
          try {
            return await this.generatePollinationsWithRetry(messages, 'openai-fast', true);
          } catch (pollenError) {
            return await this.generatePollinationsWithRetry(messages, 'openai-fast', false);
          }
        }
      }

      const pollinationsFallbackModel = model;

      this.log(`↻ Primary provider failed. Trying Pollinations backend (${errMsg})...`);
      try {
        return await this.generatePollinationsWithRetry(messages, pollinationsFallbackModel, true);
      } catch (pollenError) {
        this.log(`⚠️ Authenticated Pollinations failed too. Trying unauthenticated Pollinations public pool...`);
        try {
          return await this.generatePollinationsWithRetry(messages, pollinationsFallbackModel, false);
        } catch (publicError: any) {
          throw new Error(
            `Error: All LLM fallback chains exhausted\n` +
              `Cause: Primary provider (${model}) failed: ${errMsg}. All Pollinations fallbacks failed too.\n` +
              `Suggested Fix: Check API keys and service availability. Try again in a few minutes.\n` +
              `Context: Primary: ${model}, Fallback 1: Authenticated Pollinations, Fallback 2: Public Pollinations`
          );
        }
      }
    }
  }

  private log(message: string): void {
    if (this.config.verbose) {
      this.config.runtime.writeHostLog?.('log', message);
      this.emitEvent({ type: 'console_output', message });
    }
  }

  private async endStructuredRequest(success: boolean, error?: string): Promise<void> {
    if (!this.executionLogger) return;
    this.executionLogger.endRequest(success, error);
    await this.executionLogger.flush();
  }

  private async persistRunAudit(
    ...args: Parameters<NonNullable<ReActEngineRuntime['recordRunResult']>>
  ): Promise<void> {
    await this.config.runtime.recordRunResult?.(...args);
  }

  private createRequestEnvelope(input: CreateRequestEnvelopeInput): RequestEnvelope {
    return createCoreRequestEnvelope(input, (serialized) => this.config.runtime.hashRequestPayload(serialized));
  }

  private hashRequestText(text: string): string {
    return hashCoreRequestText(text, (serialized) => this.config.runtime.hashRequestPayload(serialized));
  }

  /**
   * Extract output files from execution steps
   * Scans Write/Edit actions for files generated during app creation
   */
  private extractOutputFilesFromSteps(steps: ReactStep[], workspace: string = this.config.workspace || '.'): string[] {
    return extractSuccessfulWorkspaceOutputs(steps, workspace, this.workspacePathResolver);
  }

  private finishPerformanceTrace(state: ReactState, success: boolean) {
    const contextEstimate = estimateReactStepContext(state.steps);
    const contextWindow = state.modelContextWindow || this.config.contextWindow || 0;
    const inputTokens = state.llmUsage?.inputTokens || 0;
    const outputTokens = state.llmUsage?.outputTokens || 0;
    const providerPromptTokens = state.llmUsage?.lastPromptTokens;
    const providerPeakPromptTokens = state.llmUsage?.peakPromptTokens;
    const cacheCounters = this.collectCacheCounters();
    const cacheDeltas = this.diffCounters(cacheCounters, this.cacheCounterBaseline || {});
    const slowOperationCounters = this.collectSlowOperationCounters(this.traceStartedAt);
    return this.activeTrace?.finish({
      steps: state.steps.length,
      success: success ? 1 : 0,
      total_pollen_cost: state.total_pollen_cost,
      estimated_context_tokens: contextEstimate.totalTokens,
      estimated_context_new_tokens: contextEstimate.estimatedNewTokens,
      estimated_context_baseline_tokens: contextEstimate.baselineTokens,
      llm_input_tokens: inputTokens,
      llm_output_tokens: outputTokens,
      llm_total_tokens: inputTokens + outputTokens,
      model_context_window_tokens: contextWindow,
      estimated_context_remaining_tokens: contextWindow
        ? Math.max(0, contextWindow - contextEstimate.totalTokens)
        : 0,
      context_window_used_percent: contextWindow
        ? Number(Math.min(100, ((providerPromptTokens ?? contextEstimate.totalTokens) / contextWindow) * 100).toFixed(2))
        : 0,
      prompt_prefill_duration_ms: state.llmUsage?.lastPromptPrefillDurationMs || 0,
      provider_reported_prompt_tokens: providerPromptTokens || 0,
      provider_peak_prompt_tokens: providerPeakPromptTokens || 0,
      provider_prompt_remaining_tokens: providerPromptTokens !== undefined && contextWindow
        ? Math.max(0, contextWindow - providerPromptTokens)
        : 0,
      provider_prompt_used_percent: providerPromptTokens !== undefined && contextWindow
        ? Number(Math.min(100, (providerPromptTokens / contextWindow) * 100).toFixed(2))
        : 0,
      context_measurement_estimated: providerPromptTokens === undefined ? 1 : 0,
      global_step_limit: state.globalStepLimit || this.config.globalStepLimit,
      global_steps_used: state.globalStepCount ?? state.current_step,
      global_steps_remaining: Math.max(0, (state.globalStepLimit || this.config.globalStepLimit) - (state.globalStepCount ?? state.current_step)),
      window_step_limit: state.stepWindowLimit ?? state.max_steps,
      window_steps_used: Math.max(0, state.current_step - (state.stepWindowStart || 0)),
      recovery_transitions_used: state.recoveryCount || 0,
      recovery_transitions_window_used: state.recoveryWindowCount ?? state.recoveryCount ?? 0,
      recovery_transitions_limit: state.maxRecoveryTransitions || this.config.maxRecoveryTransitions,
      recovery_transitions_remaining: Math.max(0, (state.maxRecoveryTransitions || this.config.maxRecoveryTransitions) - (state.recoveryWindowCount ?? state.recoveryCount ?? 0)),
      wall_clock_budget_ms: state.wallClockBudgetMs || this.config.wallClockBudgetMs,
      wall_clock_elapsed_ms: state.runStartedAt ? Math.max(0, Date.now() - state.runStartedAt) : 0,
      ...cacheDeltas,
      ...slowOperationCounters,
    });
  }

  private buildAuditOptions(
    outcomeKind: OutcomeKind,
    overrideCost?: number,
    overrideSteps?: number
  ): RunAuditOptions {
    return {
      threadId: this.config.threadId || undefined,
      runId: this.config.auditRunId || this.config.runId || undefined,
      parentRunId: this.config.parentRunId || undefined,
      attemptIndex: this.config.attemptIndex ?? 1,
      outcomeKind,
      threadTitle: this.config.threadTitle || undefined,
      cumulativeCost: overrideCost,
      cumulativeSteps: overrideSteps,
      harnessInterventions: this.toolEvidenceLedger.list()
        .filter((record) => Boolean(record.harnessIntervention))
        .slice(-50)
        .map((record) => ({
          ...record.harnessIntervention!,
          evidenceId: record.id,
          toolCallId: record.toolCallId,
        })),
    };
  }

  private collectCacheCounters(): NumericCounters {
    const metrics = this.config.runtime.cache?.getMetrics();
    const hits = metrics?.hits || 0;
    const misses = metrics?.misses || 0;
    const staleHits = metrics?.staleHits || 0;
    const staleRefreshes = metrics?.staleRefreshes || 0;
    const sets = metrics?.sets || 0;
    const evictions = metrics?.evictions || 0;
    const deletes = metrics?.deletes || 0;
    const lookups = hits + misses + staleHits;

    return {
      cache_hits: hits,
      cache_misses: misses,
      cache_stale_hits: staleHits,
      cache_stale_refreshes: staleRefreshes,
      cache_sets: sets,
      cache_evictions: evictions,
      cache_deletes: deletes,
      cache_lookups: lookups,
      cache_hit_rate_percent: lookups > 0 ? (hits / lookups) * 100 : 0,
      cache_entries: (metrics?.runtimeEntries || 0) + (metrics?.repositoryEntries || 0) + (metrics?.projectFileMapEntries || 0),
      cache_runtime_entries: metrics?.runtimeEntries || 0,
      cache_repository_entries: metrics?.repositoryEntries || 0,
      cache_project_file_map_entries: metrics?.projectFileMapEntries || 0,
    };
  }

  private diffCounters(current: NumericCounters, baseline: NumericCounters): NumericCounters {
    const deltaKeys = new Set([
      'cache_hits',
      'cache_misses',
      'cache_stale_hits',
      'cache_stale_refreshes',
      'cache_sets',
      'cache_evictions',
      'cache_deletes',
      'cache_lookups',
    ]);
    const diff: NumericCounters = {};

    for (const [key, value] of Object.entries(current)) {
      diff[key] = deltaKeys.has(key) ? Math.max(0, value - (baseline[key] || 0)) : value;
    }

    const lookups = diff.cache_lookups || 0;
    diff.cache_hit_rate_percent = lookups > 0 ? ((diff.cache_hits || 0) / lookups) * 100 : 0;
    return diff;
  }

  private collectSlowOperationCounters(startedAt: number): NumericCounters {
    const metrics = this.config.runtime.getSlowOperationMetrics?.(startedAt);

    return {
      slow_operations: metrics?.count || 0,
      slow_operation_ms: metrics?.totalMs || 0,
      slow_operation_max_ms: metrics?.maxMs || 0,
    };
  }

  private async measureTrace<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return this.activeTrace ? this.activeTrace.measure(name, fn) : fn();
  }

  private emitEvent(event: AgentStreamEvent): void {
    if (event.type === 'model_stream' && event.eventType !== 'usage' && event.delta) {
      this.queueModelStreamEvent(event);
      return;
    }
    this.flushPendingModelStreamEvent();
    this.activeTrace?.recordEvent(event.type);
    this.config.onEvent?.(event);
  }

  private queueModelStreamEvent(event: Extract<AgentStreamEvent, { type: 'model_stream' }>): void {
    const pending = this.pendingModelStreamEvent;
    const canMerge = pending &&
      pending.requestId === event.requestId &&
      pending.requestKind === event.requestKind &&
      pending.stepId === event.stepId &&
      pending.eventType === event.eventType &&
      pending.provider === event.provider &&
      pending.model === event.model;

    if (pending && !canMerge) this.flushPendingModelStreamEvent();
    if (canMerge && this.pendingModelStreamEvent) {
      this.pendingModelStreamEvent = {
        ...this.pendingModelStreamEvent,
        delta: `${this.pendingModelStreamEvent.delta || ''}${event.delta || ''}`,
      };
    } else {
      this.pendingModelStreamEvent = event;
    }

    if (!this.pendingModelStreamTimer) {
      this.pendingModelStreamTimer = setTimeout(() => this.flushPendingModelStreamEvent(), 100);
      this.config.runtime.unrefTimer?.(this.pendingModelStreamTimer);
    }
  }

  private flushPendingModelStreamEvent(): void {
    if (this.pendingModelStreamTimer) {
      clearTimeout(this.pendingModelStreamTimer);
      this.pendingModelStreamTimer = undefined;
    }
    const pending = this.pendingModelStreamEvent;
    this.pendingModelStreamEvent = undefined;
    if (!pending) return;
    this.activeTrace?.recordEvent(pending.type);
    this.config.onEvent?.(pending);
  }

  private emitTodoProjection(state: ReactState, includeLegacyPlanEvent: boolean): void {
    const revision = Math.max(0, Math.floor(state.todoRevision || 0)) + 1;
    state.todoRevision = revision;
    if (includeLegacyPlanEvent) this.emitEvent({ type: 'plan_updated', plan: state.plan });
    const snapshot = createTodoSnapshot(state.plan, revision);
    this.emitEvent({ type: 'todo_snapshot', revision: snapshot.revision, items: snapshot.items });
    const progressCursor = createTodoProgressCursor(state.plan, state.current_step, state.codingState);
    const links = createTodoLinks(state.plan, state.workPlan?.acceptanceCriteria || [], progressCursor);
    this.emitEvent({
      type: 'todo_links_updated',
      revision,
      links: links.links,
      acceptanceCriteria: links.acceptanceCriteria,
      ...(links.progressCursor ? { progressCursor: links.progressCursor } : {}),
    });
  }

  private emitPlannerGuidanceSnapshot(
    snapshot: NonNullable<PlannerConfig['onGuidanceSnapshot']> extends (value: infer T) => void ? T : never,
    step: number,
    stepId: string,
  ): void {
    this.emitEvent({
      type: 'agent_guidance_snapshot',
      codingState: snapshot.codingState || 'understand',
      injectedDirective: snapshot.injectedDirective,
      permissionConstraints: snapshot.permissionConstraints,
      activeGateFailures: snapshot.activeGateFailures,
      contextBudgetUsed: snapshot.contextBudgetUsed,
      step,
      stepId,
    });
  }

  private classifyDecisionCategory(state: ReactState, action: ToolAction['action'], input: ToolAction['action_input']): AgentDecisionCategory {
    const codingState: string = state.codingState || 'understand';
    const planKind = activePlanKind(state);
    if (action === 'AskUserQuestion') return 'clarification';
    if (['Todo', 'WorkPlan', 'SubAgent'].includes(action)) return 'coordination';
    if (isVerificationAction(action, input) || codingState === 'verify' || planKind === 'verify') return 'verification';
    if (codingState === 'repair' || codingState === 'blocked') return 'recovery';
    if (['review', 'complete'].includes(codingState)) return 'completion';
    if (['Write', 'Edit', 'PackageInstall'].includes(action) || codingState === 'implement' || planKind === 'implement') return 'implementation';
    if (['Read', 'DocumentRead', 'Grep', 'Glob', 'WorkspaceChanges'].includes(action) || codingState === 'inspect' || planKind === 'inspect') return 'inspection';
    if (state.recoveryReason) return 'recovery';
    if (['understand', 'discover', 'plan', 'awaiting_plan_approval'].includes(codingState)) return 'planning';
    return 'unknown';
  }

  private emitCapabilityScopeEvent(event: unknown): void {
    this.emitEvent(event as AgentStreamEvent);
  }

  private describeModelDecision(action: ToolAction, activePlanItem?: string): string {
    const input = action.action_input || {};
    const filePath = this.getActionFilePath(action);
    const prefix = activePlanItem ? `For “${activePlanItem}”, ` : '';
    if (action.action === 'Read' || action.action === 'DocumentRead') {
      return `${prefix}I’m reading ${filePath || 'the relevant file'} to inspect the current implementation before deciding on a change.`;
    }
    if (action.action === 'Glob') {
      return `${prefix}I’m locating matching workspace files with ${String(input.pattern || 'the requested pattern')}.`;
    }
    if (action.action === 'Grep') {
      return `${prefix}I’m searching the codebase for ${String(input.pattern || input.query || 'the relevant implementation')}.`;
    }
    if (action.action === 'Write' || action.action === 'Edit') {
      return `${prefix}I’m ${action.action === 'Write' ? 'writing' : 'updating'} ${filePath || 'the target file'} now.`;
    }
    if (action.action === 'Bash') {
      const command = typeof input.command === 'string' ? input.command : 'the selected command';
      return `${prefix}I’m running ${command.length > 140 ? `${command.slice(0, 137)}...` : command} to inspect or verify the result.`;
    }
    if (action.action === 'Command') {
      return `${prefix}I’m running the ${String(input.operation || 'selected')} workspace operation next.`;
    }
    return `${prefix}I selected ${action.action} as the next concrete action.`;
  }

  private emitToolStarted(action: ToolAction, stepId?: string, toolCallId?: string, requestId?: string): void {
    const input = action.action_input || {};
    this.emitEvent({
      type: 'tool_started',
      tool: action.action,
      input: redactPolicyPayload(input),
      ...(stepId ? { stepId } : {}),
      ...(toolCallId ? { toolCallId } : {}),
      ...(requestId ? { requestId } : {}),
    });

    if (classifyPolicyAction(action).category === 'install') {
      const command = action.action === 'PackageInstall'
        ? [String(input.manager || 'npm'), 'install', input.dev === true ? '--save-dev' : '', ...(Array.isArray(input.packages) ? input.packages.map(String) : [])].filter(Boolean).join(' ')
        : String(input.command || 'package install');
      this.emitEvent({
        type: 'package_install_started',
        manager: action.action === 'PackageInstall' ? String(input.manager || 'npm') : command.split(/\s+/, 1)[0].replace(/\.cmd$/i, ''),
        packages: action.action === 'PackageInstall' && Array.isArray(input.packages) ? input.packages.map(String) : [],
        dev: action.action === 'PackageInstall' ? input.dev === true : /(?:^|\s)(?:-D|--dev|--save-dev)(?:\s|$)/i.test(command),
        cwd: typeof input.cwd === 'string' ? input.cwd : undefined,
        command,
      });
    }

    const filePath = this.getActionFilePath(action);
    if ((action.action === 'Read' || action.action === 'DocumentRead') && filePath) {
      this.emitEvent({ type: 'file_read', path: filePath });
    }
    if ((action.action === 'Bash' && typeof input.command === 'string') || action.action === 'Command' || action.action === 'PackageInstall') {
      const command = action.action === 'Command'
        ? String(input.operation || 'command')
        : action.action === 'PackageInstall'
          ? [String(input.manager || 'npm'), 'install', input.dev === true ? '--save-dev' : '', ...(Array.isArray(input.packages) ? input.packages.map(String) : [])].filter(Boolean).join(' ')
          : String(input.command);
      this.emitEvent({ type: 'command_started', command });
    }
  }

  private emitToolResult(
    action: ToolAction,
    observation: string,
    stepId?: string,
    toolCallId?: string,
    requestId?: string,
    evidenceId?: string,
  ): void {
    const streamObservation = redactPolicyText(truncateStreamText(observation));
    this.emitEvent({
      type: 'tool_result',
      tool: action.action,
      result: streamObservation,
      ...(stepId ? { stepId } : {}),
      ...(toolCallId ? { toolCallId } : {}),
      ...(requestId ? { requestId } : {}),
      ...(evidenceId ? { evidenceId } : {}),
    });
    if (classifyPolicyAction(action).category === 'install') {
      let parsed: any = {};
      try { parsed = JSON.parse(observation); } catch { /* legacy Bash output */ }
      const install = parsed.packageInstall || {};
      const command = parsed.command || {};
      this.emitEvent({
        type: 'package_install_result',
        success: isSuccessfulToolObservation(observation),
        manager: String(install.manager || (action.action_input?.manager ?? 'npm')),
        requestedPackages: Array.isArray(install.requestedPackages) ? install.requestedPackages.map(String) : [],
        verifiedPackages: Array.isArray(install.verifiedPackages) ? install.verifiedPackages.map(String) : [],
        missingPackages: Array.isArray(install.missingPackages) ? install.missingPackages.map(String) : [],
        cwd: typeof command.cwd === 'string' ? command.cwd : typeof action.action_input?.cwd === 'string' ? action.action_input.cwd : undefined,
        exitCode: typeof command.exitCode === 'number' ? command.exitCode : undefined,
        output: streamObservation,
      });
    }
    const filePath = this.getActionFilePath(action);
    if ((action.action === 'Write' || action.action === 'Edit') && filePath && isSuccessfulToolObservation(observation)) {
      let diff: string | undefined;
      try {
        const parsed = JSON.parse(observation) as { diff?: unknown };
        if (typeof parsed.diff === 'string' && parsed.diff.trim()) {
          diff = redactPolicyText(truncateStreamText(parsed.diff, 6_000));
        }
      } catch {
        // Legacy mutation tools may return unstructured success text.
      }
      this.emitEvent({
        type: 'file_changed',
        path: filePath,
        summary: action.action === 'Write' ? 'Wrote file' : 'Edited file',
        diff,
        ...(evidenceId ? { evidenceId } : {}),
      });
    }
    if (action.action === 'Bash' || action.action === 'Command' || action.action === 'PackageInstall') {
      const command = action.action === 'Command'
        ? String(action.action_input?.operation || 'command')
        : action.action === 'PackageInstall'
          ? [String(action.action_input?.manager || 'npm'), 'install', action.action_input?.dev === true ? '--save-dev' : '', ...(Array.isArray(action.action_input?.packages) ? action.action_input.packages.map(String) : [])].filter(Boolean).join(' ')
          : typeof action.action_input?.command === 'string' ? action.action_input.command : undefined;
      this.emitEvent({ type: 'command_output', command, output: streamObservation });
    }
  }

  private getActionFilePath(action: ToolAction): string | undefined {
    return filePathFromInput(action.action_input);
  }

  private throwIfCancelled(): void {
    if (this.runSignal?.aborted) {
      throw new Error('RUN_CANCELLED');
    }
  }

  private isCancelledError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return this.runSignal?.aborted || message.includes('RUN_CANCELLED') || message.toLowerCase().includes('cancelled');
  }
}
