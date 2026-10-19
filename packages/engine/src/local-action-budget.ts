export type LocalStructuredActionClass = 'inspection' | 'recovery' | 'implementation';

export const DEFAULT_LOCAL_GENERATION_TOKENS_PER_SECOND = 18;
export const DEFAULT_LOCAL_PROMPT_TOKENS_PER_SECOND = 320;
export const DEFAULT_LOCAL_ACTION_SAFETY_MARGIN_MS = 10_000;
export const LOCAL_INSPECTION_ACTION_MAX_TOKENS = 640;
export const LOCAL_RECOVERY_ACTION_MAX_TOKENS = 512;
export const LOCAL_MIN_ACTION_TOKENS = 256;
export const LOCAL_MAX_WRITE_CHUNK_CHARACTERS = 3_000;

export interface LocalActionBudgetControllerOptions {
  defaultGenerationTokensPerSecond?: number;
  promptTokensPerSecond?: number;
  safetyMarginMs?: number;
}

export interface LocalActionBudgetRequest {
  model: string;
  configuredMaxTokens: number;
  promptTokens: number;
  remainingBudgetMs?: number;
  actionClass: LocalStructuredActionClass;
}

export interface LocalActionBudgetDecision {
  maxTokens: number;
  configuredMaxTokens: number;
  actionClass: LocalStructuredActionClass;
  generationTokensPerSecond: number;
  promptEvaluationMs: number;
  safetyMarginMs: number;
  remainingBudgetMs?: number;
  writeChunkCharacters: number;
  measured: boolean;
}

/** Provider telemetry fields used by the local output-budget estimator. */
export interface LocalActionBudgetTelemetry {
  provider: string;
  model: string;
  status: string;
  durationMs: number;
  reportedInputTokens?: number;
  reportedOutputTokens?: number;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  promptPrefillDurationMs?: number;
}

interface ModelSpeedEstimate {
  generationTokensPerSecond: number;
  samples: number;
}

function positiveFinite(value: unknown, fallback: number, minimum = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > minimum ? parsed : fallback;
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeModel(model: string): string {
  return model.trim().toLowerCase() || 'unknown-local-model';
}

export function isLocalProvider(provider: string): boolean {
  return provider === 'local' || provider === 'colab';
}

export function isLocalStructuredActionModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.startsWith('local:')
    || normalized.startsWith('local-target:')
    || normalized.startsWith('colab:')
    || normalized.startsWith('colab-target:');
}

export function localWriteChunkCharacters(maxTokens: number): number {
  const parsed = Number.isFinite(Number(maxTokens)) ? Math.max(1, Math.floor(Number(maxTokens))) : LOCAL_MIN_ACTION_TOKENS;
  return Math.max(600, Math.min(LOCAL_MAX_WRITE_CHUNK_CHARACTERS, Math.floor(parsed * 2.5)));
}

/**
 * Estimates how much structured output can fit inside the current local
 * provider deadline. The estimator is deliberately conservative: a small
 * action is preferable to a response that reaches the deadline and loses the
 * entire Write/Edit envelope.
 */
export class LocalActionBudgetController {
  private readonly defaultGenerationTokensPerSecond: number;
  private readonly promptTokensPerSecond: number;
  private readonly safetyMarginMs: number;
  private readonly modelEstimates = new Map<string, ModelSpeedEstimate>();

  constructor(options: LocalActionBudgetControllerOptions = {}) {
    this.defaultGenerationTokensPerSecond = bounded(
      positiveFinite(options.defaultGenerationTokensPerSecond, DEFAULT_LOCAL_GENERATION_TOKENS_PER_SECOND),
      1,
      500,
    );
    this.promptTokensPerSecond = bounded(
      positiveFinite(options.promptTokensPerSecond, DEFAULT_LOCAL_PROMPT_TOKENS_PER_SECOND),
      32,
      5_000,
    );
    this.safetyMarginMs = bounded(
      positiveFinite(options.safetyMarginMs, DEFAULT_LOCAL_ACTION_SAFETY_MARGIN_MS),
      1_000,
      60_000,
    );
  }

