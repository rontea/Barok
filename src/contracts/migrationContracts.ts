/** Shared contracts for the migrated workspace shell and its persisted projections. */

export type ExplorerTabId = 'coder' | 'tests' | 'structure' | 'audits';

export interface WorkspaceState {
  path: string;
  dirty: boolean;
  activeRunCount: number;
  lastRefreshedAt?: number;
}

export interface ProviderHealthSummary {
  provider: string;
  status: 'healthy' | 'degraded' | 'cooldown' | 'throttled' | 'unavailable' | 'unknown';
  checkedAt?: number;
  message?: string;
}

export interface AgentSettingsContract {
  enabled: boolean;
  allowedRoles: string[];
  roleRules: Record<string, string>;
  delegates: Array<{ slot: number; route: { provider: string; model: string } | null }>;
}

export interface GeneratedAppResultContract {
  appSpec: Record<string, unknown>;
  outputFiles: string[];
  verification?: Record<string, unknown>;
  runId?: string;
}

export type TestRunResultStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'timed_out' | 'blocked' | 'unavailable';

export interface TestRunResultContract {
  testId: string;
  status: TestRunResultStatus;
  runId?: string;
  command?: string;
  stdout?: string;
  stderr?: string;
  changedFiles?: string[];
  durationMs?: number;
}
