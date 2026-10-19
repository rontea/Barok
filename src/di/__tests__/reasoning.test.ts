import { describe, expect, it, jest } from '@jest/globals';
import { extractSafeReasoningSummary, extractSafeReasoningSummaryDelta, reportCompletionResult, SAFE_REASONING_SUMMARY_MAX_CHARS } from '../reasoning';

describe('safe reasoning summaries', () => {
  it('extracts labelled summaries without promoting raw reasoning text', () => {
    const summary = extractSafeReasoningSummary({
      choices: [{
        message: {
          reasoning: 'private raw chain of thought',
          reasoning_details: [
            { type: 'reasoning.text', text: 'private raw detail' },
            { type: 'reasoning.summary', summary: 'The model inspected the relevant evidence and selected the next safe action.' },
          ],
        },
      }],
    });

    expect(summary).toBe('The model inspected the relevant evidence and selected the next safe action.');
    expect(extractSafeReasoningSummary({ choices: [{ message: { reasoning: 'private only' } }] })).toBeUndefined();
  });

  it('bounds and reports a provider-labelled summary', () => {
    const onCompletionResult = jest.fn();
    const longSummary = 'x'.repeat(SAFE_REASONING_SUMMARY_MAX_CHARS + 100);

    reportCompletionResult({ onCompletionResult }, {
      text: 'visible answer',
      toolCalls: [],
      reasoningSummary: longSummary,
      provider: 'openrouter',
      model: 'example/reasoning-model',
    });

    expect(onCompletionResult).toHaveBeenCalledWith(expect.objectContaining({ reasoningSummary: longSummary }));
    expect(extractSafeReasoningSummary({ reasoning_summary: longSummary })).toHaveLength(SAFE_REASONING_SUMMARY_MAX_CHARS);
  });

  it('returns only newly appended labelled summary text for cumulative stream chunks', () => {
    const first = { reasoning_summary: 'Inspecting the target.' };
    const second = { reasoning_summary: 'Inspecting the target. Selecting a safe edit.' };

    expect(extractSafeReasoningSummaryDelta(first)).toBe('Inspecting the target.');
    expect(extractSafeReasoningSummaryDelta(second, 'Inspecting the target.')).toBe('Selecting a safe edit.');
    expect(extractSafeReasoningSummaryDelta({ reasoning: 'private raw detail' }, 'Inspecting the target.')).toBeUndefined();
  });
});
