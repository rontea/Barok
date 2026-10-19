import React from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Code2,
  Layers,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import { AgentTimeline } from './AgentTimeline';
import { ConflictWarningsPanel } from './ConflictWarningsPanel';
import { DiffSummaryPanel } from './DiffSummaryPanel';
import { FullStackTaskPlanView } from './FullStackTaskPlanView';
import { TaskControlsPanel } from './TaskControlsPanel';
import { VerificationPanel } from './VerificationPanel';
import type { DiffSummary, VerificationResult } from '../App';
import type { OrchestrationTab } from '../utils/orchestrationPreferences';
import type { CoderTaskAnalysisView } from '../../../src/coder/taskAnalysisView';

type TaskExecutionStatus = 'pending' | 'approved' | 'executing' | 'paused' | 'completed' | 'failed';

interface OrchestrationWorkPlan {
  id: string;
  userRequest: string;
  createdAt: number;
  estimatedComplexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'expert';
  classification: 'bug_fix' | 'feature' | 'refactor' | 'test_only' | 'docs_only' | 'infrastructure' | 'generated_app' | 'investigation';
  touchedLayers: string[];
  targetSurfaces: string[];
  affectedFiles: string[];
  fileOwnership: Array<{
    file: string;
    owner: 'frontend' | 'backend' | 'data' | 'test' | 'reviewer' | 'documentation';
    confidence: 'high' | 'medium' | 'low';
    reason: string;
  }>;
  executionStrategy: 'sequential' | 'parallel' | 'mixed';
  canRunParallel: boolean;
  riskFactors: string[];
  safetyScore: number;
  requiresApproval: boolean;
  approvalReason?: string;
}

interface OrchestrationAgentExecution {
  taskId: string;
  agentRole: string;
  status: 'pending' | 'assigned' | 'executing' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'verified' | 'verification-failed';
  progress: number;
  startTime?: number;
  endTime?: number;
  durationMs?: number;
  outputs: {
    changedFiles: string[];
    commandsRun: string[];
    testResults?: Record<string, boolean>;
    errors?: string[];
    warnings?: string[];
  };
  errors: Array<{ message: string; code?: string; timestamp: number; recoverable: boolean }>;
  confidence: number;
  attemptNumber: number;
  verification?: unknown;
}

interface OrchestrationConflict {
  type: 'file-conflict' | 'ownership-conflict' | 'dependency-conflict' | 'dirty-file-conflict';
  severity: 'warning' | 'critical';
  files: string[];
  agents: string[];
  description: string;
}

export interface OrchestrationCenterProps {
  workPlan?: OrchestrationWorkPlan;
  taskAnalysis?: CoderTaskAnalysisView;
  workPlanLoading?: boolean;
  workPlanApproved?: boolean;
  agentExecutions?: OrchestrationAgentExecution[];
  conflicts?: OrchestrationConflict[];
  diffs?: DiffSummary[];
  verificationResult?: VerificationResult;
  taskExecutionStatus: TaskExecutionStatus;
  selectedTab: OrchestrationTab;
  visible: boolean;
  onToggleVisible: () => void;
  onSelectTab: (tab: OrchestrationTab) => void;
  onApprovePlan?: () => void;
  onRejectPlan?: () => void;
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRerun?: () => void;
  onNarrowScope?: (excludedLayers: string[], excludedFiles: string[]) => void;
  onResolveConflict?: (conflictIndex: number, resolution: string) => void;
}

const tabs: Array<{ id: OrchestrationTab; label: string; icon: React.ReactNode }> = [
  { id: 'plan', label: 'Plan', icon: <ClipboardList className="h-3.5 w-3.5" /> },
  { id: 'execution', label: 'Execution', icon: <Activity className="h-3.5 w-3.5" /> },
  { id: 'conflicts', label: 'Conflicts', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  { id: 'diffs', label: 'Diffs', icon: <Code2 className="h-3.5 w-3.5" /> },
  { id: 'verification', label: 'Verification', icon: <ShieldCheck className="h-3.5 w-3.5" /> },
];

const EmptyState: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-xl border border-dashed border-border-main bg-bg-main/30 px-4 py-8 text-center text-xs text-text-dim">
    {children}
  </div>
);

const formatStatus = (status: TaskExecutionStatus): string => {
  if (status === 'approved') return 'ready';
  return status;
};

