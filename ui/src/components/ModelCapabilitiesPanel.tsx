import React from "react";
import { BrainCircuit, Braces, CheckCircle2, CircleHelp, Database, Eye, Network, Radio, Wrench, Zap } from "lucide-react";

type CapabilityValue = "yes" | "no" | "unknown";
type Architecture = "MoE" | "Dense" | "Unknown";

interface ModelCapabilityProfile {
  provider: string;
  modelId: string;
  label: string;
  description?: string;
  architecture: Architecture;
  capabilities: Record<string, CapabilityValue>;
  contextWindow?: number;
  engineUsage: {
    reasoning: "react-planner" | "provider-native" | "unknown";
    toolCalling: "native" | "structured-text" | "unknown";
    architecture: "automatic";
  };
  notes: string[];
}

interface ModelCapabilitiesPanelProps {
  selectedModel?: string;
}

const CAPABILITY_LABELS: Array<{ key: string; label: string; icon: React.ReactNode }> = [
  { key: "reasoning", label: "Reasoning", icon: <BrainCircuit className="h-3.5 w-3.5" /> },
  { key: "toolCalling", label: "Tools", icon: <Wrench className="h-3.5 w-3.5" /> },
  { key: "vision", label: "Vision", icon: <Eye className="h-3.5 w-3.5" /> },
  { key: "streaming", label: "Streaming", icon: <Radio className="h-3.5 w-3.5" /> },
  { key: "coding", label: "Coding", icon: <Zap className="h-3.5 w-3.5" /> },
  { key: "longContext", label: "Long context", icon: <Database className="h-3.5 w-3.5" /> },
  { key: "structuredOutput", label: "Structured", icon: <Braces className="h-3.5 w-3.5" /> },
];

const valueStyles: Record<CapabilityValue, string> = {
  yes: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  no: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  unknown: "border-zinc-700 bg-zinc-900 text-zinc-500",
};

function CapabilityBadge({ label, value, icon }: { label: string; value: CapabilityValue; icon?: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-[10px] ${valueStyles[value]}`}>
      {icon}
      {label}: {value === "yes" ? "YES" : value === "no" ? "NO" : "UNKNOWN"}
    </span>
  );
}

function formatContextWindow(value?: number): string {
  if (!value) return "Context: unknown";
  if (value >= 1_000_000) return "Context: 1M+";
  if (value >= 1_000) return `Context: ${Math.round(value / 1_000)}K`;
  return `Context: ${value}`;
}

export function ModelCapabilitiesPanel({ selectedModel }: ModelCapabilitiesPanelProps) {
  const [profiles, setProfiles] = React.useState<ModelCapabilityProfile[]>([]);
  const [selected, setSelected] = React.useState<ModelCapabilityProfile | undefined>();
  const [usage, setUsage] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = selectedModel?.trim() ? `?model=${encodeURIComponent(selectedModel.trim())}` : "";
      const response = await fetch(`/api/model-capabilities${query}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load model capabilities.");
      setProfiles(Array.isArray(data.profiles) ? data.profiles : []);
      setSelected(data.selected);
      setUsage(data.usage && typeof data.usage === "object" ? data.usage : {});
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load model capabilities.");
    } finally {
      setLoading(false);
    }
  }, [selectedModel]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-xl border border-border-main bg-bg-panel p-6">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white">
            <Network className="h-4 w-4 text-cyan-400" />
            Model capabilities
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-text-dim">
            Catalogued capabilities for selectable models. “Unknown” means the provider does not advertise that feature; it is not an assumption that the model lacks it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="self-start rounded border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300 transition hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh catalog"}
        </button>
      </div>

      {selectedModel && (
        <div className="mb-5 rounded border border-cyan-500/30 bg-cyan-950/20 p-4">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-cyan-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Current model
          </div>
          <div className="mt-2 font-mono text-sm text-white">{selectedModel}</div>
          {selected && (
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={`rounded border px-2 py-1 font-mono text-[10px] font-bold ${selected.architecture === "MoE" ? "border-violet-500/30 bg-violet-500/10 text-violet-300" : "border-zinc-700 bg-zinc-900 text-zinc-400"}`}>
                Architecture: {selected.architecture}
              </span>
              {CAPABILITY_LABELS.map((item) => (
                <CapabilityBadge key={item.key} label={item.label} value={selected.capabilities[item.key] || "unknown"} icon={item.icon} />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Reasoning", usage.reasoning],
          ["Tool calling", usage.toolCalling],
          ["Architecture", usage.architecture],
          ["Vision / streaming", usage.vision && usage.streaming ? `${usage.vision} ${usage.streaming}` : undefined],
        ].map(([label, description]) => (
          <div key={label} className="rounded border border-border-main bg-bg-main/40 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-text-dim">{label}</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">{description || "Capability wiring is documented by the runtime."}</p>
          </div>
        ))}
      </div>

      {error && <div className="mb-4 rounded border border-rose-500/20 bg-rose-950/10 p-3 text-xs text-rose-300">{error}</div>}

      {loading && profiles.length === 0 ? (
        <div className="rounded border border-border-main bg-bg-main/40 p-6 text-center text-sm text-text-dim">Loading model capability catalog...</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {profiles.map((profile) => (
            <article key={`${profile.provider}:${profile.modelId}`} className="rounded border border-border-main bg-bg-main/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">{profile.label}</h3>
                    <span className="rounded border border-cyan-500/20 bg-cyan-950/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-cyan-300">{profile.provider}</span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[10px] text-text-dim" title={profile.modelId}>{profile.modelId}</p>
                </div>
                <span className={`rounded border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider ${profile.architecture === "MoE" ? "border-violet-500/30 bg-violet-500/10 text-violet-300" : "border-zinc-700 bg-zinc-900 text-zinc-500"}`}>
                  {profile.architecture === "Unknown" ? "Architecture unknown" : profile.architecture}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {CAPABILITY_LABELS.map((item) => (
                  <CapabilityBadge key={item.key} label={item.label} value={profile.capabilities[item.key] || "unknown"} icon={item.icon} />
                ))}
                <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[10px] text-zinc-400">{formatContextWindow(profile.contextWindow)}</span>
              </div>

              <div className="mt-3 grid gap-1 text-[10px] text-text-dim">
                <span><strong className="text-zinc-300">Reasoning wiring:</strong> {profile.engineUsage.reasoning === "react-planner" ? "ReAct planner + thinking depth" : profile.engineUsage.reasoning}</span>
                <span><strong className="text-zinc-300">Tool wiring:</strong> {profile.engineUsage.toolCalling === "native" ? "Provider-native tools" : profile.engineUsage.toolCalling === "structured-text" ? "Structured JSON action protocol" : "Unknown; safe structured protocol"}</span>
                <span><strong className="text-zinc-300">Architecture:</strong> automatic inside the model</span>
              </div>

              {profile.description && <p className="mt-3 text-xs leading-relaxed text-slate-400">{profile.description}</p>}
            </article>
          ))}
        </div>
      )}

      <p className="mt-5 flex items-start gap-2 text-[10px] leading-relaxed text-text-dark">
        <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Reasoning and tool support are runtime-wired. MoE/Dense is an architecture label: the selected model uses it automatically, while the application cannot force or disable it.
      </p>
    </section>
  );
}
