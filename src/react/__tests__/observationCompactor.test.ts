import { describe, expect, it } from '@jest/globals';
import {
  compactObservation,
  getObservationCompactionMetrics,
} from '../observationCompactor.js';
import { estimateCompactionTokenSavings } from '../token-accounting.js';

function largeOutput(lines: string[]): string {
  return lines.concat(Array.from({ length: 500 }, (_, index) => `progress ${index}%`)).join('\n');
}

describe('observation compactor', () => {
  it('leaves small observations byte-for-byte unchanged', () => {
    const observation = JSON.stringify({ success: true, output: 'done' });
    const result = compactObservation('Bash', { command: 'npm test' }, observation);

    expect(result.observation).toBe(observation);
    expect(result.metrics.compacted).toBe(false);
  });

  it('retains passing test totals and the final summary', () => {
    const observation = JSON.stringify({
      success: true,
      status: 'passed',
      output: largeOutput([
        'PASS src/example.test.ts',
        'Tests:       12 passed, 12 total',
        'Test Suites: 1 passed, 1 total',
        'Time:        2.4 s',
      ]),
    });

    const result = compactObservation('Command', { operation: 'test' }, observation, { inputThreshold: 1_000 });
    const parsed = JSON.parse(result.observation) as Record<string, unknown>;

    expect(result.metrics.compacted).toBe(true);
    expect(parsed).toMatchObject({ success: true, status: 'passed', compactionVersion: '1' });
    expect(String(parsed.output)).toContain('12 passed');
    expect(String(parsed.summary)).toContain('passed');
    expect((parsed.counts as Record<string, number>).lines).toBeGreaterThan(100);
  });

  it('retains failure names, errors, non-zero status, and artifact metadata', () => {
    const observation = JSON.stringify({
      success: false,
      status: 'failed',
      error: 'Command failed with exit code 1',
      output: largeOutput([
        'FAIL src/broken.test.ts',
        '  ● rejects invalid input',
        'Expected: true',
        'Received: false',
        'src/parser.ts:42:7 - error TS2322: Type string is not assignable to type number.',
        'Tests:       1 failed, 3 passed, 4 total',
      ]),
      command: { exitCode: 1, durationMs: 123, outputArtifact: { path: 'tool-output.log' } },
    });

    const result = compactObservation('Command', { operation: 'build' }, observation, { inputThreshold: 1_000 });
    const parsed = JSON.parse(result.observation) as Record<string, unknown>;

    expect(parsed).toMatchObject({ success: false, status: 'failed', artifactPath: 'tool-output.log' });
    expect(String(parsed.output)).toContain('FAIL src/broken.test.ts');
    expect((parsed.errors as string[]).join('\n')).toContain('TS2322');
    expect((parsed.command as Record<string, unknown>).outputArtifact).toEqual({ path: 'tool-output.log' });
  });

  it('reports omitted grep matches and preserves a safe fallback for malformed JSON', () => {
    const grepObservation = JSON.stringify({
      success: true,
      output: Array.from({ length: 200 }, (_, index) => `src/file-${index}.ts:${index + 1}:match`).join('\n'),
    });
    const grep = compactObservation('Grep', { pattern: 'match', path: 'src' }, grepObservation, { inputThreshold: 1_000, maxHighlights: 24 });
    const grepParsed = JSON.parse(grep.observation) as Record<string, unknown>;

    expect((grepParsed.counts as Record<string, number>)).toMatchObject({ matches: 200, omitted: 176 });
    expect(String(grepParsed.output)).toContain('176 matches omitted');

    const malformed = '{"success":true,"output":"not complete"';
    const fallback = compactObservation('Grep', { pattern: 'x' }, malformed);
    expect(fallback.observation).toBe(malformed);
    expect(fallback.metrics.compacted).toBe(false);
  });

  it('keeps stable representative Glob entries and reports omitted paths', () => {
    const globObservation = JSON.stringify({
      success: true,
      output: Array.from({ length: 200 }, (_, index) => `src/file-${index}.ts`).join('\n'),
    });
    const glob = compactObservation('Glob', { pattern: 'src/**/*.ts' }, globObservation, { inputThreshold: 1_000 });
    const parsed = JSON.parse(glob.observation) as Record<string, unknown>;

    expect(parsed).toMatchObject({ success: true, compactionVersion: '1' });
    expect(parsed.output).toEqual(expect.stringContaining('src/file-199.ts'));
    expect(parsed.counts).toMatchObject({ entries: 200, omitted: 176 });
  });

  it('preserves guarded-read, policy, skipped, and full-output metadata', () => {
    const hash = 'b'.repeat(64);
    const observation = JSON.stringify({
      success: true,
      status: 'skipped',
      skipped: true,
      verificationUnavailable: true,
      policy: { requiresApproval: false, scope: 'command:test' },
      hash,
      fullOutput: { persisted: true, path: 'raw-output.txt' },
      output: largeOutput(['verification unavailable']),
    });

    const result = compactObservation('Bash', { command: 'npm test' }, observation, { inputThreshold: 1_000 });
    const parsed = JSON.parse(result.observation) as Record<string, unknown>;

    expect(parsed).toMatchObject({
      success: true,
      status: 'skipped',
      skipped: true,
      verificationUnavailable: true,
      hash,
      artifactPath: 'raw-output.txt',
      fullOutput: { persisted: true, path: 'raw-output.txt' },
      policy: { requiresApproval: false, scope: 'command:test' },
    });
  });

  it('does not re-expose secret-like values while compacting output', () => {
    const secret = 'super-secret-value-123456';
    const observation = JSON.stringify({
      success: false,
      output: largeOutput([`api_key=${secret}`, `token: ${secret}`, 'error: request failed']),
    });
    const result = compactObservation('Bash', { command: 'npm run build' }, observation, { inputThreshold: 1_000 });

    expect(result.observation).not.toContain(secret);
    expect(result.observation).toContain('[REDACTED]');
  });

  it('exposes character savings without invoking a provider-facing interface', () => {
    const observation = JSON.stringify({ success: true, output: largeOutput(['done']) });
    const result = compactObservation('Bash', { command: 'npm run build' }, observation, { inputThreshold: 1_000 });
    const metrics = getObservationCompactionMetrics(result.observation);

    expect(metrics).toMatchObject({ kind: 'command', compacted: true });
    expect(metrics!.savedCharacters).toBeGreaterThan(0);
    expect(metrics!.reductionPercentage).toBeGreaterThan(0);
    expect(metrics!.retainedCharacters).toBe(result.observation.length);
  });

  it('shows material estimated context-token savings for a noisy fixture', () => {
    const original = JSON.stringify({
      success: false,
      status: 'failed',
      output: largeOutput([
        'FAIL src/noisy.test.ts',
        'Expected: true',
        'Received: false',
        'Tests: 1 failed, 20 passed, 21 total',
      ]),
    });
    const compacted = compactObservation('Bash', { command: 'npm test' }, original, { inputThreshold: 1_000 });
    const savings = estimateCompactionTokenSavings(original, compacted.observation);

    expect(savings.savedTokens).toBeGreaterThan(0);
    expect(savings.reductionPercentage).toBeGreaterThan(50);
  });
});
