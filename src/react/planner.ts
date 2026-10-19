/**
 * Planner Module
 * Handles reasoning and action planning
 */

import type { LLMCompletionResult, LLMCompletionStreamEvent, LLMProvider, LLMReasoningEffort, LLMReasoningOptions, LLMRequestTelemetry } from '../di/types.js';
import type { ReactState } from './state-manager.js';
import { getLatestReadFailureDetails, getStateEntryGateFailure, hasBaselineVerificationEvidence, hasEmptyWorkspaceInspectionEvidence, hasRelevantInspectionEvidence, hasSuccessfulSourceMutation, requiresSourceMutation } from './state-manager.js';
import { getAvailableTools, getToolCatalog, getToolDescriptions, toolExists, validateToolInput } from './tool-router.js';
import type { ToolRegistry } from '../di/types.js';
import { parseJsonString, truncateString } from '../validation/stringValidators.js';
import { buildRetainedReadContext, buildStepHistory, formatAppSpec, formatPlan, formatWorkPlan, getCurrentTaskSteps, getTaskEvidenceSteps, getRetainedReadCoverage } from '@barok/engine';
import { buildStructuredActionInstruction, createMalformedProviderResponseAudit, normalizeAgentEvidenceChecks, providerKindFromName, validateNormalizedAction, type AgentDecisionMetadata } from '@barok/engine';
import { getCodingStateBudget, getCodingStateTimeBudget, isCodingStateBudgetExceeded, isCodingStateTimeBudgetExceeded } from '@barok/engine';
import type { PlanItem, PlanItemKind, ThinkingDepth } from '@barok/engine';
import {
  compactContextByBudget,
  estimateMessagesTokens,
  resolveContextBudgets,
  SUBTASK_COORDINATOR_CONTEXT_BUDGETS,
  type ContextBudget,
  DEFAULT_CONTEXT_BUDGETS,
} from '@barok/engine';
import { isLocalStructuredActionModel } from '@barok/engine';
import type { LocalActionBudgetController, LocalStructuredActionClass } from '@barok/engine';
import { redactPolicyPayload, redactPolicyText } from '@barok/core';
import { activeApprovalGrants, policyGuidance, type PermissionMode } from '../tools/permissionPolicy.js';
import { sanitizeError } from '../utils/sanitizeError.js';
import { isVerificationAction } from '@barok/engine';
import { formatPlatformShellInstruction } from '@barok/engine';
import { getPlatform as getNodePlatform, normalizeWorkspacePathKey } from '@barok/adapter-node';
import { getNvidiaModelMetadata } from '../config/nvidiaModels.js';
import { resolveNvidiaModelTarget } from '../config/nvidiaTargets.js';
import { formatModelCapabilityInstruction, getModelCapabilityProfile } from '../config/modelCapabilities.js';
import { decodeBase64Utf8, validateTextIntegrity } from '../tools/textIntegrity.js';
import type { CordisContextAssemblyService } from '../runtime/cordis/services.js';
import type { ToolEvidenceLedger } from '@barok/engine';

export interface PlannerConfig {
  model: string;
  plannerModel?: string;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
  requestKind?: string;
  /** Harness turn identity shared by every model request in this planner turn. */
  stepId?: string;
  onLlmTelemetry?: (telemetry: LLMRequestTelemetry) => void;
  verbose?: boolean;
  thinkingDepth?: ThinkingDepth;
  /** Receives only provider-labelled, bounded reasoning summaries. */
  onReasoningSummary?: (summary: string) => void;
  /** Receives only normalized stream events; raw provider payloads stay inside the provider boundary. */
  onStreamEvent?: (event: LLMCompletionStreamEvent) => void;
  /** Legacy compatibility flag; planning remains adaptive and model-directed. */
  phasedExecution?: boolean;
  /** Native tool-capable or local-thinking routes can select the next tool in one model request. */
  skipSeparateReasoning?: boolean;
  onMalformedProviderResponse?: (audit: ReturnType<typeof createMalformedProviderResponseAudit>) => void | Promise<void>;
  /** Shared provider-neutral context assembly for the active model target. */
  contextAssembly?: CordisContextAssemblyService;
  /** Trace ledger for recording structured diagnostic evidence and interventions. */
  toolEvidenceLedger?: ToolEvidenceLedger;
  /** Adaptive output budget for local structured tool-selection requests. */
  localActionBudget?: LocalActionBudgetController;
  /** Emits a bounded snapshot of the guidance attached to the current action-selection turn. */
  onGuidanceSnapshot?: (snapshot: {
    codingState: ReactState['codingState'];
    injectedDirective: string;
    permissionConstraints: string[];
    activeGateFailures: string[];
    contextBudgetUsed: number;
  }) => void;
  /** Stores a redacted, private-reasoning-free prompt reconstruction in memory only. */
  onContextSnapshot?: (stepSeq: number, snapshot: Record<string, unknown>) => void;
  /** Explicit context category budgets to override route-based dynamic selection. */
  contextBudgets?: readonly ContextBudget[];
  /** Host platform supplied by ReActEngineRuntime for command guidance. */
  platform?: string;
}

type ReasoningPhase = 'plan' | 'reason' | 'action' | 'final';

function getNativeReasoningOptions(depth: ThinkingDepth = 'balanced', phase: ReasoningPhase): LLMReasoningOptions | undefined {
  if (phase === 'action') {
    // The separate reasoning pass carries the deeper analysis. Keep the JSON
    // action response budget available for the required tool envelope.
    return { effort: 'minimal', summary: 'concise' };
  }
  if (phase === 'final') return { effort: 'low', summary: 'concise' };
  if (phase === 'plan') return { effort: depth === 'deep' ? 'medium' : 'low', summary: 'concise' };

  const effort: LLMReasoningEffort = depth === 'deep'
    ? 'high'
    : depth === 'fast'
      ? 'low'
      : 'medium';
  return { effort, summary: 'concise' };
}

function onCompletionResult(config: PlannerConfig): (result: LLMCompletionResult) => void {
  return (result) => {
    const summary = result.reasoningSummary?.trim();
    if (summary) config.onReasoningSummary?.(summary);
  };
}

function preparePlannerMessages(
  config: PlannerConfig,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const prepared = config.contextAssembly?.prepareMessages(messages);
  return (prepared?.messages || messages) as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}

function estimatePlannerCategoryTokens(
  messages: readonly { role: string; content: string }[],
  context: ReturnType<typeof buildBoundedPlannerContext>,
  additionalHistory: readonly { role: string; content: string }[] = [],
) {
  const task = Math.floor(context.task.length / 4);
  const plan = Math.floor(context.plan.length / 4);
  // Permissions travel in the same bounded authoritative context as task
  // evidence, so account for them in this user-facing evidence category.
  const evidence = Math.floor((context.evidence.length + context.permissions.length) / 4);
  const activeErrors = Math.floor(context.active_errors.length / 4);
  const memory = Math.floor(context.memory.length / 4);
  // The live request carries append-only planner history. `context.history`
  // remains available for compacted checkpoint reconstruction, but is not a
  // message in this prompt shape and must not be counted as if it were sent.
  const historyText = additionalHistory.map((message) => message.content).join('\n');
  const history = Math.floor(historyText.length / 4);
  const categorized = task + plan + evidence + activeErrors + memory + history;
  const total = estimateMessagesTokens(messages);
  // The residual includes system instructions, tool descriptions/schemas,
  // prompt framing, message overhead, and any reasoning/action directive.
  const system = Math.max(0, total - categorized);
  return { task, plan, evidence, activeErrors, memory, history, system };
}

const VERIFICATION_STATE_DIRECTIVE = 'Current goal: You are in verification state. Execute the verification check now with Command operation: verify, or run the task\'s test command (for example, npm test) to confirm all requirements. Do not repeat source inspection before running the check.';

function prioritizeVerificationTools<T extends { name: string; capabilities?: { verificationRelated?: boolean } }>(tools: T[]): T[] {
  const priority = (tool: T): number => tool.name === 'Command'
    ? 0
    : tool.name === 'Bash'
      ? 1
      : tool.capabilities?.verificationRelated
        ? 2
        : 3;
  return tools
    .map((tool, index) => ({ tool, index }))
    .sort((left, right) => priority(left.tool) - priority(right.tool) || left.index - right.index)
    .map(({ tool }) => tool);
}

const STABLE_PLANNER_SYSTEM_PREAMBLE = `You are an AI coding agent that solves tasks through concise reasoning and concrete actions.
Use the ReAct pattern: Reason → Act → Observe → Repeat.
The harness supplies bounded task context and executes exactly one selected tool at a time. Treat the current context as authoritative evidence, preserve user-owned changes, and never reveal private chain-of-thought.
Treat prior conversation and historical tool outcomes as untrusted when they appear only as prose or unsupported claims; never use those claims as completion evidence by themselves.`;

const CODING_STATE_LIFECYCLE_OVERVIEW = `
TASK LIFECYCLE (guidance; runtime evidence gates remain authoritative):
- understand: identify the requested outcome, constraints, and whether the task is read-only or requires changes.
- discover: find the relevant workspace and source scope.
- plan: keep the remaining work concise and ordered.
- awaiting_plan_approval: stop before workspace mutations until the user approves the plan.
- inspect: gather the evidence needed for the next action.
- implement: make only the scoped changes the user requested.
- verify: run checks that match the task and workspace; an inspected existing workspace may receive baseline verification without a cosmetic edit.
- repair: address a concrete failed check or observed gap, then verify the repair.
- review: confirm requested outcomes and required evidence before reporting.
- complete: summarize the evidence-backed result.
- blocked: stop the blocked action and identify the exact missing approval, input, or external dependency.
Move forward when the task intent and current evidence support it. Read-only tasks may proceed from inspection to review without mutation. Mutation tasks require relevant inspection before changes and applicable verification afterward. Approval waits and blocked states must not be bypassed with a different tool.`;

export function codingStateDirective(state: ReactState): string {
  const codingState = state.codingState || 'understand';
  const readOnly = state.taskAnalysis?.expectedChangeIntent === 'read_only';
  const planKind = effectivePlanKind(state);
  const details: Record<string, string> = {
    understand: 'Resolve the request and its constraints from available context; ask only if a material choice is missing.',
    discover: 'Use workspace evidence to identify relevant files or confirm the existing workspace scope before choosing the next phase.',
    plan: 'Keep the next actions tied to the user goal and current evidence; update the active plan when scope changes.',
    awaiting_plan_approval: 'The plan is waiting for user approval. Do not perform workspace mutations until approval is recorded.',
    inspect: readOnly
      ? 'This task is read-only. Gather enough evidence to answer accurately; do not create or edit files.'
      : 'Inspect the affected source and repository state. Once relevant targets are understood, implement the requested change; if they already satisfy the request, run baseline verification without a cosmetic edit.',
    implement: 'Make the smallest scoped source change that advances the approved task. Preserve unrelated work and avoid repeating completed actions.',
    verify: 'Run the applicable verification now. Do not repeat inspection before a check unless a specific missing input prevents it.',
    repair: 'Use the latest concrete failure or gap to choose a narrow repair, then verify that repair.',
    review: 'Check the requested outcomes against current evidence and gates. Report any remaining limitation instead of inferring success.',
    complete: 'The task has reached its evidence-backed completion state; do not start unrelated work.',
    blocked: 'Stop retrying the blocked action. Identify the exact approval, user input, or external dependency needed to continue.',
  };
  const activePlan = planKind ? ` Active plan kind: ${planKind}.` : '';
  return `CURRENT CODING STATE (${codingState}): ${details[codingState] || details.understand}${activePlan}`;
}

function malformedToolRecoveryHint(response: string, toolRegistry?: ToolRegistry): string {
  const match = response.match(/["']tool["']\s*:\s*["']([A-Za-z][\w-]{0,79})["']/i);
  const toolName = match?.[1];
  if (!toolName) return '';
  const tool = getToolCatalog(toolRegistry).find((candidate) => candidate.name.toLowerCase() === toolName.toLowerCase());
  if (!tool) return '';
  return [
    `Relevant tool: ${tool.name}.`,
    tool.example ? `Example: ${tool.example}` : '',
    tool.commonErrors?.length ? `Avoid: ${tool.commonErrors.slice(0, 2).join(' ')}` : '',
  ].filter(Boolean).join(' ');
}

export function getPlatformShellInstruction(platform: string = getNodePlatform()): string {
  return formatPlatformShellInstruction(platform);
}

function buildStablePlannerSystemPrompt(
  capabilityInstruction: string,
  toolRegistry?: ToolRegistry,
  verificationState = false,
  platform = getNodePlatform(),
): string {
  const tools = getToolCatalog(toolRegistry);
  const orderedTools = verificationState ? prioritizeVerificationTools(tools) : tools;
  return `${STABLE_PLANNER_SYSTEM_PREAMBLE}
${CODING_STATE_LIFECYCLE_OVERVIEW}
${getPlatformShellInstruction(platform) ? `\n${getPlatformShellInstruction(platform)}\n` : ''}
${verificationState ? 'VERIFICATION STATE PRIORITY: Run applicable checks with Command first (or Bash for a test command). Inspect source only when a verification result identifies a concrete gap.\n\n' : ''}Available tools:
${orderedTools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n')}

MODEL CAPABILITY CONTRACT:
${capabilityInstruction}`;
}

function buildPlannerContextMessage(
  state: ReactState,
  context: ReturnType<typeof buildBoundedPlannerContext>,
): string {
  return `CURRENT PLANNER CONTEXT (authoritative snapshot for this turn):
Task: ${context.task}
Workspace: ${state.workspace}
Execution checkpoint and remaining plan:
${context.plan}
Task contract and repository evidence:
${context.evidence}
${context.active_errors ? `Active errors and recovery guidance:
${context.active_errors}
` : ''}${context.memory ? `Retained file context (already read and available for this turn):
${context.memory}
` : ''}Permission constraints:
${context.permissions}`;
}

const PLANNER_CONVERSATION_STEP_LIMIT = 4;

function compactPlannerToolObservation(step: ReactState['steps'][number]): string {
  if (step.action !== 'Read' && step.action !== 'DocumentRead') {
    return truncateString(step.observation || 'pending', 1_200);
  }

  try {
    const parsed = JSON.parse(step.observation || '{}') as { success?: unknown; output?: unknown };
    if (parsed.success === true && typeof parsed.output === 'string') {
      const input = step.action_input || {};
      const path = typeof input.file_path === 'string'
        ? input.file_path
        : typeof input.path === 'string'
          ? input.path
          : 'the file';
      return `${step.action} ${parsed.output.length.toLocaleString()} chars from ${path} (content available in the bounded planner context)`;
    }
  } catch {
    // Preserve legacy or malformed read observations below.
  }

  return truncateString(step.observation || 'pending', 1_200);
}

function plannerHistoryActionEnvelope(step: ReactState['steps'][number]): string {
  const redactedInput = redactPolicyPayload(step.action_input || {}) as Record<string, unknown>;
  const boundedArguments = Object.fromEntries(Object.entries(redactedInput).map(([key, value]) => {
    if (typeof value === 'string') {
      const isFilePayload = /^(?:content|content_base64|contents|code|text|body|old_string|new_string|old_content|new_content)$/i.test(key);
      return [key, isFilePayload
        ? `[prior ${step.action} payload omitted; ${value.length} characters]`
        : truncateString(value, 180)];
    }
    if (Array.isArray(value)) {
      return [key, value.slice(0, 12).map((item) => typeof item === 'string' ? truncateString(item, 120) : item)];
    }
    if (value && typeof value === 'object') return [key, '[structured argument omitted]'];
    return [key, value];
  }));

  return JSON.stringify({ tool: step.action, arguments: boundedArguments });
}

function buildAppendOnlyPlannerHistoryMessages(
  state: ReactState,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const steps = state.continuationHandoff ? getCurrentTaskSteps(state) : state.steps;
  const historyStepLimit = state.subtaskDispatch ? 1 : PLANNER_CONVERSATION_STEP_LIMIT;
  const retainedSteps = steps.slice(-historyStepLimit);
  const omittedCount = steps.length - retainedSteps.length;
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = omittedCount > 0
    ? [{
        role: 'user',
        content: `Earlier planner history contains ${omittedCount} bounded action(s); use the current evidence and retained file context as authoritative for omitted details.`,
      }]
    : [];

  retainedSteps.forEach((step, index) => {
    messages.push({
      role: 'assistant',
      content: plannerHistoryActionEnvelope(step),
    });
    messages.push({
      role: 'user',
      content: `Tool observation for planner decision ${omittedCount + index + 1}: ${truncateString(compactPlannerToolObservation(step), state.subtaskDispatch ? 400 : 1_200)}`,
    });
  });

  return messages;
}

function buildSafePlannerHistoryMessages(state: ReactState): Array<{ role: 'user' | 'assistant'; content: string }> {
  const steps = state.continuationHandoff ? getCurrentTaskSteps(state) : state.steps;
  const historyStepLimit = state.subtaskDispatch ? 1 : PLANNER_CONVERSATION_STEP_LIMIT;
  const retainedSteps = steps.slice(-historyStepLimit);
  const omittedCount = steps.length - retainedSteps.length;
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = omittedCount > 0
    ? [{
        role: 'user',
        content: `Earlier planner history contains ${omittedCount} bounded action(s); use current evidence and retained file context as authoritative for omitted details.`,
      }]
    : [];

  retainedSteps.forEach((step, index) => {
    messages.push({
      role: 'assistant',
      content: plannerHistoryActionEnvelope(step),
    });
    messages.push({
      role: 'user',
      content: `Tool observation: ${truncateString(compactPlannerToolObservation(step), state.subtaskDispatch ? 400 : 1_200)}`,
    });
  });
  return messages;
}

function safeSnapshotText(value: string, limit = 32_000): string {
  return sanitizeError(redactPolicyText(value)).slice(0, limit);
}

/**
 * Rebuild the safe, observable parts of a planner turn without contacting a
 * model. Provider-private reasoning and runtime-only prompt additions are
 * deliberately omitted, so this is a reconstruction rather than a byte-for-
 * byte request capture.
 */
export function createPlannerContextSnapshot(
  state: ReactState,
  model: string,
  toolRegistry?: ToolRegistry,
  options: {
    context?: ReturnType<typeof buildBoundedPlannerContext>;
    budgets?: readonly ContextBudget[];
    systemPrompt?: string;
    additionalDirectives?: string[];
    availableToolInstructions?: string;
    platform?: string;
  } = {},
): Record<string, unknown> {
  const budgets = options.budgets || (state.subtaskDispatch
    ? SUBTASK_COORDINATOR_CONTEXT_BUDGETS
    : resolveContextBudgets({ model }));
  const context = options.context || buildBoundedPlannerContext(state, undefined, budgets);
  const verificationState = state.codingState === 'verify';
  const capabilityInstruction = formatModelCapabilityInstruction(getModelCapabilityProfile(model));
  const systemPrompt = safeSnapshotText(options.systemPrompt || buildStablePlannerSystemPrompt(
    capabilityInstruction,
    toolRegistry,
    verificationState,
    options.platform ?? getNodePlatform(),
  ));
  const userPrompt = safeSnapshotText(buildPlannerContextMessage(state, context), 48_000);
  const historyMessages = buildSafePlannerHistoryMessages(state).map((message) => ({
    role: message.role,
    content: safeSnapshotText(message.content, 2_000),
  }));
  const injectedDirectives = [
    codingStateDirective(state),
    verificationState ? VERIFICATION_STATE_DIRECTIVE : '',
    latestRecoveryDirective(state),
    getRepeatedFailedActionGuidance(state),
    staleEditRecoveryGuidance(state),
    ...(options.additionalDirectives || []),
  ].filter(Boolean).map((directive) => safeSnapshotText(directive, 4_000));
  const toolInstructions = options.availableToolInstructions
    ? safeSnapshotText(`Available tools and schemas:\n${options.availableToolInstructions}`, 24_000)
    : '';
  const directivePrompt = [toolInstructions, ...injectedDirectives].filter(Boolean).join('\n\n');
  const promptMessages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
    ...historyMessages,
    { role: 'user' as const, content: directivePrompt },
  ];
  const categoryTokens = estimatePlannerCategoryTokens(promptMessages, context, historyMessages);
  const promptTokens = estimateMessagesTokens(promptMessages);
  const promptText = safeSnapshotText(promptMessages
    .map((message) => `[${message.role.toUpperCase()}]\n${message.content}`)
    .join('\n\n'), 96_000);

  return {
    stepSeq: Math.max(1, (Number(state.current_step) || 0) + 1),
    model: safeSnapshotText(model, 240),
    ...(state.modelContextWindow ? { modelContextWindow: state.modelContextWindow } : {}),
    reconstructedAt: Date.now(),
    exactRequest: false,
    notes: [
      'This reconstruction omits provider-private reasoning and runtime-only additions; it does not reproduce the exact request byte for byte.',
      'Prompt contents are redacted and held in memory only. They are not written to the event log or database.',
    ],
    systemPrompt,
    userPrompt,
    historyMessages,
    injectedDirectives,
    contextBudgets: budgets.map((budget) => ({ ...budget })),
    categoryTokens,
    promptTokens,
    retainedReadContext: safeSnapshotText(context.memory, 48_000),
    promptText,
  };
}

function buildReasoningPhasePrompt(thinking: ReturnType<typeof getThinkingProfile>): string {
  return `PHASE: REASON
${thinking.instruction}
Choose and adapt the next useful approach from the current task context. Use Todo for a visible checklist or WorkPlan for optional strategic context when either helps. Respond with one concise user-visible rationale for the next action; do not output a tool envelope yet.`;
}

export function getPlannerActionTokenLimit(state: Pick<ReactState, 'codingState'>): number {
  return state.codingState === 'implement' || state.codingState === 'repair' ? 4_000 : 640;
}

const MUTATING_ACTIONS = new Set(['Write', 'Edit']);
const MUTATION_RECOVERY_READ_ACTIONS = new Set(['Read', 'DocumentRead']);
const FORCE_MUTATION_AFTER_NO_PROGRESS = 4;
const MAX_CORRECTIVE_TOOL_SELECTION_ATTEMPTS = 2;
const taskAnalysisContextCache = new WeakMap<object, string>();
const appContractCache = new WeakMap<object, string>();

function plannerStringArray(value: unknown, limit = 5): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = Array.from(new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.replace(/\s+/g, ' ').trim().slice(0, 240))
    .filter(Boolean)))
    .slice(0, limit);
  return values.length > 0 ? values : undefined;
}

