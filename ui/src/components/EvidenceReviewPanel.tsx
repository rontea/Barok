import React from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react';

export interface RequirementEvidenceItem {
  requirementId: string;
  observationIds: string[];
  status: 'passed' | 'missing' | 'blocked';
}

interface EvidenceReviewPanelProps {
  evidence?: RequirementEvidenceItem[];
  findings?: string[];
}

export const EvidenceReviewPanel: React.FC<EvidenceReviewPanelProps> = ({ evidence = [], findings = [] }) => {
  if (!evidence.length && !findings.length) return null;
  return (
    <section className="mt-3 rounded border border-white/10 bg-black/20 p-3" aria-label="Independent verification review">
      <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-indigo-300">Requirement Evidence</h4>
      <div className="space-y-1.5">
        {evidence.map((item) => {
          const Icon = item.status === 'passed' ? CheckCircle2 : item.status === 'blocked' ? AlertTriangle : CircleDashed;
          return (
            <div key={item.requirementId} className="flex items-start gap-2 text-xs text-zinc-300">
              <Icon className={`mt-0.5 h-3.5 w-3.5 ${item.status === 'passed' ? 'text-emerald-400' : item.status === 'blocked' ? 'text-amber-400' : 'text-zinc-500'}`} />
              <div><span className="font-mono">{item.requirementId}</span><span className="ml-2 text-zinc-500">{item.status} · {item.observationIds.length} evidence item(s)</span></div>
            </div>
          );
        })}
      </div>
      {findings.length > 0 && (
        <div className="mt-3 border-t border-white/10 pt-2 text-xs text-amber-200">
          {findings.map((finding) => <p key={finding}>• {finding}</p>)}
        </div>
      )}
    </section>
  );
};
