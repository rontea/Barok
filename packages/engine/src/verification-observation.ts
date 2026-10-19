import { verificationCheckForAction } from './verification-action.js';
import type { ReactStep } from './react-contracts.js';
import type { VerificationDecision, VerificationObservation } from './verification-coordinator.js';
import { isSuccessfulToolObservation } from './tool-observation.js';

/** Convert a tool step into evidence for a recognized verification check. */
export function genericVerificationObservation(step: ReactStep, index: number): VerificationObservation | undefined {
  const check = verificationCheckForAction(step.action, step.action_input);
  if (!check) return undefined;
  let status: VerificationObservation['status'] = isSuccessfulToolObservation(step.observation || '') ? 'passed' : 'failed';
  let output = step.observation;
  try {
    const parsed = JSON.parse(step.observation || '{}') as { status?: VerificationObservation['status']; skipped?: boolean; verificationUnavailable?: boolean; output?: unknown; error?: unknown };
    output = typeof parsed.output === 'string' ? parsed.output : typeof parsed.error === 'string' ? parsed.error : '';
    if (parsed.status) status = parsed.status;
    else if (parsed.verificationUnavailable) status = 'unavailable';
    else if (parsed.skipped) status = 'skipped';
    if (status === 'passed' && !output.trim()) status = 'failed';
  } catch { /* legacy Bash observation */ }
  // A successful status without command output is not proof that the check
  // ran. Keep legacy string observations under the same evidence rule as the
  // structured Command result.
  if (status === 'passed' && !String(output || '').trim()) status = 'failed';
  return { id: `verification-step-${index + 1}`, check, status, changedFiles: [], output };
}

export function formatContractVerificationFailure(input: {
  decision: VerificationDecision;
  review: { findings: string[] };
  hasPassedVerificationCommand: boolean;
}): string {
  const findings = input.review.findings
    .filter((finding) => !/^Verification is (?:passed|failed|blocked|incomplete), not passed\.$/i.test(finding));
  let prefix: string;

  if (input.decision.status === 'failed' || input.decision.failures.length > 0) {
    prefix = 'Completion blocked: verification failed.';
  } else if (input.decision.status === 'blocked' || input.decision.unavailable.length > 0) {
    prefix = 'Completion blocked: required verification was unavailable.';
  } else if (input.decision.status === 'incomplete' && input.hasPassedVerificationCommand) {
    prefix = 'Completion blocked: verification command passed, but requested behavior evidence is missing.';
  } else if (input.decision.status === 'incomplete') {
    prefix = 'Completion blocked: verification evidence is incomplete.';
  } else {
    prefix = 'Completion blocked: verification passed, but completion scope review failed.';
  }

  return `${prefix} ${findings.join(' ')}`.trim();
}
