/** Shared child-run report and bounded-subtask contracts. */
export const CHILD_RUN_PROTOCOL_VERSION = 1 as const;

export interface ChildRunSubtaskContract {
  id: string;
  objective: string;
  fileScope: string[];
  acceptanceChecks: string[];
  dependencies: string[];
  budget: {
    estimatedPromptTokens: number;
    maxPromptTokens: number;
    reservedOutputTokens: number;
    systemToolReserveTokens: number;
    dependencyHandoffReserveTokens: number;
    maxSteps: number;
    maxLlmRequests: number;
    maxToolCalls: number;
    maxCost: number;
    timeoutMs: number;
  };
}

export interface ChildRunReportCheck {
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'unknown';
  output?: string;
}

/** Evidence-oriented result contract for a child execution adapter. */
export interface ChildRunReport {
  protocolVersion: typeof CHILD_RUN_PROTOCOL_VERSION;
  childId: string;
  success: boolean;
  result?: unknown;
  changedFiles: string[];
  checks: ChildRunReportCheck[];
  blockers: string[];
  evidenceRefs: string[];
  terminalReason?: string;
  createdAt: number;
}
