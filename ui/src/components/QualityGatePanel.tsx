import React from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, Wrench, XCircle } from 'lucide-react';
import type { QualityGateResult } from '../../../src/react/quality-gates';
import type { RunTerminalAdviceEvent } from '../../../src/react/terminal-run-advice';

interface QualityGatePanelProps {
  qualityGateResults?: QualityGateResult[];
  qualityScore?: number;
  onViewEvidence?: (gate: QualityGateResult) => void;
  onRemediate?: (gate: QualityGateResult) => void;
  evidenceAvailable?: (gate: QualityGateResult) => boolean;
  terminalRunAdvice?: RunTerminalAdviceEvent;
}

const GATE_GUIDANCE: Record<QualityGateResult['gateId'], { checks: string; remediation: string }> = {
  'request-satisfaction': {
    checks: 'Checks whether the generated app has an entry point and a usable app specification with the requested features.',
    remediation: 'Compare the result against the request and implement any missing requested feature.',
  },
  'responsive-layout': {
    checks: 'Checks the browser verification signal for usable layouts at mobile and desktop viewport sizes.',
    remediation: 'Inspect the failing viewport evidence, adjust the responsive layout, then verify both sizes.',
  },
  'interactive-controls': {
    checks: 'For interactive app types, checks that a visible control responds to a user action.',
    remediation: 'Inspect the control interaction evidence, fix the handler or control, then repeat the interaction check.',
  },
  'console-clean': {
    checks: 'Checks that browser verification did not record uncaught console errors.',
    remediation: 'Open the verification output, fix the first uncaught browser error, then rerun verification.',
  },
  'persistence-working': {
    checks: 'When the app requests persistence, checks the verification signal for saving and restoring data.',
    remediation: 'Implement the requested persistence behavior and verify that saved data survives a reload.',
  },
  'accessible-labels': {
    checks: 'Checks the app specification for accessibility requirements. This is a non-critical gate.',
    remediation: 'Add accessible names to important controls and include a keyboard and screen-reader check.',
  },
  'no-build-errors': {
    checks: 'Checks that the app compiled successfully or that its page loaded for a static HTML app.',
    remediation: 'Open the build or page-load output, fix the reported issue, and rerun the same verification.',
  },
};

export function QualityGatePanel({
  qualityGateResults = [],
  qualityScore = 0,
  onViewEvidence,
  onRemediate,
  evidenceAvailable,
  terminalRunAdvice,
}: QualityGatePanelProps) {
  if (qualityGateResults.length === 0) return null;

  const passedCount = qualityGateResults.filter((gate) => gate.passed).length;
  const criticalFailures = qualityGateResults.filter((gate) => !gate.passed && gate.critical);
  const scoreColor = qualityScore >= 80 ? 'text-emerald-300' : qualityScore >= 50 ? 'text-amber-300' : 'text-rose-300';
  const barColor = qualityScore >= 80 ? 'bg-emerald-400' : qualityScore >= 50 ? 'bg-amber-400' : 'bg-rose-400';

  return (
    <section className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/70 p-3" aria-label="Quality gate results">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-neutral-100">Quality gates</h3>
          <p className="mt-0.5 font-mono text-[9px] text-neutral-500">{passedCount}/{qualityGateResults.length} passed</p>
        </div>
        <span className={`font-mono text-sm font-bold ${scoreColor}`}>{qualityScore}%</span>
      </div>
      <div className="mb-3 h-1 overflow-hidden rounded-full bg-neutral-800">
        <div className={`h-full transition-all ${barColor}`} style={{ width: `${Math.max(0, Math.min(100, qualityScore))}%` }} />
      </div>

      <div className="space-y-2">
        {qualityGateResults.map((gate) => {
          const guidance = GATE_GUIDANCE[gate.gateId];
          const canViewEvidence = Boolean(onViewEvidence && (evidenceAvailable ? evidenceAvailable(gate) : true));
          return (
            <article key={gate.gateId} className={`rounded-md border p-2.5 ${gate.passed ? 'border-emerald-500/20 bg-emerald-950/15' : 'border-rose-500/25 bg-rose-950/15'}`}>
              <div className="flex items-start gap-2">
                {gate.passed
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-xs font-semibold text-neutral-100">{gate.name}</h4>
                    {gate.critical && !gate.passed && <span className="rounded border border-rose-500/30 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase text-rose-300">Critical</span>}
                  </div>
                  {!gate.passed && <p className="mt-1 text-[11px] leading-relaxed text-rose-200">{gate.failureReason || gate.description}</p>}
                  {!gate.passed && terminalRunAdvice?.category === 'gate_deadlock' && (
                    <p className="mt-1 text-[10px] leading-relaxed text-amber-200" title={terminalRunAdvice.summary}>
                      Run advice: {terminalRunAdvice.guidance[0]}
                    </p>
                  )}
                  <details className="mt-1.5">
                    <summary className="w-fit cursor-pointer font-mono text-[9px] font-semibold text-cyan-300 hover:text-cyan-100">What this checks</summary>
                    <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-400">{guidance.checks}</p>
                  </details>
                  {(canViewEvidence || (!gate.passed && onRemediate)) && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {canViewEvidence && (
                        <button type="button" onClick={() => onViewEvidence?.(gate)} className="inline-flex items-center gap-1 font-mono text-[9px] font-bold text-cyan-300 hover:text-white">
                          <ExternalLink className="h-3 w-3" /> View evidence
                        </button>
                      )}
                      {!gate.passed && onRemediate && (
                        <button type="button" onClick={() => onRemediate(gate)} title={guidance.remediation} className="inline-flex items-center gap-1 font-mono text-[9px] font-bold text-amber-300 hover:text-amber-100">
                          <Wrench className="h-3 w-3" /> Draft fix prompt
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {criticalFailures.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 rounded border border-amber-500/20 bg-amber-950/15 p-2 text-[10px] leading-relaxed text-amber-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{criticalFailures.length} critical gate{criticalFailures.length === 1 ? '' : 's'} need attention before this result is fully verified.</span>
        </p>
      )}
    </section>
  );
}
