import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  GitBranch,
  Info,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import type {
  DelegationRole,
  DelegationRoute,
  DelegationRouteOption,
  DelegationSettings,
  DelegationSlot,
} from "../../../src/config/delegationContracts";
import { DELEGATION_ROLES, MAX_DELEGATION_ROLE_RULE_LENGTH } from "../../../src/config/delegationContracts";

type Route = DelegationRoute;
type Worker = DelegationSlot;
type Settings = DelegationSettings;
type RouteOption = DelegationRouteOption;

const MAX_WORKERS = 16;
const ROLE_LABELS: Record<DelegationRole, string> = {
  coder: "Coder",
  researcher: "Researcher",
  tester: "Tester",
  reviewer: "Reviewer",
  planner: "Planner",
  documenter: "Documenter",
  specialist: "Specialist",
};

const routeKey = (route: Route | null): string => route ? `${route.provider}:${route.model}` : "";

const createWorkers = (existing: Worker[] = []): Worker[] => {
  const workers = existing
    .filter((worker) => Number.isInteger(worker.slot) && worker.slot > 0)
    .sort((a, b) => a.slot - b.slot)
    .slice(0, MAX_WORKERS)
    .map((worker, index) => ({ slot: index + 1, route: worker.route || null }));
  return workers.length > 0 ? workers : [{ slot: 1, route: null }];
};

function routeCredentialLabel(option?: RouteOption): string {
  if (!option) return "No route selected";
  return option.provider === "nvidia"
    ? `NVIDIA API key ${option.credentialIndex + 1}`
    : `Gemini profile ${option.profileId || option.credentialIndex + 1}`;
}

function RouteDetails({ option }: { option?: RouteOption }) {
  if (!option) {
    return <span className="text-[10px] text-text-dark">Select a model from the loaded API Pool targets.</span>;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
      <span className="rounded border border-cyan-500/30 bg-cyan-950/20 px-1.5 py-0.5 font-bold uppercase tracking-wider text-cyan-300">
        loaded model
      </span>
      <span className={`rounded border px-1.5 py-0.5 font-bold uppercase tracking-wider ${option.provider === "nvidia" ? "border-lime-500/30 bg-lime-950/20 text-lime-300" : "border-violet-500/30 bg-violet-950/20 text-violet-300"}`}>
        {option.provider}
      </span>
      <span className="font-mono text-text-dim">{option.modelId}</span>
      <span className="text-text-dark">·</span>
      <span className="text-cyan-300">{routeCredentialLabel(option)}</span>
    </div>
  );
}

function RouteSelect({
  value,
  options,
  onChange,
  label,
}: {
  value: Route | null;
  options: RouteOption[];
  onChange: (route: Route | null) => void;
  label: string;
}) {
  const grouped = useMemo(() => ({
    nvidia: options.filter((option) => option.provider === "nvidia"),
    gemini: options.filter((option) => option.provider === "gemini"),
  }), [options]);

  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-text-dim">{label}</span>
      <select
        value={routeKey(value)}
        onChange={(event) => {
          const selected = options.find((option) => routeKey(option) === event.target.value);
          onChange(selected ? { provider: selected.provider, model: selected.model } : null);
        }}
        className="w-full rounded border border-border-main bg-bg-main px-3 py-2.5 text-xs text-white outline-none transition focus:border-cyan-400"
      >
        <option value="">Unassigned</option>
        {grouped.nvidia.length > 0 && (
          <optgroup label="NVIDIA API targets">
            {grouped.nvidia.map((option) => <option key={routeKey(option)} value={routeKey(option)}>{option.modelId} Â· {option.label}</option>)}
          </optgroup>
        )}
        {grouped.gemini.length > 0 && (
          <optgroup label="Gemini profile targets">
            {grouped.gemini.map((option) => <option key={routeKey(option)} value={routeKey(option)}>{option.modelId} Â· {option.label}</option>)}
          </optgroup>
        )}
      </select>
    </label>
  );
}

