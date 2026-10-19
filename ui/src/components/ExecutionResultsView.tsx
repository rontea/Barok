import React, { useState } from 'react';
import { Monitor, GitCompare, CheckCircle2, ChevronRight, Wrench, RefreshCw, AlertCircle } from 'lucide-react';
import { AppPreview } from './AppPreview';
import { DiffSummaryPanel } from './DiffSummaryPanel';
import { VerificationPanel } from './VerificationPanel';
import type { AppSpec, VerificationResult, DiffSummary, ExecutionLayer } from '../App';
import { getWorkspaceFileUrl } from '../utils/appArtifacts';

type OutputType = 'preview' | 'diffs' | 'verification';

interface ExecutionResultsViewProps {
  appSpec?: AppSpec;
  verificationResult?: VerificationResult;
  diffs?: DiffSummary[];
  outputFiles?: string[];
  workspace?: string;
  onViewChange?: (view: OutputType) => void;
  onVerify?: () => void;
  onRepair?: () => void;
  actionLoading?: boolean;
}

/**
 * ExecutionResultsView displays full-stack execution results with toggleable output types:
 * - Preview: Live app preview for single-html generated apps
 * - Diffs: Code changes grouped by execution layer
 * - Verification: Quality gates and verification results
 * 
 * Shows tabs only for available output types based on app spec and results
 */
