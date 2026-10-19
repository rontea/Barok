import type { ReActEngineExecutionProfile } from './react-runtime.js';

export function calculateExecutionPacingIntervalMs(
  override: number | undefined,
  preset: ReActEngineExecutionProfile,
): number {
  if (typeof override === 'number' && Number.isFinite(override)) {
    return Math.max(0, Math.min(Math.floor(override), 60_000));
  }
  return preset.requestIntervalMs;
}

export function calculateToolPresentationDelayMs(
  action: string,
  preset: ReActEngineExecutionProfile,
): number {
  const presentation = preset.toolPresentation;
  if (action === 'Write' || action === 'Edit') return presentation.writeMs;
  if (action === 'Read' || action === 'DocumentRead') return presentation.readMs;
  return 0;
}

/** Pure UI pacing calculation; the host decides which execution profile applies. */
export function calculateDecisionPresentationDelayMs(
  summary: string,
  preset: ReActEngineExecutionProfile,
): number {
  const presentation = preset.decisionPresentation;
  if (presentation.maxMs <= 0) return 0;
  const summaryLength = Array.from(summary.trim()).length;
  if (summaryLength === 0) return 0;
  return Math.min(
    presentation.maxMs,
    Math.max(presentation.minMs, Math.ceil(summaryLength / presentation.charactersPerStep) * 1_000),
  );
}