function plannerDecisionMetadata(value: unknown): AgentDecisionMetadata | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const planUpdate = plannerStringArray(record.planUpdate);
  const expectedEvidence = plannerStringArray(record.expectedEvidence);
  const evidenceChecks = normalizeAgentEvidenceChecks(record.evidenceChecks);
  const preconditions = plannerStringArray(record.preconditions);
  const stopCondition = typeof record.stopCondition === 'string'
    ? record.stopCondition.replace(/\s+/g, ' ').trim().slice(0, 240)
    : undefined;
  const confidence = typeof record.confidence === 'number' && Number.isFinite(record.confidence)
    ? Math.max(0, Math.min(1, record.confidence))
    : undefined;
  const metadata: AgentDecisionMetadata = {
    ...(planUpdate ? { planUpdate } : {}),
    ...(expectedEvidence ? { expectedEvidence } : {}),
    ...(evidenceChecks ? { evidenceChecks } : {}),
    ...(preconditions ? { preconditions } : {}),
    ...(stopCondition ? { stopCondition } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  };
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

/**
 * The planner has no safe deterministic Write/Edit payload when a model keeps
 * selecting an inspection tool during a mutation-only recovery turn. Expose
 * this narrow classifier so the engine can turn that exhausted correction
 * into a resumable blocked result instead of treating it as a provider crash.
 */
export function isForcedMutationSelectionError(message: string): boolean {
  return /The engine is forcing implementation after a repeated loop;[\s\S]*Choose Write or Edit now/i.test(message) ||
    /The model could not produce a valid Write or Edit action/i.test(message);
}

function invalidWritePayloadError(input: Record<string, unknown>): string | undefined {
  const filePath = typeof input.file_path === 'string' && input.file_path.trim()
    ? input.file_path
    : 'target file';
  let content: string | undefined;
  if (typeof input.content === 'string') {
    content = input.content;
  } else if (typeof input.content_base64 === 'string') {
    const decoded = decodeBase64Utf8(input.content_base64);
    if (decoded.error) return `Invalid Write action: ${decoded.error}`;
    content = decoded.content;
  }
  if (content === undefined) return undefined;
  if (!content.trim()) return `Write requires non-whitespace file content for "${filePath}".`;
  const integrity = validateTextIntegrity(content, filePath);
  return integrity.valid ? undefined : `Invalid Write action: ${integrity.error}`;
}

const READ_ONLY_COMMAND_OPERATIONS = new Set([
  'git_status',
  'git_diff',
  'git_log',
  'file_exists',
  'list_directory',
  'process_inspect',
]);

export function activePlanKind(state: Pick<ReactState, 'plan'>): PlanItemKind | undefined {
  const active = state.plan.find((item) => item.status === 'in_progress');
  // Only typed plans are hard execution cursors. Older checkpoints and
  // provider-authored plans can remain visible and evidence-tracked without
  // guessing their phase from prose and accidentally blocking valid work.
  return active?.kind;
}

function effectivePlanKind(
  state: Pick<ReactState, 'plan' | 'taskAnalysis' | 'steps' | 'continuationHandoff'> &
    Partial<Pick<ReactState, 'workspace' | 'evidenceStartStep' | 'codingState' | 'forceMutationNextAction'>>,
): PlanItemKind | undefined {
  // A failed action can move the run into repair while its typed checklist
  // still points at verification. Yield the plan cursor during repair so the
  // agent can inspect/fix the output instead of being forced to rerun checks.
  if (state.codingState === 'repair' || latestRecoveryDirective(state)) return undefined;
  // A completion gate can send an implement-state recovery back to a still
  // active verify checklist item. Let the required mutation override that
  // stale cursor so verification cannot clear or block the forced repair.
  if (state.codingState === 'implement' && state.forceMutationNextAction) return undefined;
  const kind = activePlanKind(state);
  if (kind === 'implement' && requiresSourceMutation(state) &&
      !hasSuccessfulSourceMutation(state) && hasBaselineVerificationEvidence(state)) {
    return 'verify';
  }
  return kind;
}

function isPlanMutationAction(tool: string, input: Record<string, unknown>): boolean {
  if (tool === 'Write' || tool === 'Edit' || tool === 'PackageInstall') return true;
  if (tool !== 'Bash') return false;
  return /\b(copy-item|new-item|set-content|add-content|out-file|move-item|rename-item|remove-item|del|rm|cp|mv|(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:install|add))\b/i.test(
    String(input.command || ''),
  );
}

function isPlanInspectionAction(tool: string, input: Record<string, unknown>): boolean {
  if (isPlanMutationAction(tool, input) || isVerificationAction(tool, input)) return false;
  if (['Read', 'DocumentRead', 'Glob', 'Grep', 'WorkspaceChanges'].includes(tool)) return true;
  if (tool === 'Command') return READ_ONLY_COMMAND_OPERATIONS.has(String(input.operation || '').toLowerCase());
  if (tool !== 'Bash') return false;
  return /\b(?:cat|type|get-content|select-string|findstr|grep|rg|ls|dir|pwd|git\s+(?:status|diff|log|show))\b/i.test(
    String(input.command || ''),
  );
}

function planKindLabel(kind: PlanItemKind): string {
  if (kind === 'inspect') return 'inspection (Read, Glob, Grep, DocumentRead, WorkspaceChanges, or a read-only Command/Bash action)';
  if (kind === 'implement') return 'implementation (Write, Edit, PackageInstall, or a mutation command)';
  return 'verification (a test, build, lint, typecheck, or verify Command/Bash action)';
}

/**
 * Todo is useful for setting or revising a checklist, but it is not workspace
 * progress. Once an implementation turn has successfully recorded Todo, the
 * next turn must advance to a concrete inspection or mutation action. This
 * prevents a model from replaying the same checklist update indefinitely.
 */
function mustAdvanceAfterTodo(state: ReactState): boolean {
  if (state.codingState !== 'implement' && state.codingState !== 'repair') return false;
  const latest = getCurrentTaskSteps(state).at(-1);
  return latest?.action === 'Todo' && isSuccessfulObservation(latest);
}

/**
 * Return a hard action-selection error for the active checklist item. This is
 * deliberately separate from the softer no-progress policy: the checklist
 * is an execution cursor, not merely display text.
 */
export function planActionError(
  state: Pick<ReactState, 'plan' | 'taskAnalysis' | 'steps' | 'continuationHandoff'> &
    Partial<Pick<ReactState, 'workspace' | 'evidenceStartStep' | 'codingState'>>,
  tool: string,
  input: Record<string, unknown> = {},
): string | undefined {
  const kind = effectivePlanKind(state);
  // Todo is the agent's control-plane tool. It must remain available so the
  // agent can revise its own checklist instead of being trapped by it.
  if (!kind || tool === 'AskUserQuestion' || tool === 'Todo' || tool === 'WorkPlan') return undefined;

  const allowed = kind === 'inspect'
    ? isPlanInspectionAction(tool, input)
    : kind === 'implement'
      ? isPlanMutationAction(tool, input)
      : isVerificationAction(tool, input);
  return allowed
    ? undefined
    : `Active checklist item requires ${planKindLabel(kind)}; ${tool || 'an empty tool selection'} cannot advance it.`;
}

function latestRecoveryDirective(state: Pick<ReactState, 'steps' | 'continuationHandoff'>): string {
  const latest = getCurrentTaskSteps(state).at(-1);
  if (!latest?.observation) return '';

  let diagnostic = latest.observation;
  try {
    const parsed = JSON.parse(latest.observation) as { error?: unknown; output?: unknown; message?: unknown };
    diagnostic = [parsed.error, parsed.output, parsed.message]
      .filter((value): value is string => typeof value === 'string')
      .join('\n') || latest.observation;
  } catch {
    // Legacy tool observations are plain text.
  }
  diagnostic = diagnostic.slice(0, 1600);

  if (latest.action === 'Bash' && /\[eval\][\s\S]{0,240}(?:unterminated string constant|invalid or unexpected token)/i.test(diagnostic)) {
    return 'HARD COMMAND RECOVERY: The inline Node eval failed to parse because its quoting was broken; it did not verify the app. Do not repeat Bash/node -e or create a verifier file. Inspect and repair the declared app outputs, then use Command operation "verify" or the task\'s existing test command.';
  }

  if ((latest.action === 'Write' || latest.action === 'Edit') &&
      /not a declared task output|not in affected files/i.test(diagnostic) &&
      /(?:^|[\\/])(?:verify|verification|check|test)(?:[-_.][\w.-]+)?\.(?:js|mjs|cjs|ts|py|sh)/i.test(String(latest.action_input?.file_path || ''))) {
    return 'HARD SCOPE RECOVERY: The harness rejected an undeclared verification helper. Do not read or write that helper. Keep mutations in the task outputs and use Command operation "verify" or the task\'s existing test command.';
  }

  const missing = diagnostic.match(/\bMISSING\s*:\s*(.{1,180})/i)?.[1]?.replace(/\s+/g, ' ').trim();
  if (missing && (latest.action === 'Command' || latest.action === 'Bash')) {
    return `HARD ACCEPTANCE RECOVERY: The last check reported missing requirements: ${missing}. Do not rerun it unchanged; inspect and repair the task output before checking again.`;
  }
  return '';
}

function mutationPathKey(state: ReactState, value: string): string {
  const workspace = String(state.workspace || '').trim();
  return normalizeWorkspacePathKey(workspace, value);
}

function failedMutationRecoveryTarget(state: ReactState): string | undefined {
  const currentSteps = getCurrentTaskSteps(state);
  const latest = currentSteps[currentSteps.length - 1];
  if (!latest || !isPlanMutationAction(latest.action, latest.action_input) || isSuccessfulObservation(latest)) {
    return undefined;
  }

  const target = latest.action_input?.file_path ?? latest.action_input?.path;
  return typeof target === 'string' && target.trim() ? target : undefined;
}

interface StaleEditRecoveryContext {
  target: string;
}

function isStaleEditFailure(step: ReactState['steps'][number]): boolean {
  return step.action === 'Edit' &&
    !isSuccessfulObservation(step) &&
    /old_string was not found(?: in the guarded preimage)?/i.test(step.observation || '');
}

function successfulMutationForTarget(
  step: ReactState['steps'][number],
  state: ReactState,
  target: string,
): boolean {
  if (!isSuccessfulObservation(step) || !MUTATING_ACTIONS.has(step.action)) return false;
  const value = step.action_input?.file_path ?? step.action_input?.path;
  return typeof value === 'string' && mutationPathKey(state, value) === mutationPathKey(state, target);
}

function missingCreatedFileTargets(state: ReactState): string[] {
  return (state.taskAnalysis?.affectedFiles || [])
    .filter((file) => file.intent === 'create' && typeof file.path === 'string' && file.path.trim())
    .filter((file) => !getTaskEvidenceSteps(state).some((step) => successfulMutationForTarget(step, state, file.path)))
    .map((file) => file.path);
}

function successfulReadForTarget(
  step: ReactState['steps'][number],
  state: ReactState,
  target: string,
): boolean {
  if (!isSuccessfulObservation(step) || !MUTATION_RECOVERY_READ_ACTIONS.has(step.action)) return false;
  const value = step.action_input?.file_path ?? step.action_input?.path;
  return typeof value === 'string' && mutationPathKey(state, value) === mutationPathKey(state, target);
}

/**
 * Find an Edit payload that already failed because its old_string was absent
 * and was followed by a successful read of the same target. A model must not
 * replay that exact payload: the read is the new preimage, so it needs to
 * select a replacement string (and guarded hash) from the refreshed content.
 */
function staleEditRecoveryContext(
  state: ReactState,
  candidate?: Record<string, unknown>,
): StaleEditRecoveryContext | undefined {
  const steps = getCurrentTaskSteps(state);
  const candidateTarget = candidate?.file_path ?? candidate?.path;
  const candidateOld = candidate?.old_string;
  const candidateNew = candidate?.new_string;

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const failed = steps[index];
    if (!isStaleEditFailure(failed)) continue;

    const target = failed.action_input?.file_path ?? failed.action_input?.path;
    const oldString = failed.action_input?.old_string;
    const newString = failed.action_input?.new_string;
    if (typeof target !== 'string' || typeof oldString !== 'string' || typeof newString !== 'string') continue;

    if (candidate) {
      if (
        typeof candidateTarget !== 'string' ||
        mutationPathKey(state, candidateTarget) !== mutationPathKey(state, target) ||
        candidateOld !== oldString ||
        candidateNew !== newString
      ) {
        continue;
      }
    }

    const later = steps.slice(index + 1);
    if (later.some((step) => successfulMutationForTarget(step, state, target))) continue;
    if (!later.some((step) => successfulReadForTarget(step, state, target))) continue;

    return { target };
  }

  return undefined;
}

function staleEditReplayError(
  state: ReactState,
  tool: string,
  input: Record<string, unknown>,
  ledger?: ToolEvidenceLedger,
): string | undefined {
  if (tool !== 'Edit') return undefined;
  const recovery = staleEditRecoveryContext(state, input);
  if (!recovery) return undefined;

  const errorMsg = `The exact Edit for ${recovery.target} was already rejected because old_string was not found, and the target was reread. Do not replay that old_string/new_string pair. Choose a new exact Edit copied from the refreshed Read output with its guarded expectedHash, or use a guarded Write only if a whole-file rewrite is necessary.`;

  ledger?.recordStaleEditIntervention(
    { action: tool, action_input: input },
    recovery.target,
    'rejected_replay',
    errorMsg
  );

  return errorMsg;
}

function staleEditRecoveryGuidance(state: ReactState): string {
  const recovery = staleEditRecoveryContext(state);
  if (!recovery) return '';

  return `STALE EDIT RECOVERY: The previous Edit for ${recovery.target} failed because old_string was not present in the file. A fresh Read succeeded afterward. Derive a new exact old_string from that Read, include its guarded expectedHash, and do not reuse the rejected old_string/new_string pair.`;
}

function continuationMutationRecoveryTarget(state: ReactState): string | undefined {
  const task = String(state.task || '');
  const isFailedContinuation = /Continuation handoff/i.test(task) &&
    /Latest status\s*\(unverified\):[\s\S]*-\s*(?:error|stopped):/i.test(task);
  if (!isFailedContinuation) return undefined;

  const lastRunTarget = state.lastRun?.lastActionInput?.file_path ?? state.lastRun?.lastActionInput?.path;
  const candidates = [
    lastRunTarget,
    ...(state.taskAnalysis?.affectedFiles || []).map((file) => file.path),
    ...(state.taskAnalysis?.contract?.candidateFiles || []),
    getTargetFileFromState(state),
  ];
  return candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)?.trim();
}

function getMutationRecoveryTarget(state: ReactState): string | undefined {
  return failedMutationRecoveryTarget(state) || continuationMutationRecoveryTarget(state);
}

export function isMutationRecoveryInspection(
  state: ReactState,
  tool: string,
  input: Record<string, unknown>,
): boolean {
  const target = state.forceReadTarget || getMutationRecoveryTarget(state);
  if (!target || !MUTATION_RECOVERY_READ_ACTIONS.has(tool)) return false;

  const requested = input.file_path ?? input.path;
  return typeof requested === 'string' &&
    mutationPathKey(state, requested) === mutationPathKey(state, target);
}

function buildFailedMutationRecoveryRead(
  state: ReactState,
  toolRegistry?: ToolRegistry,
): { action: string; action_input: Record<string, unknown> } | null {
  if (state.forceMutationNextAction) return null;
  const target = getMutationRecoveryTarget(state);
  if (!target || !toolExists('Read', toolRegistry)) return null;
  return { action: 'Read', action_input: { file_path: target } };
}

function isConfirmedMissingNonCreateTarget(state: ReactState, value: string): boolean {
  const targetKey = mutationPathKey(state, value);
  const createTargets = new Set(
    (state.taskAnalysis?.affectedFiles || [])
      .filter((file) => file.intent === 'create')
      .map((file) => mutationPathKey(state, file.path))
  );
  if (createTargets.has(targetKey)) return false;

  return (state.taskAnalysis?.projectFileMap?.files || []).some((file) =>
    file.exists === false && mutationPathKey(state, file.path) === targetKey
  );
}

function knownMutationTargets(state: ReactState): Set<string> {
  const targets = new Set<string>();
  for (const candidate of state.taskAnalysis?.contract?.candidateFiles || []) {
    if (typeof candidate === 'string' && candidate.trim() && !isConfirmedMissingNonCreateTarget(state, candidate)) {
      targets.add(mutationPathKey(state, candidate));
    }
  }
  for (const file of state.taskAnalysis?.affectedFiles || []) {
    if (file.intent !== 'create' && file.intent !== 'read_only' && file.path &&
        !isConfirmedMissingNonCreateTarget(state, file.path)) {
      targets.add(mutationPathKey(state, file.path));
    }
  }
  return targets;
}

function inspectedPaths(state: ReactState): Set<string> {
  return new Set(getTaskEvidenceSteps(state)
    .filter((step) => step.action === 'Read' && isSuccessfulObservation(step))
    .map((step) => {
      const value = step.action_input?.file_path ?? step.action_input?.path;
      return typeof value === 'string' ? mutationPathKey(state, value) : '';
    })
    .filter(Boolean));
}

function nextUninspectedTarget(state: ReactState): string | undefined {
  const candidates = Array.from(new Set([
    ...(state.taskAnalysis?.affectedFiles || [])
      .filter((file) => file.intent !== 'read_only' && file.path)
      .map((file) => file.path),
    ...(state.taskAnalysis?.contract?.candidateFiles || []),
  ]));
  const inspected = inspectedPaths(state);
  const sourceCandidates = candidates.filter((candidate) => !/\.(?:md|mdx|txt|pdf|docx)$/i.test(candidate));
  const ordered = [...sourceCandidates, ...candidates.filter((candidate) => !sourceCandidates.includes(candidate))];
  return ordered.find((candidate) => !inspected.has(mutationPathKey(state, candidate)));
}

function hasInspectedAllKnownMutationTargets(state: ReactState): boolean {
  const targets = knownMutationTargets(state);
  if (!targets.size) return false;
  const inspected = inspectedPaths(state);
  return [...targets].every((target) => inspected.has(target));
}

function hasMutationForceBlocker(state: ReactState): boolean {
  const analysis = state.taskAnalysis;
  if (!analysis) return false; // Preserve legacy behavior for unanalyzed runs.
  if (analysis.expectedChangeIntent === 'read_only') return true;
  if (analysis.approvalPolicy === 'ask' && !hasMutationApprovalGrant(state)) return true;
  if (analysis.contract?.permissions?.canMutate === false) return true;
  if ((state.codingState || '') === 'blocked') return true;
  const recentEvidence = getCurrentTaskSteps(state).slice(-3).map((step) => step.observation || '').join('\n');
  return /workspace changed|checkpoint.*stale|expected hash|file changed since|uncommitted user changes|transactional mutation rejected|requires approval|user confirmation required/i.test(recentEvidence);
}

export function hasMutationApprovalGrant(state: ReactState): boolean {
  const targets = knownMutationTargets(state);
  const approvedScopes = new Set([...targets].map((target) => `write:${target}`));
  return activeApprovalGrants(state.approvalGrants).some((grant) =>
    grant.decision === 'allow' && (grant.scope === '*' || approvedScopes.has(grant.scope))
  );
}

function canForceKnownTargetMutation(state: ReactState): boolean {
  if (hasMutationForceBlocker(state)) return false;
  // An analyzed task with no target evidence may still be an intentionally
  // broad update request. Once a relevant source file has been inspected,
  // force the model to choose a concrete mutation instead of rereading files
  // indefinitely. Unanalyzed legacy callers retain their existing behavior.
  if (!state.taskAnalysis) return true;
  const targets = knownMutationTargets(state);
  return targets.size > 0
    ? hasInspectedAllKnownMutationTargets(state)
    : hasRelevantInspectionEvidence(state);
}

function canStartEmptyWorkspaceImplementation(state: ReactState): boolean {
  return !hasMutationForceBlocker(state);
}

export function hasUninspectedKnownMutationTargets(state: ReactState): boolean {
  const targets = knownMutationTargets(state);
  if (!targets.size) return false;
  const inspected = new Set(getTaskEvidenceSteps(state)
    .filter((step) => step.action === 'Read' && isSuccessfulObservation(step))
    .map((step) => {
      const value = step.action_input?.file_path ?? step.action_input?.path;
      return typeof value === 'string' ? mutationPathKey(state, value) : '';
    })
    .filter(Boolean));
  return [...targets].some((target) => !inspected.has(target));
}

function isSuccessfulEmptyRootDiscovery(step: ReactState['steps'][number]): boolean {
  if (step.action !== 'Glob' && !(step.action === 'Command' && step.action_input?.operation === 'list_directory')) return false;
  try {
    const observation = JSON.parse(step.observation || '{}') as { success?: unknown; output?: unknown };
    return observation.success !== false && typeof observation.output === 'string' && observation.output.trim() === '';
  } catch {
    return false;
  }
}

function cleanDirectoryEntries(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((entry) => Array.from(entry)
      .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
      .join('')
      .trim())
    .filter(Boolean);
}

/**
 * Avoid a second LLM request when one authoritative root listing completely
 * answers a classified read-only inspection. Broader investigations still
 * require normal synthesis.
 */
export function getDeterministicInspectionAnswer(state: ReactState): string | undefined {
  if (state.appSpec || state.taskAnalysis?.expectedChangeIntent !== 'read_only' || state.steps.length !== 1) {
    return undefined;
  }

  const step = state.steps[0];
  const isRootGlob = step.action === 'Glob' && step.action_input?.pattern === '**/*';
  const isRootListing = step.action === 'Command' &&
    step.action_input?.operation === 'list_directory' &&
    (!Array.isArray(step.action_input.args) || step.action_input.args.length === 0 || step.action_input.args[0] === '.');
  if (!isRootGlob && !isRootListing) return undefined;

  const observation = parseObservation(step.observation);
  if (!observation || observation.success !== true || typeof observation.output !== 'string') return undefined;

  const request = state.taskAnalysis?.userRequest?.trim() || '';
  if (/^(?:update|edit|change|modify|fix|work on|continue|implement|build)\s*[.!?]*$/i.test(request)) {
    return 'I need a concrete target before I can make an update. Please name the file, feature, or TODO item and describe the change you want.';
  }

  const entries = cleanDirectoryEntries(observation.output);
  if (entries.length === 0) {
    return 'I inspected the workspace root. It is empty—no files or directories were found. No files were modified.';
  }

  const shownEntries = entries.slice(0, 50);
  const suffix = entries.length > shownEntries.length
    ? `\n- …and ${entries.length - shownEntries.length} more`
    : '';
  return `I inspected the workspace root and found ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}:\n\n${shownEntries.map((entry) => `- ${entry}`).join('\n')}${suffix}\n\nNo files were modified.`;
}

