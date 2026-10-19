import React from 'react';
import { CheckCircle2, Wrench, ExternalLink, RefreshCw, Loader2 } from 'lucide-react';

interface AppActionButtonsProps {
  appName?: string;
  entryPoint?: string;
  verified?: boolean;
  verificationFailed?: boolean;
  loading?: boolean;
  onVerify?: () => void;
  onRepair?: () => void;
  onOpenApp?: () => void;
  onRefresh?: () => void;
  openUrl?: string;
}

export const AppActionButtons: React.FC<AppActionButtonsProps> = ({
  appName,
  entryPoint,
  verified = false,
  verificationFailed = false,
  loading = false,
  onVerify,
  onRepair,
  onOpenApp,
  onRefresh,
  openUrl,
}) => {
  if (!appName && !entryPoint) return null;

  const handleOpenApp = () => {
    if (onOpenApp) {
      onOpenApp();
      return;
    }

    const targetUrl = openUrl || entryPoint;
    if (targetUrl) {
      window.open(targetUrl, '_blank');
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 mb-8 shadow-xl">
      <h3 className="text-sm font-bold text-white mb-4">App Actions</h3>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Verify Button */}
        <button
          onClick={onVerify}
          disabled={loading || verified || !onVerify}
          className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm transition-all ${
            verified
              ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-700/50 cursor-default'
              : !onVerify
              ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
              : loading
              ? 'bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500 hover:border-emerald-400 shadow-lg hover:shadow-emerald-500/20'
          }`}
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {!loading && <CheckCircle2 className="w-4 h-4" />}
          {verified ? 'Verified ✓' : 'Verify'}
        </button>

        {/* Repair Button */}
        <button
          onClick={onRepair}
          disabled={loading || !verificationFailed || verified || !onRepair}
          className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm transition-all ${
            !verificationFailed || verified || !onRepair
              ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
              : loading
              ? 'bg-slate-800 text-slate-400 border border-slate-700'
              : 'bg-amber-600 hover:bg-amber-700 text-white border border-amber-500 hover:border-amber-400 shadow-lg hover:shadow-amber-500/20'
          }`}
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {!loading && <Wrench className="w-4 h-4" />}
          Repair
        </button>

        {/* Open App Button */}
        <button
          onClick={handleOpenApp}
          disabled={loading || !(openUrl || entryPoint)}
          className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm transition-all ${
            !(openUrl || entryPoint)
              ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
              : loading
              ? 'bg-slate-800 text-slate-400 border border-slate-700'
              : 'bg-blue-600 hover:bg-blue-700 text-white border border-blue-500 hover:border-blue-400 shadow-lg hover:shadow-blue-500/20'
          }`}
        >
          <ExternalLink className="w-4 h-4" />
          Open App
        </button>

        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={loading}
          className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm transition-all ${
            loading
              ? 'bg-slate-800 text-slate-400 border border-slate-700'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-200 border border-slate-700 hover:border-slate-600 shadow-sm hover:shadow-slate-500/10'
          }`}
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {!loading && <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      <div className="mt-4 p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
        <p className="text-xs text-slate-400">
          <span className="font-semibold">💡 Tip:</span> Generate apps are automatically verified after creation. Use Repair to fix any quality issues found during verification.
        </p>
      </div>
    </div>
  );
};
