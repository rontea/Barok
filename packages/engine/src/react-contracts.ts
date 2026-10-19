import type {
  AgentDecisionCategory,
  AgentDecisionMetadata,
  AgentDecisionRecord,
  AgentEvidenceCheck,
  AgentReasoningSource,
  AgentReasoningVisibility,
} from './agent-decision.js';
import type { AppSpec } from './app-spec.js';
import type { CodingState, RecoveryReason } from './coding-state.js';
import type { VerificationResult } from './app-manifest.js';
import type { RequirementEvidence } from './verification-coordinator.js';
import type { PerformanceTraceSummary } from './performance-trace.js';
import type { PlanApprovalState, PlanItem } from './plan-approval.js';
import type { RunOutcome } from './shared-control.js';

/** One selected tool action and its observed result in a ReAct run. */
export interface ReactStep {
  thought: string;
  action: string;
  action_input: Record<string, unknown>;
  observation?: string;
  is_done?: boolean;
  final_answer?: string;
  pollenCost?: number;
  startTime?: number;
  endTime?: number;
  durationMs?: number;
  decision?: AgentDecisionMetadata;
  decisionRecord?: AgentDecisionRecord;
}

export type AgentWorkPlanStatus = 'draft' | 'active' | 'completed' | 'blocked';
export type ThinkingDepth = 'fast' | 'balanced' | 'deep';

/** Optional strategic context; it does not gate tool selection. */
export interface AgentWorkPlan {
  objective: string;
  scope: string[];
  steps: string[];
  acceptanceCriteria: string[];
  verification: string[];
  risks: string[];
  strategy?: string;
  status: AgentWorkPlanStatus;
  updatedAt: number;
}

/** Safe, user-facing context describing the request a run is addressing. */
export interface AgentReasoningContext {
  userRequest: string;
  latestUserInput?: string;
  loopState: CodingState;
  activePlanItem?: string;
  trigger: 'user_request' | 'user_message' | 'tool_result' | 'recovery' | 'continuation';
  latestEvidence?: string;
}

/** Structured model/tool decision with bounded rationale and evidence fields. */
export interface AgentDecisionDetails {
  tool: string;
  arguments: Record<string, unknown>;
  rationale?: string;
  reasoningSummary?: string;
  planItem?: string;
  codingState?: CodingState;
  decisionCategory?: AgentDecisionCategory;
  summaryOrigin: 'engine' | 'model' | 'provider';
  rationaleOrigin?: 'model';
  expectedEvidence?: string[];
  preconditions?: string[];
  stopCondition?: string;
  confidence?: number;
  planUpdate?: string[];
  evidenceChecks?: AgentEvidenceCheck[];
  decisionId?: string;
  reasoningId?: string;
  reasoningVisibility?: AgentReasoningVisibility;
  reasoningSource?: AgentReasoningSource;
  decisionStatus?: AgentDecisionRecord['status'];
}

export interface PendingApprovalRequest {
  category: string;
  risk: string;
  scope: string;
  summary: string;
  reason: string;
}

/** Run result contract. Hosts may supply their own resumable state type. */
export interface ReactResult<TResumeState = unknown> {
  success: boolean;
  /** The implementation reached its terminal completion path even if verification failed. */
  executionCompleted?: boolean;
  verificationStatus?: 'passed' | 'failed' | 'blocked' | 'incomplete' | 'unavailable';
  finalAnswer?: string;
  result?: string;
  error?: string;
  errorCode?:
    | 'MAX_STEPS_EXCEEDED'
    | 'GLOBAL_STEP_LIMIT_EXCEEDED'
    | 'RUN_WALL_CLOCK_LIMIT_EXCEEDED'
    | 'RECOVERY_BUDGET_EXCEEDED'
    | 'PHASE_COMPLETED'
    | 'BUDGET_EXCEEDED'
    | 'TASK_LLM_REQUEST_BUDGET_REACHED'
    | 'APPROVAL_REQUIRED'
    | 'PLAN_APPROVAL_REQUIRED'
    | 'EXECUTION_ERROR'
    | 'USER_STOPPED';
  recoveryReason?: RecoveryReason;
  approvalRequest?: PendingApprovalRequest;
  planApproval?: PlanApprovalState;
  recoverable?: boolean;
  suggestedNextAction?: string;
  appSpec?: AppSpec;
  appManifestId?: string;
  outputFiles?: string[];
  verificationResult?: VerificationResult;
  requirementEvidence?: RequirementEvidence[];
  reviewFindings?: string[];
  performanceTrace?: PerformanceTraceSummary;
  plan?: PlanItem[];
  workPlan?: AgentWorkPlan;
  steps: ReactStep[];
  stepCount: number;
  pollenCost: number;
  resumeState?: TResumeState;
  outcome?: RunOutcome;
}
