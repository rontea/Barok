import React from 'react';
import { AlertTriangle, Zap, AlertCircle } from 'lucide-react';

interface ConflictWarning {
  type: 'file-conflict' | 'ownership-conflict' | 'dependency-conflict' | 'dirty-file-conflict';
  severity: 'warning' | 'critical';
  files: string[];
  agents: string[];
  description: string;
}

interface ConflictWarningsPanelProps {
  conflicts?: ConflictWarning[];
  hasConflicts?: boolean;
  loading?: boolean;
  onResolve?: (conflictIndex: number, resolution: string) => void;
}

export const ConflictWarningsPanel: React.FC<ConflictWarningsPanelProps> = ({
  conflicts = [],
  hasConflicts = false,
  loading = false,
  onResolve,
}) => {
  if (!hasConflicts && conflicts.length === 0 && !loading) return null;

  const conflictTypeEmoji: Record<string, string> = {
    'file-conflict': '📝',
    'ownership-conflict': '👥',
    'dependency-conflict': '🔗',
    'dirty-file-conflict': '🔄',
  };

  const conflictTypeLabel: Record<string, string> = {
    'file-conflict': 'File Edit Conflict',
    'ownership-conflict': 'Ownership Conflict',
    'dependency-conflict': 'Dependency Conflict',
    'dirty-file-conflict': 'Dirty File Conflict',
  };

  const severityColor: Record<string, string> = {
    warning: 'bg-amber-950/30 border-amber-700/50 text-amber-200',
    critical: 'bg-red-950/30 border-red-700/50 text-red-200',
  };

  const severityBadge: Record<string, string> = {
    warning: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    critical: 'bg-red-500/20 text-red-300 border-red-500/30',
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700 rounded-2xl p-6 shadow-xl mb-8">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-700">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
          <h2 className="text-lg font-bold text-white">Analyzing for Conflicts</h2>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-500 border-t-amber-400"></div>
        </div>
      </div>
    );
  }

  if (conflicts.length === 0) {
    return (
      <div className="bg-gradient-to-br from-emerald-950/20 via-emerald-900/10 to-slate-900 border border-emerald-700/40 rounded-2xl p-6 shadow-xl mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-400 border border-emerald-500/30">
            <AlertCircle className="w-5 h-5" />
          </div>
          <h2 className="text-lg font-bold text-white">No Conflicts Detected</h2>
        </div>
        <p className="text-sm text-emerald-200">✓ All planned changes are compatible with each other and the repository state.</p>
      </div>
    );
  }

  const criticalCount = conflicts.filter((c) => c.severity === 'critical').length;
  const warningCount = conflicts.filter((c) => c.severity === 'warning').length;

  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700 rounded-2xl p-6 shadow-xl mb-8">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-700">
        <AlertTriangle className="w-5 h-5 text-amber-400" />
        <h2 className="text-lg font-bold text-white">Conflict Warnings</h2>
        <div className="ml-auto flex items-center gap-2">
          {criticalCount > 0 && (
            <span className={`text-xs px-3 py-1 rounded-full border ${severityBadge.critical}`}>
              {criticalCount} Critical
            </span>
          )}
          {warningCount > 0 && (
            <span className={`text-xs px-3 py-1 rounded-full border ${severityBadge.warning}`}>
              {warningCount} Warning{warningCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {conflicts.map((conflict, idx) => (
          <div
            key={idx}
            className={`rounded-lg p-4 border ${severityColor[conflict.severity]}`}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">{conflictTypeEmoji[conflict.type]}</span>
                <div>
                  <h3 className="font-semibold text-sm">{conflictTypeLabel[conflict.type]}</h3>
                  <p className="text-xs opacity-75 mt-0.5">{conflict.description}</p>
                </div>
              </div>
              <span
                className={`text-xs font-medium px-2 py-1 rounded border ${
                  conflict.severity === 'critical' ? 'bg-red-600 text-white' : 'bg-amber-600 text-white'
                }`}
              >
                {conflict.severity.toUpperCase()}
              </span>
            </div>

            {/* Agents Involved */}
            {conflict.agents.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium uppercase tracking-wider mb-1 opacity-75">Agents Involved</p>
                <div className="flex flex-wrap gap-1.5">
                  {conflict.agents.map((agent) => (
                    <span key={agent} className="text-xs bg-white/10 px-2 py-1 rounded font-mono">
                      {agent}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Files Affected */}
            {conflict.files.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium uppercase tracking-wider mb-1 opacity-75">Affected Files</p>
                <div className="space-y-1">
                  {conflict.files.slice(0, 4).map((file, fidx) => (
                    <div key={fidx} className="text-xs font-mono opacity-90">
                      📄 {file}
                    </div>
                  ))}
                  {conflict.files.length > 4 && (
                    <div className="text-xs opacity-60 italic">+{conflict.files.length - 4} more files...</div>
                  )}
                </div>
              </div>
            )}

            {/* Resolution Options */}
            {onResolve && (
              <div className="mt-3 pt-3 border-t border-white/10">
                <p className="text-xs font-medium uppercase tracking-wider mb-2 opacity-75">Resolution Options</p>
                <div className="flex flex-wrap gap-2">
                  {conflict.type === 'file-conflict' && (
                    <>
                      <button
                        onClick={() => onResolve(idx, 'merge-sequential')}
                        className="text-xs px-2.5 py-1.5 bg-white/10 hover:bg-white/20 rounded transition-colors"
                      >
                        Merge Sequential
                      </button>
                      <button
                        onClick={() => onResolve(idx, 'last-write-wins')}
                        className="text-xs px-2.5 py-1.5 bg-white/10 hover:bg-white/20 rounded transition-colors"
                      >
                        Last Write Wins
                      </button>
                    </>
                  )}
                  {conflict.type === 'ownership-conflict' && (
                    <>
                      <button
                        onClick={() => onResolve(idx, 'primary-agent')}
                        className="text-xs px-2.5 py-1.5 bg-white/10 hover:bg-white/20 rounded transition-colors"
                      >
                        Primary Agent
                      </button>
                      <button
                        onClick={() => onResolve(idx, 'both-agents')}
                        className="text-xs px-2.5 py-1.5 bg-white/10 hover:bg-white/20 rounded transition-colors"
                      >
                        Both Agents
                      </button>
                    </>
                  )}
                  {conflict.type === 'dependency-conflict' && (
                    <>
                      <button
                        onClick={() => onResolve(idx, 'reorder')}
                        className="text-xs px-2.5 py-1.5 bg-white/10 hover:bg-white/20 rounded transition-colors"
                      >
                        Reorder Tasks
                      </button>
                      <button
                        onClick={() => onResolve(idx, 'split')}
                        className="text-xs px-2.5 py-1.5 bg-white/10 hover:bg-white/20 rounded transition-colors"
                      >
                        Split Tasks
                      </button>
                    </>
                  )}
                  {conflict.type === 'dirty-file-conflict' && (
                    <>
                      <button
                        onClick={() => onResolve(idx, 'preserve-dirty')}
                        className="text-xs px-2.5 py-1.5 bg-white/10 hover:bg-white/20 rounded transition-colors"
                      >
                        Preserve User Changes
                      </button>
                      <button
                        onClick={() => onResolve(idx, 'stash-and-apply')}
                        className="text-xs px-2.5 py-1.5 bg-white/10 hover:bg-white/20 rounded transition-colors"
                      >
                        Stash & Merge
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Info Message */}
      {criticalCount > 0 && (
        <div className="mt-4 bg-red-900/30 border border-red-700/50 rounded-lg p-3">
          <p className="text-xs text-red-200">
            ⚠️ <strong>Critical conflicts detected.</strong> These must be resolved before proceeding.
          </p>
        </div>
      )}
    </div>
  );
};
