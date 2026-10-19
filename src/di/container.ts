/**
 * Dependency Injection Container
 * Central registry for all dependencies
 */

import type {
  DIContainer,
  DIContainerOptions,
  ExecutionLogger,
  LLMProvider,
  StructuredLogger,
  Storage,
  ToolRegistry,
} from './types.js';
import { DefaultToolRegistry } from './providers/toolRegistry.js';
import { SQLiteExecutionLogger, ConsoleStructuredLogger, SQLiteStorage } from './providers/logger.js';
import { PollinationsLLMProvider, GeminiLLMProvider, CompositeLLMProvider, LocalModelLLMProvider, ColabModelLLMProvider, NvidiaLLMProvider, OpenRouterLLMProvider, GroqLLMProvider, CerebrasLLMProvider, SambaNovaLLMProvider, KimiLLMProvider, RequestyLLMProvider } from './providers/llmProvider.js';
import { ProviderFallbackManager } from './providers/fallbackManager.js';
import {
  getRuntimeGeminiApiKey,
  getRuntimeKimiApiKey,
  getRuntimeNvidiaApiKey,
  getRuntimeNvidiaApiKeys,
  getRuntimeCerebrasApiKey,
  getRuntimeSambaNovaApiKey,
  getRuntimeRequestyApiKey,
  getRuntimePollinationsApiKey,
} from '../config/runtimeEnv.js';
import { GeminiProfileRegistry, getGeminiProfileRegistry } from '../config/geminiProfiles.js';
import { loadGroqRuntimeConfigSafe } from '../config/groqConfig.js';
import { getConfiguredOpenRouterApiKey } from '../config/openRouterConfig.js';

/**
 * Default Dependency Container Implementation
 */
export class DefaultDIContainer implements DIContainer {
  private dependencies: Map<string, unknown> = new Map();
  private llmProvider: LLMProvider | null = null;
  private toolRegistry: ToolRegistry | null = null;
  private executionLogger: ExecutionLogger | null = null;
  private structuredLogger: StructuredLogger | null = null;
  private storage: Storage | null = null;
  private fallbackManager: ProviderFallbackManager | null = null;

  constructor(options: DIContainerOptions = {}) {
    // Initialize providers
    const pollinationsApiKey = options.apiKeys?.pollinations || getRuntimePollinationsApiKey() || process.env.POLLINATIONS_API_KEY;
    const geminiApiKey = options.apiKeys?.gemini || getRuntimeGeminiApiKey() || process.env.GEMINI_API_KEY;
    const nvidiaApiKey = options.apiKeys?.nvidia || getRuntimeNvidiaApiKey() || process.env.NVIDIA_API_KEY;
    const nvidiaKeyPool = options.apiKeys?.nvidiaPool || getRuntimeNvidiaApiKeys() || process.env.NVIDIA_API_KEYS;
    const openRouterApiKey = options.apiKeys?.openrouter || getConfiguredOpenRouterApiKey() || process.env.OPENROUTER_API_KEY;
    const groqApiKey = options.apiKeys?.groq;
    const cerebrasApiKey = options.apiKeys?.cerebras || getRuntimeCerebrasApiKey() || process.env.CEREBRAS_API_KEY;
    const sambaNovaApiKey = options.apiKeys?.sambanova || getRuntimeSambaNovaApiKey() || process.env.SAMBANOVA_API_KEY;
    const groqConfig = loadGroqRuntimeConfigSafe();
    const kimiApiKey = getRuntimeKimiApiKey() || process.env.KIMI_API_KEY;
    const requestyApiKey = options.apiKeys?.requesty || getRuntimeRequestyApiKey() || process.env.REQUESTY_API_KEY;

    const providers: LLMProvider[] = [];

    const configuredGeminiProfiles = options.apiKeys?.gemini
      ? new GeminiProfileRegistry([{
        id: 'default', label: 'Gemini Default Account', purpose: 'general',
        apiKey: options.apiKeys.gemini, enabled: true, envVar: 'DI_OPTIONS',
      }])
      : getGeminiProfileRegistry();
    if (configuredGeminiProfiles.list().length > 0) {
      providers.push(new GeminiLLMProvider(undefined, undefined, configuredGeminiProfiles));
    } else if (geminiApiKey) {
      providers.push(new GeminiLLMProvider(geminiApiKey));
    }

    const localProvider = new LocalModelLLMProvider();
    if (localProvider.isAvailable()) {
      providers.push(localProvider);
    }

    const colabProvider = new ColabModelLLMProvider();
    if (colabProvider.isAvailable()) {
      providers.push(colabProvider);
    }

    if (nvidiaApiKey || nvidiaKeyPool) {
      providers.push(new NvidiaLLMProvider(nvidiaApiKey, undefined, nvidiaKeyPool));
    }

    if (openRouterApiKey) {
      providers.push(new OpenRouterLLMProvider(openRouterApiKey));
    }

    if (groqApiKey) {
      providers.push(new GroqLLMProvider(groqApiKey, { enabled: true }));
    } else if (groqConfig.enabled && groqConfig.apiKey && groqConfig.defaultModel) {
      providers.push(new GroqLLMProvider());
    }

    if (cerebrasApiKey) {
      providers.push(new CerebrasLLMProvider(cerebrasApiKey));
    }

    if (sambaNovaApiKey) {
      providers.push(new SambaNovaLLMProvider(sambaNovaApiKey));
    }

    if (kimiApiKey) {
      providers.push(new KimiLLMProvider(kimiApiKey));
    }

    if (requestyApiKey) {
      providers.push(new RequestyLLMProvider(requestyApiKey));
    }

    // Keep Pollinations available as an explicitly selected route even when
    // other providers are configured. Composite routing places a
    // `pollinations:<model>` target first and keeps it out of unrelated
    // native-provider fallback chains, so registering it here does not make
    // Pollinations consume fallback budget for Gemini/NVIDIA runs.
    if (pollinationsApiKey || providers.length === 0) {
      providers.push(new PollinationsLLMProvider(pollinationsApiKey));
    }

    if (providers.length > 1) {
      this.llmProvider = new CompositeLLMProvider(providers);
    } else if (providers.length === 1) {
      this.llmProvider = providers[0];
    }

    if (!this.llmProvider && options.llmProviders && options.llmProviders.length > 0) {
      if (options.llmProviders.length > 1) {
        this.llmProvider = new CompositeLLMProvider(options.llmProviders);
      } else {
        this.llmProvider = options.llmProviders[0];
      }
    }

    if (!this.llmProvider) {
      throw new Error('No LLM providers configured. Set POLLINATIONS_API_KEY, GEMINI_API_KEY, NVIDIA_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, CEREBRAS_API_KEY, SAMBANOVA_API_KEY, KIMI_API_KEY, or REQUESTY_API_KEY.');
    }

    // Initialize other services
    this.toolRegistry = options.toolRegistry || new DefaultToolRegistry();
    this.executionLogger = options.executionLogger || new SQLiteExecutionLogger();
    this.structuredLogger = options.structuredLogger || new ConsoleStructuredLogger(options.debug);
    this.storage = options.storage || new SQLiteStorage();

    // Initialize fallback manager for LLM retry/rotation logic
    this.fallbackManager = new ProviderFallbackManager({
      maxAttempts: 3,
      delayMs: 1000,
      backoffMultiplier: 1.5,
      fallbackProviders: ['gemini', 'pollinations'],
    });
  }

