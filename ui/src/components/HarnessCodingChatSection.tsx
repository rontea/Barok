import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  FileText,
  ListChecks,
  Loader2,
  TerminalSquare,
} from 'lucide-react';
import type { AgentStreamEvent, AgentRunStatus } from './CoderChatPanel';

export type HarnessStageId = 'input' | 'planning' | 'tools' | 'review' | 'report';
export type HarnessStageStatus = 'pending' | 'active' | 'complete' | 'blocked';

export interface HarnessStageState {
  id: HarnessStageId;
  label: string;
  description: string;
  status: HarnessStageStatus;
  detail: string;
}

export interface HarnessCodingChatSectionProps {
  task: string;
  events?: AgentStreamEvent[];
  loading?: boolean;
  agentStatus?: AgentRunStatus;
  result?: { success?: boolean; executionCompleted?: boolean; verificationStatus?: string } | null;
}

const stageDefinitions: Array<Pick<HarnessStageState, 'id' | 'label' | 'description'>> = [
  { id: 'input', label: 'Task Input', description: 'The request the agent must satisfy.' },
  { id: 'planning', label: 'Planning', description: 'The model chooses the next useful action.' },
  { id: 'tools', label: 'Tool Execution', description: 'The harness runs one controlled action.' },
  { id: 'review', label: 'Review', description: 'Evidence and verification close the loop.' },
  { id: 'report', label: 'Report', description: 'The run returns a final, auditable result.' },
];

const planningEvents = new Set(['reasoning_start', 'reasoning_delta', 'reasoning_end', 'plan_updated', 'todo_snapshot', 'todo_links_updated', 'model_response']);
const toolEvents = new Set(['tool_started', 'tool_result', 'tool_evidence', 'file_read', 'file_changed', 'command_started', 'command_output', 'package_install_started', 'package_install_result']);
const reviewEvents = new Set(['decision_record', 'verification_started', 'verification_result', 'recovery_transition']);
const terminalEvents = new Set(['final', 'stopped', 'interrupted', 'killed', 'error', 'execution_failed']);

const eventType = (event: AgentStreamEvent): string => event.type;

const hasFailure = (events: AgentStreamEvent[]): boolean => events.some((event) => {
  if (event.type === 'error' || event.type === 'execution_failed' || event.type === 'stopped' || event.type === 'interrupted' || event.type === 'killed') return true;
  if (event.type === 'verification_result') return !event.success;
  if (event.type === 'package_install_result') return !event.success;
  return event.type === 'decision_record' && (event.record.status === 'failed' || event.record.status === 'invalidated');
});

const hasEvent = (events: AgentStreamEvent[], types: Set<string>): boolean => events.some((event) => types.has(eventType(event)));

const isPendingDecision = (event: AgentStreamEvent): boolean => event.type === 'decision_record' && event.record.status === 'pending';

export const deriveHarnessStages = (
  task: string,
  events: AgentStreamEvent[] = [],
  loading = false,
  result?: { success?: boolean; executionCompleted?: boolean; verificationStatus?: string } | null,
): HarnessStageState[] => {
  const safeTask = task.trim();
  const lastEvent = events[events.length - 1];
  const failed = result?.executionCompleted === true
    ? false
    : hasFailure(events) || result?.success === false;
  const planningSeen = hasEvent(events, planningEvents);
  const toolSeen = hasEvent(events, toolEvents);
  const reviewSeen = hasEvent(events, reviewEvents);
  const reportSeen = Boolean(result || hasEvent(events, terminalEvents));
  const lastToolStarted = [...events].reverse().findIndex((event) => event.type === 'tool_started');
  const lastToolResult = [...events].reverse().findIndex((event) => event.type === 'tool_result');
  const toolRunning = lastToolStarted >= 0 && (lastToolResult < 0 || lastToolStarted < lastToolResult);
  const pendingReview = lastEvent ? isPendingDecision(lastEvent) || lastEvent.type === 'verification_started' : false;

  const statuses: Record<HarnessStageId, HarnessStageStatus> = {
    input: safeTask ? 'complete' : 'blocked',
    planning: planningSeen ? 'complete' : loading ? 'active' : 'pending',
    tools: toolRunning ? 'active' : toolSeen ? 'complete' : planningSeen ? 'pending' : 'pending',
    review: pendingReview ? 'active' : reviewSeen ? 'complete' : toolSeen ? 'pending' : 'pending',
    report: reportSeen ? (failed ? 'blocked' : 'complete') : loading && reviewSeen ? 'active' : 'pending',
  };

  if (failed && !reportSeen) statuses.report = 'blocked';

  const details: Record<HarnessStageId, string> = {
    input: safeTask ? 'Request captured' : 'Waiting for a coding request',
    planning: planningSeen ? 'Decision and plan activity recorded' : loading ? 'Waiting for the model decision' : 'Not started',
    tools: toolRunning ? 'A tool is currently running' : toolSeen ? 'Tool results recorded' : 'Waiting for the first action',
    review: pendingReview ? 'Checking the latest evidence' : reviewSeen ? 'Evidence review recorded' : 'Waiting for tool evidence',
    report: reportSeen ? (failed ? 'Run ended with attention required' : 'Final result recorded') : loading ? 'Waiting for completion evidence' : 'Not finished',
  };

  return stageDefinitions.map((stage) => ({
    ...stage,
    status: statuses[stage.id],
    detail: details[stage.id],
  }));
};

