import React from 'react';
import { Layout, Zap, Eye, Save, CheckCircle, AlertCircle } from 'lucide-react';

interface AppSpec {
  appType: 'game' | 'tool' | 'dashboard' | 'landing' | 'editor' | 'utility';
  outputMode: 'single-html' | 'vanilla-web' | 'vite-react';
  appName: string;
  entryPoint: string;
  requiredFeatures: string[];
  designDirection: string;
  dataPersistence: 'none' | 'localStorage' | 'indexedDB' | 'backend';
  verificationChecks: string[];
}

interface AppSpecPanelProps {
  appSpec: AppSpec | undefined;
  showBefore?: boolean; // Show before execution
}

export const AppSpecPanel: React.FC<AppSpecPanelProps> = ({ appSpec, showBefore = false }) => {
  if (!appSpec) return null;

  const appTypeEmoji: Record<string, string> = {
    game: '🎮',
    tool: '🛠️',
    dashboard: '📊',
    landing: '🌐',
    editor: '✏️',
    utility: '⚙️',
  };

  const outputModeLabel: Record<string, string> = {
    'single-html': 'Single HTML File',
    'vanilla-web': 'Vanilla HTML/CSS/JS',
    'vite-react': 'Vite React Project',
  };

  return (
    <div className={`bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700 rounded-2xl p-6 shadow-xl ${showBefore ? 'mb-6' : 'mb-8'}`}>
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-700">
        <Layout className="w-5 h-5 text-amber-400" />
        <h2 className="text-lg font-bold text-white">
          {showBefore ? '📋 App Specification' : '✅ Generated App Contract'}
        </h2>
        {showBefore ? (
          <span className="ml-auto text-xs bg-amber-500/20 text-amber-300 px-3 py-1 rounded-full border border-amber-500/30">
            Planning Phase
          </span>
        ) : (
          <span className="ml-auto text-xs bg-emerald-500/20 text-emerald-300 px-3 py-1 rounded-full border border-emerald-500/30">
            Execution Complete
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column: Core Properties */}
        <div className="space-y-4">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">App Type</span>
            <p className="text-lg font-bold text-white mt-1">
              {appTypeEmoji[appSpec.appType]} {appSpec.appType.charAt(0).toUpperCase() + appSpec.appType.slice(1)}
            </p>
          </div>

          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">App Name</span>
            <p className="text-lg font-bold text-white mt-1">{appSpec.appName}</p>
          </div>

          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Output Mode</span>
            <p className="text-lg font-bold text-white mt-1 flex items-center gap-2">
              {appSpec.outputMode === 'single-html' ? (
                <>
                  <span className="text-yellow-400">📄</span> {outputModeLabel[appSpec.outputMode]}
                </>
              ) : appSpec.outputMode === 'vanilla-web' ? (
                <>
                  <span className="text-emerald-400">🌐</span> {outputModeLabel[appSpec.outputMode]}
                </>
              ) : (
                <>
                  <span className="text-blue-400">⚛️</span> {outputModeLabel[appSpec.outputMode]}
                </>
              )}
            </p>
          </div>

          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Entry Point</span>
            <p className="text-sm font-mono bg-slate-900/50 text-slate-300 px-3 py-2 rounded-lg mt-1 break-all">
              {appSpec.entryPoint}
            </p>
          </div>
        </div>

        {/* Right Column: Features & Details */}
        <div className="space-y-4">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Data Persistence</span>
            <p className="text-lg font-bold text-white mt-1 flex items-center gap-2">
              {appSpec.dataPersistence === 'none' ? (
                <>❌ None</>
              ) : appSpec.dataPersistence === 'localStorage' ? (
                <>💾 LocalStorage</>
              ) : appSpec.dataPersistence === 'indexedDB' ? (
                <>🗄️ IndexedDB</>
              ) : (
                <>☁️ Backend</>
              )}
            </p>
          </div>

          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Design Direction</span>
            <p className="text-sm text-slate-300 mt-1 line-clamp-2">{appSpec.designDirection}</p>
          </div>
        </div>
      </div>

      {/* Required Features */}
      {appSpec.requiredFeatures.length > 0 && (
        <div className="mt-6 pt-6 border-t border-slate-700">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Required Features ({appSpec.requiredFeatures.length})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {appSpec.requiredFeatures.map((feature, idx) => (
              <span
                key={idx}
                className="text-xs bg-slate-700/50 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-600 hover:border-slate-500 transition-colors"
              >
                ✓ {feature}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Verification Checks */}
      {appSpec.verificationChecks.length > 0 && (
        <div className="mt-6 pt-6 border-t border-slate-700">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Quality Checks ({appSpec.verificationChecks.length})</span>
          </div>
          <div className="space-y-2">
            {appSpec.verificationChecks.map((check, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold mt-0.5">◆</span>
                <span className="text-sm text-slate-300">{check}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
