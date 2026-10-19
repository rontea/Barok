/**
 * Model Routing Module
 * Routes different task types to optimal models based on complexity and cost
 */

import {
  getNvidiaModelMetadata,
  NVIDIA_MODEL_REGISTRY,
  type NvidiaModelMetadata,
} from '../config/nvidiaModels.js';
import { getConfiguredCoderModelSelection } from '../config/coderModel.js';
import { getOpenRouterKnownModelMetadata, type OpenRouterModelCatalogMetadata } from '../config/openRouterTargets.js';
import type {
  ReActEngineCodingTaskComplexity,
  ReActEngineModelCapabilityAdvisory,
  ReActEngineTaskComplexity,
  ReActEngineToolCapableModelResolution,
} from '@barok/engine';

export type TaskComplexity = ReActEngineTaskComplexity;
export type CodingTaskComplexity = ReActEngineCodingTaskComplexity;
export type ModelCapabilityAdvisory = ReActEngineModelCapabilityAdvisory;
export type ToolCapableModelResolution = ReActEngineToolCapableModelResolution;

export interface CodingTaskRoute {
  complexity: CodingTaskComplexity;
  calls: Array<'informational' | 'plan_code' | 'plan' | 'code' | 'review'>;
  requiresApproval: boolean;
  reasons: string[];
}

export interface ModelRoute {
  taskType: TaskComplexity;
  primaryModel: string;
  fallbackModels: string[];
  maxTokens: number;
  temperature: number;
  estimatedCost: number;
}

export interface ModelSelection {
  model: string;
  maxTokens: number;
  temperature: number;
  capability: ReActEngineModelCapabilityAdvisory;
}

function compactModelId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function resolveModelMetadata(model: string): NvidiaModelMetadata | OpenRouterModelCatalogMetadata | undefined {
  const openRouter = getOpenRouterKnownModelMetadata(model);
  if (openRouter) return openRouter;

  const direct = getNvidiaModelMetadata(model);
  if (direct) return direct;

  // UI selections can be persisted as opaque NVIDIA target IDs, for example
  // `nvidia-target:key-1-google-gemma-4-31b-it`. Match the stable model ID
  // embedded in that target without importing the target database here.
  const compactSelection = compactModelId(model);
  return Object.values(NVIDIA_MODEL_REGISTRY).find((candidate) =>
    compactSelection.includes(compactModelId(candidate.modelId))
  );
}

/**
 * Model routing configuration
 * Optimizes cost vs. quality for different task types
 */
const ROUTING_CONFIG: Record<TaskComplexity, ModelRoute> = {
  // Fast, cheap classification tasks (app type, output mode detection)
  classification: {
    taskType: 'classification',
    primaryModel: 'openrouter:dots-studio/dots-3-note-preview:free',
    fallbackModels: ['openai', 'gpt-oss-20b', 'gemini-3.6-flash'],
    maxTokens: 200,
    temperature: 0.1,
    estimatedCost: 0.00001,
  },

  // Simple planning and decomposition
  'simple-planning': {
    taskType: 'simple-planning',
    primaryModel: 'openrouter:dots-studio/dots-3-note-preview:free',
    fallbackModels: ['openai', 'gpt-oss-20b', 'gemini-3.6-flash'],
    maxTokens: 800,
    temperature: 0.3,
    estimatedCost: 0.0001,
  },

  // Complex architecture and reasoning tasks
  'complex-architecture': {
    taskType: 'complex-architecture',
    primaryModel: 'openrouter:dots-studio/dots-3-note-preview:free',
    fallbackModels: ['openai', 'gpt-oss-20b', 'gemini-3.6-flash'],
    maxTokens: 2000,
    temperature: 0.5,
    estimatedCost: 0.0008,
  },

  // App repair and fix tasks
  repair: {
    taskType: 'repair',
    primaryModel: 'openrouter:dots-studio/dots-3-note-preview:free',
    fallbackModels: ['openai', 'gpt-oss-20b', 'gemini-3.6-flash'],
    maxTokens: 1500,
    temperature: 0.3,
    estimatedCost: 0.0006,
  },

  // Final review and summarization
  review: {
    taskType: 'review',
    primaryModel: 'openrouter:dots-studio/dots-3-note-preview:free',
    fallbackModels: ['openai', 'gpt-oss-20b', 'gemini-3.6-flash'],
    maxTokens: 800,
    temperature: 0.4,
    estimatedCost: 0.0003,
  },
};

