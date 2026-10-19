/**
 * Executor Module
 * Handles tool execution and observation generation
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { createHash, randomUUID } from 'crypto';
import { redactPolicyText } from '@barok/core';
import type { ToolRegistry } from '../di/types.js';
import type { CoderTaskAnalysis, FileChangeIntent } from '../coder/taskAnalysis.js';
import { getReferencedWebAssetRecoveryTarget, hasBaselineVerificationEvidence, hasSuccessfulSourceMutation, requiresSourceMutation, type AgentStreamEvent } from './state-manager.js';
import type { ReactStep, RunScopedWorkspaceCapability } from '@barok/engine';
import type { ContinuationHandoff } from './continuation.js';
import { dispatchTool, getAvailableTools } from './tool-router.js';
import { persistLargeObservationIfNeeded } from './tool-result-storage.js';
import { normalizeAgentDecision, validateNormalizedAction } from '@barok/engine';
import { evaluatePolicy, recordPolicyDecision, type PermissionMode, type PolicyAuditRecord, type PolicyContext } from '../tools/permissionPolicy.js';
import { applyFirstClassFileOperation } from '../tools/fileEditOperations.js';
import {
  getWorkspaceRelativePath,
  isManagedTemporaryWorkspacePath,
  isRunScopedWorkspaceAuthorized,
  validateAndResolvePath,
} from '@barok/adapter-node';
import { isStructuredDocumentPath } from '../tools/documentReader.js';
import { scanDirtyTree, type DirtyTreeState } from '@barok/adapter-node';
import { validatePlannedChanges } from '../repo/overwritePreventionPlan.js';
import { isReadOnlySourceDocumentMutation, isVerificationAction, type ToolAction } from '@barok/engine';
import { runWithWorkspace } from '../tools/devTools.js';
import { compactObservation, freeTierCompactionThreshold } from './observationCompactor.js';
import { getToolCapabilities } from '@barok/engine';
import { decodeBase64Utf8 } from '../tools/textIntegrity.js';
import { executeWithTimeout, formatTimeoutError, getToolTimeout } from '../tools/executionTimeout.js';
import type { PlanApprovalState } from '@barok/engine';
import type { CapabilityScope } from './capability-scope.js';
import {
  normalizeToolResult,
  parseStructuredToolResult,
  serializeToolResult,
  type HarnessInterventionEvidence,
  ToolEvidenceLedger,
  ToolExecutionScheduler,
  ToolExecutionState,
} from './tool-contract.js';

export type { ToolAction } from '@barok/engine';
export { isReadOnlySourceDocumentMutation };

export interface ExecutionGuardContext {
  taskAnalysis?: CoderTaskAnalysis;
  priorSteps?: ReactStep[];
  workspace?: string;
  continuationHandoff?: ContinuationHandoff;
  evidenceStartStep?: number;
  policy?: Partial<Omit<PolicyContext, 'workspace' | 'mode'>> & { mode?: PermissionMode };
  policyAudit?: PolicyAuditRecord[];
  /** Called only after authoritative policy approval and before dispatch. */
  onAuthorized?: (action: ToolAction) => void;
  /** Receives a path-normalized action so persisted continuation state is safe to replay. */
  onActionNormalized?: (action: ToolAction) => void;
  /** Enables the engine-owned transactional file mutation path. */
  useTransactionalEdits?: boolean;
  /** Optional snapshot supplied by a caller that already scanned the working tree. */
  dirtyTree?: DirtyTreeState;
  /** Snapshot of dirty files present before this run started. */
  dirtyTreeBaseline?: DirtyTreeState;
  /** Durable per-run tool evidence and denial retry state. */
  toolEvidenceLedger?: ToolEvidenceLedger;
  /** Emits ordered run stream events from executor guard boundaries. */
  onEvent?: (event: AgentStreamEvent) => void;
  /** Internal callback used to attach a guard rejection to this invocation's evidence. */
  onHarnessIntervention?: (intervention: HarnessInterventionEvidence) => void;
  /** One-based ReAct step sequence associated with this tool decision. */
  stepSeq?: number;
  toolExecutionState?: ToolExecutionState;
  /** Serializes mutations while allowing independent read-only actions to overlap. */
  toolScheduler?: ToolExecutionScheduler;
  /** Immutable run scope passed to handlers that own run-scoped resources. */
  scope?: CapabilityScope;
  /** Stable identity supplied by the model/event transport for this call. */
  toolCallId?: string;
  /** Bounded retries for explicitly retryable, idempotent failures. */
  toolRetryLimit?: number;
  planApproval?: PlanApprovalState;
  runId?: string;
  runScopedWorkspaceCapability?: RunScopedWorkspaceCapability;
  /**
   * Pacing profile active for this task. When 'conservative' or 'phased',
   * `finalizeToolObservation` will apply a lower compaction threshold derived
   * from the model's declared context window instead of the global default.
   */
  pacingProfile?: 'automatic' | 'conservative' | 'phased' | 'fast';
  /**
   * Context window of the active model in tokens. Combined with `pacingProfile`
   * to compute a free-tier-specific `inputThreshold` for the observation
   * compactor. When absent or zero the compactor falls back to its global default.
   */
  modelContextWindow?: number;
}

const MUTATING_ACTIONS = new Set(['Write', 'Edit']);
const VERIFICATION_HELPER_PATH = /(?:^|[\\/])(?:verify|verification|check|test)(?:[-_.][\w.-]+)?\.(?:js|mjs|cjs|ts|py|sh)$/i;
const REQUIRED_INPUT_ACTIONS = new Set(['Read', 'Write', 'Edit', 'Bash']);

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function normalizePathForWorkspace(value: string, workspace?: string): string {
  const normalized = normalizePath(value);
  if (!workspace) return normalized;

  const normalizedWorkspace = normalizePath(path.resolve(workspace)).replace(/\/$/, '');
  const absolutePrefix = `${normalizedWorkspace}/`;
  if (normalized.toLowerCase().startsWith(absolutePrefix.toLowerCase())) {
    return normalized.slice(absolutePrefix.length);
  }

  if (path.isAbsolute(value)) {
    return normalizePath(path.relative(workspace, value));
  }

  return normalized;
}

function getActionFilePath(action: ToolAction): string | undefined {
  const input = action.action_input || {};
  const filePath = input.file_path ?? input.path ?? input.filename ?? input.file;
  return typeof filePath === 'string' && filePath.trim()
    ? normalizePath(filePath.trim())
    : undefined;
}

/**
 * PDF/DOCX files can be inspected through DocumentRead, but they are not
 * valid mutation targets for the text-file Write/Edit tools. Keep this
 * invariant at the executor boundary so it also applies when task analysis
 * is missing or stale during a continuation.
 */
function readOnlySourceDocumentMutationError(action: ToolAction): string | undefined {
  if (!isReadOnlySourceDocumentMutation(action)) return undefined;
  const filePath = getActionFilePath(action) || 'the source document';
  return `Mutation rejected: ${filePath} is a read-only source document. Use DocumentRead to inspect it, then Write or Edit the website source file instead.`;
}

function normalizeToolAction(action: ToolAction): ToolAction {
  const input = { ...(action.action_input || {}) };

  if (
    (action.action === 'Read' || action.action === 'Write' || action.action === 'Edit') &&
    typeof input.file_path !== 'string'
  ) {
    const filePathAlias = input.path ?? input.filename ?? input.file;
    if (typeof filePathAlias === 'string') {
      input.file_path = filePathAlias;
    }
  }

  if (action.action === 'Edit') {
    if (typeof input.old_string !== 'string') {
      const oldStringAlias = input.old_str ?? input.search ?? input.search_string ?? input.original;
      if (typeof oldStringAlias === 'string') {
        input.old_string = oldStringAlias;
      }
    }
    if (typeof input.new_string !== 'string') {
      const newStringAlias = input.new_str ?? input.replace ?? input.replacement ?? input.replacement_string;
      if (typeof newStringAlias === 'string') {
        input.new_string = newStringAlias;
      }
    }
  }

  if (action.action === 'Read' && input.offset === 0) {
    input.offset = 1;
  }

  return {
    ...action,
    action_input: input,
  };
}

