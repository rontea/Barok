import React, { useEffect, useState } from "react";
import { Cpu, Database, Flower2, LayoutTemplate, Network, Route, Settings, Sliders, X, Zap } from "lucide-react";
import { AddManualModelModal } from "./AddManualModelModal";
import { GeminiProfileManagerModal } from "./GeminiProfileManagerModal";

const APICheckerComponent = React.lazy(() =>
  import("./APICheckerComponent").then((module) => ({ default: module.APICheckerComponent })),
);
const KnowledgeSettingsPanel = React.lazy(() =>
  import("./KnowledgeSettingsPanel").then((module) => ({ default: module.KnowledgeSettingsPanel })),
);
const ModelCapabilitiesPanel = React.lazy(() =>
  import("./ModelCapabilitiesPanel").then((module) => ({ default: module.ModelCapabilitiesPanel })),
);
const DelegationSettingsPanel = React.lazy(() =>
  import("./DelegationSettingsPanel").then((module) => ({ default: module.DelegationSettingsPanel })),
);
const EngineSettingsPanel = React.lazy(() =>
  import("./EngineSettingsPanel").then((module) => ({ default: module.EngineSettingsPanel })),
);
const AppearanceSettingsPanel = React.lazy(() =>
  import("./AppearanceSettingsPanel").then((module) => ({ default: module.AppearanceSettingsPanel })),
);

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: string;
  model: string;
}

type SettingsSection =
  | "providers_monitor"
  | "providers_local"
  | "providers_colab"
  | "providers_requesty"
  | "providers_sambanova"
  | "providers_kimi"
  | "providers_gemini"
  | "providers_openrouter"
  | "providers_groq"
  | "providers_nvidia"
  | "providers_pollinations"
  | "engine"
  | "delegation"
  | "knowledge"
  | "appearance";

const sections: Array<{
  id: SettingsSection;
  label: string;
  icon: React.ReactNode;
  isSubItem?: boolean;
}> = [
  { id: "providers_monitor", label: "Manage Models", icon: <Zap className="h-4 w-4" /> },
  { id: "providers_local", label: "User local PC", icon: <Cpu className="h-4 w-4" />, isSubItem: true },
  { id: "providers_colab", label: "Colab Model", icon: <Cpu className="h-4 w-4" />, isSubItem: true },
  { id: "providers_requesty", label: "Requesty", icon: <Route className="h-4 w-4" />, isSubItem: true },
  { id: "providers_sambanova", label: "SambaNova", icon: <Cpu className="h-4 w-4" />, isSubItem: true },
  { id: "providers_kimi", label: "Kimi", icon: <Network className="h-4 w-4" />, isSubItem: true },
  { id: "providers_gemini", label: "Gemini", icon: <Flower2 className="h-4 w-4" />, isSubItem: true },
  { id: "providers_openrouter", label: "OpenRouter", icon: <Route className="h-4 w-4" />, isSubItem: true },
  { id: "providers_groq", label: "Groq", icon: <Cpu className="h-4 w-4" />, isSubItem: true },
  { id: "providers_nvidia", label: "NVIDIA", icon: <Cpu className="h-4 w-4" />, isSubItem: true },
  { id: "providers_pollinations", label: "Pollinations", icon: <Flower2 className="h-4 w-4" />, isSubItem: true },
  { id: "appearance", label: "Interface & Display", icon: <LayoutTemplate className="h-4 w-4" /> },
  { id: "engine", label: "Engine & Runtime", icon: <Sliders className="h-4 w-4" /> },
  { id: "delegation", label: "Agent delegation", icon: <Network className="h-4 w-4" /> },
  { id: "knowledge", label: "Knowledge Base", icon: <Database className="h-4 w-4" /> },
];

export function SettingsModal({ isOpen, onClose, workspace, model }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("providers_monitor");
  const [showAddManualModel, setShowAddManualModel] = useState(false);
  const [showGeminiProfiles, setShowGeminiProfiles] = useState(false);
  const [manualModelProfileId, setManualModelProfileId] = useState<string | undefined>();

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const provider = activeSection.replace("providers_", "");

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm sm:p-6 lg:p-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-400">
              <Settings className="h-5 w-5" />
            </div>
            <div>
              <h2 id="settings-title" className="text-lg font-semibold text-white">Settings</h2>
              <p className="text-xs text-zinc-400">Manage application configuration and integrations</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
            aria-label="Close settings"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="w-64 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-900/20 p-4" aria-label="Settings sections">
            <div className="space-y-1">
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all ${
                    activeSection === section.id
                      ? "bg-cyan-500/10 text-cyan-400"
                      : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                  } ${section.isSubItem ? "pl-8 text-xs" : ""}`}
                  aria-current={activeSection === section.id ? "page" : undefined}
                >
                  {section.icon}
                  {section.label}
                </button>
              ))}
            </div>
          </nav>

          <div className="custom-scrollbar flex-1 overflow-y-auto bg-zinc-950 p-6 md:p-8">
            <React.Suspense
              fallback={
                <div className="flex h-full min-h-40 items-center justify-center text-zinc-500">
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Loading section...
                  </div>
                </div>
              }
            >
              {activeSection === "providers_monitor" && (
                <div className="space-y-8">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-500/20 bg-cyan-950/10 p-4">
                    <div>
                      <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300">Provider setup tools</div>
                      <p className="mt-1 text-xs text-zinc-400">Manage Gemini account profiles or add a model route without leaving Settings.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        data-testid="open-gemini-profiles"
                        onClick={() => setShowGeminiProfiles(true)}
                        className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-cyan-200 transition hover:bg-cyan-500/20"
                      >
                        <Flower2 className="h-3.5 w-3.5" /> Gemini profiles
                      </button>
                      <button
                        type="button"
                        data-testid="open-add-manual-model"
                        onClick={() => {
                          setManualModelProfileId(undefined);
                          setShowAddManualModel(true);
                        }}
                        className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-200 transition hover:bg-emerald-500/20"
                      >
                        <Zap className="h-3.5 w-3.5" /> Add model route
                      </button>
                    </div>
                  </div>
                  <ModelCapabilitiesPanel selectedModel={model} />
                  <APICheckerComponent provider={provider} selectedModel={model} />
                </div>
              )}
              {activeSection !== "providers_monitor" && activeSection.startsWith("providers_") && (
                <APICheckerComponent provider={provider} selectedModel={model} />
              )}
              {activeSection === "appearance" && <AppearanceSettingsPanel />}
              {activeSection === "engine" && <EngineSettingsPanel />}
              {activeSection === "delegation" && <DelegationSettingsPanel />}
              {activeSection === "knowledge" && <KnowledgeSettingsPanel workspace={workspace} />}
            </React.Suspense>
          </div>
        </div>
      </div>

      <GeminiProfileManagerModal
        isOpen={showGeminiProfiles}
        onClose={() => setShowGeminiProfiles(false)}
        onProfileChanged={() => {
          window.dispatchEvent(new CustomEvent("gemini-profiles-updated"));
          window.dispatchEvent(new CustomEvent("provider-model-targets-updated"));
        }}
        onOpenAddManualModel={(profileId) => {
          setManualModelProfileId(profileId);
          setShowGeminiProfiles(false);
          setShowAddManualModel(true);
        }}
      />
      <AddManualModelModal
        isOpen={showAddManualModel}
        initialProvider="gemini"
        initialProfileId={manualModelProfileId}
        onClose={() => setShowAddManualModel(false)}
        onModelAdded={() => {
          window.dispatchEvent(new CustomEvent("provider-model-targets-updated"));
        }}
      />
    </div>
  );
}
