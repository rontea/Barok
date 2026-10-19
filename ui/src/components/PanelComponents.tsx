import React from 'react';
import { Bot, Flower2, Cpu } from 'lucide-react';
import { Card, Button, Select, Input } from './FormComponents';
import { LoadingSpinner } from './LoadingComponents';
import { POLLINATIONS_TEXT_MODEL_OPTIONS } from '../modelOptions';

/**
 * App Creator Panel Component
 */
interface AppCreatorPanelProps {
  appName: string;
  onAppNameChange: (name: string) => void;
  template: string;
  onTemplateChange: (template: string) => void;
  loading: boolean;
  onGenerate: () => void;
}

export const AppCreatorPanel: React.FC<AppCreatorPanelProps> = ({
  appName,
  onAppNameChange,
  template,
  onTemplateChange,
  loading,
  onGenerate,
}) => {
  return (
    <Card>
      <div className="flex items-center gap-2.5 mb-4">
        <div className="p-2 bg-emerald-500/10 rounded-xl text-emerald-400 border border-emerald-500/20">
          <Bot className="w-5 h-5 animate-pulse text-indigo-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            🚀 Autopilot App Creator
          </h2>
          <p className="text-xs text-zinc-400">
            Instruct the core ReAct agent to build a beautiful full-featured app
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
        <Input
          label="Output File Name"
          type="text"
          value={appName}
          onChange={(e) =>
            onAppNameChange(
              e.target.value
                .toLowerCase()
                .replace(/[^a-z0-9\-_]/g, '')
            )
          }
          placeholder="e.g. retro-snake-game"
          suffix=".html"
        />

        <div className="md:col-span-2">
          <Select
            label="App Preset Settings"
            value={template}
            onChange={(e) => onTemplateChange(e.target.value)}
            options={[
              {
                value: 'snake',
                label: '🕹️ Retro Snake Game (Neon, Web Audio, High-Scores)',
              },
              {
                value: 'piano',
                label: '🎹 Virtual Synth Piano (Waveforms, Oscillator Canvas)',
              },
              {
                value: 'kanban',
                label: '⏱️ Pomodoro Kanban (Persistent Columns, Sound Alerts)',
              },
              {
                value: 'drawing',
                label: '🎨 Creative Art Studio (Brush, Color, Downloader)',
              },
            ]}
          />
        </div>
      </div>

      <div className="flex justify-between items-center pt-3 border-t border-zinc-800/60 mt-4">
        <span className="text-xs text-zinc-500 font-mono">
          Model target: <span className="text-indigo-400">qwen-large</span>
        </span>
        <Button
          onClick={onGenerate}
          disabled={loading || !appName.trim()}
          variant="primary"
        >
          {loading ? <LoadingSpinner size="sm" /> : '▶'}
          {loading ? 'Building...' : 'Build & Execute'}
        </Button>
      </div>
    </Card>
  );
};

/**
 * Status Check Panel Component
 */
interface StatusCheckPanelProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  loading: boolean;
  status: any;
  error: string | null;
  onCheck: () => void;
}

export const StatusCheckPanel: React.FC<StatusCheckPanelProps> = ({
  icon,
  title,
  description,
  loading,
  status,
  error,
  onCheck,
}) => {
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-xl text-indigo-400">
            {icon}
          </div>
          <div>
            <h3 className="font-semibold text-white text-sm">{title}</h3>
            <p className="text-xs text-zinc-500">{description}</p>
          </div>
        </div>
        <Button
          onClick={onCheck}
          disabled={loading}
          variant="ghost"
          size="sm"
        >
          {loading ? '⟳' : '↻'}
        </Button>
      </div>

      {loading && (
        <div className="flex justify-center py-4">
          <LoadingSpinner size="sm" />
        </div>
      )}

      {error && (
        <div className="text-xs text-red-400 bg-red-950/20 px-3 py-2 rounded-lg border border-red-900/30">
          Error: {error}
        </div>
      )}

      {status && !loading && !error && (
        <div className="bg-zinc-950 rounded-lg p-3 text-xs">
          <pre className="text-zinc-400 overflow-x-auto">
            {JSON.stringify(status, null, 2)}
          </pre>
        </div>
      )}
    </Card>
  );
};

/**
 * Execution Results Panel Component
 */
interface ResultsPanelProps {
  result: any;
  loading: boolean;
  liveProgress: string;
  liveState: any;
  onReset: () => void;
}

export const ResultsPanel: React.FC<ResultsPanelProps> = ({
  result,
  loading,
  liveProgress,
  liveState,
  onReset,
}) => {
  if (!result && !loading && !liveProgress) {
    return null;
  }

  return (
    <Card highlight>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white text-lg">Execution Results</h3>
        {!loading && result && (
          <Button onClick={onReset} variant="secondary" size="sm">
            Clear
          </Button>
        )}
      </div>

      {loading && (
        <div className="flex flex-col gap-4">
          <LoadingSpinner message="Executing task..." />
          {liveProgress && (
            <div className="text-xs text-zinc-400 bg-zinc-950 p-3 rounded-lg max-h-32 overflow-y-auto">
              {liveProgress}
            </div>
          )}
        </div>
      )}

      {result && !loading && (
        <div className="space-y-4">
          {result.success || result.executionCompleted === true ? (
            <div className="bg-emerald-950/20 border border-emerald-900/30 rounded-lg p-3">
              <p className="text-sm text-emerald-400 font-medium mb-2">✓ Task Completed Successfully</p>
              {result.finalAnswer && (
                <div className="text-xs text-zinc-300 bg-zinc-950 p-2 rounded max-h-40 overflow-y-auto font-mono">
                  {result.finalAnswer}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-3">
              <p className="text-sm text-red-400 font-medium">✗ Task Failed</p>
              {result.error && (
                <p className="text-xs text-red-300 mt-2 font-mono">{result.error}</p>
              )}
            </div>
          )}

          {typeof result.pollenCost === 'number' && (
            <div className="text-xs text-zinc-400">
              <p>Pollen used: ~{result.pollenCost.toFixed(4)}</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

/**
 * Model Configuration Panel Component
 */
interface ModelConfigPanelProps {
  model: string;
  onModelChange: (model: string) => void;
  workspace: string;
  onWorkspaceChange: (workspace: string) => void;
  onSelectFolder: () => void;
}

export const ModelConfigPanel: React.FC<ModelConfigPanelProps> = ({
  model,
  onModelChange,
  workspace,
  onWorkspaceChange,
  onSelectFolder,
}) => {
  return (
    <Card>
      <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
        <Cpu className="w-4 h-4 text-indigo-400" />
        Configuration
      </h3>

      <div className="space-y-4">
        <Select
          label="Model"
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          options={POLLINATIONS_TEXT_MODEL_OPTIONS}
        />

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            Target Workspace
          </label>
          <div className="flex gap-2">
            <Input
              type="text"
              value={workspace}
              onChange={(e) => onWorkspaceChange(e.target.value)}
              placeholder="e.g., /path/to/workspace"
              readOnly
            />
            <Button onClick={onSelectFolder} variant="secondary" size="md">
              📁
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
};
