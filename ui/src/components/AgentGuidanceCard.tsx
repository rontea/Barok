import React from 'react';

export interface AgentGuidanceSnapshot {
  codingState: string;
  injectedDirective: string;
  permissionConstraints: string[];
  activeGateFailures: string[];
  contextBudgetUsed: number;
  step: number;
  stepId?: string;
}

interface AgentGuidanceCardProps {
  snapshot?: AgentGuidanceSnapshot;
  previous?: AgentGuidanceSnapshot;
}

function changedList(previous: string[] = [], current: string[] = []) {
  const oldValues = new Set(previous);
  const newValues = new Set(current);
  return [
    ...current.filter((value) => !oldValues.has(value)).map((value) => `+ ${value}`),
    ...previous.filter((value) => !newValues.has(value)).map((value) => `− ${value}`),
  ];
}

export const AgentGuidanceCard: React.FC<AgentGuidanceCardProps> = ({ snapshot, previous }) => {
  if (!snapshot) return null;

  const changes = [
    ...(previous && previous.codingState !== snapshot.codingState
      ? [`State: ${previous.codingState} → ${snapshot.codingState}`]
      : []),
    ...(previous && previous.injectedDirective !== snapshot.injectedDirective
      ? ['State directive changed.']
      : []),
    ...changedList(previous?.permissionConstraints, snapshot.permissionConstraints)
      .map((change) => `Permission ${change}`),
    ...changedList(previous?.activeGateFailures, snapshot.activeGateFailures)
      .map((change) => `Gate ${change}`),
  ];

  return (
    <details className="border-b border-cyan-500/20 bg-cyan-950/10 px-4 py-2" data-testid="agent-guidance-card">
      <summary className="cursor-pointer list-none text-[10px] font-semibold text-cyan-200 marker:hidden">
        Agent context · {snapshot.codingState} · ~{snapshot.contextBudgetUsed.toLocaleString()} tokens
      </summary>
      <div className="mt-2 grid gap-2 text-[10px] leading-relaxed text-neutral-300">
        <div>
          <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-neutral-500">Injected directive</div>
          <p className="mt-0.5 whitespace-pre-wrap">{snapshot.injectedDirective}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-neutral-500">Permission constraints</div>
            {snapshot.permissionConstraints.length
              ? <ul className="mt-0.5 list-inside list-disc">{snapshot.permissionConstraints.map((value) => <li key={value}>{value}</li>)}</ul>
              : <p className="mt-0.5 text-neutral-500">No task-specific constraints recorded.</p>}
          </div>
          <div>
            <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-neutral-500">Active gate failures</div>
            {snapshot.activeGateFailures.length
              ? <ul className="mt-0.5 list-inside list-disc text-amber-200">{snapshot.activeGateFailures.map((value) => <li key={value}>{value}</li>)}</ul>
              : <p className="mt-0.5 text-neutral-500">None recorded.</p>}
          </div>
        </div>
        {previous && changes.length > 0 && (
          <div className="border-t border-neutral-800 pt-1.5" data-testid="agent-guidance-diff">
            <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-neutral-500">Changed since step {previous.step}</div>
            <ul className="mt-0.5 list-inside list-disc text-cyan-100">{changes.map((value, index) => <li key={`${index}-${value}`}>{value}</li>)}</ul>
          </div>
        )}
      </div>
    </details>
  );
};
