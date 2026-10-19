import { getSQLiteAppStore } from '../persistence/sqliteStore.js';
import type { PerformanceTraceSummary } from '@barok/engine';
import type { HarnessInterventionEvidence } from './tool-contract.js';
import type { OutcomeKind, RunAuditOptions } from '@barok/engine';

export type { OutcomeKind, RunAuditOptions } from '@barok/engine';

export interface LoggedStep {
  step: number;
  thought: string;
  action: string;
  actionInput: any;
  observation?: string;
  pollenCost?: number;
}

export interface ReactRunReport {
  id: string;
  threadId?: string;
  runId?: string;
  parentRunId?: string;
  attemptIndex?: number;
  outcomeKind?: OutcomeKind;
  threadTitle?: string;
  cumulativeCost?: number;
  cumulativeSteps?: number;
  task: string;
  model: string;
  timestamp: string;
  success: boolean;
  stepCount: number;
  totalPollenCost: number;
  budget: number;
  finalAnswer?: string;
  error?: string;
  steps: LoggedStep[];
  /** Files are persisted with the attempt so thread aggregation does not need to replay steps. */
  filesChanged?: string[];
  /** Compact evidence-gate interventions, retained separately from ordinary tool failures. */
  harnessInterventions?: Array<HarnessInterventionEvidence & { evidenceId: string; toolCallId: string }>;
  successfulMutations?: number;
  failedMutations?: number;
  failedCommands?: number;
  completionConfidence?: 'confirmed' | 'unsupported' | 'partial' | 'unknown';
  performanceTrace?: PerformanceTraceSummary;
}

export interface ThreadAuditSummary {
  threadId: string;
  threadTitle?: string;
  status: 'completed' | 'paused' | 'waiting_cooldown' | 'cancelled' | 'failed';
  latestOutcomeKind?: OutcomeKind;
  totalAttempts: number;
  totalSteps: number;
  totalPollenCost: number;
  filesChanged: string[];
  lastModel: string;
  lastTimestamp: string;
  runs: ReactRunReport[];
  performanceSummary?: { durationMs: number; tokens: number };
}

const MUTATION_ACTIONS = new Set(['Write', 'Edit']);

function observationSucceeded(observation?: string): boolean {
  if (!observation) return false;
  try {
    const parsed = JSON.parse(observation);
    if (parsed && typeof parsed === 'object' && 'success' in parsed) {
      return Boolean((parsed as any).success);
    }
  } catch {
    // Use text checks below for legacy observations.
  }
  return !/error executing|tool execution failed|"success"\s*:\s*false|failed|error|pattern not found|guarded mutation rejected/i.test(observation);
}

const MUTATION_CLAIM_RE = /\b(updated|changed|modified|edited|wrote|created|added|removed|deleted|implemented|fixed|marked|checked off|unchecked)\b/i;
const MUTATION_VERB_RE = /\b(update[ds]?|updating|change[ds]?|changing|modif(?:y|ies|ied|ying)|edit(?:s|ed|ing)?|wrote|write[sn]?|writing|creat(?:e[ds]?|ing)|add(?:s|ed|ing)?|remov(?:e[ds]?|ing)|delet(?:e[ds]?|ing)|implement(?:s|ed|ing)?|fix(?:es|ed|ing)?|mark(?:s|ed|ing)?|check(?:s|ed|ing)? off|uncheck(?:s|ed|ing)?)\b/i;
const CHANGE_NOUN_RE = /\b(files?|changes?|edits?|modifications?|workspace|codebase)\b/i;

function isNegatedMutationSentence(sentence: string): boolean {
  const nearby = '[^.!?\\n]{0,100}';
  const patterns = [
    new RegExp(`\\bno\\b${nearby}${CHANGE_NOUN_RE.source}${nearby}${MUTATION_VERB_RE.source}`, 'i'),
    new RegExp(`${CHANGE_NOUN_RE.source}${nearby}\\b(?:was|were|is|are|has been|have been)?\\s*(?:not|never)\\b${nearby}${MUTATION_VERB_RE.source}`, 'i'),
    new RegExp(`\\b(?:did not|didn't|have not|haven't|has not|hasn't|was not|were not|not yet)\\b${nearby}${MUTATION_VERB_RE.source}`, 'i'),
    new RegExp(`\\bwithout\\b${nearby}${MUTATION_VERB_RE.source}`, 'i'),
  ];
  return patterns.some((pattern) => pattern.test(sentence));
}

