import type {
  DurableContextMessage,
  StoredAgentContextSnapshot,
} from '../../persistence/contextSnapshot.js';
import {
  compactContextByBudget,
  DEFAULT_CONTEXT_BUDGETS,
  estimateMessagesTokens,
  type ContextBudget,
  type ContextCategory,
} from '@barok/engine';

export interface CordisContextTarget {
  model?: string;
  contextWindow?: number;
  outputTokenReserve?: number;
}

export interface PreparedContextMessages {
  messages: Array<{ role: string; content: string }>;
  estimatedInputTokens: number;
  promptBudgetTokens?: number;
  removedCharacters: number;
}

export interface CordisContextAssemblyService {
  readonly kind: 'context_assembly';
  readonly version: 1;
  /** The last durable, observable snapshot used to hydrate this runtime. */
  getSnapshot(): StoredAgentContextSnapshot | undefined;
  /** Return a defensive copy so plugins cannot mutate durable context in place. */
  getMessages(): DurableContextMessage[];
  /** The active model target used to size the next provider prompt. */
  getTarget(): CordisContextTarget;
  /** Rebind the live context budget when a resumed run changes models. */
  setTarget(target: CordisContextTarget): void;
  /** Compact one provider-neutral prompt before it reaches any model route. */
  prepareMessages(messages: Array<{ role: string; content: string }>): PreparedContextMessages;
  /** Compact planner sections while preserving their required/optional priority. */
  compactSections(
    sections: Partial<Record<ContextCategory, string>>,
    budgets?: readonly ContextBudget[],
  ): Record<ContextCategory, string>;
  markHydrated(): void;
  readonly hydrated: boolean;
}

export interface CordisProviderCooldownState {
  status: 'ready' | 'waiting';
  attempt: number;
  provider?: string;
  model?: string;
  waitingUntil?: number;
  reason?: string;
}

export interface CordisProviderCooldownService {
  readonly kind: 'provider_cooldown';
  getState(): CordisProviderCooldownState;
  begin(input: {
    attempt: number;
    waitingUntil: number;
    provider?: string;
    model?: string;
    reason?: string;
  }): CordisProviderCooldownState;
  clear(): void;
  remainingMs(now?: number): number;
}

export interface CordisTelemetryEntry {
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface CordisTelemetryService {
  readonly kind: 'telemetry';
  record(entry: CordisTelemetryEntry): void;
  getEntries(): CordisTelemetryEntry[];
  getCounts(): Record<string, number>;
  clear(): void;
}

export type CordisLifecyclePhase = 'created' | 'active' | 'disposed';

export interface CordisLifecycleService {
  readonly kind: 'lifecycle';
  readonly phase: CordisLifecyclePhase;
  transition(phase: CordisLifecyclePhase, detail?: string): void;
  onTransition(listener: (transition: { phase: CordisLifecyclePhase; detail?: string; at: number }) => void): () => void;
}

export interface CordisRuntimeServices {
  contextAssembly: CordisContextAssemblyService;
  providerCooldown: CordisProviderCooldownService;
  telemetry: CordisTelemetryService;
  lifecycle: CordisLifecycleService;
}

function cloneSnapshot(snapshot: StoredAgentContextSnapshot | undefined): StoredAgentContextSnapshot | undefined {
  return snapshot ? structuredClone(snapshot) : undefined;
}

const DEFAULT_OUTPUT_TOKEN_RESERVE = 4_096;
const MIN_CONTEXT_WINDOW = 1_024;

function positiveInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= MIN_CONTEXT_WINDOW ? Math.floor(numeric) : undefined;
}

