import { isLocalStructuredActionModel } from './local-action-budget.js';

export interface TokenUsageSnapshot {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  source: 'openai' | 'gemini' | 'react' | 'generic';
}

export interface ContextMessageLike {
  role?: string;
  content?: unknown;
  tokenUsage?: unknown;
  usage?: unknown;
  usageMetadata?: unknown;
}

export interface ContextWindowEstimate {
  baselineTokens: number;
  estimatedNewTokens: number;
  totalTokens: number;
  messageCount: number;
  usageSource?: TokenUsageSnapshot['source'];
}

export interface TokenSavingsEstimate {
  originalTokens: number;
  compactedTokens: number;
  savedTokens: number;
  reductionPercentage: number;
}

export type ContextCategory = 'task' | 'plan' | 'active_errors' | 'permissions' | 'evidence' | 'memory' | 'history';
export interface ContextBudget { category: ContextCategory; maxTokens: number; required: boolean; }
export const DEFAULT_CONTEXT_BUDGETS: readonly ContextBudget[] = [
  { category: 'task', maxTokens: 1_200, required: true },
  { category: 'plan', maxTokens: 1_000, required: true },
  { category: 'active_errors', maxTokens: 1_500, required: true },
  { category: 'permissions', maxTokens: 500, required: true },
  { category: 'evidence', maxTokens: 1_500, required: true },
  { category: 'memory', maxTokens: 2_000, required: false },
  { category: 'history', maxTokens: 4_000, required: false },
];

export const LOCAL_CONTEXT_BUDGETS: readonly ContextBudget[] = [
  { category: 'task', maxTokens: 1_000, required: true },
  { category: 'plan', maxTokens: 800, required: true },
  { category: 'active_errors', maxTokens: 1_000, required: true },
  { category: 'permissions', maxTokens: 500, required: true },
  { category: 'evidence', maxTokens: 1_000, required: true },
  { category: 'memory', maxTokens: 1_500, required: false },
  { category: 'history', maxTokens: 1_500, required: false },
];

/** Keep the parent coordinator prompt small after fresh-context child work. */
export const SUBTASK_COORDINATOR_CONTEXT_BUDGETS: readonly ContextBudget[] = [
  { category: 'task', maxTokens: 1_000, required: true },
  { category: 'plan', maxTokens: 600, required: true },
  { category: 'active_errors', maxTokens: 800, required: true },
  { category: 'permissions', maxTokens: 500, required: true },
  { category: 'evidence', maxTokens: 1_600, required: true },
  { category: 'memory', maxTokens: 800, required: false },
  { category: 'history', maxTokens: 600, required: false },
];

export function resolveContextBudgets(options?: {
  provider?: string;
  model?: string;
  isLocal?: boolean;
}): readonly ContextBudget[] {
  if (options?.isLocal) return LOCAL_CONTEXT_BUDGETS;
  const provider = options?.provider?.trim().toLowerCase();
  if (provider === 'local' || provider === 'colab') return LOCAL_CONTEXT_BUDGETS;
  if (options?.model && isLocalStructuredActionModel(options.model)) return LOCAL_CONTEXT_BUDGETS;
  return DEFAULT_CONTEXT_BUDGETS;
}

interface ReactStepLike {
  thought?: string;
  action?: string;
  action_input?: unknown;
  observation?: string;
  final_answer?: string;
}

const CHARS_PER_TOKEN = 4;
const MESSAGE_OVERHEAD_TOKENS = 8;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function serializeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function estimateTextTokens(value: string): number {
  if (!value) return 0;
  return Math.ceil(value.length / CHARS_PER_TOKEN);
}

export function estimateValueTokens(value: unknown): number {
  return estimateTextTokens(serializeValue(value));
}

/** Compares the context cost of a raw observation with its compacted form. */
export function estimateCompactionTokenSavings(
  originalObservation: string,
  compactedObservation: string,
): TokenSavingsEstimate {
  const originalTokens = estimateTextTokens(originalObservation);
  const compactedTokens = estimateTextTokens(compactedObservation);
  const savedTokens = Math.max(0, originalTokens - compactedTokens);
  return {
    originalTokens,
    compactedTokens,
    savedTokens,
    reductionPercentage: originalTokens > 0
      ? Number(((savedTokens / originalTokens) * 100).toFixed(2))
      : 0,
  };
}

