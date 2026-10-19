import type { LLMCompletionOptions, LLMCompletionResult } from './types.js';

/**
 * Provider responses can contain private reasoning traces under several
 * provider-specific names. Only fields explicitly labelled as a summary are
 * eligible for the application-visible channel.
 */
export const SAFE_REASONING_SUMMARY_MAX_CHARS = 600;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeSummary(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const summary = value.replace(/\s+/g, ' ').trim().slice(0, SAFE_REASONING_SUMMARY_MAX_CHARS);
    return summary || undefined;
  }

  if (Array.isArray(value)) {
    const text = value.map((item) => {
      const itemRecord = record(item);
      return typeof item === 'string'
        ? item
        : typeof itemRecord?.text === 'string'
          ? itemRecord.text
          : typeof itemRecord?.summary_text === 'string'
            ? itemRecord.summary_text
            : typeof itemRecord?.summary === 'string'
              ? itemRecord.summary
            : '';
    }).filter(Boolean).join(' ');
    return normalizeSummary(text);
  }

  return undefined;
}

/**
 * Extract only provider-labelled summary fields. Deliberately excludes
 * `reasoning`, `reasoning_content`, and `thinking`, which may contain raw
 * chain-of-thought even when the provider uses a friendly field name.
 */
export function extractSafeReasoningSummary(payload: unknown): string | undefined {
  const root = record(payload);
  if (!root) return undefined;
  const choice = Array.isArray(root.choices) ? record(root.choices[0]) : undefined;
  const message = record(choice?.message);
  const output = Array.isArray(root.output)
    ? root.output.map(record).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  const reasoning = record(root.reasoning);
  const messageReasoning = record(message?.reasoning);

  // OpenRouter exposes provider-labelled summaries in reasoning_details while
  // raw reasoning text is represented by reasoning.text or message.reasoning.
  // Only accept the explicitly labelled summary variant.
  const reasoningDetailSummaries = Array.isArray(message?.reasoning_details)
    ? message.reasoning_details
      .map(record)
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .filter((item) => item.type === 'reasoning.summary')
      .map((item) => item.summary)
    : [];

  const candidates: unknown[] = [
    root.reasoning_summary,
    root.reasoningSummary,
    root.summary,
    root.summary_text,
    reasoning?.summary,
    reasoning?.summary_text,
    message?.reasoning_summary,
    message?.reasoningSummary,
    message?.summary,
    message?.summary_text,
    messageReasoning?.summary,
    messageReasoning?.summary_text,
    ...reasoningDetailSummaries,
    ...output.flatMap((item) => [item.summary, item.summary_text]),
  ];

  for (const candidate of candidates) {
    const summary = normalizeSummary(candidate);
    if (summary) return summary;
  }
  return undefined;
}

/**
 * Return only the newly appended portion of a provider-labelled summary.
 * Providers commonly stream the full accumulated summary in every chunk, so
 * callers can use this helper without duplicating text in the live timeline.
 */
export function extractSafeReasoningSummaryDelta(
  payload: unknown,
  previousSummary = '',
): string | undefined {
  const current = extractSafeReasoningSummary(payload);
  if (!current) return undefined;
  const previous = previousSummary.trim();
  if (!previous) return current;
  if (current === previous || previous.startsWith(current)) return undefined;
  if (current.startsWith(previous)) {
    const delta = current.slice(previous.length).trim();
    return delta || undefined;
  }
  // A provider may send independent summary fragments instead of a
  // cumulative value. Keep the fragment bounded and let the caller append it.
  return current;
}

export function reportCompletionResult(
  options: LLMCompletionOptions | undefined,
  result: LLMCompletionResult,
): void {
  try {
    options?.onCompletionResult?.(result);
  } catch {
    // Observability must never affect provider behavior.
  }
}
