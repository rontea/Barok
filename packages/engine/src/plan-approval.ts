/** Shared plan item used by approval state and Engine run projections. */
export type PlanItemKind = 'inspect' | 'implement' | 'verify';

export interface PlanItem {
  /** Stable id assigned by the agent-owned Todo tool. */
  id?: string;
  step: string;
  status: 'pending' | 'in_progress' | 'completed';
  /** Optional typed evidence gate selected by the agent for a todo item. */
  kind?: PlanItemKind;
  /** Acceptance criteria associated with this item; not completion evidence. */
  acceptanceCriteria?: string[];
  /** Durable evidence references associated with this item. */
  evidenceIds?: string[];
}

/** Minimal structural task-analysis input needed to prepare an approval. */
export interface PlanApprovalAnalysis {
  taskKind?: string;
  expectedChangeIntent?: string;
  approvalPolicy?: string;
  requiredInspections: string[];
  affectedFiles: Array<{ path: string }>;
  verificationPlan: string[];
}

export type PlanApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface PlanApprovalScope {
  files: string[];
  mutationScopes: string[];
  verificationCommands: string[];
}

export interface PlanApprovalState {
  status: PlanApprovalStatus;
  proposedPlan: PlanItem[];
  approvedPlan?: PlanItem[];
  scope: PlanApprovalScope;
  reason: string;
  createdAt: number;
  decidedAt?: number;
  decisionReason?: string;
}

export type PlanApprovalDecision = 'approve' | 'reject' | 'edit' | 'cancel';

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 100);
}

export function shouldRequirePlanApproval(analysis?: PlanApprovalAnalysis): boolean {
  if (!analysis || analysis.approvalPolicy !== 'ask') return false;
  if (analysis.expectedChangeIntent === 'read_only') return false;

  // A continuation is already an explicit user decision to resume the
  // previously approved task. Do not put that confirmation behind a second
  // plan boundary. Every other mutation gets a cheap, durable plan boundary
  // before the first model/tool action so the user can see and edit the TODO
  // outline without spending execution requests.
  return analysis.taskKind !== 'continuation';
}

export function proposedPlanFromAnalysis(analysis: PlanApprovalAnalysis): PlanItem[] {
  const inspectionItems = analysis.requiredInspections.slice(0, 20).map((inspection) => ({
    step: `Inspect ${inspection} — understand the current state and constraints before changing anything.`,
    status: 'pending' as const,
  }));
  const implementation = analysis.expectedChangeIntent === 'read_only'
    ? []
    : [{
        step: 'Implement the requested changes in the approved file scope — keep the edit focused on the user’s goal.',
        status: 'pending' as const,
      }];
  const verification = analysis.verificationPlan.slice(0, 20).map((check) => ({
    step: `Verify with ${check} — confirm the result and catch regressions before reporting completion.`,
    status: 'pending' as const,
  }));
  return [...inspectionItems, ...implementation, ...verification].slice(0, 50);
}

export function createPlanApprovalState(analysis: PlanApprovalAnalysis, now = Date.now()): PlanApprovalState {
  const proposedPlan = proposedPlanFromAnalysis(analysis);
  const files = unique(analysis.affectedFiles.map((file) => file.path));
  return {
    status: 'pending',
    proposedPlan,
    scope: {
      files,
      mutationScopes: files.map((file) => `write:${file}`),
      verificationCommands: unique(analysis.verificationPlan),
    },
    reason: 'This task can change the workspace. Review the TODO outline before any model or tool execution begins.',
    createdAt: now,
  };
}

export function normalizeApprovedPlan(value: unknown, fallback: PlanItem[]): PlanItem[] {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .map((item) => {
      if (typeof item === 'string') return { step: item.trim(), status: 'pending' as const };
      if (!item || typeof item !== 'object') return undefined;
      const step = typeof (item as { step?: unknown }).step === 'string' ? (item as { step: string }).step.trim() : '';
      if (!step) return undefined;
      return { step, status: 'pending' as const };
    })
    .filter((item): item is { step: string; status: 'pending' } => Boolean(item?.step))
    .slice(0, 50);
  return normalized.length ? normalized : fallback;
}

export function resolvePlanApproval(
  current: PlanApprovalState,
  decision: PlanApprovalDecision,
  plan?: unknown,
  reason?: string,
  now = Date.now(),
): PlanApprovalState {
  const selectedPlan = normalizeApprovedPlan(plan, current.proposedPlan);
  if (decision === 'edit') {
    return {
      ...current,
      status: 'pending',
      proposedPlan: selectedPlan,
      decidedAt: undefined,
      decisionReason: reason || 'Plan edited; approval is still required.',
    };
  }
  return {
    ...current,
    status: decision === 'approve' ? 'approved' : decision === 'cancel' ? 'cancelled' : 'rejected',
    ...(decision === 'approve' ? { approvedPlan: selectedPlan } : {}),
    decidedAt: now,
    decisionReason: reason || `Plan ${decision}d by user.`,
  };
}
