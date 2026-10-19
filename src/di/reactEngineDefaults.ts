import {
  getRuntimeGeminiApiKey,
  getRuntimeKimiApiKey,
  getRuntimeRequestyApiKey,
  getRuntimeNvidiaApiKey,
  getRuntimeNvidiaApiKeys,
  getRuntimeOpenRouterApiKey,
  getRuntimeCerebrasApiKey,
  getRuntimeSambaNovaApiKey,
  getRuntimePollinationsApiKey,
  getRuntimeLlmRequestTimeoutMs,
  getRuntimePlannerRequestTimeoutMs,
} from '../config/runtimeEnv.js';
import { getRuntimeSettings } from '../config/runtimeSettings.js';
import { getGeminiProfileRegistry } from '../config/geminiProfiles.js';
import { getExecutionProfilePreset } from '../config/executionProfiles.js';
import { loadGroqRuntimeConfigSafe } from '../config/groqConfig.js';
import { getConfiguredCoderModelSelection } from '../config/coderModel.js';
import { resolveModelContextWindow } from '../config/modelConfig.js';
import { isNvidiaModel } from '../config/nvidiaModels.js';
import { isNvidiaTargetModelValue } from '../config/nvidiaTargets.js';
import { isLocalAITargetValue } from '../config/localAITargets.js';
import { isColabTargetValue } from '../config/colabTargets.js';
import { isOpenRouterFreeModel } from '../config/openRouterTargets.js';
import { isGeminiModel } from '../validation/stringValidators.js';
import {
  CerebrasLLMProvider,
  CompositeLLMProvider,
  GeminiLLMProvider,
  GroqLLMProvider,
  KimiLLMProvider,
  LocalModelLLMProvider,
  NvidiaLLMProvider,
  OpenRouterLLMProvider,
  PollinationsLLMProvider,
  RequestyLLMProvider,
  SambaNovaLLMProvider,
} from './providers/llmProvider.js';
import { getAllToolDefinitions } from '../tools/devTools.js';
import {
  getWorkspaceRelativePath,
  scanDirtyTree,
  disposeRunScopedWorkspace,
  createId,
  getPlatform as getNodePlatform,
  getEnvironmentVariable,
  getWorkingDirectory,
} from '@barok/adapter-node';
import { executeAction } from '../react/executor.js';
import { createCapabilityScope as createNodeCapabilityScope, type CapabilityScopeOptions } from '../react/capability-scope.js';
import { verifyApp, discoverVerificationRepairFiles } from '@barok/adapter-node';
import { extendCoderTaskAnalysisForRepair } from '../coder/taskAnalysis.js';
import { PollinationsClient } from '../pollinations/client.js';
import {
  fingerprintWorkspace,
  hashSerializedRequestValue,
  saveManifest,
  updateManifestWithVerification,
} from '@barok/adapter-node';
import {
  assessModelCapability,
  classifyTaskComplexity,
  estimateTaskCost,
  resolveToolCapableModel,
} from '../react/model-router.js';
import { formatCacheStats, getCacheStats, loadCacheFromDisk, persistCacheToDisk } from '../react/cache-manager.js';
import { getRepositoryCacheStats } from '../repo/repositoryMapCache.js';
import { getProjectFileMapCacheStats } from '../coder/projectFileMap.js';
import { di } from './container.js';
import { logger } from '../logging/structuredLogger.js';
import { recordRunResult as persistRunResult } from '../react/logger.js';
import { getSlowOperations } from '../utils/slowOperations.js';
import {
  resolveGlobalStepLimit,
  resolveMaxRecoveryTransitions,
  resolveRunWallClockBudgetMs,
} from '../react/continuous-run.js';
import type { LLMProvider, ToolRegistry } from './types.js';
import type { ReActEngineRuntime } from '@barok/engine';