export const OrchestrationCenter: React.FC<OrchestrationCenterProps> = ({
  workPlan,
  taskAnalysis,
  workPlanLoading = false,
  workPlanApproved = false,
  agentExecutions = [],
  conflicts = [],
  diffs = [],
  verificationResult,
  taskExecutionStatus,
  selectedTab,
  visible,
  onToggleVisible,
  onSelectTab,
  onApprovePlan,
  onRejectPlan,
  onStart,
  onPause,
  onResume,
  onRerun,
  onNarrowScope,
  onResolveConflict,
}) => {
  const hasContent = Boolean(workPlan || workPlanLoading || taskAnalysis || agentExecutions.length || conflicts.length || diffs.length || verificationResult);
  if (!hasContent) return null;

  const executingAgents = Array.from(new Set(
    agentExecutions.filter((execution) => execution.status === 'executing').map((execution) => execution.agentRole),
  ));
  const failedAgents = Array.from(new Set(
    agentExecutions.filter((execution) => execution.status === 'failed' || execution.status === 'verification-failed').map((execution) => execution.agentRole),
  ));
  const availableLayers = Array.from(new Set(workPlan?.touchedLayers || []));
  const availableFiles = Array.from(new Set(workPlan?.affectedFiles || []));
  const changedFiles = Array.from(new Set(diffs.flatMap((diff) => diff.filesChanged)));
  const totalLinesAdded = diffs.reduce((total, diff) => total + diff.linesAdded, 0);
  const totalLinesRemoved = diffs.reduce((total, diff) => total + diff.linesRemoved, 0);
  const analysisSections: Array<{ label: string; items: string[] }> = taskAnalysis ? [
    { label: 'Required inspections', items: taskAnalysis.requiredInspections },
    { label: 'Verification plan', items: taskAnalysis.verificationPlan },
    { label: 'Validation requirements', items: taskAnalysis.validationRequirements },
    { label: 'Risk factors', items: taskAnalysis.riskFactors },
  ] : [];

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-indigo-500/30 bg-slate-950/70 shadow-xl" data-testid="orchestration-center">
      <div className="flex flex-wrap items-center gap-3 border-b border-border-main bg-bg-panel/80 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <Workflow className="h-4 w-4 shrink-0 text-indigo-300" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-white">Orchestration center</h2>
            <p className="truncate text-[11px] text-text-dim">
              {workPlan
                ? `Plan ${workPlan.id.slice(0, 8)} · ${workPlan.affectedFiles.length} files in scope`
                : taskAnalysis
                  ? `Inferred analysis · ${taskAnalysis.affectedFiles.length} affected files`
                  : 'Activity from the current coder thread'}
            </p>
          </div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${
          taskExecutionStatus === 'failed'
            ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
            : taskExecutionStatus === 'completed'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : taskExecutionStatus === 'executing'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-200'
        }`}>
          {formatStatus(taskExecutionStatus)}
        </span>
        {conflicts.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] text-amber-200">
            <AlertTriangle className="h-3 w-3" /> {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'}
          </span>
        )}
        {verificationResult?.passed && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] text-emerald-200">
            <CheckCircle2 className="h-3 w-3" /> verified
          </span>
        )}
        <button
          type="button"
          onClick={onToggleVisible}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border-main bg-bg-main px-2.5 py-1.5 text-xs text-text-dim transition-colors hover:border-indigo-400/50 hover:text-white"
          aria-expanded={visible}
          aria-controls="orchestration-center-content"
          data-testid="orchestration-toggle"
        >
          {visible ? 'Collapse' : 'Open'} {visible ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {visible && (
        <div id="orchestration-center-content">
          <div className="flex gap-1 overflow-x-auto border-b border-border-main bg-bg-main/35 px-3 py-2 sm:px-4" role="tablist" aria-label="Orchestration views">
            {tabs.map((tab) => {
              const isActive = selectedTab === tab.id;
              const count = tab.id === 'execution'
                ? agentExecutions.length
                : tab.id === 'conflicts'
                  ? conflicts.length
                  : tab.id === 'diffs'
                    ? diffs.length
                    : 0;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onSelectTab(tab.id)}
                  data-testid={`orchestration-tab-${tab.id}`}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium transition-colors ${
                    isActive ? 'bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-400/30' : 'text-text-dim hover:bg-bg-panel hover:text-white'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                  {count > 0 && <span className="rounded-full bg-bg-panel px-1.5 py-0.5 font-mono text-[10px] text-text-dim">{count}</span>}
                </button>
              );
            })}
          </div>

          <div className="p-3 sm:p-4">
            {selectedTab === 'plan' && (
              <div className="space-y-4">
                {taskAnalysis && (
                  <section className="rounded-xl border border-cyan-500/25 bg-cyan-950/20 p-4" data-testid="task-analysis-view">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">Inferred task analysis</h3>
                      <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-cyan-200">View only</span>
                      <span className="text-[10px] text-text-dim">{taskAnalysis.id.slice(0, 8)}</span>
                    </div>
                    <div className="mb-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-lg bg-bg-main/50 p-2"><span className="block text-[10px] uppercase text-text-dim">Task</span><span className="text-slate-100">{taskAnalysis.taskKind.replace(/_/g, ' ')}</span></div>
                      <div className="rounded-lg bg-bg-main/50 p-2"><span className="block text-[10px] uppercase text-text-dim">Intent</span><span className="text-slate-100">{taskAnalysis.expectedChangeIntent.replace(/_/g, ' ')}</span></div>
                      <div className="rounded-lg bg-bg-main/50 p-2"><span className="block text-[10px] uppercase text-text-dim">Target layer</span><span className="text-slate-100">{taskAnalysis.targetLayer.replace(/_/g, ' ')}</span></div>
                      <div className="rounded-lg bg-bg-main/50 p-2"><span className="block text-[10px] uppercase text-text-dim">Risk</span><span className="text-slate-100">{taskAnalysis.riskLevel} · {taskAnalysis.refactorRisk.replace(/_/g, ' ')}</span></div>
                    </div>
                    {taskAnalysis.rationale && <p className="mb-4 text-xs leading-5 text-slate-300">{taskAnalysis.rationale}</p>}
                    {taskAnalysis.affectedFiles.length > 0 && (
                      <div className="mb-4">
                        <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-dim">Affected files</h4>
                        <ul className="space-y-1.5">
                          {taskAnalysis.affectedFiles.slice(0, 12).map((file) => (
                            <li key={file.path} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-bg-main/40 px-2.5 py-2 text-xs">
                              <span className="min-w-0 break-all font-mono text-slate-200">{file.path}{file.reason ? <span className="block pt-0.5 font-sans text-[10px] text-text-dim">{file.reason}</span> : null}</span>
                              <span className="shrink-0 text-[10px] text-cyan-200">{file.intent.replace(/_/g, ' ')}</span>
                            </li>
                          ))}
                        </ul>
                        {taskAnalysis.affectedFiles.length > 12 && <p className="mt-1 text-[10px] text-text-dim">and {taskAnalysis.affectedFiles.length - 12} more</p>}
                      </div>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      {analysisSections.map(({ label, items }) => {
                        return (
                          <div key={label}>
                            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-dim">{label}</h4>
                            {items.length > 0
                              ? <ul className="list-disc space-y-1 pl-4 text-xs text-slate-300">{items.slice(0, 6).map((item, index) => <li key={`${label}-${index}`}>{item}</li>)}</ul>
                              : <p className="text-xs text-text-dim">None recorded</p>}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}
                {workPlan || workPlanLoading
                  ? <FullStackTaskPlanView workPlan={workPlan} loading={workPlanLoading} approved={workPlanApproved} onApprove={onApprovePlan} onReject={onRejectPlan} />
                  : !taskAnalysis && <EmptyState>No work plan is recorded for this thread.</EmptyState>}
              </div>
            )}

            {selectedTab === 'execution' && (
              <div className="space-y-4">
                {workPlan ? (
                  <TaskControlsPanel
                    status={taskExecutionStatus}
                    onStart={onStart}
                    onPause={onPause}
                    onResume={onResume}
                    onRerun={onRerun}
                    onNarrowScope={onNarrowScope}
                    canStart={workPlanApproved && taskExecutionStatus === 'approved'}
                    canPause={taskExecutionStatus === 'executing'}
                    canResume={taskExecutionStatus === 'paused'}
                    canRerun={taskExecutionStatus === 'failed'}
                    executingAgents={executingAgents}
                    failedAgents={failedAgents}
                    availableLayers={availableLayers}
                    availableFiles={availableFiles}
                  />
                ) : null}
                {agentExecutions.length > 0 ? <AgentTimeline executions={agentExecutions} /> : <EmptyState>No agent execution activity is recorded for this thread.</EmptyState>}
              </div>
            )}

            {selectedTab === 'conflicts' && (
              conflicts.length > 0
                ? <ConflictWarningsPanel conflicts={conflicts} hasConflicts onResolve={onResolveConflict} />
                : <EmptyState>No conflicts are recorded for this thread.</EmptyState>
            )}

            {selectedTab === 'diffs' && (
              diffs.length > 0
                ? <DiffSummaryPanel diffs={diffs} totalFilesChanged={changedFiles.length} totalLinesAdded={totalLinesAdded} totalLinesRemoved={totalLinesRemoved} />
                : <EmptyState>No file changes are recorded for this thread.</EmptyState>
            )}

            {selectedTab === 'verification' && (
              verificationResult
                ? <VerificationPanel verificationResult={verificationResult} />
                : agentExecutions.some((execution) => execution.verification)
                  ? <div className="space-y-3">
                      {agentExecutions.filter((execution) => execution.verification).map((execution) => (
                        <div key={execution.taskId} className="rounded-xl border border-border-main bg-bg-main/40 p-4 text-xs text-text-dim">
                          <div className="mb-2 flex items-center gap-2 font-semibold text-white"><Layers className="h-3.5 w-3.5 text-cyan-300" /> {execution.agentRole} verification</div>
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-slate-300">{JSON.stringify(execution.verification, null, 2)}</pre>
                        </div>
                      ))}
                    </div>
                  : <EmptyState>No verification result is recorded for this thread.</EmptyState>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
