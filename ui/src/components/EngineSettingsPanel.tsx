import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Gauge,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  Sliders,
  Terminal,
  Users,
  Zap,
} from 'lucide-react';
import {
  cloneExecutionProfilePresets,
  EXECUTION_PROFILE_PRESETS,
  normalizeExecutionProfilePresets,
  USER_EXECUTION_PROFILE_IDS,
  type ExecutionPacingProfile,
  type ExecutionProfilePreset,
  type ExecutionProfilePresetMap,
} from '../../../src/config/executionProfiles';

export interface EngineSettings {
  maxSteps: number;
  maxLlmRequestsPerTask: number;
  budget: number;
  requestTimeoutMs: number;
  defaultModel: string;
  plannerModel: string;
  crewAgents: number;
  crewParallel: boolean;
  parallelTasks: boolean;
  maxRetries: number;
  retryBackoffMs: number;
  retryMultiplier: number;
  logLevel: string;
  debug: boolean;
  reactVerbose: boolean;
  enableLogging: boolean;
  toolTimeoutDefault: number;
  toolTimeoutBash: number;
  toolTimeoutFileops: number;
  toolTimeoutGlob: number;
  toolTimeoutGrep: number;
  toolTimeoutSubagent: number;
  pacingProfiles: ExecutionProfilePresetMap;
}

const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  maxSteps: 25,
  maxLlmRequestsPerTask: 20,
  budget: 100,
  requestTimeoutMs: 300000,
  defaultModel: 'openrouter:dots-studio/dots-3-note-preview:free',
  plannerModel: 'openrouter:dots-studio/dots-3-note-preview:free',
  crewAgents: 4,
  crewParallel: true,
  parallelTasks: true,
  maxRetries: 3,
  retryBackoffMs: 1000,
  retryMultiplier: 2,
  logLevel: 'info',
  debug: false,
  reactVerbose: false,
  enableLogging: true,
  toolTimeoutDefault: 30000,
  toolTimeoutBash: 30000,
  toolTimeoutFileops: 15000,
  toolTimeoutGlob: 10000,
  toolTimeoutGrep: 30000,
  toolTimeoutSubagent: 120000,
  pacingProfiles: cloneExecutionProfilePresets(),
};

