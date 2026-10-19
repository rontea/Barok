/**
 * Engine-owned control contracts shared by the React loop, transports, and UI.
 * Models may propose actions, but these types and helpers decide whether a run
 * may move forward or become terminal.
 */

export type SharedRunState =
  | 'planning'
  | 'inspecting'
  | 'implementing'
  | 'awaiting_approval'
  | 'awaiting_plan_approval'
  | 'verifying'
  | 'repairing'
  | 'completed'
  | 'failed'
  | 'killed';

export type RunOutcome = 'completed' | 'blocked' | 'failed' | 'cancelled' | 'interrupted' | 'incomplete';

export interface TransitionEvidence {
  source: string;
  references?: string[];
  summary?: string;
}

export interface SharedRunTransition {
  from: SharedRunState;
  to: SharedRunState;
  reason: string;
  evidence: TransitionEvidence[];
  timestamp: number;
}

export interface SharedRunContract {
  requiresMutation: boolean;
  requiresVerification: boolean;
  planApprovalRequired?: boolean;
  planApproved?: boolean;
}

export interface SharedRunGates {
  successfulMutations: number;
  successfulVerifications: number;
  failedVerifications?: number;
  unavailableVerifications?: number;
}

export interface CompletionDecision {
  allowed: boolean;
  outcome: 'completed' | 'incomplete';
  reasons: string[];
}

const VALID_TRANSITIONS: Record<SharedRunState, readonly SharedRunState[]> = {
  planning: ['inspecting', 'implementing', 'awaiting_plan_approval', 'failed', 'killed'],
  inspecting: ['implementing', 'awaiting_approval', 'failed', 'killed'],
  implementing: ['verifying', 'repairing', 'awaiting_approval', 'failed', 'killed'],
  awaiting_approval: ['inspecting', 'implementing', 'failed', 'killed'],
  awaiting_plan_approval: ['planning', 'inspecting', 'implementing', 'failed', 'killed'],
  verifying: ['repairing', 'completed', 'failed', 'killed'],
  repairing: ['inspecting', 'implementing', 'verifying', 'failed', 'killed'],
  completed: [],
  // A recovery-budget checkpoint is resumable: the engine may reopen its
  // saved work in repair state without treating it as a new run contract.
  failed: ['repairing'],
  killed: [],
};

export function canTransition(from: SharedRunState, to: SharedRunState): boolean {
  return from === to || VALID_TRANSITIONS[from].includes(to);
}

export function transitionRun(
  from: SharedRunState,
  to: SharedRunState,
  reason: string,
  evidence: TransitionEvidence[] = [],
  timestamp = Date.now(),
): SharedRunTransition {
  if (!reason.trim()) throw new Error('A state transition requires a machine-readable reason.');
  if (!canTransition(from, to)) throw new Error(`Invalid shared run transition: ${from} -> ${to}`);
  if ((to === 'completed' || to === 'failed' || to === 'killed') && evidence.length === 0) {
    throw new Error(`Terminal transition ${to} requires supporting evidence.`);
  }
  return { from, to, reason: reason.trim(), evidence, timestamp };
}

export function evaluateCompletion(contract: SharedRunContract, gates: SharedRunGates): CompletionDecision {
  const reasons: string[] = [];
  if (contract.planApprovalRequired && !contract.planApproved) reasons.push('plan_approval_pending');
  if (contract.requiresMutation && gates.successfulMutations < 1) reasons.push('missing_mutation_evidence');
  if (contract.requiresVerification && gates.successfulVerifications < 1) reasons.push('missing_verification_evidence');
  if ((gates.failedVerifications || 0) > 0) reasons.push('failed_verification');
  if ((gates.unavailableVerifications || 0) > 0) reasons.push('unavailable_verification');
  return { allowed: reasons.length === 0, outcome: reasons.length === 0 ? 'completed' : 'incomplete', reasons };
}

export type ModelRole = 'implementation' | 'exploration' | 'verification' | 'summarization';

export interface ModelTarget {
  requested: string;
  resolved: string;
  fallback?: string;
  toolCapable: boolean;
  role: ModelRole;
  reason: string;
}

export interface ModelCandidate {
  id: string;
  toolCapable: boolean;
  latencyRank?: number;
}

export function resolveModelTarget(role: ModelRole, requested: string, candidates: ModelCandidate[]): ModelTarget {
  const selected = candidates.find((candidate) => candidate.id === requested);
  const requiresTools = role === 'implementation' || role === 'verification';
  if (!requiresTools || selected?.toolCapable) {
    return { requested, resolved: requested, toolCapable: selected?.toolCapable ?? false, role, reason: 'requested_model_accepted' };
  }
  const fallback = candidates.find((candidate) => candidate.toolCapable);
  if (!fallback) throw new Error(`No tool-capable model is available for the ${role} route.`);
  return {
    requested,
    resolved: fallback.id,
    fallback: fallback.id,
    toolCapable: true,
    role,
    reason: 'requested_model_incompatible_with_route',
  };
}

