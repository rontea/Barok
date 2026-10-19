import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Database,
  Eye,
  FileText,
  FolderSearch,
  Globe2,
  Loader2,
  Pencil,
  Save,
} from 'lucide-react';
import { Button, Input } from './FormComponents';

interface KnowledgeLookupSettings {
  sampleLookupEnabled: boolean;
  sampleFolder: string;
  wikiLookupEnabled: boolean;
  wikiFolder: string;
  webSearchEnabled: boolean;
}

interface KnowledgeSettingsPanelProps {
  workspace: string;
}

interface WorkspaceGuide {
  reference: string;
  projectPath: string;
  content: string;
  exists: boolean;
  enabled: boolean;
  updatedAt?: number;
}

const DEFAULT_SETTINGS: KnowledgeLookupSettings = {
  sampleLookupEnabled: false,
  sampleFolder: '.react-engine/samples',
  wikiLookupEnabled: false,
  wikiFolder: 'wiki',
  webSearchEnabled: true,
};

const GUIDE_TEMPLATE = `# Project Specification

## Product goal

Describe what the agent should build and who it is for.

## Core behavior

- List the required user flows.
- Describe important interactions and system behavior.
- Note anything that must not be changed.

## Visual direction

Describe the layout, style, responsive behavior, and any reference screenshots.

## Acceptance criteria

- Add measurable completion requirements.
- Include required tests and verification steps.
`;

