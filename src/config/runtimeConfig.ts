/**
 * Runtime configuration manager
 * Manages application behavior settings
 */

import { BaseConfigManager } from './baseManager.js';
import { RuntimeConfig, ConfigValidationError } from './types.js';
import { DEFAULT_CODER_MODEL_SELECTION } from './providerSelection.js';
import { getConfiguredCoderModelSelection } from './coderModel.js';
import { getRuntimeSettings } from './runtimeSettings.js';

const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  // Agent settings
  maxSteps: 10,
  defaultModel: DEFAULT_CODER_MODEL_SELECTION,
  budget: Infinity,

  // Timeouts (in milliseconds)
  requestTimeout: 300000, // 5 minutes
  defaultToolTimeout: 30000, // 30 seconds

  // Crew agent settings
  crewAgentCount: 4,
  crewEnableParallel: true,

  // Retry settings
  maxRetries: 3,
  retryBackoffMs: 1000,
  retryMultiplier: 2,

  // Workspace
  workspaceRoot: process.cwd(),
};

export class RuntimeConfigManager extends BaseConfigManager<RuntimeConfig> {
  constructor(overrides?: Partial<RuntimeConfig>) {
    const settings = getRuntimeSettings();
    super({
      ...DEFAULT_RUNTIME_CONFIG,
      maxSteps: settings.maxSteps,
      budget: settings.budget,
      requestTimeout: settings.requestTimeoutMs,
      defaultToolTimeout: settings.toolTimeoutDefault,
      crewAgentCount: settings.crewAgents,
      crewEnableParallel: settings.crewParallel,
      maxRetries: settings.maxRetries,
      retryBackoffMs: settings.retryBackoffMs,
      retryMultiplier: settings.retryMultiplier,
      defaultModel: getConfiguredCoderModelSelection(),
    });
    if (overrides) {
      this.config = this.merge(this.config, overrides);
    }
    this.setSource('default');
  }

  /**
   * Load the active typed runtime settings and apply optional overrides.
   */
  loadFromEnvironment(overrides?: Partial<RuntimeConfig>): void {
    const settings = getRuntimeSettings();
    this.config = {
      maxSteps: settings.maxSteps,
      // Model selection belongs to persisted Settings/API routes. Keep legacy
      // environment loading for numeric/runtime controls only.
      defaultModel: getConfiguredCoderModelSelection(),
      budget: settings.budget,
      requestTimeout: settings.requestTimeoutMs,
      defaultToolTimeout: settings.toolTimeoutDefault,
      crewAgentCount: settings.crewAgents,
      crewEnableParallel: settings.crewParallel,
      maxRetries: settings.maxRetries,
      retryBackoffMs: settings.retryBackoffMs,
      retryMultiplier: settings.retryMultiplier,
      workspaceRoot: process.env.WORKSPACE_ROOT || DEFAULT_RUNTIME_CONFIG.workspaceRoot,
    };

    if (overrides) {
      this.config = this.merge(this.config, overrides);
    }

    this.setSource('env');
  }

  /**
   * Validate runtime configuration
   */
  validate(): ConfigValidationError[] {
    const errors: ConfigValidationError[] = [];

    // Validate maxSteps
    if (this.config.maxSteps < 1 || this.config.maxSteps > 1000) {
      errors.push({
        section: 'runtime',
        field: 'maxSteps',
        value: this.config.maxSteps,
        error: 'maxSteps must be between 1 and 1000',
      });
    }

    // Validate timeouts
    if (this.config.requestTimeout < 1000) {
      errors.push({
        section: 'runtime',
        field: 'requestTimeout',
        value: this.config.requestTimeout,
        error: 'requestTimeout must be at least 1000ms',
      });
    }

    if (this.config.defaultToolTimeout < 100) {
      errors.push({
        section: 'runtime',
        field: 'defaultToolTimeout',
        value: this.config.defaultToolTimeout,
        error: 'defaultToolTimeout must be at least 100ms',
      });
    }

    // Validate crew agent count
    if (this.config.crewAgentCount < 1 || this.config.crewAgentCount > 16) {
      errors.push({
        section: 'runtime',
        field: 'crewAgentCount',
        value: this.config.crewAgentCount,
        error: 'crewAgentCount must be between 1 and 16',
      });
    }

    // Validate retry settings
    if (this.config.maxRetries < 1 || this.config.maxRetries > 10) {
      errors.push({
        section: 'runtime',
        field: 'maxRetries',
        value: this.config.maxRetries,
        error: 'maxRetries must be between 1 and 10',
      });
    }

    if (this.config.retryMultiplier < 1.1 || this.config.retryMultiplier > 5) {
      errors.push({
        section: 'runtime',
        field: 'retryMultiplier',
        value: this.config.retryMultiplier,
        error: 'retryMultiplier must be between 1.1 and 5',
      });
    }

    return errors;
  }

  /**
   * Get model configuration specific to a model name
   */
  getModelSettings(modelName: string): Partial<RuntimeConfig> {
    return {
      defaultModel: modelName,
    };
  }

  /**
   * Update multiple settings at once
   */
  updateSettings(settings: Partial<RuntimeConfig>): void {
    this.config = this.merge(this.config, settings);
    this.source.lastModified = new Date();
  }
}
