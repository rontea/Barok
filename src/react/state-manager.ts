/**
 * State Management Module
 * Handles ReAct state initialization, updates, and tracking
 */

import type { CoderTaskAnalysis } from '../coder/taskAnalysis.js';
import type { CoderTaskAnalysisView } from '@barok/core';
import type { PlanApprovalState } from '@barok/engine';
export type { PlanItem, PlanItemKind } from '@barok/engine';
import type { ApprovalScopeGrant } from '../tools/permissionPolicy.js';
import type { ContinuationHandoff } from '@barok/engine';
import type { RuntimeTaskRouting } from '../tasks/runtimeTaskRouting.js';
import {
  classifyRecoveryTransition as classifyEngineRecoveryTransition,
  getCodingStateBudget,
  getCodingStateTimeBudget,
  isSuccessfulReactStep,
  countRepeatedSuccessfulInspectionEvidence,
  canonicalizeReactActionInput,
  getCurrentTaskSteps,
  getTaskEvidenceSteps,
  reactActionSignature as actionSignature,
  isCodingStateTransitionAllowed,
  observationRequiresApproval,
  isVerificationAction,
} from '@barok/engine';
import type {
  AgentDecisionDetails,
  AgentReasoningContext,
  AgentWorkPlanStatus,
  CodingState,
  CodingStateAssessment,
  ReActEngineCapabilityScope,
  ReActEngineConfig,
  ReActEngineEvent,
  ReActEngineState,
  PendingApprovalRequest,
  ReactResult as EngineReactResult,
  ReactStep,
  RecoveryTransition,
  RecoveryEvidence,
  RecoveryReason,
  RecoveryRecord,
  ThinkingDepth,
} from '@barok/engine';
export {
  CODING_STATE_TRANSITIONS,
  getCodingStateBudget,
  getCodingStateTimeBudget,
  isCodingStateBudgetExceeded,
  isCodingStateTimeBudgetExceeded,
  isCodingStateTransitionAllowed,
  observationRequiresApproval,
} from '@barok/engine';
export type {
  AgentDecisionDetails,
  AgentReasoningContext,
  AgentWorkPlan,
  AgentWorkPlanStatus,
  CodingState,
  CodingStateAssessment,
  PendingApprovalRequest,
  ReactStep,
  RecoveryEvidence,
  RecoveryReason,
  RecoveryRecord,
  RecoveryTransition,
  ThinkingDepth,
} from '@barok/engine';
import type { HarnessInterventionEvidence, ToolEvidenceRecord } from './tool-contract.js';
import type { RunOutcome, SharedRunState, SharedRunTransition } from '@barok/engine';
import type { RunTerminalAdviceEvent } from '@barok/engine';
import type { DirtyTreeState } from '@barok/adapter-node';
import type { RequestEnvelope } from '@barok/core';
import type { UnknownToolOutcome } from '../persistence/toolLifecycle.js';
import type { DurableTodoItem, TodoItemLink, TodoProgressCursor } from '@barok/core';
import path from 'path';
import type { CapabilityPackName } from './capability-scope.js';
import type { EngineSubtaskDispatchResult } from '@barok/engine';
import type { CordisRuntimeEvent } from '../runtime/cordis/runtime.js';
import { isStructuredDocumentPath } from '../tools/documentReader.js';
import type { ReActEnginePacingProfile as ExecutionPacingProfile } from '@barok/engine';
export type { ReActEnginePacingProfile as ExecutionPacingProfile } from '@barok/engine';
import type {
  AgentDecisionRecord,
  AgentReasoningPhase,
  AgentReasoningSource,
  AgentReasoningVisibility,
  StoredAgentContextSnapshot,
} from '@barok/engine';
import type { ReactCheckpoint } from './checkpoint.js';

export { buildRetainedReadContext, buildStepHistory, getRetainedReadCoverage } from '@barok/engine';
export type { RetainedReadContextOptions, RetainedReadCoverage, StepHistoryOptions } from '@barok/engine';

export {
  advancePlan,
  formatPlan,
  formatWorkPlan,
  getStateSnapshot,
  primePlanCursor,
  setPlan,
  updateStepCost,
  setAppSpec,
  getReactStateBudgetStatus as getBudgetStatus,
  isStateComplete,
  isMaxStepsReached,
  isBudgetExceeded,
  setVerificationResult,
  setAppManifestId,
  incrementRepairAttempts,
  EDIT_STAGNATION_FAILURE_LIMIT,
  isHashConflictOrStalePreimageError,
  trackMutationFailure,
  isEditStagnated,
  resetRecoveryBudgetAfterProgress,
  reactActionSignature as actionSignature,
  countRepeatedSuccessfulInspectionEvidence,
  getCurrentTaskSteps,
  getTaskEvidenceSteps,
  hasRepeatedSuccessfulInspectionLoop,
  shouldTripContinuousRunNoProgressCircuit,
} from '@barok/engine';

export function getPendingApprovalRequest(
  state: Pick<ReactState, 'steps'>,
): PendingApprovalRequest | undefined {
  const step = state.steps[state.steps.length - 1];
  if (!step?.observation) return undefined;

  // Git inspection deliberately succeeds outside a repository, but the next
  // step (git init) changes workspace metadata and must be explicitly
  // confirmed. Keep this as a structured approval so the same UI used by
  // policy-denied tools can open for this legacy confirmation boundary.
  if (/Before initializing Git here, ask the user for confirmation/i.test(step.observation)) {
    return {
      category: 'git',
      risk: 'low',
      scope: 'git:git init',
      summary: 'Initialize Git in the current workspace',
      reason: 'No Git repository was detected. Initializing Git changes workspace metadata and requires your confirmation.',
    };
  }

  try {
    const parsed = JSON.parse(step.observation) as {
      error?: unknown;
      policy?: { requiresApproval?: unknown; category?: unknown; risk?: unknown; scope?: unknown };
    };
    if (parsed.policy?.requiresApproval !== true || typeof parsed.policy.scope !== 'string') return undefined;
    const command = typeof step.action_input?.command === 'string'
      ? step.action_input.command
      : JSON.stringify(step.action_input || {});
    return {
      category: typeof parsed.policy.category === 'string' ? parsed.policy.category : 'action',
      risk: typeof parsed.policy.risk === 'string' ? parsed.policy.risk : 'unknown',
      scope: parsed.policy.scope,
      summary: `${step.action} ${command}`.trim(),
      reason: typeof parsed.error === 'string'
        ? parsed.error.replace(/^Policy blocked action:\s*/i, '')
        : 'This action requires explicit user approval.',
    };
  } catch {
    return undefined;
  }
}