function GuidePreview({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  return (
    <article className="min-h-[28rem] space-y-3 overflow-auto rounded-xl border border-zinc-800 bg-white px-6 py-7 text-zinc-900 sm:px-10">
      {lines.map((line, index) => {
        const key = `${index}-${line.slice(0, 24)}`;
        if (!line.trim()) return <div key={key} className="h-1" />;
        if (line.startsWith('### ')) return <h3 key={key} className="pt-2 text-lg font-bold">{line.slice(4)}</h3>;
        if (line.startsWith('## ')) return <h2 key={key} className="pt-3 text-xl font-bold">{line.slice(3)}</h2>;
        if (line.startsWith('# ')) return <h1 key={key} className="pb-2 text-3xl font-bold tracking-tight">{line.slice(2)}</h1>;
        if (/^[-*]\s+/.test(line)) {
          return <div key={key} className="flex gap-3 pl-2 leading-7"><span>•</span><span>{line.replace(/^[-*]\s+/, '')}</span></div>;
        }
        if (/^\d+\.\s+/.test(line)) {
          const marker = line.match(/^\d+\./)?.[0];
          return <div key={key} className="flex gap-3 font-semibold leading-7"><span>{marker}</span><span>{line.replace(/^\d+\.\s+/, '')}</span></div>;
        }
        return <p key={key} className="whitespace-pre-wrap leading-7 text-zinc-700">{line}</p>;
      })}
    </article>
  );
}

function FeatureToggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
      <span>
        <span className="block text-sm font-semibold text-zinc-100">{label}</span>
        <span className="mt-1 block text-xs leading-relaxed text-zinc-500">{description}</span>
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="h-6 w-11 rounded-full bg-zinc-700 transition-colors peer-checked:bg-cyan-600 peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-400" />
        <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export function KnowledgeSettingsPanel({ workspace }: KnowledgeSettingsPanelProps) {
  const [settings, setSettings] = useState<KnowledgeLookupSettings>(DEFAULT_SETTINGS);
  const [guide, setGuide] = useState<WorkspaceGuide | null>(null);
  const [guideContent, setGuideContent] = useState('');
  const [savedGuideContent, setSavedGuideContent] = useState('');
  const [guideEnabled, setGuideEnabled] = useState(false);
  const [savedGuideEnabled, setSavedGuideEnabled] = useState(false);
  const [guideMode, setGuideMode] = useState<'edit' | 'preview'>('edit');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingGuide, setSavingGuide] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setMessage(null);
      try {
        const query = workspace.trim()
          ? `?workspace=${encodeURIComponent(workspace.trim())}`
          : '';
        const [settingsResponse, guideResponse] = await Promise.all([
          fetch(`/api/knowledge-settings${query}`),
          fetch(`/api/workspace-guide${query}`),
        ]);
        const [settingsData, guideData] = await Promise.all([
          settingsResponse.json().catch(() => ({})),
          guideResponse.json().catch(() => ({})),
        ]);
        if (!settingsResponse.ok) throw new Error(settingsData.error || 'Could not load knowledge settings.');
        if (!guideResponse.ok) throw new Error(guideData.error || 'Could not load the project guide.');
        if (active) {
          const loadedGuide = guideData.guide as WorkspaceGuide;
          const initialContent = loadedGuide.exists ? loadedGuide.content : GUIDE_TEMPLATE;
          setSettings({ ...DEFAULT_SETTINGS, ...settingsData.settings });
          setGuide(loadedGuide);
          setGuideContent(initialContent);
          setSavedGuideContent(initialContent);
          setGuideEnabled(loadedGuide.enabled === true);
          setSavedGuideEnabled(loadedGuide.enabled === true);
        }
      } catch (error) {
        if (active) {
          setMessage({
            type: 'error',
            text: error instanceof Error ? error.message : 'Could not load knowledge settings.',
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [workspace]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/knowledge-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace: workspace.trim() || undefined,
          settings,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not save knowledge settings.');
      setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
      setMessage({ type: 'success', text: 'Knowledge lookup settings saved for this workspace.' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Could not save knowledge settings.',
      });
    } finally {
      setSaving(false);
    }
  };

  const saveGuide = async () => {
    setSavingGuide(true);
    setMessage(null);
    try {
      const response = await fetch('/api/workspace-guide', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace: workspace.trim() || undefined,
          content: guideContent,
          enabled: guideEnabled,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not save the project guide.');
      setGuide(data.guide);
      setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
      setSavedGuideContent(data.guide.content);
      setGuideEnabled(data.guide.enabled !== false);
      setSavedGuideEnabled(data.guide.enabled !== false);
      setMessage({
        type: 'success',
        text: data.guide.enabled
          ? `Project guide saved as ${data.guide.projectPath} and enabled for the agent.`
          : `Project guide saved as ${data.guide.projectPath} and disabled for the agent.`,
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Could not save the project guide.',
      });
    } finally {
      setSavingGuide(false);
    }
  };

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FolderSearch className="h-5 w-5 text-cyan-400" />
            <h2 className="text-lg font-bold text-white">Agent Resources</h2>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
            Control which project-local references and external lookup tools the agent can use.
            These settings are saved independently for the active workspace.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => void save()}
          disabled={loading || saving}
          icon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        >
          {saving ? 'Saving' : 'Save settings'}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading workspace settings…
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/20 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <Database className="h-4 w-4 text-indigo-400" />
              Sample repository
            </div>
            <FeatureToggle
              checked={settings.sampleLookupEnabled}
              onChange={(sampleLookupEnabled) =>
                setSettings((current) => ({ ...current, sampleLookupEnabled }))
              }
              label="Enable sample lookup"
              description="Allow the Sample tool to add, list, search, and retrieve reusable project examples."
            />
            <Input
              label="Sample folder"
              value={settings.sampleFolder}
              onChange={(event) =>
                setSettings((current) => ({ ...current, sampleFolder: event.target.value }))
              }
              placeholder=".react-engine/samples"
              disabled={!settings.sampleLookupEnabled}
            />
            <p className="text-xs text-zinc-600">
              Agent references use the format <code className="text-zinc-400">sample:&lt;id&gt;</code>.
            </p>
          </div>

          <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/20 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <BookOpen className="h-4 w-4 text-emerald-400" />
              User wiki
            </div>
            <FeatureToggle
              checked={settings.wikiLookupEnabled}
              onChange={(wikiLookupEnabled) =>
                setSettings((current) => ({ ...current, wikiLookupEnabled }))
              }
              label="Enable wiki lookup"
              description="Allow the read-only Wiki tool to list, search, and open Markdown pages created by users."
            />
            <Input
              label="Wiki folder"
              value={settings.wikiFolder}
              onChange={(event) =>
                setSettings((current) => ({ ...current, wikiFolder: event.target.value }))
              }
              placeholder="wiki"
              disabled={!settings.wikiLookupEnabled}
            />
            <p className="text-xs text-zinc-600">
              Add <code className="text-zinc-400">.md</code> files in this folder. References use{' '}
              <code className="text-zinc-400">wiki:&lt;page-path&gt;</code>.
            </p>
          </div>

          <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/20 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <Globe2 className="h-4 w-4 text-sky-400" />
              Web search
            </div>
            <FeatureToggle
              checked={settings.webSearchEnabled}
              onChange={(webSearchEnabled) =>
                setSettings((current) => ({ ...current, webSearchEnabled }))
              }
              label="Enable web search"
              description="Allow the agent to search the public web through Tavily for current facts, documentation, news, and source URLs."
            />
            <p className="text-xs leading-relaxed text-zinc-600">
              Requires <code className="text-zinc-400">TAVILY_API_KEY</code> on the server. When disabled,
              WebSearch is blocked before any network request is made.
            </p>
          </div>
        </div>
      )}

      {!loading && guide && (
        <div className="mt-6 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/30">
          <div className="flex flex-col gap-4 border-b border-zinc-800 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <FileText className="h-4 w-4 text-amber-400" />
                Project guide
                {(guideContent !== savedGuideContent || guideEnabled !== savedGuideEnabled) && (
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                    Unsaved
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                Paste or maintain the working specification here. Saving writes{' '}
                <code className="text-zinc-300">{guide.projectPath}</code>; the agent can read it as{' '}
                <code className="text-emerald-300">{guide.reference}</code>.
              </p>
              <div className="mt-3 max-w-xl">
                <FeatureToggle
                  checked={guideEnabled}
                  onChange={setGuideEnabled}
                  label="Enable project guide"
                  description="When enabled, the agent can retrieve wiki:project-specification. Turning this off keeps the Markdown file but hides it from the Wiki tool."
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-1">
                <button
                  type="button"
                  onClick={() => setGuideMode('edit')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${guideMode === 'edit' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-200'}`}
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => setGuideMode('preview')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${guideMode === 'preview' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-200'}`}
                >
                  <Eye className="h-3.5 w-3.5" /> Preview
                </button>
              </div>
              <Button
                variant="primary"
                onClick={() => void saveGuide()}
                disabled={savingGuide || (guideContent === savedGuideContent && guideEnabled === savedGuideEnabled)}
                icon={savingGuide ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              >
                {savingGuide ? 'Saving' : 'Save guide'}
              </Button>
            </div>
          </div>

          <div className="p-4">
            {guideMode === 'edit' ? (
              <textarea
                aria-label="Project guide Markdown"
                value={guideContent}
                onChange={(event) => setGuideContent(event.target.value)}
                spellCheck
                className="min-h-[28rem] w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-5 py-4 font-mono text-sm leading-7 text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600"
                placeholder="Paste a Markdown project specification here…"
              />
            ) : (
              <GuidePreview content={guideContent} />
            )}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-600">
              <span>{guideContent.length.toLocaleString()} / 500,000 characters</span>
              <span>{guide.exists && guide.updatedAt ? `Last saved ${new Date(guide.updatedAt).toLocaleString()}` : 'Not saved yet'}</span>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div
          className={`mt-5 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/20 bg-red-500/10 text-red-300'
          }`}
        >
          {message.type === 'success'
            ? <CheckCircle2 className="h-4 w-4 shrink-0" />
            : <AlertCircle className="h-4 w-4 shrink-0" />}
          {message.text}
        </div>
      )}
    </section>
  );
}
