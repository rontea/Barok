/** Host-neutral input needed to fingerprint checkpoint-relevant workspace files. */
export interface WorkspaceFingerprintState {
  workspace: string;
  taskAnalysis?: {
    contract?: {
      candidateFiles?: readonly string[];
    };
    affectedFiles?: readonly {
      intent: string;
      path: string;
    }[];
  };
  steps: readonly {
    action_input?: Record<string, unknown>;
  }[];
}

export interface WorkspaceFingerprintEntry {
  path: string;
  size: number;
  mtimeMs: number;
  contentHash: string;
}

export interface WorkspaceFingerprint {
  digest: string;
  entries: WorkspaceFingerprintEntry[];
}

/** Filesystem capability supplied by a host when it creates or validates checkpoints. */
export type WorkspaceFingerprintProvider = (state: WorkspaceFingerprintState) => WorkspaceFingerprint;
