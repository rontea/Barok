import { describe, expect, it } from '@jest/globals';
import {
  resolveTerminalRunAdvice,
  TERMINAL_RUN_ADVICE,
  type TerminalRunAdviceCategory,
} from '../terminal-run-advice';

describe('resolveTerminalRunAdvice', () => {
  it.each([
    ['no_progress', { errorCode: 'RECOVERY_BUDGET_EXCEEDED' }, 'Run blocked after repeated inspection without a source mutation.'],
    ['context_overflow', { errorCode: 'CONTEXT_LENGTH_EXCEEDED' }, undefined],
    ['provider_unavailable', { errorCode: 'PROVIDER_RETRY_LIMIT' }, undefined],
    ['gate_deadlock', { error: 'Cannot complete: applicable successful verification evidence is required.' }, undefined],
    ['step_limit', { errorCode: 'GLOBAL_STEP_LIMIT_EXCEEDED' }, undefined],
    ['wall_clock_budget', { errorCode: 'RUN_WALL_CLOCK_LIMIT_EXCEEDED' }, undefined],
    ['recovery_exhausted', { errorCode: 'RECOVERY_BUDGET_EXCEEDED' }, undefined],
  ] as Array<[TerminalRunAdviceCategory, Record<string, unknown>, string | undefined]>) (
    'classifies %s terminal outcomes',
    (expectedCategory, result, blockedReason) => {
      expect(resolveTerminalRunAdvice({ result: { success: false, ...result }, blockedReason })?.category)
        .toBe(expectedCategory);
    },
  );

  it('provides advice for explicit operator stops and otherwise unclassified failures', () => {
    expect(resolveTerminalRunAdvice({ result: { success: false, errorCode: 'USER_STOPPED' } })?.category)
      .toBe('operator_stopped');
    expect(resolveTerminalRunAdvice({ status: 'failed', result: { success: false, error: 'Unexpected failure.' } })?.category)
      .toBe('unexpected_failure');
    expect(resolveTerminalRunAdvice({ result: { success: false } })?.category).toBe('unexpected_failure');
  });

  it('shows gate advice for completed work with failed verification and omits advice on success', () => {
    expect(resolveTerminalRunAdvice({
      result: { success: false, executionCompleted: true, verificationStatus: 'failed' },
    })?.category).toBe('gate_deadlock');
    expect(resolveTerminalRunAdvice({ result: { success: true } })).toBeUndefined();
  });

  it('keeps each advice list short and links to the operator guide', () => {
    for (const advice of Object.values(TERMINAL_RUN_ADVICE)) {
      expect(advice.guidance.length).toBeLessThanOrEqual(3);
      expect(advice.guidance.length).toBeGreaterThan(0);
      expect(advice.learnMoreUrl).toContain('docs/core/RUNNING_AGENT_GUIDE.md');
    }
  });
});