function normalizeTarget(target: CordisContextTarget): CordisContextTarget {
  const contextWindow = positiveInteger(target.contextWindow);
  const outputTokenReserve = contextWindow
    ? Math.min(
        Math.max(256, Math.floor(contextWindow * 0.25)),
        Math.max(256, Math.floor(Number(target.outputTokenReserve) || DEFAULT_OUTPUT_TOKEN_RESERVE)),
      )
    : Math.max(256, Math.floor(Number(target.outputTokenReserve) || DEFAULT_OUTPUT_TOKEN_RESERVE));
  return {
    ...(typeof target.model === 'string' && target.model.trim() ? { model: target.model.trim() } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    outputTokenReserve,
  };
}

function promptBudget(target: CordisContextTarget): number | undefined {
  return target.contextWindow
    ? Math.max(256, target.contextWindow - (target.outputTokenReserve || DEFAULT_OUTPUT_TOKEN_RESERVE))
    : undefined;
}

function compactMessage(value: string, maxCharacters: number): string {
  if (maxCharacters <= 0) return '';
  if (value.length <= maxCharacters) return value;
  const marker = '\n...[context compacted]...\n';
  if (maxCharacters <= marker.length) return value.slice(0, maxCharacters);
  const available = maxCharacters - marker.length;
  const head = Math.max(1, Math.floor(available * 0.7));
  const tail = Math.max(0, available - head);
  return `${value.slice(0, head)}${marker}${tail > 0 ? value.slice(-tail) : ''}`.slice(0, maxCharacters);
}

function fitMessagesToBudget(
  messages: Array<{ role: string; content: string }>,
  budget: number,
): Array<{ role: string; content: string }> {
  const fitted = messages.map((message) => ({ ...message }));

  // Drop compressed middle entries first. The first system instruction and
  // the most recent user/assistant/tool entries are more useful on resume.
  while (estimateMessagesTokens(fitted) > budget && fitted.length > 2) {
    const firstIsSystem = fitted[0]?.role === 'system';
    fitted.splice(firstIsSystem ? 1 : 0, 1);
  }

  let guard = 0;
  while (estimateMessagesTokens(fitted) > budget && guard++ < 32) {
    const candidates = fitted
      .map((message, index) => ({ index, length: message.content.length, isSystem: message.role === 'system' }))
      .filter((candidate) => candidate.length > 0)
      .sort((left, right) => {
        if (left.isSystem !== right.isSystem) return left.isSystem ? 1 : -1;
        return right.length - left.length;
      });
    const candidate = candidates[0];
    if (!candidate) break;
    const excessTokens = estimateMessagesTokens(fitted) - budget;
    const nextLength = Math.max(0, candidate.length - Math.max(4, excessTokens * 4));
    const nextContent = compactMessage(fitted[candidate.index].content, nextLength);
    fitted[candidate.index] = { ...fitted[candidate.index], content: nextContent };
    if (nextContent.length >= candidate.length) {
      fitted[candidate.index] = { ...fitted[candidate.index], content: fitted[candidate.index].content.slice(0, -1) };
    }
  }

  return fitted;
}

function prepareMessagesForTarget(
  messages: Array<{ role: string; content: string }>,
  target: CordisContextTarget,
): PreparedContextMessages {
  const normalized = messages.map((message) => ({
    role: message.role,
    content: typeof message.content === 'string' ? message.content : String(message.content || ''),
  }));
  const estimatedInputTokens = estimateMessagesTokens(normalized);
  const budget = promptBudget(target);
  if (!budget || estimatedInputTokens <= budget) {
    return { messages: normalized, estimatedInputTokens, promptBudgetTokens: budget, removedCharacters: 0 };
  }

  const maxCharacters = Math.max(4_000, budget * 4);
  const firstIsSystem = normalized[0]?.role === 'system';
  const first = firstIsSystem ? normalized[0] : undefined;
  const tailCount = Math.min(3, Math.max(0, normalized.length - (first ? 1 : 0)));
  const tail = normalized.slice(-tailCount);
  const tailStart = normalized.length - tailCount;
  const middle = normalized.slice(first ? 1 : 0, tailStart);
  const originalCharacters = normalized.reduce((sum, message) => sum + message.content.length, 0);
  const middleSummary = middle.length > 0
    ? {
        role: 'user',
        content: `[compressed prior context]\n${middle
          .map((message) => `${message.role}: ${message.content.replace(/\s+/g, ' ').slice(0, 240)}`)
          .join('\n')
          .slice(0, Math.max(800, Math.floor(maxCharacters * 0.15)))}`,
      }
    : undefined;
  let prepared = [
    ...(first ? [first] : []),
    ...(middleSummary ? [middleSummary] : []),
    ...tail,
  ];

  prepared = prepared.map((message) => ({
    ...message,
    content: compactMessage(message.content, maxCharacters),
  }));
  prepared = fitMessagesToBudget(prepared, budget);

  return {
    messages: prepared,
    estimatedInputTokens: estimateMessagesTokens(prepared),
    promptBudgetTokens: budget,
    removedCharacters: Math.max(
      0,
      originalCharacters - prepared.reduce((sum, message) => sum + message.content.length, 0),
    ),
  };
}

function scaleBudgets(
  target: CordisContextTarget,
  budgets: readonly ContextBudget[],
): readonly ContextBudget[] {
  const available = promptBudget(target);
  if (!available) return budgets;
  const total = budgets.reduce((sum, budget) => sum + budget.maxTokens, 0);
  if (total <= available) return budgets;
  const factor = available / total;
  return budgets.map((budget) => ({
    ...budget,
    maxTokens: Math.max(budget.required ? 160 : 80, Math.floor(budget.maxTokens * factor)),
  }));
}

export function createCordisContextAssemblyService(
  snapshot?: StoredAgentContextSnapshot,
  initialTarget: CordisContextTarget = {},
): CordisContextAssemblyService {
  let hydrated = Boolean(snapshot);
  let target = normalizeTarget({
    model: initialTarget.model || snapshot?.model,
    contextWindow: initialTarget.contextWindow || snapshot?.modelContextWindow,
    outputTokenReserve: initialTarget.outputTokenReserve,
  });
  return {
    kind: 'context_assembly',
    version: 1,
    getSnapshot: () => cloneSnapshot(snapshot),
    getMessages: () => snapshot ? structuredClone(snapshot.messages) : [],
    getTarget: () => ({ ...target }),
    setTarget: (next) => {
      target = normalizeTarget({ ...target, ...next });
    },
    prepareMessages: (messages) => prepareMessagesForTarget(messages, target),
    compactSections: (sections, budgets = DEFAULT_CONTEXT_BUDGETS) => compactContextByBudget(sections, scaleBudgets(target, budgets)),
    markHydrated: () => { hydrated = true; },
    get hydrated() { return hydrated; },
  };
}

export function createCordisProviderCooldownService(): CordisProviderCooldownService {
  let state: CordisProviderCooldownState = { status: 'ready', attempt: 0 };
  return {
    kind: 'provider_cooldown',
    getState: () => ({ ...state }),
    begin: (input) => {
      state = {
        status: 'waiting',
        attempt: Math.max(1, Math.floor(input.attempt)),
        waitingUntil: Math.max(Date.now(), Math.floor(input.waitingUntil)),
        ...(input.provider ? { provider: input.provider.slice(0, 120) } : {}),
        ...(input.model ? { model: input.model.slice(0, 240) } : {}),
        ...(input.reason ? { reason: input.reason.slice(0, 500) } : {}),
      };
      return { ...state };
    },
    clear: () => { state = { status: 'ready', attempt: state.attempt }; },
    remainingMs: (now = Date.now()) => state.status === 'waiting' && state.waitingUntil
      ? Math.max(0, state.waitingUntil - now)
      : 0,
  };
}

export function createCordisTelemetryService(maxEntries = 200): CordisTelemetryService {
  const entries: CordisTelemetryEntry[] = [];
  return {
    kind: 'telemetry',
    record: (entry) => {
      if (!entry || typeof entry.type !== 'string' || !entry.type.trim()) return;
      entries.push({
        type: entry.type.slice(0, 120),
        timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
        data: structuredClone(entry.data || {}),
      });
      if (entries.length > Math.max(1, maxEntries)) entries.splice(0, entries.length - Math.max(1, maxEntries));
    },
    getEntries: () => structuredClone(entries),
    getCounts: () => entries.reduce<Record<string, number>>((counts, entry) => {
      counts[entry.type] = (counts[entry.type] || 0) + 1;
      return counts;
    }, {}),
    clear: () => { entries.length = 0; },
  };
}

export function createCordisLifecycleService(): CordisLifecycleService {
  let phase: CordisLifecyclePhase = 'created';
  const listeners = new Set<(transition: { phase: CordisLifecyclePhase; detail?: string; at: number }) => void>();
  return {
    kind: 'lifecycle',
    get phase() { return phase; },
    transition: (next, detail) => {
      if (phase === 'disposed' && next !== 'disposed') return;
      phase = next;
      const event = { phase: next, ...(detail ? { detail: detail.slice(0, 500) } : {}), at: Date.now() };
      for (const listener of [...listeners]) listener(event);
    },
    onTransition: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createCordisRuntimeServices(
  snapshot?: StoredAgentContextSnapshot,
  target: CordisContextTarget = {},
): CordisRuntimeServices {
  return {
    contextAssembly: createCordisContextAssemblyService(snapshot, target),
    providerCooldown: createCordisProviderCooldownService(),
    telemetry: createCordisTelemetryService(),
    lifecycle: createCordisLifecycleService(),
  };
}
