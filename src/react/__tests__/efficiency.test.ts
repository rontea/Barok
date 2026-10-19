import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assessModelCapability,
  resolveToolCapableModel,
  classifyTaskComplexity,
  selectModelForTask,
  estimateTaskCost,
  getFallbackModels,
  type TaskComplexity,
} from '../model-router';
import {
  cacheToolDescriptions,
  getCachedToolDescriptions,
  cacheWorkspaceSummary,
  getCachedWorkspaceSummary,
  clearAllCaches,
  getCacheStats,
  persistCacheToDisk,
  type WorkspaceSummary,
} from '../cache-manager';
import {
  recordAPICall,
  getCostSummary,
  calculateTokenCost,
  formatCostSummary,
  type TokenUsage,
} from '../cost-tracker';

describe('Phase 4 - Model Routing', () => {
  it('classifies simple classification tasks', () => {
    expect(classifyTaskComplexity('Classify this app as a game or tool')).toBe('classification');
    expect(classifyTaskComplexity('What type of app is this request')).toBe('classification');
    expect(classifyTaskComplexity('Identify the app category')).toBe('classification');
  });

  it('classifies simple planning tasks', () => {
    expect(classifyTaskComplexity('Plan out the basic steps')).toBe('simple-planning');
    expect(classifyTaskComplexity('Break down this task into smaller parts')).toBe('simple-planning');
  });

  it('classifies complex architecture tasks by default', () => {
    expect(classifyTaskComplexity('Build a todo app')).toBe('complex-architecture');
    expect(classifyTaskComplexity('Create a game')).toBe('complex-architecture');
  });

  it('classifies repair tasks', () => {
    expect(classifyTaskComplexity('Fix the broken layout')).toBe('repair');
    expect(classifyTaskComplexity('Repair the app verification errors')).toBe('repair');
    expect(classifyTaskComplexity('Debug the console errors')).toBe('repair');
  });

  it('classifies review tasks', () => {
    expect(classifyTaskComplexity('Review the final output')).toBe('review');
    expect(classifyTaskComplexity('Summarize what was done')).toBe('review');
    expect(classifyTaskComplexity('Analyze the results')).toBe('review');
  });

  it('selects appropriate models for tasks', () => {
    const classificationModel = selectModelForTask('Classify this as a game');
    expect(classificationModel.model).toBeDefined();
    expect(classificationModel.maxTokens).toBeLessThan(500);

    const complexModel = selectModelForTask('Build a todo app');
    expect(complexModel.maxTokens).toBeGreaterThan(1000);
  });

  it('respects user-preferred model', () => {
    const result = selectModelForTask('Build an app', 'claude');
    expect(result.model).toBe('claude');
  });

  it('flags tool-limited models for implementation and verification work', () => {
    const result = assessModelCapability(
      'Fix the browser verification flow across the app',
      'nvidia-target:key-1-nvidia-nemotron-3-super-120b-a12b',
      ['src/App.tsx', 'src/styles/index.css', 'src/tools/verify.ts'],
    );

    expect(result).toMatchObject({
      knownModel: true,
      supportsTools: false,
      verificationSensitive: true,
      suitable: false,
      escalationRecommended: true,
      recommendedModel: 'openrouter:dots-studio/dots-3-note-preview:free',
    });
    expect(result.reasons.join(' ')).toContain('does not advertise tool support');
  });

  it('keeps read-only work on a user-selected tool-limited model', () => {
    const result = assessModelCapability(
      'Explain how the browser verification flow works',
      'google/gemma-4-31b-it',
    );

    expect(result).toMatchObject({
      complexity: 'informational',
      suitable: true,
      escalationRecommended: false,
    });
  });

  it('switches implementation work away from a model that cannot issue tools', () => {
    const result = resolveToolCapableModel(
      'Make the player move faster and verify the game still works',
      'nvidia-target:key-2-nvidia-nemotron-3-super-120b-a12b',
      ['src/game/core/MovementSystem.ts'],
    );

    expect(result).toMatchObject({
      requestedModel: 'nvidia-target:key-2-nvidia-nemotron-3-super-120b-a12b',
      model: 'openrouter:dots-studio/dots-3-note-preview:free',
      changed: true,
    });
    expect(result.reason).toContain('cannot issue tool calls');
    expect(result.capability.supportsTools).toBe(true);
  });

  it('estimates task costs', () => {
    const classificationModel = classifyTaskComplexity('Classify this app as a game');
    expect(classificationModel).toBe('classification'); // Verify classification works
    
    const classificationCost = estimateTaskCost('Classify this app as a game');
    const complexCost = estimateTaskCost('Build a very complex architecture for an app');

    expect(classificationCost).toBeLessThan(complexCost);
    expect(classificationCost).toBeGreaterThan(0);
    expect(complexCost).toBeGreaterThan(0);
  });

  it('provides fallback models for tasks', () => {
    const fallbacks = getFallbackModels('Build an app');
    expect(fallbacks.length).toBeGreaterThanOrEqual(2);
    expect(fallbacks.every((m) => typeof m === 'string')).toBe(true);
  });
});