export function estimateMessagesTokens(messages: readonly ContextMessageLike[]): number {
  return messages.reduce((sum, message) => (
    sum + MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(message.role || '') + estimateValueTokens(message.content)
  ), 0);
}

export function extractTokenUsageSnapshot(value: unknown): TokenUsageSnapshot | null {
  const root = asRecord(value);
  if (!root) return null;

  const directTotal = toNumber(root.totalTokens);
  const directPrompt = toNumber(root.promptTokens);
  const directCompletion = toNumber(root.completionTokens);
  if (directTotal !== undefined || directPrompt !== undefined || directCompletion !== undefined) {
    const promptTokens = directPrompt || 0;
    const completionTokens = directCompletion || 0;
    return {
      promptTokens,
      completionTokens,
      totalTokens: directTotal ?? promptTokens + completionTokens,
      source: 'react',
    };
  }

  const openAIUsage = asRecord(root.usage);
  if (openAIUsage) {
    const promptTokens = toNumber(openAIUsage.prompt_tokens) || 0;
    const completionTokens = toNumber(openAIUsage.completion_tokens) || 0;
    const totalTokens = toNumber(openAIUsage.total_tokens) ?? promptTokens + completionTokens;
    if (totalTokens > 0 || promptTokens > 0 || completionTokens > 0) {
      return { promptTokens, completionTokens, totalTokens, source: 'openai' };
    }
  }

  const geminiUsage = asRecord(root.usageMetadata);
  if (geminiUsage) {
    const promptTokens = toNumber(geminiUsage.promptTokenCount) || 0;
    const completionTokens = toNumber(geminiUsage.candidatesTokenCount)
      ?? toNumber(geminiUsage.completionTokenCount)
      ?? 0;
    const totalTokens = toNumber(geminiUsage.totalTokenCount) ?? promptTokens + completionTokens;
    if (totalTokens > 0 || promptTokens > 0 || completionTokens > 0) {
      return { promptTokens, completionTokens, totalTokens, source: 'gemini' };
    }
  }

  const nestedUsage = asRecord(root.tokenUsage);
  return nestedUsage ? extractTokenUsageSnapshot(nestedUsage) : null;
}

export function estimateContextWindow(messages: readonly ContextMessageLike[]): ContextWindowEstimate {
  let latestUsageIndex = -1;
  let latestUsage: TokenUsageSnapshot | null = null;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    latestUsage = extractTokenUsageSnapshot(messages[index]);
    if (latestUsage) {
      latestUsageIndex = index;
      break;
    }
  }

  const newMessages = latestUsageIndex >= 0 ? messages.slice(latestUsageIndex + 1) : messages;
  const estimatedNewTokens = estimateMessagesTokens(newMessages);
  const baselineTokens = latestUsage?.totalTokens || 0;

  return {
    baselineTokens,
    estimatedNewTokens,
    totalTokens: baselineTokens + estimatedNewTokens,
    messageCount: messages.length,
    usageSource: latestUsage?.source,
  };
}

export function reactStepsToContextMessages(steps: readonly ReactStepLike[]): ContextMessageLike[] {
  return steps.flatMap((step) => {
    const messages: ContextMessageLike[] = [{
      role: 'assistant',
      content: {
        thought: step.thought || '',
        action: step.action || '',
        action_input: step.action_input || {},
      },
    }];

    if (step.observation) messages.push({ role: 'tool', content: step.observation });
    if (step.final_answer) messages.push({ role: 'assistant', content: step.final_answer });
    return messages;
  });
}

export function estimateReactStepContext(steps: readonly ReactStepLike[]): ContextWindowEstimate {
  return estimateContextWindow(reactStepsToContextMessages(steps));
}

/** Bounds each context category independently so old conversation cannot evict active execution truth. */
export function compactContextByBudget(
  sections: Partial<Record<ContextCategory, string>>,
  budgets: readonly ContextBudget[] = DEFAULT_CONTEXT_BUDGETS,
): Record<ContextCategory, string> {
  const result = {} as Record<ContextCategory, string>;
  for (const budget of budgets) {
    const value = sections[budget.category] || '';
    const maxChars = budget.maxTokens * CHARS_PER_TOKEN;
    result[budget.category] = value.length <= maxChars
      ? value
      : `${value.slice(0, Math.max(0, maxChars - 48))}\n...[${budget.category} compacted]`;
  }
  return result;
}
