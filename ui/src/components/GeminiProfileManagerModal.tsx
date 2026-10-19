import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Flower2,
  Info,
  Key,
  Loader2,
  Plus,
  Radio,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";

export interface GeminiProfileSummary {
  id: string;
  name: string;
  label?: string;
  purpose?: string;
  envVar?: string;
  keyPreview?: string;
  keySuffix?: string;
  isDefault?: boolean;
  status?: "available" | "cooldown" | "exhausted" | "disabled" | "healthy" | "warning" | "error";
  usageCount?: number;
  errorCount?: number;
  lastUsed?: string | null;
  assignedTargets?: string[];
  source?: "sqlite" | "yaml" | "env";
}

export interface DiscoveredEnvKey {
  envVar: string;
  keySuffix: string;
  preview: string;
  isConfigured: boolean;
  assignedProfiles: string[];
}

interface GeminiProfileManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProfileChanged?: () => void | Promise<void>;
  onOpenAddManualModel?: (profileId?: string) => void;
}

export function GeminiProfileManagerModal({
  isOpen,
  onClose,
  onProfileChanged,
  onOpenAddManualModel,
}: GeminiProfileManagerModalProps) {
  const [profiles, setProfiles] = useState<GeminiProfileSummary[]>([]);
  const [availableEnvKeys, setAvailableEnvKeys] = useState<DiscoveredEnvKey[]>([]);
  const [defaultProfileId, setDefaultProfileId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state for creating a new profile
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProfileLabel, setNewProfileLabel] = useState("");
  const [newProfileId, setNewProfileId] = useState("");
  const [newProfilePurpose, setNewProfilePurpose] = useState<string>("coding");
  const [newProfileEnvVar, setNewProfileEnvVar] = useState<string>("");
  const [customEnvVar, setCustomEnvVar] = useState("");
  const [setAsDefaultOnCreate, setSetAsDefaultOnCreate] = useState(false);

  const fetchProfiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gemini/profiles");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load Gemini profiles");

      setProfiles(Array.isArray(data.profiles) ? data.profiles : []);
      setAvailableEnvKeys(Array.isArray(data.availableEnvKeys) ? data.availableEnvKeys : []);
      setDefaultProfileId(data.defaultProfileId || "");

      // If available keys exist and no envVar selected yet, select the first
      if (Array.isArray(data.availableEnvKeys) && data.availableEnvKeys.length > 0 && !newProfileEnvVar) {
        setNewProfileEnvVar(data.availableEnvKeys[0].envVar);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to fetch Gemini profiles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchProfiles();
      setError(null);
      setSuccess(null);
    }
  }, [isOpen]);

  const handleLabelChange = (label: string) => {
    setNewProfileLabel(label);
    if (!newProfileId || newProfileId === "gemini-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, -1)) {
      const slug = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      setNewProfileId(slug ? `gemini-${slug}` : "");
    }
  };

  const handleSetDefaultProfile = async (profileId: string) => {
    setActionLoading(`set-default-${profileId}`);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/gemini/profiles/default", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to switch active profile");

      setDefaultProfileId(profileId);
      setSuccess(`Active profile switched to "${profiles.find((p) => p.id === profileId)?.label || profileId}"`);
      await fetchProfiles();
      if (onProfileChanged) await onProfileChanged();
    } catch (err: any) {
      setError(err?.message || "Failed to set default profile");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const envVarToUse = newProfileEnvVar === "custom" ? customEnvVar.trim() : newProfileEnvVar.trim();
    if (!newProfileLabel.trim() || !newProfileId.trim() || !envVarToUse) {
      setError("Please fill out all required fields (Profile Label, ID, and Mapped Environment Key).");
      return;
    }

    setActionLoading("create-profile");
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/gemini/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: newProfileId.trim(),
          label: newProfileLabel.trim(),
          purpose: newProfilePurpose,
          envVar: envVarToUse,
          setAsDefault: setAsDefaultOnCreate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create Gemini profile");

      setSuccess(data.message || `Profile "${newProfileLabel}" successfully created and mapped!`);
      setShowAddForm(false);
      setNewProfileLabel("");
      setNewProfileId("");
      setCustomEnvVar("");
      setSetAsDefaultOnCreate(false);
      await fetchProfiles();
      if (onProfileChanged) await onProfileChanged();
    } catch (err: any) {
      setError(err?.message || "Failed to create profile");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    if (!confirm(`Are you sure you want to delete profile "${profileId}"?`)) return;

    setActionLoading(`delete-${profileId}`);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/gemini/profiles/${encodeURIComponent(profileId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete profile");

      setSuccess(`Profile "${profileId}" deleted.`);
      await fetchProfiles();
      if (onProfileChanged) await onProfileChanged();
    } catch (err: any) {
      setError(err?.message || "Failed to delete profile");
    } finally {
      setActionLoading(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-400">
              <Flower2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold uppercase tracking-wider text-white">
                Gemini Account Profiles & API Key Mapping
              </h3>
              <p className="text-xs text-zinc-400">
                Map accounts to .env API keys (with 5-digit guidance) and switch profiles for manual model addition.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchProfiles}
              disabled={loading}
              className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white disabled:opacity-50"
              title="Refresh profiles"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
              title="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Status Alerts */}
        {error && (
          <div className="border-b border-rose-500/30 bg-rose-950/40 px-6 py-3 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="border-b border-emerald-500/30 bg-emerald-950/40 px-6 py-3 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {/* Body */}
        <div className="custom-scrollbar flex-1 space-y-6 overflow-y-auto p-6">
          {/* Discovered .env API Keys Guidance Banner */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-400">
                <Key className="h-4 w-4" />
                <span>Detected .env Gemini Keys ({availableEnvKeys.length})</span>
              </div>
              <span className="font-mono text-[10px] text-zinc-400">Showing last 5 digits for security guidance</span>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {availableEnvKeys.map((k) => (
                <div
                  key={k.envVar}
                  className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5 font-mono text-xs"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-zinc-200">{k.envVar}</div>
                    <div className="text-[10px] text-zinc-400">
                      Mapped to:{" "}
                      <span className="text-zinc-300">
                        {k.assignedProfiles.length > 0 ? k.assignedProfiles.join(", ") : "Not mapped"}
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 rounded border border-amber-500/30 bg-amber-950/30 px-2 py-0.5 font-bold text-amber-300">
                    ...{k.keySuffix}
                  </span>
                </div>
              ))}
              {availableEnvKeys.length === 0 && (
                <div className="col-span-full rounded border border-dashed border-zinc-800 p-3 text-center text-xs text-zinc-500">
                  No GEMINI_*_KEY variables discovered in .env yet. You can still define custom mapping below.
                </div>
              )}
            </div>
          </div>

          {/* Profile Management Actions */}
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">Configured Profiles</h4>
              <p className="text-[11px] text-zinc-400">
                Active profile handles general requests. Specific model targets can be pinned to any profile.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-cyan-300 transition hover:bg-cyan-500/20"
            >
              <Plus className="h-3.5 w-3.5" />
              {showAddForm ? "Cancel Add Profile" : "Add New Profile"}
            </button>
          </div>

          {/* Create Profile Form */}
          {showAddForm && (
            <form onSubmit={handleCreateProfile} className="rounded-xl border border-cyan-500/30 bg-cyan-950/10 p-5 space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-300 border-b border-cyan-500/20 pb-2">
                <Sparkles className="h-4 w-4" />
                <span>Create New Profile & Map to .env Key</span>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    Profile Label / Display Name <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newProfileLabel}
                    onChange={(e) => handleLabelChange(e.target.value)}
                    placeholder="e.g. Gemini 2.5 Flash Profile"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    Profile ID <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newProfileId}
                    onChange={(e) => setNewProfileId(e.target.value)}
                    placeholder="e.g. gemini-flash-profile"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-white placeholder-zinc-500 outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    Map to .env API Key <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={newProfileEnvVar}
                    onChange={(e) => setNewProfileEnvVar(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400"
                  >
                    {availableEnvKeys.map((k) => (
                      <option key={k.envVar} value={k.envVar}>
                        {k.envVar} (...{k.keySuffix})
                      </option>
                    ))}
                    <option value="custom">+ Custom Environment Variable Name...</option>
                  </select>
                </div>

                {newProfileEnvVar === "custom" && (
                  <div>
                    <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                      Custom .env Variable Name <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={customEnvVar}
                      onChange={(e) => setCustomEnvVar(e.target.value)}
                      placeholder="e.g. GEMINI_BACKUP_KEY"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-white placeholder-zinc-500 outline-none focus:border-cyan-400"
                    />
                  </div>
                )}

                <div>
                  <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    Profile Purpose / Role
                  </label>
                  <select
                    value={newProfilePurpose}
                    onChange={(e) => setNewProfilePurpose(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400"
                  >
                    <option value="coding">Coding & Synthesis</option>
                    <option value="general">General Chat & Exploration</option>
                    <option value="fast">Fast & Low-latency Lite</option>
                    <option value="analysis">Complex Reasoning & Pro</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={setAsDefaultOnCreate}
                    onChange={(e) => setSetAsDefaultOnCreate(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900 accent-cyan-400"
                  />
                  <span>Set as active / default profile immediately</span>
                </label>

                <button
                  type="submit"
                  disabled={actionLoading === "create-profile"}
                  className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-black transition hover:bg-cyan-400 disabled:opacity-50"
                >
                  {actionLoading === "create-profile" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Save Profile
                </button>
              </div>
            </form>
          )}

          {/* Profile Cards */}
          <div className="space-y-3">
            {profiles.map((profile) => {
              const isDefault = profile.isDefault || profile.id === defaultProfileId;
              const isDeleting = actionLoading === `delete-${profile.id}`;
              const isSettingDefault = actionLoading === `set-default-${profile.id}`;

              return (
                <div
                  key={profile.id}
                  className={`flex flex-col gap-4 rounded-xl border p-4 transition-all md:flex-row md:items-center md:justify-between ${
                    isDefault
                      ? "border-cyan-500/40 bg-cyan-950/20 shadow-md ring-1 ring-cyan-500/20"
                      : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div
                      className={`mt-0.5 rounded-lg p-2 ${
                        isDefault ? "bg-cyan-500/20 text-cyan-300" : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      <Flower2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h5 className="text-sm font-bold text-white">{profile.label || profile.name}</h5>
                        {isDefault && (
                          <span className="flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/20 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-cyan-300">
                            <Star className="h-3 w-3 fill-cyan-300" />
                            Active Profile
                          </span>
                        )}
                        {profile.purpose && (
                          <span className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-300">
                            {profile.purpose}
                          </span>
                        )}
                        {profile.envVar && (
                          <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">
                            env: {profile.envVar}
                          </span>
                        )}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-zinc-400">
                        <span>ID: {profile.id}</span>
                        {profile.keyPreview && (
                          <span className="flex items-center gap-1">
                            Key:{" "}
                            <span className="rounded border border-amber-500/30 bg-amber-950/20 px-1.5 py-0.2 font-bold text-amber-300">
                              {profile.keyPreview}
                            </span>
                          </span>
                        )}
                        <span>Assigned models: {profile.assignedTargets?.length || 0}</span>
                        <span>Usage: {profile.usageCount || 0}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions / Switcher */}
                  <div className="flex flex-wrap items-center gap-2 self-end md:self-center">
                    {!isDefault && (
                      <button
                        type="button"
                        onClick={() => handleSetDefaultProfile(profile.id)}
                        disabled={Boolean(actionLoading)}
                        className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300 transition hover:bg-cyan-500/20 disabled:opacity-50"
                        title="Set this profile as active default"
                      >
                        {isSettingDefault ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Star className="h-3 w-3" />
                        )}
                        Switch Active
                      </button>
                    )}

                    {onOpenAddManualModel && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenAddManualModel(profile.id);
                        }}
                        className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-200 transition hover:border-zinc-600 hover:text-white"
                        title="Add a model target pinned to this profile"
                      >
                        <Plus className="h-3 w-3" />
                        Add Model
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleDeleteProfile(profile.id)}
                      disabled={Boolean(actionLoading)}
                      className="rounded-lg border border-rose-500/20 bg-rose-950/10 p-2 text-rose-400 transition hover:bg-rose-950/30 disabled:opacity-50"
                      title="Delete profile"
                    >
                      {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              );
            })}

            {profiles.length === 0 && !loading && (
              <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
                No Gemini profiles configured yet. Click &ldquo;Add New Profile&rdquo; above to map one from .env!
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900/50 px-6 py-4">
          <p className="font-mono text-[11px] text-zinc-400">
            Current default: <span className="font-bold text-cyan-300">{defaultProfileId || "gemini-account-1"}</span>
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-zinc-800 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-zinc-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