export const nodeReActEngineRuntime: ReActEngineRuntime = {
  createId,
  unrefTimer: (timer) => (timer as NodeJS.Timeout).unref?.(),
  createCapabilityScope: (options) => createNodeCapabilityScope(options as CapabilityScopeOptions),
  getRunSafetyDefaults: () => ({
    globalStepLimit: resolveGlobalStepLimit(),
    wallClockBudgetMs: resolveRunWallClockBudgetMs(),
    maxRecoveryTransitions: resolveMaxRecoveryTransitions(),
  }),
  getLlmRequestTimeoutMs: getRuntimeLlmRequestTimeoutMs,
  getPlannerRequestTimeoutMs: getRuntimePlannerRequestTimeoutMs,
  getMaxLlmRequestsPerTask: () => getRuntimeSettings().maxLlmRequestsPerTask,
  getThinkingDepth: () => getEnvironmentVariable('THINKING_DEPTH'),
  getPlatform: getNodePlatform,
  getWorkingDirectory,
  getDefaultModelSelection: getConfiguredCoderModelSelection,
  getModelConfig: (model, options) => {
    const groqModel = options?.includeGroqStreaming && model.startsWith('groq:')
      ? model.slice('groq:'.length)
      : '';
    const groqConfig = groqModel ? loadGroqRuntimeConfigSafe() : undefined;
    const groqCapabilities = groqModel ? groqConfig?.capabilities[groqModel] : undefined;
    return {
      gemini: isGeminiModel(model),
      openRouterFree: isOpenRouterFreeModel(model),
      nvidia: isNvidiaModel(model),
      nvidiaTarget: isNvidiaTargetModelValue(model),
      localTarget: model.startsWith('local:') || isLocalAITargetValue(model),
      colabTarget: model.startsWith('colab:') || isColabTargetValue(model),
      groqStreaming: Boolean(groqModel && groqConfig?.streamingEnabled && groqCapabilities?.streaming),
      ...(options?.includeContextWindow ? { contextWindow: resolveModelContextWindow(model) } : {}),
    };
  },
  classifyTaskComplexity,
  estimateTaskCost,
  assessModelCapability,
  resolveToolCapableModel,
  hashRequestPayload: hashSerializedRequestValue,
  getExecutionProfilePreset,
  hasGeminiApiKey: () => Boolean(getRuntimeGeminiApiKey()),
  getWorkspaceRelativePath,
  scanDirtyTree,
  fingerprintWorkspace,
  disposeRunScopedWorkspace,
  isCordisRuntimeEnabled: () => getEnvironmentVariable('REACT_ENGINE_CORDIS_ENABLED') !== 'false',
  getLLMProvider: () => {
    try {
      return di.llm();
    } catch {
      return createFallbackEngineLLMProvider();
    }
  },
  getToolRegistry: () => {
    try {
      return di.tools();
    } catch {
      return createFallbackEngineToolRegistry();
    }
  },
  createUnauthenticatedPollinationsClient: () => new PollinationsClient(null),
  executeToolAction: executeAction,
  verifyGeneratedApp: verifyApp,
  discoverVerificationRepairFiles,
  extendTaskAnalysisForRepair: extendCoderTaskAnalysisForRepair,
  getLogger: () => logger,
  cache: {
    load: loadCacheFromDisk,
    persist: persistCacheToDisk,
    formatStats: formatCacheStats,
    getMetrics: () => {
      const runtime = getCacheStats();
      const repository = getRepositoryCacheStats();
      const projectFileMap = getProjectFileMapCacheStats();
      return {
        hits: runtime.totalHits + repository.hits + projectFileMap.hits,
        misses: runtime.totalMisses + repository.misses + projectFileMap.misses,
        staleHits: runtime.totalStaleHits + repository.staleHits + projectFileMap.staleHits,
        staleRefreshes: runtime.totalStaleRefreshes + repository.staleRefreshes + projectFileMap.staleRefreshes,
        sets: runtime.totalSets + repository.sets + projectFileMap.sets,
        evictions: runtime.totalEvictions + repository.evictions + projectFileMap.evictions,
        deletes: runtime.totalDeletes + repository.deletes + projectFileMap.deletes,
        runtimeEntries: runtime.totalCacheSize,
        repositoryEntries: repository.size,
        projectFileMapEntries: projectFileMap.size,
      };
    },
  },
  recordRunResult: (...args) => persistRunResult(...args),
  getSlowOperationMetrics: (startedAt) => {
    const operations = getSlowOperations().filter((operation) => operation.timestamp >= startedAt);
    return {
      count: operations.length,
      totalMs: operations.reduce((sum, operation) => sum + operation.durationMs, 0),
      maxMs: operations.reduce((max, operation) => Math.max(max, operation.durationMs), 0),
    };
  },
  saveAppManifest: saveManifest,
  updateAppManifestWithVerification: async (manifest, result, workspace) => {
    await updateManifestWithVerification(manifest, result, workspace);
  },
  writeHostLog: (level, ...values) => {
    if (level === 'warn') console.warn(...values);
    else console.log(...values);
  },
  recordProtocolAudit: async (audit, runId) => {
    await di.executionLogger().recordProtocolAudit?.(audit, runId);
  },
};

