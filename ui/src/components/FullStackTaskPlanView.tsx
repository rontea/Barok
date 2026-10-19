import React from 'react';
import { Layers, Users, CheckSquare, AlertCircle, Zap, FileText } from 'lucide-react';

interface FileOwnership {
  file: string;
  owner: 'frontend' | 'backend' | 'data' | 'test' | 'reviewer' | 'documentation';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

interface FullStackWorkPlan {
  id: string;
  userRequest: string;
  createdAt: number;
  estimatedComplexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'expert';
  classification: 'bug_fix' | 'feature' | 'refactor' | 'test_only' | 'docs_only' | 'infrastructure' | 'generated_app' | 'investigation';
  touchedLayers: string[];
  targetSurfaces: string[];
  affectedFiles: string[];
  fileOwnership: FileOwnership[];
  executionStrategy: 'sequential' | 'parallel' | 'mixed';
  canRunParallel: boolean;
  riskFactors: string[];
  safetyScore: number;
  requiresApproval: boolean;
  approvalReason?: string;
}

interface FullStackTaskPlanViewProps {
  workPlan?: FullStackWorkPlan;
  loading?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  approved?: boolean;
}

export const FullStackTaskPlanView: React.FC<FullStackTaskPlanViewProps> = ({
  workPlan,
  loading = false,
  onApprove,
  onReject,
  approved = false,
}) => {
  if (loading && !workPlan) {
    return (
      <div className="mb-8 flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/70 py-10" aria-busy="true">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-500 border-t-indigo-400" />
        <span className="ml-3 text-sm text-slate-300">Generating work plan...</span>
      </div>
    );
  }

  if (!workPlan) return null;

  const classificationEmoji: Record<string, string> = {
    bug_fix: '🐛',
    feature: '✨',
    refactor: '🔄',
    test_only: '🧪',
    docs_only: '📚',
    infrastructure: '🏗️',
    generated_app: '🤖',
    investigation: '🔍',
  };

  const complexityColor: Record<string, string> = {
    trivial: 'text-emerald-400',
    simple: 'text-cyan-400',
    moderate: 'text-amber-400',
    complex: 'text-orange-400',
    expert: 'text-red-400',
  };

  const agentColors: Record<string, string> = {
    frontend: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    backend: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    data: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    test: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    reviewer: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    documentation: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  };

  // Get unique agents from file ownership
  const assignedAgents = Array.from(new Set(workPlan!.fileOwnership.map((f) => f.owner)));

  const safetyColor =
    workPlan!.safetyScore >= 80
      ? 'text-emerald-400'
      : workPlan!.safetyScore >= 50
        ? 'text-amber-400'
        : 'text-red-400';

  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700 rounded-2xl p-6 shadow-xl mb-8">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-700">
        <Layers className="w-5 h-5 text-indigo-400" />
        <h2 className="text-lg font-bold text-white">Full-Stack Task Plan</h2>
        <span
          className={`ml-auto text-xs px-3 py-1 rounded-full border ${
            approved
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
              : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
          }`}
        >
          {approved ? '✓ Approved' : 'Awaiting Approval'}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-500 border-t-indigo-400"></div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* User Request */}
          <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Request</p>
            <p className="text-sm text-white">{workPlan!.userRequest}</p>
          </div>

          {/* Classification & Complexity */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Classification</p>
              <p className="text-lg font-bold">
                <span className="mr-2">{classificationEmoji[workPlan!.classification]}</span>
                {workPlan!.classification.replace('_', ' ')}
              </p>
            </div>

            <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Complexity</p>
              <p className={`text-lg font-bold ${complexityColor[workPlan!.estimatedComplexity]}`}>
                {workPlan!.estimatedComplexity.charAt(0).toUpperCase() + workPlan!.estimatedComplexity.slice(1)}
              </p>
            </div>
          </div>

          {/* Touched Layers */}
          <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Touched Layers</p>
            <div className="flex flex-wrap gap-2">
              {workPlan!.touchedLayers.map((layer) => (
                <span
                  key={layer}
                  className="text-xs bg-slate-800 text-slate-300 px-3 py-1.5 rounded border border-slate-600"
                >
                  {layer}
                </span>
              ))}
            </div>
          </div>

          {/* Assigned Agents */}
          <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-slate-400" />
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Assigned Agents</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {assignedAgents.map((agent) => (
                <span
                  key={agent}
                  className={`text-xs px-3 py-1.5 rounded border ${agentColors[agent] || 'bg-slate-700 text-slate-300 border-slate-600'}`}
                >
                  {agent.charAt(0).toUpperCase() + agent.slice(1)}
                </span>
              ))}
            </div>
          </div>

          {/* Affected Files Summary */}
          <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-slate-400" />
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Affected Files</p>
              <span className="ml-auto text-xs text-slate-400">({workPlan!.affectedFiles.length})</span>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {workPlan!.affectedFiles.slice(0, 10).map((file, idx) => (
                <div key={idx} className="text-xs text-slate-400 font-mono truncate">
                  📄 {file}
                </div>
              ))}
              {workPlan!.affectedFiles.length > 10 && (
                <div className="text-xs text-slate-500 italic">+{workPlan!.affectedFiles.length - 10} more files...</div>
              )}
            </div>
          </div>

          {/* Execution Strategy */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Execution Strategy</p>
              <p className="text-sm font-bold text-white">{workPlan!.executionStrategy}</p>
            </div>

            <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Safety Score</p>
              <p className={`text-sm font-bold ${safetyColor}`}>{workPlan!.safetyScore}%</p>
            </div>
          </div>

          {/* Risk Factors */}
          {workPlan!.riskFactors.length > 0 && (
            <div className="bg-orange-950/20 border border-orange-700/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="w-4 h-4 text-orange-400" />
                <p className="text-xs font-semibold text-orange-300 uppercase tracking-wider">Risk Factors</p>
              </div>
              <ul className="space-y-1">
                {workPlan!.riskFactors.map((factor, idx) => (
                  <li key={idx} className="text-xs text-orange-300">
                    ⚠️ {factor}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Approval Reason if Required */}
          {workPlan!.requiresApproval && workPlan!.approvalReason && (
            <div className="bg-red-950/20 border border-red-700/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-4 h-4 text-red-400" />
                <p className="text-xs font-semibold text-red-300 uppercase tracking-wider">Approval Required</p>
              </div>
              <p className="text-sm text-red-200">{workPlan!.approvalReason}</p>
            </div>
          )}

          {/* Action Buttons */}
          {!approved && (
            <div className="flex gap-3 pt-4 border-t border-slate-700">
              <button
                onClick={onApprove}
                className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <CheckSquare className="w-4 h-4" /> Approve Plan
              </button>
              <button
                onClick={onReject}
                className="flex-1 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
