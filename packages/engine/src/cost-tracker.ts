import { PRICING_TABLE } from './budget-manager.js';
import { extractTokenUsageSnapshot } from './token-accounting.js';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface APICallMetrics {
  provider: string;
  model: string;
  timestamp: string;
  durationMs: number;
  tokenUsage: TokenUsage | null;
  estimatedCost: number;
  success: boolean;
}

export interface CostSummary {
  totalCost: number;
  totalTokens: number;
  callCount: number;
  averageCostPerCall: number;
  averageTokensPerCall: number;
  costByProvider: Record<string, number>;
  costByModel: Record<string, number>;
}

class CostTracker {
  private calls: APICallMetrics[] = [];

  recordCall(metrics: APICallMetrics): void {
    this.calls.push(metrics);
  }

  getCalls(): APICallMetrics[] {
    return [...this.calls];
  }

  getSummary(): CostSummary {
    const summary: CostSummary = {
      totalCost: 0,
      totalTokens: 0,
      callCount: this.calls.length,
      averageCostPerCall: 0,
      averageTokensPerCall: 0,
      costByProvider: {},
      costByModel: {},
    };

    for (const call of this.calls) {
      summary.totalCost += call.estimatedCost;
      if (call.tokenUsage) summary.totalTokens += call.tokenUsage.totalTokens;
      summary.costByProvider[call.provider] = (summary.costByProvider[call.provider] || 0) + call.estimatedCost;
      summary.costByModel[call.model] = (summary.costByModel[call.model] || 0) + call.estimatedCost;
    }

    if (this.calls.length > 0) {
      summary.averageCostPerCall = summary.totalCost / this.calls.length;
      summary.averageTokensPerCall = summary.totalTokens / this.calls.length;
    }

    return summary;
  }

  clear(): void {
    this.calls = [];
  }

  reset(): void {
    this.clear();
  }
}

const globalTracker = new CostTracker();

export function extractGeminiTokenUsage(responseData: unknown): TokenUsage | null {
  const usage = extractTokenUsageSnapshot(responseData);
  return usage?.source === 'gemini'
    ? { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens, estimatedCost: 0 }
    : null;
}

export function extractOpenAITokenUsage(responseData: unknown): TokenUsage | null {
  const usage = extractTokenUsageSnapshot(responseData);
  return usage?.source === 'openai'
    ? { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens, estimatedCost: 0 }
    : null;
}

export function calculateTokenCost(model: string, tokenUsage: TokenUsage): number {
  const prices = PRICING_TABLE[model] || { prompt: 0.000001, completion: 0.000005 };
  return tokenUsage.promptTokens * prices.prompt + tokenUsage.completionTokens * prices.completion;
}

export function recordAPICall(
  provider: string,
  model: string,
  durationMs: number,
  tokenUsage: TokenUsage | null,
  success = true,
): APICallMetrics {
  const estimatedCost = tokenUsage ? calculateTokenCost(model, tokenUsage) : 0;
  const metrics: APICallMetrics = {
    provider,
    model,
    timestamp: new Date().toISOString(),
    durationMs,
    tokenUsage,
    estimatedCost,
    success,
  };
  globalTracker.recordCall(metrics);
  return metrics;
}

export function getCostSummary(): CostSummary {
  return globalTracker.getSummary();
}

export function getAllAPICallsMetrics(): APICallMetrics[] {
  return globalTracker.getCalls();
}

export function resetCostTracker(): void {
  globalTracker.reset();
}

export function formatCostSummary(summary: CostSummary = getCostSummary()): string {
  const lines = [
    '💰 Cost Summary:',
    `  - Total API Calls: ${summary.callCount}`,
    `  - Total Cost: $${summary.totalCost.toFixed(6)}`,
    `  - Total Tokens: ${summary.totalTokens.toLocaleString()}`,
    `  - Avg Cost/Call: $${summary.averageCostPerCall.toFixed(6)}`,
    `  - Avg Tokens/Call: ${summary.averageTokensPerCall.toFixed(0)}`,
  ];

  if (Object.keys(summary.costByModel).length > 0) {
    lines.push('\n  Cost by Model:');
    for (const [model, cost] of Object.entries(summary.costByModel)) {
      lines.push(`    - ${model}: $${cost.toFixed(6)}`);
    }
  }

  return lines.join('\n');
}
