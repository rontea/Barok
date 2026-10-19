export interface TypewriterController {
  setTarget(text: string): void;
  flush(text?: string): void;
  cancel(): void;
  getText(): string;
}

interface TypewriterOptions {
  intervalMs?: number;
  charactersPerTick?: number;
  /** Keep the current visible update intact before showing the newest one. */
  queueUpdates?: boolean;
  onText: (text: string) => void;
  onComplete?: () => void;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancelScheduled?: (handle: unknown) => void;
}

export const FREE_TIER_TYPEWRITER_INTERVAL_MS = 32;

/**
 * Reveals status text one Unicode character at a time. A newer status replaces
 * stale unfinished text instead of building an unbounded animation backlog.
 */
export function createTypewriterController(options: TypewriterOptions): TypewriterController {
  const intervalMs = Math.max(8, Math.floor(options.intervalMs ?? FREE_TIER_TYPEWRITER_INTERVAL_MS));
  const charactersPerTick = Math.max(1, Math.floor(options.charactersPerTick ?? 1));
  const schedule = options.schedule ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
  const cancelScheduled = options.cancelScheduled ?? ((handle) => window.clearTimeout(handle as number));
  let displayed: string[] = [];
  let target: string[] = [];
  let queuedTarget: string[] | undefined;
  let handle: unknown;

  const cancelTimer = () => {
    if (handle === undefined) return;
    cancelScheduled(handle);
    handle = undefined;
  };

  const tick = () => {
    handle = undefined;
    if (displayed.length >= target.length) {
      if (queuedTarget) {
        target = queuedTarget;
        queuedTarget = undefined;
        displayed = [];
        options.onText('');
        start();
      }
      return;
    }
    displayed = target.slice(0, displayed.length + charactersPerTick);
    options.onText(displayed.join(''));
    if (displayed.length < target.length) {
      handle = schedule(tick, intervalMs);
    } else if (queuedTarget) {
      target = queuedTarget;
      queuedTarget = undefined;
      displayed = [];
      options.onText('');
      handle = schedule(tick, intervalMs);
    } else {
      options.onComplete?.();
    }
  };

  const start = () => {
    if (handle === undefined && displayed.length < target.length) {
      handle = schedule(tick, intervalMs);
    }
  };

  return {
    setTarget(text: string) {
      const nextTarget = Array.from(text);
      if (options.queueUpdates && displayed.length < target.length) {
        queuedTarget = nextTarget;
        return;
      }
      cancelTimer();
      queuedTarget = undefined;
      const keepsCurrentPrefix = displayed.every((character, index) => nextTarget[index] === character);
      target = nextTarget;
      if (!keepsCurrentPrefix) {
        displayed = [];
        options.onText('');
      }
      start();
    },
    flush(text?: string) {
      cancelTimer();
      queuedTarget = undefined;
      if (typeof text === 'string') target = Array.from(text);
      displayed = [...target];
      options.onText(displayed.join(''));
      options.onComplete?.();
    },
    cancel() {
      cancelTimer();
      queuedTarget = undefined;
      target = displayed;
    },
    getText() {
      return displayed.join('');
    },
  };
}