/**
 * Classify task by its description
 */
export function classifyTaskComplexity(task: string): TaskComplexity {
  const lower = task.toLowerCase();

  // Classification tasks: app type detection, output mode selection
  if (
    (/\b(classify|detect|identify|determine|recognise|recognize|what|which)\b/.test(lower) &&
      /\b(app|game|tool|dashboard|type|mode|category|kind)\b/.test(lower)) ||
    /\b(type|kind)\b[\s\S]{0,50}\b(app|game|tool)\b/.test(lower)
  ) {
    return 'classification';
  }

  // Simple planning: task breakdown, basic decomposition
  if (
    /\b(plan|break down|decompose|outline)\b[\s\S]{0,50}\b(task|work|steps|approach)\b/.test(lower) ||
    /\b(simple|basic|straightforward)\b/.test(lower)
  ) {
    return 'simple-planning';
  }

  // Complex architecture: design, refactoring, complex structures
  if (
    /\b(architecture|design|refactor|restructure|optimize|improve)\b/.test(lower) ||
    /\b(repair|fix|debug|error|issue)\b/.test(lower)
  ) {
    return 'repair';
  }

  // Review and summary tasks
  if (
    /\b(review|summarize|summarise|analyze|analyse|evaluate|assess)\b/.test(lower)
  ) {
    return 'review';
  }

  // Default: complex architecture for app generation
  return 'complex-architecture';
}

/**
 * Get routing configuration for a task
 */
export function getModelRoute(taskComplexity: TaskComplexity): ModelRoute {
  return {
    ...ROUTING_CONFIG[taskComplexity],
    primaryModel: getConfiguredCoderModelSelection(),
  };
}

/**
 * Select the best model for a task
 */
export function selectModelForTask(task: string, userPreferredModel?: string): ModelSelection {
  // If user specified a model, respect it
  if (userPreferredModel) {
    const capability = assessModelCapability(task, userPreferredModel);
    return {
      model: userPreferredModel,
      maxTokens: 2000,
      temperature: 0.5,
      capability,
    };
  }

  const complexity = classifyTaskComplexity(task);
  const route = getModelRoute(complexity);
  const capability = assessModelCapability(task, route.primaryModel);

  return {
    model: route.primaryModel,
    maxTokens: route.maxTokens,
    temperature: route.temperature,
    capability,
  };
}

/**
 * Estimate cost for a task based on complexity
 */
export function estimateTaskCost(task: string): number {
  const complexity = classifyTaskComplexity(task);
  return ROUTING_CONFIG[complexity].estimatedCost;
}

/**
 * Get fallback models for a task
 */
export function getFallbackModels(task: string): string[] {
  const complexity = classifyTaskComplexity(task);
  return ROUTING_CONFIG[complexity].fallbackModels;
}

/**
 * Check whether the selected model can carry out the kind of work the coder
 * route requires.
 */
