import React from 'react';
import { Monitor, Smartphone, ExternalLink, RefreshCw } from 'lucide-react';

interface AppPreviewProps {
  filePath?: string;
  appName?: string;
  isHtmlApp?: boolean;
  previewUrl?: string;
}

export const AppPreview: React.FC<AppPreviewProps> = ({
  filePath,
  appName,
  isHtmlApp = true,
  previewUrl,
}) => {
  const [viewport, setViewport] = React.useState<'desktop' | 'mobile'>('desktop');
  const [refreshKey, setRefreshKey] = React.useState(0);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  if (!filePath || !isHtmlApp) return null;
  const appUrl = previewUrl || filePath;

  const handleRefresh = () => {
    if (iframeRef.current) {
      iframeRef.current.src = appUrl;
    }
    setRefreshKey(prev => prev + 1);
  };

  const openInNewTab = () => {
    window.open(appUrl, '_blank');
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-xl mb-8 overflow-hidden">
      <div className="flex items-center justify-between gap-3 mb-6 pb-4 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <Monitor className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-bold text-white">App Preview</h2>
          {appName && <span className="text-sm text-slate-400 ml-2">({appName})</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1">
            <button
              onClick={() => setViewport('desktop')}
              className={`p-2 rounded transition-colors ${
                viewport === 'desktop'
                  ? 'bg-slate-700 text-blue-400'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
              title="Desktop view"
            >
              <Monitor className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewport('mobile')}
              className={`p-2 rounded transition-colors ${
                viewport === 'mobile'
                  ? 'bg-slate-700 text-blue-400'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
              title="Mobile view"
            >
              <Smartphone className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={handleRefresh}
            className="p-2 text-slate-400 hover:text-blue-400 transition-colors hover:bg-slate-800 rounded-lg"
            title="Refresh preview"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={openInNewTab}
            className="p-2 text-slate-400 hover:text-blue-400 transition-colors hover:bg-slate-800 rounded-lg"
            title="Open in new tab"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Preview Container */}
      <div
        className={`bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-inner transition-all ${
          viewport === 'desktop'
            ? 'w-full'
            : 'mx-auto max-w-sm'
        }`}
      >
        <div
          className={`bg-white overflow-auto ${
            viewport === 'desktop'
              ? 'h-[600px] w-full'
              : 'h-[800px] w-96'
          }`}
        >
          <iframe
            ref={iframeRef}
            key={refreshKey}
            src={appUrl}
            className="w-full h-full border-none"
            title={appName || 'App Preview'}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
        </div>
      </div>

      <div className="mt-4 p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
        <p className="text-xs text-slate-400">
          <span className="font-semibold">Preview Path:</span> {filePath}
        </p>
        {appUrl !== filePath && (
          <p className="text-xs text-slate-500 mt-1 break-all">
            <span className="font-semibold">Served URL:</span> {appUrl}
          </p>
        )}
      </div>
    </div>
  );
};
