import React from 'react';
import { FileText, Folder, Copy, ExternalLink } from 'lucide-react';
import { getWorkspaceFileUrl } from '../utils/appArtifacts';

interface AppGenerationResultProps {
  appName?: string;
  entryPoint?: string;
  outputFiles?: string[];
  outputMode?: 'single-html' | 'vanilla-web' | 'vite-react';
  workspace?: string;
}

export const AppGenerationResult: React.FC<AppGenerationResultProps> = ({
  appName,
  entryPoint,
  outputFiles = [],
  outputMode = 'single-html',
  workspace,
}) => {
  const [copiedFile, setCopiedFile] = React.useState<string | null>(null);

  const copyToClipboard = (text: string, file: string) => {
    navigator.clipboard.writeText(text);
    setCopiedFile(file);
    setTimeout(() => setCopiedFile(null), 2000);
  };

  const openFile = (file: string) => {
    window.open(getWorkspaceFileUrl(file, workspace), '_blank');
  };

  if (!appName && !entryPoint && outputFiles.length === 0) return null;

  return (
    <div className="bg-gradient-to-br from-emerald-950/30 via-emerald-900/20 to-slate-900 border border-emerald-700/40 rounded-2xl p-6 shadow-xl mb-8">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-emerald-700/40">
        <Folder className="w-5 h-5 text-emerald-400" />
        <h2 className="text-lg font-bold text-white">Generated Files</h2>
        <span className="ml-auto text-xs bg-emerald-500/20 text-emerald-300 px-3 py-1 rounded-full border border-emerald-500/30">
          {outputFiles.length} file{outputFiles.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* App Name */}
      {appName && (
        <div className="mb-6">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">App Name</span>
          <p className="text-lg font-bold text-white mt-2">{appName}</p>
        </div>
      )}

      {/* Entry Point */}
      {entryPoint && (
        <div className="mb-6 bg-slate-900/50 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Entry Point</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-mono text-slate-300 break-all">{entryPoint}</p>
            <button
              onClick={() => copyToClipboard(entryPoint, 'entry-point')}
              className="p-2 text-slate-400 hover:text-emerald-400 transition-colors hover:bg-slate-800 rounded-lg"
              title="Copy path"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
          <span className={`text-xs mt-2 inline-block transition-opacity ${
            copiedFile === 'entry-point' ? 'text-emerald-400 opacity-100' : 'text-slate-500 opacity-0'
          }`}>
            ✓ Copied to clipboard
          </span>
        </div>
      )}

      {/* Generated Files List */}
      {outputFiles.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Files</span>
            <span className="text-xs text-slate-500">({outputFiles.length})</span>
          </div>
          <div className="space-y-2">
            {outputFiles.map((file, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-3 bg-slate-900/30 hover:bg-slate-900/50 border border-slate-700/50 rounded-lg p-3 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  <span className="text-sm text-slate-300 font-mono truncate">{file}</span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => copyToClipboard(file, file)}
                    className="p-1.5 text-slate-400 hover:text-emerald-400 transition-colors hover:bg-slate-800 rounded"
                    title="Copy path"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  {workspace && (
                    <button
                      onClick={() => openFile(file)}
                      className="p-1.5 text-slate-400 hover:text-emerald-400 transition-colors hover:bg-slate-800 rounded"
                      title="Open file"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
