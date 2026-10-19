import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { persistLargeObservationIfNeeded } from '../tool-result-storage.js';

const originalInlineLimit = process.env.REACT_ENGINE_TOOL_RESULT_INLINE_LIMIT;

afterEach(() => {
  if (originalInlineLimit === undefined) delete process.env.REACT_ENGINE_TOOL_RESULT_INLINE_LIMIT;
  else process.env.REACT_ENGINE_TOOL_RESULT_INLINE_LIMIT = originalInlineLimit;
});

describe('tool-result-storage characterization', () => {
  it('returns small observations unchanged', async () => {
    process.env.REACT_ENGINE_TOOL_RESULT_INLINE_LIMIT = '100';
    const observation = JSON.stringify({ success: true, output: 'small result' });

    await expect(persistLargeObservationIfNeeded(observation, mkdtempSync(path.join(tmpdir(), 'react-storage-'))))
      .resolves.toBe(observation);
  });

  it('persists large JSON output and keeps a guarded-read hash in the preview', async () => {
    process.env.REACT_ENGINE_TOOL_RESULT_INLINE_LIMIT = '100';
    const hash = 'a'.repeat(64);
    const output = `${'line\n'.repeat(1_100)}[guarded-read-hash: ${hash}]`;
    const observation = JSON.stringify({ success: true, output });
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-storage-'));

    const persisted = await persistLargeObservationIfNeeded(observation, workspace);
    const parsed = JSON.parse(persisted) as {
      output: string;
      fullOutput?: { persisted?: boolean; originalLength?: number; path?: string };
    };

    expect(parsed.output.length).toBeLessThan(output.length);
    expect(parsed.output).toContain(`[guarded-read-hash: ${hash}]`);
    expect(parsed.fullOutput).toMatchObject({ persisted: true, originalLength: output.length });
    expect(parsed.fullOutput?.path).toBeTruthy();
    expect(readFileSync(parsed.fullOutput!.path!, 'utf-8')).toBe(observation);
  });
});
