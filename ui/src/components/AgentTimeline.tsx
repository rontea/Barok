import React from 'react';
import { Clock, CheckCircle, AlertCircle, Loader2, FileText, Terminal, CheckSquare } from 'lucide-react';

interface AgentTaskExecution {
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
  verification?: any;
}

interface AgentTimelineProps {
  executions?: AgentTaskExecution[];
  loading?: boolean;
  showDetails?: boolean;
}

export const AgentTimeline: React.FC<AgentTimelineProps> = ({
  executions = [],
  loading = false,
  showDetails = true,
}) => {
  if (executions.length === 0 && !loading) return null;

  const agentEmoji: Record<string, string> = {
    frontend: '🎨',
    backend: '⚙️',
    data: '🗄️',
    test: '🧪',
    reviewer: '👁️',
    documentation: '📚',
  };

  const statusConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    pending: { icon: <Clock className="w-4 h-4" />, color: 'text-slate-500', label: 'Pending' },
    assigned: { icon: <Loader2 className="w-4 h-4 animate-spin" />, color: 'text-blue-500', label: 'Assigned' },
    executing: {
      icon: <Loader2 className="w-4 h-4 animate-spin" />,
      color: 'text-amber-500',
      label: 'Executing',
    },
    paused: { icon: <Clock className="w-4 h-4" />, color: 'text-orange-500', label: 'Paused' },
    completed: { icon: <CheckCircle className="w-4 h-4" />, color: 'text-emerald-500', label: 'Completed' },
    verified: { icon: <CheckCircle className="w-4 h-4" />, color: 'text-cyan-500', label: 'Verified' },
    'verification-failed': { icon: <AlertCircle className="w-4 h-4" />, color: 'text-red-500', label: 'Verification Failed' },
    failed: { icon: <AlertCircle className="w-4 h-4" />, color: 'text-red-500', label: 'Failed' },
    cancelled: { icon: <AlertCircle className="w-4 h-4" />, color: 'text-slate-500', label: 'Cancelled' },
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '—';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700 rounded-2xl p-6 shadow-xl mb-8">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-700">
        <Clock className="w-5 h-5 text-violet-400" />
        <h2 className="text-lg font-bold text-white">Agent Execution Timeline</h2>
        <span className="ml-auto text-xs bg-violet-500/20 text-violet-300 px-3 py-1 rounded-full border border-violet-500/30">
          {executions.length} agent{executions.length !== 1 ? 's' : ''}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-500 border-t-violet-400"></div>
        </div>
      ) : (
        <div className="space-y-4">
          {executions.map((execution, idx) => {
            const status = statusConfig[execution.status];
            const hasErrors = execution.errors.length > 0;
            const hasWarnings = execution.outputs.warnings && execution.outputs.warnings.length > 0;
            const testsPassed =
              execution.outputs.testResults &&
              Object.values(execution.outputs.testResults).filter((p) => p).length;
            const totalTests = execution.outputs.testResults ? Object.keys(execution.outputs.testResults).length : 0;

            return (
              <div key={idx} className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0">
                      <div className="relative">
                        <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center text-lg">
                          {agentEmoji[execution.agentRole] || '🤖'}
                        </div>
                        <div className={`absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center ${status.color} bg-slate-900 border border-slate-700`}>
                          {status.icon}
                        </div>
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white capitalize">
                        {execution.agentRole} Agent
                      </h3>
                      <p className="text-xs text-slate-400">Task {execution.taskId.slice(0, 8)}...</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-xs font-medium ${status.color}`}>{status.label}</p>
                    <p className="text-xs text-slate-500 mt-1">{formatDuration(execution.durationMs)}</p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-400">Progress</span>
                    <span className="text-xs font-mono text-slate-300">{execution.progress}%</span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        execution.status === 'completed'
                          ? 'bg-emerald-500'
                          : execution.status === 'failed'
                            ? 'bg-red-500'
                            : 'bg-violet-500'
                      }`}
                      style={{ width: `${execution.progress}%` }}
                    ></div>
                  </div>
                </div>

                {/* Confidence */}
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-xs text-slate-400">Confidence:</span>
                  <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-violet-500"
                      style={{ width: `${execution.confidence * 100}%` }}
                    ></div>
                  </div>
                  <span className="text-xs font-mono text-slate-300">{(execution.confidence * 100).toFixed(0)}%</span>
                </div>

                {/* Details Section */}
                {showDetails && (
                  <div className="space-y-3 pt-3 border-t border-slate-700/50">
                    {/* Files Changed */}
                    {execution.outputs.changedFiles.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-xs font-medium text-slate-300">
                            Files Changed ({execution.outputs.changedFiles.length})
                          </span>
                        </div>
                        <div className="space-y-1 ml-5">
                          {execution.outputs.changedFiles.slice(0, 3).map((file, fidx) => (
                            <div key={fidx} className="text-xs text-slate-400 font-mono truncate">
                              📄 {file}
                            </div>
                          ))}
                          {execution.outputs.changedFiles.length > 3 && (
                            <div className="text-xs text-slate-500 italic">
                              +{execution.outputs.changedFiles.length - 3} more...
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Commands Run */}
                    {execution.outputs.commandsRun.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Terminal className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-xs font-medium text-slate-300">
                            Commands ({execution.outputs.commandsRun.length})
                          </span>
                        </div>
                        <div className="space-y-1 ml-5">
                          {execution.outputs.commandsRun.slice(0, 2).map((cmd, cidx) => (
                            <div
                              key={cidx}
                              className="text-xs text-slate-400 font-mono bg-slate-800/30 px-2 py-1 rounded truncate"
                            >
                              $ {cmd}
                            </div>
                          ))}
                          {execution.outputs.commandsRun.length > 2 && (
                            <div className="text-xs text-slate-500 italic">
                              +{execution.outputs.commandsRun.length - 2} more commands...
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Test Results */}
                    {totalTests > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <CheckSquare className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-xs font-medium text-slate-300">
                            Tests: {testsPassed}/{totalTests} passed
                          </span>
                        </div>
                      </div>
                    )}

                    {execution.verification?.gates?.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <CheckSquare className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-xs font-medium text-slate-300">
                            Verification Gates ({execution.verification.gates.length})
                          </span>
                        </div>
                        <div className="space-y-1 ml-5">
                          {execution.verification.gates.slice(0, 3).map((gate: any, gateIndex: number) => (
                            <div key={gateIndex} className="text-xs text-slate-400">
                              {gate.status}: {gate.gate}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Errors */}
                    {hasErrors && (
                      <div className="bg-red-900/20 border border-red-700/30 rounded p-2">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                          <span className="text-xs font-medium text-red-300">
                            {execution.errors.length} Error{execution.errors.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        {execution.errors.slice(0, 1).map((err, eidx) => (
                          <p key={eidx} className="text-xs text-red-300 font-mono">
                            {err.message}
                          </p>
                        ))}
                      </div>
                    )}

                    {/* Warnings */}
                    {hasWarnings && (
                      <div className="bg-amber-900/20 border border-amber-700/30 rounded p-2">
                        <span className="text-xs font-medium text-amber-300">
                          {execution.outputs.warnings!.length} Warning{execution.outputs.warnings!.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Retry Indicator */}
                {execution.attemptNumber > 1 && (
                  <div className="mt-3 pt-3 border-t border-slate-700/50">
                    <p className="text-xs text-orange-400">
                      🔄 Retry attempt {execution.attemptNumber}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