function correctedTaskDeclaredPath(filePath: string, context: ExecutionGuardContext): string | undefined {
  const workspace = context.workspace || context.taskAnalysis?.workspace || process.cwd();
  const value = filePath.trim();
  const expandedTemp = value
    .replace(/^%TEMP%(?=[\\/]|$)/i, tmpdir())
    .replace(/^%TMP%(?=[\\/]|$)/i, tmpdir());
  const absolute = path.isAbsolute(expandedTemp) || /^[a-zA-Z]:[\\/]/.test(expandedTemp);
  const syntheticTemp = isManagedTemporaryWorkspacePath(expandedTemp);
  // A temp-root prefix never grants access or path correction. Temp space is
  // valid only when that exact, created root is already bound as this run's
  // active workspace capability.
  if (/%(?:TEMP|TMP|TEMPORARY)%(?:[\\/]|$)/i.test(value) ||
      /^\$(?:TMPDIR|TEMP|TMP)(?:[\\/]|$)/i.test(value) || syntheticTemp) return undefined;
  // An absolute path in a different workspace must be corrected by the caller.
  if (absolute) return undefined;

  const normalizedValue = expandedTemp
    .replace(/^file:\/\//i, '')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .toLowerCase();
  const declared = context.taskAnalysis?.affectedFiles || [];
  const declaredPaths = new Map<string, string>();
  for (const file of declared) {
    try {
      const relativePath = getWorkspaceRelativePath(file.path, workspace);
      declaredPaths.set(relativePath.toLowerCase(), relativePath);
    } catch {
      // Invalid task scope entries are not correction targets.
    }
  }
  const exactCandidates = [...declaredPaths.entries()]
    .filter(([candidate]) => normalizedValue === candidate)
    .map(([, relativePath]) => relativePath);
  if (exactCandidates.length === 1) return exactCandidates[0];
  if (exactCandidates.length > 1) return undefined;

  const uniqueCandidates = [...declaredPaths.entries()]
    .filter(([candidate]) => normalizedValue.endsWith(`/${candidate}`) ||
      path.posix.basename(normalizedValue) === path.posix.basename(candidate))
    .map(([, relativePath]) => relativePath);
  return uniqueCandidates.length === 1 ? uniqueCandidates[0] : undefined;
}

function withoutMutationTarget(action: ToolAction): ToolAction {
  const actionInput = { ...(action.action_input || {}) };
  delete actionInput.file_path;
  delete actionInput.path;
  delete actionInput.filename;
  delete actionInput.file;
  return { ...action, action_input: actionInput };
}

function normalizeMutationPath(action: ToolAction, context: ExecutionGuardContext): {
  action: ToolAction;
  error?: string;
} {
  if (!MUTATING_ACTIONS.has(action.action)) return { action };
  const filePath = getActionFilePath(action);
  if (!filePath) return { action };
  const workspace = context.workspace || context.taskAnalysis?.workspace || process.cwd();

  try {
    const relativePath = getWorkspaceRelativePath(filePath, workspace);
    return {
      action: {
        ...action,
        action_input: { ...action.action_input, file_path: relativePath },
      },
    };
  } catch {
    const corrected = correctedTaskDeclaredPath(filePath, context);
    if (corrected) {
      try {
        // Path correction consumes exactly one scoped normalization attempt.
        // The returned action then passes through the ordinary permission,
        // task-analysis, canonical-path, and tool checks below.
        const relativePath = getWorkspaceRelativePath(corrected, workspace);
        return {
          action: {
            ...action,
            action_input: { ...action.action_input, file_path: relativePath },
          },
        };
      } catch {
        // The active workspace changed or the declared path is unsafe; fail closed.
      }
    }
    return {
      action: withoutMutationTarget(action),
      error: 'Mutation rejected because its target is not a uniquely declared path inside the active workspace. Correct the workspace or resubmit a scoped path.',
    };
  }
}

async function activeTemporaryWorkspaceError(context: ExecutionGuardContext): Promise<string | undefined> {
  const workspace = context.workspace || context.taskAnalysis?.workspace || process.cwd();
  if (!isManagedTemporaryWorkspacePath(workspace)) return undefined;
  const authorized = await isRunScopedWorkspaceAuthorized({
    capability: context.runScopedWorkspaceCapability,
    workspace,
    taskWorkspace: context.taskAnalysis?.workspace,
    runId: context.runId,
  });
  return authorized
    ? undefined
    : 'Run rejected because a temporary workspace is not an active, harness-created capability bound to this task and run.';
}

function normalizeWriteMode(action: ToolAction, context: ExecutionGuardContext): ToolAction {
  if (action.action !== 'Write') {
    return action;
  }
  const filePath = getActionFilePath(action);
  if (!filePath) return action;
  try {
    const workspace = context.workspace || context.taskAnalysis?.workspace || process.cwd();
    const targetExists = existsSync(validateAndResolvePath(filePath, workspace));
    const affectedFile = context.taskAnalysis?.affectedFiles.find(
      (file) => normalizePathForWorkspace(file.path, workspace) === normalizePathForWorkspace(filePath, workspace),
    );
    const missingReadRecovery = Boolean(
      affectedFile &&
      affectedFile.intent !== 'read_only' &&
      affectedFile.intent !== 'delete' &&
      affectedFile.intent !== 'rename' &&
      hasMissingReadFailure(filePath, context.priorSteps, workspace)
    );
    if ((targetExists === false && isScopedMissingWrite(action, affectedFile, targetExists)) || missingReadRecovery) {
      return {
        ...action,
        action_input: {
          ...action.action_input,
          allowCreate: true,
          allowOverwrite: false,
        },
      };
    }
    if (action.action_input?.allowCreate !== true || action.action_input?.allowOverwrite !== true) {
      return action;
    }
    return {
      ...action,
      action_input: {
        ...action.action_input,
        allowCreate: !targetExists,
        allowOverwrite: targetExists,
      },
    };
  } catch {
    return action;
  }
}

function validateRequiredToolInput(action: ToolAction): string | null {
  if (!REQUIRED_INPUT_ACTIONS.has(action.action)) return null;

  const input = action.action_input || {};
  if (action.action === 'Bash') {
    return typeof input.command === 'string' && input.command.trim()
      ? null
      : 'Invalid Bash action: command is required.';
  }

  const filePath = getActionFilePath(action);
  if (!filePath) {
    return `Invalid ${action.action} action: file_path is required.`;
  }

  if (action.action === 'Write') {
    const hasContent = typeof input.content === 'string' || typeof input.content_base64 === 'string';
    return hasContent ? null : 'Invalid Write action: content or content_base64 is required.';
  }

  if (action.action === 'Edit') {
    const hasStrings = typeof input.old_string === 'string' && typeof input.new_string === 'string';
    return hasStrings ? null : 'Invalid Edit action: old_string and new_string are required.';
  }

  return null;
}

function maybeSkipUnavailableVerification(action: ToolAction, context: ExecutionGuardContext): string | null {
  if (action.action !== 'Bash') return null;
  const command = String(action.action_input?.command || '');
  if (!/\bnpm\s+run\s+(test(?::unit)?|build)\b/i.test(command) && !/\bnpm\s+test\b/i.test(command)) {
    return null;
  }

  const cwdInput = typeof action.action_input?.cwd === 'string' ? action.action_input.cwd : context.workspace;
  const cwd = cwdInput
    ? path.resolve(context.workspace || process.cwd(), cwdInput)
    : context.workspace || process.cwd();
  if (existsSync(path.join(cwd, 'package.json'))) return null;

  return JSON.stringify({
    success: true,
    skipped: true,
    verificationUnavailable: true,
    output: `Verification unavailable: package.json not found in ${cwd}. Skipped "${command}" instead of running a known-failing npm command.`,
  });
}

function maybeSkipGitConfirmation(action: ToolAction, context: ExecutionGuardContext): string | null {
  if (action.action !== 'Bash') return null;
  const command = String(action.action_input?.command || '');
  if (!/\bgit\s+(?:status|log|diff|rev-parse|branch|ls-files)\b/i.test(command)) return null;
  const approvalPolicy = context.taskAnalysis?.approvalPolicy || 'ask';
  if (approvalPolicy === 'ask') return null;

  const cwdInput = typeof action.action_input?.cwd === 'string' ? action.action_input.cwd : context.workspace;
  const cwd = cwdInput
    ? path.resolve(context.workspace || process.cwd(), cwdInput)
    : context.workspace || process.cwd();
  if (existsSync(path.join(cwd, '.git'))) return null;

  return JSON.stringify({
    success: true,
    skipped: true,
    approvalPolicy,
    output: `No Git repository was detected in ${cwd}. Approval policy "${approvalPolicy}" is active, so this run will continue without asking for Git initialization.`,
  });
}

function hasPriorFileStateEvidence(filePath: string, priorSteps: ReactStep[] = [], workspace?: string): boolean {
  const normalizedTarget = normalizePathForWorkspace(filePath, workspace);
  return priorSteps.some((step) => {
    if (step.action !== 'Read' && step.action !== 'Write' && step.action !== 'Edit') return false;
    const readPath = typeof step.action_input?.file_path === 'string'
      ? step.action_input.file_path
      : typeof step.action_input?.path === 'string'
        ? step.action_input.path
        : undefined;
    if (!readPath || normalizePathForWorkspace(readPath, workspace) !== normalizedTarget) return false;
    if (!step.observation) return true;

    try {
      const parsed = JSON.parse(step.observation);
      if (parsed && typeof parsed === 'object' && 'success' in parsed) {
        return (parsed as { success?: unknown }).success !== false;
      }
    } catch {
      // Legacy text observations are treated as file-state evidence unless they plainly failed.
    }

    return !/error|failed|enoent/i.test(step.observation);
  });
}

/**
 * A failed targeted Read is actionable evidence when the tool explicitly
 * reports that the path is absent. Keep that recovery signal separate from
 * successful preimage evidence: a missing target may be created, while an
 * ordinary read or permission failure must still require a successful read.
 */
function hasMissingReadFailure(filePath: string, priorSteps: ReactStep[] = [], workspace?: string): boolean {
  const normalizedTarget = normalizePathForWorkspace(filePath, workspace);
  for (let index = priorSteps.length - 1; index >= 0; index -= 1) {
    const step = priorSteps[index];
    if (step.action !== 'Read' && step.action !== 'DocumentRead') continue;
    const readPath = typeof step.action_input?.file_path === 'string'
      ? step.action_input.file_path
      : typeof step.action_input?.path === 'string'
        ? step.action_input.path
        : undefined;
    if (!readPath || normalizePathForWorkspace(readPath, workspace) !== normalizedTarget) continue;

    const observation = step.observation || '';
    try {
      const parsed = JSON.parse(observation) as { success?: unknown; error?: unknown; output?: unknown };
      if (parsed.success !== false) return false;
      const detail = typeof parsed.error === 'string'
        ? parsed.error
        : typeof parsed.output === 'string' ? parsed.output : observation;
      return /(?:enoent|no such file|not found|does not exist|doesn't exist|cannot find|could not find|missing file)/i.test(detail);
    } catch {
      return /(?:enoent|no such file|not found|does not exist|doesn't exist|cannot find|could not find|missing file)/i.test(observation);
    }
  }
  return false;
}

function inferOperationIntent(action: ToolAction, fileIntent?: FileChangeIntent): FileChangeIntent {
  if (action.action === 'Edit') return 'modify';
  if (action.action !== 'Write') return 'unknown';

  const input = action.action_input || {};
  if (input.allowCreate === true && input.allowOverwrite !== true && input.append !== true) return 'create';
  if (input.allowOverwrite === true || input.append === true || typeof input.expectedHash === 'string') return 'modify';
  return fileIntent && fileIntent !== 'read_only' ? fileIntent : 'unknown';
}

function targetExistsForWrite(filePath: string, workspace: string): boolean | undefined {
  try {
    return existsSync(validateAndResolvePath(filePath, workspace));
  } catch {
    // Path validation will produce the authoritative error later. Do not
    // classify an invalid path as a safe create candidate here.
    return undefined;
  }
}

function isScopedMissingWrite(
  action: ToolAction,
  affectedFile: CoderTaskAnalysis['affectedFiles'][number] | undefined,
  targetExists: boolean | undefined,
): boolean {
  return action.action === 'Write'
    && targetExists === false
    && Boolean(affectedFile)
    && affectedFile!.intent !== 'read_only'
    && affectedFile!.intent !== 'delete'
    && affectedFile!.intent !== 'rename';
}

function getPriorKnownHash(filePath: string, priorSteps: ReactStep[] = [], workspace?: string): string | undefined {
  const normalizedTarget = normalizePathForWorkspace(filePath, workspace);
  for (let i = priorSteps.length - 1; i >= 0; i--) {
    const step = priorSteps[i];
    if (step.action !== 'Read' && step.action !== 'Write' && step.action !== 'Edit') continue;

    const readPath = typeof step.action_input?.file_path === 'string'
      ? step.action_input.file_path
      : typeof step.action_input?.path === 'string'
        ? step.action_input.path
        : undefined;
    if (!readPath || normalizePathForWorkspace(readPath, workspace) !== normalizedTarget) continue;

    const observation = step.observation || '';
    try {
      const parsed = JSON.parse(observation);
      if (parsed && typeof parsed === 'object' && (parsed as any).success === false) continue;
      if (
        (step.action === 'Write' || step.action === 'Edit') &&
        typeof (parsed as any)?.afterHash === 'string' &&
        /^[a-f0-9]{64}$/i.test((parsed as any).afterHash)
      ) {
        return (parsed as any).afterHash;
      }
      if (typeof (parsed as any)?.hash === 'string' && /^[a-f0-9]{64}$/i.test((parsed as any).hash)) {
        return (parsed as any).hash;
      }
      const output = typeof (parsed as any)?.output === 'string' ? (parsed as any).output : observation;
      const match = output.match(/\[guarded-read-hash:\s*([a-f0-9]{64})\]/i);
      if (match) return match[1];
    } catch {
      const match = observation.match(/\[guarded-read-hash:\s*([a-f0-9]{64})\]/i);
      if (match) return match[1];
    }
  }

  return undefined;
}

function intentAllowsOperation(fileIntent: FileChangeIntent, operationIntent: FileChangeIntent): boolean {
  if (fileIntent === 'unknown') return operationIntent !== 'delete' && operationIntent !== 'read_only';
  if (fileIntent === 'create') return operationIntent === 'create';
  if (fileIntent === 'modify') return operationIntent === 'modify';
  if (fileIntent === 'rename' || fileIntent === 'delete' || fileIntent === 'read_only') return false;
  return false;
}

export function validateActionAgainstTaskAnalysis(
  action: ToolAction,
  context: ExecutionGuardContext = {}
): string | null {
  const analysis = context.taskAnalysis;
  if (!analysis || !MUTATING_ACTIONS.has(action.action)) return null;

  const filePath = getActionFilePath(action);
  if (!filePath) {
    return `Mutation rejected: ${action.action} requires a file_path for task-analysis enforcement.`;
  }

  if (analysis.expectedChangeIntent === 'read_only') {
    return `Mutation rejected: task analysis classified this request as read-only (${analysis.taskKind}).`;
  }

  const workspace = context.workspace || analysis.workspace;
  const normalizedFilePath = normalizePathForWorkspace(filePath, workspace);
  const affectedFile = analysis.affectedFiles.find(
    (file) => normalizePathForWorkspace(file.path, workspace) === normalizedFilePath
  );
  const wasInspected = hasPriorFileStateEvidence(filePath, context.priorSteps, workspace);
  const referencedWebAssetTarget = getReferencedWebAssetRecoveryTarget(
    filePath,
    analysis,
    context.priorSteps || [],
    workspace,
  );
  const referencedWebAssetCreate = Boolean(
    action.action === 'Write' &&
    action.action_input?.allowCreate === true &&
    action.action_input?.allowOverwrite !== true &&
    targetExistsForWrite(filePath, workspace) === false &&
    referencedWebAssetTarget &&
    normalizePathForWorkspace(referencedWebAssetTarget, workspace) === normalizedFilePath,
  );
  if (!affectedFile && VERIFICATION_HELPER_PATH.test(filePath)) {
    return `Mutation rejected: ${filePath} is not a declared task output. Do not create or inspect an unrequested verification helper to expand scope. Use Command operation "verify" or the project's existing test command.`;
  }
  // A feature classified as "create" may still need to update an existing file
  // (for example, add a link to index.html). A successful read is explicit
  // evidence that this particular target is an existing-file modification.
  const isInspectedEdit = wasInspected && (action.action === 'Edit' || (action.action === 'Write' && action.action_input?.allowOverwrite === true));
  const expectedIntent = affectedFile?.intent
    ? (isInspectedEdit && affectedFile.intent === 'delete' ? 'modify' : affectedFile.intent)
    : (wasInspected && (analysis.expectedChangeIntent === 'create' || analysis.expectedChangeIntent === 'delete') ? 'modify' : analysis.expectedChangeIntent);
  const bothWriteModes = action.action === 'Write' && action.action_input?.allowCreate === true && action.action_input?.allowOverwrite === true;
  const targetExists = action.action === 'Write' ? targetExistsForWrite(filePath, workspace) : true;
  const missingReadRecovery = Boolean(
    action.action === 'Write' &&
    affectedFile &&
    affectedFile.intent !== 'read_only' &&
    affectedFile.intent !== 'delete' &&
    affectedFile.intent !== 'rename' &&
    hasMissingReadFailure(filePath, context.priorSteps, workspace)
  );
  const scopedMissingWrite = isScopedMissingWrite(action, affectedFile, targetExists) ||
    (missingReadRecovery && action.action_input?.allowCreate === true && action.action_input?.allowOverwrite !== true);
  const operationIntent = scopedMissingWrite || referencedWebAssetCreate
    ? 'create'
    : bothWriteModes
      ? (wasInspected ? 'modify' : 'create')
      : inferOperationIntent(action, expectedIntent);
  const isBroadCreate = !affectedFile &&
    analysis.expectedChangeIntent === 'create' &&
    action.action === 'Write' &&
    operationIntent === 'create';
  // Full-access tasks may legitimately discover new in-workspace files while
  // implementing a broad request ("add more pages"). The filesystem policy
  // still confines the target to the workspace, and Write still requires an
  // explicit create mode; existing-file edits continue to require inspection.
  const isFullAccessDiscoveredCreate = !affectedFile &&
    analysis.approvalPolicy === 'full_access' &&
    action.action === 'Write' &&
    operationIntent === 'create';

  if (isFullAccessDiscoveredCreate) return null;

  if (!affectedFile && !wasInspected && !isBroadCreate && !referencedWebAssetCreate) {
    return `Mutation rejected: ${filePath} is not in affected files and has not been read during this run.`;
  }

  const requiresReadBeforeMutation = operationIntent !== 'create' && affectedFile?.mustReadBeforeEdit !== false;
  if (requiresReadBeforeMutation && !wasInspected) {
    return `Mutation rejected: ${filePath} must be successfully read during this run before it is changed.`;
  }

  const operationMatchesAnalysis = intentAllowsOperation(expectedIntent, operationIntent)
    || referencedWebAssetCreate
    // Task-level "modify" means change this scoped target if it exists; a
    // missing target must be materialized as a create before it can be edited.
    || (scopedMissingWrite && operationIntent === 'create' && expectedIntent === 'modify')
    // A delete/removal task legitimately edits inspected existing files
    // to remove unwanted code, styles, or references.
    || (isInspectedEdit && operationIntent === 'modify' && (affectedFile?.intent === 'delete' || analysis.expectedChangeIntent === 'delete'));
  if (!operationMatchesAnalysis) {
    return `Mutation rejected: ${action.action} on ${filePath} is ${operationIntent}, but task analysis expects ${expectedIntent}.`;
  }

  return null;
}

function validateActionEvidenceGate(action: ToolAction, context: ExecutionGuardContext): string | null {
  if (!context.taskAnalysis || !isVerificationAction(action.action, action.action_input)) return null;
  const state = {
    taskAnalysis: context.taskAnalysis,
    steps: context.priorSteps || [],
    workspace: context.workspace || context.taskAnalysis.workspace,
    continuationHandoff: context.continuationHandoff,
    evidenceStartStep: context.evidenceStartStep,
  };
  if (requiresSourceMutation(state) &&
      !hasSuccessfulSourceMutation(state) && !hasBaselineVerificationEvidence(state)) {
    return 'Verification rejected: successful source mutation evidence or inspection of every existing modifiable source target is required before applicable verification.';
  }
  return null;
}

function taskAnalysisGateEvidence(error: string): { gateName: HarnessInterventionEvidence['gateName']; requiredEvidence: string[] } {
  if (/ is (?:create|modify|delete|read_only), but task analysis expects /i.test(error)) {
    const expectedIntent = error.match(/task analysis expects ([\w-]+)/i)?.[1];
    return {
      gateName: 'intent_mismatch',
      requiredEvidence: [expectedIntent
        ? `An operation consistent with the ${expectedIntent} task-analysis intent.`
        : 'An operation consistent with the task-analysis intent.'],
    };
  }
  if (/must be successfully read/i.test(error)) {
    return { gateName: 'task_analysis_guard', requiredEvidence: ['A successful Read of the target during this run.'] };
  }
  if (/not in affected files/i.test(error)) {
    return { gateName: 'task_analysis_guard', requiredEvidence: ['A target within the analyzed affected-file scope or a successful Read during this run.'] };
  }
  return { gateName: 'task_analysis_guard', requiredEvidence: ['An action within the task-analysis scope and evidence requirements.'] };
}

function emitHarnessIntervention(
  action: ToolAction,
  context: ExecutionGuardContext,
  gateName: HarnessInterventionEvidence['gateName'],
  reason: string,
  requiredEvidence: string[],
): void {
  context.onHarnessIntervention?.({
    gateName,
    reason: reason.replace(/\s+/g, ' ').trim().slice(0, 500),
    requiredEvidence: requiredEvidence.slice(0, 5).map((item) => item.replace(/\s+/g, ' ').trim().slice(0, 160)),
    targetAction: action.action.slice(0, 120),
    stepSeq: Number.isSafeInteger(context.stepSeq) && Number(context.stepSeq) > 0 ? Number(context.stepSeq) : 0,
  });
}

function contentForWrite(input: Record<string, unknown>): string | null {
  if (typeof input.content === 'string') return input.content;
  if (typeof input.content_base64 === 'string') {
    return decodeBase64Utf8(input.content_base64).content ?? null;
  }
  return null;
}

/**
 * Read is a common legacy/model alias for inspecting a source document. Route
 * binary document reads through the extraction tool before dispatch so the
 * model cannot get stuck repeating a Read -> "use DocumentRead" failure.
 */
function normalizeStructuredDocumentRead(action: ToolAction, allowedTools: string[]): ToolAction {
  if (action.action !== 'Read' || !allowedTools.includes('DocumentRead')) return action;
  const filePath = getActionFilePath(action);
  if (!filePath || !isStructuredDocumentPath(filePath)) return action;

  return {
    action: 'DocumentRead',
    action_input: {
      ...action.action_input,
      file_path: filePath,
    },
  };
}

function dirtyFileAtPath(tree: DirtyTreeState | undefined, filePath: string, workspace: string): DirtyTreeState['files'][number] | undefined {
  const target = normalizePathForWorkspace(filePath, workspace).toLowerCase();
  return tree?.files.find((file) => normalizePathForWorkspace(file.path, workspace).toLowerCase() === target);
}

function hasSuccessfulPriorMutation(filePath: string, priorSteps: ReactStep[] = [], workspace?: string): boolean {
  const target = normalizePathForWorkspace(filePath, workspace).toLowerCase();
  return priorSteps.some((step) => {
    if (step.action !== 'Write' && step.action !== 'Edit') return false;
    const stepPath = typeof step.action_input?.file_path === 'string'
      ? step.action_input.file_path
      : typeof step.action_input?.path === 'string'
        ? step.action_input.path
        : undefined;
    if (!stepPath || normalizePathForWorkspace(stepPath, workspace).toLowerCase() !== target) return false;
    try {
      const parsed = JSON.parse(step.observation || '{}') as { success?: unknown };
      return parsed.success !== false;
    } catch {
      return !/\b(error|failed|refused|rejected)\b/i.test(step.observation || '');
    }
  });
}

function hasExplicitDirtyApproval(filePath: string, context: ExecutionGuardContext, workspace: string): boolean {
  const normalized = normalizePathForWorkspace(filePath, workspace);
  const scopes = new Set([
    `write:${normalized}`,
    `write:${normalizePath(filePath)}`,
    'write:*',
    '*',
  ]);
  if (context.policy?.mode === 'full_workspace' || context.taskAnalysis?.approvalPolicy === 'full_access') return true;
  if ([...(context.policy?.approvedScopes || [])].some((scope) => scopes.has(scope))) return true;
  if ([...(context.policy?.approvalGrants || [])].some((grant) =>
    grant.decision === 'allow' &&
    (grant.expiresAt === undefined || grant.expiresAt > Date.now()) &&
    scopes.has(grant.scope)
  )) return true;
  return context.planApproval?.status === 'approved' &&
    context.planApproval.scope.mutationScopes.some((scope) => scopes.has(scope));
}

function isTaskScopedDirtyMutation(action: ToolAction, context: ExecutionGuardContext, workspace: string): boolean {
  const analysis = context.taskAnalysis;
  if (!analysis || inferOperationIntent(action) !== 'modify') return false;
  const filePath = getActionFilePath(action);
  if (!filePath) return false;
  const normalized = normalizePathForWorkspace(filePath, workspace).toLowerCase();
  const affectedFile = analysis.affectedFiles.find((file) =>
    normalizePathForWorkspace(file.path, workspace).toLowerCase() === normalized
  );
  if (affectedFile?.intent === 'modify') return true;

  // A bug-fix/continuation may discover the affected file from the dirty diff
  // rather than from the original request. Reading it first is the evidence
  // that makes that discovered target part of the requested repair.
  return (analysis.taskKind === 'bug_fix' || analysis.behaviorScope === 'existing_behavior_fix') &&
    hasPriorFileStateEvidence(filePath, context.priorSteps, workspace);
}

function dirtyOverlapToProtect(action: ToolAction, context: ExecutionGuardContext): { tree: DirtyTreeState; filePath: string } | null {
  const filePath = getActionFilePath(action);
  if (!filePath) return null;
  const workspace = context.workspace || context.taskAnalysis?.workspace || process.cwd();
  const currentTree = context.dirtyTree || scanDirtyTree(workspace);
  const currentFile = dirtyFileAtPath(currentTree, filePath, workspace);
  if (!currentFile) return null;

  const baselineFile = dirtyFileAtPath(context.dirtyTreeBaseline, filePath, workspace);
  const runOwned = hasSuccessfulPriorMutation(filePath, context.priorSteps, workspace);
  const taskScoped = isTaskScopedDirtyMutation(action, context, workspace);
  const explicitlyApproved = hasExplicitDirtyApproval(filePath, context, workspace);

  // A file first dirtied by this run is safe to touch again. A pre-existing
  // dirty file is safe only when the task explicitly targets it or the user
  // approved the exact write scope. A new dirty file appearing mid-run is
  // treated as external user work and remains protected.
  if (runOwned || (taskScoped && Boolean(baselineFile)) || explicitlyApproved) return null;

  const protectedTree: DirtyTreeState = {
    ...currentTree,
    files: [{ ...currentFile, path: normalizePathForWorkspace(filePath, workspace) }],
    modifiedCount: currentFile.status === 'modified' ? 1 : 0,
    addedCount: currentFile.status === 'added' ? 1 : 0,
    deletedCount: currentFile.status === 'deleted' ? 1 : 0,
    untrackedCount: currentFile.status === 'untracked' ? 1 : 0,
    totalChanges: 1,
    isDirty: true,
  };
  return { tree: protectedTree, filePath: normalizePathForWorkspace(filePath, workspace) };
}

const STALE_PREIMAGE_MAX_CHARS = 1_200;

function hashFileContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function countExactOccurrences(content: string, search: string): number {
  if (!search) return 0;
  let count = 0;
  let cursor = 0;
  while ((cursor = content.indexOf(search, cursor)) >= 0) {
    count += 1;
    if (count > 1) return count;
    cursor += 1;
  }
  return count;
}

function boundedCurrentPreimage(content: string, search?: string): {
  text: string;
  startLine: number;
  endLine: number;
  truncatedBefore: boolean;
  truncatedAfter: boolean;
} {
  const targetIndex = search ? content.indexOf(search) : -1;
  let start = targetIndex >= 0 ? Math.max(0, targetIndex - Math.floor(STALE_PREIMAGE_MAX_CHARS / 3)) : 0;
  if (start > 0) {
    const lineStart = content.lastIndexOf('\n', start);
    if (lineStart >= 0 && start - lineStart < Math.floor(STALE_PREIMAGE_MAX_CHARS / 2)) start = lineStart + 1;
  }
  const end = Math.min(content.length, start + STALE_PREIMAGE_MAX_CHARS);
  const excerpt = content.slice(start, end);
  const redactedExcerpt = redactPolicyText(excerpt);
  const startLine = content.slice(0, start).split('\n').length;
  const endLine = startLine + (excerpt.match(/\n/g)?.length || 0);
  return {
    text: redactedExcerpt.length <= STALE_PREIMAGE_MAX_CHARS
      ? redactedExcerpt
      : `${redactedExcerpt.slice(0, STALE_PREIMAGE_MAX_CHARS - 1)}…`,
    startLine,
    endLine,
    truncatedBefore: start > 0,
    truncatedAfter: end < content.length,
  };
}

function staleMutationObservation(
  action: ToolAction,
  filePath: string,
  workspace: string,
  oldString: string | undefined,
  message: string,
): string {
  try {
    const resolved = validateAndResolvePath(filePath, workspace);
    if (!existsSync(resolved)) {
      return JSON.stringify({
        success: false,
        status: 'error',
        toolId: action.action,
        error: `${message} The file no longer exists.`,
        nextAction: 'read_current_file_before_retrying_mutation',
      });
    }
    const currentContent = readFileSync(resolved, 'utf-8');
    const currentMatchCount = action.action === 'Edit' && oldString !== undefined
      ? countExactOccurrences(currentContent, oldString)
      : undefined;
    return JSON.stringify({
      success: false,
      status: 'error',
      toolId: action.action,
      error: message,
      currentHash: hashFileContent(currentContent),
      currentPreimage: boundedCurrentPreimage(currentContent, oldString),
      ...(currentMatchCount !== undefined
        ? { currentMatchStatus: currentMatchCount === 0 ? 'missing' : currentMatchCount === 1 ? 'unique' : 'ambiguous' }
        : {}),
      nextAction: action.action === 'Edit'
        ? 'inspect_current_preimage_and_retry_with_fresh_hash'
        : 'read_current_file_before_retrying_write',
    });
  } catch {
    return JSON.stringify({
      success: false,
      status: 'error',
      toolId: action.action,
      error: `${message} Current file evidence could not be read safely.`,
      nextAction: 'read_current_file_before_retrying_mutation',
    });
  }
}

/**
 * Applies the two model-facing mutation tools through the first-class file
 * operation layer.  This keeps preimage validation, changed-file inventory,
 * and bounded diff generation at the executor boundary rather than relying
 * on individual tool handlers to do so.
 */
function executeTransactionalFileMutation(action: ToolAction, context: ExecutionGuardContext): string | null {
  if (!context.useTransactionalEdits || !MUTATING_ACTIONS.has(action.action)) return null;

  const sourceDocumentMutationError = readOnlySourceDocumentMutationError(action);
  if (sourceDocumentMutationError) {
    return JSON.stringify({
      success: false,
      status: 'invalid',
      toolId: action.action,
      error: sourceDocumentMutationError,
      nextAction: 'use_document_read_then_mutate_a_non_document_source_file',
    });
  }

  const filePath = getActionFilePath(action);
  if (!filePath) return JSON.stringify({ success: false, error: 'Transactional mutation requires file_path.' });
  const workspace = context.workspace || context.taskAnalysis?.workspace || process.cwd();
  // The server normally supplies an existing workspace root. If a direct
  // caller provides a virtual/mocked root, let its registered mutation tool
  // handle the action instead of converting a missing parent directory into
  // a second recovery Read.
  if (!existsSync(workspace)) return null;
  // A targeted Read has already reported the path as missing. Let the
  // registered Write handler own the create/reconcile decision rather than
  // making the transaction layer demand a hash for a preimage that the agent
  // could not obtain. The handler still receives allowCreate=true and remains
  // inside the normal policy/path boundary.
  if (hasMissingReadFailure(filePath, context.priorSteps, workspace)) return null;
  const operationIntent = inferOperationIntent(action);
  const protectedOverlap = dirtyOverlapToProtect(action, context);
  if (protectedOverlap) {
    const overlap = validatePlannedChanges([
      { file: protectedOverlap.filePath, type: operationIntent === 'create' ? 'create' : 'modify', description: `Agent ${action.action} mutation` },
    ], protectedOverlap.tree);
    if (!overlap.canProceed) {
      return JSON.stringify({
        success: false,
        error: `Transactional mutation rejected: ${filePath} overlaps uncommitted user changes. Inspect the diff and approve this exact file scope or target a clean file.`,
        overlap: { conflicts: overlap.conflicts, requiresApproval: overlap.requiresApproval, suggestions: overlap.suggestions },
      });
    }
  }

  try {
    const resolved = validateAndResolvePath(filePath, workspace);
    const exists = existsSync(resolved);
    const before = exists ? readFileSync(resolved, 'utf-8') : '';
    const expectedHash = typeof action.action_input.expectedHash === 'string'
      ? action.action_input.expectedHash
      : undefined;
    let commitHash = expectedHash;
    let recoveredStaleEdit = false;
    let content: string;

    if (action.action === 'Edit') {
      if (!exists) return JSON.stringify({ success: false, error: 'Transactional Edit refused: file does not exist.' });
      if (!expectedHash) return JSON.stringify({ success: false, error: `Transactional Edit refused: expectedHash from a guarded read is required. Read ${filePath} successfully before retrying this Edit.` });
      const oldString = String(action.action_input.old_string);
      const newString = String(action.action_input.new_string);
      const currentHash = hashFileContent(before);
      if (expectedHash !== currentHash) {
        const guardedReadHash = getPriorKnownHash(filePath, context.priorSteps, workspace);
        if (guardedReadHash !== expectedHash) {
          return staleMutationObservation(
            action,
            filePath,
            workspace,
            oldString,
            'Transactional Edit refused: stale expected hash does not match the latest guarded file-state evidence. Read the file again before retrying.',
          );
        }
        const matches = countExactOccurrences(before, oldString);
        if (matches !== 1) {
          return staleMutationObservation(
            action,
            filePath,
            workspace,
            oldString,
            `Transactional Edit refused: stale expected hash. Automatic recovery requires old_string to match exactly once; it matched ${matches === 0 ? 'zero times' : 'multiple times'}.`,
          );
        }
        const matchIndex = before.indexOf(oldString);
        content = `${before.slice(0, matchIndex)}${newString}${before.slice(matchIndex + oldString.length)}`;
        commitHash = currentHash;
        recoveredStaleEdit = true;
      } else if (!before.includes(oldString)) {
        return JSON.stringify({ success: false, error: 'Transactional Edit refused: old_string was not found in the guarded preimage.' });
      } else {
        content = before.replace(oldString, newString);
      }
    } else {
      const requestedContent = contentForWrite(action.action_input);
      if (requestedContent === null) return JSON.stringify({ success: false, error: 'Transactional Write refused: valid content is required.' });
      if (exists) {
        if (!expectedHash) return JSON.stringify({ success: false, error: `Transactional Write refused: expectedHash from a guarded read is required. Read ${filePath} successfully before retrying this Write.` });
        if (expectedHash !== hashFileContent(before)) {
          return staleMutationObservation(
            action,
            filePath,
            workspace,
            undefined,
            'Transactional Write refused: stale expected hash. Full-file writes are never automatically reconciled; inspect the current file before retrying.',
          );
        }
        content = action.action_input.append === true ? `${before}${requestedContent}` : requestedContent;
      } else {
        content = requestedContent;
      }
    }

    const result = exists
      ? applyFirstClassFileOperation({ type: 'ReplaceFile', filepath: filePath, content, expectedHash: commitHash || '', workspaceRoot: workspace })
      : applyFirstClassFileOperation({ type: 'CreateFile', filepath: filePath, content, workspaceRoot: workspace });
    if (!result.success && /ReplaceFile refused: stale expected hash\./i.test(result.error || '')) {
      return staleMutationObservation(
        action,
        filePath,
        workspace,
        action.action === 'Edit' ? String(action.action_input.old_string) : undefined,
        `Transactional ${action.action} refused: stale expected hash. The file changed before the guarded commit, so no mutation was applied.`,
      );
    }
    return JSON.stringify({
      ...result,
      ...(recoveredStaleEdit ? { staleHashRecovery: 'unique_edit_rebased_to_current_hash' } : {}),
      transaction: { atomic: true, executorOwned: true },
    });
  } catch (error) {
    return JSON.stringify({ success: false, error: `Transactional mutation failed: ${error instanceof Error ? error.message : String(error)}` });
  }
}

export function policyContextForExecution(context: ExecutionGuardContext = {}): PolicyContext {
  const analysisPolicy = context.taskAnalysis?.approvalPolicy;
  const scopedPolicy = context.scope?.policy;
  // Callers that supply policy get strict mode semantics. Legacy/direct tool
  // callers retain the pre-existing task-scoped execution behavior until the
  // server supplies an explicit user-approval scope.
  const mode: PermissionMode = context.policy?.mode || scopedPolicy?.mode ||
    (analysisPolicy === 'full_access' ? 'full_workspace' : context.taskAnalysis?.expectedChangeIntent === 'read_only' ? 'read_only' : 'scoped_auto_approve');
  return {
    workspace: context.workspace || context.scope?.workspace.root || context.taskAnalysis?.workspace || process.cwd(),
    mode,
    taskId: context.policy?.taskId || scopedPolicy?.taskId || context.taskAnalysis?.id,
    approvedScopes: context.policy?.approvedScopes || scopedPolicy?.approvedScopes,
    approvalGrants: context.policy?.approvalGrants || scopedPolicy?.approvalGrants,
    ownedProcessIds: context.policy?.ownedProcessIds,
  };
}

/**
 * Execute a tool action and return the observation
 */
async function executeActionInternal(
  action: ToolAction,
  registry?: ToolRegistry,
  signal?: AbortSignal,
  context: ExecutionGuardContext = {}
): Promise<string> {
  try {
    let normalizedInputAction = normalizeToolAction(action);
    const tempWorkspaceError = await activeTemporaryWorkspaceError(context);
    if (tempWorkspaceError) {
      emitHarnessIntervention(
        normalizedInputAction,
        context,
        'task_analysis_guard',
        tempWorkspaceError,
        ['Bind an existing harness-created temporary workspace to this run and task, or use the active user workspace.'],
      );
      const safeAction = withoutMutationTarget(normalizedInputAction);
      context.onActionNormalized?.(safeAction);
      return JSON.stringify({ success: false, status: 'denied', toolId: action.action, error: tempWorkspaceError, nextAction: 'correct_the_run_workspace_binding' });
    }

    const pathNormalization = normalizeMutationPath(normalizedInputAction, context);
    normalizedInputAction = pathNormalization.action;
    context.onActionNormalized?.(normalizedInputAction);
    if (pathNormalization.error) {
      emitHarnessIntervention(
        action,
        context,
        'task_analysis_guard',
        pathNormalization.error,
        ['Resubmit a uniquely task-declared path inside the active workspace, or correct the run workspace.'],
      );
      return JSON.stringify({ success: false, status: 'denied', toolId: action.action, error: pathNormalization.error, nextAction: 'correct_the_workspace_scoped_file_path' });
    }
    const allowedTools = registry?.getNames?.() || getAvailableTools(registry).map((tool) => tool.name);
    const normalizedAction = normalizeWriteMode(
      normalizeStructuredDocumentRead(normalizedInputAction, allowedTools),
      context,
    );
    const schemaErrors = validateNormalizedAction(normalizedAction, allowedTools);
    if (schemaErrors.length) {
      return JSON.stringify({ success: false, error: `Invalid normalized action: ${schemaErrors.join(' ')}` });
    }
    const inputError = validateRequiredToolInput(normalizedAction);
    if (inputError) {
      return JSON.stringify({ success: false, status: 'invalid', toolId: normalizedAction.action, error: inputError });
    }

    const sourceDocumentMutationError = readOnlySourceDocumentMutationError(normalizedAction);
    if (sourceDocumentMutationError) {
      return JSON.stringify({
        success: false,
        status: 'invalid',
        toolId: normalizedAction.action,
        error: sourceDocumentMutationError,
        nextAction: 'use_document_read_then_mutate_a_non_document_source_file',
      });
    }

    if (context.planApproval?.status === 'pending' && getToolCapabilities(normalizedAction.action).mutating) {
      return JSON.stringify({
        success: false,
        status: 'awaiting_plan_approval',
        toolId: normalizedAction.action,
        error: 'Mutation blocked while plan approval is pending. Approve, edit, reject, or cancel the plan before continuing.',
      });
    }

    const policy = evaluatePolicy(normalizedAction, policyContextForExecution(context));
    recordPolicyDecision(context.policyAudit, policy, context.taskAnalysis?.id);
    if (!policy.allowed) {
      return JSON.stringify({
        success: false,
        status: 'denied',
        toolId: normalizedAction.action,
        error: `Policy blocked action: ${policy.reason}`,
        policy: { category: policy.category, risk: policy.risk, scope: policy.scope, requiresApproval: policy.requiresApproval },
      });
    }
    context.onAuthorized?.(normalizedAction);

    const skippedVerification = maybeSkipUnavailableVerification(normalizedAction, context);
    if (skippedVerification) return skippedVerification;

    const skippedGitConfirmation = maybeSkipGitConfirmation(normalizedAction, context);
    if (skippedGitConfirmation) return skippedGitConfirmation;

    const guardError = validateActionAgainstTaskAnalysis(normalizedAction, context);
    if (guardError) {
      const gate = taskAnalysisGateEvidence(guardError);
      emitHarnessIntervention(normalizedAction, context, gate.gateName, guardError, gate.requiredEvidence);
      return JSON.stringify({ success: false, status: 'error', toolId: normalizedAction.action, error: guardError });
    }

    const evidenceGateError = validateActionEvidenceGate(normalizedAction, context);
    if (evidenceGateError) {
      emitHarnessIntervention(
        normalizedAction,
        context,
        'requires_source_mutation',
        evidenceGateError,
        ['A successful source mutation, or inspection of every existing modifiable source target.'],
      );
      return JSON.stringify({ success: false, status: 'error', toolId: normalizedAction.action, error: evidenceGateError });
    }

    const dispatchAction = prepareActionForGuardedDispatch(normalizedAction, context);
    const transactionalObservation = executeTransactionalFileMutation(dispatchAction, context);
    if (transactionalObservation) {
      return finalizeToolObservation(normalizedAction, transactionalObservation, context);
    }
    const workspace = context.workspace || context.taskAnalysis?.workspace || process.cwd();
    const observation = await runWithWorkspace(
      workspace,
      () => dispatchTool(dispatchAction, registry, signal, context.scope),
    );
    return finalizeToolObservation(normalizedAction, observation, context);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return serializeToolResult({
      success: false,
      status: 'error',
      toolId: action.action,
      error: `Error executing ${action.action}: ${errorMsg}`,
    });
  }
}

/** Capability-aware execution boundary used by the engine and integrations. */
export async function executeAction(
  action: ToolAction,
  registry?: ToolRegistry,
  signal?: AbortSignal,
  context: ExecutionGuardContext = {}
): Promise<string> {
  const state = context.toolExecutionState;
  const ledger = context.toolEvidenceLedger;
  const toolCallId = context.toolCallId || randomUUID();
  const actionCapabilities = registry?.get(action.action)?.capabilities || getToolCapabilities(action.action);
  if (context.scope && !context.scope.reserveToolCall()) {
    return serializeToolResult({
      success: false,
      status: 'error',
      toolId: action.action,
      toolCallId,
      error: `Tool-call budget exhausted (${context.scope.usage.toolCalls}/${context.scope.budgets.maxToolCalls}).`,
      nextAction: 'continue_with_user_approval_or_start_a_continuation',
    });
  }
  if (state?.isDenied(action)) {
    const error = 'Denied tool actions cannot be retried unchanged; request a new approval scope or choose a different action.';
    const retryEvidence = ledger?.recordDeniedRetry(action, error, toolCallId, actionCapabilities);
    return serializeToolResult({
      success: false,
      status: 'denied_retry',
      toolId: action.action,
      toolCallId,
      ...(retryEvidence ? { evidenceIds: [retryEvidence.id] } : {}),
      error,
      nextAction: 'request_approval_or_choose_a_different_action',
    });
  }

  const evidenceId = ledger?.start(action, toolCallId, actionCapabilities);
  const executionContext: ExecutionGuardContext = {
    ...context,
    onHarnessIntervention: (intervention) => {
      if (evidenceId) ledger?.recordHarnessIntervention(evidenceId, intervention);
      try {
        context.onEvent?.({
          type: 'harness_intervention',
          ...intervention,
          toolCallId,
          ...(evidenceId ? { evidenceId } : {}),
        });
      } catch {
        // Telemetry callback failures must not change the guarded tool result.
      }
    },
  };
  const startedAt = Date.now();
  try {
    const operation = (executionSignal?: AbortSignal) => {
      const run = () => executeActionInternal(action, registry, executionSignal, executionContext);
      return context.toolScheduler
        ? context.toolScheduler.execute(action, run, registry?.get(action.action)?.capabilities || getToolCapabilities(action.action))
        : run();
    };
    const maxAttempts = Math.max(0, Math.min(3, Math.floor(
      actionCapabilities.idempotent
        ? context.toolRetryLimit ?? (signal ? 1 : 0)
        : 0,
    )));
    let attempt = 0;
    let observation = '';
    let canonical = normalizeToolResult(action.action, { success: false, status: 'unknown', error: 'Tool did not start.' });
    while (attempt <= maxAttempts) {
      attempt += 1;
      if (signal) {
        // AskUserQuestion intentionally suspends the run until the UI/user
        // responds. It must not inherit the normal tool timeout or a prompt
        // will be cancelled before the user has a chance to answer. Keep the
        // run signal so stopping the run still cancels the pending question.
        if (action.action === 'AskUserQuestion') {
          observation = await operation(signal);
        } else {
          const protectedResult = await executeWithTimeout(
            (executionSignal) => operation(executionSignal),
            action.action,
            registry?.get(action.action)?.timeoutMs || getToolTimeout(action.action),
            signal,
          );
          if (protectedResult.success && typeof protectedResult.data === 'string') {
            observation = protectedResult.data;
          } else {
            const status = protectedResult.timedOut ? 'timed_out' : protectedResult.cancelled ? 'cancelled' : 'error';
            const error = protectedResult.error
              ? formatTimeoutError(protectedResult.error, action.action)
              : `Tool ${status}.`;
            observation = serializeToolResult({
              success: false,
              status,
              toolId: action.action,
              toolCallId,
              error,
              retryable: status === 'cancelled' || status === 'timed_out',
              nextAction: status === 'cancelled' ? 'resume_or_retry_with_user_direction' : 'inspect_timeout_and_retry',
            });
          }
        }
      } else {
        // Preserve direct/unit callers' handler contract. Engine and transports
        // provide a signal, which activates this same timeout boundary.
        observation = await operation(undefined);
      }

      canonical = normalizeToolResult(action.action, observation, {
        toolCallId,
        durationMs: Date.now() - startedAt,
        attempt,
        ...(evidenceId ? { invocationId: evidenceId } : {}),
        ...(evidenceId ? { evidenceIds: [evidenceId] } : {}),
      });
      const policy = context.policyAudit?.[context.policyAudit.length - 1];
      if (policy) canonical.policy = policy;
      // Never replay denied or invalid input. Only a result explicitly marked
      // retryable can consume the bounded retry budget.
      if (!canonical.retryable || attempt > maxAttempts || signal?.aborted) break;
    }
    if (canonical.status === 'denied') state?.markDenied(action);
    const policy = context.policyAudit?.[context.policyAudit.length - 1];
    const result = serializeToolResult(canonical);
    if (evidenceId) ledger?.complete(evidenceId, result, policy);
    // Legacy direct callers without a run/event context still receive the
    // handler's established observation shape. Engine, MCP, verification, and
    // any caller that supplies evidence or a signal receive the full canonical
    // contract above.
    return ledger || signal || context.toolCallId ? result : observation;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const observation = serializeToolResult(normalizeToolResult(action.action, {
      success: false,
      status: 'error',
      toolId: action.action,
      toolCallId,
      durationMs: Date.now() - startedAt,
      ...(evidenceId ? { invocationId: evidenceId } : {}),
      ...(evidenceId ? { evidenceIds: [evidenceId] } : {}),
      error: message,
    }));
    if (evidenceId) ledger?.complete(evidenceId, observation, context.policyAudit?.[context.policyAudit.length - 1]);
    return observation;
  }
}

/** Execute a planner-provided batch with capability-aware scheduling. */
export async function executeActions(
  actions: ToolAction[],
  registry?: ToolRegistry,
  signal?: AbortSignal,
  context: ExecutionGuardContext = {},
): Promise<string[]> {
  const scheduler = context.toolScheduler || new ToolExecutionScheduler();
  const operationContext = { ...context, toolScheduler: undefined };
  return scheduler.executeBatch(
    actions,
    (action) => executeAction(action, registry, signal, operationContext),
    (action) => registry?.get(action.action)?.capabilities || getToolCapabilities(action.action),
  );
}

/**
 * Persist raw output before reducing what enters ReAct history. The raw
 * observation remains available to the compactor so a useful tail/error
 * summary can be selected even when storage created a leading preview.
 */
async function finalizeToolObservation(
  action: ToolAction,
  observation: string,
  context: ExecutionGuardContext,
): Promise<string> {
  const persistedObservation = await persistLargeObservationIfNeeded(observation, context.workspace);
  const isFreeTierPacing = context.pacingProfile === 'conservative' || context.pacingProfile === 'phased';
  const freeTierInputThreshold = isFreeTierPacing && context.modelContextWindow
    ? freeTierCompactionThreshold(context.modelContextWindow)
    : undefined;
  return compactObservation(
    action.action,
    action.action_input,
    observation,
    {
      persistedObservation,
      ...(freeTierInputThreshold !== undefined ? { inputThreshold: freeTierInputThreshold } : {}),
    },
  ).observation;
}

function prepareActionForGuardedDispatch(
  action: ToolAction,
  context: ExecutionGuardContext = {}
): ToolAction {
  if (
    (action.action === 'Edit' || action.action === 'Write') &&
    typeof action.action_input?.expectedHash !== 'string'
  ) {
    const filePath = getActionFilePath(action);
    const expectedHash = filePath
      ? getPriorKnownHash(filePath, context.priorSteps, context.workspace || context.taskAnalysis?.workspace)
      : undefined;
    if (expectedHash) {
      return {
        ...action,
        action_input: {
          ...action.action_input,
          expectedHash,
          ...(action.action === 'Write' && action.action_input?.append !== true
            ? { allowOverwrite: true }
            : {}),
        },
      };
    }
  }

  const analysis = context.taskAnalysis;
  if (
    analysis?.expectedChangeIntent === 'create' &&
    analysis.affectedFiles.length === 0 &&
    action.action === 'Write' &&
    action.action_input?.allowCreate !== true
  ) {
    return {
      ...action,
      action_input: {
        ...action.action_input,
        allowCreate: true,
      },
    };
  }

  return action;
}

/**
 * Execute a single step: dispatch tool and capture observation
 */
export async function executeStep(
  action: ToolAction,
  registry?: ToolRegistry,
  signal?: AbortSignal,
  context: ExecutionGuardContext = {}
): Promise<{
  observation: string;
  success: boolean;
  error?: string;
}> {
  try {
    const observation = await executeAction(action, registry, signal, context);
    const parsed = parseStructuredToolResult(action.action, observation);
    return {
      observation,
      success: parsed.success,
      ...(parsed.error ? { error: parsed.error } : {}),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      observation: `Tool execution failed: ${errorMsg}`,
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Validate action format
 */
export function validateAction(action: unknown): action is ToolAction {
  if (!action || typeof action !== 'object') return false;
  const act = action as Record<string, unknown>;
  return (
    typeof act.action === 'string' &&
    typeof act.action_input === 'object' &&
    act.action_input !== null
  );
}

/**
 * Format tool action for logging
 */
export function formatAction(action: ToolAction): string {
  return `${action.action}(${JSON.stringify(action.action_input)})`;
}

/**
 * Parse and validate action from tool response
 */
export function parseAction(response: string): ToolAction | null {
  const normalized = normalizeAgentDecision(response);
  const action = normalized.decision?.action;
  return action && validateAction(action) ? action : null;
}
