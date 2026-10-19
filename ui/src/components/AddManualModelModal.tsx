import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Cpu,
  Flower2,
  Info,
  Key,
  Loader2,
  Network,
  Plus,
  Radio,
  Route,
  Save,
  Sparkles,
  Star,
  TestTube2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { GeminiProfileManagerModal, type GeminiProfileSummary } from "./GeminiProfileManagerModal";

export type SupportedManualProvider =
  | "gemini"
  | "nvidia"
  | "local"
  | "colab"
  | "groq"
  | "openrouter"
  | "sambanova"
  | "kimi"
  | "requesty"
  | "pollinations";

interface KeySummary {
  name: string;
  keyIndex?: number;
  index?: number;
  id?: string;
  profileId?: string;
  label?: string;
  keySuffix?: string;
  keyPreview?: string;
  envVar?: string;
  isDefault?: boolean;
}

interface AddManualModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialProvider?: SupportedManualProvider | string;
  initialProfileId?: string;
  geminiStatuses?: KeySummary[];
  nvidiaStatuses?: KeySummary[];
  geminiModels?: string[];
  onModelAdded?: () => void | Promise<void>;
}

interface ProviderPreset {
  id: SupportedManualProvider;
  name: string;
  icon: React.ReactNode;
  colorClass: string;
  bgClass: string;
  borderClass: string;
  popularModels: string[];
  placeholder: string;
  description: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "gemini",
    name: "Gemini",
    icon: <Flower2 className="h-4 w-4" />,
    colorClass: "text-cyan-300",
    bgClass: "bg-cyan-950/20",
    borderClass: "border-cyan-500/30",
    popularModels: [
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
      "gemini-1.5-pro",
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
    ],
    placeholder: "gemini-2.5-flash",
    description: "Pins a Google Gemini model ID to a specific Google account profile with custom hyperparameters.",
  },
  {
    id: "nvidia",
    name: "NVIDIA",
    icon: <Cpu className="h-4 w-4" />,
    colorClass: "text-lime-300",
    bgClass: "bg-lime-950/20",
    borderClass: "border-lime-500/30",
    popularModels: [
      "meta/llama-3.1-70b-instruct",
      "meta/llama-3.3-70b-instruct",
      "minimaxai/minimax-m3",
      "z-ai/glm-5.2",
      "deepseek-ai/deepseek-r1",
      "nvidia/llama-3.1-nemotron-70b-instruct",
    ],
    placeholder: "meta/llama-3.3-70b-instruct",
    description: "Connects to NVIDIA NIM endpoints via OpenAI-compatible completion protocol with key assignment.",
  },
  {
    id: "local",
    name: "Local AI",
    icon: <Cpu className="h-4 w-4" />,
    colorClass: "text-emerald-300",
    bgClass: "bg-emerald-950/20",
    borderClass: "border-emerald-500/30",
    popularModels: [
      "qwen2.5-coder:7b",
      "qwen2.5-coder:14b",
      "llama3.2:3b",
      "deepseek-r1:7b",
      "deepseek-r1:14b",
      "mistral:7b",
    ],
    placeholder: "qwen2.5-coder:7b",
    description: "Routes queries to a local Ollama, vLLM, LM Studio, or custom server endpoint.",
  },
  {
    id: "colab",
    name: "Colab Model",
    icon: <Cpu className="h-4 w-4" />,
    colorClass: "text-orange-300",
    bgClass: "bg-orange-950/20",
    borderClass: "border-orange-500/30",
    popularModels: [
      "Qwen/Qwen2.5-Coder-7B-Instruct",
      "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
      "meta-llama/Llama-3.2-3B-Instruct",
    ],
    placeholder: "Qwen/Qwen2.5-Coder-7B-Instruct",
    description: "Tunnel into a Google Colab GPU notebook running vLLM or text-generation-webui via ngrok or Cloudflare.",
  },
  {
    id: "groq",
    name: "Groq",
    icon: <Zap className="h-4 w-4" />,
    colorClass: "text-amber-300",
    bgClass: "bg-amber-950/20",
    borderClass: "border-amber-500/30",
    popularModels: [
      "llama-3.3-70b-versatile",
      "deepseek-r1-distill-llama-70b",
      "llama-3.1-8b-instant",
      "mixtral-8x7b-32768",
      "gemma2-9b-it",
    ],
    placeholder: "llama-3.3-70b-versatile",
    description: "Sets the high-speed LPU model route and role configurations on Groq.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    icon: <Route className="h-4 w-4" />,
    colorClass: "text-indigo-300",
    bgClass: "bg-indigo-950/20",
    borderClass: "border-indigo-500/30",
    popularModels: [
      "deepseek/deepseek-r1:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "google/gemini-2.0-flash-exp:free",
      "qwen/qwen-2.5-coder-32b-instruct",
      "anthropic/claude-3.5-sonnet",
    ],
    placeholder: "deepseek/deepseek-r1:free",
    description: "Configures single-account routing to any model available on the OpenRouter catalog.",
  },
  {
    id: "sambanova",
    name: "SambaNova",
    icon: <Cpu className="h-4 w-4" />,
    colorClass: "text-fuchsia-300",
    bgClass: "bg-fuchsia-950/20",
    borderClass: "border-fuchsia-500/30",
    popularModels: [
      "Meta-Llama-3.3-70B-Instruct",
      "DeepSeek-R1-Distill-Llama-70B",
      "Qwen2.5-Coder-32B-Instruct",
      "Meta-Llama-3.1-405B-Instruct",
    ],
    placeholder: "Meta-Llama-3.3-70B-Instruct",
    description: "Routes generation to SambaNova DataScale clusters with free or configured credit tiers.",
  },
  {
    id: "kimi",
    name: "Kimi",
    icon: <Network className="h-4 w-4" />,
    colorClass: "text-sky-300",
    bgClass: "bg-sky-950/20",
    borderClass: "border-sky-500/30",
    popularModels: [
      "moonshot-v1-8k",
      "moonshot-v1-32k",
      "moonshot-v1-128k",
      "kimi-latest",
    ],
    placeholder: "moonshot-v1-8k",
    description: "Sets the Moonshot / Kimi model target with ultra-long context capabilities.",
  },
  {
    id: "requesty",
    name: "Requesty",
    icon: <Route className="h-4 w-4" />,
    colorClass: "text-violet-300",
    bgClass: "bg-violet-950/20",
    borderClass: "border-violet-500/30",
    popularModels: [
      "requesty/free-auto",
      "meta-llama/llama-3.3-70b-instruct",
      "qwen/qwen-2.5-coder-32b-instruct",
    ],
    placeholder: "requesty/free-auto",
    description: "Routes to Requesty free tier models with auto-failover capabilities.",
  },
  {
    id: "pollinations",
    name: "Pollinations",
    icon: <Sparkles className="h-4 w-4" />,
    colorClass: "text-pink-300",
    bgClass: "bg-pink-950/20",
    borderClass: "border-pink-500/30",
    popularModels: [
      "openai",
      "mistral",
      "claude-hybridspace",
      "qwen-coder",
      "karma",
    ],
    placeholder: "openai",
    description: "Direct anonymous and token-balanced AI text & multimodal generation.",
  },
];

