import type { LLMRequestBudget } from '../types.js';
import type { ProviderError } from './providerErrors.js';
import { NormalizedProviderError } from './providerErrors.js';
import { getSQLiteAppStore } from '../../persistence/sqliteStore.js';

export interface ProviderSchedulerConfig {
  provider: string;
  maxConcurrency: number;
  maxPending: number;
  maxRetries: number;
  maxRequestsPerTask: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  now?: () => number;
  random?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  persistState?: boolean;
}

export interface ProviderSchedulerRunOptions {
  priority?: number;
  signal?: AbortSignal;
  deadlineAt?: number;
  taskId?: string;
  requestBudget?: LLMRequestBudget;
  onAttempt?: (attempt: number) => void;
}

export interface ProviderSchedulerSnapshot {
  provider: string;
  activeCount: number;
  pendingCount: number;
  maxConcurrency: number;
  maxPending: number;
  cooldownUntil?: string;
  cooldownReason?: string;
  recoveryProbePending: boolean;
  shuttingDown: boolean;
  totals: {
    enqueued: number;
    completed: number;
    failed: number;
    cancelled: number;
    retries: number;
    capacityRejected: number;
  };
}

interface QueueItem<T> {
  sequence: number;
  priority: number;
  enqueuedAt: number;
  options: ProviderSchedulerRunOptions;
  operation: (attempt: number, signal: AbortSignal) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const SCHEDULER_STATE_KEY = 'groq.schedulerState';

function normalizedError(error: unknown): ProviderError | undefined {
  return error instanceof NormalizedProviderError ? error.providerError : undefined;
}

function isRetryable(error: unknown): boolean {
  const normalized = normalizedError(error);
  return Boolean(normalized?.retryable && (
    normalized.code === 'REQUEST_TIMEOUT'
    || normalized.code === 'TEMPORARILY_UNAVAILABLE'
    || normalized.code === 'NETWORK_ERROR'
  ));
}

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException('Request cancelled', 'AbortError'));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class ProviderScheduler {
  private readonly config: Required<Omit<ProviderSchedulerConfig, 'setTimer'>> & Pick<ProviderSchedulerConfig, 'setTimer'>;
  private readonly queue: Array<QueueItem<unknown>> = [];
  private readonly taskAttempts = new Map<string, number>();
  private sequence = 0;
  private activeCount = 0;
  private cooldownUntil = 0;
  private cooldownReason?: string;
  private recoveryProbePending = false;
  private recoveryProbeInFlight = false;
  private shuttingDown = false;
  private wakeTimer?: ReturnType<typeof setTimeout>;
  private totals = { enqueued: 0, completed: 0, failed: 0, cancelled: 0, retries: 0, capacityRejected: 0 };

  constructor(config: ProviderSchedulerConfig) {
    this.config = {
      ...config,
      baseRetryDelayMs: config.baseRetryDelayMs ?? 2_000,
      maxRetryDelayMs: config.maxRetryDelayMs ?? 30_000,
      now: config.now ?? Date.now,
      random: config.random ?? Math.random,
      persistState: config.persistState ?? false,
    };
    if (this.config.persistState && config.provider === 'groq') {
      try {
        const saved = getSQLiteAppStore().getSetting<ProviderSchedulerSnapshot>(SCHEDULER_STATE_KEY);
        const cooldownUntil = saved?.cooldownUntil ? Date.parse(saved.cooldownUntil) : 0;
        if (Number.isFinite(cooldownUntil) && cooldownUntil > this.config.now()) {
          this.cooldownUntil = cooldownUntil;
          this.cooldownReason = saved?.cooldownReason;
          this.recoveryProbePending = true;
        }
        if (saved?.totals) this.totals = { ...this.totals, ...saved.totals };
      } catch {
        // Invalid or unavailable persisted metadata starts from a safe empty state.
      }
    }
  }

  run<T>(
    operation: (attempt: number, signal: AbortSignal) => Promise<T>,
    options: ProviderSchedulerRunOptions = {},
  ): Promise<T> {
    if (this.shuttingDown) {
      return Promise.reject(new NormalizedProviderError({
        provider: this.config.provider, code: 'CAPACITY_EXCEEDED', retryable: false,
        safeMessage: `${this.config.provider} scheduler is shutting down.`,
      }));
    }
    if (this.queue.length >= this.config.maxPending) {
      this.totals.capacityRejected++;
      this.persist();
      return Promise.reject(new NormalizedProviderError({
        provider: this.config.provider, code: 'CAPACITY_EXCEEDED', retryable: false,
        safeMessage: `${this.config.provider} request queue is full.`,
      }));
    }
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = {
        sequence: this.sequence++,
        priority: Math.max(0, Math.min(100, Math.floor(options.priority ?? 50))),
        enqueuedAt: this.config.now(),
        options,
        operation,
        resolve,
        reject,
      };
      this.queue.push(item as QueueItem<unknown>);
      this.queue.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
      this.totals.enqueued++;
      this.persist();
      this.pump();
    });
  }

  setCooldown(until: number, reason: string): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, until);
    this.cooldownReason = reason.slice(0, 120);
    this.recoveryProbePending = true;
    this.persist();
    this.scheduleWake();
  }

  clearCooldown(): void {
    this.cooldownUntil = 0;
    this.cooldownReason = undefined;
    this.recoveryProbePending = false;
    this.recoveryProbeInFlight = false;
    this.persist();
    this.pump();
  }

  getSnapshot(): ProviderSchedulerSnapshot {
    const now = this.config.now();
    return {
      provider: this.config.provider,
      activeCount: this.activeCount,
      pendingCount: this.queue.length,
      maxConcurrency: this.config.maxConcurrency,
      maxPending: this.config.maxPending,
      cooldownUntil: this.cooldownUntil > now ? new Date(this.cooldownUntil).toISOString() : undefined,
      cooldownReason: this.cooldownUntil > now ? this.cooldownReason : undefined,
      recoveryProbePending: this.recoveryProbePending,
      shuttingDown: this.shuttingDown,
      totals: { ...this.totals },
    };
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    while (this.queue.length) {
      const item = this.queue.shift()!;
      item.reject(new NormalizedProviderError({
        provider: this.config.provider, code: 'CANCELLED', retryable: false,
        safeMessage: `${this.config.provider} request cancelled during shutdown.`,
      }));
    }
    this.persist();
  }

  private scheduleWake(): void {
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    const delay = Math.max(0, this.cooldownUntil - this.config.now());
    const schedule = this.config.setTimer || setTimeout;
    this.wakeTimer = schedule(() => {
      this.wakeTimer = undefined;
      this.pump();
    }, delay);
  }

  private pump(): void {
    if (this.shuttingDown) return;
    const now = this.config.now();
    if (this.cooldownUntil > now) {
      this.scheduleWake();
      return;
    }
    if (this.cooldownUntil) {
      this.cooldownUntil = 0;
      this.cooldownReason = undefined;
    }
    this.removeCancelledOrExpired();
    const dispatchLimit = this.recoveryProbePending ? (this.recoveryProbeInFlight ? 0 : 1) : this.config.maxConcurrency;
    while (this.activeCount < dispatchLimit && this.queue.length) {
      const item = this.queue.shift()!;
      const recoveryProbe = this.recoveryProbePending;
      if (recoveryProbe) this.recoveryProbeInFlight = true;
      this.activeCount++;
      void this.execute(item, recoveryProbe).finally(() => {
        this.activeCount--;
        this.persist();
        this.pump();
      });
    }
    this.persist();
  }

  private removeCancelledOrExpired(): void {
    const now = this.config.now();
    for (let index = this.queue.length - 1; index >= 0; index--) {
      const item = this.queue[index];
      if (item.options.signal?.aborted || (item.options.deadlineAt && item.options.deadlineAt <= now)) {
        this.queue.splice(index, 1);
        this.totals.cancelled++;
        item.reject(item.options.signal?.reason || new NormalizedProviderError({
          provider: this.config.provider,
          code: item.options.signal?.aborted ? 'CANCELLED' : 'REQUEST_TIMEOUT',
          retryable: false,
          safeMessage: item.options.signal?.aborted
            ? `${this.config.provider} request was cancelled before dispatch.`
            : `${this.config.provider} request expired while queued.`,
        }));
      }
    }
  }

  private async execute(item: QueueItem<unknown>, recoveryProbe = false): Promise<void> {
    const controller = new AbortController();
    const onAbort = () => controller.abort(item.options.signal?.reason);
    item.options.signal?.addEventListener('abort', onAbort, { once: true });
    let attempt = 0;
    try {
      while (true) {
        if (controller.signal.aborted) throw controller.signal.reason || new DOMException('Request cancelled', 'AbortError');
        if (item.options.deadlineAt && item.options.deadlineAt <= this.config.now()) {
          throw new NormalizedProviderError({
            provider: this.config.provider, code: 'REQUEST_TIMEOUT', retryable: false,
            safeMessage: `${this.config.provider} request deadline expired.`,
          });
        }
        const taskId = item.options.taskId || `anonymous:${item.sequence}`;
        const taskAttempts = this.taskAttempts.get(taskId) || 0;
        if (taskAttempts >= this.config.maxRequestsPerTask || (item.options.requestBudget && !item.options.requestBudget.tryConsumeRequest())) {
          throw new NormalizedProviderError({
            provider: this.config.provider, code: 'INVALID_REQUEST', retryable: false,
            safeMessage: `${this.config.provider} task request limit was reached.`,
          });
        }
        this.taskAttempts.set(taskId, taskAttempts + 1);
        item.options.onAttempt?.(attempt);
        try {
          const value = await item.operation(attempt, controller.signal);
          this.totals.completed++;
          if (recoveryProbe) {
            this.recoveryProbePending = false;
            this.recoveryProbeInFlight = false;
          }
          item.resolve(value);
          return;
        } catch (error) {
          const providerError = normalizedError(error);
          if (providerError?.code === 'RATE_LIMITED' || providerError?.code === 'QUOTA_EXHAUSTED') {
            const cooldownMs = providerError.retryAfterMs ?? 60_000;
            this.setCooldown(this.config.now() + cooldownMs, providerError.code);
          }
          if (!isRetryable(error) || attempt >= this.config.maxRetries) throw error;
          attempt++;
          this.totals.retries++;
          const exponential = Math.min(this.config.maxRetryDelayMs, this.config.baseRetryDelayMs * (2 ** (attempt - 1)));
          const jittered = Math.floor(exponential * (0.75 + this.config.random() * 0.5));
          const retryDelay = Math.max(jittered, providerError?.retryAfterMs || 0);
          if (item.options.deadlineAt && this.config.now() + retryDelay >= item.options.deadlineAt) throw error;
          await wait(retryDelay, controller.signal);
        }
      }
    } catch (error) {
      if (recoveryProbe) {
        this.recoveryProbeInFlight = false;
        this.setCooldown(this.config.now() + 60_000, 'recovery_probe_failed');
      }
      if (controller.signal.aborted) this.totals.cancelled++;
      else this.totals.failed++;
      item.reject(error);
    } finally {
      item.options.signal?.removeEventListener('abort', onAbort);
    }
  }

  private persist(): void {
    if (!this.config.persistState) return;
    try {
      getSQLiteAppStore().saveSetting(SCHEDULER_STATE_KEY, this.getSnapshot());
    } catch {
      // Scheduler persistence is safe metadata and must not affect dispatch.
    }
  }
}

let groqScheduler: ProviderScheduler | undefined;

export function getGroqScheduler(config: Omit<ProviderSchedulerConfig, 'provider'>): ProviderScheduler {
  if (!groqScheduler) groqScheduler = new ProviderScheduler({ provider: 'groq', persistState: true, ...config });
  return groqScheduler;
}

export async function resetGroqScheduler(): Promise<void> {
  if (groqScheduler) {
    await groqScheduler.shutdown();
    groqScheduler.clearCooldown();
  }
  groqScheduler = undefined;
  try {
    getSQLiteAppStore().saveSetting(SCHEDULER_STATE_KEY, {
      provider: 'groq',
      activeCount: 0,
      pendingCount: 0,
      maxConcurrency: 1,
      maxPending: 25,
      shuttingDown: false,
      totals: { enqueued: 0, completed: 0, failed: 0, cancelled: 0, retries: 0, capacityRejected: 0 },
    });
  } catch {
    // Test/config reset remains best-effort when persistence is unavailable.
  }
}
