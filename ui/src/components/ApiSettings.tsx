import React from "react";
import { APICheckerComponent } from "./APICheckerComponent";

interface ApiSettingsProps {
  selectedModel?: string;
  provider?: string;
  children?: React.ReactNode;
}

export default function ApiSettings({ selectedModel, provider, children }: ApiSettingsProps) {
  return (
    <div className="w-full rounded-xl border border-border-main bg-bg-panel p-4 sm:p-6">
      <div className="mb-5 border-b border-border-main pb-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-white">API Pool &amp; Model Targets</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-dim">
          Configure provider routes, inspect health, and test the model target used by Coder Chat.
        </p>
      </div>
      {children || <APICheckerComponent selectedModel={selectedModel} provider={provider} />}
    </div>
  );
}