export const ExecutionResultsView: React.FC<ExecutionResultsViewProps> = ({
  appSpec,
  verificationResult,
  diffs = [],
  outputFiles = [],
  workspace,
  onViewChange,
  onVerify,
  onRepair,
  actionLoading = false,
}) => {
  // Determine available output types
  const isHtmlApp = appSpec?.outputMode === 'single-html' || appSpec?.outputMode === 'vanilla-web';
  const hasPreview = isHtmlApp && appSpec?.entryPoint;
  const hasDiffs = diffs && diffs.length > 0;
  const hasVerification = !!verificationResult;
  const failedChecks = verificationResult?.checks?.filter((check) => !check.passed) || [];
  const failedSignals = verificationResult?.signals?.filter((signal) => !signal.passed) || [];
  const hasVerificationIssues = failedChecks.length > 0 || failedSignals.length > 0 || verificationResult?.passed === false;

  // Default to preview if available, otherwise diffs, otherwise verification
  const defaultView: OutputType = hasPreview ? 'preview' : hasDiffs ? 'diffs' : 'verification';
  const [activeView, setActiveView] = useState<OutputType>(defaultView);

  const handleViewChange = (view: OutputType) => {
    setActiveView(view);
    onViewChange?.(view);
  };

  // If no output types are available, show placeholder
  if (!hasPreview && !hasDiffs && !hasVerification) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 text-center">
        <p className="text-slate-400">No execution results available</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-xl mb-8 overflow-hidden">
      {(onVerify || onRepair) && (
        <div className="mb-6 rounded-xl border border-cyan-500/20 bg-cyan-950/10 p-4" data-testid="studio-repair-actions">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="rounded-lg bg-cyan-400/10 p-2 text-cyan-300">
                {hasVerificationIssues ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-white">Verification and repair</h3>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  {hasVerificationIssues
                    ? `${failedChecks.length + failedSignals.length} verification issue${failedChecks.length + failedSignals.length === 1 ? '' : 's'} detected. Repair keeps the existing files and uses the normal coder run.`
                    : hasVerification
                      ? 'The generated app is verified. Re-run checks after making changes.'
                      : 'Run the destination verification checks against the generated workspace.'}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {onVerify && (
                <button
                  type="button"
                  onClick={onVerify}
                  disabled={actionLoading || !appSpec}
                  className="inline-flex items-center gap-2 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-wait disabled:opacity-50"
                  data-testid="studio-verify"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${actionLoading ? 'animate-spin' : ''}`} />
                  Verify
                </button>
              )}
              {onRepair && hasVerificationIssues && (
                <button
                  type="button"
                  onClick={onRepair}
                  disabled={actionLoading || !appSpec}
                  className="inline-flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/20 disabled:cursor-wait disabled:opacity-50"
                  data-testid="studio-repair"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  Repair failed checks
                </button>
              )}
            </div>
          </div>
          {hasVerificationIssues && (
            <div className="mt-3 space-y-1 border-t border-cyan-500/15 pt-3 text-xs text-slate-400">
              {[...failedSignals.map((signal) => `${signal.name}: ${signal.details || signal.message || 'failed'}`), ...failedChecks.map((check) => `${check.name}: ${check.reason || 'failed'}`)].map((issue) => (
                <div key={issue} className="font-mono">• {issue}</div>
              ))}
            </div>
          )}
        </div>
      )}
      {outputFiles.length > 0 && (
        <div className="mb-6 rounded-xl border border-border-main bg-bg-panel/60 p-4" data-testid="studio-generated-files">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-dim">Generated files</h3>
            <span className="font-mono text-[10px] text-text-dark">{outputFiles.length} file{outputFiles.length === 1 ? '' : 's'}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {outputFiles.map((file) => (
              <code key={file} className="rounded border border-cyan-500/20 bg-cyan-950/20 px-2 py-1 text-[10px] text-cyan-200">
                {file}
              </code>
            ))}
          </div>
        </div>
      )}
      {/* Output Type Tabs */}
      <div className="flex items-center gap-2 mb-6 pb-4 border-b border-slate-700">
        <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1 flex-wrap">
          {hasPreview && (
            <button
              onClick={() => handleViewChange('preview')}
              className={`flex items-center gap-2 px-4 py-2 rounded transition-colors text-sm font-medium ${
                activeView === 'preview'
                  ? 'bg-slate-700 text-blue-400'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
              title="Preview app output"
              data-testid="tab-preview"
            >
              <Monitor className="w-4 h-4" />
              <span>Preview</span>
            </button>
          )}

          {hasDiffs && (
            <button
              onClick={() => handleViewChange('diffs')}
              className={`flex items-center gap-2 px-4 py-2 rounded transition-colors text-sm font-medium ${
                activeView === 'diffs'
                  ? 'bg-slate-700 text-blue-400'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
              title="Show code changes"
              data-testid="tab-diffs"
            >
              <GitCompare className="w-4 h-4" />
              <span>Diffs</span>
            </button>
          )}

          {hasVerification && (
            <button
              onClick={() => handleViewChange('verification')}
              className={`flex items-center gap-2 px-4 py-2 rounded transition-colors text-sm font-medium ${
                activeView === 'verification'
                  ? 'bg-slate-700 text-blue-400'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
              title="Show verification results"
              data-testid="tab-verification"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Verification</span>
            </button>
          )}
        </div>

        {/* Quick Stats */}
        {(hasDiffs || hasVerification) && (
          <div className="flex items-center gap-4 ml-auto text-xs text-slate-400">
            {hasDiffs && diffs.length > 0 && (
              <div className="flex items-center gap-1">
                <span className="font-semibold text-slate-300">{diffs.length}</span>
                <span>layer{diffs.length !== 1 ? 's' : ''}</span>
              </div>
            )}
            {hasVerification && verificationResult?.checks && (
              <div className="flex items-center gap-1">
                <span className="font-semibold text-slate-300">
                  {verificationResult.checks.filter(c => c.passed).length}/{verificationResult.checks.length}
                </span>
                <span>checks passed</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Active View Content */}
      <div className="min-h-[400px]">
        {activeView === 'preview' && hasPreview && appSpec && (
          <div data-testid="view-preview">
            <AppPreview
              filePath={appSpec.entryPoint}
              previewUrl={getWorkspaceFileUrl(appSpec.entryPoint, workspace)}
              appName={appSpec.appName}
              isHtmlApp={true}
            />
          </div>
        )}

        {activeView === 'diffs' && hasDiffs && (
          <div data-testid="view-diffs">
            <div className="space-y-6">
              {/* Diffs Header */}
              <div className="flex items-center gap-3 border-b border-slate-700 pb-4">
                <GitCompare className="w-5 h-5 text-blue-400" />
                <div>
                  <h3 className="text-lg font-bold text-white">Code Changes</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    {outputFiles.length} file{outputFiles.length !== 1 ? 's' : ''} modified across {diffs.length} layer{diffs.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              {/* Layer-wise Diff Summary */}
              <div className="grid gap-4">
                {diffs.map((diff, idx) => (
                  <div
                    key={`${diff.layer}-${idx}`}
                    className="bg-slate-800 border border-slate-700 rounded-lg p-4"
                    data-testid={`diff-layer-${diff.layer}`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="inline-block px-3 py-1 bg-slate-700 text-slate-200 rounded-full text-xs font-semibold capitalize">
                          {diff.layer}
                        </span>
                        <span
                          className={`text-xs font-semibold px-2 py-1 rounded ${
                            diff.riskLevel === 'low'
                              ? 'bg-green-950 text-green-400'
                              : diff.riskLevel === 'medium'
                                ? 'bg-yellow-950 text-yellow-400'
                                : 'bg-red-950 text-red-400'
                          }`}
                        >
                          {diff.riskLevel.toUpperCase()} RISK
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        +{diff.linesAdded} -{diff.linesRemoved}
                      </div>
                    </div>

                    <div className="space-y-2">
                      {diff.filesChanged.slice(0, 3).map((file, fileIdx) => (
                        <div key={fileIdx} className="flex items-center gap-2 text-sm text-slate-300">
                          <ChevronRight className="w-3 h-3 text-slate-500" />
                          <code className="text-xs bg-slate-900 px-2 py-1 rounded text-slate-400">
                            {file}
                          </code>
                        </div>
                      ))}
                      {diff.filesChanged.length > 3 && (
                        <div className="text-xs text-slate-400 pl-5">
                          +{diff.filesChanged.length - 3} more file{diff.filesChanged.length - 3 !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeView === 'verification' && hasVerification && verificationResult && (
          <div data-testid="view-verification">
            <VerificationPanel verificationResult={verificationResult} />
          </div>
        )}
      </div>

      {/* Footer - Show active view indicator */}
      <div className="mt-6 pt-4 border-t border-slate-700">
        <p className="text-xs text-slate-500">
          Viewing: <span className="font-semibold text-slate-400 capitalize">{activeView}</span>
          {activeView === 'preview' && ' - Live app preview'}
          {activeView === 'diffs' && ' - Code changes summary'}
          {activeView === 'verification' && ' - Verification results and quality gates'}
        </p>
      </div>
    </div>
  );
};
