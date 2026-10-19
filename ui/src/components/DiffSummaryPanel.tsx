import React, { useState } from 'react';
import { Code2, ChevronDown, ChevronUp, FileText, TrendingUp } from 'lucide-react';

interface DiffSummary {
  layer: 'frontend' | 'backend' | 'data' | 'config' | 'tests' | 'docs' | 'cli' | 'vscode-extension';
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
  riskLevel: 'low' | 'medium' | 'high';
}

interface DiffSummaryPanelProps {
  diffs?: DiffSummary[];
  loading?: boolean;
  totalFilesChanged?: number;
  totalLinesAdded?: number;
  totalLinesRemoved?: number;
}

export const DiffSummaryPanel: React.FC<DiffSummaryPanelProps> = ({
  diffs = [],
  loading = false,
  totalFilesChanged = 0,
  totalLinesAdded = 0,
  totalLinesRemoved = 0,
}) => {
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set());

  if (diffs.length === 0 && !loading) return null;

  const toggleLayer = (layer: string) => {
    const newExpanded = new Set(expandedLayers);
    if (newExpanded.has(layer)) {
      newExpanded.delete(layer);
    } else {
      newExpanded.add(layer);
    }
    setExpandedLayers(newExpanded);
  };

  const layerEmoji: Record<string, string> = {
    frontend: '🎨',
    backend: '⚙️',
    data: '🗄️',
    config: '⚙️',
    tests: '🧪',
    docs: '📚',
    cli: '💻',
    'vscode-extension': '🧩',
  };

  const riskColors: Record<string, string> = {
    low: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    medium: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    high: 'text-red-400 bg-red-500/10 border-red-500/30',
  };

  const getDiffColor = (filesChanged: number) => {
    if (filesChanged === 0) return 'text-slate-500';
    if (filesChanged <= 3) return 'text-emerald-400';
    if (filesChanged <= 10) return 'text-amber-400';
    return 'text-red-400';
  };

  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700 rounded-2xl p-6 shadow-xl mb-8">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-700">
        <Code2 className="w-5 h-5 text-teal-400" />
        <h2 className="text-lg font-bold text-white">Changes Summary</h2>
        <span className="ml-auto text-xs bg-teal-500/20 text-teal-300 px-3 py-1 rounded-full border border-teal-500/30">
          {diffs.length} layer{diffs.length !== 1 ? 's' : ''} affected
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-500 border-t-teal-400"></div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Overall Statistics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Files Changed</p>
              <p className="text-2xl font-bold text-white">{totalFilesChanged}</p>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Lines Added</p>
              <p className="text-2xl font-bold text-emerald-400">+{totalLinesAdded}</p>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Lines Removed</p>
              <p className="text-2xl font-bold text-red-400">−{totalLinesRemoved}</p>
            </div>
          </div>

          {/* Per-Layer Breakdown */}
          <div className="space-y-3">
            {diffs.map((diff) => {
              const isExpanded = expandedLayers.has(diff.layer);
              const netChange = diff.linesAdded - diff.linesRemoved;

              return (
                <div key={diff.layer} className="bg-slate-900/50 border border-slate-700/50 rounded-lg overflow-hidden">
                  {/* Layer Header */}
                  <button
                    onClick={() => toggleLayer(diff.layer)}
                    className="w-full p-4 flex items-center justify-between hover:bg-slate-800/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-2xl">{layerEmoji[diff.layer]}</span>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-white capitalize text-left">
                          {diff.layer.replace('-', ' ')}
                        </h3>
                        <p className="text-xs text-slate-400 text-left">
                          {diff.filesChanged.length} file{diff.filesChanged.length !== 1 ? 's' : ''} changed
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                      <div className="text-right">
                        <p className={`text-sm font-bold ${getDiffColor(diff.filesChanged.length)}`}>
                          {netChange >= 0 ? '+' : ''}
                          {netChange}
                        </p>
                        <p className="text-xs text-slate-500">
                          <span className="text-emerald-400">+{diff.linesAdded}</span>
                          {' / '}
                          <span className="text-red-400">−{diff.linesRemoved}</span>
                        </p>
                      </div>

                      <div className={`px-2 py-1 rounded border text-xs font-medium ${riskColors[diff.riskLevel]}`}>
                        {diff.riskLevel.charAt(0).toUpperCase() + diff.riskLevel.slice(1)}
                      </div>

                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-slate-500" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-500" />
                      )}
                    </div>
                  </button>

                  {/* Expanded Content - Files List */}
                  {isExpanded && (
                    <div className="border-t border-slate-700/50 bg-slate-800/20 p-4">
                      <div className="space-y-2">
                        {diff.filesChanged.length > 0 ? (
                          <>
                            {diff.filesChanged.slice(0, 15).map((file, fidx) => (
                              <div key={fidx} className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                                <FileText className="w-3 h-3 flex-shrink-0 text-slate-600" />
                                <span className="truncate">{file}</span>
                              </div>
                            ))}
                            {diff.filesChanged.length > 15 && (
                              <div className="text-xs text-slate-500 italic pl-5 pt-1">
                                +{diff.filesChanged.length - 15} more file{diff.filesChanged.length - 15 !== 1 ? 's' : ''}...
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-slate-500 italic">No file changes in this layer</p>
                        )}
                      </div>

                      {/* Risk Assessment for Layer */}
                      <div className="mt-4 pt-4 border-t border-slate-700/50">
                        <div className="flex items-center gap-2 mb-2">
                          <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
                          <p className="text-xs font-medium text-slate-300 uppercase tracking-wider">Risk Assessment</p>
                        </div>
                        <div className="space-y-1 text-xs text-slate-400">
                          {diff.riskLevel === 'low' && (
                            <p>✓ Changes are isolated and low-impact</p>
                          )}
                          {diff.riskLevel === 'medium' && (
                            <p>⚠️ Changes affect key files, but dependencies are manageable</p>
                          )}
                          {diff.riskLevel === 'high' && (
                            <p>🔴 Changes affect critical infrastructure or multiple modules</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer Info */}
          <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-3 mt-4">
            <p className="text-xs text-slate-400">
              <span className="font-medium text-slate-300">Tip:</span> Review changes by layer to identify potential risks or dependencies.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