export function assessModelCapability(
  task: string,
  selectedModel: string,
  likelyFiles: string[] = [],
): ModelCapabilityAdvisory {
  const route = classifyCodingTask(task, likelyFiles);
  const metadata = resolveModelMetadata(selectedModel);
  const verificationSensitive =
    /\b(browser|playwright|e2e|end[- ]to[- ]end|verification|verify|validation|acceptance|test(?:s|ing)?)\b/.test(task.toLowerCase()) ||
    likelyFiles.length > 2;
  const requiresTools = route.calls.some((call) => call === 'plan_code' || call === 'plan' || call === 'code');
  const reasons: string[] = [];
  let escalationRecommended = false;

  if (requiresTools && metadata && !metadata.supportsTools) {
    escalationRecommended = true;
    reasons.push(`${metadata.modelId} does not advertise tool support for an implementation route.`);
  }
  if (verificationSensitive) {
    reasons.push('The task is verification-sensitive or spans multiple files; retain structured planning and validation evidence.');
  }
  if (escalationRecommended) {
    reasons.push(`Prefer ${getConfiguredCoderModelSelection()} for tool-driven implementation and verification.`);
  }

  return {
    complexity: route.complexity,
    selectedModel,
    knownModel: Boolean(metadata),
    supportsTools: metadata?.supportsTools,
    verificationSensitive,
    suitable: !escalationRecommended,
    escalationRecommended,
    recommendedModel: escalationRecommended ? getConfiguredCoderModelSelection() : undefined,
    reasons,
  };
}

/**
 * Resolve a model that can actually execute a tool-driven coding task. A
 * model without tool support may still be a good choice for read-only chat,
 * but it cannot safely remain pinned for an implementation run: it can only
 * describe the requested change and then falsely report completion.
 */
export function resolveToolCapableModel(
  task: string,
  selectedModel: string,
  likelyFiles: string[] = [],
): ToolCapableModelResolution {
  const capability = assessModelCapability(task, selectedModel, likelyFiles);
  if (!capability.escalationRecommended || !capability.recommendedModel) {
    return {
      requestedModel: selectedModel,
      model: selectedModel,
      changed: false,
      capability,
    };
  }

  const replacementCapability = assessModelCapability(task, capability.recommendedModel, likelyFiles);
  return {
    requestedModel: selectedModel,
    model: capability.recommendedModel,
    changed: true,
    capability: replacementCapability,
    reason: `Selected model ${selectedModel} cannot issue tool calls for this implementation route; switched to ${capability.recommendedModel}.`,
  };
}

/**
 * Deterministic coding-task routing keeps model calls proportional to risk.
 * The harness remains responsible for inspecting files and running validation.
 */
export function classifyCodingTask(task: string, likelyFiles: string[] = []): CodingTaskRoute {
  const text = task.toLowerCase();
  const reasons: string[] = [];
  const highRisk = /\b(authentication|authorization|security|secret|credential|payment|billing|migration|schema|production|deploy|delete|destructive)\b/.test(text);
  const complex = /\b(architecture|cross[- ]layer|multi[- ]service|distributed|major refactor|breaking change|dependency upgrade)\b/.test(text)
    || likelyFiles.length > 8;
  const medium = /\b(feature|refactor|api|database|frontend|backend|multiple files|integration)\b/.test(text)
    || likelyFiles.length > 2;
  const informational = /^(?:explain|describe|what|why|how|review|summari[sz]e|inspect)\b/.test(text)
    && !/\b(change|fix|implement|create|add|remove|update)\b/.test(text);
  const simple = /\b(typo|copy|rename|small|single file|documentation)\b/.test(text) || likelyFiles.length === 1;

  if (highRisk) {
    reasons.push('Security, data, deployment, or destructive-change signal');
    return { complexity: 'high-risk', calls: ['plan', 'code', 'review'], requiresApproval: true, reasons };
  }
  if (complex) {
    reasons.push('Architecture, dependency, breaking-change, or broad file scope');
    return { complexity: 'complex', calls: ['plan', 'code', 'review'], requiresApproval: false, reasons };
  }
  if (informational) {
    reasons.push('Read-only informational request');
    return { complexity: 'informational', calls: ['informational'], requiresApproval: false, reasons };
  }
  if (medium) {
    reasons.push('Multi-file or cross-layer implementation');
    return { complexity: 'medium', calls: ['plan', 'code'], requiresApproval: false, reasons };
  }
  if (simple) {
    reasons.push('Small, bounded change');
    return { complexity: 'simple', calls: ['plan_code'], requiresApproval: false, reasons };
  }
  return { complexity: 'medium', calls: ['plan', 'code'], requiresApproval: false, reasons: ['Default bounded implementation route'] };
}
