/**
 * Environment configuration manager
 * Loads and manages environment variables
 */

import { BaseConfigManager } from './baseManager.js';
import { EnvConfig, ConfigValidationError } from './types.js';
import { getRuntimeSettings } from './runtimeSettings.js';

const DEFAULT_ENV_CONFIG: EnvConfig = {
  pollinationsApiKey: '',
  geminiApiKey: undefined,
  logLevel: 'info',
  debugMode: false,
  verbose: false,
  mcpServerName: 'raw-react-mcp',
  mcpVersion: '1.0.0',
  mcpPort: undefined,
  enableParallelTasks: true,
  enableLogging: true,
};

export class EnvConfigManager extends BaseConfigManager<EnvConfig> {
  constructor() {
    super(DEFAULT_ENV_CONFIG);
    this.loadFromEnvironment();
  }

  /**
   * Load configuration from environment variables
   */
  private loadFromEnvironment(): void {
    const env = process.env;
    const runtimeSettings = getRuntimeSettings();

    this.config = {
      // API Keys
      pollinationsApiKey: env.POLLINATIONS_API_KEY || '',
      geminiApiKey: env.GEMINI_API_KEY,

      // Logging
      logLevel: runtimeSettings.logLevel,
      debugMode: runtimeSettings.debug,
      verbose: runtimeSettings.reactVerbose,

      // MCP Server
      mcpServerName: env.MCP_SERVER_NAME || 'raw-react-mcp',
      mcpVersion: env.MCP_VERSION || '1.0.0',
      mcpPort: env.MCP_PORT ? parseInt(env.MCP_PORT) : undefined,

      // Feature flags
      enableParallelTasks: runtimeSettings.parallelTasks,
      enableLogging: runtimeSettings.enableLogging,
    };

    this.setSource('env');
  }

  /**
   * Reload environment configuration
   */
  reload(): void {
    this.loadFromEnvironment();
  }

  /**
   * Validate environment configuration
   */
  validate(): ConfigValidationError[] {
    const errors: ConfigValidationError[] = [];

    // Validate API keys
    if (!this.config.pollinationsApiKey) {
      errors.push({
        section: 'env',
        field: 'pollinationsApiKey',
        value: this.config.pollinationsApiKey,
        error: 'POLLINATIONS_API_KEY is required but not set',
      });
    }

    // Validate log level
    const validLogLevels = ['debug', 'info', 'warn', 'error'];
    if (!validLogLevels.includes(this.config.logLevel)) {
      errors.push({
        section: 'env',
        field: 'logLevel',
        value: this.config.logLevel,
        error: `Log level must be one of: ${validLogLevels.join(', ')}`,
      });
    }

    // Validate MCP port if specified
    if (this.config.mcpPort && (this.config.mcpPort < 1024 || this.config.mcpPort > 65535)) {
      errors.push({
        section: 'env',
        field: 'mcpPort',
        value: this.config.mcpPort,
        error: 'MCP port must be between 1024 and 65535',
      });
    }

    return errors;
  }

  /**
   * Get optional API key (returns undefined if not set)
   */
  getApiKey(provider: 'pollinations' | 'gemini'): string | undefined {
    switch (provider) {
      case 'pollinations':
        return this.config.pollinationsApiKey || undefined;
      case 'gemini':
        return this.config.geminiApiKey;
      default:
        return undefined;
    }
  }

  /**
   * Check if API key is configured
   */
  hasApiKey(provider: 'pollinations' | 'gemini'): boolean {
    const key = this.getApiKey(provider);
    return !!key;
  }
}
