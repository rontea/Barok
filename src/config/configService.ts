/**
 * Central configuration service
 * Coordinates all configuration managers and provides a unified interface
 */

import { AppConfig, ConfigValidationError } from './types.js';
import { EnvConfigManager } from './envConfig.js';
import { RuntimeConfigManager } from './runtimeConfig.js';
import { ModelConfigManager } from './modelConfig.js';
import { ToolConfigManager } from './toolConfig.js';
import { WorkspaceConfigManager } from './workspaceConfig.js';

/**
 * Global configuration service instance
 */
let globalConfigService: ConfigService | null = null;

/**
 * Configuration service that manages all configuration aspects
 */
export class ConfigService {
  private envConfig: EnvConfigManager;
  private runtimeConfig: RuntimeConfigManager;
  private modelConfig: ModelConfigManager;
  private toolConfig: ToolConfigManager;
  private workspaceConfig: WorkspaceConfigManager;

  constructor(
    runtimeOverrides?: Partial<any>,
    workspacePath?: string,
    workspaceOverrides?: Partial<any>
  ) {
    this.envConfig = new EnvConfigManager();
    this.runtimeConfig = new RuntimeConfigManager(runtimeOverrides);
    this.modelConfig = new ModelConfigManager();
    this.toolConfig = new ToolConfigManager();
    this.workspaceConfig = new WorkspaceConfigManager(workspacePath, workspaceOverrides);

    // Set workspace root from runtime config
    if (this.runtimeConfig.getConfig().workspaceRoot) {
      this.workspaceConfig.setRootPath(this.runtimeConfig.getConfig().workspaceRoot);
    }
  }

  /**
   * Get environment config manager
   */
  getEnvConfig(): EnvConfigManager {
    return this.envConfig;
  }

  /**
   * Get runtime config manager
   */
  getRuntimeConfig(): RuntimeConfigManager {
    return this.runtimeConfig;
  }

  /**
   * Get model config manager
   */
  getModelConfig(): ModelConfigManager {
    return this.modelConfig;
  }

  /**
   * Get tool config manager
   */
  getToolConfig(): ToolConfigManager {
    return this.toolConfig;
  }

  /**
   * Get workspace config manager
   */
  getWorkspaceConfig(): WorkspaceConfigManager {
    return this.workspaceConfig;
  }

  /**
   * Get complete configuration object
   */
  getConfig(): AppConfig {
    return {
      env: this.envConfig.getConfig(),
      runtime: this.runtimeConfig.getConfig(),
      models: this.modelConfig.getConfig(),
      tools: this.toolConfig.getConfig(),
      workspace: this.workspaceConfig.getConfig(),
    };
  }

  /**
   * Validate all configurations
   */
  validateAll(): ConfigValidationError[] {
    const allErrors: ConfigValidationError[] = [];

    allErrors.push(...this.envConfig.validate());
    allErrors.push(...this.runtimeConfig.validate());
    allErrors.push(...this.modelConfig.validate());
    allErrors.push(...this.toolConfig.validate());
    allErrors.push(...this.workspaceConfig.validate());

    return allErrors;
  }

  /**
   * Get validation errors for a specific section
   */
  validateSection(
    section: 'env' | 'runtime' | 'models' | 'tools' | 'workspace'
  ): ConfigValidationError[] {
    switch (section) {
      case 'env':
        return this.envConfig.validate();
      case 'runtime':
        return this.runtimeConfig.validate();
      case 'models':
        return this.modelConfig.validate();
      case 'tools':
        return this.toolConfig.validate();
      case 'workspace':
        return this.workspaceConfig.validate();
    }
  }

  /**
   * Check if configuration is valid
   */
  isValid(): boolean {
    return this.validateAll().length === 0;
  }

  /**
   * Get configuration as formatted string
   */
  toString(): string {
    const config = this.getConfig();
    return JSON.stringify(config, null, 2);
  }

  /**
   * Export configuration for debugging
   */
  export(includeSensitive = false): Record<string, unknown> {
    return {
      env: includeSensitive ? this.envConfig.export(true) : { logLevel: this.envConfig.getConfig().logLevel },
      runtime: this.runtimeConfig.export(includeSensitive),
      models: this.modelConfig.export(includeSensitive),
      tools: this.toolConfig.getSummary(),
      workspace: this.workspaceConfig.getSummary(),
    };
  }

  /**
   * Reset to defaults
   */
  resetToDefaults(): void {
    this.envConfig.reset();
    this.runtimeConfig.reset();
    this.modelConfig.reset();
    this.toolConfig.reset();
    this.workspaceConfig.reset();
  }
}

/**
 * Initialize global configuration service
 */
export function initializeConfigService(
  runtimeOverrides?: Partial<any>,
  workspacePath?: string,
  workspaceOverrides?: Partial<any>
): ConfigService {
  globalConfigService = new ConfigService(runtimeOverrides, workspacePath, workspaceOverrides);
  return globalConfigService;
}

/**
 * Get global configuration service instance
 */
export function getConfigService(): ConfigService {
  if (!globalConfigService) {
    globalConfigService = new ConfigService();
  }
  return globalConfigService;
}

/**
 * Convenience getters for common configuration values
 */
export const config = {
  env: () => getConfigService().getEnvConfig().getConfig(),
  runtime: () => getConfigService().getRuntimeConfig().getConfig(),
  models: () => getConfigService().getModelConfig().getConfig(),
  tools: () => getConfigService().getToolConfig().getConfig(),
  workspace: () => getConfigService().getWorkspaceConfig().getConfig(),

  // Common shortcuts
  getApiKey: (provider: 'pollinations' | 'gemini') =>
    getConfigService().getEnvConfig().getApiKey(provider),

  getModel: (name: string) =>
    getConfigService().getModelConfig().getModel(name),

  getTimeout: (toolName: string) =>
    getConfigService().getToolConfig().getTimeout(toolName),

  getFullPath: (relativePath: string) =>
    getConfigService().getWorkspaceConfig().getFullPath(relativePath),

  isPathAllowed: (filePath: string) =>
    getConfigService().getWorkspaceConfig().isPathAllowed(filePath),

  validate: () => getConfigService().validateAll(),

  export: (includeSensitive = false) =>
    getConfigService().export(includeSensitive),
};
