import type { AgentWorkPlan, ReactStep } from './react-contracts.js';
import type { ReActEngineState } from './react-state.js';
import { isVerificationAction } from './verification-action.js';
import type { PlanItem } from './plan-approval.js';

type PlanState = Pick<ReActEngineState, 'plan'>;

/** Store the plan selected for an Engine run. */
export function setPlan(state: PlanState, plan: PlanItem[]): void {
  state.plan = plan;
}

/** Put the first unfinished checklist item into the active state. */
export function primePlanCursor(plan: PlanItem[]): boolean {
  if (plan.some((item) => item.status === 'in_progress')) return false;
  const next = plan.find((item) => item.status === 'pending');
  if (!next) return false;
  next.status = 'in_progress';
  return true;
}

function stepSucceeded(step: ReactStep): boolean {
  try {
    const parsed = JSON.parse(step.observation || '{}') as {
      success?: unknown;
      status?: unknown;
      skipped?: unknown;
      verificationUnavailable?: unknown;
    };
    const status = String(parsed.status || '').toLowerCase();
    if (['failed', 'error', 'unavailable', 'skipped', 'cancelled', 'canceled', 'timed_out'].includes(status)) {
      return false;
    }
    return parsed.success !== false && parsed.skipped !== true && parsed.verificationUnavailable !== true;
  } catch {
    return !/error|failed|invalid|enoent/i.test(step.observation || '');
  }
}

function isPlanMutationStep(step: ReactStep): boolean {
  if (step.action === 'Write' || step.action === 'Edit' || step.action === 'PackageInstall') return true;
  if (step.action !== 'Bash') return false;
  return /\b(copy-item|new-item|set-content|add-content|out-file|move-item|rename-item|remove-item|del|rm|cp|mv|(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:install|add))\b/i.test(
    String(step.action_input?.command || ''),
  );
}

function isPlanInspectionStep(step: ReactStep): boolean {
  if (isPlanMutationStep(step) || isVerificationAction(step.action, step.action_input)) return false;
  if (['Read', 'DocumentRead', 'Glob', 'Grep', 'WorkspaceChanges', 'Command'].includes(step.action)) return true;
  if (step.action !== 'Bash') return false;
  return /\b(?:cat|type|get-content|select-string|findstr|grep|rg|ls|dir|pwd|git\s+(?:status|diff|log|show))\b/i.test(
    String(step.action_input?.command || ''),
  );
}

function stepSatisfiesPlanItem(item: PlanItem, step: ReactStep): boolean {
  if (!stepSucceeded(step)) return false;
  if (item.kind === 'inspect') return isPlanInspectionStep(step);
  if (item.kind === 'implement') return isPlanMutationStep(step);
  if (item.kind === 'verify') return isVerificationAction(step.action, step.action_input);

  const planText = item.step.toLowerCase();
  const isMutation = isPlanMutationStep(step);
  const isVerification = isVerificationAction(step.action, step.action_input);

  if (/\b(implement|write|edit|modify|create|fix|repair|update|change|mark)\b/.test(planText)) {
    return isMutation;
  }
  if (/\b(verify|test|build|lint|check behavior|validate)\b/.test(planText)) {
    return isVerification;
  }
  if (/\b(inspect|read|find|locate|review|investigate|analy[sz]e)\b/.test(planText)) {
    return ['Read', 'DocumentRead', 'Glob', 'Grep', 'WorkspaceChanges', 'Bash', 'Command'].includes(step.action);
  }
  if (/\b(summarize|report|final answer)\b/.test(planText)) return false;
  return true;
}

/**
 * Mark progress only when the completed action satisfies the active plan item.
 * Control-plane Todo and WorkPlan actions never complete a user plan item.
 */
export function advancePlan(state: PlanState, completedStep?: ReactStep): boolean {
  if (!state.plan.length) return false;
  if (completedStep?.action === 'Todo' || completedStep?.action === 'WorkPlan') return false;

  let changed = false;
  let inProgress = state.plan.find((item) => item.status === 'in_progress');
  if (!inProgress) {
    const next = state.plan.find((item) => item.status === 'pending');
    if (next) {
      next.status = 'in_progress';
      inProgress = next;
      changed = true;
    }
  }
  if (inProgress) {
    if (!completedStep || !stepSatisfiesPlanItem(inProgress, completedStep)) return changed;
    inProgress.status = 'completed';
    changed = true;
  }

  const next = state.plan.find((item) => item.status === 'pending');
  if (next) {
    next.status = 'in_progress';
    changed = true;
  }
  return changed;
}

export function formatPlan(plan: PlanItem[]): string {
  if (!plan.length) return 'No explicit plan yet.';
  return plan
    .map((item, index) => [
      `${index + 1}. [${item.status}]${item.id ? ` (${item.id})` : ''} ${item.step}`,
      item.acceptanceCriteria?.length ? `Acceptance criteria: ${item.acceptanceCriteria.join(' | ')}` : '',
      item.evidenceIds?.length ? `Evidence references: ${item.evidenceIds.join(', ')}` : '',
    ].filter(Boolean).join('\n'))
    .join('\n');
}

export function formatWorkPlan(workPlan?: AgentWorkPlan): string {
  if (!workPlan) return 'No agent-owned workplan yet.';
  const sections = [
    `Status: ${workPlan.status}`,
    `Objective: ${workPlan.objective}`,
    workPlan.strategy ? `Strategy: ${workPlan.strategy}` : '',
    workPlan.scope.length ? `Scope:\n${workPlan.scope.map((item) => `- ${item}`).join('\n')}` : '',
    workPlan.steps.length ? `Steps:\n${workPlan.steps.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
    workPlan.acceptanceCriteria.length ? `Acceptance criteria:\n${workPlan.acceptanceCriteria.map((item) => `- ${item}`).join('\n')}` : '',
    workPlan.verification.length ? `Verification:\n${workPlan.verification.map((item) => `- ${item}`).join('\n')}` : '',
    workPlan.risks.length ? `Risks:\n${workPlan.risks.map((item) => `- ${item}`).join('\n')}` : '',
  ];
  return sections.filter(Boolean).join('\n');
}