function numberOrFallback(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function EngineSettingsPanel() {
  const [settings, setSettings] = useState<EngineSettings>(DEFAULT_ENGINE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/engine-settings');
      if (!response.ok) {
        throw new Error('Failed to load engine settings');
      }
      const data = await response.json();
      if (data.settings) {
        setSettings({
          ...DEFAULT_ENGINE_SETTINGS,
          ...data.settings,
          pacingProfiles: normalizeExecutionProfilePresets(data.settings.pacingProfiles),
        });
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load engine settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/engine-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save engine settings');
      }
      if (data.settings) {
        setSettings({
          ...DEFAULT_ENGINE_SETTINGS,
          ...data.settings,
          pacingProfiles: normalizeExecutionProfilePresets(data.settings.pacingProfiles),
        });
      }
      setMessage('Engine settings saved and applied to active runtime.');
    } catch (err: any) {
      setError(err?.message || 'Failed to save engine settings');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setSettings({ ...DEFAULT_ENGINE_SETTINGS, pacingProfiles: cloneExecutionProfilePresets() });
    setMessage('Recommended defaults restored. Click Save Settings to apply.');
    setError(null);
  };

  const updateSetting = <K extends keyof EngineSettings>(key: K, value: EngineSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
    setError(null);
  };

  const updatePacingProfile = (
    profileId: ExecutionPacingProfile,
    patch: Partial<ExecutionProfilePreset>,
  ) => {
    setSettings((prev) => ({
      ...prev,
      pacingProfiles: {
        ...prev.pacingProfiles,
        [profileId]: {
          ...prev.pacingProfiles[profileId],
          ...patch,
        },
      },
    }));
    setMessage(null);
    setError(null);
  };

  const updatePacingNested = (
    profileId: ExecutionPacingProfile,
    section: 'toolPresentation' | 'decisionPresentation' | 'typewriter',
    patch: Record<string, number | boolean>,
  ) => {
    const profile = settings.pacingProfiles[profileId];
    updatePacingProfile(profileId, {
      [section]: { ...profile[section], ...patch },
    });
  };

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="flex items-center gap-2 text-cyan-400">
            <Sliders className="h-4 w-4" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Runtime Configuration</span>
          </div>
          <h3 className="mt-2 text-lg font-semibold text-white">Engine &amp; Execution Settings</h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-400">
            Configure agent turn budgets, LLM request limits, multi-agent crew execution, tool timeouts, and logging verbosity dynamically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={loading || saving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs font-semibold text-zinc-400 transition hover:border-zinc-700 hover:text-white disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to Recommended Defaults
          </button>
          <button
            type="button"
            onClick={() => void loadSettings()}
            disabled={loading || saving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs font-semibold text-zinc-400 transition hover:border-zinc-700 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={loading || saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-black transition hover:bg-cyan-400 disabled:opacity-50 shadow-lg shadow-cyan-500/20"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-950/30 p-3.5 text-xs text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {message && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-3.5 text-xs text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>{message}</span>
        </div>
      )}

      {/* Section 1: Execution & Step Budgets */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-zinc-800/80 pb-3 text-cyan-400">
          <Gauge className="h-4 w-4" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-white">Execution &amp; Request Budgets</h4>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <label title="Maximum ReAct reasoning and action steps for a run. A low limit can stop multi-file tasks before implementation and verification are complete." className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Max Turn Steps
            </label>
            <input
              type="number"
              min={1}
              max={1000}
              value={settings.maxSteps}
              onChange={(e) => updateSetting('maxSteps', Math.max(1, parseInt(e.target.value) || 1))}
              title="Maximum ReAct reasoning and action steps for a run."
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
            <p className="text-[10px] text-zinc-500">Limits reasoning and tool-action turns. 15–40 is a useful starting range for multi-file work.</p>
            {settings.maxSteps < 15 && (
              <p role="status" className="text-[10px] font-medium text-amber-300">
                This is below 15 steps; multi-file tasks may stop before changes and verification are complete.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label title="Caps model-provider requests across a task. Once reached, the engine stops making new model calls, including calls needed to finish or recover the task." className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Max LLM Requests / Task
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={settings.maxLlmRequestsPerTask}
              onChange={(e) => updateSetting('maxLlmRequestsPerTask', Math.max(1, parseInt(e.target.value) || 1))}
              title="Caps model-provider requests across a task."
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
            <p className="text-[10px] text-zinc-500">Caps model calls before the request-budget guard stops the run. Leave room for recovery calls.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Budget Score
            </label>
            <input
              type="number"
              min={1}
              max={10000}
              value={settings.budget}
              onChange={(e) => updateSetting('budget', Math.max(1, parseInt(e.target.value) || 100))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
            <p className="text-[10px] text-zinc-500">Task complexity and pollen allocation budget.</p>
          </div>

          <div className="space-y-1.5">
            <label title="Maximum wait for an individual model-provider request. A request that exceeds this time is cancelled; this is not the total run duration." className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Request Timeout (ms)
            </label>
            <input
              type="number"
              step={10000}
              min={10000}
              max={1800000}
              value={settings.requestTimeoutMs}
              onChange={(e) => updateSetting('requestTimeoutMs', Math.max(10000, parseInt(e.target.value) || 300000))}
              title="Maximum wait for an individual model-provider request."
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
            <p className="text-[10px] text-zinc-500">Per-request provider deadline. 300,000 ms = 5 minutes; long-running local models may need more.</p>
          </div>
        </div>
      </div>

      {/* Section 2: Pacing Profiles */}
      <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/5 p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800/80 pb-3">
          <div className="flex items-start gap-2 text-cyan-400">
            <Zap className="mt-0.5 h-4 w-4" />
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">Pacing Profiles</h4>
              <p className="mt-1 max-w-3xl text-[10px] leading-4 text-zinc-500">
                Tune every value used by Paid, Adaptive, Free, and Free Conservative runs. Changes apply to new runs after Save Settings.
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded border border-cyan-500/20 bg-cyan-500/5 px-2 py-1 font-mono text-[9px] text-cyan-300">
            milliseconds
          </span>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {USER_EXECUTION_PROFILE_IDS.map((profileId) => {
            const defaults = EXECUTION_PROFILE_PRESETS[profileId];
            const profile = settings.pacingProfiles[profileId] || defaults;
            const numberInputClass = 'w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none';
            const updateNumber = (key: keyof ExecutionProfilePreset, event: React.ChangeEvent<HTMLInputElement>) => {
              updatePacingProfile(profileId, { [key]: numberOrFallback(event.target.value, profile[key] as number) });
            };
            return (
              <div key={profileId} className="rounded-xl border border-zinc-800/90 bg-zinc-950/50 p-4 space-y-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{profile.label}</span>
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-zinc-500">{profile.description}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Engine request gap</label>
                    <input type="number" min={0} max={60000} step={500} value={profile.requestIntervalMs} onChange={(event) => updateNumber('requestIntervalMs', event)} className={numberInputClass} />
                    <p className="text-[9px] text-zinc-600">Delay between agent model requests.</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Provider request floor</label>
                    <input type="number" min={0} max={60000} step={500} value={profile.providerRequestIntervalMs} onChange={(event) => updateNumber('providerRequestIntervalMs', event)} className={numberInputClass} />
                    <p className="text-[9px] text-zinc-600">Minimum spacing for free-tier-aware routes.</p>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Workspace presentation</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-zinc-400">Read / inspect delay</label>
                      <input type="number" min={0} max={30000} step={100} value={profile.toolPresentation.readMs} onChange={(event) => updatePacingNested(profileId, 'toolPresentation', { readMs: numberOrFallback(event.target.value, profile.toolPresentation.readMs) })} className={numberInputClass} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-zinc-400">Write / edit delay</label>
                      <input type="number" min={0} max={30000} step={100} value={profile.toolPresentation.writeMs} onChange={(event) => updatePacingNested(profileId, 'toolPresentation', { writeMs: numberOrFallback(event.target.value, profile.toolPresentation.writeMs) })} className={numberInputClass} />
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Action summary pause</div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-zinc-400">Minimum</label>
                      <input type="number" min={0} max={30000} step={100} value={profile.decisionPresentation.minMs} onChange={(event) => updatePacingNested(profileId, 'decisionPresentation', { minMs: numberOrFallback(event.target.value, profile.decisionPresentation.minMs) })} className={numberInputClass} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-zinc-400">Maximum</label>
                      <input type="number" min={0} max={30000} step={100} value={profile.decisionPresentation.maxMs} onChange={(event) => updatePacingNested(profileId, 'decisionPresentation', { maxMs: numberOrFallback(event.target.value, profile.decisionPresentation.maxMs) })} className={numberInputClass} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-zinc-400">Characters / second</label>
                      <input type="number" min={1} max={1000} step={1} value={profile.decisionPresentation.charactersPerStep} onChange={(event) => updatePacingNested(profileId, 'decisionPresentation', { charactersPerStep: numberOrFallback(event.target.value, profile.decisionPresentation.charactersPerStep) })} className={numberInputClass} />
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-2.5">
                    <div>
                      <div className="text-[10px] font-medium text-zinc-300">Typewriter presentation</div>
                      <div className="text-[9px] text-zinc-600">Animated status updates for this profile</div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={profile.typewriter.enabled}
                      onClick={() => updatePacingNested(profileId, 'typewriter', { enabled: !profile.typewriter.enabled })}
                      className={`relative h-5 w-9 shrink-0 rounded-full transition ${profile.typewriter.enabled ? 'bg-cyan-500' : 'bg-zinc-700'}`}
                    >
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${profile.typewriter.enabled ? 'left-4.5' : 'left-0.5'}`} />
                    </button>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Typewriter interval</label>
                    <input type="number" min={1} max={1000} step={1} value={profile.typewriter.intervalMs} onChange={(event) => updatePacingNested(profileId, 'typewriter', { intervalMs: numberOrFallback(event.target.value, profile.typewriter.intervalMs) })} className={numberInputClass} />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Request timeout floor</label>
                  <input type="number" min={0} max={300000} step={1000} value={profile.requestTimeoutFloorMs} onChange={(event) => updateNumber('requestTimeoutFloorMs', event)} className={numberInputClass} />
                  <p className="text-[9px] text-zinc-600">Minimum provider request timeout applied by this profile.</p>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] leading-4 text-zinc-600">
          Values are bounded for safety when saved. Provider-specific protections, rate-limit cooldowns, and active runs remain independent of these presets.
        </p>
      </div>

      {/* Section 2: Multi-Agent & Crew Settings */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-zinc-800/80 pb-3 text-cyan-400">
          <Users className="h-4 w-4" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-white">Multi-Agent &amp; Crew Execution</h4>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Crew Agents Count
            </label>
            <input
              type="number"
              min={1}
              max={16}
              value={settings.crewAgents}
              onChange={(e) => updateSetting('crewAgents', Math.max(1, Math.min(16, parseInt(e.target.value) || 4)))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
            <p className="text-[10px] text-zinc-500">Number of sub-agents spawned for crew tasks (1-16).</p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3.5">
            <div>
              <div className="text-xs font-medium text-white">Parallel Crew Execution</div>
              <div className="text-[10px] text-zinc-500">Run crew sub-agents concurrently</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.crewParallel}
              onClick={() => updateSetting('crewParallel', !settings.crewParallel)}
              className={`relative h-5 w-9 shrink-0 rounded-full transition ${settings.crewParallel ? 'bg-cyan-500' : 'bg-zinc-700'}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${settings.crewParallel ? 'left-4.5' : 'left-0.5'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3.5">
            <div>
              <div className="text-xs font-medium text-white">Parallel Tasks</div>
              <div className="text-[10px] text-zinc-500">Enable concurrent background task execution</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.parallelTasks}
              onClick={() => updateSetting('parallelTasks', !settings.parallelTasks)}
              className={`relative h-5 w-9 shrink-0 rounded-full transition ${settings.parallelTasks ? 'bg-cyan-500' : 'bg-zinc-700'}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${settings.parallelTasks ? 'left-4.5' : 'left-0.5'}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Section 3: Retries & Recovery Policy */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-zinc-800/80 pb-3 text-cyan-400">
          <Shield className="h-4 w-4" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-white">Retry &amp; Fault Tolerance Policy</h4>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Max Retry Attempts
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={settings.maxRetries}
              onChange={(e) => updateSetting('maxRetries', Math.max(1, Math.min(10, parseInt(e.target.value) || 3)))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
            <p className="text-[10px] text-zinc-500">Automatic retries on transient errors (1-10).</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Retry Backoff Base (ms)
            </label>
            <input
              type="number"
              step={500}
              min={100}
              max={10000}
              value={settings.retryBackoffMs}
              onChange={(e) => updateSetting('retryBackoffMs', Math.max(100, parseInt(e.target.value) || 1000))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
            <p className="text-[10px] text-zinc-500">Initial delay before retrying an operation.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Backoff Multiplier
            </label>
            <input
              type="number"
              step={0.5}
              min={1.1}
              max={5}
              value={settings.retryMultiplier}
              onChange={(e) => updateSetting('retryMultiplier', Math.max(1.1, parseFloat(e.target.value) || 2))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
            <p className="text-[10px] text-zinc-500">Exponential backoff factor per retry attempt.</p>
          </div>
        </div>
      </div>

      {/* Section 4: Tool Execution Timeouts */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-zinc-800/80 pb-3 text-cyan-400">
          <Clock className="h-4 w-4" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-white">Tool Execution Timeouts (ms)</h4>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Default Tool Timeout
            </label>
            <input
              type="number"
              step={5000}
              min={1000}
              value={settings.toolTimeoutDefault}
              onChange={(e) => updateSetting('toolTimeoutDefault', Math.max(1000, parseInt(e.target.value) || 30000))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Bash / Shell Timeout
            </label>
            <input
              type="number"
              step={5000}
              min={1000}
              value={settings.toolTimeoutBash}
              onChange={(e) => updateSetting('toolTimeoutBash', Math.max(1000, parseInt(e.target.value) || 30000))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              File Operations Timeout
            </label>
            <input
              type="number"
              step={5000}
              min={1000}
              value={settings.toolTimeoutFileops}
              onChange={(e) => updateSetting('toolTimeoutFileops', Math.max(1000, parseInt(e.target.value) || 15000))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Glob / Search Timeout
            </label>
            <input
              type="number"
              step={1000}
              min={1000}
              value={settings.toolTimeoutGlob}
              onChange={(e) => updateSetting('toolTimeoutGlob', Math.max(1000, parseInt(e.target.value) || 10000))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Grep Regex Timeout
            </label>
            <input
              type="number"
              step={5000}
              min={1000}
              value={settings.toolTimeoutGrep}
              onChange={(e) => updateSetting('toolTimeoutGrep', Math.max(1000, parseInt(e.target.value) || 30000))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Sub-Agent Timeout
            </label>
            <input
              type="number"
              step={10000}
              min={5000}
              value={settings.toolTimeoutSubagent}
              onChange={(e) => updateSetting('toolTimeoutSubagent', Math.max(5000, parseInt(e.target.value) || 120000))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Section 5: Logging & Diagnostics */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-zinc-800/80 pb-3 text-cyan-400">
          <Terminal className="h-4 w-4" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-white">Logging &amp; Diagnostics</h4>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Log Level
            </label>
            <select
              value={settings.logLevel}
              onChange={(e) => updateSetting('logLevel', e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
            >
              <option value="debug">debug (Most verbose)</option>
              <option value="info">info (Standard)</option>
              <option value="warn">warn (Warnings &amp; errors only)</option>
              <option value="error">error (Errors only)</option>
            </select>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3.5">
            <div>
              <div className="text-xs font-medium text-white">Debug Mode</div>
              <div className="text-[10px] text-zinc-500">Output extra debug traces</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.debug}
              onClick={() => updateSetting('debug', !settings.debug)}
              className={`relative h-5 w-9 shrink-0 rounded-full transition ${settings.debug ? 'bg-cyan-500' : 'bg-zinc-700'}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${settings.debug ? 'left-4.5' : 'left-0.5'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3.5">
            <div>
              <div className="text-xs font-medium text-white">Verbose ReAct</div>
              <div className="text-[10px] text-zinc-500">Print detailed reasoning steps</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.reactVerbose}
              onClick={() => updateSetting('reactVerbose', !settings.reactVerbose)}
              className={`relative h-5 w-9 shrink-0 rounded-full transition ${settings.reactVerbose ? 'bg-cyan-500' : 'bg-zinc-700'}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${settings.reactVerbose ? 'left-4.5' : 'left-0.5'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3.5">
            <div>
              <div className="text-xs font-medium text-white">Application Logging</div>
              <div className="text-[10px] text-zinc-500">Write logs to SQLite database</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.enableLogging}
              onClick={() => updateSetting('enableLogging', !settings.enableLogging)}
              className={`relative h-5 w-9 shrink-0 rounded-full transition ${settings.enableLogging ? 'bg-cyan-500' : 'bg-zinc-700'}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${settings.enableLogging ? 'left-4.5' : 'left-0.5'}`} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