export function classifyRecoveryTransition(step: ReactStep | undefined): RecoveryTransition {
  if (!step) return undefined;
  return classifyEngineRecoveryTransition({
    action: step.action,
    actionInput: step.action_input,
    observation: step.observation,
    successful: successfulStep(step),
  });
}

function recoveryTargetForReason(state: ReactState, reason: RecoveryReason): CodingState {
  const current = state.codingState || 'understand';
  if (reason === 'provider_failure' || reason === 'invalid_tool_selection') return current;
  if (reason === 'decision_evidence_mismatch') return 'inspect';
  if (reason === 'failed_verification') return 'repair';
  if (reason === 'failed_mutation') return 'inspect';
  if (!requiresSourceMutation(state)) return 'inspect';
  return hasRelevantInspectionEvidence(state) ? 'implement' : 'inspect';
}

function recoveryEvidence(state: ReactState): RecoveryEvidence {
  const steps = getTaskEvidenceSteps(state);
  const latest = state.steps[state.steps.length - 1];
  const mutationSteps = steps.filter((step) => step.action === 'Write' || step.action === 'Edit');
  const verificationSteps = steps.filter((step) => isVerificationAction(step.action, step.action_input));
  return {
    stepCount: state.steps.length,
    ...(typeof state.evidenceStartStep === 'number' ? { evidenceStartStep: state.evidenceStartStep } : {}),
    ...(latest ? {
      latestAction: latest.action,
      latestActionSucceeded: successfulStep(latest),
    } : {}),
    successfulMutationCount: mutationSteps.filter(successfulStep).length,
    failedMutationCount: mutationSteps.filter((step) => !successfulStep(step)).length,
    successfulVerificationCount: verificationSteps.filter(successfulStep).length,
    failedVerificationCount: verificationSteps.filter((step) => !successfulStep(step)).length,
  };
}

/**
 * Record a recovery boundary without discarding any evidence. The caller is
 * responsible for emitting the record and persisting its checkpoint.
 */
export function startRecovery(
  state: ReactState,
  reason: RecoveryReason,
  message: string,
  targetState?: CodingState,
  decisionId?: string,
): RecoveryRecord {
  const from = state.codingState || 'understand';
  const to = targetState || recoveryTargetForReason(state, reason);
  const attempt = (state.recoveryWindowCount ?? state.recoveryCount ?? 0) + 1;
  const record: RecoveryRecord = {
    reason,
    message,
    from,
    to,
    attempt,
    createdAt: Date.now(),
    evidence: recoveryEvidence(state),
    ...(decisionId ? { decisionId } : {}),
  };
  state.recoveryReason = reason;
  state.recoveryCount = (state.recoveryCount || 0) + 1;
  state.recoveryWindowCount = record.attempt;
  state.lastRecovery = record;
  state.recoveryHistory = [...(state.recoveryHistory || []), record].slice(-20);
  state.codingState = to;
  state.codingStateStartedStep = state.current_step;
  state.codingStateStartedAt = record.createdAt;
  if (to !== 'blocked') state.blockedReason = undefined;
  return record;
}

export type AgentStreamEvent = ReActEngineEvent<
  CoderTaskAnalysisView,
  UnknownToolOutcome,
  CapabilityPackName,
  CordisRuntimeEvent
>;

export type ReactState = ReActEngineState<
  CoderTaskAnalysis,
  RuntimeTaskRouting,
  ApprovalScopeGrant,
  DirtyTreeState,
  UnknownToolOutcome,
  ContinuationHandoff
>;

export { hasAnsweredUserQuestion, normalizeUserQuestion, recordAnsweredUserQuestion } from '@barok/engine';

function successfulStep(step: ReactStep): boolean {
  return isSuccessfulReactStep(step);
}

function failureTextForStep(step: ReactStep): string {
  let failureText = step.observation || '';
  try {
    const parsed = JSON.parse(failureText) as { error?: unknown; output?: unknown };
    failureText = typeof parsed.error === 'string'
      ? parsed.error
      : typeof parsed.output === 'string'
        ? parsed.output
        : failureText;
  } catch { /* legacy observations use their bounded text */ }
  return failureText.replace(/\s+/g, ' ').trim();
}

function isWorkspaceIsolationFailure(step: ReactStep): boolean {
  return step.action === 'Bash' &&
    /Workspace isolation rejected this Bash command/i.test(failureTextForStep(step));
}

function isWindowsDirectorySyntaxFailure(step: ReactStep): boolean {
  if (step.action !== 'Bash') return false;
  const command = typeof step.action_input?.command === 'string' ? step.action_input.command : '';
  return /The filename, directory name, or volume label syntax is incorrect/i.test(failureTextForStep(step)) &&
    /(?:^|&&|\|\||[&|])\s*dir(?:\s|$)/i.test(command);
}

export interface ReadFailureDetails {
  target?: string;
  /** A uniquely referenced local app asset that corrects an inferred bad path. */
  recoveryTarget?: string;
  failureText: string;
  missingTarget: boolean;
  /** A missing, analysis-scoped mutable target can safely enter Write/Edit recovery. */
  canRecoverAsMutation: boolean;
  guidance: string;
}

