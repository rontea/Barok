/**
 * Tool configuration manager
 * Manages tool timeouts, settings, and capabilities
 */

import { BaseConfigManager } from './baseManager.js';
import { ToolConfig, ConfigValidationError } from './types.js';
import { getRuntimeToolTimeouts } from './runtimeSettings.js';

const DEFAULT_TOOL_CONFIG: ToolConfig = {
  // Timeouts by tool type (in milliseconds)
  timeouts: {
    default: 30000, // 30 seconds
    bash: 30000,
    fileOperations: 15000,
    globPatterns: 10000,
    grep: 30000,
    subAgent: 120000,
  },

  // Tool execution settings
  maxBufferSize: 10 * 1024 * 1024, // 10 MB
  maxConcurrentTools: 4,

  // Tool enable/disable flags
  enabledTools: new Set(['bash', 'readFile', 'writeFile', 'editFile', 'glob', 'grep']),

  // Tool-specific settings
  bashMaxLines: 1000,
  fileOpsSizeLimit: 100 * 1024 * 1024, // 100 MB
};

export class ToolConfigManager extends BaseConfigManager<ToolConfig> {
  constructor(overrides?: Partial<ToolConfig>) {
    const runtimeTimeouts = getRuntimeToolTimeouts();
    super({
      ...DEFAULT_TOOL_CONFIG,
      timeouts: {
        default: runtimeTimeouts.default,
        bash: runtimeTimeouts.bash,
        fileOperations: runtimeTimeouts.fileOps,
        globPatterns: runtimeTimeouts.glob,
        grep: runtimeTimeouts.grep,
        subAgent: runtimeTimeouts.subAgent,
      },
    });
    if (overrides) {
      this.config = this.merge(this.config, overrides);
    }
    this.setSource('default');
  }

  /**
   * Get timeout for a specific tool
   */
  getTimeout(toolName: string): number {
    const key = toolName.toLowerCase() as keyof ToolConfig['timeouts'];
    return this.config.timeouts[key] || this.config.timeouts.default;
  }

  /**
   * Set timeout for a specific tool
   */
  setTimeout(toolName: string, timeoutMs: number): void {
    const key = toolName.toLowerCase() as keyof ToolConfig['timeouts'];
    if (key in this.config.timeouts) {
      this.config.timeouts[key] = timeoutMs;
    }
    this.source.lastModified = new Date();
  }

  /**
   * Check if tool is enabled
   */
  isToolEnabled(toolName: string): boolean {
    return this.config.enabledTools.has(toolName);
  }

  /**
   * Enable a tool
   */
  enableTool(toolName: string): void {
    this.config.enabledTools.add(toolName);
    this.source.lastModified = new Date();
  }

  /**
   * Disable a tool
   */
  disableTool(toolName: string): void {
    this.config.enabledTools.delete(toolName);
    this.source.lastModified = new Date();
  }

  /**
   * Get all enabled tools
   */
  getEnabledTools(): string[] {
    return Array.from(this.config.enabledTools);
  }

  /**
   * Update tool settings
   */
  updateToolSettings(toolName: string, settings: Partial<ToolConfig>): void {
    // Update enabled status if specified
    const toolKey = toolName.toLowerCase();
    
    this.config = this.merge(this.config, settings);
    this.source.lastModified = new Date();
  }

  /**
   * Validate tool configuration
   */
  validate(): ConfigValidationError[] {
    const errors: ConfigValidationError[] = [];

    // Validate timeouts are positive
    for (const [toolName, timeout] of Object.entries(this.config.timeouts)) {
      if (timeout < 100) {
        errors.push({
          section: 'tools',
          field: `timeouts.${toolName}`,
          value: timeout,
          error: `Timeout for ${toolName} must be at least 100ms`,
        });
      }

      if (timeout > 3600000) {
        // 1 hour max
        errors.push({
          section: 'tools',
          field: `timeouts.${toolName}`,
          value: timeout,
          error: `Timeout for ${toolName} cannot exceed 1 hour (3600000ms)`,
        });
      }
    }

    // Validate buffer size
    if (this.config.maxBufferSize < 1024) {
      // 1 KB minimum
      errors.push({
        section: 'tools',
        field: 'maxBufferSize',
        value: this.config.maxBufferSize,
        error: 'maxBufferSize must be at least 1024 bytes',
      });
    }

    if (this.config.maxBufferSize > 1024 * 1024 * 1024) {
      // 1 GB maximum
      errors.push({
        section: 'tools',
        field: 'maxBufferSize',
        value: this.config.maxBufferSize,
        error: 'maxBufferSize cannot exceed 1 GB (1073741824 bytes)',
      });
    }

    // Validate concurrent tools
    if (this.config.maxConcurrentTools < 1 || this.config.maxConcurrentTools > 32) {
      errors.push({
        section: 'tools',
        field: 'maxConcurrentTools',
        value: this.config.maxConcurrentTools,
        error: 'maxConcurrentTools must be between 1 and 32',
      });
    }

    // Validate at least one tool is enabled
    if (this.config.enabledTools.size === 0) {
      errors.push({
        section: 'tools',
        field: 'enabledTools',
        value: this.config.enabledTools.size,
        error: 'At least one tool must be enabled',
      });
    }

    return errors;
  }

  /**
   * Get tool configuration summary
   */
  getSummary(): Record<string, unknown> {
    return {
      enabledTools: Array.from(this.config.enabledTools),
      timeouts: this.config.timeouts,
      maxBufferSize: this.config.maxBufferSize,
      maxConcurrentTools: this.config.maxConcurrentTools,
    };
  }
}
