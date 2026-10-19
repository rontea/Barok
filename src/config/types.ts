/**
 * Configuration type definitions for the entire system
 */

/**
 * Environment configuration from .env and environment variables
 */
export interface EnvConfig {
  // API Keys
  pollinationsApiKey: string;
  geminiApiKey?: string;

  // Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  debugMode: boolean;
  verbose: boolean;

  // MCP Server
  mcpServerName: string;
  mcpVersion: string;
  mcpPort?: number;

  // Feature flags
  enableParallelTasks: boolean;
  enableLogging: boolean;
}

/**
 * Runtime configuration for application behavior
 */
export interface RuntimeConfig {
  // Agent settings
  maxSteps: number;
  defaultModel: string;
  budget: number; // in pollen units

  // Timeouts (in milliseconds)
  requestTimeout: number;
  defaultToolTimeout: number;

  // Crew agent settings
  crewAgentCount: number;
  crewEnableParallel: boolean;

  // Retry settings
  maxRetries: number;
  retryBackoffMs: number;
  retryMultiplier: number;

  // Workspace
  workspaceRoot: string;
}

/**
 * Model configuration with pricing and parameters
 */
export interface ModelConfig {
  // Model registry
  models: Map<string, ModelDefinition>;

  // Default models
  defaultTextModel: string;
  defaultImageModel: string;

  // API endpoints
  geminiBaseUrl: string;
  pollinationsBaseUrl: string;
  nvidiaBaseUrl?: string;
}

/**
 * Individual model definition
 */
export interface ModelDefinition {
  name: string;
  provider: 'gemini' | 'pollinations' | 'anthropic' | 'openai' | 'nvidia';
  type: 'text' | 'image' | 'multimodal';
  modelId?: string;
  apiFamily?: string;
  endpoint?: string;

  // Pricing per 1K tokens
  pricing: {
    promptTokens: number; // $ per 1K tokens
    completionTokens: number; // $ per 1K tokens
  };

  // Model parameters
  maxTokens: number;
  contextWindow: number;

  // Capabilities
  supportsVision: boolean;
  supportsToolUse: boolean;
  supportsFunctionCalling: boolean;
  supportsStreaming?: boolean;

  // Status
  isActive: boolean;
  description?: string;
}

/**
 * Tool configuration with timeouts and settings
 */
export interface ToolConfig {
  // Timeouts by tool type (in milliseconds)
  timeouts: {
    default: number;
    bash: number;
    fileOperations: number;
    globPatterns: number;
    grep: number;
    subAgent: number;
  };

  // Tool execution settings
  maxBufferSize: number; // in bytes
  maxConcurrentTools: number;

  // Tool enable/disable flags
  enabledTools: Set<string>;

  // Tool-specific settings
  bashMaxLines: number;
  fileOpsSizeLimit: number; // in bytes
}

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  // Paths
  rootPath: string;
  logsPath: string;
  cachePath: string;
  tempPath: string;

  // Workspace properties
  name: string;
  description: string;

  // Security
  allowedPaths: string[];
  blockedPaths: string[];
  enforcePathValidation: boolean;

  // Performance
  maxFileSize: number; // in bytes
  indexingEnabled: boolean;
}

/**
 * Combined configuration object
 */
export interface AppConfig {
  env: EnvConfig;
  runtime: RuntimeConfig;
  models: ModelConfig;
  tools: ToolConfig;
  workspace: WorkspaceConfig;
}

/**
 * Configuration validation errors
 */
export interface ConfigValidationError {
  section: keyof AppConfig;
  field: string;
  value: unknown;
  error: string;
}

/**
 * Configuration source metadata
 */
export interface ConfigSource {
  timestamp: Date;
  source: 'env' | 'file' | 'default' | 'merged';
  lastModified: Date;
}
