import React, { useEffect, useState } from 'react';
import { LayoutTemplate, MonitorSmartphone } from 'lucide-react';
import {
  DEFAULT_INTERFACE_DISPLAY_PREFERENCES,
  INTERFACE_DISPLAY_EVENT,
  readInterfaceDisplayPreferences,
  writeInterfaceDisplayPreferences,
  type ChatMessageFormat,
  type ChatViewDensity,
} from '../utils/interfaceDisplayPreferences';

const formatOptions: Array<{ value: ChatMessageFormat; label: string; description: string }> = [
  {
    value: 'streamlined',
    label: 'Streamlined',
    description: 'Concise action rows for scanning agent work quickly.',
  },
  {
    value: 'rotating',
    label: 'Rotating Carousel',
    description: 'One focused step at a time with controls for history and details.',
  },
  {
    value: 'chat_text',
    label: 'Chat List',
    description: 'The full chronological event cards and expanded chat transcript.',
  },
];

const densityOptions: Array<{ value: ChatViewDensity; label: string; description: string }> = [
  {
    value: 'compact',
    label: 'Compact',
    description: 'Reduced padding and smaller event rows for more activity on screen.',
  },
  {
    value: 'detailed',
    label: 'Detailed',
    description: 'Comfortable spacing and full event cards for easier reading.',
  },
];

export function AppearanceSettingsPanel() {
  const [preferences, setPreferences] = useState(readInterfaceDisplayPreferences);

  useEffect(() => {
    const handlePreferenceChange = (event: Event) => {
      const detail = (event as CustomEvent<typeof preferences>).detail;
      if (detail) setPreferences(detail);
    };
    window.addEventListener(INTERFACE_DISPLAY_EVENT, handlePreferenceChange);
    return () => window.removeEventListener(INTERFACE_DISPLAY_EVENT, handlePreferenceChange);
  }, []);

  const setFormat = (chatMessageFormat: ChatMessageFormat) => {
    setPreferences(writeInterfaceDisplayPreferences({ chatMessageFormat }));
  };

  const setDensity = (chatDensity: ChatViewDensity) => {
    setPreferences(writeInterfaceDisplayPreferences({ chatDensity }));
  };

  const resetPreferences = () => {
    setPreferences(writeInterfaceDisplayPreferences(DEFAULT_INTERFACE_DISPLAY_PREFERENCES));
  };

  return (
    <section className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-white">Interface &amp; Display</h3>
        <p className="mt-1 text-xs text-zinc-400">
          Choose how the active Coder Chat presents the same run events. These preferences do not change execution, approvals, or provider routing.
        </p>
      </div>

      <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="flex items-center gap-2 border-b border-zinc-800/80 pb-3 text-cyan-400">
          <LayoutTemplate className="h-4 w-4" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-white">Chat Layout Style</h4>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {formatOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={preferences.chatMessageFormat === option.value}
              data-testid={`interface-display-format-${option.value}`}
              onClick={() => setFormat(option.value)}
              className={`flex flex-col items-start rounded-lg border p-4 text-left transition-all ${
                preferences.chatMessageFormat === option.value
                  ? 'border-cyan-500/50 bg-cyan-500/10'
                  : 'border-zinc-800 bg-zinc-950/50 hover:border-zinc-700 hover:bg-zinc-900'
              }`}
            >
              <span className={`text-sm font-medium ${preferences.chatMessageFormat === option.value ? 'text-cyan-400' : 'text-zinc-200'}`}>
                {option.label}
              </span>
              <span className="mt-1.5 text-xs leading-relaxed text-zinc-500">{option.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="flex items-center gap-2 border-b border-zinc-800/80 pb-3 text-cyan-400">
          <MonitorSmartphone className="h-4 w-4" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-white">Display Density</h4>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {densityOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={preferences.chatDensity === option.value}
              data-testid={`interface-display-density-${option.value}`}
              onClick={() => setDensity(option.value)}
              className={`flex flex-col items-start rounded-lg border p-4 text-left transition-all ${
                preferences.chatDensity === option.value
                  ? 'border-cyan-500/50 bg-cyan-500/10'
                  : 'border-zinc-800 bg-zinc-950/50 hover:border-zinc-700 hover:bg-zinc-900'
              }`}
            >
              <span className={`text-sm font-medium ${preferences.chatDensity === option.value ? 'text-cyan-400' : 'text-zinc-200'}`}>
                {option.label}
              </span>
              <span className="mt-1.5 text-xs leading-relaxed text-zinc-500">{option.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-white">Restore defaults</h4>
          <p className="mt-1 text-xs text-zinc-500">Reset presentation preferences only; active runs and execution settings are unchanged.</p>
        </div>
        <button
          type="button"
          data-testid="interface-display-reset"
          onClick={resetPreferences}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-cyan-500/50 hover:text-cyan-300"
        >
          Reset to defaults
        </button>
      </div>
    </section>
  );
}
