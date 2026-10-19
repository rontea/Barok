/** Host-neutral manifest and verification records for generated applications. */

import type { QualityGateResult } from './quality-gates.js';

export interface AppManifest {
  id: string;
  timestamp: string;
  appName: string;
  appType: string;
  outputMode: string;
  workspace: string;
  entryPoint: string;
  /** Outputs evidenced by successful in-workspace mutations only. */
  outputFiles: string[];
  /** Declared deliverables checked for presence; missing files never become outputs. */
  requiredOutputFiles?: string[];
  verificationChecks: string[];
  verificationResults?: VerificationResult;
}

export interface VerificationResult {
  passed: boolean;
  checkedAt: string;
  checks: GeneratedAppVerificationCheck[];
  summary: string;
  signals: VerificationSignal[];
  qualityGates?: QualityGateResult[];
  qualityScore?: number;
}

export type VerificationQualityGate = QualityGateResult;

export interface GeneratedAppVerificationCheck {
  name: string;
  passed: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

export interface VerificationSignal {
  type: 'page-load' | 'no-console-errors' | 'responsive' | 'interactive' | 'canvas-content' | 'persistence' | 'build-success';
  passed: boolean;
  message: string;
}

export interface WorkspaceOutputEvidenceStep {
  action: string;
  action_input?: Record<string, unknown>;
  observation?: string;
}

export type WorkspacePathResolver = (userPath: string, workspaceRoot: string) => string;

/** Generate a unique manifest ID. */
export function generateManifestId(): string {
  return Math.random().toString(36).substring(2, 11);
}

/** Create a manifest record from the app specification and successful outputs. */
export function createManifest(
  appName: string,
  appType: string,
  outputMode: string,
  workspace: string,
  entryPoint: string,
  outputFiles: string[],
  verificationChecks: string[],
  requiredOutputFiles: string[] = [],
): AppManifest {
  return {
    id: generateManifestId(),
    timestamp: new Date().toISOString(),
    appName,
    appType,
    outputMode,
    workspace,
    entryPoint,
    outputFiles,
    requiredOutputFiles,
    verificationChecks,
  };
}

function mutationStepSucceeded(observation: string | undefined): boolean {
  if (!observation) return false;
  try {
    const parsedValue = JSON.parse(observation) as unknown;
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) return false;
    const parsed = parsedValue as { success?: unknown; status?: unknown; skipped?: unknown };
    if (parsed.success === false || parsed.skipped === true) return false;
    if (['failed', 'error', 'denied', 'rejected', 'invalid', 'blocked', 'cancelled', 'canceled', 'timed_out', 'unavailable', 'skipped']
      .includes(String(parsed.status || '').toLowerCase())) return false;
    if (typeof parsed.success === 'boolean') return parsed.success;
    return true;
  } catch {
    return !/^(?:Error executing|Tool execution failed)|\b(?:failed|error|denied)\b/i.test(observation);
  }
}

/** Only successful, canonical paths inside the active workspace are app outputs. */
export function extractSuccessfulWorkspaceOutputs(
  steps: WorkspaceOutputEvidenceStep[],
  workspace: string,
  resolveWorkspacePath: WorkspacePathResolver,
): string[] {
  const files = new Set<string>();
  for (const step of steps) {
    if ((step.action !== 'Write' && step.action !== 'Edit') || !mutationStepSucceeded(step.observation)) continue;
    const target = step.action_input?.file_path ?? step.action_input?.path ??
      step.action_input?.filename ?? step.action_input?.file;
    if (typeof target !== 'string' || !target.trim()) continue;
    try {
      files.add(resolveWorkspacePath(target, workspace));
    } catch {
      // Rejected, stale, symlink-escaping, and external paths are not outputs.
    }
  }
  return Array.from(files);
}