describe('Phase 4 - Caching', () => {
  beforeEach(() => {
    clearAllCaches();
  });

  afterEach(() => {
    clearAllCaches();
  });

  it('caches and retrieves tool descriptions', () => {
    const tools = [
      { name: 'Write', description: 'Write a file' },
      { name: 'Read', description: 'Read a file' },
    ];

    cacheToolDescriptions(tools);

    const cached = getCachedToolDescriptions();
    expect(cached).not.toBeNull();
    expect(cached!.tools).toEqual(tools);
    expect(cached!.count).toBe(2);
  });

  it('caches and retrieves workspace summaries', () => {
    const summary: WorkspaceSummary = {
      workspace: '/test',
      timestamp: new Date().toISOString(),
      fileCount: 42,
      directories: ['/src', '/tests'],
      summary: 'Test workspace with 42 files',
    };

    cacheWorkspaceSummary(summary);

    const cached = getCachedWorkspaceSummary('/test');
    expect(cached).not.toBeNull();
    expect(cached!.fileCount).toBe(42);
    expect(cached!.directories).toHaveLength(2);
  });

  it('provides cache statistics', () => {
    const tools = [{ name: 'Test', description: 'Test tool' }];
    cacheToolDescriptions(tools);

    const stats = getCacheStats();
    expect(stats.toolDescriptionsSize).toBe(1);
    expect(stats.totalCacheSize).toBeGreaterThan(0);
  });

  it('clears all caches', () => {
    cacheToolDescriptions([{ name: 'Test', description: 'Test' }]);
    expect(getCacheStats().totalCacheSize).toBeGreaterThan(0);

    clearAllCaches();
    expect(getCacheStats().totalCacheSize).toBe(0);
    expect(getCachedToolDescriptions()).toBeNull();
  });

  it('does not create workspace artifacts when there is no cache to persist', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'react-engine-empty-cache-'));
    try {
      await persistCacheToDisk(workspace);
      await expect(readdir(workspace)).resolves.toEqual([]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe('Phase 4 - Cost Tracking', () => {
  beforeEach(() => {
    // Reset tracker before each test
    const summary = getCostSummary();
    if (summary.callCount > 0) {
      // Can't directly reset, but tests should work with accumulated data
    }
  });

  it('calculates token cost correctly', () => {
    const usage: TokenUsage = {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      estimatedCost: 0,
    };

    const cost = calculateTokenCost('qwen-large', usage);
    expect(cost).toBeGreaterThan(0);
    // qwen-large: prompt: 0.0000005, completion: 0.000003
    // 1000 * 0.0000005 + 500 * 0.000003 = 0.0005 + 0.0015 = 0.002
    expect(cost).toBeCloseTo(0.002, 5);
  });

  it('records API calls with metrics', () => {
    const usage: TokenUsage = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      estimatedCost: 0,
    };

    const metrics = recordAPICall('pollinations', 'qwen-large', 1000, usage, true);

    expect(metrics.provider).toBe('pollinations');
    expect(metrics.model).toBe('qwen-large');
    expect(metrics.durationMs).toBe(1000);
    expect(metrics.success).toBe(true);
    expect(metrics.estimatedCost).toBeGreaterThan(0);
  });

  it('provides cost summary', () => {
    const usage: TokenUsage = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      estimatedCost: 0,
    };

    recordAPICall('test-provider', 'test-model', 500, usage, true);

    const summary = getCostSummary();
    expect(summary.totalTokens).toBeGreaterThan(0);
    expect(summary.totalCost).toBeGreaterThan(0);
  });

  it('formats cost summary as readable string', () => {
    const usage: TokenUsage = {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      estimatedCost: 0,
    };

    recordAPICall('test', 'qwen-large', 1000, usage, true);

    const formatted = formatCostSummary();
    expect(formatted).toContain('Cost Summary');
    expect(formatted).toContain('Total Cost');
    expect(formatted).toContain('qwen-large');
  });
});
