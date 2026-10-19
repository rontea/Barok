import React, { useState } from 'react';
import { Play, Pause, RotateCcw, ChevronDown, Zap, AlertCircle } from 'lucide-react';

interface TaskControlsPanelProps {
  status: 'pending' | 'approved' | 'executing' | 'paused' | 'completed' | 'failed';
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRerun?: () => void;
  onNarrowScope?: (excludedLayers: string[], excludedFiles: string[]) => void;
  canStart?: boolean;
  canPause?: boolean;
  canResume?: boolean;
  canRerun?: boolean;
  executingAgents?: string[];
  failedAgents?: string[];
  availableLayers?: string[];
  availableFiles?: string[];
}

export const TaskControlsPanel: React.FC<TaskControlsPanelProps> = ({
  status,
  onStart,
  onPause,
  onResume,
  onRerun,
  onNarrowScope,
  canStart = false,
  canPause = false,
  canResume = false,
  canRerun = false,
  executingAgents = [],
  failedAgents = [],
  availableLayers = [],
  availableFiles = [],
}) => {
  const [showNarrowScope, setShowNarrowScope] = useState(false);
  const [excludedLayers, setExcludedLayers] = useState<string[]>([]);
  const [excludedFiles, setExcludedFiles] = useState<string[]>([]);

  const handleNarrowScope = () => {
    if (onNarrowScope) {
      onNarrowScope(excludedLayers, excludedFiles);
    }
    setShowNarrowScope(false);
    setExcludedLayers([]);
    setExcludedFiles([]);
  };

  const statusColors: Record<string, string> = {
    pending: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    approved: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    executing: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    paused: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
    completed: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    failed: 'bg-red-500/20 text-red-300 border-red-500/30',
  };

  const statusLabels: Record<string, string> = {
    pending: 'Pending Approval',
    approved: 'Ready to Execute',
    executing: 'Executing',
    paused: 'Paused',
    completed: 'Completed',
    failed: 'Failed',
  };

  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700 rounded-2xl p-6 shadow-xl mb-8">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-700">
        <Zap className="w-5 h-5 text-yellow-400" />
        <h2 className="text-lg font-bold text-white">Task Controls</h2>
        <span className={`ml-auto text-xs px-3 py-1 rounded-full border ${statusColors[status]}`}>
          {statusLabels[status]}
        </span>
      </div>

      <div className="space-y-6">
        {/* Status Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {executingAgents.length > 0 && (
            <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg p-4">
              <p className="text-xs font-semibold text-amber-300 uppercase tracking-wider mb-2">Executing Agents</p>
              <div className="flex flex-wrap gap-2">
                {executingAgents.map((agent) => (
                  <span
                    key={agent}
                    className="text-xs bg-amber-500/20 text-amber-300 px-2 py-1 rounded border border-amber-500/30"
                  >
                    ⚡ {agent}
                  </span>
                ))}
              </div>
            </div>
          )}

          {failedAgents.length > 0 && (
            <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-4">
              <p className="text-xs font-semibold text-red-300 uppercase tracking-wider mb-2">Failed Agents</p>
              <div className="flex flex-wrap gap-2">
                {failedAgents.map((agent) => (
                  <span
                    key={agent}
                    className="text-xs bg-red-500/20 text-red-300 px-2 py-1 rounded border border-red-500/30"
                  >
                    ❌ {agent}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Control Buttons */}
        <div className="flex flex-wrap gap-3">
          {canStart && (
            <button
              onClick={onStart}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
            >
              <Play className="w-4 h-4" /> Start Execution
            </button>
          )}

          {canPause && (
            <button
              onClick={onPause}
              className="flex items-center gap-2 px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-lg transition-colors"
            >
              <Pause className="w-4 h-4" /> Pause
            </button>
          )}

          {canResume && (
            <button
              onClick={onResume}
              className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors"
            >
              <Play className="w-4 h-4" /> Resume
            </button>
          )}

          {canRerun && (
            <button
              onClick={onRerun}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> Rerun Failed Tasks
            </button>
          )}

          {/* Narrow Scope Button */}
          {status === 'failed' && availableLayers.length > 0 && (
            <button
              onClick={() => setShowNarrowScope(!showNarrowScope)}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${showNarrowScope ? 'rotate-180' : ''}`} />
              Narrow Scope
            </button>
          )}
        </div>

        {/* Narrow Scope Options */}
        {showNarrowScope && status === 'failed' && (
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-4">
              <AlertCircle className="w-4 h-4 text-amber-400" />
              <p className="text-sm font-medium text-white">Exclude Layers or Files from Retry</p>
            </div>

            {/* Exclude Layers */}
            {availableLayers.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Exclude Layers</p>
                <div className="flex flex-wrap gap-2">
                  {availableLayers.map((layer) => (
                    <label
                      key={layer}
                      className="flex items-center gap-2 px-3 py-2 bg-slate-900/50 border border-slate-600 rounded cursor-pointer hover:border-slate-500"
                    >
                      <input
                        type="checkbox"
                        checked={excludedLayers.includes(layer)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setExcludedLayers([...excludedLayers, layer]);
                          } else {
                            setExcludedLayers(excludedLayers.filter((l) => l !== layer));
                          }
                        }}
                        className="w-4 h-4"
                      />
                      <span className="text-xs text-slate-300">{layer}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Exclude Files */}
            {availableFiles.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Exclude Files</p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {availableFiles.slice(0, 10).map((file) => (
                    <label key={file} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-900/50 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={excludedFiles.includes(file)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setExcludedFiles([...excludedFiles, file]);
                          } else {
                            setExcludedFiles(excludedFiles.filter((f) => f !== file));
                          }
                        }}
                        className="w-4 h-4"
                      />
                      <span className="text-xs text-slate-400 font-mono truncate">{file}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Submit Button */}
            <div className="flex gap-2 pt-4 border-t border-slate-700">
              <button
                onClick={handleNarrowScope}
                className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
              >
                Apply & Retry
              </button>
              <button
                onClick={() => setShowNarrowScope(false)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Info Message */}
        {status === 'pending' && (
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <p className="text-xs text-slate-300">
              ℹ️ Review the task plan above and click <strong>Approve</strong> to proceed with execution.
            </p>
          </div>
        )}

        {status === 'completed' && (
          <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-lg p-4">
            <p className="text-xs text-emerald-300">
              ✓ Task execution completed successfully. Review the diff summary and verification results below.
            </p>
          </div>
        )}

        {status === 'failed' && (
          <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-4">
            <p className="text-xs text-red-300">
              ⚠️ Task execution failed. You can retry with narrowed scope or rerun all tasks.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