function sameWorkspacePath(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  return left.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase() ===
    right.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function readStepContent(step: ReactStep): string {
  const observation = step.observation || '';
  try {
    const parsed = JSON.parse(observation) as Record<string, unknown>;
    const content = [parsed.output, parsed.content, parsed.text, parsed.stdout]
      .find((value): value is string => typeof value === 'string');
    return content || '';
  } catch {
    return observation;
  }
}

function htmlAssetReferences(
  pagePath: string,
  markup: string,
  workspace?: string,
): string[] {
  const normalizedPage = normalizeEvidencePath(pagePath, workspace);
  if (!normalizedPage || !/\.html?$/i.test(normalizedPage)) return [];

  const pageDirectory = path.posix.dirname(normalizedPage);
  const references: string[] = [];
  const tags = markup.match(/<(?:link|script)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const readAttribute = (name: string): string | undefined => {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
      return match?.[1] ?? match?.[2] ?? match?.[3];
    };
    const isLink = /^<link\b/i.test(tag);
    const reference = isLink ? readAttribute('href') : readAttribute('src');
    if (!reference || !reference.trim()) continue;
    const cleanReference = reference.trim().split(/[?#]/, 1)[0].replace(/\\/g, '/');
    if (!cleanReference || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(cleanReference)) continue;
    if (isLink) {
      const rel = (readAttribute('rel') || '').toLowerCase().split(/\s+/);
      if (!rel.includes('stylesheet') && !/\.css$/i.test(cleanReference)) continue;
      if (!/\.css$/i.test(cleanReference)) continue;
    } else if (!/\.(?:m?js|cjs)$/i.test(cleanReference)) {
      continue;
    }

    const resolved = path.posix.normalize(path.posix.join(pageDirectory, cleanReference));
    if (!resolved || resolved === '.' || resolved === '..' || resolved.startsWith('../') || path.posix.isAbsolute(resolved)) continue;
    references.push(resolved);
  }
  return [...new Set(references)];
}

/**
 * Return local CSS/JS outputs directly referenced by successfully inspected
 * HTML in an application task. These references provide narrow path evidence
 * when generated markup and inferred filenames disagree.
 */
export function getReferencedWebAssetRecoveryTarget(
  target: string,
  analysis: CoderTaskAnalysis | undefined,
  steps: ReactStep[],
  workspace?: string,
): string | undefined {
  if (!analysis || analysis.expectedChangeIntent === 'read_only' ||
      !['new_feature', 'continuation', 'bug_fix'].includes(analysis.taskKind)) return undefined;
  const request = analysis.contract?.originalRequest || analysis.userRequest || '';
  if (analysis.targetLayer !== 'ui' && !/\b(?:web\s*app|website|web\s*site|browser|frontend|portfolio|site)\b/i.test(request)) {
    return undefined;
  }

  const knownHtml = new Set([
    ...(analysis.affectedFiles || []).filter((file) => file.intent !== 'read_only').map((file) => file.path),
    ...(analysis.contract?.candidateFiles || []),
    ...(analysis.projectFileMap?.files || []).filter((file) => file.layer === 'ui' && /\.html?$/i.test(file.path)).map((file) => file.path),
  ].filter((file) => /\.html?$/i.test(file))
    .map((file) => normalizeEvidencePath(file, workspace)));
  const references = new Set<string>();
  for (const step of steps) {
    if (step.action !== 'Read' || !successfulStep(step)) continue;
    const pagePath = stepPath(step);
    if (!pagePath || !/\.html?$/i.test(pagePath)) continue;
    const normalizedPage = normalizeEvidencePath(pagePath, workspace);
    if (knownHtml.size > 0 && !knownHtml.has(normalizedPage)) continue;
    for (const reference of htmlAssetReferences(pagePath, readStepContent(step), workspace)) {
      references.add(reference);
    }
  }

  const targetKey = normalizeEvidencePath(target, workspace);
  const exact = [...references].find((reference) => reference === targetKey);
  if (exact) return exact;

  // Correct an inferred filename only when the inspected app page names one
  // unambiguous local asset with the same type. Explicit user paths retain
  // precedence and must be reconciled by editing the page instead.
  const explicitlyMentioned = (analysis.mentionedFiles || []).some((file) =>
    normalizeEvidencePath(file, workspace) === targetKey
  );
  const affectedTarget = analysis.affectedFiles?.find((file) =>
    normalizeEvidencePath(file.path, workspace) === targetKey
  );
  if (explicitlyMentioned || affectedTarget?.intent !== undefined) return undefined;
  const extension = path.posix.extname(targetKey).toLowerCase();
  const sameType = [...references].filter((reference) => path.posix.extname(reference).toLowerCase() === extension);
  return sameType.length === 1 ? sameType[0] : undefined;
}

/**
 * Turn a failed Read into explicit recovery context for the next model turn.
 * The raw observation remains in history, but this makes the cause and the
 * valid next action unambiguous when a model is tempted to repeat the probe.
 */
export function getLatestReadFailureDetails(
  state: Pick<ReactState, 'steps' | 'taskAnalysis'> & Partial<Pick<ReactState, 'workspace'>>,
): ReadFailureDetails | undefined {
  const latest = state.steps[state.steps.length - 1];
  if (!latest || (latest.action !== 'Read' && latest.action !== 'DocumentRead') || successfulStep(latest)) {
    return undefined;
  }

  const target = stepPath(latest);
  const failureText = failureTextForStep(latest).slice(0, 600) || 'the tool returned no diagnostic';
  const missingTarget = /(?:enoent|no such file|not found|does not exist|doesn't exist|cannot find|could not find|file .*missing|missing file)/i.test(failureText);
  const affectedFile = target
    ? state.taskAnalysis?.affectedFiles?.find((file) =>
      normalizeEvidencePath(file.path, state.workspace) === normalizeEvidencePath(target, state.workspace)
    )
    : undefined;
  const mutableAffectedFile = Boolean(
    affectedFile &&
    affectedFile.intent !== 'read_only' &&
    affectedFile.intent !== 'delete' &&
    affectedFile.intent !== 'rename' &&
    !/\.(?:pdf|docx)$/i.test(affectedFile.path),
  );
  const referencedAssetTarget = target
    ? getReferencedWebAssetRecoveryTarget(target, state.taskAnalysis, state.steps, state.workspace)
    : undefined;
  const recoveryTarget = mutableAffectedFile ? target : referencedAssetTarget;
  const structuredDocument = Boolean(target && /\.(?:pdf|docx)$/i.test(target));
  const canRecoverAsMutation = latest.action === 'Read' && missingTarget && Boolean(target) && Boolean(recoveryTarget);

  let guidance: string;
  if (structuredDocument || /(?:binary|documentread|pdf|docx).*read|use documentread/i.test(failureText)) {
    guidance = `Use DocumentRead for ${target || 'this document'}; do not retry Read.`;
  } else if (canRecoverAsMutation) {
    guidance = recoveryTarget && target && !sameWorkspacePath(recoveryTarget, target)
      ? `The requested path ${target} is absent and does not match the inspected page's asset reference. Do not retry it. The inspected HTML identifies ${recoveryTarget} as the unique local asset; choose Write for ${recoveryTarget} with allowCreate: true.`
      : `The target is absent. Do not retry Read. Choose Write for ${target} with the requested content and allowCreate: true; this scoped missing target may be created even when analysis says modify.`;
  } else if (missingTarget) {
    guidance = `The target is absent. Do not retry this Read; choose a valid affected target or ask for clarification if the requested path is wrong.`;
  } else {
    guidance = `Do not retry this exact Read. Use the diagnostic above to choose a different valid target or the appropriate inspection tool.`;
  }

  return { target, recoveryTarget, failureText, missingTarget, canRecoverAsMutation, guidance };
}

function getRepeatedBashFailureGuidance(step: ReactStep, failureText: string): string | undefined {
  if (step.action !== 'Bash') return undefined;

  const command = typeof step.action_input?.command === 'string' ? step.action_input.command.trim() : '';
  if (/\[eval\][\s\S]{0,240}(?:unterminated string constant|invalid or unexpected token)/i.test(failureText)) {
    return 'The inline Node eval was parsed with a leading unmatched quote. Do not retry this payload or create a verifier file. Use Command operation "verify" or the task\'s existing test command, then repair only the declared task outputs.';
  }
  const trailing = command.at(-1);
  const hasUnmatchedTrailingQuote = Boolean(
    trailing && ['"', "'", '`'].includes(trailing) && [...command].filter((character) => character === trailing).length % 2 === 1,
  );
  if (hasUnmatchedTrailingQuote) {
    return 'Do not retry this malformed Bash command. Use Command with operation "list_directory" and args ["."] for directory inspection, or correct the command syntax before trying Bash again.';
  }

  if (/(?:not recognized as an internal or external command|command not found)/i.test(failureText)
      && /(?:^|&&|\|\||[&|])\s*ls\s+-(?:la|al)\b/i.test(command)) {
    return 'On native Windows, replace "ls -la" with "dir /a" in cmd.exe or "Get-ChildItem -Force" in PowerShell. For workspace inspection, use Command with operation "list_directory" and args ["."].';
  }

  if (/not recognized as an internal or external command|command not found/i.test(failureText)) {
    return 'Do not retry this Bash command unchanged. Use Command for the equivalent platform-aware operation or choose an available executable based on the diagnostic.';
  }

  if (/\/dev\/null/i.test(failureText) || /\/dev\/null/i.test(command)) {
    return 'On native Windows, redirecting to "/dev/null" is unsupported. Replace "/dev/null" with "NUL" (e.g. "> NUL 2>&1"), or run the command without redirection.';
  }

  if (/Unix-only syntax/i.test(failureText)) {
    return 'This command was rejected for using Unix-only shell syntax on native Windows. Rewrite the command using PowerShell / cmd.exe syntax, or use the structured Command tool.';
  }

  return 'Do not retry this exact Bash command. Use Command for the equivalent platform-aware operation or change the command/target based on the diagnostic.';
}

function getRepeatedEditFailureGuidance(step: ReactStep, failureText: string): string | undefined {
  if (step.action !== 'Edit' || !/old_string was not found(?: in the guarded preimage)?/i.test(failureText)) {
    return undefined;
  }

  const target = stepPath(step);
  return `Read ${target || 'the target file'} again, then choose a new exact old_string from the refreshed content and include the guarded expectedHash; do not repeat the same Edit payload.`;
}

function getRepeatedVerificationFailureGuidance(step: ReactStep, failureText: string): string | undefined {
  if (step.action !== 'Command' || String(step.action_input?.operation || '').toLowerCase() !== 'verify') return undefined;
  if (!/invalid html document/i.test(failureText)) return undefined;

  return 'Do not rerun Command verify unchanged. Read the reported HTML file, then use Edit to restore the missing doctype/document element or correct the target before verifying again.';
}

function getMissingOutputCheckGuidance(step: ReactStep, failureText: string): string | undefined {
  if (!['Command', 'Bash'].includes(step.action)) return undefined;
  const match = failureText.match(/\bMISSING\s*:\s*(.{1,220})/i);
  if (!match) return undefined;
  const details = match[1].replace(/\s+/g, ' ').trim();
  return `The check reports missing requirements: ${details}. Read the file named by the check, implement the missing content in the task-scoped output, then rerun the check. Do not rerun it unchanged.`;
}

function getUnscopedVerificationHelperGuidance(step: ReactStep, failureText: string): string | undefined {
  if (!['Write', 'Edit'].includes(step.action) || !/not a declared task output|not in affected files/i.test(failureText)) return undefined;
  const target = stepPath(step) || 'this file';
  if (!/(?:^|\/)(?:verify|verification|check|test)(?:[-_.][\w.-]+)?\.(?:js|mjs|cjs|ts|py|sh)$/i.test(target)) return undefined;
  return `The task scope rejected ${target} as an undeclared verification helper. Do not read or write it to expand scope; use Command operation "verify" or the task's existing test command, and keep changes in the declared outputs.`;
}

function isRecoverableBashSyntaxFailure(failureText: string): boolean {
  return /not recognized as an internal or external command|command not found|syntax is incorrect|unterminated|unexpected token|Unix-only syntax/i.test(failureText);
}

function repeatedFailureReason(
  state: Pick<ReactState, 'steps' | 'taskAnalysis'> & { workspace?: string },
  maxAttempts = 3,
  windowSize = 12,
): string | undefined {
  const steps = state.steps;
  const latest = steps[steps.length - 1];
  if (!latest || successfulStep(latest)) return undefined;

  // PDF/DOCX files are source evidence only. Their mutation failures are
  // handled by the executor's read-only source-document recovery path and
  // must not trip the generic repeated-mutation circuit breaker.
  const latestTarget = stepPath(latest);
  if ((latest.action === 'Write' || latest.action === 'Edit') && latestTarget && isStructuredDocumentPath(latestTarget)) {
    return undefined;
  }

  const failureText = failureTextForStep(latest);
  const command = typeof latest.action_input?.command === 'string' ? latest.action_input.command.trim() : '';
  // These two failures have deterministic, planner-enforced recovery paths.
  // Let planning continue so its tool filter can require a workspace-relative
  // Command listing instead of stopping at the generic failure-streak gate.
  if (isWorkspaceIsolationFailure(latest) || isWindowsDirectorySyntaxFailure(latest)) return undefined;
  const hasTargetedWindowsShellGuidance =
    /(?:\/dev\/null|Unix-only syntax)/i.test(failureText) ||
    /\[eval\][\s\S]{0,240}(?:unterminated string constant|invalid or unexpected token)/i.test(failureText) ||
    (/(?:not recognized as an internal or external command|command not found)/i.test(failureText) &&
      /(?:^|&&|\|\||[&|])\s*ls\s+-(?:la|al)\b/i.test(command));
  // Keep ordinary malformed shell attempts recoverable. Once a native
  // Windows idiom has a concrete correction, identical retries use the
  // normal safety threshold and report that correction.
  if (latest.action === 'Bash'
      && isRecoverableBashSyntaxFailure(failureText)
      && !hasTargetedWindowsShellGuidance) return undefined;

  // The exact action arguments and diagnostic define a deterministic retry
  // signature. A repeated identical failure requires a new recovery path
  // rather than another model-visible warning.
  const repeatedActionLimit = maxAttempts;

  const target = stepPath(latest) || JSON.stringify(latest.action_input || {});
  const actionKey = `${latest.action}:${JSON.stringify(canonicalizeReactActionInput(latest.action_input || {}))}`;
  const signature = `${actionKey}:${failureText.slice(0, 1000)}`;
  // A successful mutation changes the guarded preimage and starts a new
  // recovery window. Do not combine failures from before that mutation with
  // a later stale edit, or a productive run can be blocked incorrectly.
  let lastSuccessfulMutationIndex = -1;
  for (let index = steps.length - 2; index >= 0; index--) {
    const step = steps[index];
    const stepTarget = stepPath(step) || JSON.stringify(step.action_input || {});
    if (successfulStep(step) &&
        (step.action === 'Write' || step.action === 'Edit') &&
        stepTarget === target) {
      lastSuccessfulMutationIndex = index;
      break;
    }
  }

  // A successful DocumentRead is a valid recovery for a failed legacy Read
  // of the same PDF/DOCX. Do not carry those old Read failures into a later
  // continuation and block the run after one new model mistake.
  let lastSuccessfulInspectionIndex = -1;
  if (latest.action === 'Read' || latest.action === 'DocumentRead') {
    for (let index = steps.length - 2; index >= 0; index--) {
      const step = steps[index];
      if (
        successfulStep(step) &&
        (step.action === 'Read' || step.action === 'DocumentRead') &&
        (stepPath(step) || JSON.stringify(step.action_input || {})) === target
      ) {
        lastSuccessfulInspectionIndex = index;
        break;
      }
    }
  }

  const recentStart = Math.max(
    steps.length - windowSize,
    lastSuccessfulMutationIndex + 1,
    lastSuccessfulInspectionIndex + 1,
  );
  const recent = steps.slice(recentStart);
  const repeats = recent.filter((step) => {
    if (successfulStep(step)) return false;
    const text = failureTextForStep(step);
    const priorActionKey = `${step.action}:${JSON.stringify(canonicalizeReactActionInput(step.action_input || {}))}`;
    return `${priorActionKey}:${text.slice(0, 1000)}` === signature;
  }).length;

  if (repeats < repeatedActionLimit) {
    let failureStreak = 0;
    for (let index = steps.length - 1; index >= Math.max(0, steps.length - 4); index -= 1) {
      if (successfulStep(steps[index])) break;
      failureStreak += 1;
    }
    if (failureStreak < 4) return undefined;

    const failures = steps.slice(-Math.min(failureStreak, 4));
    if (failures.length > 0 && failures.every(isWorkspaceIsolationFailure)) {
      return [
        `Run paused after ${failureStreak} Bash commands were rejected for referencing paths outside the active workspace.`,
        `The selected workspace is "${state.workspace}".`,
        'Inspect its root with Command operation "list_directory", args ["."], and cwd "."; then use only relative paths and stop guessing alternate absolute workspace paths.',
      ].join(' ');
    }
    const summary = failures.map((step) => `${step.action}: ${failureTextForStep(step).replace(/\s+/g, ' ').slice(0, 120)}`).join(' → ');
    const recovery = getMissingOutputCheckGuidance(latest, failureText) ||
      getUnscopedVerificationHelperGuidance(latest, failureText) ||
      getRepeatedBashFailureGuidance(latest, failureText);
    return `Run paused after ${failureStreak} consecutive failed tool actions without verified progress. Last failures: ${summary}. ${recovery || 'Choose a different recovery path or resume after reviewing the workspace.'}`;
  }

  const readFailure = getLatestReadFailureDetails(state);
  const targetDescription = target && !target.startsWith('{') ? ` for "${target}"` : '';
  const cause = failureText.slice(0, 360) || 'the tool returned no diagnostic';
  const recovery = readFailure?.guidance ||
    getRepeatedEditFailureGuidance(latest, failureText) ||
    getMissingOutputCheckGuidance(latest, failureText) ||
    getUnscopedVerificationHelperGuidance(latest, failureText) ||
    getRepeatedVerificationFailureGuidance(latest, failureText) ||
    getRepeatedBashFailureGuidance(latest, failureText) ||
    'Use the last diagnostic to choose a different action or target; do not repeat the same failed action.';
  return `Repeated ${latest.action} failure reached the ${repeatedActionLimit}-attempt safety limit${targetDescription}. Last error: ${cause}. Recovery: ${recovery}`;
}

function stepPath(step: ReactStep): string | undefined {
  const value = step.action_input?.file_path ?? step.action_input?.path;
  return typeof value === 'string' ? value.replace(/\\/g, '/').replace(/^\.\//, '') : undefined;
}

function isSourcePath(path: string | undefined, state: Pick<ReactState, 'taskAnalysis'>): boolean {
  if (!path) return false;
  const normalized = path.toLowerCase();
  const requirementSources = state.taskAnalysis?.contract?.requirementSources || [];
  if (requirementSources.some((source) => source.replace(/\\/g, '/').toLowerCase() === normalized)) return false;
  return !/(^|\/)(todo|todos|checklist|task-list)(\/|\.|$)/i.test(normalized);
}

function normalizeEvidencePath(value: string, workspace?: string): string {
  let normalized = value.replace(/\\/g, '/').trim().replace(/^\.\//, '');
  const normalizedWorkspace = workspace?.replace(/\\/g, '/').replace(/\/$/, '');
  if (normalizedWorkspace && normalized.toLowerCase().startsWith(`${normalizedWorkspace.toLowerCase()}/`)) {
    normalized = normalized.slice(normalizedWorkspace.length + 1);
  }
  return normalized.replace(/^\.\//, '').toLowerCase();
}

function workspaceChangePaths(step: ReactStep): string[] {
  if (step.action !== 'WorkspaceChanges' || !successfulStep(step)) return [];
  try {
    const observation = JSON.parse(step.observation || '{}') as { output?: unknown };
    const output = typeof observation.output === 'string'
      ? JSON.parse(observation.output) as { files?: unknown }
      : observation.output as { files?: unknown } | undefined;
    if (!Array.isArray(output?.files)) return [];
    return output.files.flatMap((file) => {
      if (typeof file === 'string') return [file];
      if (file && typeof file === 'object' && typeof (file as { path?: unknown }).path === 'string') {
        return [(file as { path: string }).path];
      }
      return [];
    });
  } catch {
    return [];
  }
}

/**
 * Baseline verification is allowed only after every existing modifiable
 * source target is confirmed present by a successful Read or workspace scan.
 */
export function getUninspectedBaselineVerificationTargets(
  state: Pick<ReactState, 'steps' | 'taskAnalysis' | 'continuationHandoff'> &
    Partial<Pick<ReactState, 'workspace' | 'evidenceStartStep'>>,
): string[] {
  const analysis = state.taskAnalysis;
  if (!analysis) return [];
  const affectedFiles = Array.isArray(analysis.affectedFiles) ? analysis.affectedFiles : [];
  const affectedSources = affectedFiles.filter((file) =>
    file.intent !== 'read_only' && isSourcePath(file.path, state),
  );
  if (affectedSources.length === 0) return [];

  const inspectedPaths = new Set<string>();
  for (const step of getTaskEvidenceSteps(state)) {
    if (!successfulStep(step)) continue;
    if (step.action === 'Read') {
      const target = stepPath(step);
      if (target) inspectedPaths.add(normalizeEvidencePath(target, state.workspace));
    }
    for (const target of workspaceChangePaths(step)) {
      inspectedPaths.add(normalizeEvidencePath(target, state.workspace));
    }
  }

  return affectedSources
    .filter((file) => file.intent === 'modify' && !inspectedPaths.has(normalizeEvidencePath(file.path, state.workspace)))
    .map((file) => file.path);
}

export function hasBaselineVerificationEvidence(
  state: Pick<ReactState, 'steps' | 'taskAnalysis' | 'continuationHandoff'> &
    Partial<Pick<ReactState, 'workspace' | 'evidenceStartStep'>>,
): boolean {
  const analysis = state.taskAnalysis;
  if (!analysis) return false;
  const affectedSources = (Array.isArray(analysis.affectedFiles) ? analysis.affectedFiles : [])
    .filter((file) => file.intent !== 'read_only' && isSourcePath(file.path, state));
  if (affectedSources.length === 0 || affectedSources.some((file) => file.intent !== 'modify')) return false;
  return getUninspectedBaselineVerificationTargets(state).length === 0;
}

export function hasRelevantInspectionEvidence(state: Pick<ReactState, 'steps' | 'taskAnalysis' | 'continuationHandoff'>, filePath?: string): boolean {
  const expected = filePath?.replace(/\\/g, '/').replace(/^\.\//, '');
  return getTaskEvidenceSteps(state).some((step) => {
    if (!successfulStep(step) || step.action !== 'Read') return false;
    const path = stepPath(step);
    if (!path) return false;
    if (expected) return path === expected;
    return isSourcePath(path, state);
  });
}

/** A successful empty root listing is sufficient inspection for a create task. */
export function hasEmptyWorkspaceInspectionEvidence(state: Pick<ReactState, 'steps' | 'continuationHandoff'>): boolean {
  return getTaskEvidenceSteps(state).some((step) => {
    if (!successfulStep(step)) return false;
    const isRootListing = step.action === 'Glob' ||
      (step.action === 'Command' && step.action_input?.operation === 'list_directory');
    if (!isRootListing) return false;

    try {
      const observation = JSON.parse(step.observation || '{}') as { output?: unknown };
      return typeof observation.output === 'string' && observation.output.trim() === '';
    } catch {
      return false;
    }
  });
}

export function hasSuccessfulSourceMutation(
  state: Pick<ReactState, 'steps' | 'taskAnalysis' | 'continuationHandoff'> &
    Partial<Pick<ReactState, 'workspace' | 'evidenceStartStep'>>,
): boolean {
  const currentMutation = getTaskEvidenceSteps(state).some((step) => successfulStep(step) &&
    (step.action === 'Write' || step.action === 'Edit') && isSourcePath(stepPath(step), state));
  if (currentMutation) return true;

  const handoff = state.continuationHandoff;
  const affectedFiles = Array.isArray(state.taskAnalysis?.affectedFiles)
    ? state.taskAnalysis.affectedFiles
    : [];
  if (!handoff || handoff.workspaceRebased || affectedFiles.length === 0) return false;
  const currentTargets = affectedFiles
    .filter((file) => file.intent !== 'read_only' && isSourcePath(file.path, state))
    .map((file) => normalizeEvidencePath(file.path, state.workspace));
  return (handoff.updatedFiles || []).some((file) =>
    currentTargets.includes(normalizeEvidencePath(file, state.workspace)),
  );
}

export function requiresSourceMutation(state: Pick<ReactState, 'taskAnalysis'>): boolean {
  const contractRequirement = state.taskAnalysis?.contract?.completionEvidenceRequirements?.requireSourceMutationForFeatureCompletion;
  if (contractRequirement === true) return true;
  // Older persisted contracts can incorrectly describe a mutable task as
  // docs_only or explicitly disable the mutation flag. The expected change
  // intent is the stronger signal: anything other than read_only must still
  // reach a source mutation before the agent can complete.
  if (state.taskAnalysis?.expectedChangeIntent && state.taskAnalysis.expectedChangeIntent !== 'read_only') {
    return true;
  }
  // Documentation-only tasks remain exempt when their intent is explicitly
  // read-only or when no mutable intent was recorded at all.
  if (state.taskAnalysis?.taskKind === 'docs_only') return false;
  if (contractRequirement !== undefined) return contractRequirement;
  return state.taskAnalysis?.expectedChangeIntent !== 'read_only';
}

export function requiresApplicableVerification(state: Pick<ReactState, 'taskAnalysis'>): boolean {
  const contractRequirement = state.taskAnalysis?.contract?.completionEvidenceRequirements.requireVerificationForCompletion;
  if (contractRequirement !== undefined) return contractRequirement;
  return state.taskAnalysis?.expectedChangeIntent !== 'read_only' && state.taskAnalysis?.taskKind !== 'docs_only';
}

/** Hard evidence required before entering a terminal state. */
export function getStateEntryGateFailure(state: Pick<ReactState, 'task' | 'workspace' | 'steps' | 'taskAnalysis' | 'codingState' | 'continuationHandoff'> & Partial<Pick<ReactState, 'evidenceStartStep'>>, target: CodingState): string | null {
  if (target === 'understand' && !state.task.trim()) return 'Cannot enter understand: an actionable task is required.';
  if (target === 'discover' && !state.workspace.trim()) return 'Cannot enter discover: a workspace is required.';
  const inspectedEmptyCreateWorkspace = state.taskAnalysis?.expectedChangeIntent === 'create' &&
    hasEmptyWorkspaceInspectionEvidence(state);
  // Without a classified affected-file set, treating every non-source
  // document as insufficient evidence can trap a run in an inspection loop.
  if (target === 'implement' && state.taskAnalysis && requiresSourceMutation(state) &&
      !hasRelevantInspectionEvidence(state) && !inspectedEmptyCreateWorkspace) {
    return 'Cannot enter implement: inspect a relevant source file before mutation.';
  }
  if (target === 'verify' && requiresSourceMutation(state) &&
      !hasSuccessfulSourceMutation(state) && !hasBaselineVerificationEvidence(state)) {
    return 'Cannot enter verify: successful source mutation evidence or inspection of every existing modifiable source target is required.';
  }
  if (target === 'review' && requiresApplicableVerification(state) && !hasSuccessfulVerificationEvidence(state)) {
    return 'Cannot enter review: applicable successful verification evidence is required.';
  }
  if (target === 'complete') {
    if (requiresSourceMutation(state) &&
        !hasSuccessfulSourceMutation(state) && !hasBaselineVerificationEvidence(state)) {
      return 'Cannot complete: successful source mutation evidence or baseline source evidence is required.';
    }
    if (requiresApplicableVerification(state) && !hasSuccessfulVerificationEvidence(state)) return 'Cannot complete: applicable successful verification evidence is required.';
    if ((state.codingState || assessCodingState(state).state) !== 'review') return 'Cannot complete: independent review state has not been reached.';
  }
  return null;
}

/** Exit evidence for a state is the entry evidence of its destination. */
export function getStateExitGateFailure(state: Pick<ReactState, 'task' | 'workspace' | 'steps' | 'taskAnalysis' | 'codingState' | 'continuationHandoff'> & Partial<Pick<ReactState, 'evidenceStartStep'>>, from: CodingState, to: CodingState): string | null {
  if (!isCodingStateTransitionAllowed(from, to)) return `Cannot transition from ${from} to ${to}.`;
  return getStateEntryGateFailure(state, to);
}

function recoveryStateForGateFailure(target: CodingState): CodingState {
  if (target === 'implement') return 'inspect';
  if (target === 'verify') return 'inspect';
  if (target === 'review') return 'verify';
  if (target === 'complete') return 'review';
  return 'blocked';
}

export function hasSuccessfulVerificationEvidence(state: Pick<ReactState, 'steps' | 'continuationHandoff'> & Partial<Pick<ReactState, 'evidenceStartStep'>>): boolean {
  const steps = getTaskEvidenceSteps(state);
  let latestMutationIndex = -1;
  for (let index = 0; index < steps.length; index += 1) {
    if (successfulStep(steps[index]) && (steps[index].action === 'Write' || steps[index].action === 'Edit')) {
      latestMutationIndex = index;
    }
  }
  return steps.some((step, index) =>
    index > latestMutationIndex &&
    successfulStep(step) &&
    isVerificationAction(step.action, step.action_input)
  );
}

export function assessCodingState(state: Pick<ReactState, 'steps' | 'taskAnalysis' | 'continuationHandoff'> & Partial<Pick<ReactState, 'workspace' | 'evidenceStartStep'>>): CodingStateAssessment {
  const steps = getCurrentTaskSteps(state);
  const evidenceSteps = getTaskEvidenceSteps(state);
  const successful = evidenceSteps.filter(successfulStep);
  const inspected = successful.some((step) => ['Read', 'DocumentRead', 'Glob', 'Grep', 'WorkspaceChanges'].includes(step.action));
  const relevantInspected = hasRelevantInspectionEvidence(state);
  const mutated = successful.some((step) => ['Write', 'Edit'].includes(step.action) ||
    (step.action === 'Bash' && /\b(copy-item|new-item|set-content|add-content|out-file|move-item|rename-item)\b/i.test(String(step.action_input?.command || ''))));
  const verified = hasSuccessfulVerificationEvidence(state);
  const sourceMutated = hasSuccessfulSourceMutation(state);
  const baselineReady = !sourceMutated && requiresSourceMutation(state) && hasBaselineVerificationEvidence(state);
  const last = steps[steps.length - 1];
  const latestObservation = last?.observation || '';
  const explicitBlock = Boolean(
    last && (/before initializing git|permission denied/i.test(latestObservation) || observationRequiresApproval(latestObservation))
  );
  const repeatedFailure = repeatedFailureReason(state);
  const blocked = explicitBlock || Boolean(repeatedFailure);
  const recovery = classifyRecoveryTransition(last);
  const signature = last ? actionSignature(last) : undefined;
  const noProgressCount = countRepeatedSuccessfulInspectionEvidence(steps);
  const evidence = { inspected, relevantInspected, mutated, sourceMutated, verified, blocked };
  if (blocked) return {
    state: 'blocked',
    noProgressCount,
    actionSignature: signature,
    blockReason: repeatedFailure || 'External confirmation or permission is required before continuing.',
    evidence,
  };
  if (recovery === 'repair') return { state: 'repair', noProgressCount, actionSignature: signature, evidence };
  if (recovery === 'inspect' || recovery === 'retry' || recovery === 'summarize') return { state: recovery === 'retry' ? 'repair' : 'inspect', noProgressCount, actionSignature: signature, evidence };
  if ((mutated || sourceMutated || baselineReady) && verified && !getStateEntryGateFailure({ ...state, codingState: 'verify', task: 'active', workspace: state.workspace || 'active' }, 'review')) return { state: 'review', noProgressCount, actionSignature: signature, evidence };
  if (mutated || sourceMutated || baselineReady) return { state: 'verify', noProgressCount, actionSignature: signature, evidence };
  if (noProgressCount >= 3) return { state: inspected ? 'implement' : 'discover', noProgressCount, actionSignature: signature, evidence };
  if (inspected) return { state: 'implement', noProgressCount, actionSignature: signature, evidence };
  return { state: steps.length ? 'discover' : 'understand', noProgressCount, actionSignature: signature, evidence };
}

export type ReactResult = EngineReactResult<ReactState>;

export type ReactConfig = ReActEngineConfig<
  ReactState,
  AgentStreamEvent,
  ReactCheckpoint,
  CoderTaskAnalysis,
  RuntimeTaskRouting,
  ApprovalScopeGrant,
  ContinuationHandoff,
  Record<string, any>
>;

/**
 * Initialize a new ReAct state from task and config
 */
export function initializeState(
  task: string,
  config: Required<ReactConfig>
): ReactState {
  return {
    task,
    workspace: config.workspace,
    model: config.model,
    modelContextWindow: config.contextWindow > 0 ? config.contextWindow : undefined,
    providerProfile: config.geminiProfileId,
    llmUsage: {
      requestCount: 0,
      retryCount: 0,
      cacheHits: 0,
      inputTokens: 0,
      outputTokens: 0,
      lastEstimatedPromptTokens: undefined,
    },
    taskAnalysis: config.taskAnalysis,
    taskRouting: config.taskRouting,
    pacingProfile: config.pacingProfile,
    continuationHandoff: config.continuationHandoff,
    approvalGrants: config.approvalGrantProvider?.() || [],
    plan: [],
    todoRevision: 0,
    steps: [],
    answeredUserQuestions: [],
    forceMutationNextAction: false,
    forceMutationTarget: undefined,
    forceReadNextAction: false,
    consecutiveDecisionMismatchCount: 0,
    current_step: 0,
    max_steps: config.maxSteps,
    globalStepLimit: config.globalStepLimit,
    globalStepCount: 0,
    stepWindowStart: 0,
    stepWindowLimit: config.maxSteps,
    runStartedAt: config.runStartedAt || Date.now(),
    wallClockBudgetMs: config.wallClockBudgetMs,
    maxRecoveryTransitions: config.maxRecoveryTransitions,
    total_pollen_cost: 0,
    budget: config.budget,
    repairAttempts: 0,
    toolEvidence: [],
    codingState: 'understand',
    noProgressCount: 0,
    consecutiveEditFailureCount: 0,
    consecutiveEditFailureTarget: undefined,
    codingStateStartedStep: 0,
    codingStateStartedAt: Date.now(),
  };
}

/**
 * Add a step to the state
 */
export function addStep(state: ReactState, step: ReactStep): void {
  const previousState = state.codingState || 'understand';
  state.steps.push(step);
  state.current_step++;
  const priorGlobalStepCount = Number.isFinite(Number(state.globalStepCount))
    ? Math.max(0, Number(state.globalStepCount))
    : 0;
  // A restored/legacy state may have a stale global cursor. Never let a
  // checkpoint with more recorded actions regain budget by reporting zero.
  state.globalStepCount = Math.max(
    priorGlobalStepCount + 1,
    state.current_step,
    state.steps.length,
  );
  const assessment = assessCodingState(state);
  // Actions can produce evidence for more than one conceptual phase. Enforce
  // the destination evidence gate here; transition-table validation remains
  // available to callers that perform explicit one-state transitions.
  const gateFailure = getStateEntryGateFailure(state, assessment.state);
  state.codingState = gateFailure ? recoveryStateForGateFailure(assessment.state) : assessment.state;
  state.blockedReason = state.codingState === 'blocked' ? assessment.blockReason : undefined;
  state.noProgressCount = assessment.noProgressCount;
  state.lastActionSignature = assessment.actionSignature;
  if (assessment.state !== previousState || state.codingStateStartedStep === undefined) {
    state.codingStateStartedStep = state.current_step;
    state.codingStateStartedAt = Date.now();
  }
}