  getLLMProvider(): LLMProvider {
    if (!this.llmProvider) {
      throw new Error('LLM provider not initialized');
    }
    return this.llmProvider;
  }

  getToolRegistry(): ToolRegistry {
    if (!this.toolRegistry) {
      throw new Error('Tool registry not initialized');
    }
    return this.toolRegistry;
  }

  getExecutionLogger(): ExecutionLogger {
    if (!this.executionLogger) {
      throw new Error('Execution logger not initialized');
    }
    return this.executionLogger;
  }

  getStructuredLogger(): StructuredLogger {
    if (!this.structuredLogger) {
      throw new Error('Structured logger not initialized');
    }
    return this.structuredLogger;
  }

  getStorage(): Storage {
    if (!this.storage) {
      throw new Error('Storage not initialized');
    }
    return this.storage;
  }

  getFallbackManager(): ProviderFallbackManager {
    if (!this.fallbackManager) {
      throw new Error('Fallback manager not initialized');
    }
    return this.fallbackManager;
  }

  register<T>(key: string, factory: () => T): void {
    this.dependencies.set(key, factory());
  }

  get<T>(key: string): T | undefined {
    return (this.dependencies.get(key) as T) || undefined;
  }

  has(key: string): boolean {
    return this.dependencies.has(key);
  }

  clear(): void {
    this.dependencies.clear();
  }
}

/**
 * Global DI Container Instance
 */
let globalContainer: DIContainer | null = null;

/**
 * Initialize the global DI container
 */
export function initializeDIContainer(options: DIContainerOptions = {}): DIContainer {
  globalContainer = new DefaultDIContainer(options);
  return globalContainer;
}

/**
 * Get the global DI container
 * Initializes with defaults if not yet initialized
 */
export function getDIContainer(): DIContainer {
  if (!globalContainer) {
    globalContainer = new DefaultDIContainer();
  }
  return globalContainer;
}

/**
 * Reset the global DI container (useful for testing)
 */
export function resetDIContainer(): void {
  globalContainer = null;
}

/**
 * Convenience object for accessing DI services
 */
export const di = {
  /**
   * Get LLM provider
   */
  llm(): LLMProvider {
    return getDIContainer().getLLMProvider();
  },

  /**
   * Get tool registry
   */
  tools(): ToolRegistry {
    return getDIContainer().getToolRegistry();
  },

  /**
   * Get execution logger
   */
  executionLogger(): ExecutionLogger {
    return getDIContainer().getExecutionLogger();
  },

  /**
   * Get structured logger
   */
  logger(): StructuredLogger {
    return getDIContainer().getStructuredLogger();
  },

  /**
   * Get storage
   */
  storage(): Storage {
    return getDIContainer().getStorage();
  },

  /**
   * Get a specific tool by name
   */
  getTool(name: string) {
    return getDIContainer().getToolRegistry().get(name);
  },

  /**
   * Get all available tools
   */
  getTools() {
    return getDIContainer().getToolRegistry().getAll();
  },

  /**
   * Get enabled tools
   */
  getEnabledTools() {
    return getDIContainer().getToolRegistry().getEnabled();
  },

  /**
   * Enable/disable a tool
   */
  setToolEnabled(name: string, enabled: boolean) {
    getDIContainer().getToolRegistry().setEnabled(name, enabled);
  },
};