/** Node adapter fallback used when the app's DI container cannot initialize. */
export function createFallbackEngineLLMProvider(): LLMProvider {
  const fallbackProviders: LLMProvider[] = [];
  const pollinationsProvider = new PollinationsLLMProvider(getRuntimePollinationsApiKey());

  const geminiProfiles = getGeminiProfileRegistry();
  const geminiApiKey = getRuntimeGeminiApiKey() || getEnvironmentVariable('GEMINI_API_KEY');
  if (geminiProfiles.list().length > 0) {
    fallbackProviders.push(new GeminiLLMProvider(undefined, undefined, geminiProfiles));
  } else if (geminiApiKey) {
    fallbackProviders.push(new GeminiLLMProvider(geminiApiKey));
  }

  const localProvider = new LocalModelLLMProvider();
  if (localProvider.isAvailable()) {
    fallbackProviders.push(localProvider);
  }

  const nvidiaApiKey = getRuntimeNvidiaApiKey() || getEnvironmentVariable('NVIDIA_API_KEY');
  const nvidiaKeyPool = getRuntimeNvidiaApiKeys() || getEnvironmentVariable('NVIDIA_API_KEYS');
  if (nvidiaApiKey || nvidiaKeyPool) {
    fallbackProviders.push(new NvidiaLLMProvider(nvidiaApiKey, undefined, nvidiaKeyPool));
  }

  const openRouterApiKey = getRuntimeOpenRouterApiKey() || getEnvironmentVariable('OPENROUTER_API_KEY');
  if (openRouterApiKey) {
    fallbackProviders.push(new OpenRouterLLMProvider(openRouterApiKey));
  }

  const cerebrasApiKey = getRuntimeCerebrasApiKey() || getEnvironmentVariable('CEREBRAS_API_KEY');
  if (cerebrasApiKey) {
    fallbackProviders.push(new CerebrasLLMProvider(cerebrasApiKey));
  }

  const sambaNovaApiKey = getRuntimeSambaNovaApiKey() || getEnvironmentVariable('SAMBANOVA_API_KEY');
  if (sambaNovaApiKey) {
    fallbackProviders.push(new SambaNovaLLMProvider(sambaNovaApiKey));
  }

  const groqConfig = loadGroqRuntimeConfigSafe();
  if (groqConfig.enabled && groqConfig.apiKey && groqConfig.defaultModel) {
    fallbackProviders.push(new GroqLLMProvider());
  }

  const kimiApiKey = getRuntimeKimiApiKey() || getEnvironmentVariable('KIMI_API_KEY');
  if (kimiApiKey) {
    fallbackProviders.push(new KimiLLMProvider(kimiApiKey));
  }

  const requestyApiKey = getRuntimeRequestyApiKey() || getEnvironmentVariable('REQUESTY_API_KEY');
  if (requestyApiKey) {
    fallbackProviders.push(new RequestyLLMProvider(requestyApiKey));
  }

  // Pollinations remains available for Pollinations-only deployments, but is
  // intentionally excluded from native-provider fallback chains.
  const fallbackProvider = fallbackProviders.length > 1
    ? new CompositeLLMProvider(fallbackProviders)
    : fallbackProviders[0] || pollinationsProvider;

  return {
    createChatCompletion: (messages, model, options) =>
      fallbackProvider.createChatCompletion(messages, model, options),
    estimateStepCost: (model) => fallbackProvider.estimateStepCost(model),
    getProviderName: () => fallbackProvider.getProviderName(),
    isAvailable: () => fallbackProvider.isAvailable(),
  };
}

/** Node adapter fallback used when the app's DI container cannot initialize. */
export function createFallbackEngineToolRegistry(): ToolRegistry {
  const defaultTools = getAllToolDefinitions();
  return {
    getAll: () => defaultTools as any,
    get: (name) => defaultTools.find((tool: any) => tool.name === name) as any,
    getEnabled: () => defaultTools as any,
    has: (name) => defaultTools.some((tool: any) => tool.name === name),
    register: () => {},
    setEnabled: () => {},
    getNames: () => defaultTools.map((tool: any) => tool.name),
    size: () => defaultTools.length,
  };
}