function isFutureMutationSentence(sentence: string): boolean {
  const nearby = '[^.!?\\n]{0,120}';
  const patterns = [
    new RegExp(`\\b(?:to proceed with|next steps?|need(?:s)? to|required to|before|should|would|will|can|could|shall|go ahead and)\\b${nearby}${MUTATION_VERB_RE.source}`, 'i'),
    new RegExp(`${MUTATION_VERB_RE.source}${nearby}\\b(?:is needed|are needed|required|before making changes|once done|to proceed)\\b`, 'i'),
  ];
  return patterns.some((pattern) => pattern.test(sentence));
}

function finalAnswerClaimsMutation(finalAnswer?: string): boolean {
  return (finalAnswer || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .some((sentence) =>
      MUTATION_CLAIM_RE.test(sentence) &&
      !isNegatedMutationSentence(sentence) &&
      !isFutureMutationSentence(sentence)
    );
}

function filePathFromInput(input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  const filePath = input.file_path ?? input.path ?? input.filename ?? input.file;
  return typeof filePath === 'string' && filePath.trim() ? filePath : undefined;
}

function summarizeRunEvidence(report: Pick<ReactRunReport, 'steps' | 'success' | 'finalAnswer'>) {
  const files = new Set<string>();
  let successfulMutations = 0;
  let failedMutations = 0;
  let failedCommands = 0;

  for (const step of report.steps || []) {
    const ok = observationSucceeded(step.observation);
    if (MUTATION_ACTIONS.has(step.action)) {
      if (ok) {
        successfulMutations += 1;
        const filePath = filePathFromInput(step.actionInput);
        if (filePath) files.add(filePath);
      } else {
        failedMutations += 1;
      }
    }
    if (step.action === 'Bash' && !ok) failedCommands += 1;
  }

  const claimsMutation = finalAnswerClaimsMutation(report.finalAnswer);
  const completionConfidence: ReactRunReport['completionConfidence'] =
    claimsMutation && successfulMutations === 0
      ? 'unsupported'
      : successfulMutations > 0 && failedMutations > 0
        ? 'partial'
        : successfulMutations > 0 || !claimsMutation
          ? 'confirmed'
          : 'unknown';

  return {
    filesChanged: Array.from(files),
    successfulMutations,
    failedMutations,
    failedCommands,
    completionConfidence,
  };
}

const formatRawRunLog = (report: ReactRunReport): string => {
  const trace = report.steps
    .map((step) => {
      const observation = (step.observation || '').substring(0, 500).trim().replace(/\n/g, '\n  ');
      const trimmedNotice = (step.observation || '').length > 500 ? '\n  ... [truncated]' : '';

      return `[Action ${step.step}]
Thought:
  ${step.thought.trim().replace(/\n/g, '\n  ')}
Action: ${step.action}
Arguments: ${JSON.stringify(step.actionInput)}
Observation:
  ${observation}${trimmedNotice}`;
    })
    .join('\n---------------------------------------------\n');
  const harnessInterventions = (report.harnessInterventions || []).map((intervention) =>
    `[${intervention.gateName}] step ${intervention.stepSeq} ${intervention.targetAction} (${intervention.evidenceId}): ${intervention.reason}\n  Required evidence: ${intervention.requiredEvidence.join('; ')}`,
  ).join('\n');

  return `
=============================================
REACT RUN REPORT (ID: ${report.id}${report.threadId ? ` | THREAD: ${report.threadId}` : ''})
=============================================
Timestamp   : ${report.timestamp}
Task        : "${report.task}"
Model Used  : ${report.model}
Success     : ${report.success ? 'YES' : 'NO'}
Outcome     : ${report.outcomeKind || (report.success ? 'completed' : 'unknown')}
Actions Recorded : ${report.stepCount}
Total Cost  : ${report.totalPollenCost.toFixed(5)} Pollen
Budget Limit: ${report.budget}
---------------------------------------------
${report.error ? `Error: ${report.error}\n` : ''}${report.finalAnswer ? `Final Answer:\n${report.finalAnswer}\n` : ''}
${harnessInterventions ? `Harness interventions:\n${harnessInterventions}\n` : ''}
Execution Trace:
${trace}
=============================================
`;
};

export async function recordRunResult(
  task: string,
  model: string,
  budget: number,
  success: boolean,
  steps: any[],
  totalCost: number,
  finalAnswer?: string,
  error?: string,
  performanceTrace?: PerformanceTraceSummary,
  options?: RunAuditOptions
) {
  try {
    const runId = options?.runId || Math.random().toString(36).substring(2, 8).toUpperCase();
    const timestamp = new Date().toISOString();
    const store = getSQLiteAppStore();
    const existingThread = options?.threadId ? store.getThreadDetails(options.threadId) : null;
    const previousRuns = existingThread?.runs.filter((run) => run.id !== runId && run.runId !== runId) || [];
    const priorCost = previousRuns.reduce((sum, run) => sum + (Number.isFinite(run.totalPollenCost) ? run.totalPollenCost : 0), 0);
    const priorSteps = previousRuns.reduce((sum, run) => sum + (Number.isFinite(run.stepCount) ? run.stepCount : 0), 0);
    const priorAttemptIndex = previousRuns.reduce((max, run) => Math.max(max, run.attemptIndex || 0), 0);
    const requestedAttemptIndex = Math.max(1, Math.floor(options?.attemptIndex ?? 1));
    const attemptIndex = previousRuns.length > 0
      ? Math.max(requestedAttemptIndex, priorAttemptIndex + 1)
      : requestedAttemptIndex;
    const cumulativeCost = Math.max(
      totalCost,
      priorCost + totalCost,
      options?.cumulativeCost ?? 0,
    );
    const cumulativeSteps = Math.max(
      steps.length,
      priorSteps + steps.length,
      options?.cumulativeSteps ?? 0,
    );

    const formattedSteps: LoggedStep[] = steps.map((s, idx) => ({
      step: idx + 1,
      thought: s.thought || '',
      action: s.action || '',
      actionInput: s.action_input || {},
      observation: s.observation || '',
      pollenCost: s.pollenCost || 0,
    }));

    const report: ReactRunReport = {
      id: runId,
      threadId: options?.threadId,
      runId: options?.runId || runId,
      parentRunId: options?.parentRunId,
      attemptIndex,
      outcomeKind: options?.outcomeKind ?? (success ? 'completed' : error ? 'fatal_error' : 'unknown'),
      threadTitle: options?.threadTitle,
      cumulativeCost,
      cumulativeSteps,
      task,
      model,
      timestamp,
      success,
      stepCount: steps.length,
      totalPollenCost: totalCost,
      budget,
      finalAnswer,
      error,
      steps: formattedSteps,
      ...(options?.harnessInterventions?.length
        ? {
            harnessInterventions: options.harnessInterventions.slice(-50).map((intervention) => ({
              ...intervention,
              reason: intervention.reason.slice(0, 500),
              requiredEvidence: intervention.requiredEvidence.slice(0, 5).map((item) => item.slice(0, 160)),
              targetAction: intervention.targetAction.slice(0, 120),
            })),
          }
        : {}),
      performanceTrace,
    };

    Object.assign(report, summarizeRunEvidence(report));

    store.saveRun(report, formatRawRunLog(report));
    console.log(`[ReAct Audit] Saved execution audit ${runId}${options?.threadId ? ` (thread: ${options.threadId})` : ''} to SQLite`);
  } catch (err) {
    console.error('[ReAct Audit] Failed to save logger reports:', err);
  }
}

export async function getRecentThreads(limit = 50): Promise<ThreadAuditSummary[]> {
  try {
    return getSQLiteAppStore().getRecentThreads(limit) as ThreadAuditSummary[];
  } catch {
    return [];
  }
}

export async function getRecentThreadHeaders(limit = 50): Promise<ThreadAuditSummary[]> {
  try {
    return getSQLiteAppStore().getRecentThreadHeaders(limit) as ThreadAuditSummary[];
  } catch {
    return [];
  }
}

export async function getThreadDetails(threadId: string): Promise<ThreadAuditSummary | null> {
  try {
    return getSQLiteAppStore().getThreadDetails(threadId) as ThreadAuditSummary | null;
  } catch {
    return null;
  }
}

export async function getThreadAuditPage(threadId: string, limit = 20, offset = 0) {
  try {
    return getSQLiteAppStore().getThreadAuditPage(threadId, limit, offset);
  } catch {
    return null;
  }
}

export async function getRunAuditSteps(threadId: string, runId: string, limit = 100, offset = 0) {
  try {
    return getSQLiteAppStore().getRunAuditSteps(threadId, runId, limit, offset);
  } catch {
    return null;
  }
}

export async function getPastRuns(): Promise<ReactRunReport[]> {
  try {
    return getSQLiteAppStore()
      .getRecentRuns<ReactRunReport>(100)
      .map((run) => ({
        ...run,
        ...summarizeRunEvidence(run),
      }));
  } catch {
    return [];
  }
}

export async function getRawLogFile(): Promise<string> {
  try {
    return getSQLiteAppStore().getRawRunLog();
  } catch {
    return 'No logs recorded yet.';
  }
}

export async function clearAllLogs(): Promise<void> {
  try {
    getSQLiteAppStore().clearRuns();
  } catch (err) {
    console.error('[ReAct Audit] Failed to clear logs:', err);
  }
}