function AgentNode({
  kind,
  title,
  route,
  options,
  onRouteChange,
  onRemove,
}: {
  kind: "main" | "worker";
  title: string;
  route: Route | null;
  options: RouteOption[];
  onRouteChange: (route: Route | null) => void;
  onRemove?: () => void;
}) {
  const selectedOption = options.find((option) => routeKey(option) === routeKey(route));
  const isMain = kind === "main";

  return (
    <div className={`relative w-full rounded-xl border p-4 shadow-lg transition ${isMain ? "max-w-2xl border-cyan-400/50 bg-gradient-to-br from-cyan-950/50 via-bg-panel to-bg-panel shadow-cyan-950/30" : "border-border-main bg-bg-panel hover:border-cyan-500/40"}`}>
      <div className="flex items-start gap-3">
        <div className={`rounded-lg p-2.5 ${isMain ? "bg-cyan-400/15 text-cyan-300" : "bg-zinc-800 text-zinc-300"}`}>
          {isMain ? <Bot className="h-5 w-5" /> : <Users className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">{title}</h4>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${isMain ? "bg-cyan-400/15 text-cyan-300" : "bg-zinc-800 text-text-dim"}`}>
              {isMain ? "orchestrator" : "worker"}
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-4 text-text-dim">
            {isMain ? "Owns the primary task, planning, and delegation decisions." : "Receives one delegated task on its pinned route."}
          </p>
        </div>
        {!isMain && onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-1.5 text-text-dark transition hover:bg-rose-950/30 hover:text-rose-300"
            title={`Remove ${title}`}
            aria-label={`Remove ${title}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="mt-4">
        {isMain ? (
          <div className="rounded border border-cyan-500/20 bg-cyan-950/15 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">User-selected run target</span>
              <span className="rounded-full border border-cyan-500/30 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-200">master</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-text-dim">The model selected when the run starts owns the plan and decides which worker handles each focused task.</p>
          </div>
        ) : (
          <>
            <RouteSelect value={route || null} options={options} onChange={onRouteChange || (() => undefined)} label="Worker model target" />
            <RouteDetails option={selectedOption} />
          </>
        )}
      </div>
    </div>
  );
}

export function DelegationSettingsPanel() {
  const [settings, setSettings] = useState<Settings>({
    enabled: false,
    delegates: createWorkers(),
    allowedRoles: [...DELEGATION_ROLES],
    roleRules: {},
    maxConcurrentDelegates: 1,
  });
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/delegation/settings");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load delegation settings");
      const next = data.settings as Settings;
      setSettings({
        ...next,
        delegates: createWorkers(next.delegates),
        allowedRoles: Array.isArray(next.allowedRoles) ? next.allowedRoles : [...DELEGATION_ROLES],
        roleRules: next.roleRules && typeof next.roleRules === "object" ? next.roleRules : {},
      });
      setRoutes(Array.isArray(data.routes) ? data.routes : []);
      setErrors(Array.isArray(data.errors) ? data.errors : []);
    } catch (error: any) {
      setErrors([error?.message || "Failed to load delegation settings"]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("nvidia-model-targets-updated", refresh);
    window.addEventListener("gemini-model-targets-updated", refresh);
    window.addEventListener("provider-model-targets-updated", refresh);
    return () => {
      window.removeEventListener("nvidia-model-targets-updated", refresh);
      window.removeEventListener("gemini-model-targets-updated", refresh);
      window.removeEventListener("provider-model-targets-updated", refresh);
    };
  }, []);

  const clearFeedback = () => {
    setErrors([]);
    setMessage(null);
  };

  const updateWorker = (slot: number, route: Route | null) => {
    setSettings((current) => ({
      ...current,
      delegates: current.delegates.map((worker) => worker.slot === slot ? { ...worker, route } : worker),
    }));
    clearFeedback();
  };

  const addWorker = () => {
    setSettings((current) => {
      if (current.delegates.length >= MAX_WORKERS) return current;
      return {
        ...current,
        delegates: [...current.delegates, { slot: current.delegates.length + 1, route: null }],
      };
    });
    clearFeedback();
  };

  const removeWorker = (slot: number) => {
    setSettings((current) => {
      const remaining = current.delegates.filter((worker) => worker.slot !== slot);
      return {
        ...current,
        delegates: createWorkers(remaining.map((worker, index) => ({ ...worker, slot: index + 1 }))),
      };
    });
    clearFeedback();
  };

  const save = async () => {
    setSaving(true);
    setErrors([]);
    setMessage(null);
    try {
      const response = await fetch("/api/delegation/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save delegation settings");
      setSettings({
        ...data.settings,
        delegates: createWorkers(data.settings.delegates),
        allowedRoles: Array.isArray(data.settings.allowedRoles) ? data.settings.allowedRoles : [...DELEGATION_ROLES],
        roleRules: data.settings.roleRules && typeof data.settings.roleRules === "object" ? data.settings.roleRules : {},
      });
      setRoutes(Array.isArray(data.routes) ? data.routes : routes);
      setMessage("Delegation chart saved.");
    } catch (error: any) {
      setErrors([error?.message || "Failed to save delegation settings"]);
    } finally {
      setSaving(false);
    }
  };

  const configuredWorkers = settings.delegates.filter((worker) => Boolean(worker.route)).length;
  // Kept only while older saved UI bundles are replaced; the master model is
  // intentionally not part of delegation settings.
  const mainOption: RouteOption | undefined = undefined;
  return (
    <section className="space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="flex items-center gap-2 text-cyan-400">
            <GitBranch className="h-4 w-4" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Delegation topology</span>
          </div>
          <h3 className="mt-2 text-lg font-semibold text-white">Run master &amp; workers</h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-text-dim">
            The master model comes from the target selected for each run. Configure only the worker models here so the master can delegate focused work and conserve tokens.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border-main bg-bg-panel px-3 py-2 text-[10px] font-mono text-text-dim">
          <span className="text-cyan-300">1 master</span>
          <span className="text-text-dark">·</span>
          <span className="text-violet-300">{configuredWorkers} workers</span>
          <span className="text-text-dark">·</span>
          <span>{routes.length} targets</span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="ml-1 inline-flex items-center gap-1 rounded border border-border-main px-2 py-1 font-sans font-bold uppercase tracking-wider text-text-dim transition hover:border-cyan-400 hover:text-cyan-300 disabled:cursor-wait disabled:opacity-50"
            title="Reload available worker models from API Pool"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Load models
          </button>
        </div>
      </div>

      <div className="rounded border border-cyan-500/20 bg-cyan-950/10 p-4 text-xs leading-5 text-cyan-100">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
          <span>The master is always the model selected for the current run. Workers use the exact credential/profile attached to their saved target. If a route is unavailable, the worker reports the failure instead of silently switching accounts. Tasks without an explicit slot use workers in round-robin order.</span>
        </div>
      </div>

      <div className="rounded-xl border border-border-main bg-bg-panel p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-violet-400/10 p-2 text-violet-300"><ShieldCheck className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">Role allowlist and rules</h4>
            <p className="mt-1 text-xs leading-5 text-text-dim">These settings are validated and enforced by the server. Rules are bounded instructions only; safety, capability, and approval policy always take precedence.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {DELEGATION_ROLES.map((role) => {
                const allowed = (settings.allowedRoles || []).includes(role);
                return (
                  <label key={role} className="flex items-center gap-2 rounded border border-border-main bg-bg-main px-3 py-2 text-[10px] text-text-dim">
                    <input
                      type="checkbox"
                      checked={allowed}
                      onChange={(event) => {
                        setSettings((current) => ({
                          ...current,
                          allowedRoles: event.target.checked
                            ? Array.from(new Set([...(current.allowedRoles || []), role]))
                            : (current.allowedRoles || []).filter((item) => item !== role),
                        }));
                        clearFeedback();
                      }}
                    />
                    {ROLE_LABELS[role]}
                  </label>
                );
              })}
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {DELEGATION_ROLES.map((role) => (
                <label key={role} className="block space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-text-dim">{ROLE_LABELS[role]} rule</span>
                  <textarea
                    value={settings.roleRules?.[role] || ""}
                    maxLength={MAX_DELEGATION_ROLE_RULE_LENGTH}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSettings((current) => ({ ...current, roleRules: { ...(current.roleRules || {}), [role]: value } }));
                      clearFeedback();
                    }}
                    rows={2}
                    placeholder={`Optional bounded guidance for ${ROLE_LABELS[role].toLowerCase()} workers`}
                    className="w-full resize-y rounded border border-border-main bg-bg-main px-3 py-2 text-xs text-white outline-none transition focus:border-violet-400"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="rounded border border-rose-500/30 bg-rose-950/20 p-3 text-xs text-rose-200">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <div className="space-y-1">{errors.map((error) => <div key={error}>{error}</div>)}</div>
          </div>
        </div>
      )}

      {message && (
        <div className="flex items-center gap-2 rounded border border-emerald-500/20 bg-emerald-950/10 p-3 text-xs text-emerald-200">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />{message}
        </div>
      )}

      <div className="relative overflow-hidden rounded-2xl border border-border-main bg-gradient-to-b from-bg-panel to-bg-main/60 p-4 md:p-6">
        <div className="pointer-events-none absolute left-1/2 top-44 hidden h-28 w-px -translate-x-1/2 bg-gradient-to-b from-cyan-400/70 to-violet-500/30 md:block" />
        <div className="relative z-10 flex justify-center">
          <AgentNode
            kind="main"
            title="Run master"
            route={null}
            options={routes}
            onRouteChange={() => undefined}
          />
        </div>

        <div className="relative z-10 flex flex-col items-center py-5">
          <div className="h-7 w-px bg-cyan-400/50" />
          <div className="flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-950/30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-200">
            <GitBranch className="h-3.5 w-3.5" /> delegates work
          </div>
          <div className="h-7 w-px bg-violet-400/50" />
        </div>

        <div className="relative z-10">
          <div className="pointer-events-none absolute left-[8%] right-[8%] top-0 hidden h-px bg-violet-500/40 md:block" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {settings.delegates.map((worker) => (
              <div key={worker.slot} className="relative pt-3 md:before:absolute md:before:left-1/2 md:before:top-0 md:before:h-3 md:before:w-px md:before:bg-violet-500/50">
                <AgentNode
                  kind="worker"
                  title={`Worker ${worker.slot}`}
                  route={worker.route}
                  options={routes}
                  onRouteChange={(route) => updateWorker(worker.slot, route)}
                  onRemove={() => removeWorker(worker.slot)}
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addWorker}
            disabled={settings.delegates.length >= MAX_WORKERS}
            className="mx-auto mt-5 flex items-center gap-2 rounded-lg border border-dashed border-violet-500/40 bg-violet-950/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-violet-200 transition hover:border-violet-400 hover:bg-violet-950/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
            Add worker
            <span className="font-mono text-[9px] text-violet-300/60">{settings.delegates.length}/{MAX_WORKERS}</span>
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border-main bg-bg-panel p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className={`rounded-lg p-2 ${settings.enabled ? "bg-emerald-400/15 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>
                <Zap className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-white">Enable delegation</h4>
                <p className="mt-1 text-xs leading-5 text-text-dim">SubAgent stays blocked until this chart is enabled and saved.</p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.enabled}
              onClick={() => { setSettings((current) => ({ ...current, enabled: !current.enabled })); clearFeedback(); }}
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${settings.enabled ? "bg-emerald-400" : "bg-zinc-700"}`}
            >
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${settings.enabled ? "left-6" : "left-1"}`} />
            </button>
          </div>
          <div className="mt-5 rounded border border-cyan-500/20 bg-cyan-950/10 px-3 py-2 text-xs leading-5 text-text-dim">
            The current run's model selection remains authoritative. This switch only controls whether the master may call configured workers.
          </div>
        </div>

        <div className="rounded-xl border border-border-main bg-bg-panel p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-amber-400/10 p-2 text-amber-300"><ShieldCheck className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">Sequential worker queue</h4>
              <p className="mt-1 text-xs leading-5 text-text-dim">Only one worker runs at a time. The main agent pauses until the current worker returns, then the next delegation round can start.</p>
              <div className="mt-3 flex items-center gap-2 rounded border border-amber-500/20 bg-amber-950/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-amber-200">
                <ShieldCheck className="h-3.5 w-3.5" />
                1 active worker · shared delegation timer
              </div>
            </div>
          </div>
        </div>
      </div>

      {routes.length === 0 && !loading && (
        <div className="rounded border border-amber-500/30 bg-amber-950/15 p-3 text-xs text-amber-200">
          No saved model targets are available. Configure NVIDIA targets or Gemini profile targets in API Pool first.
        </div>
      )}

      <div className="border-t border-border-main pt-4 text-[10px] text-text-dark">
        {loading ? "Loading worker targets..." : "Master model: selected from the run's model target"}
      </div>

      <div className="hidden flex flex-col justify-between gap-3 border-t border-border-main pt-4 sm:flex-row sm:items-center">
        <div className="text-[10px] text-text-dark">
          {loading ? "Loading saved targets..." : mainOption ? `Main: ${mainOption.modelId} · ${routeCredentialLabel(mainOption)}` : "Main agent route not selected"}
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || loading}
          className="flex items-center justify-center gap-2 rounded bg-cyan-400 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-black transition hover:bg-cyan-300 disabled:opacity-60"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? "Saving chart..." : "Save delegation chart"}
        </button>
      </div>
    </section>
  );
}
