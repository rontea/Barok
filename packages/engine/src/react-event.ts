import type { RequestEnvelope, DurableTodoItem, TodoItemLink, TodoProgressCursor } from '@barok/core';
import type {
  AgentDecisionRecord,
  AgentReasoningPhase,
  AgentReasoningSource,
  AgentReasoningVisibility,
} from './agent-decision.js';
import type {
  CodingState,
  RecoveryEvidence,
  RecoveryReason,
  RecoveryRecord,
} from './coding-state.js';
import type {
  AgentDecisionDetails,
  AgentReasoningContext,
  AgentWorkPlan,
  PendingApprovalRequest,
} from './react-contracts.js';
import type {
  PlanApprovalState,
  PlanItem,
} from './plan-approval.js';
import type { RunTerminalAdviceEvent } from './terminal-run-advice.js';
import type { SharedRunTransition } from './shared-control.js';
import type { ReActEnginePacingProfile } from './react-runtime.js';
import type { EngineSubtaskDispatchResult } from './subtask-dispatcher.js';
import type { HarnessInterventionEvidence, ToolEvidenceRecord } from './tool-contract.js';

export type ReActEngineEvent<
  TaskAnalysisView = unknown,
  UnknownToolOutcome = unknown,
  CapabilityPackName extends string = string,
  CordisEvent = never,