function compactPlannerHistorySteps(steps: ReactState['steps']): ReactState['steps'] {
  const compacted: ReactState['steps'] = [];
  const seenFailedActions = new Set<string>();
  let keptEmptyDiscovery = false;
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index];
    if (isSuccessfulEmptyRootDiscovery(step)) {
      if (keptEmptyDiscovery) continue;
      keptEmptyDiscovery = true;
    }
    if (isFailedPlannerStep(step)) {
      const key = `${step.action}:${plannerActionInputKey(step.action_input)}:${failureDiagnostic(step).toLowerCase()}`;
      if (seenFailedActions.has(key)) continue;
      seenFailedActions.add(key);
    }
    compacted.push(step);
  }
  return compacted.reverse();
}

function requiredPlannerToolArgumentError(tool: string, input: Record<string, unknown>): string | undefined {
  if (tool === 'Bash' && (typeof input.command !== 'string' || !input.command.trim())) {
    return 'Bash requires a non-empty command argument.';
  }
  if (tool === 'Command' && (typeof input.operation !== 'string' || !input.operation.trim())) {
    return 'Command requires an operation argument.';
  }
  if (['Read', 'DocumentRead', 'Write', 'Edit'].includes(tool)) {
    const path = input.file_path ?? input.path ?? input.filename ?? input.file;
    if (typeof path !== 'string' || !path.trim()) return `${tool} requires a file_path argument.`;
  }
  if (tool === 'Write' && typeof input.content !== 'string' && typeof input.content_base64 !== 'string') {
    return 'Write requires content or content_base64.';
  }
  return undefined;
}

/**
 * Keep durable execution truth in distinct, bounded prompt regions.  In
 * particular, an expanding history must not displace current failures,
 * permission constraints, or the active plan.
 */
function buildBoundedPlannerContext(
  state: ReactState,
  contextAssembly?: CordisContextAssemblyService,
  budgets: readonly ContextBudget[] = DEFAULT_CONTEXT_BUDGETS,
) {
  // The structured continuation handoff is the bounded parent-run memory.
  // Feed the planner only child-run actions after resume; full parent steps
  // remain in ReactState for deterministic evidence and verification gates.
  const plannerSteps = state.continuationHandoff
    ? getCurrentTaskSteps(state)
    : state.steps;
  const workspaceIsolationGuidance = workspaceRootRecoveryInstruction(state);
  const retainedReadSteps = getTaskEvidenceSteps(state);
  const retainedReadCoverage = getRetainedReadCoverage(retainedReadSteps);
  const failures = summarizeRecentPlannerFailures(plannerSteps);
  const repeatGuidance = getRepeatedFailedActionGuidance(state);
  const staleEditGuidance = staleEditRecoveryGuidance(state);
  const approvalPolicy = state.taskAnalysis?.approvalPolicy || state.taskAnalysis?.contract?.permissions?.approvalPolicy;
  const mode: PermissionMode = approvalPolicy === 'full_access'
    ? 'full_workspace'
    : approvalPolicy === 'auto_approve'
      ? 'scoped_auto_approve'
      : state.taskAnalysis?.expectedChangeIntent === 'read_only'
        ? 'read_only'
        // Starting a task is the existing UI approval boundary. Individual
        // high-risk scopes still require explicit policy approval.
        : 'scoped_auto_approve';
  const permissions = [
    state.taskAnalysis?.contract?.permissions ? JSON.stringify(state.taskAnalysis.contract.permissions) : 'No additional task-specific permission constraints recorded.',
    policyGuidance({ workspace: state.workspace, mode, taskId: state.taskAnalysis?.id, approvalGrants: state.approvalGrants }),
  ].join('\n');
  const uncertainToolOutcomes = state.uncertainToolCalls?.length
    ? [
        'Uncertain tool outcomes requiring fresh evidence before replay:',
        ...state.uncertainToolCalls.slice(-6).map((call) =>
          `- ${call.tool} (${call.toolCallId}) stopped before a durable result. Verify its effect before retrying this same side-effecting action.`
        ),
      ].join('\n')
    : '';
  const plannerTask = getPlannerTaskText(state);
  const historyBudget = budgets.find((budget) => budget.category === 'history')?.maxTokens ?? 4_000;
  const historyMaxTokens = state.continuationCount
    ? Math.min(2_000, historyBudget)
    : historyBudget;
  const sections = {
    task: plannerTask,
    plan: formatPlan(state.plan),
    active_errors: [
      staleEditGuidance,
      repeatGuidance,
      workspaceIsolationGuidance,
      state.activeRepair ? JSON.stringify(state.activeRepair) : '',
      state.lastRecovery ? `Recovery boundary: ${JSON.stringify(state.lastRecovery)}` : '',
      failures,
      uncertainToolOutcomes,
    ].filter(Boolean).join('\n'),
    permissions,
    evidence: [
      formatAppContractContext(state),
      formatTaskAnalysisContext(state),
      formatTaskRoutingContext(state),
      formatSubtaskDispatchContext(state),
      `Agent-owned workplan:\n${formatWorkPlan(state.workPlan)}`,
      formatContinuationCheckpointContext(state),
      formatLastRunSolutionAwareness(state),
      state.conversationUpdates?.length
        ? `User updates received at safe checkpoints:\n${state.conversationUpdates.map((message) => `- ${message}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n'),
    memory: buildRetainedReadContext(retainedReadSteps),
    history: buildStepHistory(compactPlannerHistorySteps(plannerSteps), {
      ...(state.continuationCount
        ? { maxTokens: historyMaxTokens, recentStepCount: 4 }
        : { maxTokens: historyMaxTokens }),
      retainedReadCoverage,
      deduplicateReadContext: true,
    }),
  };
  return contextAssembly?.compactSections(sections, budgets) || compactContextByBudget(sections, budgets);
}

/**
 * Continuation handoffs already carry bounded parent-run context. Do not send
 * that envelope back to the model as if it were the user's task, and cap the
 * remaining request so a duplicated chat prompt cannot consume the whole
 * local context window.
 */
function getPlannerTaskText(state: Pick<ReactState, 'task' | 'continuationHandoff'>): string {
  let task = state.task || '';
  if (state.continuationHandoff) {
    const marker = task.lastIndexOf('Current request:');
    if (marker >= 0) task = task.slice(marker + 'Current request:'.length).trim();
  }
  return truncateString(task, 24_000);
}

function formatLastRunSolutionAwareness(
  state: Pick<ReactState, 'lastRun' | 'continuationHandoff' | 'plan' | 'blockedReason' | 'forceMutationNextAction'>,
): string {
  const handoff = state.continuationHandoff;
  const marker = handoff?.lastRun || state.lastRun;
  const blocker = handoff?.blocker || state.blockedReason;
  const completedItems = handoff?.completedPlanItems?.length
    ? handoff.completedPlanItems
    : state.plan.filter((item) => item.status === 'completed').map((item) => item.step).slice(-4);
  const remainingItem = handoff?.remainingPlanItem ||
    handoff?.remainingPlanItems?.[0] ||
    marker?.nextPlanItem ||
    state.plan.find((item) => item.status === 'in_progress')?.step ||
    state.plan.find((item) => item.status === 'pending')?.step;
  const updatedFiles = handoff?.updatedFiles || [];
  const passedChecks = handoff?.verifiedChecks || [];
  const recentActions = handoff?.recentActions?.slice(-4).map((item) =>
    `${item.action}${item.target ? ` ${item.target}` : ''} (${item.outcome})`
  ) || [];
  if (recentActions.length === 0 && marker?.lastAction) {
    recentActions.push(
      `${marker.lastAction}${summarizeLastRunTarget(marker.lastActionInput) ? ` ${summarizeLastRunTarget(marker.lastActionInput)}` : ''} (${marker.lastActionSucceeded === false ? 'failed' : 'succeeded'})`,
    );
  }

  if (!handoff && !marker && !blocker && !state.forceMutationNextAction && recentActions.length === 0) return '';

  const result = blocker
    ? `stopped with a blocker: ${blocker}`
    : marker?.lastActionSucceeded === false
      ? 'the last recorded action failed and needs recovery'
      : marker?.lastAction
        ? `the last recorded action (${marker.lastAction}) succeeded`
        : 'the prior execution state is preserved';
  const recommendedNextAction = blocker && /approval|permission|confirmation/i.test(blocker)
    ? 'Resolve the approval or permission boundary, then resume the remaining plan item.'
    : state.forceMutationNextAction || /source mutation|Write or Edit|repeated inspection/i.test(blocker || '')
      ? 'Choose a scoped Write or Edit action now; do not repeat inspection.'
      : marker?.lastActionSucceeded === false
        ? `Repair or retry the failed ${marker.lastAction || 'action'} before reporting progress.`
        : remainingItem
          ? `Continue with the remaining plan item: ${remainingItem}`
          : 'Continue from the latest durable checkpoint and verify before completion.';
  const preserved = [
    completedItems.length ? `completed plan items: ${completedItems.join(' | ')}` : '',
    updatedFiles.length ? `updated files: ${updatedFiles.join(', ')}` : '',
    passedChecks.length ? `passed checks: ${passedChecks.join(' | ')}` : '',
  ].filter(Boolean).join('; ') || 'none recorded';

  return [
    '',
    'Last-run solution awareness (bounded guidance; not completion evidence):',
    `- Attempted approach: ${recentActions.length ? recentActions.join(' -> ') : 'not recorded'}`,
    `- Preserved progress: ${preserved}`,
    `- Last-run result: ${result}`,
    `- Recommended next action: ${recommendedNextAction}`,
    '- Treat this as a continuation cue, not proof that the current workspace is unchanged or complete.',
  ].join('\n');
}

function summarizeLastRunTarget(input?: Record<string, unknown>): string | undefined {
  const target = input?.file_path ?? input?.path ?? input?.operation ?? input?.command;
  return typeof target === 'string' && target.trim() ? target.trim().slice(0, 180) : undefined;
}

function plannerActionInputKey(input: Record<string, unknown> | undefined): string {
  try {
    const canonicalize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonicalize);
      if (value !== null && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return Object.fromEntries(
          Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]),
        );
      }
      return value;
    };
    return JSON.stringify(canonicalize(input || {}));
  } catch {
    return '{}';
  }
}

function isFailedPlannerStep(step: { observation?: string }): boolean {
  return /\"success\"\s*:\s*false|\b(failed|error|timed out|cancelled)\b/i.test(step.observation || '');
}

function failureDiagnostic(step: { observation?: string }): string {
  const observation = step.observation || '';
  try {
    const parsed = JSON.parse(observation) as Record<string, unknown>;
    const detail = [parsed.error, parsed.stderr, parsed.message, parsed.output]
      .find((value): value is string => typeof value === 'string' && Boolean(value.trim()));
    return (detail || String(parsed.status || observation)).replace(/\s+/g, ' ').trim().slice(0, 700);
  } catch {
    return observation.replace(/\s+/g, ' ').trim().slice(0, 700);
  }
}

function isWorkspaceIsolationFailure(step: { action: string; observation?: string }): boolean {
  return step.action === 'Bash' &&
    /Workspace isolation rejected this Bash command/i.test(failureDiagnostic(step));
}

function isWindowsDirectorySyntaxFailure(step: { action: string; observation?: string; action_input?: Record<string, unknown> }): boolean {
  if (step.action !== 'Bash') return false;
  const command = typeof step.action_input?.command === 'string' ? step.action_input.command : '';
  return /The filename, directory name, or volume label syntax is incorrect/i.test(failureDiagnostic(step)) &&
    /(?:^|&&|\|\||[&|])\s*dir(?:\s|$)/i.test(command);
}

function hasPendingWorkspaceIsolationRecovery(state: ReactState): boolean {
  const currentSteps = state.continuationHandoff ? getCurrentTaskSteps(state) : state.steps;
  const latest = currentSteps.at(-1);
  if (latest) return isWorkspaceIsolationFailure(latest);

  const handoffAction = state.continuationHandoff?.recentActions?.at(-1);
  return handoffAction?.action === 'Bash' &&
    handoffAction.outcome === 'failed' &&
    /Workspace isolation rejected this Bash command/i.test(handoffAction.failure || '');
}

function hasPendingWindowsDirectorySyntaxRecovery(state: ReactState): boolean {
  const currentSteps = state.continuationHandoff ? getCurrentTaskSteps(state) : state.steps;
  const latest = currentSteps.at(-1);
  if (latest) return isWindowsDirectorySyntaxFailure(latest);

  const handoffAction = state.continuationHandoff?.recentActions?.at(-1);
  return handoffAction?.action === 'Bash' &&
    handoffAction.outcome === 'failed' &&
    /The filename, directory name, or volume label syntax is incorrect/i.test(handoffAction.failure || '');
}

function workspaceIsolationRecoveryInstruction(state: ReactState): string {
  if (!hasPendingWorkspaceIsolationRecovery(state)) return '';
  return [
    'HARD WORKSPACE ISOLATION RECOVERY: A Bash command referenced a path outside the selected target workspace and was rejected by the safety guard.',
    `The active workspace is "${state.workspace}".`,
    'Do not try another guessed or absolute workspace path, and do not retry the rejected Bash command.',
    'Your next action MUST be Command with operation "list_directory", args ["."], and cwd "." to inspect the selected workspace root.',
    'After that listing succeeds, use only workspace-relative paths and cwd values for all further actions.',
  ].join(' ');
}

function windowsDirectorySyntaxRecoveryInstruction(state: ReactState): string {
  if (!hasPendingWindowsDirectorySyntaxRecovery(state)) return '';
  return [
    'HARD WINDOWS DIRECTORY RECOVERY: The native Bash directory command failed with Windows filename/directory syntax.',
    `The active workspace is "${state.workspace}".`,
    'Do not retry the failed dir command or probe an absolute path. Your next action MUST be Command with operation "list_directory", args ["."], and cwd "." to inspect the selected workspace root.',
    'After that listing succeeds, use only workspace-relative paths and cwd values for further actions.',
  ].join(' ');
}

function missingReadWorkspaceRecovery(state: ReactState): ReturnType<typeof getLatestReadFailureDetails> {
  const failure = getLatestReadFailureDetails(state);
  return failure?.missingTarget && !failure.canRecoverAsMutation ? failure : undefined;
}

function requiresWorkspaceRootRecovery(state: ReactState): boolean {
  return hasPendingWorkspaceIsolationRecovery(state) ||
    hasPendingWindowsDirectorySyntaxRecovery(state) ||
    Boolean(missingReadWorkspaceRecovery(state));
}

function workspaceRootRecoveryInstruction(state: ReactState): string {
  const isolationGuidance = workspaceIsolationRecoveryInstruction(state);
  if (isolationGuidance) return isolationGuidance;

  const windowsDirectoryGuidance = windowsDirectorySyntaxRecoveryInstruction(state);
  if (windowsDirectoryGuidance) return windowsDirectoryGuidance;

  const failure = missingReadWorkspaceRecovery(state);
  if (!failure) return '';
  return [
    `HARD MISSING-PATH RECOVERY: Read failed because "${failure.target || 'the requested path'}" does not exist and it is not a confirmed mutable task target.`,
    `The active workspace is "${state.workspace}".`,
    'Do not guess another file path or retry the missing Read. Your next action MUST be Command with operation "list_directory", args ["."], and cwd "." to inspect the selected workspace root.',
    'After the listing succeeds, choose a file path that appears in workspace evidence and use workspace-relative paths.',
  ].join(' ');
}

function recentSuppressedReadTarget(state: ReactState): string | undefined {
  const steps = state.continuationHandoff ? getCurrentTaskSteps(state) : state.steps;
  const windowStart = Math.max(0, steps.length - 4);
  for (let index = steps.length - 1; index >= windowStart; index -= 1) {
    const step = steps[index];
    if (step.action !== 'ReplayGuard' || !/Repeated Read suppressed:/i.test(failureDiagnostic(step))) continue;

    const attempted = step.action_input?.attempted_input;
    const input = attempted && typeof attempted === 'object' && !Array.isArray(attempted)
      ? attempted as Record<string, unknown>
      : {};
    const target = input.file_path ?? input.path ?? step.action_input?.semantic_path;
    if (step.action_input?.attempted_action !== 'Read' || typeof target !== 'string' || !target.trim()) continue;
    const targetKey = mutationPathKey(state, target);
    const changedSinceSuppression = steps.slice(index + 1).some((laterStep) => {
      const changedPath = laterStep.action_input?.file_path ?? laterStep.action_input?.path;
      return (laterStep.action === 'Write' || laterStep.action === 'Edit') &&
        isSuccessfulObservation(laterStep) &&
        Boolean(typeof changedPath === 'string' && mutationPathKey(state, changedPath) === targetKey);
    });
    if (changedSinceSuppression) return undefined;
    const contentIsRetained = getRetainedReadCoverage(steps).some((entry) =>
      mutationPathKey(state, entry.path) === targetKey && entry.fullContentRetained
    );
    return contentIsRetained ? target : undefined;
  }
  return undefined;
}

