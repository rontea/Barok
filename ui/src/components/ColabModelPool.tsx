import React, { useEffect, useState } from "react";
import { CheckCircle2, Cpu, Loader2, Plus, Save, Trash2, XCircle } from "lucide-react";

interface ColabEndpoint {
  id: string;
  title: string;
  baseUrl: string;
  modelId: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  source?: "settings" | "environment";
}

interface ColabTestState {
  status: "loading" | "healthy" | "error";
  message: string;
  details?: string;
}

function createColabEndpoint(index = 0): ColabEndpoint {
  const now = Date.now();
  return {
    id: `colab-model-${now}-${index + 1}`,
    title: index === 0 ? "Free Colab model" : `Free Colab model ${index + 1}`,
    baseUrl: "",
    modelId: "",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

export const ColabModelPool: React.FC = () => {
  const [endpoints, setEndpoints] = useState<ColabEndpoint[]>([createColabEndpoint()]);
  const [tests, setTests] = useState<Record<string, ColabTestState>>({});
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadEndpoints = async () => {
    try {
      const response = await fetch("/api/colab/endpoints");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load Colab model endpoints");
      setEndpoints(Array.isArray(data.endpoints) && data.endpoints.length > 0 ? data.endpoints : [createColabEndpoint()]);
      setDirty(false);
      setError(null);
    } catch (loadError: any) {
      setError(loadError?.message || "Failed to load Colab model endpoints");
    }
  };

  useEffect(() => {
    void loadEndpoints();
  }, []);

  const updateEndpoint = (index: number, updates: Partial<ColabEndpoint>) => {
    setEndpoints((current) => current.map((endpoint, endpointIndex) =>
      endpointIndex === index ? { ...endpoint, ...updates, updatedAt: Date.now() } : endpoint,
    ));
    setDirty(true);
  };

  const saveEndpoints = async (nextEndpoints = endpoints) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/colab/endpoints", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoints: nextEndpoints }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save Colab model endpoints");
      setEndpoints(Array.isArray(data.endpoints) ? data.endpoints : nextEndpoints);
      setDirty(false);
      window.dispatchEvent(new CustomEvent("provider-model-targets-updated"));
    } catch (saveError: any) {
      setError(saveError?.message || "Failed to save Colab model endpoints");
    } finally {
      setSaving(false);
    }
  };

  const testEndpoint = async (index: number) => {
    const endpoint = endpoints[index];
    if (!endpoint) return;
    setTests((current) => ({
      ...current,
      [endpoint.id]: { status: "loading", message: "Discovering models and testing the Colab route..." },
    }));
    try {
      const response = await fetch("/api/colab/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Colab model test failed");
      const runtimeContextWindow = Number(data.runtimeContextWindow);
      const recommendedInputTokenLimit = Number(data.recommendedInputTokenLimit);
      const hasRuntimeContext = Number.isFinite(runtimeContextWindow) && runtimeContextWindow >= 1_024;
      const hasRecommendedInputLimit = Number.isFinite(recommendedInputTokenLimit) && recommendedInputTokenLimit >= 512;
      const testedEndpoint = {
        ...endpoint,
        modelId: typeof data.model === "string" && data.model.trim() ? data.model.trim() : endpoint.modelId,
        ...(hasRuntimeContext ? {
          contextWindow: Math.floor(runtimeContextWindow),
          runtimeContextWindow: Math.floor(runtimeContextWindow),
        } : {}),
        ...(hasRecommendedInputLimit ? {
          inputTokenLimit: Math.min(endpoint.inputTokenLimit || Math.floor(recommendedInputTokenLimit), Math.floor(recommendedInputTokenLimit)),
        } : {}),
        updatedAt: Date.now(),
      };
      const nextEndpoints = endpoints.map((current, endpointIndex) => endpointIndex === index ? testedEndpoint : current);
      await saveEndpoints(nextEndpoints);
      setTests((current) => ({
        ...current,
        [endpoint.id]: {
          status: "healthy",
          message: `${data.message || "Colab model route responded successfully."} Saved to Model Target.`,
          details: `${data.endpoint || endpoint.baseUrl} · ${data.model || endpoint.modelId}${Array.isArray(data.models) ? ` · ${data.models.length} model(s) discovered` : ""}${data.discoveryWarning ? ` · Discovery warning: ${data.discoveryWarning}` : ""}`,
        },
      }));
    } catch (testError: any) {
      setTests((current) => ({
        ...current,
        [endpoint.id]: { status: "error", message: testError?.message || "Colab model test failed" },
      }));
    }
  };

  return (
    <section id="colab-model-pool" className="scroll-mt-24 rounded-xl border border-border-main bg-bg-panel p-6">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-orange-500/10 p-2.5 text-orange-400"><Cpu className="h-4 w-4" /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">Colab model pool</h3>
              <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-300">Free / no API key</span>
            </div>
            <p className="mt-1 text-xs text-text-dim">
              Paste a public Colab tunnel such as ngrok or Cloudflare. Include <code>/v1</code> or leave it off; the route is normalized automatically. Leave Model ID blank to discover the free notebook model.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setEndpoints((current) => [...current, createColabEndpoint(current.length)]); setDirty(true); }} className="flex items-center gap-1.5 rounded border border-orange-500/30 bg-orange-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-orange-300 transition hover:bg-orange-500/20">
            <Plus className="h-3.5 w-3.5" /> Add Colab model
          </button>
          <button type="button" onClick={() => void saveEndpoints()} disabled={saving || !dirty} className="flex items-center gap-1.5 rounded bg-orange-400 px-4 py-2 text-xs font-bold uppercase tracking-wider text-black transition hover:bg-orange-300 disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save routes
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded border border-rose-500/20 bg-rose-950/10 p-3 text-sm text-rose-300">{error}</div>}

      <div className="mb-4 grid gap-2 rounded border border-orange-500/20 bg-orange-950/10 p-3 text-[10px] text-orange-100 sm:grid-cols-3">
        <div><strong className="text-orange-300">1. Paste URL</strong><br />Use the current public tunnel from your Colab notebook.</div>
        <div><strong className="text-orange-300">2. Leave model blank</strong><br />Discovery reads <code>/v1/models</code> for you.</div>
        <div><strong className="text-orange-300">3. Discover &amp; Test</strong><br />A successful test saves a selectable Model Target.</div>
      </div>

      <div className="space-y-3">
        {endpoints.map((endpoint, index) => {
          const test = tests[endpoint.id];
          return (
            <div key={endpoint.id} className="rounded border border-border-main bg-bg-main/40 p-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1.4fr_1fr_auto]">
                <label className="text-[10px] font-bold uppercase tracking-wider text-text-dim">Display name
                  <input value={endpoint.title} onChange={(event) => updateEndpoint(index, { title: event.target.value })} placeholder="Colab model" className="mt-1.5 w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-xs normal-case tracking-normal text-white outline-none focus:border-orange-500/60" />
                </label>
                <label className="text-[10px] font-bold uppercase tracking-wider text-text-dim">Public Colab tunnel URL
                  <input type="url" value={endpoint.baseUrl} onChange={(event) => updateEndpoint(index, { baseUrl: event.target.value })} placeholder="https://your-tunnel.ngrok-free.app/v1" className="mt-1.5 w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-xs normal-case tracking-normal text-white outline-none focus:border-orange-500/60" />
                </label>
                <label className="text-[10px] font-bold uppercase tracking-wider text-text-dim">Model ID
                  <input value={endpoint.modelId} onChange={(event) => updateEndpoint(index, { modelId: event.target.value })} placeholder="Leave blank — discover automatically" className="mt-1.5 w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-xs normal-case tracking-normal text-white outline-none focus:border-orange-500/60" />
                </label>
                <div className="flex items-end gap-2">
                  <button type="button" onClick={() => void testEndpoint(index)} disabled={test?.status === "loading" || !endpoint.baseUrl.trim()} className="rounded border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-orange-300 transition hover:bg-orange-500/20 disabled:opacity-50">
                    {test?.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Discover & Add"}
                  </button>
                  <button type="button" onClick={() => { setEndpoints((current) => current.filter((_, endpointIndex) => endpointIndex !== index)); setDirty(true); }} className="rounded border border-rose-500/20 bg-rose-950/10 p-2 text-rose-300 transition hover:bg-rose-950/30" title="Remove Colab model route"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-text-dim"><input type="checkbox" checked={endpoint.enabled} onChange={(event) => updateEndpoint(index, { enabled: event.target.checked })} className="accent-orange-400" /> Available in Model Target</label>
                {endpoint.source === "environment" && <span className="rounded border border-cyan-500/20 bg-cyan-950/20 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-cyan-300">Loaded from COLAB_MODEL_*</span>}
              </div>
              {test && <div className={`mt-3 rounded border p-3 ${test.status === "healthy" ? "border-cyan-500/20 bg-cyan-950/5" : test.status === "error" ? "border-rose-500/20 bg-rose-950/10" : "border-cyan-500/20 bg-cyan-950/10"}`}><div className="flex items-start gap-3">{test.status === "healthy" ? <CheckCircle2 className="h-4 w-4 text-cyan-400" /> : test.status === "error" ? <XCircle className="h-4 w-4 text-rose-400" /> : <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />}<div><p className="text-xs font-bold text-white">{test.message}</p>{test.details && <p className="mt-1 font-mono text-[10px] text-text-dim">{test.details}</p>}</div></div></div>}
            </div>
          );
        })}
      </div>
    </section>
  );
};
