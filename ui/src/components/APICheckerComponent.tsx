import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  Eye,
  Flower2,
  Loader2,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Save,
  Settings,
  ShieldAlert,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { ColabModelPool } from "./ColabModelPool";
import { ModelPropertiesOverview, type ModelPropertiesApi } from "./ModelPropertiesOverview";
import { SAMBANOVA_MODEL_IDS } from "../../../src/config/sambaNovaModels";
import {
  readLocalAiEndpointTestResults,
  saveLocalAiEndpointTestResult,
  type LocalAiEndpointTestResult,
} from "../utils/localAiEndpointTest";

interface APIStatus {
  name: string;
  status: "healthy" | "warning" | "error" | "loading";
  message: string;
  details?: string;
  testedAt?: number;
  latencyMs?: number;
}

interface OpenRouterModelTarget {
  id: string;
  title: string;
  modelId: string;
  value?: string;
  maxTokens?: number;
  contextLength?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  inputModalities?: string[];
  outputModalities?: string[];
  createdAt?: number;
  updatedAt?: number;
}

interface OpenRouterCatalogModel {
  id: string;
  name: string;
  contextLength?: number;
  maxCompletionTokens?: number;
  isFree?: boolean;
  supportsTools?: boolean;
  supportsMaxTokens?: boolean;
  supportsVision?: boolean;
  inputModalities?: string[];
  outputModalities?: string[];
}

interface OpenRouterSettingsSnapshot {
  targets: OpenRouterModelTarget[];
  structuredModel: string;
}

interface PollinationsModel {
  id: string;
  label: string;
  description?: string;
  provider?: string;
  category: "text" | "image" | "audio" | "video" | "embedding" | "unknown";
  inputModalities?: string[];
  outputModalities?: string[];
  capabilities?: string[];
  supportsTools?: boolean;
  supportsReasoning?: boolean;
  contextLength?: number;
  maxOutputTokens?: number;
  pricing?: Record<string, string | number>;
  isFree?: boolean;
}

interface GeminiKeyStatus extends APIStatus {
  keyIndex?: number;
  profileId?: string;
  keySuffix?: string;
  keyPreview?: string;
  model?: string;
  errorCode?: string;
  keyPosition?: string;
  usageCount?: number;
  errorCount?: number;
  lastUsed?: string;
  isPrimary?: boolean;
  assignedTargets?: string[];
}

interface NvidiaKeyStatus extends APIStatus {
  index: number;
  keySuffix?: string;
  keyPreview?: string;
  isPrimary?: boolean;
  assignedTargets?: string[];
}

interface NvidiaModelTarget {
  id: string;
  title: string;
  modelId: string;
  apiKeyIndex: number;
  apiFamily: "chat-completions";
  endpoint: "/chat/completions";
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  supportsTools?: boolean;
  notes?: string;
  value?: string;
  createdAt: number;
  updatedAt: number;
}

interface GeminiModelTarget {
  id: string;
  title: string;
  modelId: string;
  apiKeyIndex: number;
  profileId?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  supportsTools?: boolean;
  notes?: string;
  value?: string;
  createdAt: number;
  updatedAt: number;
}

interface NvidiaTargetTestStatus {
  status: "idle" | "loading" | "healthy" | "error" | "warning";
  message?: string;
}

interface ProviderRateLimitRoute {
  provider: string;
  model: string;
  tier: "free" | "paid" | "unknown";
  credentialIndex?: number;
  status: "available" | "near_limit" | "rate_limited" | "cooldown" | "quota_exhausted" | "billing_required";
  requestCount: number;
  successCount: number;
  failureCount: number;
  rateLimitHits: number;
  timeoutHits: number;
  pauseReason?: "rate_limit" | "timeouts" | "quota_exhausted" | "billing_required";
  remainingRequests?: number;
  remainingTokens?: number;
  pausedUntil?: string;
  retryAfterMs?: number;
  lastRequestAt?: string;
  lastError?: string;
  healthScore?: number;
}

interface LocalAIEndpoint {
  id: string;
  title: string;
  baseUrl: string;
  modelId: string;
  contextWindow?: number;
  runtimeContextWindow?: number;
  inputTokenLimit?: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  source?: "settings" | "environment";
}

const createLocalAIEndpoint = (index = 0): LocalAIEndpoint => {
  const now = Date.now();
  return {
    id: `local-ai-${now}-${index + 1}`,
    title: index === 0 ? "User local PC" : `User local PC ${index + 1}`,
    baseUrl: index === 0 ? "http://localhost:8080" : "http://localhost:8080",
    modelId: "",
    contextWindow: 32768,
    inputTokenLimit: 2750,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
};

const statusStyles: Record<APIStatus["status"], string> = {
  healthy: "border-cyan-500/20 bg-cyan-950/5",
  warning: "border-amber-500/20 bg-amber-950/10",
  error: "border-rose-500/20 bg-rose-950/10",
  loading: "border-cyan-500/20 bg-cyan-950/10",
};

const statusText: Record<APIStatus["status"], string> = {
  healthy: "text-cyan-400",
  warning: "text-amber-400",
  error: "text-rose-400",
  loading: "text-cyan-400",
};

const getKeySuffix = (key: any): string | undefined => {
  if (typeof key.keySuffix === "string" && key.keySuffix.trim()) {
    return key.keySuffix.trim();
  }

  const nameMatch = typeof key.name === "string" ? key.name.match(/\(\.\.\.([^)]+)\)/) : null;
  return nameMatch?.[1];
};

