import { describe, expect, it } from '@jest/globals';
import { getPerformanceTrace, PerformanceTrace } from '../performance-trace';

describe('PerformanceTrace', () => {
  it('records events, counters, and spans', async () => {
    const trace = new PerformanceTrace('test-run');

    trace.recordEvent('run_started');
    trace.recordEvent('tool_started');
    trace.incrementCounter('bytes', 10);
    await trace.measure('phase.async', async () => {
      await Promise.resolve();
    });
    trace.measureSync('phase.sync', () => 42);

    const summary = trace.finish();

    expect(summary.name).toBe('test-run');
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    expect(summary.firstEventLatencyMs).toBeGreaterThanOrEqual(0);
    expect(summary.firstActionLatencyMs).toBeGreaterThanOrEqual(0);
    expect(summary.eventCounts.run_started).toBe(1);
    expect(summary.counters.bytes).toBe(10);
    expect(summary.spans.map((span) => span.name)).toEqual(['phase.async', 'phase.sync']);
  });

  it('extracts traces from result objects', () => {
    const trace = new PerformanceTrace('result-run').finish();

    expect(getPerformanceTrace({ performanceTrace: trace })).toBe(trace);
    expect(getPerformanceTrace({})).toBeUndefined();
  });
});