/** Select a low-latency read-only route only when the task risk allows it. */
export function resolveRoleModel(
  role: ModelRole,
  requested: string,
  candidates: ModelCandidate[],
  risk: 'low' | 'medium' | 'high' = 'medium',
): ModelTarget {
  if (role !== 'exploration' || risk === 'high') return resolveModelTarget(role, requested, candidates);
  const fastest = [...candidates]
    .filter((candidate) => candidate.latencyRank !== undefined)
    .sort((left, right) => (left.latencyRank || 0) - (right.latencyRank || 0))[0];
  if (!fastest || fastest.id === requested) return resolveModelTarget(role, requested, candidates);
  return {
    requested,
    resolved: fastest.id,
    fallback: fastest.id,
    toolCapable: fastest.toolCapable,
    role,
    reason: 'read_only_exploration_latency_route',
  };
}

export interface VerificationContext {
  originalRequest: string;
  changedFiles: string[];
  acceptanceCriteria: string[];
  readOnly: true;
}

export function createVerificationContext(
  originalRequest: string,
  changedFiles: string[],
  acceptanceCriteria: string[],
): VerificationContext {
  return {
    originalRequest: originalRequest.trim(),
    changedFiles: [...new Set(changedFiles.map((file) => file.trim()).filter(Boolean))],
    acceptanceCriteria: [...new Set(acceptanceCriteria.map((criterion) => criterion.trim()).filter(Boolean))],
    readOnly: true,
  };
}

export interface ModelQualityMetrics {
  firstUsefulActionStep?: number;
  successfulMutation: boolean;
  verificationPassRate: number;
  recoveryCount: number;
}

export function calculateModelQualityMetrics(input: {
  firstUsefulActionStep?: number;
  successfulMutation: boolean;
  verificationPassed: number;
  verificationTotal: number;
  recoveryCount: number;
}): ModelQualityMetrics {
  return {
    ...(input.firstUsefulActionStep !== undefined ? { firstUsefulActionStep: input.firstUsefulActionStep } : {}),
    successfulMutation: input.successfulMutation,
    verificationPassRate: input.verificationTotal > 0
      ? Math.max(0, Math.min(1, input.verificationPassed / input.verificationTotal))
      : 0,
    recoveryCount: Math.max(0, Math.floor(input.recoveryCount)),
  };
}

export type ToolTimeoutClass = 'short' | 'standard' | 'long' | 'subagent';
export type ToolExecutionMode = 'parallel' | 'exclusive';

export interface ToolCapabilities {
  readOnly: boolean;
  mutating: boolean;
  destructive: boolean;
  idempotent: boolean;
  parallelSafe: boolean;
  approvalRequired: boolean;
  verificationRelated: boolean;
  timeoutClass: ToolTimeoutClass;
  executionMode: ToolExecutionMode;
}

export function getToolCapabilities(toolName: string, overrides: Partial<ToolCapabilities> = {}): ToolCapabilities {
  // Todo and WorkPlan change only the harness control plane; they never write the
  // workspace and should remain available in read-only/approval modes.
  const readOnly = ['Read', 'DocumentRead', 'Glob', 'Grep', 'WorkspaceChanges', 'Wiki', 'TaskList', 'Todo', 'WorkPlan'].includes(toolName);
  const destructive = ['Bash', 'PackageInstall'].includes(toolName);
  const mutating = !readOnly;
  const verificationRelated = /^(Command|Bash)$/.test(toolName);
  const timeoutClass: ToolTimeoutClass = toolName === 'SubAgent' || toolName === 'WebSearch'
    ? 'subagent'
    : toolName === 'Bash' || toolName === 'PackageInstall'
      ? 'long'
      : toolName === 'Read' || toolName === 'Write' || toolName === 'Edit' || toolName === 'DocumentRead'
        ? 'short'
        : 'standard';
  const defaults: ToolCapabilities = {
    readOnly,
    mutating,
    destructive,
    idempotent: readOnly,
    parallelSafe: readOnly,
    approvalRequired: destructive || ['Write', 'Edit', 'WebSearch', 'ExternalService'].includes(toolName),
    verificationRelated,
    timeoutClass,
    executionMode: readOnly ? 'parallel' : 'exclusive',
  };
  return { ...defaults, ...overrides };
}

export function describeTools<T extends { name: string; capabilities?: ToolCapabilities }>(
  tools: T[],
): Array<T & { capabilities: ToolCapabilities }> {
  return tools.map((tool) => ({ ...tool, capabilities: tool.capabilities || getToolCapabilities(tool.name) }));
}

export interface VerificationVerdict {
  verdict: 'PASS' | 'FAIL' | 'PARTIAL';
  checks: Array<{ command: string; passed: boolean; output: string; available: boolean }>;
  adversarialProbe?: { command: string; passed: boolean; output: string };
  /** Non-trivial work must include an edge-case probe before it can pass. */
  nonTrivial?: boolean;
}

export function isPassingVerification(verdict: VerificationVerdict): boolean {
  return verdict.verdict === 'PASS' && verdict.checks.length > 0 &&
    verdict.checks.every((check) => check.available && check.passed && check.output.trim().length > 0) &&
    (!verdict.nonTrivial || Boolean(verdict.adversarialProbe?.passed && verdict.adversarialProbe.output.trim().length > 0));
}