const stageIcon = (stage: HarnessStageState, size = 'h-3.5 w-3.5') => {
  if (stage.status === 'blocked') return <AlertCircle className={`${size} text-rose-400`} />;
  if (stage.status === 'active') return <Loader2 className={`${size} animate-spin text-cyan-300`} />;
  if (stage.status === 'complete') return <CheckCircle2 className={`${size} text-emerald-400`} />;
  if (stage.id === 'input') return <FileText className={`${size} text-neutral-500`} />;
  if (stage.id === 'planning') return <ClipboardList className={`${size} text-neutral-500`} />;
  if (stage.id === 'tools') return <TerminalSquare className={`${size} text-neutral-500`} />;
  return <ListChecks className={`${size} text-neutral-500`} />;
};

const stageClasses = (status: HarnessStageStatus): string => {
  if (status === 'blocked') return 'border-rose-500/35 bg-rose-950/20';
  if (status === 'active') return 'border-cyan-400/45 bg-cyan-950/25 shadow-[0_0_18px_rgba(34,211,238,0.08)]';
  if (status === 'complete') return 'border-emerald-500/25 bg-emerald-950/15';
  return 'border-neutral-800 bg-neutral-950/40';
};

export const HarnessCodingChatSection: React.FC<HarnessCodingChatSectionProps> = ({
  task,
  events = [],
  loading = false,
  agentStatus,
  result,
}) => {
  const stages = deriveHarnessStages(task, events, loading, result);
  const currentStage = stages.find((stage) => stage.status === 'active') ||
    [...stages].reverse().find((stage) => stage.status === 'complete') || stages[0];
  const toolCalls = events.filter((event) => event.type === 'tool_started').length;
  const verificationChecks = events.filter((event) => event.type === 'verification_result').length;
  const failureCount = events.filter((event) => event.type === 'error' || event.type === 'execution_failed').length;

  return (
    <section
      data-testid="harness-coding-chat"
      className="mb-4 rounded-xl border border-cyan-500/20 bg-[#0b1119] p-3 shadow-[0_10px_30px_rgba(0,0,0,0.18)]"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300">
            <TerminalSquare className="h-3.5 w-3.5" />
            <span>Coding Harness</span>
          </div>
          <p className="mt-1 text-[11px] text-neutral-400">One visible loop: request, decision, action, evidence, report.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[9px] text-neutral-400">
          <span className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1">{events.length} trace events</span>
          <span className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1">{toolCalls} tool calls</span>
          <span className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1">{verificationChecks} checks</span>
          {failureCount > 0 && <span className="rounded border border-rose-500/30 bg-rose-950/20 px-2 py-1 text-rose-300">{failureCount} failures</span>}
        </div>
      </div>

      <div className="mb-3 rounded-lg border border-neutral-800/80 bg-[#070a10] px-3 py-2">
        <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-neutral-500">Task input</div>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-200">{task.trim() || 'Waiting for a coding request.'}</p>
      </div>

      <div className="flex flex-wrap items-stretch gap-1.5">
        {stages.map((stage, index) => (
          <React.Fragment key={stage.id}>
            <div className={`min-w-[145px] flex-1 rounded-lg border px-2.5 py-2 transition ${stageClasses(stage.status)}`} title={stage.description}>
              <div className="flex items-center gap-1.5">
                {stageIcon(stage)}
                <span className="truncate font-mono text-[10px] font-bold text-slate-200">{stage.label}</span>
              </div>
              <div className="mt-1 truncate text-[9px] text-neutral-400">{stage.detail}</div>
            </div>
            {index < stages.length - 1 && <div className="hidden items-center justify-center px-0.5 text-neutral-700 md:flex">→</div>}
          </React.Fragment>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-neutral-800/80 pt-2 font-mono text-[9px] text-neutral-500">
        <span className="text-cyan-300">Current: {currentStage.label}</span>
        {agentStatus && <span>Status: {agentStatus}</span>}
        <span>{currentStage.description}</span>
      </div>
    </section>
  );
};
