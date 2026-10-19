import React from 'react';
import { CheckCircle2, AlertCircle, XCircle, Clock } from 'lucide-react';

interface VerificationSignal {
  name: string;
  passed: boolean;
  details?: string;
}

interface VerificationCheck {
  name: string;
  passed: boolean;
  reason?: string;
}

interface VerificationResult {
  passed: boolean;
  checkedAt: string;
  checks: VerificationCheck[];
  signals: VerificationSignal[];
}

interface VerificationPanelProps {
  verificationResult?: VerificationResult;
}

const signalEmoji: Record<string, string> = {
  'page-load': '📄',
  'no-console-errors': '🔇',
  'responsive': '📱',
  'interactive': '👆',
  'canvas-content': '🎨',
  'persistence': '💾',
  'build-success': '✅',
};

export const VerificationPanel: React.FC<VerificationPanelProps> = ({ verificationResult }) => {
  if (!verificationResult) return null;

  const passedCount = verificationResult.signals.filter(s => s.passed).length;
  const totalCount = verificationResult.signals.length;
  const passedPercentage = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;

  return (
    <div className={`bg-gradient-to-br border rounded-2xl p-6 shadow-xl mb-8 ${
      verificationResult.passed
        ? 'from-emerald-950/30 via-emerald-900/20 to-slate-900 border-emerald-700/40'
        : 'from-amber-950/30 via-amber-900/20 to-slate-900 border-amber-700/40'
    }`}>
      <div className="flex items-center justify-between gap-3 mb-6 pb-4 border-b border-slate-700">
        <div className="flex items-center gap-3">
          {verificationResult.passed ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          ) : (
            <AlertCircle className="w-5 h-5 text-amber-400" />
          )}
          <h2 className="text-lg font-bold text-white">
            {verificationResult.passed ? '✅ Verification Passed' : '⚠️ Verification Results'}
          </h2>
        </div>
        <span className={`text-xs px-3 py-1 rounded-full border ${
          verificationResult.passed
            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
            : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
        }`}>
          {passedCount}/{totalCount} Signals
        </span>
      </div>

      {/* Quality Score */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Quality Score</span>
          <span className={`text-lg font-bold ${
            passedPercentage >= 80 ? 'text-emerald-400' : passedPercentage >= 50 ? 'text-amber-400' : 'text-red-400'
          }`}>
            {passedPercentage}%
          </span>
        </div>
        <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full transition-all rounded-full ${
              passedPercentage >= 80
                ? 'bg-emerald-500'
                : passedPercentage >= 50
                ? 'bg-amber-500'
                : 'bg-red-500'
            }`}
            style={{ width: `${passedPercentage}%` }}
          />
        </div>
      </div>

      {/* Verification Signals */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Verification Signals</span>
          <span className="text-xs text-slate-500">({totalCount})</span>
        </div>
        <div className="space-y-2">
          {verificationResult.signals.map((signal, idx) => (
            <div
              key={idx}
              className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
                signal.passed
                  ? 'bg-emerald-900/20 border-emerald-700/30'
                  : 'bg-red-900/20 border-red-700/30'
              }`}
            >
              <div className="mt-0.5">
                {signal.passed ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${
                  signal.passed ? 'text-emerald-300' : 'text-red-300'
                }`}>
                  {signalEmoji[signal.name] || '◆'} {signal.name}
                </p>
                {signal.details && (
                  <p className="text-xs text-slate-400 mt-1">{signal.details}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quality Checks */}
      {verificationResult.checks && verificationResult.checks.length > 0 && (
        <div className="pt-6 border-t border-slate-700">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Quality Checklist</span>
            <span className="text-xs text-slate-500">({verificationResult.checks.length})</span>
          </div>
          <div className="space-y-2">
            {verificationResult.checks.map((check, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
                  check.passed
                    ? 'bg-emerald-900/20 border-emerald-700/30'
                    : 'bg-amber-900/20 border-amber-700/30'
                }`}
              >
                <div className="mt-0.5">
                  {check.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${
                    check.passed ? 'text-emerald-300' : 'text-amber-300'
                  }`}>
                    {check.name}
                  </p>
                  {check.reason && (
                    <p className="text-xs text-slate-400 mt-1">{check.reason}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timestamp */}
      {verificationResult.checkedAt && (
        <div className="mt-6 pt-6 border-t border-slate-700 flex items-center gap-2 text-xs text-slate-500">
          <Clock className="w-4 h-4" />
          <span>Verified at {new Date(verificationResult.checkedAt).toLocaleString()}</span>
        </div>
      )}
    </div>
  );
};