  observe(telemetry: LocalActionBudgetTelemetry): void {
    if (!isLocalProvider(telemetry.provider) || telemetry.status !== 'succeeded') return;
    const durationMs = Number(telemetry.durationMs);
    const outputTokens = Number(telemetry.reportedOutputTokens ?? telemetry.estimatedOutputTokens);
    if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(outputTokens) || outputTokens <= 0) return;

    const measuredPromptEvalMs = Number(telemetry.promptPrefillDurationMs);
    const inputTokens = Number(telemetry.reportedInputTokens ?? telemetry.estimatedInputTokens);
    const promptEvaluationMs = Number.isFinite(measuredPromptEvalMs) && measuredPromptEvalMs > 0
      ? measuredPromptEvalMs
      : (Number.isFinite(inputTokens) && inputTokens > 0
          ? (inputTokens / this.promptTokensPerSecond) * 1_000
          : 0);
    const decodeMs = Math.max(250, durationMs - promptEvaluationMs);
    const measuredRate = bounded(outputTokens / (decodeMs / 1_000), 1, 500);
    const key = normalizeModel(telemetry.model);
    const previous = this.modelEstimates.get(key);
    const generationTokensPerSecond = previous
      ? previous.generationTokensPerSecond * 0.7 + measuredRate * 0.3
      : measuredRate;
    this.modelEstimates.set(key, {
      generationTokensPerSecond: bounded(generationTokensPerSecond, 1, 500),
      samples: (previous?.samples || 0) + 1,
    });
  }

  resolve(request: LocalActionBudgetRequest): LocalActionBudgetDecision {
    const configuredMaxTokens = Math.max(1, Math.floor(Number(request.configuredMaxTokens) || LOCAL_INSPECTION_ACTION_MAX_TOKENS));
    const estimate = this.modelEstimates.get(normalizeModel(request.model));
    const generationTokensPerSecond = estimate?.generationTokensPerSecond || this.defaultGenerationTokensPerSecond;
    const promptTokens = Math.max(0, Number(request.promptTokens) || 0);
    const promptEvaluationMs = (promptTokens / this.promptTokensPerSecond) * 1_000;
    const phaseMaxTokens = request.actionClass === 'implementation'
      ? configuredMaxTokens
      : Math.min(
          configuredMaxTokens,
          request.actionClass === 'recovery' ? LOCAL_RECOVERY_ACTION_MAX_TOKENS : LOCAL_INSPECTION_ACTION_MAX_TOKENS,
        );
    const remainingBudgetMs = Number(request.remainingBudgetMs);
    const hasFiniteBudget = Number.isFinite(remainingBudgetMs) && remainingBudgetMs > 0;
    const availableGenerationMs = hasFiniteBudget
      ? Math.max(0, remainingBudgetMs - promptEvaluationMs - this.safetyMarginMs)
      : Number.POSITIVE_INFINITY;
    const deadlineTokenCap = Number.isFinite(availableGenerationMs)
      ? Math.max(1, Math.floor((availableGenerationMs / 1_000) * generationTokensPerSecond))
      : phaseMaxTokens;
    const maxTokens = Math.min(phaseMaxTokens, deadlineTokenCap);

    return {
      maxTokens,
      configuredMaxTokens,
      actionClass: request.actionClass,
      generationTokensPerSecond,
      promptEvaluationMs: Math.ceil(promptEvaluationMs),
      safetyMarginMs: this.safetyMarginMs,
      ...(hasFiniteBudget ? { remainingBudgetMs: Math.floor(remainingBudgetMs) } : {}),
      writeChunkCharacters: localWriteChunkCharacters(maxTokens),
      measured: Boolean(estimate),
    };
  }

  getModelSpeed(model: string): { generationTokensPerSecond: number; samples: number; measured: boolean } {
    const estimate = this.modelEstimates.get(normalizeModel(model));
    return {
      generationTokensPerSecond: estimate?.generationTokensPerSecond || this.defaultGenerationTokensPerSecond,
      samples: estimate?.samples || 0,
      measured: Boolean(estimate),
    };
  }
}