const formatCooldown = (milliseconds?: number): string => {
  if (!milliseconds || milliseconds <= 0) return "Ready";
  const seconds = Math.ceil(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.ceil(minutes / 60)}h`;
};

export const APICheckerComponent: React.FC<{ provider?: string; selectedModel?: string }> = ({ provider }) => {
  const [geminiStatuses, setGeminiStatuses] = useState<GeminiKeyStatus[]>([]);
  const [geminiTargets, setGeminiTargets] = useState<GeminiModelTarget[]>([]);
  const [geminiModels, setGeminiModels] = useState<string[]>([]);
  const [geminiModalOpen, setGeminiModalOpen] = useState(false);
  const [editingGeminiTargets, setEditingGeminiTargets] = useState<GeminiModelTarget[]>([]);
  const [savingGeminiTargets, setSavingGeminiTargets] = useState(false);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [geminiTargetTests, setGeminiTargetTests] = useState<Record<string, NvidiaTargetTestStatus>>({});
  const [nvidiaStatuses, setNvidiaStatuses] = useState<NvidiaKeyStatus[]>([]);
  const [nvidiaTargets, setNvidiaTargets] = useState<NvidiaModelTarget[]>([]);
  const [nvidiaModalOpen, setNvidiaModalOpen] = useState(false);
  const [editingNvidiaTargets, setEditingNvidiaTargets] = useState<NvidiaModelTarget[]>([]);
  const [savingNvidiaTargets, setSavingNvidiaTargets] = useState(false);
  const [nvidiaError, setNvidiaError] = useState<string | null>(null);
  const [nvidiaTargetTests, setNvidiaTargetTests] = useState<Record<string, NvidiaTargetTestStatus>>({});
  const [openRouterStatus, setOpenRouterStatus] = useState<APIStatus | null>(null);
  const [testingOpenRouter, setTestingOpenRouter] = useState(false);
  const [openRouterModel, setOpenRouterModel] = useState("");
  const [openRouterStructuredModel, setOpenRouterStructuredModel] = useState("");
  const [openRouterTargets, setOpenRouterTargets] = useState<OpenRouterModelTarget[]>([]);
  const [openRouterModalOpen, setOpenRouterModalOpen] = useState(false);
  const [editingOpenRouterTargets, setEditingOpenRouterTargets] = useState<OpenRouterModelTarget[]>([]);
  const [editingOpenRouterStructuredModel, setEditingOpenRouterStructuredModel] = useState("");
  const [savingOpenRouterTargets, setSavingOpenRouterTargets] = useState(false);
  const [openRouterTargetsError, setOpenRouterTargetsError] = useState<string | null>(null);
  const [openRouterTargetTitle, setOpenRouterTargetTitle] = useState("");
  const [openRouterCatalogModels, setOpenRouterCatalogModels] = useState<OpenRouterCatalogModel[]>([]);
  const [loadingOpenRouterCatalog, setLoadingOpenRouterCatalog] = useState(false);
  const [testingOpenRouterTargetId, setTestingOpenRouterTargetId] = useState<string | null>(null);
  const [openRouterCatalogError, setOpenRouterCatalogError] = useState<string | null>(null);
  const [openRouterApiKeyConfigured, setOpenRouterApiKeyConfigured] = useState(false);
  const [sambaNovaStatus, setSambaNovaStatus] = useState<APIStatus | null>(null);
  const [testingSambaNova, setTestingSambaNova] = useState(false);
  const [sambaNovaModel, setSambaNovaModel] = useState("gpt-oss-120b");
  const [sambaNovaModels, setSambaNovaModels] = useState<string[]>([...SAMBANOVA_MODEL_IDS]);
  const [groqStatus, setGroqStatus] = useState<APIStatus | null>(null);
  const [testingGroq, setTestingGroq] = useState(false);
  const [groqModel, setGroqModel] = useState("");
  const [groqEnabled, setGroqEnabled] = useState(false);
  const [groqFastModel, setGroqFastModel] = useState("");
  const [groqCoderModel, setGroqCoderModel] = useState("");
  const [groqReviewerModel, setGroqReviewerModel] = useState("");
  const [groqMaxRequests, setGroqMaxRequests] = useState(10);
  const [groqFallbackEnabled, setGroqFallbackEnabled] = useState(false);
  const [groqFallbackProviders, setGroqFallbackProviders] = useState("");
  const [groqStreamingEnabled, setGroqStreamingEnabled] = useState(true);
  const [kimiStatus, setKimiStatus] = useState<APIStatus | null>(null);
  const [testingKimi, setTestingKimi] = useState(false);
  const [kimiModel, setKimiModel] = useState("kimi-k2.7-code");
  const [kimiModels, setKimiModels] = useState<string[]>([]);
  const [requestyStatus, setRequestyStatus] = useState<APIStatus | null>(null);
  const [testingRequesty, setTestingRequesty] = useState(false);
  const [requestyModel, setRequestyModel] = useState("poolside/laguna-m.1");
  const [requestyModels, setRequestyModels] = useState<string[]>([]);
  const [localAIEndpoints, setLocalAIEndpoints] = useState<LocalAIEndpoint[]>(() => [createLocalAIEndpoint()]);
  const [localAITests, setLocalAITests] = useState<Record<string, APIStatus>>(() =>
    Object.fromEntries(Object.entries(readLocalAiEndpointTestResults()).map(([id, result]) => [id, {
      name: result.endpointName,
      status: result.status,
      message: result.message,
      details: result.details,
      testedAt: result.testedAt,
      latencyMs: result.latencyMs,
    }])) as Record<string, APIStatus>
  );
  const [localAIError, setLocalAIError] = useState<string | null>(null);
  const [savingLocalAI, setSavingLocalAI] = useState(false);
  const [localAIDirty, setLocalAIDirty] = useState(false);
  const [savingProviderModel, setSavingProviderModel] = useState<"openrouter" | "groq" | "kimi" | "requesty" | "sambanova" | null>(null);
  const [pollinationsStatus, setPollinationsStatus] = useState<APIStatus | null>(null);
  const [pollinationsModels, setPollinationsModels] = useState<PollinationsModel[]>([]);
  const [pollinationsSyncedAt, setPollinationsSyncedAt] = useState<string | null>(null);
  const [pollinationsCatalogSource, setPollinationsCatalogSource] = useState<string | null>(null);
  const [pollinationsCatalogLoading, setPollinationsCatalogLoading] = useState(false);
  const [pollinationsCatalogSyncing, setPollinationsCatalogSyncing] = useState(false);
  const [pollinationsCatalogError, setPollinationsCatalogError] = useState<string | null>(null);
  const [poolStats, setPoolStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [testingPollinations, setTestingPollinations] = useState(false);
  const [autoCheck, setAutoCheck] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitRoutes, setRateLimitRoutes] = useState<ProviderRateLimitRoute[]>([]);
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);
  const [modelPropertiesApis, setModelPropertiesApis] = useState<ModelPropertiesApi[]>([]);
  const [modelPropertiesLoading, setModelPropertiesLoading] = useState(false);
  const [modelPropertiesError, setModelPropertiesError] = useState<string | null>(null);

  const loadModelProperties = async () => {
    setModelPropertiesLoading(true);
    try {
      const response = await fetch("/api/model-properties");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to load model properties");
      setModelPropertiesApis(Array.isArray(data.apis) ? data.apis : []);
      setModelPropertiesError(null);
    } catch (loadError: any) {
      setModelPropertiesError(loadError?.message || "Failed to load model properties");
    } finally {
      setModelPropertiesLoading(false);
    }
  };

  const loadPollinationsModelCatalog = async () => {
    setPollinationsCatalogLoading(true);
    try {
      const response = await fetch("/api/pollinations/model-catalog", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to load Pollinations model catalog");
      setPollinationsModels(Array.isArray(data.models) ? data.models : []);
      setPollinationsSyncedAt(typeof data.syncedAt === "string" && data.syncedAt ? data.syncedAt : null);
      setPollinationsCatalogSource(typeof data.source === "string" && data.source ? data.source : null);
      setPollinationsCatalogError(null);
    } catch (loadError: any) {
      setPollinationsCatalogError(loadError?.message || "Failed to load Pollinations model catalog");
    } finally {
      setPollinationsCatalogLoading(false);
    }
  };

  const syncPollinationsModelCatalog = async () => {
    setPollinationsCatalogSyncing(true);
    setPollinationsCatalogError(null);
    try {
      const response = await fetch("/api/pollinations/model-catalog/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to sync Pollinations model catalog");
      setPollinationsModels(Array.isArray(data.models) ? data.models : []);
      setPollinationsSyncedAt(typeof data.syncedAt === "string" ? data.syncedAt : null);
      setPollinationsCatalogSource(typeof data.source === "string" ? data.source : null);
      window.dispatchEvent(new CustomEvent("pollinations-model-catalog-updated"));
      await loadModelProperties();
    } catch (syncError: any) {
      setPollinationsCatalogError(syncError?.message || "Failed to sync Pollinations model catalog");
    } finally {
      setPollinationsCatalogSyncing(false);
    }
  };

  const loadRateLimits = async () => {
    try {
      const response = await fetch("/api/providers/rate-limits");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load provider rate limits");
      setRateLimitRoutes(Array.isArray(data.routes) ? data.routes : []);
      setRateLimitError(null);
    } catch (err: any) {
      setRateLimitError(err?.message || "Failed to load provider rate limits");
    }
  };

  const resetRateLimitRoute = async (route: ProviderRateLimitRoute) => {
    try {
      const response = await fetch("/api/providers/rate-limits/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: route.provider,
          model: route.model,
          credentialIndex: route.credentialIndex,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to reset provider route");
      await loadRateLimits();
    } catch (err: any) {
      setRateLimitError(err?.message || "Failed to reset provider route");
    }
  };

  const checkPollinationsAPI = async () => {
    setTestingPollinations(true);
    setPollinationsStatus((status) => ({
      name: "Pollinations API",
      status: "loading",
      message: "Testing Pollinations API...",
      details: status?.details,
    }));

    try {
      const response = await fetch("/api/pollinations/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "openai-fast" }),
      });
      const data = await response.json().catch(() => ({}));
      const healthy = response.ok && data.configured && data.isHealthy;
      setPollinationsStatus({
        name: "Pollinations API",
        status: healthy ? "healthy" : data.configured ? "warning" : "error",
        message: data.message || data.error || "Pollinations route test completed",
        details: `${data.model ? `Model: ${data.model}` : "Model unavailable"}${data.expectedResponse ? " | Validation response matched" : ""}${data.responsePreview ? ` | ${data.responsePreview}` : ""}`,
      });
    } catch {
      setPollinationsStatus({
        name: "Pollinations API",
        status: "error",
        message: "Network error during Pollinations test",
      });
    } finally {
      setTestingPollinations(false);
      await loadPollinationsModelCatalog();
    }
  };

  const checkOpenRouterAPI = async (runCompletionTest = false) => {
    setTestingOpenRouter(true);
    setOpenRouterStatus((status) => ({
      name: "OpenRouter Single Account",
      status: "loading",
      message: runCompletionTest ? "Testing configured OpenRouter route..." : "Checking OpenRouter credential...",
      details: status?.details,
    }));

    try {
      const response = await fetch(runCompletionTest ? "/api/openrouter/test" : "/api/openrouter/pool-status", {
        method: runCompletionTest ? "POST" : "GET",
      });
      const data = await response.json();
      if (typeof data.model === "string") setOpenRouterModel(data.model);
      const healthy = response.ok && data.configured && (runCompletionTest || data.isHealthy);
      const route = data.model ? `Route: ${data.model}` : "Route unavailable";
      const testedRoute = data.testedModel && data.testedModel !== data.model ? ` | Structured test: ${data.testedModel}` : "";
      setOpenRouterStatus({
        name: "OpenRouter Single Account",
        status: healthy ? "healthy" : data.configured ? "warning" : "error",
        message: data.message || data.error || "OpenRouter check completed",
        details: `${route}${testedRoute}${typeof data.usage === "number" ? ` | Usage: ${data.usage}` : ""}${typeof data.limitRemaining === "number" ? ` | Key limit remaining: ${data.limitRemaining}` : ""}${data.isFreeTier ? " | Free tier" : ""}${data.configurationWarning ? ` | ${data.configurationWarning}` : ""}`,
      });
    } catch {
      setOpenRouterStatus({
        name: "OpenRouter Single Account",
        status: "error",
        message: "Network error during OpenRouter test",
      });
    } finally {
      setTestingOpenRouter(false);
    }
  };

  const loadOpenRouterSettings = async (): Promise<OpenRouterSettingsSnapshot> => {
    try {
      const response = await fetch("/api/openrouter/settings");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load OpenRouter settings");
      if (typeof data.model === "string") setOpenRouterModel(data.model);
      const targets = Array.isArray(data.targets) ? data.targets : [];
      const structuredModel = typeof data.structuredModel === "string" ? data.structuredModel : "";
      setOpenRouterTargets(targets);
      setOpenRouterStructuredModel(structuredModel);
      setOpenRouterApiKeyConfigured(Boolean(data.apiKeyConfigured));
      return { targets: targets as OpenRouterModelTarget[], structuredModel };
    } catch (loadError: any) {
      setOpenRouterStatus({
        name: "OpenRouter Single Account",
        status: "warning",
        message: loadError?.message || "OpenRouter settings could not be loaded",
      });
      return { targets: [], structuredModel: "" };
    }
  };

  const loadOpenRouterCatalog = async () => {
    setLoadingOpenRouterCatalog(true);
    setOpenRouterCatalogError(null);
    try {
      const response = await fetch("/api/openrouter/models");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "OpenRouter model discovery failed");
      setOpenRouterCatalogModels(Array.isArray(data.models) ? data.models : []);
    } catch (loadError: any) {
      setOpenRouterCatalogError(loadError?.message || "OpenRouter model discovery failed");
    } finally {
      setLoadingOpenRouterCatalog(false);
    }
  };

  const addOpenRouterModel = async (makeDefault = false) => {
    const modelId = openRouterModel.trim();
    if (!modelId) return;
    const catalogModel = openRouterCatalogModels.find((model) => model.id.toLowerCase() === modelId.toLowerCase());
    setSavingProviderModel("openrouter");
    try {
      const response = await fetch("/api/openrouter/model-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId,
          title: openRouterTargetTitle.trim() || modelId,
          makeDefault,
          maxTokens: catalogModel?.maxCompletionTokens,
          contextLength: catalogModel?.contextLength,
          supportsTools: catalogModel?.supportsTools,
          supportsVision: catalogModel?.supportsVision,
          inputModalities: catalogModel?.inputModalities,
          outputModalities: catalogModel?.outputModalities,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save OpenRouter model");
      setOpenRouterTargets(Array.isArray(data.targets) ? data.targets : []);
      if (makeDefault && typeof data.model === "string") setOpenRouterModel(data.model);
      setOpenRouterTargetTitle("");
      await checkOpenRouterAPI();
      window.dispatchEvent(new CustomEvent("provider-model-targets-updated"));
    } catch (saveError: any) {
      setOpenRouterStatus({
        name: "OpenRouter Single Account",
        status: "error",
        message: saveError?.message || "Failed to save OpenRouter model",
      });
    } finally {
      setSavingProviderModel(null);
    }
  };

  const setOpenRouterDefault = async (target: OpenRouterModelTarget) => {
    setSavingProviderModel("openrouter");
    try {
      const response = await fetch("/api/openrouter/model-target", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: target.modelId,
          title: target.title,
          maxTokens: target.maxTokens,
          contextLength: target.contextLength,
          supportsTools: target.supportsTools,
          supportsVision: target.supportsVision,
          inputModalities: target.inputModalities,
          outputModalities: target.outputModalities,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to set the OpenRouter default model");
      setOpenRouterModel(typeof data.model === "string" ? data.model : target.modelId);
      setOpenRouterTargets(Array.isArray(data.targets) ? data.targets : openRouterTargets);
      await checkOpenRouterAPI();
    } catch (saveError: any) {
      setOpenRouterStatus({
        name: "OpenRouter Single Account",
        status: "error",
        message: saveError?.message || "Failed to set the OpenRouter default model",
      });
    } finally {
      setSavingProviderModel(null);
    }
  };

  const removeOpenRouterModel = async (target: OpenRouterModelTarget) => {
    try {
      const response = await fetch("/api/openrouter/model-targets/" + encodeURIComponent(target.id), { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to remove OpenRouter model");
      setOpenRouterTargets(Array.isArray(data.targets) ? data.targets : []);
      if (typeof data.model === "string") setOpenRouterModel(data.model);
      window.dispatchEvent(new CustomEvent("provider-model-targets-updated"));
    } catch (removeError: any) {
      setOpenRouterStatus({
        name: "OpenRouter Single Account",
        status: "error",
        message: removeError?.message || "Failed to remove OpenRouter model",
      });
    }
  };

  const openOpenRouterModelModal = async () => {
    const settings = await loadOpenRouterSettings();
    setOpenRouterTargetsError(null);
    setEditingOpenRouterTargets(settings.targets);
    setEditingOpenRouterStructuredModel(settings.structuredModel);
    setOpenRouterModalOpen(true);
  };

  const updateOpenRouterTarget = (index: number, updates: Partial<OpenRouterModelTarget>) => {
    setEditingOpenRouterTargets((targets) => targets.map((target, targetIndex) =>
      targetIndex === index ? { ...target, ...updates, updatedAt: Date.now() } : target,
    ));
  };

  const addOpenRouterTarget = () => {
    const now = Date.now();
    const catalogModel = openRouterCatalogModels[0];
    const modelId = catalogModel?.id || "openrouter/free";
    setEditingOpenRouterTargets((targets) => [
      ...targets,
      {
        id: "openrouter-target-" + now,
        title: catalogModel?.name || "OpenRouter Model " + (targets.length + 1),
        modelId,
        value: "openrouter:" + modelId,
        maxTokens: catalogModel?.maxCompletionTokens,
        contextLength: catalogModel?.contextLength,
        supportsTools: catalogModel?.supportsTools,
        supportsVision: catalogModel?.supportsVision,
        inputModalities: catalogModel?.inputModalities,
        outputModalities: catalogModel?.outputModalities,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  };

  const removeOpenRouterTarget = (index: number) => {
    setEditingOpenRouterTargets((targets) => targets.length <= 1 ? targets : targets.filter((_, targetIndex) => targetIndex !== index));
  };

  const saveOpenRouterTargets = async () => {
    setSavingOpenRouterTargets(true);
    setOpenRouterTargetsError(null);
    try {
      const response = await fetch("/api/openrouter/model-targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets: editingOpenRouterTargets,
          structuredModel: editingOpenRouterStructuredModel,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save OpenRouter model targets");
      const targets = Array.isArray(data.targets) ? data.targets : [];
      setOpenRouterTargets(targets);
      setEditingOpenRouterTargets(targets);
      if (typeof data.structuredModel === "string") {
        setOpenRouterStructuredModel(data.structuredModel);
        setEditingOpenRouterStructuredModel(data.structuredModel);
      }
      if (typeof data.model === "string") {
        setOpenRouterModel(data.model);
      }
      setOpenRouterModalOpen(false);
      window.dispatchEvent(new CustomEvent("provider-model-targets-updated"));
      await checkOpenRouterAPI();
    } catch (saveError: any) {
      setOpenRouterTargetsError(saveError?.message || "Failed to save OpenRouter model targets");
    } finally {
      setSavingOpenRouterTargets(false);
    }
  };

  const testOpenRouterModel = async (target: OpenRouterModelTarget) => {
    setTestingOpenRouterTargetId(target.id);
    try {
      const response = await fetch("/api/openrouter/model-targets/" + encodeURIComponent(target.id) + "/test", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "OpenRouter model test failed");
      setOpenRouterStatus({
        name: target.title,
        status: "healthy",
        message: data.message || "OpenRouter model target responded successfully",
        details: typeof data.responsePreview === "string" ? data.responsePreview : target.modelId,
      });
    } catch (testError: any) {
      setOpenRouterStatus({
        name: target.title,
        status: "error",
        message: testError?.message || "OpenRouter model test failed",
        details: target.modelId,
      });
    } finally {
      setTestingOpenRouterTargetId(null);
    }
  };

  const checkSambaNovaAPI = async (runCompletionTest = false) => {
    setTestingSambaNova(true);
    setSambaNovaStatus((status) => ({
      name: "SambaNova API Pool",
      status: "loading",
      message: runCompletionTest ? "Testing configured SambaNova route..." : "Checking SambaNova configuration...",
      details: status?.details,
    }));

    try {
      const response = await fetch(runCompletionTest ? "/api/sambanova/test" : "/api/sambanova/status", {
        method: runCompletionTest ? "POST" : "GET",
      });
      const data = await response.json();
      if (typeof data.model === "string") setSambaNovaModel(data.model);
      if (Array.isArray(data.models) && data.models.length > 0) setSambaNovaModels(data.models.filter((model: unknown): model is string => typeof model === "string"));
      const healthy = response.ok && data.configured && (runCompletionTest || data.isHealthy !== false);
      setSambaNovaStatus({
        name: "SambaNova API Pool",
        status: healthy ? "healthy" : data.configured ? "warning" : "error",
        message: data.message || data.error || "SambaNova check completed",
        details: `${data.model ? `Route: ${data.model}` : "Route unavailable"}${data.baseUrl ? ` | Base: ${data.baseUrl}` : ""}${data.plan?.free ? ` | Free credits: $${data.plan.free.creditsUsd}` : ""}`,
      });
    } catch {
      setSambaNovaStatus({
        name: "SambaNova API Pool",
        status: "error",
        message: "Network error during SambaNova test",
      });
    } finally {
      setTestingSambaNova(false);
    }
  };

  const checkGroqAPI = async (runCompletionTest = false) => {
    setTestingGroq(true);
    setGroqStatus((status) => ({
      name: "Groq Provider",
      status: "loading",
      message: runCompletionTest ? "Testing configured Groq route..." : "Checking Groq configuration...",
      details: status?.details,
    }));

    try {
      const response = await fetch(runCompletionTest ? "/api/groq/test" : "/api/groq/status", {
        method: runCompletionTest ? "POST" : "GET",
      });
      const data = await response.json();
      if (typeof data.model === "string") setGroqModel(data.model);
      if (data.settings) {
        setGroqEnabled(Boolean(data.settings.enabled));
        setGroqFastModel(String(data.settings.fastModel || ""));
        setGroqCoderModel(String(data.settings.coderModel || ""));
        setGroqReviewerModel(String(data.settings.reviewerModel || ""));
        setGroqMaxRequests(Number(data.settings.maxRequestsPerTask) || 10);
        setGroqFallbackEnabled(Boolean(data.settings.fallbackEnabled));
        setGroqFallbackProviders(Array.isArray(data.settings.fallbackProviders) ? data.settings.fallbackProviders.join(", ") : "");
        setGroqStreamingEnabled(data.settings.streamingEnabled !== false);
      }
      const healthy = response.ok && data.configured && (runCompletionTest || data.isHealthy);
      setGroqStatus({
        name: "Groq Provider",
        status: healthy ? "healthy" : data.configured ? "warning" : "error",
        message: data.message || data.error || "Groq check completed",
        details: `${data.model ? `Route: ${data.model}` : "Route unavailable"}${data.health?.state ? ` | Health: ${data.health.state}` : ""}${typeof data.queue?.pendingCount === "number" ? ` | Queue: ${data.queue.pendingCount} pending / ${data.queue.activeCount} active` : ""}${data.queue?.cooldownUntil ? ` | Cooldown: ${data.queue.cooldownUntil}` : ""}${data.configurationWarning ? ` | ${data.configurationWarning}` : ""}`,
      });
    } catch {
      setGroqStatus({
        name: "Groq Provider",
        status: "error",
        message: "Network error during Groq test",
      });
    } finally {
      setTestingGroq(false);
    }
  };

  const checkKimiAPI = async (runCompletionTest = false) => {
    setTestingKimi(true);
    setKimiStatus((status) => ({
      name: "Kimi API Pool",
      status: "loading",
      message: runCompletionTest ? "Testing configured Kimi route..." : "Checking Kimi credential and models...",
      details: status?.details,
    }));
    try {
      const response = await fetch(runCompletionTest ? "/api/kimi/test" : "/api/kimi/pool-status", {
        method: runCompletionTest ? "POST" : "GET",
      });
      const data = await response.json();
      if (typeof data.model === "string") setKimiModel(data.model);
      if (Array.isArray(data.models)) setKimiModels(data.models);
      const healthy = response.ok && data.configured && (runCompletionTest || data.isHealthy);
      setKimiStatus({
        name: "Kimi API Pool",
        status: healthy ? "healthy" : data.configured ? "warning" : "error",
        message: data.message || data.error || "Kimi check completed",
        details: `${data.model ? `Route: ${data.model}` : "Route unavailable"}${Array.isArray(data.models) && data.models.length ? ` | Available: ${data.models.join(", ")}` : ""}`,
      });
    } catch {
      setKimiStatus({ name: "Kimi API Pool", status: "error", message: "Network error during Kimi test" });
    } finally {
      setTestingKimi(false);
    }
  };

  const checkRequestyAPI = async (runCompletionTest = false) => {
    setTestingRequesty(true);
    setRequestyStatus((status) => ({
      name: "Requesty API Pool",
      status: "loading",
      message: runCompletionTest ? "Testing configured Requesty free route..." : "Discovering Requesty free models...",
      details: status?.details,
    }));
    try {
      const response = await fetch(runCompletionTest ? "/api/requesty/test" : "/api/requesty/pool-status", {
        method: runCompletionTest ? "POST" : "GET",
      });
      const data = await response.json();
      if (typeof data.model === "string") setRequestyModel(data.model);
      if (Array.isArray(data.models)) setRequestyModels(data.models);
      const healthy = response.ok && data.configured && (runCompletionTest || data.isHealthy);
      setRequestyStatus({
        name: "Requesty API Pool",
        status: healthy ? "healthy" : data.configured ? "warning" : "error",
        message: data.message || data.error || "Requesty check completed",
        details: `${data.model ? `Route: ${data.model}` : "Route unavailable"}${Array.isArray(data.models) ? ` | Free models: ${data.models.length}` : ""}`,
      });
    } catch {
      setRequestyStatus({ name: "Requesty API Pool", status: "error", message: "Network error during Requesty test" });
    } finally {
      setTestingRequesty(false);
    }
  };

  const loadLocalAIEndpoints = async (force = false) => {
    if (localAIDirty && !force) return;
    try {
      const response = await fetch("/api/local-ai/endpoints");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load local AI endpoints");
      const endpoints = Array.isArray(data.endpoints) ? data.endpoints : [];
      setLocalAIEndpoints(endpoints.length > 0 ? endpoints : [createLocalAIEndpoint()]);
      setLocalAIDirty(false);
      setLocalAIError(null);
    } catch (error: any) {
      setLocalAIError(error?.message || "Failed to load local AI endpoints");
    }
  };

  const updateLocalAIEndpoint = (index: number, updates: Partial<LocalAIEndpoint>) => {
    setLocalAIEndpoints((endpoints) => endpoints.map((endpoint, endpointIndex) =>
      endpointIndex === index ? { ...endpoint, ...updates, source: "settings", updatedAt: Date.now() } : endpoint,
    ));
    setLocalAIDirty(true);
  };

  const addLocalAIEndpoint = () => {
    setLocalAIEndpoints((endpoints) => [...endpoints, createLocalAIEndpoint(endpoints.length)]);
    setLocalAIDirty(true);
  };

  const removeLocalAIEndpoint = (index: number) => {
    setLocalAIEndpoints((endpoints) => endpoints.filter((_, endpointIndex) => endpointIndex !== index));
    setLocalAIDirty(true);
  };

  const saveLocalAIEndpoints = async () => {
    setSavingLocalAI(true);
    setLocalAIError(null);
    try {
      const response = await fetch("/api/local-ai/endpoints", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoints: localAIEndpoints }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save local AI endpoints");
      setLocalAIEndpoints(Array.isArray(data.endpoints) ? data.endpoints : []);
      setLocalAIDirty(false);
      window.dispatchEvent(new CustomEvent("provider-model-targets-updated"));
    } catch (error: any) {
      setLocalAIError(error?.message || "Failed to save local AI endpoints");
    } finally {
      setSavingLocalAI(false);
    }
  };

  const testLocalAIEndpoint = async (index: number) => {
    const endpoint = localAIEndpoints[index];
    if (!endpoint) return;
    const testStartedAt = performance.now();
    let latencyMs: number | undefined;
    setLocalAITests((tests) => ({
      ...tests,
      [endpoint.id]: { ...tests[endpoint.id], name: endpoint.title, status: "loading", message: "Discovering models and testing the local route..." },
    }));
    try {
      const response = await fetch("/api/local-ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
      latencyMs = Math.round(performance.now() - testStartedAt);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "User local PC test failed");
      const runtimeContextWindow = Number(data.runtimeContextWindow);
      const recommendedInputTokenLimit = Number(data.recommendedInputTokenLimit);
      const hasRuntimeContext = Number.isFinite(runtimeContextWindow) && runtimeContextWindow >= 1_024;
      const hasRecommendedInputLimit = Number.isFinite(recommendedInputTokenLimit) && recommendedInputTokenLimit >= 512;
      const testedEndpoint: LocalAIEndpoint = {
        ...endpoint,
        modelId: typeof data.model === "string" && data.model.trim() ? data.model.trim() : endpoint.modelId,
        ...(hasRuntimeContext ? {
          contextWindow: Math.floor(runtimeContextWindow),
          runtimeContextWindow: Math.floor(runtimeContextWindow),
        } : {}),
        ...(hasRecommendedInputLimit ? {
          inputTokenLimit: Math.min(endpoint.inputTokenLimit || Math.floor(recommendedInputTokenLimit), Math.floor(recommendedInputTokenLimit)),
        } : {}),
        source: "settings",
        updatedAt: Date.now(),
      };
      const endpointsToSave = localAIEndpoints.map((current, endpointIndex) => endpointIndex === index ? testedEndpoint : current);
      const saveResponse = await fetch("/api/local-ai/endpoints", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoints: endpointsToSave }),
      });
      const savedData = await saveResponse.json();
      if (!saveResponse.ok) throw new Error(savedData.error || "User local PC test succeeded, but saving the route failed");
      setLocalAIEndpoints(Array.isArray(savedData.endpoints) ? savedData.endpoints : endpointsToSave);
      setLocalAIDirty(false);
      window.dispatchEvent(new CustomEvent("provider-model-targets-updated"));
      const result: LocalAiEndpointTestResult = {
        endpointId: endpoint.id,
        endpointName: endpoint.title,
        status: "healthy",
        message: `${data.message || "User local PC route responded successfully."} Saved to Model Target.`,
        details: `${data.endpoint || endpoint.baseUrl} · ${data.model || endpoint.modelId}${Array.isArray(data.models) ? ` · ${data.models.length} model(s) discovered` : ""}${data.discoveryWarning ? ` · Discovery warning: ${data.discoveryWarning}` : ""}`,
        testedAt: Date.now(),
        latencyMs,
        endpointBaseUrl: endpoint.baseUrl,
        modelId: testedEndpoint.modelId,
      };
      saveLocalAiEndpointTestResult(result);
      setLocalAITests((tests) => ({
        ...tests,
        [endpoint.id]: {
          name: result.endpointName,
          status: result.status,
          message: result.message,
          details: result.details,
          testedAt: result.testedAt,
          latencyMs: result.latencyMs,
        },
      }));
    } catch (error: any) {
      latencyMs ??= Math.round(performance.now() - testStartedAt);
      const result: LocalAiEndpointTestResult = {
        endpointId: endpoint.id,
        endpointName: endpoint.title,
        status: "error",
        message: error?.message || "User local PC test failed",
        testedAt: Date.now(),
        latencyMs,
        endpointBaseUrl: endpoint.baseUrl,
        modelId: endpoint.modelId,
      };
      saveLocalAiEndpointTestResult(result);
      setLocalAITests((tests) => ({
        ...tests,
        [endpoint.id]: {
          name: result.endpointName,
          status: result.status,
          message: result.message,
          testedAt: result.testedAt,
          latencyMs: result.latencyMs,
        },
      }));
    }
  };

  const saveProviderModel = async (provider: "openrouter" | "groq" | "kimi" | "requesty" | "sambanova") => {
    const modelId = (provider === "openrouter" ? openRouterModel : provider === "groq" ? groqModel : provider === "kimi" ? kimiModel : provider === "requesty" ? requestyModel : sambaNovaModel).trim();
    if (!modelId) return;
    setSavingProviderModel(provider);
    try {
      const response = await fetch(`/api/${provider}/model-target`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Failed to save ${provider} model`);
      if (provider === "openrouter") await checkOpenRouterAPI();
      else if (provider === "groq") await checkGroqAPI();
      else if (provider === "kimi") await checkKimiAPI();
      else if (provider === "requesty") await checkRequestyAPI();
      else await checkSambaNovaAPI();
      window.dispatchEvent(new CustomEvent("provider-model-targets-updated"));
    } catch (error: any) {
      const message = error?.message || `Failed to save ${provider} model`;
      const status: APIStatus = {
        name: provider === "openrouter" ? "OpenRouter Single Account" : provider === "groq" ? "Groq Provider" : provider === "kimi" ? "Kimi API Pool" : provider === "requesty" ? "Requesty API Pool" : "SambaNova API Pool",
        status: "error",
        message,
      };
      if (provider === "openrouter") setOpenRouterStatus(status);
      else if (provider === "groq") setGroqStatus(status);
      else if (provider === "kimi") setKimiStatus(status);
      else if (provider === "requesty") setRequestyStatus(status);
      else setSambaNovaStatus(status);
    } finally {
      setSavingProviderModel(null);
    }
  };

  const saveGroqProviderSettings = async () => {
    setSavingProviderModel("groq");
    try {
      const response = await fetch("/api/groq/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: groqEnabled,
          defaultModel: groqModel.trim(),
          fastModel: groqFastModel.trim(),
          coderModel: groqCoderModel.trim(),
          reviewerModel: groqReviewerModel.trim(),
          maxRequestsPerTask: groqMaxRequests,
          fallbackEnabled: groqFallbackEnabled,
          fallbackProviders: groqFallbackProviders.split(",").map((value) => value.trim()).filter(Boolean),
          streamingEnabled: groqStreamingEnabled,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save Groq settings");
      await checkGroqAPI();
      window.dispatchEvent(new CustomEvent("provider-model-targets-updated"));
    } catch (error: any) {
      setGroqStatus({ name: "Groq Provider", status: "error", message: error?.message || "Failed to save Groq settings" });
    } finally {
      setSavingProviderModel(null);
    }
  };

  const checkAllAPIs = async () => {
    setLoading(true);
    setError(null);
    try {
      const poolRes = await fetch("/api/gemini/pool-status");
      if (poolRes.ok) {
        const poolData = await poolRes.json();
        setPoolStats(poolData);

        const keyStatuses: GeminiKeyStatus[] = (poolData.keys || []).map((key: any, idx: number) => {
          const keySuffix = getKeySuffix(key);
          return {
            name: key.label || key.name || `Gemini Account ${idx + 1}`,
            keyIndex: idx,
            profileId: key.id || key.profileId,
            keySuffix,
            keyPreview: key.keyPreview || (keySuffix ? `Key ${idx + 1} (...${keySuffix})` : key.name),
            status: key.isHealthy ? "healthy" : key.errorCount > 0 || key.errors > 0 ? "error" : "warning",
            // The pool endpoint verifies that the credential can list models;
            // it cannot prove that GenerateContent is enabled for the key's
            // Google project. The target-level Test button performs that
            // stronger inference check.
            message: key.status === 'cooldown'
              ? 'Profile is cooling down; queued work stays on this account'
              : key.isHealthy
                ? "Credential accepted"
                : "Profile needs attention",
            details: `${key.isHealthy ? "Model-list access verified; use Test target to verify generation" : "Check the provider error"} | Usage: ${key.usageCount || 0} | Errors: ${key.errorCount || key.errors || 0}`,
            model: key.preferredModel || key.model || "gemini",
            usageCount: key.usageCount || 0,
            errorCount: key.errorCount || key.errors || 0,
            lastUsed: key.lastUsed,
            isPrimary: key.isPrimary,
            assignedTargets: Array.isArray(key.assignedTargets) ? key.assignedTargets : [],
          };
        });
        setGeminiStatuses(keyStatuses);
        setGeminiTargets(Array.isArray(poolData.modelTargets) ? poolData.modelTargets : []);
      } else {
        setError(`Gemini profile status failed (${poolRes.status})`);
      }

      const nvidiaRes = await fetch("/api/nvidia/pool-status");
      if (nvidiaRes.ok) {
        const nvidiaData = await nvidiaRes.json();
        const keyStatuses: NvidiaKeyStatus[] = (nvidiaData.keys || []).map((key: any, idx: number) => ({
          name: key.isPrimary ? `NVIDIA API Key ${idx + 1} (Primary)` : `NVIDIA API Key ${idx + 1}`,
          index: Number(key.index ?? idx),
          keySuffix: key.keySuffix,
          keyPreview: key.keyPreview,
          isPrimary: key.isPrimary,
          assignedTargets: Array.isArray(key.assignedTargets) ? key.assignedTargets : [],
          status: key.isHealthy ? "healthy" : "warning",
          message: key.isHealthy ? "Credential accepted" : "Key needs attention",
          details: `${key.isHealthy ? "Model-list access verified; use Test target to verify generation" : "Check the provider error"} | ${(key.assignedTargets || []).length} model target(s) assigned`,
        }));
        setNvidiaStatuses(keyStatuses);
        setNvidiaTargets(Array.isArray(nvidiaData.modelTargets) ? nvidiaData.modelTargets : []);
      }

      await loadOpenRouterSettings();
      await checkOpenRouterAPI();
      await loadOpenRouterCatalog();
      await checkSambaNovaAPI();
      await checkGroqAPI();
      await checkKimiAPI();
      await checkRequestyAPI();
      await loadLocalAIEndpoints();
      await checkPollinationsAPI();
      await loadRateLimits();
      await loadModelProperties();

      setLastChecked(new Date().toLocaleTimeString());
    } catch (err: any) {
      setError(err.message || "API check failed");
    } finally {
      setLoading(false);
    }
  };

  const loadGeminiTargets = async () => {
    setGeminiError(null);
    try {
      const res = await fetch("/api/gemini/model-targets");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load Gemini model targets");
      setGeminiTargets(Array.isArray(data.targets) ? data.targets : []);
      setEditingGeminiTargets(Array.isArray(data.targets) ? data.targets : []);
      setGeminiModels(Array.isArray(data.models) ? data.models : []);
      if (Array.isArray(data.profiles || data.keys)) {
        setGeminiStatuses((data.profiles || data.keys).map((key: any, idx: number) => ({
          name: key.label || key.name || `Gemini Account ${idx + 1}`,
          keyIndex: Number(key.index ?? idx),
          profileId: key.id || key.profileId,
          keySuffix: key.keySuffix,
          keyPreview: key.keyPreview,
          isPrimary: key.isPrimary,
          assignedTargets: [],
          status: "healthy",
          message: "Account profile is configured",
          details: "Available for explicitly assigned Gemini model targets",
          usageCount: 0,
          errorCount: 0,
        })));
      }
    } catch (err: any) {
      setGeminiError(err.message || "Failed to load Gemini model targets");
    }
  };

  const openGeminiModelModal = async (keyIndex?: number) => {
    await loadGeminiTargets();
    setEditingGeminiTargets((targets) => {
      if (targets.length > 0) return targets;
      const now = Date.now();
      return [{
        id: `gemini-target-${now}`,
        title: keyIndex === undefined ? "Gemini Free Model" : `${geminiStatuses[keyIndex]?.name || 'Gemini Account'} Model`,
        modelId: "gemini-3.6-flash",
        apiKeyIndex: keyIndex ?? 0,
        profileId: geminiStatuses[keyIndex ?? 0]?.profileId,
        temperature: 0.2,
        maxTokens: 4096,
        topP: 0.95,
        supportsTools: true,
        createdAt: now,
        updatedAt: now,
      }];
    });
    setGeminiModalOpen(true);
  };

  const updateGeminiTarget = (index: number, updates: Partial<GeminiModelTarget>) => {
    setEditingGeminiTargets((targets) =>
      targets.map((target, targetIndex) =>
        targetIndex === index ? { ...target, ...updates, updatedAt: Date.now() } : target,
      ),
    );
  };

  const addGeminiTarget = () => {
    const now = Date.now();
    setEditingGeminiTargets((targets) => [
      ...targets,
      {
        id: `gemini-target-${now}`,
        title: `Gemini Model ${targets.length + 1}`,
        modelId: geminiModels[0] || "gemini-3.6-flash",
        apiKeyIndex: geminiStatuses[0]?.keyIndex ?? 0,
        profileId: geminiStatuses[0]?.profileId,
        temperature: 0.2,
        maxTokens: 4096,
        topP: 0.95,
        supportsTools: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  };

  const removeGeminiTarget = (index: number) => {
    setEditingGeminiTargets((targets) => targets.filter((_, targetIndex) => targetIndex !== index));
  };

  const saveGeminiTargets = async () => {
    setSavingGeminiTargets(true);
    setGeminiError(null);
    try {
      const res = await fetch("/api/gemini/model-targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: editingGeminiTargets }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save Gemini model targets");
      setGeminiTargets(Array.isArray(data.targets) ? data.targets : []);
      setGeminiModalOpen(false);
      window.dispatchEvent(new CustomEvent("gemini-model-targets-updated"));
      await checkAllAPIs();
    } catch (err: any) {
      setGeminiError(err.message || "Failed to save Gemini model targets");
    } finally {
      setSavingGeminiTargets(false);
    }
  };

  const testGeminiTarget = async (targetId: string) => {
    setGeminiTargetTests((tests) => ({
      ...tests,
      [targetId]: { status: "loading", message: "Testing target..." },
    }));

    try {
      const res = await fetch(`/api/gemini/model-targets/${encodeURIComponent(targetId)}/test`, {
        method: "POST",
      });
      const data = await res.json();
      setGeminiTargetTests((tests) => ({
        ...tests,
        [targetId]: {
          status: res.ok && data.configured ? "healthy" : "error",
          message: data.message || data.error || "Validation complete",
        },
      }));
    } catch {
      setGeminiTargetTests((tests) => ({
        ...tests,
        [targetId]: { status: "error", message: "Network error during validation" },
      }));
    }
  };

  const loadNvidiaTargets = async () => {
    setNvidiaError(null);
    try {
      const res = await fetch("/api/nvidia/model-targets");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load NVIDIA model targets");
      setNvidiaTargets(Array.isArray(data.targets) ? data.targets : []);
      setEditingNvidiaTargets(Array.isArray(data.targets) ? data.targets : []);
      if (Array.isArray(data.keys)) {
        setNvidiaStatuses(data.keys.map((key: any, idx: number) => ({
          name: key.isPrimary ? `NVIDIA API Key ${idx + 1} (Primary)` : `NVIDIA API Key ${idx + 1}`,
          index: Number(key.index ?? idx),
          keySuffix: key.keySuffix,
          keyPreview: key.keyPreview,
          isPrimary: key.isPrimary,
          assignedTargets: [],
          status: "healthy",
          message: "Key is configured",
          details: "Available for NVIDIA model targets",
        })));
      }
    } catch (err: any) {
      setNvidiaError(err.message || "Failed to load NVIDIA model targets");
    }
  };

  const openNvidiaModelModal = async (keyIndex?: number) => {
    await loadNvidiaTargets();
    setEditingNvidiaTargets((targets) => {
      if (targets.length > 0) return targets;
      const now = Date.now();
      return [{
        id: `nvidia-target-${now}`,
        title: keyIndex === undefined ? "NVIDIA Custom Model" : `NVIDIA Key ${keyIndex + 1} Model`,
        modelId: "minimaxai/minimax-m3",
        apiKeyIndex: keyIndex ?? 0,
        apiFamily: "chat-completions",
        endpoint: "/chat/completions",
        temperature: 0.2,
        maxTokens: 4096,
        topP: 0.95,
        stream: false,
        supportsTools: true,
        createdAt: now,
        updatedAt: now,
      }];
    });
    setNvidiaModalOpen(true);
  };

  const updateNvidiaTarget = (index: number, updates: Partial<NvidiaModelTarget>) => {
    setEditingNvidiaTargets((targets) =>
      targets.map((target, targetIndex) =>
        targetIndex === index ? { ...target, ...updates, updatedAt: Date.now() } : target,
      ),
    );
  };

  const addNvidiaTarget = () => {
    const now = Date.now();
    setEditingNvidiaTargets((targets) => [
      ...targets,
      {
        id: `nvidia-target-${now}`,
        title: `NVIDIA Model ${targets.length + 1}`,
        modelId: "z-ai/glm-5.2",
        apiKeyIndex: nvidiaStatuses[0]?.index ?? 0,
        apiFamily: "chat-completions",
        endpoint: "/chat/completions",
        temperature: 0.2,
        maxTokens: 4096,
        topP: 0.95,
        stream: false,
        supportsTools: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  };

  const removeNvidiaTarget = (index: number) => {
    setEditingNvidiaTargets((targets) => targets.filter((_, targetIndex) => targetIndex !== index));
  };

  const saveNvidiaTargets = async () => {
    setSavingNvidiaTargets(true);
    setNvidiaError(null);
    try {
      const res = await fetch("/api/nvidia/model-targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: editingNvidiaTargets }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save NVIDIA model targets");
      setNvidiaTargets(Array.isArray(data.targets) ? data.targets : []);
      setNvidiaModalOpen(false);
      window.dispatchEvent(new CustomEvent("nvidia-model-targets-updated"));
      await checkAllAPIs();
    } catch (err: any) {
      setNvidiaError(err.message || "Failed to save NVIDIA model targets");
    } finally {
      setSavingNvidiaTargets(false);
    }
  };

  const testNvidiaTarget = async (targetId: string) => {
    setNvidiaTargetTests((tests) => ({
      ...tests,
      [targetId]: { status: "loading", message: "Testing target..." },
    }));

    try {
      const res = await fetch(`/api/nvidia/model-targets/${encodeURIComponent(targetId)}/test`, {
        method: "POST",
      });
      const data = await res.json();
      setNvidiaTargetTests((tests) => ({
        ...tests,
        [targetId]: {
          status: res.ok && data.configured ? "healthy" : "error",
          message: data.message || data.error || "Validation complete",
        },
      }));
    } catch {
      setNvidiaTargetTests((tests) => ({
        ...tests,
        [targetId]: { status: "error", message: "Network error during validation" },
      }));
    }
  };

  const checkGeminiKey = async (keyIndex: number) => {
    const profileId = geminiStatuses[keyIndex]?.profileId;
    setGeminiStatuses((statuses) =>
      statuses.map((status, index) =>
        index === keyIndex ? { ...status, status: "loading", message: "Testing profile..." } : status,
      ),
    );

    try {
      const res = await fetch(`/api/gemini/validate${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`);
      const data = await res.json();
      setGeminiStatuses((statuses) =>
        statuses.map((status, index) =>
          index === keyIndex
            ? {
                ...status,
                status: data.configured ? "healthy" : "error",
                message: data.message || data.error || "Validation complete",
                model: data.model || status.model,
                keyPosition: data.keyPosition,
                errorCode: data.errorCode,
              }
            : status,
        ),
      );
    } catch {
      setGeminiStatuses((statuses) =>
        statuses.map((status, index) =>
          index === keyIndex
            ? { ...status, status: "error", message: "Network error during validation" }
            : status,
        ),
      );
    }
  };

  useEffect(() => {
    checkAllAPIs();
  }, []);

  useEffect(() => {
    const refreshModelProperties = () => { void loadModelProperties(); };
    window.addEventListener("provider-model-targets-updated", refreshModelProperties);
    window.addEventListener("gemini-model-targets-updated", refreshModelProperties);
    window.addEventListener("nvidia-model-targets-updated", refreshModelProperties);
    window.addEventListener("pollinations-model-catalog-updated", refreshModelProperties);
    return () => {
      window.removeEventListener("provider-model-targets-updated", refreshModelProperties);
      window.removeEventListener("gemini-model-targets-updated", refreshModelProperties);
      window.removeEventListener("nvidia-model-targets-updated", refreshModelProperties);
      window.removeEventListener("pollinations-model-catalog-updated", refreshModelProperties);
    };
  }, []);

  useEffect(() => {
    if (!autoCheck) return;
    const interval = window.setInterval(checkAllAPIs, 30000);
    return () => window.clearInterval(interval);
  }, [autoCheck]);

  const shouldShowProvider = (target: string): boolean => {
    if (!provider) return true;
    return provider.toLowerCase() === target.toLowerCase();
  };

  const healthyGemini = geminiStatuses.filter((status) => status.status === "healthy").length;
  const healthyNvidia = nvidiaStatuses.filter((status) => status.status === "healthy").length;
  const totalGeminiErrors = geminiStatuses.reduce((sum, status) => sum + (status.errorCount || 0), 0);
  const totalRequests =
    poolStats?.totalRequests ??
    geminiStatuses.reduce((sum, status) => sum + (status.usageCount || 0), 0);
  const pollinationsTextModelCount = pollinationsModels.filter((model) => model.category === "text").length;
  const pollinationsCategorySummary = ["text", "image", "audio", "video", "embedding"]
    .map((category) => `${category}: ${pollinationsModels.filter((model) => model.category === category).length}`)
    .filter((entry) => !entry.endsWith(": 0"))
    .join(" · ");

  return (
    <div className="space-y-6">
      {shouldShowProvider("monitor") && (
        <>
          <section className="flex flex-col gap-6 rounded-xl border border-border-main bg-bg-panel p-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white">
            <Zap className="h-4 w-4 text-cyan-400" />
            API Health Monitor
          </h2>
          <p className="mt-1 text-xs text-text-dim">
            Live route status for local AI, Gemini, NVIDIA, OpenRouter, SambaNova, Groq, Kimi, Requesty, and Pollinations integrations.
          </p>
          {lastChecked && (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-text-dark">
              Last checked: {lastChecked}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-text-dim">
            <input
              type="checkbox"
              checked={autoCheck}
              onChange={(event) => setAutoCheck(event.target.checked)}
              className="rounded border-border-main bg-bg-main accent-cyan-400"
            />
            <span>Auto-check</span>
          </label>

          <button
            type="button"
            onClick={() => document.getElementById("local-ai-pool")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-500/20"
          >
            <Cpu className="h-3.5 w-3.5" />
            User local PC Setup
          </button>
          <button
            type="button"
            onClick={() => document.getElementById("colab-model-pool")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="flex items-center gap-1.5 rounded border border-orange-500/30 bg-orange-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-orange-300 transition hover:bg-orange-500/20"
          >
            <Cpu className="h-3.5 w-3.5" />
            Colab model setup
          </button>

          <button
            type="button"
            onClick={checkAllAPIs}
            disabled={loading}
            className="flex items-center gap-1.5 rounded bg-cyan-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-black transition hover:bg-cyan-400 disabled:opacity-70"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Check All
          </button>
        </div>
          </section>

          {error && (
            <div className="rounded border border-rose-500/20 bg-rose-950/10 p-3 text-sm text-rose-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard label="Available Gemini Profiles" value={`${healthyGemini}/${geminiStatuses.length}`} />
            <MetricCard label="Gemini Targets" value={String(geminiTargets.length)} />
            <MetricCard label="NVIDIA Keys" value={`${healthyNvidia}/${nvidiaStatuses.length}`} />
            <MetricCard label="NVIDIA Targets" value={String(nvidiaTargets.length)} />
            <MetricCard label="User local PC Routes" value={String(localAIEndpoints.filter((endpoint) => endpoint.enabled && endpoint.modelId).length)} />
            <MetricCard label="Total Errors" value={String(poolStats?.totalErrors ?? totalGeminiErrors)} alert={(poolStats?.totalErrors ?? totalGeminiErrors) > 0} />
          </div>

          <ModelPropertiesOverview
            apis={modelPropertiesApis}
            loading={modelPropertiesLoading}
            error={modelPropertiesError}
          />

          <section className="rounded-xl border border-border-main bg-bg-panel p-6">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white">
              <ShieldAlert className="h-4 w-4 text-amber-400" />
              Free Route Limits
            </h3>
            <p className="mt-1 text-xs text-text-dim">
              Temporary 429s use a cooldown. Exhausted quota and billing suspensions stay paused until reset, expiry, or a successful route test.
            </p>
          </div>
          <span className="self-start rounded border border-emerald-500/30 bg-emerald-950/20 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300 md:self-auto">
            Free / quota-based
          </span>
        </div>

        {rateLimitError ? (
          <div className="rounded border border-rose-500/20 bg-rose-950/10 p-3 text-sm text-rose-300">{rateLimitError}</div>
        ) : (
          <div className="overflow-x-auto rounded border border-border-main">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-bg-main text-[10px] font-bold uppercase tracking-wider text-text-dark">
                <tr>
                  <th className="px-3 py-2">Provider / model</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Health</th>
                  <th className="px-3 py-2">Requests</th>
                  <th className="px-3 py-2">429 hits</th>
                  <th className="px-3 py-2">Timeouts</th>
                  <th className="px-3 py-2">Cooldown</th>
                  <th className="px-3 py-2">Last activity</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-main">
                {rateLimitRoutes.map((route) => {
                  const rateLimited = route.status === "rate_limited";
                  const timeoutCooldown = route.status === "cooldown";
                  const nearLimit = route.status === "near_limit";
                  const quotaExhausted = route.status === "quota_exhausted";
                  const billingRequired = route.status === "billing_required";
                  const unavailable = rateLimited || timeoutCooldown || quotaExhausted || billingRequired;
                  return (
                    <tr key={`${route.provider}:${route.credentialIndex ?? "pool"}:${route.model}`} className="bg-bg-panel/60">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-white">
                          {route.provider}
                          {Number.isInteger(route.credentialIndex) && (
                            <span className="rounded border border-violet-500/30 bg-violet-950/20 px-1.5 py-0.5 font-mono text-[9px] text-violet-300">
                              Key {(route.credentialIndex || 0) + 1}
                            </span>
                          )}
                          <span className="rounded border border-emerald-500/30 bg-emerald-950/20 px-1.5 py-0.5 font-mono text-[9px] text-emerald-300">Free</span>
                        </div>
                        <div className="mt-0.5 max-w-[300px] truncate font-mono text-[10px] text-text-dim" title={route.model}>{route.model}</div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider ${
                          unavailable
                            ? "border-rose-500/30 bg-rose-950/20 text-rose-300"
                            : nearLimit
                              ? "border-amber-500/30 bg-amber-950/20 text-amber-300"
                              : "border-cyan-500/30 bg-cyan-950/20 text-cyan-300"
                        }`}>
                          {billingRequired
                            ? "Billing required"
                            : quotaExhausted
                              ? "Quota exhausted"
                              : rateLimited
                                ? "Rate paused"
                                : timeoutCooldown
                                  ? "Timeout paused"
                                  : nearLimit
                                    ? "Near limit"
                                    : "Available"}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono text-text-dim">
                        {typeof route.healthScore === "number" ? route.healthScore.toFixed(1) : "--"}
                      </td>
                      <td className="px-3 py-3 font-mono text-text-dim">{route.requestCount}</td>
                      <td className="px-3 py-3 font-mono text-text-dim">{route.rateLimitHits}</td>
                      <td className="px-3 py-3 font-mono text-text-dim">{route.timeoutHits || 0}</td>
                      <td className="px-3 py-3 font-mono text-text-dim">
                        {billingRequired || (quotaExhausted && !route.pausedUntil)
                          ? "Until resolved"
                          : formatCooldown(route.retryAfterMs)}
                      </td>
                      <td className="px-3 py-3 font-mono text-[10px] text-text-dim" title={route.lastError || "No provider errors recorded"}>
                        {route.lastRequestAt ? new Date(route.lastRequestAt).toLocaleTimeString() : "Not used yet"}
                      </td>
                      <td className="px-3 py-3">
                        {unavailable && (
                          <button
                            type="button"
                            onClick={() => void resetRateLimitRoute(route)}
                            className="rounded border border-border-main bg-bg-main px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-text-dim transition-colors hover:border-cyan-500/40 hover:text-cyan-300"
                            title="Clear the local pause. The provider will be attempted again and may immediately restore the pause if the account issue remains."
                          >
                            Retry route
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rateLimitRoutes.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-text-dim">No configured provider routes.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
          </section>
        </>
      )}

      {shouldShowProvider("local") && (
        <section id="local-ai-pool" className="scroll-mt-24 rounded-xl border border-border-main bg-bg-panel p-6">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-500/10 p-2.5 text-emerald-400">
              <Cpu className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">User local PC Pool</h3>
              <p className="mt-1 text-xs text-text-dim">
                OpenAI-compatible endpoints on localhost or your private network. A root URL such as http://localhost:8080 automatically uses /v1.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addLocalAIEndpoint}
              className="flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-500/20"
            >
              <Plus className="h-3.5 w-3.5" />
              Add User local PC
            </button>
            <button
              type="button"
              onClick={() => void saveLocalAIEndpoints()}
              disabled={savingLocalAI || !localAIDirty}
              className="flex items-center gap-1.5 rounded bg-emerald-400 px-4 py-2 text-xs font-bold uppercase tracking-wider text-black transition hover:bg-emerald-300 disabled:opacity-50"
            >
              {savingLocalAI ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save Routes
            </button>
          </div>
        </div>

        {localAIError && (
          <div className="mb-4 rounded border border-rose-500/20 bg-rose-950/10 p-3 text-sm text-rose-300">
            {localAIError}
          </div>
        )}

        <div className="space-y-3">
          {localAIEndpoints.map((endpoint, index) => {
            const testStatus = localAITests[endpoint.id];
            return (
              <div key={endpoint.id} className="rounded border border-border-main bg-bg-main/40 p-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1.4fr_1fr_0.7fr_0.8fr_auto]">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-text-dim">
                    Display name
                    <input
                      value={endpoint.title}
                      onChange={(event) => updateLocalAIEndpoint(index, { title: event.target.value })}
                      placeholder="User local PC"
                      className="mt-1.5 w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-xs normal-case tracking-normal text-white outline-none focus:border-emerald-500/60"
                    />
                  </label>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-text-dim">
                    OpenAI-compatible base URL
                    <input
                      value={endpoint.baseUrl}
                      onChange={(event) => updateLocalAIEndpoint(index, { baseUrl: event.target.value })}
                      placeholder="http://localhost:8080"
                      className="mt-1.5 w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-xs normal-case tracking-normal text-white outline-none focus:border-emerald-500/60"
                    />
                  </label>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-text-dim">
                    Model ID
                    <input
                      value={endpoint.modelId}
                      onChange={(event) => updateLocalAIEndpoint(index, { modelId: event.target.value })}
                      placeholder="Test to discover, or enter manually"
                      className="mt-1.5 w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-xs normal-case tracking-normal text-white outline-none focus:border-emerald-500/60"
                    />
                  </label>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-text-dim">
                    Context window
                    <input
                      type="number"
                      min={1024}
                      max={10000000}
                      value={endpoint.contextWindow ?? ""}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        updateLocalAIEndpoint(index, { contextWindow: Number.isFinite(value) && value >= 1024 ? Math.floor(value) : undefined });
                      }}
                      placeholder="32768"
                      className="mt-1.5 w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-xs normal-case tracking-normal text-white outline-none focus:border-emerald-500/60"
                    />
                  </label>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-text-dim" title="Approximate input tokens sent to this model before the app compacts oversized prompts. Leave room for output tokens.">
                    Prompt input budget
                    <input
                      type="number"
                      min={512}
                      max={10000000}
                      value={endpoint.inputTokenLimit ?? ""}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        updateLocalAIEndpoint(index, { inputTokenLimit: Number.isFinite(value) && value >= 512 ? Math.floor(value) : undefined });
                      }}
                      placeholder="2750"
                      className="mt-1.5 w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-xs normal-case tracking-normal text-white outline-none focus:border-emerald-500/60"
                    />
                  </label>
                  <div className="flex items-end gap-2">
                    <button
                      type="button"
                      onClick={() => void testLocalAIEndpoint(index)}
                      disabled={testStatus?.status === "loading" || !endpoint.baseUrl.trim()}
                      className="rounded border border-border-main bg-bg-active px-3 py-2 text-xs font-bold uppercase tracking-wider text-text-dim transition hover:text-white disabled:opacity-50"
                    >
                      {testStatus?.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Discover & Test"}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeLocalAIEndpoint(index)}
                      className="rounded border border-rose-500/20 bg-rose-950/10 p-2 text-rose-300 transition hover:bg-rose-950/30"
                      title="Remove local AI route"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-text-dim">
                    <input
                      type="checkbox"
                      checked={endpoint.enabled}
                      onChange={(event) => updateLocalAIEndpoint(index, { enabled: event.target.checked })}
                      className="accent-emerald-400"
                    />
                    Available in Model Target
                  </label>
                  {endpoint.source === "environment" && (
                    <span className="rounded border border-cyan-500/20 bg-cyan-950/20 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-cyan-300">
                      Loaded from LOCAL_MODEL_*
                    </span>
                  )}
                </div>
                {testStatus && (
                  <div className={`mt-3 rounded border p-3 ${statusStyles[testStatus.status]}`}>
                    <div className="flex items-start gap-3">
                      <StatusIcon status={testStatus.status} />
                      <div>
                        <p className={`text-xs font-bold ${statusText[testStatus.status]}`}>{testStatus.message}</p>
                        {testStatus.details && <p className="mt-1 font-mono text-[10px] text-text-dim">{testStatus.details}</p>}
                        {testStatus.testedAt && (
                          <p className="mt-1 text-[10px] text-text-dark">
                            Last test {new Date(testStatus.testedAt).toLocaleString()}
                            {Number.isFinite(testStatus.latencyMs) ? ` · ${testStatus.latencyMs} ms` : ''}. Results describe that test only; endpoint availability can change.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {localAIEndpoints.length === 0 && (
            <div className="rounded border border-dashed border-border-main p-6 text-center text-sm text-text-dim">
              No local endpoints configured. Add one to make it selectable in Coder Chat.
            </div>
          )}
        </div>
        </section>
      )}

      {shouldShowProvider("colab") && <ColabModelPool />}

      {shouldShowProvider("requesty") && (
        <section className="rounded-xl border border-border-main bg-bg-panel p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg bg-violet-500/10 p-2.5 text-violet-400">
            <Route className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">Requesty API Pool</h3>
            <p className="mt-1 text-xs text-text-dim">Zero-cost models discovered from the authenticated Requesty model catalog. Free tier currently allows 200 requests per day.</p>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-wider text-text-dim">
            Free model route
            <select
              value={requestyModel}
              onChange={(event) => setRequestyModel(event.target.value)}
              className="mt-1.5 w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-xs normal-case tracking-normal text-white outline-none focus:border-violet-500/60"
            >
              {(requestyModels.length ? requestyModels : ["poolside/laguna-m.1"]).map((modelId) => (
                <option key={modelId} value={modelId}>{modelId}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => saveProviderModel("requesty")}
            disabled={!requestyModel.trim() || savingProviderModel === "requesty"}
            className="rounded border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-violet-300 transition hover:bg-violet-500/20 disabled:opacity-50"
          >
            {savingProviderModel === "requesty" ? "Saving..." : "Save Model"}
          </button>
        </div>

        {requestyStatus ? (
          <div className={`rounded border p-4 ${statusStyles[requestyStatus.status]}`}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4">
                <StatusIcon status={requestyStatus.status} />
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white">{requestyStatus.name}</h4>
                  <p className="mt-1 text-sm text-slate-300">{requestyStatus.message}</p>
                  {requestyStatus.details && <p className="mt-1 font-mono text-[10px] text-text-dim">{requestyStatus.details}</p>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => checkRequestyAPI(true)}
                disabled={testingRequesty || requestyStatus.status === "loading"}
                className="self-end rounded border border-border-main bg-bg-active px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-text-dim transition hover:bg-[#252528] hover:text-white disabled:opacity-60 md:self-auto"
              >
                {testingRequesty || requestyStatus.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test Route"}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded border border-border-main bg-bg-main/40 p-4 text-sm text-text-dim">Checking Requesty API pool...</div>
        )}
        </section>
      )}

      {shouldShowProvider("sambanova") && (
        <section className="rounded-xl border border-border-main bg-bg-panel p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg bg-fuchsia-500/10 p-2.5 text-fuchsia-400">
            <Cpu className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">SambaNova API Pool</h3>
            <p className="mt-1 text-xs text-text-dim">
              Direct SambaNova Cloud route. The API key stays server-side in <span className="font-mono">SAMBANOVA_API_KEY</span>; the selected model is saved here and exposed as a Model Target.
            </p>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-wider text-text-dim">
            Model route
            <select
              value={sambaNovaModel}
              onChange={(event) => setSambaNovaModel(event.target.value)}
              className="mt-1.5 w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-xs normal-case tracking-normal text-white outline-none focus:border-fuchsia-500/60"
            >
              {Array.from(new Set([sambaNovaModel, ...sambaNovaModels].filter(Boolean))).map((modelId) => (
                <option key={modelId} value={modelId}>{modelId}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => saveProviderModel("sambanova")}
            disabled={!sambaNovaModel.trim() || savingProviderModel === "sambanova"}
            className="rounded border border-fuchsia-500/30 bg-fuchsia-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-fuchsia-300 transition hover:bg-fuchsia-500/20 disabled:opacity-50"
          >
            {savingProviderModel === "sambanova" ? "Saving..." : "Save Model"}
          </button>
        </div>

        {sambaNovaStatus ? (
          <div className={`rounded border p-4 ${statusStyles[sambaNovaStatus.status]}`}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4">
                <StatusIcon status={sambaNovaStatus.status} />
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white">{sambaNovaStatus.name}</h4>
                  <p className="mt-1 text-sm text-slate-300">{sambaNovaStatus.message}</p>
                  {sambaNovaStatus.details && <p className="mt-1 font-mono text-[10px] text-text-dim">{sambaNovaStatus.details}</p>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => checkSambaNovaAPI(true)}
                disabled={testingSambaNova || sambaNovaStatus.status === "loading"}
                className="self-end rounded border border-border-main bg-bg-active px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-text-dim transition hover:bg-[#252528] hover:text-white disabled:opacity-60 md:self-auto"
              >
                {testingSambaNova || sambaNovaStatus.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test Route"}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded border border-border-main bg-bg-main/40 p-4 text-sm text-text-dim">Checking SambaNova API pool...</div>
        )}

        </section>
      )}

      {shouldShowProvider("kimi") && (
        <section className="rounded-xl border border-border-main bg-bg-panel p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg bg-sky-500/10 p-2.5 text-sky-400">
            <Cpu className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">Kimi API Pool</h3>
            <p className="mt-1 text-xs text-text-dim">Native Moonshot API models available to this account. K2.7 Code is the coding-oriented route.</p>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-wider text-text-dim">
            Model route
            <select
              value={kimiModel}
              onChange={(event) => setKimiModel(event.target.value)}
              className="mt-1.5 w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-xs normal-case tracking-normal text-white outline-none focus:border-sky-500/60"
            >
              {(kimiModels.length ? kimiModels : ["kimi-k2.6", "kimi-k2.7-code"]).map((modelId) => (
                <option key={modelId} value={modelId}>{modelId}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => saveProviderModel("kimi")}
            disabled={!kimiModel.trim() || savingProviderModel === "kimi"}
            className="rounded border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-sky-300 transition hover:bg-sky-500/20 disabled:opacity-50"
          >
            {savingProviderModel === "kimi" ? "Saving..." : "Save Model"}
          </button>
        </div>

        {kimiStatus ? (
          <div className={`rounded border p-4 ${statusStyles[kimiStatus.status]}`}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4">
                <StatusIcon status={kimiStatus.status} />
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white">{kimiStatus.name}</h4>
                  <p className="mt-1 text-sm text-slate-300">{kimiStatus.message}</p>
                  {kimiStatus.details && <p className="mt-1 font-mono text-[10px] text-text-dim">{kimiStatus.details}</p>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => checkKimiAPI(true)}
                disabled={testingKimi || kimiStatus.status === "loading"}
                className="self-end rounded border border-border-main bg-bg-active px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-text-dim transition hover:bg-[#252528] hover:text-white disabled:opacity-60 md:self-auto"
              >
                {testingKimi || kimiStatus.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test Route"}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded border border-border-main bg-bg-main/40 p-4 text-sm text-text-dim">Checking Kimi API pool...</div>
        )}
        </section>
      )}

      {shouldShowProvider("gemini") && (
        <section className="rounded-xl border border-border-main bg-bg-panel p-6">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-cyan-500/10 p-2.5 text-cyan-400">
              <Radio className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">Gemini Account Profiles</h3>
              <p className="mt-1 text-xs text-text-dim">
                Configure isolated Gemini accounts and pin each model target to one profile.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => openGeminiModelModal()}
            className="flex items-center gap-1.5 rounded bg-cyan-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-black transition hover:bg-cyan-400"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Target
          </button>
        </div>

        {geminiError && (
          <div className="mb-4 rounded border border-rose-500/20 bg-rose-950/10 p-3 text-sm text-rose-300">
            {geminiError}
          </div>
        )}

        <div className="space-y-3">
          {geminiStatuses.length > 0 ? (
            geminiStatuses.map((status, index) => (
              <div
                key={`${status.name}-${index}`}
                className={`flex flex-col gap-4 rounded border p-4 transition md:flex-row md:items-start md:justify-between ${statusStyles[status.status]}`}
              >
                <div className="flex min-w-0 items-start gap-4">
                  <StatusIcon status={status.status} />
                  <div className="min-w-0">
                    <h4 className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                      {status.name}
                      {status.keySuffix && (
                        <span
                          title="Last 5 characters of the API key"
                          className="rounded border border-amber-500/30 bg-amber-950/20 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-amber-300"
                        >
                          ...{status.keySuffix}
                        </span>
                      )}
                      {status.model && (
                        <span className="rounded border border-border-main bg-bg-main px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-text-dark">
                          {status.model}
                        </span>
                      )}
                      {status.keyPosition && (
                        <span className="rounded border border-cyan-500/30 bg-cyan-950/30 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-cyan-400">
                          {status.keyPosition}
                        </span>
                      )}
                    </h4>
                    <p className="mt-1 text-sm text-slate-300">{status.message}</p>
                    {status.details && (
                      <p className="mt-1 font-mono text-[10px] text-text-dim">{status.details}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-text-dark">
                      {status.keyPreview && <span>Identifier: {status.keyPreview}</span>}
                      <span>Usage: {status.usageCount || 0}</span>
                      <span>Errors: {status.errorCount || 0}</span>
                      <span>
                        Last used:{" "}
                        {status.lastUsed ? new Date(status.lastUsed).toLocaleTimeString() : "Never"}
                      </span>
                      {status.errorCode && <span>Error code: {status.errorCode}</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(status.assignedTargets || []).length > 0 ? (
                        status.assignedTargets?.map((targetId) => {
                          const testStatus = geminiTargetTests[targetId]?.status || "idle";
                          const statusClass = testStatus === "healthy"
                            ? "border-cyan-500/30 bg-cyan-950/20 text-cyan-300"
                            : testStatus === "error"
                              ? "border-rose-500/30 bg-rose-950/20 text-rose-300"
                              : testStatus === "loading"
                                ? "border-amber-500/30 bg-amber-950/20 text-amber-300"
                                : "border-cyan-500/20 bg-cyan-950/20 text-cyan-300";

                          return (
                            <span key={targetId} className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] ${statusClass}`} title={geminiTargetTests[targetId]?.message || "Gemini model target"}>
                              <span>{targetId}</span>
                              <button
                                type="button"
                                onClick={() => testGeminiTarget(targetId)}
                                disabled={testStatus === "loading"}
                                className="ml-1 rounded px-1 text-[9px] font-bold uppercase tracking-wider transition hover:bg-white/10 disabled:opacity-60"
                                title={`Test ${targetId}`}
                              >
                                {testStatus === "loading" ? "..." : testStatus === "healthy" ? "OK" : testStatus === "error" ? "ERR" : "TEST"}
                              </button>
                            </span>
                          );
                        })
                      ) : (
                        <span className="font-mono text-[10px] text-text-dark">No assigned targets yet</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex self-end gap-2 md:self-auto">
                  <button
                    type="button"
                    onClick={() => openGeminiModelModal(index)}
                    className="rounded border border-border-main bg-bg-active p-2 text-text-dim transition hover:bg-[#252528] hover:text-white"
                    title="Configure Gemini model targets"
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => checkGeminiKey(index)}
                    disabled={status.status === "loading"}
                    className="rounded border border-border-main bg-bg-active px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-text-dim transition hover:bg-[#252528] hover:text-white disabled:opacity-60"
                  >
                    {status.status === "loading" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Test"
                    )}
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded border border-border-main bg-bg-main/40 p-4 text-sm text-text-dim">
              {loading ? "Loading Gemini profiles..." : "No Gemini account profiles are configured."}
            </div>
          )}
        </div>
        </section>
      )}

      {shouldShowProvider("openrouter") && (
        <section className="rounded-xl border border-border-main bg-bg-panel p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg bg-violet-500/10 p-2.5 text-violet-400">
            <Radio className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">OpenRouter Account &amp; Models</h3>
            <p className="mt-1 text-xs text-text-dim">Use the OpenRouter account configured in .env and manage multiple model routes in the database-backed settings below.</p>
          </div>
        </div>

        <div className="mb-5 rounded-lg border border-border-main bg-bg-main/30 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">Account credential</h4>
              <p className="mt-1 text-[10px] text-text-dim">
                {openRouterApiKeyConfigured
                  ? "Configured from OPENROUTER_API_KEY in .env"
                  : "No OPENROUTER_API_KEY found in .env"}
              </p>
            </div>
            {openRouterApiKeyConfigured && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
          </div>
          <p className="text-xs text-text-dim">API keys are never entered, stored, or displayed in Settings. Update .env and restart the server when changing the account.</p>
        </div>

        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-wider text-text-dim">
            Model ID
            <input
              value={openRouterModel}
              onChange={(event) => setOpenRouterModel(event.target.value)}
              placeholder="openrouter/free"
              list="openrouter-model-catalog"
              className="mt-1.5 w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-xs normal-case tracking-normal text-white outline-none focus:border-violet-500/60"
            />
          </label>
          <label className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-wider text-text-dim">
            Display name
            <input
              value={openRouterTargetTitle}
              onChange={(event) => setOpenRouterTargetTitle(event.target.value)}
              placeholder="Optional model label"
              className="mt-1.5 w-full rounded border border-border-main bg-bg-main px-3 py-2 text-xs normal-case tracking-normal text-white outline-none focus:border-violet-500/60"
            />
          </label>
          <button
            type="button"
            onClick={() => void addOpenRouterModel(false)}
            disabled={!openRouterModel.trim() || savingProviderModel === "openrouter"}
            className="rounded border border-border-main bg-bg-active px-4 py-2 text-xs font-bold uppercase tracking-wider text-text-dim transition hover:bg-[#252528] hover:text-white disabled:opacity-50"
          >
            Add Model
          </button>
          <button
            type="button"
            onClick={() => void addOpenRouterModel(true)}
            disabled={!openRouterModel.trim() || savingProviderModel === "openrouter"}
            className="rounded border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-violet-300 transition hover:bg-violet-500/20 disabled:opacity-50"
          >
            {savingProviderModel === "openrouter" ? "Saving..." : "Set as Default"}
          </button>
        </div>

        <datalist id="openrouter-model-catalog">
          {openRouterCatalogModels.map((catalogModel) => (
            <option key={catalogModel.id} value={catalogModel.id}>
              {catalogModel.name}
            </option>
          ))}
        </datalist>

        <div className="mb-5 rounded-lg border border-border-main bg-bg-main/20 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">Saved model routes</h4>
              <p className="mt-1 text-[10px] text-text-dim">Choose the default route or remove models from the picker.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void openOpenRouterModelModal()}
                className="rounded border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-300 transition hover:bg-violet-500/20"
              >
                Edit Models
              </button>
              <button
                type="button"
                onClick={() => void loadOpenRouterCatalog()}
                disabled={loadingOpenRouterCatalog}
                className="rounded border border-border-main bg-bg-active px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-text-dim transition hover:bg-[#252528] hover:text-white disabled:opacity-50"
              >
                {loadingOpenRouterCatalog ? "Loading..." : "Refresh Catalog"}
              </button>
            </div>
          </div>
          {openRouterCatalogError && <p className="mb-3 text-xs text-amber-300">{openRouterCatalogError}</p>}
          <div className="space-y-2">
            {openRouterTargets.map((target) => {
              const isDefault = target.modelId === openRouterModel;
              const isStructured = target.modelId === openRouterStructuredModel;
              return (
                <div key={target.id} className="flex flex-col gap-2 rounded border border-border-main bg-bg-panel/60 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-white">{target.title}</p>
                    <p className="truncate font-mono text-[10px] text-text-dim">{target.modelId}</p>
                    <p className="mt-0.5 text-[10px] text-text-dark">
                      {target.maxTokens ? "Max output " + target.maxTokens.toLocaleString() : "Max output: provider default"}
                      {target.contextLength ? " · Context " + target.contextLength.toLocaleString() : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isStructured && <span className="rounded border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-300">Structured</span>}
                    <button
                      type="button"
                      onClick={() => void testOpenRouterModel(target)}
                      disabled={testingOpenRouterTargetId === target.id}
                      className="rounded border border-cyan-500/20 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-50"
                    >
                      {testingOpenRouterTargetId === target.id ? "Testing..." : "Test"}
                    </button>
                    {isDefault ? (
                      <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300">Default</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void setOpenRouterDefault(target)}
                        disabled={savingProviderModel === "openrouter"}
                        className="rounded border border-border-main px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-text-dim hover:bg-bg-active hover:text-white disabled:opacity-50"
                      >
                        Use Default
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void removeOpenRouterModel(target)}
                      disabled={openRouterTargets.length <= 1}
                      className="rounded border border-rose-500/20 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {openRouterStatus ? (
          <div className={`rounded border p-4 ${statusStyles[openRouterStatus.status]}`}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4">
                <StatusIcon status={openRouterStatus.status} />
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white">{openRouterStatus.name}</h4>
                  <p className="mt-1 text-sm text-slate-300">{openRouterStatus.message}</p>
                  {openRouterStatus.details && <p className="mt-1 font-mono text-[10px] text-text-dim">{openRouterStatus.details}</p>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => checkOpenRouterAPI(true)}
                disabled={testingOpenRouter || openRouterStatus.status === "loading"}
                className="self-end rounded border border-border-main bg-bg-active px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-text-dim transition hover:bg-[#252528] hover:text-white disabled:opacity-60 md:self-auto"
              >
                {testingOpenRouter || openRouterStatus.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test Route"}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded border border-border-main bg-bg-main/40 p-4 text-sm text-text-dim">Checking OpenRouter single-account route...</div>
        )}
        </section>
      )}

      {shouldShowProvider("openrouter") && openRouterModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border-main bg-bg-panel shadow-2xl">
            <div className="flex items-center justify-between border-b border-border-main px-5 py-4">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">OpenRouter Model Settings</h3>
                <p className="mt-1 text-xs text-text-dim">
                  Edit saved model routes, output limits, and context windows used by the model picker and requests.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenRouterModalOpen(false)}
                className="rounded p-2 text-text-dim transition hover:bg-bg-active hover:text-white"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-5">
              <div className="rounded border border-violet-500/20 bg-violet-500/5 p-4">
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-violet-200">Structured fallback model</span>
                  <select
                    value={editingOpenRouterStructuredModel}
                    onChange={(event) => setEditingOpenRouterStructuredModel(event.target.value)}
                    className="w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-violet-400"
                  >
                    <option value="">Select a saved OpenRouter model</option>
                    {editingOpenRouterTargets.map((target) => (
                      <option key={`structured-${target.id}`} value={target.modelId}>{target.title} ({target.modelId})</option>
                    ))}
                  </select>
                  <span className="mt-1.5 block text-[10px] text-text-dim">Used for structured planning and Ox Alpha recovery. This choice is stored in SQLite with the model targets.</span>
                </label>
              </div>

              {editingOpenRouterTargets.map((target, index) => (
                <div key={`${target.id}-${index}`} className="rounded border border-border-main bg-bg-main/40 p-4">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-white">Model {index + 1}</h4>
                      <p className="mt-1 font-mono text-[10px] text-text-dark">
                        Model Target value: {target.value || "openrouter:" + target.modelId}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeOpenRouterTarget(index)}
                      disabled={editingOpenRouterTargets.length <= 1}
                      className="rounded border border-rose-500/20 bg-rose-950/10 p-2 text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-40"
                      title="Remove model"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-dim">Display name</span>
                      <input
                        value={target.title}
                        onChange={(event) => updateOpenRouterTarget(index, { title: event.target.value })}
                        placeholder="OpenRouter model"
                        className="w-full rounded border border-border-main bg-bg-main px-3 py-2 text-sm text-white outline-none transition focus:border-violet-400"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-dim">OpenRouter model ID</span>
                      <input
                        value={target.modelId}
                        onChange={(event) => {
                          const modelId = event.target.value;
                          const catalogModel = openRouterCatalogModels.find((model) => model.id.toLowerCase() === modelId.trim().toLowerCase());
                          updateOpenRouterTarget(index, {
                            modelId,
                            value: "openrouter:" + modelId,
                            ...(catalogModel ? {
                              maxTokens: catalogModel.maxCompletionTokens,
                              contextLength: catalogModel.contextLength,
                              supportsTools: catalogModel.supportsTools,
                              supportsVision: catalogModel.supportsVision,
                              inputModalities: catalogModel.inputModalities,
                              outputModalities: catalogModel.outputModalities,
                            } : {}),
                          });
                        }}
                        list="openrouter-model-catalog"
                        placeholder="provider/model-id"
                        className="w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-violet-400"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-dim">Max output tokens</span>
                      <input
                        type="number"
                        min={1}
                        max={1048576}
                        value={target.maxTokens ?? ""}
                        onChange={(event) => updateOpenRouterTarget(index, { maxTokens: event.target.value ? Number(event.target.value) : undefined })}
                        placeholder="From OpenRouter catalog"
                        className="w-full rounded border border-border-main bg-bg-main px-3 py-2 text-sm text-white outline-none transition focus:border-violet-400"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-dim">Context window</span>
                      <input
                        type="number"
                        min={1}
                        max={10000000}
                        value={target.contextLength ?? ""}
                        onChange={(event) => updateOpenRouterTarget(index, { contextLength: event.target.value ? Number(event.target.value) : undefined })}
                        placeholder="From OpenRouter catalog"
                        className="w-full rounded border border-border-main bg-bg-main px-3 py-2 text-sm text-white outline-none transition focus:border-violet-400"
                      />
                    </label>
                  </div>

                  <label className="mt-4 flex cursor-pointer items-center gap-2 font-mono text-xs text-text-dim">
                    <input
                      type="checkbox"
                      checked={target.supportsTools === true}
                      onChange={(event) => updateOpenRouterTarget(index, { supportsTools: event.target.checked })}
                      className="rounded border-border-main bg-bg-main accent-violet-400"
                    />
                    <span>Mark as tool-capable metadata</span>
                  </label>

                  <label className="mt-3 flex cursor-pointer items-start gap-2 font-mono text-xs text-text-dim">
                    <input
                      type="checkbox"
                      checked={target.supportsVision === true}
                      onChange={(event) => updateOpenRouterTarget(index, { supportsVision: event.target.checked })}
                      className="mt-0.5 rounded border-border-main bg-bg-main accent-violet-400"
                    />
                    <span>
                      <span className="flex items-center gap-1.5 text-violet-200"><Eye className="h-3.5 w-3.5" /> Enable image/video input</span>
                      <span className="mt-1 block text-[10px] text-text-dark">Sends attached images as OpenRouter multimodal content. Enable only when this model accepts image or video input.</span>
                    </span>
                  </label>

                  {(target.inputModalities?.length || target.outputModalities?.length) && (
                    <div className="mt-3 rounded border border-border-main bg-bg-main/40 px-3 py-2 text-[10px] text-text-dark">
                      {target.inputModalities?.length ? <div><strong className="text-text-dim">Input:</strong> {target.inputModalities.join(", ")}</div> : null}
                      {target.outputModalities?.length ? <div><strong className="text-text-dim">Output:</strong> {target.outputModalities.join(", ")}</div> : null}
                    </div>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={addOpenRouterTarget}
                className="flex w-full items-center justify-center gap-2 rounded border border-dashed border-border-main bg-bg-main/40 px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-dim transition hover:border-violet-400 hover:text-violet-300"
              >
                <Plus className="h-4 w-4" />
                Add Another OpenRouter Model
              </button>
            </div>

            <div className="flex flex-col gap-3 border-t border-border-main px-5 py-4 md:flex-row md:items-center md:justify-between">
              <p className="text-xs text-text-dim">
                {openRouterTargetsError || "Changes are persisted locally and reflected in Model Properties."}
              </p>
              <button
                type="button"
                onClick={saveOpenRouterTargets}
                disabled={savingOpenRouterTargets || editingOpenRouterTargets.length === 0}
                className="flex items-center justify-center gap-2 rounded bg-violet-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-black transition hover:bg-violet-400 disabled:opacity-70"
              >
                {savingOpenRouterTargets ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save Models
              </button>
            </div>
          </div>
        </div>
      )}

      {shouldShowProvider("groq") && (
        <section className="rounded-xl border border-border-main bg-bg-panel p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg bg-orange-500/10 p-2.5 text-orange-400">
            <Zap className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">Groq Provider</h3>
            <p className="mt-1 text-xs text-text-dim">One server-side Groq organization and its configured model route. Rate limits never rotate work to another Groq account.</p>
          </div>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex items-center gap-2 text-xs text-text-dim">
            <input type="checkbox" checked={groqEnabled} onChange={(event) => setGroqEnabled(event.target.checked)} />
            Enabled
          </label>
          <label className="flex items-center gap-2 text-xs text-text-dim">
            <input type="checkbox" checked={groqStreamingEnabled} onChange={(event) => setGroqStreamingEnabled(event.target.checked)} />
            Prefer streaming
          </label>
          <label className="flex items-center gap-2 text-xs text-text-dim">
            <input type="checkbox" checked={groqFallbackEnabled} onChange={(event) => setGroqFallbackEnabled(event.target.checked)} />
            Allow approved fallback
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-text-dim">
            Requests per task
            <input
              type="number"
              min={1}
              max={50}
              value={groqMaxRequests}
              onChange={(event) => setGroqMaxRequests(Number(event.target.value))}
              className="mt-1.5 w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-xs normal-case tracking-normal text-white"
            />
          </label>
          <label className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-wider text-text-dim">
            Default model
            <input
              value={groqModel}
              onChange={(event) => setGroqModel(event.target.value)}
              placeholder="Required model ID"
              className="mt-1.5 w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-xs normal-case tracking-normal text-white outline-none focus:border-orange-500/60"
            />
          </label>
          <label className="min-w-0 text-[10px] font-bold uppercase tracking-wider text-text-dim">
            Fast model
            <input value={groqFastModel} onChange={(event) => setGroqFastModel(event.target.value)} placeholder="Falls back to default" className="mt-1.5 w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-xs normal-case tracking-normal text-white" />
          </label>
          <label className="min-w-0 text-[10px] font-bold uppercase tracking-wider text-text-dim">
            Coder model
            <input value={groqCoderModel} onChange={(event) => setGroqCoderModel(event.target.value)} placeholder="Falls back to default" className="mt-1.5 w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-xs normal-case tracking-normal text-white" />
          </label>
          <label className="min-w-0 text-[10px] font-bold uppercase tracking-wider text-text-dim">
            Reviewer model
            <input value={groqReviewerModel} onChange={(event) => setGroqReviewerModel(event.target.value)} placeholder="Falls back to default" className="mt-1.5 w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-xs normal-case tracking-normal text-white" />
          </label>
          <label className="min-w-0 text-[10px] font-bold uppercase tracking-wider text-text-dim">
            Approved fallback order
            <input value={groqFallbackProviders} onChange={(event) => setGroqFallbackProviders(event.target.value)} placeholder="local, openrouter" className="mt-1.5 w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-xs normal-case tracking-normal text-white" />
          </label>
          <button
            type="button"
            onClick={() => void saveGroqProviderSettings()}
            disabled={!groqModel.trim() || savingProviderModel === "groq"}
            className="rounded border border-orange-500/30 bg-orange-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-orange-300 transition hover:bg-orange-500/20 disabled:opacity-50"
          >
            {savingProviderModel === "groq" ? "Saving..." : "Save Settings"}
          </button>
        </div>

        {groqStatus ? (
          <div className={`rounded border p-4 ${statusStyles[groqStatus.status]}`}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4">
                <StatusIcon status={groqStatus.status} />
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white">{groqStatus.name}</h4>
                  <p className="mt-1 text-sm text-slate-300">{groqStatus.message}</p>
                  {groqStatus.details && <p className="mt-1 font-mono text-[10px] text-text-dim">{groqStatus.details}</p>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => checkGroqAPI(true)}
                disabled={testingGroq || groqStatus.status === "loading"}
                className="self-end rounded border border-border-main bg-bg-active px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-text-dim transition hover:bg-[#252528] hover:text-white disabled:opacity-60 md:self-auto"
              >
                {testingGroq || groqStatus.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test Route"}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded border border-border-main bg-bg-main/40 p-4 text-sm text-text-dim">Checking Groq provider...</div>
        )}
        </section>
      )}

      {shouldShowProvider("nvidia") && (
        <section className="rounded-xl border border-border-main bg-bg-panel p-6">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-lime-500/10 p-2.5 text-lime-400">
              <Cpu className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">NVIDIA API Pool</h3>
              <p className="mt-1 text-xs text-text-dim">
                Assign masked NVIDIA keys to named model targets shown in Model Target.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => openNvidiaModelModal()}
            className="flex items-center gap-1.5 rounded bg-lime-400 px-4 py-2 text-xs font-bold uppercase tracking-wider text-black transition hover:bg-lime-300"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Target
          </button>
        </div>

        {nvidiaError && (
          <div className="mb-4 rounded border border-rose-500/20 bg-rose-950/10 p-3 text-sm text-rose-300">
            {nvidiaError}
          </div>
        )}

        <div className="space-y-3">
          {nvidiaStatuses.length > 0 ? (
            nvidiaStatuses.map((status) => (
              <div
                key={`nvidia-${status.index}`}
                className={`flex flex-col gap-4 rounded border p-4 transition md:flex-row md:items-start md:justify-between ${statusStyles[status.status]}`}
              >
                <div className="flex min-w-0 items-start gap-4">
                  <StatusIcon status={status.status} />
                  <div className="min-w-0">
                    <h4 className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                      {status.name}
                      {status.keySuffix && (
                        <span className="rounded border border-amber-500/30 bg-amber-950/20 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-amber-300">
                          ...{status.keySuffix}
                        </span>
                      )}
                    </h4>
                    <p className="mt-1 text-sm text-slate-300">{status.message}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(status.assignedTargets || []).length > 0 ? (
                        status.assignedTargets?.map((targetId) => {
                          const testStatus = nvidiaTargetTests[targetId]?.status || "idle";
                          const statusClass = testStatus === "healthy"
                            ? "border-cyan-500/30 bg-cyan-950/20 text-cyan-300"
                            : testStatus === "error"
                              ? "border-rose-500/30 bg-rose-950/20 text-rose-300"
                              : testStatus === "loading"
                                ? "border-amber-500/30 bg-amber-950/20 text-amber-300"
                                : "border-lime-500/20 bg-lime-950/20 text-lime-300";

                          return (
                            <span key={targetId} className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] ${statusClass}`} title={nvidiaTargetTests[targetId]?.message || "NVIDIA model target"}>
                              <span>{targetId}</span>
                              <button
                                type="button"
                                onClick={() => testNvidiaTarget(targetId)}
                                disabled={testStatus === "loading"}
                                className="ml-1 rounded px-1 text-[9px] font-bold uppercase tracking-wider transition hover:bg-white/10 disabled:opacity-60"
                                title={`Test ${targetId}`}
                              >
                                {testStatus === "loading" ? "..." : testStatus === "healthy" ? "OK" : testStatus === "error" ? "ERR" : "TEST"}
                              </button>
                            </span>
                          );
                        })
                      ) : (
                        <span className="font-mono text-[10px] text-text-dark">No assigned targets yet</span>
                      )}
                    </div>
                    {status.keyPreview && (
                      <p className="mt-2 font-mono text-[10px] text-text-dark">Identifier: {status.keyPreview}</p>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => openNvidiaModelModal(status.index)}
                  className="self-end rounded border border-border-main bg-bg-active p-2 text-text-dim transition hover:bg-[#252528] hover:text-white md:self-auto"
                  title="Configure NVIDIA model targets"
                >
                  <Settings className="h-4 w-4" />
                </button>
                {(status.assignedTargets || []).length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      for (const targetId of status.assignedTargets || []) {
                        void testNvidiaTarget(targetId);
                      }
                    }}
                    className="self-end rounded border border-border-main bg-bg-active px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-text-dim transition hover:bg-[#252528] hover:text-white md:self-auto"
                  >
                    Test All
                  </button>
                )}
              </div>
            ))
          ) : (
            <div className="rounded border border-border-main bg-bg-main/40 p-4 text-sm text-text-dim">
              {loading ? "Loading NVIDIA pool..." : "No NVIDIA API keys reported. Add NVIDIA_API_KEY or NVIDIA_API_KEYS in .env."}
            </div>
          )}
        </div>
        </section>
      )}

      {shouldShowProvider("pollinations") && (
        <section className="rounded-xl border border-border-main bg-bg-panel p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg bg-emerald-500/10 p-2.5 text-emerald-400">
            <Flower2 className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">Pollinations API</h3>
            <p className="mt-1 text-xs text-text-dim">Live completion route and account status.</p>
          </div>
        </div>

        {pollinationsStatus ? (
          <div className={`rounded border p-4 ${statusStyles[pollinationsStatus.status]}`}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4">
                <StatusIcon status={pollinationsStatus.status} />
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                    {pollinationsStatus.name}
                  </h4>
                  <p className="mt-1 text-sm text-slate-300">{pollinationsStatus.message}</p>
                  {pollinationsStatus.details && (
                    <p className="mt-1 font-mono text-[10px] text-text-dim">
                      {pollinationsStatus.details}
                    </p>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={checkPollinationsAPI}
                disabled={testingPollinations || pollinationsStatus.status === "loading"}
                className="self-end rounded border border-border-main bg-bg-active px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-text-dim transition hover:bg-[#252528] hover:text-white disabled:opacity-60 md:self-auto"
              >
                {testingPollinations || pollinationsStatus.status === "loading" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  "Test"
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 rounded border border-border-main bg-bg-main/40 p-4 text-sm text-text-dim md:flex-row md:items-center md:justify-between">
            <span>Checking Pollinations status...</span>
            <button
              type="button"
              onClick={checkPollinationsAPI}
              disabled={testingPollinations}
              className="self-end rounded border border-border-main bg-bg-active px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-text-dim transition hover:bg-[#252528] hover:text-white disabled:opacity-60 md:self-auto"
            >
              {testingPollinations ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test"}
            </button>
          </div>
        )}

        <div className="mt-5 rounded border border-border-main bg-bg-main/30 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">Saved Pollinations model registry</h4>
              <p className="mt-1 text-xs text-text-dim">
                Reloads from SQLite after a page restart. Sync pulls the current Pollinations catalog and saves it for the model picker.
              </p>
              <p className="mt-2 font-mono text-[10px] text-text-dark">
                {pollinationsModels.length > 0
                  ? `${pollinationsModels.length.toLocaleString()} model(s) - ${pollinationsTextModelCount.toLocaleString()} text route(s)${pollinationsCategorySummary ? ` - ${pollinationsCategorySummary}` : ""}`
                  : "No saved model catalog"}
                {pollinationsSyncedAt ? ` - synced ${new Date(pollinationsSyncedAt).toLocaleString()}` : ""}
              </p>
              {pollinationsCatalogSource && (
                <p className="mt-1 truncate font-mono text-[10px] text-text-dark" title={pollinationsCatalogSource}>
                  Source: {pollinationsCatalogSource}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={loadPollinationsModelCatalog}
                disabled={pollinationsCatalogLoading || pollinationsCatalogSyncing}
                className="flex items-center gap-1.5 rounded border border-border-main bg-bg-active px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-text-dim transition hover:text-white disabled:opacity-60"
              >
                {pollinationsCatalogLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Reload saved
              </button>
              <button
                type="button"
                onClick={syncPollinationsModelCatalog}
                disabled={pollinationsCatalogLoading || pollinationsCatalogSyncing}
                className="flex items-center gap-1.5 rounded bg-emerald-500 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-black transition hover:bg-emerald-400 disabled:opacity-60"
              >
                {pollinationsCatalogSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radio className="h-3.5 w-3.5" />}
                Sync models
              </button>
            </div>
          </div>

          {pollinationsCatalogError && (
            <div className="mt-3 rounded border border-rose-500/20 bg-rose-950/10 p-3 text-xs text-rose-300">
              {pollinationsCatalogError}
            </div>
          )}

          {pollinationsModels.length > 0 ? (
            <div className="custom-scrollbar mt-4 max-h-80 space-y-1 overflow-y-auto pr-1">
              {pollinationsModels.map((model) => (
                <div key={`${model.category}:${model.id}`} className="flex flex-col gap-1 rounded border border-border-main/60 bg-bg-panel/60 px-3 py-2 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-xs font-semibold text-white">{model.label}</span>
                      <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-cyan-300">{model.category}</span>
                      {model.isFree !== undefined && (
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-emerald-300">
                          {model.isFree ? "free" : "paid"}
                        </span>
                      )}
                    </div>
                    <p className="truncate font-mono text-[10px] text-text-dark" title={model.id}>{model.id}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 font-mono text-[10px] text-text-dim">
                    {model.contextLength ? <span>ctx {model.contextLength.toLocaleString()}</span> : null}
                    {model.supportsTools ? <span>tools</span> : null}
                    {model.supportsReasoning ? <span>reasoning</span> : null}
                    {model.inputModalities?.length ? <span>in {model.inputModalities.join(",")}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded border border-border-main bg-bg-panel/40 p-3 text-xs text-text-dim">
              Sync Pollinations models to save the live registry in the database.
            </div>
          )}
        </div>
        </section>
      )}

      {shouldShowProvider("gemini") && geminiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border-main bg-bg-panel shadow-2xl">
            <div className="flex items-center justify-between border-b border-border-main px-5 py-4">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">Gemini Model Targets</h3>
                <p className="mt-1 text-xs text-text-dim">
                  The title becomes the Model Target label. Each target pins one Gemini model to one account profile.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGeminiModalOpen(false)}
                className="rounded p-2 text-text-dim transition hover:bg-bg-active hover:text-white"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-5">
              {editingGeminiTargets.map((target, index) => (
                <div key={`${target.id}-${index}`} className="rounded border border-border-main bg-bg-main/40 p-4">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                        Target {index + 1}
                      </h4>
                      <p className="mt-1 font-mono text-[10px] text-text-dark">
                        Model Target value: gemini-target:{target.id || "auto-id"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeGeminiTarget(index)}
                      className="rounded border border-rose-500/20 bg-rose-950/10 p-2 text-rose-300 transition hover:bg-rose-500/20"
                      title="Remove target"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-dim">
                        Title
                      </span>
                      <input
                        value={target.title}
                        onChange={(event) => updateGeminiTarget(index, { title: event.target.value })}
                        placeholder="Gemini Flash on key 1"
                        className="w-full rounded border border-border-main bg-bg-main px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-dim">
                        Gemini Model ID
                      </span>
                      <select
                        value={target.modelId}
                        onChange={(event) => updateGeminiTarget(index, { modelId: event.target.value })}
                        className="w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-cyan-400"
                      >
                        {(geminiModels.length > 0 ? geminiModels : ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash"]).map((modelId) => (
                          <option key={modelId} value={modelId}>{modelId}</option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-dim">
                        Account Profile
                      </span>
                      <select
                        value={target.apiKeyIndex}
                        onChange={(event) => {
                          const apiKeyIndex = Number(event.target.value);
                          updateGeminiTarget(index, {
                            apiKeyIndex,
                            profileId: geminiStatuses.find((profile) => profile.keyIndex === apiKeyIndex)?.profileId,
                          });
                        }}
                        className="w-full rounded border border-border-main bg-bg-main px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
                      >
                        {geminiStatuses.length > 0 ? (
                          geminiStatuses.map((key, keyIndex) => (
                            <option key={key.keyIndex ?? keyIndex} value={key.keyIndex ?? keyIndex}>
                              {key.name}{key.keySuffix ? ` (...${key.keySuffix})` : ""}
                            </option>
                          ))
                        ) : (
                          <option value={0}>No Gemini account profile configured</option>
                        )}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-dim">
                        Max Tokens
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={65536}
                        value={target.maxTokens ?? 4096}
                        onChange={(event) => updateGeminiTarget(index, { maxTokens: Number(event.target.value) })}
                        className="w-full rounded border border-border-main bg-bg-main px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-dim">
                        Temperature
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={2}
                        step={0.1}
                        value={target.temperature ?? 0.2}
                        onChange={(event) => updateGeminiTarget(index, { temperature: Number(event.target.value) })}
                        className="w-full rounded border border-border-main bg-bg-main px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-dim">
                        Top P
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={target.topP ?? 0.95}
                        onChange={(event) => updateGeminiTarget(index, { topP: Number(event.target.value) })}
                        className="w-full rounded border border-border-main bg-bg-main px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
                      />
                    </label>
                  </div>

                  <label className="mt-4 flex cursor-pointer items-center gap-2 font-mono text-xs text-text-dim">
                    <input
                      type="checkbox"
                      checked={target.supportsTools === true}
                      onChange={(event) => updateGeminiTarget(index, { supportsTools: event.target.checked })}
                      className="rounded border-border-main bg-bg-main accent-cyan-400"
                    />
                    <span>Mark as tool-capable metadata</span>
                  </label>
                </div>
              ))}

              <button
                type="button"
                onClick={addGeminiTarget}
                className="flex w-full items-center justify-center gap-2 rounded border border-dashed border-border-main bg-bg-main/40 px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-dim transition hover:border-cyan-400 hover:text-cyan-300"
              >
                <Plus className="h-4 w-4" />
                Add Another Gemini Target
              </button>
            </div>

            <div className="flex flex-col gap-3 border-t border-border-main px-5 py-4 md:flex-row md:items-center md:justify-between">
              <p className="text-xs text-text-dim">
                Examples: <span className="font-mono text-cyan-300">gemini-3.6-flash</span>, <span className="font-mono text-cyan-300">gemini-3.5-flash-lite</span>
              </p>
              <button
                type="button"
                onClick={saveGeminiTargets}
                disabled={savingGeminiTargets}
                className="flex items-center justify-center gap-2 rounded bg-cyan-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-black transition hover:bg-cyan-400 disabled:opacity-70"
              >
                {savingGeminiTargets ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save Targets
              </button>
            </div>
          </div>
        </div>
      )}

      {shouldShowProvider("nvidia") && nvidiaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border-main bg-bg-panel shadow-2xl">
            <div className="flex items-center justify-between border-b border-border-main px-5 py-4">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">NVIDIA Model Targets</h3>
                <p className="mt-1 text-xs text-text-dim">
                  The title becomes the Model Target label. The model id is sent to NVIDIA chat completions.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNvidiaModalOpen(false)}
                className="rounded p-2 text-text-dim transition hover:bg-bg-active hover:text-white"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-5">
              {editingNvidiaTargets.map((target, index) => (
                <div key={`${target.id}-${index}`} className="rounded border border-border-main bg-bg-main/40 p-4">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                        Target {index + 1}
                      </h4>
                      <p className="mt-1 font-mono text-[10px] text-text-dark">
                        Model Target value: nvidia-target:{target.id || "auto-id"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeNvidiaTarget(index)}
                      className="rounded border border-rose-500/20 bg-rose-950/10 p-2 text-rose-300 transition hover:bg-rose-500/20"
                      title="Remove target"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-dim">
                        Title
                      </span>
                      <input
                        value={target.title}
                        onChange={(event) => updateNvidiaTarget(index, { title: event.target.value })}
                        placeholder="MiniMax M3 on key 1"
                        className="w-full rounded border border-border-main bg-bg-main px-3 py-2 text-sm text-white outline-none transition focus:border-lime-400"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-dim">
                        NVIDIA Model ID
                      </span>
                      <input
                        value={target.modelId}
                        onChange={(event) => updateNvidiaTarget(index, { modelId: event.target.value })}
                        placeholder="z-ai/glm-5.2"
                        className="w-full rounded border border-border-main bg-bg-main px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-lime-400"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-dim">
                        API Key
                      </span>
                      <select
                        value={target.apiKeyIndex}
                        onChange={(event) => updateNvidiaTarget(index, { apiKeyIndex: Number(event.target.value) })}
                        className="w-full rounded border border-border-main bg-bg-main px-3 py-2 text-sm text-white outline-none transition focus:border-lime-400"
                      >
                        {nvidiaStatuses.length > 0 ? (
                          nvidiaStatuses.map((key) => (
                            <option key={key.index} value={key.index}>
                              {key.name}{key.keySuffix ? ` (...${key.keySuffix})` : ""}
                            </option>
                          ))
                        ) : (
                          <option value={0}>NVIDIA API Key 1</option>
                        )}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-dim">
                        Max Tokens
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={32768}
                        value={target.maxTokens ?? 4096}
                        onChange={(event) => updateNvidiaTarget(index, { maxTokens: Number(event.target.value) })}
                        className="w-full rounded border border-border-main bg-bg-main px-3 py-2 text-sm text-white outline-none transition focus:border-lime-400"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-dim">
                        Temperature
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={2}
                        step={0.1}
                        value={target.temperature ?? 0.2}
                        onChange={(event) => updateNvidiaTarget(index, { temperature: Number(event.target.value) })}
                        className="w-full rounded border border-border-main bg-bg-main px-3 py-2 text-sm text-white outline-none transition focus:border-lime-400"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-dim">
                        Top P
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={target.topP ?? 0.95}
                        onChange={(event) => updateNvidiaTarget(index, { topP: Number(event.target.value) })}
                        className="w-full rounded border border-border-main bg-bg-main px-3 py-2 text-sm text-white outline-none transition focus:border-lime-400"
                      />
                    </label>
                  </div>

                  <label className="mt-4 flex cursor-pointer items-center gap-2 font-mono text-xs text-text-dim">
                    <input
                      type="checkbox"
                      checked={target.stream === true}
                      onChange={(event) => updateNvidiaTarget(index, { stream: event.target.checked })}
                      className="rounded border-border-main bg-bg-main accent-lime-400"
                    />
                    <span>Stream response chunks (stream)</span>
                  </label>

                  <label className="mt-4 flex cursor-pointer items-center gap-2 font-mono text-xs text-text-dim">
                    <input
                      type="checkbox"
                      checked={target.supportsTools === true}
                      onChange={(event) => updateNvidiaTarget(index, { supportsTools: event.target.checked })}
                      className="rounded border-border-main bg-bg-main accent-lime-400"
                    />
                    <span>Mark as tool-capable metadata</span>
                  </label>
                </div>
              ))}

              <button
                type="button"
                onClick={addNvidiaTarget}
                className="flex w-full items-center justify-center gap-2 rounded border border-dashed border-border-main bg-bg-main/40 px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-dim transition hover:border-lime-400 hover:text-lime-300"
              >
                <Plus className="h-4 w-4" />
                Add Another NVIDIA Target
              </button>
            </div>

            <div className="flex flex-col gap-3 border-t border-border-main px-5 py-4 md:flex-row md:items-center md:justify-between">
              <p className="text-xs text-text-dim">
                Examples: <span className="font-mono text-lime-300">minimaxai/minimax-m3</span>, <span className="font-mono text-lime-300">z-ai/glm-5.2</span>
              </p>
              <button
                type="button"
                onClick={saveNvidiaTargets}
                disabled={savingNvidiaTargets}
                className="flex items-center justify-center gap-2 rounded bg-lime-400 px-4 py-2 text-xs font-bold uppercase tracking-wider text-black transition hover:bg-lime-300 disabled:opacity-70"
              >
                {savingNvidiaTargets ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save Targets
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function MetricCard({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="rounded border border-border-main bg-bg-panel p-4">
      <span className="mb-1 block font-mono text-[9px] font-bold uppercase tracking-wider text-text-dim">
        {label}
      </span>
      <span className={`font-mono text-sm font-bold tracking-wide ${alert ? "text-rose-400" : "text-white"}`}>
        {value}
      </span>
    </div>
  );
}

function StatusIcon({ status }: { status: APIStatus["status"] }) {
  if (status === "healthy") return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />;
  if (status === "warning") return <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />;
  if (status === "loading") return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-cyan-400" />;
  return <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />;
}
