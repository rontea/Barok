import { isVerificationAction } from './verification-action.js';

export type RecoveryTransition = 'repair' | 'retry' | 'inspect' | 'summarize' | 'blocked' | undefined;

/** Structural step evidence used to choose the next recovery action. */
export interface RecoveryPolicyStep {
  action: string;
  actionInput?: Record<string, unknown>;
  observation?: string;
  successful: boolean;
}

export function observationRequiresApproval(observation: string): boolean {
  try {
    const parsed = JSON.parse(observation) as { policy?: { requiresApproval?: unknown } };
    if (parsed?.policy?.requiresApproval === true) return true;
  } catch {
    // Legacy observations are inspected as bounded text below.
  }

  return /policy blocked action:[\s\S]{0,500}(?:explicit approval|requires (?:an )?approval)|user confirmation required/i.test(observation);
}

/**
 * Choose a recovery response from one observed action. Hosts determine the
 * step's success from their own evidence rules and pass that decision here.
 */
export function classifyRecoveryTransition(step?: RecoveryPolicyStep): RecoveryTransition {
  if (!step) return undefined;
  const observation = step.observation || '';
  if (/before initializing git|permission denied/i.test(observation) || observationRequiresApproval(observation)) return 'blocked';
  if (/context (?:length|window)|token limit|too many tokens|context saturation/i.test(observation)) return 'summarize';
  if (/stale|expected hash|precondition|pattern not found|file changed since/i.test(observation)) return 'inspect';
  if (step.action === 'Bash' && /\[eval\][\s\S]{0,240}(?:unterminated string constant|invalid or unexpected token)/i.test(observation)) return 'retry';
  if (/malformed|invalid json|could not parse tool|tool selection/i.test(observation)) return 'retry';
  // Custom acceptance commands are not always labelled as a verification
  // operation. A structured MISSING diagnostic still means implementation
  // must be repaired before that check is useful again.
  if (!step.successful && ['Command', 'Bash'].includes(step.action) && /\bMISSING\s*:/i.test(observation)) return 'repair';
  if (!step.successful && (step.action === 'Write' || step.action === 'Edit')) return 'repair';
  if (!step.successful && isVerificationAction(step.action, step.actionInput)) return 'repair';
  return undefined;
}