function recentMissingReadTarget(state: ReactState): string | undefined {
  const steps = state.continuationHandoff ? getCurrentTaskSteps(state) : state.steps;
  const windowStart = Math.max(0, steps.length - 8);
  for (let index = steps.length - 1; index >= windowStart; index -= 1) {
    const step = steps[index];
    if ((step.action !== 'Read' && step.action !== 'DocumentRead') ||
        isSuccessfulObservation(step) ||
        !/(?:enoent|no such file|not found|does not exist|doesn't exist|cannot find|could not find|missing file)/i.test(failureDiagnostic(step))) {
      continue;
    }
    const input = step.action_input || {};
    const rawTarget = input.file_path ?? input.path;
    if (typeof rawTarget !== 'string' || !rawTarget.trim()) return undefined;
    const targetKey = mutationPathKey(state, rawTarget);
    const recovered = steps.slice(index + 1).some((laterStep) => {
      if (!['Read', 'DocumentRead', 'Write', 'Edit'].includes(laterStep.action) ||
          !isSuccessfulObservation(laterStep)) return false;
      const laterInput = laterStep.action_input || {};
      const laterTarget = laterInput.file_path ?? laterInput.path;
      return typeof laterTarget === 'string' && mutationPathKey(state, laterTarget) === targetKey;
    });
    if (recovered) continue;
    return rawTarget;
  }
  return undefined;
}

function summarizeRecentPlannerFailures(steps: ReactState['steps']): string {
  const groups = new Map<string, { action: string; input: string; diagnostic: string; count: number }>();
  const failedSteps = steps.filter(isFailedPlannerStep);
  const candidates = [...new Set([...failedSteps.slice(-4), ...steps.slice(-16)])];
  for (const step of candidates) {
    if (!isFailedPlannerStep(step)) continue;
    const input = plannerActionInputKey(step.action_input);
    const diagnostic = failureDiagnostic(step);
    const key = `${step.action}:${input}:${diagnostic.toLowerCase()}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { action: step.action, input, diagnostic, count: 1 });
  }
  return [...groups.values()].slice(-4).map((failure) =>
    `${failure.action}${failure.count > 1 ? ` (repeated ${failure.count} times)` : ''} with arguments ${truncateString(failure.input, 400)}: ${failure.diagnostic}`
  ).join('\n');
}

/**
 * Give the next model request an early, bounded recovery cue for an exact
 * failed call. The state manager remains the final safety boundary; this is
 * only model-visible guidance so the run can change direction before it gets
 * there.
 */
function getRepeatedFailedActionGuidance(state: ReactState): string {
  const steps = state.continuationHandoff ? getCurrentTaskSteps(state) : state.steps;
  const latest = steps.at(-1);
  if (!latest || !isFailedPlannerStep(latest)) return '';

  const latestInputKey = plannerActionInputKey(latest.action_input);
  let count = 0;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (!isFailedPlannerStep(step) || step.action !== latest.action || plannerActionInputKey(step.action_input) !== latestInputKey) break;
    count += 1;
  }

  const input = truncateString(latestInputKey, 700);
  const diagnostic = truncateString((latest.observation || 'failed without a diagnostic').replace(/\s+/g, ' '), 700);
  const isHashOrPreimageConflict = (latest.action === 'Write' || latest.action === 'Edit' || latest.action === 'ReplaceFile') &&
    /stale expected hash|old_string was not found in the guarded preimage|expectedHash from a guarded read is required|Pattern not found in file/i.test(diagnostic);
  const editTarget = latest.action_input?.file_path ?? latest.action_input?.path ?? 'the target file';
  const recoveryInstruction = isHashOrPreimageConflict
    ? `The edit to "${editTarget}" failed due to a stale preimage or hash conflict. You MUST perform a fresh Read of "${editTarget}" to inspect the latest content and obtain the fresh hash before attempting another Edit, or check if the change is already present.`
    : latest.action === 'Bash' && /not recognized as an internal or external command|command not found|syntax is incorrect|unterminated|unexpected token/i.test(diagnostic)
      ? 'For directory inspection on Windows, use Command with operation "list_directory" and args ["."], or correct the command syntax.'
      : 'Use the diagnostic to choose a different action or target, or correct the arguments before retrying.';
  if (count === 1) {
    return `LATEST FAILED TOOL CALL: ${latest.action} with arguments ${input}. Diagnostic: ${diagnostic} Read the diagnostic before acting. Do not retry this exact call unchanged; change the command/arguments or choose a different available tool. ${recoveryInstruction}`;
  }
  return `REPEATED FAILED TOOL CALL (${count} consecutive attempts): ${latest.action} with arguments ${input}. Latest diagnostic: ${diagnostic} Do not repeat this exact call again. ${recoveryInstruction}`;
}

export function formatContinuationCheckpointContext(state: Pick<ReactState, 'continuationHandoff'>): string {
  const handoff = state.continuationHandoff;
  if (!handoff) return '';
  const workspaceRebased = handoff.workspaceRebased === true;
  const lines = [
    '',
    workspaceRebased
      ? 'Workspace-rebased continuation checkpoint:'
      : 'Freshness-validated continuation checkpoint:',
    `- Current goal: ${handoff.currentGoal}`,
    ...(handoff.modelContextWindow ? [`- Model context window: ${handoff.modelContextWindow.toLocaleString()} tokens.`] : []),
    `- Completed plan items: ${handoff.completedPlanItems?.length ? handoff.completedPlanItems.join(' | ') : 'none recorded'}`,
    `- Remaining plan items: ${handoff.remainingPlanItems?.length ? handoff.remainingPlanItems.join(' | ') : handoff.remainingPlanItem || 'none recorded'}`,
    `- Files already updated: ${handoff.updatedFiles?.length ? handoff.updatedFiles.join(', ') : 'none recorded'}`,
    `- Checks already passed: ${handoff.verifiedChecks?.length ? handoff.verifiedChecks.join(' | ') : handoff.latestVerifiedCheck || 'none recorded'}`,
    `- Blocker at handoff: ${handoff.blocker || 'none'}`,
    ...(handoff.stagnationWarning ? [`- ⚠️ STAGNATION ALERT: ${handoff.stagnationWarning}`] : []),
    ...(handoff.lastRun
      ? [
          `- Durable resume marker: ${handoff.lastRun.completedStepCount} completed tool action(s); last action ${handoff.lastRun.lastAction || 'none'}${handoff.lastRun.lastActionSucceeded === false ? ' (failed)' : ''}; next plan item ${handoff.lastRun.nextPlanItem || 'determine from current plan'}.`,
        ]
      : []),
    ...(handoff.recentActions?.length
      ? [
          '- Recent parent actions (compact, newest execution tail):',
          ...handoff.recentActions.map((item) =>
            `  - ${item.action}${item.target ? `: ${item.target}` : ''} — ${item.outcome}${item.failure ? ` (${item.failure})` : ''}`
          ),
        ]
      : []),
    '- Continue from the first remaining item. Do not repeat a completed item or prior mutation merely to recreate context.',
    '- Treat the durable resume marker as the execution cursor. Do not replay a prior mutation or command merely to recreate progress. Read-only inspection may be repeated only when the compact handoff omitted evidence needed for the first remaining item.',
    workspaceRebased
      ? '- The workspace changed after the parent checkpoint. Treat prior reads and passed checks as historical context, inspect the current relevant files, then continue only the remaining work.'
      : '- Prior tool evidence remains valid because the resume freshness gate matched the tracked workspace. Rerun a passed check only when later changes could invalidate it.',
  ];
  return lines.join('\n');
}

/**
 * Resolve whether the selected planner route can receive provider-native
 * tools. An undefined result preserves the legacy provider-kind fallback for
 * routes that do not advertise capabilities.
 */
export function getPlannerNativeToolMode(llm: LLMProvider, model: string): boolean | undefined {
  const providerCapabilities = llm.getModelCapabilities?.(model);
  if (providerCapabilities) return providerCapabilities.toolCalling;

  const providerKind = providerKindFromName(llm.getProviderName());
  if (providerKind !== 'nvidia') return undefined;
  const nvidiaTarget = resolveNvidiaModelTarget(model);
  const nvidiaMetadata = getNvidiaModelMetadata(nvidiaTarget?.modelId || model);
  return nvidiaTarget?.supportsTools === true || nvidiaMetadata?.supportsTools === true;
}

export function formatTaskAnalysisContext(state: ReactState): string {
  const analysis = state.taskAnalysis;
  if (!analysis) return '';
  const cached = taskAnalysisContextCache.get(analysis);
  if (cached !== undefined) return cached;

  const affectedFiles = analysis.affectedFiles?.length
    ? analysis.affectedFiles
        .map((file) => `- ${file.path} (${file.intent}): ${file.reason}`)
        .join('\n')
    : '- No specific affected files listed; inspect files before any mutation.';
  const sourceFiles = analysis.sourceFiles?.length
    ? analysis.sourceFiles.map((file) => `- ${file} (read with DocumentRead; never mutate as implementation output)`).join('\n')
    : '- No attached source documents identified.';

  const inspections = analysis.requiredInspections?.length
    ? analysis.requiredInspections.map((item) => `- ${item}`).join('\n')
    : '- Inspect relevant files before mutation.';

  const verification = analysis.verificationPlan?.length
    ? analysis.verificationPlan.map((item) => `- ${item}`).join('\n')
    : '- Choose verification based on touched files.';
  const validationRequirements = analysis.validationRequirements?.length
    ? analysis.validationRequirements.map((item) => `- ${item}`).join('\n')
    : '- Verify the requested behavior before completion.';
  const riskFactors = analysis.riskFactors?.length
    ? analysis.riskFactors.map((item) => `- ${item}`).join('\n')
    : '- No elevated risk factors detected.';
  const fileMapSummary = analysis.projectFileMap
    ? `Project file map: ${analysis.projectFileMap.files.length}/${analysis.projectFileMap.totalFiles} files indexed (${analysis.projectFileMap.omittedCount} omitted) from ${analysis.projectFileMap.workspace}.`
    : 'Project file map: unavailable.';
  const expectedDeliverables = analysis.affectedFiles?.length
    ? analysis.affectedFiles
        .map((file) => `- ${file.intent} ${file.path}`)
        .join('\n')
    : analysis.contract?.candidateFiles?.length
      ? analysis.contract.candidateFiles.map((file) => `- resolve and inspect ${file}`).join('\n')
      : '- Resolve the relevant deliverables from current workspace evidence before mutation.';
  const requiredCreatedFiles = (analysis.affectedFiles || [])
    .filter((file) => file.intent === 'create')
    .map((file) => file.path);
  const createdFileGate = requiredCreatedFiles.length > 0
    ? `- Completion gate: successfully Write/Edit every new output file listed here: ${requiredCreatedFiles.join(', ')}.`
    : '';
  const requestedOutcome = analysis.contract?.requestedOutcome || 'Complete the resolved task and verify the result.';

  const historicalClaims = analysis.contract?.historicalClaims?.length
    ? analysis.contract.historicalClaims.map((claim) => `- [${claim.trust}] ${claim.claim} (${claim.reason})`).join('\n')
    : '- [untrusted] Prior conversation and historical summaries are intent only; inspect current files and rerun relevant verification before relying on them.';
  const specificity = analysis.specificity
    ? `Goal ${analysis.specificity.goalClarity.toFixed(2)}, target ${analysis.specificity.targetClarity.toFixed(2)}, acceptance ${analysis.specificity.acceptanceClarity.toFixed(2)}, overall ${analysis.specificity.score.toFixed(2)}${analysis.specificity.missing.length ? `; missing ${analysis.specificity.missing.join(' and ')}` : ''}.`
    : 'Specificity score unavailable; resolve scope from current evidence before mutation.';
  const blocker = analysis.contract?.blocker
    ? `BLOCKED: ${analysis.contract.blocker.message} ${analysis.contract.blocker.resolution}`
    : 'No analysis blocker recorded.';
  const repairGuidance = analysis.repairMode || analysis.taskKind === 'bug_fix' || analysis.behaviorScope === 'existing_behavior_fix'
    ? `

Incremental repair mode:
- The current workspace and existing implementation are authoritative. Preserve prior successful behavior and unrelated user changes.
- Inspect the current target and current diff before editing, then identify the smallest root cause that explains the reported failure.
- Prefer a focused Edit/minimal patch. Do not regenerate or rewrite an existing file wholesale unless it is genuinely missing or the task explicitly requires a whole-file replacement.
- Verify the repaired behavior and do not replay a side-effecting action whose outcome is uncertain without first checking the current workspace.`
    : '';

  const context = `\n\nCoder task analysis:
Task kind: ${analysis.taskKind}
Target layer: ${analysis.targetLayer || 'unknown'}
Behavior scope: ${analysis.behaviorScope || 'maintenance'}
Expected change intent: ${analysis.expectedChangeIntent}
Approval policy: ${analysis.approvalPolicy || 'ask'}
Risk level: ${analysis.riskLevel}
Refactor risk: ${analysis.refactorRisk || 'safe_change'}
Requires approval: ${analysis.requiresApproval ? 'yes' : 'no'}
Rationale: ${analysis.rationale}
Specificity: ${specificity}
Contract status: ${blocker}
${fileMapSummary}

Resolved workspace and deliverables:
- Use this exact resolved workspace for every file and command action: ${analysis.workspace}
- Requested outcome: ${requestedOutcome}
${expectedDeliverables}
${createdFileGate}
- Do not substitute another workspace or treat evidence from another workspace as current. If the workspace map does not match the resolved workspace, stop and ask for clarification.

Affected files:
${affectedFiles}

Source documents:
${sourceFiles}

Risk factors:
${riskFactors}

Required inspections:
${inspections}

Verification plan:
${verification}

Validation requirements before completion:
${validationRequirements}

${repairGuidance}

Historical claims (not current evidence):
${historicalClaims}

  Mutation guard:
- If expected change intent is read_only, do not use Write or Edit.
- If approval policy is auto_approve or full_access, proceed without asking for another confirmation.
- Before Write/Edit, read the target file unless it is a planned create.
- Write/Edit may be rejected if the file is outside affected files and was not inspected in this run.
- The operation must match the listed file intent.
  - If the same Edit pattern fails twice on the same file, stop retrying that exact Edit. Read the file again, then use a smaller exact Edit or a guarded Write rewrite for docs/checklist files.
  - For verification, prefer the structured Command tool: use operation "verify" for the contract's generic verification requirement, "smoke" for an explicitly requested project smoke check, or "test", "build", "typecheck", and "lint" for explicitly requested checks.
  - Do not use watch/dev test mode for completion evidence. Verification must terminate and return a final pass/fail result.
  - Do not mark the task complete until validation requirements are satisfied or the final answer explicitly states why validation could not run.`;
  taskAnalysisContextCache.set(analysis, context);
  return context;
}

function formatTaskRoutingContext(state: ReactState): string {
  const routing = state.taskRouting;
  if (!routing) return '';
  return `\n\nTyped task routing (coordination guidance):
Classification: ${routing.classification}
Estimated complexity: ${routing.estimatedComplexity}
Touched layers: ${routing.touchedLayers.join(', ') || 'none recorded'}
Primary agents: ${routing.primaryAgents.join(', ') || 'none selected'}
Supporting agents: ${routing.supportingAgents.join(', ') || 'none selected'}
Verification agents: ${routing.verificationAgents.join(', ') || 'none selected'}
Required capabilities: ${routing.requiredCapabilities.join(', ') || 'none recorded'}
Routing confidence: ${routing.confidence}
Risks: ${routing.risks.length ? routing.risks.map((risk) => `${risk.issue} — ${risk.mitigation}`).join(' | ') : 'none recorded'}
Use this routing to keep implementation within the typed task scope and make verification explicit.`;
}

function formatSubtaskDispatchContext(state: ReactState): string {
  const dispatch = state.subtaskDispatch;
  if (!dispatch) return '';
  const reports = dispatch.reports.map((report, index) => {
    const contract = dispatch.contracts[index];
    const changedFiles = report.changedFiles.slice(0, 20);
    const checks = report.checks.slice(-8).map((check) => `${check.status}: ${check.name}${check.output ? ` (${truncateString(check.output, 240)})` : ''}`);
    const blockers = report.blockers.slice(0, 6).map((blocker) => truncateString(blocker, 240));
    return [
      `- ${contract?.id || `child ${index + 1}`} (${report.success ? 'completed' : 'failed'}): ${contract?.objective || 'bounded task'}`,
      `  Changed files: ${changedFiles.join(', ') || 'none reported'}`,
      ...(report.evidenceRefs.length ? [`  Evidence refs: ${report.evidenceRefs.slice(-8).join(', ')}`] : []),
      ...(checks.length ? [`  Checks: ${checks.join(' | ')}`] : []),
      ...(blockers.length ? [`  Blockers: ${blockers.join(' | ')}`] : []),
    ].join('\n');
  });
  return `\n\nFresh-context subtask dispatch (${dispatch.status}; trigger: ${dispatch.trigger}; model: ${dispatch.model || 'unknown'}; context window: ${dispatch.contextWindow?.toLocaleString() || 'unknown'} tokens):\n${reports.length ? reports.join('\n') : '- No child reports were produced.'}${dispatch.blockers.length ? `\nDispatch blockers: ${dispatch.blockers.map((blocker) => truncateString(blocker, 300)).join(' | ')}` : ''}\nChild reports contain bounded evidence only; inspect current workspace and run applicable final verification before completing the parent task.`;
}

function formatAppContractContext(state: ReactState): string {
  const appSpec = state.appSpec;
  if (!appSpec) return '';
  const cached = appContractCache.get(appSpec);
  if (cached !== undefined) return cached;

  const context = `\n\nApp-building contract:\n${formatAppSpec(appSpec)}`;
  appContractCache.set(appSpec, context);
  return context;
}

function parseObservation(observation?: string): Record<string, unknown> | null {
  if (!observation) return null;

  const trimmed = observation.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;

  const result = parseJsonString<Record<string, unknown>>(trimmed);
  return result.success && result.data && !Array.isArray(result.data) ? result.data : null;
}

function observationText(step: ReactState['steps'][number]): string {
  const parsed = parseObservation(step.observation);
  const output = parsed?.output;
  const error = parsed?.error;

  return [
    typeof output === 'string' ? output : '',
    typeof error === 'string' ? error : '',
    step.observation || '',
  ].join('\n');
}

function isSuccessfulObservation(step: ReactState['steps'][number]): boolean {
  const parsed = parseObservation(step.observation);
  if (parsed && parsed.success === false) return false;
  if (parsed && (parsed.skipped === true || parsed.verificationUnavailable === true)) return false;
  if (parsed && parsed.success === true) return true;

  return !/error executing|command failed|enoent|validation error|failed/i.test(step.observation || '');
}

function isChecklistPath(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.replace(/\\/g, '/').toLowerCase();
  return /(^|\/)(todo|todos|checklist)(?:\.[^/]*)?$/.test(normalized) ||
    /(^|\/)(todo|todos|checklist)\//.test(normalized) ||
    /(^|\/)[^/]*(todo|checklist)[^/]*\.md$/.test(normalized);
}

function requiresImplementationEvidence(state: ReactState): boolean {
  return state.taskAnalysis?.taskKind === 'new_feature' ||
    state.taskAnalysis?.behaviorScope === 'new_behavior';
}

function hasMutationEvidence(state: ReactState): boolean {
  return getTaskEvidenceSteps(state).some((step) => {
    if (MUTATING_ACTIONS.has(step.action) && isSuccessfulObservation(step)) {
      const filePath = step.action_input?.file_path ?? step.action_input?.path;
      return !requiresImplementationEvidence(state) || !isChecklistPath(filePath);
    }
    if (step.action !== 'Bash' || !isSuccessfulObservation(step)) return false;

    const command = String(step.action_input?.command || '');
    return /\b(copy-item|new-item|set-content|add-content|out-file|move-item|rename-item)\b/i.test(command);
  });
}

export function hasSuccessfulVerificationSignal(state: ReactState): boolean {
  const steps = getTaskEvidenceSteps(state);
  let latestMutationIndex = -1;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const command = String(step.action_input?.command || '');
    const isMutation = MUTATING_ACTIONS.has(step.action) ||
      (step.action === 'Bash' && /\b(copy-item|new-item|set-content|add-content|out-file|move-item|rename-item)\b/i.test(command));
    if (isMutation && isSuccessfulObservation(step)) latestMutationIndex = index;
  }
  return steps.some((step, index) => {
    if (index <= latestMutationIndex) return false;
    if (!isSuccessfulObservation(step)) return false;
    const text = observationText(step);
    return (
      isVerificationAction(step.action, step.action_input) ||
      /(?:build complete|built in|tests? passed|all tests passed|compiled successfully|typecheck passed|lint passed)/i.test(text)
    );
  });
}

export function hasCompletionEvidence(state: ReactState): boolean {
  const currentSteps = getTaskEvidenceSteps(state);
  if (state.taskAnalysis?.expectedChangeIntent === 'read_only') {
    return currentSteps.some((step) => isSuccessfulObservation(step));
  }
  if (state.taskAnalysis && getStateEntryGateFailure(state, 'complete')) return false;
  if (state.taskAnalysis?.validationRequirements?.some((item) => /verification has run/i.test(item))) {
    return hasMutationEvidence(state) && hasSuccessfulVerificationSignal(state);
  }
  return hasMutationEvidence(state) && hasSuccessfulVerificationSignal(state);
}

function needsUserConfirmation(state: ReactState): boolean {
  const latestObservation = state.steps[state.steps.length - 1]?.observation || '';
  return /Before initializing Git here, ask the user for confirmation/i.test(latestObservation);
}

function getThinkingProfile(depth: ThinkingDepth = 'balanced'): {
  planTokens: number;
  reasonTokens: number;
  reasonTemperature: number;
  doneTokens: number;
  finalTokens: number;
  instruction: string;
} {
  switch (depth) {
    case 'fast':
      return {
        planTokens: 800,
        reasonTokens: 500,
        reasonTemperature: 0.5,
        doneTokens: 20,
        finalTokens: 500,
        instruction: 'Think briefly before choosing the next action.',
      };
    case 'deep':
      return {
        planTokens: 1800,
        reasonTokens: 1600,
        reasonTemperature: 0.35,
        doneTokens: 80,
        finalTokens: 900,
        instruction:
          'Analyze the task thoroughly before choosing the next action. Consider dependencies, risks, alternatives, verification strategy, and whether the current plan should change. Keep this analysis private and return only a concise user-visible rationale.',
      };
    case 'balanced':
    default:
      return {
        planTokens: 1100,
        reasonTokens: 800,
        reasonTemperature: 0.55,
        doneTokens: 40,
        finalTokens: 650,
        instruction:
          'Think through the next action carefully, including likely risks and verification. Return only a concise user-visible rationale.',
      };
  }
}

export { fixJsonString, extractJsonFromText, normalizeAssistantText } from '@barok/engine';
import {
  fixJsonString, extractJsonFromText, normalizeAssistantText,
  extractPlannerToolSelectionJson, extractJsonArrayFromText, repairToolSelectionJson,
} from '@barok/engine';

function parseToolArguments(argumentsValue: unknown): Record<string, unknown> {
  if (
    argumentsValue &&
    typeof argumentsValue === 'object' &&
    !Array.isArray(argumentsValue)
  ) {
    return argumentsValue as Record<string, unknown>;
  }

  if (typeof argumentsValue === 'string' && argumentsValue.trim().length > 0) {
    const parseResult = parseJsonString<Record<string, unknown>>(argumentsValue);
    if (parseResult.success && parseResult.data && !Array.isArray(parseResult.data)) {
      return parseResult.data;
    }

    throw new Error(
      `Error: Invalid tool arguments\n` +
        `Cause: Tool arguments string must contain a JSON object\n` +
        `Suggested Fix: Return {"tool":"ToolName","arguments":{...}} with object arguments, or a stringified JSON object\n` +
        `Context: Arguments: ${truncateString(argumentsValue, 200)}`
    );
  }

  return {};
}

function normalizeToolSelectionFromText(text: string): { tool: string; arguments: Record<string, unknown> } {
  const embeddedJson = extractJsonFromText(text);
  if (embeddedJson) {
    const fixedJson = fixJsonString(embeddedJson);
    const parseResult = parseJsonString<any>(fixedJson);
    if (parseResult.success && parseResult.data) {
      const directTool = typeof parseResult.data.tool === 'string'
        ? parseResult.data.tool
        : typeof parseResult.data.action === 'string'
        ? parseResult.data.action
        : '';

      if (directTool) {
        return {
          tool: directTool,
          arguments: parseToolArguments(parseResult.data.arguments || parseResult.data.action_input || {}),
        };
      }
    }
  }

  const actionMatch = text.match(/\bAction\s*:\s*([A-Za-z][A-Za-z0-9_-]*)/i);
  if (!actionMatch) {
    return { tool: '', arguments: {} };
  }

  const inputIndex = text.search(/\bAction\s+Input\s*:/i);
  if (inputIndex === -1) {
    return { tool: actionMatch[1], arguments: {} };
  }

  const inputJson = extractJsonFromText(text.slice(inputIndex));
  if (!inputJson) {
    return { tool: actionMatch[1], arguments: {} };
  }

  const parseResult = parseJsonString<Record<string, unknown>>(fixJsonString(inputJson));
  return {
    tool: actionMatch[1],
    arguments:
      parseResult.success && parseResult.data && !Array.isArray(parseResult.data)
        ? parseResult.data
        : {},
  };
}

function normalizeToolArguments(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...args };
  if (['Read', 'DocumentRead', 'Write', 'Edit'].includes(tool)) {
    const rawPath = normalized.file_path ?? normalized.path ?? normalized.file ?? normalized.filepath ?? normalized.filePath ?? normalized.filename ?? normalized.target_file ?? normalized.targetPath;
    if (typeof rawPath === 'string' && rawPath.trim()) {
      normalized.file_path = rawPath.trim();
    }
  }
  if (tool === 'Write') {
    if (normalized.content === undefined && normalized.content_base64 === undefined) {
      const rawContent = normalized.contents ?? normalized.code ?? normalized.text ?? normalized.body ?? normalized.data;
      if (typeof rawContent === 'string') {
        normalized.content = rawContent;
      }
    }
  }
  if (tool === 'Edit') {
    if (normalized.old_string === undefined) {
      const rawOld = normalized.old_content ?? normalized.oldContent ?? normalized.target ?? normalized.search ?? normalized.find;
      if (typeof rawOld === 'string') normalized.old_string = rawOld;
    }
    if (normalized.new_string === undefined) {
      const rawNew = normalized.new_content ?? normalized.newContent ?? normalized.replacement ?? normalized.replace;
      if (typeof rawNew === 'string') normalized.new_string = rawNew;
    }
  }
  return normalized;
}

function normalizeToolSelection(
  parsed: any,
  toolRegistry?: ToolRegistry,
  platform = getNodePlatform(),
): { tool: string; arguments: Record<string, unknown> } {
  const directTool = typeof parsed?.tool === 'string'
    ? parsed.tool
    : typeof parsed?.action === 'string'
    ? parsed.action
    : '';

  if (directTool) {
    const hasNestedArguments = Object.hasOwn(parsed, 'arguments') || Object.hasOwn(parsed, 'action_input');
    const flattenedArguments = Object.fromEntries(
      Object.entries(parsed).filter(([key]) => ![
        'tool',
        'action',
        'arguments',
        'action_input',
        'role',
        'reasoning',
        'rationale',
        'reason',
        'tool_calls',
      ].includes(key))
    );
    const rawArgs = parseToolArguments(
      hasNestedArguments
        ? (Object.hasOwn(parsed, 'arguments') ? parsed.arguments : parsed.action_input)
        : flattenedArguments
    );
    return {
      tool: directTool,
      arguments: normalizeToolArguments(directTool, rawArgs),
    };
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const bareArguments = parsed as Record<string, unknown>;
    const filePath =
      typeof bareArguments.file_path === 'string'
        ? bareArguments.file_path
        : typeof bareArguments.path === 'string'
        ? bareArguments.path
        : typeof bareArguments.file === 'string'
        ? bareArguments.file
        : typeof bareArguments.filepath === 'string'
        ? bareArguments.filepath
        : typeof bareArguments.filePath === 'string'
        ? bareArguments.filePath
        : typeof bareArguments.filename === 'string'
        ? bareArguments.filename
        : typeof bareArguments.target_file === 'string'
        ? bareArguments.target_file
        : typeof bareArguments.targetPath === 'string'
        ? bareArguments.targetPath
        : Object.entries(bareArguments).find(
            ([key, value]) =>
              /^(?:file_path|filepath|target_file)\b/i.test(key) &&
              typeof value === 'string' &&
              value.trim().length > 0
          )?.[1];

    // Recover read-only selections from providers that omit the outer tool
    // envelope. Mutations require an explicit tool name so arbitrary JSON or
    // pseudo-tool narration cannot become a Write/Edit call by inference.
    const candidates: Array<{ tool: string; arguments: Record<string, unknown> }> = [];
    if (typeof bareArguments.command === 'string' && bareArguments.command.trim() && toolExists('Bash', toolRegistry)) {
      candidates.push({ tool: 'Bash', arguments: bareArguments });
    }
    if (typeof bareArguments.operation === 'string' && bareArguments.operation.trim() && toolExists('Command', toolRegistry)) {
      candidates.push({ tool: 'Command', arguments: bareArguments });
    }
    if (typeof bareArguments.pattern === 'string' && /[*?\[]/.test(bareArguments.pattern) && toolExists('Glob', toolRegistry)) {
      candidates.push({ tool: 'Glob', arguments: bareArguments });
    }
    const hasWriteContent =
      typeof bareArguments.content === 'string' ||
      typeof bareArguments.content_base64 === 'string' ||
      typeof bareArguments.contents === 'string' ||
      typeof bareArguments.code === 'string' ||
      typeof bareArguments.text === 'string' ||
      typeof bareArguments.body === 'string';
    const hasEditContent =
      typeof bareArguments.old_string === 'string' ||
      typeof bareArguments.new_string === 'string' ||
      typeof bareArguments.old_content === 'string' ||
      typeof bareArguments.new_content === 'string' ||
      typeof bareArguments.oldContent === 'string' ||
      typeof bareArguments.newContent === 'string' ||
      typeof bareArguments.target === 'string' ||
      typeof bareArguments.replacement === 'string' ||
      typeof bareArguments.search === 'string' ||
      typeof bareArguments.replace === 'string' ||
      typeof bareArguments.find === 'string';
    if (
      typeof filePath === 'string' && filePath.trim() &&
      !hasWriteContent && !hasEditContent &&
      toolExists('Read', toolRegistry)
    ) {
      candidates.push({ tool: 'Read', arguments: normalizeToolArguments('Read', { ...bareArguments, file_path: filePath }) });
    }
    if (candidates.length === 1) {
      return candidates[0];
    }
  }

  const firstToolCall = Array.isArray(parsed?.tool_calls)
    ? parsed.tool_calls.find((call: unknown) => call && typeof call === 'object')
    : undefined;

  if (!firstToolCall) {
    const embeddedText = [parsed?.content, parsed?.reasoning]
      .find((value) => typeof value === 'string' && value.trim().length > 0);
    return typeof embeddedText === 'string'
      ? normalizeToolSelectionFromText(embeddedText)
      : { tool: '', arguments: {} };
  }

  const call = firstToolCall as any;
  const tool = typeof call.name === 'string'
    ? call.name
    : typeof call.tool === 'string'
    ? call.tool
    : typeof call.function?.name === 'string'
    ? call.function.name
    : '';

  const rawArgs = parseToolArguments(
    call.arguments ?? call.action_input ?? call.function?.arguments ?? {}
  );
  return {
    tool,
    arguments: normalizeToolArguments(tool, rawArgs),
  };
}

function normalizeUnavailableToolAlias(
  selection: { tool: string; arguments: Record<string, unknown> },
  toolRegistry?: ToolRegistry,
  platform = getNodePlatform(),
): { tool: string; arguments: Record<string, unknown> } {
  if (!selection.tool || toolExists(selection.tool, toolRegistry)) {
    return selection;
  }

  if (/^(?:write|write_file|writefile|create_file|createfile|write_to_file|save_file|put_file|tool_write)$/i.test(selection.tool) && toolExists('Write', toolRegistry)) {
    return {
      tool: 'Write',
      arguments: normalizeToolArguments('Write', selection.arguments),
    };
  }

  if (/^(?:edit|edit_file|editfile|replace_file_content|modify_file|modifyfile|patch_file|patchfile|str_replace_editor|tool_edit)$/i.test(selection.tool) && toolExists('Edit', toolRegistry)) {
    return {
      tool: 'Edit',
      arguments: normalizeToolArguments('Edit', selection.arguments),
    };
  }

  if (/^(?:read_file|readfile|view_file|viewfile|open_file|cat_file|get_file|tool_read)$/i.test(selection.tool) && toolExists('Read', toolRegistry)) {
    return {
      tool: 'Read',
      arguments: normalizeToolArguments('Read', selection.arguments),
    };
  }

  // Some OpenAI-compatible coding models use a generic function name instead
  // of the exact harness tool name even after receiving the tool catalog.
  // Preserve the requested command and normalize it to the native shell tool.
  if (/^(?:run|execute|shell)_command$/i.test(selection.tool) && toolExists('Bash', toolRegistry)) {
    const command = selection.arguments.command || selection.arguments.cmd || selection.arguments.script;
    if (typeof command === 'string' && command.trim()) {
      return {
        tool: 'Bash',
        arguments: {
          ...selection.arguments,
          command,
        },
      };
    }
  }

  if (/^repo_browser\.(?:open_file|read)$/i.test(selection.tool) && toolExists('Read', toolRegistry)) {
    const filePath =
      selection.arguments.file_path ||
      selection.arguments.path ||
      selection.arguments.file ||
      selection.arguments.uri;

    return {
      tool: 'Read',
      arguments: {
        ...selection.arguments,
        file_path: typeof filePath === 'string' ? filePath : '',
      },
    };
  }

  // Some coding models prefix the canonical tool name with `tool_` even
  // after receiving the harness catalog. Preserve the command and normalize
  // it to the native shell tool before hard selection validation.
  if (/^tool_bash$/i.test(selection.tool) && toolExists('Bash', toolRegistry)) {
    const command = selection.arguments.command || selection.arguments.cmd || selection.arguments.script;
    if (typeof command === 'string' && command.trim()) {
      return {
        tool: 'Bash',
        arguments: {
          ...selection.arguments,
          command,
        },
      };
    }
  }

  // Repository-browser adapters commonly expose content search as
  // `repo_browser.search`; the harness equivalent is Grep. Translate common
  // query field names while preserving the optional search path.
  if (/^repo_browser\.(?:search|grep)$/i.test(selection.tool) && toolExists('Grep', toolRegistry)) {
    const pattern = selection.arguments.pattern
      || selection.arguments.query
      || selection.arguments.search
      || selection.arguments.term;
    return {
      tool: 'Grep',
      arguments: {
        ...selection.arguments,
        ...(typeof pattern === 'string' ? { pattern } : {}),
      },
    };
  }

  if (selection.tool === 'repo_browser.glob' && toolExists('Glob', toolRegistry)) {
    const pattern =
      typeof selection.arguments.pattern === 'string'
        ? selection.arguments.pattern
        : typeof selection.arguments.path === 'string'
        ? `${selection.arguments.path.replace(/[\\/]+$/, '')}/**/*`
        : '**/*';

    return {
      tool: 'Glob',
      arguments: {
        ...selection.arguments,
        pattern,
      },
    };
  }

  // Smaller coding models often call the repository search tool FindFile or
  // find_file even though the harness exposes the capability as Glob. Keep
  // the search intent and normalize it before the hard tool validation runs.
  if (/^(?:find|find_file|findfile|search_file|searchfile)$/i.test(selection.tool) && toolExists('Glob', toolRegistry)) {
    const rawPattern = selection.arguments.pattern || selection.arguments.file_path || selection.arguments.path || selection.arguments.file;
    const pattern = typeof rawPattern === 'string' && rawPattern.trim()
      ? rawPattern.trim()
      : '**/*';
    return {
      tool: 'Glob',
      arguments: {
        ...selection.arguments,
        pattern: /[*?\[]/.test(pattern) ? pattern : `**/${pattern.replace(/^.*[\\/]/, '')}`,
      },
    };
  }

  if (selection.tool === 'repo_browser.print_tree' && (toolExists('Glob', toolRegistry) || toolExists('Bash', toolRegistry))) {
    const root =
      typeof selection.arguments.path === 'string'
        ? selection.arguments.path.trim()
        : typeof selection.arguments.cwd === 'string'
        ? selection.arguments.cwd.trim()
        : '';

    if (!toolExists('Glob', toolRegistry) && toolExists('Bash', toolRegistry)) {
      return {
        tool: 'Bash',
        arguments: {
          command: platform === 'win32' ? 'cmd /c dir /b /s' : 'find . -maxdepth 3 -type f',
          cwd: root || undefined,
          timeout: 30000,
        },
      };
    }

    return {
      tool: 'Glob',
      arguments: {
        pattern: root ? `${root.replace(/[\\/]+$/, '')}/**/*` : '**/*',
      },
    };
  }

  return selection;
}

function looksLikeTruncatedJson(response: string): boolean {
  const trimmedResponse = response.trim();
  return trimmedResponse.startsWith('{') && !trimmedResponse.endsWith('}');
}

function shouldRetryToolSelectionParse(errorMessage: string, rawJson: string): boolean {
  const isJsonParseFailure =
    /unterminated string|unexpected end|bad control character|invalid or unexpected token|expected.*(?:,|}|property value)|invalid json in tool selection/i.test(errorMessage);
  const looksLikeWriteSelection =
    /"tool"\s*:\s*"Write"|"action"\s*:\s*"Write"/.test(rawJson) ||
    /"file_path"\s*:/.test(rawJson);
  const looksLikeGeneratedFilePayload =
    /"content(_base64)?"\s*:/.test(rawJson) ||
    /<!doctype html|<html|<style|<script|function\s+\w+\s*\(|const\s+\w+\s*=|class\s*=|@import\s+|@tailwind\s+|:root\s*\{|--[a-zA-Z0-9_-]+\s*:/i.test(rawJson);

  const strippedOfComments = rawJson
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .trim();

  // CSS output is often cut off by provider limits before its closing brace.
  // Requiring a balanced block here lets that source fall through to the
  // generic malformed-JSON retry, which does not tell the model to use Write.
  const looksLikeTruncatedCssDeclarationBlock =
    /^\s*\{\s*(?:[-\w]+\s*:\s*[^{};]+;\s*){2,}/i.test(strippedOfComments);

  // A model may return a CSS declaration block extracted from generated HTML
  // instead of the required Write envelope. It is source content, not a
  // tool selection, so route it through the same compact Write recovery.
  const looksLikeBareCssDeclarations =
    (/^\s*\{\s*(?:[-\w]+\s*:\s*[^{};]+;?\s*){2,}\}\s*$/i.test(strippedOfComments) &&
      /[-\w]+\s*:\s*[^{};]+;/.test(strippedOfComments)) ||
    (/^\s*\{[\s\S]*\}\s*$/.test(strippedOfComments) &&
      /(?:^|\n|;)\s*--?[a-zA-Z0-9_-]+\s*:\s*[^;{}]+;/m.test(strippedOfComments)) ||
    /(?:^|\s)(?::root|@media|@keyframes|\*|body|html|[\.#][a-zA-Z0-9_-]+)\s*\{[\s\S]*\}/i.test(rawJson) ||
    looksLikeTruncatedCssDeclarationBlock;

  // Some local models emit the generated JavaScript/config object itself
  // instead of the required {"tool":"Write", ...} envelope. Treat the
  // distinctive bare-key config shape as a recoverable Write response so the
  // corrective prompt can request a compact, base64-backed tool call.
  const looksLikeBareGeneratedConfig =
    /^\s*\{\s*[A-Za-z_$][\w$]*\s*:/m.test(strippedOfComments) &&
    /(?:theme|extend|fontFamily|colors|screens|plugins)\s*:/i.test(strippedOfComments);

  const looksLikeBareGeneratedSource =
    looksLikeGeneratedFilePayload ||
    /^(?:<!doctype|<html|<style|<script|\/\*|\/\/|import\b|export\b|function\b|const\b|let\b|var\b|class\b|document\.|window\.|addEventListener|[a-zA-Z_$][\w$]*\s*=\s*(?:function|\([^)]*\)\s*=>|\{))/i.test(strippedOfComments) ||
    /(?:document\.getElementById|addEventListener|canvas\.|ctx\.|console\.log)/i.test(strippedOfComments);

  return (
    isJsonParseFailure &&
    ((looksLikeWriteSelection && (looksLikeGeneratedFilePayload || looksLikeBareCssDeclarations)) ||
      looksLikeBareCssDeclarations ||
      looksLikeBareGeneratedConfig ||
      looksLikeBareGeneratedSource)
  );
}

function isRecoverableStructuredParseFailure(errorMessage: string): boolean {
  return /invalid json in tool selection|expected.*(?:,|}|property value)|unterminated string|unexpected end|bad control character/i.test(errorMessage);
}

function looksLikeAssistantEnvelope(parsed: any): boolean {
  return Boolean(
    parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      !parsed.tool &&
      !parsed.action &&
      (Object.hasOwn(parsed, 'role') ||
        Object.hasOwn(parsed, 'reasoning') ||
        Object.hasOwn(parsed, 'tool_calls'))
  );
}

function correctiveToolSelectionFeedback(response: string, toolRegistry?: ToolRegistry): string {
  const pseudoToolCall = /\bSelected tool\s*:\s*[A-Za-z][\w.-]*\s*\(/i.test(response) ||
    /(?:^|\s)[A-Za-z][\w.-]*\s*\(\s*\{/.test(response);
  const available = getAvailableTools(toolRegistry).map((tool) => tool.name).join(', ');
  return [
    'The corrective planner response is invalid and was rejected before dispatch because it did not contain a parseable JSON tool-selection object.',
    pseudoToolCall
      ? 'It used pseudo-tool syntax such as "Selected tool: Command({...})"; that format is not executable. Do not repeat it.'
      : 'Do not repeat the malformed response.',
    'Try a different permitted tool/action if the previous route is blocked, and return only {"tool":"ToolName","arguments":{...}}.',
    available ? `Available tools: ${available}.` : '',
  ].filter(Boolean).join(' ');
}

function getTargetFileFromState(state: ReactState): string | undefined {
  const nextTarget = nextUninspectedTarget(state);
  if (nextTarget) return nextTarget;

  for (let index = state.steps.length - 1; index >= 0; index--) {
    const step = state.steps[index];
    const filePath = step.action_input?.file_path;
    if (
      (step.action === 'Write' || step.action === 'Edit' || step.action === 'Read') &&
      typeof filePath === 'string' &&
      filePath.trim()
    ) {
      return filePath;
    }
  }

  for (const file of state.taskAnalysis?.affectedFiles || []) {
    if (file.intent !== 'read_only' && file.path && !isConfirmedMissingNonCreateTarget(state, file.path)) {
      return file.path;
    }
  }

  const quotedTarget = state.task.match(/"([^"]+\.(?:html?|css|js|ts|tsx|jsx|json|md))"/i);
  if (quotedTarget?.[1]) {
    return quotedTarget[1];
  }

  const looseTarget = state.task.match(/\b([\w./-]+\.(?:html?|css|js|ts|tsx|jsx|json|md))\b/i);
  return looseTarget?.[1];
}

function buildSafeFallbackAction(
  state: ReactState,
  toolRegistry?: ToolRegistry,
  platform = getNodePlatform(),
): { action: string; action_input: Record<string, unknown> } | null {
  if (requiresWorkspaceRootRecovery(state)) {
    return toolExists('Command', toolRegistry)
      ? {
          action: 'Command',
          action_input: { operation: 'list_directory', args: ['.'], cwd: '.' },
        }
      : null;
  }
  // A forced recovery turn is a hard mutation-only boundary. There is no
  // safe deterministic inspection fallback while the engine requires a write.
  if (state.forceMutationNextAction) return null;

  if (recentSuppressedReadTarget(state) || recentMissingReadTarget(state)) {
    return toolExists('WorkspaceChanges', toolRegistry)
      ? { action: 'WorkspaceChanges', action_input: {} }
      : toolExists('Command', toolRegistry)
        ? { action: 'Command', action_input: { operation: 'list_directory', args: ['.'], cwd: '.' } }
        : null;
  }

  const targetFile = getTargetFileFromState(state);
  const targetAlreadyRead = Boolean(targetFile && state.steps.some((step) =>
    step.action === 'Read' &&
    step.action_input?.file_path === targetFile &&
    isSuccessfulObservation(step)
  ));
  if (targetFile && !targetAlreadyRead && toolExists('Read', toolRegistry)) {
    return {
      action: 'Read',
      action_input: { file_path: targetFile },
    };
  }

  if (toolExists('Bash', toolRegistry)) {
    return {
      action: 'Bash',
      action_input: {
        command: platform === 'win32' ? 'cmd /c dir' : 'ls -la',
        cwd: state.workspace,
        timeout: 30000,
      },
    };
  }

  return null;
}

function forcedMutationSelectionError(selectedTool?: string): string {
  const detail = selectedTool
    ? `selected tool "${selectedTool}" is not allowed`
    : 'the corrective response did not select a tool';
  return `The engine is forcing implementation after a repeated loop; ${detail}. Choose Write or Edit now.`;
}

/**
 * Create a visible high-level plan before the action loop starts.
 */
export async function createExecutionPlan(
  state: ReactState,
  llm: LLMProvider,
  config: PlannerConfig
): Promise<PlanItem[]> {
  const thinking = getThinkingProfile(config.thinkingDepth);
  const appContract = formatAppContractContext(state);
  const taskAnalysisContext = formatTaskAnalysisContext(state);
  const systemPrompt = `You are a senior coding agent creating a concise execution plan.
Create an observable checklist, not hidden chain-of-thought.

Rules:
1. Return ONLY a JSON array.
2. Each item must be an object: {"step": "short concrete step", "status": "pending"}.
3. Choose as many or as few milestones as the task actually needs; do not force a fixed count.
4. The first milestone should usually inspect or understand the workspace.
5. Include verification before claiming completion.
6. For deeper tasks, include integration and risk-reduction milestones when useful.
7. If an app-building contract is provided, include implementation and verification for that contract.
8. Treat the checklist as adaptive working memory: revise it as evidence changes, and do not stop merely because one milestone is complete or because more milestones remain.`;

  const userPrompt = `Task: ${getPlannerTaskText(state)}

Workspace: ${state.workspace}
${appContract}
${taskAnalysisContext}

Create the execution plan.`;

  const response = await llm.createChatCompletion(
    preparePlannerMessages(config, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]),
    config.plannerModel || config.model,
    {
      temperature: 0.2,
      maxTokens: thinking.planTokens,
      reasoning: getNativeReasoningOptions(config.thinkingDepth, 'plan'),
      signal: config.signal,
      timeoutMs: config.requestTimeoutMs,
      requestKind: config.requestKind || 'plan.create',
      stepId: config.stepId,
      onTelemetry: config.onLlmTelemetry,
      onCompletionResult: onCompletionResult(config),
      onStreamEvent: config.onStreamEvent,
      disableLocalThinking: true,
    }
  );

  const fallbackPlan: PlanItem[] = [
    { step: 'Work autonomously from workspace evidence until the task is implemented and verified', status: 'pending' },
  ];

  const jsonStr = extractJsonArrayFromText(response);
  if (!jsonStr) {
    return fallbackPlan;
  }

  const parseResult = parseJsonString<Array<{ step?: unknown; status?: unknown }>>(jsonStr);
  if (!parseResult.success || !Array.isArray(parseResult.data)) {
    return fallbackPlan;
  }

  const plan = parseResult.data
    .map((item) => ({
      step: typeof item.step === 'string' ? item.step.trim() : '',
      status: 'pending' as const,
    }))
    .filter((item) => item.step.length > 0)
    .slice(0, 6);

  return plan.length > 0
    ? plan
    : fallbackPlan;
}

/**
 * Generate reasoning/thought for current state
 */
export async function reason(
  state: ReactState,
  llm: LLMProvider,
  config: PlannerConfig,
  toolRegistry?: ToolRegistry
): Promise<string> {
  if (config.skipSeparateReasoning) {
    return 'Use the current task evidence and select the next concrete tool action.';
  }
  const thinking = getThinkingProfile(config.thinkingDepth);
  const providerName = llm.getProviderName().trim().toLowerCase();
  const plannerModel = config.plannerModel || config.model;
  const budgets = config.contextBudgets || (state.subtaskDispatch
    ? SUBTASK_COORDINATOR_CONTEXT_BUDGETS
    : resolveContextBudgets({ provider: providerName, model: plannerModel }));
  const context = buildBoundedPlannerContext(state, config.contextAssembly, budgets);
  const capabilityInstruction = formatModelCapabilityInstruction(
    getModelCapabilityProfile(config.plannerModel || config.model),
  );
  const verificationState = state.codingState === 'verify';
  const systemPrompt = buildStablePlannerSystemPrompt(
    capabilityInstruction,
    toolRegistry,
    verificationState,
    config.platform ?? getNodePlatform(),
  );
  const plannerHistoryMessages = buildAppendOnlyPlannerHistoryMessages(state);
  const userPrompt = `${buildReasoningPhasePrompt(thinking)}${verificationState ? `\n\n${VERIFICATION_STATE_DIRECTIVE}` : ''}`;

  const messages = preparePlannerMessages(config, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildPlannerContextMessage(state, context) },
      ...plannerHistoryMessages,
      { role: 'user', content: userPrompt },
    ]);
  const thought = await llm.createChatCompletion(
    messages,
    config.plannerModel || config.model,
    {
      temperature: thinking.reasonTemperature,
      maxTokens: thinking.reasonTokens,
      reasoning: getNativeReasoningOptions(config.thinkingDepth, 'reason'),
      signal: config.signal,
      timeoutMs: config.requestTimeoutMs,
      requestKind: config.requestKind || 'reason',
      stepId: config.stepId,
      categoryTokens: estimatePlannerCategoryTokens(messages, context, plannerHistoryMessages),
      onTelemetry: config.onLlmTelemetry,
      onCompletionResult: onCompletionResult(config),
      onStreamEvent: config.onStreamEvent,
      disableLocalThinking: true,
      cachePrompt: true,
    }
  );

  const normalized = sanitizeReasoningRationale(normalizeAssistantText(thought)).replace(/\s+/g, ' ').trim().slice(0, 600);
  return normalized || 'Use the current task evidence to choose the next concrete action.';
}

export function sanitizeReasoningRationale(value: string): string {
  return value
    .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, ' ')
    .replace(/<function=[\s\S]*?<\/function>/gi, ' ')
    .replace(/```(?:tool(?:[_-]call)?|function|functions)[^\r\n]*\r?\n[\s\S]*?```/gi, ' ')
    .replace(/```(?:json)?[^\r\n]*\r?\n\s*\{[\s\S]*?(?:"tool_calls?"\s*:|"function_call"\s*:)[\s\S]*?\}\s*```/gi, ' ')
    .replace(/<\/?tool_call\b[^>]*>|<\/?function=[^>]*>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Plan the next action based on reasoning
 */
export async function planAction(
  state: ReactState,
  thought: string,
  llm: LLMProvider,
  config: PlannerConfig,
  toolRegistry?: ToolRegistry
): Promise<{
  action: string;
  action_input: Record<string, unknown>;
  rationale?: string;
  decision?: AgentDecisionMetadata;
}> {
  const platform = config.platform ?? getNodePlatform();
  const currentPlanKind = effectivePlanKind(state);
  const recoveryDirective = latestRecoveryDirective(state);
  const verificationState = !recoveryDirective && (state.codingState === 'verify' || currentPlanKind === 'verify');
  const baselineVerificationReady = requiresSourceMutation(state) &&
    !hasSuccessfulSourceMutation(state) && hasBaselineVerificationEvidence(state);
  const pendingCreatedFileTarget = missingCreatedFileTargets(state)[0];
  if (currentPlanKind === 'verify' && !pendingCreatedFileTarget) {
    state.forceMutationNextAction = false;
    state.forceMutationTarget = undefined;
  }
  if (baselineVerificationReady && state.forceMutationNextAction) {
    state.forceMutationNextAction = false;
    state.forceMutationTarget = undefined;
  }
  const workspaceRootRecovery = requiresWorkspaceRootRecovery(state);
  const workspaceRootRecoveryGuidance = workspaceRootRecoveryInstruction(state);
  const suppressedReadTarget = recentSuppressedReadTarget(state);
  const recentMissingTarget = recentMissingReadTarget(state);
  const suppressedReadGuidance = suppressedReadTarget
    ? `HARD REPEATED-READ RECOVERY: ReplayGuard confirmed that the full content of "${suppressedReadTarget}" is retained and unchanged. Do not read that file again this turn; use the retained content or inspect a different unresolved target.`
    : '';
  const missingReadGuidance = recentMissingTarget
    ? `MISSING-FILE RECOVERY: Read of "${recentMissingTarget}" failed because the file does not exist. Do not retry that path. Use the successful workspace listing or other workspace evidence to choose a real target.`
    : '';
  if (workspaceRootRecovery) {
    // The root listing must happen before any stale forced mutation can resume.
    state.forceMutationNextAction = false;
    state.forceMutationTarget = undefined;
    state.forceReadNextAction = false;
  }
  const forceMutationNextAction = state.forceMutationNextAction === true &&
    (currentPlanKind !== 'verify' || Boolean(pendingCreatedFileTarget)) && !baselineVerificationReady;
  const todoProgressGuard = mustAdvanceAfterTodo(state);
  const requiredCreatedFileTarget = forceMutationNextAction ? pendingCreatedFileTarget : undefined;
  const forcedMutationTarget = requiredCreatedFileTarget || state.forceMutationTarget || getMutationRecoveryTarget(state) || getTargetFileFromState(state);
  const emptyWorkspaceInspected = state.taskAnalysis?.expectedChangeIntent === 'create' &&
    hasEmptyWorkspaceInspectionEvidence(state);
  const mustStartEmptyWorkspaceImplementation = Boolean(
    emptyWorkspaceInspected &&
    requiresSourceMutation(state) &&
    canStartEmptyWorkspaceImplementation(state) &&
    (state.noProgressCount || 0) >= 1 &&
    toolExists('Write', toolRegistry)
  );
  const filteredToolCatalog = getToolCatalog(toolRegistry).filter((tool) => {
    if (workspaceRootRecovery) return tool.name === 'Command';
    if (todoProgressGuard && tool.name === 'Todo') return false;
    if (forceMutationNextAction) {
      if (state.forceReadNextAction && tool.name === 'Read') return true;
      return MUTATING_ACTIONS.has(tool.name);
    }
    if (state.forceReadNextAction && state.forceReadTarget) {
      return tool.name === 'Read' || tool.name === 'DocumentRead';
    }
    if (mustStartEmptyWorkspaceImplementation) {
      return tool.name === 'Write' || tool.name === 'AskUserQuestion';
    }
    return true;
  });
  const effectiveToolCatalog = verificationState
    ? prioritizeVerificationTools(filteredToolCatalog)
    : filteredToolCatalog;
  const toolDescriptions = effectiveToolCatalog.length > 0
    ? effectiveToolCatalog.map((tool) => `${tool.name}: ${tool.description}\nSchema: ${JSON.stringify(tool.schema)}`).join('\n')
    : getToolDescriptions(toolRegistry);
  const providerName = llm.getProviderName().trim().toLowerCase();
  const plannerModel = config.plannerModel || config.model;
  const budgets = config.contextBudgets || (state.subtaskDispatch
    ? SUBTASK_COORDINATOR_CONTEXT_BUDGETS
    : resolveContextBudgets({ provider: providerName, model: plannerModel }));
  const context = buildBoundedPlannerContext(state, config.contextAssembly, budgets);
  const staleEditGuidance = staleEditRecoveryGuidance(state);
  if (staleEditGuidance && config.toolEvidenceLedger) {
    const recovery = staleEditRecoveryContext(state);
    if (recovery?.target) {
      config.toolEvidenceLedger.recordStaleEditIntervention(
        { action: 'Edit', action_input: { file_path: recovery.target } },
        recovery.target,
        'recovery_guidance',
        staleEditGuidance
      );
    }
  }
  const recentSteps = state.steps.slice(-3);
  const inspectionStalled = recentSteps.length === 3 &&
    recentSteps.every((step) => !MUTATING_ACTIONS.has(step.action));
  const semanticInspectionBlocked = recentSteps.some((step) =>
    step.action === 'ReplayGuard' && /Semantic inspection loop prevented/i.test(step.observation || '')
  );
  const knownTargetsInspected = hasInspectedAllKnownMutationTargets(state);
  const uninspectedKnownTargets = hasUninspectedKnownMutationTargets(state);
  const latestReadFailure = getLatestReadFailureDetails(state);
  const repeatedMissingReadError = (tool: string, input: Record<string, unknown>): string | undefined => {
    if (tool !== 'Read' || !latestReadFailure?.missingTarget || !latestReadFailure.target) return undefined;
    const requested = input.file_path ?? input.path;
    if (typeof requested !== 'string' || mutationPathKey(state, requested) !== mutationPathKey(state, latestReadFailure.target)) {
      return undefined;
    }
    const recoveryTarget = latestReadFailure.recoveryTarget || latestReadFailure.target;
    return latestReadFailure.canRecoverAsMutation
      ? `The previous Read failed because ${latestReadFailure.target} is absent. Do not retry Read; choose Write for ${recoveryTarget} with allowCreate: true.`
      : `The previous Read failed because ${latestReadFailure.target} is absent. Do not retry this Read; choose a valid affected target or ask for clarification if the path is wrong.`;
  };
  const mustMakeProgress = Boolean(
    currentPlanKind !== 'verify' &&
    (forceMutationNextAction || requiresSourceMutation(state)) &&
    !baselineVerificationReady &&
    !uninspectedKnownTargets &&
    (forceMutationNextAction || canForceKnownTargetMutation(state)) &&
    ((state.noProgressCount || 0) >= FORCE_MUTATION_AFTER_NO_PROGRESS || knownTargetsInspected)
  );
  const readFailureInstruction = latestReadFailure
    ? `LATEST READ FAILURE (must be resolved, not repeated): ${latestReadFailure.target ? `target ${latestReadFailure.target}; ` : ''}cause: ${latestReadFailure.failureText}. Recovery: ${latestReadFailure.guidance}`
    : '';
  const progressInstruction = requiredCreatedFileTarget
    ? `COMPLETION RECOVERY: The explicitly requested new file "${requiredCreatedFileTarget}" has no successful Write/Edit evidence. Choose Write for exactly this file_path now and create the missing deliverable before verification.`
    : state.forceReadNextAction && state.forceReadTarget
    ? `HARNESS RECOVERY: Verification was rejected because required source inspection evidence is missing. Your next action MUST read ${state.forceReadTarget}; do not retry verification until the missing target has been inspected.`
    : forceMutationNextAction
    ? `A repeated clarification or inspection loop was blocked. You MUST choose Write or Edit now using the recorded task details; do not ask another question or inspect again.${forcedMutationTarget ? ` Target file: ${forcedMutationTarget}.` : ' Choose the smallest affected source file from the task analysis.'}`
    : mustStartEmptyWorkspaceImplementation
    ? 'The target workspace has been conclusively inspected and is empty. Discovery is complete. You MUST choose Write now to create the first project source or configuration file; do not choose Read, Glob, Grep, Bash, or Command.'
    : baselineVerificationReady
    ? 'All primary source targets already exist and were confirmed by successful inspection. Run the applicable baseline verification now; do not make a cosmetic edit just to create mutation evidence.'
    : mustMakeProgress
    ? knownTargetsInspected
      ? 'All known relevant source targets have been inspected and the task requires a change. You MUST choose Write or Edit now; do not repeat inspection.'
      : 'Progress limit reached: repeated inspection has not changed any files. You MUST choose Write or Edit now. Do not choose Read, Glob, Grep, Bash, Command, TaskCreate, TaskList, TaskUpdate, or SubAgent.'
    : semanticInspectionBlocked
    ? 'The semantic inspection guard blocked a range already present in memory. Do not retry covered lines by slightly varying offset or limit. Choose Edit/Write now if the evidence is sufficient; otherwise request a genuinely uncovered range or inspect one different unresolved candidate file.'
    : inspectionStalled
    ? 'Progress warning: the last three actions made no file changes. Do not repeat the same probe. If relevant source files have not been inspected, use Glob or Read now. If they have been inspected and the task requires changes, choose Edit or Write now.'
    : '';
  const mutationRecoveryTarget = getMutationRecoveryTarget(state);
  const planInstruction = currentPlanKind
    ? `The agent-owned todo currently describes a ${planKindLabel(currentPlanKind)} item. ${todoProgressGuard ? 'The previous action already updated Todo; choose the next concrete action now.' : 'Use that as guidance and update Todo if the approach needs to change.'}`
    : '';
  const workspaceDiscoveryNeeded = requiresSourceMutation(state) &&
    (!state.taskAnalysis || state.taskAnalysis.affectedFiles.length === 0) &&
    !state.steps.some((step) => step.action === 'WorkspaceChanges' && isSuccessfulObservation(step));
  const workspaceDiscoveryInstruction = workspaceDiscoveryNeeded
    ? 'Candidate files are not resolved yet. Before any Write or Edit, use WorkspaceChanges to find recent workspace updates, then Read the relevant source file. Do not create an implementation-plan artifact unless the user explicitly requested one.'
    : '';

  const stateActionError = (tool: string, input: Record<string, unknown> = {}): string | undefined => {
    if (workspaceRootRecovery) {
      const args = Array.isArray(input.args) ? input.args : [];
      const safeRootListing = tool === 'Command' &&
        String(input.operation || '').toLowerCase() === 'list_directory' &&
        args.length === 1 && args[0] === '.' &&
        (input.cwd === undefined || input.cwd === '.');
      return safeRootListing
        ? undefined
        : `${workspaceRootRecoveryGuidance} The only permitted recovery action is Command with operation "list_directory", args ["."], and cwd ".".`;
    }
    if (state.forceReadNextAction && state.forceReadTarget && (!forceMutationNextAction || !MUTATING_ACTIONS.has(tool))) {
      const requested = input.file_path ?? input.path;
      const targetRead = (tool === 'Read' || tool === 'DocumentRead') &&
        typeof requested === 'string' &&
        mutationPathKey(state, requested) === mutationPathKey(state, state.forceReadTarget);
      return targetRead
        ? undefined
        : `The verification evidence gate requires a successful read of ${state.forceReadTarget} before another verification attempt. Choose Read for that exact workspace target.`;
    }
    if (suppressedReadTarget && tool === 'Read') {
      const requested = input.file_path ?? input.path;
      if (typeof requested === 'string' && mutationPathKey(state, requested) === mutationPathKey(state, suppressedReadTarget)) {
        return `ReplayGuard already confirmed that the full content of "${suppressedReadTarget}" is retained and unchanged. Do not read that path again; use retained content or choose a different unresolved target.`;
      }
    }
    if (recentMissingTarget && tool === 'Read') {
      const requested = input.file_path ?? input.path;
      if (typeof requested === 'string' && mutationPathKey(state, requested) === mutationPathKey(state, recentMissingTarget)) {
        return `The previous Read of "${recentMissingTarget}" failed because the file does not exist. Do not retry that path; choose a target confirmed by workspace evidence.`;
      }
    }

    // A failed mutation can leave the model with a stale preimage. Permit one
    // targeted re-read of that same file so it can refresh the guarded edit
    // context before retrying. The next planner turn records the read, so this
    // exception cannot become an unbounded inspection loop.
    if ((!forceMutationNextAction || state.forceReadNextAction) && isMutationRecoveryInspection(state, tool, input)) return undefined;

    const planError = planActionError(state, tool, input);
    if (planError) return planError;
    if (forceMutationNextAction && !MUTATING_ACTIONS.has(tool)) {
      return `The engine is forcing implementation after a repeated loop; ${tool || 'an empty tool selection'} is not allowed. Choose Write or Edit now${forcedMutationTarget ? ` for ${forcedMutationTarget}` : ''}.`;
    }
    if (requiredCreatedFileTarget) {
      if (tool !== 'Write') {
        return `Completion recovery requires Write for the missing requested file ${requiredCreatedFileTarget}; do not edit another deliverable.`;
      }
      const requestedTarget = input.file_path ?? input.path;
      if (typeof requestedTarget !== 'string' || mutationPathKey(state, requestedTarget) !== mutationPathKey(state, requiredCreatedFileTarget)) {
        return `Completion recovery requires Write with file_path ${requiredCreatedFileTarget}; do not target another file.`;
      }
    }
    if (mustStartEmptyWorkspaceImplementation && tool !== 'Write' && tool !== 'AskUserQuestion') {
      return `Empty workspace discovery is complete; Write is required instead of ${tool || 'an empty tool selection'}.`;
    }
    if (mustMakeProgress && !MUTATING_ACTIONS.has(tool) && tool !== 'AskUserQuestion') {
      return `Repeated inspection is complete; Write or Edit is required instead of ${tool || 'an empty tool selection'}.`;
    }
    return undefined;
  };

  const providerKind = providerKindFromName(llm.getProviderName());
  const localActionBudget = (providerName === 'local' || providerName === 'colab' || isLocalStructuredActionModel(plannerModel))
    ? config.localActionBudget
    : undefined;
  const plannerTokenLimit = getPlannerActionTokenLimit(state);
  const structuredActionClass: LocalStructuredActionClass = forceMutationNextAction || state.forceReadNextAction || state.codingState === 'repair'
    ? 'recovery'
    : state.codingState === 'implement'
      ? 'implementation'
      : 'inspection';
  let maxWriteChunkCharacters = 3_000;
  const capabilityInstruction = formatModelCapabilityInstruction(getModelCapabilityProfile(plannerModel));
  const nativeToolMode = getPlannerNativeToolMode(llm, plannerModel);
  const nativeTools = nativeToolMode
    ? effectiveToolCatalog.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.schema || { type: 'object' },
        },
      }))
    : undefined;
  const recordMalformedResponse = async (
    raw: unknown,
    error: unknown,
    recoverable = true,
    context: Pick<ReturnType<typeof createMalformedProviderResponseAudit>, 'attempt' | 'parsedKeys' | 'recoveryOutcome'> = {}
  ): Promise<void> => {
    if (!config.onMalformedProviderResponse) return;
    const message = error instanceof Error ? error.message : String(error);
    const audit = createMalformedProviderResponseAudit(raw, { errors: [message], recoverable }, providerKind, {
      model: plannerModel,
      ...context,
    });
    try {
      await config.onMalformedProviderResponse(audit);
    } catch {
      // Audit persistence must never mask the planner failure.
    }
  };
  const sharedSystemPrompt = buildStablePlannerSystemPrompt(capabilityInstruction, toolRegistry, verificationState, platform);
  const plannerHistoryMessages = buildAppendOnlyPlannerHistoryMessages(state);
  const reasoningPrompt = buildReasoningPhasePrompt(getThinkingProfile(config.thinkingDepth));
  const unifiedLocalThinking = config.skipSeparateReasoning === true && isLocalStructuredActionModel(plannerModel);
  const buildActionPrompt = (extraInstruction = '') => `PHASE: ACTION
${codingStateDirective(state)}
${unifiedLocalThinking
    ? 'Use native private reasoning as needed, then return the single concrete tool action required by the harness.'
    : `Thought: "${thought}"`}

Select exactly one available tool and provide its arguments as valid JSON matching the schema.
${buildStructuredActionInstruction(providerKind, nativeToolMode)}

HAND CONTRACT:
- You are the decision-maker. The harness is your execution hand: it runs exactly one selected tool, records the result, enforces policy, and reports evidence back to you.
- Use the latest evidence to advance the task. Do not ask the harness to think again, repeat a successful inspection, or restate an observation. Choose the next concrete action, and update Todo or WorkPlan when your approach or planning context changes.
- Treat engine summaries, progress limits, and loop guards as execution feedback. When they require a change of direction, act on that feedback with a useful tool call.
- Dirty files are protected by the engine, but a requested bug fix may target a pre-existing dirty file. Check Git status/diff, read the target, and use a guarded Edit when the dirty file is in the requested scope; do not overwrite unrelated dirty files.
- For a bug fix or repair pass, preserve the existing implementation and prior successful behavior. Inspect the current target and diff, then use the smallest targeted Edit; do not regenerate an existing file merely to recreate context.
- PDF and DOCX files are read-only source evidence. Use DocumentRead to extract them, and never select Write or Edit for those paths; apply implementation changes only to website or application source files.
${forceMutationNextAction ? `\nHARD RECOVERY OVERRIDE: The engine has already recorded enough inspection. The only valid next tool is Write or Edit. Do not return Read, DocumentRead, Glob, Grep, WorkspaceChanges, Bash, Command, Todo, WorkPlan, or AskUserQuestion. Use the recorded target and evidence to make the smallest scoped implementation change now.${forcedMutationTarget ? ` The scoped target is ${forcedMutationTarget}; include it as file_path.` : ''}` : ''}
${workspaceRootRecoveryGuidance ? `\n${workspaceRootRecoveryGuidance}` : ''}
${suppressedReadGuidance ? `\n${suppressedReadGuidance}` : ''}
${missingReadGuidance ? `\n${missingReadGuidance}` : ''}
${recoveryDirective ? `\n${recoveryDirective}` : ''}
${todoProgressGuard ? '\nCONCRETE PROGRESS OVERRIDE: The previous successful action was Todo. Do not select Todo again in this consecutive implementation turn; select the next concrete inspection, mutation, or verification action.' : ''}

CRITICAL RULES FOR JSON:
1. All property names must be in double quotes.
2. NO literal newlines are allowed inside string values. If you need a newline in a string (e.g. bash scripts), use the escaped version: \\n
3. Do NOT use markdown code blocks like \`\`\`json around the response. Just output the raw JSON object.
4. For generated files, prefer Write over Bash. Do not create large files via shell heredocs or inline Python scripts.
5. For Write actions with large, multiline, HTML, CSS, JavaScript, or quote-heavy content, use either small "content" chunks or small "content_base64" chunks. Base64 values must be one single-line UTF-8 encoding.
6. Keep each tool-selection response under 6,000 characters. For larger files, write the first chunk with "append": false, then continue with later Write actions using "append": true. Keep each Write content or content_base64 chunk at or below ${maxWriteChunkCharacters.toLocaleString()} characters so the response completes before the provider deadline.
7. The "tool" value must be one of the available tool names exactly. Never return chat metadata such as "role", "reasoning", or "tool_calls".
8. If a native tool call is emitted, its function/tool name and arguments must still normalize to the same single-action contract.
9. Never echo a previous observation or file contents (for example package.json metadata) as your response. It is not a tool selection; return the next action object instead.
10. You must include a top-level "rationale" string of at most 240 characters. It must briefly explain why this action is the next useful step; do not include private chain-of-thought or scratchpad reasoning.
11. Include bounded decision metadata: "expectedEvidence" (an array of 0-4 concrete observations that would justify the next transition), "preconditions" (0-4 facts that must hold before acting), and "stopCondition" (one concise condition for stopping or changing direction). Include "confidence" from 0 to 1 when useful.
12. When the expected result can be checked deterministically, include at most 4 "evidenceChecks" using typed checks such as file_exists, contains_text, command_passed, files_changed, verification_passed, search_match, package_installed, or workspace_change_detected. Use typed checks only when they directly match the selected tool; otherwise omit them.
13. Use AskUserQuestion only when one material user choice is genuinely required and cannot be inferred from the original task or workspace. Never claim completion while waiting for an answer.

${planInstruction}
${workspaceDiscoveryInstruction}
${readFailureInstruction}
${progressInstruction}
${isCodingStateBudgetExceeded(state) ? 'State budget reached: choose a recovery transition or advance to the next evidence-producing state; do not repeat the same action.' : ''}
${isCodingStateTimeBudgetExceeded(state) ? `State time budget reached (${getCodingStateTimeBudget(state.codingState || 'understand')}ms): choose a recovery transition now.` : ''}

Use relative file paths for Write/Read/Edit and relative cwd values for Bash unless the task explicitly requires an in-workspace absolute path.
If the target workspace is on Windows, avoid Unix-only shell constructs such as << heredocs. Use Write append chunks for large generated files.
On Windows, do not use bash -lc, set -e, /dev/null, test -f, head, ls -la, or shell substitutions such as $(). In cmd.exe, use dir /a for a detailed directory listing and NUL for discarded output; in PowerShell, use Get-ChildItem -Force. Prefer Read, Glob, Grep, and the structured Command tool for inspection.
If checking Git state, prefer a non-failing probe first, such as ${platform === 'win32' ? '`git rev-parse --is-inside-work-tree 2>nul`' : '`git rev-parse --is-inside-work-tree 2>/dev/null`'}. If Git is not initialized, ask the user before running git init.
If a previous Edit reported "Pattern not found" for a docs or checklist file, read the current file content and switch strategy instead of repeating the same pattern.
Tool contract reminders: use Read (not Command) to read file contents. When candidate files are unknown, use WorkspaceChanges before choosing a mutation, then Read the relevant target. Command is only for its listed operations; its "args" value, when present, must always be a JSON array of strings. For example, list the workspace with {"tool":"Command","arguments":{"operation":"list_directory","args":["."]}}.

Available tools:
${toolDescriptions}
${extraInstruction}
${verificationState ? VERIFICATION_STATE_DIRECTIVE : ''}`;

  const buildActionMessages = (extraInstruction = '') => preparePlannerMessages(config, unifiedLocalThinking
    ? [
        { role: 'system', content: sharedSystemPrompt },
        { role: 'user', content: buildPlannerContextMessage(state, context) },
        ...plannerHistoryMessages,
        { role: 'user', content: buildActionPrompt(extraInstruction) },
      ]
    : [
        { role: 'system', content: sharedSystemPrompt },
        { role: 'user', content: buildPlannerContextMessage(state, context) },
        ...plannerHistoryMessages,
        { role: 'user', content: reasoningPrompt },
        { role: 'assistant', content: thought },
        { role: 'user', content: buildActionPrompt(extraInstruction) },
      ]);

  let actionMessages = buildActionMessages();
  let actionBudgetDecision = localActionBudget?.resolve({
    model: plannerModel,
    configuredMaxTokens: plannerTokenLimit,
    promptTokens: estimateMessagesTokens(actionMessages),
    remainingBudgetMs: config.requestTimeoutMs,
    actionClass: structuredActionClass,
  });
  if (actionBudgetDecision) {
    maxWriteChunkCharacters = actionBudgetDecision.writeChunkCharacters;
    actionMessages = buildActionMessages();
    actionBudgetDecision = localActionBudget?.resolve({
      model: plannerModel,
      configuredMaxTokens: plannerTokenLimit,
      promptTokens: estimateMessagesTokens(actionMessages),
      remainingBudgetMs: config.requestTimeoutMs,
      actionClass: structuredActionClass,
    }) || actionBudgetDecision;
    maxWriteChunkCharacters = actionBudgetDecision.writeChunkCharacters;
    actionMessages = buildActionMessages();
  }
  const adaptiveActionTokenLimit = actionBudgetDecision?.maxTokens || plannerTokenLimit;
  const currentCodingState = state.codingState || 'understand';
  const taskPermissions = state.taskAnalysis?.contract?.permissions;
  const permissionConstraints = taskPermissions
    ? [
        `Workspace inspection ${taskPermissions.canInspect ? 'allowed' : 'denied'}.`,
        `Workspace mutation ${taskPermissions.canMutate ? 'allowed' : 'denied'}.`,
        `Command execution ${taskPermissions.canRunCommands ? 'allowed' : 'denied'}.`,
        `Approval policy: ${taskPermissions.approvalPolicy}.`,
      ]
    : ['Runtime capability scope and server policy govern available actions.'];
  const activeGateFailures = Array.from(new Set([
    state.blockedReason,
    getStateEntryGateFailure(state, currentCodingState),
  ].filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))))
    .slice(0, 3)
    .map((value) => redactPolicyText(value).replace(/\s+/g, ' ').slice(0, 300));
  config.onGuidanceSnapshot?.({
    codingState: currentCodingState,
    injectedDirective: codingStateDirective(state).slice(0, 1_200),
    permissionConstraints: permissionConstraints.slice(0, 6),
    activeGateFailures,
    contextBudgetUsed: estimateMessagesTokens(actionMessages),
  });
  if (config.onContextSnapshot) {
    const contextSnapshot = createPlannerContextSnapshot(state, plannerModel, toolRegistry, {
      context,
      budgets,
      systemPrompt: sharedSystemPrompt,
      platform,
      additionalDirectives: [
        workspaceRootRecoveryGuidance,
        suppressedReadGuidance,
        missingReadGuidance,
        forceMutationNextAction
          ? `HARD RECOVERY OVERRIDE: Only Write or Edit is allowed${forcedMutationTarget ? ` for ${forcedMutationTarget}` : ''}.`
          : '',
        todoProgressGuard ? 'The previous action updated Todo; choose the next concrete action.' : '',
        isCodingStateBudgetExceeded(state) ? 'State budget reached; choose a recovery transition or advance.' : '',
        isCodingStateTimeBudgetExceeded(state) ? 'State time budget reached; choose a recovery transition.' : '',
      ],
      availableToolInstructions: toolDescriptions,
    });
    config.onContextSnapshot(Math.max(1, state.current_step + 1), contextSnapshot);
  }
  const requestToolSelection = (extraInstruction = '', maxTokens = plannerTokenLimit) => {
    const messages = extraInstruction ? buildActionMessages(extraInstruction) : actionMessages;
    return llm.createChatCompletion(
      messages,
      plannerModel,
      {
        temperature: 0.2,
        maxTokens: Math.min(maxTokens, plannerTokenLimit, adaptiveActionTokenLimit),
        reasoning: getNativeReasoningOptions(config.thinkingDepth, 'action'),
        signal: config.signal,
        timeoutMs: config.requestTimeoutMs,
        requestKind: config.requestKind || 'step.plan_action',
        stepId: config.stepId,
        categoryTokens: estimatePlannerCategoryTokens(messages, context, plannerHistoryMessages),
        onTelemetry: config.onLlmTelemetry,
        onCompletionResult: onCompletionResult(config),
        onStreamEvent: config.onStreamEvent,
        // The separate reason() turn owns model thinking. Keep the action
        // response focused on the single structured tool selection needed by
        // the executor, especially for local Qwen-compatible servers.
        disableLocalThinking: !unifiedLocalThinking,
        cachePrompt: true,
        structuredActionClass,
        tools: nativeTools,
        toolChoice: nativeToolMode ? 'required' : undefined,
      }
    );
  };

  let response = await requestToolSelection();

  let jsonStr = extractPlannerToolSelectionJson(response);
  if (
    looksLikeTruncatedJson(response) &&
    /^\s*\{\s*["']?(?:tool|action)["']?\s*:/i.test(response) &&
    shouldRetryToolSelectionParse('Invalid JSON in tool selection', response)
  ) {
    response = await requestToolSelection(
      `Your previous Write tool-selection envelope was truncated and rejected without dispatch.\n` +
      `Return one smaller valid JSON object now in exactly this shape: {"tool":"Write","arguments":{"file_path":"...","content_base64":"...","append":false}}.\n` +
      `Base-64 encode only the first small UTF-8 file chunk, at most ${maxWriteChunkCharacters.toLocaleString()} decoded characters.`,
      3000,
    );
    jsonStr = extractPlannerToolSelectionJson(response);
    if (looksLikeTruncatedJson(response)) {
      const fallbackAction = buildSafeFallbackAction(state, toolRegistry, platform);
      if (fallbackAction) return fallbackAction;
    }
  }
  const containsGeneratedSource = shouldRetryToolSelectionParse('Invalid JSON in tool selection', response);
  if (!jsonStr && looksLikeTruncatedJson(response) && !containsGeneratedSource) {
    response = await requestToolSelection(
      `Your previous tool-selection response was truncated because it was too large.
Return a much smaller valid JSON object now.
For a large Write, emit only the next chunk with at most ${maxWriteChunkCharacters.toLocaleString()} characters of content or content_base64.
Use "append": false only for the first file chunk and "append": true for continuation chunks.`,
      4000
    );
    jsonStr = extractPlannerToolSelectionJson(response);
  }

  if (!jsonStr && !looksLikeTruncatedJson(response)) {
    response = await requestToolSelection(
      `Your previous response contained prose instead of a tool-selection object and was rejected without dispatch.
Return ONLY one compact valid JSON object in exactly this shape: {"tool":"ToolName","arguments":{...}}.
Do not explain the situation, report completion, or include markdown. Choose one real available tool and include every required argument.`,
      3000
    );
    jsonStr = extractPlannerToolSelectionJson(response);
  }

  // Extract JSON from response
  if (!jsonStr) {
    if (shouldRetryToolSelectionParse('Invalid JSON in tool selection', response)) {
      response = await requestToolSelection(
        `Your previous response contained generated file/config source instead of a valid Write tool-selection envelope.
Return a much smaller valid JSON object now.
Use this exact shape: {"tool":"Write","arguments":{"file_path":"...","content_base64":"...","append":false}}
For content_base64, encode only the first small UTF-8 chunk of the target file, at most ${maxWriteChunkCharacters.toLocaleString()} decoded characters.
Do not include raw HTML/CSS/JS in "content"; use "content_base64" for source content.
Continue with append=true in later actions.`,
        3000,
      );
      jsonStr = extractPlannerToolSelectionJson(response);
    }
  }

  if (!jsonStr) {
    const truncatedJson = looksLikeTruncatedJson(response);
    const fallbackAction = truncatedJson ? buildSafeFallbackAction(state, toolRegistry, platform) : null;
    if (fallbackAction) {
      return {
        action: fallbackAction.action,
        action_input: fallbackAction.action_input,
      };
    }

    const error = new Error(
      `Error: Could not parse tool selection\n` +
        `Cause: ${truncatedJson ? 'LLM response looked like truncated JSON' : correctiveToolSelectionFeedback(response, toolRegistry)}\n` +
        `Suggested Fix: ${truncatedJson ? 'Use smaller Write chunks with append=true, or reduce generated content in each tool call' : 'Choose another permitted action and return only a compact JSON object in the required tool-selection shape.'}\n` +
        `Context: Response: ${response.substring(0, 200)}`
    );
    await recordMalformedResponse(response, error);
    throw error;
  }

  // Fix common JSON issues
  jsonStr = fixJsonString(jsonStr);

  // §10.12 — Pre-parse CSS/code interception.
  // Some local models emit a raw CSS custom-property block (e.g. `{ --bg: …; }`)
  // or a bare generated-config object instead of the required tool-selection
  // envelope.  `extractJsonFromText` finds the outer `{…}` but `JSON.parse`
  // then fails because CSS variable declarations are not valid JSON property
  const looksLikeProperEnvelope = (() => {
    try {
      const p = JSON.parse(jsonStr);
      return Boolean(p && typeof p === 'object' && !Array.isArray(p) && (p.tool || p.action));
    } catch {
      return false;
    }
  })();

  const looksLikeActionEnvelope = /^\s*\{\s*["']?(?:tool|action)["']?\s*:/i.test(jsonStr);
  if (!looksLikeProperEnvelope && !looksLikeActionEnvelope && shouldRetryToolSelectionParse('Invalid JSON in tool selection', jsonStr)) {
    const cssTarget = forcedMutationTarget || getTargetFileFromState(state);
    if (cssTarget && toolExists('Write', toolRegistry)) {
      // Auto-wrap: the model returned the file content directly.  Treat this
      // as an implicit Write of the raw text so the run can continue.
      await recordMalformedResponse(
        response,
        new Error(
          `Planner returned raw CSS/code instead of a tool-selection envelope; ` +
          `auto-wrapping as Write to "${cssTarget}" to keep the run alive.`
        ),
        true,
        { recoveryOutcome: 'correcting' }
      );
      return {
        action: 'Write',
        action_input: {
          file_path: cssTarget,
          content: response.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim(),
          append: false,
        },
      };
    }

    // No unambiguous target — re-prompt once with an explicit Write-envelope
    // hint so the model can correct itself without aborting.
    await recordMalformedResponse(
      response,
      new Error(
        `Planner returned raw CSS/code instead of a tool-selection envelope; ` +
        `issuing corrective re-prompt (no forced target).`
      ),
      true,
      { recoveryOutcome: 'correcting' }
    );
    response = await requestToolSelection(
      `Your previous response contained raw CSS/code instead of a valid Write tool-selection envelope and was rejected without dispatch.\n` +
      `Return a compact valid JSON object now in exactly this shape:\n` +
      `{"tool":"Write","arguments":{"file_path":"<path>","content_base64":"<base64>","append":false}}\n` +
      `For content_base64, Base-64-encode only the first chunk of the file (at most ${maxWriteChunkCharacters.toLocaleString()} decoded characters).\n` +
      `Do NOT embed raw CSS/HTML/JS in "content". Use "append":true for subsequent chunks.`,
      3000
    );
    jsonStr = extractPlannerToolSelectionJson(response);
    if (!jsonStr) {
      const fallbackAction = buildSafeFallbackAction(state, toolRegistry, platform);
      if (fallbackAction) {
        return { action: fallbackAction.action, action_input: fallbackAction.action_input };
      }
      // Last resort: record and use a safe WorkspaceChanges/Command action rather than throw.
      const safeAction = toolExists('WorkspaceChanges', toolRegistry)
        ? { action: 'WorkspaceChanges', action_input: {} }
        : toolExists('Command', toolRegistry)
          ? { action: 'Command', action_input: { operation: 'list_directory', args: ['.'], cwd: '.' } }
          : null;
      if (safeAction) {
        await recordMalformedResponse(
          response,
          new Error('CSS recovery re-prompt did not yield valid JSON; falling back to safe inspection action.'),
          true
        );
        return safeAction;
      }
      // Absolute last resort — throw with a clear, actionable message.
      const cssRecoveryError = new Error(
        `Error: Could not recover from raw CSS/code tool selection\n` +
        `Cause: Model returned CSS instead of a JSON tool-selection envelope and re-prompt did not yield valid JSON\n` +
        `Suggested Fix: Return {"tool":"Write","arguments":{"file_path":"...","content_base64":"...","append":false}}\n` +
        `Context: Response: ${response.substring(0, 200)}`
      );
      await recordMalformedResponse(response, cssRecoveryError);
      throw cssRecoveryError;
    }
    jsonStr = fixJsonString(jsonStr);
  }

  const parseToolSelectionJson = (rawJson: string): {
    parsed: any;
    selection: { tool: string; arguments: Record<string, unknown> };
  } => {
    const parseResult = parseJsonString<any>(rawJson);
    const repairedParseResult = parseResult.success
      ? parseResult
      : repairToolSelectionJson(rawJson)
          .map((candidate) => parseJsonString<any>(candidate))
          .find((candidate) => candidate.success) || parseResult;

    if (repairedParseResult.success) {
      const parsedSelection = repairedParseResult.data;
      return {
        parsed: parsedSelection,
        selection: normalizeToolSelection(parsedSelection, toolRegistry, platform),
      };
    }

    if (!parseResult.success) {
      const error = new Error(
        `Error: Invalid JSON in tool selection\n` +
          `Cause: ${parseResult.error}\n` +
          `Suggested Fix: Ensure valid JSON format\n` +
          `Context: Parsed: ${truncateString(rawJson, 200)}`
      );
      throw error;
    }

    const parsedSelection = parseResult.data;
    return {
      parsed: parsedSelection,
      selection: normalizeToolSelection(parsedSelection, toolRegistry, platform),
    };
  };

  let parsed: any;
  let selection: { tool: string; arguments: Record<string, unknown> };

  try {
    ({ parsed, selection } = parseToolSelectionJson(jsonStr));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!shouldRetryToolSelectionParse(message, jsonStr) && !isRecoverableStructuredParseFailure(message)) {
      await recordMalformedResponse(response, error, false);
      throw error;
    }

    const writeRecovery = shouldRetryToolSelectionParse(message, jsonStr);
    const localModelRecoveryHint = providerName === 'local' || providerName === 'colab' || isLocalStructuredActionModel(plannerModel)
      ? malformedToolRecoveryHint(response, toolRegistry)
      : '';
    response = await requestToolSelection(
      writeRecovery
        ? `Your previous response contained generated file/config source instead of a valid Write tool-selection envelope, or its content string was too large, truncated, or not escaped correctly.
Return a much smaller valid JSON object now.
Use this exact shape: {"tool":"Write","arguments":{"file_path":"...","content_base64":"...","append":false}}
For content_base64, encode only the first small UTF-8 chunk of the target file, at most ${maxWriteChunkCharacters.toLocaleString()} decoded characters.
Do not include raw HTML/CSS/JS in "content"; use "content_base64" for quote-heavy file content.
Continue with append=true in later actions.`
        : `Your previous tool-selection response was malformed JSON and was rejected without dispatch.
Return one valid compact JSON object now in exactly this shape: {"tool":"ToolName","arguments":{...}}.
Choose a real available tool. On Windows, use a native command such as npm.cmd rather than Unix shell syntax.${localModelRecoveryHint ? ` ${localModelRecoveryHint}` : ''}`,
      3000
    );

    jsonStr = extractPlannerToolSelectionJson(response);
    if (!jsonStr) {
      const fallbackAction = looksLikeTruncatedJson(response)
        ? buildSafeFallbackAction(state, toolRegistry, platform)
        : null;
      if (fallbackAction) {
        return {
          action: fallbackAction.action,
          action_input: fallbackAction.action_input,
        };
      }

      const error = new Error(
        `Error: Could not parse tool selection\n` +
          `Cause: Corrective planner response did not contain valid JSON after malformed Write JSON\n` +
          `Suggested Fix: Return a small {"tool":"Write","arguments":{"file_path":"...","content_base64":"...","append":false}} object\n` +
          `Context: Response: ${response.substring(0, 200)}`
      );
      await recordMalformedResponse(response, error);
      throw error;
    }

    jsonStr = fixJsonString(jsonStr);
    try {
      ({ parsed, selection } = parseToolSelectionJson(jsonStr));
    } catch (secondError) {
      const fallbackAction = buildSafeFallbackAction(state, toolRegistry, platform);
      if (fallbackAction) {
        return {
          action: fallbackAction.action,
          action_input: fallbackAction.action_input,
        };
      }

      if (shouldRetryToolSelectionParse(secondError instanceof Error ? secondError.message : String(secondError), jsonStr)) {
        const target = forcedMutationTarget || getTargetFileFromState(state);
        if (target && toolExists('Write', toolRegistry)) {
          return {
            action: 'Write',
            action_input: {
              file_path: target,
              content: jsonStr,
            },
          };
        }
        if (forceMutationNextAction) {
          // §10.12 — prefer a safe inspection over a hard crash when there
          // is no write target.  A WorkspaceChanges/Command step keeps the
          // run alive; the engine will retry the mutation on the next cycle.
          const safeInspection = toolExists('WorkspaceChanges', toolRegistry)
            ? { action: 'WorkspaceChanges', action_input: {} }
            : toolExists('Command', toolRegistry)
              ? { action: 'Command', action_input: { operation: 'list_directory', args: ['.'], cwd: '.' } }
              : null;
          if (safeInspection) {
            await recordMalformedResponse(
              response,
              new Error('Corrective CSS recovery had no write target; falling back to safe inspection to keep run alive.'),
              true
            );
            return safeInspection;
          }
          const blockerError = new Error('The model could not produce a valid Write or Edit action after repeated malformed responses.');
          await recordMalformedResponse(response, blockerError, false);
          throw blockerError;
        }
      }

      if (forceMutationNextAction) {
        const blockerError = new Error('The model could not produce a valid Write or Edit action after malformed corrective responses.');
        await recordMalformedResponse(response, blockerError, false, { recoveryOutcome: 'failed' });
        throw blockerError;
      }

      const recoveryError = new Error(
        `Error: Could not recover from malformed corrective tool selection\n` +
          `Cause: ${secondError instanceof Error ? secondError.message : String(secondError)}\n` +
          `Suggested Fix: Use a model and serving template that return valid JSON tool selections, then retry the action.\n` +
          `Context: Response: ${response.substring(0, 200)}`
      );
      await recordMalformedResponse(response, recoveryError, false, { recoveryOutcome: 'failed' });
      throw recoveryError;
    }
  }

  for (let correctiveAttempt = 0; !selection.tool && correctiveAttempt < MAX_CORRECTIVE_TOOL_SELECTION_ATTEMPTS; correctiveAttempt++) {
    const parsedKeys = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.keys(parsed)
      : [];
    const responseKind = looksLikeAssistantEnvelope(parsed)
      ? 'a chat message envelope'
      : 'a JSON object that does not select a tool';
    await recordMalformedResponse(
      response,
      new Error(`Planner response was ${responseKind}; parsed keys: ${parsedKeys.join(', ') || '(none)'}.`),
      true,
      { attempt: correctiveAttempt + 1, parsedKeys, recoveryOutcome: 'correcting' }
    );
    response = await requestToolSelection(
      `Your previous response was ${responseKind} with keys "${parsedKeys.join(', ') || '(none)'}" instead of a tool-selection object.
Return ONLY one JSON object in this exact shape: {"tool":"ToolName","arguments":{...}}.
Choose a real available tool now; do not include "role", "reasoning", or "tool_calls".`,
      4000
    );

    jsonStr = extractPlannerToolSelectionJson(response);
    if (!jsonStr) {
      const fallbackAction = looksLikeTruncatedJson(response)
        ? buildSafeFallbackAction(state, toolRegistry, platform)
        : null;
      if (fallbackAction) {
        return {
          action: fallbackAction.action,
          action_input: fallbackAction.action_input,
        };
      }

      const error = new Error(
        `Error: Could not parse tool selection\n` +
          `Cause: ${correctiveToolSelectionFeedback(response, toolRegistry)}\n` +
          `Suggested Fix: Try a different permitted tool/action and return only {"tool":"ToolName","arguments":{...}}\n` +
          `Context: Response: ${response.substring(0, 200)}`
      );
      await recordMalformedResponse(response, error);
      throw error;
    }

    jsonStr = fixJsonString(jsonStr);
    try {
      ({ parsed, selection } = parseToolSelectionJson(jsonStr));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordMalformedResponse(
        response,
        error,
        true,
        { attempt: correctiveAttempt + 1, recoveryOutcome: 'correcting' },
      );
      if (correctiveAttempt + 1 >= MAX_CORRECTIVE_TOOL_SELECTION_ATTEMPTS && forceMutationNextAction) {
        const blockerError = new Error('The model could not produce a valid Write or Edit action after malformed corrective responses.');
        await recordMalformedResponse(response, blockerError, false, { recoveryOutcome: 'failed' });
        throw blockerError;
      }
      if (correctiveAttempt + 1 >= MAX_CORRECTIVE_TOOL_SELECTION_ATTEMPTS) {
        const fallbackAction = buildSafeFallbackAction(state, toolRegistry, platform);
        if (fallbackAction) {
          await recordMalformedResponse(
            response,
            new Error(`Malformed corrective tool selection was rejected: ${message}`),
            true,
            { attempt: correctiveAttempt + 1, recoveryOutcome: 'fallback' },
          );
          return fallbackAction;
        }
      }
      continue;
    }
  }

  selection = normalizeUnavailableToolAlias(selection, toolRegistry, platform);
  let action = selection.tool;

  if (!action) {
    const fallbackAction = buildSafeFallbackAction(state, toolRegistry, platform);
    if (fallbackAction) {
      await recordMalformedResponse(
        response,
        new Error('Planner response did not select a tool after corrective retries; safe fallback selected.'),
        true,
        {
          attempt: MAX_CORRECTIVE_TOOL_SELECTION_ATTEMPTS,
          parsedKeys: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed) : [],
          recoveryOutcome: 'fallback',
        }
      );
      return {
        action: fallbackAction.action,
        action_input: fallbackAction.action_input,
      };
    }

    const available = getAvailableTools(toolRegistry).map((tool) => tool.name).join(', ');
    const error = new Error(
      `Error: Invalid tool selection\n` +
        `Cause: ${forceMutationNextAction
          ? forcedMutationSelectionError()
          : 'Missing tool name in planner response after corrective retries'}\n` +
        `Suggested Fix: Return {"tool":"ToolName","arguments":{...}} using one of: ${available}\n` +
        `Context: Parsed keys: ${Object.keys(parsed || {}).join(', ') || '(none)'}`
    );
    await recordMalformedResponse(response, error, false, {
      attempt: MAX_CORRECTIVE_TOOL_SELECTION_ATTEMPTS,
      parsedKeys: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed) : [],
      recoveryOutcome: 'failed',
    });
    throw error;
  }

  let actionInput = selection.arguments;
  if (!actionInput || typeof actionInput !== 'object' || Array.isArray(actionInput)) {
    throw new Error(
      `Error: Invalid tool arguments\n` +
        `Cause: Tool arguments must be a JSON object\n` +
        `Suggested Fix: Return {"tool":"${action}","arguments":{...}}\n` +
        `Context: Arguments: ${truncateString(JSON.stringify(actionInput), 200)}`
    );
  }

  if (forceMutationNextAction && (action === 'Write' || action === 'Edit') && forcedMutationTarget) {
    if (!actionInput.file_path || typeof actionInput.file_path !== 'string' || !actionInput.file_path.trim()) {
      actionInput.file_path = forcedMutationTarget;
    }
  }

  const availableToolNames = getAvailableTools(toolRegistry).map((tool) => tool.name);
  const getHardSelectionError = (): string | undefined => {
    const failedReadError = repeatedMissingReadError(action, actionInput);
    if (failedReadError) return failedReadError;
    if (!action || !toolExists(action, toolRegistry)) {
      return forceMutationNextAction
        ? forcedMutationSelectionError(action || undefined)
        : `Selected unavailable tool "${action || '(missing)'}".`;
    }
    if (!actionInput || typeof actionInput !== 'object' || Array.isArray(actionInput)) {
      return 'Tool arguments must be an object.';
    }
    if (todoProgressGuard && action === 'Todo') {
      return 'The previous Todo action already updated the checklist; choose the next concrete Read, Write, Edit, or verification action instead of repeating Todo.';
    }
    const toolInput = validateToolInput({ action, action_input: actionInput }, toolRegistry);
    return requiredPlannerToolArgumentError(action, actionInput) ||
      (action === 'Write' ? invalidWritePayloadError(actionInput) : undefined) ||
      validateNormalizedAction({ action, action_input: actionInput }, availableToolNames).join(' ') ||
      (toolInput.valid ? undefined : toolInput.errors.join(' ')) ||
      staleEditReplayError(state, action, actionInput, config.toolEvidenceLedger);
  };
  const getSelectionError = (): string | undefined =>
    getHardSelectionError() || stateActionError(action, actionInput);
  const getPlanSelectionError = (): string | undefined => planActionError(state, action, actionInput);

  let selectionError = getSelectionError();
  const policyFallbackAction = !forceMutationNextAction && selectionError && !getHardSelectionError() && !getPlanSelectionError() && stateActionError(action, actionInput)
    ? { action, action_input: actionInput }
    : undefined;
  for (
    let correctiveAttempt = 0;
    selectionError && correctiveAttempt < MAX_CORRECTIVE_TOOL_SELECTION_ATTEMPTS;
    correctiveAttempt++
  ) {
    await recordMalformedResponse(response, new Error(selectionError));
    const planCorrectionInstruction = currentPlanKind
      ? `The current agent-owned todo item describes ${planKindLabel(currentPlanKind)}. ${todoProgressGuard ? 'Choose a useful concrete action for it; do not use Todo again in this turn.' : 'Choose a useful action for it, or use Todo to revise the checklist.'}`
      : '';
    const activePlanPhaseKind = currentPlanKind;
    const planPhaseInstruction = activePlanPhaseKind && getPlanSelectionError()
      ? activePlanPhaseKind === 'verify'
        ? `The active checklist item requires verification. Use Command {"tool":"Command","arguments":{"operation":"verify"}} or a Bash test/build/lint command. Do not use Write, Edit, or any inspection tool.`
        : activePlanPhaseKind === 'implement'
        ? `The active checklist item requires implementation. Use Write or Edit to mutate the target file. Do not return Read or any inspection tool.`
        : `The active checklist item requires inspection. Use Read, Glob, Grep, or WorkspaceChanges. Do not use Write or Edit.`
      : '';
    const mutationOnlyInstruction = planPhaseInstruction
      ? planPhaseInstruction
      : forceMutationNextAction
      ? `The engine has already exhausted inspection. The only permitted tools for this correction are Write and Edit; use the recorded target and evidence now.${forcedMutationTarget ? ` Target: ${forcedMutationTarget}.` : ''}`
      : mutationRecoveryTarget
      ? `The previous mutation failed. You may use Read exactly once for the same target file (${mutationRecoveryTarget}) to refresh its current contents, then retry the mutation.`
      : mustStartEmptyWorkspaceImplementation
      ? 'The only permitted tool for this correction is Write.'
      : mustMakeProgress
        ? 'The only permitted tools for this correction are Write and Edit. Do not return Read or any inspection tool.'
        : planCorrectionInstruction;
    try {
      const writeContentHint = selectionError && selectionError.includes('Write requires content')
        ? `For Write, file_path AND content (or content_base64) are both required. ` +
          `Example: {"tool":"Write","arguments":{"file_path":"path/to/file","content":"...full file text..."}}.`
        : `For file tools, file_path is required.`;
      response = await requestToolSelection(
        `Your previous ${action || '(missing)'} tool call was rejected before dispatch: ${selectionError}\n` +
        `This rejection is a harness error, not a completed tool action. Do not repeat prose or pseudo-tool syntax such as "Selected tool: Command({...})". If that route is blocked, choose a different permitted action.\n` +
        `${mutationOnlyInstruction}\n` +
        `Return one compact valid tool call with every required argument. ` +
        (forceMutationNextAction
          ? `For Write, use {"tool":"Write","arguments":{"file_path":"${forcedMutationTarget || 'path/to/file'}","content":"..."}}. For Edit, use {"tool":"Edit","arguments":{"file_path":"${forcedMutationTarget || 'path/to/file'}","old_string":"...","new_string":"..."}}. `
          : `For Bash, use {"tool":"Bash","arguments":{"command":"..."}}. ` +
            `For Command, use {"tool":"Command","arguments":{"operation":"list_directory","args":["."]}}. `) +
        writeContentHint,
        3000
      );
    } catch (correctionError) {
      if (policyFallbackAction) {
        return policyFallbackAction;
      }
      throw correctionError;
    }
    jsonStr = extractPlannerToolSelectionJson(response);
    if (!jsonStr) {
      if (looksLikeTruncatedJson(response)) {
        const fallbackAction = buildSafeFallbackAction(state, toolRegistry, platform);
        if (fallbackAction) {
          await recordMalformedResponse(
            response,
            new Error('Corrective tool response did not contain valid JSON.'),
            true,
            { recoveryOutcome: 'fallback' },
          );
          return fallbackAction;
        }
      }
      if (policyFallbackAction) {
        await recordMalformedResponse(
          response,
          new Error('Corrective tool response did not contain valid JSON.'),
          true,
          { recoveryOutcome: 'fallback' },
        );
        return policyFallbackAction;
      }
      selectionError = correctiveToolSelectionFeedback(response, toolRegistry);
      continue;
    }
    jsonStr = fixJsonString(jsonStr);
    try {
      ({ parsed, selection } = parseToolSelectionJson(jsonStr));
      selection = normalizeUnavailableToolAlias(selection, toolRegistry, platform);
      action = selection.tool;
      actionInput = selection.arguments;
      selectionError = getSelectionError();
    } catch (error) {
      const parseError = error instanceof Error ? error.message : String(error);
      selectionError = shouldRetryToolSelectionParse(parseError, jsonStr)
        ? 'The model returned generated source instead of a tool selection. Return a compact Write tool call now using content_base64 for file content.'
        : parseError;
    }
  }

  // No-progress policy remains recoverable guidance. A typed item can still
  // provide a useful fallback, but the agent-owned Todo is never a mandatory
  // harness-generated phase boundary.
  const finalPlanSelectionError = getPlanSelectionError();
  const kind = currentPlanKind;
  if (selectionError && finalPlanSelectionError) {
    if (kind === 'implement' && !forceMutationNextAction && !getHardSelectionError()) {
      const recoveryAction = buildFailedMutationRecoveryRead(state, toolRegistry);
      if (recoveryAction) {
        await recordMalformedResponse(response, new Error(finalPlanSelectionError), true, {
          recoveryOutcome: 'fallback',
        });
        return recoveryAction;
      }
    }
    if (kind === 'inspect' && !forceMutationNextAction && !getHardSelectionError()) {
      const fallbackAction = buildSafeFallbackAction(state, toolRegistry, platform);
      if (fallbackAction) {
        await recordMalformedResponse(response, new Error(finalPlanSelectionError), true, {
          recoveryOutcome: 'fallback',
        });
        return fallbackAction;
      }
    }
    if (kind === 'verify') {
      if (toolExists('Command', toolRegistry)) {
        await recordMalformedResponse(response, new Error(finalPlanSelectionError), true, {
          recoveryOutcome: 'fallback',
        });
        return { action: 'Command', action_input: { operation: 'verify' } };
      }
      if (toolExists('Bash', toolRegistry)) {
        await recordMalformedResponse(response, new Error(finalPlanSelectionError), true, {
          recoveryOutcome: 'fallback',
        });
        const testCmd = platform === 'win32' ? 'npm.cmd test' : 'npm test';
        return { action: 'Bash', action_input: { command: testCmd, cwd: state.workspace, timeout: 120000 } };
      }
    }
  }
  if (!forceMutationNextAction && selectionError && !getHardSelectionError() && !finalPlanSelectionError && stateActionError(action, actionInput)) {
    await recordMalformedResponse(response, new Error(selectionError));
    selectionError = undefined;
  }

  if (selectionError) {
    if (kind === 'verify') {
      if (toolExists('Command', toolRegistry)) {
        await recordMalformedResponse(response, new Error(selectionError), true, {
          recoveryOutcome: 'fallback',
        });
        return { action: 'Command', action_input: { operation: 'verify' } };
      }
      if (toolExists('Bash', toolRegistry)) {
        await recordMalformedResponse(response, new Error(selectionError), true, {
          recoveryOutcome: 'fallback',
        });
        const testCmd = platform === 'win32' ? 'npm.cmd test' : 'npm test';
        return { action: 'Bash', action_input: { command: testCmd, cwd: state.workspace, timeout: 120000 } };
      }
    }

    const generatedSourceCorrectionExhausted = /generated source instead of a tool selection/i.test(selectionError);
    if (generatedSourceCorrectionExhausted && !forceMutationNextAction) {
      const fallbackAction = buildSafeFallbackAction(state, toolRegistry, platform);
      if (fallbackAction) {
        await recordMalformedResponse(
          response,
          new Error(selectionError),
          true,
          { recoveryOutcome: 'fallback' },
        );
        return fallbackAction;
      }
    }

    const error = generatedSourceCorrectionExhausted && forceMutationNextAction
      ? new Error('The model could not produce a valid Write or Edit action after repeated malformed responses.')
      : new Error(`Invalid corrective tool selection: ${selectionError}`);
    await recordMalformedResponse(response, error, false);
    throw error;
  }

  const rationaleValue = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (typeof parsed.rationale === 'string' ? parsed.rationale : typeof parsed.reason === 'string' ? parsed.reason : '')
    : '';
  const rationale = rationaleValue.replace(/\s+/g, ' ').trim().slice(0, 240);
  const decision = plannerDecisionMetadata(parsed);

  return {
    action,
    action_input: actionInput,
    ...(rationale ? { rationale } : {}),
    ...(decision ? { decision } : {}),
  };
}

/**
 * Check if task is complete
 */
export async function checkIfDone(
  state: ReactState,
  llm: LLMProvider,
  config: PlannerConfig
): Promise<boolean> {
  if ((state.taskAnalysis?.approvalPolicy || 'ask') === 'ask' && needsUserConfirmation(state)) {
    return true;
  }

  if (hasCompletionEvidence(state)) {
    return true;
  }

  // Coder runs have deterministic inspection, mutation, verification, and
  // review gates. Asking the model for a second completion opinion after each
  // tool adds latency without adding evidence.
  if (state.taskAnalysis) return false;

  // Never let the model judge a feature complete when the only mutation was
  // checking boxes in a tracker. This is a hard evidence gate, not a prompt.
  if (requiresImplementationEvidence(state) && !hasMutationEvidence(state)) {
    return false;
  }

  const thinking = getThinkingProfile(config.thinkingDepth);
  const history = buildStepHistory(state.steps);
  const appContract = formatAppContractContext(state);
  const taskAnalysisContext = formatTaskAnalysisContext(state);

  const systemPrompt = `You are evaluating whether a task has been completed successfully.
Be conservative: answer YES only when the original task is satisfied and any necessary verification has been done.
If the latest thought says more implementation or an edit is needed, but the latest action only read, listed, searched, or inspected files, answer NO.
If the task is to create or repair runnable code, answer YES only when the relevant file was written/edited and at least one appropriate verification signal is present.
If coder task analysis includes validation requirements, answer YES only when those requirements have been satisfied or a validation command clearly could not run and that limitation is documented.
If an app-building contract is present, answer YES only when the required features, output mode, entry point, and verification checks have been addressed.
Respond with ONLY "YES" if the task is done, or "NO" if more work is needed.`;

  const userPrompt = `Task: ${getPlannerTaskText(state)}
${appContract}
${taskAnalysisContext}

Work completed:
${history}

Is the task complete? Respond with only YES or NO.`;

  let response: string;
  try {
    response = await llm.createChatCompletion(
      preparePlannerMessages(config, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]),
      config.plannerModel || config.model,
      {
        temperature: 0.0,
        maxTokens: thinking.doneTokens,
        signal: config.signal,
        timeoutMs: config.requestTimeoutMs,
        requestKind: config.requestKind || 'step.check_done',
        stepId: config.stepId,
        onTelemetry: config.onLlmTelemetry,
        disableLocalThinking: true,
      }
    );
  } catch (error) {
    if (config.signal?.aborted) throw error;
    // Completion classification is advisory. Provider exhaustion must not
    // terminate otherwise productive work; continue until deterministic
    // evidence gates or the normal step/budget limit stop the run.
    return false;
  }

  return response.trim().toLowerCase().startsWith('yes');
}

