import React, { useState, useEffect } from "react";
import { Play, FileText, CheckCircle, Sparkles, Terminal, Code } from "lucide-react";
import { RunAuditsPanel } from "./RunAuditsPanel";

interface ReactStudioProps {
  onFileGenerated?: () => void;
  workspace?: string;
  onSendToAgent?: (prompt: string) => void;
}

export default function ReactStudio({ onFileGenerated, workspace, onSendToAgent }: ReactStudioProps) {
  const [outputFileName, setOutputFileName] = useState("arcade-snake");
  const [appPreset, setAppPreset] = useState("Retro Snake Game (Neon Graphics, Web Audio Sound FX, High-Scores)");
  const [modelTarget, setModelTarget] = useState("gemini-3.5-flash");
  const [refreshKey, setRefreshKey] = useState(0);
  
  const [availableModels, setAvailableModels] = useState<{ value: string; label: string; group: string }[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  useEffect(() => {
    const fetchModels = async () => {
      setIsLoadingModels(true);
      try {
        const response = await fetch("/api/models");
        const data = await response.json();
        if (data.success) {
          const list: { value: string; label: string; group: string }[] = [];
          
          // Google Gemini Models
          if (data.gemini && data.gemini.length > 0) {
            data.gemini.forEach((m: any) => {
              list.push({
                value: m.name,
                label: `${m.displayName || m.name} (Gemini)`,
                group: "Google Gemini Models"
              });
            });
          } else {
            // default gemini fallback if none returned
            list.push(
              { value: "gemini-3.5-flash", label: "gemini-3.5-flash (recommended)", group: "Google Gemini Models" },
              { value: "gemini-3.1-pro-preview", label: "gemini-3.1-pro-preview (premium)", group: "Google Gemini Models" },
              { value: "gemini-3-flash-preview", label: "gemini-3-flash-preview", group: "Google Gemini Models" },
              { value: "gemini-3.1-flash-lite", label: "gemini-3.1-flash-lite", group: "Google Gemini Models" },
              { value: "gemini-2.5-pro", label: "gemini-2.5-pro", group: "Google Gemini Models" },
              { value: "gemini-2.5-flash", label: "gemini-2.5-flash", group: "Google Gemini Models" }
            );
          }

          // Pollinations Text Models
          if (data.pollinations && data.pollinations.text && data.pollinations.text.length > 0) {
            data.pollinations.text.forEach((item: any) => {
              if (typeof item === 'string') {
                list.push({ value: item, label: `${item} (Text)`, group: "Pollinations Text Models" });
              } else if (item && typeof item === 'object') {
                const name = item.name || item.id || '';
                const desc = item.description || '';
                list.push({
                  value: name,
                  label: desc ? `${desc} (${name})` : name,
                  group: "Pollinations Text Models"
                });
              }
            });
          } else {
            // fallback text models if none fetched
            list.push(
              { value: "openai-fast", label: "openai-fast", group: "Pollinations Text Models" },
              { value: "openai", label: "openai", group: "Pollinations Text Models" },
              { value: "mistral", label: "mistral", group: "Pollinations Text Models" },
              { value: "llama", label: "llama", group: "Pollinations Text Models" },
              { value: "qwen-large", label: "qwen-large", group: "Pollinations Text Models" }
            );
          }

          // Pollinations Image Models
          if (data.pollinations && data.pollinations.image && data.pollinations.image.length > 0) {
            data.pollinations.image.forEach((item: any) => {
              if (typeof item === 'string') {
                list.push({ value: item, label: `${item} (Image)`, group: "Pollinations Image Models" });
              } else if (item && typeof item === 'object') {
                const name = item.name || item.id || '';
                const desc = item.description || '';
                list.push({
                  value: name,
                  label: desc ? `${desc} (${name})` : name,
                  group: "Pollinations Image Models"
                });
              }
            });
          }

          setAvailableModels(list);
        } else {
          throw new Error("Failed response");
        }
      } catch (err) {
        console.error("Failed to load models:", err);
        // hardcoded default fallback
        setAvailableModels([
          { value: "gemini-3.5-flash", label: "gemini-3.5-flash (recommended)", group: "Google Gemini Models" },
          { value: "gemini-3.1-pro-preview", label: "gemini-3.1-pro-preview (premium)", group: "Google Gemini Models" },
          { value: "openai-fast", label: "openai-fast", group: "Pollinations Text Models" },
          { value: "openai", label: "openai", group: "Pollinations Text Models" },
          { value: "mistral", label: "mistral", group: "Pollinations Text Models" },
          { value: "llama", label: "llama", group: "Pollinations Text Models" },
          { value: "qwen-large", label: "qwen-large", group: "Pollinations Text Models" }
        ]);
      } finally {
        setIsLoadingModels(false);
      }
    };

    fetchModels();
  }, []);
  
  const [isBuilding, setIsBuilding] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [consoleAction, setConsoleAction] = useState<string | null>(null);
  const [steps, setSteps] = useState([
    { id: 1, name: "Inspect workspace directory to confirm it exists and is accessible for file creation", status: "idle" },
    { id: 2, name: "Create output HTML file with basic HTML5 structure including Tailwind CDN", status: "idle" },
    { id: 3, name: "Implement core utility/game logic with grid layout or custom states", status: "idle" },
    { id: 4, name: "Add customized visual options and dynamic animations", status: "idle" },
    { id: 5, name: "Integrate localStorage mechanics for state persistence", status: "idle" }
  ]);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [pollenCost, setPollenCost] = useState<number | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const presets = [
    "Retro Snake Game (Neon Graphics, Web Audio Sound FX, High-Scores)",
    "Modular Synthesizer (Oscillators, Sine Waves, Filter Envelopes, Waveform Visualizer)",
    "Collaborative Kanban Board & Pomodoro Workstation (Local Database)",
    "Universal Unit Converter (Fluid Metrics, Currency Rates, Scientific Scales)"
  ];

  const handleBuild = async () => {
    if (onSendToAgent) {
      const prompt = `Build a ${appPreset} app. Ensure the main file or project is named ${outputFileName}.`;
      onSendToAgent(prompt);
      return;
    }

    // Fallback if not using onSendToAgent
    setIsBuilding(true);
    setGeneratedCode(null);
    setPollenCost(null);
    setConsoleAction(null);
    
    // Reset steps to idle
    setSteps(prev => prev.map(s => ({ ...s, status: "idle" })));

    // Immediately start progressive visual step updates while the API call is in progress
    let activeStepIdx = 0;
    setSteps(prev => prev.map((s, idx) => idx === 0 ? { ...s, status: "running" } : s));
    setConsoleAction(`{\n  "action": "READ_DIR",\n  "path": "./"\n}`);

    const interval = setInterval(() => {
      activeStepIdx++;
      if (activeStepIdx < 5) {
        setSteps(prev => prev.map((s, idx) => {
          if (idx === activeStepIdx) return { ...s, status: "running" };
          if (idx < activeStepIdx) return { ...s, status: "success" };
          return s;
        }));

        if (activeStepIdx === 1) {
          setConsoleAction(`{\n  "action": "CREATE_FILE",\n  "file_path": "${outputFileName}.html"\n}`);
        } else if (activeStepIdx === 2) {
          setConsoleAction(`{\n  "action": "WRITE_LOGIC",\n  "preset": "${appPreset.substring(0, 30)}..."\n}`);
        } else if (activeStepIdx === 3) {
          setConsoleAction(`{\n  "action": "STYLE_APPLICATION",\n  "framework": "Tailwind CSS CDN"\n}`);
        } else if (activeStepIdx === 4) {
          setConsoleAction(`{\n  "action": "INTEGRATE_PERSISTENCE",\n  "target": "localStorage"\n}`);
        }
      } else {
        clearInterval(interval);
      }
    }, 1500);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appName: outputFileName,
          preset: appPreset,
          targetModel: modelTarget
        })
      });

      const data = await response.json();
      clearInterval(interval);

      if (data.success) {
        setSteps(prev => prev.map(s => ({ ...s, status: "success" })));
        setGeneratedCode(data.code);
        setPollenCost(data.pollenCost);
        setConsoleAction(`{\n  "action": "FILE_WRITTEN",\n  "file": "${outputFileName}.html",\n  "size": ${data.code?.length || 0} bytes\n}`);
        
        // Write file locally via our API so that it appears in the tree!
        await fetch("/api/file/write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filePath: `${outputFileName}.html`,
            content: data.code
          })
        });

        if (onFileGenerated) {
          onFileGenerated();
        }
        setRefreshKey(prev => prev + 1);
      } else {
        throw new Error(data.error || "Generation failed");
      }
    } catch (err: any) {
      clearInterval(interval);
      console.error(err);
      setSteps(prev => prev.map(s => s.status === "running" ? { ...s, status: "idle" } : s));
      setConsoleAction(`{\n  "error": "${err.message || "An unexpected error occurred during build"}"\n}`);
    } finally {
      setIsBuilding(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* AUTOPILOT FORM */}
      <div className="bg-bg-panel border border-border-main rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 bg-cyan-500/10 text-cyan-400 rounded-lg">
            <Sparkles className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">🚀 Autopilot App Creator</h2>
            <p className="text-[11px] text-text-dim mt-1">Instruct the core ReAct agent to compile a high-fidelity standalone application directly into your workspace.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-[10px] font-bold text-text-dim tracking-wider uppercase mb-2">Output File Name</label>
            <div className="flex bg-bg-main border border-border-main rounded px-4 py-2.5 focus-within:border-cyan-400 transition items-center">
              <input
                type="text"
                value={outputFileName}
                onChange={(e) => setOutputFileName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
                placeholder="arcade-snake"
                className="flex-1 bg-transparent text-xs text-white outline-none"
                disabled={isBuilding}
              />
              <span className="text-xs text-text-dark font-mono">.html</span>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-text-dim tracking-wider uppercase mb-2">App Preset Settings</label>
            <select
              value={appPreset}
              onChange={(e) => setAppPreset(e.target.value)}
              className="w-full bg-bg-main border border-border-main rounded px-4 py-2.5 text-xs text-white outline-none focus:border-cyan-400 transition"
              disabled={isBuilding}
            >
              {presets.map((preset, idx) => (
                <option key={idx} value={preset}>{preset}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pt-5 border-t border-border-main">
          <div className="text-[10px] text-text-dim flex items-center gap-2 font-mono uppercase tracking-wider">
            <span>Model target:</span>
            <select
              value={modelTarget}
              onChange={(e) => setModelTarget(e.target.value)}
              className="bg-bg-main border border-border-main rounded px-2 py-1 text-[10px] text-white focus:outline-none max-w-xs"
              disabled={isBuilding || isLoadingModels}
            >
              {isLoadingModels ? (
                <option>Loading models...</option>
              ) : (
                Array.from(new Set(availableModels.map(m => m.group))).map(group => (
                  <optgroup key={group} label={group} className="bg-bg-panel text-cyan-400 font-semibold text-[10px]">
                    {availableModels.filter(m => m.group === group).map(m => (
                      <option key={m.value} value={m.value} className="text-white bg-bg-main font-normal">
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                ))
              )}
            </select>
          </div>

          <button
            onClick={handleBuild}
            disabled={isBuilding || !outputFileName}
            className={`w-full md:w-auto px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 active:scale-95 transition text-black font-bold rounded text-xs uppercase tracking-wider flex items-center justify-center gap-2 ${
              isBuilding ? "opacity-60 cursor-not-allowed animate-pulse" : ""
            }`}
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            Build & Execute App Creator
          </button>
        </div>
      </div>

      {/* REASONING & RUNTIME STEPS */}
      <>
        {(isBuilding || generatedCode) && (
          <div
            className="grid grid-cols-1 lg:grid-cols-5 gap-6"
          >
            {/* Steps Checklist */}
            <div className="lg:col-span-3 bg-bg-panel border border-border-main rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4 border-b border-border-main pb-3">
                <div className={`w-2 h-2 rounded-full ${isBuilding ? "bg-amber-500 animate-ping" : "bg-cyan-400"}`} />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  {isBuilding ? "Agent is thinking..." : "App Compiling Complete"}
                </h3>
              </div>

              <div className="space-y-2">
                {steps.map((step) => (
                  <div
                    key={step.id}
                    className={`flex items-start gap-3 p-3 rounded border transition ${
                      step.status === "running"
                        ? "bg-amber-950/10 border-amber-500/30 text-amber-400"
                        : step.status === "success"
                          ? "bg-cyan-950/10 border-cyan-500/20 text-cyan-300"
                          : "bg-bg-main/40 border-border-main text-text-dim"
                    }`}
                  >
                    <div className="mt-0.5">
                      {step.status === "success" ? (
                        <CheckCircle className="w-3.5 h-3.5 text-cyan-400" />
                      ) : step.status === "running" ? (
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full border border-border-main" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[11px] leading-snug font-mono ${
                        step.status === "success" 
                          ? "text-slate-300" 
                          : step.status === "running" 
                            ? "text-amber-400" 
                            : "text-text-dark"
                      }`}>
                        {step.name}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Console / Terminal Action Display */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-bg-panel border border-border-main rounded-xl p-5 flex flex-col justify-between h-full min-h-[300px]">
                <div>
                  <div className="flex items-center gap-2 mb-4 border-b border-border-main pb-3 text-[10px] font-bold text-text-dim uppercase tracking-wider">
                    <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Active CLI Tool Action</span>
                  </div>

                  {consoleAction ? (
                    <pre className="p-4 bg-bg-main rounded border border-border-main font-mono text-[10px] leading-relaxed text-slate-300 overflow-x-auto select-none">
                      {consoleAction}
                    </pre>
                  ) : generatedCode ? (
                    <div className="space-y-4">
                      <div className="p-4 bg-bg-main rounded border border-border-main text-center">
                        <Code className="w-8 h-8 text-cyan-400 mx-auto mb-2" />
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider">Code Persisted</h4>
                        <p className="text-[10px] text-text-dim mt-1">Successfully written to /{outputFileName}.html</p>
                      </div>
                      
                      {pollenCost && (
                        <div className="flex justify-between items-center text-[10px] font-mono uppercase tracking-wider px-3 py-2.5 bg-cyan-950/10 border border-cyan-500/20 rounded">
                          <span className="text-text-dim">Total Credits Transacted</span>
                          <span className="font-mono text-cyan-400 font-bold">{pollenCost.toFixed(4)} tokens</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-10 text-text-dark text-[10px] font-mono uppercase tracking-wider">
                      // Waiting for compiler process launch
                    </div>
                  )}
                </div>

                {generatedCode && (
                  <button
                    onClick={() => setShowPreviewModal(true)}
                    className="w-full mt-4 py-2 bg-bg-active hover:bg-[#252528] border border-border-main text-[10px] font-bold text-white uppercase tracking-wider rounded transition"
                  >
                    Open Generated App Viewport
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </>

      {/* PREVIEW MODAL */}
      <>
        {showPreviewModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <div
              className="bg-bg-panel border border-border-main rounded-xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden shadow-2xl"
            >
              {/* Modal Header */}
              <div className="bg-bg-card px-6 py-4 border-b border-border-main flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block animate-pulse"></span>
                    Live Sandbox Viewport: {outputFileName}.html
                  </h3>
                  <p className="text-[10px] text-text-dim mt-1">
                    Isolated sandboxed environment executing your generated React/Tailwind application.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <a
                    href={`/${outputFileName}.html`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-black text-[10px] font-bold uppercase tracking-wider rounded transition flex items-center gap-1.5"
                  >
                    Open in New Tab
                  </a>
                  <button
                    onClick={() => setShowPreviewModal(false)}
                    className="px-3 py-1.5 bg-bg-active hover:bg-[#252528] text-text-dim hover:text-white text-[10px] font-bold uppercase tracking-wider rounded border border-border-main transition"
                  >
                    Close
                  </button>
                </div>
              </div>

              {/* Iframe Viewport Container */}
              <div className="flex-1 bg-white relative">
                <iframe
                  src={`/${outputFileName}.html`}
                  title={`${outputFileName} Preview`}
                  className="w-full h-full border-none"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-modals"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>
          </div>
        )}
      </>

      {/* RECENT REACT AUDIT LOGS DISPLAY */}
      <div className="pt-8 border-t border-border-main mt-10">
        <div className="mb-4">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse" />
            Recent ReAct Audit Logs (Autopilot)
          </h3>
          <p className="text-[10px] text-text-dim mt-1">
            Real-time telemetry and execution traces generated by the App Creator agent or test suites.
          </p>
        </div>
        <RunAuditsPanel key={refreshKey} workspace={workspace} />
      </div>
    </div>
  );
}
