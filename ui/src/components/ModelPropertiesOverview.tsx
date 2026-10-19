import React from "react";
import { Braces, Database, Info, Network, Settings2 } from "lucide-react";

type CapabilityValue = "yes" | "no" | "unknown";

export interface ModelPropertyRoute {
  provider: string;
  modelId: string;
  label: string;
  description?: string;
  architecture: "MoE" | "Dense" | "Unknown";
  capabilities: Record<string, CapabilityValue>;
  contextWindow?: number;
  apiFamily?: string;
  endpoint?: string;
  baseApi?: string;
  routeId?: string;
  credentialIndex?: number;
  inputModalities?: string[];
  outputModalities?: string[];
  defaultParams?: Record<string, number | undefined>;
  configuredParams?: Record<string, number | boolean | undefined>;
  maxOutputTokens?: number;
  supportsSamplingParameters?: boolean;
  freeTier?: boolean;
  source?: string;
  notes?: string[];
}

export interface ModelPropertiesApi {
  provider: string;
  label: string;
  baseApi?: string;
  routes: ModelPropertyRoute[];
  note?: string;
}

interface ModelPropertiesOverviewProps {
  apis: ModelPropertiesApi[];
  loading?: boolean;
  error?: string | null;
}

function formatLimit(value?: number): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toLocaleString()} tokens` : "Unknown";
}

function formatList(value?: string[]): string {
  return value && value.length > 0 ? value.join(", ") : "Unknown";
}

function formatParams(value?: Record<string, number | boolean | undefined>): string {
  if (!value) return "Unknown";
  const entries = Object.entries(value).filter(([, item]) => typeof item === "number" || typeof item === "boolean");
  return entries.length > 0 ? entries.map(([key, item]) => `${key}=${item}`).join(" · ") : "Unknown";
}

function sourceLabel(source?: string): string {
  if (source === "provider-registry") return "Registry";
  if (source === "provider-catalog") return "Provider catalog";
  if (source === "configured-route") return "Configured route";
  return "Unknown source";
}

function Property({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border-main bg-bg-main/50 p-2">
      <div className="text-[9px] font-bold uppercase tracking-wider text-text-dark">{label}</div>
      <div className="mt-1 break-words font-mono text-[10px] text-slate-300">{value}</div>
    </div>
  );
}

function Capability({ label, value }: { label: string; value?: CapabilityValue }) {
  const normalized = value || "unknown";
  const colors = normalized === "yes"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    : normalized === "no"
      ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
      : "border-zinc-700 bg-zinc-900 text-zinc-500";
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${colors}`}>
      {label}: {normalized.toUpperCase()}
    </span>
  );
}

function ModelRouteCard({ route }: { route: ModelPropertyRoute }) {
  return (
    <article className="rounded border border-border-main bg-bg-main/35 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h5 className="text-xs font-bold text-white">{route.label}</h5>
            <span className="rounded border border-cyan-500/20 bg-cyan-950/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-cyan-300">
              {sourceLabel(route.source)}
            </span>
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-text-dim" title={route.modelId}>{route.modelId}</p>
        </div>
        <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${route.architecture === "MoE" ? "border-violet-500/30 bg-violet-500/10 text-violet-300" : "border-zinc-700 bg-zinc-900 text-zinc-500"}`}>
          {route.architecture === "Unknown" ? "Architecture unknown" : route.architecture}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Property label="Context window" value={formatLimit(route.contextWindow)} />
        <Property label="Max output" value={formatLimit(route.maxOutputTokens)} />
        <Property label="API family" value={route.apiFamily || "Unknown"} />
        <Property label="Endpoint" value={route.endpoint || "Unknown"} />
        <Property label="Input" value={formatList(route.inputModalities)} />
        <Property label="Output" value={formatList(route.outputModalities)} />
        <Property label="Default params" value={formatParams(route.defaultParams)} />
        <Property label="Configured params" value={formatParams(route.configuredParams)} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Capability label="Tools" value={route.capabilities.toolCalling} />
        <Capability label="Vision" value={route.capabilities.vision} />
        <Capability label="Streaming" value={route.capabilities.streaming} />
        <Capability label="Structured" value={route.capabilities.structuredOutput} />
        <Capability label="Coding" value={route.capabilities.coding} />
        {typeof route.supportsSamplingParameters === "boolean" && (
          <Capability label="Sampling" value={route.supportsSamplingParameters ? "yes" : "no"} />
        )}
        {typeof route.freeTier === "boolean" && (
          <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] text-amber-300">
            Free tier: {route.freeTier ? "YES" : "NO"}
          </span>
        )}
      </div>

      {(route.baseApi || route.routeId || Number.isInteger(route.credentialIndex)) && (
        <p className="mt-3 break-all font-mono text-[9px] text-text-dark">
          {route.baseApi ? `Base: ${route.baseApi}` : ""}
          {route.routeId ? ` · Target: ${route.routeId}` : ""}
          {Number.isInteger(route.credentialIndex) ? ` · Key ${route.credentialIndex! + 1}` : ""}
        </p>
      )}

      {route.description && <p className="mt-2 text-[10px] leading-relaxed text-slate-400">{route.description}</p>}
      {route.notes?.[0] && <p className="mt-2 text-[10px] leading-relaxed text-text-dark">{route.notes[0]}</p>}
    </article>
  );
}

export function ModelPropertiesOverview({ apis, loading = false, error }: ModelPropertiesOverviewProps) {
  return (
    <section className="rounded-xl border border-border-main bg-bg-panel p-6">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white">
            <Network className="h-4 w-4 text-cyan-400" />
            Model properties by API
          </h3>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-text-dim">
            Context window is the model&apos;s advertised input limit; max output is separate. Unknown means this API route does not expose a reliable value.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 font-mono text-[9px] uppercase tracking-wider text-text-dark">
          <Database className="h-3.5 w-3.5" />
          Registry + route metadata
        </div>
      </div>

      {error && <div className="mb-4 rounded border border-rose-500/20 bg-rose-950/10 p-3 text-xs text-rose-300">{error}</div>}
      {loading && apis.length === 0 ? (
        <div className="rounded border border-border-main bg-bg-main/40 p-6 text-center text-sm text-text-dim">Loading model properties...</div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {apis.map((api) => (
            <article key={api.provider} className="rounded border border-border-main bg-bg-main/25 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                    <Settings2 className="h-3.5 w-3.5 text-cyan-400" />
                    {api.label}
                  </h4>
                  {api.baseApi && <p className="mt-1 break-all font-mono text-[9px] text-text-dark">{api.baseApi}</p>}
                </div>
                <Braces className="h-4 w-4 shrink-0 text-text-dark" />
              </div>

              {api.routes.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {api.routes.map((route) => <ModelRouteCard key={`${route.routeId || route.modelId}:${route.credentialIndex ?? "pool"}`} route={route} />)}
                </div>
              ) : (
                <div className="mt-3 rounded border border-dashed border-border-main bg-bg-main/40 p-3 text-xs text-text-dim">
                  No configured model target for this API.
                </div>
              )}

              {api.note && (
                <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-text-dark">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  {api.note}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
