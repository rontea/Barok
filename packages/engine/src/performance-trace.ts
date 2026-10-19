export interface PerformanceTraceSpan {
  name: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export interface PerformanceTraceSummary {
  name: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  firstEventLatencyMs?: number;
  firstActionLatencyMs?: number;
  eventCounts: Record<string, number>;
  counters: Record<string, number>;
  spans: PerformanceTraceSpan[];
}

export class PerformanceTrace {
  private readonly startedAt = Date.now();
  private readonly spans: PerformanceTraceSpan[] = [];
  private readonly eventCounts = new Map<string, number>();
  private readonly counters = new Map<string, number>();
  private firstEventAt: number | undefined;
  private firstActionAt: number | undefined;
  private finished: PerformanceTraceSummary | undefined;

  constructor(private readonly name: string) {}

  recordEvent(type: string): void {
    if (this.finished) return;
    if (this.firstEventAt === undefined) {
      this.firstEventAt = Date.now();
    }
    if (type === 'tool_started' && this.firstActionAt === undefined) {
      this.firstActionAt = Date.now();
    }
    this.eventCounts.set(type, (this.eventCounts.get(type) || 0) + 1);
  }

  incrementCounter(name: string, amount = 1): void {
    if (this.finished) return;
    this.counters.set(name, (this.counters.get(name) || 0) + amount);
  }

  recordSpan(span: PerformanceTraceSpan): void {
    if (this.finished) return;
    this.spans.push({ ...span, metadata: span.metadata ? { ...span.metadata } : undefined });
  }

  startSpan(name: string, metadata?: Record<string, unknown>): () => PerformanceTraceSpan {
    const startedAt = Date.now();
    let ended = false;
    return () => {
      const endedAt = Date.now();
      if (ended) {
        return {
          name,
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          metadata,
        };
      }
      ended = true;
      const span = {
        name,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        metadata,
      };
      this.spans.push(span);
      return span;
    };
  }

  async measure<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const end = this.startSpan(name, metadata);
    try {
      return await fn();
    } finally {
      end();
    }
  }

  measureSync<T>(
    name: string,
    fn: () => T,
    metadata?: Record<string, unknown>
  ): T {
    const end = this.startSpan(name, metadata);
    try {
      return fn();
    } finally {
      end();
    }
  }

  finish(extraCounters: Record<string, number> = {}): PerformanceTraceSummary {
    if (this.finished) return this.finished;
    for (const [key, value] of Object.entries(extraCounters)) {
      this.incrementCounter(key, value);
    }
    const endedAt = Date.now();
    this.finished = {
      name: this.name,
      startedAt: this.startedAt,
      endedAt,
      durationMs: endedAt - this.startedAt,
      firstEventLatencyMs: this.firstEventAt === undefined ? undefined : this.firstEventAt - this.startedAt,
      firstActionLatencyMs: this.firstActionAt === undefined ? undefined : this.firstActionAt - this.startedAt,
      eventCounts: Object.fromEntries(this.eventCounts),
      counters: Object.fromEntries(this.counters),
      spans: [...this.spans],
    };
    return this.finished;
  }
}

export function getPerformanceTrace(result: unknown): PerformanceTraceSummary | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const trace = (result as Record<string, unknown>).performanceTrace;
  if (!trace || typeof trace !== 'object') return undefined;
  return trace as PerformanceTraceSummary;
}