> =
  | { type: 'run_started'; task: string }
  | RunTerminalAdviceEvent
  | { type: 'console_output'; message: string }
  | { type: 'plan_updated'; plan: string | string[] | PlanItem[] }
  | { type: 'todo_snapshot'; revision: number; items: DurableTodoItem[] }
  | { type: 'todo_links_updated'; revision: number; links: TodoItemLink[]; acceptanceCriteria: string[]; progressCursor?: TodoProgressCursor }
  | { type: 'workplan_updated'; workPlan?: AgentWorkPlan }
  | { type: 'task_analysis_ready'; taskAnalysis: TaskAnalysisView }
  | { type: 'agent_guidance_snapshot'; codingState: CodingState; injectedDirective: string; permissionConstraints: string[]; activeGateFailures: string[]; contextBudgetUsed: number; step: number; stepId?: string }
  | { type: 'plan_approval_required'; approval: PlanApprovalState }
  | { type: 'plan_approval_resolved'; approval: PlanApprovalState }
  | { type: 'state_transition'; transition: SharedRunTransition }
  | { type: 'recovery_transition'; reason: RecoveryReason; from: CodingState; to: CodingState; attempt: number; message: string; evidence: RecoveryEvidence; decisionId?: string }
  | { type: 'model_target_resolved'; requestedTarget: string; provider: string; resolvedModel: string; profileId?: string; credentialIndex?: number; targetId?: string; contextWindow?: number; route: 'primary' | 'recovery' | 'fallback'; reason?: string; requestId?: string; stepId?: string }
  | { type: 'reasoning_start'; id: string; provider: string; model: string; step?: number; stepId?: string; phase: AgentReasoningPhase; visibility: AgentReasoningVisibility; source: AgentReasoningSource; context?: AgentReasoningContext }
  | { type: 'reasoning_delta'; id: string; provider: string; model: string; step?: number; stepId?: string; phase: AgentReasoningPhase; source: 'provider' | 'native'; delta: string }
  | { type: 'reasoning_end'; id: string; provider: string; model: string; step?: number; stepId?: string; phase: AgentReasoningPhase; visibility: AgentReasoningVisibility; source: AgentReasoningSource; summary?: string; context?: AgentReasoningContext }
  | { type: 'model_response'; message: string; provider: string; model: string; step?: number; phase: 'planning' | 'final'; requestId?: string; stepId?: string; toolCallId?: string; decision?: AgentDecisionDetails; decisionRecord?: AgentDecisionRecord; context?: AgentReasoningContext }
  | { type: 'decision_record'; record: AgentDecisionRecord }
  | { type: 'model_stream'; provider: string; model: string; eventType: 'text_delta' | 'tool_call_delta' | 'usage'; delta?: string; requestId?: string; stepId?: string; requestKind?: string }
  | { type: 'llm_request_started'; request: RequestEnvelope }
  | { type: 'llm_request_finished'; request: RequestEnvelope }
  | { type: 'llm_request_heartbeat'; requestId: string; requestKind?: string; provider: string; model: string; startedAt: number; elapsedMs: number; deadlineAt?: number; stale: boolean }
  | { type: 'provider_rotation_occurred'; fromProvider: string; toProvider: string; fromModel?: string; toModel?: string; fromProfileId?: string; toProfileId?: string; fromKeyIndex?: number; toKeyIndex?: number; cooldownSeconds: number; reason: string; requestId?: string; stepId?: string }
  | { type: 'provider_attempt_failed'; message: string; recoverable: true; errorCode?: string }
  | { type: 'cooldown_waiting'; delayMs: number; attempt: number; message: string; waitingUntil?: number; provider?: string; model?: string; profileId?: string; providerError?: string }
  | { type: 'nvidia_cooldown_retry'; attempt: number; maxAttempts?: number; pauseMs: number; message: string; waitingUntil?: number; provider?: string; model?: string }
  | { type: 'retrying'; attempt: number; message: string; checkpointStep?: number }
  | { type: 'execution_failed'; message: string; errorCode?: string }
  | { type: 'pacing_wait'; profile: ReActEnginePacingProfile; delayMs: number; message: string; scope?: 'request' | 'fallback' | 'presentation' | 'free_tier_key_cooldown'; provider?: string; model?: string; waitingUntil?: number; attempt?: number; recoverable?: boolean; errorCode?: string }
  | { type: 'tool_started'; tool: string; input?: unknown; requestId?: string; stepId?: string; toolCallId?: string }
  | { type: 'tool_result'; tool: string; result?: unknown; requestId?: string; stepId?: string; toolCallId?: string; evidenceId?: string }
  | { type: 'tool_outcome_unknown'; outcome: UnknownToolOutcome }
  | { type: 'tool_evidence'; record: ToolEvidenceRecord }
  | ({ type: 'harness_intervention'; toolCallId?: string; evidenceId?: string } & HarnessInterventionEvidence)
  | { type: 'capability_scope_created'; scopeId: string; pack: CapabilityPackName; toolCount: number; catalogVersion: number }
  | { type: 'capability_scope_registry_changed'; scopeId: string; reason: string; toolCount: number; catalogVersion: number }
  | { type: 'capability_scope_disposed'; scopeId: string; reason: string; toolCount: number; catalogVersion: number }
  | CordisEvent
  | { type: 'file_read'; path: string }
  | { type: 'file_changed'; path: string; summary?: string; diff?: string; evidenceId?: string }
  | { type: 'command_started'; command: string }
  | { type: 'command_output'; command?: string; output: string }
  | { type: 'package_install_started'; manager: string; packages: string[]; dev: boolean; cwd?: string; command: string }
  | { type: 'package_install_result'; success: boolean; manager: string; requestedPackages: string[]; verifiedPackages: string[]; missingPackages: string[]; cwd?: string; exitCode?: number; output?: string }
  | { type: 'verification_started'; command?: string }
  | { type: 'verification_result'; success: boolean; output?: string }
  | { type: 'user_input_required'; requestId: string; question: string; options: string[]; allowFreeform: boolean; context?: string; createdAt: number }
  | { type: 'user_input_resolved'; requestId: string; cancelled: boolean; selectedOption?: string; hasAnswer: boolean }
  | { type: 'user_message_queued'; messageId: string; message: string; queuedAt: number }
  | { type: 'user_message_processed'; messageId: string; message: string; processedAt: number }
  | { type: 'subtask_dispatch_started'; trigger: 'context_pressure' | 'context_overflow'; model?: string; contextWindow?: number }
  | { type: 'subtask_dispatch_result'; status: string; trigger: 'context_pressure' | 'context_overflow'; childCount: number; reports: unknown[]; blockers: string[] }
  | { type: 'policy_decision'; decision: { allowed: boolean; requiresApproval: boolean; category: string; risk: string; scope: string; reason: string; summary: string; timestamp: number } }
  | { type: 'final'; message: string; filesChanged?: string[]; provider?: string; model?: string }
  | { type: 'stopped'; message: string }
  | { type: 'error'; message: string };
