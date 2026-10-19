import { describe, expect, it } from '@jest/globals';
import type {
  ReactResult as EngineReactResult,
  ReactStep as EngineReactStep,
} from '@barok/engine';
import {
  classifyRecoveryTransition as classifyEngineRecoveryTransition,
  compactObservation as compactEngineObservation,
  ToolEvidenceLedger as EngineToolEvidenceLedger,
} from '@barok/engine';
import type {
  ReactStep as AppReactStep,
} from '../state-manager';

describe('Engine ReAct contracts', () => {
  it('provides host-neutral step and generic result types with app compatibility', () => {
    const engineStep: EngineReactStep = {
      thought: 'Inspect the requested file.',
      action: 'Read',
      action_input: { file_path: 'README.md' },
      observation: 'Read complete.',
    };
    const appStep: AppReactStep = engineStep;
    const result: EngineReactResult<{ cursor: string }> = {
      success: true,
      steps: [engineStep],
      stepCount: 1,
      pollenCost: 0,
      resumeState: { cursor: 'next' },
    };

    expect(appStep.action).toBe('Read');
    expect(result.resumeState?.cursor).toBe('next');
  });

  it('classifies recovery from host-provided success evidence', () => {
    expect(classifyEngineRecoveryTransition({
      action: 'Edit',
      actionInput: { file_path: 'src/index.ts' },
      observation: 'Edit failed: stale expected hash.',
      successful: false,
    })).toBe('inspect');
    expect(classifyEngineRecoveryTransition({
      action: 'Edit',
      actionInput: { file_path: 'src/index.ts' },
      observation: 'Edit could not apply.',
      successful: false,
    })).toBe('repair');
  });

  it('exports deterministic observation compaction without a host runtime dependency', () => {
    const observation = JSON.stringify({
      success: true,
      status: 'passed',
      output: Array.from({ length: 100 }, (_, index) => `PASS test ${index}`).join('\n'),
    });
    const result = compactEngineObservation('Command', { operation: 'test' }, observation, {
      inputThreshold: 100,
    });

    expect(result.metrics.compacted).toBe(true);
    expect(JSON.parse(result.observation).summary).toContain('command passed');
  });

  it('records tool evidence using a host-provided identifier source', () => {
    const generatedIds = ['evidence-1', 'call-1', 'invocation-1'];
    const ledger = new EngineToolEvidenceLedger(() => generatedIds.shift()!);
    const evidenceId = ledger.start({ action: 'Read', action_input: { file_path: 'README.md' } });

    expect(evidenceId).toBe('evidence-1');
    expect(ledger.list()[0]).toMatchObject({
      id: 'evidence-1',
      toolCallId: 'call-1',
      invocationId: 'invocation-1',
      status: 'started',
    });
    expect(ledger.complete(evidenceId, JSON.stringify({ success: true, output: 'read complete' })))
      .toMatchObject({ status: 'success', output: expect.any(String) });
  });
});