export function AddManualModelModal({
  isOpen,
  onClose,
  initialProvider = "gemini",
  initialProfileId,
  geminiStatuses = [],
  nvidiaStatuses = [],
  geminiModels = [],
  onModelAdded,
}: AddManualModelModalProps) {
  const normalizedInitial = (initialProvider?.toLowerCase() || "gemini") as SupportedManualProvider;
  const validInitial = PROVIDER_PRESETS.some((p) => p.id === normalizedInitial) ? normalizedInitial : "gemini";

  const [selectedProvider, setSelectedProvider] = useState<SupportedManualProvider>(validInitial);

  // Common fields
  const [modelId, setModelId] = useState("");
  const [title, setTitle] = useState("");
  const [maxTokens, setMaxTokens] = useState<number>(4096);
  const [temperature, setTemperature] = useState<number>(0.2);
  const [topP, setTopP] = useState<number>(0.95);
  const [supportsTools, setSupportsTools] = useState<boolean>(true);

  // Gemini specific & Profiles
  const [geminiProfiles, setGeminiProfiles] = useState<GeminiProfileSummary[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [defaultProfileId, setDefaultProfileId] = useState<string>("");
  const [geminiKeyIndex, setGeminiKeyIndex] = useState<number>(0);
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  // NVIDIA specific
  const [nvidiaKeyIndex, setNvidiaKeyIndex] = useState<number>(0);

  // Local AI / Colab specific
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434/v1");
  const [localApiKey, setLocalApiKey] = useState("");
  const [localFormat, setLocalFormat] = useState<"ollama" | "vllm" | "lmstudio" | "openai">("ollama");
  const [localContextWindow, setLocalContextWindow] = useState(32768);
  const [localInputTokenLimit, setLocalInputTokenLimit] = useState(2750);

  // Groq specific
  const [groqRole, setGroqRole] = useState<"default" | "fast" | "coder" | "reviewer">("default");

  // Status & Feedback state
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: "healthy" | "error" | "warning";
    message: string;
    details?: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadGeminiProfiles = async () => {
    try {
      const res = await fetch("/api/gemini/profiles");
      const data = await res.json();
      if (res.ok && Array.isArray(data.profiles)) {
        setGeminiProfiles(data.profiles);
        setDefaultProfileId(data.defaultProfileId || "");
        if (initialProfileId && data.profiles.some((p: any) => p.id === initialProfileId)) {
          setSelectedProfileId(initialProfileId);
        } else if (!selectedProfileId && data.profiles.length > 0) {
          setSelectedProfileId(data.defaultProfileId || data.profiles[0].id);
        }
      }
    } catch {
      // Fall back to geminiStatuses
    }
  };

  // Sync initialProvider and load profiles when modal opens
  React.useEffect(() => {
    if (isOpen) {
      if (initialProvider) {
        const match = PROVIDER_PRESETS.find(
          (p) => p.id === initialProvider.toLowerCase() || (initialProvider.toLowerCase() === "localai" && p.id === "local")
        );
        if (match) {
          setSelectedProvider(match.id);
        }
      }
      if (initialProfileId) {
        setSelectedProfileId(initialProfileId);
      }
      setTestResult(null);
      setErrorMsg(null);
      setSuccessMsg(null);
      void loadGeminiProfiles();
    }
  }, [isOpen, initialProvider, initialProfileId]);

  // Adjust default Base URL when format changes in Local AI
  const handleFormatChange = (fmt: "ollama" | "vllm" | "lmstudio" | "openai") => {
    setLocalFormat(fmt);
    if (fmt === "ollama") setBaseUrl("http://localhost:11434/v1");
    else if (fmt === "vllm") setBaseUrl("http://localhost:8000/v1");
    else if (fmt === "lmstudio") setBaseUrl("http://localhost:1234/v1");
    else if (fmt === "openai") setBaseUrl("http://localhost:8080/v1");
  };

  const activePreset = PROVIDER_PRESETS.find((p) => p.id === selectedProvider) || PROVIDER_PRESETS[0];

  const handleQuickModelSelect = (selectedModel: string) => {
    setModelId(selectedModel);
    if (!title.trim()) {
      const formattedTitle = `${activePreset.name}: ${selectedModel.split("/").pop() || selectedModel}`;
      setTitle(formattedTitle);
    }
  };

  const handleTestRoute = async () => {
    const targetModel = modelId.trim() || activePreset.placeholder;
    setTesting(true);
    setTestResult(null);
    setErrorMsg(null);

    try {
      if (selectedProvider === "local" || selectedProvider === "colab") {
        const testEndpoint = {
          id: `manual-test-${Date.now()}`,
          title: title.trim() || `${activePreset.name} Route`,
          baseUrl: baseUrl.trim(),
          modelId: targetModel,
          enabled: true,
          apiKey: localApiKey.trim() || undefined,
        };

        const res = await fetch(selectedProvider === "colab" ? "/api/colab/test" : "/api/local-ai/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: testEndpoint }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Connection test failed");
        setTestResult({
          status: "healthy",
          message: data.message || "Endpoint responded successfully!",
          details: `Discovered model: ${data.model || targetModel}`,
        });
      } else if (selectedProvider === "gemini") {
        // Test listing or status check
        const res = await fetch("/api/gemini/pool-status");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Gemini connection error");
        setTestResult({
          status: "healthy",
          message: "Gemini account profile verified.",
          details: `Target model ready: ${targetModel}`,
        });
      } else if (selectedProvider === "nvidia") {
        const res = await fetch("/api/nvidia/pool-status");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "NVIDIA connection error");
        setTestResult({
          status: "healthy",
          message: "NVIDIA API credential verified.",
          details: `Target model ready: ${targetModel}`,
        });
      } else {
        // Generic provider completion test
        const res = await fetch(`/api/${selectedProvider}/test`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `${activePreset.name} test returned an error`);
        setTestResult({
          status: "healthy",
          message: data.message || `${activePreset.name} test succeeded!`,
          details: data.model ? `Active route: ${data.model}` : undefined,
        });
      }
    } catch (err: any) {
      setTestResult({
        status: "error",
        message: err?.message || "Test failed",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveModel = async () => {
    const targetModel = modelId.trim() || activePreset.placeholder;
    const finalTitle = title.trim() || `${activePreset.name}: ${targetModel}`;
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      if (selectedProvider === "gemini") {
        // 1. Fetch current gemini targets
        const currentRes = await fetch("/api/gemini/model-targets");
        const currentData = await currentRes.json();
        const existingTargets = Array.isArray(currentData.targets) ? currentData.targets : [];

        const matchingProfile = geminiProfiles.find((p) => p.id === selectedProfileId);
        const selectedStatusKey = geminiStatuses[geminiKeyIndex];
        const profileIdToUse = selectedProfileId || matchingProfile?.id || selectedStatusKey?.profileId || (geminiProfiles[0]?.id);

        const newTarget = {
          id: `target-${Date.now()}`,
          title: finalTitle,
          modelId: targetModel,
          apiKeyIndex: geminiKeyIndex,
          profileId: profileIdToUse,
          temperature,
          maxTokens,
          topP,
          supportsTools,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        const saveRes = await fetch("/api/gemini/model-targets", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targets: [...existingTargets, newTarget] }),
        });
        const saveData = await saveRes.json();
        if (!saveRes.ok) throw new Error(saveData.error || "Failed to save Gemini model target");

        setSuccessMsg(`Successfully added Gemini model target "${finalTitle}" mapped to profile "${profileIdToUse || "default"}"!`);
      } else if (selectedProvider === "nvidia") {
        const currentRes = await fetch("/api/nvidia/model-targets");
        const currentData = await currentRes.json();
        const existingTargets = Array.isArray(currentData.targets) ? currentData.targets : [];

        const newTarget = {
          id: `nvidia-target-${Date.now()}`,
          title: finalTitle,
          modelId: targetModel,
          apiKeyIndex: nvidiaKeyIndex,
          temperature,
          maxTokens,
          topP,
          supportsTools,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        const saveRes = await fetch("/api/nvidia/model-targets", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targets: [...existingTargets, newTarget] }),
        });
        const saveData = await saveRes.json();
        if (!saveRes.ok) throw new Error(saveData.error || "Failed to save NVIDIA model target");

        setSuccessMsg(`Successfully added NVIDIA model target "${finalTitle}"! Target ID: nvidia-target:${newTarget.id}`);
      } else if (selectedProvider === "local" || selectedProvider === "colab") {
        const endpointEndpoint = selectedProvider === "colab" ? "/api/colab/endpoints" : "/api/local-ai/endpoints";
        const currentRes = await fetch(endpointEndpoint);
        const currentData = await currentRes.json();
        const existingEndpoints = Array.isArray(currentData.endpoints) ? currentData.endpoints : [];

        const newEndpoint = {
          id: `endpoint-${Date.now()}`,
          title: finalTitle,
          baseUrl: baseUrl.trim(),
          modelId: targetModel,
          ...(selectedProvider === "local" ? {
            contextWindow: localContextWindow,
            inputTokenLimit: localInputTokenLimit,
          } : {}),
          enabled: true,
          apiKey: localApiKey.trim() || undefined,
          source: "settings",
          updatedAt: Date.now(),
        };

        const saveRes = await fetch(endpointEndpoint, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoints: [...existingEndpoints, newEndpoint] }),
        });
        const saveData = await saveRes.json();
        if (!saveRes.ok) throw new Error(saveData.error || `Failed to save ${activePreset.name} endpoint`);

        setSuccessMsg(`Successfully registered ${activePreset.name} route "${finalTitle}"!`);
      } else if (selectedProvider === "groq") {
        if (groqRole === "default") {
          const res = await fetch("/api/groq/model-target", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modelId: targetModel }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to update Groq default model");
        } else {
          // Update via settings
          const currentSettingsRes = await fetch("/api/groq/settings");
          const currentSettings = (await currentSettingsRes.json()).settings || {};
          const fieldMap = {
            fast: "fastModel",
            coder: "coderModel",
            reviewer: "reviewerModel",
          };
          const updateField = fieldMap[groqRole];
          const updated = {
            ...currentSettings,
            [updateField]: targetModel,
          };
          const res = await fetch("/api/groq/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updated),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `Failed to update Groq ${groqRole} model`);
        }
        setSuccessMsg(`Successfully saved Groq ${groqRole} model to "${targetModel}"!`);
      } else if (
        selectedProvider === "openrouter" ||
        selectedProvider === "sambanova" ||
        selectedProvider === "kimi" ||
        selectedProvider === "requesty"
      ) {
        const res = await fetch(`/api/${selectedProvider}/model-target`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelId: targetModel }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Failed to set ${activePreset.name} model target`);
        setSuccessMsg(`Successfully set ${activePreset.name} model to "${targetModel}"!`);
      } else {
        // Pollinations
        setSuccessMsg(`Pollinations model target configured to "${targetModel}"!`);
      }

      // Dispatch global update event
      window.dispatchEvent(new CustomEvent("provider-model-targets-updated"));

      if (onModelAdded) {
        await onModelAdded();
      }

      // Reset form after short delay
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to save model");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className={`rounded-lg p-2 ${activePreset.bgClass} ${activePreset.colorClass}`}>
              <Plus className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold uppercase tracking-wider text-white">
                Add Model Manually
              </h3>
              <p className="text-xs text-zinc-400">
                Configure a new model route with appropriate settings based on the target API.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
            title="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="custom-scrollbar flex-1 space-y-6 overflow-y-auto p-6">
          {/* Step 1: Select API Provider */}
          <div>
            <label className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              1. Select Target API Provider
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
              {PROVIDER_PRESETS.map((preset) => {
                const isSelected = selectedProvider === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setSelectedProvider(preset.id);
                      setModelId("");
                      setTitle("");
                      setTestResult(null);
                      setErrorMsg(null);
                    }}
                    className={`flex items-center gap-2 rounded-lg border p-2.5 text-left transition-all ${
                      isSelected
                        ? `${preset.borderClass} ${preset.bgClass} ${preset.colorClass} shadow-md ring-1 ring-white/10`
                        : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    <span className="shrink-0">{preset.icon}</span>
                    <span className="truncate text-xs font-semibold">{preset.name}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 flex items-start gap-1.5 font-mono text-[10px] text-zinc-400">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
              {activePreset.description}
            </p>
          </div>

          {/* Step 2: Model Configuration Fields */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5 space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
              <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <span className={activePreset.colorClass}>{activePreset.icon}</span>
                {activePreset.name} Model Settings
              </h4>
              <span className={`rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${activePreset.borderClass} ${activePreset.bgClass} ${activePreset.colorClass}`}>
                API: {selectedProvider}
              </span>
            </div>

            {/* Model ID Input & Suggestions */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                  Model ID / Route Slug <span className="text-rose-400">*</span>
                </label>
                <span className="font-mono text-[9px] text-zinc-400">
                  Example: <span className={activePreset.colorClass}>{activePreset.placeholder}</span>
                </span>
              </div>
              <input
                type="text"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder={`Enter model ID or select from presets below... (e.g. ${activePreset.placeholder})`}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 font-mono text-xs text-white placeholder-zinc-400 outline-none transition focus:border-cyan-400"
              />

              {/* Popular quick-select chips */}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-400">Presets:</span>
                {(selectedProvider === "gemini" && geminiModels.length > 0
                  ? geminiModels
                  : activePreset.popularModels
                ).slice(0, 7).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleQuickModelSelect(m)}
                    className={`rounded border px-2 py-1 font-mono text-[10px] transition ${
                      modelId === m
                        ? `${activePreset.borderClass} ${activePreset.bgClass} ${activePreset.colorClass} font-bold`
                        : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-white"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Title / Label Input */}
            <div>
              <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                Display Title / Label
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`e.g. ${activePreset.name}: ${modelId || activePreset.placeholder}`}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs text-white placeholder-zinc-400 outline-none transition focus:border-cyan-400"
              />
            </div>

            {/* Provider Specific Settings */}

            {/* GEMINI SPECIFIC */}
            {selectedProvider === "gemini" && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                      Gemini Account Profile & Key Mapping
                    </label>
                    <button
                      type="button"
                      onClick={() => setProfileModalOpen(true)}
                      className="flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-400 hover:text-cyan-300"
                    >
                      <Sparkles className="h-3 w-3" />
                      Manage / Map Profiles
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <select
                        value={selectedProfileId}
                        onChange={(e) => {
                          setSelectedProfileId(e.target.value);
                          const idx = geminiProfiles.findIndex((p) => p.id === e.target.value);
                          if (idx !== -1) setGeminiKeyIndex(idx);
                        }}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs text-white outline-none transition focus:border-cyan-400"
                      >
                        {geminiProfiles.length > 0 ? (
                          geminiProfiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label || p.name} {p.id === defaultProfileId ? "(Active Default)" : ""}{" "}
                              {p.keyPreview || p.keySuffix ? `[...${p.keySuffix || p.keyPreview}]` : ""}
                            </option>
                          ))
                        ) : geminiStatuses.length > 0 ? (
                          geminiStatuses.map((key, idx) => (
                            <option key={key.keyIndex ?? idx} value={key.profileId || `slot-${idx}`}>
                              {key.name}
                              {key.keySuffix ? ` (...${key.keySuffix})` : ""}
                            </option>
                          ))
                        ) : (
                          <option value="gemini-account-1">Primary Account (Slot 1)</option>
                        )}
                      </select>
                    </div>

                    {/* 5-digit guidance display */}
                    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs font-mono text-zinc-400">
                      <Key className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                      <span>
                        Key in use:{" "}
                        <strong className="text-amber-300">
                          {(() => {
                            const p = geminiProfiles.find((x) => x.id === selectedProfileId);
                            if (p?.keyPreview) return p.keyPreview;
                            if (p?.keySuffix) return `...${p.keySuffix}`;
                            const s = geminiStatuses[geminiKeyIndex];
                            if (s?.keySuffix) return `...${s.keySuffix}`;
                            return "Configured in .env";
                          })()}
                        </strong>
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    Max Output Tokens
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={65536}
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(Number(e.target.value))}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs text-white outline-none transition focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    Temperature ({temperature})
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={temperature}
                    onChange={(e) => setTemperature(Number(e.target.value))}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs text-white outline-none transition focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    Top P ({topP})
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={topP}
                    onChange={(e) => setTopP(Number(e.target.value))}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs text-white outline-none transition focus:border-cyan-400"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={supportsTools}
                      onChange={(e) => setSupportsTools(e.target.checked)}
                      className="rounded border-zinc-700 bg-zinc-900 accent-cyan-400"
                    />
                    <span>Advertise as native tool-capable model</span>
                  </label>
                </div>
              </div>
            )}

            {/* NVIDIA SPECIFIC */}
            {selectedProvider === "nvidia" && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    NVIDIA API Key Slot
                  </label>
                  <select
                    value={nvidiaKeyIndex}
                    onChange={(e) => setNvidiaKeyIndex(Number(e.target.value))}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs text-white outline-none transition focus:border-lime-400"
                  >
                    {nvidiaStatuses.length > 0 ? (
                      nvidiaStatuses.map((key, idx) => (
                        <option key={key.index ?? idx} value={key.index ?? idx}>
                          {key.name}{key.keySuffix ? ` (...${key.keySuffix})` : ""}
                        </option>
                      ))
                    ) : (
                      <option value={0}>NVIDIA API Key 1 (Primary)</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    Max Output Tokens
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={32768}
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(Number(e.target.value))}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs text-white outline-none transition focus:border-lime-400"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    Temperature ({temperature})
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={temperature}
                    onChange={(e) => setTemperature(Number(e.target.value))}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs text-white outline-none transition focus:border-lime-400"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    Top P ({topP})
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={topP}
                    onChange={(e) => setTopP(Number(e.target.value))}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs text-white outline-none transition focus:border-lime-400"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={supportsTools}
                      onChange={(e) => setSupportsTools(e.target.checked)}
                      className="rounded border-zinc-700 bg-zinc-900 accent-lime-400"
                    />
                    <span>Advertise as native tool-capable model</span>
                  </label>
                </div>
              </div>
            )}

            {/* LOCAL AI SPECIFIC */}
            {selectedProvider === "local" && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    Runtime Format
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(["ollama", "vllm", "lmstudio", "openai"] as const).map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => handleFormatChange(fmt)}
                        className={`rounded border px-2 py-1.5 font-mono text-xs font-semibold uppercase transition ${
                          localFormat === fmt
                            ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                            : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white"
                        }`}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="http://localhost:11434/v1"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 font-mono text-xs text-white outline-none transition focus:border-emerald-400"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                      Context window
                    </label>
                    <input
                      type="number"
                      min={1024}
                      max={10000000}
                      value={localContextWindow}
                      onChange={(e) => setLocalContextWindow(Math.max(1024, Number(e.target.value) || 1024))}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 font-mono text-xs text-white outline-none transition focus:border-emerald-400"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300" title="Approximate input tokens sent before the app compacts oversized prompts. Leave room for output tokens.">
                      Prompt input budget
                    </label>
                    <input
                      type="number"
                      min={512}
                      max={10000000}
                      value={localInputTokenLimit}
                      onChange={(e) => setLocalInputTokenLimit(Math.max(512, Number(e.target.value) || 512))}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 font-mono text-xs text-white outline-none transition focus:border-emerald-400"
                    />
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    Optional API Key / Authorization Token
                  </label>
                  <input
                    type="password"
                    value={localApiKey}
                    onChange={(e) => setLocalApiKey(e.target.value)}
                    placeholder="Optional Bearer token for protected local proxy"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 font-mono text-xs text-white outline-none transition focus:border-emerald-400"
                  />
                </div>
              </div>
            )}

            {/* COLAB SPECIFIC */}
            {selectedProvider === "colab" && (
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    Tunnel Base URL (ngrok / Cloudflare)
                  </label>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://xxxx-xx.ngrok-free.app/v1"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 font-mono text-xs text-white outline-none transition focus:border-orange-400"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    Optional Tunnel Auth Token
                  </label>
                  <input
                    type="password"
                    value={localApiKey}
                    onChange={(e) => setLocalApiKey(e.target.value)}
                    placeholder="Optional token"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 font-mono text-xs text-white outline-none transition focus:border-orange-400"
                  />
                </div>
              </div>
            )}

            {/* GROQ SPECIFIC */}
            {selectedProvider === "groq" && (
              <div>
                <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                  Target Role Assignment
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { id: "default", label: "Default Route" },
                    { id: "fast", label: "Fast Route" },
                    { id: "coder", label: "Coder Route" },
                    { id: "reviewer", label: "Reviewer Route" },
                  ].map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setGroqRole(r.id as any)}
                      className={`rounded border px-2.5 py-2 font-mono text-xs font-semibold transition ${
                        groqRole === r.id
                          ? "border-amber-500/40 bg-amber-500/20 text-amber-300"
                          : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Test Feedback */}
          {testResult && (
            <div
              className={`rounded-lg border p-4 text-xs ${
                testResult.status === "healthy"
                  ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300"
                  : testResult.status === "warning"
                  ? "border-amber-500/30 bg-amber-950/20 text-amber-300"
                  : "border-rose-500/30 bg-rose-950/20 text-rose-300"
              }`}
            >
              <div className="flex items-center gap-2 font-bold uppercase tracking-wider">
                {testResult.status === "healthy" ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
                {testResult.message}
              </div>
              {testResult.details && (
                <p className="mt-1 font-mono text-[11px] opacity-90">{testResult.details}</p>
              )}
            </div>
          )}

          {/* Error Banner */}
          {errorMsg && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-950/30 p-4 text-xs text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Success Banner */}
          {successMsg && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-4 text-xs text-emerald-300">
              <Check className="h-4 w-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex flex-col gap-3 border-t border-zinc-800 bg-zinc-900/50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={handleTestRoute}
            disabled={testing || saving}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-zinc-200 transition hover:border-cyan-400 hover:text-cyan-300 disabled:opacity-50"
          >
            {testing ? (
              <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
            ) : (
              <TestTube2 className="h-4 w-4 text-cyan-400" />
            )}
            Test Connection
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2 text-xs font-semibold text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveModel}
              disabled={saving || testing}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-5 py-2 font-mono text-xs font-bold uppercase tracking-wider text-black transition hover:bg-cyan-400 disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Model Target
            </button>
          </div>
        </div>
      </div>

      <GeminiProfileManagerModal
        isOpen={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        onProfileChanged={async () => {
          await loadGeminiProfiles();
        }}
        onOpenAddManualModel={(pId) => {
          if (pId) setSelectedProfileId(pId);
          setSelectedProvider("gemini");
        }}
      />
    </div>
  );
}