export type SynthesisTaskType = 'read_only' | 'refactor' | 'code_change';

/**
 * Classify whether the task is read-only (Q&A / investigation), a multi-file refactor, or a code change.
 * Used to tailor the synthesis prompt and temperature.
 */
export function classifyTaskType(state: Pick<ReactState, 'taskAnalysis' | 'task' | 'steps'>): SynthesisTaskType {
  const intent = state.taskAnalysis?.expectedChangeIntent;
  const kind = state.taskAnalysis?.taskKind;

  if (intent === 'read_only' || kind === 'question' || kind === 'investigation') {
    return 'read_only';
  }
  if (kind === 'refactor') {
    return 'refactor';
  }
  if (!state.taskAnalysis && /^(what|why|how|where|when|who|which|can you explain|explain|check|is there|are there)\b/i.test(state.task?.trim() || '')) {
    return 'read_only';
  }
  const mutatedFiles = getMutatedFiles(state.steps || []);
  if (mutatedFiles.length >= 3) {
    return 'refactor';
  }
  return 'code_change';
}

/**
 * Extract unique file paths that were successfully mutated (Write/Edit) during this run.
 */
export function getMutatedFiles(steps: ReactState['steps']): string[] {
  const seen = new Set<string>();
  for (const step of steps) {
    if (step.action !== 'Write' && step.action !== 'Edit') continue;
    // Only count steps that have a successful observation
    try {
      const obs = step.observation ? (JSON.parse(step.observation) as Record<string, unknown>) : null;
      if (obs && (obs.success === false || obs.error !== undefined)) continue;
    } catch {
      // Non-JSON observation — check if it contains failure keywords
      if (/\b(error|failed|failure)\b/i.test(step.observation || '')) continue;
    }
    const raw = step.action_input?.file_path ?? step.action_input?.path ?? step.action_input?.filename ?? step.action_input?.file;
    if (typeof raw === 'string' && raw.trim()) {
      seen.add(raw.replace(/\\/g, '/').replace(/^\.\//, ''));
    }
  }
  return Array.from(seen);
}

/**
 * Synthesize final answer from steps
 */
export async function synthesizeAnswer(
  state: ReactState,
  llm: LLMProvider,
  config: PlannerConfig
): Promise<string> {
  const thinking = getThinkingProfile(config.thinkingDepth);
  const history = buildStepHistory(state.steps);
  const appContract = formatAppContractContext(state);
  const taskType = classifyTaskType(state);
  const mutatedFiles = taskType !== 'read_only' ? getMutatedFiles(state.steps) : [];

  const keyChangesSection =
    taskType === 'read_only'
      ? 'State the direct answer, findings, or information produced directly.'
      : taskType === 'refactor'
        ? 'Detail the structural refactoring changes, reorganized files, and confirm behavioral parity.'
        : 'List the files modified, commands run, or artefacts produced. Reference specific filenames where possible.';

  const systemPrompt = `You are an AI assistant writing the final response for a chat thread.
Write like a concise, helpful coding assistant speaking to the user. For implementation work, organize the response under these headings: "## What was accomplished", "## Key changes / outputs", "## Issues or caveats", and "## Suggested next steps". Keep each section concise; omit caveats or next steps when there is nothing material or useful to report. Explain when each change runs and what behavior it produces. Use inline code for identifiers and fenced text blocks for decision flows when useful. End the response with a short "Result:" grounded in the run evidence. ${keyChangesSection}

For questions or read-only work, lead with the direct answer and then give the relevant findings. Mention caveats only when there are meaningful warnings, partial failures, or limitations. Include suggested next steps only when they are concrete and useful.

Use file paths and line numbers only when present in the supplied work evidence; never guess line numbers. Report verification only when the run evidence shows it was performed. Give the user a concise rationale and outcome, not private chain-of-thought or raw internal reasoning.

If work stopped because user confirmation is required, do not claim the task is complete; instead ask the user the specific confirmation question needed to proceed.`;

  const filesContext = mutatedFiles.length > 0
    ? `\nFiles modified:\n${mutatedFiles.map((f) => `- ${f}`).join('\n')}`
    : '';

  const userPrompt = `Task: ${getPlannerTaskText(state)}
${appContract}${filesContext}

Work completed:
${history}

Write the chat response now.`;

  const answer = await llm.createChatCompletion(
    preparePlannerMessages(config, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]),
    config.model,
    {
      temperature: taskType === 'read_only' ? 0.2 : 0.5,
      maxTokens: thinking.finalTokens,
      reasoning: getNativeReasoningOptions(config.thinkingDepth, 'final'),
      signal: config.signal,
      timeoutMs: config.requestTimeoutMs,
      requestKind: config.requestKind || 'final_answer.synthesize',
      stepId: config.stepId,
      onTelemetry: config.onLlmTelemetry,
      onCompletionResult: onCompletionResult(config),
      onStreamEvent: config.onStreamEvent,
      disableLocalThinking: true,
    }
  );

  return answer;
}
