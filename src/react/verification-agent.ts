import type { ToolRegistry } from '../di/types.js';
import {
  createVerificationOnlyToolRegistry,
  type ToolAction,
} from './tool-router.js';
import { executeAction } from './executor.js';
import { ToolEvidenceLedger, ToolExecutionScheduler, ToolExecutionState } from './tool-contract.js';
import type { PolicyAuditRecord } from '../tools/permissionPolicy.js';
import {
  createVerificationContext,
  isPassingVerification,
  resolveModelTarget,
  type ModelCandidate,
  type VerificationContext,
  type VerificationVerdict,
} from '@barok/engine';

export interface IndependentVerificationCheck {
  command: string;
  operation?: 'verify' | 'test' | 'build' | 'typecheck' | 'lint';
}

export interface IndependentVerificationRequest {
  originalRequest: string;
  changedFiles: string[];
  acceptanceCriteria: string[];
  checks: IndependentVerificationCheck[];
  adversarialProbe?: IndependentVerificationCheck;
  nonTrivial?: boolean;
  verifierModel?: string;
  candidates?: ModelCandidate[];
  registry?: ToolRegistry;
  signal?: AbortSignal;
}

export interface IndependentVerificationResult extends VerificationVerdict {
  context: VerificationContext;
  verifierModel?: string;
  toolCapable: true;
}

function unavailableCheck(command: string, error: string): { command: string; passed: false; output: string; available: false } {
  return { command, passed: false, output: error, available: false };
}

async function runCheck(
  check: IndependentVerificationCheck,
  registry: ToolRegistry,
  signal?: AbortSignal,
  ledger?: ToolEvidenceLedger,
  scheduler?: ToolExecutionScheduler,
  state?: ToolExecutionState,
  policyAudit?: PolicyAuditRecord[],
): Promise<{ command: string; passed: boolean; output: string; available: boolean }> {
  const command = check.command.trim();
  if (!command) return unavailableCheck(command, 'Verification command was empty.');
  const action: ToolAction = {
    action: 'Command',
    action_input: {
      operation: check.operation || 'verify',
      command,
      args: [],
    },
  };
  const raw = await executeAction(action, registry, signal, {
    policy: { mode: 'scoped_auto_approve' },
    policyAudit,
    toolEvidenceLedger: ledger,
    toolExecutionState: state,
    toolScheduler: scheduler,
  });
  try {
    const parsed = JSON.parse(raw) as { success?: unknown; status?: string; output?: unknown; error?: unknown };
    const output = typeof parsed.output === 'string' ? parsed.output : typeof parsed.error === 'string' ? parsed.error : '';
    const status = typeof parsed.status === 'string' ? parsed.status : parsed.success === false ? 'failed' : 'passed';
    const available = !['unavailable', 'skipped', 'cancelled', 'timed_out', 'unknown'].includes(status);
    return { command, passed: parsed.success === true && ['success', 'passed'].includes(status) && output.trim().length > 0, output, available };
  } catch {
    return { command, passed: false, output: raw, available: false };
  }
}

/**
 * Run checks through a registry that does not contain mutation-capable tools.
 * The verifier returns one verdict and never treats a missing command output as
 * passing evidence.
 */
export async function runIndependentVerification(
  request: IndependentVerificationRequest,
): Promise<IndependentVerificationResult> {
  const context = createVerificationContext(request.originalRequest, request.changedFiles, request.acceptanceCriteria);
  const registry = createVerificationOnlyToolRegistry(request.registry);
  const ledger = new ToolEvidenceLedger();
  const scheduler = new ToolExecutionScheduler();
  const state = new ToolExecutionState();
  const policyAudit: PolicyAuditRecord[] = [];
  const checks = await Promise.all(request.checks.map((check) => runCheck(check, registry, request.signal, ledger, scheduler, state, policyAudit)));
  const adversarial = request.adversarialProbe
    ? await runCheck(request.adversarialProbe, registry, request.signal, ledger, scheduler, state, policyAudit)
    : undefined;
  const hasFailure = checks.some((check) => check.available && !check.passed) || Boolean(adversarial?.available && !adversarial.passed);
  const hasUnavailable = checks.some((check) => !check.available) || Boolean(adversarial && !adversarial.available);
  const verdict: VerificationVerdict['verdict'] = hasFailure
    ? 'FAIL'
    : hasUnavailable || checks.length === 0 || (request.nonTrivial === true && !adversarial)
      ? 'PARTIAL'
      : 'PASS';
  const resolvedModel = request.verifierModel && request.candidates?.length
    ? resolveModelTarget('verification', request.verifierModel, request.candidates).resolved
    : request.verifierModel;
  const result: IndependentVerificationResult = {
    verdict,
    checks,
    ...(adversarial ? { adversarialProbe: adversarial } : {}),
    ...(request.nonTrivial !== undefined ? { nonTrivial: request.nonTrivial } : {}),
    context,
    ...(resolvedModel ? { verifierModel: resolvedModel } : {}),
    toolCapable: true,
  };
  // Keep the predicate as the final invariant for callers that consume the
  // result without inspecting the verdict string.
  if (result.verdict === 'PASS' && !isPassingVerification(result)) result.verdict = 'PARTIAL';
  return result;
}
